// A conversa do assistente fora dele: copiar a conversa inteira e guardar o
// rascunho da pergunta (revisão de qualidade de vida, 03/10/2026).

/** O mínimo de uma mensagem para virar texto. */
export interface MensagemParaCopiar {
  role: 'user' | 'assistant'
  content: string
  arquivos?: readonly { nome: string }[]
}

/**
 * A conversa em texto corrido, para colar num e-mail ou numa conversa: quem
 * falou, e o que disse, separado por uma linha em branco. O que o assistente
 * escreveu vai como veio (o Markdown dele — negrito e listas — lê bem colado).
 * Os arquivos gerados entram pelo nome: o link assinado vence em uma hora e não
 * serviria a quem recebe.
 */
export function textoDaConversa(mensagens: readonly MensagemParaCopiar[]): string {
  return mensagens
    .filter((m) => m.content.trim() || m.arquivos?.length)
    .map((m) => {
      const quem = m.role === 'user' ? 'Você' : 'Assistente'
      const arquivos = m.arquivos?.length ? `\n(Arquivos: ${m.arquivos.map((a) => a.nome).join(', ')})` : ''
      return `${quem}:\n${m.content.trim()}${arquivos}`
    })
    .join('\n\n')
}

/**
 * A chave do rascunho da pergunta em lib/preferencias.ts. UMA POR PESSOA: no
 * computador que mais de um usa, a pergunta pela metade de um não aparece para
 * o outro.
 */
export function chaveDoRascunho(userId: string | null | undefined): string | null {
  return userId ? `assistente.rascunho.${userId}` : null
}

/** O rascunho é grande demais para guardar? (Um texto colado de 50 páginas não vai para o armazenamento.) */
export const LIMITE_DO_RASCUNHO = 20_000

/**
 * PARA ONDE VAI A RESPOSTA QUE CHEGOU (auditoria de bugs, 09/10/2026).
 *
 * A resposta do assistente demora de segundos a um minuto, e nesse tempo o
 * histórico continua aberto: dá para clicar em "Nova" ou abrir outra conversa.
 * Antes, a resposta que chegava depois disso era desenhada por cima da conversa
 * aberta, e a conversa aberta continuava com o id dela — a pergunta seguinte
 * gravava as mensagens da conversa A POR CIMA da conversa B, que se perdia.
 *
 * Agora cada troca de conversa muda uma marca. A resposta:
 * - SEMPRE é gravada na conversa em que a pergunta foi feita (`idNoEnvio`; null
 *   = a conversa ainda não existia e nasce agora);
 * - só vai para a TELA (e só adota o id novo) se a conversa na tela ainda é
 *   aquela.
 */
export function destinoDaResposta(
  marcaNoEnvio: number,
  marcaAgora: number,
  idNoEnvio: string | null,
): { naTela: boolean; gravarEm: string | null } {
  return { naTela: marcaNoEnvio === marcaAgora, gravarEm: idNoEnvio }
}
