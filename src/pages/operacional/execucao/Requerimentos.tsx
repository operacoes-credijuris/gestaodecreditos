import { Fragment, useMemo, useRef, useState, type FormEvent } from 'react'
import { Plus, Pencil, Trash2, Search, ChevronRight } from 'lucide-react'
import { requerimentosCrud, apensosCrud, useUltimaMovimentacao } from '@/lib/queries'
import { invokeFunction } from '@/lib/functions'
import { useApensosManager } from '@/components/Apensos'
import type { Requerimento } from '@/lib/types'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field, Input, Textarea } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import {
  Table,
  THead,
  TH,
  TBody,
  TR,
  TD,
  Loading,
  ErrorState,
  EmptyState,
} from '@/components/ui/Table'
import { IconButton } from '@/components/ui/IconButton'
import { SortableTH } from '@/components/ui/SortableTH'
import { Drawer, DrawerField, DrawerSection } from '@/components/ui/Drawer'
import { DrawerHistorico } from '@/components/Movimentacoes'
import { useToast } from '@/components/ui/Toast'
import {
  formatCNJ,
  formatDate,
  normalizarBusca,
  onlyDigits,
  vazioNull,
} from '@/lib/format'

const VAZIO: Partial<Requerimento> = {
  numero_protocolo: '',
  orgao: '',
  tribunal_entidade: '',
  requerente: '',
  requerido: '',
  materia: '',
  classe_processual: '',
  data_protocolo: '',
  observacoes: '',
}

// Total de colunas da tabela — usado no colSpan da linha de apensos. Atualizar ao
// adicionar/remover coluna, senão a linha expandida para antes do fim da tabela.
// Protocolo | Tribunal/órgão | Classe | Matéria | Data | Últ. movimentação | Ações
const N_COLUNAS = 7

