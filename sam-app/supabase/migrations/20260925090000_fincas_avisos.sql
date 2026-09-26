-- ============================================================================
-- 20260925090000 — AVISOS al celular del dueño de la tierra (25-sep-2026)
--
-- Pedido del cliente: «¿el dueño vería cuando se produzca una actualización a la
-- información?» → «hazlo todo». Hasta aquí el dueño veía lo último solo al abrir
-- la app; ahora le llega una notificación al celular cuando:
--   · se ACEPTA un reporte de campo de su finca (lo verificado, no lo pendiente), o
--   · la maquinaria de ASM TERMINA (o avanza) una labor en su hacienda.
--
-- Cómo viaja: trigger → `af_avisar` → pg_net (asíncrono) → función del servidor
-- `avisos-finca` (edge runtime, Web Push con VAPID) → el celular. 🔴 Un aviso
-- NUNCA puede tumbar el registro de una labor: todo va envuelto en excepciones y
-- pg_net no espera respuesta.
--
-- Las llaves VAPID y el secreto NO van en este archivo (quedarían en el repo): se
-- cargan aparte en `af_config` clave 'avisos' = {publica, privada, contacto, secreto}.
-- ============================================================================

create table if not exists public.af_suscripciones (
  id           uuid primary key default gen_random_uuid(),
  finca_id     uuid not null references public.af_fincas(id),
  acceso_id    uuid references public.af_accesos(id),
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  agente       text,
  activa       boolean not null default true,
  creada_en    timestamptz not null default now(),
  ultimo_envio timestamptz,
  fallos       int not null default 0
);
create index if not exists af_suscripciones_finca on public.af_suscripciones (finca_id) where activa;
revoke all on public.af_suscripciones from anon, authenticated;
alter table public.af_suscripciones enable row level security;

-- La llave PÚBLICA (la necesita el celular para suscribirse). Nada más sale de aquí.
create or replace function public.af_clave_avisos() returns text
language sql stable security definer set search_path = public, pg_catalog as $$
  select valor ->> 'publica' from public.af_config where clave = 'avisos'
$$;

