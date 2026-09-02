-- =====================================================================
-- MÓDULO CASOS DE SOPORTE — fallas y peticiones de la app SAM.
--
-- Tres tablas y una de declaración semanal:
--   soporte_casos       cabecera: nace con UN dato (severidad) y crece hablando
--   soporte_mensajes    la conversación; NO hay notas internas (ver abajo)
--   soporte_eventos     bitácora inmutable: de aquí salen TODOS los tiempos
--   soporte_contactos_semana  declaración manual de lo que entró por WhatsApp
--
-- 🔴 DECISIÓN DE PERMISOS, distinta al resto del proyecto:
--    La app tiene SOLO `select` sobre estas tablas. Toda escritura pasa por
--    RPC `security definer`. Razón: `recibido_en_servidor` y
--    `primera_respuesta_en` son las dos columnas de las que cuelga el tablero
--    entero. Si el cliente pudiera escribirlas, el tablero mediría la
--    disciplina de quien programa el cliente, no el servicio. Como no hay
--    Supabase Auth en este proyecto (el login es la RPC `app_login`) y por
--    tanto no hay `auth.uid()` sobre el cual construir RLS por usuario, cerrar
--    el GRANT es la ÚNICA barrera real disponible.
--
-- ⚠️ Una tabla nueva NO hereda los GRANT: sin las líneas de GRANT de abajo la
--    app responde "permission denied" aunque la policy exista.
-- =====================================================================

-- ── 1.1 Horas hábiles ────────────────────────────────────────────────
-- No es un "motor de SLA": son 15 líneas. Cuenta las horas entre 06:00 y 18:00
-- de lunes a sábado, zona America/Bogota.
-- ⚠️ NO descuenta los ~18 festivos colombianos. Está documentado a propósito y
--    el tablero lo dice al pie: un lunes festivo infla el cumplimiento a favor
--    de soporte. Si algún día molesta, se agrega una tabla `festivos` y se
--    cambia SOLO esta función.
create or replace function public.soporte_horas_habiles(
  p_desde timestamptz,
  p_hasta timestamptz
) returns numeric
language sql
stable
as $$
  select coalesce(sum(
    greatest(0, extract(epoch from (
        least(p_hasta,  ((g.d::date + time '18:00') at time zone 'America/Bogota'))
      - greatest(p_desde,((g.d::date + time '06:00') at time zone 'America/Bogota'))
    )) / 3600.0)
  ), 0)::numeric
  from generate_series(
         date_trunc('day', p_desde at time zone 'America/Bogota'),
         date_trunc('day', p_hasta at time zone 'America/Bogota'),
         interval '1 day') as g(d)
  where extract(isodow from g.d) between 1 and 6
    and p_hasta > p_desde;
$$;

comment on function public.soporte_horas_habiles is
  'Horas entre 06:00 y 18:00, lunes a sabado, America/Bogota. NO descuenta festivos.';

