// Projeção do valor do crédito — MOVIDO para o núcleo compartilhado.
//
// A implementação vive em supabase/functions/_shared/nucleo/projecao.ts para
// que as Edge Functions (Deno) e o frontend (Vite) usem exatamente a mesma
// conta. Antes, o assistente e a análise de RPV reimplementavam estas fórmulas
// por conta própria, e os números divergiam da tela.
//
// Este arquivo continua existindo para que todo import de '@/lib/projecao'
// siga funcionando sem alteração.
export * from '../../supabase/functions/_shared/nucleo/projecao.ts'
