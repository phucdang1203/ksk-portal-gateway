import React, { createContext, useContext, useState, useEffect } from 'react'

const STORAGE_PERM_DISPLAY_KEY = 'ksk_gateway_show_perm_codes'

const PermissionDisplayContext = createContext({
  showPermCodes: false,
  setShowPermCodes: () => {},
  togglePermCodes: () => {},
  isAdmin: false
})

export function isAdminUser(user) {
  if (!user) return false
  if (user.is_admin === true || user.permission_level === 0) return true
  const role = String(user.role || '').trim().toLowerCase()
  if (role === 'admin') return true
  const perms = Array.isArray(user.permissions) ? user.permissions : []
  return perms.includes('0') || perms.includes('*')
}

export function hasPerm(user, permCode) {
  if (!user) return false
  if (!permCode) return true
  if (isAdminUser(user)) return true
  const perms = Array.isArray(user.permissions) ? user.permissions : []
  return perms.includes(permCode)
}

export function hasAnyPerm(user, ...permCodes) {
  if (!user) return false
  if (isAdminUser(user)) return true
  const flat = permCodes.flat().filter(Boolean)
  if (flat.length === 0) return true
  return flat.some((code) => hasPerm(user, code))
}

export function getRoleMeta(role) {
  const r = String(role || 'staff').trim().toLowerCase()
  if (r === 'admin') {
    return { label: 'Quản trị viên', icon: '👑', badgeClass: 'badge-purple' }
  }
  if (r === 'truong_phong') {
    return { label: 'Trưởng khoa/phòng', icon: '⭐', badgeClass: 'badge-warning' }
  }
  return { label: 'Nhân viên', icon: '👤', badgeClass: 'badge-info' }
}

export function PermissionDisplayProvider({ user, children }) {
  const isAdmin = isAdminUser(user)
  const [showPermCodes, setShowPermCodesState] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_PERM_DISPLAY_KEY) === 'true'
    } catch (e) {
      return false
    }
  })

  useEffect(() => {
    if (!isAdmin && showPermCodes) {
      setShowPermCodesState(false)
    }
  }, [isAdmin, showPermCodes])

  const setShowPermCodes = (val) => {
    const boolVal = Boolean(val)
    setShowPermCodesState(boolVal)
    try {
      localStorage.setItem(STORAGE_PERM_DISPLAY_KEY, String(boolVal))
    } catch (e) {}
  }

  const togglePermCodes = () => setShowPermCodes(!showPermCodes)

  return (
    <PermissionDisplayContext.Provider
      value={{
        showPermCodes: isAdmin && showPermCodes,
        setShowPermCodes,
        togglePermCodes,
        isAdmin
      }}
    >
      {children}
    </PermissionDisplayContext.Provider>
  )
}

export function usePermissionDisplay() {
  return useContext(PermissionDisplayContext)
}

export function PermBadge({ code, alwaysShow = false, style = {} }) {
  const { showPermCodes } = usePermissionDisplay()
  if (!code) return null
  if (!alwaysShow && !showPermCodes) return null

  return (
    <span
      className="perm-code-badge"
      title={`Mã phân quyền chức năng: ${code}`}
      style={style}
      onClick={(e) => e.stopPropagation()}
    >
      {code}
    </span>
  )
}
