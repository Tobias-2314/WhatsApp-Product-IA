<script setup>
import { ref, onMounted } from 'vue'
import { getConfig, actualizarConfig } from '../api.js'

const emit = defineEmits(['updated'])

const cargando   = ref(false)
const guardando  = ref(false)
const error      = ref('')
const exito      = ref('')
const seccion    = ref('restaurante')

const dias = ['lunes','martes','miercoles','jueves','viernes','sabado','domingo']
const diasLabel = { lunes:'Lunes', martes:'Martes', miercoles:'Miércoles', jueves:'Jueves', viernes:'Viernes', sabado:'Sábado', domingo:'Domingo' }

const cfg = ref({
  nombre:                   '',
  telefono:                 '',
  direccion:                '',
  idioma:                   'es',
  telefonoAdmin:            '',
  horarios:                 { lunes:null, martes:{apertura:'12:00',cierre:'23:00'}, miercoles:{apertura:'12:00',cierre:'23:00'}, jueves:{apertura:'12:00',cierre:'23:00'}, viernes:{apertura:'12:00',cierre:'00:00'}, sabado:{apertura:'12:00',cierre:'00:00'}, domingo:{apertura:'12:00',cierre:'23:00'} },
  franjasHorarias:          [],
  franjasTexto:             '',
  maximoPersonasPorReserva: 12,
  horasMinimaCancelacion:   2,
  diasMaximosAnticipacion:  30,
  duracionReservaMinutos:   90,
  tiempoLimpiezaMinutos:    15,
  maxMesasCombinadas:       2,
  deposito_requerido:       false,
  deposito_monto:           0,
  menu:                     '',
})

function horarioAbierto(dia) {
  return cfg.value.horarios?.[dia] !== null && cfg.value.horarios?.[dia] !== undefined
}

function toggleDia(dia) {
  if (horarioAbierto(dia)) {
    cfg.value.horarios = { ...cfg.value.horarios, [dia]: null }
  } else {
    cfg.value.horarios = { ...cfg.value.horarios, [dia]: { apertura: '12:00', cierre: '23:00' } }
  }
}

function setHorario(dia, campo, valor) {
  if (!cfg.value.horarios[dia]) return
  cfg.value.horarios = {
    ...cfg.value.horarios,
    [dia]: { ...cfg.value.horarios[dia], [campo]: valor }
  }
}

onMounted(async () => {
  cargando.value = true
  try {
    const data = await getConfig()
    if (data && Object.keys(data).length) {
      cfg.value = {
        ...cfg.value,
        ...data,
        franjasTexto: (data.franjasHorarias || []).join(', '),
      }
    }
  } catch (e) {
    error.value = 'No se pudo cargar la configuración: ' + e.message
  } finally {
    cargando.value = false
  }
})

async function guardar() {
  guardando.value = true
  error.value     = ''
  exito.value     = ''
  try {
    // Parsear franjas desde texto
    const franjas = cfg.value.franjasTexto
      .split(/[,\n]+/)
      .map(s => s.trim())
      .filter(s => /^\d{1,2}:\d{2}$/.test(s))
      .sort()

    const payload = {
      ...cfg.value,
      franjasHorarias:          franjas,
      maximoPersonasPorReserva: parseInt(cfg.value.maximoPersonasPorReserva) || 12,
      horasMinimaCancelacion:   parseInt(cfg.value.horasMinimaCancelacion)   || 2,
      diasMaximosAnticipacion:  parseInt(cfg.value.diasMaximosAnticipacion)  || 30,
      duracionReservaMinutos:   parseInt(cfg.value.duracionReservaMinutos)   || 90,
      tiempoLimpiezaMinutos:    parseInt(cfg.value.tiempoLimpiezaMinutos)    || 15,
      maxMesasCombinadas:       parseInt(cfg.value.maxMesasCombinadas)       || 2,
      deposito_monto:           parseInt(cfg.value.deposito_monto)           || 0,
      telefonoAdmin:            cfg.value.telefonoAdmin || null,
    }
    delete payload.franjasTexto

    const result = await actualizarConfig(payload)
    exito.value = '✅ Configuración guardada correctamente'
    emit('updated', result)
    setTimeout(() => { exito.value = '' }, 3500)
  } catch (e) {
    error.value = 'Error al guardar: ' + e.message
  } finally {
    guardando.value = false
  }
}
</script>

