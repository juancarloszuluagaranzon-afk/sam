---
name: Reportar BUILD_VERSION vigente tras cada cambio
description: Después de cada implementación, build o deploy, indicar al usuario explícitamente qué BUILD_VERSION quedó vigente (local y/o en producción)
type: feedback
originSessionId: 1ce18956-632a-4426-8216-5dffcc058ca5
---
Cada vez que se haga un cambio en el código de SAM/AgroMorales, **siempre** reportar al usuario la versión que quedó vigente, antes de cerrar el turno.

**Formato esperado**

- Si solo hubo build local: indicar el `BUILD_VERSION` que generó esa build (`local-YYYYMMDDHHMM`).
- Si se hizo push a main + Vercel desplegó: indicar el `BUILD_VERSION` final del deploy productivo (`<sha7>-<UTC stamp>`).
- Si hay ambos: distinguirlos. La pill flotante de la app es la fuente de verdad de qué corre en cada dispositivo.

**Cómo obtener el valor**

1. Después de `npm run build`: buscar `__BUILD_VERSION__` reemplazado en `dist/assets/index-*.js` o en `dist/sw.js`. Ejemplo: `grep -oE 'local-[0-9]{12}' dist/assets/*.js | head -1`.
2. En Vercel: viene del deploy log, o de la propia pill en la app productiva.
3. Si no se pudo construir, decirlo explícitamente — no inventar.

**Why:** El usuario lo pidió explícitamente el 19-may-2026 ("siempre que hagas esto por favor me indica qué versión quedó vigente"). Conecta con el blindaje de soporte: si un operador llama, el supervisor debe poder comparar la versión del celular con la versión vigente. Sin que yo se la diga, el usuario tiene que adivinarla o desplegarla.

**How to apply**

- Al final de cualquier implementación, deploy, restauración o cambio: añadir una línea concreta tipo `**Versión vigente: <BUILD_VERSION>**`.
- Si la versión cambió durante el turno (varias builds), mostrar la última.
- Si el cambio aún no se desplegó a Vercel (solo está en archivos locales sin build), reportar "build local pendiente — al hacer `npm run build` quedará marcada como `local-<timestamp UTC>`".
