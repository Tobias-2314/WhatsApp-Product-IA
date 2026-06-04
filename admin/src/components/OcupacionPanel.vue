<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { getOcupacion, socket } from '../api.js'

const hoy = (() => {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }))
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`
})()

const fechaInput = ref(hoyISO())
const ocupacion  = ref(null)
const cargando   = ref(false)
const error      = ref('')

function hoyISO() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }))
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function isoADDMMYYYY(iso) {
  if (!iso) return hoy
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

async function cargar() {
  cargando.value = true
  error.value    = ''
  try {
    ocupacion.value = await getOcupacion(isoADDMMYYYY(fechaInput.value))
  } catch (e) {
    error.value = e.message
  } finally {
    cargando.value = false
  }
}

function celda(franja, mesaId) {
  return ocupacion.value?.celdas?.[`${franja}-${mesaId}`] || { estado: 'libre' }
}

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

    <div v-if="ocupacion" class="grid-wrap">
      <div
        class="grilla"
        :style="`grid-template-columns: 70px repeat(${ocupacion.mesas.length}, 1fr)`"
      >
        <!-- Header: nombre de mesas -->
        <div class="cell header-corner"></div>
        <div v-for="mesa in ocupacion.mesas" :key="mesa.id" class="cell header-mesa">
          <span class="mesa-nombre">{{ mesa.nombre }}</span>
          <span class="mesa-cap">{{ mesa.capacidad }}p</span>
        </div>

        <!-- Filas por franja -->
        <template v-for="franja in ocupacion.franjas" :key="franja">
          <div class="cell header-franja">{{ franja }}</div>
          <div
            v-for="mesa in ocupacion.mesas"
            :key="`${franja}-${mesa.id}`"
            :class="['cell', 'celda', celda(franja, mesa.id).estado]"
          >
            <template v-if="celda(franja, mesa.id).estado === 'ocupada'">
              <span class="c-nombre">{{ celda(franja, mesa.id).nombre }}</span>
              <span class="c-personas">{{ celda(franja, mesa.id).personas }}p</span>
            </template>
            <template v-else-if="celda(franja, mesa.id).estado === 'limpieza'">
              <span class="c-label">limpieza</span>
            </template>
          </div>
        </template>
      </div>

      <div class="leyenda">
        <span class="dot libre"></span> Libre
        <span class="dot ocupada"></span> Ocupada
        <span class="dot limpieza"></span> Limpieza
      </div>
    </div>
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

.grid-wrap { overflow-x: auto; }

.grilla {
  display: grid;
  gap: 3px;
  background: #e5e7eb;
  border-radius: 10px;
  overflow: hidden;
  padding: 3px;
  min-width: max-content;
}

.cell {
  background: #fff;
  border-radius: 6px;
  padding: .4rem .5rem;
  min-width: 90px;
  min-height: 52px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
}

.header-corner { background: #111827; border-radius: 6px; }
.header-mesa   { background: #1f2937; color: #fff; font-size: .75rem; text-align: center; }
.header-franja { background: #374151; color: #fff; font-size: .8rem; font-weight: 700; min-width: 70px; max-width: 70px; }

.mesa-nombre { font-weight: 600; font-size: .75rem; }
.mesa-cap    { font-size: .65rem; opacity: .7; }

.celda.libre    { background: #d1fae5; }
.celda.ocupada  { background: #dbeafe; }
.celda.limpieza { background: #fef3c7; }

.c-nombre   { font-size: .75rem; font-weight: 600; color: #1e40af; text-align: center; }
.c-personas { font-size: .65rem; color: #1d4ed8; }
.c-label    { font-size: .65rem; color: #92400e; }

.leyenda {
  display: flex;
  gap: 1.25rem;
  align-items: center;
  font-size: .78rem;
  color: #6b7280;
  padding: .5rem 0;
}
.dot {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 3px;
  margin-right: .3rem;
}
.dot.libre    { background: #d1fae5; border: 1px solid #6ee7b7; }
.dot.ocupada  { background: #dbeafe; border: 1px solid #93c5fd; }
.dot.limpieza { background: #fef3c7; border: 1px solid #fcd34d; }
</style>
