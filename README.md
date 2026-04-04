# SAM - Sistema de Asignación Móvil

Proyecto de modernización para la gestión de labores agrícolas en tiempo real. 

Este repositorio contiene la evolución del sistema **SAM Control**, desde su prototipo inicial hasta la aplicación robusta basada en React.

## Estructura del Repositorio

- **`sam-app/`**: La aplicación principal desarrollada con **React 19**, **TypeScript** y **Vite**. Es una PWA (Progressive Web App) con capacidades offline y sincronización nativa con **Supabase**.
- **`legacy/`**: Contiene el prototipo original (`sam_control_v1.html`) que sirvió como validación de concepto (MVP) para la lógica de negocio.

## Características Principales

- 📱 **Interfaz Mobile-First**: Diseñada para operarios en campo con elementos táctiles grandes y contraste optimizado.
- 🔄 **Sincronización Supabase**: Persistencia de datos en la nube con manejo de concurrencia.
- 📊 **Dashboard de KPIs**: Visualización instantánea de rendimiento por hacienda, suerte y operador.
- 🔐 **Sistema de Roles**:
  - **Gerencia**: Acceso a indicadores de alto nivel.
  - **Supervisor**: Creación y monitoreo de asignaciones.
  - **Operador**: Ejecución y reporte de labores.

## Requisitos Previos

- [Node.js](https://nodejs.org/) (versión 18 o superior)
- cuenta en [Supabase](https://supabase.com/) (configurada con el esquema `app_usuarios` y `app_asignaciones`).

## Instalación Rápida

1. Clonar el repositorio:
   ```bash
   git clone https://github.com/juancarloszuluagaranzon-afk/sam.git
   ```

2. Configurar variables de entorno:
   Dentro de `sam-app/`, crea un archivo `.env` con tus credenciales:
   ```env
   VITE_SUPABASE_URL=tu_url_de_supabase
   VITE_SUPABASE_ANON_KEY=tu_anon_key_de_supabase
   ```

3. Instalar dependencias e iniciar:
   ```bash
   cd sam-app
   npm install
   npm run dev
   ```

## Despliegue en Vercel

Para desplegar la aplicación en Vercel desde este repositorio:

1.  **Importar Proyecto**: En el dashboard de Vercel, selecciona "Import Project" y conéctalo con tu repositorio de GitHub `juancarloszuluagaranzon-afk/sam`.
2.  **Configurar Directorio Raíz**:
    -   En la sección **Framework Preset**, asegúrate de que esté en `Vite`.
    -   En **Root Directory**, haz clic en "Edit" y selecciona la carpeta `sam-app`.
3.  **Variables de Entorno**:
    -   Expande la sección "Environment Variables" y añade:
        -   `VITE_SUPABASE_URL`: (Tu URL de Supabase)
        -   `VITE_SUPABASE_ANON_KEY`: (Tu Anon Key de Supabase)
4.  **Desplegar**: Haz clic en **Deploy**. Vercel detectará automáticamente la configuración de `vercel.json` para manejar las rutas.

---
*Desarrollado como parte de la modernización tecnológica del SAM.*
