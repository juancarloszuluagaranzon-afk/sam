-- Los servicios de flota se registran en DOS formatos distintos.
--
-- No es una vista distinta de los mismos viajes: el CDA-F-68 de IMECOL cubre la
-- flota contratada (LQX955, LLW076) y el F-OPE-22 de AgroMorales cubre la
-- camioneta propia, con otro conductor y otra placa (LFV663, que ni siquiera
-- estaba en el maestro). Cada formato pide campos que el otro no tiene, asi que
-- cada formulario y cada Excel toman los suyos.
--
-- DEFAULT 'IMECOL' porque los 34 servicios que ya existen se registraron por el
-- formulario de IMECOL. NOT NULL porque un servicio sin formato no sabria en
-- cual de las dos planillas salir — y quedaria fuera de las dos, que es la peor
-- forma de perder un dato: sin error y sin rastro.

alter table public.flota_servicios
  add column if not exists formato text not null default 'IMECOL';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'flota_servicios_formato_check') then
    alter table public.flota_servicios
      add constraint flota_servicios_formato_check check (formato in ('IMECOL', 'AGROMORALES'));
  end if;
end $$;

create index if not exists flota_servicios_formato_fecha_idx
  on public.flota_servicios (formato, fecha desc);

comment on column public.flota_servicios.formato is
  'En que planilla sale: IMECOL (CDA-F-68) o AGROMORALES (F-OPE-22). Cada una pide campos distintos.';

notify pgrst, 'reload schema';
