---
name: SIEMPRE git fetch + diff con origin/main ANTES de tocar código
description: Regla férrea — antes de implementar/reescribir cualquier cosa, verificar que el workspace local esté al día con origin/main. NO confiar en "Your branch is up to date" sin fetch reciente.
type: feedback
originSessionId: 1ce18956-632a-4426-8216-5dffcc058ca5
---
**Antes de modificar/crear archivos en `sam/`, hacer SIEMPRE:**

```bash
cd "<workspace>/sam"
git fetch origin
git log --oneline HEAD..origin/main | head -20
```

Si hay commits arriba: el local está desactualizado. Sincronizar (stash + rebase) antes de tocar nada. Si no se hace, se reescriben features que ya existen y se borra trabajo ajeno.

**Hook automático ya configurado**

Existe `.claude/check-sam-sync.sh` que corre en cada `SessionStart` (ver `.claude/settings.json`). Hace fetch + reporta behind/ahead/dirty y auto-pullea si es seguro. Output esperado:

```
[sam-sync] repo=sam | local=<SHA> | origin/main=<SHA> | behind=N | ahead=N | dirty=yes/no
```

Leer ese output al inicio de cada sesión. Si dice `behind=N` y N>0, sincronizar antes de proponer cambios. Si dice `dirty=yes`, revisar `git status` para entender qué hay sin commitear.

**Why:** 19-may-2026 implementé 6 features completas (DiagnosticModal, UpdateBanner, SW manual, login error de red, limpieza Dexie al login, sello de versión) que YA existían en `main` desde días antes. Mi local estaba 32 commits atrás, nunca hice fetch. El usuario tuvo que detenerme y mostrarme la captura de la Diagnóstico vigente para que me diera cuenta. Tiempo perdido + ego golpeado. No vuelve a pasar.

**How to apply:**

- Al inicio de cualquier sesión, leer la línea `[sam-sync]` del SessionStart hook.
- Antes de hacer Write/Edit en `sam/sam-app/src/**`, si no he visto la línea reciente del hook, correr `git fetch && git log --oneline HEAD..origin/main`.
- Si el usuario afirma que algo está implementado y yo no lo veo: PRIMER paso, fetch + buscar en origin/main, no asumir que el usuario se equivoca.
- Si propongo implementar algo no trivial, primero verificar que no exista ya con: `find sam-app/src -name "<keyword>*"` y `git log --all --oneline --grep="<keyword>" -i`.