-- El dueño activa los avisos en SU celular (la finca sale de la llave del enlace).
create or replace function public.af_suscribir(p_token text, p_sub jsonb, p_agente text) returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
declare q record;
begin
  select * into q from public.af_quien(p_token);
  if q.rol is null then
    raise exception 'SIN_SESION: la llave no es válida, venció o fue cancelada' using errcode = 'invalid_authorization_specification';
  end if;
  if q.rol <> 'dueno' then
    raise exception 'SIN_PERMISO: por ahora los avisos son para el dueño de la finca' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(p_sub ->> 'endpoint', '') = '' or coalesce(p_sub #>> '{keys,p256dh}', '') = '' or coalesce(p_sub #>> '{keys,auth}', '') = '' then
    raise exception 'SUSCRIPCION_INVALIDA: el celular no entregó la suscripción completa' using errcode = 'check_violation';
  end if;
  insert into public.af_suscripciones (finca_id, acceso_id, endpoint, p256dh, auth, agente)
  values (q.finca, q.acceso, p_sub ->> 'endpoint', p_sub #>> '{keys,p256dh}', p_sub #>> '{keys,auth}', left(p_agente, 300))
  on conflict (endpoint) do update set
    finca_id = excluded.finca_id, acceso_id = excluded.acceso_id, p256dh = excluded.p256dh, auth = excluded.auth,
    agente = excluded.agente, activa = true, fallos = 0;
end $$;

create or replace function public.af_desuscribir(p_token text, p_endpoint text) returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
declare q record;
begin
  select * into q from public.af_quien(p_token);
  if q.rol is null then return; end if;
  update public.af_suscripciones set activa = false where endpoint = p_endpoint and (q.rol <> 'dueno' or finca_id = q.finca);
end $$;

-- El envío. `p_endpoint` = solo a ese celular (el botón «Probar aviso»).
create or replace function public.af_avisar(p_finca uuid, p_titulo text, p_cuerpo text, p_tag text, p_endpoint text default null)
returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_cfg jsonb;
begin
  if not exists (select 1 from public.af_suscripciones
                  where finca_id = p_finca and activa and (p_endpoint is null or endpoint = p_endpoint)) then
    return;
  end if;
  select valor into v_cfg from public.af_config where clave = 'avisos';
  if v_cfg is null or coalesce(v_cfg ->> 'secreto', '') = '' then return; end if;
  perform net.http_post(
    url := 'http://functions:9000/avisos-finca',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-aviso-secreto', v_cfg ->> 'secreto'),
    body := jsonb_build_object('finca_id', p_finca, 'titulo', p_titulo, 'cuerpo', p_cuerpo, 'tag', p_tag, 'endpoint', p_endpoint),
    timeout_milliseconds := 15000
  );
exception when others then
  raise warning 'af_avisar no pudo encolar el aviso: %', sqlerrm;
end $$;

-- «Probar aviso»: el dueño se manda uno a su propio celular.
create or replace function public.af_probar_aviso(p_token text, p_endpoint text) returns boolean
language plpgsql security definer set search_path = public, pg_catalog as $$
declare q record; v_nombre text;
begin
  select * into q from public.af_quien(p_token);
  if q.rol is distinct from 'dueno' then return false; end if;
  select nombre into v_nombre from public.af_fincas where id = q.finca;
  if not exists (select 1 from public.af_suscripciones where endpoint = p_endpoint and finca_id = q.finca and activa) then
    return false;
  end if;
  perform public.af_avisar(q.finca, v_nombre, 'Aviso de prueba: así le va a llegar cada labor terminada en su finca.', 'prueba-' || q.finca, p_endpoint);
  return true;
end $$;

-- Cantidades como se leen en Colombia: 9,17 (no 9.17).
create or replace function public.af_num(n numeric) returns text
language sql immutable set search_path = public, pg_catalog as $$
  select replace(trim(to_char(round(coalesce(n, 0), 2), 'FM999999990.99')), '.', ',')
$$;
-- to_char deja «5.» cuando no hay decimales: se limpia.
create or replace function public.af_cant(n numeric) returns text
language sql immutable set search_path = public, pg_catalog as $$
  select regexp_replace(public.af_num(n), ',$', '')
$$;

-- El nombre de la labor como se lee: «FERTILIZACION» → «Fertilización».
create or replace function public.af_nombre_labor(n text) returns text
language sql immutable set search_path = public, pg_catalog as $$
  select replace(replace(replace(initcap(lower(coalesce(n, ''))), 'Fertilizacion', 'Fertilización'),
         'Aplicacion', 'Aplicación'), 'Fumigacion', 'Fumigación')
$$;

-- ── Trigger: reporte de campo ACEPTADO ────────────────────────────────────
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
        format('%s · suerte %s · %s %s — con foto y ubicación', public.af_nombre_labor(r.labor), ltrim(r.codigo, '0'), public.af_cant(NEW.cantidad), r.unidad),
        'finca-' || r.finca);
    end if;
  end if;
  return NEW;
exception when others then
  return NEW;
end $$;
drop trigger if exists trg_af_aviso_reporte on public.af_reportes;
create trigger trg_af_aviso_reporte after update of estado on public.af_reportes
  for each row execute function public.af_aviso_reporte();

-- ── Trigger: labor de MAQUINARIA terminada o con avance ──────────────────
create or replace function public.af_aviso_maquinaria() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
declare f record; v_area numeric; v_que text;
begin
  if NEW.estado not in ('COMPLETADA', 'PARCIAL') then return NEW; end if;
  if TG_OP = 'UPDATE' and OLD.estado is not distinct from NEW.estado then return NEW; end if;
  v_area := coalesce(nullif(NEW.area_realizada, 0), NEW.area_asignada);
  v_que := case when NEW.estado = 'COMPLETADA' then 'terminada' else 'avance' end;
  for f in select id, nombre from public.af_fincas
            where activa and hacienda_codigo = NEW.codigo_hacienda::text
              and (ingenio_id is null or ingenio_id = NEW.ingenio_id) loop
    perform public.af_avisar(f.id, f.nombre,
      format('%s %s · suerte %s · %s ha', public.af_nombre_labor(NEW.labor_nombre), v_que, ltrim(coalesce(NEW.numero_suerte, ''), '0'), public.af_cant(v_area)),
      'finca-' || f.id);
  end loop;
  return NEW;
exception when others then
  return NEW;
end $$;
drop trigger if exists trg_af_aviso_maquinaria on public.asignaciones;
create trigger trg_af_aviso_maquinaria after insert or update of estado on public.asignaciones
  for each row execute function public.af_aviso_maquinaria();

-- Permisos: la app solo ve lo del dueño; el envío y los triggers son internos.
revoke execute on function public.af_avisar(uuid, text, text, text, text), public.af_aviso_reporte(),
  public.af_aviso_maquinaria() from public, anon, authenticated;
revoke execute on function public.af_clave_avisos(), public.af_suscribir(text, jsonb, text),
  public.af_desuscribir(text, text), public.af_probar_aviso(text, text) from public;
grant execute on function public.af_clave_avisos(), public.af_suscribir(text, jsonb, text),
  public.af_desuscribir(text, text), public.af_probar_aviso(text, text) to anon, authenticated;

-- La función del servidor entra como `postgres` (SUPABASE_DB_URL): lee la
-- configuración y las suscripciones, y anota envíos y fallas.
grant select on public.af_config to postgres;
grant select, update on public.af_suscripciones to postgres;

notify pgrst, 'reload schema';
