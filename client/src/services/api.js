import axios from 'axios'

export const APP_CLIENT_VERSION = '1.0.3'

const STORAGE_SERVER_KEY = 'ksk_gateway_server_url'
const STORAGE_TOKEN_KEY = 'ksk_gateway_auth_token'
const STORAGE_SESSION_UID_KEY = 'ksk_gateway_session_uid'

function getOrCreateSessionUid() {
  try {
    let uid = localStorage.getItem(STORAGE_SESSION_UID_KEY)
    if (!uid) {
      const rand = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
      uid = `ksk_ws_${rand}`
      localStorage.setItem(STORAGE_SESSION_UID_KEY, uid)
    }
    return uid
  } catch (e) {
    return `ksk_ws_${Date.now()}`
  }
}

function getInitialBaseUrl() {
  const saved = localStorage.getItem(STORAGE_SERVER_KEY)
  if (saved) return saved.replace(/\/+$/, '')
  const envUrl = import.meta.env?.VITE_API_BASE_URL
  if (envUrl) {
    return String(envUrl).trim().replace(/\/api\/?$/i, '').replace(/\/+$/, '')
  }
  if (window.electronAPI || window.location.protocol === 'file:') {
    return 'http://127.0.0.1:8790'
  }
  if (window.location.port === '5190') {
    return 'http://127.0.0.1:8790'
  }
  return window.location.origin
}

let currentBaseUrl = getInitialBaseUrl()
let cachedSysInfo = null
let cachedSysInfoAt = 0

async function collectClientSystemInfo(forceRefresh = false) {
  const now = Date.now()
  if (!forceRefresh && cachedSysInfo && now - cachedSysInfoAt < 60000) {
    return cachedSysInfo
  }

  let appVer = APP_CLIENT_VERSION
  try {
    if (window.electronAPI?.getAppVersion) {
      appVer = (await window.electronAPI.getAppVersion()) || APP_CLIENT_VERSION
    }
  } catch (e) {}

  let sys = {
    hostname: window.location.hostname || 'Web-Client',
    os_username: '',
    platform: navigator.platform || 'Browser',
    os_release: '',
    arch: '',
    mac_address: '',
    local_ip: '',
    cpu_info: navigator.hardwareConcurrency ? `${navigator.hardwareConcurrency} luồng (Trình duyệt)` : '',
    total_ram_gb: navigator.deviceMemory || null,
    os_uptime_hours: null,
    network_interfaces: []
  }

  try {
    if (window.electronAPI?.getSystemInfo) {
      const eInfo = await window.electronAPI.getSystemInfo()
      if (eInfo && typeof eInfo === 'object') {
        const { username: legacyOsUser, ...safeInfo } = eInfo
        sys = {
          ...sys,
          ...safeInfo,
          os_username: safeInfo.os_username || legacyOsUser || ''
        }
      }
    }
  } catch (e) {}

  cachedSysInfo = {
    ...sys,
    session_uid: getOrCreateSessionUid(),
    client_version: appVer
  }
  cachedSysInfoAt = now
  return cachedSysInfo
}

const http = axios.create({
  baseURL: currentBaseUrl,
  timeout: 30000
})

http.interceptors.request.use((config) => {
  config.baseURL = currentBaseUrl
  const token = localStorage.getItem(STORAGE_TOKEN_KEY)
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  config.headers['X-Session-Uid'] = getOrCreateSessionUid()
  if (cachedSysInfo?.local_ip) {
    config.headers['X-Client-Lan-IP'] = cachedSysInfo.local_ip
  }
  return config
})

http.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status
    const detail = error?.response?.data?.detail || ''
    const blockCode = error?.response?.headers?.['x-block-code']
    const reqUrl = String(error?.config?.url || '')

    if (status === 403 && (blockCode === 'IP_BLOCKED' || detail.includes('IP máy trạm'))) {
      localStorage.removeItem(STORAGE_TOKEN_KEY)
      window.dispatchEvent(new CustomEvent('ksk:ip-blocked', { detail }))
    } else if (status === 401 && !reqUrl.includes('/api/auth/login')) {
      const hadToken = Boolean(localStorage.getItem(STORAGE_TOKEN_KEY))
      if (hadToken) {
        localStorage.removeItem(STORAGE_TOKEN_KEY)
        window.dispatchEvent(new CustomEvent('ksk:session-expired', { detail }))
      }
    }
    return Promise.reject(error)
  }
)

