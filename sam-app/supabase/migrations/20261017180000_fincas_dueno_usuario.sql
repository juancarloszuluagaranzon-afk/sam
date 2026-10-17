-- ============================================================================
-- El DUEÑO DE LA TIERRA entra con USUARIO y PIN (17-oct-2026, pedido de Iván).
--
-- «Démosles más bien un usuario y que se logueen; que sea como otra vista de
-- AgroMorales, segmentada por cada una de las fincas que vayan existiendo. Va a
-- haber una relación finca–dueño: una tabla con los dueños, a qué haciendas
-- tienen, qué área es, corte promedio… una data macro de su negocio.»
--
-- 1. Rol nuevo `dueno_finca` en app_usuarios (el CHECK se reescribe ENTERO).
-- 2. Tabla `af_finca_duenos`: la relación finca ↔ usuario dueño (N a N: un
--    dueño con varias fincas; una finca con varios socios). Cerrada a `anon`.
-- 3. El dueño abre su llave del módulo igual que el personal (`af_abrir_sesion`
--    / `_sin_pin`), y `af_datos` le entrega SOLO sus fincas, con las mismas
--    reservas del enlace (sin paquete, sin accesos, sin nombres de operarios).
--    `af__usuario` ya lo deja por fuera de toda escritura (su rol no está en
--    ninguna lista de permitidos).
-- 4. Administración asigna y quita dueños con `af_asignar_dueno` / `af_quitar_dueno`.
--
-- El enlace personal (`af_accesos`) sigue funcionando igual: los dos caminos
-- conviven mientras se migra a la dueña de Riogrande II.
-- ============================================================================

-- ── 1. El rol ────────────────────────────────────────────────────────────────
alter table public.app_usuarios drop constraint if exists app_usuarios_rol_check;
alter table public.app_usuarios add constraint app_usuarios_rol_check
  check (rol = any (array[
    'owner', 'administracion', 'supervisor', 'operador', 'soporte', 'supervisor_insumos',
    'conductor', 'analista_insumos', 'taller', 'conductor_madera',
    'dueno_finca'
  ]::text[]));

-- ── 2. La relación finca–dueño ───────────────────────────────────────────────
create table if not exists public.af_finca_duenos (
  finca_id    uuid not null references public.af_fincas(id),
  usuario_id  text not null references public.app_usuarios(id),
  creado_por  text,
  created_at  timestamptz not null default now(),
  primary key (finca_id, usuario_id)
);
comment on table public.af_finca_duenos is
  'Qué usuarios (rol dueno_finca) son dueños de qué finca. Solo por funciones af_*; cerrada a anon.';
revoke all on public.af_finca_duenos from public, anon, authenticated;
alter table public.af_finca_duenos enable row level security;

-- ── 3a. Abrir la llave del módulo: también el dueño con usuario ──────────────
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
  if v_rol not in ('owner', 'administracion', 'supervisor', 'dueno_finca') then
    raise exception 'SIN_PERMISO: su usuario no usa el módulo de fincas' using errcode = 'insufficient_privilege';
  end if;
  delete from public.af_intentos where usuario_id = p_usuario;
  delete from public.af_sesiones where expira_en < now() - interval '7 days';
  v_token := public.af_token_nuevo();
  insert into public.af_sesiones (token_hash, usuario_id, expira_en)
  values (public.af_hash(v_token), p_usuario, now() + interval '30 days');
  return v_token;
end $$;

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
  if v_rol is null or v_rol not in ('owner', 'administracion', 'supervisor', 'dueno_finca') then
    raise exception 'SIN_PERMISO: su usuario no usa el módulo de fincas' using errcode = 'insufficient_privilege';
  end if;
  v_token := public.af_token_nuevo();
  insert into public.af_sesiones (token_hash, usuario_id, expira_en, sin_pin)
  values (public.af_hash(v_token), p_usuario, now() + interval '30 days', true);
  return v_token;
end $$;

-- ── 3b. Leer: el dueño con usuario ve SOLO sus fincas ────────────────────────
-- Copia de 20260923090000; cambia la rama del rol, `v_dueno` y la clave `duenos`.
create or replace function public.af_datos(p_token text) returns jsonb
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  q record;
  v_fincas uuid[];
  v_dueno boolean;
  v_res jsonb;
