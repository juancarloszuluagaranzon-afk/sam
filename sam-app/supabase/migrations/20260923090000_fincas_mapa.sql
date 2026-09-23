-- ============================================================================
-- 20260923090000 — El MAPA de la finca (23-sep-2026)
--
-- Pedido del cliente para RIOGRANDE II (hacienda 627, Ingenio Risaralda): «un
-- banner con el título de la finca y un mapa en el cual se va a llevar el
-- control… que el avance de labores y todo sea muy visual desde un mapa… ubícalo
-- geoespacialmente, toma ideas del geovisor de AgroControl».
--
-- 1. `af_poligonos`: los pedazos de terreno de la finca, cada uno asignado (o
--    todavía no) a una suerte. Son pedazos y no «la geometría de la suerte»
--    porque el plano del ingenio no siempre coincide con las suertes de hoy: en
--    Riogrande II el plano es de 2025 y la renovación de julio de 2026 partió
--    suertes (2A, 3A, 4A, 5B). Un pedazo sin suerte se ve en gris con el número
--    que traía el plano, y administración lo asigna con un toque.
-- 2. `af_fincas.hacienda_codigo`: enlaza la finca con las labores de
--    MAQUINARIA que ASM ya registra (`asignaciones`), para pintarlas en el mapa
--    sin volver a digitarlas. El código de hacienda se repite entre ingenios
--    (hay una 627 en Risaralda, otra en Mayagüez y otra en Carmelita): se cruza
--    SIEMPRE con el ingenio.
-- 3. `af_suertes.datos_ingenio`: lo que reporta el ingenio de cada suerte
--    (último corte, número de corte, toneladas, TCH, rendimiento).
-- ============================================================================

alter table public.af_fincas  add column if not exists hacienda_codigo text;
alter table public.af_suertes add column if not exists datos_ingenio jsonb;

