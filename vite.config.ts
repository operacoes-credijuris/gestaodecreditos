import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// base relativo ('./') para funcionar em subpath do GitHub Pages
// (ex.: usuario.github.io/credijuris-sistema/). Usamos HashRouter,
// então as rotas SPA funcionam sem configuração de servidor.
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
  },
})
