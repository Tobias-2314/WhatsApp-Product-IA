<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { getMesas, crearMesa, actualizarMesa, getCombinaciones, agregarCombinacion, eliminarCombinacion } from '../api.js'

// ─── State ────────────────────────────────────────────────────
const mesas         = ref([])
const cargando      = ref(false)
const error         = ref('')
const nueva         = ref({ nombre: '', capacidad: '' })
const guardandoNueva= ref(false)
const errorNueva    = ref('')
const editando      = ref(null)
const guardandoEdit = ref(false)
const combList      = ref([])
const guardandoComb = ref(false)

const combSet = computed(() => new Set(combList.value.map(c => `${c.mesa_id_1}-${c.mesa_id_2}`)))
function isCombinado(id1, id2) {
  const a = Math.min(id1, id2), b = Math.max(id1, id2)
  return combSet.value.has(`${a}-${b}`)
}

// ─── Canvas constants ──────────────────────────────────────────
const CANVAS_W = 700
const CANVAS_H = 420
const MESA_W   = 80
const MESA_H   = 50

function mesaDims(cap) {
  if (cap <= 4)  return { w: 66, h: 66 }
  if (cap <= 6)  return { w: 88, h: 52 }
  return              { w: 110, h: 52 }
}
function mesaRadius(cap) {
  return cap <= 4 ? '50%' : cap <= 6 ? '14px' : '10px'
}

function posicionMesa(id) {
  const m = mesas.value.find(x => x.id === id)
  if (m && m.x_pos !== null && m.y_pos !== null) return { x: m.x_pos, y: m.y_pos }
  return defaultPos(id)
}
function defaultPos(id) {
  const idx = mesas.value.findIndex(m => m.id === id)
  const col = idx % 4, row = Math.floor(idx / 4)
  return { x: 40 + col * 150, y: 40 + row * 110 }
}
function centroMesa(id) {
  const pos  = posicionMesa(id)
  const m    = mesas.value.find(x => x.id === id)
  const dims = m ? mesaDims(m.capacidad) : { w: MESA_W, h: MESA_H }
  return { x: pos.x + dims.w / 2, y: pos.y + dims.h / 2 }
}
function chipStyle(m) {
  const pos  = posicionMesa(m.id)
  const dims = mesaDims(m.capacidad)
  return { left: pos.x + 'px', top: pos.y + 'px', width: dims.w + 'px', height: dims.h + 'px', borderRadius: mesaRadius(m.capacidad) }
}

// ─── Drag ─────────────────────────────────────────────────────
const dragging = ref(null)
const canvasEl = ref(null)

function onMouseDown(e, mesaId) {
  if (conectandoDesde.value !== null) return
  const m    = mesas.value.find(x => x.id === mesaId)
  const dims = m ? mesaDims(m.capacidad) : { w: MESA_W, h: MESA_H }
  dragging.value = { id: mesaId, offsetX: e.offsetX, offsetY: e.offsetY, w: dims.w, h: dims.h }
}
function onMouseMove(e) {
  if (!dragging.value || !canvasEl.value) return
  const rect = canvasEl.value.getBoundingClientRect()
  const x = Math.max(0, Math.min(CANVAS_W - dragging.value.w, e.clientX - rect.left - dragging.value.offsetX))
  const y = Math.max(0, Math.min(CANVAS_H - dragging.value.h, e.clientY - rect.top  - dragging.value.offsetY))
  const idx = mesas.value.findIndex(m => m.id === dragging.value.id)
  if (idx !== -1) mesas.value[idx] = { ...mesas.value[idx], x_pos: Math.round(x), y_pos: Math.round(y) }
}
async function onMouseUp() {
  if (dragging.value) {
    const id = dragging.value.id
    dragging.value = null
    const m = mesas.value.find(x => x.id === id)
    if (m && m.x_pos !== null) {
      try { await actualizarMesa(id, { x_pos: m.x_pos, y_pos: m.y_pos }) } catch { /* ignore */ }
    }
  }
}