-- ── 1.2 Cabecera ─────────────────────────────────────────────────────
create table if not exists public.soporte_casos (
  id                       uuid primary key default gen_random_uuid(),

  -- Folio visible. Lo genera el CELULAR al encolar, para poder darle un número
  -- al operario ANTES de que haya señal. Lleva el id del usuario adentro, así
  -- que dos personas reportando en el mismo minuto NO chocan; el choque solo es
  -- posible con la misma persona en el mismo segundo, y para eso está el
  -- re-sufijo de `soporte_crear_caso`.
  folio                    text not null unique,

  -- Quién SUFRE la falla. Es el dueño del caso para efectos de la pantalla.
  creado_por               text not null,
  creado_por_nombre        text,
  -- Rol congelado: los roles cambian, el caso no.
  rol_creador              text,
  -- Quién lo DIGITÓ. NULL = lo reportó él mismo. Se llena cuando soporte o un
  -- supervisor levanta el caso del que no escribe. Separado para no inflar
  -- "reportes por app".
  registrado_por           text,

  origen                   text not null default 'app',
  -- La pone soporte. NULL mientras nadie lo haya leído: no inventamos
  -- clasificación. 'peticion' saca el caso de los contadores de fallas.
  tipo                     text,

  -- Lo ÚNICO obligatorio que aporta el operario, y es un hecho observable, no
  -- una prioridad: él sabe si puede seguir trabajando, no sabe el impacto.
  severidad                text not null,
  -- Solo si soporte la corrige. NULL = estuvieron de acuerdo.
  severidad_final          text,
  categoria                text,

  -- Los DOS relojes. El del dispositivo dice cuándo pasó; el del servidor es el
  -- único desde el que se juzga a soporte. Un caso dictado a las 6 a.m. sin
  -- cobertura y subido a las 4 p.m. no puede nacer incumplido.
  creado_en_dispositivo    timestamptz not null,
  recibido_en_servidor     timestamptz not null default now(),

  texto                    text,
  foto_url                 text,

  -- Contexto automático. Estas cuatro salen a columna propia porque el tablero
  -- las agrupa todos los meses; lo demás va en jsonb y nadie lo agrupa.
  pantalla                 text,
  app_version              text,
  equipo                   text,
  -- El dato más útil que existe, y solo aparece cuando el caso nace de
  -- PantallaSegura: sin él un caso de pantalla caída es un caso a ciegas.
  error_mensaje            text,
  contexto                 jsonb,

  estado                   text not null default 'nuevo',
  atendido_por             text,

  primera_respuesta_en     timestamptz,   -- NULL = todavía nadie contestó. Nunca 0.
  resuelto_en              timestamptz,
  cerrado_en               timestamptz,
  razon_cierre             text,
  -- Tri-estado a propósito: NULL = SILENCIO. El silencio no es "quedó bien".
  confirmado_por_operario  boolean,

  -- Duplicado = FUSIÓN. No existe "rechazado" en ninguna parte de este módulo.
  fusionado_en             uuid references public.soporte_casos(id),
  -- La versión donde salió el arreglo. La escribe la RPC de resolver, no la
  -- buena voluntad de nadie.
  version_corregida        text,

  updated_at               timestamptz not null default now()
);

do $$ begin
  begin alter table public.soporte_casos add constraint soporte_casos_origen_chk
    check (origen in ('app','whatsapp','telefono'));
  exception when duplicate_object then null; end;
  begin alter table public.soporte_casos add constraint soporte_casos_tipo_chk
    check (tipo is null or tipo in ('falla','peticion'));
  exception when duplicate_object then null; end;
  begin alter table public.soporte_casos add constraint soporte_casos_sev_chk
    check (severidad in ('parado','con_problemas','puede_esperar'));
  exception when duplicate_object then null; end;
  begin alter table public.soporte_casos add constraint soporte_casos_sevf_chk
    check (severidad_final is null
           or severidad_final in ('parado','con_problemas','puede_esperar'));
  exception when duplicate_object then null; end;
  begin alter table public.soporte_casos add constraint soporte_casos_estado_chk
    check (estado in ('nuevo','revisando','falta_dato','resuelto','cerrado'));
  exception when duplicate_object then null; end;
  begin alter table public.soporte_casos add constraint soporte_casos_razon_chk
    check (razon_cierre is null or razon_cierre in
      ('resuelto','no_era_falla','no_se_pudo_repetir','no_es_de_la_app',
       'quedo_anotada','sin_respuesta','va_con_otro_caso'));
  exception when duplicate_object then null; end;
  -- Coherencia dura: no se puede estar resuelto sin hora de resuelto, ni
  -- cerrado sin haber estado resuelto.
  begin alter table public.soporte_casos add constraint soporte_casos_resuelto_chk
    check (estado not in ('resuelto','cerrado') or resuelto_en is not null);
  exception when duplicate_object then null; end;
  begin alter table public.soporte_casos add constraint soporte_casos_cerrado_chk
    check (cerrado_en is null or resuelto_en is not null);
  exception when duplicate_object then null; end;
  begin alter table public.soporte_casos add constraint soporte_casos_fusion_chk
    check (fusionado_en is null or fusionado_en <> id);
  exception when duplicate_object then null; end;
end $$;

comment on table  public.soporte_casos is
  'Casos de soporte de la app reportados por campo. No existe estado rechazado.';
comment on column public.soporte_casos.recibido_en_servidor is
  'Unico reloj valido para juzgar el servicio. Lo pone el servidor; el cliente no puede escribirlo.';
comment on column public.soporte_casos.confirmado_por_operario is
  'NULL = el operario no contesto. NULL NO significa que quedo bien.';
comment on column public.soporte_casos.registrado_por is
  'NULL = lo reporto el mismo. Con valor = alguien lo levanto por el (captura de WhatsApp).';

