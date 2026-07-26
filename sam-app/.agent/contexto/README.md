# Contexto del proyecto (memoria versionada)

Copia **versionada** de la memoria de trabajo del proyecto, para que el contexto
viaje con el repositorio y cualquier sesión —desde el computador, desde
`claude.ai/code` o desde el celular— arranque ubicada.

- **Empieza por** `MEMORY.md`: es el índice, con una línea por tema.
- `project_*.md` — módulos, decisiones e historia (qué se construyó y por qué).
- `feedback_*.md` — cómo quiere trabajar el usuario (reglas de comportamiento).
- `reference_*.md` — servicios externos, layout del repo.
- `user_profile.md` — quién es el usuario.

> Si trabajas desde el computador de Iván, la memoria viva está en
> `~/.claude/projects/<proyecto>/memory/` y **esa manda**. Esta carpeta es el
> espejo para las sesiones remotas: al terminar un cambio importante, vale
> refrescarla (copiar los `.md` actualizados aquí) y commitear.