// ─── Conexiones ───────────────────────────────────────────────
const conectandoDesde = ref(null)

function onClickMesa(mesaId) {
  if (dragging.value) return
  if (conectandoDesde.value === null) {
    conectandoDesde.value = mesaId
  } else if (conectandoDesde.value === mesaId) {
    conectandoDesde.value = null
  } else {
    toggleCombinacion(conectandoDesde.value, mesaId)
    conectandoDesde.value = null
  }
}
function cancelarConexion() { conectandoDesde.value = null }

// ─── Carga ────────────────────────────────────────────────────
async function cargar() {
  cargando.value = true; error.value = ''
  try {
    const [m, c] = await Promise.all([getMesas(), getCombinaciones()])
    mesas.value    = m
    combList.value = c
  } catch (e) { error.value = e.message }
  finally    { cargando.value = false }
}

// ─── CRUD mesas ───────────────────────────────────────────────
async function agregar() {
  errorNueva.value = ''
  const nombre    = nueva.value.nombre.trim()
  const capacidad = parseInt(nueva.value.capacidad, 10)
  if (!nombre)               { errorNueva.value = 'Nombre requerido'; return }
  if (!capacidad || capacidad < 1) { errorNueva.value = 'Capacidad ≥ 1'; return }
  guardandoNueva.value = true
  try {
    const m = await crearMesa({ nombre, capacidad })
    mesas.value.push(m)
    nueva.value = { nombre: '', capacidad: '' }
  } catch (e) { errorNueva.value = e.message }
  finally    { guardandoNueva.value = false }
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
  } catch (e) { error.value = e.message }
  finally    { guardandoEdit.value = false }
}

async function toggleActiva(m) {
  try {
    const actualizada = await actualizarMesa(m.id, { activa: !m.activa })
    const idx = mesas.value.findIndex(x => x.id === m.id)
    if (idx !== -1) mesas.value[idx] = actualizada
  } catch (e) { error.value = e.message }
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
  } catch (e) { error.value = e.message }
  finally    { guardandoComb.value = false }
}

onMounted(() => {
  cargar()
  window.addEventListener('mouseup',   onMouseUp)
  window.addEventListener('mousemove', onMouseMove)
})
onUnmounted(() => {
  window.removeEventListener('mouseup',   onMouseUp)
  window.removeEventListener('mousemove', onMouseMove)
})
</script>

