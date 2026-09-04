# Manuales de AgroMorales

Cinco guías, una por rol. Se comparten **por enlace**, no como archivo adjunto:

| Manual | Para quién | Enlace |
|---|---|---|
| Operario | Los que manejan las máquinas | `/manuales/manual-operario.html` |
| Supervisor de insumos | Genaro y Eduvin | `/manuales/manual-supervisor-insumos.html` |
| Analista de insumos | Diego | `/manuales/manual-analista-diego.html` |
| Taller de maquinaria | Quien carga el taller | `/manuales/manual-taller.html` |
| Conductor de camioneta | Julián, Camilo — los que llenan el F-OPE-22 | `/manuales/manual-conductor.html` |

Base: `https://agroserviciosmorales.vercel.app`

**También se abren desde adentro de la app**: `<BotonManual>` (`src/components/`)
va en el menú lateral (dueño, administración, supervisor, operario) y en la barra
superior de los roles que no tienen menú (analista, supervisor de insumos,
conductor). `manualesDe(rol)` decide cuál mostrar; a quien le sirven varios le abre
un selector. **Al agregar un rol nuevo hay que sumarlo ahí**, o ese rol se queda sin
manual y nadie se entera. El enlace suelto sigue existiendo para WhatsApp.

## Cómo se arman

```
_estilo.css          ← estilo común de los cinco
_cuerpo_*.html       ← el contenido de cada uno
manual-*.html        ← el resultado, con el CSS YA INCRUSTADO
```

El armado toma cada cuerpo, le mete el CSS adentro y escribe el archivo final.
Después se copian a `sam-app/public/manuales/` para que se publiquen con la app.

**El CSS va incrustado a propósito.** Estos archivos se mandan por WhatsApp y se
abren en el celular de alguien que no tiene el resto de la carpeta; uno que
dependa de otro archivo llega roto.

## Cosas que hay que saber antes de tocarlos

**El service worker.** `vite.config.ts` lleva
`navigateFallbackDenylist: [/^\/manuales\//]`. Sin eso el service worker del PWA
se queda con la navegación y a quien tenga la app instalada le abre el
aplicativo en vez del manual — justo el caso de mandarlo por WhatsApp. Se
descubrió porque `curl` traía el manual correcto pero el navegador mostraba la
app.

**Los "recortes" son réplicas, no capturas.** Están dibujados con las mismas
clases del manual (`.recorte`, `.r-card`, `.r-btn`…) reproduciendo textos y
botones reales leídos del código. Si algún día se pueden tomar capturas de
verdad, reemplazan al `<div class="recorte">` sin tocar nada más.

**Al cambiar una pantalla, revisar si el manual quedó mintiendo.** Ya pasó una
vez: el manual de Diego decía que el combustible «nunca se mete a mano, entra
por tanqueo», y el tanqueo no tiene ningún destino que le sume a la bodega
principal. El camino real es **Inventario → + Entrada**. Un manual equivocado es
peor que no tener manual: la persona hace lo que dice y se queda trabada.

## Estructura de cada manual

- **Portada** — para quién es y qué resuelve.
- **Índice** con anclas a cada sección.
- **Secciones numeradas**: cada una lleva un "recorte" de la pantalla y al lado
  la explicación numerada de qué hace cada cosa **y por qué importa**.
- **`.ojo`** (rojo) para lo que se daña si se hace mal; **`.tip`** (verde) para
  los atajos.
- **Cierre**: tabla de "lo que no se puede olvidar".

Están hechos para leerse en el celular y también para imprimirse — el bloque
`@media print` evita que una sección se parta a la mitad.
