// ============================================================
// LÓGICA PRINCIPAL DEL BOT
// ============================================================

const sessionManager = require('./sessions/sessionManager');
const ai = require('./ai');
const sheets = require('./db');
const configManager = require('./configManager');
const { t } = require('./i18n');

class Bot {
  constructor() {
    this._enviadorMensajes    = null;
    this._enviadorMedia       = null;
    this._enviadorInteractivo = null;
    this._onEnvio             = null;
    this._onEnvioMedia        = null;
    this._onReservaChange     = null;
    this._locks               = new Map();
  }

  _conLock(key, fn) {
    const prevLock = this._locks.get(key) ?? Promise.resolve();
    let release;
    const lockPromise = new Promise(resolve => { release = resolve; });
    this._locks.set(key, lockPromise);
    return prevLock
      .then(() => fn(), () => fn())
      .finally(() => release());
  }

  setEnviadorMensajes(fn)      { this._enviadorMensajes = fn; }
  setEnviadorMedia(fn)         { this._enviadorMedia = fn; }
  setEnviadorInteractivo(fn)   { this._enviadorInteractivo = fn; }
  onEnvio(fn)                  { this._onEnvio = fn; }
  onEnvioMedia(fn)             { this._onEnvioMedia = fn; }
  onReservaChange(fn)          { this._onReservaChange = fn; }

  async _enviar(telefono, mensaje) {
    if (this._enviadorMensajes) await this._enviadorMensajes(telefono, mensaje);
    if (this._onEnvio) this._onEnvio(telefono, mensaje);
  }

  async _enviarMedia(telefono, mediaConfig) {
    if (this._enviadorMedia) await this._enviadorMedia(telefono, mediaConfig);
    if (this._onEnvioMedia) this._onEnvioMedia(telefono, mediaConfig);
  }

  async _notificarAdmin(mensaje) {
    const cfg = configManager.get();
    if (!cfg.telefonoAdmin) return;
    await this._enviar(cfg.telefonoAdmin, mensaje);
  }

  // ─── PROCESAMIENTO PRINCIPAL ──────────────────────────────

  procesarMensaje(telefono, mensaje) {
    return this._conLock(`tel:${telefono}`, () => this._procesarMensajeInterno(telefono, mensaje));
  }

