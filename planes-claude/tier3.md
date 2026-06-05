# Tier 3 — Siguiente fase

Estado actual: i18n ✅ · multi-tenant ✅ · lista de espera ✅ · socket.io ✅ · MercadoPago ❌ (descartado)

Features pendientes del roadmap ordenadas por impacto/esfuerzo:

---

## Feature A · Bloqueo de fechas desde el panel
**Impacto:** Alto · **Esfuerzo:** Bajo-Medio

El dueño puede marcar días como cerrados (feriados, eventos privados, vacaciones).
El bot rechaza reservas en esas fechas igual que rechaza días con `horarios: null`.

### Qué implica

**DB** — nueva tabla:
```sql
CREATE TABLE fechas_bloqueadas (
  id         SERIAL      PRIMARY KEY,
  fecha      VARCHAR(10) NOT NULL,          -- 'DD/MM/YYYY' o '*' para todos los años
  motivo     VARCHAR(200),
  restaurante_id INTEGER NOT NULL DEFAULT 1
);
```

**`src/db.js`** — métodos nuevos:
- `bloquearFecha(fecha, motivo)` — INSERT
- `desbloquearFecha(id)` — DELETE
- `listarFechasBloqueadas()` — SELECT
- `esFechaBloqueada(fecha)` — SELECT COUNT

**`src/bot.js` → `_esFechaValida`** — agregar chequeo:
```js
const bloqueada = await sheets.esFechaBloqueada(fechaStr);
if (bloqueada) return false;
```

**`src/admin.js`** — 3 endpoints nuevos bajo `/api/fechas-bloqueadas`:
- `GET` — lista todas
- `POST` — bloquea una fecha
- `DELETE /:id` — desbloquea

**`admin/`** — panel Vue: pestaña nueva "Fechas bloqueadas" con calendario visual + botón bloquear.

### Riesgos
- `_esFechaValida` en `bot.js` es síncrona hoy — hay que hacerla `async` y actualizar todas las llamadas.
- El panel de ocupación también debería marcar visualmente las fechas bloqueadas.

---

## Feature B · Comandos de staff por WhatsApp
**Impacto:** Alto · **Esfuerzo:** Medio

Un número de staff autorizado puede enviar comandos directamente por WhatsApp sin abrir el panel.

### Comandos propuestos

| Comando | Respuesta |
|---|---|
| `reservas hoy` | Lista de reservas del día (hora, nombre, personas) |
| `reservas 25/07` | Reservas de una fecha específica |
| `cancelar R3KX2A` | Cancela esa reserva por ID |
| `bloquear 25/07 feriado` | Bloquea esa fecha con motivo opcional |
| `disponibilidad 25/07` | Franjas disponibles para esa fecha |
| `stats` | Resumen del día: confirmadas, canceladas, personas |

### Qué implica

**`config/restaurant.js`** — nuevo campo:
```js
telefonosStaff: [],  // ['5491112345678', '5491187654321']
```

**`src/index.js`** — en el handler `messages.upsert`, antes de `procesarConReintentos`:
```js
const esStaff = configManager.get().telefonosStaff?.includes(telefono);
if (esStaff) {
  await procesarComandoStaff(sock, telefono, contenido);
  continue;
}
```

**`src/staffCommands.js`** — nuevo módulo con el parser y los handlers de cada comando.

### Riesgos
- El número de staff no puede tener conversaciones normales con el bot (se interceptan como comandos).
  Si el staff también quiere reservar como cliente, necesita un número distinto.
- `cancelar` desde staff omite la política de `horasMinimaCancelacion` (comportamiento deseable para staff).

---

## Feature C · Encuesta post-visita
**Impacto:** Medio · **Esfuerzo:** Bajo

24 horas después de una reserva, el scheduler envía una encuesta de satisfacción.
Usa la misma infraestructura de schedulers que el recordatorio de confirmación.

### Qué implica

**DB** — nueva columna:
```sql
ALTER TABLE reservas ADD COLUMN IF NOT EXISTS encuesta_enviada BOOLEAN NOT NULL DEFAULT false;
```

**`src/db.js`** — método:
- `obtenerReservasParaEncuesta()` — reservas confirmadas con `hora` hace 20-28h y `encuesta_enviada = false`
- `marcarEncuestaEnviada(id)`

**`src/index.js`** — scheduler nuevo cada 15 min (igual que los otros):
```js
setInterval(() => enviarEncuestas(sock), 15 * 60_000);
```

**`src/i18n.js`** — nueva clave `encuesta` en los 3 idiomas.

**`src/db.js`** — tabla `resenas` para guardar respuestas:
```sql
CREATE TABLE resenas (
  id         SERIAL      PRIMARY KEY,
  reserva_id VARCHAR(20) REFERENCES reservas(id),
  telefono   VARCHAR(50) NOT NULL,
  puntuacion INTEGER     CHECK (puntuacion BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**`src/bot.js`** — reconocer respuestas `1`-`5` cuando `sesion.estado === 'encuesta'`.

### Riesgos
- Solo tiene sentido enviar si el estado de la reserva al momento del scheduler sigue `confirmada`
  (no cancelada ni no-show). El query debe filtrar por estado.
- El bot tiene que reconocer la respuesta numérica como puntuación, no como número de personas
  para una reserva. Requiere un estado de sesión nuevo: `'encuesta'`.

---

## Feature D · Botones interactivos nativos de WhatsApp
**Impacto:** Alto en UX · **Esfuerzo:** Medio · **Riesgo:** Medio

Reemplaza el menú de texto por botones tocables en la bienvenida y en puntos de decisión clave.

### Qué implica

**`src/bot.js`** — nuevo método `_enviarBotones(telefono, texto, botones)`.
Baileys tiene `sendMessage` con `{ buttons: [...] }` (máx 3 botones) y `{ sections: [...] }` para listas.

Puntos donde activar botones:
1. **Bienvenida** — 4 opciones: Reservar / Ver mi reserva / Ver menú / Hablar con alguien
2. **Confirmación de reserva** — 2 botones: Confirmar / Cambiar datos
3. **Sin disponibilidad** — 2 botones: Lista de espera / Elegir otra fecha

**Advertencia**: Baileys soporta botones pero WhatsApp los deprecó para cuentas no-Business API.
En cuentas personales (que es lo que usa Baileys) los botones pueden no renderizarse en todos los dispositivos.
**Alternativa más segura**: usar listas (`listMessage`) que tienen mejor compatibilidad.

### Riesgos
- Compatibilidad no garantizada en dispositivos con WhatsApp antiguo.
- Si el usuario no ve los botones, el texto base sigue siendo legible — degradación graceful.
- Requiere testear en dispositivo real antes de deployar.

---

## Resumen y orden recomendado

| Feature | Impacto | Esfuerzo | Dependencias |
|---|---|---|---|
| **A — Bloqueo de fechas** | Alto | Bajo-Medio | Ninguna |
| **B — Comandos de staff** | Alto | Medio | Opcionalmente A (para `bloquear`) |
| **C — Encuesta post-visita** | Medio | Bajo | Ninguna |
| **D — Botones interactivos** | Alto en UX | Medio | Ninguna, pero testear en real |

**Recomendación de orden**: C → A → B → D

- C primero porque es la más contenida (un scheduler + tabla simple).
- A segundo porque el staff commands lo usa (`bloquear` por WA).
- B después de A para que los comandos de staff estén completos.
- D al final porque tiene el mayor riesgo de compatibilidad.
