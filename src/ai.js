// ============================================================
// INTEGRACIÓN CON GROQ (llama-3.3-70b-versatile)
// ============================================================

const Groq = require('groq-sdk');
const configManager = require('./configManager');

class AIManager {
  constructor() {
    this.client = null;
  }

  _inicializar() {
    if (!this.client) {
      if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY no está definido en .env');
      this.client = new Groq({ apiKey: process.env.GROQ_API_KEY });
    }
  }

  _construirSystemPrompt(sesion, franjasDisponibles) {
    const restaurante = configManager.get();
    const ahora = new Date();
    const fechaActual = ahora.toLocaleDateString('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires',
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
    const horaActual = ahora.toLocaleTimeString('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires',
      hour: '2-digit', minute: '2-digit',
    });

    const dias = Object.entries(restaurante.horarios)
      .map(([dia, h]) => `  - ${dia}: ${h ? `${h.apertura} a ${h.cierre}` : 'cerrado'}`)
      .join('\n');

    const { nombre, fecha, hora, personas } = sesion.reservaPendiente;
    const mod = sesion.modificacion || {};

    const clienteConocidoTexto = (nombre && sesion.historialConversacion.length === 0)
      ? `\nCLIENTE CONOCIDO: ${nombre} (ya ha reservado antes)\n→ NO preguntes su nombre, ya lo tenemos guardado. Trátalo por su nombre naturalmente.\n`
      : '';

    const disponibilidadTexto = franjasDisponibles
      ? `\nDISPONIBILIDAD PARA ${fecha || 'la fecha solicitada'} (ya filtrada para ${personas || 1} personas):\n` +
        franjasDisponibles.map(f => `  - ${f.hora}${f.combinada ? ' (requiere combinar mesas)' : ''}`).join('\n')
      : '';

    const modificacionTexto = (mod.fecha || mod.hora || mod.personas)
      ? `\nMODIFICACIÓN EN CURSO (datos que el cliente quiere cambiar):\n` +
        `  * Nueva fecha: ${mod.fecha || '(sin cambiar)'}\n` +
        `  * Nuevo horario: ${mod.hora || '(sin cambiar)'}\n` +
        `  * Nuevas personas: ${mod.personas || '(sin cambiar)'}`
      : '';

    return `Sos el asistente virtual del restaurante "${restaurante.nombre}". Tu trabajo es gestionar reservas por WhatsApp de forma amigable y natural.

DATOS DEL RESTAURANTE:
  - Nombre: ${restaurante.nombre}
  - Teléfono de contacto: ${restaurante.telefono}
  - Dirección: ${restaurante.direccion}
  - Franjas horarias para reservas: ${restaurante.franjasHorarias.join(', ')}
  - Duración de cada reserva: ${restaurante.duracionReservaMinutos} minutos
  - Máximo de personas por reserva: ${restaurante.maximoPersonasPorReserva}
  - Cancelación permitida hasta: ${restaurante.horasMinimaCancelacion} horas antes
  - Anticipación máxima: ${restaurante.diasMaximosAnticipacion} días

HORARIOS DE ATENCIÓN:
${dias}

FECHA Y HORA ACTUAL (Argentina): ${fechaActual}, ${horaActual}
${clienteConocidoTexto}${disponibilidadTexto}${modificacionTexto}

ESTADO DE ESTA CONVERSACIÓN:
  - Estado actual: ${sesion.estado}
  - Datos ya recolectados para la reserva:
    * Nombre del cliente: ${nombre || '(todavía no tenemos)'}
    * Fecha deseada: ${fecha || '(todavía no tenemos)'}
    * Horario deseado: ${hora || '(todavía no tenemos)'}
    * Cantidad de personas: ${personas || '(todavía no tenemos)'}

REGLAS IMPORTANTES:
1. Respondé siempre en español argentino. Usá "vos" en lugar de "tú". Sé cálido y profesional, pero NO uses expresiones muy coloquiales como "che", "boludo", "pibe" o similares.
2. Para hacer una reserva necesitás recolectar exactamente: nombre completo, fecha (DD/MM/YYYY), hora (de las franjas disponibles), cantidad de personas.
3. NO preguntés datos que ya tenés en los "Datos ya recolectados". Avanzá siempre al próximo dato faltante.
4. Si el cliente dice "mañana", "el viernes", "en tres días", etc., convertilo a DD/MM/YYYY usando la fecha actual.
5. Si el cliente pide una hora aproximada (ej: "las 8 de la noche"), mapeala a la franja horaria más cercana.
6. Si el cliente escribe "hablar con persona", "operador", "humano", "persona real" o similar, indicá que lo vas a transferir.
7. Sé breve. Una o dos oraciones son suficientes si el cliente ya sabe qué quiere.
8. Si el cliente da nombre, fecha, hora y personas en un solo mensaje, extraé todo sin preguntar de nuevo.
9. Para modificaciones: solo extraé los campos que el cliente quiere cambiar. Dejá en null los que no menciona.

ACCIONES DISPONIBLES (usá la correcta según el contexto):
- none: responder sin realizar ninguna acción en el sistema
- save_reservation: cuando tenés nombre + fecha + hora + personas y el cliente confirmó
- cancel_reservation: cuando el cliente quiere cancelar su reserva
- modify_reservation: cuando el cliente quiere cambiar la fecha, hora o cantidad de personas de una reserva existente
- check_availability: cuando el cliente pregunta qué horarios hay disponibles
- show_menu: cuando el cliente pide ver el menú
- show_reservations: cuando el cliente quiere ver sus reservas actuales
- transfer_human: cuando el cliente pide hablar con una persona
- add_waitlist: cuando el cliente acepta anotarse en la lista de espera para un horario sin disponibilidad

FORMATO DE RESPUESTA OBLIGATORIO (JSON exacto, sin markdown):
{
  "response": "el mensaje que le vas a enviar al cliente por WhatsApp",
  "action": "none|save_reservation|cancel_reservation|modify_reservation|check_availability|show_menu|show_reservations|transfer_human|add_waitlist",
  "extractedData": {
    "nombre": "nombre extraído del mensaje o null",
    "fecha": "fecha en formato DD/MM/YYYY o null",
    "hora": "hora en formato HH:MM o null",
    "personas": número entero o null
  },
  "estado": "inicio|recolectando|confirmando|completado|cancelando|modificando|viendo|humano"
}`;
  }

