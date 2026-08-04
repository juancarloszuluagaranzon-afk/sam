---
name: writing-ui-copy
description: >
  Cómo se escribe y se coloca el texto de ayuda en las pantallas de SAM. Úsala
  al crear una pantalla nueva, al agregar un párrafo explicativo, o cuando el
  usuario mencione "texto de ayuda", "info", "explicación", "no se entiende",
  "satura", "muy largo", "botón de info" o "manual".
---

# Texto de la interfaz — SAM

## 🔴 El párrafo que explica una pantalla va SIEMPRE dentro de `<Ayuda>`

`src/components/Ayuda.tsx`. Un botoncito **ⓘ Info**, cerrado por defecto.

```tsx
import { Ayuda } from '../components/Ayuda'   // '../../components/Ayuda' en views/taller/

<div className="panel-title split">
  <h2>📊 Resumen de inventario</h2>
</div>
<Ayuda>
  <p>Cuánto hay, en qué bodega está y qué se está gastando.</p>
</Ayuda>
```

**Por qué.** El texto sirve la primera vez, pero el que entra quince veces al día
ya se lo sabe y en un celular le come media pantalla: hay que rodar para llegar a
lo que viene a ver. Medido en Bodegas: **231 px**, más de un cuarto de la
pantalla, antes del primer dato. El cliente lo reclamó (2-ago-2026).

### Qué va dentro y qué no

| Va en `<Ayuda>` | Se queda suelto |
|---|---|
| El párrafo introductorio de la pantalla | El texto **dentro de un modal** — ahí es la instrucción del momento |
| La explicación de cómo leer los números | Avisos de estado (`⏳ sin avalar`, `⚠ 84 lecturas con dedazo`) |
| El "ojo con esto" permanente de la pantalla | Errores y confirmaciones |

La regla corta: **si estaría igual mañana y pasado, va plegado.** Si depende de
lo que el usuario acaba de hacer, va suelto.

### Al crear una pantalla nueva

1. Escribe el párrafo introductorio.
2. Envuélvelo en `<Ayuda>` **antes** de dar la pantalla por terminada.
3. Verifica el import: `'../components/Ayuda'`, o `'../../components/Ayuda'` si
   la vista está en una subcarpeta como `views/taller/`.

⚠️ Al insertar el import automáticamente, cuidado con los `import { … }` de
varias líneas: meterlo justo después de la primera línea rompe el archivo. Ya
pasó con `FacturacionTab.tsx`.

## Cómo se escribe el texto

- **Di por qué importa, no solo qué hace.** «Sin esto no hay disponibilidad»
  pesa más que «campo obligatorio».
- **Palabras del que usa la app**, no del que la programó: «el carro», no «la
  bodega satélite»; «lo que se gastó», no «el consumo neto».
- **Corto.** Dos o tres frases. Si necesitas más, probablemente la pantalla está
  haciendo demasiadas cosas.
- **Nunca sumes unidades distintas** en un texto ni en un número: galones con
  unidades no dan nada. Ver `agruparDespachos` y `Punto.sufijo`.

## Contraste: el verde de marca NO sirve para texto pequeño en oscuro

`--color-brand` sobre el panel oscuro da **3.58:1** — por debajo del mínimo
legible. Ya mordió dos veces (el botón de Ayuda abierto y el enlace «ver
detalle»). Para texto chico usar `--color-ink-mid` y marcar el estado con borde
o fondo, no tiñendo la letra. Verificar con el cálculo real, no a ojo.

## Los manuales

Viven en `sam/manuales/` y se publican con la app en `public/manuales/`, así se
comparten por WhatsApp con un enlace que siempre funciona:

```
agroserviciosmorales.vercel.app/manuales/manual-operario.html
agroserviciosmorales.vercel.app/manuales/manual-supervisor-insumos.html
agroserviciosmorales.vercel.app/manuales/manual-analista-diego.html
agroserviciosmorales.vercel.app/manuales/manual-taller.html
```

- Los cuerpos son `_cuerpo_*.html`; el estilo común, `_estilo.css`. Se arman con
  el script que deja el CSS **incrustado** en cada archivo: se mandan sueltos y
  tienen que verse igual sin el resto de la carpeta.
- ⚠️ `vite.config.ts` lleva `navigateFallbackDenylist: [/^\/manuales\//]`. Sin
  eso el service worker se queda con la navegación y a quien tiene la PWA
  instalada le abre el aplicativo en vez del manual.
- **Al cambiar una pantalla, revisar si el manual quedó mintiendo.** Ya pasó: el
  manual decía que el combustible entraba por tanqueo, y el tanqueo no tiene
  ningún destino que le sume a la principal.

### Los manuales están DENTRO de la app

`<BotonManual>` (`src/components/`) va en el menú lateral (dueño, administración,
supervisor, operario) y en la barra superior de los roles que no tienen menú
(analista, supervisor de insumos, conductor). `manualesDe(rol)` decide cuál abrir;
a quien le sirven varios le muestra un selector.

Se abre en pestaña aparte (`window.open(..., '_blank', 'noopener')`) para no
perder lo que estaba haciendo. **Al agregar un rol nuevo: sumarlo a `manualesDe()`**,
o ese rol se queda sin manual y nadie se entera.
