const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  isElectron: true,
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (cfg) => ipcRenderer.invoke('save-config', cfg),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  setServerUrl: (url) => ipcRenderer.invoke('set-server-url', url),
  downloadAndInstallUpdate: (updateInfo) => ipcRenderer.invoke('download-and-install-update', updateInfo),
  // Thông tin phần cứng & mạng máy trạm phục vụ Heartbeat / Giám sát Máy trạm kết nối
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
  getLocalIp: () => ipcRenderer.invoke('get-local-ip'),
  getNetworkAddresses: () => ipcRenderer.invoke('get-network-addresses'),
  // Điều khiển cửa sổ
  windowMinimize: () => ipcRenderer.send('window-minimize'),
  windowMaximize: () => ipcRenderer.send('window-maximize'),
  windowClose: () => ipcRenderer.send('window-close'),
  // Kết nối trực tiếp USB Token Chữ ký số Bệnh viện cắm tại máy Client
  listUsbTokenCertificates: () => ipcRenderer.invoke('usb-token:list-certificates'),
  signBatchWithUsbToken: (payload) => ipcRenderer.invoke('usb-token:sign-batch-digest', payload)
})
