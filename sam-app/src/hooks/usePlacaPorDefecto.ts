import { useAppData } from '../context/AppDataContext'

/**
 * La placa que se le propone al conductor, sacada de la máquina que tiene
 * asignada.
 *
 * Se **propone, no se impone**: el campo sigue siendo editable porque un día le
 * puede tocar otro carro y no vamos a bloquearle el registro por eso.
 *
 * Vive aquí y no dentro de un formulario porque ahora hay DOS —el CDA-F-68 de
 * IMECOL y el F-OPE-22 de AgroMorales— y esta regla tiene tres caminos que se
 * descubrieron uno por uno. Duplicarla es garantizar que mañana solo se arregle
 * en uno de los dos.
 */
export function usePlacaPorDefecto(): string {
  const { session, equipment, users } = useAppData()

  // 1. La maquina asignada al usuario, si la sesion la trae.
  const codigo = session?.equipmentCode
  if (codigo) {
    const eq = equipment.find((e) => e.code === codigo)
    if (eq) return eq.plate || eq.code
  }
  // 2. Si no, la maquina que la BASE dice que tiene asignada.
  //
  //    Hace falta porque `equipmentCode` se guarda en la sesion AL ENTRAR: si a
  //    alguien le asignan la camioneta hoy, su sesion abierta sigue sin ella
  //    hasta que vuelva a entrar — y en campo nadie cierra sesion. `users` si se
  //    recarga en cada arranque, asi que ahi el dato esta fresco.
  const yo = users.find((u) => u.id === session?.id)
  if (yo?.equipmentCode) {
    const eq = equipment.find((e) => e.code === yo.equipmentCode)
    if (eq) return eq.plate || eq.code
    return yo.equipmentCode
  }
  // 3. Y si tampoco, el unico vehiculo de la flota. Con dos o mas se deja en
  //    blanco y que elija: proponerle el carro equivocado es peor que nada.
  const vehiculos = equipment.filter((e) => e.type === 'vehiculo')
  if (vehiculos.length === 1) return vehiculos[0].plate || vehiculos[0].code
  return ''
}