  async _procesarMensajeInterno(telefono, mensaje) {
    let sesion = await sessionManager.obtenerOCrearSesion(telefono);

    if (sesion.modoHumano) {
      console.log(`👤 [****${telefono.slice(-4)}] en modo humano — mensaje no procesado por bot`);
      return;
    }

    // Encuesta post-visita: capturar puntuación antes de pasar a la IA
    if (sesion.estado === 'encuesta') {
      const msg = await this._procesarRespuestaEncuesta(sesion, mensaje);
      await sessionManager.actualizarSesion(telefono, sesion);
      await this._enviar(telefono, msg);
      return;
    }

    // Pre-cargar nombre del cliente conocido en la sesión nueva
    if (sesion.estado === 'inicio' && !sesion.historialConversacion.length && !sesion.reservaPendiente.nombre) {
      try {
        const cliente = await sheets.obtenerCliente(telefono);
        if (cliente?.nombre_usual) sesion.reservaPendiente.nombre = cliente.nombre_usual;
      } catch { /* no crítico */ }
    }

    sesion.historialConversacion.push({ rol: 'usuario', contenido: mensaje });

    let franjasDisponibles = null;
    if (sesion.reservaPendiente.fecha && sesion.estado === 'recolectando') {
      const personas = sesion.reservaPendiente.personas || 1;
      franjasDisponibles = await this._obtenerDisponibilidadSegura(sesion.reservaPendiente.fecha, personas);
    }

    const respuestaAI = await ai.procesarMensaje(sesion, mensaje, franjasDisponibles);

    if (respuestaAI.extractedData) {
      const { nombre, fecha, hora, personas } = respuestaAI.extractedData;

      const cfg = configManager.get();
      if (respuestaAI.action === 'modify_reservation') {
        if (!sesion.modificacion) sesion.modificacion = { fecha: null, hora: null, personas: null };
        if (fecha && await this._esFechaValida(fecha)) sesion.modificacion.fecha = fecha;
        if (hora) {
          const horaFranja = this._normalizarHora(hora);
          if (horaFranja) sesion.modificacion.hora = horaFranja;
        }
        if (personas) {
          const p = parseInt(personas, 10);
          if (!isNaN(p) && p >= 1 && p <= cfg.maximoPersonasPorReserva) {
            sesion.modificacion.personas = p;
          }
        }
      } else {
        if (nombre) sesion.reservaPendiente.nombre = nombre;
        if (fecha && await this._esFechaValida(fecha)) sesion.reservaPendiente.fecha = fecha;
        if (hora) {
          const horaFranja = this._normalizarHora(hora);
          if (horaFranja) sesion.reservaPendiente.hora = horaFranja;
        }
        if (personas) {
          const p = parseInt(personas, 10);
          if (!isNaN(p) && p >= 1 && p <= cfg.maximoPersonasPorReserva) {
            sesion.reservaPendiente.personas = p;
          }
        }
      }
    }

    if (respuestaAI.estado) sesion.estado = respuestaAI.estado;

    const mensajeExtra = await this._ejecutarAccion(respuestaAI.action, sesion);

    sesion.historialConversacion.push({ rol: 'bot', contenido: respuestaAI.response });
    if (sesion.historialConversacion.length > 20) {
      sesion.historialConversacion = sesion.historialConversacion.slice(-20);
    }

    await sessionManager.actualizarSesion(telefono, sesion);

    await this._enviar(telefono, respuestaAI.response);

    if (mensajeExtra) {
      await this._enviar(telefono, mensajeExtra);
    }

    // En el primer intercambio de una sesión nueva, ofrecer menú interactivo
    if (sesion.historialConversacion.length === 2) {
      this._enviarListaMenu(telefono).catch(() => {});
    }
  }

  // ─── ACCIONES ─────────────────────────────────────────────

  async _ejecutarAccion(action, sesion) {
    switch (action) {
      case 'save_reservation':   return await this._guardarReserva(sesion);
      case 'cancel_reservation': return await this._cancelarReserva(sesion);
      case 'modify_reservation': return await this._modificarReserva(sesion);
      case 'check_availability': return await this._verificarDisponibilidad(sesion);
      case 'add_waitlist':       return await this._agregarListaEspera(sesion);
      case 'show_menu': {
        const cfg = configManager.get();
        const m = cfg.menuMedia;
        if (m?.tipo && m?.valor) {
          await this._enviarMedia(sesion.telefono, m);
          return null;
        }
        return cfg.menu;
      }
      case 'show_reservations': return await this._mostrarReservas(sesion);
      case 'transfer_human':    sesion.modoHumano = true; return null;
      default:                  return null;
    }
  }

  async _guardarReserva(sesion) {
    const { nombre, fecha, hora, personas } = sesion.reservaPendiente;
    if (!nombre || !fecha || !hora || !personas) return null;

    try {
      const resultado = await sheets.guardarReservaAtomico({
        telefono: sesion.telefono, nombre, fecha, hora, personas,
      });

      if (!resultado) {
        sesion.estado = 'recolectando';
        sesion.reservaPendiente.hora = null;
        sesion.listaEsperaDisponible = { fecha, hora, personas, nombre };
        const _idioma = configManager.get().idioma || 'es';
        return `${t(_idioma, 'sinDisponibilidad', hora, fecha)}\n\n${t(_idioma, 'listaEspera')}`;
      }

      const { reserva, mesa } = resultado;

      sheets.upsertCliente({ telefono: sesion.telefono, nombre, fecha }).catch(e => console.error('⚠️ upsertCliente:', e.message));

      sesion.reservaPendiente = { nombre: null, fecha: null, hora: null, personas: null };
      sesion.listaEsperaDisponible = null;
      sesion.estado = 'completado';

      this._notificarAdmin(`🆕 *Nueva reserva*\n${nombre} — ${fecha} ${hora} — ${personas} pers.\nID: ${reserva.id}`).catch(e => console.error('⚠️ notificarAdmin:', e.message));
      if (this._onReservaChange) this._onReservaChange('nueva', { ...reserva, mesa_nombre: mesa.nombre });

      const combinada = mesa.ids.length > 1;
      const _cfg = configManager.get();
      return t(_cfg.idioma || 'es', 'reservaConfirmada', {
        id: reserva.id, nombre, fecha, hora,
        hora_fin: reserva.hora_fin, personas,
        mesa: `${mesa.nombre}${combinada ? ' _(mesas combinadas)_' : ''}`,
        restaurante: _cfg.nombre,
      });

    } catch (error) {
      console.error('❌ Error guardando reserva:', error);
      const _cfg2 = configManager.get();
      return t(_cfg2.idioma || 'es', 'errorTecnico', _cfg2.telefono);
    }
  }

