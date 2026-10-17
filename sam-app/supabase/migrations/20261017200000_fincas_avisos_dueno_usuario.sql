-- ============================================================================
-- Avisos al celular TAMBIÉN para el dueño que entra con USUARIO (17-oct-2026).
--
-- Hasta hoy la suscripción push estaba amarrada al ENLACE: una fila por celular
-- (`endpoint` único) con su finca y su acceso, y la función del servidor
-- (`avisos-finca`) manda por finca. Para no tocar esa función (ni redesplegarla),
-- el dueño con usuario queda suscrito con UNA FILA POR CADA FINCA SUYA:
--
--   · `af_suscripciones.usuario_id` (nuevo) y la unicidad pasa a (endpoint, finca_id).
--   · `af_suscribir`: rol `dueno` como siempre; rol `dueno_finca` = una fila por
--     finca ligada (y apaga las de fincas que ya no son suyas).
--   · `af_asignar_dueno` copia sus suscripciones activas a la finca nueva;
--     `af_quitar_dueno` las apaga para esa finca; desactivar el usuario (o
--     quitarle el rol) las apaga todas (trigger en app_usuarios).
--   · `af_probar_aviso` y `af_desuscribir` entienden los dos caminos.
--
-- La función del servidor sigue filtrando por `af_suscripcion_vigente(acceso_id)`:
-- con `acceso_id` NULL (usuario) devuelve true, y la vigencia del usuario la
-- cuidan asignar/quitar/desactivar. El enlace personal no cambia en nada.
-- ============================================================================

alter table public.af_suscripciones add column if not exists usuario_id text references public.app_usuarios(id);
comment on column public.af_suscripciones.usuario_id is
  'Dueño con USUARIO (rol dueno_finca): una fila por cada finca suya. NULL = suscripción de un enlace (acceso_id).';

-- Unicidad: un celular puede estar suscrito a varias fincas (una fila por finca).
do $$
declare c text;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.af_suscripciones'::regclass and contype = 'u'
  loop
    execute format('alter table public.af_suscripciones drop constraint %I', c);
  end loop;
end $$;
alter table public.af_suscripciones add constraint af_suscripciones_endpoint_finca_key unique (endpoint, finca_id);

