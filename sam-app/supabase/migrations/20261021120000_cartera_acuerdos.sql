-- ============================================================================
-- 20261021120000 — ACUERDOS DE PAGO con proveedores / colonos (21-oct-2026)
--
-- Pedido de Iván: Cristian negocia con los proveedores (colonos) plazos de pago
-- de 2-3 meses y anticipos de un porcentaje de la labor; Carlos David los registra.
-- Regla (Iván, 21-oct): «El anticipo se descuenta de la factura final».
--
--   · fact_acuerdos ........ con quién (colono), sus haciendas, quién negoció, cuándo.
--   · fact_acuerdo_cuotas .. el plan de pagos: el ANTICIPO (orden 0) y las cuotas.
--   · Los pagos del acuerdo van a fact_pagos con acuerdo_id:
--       - Si el acuerdo todavía no tiene factura, el pago queda como ANTICIPO
--         (factura_id vacío, anticipo = true).
--       - Cuando la factura final se liga al acuerdo, sus anticipos PASAN a esa
--         factura: cuentan como pagado y el saldo de la factura baja. Se cuenta una
--         sola vez (en la factura), así Cartera no suma dos veces.
--       - Un pago del acuerdo que llega cuando ya hay factura va a la factura del
--         acuerdo que tenga saldo (la más vieja).
--       - Un pago registrado en la factura cuenta también para las cuotas.
--   · Las cuotas se cubren en orden con lo pagado al acuerdo (anticipo primero);
--     la pantalla calcula cuál está pagada, cuál vence pronto y cuál está vencida.
--
-- Reemplaza el «acuerdo» de una sola fecha que se guardaba como texto en
-- fact_documentos.nota (OpenClaw, 18-oct): no había ninguno guardado.
-- Escribir acuerdos va SOLO por funciones de la base que revisan el rol (las
-- tablas nuevas solo se leen desde la app).
-- ============================================================================

