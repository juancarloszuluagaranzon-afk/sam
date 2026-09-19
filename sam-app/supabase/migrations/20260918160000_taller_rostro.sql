-- ============================================================================
-- Marcación del taller CON LA CARA (18-sep-2026).
--
-- Pedido del cliente: «quiero algo que sea con la cara, ya que los dedos
-- normalmente están sucios». Eligió que cada mecánico marque en SU celular con
-- una selfie dentro de la geocerca; lo dudoso lo revisa el jefe de taller.
--
-- Porte de AgroControl (módulo de jornales, CONTRATO 3/4, migraciones 0044–
-- 0050), revisado a fondo el mismo día: el motor face-api con el modelo dlib
-- (128 números por cara), los umbrales medidos con caras reales, la prueba de
-- vida (parpadeo + giro) y la regla de oro de su 0049:
--
--   🔴 LO QUE EL CELULAR NO PUEDE PROBAR NO SE PAGA SOLO: queda «por revisar»
--      y el jefe lo acepta o lo anula viendo la foto. Nunca se bloquea marcar.
--
-- Mejoras sobre AgroControl, tomadas de su propia re-auditoría:
-- · UNA sola decisión, en SQL (allá había dos motores: TS y trigger).
-- · El registro manda FOTO para que el jefe compare (allá el celular no la manda).
-- · La prueba de vida se EXIGE (allá se guardaba lo que dijera el cliente).
-- · Muestras idénticas al registrar = rechazo (allá 5 capturas de una foto pasaban).
-- · Captura casi idéntica a una muestra guardada = reenvío sospechoso.
-- · Solo dueño/administración aprueban, y nunca lo propio.
--
-- Umbrales (AgroControl `shared/biometria.ts`, medidos el 13-sep sobre 22 caras
-- y 83 variaciones: personas distintas nunca por debajo de 0,455; la misma cara
-- con mediana 0,17 — ⚠️ el margen con impostores es de 0,005, por eso la zona
-- gris NUNCA verifica sola). Se calibran en el piloto. ÚNICA fuente: este SQL.
--   < 0,06  contra una muestra guardada → reenvío de una muestra: por revisar
--   < 0,45  → la misma persona
--   < 0,52  → zona gris: por revisar
--   ≥ 0,52  → no es: no marca (salvo que la persona pida dejarla para revisión)
--   < 0,40  contra la plantilla de OTRA persona al registrar → duplicado
-- ============================================================================

-- ── Distancia euclidiana entre dos descriptores (jsonb de 128 números) ──────
create or replace function public.taller_distancia(a jsonb, b jsonb)
returns double precision
language sql immutable parallel safe
set search_path = public, pg_catalog
as $$
  select case when jsonb_array_length(a) = 128 and jsonb_array_length(b) = 128 then
    (select sqrt(sum(power((x.v)::double precision - (y.v)::double precision, 2)))
       from jsonb_array_elements_text(a) with ordinality as x(v, i)
       join jsonb_array_elements_text(b) with ordinality as y(v, i) using (i))
  end
$$;

-- La menor distancia entre UN descriptor y las muestras de una plantilla.
create or replace function public.taller_distancia_plantilla(d jsonb, muestras jsonb)
returns double precision
language sql immutable parallel safe
set search_path = public, pg_catalog
as $$
  select min(public.taller_distancia(d, m)) from jsonb_array_elements(muestras) as m
$$;

