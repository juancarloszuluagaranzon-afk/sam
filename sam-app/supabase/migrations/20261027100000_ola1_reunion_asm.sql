-- Ola 1 de la reunión con ASM del 26-oct-2026.
--
--  1. Eliminar (anular) un soporte o una factura que quedó sin líneas — el caso de la factura 3242.
--  2. Poder corregir el VALOR de una factura al vincularle más líneas (hoy se quedaba con el de la primera tanda).
--  3. «El tanque no quedó lleno» en tanqueos y entregas de combustible.
--  4. Orden de las máquinas que mandan los informes.
-- Todo es ADITIVO: columnas nulas y funciones nuevas; el cliente viejo no las ve.

-- ── 1. Eliminar un documento ────────────────────────────────────────────────
-- «Eliminar» = ANULAR (`anulado`, quién y por qué): el documento sale de todas las pantallas y deja de ocupar su
-- número (el índice único excluye los anulados), pero queda el rastro. No se borra el archivo del depósito privado
-- (nadie puede borrar ahí desde el celular a propósito). Solo si NO tiene líneas pegadas ni pagos vivos: así no
-- puede dejar huérfana una línea facturada ni un pago.
create or replace function public.fact_documento_anular(p_documento uuid, p_motivo text, p_usuario text, p_token text default null)
returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_doc public.fact_documentos;
  v_rol text;
  v_lineas int;
  v_pagos int;
begin
  p_usuario := public.fact_usuario(p_token, p_usuario);
  select rol::text into v_rol from public.app_usuarios where id = p_usuario and activo;
  if coalesce(v_rol, '') not in ('owner', 'administracion') then
    raise exception 'SIN_PERMISO: solo administración o el dueño eliminan soportes y facturas' using errcode = 'insufficient_privilege';
  end if;
  select * into v_doc from public.fact_documentos where id = p_documento for update;
  if v_doc.id is null then raise exception 'DOCUMENTO_NO_EXISTE' using errcode = 'no_data_found'; end if;
  if v_doc.anulado then return; end if;

  select count(*) into v_lineas from public.asignaciones where soporte_id = p_documento or factura_id = p_documento;
  if v_lineas > 0 then
    raise exception 'TIENE_LINEAS: % línea(s) siguen pegadas a % %. Quítaselas primero.', v_lineas, lower(v_doc.tipo), v_doc.numero
      using errcode = 'check_violation';
  end if;
  if v_doc.tipo = 'FACTURA' then
    select count(*) into v_pagos from public.fact_pagos where factura_id = p_documento and not anulado;
    if v_pagos > 0 then
      raise exception 'TIENE_PAGOS: la factura % tiene % pago(s) registrado(s). Anúlalos primero en Cartera.', v_doc.numero, v_pagos
        using errcode = 'check_violation';
    end if;
  end if;

  update public.fact_documentos
     set anulado = true,
         anulado_por = p_usuario,
         anulado_motivo = coalesce(nullif(btrim(p_motivo), ''), 'Eliminado desde Soportes y facturas')
   where id = p_documento;
end $$;

-- ── 2. Valor de la factura ─────────────────────────────────────────────────
-- Lo calcula el cliente (las tarifas viven en la app): aquí solo se guarda, con el mismo permiso que vincular.
create or replace function public.fact_documento_valor(p_documento uuid, p_valor numeric, p_usuario text, p_token text default null)
returns numeric
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_doc public.fact_documentos;
  v_rol text;
begin
  p_usuario := public.fact_usuario(p_token, p_usuario);
  select rol::text into v_rol from public.app_usuarios where id = p_usuario and activo;
  if coalesce(v_rol, '') not in ('owner', 'administracion', 'analista_insumos') then
    raise exception 'SIN_PERMISO: solo administración o el analista cambian el valor de una factura' using errcode = 'insufficient_privilege';
  end if;
  if p_valor is null or p_valor < 0 then
    raise exception 'VALOR: el valor va en pesos y no puede ser negativo' using errcode = 'check_violation';
  end if;
  select * into v_doc from public.fact_documentos where id = p_documento for update;
  if v_doc.id is null then raise exception 'DOCUMENTO_NO_EXISTE' using errcode = 'no_data_found'; end if;
  if v_doc.anulado then raise exception 'DOCUMENTO_ANULADO: % está anulado', v_doc.numero using errcode = 'check_violation'; end if;
  if v_doc.tipo <> 'FACTURA' then raise exception 'TIPO: solo las facturas tienen valor' using errcode = 'check_violation'; end if;
  update public.fact_documentos set valor = round(p_valor, 2) where id = p_documento;
  return round(p_valor, 2);
end $$;

grant execute on function public.fact_documento_anular(uuid, text, text, text),
                         public.fact_documento_valor(uuid, numeric, text, text) to anon, authenticated;

-- ── 3. El tanque no quedó lleno ────────────────────────────────────────────
-- NULLABLE a propósito (tres estados): true = quedó lleno, false = NO quedó lleno, NULL = no se anotó (todo lo anterior:
-- se trata como lleno, igual que hasta hoy). Un `default false/true` afirmaría algo que no se preguntó.
alter table public.combustible_externo add column if not exists tanque_lleno boolean;
alter table public.insumos_solicitudes add column if not exists tanque_lleno boolean;
comment on column public.combustible_externo.tanque_lleno is 'false = el tanque NO quedó lleno: ese tanqueo no sirve de punto de medición del consumo, sus galones pasan al siguiente tanqueo lleno. NULL = no se anotó.';
comment on column public.insumos_solicitudes.tanque_lleno is 'Igual que combustible_externo.tanque_lleno, para el combustible que se entrega a una máquina desde una bodega.';

-- ── 4. Orden de las máquinas ───────────────────────────────────────────────
-- Posición que decide el usuario (1, 2, 3…). NULL = sin posición: va al final, por código. Una máquina nueva entra
-- sin posición y se sube donde corresponda.
alter table public.equipos add column if not exists orden integer;
comment on column public.equipos.orden is 'Posición de la máquina en los informes (la fija el usuario). NULL = al final, por código.';

-- Guarda toda la lista de una vez (así no queda a medias si se corta la señal): la posición es el lugar en el arreglo.
create or replace function public.equipos_guardar_orden(p_codigos text[], p_usuario text, p_token text default null)
returns integer
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_rol text;
  v_n int;
begin
  p_usuario := public.fact_usuario(p_token, p_usuario);
  select rol::text into v_rol from public.app_usuarios where id = p_usuario and activo;
  if coalesce(v_rol, '') not in ('owner', 'administracion', 'analista_insumos') then
    raise exception 'SIN_PERMISO: solo administración o el analista ordenan las máquinas' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(array_length(p_codigos, 1), 0) = 0 then return 0; end if;
  update public.equipos e set orden = x.pos
    from unnest(p_codigos) with ordinality as x(cod, pos)
   where e.codigo = x.cod;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
grant execute on function public.equipos_guardar_orden(text[], text, text) to anon, authenticated;
