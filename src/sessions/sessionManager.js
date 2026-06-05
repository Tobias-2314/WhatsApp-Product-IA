// ============================================================
// GESTOR DE SESIONES — L1 cache (Map) + L2 PostgreSQL
// ============================================================

const TIMEOUT_MINUTOS = 30;

// Importación lazy para evitar problemas de orden de carga circular
let _db = null;
function getDB() {
  if (!_db) _db = require('../db');
  return _db;
}

class SessionManager {
  constructor() {
    this.sessions = new Map();
    setInterval(() => this._limpiarExpiradas(), 10 * 60 * 1000);
  }

  obtenerSesion(telefono) {
    const sesion = this.sessions.get(telefono);
    if (!sesion) return null;
    if ((Date.now() - sesion.ultimaActividad) / 60000 > TIMEOUT_MINUTOS) {
      this.eliminarSesion(telefono);
      return null;
    }
    return sesion;
  }

  _nuevaSesion(telefono) {
    return {
      telefono,
      estado: 'inicio',
      historialConversacion: [],
      reservaPendiente: { nombre: null, fecha: null, hora: null, personas: null },
      modificacion: null,
      listaEsperaDisponible: null,
      ultimaActividad: Date.now(),
      modoHumano: false,
      encuestaReservaId: null,
    };
  }

  async obtenerOCrearSesion(telefono) {
    // L1
    const enMemoria = this.obtenerSesion(telefono);
    if (enMemoria) return enMemoria;

    // L2 — intentar recuperar de PostgreSQL
    try {
      const data = await getDB().cargarSesion(telefono);
      if (data) {
        // Revivir: restaurar ultimaActividad al momento actual para que no expire de inmediato
        data.ultimaActividad = Date.now();
        this.sessions.set(telefono, data);
        return data;
      }
    } catch { /* si falla DB, continuar con sesión nueva */ }

    // Sesión nueva
    const sesion = this._nuevaSesion(telefono);
    this.sessions.set(telefono, sesion);
    getDB().guardarSesion(telefono, sesion).catch(e => console.error('⚠️ guardarSesion nueva sesión:', e.message));
    return sesion;
  }

  async actualizarSesion(telefono, datos) {
    const sesion = this.sessions.get(telefono);
    if (!sesion) return null;
    Object.assign(sesion, datos, { ultimaActividad: Date.now() });
    try { await getDB().guardarSesion(telefono, sesion); } catch { /* L1 siempre actualizado */ }
    return sesion;
  }

  eliminarSesion(telefono) {
    this.sessions.delete(telefono);
    getDB().eliminarSesionDB(telefono).catch(e => console.error('⚠️ eliminarSesionDB:', e.message));
  }

  // Usado por el simulador /test
  crearSesion(telefono) {
    const sesion = this._nuevaSesion(telefono);
    this.sessions.set(telefono, sesion);
    getDB().guardarSesion(telefono, sesion).catch(e => console.error('⚠️ guardarSesion crearSesion:', e.message));
    return sesion;
  }

  _limpiarExpiradas() {
    const ahora = Date.now();
    for (const [telefono, sesion] of this.sessions.entries()) {
      if ((ahora - sesion.ultimaActividad) / 60000 > TIMEOUT_MINUTOS) {
        this.sessions.delete(telefono);
      }
    }
    getDB().limpiarSesionesExpiradas().catch(e => console.error('⚠️ limpiarSesionesExpiradas:', e.message));
  }
}

module.exports = new SessionManager();
