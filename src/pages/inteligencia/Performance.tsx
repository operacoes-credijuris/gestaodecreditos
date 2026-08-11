// Inteligência Econômica — Performance das operações encerradas.
//
// Uma regra visual manda nesta tela: a TIR NUNCA aparece sem o prazo ao lado.
// Uma taxa de 40.426% ao ano é correta para um crédito liquidado em 12 dias e
// desinformação sem o "12 dias" na mesma linha.

import { useState } from 'react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Segmented } from '@/components/ui/Segmented'
import { Badge } from '@/components/ui/Badge'
import { Table, THead, TH, TBody, TR, TD, EmptyState, ErrorState } from '@/components/ui/Table'
import { formatDate } from '@/lib/format'
import {
  usePainel, CarregandoPainel, Ressalva, LinhaMetrica, SeloAmostra, Explicacao,
  pct, brl, dias, EXPLICA,
} from './compartilhado'

type Visao = 'todas' | 'extremos'

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
        description="Somente operações encerradas de fato. As de realização parcial ficam fora — o resultado final delas ainda não é conhecido."
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Rentabilidade total" />
          <CardBody>
            <LinhaMetrica rotulo="Mediana" valor={pct(carteira.retorno.mediana)} explicacao={EXPLICA.mediana} destaque />
            <LinhaMetrica rotulo="Média" valor={pct(carteira.retorno.media)} explicacao={EXPLICA.media} />
            <LinhaMetrica rotulo="Ponderada pelo capital" valor={pct(carteira.retornoPonderado)} explicacao={EXPLICA.ponderada} destaque />
            <LinhaMetrica rotulo="p25 – p75" valor={`${pct(carteira.retorno.p25)} – ${pct(carteira.retorno.p75)}`} explicacao={EXPLICA.iqr} />
            <LinhaMetrica rotulo="Mínimo – máximo" valor={`${pct(carteira.retorno.minimo)} – ${pct(carteira.retorno.maximo)}`} />
            {carteira.retornoIC && (
              <LinhaMetrica
                rotulo="Intervalo de 95% da mediana"
                valor={`${pct(carteira.retornoIC.inferior)} – ${pct(carteira.retornoIC.superior)}`}
                explicacao={EXPLICA.ic}
              />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Rentabilidade anualizada" />
          <CardBody>
            <LinhaMetrica rotulo="Mediana" valor={pct(carteira.tir.mediana)} explicacao={EXPLICA.tir} destaque />
            <LinhaMetrica rotulo="Média" valor={pct(carteira.tir.media, 0)} explicacao={EXPLICA.media} />
            <LinhaMetrica rotulo="p25 – p75" valor={`${pct(carteira.tir.p25)} – ${pct(carteira.tir.p75)}`} />
            <LinhaMetrica rotulo="Máximo" valor={pct(carteira.tir.maximo, 0)} />
            <LinhaMetrica rotulo="Marcadas como extremo" valor={carteira.extremosTir.length} explicacao={EXPLICA.extremos} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Prazo" />
          <CardBody>
            <LinhaMetrica rotulo="Mediano" valor={dias(carteira.prazo.mediana)} destaque />
            <LinhaMetrica rotulo="Médio" valor={dias(carteira.prazo.media)} />
            <LinhaMetrica rotulo="p25 – p75" valor={`${dias(carteira.prazo.p25)} – ${dias(carteira.prazo.p75)}`} />
            <LinhaMetrica rotulo="Mínimo – máximo" valor={`${dias(carteira.prazo.minimo)} – ${dias(carteira.prazo.maximo)}`} />
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
          description="Ordenadas por rentabilidade total."
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
                  { key: 'extremos', label: 'Extremos', count: carteira.extremosTir.length },
                ]}
              />
            </div>
          }
        />
        <CardBody>
          {lista.length === 0 ? (
            <EmptyState
              title="Nenhuma operação encerrada"
              description="A performance realizada só considera operações com status encerrado e capital, valor recebido e datas preenchidos."
            />
          ) : (
            <Table dense>
              <THead>
                <TH>Ref.</TH>
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
                    <TD className="font-mono text-xs text-slate-500">{o.ref}</TD>
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
