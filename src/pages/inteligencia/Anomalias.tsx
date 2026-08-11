// Inteligência Econômica — Revisão de dados.
//
// Deliberadamente NÃO se chama "Erros". Metade do que aparece aqui são sinais
// estatísticos, e um resultado atípico pode ser um evento econômico real.
//
// Nada é corrigido automaticamente. Com 95 operações, isto é uma lista de
// trabalho para uma pessoa percorrer, não um painel para admirar.

import { AlertTriangle, Info as InfoIcon } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { StatCard } from '@/components/ui/StatCard'
import { Badge } from '@/components/ui/Badge'
import { EmptyState, ErrorState } from '@/components/ui/Table'
import { usePainel, CarregandoPainel, Ressalva } from './compartilhado'

const TOM_GRAVIDADE = { alta: 'red', media: 'amber', baixa: 'gray' } as const
const ROTULO_GRAVIDADE = { alta: 'Alta', media: 'Média', baixa: 'Baixa' } as const

export default function Anomalias() {
  const { painel, carregando, erro } = usePainel()
  if (carregando) return <CarregandoPainel />
  if (erro || !painel) return <ErrorState message="Não foi possível carregar a carteira." />

  const { anomalias } = painel
  const impossibilidades = anomalias.achados.filter((a) => a.natureza === 'impossibilidade')
  const sinais = anomalias.achados.filter((a) => a.natureza === 'sinal')

  return (
    <div className="space-y-6">
      <PageHeader
        title="Revisão de dados"
        description="Inconsistências e sinais atípicos encontrados na carteira. Nenhum dado foi alterado."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Operações na lista"
          value={anomalias.operacoesComAchado}
          tone={anomalias.operacoesComAchado > 0 ? 'amber' : 'green'}
          hint={`De ${anomalias.totalOperacoes} operações na carteira.`}
        />
        <StatCard
          label="Contradições no dado"
          value={impossibilidades.length}
          tone={impossibilidades.length > 0 ? 'red' : 'green'}
          hint="O registro se contradiz — por exemplo, encerrado sem data de pagamento. Isso é erro."
        />
        <StatCard
          label="Sinais estatísticos"
          value={sinais.length}
          tone="slate"
          hint="O dado é atípico, mas pode estar certo. Requer olhar, não correção automática."
        />
      </div>

      <Ressalva>{anomalias.aviso}</Ressalva>

      {anomalias.achados.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState
              title="Nenhuma inconsistência encontrada"
              description="As verificações de contradição lógica e de valores atípicos não apontaram nada nesta carga."
            />
          </CardBody>
        </Card>
      ) : (
        <>
          {impossibilidades.length > 0 && (
            <Secao
              titulo="Contradições no dado"
              descricao="O registro se contradiz. Nesses casos, é erro de cadastro."
              icone={<AlertTriangle className="h-4 w-4 text-red-500" />}
              achados={impossibilidades}
            />
          )}
          {sinais.length > 0 && (
            <Secao
              titulo="Sinais estatísticos"
              descricao="Fora do padrão da carteira — o que não significa errado. Um resultado extremo pode ser um evento econômico real."
              icone={<InfoIcon className="h-4 w-4 text-slate-400" />}
              achados={sinais}
            />
          )}
        </>
      )}
    </div>
  )
}

function Secao({
  titulo, descricao, icone, achados,
}: {
  titulo: string
  descricao: string
  icone: React.ReactNode
  achados: { regra: string; gravidade: 'alta' | 'media' | 'baixa'; titulo: string; orientacao: string; refs: string[] }[]
}) {
  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            {icone}
            {titulo}
          </span>
        }
        description={descricao}
      />
      <CardBody>
        <ul className="space-y-4">
          {achados.map((a) => (
            <li key={a.regra} className="border-b border-slate-100 pb-4 last:border-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-slate-800">{a.titulo}</span>
                <Badge tone={TOM_GRAVIDADE[a.gravidade]} size="sm">
                  {ROTULO_GRAVIDADE[a.gravidade]}
                </Badge>
                <Badge tone="gray" size="sm">
                  {a.refs.length} {a.refs.length === 1 ? 'operação' : 'operações'}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-slate-600">{a.orientacao}</p>
              <p className="mt-2 font-mono text-xs text-slate-400">{a.refs.join(' · ')}</p>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  )
}
