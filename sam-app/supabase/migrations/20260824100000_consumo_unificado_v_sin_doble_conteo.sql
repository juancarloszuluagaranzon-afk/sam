-- 🔴 El tanqueo en SEDE se estaba contando DOS VECES.
--
-- La tercera rama de la vista traía todo `combustible_externo` con destino
-- MAQUINA, sin mirar de dónde salió el combustible. Y ahí hay dos casos que no
-- son lo mismo:
--
--   origen = 'ESTACION'  se compró en la bomba. NO pasó por ninguna bodega, así
--                        que no está en el kardex. Esta rama es la única forma
--                        de contarlo — y por eso existe.
--   origen = 'SEDE'      salió del tanque de la principal. `registrarCombustibleExterno`
--                        YA genera una SALIDA de kardex con su `equipo_codigo`,
--                        que la SEGUNDA rama de esta misma vista ya suma.
--
-- Sin el filtro, el segundo caso entra por las dos ramas.
--
-- Las otras dos implementaciones del mismo cálculo SÍ tenían la guarda —
-- `galonesDeMaquina()` en `lib/indicadores.ts` y `ConsumoEquiposTab` ambas hacen
-- `if (t.origen !== 'ESTACION') continue`. Esta vista era la única sin ella, y
-- es justo la que alimenta el tablero del dueño.
--
-- Medido en producción antes de corregir (24-ago-2026): 6 tanqueos, 215,13
-- galones de más, TODOS de la PUMA 2301. Su consumo de agosto salía en 922,07
-- galones cuando son 706,94 — un **30% inflado** en una sola máquina.
--
-- ⚠️ Esto también explica en parte por qué esa máquina disparaba el aviso de
-- "faltan horas": con 30% más galones, las horas implícitas que calcula el
-- tablero salen 30% más altas.

create or replace view consumo_unificado_v as
  -- ── Papel (hasta el 31 de julio) ──────────────────────────────────────────
  select h.fecha,
         h.equipo_codigo,
         h.operario,
         h.responsable,
         'COMBUSTIBLE'::text     insumo,
         'galón'::text           unidad,
         h.galones               cantidad,
         'papel'::text           fuente
    from consumo_historico h where h.galones <> 0
  union all
  select h.fecha, h.equipo_codigo, h.operario, h.responsable,
         'GANCHOS', 'unidad', h.ganchos, 'papel'
    from consumo_historico h where h.ganchos <> 0

  -- ── App: lo que salió de una bodega a una máquina ─────────────────────────
  -- Consumo NETO: la ENTRADA es la devolución que reclamó el operario, y restarla
  -- es lo que hace que este número coincida con el del reporte de consumo.
  -- ⚠️ Esta rama YA incluye el tanqueo con origen='SEDE', porque ese sí generó
  -- movimiento de kardex. Por eso la tercera rama tiene que excluirlo.
  union all
  select k.fecha_efectiva::date,
         k.equipo_codigo,
         coalesce(s.operario_nombre, ''),
         coalesce(u.nombre_completo, ''),
         i.nombre,
         i.unidad,
         case when k.tipo = 'SALIDA' then k.cantidad else -k.cantidad end,
         'app'
    from insumos_kardex k
    join insumos i on i.id = k.insumo_id
    left join insumos_solicitudes s on s.id::text = k.referencia
    left join app_usuarios u on u.id = s.despachado_por
   where k.equipo_codigo is not null
     and k.tipo in ('SALIDA','ENTRADA')

  -- ── App: tanqueo en BOMBA, que no pasa por ninguna bodega ─────────────────
  union all
  select c.fecha, c.equipo_codigo,
         coalesce(c.operario_nombre, ''),
         coalesce(u.nombre_completo, ''),
         'COMBUSTIBLE', 'galón', c.galones, 'app'
    from combustible_externo c
    left join app_usuarios u on u.id = c.registrado_por
   where c.destino = 'MAQUINA'
     and c.origen  = 'ESTACION'   -- ← la guarda que faltaba
     and c.estado <> 'RECHAZADO'
     and c.equipo_codigo is not null;

comment on view consumo_unificado_v is
  'Consumo por máquina, papel + app, sin traslape ni doble conteo: el histórico '
  'corta el 31-jul-2026 y desde agosto manda la app. El tanqueo entra SOLO si '
  'fue en estación; el de sede ya viene por el kardex.';

grant select on consumo_unificado_v to anon, authenticated;

notify pgrst, 'reload schema';
