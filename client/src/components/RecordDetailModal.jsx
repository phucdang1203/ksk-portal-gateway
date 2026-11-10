import React, { useState, useEffect } from 'react'
import {
  X, CheckCircle2, AlertCircle, Save, ShieldCheck, User,
  Activity, Stethoscope, FileSignature, Award, Loader2
} from 'lucide-react'
import { api } from '../services/api'

const FIELD_GROUPS = [
  {
    title: '1. Thông tin Hành chính & Định danh Công dân (Đề án 06)',
    icon: User,
    fields: [
      { key: 'ma_kcb', label: 'Mã KCB / Số phiếu *', required: true },
      { key: 'ma_benh_nhan', label: 'Mã Bệnh nhân', required: false },
      { key: 'ho_va_ten', label: 'Họ và tên *', required: true },
      { key: 'so_cccd', label: 'Số CCCD (12 số) / CMND (9 số) *', required: true },
      { key: 'ngay_sinh', label: 'Ngày sinh (YYYY-MM-DD) *', required: true },
      { key: 'gioi_tinh', label: 'Giới tính (Nam/Nữ) *', type: 'select', options: ['Nam', 'Nữ'], required: true },
      { key: 'so_dien_thoai', label: 'Số điện thoại', required: false },
      { key: 'dia_chi', label: 'Địa chỉ cư trú *', required: true },
      { key: 'ngay_kham', label: 'Ngày khám (YYYY-MM-DD) *', required: true },
      { key: 'loai_ksk', label: 'Loại KSK *', type: 'select', options: ['DINH_KY', 'LAI_XE'], required: true }
    ]
  },
  {
    title: '2. Chỉ số Thể lực & Sinh hiệu',
    icon: Activity,
    fields: [
      { key: 'chieu_cao', label: 'Chiều cao (cm) *', required: true },
      { key: 'can_nang', label: 'Cân nặng (kg) *', required: true },
      { key: 'bmi', label: 'Chỉ số BMI (Tự động tính)', required: false },
      { key: 'mach', label: 'Mạch (lần/phút) *', required: true },
      { key: 'huyet_ap', label: 'Huyết áp (TâmThu/TâmTrương, vd: 120/80) *', required: true }
    ]
  },
  {
    title: '3. Khám Lâm sàng & Cận lâm sàng',
    icon: Stethoscope,
    fields: [
      { key: 'kham_noi_khoa', label: 'Khám Nội khoa *', required: true },
      { key: 'kham_ngoai_khoa', label: 'Khám Ngoại khoa *', required: true },
      { key: 'kham_da_lieu', label: 'Khám Da liễu *', required: true },
      { key: 'kham_mat', label: 'Khám Mắt *', required: true },
      { key: 'kham_tmh', label: 'Khám Tai - Mũi - Họng *', required: true },
      { key: 'kham_rhm', label: 'Khám Răng - Hàm - Mặt *', required: true },
      { key: 'kham_san_phu_khoa', label: 'Khám Sản phụ khoa (Bắt buộc với Nữ)', required: false },
      { key: 'x_quang_phoi', label: 'Kết quả X-Quang phổi *', required: true },
      { key: 'cong_thuc_mau', label: 'Xét nghiệm Công thức máu *', required: true },
      { key: 'sinh_hoa_mau', label: 'Đường huyết / Sinh hóa máu', required: false },
      { key: 'xet_nghiem_nuoc_tieu', label: 'Xét nghiệm Nước tiểu *', required: true },
      { key: 'hang_bang_lai', label: 'Hạng bằng lái (Nếu KSK Lái xe)', required: false },
      { key: 'test_ma_tuy', label: 'Test Ma túy 4-5 chất (Nếu KSK Lái xe)', required: false },
      { key: 'nong_do_con', label: 'Nồng độ cồn (Nếu KSK Lái xe)', required: false }
    ]
  },
  {
    title: '4. Kết luận, Chữ ký Chuyên khoa & Chữ ký Bác sĩ Kết luận (Bắt buộc)',
    icon: FileSignature,
    fields: [
      {
        key: 'phan_loai_sk',
        label: 'Phân loại sức khỏe *',
        type: 'select',
        options: ['LOAI_I', 'LOAI_II', 'LOAI_III', 'LOAI_IV', 'LOAI_V', 'DU_DIEU_KIEN'],
        required: true
      },
      { key: 'ket_luan_benh', label: 'Kết luận bệnh tật (nếu có)', required: false },
      { key: 'bs_ket_luan', label: 'Họ tên Bác sĩ Kết luận *', required: true },
      { key: 'cchn_bs_ket_luan', label: 'Số CCHN Bác sĩ Kết luận *', required: true },
      {
        key: 'chuky_chuyen_khoa',
        label: 'Trạng thái Chữ ký Chuyên khoa *',
        type: 'select',
        options: ['Đã ký đủ', 'Chưa ký đủ'],
        required: true
      },
      {
        key: 'chuky_ket_luan',
        label: 'Trạng thái Chữ ký Bác sĩ Kết luận *',
        type: 'select',
        options: ['Đã ký', 'Chưa ký'],
        required: true
      },
      { key: 'ngay_ket_luan', label: 'Ngày kết luận (YYYY-MM-DD) *', required: true }
    ]
  }
]

