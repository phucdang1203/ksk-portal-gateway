import React, { useState, useEffect } from 'react'
import { Landmark, Server, Save, CheckCircle2, RefreshCw, Loader2, ShieldAlert } from 'lucide-react'
import { api } from '../../services/api'
import { hasPerm, PermBadge } from '../../utils/permissions'

export default function PortalConfigPage({ currentUser, onConfigSaved }) {
  const [serverUrl, setServerUrl] = useState(api.getServerUrl())
  const [testingServer, setTestingServer] = useState(false)
  const [serverTestMsg, setServerTestMsg] = useState(null)

  const [hospital, setHospital] = useState({
    ma_cskcb: '91034',
    ten_benh_vien: 'Bệnh viện Đa khoa Bình An',
    ma_so_thue: '1700335853',
    dia_chi: ''
  })

  const [portal, setPortal] = useState({
    env: 'sandbox',
    sandbox_url: 'https://api-sandbox.emrhub.vn',
    prod_url: 'https://api.emrhub.vn',
    egw_url: 'https://gdbhyt.baohiemxahoi.gov.vn',
    username: '91034',
    password: '',
    has_password: false,
    simulation_mode: true
  })

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState(null)

  const canSavePortal = hasPerm(currentUser, 'PERM_SYS_PORTAL_CONFIG')

  useEffect(() => {
    loadConfigs()
  }, [])

  const loadConfigs = async () => {
    setLoading(true)
    try {
      const res = await api.getConfigs()
      if (res.success) {
        if (res.hospital) setHospital((prev) => ({ ...prev, ...res.hospital }))
        if (res.portal) setPortal((prev) => ({ ...prev, ...res.portal, password: '' }))
      }
    } catch (err) {
      setNotice({ type: 'error', text: err.response?.data?.detail || err.message })
    } finally {
      setLoading(false)
    }
  }

  const handleTestServerUrl = async () => {
    setTestingServer(true)
    setServerTestMsg(null)
    try {
      const clean = await api.setServerUrl(serverUrl)
      setServerUrl(clean)
      const h = await api.checkHealth(clean)
      setServerTestMsg({
        ok: true,
        text: `Kết nối thành công tới ${clean} — Đơn vị: ${h.hospital} (Mã CSKCB: ${h.ma_cskcb}, Server v${h.version})`
      })
    } catch (err) {
      setServerTestMsg({
        ok: false,
        text: `Không kết nối được tới ${serverUrl}: ${err.message}`
      })
    } finally {
      setTestingServer(false)
    }
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    setNotice(null)
    try {
      await api.setServerUrl(serverUrl)
      const res = await api.saveConfigs({ hospital, portal })
      setNotice({ type: 'success', text: res.message || 'Đã lưu cấu hình Đơn vị & Cổng KSK Quốc gia!' })
      await loadConfigs()
      onConfigSaved?.()
    } catch (err) {
      setNotice({
        type: 'error',
        text: err.response?.data?.detail || err.message || 'Lỗi khi lưu cấu hình'
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '1040px' }}>
      <div className="page-header-bar" style={{ marginBottom: 0 }}>
        <div>
          <h2 className="page-title">
            <Landmark size={22} color="#0284c7" />
            Cấu hình Đơn vị KCB & Cổng KSK Quốc gia
            <PermBadge code="PERM_SYS_PORTAL_CONFIG" />
          </h2>
          <p className="page-subtitle">
            Thiết lập thông tin pháp nhân Cơ sở Khám chữa bệnh (Mã CSKCB, Mã số thuế) và thông số liên thông Cổng dữ liệu Y tế Quốc gia / BHXH.
          </p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={loadConfigs} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Tải lại cấu hình
        </button>
      </div>

      {notice && (
        <div style={{
          padding: '11px 15px', borderRadius: '8px', fontWeight: 600, fontSize: '13px',
          background: notice.type === 'success' ? '#f0fdf4' : '#fef2f2',
          border: `1px solid ${notice.type === 'success' ? '#bbf7d0' : '#fecaca'}`,
          color: notice.type === 'success' ? '#15803d' : '#b91c1c'
        }}>
          {notice.text}
        </div>
      )}

      {/* Khối 1: Địa chỉ kết nối Máy chủ Backend trên máy Client hiện tại */}
      <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: '10px', padding: '18px 20px' }}>
        <div style={{ fontWeight: 800, fontSize: '14px', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Server size={17} color="#0284c7" />
          1. Kết nối từ Máy trạm hiện tại tới Máy chủ KSK Gateway nội bộ (LAN)
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <input
            type="text"
            className="form-control"
            style={{ flex: 1, minWidth: '280px', fontFamily: 'monospace' }}
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            placeholder="http://192.168.1.100:8790"
          />
          <button type="button" className="btn btn-secondary" onClick={handleTestServerUrl} disabled={testingServer}>
            {testingServer ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} color="#16a34a" />}
            Lưu & Kiểm tra kết nối LAN
          </button>
        </div>
        {serverTestMsg && (
          <div style={{
            marginTop: '8px', fontSize: '12.5px', fontWeight: 600,
            color: serverTestMsg.ok ? '#15803d' : '#b91c1c'
          }}>
            {serverTestMsg.text}
          </div>
        )}
      </div>

      {/* Khối 2 & 3: Thông tin Bệnh viện + Liên thông Cổng Quốc gia */}
      <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: '10px', padding: '18px 20px' }}>
          <div style={{ fontWeight: 800, fontSize: '14px', marginBottom: '12px', color: '#0f172a' }}>
            2. Thông tin Định danh Cơ sở Khám chữa bệnh (Đóng gói Header XML/JSON)
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '12px' }}>
            <div>
              <label className="form-label">Mã Cơ sở KCB (5 số) *</label>
              <input
                type="text"
                className="form-control"
                value={hospital.ma_cskcb || ''}
                disabled={!canSavePortal}
                onChange={(e) => setHospital({ ...hospital, ma_cskcb: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="form-label">Tên Bệnh viện / Cơ sở Y tế *</label>
              <input
                type="text"
                className="form-control"
                value={hospital.ten_benh_vien || ''}
                disabled={!canSavePortal}
                onChange={(e) => setHospital({ ...hospital, ten_benh_vien: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="form-label">Mã số thuế Đơn vị (Đối chiếu USB Token)</label>
              <input
                type="text"
                className="form-control"
                value={hospital.ma_so_thue || ''}
                disabled={!canSavePortal}
                onChange={(e) => setHospital({ ...hospital, ma_so_thue: e.target.value })}
              />
            </div>
            <div>
              <label className="form-label">Địa chỉ trụ sở</label>
              <input
                type="text"
                className="form-control"
                value={hospital.dia_chi || ''}
                disabled={!canSavePortal}
                onChange={(e) => setHospital({ ...hospital, dia_chi: e.target.value })}
              />
            </div>
          </div>
        </div>

        <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: '10px', padding: '18px 20px' }}>
          <div style={{ fontWeight: 800, fontSize: '14px', marginBottom: '12px', color: '#0f172a' }}>
            3. Cấu hình Endpoint & Tài khoản Liên thông Cổng Quốc gia
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label className="form-label">Môi trường đích</label>
              <select
                className="form-control"
                value={portal.env || 'sandbox'}
                disabled={!canSavePortal}
                onChange={(e) => setPortal({ ...portal, env: e.target.value })}
              >
                <option value="sandbox">Môi trường Thử nghiệm (Sandbox EMRHub)</option>
                <option value="production">Môi trường Chính thức (Production Cổng Quốc gia)</option>
              </select>
            </div>

            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <label style={{
                display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px',
                borderRadius: '7px', background: portal.simulation_mode ? '#fffbeb' : '#f0fdf4',
                border: `1px solid ${portal.simulation_mode ? '#fde68a' : '#bbf7d0'}`,
                cursor: canSavePortal ? 'pointer' : 'not-allowed', width: '100%', fontWeight: 600, fontSize: '12.5px'
              }}>
                <input
                  type="checkbox"
                  checked={Boolean(portal.simulation_mode)}
                  disabled={!canSavePortal}
                  onChange={(e) => setPortal({ ...portal, simulation_mode: e.target.checked })}
                />
                <span>Chế độ Giả lập phản hồi Cổng (Simulation Mode — Kiểm thử nội bộ)</span>
              </label>
            </div>

            <div>
              <label className="form-label">Sandbox API URL</label>
              <input
                type="text"
                className="form-control"
                style={{ fontFamily: 'monospace' }}
                value={portal.sandbox_url || ''}
                disabled={!canSavePortal}
                onChange={(e) => setPortal({ ...portal, sandbox_url: e.target.value })}
              />
            </div>

            <div>
              <label className="form-label">Production API URL</label>
              <input
                type="text"
                className="form-control"
                style={{ fontFamily: 'monospace' }}
                value={portal.prod_url || ''}
                disabled={!canSavePortal}
                onChange={(e) => setPortal({ ...portal, prod_url: e.target.value })}
              />
            </div>

            <div>
              <label className="form-label">Tài khoản liên thông Cổng</label>
              <input
                type="text"
                className="form-control"
                value={portal.username || ''}
                disabled={!canSavePortal}
                onChange={(e) => setPortal({ ...portal, username: e.target.value })}
              />
            </div>

            <div>
              <label className="form-label">
                Mật khẩu liên thông {portal.has_password ? '(Đã lưu — Để trống nếu giữ nguyên)' : ''}
              </label>
              <input
                type="password"
                className="form-control"
                placeholder={portal.has_password ? '••••••••••••' : 'Nhập mật khẩu Cổng KSK...'}
                value={portal.password || ''}
                disabled={!canSavePortal}
                onChange={(e) => setPortal({ ...portal, password: e.target.value })}
              />
            </div>
          </div>

          {!canSavePortal ? (
            <div style={{
              marginTop: '14px', padding: '10px 12px', borderRadius: '8px',
              background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', fontSize: '12.5px', fontWeight: 600
            }}>
              <ShieldAlert size={15} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
              Bạn đang xem ở chế độ Chỉ đọc. Cần quyền <code>PERM_SYS_PORTAL_CONFIG</code> để lưu thay đổi cấu hình Cổng.
            </div>
          ) : (
            <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'flex-end' }}>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                Lưu Cấu Hình Hệ Thống
                <PermBadge code="PERM_SYS_PORTAL_CONFIG" />
              </button>
            </div>
          )}
        </div>
      </form>
    </div>
  )
}
