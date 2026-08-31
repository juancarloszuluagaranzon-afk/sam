-- Lo que Genaro entrega SIEMPRE tiene que quedar en el kardex (31-ago-2026).
--
-- 🔴 Qué pasó. La entrega directa se guardaba en TRES pasos sueltos desde el
-- navegador: la entrega, sus materiales, y un descuento de inventario por cada
-- material. Sin transacción. Si la señal se cortaba en la mitad —y Genaro
-- entrega en campo, con señal intermitente— quedaba a medias:
--
--   · 3 entregas SIN un solo material (el paso 1 pasó, el 2 no)
--   · 1 entrega de 50 galones que nunca salió del inventario
--   · 1 entrega con 4 materiales que solo descontó el combustible
--
-- Todas del 26 y 27 de agosto, todas de la misma persona. Lo peor no es el
-- número: es que el sistema decía que el material seguía en el carro cuando ya
-- se lo habían llevado, y nadie tenía cómo darse cuenta.
--
-- Aquí se hace TODO dentro de una sola transacción. O queda completa, o no
-- queda nada — y si no queda nada, el supervisor lo ve y lo vuelve a intentar,
-- que es infinitamente mejor que un registro a medias que nadie revisa.
create or replace function public.entregar_directo(
  p_id             uuid,
  p_operario_id    text,
  p_operario_nombre text,
  p_despachado_por text,
  p_equipo_codigo  text,
  p_bodega_id      uuid,
  p_horometro      numeric,
  p_ruta           text,
  p_nota           text,
  p_evidencia      text[],
  p_engraso        boolean,
  p_items          jsonb
) returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_item      jsonb;
  v_insumo_id uuid;
  v_cant      numeric;
  v_saldo     numeric;
  v_bodega    uuid := p_bodega_id;
  v_ahora     timestamptz := now();
begin
  -- 🔴 El id lo trae el cliente para que un REINTENTO no cree una entrega nueva.
  -- Dos de las entregas vacías del 26 de agosto eran justo eso: la misma entrega
  -- reintentada, con el mismo horómetro, un minuto después.
  if exists (select 1 from public.insumos_solicitudes where id = p_id) then
    return p_id;
  end if;

  if v_bodega is null then
    select b.id into v_bodega from public.bodegas b where b.tipo = 'PRINCIPAL' limit 1;
    if v_bodega is null then
      raise exception 'SIN_BODEGA: no hay bodega principal configurada';
    end if;
  end if;

  insert into public.insumos_solicitudes (
    id, operario_id, operario_nombre, nota, origen, estado, entregado_en,
    despachado_por, ruta, horometro, equipo_codigo, bodega_id, evidencia_urls, engraso
  ) values (
    p_id, p_operario_id, p_operario_nombre, p_nota, 'DIRECTA', 'ENTREGADA', v_ahora,
    p_despachado_por, p_ruta, p_horometro, p_equipo_codigo, v_bodega,
    coalesce(p_evidencia, '{}'::text[]), p_engraso
  );

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_insumo_id := nullif(v_item->>'insumoId', '')::uuid;
    v_cant      := round(abs(coalesce((v_item->>'cantidad')::numeric, 0)), 2);

    insert into public.insumos_solicitud_items (
      solicitud_id, insumo_id, insumo_nombre, unidad, cantidad, cantidad_despachada
    ) values (
      p_id, v_insumo_id, v_item->>'insumoNombre', v_item->>'unidad', v_cant, v_cant
    );

    -- Un material en cero se anota pero no mueve inventario: es la diferencia
    -- entre "se pidió y no había" y "salió del carro".
    if v_insumo_id is not null and v_cant > 0 then
      select round(coalesce(s.stock, 0) - v_cant, 2) into v_saldo
        from (select stock from public.insumos_stock
               where insumo_id = v_insumo_id and bodega_id = v_bodega) s;
      v_saldo := coalesce(v_saldo, -v_cant);

      insert into public.insumos_kardex (
        insumo_id, bodega_id, tipo, cantidad, saldo, motivo, referencia,
        creado_por, equipo_codigo
      ) values (
        v_insumo_id, v_bodega, 'SALIDA', v_cant, v_saldo, 'Entrega directa',
        p_id::text, p_despachado_por, p_equipo_codigo
      );

      insert into public.insumos_stock (insumo_id, bodega_id, stock, updated_at)
      values (v_insumo_id, v_bodega, v_saldo, v_ahora)
      on conflict (insumo_id, bodega_id)
        do update set stock = excluded.stock, updated_at = excluded.updated_at;

      -- `insumos.stock` es el consolidado de todas las bodegas.
      update public.insumos i
         set stock = (select round(coalesce(sum(st.stock), 0), 2)
                        from public.insumos_stock st where st.insumo_id = v_insumo_id),
             updated_at = v_ahora
       where i.id = v_insumo_id;
    end if;
  end loop;

  return p_id;
end;
$$;

comment on function public.entregar_directo is
  'Entrega directa COMPLETA en una sola transaccion: entrega + materiales + kardex + stock. Idempotente por p_id (un reintento no duplica).';

grant execute on function public.entregar_directo(
  uuid, text, text, text, text, uuid, numeric, text, text, text[], boolean, jsonb
) to anon, authenticated;
