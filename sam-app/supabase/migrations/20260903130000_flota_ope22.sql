-- Lo que pide la planilla F-OPE-22 de AgroMorales y no estaba.
--
-- Es un formato DISTINTO al CDA-F-68 de IMECOL: mismo servicio, dos documentos
-- con columnas distintas. El de IMECOL pide centro de costo y peajes; el de
-- AgroMorales pide el NUMERO DE MAQUINARIA a la que se le hizo la escolta y un
-- N° DE SERVICIO. Ninguno de los dos formato manda sobre el otro: se guardan
-- todos los campos y cada exportacion toma los suyos.
--
-- Ambas NULLABLE: los 34 servicios ya registrados no las tienen, y en la
-- planilla en papel el N° de servicio va casi siempre en blanco.

alter table public.flota_servicios
  add column if not exists numero_maquinaria text,
  add column if not exists numero_servicio   text;

comment on column public.flota_servicios.numero_maquinaria is
  'Maquina a la que se le presto el servicio (columna NUMERO MAQUINARIA del F-OPE-22). En un transporte de personal va vacia.';
comment on column public.flota_servicios.numero_servicio is
  'Consecutivo del formato F-OPE-22. Casi siempre vacio en el papel.';

-- La cedula del conductor va en el ENCABEZADO del F-OPE-22, al lado del nombre.
-- Es un dato de la PERSONA, no del servicio: si viviera en flota_servicios se
-- repetiria en cada fila y podria contradecirse entre una y otra.
alter table public.app_usuarios
  add column if not exists cedula text;

comment on column public.app_usuarios.cedula is
  'Documento de identidad. Se imprime en el encabezado de la planilla F-OPE-22.';

notify pgrst, 'reload schema';
