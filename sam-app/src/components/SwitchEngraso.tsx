/**
 * "¿Engrasó la máquina?" — dos botones, sí o no.
 *
 * Va en la entrega porque el engrase se hace justo cuando el supervisor llega
 * a la máquina. Preguntarlo después es garantizar que nadie se acuerde.
 *
 * Arranca sin elegir a propósito: si viniera en "NO" por defecto, un descuido
 * quedaría registrado como que no se engrasó, y eso es peor que un dato vacío.
 * Es opcional — nadie se queda sin entregar por esto.
 */
export function SwitchEngraso({
  value,
  onChange,
  disabled,
}: {
  value: boolean | undefined
  onChange: (v: boolean | undefined) => void
  disabled?: boolean
}) {
  return (
    <div className="engraso">
      <span className="engraso__lbl">
        🛢️ ¿Engrasó la máquina? <span className="field-optional">(opcional)</span>
      </span>
      <div className="engraso__btns">
        <button
          type="button"
          className={`engraso__btn${value === true ? ' is-si' : ''}`}
          onClick={() => onChange(value === true ? undefined : true)}
          disabled={disabled}
          aria-pressed={value === true}
        >
          ✔ SÍ
        </button>
        <button
          type="button"
          className={`engraso__btn${value === false ? ' is-no' : ''}`}
          onClick={() => onChange(value === false ? undefined : false)}
          disabled={disabled}
          aria-pressed={value === false}
        >
          ✖ NO
        </button>
      </div>
    </div>
  )
}

export default SwitchEngraso
