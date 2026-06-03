<script setup>
defineProps({
  value:  { type: [Number, String], required: true },
  label:  { type: String, required: true },
  color:  { type: String, default: '#111827' },
})
</script>

<template>
  <div class="card">
    <div class="value" :style="{ color }">{{ value }}</div>
    <div class="label">{{ label }}</div>
  </div>
</template>

<style scoped>
.card {
  background: #fff;
  border-radius: 10px;
  padding: 1.1rem 1.2rem;
  text-align: center;
  box-shadow: 0 1px 3px rgba(0,0,0,.09);
}
.value {
  font-size: 2.2rem;
  font-weight: 700;
  line-height: 1.1;
}
.label {
  color: #6b7280;
  font-size: .72rem;
  text-transform: uppercase;
  letter-spacing: .05em;
  margin-top: .3rem;
}
</style>
