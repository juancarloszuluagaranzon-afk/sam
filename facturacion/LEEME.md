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

## Dos reglas que ya estaban decididas (skill managing-facturacion)
- **No facturar hacia atrás**: la plantilla separa la vigencia del precio (desde el 16-may,
  solo para VER el valor) de la fecha desde la que se FACTURA desde la app (propuesta
  1-oct-2026). Antes de esa fecha la app valora, pero no arma cobro.
- **El número legal sale del programa de facturación (¿Siigo?)**: la app entrega la
  cuenta de cobro / pre-factura. La hoja 6 pregunta cuál programa usan.

## 2-oct-2026 — MODALIDAD de la labor (ya en la app, commit `f8bcae8`)
Lógica de Iván (hoja escrita a mano): DESPEJE 0X0 / 2X1 MECANIZADA / 4X1 QUEMADA ·
REENCALLE SENCILLO / 2X1 / VERDE · SUBSUELO y TRIPLE PLANTILLA / 2X1 / 4X1 · ACEQUIAS
1 / 2 / 3 PASES. La plantilla pide cada precio por «LABOR · MODALIDAD» («· TODAS» si el
precio no cambia). Por confirmar (hoja 5): Triple = mismas del subsuelo, Fertilización
plantilla/2x1/4x1 (la tabla de precios las trae, la hoja escrita no), Cultivo, y si
acequias se cobra por pase o por hectómetro.
