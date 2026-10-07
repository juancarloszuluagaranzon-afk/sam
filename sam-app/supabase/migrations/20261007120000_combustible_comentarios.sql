-- ============================================================================
-- 20261007120000 — COMENTARIOS a los tanqueos (7-oct-2026)
--
-- Pedido de Iván: «ayúdame para que Diego pueda poner comentarios a los datos
-- que él vea desfasados y que queden guardados». Diego Urdinola (U051, analista)
-- revisa la eficiencia tanque a tanque y anota, sobre el tanqueo que no cuadra
-- (gal/h alto o bajo, horómetro raro), qué vio o qué averiguó.
--
-- · Cada comentario cuelga de UN tanqueo: su fila de origen (`fuente` + `origen_id`:
--   una entrega de bodega en `insumos_solicitudes` o un tanqueo en bomba en
--   `combustible_externo`). Se guarda también la máquina y el instante del
--   tanqueo para listarlos sin cruzar tablas.
-- · No se borran: se ANULAN (`anulado`), así queda la historia.
-- · Solo AGREGA.
-- ============================================================================

create table if not exists public.combustible_comentarios (
  id            uuid primary key default gen_random_uuid(),
  maquina       text not null,
  fuente        text not null check (fuente in ('Entrega', 'Tanqueo')),
  origen_id     text not null,
  tanqueo_en    timestamptz,
  comentario    text not null check (length(btrim(comentario)) > 0),
  autor_id      text,
  autor_nombre  text,
  anulado       boolean not null default false,
  anulado_por   text,
  created_at    timestamptz not null default now()
);
comment on table public.combustible_comentarios is
  'Comentarios sobre un tanqueo (consumo tanque a tanque): los anota el analista cuando un dato se ve desfasado. Se anulan, no se borran.';

create index if not exists combustible_comentarios_origen_idx on public.combustible_comentarios (fuente, origen_id) where not anulado;
create index if not exists combustible_comentarios_maquina_idx on public.combustible_comentarios (maquina, tanqueo_en) where not anulado;

alter table public.combustible_comentarios enable row level security;
drop policy if exists combustible_comentarios_rw on public.combustible_comentarios;
create policy combustible_comentarios_rw on public.combustible_comentarios for all to anon, authenticated using (true) with check (true);
grant select, insert, update on public.combustible_comentarios to anon, authenticated;
