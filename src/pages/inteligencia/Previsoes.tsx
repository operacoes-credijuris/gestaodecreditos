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
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell,
} from 'recharts'
import { ChevronDown } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { StatCard } from '@/components/ui/StatCard'
import { Table, THead, TH, TBody, TR, TD, EmptyState, ErrorState } from '@/components/ui/Table'
import { CHART } from '@/lib/chartColors'
import { formatBRL, formatCNJ, formatDate } from '@/lib/format'
import type { OperacaoAnalitica } from '../../../supabase/functions/_shared/nucleo/tipos.ts'
import {
  usePainel, CarregandoPainel, Ressalva, LinhaMetrica, SeloAmostra,
  pct, brl, dias, EXPLICA,
} from './compartilhado'

function rotuloMes(iso: string): string {
  const [ano, mes] = iso.split('-').map(Number)
  return new Date(ano, mes - 1, 1)
    .toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' })
    .replace('.', '')
}

/** Chave do bloco de incalculáveis, que não vem do núcleo como os outros. */
const INCALCULAVEIS = '__incalculaveis__'

/** Número clicável que abre a lista. Sublinhado tracejado = "tem mais aqui". */
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
      className="rounded font-medium text-brand-700 underline decoration-dotted underline-offset-2 hover:text-brand-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
    >
      {children}
      <ChevronDown
        className={`ml-0.5 inline h-3.5 w-3.5 transition-transform ${aberto ? 'rotate-180' : ''}`}
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
 * saber qual é. O `ref` (8 caracteres do UUID) não serve para ninguém.
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
    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
        {titulo} · {operacoes.length}{' '}
        {operacoes.length === 1 ? 'operação' : 'operações'}
      </p>
      <Table dense>
        <THead>
          <TH>Processo</TH>
          <TH>Tribunal</TH>
          <TH>Ente devedor</TH>
          <TH>Aquisição</TH>
          <TH className="text-right">{complementar ? 'Complementar' : 'Valor'}</TH>
          {mostrarAtraso && <TH className="text-right">Vencida há</TH>}
          {motivo && <TH>O que falta</TH>}
        </THead>
        <TBody>
          {operacoes.map((o) => (
            <TR key={o.ref}>
              <TD className="whitespace-nowrap font-mono text-xs text-slate-600">
                {o.numeroCnj ? formatCNJ(o.numeroCnj) : o.ref}
              </TD>
              <TD>{o.tribunal ?? '—'}</TD>
              <TD>{o.ente ?? '—'}</TD>
              <TD>{formatDate(o.dataAquisicao)}</TD>
              <TD className="text-right tabular-nums">
                {brl(complementar ? o.valorComplementar : o.valor)}
              </TD>
              {mostrarAtraso && (
                <TD className="text-right tabular-nums">{dias(o.diasVencida)}</TD>
              )}
              {motivo && <TD className="text-slate-600">{o.motivoSemValor ?? '—'}</TD>}
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  )
}

export default function Previsoes() {
  const { painel, carregando, erro } = usePainel()
  const [aberto, setAberto] = useState<string | null>(null)

  if (carregando) return <CarregandoPainel />
  if (erro || !painel) return <ErrorState message="Não foi possível carregar a carteira." />

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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Previsões e recebimentos"
        description="Valor nominal previsto por mês, mais o que não tem data atribuível."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Previsto com mês definido"
          value={brl(forecast.totalFuturo)}
          hint="Soma do valor projetado das operações abertas cuja data prevista ainda não passou."
        />
        <StatCard
          label="Previsão vencida"
          value={brl(vencidas?.valor ?? 0)}
          tone={forecast.fracaoVencida > 0.2 ? 'red' : 'amber'}
          hint={EXPLICA.vencida}
        />
        <StatCard
          label="Total a receber"
          value={brl(forecast.totalGeral)}
          tone="slate"
          hint="Tudo somado: meses futuros, previsão vencida, sem previsão e complementar."
        />
      </div>

      {forecast.fracaoVencida > 0.2 && (
        <Ressalva>
          <strong>{pct(forecast.fracaoVencida)}</strong> de tudo que a carteira tem a receber
          está em operações cuja data prevista já passou. Enquanto não houver nova estimativa,
          esse valor não entra em nenhum mês do cronograma de caixa.
        </Ressalva>
      )}

      <Card>
        <CardHeader
          title="Recebimentos previstos por mês"
          description="Valor nominal. Não inclui os blocos sem data — eles aparecem abaixo."
        />
        <CardBody>
          {dados.length === 0 ? (
            <EmptyState
              title="Nenhuma previsão futura"
              description="Nenhuma operação em aberto tem data prevista à frente de hoje."
            />
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dados} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
                  <XAxis dataKey="mes" tick={{ fontSize: 12, fill: CHART.label }} tickLine={false} axisLine={false} />
                  <YAxis
                    tick={{ fontSize: 12, fill: CHART.label }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) => `${Math.round(v / 1000)}k`}
                  />
                  <Tooltip
                    labelStyle={{ color: CHART.ink }}
                    formatter={(v: number, _n, p) => [
                      `${formatBRL(v)} · ${(p?.payload as { n: number })?.n ?? 0} op.`,
                      'Previsto',
                    ]}
                  />
                  <Bar dataKey="valor" radius={[4, 4, 0, 0]}>
                    {dados.map((_, i) => (
                      <Cell key={i} fill={CHART.series[i % CHART.series.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardBody>
      </Card>

      {forecast.blocos.length > 0 && (
        <Card>
          <CardHeader
            title="Valores sem mês atribuível"
            description="Ficam fora do gráfico de propósito. Clique no número de operações para ver quais são."
          />
          <CardBody>
            <Table>
              <THead>
                <TH>Bloco</TH>
                <TH className="text-right">Operações</TH>
                <TH className="text-right">Valor</TH>
                <TH>Por que fica de fora</TH>
              </THead>
              <TBody>
                {forecast.blocos.map((b) => (
                  <TR key={b.rotulo}>
                    <TD className="font-medium text-slate-800">{b.rotulo}</TD>
                    <TD className="text-right tabular-nums">
                      <BotaoVer
                        aberto={aberto === b.rotulo}
                        onClick={() => setAberto(aberto === b.rotulo ? null : b.rotulo)}
                      >
                        {b.operacoes}
                      </BotaoVer>
                    </TD>
                    <TD className="text-right tabular-nums">{brl(b.valor)}</TD>
                    <TD className="text-slate-600">{b.motivo}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>

            {blocoAberto && (
              <ListaOperacoes
                titulo={blocoAberto.rotulo}
                operacoes={blocoAberto.refs.map((r) => porRef.get(r)).filter(Boolean) as OperacaoAnalitica[]}
                complementar={blocoAberto.rotulo === 'Complementar a receber'}
                mostrarAtraso={blocoAberto.rotulo === 'Previsão vencida'}
              />
            )}

            {incalculaveis.length > 0 && (
              <div className="mt-4 border-t border-slate-200 pt-3">
                <p className="text-xs text-slate-500">
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
            )}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader
          title="Estimativa ajustada pelo histórico"
          description="Corrige as datas previstas pelo desvio que a carteira historicamente apresenta."
        />
        <CardBody>
          {!ajuste.disponivel ? (
            <div className="rounded-lg bg-slate-50 px-4 py-6 text-center">
              <p className="text-sm font-medium text-slate-700">{ajuste.mensagem}</p>
              <p className="mx-auto mt-2 max-w-xl text-xs text-slate-500">
                Produzir uma estimativa ajustada com {ajuste.observacoes} observações seria
                transferir incerteza de um lugar para outro fingindo que virou precisão. O
                histórico de alterações de previsão começou a ser gravado agora e vai
                alimentar esta seção conforme as operações forem sendo reprogramadas e pagas.
              </p>
            </div>
          ) : (
            <>
              <LinhaMetrica rotulo="Desvio mediano observado" valor={dias(ajuste.desvioMediano)} destaque />
              <LinhaMetrica rotulo="Percentil 75 do desvio" valor={dias(ajuste.desvioP75)} />
              <p className="mt-3 text-xs text-slate-500">{ajuste.metodologia}</p>
            </>
          )}
        </CardBody>
      </Card>

      {aderencia.n > 0 && (
        <Card>
          <CardHeader
            title="Aderência histórica"
            description="Diferença entre a última previsão registrada e o pagamento efetivo."
            action={
              <SeloAmostra
                n={aderencia.n}
                classe={aderencia.representatividade.classe}
                rotulo={aderencia.representatividade.rotulo}
                explicacao={aderencia.representatividade.explicacao}
              />
            }
          />
          <CardBody>
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
          </CardBody>
        </Card>
      )}
    </div>
  )
}
