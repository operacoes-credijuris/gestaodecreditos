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

import { useMemo } from 'react'
import { AlertTriangle, CalendarClock, Clock, Gauge, Info, TrendingUp, Wallet } from 'lucide-react'
import { cn } from '@/lib/cn'
import { formatDate } from '@/lib/format'
import { evolucaoDaCarteira } from '@/lib/graficosDoQuadro'
import {
  usePainel, CarregandoPainel, ErroPainel, CabecalhoDaAba, Ressalva, Painel, Metricas,
  LinhaMetrica, Separador, SeloAmostra, CartaoNumero, GradeCartoes, ICONE_CARTAO,
  pct, brl, dias, EXPLICA, AvisoParametros,
} from './compartilhado'
import { GraficoEvolucao } from './graficos'

/** O tom de cada insight: borda, ícone e cor do ícone (`.insights li.warn/.brand`). */
const TOM_INSIGHT = {
  atencao: { borda: 'border-l-aviso-cheio', Icone: AlertTriangle, cor: 'text-aviso' },
  metodologico: { borda: 'border-l-marca-viva', Icone: Info, cor: 'text-marca-texto' },
  neutro: { borda: 'border-l-borda-forte', Icone: Info, cor: 'text-texto-3' },
} as const

export default function VisaoGeral() {
  const { painel, carregando, erro, tentarDeNovo } = usePainel()
  // A EVOLUÇÃO (nova): capital acumulado pela data de cessão e recebido pela de
  // liquidação, nos últimos 12 meses. Antes dos returns, para o hook não sumir
  // da renderização enquanto carrega.
  const evolucao = useMemo(
    () => (painel ? evolucaoDaCarteira(painel.operacoes, painel.hoje) : []),
    [painel],
  )
  if (carregando) return <CarregandoPainel />
  if (erro || !painel) return <ErroPainel tentarDeNovo={tentarDeNovo} />

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
    <div className="space-y-5">
      <CabecalhoDaAba
        titulo="Visão geral"
        apoio={
          `${painel.operacoes.length} operações · ${carteira.n} encerradas de fato · ` +
          `parâmetros de correção com data-base ${formatDate(painel.parametrosEm)}`
        }
      />
      <AvisoParametros />

      {conc?.concentrada && (
        <Ressalva>
          <strong>{pct(conc.fracaoOperacoes)}</strong> das operações são do{' '}
          <strong>{conc.maior}</strong>, que responde por {pct(conc.fracaoCapital)} do capital.
          Com essa concentração não há grupos a comparar — os números de cada tribunal
          aparecem em Recortes, mas a comparação entre eles fica bloqueada.
        </Ressalva>
      )}

      <GradeCartoes>
        <CartaoNumero
          rotulo="Capital total investido"
          valor={brl(painel.capitalTotalInvestido)}
          icone={<Wallet className={ICONE_CARTAO} />}
          dica={
            `Soma do capital de todas as ${painel.operacoesComCapital} operações com capital ` +
            'cadastrado, sem filtro de status: encerradas, em complementar e em aberto. ' +
            'É o dinheiro que já foi colocado na rua.' +
            (semCapital > 0
              ? ` Atenção: ${semCapital} ${semCapital === 1 ? 'operação está' : 'operações estão'} sem capital cadastrado e ficam fora desta soma.`
              : '')
          }
        />
        {/* OS DOIS CARTÕES DE "A RECEBER" DIZEM PARA ONDE LEVAM (Novo): o link
            e o tom já existiam; a linha de baixo escreve o destino e, no da
            previsão vencida, quanto do total está preso nela. */}
        <CartaoNumero
          rotulo="A receber previsto"
          valor={brl(forecast.totalGeral)}
          to="/inteligencia/previsoes"
          tituloDoLink="Ver as previsões mês a mês"
          sub="ver previsões por mês →"
          icone={<CalendarClock className={ICONE_CARTAO} />}
          dica={
            (parcelas.length
              ? `Tudo que a carteira ainda tem a receber, somando: ${parcelas.join(' + ')}. `
              : 'Nada a receber projetado no momento. ') +
            'É valor projetado, corrigido pelo índice de cada crédito.'
          }
        />
        <CartaoNumero
          rotulo="Preso em previsão vencida"
          valor={brl(vencidas?.valor ?? 0)}
          tom={forecast.fracaoVencida > 0.2 ? 'perigo' : 'aviso'}
          to="/inteligencia/previsoes"
          tituloDoLink="Ver as operações com previsão vencida"
          sub={
            forecast.totalGeral > 0
              ? `${pct(forecast.fracaoVencida)} do total a receber →`
              : 'ver previsões →'
          }
          icone={<AlertTriangle className={ICONE_CARTAO} />}
          dica={EXPLICA.vencida}
        />
        <CartaoNumero
          rotulo="Rentabilidade do investidor"
          valor={pct(carteira.retornoPonderado)}
          icone={<TrendingUp className={ICONE_CARTAO} />}
          dica={
            `Calculada SÓ sobre as ${carteira.n} operações já encerradas: soma dos ganhos ` +
            'dividida pela soma dos capitais delas. Não inclui nada do que ainda está a ' +
            'receber. A taxa da Credijuris já está embutida no capital investido, então ' +
            'este número é o que ficou para o investidor.'
          }
        />
        <CartaoNumero
          rotulo="Rentabilidade típica (mediana)"
          valor={pct(carteira.retorno.mediana)}
          icone={<Gauge className={ICONE_CARTAO} />}
          dica={
            `Das ${carteira.n} operações já encerradas, metade rendeu mais que isso e metade ` +
            'rendeu menos. É uma descrição do que já aconteceu, NÃO uma previsão para ' +
            'operações futuras — cada crédito é um processo e tem particularidades próprias.'
          }
        />
        <CartaoNumero
          rotulo="Prazo mediano"
          valor={dias(carteira.prazo.mediana)}
          icone={<Clock className={ICONE_CARTAO} />}
          dica={
            `Dias entre a compra do crédito e o pagamento efetivo, nas ${carteira.n} operações ` +
            'encerradas. Metade levou menos que isso, metade levou mais.'
          }
        />
      </GradeCartoes>

      {(insights.length > 0 || painel.operacoes.length > 0) && (
        <div className="grid gap-4 xl:grid-cols-2">
          {insights.length > 0 && (
            <Painel
              titulo="O que os dados estão dizendo"
              apoio="Gerado por regra a partir dos números calculados, não por texto livre."
            >
              <ul className="grid gap-2.5 px-6 pb-6 pt-1">
                {insights.map((i) => {
                  const t = TOM_INSIGHT[i.tom as keyof typeof TOM_INSIGHT] ?? TOM_INSIGHT.neutro
                  return (
                    <li
                      key={i.chave}
                      className={cn('flex gap-2.5 rounded-campo border-l-[3px] bg-superficie-2 px-4 py-3', t.borda)}
                    >
                      <t.Icone className={cn('mt-0.5 h-[16px] w-[16px] shrink-0', t.cor)} aria-hidden />
                      <div className="min-w-0">
                        <p className="text-corpo text-texto">{i.texto}</p>
                        <p className="mt-0.5 text-xs text-texto-3">{i.base}</p>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </Painel>
          )}
          {painel.operacoes.length > 0 && (
            <Painel
              titulo="Capital investido e já recebido"
              apoio="Acumulado, em milhões de reais, nos últimos 12 meses."
            >
              <GraficoEvolucao pontos={evolucao} />
            </Painel>
          )}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <Painel
          titulo="Composição da carteira"
          apoio="As três populações não se misturam em nenhum cálculo."
        >
          <Metricas>
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
          </Metricas>
          <Separador />
          <Metricas className="pt-4">
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
          </Metricas>
        </Painel>

        <Painel
          titulo="Resultado das encerradas"
          apoio="Nada aqui inclui o que ainda está a receber."
          acao={
            <SeloAmostra
              n={carteira.n}
              classe={carteira.representatividade.classe}
              rotulo={carteira.representatividade.rotulo}
              explicacao={carteira.representatividade.explicacao}
            />
          }
        >
          <Metricas>
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
          </Metricas>
        </Painel>
      </div>

      {aderencia.n > 0 && (
        <Painel
          titulo="As previsões estão sendo cumpridas?"
          apoio="Medido contra a última previsão registrada antes do pagamento."
          acao={
            <SeloAmostra
              n={aderencia.n}
              classe={aderencia.representatividade.classe}
              rotulo={aderencia.representatividade.rotulo}
              explicacao={aderencia.representatividade.explicacao}
            />
          }
        >
          <Metricas className="pb-3">
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
          </Metricas>
          <p className="px-6 pb-5 text-xs text-texto-3">
            Previsão original e número de reprogramações passam a existir conforme o
            histórico acumula, a partir da implantação deste módulo.
          </p>
        </Painel>
      )}
    </div>
  )
}
