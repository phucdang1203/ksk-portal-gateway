import React, { useState, useEffect } from 'react'
import { X, Server, Globe, Building2, Save, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'
import { api } from '../services/api'
import { PermBadge } from '../utils/permissions'

export default function ServerConfigModal({ isOpen, onClose, onConfigUpdated, canManagePortal = false }) {
  const [serverUrl, setServerUrl] = useState(api.getServerUrl())
  const [testingServer, setTestingServer] = useState(false)
  const [serverTestMsg, setServerTestMsg] = useState(null)
  const [saving, setSaving] = useState(false)

  const [hospital, setHospital] = useState({
    ma_cskcb: '91034',
    ten_benh_vien: 'Bệnh viện Đa khoa Bình An',
    ma_so_thue: '1700335853',
    dia_chi: '80 - 82 Nguyễn Trung Trực, TP. Rạch Giá, Kiên Giang'
  })

  const [portal, setPortal] = useState({
    env: 'sandbox',
    sandbox_url: 'https://api-sandbox.emrhub.vn',
    prod_url: 'https://api.emrhub.vn',
    username: '91034',
    password: '',
    simulation_mode: true
  })

  useEffect(() => {
    if (isOpen) {
      setServerUrl(api.getServerUrl())
      setServerTestMsg(null)
      loadServerConfigs()
    }
  }, [isOpen])

  const loadServerConfigs = async () => {
    if (!canManagePortal) return
    try {
      const res = await api.getConfigs()
      if (res.success) {
        if (res.hospital) setHospital((prev) => ({ ...prev, ...res.hospital }))
        if (res.portal) setPortal((prev) => ({ ...prev, ...res.portal, password: '' }))
      }
    } catch (err) {
      // Nếu chưa kết nối được server thì vẫn cho phép sửa địa chỉ Server URL
    }
  }

  const handleTestServerUrl = async () => {
    setTestingServer(true)
    setServerTestMsg(null)
    try {
      const cleanUrl = await api.setServerUrl(serverUrl)
      setServerUrl(cleanUrl)
      const health = await api.checkHealth(cleanUrl)
      setServerTestMsg({
        type: 'success',
        text: `Kết nối thành công tới Server (${cleanUrl}) - Đơn vị: ${health.hospital} (${health.ma_cskcb})`
      })
      await loadServerConfigs()
    } catch (err) {
      setServerTestMsg({
        type: 'error',
        text: `Không thể kết nối tới Server (${serverUrl}): ${err.message}`
      })
    } finally {
      setTestingServer(false)
    }
  }

  const handleSaveAll = async () => {
    setSaving(true)
    setServerTestMsg(null)
    try {
      const cleanUrl = await api.setServerUrl(serverUrl)
      setServerUrl(cleanUrl)
      await api.checkHealth(cleanUrl)
      if (canManagePortal) {
        await api.saveConfigs({ hospital, portal })
        setServerTestMsg({ type: 'success', text: 'Đã lưu cấu hình Server & Cổng Quốc gia thành công!' })
      } else {
        setServerTestMsg({ type: 'success', text: `Đã lưu địa chỉ kết nối Server (${cleanUrl}) thành công!` })
      }
      if (onConfigUpdated) onConfigUpdated()
    } catch (err) {
      setServerTestMsg({
        type: 'error',
        text: err.response?.data?.detail || err.message || 'Lỗi khi lưu cấu hình'
      })
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: '680px' }} onClick={(e) => e.stopPropagation()}>
        <div style={{
          padding: '15px 20px',
          borderBottom: '1px solid var(--border)',
          background: '#f8fafc',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, fontSize: '15px' }}>
            <Server size={18} color="#0284c7" />
            Cấu hình Kết nối Máy chủ (Docker / LAN) & Cổng KSK Quốc Gia
          </div>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
            <X size={20} />
          </button>
        </div>

        <div style={{ padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* 1. Cấu hình Địa chỉ Server Backend */}
          <div style={{ border: '1px solid var(--border)', borderRadius: '8px', padding: '14px 16px' }}>
            <div style={{ fontWeight: 700, marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Server size={15} color="#0284c7" />
              1. Địa chỉ Máy chủ KSK Gateway Server (Docker / LAN)
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                className="form-control"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                placeholder="http://127.0.0.1:8790 hoặc http://192.168.1.100:8790"
              />
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleTestServerUrl}
                disabled={testingServer}
              >
                {testingServer ? <Loader2 size={14} className="animate-spin" /> : null}
                Kiểm tra kết nối
              </button>
            </div>
            <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '4px' }}>
              Dễ dàng trỏ App Client tới bất kỳ máy chủ Docker nào trong mạng LAN hoặc chạy cục bộ <code>http://127.0.0.1:8790</code>.
            </div>
          </div>

          {canManagePortal && (
            <>
              {/* 2. Thông tin Bệnh viện / Cơ sở KCB */}
              <div style={{ border: '1px solid var(--border)', borderRadius: '8px', padding: '14px 16px' }}>
                <div style={{ fontWeight: 700, marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Building2 size={15} color="#0284c7" />
                  <span>2. Thông tin Cơ sở Khám chữa bệnh (Đơn vị đẩy dữ liệu)</span>
                  <PermBadge code="PERM_SYS_PORTAL_CONFIG" />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '10px' }}>
                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 600 }}>Mã CSKCB *</label>
                    <input
                      type="text"
                      className="form-control"
                      value={hospital.ma_cskcb}
                      onChange={(e) => setHospital({ ...hospital, ma_cskcb: e.target.value })}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 600 }}>Tên Bệnh viện / Cơ sở Y tế *</label>
                    <input
                      type="text"
                      className="form-control"
                      value={hospital.ten_benh_vien}
                      onChange={(e) => setHospital({ ...hospital, ten_benh_vien: e.target.value })}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 600 }}>Mã số thuế (Định danh USB Token)</label>
                    <input
                      type="text"
                      className="form-control"
                      value={hospital.ma_so_thue}
                      onChange={(e) => setHospital({ ...hospital, ma_so_thue: e.target.value })}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 600 }}>Địa chỉ đơn vị</label>
                    <input
                      type="text"
                      className="form-control"
                      value={hospital.dia_chi}
                      onChange={(e) => setHospital({ ...hospital, dia_chi: e.target.value })}
                    />
                  </div>
                </div>
              </div>

              {/* 3. Cấu hình Cổng Quốc gia */}
              <div style={{ border: '1px solid var(--border)', borderRadius: '8px', padding: '14px 16px' }}>
                <div style={{ fontWeight: 700, marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Globe size={15} color="#0284c7" />
                  3. Cấu hình Cổng Dữ liệu Khám Sức Khỏe Quốc Gia (Bộ Y Tế EMRHub / Đề án 06)
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 600 }}>Môi trường tiếp nhận</label>
                    <select
                      className="form-control"
                      value={portal.env}
                      onChange={(e) => setPortal({ ...portal, env: e.target.value })}
                    >
                      <option value="sandbox">SANDBOX (Thử nghiệm)</option>
                      <option value="prod">PRODUCTION (Chính thức)</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 600 }}>Chế độ Mô phỏng Cổng (Khi test offline)</label>
                    <select
                      className="form-control"
                      value={portal.simulation_mode ? 'true' : 'false'}
                      onChange={(e) => setPortal({ ...portal, simulation_mode: e.target.value === 'true' })}
                    >
                      <option value="true">Bật (Mô phỏng phản hồi Cổng BYT 200 OK)</option>
                      <option value="false">Tắt (Gọi trực tiếp API Cổng thật)</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 600 }}>Tài khoản Cổng BYT</label>
                    <input
                      type="text"
                      className="form-control"
                      value={portal.username}
                      onChange={(e) => setPortal({ ...portal, username: e.target.value })}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 600 }}>Mật khẩu Cổng BYT (Để trống nếu giữ nguyên)</label>
                    <input
                      type="password"
                      className="form-control"
                      value={portal.password}
                      onChange={(e) => setPortal({ ...portal, password: e.target.value })}
                      placeholder="••••••••"
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 600 }}>URL Sandbox</label>
                    <input
                      type="text"
                      className="form-control"
                      value={portal.sandbox_url}
                      onChange={(e) => setPortal({ ...portal, sandbox_url: e.target.value })}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 600 }}>URL Production</label>
                    <input
                      type="text"
                      className="form-control"
                      value={portal.prod_url}
                      onChange={(e) => setPortal({ ...portal, prod_url: e.target.value })}
                    />
                  </div>
                </div>
              </div>
            </>
          )}

          {serverTestMsg && (
            <div style={{
              padding: '10px 14px',
              borderRadius: '8px',
              background: serverTestMsg.type === 'success' ? '#f0fdf4' : '#fef2f2',
              border: `1px solid ${serverTestMsg.type === 'success' ? '#bbf7d0' : '#fecaca'}`,
              color: serverTestMsg.type === 'success' ? '#15803d' : '#b91c1c',
              fontWeight: 600,
              fontSize: '12.5px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              {serverTestMsg.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
              {serverTestMsg.text}
            </div>
          )}
        </div>

        <div style={{
          padding: '13px 20px',
          borderTop: '1px solid var(--border)',
          background: '#f8fafc',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: '10px'
        }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Đóng
          </button>
          <button type="button" className="btn btn-primary" onClick={handleSaveAll} disabled={saving}>
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            Lưu Cấu Hình
          </button>
        </div>
      </div>
    </div>
  )
}
