-- Ola 2 de la reunión con ASM del 26-oct-2026: CARTERA CONTABLE.
--
--  1. Catálogo de clientes de facturación (`fact_clientes`): una sola vez en la vida se escribe «Óscar Llanos»,
--     «Ingenio Risaralda»… y después se escoge de una lista (uniformidad, sin errores de digitación).
--  2. «A quién se facturó» y «quién pagó» son cosas distintas (el Ingenio Risaralda paga facturas que están a nombre
--     de sus proveedores): dos columnas en la factura (`facturado_a_id`, `pagador_id`).
--  3. Deducciones contables (retefuente, reteICA, ICA, fondo de garantía, timbre, descuentos…): NO son plata que entró,
--     son lo que el cliente retuvo. Se guardan aparte de los pagos y bajan el saldo (`fact_deducciones`).
--     Cada cliente trae sus reglas predeterminadas (`fact_cliente_reglas`); lo diferente se hace a mano.
--  4. Observaciones de cartera (`fact_observaciones`): un registro con quién y cuándo, que no se edita.
--
-- Todo es ADITIVO. Las tablas nuevas son de SOLO LECTURA para la app: se escribe únicamente por funciones
-- `security definer` que derivan la identidad del token (patrón `fact_usuario`, Fase 2 de seguridad).
-- ⚠️ NINGÚN porcentaje va sembrado: los de cada cliente los dicta cartera (Viviana). Los que se mencionaron en la
--    reunión (4 % Riopaila, 4 % + 1 % San Carlos, reteICA de Mayagüez) están POR VERIFICAR hasta tener su archivo.

-- ── 1. Catálogo de clientes de facturación ─────────────────────────────────
create table if not exists public.fact_clientes (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null check (btrim(nombre) <> ''),
  tipo        text not null default 'OTRO' check (tipo in ('INGENIO', 'PROVEEDOR', 'COLONO', 'PARTICULAR', 'OTRO')),
  nit         text,
  activo      boolean not null default true,
  creado_por  text,
  created_at  timestamptz not null default now()
);
create unique index if not exists fact_clientes_nombre_uq on public.fact_clientes (upper(btrim(nombre)));
comment on table public.fact_clientes is 'Catálogo de a quién se le factura y de quién paga (ingenios, proveedores, colonos). Se escribe solo por fact_cliente_guardar.';
alter table public.fact_clientes enable row level security;
drop policy if exists fact_clientes_leer on public.fact_clientes;
create policy fact_clientes_leer on public.fact_clientes for select to anon, authenticated using (true);
grant select on public.fact_clientes to anon, authenticated;

alter table public.fact_documentos add column if not exists facturado_a_id uuid references public.fact_clientes(id);
alter table public.fact_documentos add column if not exists pagador_id uuid references public.fact_clientes(id);
comment on column public.fact_documentos.facturado_a_id is 'FACTURA: a nombre de quién está la factura (catálogo fact_clientes). NULL = no se ha dicho.';
comment on column public.fact_documentos.pagador_id is 'FACTURA: quién la paga de verdad (p. ej. el ingenio que paga las facturas de sus proveedores). NULL = el mismo a quien se facturó.';
create index if not exists fact_documentos_pagador_idx on public.fact_documentos (pagador_id) where pagador_id is not null;

-- ── 2. Conceptos de deducción y reglas por cliente ─────────────────────────
-- Los conceptos que salieron en la reunión. Los porcentajes NO van aquí: son del cliente (fact_cliente_reglas).
create table if not exists public.fact_deduccion_conceptos (
  codigo  text primary key,
  nombre  text not null,
  modo    text not null check (modo in ('PORCENTAJE', 'VALOR')),
  orden   integer not null default 0,
  activo  boolean not null default true
);
alter table public.fact_deduccion_conceptos enable row level security;
drop policy if exists fact_deduccion_conceptos_leer on public.fact_deduccion_conceptos;
create policy fact_deduccion_conceptos_leer on public.fact_deduccion_conceptos for select to anon, authenticated using (true);
grant select on public.fact_deduccion_conceptos to anon, authenticated;
insert into public.fact_deduccion_conceptos (codigo, nombre, modo, orden) values
  ('RETEFUENTE',     'Retención en la fuente',     'PORCENTAJE', 1),
  ('RETEICA',        'ReteICA',                    'PORCENTAJE', 2),
  ('ICA',            'ICA',                        'PORCENTAJE', 3),
  ('FONDO_GARANTIA', 'Fondo de garantía',          'PORCENTAJE', 4),
  ('TIMBRE',         'Impuesto de timbre',         'PORCENTAJE', 5),
  ('DESCUENTO',      'Descuento de la factura',    'VALOR',      6),
  ('OTRO',           'Otro (manual)',              'VALOR',      7)
