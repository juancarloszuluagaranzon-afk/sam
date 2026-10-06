---
name: managing-tarifas-manuales
description: Guía de arquitectura sobre cómo se asientan las tarifas manuales cuando el motor de reglas automáticas de facturación falla o no aplica.
---

# Asignación de Tarifas Manuales (Sobrescribir motor de Facturación)

El sistema de facturación en `sam-app/src/lib/tarifas.ts` usa un motor de reglas que lee de la tabla `tarifas` (`useTarifas()`). La clave de valoración es: `(razon social, cliente, labor, modalidad, fecha)`. Si una labor completada no coincide con ninguna regla (ej. por falta de modalidad o falta de un precio pactado), se mostrará como **"sin tarifa"**.

## El problema de las bases sin `tarifa_id`

La tabla `asignaciones` en la base de datos de producción **no cuenta con una columna `tarifa_id` ni `precio_manual`**. Al mismo tiempo, ejecutar migraciones estructurales vía SSH/Docker (`supabase db push`) no siempre está disponible sin el rol `postgres` o el acceso al VPS.

## La solución de la "Etiqueta en Observaciones"

Para evitar una migración DDL y permitir que Carlos David (o administración) pueda forzar una tarifa, se implementó un mecanismo de etiquetado en el campo `observaciones` (notes):

1. **La marca de agua:** En la pestaña **Facturación**, el usuario puede seleccionar una o varias labores "sin tarifa" (o cualquier otra), elegir una tarifa existente en el selector manual y hacer clic en **"Forzar tarifa"**.
2. **Escritura en BD:** La función `setTarifaManualBulk()` (en `samApi.ts`) lee las observaciones actuales y les concatena un string especial invisible a simple vista: `[TARIFA:uuid_de_la_tarifa]`.
3. **Lectura y priorización:** La función `valorarLinea()` (en `lib/tarifas.ts`) utiliza una expresión regular (`/\[TARIFA:([a-f0-9\-]{36})\]/i`) para detectar si la labor tiene una tarifa forzada manual. **Si la tiene, esta tiene prioridad absoluta**, cortocircuitando el cálculo del motor automático y tomando el precio, cliente y razón social exactos de la tarifa inyectada.

### Código de referencia

*   **Lógica base:** `lib/tarifas.ts` (`valorarLinea`)
*   **Actualización masiva:** `services/samApi.ts` (`setTarifaManualBulk`)
*   **UI:** `views/FacturacionTab.tsx` (Búsqueda de botón `Forzar tarifa` dentro del action bar)

### Ventajas de este enfoque
*   Soporte completo offline-first sin cambios en los tipos de Dexie.
*   Retrocompatibilidad del 100% con la tabla de `asignaciones` y sin tocar `CLAUDE.md`.
*   Si una tarifa manual debe quitarse, basta con editar las observaciones en el modal de detalle y borrar la etiqueta `[TARIFA:...]`.
