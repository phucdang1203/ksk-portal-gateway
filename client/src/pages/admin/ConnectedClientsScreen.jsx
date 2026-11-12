import React, { useState, useEffect, useMemo } from 'react'
import {
  Monitor, Wifi, WifiOff, ShieldBan, ShieldCheck, LogOut, Search,
  RefreshCw, Eye, Cpu, HardDrive, Activity, AlertTriangle, X, Loader2, Clock, Users
} from 'lucide-react'
import { api, APP_CLIENT_VERSION } from '../../services/api'
import { PermBadge } from '../../utils/permissions'

const STATUS_BADGES = {
  active: { label: '🟢 Đang hoạt động', cls: 'badge-success' },
  logged_out: { label: '⚪ Đã đăng xuất', cls: 'badge-neutral' },
  switched_user: { label: '🔄 Đổi tài khoản', cls: 'badge-info' },
  blocked_ip: { label: '🚫 Bị chặn IP', cls: 'badge-danger' },
  session_expired: { label: '⏱️ Hết phiên', cls: 'badge-warning' }
}

export default function ConnectedClientsScreen() {
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(false)
  const [filterMode, setFilterMode] = useState('ALL') // ALL | ONLINE | LOGGED_IN | OUTDATED | BLOCKED
  const [search, setSearch] = useState('')
  const [banner, setBanner] = useState(null)

  // Slide-over Detail Drawer
  const [selectedIp, setSelectedIp] = useState(null)
  const [detailData, setDetailData] = useState(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [expandedAccountIds, setExpandedAccountIds] = useState(new Set())

  // Modal Chặn IP
  const [blockingIpTarget, setBlockingIpTarget] = useState(null)
  const [blockReason, setBlockReason] = useState('Phát hiện truy cập bất thường — Chặn bởi Quản trị viên')
  const [processingAction, setProcessingAction] = useState(false)

  useEffect(() => {
    loadClients()
    const timer = setInterval(() => {
      loadClients(true)
    }, 15000)
    return () => clearInterval(timer)
  }, [])

  const loadClients = async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const data = await api.getConnectedClients()
      setClients(data || [])
    } catch (err) {
      if (!silent) {
        setBanner({ type: 'error', text: err.response?.data?.detail || err.message })
      }
    } finally {
      if (!silent) setLoading(false)
    }
  }

  const openClientDetail = async (ip) => {
    setSelectedIp(ip)
    setLoadingDetail(true)
    try {
      const det = await api.getConnectedClientDetail(ip)
      setDetailData(det)
      const firstActive = (det.accounts || []).find((a) => a.is_active)
      if (firstActive) {
        setExpandedAccountIds(new Set([firstActive.user_id]))
      } else if (det.accounts?.[0]) {
        setExpandedAccountIds(new Set([det.accounts[0].user_id]))
      }
    } catch (err) {
      setBanner({ type: 'error', text: err.response?.data?.detail || err.message })
      setSelectedIp(null)
    } finally {
      setLoadingDetail(false)
    }
  }

  const handleConfirmBlockIp = async (e) => {
    e.preventDefault()
    if (!blockingIpTarget) return
    setProcessingAction(true)
    try {
      const updated = await api.blockClientIp(blockingIpTarget, blockReason)
      setBanner({ type: 'warning', text: `Đã chặn truy cập từ địa chỉ IP ${blockingIpTarget} và thu hồi phiên hiện tại.` })
      setBlockingIpTarget(null)
      await loadClients(true)
      if (selectedIp === blockingIpTarget) {
        setDetailData(updated)
      }
    } catch (err) {
      setBanner({ type: 'error', text: err.response?.data?.detail || err.message })
    } finally {
      setProcessingAction(false)
    }
  }

  const handleUnblockIp = async (ip) => {
    if (!window.confirm(`Mở khóa cho phép máy trạm IP ${ip} kết nối trở lại?`)) return
    setProcessingAction(true)
    try {
      const updated = await api.unblockClientIp(ip)
      setBanner({ type: 'success', text: `Đã mở chặn địa chỉ IP ${ip}.` })
      await loadClients(true)
      if (selectedIp === ip) {
        setDetailData(updated)
      }
    } catch (err) {
      setBanner({ type: 'error', text: err.response?.data?.detail || err.message })
    } finally {
      setProcessingAction(false)
    }
  }

  const handleRemoteLogoutAccount = async (ip, acc) => {
    if (!window.confirm(`Đăng xuất từ xa tài khoản "${acc.full_name}" (@${acc.username}) khỏi máy trạm IP ${ip}?`)) return
    setProcessingAction(true)
    try {
      const updated = await api.logoutClientAccount(ip, acc.user_id)
      setBanner({
        type: 'success',
        text: `Đã đăng xuất tài khoản @${acc.username} khỏi máy trạm ${ip}.`
      })
      setDetailData(updated)
      await loadClients(true)
    } catch (err) {
      setBanner({ type: 'error', text: err.response?.data?.detail || err.message })
    } finally {
      setProcessingAction(false)
    }
  }

  const stats = useMemo(() => {
    const total = clients.length
    const online = clients.filter((c) => c.is_online && !c.is_blocked).length
    const loggedIn = clients.filter((c) => Boolean(c.user_id) && !c.is_blocked).length
    const outdated = clients.filter((c) => c.is_outdated).length
    const blocked = clients.filter((c) => c.is_blocked).length
    const signedToday = clients.reduce((sum, c) => sum + (c.signed_count_today || 0), 0)
    const pushedToday = clients.reduce((sum, c) => sum + (c.pushed_count_today || 0), 0)
    return { total, online, loggedIn, outdated, blocked, signedToday, pushedToday }
  }, [clients])

  const filteredClients = useMemo(() => {
    const q = search.trim().toLowerCase()
    return clients.filter((c) => {
      if (filterMode === 'ONLINE' && (!c.is_online || c.is_blocked)) return false
      if (filterMode === 'LOGGED_IN' && (!c.user_id || c.is_blocked)) return false
      if (filterMode === 'OUTDATED' && !c.is_outdated) return false
      if (filterMode === 'BLOCKED' && !c.is_blocked) return false

      if (!q) return true
      const accNames = (c.accounts_summary || [])
        .map((a) => `${a.username} ${a.full_name}`)
        .join(' ')
        .toLowerCase()
      return (
        (c.client_ip || '').toLowerCase().includes(q) ||
        (c.hostname || '').toLowerCase().includes(q) ||
        (c.os_username || '').toLowerCase().includes(q) ||
        (c.mac_address || '').toLowerCase().includes(q) ||
        (c.username || '').toLowerCase().includes(q) ||
        (c.full_name || '').toLowerCase().includes(q) ||
        accNames.includes(q)
      )
    })
  }, [clients, filterMode, search])

  const toggleExpandAcc = (uid) => {
    const next = new Set(expandedAccountIds)
    if (next.has(uid)) next.delete(uid)
    else next.add(uid)
    setExpandedAccountIds(next)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {/* Header */}
      <div className="page-header-bar" style={{ marginBottom: 0 }}>
        <div>
          <h2 className="page-title">
            <Monitor size={22} color="#0284c7" />
            Máy trạm kết nối & Kiểm soát Phiên truy cập
            <PermBadge code="PERM_SYS_CLIENTS_MANAGE" />
          </h2>
          <p className="page-subtitle">
            Giám sát trực tuyến theo địa chỉ IP duy nhất (Heartbeat 15s), kiểm tra cấu hình máy cắm USB Token, chặn IP lạ và đăng xuất tài khoản từ xa.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="badge badge-success">● Tự động cập nhật 15s</span>
          <button type="button" className="btn btn-secondary" onClick={() => loadClients(false)} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Làm mới ngay
          </button>
        </div>
      </div>

      {banner && (
        <div style={{
          padding: '11px 15px', borderRadius: '8px', fontWeight: 600, fontSize: '13px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: banner.type === 'success' ? '#f0fdf4' : banner.type === 'warning' ? '#fffbeb' : '#fef2f2',
          border: `1px solid ${banner.type === 'success' ? '#bbf7d0' : banner.type === 'warning' ? '#fde68a' : '#fecaca'}`,
          color: banner.type === 'success' ? '#15803d' : banner.type === 'warning' ? '#b45309' : '#b91c1c'
        }}>
          <span>{banner.text}</span>
          <button type="button" onClick={() => setBanner(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 800, color: 'inherit' }}>✕</button>
        </div>
      )}

      {/* 6 Stat Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '10px' }}>
        <div
          onClick={() => setFilterMode('ALL')}
          style={{
            background: '#fff', padding: '12px 14px', borderRadius: '10px', cursor: 'pointer',
            border: filterMode === 'ALL' ? '2px solid #0284c7' : '1px solid var(--border)'
          }}
        >
          <div style={{ fontSize: '11.5px', color: '#64748b', fontWeight: 600 }}>Tổng máy trạm (IP)</div>
          <div style={{ fontSize: '21px', fontWeight: 800, marginTop: '2px' }}>{stats.total}</div>
        </div>

        <div
          onClick={() => setFilterMode('ONLINE')}
          style={{
            background: '#f0fdf4', padding: '12px 14px', borderRadius: '10px', cursor: 'pointer',
            border: filterMode === 'ONLINE' ? '2px solid #16a34a' : '1px solid #bbf7d0'
          }}
        >
          <div style={{ fontSize: '11.5px', color: '#15803d', fontWeight: 700 }}>🟢 Đang trực tuyến</div>
          <div style={{ fontSize: '21px', fontWeight: 800, color: '#15803d', marginTop: '2px' }}>{stats.online}</div>
        </div>

        <div
          onClick={() => setFilterMode('LOGGED_IN')}
          style={{
            background: '#eff6ff', padding: '12px 14px', borderRadius: '10px', cursor: 'pointer',
            border: filterMode === 'LOGGED_IN' ? '2px solid #2563eb' : '1px solid #bfdbfe'
          }}
        >
          <div style={{ fontSize: '11.5px', color: '#1d4ed8', fontWeight: 700 }}>👤 Đang đăng nhập</div>
          <div style={{ fontSize: '21px', fontWeight: 800, color: '#1d4ed8', marginTop: '2px' }}>{stats.loggedIn}</div>
        </div>

        <div style={{ background: '#f5f3ff', padding: '12px 14px', borderRadius: '10px', border: '1px solid #ddd6fe' }}>
          <div style={{ fontSize: '11.5px', color: '#6d28d9', fontWeight: 700 }}>⚡ KSK hôm nay</div>
          <div style={{ fontSize: '15px', fontWeight: 800, color: '#6d28d9', marginTop: '5px' }}>
            {stats.signedToday} ký • {stats.pushedToday} đẩy
          </div>
        </div>

        <div
          onClick={() => setFilterMode('OUTDATED')}
          style={{
            background: '#fffbeb', padding: '12px 14px', borderRadius: '10px', cursor: 'pointer',
            border: filterMode === 'OUTDATED' ? '2px solid #d97706' : '1px solid #fde68a'
          }}
        >
          <div style={{ fontSize: '11.5px', color: '#b45309', fontWeight: 700 }}>⬆️ Cần cập nhật App</div>
          <div style={{ fontSize: '21px', fontWeight: 800, color: '#b45309', marginTop: '2px' }}>{stats.outdated}</div>
        </div>

        <div
          onClick={() => setFilterMode('BLOCKED')}
          style={{
            background: '#fff1f2', padding: '12px 14px', borderRadius: '10px', cursor: 'pointer',
            border: filterMode === 'BLOCKED' ? '2px solid #e11d48' : '1px solid #fecdd3'
          }}
        >
          <div style={{ fontSize: '11.5px', color: '#be123c', fontWeight: 700 }}>🚫 IP đang bị chặn</div>
          <div style={{ fontSize: '21px', fontWeight: 800, color: '#be123c', marginTop: '2px' }}>{stats.blocked}</div>
        </div>
      </div>

      {/* Search & Filter Bar */}
      <div style={{
        background: '#fff', border: '1px solid var(--border)', borderRadius: '10px', padding: '12px 16px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px'
      }}>
        <div className="admin-tabs">
          {[
            { id: 'ALL', label: `Tất cả (${stats.total})` },
            { id: 'ONLINE', label: `Online (${stats.online})` },
            { id: 'LOGGED_IN', label: `Đang làm việc (${stats.loggedIn})` },
            { id: 'OUTDATED', label: `Phiên bản cũ (${stats.outdated})` },
            { id: 'BLOCKED', label: `Đã chặn (${stats.blocked})` }
          ].map((f) => (
            <button
              key={f.id}
              type="button"
              className={`admin-tab-btn ${filterMode === f.id ? 'active' : ''}`}
              onClick={() => setFilterMode(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div style={{ position: 'relative', width: '340px', maxWidth: '100%' }}>
          <Search size={14} color="#94a3b8" style={{ position: 'absolute', left: '10px', top: '9px' }} />
          <input
            type="text"
            className="form-control"
            style={{ paddingLeft: '30px' }}
            placeholder="Tìm theo IP, Tên máy (Hostname), MAC, Tài khoản..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Bảng Máy trạm (1 dòng duy nhất cho mỗi client_ip) */}
      <div className="data-table-container">
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Trạng thái</th>
                <th>Địa chỉ IP & MAC</th>
                <th>Thiết bị / Cấu hình</th>
                <th>Tài khoản đang làm việc / Gần nhất</th>
                <th>Phiên bản Client</th>
                <th>Nhịp tim cuối</th>
                <th style={{ textAlign: 'right' }}>Điều khiển</th>
              </tr>
            </thead>
            <tbody>
              {loading && clients.length === 0 ? (
                <tr>
                  <td colSpan="7" style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>
                    <Loader2 size={24} className="animate-spin" style={{ margin: '0 auto 8px' }} />
                    Đang tải danh sách máy trạm...
                  </td>
                </tr>
              ) : filteredClients.length === 0 ? (
                <tr>
                  <td colSpan="7" style={{ textAlign: 'center', padding: '36px', color: '#64748b' }}>
                    Chưa ghi nhận máy trạm nào khớp bộ lọc.
                  </td>
                </tr>
              ) : (
                filteredClients.map((ws) => (
                  <tr
                    key={ws.client_ip}
                    style={{ cursor: 'pointer', background: ws.is_blocked ? '#fff1f2' : undefined }}
                    onClick={() => openClientDetail(ws.client_ip)}
                  >
                    <td>
                      {ws.is_blocked ? (
                        <span className="badge badge-danger">
                          <ShieldBan size={12} /> Đã chặn IP
                        </span>
                      ) : ws.is_online ? (
                        <span className="badge badge-success">
                          <Wifi size={12} /> Trực tuyến
                        </span>
                      ) : (
                        <span className="badge badge-neutral">
                          <WifiOff size={12} /> Ngoại tuyến
                        </span>
                      )}
                    </td>

                    <td>
                      <div style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: '13.5px', color: '#0f172a' }}>
                        {ws.client_ip}
                      </div>
                      <div style={{ fontSize: '11px', color: '#64748b', fontFamily: 'monospace' }}>
                        {ws.mac_address ? `MAC: ${ws.mac_address}` : 'Chế độ Web / Loopback'}
                      </div>
                    </td>

                    <td>
                      <div style={{ fontWeight: 700, color: '#1e293b' }}>
                        {ws.hostname || 'Thiết bị trình duyệt'}
                        {ws.os_username ? <span style={{ fontWeight: 500, color: '#64748b' }}> ({ws.os_username})</span> : null}
                      </div>
                      <div style={{ fontSize: '11.5px', color: '#64748b' }}>
                        {ws.platform || ws.os_release || 'Windows / Web'}
                        {ws.total_ram_gb ? ` • RAM ${ws.total_ram_gb} GB` : ''}
                      </div>
                    </td>

                    <td>
                      {ws.username ? (
                        <div>
                          <div style={{ fontWeight: 700, color: '#0369a1' }}>
                            🟢 {ws.full_name} (@{ws.username})
                          </div>
                          <div style={{ fontSize: '11.5px', color: '#64748b' }}>
                            {ws.department_name || 'Chưa phân khoa'}
                            {ws.account_count > 1 ? ` • Tổng ${ws.account_count} TK trên máy này` : ''}
                          </div>
                        </div>
                      ) : ws.last_username ? (
                        <div>
                          <div style={{ fontWeight: 600, color: '#475569' }}>
                            ⚪ Chế độ chờ (Gần nhất: {ws.last_full_name || `@${ws.last_username}`})
                          </div>
                          <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                            Đã lưu {ws.account_count} tài khoản từng đăng nhập
                          </div>
                        </div>
                      ) : (
                        <span className="badge badge-neutral">Màn hình Đăng nhập (Khách)</span>
                      )}
                    </td>

                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span className={`badge ${ws.is_outdated ? 'badge-warning' : 'badge-info'}`}>
                          v{ws.client_version || APP_CLIENT_VERSION}
                        </span>
                        {ws.is_outdated && (
                          <span style={{ fontSize: '11px', color: '#b45309', fontWeight: 700 }}>Cũ</span>
                        )}
                      </div>
                    </td>

                    <td>
                      <div style={{ fontSize: '12px', fontWeight: 600 }}>{ws.last_heartbeat_at}</div>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>
                        Ký: {ws.signed_count_today || 0} • Đẩy: {ws.pushed_count_today || 0}
                      </div>
                    </td>

                    <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: 'inline-flex', gap: '6px' }}>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => openClientDetail(ws.client_ip)}
                        >
                          <Eye size={13} /> Chi tiết ({ws.account_count})
                        </button>
                        {ws.is_blocked ? (
                          <button
                            type="button"
                            className="btn btn-success btn-sm"
                            onClick={() => handleUnblockIp(ws.client_ip)}
                          >
                            <ShieldCheck size={13} /> Bỏ chặn
                          </button>
                        ) : ws.client_ip !== '127.0.0.1' ? (
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            onClick={() => setBlockingIpTarget(ws.client_ip)}
                          >
                            <ShieldBan size={13} /> Chặn IP
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ─── SLIDE-OVER DRAWER CHI TIẾT MÁY TRẠM & LỊCH SỬ TÀI KHOẢN ─────────── */}
      {selectedIp && (
        <div className="drawer-backdrop" onClick={() => setSelectedIp(null)}>
          <div className="drawer-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Monitor size={18} color="#0284c7" />
                  <span style={{ fontWeight: 800, fontSize: '15.5px', fontFamily: 'monospace' }}>
                    Máy trạm IP: {selectedIp}
                  </span>
                  {detailData?.is_blocked ? (
                    <span className="badge badge-danger">🚫 Đang bị chặn</span>
                  ) : detailData?.is_online ? (
                    <span className="badge badge-success">🟢 Online</span>
                  ) : (
                    <span className="badge badge-neutral">⚪ Offline</span>
                  )}
                </div>
                <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                  Kết nối lần đầu: {detailData?.first_connected_at || '--'} • Nhịp tim cuối: {detailData?.last_heartbeat_at || '--'}
                </div>
              </div>

              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSelectedIp(null)}>
                <X size={15} /> Đóng
              </button>
            </div>

            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {loadingDetail || !detailData ? (
                <div style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>
                  <Loader2 size={26} className="animate-spin" style={{ margin: '0 auto 8px' }} />
                  Đang tải hồ sơ phần cứng & lịch sử phiên đăng nhập...
                </div>
              ) : (
                <>
                  {detailData.is_blocked && (
                    <div style={{
                      padding: '12px 14px', borderRadius: '8px', background: '#fef2f2',
                      border: '1px solid #fecaca', color: '#991b1b', fontSize: '12.5px'
                    }}>
                      <div style={{ fontWeight: 800, marginBottom: '4px' }}>
                        🚫 Địa chỉ IP này đang bị chặn truy cập hệ thống
                      </div>
                      <div>Lý do: <strong>{detailData.blocked_reason}</strong></div>
                      <div>Thời điểm chặn: {detailData.blocked_at} {detailData.blocked_by_name ? `• Bởi: ${detailData.blocked_by_name}` : ''}</div>
                    </div>
                  )}

                  {/* Thông số Phần cứng & Hệ điều hành */}
                  <div style={{
                    border: '1px solid var(--border)', borderRadius: '10px', padding: '14px', background: '#f8fafc'
                  }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px'
                    }}>
                      <span style={{ fontWeight: 800, fontSize: '13px', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Cpu size={15} color="#0284c7" /> Thông tin Thiết bị & Mạng nội bộ
                      </span>

                      {detailData.is_blocked ? (
                        <button
                          type="button"
                          className="btn btn-success btn-sm"
                          onClick={() => handleUnblockIp(detailData.client_ip)}
                          disabled={processingAction}
                        >
                          <ShieldCheck size={13} /> Mở khóa IP này
                        </button>
                      ) : detailData.client_ip !== '127.0.0.1' ? (
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          onClick={() => setBlockingIpTarget(detailData.client_ip)}
                          disabled={processingAction}
                        >
                          <ShieldBan size={13} /> Chặn truy cập IP này
                        </button>
                      ) : null}
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 14px', fontSize: '12.5px' }}>
                      <div>Tên máy (Hostname): <strong>{detailData.hostname || '--'}</strong></div>
                      <div>Tài khoản Windows: <strong>{detailData.os_username || '--'}</strong></div>
                      <div>Hệ điều hành: <strong>{detailData.os_release || detailData.platform || '--'}</strong></div>
                      <div>Địa chỉ MAC chính: <strong style={{ fontFamily: 'monospace' }}>{detailData.mac_address || '--'}</strong></div>
                      <div style={{ gridColumn: '1 / -1' }}>Vi xử lý (CPU): <strong>{detailData.cpu_info || '--'}</strong></div>
                      <div>Bộ nhớ RAM: <strong>{detailData.total_ram_gb ? `${detailData.total_ram_gb} GB` : '--'}</strong></div>
                      <div>Thời gian bật máy: <strong>{detailData.os_uptime_hours ? `${detailData.os_uptime_hours} giờ` : '--'}</strong></div>
                      <div>Phiên bản App: <strong>v{detailData.client_version || APP_CLIENT_VERSION}</strong></div>
                      <div>Hoạt động hôm nay: <strong>{detailData.signed_count_today || 0} ký • {detailData.pushed_count_today || 0} đẩy</strong></div>
                    </div>

                    {(detailData.network_interfaces || []).length > 0 && (
                      <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px dashed #cbd5e1', fontSize: '12px' }}>
                        <div style={{ fontWeight: 700, marginBottom: '4px', color: '#475569' }}>Danh sách Card mạng (NIC):</div>
                        {detailData.network_interfaces.map((nic, idx) => (
                          <div key={idx} style={{ fontFamily: 'monospace', color: '#334155' }}>
                            • [{nic.type?.toUpperCase() || 'LAN'}] {nic.name}: <strong>{nic.address}</strong> {nic.mac ? `(MAC: ${nic.mac})` : ''}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Danh sách Tài khoản đã từng đăng nhập trên IP này */}
                  <div>
                    <div style={{ fontWeight: 800, fontSize: '14px', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Users size={16} color="#4f46e5" />
                      Các tài khoản trên máy trạm này ({(detailData.accounts || []).length})
                    </div>

                    {(detailData.accounts || []).length === 0 ? (
                      <div style={{
                        padding: '24px', textAlign: 'center', background: '#f8fafc',
                        border: '1px solid var(--border)', borderRadius: '8px', color: '#64748b', fontSize: '12.5px'
                      }}>
                        Máy trạm này hiện chưa có tài khoản nào đăng nhập.
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {detailData.accounts.map((acc) => {
                          const isExpanded = expandedAccountIds.has(acc.user_id)
                          return (
                            <div
                              key={acc.user_id}
                              style={{
                                border: acc.is_active ? '1.5px solid #38bdf8' : '1px solid var(--border)',
                                borderRadius: '10px',
                                overflow: 'hidden',
                                background: '#fff'
                              }}
                            >
                              <div style={{
                                padding: '11px 14px',
                                background: acc.is_active ? '#f0f9ff' : '#f8fafc',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                flexWrap: 'wrap',
                                gap: '8px'
                              }}>
                                <div
                                  style={{ cursor: 'pointer', flex: 1 }}
                                  onClick={() => toggleExpandAcc(acc.user_id)}
                                >
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                    <span style={{ fontWeight: 800, color: '#0f172a' }}>
                                      {acc.full_name} (@{acc.username})
                                    </span>
                                    {acc.is_active ? (
                                      <span className="badge badge-success">🟢 Đang đăng nhập trên máy này</span>
                                    ) : (
                                      <span className="badge badge-neutral">⚪ Đã thoát</span>
                                    )}
                                    <span className="badge badge-info">{acc.login_count} lần đăng nhập</span>
                                  </div>
                                  <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '3px' }}>
                                    🏢 {acc.department_name || 'Chưa phân khoa'}
                                    {acc.position_name ? ` • 💼 ${acc.position_name}` : ''}
                                    {acc.cchn ? ` • 🩺 CCHN: ${acc.cchn}` : ''}
                                  </div>
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  {acc.is_active && (
                                    <button
                                      type="button"
                                      className="btn btn-danger btn-sm"
                                      onClick={() => handleRemoteLogoutAccount(detailData.client_ip, acc)}
                                      disabled={processingAction}
                                      title="Buộc tài khoản này đăng xuất ngay lập tức khỏi máy trạm đang chọn"
                                    >
                                      <LogOut size={13} /> Đăng xuất từ xa
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => toggleExpandAcc(acc.user_id)}
                                  >
                                    <Clock size={13} /> {isExpanded ? 'Ẩn lịch sử' : `Lịch sử (${(acc.login_history || []).length})`}
                                  </button>
                                </div>
                              </div>

                              {isExpanded && (
                                <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)' }}>
                                  {(acc.login_history || []).length === 0 ? (
                                    <div style={{ fontSize: '12px', color: '#94a3b8' }}>Chưa có bản ghi chi tiết phiên.</div>
                                  ) : (
                                    <table className="data-table" style={{ fontSize: '12px' }}>
                                      <thead>
                                        <tr>
                                          <th>Đăng nhập lúc</th>
                                          <th>Hoạt động cuối</th>
                                          <th>Đăng xuất lúc</th>
                                          <th>Phiên bản</th>
                                          <th>Trạng thái phiên</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {acc.login_history.slice(0, 15).map((h) => {
                                          const st = STATUS_BADGES[h.status] || { label: h.status, cls: 'badge-neutral' }
                                          return (
                                            <tr key={h.id}>
                                              <td>{h.login_at}</td>
                                              <td>{h.last_seen_at}</td>
                                              <td>{h.logout_at || '--'}</td>
                                              <td><code>v{h.client_version || '--'}</code></td>
                                              <td><span className={`badge ${st.cls}`}>{st.label}</span></td>
                                            </tr>
                                          )
                                        })}
                                      </tbody>
                                    </table>
                                  )}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal Xác nhận Chặn IP */}
      {blockingIpTarget && (
        <div className="modal-backdrop" onClick={() => setBlockingIpTarget(null)}>
          <div className="modal-content" style={{ maxWidth: '460px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ fontWeight: 800, fontSize: '15px', color: '#be123c', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <AlertTriangle size={18} /> Chặn truy cập máy trạm IP: {blockingIpTarget}
              </div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setBlockingIpTarget(null)}>
                <X size={15} />
              </button>
            </div>
            <form onSubmit={handleConfirmBlockIp}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ fontSize: '12.5px', color: '#475569' }}>
                  Khi bị chặn, máy trạm có địa chỉ IP <strong>{blockingIpTarget}</strong> sẽ lập tức bị thu hồi phiên đăng nhập hiện tại và không thể gọi API hay đăng nhập cho tới khi Quản trị viên mở khóa.
                </div>
                <div>
                  <label className="form-label">Lý do chặn IP (Hiển thị trên màn hình máy bị chặn) *</label>
                  <textarea
                    rows={3}
                    className="form-control"
                    value={blockReason}
                    onChange={(e) => setBlockReason(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setBlockingIpTarget(null)}>
                  Hủy
                </button>
                <button type="submit" className="btn btn-danger" disabled={processingAction}>
                  {processingAction ? <Loader2 size={15} className="animate-spin" /> : <ShieldBan size={15} />}
                  Xác nhận Chặn IP
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
