// @ts-check

import { defineConfig } from 'astro/config'
import node from '@astrojs/node'
import serviceWorker from '@ayco/astro-sw'
// import { deleteOldCaches, staleWhileRevalidate } from '@ayco/astro-sw/presets'

import * as pkg from './package.json'

export default defineConfig({
  output: 'static',
  adapter: node({
    mode: 'middleware',
  }),
  site: 'https://ayo.ayco.io',
  integrations: [
    serviceWorker({
      path: './src/sw.ts',
      assetCachePrefix: 'AstroSWTest',
      assetCacheVersionID: pkg.version,
      // presets: [staleWhileRevalidate(), deleteOldCaches()],
      exclude: ['/exclude'],
      // include: ['/components/web-component.js'],
      logAssets: true,
      esbuild: {
        minify: true,
      },
      registrationHooks: {
        installing: () => console.log('>>> installing...'),
        waiting: () => console.log('>>> waiting...'),
        active: () => console.log('>>> active...'),
        error: (error) => console.error('>>> error', error),
        afterRegistration: async () => {
          const sw = await navigator.serviceWorker.getRegistration()
          console.log('>>> registrered', sw)
        },
      },
    }),
  ],
})
