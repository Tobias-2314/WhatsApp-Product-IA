<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { getOcupacion, getCombinaciones, socket } from '../api.js'

const CANVAS_W = 700
const CANVAS_H = 420

function hoyISO() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }))
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function isoADDMMYYYY(iso) {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}
function ahoraBA() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }))
}

function mesaDims(cap) {
  if (cap <= 4)  return { w: 66, h: 66 }
  if (cap <= 6)  return { w: 92, h: 54 }
  return              { w: 116, h: 54 }
}
function mesaRadius(cap) {
  return cap <= 4 ? '50%' : cap <= 6 ? '16px' : '10px'
}
function defaultPos(id, idx) {
  return { x: 40 + (idx % 4) * 160, y: 40 + Math.floor(idx / 4) * 120 }
}
function posMesa(mesa, idx) {
  if (mesa.x_pos !== null && mesa.y_pos !== null) return { x: mesa.x_pos, y: mesa.y_pos }
  return defaultPos(mesa.id, idx)
}
function centroSVG(mesaId) {
  if (!ocupacion.value?.mesas) return { x: 0, y: 0 }
  const idx = ocupacion.value.mesas.findIndex(m => m.id === mesaId)
  if (idx < 0) return { x: 0, y: 0 }
  const m = ocupacion.value.mesas[idx]
  const pos = posMesa(m, idx)
  const dims = mesaDims(m.capacidad)
  return { x: pos.x + dims.w / 2, y: pos.y + dims.h / 2 }
}

// ─── State ───────────────────────────────────────────────────
const fechaInput       = ref(hoyISO())
const ocupacion        = ref(null)
const cargando         = ref(false)
const error            = ref('')
const combList         = ref([])
const mesaSeleccionada = ref(null)
const ahora            = ref(ahoraBA())
let clockTick = null

// ─── Franja ──────────────────────────────────────────────────
function franjaActual(franjas) {
  if (!franjas?.length) return null
  const d = ahoraBA()
  const now = d.getHours() * 60 + d.getMinutes()
  let best = franjas[0], minDif = Infinity
  for (const f of franjas) {
    const [h, m] = f.split(':').map(Number)
    const dif = Math.abs(h * 60 + m - now)
    if (dif < minDif) { minDif = dif; best = f }
  }
  return best
}
const franjaSeleccionada = ref(null)

// ─── Helpers de ocupación ─────────────────────────────────────
function celdaMesa(mesaId, franja) {
  const f = franja ?? franjaSeleccionada.value
  if (!ocupacion.value || !f) return { estado: 'libre' }
  return ocupacion.value.celdas?.[`${f}-${mesaId}`] || { estado: 'libre' }
}
function esPronto(mesaId) {
  if (!ocupacion.value || !franjaSeleccionada.value) return false
  const franjas = ocupacion.value.franjas
  const idx = franjas.indexOf(franjaSeleccionada.value)
  if (idx < 0 || idx >= franjas.length - 1) return false
  return celdaMesa(mesaId, franjas[idx + 1]).estado === 'ocupada'
}
function proximaReserva(mesaId) {
  if (!ocupacion.value || !franjaSeleccionada.value) return null
  const franjas = ocupacion.value.franjas
  const idx = franjas.indexOf(franjaSeleccionada.value)
  for (let i = idx + 1; i < franjas.length; i++) {
    const c = celdaMesa(mesaId, franjas[i])
    if (c.estado === 'ocupada') return { franja: franjas[i], ...c }
  }
  return null
}
function ocupadasEnFranja(franja) {
  if (!ocupacion.value?.mesas) return 0
  return ocupacion.value.mesas.filter(m => celdaMesa(m.id, franja).estado === 'ocupada').length
}

function chipStyle(mesa, idx) {
  const pos  = posMesa(mesa, idx)
  const dims = mesaDims(mesa.capacidad)
  return { left: pos.x + 'px', top: pos.y + 'px', width: dims.w + 'px', height: dims.h + 'px', borderRadius: mesaRadius(mesa.capacidad) }
}
function chipClasses(mesa) {
  const c = celdaMesa(mesa.id)
  return [c.estado, { pronto: esPronto(mesa.id), selected: mesaSeleccionada.value === mesa.id }]
}

