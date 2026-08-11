// Inteligência Econômica — Previsões e forecast de recebimentos.
//
// O gráfico mostra só o que tem mês. Previsão vencida, operação sem previsão e
// complementar aparecem em blocos separados, fora do eixo do tempo: espalhar
// esse dinheiro em meses futuros seria inventar uma data que ninguém estimou.

import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell,
} from 'recharts'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { StatCard } from '@/components/ui/StatCard'
import { Table, THead, TH, TBody, TR, TD, EmptyState, ErrorState } from '@/components/ui/Table'
import { CHART } from '@/lib/chartColors'
import { formatBRL } from '@/lib/format'
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

export default function Previsoes() {
  const { painel, carregando, erro } = usePainel()
  if (carregando) return <CarregandoPainel />
  if (erro || !painel) return <ErrorState message="Não foi possível carregar a carteira." />

  const { forecast, ajuste, aderencia } = painel
  const dados = forecast.meses.map((m) => ({ mes: rotuloMes(m.mes), valor: m.valor, n: m.operacoes }))
  const vencidas = forecast.blocos.find((b) => b.rotulo === 'Previsão vencida')

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
            description="Ficam fora do gráfico de propósito."
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
                    <TD className="text-right tabular-nums">{b.operacoes}</TD>
                    <TD className="text-right tabular-nums">{brl(b.valor)}</TD>
                    <TD className="text-slate-600">{b.motivo}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {forecast.incalculaveis > 0 && (
              <p className="mt-3 text-xs text-slate-500">
                {forecast.incalculaveis}{' '}
                {forecast.incalculaveis === 1 ? 'operação aberta não teve' : 'operações abertas não tiveram'}{' '}
                o valor projetado calculado, por falta de índice de atualização ou de parâmetro.
                Não entram em nenhum total — contá-las como zero afirmaria que não há nada a
                receber, quando o que falta é cadastro.
              </p>
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
