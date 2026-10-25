-- Fincas: el presupuesto del corte cuenta las PASADAS y lo que se PAGA APARTE (24-oct-2026).
--
-- Hasta hoy presupuesto = Σ cantidad_plan × costo_unitario_plan: una labor repetible (riego, malezas)
-- contaba UNA pasada, y el fertilizante, la mano de obra y el agua —que entran como gastos a mano—
-- no tenían ninguna línea. Medido en IYOMA PRUEBAS: $355,7 M ejecutados contra $27,9 M (1275 %).
--
-- Dos datos nuevos, en el paquete y en cada labor del corte:
--   · pasadas_plan: cuántas pasadas se presupuestan (solo una labor repetible puede tener más de 1).
--   · costo_aparte_unitario(_plan): lo que la labor cuesta además de la tarifa y se paga aparte
--     (insumos, agua, mano de obra). Entra al PRESUPUESTO; NO se cobra al aceptar el reporte.
-- presupuesto de una labor = cantidad_plan × pasadas_plan × (costo_unitario_plan + costo_aparte_unitario_plan)
-- El cobro al aceptar (af__revisar) NO cambia: cantidad × costo_unitario_plan.
-- Los valores por defecto (1 y 0) dejan IGUAL al peso el presupuesto de todo lo que ya existe.

alter table public.af_paquete
  add column if not exists pasadas_plan int not null default 1,
  add column if not exists costo_aparte_unitario numeric not null default 0;
alter table public.af_labores
  add column if not exists pasadas_plan int not null default 1,
  add column if not exists costo_aparte_unitario_plan numeric not null default 0;

alter table public.af_paquete drop constraint if exists af_paquete_pasadas_ck;
alter table public.af_paquete add constraint af_paquete_pasadas_ck check (pasadas_plan >= 1 and (repetible or pasadas_plan = 1));
alter table public.af_paquete drop constraint if exists af_paquete_costo_aparte_ck;
alter table public.af_paquete add constraint af_paquete_costo_aparte_ck check (costo_aparte_unitario >= 0);
alter table public.af_labores drop constraint if exists af_labores_pasadas_ck;
alter table public.af_labores add constraint af_labores_pasadas_ck check (pasadas_plan >= 1 and (repetible or pasadas_plan = 1));
alter table public.af_labores drop constraint if exists af_labores_costo_aparte_ck;
alter table public.af_labores add constraint af_labores_costo_aparte_ck check (costo_aparte_unitario_plan >= 0);

comment on column public.af_paquete.pasadas_plan is 'Pasadas presupuestadas en el corte (solo repetibles pueden tener más de 1).';
comment on column public.af_paquete.costo_aparte_unitario is 'Costo por unidad y pasada que se paga aparte (insumos, agua, mano de obra): entra al presupuesto, no se cobra al aceptar.';
comment on column public.af_labores.pasadas_plan is 'Pasadas presupuestadas en este corte (copia del paquete; la edita administración).';
comment on column public.af_labores.costo_aparte_unitario_plan is 'Costo por unidad y pasada que se paga aparte: entra al presupuesto, no se cobra al aceptar el reporte.';

-- ── Abrir ciclo: copia también las pasadas y el costo aparte ──────────────
-- Copia de 20261017150000 (ventana por variedad); solo se agregan las dos columnas.
create or replace function public.af__abrir_ciclo(p_suerte uuid, p_fecha_corte date, p_tipo text, p_usuario text)
returns uuid
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_area numeric;
  v_variedad text;
  v_ciclo uuid;
  v_tipo text := coalesce(nullif(p_tipo, ''), 'SOCA');
  v_hoy date := (now() at time zone 'America/Bogota')::date;
begin
  if coalesce(public.af_rol(p_usuario), '') not in ('owner', 'administracion') then
    raise exception 'SIN_PERMISO: solo administración abre ciclos' using errcode = 'insufficient_privilege';
  end if;
  perform set_config('af.via_funcion', '1', true);
  if p_fecha_corte > v_hoy then
    raise exception 'FECHA_FUTURA: el corte no puede ser después de hoy' using errcode = 'check_violation';
  end if;
  select area_ha, variedad into v_area, v_variedad from public.af_suertes where id = p_suerte and activa;
  if v_area is null then raise exception 'SUERTE_NO_EXISTE' using errcode = 'no_data_found'; end if;

  update public.af_ciclos set estado = 'CERRADO', fecha_cierre = p_fecha_corte, editado_por = p_usuario
   where suerte_id = p_suerte and estado = 'ABIERTO';

  insert into public.af_ciclos (suerte_id, fecha_corte, tipo, editado_por)
  values (p_suerte, p_fecha_corte, v_tipo, p_usuario)
  returning id into v_ciclo;

  insert into public.af_labores (ciclo_id, labor, unidad, cantidad_plan, costo_unitario_plan,
                                 ventana_ideal, ventana_normal, orden, repetible,
                                 pasadas_plan, costo_aparte_unitario_plan, editado_por)
  select distinct on (p.labor, p.aplica, p.unidad)
         v_ciclo, p.labor, p.unidad, round(v_area * p.cantidad_por_ha, 2), p.costo_unitario,
         p.ventana_ideal, p.ventana_normal, p.orden, p.repetible,
         case when p.repetible then p.pasadas_plan else 1 end, p.costo_aparte_unitario, p_usuario
    from public.af_paquete p
   where p.activa and (p.aplica = 'AMBOS' or p.aplica = v_tipo)
     and public.af_variedad_coincide(p.variedad, v_variedad)
   -- La específica de la variedad le gana a la genérica.
   order by p.labor, p.aplica, p.unidad, (p.variedad is not null) desc, p.orden;

  return v_ciclo;
