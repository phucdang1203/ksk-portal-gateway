import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  Upload, FileSpreadsheet, ShieldCheck, KeyRound, Send, CheckCircle2,
  AlertCircle, AlertTriangle, Clock, Search, RefreshCw,
  Eye, Edit3, Trash2, Award, Server,
  ChevronLeft, ChevronRight, CheckSquare, Loader2, Usb, ShieldAlert
} from 'lucide-react'
import { api, APP_CLIENT_VERSION } from './services/api'
import {
  PermissionDisplayProvider,
  hasPerm,
  hasAnyPerm,
  PermBadge
} from './utils/permissions'
import AppShell from './components/AppShell'
import RecordDetailModal from './components/RecordDetailModal'
import UsbTokenSignModal from './components/UsbTokenSignModal'
import PushPortalModal from './components/PushPortalModal'
import ServerConfigModal from './components/ServerConfigModal'
import UserProfileModal from './components/admin/UserProfileModal'
import DepartmentsPage from './pages/admin/DepartmentsPage'
import UsersPage from './pages/admin/UsersPage'
import PortalConfigPage from './pages/admin/PortalConfigPage'
import ConnectedClientsScreen from './pages/admin/ConnectedClientsScreen'

function compareSemver(a, b) {
  const pa = String(a || '0.0.0').split('.').map((n) => parseInt(n, 10) || 0)
  const pb = String(b || '0.0.0').split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1
    if ((pa[i] || 0) < (pb[i] || 0)) return -1
  }
  return 0
}

function resolveDefaultNav(u) {
  if (!u) return 'WORKSPACE'
  if (hasPerm(u, 'PERM_KSK_WORKSPACE_VIEW')) return 'WORKSPACE'
  if (hasPerm(u, 'PERM_KSK_HISTORY_VIEW')) return 'HISTORY'
  if (hasPerm(u, 'PERM_ORG_DEPT_MANAGE')) return 'ADMIN_DEPTS'
  if (hasAnyPerm(u, 'PERM_ORG_USER_MANAGE', 'PERM_ORG_POSITION_MANAGE', 'PERM_ORG_PERMISSION_MANAGE')) {
    return 'ADMIN_USERS'
  }
  if (hasPerm(u, 'PERM_SYS_PORTAL_CONFIG')) return 'ADMIN_PORTAL_CONFIG'
  if (hasPerm(u, 'PERM_SYS_CLIENTS_MANAGE')) return 'ADMIN_CLIENTS'
  return 'GUIDE'
}

