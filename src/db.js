// ============================================================
// CAPA DE DATOS — PostgreSQL
// ============================================================

const { Pool } = require('pg');
const restaurante = require('../config/restaurant');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

class DBManager {
  async inicializar() {
    // Tabla de mesas físicas
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mesas (
        id        SERIAL       PRIMARY KEY,
        nombre    VARCHAR(50)  NOT NULL,
        capacidad INTEGER      NOT NULL CHECK (capacidad > 0),
        activa    BOOLEAN      NOT NULL DEFAULT true
      );
    `);

    // Tabla de reservas
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
    `);

    // Migración aditiva — columnas de reservas
    await pool.query(`
      ALTER TABLE reservas ADD COLUMN IF NOT EXISTS mesa_id              INTEGER REFERENCES mesas(id);
      ALTER TABLE reservas ADD COLUMN IF NOT EXISTS mesas_ids            INTEGER[];
      ALTER TABLE reservas ADD COLUMN IF NOT EXISTS duracion_minutos     INTEGER NOT NULL DEFAULT 90;
      ALTER TABLE reservas ADD COLUMN IF NOT EXISTS hora_fin             VARCHAR(5);
      ALTER TABLE reservas ADD COLUMN IF NOT EXISTS confirmacion_enviada BOOLEAN NOT NULL DEFAULT false;
    `);

    // Sesiones persistentes (L2 para sessionManager)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        telefono   VARCHAR(50) PRIMARY KEY,
        data       JSONB       NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Memoria de clientes
    await pool.query(`
      CREATE TABLE IF NOT EXISTS clientes (
        telefono      VARCHAR(50) PRIMARY KEY,
        nombre_usual  VARCHAR(200),
        visitas       INTEGER     NOT NULL DEFAULT 0,
        ultima_visita VARCHAR(10)
      );
    `);

