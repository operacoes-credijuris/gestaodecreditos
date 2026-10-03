// A ajuda da plataforma (itens "Novo" da amostra): o "?" de cada tela, o
// glossário dos termos da casa e as novidades desta versão. Os textos são os da
// amostra aprovada (ajuda.js).
//
// A AJUDA É ESCOLHIDA PELO ITEM DO MENU que está aceso (`itemAtivo`), e não pelo
// endereço cru: as cinco abas do Quadro econômico são um item só, e a ajuda dele
// vale nas cinco.

import { normalizarBusca } from './format'
import { itemAtivo } from '@/components/layout/navigation'

/** As três frases de cada tela, pelo endereço do item do menu. */
export const AJUDA_DAS_TELAS: Readonly<Record<string, readonly string[]>> = {
  '/operacional/analise': [
    'Cada crédito passa pelas mesmas quatro fases nos três funis: qualificação, comercialização, formalização e perdidos.',
    'Escolha a etapa no quadro de fases; os cards dela aparecem logo abaixo, com a ação principal sempre à direita. A busca olha todas as colunas do funil e diz onde achou.',
    'Comece o dia pelos parados há 7 dias ou mais. Anotação começada não se perde: o botão "Anotar" fica marcado até você enviar.',
  ],
  '/comercial/dados-pessoais': [
    'Investidores e originadores com os dados que entram nos contratos.',
    'Clique na linha para ver ou corrigir a ficha; o CEP completa o endereço.',
    'Só dá para remover quem não tem crédito.',
  ],
  '/comercial/contratos': [
    'Gera os contratos a partir dos modelos e da análise já salva no Drive.',
    'Siga os passos 1, 2 e 3; o resumo à direita mostra o que já está pronto.',
    'Os documentos servem para extrair os dados; os do cedente ficam arquivados no Drive, na pasta do processo.',
  ],
  '/operacional/execucao/publicacoes': [
    'O que saiu no DJEN e o que andou no ADVBOX nos processos da carteira. Cada aba se atualiza ao abrir.',
    'Marque como tratada o que já foi visto (dá para desfazer no aviso); se exigir providência, crie a tarefa no próprio cartão.',
    'Em Fase processual, cada crédito tem a sua fase e uma situação com cor — as situações são próprias de cada fase.',
  ],
  '/operacional/execucao/tarefas': [
    'Os prazos dos processos, sincronizados com o ADVBOX.',
    'As vencidas aparecem primeiro, depois hoje e amanhã e os próximos 7 dias. A tarefa é concluída no ADVBOX.',
    '"Gerar petição" parte de um modelo ou da IA, e nada é salvo sem você conferir.',
  ],
  '/operacional/execucao/processos': [
    'A carteira: cada crédito adquirido, contra quem e quando deve pagar.',
    'Clique na linha para abrir a ficha ao lado, sem perder a lista.',
    'O novo crédito pode ser preenchido pela pasta do Drive, com a IA lendo os documentos.',
  ],
  '/operacional/execucao/requerimentos': [
    'Pedidos feitos fora do processo: habilitações, preferências, retificações.',
    'Clique na linha para ver a ficha e o histórico.',
    'O "+" de cada linha adiciona um apenso; o número ao lado do protocolo mostra os que já existem.',
  ],
  '/operacional/execucao/contatos': [
    'Telefones e e-mails das serventias, gabinetes e órgãos auxiliares.',
    'Copie com um clique; o WhatsApp abre a conversa direto.',
    'Órgãos julgadores vêm dos créditos, requerimentos e apensos; os auxiliares você cadastra.',
  ],
  '/inteligencia': [
    'Os números da carteira, em cinco abas: visão geral, previsões, performance, recortes e carteiras.',
    'Passe o mouse nos gráficos para ver o valor exato; o ⓘ explica cada número.',
    'O selo de amostra diz quantas operações sustentam o número: com menos de 6, nada se conclui; a partir de 30, a leitura é firme.',
  ],
  '/configuracoes': [
    'Integrações, assistente e equipe. Só administradores veem esta tela.',
    'O ponto ao lado de cada integração repete o selo dela: configurada, não configurada ou estado não carregado.',
    'Chaves não aparecem depois de salvas: use "Substituir" para trocar.',
  ],
}

/** A ajuda da tela aberta, ou null (página não encontrada, login). */
export function ajudaDaRota(pathname: string): readonly string[] | null {
  const item = itemAtivo(pathname)
  return item ? AJUDA_DAS_TELAS[item] ?? null : null
}