-- ── La autorización de datos biométricos (Ley 1581 de 2012) ────────────────
-- 🔴 El texto oficial vive AQUÍ y el servidor guarda ESTE, no el que diga el
-- celular (hallazgo M5 de la re-auditoría de AgroControl). Si el texto cambia,
-- cambia la versión, y una PWA vieja no puede registrar con el texto anterior.
create or replace function public.taller_consentimiento_vigente()
returns jsonb
language sql immutable
set search_path = public, pg_catalog
as $$
  select jsonb_build_object(
    'version', 'AGM-BIO-FACIAL-2026-09-v1',
    'titulo', 'AUTORIZACIÓN PARA EL TRATAMIENTO DE DATOS BIOMÉTRICOS (RECONOCIMIENTO FACIAL)',
    'parrafos', jsonb_build_array(
      'En cumplimiento de la Ley 1581 de 2012 y el Decreto 1377 de 2013, autorizo a AGROINDUSTRIAL DE SERVICIOS MORALES S.A.S., como responsable del tratamiento, a tomar imágenes de mi rostro y a convertirlas en una plantilla biométrica (un código numérico del que no se puede reconstruir la foto) con la única finalidad de verificar mi identidad al registrar la entrada y salida de mi jornada en el taller y calcular las horas trabajadas.',
      'Entiendo que: (1) los datos biométricos son datos sensibles; (2) esta autorización es FACULTATIVA: no estoy obligado a darla y, si no la doy, puedo registrar mi jornada con la huella de mi celular o con una marcación que revisa el jefe de taller, sin ninguna consecuencia; (3) la plantilla se guarda en los servidores de la empresa, no se comparte con terceros y se conserva mientras dure la relación laboral o hasta que revoque esta autorización; (4) el jefe de taller puede ver la foto de mi registro y de cada marcación para verificarlas; (5) tengo derecho a conocer, actualizar, rectificar y suprimir mis datos y a revocar esta autorización en cualquier momento, desde la misma app o ante la administración de la empresa.',
      'He leído (o se me ha leído) esta autorización, la entiendo y la acepto libremente.'
    )
  )
$$;

-- ── Plantillas ─────────────────────────────────────────────────────────────
create table if not exists public.taller_rostros (
  id uuid primary key default gen_random_uuid(),
  usuario_id text not null,
  descriptores jsonb not null,
  foto_mini text,
  consentimiento_en timestamptz not null,
  consentimiento_version text not null,
  consentimiento_texto text not null,
  estado text not null default 'PENDIENTE' check (estado in ('PENDIENTE', 'APROBADO', 'RECHAZADO')),
  revisado_por text,
  revisado_en timestamptz,
  motivo text,
  activo boolean not null default true,
  revocado_en timestamptz,
  creado_en timestamptz not null default now()
);
create index if not exists taller_rostros_usuario_idx on public.taller_rostros (usuario_id) where activo;

-- ── Marcaciones: revisión y cara ───────────────────────────────────────────
alter table public.taller_marcaciones drop constraint if exists taller_marcaciones_metodo_check;
alter table public.taller_marcaciones add constraint taller_marcaciones_metodo_check
  check (metodo in ('HUELLA', 'PIN', 'MANUAL', 'ROSTRO'));
alter table public.taller_marcaciones
  add column if not exists requiere_revision boolean not null default false,
  add column if not exists revision_motivo text,
  add column if not exists revisado_por text,
  add column if not exists revisado_en timestamptz,
  add column if not exists distancia_rostro double precision,
  add column if not exists pruebas_vida text,
  add column if not exists rostro_id uuid;
create index if not exists taller_marcaciones_revision_idx
  on public.taller_marcaciones (marcado_en desc) where requiere_revision and not anulada;

-- La foto de evidencia, aparte: la tabla de marcaciones se lee todos los días.
create table if not exists public.taller_marcacion_fotos (
  marcacion_id uuid primary key references public.taller_marcaciones (id) on delete cascade,
  foto_mini text not null,
  creado_en timestamptz not null default now()
);

-- ── Permisos ───────────────────────────────────────────────────────────────
alter table public.taller_rostros enable row level security;
alter table public.taller_marcacion_fotos enable row level security;
do $$
begin
  if not exists (select 1 from pg_policy where polname = 'taller_rostros_sel') then
    create policy taller_rostros_sel on public.taller_rostros for select using (true);
  end if;
  if not exists (select 1 from pg_policy where polname = 'taller_marcacion_fotos_sel') then
    create policy taller_marcacion_fotos_sel on public.taller_marcacion_fotos for select using (true);
  end if;
