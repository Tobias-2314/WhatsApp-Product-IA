// ============================================================
// COMANDOS DE STAFF — handler para números autorizados
// ============================================================

const db            = require('./db');
const configManager = require('./configManager');

const AYUDA = `📋 *Comandos disponibles:*

• \`reservas hoy\` — reservas del día
• \`reservas DD/MM\` — reservas de una fecha
• \`cancelar <ID>\` — cancela reserva por ID
• \`bloquear DD/MM/YYYY [motivo]\` — bloquea una fecha
• \`desbloquear <ID>\` — desbloquea una fecha por ID
• \`fechas bloqueadas\` — lista fechas bloqueadas
• \`disponibilidad DD/MM/YYYY\` — franjas disponibles
• \`stats\` — resumen de hoy
• \`mantenimiento on [mensaje]\` — activa modo mantenimiento
• \`mantenimiento off\` — desactiva modo mantenimiento`;

function fechaAR(offsetDias = 0) {
  const base = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }));
  base.setDate(base.getDate() + offsetDias);
  return `${String(base.getDate()).padStart(2,'0')}/${String(base.getMonth()+1).padStart(2,'0')}/${base.getFullYear()}`;
}

function normalizarFecha(str) {
  // Acepta DD/MM, DD/MM/YYYY
  if (!str) return null;
  const partes = str.split('/');
  if (partes.length === 2) {
    const anio = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' })).getFullYear();
    return `${partes[0].padStart(2,'0')}/${partes[1].padStart(2,'0')}/${anio}`;
  }
  if (partes.length === 3) return `${partes[0].padStart(2,'0')}/${partes[1].padStart(2,'0')}/${partes[2]}`;
  return null;
}

