-- ============================================================================
-- `asignaciones.updated_at` se mueve en CADA edición (21-sep-2026).
--
-- 🔴 Hasta hoy `updated_at` solo tenía `default now()`: se llenaba al CREAR la fila
-- y nunca más. Medido: de 1.151 labores de los últimos 30 días, solo 4 tenían un
-- `updated_at` distinto del de creación.
--
-- Y la sincronización de la app vive de esa columna: el delta pide
-- `updated_at >= marca`. El aviso de tiempo real SÍ llegaba a todos los aparatos,
-- pero la recarga que dispara es ese delta, y una edición no aparecía en él. Así que
-- un cierre, una aprobación o una corrección hechos en un aparato NO llegaban a los
-- demás mientras tuvieran la app abierta: solo al volver a abrirla (que hace bajada
-- completa). Un supervisor con la app abierta toda la jornada no veía los cierres de
-- sus operarios.
--
-- La hora la pone el SERVIDOR (now()), no el aparato: la marca del delta también
-- sale del servidor desde este mismo cambio (ver `marcaDeServidor` en samApi.ts).
--
-- Solo si algo cambió de verdad: un UPDATE que no cambia nada no mueve la marca.
-- Va de último entre los BEFORE UPDATE (orden alfabético): así cuenta también lo
-- que cambien los otros disparadores.
--
-- `sam_run_retention` purga canceladas por `updated_at`: con esto el plazo cuenta
-- desde el último movimiento, que es lo que su nombre ya decía.
-- ============================================================================

create or replace function public.asignaciones_tocar_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if NEW is distinct from OLD then
    NEW.updated_at := now();
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_asignaciones_updated_at on public.asignaciones;
create trigger trg_asignaciones_updated_at
  before update on public.asignaciones
  for each row execute function public.asignaciones_tocar_updated_at();
