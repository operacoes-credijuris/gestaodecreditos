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
//
// E uma da amostra: O NÚMERO QUE SE DEVE USAR VEM PRIMEIRO. Em cada cartão a
// mediana (e, na rentabilidade total, também a ponderada pelo capital) vai em
// tamanho grande; as outras medidas ficam embaixo, cada uma com o seu ⓘ.

import { useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Segmented } from '@/components/ui/Segmented'
import { Table, THead, TH, TBody, TR, TD, EmptyState } from '@/components/ui/Table'
import { cn } from '@/lib/cn'
import { formatDate, formatCNJ } from '@/lib/format'
import { distribuicaoDoRetorno } from '@/lib/graficosDoQuadro'
import {
  usePainel, CarregandoPainel, ErroPainel, CabecalhoDaAba, Ressalva, Painel, Metricas,
  LinhaMetrica, SeloAmostra, Explicacao, Dica, ProcessoOuRef, TABELA_NO_PAINEL,
  pct, brl, dias, EXPLICA, AvisoParametros,
} from './compartilhado'
import { Histograma } from './graficos'

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
  processo: EXPLICA.processo,
} as const

/**
 * O número grande da métrica (`.hero-v`) com o rótulo cinza ao lado. No maior
 * tamanho da escala (26px, o do título de página), e não nos 34px da amostra:
 * tamanho fora da escala é o que a catraca do visual barra.
 */
function Destaque({ valor, rotulo, explicacao }: { valor: string; rotulo: string; explicacao?: string }) {
  return (
    <span className="inline-flex items-baseline gap-2">
      <span className="text-3xl font-bold tracking-tight tabular-nums text-texto">{valor}</span>
      <span className="inline-flex items-center gap-0.5 text-corpo text-texto-3">
        {rotulo}
        {explicacao && <Dica texto={explicacao} />}
      </span>
    </span>
  )
}

/** Um cartão de métrica (`.panel.metric`): título, frase, destaques e as demais medidas. */
function Metrica({
  titulo, apoio, destaques, children,
}: {
  titulo: string
  apoio: string
  destaques: ReactNode
  children: ReactNode
}) {
  return (
    <Painel titulo={titulo} apoio={apoio}>
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 px-6 pb-3 pt-1">{destaques}</div>
      <Metricas>{children}</Metricas>
    </Painel>
  )
}

