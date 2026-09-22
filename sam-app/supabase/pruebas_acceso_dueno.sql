-- Pruebas del acceso del dueño y las llaves (20260922150000).
-- Correr DESPUÉS de las dos migraciones de fincas, dentro de begin … rollback.
-- No usa ningún PIN real: crea un usuario temporal (TST_AF) con su propio PIN y
-- sesiones directas para usuarios reales, todo se deshace al final.

create temp table r (n serial, caso text, esperado text, obtenido text);
create temp table k (k text primary key, v text);

create or replace function pg_temp.prueba(p_caso text, p_esperado text, p_sql text) returns void
language plpgsql as $$
declare v text;
begin
  perform set_config('af.via_funcion', '', true);
  begin
    execute p_sql into v;
    insert into r (caso, esperado, obtenido) values (p_caso, p_esperado, coalesce('ok ' || v, 'ok'));
  exception when others then
    insert into r (caso, esperado, obtenido) values (p_caso, p_esperado, split_part(sqlerrm, ':', 1));
  end;
end $$;

-- Usuario temporal con PIN conocido (se deshace con el rollback)
insert into app_usuarios (id, nombre_completo, rol, pin_hash, activo, es_prueba)
values ('TST_AF', 'PRUEBA LLAVES', 'administracion', md5('4321:sam-piloto'), true, true),
       ('TST_OP', 'PRUEBA OPERADOR', 'operador', md5('1111:sam-piloto'), true, true);

-- Sesiones directas (llaves de prueba) para actores reales
insert into af_sesiones (token_hash, usuario_id, expira_en) values
  (af_hash('llave-admin'), 'U005', now() + interval '1 day'),
  (af_hash('llave-sup-a'), 'U002', now() + interval '1 day'),
  (af_hash('llave-sup-b'), 'U033', now() + interval '1 day'),
  (af_hash('llave-operador'), 'U009', now() + interval '1 day'),
  (af_hash('llave-vencida'), 'U005', now() - interval '1 minute');

-- ── Abrir sesión con el PIN ──
select pg_temp.prueba('PIN errado devuelve vacío (no error)', 'ok', $q$select coalesce(af_abrir_sesion('TST_AF', '0000'), 'vacío')$q$);
select pg_temp.prueba('PIN correcto da una llave de 64', 'ok 64', $q$select length(af_abrir_sesion('TST_AF', '4321'))::text$q$);
select pg_temp.prueba('operador con su PIN bueno no abre sesión de fincas', 'SIN_PERMISO', $q$select af_abrir_sesion('TST_OP', '1111')$q$);
insert into af_intentos (usuario_id) select 'TST_AF' from generate_series(1, 5);
select pg_temp.prueba('tras 5 PIN errados, bloqueo', 'BLOQUEADO', $q$select af_abrir_sesion('TST_AF', '4321')$q$);

-- ── Llaves en las funciones ──
select pg_temp.prueba('sin llave no se leen las fincas', 'SIN_SESION', $q$select af_datos('inventada')::text$q$);
select pg_temp.prueba('llave vencida', 'SIN_SESION', $q$select af_datos('llave-vencida')::text$q$);
select pg_temp.prueba('operador con llave no lee fincas', 'SIN_PERMISO', $q$select af_datos('llave-operador')::text$q$);
select pg_temp.prueba('supervisor no crea fincas', 'SIN_PERMISO',
  $q$select af_guardar_finca('llave-sup-a', null, '{"nombre":"X","dueno_nombre":"Y"}')::text$q$);

-- Dos fincas de prueba, cada una con su dueño
insert into k select 'f1', af_guardar_finca('llave-admin', null, '{"nombre":"PRUEBA ACCESO UNO","dueno_nombre":"DUEÑO UNO","honorario_modo":"POR_DEFINIR"}')::text;
insert into k select 'f2', af_guardar_finca('llave-admin', null, '{"nombre":"PRUEBA ACCESO DOS","dueno_nombre":"DUEÑO DOS"}')::text;
select pg_temp.prueba('la finca queda a nombre de quien tiene la llave, no de lo que diga el celular', 'ok U005',
  $q$select editado_por from af_fincas where id = (select v::uuid from k where k = 'f1')$q$);
select af_agregar_suertes('llave-admin', (select v::uuid from k where k = 'f1'), '[{"codigo":"1","area_ha":10}]');
select af_agregar_suertes('llave-admin', (select v::uuid from k where k = 'f2'), '[{"codigo":"9","area_ha":5}]');
insert into k select 's1', id::text from af_suertes where finca_id = (select v::uuid from k where k = 'f1');
insert into k select 'c1', af_abrir_ciclo('llave-admin', (select v::uuid from k where k = 's1'), '2026-09-01', 'SOCA')::text;
insert into k select 'l1', id::text from af_labores where ciclo_id = (select v::uuid from k where k = 'c1') and labor = 'ROTURACIÓN';
select af_actualizar_labor('llave-admin', (select v::uuid from k where k = 'l1'), null, 100000);
insert into k values ('rep', gen_random_uuid()::text);
select pg_temp.prueba('supervisor A reporta con su llave', 'ok',
  $q$select 'x' from (select af_reportar('llave-sup-a', (select v::uuid from k where k = 'rep'), (select v::uuid from k where k = 'l1'), 4, '2026-09-10', 'https://x/f.jpg', null, null, null, '')) s$q$);
