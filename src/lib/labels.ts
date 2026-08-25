// Rótulos e cores de badges por status. Centraliza a apresentação.
//
// Convenção semântica de cores:
//   verde (green)     = concluído / positivo
//   azul (blue)       = em andamento
//   âmbar (yellow)    = atenção
//   vermelho (red)    = bloqueio / crítico
//   cinza (gray)      = neutro / encerrado
//   roxo (purple)     = categoria especial
// Mapas categóricos (tipos, fontes) usam cores apenas para distinguir.
//
// Além dos rótulos, este arquivo guarda as regras DERIVADAS da carteira
// (statusLiquidacao, statusTir, diasEmCarteira). Elas moram juntas porque as
// três dependem do mesmo critério — "o crédito já foi pago?" — e separá-las
// abriria espaço para discordarem sobre o mesmo crédito.

import { estaPago } from '../../supabase/functions/_shared/nucleo/pagamento.ts'

type BadgeTone =
  | 'gray'
  | 'green'
  | 'red'
  | 'yellow'
  | 'blue'
  | 'purple'
  | 'orange'
  // Preenchidos, em uso só pela espécie do requisitório. Ver Badge.tsx.
  | 'tealSolid'
  | 'indigoSolid'

export interface LabelDef {
  label: string
  tone: BadgeTone
}

export const STATUS_ANALISE: Record<string, LabelDef> = {
  pendente: { label: 'Pendente', tone: 'gray' },
  em_analise: { label: 'Em análise', tone: 'blue' },
  aprovada: { label: 'Aprovada', tone: 'green' },
  reprovada: { label: 'Reprovada', tone: 'red' },
}

export const STATUS_PROCESSO: Record<string, LabelDef> = {
  ativo: { label: 'Ativo', tone: 'green' },
  complementar: { label: 'Complementar', tone: 'yellow' },
  encerrado: { label: 'Encerrado', tone: 'gray' },
}

// Tipos que um crédito pode acumular (marcáveis em conjunto).
export const TIPO_CREDITO: Record<string, LabelDef> = {
  principal: { label: 'Crédito principal', tone: 'blue' },
  honorarios_contratuais: { label: 'Honorários contratuais', tone: 'purple' },
  // Chave mantida como honorarios_advocaticios: e ela que esta no check
  // constraint da migracao 0019 e nos registros ja gravados. Só o rótulo muda.
  honorarios_advocaticios: { label: 'Honorários sucumbenciais', tone: 'orange' },
}

export const INDICE_ATUALIZACAO: Record<string, LabelDef> = {
  selic: { label: 'SELIC', tone: 'blue' },
  ipca_2: { label: 'IPCA + 2% a.a.', tone: 'purple' },
}

/**
 * Espécie do requisitório. Decide, entre outras coisas, a pasta de topo do Drive
 * onde a petição gerada é salva — daí as chaves seguirem exatamente o check da
 * migração 0032.
 *
 * TONS PREENCHIDOS, e não azul/violeta como antes: instrumento usa exatamente esse
 * par, e na tabela de Créditos os dois selos ficam na mesma linha — davam a
 * impressão de ser o mesmo campo. Fundo cheio separa por forma, que sobrevive a
 * qualquer vizinhança de matiz.
 */
export const ESPECIE_REQUISITORIO: Record<string, LabelDef> = {
  rpv: { label: 'RPV', tone: 'tealSolid' },
  precatorio: { label: 'Precatório', tone: 'indigoSolid' },
}

export const INSTRUMENTO: Record<string, LabelDef> = {
  particular: { label: 'Particular', tone: 'gray' },
  registro_publico: { label: 'Registro público', tone: 'blue' },
  escritura_publica: { label: 'Escritura pública', tone: 'purple' },
}

export const STATUS_INVESTIDOR: Record<string, LabelDef> = {
  ativo: { label: 'Ativo', tone: 'green' },
  inativo: { label: 'Inativo', tone: 'gray' },
}

