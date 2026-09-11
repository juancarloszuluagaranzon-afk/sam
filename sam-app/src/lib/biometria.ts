/**
 * La huella del propio celular, para marcar entrada y salida.
 *
 * 🔴 **Lo que esto SÍ prueba y lo que NO.** El teléfono solo completa la
 * operación si su dueño pasa el lector; la huella nunca sale del aparato ni el
 * sistema operativo la entrega, así que aquí no se guarda ninguna huella, solo
 * el identificador público de la credencial. Eso ata la marcación a *ese*
 * teléfono y a quien lo desbloquea.
 *
 * ⚠️ Lo que NO prueba, y hay que decirlo: la firma que devuelve el
 * autenticador **no se verifica en el servidor todavía**. Un técnico con la
 * consola del navegador abierta podría saltarse el lector. Para eso está el
 * resto del cerco: la marcación queda atada a un `credencial_id` registrado, la
 * hora la acota el servidor, la ubicación se guarda y el reporte muestra lo que
 * se marcó fuera del taller. Cuando haga falta cerrar esa puerta del todo, el
 * camino es verificar la firma en una función de borde, y por eso se guarda la
 * llave pública desde ahora.
 *
 * 🔴 **Y en una tablet compartida esto NO sirve.** El lector del aparato no
 * distingue a una persona de otra: cualquier huella registrada en ese teléfono
 * desbloquea cualquier credencial que viva ahí. Solo tiene sentido en el
 * celular personal de cada quien. Si algún día se pone un punto fijo en el
 * taller, la prueba tiene que ser otra (foto del rostro, o un lector
 * multiusuario de verdad).
 */

const RP_NOMBRE = 'AgroMorales · Taller'

function aBase64Url(buf: ArrayBuffer): string {
  const b = String.fromCharCode(...new Uint8Array(buf))
  return btoa(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function deBase64Url(s: string): ArrayBuffer {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  // Se devuelve el ArrayBuffer y no la vista: el tipo `BufferSource` del DOM
  // ya no acepta `Uint8Array<ArrayBufferLike>` y el build falla.
  return Uint8Array.from(b, (c) => c.charCodeAt(0)).buffer
}

/** ¿Este aparato tiene lector y el navegador lo expone? */
export async function hayHuella(): Promise<boolean> {
  try {
    if (!window.PublicKeyCredential) return false
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
  } catch {
    return false
  }
}

/** Un nombre corto del aparato, para que la persona reconozca cuál registró. */
export function apodoDelAparato(): string {
  const ua = navigator.userAgent
  const m = ua.match(/\((?:Linux; )?(?:Android [\d.]+; )?([^;)]+)/)
  const modelo = m?.[1]?.trim()
  if (modelo && modelo.length < 40 && !/^X11|^Windows|^Macintosh/.test(modelo)) return modelo
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua)) return 'iPad'
  if (/Android/.test(ua)) return 'Android'
  return 'Este equipo'
}

/**
 * Registra la huella de este celular para una persona.
 *
 * `userVerification: 'required'` es lo que obliga al lector: sin eso el
 * navegador puede resolverlo solo con que el aparato esté desbloqueado, y
 * entonces no hay huella que valga.
 */
export async function registrarHuella(
  usuarioId: string,
  nombre: string,
): Promise<{ credencialId: string; llavePublica: string | null }> {
  const reto = crypto.getRandomValues(new Uint8Array(32))
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: reto,
      rp: { name: RP_NOMBRE },
      user: {
        // El id del usuario de la app, en bytes. No es dato sensible.
        id: new TextEncoder().encode(usuarioId),
        name: usuarioId,
        displayName: nombre,
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },   // ES256, lo normal en Android e iOS
        { type: 'public-key', alg: -257 }, // RS256, respaldo
      ],
      authenticatorSelection: {
        // El lector del propio aparato, no una llave USB.
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred',
      },
      timeout: 60000,
      attestation: 'none',
    },
  })) as PublicKeyCredential | null
  if (!cred) throw new Error('El aparato no entregó la credencial.')
  const resp = cred.response as AuthenticatorAttestationResponse
  let llavePublica: string | null = null
  try {
    const pk = resp.getPublicKey?.()
    if (pk) llavePublica = aBase64Url(pk)
  } catch {
    // Sin llave pública el registro igual sirve hoy; solo cierra la puerta a
    // verificar la firma más adelante. No es motivo para fallar la marcación.
  }
  return { credencialId: cred.id, llavePublica }
}

/**
 * Pide la huella y devuelve cuál de las credenciales registradas se usó.
 *
 * Se le pasan las credenciales de ESA persona: si el teléfono no tiene
 * ninguna, el navegador avisa y la pantalla ofrece registrar la huella.
 */
export async function verificarHuella(credencialIds: string[]): Promise<string> {
  const reto = crypto.getRandomValues(new Uint8Array(32))
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: reto,
      allowCredentials: credencialIds.map((id) => ({
        type: 'public-key' as const,
        id: deBase64Url(id),
      })),
      userVerification: 'required',
      timeout: 60000,
    },
  })) as PublicKeyCredential | null
  if (!cred) throw new Error('No se pudo leer la huella.')
  return cred.id
}

/** Traduce los errores del navegador a algo que se entienda en el taller. */
export function mensajeDeError(e: unknown): string {
  const nombre = (e as { name?: string })?.name ?? ''
  if (nombre === 'NotAllowedError') return 'Se canceló la huella o se acabó el tiempo. Intenta otra vez.'
  if (nombre === 'InvalidStateError') return 'Esta huella ya está registrada en este teléfono.'
  if (nombre === 'SecurityError') return 'El navegador bloqueó la huella. Abre la app desde el enlace normal, no dentro de otra aplicación.'
  if (nombre === 'NotSupportedError') return 'Este teléfono no ofrece lector de huella al navegador.'
  const msg = (e as { message?: string })?.message
  return msg ? `No se pudo: ${msg}` : 'No se pudo leer la huella.'
}

/**
 * La ubicación, con paciencia y sin bloquear.
 *
 * 🔴 Nunca se exige. Bajo un techo de zinc el GPS puede no fijar en un minuto,
 * y dejar a alguien sin marcar su entrada porque el satélite no aparece es
 * convertir un control en un problema de nómina. Si no llega, se marca igual y
 * la fila queda sin ubicación, que es un hecho y se ve en el reporte.
 */
export function ubicacion(timeoutMs = 8000): Promise<{ lat: number; lng: number; precision: number } | null> {
  return new Promise((res) => {
    if (!navigator.geolocation) return res(null)
    navigator.geolocation.getCurrentPosition(
      (p) => res({ lat: p.coords.latitude, lng: p.coords.longitude, precision: p.coords.accuracy }),
      () => res(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30000 },
    )
  })
}
