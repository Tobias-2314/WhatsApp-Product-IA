<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { getOcupacion, socket } from '../api.js'

const CANVAS_W = 700
const CANVAS_H = 420
const MESA_W   = 84
const MESA_H   = 52

// ─── Fecha y franja ───────────────────────────────────────────
function hoyISO() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }))
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function isoADDMMYYYY(iso) {
  if (!iso) return hoyISO()
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

const fechaInput = ref(hoyISO())
const ocupacion  = ref(null)
const cargando   = ref(false)
const error      = ref('')

// Franja seleccionada — auto-selecciona la más cercana a ahora
function franjaActual(franjas) {
  if (!franjas?.length) return null
  const d  = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }))
  const now = d.getHours() * 60 + d.getMinutes()
  let best = franjas[0]
  let minDif = Infinity
  for (const f of franjas) {
    const [h, m] = f.split(':').map(Number)
    const dif = Math.abs(h * 60 + m - now)
    if (dif < minDif) { minDif = dif; best = f }
  }
  return best
}

const franjaSeleccionada = ref(null)

async function cargar() {
  cargando.value = true
  error.value    = ''
  try {
    ocupacion.value = await getOcupacion(isoADDMMYYYY(fechaInput.value))
    if (ocupacion.value?.franjas?.length && !franjaSeleccionada.value) {
      franjaSeleccionada.value = franjaActual(ocupacion.value.franjas)
    }
  } catch (e) {
    error.value = e.message
  } finally {
    cargando.value = false
  }
}

// ─── Posición de cada mesa ────────────────────────────────────
function defaultPos(id, idx) {
  const col = idx % 4
  const row = Math.floor(idx / 4)
  return { x: 40 + col * 160, y: 40 + row * 120 }
}

function posMesa(mesa, idx) {
  if (mesa.x_pos !== null && mesa.y_pos !== null) return { x: mesa.x_pos, y: mesa.y_pos }
  return defaultPos(mesa.id, idx)
}

// ─── Celda de la franja seleccionada para cada mesa ──────────
function celdaMesa(mesaId) {
  if (!ocupacion.value || !franjaSeleccionada.value) return { estado: 'libre' }
  return ocupacion.value.celdas?.[`${franjaSeleccionada.value}-${mesaId}`] || { estado: 'libre' }
}

// ─── Tooltip ─────────────────────────────────────────────────
const tooltip = ref(null)  // { mesaId, x, y }

function mostrarTooltip(e, mesaId) {
  const c = celdaMesa(mesaId)
  if (c.estado === 'libre') { tooltip.value = null; return }
  const rect = e.currentTarget.closest('.canvas-wrap').getBoundingClientRect()
  const m = ocupacion.value.mesas.find(x => x.id === mesaId)
  tooltip.value = {
    nombre:    m?.nombre || '',
    estado:    c.estado,
    cliente:   c.nombre  || '',
    personas:  c.personas|| '',
    hora:      c.hora    || '',
    hora_fin:  c.hora_fin|| '',
    x: e.clientX - rect.left + 12,
    y: e.clientY - rect.top  - 8,
  }
}

function ocultarTooltip() { tooltip.value = null }

onMounted(() => {
  cargar()
  socket.on('reserva:nueva',     cargar)
  socket.on('reserva:cancelada', cargar)
  socket.on('reserva:no_show',   cargar)
})

onUnmounted(() => {
  socket.off('reserva:nueva',     cargar)
  socket.off('reserva:cancelada', cargar)
  socket.off('reserva:no_show',   cargar)
})
</script>