// ─── Carga ────────────────────────────────────────────────────
async function cargar() {
  cargando.value = true; error.value = ''
  try {
    const [ocu, combs] = await Promise.all([
      getOcupacion(isoADDMMYYYY(fechaInput.value)),
      getCombinaciones()
    ])
    ocupacion.value = ocu
    combList.value  = combs
    if (ocu?.franjas?.length && !franjaSeleccionada.value)
      franjaSeleccionada.value = franjaActual(ocu.franjas)
  } catch (e) { error.value = e.message }
  finally    { cargando.value = false }
}

// ─── Avatar ───────────────────────────────────────────────────
const AV_COLS = ['#6366f1','#8b5cf6','#ec4899','#f59e0b','#10b981','#06b6d4','#3b82f6','#f97316']
function avatar(nombre) {
  if (!nombre) return { col: '#6b7280', txt: '?' }
  let h = 0
  for (const c of nombre) h = (h * 31 + c.charCodeAt(0)) % AV_COLS.length
  return { col: AV_COLS[h], txt: nombre.split(' ').map(w => w[0]).slice(0,2).join('').toUpperCase() }
}

// ─── Stats ────────────────────────────────────────────────────
const stats = computed(() => {
  if (!ocupacion.value?.mesas || !franjaSeleccionada.value) return null
  let ocu = 0, lib = 0, lim = 0, pers = 0
  for (const m of ocupacion.value.mesas) {
    const c = celdaMesa(m.id)
    if (c.estado === 'ocupada')   { ocu++; pers += c.personas || 0 }
    else if (c.estado === 'limpieza') lim++
    else lib++
  }
  return { ocu, lib, lim, pers, total: ocupacion.value.mesas.length }
})

const detalle = computed(() => {
  if (!mesaSeleccionada.value || !ocupacion.value) return null
  const mesa = ocupacion.value.mesas.find(m => m.id === mesaSeleccionada.value)
  if (!mesa) return null
  return { mesa, celda: celdaMesa(mesa.id), prox: proximaReserva(mesa.id) }
})

onMounted(() => {
  cargar()
  clockTick = setInterval(() => ahora.value = ahoraBA(), 30000)
  socket.on('reserva:nueva',      cargar)
  socket.on('reserva:cancelada',  cargar)
  socket.on('reserva:no_show',    cargar)
  socket.on('reserva:modificada', cargar)
})
onUnmounted(() => {
  clearInterval(clockTick)
  socket.off('reserva:nueva',      cargar)
  socket.off('reserva:cancelada',  cargar)
  socket.off('reserva:no_show',    cargar)
  socket.off('reserva:modificada', cargar)
})
</script>

