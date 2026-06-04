// ============================================================
// SIMULADOR DE WHATSAPP — solo para desarrollo/testing
// Monta en /test — Frontend: Vue 3 (CDN)
// ============================================================

const express        = require('express');
const bot            = require('./bot');
const sessionManager = require('./sessions/sessionManager');

const router         = express.Router();
const _captured      = new Map();
const _capturedMedia = new Map();

bot.onEnvio((telefono, mensaje) => {
  if (_captured.has(telefono)) _captured.get(telefono).push(mensaje);
});

bot.onEnvioMedia((telefono, mediaConfig) => {
  if (_capturedMedia.has(telefono)) _capturedMedia.get(telefono).push(mediaConfig);
});

// GET /test → app Vue 3
router.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(chatHTML());
});

// POST /test/message → { respuestas, sesion }
router.post('/message', express.json(), async (req, res) => {
  const { telefono = 'TEST001', mensaje } = req.body || {};
  if (!mensaje || !mensaje.trim())
    return res.status(400).json({ error: 'Falta el campo mensaje' });

  _captured.set(telefono, []);
  _capturedMedia.set(telefono, []);
  try {
    await bot.procesarMensaje(telefono, mensaje.trim());
  } catch (err) {
    _captured.delete(telefono);
    _capturedMedia.delete(telefono);
    return res.status(500).json({ error: err.message });
  }

  const respuestas = _captured.get(telefono) || [];
  const media      = _capturedMedia.get(telefono) || [];
  _captured.delete(telefono);
  _capturedMedia.delete(telefono);
  const sesion = sessionManager.obtenerSesion(telefono);
  res.json({ respuestas, media, sesion: _sanitize(sesion) });
});

// GET /test/session?telefono=X
router.get('/session', (req, res) => {
  const { telefono } = req.query;
  if (!telefono) return res.status(400).json({ error: 'Falta telefono' });
  res.json({ sesion: _sanitize(sessionManager.obtenerSesion(telefono)) });
});

// DELETE /test/session?telefono=X
router.delete('/session', (req, res) => {
  const { telefono } = req.query;
  if (!telefono) return res.status(400).json({ error: 'Falta telefono' });
  sessionManager.eliminarSesion(telefono);
  res.json({ ok: true });
});

module.exports = { crearTestRouter: () => router };

function _sanitize(s) {
  if (!s) return null;
  return {
    estado:           s.estado,
    modoHumano:       s.modoHumano,
    reservaPendiente: s.reservaPendiente,
    turnos:           s.historialConversacion.length,
  };
}

// ─── HTML (Vue 3 CDN) ──────────────────────────────────────

function chatHTML() {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>WhatsApp Simulator</title>
<script src="https://unpkg.com/vue@3/dist/vue.global.prod.js"><\/script>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: #111b21;
  height: 100dvh;
  overflow: hidden;
  color: #e9edef;
}

#app {
  height: 100dvh;
  display: flex;
  flex-direction: column;
}

