<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { getReservas, cancelarReserva, marcarNoShow, socket } from '../api.js'

const emit = defineEmits(['cancelada', 'noshow'])

function ahoraBA() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }))
}
function toISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
const HOY = toISO(ahoraBA())

const mesNav    = ref({ y: Number(HOY.slice(0,4)), m: Number(HOY.slice(5,7)) - 1 })
const diaActivo = ref(HOY)
const todas     = ref([])
const cargando  = ref(false)
const confirmando   = ref(null)
const confirmandoNS = ref(null)
const accionId  = ref(null)

async function cargar() {
  cargando.value = true
  try { todas.value = await getReservas() }
  finally { cargando.value = false }
}

function ddmmToISO(s) {
  if (!s) return ''
  const [d, m, y] = s.split('/')
  return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`
}

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const DIAS  = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb']

function navMes(delta) {
  let { y, m } = mesNav.value
  m += delta
  if (m < 0) { m = 11; y-- }
  if (m > 11) { m = 0; y++ }
  mesNav.value = { y, m }
}

const celdas = computed(() => {
  const { y, m } = mesNav.value
  const primer = new Date(y, m, 1).getDay()
  const total  = new Date(y, m + 1, 0).getDate()
  const out = []
  for (let i = 0; i < primer; i++) out.push(null)
  for (let d = 1; d <= total; d++)
    out.push(`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`)
  return out
})

const mapa = computed(() => {
  const m = {}
  for (const r of todas.value) {
    const iso = ddmmToISO(r.fecha)
    if (!m[iso]) m[iso] = []
    m[iso].push(r)
  }
  return m
})

function rsv(iso)   { return mapa.value[iso] || [] }
function nConf(iso) { return rsv(iso).filter(r => r.estado === 'confirmada').length }
function nPers(iso) { return rsv(iso).filter(r => r.estado === 'confirmada').reduce((s, r) => s + (r.personas || 0), 0) }
function nivel(iso) {
  const n = nConf(iso)
  if (n === 0) return 0
  if (n <= 2)  return 1
  if (n <= 5)  return 2
  return 3
}

const rsvDia = computed(() =>
  [...rsv(diaActivo.value)].sort((a, b) => (a.hora || '').localeCompare(b.hora || ''))
)

function labelFecha(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return new Date(+y, +m - 1, +d).toLocaleDateString('es-AR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  })
}

const COLORES = ['#6366f1','#8b5cf6','#06b6d4','#10b981','#f59e0b','#ef4444','#ec4899','#0ea5e9']
function avatar(nombre) {
  if (!nombre) return { txt: '?', col: '#9ca3af' }
  let h = 0
  for (let i = 0; i < nombre.length; i++) h = (h * 31 + nombre.charCodeAt(i)) % COLORES.length
  return {
    txt: nombre.trim().split(' ').slice(0, 2).map(p => p[0]).join('').toUpperCase(),
    col: COLORES[h]
  }
}

async function cancelar(id) {
  accionId.value = id
  try {
    await cancelarReserva(id)
    const r = todas.value.find(x => x.id === id)
    if (r) r.estado = 'cancelada'
    emit('cancelada', id)
  } finally { accionId.value = null; confirmando.value = null }
}

async function noshow(id) {
  accionId.value = id
  try {
    await marcarNoShow(id)
    const r = todas.value.find(x => x.id === id)
    if (r) r.estado = 'no_show'
    emit('noshow', id)
  } finally { accionId.value = null; confirmandoNS.value = null }
}

onMounted(() => {
  cargar()
  socket.on('reserva:nueva',     cargar)
  socket.on('reserva:cancelada', cargar)
  socket.on('reserva:no_show',   cargar)
  socket.on('reserva:modificada', cargar)
})
onUnmounted(() => {
  socket.off('reserva:nueva',     cargar)
  socket.off('reserva:cancelada', cargar)
  socket.off('reserva:no_show',   cargar)
  socket.off('reserva:modificada', cargar)
})
</script>

<template>
  <div class="cal-wrap">

    <!-- ══════════ CALENDARIO ══════════ -->
    <div class="cal-panel">
      <div class="cal-head">
        <button class="cal-nav" @click="navMes(-1)">‹</button>
        <div class="cal-title-block">
          <div class="cal-mes">{{ MESES[mesNav.m] }}</div>
          <div class="cal-anio">{{ mesNav.y }}</div>
        </div>
        <button class="cal-nav" @click="navMes(1)">›</button>
        <div class="cal-spin" v-if="cargando"><div class="spinner"></div></div>
      </div>

      <div class="dias-row">
        <span v-for="d in DIAS" :key="d">{{ d }}</span>
      </div>

      <div class="cal-grid">
        <div
          v-for="(iso, i) in celdas"
          :key="i"
          :class="[
            'cal-dia',
            !iso         ? 'vacio'  : '',
            iso === HOY  ? 'hoy'    : '',
            iso === diaActivo ? 'activo' : '',
            iso ? `ocu-${nivel(iso)}` : ''
          ]"
          @click="iso && (diaActivo = iso)"
        >
          <template v-if="iso">
            <span class="dia-n">{{ Number(iso.slice(8)) }}</span>
            <div class="dia-dots" v-if="nConf(iso) > 0">
              <span v-for="j in Math.min(nConf(iso), 4)" :key="j" class="rdot"></span>
              <span v-if="nConf(iso) > 4" class="rdot-more">+</span>
            </div>
          </template>
        </div>
      </div>

      <div class="cal-legend">
        <div class="leg" v-for="(l, i) in ['Sin reservas','1–2','3–5','6+']" :key="i">
          <span :class="`leg-dot l${i}`"></span>{{ l }}
        </div>
      </div>
    </div>

    <!-- ══════════ DETALLE DEL DÍA ══════════ -->
    <div class="detail-panel">
      <div class="detail-head">
        <h3 class="detail-fecha">{{ labelFecha(diaActivo) }}</h3>
        <div class="detail-stats" v-if="rsvDia.length">
          <span class="dstat verde">{{ nConf(diaActivo) }} confirmadas</span>
          <span class="dstat azul">{{ nPers(diaActivo) }} personas</span>
          <span class="dstat gris">{{ rsvDia.length }} en total</span>
        </div>
      </div>

      <div class="detail-empty" v-if="!rsvDia.length">
        <div class="empty-icon">📭</div>
        <p class="empty-title">Sin reservas para este día</p>
        <p class="empty-sub">Seleccioná otro día del calendario</p>
      </div>

      <div class="rlist" v-else>
        <div
          v-for="r in rsvDia"
          :key="r.id"
          :class="['rcard', r.estado]"
        >
          <div class="rcard-av" :style="`background:${avatar(r.nombre).col}`">
            {{ avatar(r.nombre).txt }}
          </div>

          <div class="rcard-body">
            <div class="rcard-nombre">{{ r.nombre }}</div>
            <div class="rcard-chips">
              <span class="chip c-hora">{{ r.hora }}</span>
              <span class="chip c-pers">{{ r.personas }}p</span>
              <span v-if="r.mesa_nombre" class="chip c-mesa">{{ r.mesa_nombre }}</span>
            </div>
          </div>

          <div class="rcard-side">
            <span :class="['sbadge', r.estado]">
              {{ r.estado === 'no_show' ? 'NS' : r.estado === 'confirmada' ? 'OK' : 'X' }}
            </span>
            <div class="rcard-btns" v-if="r.estado === 'confirmada'">
              <template v-if="confirmandoNS === r.id">
                <button class="rb rb-ns"    @click="noshow(r.id)"  :disabled="accionId === r.id">{{ accionId === r.id ? '…' : '✓ NS' }}</button>
                <button class="rb rb-ghost" @click="confirmandoNS = null">✕</button>
              </template>
              <template v-else-if="confirmando === r.id">
                <button class="rb rb-cancel" @click="cancelar(r.id)" :disabled="accionId === r.id">{{ accionId === r.id ? '…' : '✓ OK' }}</button>
                <button class="rb rb-ghost"  @click="confirmando = null">✕</button>
              </template>
              <template v-else>
                <button class="rb rb-ns-out"    @click="confirmandoNS = r.id" title="Marcar no-show">NS</button>
                <button class="rb rb-cancel-out" @click="confirmando = r.id"  title="Cancelar">✕</button>
              </template>
            </div>
          </div>
        </div>
      </div>
    </div>

  </div>
</template>

<style scoped>
/* ── Layout ── */
.cal-wrap {
  display: grid;
  grid-template-columns: 320px 1fr;
  gap: 1.25rem;
  align-items: start;
}
@media (max-width: 820px) { .cal-wrap { grid-template-columns: 1fr; } }

/* ══ CALENDAR PANEL ══ */
.cal-panel {
  background: #fff;
  border-radius: 18px;
  overflow: hidden;
  box-shadow: 0 4px 32px rgba(0,0,0,.09), 0 1px 4px rgba(0,0,0,.05);
}

.cal-head {
  background: linear-gradient(135deg, #1e1b4b 0%, #4338ca 60%, #6366f1 100%);
  padding: 1.1rem 1rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: .5rem;
  position: relative;
}

.cal-nav {
  background: rgba(255,255,255,.18);
  border: 1px solid rgba(255,255,255,.25);
  color: #fff;
  font-size: 1.2rem;
  width: 34px; height: 34px;
  border-radius: 50%;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background .15s;
  font-family: serif;
  line-height: 1;
}
.cal-nav:hover { background: rgba(255,255,255,.32); }

.cal-title-block { text-align: center; flex: 1; }
.cal-mes  { color: #fff; font-size: 1.05rem; font-weight: 800; letter-spacing: -.01em; line-height: 1.2; }
.cal-anio { color: rgba(255,255,255,.55); font-size: .75rem; }

.cal-spin { position: absolute; right: 1rem; top: 50%; transform: translateY(-50%); }
.spinner  { width: 14px; height: 14px; border: 2px solid rgba(255,255,255,.3); border-top-color: #fff; border-radius: 50%; animation: spin .6s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.dias-row {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  padding: .45rem .35rem .35rem;
}
.dias-row span {
  text-align: center;
  font-size: .63rem;
  font-weight: 700;
  color: #94a3b8;
  letter-spacing: .05em;
  text-transform: uppercase;
}

.cal-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
  padding: .4rem .35rem;
  background: #f8fafc;
}

.cal-dia {
  aspect-ratio: 1;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  cursor: pointer;
  transition: transform .12s, box-shadow .12s, border-color .12s;
  position: relative;
  border: 1.5px solid transparent;
  min-height: 32px;
}
.cal-dia:not(.vacio):hover {
  border-color: #6366f1;
  transform: scale(1.08);
  z-index: 2;
  box-shadow: 0 4px 12px rgba(99,102,241,.2);
}
.cal-dia.vacio { cursor: default; background: transparent !important; }

.cal-dia.ocu-0 { background: #fff; }
.cal-dia.ocu-1 { background: #f0fdf4; }
.cal-dia.ocu-2 { background: #fffbeb; }
.cal-dia.ocu-3 { background: #fff1f2; }

.cal-dia.hoy { border-color: #6366f1; }
.cal-dia.hoy .dia-n {
  background: #6366f1;
  color: #fff;
  width: 20px; height: 20px;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-weight: 800;
}

.cal-dia.activo {
  background: linear-gradient(135deg, #4338ca, #6366f1) !important;
  border-color: #4338ca;
  box-shadow: 0 4px 16px rgba(99,102,241,.4);
  transform: scale(1.06);
  z-index: 3;
}
.cal-dia.activo .dia-n  { color: #fff; font-weight: 800; }
.cal-dia.activo .rdot   { background: rgba(255,255,255,.85); }
.cal-dia.activo .rdot-more { color: rgba(255,255,255,.8); }

.dia-n {
  font-size: .75rem;
  font-weight: 600;
  color: #1e293b;
  line-height: 1;
}

.dia-dots { display: flex; gap: 1.5px; flex-wrap: wrap; justify-content: center; max-width: 24px; }
.rdot { width: 3.5px; height: 3.5px; border-radius: 50%; background: #6366f1; }
.cal-dia.ocu-1 .rdot { background: #10b981; }
.cal-dia.ocu-2 .rdot { background: #f59e0b; }
.cal-dia.ocu-3 .rdot { background: #ef4444; }
.rdot-more { font-size: .5rem; color: #94a3b8; font-weight: 700; }

.cal-legend {
  padding: .55rem .75rem;
  border-top: 1px solid #f1f5f9;
  display: flex;
  gap: .75rem;
  flex-wrap: wrap;
  background: #fff;
}
.leg { display: flex; align-items: center; gap: .3rem; font-size: .65rem; color: #64748b; }
.leg-dot { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }
.leg-dot.l0 { background: #e2e8f0; }
.leg-dot.l1 { background: #6ee7b7; }
.leg-dot.l2 { background: #fcd34d; }
.leg-dot.l3 { background: #fca5a5; }

/* ══ DETAIL PANEL ══ */
.detail-panel {
  background: #fff;
  border-radius: 18px;
  box-shadow: 0 4px 32px rgba(0,0,0,.09), 0 1px 4px rgba(0,0,0,.05);
  overflow: hidden;
  min-height: 420px;
  display: flex;
  flex-direction: column;
}

.detail-head {
  background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
  border-bottom: 1px solid #e2e8f0;
  padding: 1.2rem 1.5rem 1rem;
}

.detail-fecha {
  font-size: .95rem;
  font-weight: 800;
  color: #0f172a;
  margin: 0 0 .55rem;
  text-transform: capitalize;
  letter-spacing: -.01em;
}

.detail-stats { display: flex; gap: .4rem; flex-wrap: wrap; }
.dstat {
  padding: .2rem .7rem;
  border-radius: 20px;
  font-size: .72rem;
  font-weight: 700;
}
.dstat.verde { background: #d1fae5; color: #065f46; }
.dstat.azul  { background: #dbeafe; color: #1e40af; }
.dstat.gris  { background: #f1f5f9; color: #475569; }

.detail-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 4rem 2rem;
  color: #94a3b8;
  text-align: center;
}
.empty-icon  { font-size: 2.5rem; margin-bottom: .75rem; }
.empty-title { margin: 0; font-size: .9rem; font-weight: 600; color: #64748b; }
.empty-sub   { margin: .3rem 0 0; font-size: .78rem; color: #cbd5e1; }

.rlist {
  flex: 1;
  padding: .85rem 1rem;
  display: flex;
  flex-direction: column;
  gap: .55rem;
  overflow-y: auto;
  max-height: 520px;
}

.rcard {
  display: flex;
  align-items: center;
  gap: .85rem;
  background: #f8fafc;
  border: 1.5px solid #e2e8f0;
  border-left-width: 4px;
  border-radius: 12px;
  padding: .8rem 1rem .8rem .85rem;
  transition: box-shadow .15s, transform .15s;
}
.rcard:hover { box-shadow: 0 6px 20px rgba(0,0,0,.07); transform: translateX(3px); }
.rcard.confirmada { border-left-color: #10b981; }
.rcard.cancelada  { border-left-color: #ef4444; opacity: .65; }
.rcard.no_show    { border-left-color: #f59e0b; opacity: .7; }

.rcard-av {
  width: 38px; height: 38px;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: .72rem; font-weight: 800; color: #fff;
  flex-shrink: 0;
  box-shadow: 0 2px 8px rgba(0,0,0,.18);
}

.rcard-body { flex: 1; min-width: 0; }
.rcard-nombre { font-size: .88rem; font-weight: 700; color: #1e293b; margin-bottom: .25rem; }
.rcard-chips  { display: flex; gap: .3rem; flex-wrap: wrap; }

.chip {
  padding: .18rem .55rem;
  border-radius: 20px;
  font-size: .7rem;
  font-weight: 600;
}
.c-hora { background: #ede9fe; color: #5b21b6; }
.c-pers { background: #dbeafe; color: #1e40af; }
.c-mesa { background: #f0fdf4; color: #065f46; }

.rcard-side {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: .4rem;
  flex-shrink: 0;
}

.sbadge {
  padding: .18rem .6rem;
  border-radius: 20px;
  font-size: .65rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: .05em;
}
.sbadge.confirmada { background: #d1fae5; color: #065f46; }
.sbadge.cancelada  { background: #fee2e2; color: #991b1b; }
.sbadge.no_show    { background: #fef3c7; color: #92400e; }

.rcard-btns { display: flex; gap: .25rem; }
.rb {
  border: none;
  border-radius: 5px;
  cursor: pointer;
  font-size: .68rem;
  font-family: inherit;
  font-weight: 700;
  padding: .22rem .55rem;
  transition: all .12s;
}
.rb:disabled { opacity: .55; }
.rb-ns:not(:disabled)         { background: #d97706; color: #fff; }
.rb-ns:hover:not(:disabled)   { background: #b45309; }
.rb-cancel:not(:disabled)     { background: #dc2626; color: #fff; }
.rb-cancel:hover:not(:disabled) { background: #b91c1c; }
.rb-ghost                     { background: #f1f5f9; color: #64748b; border: 1px solid #e2e8f0; }
.rb-ghost:hover               { background: #e2e8f0; }
.rb-ns-out     { background: transparent; border: 1px solid #d97706; color: #92400e; }
.rb-ns-out:hover { background: #fffbeb; }
.rb-cancel-out { background: transparent; border: 1px solid #dc2626; color: #dc2626; }
.rb-cancel-out:hover { background: #fef2f2; }
</style>
