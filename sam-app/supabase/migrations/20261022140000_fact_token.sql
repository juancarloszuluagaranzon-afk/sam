-- ============================================================================
-- 20261022140000 — FASE 2: las funciones financieras usan el token (22-oct-2026)
--
-- Las funciones de facturación/cartera/acuerdos "revisaban rol" con el id que el
-- cliente mandaba (`p_usuario`): cualquiera con la llave pública podía pasar el id
-- de administración y ejecutar sus acciones. Ahora cada una deriva la identidad del
-- TOKEN de sesión (migración 20261022130000) cuando viene.
--
-- COMPATIBLE (no rompe nada): se agrega `p_token text default null` al final de cada
-- función. Si el cliente manda token válido -> se usa ESE usuario (y si el token no
-- vale, se rechaza). Si no manda token (cliente viejo), cae al `p_usuario` de antes,
-- exactamente como hoy. Cuando el cliente nuevo esté arriba y probado, una fase
-- siguiente quitará ese respaldo y el token quedará obligatorio.
-- ============================================================================

-- Identidad real: del token si viene y es válido; si no, el id que manda el cliente.
create or replace function public.fact_usuario(p_token text, p_usuario text)
returns text language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_id text;
begin
  if coalesce(p_token, '') <> '' then
    select usuario_id into v_id from public.app_sesion_usuario(p_token);
    if v_id is null then
      raise exception 'SESION_INVALIDA: tu sesión venció o no es válida; vuelve a entrar' using errcode = 'insufficient_privilege';
    end if;
    return v_id;
  end if;
  return p_usuario;  -- compatibilidad temporal: cliente viejo sin token
end $$;
grant execute on function public.fact_usuario(text, text) to anon, authenticated;

-- ── fact_vincular ───────────────────────────────────────────────────────────
drop function if exists public.fact_vincular(uuid, uuid[], text, boolean);
create or replace function public.fact_vincular(p_documento uuid, p_ids uuid[], p_usuario text, p_reemplazar boolean default false, p_token text default null)
returns integer language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_doc public.fact_documentos;
  v_rol text;
  v_otras int;
  v_n int;
begin
  p_usuario := public.fact_usuario(p_token, p_usuario);
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

-- ── fact_desvincular ─────────────────────────────────────────────────────────
drop function if exists public.fact_desvincular(text, uuid[], text);
create or replace function public.fact_desvincular(p_tipo text, p_ids uuid[], p_usuario text, p_token text default null)
returns integer language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_rol text; v_n int;
begin
  p_usuario := public.fact_usuario(p_token, p_usuario);
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

-- ── fact_acuerdo_guardar ─────────────────────────────────────────────────────
drop function if exists public.fact_acuerdo_guardar(uuid, jsonb, jsonb, text);
create or replace function public.fact_acuerdo_guardar(p_id uuid, p_datos jsonb, p_cuotas jsonb, p_usuario text, p_token text default null)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_id uuid := p_id;
  v_haciendas text[];
  v_c jsonb;
  v_orden integer := 0;
begin
  p_usuario := public.fact_usuario(p_token, p_usuario);
  if not public.fact_puede_facturar(p_usuario) then
    raise exception 'SIN_PERMISO: solo administración registra acuerdos de pago' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(btrim(p_datos->>'colono'), '') = '' then
    raise exception 'COLONO: falta con quién es el acuerdo' using errcode = 'check_violation';
  end if;
  if coalesce(btrim(p_datos->>'negociado_por'), '') = '' then
    raise exception 'NEGOCIO: falta quién negoció el acuerdo' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(p_cuotas) <> 'array' or jsonb_array_length(p_cuotas) = 0 then
    raise exception 'CUOTAS: el plan de pagos necesita al menos una cuota' using errcode = 'check_violation';
  end if;
  if (select count(*) from jsonb_array_elements(p_cuotas) c where coalesce((c->>'anticipo')::boolean, false)) > 1 then
    raise exception 'ANTICIPO: un acuerdo tiene un solo anticipo' using errcode = 'check_violation';
  end if;
  if exists (select 1 from jsonb_array_elements(p_cuotas) c
              where coalesce((c->>'valor')::numeric, 0) <= 0 or (c->>'vence') is null) then
    raise exception 'CUOTAS: cada cuota necesita fecha y un valor mayor que cero' using errcode = 'check_violation';
  end if;

  select coalesce(array_agg(distinct upper(btrim(h))) filter (where btrim(h) <> ''), '{}')
    into v_haciendas
    from jsonb_array_elements_text(coalesce(p_datos->'haciendas', '[]'::jsonb)) h;

  if v_id is null then
    insert into public.fact_acuerdos (colono, telefono, haciendas, fecha, negociado_por, condiciones, creado_por)
    values (btrim(p_datos->>'colono'), nullif(btrim(p_datos->>'telefono'), ''), v_haciendas,
            coalesce((p_datos->>'fecha')::date, (now() at time zone 'America/Bogota')::date),
            btrim(p_datos->>'negociado_por'), nullif(btrim(p_datos->>'condiciones'), ''), p_usuario)
    returning id into v_id;
  else
    update public.fact_acuerdos
       set colono = btrim(p_datos->>'colono'), telefono = nullif(btrim(p_datos->>'telefono'), ''),
           haciendas = v_haciendas, fecha = coalesce((p_datos->>'fecha')::date, fecha),
           negociado_por = btrim(p_datos->>'negociado_por'), condiciones = nullif(btrim(p_datos->>'condiciones'), ''),
           editado_por = p_usuario, updated_at = now()
     where id = v_id and not anulado;
    if not found then raise exception 'ACUERDO_NO_EXISTE: no existe o está anulado' using errcode = 'no_data_found'; end if;
    delete from public.fact_acuerdo_cuotas where acuerdo_id = v_id;
  end if;

  for v_c in
    select c from jsonb_array_elements(p_cuotas) c
     order by coalesce((c->>'anticipo')::boolean, false) desc, (c->>'vence')::date
  loop
    if coalesce((v_c->>'anticipo')::boolean, false) then
      insert into public.fact_acuerdo_cuotas (acuerdo_id, orden, anticipo, vence, valor)
      values (v_id, 0, true, (v_c->>'vence')::date, round((v_c->>'valor')::numeric, 2));
    else
      v_orden := v_orden + 1;
      insert into public.fact_acuerdo_cuotas (acuerdo_id, orden, anticipo, vence, valor)
      values (v_id, v_orden, false, (v_c->>'vence')::date, round((v_c->>'valor')::numeric, 2));
    end if;
  end loop;
  return v_id;