/* ── Header ── */
.header {
  background: #202c33;
  padding: .7rem 1rem;
  display: flex;
  align-items: center;
  gap: .75rem;
  flex-shrink: 0;
  border-bottom: 1px solid #2a3942;
}
.avatar {
  width: 40px; height: 40px;
  border-radius: 50%;
  background: #00a884;
  display: flex; align-items: center; justify-content: center;
  font-size: 1.15rem;
  flex-shrink: 0;
}
.header-info { flex: 1; min-width: 0; }
.header-name { font-weight: 600; font-size: .93rem; }
.header-sub  { display: flex; align-items: center; gap: .4rem; margin-top: 2px; font-size: .71rem; color: #8696a0; }

.estado-badge {
  display: inline-block;
  padding: .05rem .42rem;
  border-radius: 4px;
  font-size: .63rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .04em;
  transition: all .25s;
}
.badge-inicio      { background: #1b3a2b; color: #00a884; }
.badge-recolectando{ background: #1a2e3f; color: #53bdeb; }
.badge-confirmando { background: #3a2c10; color: #f0b429; }
.badge-completado  { background: #1b3a2b; color: #00a884; }
.badge-cancelando  { background: #3a1b1b; color: #f47068; }
.badge-viendo      { background: #271a3a; color: #9b8ee0; }
.badge-humano      { background: #3a2c00; color: #f0b429; }

.header-actions { display: flex; align-items: center; gap: .5rem; flex-shrink: 0; }
.phone-wrap     { display: flex; align-items: center; gap: .35rem; }
.phone-label    { font-size: .71rem; color: #8696a0; white-space: nowrap; }

.phone-input {
  background: #2a3942;
  border: none;
  color: #e9edef;
  font-size: .78rem;
  font-family: monospace;
  padding: .3rem .6rem;
  border-radius: 6px;
  width: 148px;
  outline: none;
  transition: box-shadow .15s;
}
.phone-input:focus { box-shadow: 0 0 0 2px #00a884; }

.btn {
  background: transparent;
  border: 1px solid #2a3942;
  color: #8696a0;
  padding: .28rem .6rem;
  border-radius: 6px;
  cursor: pointer;
  font-size: .72rem;
  white-space: nowrap;
  transition: all .15s;
  font-family: inherit;
}
.btn:hover { background: #2a3942; color: #e9edef; }
.btn.active { border-color: #00a884; color: #00a884; background: #0d2820; }

/* ── Chat ── */
.chat {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: .45rem;
  background: #0b141a;
}
.chat::-webkit-scrollbar { width: 6px; }
.chat::-webkit-scrollbar-thumb { background: #2a3942; border-radius: 3px; }

.welcome {
  text-align: center;
  color: #8696a0;
  font-size: .78rem;
  padding: 2.5rem 1rem;
  line-height: 1.8;
  margin: auto;
}
.welcome strong { color: #e9edef; }
.welcome kbd {
  background: #2a3942;
  border-radius: 4px;
  padding: .05rem .35rem;
  font-size: .72rem;
  font-family: monospace;
  color: #e9edef;
}

.bubble {
  max-width: 76%;
  padding: .55rem .9rem .3rem;
  border-radius: 8px;
  font-size: .875rem;
  line-height: 1.5;
  word-break: break-word;
}
.bubble.user  { background: #005c4b; align-self: flex-end;  border-bottom-right-radius: 2px; }
.bubble.bot   { background: #202c33; align-self: flex-start; border-bottom-left-radius: 2px; }
.bubble.error { background: #3a1b1b; align-self: flex-start; border-bottom-left-radius: 2px; }

.bubble-body strong { font-weight: 600; }
.bubble-body em     { font-style: italic; }
.bubble-body del    { opacity: .65; }
.bubble-body code   {
  font-family: 'SF Mono', 'Fira Mono', monospace;
  background: rgba(255,255,255,.1);
  padding: .05rem .3rem;
  border-radius: 3px;
  font-size: .8rem;
}

.bubble-meta {
  display: flex;
  justify-content: flex-end;
  margin-top: .22rem;
}
.bubble-time { font-size: .63rem; color: rgba(255,255,255,.38); }

/* ── Media bubbles ── */
.media-img { max-width: 100%; border-radius: 4px; display: block; margin-bottom: .3rem; }
.media-caption { font-size: .82rem; line-height: 1.4; }
.media-link {
  display: inline-flex; align-items: center; gap: .4rem;
  background: #1a2e3f; border-radius: 6px; padding: .4rem .7rem;
  color: #53bdeb; text-decoration: none; font-size: .83rem;
  word-break: break-all;
}
.media-link:hover { text-decoration: underline; }
.media-placeholder {
  background: #1b2e20; border: 1px dashed #2a5c3f; border-radius: 6px;
  padding: .5rem .7rem; font-size: .78rem; color: #8696a0;
}

/* ── Typing ── */
.typing-wrap {
  padding: 0 1rem .45rem;
  background: #0b141a;
  flex-shrink: 0;
}
.typing-bubble {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: #202c33;
  border-radius: 8px;
  border-bottom-left-radius: 2px;
  padding: .55rem .8rem;
}
.dot {
  width: 7px; height: 7px;
  background: #8696a0;
  border-radius: 50%;
  animation: bounce .9s infinite;
}
.dot:nth-child(2) { animation-delay: .15s; }
.dot:nth-child(3) { animation-delay: .30s; }
@keyframes bounce {
  0%, 80%, 100% { transform: translateY(0); }
  40%           { transform: translateY(-5px); }
}

/* ── Debug panel ── */
.debug-panel {
  background: #161f25;
  border-top: 1px solid #2a3942;
  padding: .6rem 1rem;
  flex-shrink: 0;
}
.debug-empty { font-size: .72rem; color: #8696a0; }
.debug-grid  { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: .35rem .75rem; }
.debug-item  { display: flex; flex-direction: column; gap: 2px; }
.debug-label { font-size: .6rem; color: #8696a0; text-transform: uppercase; letter-spacing: .05em; }
.debug-value { font-family: monospace; font-size: .73rem; color: #e9edef; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.debug-value.empty   { color: #3a4a54; font-style: italic; }
.debug-value.humano  { color: #f47068; font-weight: 600; }
.debug-footer { font-size: .61rem; color: #8696a0; margin-top: .35rem; }

/* ── Input area ── */
.input-area {
  background: #202c33;
  padding: .6rem 1rem;
  display: flex;
  align-items: flex-end;
  gap: .6rem;
  flex-shrink: 0;
}
.msg-input {
  flex: 1;
  background: #2a3942;
  border: none;
  color: #e9edef;
  font-size: .9rem;
  font-family: inherit;
  padding: .65rem .95rem;
  border-radius: 12px;
  outline: none;
  resize: none;
  min-height: 42px;
  max-height: 120px;
  line-height: 1.4;
  transition: box-shadow .15s;
}
.msg-input::placeholder { color: #8696a0; }
.msg-input:focus { box-shadow: 0 0 0 1px #00a88450; }

.btn-send {
  width: 42px; height: 42px;
  border-radius: 50%;
  background: #00a884;
  border: none;
  color: #fff;
  cursor: pointer;
  flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  transition: background .15s;
  padding: 0;
}
.btn-send:hover:not(:disabled) { background: #06cf9c; }
.btn-send:disabled { background: #2a3942; cursor: not-allowed; }
.btn-send svg { width: 20px; height: 20px; fill: currentColor; }
</style>
</head>
<body>

<div id="app">

  <!-- Header -->
  <div class="header">
    <div class="avatar">🍽️</div>
    <div class="header-info">
      <div class="header-name">Bot de Reservas</div>
      <div class="header-sub">
        <span>{{ statusText }}</span>
        <span v-if="session" class="estado-badge" :class="'badge-' + session.estado">
          {{ session.estado }}
        </span>
      </div>
    </div>
    <div class="header-actions">
      <button class="btn" :class="{ active: showDebug }" @click="showDebug = !showDebug">
        🔍 debug
      </button>
      <div class="phone-wrap">
        <span class="phone-label">Tel:</span>
        <input class="phone-input" v-model="phone" placeholder="número" />
      </div>
      <button class="btn" @click="resetChat">↺ Reset</button>
    </div>
  </div>

  <!-- Chat -->
  <div class="chat" ref="chatEl">
    <div v-if="!messages.length" class="welcome">
      Escribí un mensaje para iniciar la conversación.<br>
      <strong>Enter</strong> para enviar &nbsp;·&nbsp; <kbd>Shift+Enter</kbd> para nueva línea<br>
      Cambiá el teléfono para simular otro usuario.
    </div>
    <template v-for="msg in messages" :key="msg.id">
      <!-- Burbuja de texto normal -->
      <div v-if="msg.kind === 'text'" class="bubble" :class="msg.side">
        <div class="bubble-body" v-html="msg.html"></div>
        <div class="bubble-meta"><span class="bubble-time">{{ msg.time }}</span></div>
      </div>
      <!-- Burbuja de media -->
      <div v-else class="bubble bot">
        <!-- Imagen -->
        <template v-if="msg.media.tipo === 'imagen'">
          <img v-if="msg.media.esUrl" :src="msg.media.valor" class="media-img" alt="menú" />
          <div v-else class="media-placeholder">📷 Imagen local: <em>{{ msg.media.valor }}</em></div>
          <div v-if="msg.media.caption" class="media-caption">{{ msg.media.caption }}</div>
        </template>
        <!-- PDF -->
        <template v-else-if="msg.media.tipo === 'pdf'">
          <a v-if="msg.media.esUrl" :href="msg.media.valor" target="_blank" class="media-link">📄 Descargar menú (PDF)</a>
          <div v-else class="media-placeholder">📄 PDF local: <em>{{ msg.media.valor }}</em></div>
          <div v-if="msg.media.caption" class="media-caption" style="margin-top:.3rem">{{ msg.media.caption }}</div>
        </template>
        <!-- URL -->
        <template v-else-if="msg.media.tipo === 'url'">
          <a :href="msg.media.valor" target="_blank" class="media-link">🔗 {{ msg.media.valor }}</a>
        </template>
        <div class="bubble-meta"><span class="bubble-time">{{ msg.time }}</span></div>
      </div>
    </template>
  </div>

  <!-- Typing indicator -->
  <div class="typing-wrap" v-show="isTyping">
    <div class="typing-bubble">
      <div class="dot"></div>
      <div class="dot"></div>
      <div class="dot"></div>
    </div>
  </div>

  <!-- Debug panel -->
  <div class="debug-panel" v-show="showDebug">
    <div v-if="!session" class="debug-empty">Sin sesión activa.</div>
    <template v-else>
      <div class="debug-grid">
        <div class="debug-item">
          <span class="debug-label">Estado</span>
          <span class="debug-value">{{ session.estado }}</span>
        </div>
        <div class="debug-item">
          <span class="debug-label">Nombre</span>
          <span class="debug-value" :class="{ empty: !session.reservaPendiente.nombre }">
            {{ session.reservaPendiente.nombre ?? 'null' }}
          </span>
        </div>
        <div class="debug-item">
          <span class="debug-label">Fecha</span>
          <span class="debug-value" :class="{ empty: !session.reservaPendiente.fecha }">
            {{ session.reservaPendiente.fecha ?? 'null' }}
          </span>
        </div>
        <div class="debug-item">
          <span class="debug-label">Hora</span>
          <span class="debug-value" :class="{ empty: !session.reservaPendiente.hora }">
            {{ session.reservaPendiente.hora ?? 'null' }}
          </span>
        </div>
        <div class="debug-item">
          <span class="debug-label">Personas</span>
          <span class="debug-value" :class="{ empty: session.reservaPendiente.personas == null }">
            {{ session.reservaPendiente.personas ?? 'null' }}
          </span>
        </div>
        <div class="debug-item">
          <span class="debug-label">Modo humano</span>
          <span class="debug-value" :class="{ humano: session.modoHumano }">
            {{ session.modoHumano ? 'SÍ' : 'no' }}
          </span>
        </div>
      </div>
      <div class="debug-footer">{{ session.turnos }} turnos en historial</div>
    </template>
  </div>

  <!-- Input -->
  <div class="input-area">
    <textarea
      class="msg-input"
      ref="inputEl"
      v-model="inputText"
      placeholder="Escribe un mensaje"
      rows="1"
      @keydown.enter.exact.prevent="sendMessage"
      @input="autoResize"
    ></textarea>
    <button class="btn-send" :disabled="!inputText.trim() || isTyping" @click="sendMessage">
      <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
    </button>
  </div>

</div>

<script>
const { createApp, ref, nextTick, onMounted } = Vue;

createApp({
  setup() {
    const messages   = ref([]);
    const inputText  = ref('');
    const phone      = ref('5491100000001');
    const isTyping   = ref(false);
    const session    = ref(null);
    const showDebug  = ref(false);
    const statusText = ref('Simulador de WhatsApp');
    const chatEl     = ref(null);
    const inputEl    = ref(null);
    let   msgId      = 0;

    function now() {
      return new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
    }

    function formatWA(text) {
      let h = text
        .replace(/&/g,  '&amp;')
        .replace(/</g,  '&lt;')
        .replace(/>/g,  '&gt;');

      h = h
        .replace(/\\*\\*\\*(.*?)\\*\\*\\*/gs, '<strong><em>$1</em></strong>')
        .replace(/\\*(.*?)\\*/gs,             '<strong>$1</strong>')
        .replace(/_(.*?)_/gs,                '<em>$1</em>')
        .replace(/~(.*?)~/gs,                '<del>$1</del>')
        .replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, '<pre><code>$1</code></pre>')
        .replace(/\`(.*?)\`/g,               '<code>$1</code>');

      h = h.replace(/\\n/g, '<br>');
      return h;
    }

    function addMessage(text, side) {
      messages.value.push({ id: ++msgId, kind: 'text', html: formatWA(text), side, time: now() });
      nextTick(() => {
        if (chatEl.value) chatEl.value.scrollTop = chatEl.value.scrollHeight;
      });
    }

    function addMedia(mediaConfig) {
      let valor = mediaConfig.valor || '';
      if (valor.startsWith('./')) valor = valor.slice(1); // './img/x' → '/img/x'
      const esUrl = /^https?:\\/\\//i.test(valor) || valor.startsWith('/');
      messages.value.push({ id: ++msgId, kind: 'media', media: { ...mediaConfig, valor, esUrl }, time: now() });
      nextTick(() => {
        if (chatEl.value) chatEl.value.scrollTop = chatEl.value.scrollHeight;
      });
    }

    async function sendMessage() {
      const text = inputText.value.trim();
      const tel  = phone.value.trim() || 'TEST001';
      if (!text || isTyping.value) return;

      inputText.value = '';
      if (inputEl.value) inputEl.value.style.height = 'auto';

      addMessage(text, 'user');
      isTyping.value  = true;
      statusText.value = 'escribiendo…';

      await nextTick();
      if (chatEl.value) chatEl.value.scrollTop = chatEl.value.scrollHeight;

      try {
        const res  = await fetch('/test/message', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ telefono: tel, mensaje: text }),
        });
        const data = await res.json();

        if (!res.ok) {
          addMessage('⚠️ Error: ' + (data.error || res.status), 'error');
        } else {
          if (data.respuestas && data.respuestas.length) {
            data.respuestas.forEach(r => addMessage(r, 'bot'));
          }
          if (data.media && data.media.length) {
            data.media.forEach(m => addMedia(m));
          }
          if (!data.respuestas?.length && !data.media?.length) {
            addMessage('(sin respuesta del bot)', 'bot');
          }
        }

        if (data.sesion !== undefined) session.value = data.sesion;

      } catch (e) {
        addMessage('⚠️ Error de red: ' + e.message, 'error');
      }

      isTyping.value   = false;
      statusText.value = 'Simulador de WhatsApp';
      nextTick(() => inputEl.value && inputEl.value.focus());
    }

    async function resetChat() {
      const oldPhone = phone.value.trim();
      if (oldPhone) {
        try {
          await fetch('/test/session?telefono=' + encodeURIComponent(oldPhone), { method: 'DELETE' });
        } catch (_) {}
      }
      phone.value    = '5491' + String(Math.floor(Math.random() * 90000000 + 10000000));
      messages.value = [];
      session.value  = null;
      nextTick(() => inputEl.value && inputEl.value.focus());
    }

    function autoResize(e) {
      const el = e.target;
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 120) + 'px';
    }

    onMounted(() => inputEl.value && inputEl.value.focus());

    return {
      messages, inputText, phone, isTyping,
      session, showDebug, statusText,
      chatEl, inputEl,
      sendMessage, resetChat, autoResize,
    };
  },
}).mount('#app');
<\/script>
</body>
</html>`;
}
