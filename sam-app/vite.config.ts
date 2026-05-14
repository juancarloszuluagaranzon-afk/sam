import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'pwa-192x192.png', 'pwa-512x512.png', 'pwa-512x512-maskable.png'],
      manifest: {
        id: '/',
        name: 'SAM Control',
        short_name: 'SAM',
        description: 'Sistema de gestión de labores agrícolas - AgroMorales',
        lang: 'es',
        theme_color: '#1a6b3a',
        background_color: '#f5f5f0',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        categories: ['productivity', 'business'],
        shortcuts: [
          {
            name: 'Labores activas',
            short_name: 'Activas',
            description: 'Ver y gestionar labores activas',
            url: '/?tab=activas',
            icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }],
          },
          {
            name: 'Tomar suerte en campo',
            short_name: 'Campo',
            description: 'Registrar una labor de campo libre',
            url: '/?tab=campo',
            icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }],
          },
          {
            name: 'Asignar labor',
            short_name: 'Asignar',
            description: 'Crear una nueva asignación',
            url: '/?tab=asignar',
            icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }],
          },
        ],
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'pwa-512x512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff,woff2}'],
        // Supabase API calls NO se cachean en el SW — ya los manejamos en IndexedDB (Dexie).
        // Cachear aquí causa que las respuestas paginadas (Range header) colisionen con la
        // misma URL cacheada y devuelvan datos incompletos.
        runtimeCaching: [],
        // Cuando hay una version nueva del SW: actívala YA (skipWaiting) y toma el control
        // de todos los clientes abiertos (clientsClaim). Sin esto, devices con la app abierta
        // por dias siguen con bundle viejo hasta que cierran y abren. Combinado con
        // UpdateBanner, el flujo es:
        //   1. Vercel deploya bundle nuevo.
        //   2. SW de cada cliente lo detecta (cada 5min via registration.update()).
        //   3. SW nuevo se instala + activa + claim instantáneo.
        //   4. UpdateBanner aparece -> usuario toca "Actualizar" -> reload con codigo nuevo.
        //   5. Si ignora, auto-fallback a los 30s.
        skipWaiting: true,
        clientsClaim: true,
      },
    }),
  ],
})
