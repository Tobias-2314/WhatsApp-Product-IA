# Plan: Integración real del SDK de MercadoPago para cobro de señas

## Contexto

Hoy el endpoint `POST /admin/api/pagos/crear` devuelve un link hardcodeado
(`MOCK_${reservaId}`) y el webhook `POST /admin/api/pagos/webhook` recibe IPN pero
no verifica ni actúa sobre el pago. El SDK `mercadopago` no está instalado.

Archivos clave:
- `src/admin.js:267-303` — endpoints mock de MP, firma `crearAdminRouter(io, cfgManager)`
- `src/index.js:62` — `app.use('/admin', crearAdminRouter(io, configManager))` (sin enviador WA)
- `src/bot.js:159-207` — `_guardarReserva` no envía link de depósito
- `src/db.js:826-831` — `actualizarDepositoReserva(id, { estado, mp_id })` existe pero no guarda `deposito_monto`
- `src/db.js` — **no existe** `obtenerReservaPorId(id)` (necesario para el webhook)
- `config/restaurant.js` — **no existe** campo `depositoMonto`

## Objetivo

- `POST /admin/api/pagos/crear` llama al SDK real y devuelve un link de MP.
- `POST /admin/api/pagos/webhook` verifica el pago y, si es aprobado, notifica al cliente por WhatsApp.
- Si `cfg.depositoMonto > 0`, al confirmar una reserva el bot envía el link de pago automáticamente.
- Si `depositoMonto = 0` (default), el flujo es idéntico al actual — sin cambios de comportamiento.

## Archivos que cambian

| Archivo | Qué cambia |
|---|---|
| `src/mp.js` | **Nuevo módulo** con `crearPreferencia()` y `verificarPago()` |
| `src/admin.js` | Usa `mp.js` en el endpoint de creación; implementa el webhook; acepta `enviadorWA` como tercer param |
| `src/index.js` | Pasa un `enviadorWA` closure a `crearAdminRouter` |
| `src/bot.js` | En `_guardarReserva`, si `depositoMonto > 0`, envía el link vía `mp.js` |
| `src/db.js` | Agrega `obtenerReservaPorId(id)`; actualiza `actualizarDepositoReserva` para persistir `deposito_monto` |
| `config/restaurant.js` | Agrega `depositoMonto: 0` |

---

## Pasos de implementación

### Paso 1 — Instalar el SDK

```bash
npm install mercadopago
```

Versión disponible: `3.1.0`. API: `MercadoPagoConfig`, `Preference`, `Payment`.

---

### Paso 2 — Crear `src/mp.js`

Nuevo archivo. Encapsula toda la lógica de MP para que `admin.js` y `bot.js`
no dependan directamente del SDK.

```js
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');

function getClient() {
  if (!process.env.MP_ACCESS_TOKEN) throw new Error('MP_ACCESS_TOKEN no configurado');
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
  return new Payment(getClient()).get({ id: paymentId });
}

module.exports = { crearPreferencia, verificarPago };
```

Variables de entorno requeridas: `MP_ACCESS_TOKEN`, `BASE_URL`.

---

### Paso 3 — `src/db.js`: agregar `obtenerReservaPorId` y actualizar `actualizarDepositoReserva`

**Agregar** el método `obtenerReservaPorId` (justo antes de `actualizarDepositoReserva`, línea ~826):

```js
async obtenerReservaPorId(id) {
  const { rows } = await pool.query(`SELECT * FROM reservas WHERE id = $1`, [id]);
  return rows[0] ? this._mapear(rows[0]) : null;
}
```

**Actualizar** `actualizarDepositoReserva` (línea 826) para persistir también `deposito_monto`:

```js
// Firma actual:  actualizarDepositoReserva(id, { estado, mp_id })
// Nueva firma:   actualizarDepositoReserva(id, { estado, mp_id, monto })

async actualizarDepositoReserva(id, { estado, mp_id, monto }) {
  const { rows } = await pool.query(
    `UPDATE reservas
     SET deposito_estado = $1, deposito_mp_id = $2, deposito_monto = $3
     WHERE id = $4 RETURNING *`,
    [estado, mp_id || null, monto ? parseInt(monto) : null, id]
  );
  return rows[0] ? this._mapear(rows[0]) : null;
}
```

---

### Paso 4 — `config/restaurant.js`: agregar `depositoMonto`

Después de `horasMinimaCancelacion` (línea ~43):

```js
depositoMonto: 0,   // 0 = sin seña. Ej: 2000 para cobrar $2000 al reservar.
```

---

### Paso 5 — `src/admin.js`: actualizar firma y endpoints

**Firma** `crearAdminRouter` (línea 37):
```js
// antes:
function crearAdminRouter(io = null, cfgManager = null) {

// después:
function crearAdminRouter(io = null, cfgManager = null, enviadorWA = null) {
```

**`POST /api/pagos/crear`** (línea 268) — reemplazar bloque mock:
```js
const mp = require('./mp');
const cfg = configManager ? configManager.get() : {};
const { link, id: mp_id } = await mp.crearPreferencia({
  reservaId,
  monto,
  descripcion: descripcion || `Seña reserva ${cfg.nombre || 'Restaurante'}`,
});
await db.actualizarDepositoReserva(reservaId, { estado: 'pendiente', mp_id, monto });
res.json({ link, mp_id });
```

