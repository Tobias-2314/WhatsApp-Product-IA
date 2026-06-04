<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { getMesas, crearMesa, actualizarMesa, getCombinaciones, agregarCombinacion, eliminarCombinacion } from '../api.js'

// ─── Estado ───────────────────────────────────────────────────
const mesas    = ref([])
const cargando = ref(false)
const error    = ref('')

const nueva          = ref({ nombre: '', capacidad: '' })
const guardandoNueva = ref(false)
const errorNueva     = ref('')

const editando      = ref(null)
const guardandoEdit = ref(false)

// Combinaciones
const combList      = ref([])
const guardandoComb = ref(false)

const combSet = computed(() =>
  new Set(combList.value.map(c => `${c.mesa_id_1}-${c.mesa_id_2}`))
)
function isCombinado(id1, id2) {
  const a = Math.min(id1, id2), b = Math.max(id1, id2)
  return combSet.value.has(`${a}-${b}`)
}

// ─── Layout visual ────────────────────────────────────────────
// posiciones guardadas localmente (localStorage) por mesa id
const STORAGE_KEY = 'mesa_positions'

function cargarPosiciones() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') } catch { return {} }
}
function guardarPosiciones(pos) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(pos))
}

const posiciones  = ref(cargarPosiciones())  // { [mesaId]: { x, y } }
const CANVAS_W    = 700
const CANVAS_H    = 420
const MESA_W      = 80
const MESA_H      = 50

function posicionMesa(id) {
  return posiciones.value[id] ?? defaultPos(id)
}

function defaultPos(id) {
  // Distribuir en grid si no tienen posición guardada
  const idx = mesas.value.findIndex(m => m.id === id)
  const col = idx % 4
  const row = Math.floor(idx / 4)
  return { x: 40 + col * 150, y: 40 + row * 110 }
}

// ─── Drag ─────────────────────────────────────────────────────
const dragging = ref(null)  // { id, offsetX, offsetY }
const canvasEl = ref(null)

function onMouseDown(e, mesaId) {
  if (conectandoDesde.value !== null) return  // modo conexión: no arrastrar
  const pos = posicionMesa(mesaId)
  dragging.value = { id: mesaId, offsetX: e.offsetX, offsetY: e.offsetY }
}

function onMouseMove(e) {
  if (!dragging.value || !canvasEl.value) return
  const rect = canvasEl.value.getBoundingClientRect()
  const x = Math.max(0, Math.min(CANVAS_W - MESA_W, e.clientX - rect.left - dragging.value.offsetX))
  const y = Math.max(0, Math.min(CANVAS_H - MESA_H, e.clientY - rect.top  - dragging.value.offsetY))
  posiciones.value = { ...posiciones.value, [dragging.value.id]: { x, y } }
}

function onMouseUp() {
  if (dragging.value) {
    guardarPosiciones(posiciones.value)
    dragging.value = null
  }
}

// ─── Conexiones (combinaciones) ───────────────────────────────
const conectandoDesde = ref(null)  // mesaId del primer click

function onClickMesa(mesaId) {
  if (dragging.value) return

  if (conectandoDesde.value === null) {
    // Primer click: seleccionar origen
    conectandoDesde.value = mesaId
  } else if (conectandoDesde.value === mesaId) {
    // Mismo mesa: cancelar
    conectandoDesde.value = null
  } else {
    // Segundo click: conectar/desconectar
    toggleCombinacion(conectandoDesde.value, mesaId)
    conectandoDesde.value = null
  }
}

function cancelarConexion() {
  conectandoDesde.value = null
}

// Centro de una mesa (para dibujar líneas SVG)
function centro(mesaId) {
  const pos = posicionMesa(mesaId)
  return { x: pos.x + MESA_W / 2, y: pos.y + MESA_H / 2 }
}

// ─── Carga ────────────────────────────────────────────────────
async function cargar() {
  cargando.value = true
  error.value    = ''
  try {
    const [m, c] = await Promise.all([getMesas(), getCombinaciones()])
    mesas.value    = m
    combList.value = c
  } catch (e) {
    error.value = e.message
  } finally {
    cargando.value = false
  }
}