  async procesarMensaje(sesion, mensaje, franjasDisponibles = null) {
    this._inicializar();

    try {
      const systemPrompt = this._construirSystemPrompt(sesion, franjasDisponibles);

      const historial = sesion.historialConversacion
        .slice(-18)
        .map(msg => ({
          role: msg.rol === 'bot' ? 'assistant' : 'user',
          content: msg.contenido,
        }));

      const messages = [
        { role: 'system', content: systemPrompt },
        ...historial,
        { role: 'user', content: mensaje },
      ];

      const completion = await this.client.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages,
        temperature: 0.7,
        max_tokens: 800,
        response_format: { type: 'json_object' },
      });

      const texto = completion.choices[0].message.content;
      const parsed = JSON.parse(texto);

      if (!parsed.response || !parsed.action) throw new Error('Respuesta JSON incompleta');

      return parsed;

    } catch (error) {
      console.error('⚠️  Error en Groq:', error.message);
      return this._fallback(sesion.estado);
    }
  }

  _fallback(estado) {
    const cfg = configManager.get();
    const mensajes = {
      inicio: `¡Hola! Soy el asistente de ${cfg.nombre}. Podés pedirme: *hacer una reserva*, *consultar tu reserva*, *cancelar*, *ver el menú* o *hablar con una persona*.`,
      recolectando: `Disculpá, tuve un problema técnico. ¿Podés repetir tu mensaje?`,
      confirmando: `Disculpá, tuve un problema. ¿Confirmás la reserva? Respondé *sí* para confirmar o *no* para cancelar.`,
    };

    return {
      response: mensajes[estado] || `Disculpá el inconveniente. Para reservas llamá al ${cfg.telefono} o intentá de nuevo en un momento.`,
      action: 'none',
      extractedData: { nombre: null, fecha: null, hora: null, personas: null },
      estado: estado || 'inicio',
    };
  }
}

module.exports = new AIManager();
