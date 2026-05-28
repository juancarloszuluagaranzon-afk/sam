# SAM Control — Resumen de mejoras

**Período:** 24 al 28 de mayo de 2026
**Aplicación:** SAM Control (AgroMorales) — Sistema de Asignación Móvil
**Usuarios beneficiados:** 30 operarios de campo, supervisores, gerencia
**Versión actual en producción:** `b716a44` ([agroserviciosmorales.vercel.app](https://agroserviciosmorales.vercel.app))

---

## Visión general

En esta iteración se cerraron **cuatro frentes operativos clave** que el equipo de campo había venido reportando como cuellos de botella:

1. **Visibilidad en condiciones de luz solar y nocturna** (tema oscuro)
2. **Continuidad del trabajo cuando una labor no se termina en un día** (estado parcial)
3. **Trabajo colaborativo entre tractores en la misma suerte** (avance compartido en tiempo real)
4. **Prevención de duplicaciones administrativas** que generaban confusión y doble reporte

El resultado es una aplicación que se siente más **fiel a cómo el equipo trabaja realmente en el campo**, en lugar de obligar al operario a forzar su flujo dentro del software.

---

## 1. Tema claro y oscuro con un toque

**Qué hace:** Un botón circular en la barra verde superior permite al operario alternar entre tema claro (para uso bajo el sol) y tema oscuro (para uso en cabina al atardecer o de noche).

**Para qué sirve:**
- **Reduce fatiga visual** en jornadas largas
- **Ahorra batería** en celulares con pantalla OLED durante uso nocturno
- **Mejora legibilidad** según condición lumínica del entorno

**Detalles:**
- La preferencia se guarda por dispositivo — al volver a abrir, mantiene la última elección
- La primera vez respeta el modo del sistema operativo del celular
- Sin parpadeo al cargar (carga directa en el tema correcto)

---

## 2. Labores parciales: el trabajo no se pierde

### Problema operacional resuelto

Antes, cuando un operario terminaba el día con una labor incompleta (ej: 5 ha de las 14 planificadas), el sistema marcaba la labor como **"Completada"** con avance parcial. Resultado:

- La labor **desaparecía de "Activas"** del operario
- Para continuarla al día siguiente, el supervisor tenía que **crear una nueva asignación con el área restante**
- En la práctica, **se duplicaba el trabajo administrativo** y se perdía continuidad

### Solución implementada

Se introdujo el **estado "Parcial"** como un estado real en el sistema:

| Estado | Significado |
|---|---|
| **Pendiente** | Aún no se ha iniciado |
| **Laborando** | El operario está actualmente trabajando |
| **Parcial** ⭐ | Terminada parcialmente — sigue activa para continuar |
| **Completada** | Terminada al 100% |
| **Cancelada** | Anulada |

**Comportamiento:**
- Una labor con área ejecutada < área planificada queda **automáticamente como Parcial** (ya no se confunde con Completada)
- Sigue apareciendo en la pestaña **"Activas"** del operario para que continúe al día siguiente
- También aparece en el **"Historial"** con su avance — el operario ve cuánto lleva del mes
- Cuando se completa al 100%, pasa a **Completada** definitiva

### Lo que ve el operario

```
SAN MIGUEL - 020
DESPEJE Prog. - 14.51 ha · 5.00 realizadas · Falta 9.51 ha   [Parcial]
```

Al tocar la card:
- Banner ámbar: *"Continuando labor parcial — Acumulado previo: 5.00 ha de 14.51 ha. Faltan 9.51 ha."*
- El campo de área ya viene pre-llenado con **lo que falta** (9.51), así el operario solo confirma si hizo todo o ajusta si hizo menos
- El cambio de "Ha ejecutadas" → "Ha ejecutadas en esta sesión" deja claro que es lo de hoy, no el total

---

## 3. Trabajo colaborativo: dos tractores, una suerte ⭐

### Problema operacional resuelto

En AgroMorales es común que el supervisor envíe **dos tractores con dos operarios** a la misma suerte para acelerar una labor grande. Se dividen el trabajo en campo. Antes:

- Cada operario veía su asignación independiente con el área completa de la suerte (ej: 10 ha cada uno)
- Cuando uno terminaba la mitad, el otro **no se enteraba**
- Existía el riesgo de **doble reporte** del mismo trabajo
- Si la comunicación por radio fallaba, el segundo operario podría intentar trabajar área ya cubierta

### Solución implementada

**Sincronización en tiempo real entre dispositivos** + visibilidad del trabajo conjunto:

| Momento | Operario A | Operario B |
|---|---|---|
| Inicio del día | DESPEJE 10 ha · Pendiente | DESPEJE 10 ha · Pendiente |
| OP-A reporta 5 ha (parcial) | Su labor: 5 hechas · Falta 5 · Parcial | **En segundos**: su labor pasa de Pendiente a **Parcial** con *"5.00 realizadas · Falta 5.00"* — sin recargar |
| OP-B abre el detalle | — | Banner: *"Labor compartida con otro operario. Otro operario ya realizó 5.00 ha. Faltan 5.00 ha."* |
| OP-B reporta sus 5 ha | Su labor se actualiza: 10 realizadas, suerte cerrada | Su labor: Completada |

**Garantías del sistema:**
- El total de área reportada **nunca puede exceder el área planificada** de la suerte (cap automático). Si OP-B intenta reportar 7 cuando ya hay 5 hechas, el sistema bloquea con mensaje claro.
- Cuando entre los dos cubren el área total, **ambas asignaciones cierran como Completada** (la suerte está cerrada por trabajo conjunto).
- La sincronización **funciona vía conexión a internet en tiempo real**. Sin conexión, los cambios se encolan offline y se sincronizan al recuperar señal (capacidad existente desde antes).

---

## 4. Validaciones contra duplicaciones

Se cerraron **tres rutas** donde el sistema permitía crear asignaciones duplicadas activas, que generaban confusión:

| Ruta | Antes | Ahora |
|---|---|---|
| Supervisor asignando | Podía asignar la misma labor en la misma suerte al mismo operario dos veces, creando dos tarjetas idénticas | Bloquea con mensaje claro y sugiere reasignar desde el modal de Labores |
| Operario tomando en campo | Podía "Tomar suerte en campo" una labor que ya tenía activa | Mensaje: *"Ya tienes una labor X activa en suerte Y. Continúala desde 'Activas'."* |
| Supervisor reasignando | Podía mover una labor a un operario que ya tenía la misma activa | Mensaje: *"Ese operario ya tiene una asignación activa en esa suerte. Reasigna o cancela esa antes."* |

**Lo que sí está permitido** (decisión consciente): asignar la misma labor en la misma suerte a **operarios distintos** — eso es exactamente el caso colaborativo de la mejora #3.

---

## 5. Supervisor: reasignar operario con un clic

Antes, cuando un operario se ausentaba o cambiaba de equipo, el supervisor tenía que **cancelar la asignación y crear una nueva** para el reemplazo. Ahora:

1. Supervisor → pestaña **Labores** → toca la card de la labor
2. Botón **Editar** → aparece selector **"Operador (reasignar)"** con buscador
3. Selecciona el nuevo operario → **Guardar cambios**

Si la labor tenía avance parcial (ej: 5 ha hechas), el área ya ejecutada se conserva: el operario que recibe la labor la ve como **Parcial** desde su inicio con el banner *"El operario anterior ya realizó X ha"*.

---

## 6. Dictado por voz: feedback claro al operario

El botón de micrófono (que existe en horómetros, área ejecutada y notas) ahora:

- **Aparece siempre visible** — antes desaparecía sin explicación si el navegador no era compatible. Ahora aparece deshabilitado con un mensaje claro.
- **Traduce los errores del dispositivo a mensajes en español accionables**:
  - *"Permiso de micrófono denegado. Habilítalo desde el navegador (icono junto a la URL)."*
  - *"No se detectó un micrófono. Conecta o habilita el micrófono del dispositivo."*
  - *"Sin red para el dictado. Necesitas conexión a Internet."*
  - *"Tu navegador no soporta dictado por voz. Usa Chrome o Edge."*

Antes, el botón parecía no responder y el operario asumía "ya no funciona" sin pista de la causa real.

---

## 7. Calidad visual y consistencia

- **Bottom sheet de finalizar labor**: se solucionó un problema de superposición de campos ("Ha ejecutadas" y "Horómetro final" se solapaban) en pantallas medianas
- **Contraste mejorado** en pills de estado (Pendiente / Parcial / Completada / Cancelada): colores semafóricos visibles tanto en tema claro como oscuro
- **Toggle de tema** reubicado en la barra verde del header para acceso de un toque

---

## 📊 Impacto esperado

| Frente | Beneficio operacional |
|---|---|
| Estado Parcial | Elimina re-creación manual de asignaciones para labores en curso. Estimado: **15-20 min/día ahorrados** por supervisor en gestión administrativa |
| Avance compartido | Reduce riesgo de doble reporte y de doble pase del tractor sobre área ya trabajada. Mejora la calidad del dato consolidado |
| Validación de duplicados | Cero tarjetas duplicadas en "Activas" del operario — claridad operacional |
| Tema oscuro | Menor fatiga visual en jornadas largas; mejor uso de batería |
| Dictado con mensajes claros | El operario sabe qué hacer cuando algo falla en vez de asumir error de la app |

---

## 🔧 Infraestructura y robustez

Todas las mejoras se desplegaron sin interrumpir el servicio:

- **9 commits** verdes, con build automático en Vercel
- **1 migración SQL** aplicada en VPS sin downtime
- **Hook pre-push** automatizado bloquea código roto antes de llegar a producción
- **Sincronización Realtime** funciona sobre la infraestructura Supabase self-host existente
- **Compatibilidad total** con asignaciones históricas (filas creadas antes de las mejoras siguen funcionando)

---

## 📲 Para los operarios

Las actualizaciones **llegan automáticamente** a la PWA y al APK distribuido por WhatsApp. No requiere reinstalar nada. Al abrir la aplicación, el operario:

1. Ve el banner verde *"Nueva versión disponible"*
2. Toca **Actualizar** (o se aplica solo en 15 segundos)
3. Continúa trabajando con la versión nueva

---

## Próximos pasos sugeridos

Posibles mejoras evaluadas pero no incluidas en esta iteración:

- **Atribución de área por operario** dentro de una asignación compartida (hoy se atribuye al último que cerró). Requiere modelo de "sub-sesiones".
- **Notificaciones push** cuando el supervisor reasigna una labor al operario o cuando otro operario aporta a una suerte compartida.
- **Vista del Tablero** del supervisor enriquecida con el detalle de quién aportó cuánto en suertes compartidas.

Disponibles para discusión cuando el cliente lo solicite.

---

*Documento preparado el 2026-05-28 para presentación a AgroMorales.*
*Versión en producción: commit `b716a44`.*
