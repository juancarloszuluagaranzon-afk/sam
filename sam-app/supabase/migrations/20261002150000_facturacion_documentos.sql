-- ============================================================================
-- 20261002150000 — Documentos de facturación: SOPORTE del cliente y FACTURA (2-oct-2026)
--
-- Pedido de Iván: partir del REALIZADO completo y, marcando líneas en Facturación,
--   1) vincularles el DOCUMENTO SOPORTE del cliente (orden de servicio, acta,
--      certificación, correo…: el papel con que el ingenio acepta el trabajo), y
--   2) vincularles la FACTURA emitida (número, fecha, razón social, valor y PDF).
-- Cada línea muestra en qué va: sin soporte → con soporte → facturada.
--
-- · Un documento cubre MUCHAS líneas; cada línea tiene a lo sumo UN soporte y UNA
--   factura (`asignaciones.soporte_id`, `asignaciones.factura_id`).
-- · Vincular la factura también llena `factura_numero` (lo usa el KPI «Área
--   facturada» y la pantalla de siempre).
-- · Vincular / desvincular va por FUNCIONES (no updates sueltos): revisan el tipo
--   del documento, el rol y que una línea facturada no cambie de factura sin querer.
-- · Los archivos van al depósito PRIVADO `facturacion` (no al público `avatars`);
--   se abren con enlace firmado que vence.
-- · Solo AGREGA: tablas y columnas nuevas, vacías. La app vieja no las ve.
-- ============================================================================

create table if not exists public.fact_documentos (
  id             uuid primary key default gen_random_uuid(),
  tipo           text not null check (tipo in ('SOPORTE', 'FACTURA')),
  -- SOPORTE: qué papel es (lista TIPO_SOPORTE). FACTURA: null.
  clase          text,
  numero         text not null check (btrim(numero) <> ''),
  fecha          date not null,
  -- FACTURA: AGROMORALES o CEBALLOS Y LOZANO.
  razon_social   text,
  -- A quién: el ingenio / proveedor (texto, como lo escribe la factura).
  cliente        text,
  -- FACTURA: valor total (opcional mientras no haya tarifas en la app).
  valor          numeric(16, 2) check (valor is null or valor >= 0),
  archivo_path   text,
  archivo_nombre text,
  nota           text,
  anulado        boolean not null default false,
  anulado_por    text,
  anulado_motivo text,
  creado_por     text not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
comment on table public.fact_documentos is
  'Soportes del cliente y facturas emitidas, vinculados a las labores realizadas (asignaciones.soporte_id / factura_id).';

-- El mismo número no se repite (por tipo, razón social y cliente) mientras no esté anulado.
create unique index if not exists fact_documentos_numero_uq on public.fact_documentos
  (tipo, upper(coalesce(razon_social, '')), upper(coalesce(cliente, '')), upper(btrim(numero)))
  where not anulado;

alter table public.asignaciones add column if not exists soporte_id uuid references public.fact_documentos(id);
alter table public.asignaciones add column if not exists factura_id uuid references public.fact_documentos(id);
create index if not exists asignaciones_soporte_idx on public.asignaciones (soporte_id) where soporte_id is not null;
create index if not exists asignaciones_factura_idx on public.asignaciones (factura_id) where factura_id is not null;

alter table public.fact_documentos enable row level security;
drop policy if exists fact_documentos_todos on public.fact_documentos;
create policy fact_documentos_todos on public.fact_documentos for all to anon, authenticated using (true) with check (true);
-- 🔴 Una tabla nueva NO hereda los grant (lección de SAM): sin esto, «permission denied».
grant select, insert, update on public.fact_documentos to anon, authenticated;

create or replace function public.fact_documentos_updated() returns trigger
language plpgsql as $$ begin NEW.updated_at := now(); return NEW; end $$;
drop trigger if exists trg_fact_documentos_updated on public.fact_documentos;
create trigger trg_fact_documentos_updated before update on public.fact_documentos
  for each row execute function public.fact_documentos_updated();

-- ── Vincular líneas a un documento ─────────────────────────────────────────
-- p_reemplazar = false: si alguna línea ya tiene OTRO documento de ese tipo, no hace
-- nada y lo dice (para no cambiar una factura sin querer).
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
  if coalesce(v_rol, '') not in ('owner', 'administracion') then
    raise exception 'SIN_PERMISO: solo administración vincula soportes y facturas' using errcode = 'insufficient_privilege';
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
  if coalesce(v_rol, '') not in ('owner', 'administracion') then
    raise exception 'SIN_PERMISO: solo administración quita soportes y facturas' using errcode = 'insufficient_privilege';
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

grant execute on function public.fact_vincular(uuid, uuid[], text, boolean), public.fact_desvincular(text, uuid[], text)
  to anon, authenticated;

-- ── Tipos de soporte (editables en Más → Listas) ───────────────────────────
insert into public.catalogos_valores (tipo, valor, orden, frecuente) values
  ('TIPO_SOPORTE', 'ORDEN DE SERVICIO', 1, true),
  ('TIPO_SOPORTE', 'ACTA DE RECIBO', 2, true),
  ('TIPO_SOPORTE', 'CERTIFICACIÓN', 3, true),
  ('TIPO_SOPORTE', 'CORREO', 4, true)
on conflict (tipo, upper(valor)) do nothing;

-- ── Depósito PRIVADO para los PDF / fotos de soportes y facturas ───────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('facturacion', 'facturacion', false, 15728640,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "facturacion subir" on storage.objects;
create policy "facturacion subir" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'facturacion');
-- Leer hace falta para crear el enlace firmado. No hay update ni delete: un documento no se pisa.
drop policy if exists "facturacion leer" on storage.objects;
create policy "facturacion leer" on storage.objects for select to anon, authenticated
  using (bucket_id = 'facturacion');
