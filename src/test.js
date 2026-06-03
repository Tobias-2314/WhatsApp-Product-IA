// ============================================================
// SIMULADOR DE WHATSAPP — solo para desarrollo/testing
// Monta en /test
// ============================================================

const express = require('express');
const bot     = require('./bot');

const router = express.Router();

// Captura las respuestas del bot por teléfono durante un procesarMensaje
const _captured = new Map();

bot.onEnvio((telefono, mensaje) => {
  if (_captured.has(telefono)) _captured.get(telefono).push(mensaje);
});

// GET /test → devuelve el chat HTML
router.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(chatHTML());
});

// POST /test/message → { telefono, mensaje } → { respuestas: [] }
router.post('/message', express.json(), async (req, res) => {
  const { telefono = 'TEST001', mensaje } = req.body || {};
  if (!mensaje || !mensaje.trim()) {
    return res.status(400).json({ error: 'Falta el campo mensaje' });
  }

  _captured.set(telefono, []);
  try {
    await bot.procesarMensaje(telefono, mensaje.trim());
  } catch (err) {
    _captured.delete(telefono);
    return res.status(500).json({ error: err.message });
  }

  const respuestas = _captured.get(telefono) || [];
  _captured.delete(telefono);
  res.json({ respuestas });
});

module.exports = { crearTestRouter: () => router };

// ─── HTML ─────────────────────────────────────────────────

