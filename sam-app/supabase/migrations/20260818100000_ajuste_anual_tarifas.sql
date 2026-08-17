-- Ajuste anual de tarifas: cerrar todas las vigentes y abrir las nuevas, de un golpe.
--
-- Los precios se renegocian cada año. Subirlos de a uno son catorce pasos, y una
-- tarea de catorce pasos que se hace una vez al año termina haciéndose en Excel
-- por fuera del sistema — que es justo lo que este módulo vino a reemplazar.
--
-- ⚠️ VA EN LA BASE Y NO EN EL NAVEGADOR, y esa es la decisión importante. Si el
-- ajuste fuera una ristra de updates desde el celular y se cae la señal a mitad,
-- la mitad de las labores queda con precio nuevo y la otra mitad con el viejo.
-- Nadie se entera hasta que alguien arma una factura y le da un número raro.
-- Aquí es una transacción: o quedan todas, o no queda ninguna.

create or replace function aplicar_ajuste_tarifas(
  p_desde      date,
  p_nota       text,
  p_creado_por text,
  -- [{ "tarifa_id": "...", "precio_nuevo": 104000 }, ...]
  p_lineas     jsonb
)
returns integer
language plpgsql
as $$
declare
  v_vispera date := p_desde - 1;
  v_cuenta  integer := 0;
  v_linea   jsonb;
  v_tarifa  tarifas%rowtype;
begin
  if p_lineas is null or jsonb_array_length(p_lineas) = 0 then
    return 0;
  end if;

  for v_linea in select * from jsonb_array_elements(p_lineas)
  loop
    select * into v_tarifa from tarifas
     where id = (v_linea->>'tarifa_id')::uuid
     for update;

    if not found then
      raise exception 'No existe la tarifa %', v_linea->>'tarifa_id';
    end if;

    -- Guarda contra aplicar dos veces el mismo ajuste: si la vigencia ya
    -- empieza en o después de la fecha nueva, este ajuste ya se hizo.
    if v_tarifa.vigente_desde >= p_desde then
      raise exception 'La tarifa de % (%) ya rige desde el % — el ajuste ya se aplicó',
        v_tarifa.labor_nombre, coalesce(v_tarifa.tercero_id::text, 'general'), v_tarifa.vigente_desde;
    end if;

    -- 1. Cerrar la vigencia anterior la víspera. Sin esto quedarían dos precios
    --    vigentes a la vez y ganaría uno por accidente, no por decisión.
    update tarifas set vigente_hasta = v_vispera where id = v_tarifa.id;

    -- 2. Abrir la nueva.
    insert into tarifas (tercero_id, labor_nombre, precio_ha, vigente_desde, nota, creado_por)
    values (v_tarifa.tercero_id, v_tarifa.labor_nombre,
            (v_linea->>'precio_nuevo')::numeric, p_desde,
            coalesce(p_nota, 'Ajuste anual'), p_creado_por);

    v_cuenta := v_cuenta + 1;
  end loop;

  return v_cuenta;
end;
$$;

comment on function aplicar_ajuste_tarifas is
  'Ajuste anual en bloque: cierra cada vigencia la víspera de p_desde y abre la '
  'nueva con el precio dado. Todo o nada. Falla si alguna tarifa ya rige desde '
  'esa fecha, para que aplicar dos veces no duplique el aumento.';

grant execute on function aplicar_ajuste_tarifas(date, text, text, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