export default function RecordDetailModal({ isOpen, recordId, onClose, onSaved }) {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [record, setRecord] = useState(null)
  const [formData, setFormData] = useState({})
  const [message, setMessage] = useState(null)

  useEffect(() => {
    if (isOpen && recordId) {
      loadDetail(recordId)
    }
  }, [isOpen, recordId])

  const loadDetail = async (id) => {
    setLoading(true)
    setMessage(null)
    try {
      const res = await api.getRecordDetail(id)
      if (res.success && res.data) {
        setRecord(res.data)
        setFormData(res.data.record_data || {})
      }
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.detail || err.message })
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) return null

  const errorFieldMap = {}
  const issues = record?.validation?.issues || []
  issues.forEach((iss) => {
    if (iss.severity === 'ERROR') {
      errorFieldMap[iss.field] = iss.message
    }
  })

  const handleFieldChange = (key, val) => {
    setFormData((prev) => ({ ...prev, [key]: val }))
  }

  const handleQuickFillComplete = () => {
    setFormData((prev) => ({
      ...prev,
      chieu_cao: prev.chieu_cao || '165',
      can_nang: prev.can_nang || '60',
      mach: prev.mach || '75',
      huyet_ap: prev.huyet_ap || '120/80',
      kham_noi_khoa: prev.kham_noi_khoa || 'Bình thường',
      kham_ngoai_khoa: prev.kham_ngoai_khoa || 'Bình thường',
      kham_da_lieu: prev.kham_da_lieu || 'Bình thường',
      kham_mat: prev.kham_mat || 'Thị lực hai mắt 10/10',
      kham_tmh: prev.kham_tmh || 'Tai mũi họng bình thường',
      kham_rhm: prev.kham_rhm || 'Răng hàm mặt bình thường',
      kham_san_phu_khoa: prev.gioi_tinh === 'Nữ' ? (prev.kham_san_phu_khoa || 'Bình thường') : prev.kham_san_phu_khoa,
      x_quang_phoi: prev.x_quang_phoi || 'Hình ảnh tim phổi bình thường',
      cong_thuc_mau: prev.cong_thuc_mau || 'Các chỉ số huyết học bình thường',
      xet_nghiem_nuoc_tieu: prev.xet_nghiem_nuoc_tieu || 'Tổng phân tích nước tiểu bình thường',
      phan_loai_sk: prev.phan_loai_sk || (prev.loai_ksk === 'LAI_XE' ? 'DU_DIEU_KIEN' : 'LOAI_I'),
      bs_ket_luan: prev.bs_ket_luan || 'BS.CKI TRẦN VĂN HÙNG',
      cchn_bs_ket_luan: prev.cchn_bs_ket_luan || '001256/KG-CCHN',
      chuky_chuyen_khoa: 'Đã ký đủ',
      chuky_ket_luan: 'Đã ký'
    }))
  }

  const handleSave = async () => {
    setSaving(true)
    setMessage(null)
    try {
      const res = await api.updateRecordFields(recordId, formData)
      if (res.success) {
        setRecord(res.data)
        setFormData(res.data.record_data || {})
        setMessage({
          type: res.data.is_eligible ? 'success' : 'warning',
          text: res.data.is_eligible
            ? 'Đã lưu! Hồ sơ đã ĐẦY ĐỦ 100% thông tin và chữ ký kết luận, sẵn sàng để Ký số Bệnh viện.'
            : `Đã lưu, nhưng hồ sơ vẫn còn ${res.data.error_count} trường thiếu/sai cần bổ sung.`
        })
        if (onSaved) onSaved(res.data)
      }
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.detail || err.message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: '920px' }} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{
          padding: '15px 20px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: '#f8fafc'
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 700 }}>
                Chi tiết & Kiểm tra Hồ sơ KSK: {record?.ho_va_ten || '...'} ({record?.ma_kcb || ''})
              </h3>
              {record && (
                record.is_eligible ? (
                  <span className="badge badge-success">
                    <CheckCircle2 size={13} /> Đủ điều kiện Ký số
                  </span>
                ) : (
                  <span className="badge badge-danger">
                    <AlertCircle size={13} /> Còn thiếu {record.error_count} thông tin bắt buộc
                  </span>
                )
              )}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
              Kiểm tra đầy đủ các trường hành chính, chuyên khoa, chữ ký kết luận và chữ ký điện tử Bệnh viện
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
        <div style={{ padding: '18px 20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {loading ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
              <Loader2 size={26} className="animate-spin" style={{ margin: '0 auto 8px' }} />
              Đang tải thông tin hồ sơ...
            </div>
          ) : (
            <>
              {/* Danh sách lỗi hiện tại */}
              {issues.length > 0 && (
                <div style={{
                  background: '#fff1f2',
                  border: '1px solid #fecdd3',
                  borderRadius: '8px',
                  padding: '12px 16px'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <div style={{ fontWeight: 700, color: '#be123c', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <AlertCircle size={16} />
                      Các thông tin còn thiếu / chưa hợp lệ cần bổ sung trước khi Ký số ({issues.length}):
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ padding: '4px 10px', fontSize: '12px' }}
                      onClick={handleQuickFillComplete}
                    >
                      Điền nhanh kết quả Bình thường & Đã ký kết luận
                    </button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', fontSize: '12.5px', color: '#9f1239' }}>
                    {issues.map((iss, idx) => (
                      <div key={idx}>
                        • <strong>{iss.field_label}:</strong> {iss.message}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Thông tin Chữ ký số Bệnh viện nếu đã ký */}
              {record?.signing_status === 'SIGNED' && (
                <div style={{
                  background: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                  borderRadius: '8px',
                  padding: '12px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <Award size={22} color="#16a34a" />
                    <div>
                      <div style={{ fontWeight: 700, color: '#166534', fontSize: '13.5px' }}>
                        Hồ sơ ĐÃ KÝ SỐ ĐIỆN TỬ BỆNH VIỆN (Sẵn sàng đẩy Cổng)
                      </div>
                      <div style={{ fontSize: '12px', color: '#15803d', marginTop: '2px' }}>
                        Chứng thư số: <strong>{record.cert_subject}</strong> | Serial: <code>{record.cert_serial}</code> | Lúc: {record.signed_at}
                      </div>
                    </div>
                  </div>
                  <span className="badge badge-success">RSASHA256 Verified</span>
                </div>
              )}

              {message && (
                <div style={{
                  padding: '10px 14px',
                  borderRadius: '8px',
                  background: message.type === 'success' ? '#f0fdf4' : message.type === 'warning' ? '#fffbeb' : '#fef2f2',
                  border: `1px solid ${message.type === 'success' ? '#bbf7d0' : message.type === 'warning' ? '#fde68a' : '#fecaca'}`,
                  color: message.type === 'success' ? '#15803d' : message.type === 'warning' ? '#b45309' : '#b91c1c',
                  fontWeight: 600,
                  fontSize: '13px'
                }}>
                  {message.text}
                </div>
              )}

              {/* Các nhóm trường dữ liệu */}
              {FIELD_GROUPS.map((group, gIdx) => {
                const IconComp = group.icon
                return (
                  <div
                    key={gIdx}
                    style={{
                      border: '1px solid var(--border)',
                      borderRadius: '8px',
                      padding: '14px 16px',
                      background: '#ffffff'
                    }}
                  >
                    <div style={{
                      fontWeight: 700,
                      fontSize: '13.5px',
                      color: 'var(--text-main)',
                      marginBottom: '12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      borderBottom: '1px solid #f1f5f9',
                      paddingBottom: '8px'
                    }}>
                      <IconComp size={16} color="#0284c7" />
                      {group.title}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
                      {group.fields.map((f) => {
                        const hasErr = Boolean(errorFieldMap[f.key])
                        const val = formData[f.key] ?? ''
                        return (
                          <div key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <label style={{
                              fontSize: '12px',
                              fontWeight: 600,
                              color: hasErr ? '#dc2626' : 'var(--text-muted)'
                            }}>
                              {f.label}
                            </label>
                            {f.type === 'select' ? (
                              <select
                                className="form-control"
                                style={{
                                  borderColor: hasErr ? '#ef4444' : undefined,
                                  backgroundColor: hasErr ? '#fff1f2' : '#ffffff'
                                }}
                                value={val}
                                onChange={(e) => handleFieldChange(f.key, e.target.value)}
                              >
                                <option value="">-- Chọn --</option>
                                {f.options.map((opt) => (
                                  <option key={opt} value={opt}>{opt}</option>
                                ))}
                              </select>
                            ) : (
                              <input
                                type="text"
                                className="form-control"
                                style={{
                                  borderColor: hasErr ? '#ef4444' : undefined,
                                  backgroundColor: hasErr ? '#fff1f2' : '#ffffff'
                                }}
                                value={val}
                                onChange={(e) => handleFieldChange(f.key, e.target.value)}
                              />
                            )}
                            {hasErr && (
                              <span style={{ fontSize: '11px', color: '#dc2626' }}>
                                {errorFieldMap[f.key]}
                              </span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '13px 20px',
          borderTop: '1px solid var(--border)',
          background: '#f8fafc',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            * Mọi chỉnh sửa thông tin sẽ được kiểm tra lại tự động theo quy chuẩn Bộ Y Tế.
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Đóng
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSave}
              disabled={saving || loading}
            >
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              Lưu thông tin & Kiểm tra lại
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
