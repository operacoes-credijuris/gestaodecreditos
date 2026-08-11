// Inteligência Econômica — Recortes da carteira.
//
// Tribunal, ente, investidor, faixa de valor e safra numa tela só, em abas.
// Não é economia de espaço: com a carteira atual nenhum desses recortes tem
// amostra que justifique tela própria, e espalhá-los sugeriria uma robustez
// que os dados não têm.
//
// Toda tabela mostra n, capital, participação e a classe de representatividade
// de cada grupo. Grupo sem base aparece — esconder seria pior —, mas com o
// selo vermelho e fora de qualquer ordenação por desempenho.

import { useState } from 'react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Tabs } from '@/components/ui/Tabs'
import { Badge } from '@/components/ui/Badge'
import { Table, THead, TH, TBody, TR, TD, EmptyState, ErrorState } from '@/components/ui/Table'
import {
  usePainel, CarregandoPainel, Ressalva, SeloAmostra, Explicacao,
  pct, brl, dias, EXPLICA,
} from './compartilhado'
import type { ResumoGrupo } from '@/lib/analytics'
import { portaoRanking } from '../../../supabase/functions/_shared/nucleo/amostra.ts'

type Aba = 'tribunal' | 'ente' | 'investidor' | 'faixa' | 'safra'

export default function Recortes() {
  const { painel, carregando, erro } = usePainel()
  const [aba, setAba] = useState<Aba>('tribunal')

  if (carregando) return <CarregandoPainel />
  if (erro || !painel) return <ErrorState message="Não foi possível carregar a carteira." />

  const grupos: Record<Exclude<Aba, 'safra'>, ResumoGrupo[]> = {
    tribunal: painel.porTribunal,
    ente: painel.porEnte,
    investidor: painel.porInvestidor,
    faixa: painel.faixas.grupos,
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Recortes"
        description="Cada grupo com o seu tamanho de amostra. Comparação só quando há base para ela."
      />

      <Tabs
        value={aba}
        onChange={(v) => setAba(v as Aba)}
        items={[
          { key: 'tribunal', label: 'Tribunal' },
          { key: 'ente', label: 'Ente devedor' },
          { key: 'investidor', label: 'Investidor' },
          { key: 'faixa', label: 'Faixa de valor' },
          { key: 'safra', label: 'Safra' },
        ]}
      />

      {aba === 'safra' ? (
        <Safras painel={painel} />
      ) : (
        <TabelaGrupos
          grupos={grupos[aba]}
          contexto={aba}
          concentracao={aba === 'tribunal' ? painel.concentracao : null}
          avisoFaixa={aba === 'faixa' && painel.faixas.homogenea ? painel.faixas.amplitude : null}
        />
      )}
    </div>
  )
}

