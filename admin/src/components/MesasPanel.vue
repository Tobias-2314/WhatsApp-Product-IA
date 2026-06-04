<script setup>
import { ref, computed, onMounted } from 'vue'
import { getMesas, crearMesa, actualizarMesa, getCombinaciones, agregarCombinacion, eliminarCombinacion } from '../api.js'

const mesas    = ref([])
const cargando = ref(false)
const error    = ref('')

// Formulario nueva mesa
const nueva          = ref({ nombre: '', capacidad: '' })
const guardandoNueva = ref(false)
const errorNueva     = ref('')

// Edición inline
const editando      = ref(null)
const guardandoEdit = ref(false)

// Combinaciones
const combList      = ref([])   // [{ mesa_id_1, mesa_id_2 }]
const guardandoComb = ref(false)

const combSet = computed(() =>
  new Set(combList.value.map(c => `${c.mesa_id_1}-${c.mesa_id_2}`))
)

function isCombinado(id1, id2) {
  const a = Math.min(id1, id2), b = Math.max(id1, id2)
  return combSet.value.has(`${a}-${b}`)
}

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

onMounted(cargar)
</script>

<template>
  <div class="mesas-panel">
    <div class="panel-header">
      <h2 class="panel-title">Gestión de Mesas</h2>
      <button class="btn-reload" @click="cargar" :disabled="cargando" title="Recargar">⟳</button>
    </div>

    <p v-if="error" class="error">{{ error }}</p>

    <!-- Tabla de mesas -->
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
              <td>{{ m.nombre }}</td>
              <td>{{ m.capacidad }} personas</td>
              <td>
                <span class="badge" :class="m.activa ? 'badge-activa' : 'badge-inactiva'">
                  {{ m.activa ? 'Activa' : 'Inactiva' }}
                </span>
              </td>
              <td class="acciones">
                <button class="btn-edit" @click="iniciarEdicion(m)" title="Editar">✏️</button>
                <button
                  class="btn-toggle"
                  :class="m.activa ? 'btn-desactivar' : 'btn-activar'"
                  @click="toggleActiva(m)"
                >{{ m.activa ? 'Desactivar' : 'Activar' }}</button>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <!-- Formulario nueva mesa -->
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

    <!-- Matriz de combinaciones -->
    <div class="comb-section" v-if="mesas.length >= 2">
      <div class="comb-header">
        <h3 class="form-title">Combinaciones permitidas</h3>
        <span class="comb-hint">Marcá los pares de mesas que se pueden unir para grupos grandes</span>
      </div>

      <div class="matrix-wrap">
        <table class="matrix">
          <thead>
            <tr>
              <th class="corner"></th>
              <th v-for="m in mesas" :key="m.id" class="col-header" :title="m.nombre + ' (' + m.capacidad + 'p)'">
                <span class="mesa-short">{{ m.nombre }}</span>
                <span class="mesa-cap-hint">{{ m.capacidad }}p</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m1 in mesas" :key="m1.id">
              <th class="row-header" :title="m1.nombre + ' (' + m1.capacidad + 'p)'">
                <span class="mesa-short">{{ m1.nombre }}</span>
                <span class="mesa-cap-hint">{{ m1.capacidad }}p</span>
              </th>
              <td
                v-for="m2 in mesas"
                :key="m2.id"
                :class="['matrix-cell', {
                  'cell-diag':     m1.id === m2.id,
                  'cell-activa':   m1.id !== m2.id && isCombinado(m1.id, m2.id),
                  'cell-inactiva': m1.id !== m2.id && !isCombinado(m1.id, m2.id),
                  'cell-disabled': guardandoComb
                }]"
                @click="toggleCombinacion(m1.id, m2.id)"
              >
                <template v-if="m1.id === m2.id">
                  <span class="diag-dash">—</span>
                </template>
                <template v-else>
                  <span class="cell-check">{{ isCombinado(m1.id, m2.id) ? '✓' : '' }}</span>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p class="nota-comb">
        ✓ habilitada · vacío = no permitida ·
        <strong>{{ combList.length }}</strong> combinación(es) configurada(s)
      </p>
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