on conflict (codigo) do nothing;

create table if not exists public.fact_cliente_reglas (
  cliente_id  uuid not null references public.fact_clientes(id) on delete cascade,
  concepto    text not null references public.fact_deduccion_conceptos(codigo),
  porcentaje  numeric(7, 4) not null check (porcentaje > 0 and porcentaje <= 100),
  primary key (cliente_id, concepto)
);
comment on table public.fact_cliente_reglas is 'Deducciones PREDETERMINADAS de cada cliente (las pagadoras retienen): la pantalla las propone y la persona confirma o cambia.';
alter table public.fact_cliente_reglas enable row level security;
drop policy if exists fact_cliente_reglas_leer on public.fact_cliente_reglas;
create policy fact_cliente_reglas_leer on public.fact_cliente_reglas for select to anon, authenticated using (true);
grant select on public.fact_cliente_reglas to anon, authenticated;

-- ── 3. Deducciones aplicadas a una factura ────────────────────────────────
create table if not exists public.fact_deducciones (
  id              uuid primary key default gen_random_uuid(),
  factura_id      uuid not null references public.fact_documentos(id),
  concepto        text not null references public.fact_deduccion_conceptos(codigo),
  porcentaje      numeric(7, 4) check (porcentaje is null or (porcentaje > 0 and porcentaje <= 100)),
  valor           numeric(16, 2) not null check (valor > 0),
  fecha           date not null,
  nota            text,
  anulado         boolean not null default false,
  anulado_por     text,
  anulado_motivo  text,
  creado_por      text not null,
  created_at      timestamptz not null default now()
);
create index if not exists fact_deducciones_factura_idx on public.fact_deducciones (factura_id) where not anulado;
-- Un mismo concepto no se aplica dos veces a la misma factura (un doble toque no la deja descontada dos veces);
-- «Descuento» y «Otro» sí pueden repetirse.
create unique index if not exists fact_deducciones_concepto_uq on public.fact_deducciones (factura_id, concepto)
  where not anulado and concepto not in ('DESCUENTO', 'OTRO');
comment on table public.fact_deducciones is 'Lo que el cliente retuvo o descontó de una factura. NO es plata que entró: baja el saldo pero no cuenta como pago.';
alter table public.fact_deducciones enable row level security;
drop policy if exists fact_deducciones_leer on public.fact_deducciones;
create policy fact_deducciones_leer on public.fact_deducciones for select to anon, authenticated using (true);
grant select on public.fact_deducciones to anon, authenticated;

-- ── 4. Observaciones de cartera ────────────────────────────────────────────
create table if not exists public.fact_observaciones (
  id          uuid primary key default gen_random_uuid(),
  factura_id  uuid not null references public.fact_documentos(id),
  texto       text not null check (btrim(texto) <> '' and char_length(texto) <= 2000),
  creado_por  text not null,
  created_at  timestamptz not null default now()
);
create index if not exists fact_observaciones_factura_idx on public.fact_observaciones (factura_id, created_at desc);
comment on table public.fact_observaciones is 'Bitácora de cartera por factura: quién anotó qué y cuándo. No se edita ni se borra.';
alter table public.fact_observaciones enable row level security;
drop policy if exists fact_observaciones_leer on public.fact_observaciones;
create policy fact_observaciones_leer on public.fact_observaciones for select to anon, authenticated using (true);
grant select on public.fact_observaciones to anon, authenticated;

-- ── Funciones de escritura (todas derivan la identidad del token) ──────────
create or replace function public.fact_cliente_guardar(p_id uuid, p_nombre text, p_tipo text, p_nit text, p_activo boolean,
                                                       p_usuario text, p_token text default null)
