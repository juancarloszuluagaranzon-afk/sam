/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

// Sello de version inyectado por vite.config.ts via `define`. Usado en el
// side-drawer para mostrar al usuario que bundle esta corriendo.
declare const __APP_VERSION__: string
declare const __APP_BUILD_TIME__: string
