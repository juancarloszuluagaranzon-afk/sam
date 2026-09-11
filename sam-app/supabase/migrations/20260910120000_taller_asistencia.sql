-- Control de entrada y salida de los mecánicos del taller, para horas extras.
--
-- 🔴 ESTO DECIDE UN PAGO. Las reglas que siguen no son preferencias de diseño:
-- cada una tapa una forma concreta de que el reporte quede cuadrado y falso.
--
-- 1. DOS FECHAS, como en el kardex. `marcado_en` es cuándo ocurrió y
--    `registrado_en` cuándo llegó al servidor. En un taller sin señal la
--    marcación se hace a las 6 a.m. y sube a las 9; si se guardara una sola
--    fecha habría que escoger entre perder la hora real o perder la evidencia
--    de que subió tarde. Se guardan las dos y la pantalla muestra la brecha.
-- 2. EL TELÉFONO PONE EL ID. Con la cola offline, reintentar no puede crear una
--    marcación gemela. Mismo patrón que `entregar_directo` y que el viaje de
--    flota en dos fases.
-- 3. LA HORA DEL TELÉFONO SE ACOTA. Se acepta porque sin señal es la única que
--    hay, pero no puede venir del futuro ni de hace tres días: ahí se corrige
--    al reloj del servidor y queda marcado. Un reloj que se puede mover a
--    voluntad sobre un dato que se paga es una puerta abierta.
-- 4. NADA SE BORRA NI SE PISA. Corregir una marcación deja la anterior con su
--    motivo y quién la tocó.

-- ── Dónde queda el taller ──────────────────────────────────────────────────
-- El geocerco es un DATO, no una constante del código: el día que se abra un
-- segundo taller no puede requerir un despliegue.
create table if not exists public.taller_sitios (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  lat double precision not null,
  lng double precision not null,
  -- 150 m por defecto: un taller con patio mide más que un punto, y el GPS de
  -- un celular barato bajo techo metálico se va fácil 50 m.
  radio_m integer not null default 150,
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);

-- ── La huella registrada de cada persona, en SU celular ───────────────────
-- Se guarda el identificador público de la credencial WebAuthn, nunca la
-- huella: la huella no sale del teléfono ni el sistema operativo la entrega.
create table if not exists public.taller_credenciales (
  id text primary key,
  usuario_id text not null,
  apodo_dispositivo text,
  llave_publica text,
  creada_en timestamptz not null default now(),
  ultimo_uso timestamptz,
  activa boolean not null default true
);
create index if not exists taller_credenciales_usuario_idx
  on public.taller_credenciales (usuario_id) where activa;

-- ── Las marcaciones ────────────────────────────────────────────────────────
create table if not exists public.taller_marcaciones (
  id uuid primary key,
  usuario_id text not null,
  tipo text not null check (tipo in ('ENTRADA', 'SALIDA')),
  marcado_en timestamptz not null,
  registrado_en timestamptz not null default now(),
  -- HUELLA = la verificó el propio teléfono. PIN = respaldo cuando el lector
  -- falla o el celular no tiene. MANUAL = la escribió administración después.
  metodo text not null default 'HUELLA' check (metodo in ('HUELLA', 'PIN', 'MANUAL')),
  credencial_id text,
  lat double precision,
  lng double precision,
  precision_m double precision,
  dentro_del_sitio boolean,
  distancia_m double precision,
  sitio_id uuid references public.taller_sitios (id),
  dispositivo text,
  nota text,
  -- La hora del teléfono venía imposible y se reemplazó por la del servidor.
  hora_corregida boolean not null default false,
  anulada boolean not null default false,
  anulada_por text,
  anulada_en timestamptz,
  motivo text
);
create index if not exists taller_marcaciones_usuario_dia_idx
  on public.taller_marcaciones (usuario_id, marcado_en desc) where not anulada;
create index if not exists taller_marcaciones_rango_idx
  on public.taller_marcaciones (marcado_en desc) where not anulada;

-- ── La configuración de la jornada ─────────────────────────────────────────
-- 🔴 Las horas de la noche y el tope de la jornada NO se queman en el código.
-- La Ley 2466 de 2025 corrió el arranque del nocturno de las 9 p.m. a las
-- 7 p.m. desde el 25-dic-2025, y la Ley 2101 bajó la semana a 42 horas desde
-- el 15-jul-2026. Ya cambiaron dos veces en dos años: la próxima tiene que ser
-- editar una fila, no desplegar una versión.
create table if not exists public.taller_config (
  id boolean primary key default true check (id),
  jornada_ordinaria_diaria numeric not null default 8,
  jornada_semanal_max numeric not null default 42,
  inicio_noche text not null default '19:00',
  fin_noche text not null default '06:00',
  actualizado_en timestamptz not null default now(),
  actualizado_por text
);
insert into public.taller_config (id) values (true) on conflict (id) do nothing;

comment on column public.taller_config.inicio_noche is
  'Ley 2466 de 2025 art. 11: la jornada nocturna arranca a las 7 p.m. desde el 25-dic-2025.';
comment on column public.taller_config.jornada_semanal_max is
  'Ley 2101 de 2021: 42 horas semanales desde el 15-jul-2026.';

