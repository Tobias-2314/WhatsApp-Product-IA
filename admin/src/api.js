const BASE = '/admin/api'

export function getToken() {
  return localStorage.getItem('adminToken') || ''
}

export function setToken(token) {
  localStorage.setItem('adminToken', token)
}

export function clearToken() {
  localStorage.removeItem('adminToken')
}

export function hasToken() {
  return !!localStorage.getItem('adminToken')
}

async function request(path, options = {}) {
  const token = getToken()
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  })
  if (res.status === 401) {
    clearToken()
    window.location.reload()
    return
  }
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`)
  return data
}

export function getStats() {
  return request('/stats')
}

export function getReservas(params = {}) {
  const q = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v))
  ).toString()
  return request(`/reservas${q ? '?' + q : ''}`)
}

export function cancelarReserva(id) {
  return request(`/reservas/${id}/cancelar`, { method: 'PUT' })
}

export function exportarCSV() {
  const token = getToken()
  window.open(`/admin/api/reservas/export?token=${encodeURIComponent(token)}`)
}