/** Os termos da casa, em poucas palavras (o glossário da amostra). */
export const GLOSSARIO: readonly { termo: string; definicao: string }[] = [
  { termo: 'RPV', definicao: 'Requisição de Pequeno Valor: ordem de pagamento de uma dívida judicial do poder público de valor menor, paga em até 60 dias depois de expedida.' },
  { termo: 'Precatório', definicao: 'Ordem de pagamento de uma dívida judicial do poder público acima do limite da RPV. Entra na fila do orçamento do ente devedor.' },
  { termo: 'Cessão', definicao: 'A venda do direito de receber o valor do processo: o cedente transfere o crédito ao cessionário.' },
  { termo: 'Cedente', definicao: 'Quem vende (cede) o crédito.' },
  { termo: 'Cessionário', definicao: 'Quem compra o crédito — o investidor ou o fundo.' },
  { termo: 'Originador', definicao: 'O parceiro que trouxe o crédito até a casa.' },
  { termo: 'Deságio', definicao: 'O desconto sobre o valor de face pago na compra do crédito.' },
  { termo: 'Valor de face', definicao: 'O valor do crédito no processo, antes de qualquer desconto.' },
  { termo: 'Due diligence', definicao: 'A apuração feita antes da compra: certidões do cedente e processos em que ele é réu.' },
  { termo: 'Diligência', definicao: 'Uma pendência que impede decidir. Sanada, o crédito volta para a revisão.' },
  { termo: 'Homologação', definicao: 'A decisão do juiz que aprova os cálculos do processo.' },
  { termo: 'Requisitório', definicao: 'O documento (RPV ou precatório) que manda o ente devedor pagar.' },
  { termo: 'Apenso', definicao: 'Um processo ligado ao principal (embargos, cumprimento de sentença…).' },
  { termo: 'TIR', definicao: 'Taxa interna de retorno: o rendimento ao ano, considerando quando o dinheiro saiu e quando voltou.' },
  { termo: 'Escritura pública', definicao: 'A cessão feita em cartório, com fé pública.' },
  { termo: 'Portão 1', definicao: 'A primeira checagem da análise de RPV: valor mínimo, teto e tipo do requisitório. Reprovado aqui, o crédito nem é precificado.' },
  { termo: 'Sanar', definicao: 'Resolver a pendência de uma diligência. Sanado, o card volta para a Revisão do mesmo funil.' },
  { termo: 'Remessa aos fundos', definicao: 'Subir o crédito nas plataformas do BTG e da PJus para que eles precifiquem.' },
  { termo: 'Etiqueta', definicao: 'A marca do retorno de cada fundo no card (Enviado, Cotado, Reprovado). Uma por fundo.' },
  { termo: 'Mediana', definicao: 'O valor do meio: metade das operações ficou acima, metade abaixo. Não é puxada por extremos.' },
  { termo: 'Amostra', definicao: 'Quantas operações sustentam um número (n). Com menos de 6, nada se conclui.' },
  { termo: 'Valor projetado', definicao: 'O valor de face corrigido pelo índice do crédito até a data prevista de recebimento.' },
  { termo: 'Previsão vencida', definicao: 'Crédito cuja data prevista de pagamento já passou sem que ele fosse liquidado.' },
  { termo: 'Kommo', definicao: 'O CRM do comercial: cada crédito é um card que anda pelas colunas do funil.' },
  { termo: 'ADVBOX', definicao: 'O sistema do escritório: processos, andamentos e tarefas.' },
  { termo: 'DJEN', definicao: 'O Diário de Justiça Eletrônico Nacional, de onde vêm as publicações.' },
  { termo: 'BullAI', definicao: 'O serviço que emite as certidões do cedente automaticamente.' },
  { termo: 'Escavador', definicao: 'O serviço que busca processos em nome de uma pessoa e baixa os autos.' },
]

/**
 * O filtro do glossário: pelo termo ou pela definição, sem acento e sem
 * maiúscula (ninguém digita "diligencia" com acento numa caixa de busca).
 */
export function filtrarGlossario(
  busca: string,
  lista: readonly { termo: string; definicao: string }[] = GLOSSARIO,
): { termo: string; definicao: string }[] {
  const q = normalizarBusca(busca)
  if (!q) return [...lista]
  return lista.filter((t) => normalizarBusca(`${t.termo} ${t.definicao}`).includes(q))
}

/** Os passos das novidades desta versão (o tour da amostra), na ordem. */
export const NOVIDADES: readonly {
  icone: 'novo' | 'busca' | 'funis' | 'acao' | 'quadro' | 'ajuda'
  titulo: string
  texto: string
}[] = [
  { icone: 'novo', titulo: 'A Credijuris de cara nova', texto: 'As funções são as mesmas; o visual ficou mais leve e cada tela segue o mesmo padrão. Em poucos passos, o que mudou de lugar.' },
  { icone: 'busca', titulo: 'Ache qualquer coisa com Ctrl + K', texto: 'Crédito, card, contato ou tela: a busca do topo encontra em qualquer etapa e leva até lá.' },
  { icone: 'funis', titulo: 'Os três funis com as mesmas fases', texto: 'RPV, Precatório interno e externo têm agora as quatro fases — qualificação, comercialização, formalização e perdidos — com todas as colunas do Kommo.' },
  { icone: 'acao', titulo: 'A ação de cada card fica à direita', texto: 'O botão que avança o crédito está sempre no mesmo lugar; o resto fica no menu "⋯". Fechar uma janela com texto digitado pergunta antes de descartar.' },
  { icone: 'quadro', titulo: 'O Quadro econômico mudou para Operacional', texto: 'Um item só no menu, com abas: visão geral, previsões, performance, recortes e carteiras. Os endereços não mudaram: link salvo de qualquer tela continua abrindo o mesmo lugar.' },
  { icone: 'ajuda', titulo: 'Ajuda em toda tela', texto: 'O botão "?" ao lado do título explica a tela; "?" no teclado mostra os atalhos; o glossário explica os termos da casa.' },
]
