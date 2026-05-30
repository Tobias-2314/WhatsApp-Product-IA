// ============================================================
// GESTOR DE SESIONES DE CONVERSACIÓN
// Mantiene el contexto de cada cliente con timeout automático
// ============================================================

const TIMEOUT_MINUTOS = 30;

class SessionManager {
  constructor() {
    // Map de telefono → sesión
    this.sessions = new Map();

    // Limpieza automática cada 10 minutos
    setInterval(() => this._limpiarSesionesExpiradas(), 10 * 60 * 1000);
  }

  /**
   * Obtiene una sesión existente si no expiró, o null si expiró/no existe.
   */
  obtenerSesion(telefono) {
    const sesion = this.sessions.get(telefono);
    if (!sesion) return null;

    const minutosInactivo = (Date.now() - sesion.ultimaActividad) / 1000 / 60;
    if (minutosInactivo > TIMEOUT_MINUTOS) {
      this.eliminarSesion(telefono);
      return null;
    }

    return sesion;
  }

  /**
   * Crea una nueva sesión limpia para un número de teléfono.
   */
  crearSesion(telefono) {
    const sesion = {
      telefono,
      estado: 'inicio',
      historialConversacion: [],
      reservaPendiente: {
        nombre: null,
        fecha: null,
        hora: null,
        personas: null,
      },
      ultimaActividad: Date.now(),
      modoHumano: false,
    };

    this.sessions.set(telefono, sesion);
    return sesion;
  }

  /**
   * Obtiene sesión existente o crea una nueva si no existe o expiró.
   */
  obtenerOCrearSesion(telefono) {
    return this.obtenerSesion(telefono) || this.crearSesion(telefono);
  }

  /**
   * Actualiza campos de una sesión y refresca el timestamp de actividad.
   */
  actualizarSesion(telefono, datos) {
    const sesion = this.sessions.get(telefono);
    if (!sesion) return null;

    Object.assign(sesion, datos, { ultimaActividad: Date.now() });
    return sesion;
  }

  eliminarSesion(telefono) {
    this.sessions.delete(telefono);
  }

  _limpiarSesionesExpiradas() {
    const ahora = Date.now();
    for (const [telefono, sesion] of this.sessions.entries()) {
      const minutos = (ahora - sesion.ultimaActividad) / 1000 / 60;
      if (minutos > TIMEOUT_MINUTOS) {
        this.sessions.delete(telefono);
      }
    }
  }
}

// Singleton: una instancia compartida en todo el proceso
module.exports = new SessionManager();