<template>
  <div class="mesas-panel">

    <!-- ── Header ── -->
    <div class="panel-hd">
      <div class="panel-hd-left">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="hd-icon"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
        <h2 class="panel-title">Gestión de Mesas</h2>
        <span class="mesa-count">{{ mesas.length }} mesas</span>
      </div>
      <button class="btn-reload" @click="cargar" :disabled="cargando" title="Recargar">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" :class="{ spinning: cargando }"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
      </button>
    </div>

    <p v-if="error" class="err-msg">{{ error }}</p>

    <!-- ── Plano visual ── -->
    <div class="plano-section">
      <div class="plano-hd">
        <span class="plano-title">PLANO DEL SALÓN</span>
        <div class="plano-hint-wrap">
          <template v-if="conectandoDesde === null">
            <span class="hint-chip">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22V12m0 0V2m0 10H2m10 0h10"/></svg>
              Arrastrá las mesas
            </span>
            <span class="hint-chip">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
              Click para conectar
            </span>
          </template>
          <template v-else>
            <span class="hint-chip conectando">
              <span class="live-dot"></span>
              Seleccioná la segunda mesa
            </span>
            <button class="btn-cancel-conn" @click="cancelarConexion">Cancelar</button>
          </template>
        </div>
      </div>

      <div class="canvas-wrap">
        <div
          class="canvas"
          ref="canvasEl"
          :style="`width:${CANVAS_W}px;height:${CANVAS_H}px`"
          @mousemove.prevent
        >
          <!-- SVG overlay -->
          <svg class="svg-ov" :width="CANVAS_W" :height="CANVAS_H">
            <defs>
              <pattern id="mgrid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,0.03)" stroke-width="1"/>
              </pattern>
              <filter id="glow-m">
                <feGaussianBlur stdDeviation="4" result="blur"/>
                <feComposite in="SourceGraphic" in2="blur" operator="over"/>
              </filter>
            </defs>
            <rect width="100%" height="100%" fill="url(#mgrid)"/>

            <!-- Wall accents -->
            <rect x="0" y="0" width="700" height="3" fill="rgba(255,255,255,0.04)"/>
            <rect x="0" y="417" width="700" height="3" fill="rgba(255,255,255,0.04)"/>
            <rect x="0" y="0" width="3" height="420" fill="rgba(255,255,255,0.04)"/>
            <rect x="697" y="0" width="3" height="420" fill="rgba(255,255,255,0.04)"/>

            <!-- Corner plants -->
            <circle cx="22" cy="22" r="10" fill="rgba(16,185,129,0.07)" stroke="rgba(16,185,129,0.12)" stroke-width="1"/>
            <circle cx="22" cy="22" r="5" fill="rgba(16,185,129,0.12)"/>
            <circle cx="678" cy="22" r="10" fill="rgba(16,185,129,0.07)" stroke="rgba(16,185,129,0.12)" stroke-width="1"/>
            <circle cx="678" cy="22" r="5" fill="rgba(16,185,129,0.12)"/>

            <!-- Entrance -->
            <rect x="295" y="410" width="110" height="1" fill="rgba(99,102,241,0.4)" rx="1"/>
            <text x="350" y="407" text-anchor="middle" fill="rgba(99,102,241,0.5)" font-size="9" font-family="monospace" letter-spacing="3">ENTRADA</text>

            <!-- Combination lines -->
            <line
              v-for="c in combList" :key="`${c.mesa_id_1}-${c.mesa_id_2}`"
              :x1="centroMesa(c.mesa_id_1).x" :y1="centroMesa(c.mesa_id_1).y"
              :x2="centroMesa(c.mesa_id_2).x" :y2="centroMesa(c.mesa_id_2).y"
              class="comb-line" filter="url(#glow-m)"
            />

            <!-- Origin pulse when connecting -->
            <circle
              v-if="conectandoDesde !== null"
              :cx="centroMesa(conectandoDesde).x"
              :cy="centroMesa(conectandoDesde).y"
              r="26" class="origin-ring"
            />
          </svg>

          <!-- Mesa chips -->
          <div
            v-for="m in mesas" :key="m.id"
            class="mesa-chip"
            :class="{
              inactiva:     !m.activa,
              seleccionada: conectandoDesde === m.id,
              candidata:    conectandoDesde !== null && conectandoDesde !== m.id,
              combinada:    conectandoDesde === null && combList.some(c => c.mesa_id_1 === m.id || c.mesa_id_2 === m.id)
            }"
            :style="chipStyle(m)"
            @mousedown.stop="onMouseDown($event, m.id)"
            @click.stop="onClickMesa(m.id)"
          >
            <span class="chip-nm">{{ m.nombre }}</span>
            <span class="chip-cap">{{ m.capacidad }}p</span>
            <span v-if="!m.activa" class="chip-tag-inactiva">OFF</span>
          </div>
        </div>
      </div>

      <!-- Leyenda del plano -->
      <div class="plano-leyenda">
        <span class="ley-item">
          <span class="ley-swatch comb"></span>Con conexiones
        </span>
        <span class="ley-item">
          <span class="ley-swatch default"></span>Sin conexiones
        </span>
        <span class="ley-item">
          <span class="ley-line"></span>Combinable
        </span>
        <span class="ley-sep">·</span>
        <strong class="ley-count">{{ combList.length }}</strong>
        <span class="ley-sub">conexión{{ combList.length !== 1 ? 'es' : '' }} configurada{{ combList.length !== 1 ? 's' : '' }}</span>
      </div>
    </div>

    <!-- ── Lista de mesas ── -->
    <div class="table-section">
      <div class="section-hd">
        <span class="section-title">LISTA DE MESAS</span>
      </div>
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
                  <button class="btn-cancel" @click="cancelarEdicion">✕</button>
                </td>
              </tr>
              <tr v-else :class="{ 'row-inactiva': !m.activa }">
                <td class="id-col">{{ m.id }}</td>
                <td>
                  <div class="cell-nombre">
                    <span class="nombre-shape" :style="{ borderRadius: mesaRadius(m.capacidad) }"></span>
                    {{ m.nombre }}
                  </div>
                </td>
                <td>{{ m.capacidad }} personas</td>
                <td><span class="badge" :class="m.activa ? 'badge-activa' : 'badge-inactiva'">{{ m.activa ? 'Activa' : 'Inactiva' }}</span></td>
                <td class="acciones">
                  <button class="btn-edit" @click="iniciarEdicion(m)" title="Editar">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  </button>
                  <button class="btn-toggle"
                    :class="m.activa ? 'btn-desactivar' : 'btn-activar'"
                    @click="toggleActiva(m)">
                    {{ m.activa ? 'Desactivar' : 'Activar' }}
                  </button>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ── Agregar mesa ── -->
    <div class="nueva-form">
      <div class="section-hd">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
        <span class="section-title">AGREGAR MESA</span>
      </div>
      <div class="form-row">
        <input class="form-input" v-model="nueva.nombre" placeholder="Nombre (ej: Mesa 7)" @keydown.enter="agregar" />
        <input class="form-input narrow" v-model="nueva.capacidad" type="number" min="1" placeholder="Cap." @keydown.enter="agregar" />
        <button class="btn-agregar" @click="agregar" :disabled="guardandoNueva">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          {{ guardandoNueva ? 'Guardando…' : 'Agregar' }}
        </button>
      </div>
      <p v-if="errorNueva" class="err-inline">{{ errorNueva }}</p>
    </div>

    <p class="nota">Las mesas inactivas no reciben nuevas reservas. Las reservas existentes no se ven afectadas.</p>

  </div>
