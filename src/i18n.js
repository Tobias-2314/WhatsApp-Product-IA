const strings = {
  es: {
    bienvenida: (nombre) => `¡Hola! 👋 Bienvenido a *${nombre}*.\n\nPuedo ayudarte con:\n1️⃣ *Hacer una reserva*\n2️⃣ *Consultar mi reserva*\n3️⃣ *Cancelar mi reserva*\n4️⃣ *Ver nuestro menú*\n5️⃣ *Hablar con una persona*\n\n¿En qué te puedo ayudar? 😊`,
    reservaConfirmada: (r) => `✅ *¡Reserva confirmada!*\n\n📋 *Resumen:*\n  • 🔖 ID: \`${r.id}\`\n  • 👤 ${r.nombre}\n  • 📅 ${r.fecha}\n  • 🕐 ${r.hora} – ${r.hora_fin} hs\n  • 👥 ${r.personas} personas\n  • 🪑 ${r.mesa}`,
    depositoPendiente: (link, monto) => `💳 *Se requiere una seña de $${monto} para confirmar tu reserva.*\n\nPagá aquí: ${link}\n\n_Tu reserva quedará confirmada automáticamente al recibir el pago._`,
    errorTecnico: (tel) => `❌ Hubo un problema técnico. Por favor intentá de nuevo o llamá al ${tel}.`,
    sinDisponibilidad: () => `❌ No hay mesas disponibles para ese horario.`,
    listaEspera: () => `¿Querés que te avise si se libera un lugar? Respondé *SÍ* para anotarte.`,
    recordatorio24h: (nombre, r) => `Hola ${nombre}! 🍽️ Te recordamos tu reserva en *${r.restaurante}*:\n  • 📅 ${r.fecha} a las ${r.hora}\n  • 👥 ${r.personas} personas\n\n¿Confirmás tu asistencia? Respondé *SÍ* para confirmar o *NO* para cancelar.`,
    aviso2h: (r) => `⏰ Tu reserva en *${r.restaurante}* es en 2 horas (${r.hora}).\n¡Te esperamos! Si no podés venir, escribinos ahora.`,
    esperaLiberada: (r) => `🎉 ¡Se liberó una mesa para el ${r.fecha} a las ${r.hora}! Tenés 30 minutos para confirmar respondiendo a este mensaje.`,
  },
  en: {
    bienvenida: (nombre) => `Hi! 👋 Welcome to *${nombre}*.\n\nI can help you with:\n1️⃣ *Make a reservation*\n2️⃣ *Check my reservation*\n3️⃣ *Cancel my reservation*\n4️⃣ *View our menu*\n5️⃣ *Talk to a person*\n\nHow can I help you? 😊`,
    reservaConfirmada: (r) => `✅ *Reservation confirmed!*\n\n📋 *Summary:*\n  • 🔖 ID: \`${r.id}\`\n  • 👤 ${r.nombre}\n  • 📅 ${r.fecha}\n  • 🕐 ${r.hora} – ${r.hora_fin}\n  • 👥 ${r.personas} guests\n  • 🪑 ${r.mesa}`,
    depositoPendiente: (link, monto) => `💳 *A deposit of $${monto} is required to confirm your reservation.*\n\nPay here: ${link}\n\n_Your reservation will be confirmed automatically upon payment._`,
    errorTecnico: (tel) => `❌ There was a technical issue. Please try again or call ${tel}.`,
    sinDisponibilidad: () => `❌ No tables available for that time.`,
    listaEspera: () => `Would you like us to notify you if a spot opens? Reply *YES* to join the waitlist.`,
    recordatorio24h: (nombre, r) => `Hi ${nombre}! 🍽️ Reminder of your reservation at *${r.restaurante}*:\n  • 📅 ${r.fecha} at ${r.hora}\n  • 👥 ${r.personas} guests\n\nPlease confirm: reply *YES* to confirm or *NO* to cancel.`,
    aviso2h: (r) => `⏰ Your reservation at *${r.restaurante}* is in 2 hours (${r.hora}).\nSee you soon! If you can't make it, let us know.`,
    esperaLiberada: (r) => `🎉 A table opened for ${r.fecha} at ${r.hora}! You have 30 minutes to confirm by replying to this message.`,
  },
  pt: {
    bienvenida: (nombre) => `Olá! 👋 Bem-vindo ao *${nombre}*.\n\nPosso ajudar com:\n1️⃣ *Fazer uma reserva*\n2️⃣ *Consultar minha reserva*\n3️⃣ *Cancelar minha reserva*\n4️⃣ *Ver nosso cardápio*\n5️⃣ *Falar com uma pessoa*\n\nComo posso ajudar? 😊`,
    reservaConfirmada: (r) => `✅ *Reserva confirmada!*\n\n📋 *Resumo:*\n  • 🔖 ID: \`${r.id}\`\n  • 👤 ${r.nombre}\n  • 📅 ${r.fecha}\n  • 🕐 ${r.hora} – ${r.hora_fin}\n  • 👥 ${r.personas} pessoas\n  • 🪑 ${r.mesa}`,
    depositoPendiente: (link, monto) => `💳 *É necessário um sinal de $${monto} para confirmar sua reserva.*\n\nPague aqui: ${link}\n\n_Sua reserva será confirmada automaticamente ao receber o pagamento._`,
    errorTecnico: (tel) => `❌ Houve um problema técnico. Tente novamente ou ligue para ${tel}.`,
    sinDisponibilidad: () => `❌ Não há mesas disponíveis para esse horário.`,
    listaEspera: () => `Quer ser avisado se abrir uma vaga? Responda *SIM* para entrar na lista.`,
    recordatorio24h: (nombre, r) => `Olá ${nombre}! 🍽️ Lembrete da sua reserva no *${r.restaurante}*:\n  • 📅 ${r.fecha} às ${r.hora}\n  • 👥 ${r.personas} pessoas\n\nConfirme sua presença: responda *SIM* para confirmar ou *NÃO* para cancelar.`,
    aviso2h: (r) => `⏰ Sua reserva no *${r.restaurante}* é em 2 horas (${r.hora}).\nTe esperamos! Se não puder vir, nos avise agora.`,
    esperaLiberada: (r) => `🎉 Uma mesa abriu para o dia ${r.fecha} às ${r.hora}! Você tem 30 minutos para confirmar respondendo a esta mensagem.`,
  },
};

function t(idioma, clave, ...args) {
  const lang = strings[idioma] || strings['es'];
  const fn = lang[clave] || strings['es'][clave];
  return fn ? fn(...args) : `[${clave}]`;
}

module.exports = { t };