export default function Performance() {
  const { painel, carregando, erro, tentarDeNovo } = usePainel()
  const [visao, setVisao] = useState<Visao>('todas')
  const faixas = useMemo(() => (painel ? distribuicaoDoRetorno(painel.encerradas) : []), [painel])

  if (carregando) return <CarregandoPainel />
  if (erro || !painel) return <ErroPainel tentarDeNovo={tentarDeNovo} />

  const { carteira, encerradas } = painel
  const extremos = new Set(carteira.extremosTir)
  const ordenadas = [...encerradas].sort((a, b) => (b.retorno ?? -Infinity) - (a.retorno ?? -Infinity))
  const lista = ordenadas.filter((o) => (visao === 'extremos' ? extremos.has(o.ref) : true))

  return (
    <div className="space-y-5">
      <CabecalhoDaAba
        titulo="Performance"
        apoio={
          `${carteira.n} operações encerradas — status encerrado, com data de aquisição, ` +
          'data de liquidação, capital investido e valor recebido preenchidos. As de ' +
          'realização parcial (aguardando complementar) ficam de fora: o resultado final ' +
          'delas ainda não é conhecido.'
        }
      />
      <AvisoParametros />

      <div className="grid gap-4 xl:grid-cols-3">
        <Metrica
          titulo="Rentabilidade total"
          apoio="Quanto o capital rendeu, sem considerar o prazo."
          destaques={
            <>
              <Destaque valor={pct(carteira.retorno.mediana)} rotulo="mediana" explicacao={EXPLICA.mediana} />
              <Destaque valor={pct(carteira.retornoPonderado)} rotulo="ponderada pelo capital" explicacao={EXPLICA.ponderada} />
            </>
          }
        >
          <LinhaMetrica rotulo="Média" valor={pct(carteira.retorno.media)} explicacao={EXPLICA.media} />
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
        </Metrica>

        <Metrica
          titulo="Rentabilidade anualizada"
          apoio="A mesma rentabilidade convertida para taxa ao ano, considerando o prazo."
          destaques={<Destaque valor={pct(carteira.tir.mediana)} rotulo="mediana" explicacao={EXPLICA.tir} />}
        >
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
        </Metrica>

        <Metrica
          titulo="Prazo"
          apoio="Dias entre a compra do crédito e o pagamento efetivo."
          destaques={<Destaque valor={dias(carteira.prazo.mediana)} rotulo="mediano" />}
        >
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
        </Metrica>
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

      {/* O HISTOGRAMA (Novo): o formato da carteira e os extremos aparecem
          sozinhos. As mesmas operações da tabela abaixo. */}
      {encerradas.length > 0 && (
        <Painel
          titulo="Como a rentabilidade se distribui"
          apoio="Quantas operações encerradas caem em cada faixa de rentabilidade total."
        >
          <Histograma faixas={faixas} />
        </Painel>
      )}

      <Painel
        titulo="Operações encerradas"
        apoio="Ordenadas da maior para a menor rentabilidade. A primeira linha é a melhor operação da carteira e a última é a pior."
        acao={
          <div className="flex flex-wrap items-center gap-2">
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
      >
        {visao === 'extremos' && (
          <div className="px-5 pb-3">
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
          <div className="border-t border-borda">
            <Table dense className={TABELA_NO_PAINEL}>
              <THead>
                <tr>
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
                </tr>
              </THead>
              <TBody>
                {lista.map((o) => {
                  const extremo = extremos.has(o.ref)
                  return (
                    // A LINHA DO EXTREMO VEM TINGIDA (o `tr.extremo` da amostra),
                    // além do selo na última coluna: na lista inteira, o olho acha
                    // as marcadas sem ler a coluna.
                    <TR key={o.ref} className={cn(extremo && 'bg-aviso-fundo/55')}>
                      <TD>
                        <ProcessoOuRef cnj={o.numeroCnj ? formatCNJ(o.numeroCnj) : null} refInterna={o.ref} />
                      </TD>
                      <TD>{o.tribunal ?? '—'}</TD>
                      <TD className="whitespace-nowrap tabular-nums">{formatDate(o.dataAquisicao)}</TD>
                      <TD className="whitespace-nowrap tabular-nums">{formatDate(o.dataLiquidacao)}</TD>
                      <TD className="whitespace-nowrap text-right tabular-nums">{brl(o.capitalInvestido)}</TD>
                      <TD className="whitespace-nowrap text-right tabular-nums">{brl(o.jaRecebido)}</TD>
                      <TD className={cn('whitespace-nowrap text-right tabular-nums', (o.ganho ?? 0) < 0 && 'font-bold text-perigo')}>
                        {brl(o.ganho)}
                      </TD>
                      <TD className={cn('whitespace-nowrap text-right tabular-nums', (o.retorno ?? 0) < 0 && 'font-bold text-perigo')}>
                        {pct(o.retorno)}
                      </TD>
                      <TD className="whitespace-nowrap text-right tabular-nums">{dias(o.prazoDias)}</TD>
                      <TD className="whitespace-nowrap text-right tabular-nums">
                        <span className="inline-flex items-center gap-1.5">
                          {pct(o.tirAnual, 0)}
                          {extremo && (
                            <span
                              title={EXPLICA.extremos}
                              className="inline-flex h-[22px] items-center gap-1 rounded-full border border-aviso-borda bg-aviso-fundo px-2 text-xs font-semibold text-aviso"
                            >
                              <AlertTriangle className="h-[13px] w-[13px]" aria-hidden />
                              extremo
                            </span>
                          )}
                        </span>
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          </div>
        )}
      </Painel>
    </div>
  )
}
