import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: './src/index.ts',
  fixedExtension: false,
  format: ['esm', 'cjs'],
  target: 'node16',
  sourcemap: 'inline',
})
