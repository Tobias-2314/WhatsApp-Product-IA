# Tier 2 — Plan de implementación

Tres features independientes, ordenadas de menor a mayor blast radius.

---

## Feature 1 · i18n — activar el sistema de idiomas

El módulo `src/i18n.js` ya existe y funciona, con traducciones en ES / EN / PT.
Lo que falta es simplemente usarlo.

### Cambios necesarios

**`config/restaurant.js`** — añadir campo `idioma`:
```js
idioma: 'es',   // 'es' | 'en' | 'pt'
```

**`src/bot.js`** — importar `t` y reemplazar 5 bloques de strings hardcodeados:

| Método | String actual | Clave i18n |
|---|---|---|
| `_guardarReserva` | `❌ No hay mesas disponibles...` + pregunta lista espera | `sinDisponibilidad` + `listaEspera` |
| `_guardarReserva` | `✅ *¡Reserva confirmada!* ...` bloque completo | `reservaConfirmada(r)` |
| `_guardarReserva` | `❌ Hubo un problema técnico...` | `errorTecnico(tel)` |
| `_cancelarReserva` | `❌ Hubo un error al cancelar...` | `errorTecnico(tel)` |
| `_agregarListaEspera` → notificación al usuario en espera (en `_cancelarReserva`) | `🎉 *¡Buenas noticias!*...` | `esperaLiberada(r)` |

Para obtener el idioma: `const idioma = configManager.get().idioma || 'es'`.

**Atención**: la clave `reservaConfirmada(r)` recibe un objeto con `{ id, nombre, fecha, hora, hora_fin, personas, mesa }`. El template de `i18n.js` ya usa esos campos, pero le falta el footer `"¡Nos vemos pronto en ${nombre}!"`. Hay que actualizarlo o simplemente mantener ese footer como string fijo fuera del `t()`.

**`src/index.js`** — reemplazar los dos schedulers:
- `enviarConfirmaciones`: string del `text:` → `t(idioma, 'recordatorio24h', reserva.nombre, { restaurante: cfg.nombre, fecha: reserva.fecha, hora: reserva.hora, personas: reserva.personas })`
- `enviarAvisosFinal`: string del `text:` → `t(idioma, 'aviso2h', { restaurante: cfg.nombre, hora: reserva.hora })`

Para el idioma en los schedulers: leer `configManager.get().idioma || 'es'` dentro de la función.

### Riesgos
- Bajo. Los templates de `i18n.js` son funcionalmente equivalentes a los strings actuales; solo hay que asegurarse de que el objeto pasado a `reservaConfirmada(r)` tenga `hora_fin` y `mesa` (que vienen de `guardarReservaAtomico`).
- No hay DB migration. No hay cambio de interfaz.

---

## Feature 2 · MercadoPago — integración real

El endpoint de creación devuelve un link MOCK. El webhook recibe la IPN pero no hace nada.

### Prerequisito
```bash
npm install mercadopago
```
La v3.1.0 usa `new MercadoPagoConfig({ accessToken })` + `new Preference(client)`.

### Nuevo archivo `src/mp.js`

```js
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');

function getClient() {
  return new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
}

async function crearPreferencia({ reservaId, monto, descripcion, emailPagador }) {
  const pref = new Preference(getClient());
  const body = {
    items: [{ title: descripcion, quantity: 1, unit_price: Number(monto), currency_id: 'ARS' }],
    external_reference: String(reservaId),
    notification_url: `${process.env.BASE_URL}/admin/api/pagos/webhook`,
  };
  if (emailPagador) body.payer = { email: emailPagador };
  const res = await pref.create({ body });
  return { id: res.id, link: res.init_point };
}

async function verificarPago(paymentId) {
  const payment = new Payment(getClient());
  return payment.get({ id: paymentId });
}

module.exports = { crearPreferencia, verificarPago };
```

### Cambios en `src/admin.js`

**`POST /api/pagos/crear`** — reemplazar el bloque mock:
```js
const mp = require('./mp');
const { link, id: mp_id } = await mp.crearPreferencia({ reservaId, monto, descripcion });
await db.actualizarDepositoReserva(reservaId, { estado: 'pendiente', mp_id });
res.json({ link, mp_id });
```
Guardar `BASE_URL` en `.env` (ej: `https://mi-app.railway.app`).

**`POST /api/pagos/webhook`** — implementar verificación:
```js
const mp = require('./mp');
if (type === 'payment' && data?.id) {
  const pago = await mp.verificarPago(data.id);
  if (pago.status === 'approved') {
    const reservaId = pago.external_reference;
    await db.actualizarDepositoReserva(reservaId, { estado: 'pagado', mp_payment_id: String(data.id) });
    // Notificar al cliente por WhatsApp
    if (enviadorWA) {
      const reserva = await db.obtenerReservaPorId(reservaId);
      if (reserva) {
        await enviadorWA(reserva.telefono,
          `✅ *¡Seña recibida!* Tu reserva del *${reserva.fecha}* a las *${reserva.hora}* queda confirmada. ¡Nos vemos pronto! 🍽️`
        );
      }
    }
  }
}
```

**`crearAdminRouter`** necesita recibir `enviadorWA`:
```js
// admin.js
function crearAdminRouter(io = null, cfgManager = null, enviadorWA = null) { ... }

// index.js — al llamarla:
app.use('/admin', crearAdminRouter(io, configManager, async (tel, msg) => {
  await sock.sendMessage(`${tel}@s.whatsapp.net`, { text: msg });
}));
```

