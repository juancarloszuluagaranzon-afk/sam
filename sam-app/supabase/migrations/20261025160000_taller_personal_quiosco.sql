-- ============================================================================
-- Taller: el JEFE enrola al personal y un QUIOSCO en la entrada (25-oct-2026).
--
-- Pedido de Carlos David: «control de horas y enrolamiento de personal del
-- taller». Medido ese día en la base: el módulo de asistencia (sep-2026) tenía
-- CERO adopción — un solo usuario `taller` (el de pruebas), cero caras, cero
-- huellas. El registro dependía de que cada mecánico lo hiciera solo, en su
-- celular, con usuario y PIN; nadie lo hizo.
--
-- 1. `taller_personal`: cargo y teléfono de cada mecánico (`app_usuarios` no
--    los tiene y no se toca por esto).
-- 2. `taller_enrolar_rostro` + `p_enrolado_por` (AL FINAL y con default): si
--    la cara la registra el jefe EN PERSONA, queda APROBADA de una. Nadie se
--    registra a sí mismo como jefe: eso sigue naciendo PENDIENTE.
-- 3. Rol `quiosco_taller`: la tableta fija de la entrada. Solo ve el quiosco.
-- 4. `taller_marcar` + `p_quiosco` y `p_pin` (AL FINAL y con default):
--    · desde el quiosco (un aparato FIJO en el taller) no se exige GPS: una
--      tableta Wi-Fi puede no tenerlo y cada marcación quedaría «por revisar»;
--      si SÍ manda ubicación y está lejos, sigue saliendo «fuera del taller».
--    · el PIN se verifica en el servidor: si no coincide, NO se registra (nadie
--      marca por otro sabiendo solo su nombre). Igual queda por revisar: un PIN
--      se puede prestar; la cara no.
-- ⚠️ Como todo hoy, la base todavía confía en el cliente (Fase 3 de seguridad):
--    el «solo ve el quiosco» lo hace cumplir la app.
-- ============================================================================

-- ── 1. El rol nuevo (Postgres no AMPLÍA un CHECK: se reescribe completo) ────
alter table public.app_usuarios drop constraint if exists app_usuarios_rol_check;
alter table public.app_usuarios add constraint app_usuarios_rol_check
  check (rol = any (array['owner', 'administracion', 'supervisor', 'operador', 'soporte',
                          'supervisor_insumos', 'conductor', 'analista_insumos', 'taller',
                          'conductor_madera', 'dueno_finca', 'propietario', 'quiosco_taller']));

-- ── 2. Ficha del mecánico ────────────────────────────────────────────────────
create table if not exists public.taller_personal (
  usuario_id     text primary key references public.app_usuarios (id),
  cargo          text,
  telefono       text,
  actualizado_por text,
  actualizado_en timestamptz not null default now()
);
alter table public.taller_personal enable row level security;
do $$
begin
  if not exists (select 1 from pg_policy where polname = 'taller_personal_sel') then
    create policy taller_personal_sel on public.taller_personal for select using (true);
  end if;
end $$;
-- Una tabla nueva NO hereda los grant: sin esto la app responde «permission denied».
grant select on public.taller_personal to anon, authenticated;

create or replace function public.taller_guardar_personal(
  p_usuario_id text, p_cargo text, p_telefono text, p_quien text
) returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if not public.taller_es_jefe(p_quien) then
    raise exception 'SIN_PERMISO: solo el dueño o administración registran al personal del taller';
  end if;
  if not exists (select 1 from public.app_usuarios where id = p_usuario_id and rol = 'taller') then
    raise exception 'USUARIO_INVALIDO: no es personal del taller';
  end if;
  insert into public.taller_personal (usuario_id, cargo, telefono, actualizado_por, actualizado_en)
  values (p_usuario_id, nullif(btrim(upper(p_cargo)), ''), nullif(btrim(p_telefono), ''), p_quien, now())
  on conflict (usuario_id) do update
     set cargo = excluded.cargo, telefono = excluded.telefono,
         actualizado_por = excluded.actualizado_por, actualizado_en = now();
end $$;

-- ── 3. Quién registró la cara ────────────────────────────────────────────────
alter table public.taller_rostros add column if not exists enrolado_por text;
-- Grant por COLUMNAS (la tabla deja `descriptores` por fuera): la columna nueva
-- no hereda el permiso y un select que la nombre respondería 401.
grant select (enrolado_por) on public.taller_rostros to anon, authenticated;

