-- Corregir los galones de un tanqueo, de forma ATÓMICA.
--
-- Nace del incidente del 22-ago-2026: alguien registró 62.255 galones en una
-- carga de 62,255 y el dueño tuvo que pedir que se lo arreglaran a mano, porque
-- **un tanqueo no se puede editar desde ninguna pantalla**. La corrección se
-- hizo por SQL en seis pasos.
--
-- 🔴 Por qué es una función y no seis llamadas desde el navegador.
--
-- Corregir la cantidad obliga a rehacer el `saldo` de TODOS los movimientos
-- posteriores de esa bodega, porque el saldo es una foto del stock en ese
-- instante y no una fórmula. Seis llamadas sueltas desde el cliente pueden
-- cortarse en la tercera —se cierra el navegador, se cae la señal— y dejar el
-- kardex a medio corregir, que es peor que no haberlo tocado. Aquí o pasa todo
-- o no pasa nada.
--
-- ⚠️ NO avala. Corregir y avalar son cosas distintas: el aval es el segundo par
-- de ojos y si la misma acción hiciera las dos, el control desaparece. Un
-- tanqueo corregido sigue PENDIENTE hasta que alguien lo revise.

create or replace function public.corregir_tanqueo(
  p_id           uuid,
  p_galones      numeric,
  p_motivo       text,
  p_editado_por  text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ev        record;
  v_antes     numeric;
  v_pares     record;
  v_saldo     numeric;
  v_fila      record;
  v_tocadas   int := 0;
begin
  if p_galones is null or p_galones <= 0 then
    raise exception 'Los galones tienen que ser mayores que cero.';
  end if;
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'Hay que decir por que se corrige.';
  end if;

  -- Se bloquea el evento para que dos personas no lo corrijan a la vez.
  select * into v_ev from combustible_externo where id = p_id for update;
  if not found then
    raise exception 'Ese tanqueo ya no existe.';
  end if;
  if v_ev.estado = 'RECHAZADO' then
    raise exception 'Ese tanqueo fue rechazado: el movimiento ya se reverso, no hay que corregirlo.';
  end if;

  v_antes := v_ev.galones;
  if v_antes = p_galones then
    return jsonb_build_object('sin_cambio', true, 'galones', p_galones);
  end if;

  -- 1. El hecho.
  update combustible_externo set galones = p_galones where id = p_id;

  -- 2. Sus filas de kardex. Un tanqueo puede tener 0, 1 o 2:
  --    origen='SEDE'          -> SALIDA de la principal
  --    destino CARRO/PIMPINAS -> ENTRADA al satelite
  --    destino MAQUINA/VEHICULO sin sede -> ninguna, es consumo puro.
  update insumos_kardex set cantidad = p_galones where referencia = p_id::text;

  -- 3. Rehacer la cadena de saldos de cada (insumo, bodega) tocada.
  --    Se recalcula desde el principio en vez de desplazar por la diferencia:
  --    asi los AJUSTE quedan bien, que FIJAN el saldo en vez de sumarlo.
  for v_pares in
    select distinct insumo_id, bodega_id from insumos_kardex
     where referencia = p_id::text and bodega_id is not null
  loop
    v_saldo := 0;
    for v_fila in
      select id, tipo, cantidad, saldo from insumos_kardex
       where insumo_id = v_pares.insumo_id and bodega_id = v_pares.bodega_id
       order by fecha_efectiva asc, created_at asc, id asc
    loop
      if v_fila.tipo = 'AJUSTE' then
        -- El ajuste es un conteo fisico: fija el saldo, no lo suma.
        v_saldo := v_fila.saldo;
      elsif v_fila.tipo = 'SALIDA' then
        v_saldo := round((v_saldo - v_fila.cantidad)::numeric, 2);
      else
        v_saldo := round((v_saldo + v_fila.cantidad)::numeric, 2);
      end if;
      update insumos_kardex set saldo = v_saldo where id = v_fila.id;
      v_tocadas := v_tocadas + 1;
    end loop;

    -- 4. El stock de esa bodega queda en el ultimo saldo de la cadena.
    insert into insumos_stock (insumo_id, bodega_id, stock, updated_at)
    values (v_pares.insumo_id, v_pares.bodega_id, v_saldo, now())
    on conflict (insumo_id, bodega_id)
    do update set stock = excluded.stock, updated_at = now();

    -- 5. Y el consolidado, que es la suma de todas las bodegas.
    update insumos i
       set stock = (select round(coalesce(sum(s.stock), 0)::numeric, 2)
                      from insumos_stock s where s.insumo_id = i.id)
     where i.id = v_pares.insumo_id;
  end loop;

  -- 6. El rastro. `solicitud_id` es NOT NULL: para un tanqueo va su propio id.
  insert into insumos_despachos_auditoria (solicitud_id, accion, cambios, editado_por, editado_en)
  values (p_id::text, 'CORREGIR_TANQUEO', jsonb_build_object(
    'galones', jsonb_build_object('antes', v_antes, 'despues', p_galones),
    'motivo', btrim(p_motivo),
    'filas_de_kardex_recalculadas', v_tocadas
  ), coalesce(p_editado_por, 'desconocido'), now());

  return jsonb_build_object(
    'ok', true,
    'antes', v_antes,
    'despues', p_galones,
    'filas_recalculadas', v_tocadas
  );
end $$;

comment on function public.corregir_tanqueo is
  'Corrige los galones de un tanqueo y rehace la cadena de saldos de las bodegas '
  'afectadas, todo en una transaccion. NO avala: el tanqueo sigue pendiente del '
  'segundo par de ojos.';

grant execute on function public.corregir_tanqueo(uuid, numeric, text, text)
  to anon, authenticated;

notify pgrst, 'reload schema';