select pg_temp.prueba('el reporte queda a nombre de U002 (de la llave)', 'ok U002',
  $q$select reportado_por from af_reportes where id = (select v::uuid from k where k = 'rep')$q$);
select pg_temp.prueba('supervisor A no acepta lo suyo', 'NO_PROPIO',
  $q$select af_revisar('llave-sup-a', (select v::uuid from k where k = 'rep'), true, '')$q$);
select pg_temp.prueba('supervisor B acepta', 'ok ACEPTADO',
  $q$select af_revisar('llave-sup-b', (select v::uuid from k where k = 'rep'), true, '')$q$);

-- ── Enlaces del dueño ──
select pg_temp.prueba('supervisor no crea enlaces de dueño', 'SIN_PERMISO',
  $q$select af_crear_acceso('llave-sup-a', (select v::uuid from k where k = 'f1'), 'x')$q$);
insert into k select 'dueno1', af_crear_acceso('llave-admin', (select v::uuid from k where k = 'f1'), 'DUEÑO UNO');
select pg_temp.prueba('la base guarda la huella, no la llave', 'ok 0',
  $q$select count(*)::text from af_accesos where token_hash = (select v from k where k = 'dueno1')$q$);
select pg_temp.prueba('el dueño ve SOLO su finca', 'ok PRUEBA ACCESO UNO',
  $q$select string_agg(x ->> 'nombre', ',') from jsonb_array_elements(af_datos((select v from k where k = 'dueno1')) -> 'fincas') x$q$);
select pg_temp.prueba('el dueño ve su labor aceptada y el gasto', 'ok 1 reporte · 1 movimiento',
  $q$select jsonb_array_length(d -> 'reportes') || ' reporte · ' || jsonb_array_length(d -> 'movimientos') || ' movimiento' from (select af_datos((select v from k where k = 'dueno1')) d) z$q$);
select pg_temp.prueba('el dueño no ve el paquete ni los enlaces', 'ok 0 · 0',
  $q$select jsonb_array_length(d -> 'paquete') || ' · ' || jsonb_array_length(d -> 'accesos') from (select af_datos((select v from k where k = 'dueno1')) d) z$q$);
select pg_temp.prueba('el dueño recibe los nombres de quien reportó y aceptó', 'ok 2',
  $q$select (select count(*) from jsonb_object_keys(af_datos((select v from k where k = 'dueno1')) -> 'nombres'))::text$q$);
select pg_temp.prueba('el dueño no escribe (crear finca)', 'SIN_PERMISO',
  $q$select af_guardar_finca((select v from k where k = 'dueno1'), null, '{"nombre":"X","dueno_nombre":"Y"}')::text$q$);
select pg_temp.prueba('el dueño no acepta ni reporta', 'SIN_PERMISO',
  $q$select af_revisar((select v from k where k = 'dueno1'), (select v::uuid from k where k = 'rep'), true, '')$q$);
select pg_temp.prueba('queda registrado cuándo entró el dueño (4 lecturas en esta prueba)', 'ok 4',
  $q$select usos::text from af_accesos where finca_id = (select v::uuid from k where k = 'f1')$q$);
select pg_temp.prueba('administración ve el enlace (sin la llave)', 'ok false',
  $q$select (x ? 'token_hash')::text from jsonb_array_elements(af_datos('llave-admin') -> 'accesos') x limit 1$q$);
select pg_temp.prueba('administración revoca el enlace', 'ok',
  $q$select 'x' from (select af_revocar_acceso('llave-admin', (select id from af_accesos where finca_id = (select v::uuid from k where k = 'f1')))) s$q$);
select pg_temp.prueba('enlace revocado ya no abre', 'SIN_SESION',
  $q$select af_datos((select v from k where k = 'dueno1'))::text$q$);

-- ── La puerta directa está cerrada para la app ──
select n, caso, esperado, obtenido, case when obtenido = esperado or obtenido like esperado || '%' then '✓' else '✗' end as ok from r order by n;

set local role anon;
do $$
begin
  begin perform count(*) from af_fincas; raise notice 'ANON_LEE_TABLA: ✗ pudo leer';
  exception when others then raise notice 'ANON_LEE_TABLA: ✓ %', split_part(sqlerrm, ' for ', 1); end;
  begin perform count(*) from af_accesos; raise notice 'ANON_LEE_ACCESOS: ✗ pudo leer';
  exception when others then raise notice 'ANON_LEE_ACCESOS: ✓ %', split_part(sqlerrm, ' for ', 1); end;
  begin perform public.af__revisar(gen_random_uuid(), true, '', 'U005'); raise notice 'ANON_FUNCION_INTERNA: ✗ pudo';
  exception when others then raise notice 'ANON_FUNCION_INTERNA: ✓ %', split_part(sqlerrm, ' for ', 1); end;
  begin perform public.af_datos('inventada'); raise notice 'ANON_DATOS_SIN_LLAVE: ✗ pudo';
  exception when others then raise notice 'ANON_DATOS_SIN_LLAVE: ✓ %', split_part(sqlerrm, ':', 1); end;
end $$;
reset role;
