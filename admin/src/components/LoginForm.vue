<script setup>
import { ref } from 'vue'
import { setToken, clearToken, getStats } from '../api.js'

const emit = defineEmits(['login'])

const token   = ref('')
const error   = ref('')
const loading = ref(false)

async function login() {
  if (!token.value.trim()) return
  loading.value = true
  error.value   = ''
  setToken(token.value.trim())
  try {
    await getStats()
    emit('login')
  } catch {
    error.value = 'Token incorrecto o error de conexión'
    clearToken()
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="wrap">
    <div class="card">
      <div class="icon">🍽️</div>
      <h1>Panel de Reservas</h1>
      <p>Ingresá tu token de administrador para continuar</p>
      <input
        v-model="token"
        type="password"
        placeholder="Token de administrador"
        @keyup.enter="login"
        autofocus
      />
      <p v-if="error" class="error">{{ error }}</p>
      <button @click="login" :disabled="loading || !token">
        {{ loading ? 'Verificando…' : 'Ingresar' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.wrap {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}
.card {
  background: #fff;
  border-radius: 14px;
  padding: 2.5rem 2rem;
  width: 100%;
  max-width: 380px;
  box-shadow: 0 4px 24px rgba(0,0,0,.1);
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: .9rem;
}
.icon { font-size: 2.5rem; }
h1   { font-size: 1.3rem; font-weight: 700; color: #111827; }
p    { color: #6b7280; font-size: .875rem; }
input {
  width: 100%;
  padding: .6rem .9rem;
  font-size: .95rem;
}
.error { color: #dc2626; font-size: .8rem; }
button {
  background: #111827;
  color: #fff;
  padding: .65rem;
  font-size: .95rem;
  font-weight: 600;
  width: 100%;
  border-radius: 8px;
}
button:hover:not(:disabled) { background: #374151; }
</style>