create index if not exists soporte_casos_bandeja_ix
  on public.soporte_casos (estado, recibido_en_servidor)
  where estado in ('nuevo','revisando','falta_dato');
create index if not exists soporte_casos_mios_ix
  on public.soporte_casos (creado_por, recibido_en_servidor desc);
create index if not exists soporte_casos_fecha_ix
  on public.soporte_casos (recibido_en_servidor desc);
create index if not exists soporte_casos_pantalla_ix
  on public.soporte_casos (pantalla, recibido_en_servidor desc);
-- Agrupación de avalancha: misma pantalla + misma versión el mismo día.
create index if not exists soporte_casos_avalancha_ix
  on public.soporte_casos (pantalla, app_version, recibido_en_servidor);
-- Delta sync para el aviso al operario.
create index if not exists soporte_casos_updated_ix
  on public.soporte_casos (updated_at);

-- ── 1.3 Conversación ─────────────────────────────────────────────────
-- ⚠️ NO hay columna `interno` ni `visible_para_operario`. Con la anon_key en el
--    bundle y sin auth.uid(), esconder en la UI NO es esconder: sería abrir un
--    canal privado que este backend no puede mantener privado. Todo lo que se
--    escribe aquí lo puede leer el operario, y eso es lo que se le dice a
--    soporte en la pantalla.
create table if not exists public.soporte_mensajes (
  id                     uuid primary key default gen_random_uuid(),
  caso_id                uuid not null references public.soporte_casos(id) on delete cascade,
  autor_id               text not null,
  autor_nombre           text,
  autor_rol              text,
  texto                  text,
  foto_url               text,
  -- El acuse automático y los avisos de cambio de estado. NUNCA cuentan como
  -- primera respuesta: publicar un acuse para parar el reloj es el modo más
  -- fácil de falsear un SLA y aquí es imposible por construcción.
  es_sistema             boolean not null default false,
  creado_en_dispositivo  timestamptz not null,
  recibido_en_servidor   timestamptz not null default now()
);
create index if not exists soporte_mensajes_caso_ix
  on public.soporte_mensajes (caso_id, recibido_en_servidor);

comment on column public.soporte_mensajes.es_sistema is
  'true = acuse o aviso automatico. No cuenta como primera respuesta humana.';

-- ── 1.4 Bitácora ─────────────────────────────────────────────────────
-- La escriben triggers, no la app. De aquí salen la pausa del reloj y las
-- reaperturas: no se guardan como columnas para que el tablero y la auditoría
-- no puedan decir cosas distintas.
create table if not exists public.soporte_eventos (
  id          bigserial primary key,
  caso_id     uuid not null references public.soporte_casos(id) on delete cascade,
  tipo        text not null,   -- estado|severidad|categoria|fusion|reapertura|correccion
  de          text,
  a           text,
  actor_id    text,            -- NULL = automático
  automatico  boolean not null default false,
  creado_en   timestamptz not null default now()
);
create index if not exists soporte_eventos_caso_ix
  on public.soporte_eventos (caso_id, creado_en);

-- ── 1.5 Declaración semanal de contactos ─────────────────────────────
-- 🔴 Esto es una DECLARACIÓN, no una medición, y el tablero lo rotula así.
--    Sirve de termómetro, NO dispara el criterio de rediseño (ese cuelga de
--    origen='app' vs origen='whatsapp', que sí es dato interno).
create table if not exists public.soporte_contactos_semana (
  semana        date primary key,   -- lunes de la semana, America/Bogota
  whatsapp      int not null default 0,
  telefono      int not null default 0,
  declarado_por text,
  declarado_en  timestamptz not null default now(),
  nota          text
);

-- ── 1.6 Triggers ─────────────────────────────────────────────────────
-- El actor se pasa por variable de sesión desde cada RPC.
create or replace function public.soporte_actor() returns text
language sql stable as $$ select nullif(current_setting('sam.actor', true), '') $$;

create or replace function public.soporte_casos_bi() returns trigger
language plpgsql as $$
begin
  -- El cliente NO decide el reloj del compromiso, pase lo que pase.
  new.recibido_en_servidor := now();
  new.updated_at := now();
  return new;
end $$;

create or replace function public.soporte_casos_bu() returns trigger
language plpgsql as $$
begin
  -- Columnas inmutables: identidad y relojes de nacimiento.
  new.folio                 := old.folio;
  new.creado_por            := old.creado_por;
  new.creado_en_dispositivo := old.creado_en_dispositivo;
  new.recibido_en_servidor  := old.recibido_en_servidor;
  new.updated_at            := now();
  return new;
