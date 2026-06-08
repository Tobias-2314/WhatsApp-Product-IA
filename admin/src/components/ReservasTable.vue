<script setup>
import { ref } from 'vue'
import { cancelarReserva, marcarNoShow } from '../api.js'

const props  = defineProps({ reservas: { type: Array, required: true } })
const emit   = defineEmits(['cancelada', 'noshow'])

const vistaTabla    = ref(false)
const confirmando   = ref(null)
const confirmandoNS = ref(null)
const cargando      = ref(null)
const error         = ref('')

async function confirmarCancelar(id) {
  cargando.value = id; error.value = ''
  try { await cancelarReserva(id); emit('cancelada', id) }
  catch (e) { error.value = e.message }
  finally { cargando.value = null; confirmando.value = null }
}

async function confirmarNoShow(id) {
  cargando.value = id; error.value = ''
  try { await marcarNoShow(id); emit('noshow', id) }
  catch (e) { error.value = e.message }
  finally { cargando.value = null; confirmandoNS.value = null }
}

function maskTel(tel) {
  const s = String(tel)
  return s.length > 4 ? `****${s.slice(-4)}` : s
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
</script>

<template>
  <div>
    <p v-if="error" class="error-msg">{{ error }}</p>

    <!-- Toggle vista -->
    <div class="view-toggle">
      <button :class="['toggle-btn', !vistaTabla ? 'active' : '']" @click="vistaTabla = false">
        <svg width="13" height="13" viewBox="0 0 13 13" fill="currentColor">
          <rect x="0" y="0" width="5.5" height="5.5" rx="1.2"/>
          <rect x="7.5" y="0" width="5.5" height="5.5" rx="1.2"/>
          <rect x="0" y="7.5" width="5.5" height="5.5" rx="1.2"/>
          <rect x="7.5" y="7.5" width="5.5" height="5.5" rx="1.2"/>
        </svg>
        Tarjetas
      </button>
      <button :class="['toggle-btn', vistaTabla ? 'active' : '']" @click="vistaTabla = true">
        <svg width="13" height="13" viewBox="0 0 13 13" fill="currentColor">
          <rect x="0" y="0" width="13" height="2" rx="1"/>
          <rect x="0" y="3.7" width="13" height="2" rx="1"/>
          <rect x="0" y="7.4" width="13" height="2" rx="1"/>
          <rect x="0" y="11" width="13" height="2" rx="1"/>
        </svg>
        Lista
      </button>
    </div>

    <!-- Estado vacío -->
    <div v-if="!reservas.length" class="empty">
      <div class="empty-icon">🔍</div>
      <p class="empty-title">Sin reservas para mostrar</p>
      <p class="empty-sub">Intentá cambiar los filtros</p>
    </div>

    <!-- ══ VISTA TARJETAS ══ -->
    <div v-else-if="!vistaTabla" class="cards-grid">
      <div
        v-for="r in reservas"
        :key="r.id"
        :class="['rcard', r.estado]"
      >
        <div class="card-top">
          <div class="card-av" :style="`background:${avatar(r.nombre).col}`">
            {{ avatar(r.nombre).txt }}
          </div>
          <div class="card-info">
            <div class="card-nombre">{{ r.nombre }}</div>
            <div class="card-id">{{ r.id }}</div>
          </div>
          <span :class="['card-badge', r.estado]">
            {{ r.estado === 'no_show' ? 'no-show' : r.estado }}
          </span>
        </div>

        <div class="card-chips">
          <span class="chip ch-fecha">📅 {{ r.fecha }}</span>
          <span class="chip ch-hora">🕐 {{ r.hora }}</span>
          <span class="chip ch-pers">👥 {{ r.personas }}p</span>
          <span v-if="r.mesa_nombre" class="chip ch-mesa">🪑 {{ r.mesa_nombre }}</span>
        </div>

        <div class="card-footer">
          <span class="card-tel">{{ maskTel(r.telefono) }}</span>
          <div class="card-acciones" v-if="r.estado === 'confirmada'">
            <template v-if="confirmandoNS === r.id">
              <button class="ab ab-ns"    @click="confirmarNoShow(r.id)"  :disabled="cargando === r.id">{{ cargando === r.id ? '…' : '✓ No-show' }}</button>
              <button class="ab ab-ghost" @click="confirmandoNS = null">No</button>
            </template>
            <template v-else-if="confirmando === r.id">
              <button class="ab ab-cancel" @click="confirmarCancelar(r.id)" :disabled="cargando === r.id">{{ cargando === r.id ? '…' : '✓ Cancelar' }}</button>
              <button class="ab ab-ghost"  @click="confirmando = null">No</button>
            </template>
            <template v-else>
              <button class="ab ab-ns-out"     @click="confirmandoNS = r.id">No-show</button>
              <button class="ab ab-cancel-out" @click="confirmando = r.id">Cancelar</button>
            </template>
          </div>
        </div>
      </div>
    </div>

    <!-- ══ VISTA TABLA ══ -->
    <div v-else class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Nombre</th>
            <th>Teléfono</th>
            <th>Fecha</th>
            <th>Hora</th>
            <th>Personas</th>
            <th>Mesa</th>
            <th>Estado</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="r in reservas"
            :key="r.id"
            :class="{ cancelada: r.estado === 'cancelada', noshow: r.estado === 'no_show' }"
          >
            <td class="mono">{{ r.id }}</td>
            <td>
              <div class="tbl-nombre">
                <span class="tbl-av" :style="`background:${avatar(r.nombre).col}`">{{ avatar(r.nombre).txt }}</span>
                {{ r.nombre }}
              </div>
            </td>
            <td class="mono muted">{{ maskTel(r.telefono) }}</td>
            <td>{{ r.fecha }}</td>
            <td class="bold">{{ r.hora }}</td>
            <td class="bold teal">{{ r.personas }}</td>
            <td class="muted">{{ r.mesa_nombre || '—' }}</td>
            <td><span :class="['badge', r.estado]">{{ r.estado === 'no_show' ? 'no-show' : r.estado }}</span></td>
            <td>
              <template v-if="r.estado === 'confirmada'">
                <template v-if="confirmandoNS === r.id">
                  <button class="btn-noshow" @click="confirmarNoShow(r.id)" :disabled="cargando === r.id">{{ cargando === r.id ? '…' : 'No-show' }}</button>
                  <button class="btn-ghost"  @click="confirmandoNS = null">No</button>
                </template>
                <template v-else-if="confirmando === r.id">
                  <button class="btn-cancel" @click="confirmarCancelar(r.id)" :disabled="cargando === r.id">{{ cargando === r.id ? '…' : 'Confirmar' }}</button>
                  <button class="btn-ghost"  @click="confirmando = null">No</button>
                </template>
                <template v-else>
                  <button class="btn-noshow-outline" @click="confirmandoNS = r.id">No-show</button>
                  <button class="btn-cancel-outline" @click="confirmando = r.id">Cancelar</button>
                </template>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
/* ── Toggle ── */
.view-toggle {
  display: flex;
  gap: .25rem;
  margin-bottom: .85rem;
}
.toggle-btn {
  display: flex;
  align-items: center;
  gap: .35rem;
  padding: .35rem .8rem;
  border-radius: 8px;
  border: 1.5px solid #e2e8f0;
  background: #fff;
  color: #64748b;
  font-size: .78rem;
  font-family: inherit;
  font-weight: 500;
  cursor: pointer;
  transition: all .15s;
}
.toggle-btn:hover       { border-color: #c7d2fe; color: #4338ca; background: #f5f3ff; }
.toggle-btn.active      { background: #4f46e5; border-color: #4f46e5; color: #fff; font-weight: 700; }

/* ── Empty ── */
.empty {
  text-align: center;
  padding: 3.5rem 2rem;
  background: #fff;
  border-radius: 16px;
  border: 1.5px dashed #e2e8f0;
}
.empty-icon  { font-size: 2rem; margin-bottom: .5rem; }
.empty-title { margin: 0; font-size: .9rem; font-weight: 600; color: #64748b; }
.empty-sub   { margin: .25rem 0 0; font-size: .78rem; color: #cbd5e1; }

/* ══ CARD GRID ══ */
.cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
  gap: .75rem;
}

.rcard {
  background: #fff;
  border: 1.5px solid #e2e8f0;
  border-left: 4px solid #e2e8f0;
  border-radius: 14px;
  padding: 1rem 1.05rem;
  display: flex;
  flex-direction: column;
  gap: .7rem;
  transition: box-shadow .18s, transform .18s;
}
.rcard:hover { box-shadow: 0 10px 28px rgba(0,0,0,.09); transform: translateY(-2px); }
.rcard.confirmada { border-left-color: #10b981; }
.rcard.cancelada  { border-left-color: #ef4444; opacity: .68; }
.rcard.no_show    { border-left-color: #f59e0b; opacity: .72; }

.card-top   { display: flex; align-items: center; gap: .7rem; }
.card-av {
  width: 42px; height: 42px;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: .78rem; font-weight: 800; color: #fff;
  flex-shrink: 0;
  box-shadow: 0 3px 10px rgba(0,0,0,.18);
}
.card-info  { flex: 1; min-width: 0; }
.card-nombre { font-size: .9rem; font-weight: 700; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.card-id     { font-size: .65rem; color: #94a3b8; font-family: monospace; margin-top: 1px; }

.card-badge {
  padding: .2rem .65rem;
  border-radius: 20px;
  font-size: .68rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .04em;
  white-space: nowrap;
}
.card-badge.confirmada { background: #d1fae5; color: #065f46; }
.card-badge.cancelada  { background: #fee2e2; color: #991b1b; }
.card-badge.no_show    { background: #fef3c7; color: #92400e; }

.card-chips { display: flex; gap: .35rem; flex-wrap: wrap; }
.chip {
  padding: .2rem .6rem;
  border-radius: 20px;
  font-size: .71rem;
  font-weight: 500;
}
.ch-fecha { background: #f1f5f9; color: #475569; }
.ch-hora  { background: #ede9fe; color: #5b21b6; }
.ch-pers  { background: #dbeafe; color: #1e40af; }
.ch-mesa  { background: #f0fdf4; color: #065f46; }

.card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-top: 1px solid #f1f5f9;
  padding-top: .55rem;
}
.card-tel       { font-size: .7rem; color: #94a3b8; font-family: monospace; }
.card-acciones  { display: flex; gap: .3rem; }

.ab {
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: .72rem;
  font-family: inherit;
  font-weight: 600;
  padding: .25rem .6rem;
  transition: all .12s;
}
.ab:disabled { opacity: .55; }
.ab-ns:not(:disabled)           { background: #d97706; color: #fff; }
.ab-ns:hover:not(:disabled)     { background: #b45309; }
.ab-cancel:not(:disabled)       { background: #dc2626; color: #fff; }
.ab-cancel:hover:not(:disabled) { background: #b91c1c; }
.ab-ghost     { background: #f8fafc; color: #64748b; border: 1px solid #e2e8f0; }
.ab-ghost:hover { background: #e2e8f0; }
.ab-ns-out    { background: transparent; border: 1px solid #d97706; color: #92400e; }
.ab-ns-out:hover { background: #fffbeb; }
.ab-cancel-out { background: transparent; border: 1px solid #dc2626; color: #dc2626; }
.ab-cancel-out:hover { background: #fef2f2; }

/* ══ TABLE VIEW ══ */
.table-wrap { overflow-x: auto; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,.07); }
table { width: 100%; border-collapse: collapse; background: #fff; }
th {
  background: #0f172a;
  color: #fff;
  text-align: left;
  padding: .65rem .9rem;
  font-size: .68rem;
  font-weight: 700;
  letter-spacing: .07em;
  text-transform: uppercase;
  white-space: nowrap;
}
th:first-child { border-radius: 0; }
td {
  padding: .65rem .9rem;
  border-bottom: 1px solid #f1f5f9;
  font-size: .875rem;
  vertical-align: middle;
  white-space: nowrap;
}
tr:last-child td   { border-bottom: none; }
tr:hover td        { background: #f8fafc; }
tr.cancelada td    { opacity: .55; }
tr.noshow td       { opacity: .65; }

.tbl-nombre { display: flex; align-items: center; gap: .5rem; }
.tbl-av {
  width: 26px; height: 26px;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: .58rem; font-weight: 800; color: #fff;
  flex-shrink: 0;
}

.mono  { font-family: monospace; font-size: .78rem; }
.muted { color: #9ca3af; }
.bold  { font-weight: 600; }
.teal  { color: #0891b2; }

.badge {
  display: inline-block;
  padding: .15rem .55rem;
  border-radius: 20px;
  font-size: .68rem;
  font-weight: 700;
}
.badge.confirmada { background: #d1fae5; color: #065f46; }
.badge.cancelada  { background: #fee2e2; color: #991b1b; }
.badge.no_show    { background: #fef3c7; color: #92400e; }

.btn-cancel         { background: #dc2626; color: #fff; margin-right: .25rem; }
.btn-cancel:hover   { background: #b91c1c; }
.btn-cancel-outline { background: transparent; border: 1px solid #dc2626; color: #dc2626; margin-left: .25rem; }
.btn-cancel-outline:hover { background: #fef2f2; }
.btn-noshow         { background: #d97706; color: #fff; margin-right: .25rem; }
.btn-noshow:hover   { background: #b45309; }
.btn-noshow-outline { background: transparent; border: 1px solid #d97706; color: #92400e; }
.btn-noshow-outline:hover { background: #fffbeb; }
.btn-ghost          { background: transparent; border: 1px solid #d1d5db; color: #374151; margin-left: .25rem; }
.btn-ghost:hover    { background: #f9fafb; }

.error-msg {
  color: #dc2626; font-size: .875rem; margin-bottom: .75rem;
  background: #fef2f2; border: 1px solid #fecaca;
  border-radius: 8px; padding: .6rem 1rem;
}
</style>