<template>
  <div class="ocu-panel">

    <!-- ── Toolbar ── -->
    <div class="toolbar">
      <div class="toolbar-left">
        <div class="date-wrap">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="icon-cal"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          <input type="date" v-model="fechaInput" @change="() => { franjaSeleccionada = null; cargar() }" />
        </div>
        <div class="live-badge">
          <span class="live-dot"></span>LIVE
        </div>
      </div>
      <button class="btn-refresh" @click="cargar" :disabled="cargando">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" :class="{ spinning: cargando }"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
        {{ cargando ? 'Cargando…' : 'Actualizar' }}
      </button>
    </div>

    <p v-if="error" class="err-msg">{{ error }}</p>

    <div v-if="!ocupacion && !cargando" class="empty-state">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#4b5563" stroke-width="1.5"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
      <p>Seleccioná una fecha para ver el plano del salón</p>
    </div>

    <template v-if="ocupacion">

      <!-- ── Franja selector ── -->
      <div class="franjas-row">
        <span class="franjas-label">FRANJA</span>
        <button
          v-for="f in ocupacion.franjas" :key="f"
          :class="['pill', { activa: franjaSeleccionada === f }]"
          @click="franjaSeleccionada = f"
        >
          <span class="pill-hora">{{ f }}</span>
          <span class="pill-ocu" :class="{ 'has-ocu': ocupadasEnFranja(f) > 0 }">
            {{ ocupadasEnFranja(f) }}/{{ ocupacion.mesas.length }}
          </span>
        </button>
      </div>

      <!-- ── Main layout ── -->
      <div class="main-layout">

        <!-- Plano -->
        <div class="plano-scroll">
          <div class="canvas" :style="`width:${CANVAS_W}px;height:${CANVAS_H}px`"
            @click.self="mesaSeleccionada = null">

            <!-- SVG: decorations + combo lines -->
            <svg class="svg-ov" :width="CANVAS_W" :height="CANVAS_H">
              <!-- Floor grid -->
              <defs>
                <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                  <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,0.03)" stroke-width="1"/>
                </pattern>
                <filter id="glow-combo">
                  <feGaussianBlur stdDeviation="3" result="blur"/>
                  <feComposite in="SourceGraphic" in2="blur" operator="over"/>
                </filter>
              </defs>
              <rect width="100%" height="100%" fill="url(#grid)"/>

              <!-- Wall accents -->
              <rect x="0" y="0" width="700" height="4" fill="rgba(255,255,255,0.04)" rx="0"/>
              <rect x="0" y="416" width="700" height="4" fill="rgba(255,255,255,0.04)" rx="0"/>
              <rect x="0" y="0" width="4" height="420" fill="rgba(255,255,255,0.04)" rx="0"/>
              <rect x="696" y="0" width="4" height="420" fill="rgba(255,255,255,0.04)" rx="0"/>

              <!-- Entrance indicator -->
              <rect x="295" y="410" width="110" height="1" fill="rgba(99,102,241,0.5)" rx="1"/>
              <text x="350" y="407" text-anchor="middle" fill="rgba(99,102,241,0.6)" font-size="9" font-family="monospace" letter-spacing="3">ENTRADA</text>

              <!-- Corner plants (decorative) -->
              <circle cx="22" cy="22" r="10" fill="rgba(16,185,129,0.07)" stroke="rgba(16,185,129,0.12)" stroke-width="1"/>
              <circle cx="22" cy="22" r="5" fill="rgba(16,185,129,0.12)"/>
              <circle cx="678" cy="22" r="10" fill="rgba(16,185,129,0.07)" stroke="rgba(16,185,129,0.12)" stroke-width="1"/>
              <circle cx="678" cy="22" r="5" fill="rgba(16,185,129,0.12)"/>

              <!-- Combination lines -->
              <line
                v-for="c in combList" :key="`${c.mesa_id_1}-${c.mesa_id_2}`"
                :x1="centroSVG(c.mesa_id_1).x" :y1="centroSVG(c.mesa_id_1).y"
                :x2="centroSVG(c.mesa_id_2).x" :y2="centroSVG(c.mesa_id_2).y"
                class="comb-line" filter="url(#glow-combo)"
              />
            </svg>

            <!-- Mesa chips -->
            <div
              v-for="(mesa, idx) in ocupacion.mesas" :key="mesa.id"
              class="mesa-chip"
              :class="chipClasses(mesa)"
              :style="chipStyle(mesa, idx)"
              @click.stop="mesaSeleccionada = mesaSeleccionada === mesa.id ? null : mesa.id"
            >
              <span class="chip-nm">{{ mesa.nombre }}</span>
              <span class="chip-cap">{{ mesa.capacidad }}p</span>
              <span v-if="celdaMesa(mesa.id).estado === 'ocupada'" class="chip-pers">
                {{ celdaMesa(mesa.id).personas }}
              </span>
              <span v-if="celdaMesa(mesa.id).estado === 'limpieza'" class="chip-icon">✦</span>
            </div>
          </div>
        </div>

        <!-- Detail panel -->
        <div class="detail-panel">
          <template v-if="detalle">
            <!-- Table header -->
            <div class="dp-header">
              <div class="dp-shape" :class="detalle.celda.estado"
                :style="{ borderRadius: mesaRadius(detalle.mesa.capacidad) }">
                {{ detalle.mesa.nombre.split(' ').pop() }}
              </div>
              <div class="dp-title-col">
                <div class="dp-mesa-nm">{{ detalle.mesa.nombre }}</div>
                <div class="dp-cap">{{ detalle.mesa.capacidad }} personas</div>
              </div>
              <button class="dp-close" @click="mesaSeleccionada = null" title="Cerrar">✕</button>
            </div>

            <!-- Status badge -->
            <div class="dp-status-row">
              <span class="dp-badge" :class="detalle.celda.estado">
                <span class="dp-dot"></span>
                {{ detalle.celda.estado === 'libre' ? 'Disponible' : detalle.celda.estado === 'ocupada' ? 'Ocupada' : 'En limpieza' }}
              </span>
              <span v-if="esPronto(detalle.mesa.id)" class="dp-badge pronto">
                <span class="dp-dot"></span>Pronto
              </span>
            </div>

            <!-- Ocupada info -->
            <div v-if="detalle.celda.estado === 'ocupada'" class="dp-client-card">
              <div class="dp-av" :style="{ background: avatar(detalle.celda.nombre).col }">
                {{ avatar(detalle.celda.nombre).txt }}
              </div>
              <div class="dp-client-info">
                <div class="dp-client-nm">{{ detalle.celda.nombre || '—' }}</div>
                <div class="dp-client-det">{{ detalle.celda.personas }} personas</div>
                <div class="dp-client-time">{{ detalle.celda.hora }} – {{ detalle.celda.hora_fin }}</div>
              </div>
            </div>

            <!-- Limpieza info -->
            <div v-else-if="detalle.celda.estado === 'limpieza'" class="dp-clean-card">
              <div class="dp-clean-icon">✦</div>
              <div>
                <div class="dp-clean-title">En preparación</div>
                <div class="dp-clean-sub">Próxima disponibilidad</div>
              </div>
            </div>

            <!-- Libre info -->
            <div v-else class="dp-libre-card">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              <span>Mesa disponible</span>
            </div>

            <!-- Próxima reserva -->
            <div v-if="detalle.prox" class="dp-next">
              <div class="dp-next-label">PRÓXIMA RESERVA</div>
              <div class="dp-next-card">
                <div class="dp-av sm" :style="{ background: avatar(detalle.prox.nombre).col }">
                  {{ avatar(detalle.prox.nombre).txt }}
                </div>
                <div>
                  <div class="dp-next-nm">{{ detalle.prox.nombre }}</div>
                  <div class="dp-next-time">{{ detalle.prox.franja }} · {{ detalle.prox.personas }}p</div>
                </div>
              </div>
            </div>
          </template>

          <!-- No selection -->
          <template v-else>
            <div class="dp-empty-header">
              <span class="dp-empty-title">RESUMEN</span>
              <span class="dp-empty-sub">Hacé click en una mesa</span>
            </div>
            <div class="dp-list" v-if="franjaSeleccionada">
              <div
                v-for="(mesa, idx) in ocupacion.mesas" :key="mesa.id"
                class="dp-list-item"
                :class="celdaMesa(mesa.id).estado"
                @click="mesaSeleccionada = mesa.id"
              >
                <div class="dpl-shape" :class="celdaMesa(mesa.id).estado"
                  :style="{ borderRadius: mesaRadius(mesa.capacidad) }">
                </div>
                <div class="dpl-info">
                  <span class="dpl-nm">{{ mesa.nombre }}</span>
                  <span class="dpl-det" v-if="celdaMesa(mesa.id).estado === 'ocupada'">
                    {{ celdaMesa(mesa.id).nombre }} · {{ celdaMesa(mesa.id).personas }}p
                  </span>
                  <span class="dpl-det" v-else-if="celdaMesa(mesa.id).estado === 'limpieza'">limpieza</span>
                  <span class="dpl-det" v-else>libre</span>
                </div>
                <div class="dpl-dot" :class="celdaMesa(mesa.id).estado"></div>
              </div>
            </div>
          </template>
        </div>

      </div>

      <!-- ── Stats row ── -->
      <div class="stats-row" v-if="stats">
        <div class="stat-card">
          <span class="stat-val">{{ stats.total }}</span>
          <span class="stat-lbl">Total</span>
        </div>
        <div class="stat-card ocu">
          <span class="stat-val">{{ stats.ocu }}</span>
          <span class="stat-lbl">Ocupadas</span>
        </div>
        <div class="stat-card lib">
          <span class="stat-val">{{ stats.lib }}</span>
          <span class="stat-lbl">Libres</span>
        </div>
        <div class="stat-card lim">
          <span class="stat-val">{{ stats.lim }}</span>
          <span class="stat-lbl">Limpieza</span>
        </div>
        <div class="stat-card pers">
          <span class="stat-val">{{ stats.pers }}</span>
          <span class="stat-lbl">Personas</span>
        </div>
        <div class="stat-leyenda">
          <span class="ley-item"><span class="ley-dot libre"></span>Libre</span>
          <span class="ley-item"><span class="ley-dot ocupada"></span>Ocupada</span>
          <span class="ley-item"><span class="ley-dot limpieza"></span>Limpieza</span>
          <span class="ley-item"><span class="ley-dot pronto"></span>Pronto</span>
        </div>
      </div>

    </template>
  </div>
