-- ============================================================================
-- 20261022130000 — CIMIENTO DE SESIONES (Fase 1 del endurecimiento, 22-oct-2026)
--
-- Hoy la app principal NO tiene sesión: `app_login` verifica el PIN y devuelve los
-- datos del usuario; de ahí en adelante el cliente manda su id como texto
-- (`p_usuario`) y la base confía en él. Esta migración agrega la BASE para
-- corregirlo, SIN cambiar nada de lo que ya funciona:
--   · app_sesiones ........ una sesión por token (se guarda SOLO el hash del token).
--   · app_login_token ..... igual que app_login pero ADEMÁS entrega un token.
--                           `app_login` queda intacto; el cliente lo adopta después.
--   · app_sesion_usuario .. dado un token, dice de verdad quién es (o nada si no vale).
--   · app_cerrar_sesion ... cierra la sesión (logout).
--
-- Nada se hace obligatorio todavía: ninguna función existente cambia y ningún
-- permiso se cierra. La app sigue exactamente igual. Reutiliza las utilidades
-- probadas `af_hash` / `af_token_nuevo` (hash sha256 y token de ~244 bits).
-- ============================================================================

create table if not exists public.app_sesiones (
  token_hash  text primary key,
  usuario_id  text not null references public.app_usuarios(id),
  rol         text not null,
  creada_en   timestamptz not null default now(),
  expira_en   timestamptz not null,
  revocada    boolean not null default false,
  ultimo_uso  timestamptz
);
create index if not exists app_sesiones_usuario_idx on public.app_sesiones (usuario_id) where not revocada;
alter table public.app_sesiones enable row level security;
-- Sin policy ni grant a anon/authenticated: SOLO las funciones SECURITY DEFINER la tocan.

-- Login que ADEMÁS entrega un token de sesión. `app_login` se deja intacto.
-- Devuelve sin filas si el usuario/PIN no es (igual que app_login).
create or replace function public.app_login_token(p_user_id text, p_pin text, p_dias integer default 7)
returns table(id text, nombre_completo text, rol text, equipo_codigo text, token text)
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_u public.app_usuarios;
  v_token text;
begin
  select * into v_u from public.app_usuarios u
   where u.activo = true and u.id = p_user_id and u.pin_hash = md5(p_pin || ':sam-piloto')
   limit 1;
  if v_u.id is null then
    return;  -- usuario o PIN incorrecto
  end if;
  delete from public.app_sesiones where expira_en < now() - interval '7 days';  -- limpieza
  v_token := public.af_token_nuevo();
  insert into public.app_sesiones (token_hash, usuario_id, rol, expira_en)
    values (public.af_hash(v_token), v_u.id, v_u.rol,
            now() + make_interval(days => greatest(1, least(coalesce(p_dias, 7), 90))));
  return query select v_u.id, v_u.nombre_completo, v_u.rol, v_u.equipo_codigo, v_token;
end $$;

-- Verifica un token y devuelve quién es (o nada si es inválido/expirado/revocado).
create or replace function public.app_sesion_usuario(p_token text)
returns table(usuario_id text, rol text)
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_h text;
begin
  if coalesce(p_token, '') = '' then return; end if;
  v_h := public.af_hash(p_token);
  update public.app_sesiones set ultimo_uso = now()
    where token_hash = v_h and not revocada and expira_en > now();
  return query select s.usuario_id, s.rol from public.app_sesiones s
    where s.token_hash = v_h and not s.revocada and s.expira_en > now();
end $$;

-- Cierra la sesión (logout).
create or replace function public.app_cerrar_sesion(p_token text)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  update public.app_sesiones set revocada = true
    where token_hash = public.af_hash(p_token) and not revocada;
end $$;

grant execute on function public.app_login_token(text, text, integer),
  public.app_sesion_usuario(text), public.app_cerrar_sesion(text) to anon, authenticated;
