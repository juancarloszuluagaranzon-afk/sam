-- ============================================================================
-- La FOTO del reporte de campo, OPCIONAL «de momento» (17-oct-2026).
--
-- Iván: «de momento quítale la foto obligatoria, después lo volvemos a activar».
-- Va con un interruptor en la base, como el PIN (`af_config.pin_requerido`):
--
--   af_config.foto_requerida = false  → se puede reportar sin foto (hoy)
--   update public.af_config set valor = 'true', editado_en = now()
--    where clave = 'foto_requerida';   → vuelve a exigirse (y en la app:
--                                         `FOTO_OBLIGATORIA = true` en lib/fincas.ts)
--
-- Lo que cambia:
--  1. `af__reportar` exige la foto SOLO si `af_foto_requerida()`; sin foto guarda NULL.
--     Copia completa de la versión de 20260928090000; solo cambian esas dos líneas.
--  2. `af_reportes.foto_url` deja de ser obligatoria en la tabla (la regla queda en
--     la función, que es la que mira el interruptor).
--  3. `af_movimientos`: un GASTO sigue necesitando soporte… salvo el que nace de un
--     reporte ACEPTADO (`reporte_id`): su soporte es el reporte, aceptado por otra
--     persona. Antes la foto era ese soporte y aceptar un reporte con costo y sin
--     foto habría fallado. Los gastos A MANO siguen exigiendo soporte.
--  4. El aviso al dueño dice lo que el reporte trae de verdad: «con foto y
--     ubicación», «con foto», «con ubicación» o nada.
-- ============================================================================

-- ── 0. El interruptor ─────────────────────────────────────────────────────────
insert into public.af_config (clave, valor) values ('foto_requerida', 'false')
  on conflict (clave) do update set valor = excluded.valor, editado_en = now();

