// Inteligência econômica — MOVIDO para o núcleo compartilhado.
//
// A montagem do painel vive em supabase/functions/_shared/nucleo/painel.ts
// para que as telas e o assistente produzam exatamente os mesmos números,
// chamando a mesma função. Este arquivo é só o ponto de entrada do frontend.
export * from '../../supabase/functions/_shared/nucleo/painel.ts'
