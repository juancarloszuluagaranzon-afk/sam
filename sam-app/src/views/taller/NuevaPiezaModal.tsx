import { useEffect, useRef, useState } from 'react'
import { prepararFotoPieza, type FotoPiezaLista } from '../../lib/fotoPieza'
import { guardarPiezaTaller, type NuevaPieza } from '../../services/piezasApi'
import { loadFamilias, type Familia } from '../../services/tallerApi'
import { CampoLista, recordarValor } from '../../components/CampoPlaca'
import { SearchableSelect } from '../../components/SearchableSelect'
import { aMayus } from '../../lib/texto'

/**
 * Alta rápida de una pieza del taller (26-oct-2026).
 *
 * El que llega con una pieza nueva en la mano está de pie frente al estante, no
 * sentado en la oficina: por eso lo primero es la foto, después el nombre, el
 * estante y cuántas hay, y todo lo demás queda plegado en «Más datos».
 *
 * «Guardar y siguiente» es el botón principal porque casi siempre se registran
 * varias piezas del mismo cajón: conserva el estante y la familia y deja el cursor
 * en el nombre.
 *
 * 🔴 Sin señal NO se pierde nada: `guardarPiezaTaller` deja la pieza en la cola del
 * celular y la sube sola. El aviso azul del pie lo dice, porque el miedo a perder
 * lo escrito es lo que hace que la gente no registre en campo.
 */

interface Props {
  /** Bodega del taller donde queda la existencia (`useTaller().bodegaTaller.id`). */
  bodegaId: string
  /** Quién la registra. Va a `creadoPor`. */
  usuarioId?: string
  onClose: () => void
  /** Se llama después de CADA guardado (para que la lista se recargue). `enviado` false = quedó en cola sin señal. */
  onGuardada: (enviado: boolean) => void
}

type Errores = { nombre?: string; estante?: string; cantidad?: string; foto?: string; general?: string }

/** Solo dígitos y separadores: en un campo numérico no debe entrar nada más. */
const soloNumero = (v: string) => v.replace(/[^0-9.,]/g, '')
/**
 * El id lo pone el celular: así reintentar el guardado no crea una pieza gemela. `randomUUID` exige
 * Chrome 92+ y conexión segura; en un celular viejo se arma uno válido (v4) con `getRandomValues`.
 */
function nuevoId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/** El mismo número que se teclea, con coma o con punto. */
const aNumero = (v: string) => Number(v.replace(',', '.'))

