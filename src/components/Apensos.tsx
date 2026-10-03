import { useMemo, useRef, useState, type FormEvent } from 'react'
import { Plus, Pencil, Trash2, ChevronDown, ChevronRight } from 'lucide-react'
import { apensosCrud } from '@/lib/queries'
import { invokeFunction } from '@/lib/functions'
import type { Apenso } from '@/lib/types'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { Field, Input } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { Drawer } from '@/components/ui/Drawer'
import { DrawerHistorico } from '@/components/Movimentacoes'
import { CabecalhoDaFicha, SecaoDaFicha } from '@/components/operacional/Pecas'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import { formatCNJ, vazioNull } from '@/lib/format'

type ParentField = 'processo_id' | 'requerimento_id'

/**
 * Gerencia os apensos (incidentes, recursos etc.) atrelados a um principal
 * (crédito ou requerimento). Retorna helpers para embutir na tabela:
 * - actions(parentId): botões de expandir + adicionar (antes de editar/excluir)
 * - detailRow(parentId, colSpan): linha expansível com a lista de apensos
 * - modals(): modal de formulário + confirmação de exclusão (renderizar 1x)
 */
export function useApensosManager(parentField: ParentField) {
  const { data } = apensosCrud.useList()
  const create = apensosCrud.useCreate()
  const update = apensosCrud.useUpdate()
  const remove = apensosCrud.useRemove()
  const toast = useToast()

  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [editing, setEditing] = useState<Partial<Apenso> | null>(null)
  const [toDelete, setToDelete] = useState<Apenso | null>(null)
  // Apenso com a ficha aberta (painel lateral). O apenso é um processo por
  // direito próprio — tem os próprios autos e as próprias movimentações; o
  // vínculo com o principal é a única coisa que o distingue de um crédito.
  const [ficha, setFicha] = useState<Apenso | null>(null)
  // Erros de validação por campo, exibidos inline nos <Field>.
  const [erros, setErros] = useState<Record<string, string>>({})
  // Snapshot do formulário ao abrir — base do cálculo de "dirty".
  const snapshotRef = useRef('')
  const dirty = !!editing && JSON.stringify(editing) !== snapshotRef.current

  // Abre o formulário limpando erros e registrando o snapshot do estado inicial.
  function abrirForm(a: Partial<Apenso>) {
    setErros({})
    snapshotRef.current = JSON.stringify(a)
    setEditing(a)
  }

  const porPai = useMemo(() => {
    const m = new Map<string, Apenso[]>()
    for (const a of data ?? []) {
      const pid = a[parentField]
      if (!pid) continue
      const arr = m.get(pid) ?? []
      arr.push(a)
      m.set(pid, arr)
    }
    return m
  }, [data, parentField])

  function toggle(id: string) {
    setExpanded((e) => ({ ...e, [id]: !e[id] }))
  }

  function openNew(parentId: string) {
    const base: Partial<Apenso> = {
      numero: '',
      classe_processual: '',
      tribunal: '',
      comarca: '',
      vara: '',
      polo_ativo: '',
      polo_passivo: '',
    }
    base[parentField] = parentId
    abrirForm(base)
    setExpanded((e) => ({ ...e, [parentId]: true }))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!editing) return
    if (!editing.numero?.trim()) {
      // Validação inline: erro aparece junto ao campo, sem toast.
      setErros({ numero: 'Informe o número do apenso' })
      return
    }
    try {
      const payload: Partial<Apenso> = {
        numero: vazioNull(editing.numero),
        classe_processual: vazioNull(editing.classe_processual),
        tribunal: vazioNull(editing.tribunal),
        comarca: vazioNull(editing.comarca),
        vara: vazioNull(editing.vara),
        polo_ativo: vazioNull(editing.polo_ativo),
        polo_passivo: vazioNull(editing.polo_passivo),
      }
      payload[parentField] = editing[parentField] ?? null
      if (editing.id) {
        await update.mutateAsync({ id: editing.id, changes: payload })
        toast.success('Apenso atualizado.')
        // NÃO CADASTRE NA ADVBOX AQUI — mesma regra dos créditos e dos
        // requerimentos, por decisão do dono: escrita em sistema externo acontece na
        // CRIAÇÃO, nunca na edição. Havia um gatilho de edição aqui e foi retirado.
      } else {
        const criado = await create.mutateAsync(payload)
        toast.success('Apenso adicionado.')
        // FORA do await do salvamento: o cadastro na ADVBOX é consequência, não
        // condição. ADVBOX fora do ar não impede o apenso de existir aqui.
        if (criado?.id) void cadastrarNaAdvbox(criado.id)
      }
      setEditing(null)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  /**
   * Cadastra o apenso na ADVBOX, com a mesma configuração dos créditos.
   *
   * POR QUE APENSO IMPORTA AQUI: agravo, embargo e incidente têm CNJ e andamento
   * PRÓPRIOS. A sincronização de movimentações já procurava pelos números dos
   * apensos, mas só acha o que existe na ADVBOX — e apenso nunca era cadastrado lá.
   * A plataforma estava preparada para trazer esse andamento e não trazia, porque
   * faltava a outra ponta.
   */
  async function cadastrarNaAdvbox(apensoId: string) {
    try {
      const r = await invokeFunction<{
        ok?: boolean
        motivo?: string
        criado?: boolean
        detalhe?: string
        aviso?: string
      }>('advbox-processos', { action: 'criar', apenso_id: apensoId })

      if (r.ok && r.criado) toast.success('Apenso cadastrado na ADVBOX.')
      else if (r.motivo === 'incompleto')
        toast.error(
          'Cadastro automático na ADVBOX está ligado, mas falta escolher o responsável em Configurações.',
        )
      // A edição nunca escreve na ADVBOX (ver o salvar acima): o aviso não pode
      // prometer que preencher o número depois cadastra.
      else if (r.motivo === 'sem_numero')
        toast.info('Sem número, não cadastrei na ADVBOX. Preencher depois não cadastra: faça na ADVBOX, à mão.')
      else if (r.aviso) toast.error(r.aviso)
    } catch (err) {
      toast.error(`Apenso salvo, mas não cadastrei na ADVBOX: ${(err as Error).message}`)
    }
  }

  async function confirmDelete() {
    if (!toDelete) return
    try {
      await remove.mutateAsync(toDelete.id)
      toast.success('Apenso excluído.')
      setToDelete(null)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  /**
   * Contador de apensos: só o número e a seta, para ficar ao lado do número do
   * processo. O rótulo "Apensos" saiu porque a posição já diz o que é — o
   * contador pertence ao processo, não à coluna de ações.
   * Devolve null quando não há apenso: contador zerado seria ruído em toda linha.
   */
  function contador(parentId: string) {
    const count = porPai.get(parentId)?.length ?? 0
    if (count === 0) return null
    const aberto = !!expanded[parentId]
    return (
      <button
        type="button"
        onClick={(e) => {
          // A linha inteira abre a ficha; o contador não deve disparar isso.
          e.stopPropagation()
          toggle(parentId)
        }}
        aria-expanded={aberto}
        aria-label={`${count} apenso${count > 1 ? 's' : ''} — ${aberto ? 'ocultar' : 'ver'}`}
        title={`${count} apenso${count > 1 ? 's' : ''}`}
        // A pílula neutra da amostra (`.pill-btn`), com os 24px de alvo: é o
        // único jeito de abrir a lista de apensos na tabela.
        className="inline-flex min-h-[24px] shrink-0 items-center gap-0.5 rounded-full bg-superficie-3 px-2 text-xs font-semibold text-texto-2 ring-1 ring-inset ring-borda transition-colors hover:text-marca-texto focus:outline-none focus-visible:ring-2 focus-visible:ring-anel"
      >
        <span className="tabular-nums">{count}</span>
        <ChevronDown
          className={cn('h-3 w-3 transition-transform', aberto && 'rotate-180')}
          aria-hidden="true"
        />
      </button>
    )
  }

  function actions(parentId: string) {
    return (
      <IconButton
        label="Adicionar apenso"
        icon={<Plus className="h-4 w-4" />}
        onClick={() => openNew(parentId)}
      />
    )
  }

  /**
   * Os apensos de um pai, em cartões com as ações de cada um (abrir, editar,
   * excluir) e o "Adicionar apenso" SEMPRE À VISTA — na linha aberta da tabela e
   * dentro das fichas (item "Novo" da amostra). Antes, o botão só aparecia com a
   * lista vazia, e a ficha só listava: para mexer num apenso era preciso fechar a
   * ficha e achar a linha.
   */
  function cartoes(parentId: string, vazio: string) {
    const apensos = porPai.get(parentId) ?? []
    return (
      <div className="space-y-2">
        {apensos.length === 0 ? (
          <p className="text-corpo text-texto-2">{vazio}</p>
        ) : (
          apensos.map((a) => (
            // Clique abre a ficha do apenso, como nas linhas de Créditos. O cartão
            // não é um botão (tem botões dentro); pelo teclado, a ficha abre pelo
            // último botão, o da seta.
            <div
              key={a.id}
              onClick={() => setFicha(a)}
              className="flex cursor-pointer items-center gap-3 rounded-campo border border-borda bg-superficie px-3 py-2.5 text-corpo transition-colors hover:border-marca-viva"
              title="Abrir ficha do apenso"
            >
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="text-texto">
                  <span className="font-semibold tabular-nums">{formatCNJ(a.numero)}</span>
                  {a.classe_processual && (
                    <span className="text-texto-2"> · {a.classe_processual}</span>
                  )}
                </div>
                <div className="text-xs text-texto-2">
                  {[a.tribunal, a.comarca, a.vara].filter(Boolean).join(' · ') || '—'}
                </div>
                <div className="text-xs text-texto-2">
                  Polo ativo: {a.polo_ativo || '—'} · Polo passivo: {a.polo_passivo || '—'}
                </div>
              </div>
              {/* stopPropagation: os botões não devem abrir a ficha. */}
              <div
                className="flex shrink-0 items-center gap-0.5"
                onClick={(e) => e.stopPropagation()}
              >
                <IconButton
                  label="Editar apenso"
                  icon={<Pencil className="h-4 w-4" />}
                  onClick={() => abrirForm(a)}
                />
                <IconButton
                  label="Excluir apenso"
                  variant="danger"
                  icon={<Trash2 className="h-4 w-4" />}
                  onClick={() => setToDelete(a)}
                />
                <IconButton
                  label={`Abrir ficha do apenso ${formatCNJ(a.numero)}`}
                  icon={<ChevronRight className="h-4 w-4" />}
                  onClick={() => setFicha(a)}
                />
              </div>
            </div>
          ))
        )}
        <Button
          size="sm"
          variant="secondary"
          icon={<Plus className="h-4 w-4" />}
          onClick={() => openNew(parentId)}
        >
          Adicionar apenso
        </Button>
      </div>
    )
  }

  function detailRow(parentId: string, colSpan: number) {
    if (!expanded[parentId]) return null
    return (
      <tr className="bg-superficie-2">
        <td colSpan={colSpan} className="px-4 py-3">
          <div className="font-display mb-2 text-xs font-bold uppercase tracking-wider text-texto-3">
            Apensos
          </div>
          {cartoes(parentId, 'Nenhum apenso vinculado a este registro.')}
        </td>
      </tr>
    )
  }

  /** Os apensos dentro da ficha do crédito ou do requerimento, com as ações. */
  function listaNaFicha(parentId: string) {
    return cartoes(parentId, 'Nenhum apenso vinculado.')
  }

  function modals() {
    return (
      <>
        <Modal
          open={!!editing}
          onClose={() => setEditing(null)}
          title={editing?.id ? 'Editar apenso' : 'Novo apenso'}
          description={
            editing?.id
              ? undefined
              : 'Processo ligado a este registro — embargos, impugnação, cumprimento de sentença.'
          }
          size="lg"
          dirty={dirty}
          footer={
            <>
              <Button
                variant="outline"
                onClick={() => {
                  // Botão próprio não passa pela confirmação do Modal — checa dirty aqui.
                  if (dirty && !window.confirm('Descartar alterações não salvas?')) return
                  setEditing(null)
                }}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                form="form-apenso"
                loading={create.isPending || update.isPending}
              >
                {/* O botão diz o que faz (a amostra): adicionar é criar — e é
                    na criação que o apenso vai para a ADVBOX. */}
                {editing?.id ? 'Salvar alterações' : 'Adicionar apenso'}
              </Button>
            </>
          }
        >
          {editing && (
            <form id="form-apenso" onSubmit={handleSubmit} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                {/* "Número do processo": o apenso tem CNJ próprio, e é por ele que a
                    ADVBOX busca o andamento dele. O rótulo curto não dizia de que
                    número se tratava. */}
                <Field label="Número do processo" required error={erros.numero}>
                  <Input
                    placeholder="0000000-00.0000.0.00.0000"
                    value={editing.numero ?? ''}
                    onChange={(e) => {
                      setEditing({ ...editing, numero: e.target.value })
                      // Digitar no campo limpa o erro de validação dele.
                      if (erros.numero) setErros({})
                    }}
                  />
                </Field>
                <Field label="Classe processual">
                  <Input
                    placeholder="Ex.: Embargos à execução"
                    value={editing.classe_processual ?? ''}
                    onChange={(e) =>
                      setEditing({ ...editing, classe_processual: e.target.value })
                    }
                  />
                </Field>
                <Field label="Tribunal">
                  <Input
                    value={editing.tribunal ?? ''}
                    onChange={(e) => setEditing({ ...editing, tribunal: e.target.value })}
                  />
                </Field>
                <Field label="Comarca">
                  <Input
                    value={editing.comarca ?? ''}
                    onChange={(e) => setEditing({ ...editing, comarca: e.target.value })}
                  />
                </Field>
                {/* "Órgão" e não "Vara": o apenso corre em turma, câmara, gabinete ou
                    relatoria — chamar isso de vara está errado na maioria dos casos.
                    A COLUNA do banco continua `vara`: renomeá-la exigiria migração e
                    tocaria a ficha e a sincronização, sem ganho nenhum. */}
                <Field label="Órgão" className="sm:col-span-2">
                  <Input
                    placeholder="Ex.: 2ª Turma, 13ª Vara do Trabalho"
                    value={editing.vara ?? ''}
                    onChange={(e) => setEditing({ ...editing, vara: e.target.value })}
                  />
                </Field>
                {/* Os dois polos LADO A LADO: são um par, e um par lido em duas linhas
                    de largura inteira gasta altura sem ganhar leitura — os nomes das
                    partes raramente ocupam meia tela. Sobra uma linha no formulário. */}
                <Field label="Polo ativo">
                  <Input
                    value={editing.polo_ativo ?? ''}
                    onChange={(e) =>
                      setEditing({ ...editing, polo_ativo: e.target.value })
                    }
                  />
                </Field>
                <Field label="Polo passivo">
                  <Input
                    value={editing.polo_passivo ?? ''}
                    onChange={(e) =>
                      setEditing({ ...editing, polo_passivo: e.target.value })
                    }
                  />
                </Field>
              </div>
            </form>
          )}
        </Modal>

        <ConfirmDialog
          open={!!toDelete}
          danger
          loading={remove.isPending}
          title="Excluir apenso"
          message={`Excluir o apenso ${toDelete?.numero || ''}?`}
          confirmLabel="Excluir"
          onConfirm={confirmDelete}
          onClose={() => setToDelete(null)}
        />

        {/* Ficha do apenso — mesmo padrão da ficha de Créditos, com as
            movimentações SÓ dele (autos próprios). */}
        <Drawer
          open={!!ficha}
          onClose={() => setFicha(null)}
          title={
            ficha && (
              <CabecalhoDaFicha
                etiqueta={`Apenso vinculado a ${
                  parentField === 'processo_id' ? 'um crédito' : 'um requerimento'
                }`}
                titulo={formatCNJ(ficha.numero || '')}
                apoio={ficha.classe_processual || undefined}
              />
            )
          }
          footer={
            ficha && (
              <Button
                icon={<Pencil className="h-4 w-4" />}
                onClick={() => {
                  setFicha(null)
                  abrirForm(ficha)
                }}
              >
                Editar
              </Button>
            )
          }
        >
          {ficha && (
            <div className="space-y-6">
              {/* "Órgão", igual ao formulário: rótulo diferente para o mesmo campo
                  entre a ficha e o cadastro faz parecer que são dois dados. */}
              <SecaoDaFicha
                titulo="Processo"
                pares={[
                  ['Tribunal', ficha.tribunal],
                  ['Comarca', ficha.comarca],
                  ['Órgão', ficha.vara],
                  ['Classe processual', ficha.classe_processual],
                ]}
              />
              <SecaoDaFicha
                titulo="Partes"
                pares={[
                  ['Polo ativo', ficha.polo_ativo],
                  ['Polo passivo', ficha.polo_passivo],
                ]}
              />

              {/* Aqui o apenso é o principal dos próprios autos. */}
              <DrawerHistorico numero={ficha.numero} />
            </div>
          )}
        </Drawer>
      </>
    )
  }

  /**
   * Quantos apensos pendem de um pai. Exposto porque a exclusão do CRÉDITO
   * apaga os apensos em cascata no banco (FK on delete cascade), e a confirmação
   * precisa dizer isso — apenso é cadastrado à mão, com número, classe, tribunal
   * e polos, e some sem aviso junto com o pai.
   */
  const contagem = (parentId: string) => porPai.get(parentId)?.length ?? 0

  return { contador, contagem, actions, detailRow, listaNaFicha, modals }
}
