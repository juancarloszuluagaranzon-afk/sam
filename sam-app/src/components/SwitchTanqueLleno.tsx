import './olaReunion.css'

export function SwitchTanqueLleno({ lleno, onChange, disabled = false }: {
  lleno: boolean
  onChange: (lleno: boolean) => void
  disabled?: boolean
}) {
  return <button type="button" role="switch" aria-checked={!lleno} disabled={disabled}
    className={`ola-tanque-switch${!lleno ? ' is-incompleto' : ''}`} onClick={() => onChange(!lleno)}>
    <span className="ola-tanque-switch__punto" aria-hidden="true" />
    <span><strong>No quedó lleno</strong><small>Actívalo si el tanque no se llenó del todo</small></span>
  </button>
}
