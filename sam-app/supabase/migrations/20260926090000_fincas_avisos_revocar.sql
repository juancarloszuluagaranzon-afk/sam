-- ============================================================================
-- 20260926090000 — Quitar el acceso del dueño también apaga sus AVISOS (26-sep-2026)
--
-- Hueco encontrado al probar los avisos: `af_revocar_acceso` cancelaba el enlace
-- (la vista ya no abría) pero la suscripción de ese celular seguía activa, así que
-- quien tuviera un enlace quitado SEGUÍA recibiendo las notificaciones de la finca.
-- Ahora: al quitar el acceso se apagan sus suscripciones, y además el envío solo va
-- a suscripciones cuyo enlace sigue vigente (doble candado).
-- ============================================================================

create or replace function public.af_revocar_acceso(p_token text, p_acceso uuid) returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_usuario text := public.af__usuario(p_token, array['owner', 'administracion']);
begin
  update public.af_accesos set revocado_en = now(), revocado_por = v_usuario
   where id = p_acceso and revocado_en is null;
  -- Sin enlace no hay avisos: ese celular deja de recibirlos de inmediato.
  update public.af_suscripciones set activa = false where acceso_id = p_acceso and activa;
end $$;

-- ¿Esta suscripción puede recibir? Activa y con su enlace vigente.
create or replace function public.af_suscripcion_vigente(p_acceso uuid) returns boolean
language sql stable security definer set search_path = public, pg_catalog as $$
  select p_acceso is null or exists (select 1 from public.af_accesos a where a.id = p_acceso and a.revocado_en is null)
$$;

create or replace function public.af_avisar(p_finca uuid, p_titulo text, p_cuerpo text, p_tag text, p_endpoint text default null)
returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_cfg jsonb;
begin
  if not exists (select 1 from public.af_suscripciones s
                  where s.finca_id = p_finca and s.activa and public.af_suscripcion_vigente(s.acceso_id)
                    and (p_endpoint is null or s.endpoint = p_endpoint)) then
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

-- Lo que ya quedó huérfano (enlaces quitados antes de este arreglo).
update public.af_suscripciones s set activa = false
 where s.activa and not public.af_suscripcion_vigente(s.acceso_id);

revoke execute on function public.af_suscripcion_vigente(uuid), public.af_avisar(uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.af_suscripcion_vigente(uuid) to postgres;
