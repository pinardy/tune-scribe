/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Relative base: the build works at a domain root or under any sub-path
  // (GitHub Pages project sites, an nginx location block, …) without edits.
  base: './',
  build: {
    // the notation chunk is VexFlow (its fonts are separate files now), loaded lazily
    chunkSizeWarningLimit: 500,
    // Small assets are normally inlined as data: URLs. The recorder worklet
    // must stay a real file: audioWorklet.addModule() fetches it by URL, and
    // a same-origin file works under any Content-Security-Policy.
    assetsInlineLimit: (filePath) => (filePath.endsWith('.worklet.js') ? false : undefined),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      workbox: {
        // the recorder worklet, the fonts and the piano samples are fetched at
        // runtime, so they must be precached for the app to work offline
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,ttf,mp3}'],
      },
      manifest: {
        name: 'Tune Scribe — melody to sheet music',
        short_name: 'Tune Scribe',
        description:
          'Listens to a melody from the microphone or an audio file and writes it out as sheet music, with MusicXML and MIDI export',
        theme_color: '#f3f5f1',
        background_color: '#f3f5f1',
        display: 'standalone',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
