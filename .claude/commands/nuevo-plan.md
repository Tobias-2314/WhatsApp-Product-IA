# nuevo-plan

Crea un plan de implementación detallado en `planes-claude/` para una feature o tarea del proyecto.

Usage: `/nuevo-plan <nombre> — <descripción breve>`  
Example: `/nuevo-plan mercadopago — integración real del SDK de MercadoPago para cobro de señas`

---

## 1. Validar input

Extraer `nombre` (kebab-case, sin espacios) y `descripción` del argumento.  
Si no se proporcionan, pedirlos antes de continuar.

## 2. Explorar el código relevante

Antes de escribir el plan, leer los archivos que la feature tocará:
- Buscar en `src/` los módulos relacionados con la descripción.
- Leer los métodos/secciones específicas que cambiarán (no el archivo entero si es largo).
- Identificar dependencias: ¿qué otros módulos llaman a los que vas a modificar?

El objetivo es escribir un plan con **nombres de archivo, líneas y firmas reales** — no genérico.

## 3. Escribir el plan en `planes-claude/<nombre>.md`

El archivo debe tener esta estructura:

```markdown
# Plan: <descripción>

## Contexto
Qué existe hoy y por qué no alcanza. Referencias a archivos/líneas concretas.

## Objetivo
Qué debe ser verdad cuando el plan esté completo. Una oración por bullet.

## Archivos que cambian
Lista de archivos con una línea de qué cambia en cada uno.

## Pasos de implementación

### Paso 1 — <título>
- Archivo: `ruta/al/archivo.js`
- Qué hacer exactamente (método a agregar, query a cambiar, campo a agregar).
- Código de ejemplo o snippet si el cambio no es trivial.

### Paso 2 — ...

## Variables de entorno / config nuevas
(si aplica)

## Riesgos y consideraciones
- Qué puede salir mal.
- Qué verificar antes de deployar.
- Si requiere migration de DB: indicar si es segura con datos existentes.

## Orden de implementación recomendado
Numerado, de menor a mayor riesgo.
```

## 4. Reportar

Mostrar la ruta del archivo creado y un resumen de 3-5 líneas del plan (qué archivos toca, cuántos pasos, riesgos principales).