create table if not exists public.fact_acuerdos (
  id             uuid primary key default gen_random_uuid(),
  colono         text not null check (btrim(colono) <> ''),
  telefono       text,
  -- Nombres de las haciendas del colono que cubre el acuerdo (como en asignaciones.nombre_hacienda).
  haciendas      text[] not null default '{}',
  fecha          date not null,
  negociado_por  text not null check (btrim(negociado_por) <> ''),
  condiciones    text,
  anulado        boolean not null default false,
  anulado_por    text,
  anulado_motivo text,
  creado_por     text not null,
  editado_por    text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
comment on table public.fact_acuerdos is
  'Acuerdos de pago con proveedores/colonos (los negocia Cristian, los registra administración). Ver fact_acuerdo_cuotas.';

create table if not exists public.fact_acuerdo_cuotas (
  id         uuid primary key default gen_random_uuid(),
  acuerdo_id uuid not null references public.fact_acuerdos(id) on delete cascade,
  orden      integer not null check (orden >= 0),
  anticipo   boolean not null default false,
  vence      date not null,
  valor      numeric(16, 2) not null check (valor > 0),
  unique (acuerdo_id, orden)
);
create index if not exists fact_acuerdo_cuotas_acuerdo_idx on public.fact_acuerdo_cuotas (acuerdo_id);

alter table public.fact_documentos add column if not exists acuerdo_id uuid references public.fact_acuerdos(id);
create index if not exists fact_documentos_acuerdo_idx on public.fact_documentos (acuerdo_id) where acuerdo_id is not null;
comment on column public.fact_documentos.acuerdo_id is 'FACTURA: el acuerdo de pago al que pertenece (sus anticipos se descuentan de ella).';

alter table public.fact_pagos add column if not exists acuerdo_id uuid references public.fact_acuerdos(id);
alter table public.fact_pagos add column if not exists anticipo boolean not null default false;
alter table public.fact_pagos alter column factura_id drop not null;
alter table public.fact_pagos drop constraint if exists fact_pagos_destino;
alter table public.fact_pagos add constraint fact_pagos_destino check (factura_id is not null or acuerdo_id is not null);
create index if not exists fact_pagos_acuerdo_idx on public.fact_pagos (acuerdo_id) where not anulado;
comment on column public.fact_pagos.anticipo is 'Se pagó al acuerdo antes de tener factura: se descuenta de la factura final cuando se liga.';

alter table public.fact_acuerdos enable row level security;
alter table public.fact_acuerdo_cuotas enable row level security;
drop policy if exists fact_acuerdos_leer on public.fact_acuerdos;
create policy fact_acuerdos_leer on public.fact_acuerdos for select to anon, authenticated using (true);
drop policy if exists fact_acuerdo_cuotas_leer on public.fact_acuerdo_cuotas;
create policy fact_acuerdo_cuotas_leer on public.fact_acuerdo_cuotas for select to anon, authenticated using (true);
-- 🔴 Una tabla nueva NO hereda los grant: sin esto, «permission denied».
grant select on public.fact_acuerdos, public.fact_acuerdo_cuotas to anon, authenticated;

-- ── Guardia de pagos: factura o acuerdo ────────────────────────────────────
create or replace function public.fact_pagos_guardia() returns trigger
language plpgsql as $$
declare
  v_fact public.fact_documentos;
  v_anulado boolean;
begin
  if TG_OP = 'UPDATE' and OLD.anulado and NEW is distinct from OLD then
    raise exception 'PAGO_ANULADO: ya estaba anulado' using errcode = 'check_violation';
  end if;
  if NEW.anulado and coalesce(btrim(NEW.anulado_motivo), '') = '' then
    raise exception 'MOTIVO: para anular un pago hay que decir por qué' using errcode = 'check_violation';
  end if;

  if NEW.factura_id is not null then
    select * into v_fact from public.fact_documentos where id = NEW.factura_id;
    if v_fact.id is null or v_fact.tipo <> 'FACTURA' then
      raise exception 'NO_ES_FACTURA: el pago va contra una factura' using errcode = 'check_violation';
    end if;
    -- Un pago a la factura de un acuerdo cuenta para sus cuotas.
    if TG_OP = 'INSERT' and NEW.acuerdo_id is null then NEW.acuerdo_id := v_fact.acuerdo_id; end if;
  elsif NEW.acuerdo_id is null then
    raise exception 'SIN_DESTINO: el pago va contra una factura o un acuerdo' using errcode = 'check_violation';
  end if;

  if TG_OP = 'INSERT' and NEW.acuerdo_id is not null then
    select anulado into v_anulado from public.fact_acuerdos where id = NEW.acuerdo_id;
    if v_anulado is null then raise exception 'ACUERDO_NO_EXISTE' using errcode = 'no_data_found'; end if;
    if v_anulado then raise exception 'ACUERDO_ANULADO: ese acuerdo está anulado' using errcode = 'check_violation'; end if;
    if NEW.factura_id is null then
      -- Ya hay factura del acuerdo con saldo: el pago va a ella (la más vieja).
      select f.id into NEW.factura_id
        from public.fact_documentos f
       where f.acuerdo_id = NEW.acuerdo_id and f.tipo = 'FACTURA' and not f.anulado
         and (f.valor is null or f.valor - coalesce((select sum(p.valor) from public.fact_pagos p
                                                      where p.factura_id = f.id and not p.anulado), 0) > 0.5)
       order by f.fecha, f.created_at
       limit 1;
      -- Sin factura todavía: es un ANTICIPO (se descuenta de la factura final).
      NEW.anticipo := NEW.factura_id is null;
    end if;
  end if;
  return NEW;
end $$;

-- ── Ligar / quitar una factura de un acuerdo (o anularla) ──────────────────
create or replace function public.fact_documentos_acuerdo() returns trigger
language plpgsql as $$
declare
  v_p record;
  v_saldo numeric;
begin
  if NEW.tipo <> 'FACTURA' then return NEW; end if;

  -- Sale del acuerdo (o se anula): sus anticipos vuelven al acuerdo y los demás
  -- pagos dejan de contar para él.
  if TG_OP = 'UPDATE' and OLD.acuerdo_id is not null
     and (NEW.acuerdo_id is distinct from OLD.acuerdo_id or (NEW.anulado and not OLD.anulado)) then
    update public.fact_pagos set factura_id = null
     where factura_id = NEW.id and acuerdo_id = OLD.acuerdo_id and anticipo and not anulado;
    if NEW.acuerdo_id is distinct from OLD.acuerdo_id then
      update public.fact_pagos set acuerdo_id = NEW.acuerdo_id
       where factura_id = NEW.id and acuerdo_id = OLD.acuerdo_id and not anulado;
    end if;
  end if;

  -- Entra a un acuerdo: los anticipos que el acuerdo tiene sin factura se
  -- descuentan de ESTA factura (del más viejo al más nuevo, mientras tenga saldo).
  if NEW.acuerdo_id is not null and not NEW.anulado
     and (TG_OP = 'INSERT' or NEW.acuerdo_id is distinct from OLD.acuerdo_id or (OLD.anulado and not NEW.anulado)) then
    update public.fact_pagos set acuerdo_id = NEW.acuerdo_id
     where factura_id = NEW.id and acuerdo_id is null and not anulado;
    for v_p in
      select id from public.fact_pagos
       where acuerdo_id = NEW.acuerdo_id and factura_id is null and not anulado
       order by fecha, created_at
    loop
      if NEW.valor is not null then
        select NEW.valor - coalesce(sum(valor), 0) into v_saldo
          from public.fact_pagos where factura_id = NEW.id and not anulado;
        exit when v_saldo <= 0.5;
      end if;
      update public.fact_pagos set factura_id = NEW.id where id = v_p.id;
    end loop;
  end if;
  return NEW;
end $$;
drop trigger if exists trg_fact_documentos_acuerdo on public.fact_documentos;
create trigger trg_fact_documentos_acuerdo after insert or update of acuerdo_id, anulado on public.fact_documentos
  for each row execute function public.fact_documentos_acuerdo();

-- ── Funciones para escribir (revisan el rol, como fact_vincular) ───────────
create or replace function public.fact_puede_facturar(p_usuario text) returns boolean
language sql stable security definer set search_path = public, pg_catalog as $$
  select exists (select 1 from public.app_usuarios
                  where id = p_usuario and activo and rol::text in ('owner', 'administracion', 'analista_insumos'));
$$;

-- Crea (p_id null) o cambia un acuerdo con su plan de pagos completo.
-- p_cuotas: [{"vence":"2026-11-20","valor":2800000,"anticipo":false}, …] (a lo sumo un anticipo).
create or replace function public.fact_acuerdo_guardar(p_id uuid, p_datos jsonb, p_cuotas jsonb, p_usuario text)
returns uuid
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_id uuid := p_id;
  v_haciendas text[];
  v_c jsonb;
  v_orden integer := 0;
begin
  if not public.fact_puede_facturar(p_usuario) then
    raise exception 'SIN_PERMISO: solo administración registra acuerdos de pago' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(btrim(p_datos->>'colono'), '') = '' then
    raise exception 'COLONO: falta con quién es el acuerdo' using errcode = 'check_violation';
  end if;
  if coalesce(btrim(p_datos->>'negociado_por'), '') = '' then
    raise exception 'NEGOCIO: falta quién negoció el acuerdo' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(p_cuotas) <> 'array' or jsonb_array_length(p_cuotas) = 0 then
    raise exception 'CUOTAS: el plan de pagos necesita al menos una cuota' using errcode = 'check_violation';
  end if;
  if (select count(*) from jsonb_array_elements(p_cuotas) c where coalesce((c->>'anticipo')::boolean, false)) > 1 then
    raise exception 'ANTICIPO: un acuerdo tiene un solo anticipo' using errcode = 'check_violation';
  end if;
  if exists (select 1 from jsonb_array_elements(p_cuotas) c
              where coalesce((c->>'valor')::numeric, 0) <= 0 or (c->>'vence') is null) then
    raise exception 'CUOTAS: cada cuota necesita fecha y un valor mayor que cero' using errcode = 'check_violation';
  end if;

  select coalesce(array_agg(distinct upper(btrim(h))) filter (where btrim(h) <> ''), '{}')
    into v_haciendas
    from jsonb_array_elements_text(coalesce(p_datos->'haciendas', '[]'::jsonb)) h;

  if v_id is null then
    insert into public.fact_acuerdos (colono, telefono, haciendas, fecha, negociado_por, condiciones, creado_por)
    values (btrim(p_datos->>'colono'), nullif(btrim(p_datos->>'telefono'), ''), v_haciendas,
            coalesce((p_datos->>'fecha')::date, (now() at time zone 'America/Bogota')::date),
            btrim(p_datos->>'negociado_por'), nullif(btrim(p_datos->>'condiciones'), ''), p_usuario)
    returning id into v_id;
  else
    update public.fact_acuerdos
       set colono = btrim(p_datos->>'colono'), telefono = nullif(btrim(p_datos->>'telefono'), ''),
           haciendas = v_haciendas, fecha = coalesce((p_datos->>'fecha')::date, fecha),
           negociado_por = btrim(p_datos->>'negociado_por'), condiciones = nullif(btrim(p_datos->>'condiciones'), ''),
           editado_por = p_usuario, updated_at = now()
     where id = v_id and not anulado;
    if not found then raise exception 'ACUERDO_NO_EXISTE: no existe o está anulado' using errcode = 'no_data_found'; end if;
    delete from public.fact_acuerdo_cuotas where acuerdo_id = v_id;
  end if;

  -- El anticipo es la cuota 0; las demás, en orden de fecha.
  for v_c in
    select c from jsonb_array_elements(p_cuotas) c
     order by coalesce((c->>'anticipo')::boolean, false) desc, (c->>'vence')::date
  loop
    if coalesce((v_c->>'anticipo')::boolean, false) then
      insert into public.fact_acuerdo_cuotas (acuerdo_id, orden, anticipo, vence, valor)
      values (v_id, 0, true, (v_c->>'vence')::date, round((v_c->>'valor')::numeric, 2));
    else
      v_orden := v_orden + 1;
      insert into public.fact_acuerdo_cuotas (acuerdo_id, orden, anticipo, vence, valor)
      values (v_id, v_orden, false, (v_c->>'vence')::date, round((v_c->>'valor')::numeric, 2));
    end if;
  end loop;
  return v_id;
end $$;

-- Anular: solo si no tiene pagos vigentes (un pago no se borra; se anula primero).
create or replace function public.fact_acuerdo_anular(p_id uuid, p_motivo text, p_usuario text)
returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if not public.fact_puede_facturar(p_usuario) then
    raise exception 'SIN_PERMISO: solo administración anula acuerdos de pago' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'MOTIVO: para anular un acuerdo hay que decir por qué' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.fact_pagos where acuerdo_id = p_id and not anulado) then
    raise exception 'CON_PAGOS: el acuerdo tiene pagos; anúlalos primero o cambia el plan' using errcode = 'check_violation';
  end if;
  update public.fact_documentos set acuerdo_id = null where acuerdo_id = p_id;
  update public.fact_acuerdos
     set anulado = true, anulado_motivo = btrim(p_motivo), anulado_por = p_usuario, updated_at = now()
   where id = p_id and not anulado;
  if not found then raise exception 'ACUERDO_NO_EXISTE: no existe o ya está anulado' using errcode = 'no_data_found'; end if;