end $$;

-- ── fact_acuerdo_anular ──────────────────────────────────────────────────────
drop function if exists public.fact_acuerdo_anular(uuid, text, text);
create or replace function public.fact_acuerdo_anular(p_id uuid, p_motivo text, p_usuario text, p_token text default null)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  p_usuario := public.fact_usuario(p_token, p_usuario);
  if not public.fact_puede_facturar(p_usuario) then
    raise exception 'SIN_PERMISO: solo administración anula acuerdos de pago' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'MOTIVO: para anular un acuerdo hay que decir por qué' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.fact_pagos where acuerdo_id = p_id and not anulado) then
    raise exception 'CON_PAGOS: el acuerdo tiene pagos; anúlalos primero o cambia el plan' using errcode = 'check_violation';
  end if;
  update public.fact_documentos set acuerdo_id = null where acuerdo_id = p_id;
  update public.fact_acuerdos
     set anulado = true, anulado_motivo = btrim(p_motivo), anulado_por = p_usuario, updated_at = now()
   where id = p_id and not anulado;
  if not found then raise exception 'ACUERDO_NO_EXISTE: no existe o ya está anulado' using errcode = 'no_data_found'; end if;
end $$;

-- ── fact_acuerdo_ligar_factura ───────────────────────────────────────────────
drop function if exists public.fact_acuerdo_ligar_factura(uuid, uuid, text);
create or replace function public.fact_acuerdo_ligar_factura(p_factura uuid, p_acuerdo uuid, p_usuario text, p_token text default null)
returns numeric language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_fact public.fact_documentos;
  v_descontado numeric;
begin
  p_usuario := public.fact_usuario(p_token, p_usuario);
  if not public.fact_puede_facturar(p_usuario) then
    raise exception 'SIN_PERMISO: solo administración liga facturas a acuerdos' using errcode = 'insufficient_privilege';
  end if;
  select * into v_fact from public.fact_documentos where id = p_factura;
  if v_fact.id is null or v_fact.tipo <> 'FACTURA' then
    raise exception 'NO_ES_FACTURA: solo una factura va a un acuerdo' using errcode = 'check_violation';
  end if;
  if v_fact.anulado then raise exception 'DOCUMENTO_ANULADO: la factura % está anulada', v_fact.numero using errcode = 'check_violation'; end if;
  if p_acuerdo is not null and not exists (select 1 from public.fact_acuerdos where id = p_acuerdo and not anulado) then
    raise exception 'ACUERDO_NO_EXISTE: no existe o está anulado' using errcode = 'no_data_found';
  end if;
  update public.fact_documentos set acuerdo_id = p_acuerdo where id = p_factura and acuerdo_id is distinct from p_acuerdo;
  select coalesce(sum(valor), 0) into v_descontado
    from public.fact_pagos where factura_id = p_factura and anticipo and not anulado;
  return v_descontado;
end $$;

grant execute on function
  public.fact_vincular(uuid, uuid[], text, boolean, text),
  public.fact_desvincular(text, uuid[], text, text),
  public.fact_acuerdo_guardar(uuid, jsonb, jsonb, text, text),
  public.fact_acuerdo_anular(uuid, text, text, text),
  public.fact_acuerdo_ligar_factura(uuid, uuid, text, text)
  to anon, authenticated;