    // Lista de espera
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lista_espera (
        id         SERIAL       PRIMARY KEY,
        telefono   VARCHAR(50)  NOT NULL,
        nombre     VARCHAR(200),
        fecha      VARCHAR(10)  NOT NULL,
        hora       VARCHAR(5)   NOT NULL,
        personas   INTEGER      NOT NULL,
        estado     VARCHAR(20)  NOT NULL DEFAULT 'pendiente',
        created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );
    `);

    // Combinaciones de mesas permitidas (pares que pueden unirse)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS combinaciones_mesas (
        mesa_id_1 INTEGER NOT NULL REFERENCES mesas(id) ON DELETE CASCADE,
        mesa_id_2 INTEGER NOT NULL REFERENCES mesas(id) ON DELETE CASCADE,
        PRIMARY KEY (mesa_id_1, mesa_id_2),
        CHECK (mesa_id_1 < mesa_id_2)
      );
    `);

    // Índices
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_reservas_telefono   ON reservas(telefono);
      CREATE INDEX IF NOT EXISTS idx_reservas_fecha      ON reservas(fecha);
      CREATE INDEX IF NOT EXISTS idx_reservas_estado     ON reservas(estado);
      CREATE INDEX IF NOT EXISTS idx_reservas_mesa_fecha ON reservas(mesa_id, fecha);
      CREATE INDEX IF NOT EXISTS idx_lista_espera_fh     ON lista_espera(fecha, hora, estado);
      CREATE INDEX IF NOT EXISTS idx_clientes            ON clientes(telefono);
    `);

    // Seed de mesas si la tabla está vacía
    const { rows: cnt } = await pool.query(`SELECT COUNT(*) AS n FROM mesas`);
    if (parseInt(cnt[0].n, 10) === 0 && restaurante.mesasIniciales?.length) {
      for (const m of restaurante.mesasIniciales) {
        await pool.query(`INSERT INTO mesas (nombre, capacidad) VALUES ($1, $2)`, [m.nombre, m.capacidad]);
      }
    }
  }

  // ─── SESIONES (para sessionManager) ──────────────────────

  async cargarSesion(telefono) {
    const { rows } = await pool.query(
      `SELECT data FROM sessions WHERE telefono = $1`, [telefono]
    );
    return rows[0]?.data ?? null;
  }

  async guardarSesion(telefono, data) {
    await pool.query(
      `INSERT INTO sessions (telefono, data, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (telefono) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
      [telefono, JSON.stringify(data)]
    );
  }

  async eliminarSesionDB(telefono) {
    await pool.query(`DELETE FROM sessions WHERE telefono = $1`, [telefono]);
  }

  async limpiarSesionesExpiradas() {
    await pool.query(
      `DELETE FROM sessions WHERE updated_at < NOW() - INTERVAL '30 minutes'`
    );
  }

  // ─── CLIENTES ─────────────────────────────────────────────

  async obtenerCliente(telefono) {
    const { rows } = await pool.query(
      `SELECT * FROM clientes WHERE telefono = $1`, [telefono]
    );
    return rows[0] ?? null;
  }

  async upsertCliente({ telefono, nombre, fecha }) {
    await pool.query(
      `INSERT INTO clientes (telefono, nombre_usual, visitas, ultima_visita)
       VALUES ($1, $2, 1, $3)
       ON CONFLICT (telefono) DO UPDATE SET
         nombre_usual  = EXCLUDED.nombre_usual,
         visitas       = clientes.visitas + 1,
         ultima_visita = EXCLUDED.ultima_visita`,
      [telefono, nombre, fecha]
    );
  }

  // ─── LISTA DE ESPERA ──────────────────────────────────────

  async agregarListaEspera({ telefono, nombre, fecha, hora, personas }) {
    const { rows } = await pool.query(
      `INSERT INTO lista_espera (telefono, nombre, fecha, hora, personas)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [telefono, nombre ?? null, fecha, hora, personas]
    );
    return rows[0];
  }

  async obtenerPrimeraListaEspera(fecha, hora, personas) {
    const { rows } = await pool.query(
      `SELECT * FROM lista_espera
       WHERE fecha = $1 AND hora = $2 AND personas <= $3 AND estado = 'pendiente'
       ORDER BY created_at ASC LIMIT 1`,
      [fecha, hora, personas]
    );
    return rows[0] ?? null;
  }

  async marcarListaEsperaNotificada(id) {
    await pool.query(
      `UPDATE lista_espera SET estado = 'notificado' WHERE id = $1`, [id]
    );
  }

  async obtenerListaEsperaPorTelefono(telefono) {
    const { rows } = await pool.query(
      `SELECT * FROM lista_espera WHERE telefono = $1 AND estado = 'pendiente' ORDER BY created_at ASC`,
      [telefono]
    );
    return rows;
  }

  async cancelarListaEspera(id) {
    await pool.query(
      `UPDATE lista_espera SET estado = 'cancelado' WHERE id = $1`, [id]
    );
  }

  // ─── ESCRITURA DE RESERVAS ────────────────────────────────

  async guardarReserva({ telefono, nombre, fecha, hora, personas, mesasIds }) {
    const id       = this._generarId();
    const horaFin  = this._calcularHoraFin(hora);
    const duracion = restaurante.duracionReservaMinutos;
    const ids      = mesasIds?.length ? mesasIds : null;

    await pool.query(
      `INSERT INTO reservas (id, telefono, nombre, fecha, hora, personas, estado, mesa_id, mesas_ids, duracion_minutos, hora_fin)
       VALUES ($1, $2, $3, $4, $5, $6, 'confirmada', $7, $8, $9, $10)`,
      [id, telefono, nombre, fecha, hora, personas, ids?.[0] ?? null, ids, duracion, horaFin]
    );
    return { id, telefono, nombre, fecha, hora, hora_fin: horaFin, personas, estado: 'confirmada', mesas_ids: ids };
  }

  async cancelarReserva(telefono, idReserva = null) {
    let rows;
    if (idReserva) {
      ({ rows } = await pool.query(
        `UPDATE reservas SET estado = 'cancelada'
         WHERE telefono = $1 AND id = $2 AND estado = 'confirmada' RETURNING *`,
        [telefono, idReserva]
      ));
    } else {
      ({ rows } = await pool.query(
        `UPDATE reservas SET estado = 'cancelada'
         WHERE id = (
           SELECT id FROM reservas WHERE telefono = $1 AND estado = 'confirmada'
           ORDER BY timestamp ASC LIMIT 1
         ) RETURNING *`,
        [telefono]
      ));
    }
    if (!rows.length) return null;
    return this._mapear(rows[0]);
  }

  async modificarReserva(telefono, campos) {
    const { rows: actual } = await pool.query(
      `SELECT * FROM reservas WHERE telefono = $1 AND estado = 'confirmada' ORDER BY timestamp ASC LIMIT 1`,
      [telefono]
    );
    if (!actual.length) return null;
    const r = actual[0];

    const nuevaFecha     = campos.fecha    ?? r.fecha;
    const nuevaHora      = campos.hora     ?? r.hora;
    const nuevasPersonas = campos.personas ?? parseInt(r.personas, 10);

    const cambiaSlot = nuevaFecha !== r.fecha || nuevaHora !== r.hora || nuevasPersonas !== parseInt(r.personas, 10);

    let nuevaMesaId    = r.mesa_id   ? parseInt(r.mesa_id, 10) : null;
    let nuevasMesasIds = r.mesas_ids ?? null;
    let nuevaHoraFin   = r.hora_fin  || this._calcularHoraFin(nuevaHora);

    if (cambiaSlot) {
      const mesa = await this._asignarMesaExcluyendo(nuevaFecha, nuevaHora, nuevasPersonas, r.id);
      if (!mesa) return { error: 'no_disponibilidad' };
      nuevaMesaId    = mesa.ids[0];
      nuevasMesasIds = mesa.ids;
      nuevaHoraFin   = this._calcularHoraFin(nuevaHora);
    }

    await pool.query(
      `UPDATE reservas SET fecha = $1, hora = $2, personas = $3, mesa_id = $4, mesas_ids = $5, hora_fin = $6 WHERE id = $7`,
      [nuevaFecha, nuevaHora, nuevasPersonas, nuevaMesaId, nuevasMesasIds, nuevaHoraFin, r.id]
    );

    return {
      id: r.id, telefono: r.telefono, nombre: r.nombre,
      fecha: nuevaFecha, hora: nuevaHora, hora_fin: nuevaHoraFin, personas: nuevasPersonas,
    };
  }

  async marcarConfirmacionEnviada(id) {
    await pool.query(
      `UPDATE reservas SET confirmacion_enviada = true WHERE id = $1`, [id]
    );
  }

  async marcarNoShow(id) {
    const { rows } = await pool.query(
      `UPDATE reservas SET estado = 'no_show' WHERE id = $1 AND estado = 'confirmada' RETURNING *`, [id]
    );
    if (!rows.length) return null;
    return this._mapear(rows[0]);
  }

  async contarNoShowsPorTelefono(telefono) {
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS total FROM reservas WHERE telefono = $1 AND estado = 'no_show'`, [telefono]
    );
    return parseInt(rows[0].total, 10);
  }

  // ─── DISPONIBILIDAD ───────────────────────────────────────

  async asignarMesa(fecha, hora, personas) {
    return this._asignarMesaExcluyendo(fecha, hora, personas, null);
  }

  async _asignarMesaExcluyendo(fecha, hora, personas, excludeId) {
    const horaFin = this._calcularHoraFin(hora);

    // 1. Obtener IDs de mesas ocupadas en este slot (soporta mesa_id simple y mesas_ids array)
    const conflParams = [fecha, horaFin, hora];
    const conflCond   = excludeId ? ' AND r.id != $4' : '';
    if (excludeId) conflParams.push(excludeId);

    const { rows: conflictos } = await pool.query(
      `SELECT r.mesa_id, r.mesas_ids FROM reservas r
       WHERE r.fecha = $1 AND r.estado = 'confirmada'
         AND r.hora < $2 AND r.hora_fin > $3 ${conflCond}`,
      conflParams
    );

    const ocupadasSet = new Set();
    for (const r of conflictos) {
      if (r.mesas_ids?.length) r.mesas_ids.forEach(id => ocupadasSet.add(parseInt(id)));
      else if (r.mesa_id)       ocupadasSet.add(parseInt(r.mesa_id));
    }

    // 2. Todas las mesas activas libres, ordenadas por capacidad (best-fit)
    const { rows: todasMesas } = await pool.query(
      `SELECT id, nombre, capacidad FROM mesas WHERE activa = true ORDER BY capacidad ASC, id ASC`
    );
    const libres = todasMesas.filter(m => !ocupadasSet.has(m.id));

    // 3. Mesa individual (best-fit)
    const single = libres.find(m => m.capacidad >= personas);
    if (single) {
      return { id: single.id, ids: [single.id], nombre: single.nombre, capacidad: single.capacidad };
    }

    // 4. Cargar combinaciones permitidas
    const maxCombinadas = restaurante.maxMesasCombinadas ?? 2;
    if (maxCombinadas < 2) return null;

    const { rows: combRows } = await pool.query(
      `SELECT mesa_id_1, mesa_id_2 FROM combinaciones_mesas`
    );
    const combSet = new Set(combRows.map(r => `${r.mesa_id_1}-${r.mesa_id_2}`));
    const esPar = (a, b) => combSet.has(`${Math.min(a, b)}-${Math.max(a, b)}`);

    // 5. Pares permitidos (best-fit)
    let mejor = null;
    for (let i = 0; i < libres.length; i++) {
      for (let j = i + 1; j < libres.length; j++) {
        if (!esPar(libres[i].id, libres[j].id)) continue;
        const total = libres[i].capacidad + libres[j].capacidad;
        if (total >= personas && (!mejor || total < mejor.capacidad)) {
          mejor = {
            id: libres[i].id,
            ids: [libres[i].id, libres[j].id],
            nombre: `${libres[i].nombre} + ${libres[j].nombre}`,
            capacidad: total,
          };
        }
      }
    }
    if (mejor) return mejor;

    // 6. Tríos permitidos (solo si maxMesasCombinadas >= 3 y todos los pares están habilitados)
    if (maxCombinadas >= 3) {
      let mejorTrio = null;
      for (let i = 0; i < libres.length; i++) {
        for (let j = i + 1; j < libres.length; j++) {
          if (!esPar(libres[i].id, libres[j].id)) continue;
          for (let k = j + 1; k < libres.length; k++) {
            if (!esPar(libres[i].id, libres[k].id)) continue;
            if (!esPar(libres[j].id, libres[k].id)) continue;
            const total = libres[i].capacidad + libres[j].capacidad + libres[k].capacidad;
            if (total >= personas && (!mejorTrio || total < mejorTrio.capacidad)) {
              mejorTrio = {
                id: libres[i].id,
                ids: [libres[i].id, libres[j].id, libres[k].id],
                nombre: `${libres[i].nombre} + ${libres[j].nombre} + ${libres[k].nombre}`,
                capacidad: total,
              };
            }
          }
        }
      }
      if (mejorTrio) return mejorTrio;
    }

    return null;
  }

  async obtenerFranjasDisponibles(fecha, franjasHorarias, personas) {
    const resultado = [];
    for (const hora of franjasHorarias) {
      const mesa = await this.asignarMesa(fecha, hora, personas);
      if (mesa) {
        resultado.push({ hora, combinada: mesa.ids.length > 1 });
      }
    }
    return resultado;
  }

  // ─── LECTURA DE RESERVAS ──────────────────────────────────

  async obtenerReservasPorFecha(fecha) {
    const { rows } = await pool.query(
      `SELECT * FROM reservas WHERE fecha = $1 ORDER BY hora ASC`, [fecha]
    );
    return rows.map(r => this._mapear(r));
  }

  async obtenerReservasPorTelefono(telefono) {
    const { rows } = await pool.query(
      `SELECT r.*,
         COALESCE(
           (SELECT STRING_AGG(m.nombre, ' + ' ORDER BY m.id) FROM mesas m WHERE m.id = ANY(r.mesas_ids)),
           (SELECT m.nombre FROM mesas m WHERE m.id = r.mesa_id)
         ) AS mesa_nombre
       FROM reservas r
       WHERE r.telefono = $1 AND r.estado = 'confirmada' ORDER BY r.timestamp ASC`,
      [telefono]
    );
    return rows.map(r => ({ ...this._mapear(r), mesa_nombre: r.mesa_nombre || null, timestamp: this._formatTs(r.timestamp) }));
  }

  async obtenerReservaActiva(telefono) {
    const { rows } = await pool.query(
      `SELECT * FROM reservas WHERE telefono = $1 AND estado = 'confirmada' ORDER BY timestamp ASC LIMIT 1`,
      [telefono]
    );
    if (!rows.length) return null;
    return this._mapear(rows[0]);
  }

  async obtenerReservasProximas(horasAntes = 24, margenHoras = 0.5, { soloConConfirmacion = false } = {}) {
    const condicion = soloConConfirmacion
      ? `AND confirmacion_enviada = true`
      : '';
    const { rows } = await pool.query(
      `SELECT * FROM reservas WHERE estado = 'confirmada' ${condicion}`
    );
    const ahora = new Date();
    return rows.filter(r => {
      const [dia, mes, anio] = (r.fecha || '').split('/').map(Number);
      const [hh, mm]         = (r.hora  || '').split(':').map(Number);
      if ([dia, mes, anio, hh, mm].some(isNaN)) return false;
      const fechaHora = new Date(anio, mes - 1, dia, hh, mm);
      const difHoras  = (fechaHora - ahora) / 3_600_000;
      return difHoras >= horasAntes - margenHoras && difHoras <= horasAntes + margenHoras;
    }).map(r => this._mapear(r));
  }

  // ─── OCUPACIÓN DEL DÍA ────────────────────────────────────

  async obtenerOcupacionDia(fecha) {
    const { rows: mesasRows } = await pool.query(
      `SELECT id, nombre, capacidad FROM mesas WHERE activa = true ORDER BY capacidad ASC, id ASC`
    );
    const { rows: reservas } = await pool.query(
      `SELECT r.id, r.mesa_id, r.mesas_ids, r.hora, r.hora_fin, r.duracion_minutos, r.nombre, r.personas
       FROM reservas r
       WHERE r.fecha = $1 AND r.estado = 'confirmada'
         AND (r.mesa_id IS NOT NULL OR r.mesas_ids IS NOT NULL)`,
      [fecha]
    );

    const franjas = restaurante.franjasHorarias;
    const celdas  = {};

    for (const franja of franjas) {
      const franjaMin = this._horaAMinutos(franja);
      for (const mesa of mesasRows) {
        const key = `${franja}-${mesa.id}`;
        const mesaReservas = reservas.filter(r => {
          const ids = r.mesas_ids?.length ? r.mesas_ids.map(Number) : (r.mesa_id ? [parseInt(r.mesa_id)] : []);
          return ids.includes(mesa.id);
        });

        let celda = { estado: 'libre' };
        for (const r of mesaReservas) {
          const inicioMin      = this._horaAMinutos(r.hora);
          const finClienteMin  = inicioMin + parseInt(r.duracion_minutos);
          const finTotalMin    = this._horaAMinutos(r.hora_fin);

          if (franjaMin >= inicioMin && franjaMin < finClienteMin) {
            celda = { estado: 'ocupada', nombre: r.nombre, personas: parseInt(r.personas), hora: r.hora, hora_fin: r.hora_fin };
            break;
          } else if (franjaMin >= finClienteMin && franjaMin < finTotalMin) {
            celda = { estado: 'limpieza' };
          }
        }
        celdas[key] = celda;
      }
    }

    return { franjas, mesas: mesasRows, celdas };
  }

  // ─── ANALYTICS ────────────────────────────────────────────

  async obtenerAnalytics({ desde, hasta }) {
    const { rows } = await pool.query(
      `SELECT fecha, hora, estado, personas FROM reservas
       WHERE estado IN ('confirmada', 'cancelada', 'no_show')`
    );

    const desdeDate = this._fechaADate(desde);
    const hastaDate = this._fechaADate(hasta);
    hastaDate.setHours(23, 59, 59);

    const enRango = rows.filter(r => {
      const d = this._fechaADate(r.fecha);
      return d >= desdeDate && d <= hastaDate;
    });

    // reservasPorDia
    const porDia = {};
    for (const r of enRango) {
      if (!porDia[r.fecha]) porDia[r.fecha] = { fecha: r.fecha, confirmadas: 0, canceladas: 0, no_shows: 0 };
      if (r.estado === 'confirmada')  porDia[r.fecha].confirmadas++;
      if (r.estado === 'cancelada')   porDia[r.fecha].canceladas++;
      if (r.estado === 'no_show')     porDia[r.fecha].no_shows++;
    }
    const reservasPorDia = Object.values(porDia).sort((a, b) => {
      return this._fechaADate(a.fecha) - this._fechaADate(b.fecha);
    });

    // horasPico (solo confirmadas)
    const porHora = {};
    for (const r of enRango.filter(r => r.estado === 'confirmada')) {
      porHora[r.hora] = (porHora[r.hora] || 0) + 1;
    }
    const horasPico = Object.entries(porHora)
      .map(([hora, total]) => ({ hora, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 6);

    const confirmadas  = enRango.filter(r => r.estado === 'confirmada');
    const canceladas   = enRango.filter(r => r.estado === 'cancelada');
    const noShows      = enRango.filter(r => r.estado === 'no_show');
    const totalPersonas = confirmadas.reduce((s, r) => s + parseInt(r.personas), 0);
    const totalOp       = confirmadas.length + canceladas.length + noShows.length;

    return {
      reservasPorDia,
      horasPico,
      totalReservas:    confirmadas.length,
      personasPromedio: confirmadas.length ? +(totalPersonas / confirmadas.length).toFixed(1) : 0,
      tasaCancelacion:  totalOp ? +((canceladas.length / totalOp) * 100).toFixed(1) : 0,
      tasaNoShow:       totalOp ? +((noShows.length / totalOp) * 100).toFixed(1) : 0,
    };
  }

  // ─── ADMIN — RESERVAS ─────────────────────────────────────

  async obtenerReservasFiltradas({ fecha, estado, search, desde, hasta } = {}) {
    const conditions = [];
    const params = [];
    let i = 1;

    if (fecha) {
      conditions.push(`r.fecha = $${i++}`);
      params.push(fecha);
    }
    if (estado && estado !== 'todas') {
      conditions.push(`r.estado = $${i++}`);
      params.push(estado);
    }
    if (search) {
      conditions.push(`(r.nombre ILIKE $${i} OR r.telefono ILIKE $${i + 1})`);
      params.push(`%${search}%`, `%${search}%`);
      i += 2;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT r.*,
         COALESCE(
           (SELECT STRING_AGG(m.nombre, ' + ' ORDER BY m.id) FROM mesas m WHERE m.id = ANY(r.mesas_ids)),
           (SELECT m.nombre FROM mesas m WHERE m.id = r.mesa_id)
         ) AS mesa_nombre
       FROM reservas r
       ${where} ORDER BY r.timestamp DESC LIMIT 200`,
      params
    );

    let result = rows.map(r => ({ ...this._mapear(r), mesa_nombre: r.mesa_nombre || null, timestamp: this._formatTs(r.timestamp) }));

    // Filtro por rango de fechas en JS (formato DD/MM/YYYY)
    if (desde) {
      const d = this._fechaADate(desde);
      result = result.filter(r => this._fechaADate(r.fecha) >= d);
    }
    if (hasta) {
      const h = this._fechaADate(hasta);
      h.setHours(23, 59, 59);
      result = result.filter(r => this._fechaADate(r.fecha) <= h);
    }

    return result;
  }

  async cancelarReservaPorId(id) {
    const { rows } = await pool.query(
      `UPDATE reservas SET estado = 'cancelada' WHERE id = $1 AND estado = 'confirmada' RETURNING *`, [id]
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
    const noShows     = rows.find(r => r.estado === 'no_show');
    return {
      confirmadas: parseInt(confirmadas?.total   || 0, 10),
      personas:    parseInt(confirmadas?.personas || 0, 10),
      canceladas:  parseInt(canceladas?.total    || 0, 10),
      no_shows:    parseInt(noShows?.total       || 0, 10),
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

  // ─── ADMIN — MESAS ────────────────────────────────────────

  async obtenerMesas() {
    const { rows } = await pool.query(
      `SELECT id, nombre, capacidad, activa FROM mesas ORDER BY capacidad ASC, id ASC`
    );
    return rows.map(r => ({ id: r.id, nombre: r.nombre, capacidad: parseInt(r.capacidad, 10), activa: r.activa }));
  }

  async crearMesa({ nombre, capacidad }) {
    const { rows } = await pool.query(
      `INSERT INTO mesas (nombre, capacidad) VALUES ($1, $2) RETURNING id, nombre, capacidad, activa`,
      [nombre, parseInt(capacidad, 10)]
    );
    const r = rows[0];
    return { id: r.id, nombre: r.nombre, capacidad: parseInt(r.capacidad, 10), activa: r.activa };
  }

  async obtenerCombinaciones() {
    const { rows } = await pool.query(
      `SELECT c.mesa_id_1, c.mesa_id_2, m1.nombre AS nombre_1, m2.nombre AS nombre_2
       FROM combinaciones_mesas c
       JOIN mesas m1 ON m1.id = c.mesa_id_1
       JOIN mesas m2 ON m2.id = c.mesa_id_2
       ORDER BY c.mesa_id_1, c.mesa_id_2`
    );
    return rows;
  }

  async agregarCombinacion(id1, id2) {
    const [a, b] = [Math.min(id1, id2), Math.max(id1, id2)];
    await pool.query(
      `INSERT INTO combinaciones_mesas (mesa_id_1, mesa_id_2) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [a, b]
    );
  }

  async eliminarCombinacion(id1, id2) {
    const [a, b] = [Math.min(id1, id2), Math.max(id1, id2)];
    await pool.query(
      `DELETE FROM combinaciones_mesas WHERE mesa_id_1 = $1 AND mesa_id_2 = $2`,
      [a, b]
    );
  }

  async actualizarMesa(id, campos) {
    const sets = []; const params = []; let i = 1;
    if (campos.nombre    !== undefined) { sets.push(`nombre    = $${i++}`); params.push(campos.nombre); }
    if (campos.capacidad !== undefined) { sets.push(`capacidad = $${i++}`); params.push(parseInt(campos.capacidad, 10)); }
    if (campos.activa    !== undefined) { sets.push(`activa    = $${i++}`); params.push(campos.activa); }
    if (!sets.length) return null;
    params.push(id);
    const { rows } = await pool.query(
      `UPDATE mesas SET ${sets.join(', ')} WHERE id = $${i} RETURNING id, nombre, capacidad, activa`,
      params
    );
    if (!rows.length) return null;
    const r = rows[0];
    return { id: r.id, nombre: r.nombre, capacidad: parseInt(r.capacidad, 10), activa: r.activa };
  }

  // ─── PRIVADOS ─────────────────────────────────────────────

  _calcularHoraFin(hora) {
    const [h, m] = hora.split(':').map(Number);
    const total  = h * 60 + m + restaurante.duracionReservaMinutos + restaurante.tiempoLimpiezaMinutos;
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }

  _horaAMinutos(hora) {
    const [h, m] = (hora || '00:00').split(':').map(Number);
    return h * 60 + m;
  }

  _fechaADate(ddmmyyyy) {
    if (!ddmmyyyy) return new Date(0);
    const [d, m, y] = ddmmyyyy.split('/').map(Number);
    return new Date(y, m - 1, d);
  }

  _mapear(r) {
    return {
      id:                   r.id,
      telefono:             r.telefono,
      nombre:               r.nombre,
      fecha:                r.fecha,
      hora:                 r.hora,
      hora_fin:             r.hora_fin || null,
      mesa_id:              r.mesa_id   ? parseInt(r.mesa_id, 10) : null,
      mesas_ids:            r.mesas_ids ?? null,
      personas:             parseInt(r.personas, 10),
      estado:               r.estado,
      confirmacion_enviada: r.confirmacion_enviada ?? false,
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
