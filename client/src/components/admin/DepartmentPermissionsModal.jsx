import React, { useState, useEffect, useMemo } from 'react'
import { Shield, X, CheckSquare, Square, Search, Loader2, Save, Building2 } from 'lucide-react'
import { api } from '../../services/api'
import { PermBadge } from '../../utils/permissions'

export default function DepartmentPermissionsModal({ isOpen, department, onClose, onSaved }) {
  const [allPerms, setAllPerms] = useState([])
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!isOpen || !department?.id) return
    loadData()
  }, [isOpen, department?.id])

  const loadData = async () => {
    setLoading(true)
    setError(null)
    try {
      const [sysPerms, deptRes] = await Promise.all([
        api.getAllPermissions(),
        api.getDepartmentPermissions(department.id)
      ])
      setAllPerms(sysPerms || [])
      setSelectedIds(new Set(deptRes.permission_ids || []))
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Không thể tải danh sách quyền Khoa/Phòng')
    } finally {
      setLoading(false)
    }
  }

  const groupedPerms = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = allPerms.filter((p) => {
      if (!q) return true
      return (
        p.perm_name.toLowerCase().includes(q) ||
        p.perm_code.toLowerCase().includes(q) ||
        (p.description || '').toLowerCase().includes(q)
      )
    })
    const groups = new Map()
    filtered.forEach((p) => {
      const g = p.group_name || 'Khác'
      if (!groups.has(g)) groups.set(g, [])
      groups.get(g).push(p)
    })
    return Array.from(groups.entries())
  }, [allPerms, search])

  const togglePerm = (id) => {
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedIds(next)
  }

  const toggleGroup = (items) => {
    const allInGroup = items.every((p) => selectedIds.has(p.id))
    const next = new Set(selectedIds)
    if (allInGroup) items.forEach((p) => next.delete(p.id))
    else items.forEach((p) => next.add(p.id))
    setSelectedIds(next)
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      await api.updateDepartmentPermissions(department.id, {
        permission_ids: Array.from(selectedIds)
      })
      onSaved?.()
      onClose()
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Lỗi khi lưu phân quyền Khoa/Phòng')
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen || !department) return null

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: '760px' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '38px', height: '38px', borderRadius: '9px',
              background: '#e0f2fe', color: '#0284c7',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <Building2 size={20} />
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: '15px', color: '#0f172a' }}>
                Phân quyền Tầng A — Khoa / Phòng: {department.name}
              </div>
              <div style={{ fontSize: '12px', color: '#64748b' }}>
                Tất cả nhân sự trực thuộc <strong>{department.name}</strong> sẽ tự động được kế thừa bộ quyền nền này.
              </div>
            </div>
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        <div className="modal-body">
          {error && (
            <div style={{
              padding: '10px 12px', marginBottom: '12px', borderRadius: '8px',
              background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontWeight: 600, fontSize: '12.5px'
            }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', marginBottom: '14px', flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', flex: 1, minWidth: '240px' }}>
              <Search size={14} color="#94a3b8" style={{ position: 'absolute', left: '10px', top: '9px' }} />
              <input
                type="text"
                className="form-control"
                style={{ paddingLeft: '32px' }}
                placeholder="Tìm theo tên quyền hoặc mã PERM_..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="badge badge-info">
                Đang chọn: {selectedIds.size} / {allPerms.length} quyền
              </span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setSelectedIds(new Set(allPerms.map((p) => p.id)))}
              >
                Chọn hết
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setSelectedIds(new Set())}
              >
                Bỏ chọn hết
              </button>
            </div>
          </div>

          {loading ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>
              <Loader2 size={24} className="animate-spin" style={{ margin: '0 auto 8px' }} />
              Đang tải danh mục quyền...
            </div>
          ) : (
            groupedPerms.map(([groupName, items]) => {
              const allChecked = items.length > 0 && items.every((p) => selectedIds.has(p.id))
              return (
                <div key={groupName} className="perm-group-box">
                  <div className="perm-group-header">
                    <span>{groupName}</span>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      style={{ padding: '3px 8px', fontSize: '11.5px' }}
                      onClick={() => toggleGroup(items)}
                    >
                      {allChecked ? 'Bỏ chọn nhóm' : 'Chọn cả nhóm'}
                    </button>
                  </div>
                  {items.map((p) => {
                    const checked = selectedIds.has(p.id)
                    return (
                      <div
                        key={p.id}
                        className="perm-row"
                        style={{ cursor: 'pointer' }}
                        onClick={() => togglePerm(p.id)}
                      >
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                          <div style={{ marginTop: '2px', color: checked ? '#0284c7' : '#94a3b8' }}>
                            {checked ? <CheckSquare size={18} /> : <Square size={18} />}
                          </div>
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                              <span style={{ fontWeight: 700, color: '#0f172a' }}>{p.perm_name}</span>
                              <PermBadge code={p.perm_code} alwaysShow />
                            </div>
                            <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                              {p.description}
                            </div>
                          </div>
                        </div>
                        <span className={`badge ${checked ? 'badge-info' : 'badge-neutral'}`}>
                          {checked ? 'Cấp Tầng A' : 'Tắt'}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )
            })
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
            Hủy bỏ
          </button>
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving || loading}>
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            Lưu Phân Quyền Khoa/Phòng
          </button>
        </div>
      </div>
    </div>
  )
}
