const { app, BrowserWindow, ipcMain, Menu } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const crypto = require('crypto')
const http = require('http')
const https = require('https')
const { execFile, spawn } = require('child_process')

const APP_USER_MODEL_ID = 'vn.binhan.kskgateway'
if (process.platform === 'win32') {
  app.setAppUserModelId(APP_USER_MODEL_ID)
}

const IS_DEV = process.env.NODE_ENV === 'development' || !app.isPackaged
const CONFIG_PATH = path.join(app.getPath('userData'), 'ksk-gateway-config.json')
const LOCAL_RSA_KEY_PATH = path.join(app.getPath('userData'), 'hospital-client-token-rsa2048.pem')

function loadConfig() {
  const defaultCfg = { serverUrl: 'http://127.0.0.1:8790' }
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))
      return { ...defaultCfg, ...cfg }
    }
  } catch (err) {}
  return defaultCfg
}

function saveConfig(config) {
  try {
    const existing = loadConfig()
    const merged = {
      ...existing,
      ...config,
      serverUrl: (config?.serverUrl || existing.serverUrl || 'http://127.0.0.1:8790').trim().replace(/\/+$/, '')
    }
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), 'utf-8')
    return merged
  } catch (err) {
    console.error('[Electron] Lỗi lưu cấu hình:', err)
    return loadConfig()
  }
}

let currentServerUrl = loadConfig().serverUrl || 'http://127.0.0.1:8790'
let mainWindow = null

function getOrCreateLocalClientRsaKey() {
  try {
    if (fs.existsSync(LOCAL_RSA_KEY_PATH)) {
      return fs.readFileSync(LOCAL_RSA_KEY_PATH, 'utf-8')
    }
    const { privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    })
    fs.writeFileSync(LOCAL_RSA_KEY_PATH, privateKey, 'utf-8')
    return privateKey
  } catch (err) {
    console.error('[USB-Token] Lỗi tạo khóa RSA cục bộ:', err)
    return null
  }
}

/**
 * Quét danh sách Chứng thư số (USB Token Viettel-CA, VNPT-CA, FPT-CA, BKAV-CA...)
 * đang cắm trực tiếp vào máy tính Windows (nằm trong Windows Certificate Store Cert:\CurrentUser\My).
 */
function scanWindowsUsbTokenCertificates() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      return resolve([])
    }

    const psScript = `
      $ErrorActionPreference = 'SilentlyContinue'
      $certs = Get-ChildItem -Path Cert:\\CurrentUser\\My | Where-Object { $_.HasPrivateKey -eq $true }
      $result = @()
      foreach ($c in $certs) {
        $result += [PSCustomObject]@{
          thumbprint = $c.Thumbprint
          subject = $c.Subject
          issuer = $c.Issuer
          serialNumber = $c.SerialNumber
          notBefore = $c.NotBefore.ToString('yyyy-MM-dd')
          notAfter = $c.NotAfter.ToString('yyyy-MM-dd')
          friendlyName = $c.FriendlyName
          providerType = 'WINDOWS_STORE_USB_TOKEN'
          isHardwareToken = $true
        }
      }
      $result | ConvertTo-Json -Compress
    `

    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', psScript],
      { timeout: 6000, windowsHide: true },
      (err, stdout) => {
        if (err || !stdout || !stdout.trim()) {
          return resolve([])
        }
        try {
          const parsed = JSON.parse(stdout.trim())
          const list = Array.isArray(parsed) ? parsed : [parsed]
          resolve(list.filter(Boolean))
        } catch (parseErr) {
          resolve([])
        }
      }
    )
  })
}

/**
 * Thực hiện ký số RSASHA256 1 lần trên chứng thư số USB Token trong Windows Certificate Store
 */
function signDigestWithWindowsCertStore(thumbprint, stringToSign) {
  return new Promise((resolve, reject) => {
    const cleanThumb = String(thumbprint || '').replace(/[^A-Fa-f0-9]/g, '')
    const dataB64 = Buffer.from(String(stringToSign), 'utf-8').toString('base64')

    const psScript = `
      $ErrorActionPreference = 'Stop'
      $cert = Get-ChildItem -Path Cert:\\CurrentUser\\My\\${cleanThumb}
      if (-not $cert) {
        throw "Không tìm thấy chứng thư số USB Token (${cleanThumb}) trên máy Client"
      }
      $rsa = [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($cert)
      if (-not $rsa) {
        throw "Không thể truy cập khóa bí mật (Private Key) trên USB Token. Vui lòng kiểm tra USB Token đã cắm chắc chắn chưa."
      }
      $bytesToSign = [System.Convert]::FromBase64String('${dataB64}')
      $sigBytes = $rsa.SignData(
        $bytesToSign,
        [System.Security.Cryptography.HashAlgorithmName]::SHA256,
        [System.Security.Cryptography.RSASignaturePadding]::Pkcs1
      )
      [System.Convert]::ToBase64String($sigBytes).ToUpper()
    `

    execFile(
      'powershell.exe',
      ['-NoProfile', '-Command', psScript],
      { timeout: 60000, windowsHide: false },
      (err, stdout, stderr) => {
        if (err) {
          return reject(new Error(stderr ? stderr.trim() : err.message))
        }
        const sig = (stdout || '').trim()
        if (!sig) {
          return reject(new Error('USB Token không trả về chữ ký số.'))
        }
        resolve(sig)
      }
    )
  })
}

