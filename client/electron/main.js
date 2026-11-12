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

const FORCE_DIST = process.env.KSK_LOAD_DIST === '1'
const IS_DEV = !FORCE_DIST && process.env.NODE_ENV === 'development'
const CONFIG_PATH = path.join(app.getPath('userData'), 'ksk-gateway-config.json')
const PID_FILE_PATH = path.join(app.getPath('userData'), 'ksk-client.pid')
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
  const iconCandidates = [
    path.join(__dirname, 'icon.ico'),
    path.join(__dirname, '../build/icon.ico')
  ]
  const iconPath = iconCandidates.find((p) => fs.existsSync(p))

  mainWindow = new BrowserWindow({
    width: 1420,
    height: 880,
    minWidth: 1120,
    minHeight: 700,
    show: false,
    title: `Hệ Thống Đẩy Cổng Khám Sức Khỏe Quốc Gia - Bệnh Viện Đa Khoa Bình An (v${pkg.version})`,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  Menu.setApplicationMenu(null)

  mainWindow.once('ready-to-show', () => {
    if (!mainWindow) return
    mainWindow.show()
    mainWindow.focus()
  })

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
      mainWindow.show()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    try {
      fs.mkdirSync(path.dirname(PID_FILE_PATH), { recursive: true })
      fs.writeFileSync(PID_FILE_PATH, String(process.pid), 'utf-8')
    } catch (e) {}
    createWindow()
  })
}

app.on('will-quit', () => {
  try {
    if (fs.existsSync(PID_FILE_PATH)) {
      const savedPid = fs.readFileSync(PID_FILE_PATH, 'utf-8').trim()
      if (savedPid === String(process.pid)) {
        fs.unlinkSync(PID_FILE_PATH)
      }
    }
  } catch (e) {}
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// ==================== THÔNG TIN MẠNG & PHẦN CỨNG MÁY TRẠM ====================
const VIRTUAL_ADAPTER_RE = /virtualbox|vmware|hyper-v|vethernet|npcap|loopback|bluetooth|tap-|tun\d|docker|wsl|zerotier|tailscale|radmin|hamachi/i
const LAN_NAME_RE = /ethernet|lan|local area/i
const WIFI_NAME_RE = /wi-?fi|wlan|wireless/i

function getNetworkAddresses() {
  try {
    const nets = os.networkInterfaces()
    const candidates = []
    for (const name of Object.keys(nets)) {
      if (VIRTUAL_ADAPTER_RE.test(name)) continue
      for (const net of nets[name] || []) {
        if (net.family !== 'IPv4' || net.internal) continue
        if (net.address.startsWith('169.254.')) continue
        let type = 'other'
        if (LAN_NAME_RE.test(name)) type = 'lan'
        else if (WIFI_NAME_RE.test(name)) type = 'wifi'
        const mac = net.mac && net.mac !== '00:00:00:00:00:00' ? String(net.mac).toUpperCase() : null
        candidates.push({ name, address: net.address, type, mac })
      }
    }
    const priority = { lan: 0, wifi: 1, other: 2 }
    candidates.sort((a, b) => priority[a.type] - priority[b.type])
    return candidates
  } catch (err) {
    return []
  }
}

function getLocalIp() {
  const [best] = getNetworkAddresses()
  return best ? best.address : '127.0.0.1'
}

// ==================== IPC HANDLERS ====================
ipcMain.handle('get-config', () => loadConfig())

ipcMain.handle('get-local-ip', () => getLocalIp())

ipcMain.handle('get-network-addresses', () => getNetworkAddresses())

ipcMain.handle('get-system-info', () => {
  try {
    const nets = getNetworkAddresses()
    const primaryMac = nets.find((n) => n.mac)?.mac || null
    const localIp = nets[0]?.address || null
    const cpus = os.cpus() || []
    const cpuModel = cpus[0]?.model ? String(cpus[0].model).replace(/\s+/g, ' ').trim() : ''
    const cpuInfo = cpuModel ? `${cpuModel} (${cpus.length} luồng)` : (cpus.length ? `${cpus.length} luồng CPU` : null)
    const totalRamGb = Math.round((os.totalmem() / (1024 ** 3)) * 10) / 10
    const uptimeHours = Math.round((os.uptime() / 3600) * 10) / 10
    const osUser = os.userInfo()?.username || ''
    const osEdition = typeof os.version === 'function' ? os.version() : ''
    const osRelease = osEdition ? `${osEdition} (${os.release()})` : os.release()
    return {
      hostname: os.hostname(),
      os_username: osUser,
      platform: `${os.type()} ${os.release()} (${os.arch()})`,
      os_release: osRelease,
      arch: os.arch(),
      mac_address: primaryMac,
      local_ip: localIp,
      cpu_info: cpuInfo,
      total_ram_gb: totalRamGb,
      os_uptime_hours: uptimeHours,
      network_interfaces: nets
    }
  } catch (err) {
    return {
      hostname: os.hostname(),
      platform: os.platform(),
      os_username: ''
    }
  }
})

ipcMain.on('window-minimize', () => {
  if (mainWindow) mainWindow.minimize()
})

ipcMain.on('window-maximize', () => {
  if (!mainWindow) return
  if (mainWindow.isMaximized()) mainWindow.unmaximize()
  else mainWindow.maximize()
})

ipcMain.on('window-close', () => {
  if (mainWindow) mainWindow.close()
})

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