export default function Requerimentos() {
  const { useList, useCreate, useUpdate, useRemove } = requerimentosCrud
  const { data, isLoading, isError, error, refetch } = useList()
  // Mesmo mapa que a tabela de Créditos usa, para as duas telas nunca discordarem
  // da data da última movimentação.
  const ultimaMov = useUltimaMovimentacao()
  const create = useCreate()
  const update = useUpdate()
  const remove = useRemove()
  const toast = useToast()
  const apensos = useApensosManager('requerimento_id')

  const [busca, setBusca] = useState('')
  // Ordenação padrão: data de protocolo, do mais antigo para o mais novo.
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [editing, setEditing] = useState<Partial<Requerimento> | null>(null)
  const [toDelete, setToDelete] = useState<Requerimento | null>(null)
  // Requerimento com a ficha aberta no painel lateral (clique na linha).
  const [detalhe, setDetalhe] = useState<Requerimento | null>(null)
  // Apensos do requerimento em detalhe (lista de leitura na ficha).
  const todosApensos = apensosCrud.useList()
  const apensosDoDetalhe = useMemo(
    () =>
      detalhe
        ? (todosApensos.data ?? []).filter((a) => a.requerimento_id === detalhe.id)
        : [],
    [todosApensos.data, detalhe],
  )
  // Erros de validação por campo (mensagens inline nos <Field>).
  const [erros, setErros] = useState<Record<string, string>>({})
  // Snapshot do formulário ao abrir — base do cálculo de dirty.
  const snapshotRef = useRef('')

  const dirty = !!editing && JSON.stringify(editing) !== snapshotRef.current

  // Abre o formulário zerando erros e registrando o snapshot inicial.
  function abrirForm(valores: Partial<Requerimento>) {
    snapshotRef.current = JSON.stringify(valores)
    setErros({})
    setEditing(valores)
  }

  // Fecha pelo botão "Cancelar" respeitando alterações pendentes (o Modal já
  // cobre X/overlay/Escape via prop dirty).
  function fecharForm() {
    if (dirty && !window.confirm('Descartar alterações não salvas?')) return
    setEditing(null)
  }

  function toggleSort() {
    setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
  }

  const lista = useMemo(() => {
    let l = data ?? []
    if (busca.trim()) {
      // Sem acento e também por dígito, como nas outras telas: "goiania" tem de
      // achar "Goiânia", e o protocolo colado cru tem de achar o formatado.
      const q = normalizarBusca(busca)
      const qd = onlyDigits(busca)
      l = l.filter((r) => {
        const texto = normalizarBusca(
          [
            r.numero_protocolo,
            r.orgao,
            r.tribunal_entidade,
            // As partes entram na busca por serem o que identifica a linha: quem
            // procura um requerimento costuma lembrar do nome, não do protocolo.
            r.requerente,
            r.requerido,
            r.materia,
            r.classe_processual,
            r.observacoes,
          ]
            .filter(Boolean)
            .join(' '),
        )
        if (texto.includes(q)) return true
        return qd.length >= 4 && onlyDigits(r.numero_protocolo).includes(qd)
      })
    }
    const dir = sortDir === 'asc' ? 1 : -1
    return [...l].sort((a, b) => {
      const av = a.data_protocolo || ''
      const bv = b.data_protocolo || ''
      if (!av && !bv) return 0
      if (!av) return 1 // datas vazias sempre por último
      if (!bv) return -1
      return av.localeCompare(bv) * dir
    })
  }, [data, busca, sortDir])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!editing) return
    // Validação inline por campo — toast fica só para erro de rede/backend.
    if (!editing.numero_protocolo?.trim()) {
      setErros({ numero_protocolo: 'Informe o número do processo ou do protocolo' })
      return
    }
    try {
      const payload = {
        numero_protocolo: vazioNull(editing.numero_protocolo),
        orgao: vazioNull(editing.orgao),
        tribunal_entidade: vazioNull(editing.tribunal_entidade),
        requerente: vazioNull(editing.requerente),
        requerido: vazioNull(editing.requerido),
        materia: vazioNull(editing.materia),
        classe_processual: vazioNull(editing.classe_processual),
        data_protocolo: vazioNull(editing.data_protocolo),
        observacoes: vazioNull(editing.observacoes),
      }
      if (editing.id) {
        await update.mutateAsync({ id: editing.id, changes: payload })
        toast.success('Requerimento atualizado.')
        // TAMBÉM NA EDIÇÃO, e não só na criação: requerimento nasce sem número e
        // ganha o dele depois. Só quando ainda não está vinculado e já existe
        // número — assim editar um requerimento já cadastrado, ou ainda sem número,
        // não gasta chamada.
        if (!editing.advbox_lawsuit_id && payload.numero_protocolo) {
          void cadastrarNaAdvbox(editing.id)
        }
      } else {
        const criado = await create.mutateAsync(payload)
        toast.success('Requerimento cadastrado.')
        // FORA do await do salvamento, como nos créditos: o cadastro na ADVBOX é
        // consequência, não condição. ADVBOX fora do ar não impede o requerimento
        // de existir aqui.
        if (criado?.id) void cadastrarNaAdvbox(criado.id)
      }
      setEditing(null)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  /**
   * Cadastra o requerimento na ADVBOX, com a mesma configuração dos créditos.
   *
   * Vai por PROTOCOL_NUMBER, e é a função que decide isso a partir do id: número de
   * requerimento é protocolo do órgão, não CNJ, e a ADVBOX valida process_number
   * contra as bases dos tribunais.
   *
   * O que isso NÃO traz: movimentação automática. Os robôs da ADVBOX se guiam pelo
   * CNJ. O ganho é o requerimento existir lá — com tarefas, responsável e histórico —
   * e passar a casar com a sincronização, que já procura pelos dois campos.
   */
  async function cadastrarNaAdvbox(requerimentoId: string) {
    try {
      const r = await invokeFunction<{
        ok?: boolean
        motivo?: string
        criado?: boolean
        detalhe?: string
        aviso?: string
      }>('advbox-processos', { action: 'criar', requerimento_id: requerimentoId })

      if (r.ok && r.criado) toast.success('Requerimento cadastrado na ADVBOX.')
      else if (r.motivo === 'incompleto')
        toast.error(
          'Cadastro automático na ADVBOX está ligado, mas falta escolher o responsável em Configurações.',
        )
      // sem_numero NÃO é falha: é o estado normal de um requerimento que ainda não
      // tem número. Ao preencher e salvar, o cadastro acontece sozinho.
      else if (r.motivo === 'sem_numero')
        toast.info('Sem número, não cadastrei na ADVBOX. Ao preencher e salvar, cadastro.')
      else if (r.aviso) toast.error(r.aviso)
    } catch (err) {
      toast.error(
        `Requerimento salvo, mas não cadastrei na ADVBOX: ${(err as Error).message}`,
      )
    }
  }

  async function confirmDelete() {
    if (!toDelete) return
    try {
      await remove.mutateAsync(toDelete.id)
      toast.success('Requerimento excluído.')
      setToDelete(null)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <div>
      <PageHeader
        title="Requerimentos administrativos"
        actions={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => abrirForm({ ...VAZIO })}>
            Novo requerimento
          </Button>
        }
      />

      <Card className="mb-4 p-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <Input
            className="pl-9"
            placeholder="Buscar por protocolo, órgão, matéria, classe processual…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
      </Card>

      <Card>
        {isLoading ? (
          <Loading />
        ) : isError ? (
          <ErrorState message={(error as Error)?.message} onRetry={() => refetch()} />
        ) : lista.length === 0 ? (
          <EmptyState
            title="Nenhum requerimento"
            description="Cadastre o primeiro requerimento."
            action={
              <Button icon={<Plus className="h-4 w-4" />} onClick={() => abrirForm({ ...VAZIO })}>
                Novo requerimento
              </Button>
            }
          />
        ) : (
          <Table dense>
            <THead>
              {/* Larguras explícitas: sem elas o layout automático dava quase
                  toda a tabela para Matéria e comprimia o protocolo. Data e
                  Ações usam w-[1%]+nowrap para encolher até o conteúdo. */}
              {/* LARGURAS: Matéria é a coluna SEM largura declarada, então ela fica
                  com o que sobrar — e é ela que tem o texto mais longo. Por isso as
                  outras foram apertadas até o mínimo que o conteúdo aceita.

                  As duas colunas de data têm w-[1%] e cabeçalho CURTO — e não
                  cabeçalho quebrado em duas linhas, que foi a primeira tentativa e
                  ficou pior: título em duas linhas engorda o cabeçalho da tabela
                  inteira e desalinha visualmente da coluna vizinha. "Últ. mov."
                  resolve as duas coisas de uma vez — cabe numa linha E é mais estreito
                  que a versão quebrada, porque a maior palavra da versão longa
                  ("MOVIMENTAÇÃO") já era mais larga do que o rótulo curto inteiro. */}
              <tr>
                <TH className="w-[20%]">Protocolo</TH>
                {/* Tribunal e órgão saíram do subtítulo do protocolo para uma coluna
                    própria: são a JURISDIÇÃO do requerimento, não parte da
                    identificação dele. Sob o número ficam as partes, que é o que
                    identifica a linha — igual "cedente v. cessionário" em Créditos. */}
                {/* nowrap no único cabeçalho de duas palavras que poderia quebrar em
                    tela estreita. Os outros são palavra única. */}
                <TH className="w-[13%] whitespace-nowrap">Tribunal / órgão</TH>
                <TH className="w-[12%]">Classe</TH>
                <TH>Matéria</TH>
                {/* "Protocolado", e não "Data de protocolo": metade da largura e a
                    mesma informação. Não virou só "Protocolo" para não repetir o nome
                    da primeira coluna, nem só "Data" porque a coluna vizinha também é
                    uma data. */}
                <SortableTH
                  label="Protocolado"
                  active
                  dir={sortDir}
                  onToggle={toggleSort}
                  className="w-[1%] whitespace-nowrap"
                />
                <TH className="w-[1%] whitespace-nowrap">Últ. mov.</TH>
                <TH className="w-[1%] whitespace-nowrap">Ações</TH>
              </tr>
            </THead>
            <TBody>
              {lista.map((r) => (
                <Fragment key={r.id}>
                <TR onClick={() => setDetalhe(r)}>
                  {/* Sem nowrap na célula: o número não quebra, mas os nomes das
                      partes podem. */}
                  <TD className="font-medium text-slate-800">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="whitespace-nowrap tabular-nums">
                        {r.numero_protocolo || '—'}
                      </span>
                      {/* Mesmo padrão de Créditos: o contador de apensos fica
                          colado no número, não na coluna de ações. */}
                      {apensos.contador(r.id)}
                    </span>
                    {/* As PARTES sob o número, como em Créditos. É o que identifica
                        a linha: protocolo sozinho não diz de quem é o requerimento.
                        O travessão de cada lado aparece mesmo vazio, para a falta
                        ficar à vista de quem cadastrou pela metade. */}
                    <div className="text-xs font-normal text-slate-600">
                      {r.requerente || '—'} v. {r.requerido || '—'}
                    </div>
                  </TD>
                  {/* Tribunal em cima, na cor do corpo; órgão embaixo, menor e mais
                      claro — a mesma hierarquia de devedora/comarca em Créditos. */}
                  <TD>
                    <div>{r.tribunal_entidade || '—'}</div>
                    <div className="text-xs text-slate-600">{r.orgao || '—'}</div>
                  </TD>
                  <TD>{r.classe_processual || '—'}</TD>
                  <TD>{r.materia || '—'}</TD>
                  {/* tabular-nums como em todas as outras colunas de data da
                      plataforma: sem ele os dígitos têm largura variável e a
                      coluna fica com as datas desalinhadas entre si. */}
                  <TD className="whitespace-nowrap tabular-nums text-slate-600">
                    {formatDate(r.data_protocolo)}
                  </TD>
                  {/* Do cache do ADVBOX, como em Créditos — a mesma consulta e o
                      mesmo mapa, então as duas telas nunca discordam da data. O
                      requerimento entra nesse cache porque a sincronização casa
                      também pelo número de protocolo. Enquanto o mapa carrega,
                      mostra vazio em vez de "—", que afirmaria não haver
                      movimentação. */}
                  <TD className="whitespace-nowrap tabular-nums text-slate-600">
                    {ultimaMov.isLoading
                      ? ''
                      : formatDate(
                          ultimaMov.data?.get(onlyDigits(r.numero_protocolo)) ?? null,
                        )}
                  </TD>
                  <TD>
                    {/* stopPropagation: os botões não devem abrir a ficha da linha */}
                    <div
                      className="flex items-center gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {apensos.actions(r.id)}
                      <IconButton
                        label="Editar"
                        icon={<Pencil className="h-4 w-4" />}
                        onClick={() => abrirForm(r)}
                      />
                      <IconButton
                        label="Excluir"
                        variant="danger"
                        icon={<Trash2 className="h-4 w-4" />}
                        onClick={() => setToDelete(r)}
                      />
                      {/* Botão de verdade, e não seta decorativa: sem ele a ficha
                          só abria com o mouse, clicando na linha. */}
                      <IconButton
                        label={`Abrir ficha de ${r.numero_protocolo ?? 'requerimento'}`}
                        icon={<ChevronRight className="h-4 w-4" />}
                        onClick={() => setDetalhe(r)}
                      />
                    </div>
                  </TD>
                </TR>
                {apensos.detailRow(r.id, N_COLUNAS)}
                </Fragment>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Editar requerimento' : 'Novo requerimento'}
        size="lg"
        dirty={dirty}
        footer={
          <>
            <Button variant="outline" onClick={fecharForm}>
              Cancelar
            </Button>
            <Button
              type="submit"
              form="form-requerimento"
              loading={create.isPending || update.isPending}
            >
              Salvar
            </Button>
          </>
        }
      >
        {editing && (
          <form id="form-requerimento" onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {/* "Número do processo", e não "de protocolo": o mesmo campo recebe as
                  duas coisas. Requerimento nasce com protocolo do órgão e, quando é
                  distribuído, passa a ter CNJ — e é o formato do que está aqui que
                  decide em qual campo da ADVBOX ele entra. O rótulo antigo sugeria
                  que CNJ não caberia. A coluna do banco continua numero_protocolo:
                  renomeá-la exigiria migração e tocaria busca, ordenação e a
                  sincronização, sem ganho nenhum. */}
              <Field label="Número do processo" required error={erros.numero_protocolo}>
                <Input
                  value={editing.numero_protocolo ?? ''}
                  placeholder="CNJ ou número de protocolo do órgão"
                  onChange={(e) => {
                    setEditing({ ...editing, numero_protocolo: e.target.value })
                    // Digitar no campo limpa o erro inline.
                    if (erros.numero_protocolo) setErros({})
                  }}
                />
              </Field>
              <Field label="Órgão">
                <Input
                  value={editing.orgao ?? ''}
                  onChange={(e) => setEditing({ ...editing, orgao: e.target.value })}
                />
              </Field>
              {/* As partes juntas e nesta ordem: é como elas aparecem na listagem
                  ("requerente v. requerido") e como se lê um requerimento. */}
              <Field label="Requerente">
                <Input
                  value={editing.requerente ?? ''}
                  onChange={(e) => setEditing({ ...editing, requerente: e.target.value })}
                />
              </Field>
              <Field label="Requerido">
                <Input
                  value={editing.requerido ?? ''}
                  onChange={(e) => setEditing({ ...editing, requerido: e.target.value })}
                />
              </Field>
              <Field label="Tribunal / Entidade">
                <Input
                  value={editing.tribunal_entidade ?? ''}
                  onChange={(e) =>
                    setEditing({ ...editing, tribunal_entidade: e.target.value })
                  }
                />
              </Field>
              <Field label="Classe processual">
                <Input
                  value={editing.classe_processual ?? ''}
                  onChange={(e) =>
                    setEditing({ ...editing, classe_processual: e.target.value })
                  }
                />
              </Field>
              <Field label="Matéria">
                <Input
                  value={editing.materia ?? ''}
                  onChange={(e) => setEditing({ ...editing, materia: e.target.value })}
                />
              </Field>
              <Field label="Data de protocolo">
                <Input
                  type="date"
                  value={editing.data_protocolo ?? ''}
                  onChange={(e) =>
                    setEditing({ ...editing, data_protocolo: e.target.value })
                  }
                />
              </Field>
            </div>
            <Field label="Observações">
              <Textarea
                rows={3}
                value={editing.observacoes ?? ''}
                onChange={(e) => setEditing({ ...editing, observacoes: e.target.value })}
              />
            </Field>
          </form>
        )}
      </Modal>

      {/* Ficha do requerimento — abre ao clicar na linha. Só leitura, como a
          de Créditos: as ações ficam nos botões da própria linha. */}
      <Drawer
        open={!!detalhe}
        onClose={() => setDetalhe(null)}
        title={
          detalhe && (
            <div className="min-w-0">
              <h2 className="text-base font-bold tracking-tight text-slate-800">
                {detalhe.numero_protocolo || '—'}
              </h2>
              {/* Subtítulo com as PARTES, e não com tribunal · órgão: é o mesmo
                  cabeçalho da ficha de Créditos ("cedente v. cessionário"), e o
                  tribunal agora tem seção própria logo abaixo. */}
              <p className="text-xs text-slate-600">
                {detalhe.requerente || '—'} v. {detalhe.requerido || '—'}
              </p>
            </div>
          )
        }
      >
        {detalhe && (
          <>
            {/* Partes numa seção própria, antes do resto — mesma ordem da ficha de
                Créditos, que abre por "Partes". Quem abre a ficha quer saber de quem
                é o requerimento antes de saber onde ele tramita. */}
            <DrawerSection title="Partes">
              <DrawerField label="Requerente">{detalhe.requerente || '—'}</DrawerField>
              <DrawerField label="Requerido">{detalhe.requerido || '—'}</DrawerField>
            </DrawerSection>

            <DrawerSection title="Requerimento">
              <DrawerField label="Órgão">{detalhe.orgao || '—'}</DrawerField>
              <DrawerField label="Tribunal / Entidade">
                {detalhe.tribunal_entidade || '—'}
              </DrawerField>
              <DrawerField label="Classe processual">
                {detalhe.classe_processual || '—'}
              </DrawerField>
              <DrawerField label="Matéria">{detalhe.materia || '—'}</DrawerField>
              <DrawerField label="Data de protocolo">
                {formatDate(detalhe.data_protocolo)}
              </DrawerField>
            </DrawerSection>

            {detalhe.observacoes && (
              <DrawerSection title="Observações">
                <p className="col-span-2 whitespace-pre-wrap break-words text-sm text-slate-800">
                  {detalhe.observacoes}
                </p>
              </DrawerSection>
            )}

            <DrawerSection title={`Apensos (${apensosDoDetalhe.length})`}>
              {apensosDoDetalhe.length === 0 ? (
                <p className="col-span-2 text-sm text-slate-600">
                  Nenhum apenso vinculado.
                </p>
              ) : (
                <div className="col-span-2 space-y-2">
                  {apensosDoDetalhe.map((a) => (
                    <div key={a.id} className="rounded-lg border border-slate-200 p-2.5">
                      <div className="text-sm font-medium text-slate-800">
                        {formatCNJ(a.numero)}
                      </div>
                      <div className="text-xs text-slate-600">
                        {[a.classe_processual, a.tribunal, a.comarca]
                          .filter(Boolean)
                          .join(' · ') || '—'}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </DrawerSection>

            {/* Histórico integral do ADVBOX — SÓ do principal. Andamento de
                apenso fica na ficha do apenso (clique no card dele): autos
                próprios, sem mistura. */}
            <DrawerHistorico numero={detalhe.numero_protocolo} />
          </>
        )}
      </Drawer>

      <ConfirmDialog
        open={!!toDelete}
        danger
        loading={remove.isPending}
        message={`Excluir o requerimento ${toDelete?.numero_protocolo || ''}?`}
        confirmLabel="Excluir"
        onConfirm={confirmDelete}
        onClose={() => setToDelete(null)}
      />

      {apensos.modals()}
    </div>
  )
}
