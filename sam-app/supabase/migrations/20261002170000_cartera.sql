-- ============================================================================
-- 20261002170000 — CARTERA: pagos, días de cartera y clasificación (2-oct-2026)
--
-- Pedido del cliente (vía Iván): trazabilidad de cada factura hasta su pago, días
-- de cartera y alertas. Lo revisa Viviana (cartera).
--   · Plazo estándar: 30 días desde la FECHA DE LA FACTURA (`plazo_dias`, editable
--     por factura). Después del vencimiento corren los DÍAS DE MORA.
--   · Clasificación por días desde la factura (mientras tenga saldo):
--       AL_DIA 0–30 · VENCIDA 31–60 · CRITICA 61–180 · OTRAS_MEDIDAS > 180
--     y PAGADA cuando los pagos cubren el valor. SIN_VALOR si la factura no tiene
--     valor todavía (sin tarifas): los días corren igual, el saldo no se sabe.
--   · Pagos con abonos parciales, comprobante (archivo) y anulación con motivo:
--     nada se borra.
-- Solo AGREGA (columnas, tabla y vista nuevas).
-- ============================================================================

alter table public.fact_documentos add column if not exists plazo_dias integer not null default 30
  check (plazo_dias between 0 and 365);
comment on column public.fact_documentos.plazo_dias is 'FACTURA: días de plazo desde la fecha de la factura (estándar 30). Después corren los días de mora.';

create table if not exists public.fact_pagos (
  id             uuid primary key default gen_random_uuid(),
  factura_id     uuid not null references public.fact_documentos(id),
  fecha          date not null,
  valor          numeric(16, 2) not null check (valor > 0),
  medio          text,
  referencia     text,
  archivo_path   text,
  archivo_nombre text,
  nota           text,
  anulado        boolean not null default false,
  anulado_por    text,
  anulado_motivo text,
  creado_por     text not null,
  created_at     timestamptz not null default now()
);
create index if not exists fact_pagos_factura_idx on public.fact_pagos (factura_id) where not anulado;
alter table public.fact_pagos enable row level security;
drop policy if exists fact_pagos_todos on public.fact_pagos;
create policy fact_pagos_todos on public.fact_pagos for all to anon, authenticated using (true) with check (true);
grant select, insert, update on public.fact_pagos to anon, authenticated;

-- Un pago solo va contra una FACTURA (no contra un soporte).
create or replace function public.fact_pagos_guardia() returns trigger
language plpgsql as $$
begin
  if not exists (select 1 from public.fact_documentos where id = NEW.factura_id and tipo = 'FACTURA') then
    raise exception 'NO_ES_FACTURA: el pago va contra una factura' using errcode = 'check_violation';
  end if;
  if TG_OP = 'UPDATE' and OLD.anulado and NEW is distinct from OLD then
    raise exception 'PAGO_ANULADO: ya estaba anulado' using errcode = 'check_violation';
  end if;
  if NEW.anulado and coalesce(btrim(NEW.anulado_motivo), '') = '' then
    raise exception 'MOTIVO: para anular un pago hay que decir por qué' using errcode = 'check_violation';
  end if;
  return NEW;
end $$;
drop trigger if exists trg_fact_pagos_guardia on public.fact_pagos;
create trigger trg_fact_pagos_guardia before insert or update on public.fact_pagos
  for each row execute function public.fact_pagos_guardia();

-- ── La cartera: una fila por factura ───────────────────────────────────────
create or replace view public.cartera_facturas_v with (security_invoker = true) as
with hoy as (select (now() at time zone 'America/Bogota')::date as d),
pagos as (
  select factura_id, sum(valor) as pagado, max(fecha) as ultimo_pago, count(*) as n_pagos
    from public.fact_pagos where not anulado group by factura_id
),
lineas as (
  select factura_id, count(*) as n_lineas,
         sum(case when area_realizada > 0 then area_realizada else area_asignada end) as cantidad
    from public.asignaciones where factura_id is not null group by factura_id
),
base as (
  select f.id, f.numero, f.fecha, f.razon_social, f.cliente, f.valor, f.plazo_dias,
         f.archivo_path, f.archivo_nombre, f.nota, f.created_at,
         (f.fecha + f.plazo_dias) as vence,
         coalesce(p.pagado, 0) as pagado, p.ultimo_pago, coalesce(p.n_pagos, 0) as n_pagos,
         coalesce(l.n_lineas, 0) as n_lineas, coalesce(l.cantidad, 0) as cantidad,
         (select d from hoy) as hoy
    from public.fact_documentos f
    left join pagos p on p.factura_id = f.id
    left join lineas l on l.factura_id = f.id
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
         when c.hoy - c.fecha > 180 then 'OTRAS_MEDIDAS'
         when c.hoy - c.fecha > 60 then 'CRITICA'
         when c.hoy > c.vence then 'VENCIDA'
         when c.valor is null then 'SIN_VALOR'
         else 'AL_DIA'
       end as estado
  from corte c;
comment on view public.cartera_facturas_v is
  'Cartera por factura: vence = fecha + plazo (30); días de mora después; AL_DIA ≤30 · VENCIDA 31–60 · CRITICA 61–180 · OTRAS_MEDIDAS >180 · PAGADA.';
grant select on public.cartera_facturas_v to anon, authenticated;

-- ── Oficios varios: por HORA o por JORNAL (modalidad, como las demás labores) ──
insert into public.catalogos_valores (tipo, valor, descripcion, orden, frecuente) values
  ('MODALIDAD:OFICIOS VARIOS', 'POR HORA', 'Se cobran las horas del horómetro', 1, true),
  ('MODALIDAD:OFICIOS VARIOS', 'POR JORNAL', 'Se cobra el jornal completo', 2, true)
on conflict (tipo, upper(valor)) do nothing;
