-- El tablero de movimientos de insumos, resuelto en la base (31-ago-2026).
--
-- 🔴 Devuelve el resumen YA AGREGADO, no las filas. Un mes son ~400 entregas con
-- sus ítems: traerlas al celular para sumarlas allá son cientos de KB cada vez
-- que alguien abre el tablero, y acabamos de medir que los datos móviles son el
-- gasto que la gente sí nota. Así son unos pocos KB.
--
-- ⚠️ Cuenta ENTREGAS (hechos), no filas de kardex: una entrega de ganchos +
-- combustible es UN viaje del supervisor, no dos. Contar filas premiaría a quien
-- entrega materiales sueltos, que es justo el incentivo que no se quiere crear
-- cuando de este número va a salir un pago.
create or replace function public.resumen_movimientos_insumos(
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
  with entregas as (
    select s.id, s.operario_id, s.operario_nombre, s.despachado_por, s.equipo_codigo,
           s.horometro, s.confirmado_en, s.conforme,
           coalesce(s.entregado_en, s.created_at) as cuando,
           (s.evidencia_urls is not null and array_length(s.evidencia_urls, 1) > 0) as con_foto
      from insumos_solicitudes s
     where s.estado = 'ENTREGADA'
       and coalesce(s.entregado_en, s.created_at) >= p_desde::timestamptz
       and coalesce(s.entregado_en, s.created_at) < (p_hasta + 1)::timestamptz
  ),
  -- Volumen en galones por entrega. Solo lo que se mide en galones: sumar
  -- galones con unidades da un número que no significa nada.
  galones as (
    select i.solicitud_id, sum(coalesce(i.cantidad_despachada, i.cantidad)) as gal
      from insumos_solicitud_items i
      join insumos ins on ins.id = i.insumo_id
     where upper(ins.unidad) like 'GAL%'
     group by 1
  ),
  -- EVENTOS DE SERVICIO: entregas del mismo despachador a la misma máquina
  -- dentro de 90 minutos cuentan como UNA visita.
  --
  -- 🔴 Existe para quitarle el piso al único truco que de verdad paga: partir un
  -- tanqueo de 40 galones en dos registros duplica las "entregas" sin mover un
  -- galón más. Contando visitas, partir no sirve de nada — y eso vale más que
  -- vigilar, porque no hay nada que vigilar.
  --
  -- Medido el 31-ago-2026: hoy va en 1,01 entregas por visita en los tres. O sea
  -- nadie está partiendo nada. Sirve de LÍNEA BASE: si ese número empieza a
  -- subir después de anunciar el pago por productividad, ahí está la respuesta.
  eventos as (
    select despachado_por, count(*) filter (where nuevo) as n
      from (
        select e.despachado_por,
               (lag(e.cuando) over (partition by e.despachado_por, e.equipo_codigo order by e.cuando) is null
                or e.cuando - lag(e.cuando) over (partition by e.despachado_por, e.equipo_codigo order by e.cuando)
                   > interval '90 minutes') as nuevo
          from entregas e where e.despachado_por is not null
      ) m group by despachado_por
  )
  select jsonb_build_object(
    'desde', p_desde,
    'hasta', p_hasta,

    'despachadores', coalesce((
      select jsonb_agg(x order by (x->>'entregas')::int desc) from (
        select jsonb_build_object(
          'id', e.despachado_por,
          'nombre', coalesce(u.nombre_completo, e.despachado_por),
          'entregas', count(*),
          'dias', count(distinct (e.cuando at time zone 'America/Bogota')::date),
          'galones', round(coalesce(sum(g.gal), 0)::numeric, 2),
          'maquinas', count(distinct e.equipo_codigo) filter (where e.equipo_codigo is not null),
          'operarios', count(distinct e.operario_id) filter (where e.operario_id is not null),
          'conFoto', count(*) filter (where e.con_foto),
          'avaladas', count(*) filter (where e.confirmado_en is not null),
          'conDiferencia', count(*) filter (where e.conforme is false),
          'conHorometro', count(*) filter (where e.horometro is not null and e.horometro > 0),
          -- Visitas: entregas a la misma máquina dentro de 90 min cuentan una.
          'eventos', coalesce(max(ev.n), 0),
          'primera', min(e.cuando),
          'ultima', max(e.cuando)
        ) as x
          from entregas e
          left join galones g on g.solicitud_id = e.id
          left join app_usuarios u on u.id = e.despachado_por
          left join eventos ev on ev.despachado_por = e.despachado_por
         where e.despachado_por is not null
         group by e.despachado_por, u.nombre_completo
      ) t
    ), '[]'::jsonb),

    -- 🔴 JORNADA Y RITMO — la mitad de la historia que el volumen esconde.
    --
    -- Medido en agosto: Genaro entrega 2,5 veces más que Castañeda, pero el
    -- ritmo POR HORA es prácticamente el mismo (1,24 contra 1,22). La diferencia
    -- no es velocidad, es presencia: Genaro trabajó 29 de 31 días con jornadas de
    -- 7,3 h; Castañeda faltó 11 días y sus jornadas son de 4,1 h. De hecho, en
    -- días de carga pareja Castañeda cierra más rápido.
    --
    -- Sin este dato, el dueño pagaría PRESENCIA creyendo que paga PRODUCTIVIDAD,
    -- que son dos decisiones distintas y solo una de ellas fue la que pidió.
    --
    -- `horas` = suma de (última − primera entrega) de cada día. Es una VENTANA de
    -- trabajo, no horas pagadas: nadie marca entrada. Llamarla "hora-hombre"
    -- sería falso, y sobre eso se iba a pagar.
    'jornadas', coalesce((
      -- ⚠️ Los promedios se calculan en una subconsulta aparte: `avg()` dentro de
      -- `jsonb_agg()` es un agregado anidado y Postgres lo rechaza.
      select jsonb_agg(jsonb_build_object(
        'id', z.quien, 'horas', z.horas, 'horasTotal', z.horas_total,
        'primeraHora', z.primera_hora, 'ultimaHora', z.ultima_hora
      ))
        from (
      select d.quien,
             round(avg(d.h)::numeric, 1) as horas,
             round(sum(d.h)::numeric, 1) as horas_total,
             round(avg(d.hini)::numeric, 1) as primera_hora,
             round(avg(d.hfin)::numeric, 1) as ultima_hora
        from (select e.despachado_por quien,
                     extract(epoch from (max(e.cuando) - min(e.cuando))) / 3600 h,
                     extract(hour from min(e.cuando) at time zone 'America/Bogota')
                       + extract(minute from min(e.cuando) at time zone 'America/Bogota') / 60.0 hini,
                     extract(hour from max(e.cuando) at time zone 'America/Bogota')
                       + extract(minute from max(e.cuando) at time zone 'America/Bogota') / 60.0 hfin,
                     count(*) n
                from entregas e where e.despachado_por is not null
               group by e.despachado_por, (e.cuando at time zone 'America/Bogota')::date) d
       where d.n > 1
       group by d.quien
        ) z
    ), '[]'::jsonb),

    -- La serie diaria: el "cuántas entregas por día" que pidió el cliente.
    'porDia', coalesce((
      select jsonb_agg(jsonb_build_object('dia', dia, 'quien', quien, 'entregas', n)
                       order by dia, quien)
        from (select (e.cuando at time zone 'America/Bogota')::date dia,
                     e.despachado_por quien, count(*) n
                from entregas e where e.despachado_por is not null
               group by 1, 2) s
    ), '[]'::jsonb),

    -- A qué hora se entrega: dice si la ruta arranca temprano o se dispersa.
    'porHora', coalesce((
      select jsonb_agg(jsonb_build_object('hora', h, 'entregas', n) order by h)
        from (select extract(hour from e.cuando at time zone 'America/Bogota')::int h,
                     count(*) n from entregas e group by 1) s
    ), '[]'::jsonb),

    -- Qué se entrega, agrupado POR UNIDAD para no mezclar galones con unidades.
    'insumos', coalesce((
      select jsonb_agg(x order by (x->>'entregas')::int desc) from (
        select jsonb_build_object(
          'nombre', i.insumo_nombre,
          'unidad', i.unidad,
          'entregas', count(distinct i.solicitud_id),
          'cantidad', round(sum(coalesce(i.cantidad_despachada, i.cantidad))::numeric, 2)
        ) as x
          from insumos_solicitud_items i
          join entregas e on e.id = i.solicitud_id
         where coalesce(i.cantidad_despachada, i.cantidad) > 0
         group by i.insumo_nombre, i.unidad
      ) t
    ), '[]'::jsonb),

    -- Quién RECIBE. Es el ranking de operarios que sí tiene datos.
    'operarios', coalesce((
      select jsonb_agg(x order by (x->>'entregas')::int desc) from (
        select jsonb_build_object(
          'id', e.operario_id,
          'nombre', coalesce(e.operario_nombre, u.nombre_completo, e.operario_id),
          'entregas', count(*),
          'galones', round(coalesce(sum(g.gal), 0)::numeric, 2),
          'maquinas', count(distinct e.equipo_codigo) filter (where e.equipo_codigo is not null),
          'avaladas', count(*) filter (where e.confirmado_en is not null),
          'ultima', max(e.cuando)
        ) as x
          from entregas e
          left join galones g on g.solicitud_id = e.id
          left join app_usuarios u on u.id = e.operario_id
         where e.operario_id is not null
         group by e.operario_id, e.operario_nombre, u.nombre_completo
      ) t
    ), '[]'::jsonb),

    'maquinas', coalesce((
      select jsonb_agg(x order by (x->>'galones')::numeric desc) from (
        select jsonb_build_object(
          'codigo', e.equipo_codigo,
          'entregas', count(*),
          'galones', round(coalesce(sum(g.gal), 0)::numeric, 2)
        ) as x
          from entregas e left join galones g on g.solicitud_id = e.id
         where e.equipo_codigo is not null
         group by e.equipo_codigo
      ) t
    ), '[]'::jsonb),

    -- Las solicitudes que HACEN los operarios: flujo distinto al de las entregas.
    -- ⚠️ Hoy casi no se usa. El tablero tiene que DECIRLO en vez de mostrar un
    -- panel vacío sin explicación, que se lee como que el sistema está roto.
    'solicitudes', coalesce((
      select jsonb_build_object(
        'total', count(*),
        'pendientes', count(*) filter (where s.estado in ('PENDIENTE', 'PROGRAMADA')),
        'entregadas', count(*) filter (where s.estado = 'ENTREGADA'),
        'rechazadas', count(*) filter (where s.estado = 'RECHAZADA'),
        'operariosQuePidieron', count(distinct s.operario_id),
        'minutosRespuesta', round(avg(extract(epoch from (s.entregado_en - s.created_at)) / 60)
                                  filter (where s.entregado_en is not null))
      ) from insumos_solicitudes s
       where s.origen = 'OPERARIO'
         and s.created_at >= p_desde::timestamptz
         and s.created_at < (p_hasta + 1)::timestamptz
    ), '{}'::jsonb),

    -- Cuántos operarios activos hay, para medir qué tan adoptado está el pedido.
    'operariosActivos', (select count(*) from app_usuarios where rol = 'operador' and activo),

    'totales', (
      select jsonb_build_object(
        'entregas', count(*),
        'galones', round(coalesce(sum(g.gal), 0)::numeric, 2),
        'conFoto', count(*) filter (where e.con_foto),
        'avaladas', count(*) filter (where e.confirmado_en is not null),
        'conDiferencia', count(*) filter (where e.conforme is false),
        'operarios', count(distinct e.operario_id),
        'maquinas', count(distinct e.equipo_codigo),
        'dias', count(distinct (e.cuando at time zone 'America/Bogota')::date)
      ) from entregas e left join galones g on g.solicitud_id = e.id
    )
  ) into v_res;

  return v_res;
end;
$$;

comment on function public.resumen_movimientos_insumos is
  'Resumen agregado de movimientos de insumos para el tablero. Cuenta ENTREGAS (hechos), no filas de kardex.';

grant execute on function public.resumen_movimientos_insumos(date, date) to anon, authenticated;
