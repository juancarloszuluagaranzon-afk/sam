-- Pruebas de 20260918160000_taller_rostro.sql. Correr DENTRO de:
--   begin; <la migración, si todavía no está aplicada> <este archivo> rollback;
-- No deja nada: termina en ROLLBACK. Usa el usuario de pruebas U058 y un dueño (U001).
create temp table r (n serial, caso text, esperado text, obtenido text);

-- Caras sintéticas. A = una persona; S1..S5 = sus 5 muestras (variaciones de A,
-- ~0,11 entre sí); A2 = una toma nueva de la misma persona (~0,14 de las
-- muestras); GRIS ≈ 0,48; B = otra persona (lejos).
create temp table caras as
with v as (
  select k, (select jsonb_agg(round((sin(i) * 0.1 + 0.01 * cos(i * k))::numeric, 5) order by i) from generate_series(1,128) i) as d
    from generate_series(2, 6) k
)
select (select jsonb_agg(d order by k) from v) as muestras,
       (select d from v where k = 2) as s1,
       (select jsonb_agg(round((sin(i) * 0.1 + 0.015 * cos(i * 7))::numeric, 5) order by i) from generate_series(1,128) i) as a2,
       (select jsonb_agg(round((sin(i) * 0.1 + 0.072 * cos(i * 5))::numeric, 5) order by i) from generate_series(1,128) i) as gris,
       (select jsonb_agg(round((cos(i * 3) * 0.1)::numeric, 5) order by i) from generate_series(1,128) i) as b,
       (select jsonb_agg(d) from (select (select jsonb_agg(round((sin(i) * 0.1)::numeric, 5) order by i) from generate_series(1,128) i) d from generate_series(1,5)) x) as identicas;
insert into r (caso, esperado, obtenido) select 'distancias muestra-A2 / muestra-gris / muestra-B', '<0.45 / 0.45-0.52 / >=0.52',
  round(taller_distancia_plantilla(a2, muestras)::numeric,3) || ' / ' || round(taller_distancia_plantilla(gris, muestras)::numeric,3) || ' / ' || round(taller_distancia_plantilla(b, muestras)::numeric,3) from caras;

create temp table otro as select id from app_usuarios where activo and id not in ('U058', 'U001') order by id limit 1;

do $$
declare c caras%rowtype; v jsonb; o text; ver text := taller_consentimiento_vigente()->>'version';
  foto text := 'data:image/jpeg;base64,QUJD';
