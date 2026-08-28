// Quadro Econômico — Performance das operações encerradas.
//
// Duas regras visuais mandam nesta tela:
//
//   1. A TIR NUNCA aparece sem o prazo ao lado. Uma taxa de 40.426% ao ano é
//      correta para um crédito liquidado em 12 dias e desinformação sem o
//      "12 dias" na mesma linha.
//
//   2. Nenhum rótulo estatístico aparece cru. "p25 – p75" e "intervalo de
//      confiança da mediana" são corretos e ilegíveis; quem lê a tela quer
//      saber o que o número significa para a carteira, não o nome dele.

import { useState } from 'react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Segmented } from '@/components/ui/Segmented'
import { Badge } from '@/components/ui/Badge'
import { Table, THead, TH, TBody, TR, TD, EmptyState, ErrorState } from '@/components/ui/Table'
import { formatDate, formatCNJ } from '@/lib/format'
import {
  usePainel, CarregandoPainel, Ressalva, LinhaMetrica, SeloAmostra, Explicacao,
  pct, brl, dias, EXPLICA,
} from './compartilhado'

type Visao = 'todas' | 'extremos'

/** Explicações desta tela. Ficam aqui porque são específicas dela. */
const DIZ = {
  metadeCentral:
    'Descarta o quarto pior e o quarto melhor. A metade do meio das operações ficou ' +
    'dentro desta faixa. É a forma de mostrar dispersão sem que um caso extremo ' +
    'estique a régua.',
  piorMelhor:
    'São duas operações reais da carteira, não estimativas. Na tabela abaixo, ordenada ' +
    'por rentabilidade, a melhor é a primeira linha e a pior é a última.',
  faixaMediana:
    'A mediana foi medida nas operações encerradas até hoje, que são uma amostra. Esta ' +
    'é a faixa onde a mediana verdadeira da carteira deve estar, com 95% de confiança. ' +
    'Quanto menos operações encerradas, mais larga a faixa. Os dois limites também são ' +
    'operações reais da carteira.',
  metadeCentralPrazo:
    'Descarta o quarto mais rápido e o quarto mais demorado. Metade das operações levou ' +
    'um prazo dentro desta faixa.',
  extremoSubconjunto:
    'Não são operações a mais: já estão contadas no total. São as que ficaram fora do ' +
    'intervalo interquartil ampliado da taxa ANUALIZADA — quase sempre por prazo muito ' +
    'curto, não por ganho excepcional. Ficam marcadas e nunca removidas de nenhum cálculo.',
  processo:
    'Número do processo no padrão CNJ. Quando o crédito não tem CNJ cadastrado, aparece ' +
    'o identificador interno do registro.',
} as const

