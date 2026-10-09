// O RASCUNHO DA JUSTIFICATIVA TÉCNICA NO CACHE DA TELA (09/10/2026).
//
// A janela da justificativa salva a edição no servidor (a ação `rascunho`), mas
// o cache da consulta continuava com a linha de antes. Abrindo a janela de outro
// card e voltando, a tela lia do cache a linha SEM a edição — e, como o campo só
// recarrega quando muda a geração, a releitura do servidor (com a edição) era
// ignorada. O campo mostrava o texto antigo, e o Enviar mandava ao Kommo o texto
// sem as correções.
//
// A edição salva vai para a linha do cache na hora, pela mesma regra do
// servidor: só na mesma geração (`tentativa`) do mesmo card.

/** O mínimo da linha que o rascunho toca. */
export interface LinhaComRascunho {
  kommo_lead_id: number
  tentativa?: string | null
  texto_editado?: string | null
  rascunho_em?: string | null
}

/**
 * A linha do cache com o rascunho que o servidor acabou de gravar — ou a mesma
 * linha, se ela já for de outra geração ou de outro card (o rascunho velho não
 * pode cobrir um texto gerado de novo).
 */
export function comRascunhoSalvo<T extends LinhaComRascunho>(
  linha: T | null | undefined,
  salvo: { kommo_lead_id: number; tentativa?: string | null; texto: string; rascunho_em: string },
): T | null | undefined {
  if (!linha) return linha
  if (linha.kommo_lead_id !== salvo.kommo_lead_id || (linha.tentativa ?? null) !== (salvo.tentativa ?? null)) return linha
  return { ...linha, texto_editado: salvo.texto, rascunho_em: salvo.rascunho_em }
}
