import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// In development the frontend proxies API calls to the FastAPI server, so no
// CORS setup is needed. In production, serve the built frontend from the same
// origin as the API, or set VITE_API_BASE_URL at build time.
const BACKEND = process.env.BACKEND_URL || 'http://localhost:8000'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png'],
      manifest: {
        name: 'RentUg — Verified Rentals Uganda',
        short_name: 'RentUg',
        description:
          'Verified rental properties across Uganda. Every listing is checked before it goes live. Contact landlords directly on WhatsApp.',
        // Matches the app header band (deep brand green) and page background,
        // so the status bar and splash blend into the shell.
        theme_color: '#0b3524',
        background_color: '#f2f6f3',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Cache the app shell; API responses and uploads are not cached so
        // tenants never see stale listing data presented as fresh.
        globPatterns: ['**/*.{js,css,html,png,svg,ico}'],
        navigateFallback: '/index.html',
      },
    }),
  ],
  server: {
    proxy: {
      '/api': BACKEND,
      '/uploads': BACKEND,
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
    // The big userEvent-driven form tests routinely blow the 5s default on
    // the shared dev VM; they are slow, not broken.
    testTimeout: 20000,
  },
})
