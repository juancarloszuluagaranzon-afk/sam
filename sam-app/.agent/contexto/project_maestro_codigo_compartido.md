---
name: project_maestro_codigo_compartido
description: Landmine — dos haciendas comparten código 1 + ingenio mayaguez en maestro_risaralda
metadata: 
  node_type: memory
  type: project
  originSessionId: 28aa41c3-1db2-4e9f-bbd1-5f104a70108e
---

En `maestro_risaralda`, el código de hacienda `1` + `ingenio_id = 'mayaguez'` lo comparten **DOS haciendas distintas**: `LA FLORESTA TASCON` (92 suertes, numeradas `1-1, 1-2, …, 15-3`) y `Santa Fe` (31 suertes, numeradas `71, 73, 74, 300, 71A, 71C…`).

La constraint única `uniq_maestro_suerte` es `(hacienda, suerte, ingenio_id)` — NO incluye `nombre_hacienda`. Hoy no chocan porque la numeración es disjunta y el `suerte_codigo` resultante difiere (`1-1-1` vs `1-71`).

**Why:** quedó así desde antes; al subir/corregir suertes de TASCON (18-jun-2026) salió a la luz al contar 123 filas bajo `hacienda=1+mayaguez`.

**How to apply:** al insertar/editar suertes filtrar SIEMPRE también por `nombre_hacienda`, nunca solo por `hacienda + ingenio_id`. Si alguna vez Santa Fe necesita una suerte con formato `N-N` (p.ej. `1-1`), chocaría con TASCON y una no se guardará → ahí tocaría separar con códigos de hacienda distintos. Relacionado con [[project_owner_admin_tools]] (landmine tabla `labores` singular).

Corrección de TASCON 18-jun-2026: suertes mal creadas con coma (`1,2`) → guion (`1-2`) vía `UPDATE … replace(suerte,',','-')`; 72 nuevas insertadas con `ON CONFLICT (hacienda,suerte,ingenio_id) DO NOTHING`; áreas `2-4=4.42, 9-5=6.61, 9-6=6.54` corregidas. NO había asignaciones sentadas (corregir maestro NO actualiza `asignaciones`, pero no aplicó).
