import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    client: 'src/client.ts',
    server: 'src/server.ts',
    next: 'src/next.ts',
    express: 'src/express.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
  target: 'es2022',
  external: ['viem', 'next', 'express'],
})
