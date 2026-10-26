-- Fincas · Plan y presupuesto del corte (25-oct-2026).
--
-- El asistente «Iniciar corte» deja ajustar el presupuesto ANTES de activar el corte. Para que
-- no quede un corte a medias si algo falla, abrir el corte y aplicar los ajustes de costo es UNA
-- sola operación (una transacción). Nada cambia en las tablas: es una función nueva.
--
--   af__abrir_ciclo_plan(suerte, fecha, tipo, ajustes, usuario)   interna (la prueban las pruebas)
--   af_abrir_ciclo_plan(token, suerte, fecha, tipo, ajustes)      la que llama la app
--
-- `ajustes` es una lista de objetos, uno por labor del corte:
--   {"labor": "FERTILIZACIÓN", "unidad": "ha", "costo": 160000, "costo_aparte": 850000, "pasadas": 1}
-- `unidad`, `costo`, `costo_aparte` y `pasadas` son opcionales: lo que no venga se deja como lo
-- copió el catálogo. «costo» = servicio de AgroMorales; «costo_aparte» = «Ppto por ha» en pantalla
-- (la columna no se renombra, igual que aval/aprobación).
-- La app vieja sigue usando af_abrir_ciclo sin cambios.

create or replace function public.af__abrir_ciclo_plan(
  p_suerte uuid, p_fecha_corte date, p_tipo text, p_ajustes jsonb, p_usuario text
) returns uuid
language plpgsql security definer set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v_ciclo uuid;
  v_a jsonb;
  v_n integer;
  v_labor text;
  v_costo numeric;
  v_aparte numeric;
  v_pasadas integer;
begin
  if p_ajustes is null or jsonb_typeof(p_ajustes) <> 'array' then
    raise exception 'AJUSTES_INVALIDOS: los ajustes deben ser una lista' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(p_ajustes) > 100 then
    raise exception 'AJUSTES_INVALIDOS: demasiados ajustes' using errcode = 'check_violation';
  end if;

  -- Abre el corte con el catálogo (valida permiso, fecha y suerte; deja puesta la marca
  -- «viene de una función» durante toda la transacción).
  v_ciclo := public.af__abrir_ciclo(p_suerte, p_fecha_corte, p_tipo, p_usuario);

  for v_a in select * from jsonb_array_elements(p_ajustes) loop
    if jsonb_typeof(v_a) <> 'object' then
      raise exception 'AJUSTES_INVALIDOS: cada ajuste debe ser un objeto' using errcode = 'check_violation';
    end if;
    v_labor := nullif(btrim(v_a ->> 'labor'), '');
    if v_labor is null then
      raise exception 'AJUSTES_INVALIDOS: falta el nombre de la labor' using errcode = 'check_violation';
    end if;
    begin
      v_costo := (v_a ->> 'costo')::numeric;
      v_aparte := (v_a ->> 'costo_aparte')::numeric;
      v_pasadas := (v_a ->> 'pasadas')::integer;
    exception when others then
      raise exception 'AJUSTES_INVALIDOS: «%» trae un número que no se entiende', v_labor using errcode = 'check_violation';
    end;
    if coalesce(v_costo, 0) < 0 or coalesce(v_aparte, 0) < 0 then
      raise exception 'COSTO_INVALIDO: «%» no puede tener costos negativos', v_labor using errcode = 'check_violation';
    end if;
    if v_pasadas is not null and v_pasadas < 1 then
      raise exception 'PASADAS_INVALIDAS: «%» necesita al menos una pasada', v_labor using errcode = 'check_violation';
    end if;
    if v_pasadas is not null and v_pasadas > 1 and exists (
      select 1 from public.af_labores
       where ciclo_id = v_ciclo and upper(btrim(labor)) = upper(v_labor) and not repetible
    ) then
      raise exception 'PASADAS_NO_APLICA: «%» no se repite en el corte, solo lleva una pasada', v_labor using errcode = 'check_violation';
    end if;

    update public.af_labores set
      costo_unitario_plan = coalesce(v_costo, costo_unitario_plan),
      costo_aparte_unitario_plan = coalesce(v_aparte, costo_aparte_unitario_plan),
      pasadas_plan = case when repetible then coalesce(v_pasadas, pasadas_plan) else 1 end,
      editado_por = p_usuario
     where ciclo_id = v_ciclo
       and upper(btrim(labor)) = upper(v_labor)
       and (nullif(btrim(v_a ->> 'unidad'), '') is null or unidad = btrim(v_a ->> 'unidad'));
    get diagnostics v_n = row_count;
    if v_n = 0 then
      raise exception 'LABOR_NO_EXISTE: «%» no está en este corte', v_labor using errcode = 'no_data_found';
    end if;
  end loop;

  return v_ciclo;
end $fn$;

create or replace function public.af_abrir_ciclo_plan(
  p_token text, p_suerte uuid, p_fecha_corte date, p_tipo text, p_ajustes jsonb default '[]'::jsonb
) returns uuid
language plpgsql security definer set search_path to 'public', 'pg_catalog'
as $fn$
begin
  return public.af__abrir_ciclo_plan(
    p_suerte, p_fecha_corte, p_tipo, p_ajustes,
    public.af__usuario(p_token, array['owner', 'administracion']));
end $fn$;

-- La interna nunca se llama desde la app: solo el dueño de la base (igual que af__abrir_ciclo).
revoke all on function public.af__abrir_ciclo_plan(uuid, date, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.af_abrir_ciclo_plan(text, uuid, date, text, jsonb) from public;
grant execute on function public.af_abrir_ciclo_plan(text, uuid, date, text, jsonb) to anon, authenticated;