**`POST /api/pagos/webhook`** (línea 287) — implementar verificación:
```js
const mp = require('./mp');
if (type === 'payment' && data?.id) {
  try {
    const pago = await mp.verificarPago(data.id);
    if (pago.status === 'approved') {
      const reservaId = pago.external_reference;
      await db.actualizarDepositoReserva(reservaId, {
        estado: 'pagado',
        mp_id: String(data.id),
        monto: pago.transaction_amount,
      });
      if (enviadorWA) {
        const reserva = await db.obtenerReservaPorId(reservaId);
        if (reserva) {
          await enviadorWA(
            reserva.telefono,
            `✅ *¡Seña recibida!* Tu reserva del *${reserva.fecha}* a las *${reserva.hora}* está confirmada. ¡Nos vemos pronto! 🍽️`
          );
        }
      }
    }
  } catch (err) {
    console.error('❌ Error procesando webhook MP:', err.message);
  }
}
```

---

### Paso 6 — `src/index.js`: pasar `enviadorWA` a `crearAdminRouter`

Línea 62, reemplazar:
```js
app.use('/admin', crearAdminRouter(io, configManager));
```
Por:
```js
app.use('/admin', crearAdminRouter(io, configManager, async (tel, msg) => {
  const jid = tel.includes('@') ? tel : `${tel}@s.whatsapp.net`;
  await sock.sendMessage(jid, { text: msg });
}));
```

**Problema**: `sock` todavía no existe cuando se ejecuta esta línea (se crea dentro de `iniciarBot()`).  
**Solución**: mover el `app.use('/admin', ...)` al interior de `iniciarBot()`, justo después de crear `sock`, y usar una variable `let adminRouter` para evitar recrearlo en cada reconexión:

```js
// fuera de iniciarBot:
let adminRouter = null;
app.use('/admin', (req, res, next) => (adminRouter || express.Router())(req, res, next));

// dentro de iniciarBot, después de crear sock, solo la primera vez:
if (!adminRouter) {
  adminRouter = crearAdminRouter(io, configManager, async (tel, msg) => {
    const jid = tel.includes('@') ? tel : `${tel}@s.whatsapp.net`;
    await sock.sendMessage(jid, { text: msg });
  });
}
```

---

### Paso 7 — `src/bot.js`: enviar link de seña post-reserva

En `_guardarReserva` (línea ~186), después de llamar a `_notificarAdmin` y antes del `return`:

```js
const _cfg = configManager.get();
if (_cfg.depositoMonto > 0) {
  this._enviarLinkDeposito(sesion.telefono, reserva.id, _cfg.depositoMonto, _cfg).catch(e =>
    console.error('⚠️ enviarLinkDeposito:', e.message)
  );
}
```

Nuevo método privado en `Bot`:
```js
async _enviarLinkDeposito(telefono, reservaId, monto, cfg) {
  const mp = require('./mp');
  const { t } = require('./i18n');
  const { link } = await mp.crearPreferencia({
    reservaId,
    monto,
    descripcion: `Seña reserva ${cfg.nombre}`,
  });
  await sheets.actualizarDepositoReserva(reservaId, { estado: 'pendiente', mp_id: reservaId, monto });
  await this._enviar(telefono, t(cfg.idioma || 'es', 'depositoPendiente', link, monto));
}
```

---

## Variables de entorno nuevas

```env
MP_ACCESS_TOKEN=APP_USR-...    # token de producción (o TEST-... para sandbox)
BASE_URL=https://mi-app.railway.app  # dominio público accesible por MP para el webhook
```

---

## Riesgos y consideraciones

- **El webhook necesita HTTPS público.** En dev local no funciona sin ngrok o similar.
  Para testear localmente: usar `ngrok http 3000` y poner `BASE_URL=https://xxxx.ngrok.io`.
- **Si `MP_ACCESS_TOKEN` no está seteado**, `getClient()` lanza antes de tocar la red.
  El endpoint devuelve 500 pero no rompe el flujo de reserva (el link se envía como fire-and-forget).
- **`actualizarDepositoReserva` cambia de firma** (agrega `monto`). Hay que actualizar también la
  llamada en `admin.js:279` (en el bloque mock que se reemplaza) — ya queda cubierto en el Paso 5.
- **El `sock` no existe hasta que WhatsApp conecta.** Si llega un webhook de MP antes de que el bot
  conecte a WhatsApp, `enviadorWA` enviará pero puede fallar silenciosamente. Agregar un guard:
  `if (sock && pago.status === 'approved') { ... }` o loguear el fallo para reintento manual.
- **`depositoMonto = 0` es el default** — si no se configura en el `.env` ni en el admin panel,
  el comportamiento es exactamente igual al actual. Sin riesgo de regresión.

## Orden de implementación recomendado

1. `npm install mercadopago`
2. Crear `src/mp.js` (aislado, testeable por sí solo)
3. `src/db.js` — agregar `obtenerReservaPorId` + actualizar firma de `actualizarDepositoReserva`
4. `config/restaurant.js` — agregar `depositoMonto: 0`
5. `src/admin.js` — actualizar firma y endpoints (primero con `MP_ACCESS_TOKEN` de sandbox)
6. `src/index.js` — refactor para pasar `enviadorWA` y mover el montaje del router dentro de `iniciarBot`
7. `src/bot.js` — agregar `_enviarLinkDeposito` y el trigger en `_guardarReserva`
8. Testear con sandbox: crear reserva → recibir link → completar pago en sandbox → verificar webhook → verificar WA