</template>

<style scoped>
/* ── Base ── */
.mesas-panel { display: flex; flex-direction: column; gap: 1.25rem; color: #f1f5f9; }

/* ── Header ── */
.panel-hd {
  display: flex; align-items: center; justify-content: space-between;
  background: #1e293b; border: 1px solid rgba(255,255,255,.07); border-radius: 10px;
  padding: .7rem 1rem;
}
.panel-hd-left { display: flex; align-items: center; gap: .6rem; }
.hd-icon       { color: #6366f1; flex-shrink: 0; }
.panel-title   { font-size: .95rem; font-weight: 700; color: #e2e8f0; margin: 0; }
.mesa-count    { font-size: .72rem; color: #475569; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.08); border-radius: 20px; padding: .15rem .55rem; }

.btn-reload {
  background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.1); color: #64748b;
  width: 32px; height: 32px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: all .15s;
}
.btn-reload:hover:not(:disabled) { background: rgba(255,255,255,.08); color: #94a3b8; }
.btn-reload:disabled { opacity: .4; cursor: not-allowed; }
.spinning { animation: spin .7s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* ── Error ── */
.err-msg { color: #f87171; font-size: .82rem; background: rgba(239,68,68,.1); border: 1px solid rgba(239,68,68,.2); border-radius: 8px; padding: .5rem .75rem; }

/* ── Plano section ── */
.plano-section {
  background: #1e293b; border: 1px solid rgba(255,255,255,.07); border-radius: 12px;
  padding: 1rem 1.25rem; display: flex; flex-direction: column; gap: .75rem;
}
.plano-hd  { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
.plano-title { font-size: .7rem; font-weight: 800; letter-spacing: .12em; color: #6366f1; }
.plano-hint-wrap { display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; }
.hint-chip {
  display: inline-flex; align-items: center; gap: .3rem;
  background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08); border-radius: 20px;
  padding: .2rem .6rem; font-size: .72rem; color: #64748b;
}
.hint-chip.conectando { color: #c4b5fd; border-color: rgba(167,139,250,.3); background: rgba(167,139,250,.08); }
.live-dot { width: 6px; height: 6px; border-radius: 50%; background: #a78bfa; animation: live-blink 1s ease-in-out infinite; }
@keyframes live-blink { 0%,100% { opacity: 1; } 50% { opacity: .2; } }
.btn-cancel-conn {
  background: transparent; border: 1px solid rgba(167,139,250,.3); color: #a78bfa; border-radius: 6px;
  padding: .2rem .5rem; font-size: .72rem; cursor: pointer; font-family: inherit; transition: all .12s;
}
.btn-cancel-conn:hover { background: rgba(167,139,250,.1); }

/* ── Canvas ── */
.canvas-wrap { overflow-x: auto; }
.canvas {
  position: relative; overflow: hidden; border-radius: 10px; user-select: none;
  background:
    radial-gradient(ellipse at 20% 20%, rgba(99,102,241,.04) 0%, transparent 50%),
    radial-gradient(ellipse at 80% 80%, rgba(16,185,129,.03) 0%, transparent 50%),
    linear-gradient(160deg, #0c1220 0%, #0f172a 50%, #0b1120 100%);
  border: 1px solid rgba(255,255,255,.08);
  box-shadow: inset 0 0 60px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.05), 0 8px 32px rgba(0,0,0,.3);
}
.svg-ov { position: absolute; top: 0; left: 0; pointer-events: none; }

.comb-line {
  stroke: rgba(139,92,246,.55); stroke-width: 1.5; stroke-dasharray: 6 4;
}
.origin-ring {
  fill: none; stroke: rgba(167,139,250,.4); stroke-width: 1.5;
  animation: ring-expand 1.5s ease-out infinite;
}
@keyframes ring-expand {
  0%   { r: 20; opacity: .7; }
  100% { r: 34; opacity: 0; }
}

/* ── Mesa chip ── */
.mesa-chip {
  position: absolute; display: flex; flex-direction: column; align-items: center;
  justify-content: center; cursor: grab; transition: transform .12s, box-shadow .15s; gap: 1px;
  background: linear-gradient(145deg, rgba(251,191,36,.18), rgba(217,119,6,.1));
  border: 1.5px solid rgba(251,191,36,.4);
  box-shadow: 0 4px 14px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.08);
}
.mesa-chip:active { cursor: grabbing; transform: scale(.97) !important; }
.mesa-chip:hover:not(.inactiva) {
  transform: translateY(-2px) scale(1.04);
  box-shadow: 0 0 16px rgba(251,191,36,.2), 0 0 0 2px rgba(251,191,36,.12), 0 6px 18px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.1);
}

/* Combined */
.mesa-chip.combinada {
  background: linear-gradient(145deg, rgba(16,185,129,.2), rgba(5,150,105,.1));
  border-color: rgba(16,185,129,.5);
  box-shadow: 0 0 14px rgba(16,185,129,.15), 0 0 0 1px rgba(16,185,129,.1), 0 4px 14px rgba(0,0,0,.45);
}
.mesa-chip.combinada .chip-nm { color: #34d399; }
.mesa-chip.combinada .chip-cap { color: #10b981; }

/* Selected (origin of connection) */
.mesa-chip.seleccionada {
  background: linear-gradient(145deg, rgba(99,102,241,.3), rgba(79,70,229,.15));
  border-color: rgba(99,102,241,.7); border-width: 2px; cursor: pointer;
  box-shadow: 0 0 0 4px rgba(99,102,241,.2), 0 0 24px rgba(99,102,241,.3), 0 4px 14px rgba(0,0,0,.45);
  animation: sel-pulse .9s ease-in-out infinite;
}
@keyframes sel-pulse {
  0%,100% { box-shadow: 0 0 0 3px rgba(99,102,241,.2), 0 0 20px rgba(99,102,241,.2), 0 4px 14px rgba(0,0,0,.45); }
  50%     { box-shadow: 0 0 0 6px rgba(99,102,241,.1), 0 0 30px rgba(99,102,241,.35), 0 4px 14px rgba(0,0,0,.45); }
}

/* Candidate (other tables when one is selected) */
.mesa-chip.candidata {
  border-color: rgba(167,139,250,.5); border-style: dashed; cursor: pointer;
  background: linear-gradient(145deg, rgba(167,139,250,.1), rgba(139,92,246,.06));
}
.mesa-chip.candidata:hover {
  border-color: rgba(99,102,241,.7); border-style: solid;
  box-shadow: 0 0 16px rgba(99,102,241,.2), 0 0 0 2px rgba(99,102,241,.15), 0 4px 14px rgba(0,0,0,.45);
}

/* Inactive */
.mesa-chip.inactiva {
  opacity: .3; background: rgba(71,85,105,.15); border-color: rgba(71,85,105,.3);
  cursor: not-allowed; box-shadow: none;
}

/* Chip text */
.chip-nm { font-size: .68rem; font-weight: 800; letter-spacing: .01em; color: #e2e8f0; }
.chip-cap { font-size: .58rem; color: rgba(255,255,255,.45); }
.chip-tag-inactiva { font-size: .52rem; font-weight: 700; letter-spacing: .05em; color: rgba(255,255,255,.35); border: 1px solid rgba(255,255,255,.15); border-radius: 3px; padding: 0 .3rem; }

/* ── Plano leyenda ── */
.plano-leyenda {
  display: flex; align-items: center; gap: .6rem; flex-wrap: wrap;
  font-size: .72rem; color: #64748b;
}
.ley-item   { display: flex; align-items: center; gap: .35rem; }
.ley-swatch { display: inline-block; width: 12px; height: 12px; }
.ley-swatch.comb    { background: rgba(16,185,129,.4); border: 1px solid rgba(16,185,129,.6); border-radius: 3px; }
.ley-swatch.default { background: rgba(251,191,36,.3); border: 1px solid rgba(251,191,36,.5); border-radius: 3px; }
.ley-line  { display: inline-block; width: 22px; height: 2px; background: linear-gradient(90deg, rgba(99,102,241,.7), rgba(139,92,246,.7)); border-radius: 1px; }
.ley-sep   { color: #334155; }
.ley-count { color: #a5b4fc; font-weight: 700; }
.ley-sub   { color: #475569; }

/* ── Table section ── */
.table-section {
  background: #1e293b; border: 1px solid rgba(255,255,255,.07); border-radius: 12px; overflow: hidden;
}
.section-hd {
  display: flex; align-items: center; gap: .5rem;
  padding: .65rem 1rem; border-bottom: 1px solid rgba(255,255,255,.06);
  color: #6366f1;
}
.section-title { font-size: .68rem; font-weight: 800; letter-spacing: .1em; color: #475569; }
.section-hd .section-title { color: #6366f1; }

.table-wrap { overflow-x: auto; }
.tabla { width: 100%; border-collapse: collapse; font-size: .85rem; }
.tabla th {
  padding: .6rem 1rem; text-align: left; font-size: .68rem; font-weight: 700; letter-spacing: .05em;
  color: #475569; background: rgba(255,255,255,.02); border-bottom: 1px solid rgba(255,255,255,.06); white-space: nowrap;
}
.tabla td { padding: .55rem 1rem; border-bottom: 1px solid rgba(255,255,255,.04); color: #cbd5e1; }
.tabla tr:last-child td { border-bottom: none; }
.tabla tr:hover:not(.edit-row) td { background: rgba(255,255,255,.02); }

.id-col    { color: #334155; font-size: .75rem; font-family: monospace; }
.row-inactiva td { opacity: .4; }
.empty     { text-align: center; color: #334155; padding: 2.5rem; font-size: .85rem; }

.cell-nombre { display: flex; align-items: center; gap: .55rem; }
.nombre-shape { width: 12px; height: 12px; flex-shrink: 0; background: rgba(251,191,36,.3); border: 1px solid rgba(251,191,36,.5); }

.badge          { padding: .15rem .55rem; border-radius: 20px; font-size: .68rem; font-weight: 700; letter-spacing: .03em; }
.badge-activa   { background: rgba(16,185,129,.12); border: 1px solid rgba(16,185,129,.25); color: #34d399; }
.badge-inactiva { background: rgba(71,85,105,.15); border: 1px solid rgba(71,85,105,.25); color: #64748b; }

.acciones    { display: flex; gap: .4rem; align-items: center; }
.btn-edit {
  background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08); color: #64748b;
  width: 28px; height: 28px; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: all .12s;
}
.btn-edit:hover { background: rgba(99,102,241,.1); border-color: rgba(99,102,241,.3); color: #a5b4fc; }

.btn-toggle   { font-size: .72rem; padding: .22rem .6rem; border-radius: 6px; border: 1px solid; cursor: pointer; font-family: inherit; font-weight: 600; transition: all .12s; }
.btn-desactivar { background: rgba(239,68,68,.08); border-color: rgba(239,68,68,.2); color: #f87171; }
.btn-desactivar:hover { background: rgba(239,68,68,.15); }
.btn-activar    { background: rgba(16,185,129,.08); border-color: rgba(16,185,129,.2); color: #34d399; }
.btn-activar:hover { background: rgba(16,185,129,.15); }

.edit-row  { background: rgba(99,102,241,.05); }
.edit-input {
  background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.12); border-radius: 6px;
  padding: .3rem .5rem; font-size: .85rem; font-family: inherit; width: 100%; outline: none; color: #e2e8f0;
}
.edit-input:focus { border-color: rgba(99,102,241,.5); background: rgba(99,102,241,.08); }
.narrow { width: 80px !important; }
.btn-ok {
  background: rgba(16,185,129,.15); color: #34d399; border: 1px solid rgba(16,185,129,.3);
  border-radius: 5px; padding: .22rem .55rem; cursor: pointer; font-size: .8rem; font-weight: 700;
}
.btn-ok:hover:not(:disabled) { background: rgba(16,185,129,.25); }
.btn-cancel {
  background: rgba(71,85,105,.15); color: #64748b; border: 1px solid rgba(71,85,105,.25);
  border-radius: 5px; padding: .22rem .55rem; cursor: pointer; font-size: .8rem;
}
.btn-cancel:hover { background: rgba(71,85,105,.25); }

/* ── Agregar form ── */
.nueva-form {
  background: #1e293b; border: 1px solid rgba(255,255,255,.07); border-radius: 12px;
  padding: 1rem 1.25rem; display: flex; flex-direction: column; gap: .65rem;
}
.form-row { display: flex; gap: .6rem; flex-wrap: wrap; align-items: center; }
.form-input {
  background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1); border-radius: 8px;
  padding: .45rem .8rem; font-size: .85rem; font-family: inherit; outline: none;
  flex: 1; min-width: 140px; color: #e2e8f0; transition: all .15s;
}
.form-input::placeholder { color: #334155; }
.form-input:focus { border-color: rgba(99,102,241,.5); background: rgba(99,102,241,.06); }
.form-input.narrow { flex: none; width: 80px; min-width: unset; }

.btn-agregar {
  display: flex; align-items: center; gap: .45rem;
  background: rgba(99,102,241,.2); border: 1px solid rgba(99,102,241,.4); color: #a5b4fc;
  border-radius: 8px; padding: .45rem .9rem; font-size: .85rem; cursor: pointer; font-family: inherit; font-weight: 600;
  transition: all .15s; white-space: nowrap;
}
.btn-agregar:hover:not(:disabled) { background: rgba(99,102,241,.3); border-color: rgba(99,102,241,.6); }
.btn-agregar:disabled { opacity: .5; cursor: not-allowed; }
.err-inline { color: #f87171; font-size: .75rem; margin: 0; }

.nota { font-size: .72rem; color: #334155; }
</style>
