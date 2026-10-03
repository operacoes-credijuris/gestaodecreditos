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
