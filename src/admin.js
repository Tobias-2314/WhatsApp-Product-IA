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

function crearAdminRouter() {
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
      res.json(reserva);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /admin/api/reservas/export — descarga CSV
  router.get('/api/reservas/export', async (req, res) => {
    try {
      const reservas = await db.obtenerReservasFiltradas({});
      const header   = 'ID,Teléfono,Nombre,Fecha,Hora,Personas,Estado,Timestamp';
      const filas    = reservas.map(r =>
        [r.id, r.telefono, csvEsc(r.nombre), r.fecha, r.hora, r.personas, r.estado, csvEsc(r.timestamp || '')].join(',')
      );
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="reservas_${fechaAR(0).replace(/\//g, '-')}.csv"`);
      res.send('﻿' + [header, ...filas].join('\n')); // BOM para Excel
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
