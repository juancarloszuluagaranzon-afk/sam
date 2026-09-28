# Facturación por línea de labor (28-sep-2026)

Pedido de Iván: ver el valor a facturar de cada labor realizada (hectáreas × tarifa),
con la razón social (AGROMORALES o CEBALLOS Y LOZANO — misma operación, distinta razón
social en la factura) y el cliente correctos.

- `ASM_solicitud_tarifas_facturacion.xlsx` — plantilla PRELLENADA que llena el cliente.
  Hojas y encabezados FIJOS: el importador los lee tal cual (listas en la hoja oculta «Listas»).
- `generar_plantilla.py` — la regenera. Necesita al lado `combos.csv` y `haciendas.csv`
  (NO se versionan: son datos de la base). Consultas (psql --csv, estado COMPLETADA/PARCIAL):
  - combos: ingenio_id, cliente, labor_nombre, unidad, count, sum(área realizada o asignada), min/max fecha_fin, con factura.
  - haciendas: ingenio_id, cliente, codigo_hacienda, max(nombre_hacienda), count, ha, última fecha_fin.
- `plan_facturacion.html` — plan de trabajo (publicado como artifact).

Cruce de la tabla recibida con lo realizado (16-may → 28-sep, 4.739 labores, ≈26.252 ha):
40 % con precio claro · 51 % falta decidir · 8 % sin precio. La respuesta que más pesa:
razón social del DESPEJE de Riopaila (8.097 ha).

Pendiente al recibir el Excel: importador → `tarifas` (+ razón social, unidad, variante),
regla razón social por cliente/hacienda, Riopaila Agrícola como cliente, valor por línea
en `FacturacionTab`, pre-factura Excel, variantes en `labores_catalogo`.
