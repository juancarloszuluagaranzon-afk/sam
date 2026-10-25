import { useCallback, useEffect, useState } from 'react'
import { useAppData } from '../../context/AppDataContext'
import { Ayuda } from '../../components/Ayuda'
import { CamaraRostro, type ResultadoCamara } from '../../components/CamaraRostro'
import { fmtFechaHora } from '../../lib/fechas'
import { aMayus } from '../../lib/texto'
import { iniciales, proximoTipo } from '../../lib/quiosco'
import { loadConsentimiento } from '../../services/asistenciaApi'
import type { Consentimiento } from '../../services/asistenciaApi'
import { loadAppUsers } from '../../services/samApi'
import {
  crearMecanico,
  crearUsuarioQuiosco,
  enrolarPorJefe,
  guardarFicha,
  loadPersonalTaller,
  loadUsuarioQuiosco,
  retirarMecanico,
} from '../../services/tallerPersonalApi'
import type { Mecanico } from '../../services/tallerPersonalApi'

const CARGOS = ['MECÁNICO', 'SOLDADOR', 'AYUDANTE', 'ELECTRICISTA', 'LLANTERO', 'LUBRICADOR']

/** Una persona, con lo mínimo que necesitan los modales de autorización y cámara. */
interface Persona {
  id: string
  nombre: string
}

/** Cómo está hoy la persona, en palabras que entiende el jefe. */
function estadoDe(p: Mecanico): string {
  if (!p.ultima) return 'nunca ha marcado'
  const proxima = proximoTipo(p.ultima)
  if (proxima.tipo === 'SALIDA') return `adentro desde ${fmtFechaHora(p.ultima.marcadoEn)}`
  if (proxima.olvidoSalida) return '⚠ no marcó la salida'
  return 'afuera'
}

/** El chip de la cara: lo que el jefe necesita saber de un vistazo. */
function chipCara(p: Mecanico): { texto: string; tipo: string } {
  if (p.rostro?.estado === 'APROBADO') return { texto: 'Cara ✓', tipo: 'ok' }
  if (p.rostro?.estado === 'PENDIENTE') return { texto: 'Cara por aprobar', tipo: 'pend' }
  return { texto: 'Sin cara', tipo: 'no' }
}

/** El estado de la cara dentro del detalle, con lo que hay que hacer. */
function estadoCara(p: Mecanico): string {
  if (p.rostro?.estado === 'APROBADO') return 'Cara aprobada: ya puede marcar en el quiosco.'
  if (p.rostro?.estado === 'PENDIENTE') return 'Cara registrada, pendiente de aprobación.'
  if (p.rostro?.estado === 'RECHAZADO') return 'El registro anterior fue rechazado. Regístrela de nuevo.'
  return 'Sin cara registrada: mientras tanto marca con su PIN.'
}

/**
 * Los rechazos del servidor traen «CODIGO: explicación»: se muestra la explicación.
 * La misma traducción que usa MiJornadaTab, para que el jefe vea el mismo idioma.
 */
function mensajeServidor(e: unknown): string {
  const m = (e as { message?: string })?.message ?? ''
  const conocido = /(ROSTRO_DUPLICADO|MUESTRAS_IDENTICAS|MUESTRAS_DISPERSAS|FOTO_INVALIDA|CONSENTIMIENTO_DESACTUALIZADO|SIN_CONSENTIMIENTO):\s*(.*)$/.exec(m)
  if (conocido) return `⚠ ${conocido[2]}`
  if (!navigator.onLine || m.includes('fetch') || m.includes('network') || m.includes('load failed')) {
    return 'Para esto hace falta señal. Intente cuando tenga conexión.'
  }
  return m || 'No se pudo guardar. Intente otra vez.'
}

/**
 * Personal del taller — la pantalla del jefe.
 *
 * 🔴 Antes cada mecánico se registraba solo en su celular y nadie lo hizo: cero
 * caras en la base. Aquí el jefe da de alta a cada persona y le registra la cara
 * EN PERSONA, después de que leyó y aceptó la autorización. La cara que registra
 * el jefe queda aprobada de una, porque él la vio.
 *
 * 🔴 Retirar a alguien borra su cara (Ley 1581: terminada la finalidad, se
 * suprime) pero conserva sus horas: lo trabajado se pagó y se sigue pudiendo
 * auditar.
 */
