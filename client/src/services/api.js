import axios from 'axios'

const STORAGE_SERVER_KEY = 'ksk_gateway_server_url'
const STORAGE_TOKEN_KEY = 'ksk_gateway_auth_token'

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
  return config
})

export const api = {
  getServerUrl() {
    return currentBaseUrl
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

  async login(username, password) {
    const res = await http.post('/api/auth/login', { username, password })
    if (res.data?.access_token) {
      localStorage.setItem(STORAGE_TOKEN_KEY, res.data.access_token)
    }
    return res.data
  },

  logout() {
    localStorage.removeItem(STORAGE_TOKEN_KEY)
  },

  async getMe() {
    const res = await http.get('/api/auth/me')
    return res.data
  },

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
