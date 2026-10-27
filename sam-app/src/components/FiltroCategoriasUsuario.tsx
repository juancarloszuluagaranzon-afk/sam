import { CATEGORIAS_USUARIO, contarPorCategoria, type CategoriaUsuario } from '../lib/categoriasUsuario'
import '../views/olaReunion.css'

export function FiltroCategoriasUsuario({ usuarios, valor, onChange }: {
  usuarios: Array<{ role?: string | null }>
  valor: CategoriaUsuario | 'TODOS'
  onChange: (valor: CategoriaUsuario | 'TODOS') => void
}) {
  const conteo = contarPorCategoria(usuarios)
  const opciones = [{ clave: 'TODOS' as const, etiqueta: 'Todos' }, ...CATEGORIAS_USUARIO]
  return <div className="ola-filtros" aria-label="Filtrar usuarios por categoría">
    {opciones.filter((o) => conteo[o.clave] > 0 || valor === o.clave).map((o) => (
      <button key={o.clave} type="button" className={`ola-chip${valor === o.clave ? ' is-activo' : ''}`}
        aria-pressed={valor === o.clave}
        onClick={(e) => { onChange(o.clave); e.currentTarget.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }) }}>
        {o.etiqueta} {conteo[o.clave]}
      </button>
    ))}
  </div>
}
