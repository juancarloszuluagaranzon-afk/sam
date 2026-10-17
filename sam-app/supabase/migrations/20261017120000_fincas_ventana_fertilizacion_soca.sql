-- ============================================================================
-- Fertilización en SOCA: ventana 30/45 días desde el corte (17-oct-2026).
--
-- El paquete traía 45/60. Dos fuentes dicen lo mismo:
--  · AgroCampo (la app de Riopaila de Iván, `shared/edadLote.ts`): EDAD_EN_VENTANA = 30
--    («en ventana»), EDAD_APURA = 45 («ya apura»), más de 45 = atrasada. Es la regla
--    con la que se prioriza la fertilización de soca en producción desde sep-2026.
--  · Cenicaña, Serie Técnica 21 (Quintero 1997): una sola aplicación hacia los
--    30 DDC; ensayos hasta 45. https://www.cenicana.org/pdf_privado/serie_tecnica/st_21/st_21.pdf
-- Convención del paquete: (inicio ideal, fin normal) → (ventana_ideal, ventana_normal):
-- hasta 30 = ideal, hasta 45 = normal, más = tardía. La «oportunidad» se CALCULA
-- (no se guarda), así que solo cambia la calificación en pantalla, nunca la plata.
--
-- Igual que la de plantilla (20261016180000): solo toca lo que sigue con el valor
-- viejo (45/60); si administración ya lo ajustó a mano, se respeta.
-- ============================================================================

select set_config('af.via_funcion', '1', true);

update public.af_paquete
   set ventana_ideal = 30, ventana_normal = 45, editado_por = 'AJUSTE_CENICANA', updated_at = now()
 where upper(labor) like 'FERTILIZACI_N' and aplica = 'SOCA'
   and ventana_ideal = 45 and ventana_normal = 60;

update public.af_labores l
   set ventana_ideal = 30, ventana_normal = 45, editado_por = 'AJUSTE_CENICANA'
  from public.af_ciclos c
 where c.id = l.ciclo_id and c.estado = 'ABIERTO' and c.tipo = 'SOCA'
   and upper(l.labor) like 'FERTILIZACI_N'
   and l.ventana_ideal = 45 and l.ventana_normal = 60;

select set_config('af.via_funcion', '', true);

-- Comprobación: soca 30/45 y plantilla 30/60.
select labor, aplica, ventana_ideal, ventana_normal, editado_por
  from public.af_paquete
 where upper(labor) like 'FERTILIZACI_N'
 order by aplica;
