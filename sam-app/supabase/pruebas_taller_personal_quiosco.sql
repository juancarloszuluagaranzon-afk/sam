-- Pruebas de 20261025160000_taller_personal_quiosco.sql. Correr DENTRO de:
--   begin; <la migración, si todavía no está aplicada> <este archivo> rollback;
-- No deja nada: termina en ROLLBACK. Usa el mecánico de pruebas U058 y un dueño (U001).
create temp table r (n serial, caso text, esperado text, obtenido text);

-- Las mismas caras sintéticas de pruebas_taller_rostro.sql: S = 5 muestras de A,
-- A2 = una toma nueva de A (~0,14), B = otra persona.
create temp table caras as
with v as (
  select k, (select jsonb_agg(round((sin(i) * 0.1 + 0.01 * cos(i * k))::numeric, 5) order by i) from generate_series(1,128) i) as d
    from generate_series(2, 6) k
)
select (select jsonb_agg(d order by k) from v) as muestras,
       (select jsonb_agg(round((sin(i) * 0.1 + 0.015 * cos(i * 7))::numeric, 5) order by i) from generate_series(1,128) i) as a2;

-- El PIN del mecánico de pruebas, solo dentro de esta transacción.
update app_usuarios set pin_hash = md5('4321:sam-piloto') where id = 'U058';
-- Sin caras previas de U058 (si alguien probó antes) para que el conteo sea limpio.
update taller_rostros set activo = false where usuario_id = 'U058';

do $$
declare c caras%rowtype; v jsonb; ver text := taller_consentimiento_vigente()->>'version';
  foto text := 'data:image/jpeg;base64,QUJD'; q text; antes int; otro text;
