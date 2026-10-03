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
  build: {
    rollupOptions: {
      output: {
        // AS BIBLIOTECAS DE TODA TELA EM PEDAÇOS PRÓPRIOS: o cliente do Supabase e
        // o React (com o roteador) mudam só quando a dependência sobe de versão.
        // Separados do código da plataforma, que muda a cada publicação, o
        // navegador os guarda de uma versão para a outra — quem abre a plataforma
        // depois de uma publicação baixa só o que mudou. As telas, cada uma no
        // seu pedaço, vêm de src/App.tsx (lib/telaSobDemanda.ts).
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (/[\\/](@supabase|iceberg-js)[\\/]/.test(id)) return 'supabase'
          if (/[\\/](react|react-dom|scheduler|react-router|react-router-dom|@remix-run)[\\/]/.test(id)) {
            return 'react'
          }
          return undefined
        },
      },
    },
  },
})
