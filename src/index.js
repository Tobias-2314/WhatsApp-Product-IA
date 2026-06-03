// ============================================================
// ENTRY POINT — INICIALIZA BAILEYS Y CONECTA TODO
// ============================================================

require('dotenv').config();

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');

const pino = require('pino');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const express = require('express');

const bot = require('./bot');
const db  = require('./db');
const restaurante = require('../config/restaurant');
const { crearAdminRouter } = require('./admin');
const { crearTestRouter }  = require('./test');

// ─── LOGGER ──────────────────────────────────────────────────

if (!fs.existsSync('./logs')) fs.mkdirSync('./logs');

const logger = pino(
  { level: process.env.LOG_LEVEL || 'info' },
  pino.multistream([
    { stream: process.stdout },
    { stream: pino.destination('./logs/bot.log') },
  ])
);

// ─── HEALTH CHECK (para Railway / Render) ────────────────────
// Devuelve 503 si WhatsApp o Sheets no están operativos,
// para que Railway/Render reinicie el proceso automáticamente.

const estadoServicio = {
  whatsapp: 'connecting', // 'ok' | 'connecting' | 'error'
  db:       'connecting', // 'ok' | 'error'
};

const PORT = process.env.PORT || 3000;
const app  = express();

app.get('/', (req, res) => {
  const ok = estadoServicio.whatsapp === 'ok' && estadoServicio.db === 'ok';
  res.status(ok ? 200 : 503).json(estadoServicio);
});

app.use('/admin', crearAdminRouter());
app.use('/test',  crearTestRouter());

app.listen(PORT, '0.0.0.0', () => logger.info(`🔍 Health check en :${PORT} · Panel admin en /admin · Simulador en /test`));

// ─── UTILIDADES ──────────────────────────────────────────────

// Enmascara un número de teléfono para logs: muestra solo los últimos 4 dígitos.
// Evita exponer PII en logs de stdout y archivos de log.
const maskTel = tel => `****${String(tel).slice(-4)}`;

// ─── RATE LIMITING ───────────────────────────────────────────
// Máximo de mensajes por usuario por ventana de tiempo.

const RATE_MAX       = parseInt(process.env.RATE_MAX, 10)       || 10;
const RATE_VENTANA   = parseInt(process.env.RATE_VENTANA_MS, 10) || 60_000;
const _rateLimiter   = new Map(); // telefono → { count, windowStart }

function estaLimitado(telefono) {
  const ahora   = Date.now();
  const entrada = _rateLimiter.get(telefono);

  if (!entrada || ahora - entrada.windowStart > RATE_VENTANA) {
    _rateLimiter.set(telefono, { count: 1, windowStart: ahora });
    return false;
  }
  if (entrada.count >= RATE_MAX) return true;
  entrada.count++;
  return false;
}

// Limpia entradas expiradas cada 5 minutos para no acumular memoria
setInterval(() => {
  const ahora = Date.now();
  for (const [tel, e] of _rateLimiter.entries()) {
    if (ahora - e.windowStart > RATE_VENTANA) _rateLimiter.delete(tel);
  }
}, 5 * 60_000);

// ─── BOT ──────────────────────────────────────────────────────

let intentosReconexion = 0;
const MAX_RECONEXIONES = 5;
const MAX_REINTENTOS   = 3;

// ─── RECORDATORIOS AUTOMÁTICOS ───────────────────────────────
// Envía un mensaje 24 horas antes de cada reserva confirmada.
// Usa un Set en memoria para no duplicar si el bot sigue corriendo.
// (En un reinicio se puede re-enviar el recordatorio — riesgo aceptable.)

const _recordatoriosEnviados = new Set();

async function enviarRecordatorios(sock) {
  try {
    const reservas = await db.obtenerReservasProximas(24);
    for (const reserva of reservas) {
      if (_recordatoriosEnviados.has(reserva.id)) continue;

      await sock.sendMessage(`${reserva.telefono}@s.whatsapp.net`, {
        text:
          `🍽️ *¡Recordatorio de reserva!*\n\n` +
          `Hola ${reserva.nombre}! Te recordamos que mañana tenés una reserva en *${restaurante.nombre}*:\n\n` +
          `  • 📅 Fecha: ${reserva.fecha}\n` +
          `  • 🕐 Hora: ${reserva.hora}\n` +
          `  • 👥 Personas: ${reserva.personas}\n\n` +
          `Si necesitás cancelar o modificar tu reserva, escribinos. ¡Te esperamos! 😊`,
      });

      _recordatoriosEnviados.add(reserva.id);
      logger.info(`📅 Recordatorio enviado a ${maskTel(reserva.telefono)} — reserva ${reserva.id}`);
    }
  } catch (error) {
    logger.error(`❌ Error en scheduler de recordatorios: ${error.message}`);
  }
}

// Reintenta procesarMensaje hasta MAX_REINTENTOS veces con backoff lineal.
// Si todos los intentos fallan, envía un mensaje de disculpa al usuario
// para que sepa que debe volver a escribir — evita el descarte silencioso.
async function procesarConReintentos(sock, telefono, contenido) {
  for (let intento = 1; intento <= MAX_REINTENTOS; intento++) {
    try {
      await bot.procesarMensaje(telefono, contenido);
      return;
    } catch (error) {
      logger.error(`❌ Intento ${intento}/${MAX_REINTENTOS} fallido [${maskTel(telefono)}]: ${error.message}`);
      if (intento < MAX_REINTENTOS) {
        await new Promise(r => setTimeout(r, intento * 2000)); // 2 s, 4 s
      }
    }
  }

  logger.error(`💀 Mensaje de ${maskTel(telefono)} descartado tras ${MAX_REINTENTOS} reintentos`);
  try {
    await sock.sendMessage(`${telefono}@s.whatsapp.net`, {
      text: 'Disculpá, tuve un problema técnico. Por favor, escribime de nuevo en un momento. 🙏',
    });
  } catch { /* si el envío también falla, no hay nada más que hacer */ }
}