export const TIPO_PESSOA: Record<string, LabelDef> = {
  pf: { label: 'Pessoa Física', tone: 'blue' },
  pj: { label: 'Pessoa Jurídica', tone: 'purple' },
}

export const STATUS_CESSAO: Record<string, LabelDef> = {
  disponivel: { label: 'Disponível', tone: 'green' },
  parcial: { label: 'Captação parcial', tone: 'yellow' },
  captado: { label: 'Captado', tone: 'blue' },
  liquidado: { label: 'Liquidado', tone: 'gray' },
}

export const STATUS_INVESTIMENTO: Record<string, LabelDef> = {
  ativo: { label: 'Ativo', tone: 'green' },
  liquidado: { label: 'Liquidado', tone: 'gray' },
  cancelado: { label: 'Cancelado', tone: 'red' },
}

export const TIPO_CONTRATO: Record<string, LabelDef> = {
  cessao: { label: 'Cessão', tone: 'blue' },
  investimento: { label: 'Investimento', tone: 'purple' },
  outro: { label: 'Outro', tone: 'gray' },
}

export const STATUS_CONTRATO: Record<string, LabelDef> = {
  rascunho: { label: 'Rascunho', tone: 'gray' },
  gerado: { label: 'Gerado', tone: 'blue' },
  assinado: { label: 'Assinado', tone: 'green' },
  cancelado: { label: 'Cancelado', tone: 'red' },
}

export function getLabel(
  map: Record<string, LabelDef>,
  key: string | null | undefined,
): LabelDef {
  if (!key) return { label: '—', tone: 'gray' }
  return map[key] ?? { label: key, tone: 'gray' }
}

/**
 * Texto das colunas Estágio processual e Providências quando o crédito está
 * ENCERRADO. Não há processo a narrar nem providência a tomar, então a mensagem
 * é fixa — resumo gerado ali só produziria variação de redação em algo que já
 * terminou, e gastaria chamada ao modelo sem acrescentar informação.
 *
 * Segue as mesmas regras dos textos gerados: sem data, sem dois-pontos, sem
 * travessão e sem adjetivo elogiando a equipe.
 */
export const RESUMO_ENCERRADO = {
  estagio:
    'Crédito integralmente liquidado e processo encerrado, com os valores recebidos conferidos e adequados.',
  providencias: 'Operação concluída. Não há providências pendentes.',
} as const

/**
 * Resolve os dois textos da carteira. Ponto único: tela e exportação chamam
 * daqui, senão uma poderia mostrar a mensagem fixa e a outra o texto da IA.
 *
 * A troca acontece no ATO DA LEITURA, e não só na geração. Assim, no instante
 * em que o crédito passa a encerrado a carteira já mostra a mensagem fixa, sem
 * esperar a rodada semanal, e nunca exibe a narrativa antiga de um processo que
 * acabou.
 */
export function textosResumo(
  status: string | null | undefined,
  resumo:
    | { estagio_processual: string | null; providencias: string | null }
    | undefined,
): { estagio: string | null; providencias: string | null; fixo: boolean } {
  if (status === 'encerrado') {
    return {
      estagio: RESUMO_ENCERRADO.estagio,
      providencias: RESUMO_ENCERRADO.providencias,
      fixo: true,
    }
  }
  return {
    estagio: resumo?.estagio_processual ?? null,
    providencias: resumo?.providencias ?? null,
    fixo: false,
  }
}





/**
 * Tipos do crédito em UMA linha de texto corrido, em caixa de frase.
 *
 * Mora aqui, ao lado de TIPO_CREDITO, porque a tela e o Excel exportado têm de
 * dizer a MESMA coisa: existiam duas implementações, e elas divergiam — a da tela
 * economiza a palavra repetida ("honorários contratuais e sucumbenciais") e a do
 * exportador repetia ("honorários contratuais e honorários sucumbenciais"). Quem
 * comparasse planilha com tela via textos diferentes para o mesmo crédito.
 */