<template>
  <div class="config-panel">
    <div class="cp-header">
      <h2 class="cp-title">⚙️ Configuración del Restaurante</h2>
      <p class="cp-sub">Todos los cambios se aplican inmediatamente al bot de WhatsApp</p>
    </div>

    <div v-if="cargando" class="cp-loading">Cargando configuración…</div>

    <template v-else>
      <!-- Navegación de secciones -->
      <div class="cp-nav">
        <button v-for="s in [
          { id:'restaurante', icon:'🏪', label:'Restaurante' },
          { id:'horarios',    icon:'🕐', label:'Horarios' },
          { id:'reservas',    icon:'📅', label:'Reservas' },
          { id:'notif',       icon:'🔔', label:'Notificaciones' },
          { id:'menu',        icon:'🍽️', label:'Menú' },
        ]" :key="s.id"
          :class="['cp-nav-btn', { active: seccion === s.id }]"
          @click="seccion = s.id"
        >
          <span>{{ s.icon }}</span> {{ s.label }}
        </button>
      </div>

      <div class="cp-body">

        <!-- ── RESTAURANTE ── -->
        <div v-if="seccion === 'restaurante'" class="cp-section">
          <h3 class="sec-title">Información del restaurante</h3>
          <div class="form-grid">
            <div class="field">
              <label>Nombre del restaurante *</label>
              <input v-model="cfg.nombre" placeholder="La Parrilla de Don José" />
            </div>
            <div class="field">
              <label>Teléfono de contacto</label>
              <input v-model="cfg.telefono" placeholder="+54 11 1234-5678" />
            </div>
            <div class="field full">
              <label>Dirección</label>
              <input v-model="cfg.direccion" placeholder="Av. Corrientes 1234, CABA" />
            </div>
            <div class="field">
              <label>Idioma del bot</label>
              <select v-model="cfg.idioma">
                <option value="es">🇦🇷 Español</option>
                <option value="en">🇺🇸 English</option>
                <option value="pt">🇧🇷 Português</option>
              </select>
            </div>
          </div>
        </div>

        <!-- ── HORARIOS ── -->
        <div v-else-if="seccion === 'horarios'" class="cp-section">
          <h3 class="sec-title">Horarios de atención</h3>
          <p class="sec-hint">Desactivá los días que el restaurante está cerrado</p>
          <div class="horarios-grid">
            <div v-for="dia in dias" :key="dia" class="horario-row">
              <label class="toggle-row">
                <input type="checkbox" :checked="horarioAbierto(dia)" @change="toggleDia(dia)" />
                <span class="toggle-dia">{{ diasLabel[dia] }}</span>
              </label>
              <template v-if="horarioAbierto(dia)">
                <div class="time-pair">
                  <label>Apertura</label>
                  <input type="time" :value="cfg.horarios[dia]?.apertura" @change="setHorario(dia, 'apertura', $event.target.value)" />
                </div>
                <div class="time-pair">
                  <label>Cierre</label>
                  <input type="time" :value="cfg.horarios[dia]?.cierre" @change="setHorario(dia, 'cierre', $event.target.value)" />
                </div>
              </template>
              <span v-else class="cerrado-badge">Cerrado</span>
            </div>
          </div>
        </div>

        <!-- ── RESERVAS ── -->
        <div v-else-if="seccion === 'reservas'" class="cp-section">
          <h3 class="sec-title">Configuración de reservas</h3>
          <div class="form-grid">
            <div class="field full">
              <label>Franjas horarias disponibles</label>
              <textarea v-model="cfg.franjasTexto" rows="3" placeholder="20:00, 20:15, 20:30, 20:45, 21:00…" />
              <span class="field-hint">Separadas por comas. Formato HH:MM</span>
            </div>
            <div class="field">
              <label>Duración de reserva (min)</label>
              <input type="number" v-model="cfg.duracionReservaMinutos" min="30" max="300" step="15" />
            </div>
            <div class="field">
              <label>Buffer limpieza (min)</label>
              <input type="number" v-model="cfg.tiempoLimpiezaMinutos" min="0" max="60" step="5" />
            </div>
            <div class="field">
              <label>Máx. personas por reserva</label>
              <input type="number" v-model="cfg.maximoPersonasPorReserva" min="1" max="50" />
            </div>
            <div class="field">
              <label>Máx. mesas combinables</label>
              <input type="number" v-model="cfg.maxMesasCombinadas" min="1" max="4" />
            </div>
            <div class="field">
              <label>Cancelación mínima (horas)</label>
              <input type="number" v-model="cfg.horasMinimaCancelacion" min="0" max="72" />
            </div>
            <div class="field">
              <label>Anticipación máxima (días)</label>
              <input type="number" v-model="cfg.diasMaximosAnticipacion" min="1" max="365" />
            </div>
          </div>
        </div>

        <!-- ── NOTIFICACIONES ── -->
        <div v-else-if="seccion === 'notif'" class="cp-section">
          <h3 class="sec-title">Notificaciones y pagos</h3>
          <div class="form-grid">
            <div class="field full">
              <label>WhatsApp del dueño (notificaciones)</label>
              <input v-model="cfg.telefonoAdmin" placeholder="5491112345678 (sin + ni espacios)" />
              <span class="field-hint">Recibirá un mensaje por cada nueva reserva, cancelación y modificación</span>
            </div>
            <div class="field full">
              <label class="toggle-label">
                <input type="checkbox" v-model="cfg.deposito_requerido" />
                <span>Requerir depósito/seña via MercadoPago</span>
              </label>
              <span class="field-hint">Necesitás configurar MP_ACCESS_TOKEN en tu .env</span>
            </div>
            <div class="field" v-if="cfg.deposito_requerido">
              <label>Monto del depósito ($)</label>
              <input type="number" v-model="cfg.deposito_monto" min="0" step="100" />
            </div>
          </div>
        </div>

        <!-- ── MENÚ ── -->
        <div v-else-if="seccion === 'menu'" class="cp-section">
          <h3 class="sec-title">Menú del restaurante</h3>
          <p class="sec-hint">Usá *negritas* y _itálicas_ para formato WhatsApp</p>
          <div class="field">
            <textarea v-model="cfg.menu" rows="16" placeholder="🍽️ *MENÚ*&#10;━━━━━━━&#10;• Plato 1 — $1000&#10;• Plato 2 — $1500" class="mono" />
          </div>
        </div>

      </div>

      <!-- Acciones -->
      <div class="cp-actions">
        <p v-if="error" class="cp-error">{{ error }}</p>
        <p v-if="exito" class="cp-exito">{{ exito }}</p>
        <button class="btn-guardar" @click="guardar" :disabled="guardando">
          {{ guardando ? 'Guardando…' : '💾 Guardar configuración' }}
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.config-panel { display: flex; flex-direction: column; gap: 1.25rem; }