end $$;

create or replace function public.soporte_casos_au() returns trigger
language plpgsql as $$
declare v_actor text := public.soporte_actor();
begin
  if new.estado is distinct from old.estado then
    insert into soporte_eventos(caso_id,tipo,de,a,actor_id,automatico)
    values (new.id,'estado',old.estado,new.estado,v_actor,v_actor is null);
  end if;
  if new.severidad_final is distinct from old.severidad_final then
    insert into soporte_eventos(caso_id,tipo,de,a,actor_id,automatico)
    values (new.id,'severidad',coalesce(old.severidad_final,old.severidad),
            new.severidad_final,v_actor,v_actor is null);
  end if;
  if new.categoria is distinct from old.categoria then
    insert into soporte_eventos(caso_id,tipo,de,a,actor_id,automatico)
    values (new.id,'categoria',old.categoria,new.categoria,v_actor,v_actor is null);
  end if;
  if new.fusionado_en is distinct from old.fusionado_en and new.fusionado_en is not null then
    insert into soporte_eventos(caso_id,tipo,de,a,actor_id,automatico)
    values (new.id,'fusion',null,new.fusionado_en::text,v_actor,false);
  end if;
  if new.version_corregida is distinct from old.version_corregida
     and new.version_corregida is not null then
    insert into soporte_eventos(caso_id,tipo,de,a,actor_id,automatico)
    values (new.id,'correccion',null,new.version_corregida,v_actor,false);
  end if;
  -- Reapertura: se pasó de resuelto/cerrado a un estado vivo.
  if old.estado in ('resuelto','cerrado') and new.estado in ('revisando','falta_dato') then
    insert into soporte_eventos(caso_id,tipo,de,a,actor_id,automatico)
    values (new.id,'reapertura',old.estado,new.estado,v_actor,v_actor is null);
  end if;
  return null;
end $$;

drop trigger if exists soporte_casos_bi_trg on public.soporte_casos;
create trigger soporte_casos_bi_trg before insert on public.soporte_casos
  for each row execute function public.soporte_casos_bi();
drop trigger if exists soporte_casos_bu_trg on public.soporte_casos;
create trigger soporte_casos_bu_trg before update on public.soporte_casos
  for each row execute function public.soporte_casos_bu();
drop trigger if exists soporte_casos_au_trg on public.soporte_casos;
create trigger soporte_casos_au_trg after update on public.soporte_casos
  for each row execute function public.soporte_casos_au();

-- El estado inicial también deja rastro, para que la bitácora de un caso
-- empiece en su nacimiento y la pausa se pueda calcular desde el primer tramo.
create or replace function public.soporte_casos_ai() returns trigger
language plpgsql as $$
begin
  insert into soporte_eventos(caso_id,tipo,de,a,actor_id,automatico)
  values (new.id,'estado',null,new.estado,new.creado_por,false);
  return null;
end $$;
drop trigger if exists soporte_casos_ai_trg on public.soporte_casos;
create trigger soporte_casos_ai_trg after insert on public.soporte_casos
  for each row execute function public.soporte_casos_ai();

-- Mensajes: cuatro efectos, todos por evento y no por clic.
create or replace function public.soporte_mensajes_ai() returns trigger
language plpgsql as $$
declare c public.soporte_casos%rowtype;
begin
  select * into c from soporte_casos where id = new.caso_id for update;

  -- (1) Primera respuesta: humana, con contenido, y de alguien que NO es quien
  --     reportó. Un "ok" de dos letras no para el reloj.
  if not new.es_sistema
     and coalesce(length(btrim(new.texto)),0) >= 3
     and new.autor_id is distinct from c.creado_por
     and c.primera_respuesta_en is null then
    update soporte_casos
       set primera_respuesta_en = new.recibido_en_servidor,
           atendido_por = coalesce(atendido_por, new.autor_id),
           estado = case when estado = 'nuevo' then 'revisando' else estado end
     where id = c.id;
  end if;

  -- (2) El operario contesta estando en "falta un dato tuyo" → vuelve solo.
  if new.autor_id = c.creado_por and c.estado = 'falta_dato' then
    update soporte_casos set estado = 'revisando' where id = c.id;
  end if;

  -- (3) El operario escribe sobre un caso RESUELTO → reapertura automática.
  --     Si escribe es porque algo pasa; "ya quedó" es un botón, no un mensaje.
  if new.autor_id = c.creado_por and c.estado = 'resuelto' then
    update soporte_casos
       set estado='revisando', resuelto_en=null, razon_cierre=null,
           confirmado_por_operario=false
     where id = c.id;
  end if;

  -- (4) Delta sync: sin esto el operario nunca se entera de que le contestaron.
  update soporte_casos set updated_at = now() where id = c.id;
  return null;
