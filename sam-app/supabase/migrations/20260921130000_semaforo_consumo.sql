-- ============================================================================
-- Semáforos de galones por hora y ganchos por hora, por máquina (21-sep-2026).
--
-- Pedido del cliente: «semáforos en el análisis de combustible y ganchos», con su
-- tabla (MÍNIMO VERDE / MEDIO NARANJA por tractor). Los rangos van en una FILA y
-- no en el código —mismo principio que `taller_config`—: el cliente los va a
-- ajustar, y cambiar un número no debe exigir publicar una versión.
--
-- Qué mide cada uno (comprobado contra septiembre 1–20, no supuesto):
--   · gal_hora: GALONES POR HORA de horómetro. Los CASE 9xx dieron 1,16–1,36 gal/h
--     (tabla: 1,2 a 1,5) y 0,77–0,86 gal/ha — el gal/ha queda por debajo de TODOS
--     los rangos, así que la tabla no habla de hectáreas.
--   · ganchos_hora: GANCHOS POR HORA de máquina. La segunda fila de GANCHOS de la
--     tabla («40 de 0 a 45 h / 80 de 45,1 a 90») es la misma cuenta dicha de otra
--     forma: 40/45 = 80/90 = 0,89 por hora, dentro del verde (0,7 a 1,1). En
--     septiembre las máquinas dieron 0,53–1,37.
--
-- Lectura: ≤ verde_max = verde · ≤ naranja_max = naranja · más = rojo. Debajo de
-- verde_min NO es rojo: se marca «debajo del rango» (suele ser un tanqueo o una
-- entrega sin registrar, o un horómetro que corrió de más).
--
-- `maquina` = el nombre como lo escribe el cliente (CASE 1001), se compara en
-- mayúsculas; '*' = todas. Una máquina sin fila (FIAT) no lleva semáforo: pintarla
-- de verde sería inventar un juicio.
-- ============================================================================

create table if not exists public.semaforo_consumo (
  indicador   text not null check (indicador in ('gal_hora', 'ganchos_hora')),
  maquina     text not null default '*',
  verde_min   numeric,
  verde_max   numeric not null,
  naranja_max numeric not null,
  nota        text,
  updated_at  timestamptz not null default now(),
  primary key (indicador, maquina),
  check (naranja_max >= verde_max),
  check (verde_min is null or verde_min <= verde_max)
);

alter table public.semaforo_consumo enable row level security;
do $$
begin
  if not exists (select 1 from pg_policy where polname = 'semaforo_consumo_sel') then
    create policy semaforo_consumo_sel on public.semaforo_consumo for select using (true);
  end if;
end $$;
-- Solo lectura para la app; los rangos se cambian por SQL.
grant select on public.semaforo_consumo to anon, authenticated;

insert into public.semaforo_consumo (indicador, maquina, verde_min, verde_max, naranja_max, nota) values
  ('gal_hora', 'CASE 1001',   1.2, 1.5, 1.7,  null),
  ('gal_hora', 'CASE 1002',   1.2, 1.5, 1.7,  null),
  ('gal_hora', 'CASE 1101',   1.7, 2.1, 2.3,  null),
  ('gal_hora', 'CASE 1102',   1.2, 1.5, 1.7,  null),
  ('gal_hora', 'CASE 1301',   1.7, 2.1, 2.3,  null),
  ('gal_hora', 'CASE 1302',   1.7, 2.1, 2.3,  null),
  ('gal_hora', 'CASE 1303',   1.7, 2.1, 2.3,  null),
  ('gal_hora', 'CASE 1304',   1.7, 2.1, 2.3,  null),
  ('gal_hora', 'CASE 901',    1.2, 1.5, 1.7,  null),
  ('gal_hora', 'CASE 902',    1.2, 1.5, 1.7,  null),
  ('gal_hora', 'CASE 903',    1.2, 1.5, 1.7,  null),
  ('gal_hora', 'CASE 951',    1.2, 1.5, 1.7,  null),
  ('gal_hora', 'CASE 952',    1.2, 1.5, 1.7,  null),
  -- La tabla trae DOS rangos para las PUMA: «5 A 6 / 4 A ,5» y «6,1 A 6,5 / 4,51 A 5».
  -- Se usa el segundo (4 a 4,5) — el que corresponde a lo que gastan hoy (3,5–5 gal/h
  -- en septiembre) — hasta que el cliente diga qué distingue los dos.
  ('gal_hora', 'PUMA 2101',   4.0, 4.5, 5.0,  'Tabla: «5 A 6 / 4 A ,5». Se usa 4 a 4,5 hasta confirmar qué distingue los dos rangos'),
  ('gal_hora', 'PUMA 2301',   4.0, 4.5, 5.0,  'Tabla: «5 A 6 / 4 A ,5». Se usa 4 a 4,5 hasta confirmar qué distingue los dos rangos'),
  ('gal_hora', 'PUMA 2302',   4.0, 4.5, 5.0,  'Tabla: «5 A 6 / 4 A ,5». Se usa 4 a 4,5 hasta confirmar qué distingue los dos rangos'),
  ('gal_hora', 'VALTRA 1351', 1.3, 1.7, 1.8,  null),
  -- El naranja de las VALTRA 99xx venía como un solo número, «1.70».
  ('gal_hora', 'VALTRA 9901', 1.1, 1.5, 1.70, 'Naranja de la tabla: «1.70» (se lee 1,51 a 1,70)'),
  ('gal_hora', 'VALTRA 9902', 1.1, 1.5, 1.70, 'Naranja de la tabla: «1.70» (se lee 1,51 a 1,70)'),
  ('gal_hora', 'VALTRA 9903', 1.1, 1.5, 1.70, 'Naranja de la tabla: «1.70» (se lee 1,51 a 1,70)'),
  ('gal_hora', 'VALTRA 9904', 1.1, 1.5, 1.70, 'Naranja de la tabla: «1.70» (se lee 1,51 a 1,70)'),
  ('ganchos_hora', '*',       0.7, 1.1, 1.4,  'Referencia del cliente: 40 ganchos de 0 a 45 h, 80 de 45,1 a 90 h (≈ 0,89 por hora)')
on conflict (indicador, maquina) do update
  set verde_min = excluded.verde_min, verde_max = excluded.verde_max,
      naranja_max = excluded.naranja_max, nota = excluded.nota, updated_at = now();