.cp-header { }
.cp-title { font-size: 1.1rem; font-weight: 700; color: #0f172a; }
.cp-sub   { font-size: .8rem; color: #64748b; margin-top: .25rem; }

.cp-loading { color: #94a3b8; font-style: italic; padding: 2rem; text-align: center; background: #fff; border-radius: 10px; }

.cp-nav {
  display: flex;
  gap: .4rem;
  flex-wrap: wrap;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: .6rem;
}
.cp-nav-btn {
  display: flex;
  align-items: center;
  gap: .4rem;
  padding: .45rem .9rem;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #475569;
  font-size: .82rem;
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
  transition: all .15s;
}
.cp-nav-btn:hover  { background: #f1f5f9; color: #0f172a; }
.cp-nav-btn.active { background: #0f172a; color: #fff; font-weight: 700; }

.cp-body {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 1.5rem;
  box-shadow: 0 1px 3px rgba(0,0,0,.04);
}

.cp-section { display: flex; flex-direction: column; gap: 1rem; }
.sec-title  { font-size: .9rem; font-weight: 700; color: #0f172a; margin-bottom: .25rem; }
.sec-hint   { font-size: .78rem; color: #64748b; }

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: .85rem;
}
@media (max-width: 600px) { .form-grid { grid-template-columns: 1fr; } }
.field.full { grid-column: 1 / -1; }

.field { display: flex; flex-direction: column; gap: .35rem; }
.field label {
  font-size: .75rem;
  font-weight: 600;
  color: #475569;
  text-transform: uppercase;
  letter-spacing: .04em;
}
.field input, .field select, .field textarea {
  border: 1.5px solid #e2e8f0;
  border-radius: 8px;
  padding: .6rem .8rem;
  font-size: .875rem;
  font-family: inherit;
  outline: none;
  background: #f8fafc;
  transition: border-color .15s;
  resize: vertical;
}
.field input:focus, .field select:focus, .field textarea:focus { border-color: #6366f1; background: #fff; }
.field-hint  { font-size: .72rem; color: #94a3b8; }
.mono        { font-family: 'Courier New', monospace; font-size: .82rem; }

.toggle-label { display: flex; align-items: center; gap: .5rem; font-size: .875rem; color: #374151; font-weight: 500; cursor: pointer; text-transform: none; letter-spacing: 0; }
.toggle-label input { width: 15px; height: 15px; cursor: pointer; }

/* Horarios */
.horarios-grid { display: flex; flex-direction: column; gap: .6rem; }
.horario-row {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: .6rem .85rem;
  background: #f8fafc;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
  flex-wrap: wrap;
}
.toggle-row { display: flex; align-items: center; gap: .5rem; cursor: pointer; min-width: 110px; }
.toggle-row input { width: 15px; height: 15px; cursor: pointer; }
.toggle-dia { font-size: .85rem; font-weight: 600; color: #374151; }
.time-pair  { display: flex; align-items: center; gap: .4rem; font-size: .8rem; color: #64748b; }
.time-pair input { border: 1.5px solid #e2e8f0; border-radius: 6px; padding: .3rem .5rem; font-size: .82rem; font-family: inherit; background: #fff; outline: none; }
.time-pair input:focus { border-color: #6366f1; }
.cerrado-badge { font-size: .75rem; color: #94a3b8; font-style: italic; }

/* Acciones */
.cp-actions { display: flex; flex-direction: column; align-items: flex-end; gap: .6rem; }
.cp-error { color: #dc2626; font-size: .82rem; background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; padding: .4rem .75rem; width: 100%; box-sizing: border-box; }
.cp-exito { color: #065f46; font-size: .82rem; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: .4rem .75rem; width: 100%; box-sizing: border-box; }
.btn-guardar {
  background: linear-gradient(135deg, #0f172a, #1e293b);
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: .7rem 1.75rem;
  font-size: .9rem;
  font-weight: 700;
  cursor: pointer;
  font-family: inherit;
  transition: opacity .15s, transform .1s;
}
.btn-guardar:hover:not(:disabled) { opacity: .88; transform: translateY(-1px); }
.btn-guardar:disabled { opacity: .55; cursor: not-allowed; }
</style>
