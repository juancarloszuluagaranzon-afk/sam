---
name: sync-from-partner
description: >
  Sincroniza el local con cambios pusheados por el socio al repo. Úsala cuando
  el usuario diga "el socio pusheó", "mi socio actualizó el repo", "actualiza
  mi local", "sincroniza con el repo", o pida hacer push/deploy a Vercel
  después de cambios remotos. Maneja contaminación de working copy, conflictos
  con pull y verifica el build antes de pushear.
---

# Sync from Partner — SAM

Rutina para traer cambios del socio sin drama y dejar el local en estado
listo-para-pushear. Pensada para evitar el ping-pong del incidente del
2026-05-11 (build de Vercel rojo + contaminación con código del proyecto de
riego).

## Cuándo aplicarla

Triggers típicos del usuario:
- "el socio pusheó / acaba de actualizar el repo"
- "sincroniza mi local con el repo"
- "necesito hacer push a Vercel"
- "actualiza el local"

## Pasos (en orden, parando en cada checkpoint si algo falla)

### 1. Diagnóstico inicial — NO tocar nada todavía

```sh
git fetch origin
git status
git log --oneline HEAD..origin/main    # qué trae el socio
git log --oneline origin/main..HEAD    # qué tengo local sin pushear
```

Si el working copy está limpio y el HEAD ya iguala `origin/main` → no hay nada
que hacer, avisar y salir.

### 2. Manejo de working copy sucio

Antes de cualquier `git pull`, el working copy debe estar limpio. Si hay
cambios sin commitear, identificar qué son:

- **Cambios legítimos del SAM** (mejoras tuyas en curso): proponer al usuario
  commitear o stashear.
- **Contaminación de otro proyecto**: archivos que claramente NO pertenecen al
  SAM. Señales típicas:
  - `src/App.tsx` con tipos como `IrrigationRecord`, `SoilTexture`, `hacienda`
    como atributo de un objeto distinto al maestro SAM
  - Mención a "riego", "lámina", "eficiencia administrativa" en App.tsx/App.css
  - Carpetas hermanas tipo `../riopaila-riego-app/`
  
  En este caso → mostrar al usuario un resumen breve de qué es y pedir
  confirmación explícita antes de `git checkout --`.
- **Ruido auto-generado**: `supabase/.temp/cli-latest` (bump de versión del
  CLI), archivos de IDE. Descartar sin preguntar.
- **`.claude/settings.local.json`**: NO commitear. Son permisos personales.
  Dejarlo modificado en el working copy.

### 3. Pull con fast-forward only

```sh
git pull --ff-only origin main
```

`--ff-only` falla ruidosamente si hay divergencia (en lugar de generar un
merge commit no deseado). Si falla:
- Mostrar al usuario el output y explicar que tu local tiene commits que el
  socio no, y necesitamos decidir (merge vs rebase vs push primero).
- Parar y pedir decisión.

### 4. Instalar dependencias nuevas (si las hay)

Si el diff trae cambios en `package.json` o `package-lock.json`:

```sh
npm install
```

### 5. Verificar build local

```sh
npm run build
```

Si el build falla:
- Es probable que el socio haya pusheado código que rompe `tsc -b` (ocurrió
  el 2026-05-11 con dos `TS6133` por unused vars en `SupervisorView.tsx`).
- Mostrar el error al usuario, proponer fix quirúrgico, NO pushear hasta
  resolverlo.

Si el build pasa → seguir.

### 6. Reporte final al usuario

Resumen breve con:
- Cuántos commits trajo el socio y qué tocaron (1 línea por commit).
- Si hubo limpieza de contaminación, qué archivos.
- Estado actual: build verde, local sincronizado, listo para trabajar o
  pushear nuevo trabajo.

## Notas duras

- **NO usar `git pull` sin `--ff-only`** — un merge commit accidental ensucia
  la historia.
- **NO descartar archivos sin confirmación explícita** si parecen contener
  trabajo no trivial, incluso si "parecen contaminación". Mejor preguntar
  dos veces que perder código.
- **NO commitear `.claude/settings.local.json`** — es local por diseño.
- **NO ignorar errores TS de unused vars** — el `tsc -b` del repo está
  configurado estricto (`noUnusedLocals`), eso bloquea Vercel.

## Relacionado con

- Hook `pre-push` en `.git/hooks/pre-push` corre `npm run build` antes de cada
  push para evitar empujar código que rompa Vercel. Si bloquea, arreglar
  antes de bypassear con `--no-verify`.