  async _cancelarReserva(sesion) {
    try {
      // Obtener reserva ANTES de cancelar para poder validar sin efectos secundarios
      const reserva = await sheets.obtenerReservaActiva(sesion.telefono);

      if (!reserva) {
        return `No encontré ninguna reserva activa para tu número. ¿Tenés el ID de la reserva? Escribímelo y lo busco.`;
      }

      const fechaReserva = this._parsearFechaAR(reserva.fecha);
      if (fechaReserva) {
        const cfg = configManager.get();
        const [hh, mm] = (reserva.hora || '00:00').split(':').map(Number);
        fechaReserva.setHours(hh, mm, 0, 0);
        const horasRestantes = (fechaReserva - new Date()) / 3_600_000;
        if (horasRestantes < cfg.horasMinimaCancelacion) {
          return (
            `❌ No podés cancelar con menos de ${cfg.horasMinimaCancelacion} horas de anticipación.\n` +
            `Para casos urgentes, llamá al ${cfg.telefono}.`
          );
        }
      }

      // Validación pasada — cancelar por ID para garantizar que es la reserva correcta
      const cancelada = await sheets.cancelarReserva(sesion.telefono, reserva.id);
      if (!cancelada) {
        return `No pude cancelar la reserva. Es posible que ya haya sido cancelada. Escribime el ID y lo verifico.`;
      }

      sesion.estado = 'inicio';

      this._notificarAdmin(`❌ *Cancelación*\n${cancelada.nombre} — ${cancelada.fecha} ${cancelada.hora}`).catch(e => console.error('⚠️ notificarAdmin:', e.message));
      if (this._onReservaChange) this._onReservaChange('cancelada', cancelada);

      try {
        const enEspera = await sheets.obtenerPrimeraListaEspera(cancelada.fecha, cancelada.hora, cancelada.personas);
        if (enEspera) {
          await sheets.marcarListaEsperaNotificada(enEspera.id);
          const _idioma = configManager.get().idioma || 'es';
          await this._enviar(enEspera.telefono,
            t(_idioma, 'esperaLiberada', { nombre: enEspera.nombre, fecha: cancelada.fecha, hora: cancelada.hora })
          );
        }
      } catch { /* no crítico */ }

      return (
        `✅ Tu reserva del *${cancelada.fecha}* a las *${cancelada.hora}* fue cancelada exitosamente.\n` +
        `Si querés hacer una nueva reserva, decime y te ayudo. 😊`
      );

    } catch (error) {
      console.error('❌ Error cancelando reserva:', error);
      const _cfg = configManager.get();
      return t(_cfg.idioma || 'es', 'errorTecnico', _cfg.telefono);
    }
  }

  async _mostrarReservas(sesion) {
    try {
      const reservas = await sheets.obtenerReservasPorTelefono(sesion.telefono);

      if (reservas.length === 0) {
        return `No encontré reservas activas para tu número. ¿Querés hacer una nueva?`;
      }

      const lista = reservas
        .map(r =>
          `📅 *${r.fecha}* a las *${r.hora}* – ${r.hora_fin} hs\n` +
          `   👤 ${r.nombre}  —  👥 ${r.personas} personas\n` +
          `   🔖 ID: \`${r.id}\``
        )
        .join('\n\n');

      return `📋 *Tus reservas activas:*\n\n${lista}`;

    } catch (error) {
      console.error('❌ Error consultando reservas:', error);
      return `Hubo un error al consultar las reservas. Intentá de nuevo en un momento.`;
    }
  }