returns uuid
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_rol text;
  v_id uuid;
  v_nombre text := upper(btrim(coalesce(p_nombre, '')));
begin
  p_usuario := public.fact_usuario(p_token, p_usuario);
  select rol::text into v_rol from public.app_usuarios where id = p_usuario and activo;
  if coalesce(v_rol, '') not in ('owner', 'administracion', 'analista_insumos') then
    raise exception 'SIN_PERMISO: solo administración o el analista editan el catálogo de clientes' using errcode = 'insufficient_privilege';
  end if;
  if v_nombre = '' then raise exception 'NOMBRE: escribe el nombre del cliente' using errcode = 'check_violation'; end if;
  if coalesce(p_tipo, 'OTRO') not in ('INGENIO', 'PROVEEDOR', 'COLONO', 'PARTICULAR', 'OTRO') then
    raise exception 'TIPO: tipo de cliente no válido' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.fact_clientes where upper(btrim(nombre)) = v_nombre and id is distinct from p_id) then
    raise exception 'CLIENTE_REPETIDO: ya existe «%»', v_nombre using errcode = 'unique_violation';
  end if;
  if p_id is null then
    insert into public.fact_clientes (nombre, tipo, nit, activo, creado_por)
      values (v_nombre, coalesce(p_tipo, 'OTRO'), nullif(btrim(p_nit), ''), coalesce(p_activo, true), p_usuario)
      returning id into v_id;
  else
    update public.fact_clientes
       set nombre = v_nombre, tipo = coalesce(p_tipo, tipo), nit = nullif(btrim(p_nit), ''), activo = coalesce(p_activo, activo)
     where id = p_id returning id into v_id;
    if v_id is null then raise exception 'CLIENTE_NO_EXISTE' using errcode = 'no_data_found'; end if;
  end if;
  return v_id;
end $$;

-- Reemplaza TODAS las reglas de un cliente de una vez (así no queda a medias): [{"concepto":"RETEFUENTE","porcentaje":4}, …]
create or replace function public.fact_cliente_reglas_guardar(p_cliente uuid, p_reglas jsonb, p_usuario text, p_token text default null)
returns integer
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_rol text;
  r jsonb;
  v_concepto text;
  v_pct numeric;
  v_n int := 0;
begin
  p_usuario := public.fact_usuario(p_token, p_usuario);
  select rol::text into v_rol from public.app_usuarios where id = p_usuario and activo;
  if coalesce(v_rol, '') not in ('owner', 'administracion', 'analista_insumos') then
    raise exception 'SIN_PERMISO: solo administración o el analista fijan las deducciones de un cliente' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.fact_clientes where id = p_cliente) then
    raise exception 'CLIENTE_NO_EXISTE' using errcode = 'no_data_found';
  end if;
  if p_reglas is null or jsonb_typeof(p_reglas) <> 'array' then
    raise exception 'REGLAS: se esperaba una lista' using errcode = 'check_violation';
  end if;
  -- Se valida todo antes de tocar nada.
  for r in select * from jsonb_array_elements(p_reglas) loop
    v_concepto := upper(btrim(coalesce(r->>'concepto', '')));
    v_pct := nullif(r->>'porcentaje', '')::numeric;
    if not exists (select 1 from public.fact_deduccion_conceptos where codigo = v_concepto and modo = 'PORCENTAJE' and activo) then
      raise exception 'CONCEPTO: «%» no es un concepto por porcentaje', v_concepto using errcode = 'check_violation';
    end if;
    if v_pct is null or v_pct <= 0 or v_pct > 100 then
      raise exception 'PORCENTAJE: el de % debe estar entre 0 y 100', v_concepto using errcode = 'check_violation';
    end if;
  end loop;
  delete from public.fact_cliente_reglas where cliente_id = p_cliente;
  for r in select * from jsonb_array_elements(p_reglas) loop
    insert into public.fact_cliente_reglas (cliente_id, concepto, porcentaje)
      values (p_cliente, upper(btrim(r->>'concepto')), (r->>'porcentaje')::numeric)
      on conflict (cliente_id, concepto) do update set porcentaje = excluded.porcentaje;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- A quién se facturó y quién paga (NULL = sin decir). Solo facturas vivas.