export function textoTipoCredito(tipos: string[] | null | undefined): string {
  const t = tipos ?? []
  if (t.length === 0) return '—'
  const temContratuais = t.includes('honorarios_contratuais')
  const partes: string[] = []
  if (t.includes('principal')) partes.push('crédito principal')
  if (temContratuais) partes.push('honorários contratuais')
  if (t.includes('honorarios_advocaticios')) {
    partes.push(temContratuais ? 'sucumbenciais' : 'honorários sucumbenciais')
  }
  if (partes.length === 0) return '—'
  if (partes.length === 1) return partes[0]
  // "A, B e C" — vírgula entre os primeiros, "e" antes do último.
  return `${partes.slice(0, -1).join(', ')} e ${partes[partes.length - 1]}`
}

/**
 * Status da TIR na carteira do investidor — CALCULADO, nunca digitado.
 *
 *   Efetivada  o crédito já foi pago, então a taxa é a que de fato aconteceu
 *   Estimada   ainda não foi pago, então a taxa é projeção
 *
 * "Pago" é ter data de liquidação, a mesma leitura que acende o verde em
 * statusLiquidacao. Ponto único da regra: as duas colunas não podem discordar
 * sobre o mesmo crédito estar pago.
 */
export function statusTir(
  dataLiquidacao: string | null | undefined,
): 'Efetivada' | 'Estimada' {
  return estaPago(dataLiquidacao) ? 'Efetivada' : 'Estimada'
}

// Antecedência que acende o âmbar no status da carteira: com menos de um mês
// para a expectativa, o crédito passa a exigir acompanhamento. Régua num só
// lugar — mudar aqui muda a cor e o texto da dica junto.
export const MESES_ALERTA_LIQUIDACAO = 1

/**
 * Status de liquidação de um crédito — CALCULADO, nunca digitado. É a coluna
 * Status da carteira do investidor.
 *
 *   verde     já liquidado (tem data de liquidação)
 *   azul      não liquidado, falta MAIS de um mês para a expectativa
 *   âmbar     não liquidado, falta MENOS de um mês para a expectativa
 *   vermelho  não liquidado e a expectativa já venceu
 *   cinza     não liquidado e sem expectativa cadastrada (não há o que medir)
 *
 * O `label` é o NOME DA COR, por decisão de produto: a carteira é lida junto
 * com quem investiu, e "verde/âmbar/vermelho" é o vocabulário que se usa na
 * conversa. Quem carrega o significado é a `dica` (title da célula) — sem ela a
 * coluna diria apenas uma cor.
 *
 * A comparação é textual porque ISO (YYYY-MM-DD) é ordenável, e `hoje` é
 * recalculado a cada render: a cor vira sozinha na virada do dia, sem ninguém
 * mexer no cadastro.
 */
export function statusLiquidacao(
  dataLiquidacao: string | null | undefined,
  expectativa: string | null | undefined,
  hoje: string,
  limiteAlerta: string,
): LabelDef & { dica: string } {
  if (estaPago(dataLiquidacao)) {
    return { label: 'Verde', tone: 'green', dica: 'Crédito liquidado' }
  }
  const exp = (expectativa ?? '').slice(0, 10)
  if (!exp) {
    return {
      label: '—',
      tone: 'gray',
      dica: 'Sem expectativa de liquidação cadastrada',
    }
  }
  if (exp < hoje) {
    return {
      label: 'Vermelho',
      tone: 'red',
      dica: 'Expectativa de liquidação vencida e crédito não liquidado',
    }
  }
  if (exp <= limiteAlerta) {
    return {
      label: 'Âmbar',
      tone: 'yellow',
      dica: `Liquidação prevista em menos de ${MESES_ALERTA_LIQUIDACAO} mês`,
    }
  }
  return {
    label: 'Azul',
    tone: 'blue',
    dica: `Liquidação prevista em mais de ${MESES_ALERTA_LIQUIDACAO} mês`,
  }
}

// Regra de pagamento e prazo: fonte única no núcleo compartilhado com as Edge
// Functions. Reexportado para que nenhum import existente de '@/lib/labels'
// precise mudar.
export { diasEmCarteira } from '../../supabase/functions/_shared/nucleo/pagamento.ts'
export { estaPago }
