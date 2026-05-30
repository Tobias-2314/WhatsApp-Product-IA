# 🍽️ WhatsApp Bot de Reservas para Restaurantes

Bot de WhatsApp listo para producción que gestiona reservas de restaurantes usando inteligencia artificial. Construido para venderse como servicio B2B: se configura en menos de 30 minutos por cliente.

**Stack 100% gratuito:** Node.js · Baileys · Google Gemini 1.5 Flash · Google Sheets

---

## ✨ Funcionalidades

| Feature | Descripción |
|---|---|
| 🤖 Reservas con IA | Gemini entiende lenguaje natural: "quiero reservar para el viernes a las 9" |
| 📅 Control de disponibilidad | Verifica mesas en tiempo real en Google Sheets |
| ❌ Cancelaciones | Política configurable (ej: hasta 2hs antes) |
| 🔍 Consulta de reservas | El cliente puede ver sus reservas activas |
| 🍕 Menú por chat | Menú del restaurante enviado como texto formateado |
| 👤 Transferencia a humano | Al escribir "hablar con persona" pausa el bot |
| 🔄 Contexto persistente | Recuerda la conversación hasta 30 min de inactividad |
| 📊 Google Sheets en vivo | El dueño ve las reservas en tiempo real |

---

## 📁 Estructura del proyecto

```
whatsapp-reservas-bot/
├── src/
│   ├── index.js          # Entry point: inicializa Baileys y escucha mensajes
│   ├── bot.js            # Lógica principal: orquesta IA + Sheets + sesiones
│   ├── ai.js             # Integración con Gemini 1.5 Flash
│   ├── sheets.js         # CRUD de Google Sheets (reservas)
│   └── sessions/
│       └── sessionManager.js  # Manejo de contexto por usuario (timeout 30 min)
├── config/
│   └── restaurant.js     # ⚙️ Config del restaurante (editá esto por cliente)
├── auth_info/            # Creado automáticamente (sesión de WhatsApp)
├── logs/                 # Creado automáticamente (logs del bot)
├── .env                  # Variables de entorno (no commitear)
├── .env.example          # Plantilla de variables
├── .gitignore
├── package.json
└── README.md
```

---

## 🚀 Setup completo paso a paso

### Paso 1 — Clonar e instalar

```bash
git clone https://github.com/tu-usuario/whatsapp-reservas-bot.git
cd whatsapp-reservas-bot
npm install
cp .env.example .env
```

---

### Paso 2 — Obtener API Key de Gemini (gratis)

