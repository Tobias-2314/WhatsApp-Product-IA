// ============================================================
// LÓGICA PRINCIPAL DEL BOT
// Orquesta sesiones, IA y operaciones en Google Sheets
// ============================================================

const sessionManager = require('./sessions/sessionManager');
const ai = require('./ai');
const sheets = require('./db');
const restaurante = require('../config/restaurant');

class Bot {
  constructor() {
    this._enviadorMensajes = null;
    // Locks en memoria para serializar operaciones por clave (teléfono o franja horaria)
    this._locks = new Map();
  }

  // Mutex simple: garantiza que fn() se ejecute de forma exclusiva por key.
  // Evita race conditions entre mensajes concurrentes del mismo usuario
  // y entre reservas simultáneas en la misma franja horaria.
  _conLock(key, fn) {
    const prevLock = this._locks.get(key) ?? Promise.resolve();
    let release;
    const lockPromise = new Promise(resolve => { release = resolve; });
    this._locks.set(key, lockPromise);
    return prevLock
      .then(() => fn(), () => fn())
      .finally(() => release());
  }

  setEnviadorMensajes(fn) {
    this._enviadorMensajes = fn;
  }

  async _enviar(telefono, mensaje) {
    if (this._enviadorMensajes) {
      await this._enviadorMensajes(telefono, mensaje);
    }
  }

  // ─── PROCESAMIENTO PRINCIPAL ──────────────────────────────

  /**
   * Punto de entrada para cada mensaje entrante.
   * Serializado por teléfono para evitar race conditions entre mensajes simultáneos.
   */
  procesarMensaje(telefono, mensaje) {
    return this._conLock(`tel:${telefono}`, () => this._procesarMensajeInterno(telefono, mensaje));
  }

  async _procesarMensajeInterno(telefono, mensaje) {
    let sesion = sessionManager.obtenerOCrearSesion(telefono);

    // Si está en modo humano, no procesar automáticamente
    if (sesion.modoHumano) {
      console.log(`👤 [****${telefono.slice(-4)}] en modo humano — mensaje no procesado por bot`);
      return;
    }

    // Agregar mensaje del cliente al historial
    sesion.historialConversacion.push({ rol: 'usuario', contenido: mensaje });

    // Pre-cargar disponibilidad si ya tenemos la fecha (evita múltiples llamadas a Sheets)
    let franjasDisponibles = null;
    if (sesion.reservaPendiente.fecha && sesion.estado === 'recolectando') {
      franjasDisponibles = await this._obtenerDisponibilidadSegura(sesion.reservaPendiente.fecha);
    }

    // Enviar a Gemini
    const respuestaAI = await ai.procesarMensaje(sesion, mensaje, franjasDisponibles);

    // Actualizar datos extraídos según el tipo de acción.
    // Las modificaciones van a sesion.modificacion para no contaminar sesion.reservaPendiente.
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

    // Actualizar estado de la sesión
    if (respuestaAI.estado) sesion.estado = respuestaAI.estado;

    // Ejecutar acción indicada por la IA
    const mensajeExtra = await this._ejecutarAccion(respuestaAI.action, sesion);

    // Guardar respuesta del bot en historial (limitar a 20 para no explotar tokens)
    sesion.historialConversacion.push({ rol: 'bot', contenido: respuestaAI.response });
    if (sesion.historialConversacion.length > 20) {
      sesion.historialConversacion = sesion.historialConversacion.slice(-20);
    }

    // Persistir sesión actualizada
    sessionManager.actualizarSesion(telefono, sesion);

    // Enviar respuesta principal de la IA
    await this._enviar(telefono, respuestaAI.response);

    // Enviar mensaje adicional del sistema si corresponde (confirmación, menú, etc.)
    if (mensajeExtra) {
      await this._enviar(telefono, mensajeExtra);
    }
  }

  // ─── ACCIONES ─────────────────────────────────────────────

  async _ejecutarAccion(action, sesion) {
    switch (action) {
      case 'save_reservation':     return await this._guardarReserva(sesion);
      case 'cancel_reservation':   return await this._cancelarReserva(sesion);
      case 'modify_reservation':   return await this._modificarReserva(sesion);
      case 'check_availability':   return await this._verificarDisponibilidad(sesion);
      case 'show_menu':            return restaurante.menu;
      case 'show_reservations':    return await this._mostrarReservas(sesion);
      case 'transfer_human':       sesion.modoHumano = true; return null;
      default:                     return null;
    }
  }

