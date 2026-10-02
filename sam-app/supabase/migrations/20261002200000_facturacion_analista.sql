-- ============================================================================
-- 20261002200000 — Facturación y Cartera también para el ANALISTA (2-oct-2026)
--
-- Pedido de Iván: «pon estos dos dashboards al rol de Diego Urdinola» (U051,
-- analista_insumos). Las pantallas van en su vista (AnalistaView) y aquí se le
-- permite vincular / quitar soportes y facturas (antes: solo owner/administración).
-- Mismo cuerpo que en 20261002150000, solo cambia la lista de roles.
-- ============================================================================

create or replace function public.fact_vincular(p_documento uuid, p_ids uuid[], p_usuario text, p_reemplazar boolean default false)
returns integer
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_doc public.fact_documentos;
  v_rol text;
  v_otras int;
  v_n int;
begin
  select rol::text into v_rol from public.app_usuarios where id = p_usuario and activo;
  if coalesce(v_rol, '') not in ('owner', 'administracion', 'analista_insumos') then
    raise exception 'SIN_PERMISO: solo administración o el analista vinculan soportes y facturas' using errcode = 'insufficient_privilege';
  end if;
  select * into v_doc from public.fact_documentos where id = p_documento;
  if v_doc.id is null then raise exception 'DOCUMENTO_NO_EXISTE' using errcode = 'no_data_found'; end if;
  if v_doc.anulado then raise exception 'DOCUMENTO_ANULADO: % % está anulado', lower(v_doc.tipo), v_doc.numero using errcode = 'check_violation'; end if;
  if coalesce(array_length(p_ids, 1), 0) = 0 then return 0; end if;

  if exists (select 1 from public.asignaciones where id = any (p_ids) and estado not in ('COMPLETADA', 'PARCIAL')) then
    raise exception 'NO_REALIZADA: solo se vinculan labores realizadas (completadas o parciales)' using errcode = 'check_violation';
  end if;

  if v_doc.tipo = 'SOPORTE' then
    select count(*) into v_otras from public.asignaciones
     where id = any (p_ids) and soporte_id is not null and soporte_id <> p_documento;
  else
    select count(*) into v_otras from public.asignaciones
     where id = any (p_ids) and factura_id is not null and factura_id <> p_documento;
  end if;
  if v_otras > 0 and not p_reemplazar then
    raise exception 'YA_VINCULADAS: % línea(s) ya tienen %', v_otras,
      case v_doc.tipo when 'FACTURA' then 'otra factura' else 'otro soporte' end using errcode = 'check_violation';
  end if;

  if v_doc.tipo = 'SOPORTE' then
    update public.asignaciones set soporte_id = p_documento, editado_por = p_usuario where id = any (p_ids);
  else
    update public.asignaciones set factura_id = p_documento, factura_numero = v_doc.numero, editado_por = p_usuario
     where id = any (p_ids);
  end if;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create or replace function public.fact_desvincular(p_tipo text, p_ids uuid[], p_usuario text)
returns integer
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_rol text; v_n int;
begin
  select rol::text into v_rol from public.app_usuarios where id = p_usuario and activo;
  if coalesce(v_rol, '') not in ('owner', 'administracion', 'analista_insumos') then
    raise exception 'SIN_PERMISO: solo administración o el analista quitan soportes y facturas' using errcode = 'insufficient_privilege';
  end if;
  if p_tipo = 'SOPORTE' then
    update public.asignaciones set soporte_id = null, editado_por = p_usuario where id = any (p_ids) and soporte_id is not null;
  elsif p_tipo = 'FACTURA' then
    update public.asignaciones set factura_id = null, factura_numero = null, editado_por = p_usuario
     where id = any (p_ids) and (factura_id is not null or coalesce(factura_numero, '') <> '');
  else
    raise exception 'TIPO: SOPORTE o FACTURA' using errcode = 'check_violation';
  end if;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

