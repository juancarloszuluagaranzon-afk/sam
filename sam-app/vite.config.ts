import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'pwa-192x192.png', 'pwa-512x512.png'],
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
            src: 'pwa-512x512.png',
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
      },
    }),
  ],
})
