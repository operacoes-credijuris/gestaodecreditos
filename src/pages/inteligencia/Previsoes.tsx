// Quadro Econômico — Previsões e forecast de recebimentos.
//
// O gráfico mostra só o que tem mês. Previsão vencida, operação sem previsão e
// complementar aparecem em blocos separados, fora do eixo do tempo: espalhar
// esse dinheiro em meses futuros seria inventar uma data que ninguém estimou.
//
// Todo bloco abre a lista dos processos que o compõem. Um bloco que só informa
// "3 operações" transfere o trabalho para quem lê: para agir sobre ele é
// preciso saber QUAIS são, e isso não pode depender de rodar SQL no banco.

import { useState, type ReactNode } from 'react'
import { AlertTriangle, ArrowRight, CalendarClock, ChevronDown, Wallet } from 'lucide-react'
import { Table, THead, TH, TBody, TR, TD, EmptyState } from '@/components/ui/Table'
import { cn } from '@/lib/cn'
import { formatCNJ, formatDate } from '@/lib/format'
import type { OperacaoAnalitica } from '../../../supabase/functions/_shared/nucleo/tipos.ts'
import {
  usePainel, CarregandoPainel, ErroPainel, CabecalhoDaAba, Painel, Metricas, LinhaMetrica,
  SeloAmostra, CartaoNumero, GradeCartoes, ICONE_CARTAO, ProcessoOuRef, TABELA_NO_PAINEL,
  brl, dias, EXPLICA, AvisoParametros,
} from './compartilhado'
import { GraficoPrevisoes } from './graficos'

function rotuloMes(iso: string): string {
  const [ano, mes] = iso.split('-').map(Number)
  return new Date(ano, mes - 1, 1)
    .toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' })
    .replace('.', '')
}

/** Chave do bloco de incalculáveis, que não vem do núcleo como os outros. */
const INCALCULAVEIS = '__incalculaveis__'

/**
 * O selo de cada bloco sem mês (Novo: "blocos sem mês com selo de cor e
 * ícone"), sempre com ícone e texto: vencida em vermelho com alerta, sem
 * previsão neutro, complementar em azul com seta.
 */
function SeloDoBloco({ rotulo }: { rotulo: string }) {
  const estilo =
    rotulo === 'Previsão vencida'
      ? { cor: 'ring-perigo-borda bg-perigo-fundo text-perigo', Icone: AlertTriangle }
      : rotulo === 'Complementar a receber'
        ? { cor: 'ring-info-borda bg-info-fundo text-info', Icone: ArrowRight }
        : { cor: 'ring-borda bg-superficie-3 text-texto-2', Icone: null }
  // NAS MEDIDAS DA `Badge` (§0.8, revisão visual 2): 20px e o contorno por dentro
  // (a meia força no escuro). Com 22px e borda, lado a lado com os outros selos,
  // parecia de outra família.
  return (
    <span className={cn('inline-flex h-[20px] items-center gap-s1 whitespace-nowrap rounded-full px-s2 text-xs font-semibold ring-1 ring-inset dark:ring-opacity-50', estilo.cor)}>
      {estilo.Icone && <estilo.Icone className="h-[12px] w-[12px]" aria-hidden />}
      {rotulo}
    </span>
  )
}

/** Número clicável que abre a lista (o `.link-btn` da amostra, com a seta que gira). */
function BotaoVer({
  aberto, onClick, children,
}: {
  aberto: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={aberto}
      className="-ml-s2 inline-flex h-controle-sm items-center gap-s1 rounded-controle px-s2 text-sm font-semibold tabular-nums text-marca-texto transition-colors hover:bg-marca-leve focus:outline-none focus-visible:ring-2 focus-visible:ring-anel"
    >
      {children}
      <ChevronDown
        className={cn('h-[16px] w-[16px] transition-transform', aberto && 'rotate-180')}
        aria-hidden
      />
    </button>
  )
}

/**
 * Lista as operações de um bloco, pelo NÚMERO DO PROCESSO.
 *
 * Existe porque "3 operações sem data prevista" não é acionável: para tirar uma
 * operação desse bloco alguém precisa abrir o processo, e para isso precisa
 * saber qual é. Sem CNJ, aparece o identificador interno — com a dica de por quê.
 */