create or replace function public.fact_factura_clientes(p_factura uuid, p_facturado_a uuid, p_pagador uuid,
                                                        p_usuario text, p_token text default null)
returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_doc public.fact_documentos;
  v_rol text;
begin
  p_usuario := public.fact_usuario(p_token, p_usuario);
  select rol::text into v_rol from public.app_usuarios where id = p_usuario and activo;
  if coalesce(v_rol, '') not in ('owner', 'administracion', 'analista_insumos') then
    raise exception 'SIN_PERMISO: solo administración o el analista dicen a quién se facturó y quién paga' using errcode = 'insufficient_privilege';
  end if;
  select * into v_doc from public.fact_documentos where id = p_factura for update;
  if v_doc.id is null then raise exception 'DOCUMENTO_NO_EXISTE' using errcode = 'no_data_found'; end if;
  if v_doc.tipo <> 'FACTURA' then raise exception 'TIPO: solo las facturas llevan cliente y pagador' using errcode = 'check_violation'; end if;
  if v_doc.anulado then raise exception 'DOCUMENTO_ANULADO: % está anulado', v_doc.numero using errcode = 'check_violation'; end if;
  if p_facturado_a is not null and not exists (select 1 from public.fact_clientes where id = p_facturado_a and activo) then
    raise exception 'CLIENTE_NO_EXISTE: el cliente de la factura no está en el catálogo (o está inactivo)' using errcode = 'check_violation';
  end if;
  if p_pagador is not null and not exists (select 1 from public.fact_clientes where id = p_pagador and activo) then
    raise exception 'CLIENTE_NO_EXISTE: el pagador no está en el catálogo (o está inactivo)' using errcode = 'check_violation';
  end if;
  update public.fact_documentos set facturado_a_id = p_facturado_a, pagador_id = p_pagador where id = p_factura;
end $$;

-- Aplica varias deducciones a una factura de una vez: [{"concepto":"RETEFUENTE","porcentaje":4,"valor":123456.00,"nota":"…"}]
-- Si el concepto es por porcentaje y no llega el valor, se calcula sobre el valor de la factura (la persona puede
-- corregirlo: caso excepcional). Nunca deja pasar lo pagado + lo deducido del valor de la factura.
create or replace function public.fact_deducciones_guardar(p_factura uuid, p_items jsonb, p_fecha date, p_usuario text,
                                                           p_token text default null)
returns numeric
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_doc public.fact_documentos;
  v_rol text;
  r jsonb;
  v_concepto text;
  v_modo text;
  v_pct numeric;
  v_valor numeric;
  v_total numeric := 0;
  v_pagado numeric;
  v_deducido numeric;
  v_fecha date := coalesce(p_fecha, (now() at time zone 'America/Bogota')::date);