end $$;

-- Liga la factura al acuerdo (p_acuerdo null = la quita). Devuelve cuánto anticipo
-- quedó descontado en esa factura.
create or replace function public.fact_acuerdo_ligar_factura(p_factura uuid, p_acuerdo uuid, p_usuario text)
returns numeric
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_fact public.fact_documentos;
  v_descontado numeric;
begin
  if not public.fact_puede_facturar(p_usuario) then
    raise exception 'SIN_PERMISO: solo administración liga facturas a acuerdos' using errcode = 'insufficient_privilege';
  end if;
  select * into v_fact from public.fact_documentos where id = p_factura;
  if v_fact.id is null or v_fact.tipo <> 'FACTURA' then
    raise exception 'NO_ES_FACTURA: solo una factura va a un acuerdo' using errcode = 'check_violation';
  end if;
  if v_fact.anulado then raise exception 'DOCUMENTO_ANULADO: la factura % está anulada', v_fact.numero using errcode = 'check_violation'; end if;
  if p_acuerdo is not null and not exists (select 1 from public.fact_acuerdos where id = p_acuerdo and not anulado) then
    raise exception 'ACUERDO_NO_EXISTE: no existe o está anulado' using errcode = 'no_data_found';
  end if;
  update public.fact_documentos set acuerdo_id = p_acuerdo where id = p_factura and acuerdo_id is distinct from p_acuerdo;
  select coalesce(sum(valor), 0) into v_descontado
    from public.fact_pagos where factura_id = p_factura and anticipo and not anulado;
  return v_descontado;
