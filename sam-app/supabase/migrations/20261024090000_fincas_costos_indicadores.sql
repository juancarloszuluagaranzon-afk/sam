-- ============================================================================
-- ADMINISTRACIÓN DE FINCAS — costos e indicadores del gremio (24-oct-2026)
--
-- Pedido de Iván (23-oct): los costos «parecen los costos de una tienda»; quiere
-- $/kg de azúcar, $/ha y $/t de caña, y un tablero con TCH, rendimiento, sacarosa,
-- toneladas, corte… Referencias investigadas: Cenicaña, Informe Anual 2025 (tabla 1)
-- y Procaña, Plantilla de costos 2022.
--
-- 1. Parámetros económicos de cada finca: kilos de azúcar que se liquidan por
--    tonelada de caña (58 en la compraventa tradicional) y precio del kg de azúcar
--    de la liquidación. NULL = no definido (la pantalla lo dice, no lo inventa).
-- 2. Rubro (objeto de costo, como agrupa Procaña) de cada movimiento. NULL = se
--    deduce de la labor (mapa `rubro_por_labor`) o cae en «otros».
-- 3. Las referencias del sector son un DATO, no van en el código: fila
--    `af_config.referencias_sector` con su fuente y año. Para actualizarlas basta un
--    UPDATE, sin publicar.
-- 4. `af_referencias()`: la app la lee con la llave pública (son cifras públicas del
--    sector; no lleva nada de ninguna finca).
--
-- No toca `af_datos`: devuelve las filas completas (`to_jsonb`), así que las
-- columnas nuevas llegan solas. Ninguna función existente cambia.
-- ============================================================================

alter table public.af_fincas
  add column if not exists kg_azucar_tc numeric
    check (kg_azucar_tc is null or kg_azucar_tc > 0),
  add column if not exists precio_kg_azucar numeric
    check (precio_kg_azucar is null or precio_kg_azucar > 0);

alter table public.af_movimientos
  add column if not exists rubro text
    check (rubro is null or rubro in
      ('insumos', 'agua', 'mano_obra', 'maquinaria', 'administracion', 'predial_fondos', 'semilla', 'otros'));

insert into public.af_config (clave, valor, editado_en)
values ('referencias_sector', $json${
  "productividad": {
    "fuente": "Cenicaña, Informe Anual 2025, tabla 1",
    "anio": 2025,
    "tch": 124.6, "tah": 12.5, "tchm": 9.4, "tahm": 0.9,
    "rendimiento": 10.1, "sacarosa": 11.67, "edad_meses": 13.2, "numero_corte": 4.8
  },
  "costos": {
    "fuente": "Procaña, Plantilla de costos 2022 (soca)",
    "anio": 2022,
    "costo_ha": 8106753, "costo_tc": 70494, "ka_tc": 36,
    "tch": 115, "kg_azucar_tc": 58, "precio_tc": 115000
  },
  "rubro_por_labor": {
    "ROTURACIÓN": "maquinaria",
    "FERTILIZACIÓN": "insumos",
    "CONTROL DE MALEZAS": "insumos",
    "RIEGO": "agua"
  }
}$json$::jsonb, now())
on conflict (clave) do update set valor = excluded.valor, editado_en = now();

create or replace function public.af_referencias() returns jsonb
language sql stable security definer set search_path = public, pg_catalog as $$
  select coalesce((select valor from public.af_config where clave = 'referencias_sector'), '{}'::jsonb)
$$;
revoke all on function public.af_referencias() from public;
grant execute on function public.af_referencias() to anon, authenticated;