end $$;

-- ── Guardar el paquete: pasadas y costo aparte ────────────────────────────
-- Copia de 20261017150000. Una app vieja que no manda los campos nuevos conserva los que había
-- (igual que con la variedad). Si la labor deja de ser repetible, sus pasadas vuelven a 1.
create or replace function public.af_guardar_paquete(p_token text, p_id uuid, p_datos jsonb)
returns uuid
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_usuario text := public.af__usuario(p_token, array['owner', 'administracion']);
  v_id uuid;
  v_repetible boolean := coalesce((p_datos ->> 'repetible')::boolean, false);
begin
  if p_id is null then
    insert into public.af_paquete (labor, unidad, cantidad_por_ha, costo_unitario, ventana_ideal, ventana_normal, aplica, orden, activa, repetible, variedad,
                                   pasadas_plan, costo_aparte_unitario, editado_por)
    values (upper(btrim(p_datos ->> 'labor')), coalesce(p_datos ->> 'unidad', 'ha'), coalesce((p_datos ->> 'cantidad_por_ha')::numeric, 1),
            coalesce((p_datos ->> 'costo_unitario')::numeric, 0), (p_datos ->> 'ventana_ideal')::int, (p_datos ->> 'ventana_normal')::int,
            coalesce(p_datos ->> 'aplica', 'AMBOS'), coalesce((p_datos ->> 'orden')::int, 100), coalesce((p_datos ->> 'activa')::boolean, true),
            v_repetible, nullif(btrim(p_datos ->> 'variedad'), ''),
            case when v_repetible then coalesce((p_datos ->> 'pasadas_plan')::int, 1) else 1 end,
            coalesce((p_datos ->> 'costo_aparte_unitario')::numeric, 0), v_usuario)
    returning id into v_id;
    return v_id;
  end if;
  update public.af_paquete set
    labor = upper(btrim(p_datos ->> 'labor')), unidad = coalesce(p_datos ->> 'unidad', 'ha'),
    cantidad_por_ha = coalesce((p_datos ->> 'cantidad_por_ha')::numeric, 1), costo_unitario = coalesce((p_datos ->> 'costo_unitario')::numeric, 0),
    ventana_ideal = (p_datos ->> 'ventana_ideal')::int, ventana_normal = (p_datos ->> 'ventana_normal')::int,
    aplica = coalesce(p_datos ->> 'aplica', 'AMBOS'), orden = coalesce((p_datos ->> 'orden')::int, 100),
    activa = coalesce((p_datos ->> 'activa')::boolean, true),
    repetible = coalesce((p_datos ->> 'repetible')::boolean, repetible),
    variedad = case when p_datos ? 'variedad' then nullif(btrim(p_datos ->> 'variedad'), '') else variedad end,
    -- En el SET, `repetible` y `pasadas_plan` son los valores de ANTES de este update.
    pasadas_plan = case when coalesce((p_datos ->> 'repetible')::boolean, repetible)
                        then coalesce((p_datos ->> 'pasadas_plan')::int, pasadas_plan) else 1 end,
    costo_aparte_unitario = coalesce((p_datos ->> 'costo_aparte_unitario')::numeric, costo_aparte_unitario),
    editado_por = v_usuario
  where id = p_id;
  return p_id;
end $$;

-- ── Editar el plan de una labor del corte: dos parámetros nuevos AL FINAL y con DEFAULT ──
-- drop + create (no overload): una PWA en caché que llama con cuatro argumentos sigue funcionando.
drop function if exists public.af_actualizar_labor(text, uuid, numeric, numeric);
create function public.af_actualizar_labor(p_token text, p_id uuid, p_cantidad numeric, p_costo numeric,
                                           p_pasadas int default null, p_costo_aparte numeric default null)
returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_usuario text := public.af__usuario(p_token, array['owner', 'administracion']);
begin
  update public.af_labores set
    cantidad_plan = coalesce(p_cantidad, cantidad_plan), costo_unitario_plan = coalesce(p_costo, costo_unitario_plan),
    -- El CHECK af_labores_pasadas_ck rechaza más de una pasada en una labor que no se repite.
    pasadas_plan = coalesce(p_pasadas, pasadas_plan),
    costo_aparte_unitario_plan = coalesce(p_costo_aparte, costo_aparte_unitario_plan),
    editado_por = v_usuario
  where id = p_id;
end $$;
revoke execute on function public.af_actualizar_labor(text, uuid, numeric, numeric, int, numeric) from public;
grant execute on function public.af_actualizar_labor(text, uuid, numeric, numeric, int, numeric) to anon, authenticated;

-- Comprobación: nada nuevo distinto del valor por defecto, y el presupuesto de cada finca igual al de antes.
select (select count(*) from public.af_paquete where pasadas_plan <> 1 or costo_aparte_unitario <> 0) as paquete_distinto,
       (select count(*) from public.af_labores where pasadas_plan <> 1 or costo_aparte_unitario_plan <> 0) as labores_distintas;
select f.nombre,
       sum(l.cantidad_plan * l.costo_unitario_plan) as presupuesto_antes,
       sum(l.cantidad_plan * l.pasadas_plan * (l.costo_unitario_plan + l.costo_aparte_unitario_plan)) as presupuesto_ahora
  from public.af_labores l join public.af_ciclos c on c.id = l.ciclo_id and c.estado = 'ABIERTO'
  join public.af_suertes s on s.id = c.suerte_id join public.af_fincas f on f.id = s.finca_id
 where l.estado <> 'ANULADA'
 group by f.nombre order by f.nombre;
