-- ============================================================================
-- Fertilización en PLANTILLA: ventana 30–60 días desde la siembra (16-oct-2026).
--
-- El paquete inicial traía 60/90. La revisión agronómica (Cenicaña, Serie Técnica
-- 21, Quintero 1997: «fertilización nitrogenada de 30 a 60 días después de la
-- siembra sin pérdida de eficiencia») la deja más temprano. La convención del
-- paquete es (inicio, fin) de la ventana → (ventana_ideal, ventana_normal), igual
-- que roturación soca 16/30. Pedido de Iván al aprobar el «paquete 1».
-- https://www.cenicana.org/pdf_privado/serie_tecnica/st_21/st_21.pdf
--
-- Solo cambia lo que sigue con el valor viejo (60/90): si administración ya la
-- ajustó a mano en «Paquete de labores», se respeta. Lo mismo en las labores de
-- ciclos de PLANTILLA abiertos, que copiaron la ventana al abrirse.
-- Va por `af.via_funcion` (como las cargas por SQL de la skill) con
-- editado_por = 'AJUSTE_CENICANA', para que la auditoría no lo ponga a nombre de nadie.
-- ============================================================================

select set_config('af.via_funcion', '1', true);

update public.af_paquete
   set ventana_ideal = 30, ventana_normal = 60, editado_por = 'AJUSTE_CENICANA', updated_at = now()
 where upper(labor) like 'FERTILIZACI_N' and aplica = 'PLANTILLA'
   and ventana_ideal = 60 and ventana_normal = 90;

update public.af_labores l
   set ventana_ideal = 30, ventana_normal = 60, editado_por = 'AJUSTE_CENICANA'
  from public.af_ciclos c
 where c.id = l.ciclo_id and c.estado = 'ABIERTO' and c.tipo = 'PLANTILLA'
   and upper(l.labor) like 'FERTILIZACI_N'
   and l.ventana_ideal = 60 and l.ventana_normal = 90;

select set_config('af.via_funcion', '', true);

-- Comprobación: el paquete de plantilla debe decir 30/60.
select labor, aplica, ventana_ideal, ventana_normal, editado_por
  from public.af_paquete
 where upper(labor) like 'FERTILIZACI_N'
 order by aplica;
