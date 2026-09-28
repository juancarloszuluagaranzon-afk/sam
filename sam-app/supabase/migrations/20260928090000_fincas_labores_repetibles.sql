-- ============================================================================
-- 20260928090000 — Labores de VARIAS PASADAS: riego y control de malezas (28-sep-2026)
--
-- Pedido de Iván: en un ciclo la suerte se riega varias veces y el herbicida se
-- aplica más de una vez. Hasta hoy `af__reportar` topaba lo reportado de UNA labor
-- al área de la suerte (SUPERA_AREA) y `af__revisar` la cerraba como TERMINADA al
-- completar el área: el segundo riego no se podía reportar.
--
-- Ahora una labor puede ser `repetible` (se marca en el paquete y cada ciclo la
-- hereda al abrirse):
--   · cada REPORTE sigue sin poder pasar del área de la suerte (una pasada);
--   · el TOTAL no se topa (2, 3… pasadas);
--   · al aceptar NO se cierra: queda EN_CURSO mientras el ciclo esté abierto.
-- Las demás labores quedan exactamente igual.
-- ============================================================================

alter table public.af_paquete add column if not exists repetible boolean not null default false;
alter table public.af_labores add column if not exists repetible boolean not null default false;
comment on column public.af_paquete.repetible is 'Varias pasadas por ciclo (riego, malezas): el total no se topa al área y no se cierra sola.';
comment on column public.af_labores.repetible is 'Heredado del paquete al abrir el ciclo. Ver af_paquete.repetible.';

-- Riego y control de malezas: en el paquete y en los ciclos que ya existen.
select set_config('af.via_funcion', '1', true);
update public.af_paquete set repetible = true where labor in ('RIEGO', 'CONTROL DE MALEZAS') and not repetible;
update public.af_labores set repetible = true where labor in ('RIEGO', 'CONTROL DE MALEZAS') and not repetible;

-- ── Reportar ───────────────────────────────────────────────────────────────
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
  if btrim(coalesce(p_foto, '')) = '' then raise exception 'SIN_FOTO: sin foto no hay reporte' using errcode = 'check_violation'; end if;
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
  values (p_id, p_labor, p_cantidad, p_fecha, p_foto, p_lat, p_lng, p_precision, nullif(btrim(coalesce(p_nota, '')), ''), p_usuario);

  update public.af_labores set estado = 'EN_CURSO', editado_por = p_usuario
   where id = p_labor and estado = 'PROGRAMADA';
  return p_id;
end $$;

-- ── Aceptar o rechazar (nunca el propio) ──────────────────────────────────
create or replace function public.af__revisar(
  p_reporte uuid, p_aceptar boolean, p_motivo text, p_usuario text
) returns text
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_r record;
  v_aceptado numeric;
begin
  perform set_config('af.via_funcion', '1', true);
  if coalesce(public.af_rol(p_usuario), '') not in ('owner', 'administracion', 'supervisor') then
    raise exception 'SIN_PERMISO: este usuario no acepta labores' using errcode = 'insufficient_privilege';
  end if;
  select r.*, l.labor, l.unidad, l.costo_unitario_plan, l.cantidad_plan, c.suerte_id, s.finca_id, s.codigo as suerte
    into v_r
    from public.af_reportes r
    join public.af_labores l on l.id = r.labor_id
    join public.af_ciclos c on c.id = l.ciclo_id
    join public.af_suertes s on s.id = c.suerte_id
   where r.id = p_reporte
   for update of r;
  if v_r.id is null then raise exception 'REPORTE_NO_EXISTE' using errcode = 'no_data_found'; end if;
  if v_r.estado <> 'PENDIENTE' then raise exception 'YA_REVISADO: ese reporte ya está %', lower(v_r.estado) using errcode = 'check_violation'; end if;
  if v_r.reportado_por = p_usuario then
    raise exception 'NO_PROPIO: nadie acepta su propio reporte' using errcode = 'check_violation';
  end if;

  if not p_aceptar then
    if btrim(coalesce(p_motivo, '')) = '' then raise exception 'MOTIVO: para rechazar hay que decir por qué' using errcode = 'check_violation'; end if;
    update public.af_reportes set estado = 'RECHAZADO', revisado_por = p_usuario, revisado_en = now(), motivo_rechazo = btrim(p_motivo)
     where id = p_reporte;
    return 'RECHAZADO';
  end if;

  update public.af_reportes set estado = 'ACEPTADO', revisado_por = p_usuario, revisado_en = now(),
         costo_unitario = v_r.costo_unitario_plan
   where id = p_reporte;

  -- El gasto entra a la cuenta del dueño, con la foto como soporte. Una sola vez.
  if v_r.costo_unitario_plan > 0 then
    insert into public.af_movimientos (finca_id, tipo, fecha, concepto, suerte_id, labor_id, reporte_id,
                                       cantidad, unidad, valor_unitario, valor, soporte_url, registrado_por)
    values (v_r.finca_id, 'GASTO', v_r.fecha, v_r.labor || ' · suerte ' || v_r.suerte, v_r.suerte_id, v_r.labor_id, v_r.id,
            v_r.cantidad, v_r.unidad, v_r.costo_unitario_plan, round(v_r.cantidad * v_r.costo_unitario_plan, 2),
            v_r.foto_url, p_usuario)
    on conflict (reporte_id) do nothing;
  end if;

  -- Una labor de varias pasadas no se cierra sola: sigue EN_CURSO mientras dure el ciclo.
  select coalesce(sum(cantidad), 0) into v_aceptado from public.af_reportes
   where labor_id = v_r.labor_id and estado = 'ACEPTADO';
  update public.af_labores
     set estado = case when not repetible and v_aceptado >= cantidad_plan * 0.98 then 'TERMINADA' else 'EN_CURSO' end,
         editado_por = p_usuario
   where id = v_r.labor_id and estado <> 'ANULADA';
  return 'ACEPTADO';
