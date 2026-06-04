// ============================================================
// PANEL DE ADMINISTRACIÓN — Express Router
// Monta en /admin — sirve SPA Vue + API REST
// ============================================================

const express = require('express');
const path    = require('path');
const db      = require('./db');

let configManager = null;

const DIST = path.join(__dirname, '../admin/dist');

// ─── HELPERS ──────────────────────────────────────────────

function fechaAR(offsetDias = 0) {
  const base = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }));
  base.setDate(base.getDate() + offsetDias);
  const d = String(base.getDate()).padStart(2, '0');
  const m = String(base.getMonth() + 1).padStart(2, '0');
  return `${d}/${m}/${base.getFullYear()}`;
}

function authMiddleware(req, res, next) {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return res.status(503).json({ error: 'Panel deshabilitado. Configurá ADMIN_TOKEN en .env' });

  const header     = req.headers.authorization;
  const queryToken = req.query.token;

  if ((header === `Bearer ${token}`) || (queryToken === token)) return next();
  res.status(401).json({ error: 'No autorizado' });
}

// ─── ROUTER ───────────────────────────────────────────────

function crearAdminRouter(io = null, cfgManager = null) {
  configManager = cfgManager;
  const router = express.Router();

  // Archivos estáticos del build de Vue (sin autenticación)
  router.use(express.static(DIST));

  // API — requiere auth
  router.use('/api', authMiddleware);
  router.use('/api', express.json());

  // GET /admin/api/stats
  router.get('/api/stats', async (req, res) => {
    try {
      const hoy     = fechaAR(0);
      const fechas7 = Array.from({ length: 7 }, (_, i) => fechaAR(i + 1));

      const [statsHoy, proximas] = await Promise.all([
        db.obtenerStatsHoy(hoy),
        db.contarReservasFuturas(fechas7),
      ]);

      res.json({ hoy: { fecha: hoy, ...statsHoy }, proximos7dias: { total: proximas } });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /admin/api/reservas?fecha=DD/MM/YYYY&estado=confirmada|cancelada|todas&search=texto
  router.get('/api/reservas', async (req, res) => {
    try {
      const { fecha, estado, search } = req.query;
      const reservas = await db.obtenerReservasFiltradas({ fecha, estado, search });
      res.json(reservas);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /admin/api/reservas/:id/cancelar
  router.put('/api/reservas/:id/cancelar', async (req, res) => {
    try {
      const reserva = await db.cancelarReservaPorId(req.params.id);
      if (!reserva) return res.status(404).json({ error: 'Reserva no encontrada o ya cancelada' });
      if (io) io.emit('reserva:cancelada', reserva);
      res.json(reserva);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /admin/api/reservas/:id/no-show
  router.put('/api/reservas/:id/no-show', async (req, res) => {
    try {
      const reserva = await db.marcarNoShow(req.params.id);
      if (!reserva) return res.status(404).json({ error: 'Reserva no encontrada o no está confirmada' });
      if (io) io.emit('reserva:no_show', reserva);
      res.json(reserva);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /admin/api/reservas/export — descarga CSV con filtros
  router.get('/api/reservas/export', async (req, res) => {
    try {
      const { fecha, estado, search, desde, hasta } = req.query;
      const reservas = await db.obtenerReservasFiltradas({ fecha, estado, search, desde, hasta });
      const header   = 'ID,Teléfono,Nombre,Fecha,Hora,Personas,Mesa,Estado,Timestamp';
      const filas    = reservas.map(r =>
        [r.id, r.telefono, csvEsc(r.nombre), r.fecha, r.hora, r.personas,
         csvEsc(r.mesa_nombre || ''), r.estado, csvEsc(r.timestamp || '')].join(',')
      );
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="reservas_${fechaAR(0).replace(/\//g, '-')}.csv"`);
      res.send('﻿' + [header, ...filas].join('\n')); // BOM para Excel
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /admin/api/ocupacion?fecha=DD/MM/YYYY
  router.get('/api/ocupacion', async (req, res) => {
    try {
      const fecha = req.query.fecha || fechaAR(0);
      res.json(await db.obtenerOcupacionDia(fecha));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /admin/api/analytics?desde=DD/MM/YYYY&hasta=DD/MM/YYYY
  router.get('/api/analytics', async (req, res) => {
    try {
      const { desde, hasta } = req.query;
      if (!desde || !hasta) return res.status(400).json({ error: 'Parámetros desde y hasta requeridos' });
      res.json(await db.obtenerAnalytics({ desde, hasta }));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── MESAS ────────────────────────────────────────────────

  // GET /admin/api/mesas
  router.get('/api/mesas', async (req, res) => {
    try {
      res.json(await db.obtenerMesas());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /admin/api/mesas
  router.post('/api/mesas', async (req, res) => {
    try {
      const { nombre, capacidad } = req.body || {};
      if (!nombre?.trim()) return res.status(400).json({ error: 'El nombre es requerido' });
      const cap = parseInt(capacidad, 10);
      if (!cap || cap < 1) return res.status(400).json({ error: 'La capacidad debe ser un número mayor a 0' });
      res.status(201).json(await db.crearMesa({ nombre: nombre.trim(), capacidad: cap }));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /admin/api/mesas/:id
  router.put('/api/mesas/:id', async (req, res) => {
    try {
      const id     = parseInt(req.params.id, 10);
      const campos = {};
      const { nombre, capacidad, activa, x_pos, y_pos } = req.body || {};
      if (nombre    !== undefined) campos.nombre    = nombre.trim();
      if (capacidad !== undefined) campos.capacidad = parseInt(capacidad, 10);
      if (activa    !== undefined) campos.activa    = Boolean(activa);
      if (x_pos     !== undefined) campos.x_pos     = x_pos === null ? null : parseInt(x_pos, 10);
      if (y_pos     !== undefined) campos.y_pos     = y_pos === null ? null : parseInt(y_pos, 10);
      const mesa = await db.actualizarMesa(id, campos);
      if (!mesa) return res.status(404).json({ error: 'Mesa no encontrada' });
      res.json(mesa);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── COMBINACIONES ────────────────────────────────────────

  // GET /admin/api/combinaciones
  router.get('/api/combinaciones', async (req, res) => {
    try {
      res.json(await db.obtenerCombinaciones());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /admin/api/combinaciones
  router.post('/api/combinaciones', async (req, res) => {
    try {
      const { mesaId1, mesaId2 } = req.body || {};
      if (!mesaId1 || !mesaId2 || mesaId1 === mesaId2)
        return res.status(400).json({ error: 'IDs de mesas inválidos' });
      await db.agregarCombinacion(parseInt(mesaId1), parseInt(mesaId2));
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /admin/api/combinaciones
  router.delete('/api/combinaciones', async (req, res) => {
    try {
      const { mesaId1, mesaId2 } = req.body || {};
      if (!mesaId1 || !mesaId2)
        return res.status(400).json({ error: 'IDs de mesas requeridos' });
      await db.eliminarCombinacion(parseInt(mesaId1), parseInt(mesaId2));
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── CONFIGURACIÓN ────────────────────────────────────────

  // GET /admin/api/config
  router.get('/api/config', async (req, res) => {
    try {
      res.json(await db.leerConfig());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /admin/api/config
  router.put('/api/config', async (req, res) => {
    try {
      const config = await db.guardarConfig(req.body || {});
      // Recargar config en memoria
      if (configManager) await configManager.init();
      res.json(config);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── RESTAURANTES (multi-tenant) ──────────────────────────

  // GET /admin/api/restaurantes
  router.get('/api/restaurantes', async (req, res) => {
    try {
      res.json(await db.listarRestaurantes());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /admin/api/restaurantes
  router.post('/api/restaurantes', async (req, res) => {
    try {
      const { nombre, slug, admin_token, whatsapp, plan } = req.body || {};
      if (!nombre || !slug || !admin_token)
        return res.status(400).json({ error: 'nombre, slug y admin_token son requeridos' });
      res.status(201).json(await db.crearRestaurante({ nombre, slug, admin_token, whatsapp, plan }));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── MERCADOPAGO ──────────────────────────────────────────

  // POST /admin/api/pagos/crear — crea preferencia de pago
  router.post('/api/pagos/crear', async (req, res) => {
    try {
      const { reservaId, monto, descripcion } = req.body || {};
      if (!reservaId || !monto) return res.status(400).json({ error: 'reservaId y monto requeridos' });

      // TODO: reemplazar con SDK de MercadoPago real cuando se configuren las credenciales
      // const mp = new MercadoPago({ accessToken: process.env.MP_ACCESS_TOKEN });
      // const pref = await mp.preferences.create({ ... });

      // Por ahora devuelve un link de prueba
      const mockLink = `https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=MOCK_${reservaId}`;
      await db.actualizarDepositoReserva(reservaId, { estado: 'pendiente', mp_id: `MOCK_${reservaId}` });
      res.json({ link: mockLink, mp_id: `MOCK_${reservaId}` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /admin/api/pagos/webhook — IPN de MercadoPago
  router.post('/api/pagos/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const { type, data } = body || {};
      if (type === 'payment' && data?.id) {
        // TODO: verificar pago con MP SDK
        // const mp = new MercadoPago({ accessToken: process.env.MP_ACCESS_TOKEN });
        // const pago = await mp.payment.findById(data.id);
        // if (pago.status === 'approved') { ... }
        console.log('📦 Webhook MP recibido:', data.id);
      }
      res.sendStatus(200);
    } catch (err) {
      console.error('Error webhook MP:', err);
      res.sendStatus(200); // siempre 200 para MP
    }
  });

  // ─── IMPRESIÓN DEL DÍA ────────────────────────────────────

  // GET /admin/api/print?fecha=DD/MM/YYYY — HTML listo para imprimir
  router.get('/api/print', async (req, res) => {
    try {
      const fecha = req.query.fecha || (() => {
        const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }));
        return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
      })();
      const reservas = await db.obtenerReservasFiltradas({ fecha, estado: 'confirmada' });
      const sorted = reservas.sort((a, b) => a.hora.localeCompare(b.hora));

      let cfg = {};
      try { cfg = await db.leerConfig(); } catch {}
      const nombre = cfg.nombre || 'Restaurante';

      const filas = sorted.map(r => `
      <tr>
        <td class="hora">${r.hora}</td>
        <td class="nombre">${r.nombre}</td>
        <td class="personas">${r.personas}p</td>
        <td class="mesa">${r.mesa_nombre || '—'}</td>
        <td class="tel">${r.telefono}</td>
        <td class="notas"></td>
      </tr>`).join('');

      const html = `<!DOCTYPE html><html lang="es"><head>
<meta charset="UTF-8"><title>Reservas ${fecha}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 12px; color: #111; padding: 20px; }
  h1 { font-size: 18px; margin-bottom: 4px; }
  .sub { color: #666; font-size: 12px; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #111; color: #fff; padding: 7px 10px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; }
  td { padding: 8px 10px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
  tr:nth-child(even) td { background: #f9f9f9; }
  .hora { font-weight: 700; width: 60px; }
  .personas { width: 40px; text-align: center; }
  .mesa { width: 100px; color: #555; }
  .tel { color: #888; font-size: 11px; }
  .notas { width: 120px; }
  .summary { margin-top: 16px; font-size: 11px; color: #666; display: flex; gap: 20px; }
  @media print { body { padding: 0; } .no-print { display: none; } }
</style>
</head><body>
<h1>🍽️ ${nombre}</h1>
<p class="sub">Reservas del ${fecha} — ${sorted.length} confirmadas</p>
<button class="no-print" onclick="window.print()" style="margin-bottom:12px;padding:6px 14px;background:#111;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;">🖨️ Imprimir</button>
<table>
  <thead><tr><th>Hora</th><th>Nombre</th><th>Pers.</th><th>Mesa</th><th>Teléfono</th><th>Notas</th></tr></thead>
  <tbody>${filas || '<tr><td colspan="6" style="text-align:center;padding:20px;color:#999;">Sin reservas confirmadas para esta fecha</td></tr>'}</tbody>
</table>
<div class="summary">
  <span>Total: <strong>${sorted.length}</strong> reservas</span>
  <span>Personas: <strong>${sorted.reduce((s, r) => s + r.personas, 0)}</strong></span>
  <span>Generado: ${new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}</span>
</div>
</body></html>`;

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } catch (err) {
      res.status(500).send(`<p>Error: ${err.message}</p>`);
    }
  });

  // SPA fallback — cualquier ruta no-API devuelve index.html
  router.get('*', (req, res) => {
    res.sendFile(path.join(DIST, 'index.html'), (err) => {
      if (err) res.status(404).send('Panel no disponible. Ejecutá npm run build en la carpeta admin/');
    });
  });

  return router;
}

function csvEsc(str) {
  const s = String(str ?? '');
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
}

module.exports = { crearAdminRouter };
