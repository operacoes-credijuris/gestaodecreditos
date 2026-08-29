// Quadro Econômico — Recortes da carteira.
//
// Tribunal, ente devedor e investidor. Três recortes, três abas, uma tabela só.
//
// Toda linha responde as três perguntas de dinheiro na ordem em que se pensa
// nelas: quanto já foi investido, quanto já voltou, quanto ainda falta voltar.
// Os totais são sobre TODAS as operações do grupo — a pergunta "quanto esse
// investidor já colocou" não tem nada a ver com elegibilidade para cálculo de
// performance. As colunas de rentabilidade, essas sim, são só das encerradas,
// e o selo de amostra ao lado diz sobre quantas.

import { useState } from 'react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Tabs } from '@/components/ui/Tabs'
import { Table, THead, TH, TBody, TR, TD, EmptyState, ErrorState } from '@/components/ui/Table'
import {
  usePainel, CarregandoPainel, Ressalva, SeloAmostra, Explicacao,
  pct, brl, dias, EXPLICA,
} from './compartilhado'
import type { ResumoGrupo } from '@/lib/analytics'

type Aba = 'tribunal' | 'ente' | 'investidor'

/**
 * Nome próprio legível.
 *
 * A chave do grupo de investidor vem de `normalizarNome`, que é chave primária
 * de investidor_dados e portanto intocável. O `rotulo` traz a grafia original
 * com acento; aqui só se acerta a caixa. Partículas ficam minúsculas, como se
 * escreve em português — "Ercílio Martins da Costa Junior", não "Da Costa".
 */
const PARTICULAS = new Set([
  'de', 'da', 'do', 'das', 'dos', 'e', 'em', 'no', 'na', 'a', 'o', 'di', 'du', 'del', 'la',
])

function nomeProprio(s: string): string {
  const t = s.trim()
  if (!t) return t
  // Já vem com caixa mista de propósito (ex.: sigla de tribunal): não mexer.
  if (t !== t.toLowerCase() && t !== t.toUpperCase()) return t
  return t
    .toLowerCase()
    .split(/\s+/)
    .map((p, i) => {
      if (i > 0 && PARTICULAS.has(p)) return p
      // Preserva parênteses de rótulos como "(sem investidor)".
      const m = /^([(]*)(.*?)([)]*)$/.exec(p)
      if (!m) return p
      const [, abre, meio, fecha] = m
      return abre + (meio ? meio.charAt(0).toUpperCase() + meio.slice(1) : '') + fecha
    })
    .join(' ')
}

export default function Recortes() {
  const { painel, carregando, erro } = usePainel()
  const [aba, setAba] = useState<Aba>('tribunal')

  if (carregando) return <CarregandoPainel />
  if (erro || !painel) return <ErrorState message="Não foi possível carregar a carteira." />

  const grupos: Record<Aba, ResumoGrupo[]> = {
    tribunal: painel.porTribunal,
    ente: painel.porEnte,
    investidor: painel.porInvestidor,
  }
  const contexto: Record<Aba, string> = {
    tribunal: 'tribunal',
    ente: 'ente devedor',
    investidor: 'investidor',
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Recortes"
        description="Quanto cada grupo já recebeu de investimento, quanto já devolveu e quanto ainda deve."
      />

      <Tabs
        value={aba}
        onChange={(v) => setAba(v as Aba)}
        items={[
          { key: 'tribunal', label: 'Tribunal' },
          { key: 'ente', label: 'Ente devedor' },
          { key: 'investidor', label: 'Investidor' },
        ]}
      />

      <TabelaGrupos
        grupos={grupos[aba]}
        contexto={contexto[aba]}
        concentracao={aba === 'tribunal' ? painel.concentracao : null}
      />
    </div>
  )
}

function TabelaGrupos({
  grupos, contexto, concentracao,
}: {
  grupos: ResumoGrupo[]
  contexto: string
  concentracao: { maior: string; fracaoOperacoes: number; fracaoCapital: number; concentrada: boolean } | null
}) {
  return (
    <div className="space-y-4">
      {concentracao?.concentrada && (
        <Ressalva>
          <strong>{pct(concentracao.fracaoOperacoes)}</strong> das operações e{' '}
          <strong>{pct(concentracao.fracaoCapital)}</strong> do capital estão em{' '}
          <strong>{nomeProprio(concentracao.maior)}</strong>.
        </Ressalva>
      )}

      <Card>
        <CardHeader
          title={`Por ${contexto}`}
          description="Ordenado por número de operações."
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
                <TH className="text-right">
                  <Explicacao texto="Tudo que já foi investido no grupo, em qualquer status: liquidadas, em complementar e em aberto.">
                    Já investiu
                  </Explicacao>
                </TH>
                <TH className="text-right">
                  <Explicacao texto="Tudo que já entrou de fato, somando todas as operações do grupo.">
                    Já recebeu
                  </Explicacao>
                </TH>
                <TH className="text-right">
                  <Explicacao texto="Valor projetado das operações em aberto mais os complementares a receber.">
                    Falta receber
                  </Explicacao>
                </TH>
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
                    <TD className="font-medium text-slate-800">{nomeProprio(g.rotulo)}</TD>
                    <TD className="text-right tabular-nums">{g.total}</TD>
                    <TD className="text-right tabular-nums">{g.n}</TD>
                    <TD className="text-right tabular-nums">{brl(g.capitalTotal)}</TD>
                    <TD className="text-right tabular-nums">{brl(g.recebidoTotal)}</TD>
                    <TD className="text-right tabular-nums">{brl(g.aReceber)}</TD>
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
        </CardBody>
      </Card>
    </div>
  )
}
