# Tier 4 — Siguiente fase

Estado actual:
- Tier 2 ✅ — i18n (ES/EN/PT), multi-tenant, configuración dinámica
- Tier 3 ✅ — encuesta post-visita, bloqueo de fechas, comandos staff, botones interactivos (list messages)
- MercadoPago ❌ descartado

Features pendientes ordenadas por impacto/esfuerzo:

---

## Feature A · Panel de reseñas en el admin
**Impacto:** Medio · **Esfuerzo:** Bajo

Las reseñas ya se guardan en la tabla `resenas` (tier 3). Falta exponerlas en el panel admin.

### Qué implica

**`src/admin.js`** — 1 endpoint nuevo:
```js
// GET /admin/api/resenas
// Devuelve promedio, total y lista de últimas N reseñas
router.get('/api/resenas', async (req, res) => {
  const lista = await db.listarResenas();
  const total = lista.length;
  const promedio = total ? (lista.reduce((s, r) => s + r.puntuacion, 0) / total).toFixed(1) : null;
  res.json({ promedio, total, resenas: lista });
});
```

**`src/db.js`** — 1 método nuevo:
```js
async listarResenas() {
  const { rows } = await pool.query(`
    SELECT re.*, r.nombre, r.fecha, r.hora
    FROM resenas re
    LEFT JOIN reservas r ON re.reserva_id = r.id
    WHERE re.restaurante_id = ${RESTAURANTE_ID}
    ORDER BY re.created_at DESC
    LIMIT 100
  `);
  return rows;
}
```

**`admin/src/api.js`** — función nueva:
```js
export function getResenas() { return request('/resenas') }
```

**`admin/src/components/ResenasPanel.vue`** — nuevo componente:
- Card con promedio ⭐ y total de reseñas
- Lista con: fecha de visita, nombre del cliente, puntuación (estrellas visuales), fecha de reseña

**`admin/src/components/Dashboard.vue`** — nueva pestaña ⭐ Reseñas.

### Riesgos
- Ninguno significativo. La tabla ya existe, solo es lectura.

---

## Feature B · QR de confirmación
**Impacto:** Medio · **Esfuerzo:** Bajo

Al confirmar una reserva, el bot genera y envía un QR con el ID de la reserva como imagen.
El staff lo puede escanear al recibir al cliente (o solo visual para el cliente).

### Qué implica

**Instalar dependencia:**
```bash
npm install qrcode
```

**`src/bot.js`** — en `_guardarReserva`, después de enviar el mensaje de confirmación:
```js
const QRCode = require('qrcode');
const qrBuffer = await QRCode.toBuffer(reserva.id, { width: 300 });
await this._enviar(telefono, { image: qrBuffer, caption: `ID: ${reserva.id}` });
```

El enviador actual (`sock.sendMessage`) ya soporta `{ image: Buffer }`.

### Riesgos
- `qrcode` genera un PNG en memoria — sin disco, sin side effects.
- Si falla el QR, la reserva ya fue confirmada. Envolver en try/catch separado del flujo principal.
- El panel admin ya muestra el ID en texto — el QR es un extra de UX, no reemplaza el ID.

---

## Feature C · Modificación de reservas
**Impacto:** Alto · **Esfuerzo:** Medio

Hoy el bot puede hacer, consultar y cancelar reservas, pero no modificarlas.
Si el cliente quiere cambiar la hora o la cantidad de personas, tiene que cancelar y volver a reservar.

### Acciones nuevas en el flujo IA

**`src/ai.js`** — agregar a `ACCIONES DISPONIBLES` en el system prompt:
```
- modify_reservation: el usuario quiere cambiar fecha, hora o personas de una reserva existente
```

**`src/bot.js`** — nuevo case en `_ejecutarAccion`:
```js
case 'modify_reservation':
  respuesta = await this._modificarReserva(sesion);
  break;
```