end $$;
-- 🔴 Por COLUMNAS: todo menos `descriptores`. La plantilla no sale del servidor.
grant select (id, usuario_id, foto_mini, consentimiento_en, consentimiento_version, estado,
              revisado_por, revisado_en, motivo, activo, revocado_en, creado_en)
  on public.taller_rostros to anon, authenticated;
grant select on public.taller_marcacion_fotos to anon, authenticated;

-- ¿Puede esta persona aprobar/revisar? Dueño o administración.
create or replace function public.taller_es_jefe(p_quien text)
returns boolean language sql stable security definer set search_path = public, pg_catalog as $$
  select exists (select 1 from public.app_usuarios where id = p_quien and activo and rol in ('owner', 'administracion'))
$$;

-- ── Registrar la cara ──────────────────────────────────────────────────────
create or replace function public.taller_enrolar_rostro(
  p_usuario_id text,
  p_descriptores jsonb,
  p_foto_mini text,
  p_consentimiento boolean,
  p_version text
) returns jsonb
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_consent jsonb := public.taller_consentimiento_vigente();
  v_n int;
  v_muestra jsonb;
  v_disp double precision;
  v_otro record;
  v_d double precision;
  v_id uuid;
begin
  if coalesce(p_consentimiento, false) is not true then
    raise exception 'SIN_CONSENTIMIENTO: sin la autorización de datos biométricos no se registra la cara';
  end if;
  if p_version is distinct from v_consent->>'version' then
    raise exception 'CONSENTIMIENTO_DESACTUALIZADO: la autorización cambió; actualiza la app y vuelve a leerla';
  end if;
  if not exists (select 1 from public.app_usuarios where id = p_usuario_id and activo) then
    raise exception 'USUARIO_INVALIDO';
  end if;
  if jsonb_typeof(p_descriptores) <> 'array' then raise exception 'MUESTRAS_INVALIDAS'; end if;
  v_n := jsonb_array_length(p_descriptores);
  if v_n < 5 or v_n > 10 then raise exception 'MUESTRAS_INVALIDAS: se esperan de 5 a 10 muestras, llegaron %', v_n; end if;
  for v_muestra in select * from jsonb_array_elements(p_descriptores) loop
    if jsonb_typeof(v_muestra) <> 'array' or jsonb_array_length(v_muestra) <> 128 then
      raise exception 'MUESTRAS_INVALIDAS: cada muestra debe tener 128 números';
    end if;
  end loop;
  if p_foto_mini is null or p_foto_mini !~ '^data:image/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$' or length(p_foto_mini) > 16000 then
    raise exception 'FOTO_INVALIDA: el registro necesita la foto para que el jefe lo compare';
  end if;

  -- Variedad de las muestras: ni idénticas (una foto quieta) ni de dos personas.
  select max(public.taller_distancia(a.m, b.m)) into v_disp
    from jsonb_array_elements(p_descriptores) with ordinality a(m, i)
    join jsonb_array_elements(p_descriptores) with ordinality b(m, j) on a.i < b.j;
  if v_disp < 0.06 then raise exception 'MUESTRAS_IDENTICAS: las fotos salieron iguales; repite moviendo apenas la cabeza'; end if;
  if v_disp > 0.6 then raise exception 'MUESTRAS_DISPERSAS: las fotos no parecen de la misma persona; repite, solo tú frente a la cámara'; end if;

  -- 🔴 La misma cara no puede quedar en dos cuentas: sería marcar por otro.
  for v_otro in
    select r.usuario_id, r.descriptores, coalesce(u.nombre_completo, r.usuario_id) as nombre
      from public.taller_rostros r left join public.app_usuarios u on u.id = r.usuario_id
     where r.activo and r.estado <> 'RECHAZADO' and r.usuario_id <> p_usuario_id
  loop
    select min(public.taller_distancia_plantilla(m, v_otro.descriptores)) into v_d
      from jsonb_array_elements(p_descriptores) as m;
    if v_d < 0.40 then
      raise exception 'ROSTRO_DUPLICADO: esta cara ya está registrada a nombre de %', v_otro.nombre;
    end if;
  end loop;

  -- Primero la nueva, después se da de baja la anterior (si algo falla a
  -- mitad, la persona no se queda sin cara). Vuelve a PENDIENTE: el jefe la ve.
  insert into public.taller_rostros (usuario_id, descriptores, foto_mini, consentimiento_en,
                                     consentimiento_version, consentimiento_texto)
  values (p_usuario_id, p_descriptores, p_foto_mini, now(), v_consent->>'version',
          (v_consent->>'titulo') || E'\n\n' ||
          (select string_agg(x, E'\n\n') from jsonb_array_elements_text(v_consent->'parrafos') x))
  returning id into v_id;
  update public.taller_rostros set activo = false
   where usuario_id = p_usuario_id and activo and id <> v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'estado', 'PENDIENTE');