1. Entrá a **[Google AI Studio](https://aistudio.google.com/app/apikey)**
2. Iniciá sesión con tu cuenta de Google
3. Hacé clic en **"Create API key"**
4. Copiá la key y pegala en `.env`:

```env
GEMINI_API_KEY=AIzaSy...tu-key-aqui
```

> ✅ El tier gratuito de Gemini 1.5 Flash incluye **1.500 requests/día** y **1 millón de tokens/minuto** — más que suficiente para un restaurante.

---

### Paso 3 — Configurar Google Sheets como base de datos

#### 3a. Crear el Spreadsheet

1. Entrá a **[Google Sheets](https://sheets.new)** y creá un nuevo documento
2. Renombrá la primera hoja como `Reservas` (exactamente así, con mayúscula)
3. Copiá el ID del spreadsheet desde la URL:
   ```
   https://docs.google.com/spreadsheets/d/[ESTE_ES_EL_ID]/edit
   ```
4. Pegalo en `.env`:
   ```env
   GOOGLE_SHEETS_ID=1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms
   ```

> El bot crea los encabezados automáticamente al iniciar. La hoja quedará:
> `ID | Teléfono | Nombre | Fecha | Hora | Personas | Estado | Timestamp`

#### 3b. Crear Service Account en Google Cloud

1. Entrá a **[Google Cloud Console](https://console.cloud.google.com)**
2. Creá un proyecto nuevo (o usá uno existente)
3. Activá la **Google Sheets API**:
   - Buscá "Sheets API" en la barra de búsqueda
   - Hacé clic en **"Habilitar"**
4. Creá una Service Account:
   - Menú → **IAM y administración** → **Cuentas de servicio**
   - **Crear cuenta de servicio**
   - Nombre: `whatsapp-bot` (o lo que quieras)
   - Rol: **Editor** (o "Básico → Editor")
5. Generá la clave JSON:
   - Hacé clic en la cuenta de servicio creada
   - Pestaña **"Claves"** → **"Agregar clave"** → **"Crear clave nueva"** → **JSON**
   - Descargá el archivo JSON
6. Guardá el archivo como `config/service-account.json` en el proyecto
7. Verificá que en `.env` esté:
   ```env
   GOOGLE_SERVICE_ACCOUNT_KEY_PATH=./config/service-account.json
   ```

#### 3c. Compartir el Spreadsheet con la Service Account

1. Abrí el Spreadsheet de Google Sheets
2. Hacé clic en **"Compartir"** (arriba a la derecha)
3. Pegá el email de la service account (se ve en el JSON, campo `client_email`, algo como `whatsapp-bot@proyecto.iam.gserviceaccount.com`)
4. Dale permisos de **Editor**
5. Deshabilitá la notificación por mail y confirmá

---

### Paso 4 — Configurar el restaurante

Editá `config/restaurant.js` con los datos del cliente:

```js
module.exports = {
  nombre: 'Nombre del Restaurante',
  telefono: '+54 11 XXXX-XXXX',
  direccion: 'Dirección completa',

  franjasHorarias: ['12:00', '14:00', '20:00', '22:00'],
  capacidadMaximaPorFranja: 5,   // mesas por turno
  horasMinimaCancelacion: 2,     // horas antes para cancelar

  mensajeBienvenida: `¡Hola! ...`,
  menu: `🍽️ MENÚ ...`,
};
```

---

### Paso 5 — Iniciar el bot

```bash
npm start
```

La primera vez verás un **código QR** en la terminal:

```
📱 Escaneá este código QR con WhatsApp:
   (WhatsApp → Dispositivos vinculados → Vincular dispositivo)

[QR CODE]
```

1. Abrí WhatsApp en tu celular
2. Menú (3 puntos) → **Dispositivos vinculados** → **Vincular dispositivo**
3. Escaneá el QR
4. ¡Listo! El bot está online

> La sesión se guarda en `./auth_info/`. La próxima vez que inicies el bot no te pedirá QR.

---

### Paso 6 — Desarrollo con auto-recarga

```bash
npm run dev   # Usa nodemon: recarga el bot al guardar cambios
```

---

## ☁️ Deploy a producción

### Opción A — Railway (recomendado, gratis)

1. Creá cuenta en **[Railway](https://railway.app)** (plan Hobby: $5/mes, pero tienen $5 de crédito gratis)
2. Conectá tu repositorio de GitHub
3. Railway detecta el `package.json` automáticamente
4. Configurá las variables de entorno en el panel de Railway:
   - `GEMINI_API_KEY`
   - `GOOGLE_SHEETS_ID`
   - `GOOGLE_SERVICE_ACCOUNT_KEY_PATH=./config/service-account.json`
5. **Importante:** subí el `service-account.json` usando Railway Volumes o pegá el contenido como variable de entorno:
   ```env
   GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":...}
   ```
   Y modificá `sheets.js` para parsear esa variable si `KEY_PATH` no existe.
6. Hacé push y Railway deployea automáticamente

> **Tip Railway:** Guardá la carpeta `auth_info/` en un Volume persistente para no perder la sesión de WhatsApp.

### Opción B — Render (gratis con limitaciones)

1. Creá cuenta en **[Render](https://render.com)**
2. **New Web Service** → conectá tu repo de GitHub
3. Build command: `npm install`
4. Start command: `npm start`
5. Configurá las env vars igual que Railway
6. **Limitación:** el plan gratuito de Render "duerme" el servicio tras 15 min de inactividad — no es ideal para un bot de producción. Usá el plan Starter ($7/mes) para uso 24/7.

### Variables de entorno en producción

```env
GEMINI_API_KEY=AIzaSy...
GOOGLE_SHEETS_ID=1BxiM...
GOOGLE_SERVICE_ACCOUNT_KEY_PATH=./config/service-account.json
NODE_ENV=production
LOG_LEVEL=info
PORT=3000
```

---

## 💰 Modelo de precios sugerido (B2B)

Este bot resuelve un problema real para restaurantes: **recibir reservas 24/7 sin personal**.

### Estructura de cobro recomendada

| Plan | Precio/mes | Qué incluye |
|---|---|---|
| **Starter** | $35.000 ARS / $35 USD | Setup + bot básico + 1 número de WhatsApp |
| **Pro** | $55.000 ARS / $55 USD | + menú personalizado + reportes semanales por mail |
| **Business** | $85.000 ARS / $85 USD | + soporte prioritario + modificaciones mensuales |

### Cobro por setup (pago único)

- Setup e instalación: **$50.000 ARS / $50 USD** (una sola vez)
- Incluye: configuración completa, QR escaneado, pruebas y capacitación al dueño

### Costos operativos (tu costo real)

| Servicio | Costo mensual |
|---|---|
| Gemini 1.5 Flash (1.500 req/día) | **$0** |
| Google Sheets | **$0** |
| Railway Hobby | **~$5 USD** |
| WhatsApp Business (número) | **$0** (se usa el número existente del restaurante) |
| **Total tu costo** | **~$5 USD/mes** |

> **Margen neto con plan Starter:** $30 USD/mes por cliente 🚀

### Argumentos de venta para restaurantes

- "Tu personal no pierde tiempo atendiendo llamados de reserva"
- "Receptás reservas a las 3am cuando estás cerrado"
- "El dueño ve todas las reservas en Google Sheets en tiempo real"
- "El cliente recibe confirmación instantánea"
- "Se paga solo con evitar 2-3 no-shows por mes"

---

## 🔧 Personalización por cliente

Cada cliente nuevo requiere solo:

1. Editar `config/restaurant.js` con sus datos
2. Crear un nuevo Spreadsheet y Service Account
3. Escanear el QR con el número de WhatsApp del restaurante
4. Deploy de una nueva instancia en Railway (5 minutos)

---

## 📊 Google Sheets — Estructura de datos

| Columna | Tipo | Descripción |
|---|---|---|
| ID | Texto | ID único de la reserva (ej: `RL8X4KABC`) |
| Teléfono | Texto | Número del cliente con código de país |
| Nombre | Texto | Nombre completo del cliente |
| Fecha | Texto | Formato DD/MM/YYYY |
| Hora | Texto | Formato HH:MM |
| Personas | Número | Cantidad de comensales |
| Estado | Texto | `confirmada` / `cancelada` / `completada` |
| Timestamp | Texto | Fecha/hora de creación (formato argentino) |

---

## ❓ Preguntas frecuentes

**¿Qué pasa si Gemini no está disponible?**
El bot tiene respuestas de fallback por estado de conversación. El cliente siempre recibe una respuesta, aunque sea genérica.

**¿Puedo usar el mismo número de WhatsApp que ya usa el restaurante?**
Sí, pero hay que tenerlo disponible para escanear el QR. WhatsApp solo permite una sesión web activa a la vez.

**¿Funciona con WhatsApp Business?**
Sí, Baileys funciona igual con WhatsApp y WhatsApp Business.

**¿Cómo saco al bot de modo humano?**
Actualmente reiniciando la conversación (timeout de 30 min) o agregando un comando admin. Para producción podés agregar un mensaje especial como `/reactivar` desde el número del dueño.

**¿Escala a muchos clientes simultáneos?**
Sí. Cada mensaje se procesa de forma asíncrona. El límite real es el tier de Gemini (1.500 req/día en gratuito) y la latencia de Sheets. Para restaurantes normales, sobra con creces.

---

## 🛠️ Troubleshooting

**El QR no aparece o expira:**
```bash
rm -rf auth_info/
npm start
```

**Error "GOOGLE_SHEETS_ID no está definido":**
Verificá que `.env` existe (no solo `.env.example`) y tiene los valores correctos.

**Error "The caller does not have permission":**
El Spreadsheet no fue compartido con el email de la Service Account.

**Gemini devuelve error 429 (rate limit):**
Esperá un minuto. El tier gratuito tiene límites por minuto. El bot tiene fallback automático.

**Bot se desconecta de WhatsApp continuamente:**
Verificá que `auth_info/` sea persistente (en Railway, usá Volumes).

---

## 📄 Licencia

MIT — Libre para uso comercial y modificación.