**`src/bot.js`** — nuevo método `_modificarReserva(sesion)`:
1. Buscar la reserva activa del teléfono (igual que en cancelar).
2. Validar que la nueva fecha/hora estén disponibles.
3. Llamar a `db.modificarReserva(id, { fecha, hora, personas })`.
4. Enviar confirmación con los nuevos datos.

**`src/db.js`** — nuevo método:
```js
async modificarReserva(id, { fecha, hora, personas }) {
  const { rows } = await pool.query(
    `UPDATE reservas SET fecha=$1, hora=$2, personas=$3 WHERE id=$4 AND restaurante_id=${RESTAURANTE_ID} RETURNING *`,
    [fecha, hora, personas, id]
  );
  return rows[0] ? this._mapear(rows[0]) : null;
}
```

**`src/i18n.js`** — clave nueva `reservaModificada` en ES/EN/PT.

**`src/admin.js`** — endpoint PUT existente `/api/reservas/:id` ya permite editar desde el panel;
solo hay que verificar que acepte los campos `fecha`, `hora`, `personas`.

### Riesgos
- La IA tiene que distinguir "modificar" de "cancelar y re-reservar". Requiere ajustar el prompt con ejemplos.
- Si la nueva franja no tiene disponibilidad, hay que devolver alternativas (igual que `check_availability`).
- La política de `horasMinimaCancelacion` también aplica: no se puede modificar con menos de X horas.

---

## Feature D · Modo mantenimiento / cierre temporal
**Impacto:** Alto · **Esfuerzo:** Bajo

El dueño puede poner el bot en pausa (por ej. mientras está cerrado por vacaciones largas)
sin tener que apagar el servidor ni editar `config/restaurant.js`.

### Qué implica

**`src/admin.js`** — 2 endpoints nuevos:
```js
router.post('/api/mantenimiento/activar', async (req, res) => {
  configManager.setMantenimiento(true, req.body.mensaje || null);
  res.json({ ok: true });
});
router.post('/api/mantenimiento/desactivar', async (req, res) => {
  configManager.setMantenimiento(false);
  res.json({ ok: true });
});
```

**`src/configManager.js`** — extender con estado en memoria:
```js
let modoMantenimiento = false;
let mensajeMantenimiento = null;

setMantenimiento(activo, mensaje = null) {
  modoMantenimiento = activo;
  mensajeMantenimiento = mensaje;
}
isMantenimiento() { return modoMantenimiento; }
getMensajeMantenimiento() { return mensajeMantenimiento; }
```

**`src/index.js`** — en el handler de mensajes, antes del staff check:
```js
if (configManager.isMantenimiento()) {
  const msg = configManager.getMensajeMantenimiento()
    || 'Estamos temporalmente cerrados. ¡Volvemos pronto!';
  await sock.sendMessage(`${telefono}@s.whatsapp.net`, { text: msg });
  continue;
}
```

**`admin/src/components/ConfigPanel.vue`** — toggle de mantenimiento con campo de mensaje personalizable.

**`src/staffCommands.js`** — comandos nuevos:
- `mantenimiento on [mensaje]` — activa modo mantenimiento
- `mantenimiento off` — desactiva

### Riesgos
- El estado es en memoria: si el servidor se reinicia, se desactiva solo. Es comportamiento deseable
  (no querés que el bot quede en mantenimiento para siempre por accidente).
- Si se quiere persistir, guardar en DB: `INSERT INTO config (clave, valor) ON CONFLICT DO UPDATE`.

---

## Resumen y orden recomendado

| Feature | Impacto | Esfuerzo | Dependencias |
|---|---|---|---|
| **A — Panel de reseñas** | Medio | Bajo | Ninguna (tabla ya existe) |
| **B — QR de confirmación** | Medio | Bajo | Ninguna |
| **C — Modificación de reservas** | Alto | Medio | Ninguna |
| **D — Modo mantenimiento** | Alto | Bajo | Ninguna |

**Recomendación de orden**: A → B → D → C

- A y B primero porque son puramente aditivas y no tocan lógica existente.
- D antes que C porque es pequeña y de alto valor operativo.
- C al final porque requiere ajustar el prompt de IA y tiene más casos borde.