begin
  select * into c from caras; select id into o from otro;

  begin perform taller_enrolar_rostro('U058', c.muestras, foto, false, ver);
    insert into r (caso, esperado, obtenido) values ('registrar sin autorización', 'error', 'lo dejó pasar');
  exception when others then insert into r (caso, esperado, obtenido) values ('registrar sin autorización', 'error', left(sqlerrm, 40)); end;

  begin perform taller_enrolar_rostro('U058', c.muestras, foto, true, 'version-vieja');
    insert into r (caso, esperado, obtenido) values ('autorización con versión vieja', 'error', 'lo dejó pasar');
  exception when others then insert into r (caso, esperado, obtenido) values ('autorización con versión vieja', 'error', left(sqlerrm, 40)); end;

  begin perform taller_enrolar_rostro('U058', c.muestras, null, true, ver);
    insert into r (caso, esperado, obtenido) values ('registrar sin foto', 'error', 'lo dejó pasar');
  exception when others then insert into r (caso, esperado, obtenido) values ('registrar sin foto', 'error', left(sqlerrm, 40)); end;

  begin perform taller_enrolar_rostro('U058', c.identicas, foto, true, ver);
    insert into r (caso, esperado, obtenido) values ('5 muestras idénticas (una foto quieta)', 'error', 'lo dejó pasar');
  exception when others then insert into r (caso, esperado, obtenido) values ('5 muestras idénticas (una foto quieta)', 'error', left(sqlerrm, 40)); end;

  v := taller_enrolar_rostro('U058', c.muestras, foto, true, ver);
  insert into r (caso, esperado, obtenido) values ('registrar U058', 'PENDIENTE + texto guardado',
    (v->>'estado') || ' + ' || (select case when consentimiento_texto like 'AUTORIZACIÓN%AGROINDUSTRIAL%' then 'texto oficial' else 'OTRO' end from taller_rostros where id = (v->>'id')::uuid));

  begin perform taller_enrolar_rostro(o, c.muestras, foto, true, ver);
    insert into r (caso, esperado, obtenido) values ('la misma cara en otra cuenta', 'error duplicado', 'lo dejó pasar');
  exception when others then insert into r (caso, esperado, obtenido) values ('la misma cara en otra cuenta', 'error duplicado', left(sqlerrm, 55)); end;

  v := taller_marcar(gen_random_uuid(), 'U058', 'ENTRADA', null, 'ROSTRO', null, 4.388136, -76.049045, 10, 'prueba', null, c.a2, foto, 'parpadeo,giro', false);
  insert into r (caso, esperado, obtenido) values ('cara bien, sin aprobar el jefe', 'POR_REVISAR', (v->>'resultado') || ' · ' || coalesce(v->>'revision_motivo',''));

  begin perform taller_revisar_rostro((select id from taller_rostros where usuario_id='U058' and activo), true, o, null);
    insert into r (caso, esperado, obtenido) values ('aprobar sin ser jefe', 'error', 'lo dejó pasar');
  exception when others then insert into r (caso, esperado, obtenido) values ('aprobar sin ser jefe', 'error', left(sqlerrm, 40)); end;

  perform taller_revisar_rostro((select id from taller_rostros where usuario_id='U058' and activo), true, 'U001', null);
  v := taller_marcar(gen_random_uuid(), 'U058', 'SALIDA', null, 'ROSTRO', null, 4.388136, -76.049045, 10, 'prueba', null, c.a2, foto, 'parpadeo,giro', false);
  insert into r (caso, esperado, obtenido) values ('cara bien, aprobada, en el taller', 'OK', (v->>'resultado') || ' d=' || (v->>'distancia'));

  v := taller_marcar(gen_random_uuid(), 'U058', 'ENTRADA', null, 'ROSTRO', null, 4.388136, -76.049045, 10, 'prueba', null, c.gris, foto, 'parpadeo,giro', false);
  insert into r (caso, esperado, obtenido) values ('parecido dudoso', 'POR_REVISAR (dudoso)', (v->>'resultado') || ' · ' || coalesce(v->>'revision_motivo',''));

  v := taller_marcar(gen_random_uuid(), 'U058', 'ENTRADA', null, 'ROSTRO', null, 4.388136, -76.049045, 10, 'prueba', null, c.s1, foto, 'parpadeo,giro', false);
  insert into r (caso, esperado, obtenido) values ('reenvía una muestra guardada', 'POR_REVISAR (idéntica)', (v->>'resultado') || ' · ' || coalesce(v->>'revision_motivo',''));

  v := taller_marcar(gen_random_uuid(), 'U058', 'ENTRADA', null, 'ROSTRO', null, 4.388136, -76.049045, 10, 'prueba', null, c.b, foto, 'parpadeo,giro', false);
  insert into r (caso, esperado, obtenido) values ('otra cara', 'NO_COINCIDE, no se registra', (v->>'resultado') || ' ok=' || (v->>'ok'));

  v := taller_marcar(gen_random_uuid(), 'U058', 'ENTRADA', null, 'ROSTRO', null, 4.388136, -76.049045, 10, 'prueba', null, c.b, foto, 'parpadeo,giro', true);
  insert into r (caso, esperado, obtenido) values ('otra cara, pide revisión', 'POR_REVISAR (no se parece)', (v->>'resultado') || ' · ' || coalesce(v->>'revision_motivo',''));

  v := taller_marcar(gen_random_uuid(), 'U058', 'SALIDA', null, 'ROSTRO', null, 4.6097, -74.0817, 10, 'prueba', null, c.a2, null, 'parpadeo', false);
  insert into r (caso, esperado, obtenido) values ('sin giro, sin foto y fuera del taller', 'POR_REVISAR (3 motivos)', (v->>'resultado') || ' · ' || coalesce(v->>'revision_motivo',''));

  v := taller_marcar(gen_random_uuid(), 'U058', 'ENTRADA', now() - interval '1 hour', 'ROSTRO', null, 4.388136, -76.049045, 10, 'prueba', null, c.a2, foto, 'parpadeo,giro', false);
  insert into r (caso, esperado, obtenido) values ('subió 1 h tarde (sin señal)', 'POR_REVISAR (subió tarde)', (v->>'resultado') || ' · ' || coalesce(v->>'revision_motivo',''));

  v := taller_marcar(gen_random_uuid(), 'U058', 'ENTRADA', null, 'PIN', null, 4.388136, -76.049045, 10, 'prueba', null);
  insert into r (caso, esperado, obtenido) values ('sin verificar (firma vieja de 11)', 'POR_REVISAR', (v->>'resultado') || ' · ' || coalesce(v->>'revision_motivo',''));

  v := taller_marcar(gen_random_uuid(), 'U058', 'SALIDA', null, 'HUELLA', null, 4.388136, -76.049045, 10, 'prueba', null);
  insert into r (caso, esperado, obtenido) values ('huella, firma vieja, en el taller', 'OK', v->>'resultado');

  -- El jefe revisa: una aceptada, una anulada.
  perform taller_revisar_marcacion((select id from taller_marcaciones where usuario_id='U058' and dispositivo='prueba' and revision_motivo like 'parecido dudoso%' limit 1), true, 'U001', null);
  perform taller_revisar_marcacion((select id from taller_marcaciones where usuario_id='U058' and dispositivo='prueba' and revision_motivo like 'la cara no se parece%' limit 1), false, 'U001', 'no es él');
  insert into r (caso, esperado, obtenido)
  select 'jefe acepta la dudosa y anula la de otra cara', 'aceptada / anulada',
    (select case when not requiere_revision and revisado_por='U001' then 'aceptada' else '?' end from taller_marcaciones where dispositivo='prueba' and revision_motivo like 'parecido dudoso%')
    || ' / ' || (select case when anulada then 'anulada' else '?' end from taller_marcaciones where dispositivo='prueba' and revision_motivo like 'la cara no se parece%');

  begin perform taller_revisar_marcacion((select id from taller_marcaciones where usuario_id='U058' and dispositivo='prueba' and requiere_revision limit 1), true, 'U058', null);
    insert into r (caso, esperado, obtenido) values ('revisar su propia marcación', 'error', 'lo dejó pasar');
  exception when others then insert into r (caso, esperado, obtenido) values ('revisar su propia marcación', 'error', left(sqlerrm, 40)); end;

  -- Retirar la autorización: la plantilla se suprime.
  perform taller_revocar_rostro('U058');
  insert into r (caso, esperado, obtenido)
  select 'retira la autorización', 'inactiva y sin descriptores',
    case when not activo and revocado_en is not null and jsonb_array_length(descriptores) = 0 then 'inactiva y sin descriptores' else 'NO' end
    from taller_rostros where usuario_id = 'U058' order by creado_en desc limit 1;
end $$;

do $$
declare lee_desc text; lee_estado text;
begin
  set local role anon;
  begin perform descriptores from public.taller_rostros limit 1; lee_desc := 'LOS LEYÓ';
  exception when insufficient_privilege then lee_desc := 'permiso denegado'; end;
  begin perform estado, foto_mini from public.taller_rostros limit 1; lee_estado := 'sí';
  exception when insufficient_privilege then lee_estado := 'NO'; end;
  reset role;
  insert into r (caso, esperado, obtenido) values ('el celular lee las plantillas', 'permiso denegado', lee_desc);
  insert into r (caso, esperado, obtenido) values ('el celular lee estado y foto', 'sí', lee_estado);
end $$;

insert into r (caso, esperado, obtenido)
select 'marcaciones creadas / por revisar / fotos', '9 / 5 / 6',
       count(*) || ' / ' || count(*) filter (where requiere_revision and not anulada) || ' / ' ||
       (select count(*) from taller_marcacion_fotos f join taller_marcaciones m on m.id = f.marcacion_id where m.dispositivo = 'prueba')
  from taller_marcaciones where usuario_id = 'U058' and dispositivo = 'prueba';

select n, caso, esperado, obtenido from r order by n;