export default function App() {
  const [user, setUser] = useState(null)
  const [authChecking, setAuthChecking] = useState(true)
  const [loginUser, setLoginUser] = useState('')
  const [loginPass, setLoginPass] = useState('')
  const [loginError, setLoginError] = useState(null)
  const [loggingIn, setLoggingIn] = useState(false)

  // Server, Auto-Update & Configs
  const [serverConnected, setServerConnected] = useState(true)
  const [portalConfig, setPortalConfig] = useState({ hospital: {}, portal: {} })
  const [showConfigModal, setShowConfigModal] = useState(false)
  const [showProfileModal, setShowProfileModal] = useState(false)
  const [updateInfo, setUpdateInfo] = useState(null)

  // Navigation Tabs:
  // WORKSPACE | HISTORY | GUIDE | ADMIN_DEPTS | ADMIN_USERS | ADMIN_PORTAL_CONFIG | ADMIN_CLIENTS
  const [activeTab, setActiveTab] = useState('WORKSPACE')

  // Batches & Records State
  const [batches, setBatches] = useState([])
  const [selectedBatchId, setSelectedBatchId] = useState('')
  const [records, setRecords] = useState([])
  const [stats, setStats] = useState({
    total: 0,
    invalid_count: 0,
    eligible_total_count: 0,
    eligible_unsigned_count: 0,
    signed_ready_count: 0,
    signed_total_count: 0,
    synced_count: 0,
    sync_failed_count: 0
  })
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [search, setSearch] = useState('')
  const [loaiKsk, setLoaiKsk] = useState('ALL')
  const [stageFilter, setStageFilter] = useState('ALL')
  const [page, setPage] = useState(1)
  const [pageSize] = useState(15)
  const [totalItems, setTotalItems] = useState(0)

  // Selection Map<id, recordSummary>
  const [selectedMap, setSelectedMap] = useState(new Map())

  // Modals & Notifications
  const [bannerNotice, setBannerNotice] = useState(null)
  const [detailRecordId, setDetailRecordId] = useState(null)
  const [showSignModal, setShowSignModal] = useState(false)
  const [showPushModal, setShowPushModal] = useState(false)
  const [recordsToPush, setRecordsToPush] = useState([])

  // History Tab State
  const [pushLogs, setPushLogs] = useState([])
  const [auditLogs, setAuditLogs] = useState([])

  const fileInputRef = useRef(null)

  // Lắng nghe sự kiện thu hồi phiên từ xa (401) hoặc chặn IP máy trạm (403)
  useEffect(() => {
    const onSessionExpired = (e) => {
      setUser(null)
      setSelectedMap(new Map())
      setLoginError(
        e?.detail ||
          'Phiên đăng nhập đã hết hạn hoặc bị quản trị viên đăng xuất từ xa. Vui lòng đăng nhập lại.'
      )
    }
    const onIpBlocked = (e) => {
      setUser(null)
      setSelectedMap(new Map())
      setLoginError(
        e?.detail ||
          'Địa chỉ IP máy trạm hiện tại đã bị Quản trị viên chặn truy cập hệ thống.'
      )
    }

    window.addEventListener('ksk:session-expired', onSessionExpired)
    window.addEventListener('ksk:ip-blocked', onIpBlocked)
    return () => {
      window.removeEventListener('ksk:session-expired', onSessionExpired)
      window.removeEventListener('ksk:ip-blocked', onIpBlocked)
    }
  }, [])

  // Heartbeat định kỳ 15 giây gửi thông tin máy trạm về Server (hoạt động cả khi chưa đăng nhập)
  useEffect(() => {
    let cancelled = false

    const pingHeartbeat = async () => {
      try {
        const hb = await api.sendHeartbeat()
        if (!cancelled) {
          setServerConnected(true)
          if (hb?.client_blocked && user) {
            setUser(null)
            setSelectedMap(new Map())
            setLoginError(hb.blocked_reason || 'Địa chỉ IP máy trạm đã bị chặn truy cập.')
          }
        }
      } catch (err) {
        if (!cancelled && !err?.response) {
          setServerConnected(false)
        }
      }
    }

    pingHeartbeat()
    const timer = setInterval(pingHeartbeat, 15000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [user])

  // Kiểm tra phiên bản mới từ Server
  const checkUpdateAvailable = useCallback(async () => {
    try {
      let localVer = APP_CLIENT_VERSION
      if (window.electronAPI?.getAppVersion) {
        localVer = (await window.electronAPI.getAppVersion()) || APP_CLIENT_VERSION
      }
      const verRes = await api.getSystemVersion()
      const latest = verRes?.latest_client_version || verRes?.server_version
      if (latest && compareSemver(latest, localVer) > 0 && verRes?.client_installer_size) {
        setUpdateInfo({
          hasUpdate: true,
          latestVersion: latest,
          releaseNotes: verRes.release_notes,
          downloadUrl: `${api.getServerUrl()}${verRes.client_download_url}`,
          sha256: verRes.client_installer_sha256
        })
      } else {
        setUpdateInfo(null)
      }
    } catch (e) {}
  }, [])

  useEffect(() => {
    checkInitialSession()
    checkUpdateAvailable()
  }, [checkUpdateAvailable])

  const checkInitialSession = async () => {
    setAuthChecking(true)
    try {
      await api.checkHealth()
      setServerConnected(true)
      const me = await api.getMe()
      setUser(me)
      const initialNav = resolveDefaultNav(me)
      setActiveTab(initialNav)
      await loadSystemConfigs()
      if (hasPerm(me, 'PERM_KSK_WORKSPACE_VIEW')) {
        await loadBatchesAndRecords()
      } else if (initialNav === 'HISTORY') {
        await loadHistoryLogs()
      }
    } catch (err) {
      if (err.response?.status === 401 || err.response?.status === 403) {
        setServerConnected(true)
      } else {
        setServerConnected(false)
      }
      setUser(null)
    } finally {
      setAuthChecking(false)
    }
  }

  const refreshCurrentUser = async () => {
    try {
      const me = await api.getMe()
      setUser(me)
    } catch (e) {}
  }

  const loadSystemConfigs = async () => {
    try {
      const cfg = await api.getConfigs()
      if (cfg.success) {
        setPortalConfig({ hospital: cfg.hospital || {}, portal: cfg.portal || {} })
      }
    } catch (err) {}
  }

  const loadBatchesAndRecords = async (overrideBatchId = selectedBatchId) => {
    try {
      const bRes = await api.getBatches()
      const bList = bRes.data || []
      setBatches(bList)
      let activeBid = overrideBatchId
      if (!activeBid && bList.length > 0) {
        activeBid = bList[0].id
        setSelectedBatchId(activeBid)
      }
      await Promise.all([
        fetchRecords(1, activeBid, search, loaiKsk, stageFilter),
        fetchStats(activeBid, search, loaiKsk)
      ])
    } catch (err) {
      console.error('Lỗi tải dữ liệu:', err)
    }
  }

  const fetchRecords = async (
    pageNum = page,
    bid = selectedBatchId,
    q = search,
    type = loaiKsk,
    stage = stageFilter
  ) => {
    setLoading(true)
    try {
      const res = await api.getRecords({
        batch_id: bid || undefined,
        search: q || undefined,
        loai_ksk: type === 'ALL' ? undefined : type,
        stage_filter: stage === 'ALL' ? undefined : stage,
        page: pageNum,
        page_size: pageSize
      })
      if (res.success) {
        setRecords(res.data || [])
        setTotalItems(res.total || 0)
        setPage(pageNum)
      }
    } catch (err) {
      console.error('Lỗi tải danh sách hồ sơ:', err)
    } finally {
      setLoading(false)
    }
  }

  const fetchStats = async (bid = selectedBatchId, q = search, type = loaiKsk) => {
    try {
      const res = await api.getRecordStats({
        batch_id: bid || undefined,
        search: q || undefined,
        loai_ksk: type === 'ALL' ? undefined : type
      })
      if (res.success) {
        setStats(res)
      }
    } catch (err) {}
  }

  const refreshWorkspace = async () => {
    if (!hasPerm(user, 'PERM_KSK_WORKSPACE_VIEW')) return
    await Promise.all([
      fetchRecords(page, selectedBatchId, search, loaiKsk, stageFilter),
      fetchStats(selectedBatchId, search, loaiKsk),
      api.getBatches().then((r) => setBatches(r.data || []))
    ])
  }

  const handleLogin = async (e) => {
    e.preventDefault()
    setLoggingIn(true)
    setLoginError(null)
    try {
      const res = await api.login(loginUser, loginPass)
      if (res.success && res.user) {
        setUser(res.user)
        setLoginPass('')
        setServerConnected(true)
        const targetNav = resolveDefaultNav(res.user)
        setActiveTab(targetNav)
        await loadSystemConfigs()
        if (hasPerm(res.user, 'PERM_KSK_WORKSPACE_VIEW')) {
          await loadBatchesAndRecords('')
        } else if (targetNav === 'HISTORY') {
          await loadHistoryLogs()
        }
      }
    } catch (err) {
      setLoginError(err.response?.data?.detail || 'Không thể kết nối hoặc sai tài khoản/mật khẩu')
    } finally {
      setLoggingIn(false)
    }
  }

  const handleLogout = async () => {
    await api.logout()
    setUser(null)
    setLoginUser('')
    setLoginPass('')
    setSelectedMap(new Map())
  }

  const handleSelectNav = (navId) => {
    setActiveTab(navId)
    if (navId === 'HISTORY' && hasPerm(user, 'PERM_KSK_HISTORY_VIEW')) {
      loadHistoryLogs()
    } else if (navId === 'WORKSPACE' && hasPerm(user, 'PERM_KSK_WORKSPACE_VIEW')) {
      refreshWorkspace()
    }
  }

  const handleInstallUpdate = async () => {
    if (!updateInfo) return
    if (window.electronAPI?.downloadAndInstallUpdate) {
      await window.electronAPI.downloadAndInstallUpdate({
        downloadUrl: updateInfo.downloadUrl,
        expectedSha256: updateInfo.sha256,
        version: updateInfo.latestVersion
      })
    } else if (updateInfo.downloadUrl) {
      window.open(updateInfo.downloadUrl, '_blank', 'noopener,noreferrer')
    }
  }

  // ==================== BƯỚC 1: UPLOAD & IMPORT CSV / EXCEL ====================
  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase()
    if (!['.csv', '.xlsx', '.xls'].includes(ext)) {
      setBannerNotice({
        type: 'error',
        text: `Định dạng file '${ext}' không được hỗ trợ! Hệ thống hiện tại chỉ hỗ trợ 2 định dạng: CSV (.csv) và Excel (.xlsx, .xls).`
      })
      return
    }

    setUploading(true)
    setBannerNotice(null)
    try {
      const res = await api.importBatchFile(file)
      if (res.success && res.batch) {
        const newBid = res.batch.id
        setSelectedBatchId(newBid)
        setStageFilter('ALL')
        setSelectedMap(new Map())
        await loadBatchesAndRecords(newBid)
        setBannerNotice({
          type: res.batch.invalid_count > 0 ? 'warning' : 'success',
          text: `Đã import file '${file.name}' (${res.batch.total_records} hồ sơ): ${res.batch.eligible_count} hồ sơ đã đầy đủ thông tin, ${res.batch.invalid_count} hồ sơ còn thiếu thông tin cần kiểm tra/bổ sung trước khi ký số.`
        })
      }
    } catch (err) {
      setBannerNotice({
        type: 'error',
        text: err.response?.data?.detail || err.message || 'Lỗi khi import file CSV/Excel'
      })
    } finally {
      setUploading(false)
    }
  }

  // ==================== BƯỚC 2: KIỂM TRA (CHECK) & BỔ SUNG NHANH ====================
  const handleRunPrecheck = async () => {
    setLoading(true)
    try {
      const res = await api.recheckRecords({
        batch_id: selectedBatchId || undefined,
        record_ids: selectedMap.size > 0 ? Array.from(selectedMap.keys()) : undefined
      })
      await refreshWorkspace()
      if (res.incomplete_count > 0) {
        setBannerNotice({
          type: 'warning',
          text: `🔍 Kết quả Kiểm tra (Check): Có ${res.incomplete_count}/${res.total_checked} hồ sơ còn thiếu thông tin hoặc chưa có chữ ký kết luận! Đã có ${res.eligible_count} hồ sơ đầy đủ 100% thông tin (sẵn sàng Ký số Bệnh viện).`
        })
      } else {
        setBannerNotice({
          type: 'success',
          text: `✅ Kết quả Kiểm tra (Check): Toàn bộ ${res.eligible_count}/${res.total_checked} hồ sơ đã ĐẦY ĐỦ 100% thông tin và Chữ ký Kết luận! Bạn có thể bấm "2. Ký số Bệnh viện (USB Token)" ngay.`
        })
      }
    } catch (err) {
      setBannerNotice({ type: 'error', text: err.response?.data?.detail || err.message })
    } finally {
      setLoading(false)
    }
  }

  const handleBulkComplete = async () => {
    setLoading(true)
    try {
      const res = await api.bulkCompleteRecords({
        batch_id: selectedBatchId || undefined,
        record_ids: selectedMap.size > 0 ? Array.from(selectedMap.keys()) : undefined,
        confirm_specialty_signatures: true,
        confirm_conclusion_signature: true,
        fill_missing_defaults: true
      })
      await refreshWorkspace()
      setBannerNotice({
        type: 'success',
        text: res.message
      })
    } catch (err) {
      setBannerNotice({ type: 'error', text: err.response?.data?.detail || err.message })
    } finally {
      setLoading(false)
    }
  }

  // ==================== BƯỚC 4: MỞ MODAL ĐẨY DỮ LIỆU ĐÃ KÝ SỐ LÊN CỔNG ====================
  const handleOpenPushModal = async () => {
    try {
      const res = await api.selectRecordIds({
        batch_id: selectedBatchId || undefined,
        stage_filter: 'SIGNED'
      })
      const allSignedInBatch = res.data || []
      let targetSigned = allSignedInBatch
      if (selectedMap.size > 0) {
        const selectedSigned = allSignedInBatch.filter((item) => selectedMap.has(item.id))
        if (selectedSigned.length > 0) {
          targetSigned = selectedSigned
        }
      }
      if (targetSigned.length === 0) {
        setBannerNotice({
          type: 'warning',
          text: 'Chưa có hồ sơ nào được Ký số Điện tử Bệnh viện! Vui lòng thực hiện Bước "2. Ký số Bệnh viện (USB Token)" trước khi bấm Đẩy lên Cổng.'
        })
        return
      }
      setRecordsToPush(targetSigned)
      setShowPushModal(true)
    } catch (err) {
      setBannerNotice({ type: 'error', text: err.message })
    }
  }

  // ==================== CHỌN DÒNG TRONG BẢNG ====================
  const handleToggleRow = (item) => {
    const next = new Map(selectedMap)
    if (next.has(item.id)) {
      next.delete(item.id)
    } else {
      next.set(item.id, item)
    }
    setSelectedMap(next)
  }

  const handleTogglePage = () => {
    const allSelected = records.length > 0 && records.every((r) => selectedMap.has(r.id))
    const next = new Map(selectedMap)
    if (allSelected) {
      records.forEach((r) => next.delete(r.id))
    } else {
      records.forEach((r) => next.set(r.id, r))
    }
    setSelectedMap(next)
  }

  const handleSelectAllFiltered = async () => {
    const res = await api.selectRecordIds({
      batch_id: selectedBatchId || undefined,
      search: search || undefined,
      loai_ksk: loaiKsk === 'ALL' ? undefined : loaiKsk,
      stage_filter: stageFilter === 'ALL' ? undefined : stageFilter
    })
    const list = res.data || []
    if (selectedMap.size === list.length && list.length > 0) {
      setSelectedMap(new Map())
    } else {
      const next = new Map()
      list.forEach((it) => next.set(it.id, it))
      setSelectedMap(next)
    }
  }

  const loadHistoryLogs = async () => {
    try {
      const [pRes, aRes, bRes] = await Promise.all([
        api.getPushLogs(50),
        api.getAuditLogs(100),
        api.getBatches()
      ])
      setPushLogs(pRes.data || [])
      setAuditLogs(aRes.data || [])
      setBatches(bRes.data || [])
    } catch (err) {}
  }

  // ==================== MÀN HÌNH KIỂM TRA PHIÊN & ĐĂNG NHẬP ====================
  if (authChecking) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 size={32} className="animate-spin" color="#0284c7" />
      </div>
    )
  }

  if (!user) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px'
      }}>
        <div style={{
          background: '#ffffff',
          borderRadius: '14px',
          width: '100%',
          maxWidth: '440px',
          padding: '28px',
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.4)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <span className="badge badge-info">v{APP_CLIENT_VERSION}</span>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: '4px 10px', fontSize: '12px' }}
              onClick={() => setShowConfigModal(true)}
            >
              <Server size={13} /> Cấu hình Server ({api.getServerUrl()})
            </button>
          </div>

          <div style={{ textAlign: 'center', marginBottom: '22px' }}>
            <div style={{
              width: '54px',
              height: '54px',
              borderRadius: '14px',
              background: 'linear-gradient(135deg, #0284c7, #4f46e5)',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 12px'
            }}>
              <ShieldCheck size={30} />
            </div>
            <h2 style={{ fontSize: '18px', fontWeight: 800, color: '#0f172a' }}>
              KSK PORTAL GATEWAY
            </h2>
            <p style={{ fontSize: '12.5px', color: '#64748b', marginTop: '4px' }}>
              Hệ Thống Độc Lập Đẩy Dữ Liệu Khám Sức Khỏe Quốc Gia (CSV/Excel → Check → Ký số USB Token → Đẩy Cổng)
            </p>
          </div>

          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                Tài khoản đăng nhập
              </label>
              <input
                type="text"
                className="form-control"
                placeholder="Nhập tài khoản đăng nhập"
                autoComplete="off"
                value={loginUser}
                onChange={(e) => setLoginUser(e.target.value)}
                required
              />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                Mật khẩu
              </label>
              <input
                type="password"
                className="form-control"
                placeholder="Nhập mật khẩu"
                autoComplete="off"
                value={loginPass}
                onChange={(e) => setLoginPass(e.target.value)}
                required
              />
            </div>

            {loginError && (
              <div style={{
                padding: '10px 12px',
                borderRadius: '6px',
                background: '#fef2f2',
                border: '1px solid #fecaca',
                color: '#b91c1c',
                fontSize: '12.5px',
                fontWeight: 600
              }}>
                {loginError}
              </div>
            )}

            <button
              type="submit"
              className="btn btn-primary"
              style={{ height: '40px', fontSize: '14px' }}
              disabled={loggingIn}
            >
              {loggingIn ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
              Đăng nhập Hệ thống
            </button>
          </form>
        </div>

        <ServerConfigModal
          isOpen={showConfigModal}
          onClose={() => setShowConfigModal(false)}
          canManagePortal={false}
          onConfigUpdated={() => checkInitialSession()}
        />
      </div>
    )
  }

  // Cờ phân quyền trên màn hình nghiệp vụ KSK
  const canViewWorkspace = hasPerm(user, 'PERM_KSK_WORKSPACE_VIEW')
  const canImportBatch = hasPerm(user, 'PERM_KSK_BATCH_IMPORT')
  const canDeleteBatch = hasPerm(user, 'PERM_KSK_BATCH_DELETE')
  const canEditRecord = hasPerm(user, 'PERM_KSK_RECORD_EDIT')
  const canSignToken = hasPerm(user, 'PERM_KSK_SIGN_TOKEN')
  const canPushPortal = hasPerm(user, 'PERM_KSK_PUSH_PORTAL')
  const canViewHistory = hasPerm(user, 'PERM_KSK_HISTORY_VIEW')
  const canManagePortalCfg = hasPerm(user, 'PERM_SYS_PORTAL_CONFIG')

  const totalPages = Math.ceil(totalItems / pageSize) || 1

  return (
    <PermissionDisplayProvider user={user}>
      <AppShell
        user={user}
        activeNav={activeTab}
        onSelectNav={handleSelectNav}
        portalConfig={portalConfig}
        serverConnected={serverConnected}
        updateInfo={updateInfo}
        onInstallUpdate={handleInstallUpdate}
        onOpenServerModal={() => setShowConfigModal(true)}
        onOpenProfileModal={() => setShowProfileModal(true)}
        onLogout={handleLogout}
      >
        {/* ==================== TAB 1: BÀN LÀM VIỆC KSK 4 BƯỚC ==================== */}
        {activeTab === 'WORKSPACE' && (
          !canViewWorkspace ? (
            <div className="data-table-container" style={{ padding: '32px', textAlign: 'center' }}>
              <ShieldAlert size={36} color="#dc2626" style={{ margin: '0 auto 10px' }} />
              <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>
                Bạn chưa được cấp quyền truy cập Bàn làm việc KSK
              </h3>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px' }}>
                Vui lòng liên hệ Quản trị viên để cấp quyền <code>PERM_KSK_WORKSPACE_VIEW</code>.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {/* Thanh Quy trình 4 bước */}
              <div style={{
                background: '#ffffff',
                border: '1px solid var(--border)',
                borderRadius: '10px',
                padding: '12px 18px',
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: '12px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{
                    width: '32px', height: '32px', borderRadius: '8px',
                    background: '#e0f2fe', color: '#0284c7',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800
                  }}>1</div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '12.5px' }}>Import CSV / Excel</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Chỉ nhận file .csv, .xlsx, .xls</div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{
                    width: '32px', height: '32px', borderRadius: '8px',
                    background: '#fef3c7', color: '#d97706',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800
                  }}>2</div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '12.5px' }}>Kiểm tra Trường & Chữ ký KL</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Check hồ sơ thiếu thông tin trước</div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{
                    width: '32px', height: '32px', borderRadius: '8px',
                    background: '#eef2ff', color: '#4f46e5',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800
                  }}>3</div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '12.5px' }}>Ký số Điện tử Bệnh viện</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>USB Token tại Client • Ký 1 lần</div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{
                    width: '32px', height: '32px', borderRadius: '8px',
                    background: '#dcfce7', color: '#16a34a',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800
                  }}>4</div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '12.5px' }}>Bấm Đẩy lên Cổng Quốc gia</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Chỉ đẩy các hồ sơ đã ký số BV</div>
                  </div>
                </div>
              </div>

              {/* Banner thông báo kết quả Check / Import */}
              {bannerNotice && (
                <div style={{
                  padding: '12px 16px',
                  borderRadius: '8px',
                  background: bannerNotice.type === 'success' ? '#f0fdf4' : bannerNotice.type === 'warning' ? '#fffbeb' : '#fef2f2',
                  border: `1px solid ${bannerNotice.type === 'success' ? '#bbf7d0' : bannerNotice.type === 'warning' ? '#fde68a' : '#fecaca'}`,
                  color: bannerNotice.type === 'success' ? '#15803d' : bannerNotice.type === 'warning' ? '#b45309' : '#b91c1c',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px',
                  fontWeight: 600,
                  fontSize: '13px'
                }}>
                  <span>{bannerNotice.text}</span>
                  <button
                    type="button"
                    onClick={() => setBannerNotice(null)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700, color: 'inherit' }}
                  >
                    ✕
                  </button>
                </div>
              )}

              {/* 5 Thẻ Thống kê & Lọc nhanh theo Giai đoạn */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '12px' }}>
                <div
                  onClick={() => { setStageFilter('ALL'); fetchRecords(1, selectedBatchId, search, loaiKsk, 'ALL'); }}
                  style={{
                    background: '#ffffff',
                    padding: '12px 16px',
                    borderRadius: '10px',
                    border: stageFilter === 'ALL' ? '2px solid #0284c7' : '1px solid var(--border)',
                    cursor: 'pointer'
                  }}
                >
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>Tổng hồ sơ trong lô</div>
                  <div style={{ fontSize: '22px', fontWeight: 800, marginTop: '2px' }}>
                    {stats.total} <span style={{ fontSize: '12px', fontWeight: 400 }}>hồ sơ</span>
                  </div>
                </div>

                <div
                  onClick={() => { setStageFilter('INVALID'); fetchRecords(1, selectedBatchId, search, loaiKsk, 'INVALID'); }}
                  style={{
                    background: '#fff1f2',
                    padding: '12px 16px',
                    borderRadius: '10px',
                    border: stageFilter === 'INVALID' ? '2px solid #e11d48' : '1px solid #fecdd3',
                    cursor: 'pointer'
                  }}
                >
                  <div style={{ fontSize: '12px', color: '#be123c', fontWeight: 700 }}>🔴 Thiếu thông tin / Chặn ký</div>
                  <div style={{ fontSize: '22px', fontWeight: 800, color: '#be123c', marginTop: '2px' }}>
                    {stats.invalid_count} <span style={{ fontSize: '12px', fontWeight: 500 }}>cần bổ sung</span>
                  </div>
                </div>

                <div
                  onClick={() => { setStageFilter('UNSIGNED_ELIGIBLE'); fetchRecords(1, selectedBatchId, search, loaiKsk, 'UNSIGNED_ELIGIBLE'); }}
                  style={{
                    background: '#eff6ff',
                    padding: '12px 16px',
                    borderRadius: '10px',
                    border: stageFilter === 'UNSIGNED_ELIGIBLE' ? '2px solid #2563eb' : '1px solid #bfdbfe',
                    cursor: 'pointer'
                  }}
                >
                  <div style={{ fontSize: '12px', color: '#1d4ed8', fontWeight: 700 }}>🟢 Đủ thông tin (Chờ Ký số BV)</div>
                  <div style={{ fontSize: '22px', fontWeight: 800, color: '#1d4ed8', marginTop: '2px' }}>
                    {stats.eligible_unsigned_count} <span style={{ fontSize: '12px', fontWeight: 500 }}>sẵn sàng ký</span>
                  </div>
                </div>

                <div
                  onClick={() => { setStageFilter('SIGNED'); fetchRecords(1, selectedBatchId, search, loaiKsk, 'SIGNED'); }}
                  style={{
                    background: '#f5f3ff',
                    padding: '12px 16px',
                    borderRadius: '10px',
                    border: stageFilter === 'SIGNED' ? '2px solid #7c3aed' : '1px solid #ddd6fe',
                    cursor: 'pointer'
                  }}
                >
                  <div style={{ fontSize: '12px', color: '#6d28d9', fontWeight: 700 }}>🟣 Đã Ký số BV (Chờ bấm Đẩy)</div>
                  <div style={{ fontSize: '22px', fontWeight: 800, color: '#6d28d9', marginTop: '2px' }}>
                    {stats.signed_ready_count} <span style={{ fontSize: '12px', fontWeight: 500 }}>sẵn sàng đẩy</span>
                  </div>
                </div>

                <div
                  onClick={() => { setStageFilter('SYNCED'); fetchRecords(1, selectedBatchId, search, loaiKsk, 'SYNCED'); }}
                  style={{
                    background: '#f0fdf4',
                    padding: '12px 16px',
                    borderRadius: '10px',
                    border: stageFilter === 'SYNCED' ? '2px solid #16a34a' : '1px solid #bbf7d0',
                    cursor: 'pointer'
                  }}
                >
                  <div style={{ fontSize: '12px', color: '#15803d', fontWeight: 700 }}>✅ Đã Đẩy Cổng Quốc gia</div>
                  <div style={{ fontSize: '22px', fontWeight: 800, color: '#15803d', marginTop: '2px' }}>
                    {stats.synced_count} <span style={{ fontSize: '12px', fontWeight: 500 }}>hoàn tất</span>
                  </div>
                </div>
              </div>

              {/* Thanh Công cụ Import, Chọn Lô, Tìm kiếm & 3 Nút Hành động chính */}
              <div style={{
                background: '#ffffff',
                border: '1px solid var(--border)',
                borderRadius: '10px',
                padding: '14px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px'
              }}>
                {/* Hàng 1: Import File CSV/Excel + Chọn Lô + Nút Quy trình */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv,.xlsx,.xls"
                      onChange={handleFileUpload}
                      style={{ display: 'none' }}
                    />
                    {canImportBatch && (
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploading}
                      >
                        {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                        <span>Import File CSV / Excel (.csv, .xlsx)</span>
                        <PermBadge code="PERM_KSK_BATCH_IMPORT" />
                      </button>
                    )}

                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <FileSpreadsheet size={16} color="#0284c7" />
                      <select
                        className="form-control"
                        style={{ width: '280px', fontWeight: 600 }}
                        value={selectedBatchId}
                        onChange={(e) => {
                          const val = e.target.value ? Number(e.target.value) : ''
                          setSelectedBatchId(val)
                          setSelectedMap(new Map())
                          fetchRecords(1, val, search, loaiKsk, stageFilter)
                          fetchStats(val, search, loaiKsk)
                        }}
                      >
                        <option value="">-- Tất cả các lô đã Import --</option>
                        {batches.map((b) => (
                          <option key={b.id} value={b.id}>
                            [{b.batch_code}] {b.filename} ({b.total_records} ca)
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* 3 Nút Thực thi tuần tự: Check -> Ký số USB Token (1 lần) -> Đẩy Cổng */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={handleRunPrecheck}
                      disabled={loading}
                      title="Kiểm tra toàn bộ hồ sơ xem hồ sơ nào còn thiếu thông tin"
                    >
                      <ShieldCheck size={15} color="#d97706" />
                      <span>1. Kiểm tra Hồ sơ (Check)</span>
                    </button>

                    {canEditRecord && stats.invalid_count > 0 && (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={handleBulkComplete}
                        disabled={loading}
                        title="Xác nhận chữ ký kết luận và điền giá trị mặc định cho các trường lâm sàng trống"
                      >
                        <CheckSquare size={15} color="#0284c7" />
                        <span>Xác nhận nhanh Chữ ký BS</span>
                        <PermBadge code="PERM_KSK_RECORD_EDIT" />
                      </button>
                    )}

                    {canSignToken && (
                      <button
                        type="button"
                        className="btn btn-indigo"
                        onClick={() => setShowSignModal(true)}
                        disabled={loading || stats.total === 0}
                      >
                        <KeyRound size={15} />
                        <span>2. Ký số Bệnh viện (USB Token • 1 lần)</span>
                        <PermBadge code="PERM_KSK_SIGN_TOKEN" />
                      </button>
                    )}

                    {canPushPortal && (
                      <button
                        type="button"
                        className="btn btn-success"
                        onClick={handleOpenPushModal}
                        disabled={loading || stats.signed_ready_count === 0}
                        title={stats.signed_ready_count === 0 ? 'Cần thực hiện Ký số Bệnh viện trước khi đẩy lên Cổng' : 'Đẩy các hồ sơ đã ký số lên Cổng Quốc gia'}
                      >
                        <Send size={15} />
                        <span>3. Đẩy dữ liệu lên Cổng ({stats.signed_ready_count})</span>
                        <PermBadge code="PERM_KSK_PUSH_PORTAL" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Hàng 2: Tìm kiếm & Lọc */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: '300px' }}>
                    <div style={{ position: 'relative', flex: 1 }}>
                      <Search size={15} color="#94a3b8" style={{ position: 'absolute', left: '10px', top: '9px' }} />
                      <input
                        type="text"
                        className="form-control"
                        style={{ paddingLeft: '32px' }}
                        placeholder="Tìm theo Mã KCB, Họ tên bệnh nhân, Số CCCD..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            fetchRecords(1, selectedBatchId, search, loaiKsk, stageFilter)
                            fetchStats(selectedBatchId, search, loaiKsk)
                          }
                        }}
                      />
                    </div>
                    <select
                      className="form-control"
                      style={{ width: '190px' }}
                      value={loaiKsk}
                      onChange={(e) => {
                        const val = e.target.value
                        setLoaiKsk(val)
                        fetchRecords(1, selectedBatchId, search, val, stageFilter)
                        fetchStats(selectedBatchId, search, val)
                      }}
                    >
                      <option value="ALL">Tất cả loại KSK</option>
                      <option value="DINH_KY">KSK Định kỳ (QĐ 2062/TT32)</option>
                      <option value="LAI_XE">KSK Lái xe (TT 36/2024)</option>
                    </select>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={refreshWorkspace}
                    >
                      <RefreshCw size={14} /> Làm mới
                    </button>
                  </div>

                  {selectedMap.size > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '12.5px', color: '#0369a1', fontWeight: 600 }}>
                      <span>Đang chọn: {selectedMap.size} hồ sơ</span>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ padding: '4px 8px', fontSize: '11.5px' }}
                        onClick={handleSelectAllFiltered}
                      >
                        Chọn tất cả ({totalItems})
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger"
                        style={{ padding: '4px 8px', fontSize: '11.5px' }}
                        onClick={() => setSelectedMap(new Map())}
                      >
                        Bỏ chọn
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Bảng dữ liệu Hồ sơ KSK */}
              <div className="data-table-container">
                <div style={{ overflowX: 'auto' }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th style={{ width: '38px', textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            checked={records.length > 0 && records.every((r) => selectedMap.has(r.id))}
                            onChange={handleTogglePage}
                          />
                        </th>
                        <th>Mã KCB</th>
                        <th>Họ và tên</th>
                        <th>Số CCCD</th>
                        <th>Ngày sinh / GT</th>
                        <th>Loại KSK & Phân loại</th>
                        <th>Chữ ký Chuyên khoa & Kết luận</th>
                        <th>Kiểm tra Trường dữ liệu (Check)</th>
                        <th>Chữ ký Điện tử Bệnh viện (USB Token)</th>
                        <th>Trạng thái Cổng</th>
                        <th style={{ textAlign: 'center' }}>Thao tác</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loading && records.length === 0 ? (
                        <tr>
                          <td colSpan="11" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                            <Loader2 size={24} className="animate-spin" style={{ margin: '0 auto 8px' }} />
                            Đang tải danh sách hồ sơ KSK...
                          </td>
                        </tr>
                      ) : records.length === 0 ? (
                        <tr>
                          <td colSpan="11" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                            Chưa có hồ sơ nào trong bộ lọc này. Hãy bấm <strong>"Import File CSV / Excel"</strong> để tải dữ liệu lên.
                          </td>
                        </tr>
                      ) : (
                        records.map((item) => {
                          const isSelected = selectedMap.has(item.id)
                          const missingList = item.validation?.missing_fields || []

                          return (
                            <tr key={item.id} style={{ background: isSelected ? '#f0f9ff' : undefined }}>
                              <td style={{ textAlign: 'center' }}>
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => handleToggleRow(item)}
                                />
                              </td>
                              <td style={{ fontFamily: 'monospace', fontWeight: 700 }}>{item.ma_kcb}</td>
                              <td style={{ fontWeight: 700, color: '#0f172a' }}>{item.ho_va_ten}</td>
                              <td style={{ fontFamily: 'monospace', fontWeight: 600, color: item.so_cccd ? '#0f766e' : '#dc2626' }}>
                                {item.so_cccd || '(Thiếu CCCD)'}
                              </td>
                              <td style={{ fontSize: '12px' }}>
                                {item.ngay_sinh || '--'} ({item.gioi_tinh || '--'})
                              </td>
                              <td>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                                  <span className={`badge ${item.loai_ksk === 'LAI_XE' ? 'badge-info' : 'badge-neutral'}`}>
                                    {item.loai_ksk === 'LAI_XE' ? 'KSK Lái xe' : 'KSK Định kỳ'}
                                  </span>
                                  <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#334155' }}>
                                    PL: {item.phan_loai_sk || '(Chưa có)'}
                                  </span>
                                </div>
                              </td>

                              {/* Cột Chữ ký Chuyên khoa & Kết luận */}
                              <td>
                                {item.has_conclusion_signature && item.has_specialty_signatures ? (
                                  <div>
                                    <span className="badge badge-success">
                                      <CheckCircle2 size={12} /> Đã ký đủ CK & Kết luận
                                    </span>
                                    <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                                      BS: {item.bs_ket_luan}
                                    </div>
                                  </div>
                                ) : (
                                  <div>
                                    <span className="badge badge-danger">
                                      <AlertCircle size={12} />
                                      {!item.has_conclusion_signature ? 'Chưa ký Kết luận' : 'Thiếu chữ ký CK'}
                                    </span>
                                    <div style={{ fontSize: '11px', color: '#dc2626', marginTop: '2px' }}>
                                      Cần ký xác nhận trước khi ký số BV
                                    </div>
                                  </div>
                                )}
                              </td>

                              {/* Cột Kiểm tra Trường dữ liệu */}
                              <td>
                                {item.is_eligible ? (
                                  <span className="badge badge-success">
                                    <CheckCircle2 size={12} /> Đầy đủ 100% thông tin
                                  </span>
                                ) : (
                                  <div>
                                    <span className="badge badge-danger">
                                      <AlertTriangle size={12} /> Thiếu {item.error_count} trường
                                    </span>
                                    <div
                                      style={{
                                        fontSize: '11px',
                                        color: '#dc2626',
                                        marginTop: '2px',
                                        maxWidth: '180px',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap'
                                      }}
                                      title={missingList.join(', ')}
                                    >
                                      Thiếu: {missingList.join(', ')}
                                    </div>
                                  </div>
                                )}
                              </td>

                              {/* Cột Chữ ký số Bệnh viện (USB Token) */}
                              <td>
                                {item.signing_status === 'SIGNED' ? (
                                  <div>
                                    <span className="badge badge-purple">
                                      <Award size={12} /> Đã ký số Bệnh viện
                                    </span>
                                    <div style={{ fontSize: '10.5px', color: '#6b21a8', marginTop: '2px', fontFamily: 'monospace' }}>
                                      SN: {item.cert_serial}
                                    </div>
                                  </div>
                                ) : item.is_eligible ? (
                                  <span className="badge badge-info">
                                    <Usb size={12} /> Chờ ký số BV
                                  </span>
                                ) : (
                                  <span className="badge badge-neutral">
                                    Chặn ký (Thiếu TT)
                                  </span>
                                )}
                              </td>

                              {/* Cột Trạng thái Đẩy Cổng */}
                              <td>
                                {item.sync_status === 'SYNCED' ? (
                                  <div>
                                    <span className="badge badge-success">
                                      <CheckCircle2 size={12} /> Đã đẩy lên Cổng
                                    </span>
                                    <div style={{ fontSize: '10.5px', color: '#15803d', marginTop: '2px', fontFamily: 'monospace' }}>
                                      {item.portal_msg_id}
                                    </div>
                                  </div>
                                ) : item.sync_status === 'FAILED' ? (
                                  <span className="badge badge-danger">
                                    <AlertCircle size={12} /> Lỗi đẩy Cổng
                                  </span>
                                ) : (
                                  <span className="badge badge-warning">
                                    <Clock size={12} /> Chưa đẩy Cổng
                                  </span>
                                )}
                              </td>

                              {/* Thao tác */}
                              <td style={{ textAlign: 'center' }}>
                                <button
                                  type="button"
                                  className="btn btn-secondary"
                                  style={{ padding: '4px 10px', fontSize: '12px' }}
                                  onClick={() => setDetailRecordId(item.id)}
                                >
                                  {canEditRecord ? <Edit3 size={13} /> : <Eye size={13} />}
                                  <span>
                                    {!canEditRecord
                                      ? 'Xem chi tiết'
                                      : item.is_eligible
                                      ? 'Xem / Sửa'
                                      : 'Bổ sung TT'}
                                  </span>
                                  {canEditRecord && <PermBadge code="PERM_KSK_RECORD_EDIT" />}
                                </button>
                              </td>
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Phân trang */}
                <div style={{
                  padding: '10px 16px',
                  background: '#f8fafc',
                  borderTop: '1px solid var(--border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  fontSize: '12.5px'
                }}>
                  <div>
                    Tổng số: <strong>{totalItems}</strong> hồ sơ | Trang <strong>{page}</strong> / <strong>{totalPages}</strong>
                  </div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ padding: '4px 10px' }}
                      disabled={page <= 1}
                      onClick={() => fetchRecords(page - 1)}
                    >
                      <ChevronLeft size={14} /> Trước
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ padding: '4px 10px' }}
                      disabled={page >= totalPages}
                      onClick={() => fetchRecords(page + 1)}
                    >
                      Sau <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )
        )}

        {/* ==================== TAB 2: LỊCH SỬ LÔ IMPORT & NHẬT KÝ ĐẨY CỔNG ==================== */}
        {activeTab === 'HISTORY' && (
          !canViewHistory ? (
            <div className="data-table-container" style={{ padding: '32px', textAlign: 'center' }}>
              <ShieldAlert size={36} color="#dc2626" style={{ margin: '0 auto 10px' }} />
              <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>
                Bạn chưa được cấp quyền xem Nhật ký Ký số & Đẩy Cổng
              </h3>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="data-table-container" style={{ padding: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <h3 style={{ fontSize: '15px', fontWeight: 700 }}>
                    1. Danh sách các Lô File CSV / Excel đã Import ({batches.length})
                  </h3>
                  <button type="button" className="btn btn-secondary" onClick={loadHistoryLogs}>
                    <RefreshCw size={14} /> Làm mới
                  </button>
                </div>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Mã Lô</th>
                      <th>Tên File Import</th>
                      <th>Định dạng</th>
                      <th>Tổng hồ sơ</th>
                      <th>Đủ điều kiện</th>
                      <th>Đã ký số BV</th>
                      <th>Đã đẩy Cổng</th>
                      <th>Thời gian Import</th>
                      <th style={{ textAlign: 'center' }}>Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batches.map((b) => (
                      <tr key={b.id}>
                        <td style={{ fontFamily: 'monospace', fontWeight: 700 }}>{b.batch_code}</td>
                        <td style={{ fontWeight: 600 }}>{b.filename}</td>
                        <td><span className="badge badge-info">{b.file_type}</span></td>
                        <td><strong>{b.total_records}</strong></td>
                        <td style={{ color: '#16a34a', fontWeight: 700 }}>{b.eligible_count}</td>
                        <td style={{ color: '#6d28d9', fontWeight: 700 }}>{b.signed_count}</td>
                        <td style={{ color: '#0284c7', fontWeight: 700 }}>{b.synced_count}</td>
                        <td>{b.created_at}</td>
                        <td style={{ textAlign: 'center' }}>
                          <div style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
                            {canViewWorkspace && (
                              <button
                                type="button"
                                className="btn btn-secondary"
                                style={{ padding: '4px 8px', fontSize: '11.5px' }}
                                onClick={() => {
                                  setSelectedBatchId(b.id)
                                  setActiveTab('WORKSPACE')
                                  fetchRecords(1, b.id, search, loaiKsk, stageFilter)
                                  fetchStats(b.id, search, loaiKsk)
                                }}
                              >
                                <Eye size={13} /> Mở lô này
                              </button>
                            )}
                            {canDeleteBatch && (
                              <button
                                type="button"
                                className="btn btn-danger"
                                style={{ padding: '4px 8px', fontSize: '11.5px' }}
                                onClick={async () => {
                                  if (!confirm(`Xóa lô import ${b.batch_code}?`)) return
                                  await api.deleteBatch(b.id)
                                  loadHistoryLogs()
                                }}
                                title="Xóa lô dữ liệu import"
                              >
                                <Trash2 size={13} />
                                <PermBadge code="PERM_KSK_BATCH_DELETE" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="data-table-container" style={{ padding: '16px' }}>
                <h3 style={{ fontSize: '15px', fontWeight: 700, marginBottom: '12px' }}>
                  2. Nhật ký Giao dịch Đẩy dữ liệu lên Cổng Quốc gia ({pushLogs.length})
                </h3>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Thời gian</th>
                      <th>Mã Gói Ký Số (Package ID)</th>
                      <th>Môi trường</th>
                      <th>Endpoint Cổng Quốc gia</th>
                      <th>Số hồ sơ</th>
                      <th>HTTP</th>
                      <th>Thời gian xử lý</th>
                      <th>Kết quả</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pushLogs.length === 0 ? (
                      <tr>
                        <td colSpan="8" style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>
                          Chưa có giao dịch đẩy cổng nào.
                        </td>
                      </tr>
                    ) : (
                      pushLogs.map((log) => (
                        <tr key={log.id}>
                          <td>{log.created_at}</td>
                          <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{log.package_id}</td>
                          <td><span className="badge badge-info">{log.target_env}</span></td>
                          <td style={{ fontFamily: 'monospace', fontSize: '11.5px' }}>{log.endpoint}</td>
                          <td><strong>{log.record_count}</strong></td>
                          <td><code>{log.http_status}</code></td>
                          <td>{log.execution_time_ms} ms</td>
                          <td>
                            {log.is_success ? (
                              <span className="badge badge-success">Thành công</span>
                            ) : (
                              <span className="badge badge-danger" title={log.error_message}>Thất bại</span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="data-table-container" style={{ padding: '16px' }}>
                <h3 style={{ fontSize: '15px', fontWeight: 700, marginBottom: '12px' }}>
                  3. Nhật ký Kiểm toán Thao tác Hệ thống ({auditLogs.length})
                </h3>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Thời gian</th>
                      <th>Tài khoản</th>
                      <th>Hành động</th>
                      <th>Chi tiết</th>
                      <th>IP Máy trạm</th>
                      <th>Kết quả</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLogs.length === 0 ? (
                      <tr>
                        <td colSpan="6" style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>
                          Chưa có nhật ký thao tác.
                        </td>
                      </tr>
                    ) : (
                      auditLogs.map((al) => (
                        <tr key={al.id}>
                          <td style={{ whiteSpace: 'nowrap' }}>{al.created_at}</td>
                          <td style={{ fontFamily: 'monospace', fontWeight: 700 }}>{al.username}</td>
                          <td><span className="badge badge-neutral">{al.action}</span></td>
                          <td style={{ fontSize: '12.5px' }}>{al.detail || al.details}</td>
                          <td style={{ fontFamily: 'monospace', fontSize: '12px' }}>{al.ip_address || '--'}</td>
                          <td>
                            <span className={`badge ${al.status === 'SUCCESS' ? 'badge-success' : 'badge-danger'}`}>
                              {al.status}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )
        )}

        {/* ==================== TAB 3: QUY CHUẨN & DOCKER ==================== */}
        {activeTab === 'GUIDE' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ background: '#ffffff', border: '1px solid var(--border)', borderRadius: '10px', padding: '20px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '10px', color: '#0f172a' }}>
                Quy trình Nghiệp vụ Chuẩn 4 Bước của KSK Portal Gateway
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', fontSize: '13px', lineHeight: 1.6 }}>
                <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '8px', border: '1px solid var(--border)' }}>
                  <strong>Bước 1 & Bước 2: Import CSV/Excel và Kiểm tra (Check)</strong>
                  <ul style={{ paddingLeft: '18px', marginTop: '6px' }}>
                    <li>Chỉ chấp nhận file <code>.csv</code> và Excel (<code>.xlsx</code>, <code>.xls</code>).</li>
                    <li>Tự động kiểm tra đầy đủ các trường hành chính (Họ tên, CCCD 12 số, Ngày sinh, Giới tính, Địa chỉ), Thể lực (Chiều cao, Cân nặng, Huyết áp), Chuyên khoa lâm sàng, Cận lâm sàng.</li>
                    <li>Kiểm tra bắt buộc <strong>Chữ ký Bác sĩ Chuyên khoa</strong> và <strong>Chữ ký Bác sĩ Kết luận + Số CCHN</strong>.</li>
                  </ul>
                </div>
                <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '8px', border: '1px solid var(--border)' }}>
                  <strong>Bước 3 & Bước 4: Ký số USB Token tại Client & Đẩy Cổng</strong>
                  <ul style={{ paddingLeft: '18px', marginTop: '6px' }}>
                    <li>Chữ ký điện tử của Bệnh viện cắm trực tiếp vào máy Client để thực hiện ký số.</li>
                    <li>Đầu tiên hệ thống check hồ sơ nào còn thiếu thông tin: khi đầy đủ hết mới được ký số toàn bộ, hoặc cho phép ký số đối với những hồ sơ đã đầy đủ thông tin.</li>
                    <li><strong>Ký số 1 lần duy nhất</strong> cho tất cả hồ sơ hợp lệ được chọn.</li>
                    <li>Khi ký số xong, bấm nút <strong>"Đẩy dữ liệu lên Cổng"</strong> thì hệ thống mới thực sự đẩy dữ liệu lên Cổng Quốc gia.</li>
                  </ul>
                </div>
              </div>
            </div>

            <div style={{ background: '#ffffff', border: '1px solid var(--border)', borderRadius: '10px', padding: '20px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '10px', color: '#0f172a' }}>
                Cơ chế Phân quyền Cộng dồn 3 Tầng (A ∪ B ∪ C) & Giám sát Máy trạm
              </h3>
              <ul style={{ paddingLeft: '18px', fontSize: '13px', lineHeight: 1.7, color: '#334155' }}>
                <li><strong>Tầng A (Quyền theo Khoa/Phòng):</strong> Gán quyền nền tảng cho toàn bộ nhân sự thuộc Khoa/Phòng. Nhân sự thuộc nhiều khoa/phòng được hợp nhất quyền tự động.</li>
                <li><strong>Tầng B (Quyền theo Chức vụ):</strong> Gán quyền theo chức danh công tác (Bác sĩ Kết luận, Chuyên trách Đẩy Cổng, Điều dưỡng nhập liệu...).</li>
                <li><strong>Tầng C (Quyền riêng Cá nhân):</strong> Cấp bổ sung các quyền đặc thù cho từng cá nhân. Tổng quyền hiệu lực = <code>A ∪ B ∪ C</code>.</li>
                <li><strong>Giám sát Máy trạm kết nối:</strong> Theo dõi trực tiếp trạng thái Online/Offline theo địa chỉ IP, cấu hình phần cứng, lịch sử đăng nhập đa tài khoản, chặn IP hoặc đăng xuất từ xa tức thì.</li>
              </ul>
            </div>

            <div style={{ background: '#ffffff', border: '1px solid var(--border)', borderRadius: '10px', padding: '20px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '10px', color: '#0f172a' }}>
                Hướng dẫn Triển khai Nhanh bằng Docker (Dễ dàng cài đặt ở mọi nơi)
              </h3>
              <pre style={{
                background: '#0f172a',
                color: '#e2e8f0',
                padding: '14px 18px',
                borderRadius: '8px',
                fontFamily: 'monospace',
                fontSize: '12.5px',
                overflowX: 'auto'
              }}>
{`# 1. Di chuyển vào thư mục dự án
cd D:\\bv-binhan\\projects\\ksk-portal-gateway

# 2. Khởi chạy toàn bộ Server & Web bằng Docker Compose
docker compose up -d --build

# - Backend API Server chạy tại: http://localhost:8790
# - Giao diện Web (Nginx) chạy tại: http://localhost:3090
# - App Desktop Client (.exe) kết nối trực tiếp tới http://<IP_SERVER>:8790 và đọc USB Token tại máy Client`}
              </pre>
            </div>
          </div>
        )}

        {/* ==================== CÁC MÀN HÌNH QUẢN TRỊ TỔ CHỨC & HỆ THỐNG ==================== */}
        {activeTab === 'ADMIN_DEPTS' && (
          <DepartmentsPage
            currentUser={user}
            onUserChanged={refreshCurrentUser}
          />
        )}

        {activeTab === 'ADMIN_USERS' && (
          <UsersPage
            currentUser={user}
            onUserChanged={refreshCurrentUser}
          />
        )}

        {activeTab === 'ADMIN_PORTAL_CONFIG' && (
          <PortalConfigPage
            currentUser={user}
            onConfigSaved={loadSystemConfigs}
          />
        )}

        {activeTab === 'ADMIN_CLIENTS' && (
          <ConnectedClientsScreen />
        )}
      </AppShell>

      {/* ==================== MODALS ==================== */}
      <RecordDetailModal
        isOpen={Boolean(detailRecordId)}
        recordId={detailRecordId}
        canEdit={canEditRecord}
        onClose={() => setDetailRecordId(null)}
        onSaved={() => refreshWorkspace()}
      />

      <UsbTokenSignModal
        isOpen={showSignModal}
        onClose={() => setShowSignModal(false)}
        batchId={selectedBatchId}
        selectedRecordIds={Array.from(selectedMap.keys())}
        onSignCompleted={() => {
          setSelectedMap(new Map())
          refreshWorkspace()
        }}
        onOpenRecordEdit={(recId) => setDetailRecordId(recId)}
      />

      <PushPortalModal
        isOpen={showPushModal}
        onClose={() => setShowPushModal(false)}
        signedRecords={recordsToPush}
        batchId={selectedBatchId}
        portalConfig={portalConfig}
        onPushSuccess={() => {
          setSelectedMap(new Map())
          refreshWorkspace()
        }}
      />

      <ServerConfigModal
        isOpen={showConfigModal}
        onClose={() => setShowConfigModal(false)}
        canManagePortal={canManagePortalCfg}
        onConfigUpdated={() => {
          loadSystemConfigs()
          refreshWorkspace()
        }}
      />

      <UserProfileModal
        isOpen={showProfileModal}
        user={user}
        onClose={() => setShowProfileModal(false)}
        onProfileUpdated={(updatedUser) => {
          if (updatedUser) setUser(updatedUser)
          else refreshCurrentUser()
        }}
      />
    </PermissionDisplayProvider>
  )
}
