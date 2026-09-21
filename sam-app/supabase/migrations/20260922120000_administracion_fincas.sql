-- ============================================================================
-- ADMINISTRACIÓN DE FINCAS DE CAÑA — MVP (22-sep-2026)
--
-- ASM administra fincas de caña de terceros y el dueño de la tierra debe ver lo
-- mismo que ve ASM (propuesta «Finca a la vista»). Módulo dentro de la app de ASM
-- con su propio Inicio, al lado del de la maquinaria.
--
-- Modelo: finca → suerte → ciclo (de corte a corte) → labores del ciclo (plan con
-- presupuesto y ventana de oportunidad) → reportes de campo (foto + GPS + hora del
-- servidor) → aceptación por OTRA persona → gasto en la cuenta del dueño.
--
-- 🔴 Reglas que hace cumplir la BASE, no la pantalla:
--   · Sin foto no hay reporte. La hora es la del servidor (created_at).
--   · Nadie acepta su propio reporte (af_revisar).
--   · Lo reportado de una labor en hectáreas no pasa del área de la suerte (+2 %).
--   · Aceptar crea el gasto en la cuenta, una sola vez (reporte_id único).
--   · Nada se borra: no hay DELETE para la app. Un movimiento se ANULA con motivo.
--   · Todo cambio queda en af_auditoria.
--
-- ⚠️ Límite conocido (igual que el resto de SAM): la app entra con la llave
-- anónima y el usuario lo dice el celular (`p_usuario`, `editado_por`). Para dar
-- acceso DIRECTO al dueño de la tierra hace falta primero autenticación real.
-- ============================================================================

create extension if not exists pgcrypto;