<template>
  <div class="ocupacion">
    <!-- Toolbar -->
    <div class="toolbar">
      <label>Fecha:
        <input type="date" v-model="fechaInput" @change="cargar" />
      </label>
      <button class="btn-reload" @click="cargar" :disabled="cargando">
        {{ cargando ? '…' : '↺ Actualizar' }}
      </button>
    </div>

    <p v-if="error" class="error">{{ error }}</p>

    <div v-if="!ocupacion && !cargando" class="empty">Seleccioná una fecha</div>

    <template v-if="ocupacion">
      <!-- Selector de franja -->
      <div class="franjas-row">
        <button
          v-for="f in ocupacion.franjas"
          :key="f"
          :class="['btn-franja', { activa: franjaSeleccionada === f }]"
          @click="franjaSeleccionada = f"
        >{{ f }}</button>
      </div>

      <!-- Plano visual -->
      <div class="canvas-wrap">
        <div
          class="canvas"
          :style="`width:${CANVAS_W}px;height:${CANVAS_H}px`"
        >
          <!-- Mesas -->
          <div
            v-for="(mesa, idx) in ocupacion.mesas"
            :key="mesa.id"
            :class="['mesa-chip', celdaMesa(mesa.id).estado]"
            :style="`
              left:${posMesa(mesa, idx).x}px;
              top:${posMesa(mesa, idx).y}px;
              width:${MESA_W}px;
              height:${MESA_H}px
            `"
            @mouseenter="mostrarTooltip($event, mesa.id)"
            @mousemove="mostrarTooltip($event, mesa.id)"
            @mouseleave="ocultarTooltip"
          >
            <span class="chip-nombre">{{ mesa.nombre }}</span>
            <span class="chip-cap">{{ mesa.capacidad }}p</span>
            <span v-if="celdaMesa(mesa.id).estado === 'ocupada'" class="chip-personas">
              {{ celdaMesa(mesa.id).personas }}p
            </span>
            <span v-if="celdaMesa(mesa.id).estado === 'limpieza'" class="chip-cleaning">🧹</span>
          </div>

          <!-- Tooltip -->
          <div
            v-if="tooltip"
            class="tooltip"
            :style="`left:${tooltip.x}px;top:${tooltip.y}px`"
          >
            <strong>{{ tooltip.nombre }}</strong>
            <template v-if="tooltip.estado === 'ocupada'">
              <span>{{ tooltip.cliente }}</span>
              <span>{{ tooltip.personas }} personas</span>
              <span>{{ tooltip.hora }} – {{ tooltip.hora_fin }}</span>
            </template>
            <template v-else-if="tooltip.estado === 'limpieza'">
              <span>En limpieza</span>
            </template>
          </div>
        </div>
      </div>

      <!-- Leyenda -->
      <div class="leyenda">
        <span class="dot libre"></span> Libre &nbsp;
        <span class="dot ocupada"></span> Ocupada &nbsp;
        <span class="dot limpieza"></span> Limpieza
        <span class="leyenda-hint">· Posicioná las mesas desde la pestaña Mesas</span>
      </div>

      <!-- Tabla resumen -->
      <div class="resumen" v-if="franjaSeleccionada">
        <div class="resumen-title">Resumen {{ franjaSeleccionada }}</div>
        <div class="resumen-grid">
          <div
            v-for="mesa in ocupacion.mesas"
            :key="mesa.id"
            :class="['resumen-item', celdaMesa(mesa.id).estado]"
          >
            <span class="ri-nombre">{{ mesa.nombre }}</span>
            <span class="ri-estado">
              <template v-if="celdaMesa(mesa.id).estado === 'ocupada'">
                {{ celdaMesa(mesa.id).nombre }} · {{ celdaMesa(mesa.id).personas }}p
              </template>
              <template v-else-if="celdaMesa(mesa.id).estado === 'limpieza'">limpieza</template>
              <template v-else>libre</template>
            </span>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.ocupacion { display: flex; flex-direction: column; gap: 1rem; }

.toolbar {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
}
.toolbar label { font-size: .875rem; color: #374151; display: flex; align-items: center; gap: .4rem; }
.toolbar input[type="date"] { border: 1px solid #d1d5db; border-radius: 6px; padding: .3rem .6rem; font-size: .875rem; font-family: inherit; }
.btn-reload { background: #111827; color: #fff; font-size: .8rem; padding: .35rem .75rem; }
.btn-reload:hover:not(:disabled) { background: #374151; }

.error { color: #dc2626; font-size: .875rem; }
.empty { color: #9ca3af; font-style: italic; text-align: center; padding: 3rem; background: #fff; border-radius: 10px; }

/* ── Franjas ── */
.franjas-row {
  display: flex;
  flex-wrap: wrap;
  gap: .4rem;
}
.btn-franja {
  padding: .3rem .7rem;
  border: 1.5px solid #d1d5db;
  border-radius: 20px;
  font-size: .8rem;
  background: #fff;
  color: #374151;
  cursor: pointer;
  transition: all .15s;
}
.btn-franja:hover { border-color: #6366f1; color: #4338ca; }
.btn-franja.activa { background: #4f46e5; border-color: #4f46e5; color: #fff; font-weight: 600; }

/* ── Canvas ── */
.canvas-wrap { overflow-x: auto; }

.canvas {
  position: relative;
  background: #f8fafc;
  border: 1.5px solid #e5e7eb;
  border-radius: 10px;
  overflow: hidden;
  background-image:
    radial-gradient(circle, #e2e8f0 1px, transparent 1px);
  background-size: 24px 24px;
}

.mesa-chip {
  position: absolute;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  border: 2px solid transparent;
  transition: box-shadow .15s, transform .1s;
  cursor: default;
  user-select: none;
}
.mesa-chip:hover { box-shadow: 0 4px 12px rgba(0,0,0,.15); transform: scale(1.04); z-index: 10; }

.mesa-chip.libre    { background: #d1fae5; border-color: #6ee7b7; }
.mesa-chip.ocupada  { background: #dbeafe; border-color: #93c5fd; }
.mesa-chip.limpieza { background: #fef3c7; border-color: #fcd34d; }

.chip-nombre  { font-size: .72rem; font-weight: 700; color: #1f2937; }
.chip-cap     { font-size: .62rem; color: #6b7280; }
.chip-personas{ font-size: .68rem; font-weight: 600; color: #1e40af; }
.chip-cleaning{ font-size: .75rem; line-height: 1; }

/* ── Tooltip ── */
.tooltip {
  position: absolute;
  background: #1f2937;
  color: #f9fafb;
  border-radius: 7px;
  padding: .45rem .7rem;
  font-size: .75rem;
  display: flex;
  flex-direction: column;
  gap: 2px;
  pointer-events: none;
  z-index: 100;
  white-space: nowrap;
  box-shadow: 0 4px 12px rgba(0,0,0,.25);
}
.tooltip strong { font-size: .8rem; margin-bottom: 2px; }

/* ── Leyenda ── */
.leyenda {
  display: flex;
  align-items: center;
  gap: .5rem;
  font-size: .78rem;
  color: #6b7280;
  flex-wrap: wrap;
}
.dot {
  display: inline-block;
  width: 12px; height: 12px;
  border-radius: 3px;
  margin-right: .2rem;
}
.dot.libre    { background: #d1fae5; border: 1px solid #6ee7b7; }
.dot.ocupada  { background: #dbeafe; border: 1px solid #93c5fd; }
.dot.limpieza { background: #fef3c7; border: 1px solid #fcd34d; }
.leyenda-hint { color: #9ca3af; font-style: italic; margin-left: .5rem; }

/* ── Resumen ── */
.resumen { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: .75rem 1rem; }
.resumen-title { font-size: .8rem; font-weight: 600; color: #374151; margin-bottom: .5rem; }
.resumen-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: .4rem;
}
.resumen-item {
  display: flex;
  flex-direction: column;
  padding: .35rem .6rem;
  border-radius: 6px;
  font-size: .75rem;
  border: 1px solid transparent;
}
.resumen-item.libre    { background: #f0fdf4; border-color: #bbf7d0; }
.resumen-item.ocupada  { background: #eff6ff; border-color: #bfdbfe; }
.resumen-item.limpieza { background: #fffbeb; border-color: #fde68a; }
.ri-nombre { font-weight: 600; color: #111827; }
.ri-estado { color: #6b7280; font-size: .7rem; }
.resumen-item.ocupada  .ri-estado { color: #1d4ed8; }
.resumen-item.limpieza .ri-estado { color: #92400e; }
</style>
