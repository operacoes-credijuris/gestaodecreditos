// Quadro Econômico — Visão Geral.
//
// A tela responde "como a carteira está performando economicamente?" sem
// obrigar o usuário a saber qual pergunta fazer. Por isso os insights ficam
// aqui em cima, e não numa página própria: insight que exige navegação
// dedicada não é insight.
//
// Regra que nasceu da revisão de 28/08: TODO número precisa dizer sobre QUE
// população ele foi calculado. Um card de rentabilidade ao lado de um card de
// "a receber" faz o leitor supor que um é o rendimento do outro — e não é.
// Rentabilidade aqui é sempre sobre as encerradas; capital é sempre a carteira
// inteira. Onde os dois se encontram, o rótulo diz qual é qual.

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

  const { carteira, forecast, aderencia, insights, concentracao: conc } = painel
  const vencidas = forecast.blocos.find((b) => b.rotulo === 'Previsão vencida')
  const abertas = painel.operacoes.filter((o) => !o.dataLiquidacao).length
  const parciais = painel.operacoes.filter((o) => o.status === 'complementar').length
  const semCapital = painel.operacoes.length - painel.operacoesComCapital

    // As parcelas do "a receber" são LIDAS do forecast, não escritas à mão.
  //
  // A versão anterior listava os quatro blocos possíveis como se todos
  // existissem sempre. Na carteira real pode não haver operação em aberto sem
  // data prevista — e a explicação afirmava que havia. Enumerar o que o núcleo
  // de fato produziu é a única forma de o texto não poder mentir.
  const parcelas = [
    ...(forecast.totalFuturo > 0 ? ['operações em aberto com data prevista à frente'] : []),
    ...forecast.blocos.map((b) => b.rotulo.toLowerCase()),
  ]
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
          label="Capital total investido"
          value={brl(painel.capitalTotalInvestido)}
          icon={<Coins className="h-5 w-5" />}
          hint={
            `Soma do capital de todas as ${painel.operacoesComCapital} operações com capital ` +
            'cadastrado, sem filtro de status: encerradas, em complementar e em aberto. ' +
            'É o dinheiro que já foi colocado na rua.' +
            (semCapital > 0
              ? ` Atenção: ${semCapital} ${semCapital === 1 ? 'operação está' : 'operações estão'} sem capital cadastrado e ficam fora desta soma.`
              : '')
          }
        />
        <StatCard
          label="A receber previsto"
          value={brl(forecast.totalGeral)}
          to="/inteligencia/previsoes"
          icon={<CalendarClock className="h-5 w-5" />}
          hint={
                        (parcelas.length
              ? `Tudo que a carteira ainda tem a receber, somando: ${parcelas.join(' + ')}. `
              : 'Nada a receber projetado no momento. ') +
            'É valor projetado, corrigido pelo índice de cada crédito.'
          }
        />
        <StatCard
          label="Preso em previsão vencida"
          value={brl(vencidas?.valor ?? 0)}
          tone={forecast.fracaoVencida > 0.2 ? 'red' : 'amber'}
          to="/inteligencia/previsoes"
          icon={<AlertTriangle className="h-5 w-5" />}
          hint={EXPLICA.vencida}
        />
        <StatCard
          label="Rentabilidade do investidor"
          value={pct(carteira.retornoPonderado)}
          tone="green"
          icon={<TrendingUp className="h-5 w-5" />}
          hint={
            `Calculada SÓ sobre as ${carteira.n} operações já encerradas: soma dos ganhos ` +
            'dividida pela soma dos capitais delas. Não inclui nada do que ainda está a ' +
            'receber. A taxa da Credijuris já está embutida no capital investido, então ' +
            'este número é o que ficou para o investidor.'
          }
        />
        <StatCard
          label="Rentabilidade típica (mediana)"
          value={pct(carteira.retorno.mediana)}
          tone="green"
          icon={<Layers className="h-5 w-5" />}
          hint={
            `Das ${carteira.n} operações já encerradas, metade rendeu mais que isso e metade ` +
            'rendeu menos. É uma descrição do que já aconteceu, NÃO uma previsão para ' +
            'operações futuras — cada crédito é um processo e tem particularidades próprias.'
          }
        />
        <StatCard
          label="Prazo mediano"
          value={dias(carteira.prazo.mediana)}
          tone="slate"
          icon={<Timer className="h-5 w-5" />}
          hint={
            `Dias entre a compra do crédito e o pagamento efetivo, nas ${carteira.n} operações ` +
            'encerradas. Metade levou menos que isso, metade levou mais.'
          }
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
            <div className="mt-3 border-t border-slate-200 pt-2">
              <LinhaMetrica
                rotulo="Capital investido — carteira inteira"
                valor={brl(painel.capitalTotalInvestido)}
                explicacao="Todas as operações com capital cadastrado, em qualquer status."
                destaque
              />
              <LinhaMetrica
                rotulo="Capital investido — só nas encerradas"
                valor={brl(carteira.capitalInvestido)}
                explicacao="É sobre este capital, e só sobre ele, que a rentabilidade realizada é calculada."
              />
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Resultado das encerradas"
            description="Nada aqui inclui o que ainda está a receber."
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
              rotulo="Rentabilidade do investidor"
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
