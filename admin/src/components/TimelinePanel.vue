<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { getOcupacion, socket } from '../api.js'

// ─── Helpers ──────────────────────────────────────────────────
function ahoraBA() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }))
}
function hoyISO() {
  const d = ahoraBA()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function isoToDDMM(iso) {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}
function tMin(t) {
  if (!t) return 0
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}
function minToT(min) {
  return `${String(Math.floor(min / 60)).padStart(2,'0')}:${String(min % 60).padStart(2,'0')}`
}

// ─── State ────────────────────────────────────────────────────
const HOY = hoyISO()
const fechaISO  = ref(HOY)
const ocupacion = ref(null)
const cargando  = ref(false)
const ahora     = ref(ahoraBA())
const tooltip   = ref(null)
const tlRef     = ref(null)   // outer .tl-root for tooltip positioning
let clockTick

// ─── Load ─────────────────────────────────────────────────────
async function cargar() {
  cargando.value = true
  try {
    ocupacion.value = await getOcupacion(isoToDDMM(fechaISO.value))
  } finally {
    cargando.value = false
  }
}

function irHoy() { fechaISO.value = hoyISO(); cargar() }
const esHoy = computed(() => fechaISO.value === hoyISO())

// ─── Build blocks ─────────────────────────────────────────────
// One block per unique reservation per mesa (dedup by hora start)
const filas = computed(() => {
  if (!ocupacion.value?.mesas) return []
  const { mesas, celdas, franjas } = ocupacion.value

  return mesas.map(mesa => {
    const seenHora = new Set()
    const blocks   = []

    for (let i = 0; i < franjas.length; i++) {
      const franja = franjas[i]
      const celda  = celdas?.[`${franja}-${mesa.id}`]
      if (!celda || celda.estado === 'libre') continue

      if (celda.estado === 'limpieza') {
        const horaMin    = tMin(franja)
        const horaFinMin = i + 1 < franjas.length ? tMin(franjas[i + 1]) : horaMin + 30
        blocks.push({
          id: `lim-${franja}`,
          estado:     'limpieza',
          nombre:     '',
          personas:   0,
          hora:       franja,
          hora_fin:   minToT(horaFinMin),
          horaMin,
          horaFinMin,
        })
        continue
      }

      // ocupada: group by hora to deduplicate across franjas
      const key = celda.hora || franja
      if (seenHora.has(key)) continue
      seenHora.add(key)

      const horaMin    = tMin(celda.hora || franja)
      const horaFinMin = celda.hora_fin ? tMin(celda.hora_fin) : horaMin + 90

      blocks.push({
        id:         `res-${key}-${mesa.id}`,
        estado:     celda.estado,
        nombre:     celda.nombre  || '',
        personas:   celda.personas || 0,
        hora:       celda.hora    || franja,
        hora_fin:   celda.hora_fin || minToT(horaFinMin),
        horaMin,
        horaFinMin,
      })
    }

    return { ...mesa, blocks }
  })
})

// ─── Axis ─────────────────────────────────────────────────────
const axis = computed(() => {
  const franjas = ocupacion.value?.franjas || []
  if (!franjas.length) return { start: 1080, end: 1380, total: 300, ticks: [] }

  let start = tMin(franjas[0]) - 20
  let end   = tMin(franjas[franjas.length - 1]) + 60

  for (const fila of filas.value)
    for (const b of fila.blocks)
      if (b.horaFinMin > end) end = b.horaFinMin

  end   += 20
  start  = Math.max(0, start)
  const total = end - start

  // Tick every 30 min
  const ticks = []
  let t = Math.ceil(start / 30) * 30
  while (t <= end) {
    ticks.push({
      min:    t,
      pct:    (t - start) / total * 100,
      label:  minToT(t),
      isHour: t % 60 === 0,
    })
    t += 30
  }

  return { start, end, total, ticks }
})

// ─── Positioning ──────────────────────────────────────────────
function blockStyle(block) {
  const { start, total } = axis.value
  const l = Math.max(0, (block.horaMin - start) / total * 100)
  const r = Math.min(100, (block.horaFinMin - start) / total * 100)
  return { left: l + '%', width: Math.max(0.5, r - l) + '%' }
}

function blockClass(block) {
  if (block.estado === 'limpieza') return 'lim'
  const nm = ahora.value.getHours() * 60 + ahora.value.getMinutes()
  if (block.horaFinMin <= nm)                       return 'past'
  if (block.horaMin <= nm && block.horaFinMin > nm) return 'active'
  if (block.horaMin - nm <= 30)                     return 'soon'
  return 'fut'
}

// ─── Now-line ─────────────────────────────────────────────────
const nowPct = computed(() => {
  if (!esHoy.value) return null
  const nm = ahora.value.getHours() * 60 + ahora.value.getMinutes()
  const { start, end, total } = axis.value
  if (nm < start || nm > end) return null
  return (nm - start) / total * 100
})

// ─── Tooltip ──────────────────────────────────────────────────
function showTip(e, block, mesa) {
  const rect = tlRef.value?.getBoundingClientRect() || { left: 0, top: 0 }
  tooltip.value = {
    x: e.clientX - rect.left + 14,
    y: e.clientY - rect.top  - 8,
    mesa:  mesa.nombre,
    block,
  }
}

// ─── Stats ────────────────────────────────────────────────────
const stats = computed(() => {
  let total = 0, personas = 0
  const seen = new Set()
  for (const f of filas.value) {
    for (const b of f.blocks) {
      if (b.estado === 'ocupada' && !seen.has(b.id)) {
        seen.add(b.id)
        total++
        personas += b.personas || 0
      }
    }
  }
  return { total, personas }
})

// ─── Lifecycle ────────────────────────────────────────────────
onMounted(() => {
  cargar()
  clockTick = setInterval(() => { ahora.value = ahoraBA() }, 30000)
  socket.on('reserva:nueva',      cargar)
  socket.on('reserva:cancelada',  cargar)
  socket.on('reserva:modificada', cargar)
  socket.on('reserva:no_show',    cargar)
})
onBeforeUnmount(() => {
  clearInterval(clockTick)
  socket.off('reserva:nueva',      cargar)
  socket.off('reserva:cancelada',  cargar)
  socket.off('reserva:modificada', cargar)
  socket.off('reserva:no_show',    cargar)
})
</script>

<template>
  <div ref="tlRef" class="tl-root">

    <!-- ══ TOOLBAR ══ -->
    <div class="tl-toolbar">
      <div class="tl-left-tools">
        <input type="date" v-model="fechaISO" @change="cargar" class="tl-date" />
        <button :class="['tl-hoy', { active: esHoy }]" @click="irHoy">Hoy</button>
        <button class="tl-reload" @click="cargar" :disabled="cargando" :title="'Actualizar'">
          <span :class="{ spinning: cargando }">↺</span>
        </button>
      </div>

      <div class="tl-stats" v-if="stats.total > 0">
        <span class="ts-chip">{{ stats.total }} reservas</span>
        <span class="ts-chip ts-pers">{{ stats.personas }} personas</span>
      </div>

      <div class="tl-legend">
        <span class="leg fut">Confirmada</span>
        <span class="leg soon">Llega en &lt;30min</span>
        <span class="leg active">Ocupada ahora</span>
        <span class="leg past">Finalizada</span>
        <span class="leg lim">Limpieza</span>
      </div>
    </div>

    <!-- ══ GANTT ══ -->
    <div class="gantt-outer">

      <div v-if="!cargando && !filas.length" class="tl-empty">
        <div class="te-ico">📅</div>
        <p>Sin datos para este día</p>
        <p class="te-sub">Seleccioná una fecha con mesas configuradas</p>
      </div>

      <div v-else-if="filas.length" class="gantt-table">

        <!-- ─ Header: time axis ─ -->
        <div class="row header-row">
          <div class="mesa-cell header-mesa-cell">
            <span>Mesas</span>
          </div>
          <div class="time-cell header-time-cell">
            <!-- Ticks -->
            <div
              v-for="tick in axis.ticks"
              :key="tick.min"
              :class="['tick', { 'tick-h': tick.isHour }]"
              :style="`left:${tick.pct}%`"
            >
              <span class="tick-lbl" v-if="tick.isHour || axis.ticks.length <= 18">
                {{ tick.label }}
              </span>
            </div>
            <!-- Now marker in header -->
            <div
              v-if="nowPct !== null"
              class="now-head"
              :style="`left:${nowPct}%`"
            >
              <span class="now-badge">ahora</span>
              <span class="now-stem"></span>
            </div>
          </div>
        </div>

        <!-- ─ Mesa rows ─ -->
        <div
          v-for="fila in filas"
          :key="fila.id"
          class="row mesa-row"
        >
          <!-- Mesa label (sticky) -->
          <div class="mesa-cell mesa-name-cell">
            <span class="mn-n">{{ fila.nombre }}</span>
            <span class="mn-c">{{ fila.capacidad }}p</span>
          </div>

          <!-- Timeline area -->
          <div class="time-cell row-time-cell">

            <!-- Vertical grid lines -->
            <div
              v-for="tick in axis.ticks"
              :key="tick.min"
              :class="['vline', { 'vline-h': tick.isHour }]"
              :style="`left:${tick.pct}%`"
            ></div>

            <!-- Reservation blocks -->
            <div
              v-for="block in fila.blocks"
              :key="block.id"
              :class="['gblock', blockClass(block)]"
              :style="blockStyle(block)"
              @mouseenter="showTip($event, block, fila)"
              @mousemove="showTip($event, block, fila)"
              @mouseleave="tooltip = null"
            >
              <div class="block-inner">
                <span class="bi-name">{{ block.estado === 'limpieza' ? '🧹' : block.nombre }}</span>
                <span class="bi-pers" v-if="block.personas > 0">{{ block.personas }}p</span>
              </div>
            </div>

            <!-- Now-line in this row -->
            <div
              v-if="nowPct !== null"
              class="now-line"
              :style="`left:${nowPct}%`"
            ></div>

          </div>
        </div>

      </div>
    </div>

    <!-- ══ TOOLTIP ══ -->
    <div
      v-if="tooltip"
      class="gantt-tip"
      :style="`left:${tooltip.x}px; top:${tooltip.y}px`"
    >
      <div class="gt-mesa">{{ tooltip.mesa }}</div>
      <template v-if="tooltip.block.estado === 'ocupada'">
        <div class="gt-name">{{ tooltip.block.nombre }}</div>
        <div class="gt-row">👥 {{ tooltip.block.personas }} personas</div>
        <div class="gt-row">🕐 {{ tooltip.block.hora }} – {{ tooltip.block.hora_fin }}</div>
      </template>
      <template v-else-if="tooltip.block.estado === 'limpieza'">
        <div class="gt-name">Limpieza</div>
        <div class="gt-row">{{ tooltip.block.hora }}</div>
      </template>
    </div>

  </div>
</template>

<style scoped>
/* ── Root ── */
.tl-root { display: flex; flex-direction: column; gap: 1rem; position: relative; }

/* ══ TOOLBAR ══ */
.tl-toolbar {
  display: flex;
  align-items: center;
  gap: .85rem;
  flex-wrap: wrap;
  background: #fff;
  border-radius: 14px;
  padding: .85rem 1.25rem;
  box-shadow: 0 2px 12px rgba(0,0,0,.06);
  border: 1px solid #f1f5f9;
}
.tl-left-tools { display: flex; align-items: center; gap: .4rem; }

.tl-date {
  border: 1.5px solid #e2e8f0;
  border-radius: 8px;
  padding: .42rem .75rem;
  font-size: .875rem;
  font-family: inherit;
  color: #0f172a;
  background: #f8fafc;
  outline: none;
  transition: border-color .15s;
}
.tl-date:focus { border-color: #6366f1; background: #fff; }

.tl-hoy {
  padding: .42rem .9rem;
  border-radius: 8px;
  border: 1.5px solid #e2e8f0;
  background: #fff;
  font-size: .8rem;
  font-family: inherit;
  font-weight: 600;
  color: #475569;
  cursor: pointer;
  transition: all .15s;
}
.tl-hoy:hover  { border-color: #6366f1; color: #4338ca; background: #f5f3ff; }
.tl-hoy.active { background: #4f46e5; border-color: #4f46e5; color: #fff; }

.tl-reload {
  width: 34px; height: 34px;
  border-radius: 8px;
  border: 1.5px solid #e2e8f0;
  background: #f8fafc;
  font-size: 1rem;
  cursor: pointer;
  color: #475569;
  display: flex; align-items: center; justify-content: center;
  transition: all .15s;
}
.tl-reload:hover:not(:disabled) { background: #e2e8f0; color: #0f172a; }
.spinning { animation: spin .6s linear infinite; display: inline-block; }
@keyframes spin { to { transform: rotate(360deg); } }

.tl-stats { display: flex; gap: .35rem; }
.ts-chip {
  padding: .25rem .75rem;
  border-radius: 20px;
  font-size: .72rem;
  font-weight: 700;
  background: #f1f5f9;
  color: #475569;
}
.ts-chip.ts-pers { background: #dbeafe; color: #1e40af; }

.tl-legend { display: flex; gap: .5rem; flex-wrap: wrap; margin-left: auto; }
.leg {
  font-size: .67rem;
  font-weight: 600;
  padding: .22rem .65rem;
  border-radius: 20px;
  display: flex; align-items: center; gap: .3rem;
}
.leg::before {
  content: '';
  width: 7px; height: 7px;
  border-radius: 2px;
  display: inline-block;
  flex-shrink: 0;
}
.leg.fut    { background: #f0fdf4; color: #065f46;  } .leg.fut::before    { background: #34d399; }
.leg.soon   { background: #fffbeb; color: #92400e;  } .leg.soon::before   { background: #fbbf24; }
.leg.active { background: #eff6ff; color: #1e40af;  } .leg.active::before { background: #60a5fa; }
.leg.past   { background: #f8fafc; color: #64748b;  } .leg.past::before   { background: #cbd5e1; }
.leg.lim    { background: #faf5ff; color: #6b21a8;  } .leg.lim::before    { background: #c4b5fd; }

/* ══ GANTT ══ */
.gantt-outer {
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 4px 28px rgba(0,0,0,.08);
  overflow: hidden;
}

.tl-empty {
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  padding: 5rem 2rem; gap: .5rem;
  color: #94a3b8; text-align: center;
}
.te-ico { font-size: 2.2rem; }
.tl-empty p { margin: 0; font-size: .9rem; font-weight: 500; color: #64748b; }
.te-sub { font-size: .78rem !important; color: #cbd5e1 !important; font-weight: 400 !important; }

.gantt-table { overflow-x: auto; }

/* ─ Row layout ─ */
.row { display: flex; min-width: 900px; }

/* Mesa column (sticky left) */
.mesa-cell {
  width: 120px;
  min-width: 120px;
  flex-shrink: 0;
  position: sticky;
  left: 0;
  z-index: 12;
  background: #0f172a;
}
.header-mesa-cell {
  height: 44px;
  display: flex; align-items: flex-end;
  padding: 0 .9rem .55rem;
  font-size: .62rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .08em;
  color: rgba(255,255,255,.3);
  border-bottom: 2px solid rgba(255,255,255,.08);
}
.mesa-name-cell {
  min-height: 64px;
  display: flex; flex-direction: column;
  align-items: flex-start; justify-content: center;
  padding: 0 .9rem;
  border-bottom: 1px solid rgba(255,255,255,.06);
}
.mn-n { font-size: .83rem; font-weight: 700; color: #f1f5f9; line-height: 1.2; }
.mn-c { font-size: .62rem; color: rgba(255,255,255,.3); margin-top: 2px; }

/* Time column */
.time-cell { flex: 1; position: relative; }
.header-time-cell {
  height: 44px;
  background: #f8fafc;
  border-bottom: 2px solid #e2e8f0;
  border-left: 1px solid #e2e8f0;
}
.row-time-cell {
  min-height: 64px;
  position: relative;
  background: #fafafa;
  border-left: 1px solid #e2e8f0;
  border-bottom: 1px solid #f1f5f9;
}
.mesa-row:last-child .row-time-cell { border-bottom: none; }
.mesa-row:hover .row-time-cell { background: #f5f7fa; }

/* Ticks */
.tick {
  position: absolute;
  bottom: 0;
  display: flex; flex-direction: column;
  align-items: flex-start;
  pointer-events: none;
  height: 100%;
}
.tick::after {
  content: '';
  display: block;
  width: 1px; height: 7px;
  background: #cbd5e1;
  margin-top: auto;
}
.tick.tick-h::after { height: 13px; background: #94a3b8; }
.tick-lbl {
  font-size: .6rem; font-weight: 600;
  color: #94a3b8;
  white-space: nowrap;
  transform: translateX(-50%);
  margin-top: auto;
  padding-top: 5px;
  line-height: 1;
}
.tick.tick-h .tick-lbl { color: #475569; font-weight: 700; font-size: .65rem; }

/* Vertical grid lines */
.vline {
  position: absolute; top: 0; bottom: 0;
  width: 1px; background: #f0f4f8;
  pointer-events: none;
}
.vline.vline-h { background: #e2e8f0; }

/* ─ Now line ─ */
.now-line {
  position: absolute; top: 0; bottom: 0;
  width: 2px;
  background: linear-gradient(180deg, #ef4444 0%, rgba(239,68,68,.25) 100%);
  pointer-events: none;
  z-index: 8;
}
.now-head {
  position: absolute; bottom: 0;
  transform: translateX(-50%);
  display: flex; flex-direction: column;
  align-items: center;
  pointer-events: none;
  z-index: 15;
}
.now-badge {
  background: #ef4444; color: #fff;
  font-size: .57rem; font-weight: 800;
  padding: .1rem .4rem; border-radius: 20px;
  text-transform: uppercase; letter-spacing: .04em;
  margin-bottom: 2px;
}
.now-stem { width: 2px; height: 14px; background: #ef4444; }

/* ── Blocks ── */
.gblock {
  position: absolute;
  top: 10px; height: 44px;
  border-radius: 8px;
  overflow: hidden;
  cursor: default;
  transition: transform .12s, box-shadow .12s, filter .12s;
  min-width: 28px;
  display: flex; align-items: center;
  border: 1.5px solid transparent;
  box-shadow: 0 2px 8px rgba(0,0,0,.1), inset 0 1px 0 rgba(255,255,255,.4);
}
.gblock:hover { transform: translateY(-2px) scaleY(1.04); box-shadow: 0 8px 20px rgba(0,0,0,.18), inset 0 1px 0 rgba(255,255,255,.4); z-index: 10; }

.gblock.fut {
  background: linear-gradient(135deg, #d1fae5 0%, #6ee7b7 100%);
  border-color: #059669;
}
.gblock.soon {
  background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
  border-color: #d97706;
  animation: pulse-soon 1.8s ease-in-out infinite;
}
@keyframes pulse-soon {
  0%,100% { box-shadow: 0 2px 8px rgba(0,0,0,.1), 0 0 0 0   rgba(217,119,6,.5), inset 0 1px 0 rgba(255,255,255,.4); }
  50%     { box-shadow: 0 2px 8px rgba(0,0,0,.1), 0 0 0 10px rgba(217,119,6,0), inset 0 1px 0 rgba(255,255,255,.4); }
}
.gblock.active {
  background: linear-gradient(135deg, #dbeafe 0%, #93c5fd 100%);
  border-color: #2563eb;
  box-shadow: 0 2px 8px rgba(37,99,235,.2), 0 0 0 2px rgba(37,99,235,.15), inset 0 1px 0 rgba(255,255,255,.5);
}
.gblock.past {
  background: linear-gradient(135deg, #f1f5f9, #e2e8f0);
  border-color: #cbd5e1;
  opacity: .5;
  filter: grayscale(.4);
}
.gblock.lim {
  background: linear-gradient(135deg, #ede9fe, #ddd6fe);
  border-color: #7c3aed;
  opacity: .7;
}

.block-inner {
  padding: 0 .6rem;
  display: flex; flex-direction: column;
  gap: 1px; min-width: 0; overflow: hidden;
}
.bi-name {
  font-size: .72rem; font-weight: 700; color: #1c1c1c;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  line-height: 1.25;
}
.bi-pers {
  font-size: .6rem; font-weight: 600;
  color: #374151; opacity: .75;
  line-height: 1;
}
.gblock.active .bi-name { color: #1e3a8a; }
.gblock.active .bi-pers { color: #1e40af; }
.gblock.soon .bi-name   { color: #92400e; }
.gblock.lim  .bi-name   { color: #4c1d95; }

/* ── Tooltip ── */
.gantt-tip {
  position: absolute;
  background: #0f172a;
  color: #f1f5f9;
  border-radius: 10px;
  padding: .65rem .9rem;
  font-size: .78rem;
  display: flex; flex-direction: column; gap: 4px;
  pointer-events: none;
  z-index: 200;
  white-space: nowrap;
  box-shadow: 0 8px 28px rgba(0,0,0,.35);
  border: 1px solid rgba(255,255,255,.07);
}
.gt-mesa {
  font-size: .62rem; font-weight: 700;
  text-transform: uppercase; letter-spacing: .06em;
  color: rgba(255,255,255,.35);
  margin-bottom: 1px;
}
.gt-name { font-size: .9rem; font-weight: 700; color: #fff; }
.gt-row  { font-size: .75rem; color: rgba(255,255,255,.55); }
</style>
