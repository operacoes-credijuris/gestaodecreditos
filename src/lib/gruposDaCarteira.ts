// Os sete grupos de colunas da carteira do investidor (aba Carteiras do Quadro)
// e o liga/desliga de cada um na tela — o item "Grupos de colunas na carteira"
// da amostra.
//
// SÓ A TELA. O Excel (lib/exportarCarteira.ts), o relatório do investidor e a
// mensagem de WhatsApp (lib/relatorioCarteira.ts) continuam saindo dos geradores
// de sempre, com as 25 colunas, por mais grupos que se desliguem aqui: o arquivo
// que vai ao investidor não pode depender do que alguém escondeu para ler melhor
// a tela. Por isso nada daqui é importado por eles.
//
// TODOS ABREM LIGADOS: a tela começa igual à de antes, e desligar é escolha de
// quem olha. A escolha não é guardada — reabrir a aba volta às 25 colunas.

export type ChaveGrupo = 'ide' | 'tir' | 'cre' | 'rec' | 'compl' | 'viv' | 'calc'

export interface GrupoDaCarteira {
  chave: ChaveGrupo
  /** O título do grupo no cabeçalho, como o Excel o escreve. */
  titulo: string
  /** O nome curto do botão de liga/desliga. */
  curto: string
  colunas: Array<{ titulo: string; direita?: boolean }>
}

export const GRUPOS_DA_CARTEIRA: readonly GrupoDaCarteira[] = [
  {
    chave: 'ide',
    titulo: 'Identificação · fixo na abertura',
    curto: 'Identificação',
    colunas: [
      { titulo: 'Nº processo' },
      { titulo: 'Cedente' },
      { titulo: 'Advogado' },
      { titulo: 'Tipo de crédito' },
      { titulo: 'Tribunal' },
    ],
  },
  {
    chave: 'tir',
    titulo: 'TIR obrigatório',
    curto: 'TIR obrigatório',
    colunas: [{ titulo: 'Capital investido', direita: true }, { titulo: 'Data da cessão' }],
  },
  {
    chave: 'cre',
    titulo: 'Crédito · fixo na abertura',
    curto: 'Crédito',
    colunas: [
      { titulo: 'Valor de face', direita: true },
      { titulo: 'Data ref. do face' },
      { titulo: 'Índice de atualização' },
    ],
  },
  {
    chave: 'rec',
    titulo: 'Recebimento principal',
    curto: 'Recebimento principal',
    colunas: [
      { titulo: 'Data est. recebimento' },
      { titulo: 'Já recebido', direita: true },
      { titulo: 'Data receb. efetivo' },
    ],
  },
  {
    chave: 'compl',
    titulo: 'Complementar',
    curto: 'Complementar',
    colunas: [{ titulo: 'Valor est. complementar', direita: true }],
  },
  {
    chave: 'viv',
    titulo: 'Dados vivos · atualizar mensalmente',
    curto: 'Dados vivos',
    colunas: [
      { titulo: 'Status' },
      { titulo: 'Estágio processual' },
      { titulo: 'Providências / prox. passos' },
      { titulo: 'Últ. atualização' },
    ],
  },
  {
    chave: 'calc',
    titulo: 'Calculado automaticamente',
    curto: 'Calculado automaticamente',
    colunas: [
      { titulo: 'Valor projetado', direita: true },
      { titulo: 'Status TIR' },
      { titulo: 'TIR a.a.', direita: true },
      { titulo: 'TIR mensal', direita: true },
      { titulo: 'Dias em carteira', direita: true },
      { titulo: 'Ganho projetado', direita: true },
      { titulo: 'Retorno', direita: true },
    ],
  },
]

/** Quantas colunas a tabela inteira tem (as 25 do Excel). */
export const TOTAL_DE_COLUNAS = GRUPOS_DA_CARTEIRA.reduce((s, g) => s + g.colunas.length, 0)

export type GruposLigados = Record<ChaveGrupo, boolean>

/** O estado inicial: os sete ligados. */
export function todosLigados(): GruposLigados {
  return { ide: true, tir: true, cre: true, rec: true, compl: true, viv: true, calc: true }
}

/** Liga ou desliga um grupo, sem mexer nos outros. */
export function alternarGrupo(atual: GruposLigados, chave: ChaveGrupo): GruposLigados {
  return { ...atual, [chave]: !atual[chave] }
}

/** Os grupos que aparecem, na ordem fixa da tabela. */
export function gruposVisiveis(ligados: GruposLigados): GrupoDaCarteira[] {
  return GRUPOS_DA_CARTEIRA.filter((g) => ligados[g.chave])
}

/** Quantas das 25 colunas estão na tela ("12 de 25 na tela"). */
export function colunasNaTela(ligados: GruposLigados): number {
  return gruposVisiveis(ligados).reduce((s, g) => s + g.colunas.length, 0)
}
