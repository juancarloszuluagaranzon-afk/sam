import type { Insumo } from '../domain/sam'

/**
 * Carga de piezas del taller desde Excel y detección de piezas PARECIDAS (26-oct-2026).
 *
 * Por qué existe: el almacén tiene más de 500 piezas y las van a cargar varias personas. Sin revisar antes
 * de guardar, la misma pieza entra dos o tres veces con el nombre escrito distinto («RODAMIENTO 30206»,
 * «RODAMIENTO DE RUEDA 30206 »). Todo el análisis es puro (sin red ni pantalla) para poder probarlo con Node.
 *
 * Reglas fijas:
 *  - Lo que se digita va en MAYÚSCULA (la regla de la casa) y sin espacios sobrantes.
 *  - Solo son OBLIGATORIOS nombre, estante y cantidad. Todo lo demás es opcional.
 *  - Una fila PARECIDA a una pieza que ya existe, o repetida dentro del mismo archivo, NO se crea: se
 *    marca y se deja afuera (la persona decide). Una fila con ERROR tampoco se crea.
 *  - Nunca se inventa un dato: un número que no se entiende es un error, no un cero.
 */

/** Una fila cruda del Excel: todo en texto, tal como la escribió la persona. `fila` es el número de fila del archivo. */
export interface FilaPieza {
  fila: number
  nombre: string
  ubicacion: string
  cantidad: string
  familia?: string
  marca?: string
  numeroParte?: string
  referencia?: string
  stockMinimo?: string
}

/** La pieza ya limpia y con su uuid (el mismo `NuevaPieza` de `piezasApi` sin la bodega ni quién la carga). */
export interface PiezaCarga {
  id: string
  nombre: string
  ubicacion: string
  cantidad: number
  familia?: string
  marca?: string
  numeroParte?: string
  referencia?: string
  stockMinimo?: number
}

export type EstadoFila = 'lista' | 'parecida' | 'error'

export interface FilaAnalizada {
  fila: number
  estado: EstadoFila
  /** Frase corta en español para mostrar: «Falta el estante», «Ya existe ROD-0005 con el mismo N° de parte». */
  motivo?: string
  /** Solo en `lista`: la pieza lista para guardar. */
  pieza?: PiezaCarga
  /** Solo en `parecida`: a qué pieza existente (o a qué fila anterior del archivo) se parece. */
  parecidaA?: { id?: string; nombre: string; codigo?: string; ubicacion?: string; filaArchivo?: number }
  /** La fila tal como vino, para poder bajar «las que no pasaron» a un Excel corregible. */
  original: FilaPieza
}

export interface Analisis {
  filas: FilaAnalizada[]
  listas: number
  parecidas: number
  errores: number
}

/**
 * Texto comparable: MAYÚSCULA, sin tildes, signos convertidos en espacio y espacios colapsados.
 * «Rodamiento 30206-2RS» → «RODAMIENTO 30206 2RS». Devuelve '' si no queda nada.
 */
export function normalizarTexto(s: string): string {
  void s
  throw new Error('no implementado')
}

/**
 * Número tecleado a mano → número. Acepta «14», «14,5», «14.5» y miles con punto «1.200» (o «1.200,5»).
 * Devuelve null si no es un número (vacío, letras, negativo no se acepta aquí: lo decide quien llama).
 */
export function aNumeroCarga(s: string): number | null {
  void s
  throw new Error('no implementado')
}

/** Campos que se reconocen en el encabezado del Excel. */
export type CampoCarga = 'nombre' | 'ubicacion' | 'cantidad' | 'familia' | 'marca' | 'numeroParte' | 'referencia' | 'stockMinimo'

/**
 * Qué columna del Excel es cada campo, leyendo los encabezados con `normalizarTexto` y sinónimos:
 * nombre ← NOMBRE | DESCRIPCION | PIEZA | REPUESTO; ubicacion ← ESTANTE | UBICACION | LUGAR;
 * cantidad ← CANTIDAD | EXISTENCIA | STOCK | CANT; familia ← FAMILIA | CATEGORIA;
 * marca ← MARCA; numeroParte ← N DE PARTE | NUMERO DE PARTE | NO DE PARTE | PARTE | N PARTE;
 * referencia ← REFERENCIA | REF; stockMinimo ← MINIMO | STOCK MINIMO | MIN.
 * `indice` solo trae los campos encontrados (posición en el arreglo de encabezados); `faltan` lista, en español y
 * en orden, los OBLIGATORIOS que no aparecen («nombre», «estante», «cantidad»).
 */