end $$;
drop trigger if exists soporte_mensajes_ai_trg on public.soporte_mensajes;
create trigger soporte_mensajes_ai_trg after insert on public.soporte_mensajes
  for each row execute function public.soporte_mensajes_ai();

-- ── 1.7 Vistas derivadas ─────────────────────────────────────────────
-- Pausa del reloj: tramos en los que el caso estuvo esperando al operario.
create or replace view public.soporte_pausas_v as
with tramos as (
  select e.caso_id, e.a as estado, e.creado_en as desde,
         lead(e.creado_en) over (partition by e.caso_id order by e.creado_en, e.id) as hasta
    from soporte_eventos e
   where e.tipo = 'estado'
)
select caso_id,
       sum(public.soporte_horas_habiles(desde, coalesce(hasta, now()))) as horas_pausa
  from tramos
 where estado = 'falta_dato'
 group by caso_id;

-- La vista que consume TODA la app. Aquí y solo aquí se calculan los tiempos.
create or replace view public.soporte_casos_v as
select c.*,
       coalesce(c.severidad_final, c.severidad) as severidad_efectiva,
       -- Envejecimiento: un "puede esperar" de más de 15 días deja de ser verde
       -- solo. Es la técnica estándar contra la inanición de la cola verde.
       case
         when c.estado in ('resuelto','cerrado') then coalesce(c.severidad_final,c.severidad)
         when coalesce(c.severidad_final,c.severidad) = 'puede_esperar'
              and c.recibido_en_servidor < now() - interval '15 days' then 'con_problemas'
         else coalesce(c.severidad_final,c.severidad)
       end as severidad_mostrada,
       -- Cerrado por tiempo aunque nadie haya corrido la RPC de sellado todavía.
       case when c.estado='resuelto' and c.resuelto_en < now() - interval '5 days'
            then 'cerrado' else c.estado end as estado_efectivo,
       (select count(*) from soporte_eventos e
         where e.caso_id=c.id and e.tipo='reapertura')            as reaperturas,
       coalesce(p.horas_pausa,0)                                   as horas_pausa,
       case when c.primera_respuesta_en is not null
            then public.soporte_horas_habiles(c.recibido_en_servidor, c.primera_respuesta_en)
       end                                                          as horas_primera_respuesta,
       -- Lo que vivió el OPERARIO: desde que él lo escribió y sin descontar nada.
       case when c.resuelto_en is not null
            then public.soporte_horas_habiles(c.creado_en_dispositivo, c.resuelto_en)
       end                                                          as horas_operario,
       -- Lo que le toca a SOPORTE: desde que llegó al servidor, menos la pausa.
       case when c.resuelto_en is not null
            then public.soporte_horas_habiles(c.recibido_en_servidor, c.resuelto_en)
                 - coalesce(p.horas_pausa,0)
       end                                                          as horas_soporte,
       extract(epoch from (now() - c.recibido_en_servidor))/86400.0  as edad_dias,
       (select count(*) from soporte_casos h
         where h.fusionado_en = c.id)                               as fusionados,
       -- Avalancha: misma pantalla y misma versión el mismo día. Es una vista,
       -- no una columna escrita por un job que no existe.
       count(*) over (partition by c.pantalla, c.app_version,
                      date_trunc('day', c.recibido_en_servidor))     as del_mismo_grupo
  from soporte_casos c
  left join soporte_pausas_v p on p.caso_id = c.id;

-- ── 1.8 RPCs (única vía de escritura) ────────────────────────────────