export function PersonalTallerTab() {
  const { session, setUsers, setError, setInfo } = useAppData()
  const quien = session?.id ?? ''

  const [personal, setPersonal] = useState<Mecanico[]>([])
  const [cargando, setCargando] = useState(true)
  const [ocupado, setOcupado] = useState('')

  /** Alta de una persona. */
  const [creando, setCreando] = useState(false)
  const [form, setForm] = useState({ nombre: '', cedula: '', cargo: '', telefono: '' })
  const [creado, setCreado] = useState<{ id: string; nombre: string; pin: string } | null>(null)

  /** Detalle de una persona. Se guarda el id y se deriva de la lista para que
   *  después de recargar se vea el dato nuevo, no el viejo. */
  const [detalleId, setDetalleId] = useState<string | null>(null)
  const [ficha, setFicha] = useState({ cargo: '', telefono: '' })

  /** Autorización de datos biométricos y cámara. */
  const [autorizacion, setAutorizacion] = useState<{ texto: Consentimiento; persona: Persona } | null>(null)
  const [acepta, setAcepta] = useState(false)
  const [versionAceptada, setVersionAceptada] = useState('')
  const [camaraPara, setCamaraPara] = useState<Persona | null>(null)

  /** La tableta de la entrada. */
  const [quiosco, setQuiosco] = useState<{ id: string; nombre: string } | null>(null)
  const [quioscoNuevo, setQuioscoNuevo] = useState<{ id: string; pin: string } | null>(null)
  const [quioscoCargando, setQuioscoCargando] = useState(true)

  const detalle = personal.find((p) => p.id === detalleId) ?? null

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      setPersonal(await loadPersonalTaller())
    } catch {
      // Se queda la lista que ya está en pantalla y se avisa: nunca una blanca.
      setError('No se pudo cargar el personal. Revise la señal e intente otra vez.')
    } finally {
      setCargando(false)
    }
  }, [setError])

  const cargarQuiosco = useCallback(async () => {
    setQuioscoCargando(true)
    try {
      setQuiosco(await loadUsuarioQuiosco())
    } catch {
      setQuiosco(null)
    } finally {
      setQuioscoCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
    void cargarQuiosco()
  }, [cargar, cargarQuiosco])

  // Al abrir el detalle se copia la ficha a los campos editables.
  useEffect(() => {
    if (!detalle) return
    setFicha({ cargo: detalle.cargo ?? '', telefono: detalle.telefono ?? '' })
  }, [detalle])

  /** Después de crear o retirar a alguien, la lista global de usuarios queda vieja. */
  async function refrescarUsuarios() {
    const r = await loadAppUsers()
    setUsers(r.data)
  }

  async function crear() {
    if (!form.nombre.trim() || !form.cedula.trim()) {
      setError('Escriba el nombre completo y la cédula.')
      return
    }
    setOcupado('Creando…')
    try {
      const r = await crearMecanico({
        nombre: aMayus(form.nombre.trim()),
        cedula: form.cedula.trim(),
        ...(form.cargo.trim() ? { cargo: aMayus(form.cargo.trim()) } : {}),
        ...(form.telefono.trim() ? { telefono: form.telefono.trim() } : {}),
      }, quien)
      setCreando(false)
      setForm({ nombre: '', cedula: '', cargo: '', telefono: '' })
      setCreado({ id: r.mecanico.id, nombre: r.mecanico.nombre, pin: r.pin })
      await cargar()
      await refrescarUsuarios()
    } catch (e) {
      setError(mensajeServidor(e))
    } finally {
      setOcupado('')
    }
  }

  async function guardar() {
    if (!detalle) return
    setOcupado('Guardando la ficha…')
    try {
      await guardarFicha(detalle.id, {
        ...(ficha.cargo.trim() ? { cargo: aMayus(ficha.cargo.trim()) } : {}),
        ...(ficha.telefono.trim() ? { telefono: ficha.telefono.trim() } : {}),
      }, quien)
      setInfo('Ficha guardada.')
      await cargar()
    } catch (e) {
      setError(mensajeServidor(e))
    } finally {
      setOcupado('')
    }
  }

  async function retirar() {
    if (!detalle) return
    if (!window.confirm(`¿Retirar a ${detalle.nombre} del taller? Se borra su cara (Ley 1581) y ya no podrá marcar. Sus horas pasadas se conservan.`)) return
    setOcupado('Retirando…')
    try {
      await retirarMecanico(detalle.id, quien)
      setDetalleId(null)
      setInfo(`${detalle.nombre} ya no está en el taller. Su cara se borró; sus horas se conservan.`)
      await cargar()
      await refrescarUsuarios()
    } catch (e) {
      setError(mensajeServidor(e))
    } finally {
      setOcupado('')
    }
  }

  async function abrirAutorizacion(persona: Persona) {
    setOcupado('Cargando la autorización…')
    try {
      const texto = await loadConsentimiento()
      setAcepta(false)
      setAutorizacion({ texto, persona })
    } catch {
      setError('Para registrar la cara hace falta señal. Intente cuando tenga conexión.')
    } finally {
      setOcupado('')
    }
  }

  async function guardarCara(r: ResultadoCamara) {
    const persona = camaraPara
    if (!persona) return
    setCamaraPara(null)
    setOcupado('Guardando la cara…')
    try {
      const estado = await enrolarPorJefe({ usuarioId: persona.id, toma: r, version: versionAceptada }, quien)
      setInfo(estado === 'APROBADO'
        ? `Cara de ${persona.nombre} registrada y aprobada. Ya puede marcar en el quiosco.`
        : `Cara de ${persona.nombre} registrada. Queda por aprobar.`)
      await cargar()
    } catch (e) {
      setError(mensajeServidor(e))
    } finally {
      setOcupado('')
    }
  }

  async function crearQuiosco() {
    setOcupado('Creando el usuario del quiosco…')
    try {
      const r = await crearUsuarioQuiosco(quien)
      setQuioscoNuevo(r)
      setQuiosco({ id: r.id, nombre: 'QUIOSCO DEL TALLER' })
      setInfo('Usuario del quiosco creado.')
      await refrescarUsuarios()
    } catch (e) {
      setError(mensajeServidor(e))
    } finally {
      setOcupado('')
    }
  }

  return (
    <section className="panel-card mov taller-personal">
      <div className="panel-title split">
        <div className="taller-personal__cab">
          <h2>Personal del taller</h2>
          <span className="taller-personal__chip">{personal.length} activos</span>
        </div>
        <Ayuda>
          <p>
            Aquí da de alta a cada persona del taller y le registra la cara en persona. Con la cara registrada, la
            persona marca su entrada y salida en el quiosco de la entrada (o en su celular, si quiere). La cara que
            usted registra queda aprobada de una, porque usted la vio. Quien no autorice su cara marca con su PIN:
            esas marcaciones las revisa usted en Asistencia.
          </p>
        </Ayuda>
      </div>

      <button
        type="button"
        className="primary-button taller-personal__agregar"
        onClick={() => setCreando(true)}
        disabled={!!ocupado}
      >
        + Agregar mecánico
      </button>
      {ocupado && <p className="muted-text">{ocupado}</p>}

      {cargando ? (
        <p className="muted-text">Cargando el personal…</p>
      ) : personal.length === 0 ? (
        <p className="dash-vacio">Todavía no hay personal del taller. Agregue al primero con «+ Agregar mecánico».</p>
      ) : (
        <ul className="taller-personal__lista">
          {personal.map((p) => {
            const chip = chipCara(p)
            return (
              <li key={p.id}>
                <button type="button" className="taller-personal__fila" onClick={() => setDetalleId(p.id)}>
                  {p.rostro?.foto
                    ? <img src={p.rostro.foto} alt={`Cara de ${p.nombre}`} className="taller-personal__foto" />
                    : <span className="taller-personal__avatar" aria-hidden>{iniciales(p.nombre)}</span>}
                  <span className="taller-personal__txt">
                    <strong>{p.nombre}</strong>
                    <small>{p.cargo || 'Sin cargo'} · {estadoDe(p)}</small>
                  </span>
                  <span className={`taller-personal__cara taller-personal__cara--${chip.tipo}`}>{chip.texto}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {/* La tableta de la entrada: se crea una sola vez y se entra con su PIN. */}
      <div className="flota-comprobante taller-personal__quiosco">
        <span className="flota-comprobante__lbl">🖥️ Quiosco del taller</span>
        {quioscoCargando ? (
          <p className="subtle-copy">Cargando…</p>
        ) : quioscoNuevo ? (
          <p>
            En la tableta, abra agroserviciosmorales.vercel.app y entre con el usuario <strong>{quioscoNuevo.id}</strong> y
            el PIN <strong>{quioscoNuevo.pin}</strong>. Anótelo: no se vuelve a mostrar.
          </p>
        ) : quiosco ? (
          <p>
            La tableta de la entrada entra con el usuario <strong>{quiosco.id}</strong>. Si se olvidó el PIN, cámbielo
            en Más → Usuarios.
          </p>
        ) : (
          <>
            <p className="subtle-copy">Una tableta fija en la entrada donde todos marcan con la cara.</p>
            <button type="button" className="primary-button" onClick={() => void crearQuiosco()} disabled={!!ocupado}>
              Crear el usuario del quiosco
            </button>
          </>
        )}
      </div>

      {/* ── Alta de una persona ─────────────────────────────────────────────── */}
      {creando && (
        <div className="modal-overlay open" onClick={() => setCreando(false)}>
          <div className="modal-card taller-personal__modal" onClick={(e) => e.stopPropagation()}>
            <div className="labor-detail-header">
              <div>
                <p className="eyebrow">Personal del taller</p>
                <h3>Agregar mecánico</h3>
              </div>
              <button type="button" className="modal-close-btn" onClick={() => setCreando(false)} aria-label="Cerrar">✕</button>
            </div>
            <div className="flota-grid">
              <label>
                Nombre completo *
                <input
                  type="text"
                  value={form.nombre}
                  autoCapitalize="characters"
                  onChange={(e) => setForm({ ...form, nombre: aMayus(e.target.value) })}
                />
              </label>
              <label>
                Cédula *
                <input
                  type="text"
                  inputMode="numeric"
                  value={form.cedula}
                  onChange={(e) => setForm({ ...form, cedula: e.target.value.replace(/\D/g, '') })}
                />
              </label>
              <label>
                Cargo
                <input
                  type="text"
                  list="taller-cargos-nuevo"
                  value={form.cargo}
                  autoCapitalize="characters"
                  onChange={(e) => setForm({ ...form, cargo: aMayus(e.target.value) })}
                />
                <datalist id="taller-cargos-nuevo">
                  {CARGOS.map((c) => <option key={c} value={c} />)}
                </datalist>
              </label>
              <label>
                Teléfono
                <input
                  type="tel"
                  inputMode="tel"
                  value={form.telefono}
                  onChange={(e) => setForm({ ...form, telefono: e.target.value })}
                />
              </label>
            </div>
            <div className="rostro-camara__acciones">
              <button type="button" className="primary-button" onClick={() => void crear()} disabled={!!ocupado}>
                Crear
              </button>
              <button type="button" className="inline-button" onClick={() => setCreando(false)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* ── El usuario y el PIN, que se muestran UNA sola vez ───────────────── */}
      {creado && (
        <div className="modal-overlay open" onClick={() => setCreado(null)}>
          <div className="modal-card taller-personal__modal" onClick={(e) => e.stopPropagation()}>
            <div className="labor-detail-header">
              <div>
                <p className="eyebrow">Personal del taller</p>
                <h3>Persona creada</h3>
              </div>
              <button type="button" className="modal-close-btn" onClick={() => setCreado(null)} aria-label="Cerrar">✕</button>
            </div>
            <p>
              ✓ <strong>{creado.nombre}</strong> quedó creado. Entréguele su usuario <strong>{creado.id}</strong> y su
              PIN <strong>{creado.pin}</strong>. El PIN no se vuelve a mostrar.
            </p>
            <div className="rostro-camara__acciones">
              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  const persona = { id: creado.id, nombre: creado.nombre }
                  setCreado(null)
                  setDetalleId(persona.id)
                  void abrirAutorizacion(persona)
                }}
              >
                Registrar su cara ahora
              </button>
              <button type="button" className="inline-button" onClick={() => setCreado(null)}>Listo</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Detalle de la persona ───────────────────────────────────────────── */}
      {detalle && !autorizacion && !camaraPara && (
        <div className="modal-overlay open" onClick={() => setDetalleId(null)}>
          <div className="modal-card taller-personal__modal" onClick={(e) => e.stopPropagation()}>
            <div className="labor-detail-header">
              <div>
                <p className="eyebrow">Personal del taller</p>
                <h3>{detalle.nombre}</h3>
              </div>
              <button type="button" className="modal-close-btn" onClick={() => setDetalleId(null)} aria-label="Cerrar">✕</button>
            </div>

            <div className="taller-personal__detalle">
              {detalle.rostro?.foto
                ? <img src={detalle.rostro.foto} alt={`Cara de ${detalle.nombre}`} className="taller-personal__foto taller-personal__foto--grande" />
                : <span className="taller-personal__avatar taller-personal__avatar--grande" aria-hidden>{iniciales(detalle.nombre)}</span>}
              <div className="taller-personal__datos">
                <p>Cédula: <strong>{detalle.cedula || '—'}</strong></p>
                <p>Usuario: <strong>{detalle.id}</strong></p>
              </div>
            </div>

            <div className="flota-grid">
              <label>
                Cargo
                <input
                  type="text"
                  list="taller-cargos-ficha"
                  value={ficha.cargo}
                  autoCapitalize="characters"
                  onChange={(e) => setFicha({ ...ficha, cargo: aMayus(e.target.value) })}
                />
                <datalist id="taller-cargos-ficha">
                  {CARGOS.map((c) => <option key={c} value={c} />)}
                </datalist>
              </label>
              <label>
                Teléfono
                <input
                  type="tel"
                  inputMode="tel"
                  value={ficha.telefono}
                  onChange={(e) => setFicha({ ...ficha, telefono: e.target.value })}
                />
              </label>
            </div>
            <button type="button" className="primary-button" onClick={() => void guardar()} disabled={!!ocupado}>
              Guardar ficha
            </button>

            <div className="taller-personal__cara-caja">
              <span className="flota-comprobante__lbl">📷 Cara</span>
              <p className="subtle-copy">{estadoCara(detalle)}</p>
              <button
                type="button"
                className="inline-button"
                onClick={() => void abrirAutorizacion({ id: detalle.id, nombre: detalle.nombre })}
                disabled={!!ocupado}
              >
                {detalle.rostro ? 'Registrar de nuevo' : '📷 Registrar su cara'}
              </button>
            </div>

            <button
              type="button"
              className="inline-button taller-personal__retirar"
              onClick={() => void retirar()}
              disabled={!!ocupado}
            >
              Retirar del taller
            </button>
          </div>
        </div>
      )}

      {/* ── Autorización de datos biométricos (Ley 1581 de 2012) ─────────────── */}
      {autorizacion && (
        <div className="modal-overlay open" onClick={() => setAutorizacion(null)}>
          <div className="modal-card taller-personal__modal" onClick={(e) => e.stopPropagation()}>
            <div className="labor-detail-header">
              <div>
                <p className="eyebrow">Antes de registrar la cara</p>
                <h3>Autorización de datos biométricos</h3>
              </div>
              <button type="button" className="modal-close-btn" onClick={() => setAutorizacion(null)} aria-label="Cerrar">✕</button>
            </div>
            <p className="subtle-copy">
              Léale esta autorización a {autorizacion.persona.nombre} o désela para que la lea. Solo si la acepta, continúe.
            </p>
            {/* El texto lo entrega el servidor y es el que queda guardado con la cara. */}
            <div className="rostro-consentimiento">
              <p><strong>{autorizacion.texto.titulo}</strong></p>
              {autorizacion.texto.parrafos.map((p, i) => <p key={i}>{p}</p>)}
            </div>
            <label className="taller-personal__acepta">
              <input type="checkbox" checked={acepta} onChange={(e) => setAcepta(e.target.checked)} />
              <span>{autorizacion.persona.nombre} leyó (o se le leyó) la autorización y la acepta</span>
            </label>
            <div className="rostro-camara__acciones">
              <button
                type="button"
                className="primary-button"
                disabled={!acepta}
                onClick={() => {
                  setVersionAceptada(autorizacion.texto.version)
                  const persona = autorizacion.persona
                  setAutorizacion(null)
                  setCamaraPara(persona)
                }}
              >
                Acepta: tomar la foto
              </button>
              <button
                type="button"
                className="inline-button"
                onClick={() => {
                  setAutorizacion(null)
                  setInfo('Sin autorización no se registra la cara. Puede marcar con su PIN en el quiosco; esas marcaciones las revisa usted.')
                }}
              >
                No acepta
              </button>
            </div>
          </div>
        </div>
      )}

      {camaraPara && (
        <CamaraRostro modo="registrar" onListo={(r) => void guardarCara(r)} onCancelar={() => setCamaraPara(null)} />
      )}
    </section>
  )
}

export default PersonalTallerTab