export function NuevaPiezaModal({ bodegaId, usuarioId, onClose, onGuardada }: Props) {
  const [nombre, setNombre] = useState('')
  const [ubicacion, setUbicacion] = useState('')
  const [cantidad, setCantidad] = useState('')
  const [familia, setFamilia] = useState('')
  const [marca, setMarca] = useState('')
  const [parte, setParte] = useState('')
  const [referencia, setReferencia] = useState('')
  const [stockMinimo, setStockMinimo] = useState('')

  const [foto, setFoto] = useState<FotoPiezaLista | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [preparandoFoto, setPreparandoFoto] = useState(false)
  const [guardando, setGuardando] = useState(false)

  const [errores, setErrores] = useState<Errores>({})
  const [ultima, setUltima] = useState<{ nombre: string; enviado: boolean } | null>(null)
  const [guardadas, setGuardadas] = useState(0)

  const [familias, setFamilias] = useState<Familia[]>([])
  const inputFoto = useRef<HTMLInputElement>(null)
  const nombreRef = useRef<HTMLInputElement>(null)

  useEffect(() => { void loadFamilias().then(setFamilias) }, [])

  // Vista previa del DETALLE ya comprimido (no del archivo original, que pesa MB): la miniatura de 200 px
  // estirada al ancho del celular se vería pixelada y parecería que la foto salió mal. La URL del blob se
  // revoca al cambiar de foto y al desmontar: si no, el celular se queda con la foto en memoria toda la sesión.
  useEffect(() => {
    if (!foto) { setPreview(null); return }
    const url = URL.createObjectURL(foto.full)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [foto])

  async function tomarFoto(file: File) {
    setErrores((e) => ({ ...e, foto: undefined }))
    setPreparandoFoto(true)
    try {
      setFoto(await prepararFotoPieza(file))
    } catch (err) {
      setErrores((e) => ({
        ...e,
        foto: (err as { message?: string })?.message || 'No se pudo leer la foto. Tómala otra vez.',
      }))
    } finally { setPreparandoFoto(false) }
  }

  function validar(): boolean {
    const e: Errores = {}
    if (!nombre.trim()) e.nombre = 'Escribe el nombre'
    if (!ubicacion.trim()) e.estante = 'Escribe el estante'
    const n = aNumero(cantidad)
    if (cantidad.trim() === '' || !Number.isFinite(n) || n < 0) e.cantidad = 'Escribe cuántas hay'
    setErrores(e)
    return Object.keys(e).length === 0
  }

  async function guardar(seguir: boolean) {
    if (guardando) return
    if (!validar()) return
    setGuardando(true)
    const nombreLimpio = aMayus(nombre.trim())
    const min = stockMinimo.trim() ? aNumero(stockMinimo) : NaN
    const pieza: NuevaPieza = {
      id: nuevoId(),
      nombre: nombreLimpio,
      ubicacion: aMayus(ubicacion.trim()),
      cantidad: aNumero(cantidad),
      bodegaId,
      familia: familia || undefined,
      marca: marca.trim() ? aMayus(marca.trim()) : undefined,
      numeroParte: parte.trim() ? aMayus(parte.trim()) : undefined,
      referencia: referencia.trim() ? aMayus(referencia.trim()) : undefined,
      stockMinimo: Number.isFinite(min) && min >= 0 ? min : undefined,
      creadoPor: usuarioId,
    }
    try {
      const { enviado } = await guardarPiezaTaller(pieza, foto ?? undefined)
      // El estante queda sugerido la próxima vez: casi siempre se repite.
      recordarValor('UBICACION', pieza.ubicacion)
      onGuardada(enviado)
      if (!seguir) { onClose(); return }
      setUltima({ nombre: nombreLimpio, enviado })
      setGuardadas((n) => n + 1)
      // Se conservan ESTANTE y FAMILIA; se borra lo propio de esta pieza.
      setNombre('')
      setCantidad('')
      setFoto(null)
      setMarca('')
      setParte('')
      setReferencia('')
      setStockMinimo('')
      setErrores({})
      setTimeout(() => nombreRef.current?.focus(), 0)
    } catch (err) {
      setErrores((e) => ({
        ...e,
        general: (err as { message?: string })?.message || 'No se pudo guardar. Inténtalo otra vez.',
      }))
    } finally { setGuardando(false) }
  }

  return (
    <div className="modal-overlay open" onClick={() => { if (!guardando) onClose() }}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="labor-detail-header">
          <div><p className="eyebrow">Taller</p><h3>Nueva pieza</h3></div>
          <button type="button" className="modal-close-btn" onClick={onClose} disabled={guardando}>
            &#x2715;
          </button>
        </div>

        {ultima && (
          <div className="pieza-ok" role="status">
            <strong>
              {ultima.enviado
                ? `Guardada: ${ultima.nombre}`
                : `Guardada sin señal: ${ultima.nombre}. Sube sola cuando haya señal.`}
            </strong>
            <span>Guardadas ahora: {guardadas}</span>
          </div>
        )}

        {/* (a) Foto primero: es lo único que no se puede reconstruir después. */}
        {foto && preview ? (
          <div className="pieza-foto-vista">
            <img src={preview} alt="Foto de la pieza" />
            <div className="pieza-foto-acciones">
              <button type="button" className="inline-button" disabled={guardando || preparandoFoto}
                onClick={() => inputFoto.current?.click()}>
                {preparandoFoto ? 'Preparando foto…' : 'Cambiar foto'}
              </button>
              <button type="button" className="inline-button" disabled={guardando}
                onClick={() => setFoto(null)}>
                Quitar
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="pieza-foto" disabled={guardando || preparandoFoto}
            onClick={() => inputFoto.current?.click()}>
            <span>{preparandoFoto ? 'Preparando foto…' : '📷 Tomar foto de la pieza'}</span>
            <small>Opcional</small>
          </button>
        )}
        {errores.foto && <p className="pieza-error">{errores.foto}</p>}
        <input
          ref={inputFoto}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            // Se limpia para que elegir la MISMA foto otra vez también dispare el cambio.
            e.target.value = ''
            if (file) void tomarFoto(file)
          }}
        />

        {/* (b) Nombre: se guarda en MAYÚSCULA, como todo lo que se digita. */}
        <label className="pieza-campo">
          <span>Nombre <span className="pieza-oblig">*</span></span>
          <input
            ref={nombreRef}
            type="text"
            value={nombre}
            placeholder="RODAMIENTO 30206"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            disabled={guardando}
            onChange={(e) => { setNombre(aMayus(e.target.value)); setErrores((er) => ({ ...er, nombre: undefined })) }}
          />
          {errores.nombre && <span className="pieza-error">{errores.nombre}</span>}
        </label>

        {/* (c) Estante: sugiere lo que ya se escribió en este equipo, sin obligar. */}
        <label className="pieza-campo">
          <span>Estante <span className="pieza-oblig">*</span></span>
          <CampoLista
            tipo="UBICACION"
            value={ubicacion}
            onChange={(v) => { setUbicacion(v); setErrores((er) => ({ ...er, estante: undefined })) }}
            placeholder="ESTANTE A-3"
            disabled={guardando}
          />
          {errores.estante && <span className="pieza-error">{errores.estante}</span>}
        </label>

        {/* (d) Cantidad: 0 es un dato válido (la pieza está en el catálogo y falta comprarla). */}
        <label className="pieza-campo">
          <span>Cantidad que hay <span className="pieza-oblig">*</span></span>
          <input
            type="text"
            inputMode="decimal"
            value={cantidad}
            placeholder="0"
            disabled={guardando}
            onChange={(e) => { setCantidad(soloNumero(e.target.value)); setErrores((er) => ({ ...er, cantidad: undefined })) }}
          />
          {errores.cantidad && <span className="pieza-error">{errores.cantidad}</span>}
        </label>

        {/* (e) Lo que solo se llena si se tiene a mano. */}
        <details className="pieza-mas">
          <summary>Más datos (opcional)</summary>
          <div className="pieza-mas__cuerpo">
            <label className="pieza-campo">
              <span>Familia</span>
              <SearchableSelect
                value={familia}
                onChange={setFamilia}
                options={familias.map((f) => ({ value: f.codigo, label: `${f.codigo} · ${f.nombre}` }))}
                placeholder="Buscar familia…"
                disabled={guardando}
              />
            </label>
            <div className="flota-grid">
              <label>Marca
                <input type="text" value={marca} placeholder="SKF" autoCapitalize="characters"
                  disabled={guardando} onChange={(e) => setMarca(aMayus(e.target.value))} />
              </label>
              <label>N° de parte
                <input type="text" value={parte} placeholder="6206-2RS" autoCapitalize="characters"
                  disabled={guardando} onChange={(e) => setParte(aMayus(e.target.value))} />
              </label>
              <label>Referencia del fabricante
                <input type="text" value={referencia} autoCapitalize="characters"
                  disabled={guardando} onChange={(e) => setReferencia(aMayus(e.target.value))} />
              </label>
              <label>Stock mínimo
                <input type="text" inputMode="decimal" value={stockMinimo} placeholder="0"
                  disabled={guardando} onChange={(e) => setStockMinimo(soloNumero(e.target.value))} />
              </label>
            </div>
            <p className="pieza-ayuda">Con familia y sin código propio, el sistema le pone el consecutivo.</p>
          </div>
        </details>

        {/* (f) El miedo a perder lo escrito es lo que deja de registrar en campo. */}
        <p className="pieza-nota">Sin señal no pasa nada: queda en el celular y sube sola.</p>

        {errores.general && <p className="pieza-error">{errores.general}</p>}

        <div className="modal-footer pieza-pie">
          {/* Sin «Cancelar»: la ✕ de arriba y el botón «atrás» del celular ya cierran, y tres botones apilados
              se comían media pantalla del celular. */}
          <button type="button" className="inline-button" onClick={() => void guardar(false)} disabled={guardando}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
          <button type="button" className="primary-button" onClick={() => void guardar(true)} disabled={guardando}>
            {guardando ? 'Guardando…' : 'Guardar y siguiente'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default NuevaPiezaModal