.table-wrap { overflow-x: auto; border-radius: 8px; border: 1px solid #e5e7eb; }

.tabla { width: 100%; border-collapse: collapse; font-size: .875rem; }
.tabla th { background: #f9fafb; color: #374151; font-weight: 600; padding: .6rem 1rem; text-align: left; border-bottom: 1px solid #e5e7eb; white-space: nowrap; }
.tabla td { padding: .55rem 1rem; border-bottom: 1px solid #f3f4f6; color: #111827; }
.tabla tr:last-child td { border-bottom: none; }
.tabla tr:hover:not(.edit-row) td { background: #fafafa; }

.id-col    { color: #9ca3af; font-size: .8rem; font-family: monospace; }
.row-inactiva td { opacity: .5; }
.empty     { text-align: center; color: #9ca3af; padding: 2rem; }

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

.edit-row { background: #fffbeb; }
.edit-input { border: 1px solid #d1d5db; border-radius: 5px; padding: .3rem .5rem; font-size: .875rem; font-family: inherit; width: 100%; outline: none; }
.edit-input:focus { border-color: #6366f1; }
.narrow { width: 80px !important; }
.btn-ok     { background: #059669; color: #fff; border: none; border-radius: 5px; padding: .25rem .55rem; cursor: pointer; font-size: .8rem; }
.btn-ok:hover:not(:disabled) { background: #047857; }
.btn-cancel { background: #6b7280; color: #fff; border: none; border-radius: 5px; padding: .25rem .55rem; cursor: pointer; font-size: .8rem; }
.btn-cancel:hover { background: #4b5563; }

.nueva-form  { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 1rem 1.25rem; }
.form-title  { font-size: .875rem; font-weight: 600; color: #374151; margin-bottom: .65rem; }
.form-row    { display: flex; gap: .6rem; flex-wrap: wrap; align-items: center; }
.form-input  { border: 1px solid #d1d5db; border-radius: 6px; padding: .4rem .7rem; font-size: .875rem; font-family: inherit; outline: none; flex: 1; min-width: 140px; }
.form-input:focus { border-color: #6366f1; }
.form-input.narrow { flex: none; width: 80px; min-width: unset; }
.btn-agregar { background: #6366f1; color: #fff; border: none; border-radius: 6px; padding: .4rem .9rem; font-size: .875rem; cursor: pointer; font-family: inherit; font-weight: 600; white-space: nowrap; }
.btn-agregar:hover:not(:disabled) { background: #4f46e5; }
.btn-agregar:disabled { opacity: .6; cursor: not-allowed; }
.error-small { color: #dc2626; font-size: .78rem; margin-top: .35rem; }

/* ── Combinaciones ── */
.comb-section { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 1rem 1.25rem; }
.comb-header  { display: flex; flex-direction: column; gap: .2rem; margin-bottom: .85rem; }
.comb-hint    { font-size: .78rem; color: #9ca3af; }

.matrix-wrap { overflow-x: auto; }

.matrix { border-collapse: collapse; }

.corner       { background: transparent; border: none; }
.col-header, .row-header {
  font-size: .72rem;
  font-weight: 600;
  color: #374151;
  padding: .35rem .5rem;
  text-align: center;
  white-space: nowrap;
  background: #f3f4f6;
}
.row-header { text-align: right; padding-right: .75rem; }

.mesa-short    { display: block; }
.mesa-cap-hint { display: block; font-weight: 400; color: #9ca3af; font-size: .65rem; }

.matrix-cell {
  width: 44px;
  height: 44px;
  text-align: center;
  vertical-align: middle;
  border: 1px solid #e5e7eb;
  cursor: pointer;
  transition: background .1s;
  user-select: none;
}

.cell-diag     { background: #f3f4f6; cursor: default; }
.diag-dash     { color: #d1d5db; font-size: .9rem; }
.cell-activa   { background: #d1fae5; }
.cell-activa:hover { background: #a7f3d0; }
.cell-inactiva { background: #fff; }
.cell-inactiva:hover { background: #f0fdf4; }
.cell-disabled { cursor: wait; opacity: .7; }

.cell-check { font-size: 1rem; color: #059669; font-weight: 700; line-height: 1; }

.nota-comb { font-size: .75rem; color: #6b7280; margin-top: .75rem; }
.error  { color: #dc2626; font-size: .875rem; }
.nota   { font-size: .75rem; color: #9ca3af; }
</style>
