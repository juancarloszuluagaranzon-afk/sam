-- Horas trabajadas por máquina y mes, tomadas de los HORÓMETROS.
--
-- El tablero calculaba las horas sumando `labor_sesiones`, y ese dato viene
-- sucio: 445 de 2.212 sesiones tienen horas absurdas (≤0 o ≥24). Con el
-- denominador malo, el galones/hora sale en cualquier cosa — llegó a marcar 12
-- de 21 máquinas en rojo cuando lo que faltaba eran horas, no sobraba consumo.
--
-- Esta tabla guarda el cierre mensual que administración ya lleva: horómetro al
-- inicio, horómetro al final, y la resta. Es UNA lectura por máquina y mes en vez
-- de cientos de tramos, así que un dedazo suelto no la contamina.
--
-- ⚠️ NO reemplaza a `labor_sesiones`: la complementa. El tablero usa esta cuando
-- existe y cae a la suma de sesiones cuando no. Un mes sin cierre no puede dejar
-- la pantalla en blanco.

create table if not exists equipo_horas_mes (
  equipo_codigo     text not null references equipos(codigo) on delete cascade,
  -- Primer día del mes. Se guarda como fecha y no como texto 'YYYY-MM' para
  -- poder filtrar por rango sin convertir.
  mes               date not null,
  horometro_inicial numeric,
  horometro_final   numeric,
  -- La resta, guardada aparte: si el horómetro se REEMPLAZA a mitad de mes, la
  -- resta no sirve y hay que poner las horas a mano. Ya pasó con la VALTRA 9902.
  horas             numeric not null check (horas >= 0),
  galones           numeric,
  ganchos           numeric,
  fuente            text not null default 'CIERRE MENSUAL',
  nota              text,
  created_at        timestamptz not null default now(),
  primary key (equipo_codigo, mes)
);

comment on table equipo_horas_mes is
  'Cierre mensual por máquina: horas de horómetro, galones y ganchos. Es la '
  'fuente BUENA de horas para el tablero de eficiencia; labor_sesiones queda '
  'como respaldo para los meses sin cierre.';
comment on column equipo_horas_mes.horas is
  'Normalmente horometro_final − horometro_inicial. Si el horómetro se reemplazó '
  'a mitad de mes, la resta miente y este valor se pone a mano.';

create index if not exists equipo_horas_mes_mes_idx on equipo_horas_mes (mes);

alter table equipo_horas_mes enable row level security;
drop policy if exists equipo_horas_mes_rw on equipo_horas_mes;
create policy equipo_horas_mes_rw on equipo_horas_mes for all to anon, authenticated
  using (true) with check (true);
grant select, insert, update, delete on equipo_horas_mes to anon, authenticated;

notify pgrst, 'reload schema';
