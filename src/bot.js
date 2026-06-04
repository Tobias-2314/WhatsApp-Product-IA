// ============================================================
// LÓGICA PRINCIPAL DEL BOT
// ============================================================

const sessionManager = require('./sessions/sessionManager');
const ai = require('./ai');
const sheets = require('./db');
const restaurante = require('../config/restaurant');

class Bot {
  constructor() {
    this._enviadorMensajes  = null;
    this._enviadorMedia     = null;
    this._onEnvio           = null;
    this._onEnvioMedia      = null;
    this._onReservaChange   = null;
    this._locks             = new Map();
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

  setEnviadorMensajes(fn)  { this._enviadorMensajes = fn; }
  setEnviadorMedia(fn)     { this._enviadorMedia = fn; }
  onEnvio(fn)              { this._onEnvio = fn; }
  onEnvioMedia(fn)         { this._onEnvioMedia = fn; }
  onReservaChange(fn)      { this._onReservaChange = fn; }

  async _enviar(telefono, mensaje) {
    if (this._enviadorMensajes) await this._enviadorMensajes(telefono, mensaje);
    if (this._onEnvio) this._onEnvio(telefono, mensaje);
  }

  async _enviarMedia(telefono, mediaConfig) {
    if (this._enviadorMedia) await this._enviadorMedia(telefono, mediaConfig);
    if (this._onEnvioMedia) this._onEnvioMedia(telefono, mediaConfig);
  }

  async _notificarAdmin(mensaje) {
    if (!restaurante.telefonoAdmin) return;
    await this._enviar(restaurante.telefonoAdmin, mensaje);
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

      if (respuestaAI.action === 'modify_reservation') {
        if (!sesion.modificacion) sesion.modificacion = { fecha: null, hora: null, personas: null };
        if (fecha && this._esFechaValida(fecha)) sesion.modificacion.fecha = fecha;
        if (hora) {
          const horaFranja = this._normalizarHora(hora);
          if (horaFranja) sesion.modificacion.hora = horaFranja;
        }
        if (personas) {
          const p = parseInt(personas, 10);
          if (!isNaN(p) && p >= 1 && p <= restaurante.maximoPersonasPorReserva) {
            sesion.modificacion.personas = p;
          }
        }
      } else {
        if (nombre) sesion.reservaPendiente.nombre = nombre;
        if (fecha && this._esFechaValida(fecha)) sesion.reservaPendiente.fecha = fecha;
        if (hora) {
          const horaFranja = this._normalizarHora(hora);
          if (horaFranja) sesion.reservaPendiente.hora = horaFranja;
        }
        if (personas) {
          const p = parseInt(personas, 10);
          if (!isNaN(p) && p >= 1 && p <= restaurante.maximoPersonasPorReserva) {
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

    sessionManager.actualizarSesion(telefono, sesion);

    await this._enviar(telefono, respuestaAI.response);

    if (mensajeExtra) {
      await this._enviar(telefono, mensajeExtra);
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
        const m = restaurante.menuMedia;
        if (m?.tipo && m?.valor) {
          await this._enviarMedia(sesion.telefono, m);
          return null;
        }
        return restaurante.menu;
      }
      case 'show_reservations': return await this._mostrarReservas(sesion);
      case 'transfer_human':    sesion.modoHumano = true; return null;
      default:                  return null;
    }
  }

  async _guardarReserva(sesion) {
    const { nombre, fecha, hora, personas } = sesion.reservaPendiente;
    if (!nombre || !fecha || !hora || !personas) return null;

    return this._conLock(`franja:${fecha}|${hora}`, async () => {
      try {
        const mesa = await sheets.asignarMesa(fecha, hora, personas);

        if (!mesa) {
          // No hay mesa — proponer lista de espera
          sesion.estado = 'recolectando';
          sesion.reservaPendiente.hora = null;
          sesion.listaEsperaDisponible = { fecha, hora, personas, nombre };
          return (
            `❌ No hay mesas disponibles para ${hora} el ${fecha}.\n\n` +
            `¿Querés que te avise si se libera un lugar? Respondé *SÍ* y te anotamos en la lista de espera. 😊`
          );
        }

        const reserva = await sheets.guardarReserva({
          telefono: sesion.telefono, nombre, fecha, hora, personas, mesasIds: mesa.ids,
        });

        // Memoria de cliente
        sheets.upsertCliente({ telefono: sesion.telefono, nombre, fecha }).catch(() => {});

        sesion.reservaPendiente = { nombre: null, fecha: null, hora: null, personas: null };
        sesion.listaEsperaDisponible = null;
        sesion.estado = 'completado';

        // Notificar admin y socket
        this._notificarAdmin(`🆕 *Nueva reserva*\n${nombre} — ${fecha} ${hora} — ${personas} pers.\nID: ${reserva.id}`).catch(() => {});
        if (this._onReservaChange) this._onReservaChange('nueva', { ...reserva, mesa_nombre: mesa.nombre });

        const combinada = mesa.ids.length > 1;
        return (
          `✅ *¡Reserva confirmada!*\n\n` +
          `📋 *Resumen de tu reserva:*\n` +
          `  • 🔖 ID: \`${reserva.id}\`\n` +
          `  • 👤 Nombre: ${nombre}\n` +
          `  • 📅 Fecha: ${fecha}\n` +
          `  • 🕐 Horario: ${hora} – ${reserva.hora_fin} hs\n` +
          `  • 👥 Personas: ${personas}\n` +
          `  • 🪑 Mesa: ${mesa.nombre}${combinada ? ' _(mesas combinadas)_' : ''}\n\n` +
          `_Guardá el ID por si necesitás cancelar o consultar._\n` +
          `¡Nos vemos pronto en ${restaurante.nombre}! 🍽️`
        );

      } catch (error) {
        console.error('❌ Error guardando reserva:', error);
        return `❌ Hubo un problema técnico al guardar la reserva. Por favor, intentá de nuevo o llamá al ${restaurante.telefono}.`;
      }
    });
  }

  async _cancelarReserva(sesion) {
    try {
      const reserva = await sheets.cancelarReserva(sesion.telefono);

      if (!reserva) {
        return `No encontré ninguna reserva activa para tu número. ¿Tenés el ID de la reserva? Escribímelo y lo busco.`;
      }

      const fechaReserva = this._parsearFechaAR(reserva.fecha);
      if (fechaReserva) {
        const horasRestantes = (fechaReserva - new Date()) / 1000 / 3600;
        if (horasRestantes < restaurante.horasMinimaCancelacion) {
          return (
            `❌ No podés cancelar con menos de ${restaurante.horasMinimaCancelacion} horas de anticipación.\n` +
            `Para casos urgentes, llamá al ${restaurante.telefono}.`
          );
        }
      }

      sesion.estado = 'inicio';

      // Notificar admin y socket
      this._notificarAdmin(`❌ *Cancelación*\n${reserva.nombre} — ${reserva.fecha} ${reserva.hora}`).catch(() => {});
      if (this._onReservaChange) this._onReservaChange('cancelada', reserva);

      // Notificar al primero en lista de espera si hay
      try {
        const enEspera = await sheets.obtenerPrimeraListaEspera(reserva.fecha, reserva.hora, reserva.personas);
        if (enEspera) {
          await sheets.marcarListaEsperaNotificada(enEspera.id);
          await this._enviar(enEspera.telefono,
            `🎉 *¡Buenas noticias${enEspera.nombre ? ', ' + enEspera.nombre : ''}!*\n\n` +
            `Se liberó una mesa para el *${reserva.fecha}* a las *${reserva.hora}*.\n` +
            `Tenés 30 minutos para confirmar respondiendo a este mensaje. ¡Apurate! 😊`
          );
        }
      } catch { /* no crítico */ }

      return (
        `✅ Tu reserva del *${reserva.fecha}* a las *${reserva.hora}* fue cancelada exitosamente.\n` +
        `Si querés hacer una nueva reserva, decime y te ayudo. 😊`
      );

    } catch (error) {
      console.error('❌ Error cancelando reserva:', error);
      return `Hubo un error al cancelar. Por favor, llamá al ${restaurante.telefono}.`;
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

      const cambiaSlot = nuevaFecha !== actual.fecha || nuevaHora !== actual.hora || nuevasPersonas !== actual.personas;
      if (cambiaSlot) {
        return this._conLock(`franja:${nuevaFecha}|${nuevaHora}`, () =>
          this._aplicarModificacion(sesion, actual, nuevaFecha, nuevaHora, nuevasPersonas)
        );
      }

      return this._aplicarModificacion(sesion, actual, nuevaFecha, nuevaHora, nuevasPersonas);

    } catch (error) {
      console.error('❌ Error modificando reserva:', error);
      return `Hubo un problema al modificar la reserva. Por favor, llamá al ${restaurante.telefono}.`;
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

    this._notificarAdmin(`✏️ *Modificación*\n${reserva.nombre} — ${reserva.fecha} ${reserva.hora} — ${reserva.personas} pers.`).catch(() => {});
    if (this._onReservaChange) this._onReservaChange('modificada', reserva);

    return (
      `✅ *¡Reserva modificada exitosamente!*\n\n` +
      `📋 *Datos actualizados:*\n` +
      `  • 🔖 ID: \`${reserva.id}\`\n` +
      `  • 👤 Nombre: ${reserva.nombre}\n` +
      `  • 📅 Fecha: ${reserva.fecha}\n` +
      `  • 🕐 Horario: ${reserva.hora} – ${reserva.hora_fin} hs\n` +
      `  • 👥 Personas: ${reserva.personas}\n\n` +
      `¡Nos vemos pronto en ${restaurante.nombre}! 🍽️`
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
      return `Hubo un problema al anotarte. Intentá de nuevo o llamá al ${restaurante.telefono}.`;
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

  async _obtenerDisponibilidadSegura(fecha, personas = 1) {
    try {
      return await sheets.obtenerFranjasDisponibles(fecha, restaurante.franjasHorarias, personas);
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

  _esFechaValida(fechaStr) {
    const fecha = this._parsearFechaAR(fechaStr);
    if (!fecha) return false;
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    if (fecha < hoy) return false;
    const maxFecha = new Date(hoy);
    maxFecha.setDate(hoy.getDate() + restaurante.diasMaximosAnticipacion);
    return fecha <= maxFecha;
  }

  _normalizarHora(horaStr) {
    if (!horaStr || !/^\d{1,2}:\d{2}$/.test(horaStr)) return null;
    if (restaurante.franjasHorarias.includes(horaStr)) return horaStr;
    const [hh, mm] = horaStr.split(':').map(Number);
    if (isNaN(hh) || isNaN(mm)) return null;
    const minutos = hh * 60 + mm;
    let mejorFranja = null;
    let menorDif = Infinity;
    for (const franja of restaurante.franjasHorarias) {
      const [fh, fm] = franja.split(':').map(Number);
      const dif = Math.abs(minutos - (fh * 60 + fm));
      if (dif < menorDif) { menorDif = dif; mejorFranja = franja; }
    }
    return menorDif <= 60 ? mejorFranja : null;
  }
}

module.exports = new Bot();
