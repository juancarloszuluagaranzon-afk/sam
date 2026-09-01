-- Correcciones al resumen de movimientos (1-sep-2026).
--
-- Salieron de una revisión adversarial de la primera versión. Son errores reales,
-- no pulido: cada uno producía un número que alguien iba a usar para pagar.
--
--   P1 · Los usuarios de PRUEBA entraban en los totales y, peor, en el
--        denominador de adopción: con ellos, "cuántos operarios piden material"
--        se mide contra gente que no existe.
--   P2 · Los galones se contaban contra la unidad del CATÁLOGO VIVO mientras la
--        tabla de insumos agrupaba por la unidad GUARDADA en el ítem. Si alguien
--        edita la unidad de un insumo, la misma pantalla muestra dos totales
--        distintos del mismo combustible. Ahora las dos leen lo guardado.
--   P3 · 🔴 El ritmo estaba inflado. `jornadas` mide solo los días con más de una
--        entrega (un día de una sola entrega no tiene ventana medible), pero el
--        ritmo dividía TODAS las entregas del periodo entre esas horas
--        recortadas. Quien tiene muchos días de una sola entrega salía más rápido
--        de lo que es. Ahora el numerador cuenta solo las entregas de los días
--        que sí entran en el denominador.
--   P4 · El orden por volumen es un podio implícito, y el ojo lo lee antes que
--        cualquier advertencia. Van en orden alfabético.
--   P7 · La MEDIANA del aval, no el promedio: unos pocos avales viejos arrastran
--        el promedio a 32 horas cuando la mitad se avala en menos de 3.
--   P9 · El rol de cada despachador viaja en el dato, para que separar al
--        analista no dependa de que alguien recuerde su cédula.
--   P8 · Sello de corte con fecha y hora: regla del proyecto para todo lo que se
--        entrega.
--   P6 · Dos listas accionables: entregas sin foto y avales vencidos. Un tablero
--        que solo describe se mira una vez; uno que dice qué hacer se abre todos
--        los días.

-- P1 · Marcar los usuarios de prueba en vez de filtrarlos por el nombre en cada
-- consulta: el nombre cambia y el filtro se queda mintiendo.
alter table public.app_usuarios add column if not exists es_prueba boolean not null default false;
update public.app_usuarios
   set es_prueba = true
 where upper(nombre_completo) like '%PRUEBA%' and not es_prueba;

