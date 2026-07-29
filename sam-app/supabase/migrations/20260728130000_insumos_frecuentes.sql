-- Insumos FRECUENTES: los de uso diario que se muestran de entrada en los
-- selectores; el resto queda detrás del botón "⋯ Otros (N)" para no saturar
-- visualmente (son muchos y no todos se usan seguido).
--
-- Correr en Supabase Studio (extensión traductora APAGADA).

alter table public.insumos
  add column if not exists frecuente boolean not null default false;

notify pgrst, 'reload schema';