-- Crear. Idempotente ante reintento de la cola, y re-sufija si el folio choca.
create or replace function public.soporte_crear_caso(
  p_folio text, p_creado_por text, p_creado_por_nombre text, p_rol_creador text,
  p_registrado_por text, p_origen text, p_severidad text, p_tipo text,
  p_creado_en_dispositivo timestamptz, p_texto text, p_foto_url text,
  p_pantalla text, p_app_version text, p_equipo text, p_error_mensaje text,
  p_contexto jsonb
) returns public.soporte_casos
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $$
declare v public.soporte_casos; v_folio text := p_folio; i int := 0;
begin
  perform set_config('sam.actor', coalesce(p_registrado_por,p_creado_por), true);

  -- Reintento de la cola de salida: mismo folio, mismo autor, misma hora de
  -- dispositivo = es EL MISMO caso. Se devuelve, no se duplica.
  select * into v from soporte_casos
   where folio = p_folio and creado_por = p_creado_por
     and creado_en_dispositivo = p_creado_en_dispositivo;
  if found then return v; end if;

  loop
    begin
      insert into soporte_casos(
        folio, creado_por, creado_por_nombre, rol_creador, registrado_por,
        origen, severidad, tipo, creado_en_dispositivo, texto, foto_url,
        pantalla, app_version, equipo, error_mensaje, contexto)
      values (v_folio, p_creado_por, p_creado_por_nombre, p_rol_creador,
        p_registrado_por, coalesce(p_origen,'app'), p_severidad, p_tipo,
        p_creado_en_dispositivo, nullif(btrim(p_texto),''), p_foto_url,
        p_pantalla, p_app_version, p_equipo, p_error_mensaje, p_contexto)
      returning * into v;
      exit;
    exception when unique_violation then
      i := i + 1;
      if i > 5 then raise; end if;
      -- El folio ya era de OTRO caso: se re-sufija y se devuelve el real.
      v_folio := p_folio || '-' || upper(substr(md5(random()::text),1,2));
    end;
  end loop;

  -- Acuse en la conversación. es_sistema = true: NO cuenta como respuesta.
  insert into soporte_mensajes(caso_id,autor_id,autor_nombre,autor_rol,texto,
                               es_sistema,creado_en_dispositivo)
  values (v.id,'sistema','SAM','sistema',
          'Recibido. Tu caso quedó registrado como ' || v.folio || '.',
          true, now());
  return v;
end $$;

-- Responder / comentar. La usan igual soporte y el operario.
create or replace function public.soporte_mensaje(
  p_caso uuid, p_autor text, p_nombre text, p_rol text,
  p_texto text, p_foto_url text, p_creado_en_dispositivo timestamptz
) returns public.soporte_mensajes
language plpgsql security definer
set search_path to 'public','pg_catalog'
as $$
declare m public.soporte_mensajes;
begin
  if coalesce(length(btrim(p_texto)),0) = 0 and p_foto_url is null then
    raise exception 'Un mensaje vacio no se guarda';
  end if;
  perform set_config('sam.actor', p_autor, true);
  insert into soporte_mensajes(caso_id,autor_id,autor_nombre,autor_rol,texto,
                               foto_url,es_sistema,creado_en_dispositivo)
  values (p_caso,p_autor,p_nombre,p_rol,nullif(btrim(p_texto),''),p_foto_url,
          false, coalesce(p_creado_en_dispositivo, now()))
  returning * into m;
  return m;
end $$;

-- Cambiar estado. Aquí vive la regla dura del módulo.
create or replace function public.soporte_estado(
  p_caso uuid, p_estado text, p_actor text,
  p_razon_cierre text, p_version_corregida text
) returns public.soporte_casos
language plpgsql security definer
set search_path to 'public','pg_catalog'
as $$
declare v public.soporte_casos; n int;
begin
  perform set_config('sam.actor', p_actor, true);
  select * into v from soporte_casos where id = p_caso for update;
  if not found then raise exception 'Caso no encontrado'; end if;

  if p_estado = 'resuelto' then
    if p_razon_cierre is null then
      raise exception 'Falta decir por que se cierra';
    end if;
    -- 🔴 NADIE cierra un caso sin haberle escrito a quien lo reportó. Es la
    --    regla que impide repetir el fracaso de las solicitudes de insumos.
    select count(*) into n from soporte_mensajes m
      where m.caso_id = p_caso and not m.es_sistema
        and m.autor_id is distinct from v.creado_por
        and coalesce(length(btrim(m.texto)),0) >= 3;
    if n = 0 then
      raise exception 'No se puede resolver sin haberle respondido al operario';
    end if;
    update soporte_casos
       set estado='resuelto', resuelto_en=now(), razon_cierre=p_razon_cierre,
           version_corregida=coalesce(p_version_corregida,version_corregida),
           atendido_por=coalesce(atendido_por,p_actor)
     where id=p_caso returning * into v;
  else
    update soporte_casos
       set estado=p_estado,
           atendido_por=coalesce(atendido_por,p_actor)
     where id=p_caso returning * into v;
  end if;
  return v;