begin
  p_usuario := public.fact_usuario(p_token, p_usuario);
  select rol::text into v_rol from public.app_usuarios where id = p_usuario and activo;
  if coalesce(v_rol, '') not in ('owner', 'administracion', 'analista_insumos') then
    raise exception 'SIN_PERMISO: solo administración o el analista aplican deducciones' using errcode = 'insufficient_privilege';
  end if;
  select * into v_doc from public.fact_documentos where id = p_factura for update;
  if v_doc.id is null then raise exception 'DOCUMENTO_NO_EXISTE' using errcode = 'no_data_found'; end if;
  if v_doc.tipo <> 'FACTURA' then raise exception 'TIPO: las deducciones van contra una factura' using errcode = 'check_violation'; end if;
  if v_doc.anulado then raise exception 'DOCUMENTO_ANULADO: % está anulado', v_doc.numero using errcode = 'check_violation'; end if;
  if v_doc.valor is null then raise exception 'SIN_VALOR: la factura % todavía no tiene valor', v_doc.numero using errcode = 'check_violation'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'ITEMS: no hay deducciones para guardar' using errcode = 'check_violation';
  end if;

  for r in select * from jsonb_array_elements(p_items) loop
    v_concepto := upper(btrim(coalesce(r->>'concepto', '')));
    select modo into v_modo from public.fact_deduccion_conceptos where codigo = v_concepto and activo;
    if v_modo is null then raise exception 'CONCEPTO: «%» no existe', v_concepto using errcode = 'check_violation'; end if;
    v_pct := nullif(r->>'porcentaje', '')::numeric;
    v_valor := nullif(r->>'valor', '')::numeric;
    if v_modo = 'PORCENTAJE' then
      if v_pct is null or v_pct <= 0 or v_pct > 100 then
        raise exception 'PORCENTAJE: el de % debe estar entre 0 y 100', v_concepto using errcode = 'check_violation';
      end if;
      if v_valor is null then v_valor := round(v_doc.valor * v_pct / 100, 2); end if;
    else
      v_pct := null;
    end if;
    if v_valor is null or v_valor <= 0 then
      raise exception 'VALOR: la deducción % debe ser mayor que cero', v_concepto using errcode = 'check_violation';
    end if;
    begin
      insert into public.fact_deducciones (factura_id, concepto, porcentaje, valor, fecha, nota, creado_por)
        values (p_factura, v_concepto, v_pct, round(v_valor, 2), v_fecha, nullif(btrim(r->>'nota'), ''), p_usuario);
    exception when unique_violation then
      raise exception 'DEDUCCION_REPETIDA: la factura % ya tiene aplicada la deducción %', v_doc.numero, v_concepto using errcode = 'unique_violation';
    end;
    v_total := v_total + round(v_valor, 2);
  end loop;

  select coalesce(sum(valor), 0) into v_pagado from public.fact_pagos where factura_id = p_factura and not anulado;
  select coalesce(sum(valor), 0) into v_deducido from public.fact_deducciones where factura_id = p_factura and not anulado;
  if v_pagado + v_deducido > v_doc.valor + 0.5 then
    raise exception 'EXCEDE_VALOR: lo pagado (%) más lo deducido (%) pasa del valor de la factura (%)', v_pagado, v_deducido, v_doc.valor
      using errcode = 'check_violation';
  end if;
  return v_total;
end $$;

create or replace function public.fact_deduccion_anular(p_id uuid, p_motivo text, p_usuario text, p_token text default null)
returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_rol text;
  v_d public.fact_deducciones;
begin
  p_usuario := public.fact_usuario(p_token, p_usuario);
  select rol::text into v_rol from public.app_usuarios where id = p_usuario and activo;
  if coalesce(v_rol, '') not in ('owner', 'administracion', 'analista_insumos') then
    raise exception 'SIN_PERMISO: solo administración o el analista anulan deducciones' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'MOTIVO: para anular una deducción hay que decir por qué' using errcode = 'check_violation';
  end if;
  select * into v_d from public.fact_deducciones where id = p_id for update;
  if v_d.id is null then raise exception 'DEDUCCION_NO_EXISTE' using errcode = 'no_data_found'; end if;
  if v_d.anulado then return; end if;
  update public.fact_deducciones set anulado = true, anulado_por = p_usuario, anulado_motivo = btrim(p_motivo) where id = p_id;
end $$;

create or replace function public.fact_observacion_agregar(p_factura uuid, p_texto text, p_usuario text, p_token text default null)
returns uuid
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_rol text;
  v_id uuid;
begin
  p_usuario := public.fact_usuario(p_token, p_usuario);
  select rol::text into v_rol from public.app_usuarios where id = p_usuario and activo;
  if coalesce(v_rol, '') not in ('owner', 'administracion', 'analista_insumos') then
    raise exception 'SIN_PERMISO: solo administración o el analista anotan observaciones de cartera' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(btrim(p_texto), '') = '' then raise exception 'TEXTO: escribe la observación' using errcode = 'check_violation'; end if;
  if char_length(p_texto) > 2000 then raise exception 'TEXTO: máximo 2000 caracteres' using errcode = 'check_violation'; end if;
  if not exists (select 1 from public.fact_documentos where id = p_factura and tipo = 'FACTURA' and not anulado) then
    raise exception 'DOCUMENTO_NO_EXISTE: la factura no existe o está anulada' using errcode = 'no_data_found';
  end if;
  insert into public.fact_observaciones (factura_id, texto, creado_por) values (p_factura, btrim(p_texto), p_usuario) returning id into v_id;
  return v_id;