function ListaOperacoes({
  titulo, operacoes, complementar = false, mostrarAtraso = false, motivo = false,
}: {
  titulo: string
  operacoes: readonly OperacaoAnalitica[]
  complementar?: boolean
  mostrarAtraso?: boolean
  motivo?: boolean
}) {
  if (operacoes.length === 0) return null
  return (
    <div className="mx-s5 mb-s3 mt-s1 rounded-campo border border-borda bg-superficie-2 px-s3 py-s2">
      <p className="mb-s1 font-display text-xs font-bold uppercase tracking-wider text-texto-3">
        {titulo} · {operacoes.length}{' '}
        {operacoes.length === 1 ? 'operação' : 'operações'}
      </p>
      <Table className="[&_td]:px-s2 [&_td]:py-s1 [&_td]:text-sm [&_th]:px-s2 [&_th]:py-s1">
        <THead>
          <tr>
            <TH>Processo</TH>
            <TH>Tribunal</TH>
            <TH>Ente devedor</TH>
            <TH>Aquisição</TH>
            <TH className="text-right">{complementar ? 'Complementar' : 'Valor'}</TH>
            {mostrarAtraso && <TH className="text-right">Vencida há</TH>}
            {motivo && <TH>O que falta</TH>}
          </tr>
        </THead>
        <TBody>
          {operacoes.map((o) => (
            <TR key={o.ref}>
              <TD>
                <ProcessoOuRef cnj={o.numeroCnj ? formatCNJ(o.numeroCnj) : null} refInterna={o.ref} />
              </TD>
              <TD>{o.tribunal ?? '—'}</TD>
              <TD>{o.ente ?? '—'}</TD>
              <TD className="whitespace-nowrap tabular-nums">{formatDate(o.dataAquisicao)}</TD>
              <TD className="whitespace-nowrap text-right tabular-nums">
                {brl(complementar ? o.valorComplementar : o.valor)}
              </TD>
              {mostrarAtraso && (
                <TD className="whitespace-nowrap text-right tabular-nums">{dias(o.diasVencida)}</TD>
              )}
              {motivo && <TD className="text-texto-3">{o.motivoSemValor ?? '—'}</TD>}
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  )
}

export default function Previsoes() {
  const { painel, carregando, erro, tentarDeNovo } = usePainel()
  const [aberto, setAberto] = useState<string | null>(null)

  if (carregando) return <CarregandoPainel />
  if (erro || !painel) return <ErroPainel tentarDeNovo={tentarDeNovo} />

  const { forecast, ajuste, aderencia } = painel
  const dados = forecast.meses.map((m) => ({ mes: rotuloMes(m.mes), valor: m.valor, n: m.operacoes }))
  const vencidas = forecast.blocos.find((b) => b.rotulo === 'Previsão vencida')

  // Os blocos já trazem os refs; aqui só resolvemos ref -> operação para poder
  // mostrar o número do processo. Nenhuma conta é refeita.
  const porRef = new Map(painel.operacoes.map((o) => [o.ref, o]))
  const blocoAberto = forecast.blocos.find((b) => b.rotulo === aberto) ?? null

  // Mesmo critério do núcleo (forecast.ts): aberta e sem valor projetável.
  // É filtro de exibição, não cálculo — o total já veio pronto em
  // forecast.incalculaveis e não é recalculado aqui.
  const incalculaveis = painel.operacoes.filter((o) => !o.dataLiquidacao && o.valor === null)

  // A descrição da página nomeia os blocos que EXISTEM, em vez de prometer
  // categorias que a carteira pode não ter. A versão anterior falava em "o que
  // não tem data atribuível" numa carteira em que toda operação tem data.
  const parcelasSemMes = forecast.blocos.map((b) => b.rotulo.toLowerCase()).join(' e ')

  return (
    <div className="space-y-s4">
      <CabecalhoDaAba
        titulo="Previsões e recebimentos"
        apoio={
          forecast.blocos.length
            ? `Valor nominal previsto por mês, mais ${parcelasSemMes}.`
            : 'Valor nominal previsto por mês.'
        }
      />
      <AvisoParametros />

      {/* OS CARTÕES GANHARAM ÍCONE (Novo, só visual); o tom vermelho/âmbar da
          previsão vencida é o de sempre. */}
      <GradeCartoes>
        <CartaoNumero
          rotulo="Previsto com mês definido"
          valor={brl(forecast.totalFuturo)}
          icone={<CalendarClock className={ICONE_CARTAO} />}
          dica="Soma do valor projetado das operações abertas cuja data prevista ainda não passou."
        />
        <CartaoNumero
          rotulo="Previsão vencida"
          valor={brl(vencidas?.valor ?? 0)}
          tom={forecast.fracaoVencida > 0.2 ? 'perigo' : 'aviso'}
          icone={<AlertTriangle className={ICONE_CARTAO} />}
          dica={EXPLICA.vencida}
        />
        <CartaoNumero
          rotulo="Total a receber"
          valor={brl(forecast.totalGeral)}
          icone={<Wallet className={ICONE_CARTAO} />}
          dica="Tudo somado: meses futuros, previsão vencida, sem previsão e complementar."
        />
      </GradeCartoes>

      <Painel
        titulo="Operações a receber por mês"
        apoio="Quantas operações têm pagamento previsto em cada mês, e quanto elas somam."
      >
        {dados.length === 0 ? (
          <EmptyState
            embutido
            title="Nenhuma previsão futura"
            description="Nenhuma operação em aberto tem data prevista à frente de hoje."
          />
        ) : (
          <GraficoPrevisoes dados={dados} />
        )}
      </Painel>

      {/* TAMBÉM SÓ COM INCALCULÁVEIS: a carteira em que todo crédito aberto tem
          previsão futura não tem bloco nenhum, e o aviso das operações sem valor
          projetado — que ficam fora do "Total a receber" — sumia junto com o
          painel. */}
      {(forecast.blocos.length > 0 || incalculaveis.length > 0) && (
        <Painel
          titulo="Valores sem mês atribuível"
          apoio="Ficam fora do gráfico de propósito. Clique no número de operações para ver quais são."
        >
          {forecast.blocos.length > 0 && (
          <div className="border-t border-borda">
            {/* NO CELULAR, O "POR QUE" DESCE PARA A LINHA DE BAIXO (revisão UX,
                09/10/2026): numa coluna estreita à direita, a frase quebrava
                palavra por palavra e cada linha da tabela passava de 180px. */}
            <Table className={TABELA_NO_PAINEL}>
              <THead>
                <tr className="max-sm:hidden">
                  <TH>Bloco</TH>
                  <TH className="text-right">Operações</TH>
                  <TH className="text-right">Valor</TH>
                  <TH>Por que fica de fora</TH>
                </tr>
              </THead>
              <TBody>
                {forecast.blocos.map((b) => (
                  <TR
                    key={b.rotulo}
                    className="max-sm:grid max-sm:grid-cols-[auto_minmax(0,1fr)] max-sm:items-center"
                  >
                    <TD className="max-sm:col-span-2 max-sm:pb-s1">
                      <SeloDoBloco rotulo={b.rotulo} />
                    </TD>
                    <TD className="text-right max-sm:py-0 max-sm:pl-s5 max-sm:text-left">
                      <BotaoVer
                        aberto={aberto === b.rotulo}
                        onClick={() => setAberto(aberto === b.rotulo ? null : b.rotulo)}
                      >
                        {b.operacoes}
                      </BotaoVer>
                    </TD>
                    <TD className="whitespace-nowrap text-right tabular-nums max-sm:py-0 max-sm:pr-s5">{brl(b.valor)}</TD>
                    <TD className="text-texto-3 max-sm:col-span-2 max-sm:pl-s5 max-sm:pt-s1">{b.motivo}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
          )}

          {blocoAberto && (
            <div className="pt-s2">
              <ListaOperacoes
                titulo={blocoAberto.rotulo}
                operacoes={blocoAberto.refs.map((r) => porRef.get(r)).filter(Boolean) as OperacaoAnalitica[]}
                complementar={blocoAberto.rotulo === 'Complementar a receber'}
                mostrarAtraso={blocoAberto.rotulo === 'Previsão vencida'}
              />
            </div>
          )}

          {incalculaveis.length > 0 ? (
            <div className="border-t border-borda pb-s1 pt-s2">
              <p className="px-s5 pb-s2 text-xs text-texto-3">
                <BotaoVer
                  aberto={aberto === INCALCULAVEIS}
                  onClick={() => setAberto(aberto === INCALCULAVEIS ? null : INCALCULAVEIS)}
                >
                  {incalculaveis.length}
                </BotaoVer>{' '}
                {incalculaveis.length === 1 ? 'operação aberta não teve' : 'operações abertas não tiveram'}{' '}
                o valor projetado calculado, por falta de índice de atualização ou de parâmetro.
                Não entram em nenhum total — contá-las como zero afirmaria que não há nada a
                receber, quando o que falta é cadastro.
              </p>
              {aberto === INCALCULAVEIS && (
                <ListaOperacoes titulo="Sem valor projetado" operacoes={incalculaveis} motivo />
              )}
            </div>
          ) : (
            <div className="h-s3" />
          )}
        </Painel>
      )}

      {/* A estimativa ajustada só aparece quando existe de fato.
          Antes havia aqui um card permanente que, sem dados, exibia apenas a
          explicação de por que não havia dados. Bloco que só se desculpa ocupa
          espaço e não informa nada.

          Hoje ela nunca aparece, e o motivo não é falta de liquidações: quando
          uma operação é liquidada, a expectativa_liquidacao não é preservada,
          então não sobra contra o que comparar a data efetiva. O conserto está
          em ler a última previsão de public.processos_historico, que o gatilho
          instalado em 11/08 já grava. Enquanto isso não existir, o card não
          tem por que ocupar a tela. */}
      {ajuste.disponivel && (
        <Painel
          titulo="Estimativa ajustada pelo histórico"
          apoio="Corrige as datas previstas pelo desvio que a carteira historicamente apresenta."
        >
          {/* NA LARGURA DE UM PAINEL INTEIRO, A LISTA NÃO ESTICA (revisão UX, 09/10/2026):
              o rótulo à esquerda e o número a mais de 1000px dele, no outro canto,
              não se liam como par. 640px, como os painéis de meia largura. */}
          <Metricas className="max-w-[640px] pb-s2">
            <LinhaMetrica rotulo="Desvio mediano observado" valor={dias(ajuste.desvioMediano)} destaque />
            <LinhaMetrica rotulo="Percentil 75 do desvio" valor={dias(ajuste.desvioP75)} />
          </Metricas>
          <p className="px-s5 pb-s4 text-xs text-texto-3">{ajuste.metodologia}</p>
        </Painel>
      )}

      {aderencia.n > 0 && (
        <Painel
          titulo="Aderência histórica"
          apoio="Diferença entre a última previsão registrada e o pagamento efetivo."
          acao={
            <SeloAmostra
              n={aderencia.n}
              classe={aderencia.representatividade.classe}
              rotulo={aderencia.representatividade.rotulo}
              explicacao={aderencia.representatividade.explicacao}
            />
          }
        >
          {/* NA LARGURA DE UM PAINEL INTEIRO, A LISTA NÃO ESTICA (revisão UX, 09/10/2026):
              o rótulo à esquerda e o número a mais de 1000px dele, no outro canto,
              não se liam como par. 640px, como os painéis de meia largura. */}
          <Metricas className="max-w-[640px]">
            <LinhaMetrica rotulo="Desvio mediano" valor={dias(aderencia.desvioDias.mediana)} explicacao={EXPLICA.mediana} destaque />
            <LinhaMetrica rotulo="Desvio médio" valor={dias(aderencia.desvioDias.media)} explicacao={EXPLICA.media} />
            <LinhaMetrica rotulo="Mais adiantado" valor={dias(aderencia.desvioDias.minimo)} />
            <LinhaMetrica rotulo="Mais atrasado" valor={dias(aderencia.desvioDias.maximo)} />
            <LinhaMetrica rotulo="Pagas até a previsão" valor={aderencia.pagasAteAPrevisao} />
            <LinhaMetrica rotulo="Pagas depois" valor={aderencia.pagasDepois} />
            <LinhaMetrica
              rotulo="Pagas sem previsão registrada"
              valor={aderencia.semPrevisao}
              explicacao="Ficam fora da conta. A maior parte entrou no sistema já paga, na importação da carteira."
            />
          </Metricas>
        </Painel>
      )}
    </div>
  )
}
