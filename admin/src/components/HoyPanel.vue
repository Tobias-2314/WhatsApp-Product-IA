<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { getStats, getReservas, getOcupacion, socket } from '../api.js'

const CANVAS_W = 700, CANVAS_H = 420
const MESA_W   = 84,  MESA_H   = 52

// ─── Time helpers ──────────────────────────────────────
function ahoraBA() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }))
}
function hoyDDMM() {
  const d = ahoraBA()
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`
}

// ─── State ─────────────────────────────────────────────
const stats    = ref(null)
const reservas = ref([])
const ocupacion = ref(null)
const ahora     = ref(ahoraBA())
const franjaActiva = ref(null)
const planoRef  = ref(null)
const planoScale = ref(1)
const tooltip   = ref(null)

let clockTick, resizeObs

// ─── Load ──────────────────────────────────────────────
async function cargar() {
  const [s, r, o] = await Promise.allSettled([
    getStats(),
    getReservas({ fecha: hoyDDMM() }),
    getOcupacion(hoyDDMM()),
  ])
  if (s.status === 'fulfilled') stats.value = s.value
  if (r.status === 'fulfilled') reservas.value = r.value
  if (o.status === 'fulfilled') {
    ocupacion.value = o.value
    if (o.value?.franjas?.length) {
      const nm = ahoraBA().getHours() * 60 + ahoraBA().getMinutes()
      let best = o.value.franjas[0], minDif = Infinity
      for (const f of o.value.franjas) {
        const [h, m] = f.split(':').map(Number)
        const dif = Math.abs(h * 60 + m - nm)
        if (dif < minDif) { minDif = dif; best = f }
      }
      franjaActiva.value = best
    }
  }
}

// ─── Floor plan helpers ────────────────────────────────
function posMesa(mesa, idx) {
  if (mesa.x_pos !== null && mesa.y_pos !== null) return { x: mesa.x_pos, y: mesa.y_pos }
  return { x: 40 + (idx % 4) * 160, y: 40 + Math.floor(idx / 4) * 120 }
}

function celdaMesa(id) {
  if (!ocupacion.value || !franjaActiva.value) return { estado: 'libre' }
  return ocupacion.value.celdas?.[`${franjaActiva.value}-${id}`] || { estado: 'libre' }
}

function llegaEn30(id) {
  const c = celdaMesa(id)
  if (c.estado !== 'ocupada' || !c.hora) return false
  const [h, m] = c.hora.split(':').map(Number)
  const nm = ahora.value.getHours() * 60 + ahora.value.getMinutes()
  const diff = h * 60 + m - nm
  return diff > 0 && diff <= 30
}

function mostrarTooltip(e, id) {
  const c = celdaMesa(id)
  if (c.estado === 'libre') { tooltip.value = null; return }
  const rect = planoRef.value?.getBoundingClientRect() || { left: 0, top: 0 }
  const m = ocupacion.value?.mesas?.find(x => x.id === id)
  tooltip.value = {
    nombre: m?.nombre || '',
    estado: c.estado,
    cliente: c.nombre || '',
    personas: c.personas || '',
    hora: c.hora || '',
    x: (e.clientX - rect.left) / planoScale.value + 12,
    y: (e.clientY - rect.top)  / planoScale.value - 8,
  }
}

// ─── Computed ──────────────────────────────────────────
const cola = computed(() => {
  const nm = ahora.value.getHours() * 60 + ahora.value.getMinutes()
  return reservas.value
    .filter(r => r.estado === 'confirmada')
    .map(r => {
      const [h, m] = (r.hora || '00:00').split(':').map(Number)
      const min = h * 60 + m
      return { ...r, min, diff: min - nm }
    })
    .sort((a, b) => a.min - b.min)
})

const proximas = computed(() => cola.value.filter(r => r.diff > -20))
const pasadas  = computed(() => cola.value.filter(r => r.diff <= -20))

const ocupacionActual = computed(() => {
  if (!ocupacion.value?.mesas?.length) return { pct: 0, ocupadas: 0, total: 0 }
  const total = ocupacion.value.mesas.length
  const ocupadas = ocupacion.value.mesas.filter(m => celdaMesa(m.id).estado === 'ocupada').length
  return { pct: Math.round((ocupadas / total) * 100), ocupadas, total }
})

const clockStr = computed(() => {
  const d = ahora.value
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
})

const greeting = computed(() => {
  const h = ahora.value.getHours()
  if (h < 12) return 'Buenos días'
  if (h < 19) return 'Buenas tardes'
  return 'Buenas noches'
})

const fechaStr = computed(() =>
  ahoraBA().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })
)

// ─── Avatar ────────────────────────────────────────────
const COLS = ['#6366f1','#8b5cf6','#06b6d4','#10b981','#f59e0b','#ef4444','#ec4899','#0ea5e9']
function av(nombre) {
  if (!nombre) return { t: '?', c: '#9ca3af' }
  let h = 0
  for (let i = 0; i < nombre.length; i++) h = (h * 31 + nombre.charCodeAt(i)) % COLS.length
  return { t: nombre.trim().split(' ').slice(0,2).map(p => p[0]).join('').toUpperCase(), c: COLS[h] }
}

function diffLabel(diff) {
  if (diff < -10) return 'pasada'
  if (diff <=  0) return 'ahora'
  if (diff <= 30) return `${diff}min`
  const h = Math.floor(diff / 60), m = diff % 60
  return h > 0 ? `${h}h${m > 0 ? m + 'm' : ''}` : `${m}min`
}
function diffClass(diff) {
  if (diff < -10) return 'past'
  if (diff <=  5) return 'now'
  if (diff <= 30) return 'soon'
  return 'future'
}

function updateScale() {
  if (planoRef.value) {
    planoScale.value = Math.min(1, planoRef.value.clientWidth / CANVAS_W)
  }
}

// ─── Lifecycle ─────────────────────────────────────────
onMounted(async () => {
  await cargar()
  await nextTick()
  updateScale()
  resizeObs = new ResizeObserver(updateScale)
  if (planoRef.value) resizeObs.observe(planoRef.value)
  clockTick = setInterval(() => { ahora.value = ahoraBA() }, 30000)
  socket.on('reserva:nueva',      cargar)
  socket.on('reserva:cancelada',  cargar)
  socket.on('reserva:modificada', cargar)
  socket.on('reserva:no_show',    cargar)
})
onBeforeUnmount(() => {
  clearInterval(clockTick)
  resizeObs?.disconnect()
  socket.off('reserva:nueva',      cargar)
  socket.off('reserva:cancelada',  cargar)
  socket.off('reserva:modificada', cargar)
  socket.off('reserva:no_show',    cargar)
})
</script>

<template>
  <div class="hoy">

    <!-- ══ HEADER ══ -->
    <div class="hoy-header">
      <div class="header-left">
        <div class="greeting">{{ greeting }}</div>
        <div class="fecha-str">{{ fechaStr }}</div>
      </div>
      <div class="header-right">
        <div class="live-dot">
          <span class="live-pulse"></span>
          <span class="live-label">En vivo</span>
        </div>
        <div class="big-clock">{{ clockStr }}</div>
      </div>
    </div>

    <!-- ══ MAIN GRID ══ -->
    <div class="hoy-grid">

      <!-- ─ LEFT: KPIs ─ -->
      <div class="kpi-panel">

        <div class="kpi-block" v-if="stats">
          <div class="block-label">Hoy</div>
          <div class="kpi-main-row">
            <div class="kpi-big verde">
              <div class="kb-val">{{ stats.hoy.confirmadas }}</div>
              <div class="kb-lbl">Confirmadas</div>
            </div>
            <div class="kpi-big azul">
              <div class="kb-val">{{ stats.hoy.personas }}</div>
              <div class="kb-lbl">Personas</div>
            </div>
          </div>
          <div class="kpi-small-row">
            <div class="kpi-sm rojo">
              <span class="ks-val">{{ stats.hoy.canceladas }}</span>
              <span class="ks-lbl">Canceladas</span>
            </div>
            <div class="kpi-sm amber">
              <span class="ks-val">{{ stats.hoy.no_shows || 0 }}</span>
              <span class="ks-lbl">No-shows</span>
            </div>
            <div class="kpi-sm indigo">
              <span class="ks-val">{{ stats.proximos7dias?.total || 0 }}</span>
              <span class="ks-lbl">Próx. 7d</span>
            </div>
          </div>
        </div>

        <div class="kpi-skeleton" v-else>
          <div class="sk-block"></div>
          <div class="sk-row"></div>
        </div>

        <!-- Occupancy bar -->
        <div class="ocup-block" v-if="ocupacion">
          <div class="ocup-header">
            <span class="ocup-lbl">Salón ahora</span>
            <span class="ocup-franja">{{ franjaActiva }}</span>
          </div>
          <div class="ocup-track">
            <div class="ocup-fill" :style="`width:${ocupacionActual.pct}%`"></div>
          </div>
          <div class="ocup-text">
            <span>{{ ocupacionActual.ocupadas }} / {{ ocupacionActual.total }} mesas ocupadas</span>
            <span class="ocup-pct">{{ ocupacionActual.pct }}%</span>
          </div>
        </div>

        <!-- Franja selector -->
        <div class="franjas-block" v-if="ocupacion?.franjas?.length">
          <div class="block-label">Franja</div>
          <div class="franjas-pills">
            <button
              v-for="f in ocupacion.franjas"
              :key="f"
              :class="['fpill', { active: franjaActiva === f }]"
              @click="franjaActiva = f"
            >{{ f }}</button>
          </div>
        </div>

        <!-- Legend -->
        <div class="legend-block">
          <div class="leg-item"><span class="ldot libre"></span>Libre</div>
          <div class="leg-item"><span class="ldot ocupada"></span>Ocupada</div>
          <div class="leg-item"><span class="ldot pronto"></span>Llega pronto</div>
          <div class="leg-item"><span class="ldot limpieza"></span>Limpieza</div>
        </div>

      </div>

      <!-- ─ CENTER: FLOOR PLAN ─ -->
      <div class="plano-panel">
        <div class="plano-title-bar">
          <span class="plano-title">Plano del salón</span>
          <span v-if="!ocupacion?.mesas?.length" class="plano-hint">Configurá las mesas en la pestaña Mesas</span>
        </div>

        <div
          ref="planoRef"
          class="plano-outer"
          :style="`height:${CANVAS_H * planoScale}px`"
        >
          <div
            class="plano-canvas"
            :style="`width:${CANVAS_W}px; height:${CANVAS_H}px; transform:scale(${planoScale}); transform-origin:top left`"
          >
            <div
              v-for="(mesa, idx) in (ocupacion?.mesas || [])"
              :key="mesa.id"
              :class="['mesa-chip', celdaMesa(mesa.id).estado, { pronto: llegaEn30(mesa.id) }]"
              :style="`left:${posMesa(mesa,idx).x}px; top:${posMesa(mesa,idx).y}px; width:${MESA_W}px; height:${MESA_H}px`"
              @mouseenter="mostrarTooltip($event, mesa.id)"
              @mousemove="mostrarTooltip($event, mesa.id)"
              @mouseleave="tooltip = null"
            >
              <span class="chip-n">{{ mesa.nombre }}</span>
              <span class="chip-c">{{ mesa.capacidad }}p</span>
              <span v-if="celdaMesa(mesa.id).estado === 'ocupada'" class="chip-p">
                {{ celdaMesa(mesa.id).personas }}p
              </span>
              <span v-if="celdaMesa(mesa.id).estado === 'limpieza'" class="chip-clean">🧹</span>
            </div>

            <div
              v-if="tooltip"
              class="tooltip"
              :style="`left:${tooltip.x}px; top:${tooltip.y}px`"
            >
              <strong>{{ tooltip.nombre }}</strong>
              <template v-if="tooltip.estado === 'ocupada'">
                <span>{{ tooltip.cliente }}</span>
                <span>{{ tooltip.personas }} personas · {{ tooltip.hora }}</span>
              </template>
              <template v-else>
                <span>En limpieza</span>
              </template>
            </div>

            <div v-if="!ocupacion?.mesas?.length" class="plano-empty">
              Sin mesas configuradas
            </div>
          </div>
        </div>
      </div>

      <!-- ─ RIGHT: QUEUE ─ -->
      <div class="cola-panel">
        <div class="cola-head">
          <span class="cola-title">Llegadas de hoy</span>
          <span class="cola-badge" v-if="proximas.length">{{ proximas.length }}</span>
        </div>

        <div class="cola-empty" v-if="!proximas.length && !pasadas.length">
          <div class="ce-icon">📭</div>
          <p>Sin reservas hoy</p>
        </div>

        <div class="cola-scroll" v-else>

          <div
            v-for="r in proximas"
            :key="r.id"
            :class="['cola-item', diffClass(r.diff)]"
          >
            <div class="ci-time">
              <span class="ci-hora">{{ r.hora }}</span>
              <span :class="['ci-diff', diffClass(r.diff)]">{{ diffLabel(r.diff) }}</span>
            </div>
            <div class="ci-av" :style="`background:${av(r.nombre).c}`">{{ av(r.nombre).t }}</div>
            <div class="ci-body">
              <div class="ci-nombre">{{ r.nombre }}</div>
              <div class="ci-meta">{{ r.personas }}p<template v-if="r.mesa_nombre"> · {{ r.mesa_nombre }}</template></div>
            </div>
          </div>

          <template v-if="pasadas.length">
            <div class="cola-sep">Anteriores</div>
            <div
              v-for="r in pasadas"
              :key="r.id"
              class="cola-item past"
            >
              <div class="ci-time">
                <span class="ci-hora faded">{{ r.hora }}</span>
              </div>
              <div class="ci-av faded-av" :style="`background:${av(r.nombre).c}`">{{ av(r.nombre).t }}</div>
              <div class="ci-body">
                <div class="ci-nombre faded">{{ r.nombre }}</div>
                <div class="ci-meta">{{ r.personas }}p</div>
              </div>
            </div>
          </template>

        </div>
      </div>

    </div>
  </div>
</template>

<style scoped>
/* ── Layout ── */
.hoy { display: flex; flex-direction: column; gap: 1rem; }

/* ── Header ── */
.hoy-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #fff;
  border-radius: 14px;
  padding: 1rem 1.4rem;
  box-shadow: 0 2px 12px rgba(0,0,0,.06);
  border: 1px solid #f1f5f9;
}
.header-left   { display: flex; flex-direction: column; gap: .15rem; }
.greeting      { font-size: .72rem; font-weight: 700; text-transform: uppercase; letter-spacing: .07em; color: #6366f1; }
.fecha-str     { font-size: .9rem; font-weight: 600; color: #0f172a; text-transform: capitalize; }
.header-right  { display: flex; align-items: center; gap: .85rem; }
.live-dot      { display: flex; align-items: center; gap: .4rem; }
.live-pulse    {
  width: 8px; height: 8px; border-radius: 50%; background: #22c55e;
  box-shadow: 0 0 0 0 rgba(34,197,94,.6);
  animation: live-ring 2s ease-out infinite;
}
@keyframes live-ring {
  0%   { box-shadow: 0 0 0 0 rgba(34,197,94,.6); }
  70%  { box-shadow: 0 0 0 8px rgba(34,197,94,0); }
  100% { box-shadow: 0 0 0 0 rgba(34,197,94,0); }
}
.live-label    { font-size: .68rem; font-weight: 700; color: #16a34a; text-transform: uppercase; letter-spacing: .05em; }
.big-clock     {
  font-size: 2rem;
  font-weight: 800;
  color: #0f172a;
  letter-spacing: -.04em;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

/* ── Main 3-col grid ── */
.hoy-grid {
  display: grid;
  grid-template-columns: 230px 1fr 256px;
  gap: 1rem;
  align-items: start;
}
@media (max-width: 1100px) { .hoy-grid { grid-template-columns: 230px 1fr; } }
@media (max-width: 700px)  { .hoy-grid { grid-template-columns: 1fr; } }

/* ══ LEFT: KPI PANEL ══ */
.kpi-panel {
  background: linear-gradient(160deg, #0f172a 0%, #1e293b 55%, #0f2040 100%);
  border-radius: 16px;
  padding: 1.1rem;
  display: flex;
  flex-direction: column;
  gap: .85rem;
  color: #fff;
  box-shadow: 0 8px 32px rgba(0,0,0,.2);
}

.block-label {
  font-size: .62rem;
  font-weight: 700;
  letter-spacing: .09em;
  text-transform: uppercase;
  color: rgba(255,255,255,.35);
  margin-bottom: .3rem;
}

.kpi-block { display: flex; flex-direction: column; }
.kpi-main-row { display: grid; grid-template-columns: 1fr 1fr; gap: .55rem; }
.kpi-big {
  background: rgba(255,255,255,.07);
  border: 1px solid rgba(255,255,255,.1);
  border-radius: 12px;
  padding: .8rem .7rem;
  display: flex; flex-direction: column; gap: .1rem;
}
.kb-val { font-size: 2rem; font-weight: 800; line-height: 1; letter-spacing: -.04em; }
.kb-lbl { font-size: .6rem; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; opacity: .45; }
.kpi-big.verde .kb-val { color: #34d399; }
.kpi-big.azul  .kb-val { color: #60a5fa; }

.kpi-small-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: .4rem; margin-top: .45rem; }
.kpi-sm {
  background: rgba(255,255,255,.05);
  border-radius: 9px;
  padding: .55rem .4rem;
  display: flex; flex-direction: column; gap: .06rem;
  align-items: center;
}
.ks-val { font-size: 1.35rem; font-weight: 800; line-height: 1; letter-spacing: -.03em; }
.ks-lbl { font-size: .56rem; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; opacity: .4; text-align: center; }
.kpi-sm.rojo   .ks-val { color: #f87171; }
.kpi-sm.amber  .ks-val { color: #fbbf24; }
.kpi-sm.indigo .ks-val { color: #a78bfa; }

/* Skeleton */
.kpi-skeleton { display: flex; flex-direction: column; gap: .5rem; }
.sk-block { height: 80px; border-radius: 10px; background: rgba(255,255,255,.07); animation: skshimmer 1.3s infinite; }
.sk-row   { height: 45px; border-radius: 8px; background: rgba(255,255,255,.05); animation: skshimmer 1.3s infinite; }
@keyframes skshimmer { 0%,100% { opacity: .6; } 50% { opacity: 1; } }

/* Occupancy */
.ocup-block {
  background: rgba(255,255,255,.05);
  border: 1px solid rgba(255,255,255,.08);
  border-radius: 11px;
  padding: .75rem .8rem;
}
.ocup-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: .5rem; }
.ocup-lbl    { font-size: .65rem; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: rgba(255,255,255,.4); }
.ocup-franja { font-size: .78rem; font-weight: 700; color: #a78bfa; }
.ocup-track  { background: rgba(255,255,255,.1); border-radius: 99px; height: 7px; overflow: hidden; }
.ocup-fill   { height: 100%; background: linear-gradient(90deg, #34d399, #6366f1); border-radius: 99px; transition: width 1s ease; min-width: 4px; }
.ocup-text   { display: flex; justify-content: space-between; font-size: .62rem; color: rgba(255,255,255,.4); margin-top: .4rem; }
.ocup-pct    { font-weight: 700; color: rgba(255,255,255,.6); }

/* Franja pills */
.franjas-block { display: flex; flex-direction: column; gap: .3rem; }
.franjas-pills { display: flex; flex-wrap: wrap; gap: .3rem; }
.fpill {
  background: rgba(255,255,255,.07);
  border: 1px solid rgba(255,255,255,.1);
  color: rgba(255,255,255,.5);
  border-radius: 20px;
  font-size: .7rem;
  font-family: inherit;
  padding: .25rem .6rem;
  cursor: pointer;
  transition: all .15s;
}
.fpill:hover  { background: rgba(255,255,255,.14); color: #fff; }
.fpill.active { background: #6366f1; border-color: #6366f1; color: #fff; font-weight: 700; }

/* Legend */
.legend-block { display: grid; grid-template-columns: 1fr 1fr; gap: .3rem .5rem; }
.leg-item { display: flex; align-items: center; gap: .35rem; font-size: .65rem; color: rgba(255,255,255,.4); }
.ldot { width: 9px; height: 9px; border-radius: 2px; flex-shrink: 0; }
.ldot.libre    { background: #6ee7b7; }
.ldot.ocupada  { background: #93c5fd; }
.ldot.pronto   { background: #fcd34d; }
.ldot.limpieza { background: #c4b5fd; }

/* ══ CENTER: FLOOR PLAN ══ */
.plano-panel {
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 4px 24px rgba(0,0,0,.07);
  overflow: hidden;
}
.plano-title-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: .85rem 1.1rem;
  border-bottom: 1px solid #f1f5f9;
}
.plano-title { font-size: .85rem; font-weight: 700; color: #0f172a; }
.plano-hint  { font-size: .72rem; color: #94a3b8; font-style: italic; }

.plano-outer {
  width: 100%;
  overflow: hidden;
  position: relative;
}
.plano-canvas {
  position: relative;
  background:
    repeating-linear-gradient(90deg, rgba(255,255,255,.03) 0, rgba(255,255,255,.03) 1px, transparent 1px, transparent 32px),
    repeating-linear-gradient(0deg,  rgba(255,255,255,.03) 0, rgba(255,255,255,.03) 1px, transparent 1px, transparent 32px),
    linear-gradient(135deg, #3d2b1f 0%, #5c3d2e 40%, #3d2b1f 100%);
}
.plano-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255,255,255,.3);
  font-size: .875rem;
  font-style: italic;
}

/* Table chips */
.mesa-chip {
  position: absolute;
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  transition: transform .12s, box-shadow .12s;
  cursor: default;
  user-select: none;
  box-shadow: 0 4px 10px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.25);
}
.mesa-chip:hover { transform: translateY(-2px) scale(1.05); z-index: 10; }
.mesa-chip.libre    { background: linear-gradient(145deg, #d1fae5, #a7f3d0); border: 2.5px solid #059669; }
.mesa-chip.ocupada  {
  background: linear-gradient(145deg, #dbeafe, #bfdbfe);
  border: 2.5px solid #2563eb;
  box-shadow: 0 4px 10px rgba(0,0,0,.4), 0 0 0 2px rgba(37,99,235,.2), inset 0 1px 0 rgba(255,255,255,.25);
}
.mesa-chip.limpieza { background: linear-gradient(145deg, #ede9fe, #ddd6fe); border: 2.5px solid #7c3aed; }
.mesa-chip.pronto {
  background: linear-gradient(145deg, #fef3c7, #fde68a);
  border: 2.5px solid #d97706;
  animation: pulse-pronto 1.6s ease-in-out infinite;
}
@keyframes pulse-pronto {
  0%,100% { box-shadow: 0 4px 10px rgba(0,0,0,.4), 0 0 0 0   rgba(217,119,6,.5); }
  50%     { box-shadow: 0 4px 10px rgba(0,0,0,.4), 0 0 0 10px rgba(217,119,6,0); }
}
.chip-n     { font-size: .72rem; font-weight: 800; color: #1c1c1c; }
.chip-c     { font-size: .6rem; color: #374151; }
.chip-p     { font-size: .68rem; font-weight: 700; color: #1e3a8a; }
.chip-clean { font-size: .78rem; line-height: 1; }

/* Tooltip */
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
  box-shadow: 0 4px 12px rgba(0,0,0,.3);
}
.tooltip strong { font-size: .8rem; margin-bottom: 2px; }

/* ══ RIGHT: QUEUE ══ */
.cola-panel {
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 4px 24px rgba(0,0,0,.07);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.cola-head {
  padding: .85rem 1rem;
  border-bottom: 1px solid #f1f5f9;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.cola-title { font-size: .85rem; font-weight: 700; color: #0f172a; }
.cola-badge {
  background: linear-gradient(135deg, #4f46e5, #6366f1);
  color: #fff;
  border-radius: 20px;
  font-size: .68rem;
  font-weight: 800;
  padding: .15rem .65rem;
  min-width: 22px;
  text-align: center;
  box-shadow: 0 2px 8px rgba(99,102,241,.4);
}

.cola-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 3rem 1rem;
  color: #94a3b8;
  text-align: center;
  gap: .5rem;
}
.ce-icon { font-size: 1.8rem; }
.cola-empty p { margin: 0; font-size: .875rem; }

.cola-scroll {
  flex: 1;
  overflow-y: auto;
  padding: .6rem .75rem;
  display: flex;
  flex-direction: column;
  gap: .3rem;
  max-height: 520px;
}

.cola-item {
  display: flex;
  align-items: center;
  gap: .6rem;
  padding: .6rem .7rem;
  border-radius: 11px;
  border: 1.5px solid transparent;
  transition: background .15s;
}
.cola-item.now    { background: #f0fdf4; border-color: #bbf7d0; }
.cola-item.soon   { background: #fffbeb; border-color: #fde68a; }
.cola-item.future { background: #f8fafc; border-color: #e2e8f0; }
.cola-item.past   { opacity: .45; }

.ci-time { display: flex; flex-direction: column; align-items: center; min-width: 38px; gap: .1rem; }
.ci-hora { font-size: .78rem; font-weight: 800; color: #0f172a; font-variant-numeric: tabular-nums; }
.ci-hora.faded { color: #94a3b8; }
.ci-diff {
  font-size: .58rem; font-weight: 700;
  border-radius: 20px;
  padding: .06rem .4rem;
  white-space: nowrap;
}
.ci-diff.now    { background: #d1fae5; color: #065f46; }
.ci-diff.soon   { background: #fef3c7; color: #92400e; }
.ci-diff.future { background: #f1f5f9; color: #475569; }
.ci-diff.past   { color: #94a3b8; }

.ci-av {
  width: 32px; height: 32px;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: .65rem; font-weight: 800; color: #fff;
  flex-shrink: 0;
  box-shadow: 0 2px 8px rgba(0,0,0,.15);
}
.faded-av { filter: grayscale(1); opacity: .6; }

.ci-body { flex: 1; min-width: 0; }
.ci-nombre {
  font-size: .83rem; font-weight: 700; color: #1e293b;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ci-nombre.faded { color: #94a3b8; }
.ci-meta { font-size: .7rem; color: #64748b; }

.cola-sep {
  font-size: .62rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .07em;
  color: #94a3b8;
  padding: .5rem .25rem .15rem;
}
</style>
