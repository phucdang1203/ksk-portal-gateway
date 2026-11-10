import React, { useState, useEffect } from 'react'
import {
  X, KeyRound, ShieldCheck, AlertTriangle, CheckCircle2,
  RefreshCw, Loader2, Award, Edit3, CheckSquare, Usb
} from 'lucide-react'
import { api } from '../services/api'

export default function UsbTokenSignModal({
  isOpen,
  onClose,
  batchId,
  selectedRecordIds,
  onSignCompleted,
  onOpenRecordEdit
}) {
  const [checking, setChecking] = useState(false)
  const [prepResult, setPrepResult] = useState(null)
  const [certs, setCerts] = useState([])
  const [hardwareCount, setHardwareCount] = useState(0)
  const [selectedThumbprint, setSelectedThumbprint] = useState('')
  const [loadingCerts, setLoadingCerts] = useState(false)
  const [signing, setSigning] = useState(false)
  const [signSuccessData, setSignSuccessData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (isOpen) {
      setSignSuccessData(null)
      setError(null)
      runPreSignCheck('STRICT_ALL')
      scanClientUsbTokens()
    }
  }, [isOpen, batchId, selectedRecordIds?.length])

  const scanClientUsbTokens = async () => {
    setLoadingCerts(true)
    try {
      const res = await api.listClientUsbCertificates()
      const list = res.certificates || []
      setCerts(list)
      setHardwareCount(res.hardwareCount || 0)
      if (list.length > 0) {
        setSelectedThumbprint(list[0].thumbprint)
      }
    } catch (err) {
      console.error('Lỗi quét USB Token:', err)
    } finally {
      setLoadingCerts(false)
    }
  }

  const runPreSignCheck = async (mode = 'STRICT_ALL') => {
    setChecking(true)
    setError(null)
    try {
      const payload = {
        sign_mode: mode,
        batch_id: batchId || undefined,
        record_ids: selectedRecordIds?.length > 0 ? selectedRecordIds : undefined
      }
      const res = await api.prepareSigning(payload)
      setPrepResult(res)
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Lỗi kiểm tra điều kiện trước khi ký số')
    } finally {
      setChecking(false)
    }
  }

  const handleSwitchToSignEligibleOnly = () => {
    runPreSignCheck('ELIGIBLE_ONLY')
  }

  const handleExecuteBatchSign = async () => {
    if (!prepResult?.can_sign || !prepResult?.signing_package) return
    const pkg = prepResult.signing_package
    const chosenCert = certs.find((c) => c.thumbprint === selectedThumbprint) || certs[0]

    setSigning(true)
    setError(null)
    try {
      // 1. Gọi trực tiếp USB Token cắm tại máy Client để ký số 1 lần cho toàn bộ gói Digest
      const clientSignRes = await api.signWithClientUsbToken({
        thumbprint: chosenCert?.thumbprint,
        providerType: chosenCert?.providerType,
        stringToSign: pkg.string_to_sign,
        certInfo: chosenCert
      })

      if (!clientSignRes.success) {
        setError(clientSignRes.error || 'Ký số trên USB Token máy Client thất bại')
        setSigning(false)
        return
      }

      // 2. Gửi chữ ký số Bệnh viện lên Server để lưu vào toàn bộ hồ sơ đủ điều kiện
      const commitRes = await api.commitSignature({
        package_id: pkg.package_id,
        batch_id: batchId || undefined,
        record_ids: prepResult.eligible_record_ids,
        header: pkg.header,
        data_base64: pkg.data_base64,
        checksum: pkg.checksum,
        string_to_sign: pkg.string_to_sign,
        hospital_signature: clientSignRes.hospital_signature,
        record_digests: pkg.record_digests,
        cert_info: chosenCert || {},
        use_soft_token_fallback: Boolean(clientSignRes.use_soft_token_fallback)
      })

      if (commitRes.success) {
        setSignSuccessData(commitRes)
        if (onSignCompleted) onSignCompleted(commitRes)
      }
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Lỗi khi lưu chữ ký số Bệnh viện')
    } finally {
      setSigning(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: '760px' }} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--border)',
          background: 'linear-gradient(135deg, #eef2ff, #f0f9ff)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '40px',
              height: '40px',
              borderRadius: '10px',
              background: '#4f46e5',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <KeyRound size={22} />
            </div>
            <div>
              <h3 style={{ fontSize: '15.5px', fontWeight: 700, color: '#1e1b4b' }}>
                KÝ SỐ ĐIỆN TỬ BỆNH VIỆN (USB TOKEN CẮM TẠI MÁY CLIENT)
              </h3>
              <p style={{ fontSize: '12px', color: '#475569' }}>
                Kiểm tra đầy đủ thông tin trước khi ký • Ký số 1 lần duy nhất cho toàn bộ hồ sơ đủ điều kiện
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
        <div style={{ padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {checking ? (
            <div style={{ padding: '36px', textAlign: 'center', color: 'var(--text-muted)' }}>
              <Loader2 size={28} className="animate-spin" style={{ margin: '0 auto 10px', color: '#4f46e5' }} />
              Đang kiểm tra (Check) đầy đủ các trường thông tin & chữ ký kết luận của hồ sơ trước khi mở khóa Ký số...
            </div>
          ) : signSuccessData ? (
            <div style={{
              background: '#f0fdf4',
              border: '1px solid #bbf7d0',
              borderRadius: '10px',
              padding: '20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#15803d', fontWeight: 700, fontSize: '15px' }}>
                <CheckCircle2 size={24} />
                <span>{signSuccessData.message}</span>
              </div>
              <div style={{
                background: '#ffffff',
                border: '1px solid #dcfce7',
                borderRadius: '8px',
                padding: '12px 14px',
                fontSize: '12.5px',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px'
              }}>
                <div>• <strong>Mã Gói Ký Số (Package ID):</strong> <code>{signSuccessData.package_id}</code></div>
                <div>• <strong>Số lượng hồ sơ đã ký số (1 lần):</strong> <strong>{signSuccessData.signed_count} hồ sơ</strong></div>
                <div>• <strong>Chứng thư số Bệnh viện:</strong> {signSuccessData.cert_subject}</div>
                <div>• <strong>Số Serial Chứng thư:</strong> <code>{signSuccessData.cert_serial}</code></div>
                <div>• <strong>Thời điểm ký:</strong> {signSuccessData.signed_at}</div>
                <div>• <strong>Chữ ký số RSASHA256:</strong> <code style={{ fontSize: '11px', color: '#0369a1' }}>{signSuccessData.signature_preview}</code></div>
              </div>
              <div style={{ fontSize: '12.5px', color: '#166534', fontWeight: 600 }}>
                👉 Bước tiếp theo: Đóng cửa sổ này và bấm nút <strong>"3. Đẩy dữ liệu lên Cổng Quốc gia"</strong> để gửi gói tin đã ký số lên Cổng.
              </div>
            </div>
          ) : (
            <>
              {/* KẾT QUẢ BƯỚC 1: KIỂM TRA HỒ SƠ THIẾU THÔNG TIN TRƯỚC KHI KÝ */}
              {prepResult && !prepResult.can_sign && (
                <div style={{
                  background: '#fff1f2',
                  border: '1px solid #fecdd3',
                  borderRadius: '10px',
                  padding: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px'
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                    <AlertTriangle size={22} color="#e11d48" style={{ flexShrink: 0, marginTop: '2px' }} />
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '14px', color: '#9f1239' }}>
                        CHẶN KÝ SỐ TOÀN BỘ: Phát hiện {prepResult.incomplete_count}/{prepResult.total_requested} hồ sơ còn thiếu thông tin!
                      </div>
                      <div style={{ fontSize: '12.5px', color: '#be123c', marginTop: '3px' }}>
                        Theo quy định, hệ thống kiểm tra trước các hồ sơ còn thiếu thông tin. Khi đầy đủ hết mới được ký số toàn bộ, hoặc bạn có thể chọn <strong>Ký số Bệnh viện riêng cho {prepResult.eligible_count} hồ sơ đã đầy đủ thông tin</strong>.
                      </div>
                    </div>
                  </div>

                  {/* Bảng các hồ sơ còn thiếu thông tin */}
                  {prepResult.incomplete_records?.length > 0 && (
                    <div style={{
                      maxHeight: '180px',
                      overflowY: 'auto',
                      background: '#ffffff',
                      border: '1px solid #fecdd3',
                      borderRadius: '6px'
                    }}>
                      <table className="data-table" style={{ fontSize: '12px' }}>
                        <thead>
                          <tr>
                            <th>Mã KCB</th>
                            <th>Họ và tên</th>
                            <th>Thông tin / Chữ ký còn thiếu</th>
                            <th style={{ textAlign: 'center' }}>Bổ sung</th>
                          </tr>
                        </thead>
                        <tbody>
                          {prepResult.incomplete_records.map((inc) => (
                            <tr key={inc.id}>
                              <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{inc.ma_kcb}</td>
                              <td style={{ fontWeight: 600 }}>{inc.ho_va_ten}</td>
                              <td style={{ color: '#dc2626' }}>{inc.missing_fields.join(', ')}</td>
                              <td style={{ textAlign: 'center' }}>
                                <button
                                  type="button"
                                  className="btn btn-secondary"
                                  style={{ padding: '3px 8px', fontSize: '11.5px' }}
                                  onClick={() => {
                                    onClose()
                                    if (onOpenRecordEdit) onOpenRecordEdit(inc.id)
                                  }}
                                >
                                  <Edit3 size={12} /> Sửa ngay
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Nút cho phép ký số đối với những hồ sơ đã đầy đủ thông tin */}
                  {prepResult.eligible_count > 0 && (
                    <div style={{
                      background: '#f0fdf4',
                      border: '1px solid #bbf7d0',
                      borderRadius: '8px',
                      padding: '12px 14px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '12px'
                    }}>
                      <div style={{ fontSize: '12.5px', color: '#166534' }}>
                        Hiện có <strong>{prepResult.eligible_count} hồ sơ</strong> đã đầy đủ 100% các trường và chữ ký kết luận. Bạn có muốn ký số Bệnh viện trước cho {prepResult.eligible_count} hồ sơ này không?
                      </div>
                      <button
                        type="button"
                        className="btn btn-success"
                        onClick={handleSwitchToSignEligibleOnly}
                      >
                        <CheckSquare size={15} />
                        Ký số cho {prepResult.eligible_count} hồ sơ đã đầy đủ thông tin
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* KHI HỒ SƠ ĐÃ ĐỦ ĐIỀU KIỆN KÝ SỐ -> HIỂN THỊ CHỨNG THƯ SỐ USB TOKEN TẠI MÁY CLIENT */}
              {prepResult && prepResult.can_sign && prepResult.signing_package && (
                <>
                  <div style={{
                    background: '#f0fdf4',
                    border: '1px solid #bbf7d0',
                    borderRadius: '8px',
                    padding: '12px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#166534' }}>
                      <ShieldCheck size={20} color="#16a34a" />
                      <div>
                        <div style={{ fontWeight: 700 }}>
                          Kiểm tra hoàn tất: {prepResult.eligible_count} hồ sơ đã đầy đủ 100% trường dữ liệu & Chữ ký Bác sĩ Kết luận!
                        </div>
                        <div style={{ fontSize: '12px', color: '#15803d' }}>
                          Hệ thống đã gom {prepResult.eligible_count} hồ sơ vào 1 gói Digest duy nhất để USB Token ký số 1 lần.
                        </div>
                      </div>
                    </div>
                    <span className="badge badge-success">Hợp chuẩn 100%</span>
                  </div>

                  {/* Chọn thiết bị USB Token cắm trên máy Client */}
                  <div style={{
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    padding: '14px 16px',
                    background: '#ffffff'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                      <div style={{ fontWeight: 700, fontSize: '13.5px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Usb size={16} color="#4f46e5" />
                        Thiết bị Chữ ký số Điện tử Bệnh viện cắm tại máy Client ({certs.length})
                      </div>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ padding: '4px 10px', fontSize: '12px' }}
                        onClick={scanClientUsbTokens}
                        disabled={loadingCerts}
                      >
                        <RefreshCw size={13} className={loadingCerts ? 'animate-spin' : ''} />
                        Quét lại USB Token
                      </button>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {certs.map((c) => {
                        const isSelected = c.thumbprint === selectedThumbprint
                        return (
                          <div
                            key={c.thumbprint}
                            onClick={() => setSelectedThumbprint(c.thumbprint)}
                            style={{
                              padding: '10px 14px',
                              borderRadius: '8px',
                              border: isSelected ? '2px solid #4f46e5' : '1px solid var(--border)',
                              background: isSelected ? '#eef2ff' : '#f8fafc',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: '10px'
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <Award size={20} color={c.isHardwareToken ? '#16a34a' : '#4f46e5'} />
                              <div>
                                <div style={{ fontWeight: 700, fontSize: '13px', color: '#1e1b4b' }}>
                                  {c.friendlyName || c.subject}
                                </div>
                                <div style={{ fontSize: '11.5px', color: '#475569' }}>
                                  Subject: {c.subject}
                                </div>
                                <div style={{ fontSize: '11px', color: '#64748b' }}>
                                  Serial: <code>{c.serialNumber}</code> | Hạn dùng: {c.notBefore} → {c.notAfter}
                                </div>
                              </div>
                            </div>
                            <span className={`badge ${c.isHardwareToken ? 'badge-success' : 'badge-info'}`}>
                              {c.isHardwareToken ? 'USB Token Vật lý' : 'Chứng thư số Client'}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  {/* Thông tin gói Digest ký 1 lần */}
                  <div style={{
                    background: '#f8fafc',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    padding: '12px 16px',
                    fontSize: '12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px'
                  }}>
                    <div><strong>Mã gói ký số (Package ID):</strong> <code>{prepResult.signing_package.package_id}</code></div>
                    <div><strong>Số lượng hồ sơ ký trong 1 lần:</strong> <strong>{prepResult.eligible_count} hồ sơ</strong></div>
                    <div><strong>Chuẩn ký số:</strong> Phụ lục 02 - QĐ 2062/QĐ-BYT (<code>RSASHA256</code>)</div>
                    <div style={{ wordBreak: 'break-all' }}>
                      <strong>Chuỗi băm cần ký (String-To-Sign):</strong> <code style={{ color: '#0284c7' }}>{prepResult.signing_package.string_to_sign}</code>
                    </div>
                  </div>
                </>
              )}

              {error && (
                <div style={{
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  color: '#b91c1c',
                  padding: '12px 14px',
                  borderRadius: '8px',
                  fontSize: '12.5px',
                  fontWeight: 600
                }}>
                  {error}
                </div>
              )}
            </>
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
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={signing}>
            {signSuccessData ? 'Hoàn tất & Đóng' : 'Đóng'}
          </button>
          {!signSuccessData && prepResult?.can_sign && (
            <button
              type="button"
              className="btn btn-indigo"
              onClick={handleExecuteBatchSign}
              disabled={signing}
            >
              {signing ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Đang ký số trên USB Token...
                </>
              ) : (
                <>
                  <KeyRound size={16} />
                  Thực hiện Ký số Bệnh viện (1 lần cho {prepResult.eligible_count} hồ sơ)
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
