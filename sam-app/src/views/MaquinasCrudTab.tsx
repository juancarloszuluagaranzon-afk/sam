import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useAppData } from '../context/AppDataContext'
import { Ayuda } from '../components/Ayuda'
import { useEquipmentForm } from '../hooks/useEquipmentForm'
import { loadEquipmentTodos } from '../services/samApi'

/**
 * El maestro de máquinas: crear, editar, apagar y borrar.
 *
 * **Por qué existe aparte de la pantalla del dueño.** La de `SupervisorView` es
 * operativa — muestra qué máquina está laborando, con quién y cuántas hectáreas
 * lleva hoy. Esta es el maestro: la ficha y nada más. Son dos preguntas
 * distintas y mezclarlas en una sola pantalla no le sirve bien a ninguna.
 *
 * 🔴 **La lógica NO está duplicada.** Las dos usan `useEquipmentForm`, así que
 * las reglas que importan —el código no se edita, borrar es desactivar cuando
 * hay historial— viven en un solo sitio. Si algún día se agrega un campo, se
 * agrega una vez.
 */
export function MaquinasCrudTab() {
  const { busy } = useAppData()
  const {
    equipmentForm, updateEquipmentForm, isEquipmentFormOpen,
    handleCreateEquipment, editando, nuevaMaquina, cerrarFormulario,
    editarMaquina, cambiarActivo, borrarMaquina,
  } = useEquipmentForm()

  const [todas, setTodas] = useState<Array<{ code: string; name: string; plate?: string; active: boolean }>>([])
  const [cargando, setCargando] = useState(true)
  const [busca, setBusca] = useState('')

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const lista = await loadEquipmentTodos()
      setTodas(lista.map((e) => ({ code: e.code, name: e.name, plate: e.plate, active: e.active })))
    } finally { setCargando(false) }
  }, [])
  useEffect(() => { void cargar() }, [cargar])

  // Se recarga cuando el formulario se cierra: es la señal de que algo se guardó.
  useEffect(() => { if (!isEquipmentFormOpen) void cargar() }, [isEquipmentFormOpen, cargar])

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return todas
    return todas.filter((m) => `${m.code} ${m.name} ${m.plate ?? ''}`.toLowerCase().includes(q))
  }, [todas, busca])

  async function guardar(e: FormEvent<HTMLFormElement>) {
    await handleCreateEquipment(e)
    await cargar()
  }

  return (
    <section className="panel-card">
      <div className="panel-title split">
        <h2>Máquinas</h2>
        <button type="button" className="primary-button"
                onClick={() => (isEquipmentFormOpen ? cerrarFormulario() : nuevaMaquina())} disabled={busy}>
          {isEquipmentFormOpen ? (editando ? `Editando ${editando}` : 'Cerrar') : '+ Nueva máquina'}
        </button>
      </div>

      <Ayuda>
        <p>
          Aquí se dan de alta los tractores, implementos y vehículos. Lo que se cree acá
          aparece de una vez en los selectores de labores, insumos y taller.
        </p>
        <p>
          <strong>El código no se puede cambiar</strong> después de creado: es con lo que la
          nombran las labores, el kardex y los cierres de horómetro. Y{' '}
          <strong>eliminar solo se puede si nunca se usó</strong> — si ya tiene historial se
          desactiva, que la saca de los selectores sin perder nada.
        </p>
      </Ayuda>

      {isEquipmentFormOpen && (
        <form className="form-grid-block" style={{ marginTop: '1rem' }} onSubmit={(e) => void guardar(e)}>
          <div className="form-grid">
            <label>
              Código {editando && <span className="field-optional">(no se puede cambiar)</span>}
              <input value={equipmentForm.code} disabled={!!editando}
                     onChange={(e) => updateEquipmentForm('code', e.target.value)} />
            </label>
            <label>Nombre
              <input value={equipmentForm.name}
                     onChange={(e) => updateEquipmentForm('name', e.target.value)} />
            </label>
            <label>Tipo
              <select value={equipmentForm.type}
                      onChange={(e) => updateEquipmentForm('type', e.target.value as typeof equipmentForm.type)}>
                <option value="tractor">Tractor</option>
                <option value="implemento">Implemento</option>
                <option value="vehiculo">Vehículo</option>
                <option value="otro">Otro</option>
              </select>
            </label>
            <label>Estado
              <select value={equipmentForm.state}
                      onChange={(e) => updateEquipmentForm('state', e.target.value as typeof equipmentForm.state)}>
                <option value="activo">Activo</option>
                <option value="en_mantenimiento">En mantenimiento</option>
                <option value="inactivo">Inactivo</option>
              </select>
            </label>
            <label>Marca
              <input value={equipmentForm.brand} onChange={(e) => updateEquipmentForm('brand', e.target.value)} />
            </label>
            <label>Modelo
              <input value={equipmentForm.model} onChange={(e) => updateEquipmentForm('model', e.target.value)} />
            </label>
            <label>Año
              <input value={equipmentForm.year} placeholder="2024"
                     onChange={(e) => updateEquipmentForm('year', e.target.value)} />
            </label>
            <label>Placa <span className="field-optional">(solo vehículos)</span>
              <input value={equipmentForm.plate} onChange={(e) => updateEquipmentForm('plate', e.target.value)} />
            </label>
          </div>
          <label style={{ display: 'block', marginTop: 8 }}>Observaciones
            <textarea rows={2} value={equipmentForm.notes}
                      onChange={(e) => updateEquipmentForm('notes', e.target.value)} />
          </label>
          <div className="modal-footer">
            <button type="button" className="inline-button" onClick={cerrarFormulario} disabled={busy}>Cancelar</button>
            <button type="submit" className="primary-button" disabled={busy}>
              {busy ? 'Guardando…' : editando ? 'Guardar cambios' : 'Crear máquina'}
            </button>
          </div>
        </form>
      )}

      <input type="search" className="labores-search-input" placeholder="Buscar código, nombre o placa…"
             value={busca} onChange={(e) => setBusca(e.target.value)} style={{ margin: '12px 0' }} />

      {cargando && <p className="muted-text">Cargando máquinas…</p>}
      {!cargando && lista.length === 0 && <p className="muted-text">Ninguna máquina coincide.</p>}

      <div className="list-rows">
        {lista.map((m) => (
          <article key={m.code} className={`maquina-fila${m.active ? '' : ' maquina-fila--apagada'}`}>
            <div className="maquina-fila__datos">
              <strong>{m.name}</strong>
              <span className="field-optional">
                {m.code}{m.plate ? ` · ${m.plate}` : ''}
                {!m.active && ' · desactivada'}
              </span>
            </div>
            <div className="maquina-fila__acts">
              <button type="button" className="inline-button" disabled={busy}
                      onClick={() => void editarMaquina(m.code)}>&#9998; Editar</button>
              {m.active ? (
                <button type="button" className="inline-button" disabled={busy}
                        title="Deja de aparecer en los selectores. No pierde su historial."
                        onClick={() => void cambiarActivo(m.code, false).then(cargar)}>Desactivar</button>
              ) : (
                <button type="button" className="inline-button" disabled={busy}
                        onClick={() => void cambiarActivo(m.code, true).then(cargar)}>Activar</button>
              )}
              <button type="button" className="inline-button maestro-delete-btn" disabled={busy}
                      title="Solo si la máquina nunca se usó"
                      onClick={() => void borrarMaquina(m.code, m.name).then(cargar)}>Eliminar</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

export default MaquinasCrudTab
