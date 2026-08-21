// Configuração das etapas de um funil: quais colunas do Kommo aparecem na tela
// e em qual grupo.
//
// POR QUE ISTO É UMA TELA E NÃO CÓDIGO. O funil de Precatórios no Kommo atende
// duas coisas diferentes, então a maioria das colunas não é de quem está
// olhando. A divisão poderia estar escrita em src/lib/kommo.ts — e foi
// exatamente por estar escrita lá que a aba de Precatórios não existia: os
// números das colunas eram constantes coladas no código. Coluna nova, coluna
// renomeada, equipe que muda de ideia: nada disso deveria virar pedido de
// deploy.
//
// AS COLUNAS NÃO SÃO DIGITADAS AQUI. Elas vêm de public.kommo_etapa, que o
// kommo-sync espelha do próprio Kommo (migration 0044). Quem configura escolhe
// entre o que EXISTE — não tem como escrever o número de uma coluna errada.
//
// E "OCULTAR" NÃO É "APAGAR". Card em coluna oculta continua alcançável na
// pílula "Outras etapas" da tela. Ocultar tira do caminho de quem opera; não
// tira o crédito da existência. Um crédito que desaparece da tela é o pior
// defeito possível aqui, porque ausência de card não chama atenção.
import { useEffect, useMemo, useRef, useState } from 'react'
import { EyeOff, FolderPlus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Field, Input, Select } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'
import type { EtapaKommo, EtapaVisao } from '@/lib/kommo'

/**
 * Valor do <option> que representa "não mostrar". Não é nome de grupo.
 *
 * VISÍVEL E EM ASCII de propósito. A primeira versão usava um espaço à esquerda
 * (' oculta') para o sentinela nunca colidir com nome de grupo de verdade. Duas
 * coisas deram errado: um byte NUL entrou no lugar do espaço, e a string continuou
 * sintaticamente válida em TypeScript — o tsc passou aqui e o arquivo QUEBROU no
 * caminho, porque caractere invisível não sobrevive a copiar e colar no editor do
 * GitHub. O sentinela não ganha nada por ser invisível, e perde tudo.
 */
const OCULTA = '__OCULTA__'