end $$;

-- Triage: severidad y categoría. Se separan del estado a propósito.
create or replace function public.soporte_triage(
  p_caso uuid, p_actor text, p_severidad_final text,
  p_categoria text, p_tipo text
) returns public.soporte_casos
language plpgsql security definer
set search_path to 'public','pg_catalog'
as $$
declare v public.soporte_casos;
begin
  perform set_config('sam.actor', p_actor, true);
  update soporte_casos
     set severidad_final = coalesce(p_severidad_final, severidad_final),
         categoria       = coalesce(p_categoria, categoria),
         tipo            = coalesce(p_tipo, tipo)
   where id = p_caso returning * into v;
  return v;
end $$;

-- El operario responde. Dos botones, un toque.
create or replace function public.soporte_confirmar(
  p_caso uuid, p_actor text, p_quedo_bien boolean
) returns public.soporte_casos
language plpgsql security definer
set search_path to 'public','pg_catalog'
as $$
declare v public.soporte_casos;
begin
  perform set_config('sam.actor', p_actor, true);
  if p_quedo_bien then
    update soporte_casos
       set confirmado_por_operario = true, estado='cerrado', cerrado_en=now(),
           resuelto_en = coalesce(resuelto_en, now()),
           razon_cierre = coalesce(razon_cierre,'resuelto')
     where id=p_caso returning * into v;
    insert into soporte_mensajes(caso_id,autor_id,autor_nombre,autor_rol,texto,
                                 es_sistema,creado_en_dispositivo)
    values (p_caso,'sistema','SAM','sistema','El operario confirmó que ya quedó.',
            true, now());
  else
    update soporte_casos
       set confirmado_por_operario = false, estado='revisando',
           resuelto_en=null, razon_cierre=null, cerrado_en=null
     where id=p_caso returning * into v;
    insert into soporte_mensajes(caso_id,autor_id,autor_nombre,autor_rol,texto,
                                 es_sistema,creado_en_dispositivo)
    values (p_caso,'sistema','SAM','sistema','El operario dice que sigue pasando.',
            true, now());
  end if;
  return v;
end $$;

-- Fusión. Nunca "rechazado": el caso hijo queda apuntando al padre y sigue
-- recibiendo la respuesta del grupo.
create or replace function public.soporte_fusionar(
  p_caso uuid, p_padre uuid, p_actor text
) returns public.soporte_casos
language plpgsql security definer
set search_path to 'public','pg_catalog'
as $$
declare v public.soporte_casos; f text;
begin
  perform set_config('sam.actor', p_actor, true);
  select folio into f from soporte_casos where id = p_padre;
  if f is null then raise exception 'El caso con el que se une no existe'; end if;
  update soporte_casos set fusionado_en = p_padre,
         estado = case when estado='nuevo' then 'revisando' else estado end
   where id = p_caso returning * into v;
  insert into soporte_mensajes(caso_id,autor_id,autor_nombre,autor_rol,texto,
                               es_sistema,creado_en_dispositivo)
  values (p_caso,'sistema','SAM','sistema',
          'Ya lo estamos viendo. Tu reporte va junto con el caso ' || f || '.',
          true, now());
  return v;
end $$;

-- Responder y resolver TODO el grupo de una avalancha con un solo mensaje.
-- Es el flujo del día que sale una versión mala; sin él son 23 conversaciones
-- para 2 personas.
create or replace function public.soporte_resolver_grupo(
  p_padre uuid, p_actor text, p_nombre text, p_rol text,
  p_texto text, p_razon_cierre text, p_version_corregida text
) returns int
language plpgsql security definer
set search_path to 'public','pg_catalog'
as $$
declare r record; n int := 0;
begin
  for r in select id from soporte_casos
            where (id = p_padre or fusionado_en = p_padre)
              and estado not in ('cerrado') loop
    perform public.soporte_mensaje(r.id,p_actor,p_nombre,p_rol,p_texto,null,now());
    perform public.soporte_estado(r.id,'resuelto',p_actor,p_razon_cierre,p_version_corregida);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Sellado de cerrados. NO hay cron en este stack: la llama la bandeja al
