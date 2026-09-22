-- ============================================================================
-- ADMINISTRACIÓN DE FINCAS — acceso directo del dueño de la tierra (22-sep-2026)
--
-- Pedido: «ahora dale acceso directo al dueño de la finca».
--
-- 🔴 El problema que había que resolver primero: la app entra con la llave
-- anónima (va dentro del código publicado) y el usuario lo decía el celular. Con
-- esa llave cualquiera podía leer TODAS las tablas `af_*`. Darle la app a un dueño
-- así era darle las fincas de los demás.
--
-- Cómo queda:
--   · Las tablas `af_*` ya NO se leen ni se escriben directo: sin permisos para la
--     llave anónima y con RLS sin políticas. Todo pasa por funciones que reciben
--     una LLAVE (`p_token`) y deciden con ella.
--   · Personal de ASM: la llave sale del PIN (`af_abrir_sesion`, mismo chequeo de
--     `app_login`), dura 30 días y se guarda solo su huella (sha256). Tras 5 PIN
--     errados, 15 minutos de bloqueo. El usuario sale de la llave, no del celular.
--   · Dueño de la tierra: administración le crea un ENLACE (`af_crear_acceso`). La
--     llave va en el enlace y la base guarda solo su huella: ni administración la
--     puede volver a ver. Con ella `af_datos` devuelve SOLO su finca, y ninguna
--     función de escritura la acepta. Se revoca con `af_revocar_acceso`.
--   · Las funciones del MVP (abrir ciclo, reportar, aceptar, anular) quedan como
--     internas (`af__*`, sin permiso para la app) y las envuelven versiones con llave.
-- ============================================================================

-- ── Sesiones del personal, intentos fallidos y accesos de dueños ──────────
create table if not exists public.af_sesiones (
  token_hash  text primary key,
  usuario_id  text not null,
  creada_en   timestamptz not null default now(),
  expira_en   timestamptz not null,
  revocada    boolean not null default false,
  ultimo_uso  timestamptz
);
create table if not exists public.af_intentos (
  id          bigserial primary key,
  usuario_id  text not null,
  en          timestamptz not null default now()
);
create index if not exists af_intentos_usuario on public.af_intentos (usuario_id, en);
create table if not exists public.af_accesos (
  id           uuid primary key default gen_random_uuid(),
  finca_id     uuid not null references public.af_fincas(id),
  token_hash   text not null unique,
  nombre       text not null check (btrim(nombre) <> ''),
  creado_por   text not null,
  creado_en    timestamptz not null default now(),
  revocado_en  timestamptz,
  revocado_por text,
  ultimo_uso   timestamptz,
  usos         int not null default 0
);

create or replace function public.af_hash(p text) returns text
language sql immutable set search_path = public, pg_catalog as $$
  select encode(sha256(convert_to(coalesce(p, ''), 'UTF8')), 'hex')
$$;
-- 64 caracteres hex de dos uuid aleatorios (~244 bits): no se adivina.
create or replace function public.af_token_nuevo() returns text
language sql volatile set search_path = public, pg_catalog as $$
  select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
$$;

-- ── Abrir sesión del personal con el PIN ──────────────────────────────────
-- Devuelve la llave, o NULL si el PIN no es (no se lanza error: así el intento
-- fallido queda registrado; un error desharía el registro).
create or replace function public.af_abrir_sesion(p_usuario text, p_pin text) returns text
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_rol text;
  v_token text;
begin
  if (select count(*) from public.af_intentos where usuario_id = p_usuario and en > now() - interval '15 minutes') >= 5 then
    raise exception 'BLOQUEADO: demasiados intentos con PIN errado; espere 15 minutos' using errcode = 'check_violation';
  end if;
  select u.rol::text into v_rol from public.app_usuarios u
   where u.id = p_usuario and u.activo and u.pin_hash = md5(coalesce(p_pin, '') || ':sam-piloto');
  if v_rol is null then
    insert into public.af_intentos (usuario_id) values (p_usuario);
    return null;
  end if;
  if v_rol not in ('owner', 'administracion', 'supervisor') then
    raise exception 'SIN_PERMISO: su usuario no usa el módulo de fincas' using errcode = 'insufficient_privilege';
  end if;
  delete from public.af_intentos where usuario_id = p_usuario;
  delete from public.af_sesiones where expira_en < now() - interval '7 days';
  v_token := public.af_token_nuevo();
  insert into public.af_sesiones (token_hash, usuario_id, expira_en)
  values (public.af_hash(v_token), p_usuario, now() + interval '30 days');
  return v_token;
