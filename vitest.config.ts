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
    // BANCO DE MENTIRA PARA TODO TESTE. Sem isto o Vitest lê o `.env` da
    // máquina — o de PRODUÇÃO — e `src/lib/supabase.ts` monta o cliente com o
    // endereço e a chave reais (ele lê `import.meta.env.VITE_SUPABASE_URL` e
    // `VITE_SUPABASE_ANON_KEY` ao ser importado, e meia plataforma o importa).
    // Hoje nenhum teste chama o banco, mas o primeiro teste de componente que
    // disparar um `select` ou um `functions.invoke` sem querer leria ou GRAVARIA
    // dado de verdade.
    //
    // O `env` daqui vence o `.env` e também o ambiente do processo (um job do CI
    // que algum dia exporte as chaves antes do `npm test` continua protegido;
    // conferido no Vitest 2.1: `{ ...process.env, ...config.env }`). O domínio
    // `.invalid` é reservado (RFC 2606) e nunca resolve: uma chamada que escape
    // falha na hora, em vez de chegar a algum servidor. Valores NÃO vazios de
    // propósito: com texto vazio o `supabase.ts` cairia no provisório dele e
    // avisaria no console a cada arquivo de teste.
    env: {
      VITE_SUPABASE_URL: 'http://supabase.teste.invalid',
      VITE_SUPABASE_ANON_KEY: 'chave-de-teste',
    },
  },
})