end $$;

grant execute on function public.fact_acuerdo_guardar(uuid, jsonb, jsonb, text),
  public.fact_acuerdo_anular(uuid, text, text),
  public.fact_acuerdo_ligar_factura(uuid, uuid, text),
  public.fact_puede_facturar(text)
  to anon, authenticated;

-- ── Vista: un acuerdo con sus totales ──────────────────────────────────────
create or replace view public.fact_acuerdos_v with (security_invoker = true) as
with cuotas as (
  select acuerdo_id, sum(valor) as valor, coalesce(sum(valor) filter (where anticipo), 0) as anticipo,
         count(*) filter (where not anticipo) as n_cuotas, max(vence) as ultima_cuota
    from public.fact_acuerdo_cuotas group by acuerdo_id
),
pagos as (
  select acuerdo_id, sum(valor) as pagado,
         coalesce(sum(valor) filter (where anticipo), 0) as anticipo_pagado,
         coalesce(sum(valor) filter (where factura_id is null), 0) as por_descontar,
         max(fecha) as ultimo_pago, count(*) as n_pagos
    from public.fact_pagos where not anulado and acuerdo_id is not null group by acuerdo_id
),
facturas as (
  select acuerdo_id, count(*) as n_facturas, sum(valor) as facturado,
         string_agg(numero, ', ' order by fecha, created_at) as facturas
    from public.fact_documentos where acuerdo_id is not null and tipo = 'FACTURA' and not anulado group by acuerdo_id
)
select a.id, a.colono, a.telefono, a.haciendas, a.fecha, a.negociado_por, a.condiciones,
       a.anulado, a.anulado_motivo, a.creado_por, a.editado_por, a.created_at,
       coalesce(c.valor, 0) as valor, coalesce(c.anticipo, 0) as anticipo,
       coalesce(c.n_cuotas, 0) as n_cuotas, c.ultima_cuota,
       coalesce(p.pagado, 0) as pagado, coalesce(p.anticipo_pagado, 0) as anticipo_pagado,
       coalesce(p.por_descontar, 0) as por_descontar, p.ultimo_pago, coalesce(p.n_pagos, 0) as n_pagos,
       coalesce(f.n_facturas, 0) as n_facturas, f.facturado, f.facturas
  from public.fact_acuerdos a
  left join cuotas c on c.acuerdo_id = a.id
  left join pagos p on p.acuerdo_id = a.id
  left join facturas f on f.acuerdo_id = a.id;