export const api = {
  getServerUrl() {
    return currentBaseUrl
  },

  getSessionUid() {
    return getOrCreateSessionUid()
  },

  async getClientSystemInfo(force = false) {
    return collectClientSystemInfo(force)
  },

  async setServerUrl(url) {
    let clean = String(url || '').trim().replace(/\/+$/, '')
    if (!clean) clean = 'http://127.0.0.1:8790'
    if (!/^https?:\/\//i.test(clean)) clean = 'http://' + clean
    currentBaseUrl = clean
    localStorage.setItem(STORAGE_SERVER_KEY, clean)
    if (window.electronAPI?.setServerUrl) {
      await window.electronAPI.setServerUrl(clean)
    }
    return clean
  },

  async checkHealth(customUrl) {
    const target = customUrl ? String(customUrl).trim().replace(/\/+$/, '') : currentBaseUrl
    const res = await axios.get(`${target}/api/health`, { timeout: 5000 })
    return res.data
  },

  async getSystemVersion() {
    const res = await http.get('/api/system/version')
    return res.data
  },

  // ─── Xác thực & Hồ sơ cá nhân ──────────────────────────────────────────────
  async login(username, password) {
    const sysInfo = await collectClientSystemInfo()
    const res = await http.post('/api/auth/login', {
      ...sysInfo,
      username,
      password
    })
    if (res.data?.access_token) {
      localStorage.setItem(STORAGE_TOKEN_KEY, res.data.access_token)
    }
    return res.data
  },

  async logout() {
    try {
      await http.post('/api/auth/logout')
    } catch (e) {
      // Bỏ qua lỗi mạng khi đăng xuất cục bộ
    } finally {
      localStorage.removeItem(STORAGE_TOKEN_KEY)
    }
  },

  async getMe() {
    await collectClientSystemInfo()
    const res = await http.get('/api/auth/me')
    return res.data
  },

  async updateMyProfile(payload) {
    const res = await http.put('/api/auth/profile', payload)
    return res.data
  },

  // ─── Heartbeat & Giám sát Máy trạm kết nối ────────────────────────────────
  async sendHeartbeat() {
    const sysInfo = await collectClientSystemInfo()
    const res = await http.post('/api/system/heartbeat', sysInfo)
    return res.data
  },

  async getConnectedClients() {
    const res = await http.get('/api/system/connected-clients')
    return res.data
  },

  async getConnectedClientDetail(clientIp) {
    const res = await http.get(`/api/system/connected-clients/${encodeURIComponent(clientIp)}/detail`)
    return res.data
  },

  async blockClientIp(clientIp, reason) {
    const res = await http.post(`/api/system/connected-clients/${encodeURIComponent(clientIp)}/block`, { reason })
    return res.data
  },

  async unblockClientIp(clientIp) {
    const res = await http.post(`/api/system/connected-clients/${encodeURIComponent(clientIp)}/unblock`)
    return res.data
  },

  async logoutClientAccount(clientIp, userId) {
    const res = await http.post(
      `/api/system/connected-clients/${encodeURIComponent(clientIp)}/accounts/${userId}/logout`
    )
    return res.data
  },

  // ─── Khoa / Phòng (Tầng A) ────────────────────────────────────────────────
  async getDepartments(includeInactive = false) {
    const res = await http.get('/api/departments', {
      params: { include_inactive: includeInactive }
    })
    return res.data
  },

  async createDepartment(payload) {
    const res = await http.post('/api/departments', payload)
    return res.data
  },

  async updateDepartment(deptId, payload) {
    const res = await http.put(`/api/departments/${deptId}`, payload)
    return res.data
  },

  async lockDepartment(deptId) {
    const res = await http.delete(`/api/departments/${deptId}`)
    return res.data
  },

  async restoreDepartment(deptId) {
    const res = await http.post(`/api/departments/${deptId}/restore`)
    return res.data
  },

  async purgeDepartment(deptId) {
    const res = await http.delete(`/api/departments/${deptId}/purge`)
    return res.data
  },

  async getDepartmentPermissions(deptId) {
    const res = await http.get(`/api/departments/${deptId}/permissions`)
    return res.data
  },

  async updateDepartmentPermissions(deptId, payload) {
    const res = await http.put(`/api/departments/${deptId}/permissions`, payload)
    return res.data
  },

  // ─── Danh mục Chức vụ (Tầng B) ────────────────────────────────────────────
  async getPositions(params = {}) {
    const res = await http.get('/api/positions', { params })
    return res.data
  },

  async createPosition(payload) {
    const res = await http.post('/api/positions', payload)
    return res.data
  },

  async updatePosition(posId, payload) {
    const res = await http.put(`/api/positions/${posId}`, payload)
    return res.data
  },

  async deletePosition(posId) {
    const res = await http.delete(`/api/positions/${posId}`)
    return res.data
  },

  async getPositionPermissions(posId) {
    const res = await http.get(`/api/positions/${posId}/permissions`)
    return res.data
  },

  async updatePositionPermissions(posId, payload) {
    const res = await http.put(`/api/positions/${posId}/permissions`, payload)
    return res.data
  },

  // ─── Người dùng & Ma trận Quyền (Tầng C / A∪B∪C) ──────────────────────────
  async getUsers(params = {}) {
    const res = await http.get('/api/users', { params })
    return res.data
  },

  async createUser(payload) {
    const res = await http.post('/api/users', payload)
    return res.data
  },

  async updateUser(userId, payload) {
    const res = await http.put(`/api/users/${userId}`, payload)
    return res.data
  },

  async deleteUser(userId) {
    const res = await http.delete(`/api/users/${userId}`)
    return res.data
  },

  async assignDepartmentHead(deptId, newHeadUserId) {
    const res = await http.put(`/api/users/departments/${deptId}/assign-head`, {
      new_head_user_id: newHeadUserId
    })
    return res.data
  },

  async getAllPermissions() {
    const res = await http.get('/api/users/permissions/all')
    return res.data
  },

  async getUserPermissionMatrix(userId) {
    const res = await http.get(`/api/users/${userId}/permission-matrix`)
    return res.data
  },

  async updateUserPermissions(userId, payload) {
    const res = await http.put(`/api/users/${userId}/permissions`, payload)
    return res.data
  },

  // ─── Cấu hình Đơn vị & Cổng KSK ───────────────────────────────────────────
  async getConfigs() {
    const res = await http.get('/api/configs')
    return res.data
  },

  async saveConfigs(payload) {
    const res = await http.put('/api/configs', payload)
    return res.data
  },

  getTemplateDownloadUrl(fmt = 'xlsx') {
    return `${currentBaseUrl}/api/templates/download/${fmt}`
  },

  // ─── Nghiệp vụ KSK 4 Bước ─────────────────────────────────────────────────
  async importBatchFile(file, notes = '') {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('notes', notes)
    const res = await http.post('/api/batches/import', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
    return res.data
  },

  async getBatches() {
    const res = await http.get('/api/batches')
    return res.data
  },

  async deleteBatch(batchId) {
    const res = await http.delete(`/api/batches/${batchId}`)
    return res.data
  },

  async getRecords(params = {}) {
    const res = await http.get('/api/records', { params })
    return res.data
  },

  async getRecordStats(params = {}) {
    const res = await http.get('/api/records/stats', { params })
    return res.data
  },

  async selectRecordIds(params = {}) {
    const res = await http.get('/api/records/select-ids', { params })
    return res.data
  },

  async getRecordDetail(recordId) {
    const res = await http.get(`/api/records/${recordId}`)
    return res.data
  },

  async updateRecordFields(recordId, fields) {
    const res = await http.put(`/api/records/${recordId}`, { fields })
    return res.data
  },

  async bulkCompleteRecords(payload) {
    const res = await http.post('/api/records/bulk-complete', payload)
    return res.data
  },

  async recheckRecords(payload = {}) {
    const res = await http.post('/api/records/recheck', payload)
    return res.data
  },

  async prepareSigning(payload) {
    const res = await http.post('/api/records/prepare-signing', payload)
    return res.data
  },

  async commitSignature(payload) {
    const res = await http.post('/api/records/commit-signature', payload)
    return res.data
  },

  async pushToPortal(payload) {
    const res = await http.post('/api/records/push-portal', payload)
    return res.data
  },

  async getPushLogs(limit = 50) {
    const res = await http.get('/api/push-logs', { params: { limit } })
    return res.data
  },

  async getAuditLogs(limit = 100) {
    const res = await http.get('/api/audit-logs', { params: { limit } })
    return res.data
  },

  // Tương tác với USB Token cắm trực tiếp tại máy Client
  async listClientUsbCertificates() {
    if (window.electronAPI?.listUsbTokenCertificates) {
      return await window.electronAPI.listUsbTokenCertificates()
    }
    return {
      success: true,
      hardwareCount: 0,
      certificates: [
        {
          thumbprint: 'WEB_SOFT_TOKEN_91034_RSA2048',
          subject: 'CN=BỆNH VIỆN ĐA KHOA BÌNH AN, OID.0.9.2342.19200300.100.1.1=MST:1700335853',
          issuer: 'CN=Viettel-CA (Chứng thư số Ký thử nghiệm), C=VN',
          serialNumber: '54019103420268899',
          notBefore: '2026-01-01',
          notAfter: '2029-12-31',
          friendlyName: 'Chứng thư số Điện tử Bệnh Viện (Chế độ Trình duyệt)',
          providerType: 'SERVER_SOFT_TOKEN_FALLBACK',
          isHardwareToken: false
        }
      ]
    }
  },

  async signWithClientUsbToken({ thumbprint, providerType, stringToSign, certInfo }) {
    if (window.electronAPI?.signBatchWithUsbToken && providerType !== 'SERVER_SOFT_TOKEN_FALLBACK') {
      return await window.electronAPI.signBatchWithUsbToken({
        thumbprint,
        providerType,
        stringToSign,
        certInfo
      })
    }
    return {
      success: true,
      use_soft_token_fallback: true,
      hospital_signature: '',
      cert_info: certInfo
    }
  }
}
