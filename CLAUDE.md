# WhatsApp Bot de Reservas — CLAUDE.md

Bot de WhatsApp para gestión de reservas de restaurantes. Usa Baileys (WhatsApp), Google Gemini 1.5 Flash (IA) y Google Sheets (base de datos).

---

## Estructura del proyecto

```
src/
  index.js              # Entry point: Baileys, reconexión, health check
  bot.js                # Orquestador principal: sesiones, acciones, Sheets
  ai.js                 # Integración Gemini: prompt, parseo JSON, fallback
  sheets.js             # CRUD de reservas en Google Sheets
  sessions/
    sessionManager.js   # Sesiones en memoria con timeout automático
config/
  restaurant.js         # Configuración del restaurante (editable por cliente)
logs/
  bot.log               # Log persistente (generado en runtime)
auth_info/              # Credenciales WhatsApp (generado en runtime, no commitear)
```

---

## Flujo de un mensaje entrante

```
WhatsApp → index.js (messages.upsert)
         → bot.procesarMensaje()
           ├── sessionManager.obtenerOCrearSesion()
           ├── sheets.obtenerFranjasDisponibles()  (si hay fecha en sesión)
           ├── ai.procesarMensaje()                (llama a Gemini)
           ├── bot._ejecutarAccion()               (según action devuelta por IA)
           └── sock.sendMessage()                  (envía respuesta)
```

---

## Módulos y sus responsabilidades

### `src/index.js` — Entry point

- Inicializa Google Sheets antes de conectar WhatsApp.
- Crea el socket Baileys con `makeWASocket`.
- Inyecta el enviador de mensajes en `bot` via `bot.setEnviadorMensajes()`.
- Gestiona reconexión automática (máx. 5 intentos, backoff hasta 15 s).
- Expone health check HTTP en `PORT` (default 3000) para Railway/Render.
- Ignora mensajes propios, de grupos y de broadcasts.
- Solo procesa mensajes de tipo `notify` (mensajes nuevos reales).

### `src/bot.js` — Orquestador (`Bot`)

Método público principal: `procesarMensaje(telefono, mensaje)`

Acciones que puede ejecutar según el campo `action` devuelto por Gemini:

| action | método interno | descripción |
|---|---|---|
| `save_reservation` | `_guardarReserva(sesion)` | Valida datos completos, verifica disponibilidad en tiempo real, guarda en Sheets |
| `cancel_reservation` | `_cancelarReserva(sesion)` | Busca reserva activa, verifica política de cancelación (mín. `horasMinimaCancelacion`) |
| `check_availability` | `_verificarDisponibilidad(sesion)` | Lista franjas horarias disponibles para la fecha |
| `show_menu` | — | Devuelve `restaurante.menu` directamente |
| `show_reservations` | `_mostrarReservas(sesion)` | Lista todas las reservas confirmadas del teléfono |
| `transfer_human` | — | Activa `sesion.modoHumano = true`, el bot no responde más |
| `none` | — | No ejecuta acción, solo envía la respuesta de la IA |

Reglas importantes:
- Nunca pisa con `null` datos ya recolectados en `reservaPendiente`.
- Limita el historial de conversación a los últimos 20 mensajes.
- El modo humano (`modoHumano: true`) bloquea todo procesamiento automático.

### `src/ai.js` — IA (`AIManager`)

- Modelo: `gemini-1.5-flash`, temperatura 0.7, máx. 800 tokens, salida JSON forzada (`responseMimeType: 'application/json'`).
- Inicialización lazy: crea el cliente Gemini solo en el primer mensaje.
- `_construirSystemPrompt(sesion, franjasDisponibles)`: genera el system prompt con datos del restaurante, fecha/hora actual (timezone `America/Argentina/Buenos_Aires`), estado de sesión y disponibilidad pre-cargada.
- Pasa los últimos 18 turnos del historial como contexto al chat.
- Formato de respuesta esperado de Gemini (JSON):

```json
{
  "response": "mensaje para el cliente",
  "action": "none|save_reservation|cancel_reservation|check_availability|show_menu|show_reservations|transfer_human",
  "extractedData": {
    "nombre": "string o null",
    "fecha": "DD/MM/YYYY o null",
    "hora": "HH:MM o null",
    "personas": "número entero o null"
  },
  "estado": "inicio|recolectando|confirmando|completado|cancelando|viendo|humano"
}
```

- Si Gemini falla o devuelve JSON inválido, `_fallback(estado)` devuelve una respuesta segura según el estado actual.

