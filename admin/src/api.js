import { io } from 'socket.io-client'

const BASE = '/admin/api'

export const socket = io()

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

export function marcarNoShow(id) {
  return request(`/reservas/${id}/no-show`, { method: 'PUT' })
}

export function exportarCSV(params = {}) {
  const token = getToken()
  const q = new URLSearchParams(
    Object.fromEntries(Object.entries({ ...params, token }).filter(([, v]) => v))
  ).toString()
  window.open(`/admin/api/reservas/export?${q}`)
}

export function getOcupacion(fecha) {
  return request(`/ocupacion${fecha ? '?fecha=' + encodeURIComponent(fecha) : ''}`)
}

export function getAnalytics(params = {}) {
  const q = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v))
  ).toString()
  return request(`/analytics${q ? '?' + q : ''}`)
}

export function getMesas() {
  return request('/mesas')
}

export function crearMesa(data) {
  return request('/mesas', { method: 'POST', body: JSON.stringify(data) })
}

export function actualizarMesa(id, data) {
  return request(`/mesas/${id}`, { method: 'PUT', body: JSON.stringify(data) })
}

export function getCombinaciones() {
  return request('/combinaciones')
}

export function agregarCombinacion(mesaId1, mesaId2) {
  return request('/combinaciones', { method: 'POST', body: JSON.stringify({ mesaId1, mesaId2 }) })
}

export function eliminarCombinacion(mesaId1, mesaId2) {
  return request('/combinaciones', { method: 'DELETE', body: JSON.stringify({ mesaId1, mesaId2 }) })
}
