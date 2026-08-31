// Quadro Econômico — Recortes da carteira.
//
// Tribunal, ente devedor e investidor. Três recortes, três abas, uma tabela só.
//
// Toda linha responde as três perguntas de dinheiro na ordem em que se pensa
// nelas: quanto capital está ali, quanto já voltou, quanto ainda falta voltar.
// Os totais são sobre TODAS as operações do grupo — a pergunta "quanto esse
// investidor já colocou" não tem nada a ver com elegibilidade para cálculo de
// performance. As colunas de rentabilidade, essas sim, são só das encerradas,
// e o selo de amostra ao lado diz sobre quantas.
//
// Os RÓTULOS dessas três colunas mudam conforme o recorte, porque a relação com
// o dinheiro é diferente em cada um: o investidor investe e recebe, o ente deve
// e paga, e o tribunal não faz nem uma coisa nem outra. Ver `COLUNAS`.

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
        description="Onde o capital está, quanto dele já voltou e quanto ainda falta voltar."
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
        colunas={COLUNAS[aba]}
        concentracao={aba === 'tribunal' ? painel.concentracao : null}
      />
    </div>
  )
}

/**
 * Os nomes das três colunas de dinheiro mudam com o recorte, e não é firula.
 *
 * Só o INVESTIDOR investe e recebe — ele é o dono do dinheiro. Tribunal e ente
 * devedor não investem coisa nenhuma: o capital apenas está aplicado em créditos
 * que tramitam naquele tribunal, ou que aquele ente deve. Escrever "já investiu"
 * na linha do TJGO afirma uma relação que não existe.
 *
 * Por isso o investidor fala na voz ativa e os outros dois na voz do dinheiro.
 * Exceção proposital: o ente devedor É quem paga, então "já pagou" descreve o
 * que de fato aconteceu e é mais claro que "já foi recebido".
 */
export const COLUNAS: Record<Aba, {
  investido: string
  recebido: string
  aReceber: string
  expInvestido: string
  expRecebido: string
  expAReceber: string
}> = {
  tribunal: {
    investido: 'Capital aplicado',
    recebido: 'Já retornou',
    aReceber: 'A receber',
    expInvestido:
      'Capital investido em créditos que tramitam neste tribunal, em qualquer ' +
      'status. O tribunal não recebe investimento — o dinheiro é dos investidores ' +
      'e está nos créditos; o tribunal é onde eles correm.',
    expRecebido: 'Quanto desse capital já voltou, somando tudo que foi pago nos créditos deste tribunal.',
    expAReceber: 'Valor projetado das operações em aberto mais os complementares a receber.',
  },
  ente: {
    investido: 'Capital aplicado',
    recebido: 'Já pagou',
    aReceber: 'Ainda deve',
    expInvestido:
      'Capital investido em créditos devidos por este ente, em qualquer status. ' +
      'O ente não recebe investimento — ele é o devedor.',
    expRecebido: 'Quanto este ente já pagou, somando todos os créditos dele na carteira.',
    expAReceber:
      'Valor projetado do que ainda falta este ente pagar: operações em aberto mais ' +
      'os complementares.',
  },
  investidor: {
    investido: 'Já investiu',
    recebido: 'Já recebeu',
    aReceber: 'Falta receber',
    expInvestido:
      'Tudo que este investidor já colocou, em qualquer status: liquidadas, em ' +
      'complementar e em aberto.',
    expRecebido: 'Tudo que já voltou para ele, somando todas as operações.',
    expAReceber: 'Valor projetado das operações em aberto mais os complementares a receber.',
  },
}

function TabelaGrupos({
  grupos, contexto, colunas, concentracao,
}: {
  grupos: ResumoGrupo[]
  contexto: string
  colunas: (typeof COLUNAS)[Aba]
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
                  <Explicacao texto={colunas.expInvestido}>{colunas.investido}</Explicacao>
                </TH>
                <TH className="text-right">
                  <Explicacao texto={colunas.expRecebido}>{colunas.recebido}</Explicacao>
                </TH>
                <TH className="text-right">
                  <Explicacao texto={colunas.expAReceber}>{colunas.aReceber}</Explicacao>
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