comment on column public.app_usuarios.es_prueba is
  'Usuario de banco de pruebas: se excluye de totales y de denominadores de adopcion.';

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
           -- ⚠️ El `coalesce` no sobra: `array_length` de un arreglo VACIO devuelve
           -- NULL, no 0, y entonces `con_foto` quedaba en NULL en vez de falso.
           -- `not NULL` no es verdadero, asi que la lista de "entregas sin foto"
           -- salia VACIA teniendo 59 — el hueco justo que la lista existe para
           -- mostrar.
           coalesce(s.evidencia_urls is not null and array_length(s.evidencia_urls, 1) > 0, false) as con_foto
      from insumos_solicitudes s
     where s.estado = 'ENTREGADA'
       and coalesce(s.entregado_en, s.created_at) >= p_desde::timestamptz
       and coalesce(s.entregado_en, s.created_at) < (p_hasta + 1)::timestamptz
       -- P1: fuera el banco de pruebas.
       and not exists (select 1 from app_usuarios up
                        where up.id = s.operario_id and up.es_prueba)
  ),
  -- P2: la unidad GUARDADA en el ítem manda; el catálogo solo respalda si el
  -- ítem viejo no la trae. Así este total y el de la tabla de insumos leen lo
  -- mismo aunque alguien edite el catálogo después.
  galones as (
    select i.solicitud_id, sum(coalesce(i.cantidad_despachada, i.cantidad)) as gal
      from insumos_solicitud_items i
      left join insumos ins on ins.id = i.insumo_id
     where upper(coalesce(nullif(i.unidad, ''), ins.unidad, '')) like 'GAL%'
     group by 1
  ),
  cargues as (
    select c.registrado_por as quien,
           round(sum(c.galones) filter (where c.galones <= 500)::numeric, 2) as gal,
           count(*) filter (where c.galones > 500) as sospechosas
      from combustible_externo c
     where c.destino in ('CARRO', 'PIMPINAS')
       and c.estado <> 'RECHAZADO'
       and c.created_at >= p_desde::timestamptz
       and c.created_at < (p_hasta + 1)::timestamptz
     group by c.registrado_por
  ),
  eventos as (
    select despachado_por, count(*) filter (where nuevo) as n
      from (
        select e.despachado_por,
               (lag(e.cuando) over (partition by e.despachado_por, e.equipo_codigo order by e.cuando) is null
                or e.cuando - lag(e.cuando) over (partition by e.despachado_por, e.equipo_codigo order by e.cuando)
                   > interval '90 minutes') as nuevo
          from entregas e where e.despachado_por is not null
      ) m group by despachado_por
  ),
  -- P3 · La jornada y SU numerador, juntos.
  --
  -- Un día con una sola entrega no tiene ventana medible (primera = última), así
  -- que queda fuera del denominador. Antes el numerador seguía contando esas
  -- entregas y el ritmo salía inflado. Aquí salen los dos del mismo conjunto de
  -- días, que es la única forma de que la división signifique algo.
  jornadas_raw as (
    select e.despachado_por quien,
           (e.cuando at time zone 'America/Bogota')::date dia,
           extract(epoch from (max(e.cuando) - min(e.cuando))) / 3600 h,
           extract(hour from min(e.cuando) at time zone 'America/Bogota')
             + extract(minute from min(e.cuando) at time zone 'America/Bogota') / 60.0 hini,
           extract(hour from max(e.cuando) at time zone 'America/Bogota')
             + extract(minute from max(e.cuando) at time zone 'America/Bogota') / 60.0 hfin,
           count(*) n
      from entregas e where e.despachado_por is not null
     group by 1, 2
  ),
  jornadas as (
    select quien,
           round(avg(h)::numeric, 1) as horas,
           round(sum(h)::numeric, 1) as horas_total,
           sum(n) as entregas_en_dias,
           count(*) as dias_medibles,
           round(avg(hini)::numeric, 1) as primera_hora,
           round(avg(hfin)::numeric, 1) as ultima_hora
      from jornadas_raw where n > 1 group by quien
  )
  select jsonb_build_object(
    'desde', p_desde,
    'hasta', p_hasta,
    -- P8 · Cuándo se sacó el corte. Todo entregable lleva fecha y hora.
    'corteEn', now(),

    -- P4 · Orden ALFABÉTICO. Ordenar por volumen es un podio implícito y el ojo
    -- lo lee antes que cualquier advertencia sobre lo que el volumen esconde.
    'despachadores', coalesce((
      select jsonb_agg(x order by x->>'nombre') from (
        select jsonb_build_object(
          'id', e.despachado_por,
          'nombre', coalesce(u.nombre_completo, e.despachado_por),
          'rol', coalesce(u.rol, ''),
          'entregas', count(*),
          'dias', count(distinct (e.cuando at time zone 'America/Bogota')::date),
          'galones', round(coalesce(sum(g.gal), 0)::numeric, 2),
          'maquinas', count(distinct e.equipo_codigo) filter (where e.equipo_codigo is not null),
          'operarios', count(distinct e.operario_id) filter (where e.operario_id is not null),
          'conFoto', count(*) filter (where e.con_foto),
          'avaladas', count(*) filter (where e.confirmado_en is not null),
          'conDiferencia', count(*) filter (where e.conforme is false),
          'conHorometro', count(*) filter (where e.horometro is not null and e.horometro > 0),
          'eventos', coalesce(max(ev.n), 0),
          'cargado', coalesce(max(cg.gal), 0),
          'carguesSospechosos', coalesce(max(cg.sospechosas), 0),
          -- P7 · Mediana, no promedio: unos pocos avales viejos arrastran el
          -- promedio a 32 horas cuando la mitad se avala en menos de tres.
          'horasAvalMediana', round((percentile_cont(0.5) within group (
              order by extract(epoch from (e.confirmado_en - e.cuando)) / 3600)
              filter (where e.confirmado_en is not null))::numeric, 1),
          'avalVencido', count(*) filter (
              where e.confirmado_en is null and now() - e.cuando > interval '72 hours'),
          'primera', min(e.cuando),
          'ultima', max(e.cuando)
        ) as x
          from entregas e
          left join galones g on g.solicitud_id = e.id
          left join app_usuarios u on u.id = e.despachado_por
          left join eventos ev on ev.despachado_por = e.despachado_por
          left join cargues cg on cg.quien = e.despachado_por
         where e.despachado_por is not null
         group by e.despachado_por, u.nombre_completo, u.rol
      ) t
    ), '[]'::jsonb),

    'jornadas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', j.quien, 'horas', j.horas, 'horasTotal', j.horas_total,
        'entregasEnDias', j.entregas_en_dias, 'diasMedibles', j.dias_medibles,
        'primeraHora', j.primera_hora, 'ultimaHora', j.ultima_hora
      )) from jornadas j
    ), '[]'::jsonb),

    'porDia', coalesce((
      select jsonb_agg(jsonb_build_object('dia', dia, 'quien', quien, 'entregas', n)
                       order by dia, quien)
        from (select (e.cuando at time zone 'America/Bogota')::date dia,
                     e.despachado_por quien, count(*) n
                from entregas e where e.despachado_por is not null
               group by 1, 2) s
    ), '[]'::jsonb),

    'porHora', coalesce((
      select jsonb_agg(jsonb_build_object('hora', h, 'entregas', n) order by h)
        from (select extract(hour from e.cuando at time zone 'America/Bogota')::int h,
                     count(*) n from entregas e group by 1) s
    ), '[]'::jsonb),

    'insumos', coalesce((
      select jsonb_agg(x order by (x->>'entregas')::int desc) from (
        select jsonb_build_object(
          'nombre', i.insumo_nombre,
          'unidad', coalesce(nullif(i.unidad, ''), ins.unidad, ''),
          'entregas', count(distinct i.solicitud_id),
          'cantidad', round(sum(coalesce(i.cantidad_despachada, i.cantidad))::numeric, 2)
        ) as x
          from insumos_solicitud_items i
          join entregas e on e.id = i.solicitud_id
          left join insumos ins on ins.id = i.insumo_id
         where coalesce(i.cantidad_despachada, i.cantidad) > 0
         group by i.insumo_nombre, coalesce(nullif(i.unidad, ''), ins.unidad, '')
      ) t
    ), '[]'::jsonb),

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

    -- P6 · Entregas sin evidencia: la lista que convierte el tablero en tarea.
    'sinFoto', coalesce((
      select jsonb_agg(x order by x->>'cuando' desc) from (
        select jsonb_build_object('id', e.id, 'quien', e.despachado_por,
                                  'equipo', e.equipo_codigo, 'cuando', e.cuando) x
          from entregas e where not e.con_foto
         order by e.cuando desc limit 50
      ) t
    ), '[]'::jsonb),

    -- P6 · Avales vencidos: el operario todavía no ha confirmado que recibió, y
    -- ya pasaron tres días. Es el control que sostiene todo lo demás.
    'avalVencido', coalesce((
      select jsonb_agg(x order by x->>'cuando') from (
        select jsonb_build_object('id', e.id, 'quien', e.despachado_por,
                                  'operario', coalesce(e.operario_nombre, e.operario_id),
                                  'equipo', e.equipo_codigo, 'cuando', e.cuando,
                                  'horas', round(extract(epoch from (now() - e.cuando)) / 3600)) x
          from entregas e
         where e.confirmado_en is null and now() - e.cuando > interval '72 hours'
         order by e.cuando limit 50
      ) t
    ), '[]'::jsonb),

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
         and not exists (select 1 from app_usuarios up
                          where up.id = s.operario_id and up.es_prueba)
    ), '{}'::jsonb),

    -- P1 · El denominador de adopción, sin los usuarios de prueba.
    'operariosActivos', (select count(*) from app_usuarios
                          where rol = 'operador' and activo and not es_prueba),

    'totales', (
      select jsonb_build_object(
        'entregas', count(*),
        'galones', round(coalesce(sum(g.gal), 0)::numeric, 2),
        'conFoto', count(*) filter (where e.con_foto),
        'avaladas', count(*) filter (where e.confirmado_en is not null),
        'conDiferencia', count(*) filter (where e.conforme is false),
        'operarios', count(distinct e.operario_id),
        'maquinas', count(distinct e.equipo_codigo),
        'dias', count(distinct (e.cuando at time zone 'America/Bogota')::date),
        'horasAvalMediana', round((percentile_cont(0.5) within group (
            order by extract(epoch from (e.confirmado_en - e.cuando)) / 3600)
            filter (where e.confirmado_en is not null))::numeric, 1)
      ) from entregas e left join galones g on g.solicitud_id = e.id
    )
  ) into v_res;

  return v_res;
end;
$$;

comment on function public.resumen_movimientos_insumos is
  'Resumen agregado de movimientos de insumos. Cuenta ENTREGAS (hechos), no filas de kardex. v2: sin usuarios de prueba, ritmo con denominador coherente, orden alfabetico, mediana del aval y listas accionables.';

grant execute on function public.resumen_movimientos_insumos(date, date) to anon, authenticated;