-- Copiada de 20260918160000 (idéntica a la de producción, comparada el 25-oct)
-- + `p_enrolado_por`. Lo demás NO cambia: muestras, foto, duplicados.
drop function if exists public.taller_enrolar_rostro(text, jsonb, text, boolean, text);
create or replace function public.taller_enrolar_rostro(
  p_usuario_id text,
  p_descriptores jsonb,
  p_foto_mini text,
  p_consentimiento boolean,
  p_version text,
  p_enrolado_por text default null
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
  v_en_persona boolean := false;
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
  -- El jefe la registra EN PERSONA: la vio con sus ojos, no hace falta otra
  -- aprobación. Si dice ser el jefe y no lo es, o se registra a sí mismo, se rechaza.
  if p_enrolado_por is not null then
    if not public.taller_es_jefe(p_enrolado_por) then
      raise exception 'SIN_PERMISO: solo el dueño o administración registran la cara de otra persona';
    end if;
    if p_enrolado_por = p_usuario_id then
      raise exception 'SIN_PERMISO: nadie aprueba su propia cara';
    end if;
    v_en_persona := true;
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
  -- mitad, la persona no se queda sin cara). Sola: PENDIENTE. En persona: APROBADA.
  insert into public.taller_rostros (usuario_id, descriptores, foto_mini, consentimiento_en,
                                     consentimiento_version, consentimiento_texto,
                                     estado, revisado_por, revisado_en, motivo, enrolado_por)
  values (p_usuario_id, p_descriptores, p_foto_mini, now(), v_consent->>'version',
          (v_consent->>'titulo') || E'\n\n' ||
          (select string_agg(x, E'\n\n') from jsonb_array_elements_text(v_consent->'parrafos') x),
          case when v_en_persona then 'APROBADO' else 'PENDIENTE' end,
          case when v_en_persona then p_enrolado_por end,
          case when v_en_persona then now() end,
          case when v_en_persona then 'registrada en persona por el jefe' end,
          p_enrolado_por)
  returning id into v_id;
  update public.taller_rostros set activo = false
   where usuario_id = p_usuario_id and activo and id <> v_id;
  return jsonb_build_object('ok', true, 'id', v_id,
                            'estado', case when v_en_persona then 'APROBADO' else 'PENDIENTE' end);
end $$;

-- ── 4. Marcar: el quiosco y el PIN ───────────────────────────────────────────
alter table public.taller_marcaciones add column if not exists quiosco_id text;

-- Copiada de 20260918160000 (idéntica a la de producción, comparada el 25-oct)
-- + `p_quiosco` y `p_pin`. Lo demás NO cambia.
drop function if exists public.taller_marcar(uuid, text, text, timestamptz, text, text,
  double precision, double precision, double precision, text, text, jsonb, text, text, boolean);

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
  p_forzar_revision boolean default false,
  p_quiosco text default null,
  p_pin text default null
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
  v_quiosco boolean := false;
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

  -- 🔴 El PIN se verifica ANTES de registrar nada: si no coincide, no se marca.
  -- Sin PIN (llega de la cola sin señal: el PIN no se guarda en el aparato) se
  -- registra como siempre, sin verificar y por revisar.
  if v_metodo = 'PIN' and p_pin is not null and not exists (
       select 1 from public.app_usuarios
        where id = p_usuario_id and activo and pin_hash = md5(p_pin || ':sam-piloto')) then
    return jsonb_build_object('ok', false, 'resultado', 'PIN_INCORRECTO');
  end if;

  -- ¿Viene del quiosco del taller? Solo cuenta si es un usuario quiosco ACTIVO.
  if p_quiosco is not null then
    v_quiosco := exists (select 1 from public.app_usuarios
                          where id = p_quiosco and activo and rol = 'quiosco_taller');
    if not v_quiosco then
      v_motivos := array_append(v_motivos, 'quiosco no reconocido'::text);
    end if;
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
    v_motivos := array_append(v_motivos, case when p_pin is not null
      then 'marcada con PIN, sin la cara'
      else 'marcada sin verificar a la persona' end::text);
  end if;

  -- Fuera del taller o sin ubicación: tampoco se paga solo. El quiosco es un
  -- aparato FIJO en el taller: sin ubicación no es sospechoso; lejos, sí.
  if v_dentro is false then
    v_motivos := array_append(v_motivos, format('fuera del taller (a %s m)', round(v_mejor::numeric))::text);
  elsif v_dentro is null and v_metodo in ('ROSTRO', 'PIN') and not v_quiosco then
    v_motivos := array_append(v_motivos, 'sin ubicación'::text);
  end if;

  insert into public.taller_marcaciones (
    id, usuario_id, tipo, marcado_en, metodo, credencial_id,
    lat, lng, precision_m, dentro_del_sitio, distancia_m, dispositivo, nota, hora_corregida,
    requiere_revision, revision_motivo, distancia_rostro, pruebas_vida, rostro_id, quiosco_id)
  values (
    p_id, p_usuario_id, upper(p_tipo), v_cuando, v_metodo, p_credencial_id,
    p_lat, p_lng, p_precision_m, v_dentro, round(v_mejor::numeric, 1), p_dispositivo,
    p_nota, v_corregida,
    cardinality(v_motivos) > 0, nullif(array_to_string(v_motivos, ' · '), ''),
    round(v_cara::numeric, 3), p_pruebas_vida, v_rostro.id,
    case when v_quiosco then p_quiosco end);

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

grant execute on function public.taller_guardar_personal(text, text, text, text) to anon, authenticated;
grant execute on function public.taller_enrolar_rostro(text, jsonb, text, boolean, text, text) to anon, authenticated;
grant execute on function public.taller_marcar(uuid, text, text, timestamptz, text, text,
  double precision, double precision, double precision, text, text, jsonb, text, text, boolean, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