end $$;

create or replace function public.af_cerrar_sesion(p_token text) returns void
language sql security definer set search_path = public, pg_catalog as $$
  update public.af_sesiones set revocada = true where token_hash = public.af_hash(p_token)
$$;

-- ── ¿Quién es esta llave? ─────────────────────────────────────────────────
create or replace function public.af_quien(p_token text)
returns table (usuario text, rol text, finca uuid, acceso uuid)
language sql stable security definer set search_path = public, pg_catalog as $$
  select s.usuario_id, u.rol::text, null::uuid, null::uuid
    from public.af_sesiones s join public.app_usuarios u on u.id = s.usuario_id and u.activo
   where s.token_hash = public.af_hash(p_token) and not s.revocada and s.expira_en > now()
  union all
  select 'DUENO', 'dueno', a.finca_id, a.id
    from public.af_accesos a join public.af_fincas f on f.id = a.finca_id and f.activa
   where a.token_hash = public.af_hash(p_token) and a.revocado_en is null
  limit 1
$$;

-- El usuario del personal detrás de una llave, con el rol exigido. El dueño NUNCA
-- pasa por aquí: ninguna escritura acepta su llave.
create or replace function public.af__usuario(p_token text, p_roles text[]) returns text
language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare q record;
begin
  select * into q from public.af_quien(p_token);
  if q.usuario is null then
    raise exception 'SIN_SESION: la sesión de fincas no es válida o venció; entre de nuevo con su PIN' using errcode = 'invalid_authorization_specification';
  end if;
  if q.rol = 'dueno' or not (q.rol = any (p_roles)) then
    raise exception 'SIN_PERMISO: su usuario no puede hacer esto' using errcode = 'insufficient_privilege';
  end if;
  return q.usuario;
end $$;

-- ── Las funciones del MVP pasan a internas ────────────────────────────────
do $$
begin
  if to_regprocedure('public.af_abrir_ciclo(uuid, date, text, text)') is not null then
    alter function public.af_abrir_ciclo(uuid, date, text, text) rename to af__abrir_ciclo;
  end if;
  if to_regprocedure('public.af_reportar(uuid, uuid, numeric, date, text, double precision, double precision, numeric, text, text)') is not null then
    alter function public.af_reportar(uuid, uuid, numeric, date, text, double precision, double precision, numeric, text, text) rename to af__reportar;
  end if;
  if to_regprocedure('public.af_revisar(uuid, boolean, text, text)') is not null then
    alter function public.af_revisar(uuid, boolean, text, text) rename to af__revisar;
  end if;
  if to_regprocedure('public.af_anular_movimiento(uuid, text, text)') is not null then
    alter function public.af_anular_movimiento(uuid, text, text) rename to af__anular_movimiento;
  end if;
end $$;

-- ── Versiones con llave (lo único que la app puede llamar) ────────────────
create or replace function public.af_abrir_ciclo(p_token text, p_suerte uuid, p_fecha_corte date, p_tipo text) returns uuid
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  return public.af__abrir_ciclo(p_suerte, p_fecha_corte, p_tipo, public.af__usuario(p_token, array['owner', 'administracion']));
end $$;

create or replace function public.af_reportar(
  p_token text, p_id uuid, p_labor uuid, p_cantidad numeric, p_fecha date, p_foto text,
  p_lat double precision, p_lng double precision, p_precision numeric, p_nota text
) returns uuid
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  return public.af__reportar(p_id, p_labor, p_cantidad, p_fecha, p_foto, p_lat, p_lng, p_precision, p_nota,
                             public.af__usuario(p_token, array['owner', 'administracion', 'supervisor']));
end $$;

create or replace function public.af_revisar(p_token text, p_reporte uuid, p_aceptar boolean, p_motivo text) returns text
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  return public.af__revisar(p_reporte, p_aceptar, p_motivo, public.af__usuario(p_token, array['owner', 'administracion', 'supervisor']));
end $$;