### `src/sheets.js` — Google Sheets (`SheetsManager`)

Hoja: `Reservas`. Columnas: `ID | Teléfono | Nombre | Fecha | Hora | Personas | Estado | Timestamp`

| método | descripción |
|---|---|
| `inicializar()` | Autentica con Service Account, crea encabezados si la hoja está vacía |
| `guardarReserva({telefono, nombre, fecha, hora, personas})` | Append de nueva fila, devuelve objeto con ID generado |
| `cancelarReserva(telefono, idReserva?)` | Busca primera reserva `confirmada` del teléfono, cambia estado a `cancelada` |
| `obtenerReservasPorTelefono(telefono)` | Filtra filas por teléfono y estado `confirmada` |
| `contarReservasEnFranja(fecha, hora)` | Cuenta reservas confirmadas para una fecha+hora específicas |
| `obtenerFranjasDisponibles(fecha, franjasHorarias, capacidadMaxima)` | Devuelve franjas con cupo restante |

- IDs de reserva: formato `R` + timestamp en base36 + 3 chars aleatorios (ej: `RLX4K2ABCF`).
- Autenticación: Service Account JSON, scope `spreadsheets` completo.

### `src/sessions/sessionManager.js` — Sesiones (`SessionManager`)

Estructura de una sesión:

```js
{
  telefono: string,
  estado: 'inicio' | 'recolectando' | 'confirmando' | 'completado' | 'cancelando' | 'viendo' | 'humano',
  historialConversacion: [{ rol: 'usuario'|'bot', contenido: string }],
  reservaPendiente: { nombre, fecha, hora, personas },
  ultimaActividad: timestamp,
  modoHumano: boolean,
}
```

- Timeout: 30 minutos de inactividad → sesión eliminada.
- Limpieza automática: cada 10 minutos revisa todas las sesiones.
- Singleton: una instancia compartida en todo el proceso (en memoria, no persiste reinicios).

### `config/restaurant.js` — Configuración del restaurante

Archivo principal a editar para adaptar el bot a cada cliente. Contiene:

- Datos del local (nombre, teléfono, dirección).
- Horarios por día (o `null` si cierra ese día).
- `franjasHorarias`: array de horas ofrecidas para reserva (formato `HH:MM`).
- `capacidadMaximaPorFranja`: máximo de mesas simultáneas por franja.
- `maximoPersonasPorReserva`: límite de personas por reserva.
- `horasMinimaCancelacion`: anticipación mínima para cancelar.
- `diasMaximosAnticipacion`: con cuántos días adelante se puede reservar.
- `mensajeBienvenida`: texto del primer mensaje al usuario.
- `menu`: texto del menú (formato WhatsApp con `*negritas*` e `_itálicas_`).

---

## Variables de entorno (`.env`)

| variable | descripción |
|---|---|
| `GEMINI_API_KEY` | API key de Google AI Studio |
| `GOOGLE_SHEETS_ID` | ID del spreadsheet (en la URL de Google Sheets) |
| `GOOGLE_SERVICE_ACCOUNT_KEY_PATH` | Ruta al JSON de la Service Account |
| `LOG_LEVEL` | Nivel de logs pino: `trace`, `debug`, `info`, `warn`, `error` (default: `info`) |
| `PORT` | Puerto del health check HTTP (default: `3000`) |

---

## Comandos

```bash
npm start       # Producción
npm run dev     # Desarrollo con nodemon (hot reload)
```

---

## Archivos que NO se commitean

- `auth_info/` — credenciales de sesión WhatsApp (se regeneran escaneando QR).
- `.env` — variables de entorno con claves privadas.
- `config/service-account.json` — clave privada de Google Service Account.
- `logs/` — logs de runtime.
- `node_modules/`

---

## Consideraciones para modificar el código

- **Agregar una nueva acción**: definirla en el system prompt de `ai.js` (sección `ACCIONES DISPONIBLES`) y agregar el case en `bot._ejecutarAccion()`.
- **Cambiar el modelo de IA**: editar el campo `model` en `ai.js:115`. Gemini 1.5 Pro es más capaz pero más lento y caro.
- **Persistir sesiones entre reinicios**: reemplazar el `Map` en `sessionManager.js` por Redis u otro store externo.
- **Soporte a grupos o mensajes de media**: modificar el filtro en `index.js:133-135` y el extractor de contenido en `index.js:140-144`.
- **Ajustar temperatura o tokens**: `generationConfig` en `ai.js:118-122`.
