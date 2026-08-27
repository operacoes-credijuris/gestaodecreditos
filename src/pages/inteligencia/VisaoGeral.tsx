// Quadro Econômico — Visão Geral.
//
// A tela responde "como a carteira está performando economicamente?" sem
// obrigar o usuário a saber qual pergunta fazer. Por isso os insights ficam
// aqui em cima, e não numa página própria: insight que exige navegação
// dedicada não é insight.

import { Coins, TrendingUp, CalendarClock, AlertTriangle, Timer, Layers } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatCard } from '@/components/ui/StatCard'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { ErrorState } from '@/components/ui/Table'
import { formatDate } from '@/lib/format'
import {
  usePainel, CarregandoPainel, Ressalva, LinhaMetrica, SeloAmostra,
  pct, brl, dias, EXPLICA,
} from './compartilhado'

export default function VisaoGeral() {
  const { painel, carregando, erro } = usePainel()
  if (carregando) return <CarregandoPainel />
  if (erro || !painel) return <ErrorState message="Não foi possível carregar a carteira." />

  const { carteira, forecast, aderencia, anomalias, insights, concentracao: conc } = painel
  const vencidas = forecast.blocos.find((b) => b.rotulo === 'Previsão vencida')
  const abertas = painel.operacoes.filter((o) => !o.dataLiquidacao).length
  const parciais = painel.operacoes.filter((o) => o.status === 'complementar').length

  return (
    <div className="space-y-6">
      <PageHeader
        title="Quadro Econômico"
        description={
          `${painel.operacoes.length} operações · ${carteira.n} encerradas de fato · ` +
          `parâmetros de correção com data-base ${formatDate(painel.parametrosEm)}`
        }
      />

      {conc?.concentrada && (
        <Ressalva>
          <strong>{pct(conc.fracaoOperacoes)}</strong> das operações são do{' '}
          <strong>{conc.maior}</strong>, que responde por {pct(conc.fracaoCapital)} do capital.
          Com essa concentração não há grupos a comparar — os números de cada tribunal
          aparecem em Recortes, mas a comparação entre eles fica bloqueada.
        </Ressalva>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          label="Capital investido (encerradas)"
          value={brl(carteira.capitalInvestido)}
          icon={<Coins className="h-5 w-5" />}
          hint={`Soma do capital das ${carteira.n} operações encerradas com dados completos.`}
        />
        <StatCard
          label="Rentabilidade do capital"
          value={pct(carteira.retornoPonderado)}
          tone="green"
          icon={<TrendingUp className="h-5 w-5" />}
          hint={EXPLICA.ponderada}
        />
        <StatCard
          label="Rentabilidade da operação típica"
          value={pct(carteira.retorno.mediana)}
          tone="green"
          icon={<Layers className="h-5 w-5" />}
          hint={EXPLICA.mediana}
        />
        <StatCard
          label="Prazo mediano"
          value={dias(carteira.prazo.mediana)}
          tone="slate"
          icon={<Timer className="h-5 w-5" />}
          hint="Dias entre a compra do crédito e o pagamento efetivo, nas operações encerradas."
        />
        <StatCard
          label="A receber previsto"
          value={brl(forecast.totalGeral)}
          to="/inteligencia/previsoes"
          icon={<CalendarClock className="h-5 w-5" />}
          hint="Valor projetado das operações em aberto, somado aos blocos sem data prevista."
        />
        <StatCard
          label="Preso em previsão vencida"
          value={brl(vencidas?.valor ?? 0)}
          tone={forecast.fracaoVencida > 0.2 ? 'red' : 'amber'}
          to="/inteligencia/previsoes"
          icon={<AlertTriangle className="h-5 w-5" />}
          hint={EXPLICA.vencida}
        />
      </div>

      {insights.length > 0 && (
        <Card>
          <CardHeader
            title="O que os dados estão dizendo"
            description="Gerado por regra a partir dos números calculados, não por texto livre."
          />
          <CardBody>
            <ul className="space-y-3">
              {insights.map((i) => (
                <li
                  key={i.chave}
                  className={
                    'rounded-lg border-l-4 bg-slate-50 px-3 py-2 ' +
                    (i.tom === 'atencao'
                      ? 'border-amber-400'
                      : i.tom === 'metodologico'
                        ? 'border-brand-400'
                        : 'border-slate-300')
                  }
                >
                  <p className="text-sm text-slate-800">{i.texto}</p>
                  <p className="mt-1 text-xs text-slate-500">{i.base}</p>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Composição da carteira"
            description="As três populações não se misturam em nenhum cálculo."
          />
          <CardBody>
            <LinhaMetrica rotulo="Encerradas (performance realizada)" valor={carteira.n} destaque />
            <LinhaMetrica
              rotulo="Realização parcial (complementar)"
              valor={parciais}
              explicacao={EXPLICA.complementar}
            />
            <LinhaMetrica rotulo="Em aberto" valor={abertas} />
            {carteira.excluidas > 0 && (
              <LinhaMetrica
                rotulo="Encerradas fora do cálculo (falta dado)"
                valor={carteira.excluidas}
                explicacao="Operação sem capital ou sem valor recebido fica fora do numerador e do denominador. Entrar com zero afirmaria resultado zero onde o que falta é cadastro."
              />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Resultado das encerradas"
            action={
              <SeloAmostra
                n={carteira.n}
                classe={carteira.representatividade.classe}
                rotulo={carteira.representatividade.rotulo}
                explicacao={carteira.representatividade.explicacao}
              />
            }
          />
          <CardBody>
            <LinhaMetrica rotulo="Capital investido" valor={brl(carteira.capitalInvestido)} />
            <LinhaMetrica rotulo="Valor recebido" valor={brl(carteira.valorRecebido)} />
            <LinhaMetrica rotulo="Ganho nominal" valor={brl(carteira.ganhoNominal)} destaque />
            <LinhaMetrica
              rotulo="Rentabilidade ponderada"
              valor={pct(carteira.retornoPonderado)}
              explicacao={EXPLICA.ponderada}
              destaque
            />
            <LinhaMetrica rotulo="Mediana" valor={pct(carteira.retorno.mediana)} explicacao={EXPLICA.mediana} />
            <LinhaMetrica rotulo="Média" valor={pct(carteira.retorno.media)} explicacao={EXPLICA.media} />
            <LinhaMetrica
              rotulo="Anualizada (mediana)"
              valor={pct(carteira.tir.mediana)}
              explicacao={EXPLICA.tir}
            />
          </CardBody>
        </Card>
      </div>

      {anomalias.operacoesComAchado > 0 && (
        <Ressalva>
          <strong>{anomalias.operacoesComAchado}</strong>{' '}
          {anomalias.operacoesComAchado === 1 ? 'operação aparece' : 'operações aparecem'} na
          lista de revisão de dados. Nenhum dado foi alterado —{' '}
          <a className="font-medium underline" href="/inteligencia/anomalias">
            ver a lista
          </a>
          .
        </Ressalva>
      )}

      {aderencia.n > 0 && (
        <Card>
          <CardHeader
            title="As previsões estão sendo cumpridas?"
            description="Medido contra a última previsão registrada antes do pagamento."
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
            <LinhaMetrica rotulo="Desvio mediano" valor={dias(aderencia.desvioDias.mediana)} destaque />
            <LinhaMetrica rotulo="Desvio médio" valor={dias(aderencia.desvioDias.media)} explicacao={EXPLICA.media} />
            <LinhaMetrica rotulo="Pagas até a previsão" valor={aderencia.pagasAteAPrevisao} />
            <LinhaMetrica rotulo="Pagas depois" valor={aderencia.pagasDepois} />
            {aderencia.semPrevisao > 0 && (
              <LinhaMetrica
                rotulo="Pagas sem previsão registrada"
                valor={aderencia.semPrevisao}
                explicacao="Ficam fora desta conta. A maioria entrou no sistema já paga, na importação da carteira."
              />
            )}
            <p className="mt-3 text-xs text-slate-500">
              Previsão original e número de reprogramações passam a existir conforme o
              histórico acumula, a partir da implantação deste módulo.
            </p>
          </CardBody>
        </Card>
      )}
    </div>
  )
}
