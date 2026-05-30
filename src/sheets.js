// ============================================================
// INTEGRACIÓN CON GOOGLE SHEETS
// CRUD de reservas usando la API de Google
// ============================================================

const { google } = require('googleapis');
const path = require('path');

const COLUMNAS = ['ID', 'Teléfono', 'Nombre', 'Fecha', 'Hora', 'Personas', 'Estado', 'Timestamp'];
const HOJA = 'Reservas';

// Índices de columna por nombre — evita magic numbers en el código.
// Si se agrega una columna en Sheets, actualizar solo aquí.
const COL = {
  ID:        0,
  TELEFONO:  1,
  NOMBRE:    2,
  FECHA:     3,
  HORA:      4,
  PERSONAS:  5,
  ESTADO:    6,
  TIMESTAMP: 7,
};

class SheetsManager {
  constructor() {
    this.sheets = null;
    this.spreadsheetId = null;
    // Caché en memoria con TTL: evita descargar toda la hoja en cada operación.
    // Se invalida inmediatamente después de cualquier escritura.
    this._cache = null; // { filas, offset, ts }
    this._CACHE_TTL = 30_000; // 30 segundos
  }

  async inicializar() {
    this.spreadsheetId = process.env.GOOGLE_SHEETS_ID;
    if (!this.spreadsheetId) throw new Error('GOOGLE_SHEETS_ID no está definido en .env');

    const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
    if (!keyPath) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY_PATH no está definido en .env');

    const auth = new google.auth.GoogleAuth({
      keyFile: path.resolve(keyPath),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    this.sheets = google.sheets({ version: 'v4', auth });

    // Crear encabezados si la hoja está vacía
    await this._inicializarEncabezados();
  }

  // ─── ESCRITURA ────────────────────────────────────────────

  /**
   * Guarda una nueva reserva y devuelve el objeto completo con ID.
   */
  async guardarReserva({ telefono, nombre, fecha, hora, personas }) {
    const id = this._generarId();
    const timestamp = new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });

    await this.sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: `${HOJA}!A:H`,
      valueInputOption: 'RAW',
      resource: {
        values: [[id, telefono, nombre, fecha, hora, String(personas), 'confirmada', timestamp]],
      },
    });

    this._invalidarCache();
    return { id, telefono, nombre, fecha, hora, personas, estado: 'confirmada' };
  }

  /**
   * Cancela la primera reserva activa de un teléfono (o por ID específico).
   * Devuelve la reserva cancelada, o null si no encontró ninguna.
   */
  async cancelarReserva(telefono, idReserva = null) {
    const { filas, offset } = await this._obtenerTodasLasFilas();

    for (let i = 0; i < filas.length; i++) {
      const fila = filas[i];
      const mismoTelefono = fila[COL.TELEFONO] === telefono;
      const estaConfirmada = fila[COL.ESTADO] === 'confirmada';
      const matchId = idReserva ? fila[COL.ID] === idReserva : true;

      if (mismoTelefono && estaConfirmada && matchId) {
        const filaReal = i + offset + 1; // +1 por índice 1-based de Sheets

        await this.sheets.spreadsheets.values.update({
          spreadsheetId: this.spreadsheetId,
          range: `${HOJA}!G${filaReal}`,
          valueInputOption: 'RAW',
          resource: { values: [['cancelada']] },
        });

        this._invalidarCache();
        return {
          id:       fila[COL.ID],
          telefono: fila[COL.TELEFONO],
          nombre:   fila[COL.NOMBRE],
          fecha:    fila[COL.FECHA],
          hora:     fila[COL.HORA],
          personas: fila[COL.PERSONAS],
        };
      }
    }

    return null;
  }

  // ─── LECTURA ──────────────────────────────────────────────

  /**
   * Devuelve todas las reservas confirmadas de un número de teléfono.
   */
  async obtenerReservasPorTelefono(telefono) {
    const { filas } = await this._obtenerTodasLasFilas();

    return filas
      .filter(fila => fila[COL.TELEFONO] === telefono && fila[COL.ESTADO] === 'confirmada')
      .map(fila => ({
        id:        fila[COL.ID],
        telefono:  fila[COL.TELEFONO],
        nombre:    fila[COL.NOMBRE],
        fecha:     fila[COL.FECHA],
        hora:      fila[COL.HORA],
        personas:  fila[COL.PERSONAS],
        estado:    fila[COL.ESTADO],
        timestamp: fila[COL.TIMESTAMP],
      }));
  }

  /**
   * Cuenta cuántas reservas confirmadas hay para una fecha y hora específicas.
   */
  async contarReservasEnFranja(fecha, hora) {
    const { filas } = await this._obtenerTodasLasFilas();

    return filas.filter(fila =>
      fila[COL.FECHA] === fecha &&
      fila[COL.HORA]  === hora  &&
      fila[COL.ESTADO] === 'confirmada'
    ).length;
  }

  /**
   * Devuelve qué franjas horarias tienen lugar disponible para una fecha dada.
   */
  async obtenerFranjasDisponibles(fecha, franjasHorarias, capacidadMaxima) {
    const { filas } = await this._obtenerTodasLasFilas();

    const disponibles = [];
    for (const hora of franjasHorarias) {
      const ocupadas = filas.filter(f =>
        f[COL.FECHA]  === fecha &&
        f[COL.HORA]   === hora  &&
        f[COL.ESTADO] === 'confirmada'
      ).length;

      if (ocupadas < capacidadMaxima) {
        disponibles.push({ hora, lugaresDisponibles: capacidadMaxima - ocupadas });
      }
    }

    return disponibles;
  }

  // ─── LECTURA AVANZADA ─────────────────────────────────────

  /**
   * Devuelve la primera reserva confirmada de un teléfono, o null.
   */
  async obtenerReservaActiva(telefono) {
    const { filas } = await this._obtenerTodasLasFilas();
    const fila = filas.find(f => f[COL.TELEFONO] === telefono && f[COL.ESTADO] === 'confirmada');
    if (!fila) return null;
    return {
      id:       fila[COL.ID],
      telefono: fila[COL.TELEFONO],
      nombre:   fila[COL.NOMBRE],
      fecha:    fila[COL.FECHA],
      hora:     fila[COL.HORA],
      personas: fila[COL.PERSONAS],
    };
  }

  /**
   * Devuelve reservas confirmadas cuya fecha+hora está dentro de la ventana
   * [horasAntes - margenHoras, horasAntes + margenHoras] desde ahora.
   * Usada por el scheduler de recordatorios (por defecto: 24 h ± 30 min).
   */
  async obtenerReservasProximas(horasAntes = 24, margenHoras = 0.5) {
    const { filas } = await this._obtenerTodasLasFilas();
    const ahora = new Date();

    return filas.filter(fila => {
      if (fila[COL.ESTADO] !== 'confirmada') return false;
      const [dia, mes, anio] = (fila[COL.FECHA] || '').split('/').map(Number);
      const [hh, mm]         = (fila[COL.HORA]  || '').split(':').map(Number);
      if ([dia, mes, anio, hh, mm].some(isNaN)) return false;
      const fechaHora = new Date(anio, mes - 1, dia, hh, mm);
      const difHoras  = (fechaHora - ahora) / 3_600_000;
      return difHoras >= horasAntes - margenHoras && difHoras <= horasAntes + margenHoras;
    }).map(fila => ({
      id:       fila[COL.ID],
      telefono: fila[COL.TELEFONO],
      nombre:   fila[COL.NOMBRE],
      fecha:    fila[COL.FECHA],
      hora:     fila[COL.HORA],
      personas: fila[COL.PERSONAS],
    }));
  }

  /**
   * Actualiza fecha, hora y/o personas de la primera reserva confirmada del teléfono.
   * Solo modifica los campos presentes en `campos` (los demás quedan igual).
   */
  async modificarReserva(telefono, campos) {
    const { filas, offset } = await this._obtenerTodasLasFilas();

    for (let i = 0; i < filas.length; i++) {
      const fila = filas[i];
      if (fila[COL.TELEFONO] !== telefono || fila[COL.ESTADO] !== 'confirmada') continue;

      const filaReal       = i + offset + 1;
      const nuevaFecha     = campos.fecha     ?? fila[COL.FECHA];
      const nuevaHora      = campos.hora      ?? fila[COL.HORA];
      const nuevasPersonas = campos.personas  ?? fila[COL.PERSONAS];

      // Actualiza columnas D (Fecha), E (Hora), F (Personas) en un solo call
      await this.sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        resource: {
          valueInputOption: 'RAW',
          data: [{
            range:  `${HOJA}!D${filaReal}:F${filaReal}`,
            values: [[nuevaFecha, nuevaHora, String(nuevasPersonas)]],
          }],
        },
      });

      this._invalidarCache();
      return {
        id:       fila[COL.ID],
        telefono: fila[COL.TELEFONO],
        nombre:   fila[COL.NOMBRE],
        fecha:    nuevaFecha,
        hora:     nuevaHora,
        personas: nuevasPersonas,
      };
    }

    return null;
  }

  // ─── PRIVADOS ─────────────────────────────────────────────

  async _obtenerTodasLasFilas() {
    if (this._cache && Date.now() - this._cache.ts < this._CACHE_TTL) {
      return { filas: this._cache.filas, offset: this._cache.offset };
    }

    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `${HOJA}!A:H`,
    });

    const valores = response.data.values || [];
    const filas   = valores.slice(1);
    this._cache   = { filas, offset: 1, ts: Date.now() };
    return { filas, offset: 1 };
  }

  _invalidarCache() {
    this._cache = null;
  }

  async _inicializarEncabezados() {
    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `${HOJA}!A1:H1`,
    });

    const tieneEncabezados = response.data.values && response.data.values.length > 0;
    if (!tieneEncabezados) {
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `${HOJA}!A1:H1`,
        valueInputOption: 'RAW',
        resource: { values: [COLUMNAS] },
      });
      console.log('✅ Encabezados creados en Google Sheets');
    }
  }

  _generarId() {
    // ID corto legible: timestamp en base36 + 3 chars aleatorios
    const ts = Date.now().toString(36).toUpperCase();
    const rand = Math.random().toString(36).substring(2, 5).toUpperCase();
    return `R${ts}${rand}`;
  }
}

module.exports = new SheetsManager();
