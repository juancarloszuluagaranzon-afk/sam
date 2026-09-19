-- ============================================================================
-- El horómetro de la máquina también se lee de las ENTREGAS (18-sep-2026).
--
-- Caso: «¿qué pasa con la PUMA 2302, que no se mueve el horómetro?». Sí trabajó
-- — 17 labores del 3 al 17 de septiembre —, pero su operario cierra las labores
-- con el horómetro en 0 (32 de 33 en el último mes), y `equipo_horometro_v` solo
-- leía labores, tanqueos y órdenes de trabajo. Las ENTREGAS de combustible y
-- material traen el horómetro y nadie lo usaba: la 2302 marcaba 4.339 (2-sep)
-- con 4.420 anotado en la entrega de hoy.
--
-- Medido ese día: 6 máquinas con la pantalla atrasada respecto a su última
-- entrega (PUMA2101 45 días, VALTRA9902 29, CASE951 22 — mostraba «2» —,
-- PUMA2302 16, CASE952 4, CASE901 2).
--
-- Solo se agrega la fuente; el resto de la vista queda igual (magnitud
-- dominante de las últimas 12 lecturas, la manual manda).
-- ============================================================================

create or replace view public.equipo_horometro_v as
 WITH lecturas AS (
         SELECT a_1.equipo_codigo AS codigo,
            a_1.horometro_final AS horas,
            COALESCE(a_1.fecha_fin, a_1.fecha_inicio) AS cuando,
            'Labor'::text AS fuente
           FROM asignaciones a_1
          WHERE a_1.equipo_codigo IS NOT NULL AND a_1.horometro_final IS NOT NULL
        UNION ALL
         SELECT c.equipo_codigo,
            c.horometro,
            c.created_at,
            'Tanqueo'::text
           FROM combustible_externo c
          WHERE c.equipo_codigo IS NOT NULL AND c.horometro IS NOT NULL
        UNION ALL
         SELECT o.equipo_codigo,
            o.horometro,
            o.created_at,
            'Orden de trabajo'::text
           FROM ordenes_trabajo o
          WHERE o.horometro IS NOT NULL AND o.estado <> 'ANULADA'::text
        UNION ALL
         -- 🆕 La entrega de combustible/material al pie de la máquina.
         SELECT s.equipo_codigo,
            s.horometro::numeric,
            COALESCE(s.entregado_en, s.created_at),
            'Entrega'::text
           FROM insumos_solicitudes s
          WHERE s.equipo_codigo IS NOT NULL AND s.horometro IS NOT NULL AND s.estado <> 'CANCELADA'::text
        ), ranked AS (
         SELECT lecturas.codigo,
            lecturas.horas,
            lecturas.cuando,
            lecturas.fuente,
            row_number() OVER (PARTITION BY lecturas.codigo ORDER BY lecturas.cuando DESC, lecturas.horas DESC) AS rn
           FROM lecturas
          WHERE lecturas.horas > 0::numeric AND lecturas.cuando IS NOT NULL
        ), magnitudes AS (
         SELECT ranked.codigo,
            floor(log(10::numeric, ranked.horas)) AS mag,
            count(*) AS cuantas,
            max(ranked.cuando) AS ultima
           FROM ranked
          WHERE ranked.rn <= 12
          GROUP BY ranked.codigo, (floor(log(10::numeric, ranked.horas)))
        ), dominante AS (
         SELECT DISTINCT ON (magnitudes.codigo) magnitudes.codigo,
            magnitudes.mag
           FROM magnitudes
          ORDER BY magnitudes.codigo, magnitudes.cuantas DESC, magnitudes.ultima DESC
        ), automatica AS (
         SELECT DISTINCT ON (r.codigo) r.codigo,
            r.horas,
            r.cuando,
            r.fuente
           FROM ranked r
             JOIN dominante d ON d.codigo = r.codigo AND floor(log(10::numeric, r.horas)) = d.mag
          WHERE r.rn <= 12
          ORDER BY r.codigo, r.cuando DESC, r.horas DESC
        ), manual AS (
         SELECT e.codigo,
            e.horometro_manual AS horas,
            e.horometro_manual_en AS cuando,
            'Manual'::text AS fuente
           FROM equipos e
          WHERE e.horometro_manual IS NOT NULL AND e.horometro_manual > 0::numeric
        )
 SELECT COALESCE(m.codigo, a.codigo) AS codigo,
    COALESCE(m.horas, a.horas) AS horometro,
    COALESCE(m.cuando, a.cuando) AS leido_en,
    COALESCE(m.fuente, a.fuente) AS fuente
   FROM automatica a
     FULL JOIN manual m ON m.codigo = a.codigo;