function chatHTML() {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>WhatsApp Simulator</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#111b21;height:100vh;display:flex;flex-direction:column;color:#e9edef}

  /* Header */
  .header{background:#202c33;padding:.75rem 1rem;display:flex;align-items:center;gap:.85rem;flex-shrink:0;border-bottom:1px solid #2a3942}
  .avatar{width:40px;height:40px;border-radius:50%;background:#00a884;display:flex;align-items:center;justify-content:center;font-size:1.1rem;flex-shrink:0}
  .header-info{flex:1}
  .header-name{font-weight:600;font-size:.95rem}
  .header-sub{font-size:.75rem;color:#8696a0}
  .phone-wrap{display:flex;align-items:center;gap:.5rem}
  .phone-wrap label{font-size:.75rem;color:#8696a0;white-space:nowrap}
  .phone-input{background:#2a3942;border:none;color:#e9edef;font-size:.8rem;padding:.3rem .6rem;border-radius:6px;width:150px;outline:none}
  .btn-reset{background:transparent;border:1px solid #2a3942;color:#8696a0;padding:.3rem .65rem;border-radius:6px;cursor:pointer;font-size:.75rem}
  .btn-reset:hover{background:#2a3942}

  /* Chat area */
  .chat{flex:1;overflow-y:auto;padding:1rem;display:flex;flex-direction:column;gap:.5rem;background:#0b141a}
  .chat::-webkit-scrollbar{width:6px}
  .chat::-webkit-scrollbar-thumb{background:#2a3942;border-radius:3px}

  /* Bubbles */
  .bubble{max-width:72%;padding:.55rem .9rem .4rem;border-radius:8px;font-size:.875rem;line-height:1.45;position:relative;word-break:break-word}
  .bubble.user{background:#005c4b;align-self:flex-end;border-bottom-right-radius:2px}
  .bubble.bot{background:#202c33;align-self:flex-start;border-bottom-left-radius:2px}
  .bubble-time{font-size:.65rem;color:rgba(255,255,255,.45);float:right;margin-left:.6rem;margin-top:.2rem}
  .bubble pre{white-space:pre-wrap;font-family:inherit}

  /* Typing indicator */
  .typing{align-self:flex-start;background:#202c33;border-radius:8px;border-bottom-left-radius:2px;padding:.6rem .9rem;display:none}
  .dots{display:flex;gap:4px}
  .dots span{width:8px;height:8px;background:#8696a0;border-radius:50%;animation:bounce .9s infinite}
  .dots span:nth-child(2){animation-delay:.15s}
  .dots span:nth-child(3){animation-delay:.3s}
  @keyframes bounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-6px)}}

  /* Input area */
  .input-area{background:#202c33;padding:.65rem 1rem;display:flex;align-items:center;gap:.6rem;flex-shrink:0}
  .msg-input{flex:1;background:#2a3942;border:none;color:#e9edef;font-size:.95rem;padding:.7rem 1rem;border-radius:999px;outline:none;resize:none;max-height:120px;min-height:42px;line-height:1.4}
  .msg-input::placeholder{color:#8696a0}
  .btn-send{width:42px;height:42px;border-radius:50%;background:#00a884;border:none;color:#fff;font-size:1.1rem;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;transition:background .15s}
  .btn-send:hover{background:#06cf9c}
  .btn-send:disabled{background:#2a3942;cursor:not-allowed}

  /* Welcome */
  .welcome{text-align:center;color:#8696a0;font-size:.8rem;padding:1rem 0}
  .welcome strong{color:#e9edef}
</style>
</head>
<body>

<div class="header">
  <div class="avatar">🍽️</div>
  <div class="header-info">
    <div class="header-name">Bot de Reservas</div>
    <div class="header-sub" id="statusLine">Simulador de WhatsApp</div>
  </div>
  <div class="phone-wrap">
    <label>Teléfono:</label>
    <input class="phone-input" id="phoneInput" value="5491100000001" placeholder="número" />
    <button class="btn-reset" onclick="resetChat()" title="Nueva conversación">↺ Reset</button>
  </div>
</div>

<div class="chat" id="chat">
  <div class="welcome">
    Escribí un mensaje para empezar la conversación.<br>
    Cambiá el <strong>Teléfono</strong> para simular distintos usuarios.
  </div>
</div>

<div class="typing" id="typing"><div class="dots"><span></span><span></span><span></span></div></div>

<div class="input-area">
  <textarea class="msg-input" id="msgInput" placeholder="Escribe un mensaje" rows="1"></textarea>
  <button class="btn-send" id="sendBtn" onclick="enviar()">➤</button>
</div>

<script>
const chat      = document.getElementById('chat');
const msgInput  = document.getElementById('msgInput');
const sendBtn   = document.getElementById('sendBtn');
const typing    = document.getElementById('typing');
const phoneInput = document.getElementById('phoneInput');
const statusLine = document.getElementById('statusLine');

// Auto-resize textarea
msgInput.addEventListener('input', () => {
  msgInput.style.height = 'auto';
  msgInput.style.height = Math.min(msgInput.scrollHeight, 120) + 'px';
});

msgInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); }
});

function ahora() {
  return new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

function agregarBurbuja(texto, lado) {
  // Eliminar welcome si existe
  const welcome = chat.querySelector('.welcome');
  if (welcome) welcome.remove();

  const div = document.createElement('div');
  div.className = 'bubble ' + lado;
  // Renderizar saltos de línea y negrita básica de WhatsApp (*texto*)
  const escaped = texto
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const html = escaped
    .replace(/\*(.*?)\*/g, '<strong>$1</strong>')
    .replace(/_(.*?)_/g, '<em>$1</em>')
    .replace(/\`(.*?)\`/g, '<code>$1</code>')
    .replace(/\\n/g,'<br>').replace(/\n/g,'<br>');
  div.innerHTML = html + '<span class="bubble-time">' + ahora() + '</span>';
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

async function enviar() {
  const mensaje  = msgInput.value.trim();
  const telefono = phoneInput.value.trim() || 'TEST001';
  if (!mensaje) return;

  msgInput.value = '';
  msgInput.style.height = 'auto';
  sendBtn.disabled = true;
  agregarBurbuja(mensaje, 'user');

  // Mostrar indicador de escritura
  chat.appendChild(typing);
  typing.style.display = 'block';
  chat.scrollTop = chat.scrollHeight;
  statusLine.textContent = 'escribiendo…';

  try {
    const res = await fetch('/test/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telefono, mensaje }),
    });
    const data = await res.json();
    typing.style.display = 'none';

    if (!res.ok) {
      agregarBurbuja('❌ Error: ' + (data.error || res.status), 'bot');
    } else if (data.respuestas && data.respuestas.length) {
      data.respuestas.forEach(r => agregarBurbuja(r, 'bot'));
    } else {
      agregarBurbuja('(sin respuesta)', 'bot');
    }
  } catch (e) {
    typing.style.display = 'none';
    agregarBurbuja('❌ Error de red: ' + e.message, 'bot');
  }

  statusLine.textContent = 'Simulador de WhatsApp';
  sendBtn.disabled = false;
  msgInput.focus();
}

function resetChat() {
  // Cambiar a un nuevo número de teléfono aleatorio resetea la sesión del bot
  phoneInput.value = 'TEST' + Math.floor(Math.random() * 90000 + 10000);
  chat.innerHTML = '<div class="welcome">Nueva conversación iniciada. Escribí para empezar.</div>';
}
</script>
</body>
</html>`;
}