end $$;

-- ── Abrir ciclo: cada labor hereda `repetible` del paquete ─────────────────
create or replace function public.af__abrir_ciclo(p_suerte uuid, p_fecha_corte date, p_tipo text, p_usuario text)
returns uuid
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_area numeric;
  v_ciclo uuid;
  v_hoy date := (now() at time zone 'America/Bogota')::date;
begin
  if coalesce(public.af_rol(p_usuario), '') not in ('owner', 'administracion') then
    raise exception 'SIN_PERMISO: solo administración abre ciclos' using errcode = 'insufficient_privilege';
  end if;
  perform set_config('af.via_funcion', '1', true);
  if p_fecha_corte > v_hoy then
    raise exception 'FECHA_FUTURA: el corte no puede ser después de hoy' using errcode = 'check_violation';
  end if;
  select area_ha into v_area from public.af_suertes where id = p_suerte and activa;
  if v_area is null then raise exception 'SUERTE_NO_EXISTE' using errcode = 'no_data_found'; end if;

  update public.af_ciclos set estado = 'CERRADO', fecha_cierre = p_fecha_corte, editado_por = p_usuario
   where suerte_id = p_suerte and estado = 'ABIERTO';

  insert into public.af_ciclos (suerte_id, fecha_corte, tipo, editado_por)
  values (p_suerte, p_fecha_corte, coalesce(nullif(p_tipo, ''), 'SOCA'), p_usuario)
  returning id into v_ciclo;

  insert into public.af_labores (ciclo_id, labor, unidad, cantidad_plan, costo_unitario_plan,
                                 ventana_ideal, ventana_normal, orden, repetible, editado_por)
  select v_ciclo, p.labor, p.unidad, round(v_area * p.cantidad_por_ha, 2), p.costo_unitario,
         p.ventana_ideal, p.ventana_normal, p.orden, p.repetible, p_usuario
    from public.af_paquete p
   where p.activa and (p.aplica = 'AMBOS' or p.aplica = coalesce(nullif(p_tipo, ''), 'SOCA'));

  return v_ciclo;
end $$;

-- ── Guardar el paquete: con «varias pasadas» ───────────────────────────────
-- Al EDITAR, si no llega `repetible` (una versión vieja de la app) se conserva el que tenía.
create or replace function public.af_guardar_paquete(p_token text, p_id uuid, p_datos jsonb)
returns uuid
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_usuario text := public.af__usuario(p_token, array['owner', 'administracion']);
  v_id uuid;
begin
  if p_id is null then
    insert into public.af_paquete (labor, unidad, cantidad_por_ha, costo_unitario, ventana_ideal, ventana_normal, aplica, orden, activa, repetible, editado_por)
    values (upper(btrim(p_datos ->> 'labor')), coalesce(p_datos ->> 'unidad', 'ha'), coalesce((p_datos ->> 'cantidad_por_ha')::numeric, 1),
            coalesce((p_datos ->> 'costo_unitario')::numeric, 0), (p_datos ->> 'ventana_ideal')::int, (p_datos ->> 'ventana_normal')::int,
            coalesce(p_datos ->> 'aplica', 'AMBOS'), coalesce((p_datos ->> 'orden')::int, 100), coalesce((p_datos ->> 'activa')::boolean, true),
            coalesce((p_datos ->> 'repetible')::boolean, false), v_usuario)
    returning id into v_id;
    return v_id;
  end if;
  update public.af_paquete set
    labor = upper(btrim(p_datos ->> 'labor')), unidad = coalesce(p_datos ->> 'unidad', 'ha'),
    cantidad_por_ha = coalesce((p_datos ->> 'cantidad_por_ha')::numeric, 1), costo_unitario = coalesce((p_datos ->> 'costo_unitario')::numeric, 0),
    ventana_ideal = (p_datos ->> 'ventana_ideal')::int, ventana_normal = (p_datos ->> 'ventana_normal')::int,
    aplica = coalesce(p_datos ->> 'aplica', 'AMBOS'), orden = coalesce((p_datos ->> 'orden')::int, 100),
    activa = coalesce((p_datos ->> 'activa')::boolean, true),
    repetible = coalesce((p_datos ->> 'repetible')::boolean, repetible), editado_por = v_usuario
  where id = p_id;
  return p_id;
end $$;
