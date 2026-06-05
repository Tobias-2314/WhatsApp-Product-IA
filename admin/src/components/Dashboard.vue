<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import StatsCard from './StatsCard.vue'
import ReservasTable from './ReservasTable.vue'
import MesasPanel from './MesasPanel.vue'
import OcupacionPanel from './OcupacionPanel.vue'
import AnalyticsPanel from './AnalyticsPanel.vue'
import ConfigPanel from './ConfigPanel.vue'
import FechasBloqueadasPanel from './FechasBloqueadasPanel.vue'
import { getStats, getReservas, exportarCSV, clearToken, socket, abrirImpresion, getConfig } from '../api.js'

const tabActiva = ref('reservas')

// ─── Estado ─────────────────────────────────────────────
const stats    = ref(null)
const reservas = ref([])
const cargando = ref(false)
const error    = ref('')

// Filtros
const filtroFecha  = ref('')  // input date: YYYY-MM-DD
const filtroEstado = ref('todas')
const filtroSearch = ref('')

// Nombre del restaurante
const nombreRestaurante = ref('Panel de Reservas')

// Cargar nombre del restaurante
getConfig().then(cfg => {
  if (cfg.nombre) nombreRestaurante.value = cfg.nombre
}).catch(() => {})

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

function onNoShow(id) {
  const r = reservas.value.find(r => r.id === id)
  if (r) r.estado = 'no_show'
  cargarStats()
}

function salir() {
  clearToken()
  window.location.reload()
}

function exportar() {
  const params = {
    fecha:  isoADDMMYYYY(filtroFecha.value) || undefined,
    estado: filtroEstado.value !== 'todas' ? filtroEstado.value : undefined,
    search: filtroSearch.value || undefined,
  }
  exportarCSV(params)
}