end $$;

-- ── El titular retira la autorización: la plantilla se SUPRIME ─────────────
create or replace function public.taller_revocar_rostro(p_usuario_id text) returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  update public.taller_rostros
     set activo = false, revocado_en = now(), descriptores = '[]'::jsonb,
         motivo = coalesce(motivo || ' · ', '') || 'el titular retiró la autorización'
   where usuario_id = p_usuario_id and revocado_en is null;
end $$;

-- ── El jefe aprueba o rechaza la cara registrada ───────────────────────────
create or replace function public.taller_revisar_rostro(
  p_id uuid, p_aprobar boolean, p_quien text, p_motivo text default null
) returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_dueno text;
begin
  if not public.taller_es_jefe(p_quien) then raise exception 'SIN_PERMISO: solo el dueño o administración aprueban caras'; end if;
  select usuario_id into v_dueno from public.taller_rostros where id = p_id;
  if v_dueno = p_quien then raise exception 'SIN_PERMISO: nadie aprueba su propia cara'; end if;
  if not p_aprobar and coalesce(btrim(p_motivo), '') = '' then raise exception 'MOTIVO_REQUERIDO'; end if;
  update public.taller_rostros
     set estado = case when p_aprobar then 'APROBADO' else 'RECHAZADO' end,
         revisado_por = p_quien, revisado_en = now(), motivo = p_motivo
   where id = p_id and activo and estado = 'PENDIENTE';
end $$;

-- ── Marcar (reemplaza la de 11 parámetros; los nuevos van al final) ─────────
drop function if exists public.taller_marcar(uuid, text, text, timestamptz, text, text,
  double precision, double precision, double precision, text, text);

create or replace function public.taller_marcar(
  p_id uuid,
  p_usuario_id text,
  p_tipo text,
  p_ocurrio_en timestamptz default null,
  p_metodo text default 'HUELLA',
  p_credencial_id text default null,
  p_lat double precision default null,
  p_lng double precision default null,
  p_precision_m double precision default null,
  p_dispositivo text default null,
  p_nota text default null,
  p_descriptor jsonb default null,
  p_foto_mini text default null,
  p_pruebas_vida text default null,
  p_forzar_revision boolean default false
) returns jsonb
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_cuando timestamptz;
  v_corregida boolean := false;
  v_sitio public.taller_sitios%rowtype;
  v_dist double precision;
  v_mejor double precision;
  v_dentro boolean := null;
  v_previa public.taller_marcaciones%rowtype;
  v_metodo text := upper(coalesce(p_metodo, 'HUELLA'));
  v_rostro public.taller_rostros%rowtype;
  v_cara double precision := null;
  v_motivos text[] := '{}';
  v_foto text := case when p_foto_mini ~ '^data:image/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$'
                       and length(p_foto_mini) <= 16000 then p_foto_mini end;