  async _modificarReserva(sesion) {
    const mod = sesion.modificacion || {};
    const { fecha, hora, personas } = mod;
    if (!fecha && !hora && !personas) return null;

    try {
      const actual = await sheets.obtenerReservaActiva(sesion.telefono);
      if (!actual) {
        return `No encontré una reserva activa para modificar. ¿Querés hacer una nueva reserva?`;
      }

      const nuevaFecha     = fecha    || actual.fecha;
      const nuevaHora      = hora     || actual.hora;
      const nuevasPersonas = personas || actual.personas;

      return this._aplicarModificacion(sesion, actual, nuevaFecha, nuevaHora, nuevasPersonas);

    } catch (error) {
      console.error('❌ Error modificando reserva:', error);
      return `Hubo un problema al modificar la reserva. Por favor, llamá al ${configManager.get().telefono}.`;
    }
  }

  async _aplicarModificacion(sesion, actual, nuevaFecha, nuevaHora, nuevasPersonas) {
    const reserva = await sheets.modificarReserva(sesion.telefono, {
      fecha: nuevaFecha, hora: nuevaHora, personas: nuevasPersonas,
    });

    if (!reserva) return `No pude modificar la reserva. Por favor, intentá de nuevo.`;

    if (reserva.error === 'no_disponibilidad') {
      sesion.modificacion = null;
      return `❌ No hay disponibilidad para ${nuevasPersonas} personas el ${nuevaFecha} a las ${nuevaHora}. ¿Querés ver los horarios disponibles?`;
    }

    sesion.modificacion = null;
    sesion.estado = 'completado';

    this._notificarAdmin(`✏️ *Modificación*\n${reserva.nombre} — ${reserva.fecha} ${reserva.hora} — ${reserva.personas} pers.`).catch(e => console.error('⚠️ notificarAdmin:', e.message));
    if (this._onReservaChange) this._onReservaChange('modificada', reserva);

    return (
      `✅ *¡Reserva modificada exitosamente!*\n\n` +
      `📋 *Datos actualizados:*\n` +
      `  • 🔖 ID: \`${reserva.id}\`\n` +
      `  • 👤 Nombre: ${reserva.nombre}\n` +
      `  • 📅 Fecha: ${reserva.fecha}\n` +
      `  • 🕐 Horario: ${reserva.hora} – ${reserva.hora_fin} hs\n` +
      `  • 👥 Personas: ${reserva.personas}\n\n` +
      `¡Nos vemos pronto en ${configManager.get().nombre}! 🍽️`
    );
  }

  async _agregarListaEspera(sesion) {
    const datos = sesion.listaEsperaDisponible;
    if (!datos) return null;

    try {
      await sheets.agregarListaEspera({
        telefono: sesion.telefono,
        nombre:   datos.nombre,
        fecha:    datos.fecha,
        hora:     datos.hora,
        personas: datos.personas,
      });
      sesion.listaEsperaDisponible = null;
      sesion.estado = 'inicio';
      return (
        `✅ ¡Listo! Te anotamos en la lista de espera para el *${datos.fecha}* a las *${datos.hora}*.\n` +
        `Te avisamos apenas se libere una mesa. 🙏`
      );
    } catch (error) {
      console.error('❌ Error agregando lista de espera:', error);
      return `Hubo un problema al anotarte. Intentá de nuevo o llamá al ${configManager.get().telefono}.`;
    }
  }

  async _verificarDisponibilidad(sesion) {
    const fecha = sesion.reservaPendiente.fecha;
    if (!fecha) return null;

    const personas = sesion.reservaPendiente.personas || 1;
    const franjas  = await this._obtenerDisponibilidadSegura(fecha, personas);
    if (!franjas) return null;

    const descripcion = personas > 1 ? ` para ${personas} personas` : '';
    if (franjas.length === 0) {
      return `😔 No hay disponibilidad${descripcion} para el ${fecha}. ¿Querés intentar con otra fecha?`;
    }

    const lista = franjas.map(f => `  • ${f.hora}`).join('\n');
    return `✅ *Horarios disponibles${descripcion} el ${fecha}:*\n${lista}`;
  }

