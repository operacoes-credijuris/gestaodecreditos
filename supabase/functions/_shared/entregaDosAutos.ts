// O QUE A FERRAMENTA `autos_do_credito` ENTREGA, montado.
//
// Três partes, nesta ordem: o MÉTODO, a FORMA DA ENTREGA e o material — o
// CADASTRO do card e os AUTOS.
//
// AQUI E NÃO DENTRO DA FUNÇÃO, porque assim o mesmo arquivo roda no vitest do
// site: é um módulo puro, sem `npm:` e sem `Deno.`. O que este texto diz decide
// como a análise sai — e isso merece teste, não conferência a olho.

import { ROTEIRO_QUALIFICACAO } from './roteiroQualificacao.ts'

/** Uma linha do balcão: os autos de um card esperando serem buscados. */
export interface AutosGuardados {
  lead_id: number
  titulo: string
  arquivos: { nome: string; paginas: number; texto: string }[]
  criado_em: string
}

/**
 * A FORMA DA ENTREGA — regra desta esteira, não do roteiro.
 *
 * SEPARADA DE PROPÓSITO. O roteiro é o método da casa e está aqui verbatim; o
 * que segue é do CANAL. A conversa nasce no Cowork, que é uma superfície de
 * trabalho: deixada à própria sorte, ela produz arquivo, artefato, planilha — e
 * o que a operação precisa ler está então a um download de distância, fora do
 * histórico da conversa e fora do que se pode colar numa nota do Kommo.
 *
 * A ANÁLISE É A RESPOSTA. Não o anexo dela.
 */
export const FORMA_DA_ENTREGA = [
  '## FORMA DA ENTREGA (regra desta esteira, complementar ao roteiro)',
  '',
  'Escreva a análise inteira NA PRÓPRIA RESPOSTA, como texto da conversa.',
  '',
  '- Não crie arquivo, documento, planilha, artefato nem anexo de espécie alguma,',
  '  e não use ferramenta que gere um. A resposta é o entregável.',
  '- Não pergunte se deve gerar um documento, e não ofereça gerar um depois.',
  '- As tabelas que o roteiro pede — a Ficha de Identificação, a tabela de partes',
  '  do Eixo 2, o batimento financeiro do Eixo 7 — vão em Markdown, no corpo da',
  '  mensagem, como o roteiro as desenha.',
  '- Não abra com resumo nem com plano de trabalho: comece pela Fase 1 e siga até',
  '  a linha de checagem final.',
].join('\n')

/**
 * O texto que o modelo vai ler.
 *
 * O ROTEIRO VEM PRIMEIRO porque diz o que fazer com tudo que vem depois. O
 * CADASTRO vem rotulado como cadastro e separado dos autos: o título do card é o
 * que o comercial escreveu, e o roteiro exige documento e página para cada campo
 * da ficha — oferecer um como o outro é o que a regra de ancoragem proíbe.
 */
export function montarEntrega(g: AutosGuardados): string {
  const cabeca = [
    ROTEIRO_QUALIFICACAO,
    '',
    '---',
    '',
    FORMA_DA_ENTREGA,
    '',
    '---',
    '',
    '## DADOS DO CARD (cadastro do comercial — NÃO é fonte documental)',
    '',
    'O título do card segue o formato `[intermediador] - [cedente] - [nº CNJ] - ' +
      '[parcela cedida] - [% de honorários contratuais]`, e neste crédito está assim:',
    '',
    '> ' + (g.titulo || '(card sem título)'),
    '',
    'Use-o para preencher o que puder do bloco [0]. Ele NÃO substitui os autos em',
    'nenhum campo da Ficha de Identificação: divergência entre o card e os autos é,',
    'ela própria, achado a registrar.',
    '',
    '---',
    '',
    '## AUTOS ANEXOS',
    '',
    'Card Kommo ' + g.lead_id + ' · ' + g.arquivos.length + ' arquivo(s) · lidos da Kommo em ' + g.criado_em,
  ].join('\n')

  const corpo = g.arquivos.map((a, i) => {
    const paginas = a.paginas > 0 ? ' (' + a.paginas + ' páginas)' : ''
    return (
      '\n\n=== ARQUIVO ' + (i + 1) + '/' + g.arquivos.length + ': ' + a.nome + paginas + ' ===\n\n' + a.texto
    )
  })

  return cabeca + corpo.join('')
}
