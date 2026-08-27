---
name: managing-madera
description: >
  Módulo de TRANSPORTE DE TROZAS (madera): partes de viaje con foto de la guía,
  rol `conductor_madera`, catálogo de predios y destinos. Úsala cuando toques
  MaderaTab, MaderaForm, MaderaView, maderaApi o la tabla `madera_viajes`.
  También si el usuario menciona "madera", "trozas", "viajes del camión",
  "guía de despacho", "Palomino", "MADERAS BARBOSA", "MADERAS YARUMAL",
  "FINCA LA ARGENTINA" o "conductor de madera".
---

# Transporte de trozas — negocio nuevo del cliente

Arrancado el 24-ago-2026. El dueño de AgroServicios Morales montó una línea de
**transporte de madera** y pidió llevarla en la misma app.

⚠️ **NO confundir con el módulo Flota/Escolta.** Ese es el CDA-F-68 de las
camionetas; ver `managing-flota`. Aquí el vehículo es el camión de trozas y el
documento es la guía de despacho.

## 🔴 Lo primero: para qué existe

**El dueño del camión vive lejos y quiere saber qué hizo su vehículo.** Eso no
es un problema de reportes, es de **confianza**. Y no se resuelve con más
campos: se resuelve con prueba.

De ahí salen las dos decisiones que sostienen todo el módulo:

- **El kilometraje no se declara, se demuestra** — va con foto.
- **La hora no se digita: la pone el servidor.** El reloj del celular se puede
  cambiar, el del servidor no. Y se MUESTRA en pantalla, porque que se vea es
  parte del control.

Todo lo demás es accesorio. Cuando se dude de un campo nuevo, la pregunta es si
sirve para que alguien que no está pueda creerle al registro.

## El primer diseño estuvo MAL, y por qué

Se construyó primero un módulo de **salvoconductos** con 13 campos: SUNL, ICA,
vigencia, especie, volumen en m³, configuración del vehículo. El cliente lo vio y
dijo *"lo veo muy complejo"*.

El caso real era otro y mucho más chico. La lección: **el módulo se diseñó desde
la investigación de mercado y no desde la operación del cliente.** La
investigación era correcta —el salvoconducto vence a los 8 días y sin él
decomisan el vehículo— pero eso todavía no es el problema de ESTE cliente hoy.

Quedó en cinco campos y una foto. La investigación completa sigue en
`managing-facturacion` y en el artefacto "Del monte a la planta", para cuando
crezca.

## La tabla

`madera_viajes` (migraciones `20260824140000` y `20260824160000`).

| Columna | Nota |
|---|---|
| `placa` | del camión |
| `km_inicio` / `km_fin` | **OPCIONALES** hoy, ver abajo |
| `foto_tablero_url` / `foto_tablero_fin_url` | mal nombradas: hoy guardan la **guía de despacho** |
| `toneladas` | |
| `predio` | de dónde sale (se mapea a `origen` en el código) |
| `destino` | |
| `created_at` | **la hora, puesta por la base** — no se manda desde el cliente |

🔴 **`km_fin` va nullable a propósito**: `null` = el viaje sigue abierto, que es
distinto de "recorrió cero". Mismo criterio que `insumos_solicitudes.engraso`.

🔴 **`km_recorridos` NO es una columna**: sale de la resta en `madera_viajes_v`.
Guardarlo permitiría que contradijera a los dos kilometrajes que sí tienen foto.

## ⚠️ El odómetro está dañado (27-ago-2026)

El camión tiene el medidor malo, así que **el kilometraje quedó opcional** y la
foto pasó a ser de la **guía de despacho**.

No se borró el campo porque el odómetro se va a arreglar. Y exigirlo con el
medidor dañado obligaría a inventar un número: **un dato inventado es peor que
uno que falta — el que falta se ve, el inventado no.**

Para volver a exigirlo cuando lo reparen: quitar el `|| 0` en `MaderaForm.guardar`
y en `MaderaTab.guardarCierre`, y devolver el `*` a la etiqueta.

## El rol `conductor_madera`

Aparte de `conductor` (el escolta). En el mismo rol, cada uno tendría encima la
pantalla del otro.

**Ve solo sus viajes** y **no tiene botón de anular**: corregir es de
administración; el conductor llama, no borra su propio registro.

⚠️ Agregar el rol costó **13 ediciones en 9 archivos** — ver el checklist en
`managing-supabase`. La migración del CHECK va PRIMERO y se prueba insertando un
usuario: `conductor` estuvo seis días creado en el código y rechazado por la
base.

## 🔴 La placa sale sola, por DOS caminos

Palomino (`U054`) tiene el `VCQ605` asignado y aun así la placa le salía vacía.
La causa no era el código sino **cuándo se guarda el dato**:

`session.equipmentCode` se graba **al ENTRAR**. A quien le asignen el camión hoy,
su sesión abierta sigue sin él hasta que vuelva a entrar — y en carretera nadie
cierra sesión.

Por eso se resuelve así, en orden:
1. `session.equipmentCode`
2. **`users.find(...)?.equipmentCode`** — `users` sí se recarga en cada arranque
3. el único vehículo de la flota (no aplica: hay tres)

Mismo patrón en `FlotaForm`. Si aparece otro formulario con placa, copiarlo.

## Los lugares

`catalogos_valores` con `tipo = 'PREDIO'` y `'DESTINO_MADERA'`. Reales hoy:
**FINCA LA ARGENTINA** · **MADERAS BARBOSA** · **MADERAS YARUMAL**.

⚠️ Se administran en **Más → Catálogos → Lugares y listas**, no en Insumos. El
cliente no los encontraba porque en la app hay **dos cosas llamadas "Catálogos"**
y él fue a la que agrupa Maestros y Labores — que es donde uno busca un catálogo.
La pantalla es la misma; solo se le agregó una segunda puerta.

**Sugieren, no obligan.** Ordenar la lista sirve para que no queden tres
variantes del mismo destino en los reportes, no para ponerle un muro al que está
cargando en la montaña a las 5 a.m.

## Datos de prueba vivos

Quedan **6 viajes marcados `DEMO`** en producción (`nota like 'DEMO%'`) con los
lugares inventados que ya se borraron del catálogo. Sirven para mostrar el módulo
mientras no hay viajes reales. **Borrarlos antes de que empiecen a registrar de
verdad**, o se mezclan:

```sql
delete from madera_viajes where nota like 'DEMO%';
```
