import React, { useState } from 'react'
import {
  X, Send, ShieldCheck, CheckCircle2, AlertCircle, Loader2, Award
} from 'lucide-react'
import { api } from '../services/api'

export default function PushPortalModal({
  isOpen,
  onClose,
  signedRecords,
  batchId,
  portalConfig,
  onPushSuccess
}) {
  const [pushing, setPushing] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  if (!isOpen) return null

  const env = portalConfig?.portal?.env || 'sandbox'
  const isProd = env === 'prod'
  const maCskcb = portalConfig?.hospital?.ma_cskcb || '91034'
  const tenBv = portalConfig?.hospital?.ten_benh_vien || 'Bệnh viện Đa khoa Bình An'

  const handleConfirmPush = async () => {
    setPushing(true)
    setError(null)
    setResult(null)
    try {
      const payload = {
        record_ids: signedRecords.map((r) => r.id),
        batch_id: batchId || undefined
      }
      const res = await api.pushToPortal(payload)
      setResult(res)
      if (res.success && onPushSuccess) {
        onPushSuccess(res)
      }
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Lỗi khi đẩy dữ liệu lên Cổng Quốc gia')
    } finally {
      setPushing(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: '680px' }} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--border)',
          background: '#f0fdf4',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '40px',
              height: '40px',
              borderRadius: '10px',
              background: '#16a34a',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <Send size={20} />
            </div>
            <div>
              <h3 style={{ fontSize: '15.5px', fontWeight: 700, color: '#14532d' }}>
                ĐẨY DỮ LIỆU ĐÃ KÝ SỐ LÊN CỔNG KHÁM SỨC KHỎE QUỐC GIA
              </h3>
              <p style={{ fontSize: '12px', color: '#166534' }}>
                Chỉ thực sự gửi dữ liệu lên Cổng sau khi hồ sơ đã được Ký số Điện tử Bệnh viện
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{
            background: '#f8fafc',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            padding: '12px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            fontSize: '13px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Cơ sở Khám chữa bệnh:</span>
              <strong>{maCskcb} - {tenBv}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Môi trường Cổng Quốc gia:</span>
              <span className={`badge ${isProd ? 'badge-danger' : 'badge-info'}`}>
                {isProd ? 'PRODUCTION (Chính thức)' : 'SANDBOX (Thử nghiệm / Kiểm thử)'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Số lượng hồ sơ ĐÃ KÝ SỐ sẽ đẩy:</span>
              <strong style={{ color: '#16a34a', fontSize: '14.5px' }}>{signedRecords.length} hồ sơ</strong>
            </div>
          </div>

          {/* Danh sách hồ sơ đã ký số */}
          <div style={{
            maxHeight: '190px',
            overflowY: 'auto',
            border: '1px solid var(--border)',
            borderRadius: '8px'
          }}>
            <table className="data-table" style={{ fontSize: '12px' }}>
              <thead>
                <tr>
                  <th>Mã KCB</th>
                  <th>Họ và tên</th>
                  <th>Số CCCD</th>
                  <th>Loại KSK</th>
                  <th>Trạng thái Chữ ký BV</th>
                </tr>
              </thead>
              <tbody>
                {signedRecords.map((r) => (
                  <tr key={r.id}>
                    <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{r.ma_kcb}</td>
                    <td style={{ fontWeight: 600 }}>{r.ho_va_ten}</td>
                    <td style={{ fontFamily: 'monospace' }}>{r.so_cccd}</td>
                    <td>{r.loai_ksk === 'LAI_XE' ? 'KSK Lái xe' : 'KSK Định kỳ'}</td>
                    <td>
                      <span className="badge badge-purple">
                        <Award size={11} /> Đã ký số ({r.cert_serial || 'Token'})
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {result && (
            <div style={{
              background: result.success ? '#f0fdf4' : '#fef2f2',
              border: `1px solid ${result.success ? '#bbf7d0' : '#fecaca'}`,
              borderRadius: '8px',
              padding: '14px 16px',
              color: result.success ? '#15803d' : '#b91c1c'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, fontSize: '14px' }}>
                {result.success ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
                <span>{result.message}</span>
              </div>
              <div style={{ fontSize: '12px', marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <div>• <strong>Mã biên nhận Cổng (Portal Msg ID):</strong> <code>{result.portal_msg_id}</code></div>
                <div>• <strong>Số hồ sơ tiếp nhận thành công:</strong> <strong>{result.pushed_count} hồ sơ</strong></div>
                {result.envelope_preview?.checksum && (
                  <div>• <strong>Checksum SHA256:</strong> <code>{result.envelope_preview.checksum}</code></div>
                )}
              </div>
            </div>
          )}

          {error && (
            <div style={{
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: '8px',
              padding: '12px 14px',
              color: '#b91c1c',
              fontWeight: 600
            }}>
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 20px',
          borderTop: '1px solid var(--border)',
          background: '#f8fafc',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: '10px'
        }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setResult(null)
              setError(null)
              onClose()
            }}
            disabled={pushing}
          >
            {result ? 'Đóng' : 'Hủy bỏ'}
          </button>
          {!result && (
            <button
              type="button"
              className="btn btn-success"
              onClick={handleConfirmPush}
              disabled={pushing || signedRecords.length === 0}
            >
              {pushing ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Đang đẩy dữ liệu lên Cổng Quốc gia...
                </>
              ) : (
                <>
                  <Send size={16} />
                  Xác nhận Đẩy lên Cổng Quốc gia ({signedRecords.length} hồ sơ)
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
