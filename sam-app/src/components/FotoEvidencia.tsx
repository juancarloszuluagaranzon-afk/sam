import { useEffect, useState } from 'react'
import { db } from '../lib/db'
import { esFotoLocal } from '../lib/outboxInsumos'

/**
 * Una foto de evidencia, esté ya en el servidor o todavía en el equipo.
 *
 * **Por qué existe.** Sin señal la foto SÍ se guardaba y SÍ se subía al
 * reconectar, pero en pantalla salía un cuadrito gris que decía "sin subir": el
 * supervisor no podía ver lo que acababa de tomar. Y una foto que no se puede
 * mirar no sirve como evidencia — si salió movida, tapada o de la máquina
 * equivocada, uno se entera al día siguiente cuando ya no se puede repetir.
 *
 * La foto local vive como blob en Dexie. Se muestra con `URL.createObjectURL`,
 * que arma una dirección temporal en memoria — por eso hay que revocarla al
 * desmontar o el navegador se va llenando de blobs que nadie libera.
 */
export function FotoEvidencia({
  url,
  alt = 'evidencia',
  tam = 56,
}: {
  url: string
  alt?: string
  /** Lado del cuadrito, en píxeles. */
  tam?: number
}) {
  const local = esFotoLocal(url)
  const [src, setSrc] = useState<string>(local ? '' : url)
  const [falta, setFalta] = useState(false)

  useEffect(() => {
    if (!local) { setSrc(url); return }
    let vivo = true
    let objectUrl = ''
    void (async () => {
      const localId = url.slice('local://'.length)
      const foto = await db.fotos.get(localId)
      if (!vivo) return
      if (!foto?.blob) { setFalta(true); return }
      objectUrl = URL.createObjectURL(foto.blob)
      setSrc(objectUrl)
    })()
    return () => {
      vivo = false
      // Sin esto el navegador retiene el blob completo por cada foto abierta.
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [url, local])

  // El blob ya se subió y se borró de Dexie, pero la pantalla todavía tiene el
  // marcador viejo. No es un error: se resuelve al recargar.
  if (local && falta) {
    return (
      <span className="foto-pendiente" title="Ya se subió. Recarga para verla.">
        📷 subida
      </span>
    )
  }

  if (!src) {
    return <span className="foto-evid foto-evid--cargando" style={{ width: tam, height: tam }} />
  }

  const img = (
    <img
      src={src}
      alt={alt}
      className="foto-evid__img"
      style={{ width: tam, height: tam }}
    />
  )

  // La que ya está en el servidor se abre en pestaña aparte para verla grande.
  // La local no tiene URL pública, así que solo se muestra.
  return (
    <span className={`foto-evid${local ? ' foto-evid--local' : ''}`}>
      {local ? img : <a href={url} target="_blank" rel="noreferrer">{img}</a>}
      {local && <span className="foto-evid__chip" title="Guardada en el equipo. Se sube sola cuando haya señal.">⏳</span>}
    </span>
  )
}

export default FotoEvidencia