-- ── Permisos ───────────────────────────────────────────────────────────────
-- ⚠️ Una tabla nueva NO hereda los GRANT. Sin esto PostgREST responde
-- «permission denied» aunque la policy exista.
alter table public.taller_sitios enable row level security;
alter table public.taller_credenciales enable row level security;
alter table public.taller_marcaciones enable row level security;
alter table public.taller_config enable row level security;

do $$
begin
  if not exists (select 1 from pg_policy where polname = 'taller_sitios_sel') then
    create policy taller_sitios_sel on public.taller_sitios for select using (true);
  end if;
  if not exists (select 1 from pg_policy where polname = 'taller_credenciales_sel') then
    create policy taller_credenciales_sel on public.taller_credenciales for select using (true);
  end if;
  if not exists (select 1 from pg_policy where polname = 'taller_marcaciones_sel') then
    create policy taller_marcaciones_sel on public.taller_marcaciones for select using (true);
  end if;
  if not exists (select 1 from pg_policy where polname = 'taller_config_sel') then
    create policy taller_config_sel on public.taller_config for select using (true);
  end if;
end $$;

-- 🔴 Solo LECTURA al cliente. Todo lo que escribe pasa por las funciones de
-- abajo, que son las que acotan la hora y dejan el rastro. Con `insert` suelto,
-- cualquiera con el anon_key se regala una jornada.
grant select on public.taller_sitios, public.taller_credenciales,
                public.taller_marcaciones, public.taller_config
  to anon, authenticated;

-- ── Registrar la huella de un celular ──────────────────────────────────────
create or replace function public.taller_registrar_credencial(
  p_credencial_id text,
  p_usuario_id text,
  p_apodo text default null,
  p_llave_publica text default null
) returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  insert into public.taller_credenciales (id, usuario_id, apodo_dispositivo, llave_publica)
  values (p_credencial_id, p_usuario_id, p_apodo, p_llave_publica)
  on conflict (id) do update
    set usuario_id = excluded.usuario_id,
        apodo_dispositivo = coalesce(excluded.apodo_dispositivo, taller_credenciales.apodo_dispositivo),
        activa = true;
end $$;

-- ── Marcar entrada o salida ────────────────────────────────────────────────
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
  p_nota text default null
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
begin
  -- Idempotencia: la cola offline reintenta y no puede duplicar la jornada.
  select * into v_previa from public.taller_marcaciones where id = p_id;
  if found then
    return jsonb_build_object('ok', true, 'repetida', true, 'id', v_previa.id,
                              'marcado_en', v_previa.marcado_en);
  end if;

  -- La hora del teléfono se acepta, pero acotada. Del futuro nunca; de hace
  -- más de dos días tampoco (eso ya no es «subió tarde», es un reloj movido).
  v_cuando := coalesce(p_ocurrio_en, now());
  if v_cuando > now() + interval '5 minutes' or v_cuando < now() - interval '2 days' then
    v_cuando := now();
    v_corregida := true;
  end if;

  -- ¿Estaba en el taller? Fórmula del semiverseno, suficiente a esta escala.
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

  insert into public.taller_marcaciones (
    id, usuario_id, tipo, marcado_en, metodo, credencial_id,
    lat, lng, precision_m, dentro_del_sitio, distancia_m, dispositivo, nota, hora_corregida)
  values (
    p_id, p_usuario_id, upper(p_tipo), v_cuando, upper(p_metodo), p_credencial_id,
    p_lat, p_lng, p_precision_m, v_dentro, round(v_mejor::numeric, 1), p_dispositivo,
    p_nota, v_corregida);

  if p_credencial_id is not null then
    update public.taller_credenciales set ultimo_uso = now() where id = p_credencial_id;
  end if;

  return jsonb_build_object('ok', true, 'repetida', false, 'id', p_id,
                            'marcado_en', v_cuando, 'hora_corregida', v_corregida,
                            'dentro_del_sitio', v_dentro, 'distancia_m', round(v_mejor::numeric, 1));
end $$;

-- ── Corregir o anular, dejando rastro ──────────────────────────────────────
-- 🔴 No se borra. Una marcación equivocada que desaparece deja un reporte
-- cuadrado sin forma de auditar quién lo cuadró.
create or replace function public.taller_anular_marcacion(
  p_id uuid, p_quien text, p_motivo text
) returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  update public.taller_marcaciones
     set anulada = true, anulada_por = p_quien, anulada_en = now(), motivo = p_motivo
   where id = p_id and not anulada;
end $$;

create or replace function public.taller_guardar_config(
  p_diaria numeric, p_semanal numeric, p_inicio_noche text, p_fin_noche text, p_quien text
) returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  update public.taller_config
     set jornada_ordinaria_diaria = p_diaria,
         jornada_semanal_max = p_semanal,
         inicio_noche = p_inicio_noche,
         fin_noche = p_fin_noche,
         actualizado_en = now(),
         actualizado_por = p_quien
   where id;
end $$;

grant execute on function public.taller_registrar_credencial(text, text, text, text) to anon, authenticated;
grant execute on function public.taller_marcar(uuid, text, text, timestamptz, text, text, double precision, double precision, double precision, text, text) to anon, authenticated;
grant execute on function public.taller_anular_marcacion(uuid, text, text) to anon, authenticated;
grant execute on function public.taller_guardar_config(numeric, numeric, text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
