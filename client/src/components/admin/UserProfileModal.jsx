import React, { useState, useEffect } from 'react'
import { User, X, Save, KeyRound, Loader2, ShieldCheck } from 'lucide-react'
import { api } from '../../services/api'
import { getRoleMeta } from '../../utils/permissions'

export default function UserProfileModal({ isOpen, user, onClose, onProfileUpdated }) {
  const [form, setForm] = useState({
    full_name: '',
    email: '',
    phone: '',
    cchn: '',
    current_password: '',
    new_password: '',
    confirm_password: ''
  })
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState(null)

  useEffect(() => {
    if (isOpen && user) {
      setForm({
        full_name: user.full_name || '',
        email: user.email || '',
        phone: user.phone || '',
        cchn: user.cchn || '',
        current_password: '',
        new_password: '',
        confirm_password: ''
      })
      setNotice(null)
    }
  }, [isOpen, user])

  if (!isOpen || !user) return null

  const roleMeta = getRoleMeta(user.role)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setNotice(null)

    if (form.new_password) {
      if (!form.current_password) {
        setNotice({ type: 'error', text: 'Vui lòng nhập mật khẩu hiện tại để xác nhận đổi mật khẩu mới.' })
        return
      }
      if (form.new_password !== form.confirm_password) {
        setNotice({ type: 'error', text: 'Mật khẩu xác nhận không khớp với mật khẩu mới.' })
        return
      }
    }

    setSaving(true)
    try {
      const res = await api.updateMyProfile({
        full_name: form.full_name,
        email: form.email,
        phone: form.phone,
        cchn: form.cchn,
        current_password: form.new_password ? form.current_password : null,
        new_password: form.new_password || null
      })
      if (res.success && res.user) {
        onProfileUpdated?.(res.user)
        setForm((prev) => ({ ...prev, current_password: '', new_password: '', confirm_password: '' }))
        setNotice({ type: 'success', text: res.message || 'Đã lưu thông tin hồ sơ cá nhân!' })
      }
    } catch (err) {
      setNotice({
        type: 'error',
        text: err.response?.data?.detail || err.message || 'Lỗi khi cập nhật hồ sơ cá nhân'
      })
    } finally {
      setSaving(false)
    }
  }

  const effectivePerms = (user.permissions || []).filter((c) => c !== '0' && c !== '*')

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: '580px' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '38px', height: '38px', borderRadius: '50%',
              background: 'linear-gradient(135deg, #0284c7, #4f46e5)', color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800
            }}>
              {(user.full_name || user.username || 'U').charAt(0).toUpperCase()}
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: '15px', color: '#0f172a' }}>
                Hồ sơ cá nhân — @{user.username}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                <span className={`badge ${roleMeta.badgeClass}`}>
                  {roleMeta.icon} {roleMeta.label}
                </span>
                {user.position_name && <span className="badge badge-neutral">💼 {user.position_name}</span>}
              </div>
            </div>
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {notice && (
              <div style={{
                padding: '10px 12px', borderRadius: '8px', fontSize: '12.5px', fontWeight: 600,
                background: notice.type === 'success' ? '#f0fdf4' : '#fef2f2',
                border: `1px solid ${notice.type === 'success' ? '#bbf7d0' : '#fecaca'}`,
                color: notice.type === 'success' ? '#15803d' : '#b91c1c'
              }}>
                {notice.text}
              </div>
            )}

            <div style={{
              background: '#f8fafc', border: '1px solid var(--border)', borderRadius: '8px', padding: '10px 12px', fontSize: '12.5px'
            }}>
              <div>🏢 Khoa / Phòng công tác: <strong>{(user.department_names || []).join(', ') || 'Chưa phân công'}</strong></div>
              <div style={{ marginTop: '4px', color: '#475569' }}>
                <ShieldCheck size={13} style={{ verticalAlign: 'middle', marginRight: '4px', color: '#16a34a' }} />
                Quyền hạn hiệu lực: <strong>{user.is_admin ? 'Toàn quyền Quản trị viên (Admin [0])' : `${effectivePerms.length} quyền chức năng`}</strong>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label className="form-label">Họ và tên cán bộ / Bác sĩ *</label>
                <input
                  type="text"
                  className="form-control"
                  value={form.full_name}
                  onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                  required
                />
              </div>

              <div>
                <label className="form-label">Số Chứng chỉ hành nghề (CCHN)</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="VD: 001245/KG-CCHN"
                  value={form.cchn}
                  onChange={(e) => setForm({ ...form, cchn: e.target.value })}
                />
              </div>

              <div>
                <label className="form-label">Số điện thoại</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="0912..."
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </div>

              <div style={{ gridColumn: '1 / -1' }}>
                <label className="form-label">Địa chỉ Email</label>
                <input
                  type="email"
                  className="form-control"
                  placeholder="bacsi@bvbinhan.vn"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
              <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <KeyRound size={15} color="#4f46e5" />
                Đổi mật khẩu đăng nhập (Để trống nếu không đổi)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label className="form-label">Mật khẩu hiện tại</label>
                  <input
                    type="password"
                    className="form-control"
                    value={form.current_password}
                    onChange={(e) => setForm({ ...form, current_password: e.target.value })}
                  />
                </div>
                <div>
                  <label className="form-label">Mật khẩu mới</label>
                  <input
                    type="password"
                    className="form-control"
                    value={form.new_password}
                    onChange={(e) => setForm({ ...form, new_password: e.target.value })}
                  />
                </div>
                <div>
                  <label className="form-label">Nhập lại mật khẩu mới</label>
                  <input
                    type="password"
                    className="form-control"
                    value={form.confirm_password}
                    onChange={(e) => setForm({ ...form, confirm_password: e.target.value })}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
              Đóng
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              Lưu Hồ Sơ Cá Nhân
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