create table if not exists public.af_poligonos (
  id          uuid primary key default gen_random_uuid(),
  finca_id    uuid not null references public.af_fincas(id),
  suerte_id   uuid references public.af_suertes(id),
  -- El número que traía el plano de origen (p. ej. «4»): ayuda a asignarlo.
  etiqueta    text,
  -- Anillo exterior [[lng, lat], …] en WGS84.
  anillo      jsonb not null check (jsonb_typeof(anillo) = 'array' and jsonb_array_length(anillo) >= 3),
  area_ha     numeric,
  fuente      text not null,
  editado_por text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists af_poligonos_finca on public.af_poligonos (finca_id);

drop trigger if exists trg_af_poligonos_updated on public.af_poligonos;
create trigger trg_af_poligonos_updated before update on public.af_poligonos
  for each row execute function public.af_tocar_updated_at();
drop trigger if exists trg_af_poligonos_auditoria on public.af_poligonos;
create trigger trg_af_poligonos_auditoria after insert or update or delete on public.af_poligonos
  for each row execute function public.af_auditar();
drop trigger if exists trg_af_poligonos_guardia on public.af_poligonos;
create trigger trg_af_poligonos_guardia before insert or update on public.af_poligonos
  for each row execute function public.af_guardia_config();

-- Cerrada como las demás: solo por funciones con llave.
revoke all on public.af_poligonos from anon, authenticated;
alter table public.af_poligonos enable row level security;

-- ── Escrituras (solo administración) ──────────────────────────────────────
-- Agrega pedazos (importar un KML, dibujar). `suerte_codigo` opcional.
create or replace function public.af_guardar_poligonos(p_token text, p_finca uuid, p_poligonos jsonb) returns int
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_usuario text := public.af__usuario(p_token, array['owner', 'administracion']);
  v_n int;
begin
  insert into public.af_poligonos (finca_id, suerte_id, etiqueta, anillo, area_ha, fuente, editado_por)
  select p_finca,
         (select s.id from public.af_suertes s where s.finca_id = p_finca and s.codigo = nullif(x ->> 'suerte_codigo', '')),
         nullif(x ->> 'etiqueta', ''), x -> 'anillo', (x ->> 'area_ha')::numeric,
         coalesce(nullif(x ->> 'fuente', ''), 'app'), v_usuario
    from jsonb_array_elements(coalesce(p_poligonos, '[]'::jsonb)) x;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Asigna un pedazo a una suerte de SU finca (null = dejarlo sin suerte).
create or replace function public.af_asignar_poligono(p_token text, p_poligono uuid, p_suerte uuid) returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_usuario text := public.af__usuario(p_token, array['owner', 'administracion']);
begin
  if p_suerte is not null and not exists (
    select 1 from public.af_suertes s join public.af_poligonos p on p.finca_id = s.finca_id
     where s.id = p_suerte and p.id = p_poligono) then
    raise exception 'OTRA_FINCA: esa suerte no es de la finca de este pedazo' using errcode = 'check_violation';
  end if;
  update public.af_poligonos set suerte_id = p_suerte, editado_por = v_usuario where id = p_poligono;
  if not found then raise exception 'NO_EXISTE: el pedazo no existe' using errcode = 'no_data_found'; end if;
end $$;

-- Un pedazo mal dibujado se quita (queda en la auditoría).
create or replace function public.af_quitar_poligono(p_token text, p_poligono uuid) returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_usuario text := public.af__usuario(p_token, array['owner', 'administracion']);
begin
  perform set_config('af.via_funcion', '1', true);
  update public.af_poligonos set editado_por = v_usuario where id = p_poligono;
  delete from public.af_poligonos where id = p_poligono;
end $$;

-- La finca ahora guarda su código de hacienda. Si la pantalla no lo manda, se
-- conserva el que tenía (versiones viejas de la app no lo conocen).
create or replace function public.af_guardar_finca(p_token text, p_id uuid, p_datos jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_usuario text := public.af__usuario(p_token, array['owner', 'administracion']);
  v_id uuid;
begin
  if p_id is null then
    insert into public.af_fincas (nombre, dueno_nombre, dueno_telefono, dueno_correo, ingenio_id, municipio,
                                  honorario_modo, honorario_valor, nota, hacienda_codigo, editado_por)
    values (p_datos ->> 'nombre', p_datos ->> 'dueno_nombre', nullif(p_datos ->> 'dueno_telefono', ''),
            nullif(p_datos ->> 'dueno_correo', ''), nullif(p_datos ->> 'ingenio_id', ''), nullif(p_datos ->> 'municipio', ''),
            coalesce(nullif(p_datos ->> 'honorario_modo', ''), 'POR_DEFINIR'), (p_datos ->> 'honorario_valor')::numeric,
            nullif(p_datos ->> 'nota', ''), nullif(p_datos ->> 'hacienda_codigo', ''), v_usuario)
    returning id into v_id;
    return v_id;
  end if;
  update public.af_fincas set
    nombre = p_datos ->> 'nombre', dueno_nombre = p_datos ->> 'dueno_nombre',
    dueno_telefono = nullif(p_datos ->> 'dueno_telefono', ''), dueno_correo = nullif(p_datos ->> 'dueno_correo', ''),
    ingenio_id = nullif(p_datos ->> 'ingenio_id', ''), municipio = nullif(p_datos ->> 'municipio', ''),
    honorario_modo = coalesce(nullif(p_datos ->> 'honorario_modo', ''), 'POR_DEFINIR'),
    honorario_valor = (p_datos ->> 'honorario_valor')::numeric, nota = nullif(p_datos ->> 'nota', ''),
    hacienda_codigo = case when p_datos ? 'hacienda_codigo' then nullif(p_datos ->> 'hacienda_codigo', '') else hacienda_codigo end,
    editado_por = v_usuario
  where id = p_id;
  if not found then raise exception 'FINCA_NO_EXISTE' using errcode = 'no_data_found'; end if;
  return p_id;
end $$;

-- ── Lectura: lo de antes + los pedazos del mapa + la maquinaria de ASM ───
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
       m as (select * from public.af_movimientos where finca_id = any (v_fincas)),
       -- Labores de maquinaria de ASM en la hacienda de cada finca (mismo ingenio).
       mq as (
         select f.id as finca_id, a.id, a.numero_suerte, a.labor_nombre, a.estado,
                a.area_asignada, a.area_realizada, a.fecha_inicio, a.fecha_fin, a.created_at,
                a.equipo_codigo, a.equipo_nombre,
                -- El nombre del operario es del personal: al dueño no le llega.
                case when q.rol = 'dueno' then null else a.operador_nombre end as operador_nombre
           from public.af_fincas f
           join public.asignaciones a
             on f.hacienda_codigo is not null
            and a.codigo_hacienda::text = f.hacienda_codigo
            and (f.ingenio_id is null or a.ingenio_id = f.ingenio_id)
          where f.id = any (v_fincas)
            and a.estado in ('COMPLETADA', 'PARCIAL', 'EN_PROCESO'))
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
    'accesos', case when q.rol in ('owner', 'administracion') then (
                 select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'finca_id', a.finca_id, 'nombre', a.nombre,
                   'creado_por', a.creado_por, 'creado_en', a.creado_en, 'revocado_en', a.revocado_en,
                   'ultimo_uso', a.ultimo_uso, 'usos', a.usos) order by a.creado_en desc), '[]'::jsonb)
                   from public.af_accesos a where a.finca_id = any (v_fincas))
               else '[]'::jsonb end,
    'nombres', (select coalesce(jsonb_object_agg(u.id, u.nombre_completo), '{}'::jsonb) from public.app_usuarios u
                 where u.id in (select reportado_por from r union select revisado_por from r
                                union select registrado_por from m union select anulado_por from m)),
    'poligonos', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'finca_id', p.finca_id, 'suerte_id', p.suerte_id,
                   'etiqueta', p.etiqueta, 'anillo', p.anillo, 'area_ha', p.area_ha, 'fuente', p.fuente)), '[]'::jsonb)
                   from public.af_poligonos p where p.finca_id = any (v_fincas)),
    'maquinaria', (select coalesce(jsonb_agg(to_jsonb(mq) order by coalesce(mq.fecha_fin, mq.created_at) desc), '[]'::jsonb) from mq)
  ) into v_res;
  return v_res;
