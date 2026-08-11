// Peças comuns às telas de Inteligência Econômica.
//
// Duas ideias atravessam tudo aqui:
//   · nenhum número aparece sem o tamanho da amostra ao lado;
//   · nenhum indicador sofisticado aparece sem explicação a um clique.

import type { ReactNode } from 'react'
import { Info } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Loading } from '@/components/ui/Table'
import { formatBRL } from '@/lib/format'
import { processosCrud, useParametrosAtualizacao } from '@/lib/queries'
import { montarPainel, type PainelEconomico, type ResumoGrupo } from '@/lib/analytics'
import { hojeISO } from '@/lib/format'
import type { ClasseAmostra } from '../../../supabase/functions/_shared/nucleo/amostra.ts'

/** Percentual a partir de FRAÇÃO (0,3648 -> "36,5%"). */
export function pct(f: number | null | undefined, casas = 1): string {
  if (typeof f !== 'number' || !Number.isFinite(f)) return '—'
  return `${(f * 100).toFixed(casas).replace('.', ',')}%`
}

export function dias(v: number | null | undefined): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—'
  return `${Math.round(v)} d`
}

export function brl(v: number | null | undefined): string {
  return formatBRL(typeof v === 'number' ? v : null)
}

/** Carrega créditos e parâmetros e monta o painel uma única vez. */
export function usePainel(): { painel: PainelEconomico | null; carregando: boolean; erro: unknown } {
  const { data: processos, isLoading, error } = processosCrud.useList()
  const { data: params, isLoading: carregandoParams } = useParametrosAtualizacao()
  const carregando = isLoading || carregandoParams
  if (carregando || !processos) return { painel: null, carregando, erro: error }
  return { painel: montarPainel(processos, params ?? undefined, hojeISO()), carregando: false, erro: error }
}

export function CarregandoPainel() {
  return (
    <Card>
      <CardBody>
        <Loading label="Calculando a carteira…" />
      </CardBody>
    </Card>
  )
}

const TOM_CLASSE: Record<ClasseAmostra, 'gray' | 'red' | 'amber' | 'blue' | 'green'> = {
  insuficiente: 'red',
  baixa: 'amber',
  moderada: 'blue',
  alta: 'green',
}

/**
 * Selo de representatividade. É o item 7 tornado visível: sempre que um
 * agregado aparece, o direito de concluir a partir dele aparece junto.
 */
export function SeloAmostra({
  n, classe, rotulo, explicacao, compacto = false,
}: {
  n: number
  classe: ClasseAmostra
  rotulo: string
  explicacao: string
  compacto?: boolean
}) {
  return (
    <span className="inline-flex items-center gap-1.5" title={explicacao}>
      <Badge tone={TOM_CLASSE[classe]} size="sm">
        {compacto ? `n=${n}` : `${rotulo} · n=${n}`}
      </Badge>
      <Info className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
    </span>
  )
}

/**
 * Explicação de um indicador (item 19). O texto fica no `title` para
 * funcionar em qualquer contexto, inclusive dentro de tabela, sem depender de
 * biblioteca de tooltip que o projeto não tem.
 */
export function Explicacao({ texto, children }: { texto: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1" title={texto}>
      {children}
      <Info className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
    </span>
  )
}

export const EXPLICA = {
  mediana:
    'Resultado central das operações: metade ficou acima, metade abaixo. Reduz o efeito de ' +
    'valores extremos e representa melhor o caso típico do que a média.',
  media:
    'Soma dos resultados dividida pelo número de operações. Sensível a extremos — por isso ' +
    'aparece sempre ao lado da mediana.',
  ponderada:
    'Rentabilidade do capital: soma dos ganhos dividida pela soma dos capitais investidos. ' +
    'Dá mais peso às operações que receberam mais dinheiro. Responde "quanto rendeu o ' +
    'capital", enquanto a mediana responde "como se comporta uma operação qualquer".',
  tir:
    'Rentabilidade convertida para taxa ao ano, considerando o prazo de cada operação. ' +
    'Permite comparar um retorno de 30% em 8 meses com outro de 30% em 36 meses — que não ' +
    'são equivalentes.',
  iqr:
    'Amplitude interquartil: distância entre o primeiro e o terceiro quartil. Mede o quanto ' +
    'os resultados se espalham em torno do centro, sem ser afetada por extremos.',
  ic:
    'Faixa onde a mediana verdadeira do grupo deve estar, com 95% de confiança. Quanto menor ' +
    'a amostra, mais larga a faixa. Com 5 operações ou menos, a faixa é toda a amplitude dos ' +
    'dados e não diz nada.',
  extremos:
    'Operações fora do intervalo interquartil ampliado. São marcadas, nunca removidas: um ' +
    'resultado extremo pode ser um evento real. Na maioria dos casos aqui, é efeito de prazo ' +
    'muito curto, não de rentabilidade excepcional.',
  representatividade:
    'Quantas operações sustentam o número. Abaixo de 6, o intervalo de confiança da mediana ' +
    'cobre toda a amplitude observada e nenhuma conclusão é possível. De 6 a 11, baixa; de ' +
    '12 a 29, moderada; 30 ou mais, alta.',
  vencida:
    'Operações cuja data prevista de pagamento já passou sem liquidação. Ficam em bloco ' +
    'próprio: distribuí-las em meses futuros seria atribuir uma data que ninguém estimou.',
  complementar:
    'Operações que receberam o principal e aguardam um valor complementar. Não entram nas ' +
    'métricas de performance porque o resultado final ainda não é conhecido.',
  projetado:
    'Valor de face corrigido pelo índice cadastrado (SELIC ou IPCA+2%), da data-base do ' +
    'cálculo até a data prevista de recebimento. Quando a previsão já venceu, a correção ' +
    'segue até hoje.',
} as const

/** Cabeçalho de bloco com o selo de amostra do grupo. */
export function BlocoGrupo({
  titulo, descricao, grupo, children,
}: {
  titulo: string
  descricao?: string
  grupo: ResumoGrupo
  children: ReactNode
}) {
  return (
    <Card>
      <CardHeader
        title={titulo}
        description={descricao}
        action={
          <SeloAmostra
            n={grupo.n}
            classe={grupo.representatividade.classe}
            rotulo={grupo.representatividade.rotulo}
            explicacao={grupo.representatividade.explicacao}
          />
        }
      />
      <CardBody>{children}</CardBody>
    </Card>
  )
}

/** Faixa de aviso metodológico. Não é erro — é contexto obrigatório. */
export function Ressalva({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      {children}
    </div>
  )
}

export function LinhaMetrica({
  rotulo, valor, explicacao, destaque = false,
}: {
  rotulo: string
  valor: ReactNode
  explicacao?: string
  destaque?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-slate-100 py-1.5 last:border-0">
      <span className="text-sm text-slate-600">
        {explicacao ? <Explicacao texto={explicacao}>{rotulo}</Explicacao> : rotulo}
      </span>
      <span className={`tabular-nums text-right text-sm ${destaque ? 'font-semibold text-slate-800' : 'text-slate-700'}`}>
        {valor}
      </span>
    </div>
  )
}
