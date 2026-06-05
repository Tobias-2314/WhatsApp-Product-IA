# nueva-accion

Scaffold a new bot action end-to-end. The user will specify the action name and a short description.

Usage: `/nueva-accion <nombre> — <descripción>`  
Example: `/nueva-accion show_promotions — muestra las promociones del día`

Steps:

## 1. Validate input
Parse the argument to extract `nombre` (snake_case) and `descripción`.
If not provided, ask the user for both before continuing.

## 2. ai.js — agregar al system prompt
In `src/ai.js`, find the `ACCIONES DISPONIBLES` section inside `_construirSystemPrompt`.
Add a new bullet describing the action and when the AI should trigger it.
Add the new action name to the valid values list of the `action` field in the JSON schema comment.

## 3. bot.js — agregar el case
In `src/bot.js`, find the `_ejecutarAccion` method (the switch/if-else block).
Add a new case for the action name that:
- Calls a new private method `_<camelCase>(sesion)` on `this`
- The stub method should log `[ACCION] <nombre>` and return a placeholder string `'⚙️ Acción <nombre> no implementada aún.'`

## 4. Report
Show a summary of exactly what was added/changed in each file, with line references.
Remind the user to implement the logic inside `_<camelCase>()` in `bot.js`.
