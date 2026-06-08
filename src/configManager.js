// Carga configuración desde DB y cachea. Hace merge con restaurant.js como base.
const baseConfig = require('../config/restaurant');
let _pool  = null;
let _cache = null;

let _mantenimiento = false;
let _mensajeMantenimiento = null;

function setPool(pool) { _pool = pool; }

async function init() {
  if (!_pool) { _cache = { ...baseConfig }; return; }
  try {
    const { rows } = await _pool.query('SELECT data FROM configuracion WHERE id = 1');
    const dbData = rows[0]?.data || {};
    _cache = { ...baseConfig, ...dbData };
  } catch {
    _cache = { ...baseConfig };
  }
}

function get() { return _cache || baseConfig; }

async function actualizar(campos) {
  const dbActual = await _pool.query('SELECT data FROM configuracion WHERE id = 1')
    .then(r => r.rows[0]?.data || {}).catch(() => ({}));
  const nuevo = { ...dbActual, ...campos };
  await _pool.query(
    `INSERT INTO configuracion (id, data) VALUES (1, $1)
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
    [JSON.stringify(nuevo)]
  );
  _cache = { ...baseConfig, ...nuevo };
  return _cache;
}

function setMantenimiento(activo, mensaje = null) {
  _mantenimiento = !!activo;
  _mensajeMantenimiento = mensaje || null;
}
function isMantenimiento()          { return _mantenimiento; }
function getMensajeMantenimiento()  { return _mensajeMantenimiento; }

module.exports = { setPool, init, get, actualizar, setMantenimiento, isMantenimiento, getMensajeMantenimiento };