</template>

<style scoped>
/* ── Base ── */
.ocu-panel { display: flex; flex-direction: column; gap: 1rem; color: #f1f5f9; }

/* ── Toolbar ── */
.toolbar {
  display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: .75rem;
  background: #1e293b; border: 1px solid rgba(255,255,255,.07); border-radius: 10px; padding: .65rem 1rem;
}
.toolbar-left { display: flex; align-items: center; gap: .75rem; }
.date-wrap {
  display: flex; align-items: center; gap: .5rem;
  background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1); border-radius: 8px; padding: .4rem .7rem;
  color: #94a3b8;
}
.icon-cal { opacity: .7; flex-shrink: 0; }
.date-wrap input[type="date"] {
  background: transparent; border: none; color: #e2e8f0; font-size: .85rem; font-family: inherit; outline: none;
}
.date-wrap input[type="date"]::-webkit-calendar-picker-indicator { filter: invert(1) opacity(.4); cursor: pointer; }

.live-badge {
  display: flex; align-items: center; gap: .35rem;
  background: rgba(239,68,68,.1); border: 1px solid rgba(239,68,68,.25); border-radius: 20px;
  padding: .2rem .6rem; font-size: .68rem; font-weight: 700; letter-spacing: .08em; color: #f87171;
}
.live-dot {
  width: 6px; height: 6px; border-radius: 50%; background: #ef4444;
  animation: live-blink 1.5s ease-in-out infinite;
}
@keyframes live-blink { 0%,100% { opacity: 1; } 50% { opacity: .2; } }

