import React, { useState, useEffect, useMemo } from 'react'
import {
  Users, Briefcase, Plus, Edit3, Lock, Unlock, Trash2, Shield,
  Search, RefreshCw, Loader2, X, Save, Stethoscope
} from 'lucide-react'
import { api } from '../../services/api'
import { hasPerm, getRoleMeta, PermBadge } from '../../utils/permissions'
import UserPermissionsModal from '../../components/admin/UserPermissionsModal'
import PositionPermissionsModal from '../../components/admin/PositionPermissionsModal'

function slugifyCode(str) {
  if (!str) return ''
  return str
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()
}

export default function UsersPage({ currentUser, onUserChanged }) {
  const canManageUsers = hasPerm(currentUser, 'PERM_ORG_USER_MANAGE')
  const canManagePositions = hasPerm(currentUser, 'PERM_ORG_POSITION_MANAGE') || canManageUsers
  const canManagePerms = hasPerm(currentUser, 'PERM_ORG_PERMISSION_MANAGE') || canManageUsers

  const [activeTab, setActiveTab] = useState(canManageUsers ? 'USERS' : 'POSITIONS')
  const [users, setUsers] = useState([])
  const [positions, setPositions] = useState([])
  const [departments, setDepartments] = useState([])
  const [loading, setLoading] = useState(false)
  const [banner, setBanner] = useState(null)

  // Filters Tab Users
  const [userSearch, setUserSearch] = useState('')
  const [userDeptFilter, setUserDeptFilter] = useState('')
  const [userRoleFilter, setUserRoleFilter] = useState('ALL')
  const [userStatusFilter, setUserStatusFilter] = useState('ALL') // ALL | ACTIVE | LOCKED

  // Filters Tab Positions
  const [posSearch, setPosSearch] = useState('')
  const [posDeptFilter, setPosDeptFilter] = useState('')

  // Modal User Create/Edit
  const [editingUser, setEditingUser] = useState(null) // null | {} | userObj
  const [userForm, setUserForm] = useState({
    username: '',
    password: '',
    full_name: '',
    cchn: '',
    email: '',
    phone: '',
    role: 'staff',
    position_id: '',
    department_ids: [],
    is_active: true
  })
  const [savingUser, setSavingUser] = useState(false)

  // Modal Position Create/Edit
  const [editingPos, setEditingPos] = useState(null) // null | {} | posObj
  const [posForm, setPosForm] = useState({
    name: '',
    code: '',
    department_id: '',
    description: '',
    is_active: true
  })
  const [codeManuallyEdited, setCodeManuallyEdited] = useState(false)
  const [savingPos, setSavingPos] = useState(false)

  // Permission Modals
  const [permModalUser, setPermModalUser] = useState(null)
  const [permModalPos, setPermModalPos] = useState(null)

  useEffect(() => {
    loadAllData()
  }, [])

  const loadAllData = async () => {
    setLoading(true)
    try {
      const [deptRes, posRes, userRes] = await Promise.all([
        api.getDepartments(false),
        api.getPositions({ include_inactive: true }),
        canManageUsers || canManagePerms ? api.getUsers({ include_inactive: true }) : Promise.resolve([])
      ])
      setDepartments(deptRes || [])
      setPositions(posRes || [])
      setUsers(userRes || [])
    } catch (err) {
      setBanner({
        type: 'error',
        text: err.response?.data?.detail || err.message || 'Lỗi tải dữ liệu nhân sự & chức vụ'
      })
    } finally {
      setLoading(false)
    }
  }

  // ─── FILTERED LISTS ────────────────────────────────────────────────────────
  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase()
    return users.filter((u) => {
      if (userStatusFilter === 'ACTIVE' && !u.is_active) return false
      if (userStatusFilter === 'LOCKED' && u.is_active) return false
      if (userRoleFilter !== 'ALL' && u.role !== userRoleFilter) return false
      if (userDeptFilter && !(u.department_ids || []).includes(Number(userDeptFilter))) return false
      if (!q) return true
      return (
        u.username.toLowerCase().includes(q) ||
        u.full_name.toLowerCase().includes(q) ||
        (u.cchn || '').toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q) ||
        (u.phone || '').toLowerCase().includes(q) ||
        (u.position_name || '').toLowerCase().includes(q)
      )
    })
  }, [users, userSearch, userDeptFilter, userRoleFilter, userStatusFilter])

  const filteredPositions = useMemo(() => {
    const q = posSearch.trim().toLowerCase()
    return positions.filter((p) => {
      if (posDeptFilter === 'GLOBAL' && p.department_id !== null) return false
      if (posDeptFilter && posDeptFilter !== 'GLOBAL' && p.department_id !== Number(posDeptFilter)) return false
      if (!q) return true
      return (
        p.name.toLowerCase().includes(q) ||
        p.code.toLowerCase().includes(q) ||
        (p.department_name || '').toLowerCase().includes(q)
      )
    })
  }, [positions, posSearch, posDeptFilter])

  // Danh sách chức vụ hợp lệ với các Khoa/Phòng đang chọn trong form User
  const selectablePositionsForUserForm = useMemo(() => {
    const selectedDeptSet = new Set((userForm.department_ids || []).map(Number))
    return positions.filter((p) => {
      if (!p.is_active && Number(userForm.position_id) !== p.id) return false
      if (!p.department_id) return true // Chức vụ toàn viện
      if (selectedDeptSet.size === 0) return true
      return selectedDeptSet.has(p.department_id)
    })
  }, [positions, userForm.department_ids, userForm.position_id])

  // ─── USER CRUD HANDLERS ────────────────────────────────────────────────────
  const openCreateUser = () => {
    setUserForm({
      username: '',
      password: '',
      full_name: '',
      cchn: '',
      email: '',
      phone: '',
      role: 'staff',
      position_id: '',
      department_ids: departments[0]?.id ? [departments[0].id] : [],
      is_active: true
    })
    setEditingUser({})
  }

  const openEditUser = (u) => {
    setUserForm({
      username: u.username,
      password: '',
      full_name: u.full_name || '',
      cchn: u.cchn || '',
      email: u.email || '',
      phone: u.phone || '',
      role: u.role || 'staff',
      position_id: u.position_id ? String(u.position_id) : '',
      department_ids: [...(u.department_ids || [])],
      is_active: Boolean(u.is_active)
    })
    setEditingUser(u)
  }

  const toggleUserDept = (deptId) => {
    const cur = new Set(userForm.department_ids.map(Number))
    if (cur.has(deptId)) cur.delete(deptId)
    else cur.add(deptId)
    const nextDepts = Array.from(cur)

    // Nếu chức vụ hiện tại thuộc phòng vừa bị bỏ chọn thì xóa chọn chức vụ
    let nextPosId = userForm.position_id
    if (nextPosId) {
      const posObj = positions.find((p) => p.id === Number(nextPosId))
      if (posObj?.department_id && nextDepts.length > 0 && !nextDepts.includes(posObj.department_id)) {
        nextPosId = ''
      }
    }
    setUserForm({ ...userForm, department_ids: nextDepts, position_id: nextPosId })
  }

  const handleSaveUser = async (e) => {
    e.preventDefault()
    setSavingUser(true)
    setBanner(null)
    try {
      if (editingUser?.id) {
        const payload = {
          full_name: userForm.full_name,
          cchn: userForm.cchn,
          email: userForm.email,
          phone: userForm.phone,
          role: userForm.role,
          position_id: userForm.position_id ? Number(userForm.position_id) : 0,
          clear_position: !userForm.position_id,
          department_ids: userForm.department_ids,
          is_active: userForm.is_active
        }
        if (userForm.password.trim()) {
          payload.password = userForm.password.trim()
        }
        await api.updateUser(editingUser.id, payload)
        setBanner({ type: 'success', text: `Đã cập nhật tài khoản '${userForm.full_name}' (@${userForm.username}).` })
      } else {
        await api.createUser({
          username: userForm.username,
          password: userForm.password,
          full_name: userForm.full_name,
          cchn: userForm.cchn,
          email: userForm.email,
          phone: userForm.phone,
          role: userForm.role,
          position_id: userForm.position_id ? Number(userForm.position_id) : null,
          department_ids: userForm.department_ids,
          is_active: userForm.is_active
        })
        setBanner({ type: 'success', text: `Đã tạo tài khoản '${userForm.username}' thành công.` })
      }
      setEditingUser(null)
      await loadAllData()
      onUserChanged?.()
    } catch (err) {
      setBanner({ type: 'error', text: err.response?.data?.detail || err.message || 'Lỗi lưu tài khoản' })
    } finally {
      setSavingUser(false)
    }
  }

  const handleToggleUserActive = async (u) => {
    const actionLabel = u.is_active ? 'KHÓA' : 'MỞ KHÓA'
    if (!window.confirm(`${actionLabel} tài khoản "${u.full_name}" (@${u.username})?`)) return
    try {
      await api.updateUser(u.id, { is_active: !u.is_active })
      setBanner({
        type: u.is_active ? 'warning' : 'success',
        text: `Đã ${u.is_active ? 'khóa' : 'mở khóa'} tài khoản @${u.username}.`
      })
      await loadAllData()
    } catch (err) {
      setBanner({ type: 'error', text: err.response?.data?.detail || err.message })
    }
  }

  const handleDeleteUser = async (u) => {
    if (!window.confirm(`XÓA VĨNH VIỄN tài khoản "${u.full_name}" (@${u.username})?`)) return
    try {
      await api.deleteUser(u.id)
      setBanner({ type: 'success', text: `Đã xóa vĩnh viễn tài khoản @${u.username}.` })
      await loadAllData()
    } catch (err) {
      setBanner({ type: 'error', text: err.response?.data?.detail || err.message })
    }
  }

  // ─── POSITION CRUD HANDLERS ────────────────────────────────────────────────
  const openCreatePosition = () => {
    setPosForm({ name: '', code: '', department_id: '', description: '', is_active: true })
    setCodeManuallyEdited(false)
    setEditingPos({})
  }

  const openEditPosition = (p) => {
    setPosForm({
      name: p.name || '',
      code: p.code || '',
      department_id: p.department_id ? String(p.department_id) : '',
      description: p.description || '',
      is_active: Boolean(p.is_active)
    })
    setCodeManuallyEdited(true)
    setEditingPos(p)
  }

  const autoBuildPositionCode = (nameVal, deptIdVal) => {
    const dept = departments.find((d) => String(d.id) === String(deptIdVal))
    const prefix = dept ? slugifyCode(dept.name_en || dept.name) : 'BV'
    const body = slugifyCode(nameVal)
    return body ? `${prefix}_${body}`.slice(0, 48) : ''
  }

  const handleSavePosition = async (e) => {
    e.preventDefault()
    setSavingPos(true)
    setBanner(null)
    try {
      if (editingPos?.id) {
        await api.updatePosition(editingPos.id, {
          name: posForm.name,
          code: posForm.code,
          department_id: posForm.department_id ? Number(posForm.department_id) : 0,
          clear_department: !posForm.department_id,
          description: posForm.description,
          is_active: posForm.is_active
        })
        setBanner({ type: 'success', text: `Đã cập nhật chức vụ '${posForm.name}'.` })
      } else {
        await api.createPosition({
          name: posForm.name,
          code: posForm.code || undefined,
          department_id: posForm.department_id ? Number(posForm.department_id) : null,
          description: posForm.description,
          is_active: posForm.is_active
        })
        setBanner({ type: 'success', text: `Đã tạo chức vụ '${posForm.name}' thành công.` })
      }
      setEditingPos(null)
      await loadAllData()
      onUserChanged?.()
    } catch (err) {
      setBanner({ type: 'error', text: err.response?.data?.detail || err.message || 'Lỗi lưu chức vụ' })
    } finally {
      setSavingPos(false)
    }
  }

  const handleTogglePosActive = async (p) => {
    try {
      await api.updatePosition(p.id, { is_active: !p.is_active })
      await loadAllData()
      onUserChanged?.()
    } catch (err) {
      setBanner({ type: 'error', text: err.response?.data?.detail || err.message })
    }
  }

  const handleDeletePos = async (p) => {
    if (!window.confirm(`Xóa chức vụ "${p.name}" (${p.code})?`)) return
    try {
      await api.deletePosition(p.id)
      setBanner({ type: 'success', text: `Đã xóa chức vụ '${p.name}'.` })
      await loadAllData()
    } catch (err) {
      setBanner({ type: 'error', text: err.response?.data?.detail || err.message })
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {/* Header */}
      <div className="page-header-bar" style={{ marginBottom: 0 }}>
        <div>
          <h2 className="page-title">
            <Users size={22} color="#0284c7" />
            Quản lý Người dùng & Danh mục Chức vụ
            <PermBadge code="PERM_ORG_USER_MANAGE" />
          </h2>
          <p className="page-subtitle">
            Quản lý cán bộ, Bác sĩ KSK (Số CCHN), phân công Khoa/Phòng - Chức vụ và cấu hình Ma trận Phân quyền 3 tầng (A ∪ B ∪ C).
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button type="button" className="btn btn-secondary" onClick={loadAllData} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Làm mới
          </button>

          {activeTab === 'USERS' && canManageUsers && (
            <button type="button" className="btn btn-primary" onClick={openCreateUser}>
              <Plus size={16} /> Thêm Người Dùng
              <PermBadge code="PERM_ORG_USER_MANAGE" />
            </button>
          )}

          {activeTab === 'POSITIONS' && canManagePositions && (
            <button type="button" className="btn btn-indigo" onClick={openCreatePosition}>
              <Plus size={16} /> Thêm Chức Vụ
              <PermBadge code="PERM_ORG_POSITION_MANAGE" />
            </button>
          )}
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

      {/* Switcher 2 Tabs: Người dùng | Danh mục Chức vụ */}
      <div style={{
        background: '#fff', border: '1px solid var(--border)', borderRadius: '10px', padding: '12px 16px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px'
      }}>
        <div className="admin-tabs">
          {(canManageUsers || canManagePerms) && (
            <button
              type="button"
              className={`admin-tab-btn ${activeTab === 'USERS' ? 'active' : ''}`}
              onClick={() => setActiveTab('USERS')}
            >
              <Users size={15} /> Danh sách Người dùng ({users.length})
            </button>
          )}
          <button
            type="button"
            className={`admin-tab-btn ${activeTab === 'POSITIONS' ? 'active' : ''}`}
            onClick={() => setActiveTab('POSITIONS')}
          >
            <Briefcase size={15} /> Danh mục Chức vụ ({positions.length})
          </button>
        </div>

        {/* Bộ lọc theo từng Tab */}
        {activeTab === 'USERS' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', width: '250px' }}>
              <Search size={14} color="#94a3b8" style={{ position: 'absolute', left: '10px', top: '9px' }} />
              <input
                type="text"
                className="form-control"
                style={{ paddingLeft: '30px' }}
                placeholder="Tên, @username, CCHN, SĐT..."
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
              />
            </div>

            <select
              className="form-control"
              style={{ width: '190px' }}
              value={userDeptFilter}
              onChange={(e) => setUserDeptFilter(e.target.value)}
            >
              <option value="">Tất cả Khoa / Phòng</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>

            <select
              className="form-control"
              style={{ width: '155px' }}
              value={userRoleFilter}
              onChange={(e) => setUserRoleFilter(e.target.value)}
            >
              <option value="ALL">Mọi vai trò</option>
              <option value="admin">👑 Admin</option>
              <option value="truong_phong">⭐ Trưởng phòng</option>
              <option value="staff">👤 Nhân viên</option>
            </select>

            <select
              className="form-control"
              style={{ width: '145px' }}
              value={userStatusFilter}
              onChange={(e) => setUserStatusFilter(e.target.value)}
            >
              <option value="ALL">Mọi trạng thái</option>
              <option value="ACTIVE">🟢 Hoạt động</option>
              <option value="LOCKED">🔒 Đã khóa</option>
            </select>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', width: '260px' }}>
              <Search size={14} color="#94a3b8" style={{ position: 'absolute', left: '10px', top: '9px' }} />
              <input
                type="text"
                className="form-control"
                style={{ paddingLeft: '30px' }}
                placeholder="Tìm tên chức vụ hoặc mã..."
                value={posSearch}
                onChange={(e) => setPosSearch(e.target.value)}
              />
            </div>

            <select
              className="form-control"
              style={{ width: '220px' }}
              value={posDeptFilter}
              onChange={(e) => setPosDeptFilter(e.target.value)}
            >
              <option value="">Tất cả phạm vi Khoa / Phòng</option>
              <option value="GLOBAL">🌐 Chức vụ dùng chung toàn viện</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* ─── TAB 1: DANH SÁCH NGƯỜI DÙNG ─────────────────────────────────────── */}
      {activeTab === 'USERS' && (
        <div className="data-table-container">
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Nhân sự / Tài khoản</th>
                  <th>Số CCHN (Y khoa)</th>
                  <th>Khoa / Phòng & Chức vụ</th>
                  <th>Vai trò</th>
                  <th>Quyền hiệu lực (A∪B∪C)</th>
                  <th>Trạng thái</th>
                  <th style={{ textAlign: 'right' }}>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {loading && users.length === 0 ? (
                  <tr>
                    <td colSpan="7" style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>
                      <Loader2 size={24} className="animate-spin" style={{ margin: '0 auto 8px' }} />
                      Đang tải danh sách nhân sự...
                    </td>
                  </tr>
                ) : filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan="7" style={{ textAlign: 'center', padding: '36px', color: '#64748b' }}>
                      Không tìm thấy tài khoản nào khớp bộ lọc.
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((u) => {
                    const roleMeta = getRoleMeta(u.role)
                    const isSelf = u.id === currentUser?.id
                    return (
                      <tr key={u.id} style={{ opacity: u.is_active ? 1 : 0.68 }}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <div style={{
                              width: '34px', height: '34px', borderRadius: '50%',
                              background: u.is_admin ? 'linear-gradient(135deg, #7c3aed, #4f46e5)' : '#e0f2fe',
                              color: u.is_admin ? '#fff' : '#0369a1',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontWeight: 800, fontSize: '13px', flexShrink: 0
                            }}>
                              {(u.full_name || u.username).charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <div style={{ fontWeight: 700, color: '#0f172a' }}>
                                {u.full_name} {isSelf && <span className="badge badge-info" style={{ fontSize: '10px' }}>Bạn</span>}
                              </div>
                              <div style={{ fontSize: '11.5px', color: '#64748b', fontFamily: 'monospace' }}>
                                @{u.username} {u.phone ? `• ${u.phone}` : ''}
                              </div>
                            </div>
                          </div>
                        </td>

                        <td>
                          {u.cchn ? (
                            <span className="badge badge-info" style={{ fontFamily: 'monospace' }}>
                              <Stethoscope size={12} /> {u.cchn}
                            </span>
                          ) : (
                            <span style={{ color: '#94a3b8', fontSize: '12px' }}>--</span>
                          )}
                        </td>

                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                              {(u.departments || []).length > 0 ? (
                                u.departments.map((d) => (
                                  <span key={d.id} className="badge badge-neutral">
                                    🏢 {d.name}
                                  </span>
                                ))
                              ) : (
                                <span style={{ fontSize: '12px', color: '#94a3b8' }}>Chưa phân khoa</span>
                              )}
                            </div>
                            {u.position_name && (
                              <div style={{ fontSize: '12px', color: '#4338ca', fontWeight: 600 }}>
                                💼 {u.position_name}
                              </div>
                            )}
                          </div>
                        </td>

                        <td>
                          <span className={`badge ${roleMeta.badgeClass}`}>
                            {roleMeta.icon} {roleMeta.label}
                          </span>
                        </td>

                        <td>
                          {u.is_admin ? (
                            <span className="badge badge-purple">👑 Toàn quyền [0]</span>
                          ) : (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
                              <span className={`badge ${u.effective_permission_count > 0 ? 'badge-success' : 'badge-warning'}`}>
                                🔐 {u.effective_permission_count} quyền hiệu lực
                              </span>
                              {u.direct_permission_count > 0 && (
                                <span className="badge badge-warning" title="Quyền cấp riêng cá nhân (Tầng C)">
                                  +{u.direct_permission_count} riêng
                                </span>
                              )}
                            </div>
                          )}
                        </td>

                        <td>
                          {u.is_active ? (
                            <span className="badge badge-success">Hoạt động</span>
                          ) : (
                            <span className="badge badge-danger">Đã khóa</span>
                          )}
                        </td>

                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                            {canManagePerms && (
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() => setPermModalUser(u)}
                                title="Xem & Cấu hình Ma trận Phân quyền 3 Tầng (A ∪ B ∪ C)"
                              >
                                <Shield size={13} color="#16a34a" /> Phân quyền
                                <PermBadge code="PERM_ORG_PERMISSION_MANAGE" />
                              </button>
                            )}

                            {canManageUsers && (!u.is_admin || currentUser?.is_admin) && (
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() => openEditUser(u)}
                              >
                                <Edit3 size={13} /> Sửa
                              </button>
                            )}

                            {canManageUsers && !isSelf && (!u.is_admin || currentUser?.is_admin) && (
                              <>
                                <button
                                  type="button"
                                  className={`btn btn-sm ${u.is_active ? 'btn-warning' : 'btn-success'}`}
                                  onClick={() => handleToggleUserActive(u)}
                                  title={u.is_active ? 'Khóa tài khoản' : 'Mở khóa tài khoản'}
                                >
                                  {u.is_active ? <Lock size={13} /> : <Unlock size={13} />}
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-danger btn-sm"
                                  onClick={() => handleDeleteUser(u)}
                                  title="Xóa vĩnh viễn tài khoản"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── TAB 2: DANH MỤC CHỨC VỤ ─────────────────────────────────────────── */}
      {activeTab === 'POSITIONS' && (
        <div className="data-table-container">
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Mã Chức vụ</th>
                  <th>Tên Chức vụ</th>
                  <th>Khoa / Phòng trực thuộc</th>
                  <th>Nhân sự đảm nhiệm</th>
                  <th>Quyền hạn (Tầng A + Tầng B)</th>
                  <th>Trạng thái</th>
                  <th style={{ textAlign: 'right' }}>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {filteredPositions.length === 0 ? (
                  <tr>
                    <td colSpan="7" style={{ textAlign: 'center', padding: '36px', color: '#64748b' }}>
                      Chưa có chức vụ nào trong bộ lọc này.
                    </td>
                  </tr>
                ) : (
                  filteredPositions.map((p) => (
                    <tr key={p.id} style={{ opacity: p.is_active ? 1 : 0.65 }}>
                      <td>
                        <code style={{
                          background: '#f1f5f9', padding: '2px 7px', borderRadius: '5px',
                          fontWeight: 700, fontSize: '12px', color: '#334155'
                        }}>
                          {p.code}
                        </code>
                      </td>
                      <td>
                        <div style={{ fontWeight: 700, color: '#0f172a' }}>{p.name}</div>
                        {p.description && <div style={{ fontSize: '12px', color: '#64748b' }}>{p.description}</div>}
                      </td>
                      <td>
                        {p.department_name ? (
                          <span className="badge badge-info">🏢 {p.department_name}</span>
                        ) : (
                          <span className="badge badge-purple">🌐 Dùng chung toàn viện</span>
                        )}
                      </td>
                      <td>
                        <span className="badge badge-neutral">👥 {p.user_count} nhân sự</span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                          <span className="badge badge-info" title="Quyền kế thừa từ Khoa/Phòng (Tầng A)">
                            🔒 A: {p.inherited_permission_count}
                          </span>
                          <span className="badge badge-purple" title="Quyền đặc thù của Chức vụ (Tầng B)">
                            💼 B: +{p.direct_permission_count}
                          </span>
                          <span className="badge badge-success">
                            = {p.effective_permission_count} quyền
                          </span>
                        </div>
                      </td>
                      <td>
                        {p.is_active ? (
                          <span className="badge badge-success">Hoạt động</span>
                        ) : (
                          <span className="badge badge-warning">Tạm ngưng</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: '6px', justifyContent: 'flex-end' }}>
                          {canManagePerms && (
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => setPermModalPos(p)}
                            >
                              <Shield size={13} color="#4f46e5" /> Phân quyền
                              <PermBadge code="PERM_ORG_PERMISSION_MANAGE" />
                            </button>
                          )}
                          {canManagePositions && (
                            <>
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() => openEditPosition(p)}
                              >
                                <Edit3 size={13} /> Sửa
                              </button>
                              <button
                                type="button"
                                className="btn btn-warning btn-sm"
                                onClick={() => handleTogglePosActive(p)}
                                title={p.is_active ? 'Tạm ngưng chức vụ' : 'Kích hoạt lại'}
                              >
                                {p.is_active ? <Lock size={13} /> : <Unlock size={13} />}
                              </button>
                              <button
                                type="button"
                                className="btn btn-danger btn-sm"
                                onClick={() => handleDeletePos(p)}
                              >
                                <Trash2 size={13} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── MODAL THÊM / SỬA NGƯỜI DÙNG ─────────────────────────────────────── */}
      {editingUser !== null && (
        <div className="modal-backdrop" onClick={() => setEditingUser(null)}>
          <div className="modal-content" style={{ maxWidth: '640px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ fontWeight: 800, fontSize: '15px' }}>
                {editingUser?.id ? `Chỉnh sửa Nhân sự: ${editingUser.full_name} (@${editingUser.username})` : 'Thêm Tài khoản Nhân sự mới'}
              </div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditingUser(null)}>
                <X size={15} />
              </button>
            </div>
            <form onSubmit={handleSaveUser}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div>
                    <label className="form-label">Tên đăng nhập (Username) *</label>
                    <input
                      type="text"
                      className="form-control"
                      placeholder="VD: bs.hung, ksk01..."
                      value={userForm.username}
                      disabled={Boolean(editingUser?.id)}
                      onChange={(e) => setUserForm({ ...userForm, username: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <label className="form-label">
                      {editingUser?.id ? 'Đặt lại mật khẩu (Để trống nếu giữ nguyên)' : 'Mật khẩu khởi tạo *'}
                    </label>
                    <input
                      type="password"
                      className="form-control"
                      placeholder={editingUser?.id ? '••••••••' : 'Tối thiểu 4 ký tự'}
                      value={userForm.password}
                      onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
                      required={!editingUser?.id}
                    />
                  </div>

                  <div>
                    <label className="form-label">Họ và tên nhân sự / Bác sĩ *</label>
                    <input
                      type="text"
                      className="form-control"
                      placeholder="VD: BS.CKI Nguyễn Văn A"
                      value={userForm.full_name}
                      onChange={(e) => setUserForm({ ...userForm, full_name: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <label className="form-label">Số Chứng chỉ hành nghề (CCHN)</label>
                    <input
                      type="text"
                      className="form-control"
                      placeholder="VD: 001256/KG-CCHN"
                      value={userForm.cchn}
                      onChange={(e) => setUserForm({ ...userForm, cchn: e.target.value })}
                    />
                  </div>

                  <div>
                    <label className="form-label">Email liên hệ</label>
                    <input
                      type="email"
                      className="form-control"
                      placeholder="ten@bvbinhan.vn"
                      value={userForm.email}
                      onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="form-label">Số điện thoại</label>
                    <input
                      type="text"
                      className="form-control"
                      placeholder="0912..."
                      value={userForm.phone}
                      onChange={(e) => setUserForm({ ...userForm, phone: e.target.value })}
                    />
                  </div>

                  <div>
                    <label className="form-label">Vai trò hệ thống *</label>
                    <select
                      className="form-control"
                      value={userForm.role}
                      onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}
                    >
                      <option value="staff">👤 Nhân viên / Bác sĩ (staff)</option>
                      <option value="truong_phong">⭐ Trưởng Khoa / Phòng (truong_phong)</option>
                      {currentUser?.is_admin && (
                        <option value="admin">👑 Quản trị viên tối cao (admin)</option>
                      )}
                    </select>
                  </div>

                  <div>
                    <label className="form-label">Chức vụ đảm nhiệm (Tầng B)</label>
                    <select
                      className="form-control"
                      value={userForm.position_id}
                      onChange={(e) => {
                        const pid = e.target.value
                        const posObj = positions.find((p) => String(p.id) === pid)
                        let nextDepts = [...userForm.department_ids]
                        if (posObj?.department_id && !nextDepts.includes(posObj.department_id)) {
                          nextDepts.push(posObj.department_id)
                        }
                        setUserForm({ ...userForm, position_id: pid, department_ids: nextDepts })
                      }}
                    >
                      <option value="">-- Chưa chọn chức vụ --</option>
                      {selectablePositionsForUserForm.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.department_name || 'Toàn viện'})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Chọn nhiều Khoa / Phòng */}
                <div>
                  <label className="form-label">
                    Khoa / Phòng trực thuộc (Tầng A — Có thể chọn nhiều Khoa/Phòng)
                  </label>
                  <div style={{
                    border: '1px solid var(--border)', borderRadius: '8px', padding: '10px 12px',
                    maxHeight: '150px', overflowY: 'auto', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', background: '#f8fafc'
                  }}>
                    {departments.map((d) => {
                      const checked = userForm.department_ids.includes(d.id)
                      return (
                        <label
                          key={d.id}
                          style={{
                            display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer',
                            fontSize: '12.5px', fontWeight: checked ? 700 : 500, color: checked ? '#0284c7' : '#334155'
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleUserDept(d.id)}
                          />
                          <span>{d.name} {d.name_en ? `(${d.name_en})` : ''}</span>
                        </label>
                      )
                    })}
                  </div>
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setEditingUser(null)}>
                  Hủy
                </button>
                <button type="submit" className="btn btn-primary" disabled={savingUser}>
                  {savingUser ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                  {editingUser?.id ? 'Lưu Cập Nhật' : 'Tạo Tài Khoản'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── MODAL THÊM / SỬA CHỨC VỤ ────────────────────────────────────────── */}
      {editingPos !== null && (
        <div className="modal-backdrop" onClick={() => setEditingPos(null)}>
          <div className="modal-content" style={{ maxWidth: '520px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ fontWeight: 800, fontSize: '15px' }}>
                {editingPos?.id ? `Chỉnh sửa Chức vụ: ${editingPos.name}` : 'Thêm Chức vụ mới'}
              </div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditingPos(null)}>
                <X size={15} />
              </button>
            </div>
            <form onSubmit={handleSavePosition}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div>
                  <label className="form-label">Phạm vi Khoa / Phòng</label>
                  <select
                    className="form-control"
                    value={posForm.department_id}
                    onChange={(e) => {
                      const nextDeptId = e.target.value
                      const nextCode = !codeManuallyEdited
                        ? autoBuildPositionCode(posForm.name, nextDeptId)
                        : posForm.code
                      setPosForm({ ...posForm, department_id: nextDeptId, code: nextCode })
                    }}
                  >
                    <option value="">🌐 Chức vụ dùng chung toàn viện</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>🏢 {d.name} ({d.name_en || `KP${d.id}`})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="form-label">Tên Chức vụ *</label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="VD: Bác sĩ Kết luận KSK, Điều dưỡng..."
                    value={posForm.name}
                    onChange={(e) => {
                      const nextName = e.target.value
                      const nextCode = !codeManuallyEdited
                        ? autoBuildPositionCode(nextName, posForm.department_id)
                        : posForm.code
                      setPosForm({ ...posForm, name: nextName, code: nextCode })
                    }}
                    required
                  />
                </div>

                <div>
                  <label className="form-label">Mã định danh Chức vụ (Tự động gợi ý)</label>
                  <input
                    type="text"
                    className="form-control"
                    style={{ fontFamily: 'monospace', fontWeight: 700 }}
                    placeholder="VD: KKB_BAC_SI_KET_LUAN"
                    value={posForm.code}
                    onChange={(e) => {
                      setCodeManuallyEdited(true)
                      setPosForm({ ...posForm, code: e.target.value.toUpperCase() })
                    }}
                  />
                </div>

                <div>
                  <label className="form-label">Mô tả chức trách</label>
                  <textarea
                    rows={2}
                    className="form-control"
                    value={posForm.description}
                    onChange={(e) => setPosForm({ ...posForm, description: e.target.value })}
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setEditingPos(null)}>
                  Hủy
                </button>
                <button type="submit" className="btn btn-indigo" disabled={savingPos}>
                  {savingPos ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                  Lưu Chức Vụ
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Ma trận Phân quyền 3 Tầng Cá nhân */}
      <UserPermissionsModal
        isOpen={Boolean(permModalUser)}
        targetUser={permModalUser}
        onClose={() => setPermModalUser(null)}
        onSaved={() => {
          loadAllData()
          onUserChanged?.()
        }}
      />

      {/* Modal Phân quyền Chức vụ (Tầng B) */}
      <PositionPermissionsModal
        isOpen={Boolean(permModalPos)}
        position={permModalPos}
        onClose={() => setPermModalPos(null)}
        onSaved={() => {
          loadAllData()
          onUserChanged?.()
        }}
      />
    </div>
  )
}
