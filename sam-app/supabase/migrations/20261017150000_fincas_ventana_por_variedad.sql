-- ============================================================================
-- Ventanas de oportunidad POR VARIEDAD (17-oct-2026, punto B de la reunión con
-- Cristian del 15-oct).
--
-- Las curvas de extracción de nitrógeno de Cenicaña (procesadas por Iván esta
-- semana) dan una ventana óptima de fertilización distinta por variedad:
--   CC 01-1940 → 20 a 46 días · CC 05-430 → 7 a 26 días · CC 11-595 → 11 a 31 días
-- Hasta hoy el paquete tenía UNA ventana por labor y tipo de ciclo. Ahora una fila
-- del paquete puede llevar `variedad`: al abrir un ciclo, para cada labor se toma
-- la fila de la variedad de la suerte si existe y, si no, la genérica (variedad
-- NULL). `af_suertes.variedad` ya existía (la trae el reporte del ingenio).
--
-- ⚠️ Las tres ventanas se cargan para SOCA (es el contexto de las curvas: resocas
-- de Riopaila). En PLANTILLA sigue la genérica 30/60 hasta que Iván confirme.
-- La «oportunidad» se CALCULA (no se guarda): cambia la calificación, no la plata.
-- ============================================================================

alter table public.af_paquete add column if not exists variedad text;
comment on column public.af_paquete.variedad is
  'NULL = todas las variedades. Con valor, esta fila manda sobre la genérica para las suertes de esa variedad (af_variedad_coincide).';

-- «CC 01-1940», «cc-01 1940» y «1940» son la misma variedad.
create or replace function public.af_norm_variedad(p text) returns text
language sql immutable as $$
  select regexp_replace(upper(coalesce(p, '')), '[^A-Z0-9]', '', 'g')
$$;

-- ¿La fila del paquete le sirve a una suerte de esta variedad? La genérica, siempre;
-- la específica, si una contiene a la otra («1940» ⊂ «CC011940»).
create or replace function public.af_variedad_coincide(p_paquete text, p_suerte text) returns boolean
language sql immutable as $$
  select case
    when p_paquete is null then true
    when length(public.af_norm_variedad(p_suerte)) < 3 then false
    else position(public.af_norm_variedad(p_suerte) in public.af_norm_variedad(p_paquete)) > 0
      or position(public.af_norm_variedad(p_paquete) in public.af_norm_variedad(p_suerte)) > 0
  end
$$;

-- ── Abrir ciclo: por cada labor, la fila de la variedad si la hay; si no, la genérica ──
-- Copia de 20260928090000; solo cambian la variedad de la suerte y el DISTINCT ON.
create or replace function public.af__abrir_ciclo(p_suerte uuid, p_fecha_corte date, p_tipo text, p_usuario text)
returns uuid
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_area numeric;
  v_variedad text;
  v_ciclo uuid;
  v_tipo text := coalesce(nullif(p_tipo, ''), 'SOCA');
  v_hoy date := (now() at time zone 'America/Bogota')::date;
begin
  if coalesce(public.af_rol(p_usuario), '') not in ('owner', 'administracion') then
    raise exception 'SIN_PERMISO: solo administración abre ciclos' using errcode = 'insufficient_privilege';
  end if;
  perform set_config('af.via_funcion', '1', true);
  if p_fecha_corte > v_hoy then
    raise exception 'FECHA_FUTURA: el corte no puede ser después de hoy' using errcode = 'check_violation';
  end if;
  select area_ha, variedad into v_area, v_variedad from public.af_suertes where id = p_suerte and activa;
  if v_area is null then raise exception 'SUERTE_NO_EXISTE' using errcode = 'no_data_found'; end if;

  update public.af_ciclos set estado = 'CERRADO', fecha_cierre = p_fecha_corte, editado_por = p_usuario
   where suerte_id = p_suerte and estado = 'ABIERTO';

  insert into public.af_ciclos (suerte_id, fecha_corte, tipo, editado_por)
  values (p_suerte, p_fecha_corte, v_tipo, p_usuario)
  returning id into v_ciclo;

  insert into public.af_labores (ciclo_id, labor, unidad, cantidad_plan, costo_unitario_plan,
                                 ventana_ideal, ventana_normal, orden, repetible, editado_por)
  select distinct on (p.labor, p.aplica, p.unidad)
         v_ciclo, p.labor, p.unidad, round(v_area * p.cantidad_por_ha, 2), p.costo_unitario,
         p.ventana_ideal, p.ventana_normal, p.orden, p.repetible, p_usuario
    from public.af_paquete p
   where p.activa and (p.aplica = 'AMBOS' or p.aplica = v_tipo)
     and public.af_variedad_coincide(p.variedad, v_variedad)
   -- La específica de la variedad le gana a la genérica.
   order by p.labor, p.aplica, p.unidad, (p.variedad is not null) desc, p.orden;

  return v_ciclo;
