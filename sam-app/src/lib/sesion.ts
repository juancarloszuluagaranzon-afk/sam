// Token de sesión de la app (Fase 2 del endurecimiento, 22-oct-2026).
// Se obtiene al entrar (`app_login_token`) y se envía en las acciones que validan
// rol (facturar, acuerdos). El servidor deriva de él la identidad real, en vez de
// confiar en el id que manda el cliente. Si no hay token (usuario que entró antes
// de esta versión, o impersonación de soporte), las funciones caen al `p_usuario`
// de antes: por eso nada se rompe.
const KEY = 'sam-app-token-v1'
// Debe COINCIDIR con SUPPORT_ORIGIN_KEY de App.tsx (soporte impersonando).
const SUPPORT_ORIGIN_KEY = 'sam:support-origin'

let token: string | null = (() => {
  try { return window.localStorage.getItem(KEY) } catch { return null }
})()

export function setToken(t: string | null) {
  token = t
  try {
    if (t) window.localStorage.setItem(KEY, t)
    else window.localStorage.removeItem(KEY)
  } catch { /* sin almacenamiento */ }
}

/** El token real guardado (para cerrarlo en el logout), sin importar impersonación. */
export function getTokenReal(): string | null {
  return token
}

/**
 * El token para las RPC que validan rol. Durante la impersonación de soporte se
 * suspende (devuelve null): así esas acciones vuelven al comportamiento de antes
 * (se atribuyen y se validan con el usuario impersonado, como hoy).
 */
export function getToken(): string | null {
  try { if (window.localStorage.getItem(SUPPORT_ORIGIN_KEY)) return null } catch { /* sin almacenamiento */ }
  return token
}