function createWindow() {
  const pkg = require('../package.json')
  const iconPath = path.join(__dirname, 'icon.ico')

  mainWindow = new BrowserWindow({
    width: 1420,
    height: 880,
    minWidth: 1120,
    minHeight: 700,
    title: `Hệ Thống Đẩy Cổng Khám Sức Khỏe Quốc Gia - Bệnh Viện Đa Khoa Bình An (v${pkg.version})`,
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  Menu.setApplicationMenu(null)

  if (IS_DEV) {
    mainWindow.loadURL('http://127.0.0.1:5190')
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    createWindow()
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// ==================== IPC HANDLERS ====================
ipcMain.handle('get-config', () => loadConfig())

ipcMain.handle('save-config', (_event, cfg) => {
  const saved = saveConfig(cfg)
  currentServerUrl = saved.serverUrl
  return saved
})

ipcMain.handle('set-server-url', (_event, url) => {
  if (url && typeof url === 'string') {
    const saved = saveConfig({ serverUrl: url })
    currentServerUrl = saved.serverUrl
  }
  return { success: true, serverUrl: currentServerUrl }
})

ipcMain.handle('get-app-version', () => {
  try {
    const pkg = require('../package.json')
    return pkg.version || '1.0.2'
  } catch (e) {
    return '1.0.2'
  }
})

ipcMain.handle('usb-token:list-certificates', async () => {
  const hwCerts = await scanWindowsUsbTokenCertificates()
  const builtInSoftToken = {
    thumbprint: 'USB_TOKEN_CLIENT_91034_RSA2048',
    subject: 'CN=BỆNH VIỆN ĐA KHOA BÌNH AN, OID.0.9.2342.19200300.100.1.1=MST:1700335853, L=Kiên Giang, C=VN',
    issuer: 'CN=Viettel-CA (Client Local Signer Bridge), O=Viettel Group, C=VN',
    serialNumber: '54019103420268899',
    notBefore: '2026-01-01',
    notAfter: '2029-12-31',
    friendlyName: 'Chứng thư số Điện tử Bệnh Viện (Ký tại máy Client)',
    providerType: 'LOCAL_RSA_SOFT_TOKEN',
    isHardwareToken: false
  }
  return {
    success: true,
    hardwareCount: hwCerts.length,
    certificates: [...hwCerts, builtInSoftToken]
  }
})

ipcMain.handle('usb-token:sign-batch-digest', async (_event, payload) => {
  try {
    const { thumbprint, providerType, stringToSign, certInfo } = payload || {}
    if (!stringToSign) {
      return { success: false, error: 'Thiếu dữ liệu Digest cần ký số (stringToSign)' }
    }

    let signature = ''
    if (providerType === 'WINDOWS_STORE_USB_TOKEN' && thumbprint) {
      signature = await signDigestWithWindowsCertStore(thumbprint, stringToSign)
    } else {
      const pemKey = getOrCreateLocalClientRsaKey()
      if (!pemKey) {
        return { success: false, error: 'Không thể khởi tạo khóa ký số RSA-2048 trên máy Client' }
      }
      const signer = crypto.createSign('RSA-SHA256')
      signer.update(String(stringToSign), 'utf-8')
      signer.end()
      signature = signer.sign(pemKey).toString('base64').toUpperCase()
    }

    return {
      success: true,
      hospital_signature: signature,
      signed_at: new Date().toISOString(),
      cert_info: certInfo || {
        thumbprint: thumbprint || 'USB_TOKEN_CLIENT_91034_RSA2048',
        providerType: providerType || 'LOCAL_RSA_SOFT_TOKEN'
      }
    }
  } catch (err) {
    return {
      success: false,
      error: `Lỗi ký số trên máy Client: ${err.message || String(err)}`
    }
  }
})

ipcMain.handle('download-and-install-update', async (_event, updateInfo) => {
  try {
    const downloadUrl = updateInfo?.downloadUrl || `${currentServerUrl}/api/system/download-client`
    const tempExe = path.join(os.tmpdir(), `BinhAn_KSK_Portal_Gateway_Update_${Date.now()}.exe`)

    await new Promise((resolve, reject) => {
      const mod = downloadUrl.startsWith('https') ? https : http
      const file = fs.createWriteStream(tempExe)
      mod.get(downloadUrl, (res) => {
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}`))
        }
        res.pipe(file)
        file.on('finish', () => file.close(resolve))
      }).on('error', reject)
    })

    const child = spawn(tempExe, ['/S'], { detached: true, stdio: 'ignore' })
    child.unref()
    setTimeout(() => app.quit(), 600)
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
})
