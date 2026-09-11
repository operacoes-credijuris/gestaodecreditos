// O TEXTO QUE O POSTGRES ACEITA GUARDAR.
//
// O DEFEITO QUE ISTO CONSERTA, e ele custou um uso real: gravar os autos de um
// processo de 239 páginas devolvia `unsupported Unicode escape sequence
// (HTTP 500)`. O erro não é da função nem do JSON — é do Postgres. Um valor
// `jsonb` NÃO PODE conter o caractere nulo, e a coluna `text` também não: o NUL
// termina a string em C, que é onde o banco mora.
//
// E TEXTO DE PDF VEM COM NUL. Não por corrupção: o pdf.js devolve o que o mapa
// de caracteres da fonte manda, e processo grande é costura de peças de origens
// diferentes — petição digital, ofício requisitório, planilha da contadoria —,
// cada uma com sua fonte remendada. Basta um glifo sem mapeamento para o
// caractere sair zero.
//
// O QUE SAI, e por quê:
//   NUL              o banco recusa, e é o caso que derrubou de verdade.
//   controles C0     resto do mesmo lixo de fonte. Ficam a tabulação e as
//                    quebras de linha, que são estrutura do documento.
//   substituto solto meia letra. Um D800 sem o par que o completa não é
//                    caractere nenhum, não tem UTF-8 válido, e o banco recusa
//                    pelo mesmo motivo.
//
// O QUE NÃO SAI: acento, cedilha, travessão, símbolo de moeda, emoji inteiro.
// Nada de conteúdo. Esta função tira o que NÃO É CARACTERE — não normaliza, não
// recorta e não decide o que é relevante.
//
// PURO DE PROPÓSITO: sem `npm:` e sem `Deno.`, então o mesmo arquivo roda no
// vitest do site, que é onde estão os testes.

/** Tira do texto o que o Postgres não consegue guardar. */
export function limparParaOBanco(bruto: unknown): string {
  const texto = typeof bruto === 'string' ? bruto : String(bruto ?? '')
  return (
    texto
      // O NUL, que é o que derruba a gravação.
      .replace(/\u0000/g, '')
      // Os outros controles C0, preservando \t (09), \n (0A) e \r (0D).
      .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      // Metade alta de par substituto sem a metade baixa que a completa.
      .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '')
      // Metade baixa sem a alta.
      .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
  )
}
