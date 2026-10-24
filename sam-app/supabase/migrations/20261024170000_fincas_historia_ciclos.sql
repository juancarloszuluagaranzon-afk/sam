-- ============================================================================
-- FINCAS: la cosecha de CADA ciclo y la inflación para comparar ciclos (24-oct-2026)
--
-- Pedido de Iván: ver la historia de una finca ciclo a ciclo (TCH, rendimiento, $/ha,
-- $/t, $/kg de azúcar) y comparar costos de años distintos llevándolos a pesos de hoy.
--
-- 1. `af_ciclos.datos_cosecha` (jsonb, NULLABLE): lo que dio la cosecha con la que se
--    CERRÓ ese ciclo, con las mismas llaves de `af_suertes.datos_ingenio`
--    (f_ult_corte, edad_meses, numero_corte, toneladas, tch, rendimiento, sacarosa,
--    fuente). Hasta hoy solo quedaba la ÚLTIMA cosecha de la suerte y la historia se
--    perdía con cada corte. NULL = no se sabe (no «cero»). `af_datos` arma los ciclos con
--    `to_jsonb(c)`, así que la columna llega sola a la app sin tocar esa función.
-- 2. La inflación es un DATO, no código: fila `inflacion` en `af_config` con el IPC anual
--    del DANE (variación a diciembre). Cuando salga el de un año nuevo, se actualiza esa
--    fila y la app compara sola; nadie tiene que publicar.
--    Cifras verificadas el 24-oct-2026 (DANE vía Valora Analitik, El País, EFE, Portafolio):
--    2020 1,61 · 2021 5,62 · 2022 13,12 · 2023 9,28 · 2024 5,20 · 2025 5,10.
--    El salario mínimo va al lado como referencia (la mano de obra no sube con el IPC):
--    2020 877.803 · 2021 908.526 · 2022 1.000.000 · 2023 1.160.000 · 2024 1.300.000 ·
--    2025 1.423.500 · 2026 1.750.905 (Decreto 1469 de 2025, +23 %).
-- 3. `af_referencias()` devuelve además la llave `inflacion`. Es un parámetro NUEVO en la
--    salida, no en la entrada: una app vieja lo ignora.
-- ============================================================================

alter table public.af_ciclos add column if not exists datos_cosecha jsonb;

comment on column public.af_ciclos.datos_cosecha is
  'Cosecha con la que se cerró el ciclo (mismas llaves que af_suertes.datos_ingenio). NULL = no se sabe.';

insert into public.af_config (clave, valor, editado_en)
values ('inflacion', $json${
  "fuente": "IPC del DANE (variación anual a diciembre)",
  "ipc_anual": { "2020": 1.61, "2021": 5.62, "2022": 13.12, "2023": 9.28, "2024": 5.20, "2025": 5.10 },
  "salario_minimo": {
    "fuente": "Decretos del Gobierno Nacional (pesos mensuales)",
    "valor": { "2020": 877803, "2021": 908526, "2022": 1000000, "2023": 1160000,
               "2024": 1300000, "2025": 1423500, "2026": 1750905 }
  }
}$json$::jsonb, now())
on conflict (clave) do update set valor = excluded.valor, editado_en = now();

create or replace function public.af_referencias() returns jsonb
language sql stable security definer set search_path = public, pg_catalog as $$
  select coalesce((select valor from public.af_config where clave = 'referencias_sector'), '{}'::jsonb)
      || coalesce((select jsonb_build_object('inflacion', valor) from public.af_config where clave = 'inflacion'), '{}'::jsonb)
$$;
revoke all on function public.af_referencias() from public;
grant execute on function public.af_referencias() to anon, authenticated;
