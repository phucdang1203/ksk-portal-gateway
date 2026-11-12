import React, { useState, useEffect, useMemo } from 'react'
import { Briefcase, X, CheckSquare, Square, Lock, Search, Loader2, Save } from 'lucide-react'
import { api } from '../../services/api'
import { PermBadge } from '../../utils/permissions'

export default function PositionPermissionsModal({ isOpen, position, onClose, onSaved }) {
  const [allPerms, setAllPerms] = useState([])
  const [deptPermIds, setDeptPermIds] = useState(new Set())
  const [directIds, setDirectIds] = useState(new Set())
  const [deptName, setDeptName] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!isOpen || !position?.id) return
    loadData()
  }, [isOpen, position?.id])

  const loadData = async () => {
    setLoading(true)
    setError(null)
    try {
      const [sysPerms, posRes] = await Promise.all([
        api.getAllPermissions(),
        api.getPositionPermissions(position.id)
      ])
      setAllPerms(sysPerms || [])
      setDeptPermIds(new Set(posRes.department_permission_ids || []))
      setDirectIds(new Set(posRes.permission_ids || []))
      setDeptName(posRes.department_name || '')
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Không thể tải quyền chức vụ')
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
    if (deptPermIds.has(id)) return // Đã kế thừa cứng từ Tầng A
    const next = new Set(directIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setDirectIds(next)
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      await api.updatePositionPermissions(position.id, {
        permission_ids: Array.from(directIds)
      })
      onSaved?.()
      onClose()
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Lỗi khi lưu phân quyền Chức vụ')
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen || !position) return null

  const effectiveTotal = new Set([...deptPermIds, ...directIds]).size

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: '780px' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '38px', height: '38px', borderRadius: '9px',
              background: '#eef2ff', color: '#4f46e5',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <Briefcase size={20} />
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: '15px', color: '#0f172a' }}>
                Phân quyền Tầng B — Chức vụ: {position.name}
              </div>
              <div style={{ fontSize: '12px', color: '#64748b' }}>
                {deptName
                  ? `Thuộc ${deptName} — Kế thừa tự động ${deptPermIds.size} quyền Tầng A (🔒 Chỉ xem) + Cộng thêm quyền riêng Tầng B.`
                  : 'Chức vụ dùng chung toàn viện — Quyền Tầng B sẽ cộng dồn với quyền Khoa/Phòng của từng nhân viên.'}
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

          {/* Thanh tóm tắt kế thừa A ∪ B */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap',
            gap: '8px', padding: '10px 14px', borderRadius: '8px', background: '#f8fafc', border: '1px solid var(--border)', marginBottom: '12px'
          }}>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <span className="badge badge-info">🔒 Tầng A (Khoa/Phòng): {deptPermIds.size}</span>
              <span className="badge badge-purple">💼 Tầng B (Chức vụ): +{directIds.size}</span>
              <span className="badge badge-success">✅ Tổng hiệu lực (A ∪ B): {effectiveTotal} / {allPerms.length}</span>
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  const next = new Set()
                  allPerms.forEach((p) => {
                    if (!deptPermIds.has(p.id)) next.add(p.id)
                  })
                  setDirectIds(next)
                }}
              >
                Bật hết Tầng B
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setDirectIds(new Set())}
              >
                Xóa Tầng B
              </button>
            </div>
          </div>

          <div style={{ position: 'relative', marginBottom: '14px' }}>
            <Search size={14} color="#94a3b8" style={{ position: 'absolute', left: '10px', top: '9px' }} />
            <input
              type="text"
              className="form-control"
              style={{ paddingLeft: '32px' }}
              placeholder="Tìm quyền theo tên hoặc mã PERM_..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {loading ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>
              <Loader2 size={24} className="animate-spin" style={{ margin: '0 auto 8px' }} />
              Đang tải ma trận quyền Chức vụ...
            </div>
          ) : (
            groupedPerms.map(([groupName, items]) => (
              <div key={groupName} className="perm-group-box">
                <div className="perm-group-header">
                  <span>{groupName}</span>
                </div>
                {items.map((p) => {
                  const isFromDept = deptPermIds.has(p.id)
                  const isDirect = directIds.has(p.id)
                  const checked = isFromDept || isDirect

                  return (
                    <div
                      key={p.id}
                      className={`perm-row ${isFromDept ? 'inherited-locked' : ''}`}
                      style={{ cursor: isFromDept ? 'not-allowed' : 'pointer' }}
                      onClick={() => togglePerm(p.id)}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                        <div style={{ marginTop: '2px', color: isFromDept ? '#0284c7' : isDirect ? '#4f46e5' : '#94a3b8' }}>
                          {isFromDept ? <Lock size={17} /> : checked ? <CheckSquare size={18} /> : <Square size={18} />}
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

                      {isFromDept ? (
                        <span className="badge badge-info" title={`Kế thừa từ ${deptName || 'Khoa/Phòng'}`}>
                          🔒 A. Từ Khoa/Phòng (Chỉ xem)
                        </span>
                      ) : isDirect ? (
                        <span className="badge badge-purple">💼 B. Quyền Chức vụ</span>
                      ) : (
                        <span className="badge badge-neutral">Chưa cấp</span>
                      )}
                    </div>
                  )
                })}
              </div>
            ))
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
            Hủy bỏ
          </button>
          <button type="button" className="btn btn-indigo" onClick={handleSave} disabled={saving || loading}>
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            Lưu Phân Quyền Chức Vụ
          </button>
        </div>
      </div>
    </div>
  )
}
