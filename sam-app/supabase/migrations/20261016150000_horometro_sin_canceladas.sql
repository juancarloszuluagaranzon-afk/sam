-- ============================================================================
-- El horómetro de una labor CANCELADA ya no es lectura de la máquina (16-oct-2026).
--
-- Caso: al borrar una prueba de U039 «Operador pruebas» en la TRC-1 apareció que
-- su horómetro (1236) era la lectura VIGENTE de la máquina, aunque la labor ya
-- estaba rechazada. Rechazar deja la labor en estado CANCELADA, y la parte de
-- `asignaciones` de esta vista no miraba el estado — la de solicitudes sí.
-- Y muchas labores se rechazan justo POR el horómetro (`4490 → 1190`,
-- `10733,2 → 1073,5`): son las lecturas que menos deben servir de referencia.
--
-- Medido ese día: 47 labores canceladas con horómetro final en 16 máquinas;
-- 3 entre las 12 últimas de su máquina (votan la magnitud dominante) y ninguna
-- era ya la vigente (la de la TRC-1 se borró a mano). Esta vista es la
-- referencia del preventivo, del aviso de 24 h y del gal/hora.
--
-- Copia completa de `20260918140000_horometro_lee_entregas.sql` (comprobada
-- contra la vista en producción: las 23 máquinas dan lo mismo). Solo se agrega
-- el filtro de estado en la parte de labores.
-- ============================================================================

create or replace view public.equipo_horometro_v as
 WITH lecturas AS (
         SELECT a_1.equipo_codigo AS codigo,
            a_1.horometro_final AS horas,
            COALESCE(a_1.fecha_fin, a_1.fecha_inicio) AS cuando,
            'Labor'::text AS fuente
           FROM asignaciones a_1
          WHERE a_1.equipo_codigo IS NOT NULL AND a_1.horometro_final IS NOT NULL
            -- 🆕 Rechazada o anulada = no ocurrió. `is distinct from` deja pasar
            -- una labor sin estado: no saberlo no es lo mismo que cancelada.
            AND a_1.estado IS DISTINCT FROM 'CANCELADA'::text
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

-- Comprobación: Studio muestra este resultado al terminar. Debe decir
-- filtro_puesto = true y maquinas = 23 (las mismas de antes; una más solo si
-- entretanto alguien registró una máquina nueva).
select position('CANCELADA' in split_part(pg_get_viewdef('public.equipo_horometro_v'), 'combustible_externo', 1)) > 0 as filtro_puesto,
       (select count(*) from public.equipo_horometro_v) as maquinas;