-- ── Suscribir ────────────────────────────────────────────────────────────────
create or replace function public.af_suscribir(p_token text, p_sub jsonb, p_agente text) returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
declare q record; v_fincas uuid[]; f uuid;
begin
  select * into q from public.af_quien(p_token);
  if q.rol is null then
    raise exception 'SIN_SESION: la llave no es válida, venció o fue cancelada' using errcode = 'invalid_authorization_specification';
  end if;
  if coalesce(p_sub ->> 'endpoint', '') = '' or coalesce(p_sub #>> '{keys,p256dh}', '') = '' or coalesce(p_sub #>> '{keys,auth}', '') = '' then
    raise exception 'SUSCRIPCION_INVALIDA: el celular no entregó la suscripción completa' using errcode = 'check_violation';
  end if;
  if q.rol = 'dueno' then
    insert into public.af_suscripciones (finca_id, acceso_id, usuario_id, endpoint, p256dh, auth, agente)
    values (q.finca, q.acceso, null, p_sub ->> 'endpoint', p_sub #>> '{keys,p256dh}', p_sub #>> '{keys,auth}', left(p_agente, 300))
    on conflict (endpoint, finca_id) do update set
      acceso_id = excluded.acceso_id, usuario_id = null, p256dh = excluded.p256dh, auth = excluded.auth,
      agente = excluded.agente, activa = true, fallos = 0;
  elsif q.rol = 'dueno_finca' then
    select coalesce(array_agg(fd.finca_id), '{}') into v_fincas
      from public.af_finca_duenos fd join public.af_fincas fi on fi.id = fd.finca_id and fi.activa
     where fd.usuario_id = q.usuario;
    if coalesce(array_length(v_fincas, 1), 0) = 0 then
      raise exception 'SIN_FINCAS: su usuario todavía no tiene fincas ligadas; pídalo a AgroServicios Morales' using errcode = 'check_violation';
    end if;
    foreach f in array v_fincas loop
      insert into public.af_suscripciones (finca_id, acceso_id, usuario_id, endpoint, p256dh, auth, agente)
      values (f, null, q.usuario, p_sub ->> 'endpoint', p_sub #>> '{keys,p256dh}', p_sub #>> '{keys,auth}', left(p_agente, 300))
      on conflict (endpoint, finca_id) do update set
        acceso_id = null, usuario_id = excluded.usuario_id, p256dh = excluded.p256dh, auth = excluded.auth,
        agente = excluded.agente, activa = true, fallos = 0;
    end loop;
    -- Fincas que ya no son suyas: ese celular deja de recibir las de ellas.
    update public.af_suscripciones set activa = false
     where endpoint = p_sub ->> 'endpoint' and usuario_id = q.usuario and not (finca_id = any (v_fincas));
  else
    raise exception 'SIN_PERMISO: los avisos son para el dueño de la finca' using errcode = 'insufficient_privilege';
  end if;
end $$;

create or replace function public.af_desuscribir(p_token text, p_endpoint text) returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
declare q record;
begin
  select * into q from public.af_quien(p_token);
  if q.rol is null then return; end if;
  update public.af_suscripciones set activa = false
   where endpoint = p_endpoint
     and (q.rol not in ('dueno', 'dueno_finca')
          or (q.rol = 'dueno' and finca_id = q.finca)
          or (q.rol = 'dueno_finca' and usuario_id = q.usuario));
end $$;

-- «Probar aviso»: con enlace, a su finca; con usuario, a la primera de sus fincas suscritas.
create or replace function public.af_probar_aviso(p_token text, p_endpoint text) returns boolean
language plpgsql security definer set search_path = public, pg_catalog as $$
declare q record; v_finca uuid; v_nombre text;
begin
  select * into q from public.af_quien(p_token);
  if q.rol = 'dueno' then
    select nombre into v_nombre from public.af_fincas where id = q.finca;
    if not exists (select 1 from public.af_suscripciones where endpoint = p_endpoint and finca_id = q.finca and activa) then
      return false;
    end if;
    perform public.af_avisar(q.finca, v_nombre, 'Aviso de prueba: así le va a llegar cada labor terminada en su finca.', 'prueba-' || q.finca, p_endpoint);
    return true;
  elsif q.rol = 'dueno_finca' then
    select s.finca_id, f.nombre into v_finca, v_nombre
      from public.af_suscripciones s join public.af_fincas f on f.id = s.finca_id
     where s.endpoint = p_endpoint and s.usuario_id = q.usuario and s.activa
     order by f.nombre limit 1;
    if v_finca is null then return false; end if;
    perform public.af_avisar(v_finca, v_nombre, 'Aviso de prueba: así le va a llegar cada labor terminada en sus fincas.', 'prueba-' || v_finca, p_endpoint);
    return true;
  end if;
  return false;
end $$;

-- ── Ligar y quitar dueños: las suscripciones siguen a las fincas ─────────────
create or replace function public.af_asignar_dueno(p_token text, p_finca uuid, p_usuario text) returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_quien text := public.af__usuario(p_token, array['owner', 'administracion']);
begin
  if not exists (select 1 from public.af_fincas where id = p_finca and activa) then
    raise exception 'FINCA_NO_EXISTE' using errcode = 'no_data_found';
  end if;
  if not exists (select 1 from public.app_usuarios where id = p_usuario and activo and rol = 'dueno_finca') then
    raise exception 'USUARIO_NO_ES_DUENO: el usuario debe existir, estar activo y tener el rol «Dueño de finca»' using errcode = 'check_violation';
  end if;
  insert into public.af_finca_duenos (finca_id, usuario_id, creado_por) values (p_finca, p_usuario, v_quien)
  on conflict do nothing;
  -- Si ya tenía avisos activos en algún celular, la finca nueva entra sin que él haga nada.
  insert into public.af_suscripciones (finca_id, usuario_id, endpoint, p256dh, auth, agente)
  select distinct on (s.endpoint) p_finca, s.usuario_id, s.endpoint, s.p256dh, s.auth, s.agente
    from public.af_suscripciones s
   where s.usuario_id = p_usuario and s.activa
   order by s.endpoint, s.creada_en desc
  on conflict (endpoint, finca_id) do update set
    usuario_id = excluded.usuario_id, acceso_id = null, p256dh = excluded.p256dh, auth = excluded.auth, activa = true, fallos = 0;
end $$;

create or replace function public.af_quitar_dueno(p_token text, p_finca uuid, p_usuario text) returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_quien text := public.af__usuario(p_token, array['owner', 'administracion']);
begin
  delete from public.af_finca_duenos where finca_id = p_finca and usuario_id = p_usuario;
  update public.af_suscripciones set activa = false where finca_id = p_finca and usuario_id = p_usuario;
  perform v_quien;
end $$;

-- Un dueño desactivado, o al que le quitan el rol, deja de recibir avisos.
-- 🔴 Nunca frena la edición del usuario: cualquier error se traga.
create or replace function public.af_apagar_avisos_usuario() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if (NEW.activo is distinct from OLD.activo and not NEW.activo)
     or (NEW.rol is distinct from OLD.rol and OLD.rol = 'dueno_finca') then
    update public.af_suscripciones set activa = false where usuario_id = NEW.id;
  end if;
  return NEW;
exception when others then
  return NEW;
end $$;
drop trigger if exists trg_af_apagar_avisos_usuario on public.app_usuarios;
create trigger trg_af_apagar_avisos_usuario after update of activo, rol on public.app_usuarios
  for each row execute function public.af_apagar_avisos_usuario();

notify pgrst, 'reload schema';

-- Comprobación: la columna existe, la unicidad es (endpoint, finca_id) y af_suscribir conoce el rol nuevo.
select exists (select 1 from information_schema.columns where table_name = 'af_suscripciones' and column_name = 'usuario_id') as columna_usuario,
       exists (select 1 from pg_constraint where conname = 'af_suscripciones_endpoint_finca_key') as unicidad_endpoint_finca,
       position('dueno_finca' in pg_get_functiondef('public.af_suscribir(text,jsonb,text)'::regprocedure)) > 0 as suscribir_nuevo;
