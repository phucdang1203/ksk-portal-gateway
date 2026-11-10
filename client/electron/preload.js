const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  isElectron: true,
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (cfg) => ipcRenderer.invoke('save-config', cfg),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  setServerUrl: (url) => ipcRenderer.invoke('set-server-url', url),
  downloadAndInstallUpdate: (updateInfo) => ipcRenderer.invoke('download-and-install-update', updateInfo),
  // Kết nối trực tiếp USB Token Chữ ký số Bệnh viện cắm tại máy Client
  listUsbTokenCertificates: () => ipcRenderer.invoke('usb-token:list-certificates'),
  signBatchWithUsbToken: (payload) => ipcRenderer.invoke('usb-token:sign-batch-digest', payload)
})
