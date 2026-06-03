<script setup>
import { ref, onMounted } from 'vue'
import LoginForm from './components/LoginForm.vue'
import Dashboard from './components/Dashboard.vue'
import { hasToken } from './api.js'

const autenticado = ref(false)

onMounted(() => {
  autenticado.value = hasToken()
})

function onLogin() {
  autenticado.value = true
}
</script>

<template>
  <LoginForm v-if="!autenticado" @login="onLogin" />
  <Dashboard v-else />
</template>
