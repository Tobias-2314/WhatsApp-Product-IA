<script setup>
import { ref } from 'vue'
import { cancelarReserva, marcarNoShow } from '../api.js'

const props  = defineProps({ reservas: { type: Array, required: true } })
const emit   = defineEmits(['cancelada', 'noshow'])

const confirmando    = ref(null) // id en espera de confirmar cancelación
const confirmandoNS  = ref(null) // id en espera de confirmar no-show
const cargando       = ref(null)
const error          = ref('')

async function confirmarCancelar(id) {
  cargando.value = id
  error.value    = ''
  try {
    await cancelarReserva(id)
    emit('cancelada', id)
  } catch (e) {
    error.value = e.message
  } finally {
    cargando.value   = null
    confirmando.value = null
  }
}

async function confirmarNoShow(id) {
  cargando.value = id
  error.value    = ''
  try {
    await marcarNoShow(id)
    emit('noshow', id)
  } catch (e) {
    error.value = e.message
  } finally {
    cargando.value    = null
    confirmandoNS.value = null
  }
}

function maskTel(tel) {
  const s = String(tel)
  return s.length > 4 ? `****${s.slice(-4)}` : s
}
</script>

<template>
  <div>
    <p v-if="error" class="error-msg">{{ error }}</p>

    <div v-if="!reservas.length" class="empty">Sin reservas para mostrar</div>

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
          <tr v-for="r in reservas" :key="r.id" :class="{ cancelada: r.estado === 'cancelada', noshow: r.estado === 'no_show' }">
            <td class="mono">{{ r.id }}</td>
            <td>{{ r.nombre }}</td>
            <td class="mono muted">{{ maskTel(r.telefono) }}</td>
            <td>{{ r.fecha }}</td>
            <td class="bold">{{ r.hora }}</td>
            <td class="green bold">{{ r.personas }}</td>
            <td class="muted">{{ r.mesa_nombre || '—' }}</td>
            <td>
              <span :class="['badge', r.estado]">{{ r.estado === 'no_show' ? 'no-show' : r.estado }}</span>
            </td>
            <td>
              <template v-if="r.estado === 'confirmada'">
                <!-- No-show inline confirm -->
                <template v-if="confirmandoNS === r.id">
                  <button class="btn-noshow" @click="confirmarNoShow(r.id)" :disabled="cargando === r.id">
                    {{ cargando === r.id ? '…' : 'No-show' }}
                  </button>
                  <button class="btn-ghost" @click="confirmandoNS = null">No</button>
                </template>
                <!-- Cancelar inline confirm -->
                <template v-else-if="confirmando === r.id">
                  <button class="btn-cancel" @click="confirmarCancelar(r.id)" :disabled="cargando === r.id">
                    {{ cargando === r.id ? '…' : 'Confirmar' }}
                  </button>
                  <button class="btn-ghost" @click="confirmando = null">No</button>
                </template>
                <!-- Default buttons -->
                <template v-else>
                  <button class="btn-noshow-outline" @click="confirmandoNS = r.id" title="Marcar como no-show">No-show</button>
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
.table-wrap { overflow-x: auto; border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,.09); }
table { width: 100%; border-collapse: collapse; background: #fff; }
th {
  background: #111827;
  color: #fff;
  text-align: left;
  padding: .6rem .9rem;
  font-size: .72rem;
  font-weight: 600;
  letter-spacing: .05em;
  text-transform: uppercase;
  white-space: nowrap;
}
td {
  padding: .6rem .9rem;
  border-bottom: 1px solid #f3f4f6;
  font-size: .875rem;
  vertical-align: middle;
  white-space: nowrap;
}
tr:last-child td { border-bottom: none; }
tr:hover td { background: #f9fafb; }
tr.cancelada td { opacity: .5; }
tr.noshow td { opacity: .6; }

.mono  { font-family: monospace; font-size: .78rem; }
.muted { color: #9ca3af; }
.bold  { font-weight: 600; }
.green { color: #059669; }

.badge {
  display: inline-block;
  padding: .15rem .55rem;
  border-radius: 20px;
  font-size: .7rem;
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

.empty {
  color: #9ca3af;
  font-style: italic;
  padding: 2rem;
  text-align: center;
  background: #fff;
  border-radius: 10px;
  box-shadow: 0 1px 3px rgba(0,0,0,.09);
}
.error-msg {
  color: #dc2626;
  font-size: .875rem;
  margin-bottom: .75rem;
}
</style>
