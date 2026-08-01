-- Listas de valores para los formularios de insumos.
--
-- Estación de servicio, placa, "para qué / dónde", motivo de rechazo… todo eso
-- se venía escribiendo libre y cada quien lo escribía distinto: "texaco san
-- pedro", "TEXACO SANPEDRO", "texaco". Después nadie cuadra un reporte porque
-- son tres valores para la misma bomba.
--
-- Una sola tabla para todas las listas, distinguidas por `tipo`. Agregar una
-- lista nueva no necesita migración: basta un `tipo` nuevo y el formulario que
-- lo consuma.

create table if not exists catalogos_valores (
  id           uuid primary key default gen_random_uuid(),
  tipo         text not null,
  valor        text not null,
  descripcion  text,
  -- Los de uso diario salen de primeras en el selector; el resto queda detrás.
  frecuente    boolean not null default false,
  -- No se borra lo que ya se usó en un registro viejo: se desactiva y deja de
  -- ofrecerse, pero el histórico sigue leyéndose igual.
  activo       boolean not null default true,
  orden        integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create unique index if not exists catalogos_valores_tipo_valor_uk
  on catalogos_valores (tipo, upper(valor));
create index if not exists catalogos_valores_tipo_ix
  on catalogos_valores (tipo, activo);

-- Una tabla nueva no hereda los GRANT: sin esto la app responde
-- "permission denied" aunque la policy exista.
alter table catalogos_valores enable row level security;
grant select, insert, update, delete on catalogos_valores to anon, authenticated;

drop policy if exists catalogos_valores_todos on catalogos_valores;
create policy catalogos_valores_todos on catalogos_valores
  for all to anon, authenticated using (true) with check (true);

-- ── Estaciones donde se tanquea (las que dio el cliente) ──
insert into catalogos_valores (tipo, valor, frecuente, orden)
values ('ESTACION', 'ZEUSS ROLDANILLO',               true, 1),
       ('ESTACION', 'BIOMAX BOLIVAR',                 true, 2),
       ('ESTACION', 'INVERSIONES LA VARIANTE ZARZAL', true, 3),
       ('ESTACION', 'TEXACO SAN PEDRO',               true, 4),
       ('ESTACION', 'SERVIBERNA PALMIRA',             true, 5)
on conflict do nothing;

-- ── Las placas que ya estaban en el catálogo viejo ──
-- `vehiculos` deja de leerse desde la app, pero lo cargado no se pierde.
insert into catalogos_valores (tipo, valor, descripcion, frecuente)
select 'PLACA', upper(trim(v.placa)), v.descripcion, coalesce(v.frecuente, false)
  from vehiculos v
 where v.activo
on conflict do nothing;
