// ============================================================
// CONFIGURACIÓN DEL RESTAURANTE
// Editá este archivo para personalizar el bot para cada cliente
// ============================================================

module.exports = {
  // --- DATOS BÁSICOS ---
  nombre: 'La Parrilla de Don José',
  telefono: '+54 11 1234-5678',
  direccion: 'Av. Corrientes 1234, CABA, Buenos Aires',

  // Número de WhatsApp del dueño para recibir notificaciones (sin + ni espacios, ej: '5491112345678')
  // null = deshabilitado
  telefonoAdmin: null,

  // --- HORARIOS DE ATENCIÓN ---
  // null = día cerrado
  horarios: {
    lunes:     null,
    martes:    { apertura: '12:00', cierre: '23:30' },
    miercoles: { apertura: '12:00', cierre: '23:30' },
    jueves:    { apertura: '12:00', cierre: '23:30' },
    viernes:   { apertura: '12:00', cierre: '00:00' },
    sabado:    { apertura: '12:00', cierre: '00:00' },
    domingo:   { apertura: '12:00', cierre: '23:00' },
  },

  // --- FRANJAS HORARIAS PARA RESERVAS ---
  // El bot solo ofrecerá estos horarios al cliente
  franjasHorarias: ['12:00', '14:00', '20:00', '21:00', '22:00'],

  // Máximo de personas aceptadas en una sola reserva
  maximoPersonasPorReserva: 12,

  // Cuántas horas antes se puede cancelar (política de cancelación)
  horasMinimaCancelacion: 2,

  // Con cuántos días de anticipación máxima se puede reservar
  diasMaximosAnticipacion: 30,

  // Duración real de cada reserva (lo que ocupa la mesa el cliente)
  duracionReservaMinutos: 90,

  // Buffer de limpieza entre reservas (no visible al cliente)
  tiempoLimpiezaMinutos: 15,

  // Cuántas mesas se pueden combinar para grupos grandes (2 = pares, 3 = tríos)
  maxMesasCombinadas: 2,

  // Mesas iniciales — se insertan en la BD solo si la tabla mesas está vacía al arrancar.
  // Después de eso, se gestionan desde el panel admin.
  mesasIniciales: [
    { nombre: 'Mesa 1', capacidad: 2 },
    { nombre: 'Mesa 2', capacidad: 2 },
    { nombre: 'Mesa 3', capacidad: 4 },
    { nombre: 'Mesa 4', capacidad: 4 },
    { nombre: 'Mesa 5', capacidad: 6 },
    { nombre: 'Mesa 6', capacidad: 8 },
  ],

  // --- MENSAJES PERSONALIZABLES ---
  mensajeBienvenida: `¡Hola! 👋 Bienvenido a *La Parrilla de Don José*.

Soy el asistente virtual del restaurante y puedo ayudarte con:

1️⃣ *Hacer una reserva*
2️⃣ *Consultar mi reserva existente*
3️⃣ *Cancelar mi reserva*
4️⃣ *Ver nuestro menú*
5️⃣ *Hablar con una persona*

¿En qué te puedo ayudar hoy? 😊`,

  // --- MENÚ MULTIMEDIA (opcional) ---
  // Si configurás esto, se envía en lugar del texto de menú de abajo.
  // tipo: 'imagen' | 'pdf' | 'url' | null
  // valor: ruta local (p. ej. './menu.jpg') o URL (https://...)
  // caption: texto opcional que acompaña a la imagen o PDF
  menuMedia: {
    tipo: 'imagen',
    valor: './img/Menu.jpg',
    caption: 'Este es el menú?',
  },

  // --- MENÚ DEL RESTAURANTE ---
  // Texto libre, usá *negritas* y _itálicas_ para formato WhatsApp
  menu: `🍽️ *MENÚ - La Parrilla de Don José*

━━━━━━━━━━━━━━━━━━
🥩 *PARRILLA*
━━━━━━━━━━━━━━━━━━
• Bife de chorizo (300g) — $8.500
• Entraña (250g) — $9.200
• Tira de asado (400g) — $10.500
• Pollo a la parrilla (entero) — $7.800
• Vacío (350g) — $9.800
• Ojo de bife (280g) — $11.200

━━━━━━━━━━━━━━━━━━
🥗 *ENTRADAS*
━━━━━━━━━━━━━━━━━━
• Provoleta con orégano y tomate — $3.200
• Morcilla y chorizo criollo — $2.800
• Tabla de fiambres y quesos — $4.500
• Empanadas (x3) — $2.400

━━━━━━━━━━━━━━━━━━
🍟 *ACOMPAÑAMIENTOS*
━━━━━━━━━━━━━━━━━━
• Papas fritas — $2.200
• Ensalada mixta — $1.900
• Puré de papas — $2.000
• Ensalada rusa — $2.100

━━━━━━━━━━━━━━━━━━
🍷 *BEBIDAS*
━━━━━━━━━━━━━━━━━━
• Vino de la casa (botella) — $4.200
• Cerveza artesanal (500ml) — $2.100
• Gaseosas — $1.200
• Agua mineral — $900
• Jugo natural — $1.500

━━━━━━━━━━━━━━━━━━
🍮 *POSTRES*
━━━━━━━━━━━━━━━━━━
• Flan casero con dulce de leche — $2.100
• Helado artesanal (3 gustos) — $2.400
• Panqueques con dulce de leche — $2.600

_Precios en pesos argentinos. IVA incluido._
_Aceptamos efectivo, débito y crédito._
_Consultá por opciones sin TACC._ 🌾`,
};