// ─── CRUD mesas ───────────────────────────────────────────────
async function agregar() {
  errorNueva.value = ''
  const nombre    = nueva.value.nombre.trim()
  const capacidad = parseInt(nueva.value.capacidad, 10)
  if (!nombre)               { errorNueva.value = 'Nombre requerido'; return }
  if (!capacidad || capacidad < 1) { errorNueva.value = 'Capacidad debe ser ≥ 1'; return }

  guardandoNueva.value = true
  try {
    const m = await crearMesa({ nombre, capacidad })
    mesas.value.push(m)
    nueva.value = { nombre: '', capacidad: '' }
  } catch (e) {
    errorNueva.value = e.message
  } finally {
    guardandoNueva.value = false
  }
}

function iniciarEdicion(m) { editando.value = { id: m.id, nombre: m.nombre, capacidad: m.capacidad } }
function cancelarEdicion()  { editando.value = null }

async function guardarEdicion() {
  const { id, nombre, capacidad } = editando.value
  if (!nombre.trim()) return
  const cap = parseInt(capacidad, 10)
  if (!cap || cap < 1) return

  guardandoEdit.value = true
  try {
    const m = await actualizarMesa(id, { nombre: nombre.trim(), capacidad: cap })
    const idx = mesas.value.findIndex(x => x.id === id)
    if (idx !== -1) mesas.value[idx] = m
    editando.value = null
  } catch (e) {
    error.value = e.message
  } finally {
    guardandoEdit.value = false
  }
}

async function toggleActiva(m) {
  try {
    const actualizada = await actualizarMesa(m.id, { activa: !m.activa })
    const idx = mesas.value.findIndex(x => x.id === m.id)
    if (idx !== -1) mesas.value[idx] = actualizada
  } catch (e) {
    error.value = e.message
  }
}

// ─── Combinaciones ────────────────────────────────────────────
async function toggleCombinacion(id1, id2) {
  if (id1 === id2 || guardandoComb.value) return
  guardandoComb.value = true
  const a = Math.min(id1, id2), b = Math.max(id1, id2)
  const activa = combSet.value.has(`${a}-${b}`)
  try {
    if (activa) {
      await eliminarCombinacion(a, b)
      combList.value = combList.value.filter(c => !(c.mesa_id_1 === a && c.mesa_id_2 === b))
    } else {
      await agregarCombinacion(a, b)
      combList.value = [...combList.value, { mesa_id_1: a, mesa_id_2: b }]
    }
  } catch (e) {
    error.value = e.message
  } finally {
    guardandoComb.value = false
  }
}

onMounted(() => {
  cargar()
  window.addEventListener('mouseup', onMouseUp)
  window.addEventListener('mousemove', onMouseMove)
})
onUnmounted(() => {
  window.removeEventListener('mouseup', onMouseUp)
  window.removeEventListener('mousemove', onMouseMove)
})
</script>

