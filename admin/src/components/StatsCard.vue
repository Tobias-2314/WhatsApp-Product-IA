<script setup>
defineProps({
  value:    { type: [Number, String], default: 0 },
  label:    { type: String, required: true },
  color:    { type: String, default: '#6366f1' },
  icon:     { type: String, default: '' },
  trend:    { type: Number, default: null },  // positivo/negativo/%
})
</script>

<template>
  <div class="card" :style="`--accent: ${color}`">
    <div class="card-top">
      <span class="card-icon" v-if="icon">{{ icon }}</span>
      <div class="card-meta">
        <span class="card-label">{{ label }}</span>
        <span v-if="trend !== null" class="card-trend" :class="trend >= 0 ? 'up' : 'down'">
          {{ trend >= 0 ? '↑' : '↓' }} {{ Math.abs(trend) }}%
        </span>
      </div>
    </div>
    <div class="card-value">{{ value }}</div>
    <div class="card-bar"></div>
  </div>
</template>

<style scoped>
.card {
  background: #fff;
  border-radius: 12px;
  padding: 1rem 1.1rem .8rem;
  border: 1px solid #f1f5f9;
  box-shadow: 0 1px 3px rgba(0,0,0,.06);
  display: flex;
  flex-direction: column;
  gap: .3rem;
  position: relative;
  overflow: hidden;
  transition: box-shadow .15s, transform .12s;
}
.card:hover { box-shadow: 0 4px 12px rgba(0,0,0,.1); transform: translateY(-1px); }

.card-top   { display: flex; align-items: center; gap: .5rem; }
.card-icon  { font-size: 1.1rem; line-height: 1; }
.card-meta  { display: flex; flex-direction: column; gap: 1px; flex: 1; }
.card-label { font-size: .72rem; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: .04em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.card-trend { font-size: .65rem; font-weight: 700; }
.card-trend.up   { color: #059669; }
.card-trend.down { color: #dc2626; }

.card-value {
  font-size: 1.8rem;
  font-weight: 800;
  color: #0f172a;
  line-height: 1;
  letter-spacing: -.03em;
}

.card-bar {
  position: absolute;
  bottom: 0; left: 0; right: 0;
  height: 3px;
  background: var(--accent);
  opacity: .7;
}
</style>