end $$;

grant execute on function public.fact_cliente_guardar(uuid, text, text, text, boolean, text, text),
                         public.fact_cliente_reglas_guardar(uuid, jsonb, text, text),
                         public.fact_factura_clientes(uuid, uuid, uuid, text, text),
                         public.fact_deducciones_guardar(uuid, jsonb, date, text, text),
                         public.fact_deduccion_anular(uuid, text, text, text),
                         public.fact_observacion_agregar(uuid, text, text, text) to anon, authenticated;

-- ── Eliminar un documento (Ola 1): ahora también mira las deducciones vivas ──
create or replace function public.fact_documento_anular(p_documento uuid, p_motivo text, p_usuario text, p_token text default null)
returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_doc public.fact_documentos;
  v_rol text;
  v_lineas int;
  v_pagos int;
  v_deducciones int;
begin
  p_usuario := public.fact_usuario(p_token, p_usuario);
  select rol::text into v_rol from public.app_usuarios where id = p_usuario and activo;
  if coalesce(v_rol, '') not in ('owner', 'administracion') then
    raise exception 'SIN_PERMISO: solo administración o el dueño eliminan soportes y facturas' using errcode = 'insufficient_privilege';
  end if;
  select * into v_doc from public.fact_documentos where id = p_documento for update;
  if v_doc.id is null then raise exception 'DOCUMENTO_NO_EXISTE' using errcode = 'no_data_found'; end if;
  if v_doc.anulado then return; end if;

  select count(*) into v_lineas from public.asignaciones where soporte_id = p_documento or factura_id = p_documento;
  if v_lineas > 0 then
    raise exception 'TIENE_LINEAS: % línea(s) siguen pegadas a % %. Quítaselas primero.', v_lineas, lower(v_doc.tipo), v_doc.numero
      using errcode = 'check_violation';
  end if;
  if v_doc.tipo = 'FACTURA' then
    select count(*) into v_pagos from public.fact_pagos where factura_id = p_documento and not anulado;
    if v_pagos > 0 then
      raise exception 'TIENE_PAGOS: la factura % tiene % pago(s) registrado(s). Anúlalos primero en Cartera.', v_doc.numero, v_pagos
        using errcode = 'check_violation';
    end if;
    select count(*) into v_deducciones from public.fact_deducciones where factura_id = p_documento and not anulado;
    if v_deducciones > 0 then
      raise exception 'TIENE_DEDUCCIONES: la factura % tiene % deducción(es) aplicada(s). Anúlalas primero en Cartera.', v_doc.numero, v_deducciones
        using errcode = 'check_violation';
    end if;
  end if;

  update public.fact_documentos
     set anulado = true,
         anulado_por = p_usuario,
         anulado_motivo = coalesce(nullif(btrim(p_motivo), ''), 'Eliminado desde Soportes y facturas')
   where id = p_documento;
end $$;

