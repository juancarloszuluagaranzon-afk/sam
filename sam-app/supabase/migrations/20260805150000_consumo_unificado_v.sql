-- La serie de consumo completa: papel hasta julio, app desde agosto.
--
-- Existe para que la app lea UNA sola cosa. La alternativa era unir las tres
-- fuentes en TypeScript en cada pantalla que las necesite, y con tres fuentes
-- eso se desincroniza el día que alguien toque una y olvide las otras.
--
-- Las tres fuentes y por qué son tres:
--   `consumo_historico`   el formato en papel (mar-jul). Solo lectura.
--   `insumos_kardex`      lo que sale de una bodega a una máquina.
--   `combustible_externo` el tanqueo en bomba: NUNCA pasó por bodega, así que
--                         no está en el kardex, pero sí es consumo de la máquina.
--
-- ⚠️ Olvidar la tercera es el error clásico: el reporte da de menos y nadie
-- entiende por qué. En agosto son 76 galones que no están en ningún kardex.

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

  -- ── App: tanqueo en bomba, que no pasa por ninguna bodega ─────────────────
  union all
  select c.fecha, c.equipo_codigo,
         coalesce(c.operario_nombre, ''),
         coalesce(u.nombre_completo, ''),
         'COMBUSTIBLE', 'galón', c.galones, 'app'
    from combustible_externo c
    left join app_usuarios u on u.id = c.registrado_por
   where c.destino = 'MAQUINA'
     and c.estado <> 'RECHAZADO'
     and c.equipo_codigo is not null;

comment on view consumo_unificado_v is
  'Consumo por máquina, papel + app, sin traslape: el histórico corta el '
  '31-jul-2026 y desde agosto manda la app. Incluye el tanqueo en estación, que '
  'no pasa por el kardex y es el que más se olvida.';

grant select on consumo_unificado_v to anon, authenticated;