-- ── Fincas ────────────────────────────────────────────────────────────────
create table if not exists public.af_fincas (
  id              uuid primary key default gen_random_uuid(),
  nombre          text not null check (btrim(nombre) <> ''),
  dueno_nombre    text not null check (btrim(dueno_nombre) <> ''),
  dueno_telefono  text,
  dueno_correo    text,
  ingenio_id      text,
  municipio       text,
  honorario_modo  text not null default 'POR_DEFINIR'
                  check (honorario_modo in ('POR_DEFINIR', 'PORCENTAJE', 'FIJO_HA_MES')),
  honorario_valor numeric,
  nota            text,
  activa          boolean not null default true,
  editado_por     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ── Suertes de la finca ───────────────────────────────────────────────────
create table if not exists public.af_suertes (
  id          uuid primary key default gen_random_uuid(),
  finca_id    uuid not null references public.af_fincas(id),
  codigo      text not null check (btrim(codigo) <> ''),
  area_ha     numeric not null check (area_ha > 0),
  variedad    text,
  activa      boolean not null default true,
  editado_por text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (finca_id, codigo)
);

-- ── Ciclos: de corte a corte ──────────────────────────────────────────────
create table if not exists public.af_ciclos (
  id           uuid primary key default gen_random_uuid(),
  suerte_id    uuid not null references public.af_suertes(id),
  fecha_corte  date not null,
  tipo         text not null default 'SOCA' check (tipo in ('SOCA', 'PLANTILLA')),
  estado       text not null default 'ABIERTO' check (estado in ('ABIERTO', 'CERRADO')),
  fecha_cierre date,
  editado_por  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
-- Un solo ciclo abierto por suerte.
create unique index if not exists af_ciclos_uno_abierto on public.af_ciclos (suerte_id) where estado = 'ABIERTO';

-- ── Paquete de labores: la plantilla con la que nace cada ciclo ───────────
create table if not exists public.af_paquete (
  id                 uuid primary key default gen_random_uuid(),
  labor              text not null check (btrim(labor) <> ''),
  unidad             text not null default 'ha',
  cantidad_por_ha    numeric not null default 1 check (cantidad_por_ha > 0),
  costo_unitario     numeric not null default 0 check (costo_unitario >= 0),
  -- Oportunidad en días desde el corte (o desde la siembra en plantilla):
  -- hasta `ventana_ideal` = ideal, hasta `ventana_normal` = normal, más = tardía.
  ventana_ideal      int,
  ventana_normal     int,
  aplica             text not null default 'AMBOS' check (aplica in ('SOCA', 'PLANTILLA', 'AMBOS')),
  orden              int not null default 100,
  activa             boolean not null default true,
  editado_por        text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (ventana_normal is null or ventana_ideal is null or ventana_normal >= ventana_ideal)
);

-- ── Labores del ciclo: el plan, con su presupuesto ────────────────────────
create table if not exists public.af_labores (
  id                   uuid primary key default gen_random_uuid(),
  ciclo_id             uuid not null references public.af_ciclos(id),
  labor                text not null check (btrim(labor) <> ''),
  unidad               text not null default 'ha',
  cantidad_plan        numeric not null check (cantidad_plan > 0),
  costo_unitario_plan  numeric not null default 0 check (costo_unitario_plan >= 0),
  ventana_ideal        int,
  ventana_normal       int,
  estado               text not null default 'PROGRAMADA'
                       check (estado in ('PROGRAMADA', 'EN_CURSO', 'TERMINADA', 'ANULADA')),
  anulada_motivo       text,
  orden                int not null default 100,
  editado_por          text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check (estado <> 'ANULADA' or btrim(coalesce(anulada_motivo, '')) <> '')
);

-- ── Reportes de campo: lo hecho, con prueba ───────────────────────────────
create table if not exists public.af_reportes (
  id              uuid primary key,  -- lo pone el celular: reintentar no duplica
  labor_id        uuid not null references public.af_labores(id),
  cantidad        numeric not null check (cantidad > 0),
  fecha           date not null,     -- el día que se hizo en campo
  foto_url        text not null check (btrim(foto_url) <> ''),
  lat             double precision,
  lng             double precision,
  precision_m     numeric,
  nota            text,
  reportado_por   text not null,
  estado          text not null default 'PENDIENTE' check (estado in ('PENDIENTE', 'ACEPTADO', 'RECHAZADO')),
  revisado_por    text,
  revisado_en     timestamptz,
  motivo_rechazo  text,
  costo_unitario  numeric,
  created_at      timestamptz not null default now(),  -- hora del SERVIDOR
  updated_at      timestamptz not null default now(),
  check (estado <> 'RECHAZADO' or btrim(coalesce(motivo_rechazo, '')) <> ''),
  check (revisado_por is null or revisado_por <> reportado_por)
);

-- ── Cuenta del dueño ──────────────────────────────────────────────────────
create table if not exists public.af_movimientos (
  id              uuid primary key default gen_random_uuid(),
  finca_id        uuid not null references public.af_fincas(id),
  tipo            text not null check (tipo in ('ANTICIPO', 'GASTO', 'HONORARIO')),
  fecha           date not null,
  concepto        text not null check (btrim(concepto) <> ''),
  suerte_id       uuid references public.af_suertes(id),
  labor_id        uuid references public.af_labores(id),
  reporte_id      uuid unique references public.af_reportes(id),
  cantidad        numeric,
  unidad          text,
  valor_unitario  numeric,
  valor           numeric not null check (valor > 0),
  soporte_url     text,
  registrado_por  text not null,
  anulado         boolean not null default false,
  anulado_por     text,
  anulado_motivo  text,
  anulado_en      timestamptz,
  created_at      timestamptz not null default now(),
  -- Cada peso de gasto con su soporte: la foto de la labor o la factura.
  check (tipo <> 'GASTO' or btrim(coalesce(soporte_url, '')) <> ''),
  check (not anulado or btrim(coalesce(anulado_motivo, '')) <> '')
);

-- ── Auditoría: todo cambio, con quién ─────────────────────────────────────
create table if not exists public.af_auditoria (
  id           bigserial primary key,
  tabla        text not null,
  registro_id  text not null,
  accion       text not null,
  cambios      jsonb,
  hecho_por    text,
  hecho_en     timestamptz not null default now()
);

create index if not exists af_suertes_finca on public.af_suertes (finca_id);
create index if not exists af_ciclos_suerte on public.af_ciclos (suerte_id);
create index if not exists af_labores_ciclo on public.af_labores (ciclo_id);
create index if not exists af_reportes_labor on public.af_reportes (labor_id);
create index if not exists af_reportes_estado on public.af_reportes (estado);
create index if not exists af_movimientos_finca on public.af_movimientos (finca_id);
create index if not exists af_auditoria_registro on public.af_auditoria (tabla, registro_id);

-- ── updated_at en cada cambio real ────────────────────────────────────────
create or replace function public.af_tocar_updated_at() returns trigger
language plpgsql set search_path = public, pg_catalog as $$
begin
  if NEW is distinct from OLD then NEW.updated_at := now(); end if;
  return NEW;
end $$;

-- ── Auditoría genérica ────────────────────────────────────────────────────
create or replace function public.af_auditar() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_nuevo jsonb := case when TG_OP = 'DELETE' then null else to_jsonb(NEW) end;
  v_viejo jsonb := case when TG_OP = 'INSERT' then null else to_jsonb(OLD) end;
  v_cambios jsonb := '{}'::jsonb;
  v_llave text;
  v_quien text;
begin
  if TG_OP = 'UPDATE' then
    for v_llave in select jsonb_object_keys(v_nuevo) loop
      if v_llave not in ('updated_at') and (v_nuevo -> v_llave) is distinct from (v_viejo -> v_llave) then
        v_cambios := v_cambios || jsonb_build_object(v_llave, jsonb_build_array(v_viejo -> v_llave, v_nuevo -> v_llave));
      end if;
    end loop;
    if v_cambios = '{}'::jsonb then return NEW; end if;
  elsif TG_OP = 'INSERT' then
    v_cambios := v_nuevo;
  else
    v_cambios := v_viejo;
  end if;
  v_quien := coalesce(
    v_nuevo ->> 'revisado_por', v_nuevo ->> 'anulado_por', v_nuevo ->> 'editado_por',
    v_nuevo ->> 'registrado_por', v_nuevo ->> 'reportado_por',
    v_viejo ->> 'editado_por');
  insert into public.af_auditoria (tabla, registro_id, accion, cambios, hecho_por)
  values (TG_TABLE_NAME, coalesce(v_nuevo ->> 'id', v_viejo ->> 'id'), TG_OP, v_cambios, v_quien);
  return case when TG_OP = 'DELETE' then OLD else NEW end;
end $$;

do $$
declare t text;
begin
  foreach t in array array['af_fincas','af_suertes','af_ciclos','af_paquete','af_labores','af_reportes','af_movimientos'] loop
    execute format('drop trigger if exists trg_%1$s_auditar on public.%1$s', t);
    execute format('create trigger trg_%1$s_auditar after insert or update or delete on public.%1$s for each row execute function public.af_auditar()', t);
    if t <> 'af_movimientos' then
      execute format('drop trigger if exists trg_%1$s_updated on public.%1$s', t);
      execute format('create trigger trg_%1$s_updated before update on public.%1$s for each row execute function public.af_tocar_updated_at()', t);
    end if;
  end loop;
end $$;

-- Un movimiento no se edita: solo se anula (y una vez anulado, queda así).
create or replace function public.af_movimiento_inmutable() returns trigger
language plpgsql set search_path = public, pg_catalog as $$
begin
  if OLD.anulado then raise exception 'MOVIMIENTO_ANULADO: ya estaba anulado' using errcode = 'check_violation'; end if;
  if (to_jsonb(NEW) - array['anulado','anulado_por','anulado_motivo','anulado_en'])
     is distinct from (to_jsonb(OLD) - array['anulado','anulado_por','anulado_motivo','anulado_en']) then
    raise exception 'MOVIMIENTO_INMUTABLE: un movimiento no se edita; se anula y se registra otro' using errcode = 'check_violation';
  end if;
  return NEW;
end $$;
drop trigger if exists trg_af_movimientos_inmutable on public.af_movimientos;
create trigger trg_af_movimientos_inmutable before update on public.af_movimientos
  for each row execute function public.af_movimiento_inmutable();

-- ── Quién puede qué (por el rol en app_usuarios) ──────────────────────────
create or replace function public.af_rol(p_usuario text) returns text
language sql stable security definer set search_path = public, pg_catalog as $$
  select rol::text from public.app_usuarios where id = p_usuario
$$;

-- ── Guardias: lo que la app puede escribir directo, y quién ───────────────
-- Las funciones de abajo marcan la transacción con `af.via_funcion`: lo que ellas
-- hacen (poner EN_CURSO / TERMINADA, crear el gasto al aceptar) ya pasó por sus
-- propias reglas. Lo que llega DIRECTO de la app se revisa aquí.
create or replace function public.af_via_funcion() returns boolean
language sql stable set search_path = public, pg_catalog as $$
  select coalesce(current_setting('af.via_funcion', true), '') = '1'
$$;

-- Fincas, suertes y paquete: solo administración los crea o cambia.
create or replace function public.af_guardia_config() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if public.af_via_funcion() then return NEW; end if;
  if coalesce(public.af_rol(NEW.editado_por), '') not in ('owner', 'administracion') then
    raise exception 'SIN_PERMISO: solo administración cambia fincas, suertes y el paquete de labores'
      using errcode = 'insufficient_privilege';
  end if;
  return NEW;
end $$;

-- Labores del ciclo: el ESTADO no se toca a mano (sale de reportar y aceptar),
-- salvo ANULAR con motivo; el presupuesto solo lo cambia administración.
create or replace function public.af_guardia_labor() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_admin boolean := coalesce(public.af_rol(NEW.editado_por), '') in ('owner', 'administracion');
begin
  if public.af_via_funcion() then return NEW; end if;
  if not v_admin then
    raise exception 'SIN_PERMISO: solo administración cambia el plan de labores' using errcode = 'insufficient_privilege';
  end if;
  if TG_OP = 'INSERT' then
    if NEW.estado <> 'PROGRAMADA' then
      raise exception 'ESTADO_POR_FUNCION: una labor nueva nace PROGRAMADA' using errcode = 'check_violation';
    end if;
    return NEW;
  end if;
  if NEW.ciclo_id is distinct from OLD.ciclo_id then
    raise exception 'LABOR_DE_OTRO_CICLO: una labor no se cambia de ciclo' using errcode = 'check_violation';
  end if;
  if NEW.estado is distinct from OLD.estado and NEW.estado <> 'ANULADA' then
    raise exception 'ESTADO_POR_FUNCION: el avance sale de reportar y aceptar, no se marca a mano'
      using errcode = 'check_violation';
  end if;
  if OLD.estado = 'ANULADA' and NEW.estado = 'ANULADA' and NEW is distinct from OLD then
    raise exception 'LABOR_ANULADA: ya estaba anulada' using errcode = 'check_violation';
  end if;
  return NEW;
end $$;

-- Movimientos que entran a mano: solo administración, y nunca amarrados a un
-- reporte (esos los crea la aceptación) ni ya anulados.
create or replace function public.af_guardia_movimiento() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if public.af_via_funcion() then return NEW; end if;
  if coalesce(public.af_rol(NEW.registrado_por), '') not in ('owner', 'administracion') then
    raise exception 'SIN_PERMISO: solo administración registra anticipos y gastos' using errcode = 'insufficient_privilege';
  end if;
  if NEW.reporte_id is not null or NEW.anulado then
    raise exception 'MOVIMIENTO_INVALIDO: el gasto de una labor lo crea la aceptación' using errcode = 'check_violation';
  end if;
  return NEW;
end $$;

drop trigger if exists trg_af_fincas_guardia on public.af_fincas;
create trigger trg_af_fincas_guardia before insert or update on public.af_fincas
  for each row execute function public.af_guardia_config();
drop trigger if exists trg_af_suertes_guardia on public.af_suertes;
create trigger trg_af_suertes_guardia before insert or update on public.af_suertes
  for each row execute function public.af_guardia_config();
drop trigger if exists trg_af_paquete_guardia on public.af_paquete;
create trigger trg_af_paquete_guardia before insert or update on public.af_paquete
  for each row execute function public.af_guardia_config();
drop trigger if exists trg_af_labores_guardia on public.af_labores;
create trigger trg_af_labores_guardia before insert or update on public.af_labores
  for each row execute function public.af_guardia_labor();
drop trigger if exists trg_af_movimientos_guardia on public.af_movimientos;
create trigger trg_af_movimientos_guardia before insert on public.af_movimientos
  for each row execute function public.af_guardia_movimiento();

-- ── Abrir un ciclo: cierra el anterior y carga el paquete ─────────────────
create or replace function public.af_abrir_ciclo(
  p_suerte uuid, p_fecha_corte date, p_tipo text, p_usuario text
) returns uuid
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_area numeric;
  v_ciclo uuid;
  v_hoy date := (now() at time zone 'America/Bogota')::date;
begin
  if coalesce(public.af_rol(p_usuario), '') not in ('owner', 'administracion') then
    raise exception 'SIN_PERMISO: solo administración abre ciclos' using errcode = 'insufficient_privilege';
  end if;
  perform set_config('af.via_funcion', '1', true);
  if p_fecha_corte > v_hoy then
    raise exception 'FECHA_FUTURA: el corte no puede ser después de hoy' using errcode = 'check_violation';
  end if;
  select area_ha into v_area from public.af_suertes where id = p_suerte and activa;
  if v_area is null then raise exception 'SUERTE_NO_EXISTE' using errcode = 'no_data_found'; end if;

  update public.af_ciclos set estado = 'CERRADO', fecha_cierre = p_fecha_corte, editado_por = p_usuario
   where suerte_id = p_suerte and estado = 'ABIERTO';

  insert into public.af_ciclos (suerte_id, fecha_corte, tipo, editado_por)
  values (p_suerte, p_fecha_corte, coalesce(nullif(p_tipo, ''), 'SOCA'), p_usuario)
  returning id into v_ciclo;

  insert into public.af_labores (ciclo_id, labor, unidad, cantidad_plan, costo_unitario_plan,
                                 ventana_ideal, ventana_normal, orden, editado_por)
  select v_ciclo, p.labor, p.unidad, round(v_area * p.cantidad_por_ha, 2), p.costo_unitario,
         p.ventana_ideal, p.ventana_normal, p.orden, p_usuario
    from public.af_paquete p
   where p.activa and (p.aplica = 'AMBOS' or p.aplica = coalesce(nullif(p_tipo, ''), 'SOCA'));

  return v_ciclo;
end $$;

-- ── Reportar desde el campo ───────────────────────────────────────────────
create or replace function public.af_reportar(
  p_id uuid, p_labor uuid, p_cantidad numeric, p_fecha date, p_foto text,
  p_lat double precision, p_lng double precision, p_precision numeric,
  p_nota text, p_usuario text
) returns uuid
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_l record;
  v_hoy date := (now() at time zone 'America/Bogota')::date;
  v_ya numeric;
begin
  -- Reintentar el mismo reporte (misma id) no duplica.
  if exists (select 1 from public.af_reportes where id = p_id) then return p_id; end if;
  perform set_config('af.via_funcion', '1', true);

  if coalesce(public.af_rol(p_usuario), '') not in ('owner', 'administracion', 'supervisor') then
    raise exception 'SIN_PERMISO: este usuario no reporta labores de fincas' using errcode = 'insufficient_privilege';
  end if;
  select l.*, c.fecha_corte, c.estado as ciclo_estado, s.area_ha
    into v_l
    from public.af_labores l join public.af_ciclos c on c.id = l.ciclo_id join public.af_suertes s on s.id = c.suerte_id
   where l.id = p_labor;
  if v_l.id is null then raise exception 'LABOR_NO_EXISTE' using errcode = 'no_data_found'; end if;
  if v_l.ciclo_estado <> 'ABIERTO' then raise exception 'CICLO_CERRADO: el ciclo de esa suerte ya se cerró' using errcode = 'check_violation'; end if;
  if v_l.estado in ('ANULADA', 'TERMINADA') then raise exception 'LABOR_CERRADA: esa labor ya está %', lower(v_l.estado) using errcode = 'check_violation'; end if;
  if btrim(coalesce(p_foto, '')) = '' then raise exception 'SIN_FOTO: sin foto no hay reporte' using errcode = 'check_violation'; end if;
  if p_cantidad is null or p_cantidad <= 0 then raise exception 'CANTIDAD: debe ser mayor que cero' using errcode = 'check_violation'; end if;
  if p_fecha > v_hoy then raise exception 'FECHA_FUTURA: no se puede reportar un día que no ha llegado' using errcode = 'check_violation'; end if;
  if p_fecha < v_l.fecha_corte then raise exception 'FECHA_ANTES_DEL_CORTE: la labor no puede ser anterior al corte (%)', v_l.fecha_corte using errcode = 'check_violation'; end if;

  -- En hectáreas, lo reportado (aceptado + por aceptar) no pasa del área de la suerte.
  if lower(v_l.unidad) = 'ha' then
    select coalesce(sum(cantidad), 0) into v_ya from public.af_reportes
     where labor_id = p_labor and estado in ('PENDIENTE', 'ACEPTADO');
    if v_ya + p_cantidad > v_l.area_ha * 1.02 then
      raise exception 'SUPERA_AREA: con este reporte serían % ha en una suerte de % ha', round(v_ya + p_cantidad, 2), v_l.area_ha
        using errcode = 'check_violation';
    end if;
  end if;

  insert into public.af_reportes (id, labor_id, cantidad, fecha, foto_url, lat, lng, precision_m, nota, reportado_por)
  values (p_id, p_labor, p_cantidad, p_fecha, p_foto, p_lat, p_lng, p_precision, nullif(btrim(coalesce(p_nota, '')), ''), p_usuario);

  update public.af_labores set estado = 'EN_CURSO', editado_por = p_usuario
   where id = p_labor and estado = 'PROGRAMADA';
  return p_id;
end $$;

-- ── Aceptar o rechazar (nunca el propio) ──────────────────────────────────
create or replace function public.af_revisar(
  p_reporte uuid, p_aceptar boolean, p_motivo text, p_usuario text
) returns text
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_r record;
  v_aceptado numeric;
begin
  perform set_config('af.via_funcion', '1', true);
  if coalesce(public.af_rol(p_usuario), '') not in ('owner', 'administracion', 'supervisor') then
    raise exception 'SIN_PERMISO: este usuario no acepta labores' using errcode = 'insufficient_privilege';
  end if;
  select r.*, l.labor, l.unidad, l.costo_unitario_plan, l.cantidad_plan, c.suerte_id, s.finca_id, s.codigo as suerte
    into v_r
    from public.af_reportes r
    join public.af_labores l on l.id = r.labor_id
    join public.af_ciclos c on c.id = l.ciclo_id
    join public.af_suertes s on s.id = c.suerte_id
   where r.id = p_reporte
   for update of r;
  if v_r.id is null then raise exception 'REPORTE_NO_EXISTE' using errcode = 'no_data_found'; end if;
  if v_r.estado <> 'PENDIENTE' then raise exception 'YA_REVISADO: ese reporte ya está %', lower(v_r.estado) using errcode = 'check_violation'; end if;
  if v_r.reportado_por = p_usuario then
    raise exception 'NO_PROPIO: nadie acepta su propio reporte' using errcode = 'check_violation';
  end if;

  if not p_aceptar then
    if btrim(coalesce(p_motivo, '')) = '' then raise exception 'MOTIVO: para rechazar hay que decir por qué' using errcode = 'check_violation'; end if;
    update public.af_reportes set estado = 'RECHAZADO', revisado_por = p_usuario, revisado_en = now(), motivo_rechazo = btrim(p_motivo)
     where id = p_reporte;
    return 'RECHAZADO';
  end if;

  update public.af_reportes set estado = 'ACEPTADO', revisado_por = p_usuario, revisado_en = now(),
         costo_unitario = v_r.costo_unitario_plan
   where id = p_reporte;

  -- El gasto entra a la cuenta del dueño, con la foto como soporte. Una sola vez.
  if v_r.costo_unitario_plan > 0 then
    insert into public.af_movimientos (finca_id, tipo, fecha, concepto, suerte_id, labor_id, reporte_id,
                                       cantidad, unidad, valor_unitario, valor, soporte_url, registrado_por)
    values (v_r.finca_id, 'GASTO', v_r.fecha, v_r.labor || ' · suerte ' || v_r.suerte, v_r.suerte_id, v_r.labor_id, v_r.id,
            v_r.cantidad, v_r.unidad, v_r.costo_unitario_plan, round(v_r.cantidad * v_r.costo_unitario_plan, 2),
            v_r.foto_url, p_usuario)
    on conflict (reporte_id) do nothing;
  end if;

  select coalesce(sum(cantidad), 0) into v_aceptado from public.af_reportes
   where labor_id = v_r.labor_id and estado = 'ACEPTADO';
  update public.af_labores
     set estado = case when v_aceptado >= cantidad_plan * 0.98 then 'TERMINADA' else 'EN_CURSO' end,
         editado_por = p_usuario
   where id = v_r.labor_id and estado <> 'ANULADA';
  return 'ACEPTADO';
end $$;

-- ── Anular un movimiento (nunca borrarlo) ─────────────────────────────────
create or replace function public.af_anular_movimiento(p_id uuid, p_motivo text, p_usuario text) returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if coalesce(public.af_rol(p_usuario), '') not in ('owner', 'administracion') then
    raise exception 'SIN_PERMISO: solo administración anula movimientos' using errcode = 'insufficient_privilege';
  end if;
  perform set_config('af.via_funcion', '1', true);
  if btrim(coalesce(p_motivo, '')) = '' then raise exception 'MOTIVO: para anular hay que decir por qué' using errcode = 'check_violation'; end if;
  update public.af_movimientos
     set anulado = true, anulado_por = p_usuario, anulado_motivo = btrim(p_motivo), anulado_en = now()
   where id = p_id;
  if not found then raise exception 'MOVIMIENTO_NO_EXISTE' using errcode = 'no_data_found'; end if;
end $$;

-- ── Permisos: la app lee todo lo del módulo; escribe poco y sin borrar ────
do $$
declare t text;
begin
  foreach t in array array['af_fincas','af_suertes','af_ciclos','af_paquete','af_labores','af_reportes','af_movimientos','af_auditoria'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policy where polname = t || '_sel') then
      execute format('create policy %I on public.%I for select using (true)', t || '_sel', t);
    end if;
  end loop;
  foreach t in array array['af_fincas','af_suertes','af_paquete','af_labores','af_movimientos'] loop
    if not exists (select 1 from pg_policy where polname = t || '_ins') then
      execute format('create policy %I on public.%I for insert with check (true)', t || '_ins', t);
    end if;
  end loop;
  foreach t in array array['af_fincas','af_suertes','af_paquete','af_labores'] loop
    if not exists (select 1 from pg_policy where polname = t || '_upd') then
      execute format('create policy %I on public.%I for update using (true) with check (true)', t || '_upd', t);
    end if;
  end loop;
end $$;

revoke all on public.af_fincas, public.af_suertes, public.af_ciclos, public.af_paquete, public.af_labores,
              public.af_reportes, public.af_movimientos, public.af_auditoria from anon, authenticated;
grant select on public.af_fincas, public.af_suertes, public.af_ciclos, public.af_paquete, public.af_labores,
               public.af_reportes, public.af_movimientos, public.af_auditoria to anon, authenticated;
grant insert, update on public.af_fincas, public.af_suertes, public.af_paquete, public.af_labores to anon, authenticated;
-- Movimientos: solo INSERTAR (anticipos, gastos con soporte). Anular va por función.
grant insert on public.af_movimientos to anon, authenticated;
-- Ciclos y reportes: SOLO por las funciones de arriba.
grant execute on function public.af_abrir_ciclo(uuid, date, text, text),
                          public.af_reportar(uuid, uuid, numeric, date, text, double precision, double precision, numeric, text, text),
                          public.af_revisar(uuid, boolean, text, text),
                          public.af_anular_movimiento(uuid, text, text)
  to anon, authenticated;

-- ── Paquete inicial ───────────────────────────────────────────────────────
-- Ventanas documentadas en campo (días desde el corte; en plantilla, desde la
-- siembra). Las demás labores arrancan SIN ventana: no se inventa. Los costos
-- arrancan en 0 y los pone administración antes de abrir el primer ciclo.
select set_config('af.via_funcion', '1', true);  -- la carga inicial la hace la migración
insert into public.af_paquete (labor, unidad, ventana_ideal, ventana_normal, aplica, orden)
select * from (values
  ('ROTURACIÓN',            'ha', 16, 30, 'SOCA',      10),
  ('FERTILIZACIÓN',         'ha', 45, 60, 'SOCA',      20),
  ('FERTILIZACIÓN',         'ha', 60, 90, 'PLANTILLA', 20),
  ('CONTROL DE MALEZAS',    'ha', null::int, null::int, 'AMBOS', 30),
  ('RIEGO',                 'ha', null::int, null::int, 'AMBOS', 40)
) as v(labor, unidad, ventana_ideal, ventana_normal, aplica, orden)
where not exists (select 1 from public.af_paquete);
select set_config('af.via_funcion', '', true);  -- y se apaga: lo que siga en esta transacción pasa por las guardias
