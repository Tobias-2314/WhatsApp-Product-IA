// ============================================================
// PANEL DE ADMINISTRACIÓN — HTTP handler
// Accesible en /admin?token=TU_ADMIN_TOKEN
// ============================================================

const sheets    = require('./sheets');
const restaurante = require('../config/restaurant');

// Devuelve la fecha actual en Argentina en formato DD/MM/YYYY.
// offsetDias permite pedir fechas futuras (ej: offsetDias=1 → mañana).
function fechaAR(offsetDias = 0) {
  const base = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }));
  base.setDate(base.getDate() + offsetDias);
  const d = String(base.getDate()).padStart(2, '0');
  const m = String(base.getMonth() + 1).padStart(2, '0');
  return `${d}/${m}/${base.getFullYear()}`;
}

// Convierte DD/MM/YYYY a YYYYMMDD para poder comparar y ordenar como string.
function fechaOrdenable(ddmmyyyy) {
  const [d, m, a] = ddmmyyyy.split('/');
  return `${a}${m}${d}`;
}

function verificarToken(req) {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return false;
  try {
    const url = new URL(req.url, 'http://localhost');
    return url.searchParams.get('token') === token;
  } catch {
    return false;
  }
}

async function manejarAdmin(req, res) {
  if (!process.env.ADMIN_TOKEN) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Panel deshabilitado. Configurá ADMIN_TOKEN en el .env para activarlo.');
    return;
  }

  if (!verificarToken(req)) {
    res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('401 — Acceso no autorizado.\nAgregá ?token=TU_ADMIN_TOKEN a la URL.');
    return;
  }

  try {
    const url = new URL(req.url, 'http://localhost');

    if (url.pathname === '/admin/api') {
      await servirJSON(res);
    } else {
      await servirHTML(res);
    }
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(`Error interno: ${error.message}`);
  }
}

// ─── JSON API ─────────────────────────────────────────────────

async function servirJSON(res) {
  const hoy = fechaAR(0);
  const fechas7Dias = Array.from({ length: 7 }, (_, i) => fechaAR(i + 1));

  const [reservasHoy, ...reservasDias] = await Promise.all([
    sheets.obtenerReservasPorFecha(hoy),
    ...fechas7Dias.map(f => sheets.obtenerReservasPorFecha(f)),
  ]);

  const proximas = reservasDias.flat();

  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({
    generadoEn: new Date().toISOString(),
    hoy: { fecha: hoy, reservas: reservasHoy },
    proximas7Dias: proximas,
  }, null, 2));
}

// ─── HTML PANEL ───────────────────────────────────────────────

