// ============================================================
// CAPA DE DATOS — PostgreSQL
// Reemplaza sheets.js con interfaz idéntica para bot.js
// ============================================================

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

class DBManager {
  async inicializar() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS reservas (
        id          VARCHAR(20)  PRIMARY KEY,
        telefono    VARCHAR(50)  NOT NULL,
        nombre      VARCHAR(200) NOT NULL,
        fecha       VARCHAR(10)  NOT NULL,
        hora        VARCHAR(5)   NOT NULL,
        personas    INTEGER      NOT NULL,
        estado      VARCHAR(20)  NOT NULL DEFAULT 'confirmada',
        timestamp   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_reservas_telefono ON reservas(telefono);
      CREATE INDEX IF NOT EXISTS idx_reservas_fecha    ON reservas(fecha);
      CREATE INDEX IF NOT EXISTS idx_reservas_estado   ON reservas(estado);
    `);
  }

  // ─── ESCRITURA ────────────────────────────────────────────

  async guardarReserva({ telefono, nombre, fecha, hora, personas }) {
    const id = this._generarId();
    await pool.query(
      `INSERT INTO reservas (id, telefono, nombre, fecha, hora, personas, estado)
       VALUES ($1, $2, $3, $4, $5, $6, 'confirmada')`,
      [id, telefono, nombre, fecha, hora, personas]
    );
    return { id, telefono, nombre, fecha, hora, personas, estado: 'confirmada' };
  }

  async cancelarReserva(telefono, idReserva = null) {
    let rows;
    if (idReserva) {
      ({ rows } = await pool.query(
        `UPDATE reservas SET estado = 'cancelada'
         WHERE telefono = $1 AND id = $2 AND estado = 'confirmada'
         RETURNING *`,
        [telefono, idReserva]
      ));
    } else {
      ({ rows } = await pool.query(
        `UPDATE reservas SET estado = 'cancelada'
         WHERE id = (
           SELECT id FROM reservas
           WHERE telefono = $1 AND estado = 'confirmada'
           ORDER BY timestamp ASC LIMIT 1
         ) RETURNING *`,
        [telefono]
      ));
    }
    if (!rows.length) return null;
    const r = rows[0];
    return { id: r.id, telefono: r.telefono, nombre: r.nombre, fecha: r.fecha, hora: r.hora, personas: parseInt(r.personas, 10) };
  }

  async modificarReserva(telefono, campos) {
    const { rows: actual } = await pool.query(
      `SELECT * FROM reservas WHERE telefono = $1 AND estado = 'confirmada' ORDER BY timestamp ASC LIMIT 1`,
      [telefono]
    );
    if (!actual.length) return null;
    const r = actual[0];

    const nuevaFecha    = campos.fecha    ?? r.fecha;
    const nuevaHora     = campos.hora     ?? r.hora;
    const nuevasPersonas = campos.personas ?? r.personas;

    await pool.query(
      `UPDATE reservas SET fecha = $1, hora = $2, personas = $3 WHERE id = $4`,
      [nuevaFecha, nuevaHora, nuevasPersonas, r.id]
    );
    return { id: r.id, telefono: r.telefono, nombre: r.nombre, fecha: nuevaFecha, hora: nuevaHora, personas: parseInt(nuevasPersonas, 10) };
  }

  // ─── LECTURA ──────────────────────────────────────────────

  async obtenerReservasPorFecha(fecha) {
    const { rows } = await pool.query(
      `SELECT * FROM reservas WHERE fecha = $1 ORDER BY hora ASC`,
      [fecha]
    );
    return rows.map(r => this._mapear(r));
  }

  async obtenerReservasPorTelefono(telefono) {
    const { rows } = await pool.query(
      `SELECT * FROM reservas WHERE telefono = $1 AND estado = 'confirmada' ORDER BY timestamp ASC`,
      [telefono]
    );
    return rows.map(r => ({ ...this._mapear(r), timestamp: this._formatTs(r.timestamp) }));
  }

  async contarReservasEnFranja(fecha, hora) {
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS total FROM reservas WHERE fecha = $1 AND hora = $2 AND estado = 'confirmada'`,
      [fecha, hora]
    );
    return parseInt(rows[0].total, 10);
  }

  async obtenerFranjasDisponibles(fecha, franjasHorarias, capacidadMaxima) {
    const { rows } = await pool.query(
      `SELECT hora, COUNT(*) AS ocupadas FROM reservas
       WHERE fecha = $1 AND estado = 'confirmada'
       GROUP BY hora`,
      [fecha]
    );
    const ocupadasMap = {};
    for (const r of rows) ocupadasMap[r.hora] = parseInt(r.ocupadas, 10);

    return franjasHorarias
      .filter(hora => (ocupadasMap[hora] || 0) < capacidadMaxima)
      .map(hora => ({ hora, lugaresDisponibles: capacidadMaxima - (ocupadasMap[hora] || 0) }));
  }

  async obtenerReservaActiva(telefono) {
    const { rows } = await pool.query(
      `SELECT * FROM reservas WHERE telefono = $1 AND estado = 'confirmada' ORDER BY timestamp ASC LIMIT 1`,
      [telefono]
    );
    if (!rows.length) return null;
    const r = rows[0];
    return { id: r.id, telefono: r.telefono, nombre: r.nombre, fecha: r.fecha, hora: r.hora, personas: parseInt(r.personas, 10) };
  }

  // Fechas almacenadas como DD/MM/YYYY → filtro en JS (datasets pequeños para un restaurante)
  async obtenerReservasProximas(horasAntes = 24, margenHoras = 0.5) {
    const { rows } = await pool.query(
      `SELECT * FROM reservas WHERE estado = 'confirmada'`
    );
    const ahora = new Date();
    return rows.filter(r => {
      const [dia, mes, anio] = (r.fecha || '').split('/').map(Number);
      const [hh, mm]         = (r.hora  || '').split(':').map(Number);
      if ([dia, mes, anio, hh, mm].some(isNaN)) return false;
      const fechaHora = new Date(anio, mes - 1, dia, hh, mm);
      const difHoras  = (fechaHora - ahora) / 3_600_000;
      return difHoras >= horasAntes - margenHoras && difHoras <= horasAntes + margenHoras;
    }).map(r => ({ id: r.id, telefono: r.telefono, nombre: r.nombre, fecha: r.fecha, hora: r.hora, personas: parseInt(r.personas, 10) }));
  }

  // ─── MÉTODOS DE ADMIN ─────────────────────────────────────

  async obtenerReservasFiltradas({ fecha, estado, search } = {}) {
    const conditions = [];
    const params = [];
    let i = 1;

    if (fecha) {
      conditions.push(`fecha = $${i++}`);
      params.push(fecha);
    }
    if (estado && estado !== 'todas') {
      conditions.push(`estado = $${i++}`);
      params.push(estado);
    }
    if (search) {
      conditions.push(`(nombre ILIKE $${i} OR telefono ILIKE $${i + 1})`);
      params.push(`%${search}%`, `%${search}%`);
      i += 2;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT * FROM reservas ${where} ORDER BY timestamp DESC LIMIT 200`,
      params
    );
    return rows.map(r => ({ ...this._mapear(r), timestamp: this._formatTs(r.timestamp) }));
  }

  async cancelarReservaPorId(id) {
    const { rows } = await pool.query(
      `UPDATE reservas SET estado = 'cancelada' WHERE id = $1 AND estado = 'confirmada' RETURNING *`,
      [id]
    );
    if (!rows.length) return null;
    return this._mapear(rows[0]);
  }

  async obtenerStatsHoy(fecha) {
    const { rows } = await pool.query(
      `SELECT estado, COUNT(*) AS total, COALESCE(SUM(personas), 0) AS personas
       FROM reservas WHERE fecha = $1 GROUP BY estado`,
      [fecha]
    );
    const confirmadas = rows.find(r => r.estado === 'confirmada');
    const canceladas  = rows.find(r => r.estado === 'cancelada');
    return {
      confirmadas: parseInt(confirmadas?.total   || 0, 10),
      personas:    parseInt(confirmadas?.personas || 0, 10),
      canceladas:  parseInt(canceladas?.total    || 0, 10),
    };
  }

  async contarReservasFuturas(fechas) {
    if (!fechas.length) return 0;
    const placeholders = fechas.map((_, i) => `$${i + 1}`).join(', ');
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS total FROM reservas WHERE fecha IN (${placeholders}) AND estado = 'confirmada'`,
      fechas
    );
    return parseInt(rows[0].total, 10);
  }

  // ─── PRIVADOS ─────────────────────────────────────────────

  _mapear(r) {
    return {
      id:       r.id,
      telefono: r.telefono,
      nombre:   r.nombre,
      fecha:    r.fecha,
      hora:     r.hora,
      personas: parseInt(r.personas, 10),
      estado:   r.estado,
    };
  }

  _formatTs(ts) {
    if (!ts) return '';
    return new Date(ts).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
  }

  _generarId() {
    const ts   = Date.now().toString(36).toUpperCase();
    const rand = Math.random().toString(36).substring(2, 5).toUpperCase();
    return `R${ts}${rand}`;
  }
}

module.exports = new DBManager();
