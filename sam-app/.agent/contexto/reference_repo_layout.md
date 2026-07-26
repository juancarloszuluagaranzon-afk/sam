---
name: Repositorio SAM — layout, rama, hooks
description: Dónde está el repo, qué rama es productiva, cómo está la cadena git→Vercel→clientes
type: reference
originSessionId: 1ce18956-632a-4426-8216-5dffcc058ca5
---
**Repo único (monorepo en `sam/`)**

- Path local: `c:/Users/Agr338/OneDrive - Riopaila Agricola - Castilla Agricola/Documentos/CODEX/asm/sam`
- Remote: `https://github.com/juancarloszuluagaranzon-afk/sam`
- Rama productiva: `main`. Cada push dispara Vercel.
- Subcarpeta de la app: `sam-app/` (Vercel "Root Directory").
- Hooks de git: `sam/.githooks/` activados con `git config core.hooksPath .githooks` (el `pre-push` bloquea TS/build roto).

**Ramas observadas (al 19-may-2026)**

- `main` (HEAD productivo, `aea3532` al momento de escribir esto)
- `feat-dictado-filtros` (rama de feature)

**Hook de auto-sync configurado**

- `.claude/settings.json` invoca `.claude/check-sam-sync.sh` en `SessionStart`.
- El script hace `git fetch` y reporta `local | origin/main | behind | ahead | dirty`.
- Si está limpio y atrasado, pullea automático. Si tiene cambios locales, solo avisa.

**Cómo verificar la versión vigente productiva sin SSH:**

```bash
cd sam && git ls-remote origin main | cut -c1-7
```

O abrir la app productiva → tocar pill/menú → leer SHA en Diagnóstico.