async function iniciarBot() {
  // 1. Inicializar base de datos
  logger.info('🔄 Conectando con PostgreSQL...');
  await db.inicializar();
  estadoServicio.db = 'ok';
  logger.info('✅ Base de datos lista');

  // 2. Cargar estado de autenticación de WhatsApp
  const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
  const { version } = await fetchLatestBaileysVersion();
  logger.info(`📦 Usando Baileys versión ${version.join('.')}`);

  // 3. Crear socket de WhatsApp
  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }), // Suprimir logs internos de Baileys
    browser: Browsers.macOS('Chrome'),
    printQRInTerminal: false,
    connectTimeoutMs: 30_000,
    keepAliveIntervalMs: 10_000,
  });

  // 4. Inyectar función enviadora en el bot
  bot.setEnviadorMensajes(async (telefono, mensaje) => {
    const jid = telefono.includes('@') ? telefono : `${telefono}@s.whatsapp.net`;
    try {
      await sock.sendMessage(jid, { text: mensaje });
    } catch (err) {
      logger.error(`❌ Error enviando mensaje a ${telefono}: ${err.message}`);
    }
  });

  // ─── EVENTOS DE CONEXIÓN ────────────────────────────────────

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n' + '═'.repeat(60));
      console.log('📱 Escaneá este código QR con WhatsApp:');
      console.log('   (WhatsApp → Dispositivos vinculados → Vincular dispositivo)');
      console.log('═'.repeat(60) + '\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'open') {
      intentosReconexion = 0;
      estadoServicio.whatsapp = 'ok';
      logger.info('✅ ¡Bot conectado a WhatsApp exitosamente!');

      // Arrancar el scheduler de recordatorios solo la primera vez que conecta
      if (!sock._recordatoriosActivos) {
        sock._recordatoriosActivos = true;
        setInterval(() => enviarRecordatorios(sock), 15 * 60_000);
        logger.info('⏰ Scheduler de recordatorios activo (cada 15 min)');
      }
    }

    if (connection === 'close') {
      estadoServicio.whatsapp = 'error';
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const razon = DisconnectReason[statusCode] || statusCode;
      logger.warn(`❌ Conexión cerrada. Razón: ${razon}`);

      const fueDeslogueado = statusCode === DisconnectReason.loggedOut;

      if (fueDeslogueado) {
        logger.error('🚪 Sesión cerrada manualmente. Eliminá la carpeta ./auth_info y volvé a escanear el QR.');
        process.exit(1);
      }

      if (intentosReconexion < MAX_RECONEXIONES) {
        intentosReconexion++;
        const demora = Math.min(intentosReconexion * 3000, 15000);
        logger.info(`🔄 Reconectando en ${demora / 1000}s... (intento ${intentosReconexion}/${MAX_RECONEXIONES})`);
        setTimeout(iniciarBot, demora);
      } else {
        logger.error('💀 Demasiados intentos de reconexión. Reiniciá el proceso manualmente.');
        process.exit(1);
      }
    }
  });

  // Persistir credenciales cada vez que cambian
  sock.ev.on('creds.update', saveCreds);

  // ─── PROCESAMIENTO DE MENSAJES ──────────────────────────────

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    // Solo procesar mensajes nuevos entrantes
    if (type !== 'notify') return;

    for (const msg of messages) {
      // Ignorar: mensajes propios, grupos, broadcasts
      if (msg.key.fromMe) continue;
      if (msg.key.remoteJid.endsWith('@g.us')) continue;
      if (msg.key.remoteJid === 'status@broadcast') continue;

      const telefono = msg.key.remoteJid.replace('@s.whatsapp.net', '');

      // Extraer texto del mensaje (soporta texto plano y texto extendido)
      const contenido = (
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        ''
      ).trim();

      if (!contenido) continue;

      // Rate limiting: ignorar si el usuario excedió el límite de mensajes
      if (estaLimitado(telefono)) {
        logger.warn(`⚠️ Rate limit alcanzado para ${maskTel(telefono)} — mensaje ignorado`);
        continue;
      }

      // Loguear solo suficiente para debuggear: número enmascarado + primeros 40 chars del mensaje
      logger.info(`📨 [${maskTel(telefono)}]: ${contenido.substring(0, 40)}${contenido.length > 40 ? '…' : ''}`);

      try {
        await sock.readMessages([msg.key]);
        await procesarConReintentos(sock, telefono, contenido);
      } catch (error) {
        logger.error(`❌ Error inesperado con ${maskTel(telefono)}: ${error.message}`);
        logger.error(error.stack);
      }
    }
  });
}

// ─── INICIO ───────────────────────────────────────────────────

console.log('');
console.log('╔══════════════════════════════════════════════╗');
console.log('║   🍽️  WhatsApp Bot de Reservas                ║');
console.log('║   Versión 1.0.0 — Listo para producción      ║');
console.log('╚══════════════════════════════════════════════╝');
console.log('');

iniciarBot().catch((err) => {
  logger.error('💥 Error fatal al iniciar:', err);
  process.exit(1);
});