export function mapearColumnas(encabezados: string[]): { indice: Partial<Record<CampoCarga, number>>; faltan: string[] } {
  void encabezados
  throw new Error('no implementado')
}

/**
 * Piezas existentes parecidas a lo que se está escribiendo, la más parecida primero, hasta `max` (3 por defecto).
 * Es lo que alimenta el aviso «Ya hay piezas parecidas» del alta rápida y la revisión de la carga masiva.
 * Parecida si CUALQUIERA de estas es cierta (todas sobre `normalizarTexto`):
 *  1. mismo N° de parte (sin espacios) que el N° de parte, el código o la referencia de la existente (solo si no está vacío);
 *  2. el mismo nombre;
 *  3. el nombre más corto tiene 2 o más palabras de 2+ caracteres y TODAS están en el más largo
 *     («FILTRO ACEITE» ~ «FILTRO DE ACEITE MOTOR»; una sola palabra («RODAMIENTO») NO alcanza).
 * Orden: por N° de parte, luego por nombre igual, luego por contención. Solo se consideran piezas activas.
 */
export function buscarParecidas(nombre: string, numeroParte: string, existentes: Insumo[], max = 3): Insumo[] {
  void nombre; void numeroParte; void existentes; void max
  throw new Error('no implementado')
}

/**
 * Analiza las filas del Excel contra lo que ya existe. Por cada fila, en este orden:
 *  - ERROR si falta el nombre («Falta el nombre»), el estante («Falta el estante») o la cantidad («Falta la cantidad»),
 *    si la cantidad no es un número o es negativa («La cantidad no es un número»), o si el mínimo viene escrito y no es número.
 *  - PARECIDA si se parece a una existente (`buscarParecidas`, motivo «Ya existe CODIGO o NOMBRE …» diciendo por qué)
 *    o a una fila LISTA anterior del mismo archivo (motivo «Repetida: igual a la fila N»).
 *  - LISTA en los demás casos, con la pieza limpia (MAYÚSCULA, número ya convertido) y un id de `nuevoId()`.
 * Las filas completamente vacías (todo en blanco) se ignoran y no cuentan. Conserva el orden del archivo.
 */
export function analizarFilas(filas: FilaPieza[], existentes: Insumo[], nuevoId: () => string): Analisis {
  void filas; void existentes; void nuevoId
  throw new Error('no implementado')
}

/**
 * Lee el primer libro de un archivo .xlsx/.xls/.csv (con `import('xlsx')` dinámico, como `FacturacionTab`) y arma
 * las `FilaPieza` con `mapearColumnas` sobre la primera fila con datos. Celdas vacías → ''. `fila` = número real de
 * la fila en el Excel (la 1 es el encabezado). Si faltan columnas obligatorias NO lanza: devuelve `faltan` y las filas
 * vacías. Si el archivo no se puede leer lanza un Error en español («No se pudo leer el archivo. ¿Es un Excel?»).
 */
export async function leerArchivoPiezas(file: File): Promise<{ filas: FilaPieza[]; faltan: string[] }> {
  void file
  throw new Error('no implementado')
}

/** Baja al equipo la plantilla `plantilla-piezas-taller.xlsx`: encabezados exactos y 2 filas de ejemplo (que digan EJEMPLO). */
export async function descargarPlantillaPiezas(): Promise<void> {
  throw new Error('no implementado')
}

/**
 * Baja `piezas-que-no-pasaron.xlsx`: las filas `parecida` y `error` con sus datos originales y una columna final
 * «Motivo», para que la persona las corrija en el Excel y las vuelva a subir.
 */
export async function descargarNoPasaron(analisis: Analisis): Promise<void> {
  void analisis
  throw new Error('no implementado')
}
