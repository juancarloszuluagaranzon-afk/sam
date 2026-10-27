import type { Role } from '../domain/sam'

/**
 * Grupos de usuarios para los botones de filtro de Más → Usuarios (Ola 1 de la reunión con ASM, 26-oct-2026):
 * operativos, dueños de finca, propietarios y administrativos, más «Soporte» porque son usuarios que no caben en
 * ninguno de esos cuatro. Todo rol cae en UN grupo: así los números de los botones suman el total.
 */
export type CategoriaUsuario = 'OPERATIVOS' | 'DUENOS' | 'PROPIETARIOS' | 'ADMIN' | 'SOPORTE'

export const CATEGORIAS_USUARIO: Array<{ clave: CategoriaUsuario; etiqueta: string }> = [
  { clave: 'OPERATIVOS', etiqueta: 'Operativos' },
  { clave: 'DUENOS', etiqueta: 'Dueños de finca' },
  { clave: 'PROPIETARIOS', etiqueta: 'Propietarios' },
  { clave: 'ADMIN', etiqueta: 'Administrativos' },
  { clave: 'SOPORTE', etiqueta: 'Soporte' },
]

const ROLES: Record<Role, CategoriaUsuario> = {
  operador: 'OPERATIVOS', supervisor: 'OPERATIVOS', supervisor_insumos: 'OPERATIVOS', conductor: 'OPERATIVOS',
  conductor_madera: 'OPERATIVOS', analista_insumos: 'OPERATIVOS', taller: 'OPERATIVOS', quiosco_taller: 'OPERATIVOS',
  dueno_finca: 'DUENOS',
  propietario: 'PROPIETARIOS',
  owner: 'ADMIN', administracion: 'ADMIN',
  soporte: 'SOPORTE',
}

/** Grupo de un rol. Un rol desconocido (uno nuevo que nadie agregó aquí) cae en operativos: no desaparece de la lista. */
export function categoriaDeRol(rol: string | null | undefined): CategoriaUsuario {
  return ROLES[rol as Role] ?? 'OPERATIVOS'
}

/** Cuántos usuarios hay en cada grupo y en total (el número de cada botón). */
export function contarPorCategoria(usuarios: Array<{ role?: string | null }>): Record<CategoriaUsuario | 'TODOS', number> {
  const out: Record<CategoriaUsuario | 'TODOS', number> = { TODOS: 0, OPERATIVOS: 0, DUENOS: 0, PROPIETARIOS: 0, ADMIN: 0, SOPORTE: 0 }
  for (const u of usuarios) {
    out.TODOS += 1
    out[categoriaDeRol(u.role)] += 1
  }
  return out
}