begin
  -- Idempotencia: la cola offline reintenta y no puede duplicar la jornada.
  select * into v_previa from public.taller_marcaciones where id = p_id;
  if found then
    return jsonb_build_object('ok', true, 'repetida', true, 'id', v_previa.id,
                              'marcado_en', v_previa.marcado_en,
                              'resultado', case when v_previa.requiere_revision then 'POR_REVISAR' else 'OK' end,
                              'requiere_revision', v_previa.requiere_revision,
                              'revision_motivo', v_previa.revision_motivo);
  end if;

  -- La hora del teléfono se acepta, pero acotada.
  v_cuando := coalesce(p_ocurrio_en, now());
  if v_cuando > now() + interval '5 minutes' or v_cuando < now() - interval '2 days' then
    v_cuando := now();
    v_corregida := true;
  end if;
  -- 🔴 Subió tarde: la hora la puso el celular, que se puede adelantar o
  -- atrasar. Se conserva, pero no se paga sola (AgroControl: 15 minutos).
  if not v_corregida and p_ocurrio_en is not null and now() - p_ocurrio_en > interval '15 minutes' then
    v_motivos := array_append(v_motivos, 'subió tarde: la hora es la del celular'::text);
  end if;

  -- ¿Estaba en el taller?
  if p_lat is not null and p_lng is not null then
    for v_sitio in select * from public.taller_sitios where activo loop
      v_dist := 6371000 * 2 * asin(sqrt(
        power(sin(radians(p_lat - v_sitio.lat) / 2), 2) +
        cos(radians(v_sitio.lat)) * cos(radians(p_lat)) *
        power(sin(radians(p_lng - v_sitio.lng) / 2), 2)));
      if v_mejor is null or v_dist < v_mejor then
        v_mejor := v_dist;
        v_dentro := v_dist <= v_sitio.radio_m;
      end if;
    end loop;
  end if;

  -- ── La cara: la decide el SERVIDOR contra la plantilla ────────────────────
  if v_metodo = 'ROSTRO' then
    select * into v_rostro from public.taller_rostros
     where usuario_id = p_usuario_id and activo and estado <> 'RECHAZADO'
     order by creado_en desc limit 1;
    if not found then
      v_motivos := array_append(v_motivos, 'no tiene la cara registrada'::text);
    elsif p_descriptor is null or jsonb_typeof(p_descriptor) <> 'array' or jsonb_array_length(p_descriptor) <> 128 then
      v_motivos := array_append(v_motivos, 'la foto no trajo una cara legible'::text);
    else
      v_cara := public.taller_distancia_plantilla(p_descriptor, v_rostro.descriptores);
      if v_cara >= 0.52 and not coalesce(p_forzar_revision, false) then
        -- No se parece: NO se registra. La persona puede intentar de nuevo o
        -- pedir que la revise el jefe (p_forzar_revision).
        return jsonb_build_object('ok', false, 'resultado', 'NO_COINCIDE',
                                  'distancia', round(v_cara::numeric, 3));
      end if;
      if v_cara >= 0.52 then
        v_motivos := array_append(v_motivos, format('la cara no se parece (%s)', round(v_cara::numeric, 2))::text);
      elsif v_cara >= 0.45 then
        v_motivos := array_append(v_motivos, format('parecido dudoso (%s)', round(v_cara::numeric, 2))::text);
      elsif v_cara < 0.06 then
        -- Una toma real nunca da eso (mediana 0,17): es una muestra guardada reenviada.
        v_motivos := array_append(v_motivos, 'captura idéntica a una muestra guardada (posible reenvío)'::text);
      end if;
      if v_rostro.estado = 'PENDIENTE' then
        v_motivos := array_append(v_motivos, 'la cara registrada aún no la aprueba el jefe'::text);
      end if;
    end if;
    if coalesce(p_pruebas_vida, '') not like '%parpadeo%' or coalesce(p_pruebas_vida, '') not like '%giro%' then
      v_motivos := array_append(v_motivos, 'sin prueba de vida completa'::text);
    end if;
    if v_foto is null then
      v_motivos := array_append(v_motivos, 'sin foto de la marcación'::text);
    end if;
  elsif v_metodo = 'PIN' then
    v_motivos := array_append(v_motivos, 'marcada sin verificar a la persona'::text);
  end if;

  -- Fuera del taller o sin ubicación: tampoco se paga solo.
  if v_dentro is false then
    v_motivos := array_append(v_motivos, format('fuera del taller (a %s m)', round(v_mejor::numeric))::text);
  elsif v_dentro is null and v_metodo in ('ROSTRO', 'PIN') then
    v_motivos := array_append(v_motivos, 'sin ubicación'::text);
  end if;

  insert into public.taller_marcaciones (
    id, usuario_id, tipo, marcado_en, metodo, credencial_id,
    lat, lng, precision_m, dentro_del_sitio, distancia_m, dispositivo, nota, hora_corregida,
    requiere_revision, revision_motivo, distancia_rostro, pruebas_vida, rostro_id)
  values (
    p_id, p_usuario_id, upper(p_tipo), v_cuando, v_metodo, p_credencial_id,
    p_lat, p_lng, p_precision_m, v_dentro, round(v_mejor::numeric, 1), p_dispositivo,
    p_nota, v_corregida,
    cardinality(v_motivos) > 0, nullif(array_to_string(v_motivos, ' · '), ''),
    round(v_cara::numeric, 3), p_pruebas_vida, v_rostro.id);

  if v_foto is not null then
    insert into public.taller_marcacion_fotos (marcacion_id, foto_mini) values (p_id, v_foto);
  end if;
  if p_credencial_id is not null then
    update public.taller_credenciales set ultimo_uso = now() where id = p_credencial_id;
  end if;

  return jsonb_build_object('ok', true, 'repetida', false, 'id', p_id,
                            'marcado_en', v_cuando, 'hora_corregida', v_corregida,
                            'dentro_del_sitio', v_dentro, 'distancia_m', round(v_mejor::numeric, 1),
                            'resultado', case when cardinality(v_motivos) > 0 then 'POR_REVISAR' else 'OK' end,
                            'distancia', round(v_cara::numeric, 3),
                            'requiere_revision', cardinality(v_motivos) > 0,
                            'revision_motivo', nullif(array_to_string(v_motivos, ' · '), ''));