-- ── La cartera: ahora cuenta lo deducido y dice a quién se facturó y quién paga ──
-- Las columnas nuevas van AL FINAL (así la PWA que quedó en caché sigue leyendo la vista sin romperse).
-- Pagada = lo pagado MÁS lo deducido cubre el valor. Los días se congelan en el último movimiento (pago o deducción).
create or replace view public.cartera_facturas_v with (security_invoker = true) as
with hoy as (select (now() at time zone 'America/Bogota')::date as d),
acuerdo_prox as (
  select distinct on (q.acuerdo_id) q.acuerdo_id, q.vence
    from (select cu.acuerdo_id, cu.orden, cu.vence,
                 sum(cu.valor) over (partition by cu.acuerdo_id order by cu.orden) as acumulado
            from public.fact_acuerdo_cuotas cu) q
    left join (select acuerdo_id, sum(valor) as pagado from public.fact_pagos
                where not anulado and acuerdo_id is not null group by acuerdo_id) pa on pa.acuerdo_id = q.acuerdo_id
   where q.acumulado > coalesce(pa.pagado, 0) + 0.5
   order by q.acuerdo_id, q.orden
),
pagos as (
  select factura_id, sum(valor) as pagado, max(fecha) as ultimo_pago, count(*) as n_pagos,
         coalesce(sum(valor) filter (where anticipo), 0) as anticipo
    from public.fact_pagos where not anulado and factura_id is not null group by factura_id
),
deduc as (
  select factura_id, sum(valor) as deducido, max(fecha) as ultima_deduccion, count(*) as n_deducciones
    from public.fact_deducciones where not anulado group by factura_id
),
obs as (
  select factura_id, count(*) as n_observaciones from public.fact_observaciones group by factura_id
),
lineas as (
  select factura_id, count(*) as n_lineas,
         sum(case when area_realizada > 0 then area_realizada else area_asignada end) as cantidad
    from public.asignaciones where factura_id is not null group by factura_id
),
base as (
  select f.id, f.numero, f.fecha, f.razon_social, f.cliente, f.valor, f.plazo_dias,
         f.archivo_path, f.archivo_nombre, f.nota, f.created_at,
         coalesce(ap.vence, f.fecha + f.plazo_dias) as vence,
         coalesce(p.pagado, 0) as pagado, p.ultimo_pago, coalesce(p.n_pagos, 0) as n_pagos,
         coalesce(l.n_lineas, 0) as n_lineas, coalesce(l.cantidad, 0) as cantidad,
         (select d from hoy) as hoy,
         f.acuerdo_id, a.colono, coalesce(p.anticipo, 0) as anticipo, (ap.vence is not null) as por_plan,
         coalesce(d.deducido, 0) as deducido, d.ultima_deduccion, coalesce(d.n_deducciones, 0) as n_deducciones,
         f.facturado_a_id, cf.nombre as facturado_a, f.pagador_id, cp.nombre as pagador,
         coalesce(o.n_observaciones, 0) as n_observaciones
    from public.fact_documentos f
    left join pagos p on p.factura_id = f.id
    left join deduc d on d.factura_id = f.id
    left join obs o on o.factura_id = f.id
    left join lineas l on l.factura_id = f.id
    left join public.fact_acuerdos a on a.id = f.acuerdo_id
    left join acuerdo_prox ap on ap.acuerdo_id = f.acuerdo_id
    left join public.fact_clientes cf on cf.id = f.facturado_a_id
    left join public.fact_clientes cp on cp.id = f.pagador_id
   where f.tipo = 'FACTURA' and not f.anulado
),
corte as (
  select b.*, (b.valor is not null and b.pagado + b.deducido >= b.valor - 0.5) as pagada,
         case when b.valor is not null and b.pagado + b.deducido >= b.valor - 0.5
              then coalesce(greatest(b.ultimo_pago, b.ultima_deduccion), b.hoy) else b.hoy end as al
    from base b
)
select c.id, c.numero, c.fecha, c.razon_social, c.cliente, c.valor, c.plazo_dias, c.archivo_path, c.archivo_nombre,
       c.nota, c.created_at, c.vence, c.pagado, c.ultimo_pago, c.n_pagos, c.n_lineas, c.cantidad, c.hoy,
       case when c.valor is null then null else greatest(c.valor - c.pagado - c.deducido, 0) end as saldo,
       greatest(c.al - c.fecha, 0) as dias_cartera,
       greatest(c.al - c.vence, 0) as dias_mora,
       case
         when c.pagada then 'PAGADA'
         when c.por_plan and c.hoy - c.vence > 150 then 'OTRAS_MEDIDAS'
         when c.por_plan and c.hoy - c.vence > 30 then 'CRITICA'
         when c.por_plan and c.hoy > c.vence then 'VENCIDA'
         when c.por_plan and c.valor is null then 'SIN_VALOR'
         when c.por_plan then 'AL_DIA'
         when c.hoy - c.fecha > 180 then 'OTRAS_MEDIDAS'
         when c.hoy - c.fecha > 60 then 'CRITICA'
         when c.hoy > c.vence then 'VENCIDA'
         when c.valor is null then 'SIN_VALOR'
         else 'AL_DIA'
       end as estado,
       c.acuerdo_id, c.colono, c.anticipo,
       c.deducido, c.n_deducciones, c.facturado_a_id, c.facturado_a, c.pagador_id, c.pagador, c.n_observaciones
  from corte c;
grant select on public.cartera_facturas_v to anon, authenticated;