create or replace function public.af_anular_movimiento(p_token text, p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  perform public.af__anular_movimiento(p_id, p_motivo, public.af__usuario(p_token, array['owner', 'administracion']));
end $$;

-- Lo que antes se escribía directo en las tablas: ahora con llave.
create or replace function public.af_guardar_finca(p_token text, p_id uuid, p_datos jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_usuario text := public.af__usuario(p_token, array['owner', 'administracion']);
  v_id uuid;
begin
  if p_id is null then
    insert into public.af_fincas (nombre, dueno_nombre, dueno_telefono, dueno_correo, ingenio_id, municipio,
                                  honorario_modo, honorario_valor, nota, editado_por)
    values (p_datos ->> 'nombre', p_datos ->> 'dueno_nombre', nullif(p_datos ->> 'dueno_telefono', ''),
            nullif(p_datos ->> 'dueno_correo', ''), nullif(p_datos ->> 'ingenio_id', ''), nullif(p_datos ->> 'municipio', ''),
            coalesce(nullif(p_datos ->> 'honorario_modo', ''), 'POR_DEFINIR'), (p_datos ->> 'honorario_valor')::numeric,
            nullif(p_datos ->> 'nota', ''), v_usuario)
    returning id into v_id;
    return v_id;
  end if;
  update public.af_fincas set
    nombre = p_datos ->> 'nombre', dueno_nombre = p_datos ->> 'dueno_nombre',
    dueno_telefono = nullif(p_datos ->> 'dueno_telefono', ''), dueno_correo = nullif(p_datos ->> 'dueno_correo', ''),
    ingenio_id = nullif(p_datos ->> 'ingenio_id', ''), municipio = nullif(p_datos ->> 'municipio', ''),
    honorario_modo = coalesce(nullif(p_datos ->> 'honorario_modo', ''), 'POR_DEFINIR'),
    honorario_valor = (p_datos ->> 'honorario_valor')::numeric, nota = nullif(p_datos ->> 'nota', ''),
    editado_por = v_usuario
  where id = p_id;
  if not found then raise exception 'FINCA_NO_EXISTE' using errcode = 'no_data_found'; end if;
  return p_id;
end $$;

create or replace function public.af_agregar_suertes(p_token text, p_finca uuid, p_suertes jsonb) returns int
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_usuario text := public.af__usuario(p_token, array['owner', 'administracion']);
  v_n int;
begin
  insert into public.af_suertes (finca_id, codigo, area_ha, variedad, editado_por)
  select p_finca, btrim(x ->> 'codigo'), (x ->> 'area_ha')::numeric, nullif(btrim(coalesce(x ->> 'variedad', '')), ''), v_usuario
    from jsonb_array_elements(coalesce(p_suertes, '[]'::jsonb)) x;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create or replace function public.af_guardar_paquete(p_token text, p_id uuid, p_datos jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_usuario text := public.af__usuario(p_token, array['owner', 'administracion']);
  v_id uuid;
begin
  if p_id is null then
    insert into public.af_paquete (labor, unidad, cantidad_por_ha, costo_unitario, ventana_ideal, ventana_normal, aplica, orden, activa, editado_por)
    values (upper(btrim(p_datos ->> 'labor')), coalesce(p_datos ->> 'unidad', 'ha'), coalesce((p_datos ->> 'cantidad_por_ha')::numeric, 1),
            coalesce((p_datos ->> 'costo_unitario')::numeric, 0), (p_datos ->> 'ventana_ideal')::int, (p_datos ->> 'ventana_normal')::int,
            coalesce(p_datos ->> 'aplica', 'AMBOS'), coalesce((p_datos ->> 'orden')::int, 100), coalesce((p_datos ->> 'activa')::boolean, true), v_usuario)
    returning id into v_id;
    return v_id;
  end if;
  update public.af_paquete set
    labor = upper(btrim(p_datos ->> 'labor')), unidad = coalesce(p_datos ->> 'unidad', 'ha'),
    cantidad_por_ha = coalesce((p_datos ->> 'cantidad_por_ha')::numeric, 1), costo_unitario = coalesce((p_datos ->> 'costo_unitario')::numeric, 0),
    ventana_ideal = (p_datos ->> 'ventana_ideal')::int, ventana_normal = (p_datos ->> 'ventana_normal')::int,
    aplica = coalesce(p_datos ->> 'aplica', 'AMBOS'), orden = coalesce((p_datos ->> 'orden')::int, 100),
    activa = coalesce((p_datos ->> 'activa')::boolean, true), editado_por = v_usuario
  where id = p_id;
  return p_id;
end $$;

create or replace function public.af_actualizar_labor(p_token text, p_id uuid, p_cantidad numeric, p_costo numeric) returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_usuario text := public.af__usuario(p_token, array['owner', 'administracion']);
begin
  update public.af_labores set
    cantidad_plan = coalesce(p_cantidad, cantidad_plan), costo_unitario_plan = coalesce(p_costo, costo_unitario_plan),
    editado_por = v_usuario
  where id = p_id;
end $$;

create or replace function public.af_anular_labor(p_token text, p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_usuario text := public.af__usuario(p_token, array['owner', 'administracion']);
begin
  update public.af_labores set estado = 'ANULADA', anulada_motivo = btrim(coalesce(p_motivo, '')), editado_por = v_usuario
   where id = p_id;
end $$;

create or replace function public.af_registrar_movimiento(p_token text, p_datos jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_usuario text := public.af__usuario(p_token, array['owner', 'administracion']);
  v_id uuid;
begin
  insert into public.af_movimientos (finca_id, tipo, fecha, concepto, valor, suerte_id, soporte_url, registrado_por)
  values ((p_datos ->> 'finca_id')::uuid, p_datos ->> 'tipo', (p_datos ->> 'fecha')::date, btrim(p_datos ->> 'concepto'),
          (p_datos ->> 'valor')::numeric, nullif(p_datos ->> 'suerte_id', '')::uuid, nullif(p_datos ->> 'soporte_url', ''), v_usuario)
  returning id into v_id;
  return v_id;
end $$;

-- ── Enlaces del dueño ─────────────────────────────────────────────────────
create or replace function public.af_crear_acceso(p_token text, p_finca uuid, p_nombre text) returns text
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_usuario text := public.af__usuario(p_token, array['owner', 'administracion']);
  v_llave text := public.af_token_nuevo();
begin
  if not exists (select 1 from public.af_fincas where id = p_finca and activa) then
    raise exception 'FINCA_NO_EXISTE' using errcode = 'no_data_found';
  end if;
  insert into public.af_accesos (finca_id, token_hash, nombre, creado_por)
  values (p_finca, public.af_hash(v_llave), coalesce(nullif(btrim(p_nombre), ''), 'Dueño'), v_usuario);
  return v_llave;  -- la única vez que existe en claro
end $$;

create or replace function public.af_revocar_acceso(p_token text, p_acceso uuid) returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_usuario text := public.af__usuario(p_token, array['owner', 'administracion']);
begin
  update public.af_accesos set revocado_en = now(), revocado_por = v_usuario
   where id = p_acceso and revocado_en is null;
end $$;

-- ── Leer el módulo: el personal ve todo, el dueño SOLO su finca ───────────
create or replace function public.af_datos(p_token text) returns jsonb
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  q record;
  v_fincas uuid[];
  v_res jsonb;
begin
  select * into q from public.af_quien(p_token);
  if q.rol is null then
    raise exception 'SIN_SESION: la llave no es válida, venció o fue cancelada' using errcode = 'invalid_authorization_specification';
  end if;
  if q.rol = 'dueno' then
    v_fincas := array[q.finca];
    update public.af_accesos set ultimo_uso = now(), usos = usos + 1 where id = q.acceso;
  elsif q.rol in ('owner', 'administracion', 'supervisor') then
    select coalesce(array_agg(id), '{}') into v_fincas from public.af_fincas;
    update public.af_sesiones set ultimo_uso = now() where token_hash = public.af_hash(p_token);
  else
    raise exception 'SIN_PERMISO: su usuario no usa el módulo de fincas' using errcode = 'insufficient_privilege';
  end if;

  with s as (select * from public.af_suertes where finca_id = any (v_fincas)),
       c as (select * from public.af_ciclos where suerte_id in (select id from s)),
       l as (select * from public.af_labores where ciclo_id in (select id from c)),
       r as (select * from public.af_reportes where labor_id in (select id from l)),
       m as (select * from public.af_movimientos where finca_id = any (v_fincas))
  select jsonb_build_object(
    'rol', q.rol,
    'usuario', q.usuario,
    'fincas', (select coalesce(jsonb_agg(to_jsonb(f) order by f.nombre), '[]'::jsonb) from public.af_fincas f where f.id = any (v_fincas)),
    'suertes', (select coalesce(jsonb_agg(to_jsonb(s) order by s.codigo), '[]'::jsonb) from s),
    'ciclos', (select coalesce(jsonb_agg(to_jsonb(c) order by c.fecha_corte desc), '[]'::jsonb) from c),
    'labores', (select coalesce(jsonb_agg(to_jsonb(l) order by l.orden), '[]'::jsonb) from l),
    'reportes', (select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc), '[]'::jsonb) from r),
    'movimientos', (select coalesce(jsonb_agg(to_jsonb(m) order by m.fecha desc, m.created_at desc), '[]'::jsonb) from m),
    'paquete', case when q.rol = 'dueno' then '[]'::jsonb
               else (select coalesce(jsonb_agg(to_jsonb(p) order by p.orden), '[]'::jsonb) from public.af_paquete p) end,
    -- Los enlaces solo los ve administración, y nunca con su llave.
    'accesos', case when q.rol in ('owner', 'administracion') then (
                 select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'finca_id', a.finca_id, 'nombre', a.nombre,
                   'creado_por', a.creado_por, 'creado_en', a.creado_en, 'revocado_en', a.revocado_en,
                   'ultimo_uso', a.ultimo_uso, 'usos', a.usos) order by a.creado_en desc), '[]'::jsonb)
                   from public.af_accesos a where a.finca_id = any (v_fincas))
               else '[]'::jsonb end,
    -- Nombres de quien aparece en estos datos (el dueño no tiene la lista de usuarios).
    'nombres', (select coalesce(jsonb_object_agg(u.id, u.nombre_completo), '{}'::jsonb) from public.app_usuarios u
                 where u.id in (select reportado_por from r union select revisado_por from r
                                union select registrado_por from m union select anulado_por from m))
  ) into v_res;
  return v_res;
