---
name: Direct action when context is given
description: Cuando el usuario ya dio contexto claro, no volver a preguntar lo mismo — ir directo a la acción/solución
type: feedback
originSessionId: 1ce18956-632a-4426-8216-5dffcc058ca5
---
Cuando el usuario ya estableció el contexto (ej. "es en el VPS", "ya borré la data"), NO volver a abrir disyuntivas que él ya cerró. Ir directo a la solución concreta sobre el contexto confirmado.

**Why:** El usuario explícitamente dijo "no me hagas perder tiempo, te doy buen contexto" después de que yo abrí dos ramas (Cloud vs VPS) cuando él ya había confirmado VPS. Lo siente como retroceso, no como cuidado.

**How to apply:**
- Si el contexto ya se confirmó en mensajes anteriores, asumirlo y proceder.
- Si necesito un dato puntual del entorno actual (URL, clave, etc.), pedir solo ese dato, no replantear el panorama.
- Reservar las disyuntivas "A vs B" para cuando realmente no haya información, no para cubrirme.
- Solo pedir confirmación antes de acciones destructivas o irreversibles, no antes de operaciones de lectura/configuración.
