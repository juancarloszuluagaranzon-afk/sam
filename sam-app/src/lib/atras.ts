/**
 * Botón «atrás» del celular: devuelve a la pantalla anterior en vez de cerrar la página o la app, y así
 * sucesivamente hasta salir (la primera pantalla). Pedido de Iván (26-oct-2026) para todos sus proyectos.
 *
 * El navegador solo recuerda las pantallas con ruta propia. Lo que se abre SIN cambiar de ruta (ventanas,
 * hojas, menú lateral, pasos de un asistente, pestañas guardadas en un estado) no deja rastro y «atrás» saca
 * al usuario de todo. Aquí cada una de esas cosas deja una entrada en el historial y «atrás» la deshace.
 *
 *  - useCapaAtras(abierta, cerrar): para lo que se abre por encima (ventana, hoja, cajón, menú).
 *  - useVistaAtras(vista, cambiarVista, clave): para pantallas o pestañas que viven en un estado de React.
 *
 * Archivo sin dependencias a propósito (solo React): se copia tal cual a cualquier proyecto con React.
 * Probado en el navegador: ver docs/ATRAS-CELULAR.md.
 */
import { useEffect, useRef } from 'react';

interface Capa {
  id: string;
  cerrar: () => void;
}

/** Capas abiertas, de la más antigua a la más reciente. */
const pila: Capa[] = [];
let contador = 0;
let escuchando = false;
/** Última vez que se tocó un enlace: si una capa se cierra justo después, el enlace está navegando. */
let ultimoEnlace = 0;

function estado(): Record<string, unknown> {
  const s = typeof window === 'undefined' ? null : window.history.state;
  return s && typeof s === 'object' ? (s as Record<string, unknown>) : {};
}

function alVolver() {
  const actual = estado().__capa;
  // Las capas que quedaron «por encima» de la entrada a la que se volvió se cierran.
  while (pila.length && pila[pila.length - 1].id !== actual) {
    pila.pop()!.cerrar();
  }
  // Entrada huérfana (su capa ya no existe: se recargó la página o se cambió de ruta): se salta.
  if (typeof actual === 'string' && !pila.some((c) => c.id === actual)) window.history.back();
}

function escuchar() {
  if (escuchando || typeof window === 'undefined') return;
  escuchando = true;
  // Página recargada con una capa abierta: la entrada recuerda una capa que ya no existe; se limpia.
  const { __capa, ...resto } = estado();
  if (__capa !== undefined) window.history.replaceState(resto, '');
  window.addEventListener('popstate', alVolver);
  document.addEventListener(
    'click',
    (e) => {
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (a && a.target !== '_blank') ultimoEnlace = Date.now();
    },
    true,
  );
}

/** ¿Una navegación está en curso? Entonces quitar la entrada con history.back() la deshace (ver abrirCapa). */
const navegandoPorEnlace = () => Date.now() - ultimoEnlace < 1500;

/**
 * Abre una capa: agrega una entrada al historial (o reutiliza una que quedó vacía). Devuelve la función que
 * la quita cuando se cierra con su propio botón (X, Cancelar, guardar). Si se cierra con «atrás», `cerrar`
 * se llama sola. Se usa directo solo en código que no es de React; en React, useCapaAtras.
 *
 * Al cerrar con su botón se quita su entrada con history.back(), salvo que esa pulsación sea un enlace que
 * navega (menú «Más»): el back() deshacía la navegación y el usuario se quedaba donde estaba. Entonces la
 * entrada queda vacía y «atrás» la salta sola (alVolver); abrir otra capa encima la reutiliza.
 */
export function abrirCapa(cerrar: () => void): { capa: Capa; quitar: (conservarEntrada?: boolean) => void } {
  escuchar();
  const capa: Capa = { id: `capa${++contador}`, cerrar };
  pila.push(capa);
  const s = estado();
  // Se conserva el estado que ya tenía la entrada (rutas de Next, vistas guardadas): si no, Next recarga la página.
  const nuevo = { ...s, __capa: capa.id };
  const vacia = typeof s.__capa === 'string' && !pila.some((c) => c.id === s.__capa);
  if (vacia) window.history.replaceState(nuevo, '');
  else window.history.pushState(nuevo, '');
  return {
    capa,
    quitar: (conservarEntrada = false) => {
      const i = pila.indexOf(capa);
      if (i === -1) return; // ya la cerró «atrás»
      pila.splice(i, 1);
      if (!conservarEntrada && !navegandoPorEnlace() && estado().__capa === capa.id) window.history.back();
    },
  };
}

/** Todo lo que se abre por encima de la pantalla sin cambiar de ruta. «Atrás» la cierra y deja la pantalla de abajo. */
export function useCapaAtras(abierta: boolean, cerrar: () => void) {
  const cerrarRef = useRef(cerrar);
  useEffect(() => {
    cerrarRef.current = cerrar;
  });
  // El modo estricto de React (y solo él) desmonta y vuelve a montar de inmediato: si la capa se quita y se
  // abre otra en el mismo instante, se reutiliza la misma entrada.
  const pendiente = useRef<{ capa: Capa; quitar: () => void } | null>(null);

  useEffect(() => {
    if (!abierta || typeof window === 'undefined') return;
    let mia = pendiente.current;
    if (mia) {
      pendiente.current = null;
      pila.push(mia.capa);
    } else {
      mia = abrirCapa(() => cerrarRef.current());
    }
    const actual = mia;
    return () => {
      const i = pila.indexOf(actual.capa);
      if (i === -1) return; // ya la cerró «atrás»
      pila.splice(i, 1);
      pendiente.current = actual;
      queueMicrotask(() => {
        if (pendiente.current !== actual) return; // se reutilizó
        pendiente.current = null;
        pila.push(actual.capa); // quitar() la saca de la pila y decide si borra la entrada
        actual.quitar();
      });
    };
  }, [abierta]);
}

