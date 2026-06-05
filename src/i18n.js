const strings = {
  es: {
    bienvenida: (nombre) =>
      `¡Hola! 👋 Bienvenido a *${nombre}*.\n\nPuedo ayudarte con:\n1️⃣ *Hacer una reserva*\n2️⃣ *Consultar mi reserva*\n3️⃣ *Cancelar mi reserva*\n4️⃣ *Ver nuestro menú*\n5️⃣ *Hablar con una persona*\n\n¿En qué te puedo ayudar? 😊`,
    reservaConfirmada: (r) =>
      `✅ *¡Reserva confirmada!*\n\n` +
      `📋 *Resumen de tu reserva:*\n` +
      `  • 🔖 ID: \`${r.id}\`\n` +
      `  • 👤 Nombre: ${r.nombre}\n` +
      `  • 📅 Fecha: ${r.fecha}\n` +
      `  • 🕐 Horario: ${r.hora} – ${r.hora_fin} hs\n` +
      `  • 👥 Personas: ${r.personas}\n` +
      `  • 🪑 Mesa: ${r.mesa}\n\n` +
      `_Guardá el ID por si necesitás cancelar o consultar._\n` +
      `¡Nos vemos pronto en ${r.restaurante}! 🍽️`,
    depositoPendiente: (link, monto) =>
      `💳 *Se requiere una seña de $${monto} para confirmar tu reserva.*\n\nPagá aquí: ${link}\n\n_Tu reserva quedará confirmada automáticamente al recibir el pago._`,
    errorTecnico: (tel) =>
      `❌ Hubo un problema técnico. Por favor intentá de nuevo o llamá al ${tel}.`,
    sinDisponibilidad: (hora, fecha) =>
      `❌ No hay mesas disponibles para ${hora} el ${fecha}.`,
    listaEspera: () =>
      `¿Querés que te avise si se libera un lugar? Respondé *SÍ* y te anotamos en la lista de espera. 😊`,
    recordatorio24h: (nombre, r) =>
      `🍽️ *¡Recordatorio de reserva!*\n\n` +
      `Hola ${nombre}! Te recordamos tu reserva en *${r.restaurante}*:\n\n` +
      `  • 📅 Fecha: ${r.fecha}\n` +
      `  • 🕐 Hora: ${r.hora}\n` +
      `  • 👥 Personas: ${r.personas}\n\n` +
      `¿Confirmás tu asistencia? Respondé *SÍ* para confirmar o *NO* para cancelar. 😊`,
    aviso2h: (r) =>
      `⏰ *¡Tu reserva es en 2 horas!*\n\n` +
      `Hola ${r.nombre}! Tu mesa en *${r.restaurante}* te espera a las *${r.hora}*.\n\n` +
      `Si no podés venir, escribinos ahora para liberarla. ¡Hasta pronto! 😊`,
    esperaLiberada: (r) =>
      `🎉 *¡Buenas noticias${r.nombre ? ', ' + r.nombre : ''}!*\n\n` +
      `Se liberó una mesa para el *${r.fecha}* a las *${r.hora}*.\n` +
      `Tenés 30 minutos para confirmar respondiendo a este mensaje. ¡Apurate! 😊`,
    encuesta: (nombre, restaurante) =>
      `¡Hola${nombre ? ' ' + nombre : ''}! 🌟 Esperamos que hayas disfrutado tu visita a *${restaurante}*.\n\n¿Cómo calificarías tu experiencia? Respondé con un número del *1 al 5* ⭐`,
    encuestaGracias: (puntuacion) =>
      `✨ ¡Gracias por tu valoración de *${puntuacion}/5*! Tu opinión nos ayuda a mejorar. ¡Esperamos verte pronto! 🍽️`,
    encuestaInvalida: () =>
      `Por favor respondé con un número del 1 al 5 ⭐`,
  },
  en: {
    bienvenida: (nombre) =>
      `Hi! 👋 Welcome to *${nombre}*.\n\nI can help you with:\n1️⃣ *Make a reservation*\n2️⃣ *Check my reservation*\n3️⃣ *Cancel my reservation*\n4️⃣ *View our menu*\n5️⃣ *Talk to a person*\n\nHow can I help you? 😊`,
    reservaConfirmada: (r) =>
      `✅ *Reservation confirmed!*\n\n` +
      `📋 *Reservation summary:*\n` +
      `  • 🔖 ID: \`${r.id}\`\n` +
      `  • 👤 Name: ${r.nombre}\n` +
      `  • 📅 Date: ${r.fecha}\n` +
      `  • 🕐 Time: ${r.hora} – ${r.hora_fin}\n` +
      `  • 👥 Guests: ${r.personas}\n` +
      `  • 🪑 Table: ${r.mesa}\n\n` +
      `_Save the ID in case you need to cancel or check your reservation._\n` +
      `See you soon at ${r.restaurante}! 🍽️`,
    depositoPendiente: (link, monto) =>
      `💳 *A deposit of $${monto} is required to confirm your reservation.*\n\nPay here: ${link}\n\n_Your reservation will be confirmed automatically upon payment._`,
    errorTecnico: (tel) =>
      `❌ There was a technical issue. Please try again or call ${tel}.`,
    sinDisponibilidad: (hora, fecha) =>
      `❌ No tables available for ${hora} on ${fecha}.`,
    listaEspera: () =>
      `Would you like us to notify you if a spot opens? Reply *YES* to join the waitlist. 😊`,
    recordatorio24h: (nombre, r) =>
      `🍽️ *Reservation reminder!*\n\n` +
      `Hi ${nombre}! Reminder of your reservation at *${r.restaurante}*:\n\n` +
      `  • 📅 Date: ${r.fecha}\n` +
      `  • 🕐 Time: ${r.hora}\n` +
      `  • 👥 Guests: ${r.personas}\n\n` +
      `Please confirm your attendance. Reply *YES* to confirm or *NO* to cancel. 😊`,
    aviso2h: (r) =>
      `⏰ *Your reservation is in 2 hours!*\n\n` +
      `Hi ${r.nombre}! Your table at *${r.restaurante}* is ready at *${r.hora}*.\n\n` +
      `If you can't make it, let us know now to free up the table. See you soon! 😊`,
    esperaLiberada: (r) =>
      `🎉 *Great news${r.nombre ? ', ' + r.nombre : ''}!*\n\n` +
      `A table opened up for *${r.fecha}* at *${r.hora}*.\n` +
      `You have 30 minutes to confirm by replying to this message. Hurry! 😊`,
    encuesta: (nombre, restaurante) =>
      `Hi${nombre ? ' ' + nombre : ''}! 🌟 We hope you enjoyed your visit to *${restaurante}*.\n\nHow would you rate your experience? Reply with a number from *1 to 5* ⭐`,
    encuestaGracias: (puntuacion) =>
      `✨ Thank you for your rating of *${puntuacion}/5*! Your feedback helps us improve. Hope to see you soon! 🍽️`,
    encuestaInvalida: () =>
      `Please reply with a number from 1 to 5 ⭐`,
  },
  pt: {
    bienvenida: (nombre) =>
      `Olá! 👋 Bem-vindo ao *${nombre}*.\n\nPosso ajudar com:\n1️⃣ *Fazer uma reserva*\n2️⃣ *Consultar minha reserva*\n3️⃣ *Cancelar minha reserva*\n4️⃣ *Ver nosso cardápio*\n5️⃣ *Falar com uma pessoa*\n\nComo posso ajudar? 😊`,
    reservaConfirmada: (r) =>
      `✅ *Reserva confirmada!*\n\n` +
      `📋 *Resumo da reserva:*\n` +
      `  • 🔖 ID: \`${r.id}\`\n` +
      `  • 👤 Nome: ${r.nombre}\n` +
      `  • 📅 Data: ${r.fecha}\n` +
      `  • 🕐 Horário: ${r.hora} – ${r.hora_fin}\n` +
      `  • 👥 Pessoas: ${r.personas}\n` +
      `  • 🪑 Mesa: ${r.mesa}\n\n` +
      `_Guarde o ID caso precise cancelar ou consultar._\n` +
      `Até logo no ${r.restaurante}! 🍽️`,
    depositoPendiente: (link, monto) =>
      `💳 *É necessário um sinal de $${monto} para confirmar sua reserva.*\n\nPague aqui: ${link}\n\n_Sua reserva será confirmada automaticamente ao receber o pagamento._`,
    errorTecnico: (tel) =>
      `❌ Houve um problema técnico. Tente novamente ou ligue para ${tel}.`,
    sinDisponibilidad: (hora, fecha) =>
      `❌ Não há mesas disponíveis para ${hora} no dia ${fecha}.`,
    listaEspera: () =>
      `Quer ser avisado se abrir uma vaga? Responda *SIM* para entrar na lista de espera. 😊`,
    recordatorio24h: (nombre, r) =>
      `🍽️ *Lembrete de reserva!*\n\n` +
      `Olá ${nombre}! Lembramos da sua reserva no *${r.restaurante}*:\n\n` +
      `  • 📅 Data: ${r.fecha}\n` +
      `  • 🕐 Horário: ${r.hora}\n` +
      `  • 👥 Pessoas: ${r.personas}\n\n` +
      `Por favor confirme sua presença. Responda *SIM* para confirmar ou *NÃO* para cancelar. 😊`,
    aviso2h: (r) =>
      `⏰ *Sua reserva é em 2 horas!*\n\n` +
      `Olá ${r.nombre}! Sua mesa no *${r.restaurante}* te espera às *${r.hora}*.\n\n` +
      `Se não puder vir, nos avise agora para liberar a mesa. Até logo! 😊`,
    esperaLiberada: (r) =>
      `🎉 *Boa notícia${r.nombre ? ', ' + r.nombre : ''}!*\n\n` +
      `Uma mesa abriu para *${r.fecha}* às *${r.hora}*.\n` +
      `Você tem 30 minutos para confirmar respondendo a esta mensagem. Corre! 😊`,
    encuesta: (nombre, restaurante) =>
      `Olá${nombre ? ' ' + nombre : ''}! 🌟 Esperamos que tenha aproveitado sua visita ao *${restaurante}*.\n\nComo avaliaria sua experiência? Responda com um número de *1 a 5* ⭐`,
    encuestaGracias: (puntuacion) =>
      `✨ Obrigado pela sua avaliação de *${puntuacion}/5*! Sua opinião nos ajuda a melhorar. Até logo! 🍽️`,
    encuestaInvalida: () =>
      `Por favor responda com um número de 1 a 5 ⭐`,
  },
};

function t(idioma, clave, ...args) {
  const lang = strings[idioma] || strings['es'];
  const fn = lang[clave] || strings['es'][clave];
  return fn ? fn(...args) : `[${clave}]`;
}

module.exports = { t };