begin
  select * into q from public.af_quien(p_token);
  if q.rol is null then
    raise exception 'SIN_SESION: la llave no es válida, venció o fue cancelada' using errcode = 'invalid_authorization_specification';
  end if;
  v_dueno := q.rol in ('dueno', 'dueno_finca');
  if q.rol = 'dueno' then
    v_fincas := array[q.finca];
    update public.af_accesos set ultimo_uso = now(), usos = usos + 1 where id = q.acceso;
  elsif q.rol = 'dueno_finca' then
    -- Sus fincas, por la relación. Sin fincas asignadas devuelve listas vacías
    -- (la pantalla lo explica), no un error.
    select coalesce(array_agg(fd.finca_id), '{}') into v_fincas
      from public.af_finca_duenos fd join public.af_fincas f on f.id = fd.finca_id and f.activa
     where fd.usuario_id = q.usuario;
    update public.af_sesiones set ultimo_uso = now() where token_hash = public.af_hash(p_token);
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
       mq as (
         select f.id as finca_id, a.id, a.numero_suerte, a.labor_nombre, a.estado,
                a.area_asignada, a.area_realizada, a.fecha_inicio, a.fecha_fin, a.created_at,
                a.equipo_codigo, a.equipo_nombre,
                case when v_dueno then null else a.operador_nombre end as operador_nombre
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
    'paquete', case when v_dueno then '[]'::jsonb
               else (select coalesce(jsonb_agg(to_jsonb(p) order by p.orden), '[]'::jsonb) from public.af_paquete p) end,
    'accesos', case when q.rol in ('owner', 'administracion') then (
                 select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'finca_id', a.finca_id, 'nombre', a.nombre,
                   'creado_por', a.creado_por, 'creado_en', a.creado_en, 'revocado_en', a.revocado_en,
                   'ultimo_uso', a.ultimo_uso, 'usos', a.usos) order by a.creado_en desc), '[]'::jsonb)
                   from public.af_accesos a where a.finca_id = any (v_fincas))
               else '[]'::jsonb end,
    -- Los dueños con usuario de cada finca: solo administración los ve.
    'duenos', case when q.rol in ('owner', 'administracion') then (
                select coalesce(jsonb_agg(jsonb_build_object('finca_id', fd.finca_id, 'usuario_id', fd.usuario_id,
                  'nombre', u.nombre_completo, 'activo', u.activo, 'creado_en', fd.created_at) order by u.nombre_completo), '[]'::jsonb)
                  from public.af_finca_duenos fd join public.app_usuarios u on u.id = fd.usuario_id
                 where fd.finca_id = any (v_fincas))
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

-- ── 4. Asignar y quitar dueños (solo administración) ─────────────────────────
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
end $$;

create or replace function public.af_quitar_dueno(p_token text, p_finca uuid, p_usuario text) returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_quien text := public.af__usuario(p_token, array['owner', 'administracion']);
begin
  delete from public.af_finca_duenos where finca_id = p_finca and usuario_id = p_usuario;
  perform v_quien;
end $$;

revoke execute on function public.af_asignar_dueno(text, uuid, text), public.af_quitar_dueno(text, uuid, text) from public;
grant execute on function public.af_asignar_dueno(text, uuid, text), public.af_quitar_dueno(text, uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';

-- Comprobación: el rol cabe, la tabla existe y está cerrada, y af_datos trae 'duenos'.
select 'dueno_finca' = any (string_to_array(regexp_replace(pg_get_constraintdef(oid), '[^a-z_,]', '', 'g'), ',')) as rol_en_check
  from pg_constraint where conname = 'app_usuarios_rol_check';
select count(*) = 0 as tabla_cerrada_a_anon from information_schema.role_table_grants
 where table_name = 'af_finca_duenos' and grantee in ('anon', 'authenticated');
select position('''duenos''' in pg_get_functiondef('public.af_datos(text)'::regprocedure)) > 0 as af_datos_nuevo;