function TabelaGrupos({
  grupos, contexto, concentracao, avisoFaixa,
}: {
  grupos: ResumoGrupo[]
  contexto: string
  concentracao: { maior: string; fracaoOperacoes: number; fracaoCapital: number; concentrada: boolean } | null
  avisoFaixa: number | null
}) {
  const ranking = portaoRanking(grupos, (g) => g.n)
  const semBase = grupos.filter((g) => !g.representatividade.permiteComparacao)

  return (
    <div className="space-y-4">
      {concentracao?.concentrada && (
        <Ressalva>
          <strong>{pct(concentracao.fracaoOperacoes)}</strong> das operações e{' '}
          <strong>{pct(concentracao.fracaoCapital)}</strong> do capital estão em{' '}
          <strong>{concentracao.maior}</strong>. Não há grupos a comparar: os números abaixo
          descrevem cada grupo isoladamente, e a diferença entre eles não é interpretável.
        </Ressalva>
      )}

      {avisoFaixa !== null && (
        <Ressalva>
          A razão entre o percentil 90 e o percentil 10 do capital investido é de apenas{' '}
          <strong>{avisoFaixa.toFixed(1).replace('.', ',')}×</strong>. A carteira é homogênea
          em tamanho de operação, então diferenças entre as faixas provavelmente refletem
          ruído, não comportamento distinto por porte.
        </Ressalva>
      )}

      {!ranking.rankingPossivel && (
        <Ressalva>{ranking.motivo}</Ressalva>
      )}

      <Card>
        <CardHeader
          title={`Por ${contexto}`}
          description="Ordenado por número de operações, nunca por desempenho — ordenar por retorno sugeriria um ranking que os dados não sustentam."
        />
        <CardBody>
          {grupos.length === 0 ? (
            <EmptyState title="Sem dados para este recorte" />
          ) : (
            <Table dense>
              <THead>
                <TH>Grupo</TH>
                <TH className="text-right">Operações</TH>
                <TH className="text-right">Encerradas</TH>
                <TH className="text-right">Capital</TH>
                <TH className="text-right">% do capital</TH>
                <TH className="text-right">
                  <Explicacao texto={EXPLICA.ponderada}>Retorno ponderado</Explicacao>
                </TH>
                <TH className="text-right">
                  <Explicacao texto={EXPLICA.mediana}>Mediana</Explicacao>
                </TH>
                <TH className="text-right">
                  <Explicacao texto={EXPLICA.tir}>Anualizada</Explicacao>
                </TH>
                <TH className="text-right">Prazo mediano</TH>
                <TH>
                  <Explicacao texto={EXPLICA.representatividade}>Amostra</Explicacao>
                </TH>
              </THead>
              <TBody>
                {grupos.map((g) => (
                  <TR key={g.nome}>
                    <TD className="font-medium text-slate-800">{g.nome}</TD>
                    <TD className="text-right tabular-nums">{g.total}</TD>
                    <TD className="text-right tabular-nums">{g.n}</TD>
                    <TD className="text-right tabular-nums">{brl(g.capitalInvestido)}</TD>
                    <TD className="text-right tabular-nums">{pct(g.pesoCapital)}</TD>
                    <TD className="text-right tabular-nums">{pct(g.retornoPonderado)}</TD>
                    <TD className="text-right tabular-nums">{pct(g.retorno.mediana)}</TD>
                    <TD className="text-right tabular-nums">{pct(g.tir.mediana)}</TD>
                    <TD className="text-right tabular-nums">{dias(g.prazo.mediana)}</TD>
                    <TD>
                      <SeloAmostra
                        n={g.n}
                        classe={g.representatividade.classe}
                        rotulo={g.representatividade.rotulo}
                        explicacao={g.representatividade.explicacao}
                        compacto
                      />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}

          {semBase.length > 0 && (
            <p className="mt-4 text-xs text-slate-500">
              <strong>{semBase.length}</strong>{' '}
              {semBase.length === 1 ? 'grupo tem' : 'grupos têm'} amostra abaixo do mínimo para
              comparação ({semBase.map((g) => `${g.nome}: ${g.n}`).join(', ')}). Os números
              continuam visíveis porque escondê-los seria pior, mas não sustentam conclusão
              sobre desempenho.
            </p>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

function Safras({ painel }: { painel: NonNullable<ReturnType<typeof usePainel>['painel']> }) {
  const { safras } = painel
  const teto = safras.tetoComparavel
  const idades = Array.from(new Set(
    safras.curvas.flatMap((c) => c.pontos.map((p) => p.idadeMeses)),
  )).filter((m) => m <= teto).sort((a, b) => a - b)

  return (
    <div className="space-y-4">
      <Ressalva>
        Safras não são comparadas por resultado final, e sim <strong>na mesma idade</strong>.
        Comparar uma safra madura com outra recém-formada favoreceria artificialmente a mais
        nova, onde só as operações rápidas tiveram tempo de encerrar. A tabela para em{' '}
        <strong>{teto} meses</strong>, que é a idade da safra mais nova.
        {safras.safrasFracasNoTeto.length > 0 && (
          <>
            {' '}Atenção: {safras.safrasFracasNoTeto.join(', ')} tem amostra insuficiente nessa
            idade — o sinal merece acompanhamento e não sustenta conclusão.
          </>
        )}
      </Ressalva>

      <Card>
        <CardHeader
          title="Maturidade de cada safra"
          description="Quanto de cada safra já encerrou. É o que torna a comparação direta enganosa."
        />
        <CardBody>
          <Table dense>
            <THead>
              <TH>Safra</TH>
              <TH className="text-right">Operações</TH>
              <TH className="text-right">Encerradas</TH>
              <TH className="text-right">Idade máxima</TH>
            </THead>
            <TBody>
              {safras.curvas.map((c) => (
                <TR key={c.safra}>
                  <TD className="font-medium text-slate-800">{c.safra}</TD>
                  <TD className="text-right tabular-nums">{c.totalOperacoes}</TD>
                  <TD className="text-right tabular-nums">{pct(c.taxaEncerramento)}</TD>
                  <TD className="text-right tabular-nums">{c.idadeMaxima} meses</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Curva de safra"
          description="Percentual do capital devolvido até cada idade, contando só as operações que já tiveram tempo de chegar lá."
        />
        <CardBody>
          {idades.length === 0 ? (
            <EmptyState title="Sem histórico suficiente para montar as curvas" />
          ) : (
            <Table dense>
              <THead>
                <TH>Idade</TH>
                {safras.curvas.map((c) => (
                  <TH key={c.safra} className="text-right">{c.safra}</TH>
                ))}
              </THead>
              <TBody>
                {idades.map((m) => (
                  <TR key={m}>
                    <TD className="font-medium text-slate-700">{m} meses</TD>
                    {safras.curvas.map((c) => {
                      const p = c.pontos.find((x) => x.idadeMeses === m)
                      return (
                        <TD key={c.safra} className="text-right tabular-nums">
                          {p ? (
                            <span className="inline-flex items-center gap-1.5">
                              {pct(p.fracaoDevolvida)}
                              <Badge tone={p.nDisponivel <= 5 ? 'red' : 'gray'} size="sm">
                                n={p.nDisponivel}
                              </Badge>
                            </span>
                          ) : '—'}
                        </TD>
                      )
                    })}
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
