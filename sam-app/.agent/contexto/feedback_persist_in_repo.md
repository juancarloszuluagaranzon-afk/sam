---
name: Persistir contexto en README + skills, no solo en memoria
description: Cuando el usuario explique panorama operativo, dejarlo también en README/skills del repo para que cualquier futura sesión lo vea
type: feedback
originSessionId: 1ce18956-632a-4426-8216-5dffcc058ca5
---
Cuando el usuario dé contexto operativo amplio (estado del sistema, infraestructura, incidentes, riesgos, decisiones organizacionales): **además** de guardarlo en memoria, dejarlo en:
- `sam/README.md` y/o `sam/sam-app/README.md` — para socios y nuevos colaboradores.
- `sam/sam-app/.agent/skills/managing-supabase/SKILL.md` y skills relacionados — para que cualquier sesión de cualquier agente vea el contexto al cargar el skill.

**Why:** El 19-may-2026 el usuario expresó frustración: "te dije la semana pasada que dejaras todo en readme.md y actualizaras todos los skills". Memoria de mi lado no basta — el usuario opera con varios agentes/herramientas (CODEX, Claude Code, otros) y el repo es la fuente común. Persistir en el repo es responsabilidad mía.

**How to apply:**
- Tras un bloque de contexto del usuario tipo "resumen para socios" o "estado del sistema": actualizar memoria + README + skills en el mismo turno.
- Si el contexto contradice lo que dice README o un skill, sobreescribir/corregir el archivo del repo, no solo añadir a memoria.
- Mantener los archivos del repo en su mismo idioma (español si así están) y registro de tono.
