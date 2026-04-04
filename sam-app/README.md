# SAM Control - React App

Esta es la aplicación principal (SAM v2) desarrollada sobre **React 15** (vía Vite) y **Supabase**. Está diseñada para funcionar en dispositivos móviles de campo, incluso en condiciones de baja conectividad.

## Tecnologías Utilizadas

- **Framework**: React 19 + Vite 6
- **Tipado**: TypeScript 5
- **Backend**: Supabase (PostgreSQL + PostgREST)
- **Estilos**: Vanilla CSS (CSS Moderno con variables y Flexbox)
- **Iconos**: SVG inline para rendimiento y personalización.

## Arquitectura de la Aplicación

La aplicación se organiza siguiendo una estructura modular ligera:

- `src/components/`: Componentes UI reutilizables (Botones, Tarjetas, Modales).
- `src/data/`: Constantes y configuración global.
- `src/domain/`: Definiciones de interfaces y lógica de negocio.
- `src/lib/`: Configuración de servicios externos (Supabase).
- `src/utils/`: Funciones de utilidad (Formateo de fechas, Cálculos de área).

## Funcionalidades Críticas

### 1. Autenticación con PIN
Utiliza un sistema de login basado en los IDs de usuario y un PIN de 4 dígitos. El PIN se valida mediante un RPC (`app_login`) en Supabase que compara hashes MD5 con salt personalizado.

### 2. Flujo de Trabajo (Workflow)
El sistema gestiona una secuencia forzada de labores agrícolas:
`DESPEJE` -> `REPIQUE` -> `RENCALLE` -> `SUBSUELO` -> `TRIPLE` -> `FERTILIZACION` -> `ZANJAS`

### 3. Dashboard de KPIs
Muestra en tiempo real:
- **Área Total Asignada** vs **Área Realizada**.
- **Eficiencia por Hacienda**.
- **Estado de las labores** (Pendiente, En Proceso, Completada).

## Guía de Accesos Rápidos (Entorno Piloto)

Para pruebas en el entorno de desarrollo, utiliza las siguientes credenciales:

| ID | Nombre | Rol | PIN |
|---|---|---|---|
| U002 | Alfredo Uran | Supervisor | 2402 |
| U003 | William Ortiz| Operador | 2403 |
| U004 | Ismael Reyes | Operador | 2404 |

## Comandos de Desarrollo

```bash
npm install     # Instalar dependencias
npm run dev     # Iniciar servidor local
npm run build   # Generar build de producción
```

---
*Este módulo es parte del ecosistema SAM.*
