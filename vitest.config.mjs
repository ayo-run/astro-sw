import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      // the demo workspaces are built, not unit tested
      'demo/**',
      'demo-static/**',
    ],
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['html', 'text'],
      include: ['src'],
      exclude: [
        // barrel file; only re-exports
        'src/presets/index.ts',
        // types only, no runtime code
        'src/types.ts',
      ],
    },
  },
})