.btn-refresh {
  display: flex; align-items: center; gap: .45rem;
  background: rgba(99,102,241,.15); border: 1px solid rgba(99,102,241,.35); color: #a5b4fc;
  border-radius: 8px; padding: .4rem .85rem; font-size: .82rem; font-family: inherit; cursor: pointer;
  transition: all .15s;
}
.btn-refresh:hover:not(:disabled) { background: rgba(99,102,241,.25); border-color: rgba(99,102,241,.55); }
.btn-refresh:disabled { opacity: .5; cursor: not-allowed; }
.spinning { animation: spin .7s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* ── Error / empty ── */
.err-msg { color: #f87171; font-size: .82rem; background: rgba(239,68,68,.1); border: 1px solid rgba(239,68,68,.2); border-radius: 8px; padding: .5rem .75rem; }
.empty-state {
  display: flex; flex-direction: column; align-items: center; gap: .75rem;
  background: #1e293b; border: 1px solid rgba(255,255,255,.07); border-radius: 12px;
  padding: 3rem; color: #64748b; font-size: .875rem; text-align: center;
}

/* ── Franja selector ── */
.franjas-row { display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; }
.franjas-label { font-size: .65rem; font-weight: 700; letter-spacing: .1em; color: #475569; flex-shrink: 0; }
.pill {
  display: flex; align-items: center; gap: .35rem;
  background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.09); border-radius: 20px;
  padding: .3rem .7rem; cursor: pointer; transition: all .15s; font-family: inherit;
}
.pill:hover { background: rgba(99,102,241,.1); border-color: rgba(99,102,241,.3); }
.pill.activa {
  background: rgba(99,102,241,.2); border-color: rgba(99,102,241,.5);
  box-shadow: 0 0 12px rgba(99,102,241,.2);
}
.pill-hora { font-size: .82rem; font-weight: 600; color: #e2e8f0; }
.pill.activa .pill-hora { color: #a5b4fc; }
.pill-ocu { font-size: .65rem; color: #64748b; }
.pill-ocu.has-ocu { color: #60a5fa; font-weight: 600; }

/* ── Main layout ── */
.main-layout { display: flex; gap: 1rem; align-items: flex-start; min-height: 0; }
.plano-scroll { flex: 1; min-width: 0; overflow-x: auto; }

/* ── Canvas ── */
.canvas {
  position: relative; overflow: hidden; border-radius: 12px; cursor: default;
  background:
    radial-gradient(ellipse at 20% 20%, rgba(99,102,241,.04) 0%, transparent 50%),
    radial-gradient(ellipse at 80% 80%, rgba(16,185,129,.03) 0%, transparent 50%),
    linear-gradient(160deg, #0c1220 0%, #0f172a 50%, #0b1120 100%);
  border: 1px solid rgba(255,255,255,.08);
  box-shadow: inset 0 0 60px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.05), 0 8px 32px rgba(0,0,0,.3);
}
.svg-ov { position: absolute; top: 0; left: 0; pointer-events: none; }
.comb-line {
  stroke: rgba(139,92,246,.5); stroke-width: 1.5; stroke-dasharray: 6 4;
}

/* ── Mesa chip ── */
.mesa-chip {
  position: absolute; display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 1px; cursor: pointer; transition: all .2s; user-select: none;
}

/* Libre */
.mesa-chip.libre {
  background: linear-gradient(145deg, rgba(16,185,129,.18), rgba(5,150,105,.08));
  border: 1.5px solid rgba(16,185,129,.45);
  box-shadow: 0 0 0 1px rgba(16,185,129,.1), 0 4px 14px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.07);
}
.mesa-chip.libre:hover {
  border-color: rgba(16,185,129,.7); transform: translateY(-2px) scale(1.04);
  box-shadow: 0 0 16px rgba(16,185,129,.25), 0 0 0 2px rgba(16,185,129,.15), 0 6px 18px rgba(0,0,0,.5);
}

/* Ocupada */
.mesa-chip.ocupada {
  background: linear-gradient(145deg, rgba(59,130,246,.28), rgba(37,99,235,.14));
  border: 1.5px solid rgba(59,130,246,.55);
  box-shadow: 0 0 20px rgba(59,130,246,.2), 0 0 0 2px rgba(59,130,246,.1), 0 4px 14px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.1);
}
.mesa-chip.ocupada:hover { transform: translateY(-2px) scale(1.04);
  box-shadow: 0 0 28px rgba(59,130,246,.35), 0 0 0 3px rgba(59,130,246,.2), 0 6px 18px rgba(0,0,0,.5);
}

/* Limpieza */
.mesa-chip.limpieza {
  background: linear-gradient(145deg, rgba(245,158,11,.2), rgba(217,119,6,.1));
  border: 1.5px solid rgba(245,158,11,.45);
  box-shadow: 0 0 14px rgba(245,158,11,.15), 0 0 0 1px rgba(245,158,11,.1), 0 4px 14px rgba(0,0,0,.5);
}
.mesa-chip.limpieza:hover { transform: translateY(-2px) scale(1.04);
  box-shadow: 0 0 20px rgba(245,158,11,.25), 0 0 0 2px rgba(245,158,11,.15), 0 6px 18px rgba(0,0,0,.5);
}

/* Pronto */
.mesa-chip.pronto {
  border-color: rgba(167,139,250,.65) !important;
  box-shadow: 0 0 18px rgba(167,139,250,.25), 0 0 0 2px rgba(167,139,250,.12), 0 4px 14px rgba(0,0,0,.5) !important;
  animation: pronto-pulse 2s ease-in-out infinite;
}
@keyframes pronto-pulse {
  0%,100% { box-shadow: 0 0 18px rgba(167,139,250,.2), 0 0 0 2px rgba(167,139,250,.1), 0 4px 14px rgba(0,0,0,.5); }
  50%      { box-shadow: 0 0 30px rgba(167,139,250,.4), 0 0 0 4px rgba(167,139,250,.2), 0 4px 14px rgba(0,0,0,.5); }
}

/* Selected */
.mesa-chip.selected {
  outline: 2px solid rgba(99,102,241,.8);
  outline-offset: 3px;
  z-index: 20;
  transform: translateY(-3px) scale(1.06);
}

/* Chip text */
.chip-nm   { font-size: .68rem; font-weight: 800; letter-spacing: .01em; color: #e2e8f0; }
.chip-cap  { font-size: .58rem; color: rgba(255,255,255,.45); }
.chip-pers { font-size: .72rem; font-weight: 700; color: #93c5fd; margin-top: 1px; }
.chip-icon { font-size: .65rem; color: #fcd34d; opacity: .8; }

/* ── Detail panel ── */
.detail-panel {
  width: 268px; flex-shrink: 0;
  background: #1e293b; border: 1px solid rgba(255,255,255,.07); border-radius: 12px;
  padding: 1rem; display: flex; flex-direction: column; gap: .75rem; min-height: 200px;
  max-height: 420px; overflow-y: auto;
}

/* Scrollbar for detail panel */
.detail-panel::-webkit-scrollbar { width: 4px; }
.detail-panel::-webkit-scrollbar-track { background: transparent; }
.detail-panel::-webkit-scrollbar-thumb { background: rgba(255,255,255,.1); border-radius: 2px; }

.dp-header { display: flex; align-items: center; gap: .75rem; }
.dp-shape {
  width: 42px; height: 42px; flex-shrink: 0; display: flex; align-items: center; justify-content: center;
  font-size: .8rem; font-weight: 800; color: #e2e8f0;
}
.dp-shape.libre    { background: rgba(16,185,129,.2);   border: 1.5px solid rgba(16,185,129,.4); }
.dp-shape.ocupada  { background: rgba(59,130,246,.25);  border: 1.5px solid rgba(59,130,246,.5); }
.dp-shape.limpieza { background: rgba(245,158,11,.2);   border: 1.5px solid rgba(245,158,11,.4); }

.dp-title-col { flex: 1; min-width: 0; }
.dp-mesa-nm { font-size: .9rem; font-weight: 700; color: #e2e8f0; }
.dp-cap     { font-size: .72rem; color: #64748b; margin-top: 1px; }

.dp-close {
  background: transparent; border: 1px solid rgba(255,255,255,.1); color: #64748b;
  width: 24px; height: 24px; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: .75rem; flex-shrink: 0;
}
.dp-close:hover { background: rgba(255,255,255,.06); color: #94a3b8; }

.dp-status-row { display: flex; gap: .5rem; flex-wrap: wrap; }
.dp-badge {
  display: inline-flex; align-items: center; gap: .35rem;
  border-radius: 20px; padding: .22rem .65rem; font-size: .72rem; font-weight: 600;
}
.dp-badge.libre    { background: rgba(16,185,129,.12); border: 1px solid rgba(16,185,129,.3); color: #34d399; }
.dp-badge.ocupada  { background: rgba(59,130,246,.12); border: 1px solid rgba(59,130,246,.3); color: #60a5fa; }
.dp-badge.limpieza { background: rgba(245,158,11,.12); border: 1px solid rgba(245,158,11,.3); color: #fbbf24; }
.dp-badge.pronto   { background: rgba(167,139,250,.12); border: 1px solid rgba(167,139,250,.3); color: #c4b5fd; }
.dp-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }

.dp-client-card {
  display: flex; align-items: flex-start; gap: .65rem;
  background: rgba(59,130,246,.07); border: 1px solid rgba(59,130,246,.15); border-radius: 10px; padding: .75rem;
}
.dp-av {
  width: 38px; height: 38px; border-radius: 10px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center; font-size: .8rem; font-weight: 800; color: #fff;
}
.dp-av.sm { width: 28px; height: 28px; border-radius: 7px; font-size: .65rem; flex-shrink: 0; }
.dp-client-info { display: flex; flex-direction: column; gap: 2px; }
.dp-client-nm   { font-size: .85rem; font-weight: 700; color: #e2e8f0; }
.dp-client-det  { font-size: .72rem; color: #94a3b8; }
.dp-client-time { font-size: .72rem; color: #60a5fa; font-weight: 600; }

.dp-clean-card {
  display: flex; align-items: center; gap: .75rem;
  background: rgba(245,158,11,.07); border: 1px solid rgba(245,158,11,.15); border-radius: 10px; padding: .75rem;
}
.dp-clean-icon  { font-size: 1.3rem; color: #fbbf24; }
.dp-clean-title { font-size: .85rem; font-weight: 600; color: #e2e8f0; }
.dp-clean-sub   { font-size: .72rem; color: #94a3b8; margin-top: 1px; }

.dp-libre-card {
  display: flex; align-items: center; gap: .65rem;
  background: rgba(16,185,129,.07); border: 1px solid rgba(16,185,129,.15); border-radius: 10px; padding: .75rem;
  color: #34d399; font-size: .82rem; font-weight: 500;
}

.dp-next { display: flex; flex-direction: column; gap: .4rem; }
.dp-next-label { font-size: .62rem; font-weight: 700; letter-spacing: .1em; color: #475569; }
.dp-next-card  { display: flex; align-items: center; gap: .6rem; }
.dp-next-nm    { font-size: .8rem; font-weight: 600; color: #cbd5e1; }
.dp-next-time  { font-size: .7rem; color: #64748b; margin-top: 1px; }

/* Empty / summary list */
.dp-empty-header { display: flex; flex-direction: column; gap: .2rem; padding-bottom: .5rem; border-bottom: 1px solid rgba(255,255,255,.06); }
.dp-empty-title { font-size: .7rem; font-weight: 700; letter-spacing: .1em; color: #475569; }
.dp-empty-sub   { font-size: .72rem; color: #334155; }

.dp-list { display: flex; flex-direction: column; gap: .3rem; }
.dp-list-item {
  display: flex; align-items: center; gap: .6rem;
  padding: .4rem .55rem; border-radius: 7px; cursor: pointer; transition: background .12s;
  border: 1px solid transparent;
}
.dp-list-item:hover { background: rgba(255,255,255,.04); border-color: rgba(255,255,255,.07); }

.dpl-shape { width: 12px; height: 12px; flex-shrink: 0; }
.dpl-shape.libre    { background: rgba(16,185,129,.5);  border: 1px solid rgba(16,185,129,.7); }
.dpl-shape.ocupada  { background: rgba(59,130,246,.5);  border: 1px solid rgba(59,130,246,.7); }
.dpl-shape.limpieza { background: rgba(245,158,11,.5);  border: 1px solid rgba(245,158,11,.7); }

.dpl-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.dpl-nm   { font-size: .78rem; font-weight: 600; color: #cbd5e1; }
.dpl-det  { font-size: .68rem; color: #475569; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dp-list-item.ocupada .dpl-det { color: #60a5fa; }

.dpl-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.dpl-dot.libre    { background: rgba(16,185,129,.6); }
.dpl-dot.ocupada  { background: #3b82f6; box-shadow: 0 0 6px rgba(59,130,246,.5); }
.dpl-dot.limpieza { background: rgba(245,158,11,.7); }

/* ── Stats row ── */
.stats-row {
  display: flex; align-items: center; gap: .5rem; flex-wrap: wrap;
  background: #1e293b; border: 1px solid rgba(255,255,255,.07); border-radius: 10px; padding: .65rem 1rem;
}
.stat-card {
  display: flex; flex-direction: column; align-items: center; gap: 1px;
  padding: .35rem .8rem; border-radius: 8px; min-width: 60px;
  background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.07);
}
.stat-card.ocu  { border-color: rgba(59,130,246,.2);  background: rgba(59,130,246,.06); }
.stat-card.lib  { border-color: rgba(16,185,129,.2);  background: rgba(16,185,129,.06); }
.stat-card.lim  { border-color: rgba(245,158,11,.2);  background: rgba(245,158,11,.06); }
.stat-card.pers { border-color: rgba(99,102,241,.2);  background: rgba(99,102,241,.06); }
.stat-val { font-size: 1.15rem; font-weight: 800; color: #e2e8f0; line-height: 1; }
.stat-card.ocu  .stat-val { color: #60a5fa; }
.stat-card.lib  .stat-val { color: #34d399; }
.stat-card.lim  .stat-val { color: #fbbf24; }
.stat-card.pers .stat-val { color: #a5b4fc; }
.stat-lbl { font-size: .62rem; color: #475569; font-weight: 600; letter-spacing: .03em; }

.stat-leyenda { display: flex; gap: .75rem; margin-left: auto; flex-wrap: wrap; }
.ley-item { display: flex; align-items: center; gap: .3rem; font-size: .7rem; color: #64748b; }
.ley-dot  { width: 9px; height: 9px; border-radius: 50%; }
.ley-dot.libre    { background: rgba(16,185,129,.7); }
.ley-dot.ocupada  { background: #3b82f6; box-shadow: 0 0 5px rgba(59,130,246,.5); }
.ley-dot.limpieza { background: rgba(245,158,11,.7); }
.ley-dot.pronto   { background: rgba(167,139,250,.7); box-shadow: 0 0 5px rgba(167,139,250,.4); }
</style>