function imprimir() {
  const fecha = filtroFecha.value
    ? `${filtroFecha.value.split('-')[2]}/${filtroFecha.value.split('-')[1]}/${filtroFecha.value.split('-')[0]}`
    : (() => {
        const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }))
        return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`
      })()
  abrirImpresion(fecha)
}

function onConfigUpdated(cfg) {
  if (cfg.nombre) nombreRestaurante.value = cfg.nombre
}

// ─── Ciclo de vida ────────────────────────────────────────

onMounted(() => {
  cargarTodo()
  socket.on('reserva:nueva',     cargarTodo)
  socket.on('reserva:cancelada', cargarTodo)
  socket.on('reserva:modificada', cargarTodo)
  socket.on('reserva:no_show',   cargarTodo)
})

onUnmounted(() => {
  socket.off('reserva:nueva',     cargarTodo)
  socket.off('reserva:cancelada', cargarTodo)
  socket.off('reserva:modificada', cargarTodo)
  socket.off('reserva:no_show',   cargarTodo)
})
</script>

<template>
  <div class="layout">
    <header class="topbar">
      <div class="topbar-brand">
        <span class="brand-icon">🍽️</span>
        <div>
          <div class="brand-name">{{ nombreRestaurante }}</div>
          <div class="brand-sub">Panel de Administración</div>
        </div>
      </div>

      <nav class="tabs">
        <button class="tab" :class="{ active: tabActiva === 'reservas' }"       @click="tabActiva = 'reservas'">
          <span class="tab-icon">📅</span> Reservas
        </button>
        <button class="tab" :class="{ active: tabActiva === 'ocupacion' }"      @click="tabActiva = 'ocupacion'">
          <span class="tab-icon">🏠</span> Salón
        </button>
        <button class="tab" :class="{ active: tabActiva === 'analytics' }"      @click="tabActiva = 'analytics'">
          <span class="tab-icon">📈</span> Analytics
        </button>
        <button class="tab" :class="{ active: tabActiva === 'mesas' }"          @click="tabActiva = 'mesas'">
          <span class="tab-icon">🪑</span> Mesas
        </button>
        <button class="tab" :class="{ active: tabActiva === 'fechas' }"          @click="tabActiva = 'fechas'">
          <span class="tab-icon">🔒</span> Fechas
        </button>
        <button class="tab" :class="{ active: tabActiva === 'configuracion' }"  @click="tabActiva = 'configuracion'">
          <span class="tab-icon">⚙️</span> Config
        </button>
      </nav>

      <div class="topbar-right">
        <div class="topbar-date" v-if="stats">
          <span class="date-dot"></span>
          {{ stats.hoy.fecha }}
        </div>
        <button class="btn-salir" @click="salir">Salir</button>
      </div>
    </header>

    <main class="main">

      <!-- ── PESTAÑA RESERVAS ── -->
      <template v-if="tabActiva === 'reservas'">
        <div class="stats" v-if="stats">
          <StatsCard :value="stats.hoy.confirmadas"     label="Confirmadas hoy"  color="#059669" icon="✅" />
          <StatsCard :value="stats.hoy.personas"        label="Personas hoy"     color="#6366f1" icon="👥" />
          <StatsCard :value="stats.proximos7dias.total" label="Próx. 7 días"     color="#0891b2" icon="📆" />
          <StatsCard :value="stats.hoy.canceladas"      label="Canceladas hoy"   color="#dc2626" icon="❌" />
          <StatsCard :value="stats.hoy.no_shows || 0"   label="No-shows hoy"     color="#d97706" icon="⚠️" />
        </div>
        <div class="stats-skeleton" v-else>
          <div v-for="i in 5" :key="i" class="skeleton"></div>
        </div>

        <div class="toolbar">
          <div class="filtros">
            <div class="filtro-group">
              <label class="filtro-label">Fecha</label>
              <input type="date" v-model="filtroFecha" />
            </div>
            <div class="filtro-group">
              <label class="filtro-label">Estado</label>
              <select v-model="filtroEstado">
                <option value="todas">Todos</option>
                <option value="confirmada">Confirmadas</option>
                <option value="cancelada">Canceladas</option>
                <option value="no_show">No-shows</option>
              </select>
            </div>
            <div class="filtro-group filtro-search">
              <label class="filtro-label">Buscar</label>
              <input type="text" v-model="filtroSearch" placeholder="Nombre o teléfono…" />
            </div>
          </div>
          <div class="toolbar-actions">
            <button class="btn-action btn-buscar" @click="cargarReservas" :disabled="cargando">
              {{ cargando ? '…' : '🔍 Buscar' }}
            </button>
            <button class="btn-action btn-limpiar" @click="filtroFecha = ''; filtroEstado = 'todas'; filtroSearch = ''; cargarReservas()">
              Limpiar
            </button>
            <button class="btn-action btn-print" @click="imprimir" title="Imprimir reservas del día">
              🖨️ Imprimir
            </button>
            <button class="btn-action btn-export" @click="exportar" title="Exportar CSV">
              ⬇ CSV
            </button>
          </div>
        </div>

        <p v-if="error" class="error-msg">{{ error }}</p>

        <ReservasTable :reservas="reservas" @cancelada="onCancelada" @noshow="onNoShow" />

        <p class="footer-info">
          <span>{{ reservas.length }} resultado(s)</span>
          <span class="realtime-dot">● En tiempo real</span>
        </p>
      </template>

      <!-- ── PESTAÑA SALÓN ── -->
      <OcupacionPanel v-else-if="tabActiva === 'ocupacion'" />

      <!-- ── PESTAÑA ANALYTICS ── -->
      <AnalyticsPanel v-else-if="tabActiva === 'analytics'" />

      <!-- ── PESTAÑA MESAS ── -->
      <MesasPanel v-else-if="tabActiva === 'mesas'" />

      <!-- ── PESTAÑA FECHAS BLOQUEADAS ── -->
      <FechasBloqueadasPanel v-else-if="tabActiva === 'fechas'" />

      <!-- ── PESTAÑA CONFIG ── -->
      <ConfigPanel v-else-if="tabActiva === 'configuracion'" @updated="onConfigUpdated" />

    </main>
  </div>
</template>

<style scoped>
.layout { min-height: 100vh; display: flex; flex-direction: column; background: #f8fafc; }

/* ── Topbar ── */
.topbar {
  background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%);
  padding: 0 1.5rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  position: sticky;
  top: 0;
  z-index: 100;
  box-shadow: 0 2px 12px rgba(0,0,0,.25);
  min-height: 60px;
  gap: 1rem;
}

.topbar-brand {
  display: flex;
  align-items: center;
  gap: .75rem;
  flex-shrink: 0;
}
.brand-icon { font-size: 1.5rem; }
.brand-name { font-size: .95rem; font-weight: 800; color: #fff; letter-spacing: -.01em; white-space: nowrap; }
.brand-sub  { font-size: .65rem; color: rgba(255,255,255,.45); white-space: nowrap; }

.tabs {
  display: flex;
  gap: .15rem;
  flex: 1;
  justify-content: center;
  overflow-x: auto;
}
.tab {
  background: transparent;
  border: none;
  color: rgba(255,255,255,.55);
  font-size: .8rem;
  padding: .5rem .85rem;
  border-radius: 7px;
  cursor: pointer;
  font-family: inherit;
  font-weight: 500;
  transition: all .15s;
  display: flex;
  align-items: center;
  gap: .35rem;
  white-space: nowrap;
}
.tab-icon { font-size: .85rem; }
.tab:hover  { background: rgba(255,255,255,.1); color: #fff; }
.tab.active { background: rgba(255,255,255,.16); color: #fff; font-weight: 700; box-shadow: inset 0 -2px 0 #6366f1; }

.topbar-right { display: flex; align-items: center; gap: .75rem; flex-shrink: 0; }
.topbar-date  { display: flex; align-items: center; gap: .4rem; font-size: .78rem; color: rgba(255,255,255,.6); }
.date-dot     { width: 6px; height: 6px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 0 2px rgba(34,197,94,.3); }
.btn-salir    { background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.2); color: #fff; font-size: .78rem; padding: .35rem .8rem; border-radius: 6px; cursor: pointer; font-family: inherit; transition: background .15s; white-space: nowrap; }
.btn-salir:hover { background: rgba(255,255,255,.18); }

/* ── Main ── */
.main { max-width: 1280px; margin: 0 auto; padding: 1.5rem 1.25rem; width: 100%; flex: 1; display: flex; flex-direction: column; gap: 1.25rem; }

/* ── Stats ── */
.stats {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: .85rem;
}
@media (max-width: 900px) {
  .stats { grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); }
}
.stats-skeleton {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: .85rem;
}
@media (max-width: 900px) { .stats-skeleton { grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); } }
.skeleton {
  height: 90px;
  border-radius: 12px;
  background: linear-gradient(90deg, #e2e8f0 25%, #f1f5f9 50%, #e2e8f0 75%);
  background-size: 200% 100%;
  animation: shimmer 1.3s infinite;
}
@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

/* ── Toolbar ── */
.toolbar {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 1rem 1.25rem;
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 1rem;
  flex-wrap: wrap;
  box-shadow: 0 1px 3px rgba(0,0,0,.04);
}
.filtros { display: flex; gap: .85rem; flex-wrap: wrap; flex: 1; }
.filtro-group { display: flex; flex-direction: column; gap: .3rem; }
.filtro-label { font-size: .7rem; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: .05em; }
.filtro-group input, .filtro-group select {
  border: 1.5px solid #e2e8f0;
  border-radius: 7px;
  padding: .45rem .7rem;
  font-size: .875rem;
  font-family: inherit;
  outline: none;
  background: #f8fafc;
  transition: border-color .15s;
  min-width: 130px;
}
.filtro-group input:focus, .filtro-group select:focus { border-color: #6366f1; background: #fff; }
.filtro-search input { min-width: 200px; }

.toolbar-actions { display: flex; gap: .5rem; align-items: flex-end; flex-wrap: wrap; }
.btn-action {
  padding: .5rem 1rem;
  border-radius: 7px;
  border: none;
  cursor: pointer;
  font-size: .8rem;
  font-family: inherit;
  font-weight: 600;
  transition: all .15s;
  white-space: nowrap;
}
.btn-buscar  { background: #0f172a; color: #fff; }
.btn-buscar:hover:not(:disabled) { background: #1e293b; }
.btn-limpiar { background: #f1f5f9; color: #475569; border: 1px solid #e2e8f0; }
.btn-limpiar:hover { background: #e2e8f0; }
.btn-print   { background: #f0f4ff; color: #4338ca; border: 1px solid #c7d2fe; }
.btn-print:hover { background: #e0e7ff; }
.btn-export  { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
.btn-export:hover { background: #d1fae5; }

/* ── Error + Footer ── */
.error-msg { color: #dc2626; font-size: .875rem; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: .6rem 1rem; }
.footer-info { display: flex; justify-content: space-between; align-items: center; font-size: .75rem; color: #94a3b8; padding: 0 .25rem; }
.realtime-dot { color: #22c55e; font-weight: 600; }
</style>