async function procesarComandoStaff(sock, telefono, texto) {
  const jid = `${telefono}@s.whatsapp.net`;
  const cmd = texto.toLowerCase().trim();
  const cfg = configManager.get();

  async function responder(msg) {
    await sock.sendMessage(jid, { text: msg });
  }

  try {
    // reservas hoy
    if (cmd === 'reservas hoy') {
      const fecha = fechaAR(0);
      const reservas = await db.obtenerReservasPorFecha(fecha);
      const confirmadas = reservas.filter(r => r.estado === 'confirmada');
      if (!confirmadas.length) return responder(`📅 No hay reservas confirmadas para hoy (${fecha}).`);
      const lista = confirmadas.map(r =>
        `• ${r.hora} — ${r.nombre} (${r.personas} pers.) | ID: \`${r.id}\``
      ).join('\n');
      return responder(`📅 *Reservas del ${fecha}:*\n\n${lista}\n\nTotal: ${confirmadas.length}`);
    }

    // reservas DD/MM o DD/MM/YYYY
    if (cmd.startsWith('reservas ')) {
      const fechaStr = normalizarFecha(cmd.replace('reservas ', '').trim());
      if (!fechaStr) return responder(`❌ Fecha inválida. Usá \`reservas DD/MM\` o \`reservas DD/MM/YYYY\``);
      const reservas = await db.obtenerReservasPorFecha(fechaStr);
      const confirmadas = reservas.filter(r => r.estado === 'confirmada');
      if (!confirmadas.length) return responder(`📅 No hay reservas confirmadas para el ${fechaStr}.`);
      const lista = confirmadas.map(r =>
        `• ${r.hora} — ${r.nombre} (${r.personas} pers.) | ID: \`${r.id}\``
      ).join('\n');
      return responder(`📅 *Reservas del ${fechaStr}:*\n\n${lista}\n\nTotal: ${confirmadas.length}`);
    }

    // cancelar <ID>
    if (cmd.startsWith('cancelar ')) {
      const id = texto.replace(/cancelar\s+/i, '').trim().toUpperCase();
      if (!id) return responder(`❌ Indicá el ID. Ej: \`cancelar R3KX2A\``);
      const cancelada = await db.cancelarReservaPorId(id);
      if (!cancelada) return responder(`❌ No encontré la reserva \`${id}\` o ya estaba cancelada.`);
      return responder(`✅ Reserva \`${cancelada.id}\` cancelada.\n${cancelada.nombre} — ${cancelada.fecha} ${cancelada.hora}`);
    }

    // bloquear DD/MM/YYYY [motivo]
    if (cmd.startsWith('bloquear ')) {
      const partes = texto.replace(/bloquear\s+/i, '').trim().split(/\s+/);
      const fechaStr = normalizarFecha(partes[0]);
      if (!fechaStr) return responder(`❌ Fecha inválida. Usá \`bloquear DD/MM/YYYY motivo\``);
      const motivo = partes.slice(1).join(' ') || null;
      const bloq = await db.bloquearFecha(fechaStr, motivo);
      return responder(`🔒 Fecha *${fechaStr}* bloqueada${motivo ? ' — ' + motivo : ''}. ID: \`${bloq.id}\``);
    }

    // desbloquear <ID>
    if (cmd.startsWith('desbloquear ')) {
      const id = parseInt(texto.replace(/desbloquear\s+/i, '').trim(), 10);
      if (isNaN(id)) return responder(`❌ Indicá el ID numérico. Ej: \`desbloquear 3\``);
      await db.desbloquearFecha(id);
      return responder(`🔓 Fecha desbloqueada (ID ${id}).`);
    }

    // fechas bloqueadas
    if (cmd === 'fechas bloqueadas' || cmd === 'bloqueadas') {
      const lista = await db.listarFechasBloqueadas();
      if (!lista.length) return responder(`✅ No hay fechas bloqueadas.`);
      const texto2 = lista.map(f => `• ${f.fecha}${f.motivo ? ' — ' + f.motivo : ''} (ID: ${f.id})`).join('\n');
      return responder(`🔒 *Fechas bloqueadas:*\n\n${texto2}`);
    }

    // disponibilidad DD/MM/YYYY
    if (cmd.startsWith('disponibilidad ')) {
      const fechaStr = normalizarFecha(cmd.replace('disponibilidad ', '').trim());
      if (!fechaStr) return responder(`❌ Fecha inválida. Usá \`disponibilidad DD/MM/YYYY\``);
      const franjas = await db.obtenerFranjasDisponibles(fechaStr, cfg.franjasHorarias, 1);
      if (!franjas.length) return responder(`❌ Sin disponibilidad para el ${fechaStr}.`);
      const lista = franjas.map(f => `• ${f.hora}`).join('\n');
      return responder(`✅ *Disponibilidad el ${fechaStr}:*\n\n${lista}`);
    }

    // stats
    if (cmd === 'stats') {
      const hoy = fechaAR(0);
      const stats = await db.obtenerStatsHoy(hoy);
      return responder(
        `📊 *Stats de hoy (${hoy}):*\n\n` +
        `  • ✅ Confirmadas: ${stats.confirmadas}\n` +
        `  • 👥 Personas: ${stats.personas}\n` +
        `  • ❌ Canceladas: ${stats.canceladas}\n` +
        `  • ⚠️ No-shows: ${stats.no_shows}`
      );
    }

    // mantenimiento on [mensaje]
    if (cmd.startsWith('mantenimiento on') || cmd.startsWith('mantenimiento activar')) {
      const msg = texto.replace(/mantenimiento\s+(on|activar)\s*/i, '').trim() || null;
      configManager.setMantenimiento(true, msg);
      return responder(`🔧 Modo mantenimiento *activado*${msg ? `\nMensaje: "${msg}"` : ''}`);
    }

    // mantenimiento off
    if (cmd === 'mantenimiento off' || cmd === 'mantenimiento desactivar') {
      configManager.setMantenimiento(false);
      return responder(`✅ Modo mantenimiento *desactivado*. El bot vuelve a recibir reservas.`);
    }

    // ayuda (default)
    return responder(AYUDA);

  } catch (err) {
    console.error('❌ Error en comando staff:', err.message);
    await responder(`❌ Error procesando el comando: ${err.message}`);
  }
}

module.exports = { procesarComandoStaff };
