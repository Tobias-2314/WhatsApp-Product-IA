// ============================================================
// PANEL DE ADMINISTRACIÓN — Express Router
// Monta en /admin — sirve SPA Vue + API REST
// ============================================================

const express = require('express');
const path    = require('path');
const db      = require('./db');

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

function crearAdminRouter(io = null) {
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
      const { nombre, capacidad, activa } = req.body || {};
      if (nombre    !== undefined) campos.nombre    = nombre.trim();
      if (capacidad !== undefined) campos.capacidad = parseInt(capacidad, 10);
      if (activa    !== undefined) campos.activa    = Boolean(activa);
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
