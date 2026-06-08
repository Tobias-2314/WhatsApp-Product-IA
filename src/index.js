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
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const bot = require('./bot');
const db  = require('./db');
const configManager = require('./configManager');
const { t } = require('./i18n');
const { crearAdminRouter } = require('./admin');
const { crearTestRouter }  = require('./test');
const sessionManager           = require('./sessions/sessionManager');
const { procesarComandoStaff } = require('./staffCommands');

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
const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

app.get('/', (req, res) => {
  const ok = estadoServicio.whatsapp === 'ok' && estadoServicio.db === 'ok';
  res.status(ok ? 200 : 503).json(estadoServicio);
});

app.use('/img',   express.static(path.join(__dirname, '../img')));
app.use('/admin', crearAdminRouter(io, configManager));
app.use('/test',  crearTestRouter());

httpServer.listen(PORT, '0.0.0.0', () => logger.info(`🔍 Health check en :${PORT} · Panel admin en /admin · Simulador en /test`));

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
// Scheduler 1 (24h antes): pide confirmación de asistencia.
// Scheduler 2 (2h antes): aviso final solo a quienes confirmaron.
// El estado de envío se persiste en DB (confirmacion_enviada, aviso_2h_enviado)
// para evitar reenvíos si el proceso reinicia.

async function enviarConfirmaciones(sock) {
  try {
    const reservas = await db.obtenerReservasProximas(24, 1);
    for (const reserva of reservas) {
      const _cfg = configManager.get();
      await sock.sendMessage(`${reserva.telefono}@s.whatsapp.net`, {
        text: t(_cfg.idioma || 'es', 'recordatorio24h', reserva.nombre, {
          restaurante: _cfg.nombre,
          fecha: reserva.fecha,
          hora: reserva.hora,
          personas: reserva.personas,
        }),
      });
      await db.marcarConfirmacionEnviada(reserva.id).catch(() => {});
      logger.info(`📅 Confirmación enviada a ${maskTel(reserva.telefono)} — reserva ${reserva.id}`);
    }
  } catch (error) {
    logger.error(`❌ Error en scheduler de confirmaciones: ${error.message}`);
  }
}

async function enviarAvisosFinal(sock) {
  try {
    const reservas = await db.obtenerReservasProximas(2, 0.5, { soloConConfirmacion: true });
    for (const reserva of reservas) {
      const _cfg = configManager.get();
      await sock.sendMessage(`${reserva.telefono}@s.whatsapp.net`, {
        text: t(_cfg.idioma || 'es', 'aviso2h', {
          restaurante: _cfg.nombre,
          nombre: reserva.nombre,
          hora: reserva.hora,
        }),
      });
      await db.marcarAviso2hEnviado(reserva.id).catch(() => {});
      logger.info(`⏰ Aviso final enviado a ${maskTel(reserva.telefono)} — reserva ${reserva.id}`);
    }
  } catch (error) {
    logger.error(`❌ Error en scheduler de avisos finales: ${error.message}`);
  }
}

async function enviarEncuestas(sock) {
  try {
    const cfg = configManager.get();
    const reservas = await db.obtenerReservasParaEncuesta();
    for (const reserva of reservas) {
      const idioma = cfg.idioma || 'es';
      await sock.sendMessage(`${reserva.telefono}@s.whatsapp.net`, {
        text: t(idioma, 'encuesta', reserva.nombre, cfg.nombre),
      });
      await db.marcarEncuestaEnviada(reserva.id).catch(() => {});
      // Marcar sesión en estado encuesta para capturar la respuesta
      try {
        const sesion = await sessionManager.obtenerOCrearSesion(reserva.telefono);
        sesion.estado = 'encuesta';
        sesion.encuestaReservaId = reserva.id;
        await sessionManager.actualizarSesion(reserva.telefono, sesion);
      } catch { /* no crítico */ }
      logger.info(`⭐ Encuesta enviada a ${maskTel(reserva.telefono)} — reserva ${reserva.id}`);
    }
  } catch (error) {
    logger.error(`❌ Error en scheduler de encuestas: ${error.message}`);
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

  // 1b. Inicializar config dinámica (merge DB + restaurant.js)
  const { pool } = require('./db');
  configManager.setPool(pool);
  await configManager.init();
  logger.info('✅ Configuración dinámica cargada');

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

  bot.setEnviadorMedia(async (telefono, { tipo, valor, caption }) => {
    const jid = telefono.includes('@') ? telefono : `${telefono}@s.whatsapp.net`;
    try {
      const esUrl = /^https?:\/\//i.test(valor);
      const src = esUrl ? { url: valor } : fs.readFileSync(path.resolve(__dirname, '..', valor));

      if (tipo === 'imagen') {
        await sock.sendMessage(jid, { image: src, caption: caption || '' });
      } else if (tipo === 'pdf') {
        await sock.sendMessage(jid, {
          document: src,
          mimetype: 'application/pdf',
          fileName: 'menu.pdf',
          caption: caption || '',
        });
      } else if (tipo === 'url') {
        await sock.sendMessage(jid, { text: valor });
      }
    } catch (err) {
      logger.error(`❌ Error enviando media a ${telefono}: ${err.message}`);
      // Fallback: enviar el menú en texto plano
      try {
        await sock.sendMessage(jid, { text: configManager.get().menu });
      } catch { /* nada más que hacer */ }
    }
  });

  bot.setEnviadorInteractivo(async (telefono, payload) => {
    const jid = telefono.includes('@') ? telefono : `${telefono}@s.whatsapp.net`;
    try {
      await sock.sendMessage(jid, payload);
    } catch (err) {
      logger.error(`❌ Error enviando mensaje interactivo a ${telefono}: ${err.message}`);
    }
  });

  // 5. Registrar hook de socket.io para cambios de reserva
  bot.onReservaChange((tipo, datos) => io.emit(`reserva:${tipo}`, datos));

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

      // Arrancar schedulers solo la primera vez que conecta
      if (!sock._schedulersActivos) {
        sock._schedulersActivos = true;
        setInterval(() => enviarConfirmaciones(sock), 15 * 60_000);
        setInterval(() => enviarAvisosFinal(sock),    15 * 60_000);
        setInterval(() => enviarEncuestas(sock),      15 * 60_000);
        logger.info('⏰ Schedulers de recordatorios activos (cada 15 min)');
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

      // Extraer texto del mensaje (soporta texto plano, texto extendido y respuestas de lista)
      const contenido = (
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.listResponseMessage?.title ||
        ''
      ).trim();

      if (!contenido) continue;

      // Modo mantenimiento: responder con mensaje y no procesar
      if (configManager.isMantenimiento()) {
        const msgMant = configManager.getMensajeMantenimiento()
          || 'Estamos temporalmente cerrados. ¡Volvemos pronto!';
        await sock.sendMessage(`${telefono}@s.whatsapp.net`, { text: msgMant });
        continue;
      }

      // Staff: comandos directos sin pasar por el bot de reservas
      if (configManager.get().telefonosStaff?.includes(telefono)) {
        logger.info(`👷 [${maskTel(telefono)}] comando staff: ${contenido.substring(0, 40)}`);
        procesarComandoStaff(sock, telefono, contenido).catch(err =>
          logger.error(`❌ Error en comando staff: ${err.message}`)
        );
        continue;
      }

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
  logger.error({ err }, '💥 Error fatal al iniciar');
  console.error(err);
  process.exit(1);
});
