<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import StatsCard from './StatsCard.vue'
import ReservasTable from './ReservasTable.vue'
import { getStats, getReservas, exportarCSV, clearToken } from '../api.js'

// ─── Estado ─────────────────────────────────────────────
const stats    = ref(null)
const reservas = ref([])
const cargando = ref(false)
const error    = ref('')

// Filtros
const filtroFecha  = ref('')  // input date: YYYY-MM-DD
const filtroEstado = ref('todas')
const filtroSearch = ref('')

let intervalo = null

// ─── Helpers ─────────────────────────────────────────────

function isoADDMMYYYY(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

// ─── Carga de datos ───────────────────────────────────────

async function cargarStats() {
  try {
    stats.value = await getStats()
  } catch (e) {
    error.value = e.message
  }
}

async function cargarReservas() {
  cargando.value = true
  error.value    = ''
  try {
    const params = {
      fecha:  isoADDMMYYYY(filtroFecha.value) || undefined,
      estado: filtroEstado.value !== 'todas' ? filtroEstado.value : undefined,
      search: filtroSearch.value || undefined,
    }
    reservas.value = await getReservas(params)
  } catch (e) {
    error.value = e.message
  } finally {
    cargando.value = false
  }
}

async function cargarTodo() {
  await Promise.all([cargarStats(), cargarReservas()])
}

function onCancelada(id) {
  const r = reservas.value.find(r => r.id === id)
  if (r) r.estado = 'cancelada'
  cargarStats()
}

function salir() {
  clearToken()
  window.location.reload()
}

// ─── Ciclo de vida ────────────────────────────────────────

onMounted(() => {
  cargarTodo()
  intervalo = setInterval(cargarTodo, 60_000)
})

onUnmounted(() => clearInterval(intervalo))
</script>

<template>
  <div class="layout">
    <!-- Topbar -->
    <header class="topbar">
      <span class="topbar-title">🍽️ Panel de Reservas</span>
      <div class="topbar-right">
        <span class="topbar-info" v-if="stats">{{ stats.hoy.fecha }}</span>
        <button class="btn-salir" @click="salir">Salir</button>
      </div>
    </header>

    <main class="main">

      <!-- Stats -->
      <div class="stats" v-if="stats">
        <StatsCard :value="stats.hoy.confirmadas"    label="Confirmadas hoy"   color="#059669" />
        <StatsCard :value="stats.hoy.personas"       label="Personas hoy"      color="#6366f1" />
        <StatsCard :value="stats.proximos7dias.total" label="Próximos 7 días"  color="#0891b2" />
        <StatsCard :value="stats.hoy.canceladas"     label="Canceladas hoy"    color="#dc2626" />
      </div>
      <div class="stats-skeleton" v-else>
        <div v-for="i in 4" :key="i" class="skeleton"></div>
      </div>

      <!-- Filtros -->
      <div class="filtros">
        <input
          type="date"
          v-model="filtroFecha"
          title="Filtrar por fecha"
        />
        <select v-model="filtroEstado">
          <option value="todas">Todos los estados</option>
          <option value="confirmada">Confirmadas</option>
          <option value="cancelada">Canceladas</option>
        </select>
        <input
          type="text"
          v-model="filtroSearch"
          placeholder="Buscar por nombre o teléfono…"
          class="search"
        />
        <button class="btn-buscar" @click="cargarReservas" :disabled="cargando">
          {{ cargando ? '…' : 'Buscar' }}
        </button>
        <button class="btn-limpiar" @click="filtroFecha = ''; filtroEstado = 'todas'; filtroSearch = ''; cargarReservas()">
          Limpiar
        </button>
        <button class="btn-export" @click="exportarCSV" title="Exportar CSV">
          ⬇ CSV
        </button>
      </div>

      <!-- Error -->
      <p v-if="error" class="error">{{ error }}</p>

      <!-- Tabla -->
      <ReservasTable :reservas="reservas" @cancelada="onCancelada" />

      <p class="footer">{{ reservas.length }} resultado(s) · actualización automática cada 60 s</p>

    </main>
  </div>
</template>

<style scoped>
.layout { min-height: 100vh; display: flex; flex-direction: column; }

.topbar {
  background: #111827;
  color: #fff;
  padding: .85rem 1.5rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  position: sticky;
  top: 0;
  z-index: 10;
}
.topbar-title { font-size: 1rem; font-weight: 600; }
.topbar-right  { display: flex; align-items: center; gap: 1rem; }
.topbar-info   { font-size: .8rem; opacity: .65; }
.btn-salir     { background: transparent; border: 1px solid rgba(255,255,255,.3); color: #fff; font-size: .8rem; padding: .3rem .7rem; }
.btn-salir:hover { background: rgba(255,255,255,.1); }

.main { max-width: 1100px; margin: 0 auto; padding: 1.5rem 1rem; width: 100%; flex: 1; display: flex; flex-direction: column; gap: 1.25rem; }

.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: .85rem;
}
.stats-skeleton {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: .85rem;
}
.skeleton {
  height: 90px;
  border-radius: 10px;
  background: linear-gradient(90deg, #e5e7eb 25%, #f3f4f6 50%, #e5e7eb 75%);
  background-size: 200% 100%;
  animation: shimmer 1.2s infinite;
}
@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

.filtros {
  display: flex;
  flex-wrap: wrap;
  gap: .6rem;
  align-items: center;
}
.filtros input[type="date"],
.filtros select { min-width: 150px; }
.search { flex: 1; min-width: 200px; }

.btn-buscar  { background: #111827; color: #fff; font-weight: 600; }
.btn-buscar:hover:not(:disabled) { background: #374151; }
.btn-limpiar { background: #f3f4f6; color: #374151; }
.btn-limpiar:hover { background: #e5e7eb; }
.btn-export  { background: #065f46; color: #fff; }
.btn-export:hover { background: #047857; }

.error  { color: #dc2626; font-size: .875rem; }
.footer { color: #9ca3af; font-size: .75rem; text-align: right; }
</style>