export default function Performance() {
  const { painel, carregando, erro } = usePainel()
  const [visao, setVisao] = useState<Visao>('todas')

  if (carregando) return <CarregandoPainel />
  if (erro || !painel) return <ErrorState message="Não foi possível carregar a carteira." />

  const { carteira, encerradas } = painel
  const extremos = new Set(carteira.extremosTir)
  const lista = [...encerradas]
    .filter((o) => (visao === 'extremos' ? extremos.has(o.ref) : true))
    .sort((a, b) => (b.retorno ?? -Infinity) - (a.retorno ?? -Infinity))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Performance"
        description={
          `${carteira.n} operações encerradas — status encerrado, com data de aquisição, ` +
          'data de liquidação, capital investido e valor recebido preenchidos. As de ' +
          'realização parcial (aguardando complementar) ficam de fora: o resultado final ' +
          'delas ainda não é conhecido.'
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader
            title="Rentabilidade total"
            description="Quanto o capital rendeu, sem considerar o prazo."
          />
          <CardBody>
            <LinhaMetrica rotulo="Mediana" valor={pct(carteira.retorno.mediana)} explicacao={EXPLICA.mediana} destaque />
            <LinhaMetrica rotulo="Média" valor={pct(carteira.retorno.media)} explicacao={EXPLICA.media} />
            <LinhaMetrica rotulo="Ponderada pelo capital" valor={pct(carteira.retornoPonderado)} explicacao={EXPLICA.ponderada} destaque />
            <LinhaMetrica
              rotulo="Metade central das operações"
              valor={`${pct(carteira.retorno.p25)} – ${pct(carteira.retorno.p75)}`}
              explicacao={DIZ.metadeCentral}
            />
            <LinhaMetrica
              rotulo="Pior – melhor operação"
              valor={`${pct(carteira.retorno.minimo)} – ${pct(carteira.retorno.maximo)}`}
              explicacao={DIZ.piorMelhor}
            />
            {carteira.retornoIC && (
              <LinhaMetrica
                rotulo="Onde a mediana verdadeira deve estar"
                valor={`${pct(carteira.retornoIC.inferior)} – ${pct(carteira.retornoIC.superior)}`}
                explicacao={DIZ.faixaMediana}
              />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Rentabilidade anualizada"
            description="A mesma rentabilidade convertida para taxa ao ano, considerando o prazo."
          />
          <CardBody>
            <LinhaMetrica rotulo="Mediana" valor={pct(carteira.tir.mediana)} explicacao={EXPLICA.tir} destaque />
            <LinhaMetrica rotulo="Média" valor={pct(carteira.tir.media, 0)} explicacao={EXPLICA.media} />
            <LinhaMetrica
              rotulo="Metade central das operações"
              valor={`${pct(carteira.tir.p25)} – ${pct(carteira.tir.p75)}`}
              explicacao={DIZ.metadeCentral}
            />
            <LinhaMetrica rotulo="Maior taxa observada" valor={pct(carteira.tir.maximo, 0)} />
            <LinhaMetrica
              rotulo="Marcadas como extremo"
              valor={`${carteira.extremosTir.length} das ${carteira.n}`}
              explicacao={DIZ.extremoSubconjunto}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Prazo"
            description="Dias entre a compra do crédito e o pagamento efetivo."
          />
          <CardBody>
            <LinhaMetrica rotulo="Mediano" valor={dias(carteira.prazo.mediana)} destaque />
            <LinhaMetrica rotulo="Médio" valor={dias(carteira.prazo.media)} explicacao={EXPLICA.media} />
            <LinhaMetrica
              rotulo="Metade central das operações"
              valor={`${dias(carteira.prazo.p25)} – ${dias(carteira.prazo.p75)}`}
              explicacao={DIZ.metadeCentralPrazo}
            />
            <LinhaMetrica
              rotulo="Mais rápida – mais demorada"
              valor={`${dias(carteira.prazo.minimo)} – ${dias(carteira.prazo.maximo)}`}
              explicacao={DIZ.piorMelhor}
            />
          </CardBody>
        </Card>
      </div>

      {carteira.tir.media !== null && carteira.tir.mediana !== null &&
        carteira.tir.media > carteira.tir.mediana * 2 && (
        <Ressalva>
          A média da rentabilidade anualizada ({pct(carteira.tir.media, 0)}) é muitas vezes
          maior que a mediana ({pct(carteira.tir.mediana)}). Isso não significa que a carteira
          rendeu isso: vem de operações de prazo muito curto, cujo ganho normal vira uma taxa
          anual altíssima quando projetado para doze meses. <strong>Use a mediana e a
          rentabilidade ponderada.</strong> Nenhuma operação foi excluída dos cálculos.
        </Ressalva>
      )}

      <Card>
        <CardHeader
          title="Operações encerradas"
          description="Ordenadas da maior para a menor rentabilidade. A primeira linha é a melhor operação da carteira e a última é a pior."
          action={
            <div className="flex items-center gap-3">
              <SeloAmostra
                n={carteira.n}
                classe={carteira.representatividade.classe}
                rotulo={carteira.representatividade.rotulo}
                explicacao={carteira.representatividade.explicacao}
              />
              <Segmented
                ariaLabel="Filtrar operações"
                value={visao}
                onChange={(v) => setVisao(v as Visao)}
                items={[
                  { key: 'todas', label: 'Todas', count: encerradas.length },
                  { key: 'extremos', label: 'Só os extremos', count: carteira.extremosTir.length },
                ]}
              />
            </div>
          }
        />
        <CardBody>
          {visao === 'extremos' && (
            <div className="mb-3">
              <Ressalva>
                Estas <strong>{carteira.extremosTir.length}</strong> operações{' '}
                <strong>já estão contadas</strong> nas {carteira.n} do total — não são um grupo
                à parte. Foram marcadas pela taxa <em>anualizada</em>, quase sempre por prazo
                muito curto, e continuam dentro de todos os cálculos.
              </Ressalva>
            </div>
          )}

          {lista.length === 0 ? (
            <EmptyState
              title="Nenhuma operação encerrada"
              description="A performance realizada só considera operações com status encerrado e capital, valor recebido e datas preenchidos."
            />
          ) : (
            <Table dense>
              <THead>
                <TH>
                  <Explicacao texto={DIZ.processo}>Processo</Explicacao>
                </TH>
                <TH>Tribunal</TH>
                <TH>Aquisição</TH>
                <TH>Liquidação</TH>
                <TH className="text-right">Capital</TH>
                <TH className="text-right">Recebido</TH>
                <TH className="text-right">Ganho</TH>
                <TH className="text-right">Retorno</TH>
                <TH className="text-right">Prazo</TH>
                <TH className="text-right">
                  <Explicacao texto={EXPLICA.tir}>Anualizada</Explicacao>
                </TH>
              </THead>
              <TBody>
                {lista.map((o) => (
                  <TR key={o.ref}>
                    <TD className="whitespace-nowrap font-mono text-xs text-slate-600">
                      {o.numeroCnj ? formatCNJ(o.numeroCnj) : o.ref}
                    </TD>
                    <TD>{o.tribunal ?? '—'}</TD>
                    <TD>{formatDate(o.dataAquisicao)}</TD>
                    <TD>{formatDate(o.dataLiquidacao)}</TD>
                    <TD className="text-right tabular-nums">{brl(o.capitalInvestido)}</TD>
                    <TD className="text-right tabular-nums">{brl(o.jaRecebido)}</TD>
                    <TD className="text-right tabular-nums">{brl(o.ganho)}</TD>
                    <TD className="text-right tabular-nums">{pct(o.retorno)}</TD>
                    <TD className="text-right tabular-nums">{dias(o.prazoDias)}</TD>
                    <TD className="text-right tabular-nums">
                      <span className="inline-flex items-center gap-1.5">
                        {pct(o.tirAnual, 0)}
                        {extremos.has(o.ref) && (
                          <Badge tone="amber" size="sm">extremo</Badge>
                        )}
                      </span>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
