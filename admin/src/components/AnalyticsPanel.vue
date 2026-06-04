<script setup>
import { ref, computed, onMounted } from 'vue'
import { Bar } from 'vue-chartjs'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js'
import { getAnalytics } from '../api.js'

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

// ─── Date helpers ─────────────────────────────────────────────
function isoHoy() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }))
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function isoMakeOffset(isoStr, days) {
  const [y, m, d] = isoStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d + days)
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`
}

function isoADDMMYYYY(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

// ─── State ────────────────────────────────────────────────────
const hoy    = isoHoy()
const desde  = ref(isoMakeOffset(hoy, -6))
const hasta  = ref(hoy)

const data     = ref(null)
const cargando = ref(false)
const error    = ref('')

async function cargar() {
  if (!desde.value || !hasta.value) return
  cargando.value = true
  error.value    = ''
  try {
    data.value = await getAnalytics({
      desde: isoADDMMYYYY(desde.value),
      hasta: isoADDMMYYYY(hasta.value),
    })
  } catch (e) {
    error.value = e.message
  } finally {
    cargando.value = false
  }
}

// ─── Chart data ───────────────────────────────────────────────
const chartReservasPorDia = computed(() => {
  if (!data.value?.reservasPorDia) return null
  const dias = data.value.reservasPorDia
  return {
    labels: dias.map(d => d.fecha),
    datasets: [
      {
        label: 'Confirmadas',
        data: dias.map(d => d.confirmadas),
        backgroundColor: '#059669',
        borderRadius: 4,
      },
      {
        label: 'Canceladas',
        data: dias.map(d => d.canceladas),
        backgroundColor: '#dc2626',
        borderRadius: 4,
      },
      {
        label: 'No-shows',
        data: dias.map(d => d.no_shows),
        backgroundColor: '#d97706',
        borderRadius: 4,
      },
    ],
  }
})

const chartHorasPico = computed(() => {
  if (!data.value?.horasPico) return null
  const horas = data.value.horasPico
  return {
    labels: horas.map(h => h.hora),
    datasets: [
      {
        label: 'Reservas',
        data: horas.map(h => h.total),
        backgroundColor: '#6366f1',
        borderRadius: 4,
      },
    ],
  }
})

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } } },
  scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } },
}

const chartOptionsPico = {
  ...chartOptions,
  indexAxis: 'y',
}

onMounted(cargar)
</script>

<template>
  <div class="analytics">
    <!-- Toolbar -->
    <div class="toolbar">
      <label>Desde: <input type="date" v-model="desde" /></label>
      <label>Hasta: <input type="date" v-model="hasta" /></label>
      <button class="btn-buscar" @click="cargar" :disabled="cargando">
        {{ cargando ? '…' : 'Calcular' }}
      </button>
    </div>

    <p v-if="error" class="error">{{ error }}</p>

    <template v-if="data">
      <!-- Metric cards -->
      <div class="metrics">
        <div class="metric-card">
          <span class="m-value">{{ data.totalReservas }}</span>
          <span class="m-label">Total reservas</span>
        </div>
        <div class="metric-card">
          <span class="m-value">{{ data.personasPromedio?.toFixed(1) }}</span>
          <span class="m-label">Personas promedio</span>
        </div>
        <div class="metric-card">
          <span class="m-value">{{ data.tasaCancelacion?.toFixed(1) }}%</span>
          <span class="m-label">Tasa cancelación</span>
        </div>
        <div class="metric-card">
          <span class="m-value">{{ data.tasaNoShow?.toFixed(1) }}%</span>
          <span class="m-label">Tasa no-show</span>
        </div>
      </div>

      <!-- Charts -->
      <div class="charts">
        <div class="chart-box" v-if="chartReservasPorDia">
          <h3 class="chart-title">Reservas por día</h3>
          <div class="chart-wrap">
            <Bar :data="chartReservasPorDia" :options="chartOptions" />
          </div>
        </div>

        <div class="chart-box" v-if="chartHorasPico">
          <h3 class="chart-title">Horarios más reservados</h3>
          <div class="chart-wrap">
            <Bar :data="chartHorasPico" :options="chartOptionsPico" />
          </div>
        </div>
      </div>
    </template>

    <div v-else-if="!cargando" class="empty">Seleccioná un rango y presioná Calcular</div>
  </div>
</template>

<style scoped>
.analytics { display: flex; flex-direction: column; gap: 1.25rem; }

.toolbar {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
}
.toolbar label { font-size: .875rem; color: #374151; display: flex; align-items: center; gap: .4rem; }
.toolbar input[type="date"] { border: 1px solid #d1d5db; border-radius: 6px; padding: .3rem .6rem; font-size: .875rem; font-family: inherit; }
.btn-buscar { background: #111827; color: #fff; font-weight: 600; padding: .4rem .9rem; }
.btn-buscar:hover:not(:disabled) { background: #374151; }

.error { color: #dc2626; font-size: .875rem; }
.empty { color: #9ca3af; font-style: italic; text-align: center; padding: 3rem; background: #fff; border-radius: 10px; }

.metrics {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: .85rem;
}
.metric-card {
  background: #fff;
  border-radius: 10px;
  box-shadow: 0 1px 3px rgba(0,0,0,.09);
  padding: 1.1rem 1.2rem;
  display: flex;
  flex-direction: column;
  gap: .2rem;
}
.m-value { font-size: 1.8rem; font-weight: 700; color: #111827; line-height: 1; }
.m-label { font-size: .72rem; color: #9ca3af; text-transform: uppercase; letter-spacing: .05em; }

.charts { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
@media (max-width: 700px) { .charts { grid-template-columns: 1fr; } }

.chart-box {
  background: #fff;
  border-radius: 10px;
  box-shadow: 0 1px 3px rgba(0,0,0,.09);
  padding: 1rem;
}
.chart-title { font-size: .85rem; font-weight: 600; color: #374151; margin: 0 0 .75rem; }
.chart-wrap  { height: 240px; }
</style>
