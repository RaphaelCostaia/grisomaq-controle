import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // SW proprio: precisamos controlar precache, navegacao offline e skipWaiting
      // quando o servidor sinaliza VERSAO_OBSOLETA no sync.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: null,
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // O gerador de PDF e suas fontes ficam FORA do precache: são ~1,8 MB
        // que só o escritório usa, e ele tem internet. O gerador de Excel
        // continua precacheado porque a exportação em campo é o caso de uso
        // dele — o responsável manda a ficha por WhatsApp sem sinal de sobra.
        globIgnores: ['**/pdfmake-*.js', '**/vfs_fonts-*.js'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      devOptions: {
        enabled: true,
        type: 'module',
        navigateFallback: 'index.html',
      },
      manifest: {
        name: 'GRISOMAQ CONTROLE',
        short_name: 'GrisoMaq',
        description:
          'Controle de abastecimento, caminhoes e apontamento de campo da GrisoMaq Servicos Agricolas',
        lang: 'pt-BR',
        dir: 'ltr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#ffffff',
        theme_color: '#1f362c',
        categories: ['business', 'productivity'],
        icons: [
          { src: '/icones/icone-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icones/icone-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icones/icone-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/testes/preparo.ts'],
    include: ['src/**/*.teste.{ts,tsx}'],
  },
})