end $$;

-- ── El jefe revisa una marcación dudosa ────────────────────────────────────
-- Aceptar la deja contar; rechazar la ANULA (no se borra: queda con su motivo).
create or replace function public.taller_revisar_marcacion(
  p_id uuid, p_aceptar boolean, p_quien text, p_motivo text default null
) returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_dueno text;
begin
  if not public.taller_es_jefe(p_quien) then raise exception 'SIN_PERMISO: solo el dueño o administración revisan marcaciones'; end if;
  select usuario_id into v_dueno from public.taller_marcaciones where id = p_id;
  if v_dueno = p_quien then raise exception 'SIN_PERMISO: nadie revisa su propia marcación'; end if;
  if p_aceptar then
    update public.taller_marcaciones
       set requiere_revision = false, revisado_por = p_quien, revisado_en = now()
     where id = p_id and requiere_revision and not anulada;
  else
    if coalesce(btrim(p_motivo), '') = '' then raise exception 'MOTIVO_REQUERIDO'; end if;
    update public.taller_marcaciones
       set anulada = true, anulada_por = p_quien, anulada_en = now(), motivo = p_motivo,
           revisado_por = p_quien, revisado_en = now()
     where id = p_id and not anulada;
  end if;
end $$;

revoke all on function public.taller_es_jefe(text) from public;
grant execute on function public.taller_consentimiento_vigente() to anon, authenticated;
grant execute on function public.taller_enrolar_rostro(text, jsonb, text, boolean, text) to anon, authenticated;
grant execute on function public.taller_revocar_rostro(text) to anon, authenticated;
grant execute on function public.taller_revisar_rostro(uuid, boolean, text, text) to anon, authenticated;
grant execute on function public.taller_marcar(uuid, text, text, timestamptz, text, text,
  double precision, double precision, double precision, text, text, jsonb, text, text, boolean) to anon, authenticated;
grant execute on function public.taller_revisar_marcacion(uuid, boolean, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