end $$;

-- ── PIN apagado «de momento» (23-sep-2026) ────────────────────────────────
-- El cliente: «déjame ver sin el PIN, después lo volvemos a mostrar». Una llave
-- en la base (`af_config.pin_requerido`) decide. Mientras esté en false, el
-- personal (dueño de ASM, administración, supervisores) entra a Fincas sin
-- confirmar el PIN. ⚠️ En ese modo cualquiera con la app podría pedir una llave
-- a nombre de otro usuario del personal: es la concesión que se aceptó.
-- Volver a exigirlo = `update af_config set valor = 'true' where clave =
-- 'pin_requerido'`: las sesiones abiertas SIN PIN dejan de servir al instante y
-- la app vuelve a pedir el PIN. Los enlaces del dueño no cambian en nada.
create table if not exists public.af_config (
  clave      text primary key,
  valor      jsonb not null,
  editado_en timestamptz not null default now()
);
insert into public.af_config (clave, valor) values ('pin_requerido', 'false') on conflict (clave) do nothing;
revoke all on public.af_config from anon, authenticated;
alter table public.af_config enable row level security;

alter table public.af_sesiones add column if not exists sin_pin boolean not null default false;

create or replace function public.af_pin_requerido() returns boolean
language sql stable security definer set search_path = public, pg_catalog as $$
  select coalesce((select (valor #>> '{}')::boolean from public.af_config where clave = 'pin_requerido'), true)
$$;

-- Una sesión abierta sin PIN solo vale mientras el PIN esté apagado.
create or replace function public.af_quien(p_token text)
returns table (usuario text, rol text, finca uuid, acceso uuid)
language sql stable security definer set search_path = public, pg_catalog as $$
  select s.usuario_id, u.rol::text, null::uuid, null::uuid
    from public.af_sesiones s join public.app_usuarios u on u.id = s.usuario_id and u.activo
   where s.token_hash = public.af_hash(p_token) and not s.revocada and s.expira_en > now()
     and (not s.sin_pin or not public.af_pin_requerido())
  union all
  select 'DUENO', 'dueno', a.finca_id, a.id
    from public.af_accesos a join public.af_fincas f on f.id = a.finca_id and f.activa
   where a.token_hash = public.af_hash(p_token) and a.revocado_en is null
  limit 1
$$;

create or replace function public.af_abrir_sesion_sin_pin(p_usuario text) returns text
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_rol text;
  v_token text;
begin
  if public.af_pin_requerido() then
    raise exception 'PIN_REQUERIDO: confirme su PIN para entrar a Fincas' using errcode = 'insufficient_privilege';
  end if;
  select u.rol::text into v_rol from public.app_usuarios u where u.id = p_usuario and u.activo;
  if v_rol is null or v_rol not in ('owner', 'administracion', 'supervisor') then
    raise exception 'SIN_PERMISO: su usuario no usa el módulo de fincas' using errcode = 'insufficient_privilege';
  end if;
  v_token := public.af_token_nuevo();
  insert into public.af_sesiones (token_hash, usuario_id, expira_en, sin_pin)
  values (public.af_hash(v_token), p_usuario, now() + interval '30 days', true);
  return v_token;
end $$;

revoke execute on function public.af_pin_requerido() from public, anon, authenticated;
revoke execute on function public.af_quien(text) from public, anon, authenticated;
revoke execute on function public.af_abrir_sesion_sin_pin(text) from public;
grant execute on function public.af_abrir_sesion_sin_pin(text) to anon, authenticated;

-- Permisos: solo lo que la app necesita.
revoke execute on function public.af_guardar_poligonos(text, uuid, jsonb), public.af_asignar_poligono(text, uuid, uuid),
  public.af_quitar_poligono(text, uuid) from public;
grant execute on function public.af_guardar_poligonos(text, uuid, jsonb), public.af_asignar_poligono(text, uuid, uuid),
  public.af_quitar_poligono(text, uuid), public.af_guardar_finca(text, uuid, jsonb), public.af_datos(text)
  to anon, authenticated;

notify pgrst, 'reload schema';
