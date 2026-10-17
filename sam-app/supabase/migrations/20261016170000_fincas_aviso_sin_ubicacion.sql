-- ============================================================================
-- El aviso al dueño ya no promete «ubicación» cuando el reporte no la trae
-- (16-oct-2026).
--
-- Iván apagó la ubicación del reporte de campo «de momento» (`PEDIR_UBICACION`
-- en lib/fincas.ts): Julio reporta aunque no esté en la finca. Pero el aviso que
-- le llega al celular del dueño cuando se ACEPTA un reporte decía fijo
-- «… — con foto y ubicación». Ahora lo dice según el reporte: «con foto y
-- ubicación» solo si trae `lat`, si no «con foto». Queda bien también el día que
-- se vuelva a prender la ubicación.
--
-- Copia completa de `af_aviso_reporte` de `20260925090000_fincas_avisos.sql`;
-- solo cambia el texto del aviso. El trigger `trg_af_aviso_reporte` no se toca.
-- ============================================================================

create or replace function public.af_aviso_reporte() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
declare r record;
begin
  if NEW.estado = 'ACEPTADO' and OLD.estado is distinct from 'ACEPTADO' then
    select f.id as finca, f.nombre, l.labor, l.unidad, s.codigo into r
      from public.af_labores l
      join public.af_ciclos c on c.id = l.ciclo_id
      join public.af_suertes s on s.id = c.suerte_id
      join public.af_fincas f on f.id = s.finca_id
     where l.id = NEW.labor_id;
    if r.finca is not null then
      perform public.af_avisar(r.finca, r.nombre,
        format('%s · suerte %s · %s %s — con foto%s', public.af_nombre_labor(r.labor), ltrim(r.codigo, '0'), public.af_cant(NEW.cantidad), r.unidad,
               case when NEW.lat is not null then ' y ubicación' else '' end),
        'finca-' || r.finca);
    end if;
  end if;
  return NEW;
exception when others then
  return NEW;
end $$;

-- Comprobación: debe decir texto_nuevo = true.
select position('con foto%s' in pg_get_functiondef('public.af_aviso_reporte()'::regprocedure)) > 0 as texto_nuevo;
