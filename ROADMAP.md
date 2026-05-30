# Roadmap de mejoras — WhatsApp Bot de Reservas

Propuestas de cambios visuales y funcionales ordenadas por impacto.

---

## Mensajes de WhatsApp

### 1. Botones interactivos nativos
**Impacto:** Alto · **Esfuerzo:** Medio

Baileys soporta `buttonMessage` y `listMessage`. En lugar de pedirle al usuario que escriba texto libre, el bot muestra botones tocables al iniciar la conversación:

```
┌─────────────────────────────┐
│  Hola! ¿En qué te ayudo?   │
├─────────────────────────────┤
│  📅 Hacer una reserva       │
│  🔍 Ver mi reserva          │
│  ❌ Cancelar mi reserva     │
│  📋 Ver el menú             │
└─────────────────────────────┘
```

**Trade-off:** Funciona solo en WhatsApp actualizado. Algunos carriers o versiones antiguas muestran el mensaje como texto plano.

---

### 2. QR de confirmación
**Impacto:** Medio · **Esfuerzo:** Bajo

Al confirmar reserva, generar un QR con el ID y los datos usando la lib `qrcode` y enviarlo como imagen. El cliente lo muestra al llegar, el staff lo escanea desde el panel admin.

**Trade-off:** Requiere que el staff tenga forma de escanear el QR en el momento.

---

### 3. Encuesta post-visita automática
**Impacto:** Medio · **Esfuerzo:** Bajo

24 horas después de la reserva, el scheduler existente envía:

```
¿Cómo estuvo tu visita a La Parrilla de Don José?
Respondé con un número del 1 al 5 ⭐
```

Los resultados se guardan en una pestaña "Reseñas" de Google Sheets.

**Trade-off:** El bot no puede distinguir si el cliente efectivamente fue o canceló en el último momento — habría que filtrar las reservas canceladas.

---

## Panel de administración

### 4. Gráficos de ocupación
**Impacto:** Medio · **Esfuerzo:** Bajo

Agregar Chart.js via CDN (sin instalar nada) al panel admin para mostrar:
- Bar chart: reservas por día de la semana
- Línea: tendencia de reservas del último mes

Permite detectar días flojos y planificar promotions.

**Trade-off:** Requiere acumular datos históricos para que los gráficos sean útiles.

---

### 5. Vista de calendario semanal
**Impacto:** Alto · **Esfuerzo:** Medio

Reemplazar (o complementar) la tabla actual con una grilla visual:

```
           Lun   Mar   Mié   Jue   Vie   Sáb   Dom
12:00    [ 2/5] [ 0/5] [ 3/5] [ 5/5] [ 4/5] [ 5/5] [ 1/5]
14:00    [ 1/5] [ 2/5] [ 0/5] [ 3/5] [ 5/5] [ 4/5] [ 2/5]
20:00    [ 4/5] [ 3/5] [ 5/5] [ 2/5] [ 5/5] [ 5/5] [ 3/5]
21:00    [ 2/5] [ 1/5] [ 4/5] [ 5/5] [ 5/5] [ 5/5] [ 4/5]
22:00    [ 0/5] [ 2/5] [ 3/5] [ 4/5] [ 5/5] [ 5/5] [ 2/5]
```

Cada celda muestra mesas ocupadas / capacidad. Las llenas se resaltan en rojo.

**Trade-off:** Más complejo de implementar que la tabla, especialmente el responsive mobile.

---

### 6. Notificaciones en tiempo real
**Impacto:** Alto · **Esfuerzo:** Bajo

Agregar un WebSocket al servidor HTTP existente. Cuando llega una reserva nueva, el panel emite un sonido y muestra un banner sin necesidad de refrescar la página manualmente.

**Trade-off:** Requiere mantener conexiones WebSocket abiertas en el servidor.

---

### 7. Bloqueo de fechas desde el panel
**Impacto:** Alto · **Esfuerzo:** Medio

Agregar en el panel admin un botón "Bloquear fecha" que marca un día como cerrado (feriado, evento privado, mantenimiento). El bot consultaría la lista de fechas bloqueadas antes de aceptar reservas.

**Trade-off:** Requiere una pestaña nueva en Sheets o un archivo de config para guardar las fechas bloqueadas.

---

## Funcionalidades nuevas

### 8. Lista de espera
**Impacto:** Alto · **Esfuerzo:** Medio

Cuando una franja está llena, ofrecer:

```
Ese horario está lleno. ¿Querés que te avise 
si se libera un lugar? Respondé SÍ para anotarte.
```

Si alguien cancela, el bot notifica automáticamente al primero en la lista y le da 30 minutos para confirmar.

**Trade-off:** Requiere una pestaña "ListaEspera" en Sheets y lógica de notificación encadenada.

---

### 9. Integración con Google Calendar
**Impacto:** Medio · **Esfuerzo:** Medio

Al confirmar una reserva, crear un evento en el Google Calendar del restaurante con los datos del cliente. El staff lo ve en su celular sin necesitar abrir el panel web.

**Trade-off:** Requiere agregar el scope `calendar` a la Service Account y otro punto de falla potencial.

---

### 10. Comandos de staff por WhatsApp
**Impacto:** Alto · **Esfuerzo:** Medio

Un número de teléfono del staff reconocido por el bot que puede enviar comandos especiales:

| Comando | Resultado |
|---|---|
| `reservas hoy` | Lista de reservas del día |
| `cancelar R3KX2A` | Cancela esa reserva |
| `bloquear 25/07` | Bloquea esa fecha |
| `disponibilidad 25/07` | Muestra la ocupación por franja |

Permite gestionar el restaurante directo desde WhatsApp sin abrir el panel web.

**Trade-off:** Requiere una lista de números de staff autorizados y un parser de comandos separado del flujo de clientes.

---

### 11. Soporte multi-restaurante
**Impacto:** Estratégico · **Esfuerzo:** Alto

Refactorizar para que la misma instancia pueda manejar múltiples números de WhatsApp y restaurantes con configuraciones independientes, cada uno con su hoja de Sheets y su `restaurant.js`.

Convierte el proyecto en un SaaS que se puede ofrecer a otros restaurantes.

**Trade-off:** Requiere refactorizar toda la arquitectura de sesiones, configuración y conexiones de Baileys.

---

## Resumen por impacto

| # | Propuesta | Impacto | Esfuerzo |
|---|---|---|---|
| 1 | Botones interactivos nativos | Alto | Medio |
| 6 | Notificaciones en tiempo real en el panel | Alto | Bajo |
| 8 | Lista de espera | Alto | Medio |
| 5 | Vista de calendario semanal | Alto | Medio |
| 10 | Comandos de staff por WhatsApp | Alto | Medio |
| 7 | Bloqueo de fechas desde el panel | Alto | Medio |
| 3 | Encuesta post-visita | Medio | Bajo |
| 2 | QR de confirmación | Medio | Bajo |
| 4 | Gráficos de ocupación | Medio | Bajo |
| 9 | Integración con Google Calendar | Medio | Medio |
| 11 | Multi-restaurante (SaaS) | Estratégico | Alto |
