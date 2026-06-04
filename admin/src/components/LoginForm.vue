<script setup>
import { ref } from 'vue'
import { setToken, getStats } from '../api.js'

const emit = defineEmits(['login'])
const token = ref('')
const error = ref('')
const cargando = ref(false)

async function login() {
  if (!token.value.trim()) { error.value = 'Ingresá el token de acceso'; return }
  cargando.value = true
  error.value = ''
  try {
    setToken(token.value.trim())
    await getStats()
    emit('login')
  } catch {
    error.value = 'Token incorrecto. Verificá y volvé a intentar.'
    import('../api.js').then(m => m.clearToken())
  } finally {
    cargando.value = false
  }
}
</script>

<template>
  <div class="login-bg">
    <div class="login-card">
      <div class="login-logo">
        <span class="logo-icon">🍽️</span>
        <div>
          <div class="logo-title">ReservaBot</div>
          <div class="logo-sub">Panel de Administración</div>
        </div>
      </div>
      <div class="login-divider"></div>
      <p class="login-label">Token de acceso</p>
      <input
        class="login-input"
        v-model="token"
        type="password"
        placeholder="Ingresá tu token…"
        @keydown.enter="login"
        autofocus
      />
      <p v-if="error" class="login-error">{{ error }}</p>
      <button class="login-btn" @click="login" :disabled="cargando">
        <span v-if="!cargando">Ingresar →</span>
        <span v-else>Verificando…</span>
      </button>
      <p class="login-footer">Acceso restringido · Solo personal autorizado</p>
    </div>
  </div>
</template>

<style scoped>
.login-bg {
  min-height: 100vh;
  background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}

.login-card {
  background: #fff;
  border-radius: 16px;
  padding: 2.5rem 2rem;
  width: 100%;
  max-width: 380px;
  box-shadow: 0 25px 50px rgba(0,0,0,.4);
}

.login-logo {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1.5rem;
}
.logo-icon   { font-size: 2.5rem; line-height: 1; }
.logo-title  { font-size: 1.25rem; font-weight: 800; color: #0f172a; letter-spacing: -.02em; }
.logo-sub    { font-size: .75rem; color: #64748b; margin-top: 1px; }

.login-divider { height: 1px; background: #e2e8f0; margin-bottom: 1.5rem; }

.login-label {
  font-size: .8rem;
  font-weight: 600;
  color: #475569;
  margin-bottom: .5rem;
  text-transform: uppercase;
  letter-spacing: .05em;
}

.login-input {
  width: 100%;
  border: 1.5px solid #e2e8f0;
  border-radius: 8px;
  padding: .75rem 1rem;
  font-size: .95rem;
  font-family: inherit;
  outline: none;
  transition: border-color .15s;
  background: #f8fafc;
  box-sizing: border-box;
}
.login-input:focus { border-color: #6366f1; background: #fff; }

.login-error {
  margin-top: .5rem;
  font-size: .8rem;
  color: #dc2626;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 6px;
  padding: .4rem .75rem;
}

.login-btn {
  margin-top: 1rem;
  width: 100%;
  background: linear-gradient(135deg, #4f46e5, #6366f1);
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: .85rem;
  font-size: .95rem;
  font-weight: 700;
  cursor: pointer;
  transition: opacity .15s, transform .1s;
  font-family: inherit;
}
.login-btn:hover:not(:disabled) { opacity: .92; transform: translateY(-1px); }
.login-btn:active { transform: translateY(0); }
.login-btn:disabled { opacity: .6; cursor: not-allowed; }

.login-footer {
  margin-top: 1rem;
  text-align: center;
  font-size: .72rem;
  color: #94a3b8;
}
</style>
