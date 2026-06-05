// ============================================================
// CAPA DE DATOS — PostgreSQL
// ============================================================

const { Pool } = require('pg');
const restaurante    = require('../config/restaurant');
const configManager  = require('./configManager');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

const RESTAURANTE_ID = parseInt(process.env.RESTAURANTE_ID || '1', 10);

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
      ALTER TABLE reservas ADD COLUMN IF NOT EXISTS aviso_2h_enviado     BOOLEAN NOT NULL DEFAULT false;
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

    // Config dinámica del restaurante (sobreescribe restaurant.js)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS configuracion (
        id   INTEGER PRIMARY KEY DEFAULT 1,
        data JSONB   NOT NULL DEFAULT '{}'
      );
    `);

    // Multi-tenant: tabla de restaurantes (para SaaS)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS restaurantes (
        id          SERIAL       PRIMARY KEY,
        nombre      VARCHAR(200) NOT NULL,
        slug        VARCHAR(50)  UNIQUE NOT NULL,
        admin_token VARCHAR(200) NOT NULL,
        whatsapp    VARCHAR(50),
        plan        VARCHAR(20)  NOT NULL DEFAULT 'basico',
        activo      BOOLEAN      NOT NULL DEFAULT true,
        created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );
    `);

    await pool.query(`
      ALTER TABLE reservas ADD COLUMN IF NOT EXISTS deposito_estado VARCHAR(20);
      ALTER TABLE reservas ADD COLUMN IF NOT EXISTS deposito_monto  INTEGER;
      ALTER TABLE reservas ADD COLUMN IF NOT EXISTS deposito_mp_id  VARCHAR(100);
    `);

    // Posiciones en el plano del salón
    await pool.query(`
      ALTER TABLE mesas ADD COLUMN IF NOT EXISTS x_pos INTEGER DEFAULT NULL;
      ALTER TABLE mesas ADD COLUMN IF NOT EXISTS y_pos INTEGER DEFAULT NULL;
    `);

    // Multi-tenant: aislamiento por restaurante
    await pool.query(`
      ALTER TABLE reservas     ADD COLUMN IF NOT EXISTS restaurante_id INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE mesas        ADD COLUMN IF NOT EXISTS restaurante_id INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE lista_espera ADD COLUMN IF NOT EXISTS restaurante_id INTEGER NOT NULL DEFAULT 1;
    `);

    // Encuestas post-visita y fechas bloqueadas
    await pool.query(`
      ALTER TABLE reservas ADD COLUMN IF NOT EXISTS encuesta_enviada BOOLEAN NOT NULL DEFAULT false;
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS resenas (
        id             SERIAL       PRIMARY KEY,
        reserva_id     VARCHAR(20)  REFERENCES reservas(id),
        telefono       VARCHAR(50)  NOT NULL,
        puntuacion     INTEGER      CHECK (puntuacion BETWEEN 1 AND 5),
        restaurante_id INTEGER      NOT NULL DEFAULT 1,
        created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS fechas_bloqueadas (
        id             SERIAL       PRIMARY KEY,
        fecha          VARCHAR(10)  NOT NULL,
        motivo         VARCHAR(200),
        restaurante_id INTEGER      NOT NULL DEFAULT 1
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
      CREATE INDEX IF NOT EXISTS idx_reservas_rid_fecha  ON reservas(restaurante_id, fecha);
      CREATE INDEX IF NOT EXISTS idx_mesas_rid           ON mesas(restaurante_id);
      CREATE INDEX IF NOT EXISTS idx_lista_espera_rid    ON lista_espera(restaurante_id);
      CREATE INDEX IF NOT EXISTS idx_fechas_bloqueadas_rid ON fechas_bloqueadas(restaurante_id, fecha);
    `);

    // Seed de mesas si la tabla está vacía
    const { rows: cnt } = await pool.query(`SELECT COUNT(*) AS n FROM mesas WHERE restaurante_id = ${RESTAURANTE_ID}`);
    if (parseInt(cnt[0].n, 10) === 0 && restaurante.mesasIniciales?.length) {
      for (const m of restaurante.mesasIniciales) {
        await pool.query(
          `INSERT INTO mesas (nombre, capacidad, restaurante_id) VALUES ($1, $2, ${RESTAURANTE_ID})`,
          [m.nombre, m.capacidad]
        );
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
      `INSERT INTO lista_espera (telefono, nombre, fecha, hora, personas, restaurante_id)
       VALUES ($1, $2, $3, $4, $5, ${RESTAURANTE_ID}) RETURNING *`,
      [telefono, nombre ?? null, fecha, hora, personas]
    );
    return rows[0];
  }

  async obtenerPrimeraListaEspera(fecha, hora, personas) {
    const { rows } = await pool.query(
      `SELECT * FROM lista_espera
       WHERE fecha = $1 AND hora = $2 AND personas <= $3 AND estado = 'pendiente' AND restaurante_id = ${RESTAURANTE_ID}
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
      `SELECT * FROM lista_espera WHERE telefono = $1 AND estado = 'pendiente' AND restaurante_id = ${RESTAURANTE_ID} ORDER BY created_at ASC`,
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
      `INSERT INTO reservas (id, telefono, nombre, fecha, hora, personas, estado, mesa_id, mesas_ids, duracion_minutos, hora_fin, restaurante_id)
       VALUES ($1, $2, $3, $4, $5, $6, 'confirmada', $7, $8, $9, $10, ${RESTAURANTE_ID})`,
      [id, telefono, nombre, fecha, hora, personas, ids?.[0] ?? null, ids, duracion, horaFin]
    );
    return { id, telefono, nombre, fecha, hora, hora_fin: horaFin, personas, estado: 'confirmada', mesas_ids: ids };
  }

  async guardarReservaAtomico({ telefono, nombre, fecha, hora, personas }) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const horaFin = this._calcularHoraFin(hora);

      // Bloquea todas las mesas activas para evitar asignación concurrente
      const { rows: todasMesas } = await client.query(
        `SELECT id, nombre, capacidad FROM mesas WHERE activa = true AND restaurante_id = ${RESTAURANTE_ID} ORDER BY capacidad ASC, id ASC FOR UPDATE`
      );

      const [{ rows: conflictos }, { rows: combRows }] = await Promise.all([
        client.query(
          `SELECT mesa_id, mesas_ids FROM reservas
           WHERE fecha = $1 AND estado = 'confirmada' AND hora < $2 AND hora_fin > $3 AND restaurante_id = ${RESTAURANTE_ID}`,
          [fecha, horaFin, hora]
        ),
        client.query(`SELECT mesa_id_1, mesa_id_2 FROM combinaciones_mesas`),
      ]);

      const ocupadas = _ocupadasDesdeConflictos(conflictos);
      const libres   = todasMesas.filter(m => !ocupadas.has(m.id));
      const combSet  = new Set(combRows.map(r => `${r.mesa_id_1}-${r.mesa_id_2}`));
      const mesa     = _asignarDesdeLibres(libres, personas, combSet);

      if (!mesa) { await client.query('ROLLBACK'); return null; }

      const id       = this._generarId();
      const duracion = restaurante.duracionReservaMinutos;

      await client.query(
        `INSERT INTO reservas (id, telefono, nombre, fecha, hora, personas, estado, mesa_id, mesas_ids, duracion_minutos, hora_fin, restaurante_id)
         VALUES ($1, $2, $3, $4, $5, $6, 'confirmada', $7, $8, $9, $10, ${RESTAURANTE_ID})`,
        [id, telefono, nombre, fecha, hora, personas, mesa.ids[0], mesa.ids, duracion, horaFin]
      );

      await client.query('COMMIT');
      return {
        reserva: { id, telefono, nombre, fecha, hora, hora_fin: horaFin, personas, estado: 'confirmada', mesas_ids: mesa.ids },
        mesa,
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async cancelarReserva(telefono, idReserva = null) {
    let rows;
    if (idReserva) {
      ({ rows } = await pool.query(
        `UPDATE reservas SET estado = 'cancelada'
         WHERE telefono = $1 AND id = $2 AND estado = 'confirmada' AND restaurante_id = ${RESTAURANTE_ID} RETURNING *`,
        [telefono, idReserva]
      ));
    } else {
      ({ rows } = await pool.query(
        `UPDATE reservas SET estado = 'cancelada'
         WHERE id = (
           SELECT id FROM reservas WHERE telefono = $1 AND estado = 'confirmada' AND restaurante_id = ${RESTAURANTE_ID}
           ORDER BY fecha ASC, hora ASC LIMIT 1
         ) RETURNING *`,
        [telefono]
      ));
    }
    if (!rows.length) return null;
    return this._mapear(rows[0]);
  }

  async modificarReserva(telefono, campos) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: actual } = await client.query(
        `SELECT * FROM reservas WHERE telefono = $1 AND estado = 'confirmada' AND restaurante_id = ${RESTAURANTE_ID} ORDER BY timestamp ASC LIMIT 1 FOR UPDATE`,
        [telefono]
      );
      if (!actual.length) { await client.query('ROLLBACK'); return null; }
      const r = actual[0];

      const nuevaFecha     = campos.fecha    ?? r.fecha;
      const nuevaHora      = campos.hora     ?? r.hora;
      const nuevasPersonas = campos.personas ?? parseInt(r.personas, 10);
      const cambiaSlot     = nuevaFecha !== r.fecha || nuevaHora !== r.hora || nuevasPersonas !== parseInt(r.personas, 10);

      let nuevaMesaId    = r.mesa_id   ? parseInt(r.mesa_id, 10) : null;
      let nuevasMesasIds = r.mesas_ids ?? null;
      let nuevaHoraFin   = r.hora_fin  || this._calcularHoraFin(nuevaHora);

      if (cambiaSlot) {
        const horaFin = this._calcularHoraFin(nuevaHora);

        const { rows: todasMesas } = await client.query(
          `SELECT id, nombre, capacidad FROM mesas WHERE activa = true AND restaurante_id = ${RESTAURANTE_ID} ORDER BY capacidad ASC, id ASC FOR UPDATE`
        );
        const [{ rows: conflictos }, { rows: combRows }] = await Promise.all([
          client.query(
            `SELECT mesa_id, mesas_ids FROM reservas
             WHERE fecha = $1 AND estado = 'confirmada' AND hora < $2 AND hora_fin > $3 AND id != $4 AND restaurante_id = ${RESTAURANTE_ID}`,
            [nuevaFecha, horaFin, nuevaHora, r.id]
          ),
          client.query(`SELECT mesa_id_1, mesa_id_2 FROM combinaciones_mesas`),
        ]);

        const ocupadas = _ocupadasDesdeConflictos(conflictos);
        const libres   = todasMesas.filter(m => !ocupadas.has(m.id));
        const combSet  = new Set(combRows.map(c => `${c.mesa_id_1}-${c.mesa_id_2}`));
        const mesa     = _asignarDesdeLibres(libres, nuevasPersonas, combSet);

        if (!mesa) { await client.query('ROLLBACK'); return { error: 'no_disponibilidad' }; }

        nuevaMesaId    = mesa.ids[0];
        nuevasMesasIds = mesa.ids;
        nuevaHoraFin   = horaFin;
      }

      await client.query(
        `UPDATE reservas SET fecha = $1, hora = $2, personas = $3, mesa_id = $4, mesas_ids = $5, hora_fin = $6 WHERE id = $7`,
        [nuevaFecha, nuevaHora, nuevasPersonas, nuevaMesaId, nuevasMesasIds, nuevaHoraFin, r.id]
      );

      await client.query('COMMIT');
      return {
        id: r.id, telefono: r.telefono, nombre: r.nombre,
        fecha: nuevaFecha, hora: nuevaHora, hora_fin: nuevaHoraFin, personas: nuevasPersonas,
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async marcarConfirmacionEnviada(id) {
    await pool.query(
      `UPDATE reservas SET confirmacion_enviada = true WHERE id = $1`, [id]
    );
  }

  async marcarAviso2hEnviado(id) {
    await pool.query(
      `UPDATE reservas SET aviso_2h_enviado = true WHERE id = $1`, [id]
    );
  }

  async marcarEncuestaEnviada(id) {
    await pool.query(`UPDATE reservas SET encuesta_enviada = true WHERE id = $1`, [id]);
  }

  async obtenerReservasParaEncuesta() {
    const ahoraAR = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }));
    const fechas = new Set();
    for (let h = 19; h <= 29; h++) {
      const d = new Date(ahoraAR.getTime() - h * 3_600_000);
      fechas.add(`${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`);
    }
    const fechasArr = [...fechas];
    const phs = fechasArr.map((_, i) => `$${i + 1}`).join(', ');
    const { rows } = await pool.query(
      `SELECT * FROM reservas WHERE estado = 'confirmada' AND encuesta_enviada = false
       AND restaurante_id = ${RESTAURANTE_ID} AND fecha IN (${phs})`,
      fechasArr
    );
    const ahora = new Date();
    return rows.filter(r => {
      const [dia, mes, anio] = (r.fecha || '').split('/').map(Number);
      const [hh, mm]         = (r.hora  || '').split(':').map(Number);
      if ([dia, mes, anio, hh, mm].some(isNaN)) return false;
      const fechaHora = new Date(anio, mes - 1, dia, hh, mm);
      const dif = (ahora - fechaHora) / 3_600_000;
      return dif >= 20 && dif <= 28;
    }).map(r => this._mapear(r));
  }

  async guardarResena({ reservaId, telefono, puntuacion }) {
    await pool.query(
      `INSERT INTO resenas (reserva_id, telefono, puntuacion, restaurante_id)
       VALUES ($1, $2, $3, ${RESTAURANTE_ID})`,
      [reservaId, telefono, puntuacion]
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
      `SELECT COUNT(*) AS total FROM reservas WHERE telefono = $1 AND estado = 'no_show' AND restaurante_id = ${RESTAURANTE_ID}`, [telefono]
    );
    return parseInt(rows[0].total, 10);
  }

  // ─── DISPONIBILIDAD ───────────────────────────────────────

  async asignarMesa(fecha, hora, personas) {
    return this._asignarMesaExcluyendo(fecha, hora, personas, null);
  }

  async _asignarMesaExcluyendo(fecha, hora, personas, excludeId) {
    const horaFin     = this._calcularHoraFin(hora);
    const conflCond   = excludeId ? ' AND r.id != $4' : '';
    const conflParams = excludeId ? [fecha, horaFin, hora, excludeId] : [fecha, horaFin, hora];

    const [{ rows: conflictos }, { rows: todasMesas }, { rows: combRows }] = await Promise.all([
      pool.query(
        `SELECT r.mesa_id, r.mesas_ids FROM reservas r
         WHERE r.fecha = $1 AND r.estado = 'confirmada'
           AND r.hora < $2 AND r.hora_fin > $3 AND r.restaurante_id = ${RESTAURANTE_ID} ${conflCond}`,
        conflParams
      ),
      pool.query(`SELECT id, nombre, capacidad FROM mesas WHERE activa = true AND restaurante_id = ${RESTAURANTE_ID} ORDER BY capacidad ASC, id ASC`),
      pool.query(`SELECT mesa_id_1, mesa_id_2 FROM combinaciones_mesas`),
    ]);

    const ocupadasSet = _ocupadasDesdeConflictos(conflictos);
    const libres      = todasMesas.filter(m => !ocupadasSet.has(m.id));
    const combSet     = new Set(combRows.map(r => `${r.mesa_id_1}-${r.mesa_id_2}`));

    return _asignarDesdeLibres(libres, personas, combSet);
  }

  async obtenerFranjasDisponibles(fecha, franjasHorarias, personas) {
    // 3 queries totales para todas las franjas (en lugar de 3 × N)
    const [{ rows: reservasDelDia }, { rows: todasMesas }, { rows: combRows }] = await Promise.all([
      pool.query(
        `SELECT r.mesa_id, r.mesas_ids, r.hora, r.hora_fin FROM reservas r
         WHERE r.fecha = $1 AND r.estado = 'confirmada'
           AND (r.mesa_id IS NOT NULL OR r.mesas_ids IS NOT NULL) AND r.restaurante_id = ${RESTAURANTE_ID}`,
        [fecha]
      ),
      pool.query(`SELECT id, nombre, capacidad FROM mesas WHERE activa = true AND restaurante_id = ${RESTAURANTE_ID} ORDER BY capacidad ASC, id ASC`),
      pool.query(`SELECT mesa_id_1, mesa_id_2 FROM combinaciones_mesas`),
    ]);

    const combSet  = new Set(combRows.map(r => `${r.mesa_id_1}-${r.mesa_id_2}`));
    const resultado = [];

    for (const hora of franjasHorarias) {
      const horaFin    = this._calcularHoraFin(hora);
      const conflictos = reservasDelDia.filter(r => r.hora < horaFin && (r.hora_fin || '99:99') > hora);
      const ocupadas   = _ocupadasDesdeConflictos(conflictos);
      const libres     = todasMesas.filter(m => !ocupadas.has(m.id));
      const mesa       = _asignarDesdeLibres(libres, personas, combSet);
      if (mesa) resultado.push({ hora, combinada: mesa.ids.length > 1 });
    }
    return resultado;
  }

  // ─── LECTURA DE RESERVAS ──────────────────────────────────

  async obtenerReservasPorFecha(fecha) {
    const { rows } = await pool.query(
      `SELECT * FROM reservas WHERE fecha = $1 AND restaurante_id = ${RESTAURANTE_ID} ORDER BY hora ASC`, [fecha]
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
       WHERE r.telefono = $1 AND r.estado = 'confirmada' AND r.restaurante_id = ${RESTAURANTE_ID} ORDER BY r.timestamp ASC`,
      [telefono]
    );
    return rows.map(r => ({ ...this._mapear(r), mesa_nombre: r.mesa_nombre || null, timestamp: this._formatTs(r.timestamp) }));
  }

  async obtenerReservaActiva(telefono) {
    const { rows } = await pool.query(
      `SELECT * FROM reservas WHERE telefono = $1 AND estado = 'confirmada' AND restaurante_id = ${RESTAURANTE_ID} ORDER BY fecha ASC, hora ASC LIMIT 1`,
      [telefono]
    );
    if (!rows.length) return null;
    return this._mapear(rows[0]);
  }

  async obtenerReservasProximas(horasAntes = 24, margenHoras = 0.5, { soloConConfirmacion = false } = {}) {
    const condicion = soloConConfirmacion
      ? `AND confirmacion_enviada = true AND aviso_2h_enviado = false`
      : `AND confirmacion_enviada = false`;

    // Pre-filtrar por fechas candidatas para evitar traer toda la tabla
    const ahoraAR = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }));
    const fechas  = new Set();
    for (let h = Math.floor(horasAntes - margenHoras - 1); h <= Math.ceil(horasAntes + margenHoras + 1); h++) {
      const d = new Date(ahoraAR.getTime() + h * 3_600_000);
      fechas.add(`${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`);
    }
    const fechasArr    = [...fechas];
    const placeholders = fechasArr.map((_, i) => `$${i + 1}`).join(', ');

    const { rows } = await pool.query(
      `SELECT * FROM reservas WHERE estado = 'confirmada' ${condicion} AND fecha IN (${placeholders}) AND restaurante_id = ${RESTAURANTE_ID}`,
      fechasArr
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
      `SELECT id, nombre, capacidad, x_pos, y_pos FROM mesas WHERE activa = true AND restaurante_id = ${RESTAURANTE_ID} ORDER BY capacidad ASC, id ASC`
    );
    const { rows: reservas } = await pool.query(
      `SELECT r.id, r.mesa_id, r.mesas_ids, r.hora, r.hora_fin, r.duracion_minutos, r.nombre, r.personas
       FROM reservas r
       WHERE r.fecha = $1 AND r.estado = 'confirmada'
         AND (r.mesa_id IS NOT NULL OR r.mesas_ids IS NOT NULL) AND r.restaurante_id = ${RESTAURANTE_ID}`,
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
    const { rows: enRango } = await pool.query(
      `SELECT fecha, hora, estado, personas FROM reservas
       WHERE estado IN ('confirmada', 'cancelada', 'no_show')
         AND TO_DATE(fecha, 'DD/MM/YYYY') >= TO_DATE($1, 'DD/MM/YYYY')
         AND TO_DATE(fecha, 'DD/MM/YYYY') <= TO_DATE($2, 'DD/MM/YYYY')
         AND restaurante_id = ${RESTAURANTE_ID}`,
      [desde, hasta]
    );

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
    const conditions = [`r.restaurante_id = ${RESTAURANTE_ID}`];
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
    if (desde) {
      conditions.push(`TO_DATE(r.fecha, 'DD/MM/YYYY') >= TO_DATE($${i++}, 'DD/MM/YYYY')`);
      params.push(desde);
    }
    if (hasta) {
      conditions.push(`TO_DATE(r.fecha, 'DD/MM/YYYY') <= TO_DATE($${i++}, 'DD/MM/YYYY')`);
      params.push(hasta);
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

    return rows.map(r => ({ ...this._mapear(r), mesa_nombre: r.mesa_nombre || null, timestamp: this._formatTs(r.timestamp) }));
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
       FROM reservas WHERE fecha = $1 AND restaurante_id = ${RESTAURANTE_ID} GROUP BY estado`,
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
      `SELECT COUNT(*) AS total FROM reservas WHERE fecha IN (${placeholders}) AND estado = 'confirmada' AND restaurante_id = ${RESTAURANTE_ID}`,
      fechas
    );
    return parseInt(rows[0].total, 10);
  }

  // ─── ADMIN — MESAS ────────────────────────────────────────

  async obtenerMesas() {
    const { rows } = await pool.query(
      `SELECT id, nombre, capacidad, activa, x_pos, y_pos FROM mesas WHERE restaurante_id = ${RESTAURANTE_ID} ORDER BY capacidad ASC, id ASC`
    );
    return rows.map(r => ({ id: r.id, nombre: r.nombre, capacidad: parseInt(r.capacidad, 10), activa: r.activa, x_pos: r.x_pos ?? null, y_pos: r.y_pos ?? null }));
  }

  async crearMesa({ nombre, capacidad }) {
    const { rows } = await pool.query(
      `INSERT INTO mesas (nombre, capacidad, restaurante_id) VALUES ($1, $2, ${RESTAURANTE_ID}) RETURNING id, nombre, capacidad, activa, x_pos, y_pos`,
      [nombre, parseInt(capacidad, 10)]
    );
    const r = rows[0];
    return { id: r.id, nombre: r.nombre, capacidad: parseInt(r.capacidad, 10), activa: r.activa, x_pos: r.x_pos ?? null, y_pos: r.y_pos ?? null };
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
    if (campos.x_pos     !== undefined) { sets.push(`x_pos     = $${i++}`); params.push(campos.x_pos === null ? null : parseInt(campos.x_pos, 10)); }
    if (campos.y_pos     !== undefined) { sets.push(`y_pos     = $${i++}`); params.push(campos.y_pos === null ? null : parseInt(campos.y_pos, 10)); }
    if (!sets.length) return null;
    params.push(id);
    const { rows } = await pool.query(
      `UPDATE mesas SET ${sets.join(', ')} WHERE id = $${i} RETURNING id, nombre, capacidad, activa, x_pos, y_pos`,
      params
    );
    if (!rows.length) return null;
    const r = rows[0];
    return { id: r.id, nombre: r.nombre, capacidad: parseInt(r.capacidad, 10), activa: r.activa, x_pos: r.x_pos ?? null, y_pos: r.y_pos ?? null };
  }

  // ─── CONFIGURACIÓN ────────────────────────────────────────

  async leerConfig() {
    const { rows } = await pool.query('SELECT data FROM configuracion WHERE id = 1');
    return rows[0]?.data || {};
  }

  async guardarConfig(campos) {
    const actual = await this.leerConfig();
    const nuevo  = { ...actual, ...campos };
    await pool.query(
      `INSERT INTO configuracion (id, data) VALUES (1, $1)
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
      [JSON.stringify(nuevo)]
    );
    return nuevo;
  }

  // ─── FECHAS BLOQUEADAS ────────────────────────────────────

  async bloquearFecha(fecha, motivo) {
    const { rows } = await pool.query(
      `INSERT INTO fechas_bloqueadas (fecha, motivo, restaurante_id)
       VALUES ($1, $2, ${RESTAURANTE_ID}) RETURNING *`,
      [fecha, motivo || null]
    );
    return rows[0];
  }

  async desbloquearFecha(id) {
    await pool.query(
      `DELETE FROM fechas_bloqueadas WHERE id = $1 AND restaurante_id = ${RESTAURANTE_ID}`,
      [id]
    );
  }

  async listarFechasBloqueadas() {
    const { rows } = await pool.query(
      `SELECT * FROM fechas_bloqueadas WHERE restaurante_id = ${RESTAURANTE_ID} ORDER BY fecha ASC`
    );
    return rows;
  }

  async esFechaBloqueada(fecha) {
    const { rows } = await pool.query(
      `SELECT 1 FROM fechas_bloqueadas WHERE fecha = $1 AND restaurante_id = ${RESTAURANTE_ID} LIMIT 1`,
      [fecha]
    );
    return rows.length > 0;
  }

  // ─── RESTAURANTES (multi-tenant) ──────────────────────────

  async listarRestaurantes() {
    const { rows } = await pool.query(
      `SELECT id, nombre, slug, whatsapp, plan, activo, created_at FROM restaurantes ORDER BY created_at DESC`
    );
    return rows;
  }

  async crearRestaurante({ nombre, slug, admin_token, whatsapp, plan }) {
    const { rows } = await pool.query(
      `INSERT INTO restaurantes (nombre, slug, admin_token, whatsapp, plan)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, nombre, slug, whatsapp, plan, activo`,
      [nombre, slug, admin_token, whatsapp || null, plan || 'basico']
    );
    return rows[0];
  }

  // ─── MERCADOPAGO ──────────────────────────────────────────

  async actualizarDepositoReserva(id, { estado, mp_id }) {
    const { rows } = await pool.query(
      `UPDATE reservas SET deposito_estado = $1, deposito_mp_id = $2 WHERE id = $3 RETURNING *`,
      [estado, mp_id || null, id]
    );
    return rows[0] ? this._mapear(rows[0]) : null;
  }

  // ─── PRIVADOS ─────────────────────────────────────────────

  _calcularHoraFin(hora) {
    const cfg      = configManager.get();
    const duracion = cfg.duracionReservaMinutos ?? restaurante.duracionReservaMinutos;
    const limpieza = cfg.tiempoLimpiezaMinutos  ?? restaurante.tiempoLimpiezaMinutos;
    const [h, m]   = hora.split(':').map(Number);
    const total    = h * 60 + m + duracion + limpieza;
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
      deposito_estado:      r.deposito_estado || null,
      deposito_monto:       r.deposito_monto  ? parseInt(r.deposito_monto) : null,
      deposito_mp_id:       r.deposito_mp_id  || null,
      encuesta_enviada:     r.encuesta_enviada ?? false,
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

// ─── HELPERS PUROS (sin DB) ───────────────────────────────────

function _ocupadasDesdeConflictos(conflictos) {
  const set = new Set();
  for (const r of conflictos) {
    if (r.mesas_ids?.length) r.mesas_ids.forEach(id => set.add(parseInt(id)));
    else if (r.mesa_id)       set.add(parseInt(r.mesa_id));
  }
  return set;
}

function _asignarDesdeLibres(libres, personas, combSet) {
  const esPar = (a, b) => combSet.has(`${Math.min(a, b)}-${Math.max(a, b)}`);

  // Mesa individual (best-fit: la más chica que alcanza)
  const single = libres.find(m => m.capacidad >= personas);
  if (single) return { id: single.id, ids: [single.id], nombre: single.nombre, capacidad: single.capacidad };

  const maxCombinadas = restaurante.maxMesasCombinadas ?? 2;
  if (maxCombinadas < 2 || !combSet.size) return null;

  // Pares permitidos (best-fit)
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

  // Tríos permitidos (solo si maxMesasCombinadas >= 3 y todos los pares están habilitados)
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

module.exports = new DBManager();
module.exports.pool = pool;