  // ─── HELPERS ──────────────────────────────────────────────

  async _enviarListaMenu(telefono) {
    if (!this._enviadorInteractivo) return;
    const cfg = configManager.get();
    await this._enviadorInteractivo(telefono, {
      text: '¿En qué te puedo ayudar?',
      footer: cfg.nombre,
      title: 'Menú principal',
      buttonText: 'Ver opciones',
      sections: [{
        title: 'Opciones',
        rows: [
          { title: '📅 Hacer una reserva',    rowId: 'reservar',     description: 'Reservar una mesa' },
          { title: '🔍 Ver mis reservas',     rowId: 'ver_reserva',  description: 'Consultar reservas activas' },
          { title: '❌ Cancelar reserva',     rowId: 'cancelar',     description: 'Cancelar una reserva' },
          { title: '📋 Ver el menú',          rowId: 'menu',         description: 'Ver la carta del restaurante' },
        ],
      }],
    });
  }

  async _procesarRespuestaEncuesta(sesion, mensaje) {
    const cfg      = configManager.get();
    const idioma   = cfg.idioma || 'es';
    const puntuacion = parseInt(mensaje.trim(), 10);

    if (isNaN(puntuacion) || puntuacion < 1 || puntuacion > 5) {
      return t(idioma, 'encuestaInvalida');
    }

    try {
      await sheets.guardarResena({
        reservaId: sesion.encuestaReservaId,
        telefono:  sesion.telefono,
        puntuacion,
      });
    } catch (e) {
      console.error('⚠️ guardarResena:', e.message);
    }

    sesion.estado           = 'inicio';
    sesion.encuestaReservaId = null;
    return t(idioma, 'encuestaGracias', puntuacion);
  }

  async _obtenerDisponibilidadSegura(fecha, personas = 1) {
    try {
      return await sheets.obtenerFranjasDisponibles(fecha, configManager.get().franjasHorarias, personas);
    } catch {
      return null;
    }
  }

  _parsearFechaAR(fechaStr) {
    if (!fechaStr || !/^\d{2}\/\d{2}\/\d{4}$/.test(fechaStr)) return null;
    const [dia, mes, anio] = fechaStr.split('/').map(Number);
    if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
    const fecha = new Date(anio, mes - 1, dia);
    if (fecha.getMonth() !== mes - 1 || fecha.getDate() !== dia) return null;
    return fecha;
  }

  async _esFechaValida(fechaStr) {
    const fecha = this._parsearFechaAR(fechaStr);
    if (!fecha) return false;
    const hoyAR = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }));
    hoyAR.setHours(0, 0, 0, 0);
    if (fecha < hoyAR) return false;
    const maxFecha = new Date(hoyAR);
    maxFecha.setDate(hoyAR.getDate() + configManager.get().diasMaximosAnticipacion);
    if (fecha > maxFecha) return false;
    try {
      if (await sheets.esFechaBloqueada(fechaStr)) return false;
    } catch { /* si falla DB, no bloquear */ }
    return true;
  }

  _normalizarHora(horaStr) {
    if (!horaStr || !/^\d{1,2}:\d{2}$/.test(horaStr)) return null;
    const franjasHorarias = configManager.get().franjasHorarias;
    if (franjasHorarias.includes(horaStr)) return horaStr;
    const [hh, mm] = horaStr.split(':').map(Number);
    if (isNaN(hh) || isNaN(mm)) return null;
    const minutos = hh * 60 + mm;
    let mejorFranja = null;
    let menorDif = Infinity;
    for (const franja of franjasHorarias) {
      const [fh, fm] = franja.split(':').map(Number);
      const dif = Math.abs(minutos - (fh * 60 + fm));
      if (dif < menorDif) { menorDif = dif; mejorFranja = franja; }
    }
    return menorDif <= 60 ? mejorFranja : null;
  }
}

module.exports = new Bot();
