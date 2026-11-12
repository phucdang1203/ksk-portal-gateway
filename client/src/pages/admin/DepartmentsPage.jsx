import React, { useState, useEffect, useMemo } from 'react'
import {
  Building2, Plus, Edit3, Lock, RotateCcw, Trash2, Shield, Users,
  Star, Search, RefreshCw, Loader2, X, Save, AlertTriangle
} from 'lucide-react'
import { api } from '../../services/api'
import { hasPerm, PermBadge } from '../../utils/permissions'
import DepartmentPermissionsModal from '../../components/admin/DepartmentPermissionsModal'

export default function DepartmentsPage({ currentUser, onUserChanged }) {
  const [departments, setDepartments] = useState([])
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState('ACTIVE') // ACTIVE | LOCKED
  const [search, setSearch] = useState('')
  const [banner, setBanner] = useState(null)

  // Modal Thêm / Sửa Khoa/Phòng
  const [editingDept, setEditingDept] = useState(null) // null | {} | deptObj
  const [form, setForm] = useState({ name: '', name_en: '', description: '' })
  const [saving, setSaving] = useState(false)

  // Modal Gán Trưởng phòng
  const [headModalDept, setHeadModalDept] = useState(null)
  const [selectedHeadId, setSelectedHeadId] = useState('')
  const [assigningHead, setAssigningHead] = useState(false)

  // Modal Phân quyền Tầng A
  const [permModalDept, setPermModalDept] = useState(null)

  const canManageDept = hasPerm(currentUser, 'PERM_ORG_DEPT_MANAGE')
  const canManagePerm = hasPerm(currentUser, 'PERM_ORG_PERMISSION_MANAGE') || canManageDept

  useEffect(() => {
    loadDepartments()
  }, [])

  const loadDepartments = async () => {
    setLoading(true)
    try {
      const list = await api.getDepartments(true)
      setDepartments(list || [])
    } catch (err) {
      setBanner({
        type: 'error',
        text: err.response?.data?.detail || err.message || 'Không thể tải danh sách Khoa/Phòng'
      })
    } finally {
      setLoading(false)
    }
  }

  const activeList = useMemo(() => departments.filter((d) => d.is_active), [departments])
  const lockedList = useMemo(() => departments.filter((d) => !d.is_active), [departments])

  const filteredList = useMemo(() => {
    const src = tab === 'ACTIVE' ? activeList : lockedList
    const q = search.trim().toLowerCase()
    if (!q) return src
    return src.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        (d.name_en || '').toLowerCase().includes(q) ||
        (d.description || '').toLowerCase().includes(q) ||
        (d.head_of_department_name || '').toLowerCase().includes(q)
    )
  }, [tab, activeList, lockedList, search])

  const openCreateModal = () => {
    setForm({ name: '', name_en: '', description: '' })
    setEditingDept({})
  }

  const openEditModal = (dept) => {
    setForm({
      name: dept.name || '',
      name_en: dept.name_en || '',
      description: dept.description || ''
    })
    setEditingDept(dept)
  }

  const handleSaveDept = async (e) => {
    e.preventDefault()
    setSaving(true)
    setBanner(null)
    try {
      if (editingDept?.id) {
        await api.updateDepartment(editingDept.id, form)
        setBanner({ type: 'success', text: `Đã cập nhật thông tin '${form.name}' thành công.` })
      } else {
        await api.createDepartment(form)
        setBanner({ type: 'success', text: `Đã thêm Khoa/Phòng '${form.name}' thành công.` })
      }
      setEditingDept(null)
      await loadDepartments()
      onUserChanged?.()
    } catch (err) {
      setBanner({
        type: 'error',
        text: err.response?.data?.detail || err.message || 'Lỗi khi lưu Khoa/Phòng'
      })
    } finally {
      setSaving(false)
    }
  }

  const handleLockDept = async (dept) => {
    if (!window.confirm(`Khóa tạm thời Khoa/Phòng "${dept.name}"? (Có thể khôi phục lại từ tab Đã khóa)`)) return
    try {
      await api.lockDepartment(dept.id)
      setBanner({ type: 'warning', text: `Đã chuyển "${dept.name}" sang danh sách Đã khóa.` })
      await loadDepartments()
      onUserChanged?.()
    } catch (err) {
      setBanner({ type: 'error', text: err.response?.data?.detail || err.message })
    }
  }

  const handleRestoreDept = async (dept) => {
    try {
      await api.restoreDepartment(dept.id)
      setBanner({ type: 'success', text: `Đã khôi phục Khoa/Phòng "${dept.name}" hoạt động trở lại.` })
      await loadDepartments()
      onUserChanged?.()
    } catch (err) {
      setBanner({ type: 'error', text: err.response?.data?.detail || err.message })
    }
  }

  const handlePurgeDept = async (dept) => {
    if (!window.confirm(`XÓA VĨNH VIỄN Khoa/Phòng "${dept.name}"? Hành động này không thể hoàn tác!`)) return
    try {
      await api.purgeDepartment(dept.id)
      setBanner({ type: 'success', text: `Đã xóa vĩnh viễn Khoa/Phòng "${dept.name}".` })
      await loadDepartments()
    } catch (err) {
      setBanner({ type: 'error', text: err.response?.data?.detail || err.message })
    }
  }

  const openAssignHeadModal = (dept) => {
    setHeadModalDept(dept)
    setSelectedHeadId(dept.head_of_department_id ? String(dept.head_of_department_id) : '')
  }

  const handleAssignHead = async (e) => {
    e.preventDefault()
    if (!headModalDept || !selectedHeadId) return
    setAssigningHead(true)
    try {
      const res = await api.assignDepartmentHead(headModalDept.id, Number(selectedHeadId))
      setBanner({ type: 'success', text: res.message })
      setHeadModalDept(null)
      await loadDepartments()
      onUserChanged?.()
    } catch (err) {
      setBanner({ type: 'error', text: err.response?.data?.detail || err.message })
    } finally {
      setAssigningHead(false)
    }
  }

  const totalMembersAssigned = useMemo(() => {
    const ids = new Set()
    activeList.forEach((d) => (d.members || []).forEach((m) => { if (m.is_active) ids.add(m.id) }))
    return ids.size
  }, [activeList])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {/* Header */}
      <div className="page-header-bar" style={{ marginBottom: 0 }}>
        <div>
          <h2 className="page-title">
            <Building2 size={22} color="#0284c7" />
            Quản lý Khoa / Phòng
            <PermBadge code="PERM_ORG_DEPT_MANAGE" />
          </h2>
          <p className="page-subtitle">
            Cấu hình cơ cấu Khoa/Phòng bệnh viện, bổ nhiệm Trưởng khoa/phòng và thiết lập bộ quyền nền (Tầng A).
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button type="button" className="btn btn-secondary" onClick={loadDepartments} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Làm mới
          </button>
          {canManageDept && (
            <button type="button" className="btn btn-primary" onClick={openCreateModal}>
              <Plus size={16} /> Thêm Khoa / Phòng
              <PermBadge code="PERM_ORG_DEPT_MANAGE" />
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

      {/* Stat Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
        <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: '10px', padding: '12px 16px' }}>
          <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>Khoa/Phòng đang hoạt động</div>
          <div style={{ fontSize: '22px', fontWeight: 800, color: '#0284c7', marginTop: '2px' }}>{activeList.length}</div>
        </div>
        <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: '10px', padding: '12px 16px' }}>
          <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>Nhân sự đã phân khoa</div>
          <div style={{ fontSize: '22px', fontWeight: 800, color: '#16a34a', marginTop: '2px' }}>{totalMembersAssigned}</div>
        </div>
        <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: '10px', padding: '12px 16px' }}>
          <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>Phòng hệ thống bảo vệ</div>
          <div style={{ fontSize: '22px', fontWeight: 800, color: '#4f46e5', marginTop: '2px' }}>
            {activeList.filter((d) => d.is_system).length}
          </div>
        </div>
        <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: '10px', padding: '12px 16px' }}>
          <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>Khoa/Phòng đã khóa</div>
          <div style={{ fontSize: '22px', fontWeight: 800, color: '#d97706', marginTop: '2px' }}>{lockedList.length}</div>
        </div>
      </div>

      {/* Tabs + Search */}
      <div style={{
        background: '#fff', border: '1px solid var(--border)', borderRadius: '10px', padding: '12px 16px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px'
      }}>
        <div className="admin-tabs">
          <button
            type="button"
            className={`admin-tab-btn ${tab === 'ACTIVE' ? 'active' : ''}`}
            onClick={() => setTab('ACTIVE')}
          >
            🟢 Đang hoạt động ({activeList.length})
          </button>
          <button
            type="button"
            className={`admin-tab-btn ${tab === 'LOCKED' ? 'active' : ''}`}
            onClick={() => setTab('LOCKED')}
          >
            🔒 Đã khóa / Lưu trữ ({lockedList.length})
          </button>
        </div>

        <div style={{ position: 'relative', width: '320px', maxWidth: '100%' }}>
          <Search size={15} color="#94a3b8" style={{ position: 'absolute', left: '10px', top: '9px' }} />
          <input
            type="text"
            className="form-control"
            style={{ paddingLeft: '32px' }}
            placeholder="Tìm tên Khoa/Phòng, mã viết tắt, Trưởng khoa..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Bảng Khoa / Phòng */}
      <div className="data-table-container">
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Mã</th>
                <th>Tên Khoa / Phòng</th>
                <th>Trưởng Khoa / Phòng</th>
                <th>Nhân sự & Chức vụ</th>
                <th>Quyền Tầng A (Khoa/Phòng)</th>
                <th style={{ textAlign: 'right' }}>Thao tác quản trị</th>
              </tr>
            </thead>
            <tbody>
              {loading && departments.length === 0 ? (
                <tr>
                  <td colSpan="6" style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>
                    <Loader2 size={24} className="animate-spin" style={{ margin: '0 auto 8px' }} />
                    Đang tải danh sách Khoa/Phòng...
                  </td>
                </tr>
              ) : filteredList.length === 0 ? (
                <tr>
                  <td colSpan="6" style={{ textAlign: 'center', padding: '36px', color: '#64748b' }}>
                    Không có Khoa/Phòng nào trong danh sách này.
                  </td>
                </tr>
              ) : (
                filteredList.map((dept) => {
                  const candidateMembers = (dept.members || []).filter(
                    (m) => m.is_active && m.role !== 'admin'
                  )
                  return (
                    <tr key={dept.id}>
                      <td>
                        <span className="badge badge-info" style={{ fontFamily: 'monospace', fontWeight: 800 }}>
                          {dept.name_en || `KP${dept.id}`}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 700, color: '#0f172a', fontSize: '13.5px' }}>{dept.name}</span>
                          {dept.is_system && (
                            <span className="badge badge-purple" title="Phòng ban mặc định của hệ thống (không thể đổi tên hoặc xóa)">
                              🔒 Hệ thống
                            </span>
                          )}
                          {!dept.is_active && <span className="badge badge-warning">Đã khóa</span>}
                        </div>
                        {dept.description && (
                          <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>{dept.description}</div>
                        )}
                      </td>
                      <td>
                        {dept.head_user ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span className="badge badge-warning">
                              <Star size={12} /> {dept.head_user.full_name}
                            </span>
                          </div>
                        ) : (
                          <span style={{ fontSize: '12px', color: '#94a3b8' }}>Chưa bổ nhiệm</span>
                        )}
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                          <span className="badge badge-neutral">
                            <Users size={12} /> {dept.member_count} nhân sự
                          </span>
                          <span className="badge badge-neutral">
                            💼 {dept.position_count} chức vụ
                          </span>
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span className={`badge ${dept.permission_count > 0 ? 'badge-success' : 'badge-neutral'}`}>
                            🔐 {dept.permission_count} quyền Tầng A
                          </span>
                        </div>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                          {dept.is_active && canManagePerm && (
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => setPermModalDept(dept)}
                              title="Cấu hình bộ quyền mặc định Tầng A cho Khoa/Phòng này"
                            >
                              <Shield size={13} color="#0284c7" /> Phân quyền
                              <PermBadge code="PERM_ORG_PERMISSION_MANAGE" />
                            </button>
                          )}

                          {dept.is_active && canManageDept && candidateMembers.length > 0 && (
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => openAssignHeadModal(dept)}
                              title="Bổ nhiệm Trưởng Khoa/Phòng"
                            >
                              <Star size={13} color="#d97706" /> Trưởng phòng
                            </button>
                          )}

                          {dept.is_active && canManageDept && (
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => openEditModal(dept)}
                            >
                              <Edit3 size={13} /> Sửa
                            </button>
                          )}

                          {dept.is_active && canManageDept && !dept.is_system && (
                            <button
                              type="button"
                              className="btn btn-warning btn-sm"
                              onClick={() => handleLockDept(dept)}
                              title="Khóa mềm Khoa/Phòng"
                            >
                              <Lock size={13} /> Khóa
                            </button>
                          )}

                          {!dept.is_active && canManageDept && (
                            <>
                              <button
                                type="button"
                                className="btn btn-success btn-sm"
                                onClick={() => handleRestoreDept(dept)}
                              >
                                <RotateCcw size={13} /> Khôi phục
                              </button>
                              <button
                                type="button"
                                className="btn btn-danger btn-sm"
                                onClick={() => handlePurgeDept(dept)}
                              >
                                <Trash2 size={13} /> Xóa vĩnh viễn
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

      {/* Modal Thêm / Sửa Khoa/Phòng */}
      {editingDept !== null && (
        <div className="modal-backdrop" onClick={() => setEditingDept(null)}>
          <div className="modal-content" style={{ maxWidth: '500px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ fontWeight: 800, fontSize: '15px' }}>
                {editingDept?.id ? `Chỉnh sửa Khoa / Phòng: ${editingDept.name}` : 'Thêm Khoa / Phòng mới'}
              </div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditingDept(null)}>
                <X size={15} />
              </button>
            </div>
            <form onSubmit={handleSaveDept}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {editingDept?.is_system && (
                  <div style={{
                    padding: '9px 12px', borderRadius: '7px', background: '#f3e8ff',
                    border: '1px solid #d8b4fe', color: '#6b21a8', fontSize: '12px', fontWeight: 600
                  }}>
                    🔒 Đây là phòng hệ thống mặc định — chỉ cho phép cập nhật Mã viết tắt và Mô tả.
                  </div>
                )}
                <div>
                  <label className="form-label">Tên Khoa / Phòng *</label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="VD: Khoa Khám bệnh - KSK"
                    value={form.name}
                    disabled={Boolean(editingDept?.is_system)}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="form-label">Mã viết tắt (Dùng sinh mã chức vụ)</label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="VD: KKB, PKHTH, XN..."
                    value={form.name_en}
                    onChange={(e) => setForm({ ...form, name_en: e.target.value.toUpperCase() })}
                  />
                </div>
                <div>
                  <label className="form-label">Mô tả chức năng / Ghi chú</label>
                  <textarea
                    rows={3}
                    className="form-control"
                    placeholder="Mô tả nhiệm vụ chuyên môn của Khoa/Phòng..."
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setEditingDept(null)}>
                  Hủy
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                  Lưu Khoa / Phòng
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Gán Trưởng Phòng Atomic */}
      {headModalDept && (
        <div className="modal-backdrop" onClick={() => setHeadModalDept(null)}>
          <div className="modal-content" style={{ maxWidth: '480px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ fontWeight: 800, fontSize: '15px' }}>
                ⭐ Bổ nhiệm Trưởng Khoa/Phòng — {headModalDept.name}
              </div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setHeadModalDept(null)}>
                <X size={15} />
              </button>
            </div>
            <form onSubmit={handleAssignHead}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{
                  padding: '10px 12px', borderRadius: '8px', background: '#fffbeb',
                  border: '1px solid #fde68a', color: '#92400e', fontSize: '12px'
                }}>
                  <AlertTriangle size={14} style={{ verticalAlign: 'middle', marginRight: '5px' }} />
                  Khi bổ nhiệm Trưởng phòng mới, Trưởng phòng hiện tại (nếu có) của khoa này sẽ tự động chuyển về vai trò Nhân viên trong cùng giao dịch.
                </div>

                <div>
                  <label className="form-label">Chọn nhân sự trực thuộc {headModalDept.name} *</label>
                  <select
                    className="form-control"
                    value={selectedHeadId}
                    onChange={(e) => setSelectedHeadId(e.target.value)}
                    required
                  >
                    <option value="">-- Chọn cán bộ làm Trưởng Khoa/Phòng --</option>
                    {(headModalDept.members || [])
                      .filter((m) => m.is_active && m.role !== 'admin')
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.full_name} (@{m.username}) {m.position_name ? `- ${m.position_name}` : ''}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setHeadModalDept(null)}>
                  Hủy
                </button>
                <button type="submit" className="btn btn-primary" disabled={assigningHead || !selectedHeadId}>
                  {assigningHead ? <Loader2 size={15} className="animate-spin" /> : <Star size={15} />}
                  Xác nhận Bổ nhiệm
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Phân quyền Khoa/Phòng (Tầng A) */}
      <DepartmentPermissionsModal
        isOpen={Boolean(permModalDept)}
        department={permModalDept}
        onClose={() => setPermModalDept(null)}
        onSaved={() => {
          loadDepartments()
          onUserChanged?.()
        }}
      />
    </div>
  )
}
