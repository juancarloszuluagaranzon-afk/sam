---
name: project_catalogos
description: Submenú Catálogos (Maestros/Labores/Empresas/Terceros) y la regla de que Empresas es solo visual
metadata: 
  node_type: memory
  type: project
  originSessionId: 28aa41c3-1db2-4e9f-bbd1-5f104a70108e
---

Desde 19-jun-2026 el menú del owner/admin agrupa en un submenú **"Catálogos"**: Maestros, Labores, **Empresas** y **Terceros** (commit `59d3677`, migración `20260619120000_empresas_terceros`).

- **Empresas** (`empresas`): catálogo **puramente VISUAL/informativo**, sin lógica ni condicionantes. La matriz es Agroservicios Morales; las otras 2 empresas a las que se les administra maquinaria se listan solo como referencia para cobrar. **NO ligar empresa al operador, NO condicionar nada con empresa.** El 19-jun ya construí y **revertí** un campo `empresa_id` en `app_usuarios` porque el usuario lo rechazó explícitamente.
- **Terceros** (`terceros`): catálogo **informativo simple** de ingenios y terceros. CRUD de nombres, igual que Empresas. **NO se enlaza a las suertes, NO condiciona nada.**
- **Ingenios** (`ingenios`, ✅ 8-jul-2026): catálogo REAL y OPERATIVO de ingenios/compradores (el `ingenio_id` del maestro), editable desde Catálogos. Tabla `ingenios` (id=slug estable, nombre, activo; migración `20260708120000_ingenios_catalogo`, sembrada con los 6). Pestaña `IngeniosTab` (CRUD, avisa nº de suertes que usan el ingenio antes de borrar). Se **centralizó** la antigua lista fija de 5 en `src/data/ingenios.ts` (antes duplicada en 6 archivos → una desincronizada rechazaba el cargue masivo). El contexto carga `ingenios` y los inyecta a los dropdowns (SupervisorView/OperatorView/MaestrosTab/RegistrarLaborModal/BulkMaestroModal usan `ingeniosOpts` = activos) y a `getIngenioName` vía `setIngenioNamesRuntime`. Fallback a la semilla si la BD no carga (dropdowns nunca vacíos). Detonante: alta de "Trapiche Lucerna" (commit `9249a81`). **Esto SÍ es la "vía grande" que en jun-2026 se dejó pendiente** (ver párrafo siguiente).

**Historia (resuelto 21-jun-2026):** primero monté `tercero_id` como columna adicional en `maestro_risaralda` + selector en Maestros (commit `59d3677`). El usuario lo rechazó en dos pasos: (1) "el tercero es el mismo ingenio, no un campo nuevo"; (2) finalmente "desmonta toda esa lógica, hazlo sencillo, que sea solo informativo, no que condicione". **Decisión final:** Empresas y Terceros son SOLO catálogos visuales/informativos; se **desmontó** todo el enganche `tercero_id` (columna, selector, API, tipo). La idea de unificar el catálogo dentro de `ingenio_id` (reemplazar la lista fija de 5 ingenios hardcodeada en MaestrosTab/OperatorView/SupervisorView/BulkMaestroModal + `INGENIO_NAMES`/`getIngenioName`) **NO se hizo** — se consideró demasiado grande. Si en el futuro lo piden, ESA es la vía, pero confirmar alcance antes. La columna `tercero_id` quedó en BD si se corrió la migración vieja → se puede `ALTER TABLE maestro_risaralda DROP COLUMN IF EXISTS tercero_id`. Ver [[project_maestro_codigo_compartido]].

**Why:** el usuario aclaró que empresas es solo un tema visual para saber qué labor hizo la persona de otra empresa y poder cobrar, sin que eso quede operativo en el aplicativo.

**How to apply:** si en el futuro piden "algo con empresas", confirmar si es solo catálogo o realmente quieren lógica antes de ligarla a usuarios/asignaciones. Empresas/Terceros/Zonas NO se cachean en Dexie (offline → vacío hasta el primer sync). Relacionado con [[project_owner_admin_tools]].

- **Zonas** (`zonas`, 21-jun-2026): catálogo con `codigo` (valor guardado, sembrado NORTE/SUR) + `nombre`. Cada **supervisor** lleva `app_usuarios.zona` (= codigo), elegida en el form de Usuarios (campo visible solo si rol=supervisor). Al aprobar labores de campo, la ZONA del modal se **auto-llena** con la zona del supervisor logueado (`users.find(session.id).zona`), evitando que Alfredo (Norte) la ponga cada vez. La RPC `app_create_user`/`app_update_user` ahora lleva `p_zona` (6 args, md5 PIN intacto). El Tablero/filtros siguen con el enum Norte/Sur (NO se refactorizó toda la app — decisión de alcance contenido). A diferencia del empresa↔operador (que se rechazó por ser "solo informativo"), aquí el zona↔supervisor SÍ se quiso porque tiene función real (auto-llenado).