comment on view public.fact_acuerdos_v is
  'Acuerdos de pago con totales: valor del plan, anticipo, pagado, anticipo aún sin factura (por_descontar) y facturas ligadas.';
grant select on public.fact_acuerdos_v to anon, authenticated;

-- ── Cartera: la factura dice su acuerdo, el colono y el anticipo descontado ──
-- Una factura CON acuerdo no se mide con los 30 días de siempre sino con su plan:
-- vence = la próxima cuota sin cubrir, y la mora corre desde esa fecha (vencida
-- 1–30 días de mora · crítica 31–150 · otras medidas >150, lo mismo que una
-- factura normal de 30 días). Si el plan ya está cubierto pero la factura aún
-- tiene saldo, vuelve a la regla de siempre.
-- (las columnas nuevas van al final: así se puede reemplazar la vista)
create or replace view public.cartera_facturas_v with (security_invoker = true) as
with hoy as (select (now() at time zone 'America/Bogota')::date as d),
acuerdo_prox as (
  -- La próxima cuota sin cubrir de cada acuerdo (lo pagado cubre las cuotas en orden).
  select distinct on (q.acuerdo_id) q.acuerdo_id, q.vence
    from (select cu.acuerdo_id, cu.orden, cu.vence,
                 sum(cu.valor) over (partition by cu.acuerdo_id order by cu.orden) as acumulado
            from public.fact_acuerdo_cuotas cu) q
    left join (select acuerdo_id, sum(valor) as pagado from public.fact_pagos
                where not anulado and acuerdo_id is not null group by acuerdo_id) pa on pa.acuerdo_id = q.acuerdo_id
   where q.acumulado > coalesce(pa.pagado, 0) + 0.5
   order by q.acuerdo_id, q.orden
),
pagos as (
  select factura_id, sum(valor) as pagado, max(fecha) as ultimo_pago, count(*) as n_pagos,
         coalesce(sum(valor) filter (where anticipo), 0) as anticipo
    from public.fact_pagos where not anulado and factura_id is not null group by factura_id
),
lineas as (
  select factura_id, count(*) as n_lineas,
         sum(case when area_realizada > 0 then area_realizada else area_asignada end) as cantidad
    from public.asignaciones where factura_id is not null group by factura_id
),
base as (
  select f.id, f.numero, f.fecha, f.razon_social, f.cliente, f.valor, f.plazo_dias,
         f.archivo_path, f.archivo_nombre, f.nota, f.created_at,
         coalesce(ap.vence, f.fecha + f.plazo_dias) as vence,
         coalesce(p.pagado, 0) as pagado, p.ultimo_pago, coalesce(p.n_pagos, 0) as n_pagos,
         coalesce(l.n_lineas, 0) as n_lineas, coalesce(l.cantidad, 0) as cantidad,
         (select d from hoy) as hoy,
         f.acuerdo_id, a.colono, coalesce(p.anticipo, 0) as anticipo, (ap.vence is not null) as por_plan
    from public.fact_documentos f
    left join pagos p on p.factura_id = f.id
    left join lineas l on l.factura_id = f.id
    left join public.fact_acuerdos a on a.id = f.acuerdo_id
    left join acuerdo_prox ap on ap.acuerdo_id = f.acuerdo_id
   where f.tipo = 'FACTURA' and not f.anulado
),
corte as (
  -- Pagada: los días se congelan en el último pago (en cuánto pagó el cliente).
  select b.*, (b.valor is not null and b.pagado >= b.valor - 0.5) as pagada,
         case when b.valor is not null and b.pagado >= b.valor - 0.5 then coalesce(b.ultimo_pago, b.hoy) else b.hoy end as al
    from base b
)
select c.id, c.numero, c.fecha, c.razon_social, c.cliente, c.valor, c.plazo_dias, c.archivo_path, c.archivo_nombre,
       c.nota, c.created_at, c.vence, c.pagado, c.ultimo_pago, c.n_pagos, c.n_lineas, c.cantidad, c.hoy,
       case when c.valor is null then null else greatest(c.valor - c.pagado, 0) end as saldo,
       greatest(c.al - c.fecha, 0) as dias_cartera,
       greatest(c.al - c.vence, 0) as dias_mora,
       case
         when c.pagada then 'PAGADA'
         when c.por_plan and c.hoy - c.vence > 150 then 'OTRAS_MEDIDAS'
         when c.por_plan and c.hoy - c.vence > 30 then 'CRITICA'
         when c.por_plan and c.hoy > c.vence then 'VENCIDA'
         when c.por_plan and c.valor is null then 'SIN_VALOR'
         when c.por_plan then 'AL_DIA'
         when c.hoy - c.fecha > 180 then 'OTRAS_MEDIDAS'
         when c.hoy - c.fecha > 60 then 'CRITICA'
         when c.hoy > c.vence then 'VENCIDA'
         when c.valor is null then 'SIN_VALOR'
         else 'AL_DIA'
       end as estado,
       c.acuerdo_id, c.colono, c.anticipo
  from corte c;
grant select on public.cartera_facturas_v to anon, authenticated;
