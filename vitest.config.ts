import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Testes das regras de dinheiro.
//
// Os testes ficam em src/, NUNCA em supabase/functions/: o CI roda
// `deno check --node-modules-dir=none supabase/functions` sem instalar
// node_modules, e um import de 'vitest' ali dentro quebraria o deploy das
// Edge Functions. Eles alcançam o núcleo por caminho relativo.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