const igual = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/**
 * Pantalla o pestaña que vive en un estado de React (menú inferior, pestañas, vistas por `useState`).
 * Cada cambio deja una entrada; «atrás» restaura la vista anterior, y desde la primera sale de la app.
 * `clave`: nombre único de ese estado dentro de la app. El valor debe poder copiarse (texto, número, objeto simple).
 * `reemplazar(v)`: vistas finales (reserva hecha, pedido enviado, pago aprobado) que NO deben ser una pantalla más
 * del recorrido: ocupan el lugar de la anterior en vez de sumar una entrada.
 */
export function useVistaAtras<T>(vista: T, cambiarVista: (v: T) => void, clave: string, reemplazar?: (v: T) => boolean) {
  const k = `__v_${clave}`;
  const ultima = useRef(vista);
  const desdeAtras = useRef(false);
  const cambiarRef = useRef(cambiarVista);
  useEffect(() => {
    cambiarRef.current = cambiarVista;
  });

  useEffect(() => {
    // La entrada actual recuerda la vista con la que arrancó esta pantalla (aunque el estado guardara una vieja
    // de otra visita: pestañas que se desmontan y se vuelven a montar).
    window.history.replaceState({ ...estado(), [k]: ultima.current, [`${k}_n`]: 0 }, '');
    const alVolverVista = () => {
      const v = estado()[k] as T | undefined;
      if (v !== undefined && !igual(v, ultima.current)) {
        desdeAtras.current = true;
        cambiarRef.current(v);
      }
    };
    window.addEventListener('popstate', alVolverVista);
    return () => window.removeEventListener('popstate', alVolverVista);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (igual(ultima.current, vista)) return;
    ultima.current = vista;
    if (desdeAtras.current) {
      desdeAtras.current = false;
      return;
    }
    if (reemplazar?.(vista)) window.history.replaceState({ ...estado(), [k]: vista }, '');
    else window.history.pushState({ ...estado(), [k]: vista, [`${k}_n`]: Number(estado()[`${k}_n`] ?? 0) + 1 }, '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vista]);
}

/**
 * Regresa de un solo salto a la primera vista de `clave` (cuando el recorrido terminó y las entradas viejas ya no
 * sirven: reserva hecha, pedido enviado). Así el usuario no tiene que pulsar «atrás» varias veces sobre la misma pantalla.
 */
export function volverAlInicioDeVista(clave: string) {
  const n = Number(estado()[`__v_${clave}_n`] ?? 0);
  if (n > 0) window.history.go(-n);
}

/**
 * Para proyectos con MUCHAS ventanas hechas a mano (SAM: ~110 en ~60 archivos): en vez de tocar cada una, se vigila
 * la pantalla. Cuando aparece un elemento que cumple `selector` (por ejemplo '.modal-overlay') se registra como
 * capa; cuando desaparece se quita. Con «atrás» se cierra como lo haría el usuario: toca su botón de cerrar
 * (`.modal-close-btn`, `aria-label="Cerrar"` o un botón «Cancelar/Cerrar/Volver») o, si no tiene, el fondo.
 * Si la ventana no se deja cerrar (guardando, por ejemplo), «atrás» no hace nada en vez de sacar de la app.
 * Se llama una sola vez al arrancar la app. Devuelve la función que lo apaga.
 */
export function activarCapasAutomaticas(selector = '.modal-overlay'): () => void {
  if (typeof window === 'undefined' || typeof MutationObserver === 'undefined') return () => {};
  const activas = new Map<Element, { quitar: (conservarEntrada?: boolean) => void }>();
  let programado = false;

  const visible = (el: Element) => {
    if (!el.isConnected) return false;
    const e = getComputedStyle(el);
    return e.display !== 'none' && e.visibility !== 'hidden';
  };

  const cerrarElemento = (el: Element) => {
    const boton =
      el.querySelector<HTMLElement>('.modal-close-btn, [data-cerrar-atras], [aria-label="Cerrar"]') ??
      Array.from(el.querySelectorAll<HTMLElement>('button')).find((b) => /^(cancelar|cerrar|volver|salir)/i.test(b.textContent?.trim() ?? ''));
    (boton ?? (el as HTMLElement)).click();
  };

  const revisar = () => {
    programado = false;
    const visibles = new Set(Array.from(document.querySelectorAll(selector)).filter(visible));
    const nuevas = Array.from(visibles).filter((el) => !activas.has(el));
    for (const [el, reg] of Array.from(activas)) {
      if (visibles.has(el)) continue;
      // Si en este mismo instante aparece otra ventana (React cambió de elemento), la entrada se reutiliza.
      reg.quitar(nuevas.length > 0);
      activas.delete(el);
    }
    for (const el of nuevas) {
      const reg = abrirCapa(() => {
        cerrarElemento(el);
        // La ventana no se cerró (guardando, o no se deja): se vuelve a registrar para que «atrás» no salga de la app.
        setTimeout(() => {
          if (el.isConnected && visible(el)) {
            activas.delete(el);
            agendar();
          }
        }, 200);
      });
      activas.set(el, reg);
    }
  };
  function agendar() {
    if (programado) return;
    programado = true;
    setTimeout(revisar, 30);
  }

  const observador = new MutationObserver(agendar);
  observador.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
  agendar();
  return () => observador.disconnect();
}