create or replace function public.af_foto_requerida() returns boolean
language sql stable security definer set search_path = public, pg_catalog as $$
  select coalesce((select (valor #>> '{}')::boolean from public.af_config where clave = 'foto_requerida'), true)
$$;

-- ── 2. La columna admite vacío ───────────────────────────────────────────────
alter table public.af_reportes alter column foto_url drop not null;
do $$
declare c text;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.af_reportes'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) ilike '%foto_url%'
  loop
    execute format('alter table public.af_reportes drop constraint %I', c);
  end loop;
end $$;

-- ── 3. El gasto de un reporte aceptado no necesita foto ──────────────────────
do $$
declare c text;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.af_movimientos'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) ilike '%soporte_url%'
  loop
    execute format('alter table public.af_movimientos drop constraint %I', c);
  end loop;
end $$;
alter table public.af_movimientos add constraint af_movimientos_gasto_con_soporte
  check (tipo <> 'GASTO' or reporte_id is not null or btrim(coalesce(soporte_url, '')) <> '');

-- ── 1. Reportar ──────────────────────────────────────────────────────────────
create or replace function public.af__reportar(
  p_id uuid, p_labor uuid, p_cantidad numeric, p_fecha date, p_foto text,
  p_lat double precision, p_lng double precision, p_precision numeric,
  p_nota text, p_usuario text
) returns uuid
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_l record;
  v_hoy date := (now() at time zone 'America/Bogota')::date;
  v_ya numeric;
begin
  -- Reintentar el mismo reporte (misma id) no duplica.
  if exists (select 1 from public.af_reportes where id = p_id) then return p_id; end if;
  perform set_config('af.via_funcion', '1', true);

  if coalesce(public.af_rol(p_usuario), '') not in ('owner', 'administracion', 'supervisor') then
    raise exception 'SIN_PERMISO: este usuario no reporta labores de fincas' using errcode = 'insufficient_privilege';
  end if;
  select l.*, c.fecha_corte, c.estado as ciclo_estado, s.area_ha
    into v_l
    from public.af_labores l join public.af_ciclos c on c.id = l.ciclo_id join public.af_suertes s on s.id = c.suerte_id
   where l.id = p_labor;
  if v_l.id is null then raise exception 'LABOR_NO_EXISTE' using errcode = 'no_data_found'; end if;
  if v_l.ciclo_estado <> 'ABIERTO' then raise exception 'CICLO_CERRADO: el ciclo de esa suerte ya se cerró' using errcode = 'check_violation'; end if;
  if v_l.estado in ('ANULADA', 'TERMINADA') then raise exception 'LABOR_CERRADA: esa labor ya está %', lower(v_l.estado) using errcode = 'check_violation'; end if;
  -- 🆕 La foto se exige solo si el interruptor está prendido (17-oct-2026).
  if public.af_foto_requerida() and btrim(coalesce(p_foto, '')) = '' then
    raise exception 'SIN_FOTO: sin foto no hay reporte' using errcode = 'check_violation';
  end if;
  if p_cantidad is null or p_cantidad <= 0 then raise exception 'CANTIDAD: debe ser mayor que cero' using errcode = 'check_violation'; end if;
  if p_fecha > v_hoy then raise exception 'FECHA_FUTURA: no se puede reportar un día que no ha llegado' using errcode = 'check_violation'; end if;
  if p_fecha < v_l.fecha_corte then raise exception 'FECHA_ANTES_DEL_CORTE: la labor no puede ser anterior al corte (%)', v_l.fecha_corte using errcode = 'check_violation'; end if;

  if lower(v_l.unidad) = 'ha' then
    if v_l.repetible then
      -- Varias pasadas: cada reporte cabe en la suerte; el total no se topa.
      if p_cantidad > v_l.area_ha * 1.02 then
        raise exception 'SUPERA_AREA: una pasada no puede pasar de % ha (el área de la suerte)', v_l.area_ha
          using errcode = 'check_violation';
      end if;
    else
      -- En hectáreas, lo reportado (aceptado + por aceptar) no pasa del área de la suerte.
      select coalesce(sum(cantidad), 0) into v_ya from public.af_reportes
       where labor_id = p_labor and estado in ('PENDIENTE', 'ACEPTADO');
      if v_ya + p_cantidad > v_l.area_ha * 1.02 then
        raise exception 'SUPERA_AREA: con este reporte serían % ha en una suerte de % ha', round(v_ya + p_cantidad, 2), v_l.area_ha
          using errcode = 'check_violation';
      end if;
    end if;
  end if;

  insert into public.af_reportes (id, labor_id, cantidad, fecha, foto_url, lat, lng, precision_m, nota, reportado_por)
  values (p_id, p_labor, p_cantidad, p_fecha, nullif(btrim(coalesce(p_foto, '')), ''), p_lat, p_lng, p_precision,
          nullif(btrim(coalesce(p_nota, '')), ''), p_usuario);

  update public.af_labores set estado = 'EN_CURSO', editado_por = p_usuario
   where id = p_labor and estado = 'PROGRAMADA';
  return p_id;
end $$;

-- ── 4. El aviso al dueño dice lo que el reporte trae ─────────────────────────
create or replace function public.af_aviso_reporte() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
declare r record;
begin
  if NEW.estado = 'ACEPTADO' and OLD.estado is distinct from 'ACEPTADO' then
    select f.id as finca, f.nombre, l.labor, l.unidad, s.codigo into r
      from public.af_labores l
      join public.af_ciclos c on c.id = l.ciclo_id
      join public.af_suertes s on s.id = c.suerte_id
      join public.af_fincas f on f.id = s.finca_id
     where l.id = NEW.labor_id;
    if r.finca is not null then
      perform public.af_avisar(r.finca, r.nombre,
        format('%s · suerte %s · %s %s%s', public.af_nombre_labor(r.labor), ltrim(r.codigo, '0'), public.af_cant(NEW.cantidad), r.unidad,
               case when NEW.foto_url is not null and NEW.lat is not null then ' — con foto y ubicación'
                    when NEW.foto_url is not null then ' — con foto'
                    when NEW.lat is not null then ' — con ubicación'
                    else '' end),
        'finca-' || r.finca);
    end if;
  end if;
  return NEW;
exception when others then
  return NEW;
end $$;

-- Comprobación: foto_requerida = false, la columna admite vacío y el aviso es el nuevo.
select public.af_foto_requerida() as foto_requerida,
       (select is_nullable from information_schema.columns
         where table_schema = 'public' and table_name = 'af_reportes' and column_name = 'foto_url') as foto_admite_vacio,
       position('con foto y ubicación' in pg_get_functiondef('public.af_aviso_reporte()'::regprocedure)) > 0 as aviso_nuevo,
       position('af_foto_requerida' in pg_get_functiondef('public.af__reportar(uuid,uuid,numeric,date,text,double precision,double precision,numeric,text,text)'::regprocedure)) > 0 as reportar_nuevo;