end $$;

-- ── Cerrar la puerta directa ──────────────────────────────────────────────
revoke all on public.af_fincas, public.af_suertes, public.af_ciclos, public.af_paquete, public.af_labores,
              public.af_reportes, public.af_movimientos, public.af_auditoria,
              public.af_sesiones, public.af_intentos, public.af_accesos from anon, authenticated;
do $$
declare t text; pol record;
begin
  foreach t in array array['af_fincas','af_suertes','af_ciclos','af_paquete','af_labores','af_reportes','af_movimientos','af_auditoria','af_sesiones','af_intentos','af_accesos'] loop
    execute format('alter table public.%I enable row level security', t);
    for pol in select polname from pg_policy where polrelid = ('public.' || t)::regclass loop
      execute format('drop policy %I on public.%I', pol.polname, t);
    end loop;
  end loop;
end $$;

-- Las funciones nacen ejecutables por todos: se deja SOLO lo que la app necesita.
revoke execute on function
  public.af_hash(text), public.af_token_nuevo(), public.af_quien(text), public.af__usuario(text, text[]),
  public.af_rol(text), public.af_via_funcion(),
  public.af__abrir_ciclo(uuid, date, text, text),
  public.af__reportar(uuid, uuid, numeric, date, text, double precision, double precision, numeric, text, text),
  public.af__revisar(uuid, boolean, text, text),
  public.af__anular_movimiento(uuid, text, text)
from public, anon, authenticated;
grant execute on function
  public.af_abrir_sesion(text, text), public.af_cerrar_sesion(text), public.af_datos(text),
  public.af_abrir_ciclo(text, uuid, date, text),
  public.af_reportar(text, uuid, uuid, numeric, date, text, double precision, double precision, numeric, text),
  public.af_revisar(text, uuid, boolean, text), public.af_anular_movimiento(text, uuid, text),
  public.af_guardar_finca(text, uuid, jsonb), public.af_agregar_suertes(text, uuid, jsonb),
  public.af_guardar_paquete(text, uuid, jsonb), public.af_actualizar_labor(text, uuid, numeric, numeric),
  public.af_anular_labor(text, uuid, text), public.af_registrar_movimiento(text, jsonb),
  public.af_crear_acceso(text, uuid, text), public.af_revocar_acceso(text, uuid)
to anon, authenticated;