begin
  select * into c from caras;
  select id into otro from app_usuarios where activo and rol = 'operador' order by id limit 1;

  -- ── El rol nuevo ──
  perform app_create_user('QX', 'QUIOSCO TALLER PRUEBA', 'quiosco_taller', '9999', null, null, null);
  select id into q from app_usuarios where nombre_completo = 'QUIOSCO TALLER PRUEBA' and activo order by created_at desc limit 1;
  insert into r (caso, esperado, obtenido) values ('crear usuario con rol quiosco_taller', 'se crea', coalesce(q, 'NO SE CREÓ'));
  begin update app_usuarios set rol = 'inventado' where id = q;
    insert into r (caso, esperado, obtenido) values ('rol que no existe', 'error', 'lo dejó pasar');
  exception when others then insert into r (caso, esperado, obtenido) values ('rol que no existe', 'error', left(sqlerrm, 40)); end;

  -- ── Ficha del mecánico ──
  begin perform taller_guardar_personal('U058', 'mecánico', '3000000000', otro);
    insert into r (caso, esperado, obtenido) values ('ficha guardada por quien no es jefe', 'error', 'lo dejó pasar');
  exception when others then insert into r (caso, esperado, obtenido) values ('ficha guardada por quien no es jefe', 'error', left(sqlerrm, 40)); end;
  begin perform taller_guardar_personal(otro, 'MECÁNICO', null, 'U001');
    insert into r (caso, esperado, obtenido) values ('ficha de quien no es del taller', 'error', 'lo dejó pasar');
  exception when others then insert into r (caso, esperado, obtenido) values ('ficha de quien no es del taller', 'error', left(sqlerrm, 40)); end;
  perform taller_guardar_personal('U058', ' mecánico ', '3000000000', 'U001');
  perform taller_guardar_personal('U058', 'soldador', '', 'U001');
  insert into r (caso, esperado, obtenido) select 'ficha por el jefe (y se corrige)', 'SOLDADOR · sin teléfono · U001',
    cargo || ' · ' || coalesce(telefono, 'sin teléfono') || ' · ' || actualizado_por from taller_personal where usuario_id = 'U058';

  -- ── Registrar la cara ──
  v := taller_enrolar_rostro('U058', c.muestras, foto, true, ver);
  insert into r (caso, esperado, obtenido) values ('la registra él solo (como antes)', 'PENDIENTE', v->>'estado');
  begin perform taller_enrolar_rostro('U058', c.muestras, foto, true, ver, otro);
    insert into r (caso, esperado, obtenido) values ('«jefe» que no es jefe', 'error', 'lo dejó pasar');
  exception when others then insert into r (caso, esperado, obtenido) values ('«jefe» que no es jefe', 'error', left(sqlerrm, 40)); end;
  begin perform taller_enrolar_rostro('U001', c.muestras, foto, true, ver, 'U001');
    insert into r (caso, esperado, obtenido) values ('el jefe se registra a sí mismo', 'error', 'lo dejó pasar');
  exception when others then insert into r (caso, esperado, obtenido) values ('el jefe se registra a sí mismo', 'error', left(sqlerrm, 45)); end;
  v := taller_enrolar_rostro('U058', c.muestras, foto, true, ver, 'U001');
  insert into r (caso, esperado, obtenido) select 'la registra el jefe en persona', 'APROBADO · U001 · U001 · 1 activa',
    (v->>'estado') || ' · ' || revisado_por || ' · ' || enrolado_por || ' · ' ||
    (select count(*) from taller_rostros where usuario_id = 'U058' and activo) || ' activa'
    from taller_rostros where id = (v->>'id')::uuid;

  -- ── Marcar desde el quiosco ──
  v := taller_marcar(gen_random_uuid(), 'U058', 'ENTRADA', null, 'ROSTRO', null, null, null, null, 'Quiosco', null, c.a2, foto, 'parpadeo,giro', false, q);
  insert into r (caso, esperado, obtenido) select 'quiosco, sin GPS, cara bien', 'OK · quiosco guardado',
    (v->>'resultado') || ' · ' || case when quiosco_id = q then 'quiosco guardado' else 'SIN quiosco' end
    from taller_marcaciones where id = (v->>'id')::uuid;
  v := taller_marcar(gen_random_uuid(), 'U058', 'SALIDA', null, 'ROSTRO', null, null, null, null, 'celular', null, c.a2, foto, 'parpadeo,giro', false);
  insert into r (caso, esperado, obtenido) values ('celular propio, sin GPS (como antes)', 'POR_REVISAR (sin ubicación)', (v->>'resultado') || ' · ' || coalesce(v->>'revision_motivo', ''));
  v := taller_marcar(gen_random_uuid(), 'U058', 'ENTRADA', null, 'ROSTRO', null, 4.5, -76.2, 20, 'Quiosco', null, c.a2, foto, 'parpadeo,giro', false, q);
  insert into r (caso, esperado, obtenido) values ('quiosco que se llevaron lejos', 'POR_REVISAR (fuera del taller)', (v->>'resultado') || ' · ' || coalesce(v->>'revision_motivo', ''));
  v := taller_marcar(gen_random_uuid(), 'U058', 'SALIDA', null, 'ROSTRO', null, null, null, null, 'Quiosco', null, c.a2, foto, 'parpadeo,giro', false, 'U001');
  insert into r (caso, esperado, obtenido) values ('«quiosco» que no es quiosco', 'POR_REVISAR (no reconocido)', (v->>'resultado') || ' · ' || coalesce(v->>'revision_motivo', ''));

  -- ── El PIN ──
  select count(*) into antes from taller_marcaciones where usuario_id = 'U058';
  v := taller_marcar(gen_random_uuid(), 'U058', 'ENTRADA', null, 'PIN', null, null, null, null, 'Quiosco', null, null, null, null, false, q, '1111');
  insert into r (caso, esperado, obtenido) select 'PIN equivocado', 'PIN_INCORRECTO · no se registró',
    (v->>'resultado') || ' · ' || case when count(*) = antes then 'no se registró' else 'SÍ SE REGISTRÓ' end
    from taller_marcaciones where usuario_id = 'U058';
  v := taller_marcar(gen_random_uuid(), 'U058', 'ENTRADA', null, 'PIN', null, null, null, null, 'Quiosco', null, null, null, null, false, q, '4321');
  insert into r (caso, esperado, obtenido) values ('PIN correcto', 'POR_REVISAR (con PIN, sin la cara)', (v->>'resultado') || ' · ' || coalesce(v->>'revision_motivo', ''));
  v := taller_marcar(gen_random_uuid(), 'U058', 'SALIDA', null, 'PIN', null, null, null, null, 'Quiosco', null, null, null, null, false, q, null);
  insert into r (caso, esperado, obtenido) values ('PIN que llega de la cola (sin el PIN)', 'POR_REVISAR (sin verificar)', (v->>'resultado') || ' · ' || coalesce(v->>'revision_motivo', ''));

  -- ── Compatibilidad: la PWA vieja llama con 15 argumentos ──
  v := taller_marcar(p_id => gen_random_uuid(), p_usuario_id => 'U058', p_tipo => 'ENTRADA', p_metodo => 'ROSTRO',
                     p_lat => 4.388136, p_lng => -76.049045, p_precision_m => 10, p_descriptor => c.a2,
                     p_foto_mini => foto, p_pruebas_vida => 'parpadeo,giro', p_forzar_revision => false);
  insert into r (caso, esperado, obtenido) values ('llamada vieja, en el taller, cara bien', 'OK', v->>'resultado');
  v := taller_marcar((select id from taller_marcaciones where usuario_id = 'U058' and quiosco_id = q order by registrado_en limit 1),
                     'U058', 'ENTRADA', null, 'ROSTRO', null, null, null, null, 'Quiosco', null, c.a2, foto, 'parpadeo,giro', false, q);
  insert into r (caso, esperado, obtenido) values ('reintento del quiosco (mismo id)', 'repetida', case when (v->>'repetida')::boolean then 'repetida' else 'DUPLICÓ' end);
end $$;

-- ── Permisos que ve la app ──
insert into r (caso, esperado, obtenido)
select 'la app lee la ficha, enrolado_por y NO las plantillas', 'true · true · false',
       has_table_privilege('anon', 'public.taller_personal', 'select') || ' · ' ||
       has_column_privilege('anon', 'public.taller_rostros', 'enrolado_por', 'select') || ' · ' ||
       has_column_privilege('anon', 'public.taller_rostros', 'descriptores', 'select');

select n, caso, esperado, obtenido from r order by n;
