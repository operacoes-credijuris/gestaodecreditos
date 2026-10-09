// AS COTAÇÕES DOS FUNDOS, numa lista: o fundo à esquerda, com a etiqueta e há
// quanto tempo; à direita, o valor da proposta e a comissão.
//
// UMA LISTA SÓ PARA AS DUAS CAIXAS DO CARD (07/10/2026): a "Escolher proposta"
// da Em precificação, em que cada linha é um botão, e o "Ver propostas" da
// Produção de proposta e da Negociação, só de leitura. O desenho é o mesmo para
// quem alterna entre as duas comparar sem reaprender a ler.
//
// SÓ APRESENTAÇÃO: o que entra na lista e em que ordem é de `propostasDoCard`.
import { cn } from '@/lib/cn'
import { tempoDecorrido } from '@/lib/format'
import { rotuloDaComissao, type LinhaDaCotacao } from '@/lib/propostasDoCard'
import {
  formatarReais,
  type CotacaoLida,
} from '../../../supabase/functions/_shared/cotacaoDoFundo.ts'

/**
 * O VALOR E A COMISSÃO de um fundo, alinhados à direita e em números tabulares:
 * a proposta na linha de cima, a comissão embaixo, em texto secundário. Sem
 * cotação, "—". O que alguém escreveu à mão no Kommo e não se lê como valor
 * aparece como está, cortado, com o texto inteiro no passar do mouse.
 *
 * NO SPREAD DO FORMATO NOVO ("R$ 807.500,00 / R$ 42.500,00 (Spread de 5%)"),
 * em cima vai a proposta FINAL — é o que o cedente recebe, e é o número que se
 * compara — e embaixo "Comissão R$ 42.500,00 (spread 5%)". O spread antigo,
 * sem percentual, continua "Comissão em spread".
 */
export function ValoresDaCotacao({ cotacao }: { cotacao: CotacaoLida | null }) {
  if (!cotacao) return <span className="text-corpo tabular-nums text-texto-3">—</span>
  if (cotacao.proposta === null) {
    return (
      <span className="block max-w-[150px] truncate text-right text-xs text-texto-2" title={cotacao.texto}>
        {cotacao.texto}
      </span>
    )
  }
  const linha = rotuloDaComissao(cotacao.comissao)
  return (
    // NO CELULAR, NO MÁXIMO 160px: o "(spread 5%)" desce, e o "Cotado · há 2
    // dias" à esquerda não fica por baixo da comissão.
    <span className="block max-w-[160px] text-right tabular-nums sm:max-w-none">
      <span className="block whitespace-nowrap text-corpo font-semibold text-texto">{formatarReais(cotacao.proposta)}</span>
      <span className="block text-xs text-texto-2">
        <span className="whitespace-nowrap">{linha.texto}</span>
        {linha.detalhe && (
          <>
            {' '}
            <span className="whitespace-nowrap">{linha.detalhe}</span>
          </>
        )}
      </span>
    </span>
  )
}

/** A grade da linha: o fundo encolhe (e corta); o valor fica inteiro. */
const LINHA = 'grid min-h-[36px] w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-s4 rounded-controle px-s3 py-s1.5 text-left'

/** O fundo, em destaque quando cotou, e embaixo a etiqueta e há quanto tempo. */
function FundoDaLinha({ linha }: { linha: LinhaDaCotacao }) {
  const s = linha.situacao
  return (
    <span className="min-w-0">
      <span className={cn('block truncate text-corpo text-texto', s?.ato === 'Cotado' ? 'font-bold' : 'font-medium')}>
        {linha.fundo}
      </span>
      {s && (
        <span className="block truncate text-xs text-texto-3">
          {/* O ATO NA COR DA ETIQUETA (revisão de UX de 09/10/2026): o "Erro"
              âmbar e o "Reprovado" vermelho, como no card e no seletor — em
              cinza, "Erro · ontem" se lia como mais um cotado sem valor. O
              "Cotado" já vem em destaque no nome do fundo, e o "Enviado" é
              espera: ficam no cinza. */}
          <span className={cn(s.ato === 'Erro' && 'font-semibold text-aviso', s.ato === 'Reprovado' && 'font-semibold text-perigo')}>
            {s.ato}
          </span>
          {s.desde ? ` · ${tempoDecorrido(s.desde)}` : ''}
        </span>
      )}
    </span>
  )
}

/**
 * A LISTA: o cabeçalho ("‹título›" à esquerda, "Proposta" à direita) e uma
 * linha por fundo. Com `onEscolher`, cada linha é um botão; sem ele, é só
 * leitura — nenhum controle, nada que escolha, mova ou edite.
 */
export function ListaDeCotacoes({
  titulo,
  tituloId,
  linhas,
  onEscolher,
}: {
  titulo: string
  /** O id do título, para a caixa se nomear por ele (`aria-labelledby`). */
  tituloId?: string
  linhas: readonly LinhaDaCotacao[]
  onEscolher?: (fundo: string) => void
}) {
  return (
    <>
      <p className="flex items-baseline justify-between gap-s3 px-s3 pb-s1 pt-s2 text-xs font-bold uppercase tracking-[.06em] text-texto-3">
        <span id={tituloId}>{titulo}</span>
        <span className="whitespace-nowrap" aria-hidden>
          Proposta
        </span>
      </p>
      {onEscolher ? (
        linhas.map((l) => (
          <button
            key={l.fundo}
            type="button"
            onClick={() => onEscolher(l.fundo)}
            className={cn(LINHA, 'hover:bg-superficie-3 focus-visible:bg-superficie-3')}
          >
            <FundoDaLinha linha={l} />
            <ValoresDaCotacao cotacao={l.cotacao} />
          </button>
        ))
      ) : (
        <ul>
          {linhas.map((l) => (
            <li key={l.fundo} className={LINHA}>
              <FundoDaLinha linha={l} />
              <ValoresDaCotacao cotacao={l.cotacao} />
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
