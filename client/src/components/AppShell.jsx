import React, { useState } from 'react'
import {
  ShieldCheck, Layers, History, BookOpen, Building2, Users,
  Landmark, Monitor, Download, Server, LogOut, PanelLeftClose,
  PanelLeftOpen, Eye, EyeOff, RefreshCw, Stethoscope, Briefcase, UserCog
} from 'lucide-react'
import { api, APP_CLIENT_VERSION } from '../services/api'
import {
  isAdminUser,
  hasPerm,
  hasAnyPerm,
  getRoleMeta,
  usePermissionDisplay,
  PermBadge
} from '../utils/permissions'

const STORAGE_SIDEBAR_KEY = 'ksk_gateway_sidebar_collapsed'

function getInitials(name, username) {
  const src = String(name || username || 'U').trim()
  const parts = src.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  }
  return src.slice(0, 2).toUpperCase()
}

export default function AppShell({
  user,
  activeNav,
  onSelectNav,
  portalConfig,
  serverConnected,
  updateInfo,
  onInstallUpdate,
  onOpenServerModal,
  onOpenProfileModal,
  onLogout,
  children
}) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_SIDEBAR_KEY) === 'true'
    } catch (e) {
      return false
    }
  })

  const { showPermCodes, togglePermCodes } = usePermissionDisplay()
  const isAdmin = isAdminUser(user)
  const roleMeta = getRoleMeta(user?.role)

  const toggleSidebar = () => {
    const next = !collapsed
    setCollapsed(next)
    try {
      localStorage.setItem(STORAGE_SIDEBAR_KEY, String(next))
    } catch (e) {}
  }

  // Xây dựng cấu trúc menu phân theo 3 nhóm nghiệp vụ & quản trị
  const navGroups = [
    {
      id: 'ksk',
      title: 'Nghiệp vụ KSK',
      items: [
        {
          id: 'WORKSPACE',
          label: 'Bàn làm việc Đẩy Cổng',
          icon: Layers,
          permCode: 'PERM_KSK_WORKSPACE_VIEW',
          visible: hasPerm(user, 'PERM_KSK_WORKSPACE_VIEW')
        },
        {
          id: 'HISTORY',
          label: 'Nhật ký Ký số & Đẩy Cổng',
          icon: History,
          permCode: 'PERM_KSK_HISTORY_VIEW',
          visible: hasPerm(user, 'PERM_KSK_HISTORY_VIEW')
        },
        {
          id: 'GUIDE',
          label: 'Quy chuẩn & Hướng dẫn',
          icon: BookOpen,
          permCode: null,
          visible: true
        }
      ]
    },
    {
      id: 'org',
      title: 'Tổ chức & Nhân sự',
      items: [
        {
          id: 'ADMIN_DEPTS',
          label: 'Khoa / Phòng',
          icon: Building2,
          permCode: 'PERM_ORG_DEPT_MANAGE',
          visible: hasPerm(user, 'PERM_ORG_DEPT_MANAGE')
        },
        {
          id: 'ADMIN_USERS',
          label: 'Người dùng & Chức vụ',
          icon: Users,
          permCode: 'PERM_ORG_USER_MANAGE',
          visible: hasAnyPerm(
            user,
            'PERM_ORG_USER_MANAGE',
            'PERM_ORG_POSITION_MANAGE',
            'PERM_ORG_PERMISSION_MANAGE'
          )
        }
      ]
    },
    {
      id: 'sys',
      title: 'Quản trị Hệ thống',
      items: [
        {
          id: 'ADMIN_PORTAL_CONFIG',
          label: 'Cấu hình Đơn vị & Cổng',
          icon: Landmark,
          permCode: 'PERM_SYS_PORTAL_CONFIG',
          visible: hasPerm(user, 'PERM_SYS_PORTAL_CONFIG')
        },
        {
          id: 'ADMIN_CLIENTS',
          label: 'Máy trạm kết nối',
          icon: Monitor,
          permCode: 'PERM_SYS_CLIENTS_MANAGE',
          visible: hasPerm(user, 'PERM_SYS_CLIENTS_MANAGE')
        }
      ]
    }
  ]

  const deptList = Array.isArray(user?.department_names)
    ? user.department_names.filter(Boolean)
    : []

  const hospitalName =
    portalConfig?.hospital?.ten_benh_vien || user?.hospital || 'Bệnh viện Đa khoa Bình An'
  const maCskcb = portalConfig?.hospital?.ma_cskcb || user?.ma_cskcb || '91034'

  return (
    <div className="app-shell-root">
      {/* ─── TOPBAR ──────────────────────────────────────────────────────────── */}
      <header className="app-topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
          <button
            type="button"
            onClick={toggleSidebar}
            title={collapsed ? 'Mở rộng thanh menu bên trái' : 'Thu gọn thanh menu bên trái'}
            style={{
              background: '#1e293b',
              border: '1px solid #334155',
              color: '#cbd5e1',
              width: '34px',
              height: '34px',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              flexShrink: 0
            }}
          >
            {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          </button>

          <div
            style={{
              width: '34px',
              height: '34px',
              borderRadius: '9px',
              background: 'linear-gradient(135deg, #0284c7, #4f46e5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}
          >
            <ShieldCheck size={20} color="#ffffff" />
          </div>

          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 800, fontSize: '14.5px', letterSpacing: '0.3px', color: '#ffffff' }}>
                KSK PORTAL GATEWAY
              </span>
              <span className="badge badge-info" style={{ fontSize: '10.5px', padding: '1px 7px' }}>
                v{APP_CLIENT_VERSION}
              </span>
              <span
                className={`badge ${serverConnected ? 'badge-success' : 'badge-danger'}`}
                style={{ fontSize: '10.5px', padding: '1px 7px' }}
              >
                {serverConnected ? '● Đã kết nối Server' : '● Mất kết nối Server'}
              </span>
            </div>
            <div
              style={{
                fontSize: '11px',
                color: '#94a3b8',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}
            >
              Đơn vị: <strong style={{ color: '#e2e8f0' }}>{hospitalName}</strong> • Mã CSKCB:{' '}
              <strong style={{ color: '#38bdf8' }}>{maCskcb}</strong>
            </div>
          </div>
        </div>

        {/* Cụm tiện ích bên phải TopBar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          {updateInfo?.hasUpdate && (
            <button
              type="button"
              className="btn btn-success"
              style={{ padding: '5px 10px', fontSize: '12px' }}
              onClick={onInstallUpdate}
              title={updateInfo.releaseNotes || 'Có phiên bản phần mềm mới từ máy chủ'}
            >
              <RefreshCw size={13} /> Cập nhật v{updateInfo.latestVersion}
            </button>
          )}

          {/* Nút bật/tắt Hiện mã quyền — CHỈ HIỂN THỊ CHO ADMIN */}
          {isAdmin && (
            <button
              type="button"
              onClick={togglePermCodes}
              title="Bật/tắt hiển thị nhãn mã quyền (PERM_*) trên các menu và nút thao tác để đối chiếu phân quyền"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '5px 11px',
                borderRadius: '7px',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
                border: showPermCodes ? '1px solid #f59e0b' : '1px solid #334155',
                background: showPermCodes ? 'rgba(245, 158, 11, 0.18)' : '#1e293b',
                color: showPermCodes ? '#fcd34d' : '#cbd5e1',
                transition: 'all 0.15s ease'
              }}
            >
              {showPermCodes ? <Eye size={14} color="#fbbf24" /> : <EyeOff size={14} />}
              <span>Hiện mã quyền</span>
              <span
                style={{
                  fontSize: '10px',
                  padding: '1px 5px',
                  borderRadius: '99px',
                  background: showPermCodes ? '#f59e0b' : '#334155',
                  color: showPermCodes ? '#0f172a' : '#94a3b8',
                  fontWeight: 800
                }}
              >
                {showPermCodes ? 'BẬT' : 'TẮT'}
              </span>
            </button>
          )}

          <a
            href={api.getTemplateDownloadUrl('xlsx')}
            target="_blank"
            rel="noreferrer"
            className="btn btn-secondary"
            style={{
              textDecoration: 'none',
              padding: '5px 9px',
              fontSize: '11.5px',
              background: '#1e293b',
              borderColor: '#334155',
              color: '#e2e8f0'
            }}
            title="Tải file Excel mẫu chuẩn import KSK"
          >
            <Download size={13} /> Mẫu Excel
          </a>

          <a
            href={api.getTemplateDownloadUrl('csv')}
            target="_blank"
            rel="noreferrer"
            className="btn btn-secondary"
            style={{
              textDecoration: 'none',
              padding: '5px 9px',
              fontSize: '11.5px',
              background: '#1e293b',
              borderColor: '#334155',
              color: '#e2e8f0'
            }}
            title="Tải file CSV mẫu chuẩn import KSK"
          >
            <Download size={13} /> Mẫu CSV
          </a>

          <button
            type="button"
            className="btn btn-secondary"
            style={{
              padding: '5px 10px',
              fontSize: '11.5px',
              background: '#1e293b',
              borderColor: '#334155',
              color: '#e2e8f0'
            }}
            onClick={onOpenServerModal}
            title={`Kết nối Server API: ${api.getServerUrl()}`}
          >
            <Server size={13} color="#38bdf8" /> Kết nối Server
          </button>
        </div>
      </header>

      {/* ─── BODY (SIDEBAR TRÁI + MAIN CONTENT) ──────────────────────────────── */}
      <div className="app-body">
        <aside className={`app-sidebar ${collapsed ? 'collapsed' : ''}`}>
          {/* Thẻ Hồ sơ Người dùng ở đầu Sidebar */}
          <div className="sidebar-profile-wrap">
            <div
              className="sidebar-profile-card"
              onClick={onOpenProfileModal}
              title="Bấm để cập nhật thông tin cá nhân, Số CCHN hoặc đổi mật khẩu"
              style={{
                padding: collapsed ? '8px 4px' : '10px 11px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: collapsed ? 'center' : 'stretch',
                gap: '8px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                <div className="sidebar-avatar">
                  {getInitials(user?.full_name, user?.username)}
                </div>
                {!collapsed && (
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: '13px',
                        color: '#f8fafc',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}
                    >
                      {user?.full_name || user?.username}
                    </div>
                    <div
                      style={{
                        fontSize: '11px',
                        color: '#94a3b8',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '4px'
                      }}
                    >
                      <span style={{ fontFamily: 'monospace' }}>@{user?.username}</span>
                      <UserCog size={12} color="#38bdf8" />
                    </div>
                  </div>
                )}
              </div>

              {!collapsed && (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                    paddingTop: '6px',
                    borderTop: '1px solid rgba(148, 163, 184, 0.16)',
                    fontSize: '11px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px' }}>
                    <span className={`badge ${roleMeta.badgeClass}`} style={{ fontSize: '10.5px', padding: '1px 7px' }}>
                      {roleMeta.icon} {roleMeta.label}
                    </span>
                    {user?.cchn && (
                      <span
                        style={{
                          fontSize: '10.5px',
                          color: '#67e8f9',
                          fontFamily: 'monospace',
                          fontWeight: 600,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '3px'
                        }}
                        title={`Số Chứng chỉ hành nghề: ${user.cchn}`}
                      >
                        <Stethoscope size={11} /> {user.cchn}
                      </span>
                    )}
                  </div>

                  {user?.position_name && (
                    <div
                      style={{
                        color: '#cbd5e1',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '5px',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}
                      title={`Chức vụ: ${user.position_name}`}
                    >
                      <Briefcase size={11} color="#a5b4fc" style={{ flexShrink: 0 }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.position_name}</span>
                    </div>
                  )}

                  {deptList.length > 0 && (
                    <div
                      style={{
                        color: '#94a3b8',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '5px',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}
                      title={`Khoa/Phòng: ${deptList.join(', ')}`}
                    >
                      <Building2 size={11} color="#38bdf8" style={{ flexShrink: 0 }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {deptList.join(', ')}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Danh sách Menu điều hướng theo quyền hiệu lực */}
          <nav className="sidebar-nav">
            {navGroups.map((group) => {
              const visibleItems = group.items.filter((it) => it.visible)
              if (visibleItems.length === 0) return null

              return (
                <div key={group.id} style={{ marginBottom: '8px' }}>
                  {!collapsed ? (
                    <div className="nav-section-title">{group.title}</div>
                  ) : (
                    <div style={{ height: '1px', background: '#1e293b', margin: '8px 6px' }} />
                  )}

                  {visibleItems.map((item) => {
                    const IconComp = item.icon
                    const isActive = activeNav === item.id

                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={`nav-item-btn ${isActive ? 'active' : ''}`}
                        onClick={() => onSelectNav(item.id)}
                        title={collapsed ? item.label : undefined}
                        style={{
                          justifyContent: collapsed ? 'center' : 'space-between',
                          padding: collapsed ? '10px 0' : '8.5px 11px',
                          flexWrap: collapsed ? 'nowrap' : 'wrap'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '9px', minWidth: 0 }}>
                          <IconComp
                            size={17}
                            color={isActive ? '#38bdf8' : '#94a3b8'}
                            style={{ flexShrink: 0 }}
                          />
                          {!collapsed && (
                            <span
                              style={{
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis'
                              }}
                            >
                              {item.label}
                            </span>
                          )}
                        </div>

                        {!collapsed && item.permCode && (
                          <PermBadge code={item.permCode} style={{ marginLeft: 'auto' }} />
                        )}
                      </button>
                    )
                  })}
                </div>
              )
            })}
          </nav>

          {/* Footer của Sidebar */}
          <div className="sidebar-footer">
            {!collapsed && (
              <div
                style={{
                  fontSize: '10.5px',
                  color: '#64748b',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '6px'
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  API: {api.getServerUrl()}
                </span>
                <span style={{ fontFamily: 'monospace', color: '#94a3b8' }}>v{APP_CLIENT_VERSION}</span>
              </div>
            )}

            <button
              type="button"
              onClick={onLogout}
              title="Đăng xuất khỏi phiên làm việc hiện tại"
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '7px',
                padding: '7.5px 10px',
                borderRadius: '8px',
                border: '1px solid rgba(239, 68, 68, 0.35)',
                background: 'rgba(239, 68, 68, 0.12)',
                color: '#fca5a5',
                fontSize: '12.5px',
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              <LogOut size={15} />
              {!collapsed && <span>Đăng xuất</span>}
            </button>
          </div>
        </aside>

        {/* Vùng nội dung chính */}
        <main className="app-main-scroll">
          <div style={{ maxWidth: '1600px', width: '100%', margin: '0 auto' }}>
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