<template>
  <div class="mesas-panel">
    <div class="panel-header">
      <h2 class="panel-title">Gestión de Mesas</h2>
      <button class="btn-reload" @click="cargar" :disabled="cargando" title="Recargar">⟳</button>
    </div>

    <p v-if="error" class="error">{{ error }}</p>

    <!-- ── Plano visual ── -->
    <div class="plano-section">
      <div class="plano-header">
        <span class="plano-title">Plano del salón</span>
        <span class="plano-hint" v-if="conectandoDesde === null">
          Arrastrá las mesas · Hacé click en una mesa para conectarla con otra
        </span>
        <span class="plano-hint conectando" v-else>
          ✦ Seleccioná la segunda mesa para conectar · <button class="btn-cancelar-con" @click="cancelarConexion">Cancelar</button>
        </span>
      </div>

      <div
        class="canvas"
        ref="canvasEl"
        :style="`width:${CANVAS_W}px;height:${CANVAS_H}px`"
        @mousemove.prevent
      >
        <!-- SVG para las líneas de conexión -->
        <svg class="canvas-svg" :width="CANVAS_W" :height="CANVAS_H">
          <!-- Líneas de combinaciones -->
          <line
            v-for="c in combList"
            :key="`${c.mesa_id_1}-${c.mesa_id_2}`"
            :x1="centro(c.mesa_id_1).x"
            :y1="centro(c.mesa_id_1).y"
            :x2="centro(c.mesa_id_2).x"
            :y2="centro(c.mesa_id_2).y"
            class="linea-comb"
          />
          <!-- Línea en progreso (de origen al canvas) -->
          <circle
            v-if="conectandoDesde !== null"
            :cx="centro(conectandoDesde).x"
            :cy="centro(conectandoDesde).y"
            r="6"
            class="origen-pulse"
          />
        </svg>

        <!-- Mesas -->
        <div
          v-for="m in mesas"
          :key="m.id"
          class="mesa-chip"
          :class="{
            'inactiva':   !m.activa,
            'seleccionada': conectandoDesde === m.id,
            'candidata':    conectandoDesde !== null && conectandoDesde !== m.id,
            'combinada':    conectandoDesde === null && combList.some(c => c.mesa_id_1 === m.id || c.mesa_id_2 === m.id)
          }"
          :style="`left:${posicionMesa(m.id).x}px;top:${posicionMesa(m.id).y}px;width:${MESA_W}px;height:${MESA_H}px`"
          @mousedown.stop="onMouseDown($event, m.id)"
          @click.stop="onClickMesa(m.id)"
        >
          <span class="chip-nombre">{{ m.nombre }}</span>
          <span class="chip-cap">{{ m.capacidad }}p</span>
          <span v-if="!m.activa" class="chip-badge-inactiva">inactiva</span>
        </div>
      </div>

      <p class="leyenda">
        <span class="dot-verde"></span> Con conexiones &nbsp;
        <span class="dot-azul"></span> Sin conexiones &nbsp;
        <span class="line-sample"></span> Combinable &nbsp;
        <strong>{{ combList.length }}</strong> conexión(es) configurada(s)
      </p>
    </div>

    <!-- ── Lista de mesas ── -->
    <div class="table-wrap">
      <table class="tabla">
        <thead>
          <tr>
            <th>#</th>
            <th>Nombre</th>
            <th>Capacidad</th>
            <th>Estado</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="cargando && !mesas.length">
            <td colspan="5" class="empty">Cargando…</td>
          </tr>
          <tr v-else-if="!mesas.length">
            <td colspan="5" class="empty">Sin mesas. Agregá una abajo.</td>
          </tr>
          <template v-for="m in mesas" :key="m.id">
            <tr v-if="editando?.id === m.id" class="edit-row">
              <td class="id-col">{{ m.id }}</td>
              <td><input class="edit-input" v-model="editando.nombre" @keydown.enter="guardarEdicion" @keydown.esc="cancelarEdicion" /></td>
              <td><input class="edit-input narrow" v-model="editando.capacidad" type="number" min="1" @keydown.enter="guardarEdicion" @keydown.esc="cancelarEdicion" /></td>
              <td><span class="badge" :class="m.activa ? 'badge-activa' : 'badge-inactiva'">{{ m.activa ? 'Activa' : 'Inactiva' }}</span></td>
              <td class="acciones">
                <button class="btn-ok" @click="guardarEdicion" :disabled="guardandoEdit">✓</button>
                <button class="btn-x" @click="cancelarEdicion">✕</button>
              </td>
            </tr>
            <tr v-else :class="{ 'row-inactiva': !m.activa }">
              <td class="id-col">{{ m.id }}</td>
              <td>{{ m.nombre }}</td>
              <td>{{ m.capacidad }} personas</td>
              <td>
                <span class="badge" :class="m.activa ? 'badge-activa' : 'badge-inactiva'">
                  {{ m.activa ? 'Activa' : 'Inactiva' }}
                </span>
              </td>
              <td class="acciones">
                <button class="btn-edit" @click="iniciarEdicion(m)" title="Editar">✏️</button>
                <button class="btn-toggle" :class="m.activa ? 'btn-desactivar' : 'btn-activar'" @click="toggleActiva(m)">
                  {{ m.activa ? 'Desactivar' : 'Activar' }}
                </button>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <!-- ── Agregar mesa ── -->
    <div class="nueva-form">
      <h3 class="form-title">Agregar mesa</h3>
      <div class="form-row">
        <input class="form-input" v-model="nueva.nombre" placeholder="Nombre (ej: Mesa 7)" @keydown.enter="agregar" />
        <input class="form-input narrow" v-model="nueva.capacidad" type="number" min="1" placeholder="Cap." @keydown.enter="agregar" />
        <button class="btn-agregar" @click="agregar" :disabled="guardandoNueva">
          {{ guardandoNueva ? '…' : '+ Agregar' }}
        </button>
      </div>
      <p v-if="errorNueva" class="error-small">{{ errorNueva }}</p>
    </div>

    <p class="nota">Las mesas inactivas no reciben nuevas reservas. Las reservas existentes no se ven afectadas.</p>
  </div>