  async _guardarReserva(sesion) {
    const { nombre, fecha, hora, personas } = sesion.reservaPendiente;

    if (!nombre || !fecha || !hora || !personas) {
      return null;
    }

    // Lock por franja: serializa el check+save para que no haya sobreventa
    // si dos usuarios intentan reservar el mismo horario al mismo tiempo.
    return this._conLock(`franja:${fecha}|${hora}`, async () => {
      try {
        const ocupadas = await sheets.contarReservasEnFranja(fecha, hora);
        if (ocupadas >= restaurante.capacidadMaximaPorFranja) {
          sesion.estado = 'recolectando';
          sesion.reservaPendiente.hora = null;
          return `❌ Ese horario se llenó justo ahora. ¿Querés que te muestre los horarios disponibles para el ${fecha}?`;
        }

        const reserva = await sheets.guardarReserva({
          telefono: sesion.telefono,
          nombre,
          fecha,
          hora,
          personas,
        });

        sesion.reservaPendiente = { nombre: null, fecha: null, hora: null, personas: null };
        sesion.estado = 'completado';

        return (
          `✅ *¡Reserva confirmada!*\n\n` +
          `📋 *Resumen de tu reserva:*\n` +
          `  • 🔖 ID: \`${reserva.id}\`\n` +
          `  • 👤 Nombre: ${nombre}\n` +
          `  • 📅 Fecha: ${fecha}\n` +
          `  • 🕐 Hora: ${hora}\n` +
          `  • 👥 Personas: ${personas}\n\n` +
          `_Guardá el ID por si necesitás cancelar o consultar._\n` +
          `¡Nos vemos pronto en ${restaurante.nombre}! 🍽️`
        );

      } catch (error) {
        console.error('❌ Error guardando reserva en Sheets:', error);
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

      // Verificar política de cancelación
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
          `📅 *${r.fecha}* a las *${r.hora}*\n` +
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

      // Si el slot cambia, verificar disponibilidad bajo lock para evitar doble booking
      const cambiaSlot = nuevaFecha !== actual.fecha || nuevaHora !== actual.hora;
      if (cambiaSlot) {
        return this._conLock(`franja:${nuevaFecha}|${nuevaHora}`, () =>
          this._aplicarModificacion(sesion, actual, nuevaFecha, nuevaHora, nuevasPersonas, true)
        );
      }

      return this._aplicarModificacion(sesion, actual, nuevaFecha, nuevaHora, nuevasPersonas, false);

    } catch (error) {
      console.error('❌ Error modificando reserva:', error);
      return `Hubo un problema al modificar la reserva. Por favor, llamá al ${restaurante.telefono}.`;
    }
  }

  async _aplicarModificacion(sesion, actual, nuevaFecha, nuevaHora, nuevasPersonas, verificar) {
    if (verificar) {
      const ocupadas = await sheets.contarReservasEnFranja(nuevaFecha, nuevaHora);
      if (ocupadas >= restaurante.capacidadMaximaPorFranja) {
        sesion.modificacion = null;
        return `❌ Ese horario está lleno para el ${nuevaFecha}. ¿Querés ver los horarios disponibles?`;
      }
    }

    const reserva = await sheets.modificarReserva(sesion.telefono, {
      fecha: nuevaFecha, hora: nuevaHora, personas: nuevasPersonas,
    });

    if (!reserva) return `No pude modificar la reserva. Por favor, intentá de nuevo.`;

    sesion.modificacion = null;
    sesion.estado = 'completado';

    return (
      `✅ *¡Reserva modificada exitosamente!*\n\n` +
      `📋 *Datos actualizados:*\n` +
      `  • 🔖 ID: \`${reserva.id}\`\n` +
      `  • 👤 Nombre: ${reserva.nombre}\n` +
      `  • 📅 Fecha: ${reserva.fecha}\n` +
      `  • 🕐 Hora: ${reserva.hora}\n` +
      `  • 👥 Personas: ${reserva.personas}\n\n` +
      `¡Nos vemos pronto en ${restaurante.nombre}! 🍽️`
    );
  }

  async _verificarDisponibilidad(sesion) {
    const fecha = sesion.reservaPendiente.fecha;
    if (!fecha) return null;

    const franjas = await this._obtenerDisponibilidadSegura(fecha);
    if (!franjas) return null;

    if (franjas.length === 0) {
      return `😔 No hay disponibilidad para el ${fecha}. ¿Querés intentar con otra fecha?`;
    }

    const lista = franjas.map(f => `  • ${f.hora} — ${f.lugaresDisponibles} lugar/es`).join('\n');
    return `✅ *Horarios disponibles para el ${fecha}:*\n${lista}`;
  }

  // ─── HELPERS ──────────────────────────────────────────────

  async _obtenerDisponibilidadSegura(fecha) {
    try {
      return await sheets.obtenerFranjasDisponibles(
        fecha,
        restaurante.franjasHorarias,
        restaurante.capacidadMaximaPorFranja
      );
    } catch {
      return null;
    }
  }

  // Parsea DD/MM/YYYY y devuelve un Date válido, o null si el formato/valor es inválido.
  _parsearFechaAR(fechaStr) {
    if (!fechaStr || !/^\d{2}\/\d{2}\/\d{4}$/.test(fechaStr)) return null;
    const [dia, mes, anio] = fechaStr.split('/').map(Number);
    if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
    const fecha = new Date(anio, mes - 1, dia);
    // Si el mes "se desbordó" (ej: 31/02) Date lo ajusta automáticamente → detectarlo
    if (fecha.getMonth() !== mes - 1 || fecha.getDate() !== dia) return null;
    return fecha;
  }

  // Valida que la fecha sea futura y dentro del límite de anticipación.
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

  // Devuelve la franja horaria exacta más cercana a la hora recibida (máx. 60 min de diferencia).
  // Evita que Gemini guarde "14:32" cuando la franja válida es "14:00".
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