-- abrirse. Es idempotente, así que correrla de más no hace nada.
create or replace function public.soporte_sellar_cerrados() returns int
language plpgsql security definer
set search_path to 'public','pg_catalog'
as $$
declare n int;
begin
  perform set_config('sam.actor', '', true);   -- actor NULL = automático
  with x as (
    update soporte_casos
       set estado='cerrado', cerrado_en=now(),
           razon_cierre = coalesce(razon_cierre,'sin_respuesta')
     where estado='resuelto' and resuelto_en < now() - interval '5 days'
    returning 1)
  select count(*) into n from x;
  return n;
end $$;

-- Declaración semanal de contactos (termómetro, no medición).
create or replace function public.soporte_declarar_contactos(
  p_semana date, p_whatsapp int, p_telefono int, p_actor text, p_nota text
) returns void
language sql security definer
set search_path to 'public','pg_catalog'
as $$
  insert into soporte_contactos_semana(semana,whatsapp,telefono,declarado_por,nota)
  values (date_trunc('week',p_semana)::date, greatest(p_whatsapp,0),
          greatest(p_telefono,0), p_actor, p_nota)
  on conflict (semana) do update
     set whatsapp=excluded.whatsapp, telefono=excluded.telefono,
         declarado_por=excluded.declarado_por, declarado_en=now(),
         nota=excluded.nota;
$$;

-- ── 1.9 RLS y GRANTS ─────────────────────────────────────────────────
-- ⚠️ Una tabla nueva NO hereda los GRANT.
-- Lectura abierta como el resto del proyecto (no hay auth.uid() sobre el cual
-- construir otra cosa; el filtro "cada quien ve lo suyo" es de pantalla y así
-- se dice). Escritura CERRADA: solo por las RPC de arriba.
alter table public.soporte_casos            enable row level security;
alter table public.soporte_mensajes         enable row level security;
alter table public.soporte_eventos          enable row level security;
alter table public.soporte_contactos_semana enable row level security;

drop policy if exists soporte_casos_r on public.soporte_casos;
create policy soporte_casos_r on public.soporte_casos
  for select to anon, authenticated using (true);
drop policy if exists soporte_mensajes_r on public.soporte_mensajes;
create policy soporte_mensajes_r on public.soporte_mensajes
  for select to anon, authenticated using (true);
drop policy if exists soporte_eventos_r on public.soporte_eventos;
create policy soporte_eventos_r on public.soporte_eventos
  for select to anon, authenticated using (true);
drop policy if exists soporte_contactos_r on public.soporte_contactos_semana;
create policy soporte_contactos_r on public.soporte_contactos_semana
  for select to anon, authenticated using (true);

grant select on public.soporte_casos            to anon, authenticated;
grant select on public.soporte_mensajes         to anon, authenticated;
grant select on public.soporte_eventos          to anon, authenticated;
grant select on public.soporte_contactos_semana to anon, authenticated;
grant select on public.soporte_casos_v          to anon, authenticated;
grant select on public.soporte_pausas_v         to anon, authenticated;

grant execute on function public.soporte_horas_habiles(timestamptz,timestamptz) to anon, authenticated;
grant execute on function public.soporte_crear_caso(text,text,text,text,text,text,text,text,timestamptz,text,text,text,text,text,text,jsonb) to anon, authenticated;
grant execute on function public.soporte_mensaje(uuid,text,text,text,text,text,timestamptz) to anon, authenticated;
grant execute on function public.soporte_estado(uuid,text,text,text,text) to anon, authenticated;
grant execute on function public.soporte_triage(uuid,text,text,text,text) to anon, authenticated;
grant execute on function public.soporte_confirmar(uuid,text,boolean) to anon, authenticated;
grant execute on function public.soporte_fusionar(uuid,uuid,text) to anon, authenticated;
grant execute on function public.soporte_resolver_grupo(uuid,text,text,text,text,text,text) to anon, authenticated;
grant execute on function public.soporte_sellar_cerrados() to anon, authenticated;
grant execute on function public.soporte_declarar_contactos(date,int,int,text,text) to anon, authenticated;

-- ── 1.10 Teléfono de soporte, editable sin desplegar ─────────────────
insert into catalogos_valores (tipo, valor, descripcion, frecuente, orden)
values ('SOPORTE_CONTACTO','3000000000','Celular de soporte (llamada y WhatsApp)',true,1)
on conflict (tipo, upper(valor)) do nothing;

notify pgrst, 'reload schema';