</template>

<style scoped>
.mesas-panel { display: flex; flex-direction: column; gap: 1.25rem; }

.panel-header { display: flex; align-items: center; gap: .75rem; }
.panel-title  { font-size: 1rem; font-weight: 600; color: #111827; margin: 0; }
.btn-reload   { background: transparent; border: 1px solid #d1d5db; color: #6b7280; padding: .2rem .5rem; border-radius: 6px; cursor: pointer; font-size: .85rem; }
.btn-reload:hover:not(:disabled) { background: #f3f4f6; }

/* ── Plano ── */
.plano-section {
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 1rem 1.25rem;
  display: flex;
  flex-direction: column;
  gap: .75rem;
}

.plano-header { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
.plano-title  { font-size: .875rem; font-weight: 600; color: #374151; white-space: nowrap; }
.plano-hint   { font-size: .75rem; color: #9ca3af; }
.plano-hint.conectando { color: #6366f1; font-weight: 500; }
.btn-cancelar-con {
  background: transparent; border: 1px solid #6366f1; color: #6366f1;
  border-radius: 4px; padding: .1rem .45rem; font-size: .72rem; cursor: pointer; font-family: inherit;
}
.btn-cancelar-con:hover { background: #eef2ff; }

.canvas {
  position: relative;
  background: #fff;
  border: 1.5px solid #e5e7eb;
  border-radius: 8px;
  overflow: hidden;
  user-select: none;
  max-width: 100%;
}

.canvas-svg {
  position: absolute;
  top: 0; left: 0;
  pointer-events: none;
}

.linea-comb {
  stroke: #6366f1;
  stroke-width: 2.5;
  stroke-dasharray: 6 3;
  opacity: .7;
}

.origen-pulse {
  fill: #6366f1;
  opacity: .8;
}

.mesa-chip {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: #dbeafe;
  border: 2px solid #93c5fd;
  cursor: grab;
  transition: border-color .15s, background .15s, box-shadow .15s;
  box-shadow: 0 1px 3px rgba(0,0,0,.08);
  gap: 1px;
}
.mesa-chip:active { cursor: grabbing; }

.mesa-chip.combinada {
  background: #d1fae5;
  border-color: #6ee7b7;
}

.mesa-chip.seleccionada {
  background: #e0e7ff;
  border-color: #6366f1;
  border-width: 2.5px;
  box-shadow: 0 0 0 3px rgba(99,102,241,.25);
  cursor: pointer;
}

.mesa-chip.candidata {
  cursor: pointer;
  border-color: #6366f1;
  border-style: dashed;
}
.mesa-chip.candidata:hover {
  background: #e0e7ff;
  box-shadow: 0 0 0 3px rgba(99,102,241,.2);
}

.mesa-chip.inactiva {
  opacity: .45;
  background: #f3f4f6;
  border-color: #d1d5db;
}

.chip-nombre { font-size: .72rem; font-weight: 700; color: #1e40af; }
.chip-cap    { font-size: .65rem; color: #3b82f6; }
.chip-badge-inactiva {
  font-size: .55rem;
  background: #e5e7eb;
  color: #6b7280;
  padding: 0 .3rem;
  border-radius: 3px;
}

.mesa-chip.combinada .chip-nombre { color: #065f46; }
.mesa-chip.combinada .chip-cap    { color: #059669; }

.leyenda {
  display: flex;
  align-items: center;
  gap: .75rem;
  font-size: .75rem;
  color: #6b7280;
  flex-wrap: wrap;
}
.dot-verde { display: inline-block; width: 10px; height: 10px; border-radius: 3px; background: #d1fae5; border: 1.5px solid #6ee7b7; }
.dot-azul  { display: inline-block; width: 10px; height: 10px; border-radius: 3px; background: #dbeafe; border: 1.5px solid #93c5fd; }
.line-sample { display: inline-block; width: 22px; height: 2px; background: #6366f1; border-radius: 1px; opacity: .7; vertical-align: middle; }

/* ── Tabla ── */
.table-wrap { overflow-x: auto; border-radius: 8px; border: 1px solid #e5e7eb; }
.tabla { width: 100%; border-collapse: collapse; font-size: .875rem; }
.tabla th { background: #f9fafb; color: #374151; font-weight: 600; padding: .6rem 1rem; text-align: left; border-bottom: 1px solid #e5e7eb; white-space: nowrap; }
.tabla td { padding: .55rem 1rem; border-bottom: 1px solid #f3f4f6; color: #111827; }
.tabla tr:last-child td { border-bottom: none; }
.tabla tr:hover:not(.edit-row) td { background: #fafafa; }

.id-col       { color: #9ca3af; font-size: .8rem; font-family: monospace; }
.row-inactiva td { opacity: .5; }
.empty        { text-align: center; color: #9ca3af; padding: 2rem; }

.badge          { padding: .15rem .55rem; border-radius: 12px; font-size: .72rem; font-weight: 600; }
.badge-activa   { background: #d1fae5; color: #065f46; }
.badge-inactiva { background: #f3f4f6; color: #6b7280; }

.acciones     { display: flex; gap: .4rem; align-items: center; }
.btn-edit     { background: transparent; border: none; cursor: pointer; font-size: .9rem; padding: .15rem .3rem; border-radius: 4px; }
.btn-edit:hover { background: #f3f4f6; }
.btn-toggle   { font-size: .73rem; padding: .2rem .55rem; border-radius: 5px; border: none; cursor: pointer; font-family: inherit; }
.btn-desactivar { background: #fef2f2; color: #dc2626; }
.btn-desactivar:hover { background: #fee2e2; }
.btn-activar    { background: #ecfdf5; color: #065f46; }
.btn-activar:hover { background: #d1fae5; }

.edit-row   { background: #fffbeb; }
.edit-input { border: 1px solid #d1d5db; border-radius: 5px; padding: .3rem .5rem; font-size: .875rem; font-family: inherit; width: 100%; outline: none; }
.edit-input:focus { border-color: #6366f1; }
.narrow     { width: 80px !important; }
.btn-ok { background: #059669; color: #fff; border: none; border-radius: 5px; padding: .25rem .55rem; cursor: pointer; font-size: .8rem; }
.btn-ok:hover:not(:disabled) { background: #047857; }
.btn-x  { background: #6b7280; color: #fff; border: none; border-radius: 5px; padding: .25rem .55rem; cursor: pointer; font-size: .8rem; }
.btn-x:hover { background: #4b5563; }

/* ── Agregar ── */
.nueva-form  { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 1rem 1.25rem; }
.form-title  { font-size: .875rem; font-weight: 600; color: #374151; margin: 0 0 .65rem; }
.form-row    { display: flex; gap: .6rem; flex-wrap: wrap; align-items: center; }
.form-input  { border: 1px solid #d1d5db; border-radius: 6px; padding: .4rem .7rem; font-size: .875rem; font-family: inherit; outline: none; flex: 1; min-width: 140px; }
.form-input:focus { border-color: #6366f1; }
.form-input.narrow { flex: none; width: 80px; min-width: unset; }
.btn-agregar { background: #6366f1; color: #fff; border: none; border-radius: 6px; padding: .4rem .9rem; font-size: .875rem; cursor: pointer; font-family: inherit; font-weight: 600; white-space: nowrap; }
.btn-agregar:hover:not(:disabled) { background: #4f46e5; }
.btn-agregar:disabled { opacity: .6; cursor: not-allowed; }
.error-small { color: #dc2626; font-size: .78rem; margin-top: .35rem; }

.error { color: #dc2626; font-size: .875rem; }
.nota  { font-size: .75rem; color: #9ca3af; }
</style>