**`config/restaurant.js`** — añadir:
```js
depositoMonto: 0,  // 0 = deshabilitado. Poner ej. 2000 para activar seña de $2000
```

**`src/bot.js` → `_guardarReserva`** — después de confirmar la reserva, si `cfg.depositoMonto > 0`, llamar al endpoint interno para crear la preferencia y enviar el link:
```js
if (cfg.depositoMonto > 0) {
  // Fire-and-forget: el pago es asíncrono
  this._enviarLinkDeposito(sesion.telefono, reserva.id, cfg.depositoMonto).catch(e =>
    console.error('⚠️ enviarLinkDeposito:', e.message)
  );
}
```

Nuevo método `_enviarLinkDeposito`:
```js
async _enviarLinkDeposito(telefono, reservaId, monto) {
  const mp = require('./mp');
  const cfg = configManager.get();
  const { link } = await mp.crearPreferencia({
    reservaId, monto,
    descripcion: `Seña reserva ${cfg.nombre}`,
  });
  await db.actualizarDepositoReserva(reservaId, { estado: 'pendiente', mp_id: reservaId });
  const idioma = cfg.idioma || 'es';
  const { t } = require('./i18n');
  await this._enviar(telefono, t(idioma, 'depositoPendiente', link, monto));
}
```

### Variables de entorno nuevas
```
MP_ACCESS_TOKEN=APP_USR-...   # token de producción o sandbox
BASE_URL=https://mi-app.railway.app
```

### Riesgos
- El webhook de MP necesita HTTPS accesible desde internet. En dev local no funciona sin ngrok.
- Si `MP_ACCESS_TOKEN` no está seteado, `crearPreferencia` lanzará. Proteger con guard al principio del método o verificar que `process.env.MP_ACCESS_TOKEN` exista antes de llamar.
- `db.obtenerReservaPorId(id)` probablemente no existe aún — hay que agregarlo en `db.js` (1 línea: `SELECT * FROM reservas WHERE id = $1`).

---

## Feature 3 · Multi-tenant — activar aislamiento por restaurante

La tabla `restaurantes` ya existe. Lo que falta es que `reservas`, `mesas` y `lista_espera` sepan a qué restaurante pertenecen.

### DB migrations (en `db.js` → `inicializar()`)

```sql
ALTER TABLE reservas    ADD COLUMN IF NOT EXISTS restaurante_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE mesas       ADD COLUMN IF NOT EXISTS restaurante_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE lista_espera ADD COLUMN IF NOT EXISTS restaurante_id INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_reservas_rid_fecha    ON reservas     (restaurante_id, fecha);
CREATE INDEX IF NOT EXISTS idx_mesas_rid             ON mesas        (restaurante_id);
CREATE INDEX IF NOT EXISTS idx_lista_espera_rid      ON lista_espera (restaurante_id);
```

Las filas existentes quedan en `restaurante_id = 1`, que es el restaurante por defecto — sin pérdida de datos.

### Constante en `db.js`

```js
const RESTAURANTE_ID = parseInt(process.env.RESTAURANTE_ID || '1', 10);
```

### Filtrar todas las queries

Cada método de `db.js` que hace `SELECT`, `INSERT`, o `UPDATE` sobre `reservas`, `mesas`, o `lista_espera` necesita:
- En `WHERE`: añadir `AND restaurante_id = ${RESTAURANTE_ID}`
- En `INSERT`: incluir `restaurante_id = ${RESTAURANTE_ID}` en los valores

Métodos afectados (buscarlos con `grep restaurante_id` antes para no duplicar):
`guardarReservaAtomico`, `cancelarReserva`, `cancelarReservaPorId`, `obtenerReservaActiva`, `obtenerReservasPorTelefono`, `obtenerReservasFiltradas`, `obtenerReservasProximas`, `obtenerStatsHoy`, `obtenerAnalytics`, `obtenerOcupacionDia`, `obtenerMesas`, `crearMesa`, `actualizarMesa`, `agregarListaEspera`, `obtenerPrimeraListaEspera`, `marcarListaEsperaNotificada`, `modificarReserva`.

### `configManager.js`

Si el config manager hace `SELECT ... FROM restaurantes WHERE id = ?`, cambiar el `1` hardcodeado por `RESTAURANTE_ID`.

### Variable de entorno nueva
```
RESTAURANTE_ID=1   # por defecto 1, cada instancia tiene su propio valor
```

### Riesgos
- **Es el cambio más amplio**: afecta ~20 queries. Si alguna se olvida, ese tenant no ve sus datos o ve los de otro.
- Estrategia segura: hacer los `ALTER TABLE` primero en prod con `DEFAULT 1`, verificar que las filas existentes tienen `restaurante_id = 1`, luego desplegar el código con el filtro.
- En instancia de un solo tenant, `RESTAURANTE_ID=1` y el comportamiento es idéntico al actual.

---

## Orden recomendado de implementación

```
Feature 1 (i18n)      ← sin riesgo, cambio superficial, reversible con 1 variable
Feature 2 (MP)        ← nuevo módulo aislado; no rompe nada si MP_ACCESS_TOKEN no está seteado
Feature 3 (multi-tenant) ← requiere ventana de mantenimiento; hacer en rama separada y testear
```