end $$;

-- ── Guardar el paquete: con variedad (una app vieja que no la manda conserva la que había) ──
create or replace function public.af_guardar_paquete(p_token text, p_id uuid, p_datos jsonb)
returns uuid
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_usuario text := public.af__usuario(p_token, array['owner', 'administracion']);
  v_id uuid;
begin
  if p_id is null then
    insert into public.af_paquete (labor, unidad, cantidad_por_ha, costo_unitario, ventana_ideal, ventana_normal, aplica, orden, activa, repetible, variedad, editado_por)
    values (upper(btrim(p_datos ->> 'labor')), coalesce(p_datos ->> 'unidad', 'ha'), coalesce((p_datos ->> 'cantidad_por_ha')::numeric, 1),
            coalesce((p_datos ->> 'costo_unitario')::numeric, 0), (p_datos ->> 'ventana_ideal')::int, (p_datos ->> 'ventana_normal')::int,
            coalesce(p_datos ->> 'aplica', 'AMBOS'), coalesce((p_datos ->> 'orden')::int, 100), coalesce((p_datos ->> 'activa')::boolean, true),
            coalesce((p_datos ->> 'repetible')::boolean, false), nullif(btrim(p_datos ->> 'variedad'), ''), v_usuario)
    returning id into v_id;
    return v_id;
  end if;
  update public.af_paquete set
    labor = upper(btrim(p_datos ->> 'labor')), unidad = coalesce(p_datos ->> 'unidad', 'ha'),
    cantidad_por_ha = coalesce((p_datos ->> 'cantidad_por_ha')::numeric, 1), costo_unitario = coalesce((p_datos ->> 'costo_unitario')::numeric, 0),
    ventana_ideal = (p_datos ->> 'ventana_ideal')::int, ventana_normal = (p_datos ->> 'ventana_normal')::int,
    aplica = coalesce(p_datos ->> 'aplica', 'AMBOS'), orden = coalesce((p_datos ->> 'orden')::int, 100),
    activa = coalesce((p_datos ->> 'activa')::boolean, true),
    repetible = coalesce((p_datos ->> 'repetible')::boolean, repetible),
    variedad = case when p_datos ? 'variedad' then nullif(btrim(p_datos ->> 'variedad'), '') else variedad end,
    editado_por = v_usuario
  where id = p_id;
  return p_id;
end $$;

-- ── Las tres variedades de las curvas (copian unidad, cantidad y costo de la genérica de SOCA) ──
select set_config('af.via_funcion', '1', true);

insert into public.af_paquete (labor, unidad, cantidad_por_ha, costo_unitario, ventana_ideal, ventana_normal, aplica, orden, activa, repetible, variedad, editado_por)
select g.labor, g.unidad, g.cantidad_por_ha, g.costo_unitario, v.ideal, v.normal, 'SOCA', g.orden, true, g.repetible, v.variedad, 'CURVAS_CENICANA'
  from (values ('CC 01-1940', 20, 46), ('CC 05-430', 7, 26), ('CC 11-595', 11, 31)) as v(variedad, ideal, normal)
  cross join (select * from public.af_paquete where upper(labor) like 'FERTILIZACI_N' and aplica = 'SOCA' and variedad is null order by orden limit 1) g
 where not exists (
   select 1 from public.af_paquete p
    where upper(p.labor) like 'FERTILIZACI_N' and p.aplica = 'SOCA'
      and public.af_norm_variedad(p.variedad) = public.af_norm_variedad(v.variedad));

-- Los ciclos ABIERTOS cuya suerte tiene una de esas variedades toman su ventana.
update public.af_labores l
   set ventana_ideal = p.ventana_ideal, ventana_normal = p.ventana_normal, editado_por = 'CURVAS_CENICANA'
  from public.af_ciclos c, public.af_suertes s, public.af_paquete p
 where c.id = l.ciclo_id and s.id = c.suerte_id and c.estado = 'ABIERTO'
   and l.estado in ('PROGRAMADA', 'EN_CURSO')
   and p.variedad is not null and p.activa and upper(p.labor) = upper(l.labor)
   and (p.aplica = 'AMBOS' or p.aplica = c.tipo)
   and public.af_variedad_coincide(p.variedad, s.variedad);

select set_config('af.via_funcion', '', true);

-- Comprobación: la fertilización genérica y las tres por variedad; y cuántas suertes
-- activas tienen variedad (si sale 0, las ventanas por variedad no aplican todavía).
select labor, aplica, coalesce(variedad, '(todas)') as variedad, ventana_ideal, ventana_normal, editado_por
  from public.af_paquete where upper(labor) like 'FERTILIZACI_N' order by aplica, variedad nulls first;
select count(*) filter (where variedad is not null) as suertes_con_variedad, count(*) as suertes_activas
  from public.af_suertes where activa;