export function EtapasDoFunil({
  pipelineId,
  etapas,
  visoes,
  open,
  onClose,
  onSalvo,
}: {
  pipelineId: number
  /** Colunas deste funil, já em ordem de kanban. */
  etapas: EtapaKommo[]
  visoes: EtapaVisao[]
  open: boolean
  onClose: () => void
  onSalvo: () => void
}) {
  const toast = useToast()
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [mexeu, setMexeu] = useState(false)

  // status_id -> nome do grupo, ou OCULTA, ou '' (ainda não classificada).
  const [escolha, setEscolha] = useState<Record<number, string>>({})
  const [novoGrupo, setNovoGrupo] = useState('')
  const [criados, setCriados] = useState<string[]>([])

  const doFunil = useMemo(
    () => etapas.filter((e) => e.pipeline_id === pipelineId),
    [etapas, pipelineId],
  )

  // SÓ NA ABERTURA, e o ref é o que garante isso.
  //
  // O defeito que isto conserta: `visoes` e `etapas` chegam como `x.data ?? []`,
  // então o array é NOVO a cada render do componente pai. Com eles nas
  // dependências, qualquer re-render do pai — digitar na busca, o sync mudar de
  // estado — refazia o efeito e ZERAVA as escolhas que a pessoa acabou de fazer,
  // no meio do preenchimento.
  const iniciado = useRef(false)
  useEffect(() => {
    if (!open) {
      iniciado.current = false
      return
    }
    if (iniciado.current) return
    iniciado.current = true
    const conf = new Map(
      visoes.filter((v) => v.pipeline_id === pipelineId).map((v) => [v.status_id, v.grupo]),
    )
    const inicial: Record<number, string> = {}
    for (const e of doFunil) {
      // Sem linha na tabela = não classificada, e fica em branco de propósito: o
      // <select> mostra "— escolha —" e o botão de salvar cobra. Chutar um grupo
      // aqui gravaria decisão que ninguém tomou.
      if (!conf.has(e.status_id)) inicial[e.status_id] = ''
      else inicial[e.status_id] = conf.get(e.status_id) ?? OCULTA
    }
    setEscolha(inicial)
    setCriados([])
    setNovoGrupo('')
    setMexeu(false)
    setErro(null)
  }, [open, pipelineId, doFunil, visoes])

  /** Grupos oferecidos no <select>: os que já existem + os criados agora. */
  const grupos = useMemo(() => {
    const s = new Set<string>()
    for (const v of visoes) if (v.pipeline_id === pipelineId && v.grupo) s.add(v.grupo)
    for (const g of Object.values(escolha)) if (g && g !== OCULTA) s.add(g)
    for (const g of criados) s.add(g)
    return [...s].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [visoes, pipelineId, escolha, criados])

  const semEscolher = doFunil.filter((e) => !escolha[e.status_id])
  const porGrupo = useMemo(() => {
    const m = new Map<string, number>()
    for (const g of Object.values(escolha)) {
      if (g && g !== OCULTA) m.set(g, (m.get(g) ?? 0) + 1)
    }
    return m
  }, [escolha])

  function criarGrupo() {
    const nome = novoGrupo.trim()
    if (!nome) return
    if (nome === OCULTA) return
    if (!grupos.includes(nome)) setCriados((c) => [...c, nome])
    setNovoGrupo('')
    setMexeu(true)
  }

  async function salvar() {
    setSalvando(true)
    setErro(null)
    try {
      const { data: sessao } = await supabase.auth.getUser()
      const autor = sessao?.user?.id ?? null

      const linhas = doFunil
        // Coluna deixada em branco NÃO é gravada. Gravar em branco criaria linha
        // com grupo nulo, que significa "oculta de propósito" — registraria
        // decisão que ninguém tomou, e a tela pararia de avisar sobre ela.
        .filter((e) => !!escolha[e.status_id])
        .map((e) => ({
          pipeline_id: pipelineId,
          status_id: e.status_id,
          grupo: escolha[e.status_id] === OCULTA ? null : escolha[e.status_id],
          definido_por: autor,
        }))

      if (linhas.length === 0) {
        throw new Error(
          'Nenhuma coluna classificada. Escolha o grupo de pelo menos uma — ' +
            'enquanto não houver nenhuma, a tela segue mostrando todas.',
        )
      }

      const { error } = await supabase
        .from('etapa_visao')
        .upsert(linhas, { onConflict: 'pipeline_id,status_id' })
      if (error) throw new Error(error.message)

      // Coluna que voltou para "— escolha —" perde a linha: volta a ser não
      // classificada e a tela volta a avisar sobre ela. É o desfazer honesto.
      const gravados = linhas.map((l) => l.status_id)
      const aRemover = doFunil
        .filter((e) => !gravados.includes(e.status_id))
        .map((e) => e.status_id)
      if (aRemover.length > 0) {
        const { error: e2 } = await supabase
          .from('etapa_visao')
          .delete()
          .eq('pipeline_id', pipelineId)
          .in('status_id', aRemover)
        if (e2) throw new Error(e2.message)
      }

      toast.success(
        `${linhas.length} coluna(s) classificada(s) em ${porGrupo.size} grupo(s).`,
      )
      onSalvo()
      onClose()
    } catch (e) {
      setErro((e as Error)?.message ?? String(e))
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      dirty={mexeu}
      title="Etapas que aparecem na tela"
      description="As colunas vêm do seu funil no Kommo. Escolha em qual grupo cada uma aparece — ou oculte as que o operacional não usa."
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={salvar} loading={salvando}>
            Salvar
          </Button>
        </div>
      }
    >
      {erro && (
        <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 ring-1 ring-inset ring-red-200">
          {erro}
        </div>
      )}

      {doFunil.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">
          Ainda não sei as colunas deste funil. Clique em <strong>Sincronizar</strong>,
          no alto da página, e abra isto de novo.
        </p>
      ) : (
        <div className="space-y-4">
          {/* ---------------- criar grupo ---------------- */}
          <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-inset ring-slate-200">
            <Field
              label="Criar um grupo"
              hint="Use a palavra que a equipe usa. Ex.: Comercial, Operacional, Jurídico."
            >
              <div className="flex gap-2">
                <Input
                  value={novoGrupo}
                  onChange={(e) => setNovoGrupo(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      criarGrupo()
                    }
                  }}
                  placeholder="Nome do grupo"
                />
                <Button
                  variant="outline"
                  onClick={criarGrupo}
                  disabled={!novoGrupo.trim()}
                  icon={<FolderPlus className="h-4 w-4" />}
                >
                  Criar
                </Button>
              </div>
            </Field>
            {grupos.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {grupos.map((g) => (
                  <Badge key={g} size="sm" tone={porGrupo.get(g) ? 'blue' : 'gray'}>
                    {g} · {porGrupo.get(g) ?? 0}
                  </Badge>
                ))}
              </div>
            )}
            {grupos.length === 0 && (
              <p className="mt-2 text-xs text-slate-600">
                Crie o primeiro grupo acima para poder classificar as colunas.
              </p>
            )}
          </div>

          {/* ---------------- as colunas ---------------- */}
          <div className="overflow-hidden rounded-lg ring-1 ring-inset ring-slate-200">
            {doFunil.map((e) => {
              const v = escolha[e.status_id] ?? ''
              return (
                <div
                  key={e.status_id}
                  className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-3 last:border-b-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-800">
                      {e.nome}
                    </div>
                    <div className="text-xs text-slate-500">
                      coluna {e.status_id}
                      {e.tipo === 1 && ' · entrada de leads'}
                      {!v && ' · ainda não classificada'}
                    </div>
                  </div>
                  <div className="w-full sm:w-64">
                    <Select
                      value={v}
                      onChange={(ev) => {
                        setMexeu(true)
                        setEscolha((p) => ({ ...p, [e.status_id]: ev.target.value }))
                      }}
                    >
                      <option value="">— escolha —</option>
                      {grupos.map((g) => (
                        <option key={g} value={g}>
                          {g}
                        </option>
                      ))}
                      <option value={OCULTA}>Não mostrar</option>
                    </Select>
                  </div>
                </div>
              )
            })}
          </div>

          {semEscolher.length > 0 && (
            <p className="text-xs text-amber-800">
              {semEscolher.length} coluna(s) sem grupo escolhido. Elas não vão sumir: os
              cards delas aparecem em <strong>&quot;Outras etapas&quot;</strong> na tela,
              e a tela continua avisando que ninguém as classificou.
            </p>
          )}

          <p className="flex items-start gap-2 text-xs text-slate-600">
            <EyeOff className="mt-0.5 h-3.5 w-3.5 flex-none" />
            <span>
              <strong>Não mostrar</strong> tira a coluna das pílulas, mas os cards dela
              continuam alcançáveis em &quot;Outras etapas&quot;. Nada de crédito
              desaparece da tela — só sai do caminho.
            </span>
          </p>
        </div>
      )}
    </Modal>
  )
}