async function servirHTML(res) {
  const hoy = fechaAR(0);
  const fechas7 = Array.from({ length: 7 }, (_, i) => fechaAR(i + 1));

  const [reservasHoy, ...reservasDias] = await Promise.all([
    sheets.obtenerReservasPorFecha(hoy),
    ...fechas7.map(f => sheets.obtenerReservasPorFecha(f)),
  ]);

  const proximas = reservasDias
    .flat()
    .filter(r => r.estado === 'confirmada')
    .sort((a, b) => {
      const fc = fechaOrdenable(a.fecha).localeCompare(fechaOrdenable(b.fecha));
      return fc !== 0 ? fc : a.hora.localeCompare(b.hora);
    });

  const confirmHoy   = reservasHoy.filter(r => r.estado === 'confirmada');
  const cancelHoy    = reservasHoy.filter(r => r.estado === 'cancelada').length;
  const personasHoy  = confirmHoy.reduce((s, r) => s + parseInt(r.personas, 10), 0);

  const horaActual = new Date().toLocaleTimeString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit',
  });

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="60">
  <title>Admin — ${esc(restaurante.nombre)}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f0f2f5;color:#1a1a1a;font-size:15px}
    .topbar{background:#111827;color:#fff;padding:.9rem 1.5rem;display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;z-index:10}
    .topbar h1{font-size:1rem;font-weight:600;letter-spacing:.01em}
    .topbar span{font-size:.78rem;opacity:.65}
    .main{max-width:960px;margin:0 auto;padding:1.25rem 1rem}
    .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:.85rem;margin-bottom:1.5rem}
    .card{background:#fff;border-radius:10px;padding:1rem 1.1rem;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.09)}
    .card-n{font-size:2rem;font-weight:700;color:#111827;line-height:1.1}
    .card-l{color:#6b7280;font-size:.75rem;margin-top:.3rem;text-transform:uppercase;letter-spacing:.04em}
    .section{margin-bottom:1.5rem}
    .section-title{font-size:.9rem;font-weight:600;color:#374151;margin-bottom:.65rem;display:flex;align-items:center;gap:.4rem}
    table{width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.09)}
    th{background:#111827;color:#fff;text-align:left;padding:.6rem .9rem;font-size:.75rem;font-weight:600;letter-spacing:.04em;text-transform:uppercase}
    td{padding:.65rem .9rem;border-bottom:1px solid #f3f4f6;font-size:.875rem;vertical-align:middle}
    tr:last-child td{border-bottom:none}
    tr:hover td{background:#f9fafb}
    .hora{font-weight:600;color:#111827;font-variant-numeric:tabular-nums}
    .id{font-family:monospace;font-size:.75rem;color:#9ca3af}
    .personas{font-weight:600;color:#059669}
    .badge{display:inline-block;padding:.15rem .5rem;border-radius:20px;font-size:.7rem;font-weight:700}
    .confirmada{background:#d1fae5;color:#065f46}
    .cancelada{background:#fee2e2;color:#991b1b}
    .empty{color:#9ca3af;font-style:italic;padding:1.25rem;text-align:center;background:#fff;border-radius:10px;box-shadow:0 1px 3px rgba(0,0,0,.09)}
    .footer{text-align:center;padding:.75rem;color:#9ca3af;font-size:.75rem}
  </style>
</head>
<body>
<div class="topbar">
  <h1>🍽️ ${esc(restaurante.nombre)} — Panel de Reservas</h1>
  <span>Hoy ${hoy} · actualización automática cada 60 s · última: ${horaActual}</span>
</div>

<div class="main">

  <div class="stats">
    <div class="card"><div class="card-n">${confirmHoy.length}</div><div class="card-l">Confirmadas hoy</div></div>
    <div class="card"><div class="card-n">${personasHoy}</div><div class="card-l">Personas hoy</div></div>
    <div class="card"><div class="card-n">${proximas.length}</div><div class="card-l">Próximos 7 días</div></div>
    <div class="card"><div class="card-n">${cancelHoy}</div><div class="card-l">Canceladas hoy</div></div>
  </div>

  <div class="section">
    <div class="section-title">📅 Reservas de hoy — ${hoy}</div>
    ${tablaReservas(confirmHoy, false)}
  </div>

  <div class="section">
    <div class="section-title">📆 Próximos 7 días</div>
    ${tablaReservas(proximas, true)}
  </div>

</div>
<div class="footer">Panel admin — ${esc(restaurante.nombre)}</div>
</body>
</html>`;

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function tablaReservas(reservas, mostrarFecha) {
  if (reservas.length === 0) {
    return `<p class="empty">Sin reservas para mostrar</p>`;
  }

  const filas = reservas.map(r => `
    <tr>
      ${mostrarFecha ? `<td>${esc(r.fecha)}</td>` : ''}
      <td class="hora">${esc(r.hora)}</td>
      <td>${esc(r.nombre)}</td>
      <td class="personas">${esc(String(r.personas))}</td>
      <td><span class="badge ${esc(r.estado)}">${esc(r.estado)}</span></td>
      <td class="id">${esc(r.id)}</td>
    </tr>`).join('');

  return `
    <table>
      <thead>
        <tr>
          ${mostrarFecha ? '<th>Fecha</th>' : ''}
          <th>Hora</th>
          <th>Nombre</th>
          <th>Personas</th>
          <th>Estado</th>
          <th>ID</th>
        </tr>
      </thead>
      <tbody>${filas}</tbody>
    </table>`;
}

// Escapa caracteres HTML para evitar XSS con datos de la hoja.
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = { manejarAdmin };
