<script setup>
import { ref, onMounted } from 'vue'
import { getFechasBloqueadas, bloquearFecha, desbloquearFecha } from '../api.js'

const fechas    = ref([])
const cargando  = ref(false)
const error     = ref('')
const nuevaFecha  = ref('')
const nuevoMotivo = ref('')
const guardando   = ref(false)

async function cargar() {
  cargando.value = true
  error.value = ''
  try {
    fechas.value = await getFechasBloqueadas()
  } catch (e) {
    error.value = e.message
  } finally {
    cargando.value = false
  }
}

async function bloquear() {
  if (!nuevaFecha.value) return
  const [y, m, d] = nuevaFecha.value.split('-')
  const fechaFmt = `${d}/${m}/${y}`
  guardando.value = true
  error.value = ''
  try {
    await bloquearFecha(fechaFmt, nuevoMotivo.value || null)
    nuevaFecha.value  = ''
    nuevoMotivo.value = ''
    await cargar()
  } catch (e) {
    error.value = e.message
  } finally {
    guardando.value = false
  }
}

async function desbloquear(id) {
  error.value = ''
  try {
    await desbloquearFecha(id)
    fechas.value = fechas.value.filter(f => f.id !== id)
  } catch (e) {
    error.value = e.message
  }
}

onMounted(cargar)
</script>

<template>
  <div class="panel">
    <div class="panel-header">
      <h2 class="panel-title">🔒 Fechas Bloqueadas</h2>
      <p class="panel-sub">El bot rechazará reservas en estas fechas (feriados, eventos privados, vacaciones).</p>
    </div>

    <div class="card form-card">
      <h3 class="card-title">Bloquear nueva fecha</h3>
      <div class="form-row">
        <div class="field">
          <label class="field-label">Fecha</label>
          <input type="date" v-model="nuevaFecha" class="input" />
        </div>
        <div class="field field-wide">
          <label class="field-label">Motivo <span class="optional">(opcional)</span></label>
          <input type="text" v-model="nuevoMotivo" placeholder="Ej: Feriado nacional" class="input" />
        </div>
        <div class="field field-action">
          <label class="field-label">&nbsp;</label>
          <button class="btn-bloquear" :disabled="!nuevaFecha || guardando" @click="bloquear">
            {{ guardando ? '…' : '🔒 Bloquear' }}
          </button>
        </div>
      </div>
    </div>

    <p v-if="error" class="error-msg">{{ error }}</p>

    <div class="card list-card">
      <div class="list-header">
        <h3 class="card-title">Fechas bloqueadas ({{ fechas.length }})</h3>
        <button class="btn-refresh" @click="cargar" :disabled="cargando" title="Actualizar">↺</button>
      </div>

      <div v-if="cargando" class="empty-state">Cargando…</div>

      <div v-else-if="fechas.length === 0" class="empty-state">
        No hay fechas bloqueadas.
      </div>

      <ul v-else class="fecha-list">
        <li v-for="f in fechas" :key="f.id" class="fecha-item">
          <div class="fecha-info">
            <span class="fecha-date">📅 {{ f.fecha }}</span>
            <span class="fecha-motivo" v-if="f.motivo">{{ f.motivo }}</span>
          </div>
          <button class="btn-desbloquear" @click="desbloquear(f.id)" title="Desbloquear">
            🔓 Desbloquear
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.panel { display: flex; flex-direction: column; gap: 1.25rem; }

.panel-header {}
.panel-title { font-size: 1.25rem; font-weight: 800; color: #0f172a; margin: 0 0 .25rem; }
.panel-sub   { font-size: .8rem; color: #64748b; margin: 0; }

.card {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 1.25rem;
  box-shadow: 0 1px 3px rgba(0,0,0,.04);
}
.card-title { font-size: .9rem; font-weight: 700; color: #1e293b; margin: 0 0 1rem; }

.form-row {
  display: flex;
  gap: .85rem;
  align-items: flex-end;
  flex-wrap: wrap;
}
.field { display: flex; flex-direction: column; gap: .3rem; }
.field-wide  { flex: 1; min-width: 180px; }
.field-action {}
.field-label { font-size: .7rem; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: .05em; }
.optional    { text-transform: none; font-weight: 400; color: #94a3b8; }

.input {
  border: 1.5px solid #e2e8f0;
  border-radius: 7px;
  padding: .45rem .7rem;
  font-size: .875rem;
  font-family: inherit;
  outline: none;
  background: #f8fafc;
  transition: border-color .15s;
}
.input:focus { border-color: #6366f1; background: #fff; }

.btn-bloquear {
  background: #dc2626;
  color: #fff;
  border: none;
  border-radius: 7px;
  padding: .5rem 1.1rem;
  font-size: .8rem;
  font-family: inherit;
  font-weight: 700;
  cursor: pointer;
  transition: background .15s;
  white-space: nowrap;
}
.btn-bloquear:hover:not(:disabled) { background: #b91c1c; }
.btn-bloquear:disabled { opacity: .5; cursor: default; }

.list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: .75rem;
}
.list-header .card-title { margin: 0; }

.btn-refresh {
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: .3rem .6rem;
  cursor: pointer;
  font-size: 1rem;
  transition: background .15s;
}
.btn-refresh:hover:not(:disabled) { background: #e2e8f0; }
.btn-refresh:disabled { opacity: .5; }

.empty-state { color: #94a3b8; font-size: .85rem; text-align: center; padding: 1.5rem 0; }

.fecha-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .5rem; }

.fecha-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: .7rem 1rem;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 8px;
  gap: 1rem;
}

.fecha-info { display: flex; align-items: center; gap: .85rem; flex-wrap: wrap; }
.fecha-date  { font-weight: 700; font-size: .875rem; color: #dc2626; }
.fecha-motivo { font-size: .8rem; color: #64748b; }

.btn-desbloquear {
  background: #fff;
  border: 1px solid #fca5a5;
  border-radius: 6px;
  padding: .35rem .75rem;
  font-size: .75rem;
  font-family: inherit;
  font-weight: 600;
  color: #dc2626;
  cursor: pointer;
  transition: all .15s;
  white-space: nowrap;
  flex-shrink: 0;
}
.btn-desbloquear:hover { background: #fef2f2; border-color: #dc2626; }

.error-msg { color: #dc2626; font-size: .875rem; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: .6rem 1rem; margin: 0; }
</style>
