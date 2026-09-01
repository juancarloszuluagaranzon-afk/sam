-- Quién solicita y qué solicita (1-sep-2026).
--
-- El dueño lo pidió y hay que mostrarlo. La primera versión reemplazaba este
-- panel por una explicación de por qué estaba vacío, y esa fue una decisión mía
-- que él no tomó: **un indicador con pocos datos sigue siendo un indicador**, y
-- la adopción del flujo (2 de cada 100 entregas nacen de un pedido) es
-- justamente el número que le dice si vale la pena empujarlo.
--
-- Lo que sí se conserva es el tamaño de la muestra AL LADO del dato, no en vez
-- del dato: un ranking de tres filas con n=6 se lee distinto cuando se ve que
-- son seis. Esconder el panel era paternalista; mostrarlo sin contexto sería
-- engañoso. Se muestra con contexto.
create or replace function public.resumen_solicitudes_operarios(
  p_desde date,
  p_hasta date
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_res jsonb;
begin
  with pedidos as (
    select s.id, s.operario_id, s.operario_nombre, s.estado, s.created_at,
           s.entregado_en, s.nota, s.requerido_para, s.motivo_rechazo
      from insumos_solicitudes s
     where s.origen = 'OPERARIO'
       and s.created_at >= p_desde::timestamptz
       and s.created_at < (p_hasta + 1)::timestamptz
       and not exists (select 1 from app_usuarios up
                        where up.id = s.operario_id and up.es_prueba)
  )
  select jsonb_build_object(
    -- Ranking de quién pide. Con pocos datos sigue valiendo: dice QUIÉNES son
    -- los que ya adoptaron el flujo, que es a quienes hay que preguntarles cómo
    -- les fue para poder empujarlo con los demás.
    'porOperario', coalesce((
      select jsonb_agg(x order by (x->>'solicitudes')::int desc, x->>'nombre') from (
        select jsonb_build_object(
          'id', p.operario_id,
          'nombre', coalesce(p.operario_nombre, u.nombre_completo, p.operario_id),
          'solicitudes', count(*),
          'entregadas', count(*) filter (where p.estado = 'ENTREGADA'),
          'pendientes', count(*) filter (where p.estado in ('PENDIENTE', 'PROGRAMADA')),
          'rechazadas', count(*) filter (where p.estado = 'RECHAZADA'),
          'ultima', max(p.created_at)
        ) as x
          from pedidos p
          left join app_usuarios u on u.id = p.operario_id
         where p.operario_id is not null
         group by p.operario_id, p.operario_nombre, u.nombre_completo
      ) t
    ), '[]'::jsonb),

    -- QUÉ se pide. Es la otra mitad de la pregunta del dueño, y con pocos datos
    -- es incluso más útil que el ranking: dice qué material le hace falta a la
    -- gente sin que nadie se lo lleve.
    'porInsumo', coalesce((
      select jsonb_agg(x order by (x->>'veces')::int desc) from (
        select jsonb_build_object(
          'nombre', i.insumo_nombre,
          'unidad', coalesce(nullif(i.unidad, ''), ''),
          'veces', count(distinct i.solicitud_id),
          'cantidad', round(sum(i.cantidad)::numeric, 2)
        ) as x
          from insumos_solicitud_items i
          join pedidos p on p.id = i.solicitud_id
         group by i.insumo_nombre, coalesce(nullif(i.unidad, ''), '')
      ) t
    ), '[]'::jsonb),

    -- El detalle, una fila por solicitud. Con seis registros la lista completa
    -- informa más que cualquier agregado, y deja ver el caso concreto: quién
    -- pidió qué, cuándo, y en qué quedó.
    'detalle', coalesce((
      select jsonb_agg(x order by x->>'creada' desc) from (
        select jsonb_build_object(
          'id', p.id,
          'operario', coalesce(p.operario_nombre, '—'),
          'creada', p.created_at,
          'entregada', p.entregado_en,
          'requeridoPara', p.requerido_para,
          'estado', p.estado,
          -- 🔴 El motivo del rechazo es el dato mas informativo del panel. En
          -- agosto-septiembre, 2 de 4 rechazos dicen "YA SE ENTREGO": el material
          -- si llego, solo que por la ruta antes de que alguien atendiera el
          -- pedido. Eso explica la baja adopcion mejor que cualquier agregado, y
          -- es accionable: el pedido no compite con la falta de material, compite
          -- con el carro del supervisor.
          'motivo', p.motivo_rechazo,
          'nota', p.nota,
          'items', (select string_agg(
                      it.insumo_nombre || ' ' ||
                      trim(to_char(coalesce(it.cantidad_despachada, it.cantidad), 'FM999999.99')) ||
                      ' ' || coalesce(it.unidad, ''), ' + ' order by it.insumo_nombre)
                      from insumos_solicitud_items it where it.solicitud_id = p.id)
        ) as x
          from pedidos p
         order by p.created_at desc limit 60
      ) t
    ), '[]'::jsonb)
  ) into v_res;

  return v_res;
end;
$$;

comment on function public.resumen_solicitudes_operarios is
  'Quien solicita, que solicita y el detalle. Va aparte del resumen general para no cargarlo cuando no se abre el panel.';

grant execute on function public.resumen_solicitudes_operarios(date, date) to anon, authenticated;
