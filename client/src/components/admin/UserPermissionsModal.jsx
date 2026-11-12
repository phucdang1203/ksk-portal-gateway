import React, { useState, useEffect, useMemo } from 'react'
import { UserCheck, X, CheckSquare, Square, Lock, Search, Loader2, Save, Crown } from 'lucide-react'
import { api } from '../../services/api'
import { PermBadge } from '../../utils/permissions'

export default function UserPermissionsModal({ isOpen, targetUser, onClose, onSaved }) {
  const [allPerms, setAllPerms] = useState([])
  const [matrix, setMatrix] = useState(null)
  const [directIds, setDirectIds] = useState(new Set())
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!isOpen || !targetUser?.id) return
    loadData()
  }, [isOpen, targetUser?.id])

  const loadData = async () => {
    setLoading(true)
    setError(null)
    try {
      const [sysPerms, matRes] = await Promise.all([
        api.getAllPermissions(),
        api.getUserPermissionMatrix(targetUser.id)
      ])
      setAllPerms(sysPerms || [])
      setMatrix(matRes)
      setDirectIds(new Set((matRes.individual || []).map((p) => p.id)))
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Không thể tải ma trận quyền nhân sự')
    } finally {
      setLoading(false)
    }
  }

  const deptPermMap = useMemo(() => {
    const m = new Map()
    ;(matrix?.department || []).forEach((p) => m.set(p.id, p))
    return m
  }, [matrix])

  const posPermMap = useMemo(() => {
    const m = new Map()
    ;(matrix?.position || []).forEach((p) => m.set(p.id, p))
    return m
  }, [matrix])

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
    if (matrix?.is_admin) return
    if (deptPermMap.has(id) || posPermMap.has(id)) return
    const next = new Set(directIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setDirectIds(next)
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      await api.updateUserPermissions(targetUser.id, {
        permission_ids: Array.from(directIds)
      })
      onSaved?.()
      onClose()
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Lỗi khi lưu phân quyền cá nhân')
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen || !targetUser) return null

  const isTargetAdmin = Boolean(matrix?.is_admin || String(targetUser.role || '').toLowerCase() === 'admin')
  const effectiveCount = isTargetAdmin
    ? allPerms.length
    : new Set([...deptPermMap.keys(), ...posPermMap.keys(), ...directIds]).size

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: '820px' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '40px', height: '40px', borderRadius: '10px',
              background: isTargetAdmin ? '#f3e8ff' : '#dcfce7',
              color: isTargetAdmin ? '#6b21a8' : '#15803d',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              {isTargetAdmin ? <Crown size={20} /> : <UserCheck size={20} />}
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: '15px', color: '#0f172a' }}>
                Ma trận Phân quyền 3 Tầng (A ∪ B ∪ C) — {targetUser.full_name} (@{targetUser.username})
              </div>
              <div style={{ fontSize: '12px', color: '#64748b', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <span>🏢 Khoa/Phòng: <strong>{(matrix?.department_names || targetUser.department_names || []).join(', ') || 'Chưa gán'}</strong></span>
                <span>•</span>
                <span>💼 Chức vụ: <strong>{matrix?.position_name || targetUser.position_name || 'Chưa gán'}</strong></span>
                {targetUser.cchn && (
                  <>
                    <span>•</span>
                    <span>🩺 CCHN: <strong>{targetUser.cchn}</strong></span>
                  </>
                )}
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

          {isTargetAdmin && (
            <div style={{
              padding: '12px 14px', marginBottom: '12px', borderRadius: '8px',
              background: '#f3e8ff', border: '1px solid #d8b4fe', color: '#581c87', fontSize: '12.5px', fontWeight: 600
            }}>
              👑 Tài khoản này có vai trò <strong>Quản trị viên tối cao (Admin — Mã quyền đặc biệt: 0 / *)</strong> nên luôn sở hữu 100% quyền hạn toàn hệ thống.
            </div>
          )}

          {/* Tóm tắt công thức A ∪ B ∪ C */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap',
            gap: '8px', padding: '10px 14px', borderRadius: '8px', background: '#f8fafc', border: '1px solid var(--border)', marginBottom: '12px'
          }}>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <span className="badge badge-info">🔒 A. Khoa/Phòng: {deptPermMap.size}</span>
              <span className="badge badge-purple">🔒 B. Chức vụ: +{posPermMap.size}</span>
              <span className="badge badge-warning">✨ C. Cá nhân: +{directIds.size}</span>
              <span className="badge badge-success">✅ Tổng hiệu lực: {effectiveCount} / {allPerms.length}</span>
            </div>
            {!isTargetAdmin && (
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    const next = new Set()
                    allPerms.forEach((p) => {
                      if (!deptPermMap.has(p.id) && !posPermMap.has(p.id)) next.add(p.id)
                    })
                    setDirectIds(next)
                  }}
                >
                  Cấp hết Tầng C
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setDirectIds(new Set())}
                >
                  Xóa Tầng C
                </button>
              </div>
            )}
          </div>

          <div style={{ position: 'relative', marginBottom: '14px' }}>
            <Search size={14} color="#94a3b8" style={{ position: 'absolute', left: '10px', top: '9px' }} />
            <input
              type="text"
              className="form-control"
              style={{ paddingLeft: '32px' }}
              placeholder="Tìm quyền theo tên chức năng hoặc mã PERM_..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {loading ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>
              <Loader2 size={24} className="animate-spin" style={{ margin: '0 auto 8px' }} />
              Đang tổng hợp ma trận phân quyền 3 tầng...
            </div>
          ) : (
            groupedPerms.map(([groupName, items]) => (
              <div key={groupName} className="perm-group-box">
                <div className="perm-group-header">
                  <span>{groupName}</span>
                </div>
                {items.map((p) => {
                  const fromDept = deptPermMap.get(p.id)
                  const fromPos = posPermMap.get(p.id)
                  const isDirect = directIds.has(p.id)
                  const isLocked = isTargetAdmin || Boolean(fromDept || fromPos)
                  const checked = isTargetAdmin || Boolean(fromDept || fromPos || isDirect)

                  return (
                    <div
                      key={p.id}
                      className={`perm-row ${isLocked ? 'inherited-locked' : ''}`}
                      style={{ cursor: isLocked ? 'not-allowed' : 'pointer' }}
                      onClick={() => togglePerm(p.id)}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                        <div style={{
                          marginTop: '2px',
                          color: isTargetAdmin
                            ? '#6b21a8'
                            : fromDept
                              ? '#0284c7'
                              : fromPos
                                ? '#4f46e5'
                                : isDirect
                                  ? '#16a34a'
                                  : '#94a3b8'
                        }}>
                          {isLocked ? <Lock size={17} /> : checked ? <CheckSquare size={18} /> : <Square size={18} />}
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

                      {isTargetAdmin ? (
                        <span className="badge badge-purple">👑 Toàn quyền Admin [0]</span>
                      ) : fromDept ? (
                        <span className="badge badge-info" title={`Kế thừa từ ${fromDept.department_name}`}>
                          🔒 A. {fromDept.department_name}
                        </span>
                      ) : fromPos ? (
                        <span className="badge badge-purple" title={`Kế thừa từ chức vụ ${fromPos.position_name}`}>
                          🔒 B. {fromPos.position_name}
                        </span>
                      ) : isDirect ? (
                        <span className="badge badge-warning">✨ C. Cấp riêng cá nhân</span>
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
            Đóng
          </button>
          {!isTargetAdmin && (
            <button type="button" className="btn btn-success" onClick={handleSave} disabled={saving || loading}>
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              Lưu Quyền Cá Nhân (Tầng C)
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
