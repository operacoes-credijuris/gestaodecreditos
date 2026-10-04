import { Fragment, useMemo, useRef, useState, type FormEvent } from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { requerimentosCrud, useUltimaMovimentacao } from '@/lib/queries'
import { invokeFunction } from '@/lib/functions'
import { useApensosManager } from '@/components/Apensos'
import type { Requerimento } from '@/lib/types'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Field, Input, Textarea } from '@/components/ui/Field'
import {
  CabecalhoDaFicha,
  CampoDeBusca,
  CartaoNoCelular,
  FerramentasDoPainel,
  ListaNoCelular,
  Partes,
  SecaoDaFicha,
  TituloDaSecao,
} from '@/components/operacional/Pecas'
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
  SemResultado,
} from '@/components/ui/Table'
import { AcoesDaLinha, type AcaoDoMenu } from '@/components/ui/MenuDeAcoes'
import { SortableTH } from '@/components/ui/SortableTH'
import { Drawer } from '@/components/ui/Drawer'
import { DrawerHistorico } from '@/components/Movimentacoes'
import { BotaoCopiar } from '@/components/BotaoCopiar'
import { useToast } from '@/components/ui/Toast'
import { formatDate, onlyDigits, vazioNull } from '@/lib/format'
import { casaBusca } from '@/lib/buscaDaTela'
import { perguntarDescarte } from '@/lib/descarte'
import { LEMBRAR, useEscolhaLembrada } from '@/lib/lembrarNaTela'

const SENTIDOS = ['asc', 'desc'] as const

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
// Protocolo (com a classe) | Tribunal/órgão | Matéria | Data | Últ. movimentação | Ações
const N_COLUNAS = 6

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
  const qc = useQueryClient()
  const apensos = useApensosManager('requerimento_id')

  const [busca, setBusca] = useState('')
  // Ordenação padrão: data de protocolo, do mais antigo para o mais novo. O
  // sentido escolhido fica lembrado entre visitas (lib/lembrarNaTela.ts).
  const [sortDir, setSortDir] = useEscolhaLembrada(LEMBRAR.requerimentosSentido, SENTIDOS, 'asc')
  const [editing, setEditing] = useState<Partial<Requerimento> | null>(null)
  const [toDelete, setToDelete] = useState<Requerimento | null>(null)
  // Requerimento com a ficha aberta no painel lateral (clique na linha).
  const [detalhe, setDetalhe] = useState<Requerimento | null>(null)
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
  async function fecharForm() {
    if (dirty && !(await perguntarDescarte())) return
    setEditing(null)
  }

  function toggleSort() {
    setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
  }

  const lista = useMemo(() => {
    let l = data ?? []
    if (busca.trim()) {
      // Sem acento e também por dígito (lib/buscaDaTela.ts): "goiania" acha
      // "Goiânia", e o protocolo colado cru acha o formatado. As partes entram
      // por serem o que identifica a linha: quem procura um requerimento costuma
      // lembrar do nome, não do protocolo.
      l = l.filter((r) =>
        casaBusca(
          [
            r.numero_protocolo,
            r.orgao,
            r.tribunal_entidade,
            r.requerente,
            r.requerido,
            r.materia,
            r.classe_processual,
            r.observacoes,
          ],
          busca,
        ),
      )
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
        // NÃO CADASTRE NA ADVBOX AQUI — vale para os três cadastros (crédito,
        // requerimento e apenso), por decisão do dono: escrita em sistema externo
        // acontece na CRIAÇÃO, nunca na edição. Houve um gatilho de edição aqui, para
        // pegar o requerimento que ganha CNJ ao ser distribuído; foi retirado.
        //
        // Consequência conhecida e aceita: requerimento cadastrado por protocolo que
        // depois vira judicial não passa a ser monitorado sozinho — isso se resolve
        // na ADVBOX, à mão.
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
      // tem número. Mas preencher depois NÃO cadastra — a edição nunca escreve na
      // ADVBOX (ver handleSalvar) —, e o aviso não pode prometer o contrário.
      else if (r.motivo === 'sem_numero')
        toast.info('Sem número, não cadastrei na ADVBOX. Preencher depois não cadastra: faça na ADVBOX, à mão.')
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
      // A exclusão cascateia no banco para os apensos (0009_apensos.sql), e o
      // makeCrud só invalida a própria tabela — mesmo cuidado de Créditos. Sem
      // isto, os apensos do requerimento apagado seguiam no cache: em Tarefas, a
      // tarefa do número de um deles ainda se resolvia como apenso, e Contatos
      // seguia listando o órgão dele, até recarregar.
      await qc.invalidateQueries({ queryKey: ['apensos'] })
      toast.success('Requerimento excluído.')
      setToDelete(null)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  /**
   * AS AÇÕES DA LINHA NO MENU "⋯" (auditoria visual, C4 e R1): as mesmas 4
   * ações de 12px de Créditos (+ ✎ 🗑 ›) viram o "›" que abre a ficha e o menu,
   * com o Excluir em vermelho, por último.
   */
  const acoesDoRequerimento = (r: Requerimento): AcaoDoMenu[] => [
    apensos.acaoAdicionar(r.id),
    { rotulo: 'Editar', icone: <Pencil aria-hidden="true" />, onSelecionar: () => abrirForm(r) },
    { rotulo: 'Excluir', icone: <Trash2 aria-hidden="true" />, perigo: true, onSelecionar: () => setToDelete(r) },
  ]

  /** A classe processual como selo pálido, ao lado do protocolo (R1). */
  const seloDaClasse = (r: Requerimento) =>
    r.classe_processual ? (
      <Badge tone="gray" className="max-w-[220px]">
        <span className="truncate" title={r.classe_processual}>
          {r.classe_processual}
        </span>
      </Badge>
    ) : null

  return (
    <div>
      <PageHeader
        title="Requerimentos administrativos"
        description="Pedidos feitos fora do processo — habilitações, preferências, retificações."
        actions={
          // No celular, o primário ocupa a largura (K2).
          <Button
            icon={<Plus className="h-[16px] w-[16px]" />}
            onClick={() => abrirForm({ ...VAZIO })}
            className="w-full sm:w-auto"
          >
            Novo requerimento
          </Button>
        }
      />

      {/* A BUSCA MORA NO CARTÃO DA LISTA (a amostra): é dela, e não da página. */}
      <Card>
        <FerramentasDoPainel>
          <CampoDeBusca
            valor={busca}
            onChange={setBusca}
            placeholder="Buscar por protocolo, parte ou órgão"
            title="Busca em: protocolo, órgão, tribunal, requerente, requerido, matéria, classe e observações"
          />
        </FerramentasDoPainel>
        {isLoading ? (
          <Loading label="Carregando requerimentos…" />
        ) : isError ? (
          <ErrorState message={(error as Error)?.message} onRetry={() => refetch()} />
        ) : lista.length === 0 ? (
          // VAZIO DA BUSCA É OUTRO VAZIO (item "Novo" da amostra): com requerimentos
          // cadastrados, "Cadastre o primeiro requerimento" afirmaria que a base
          // está vazia. A saída oferecida é limpar a busca, não cadastrar de novo.
          // Sem resultado é uma linha simples (§0.10), sem a moldura do vazio.
          busca.trim() && (data ?? []).length > 0 ? (
            <SemResultado
              texto={`Nenhum requerimento corresponde a "${busca.trim()}".`}
              rotuloLimpar="Limpar busca"
              onLimpar={() => setBusca('')}
            />
          ) : (
            <EmptyState
              title="Nenhum requerimento"
              description="Cadastre o primeiro requerimento."
              action={
                <Button icon={<Plus className="h-[16px] w-[16px]" />} onClick={() => abrirForm({ ...VAZIO })}>
                  Novo requerimento
                </Button>
              }
            />
          )
        ) : (
          <>
          {/* No celular, cartões (K1): o protocolo, as partes e o órgão. */}
          <ListaNoCelular rotulo="Requerimentos">
            {lista.map((r) => (
              <CartaoNoCelular
                key={r.id}
                titulo={<span className="tabular-nums">{r.numero_protocolo || '—'}</span>}
                linhas={[
                  <Partes a={r.requerente} b={r.requerido} />,
                  [r.tribunal_entidade, r.orgao, r.classe_processual].filter(Boolean).join(' · '),
                ]}
                onAbrir={() => setDetalhe(r)}
                rotuloAbrir={`Abrir ficha de ${r.numero_protocolo ?? 'requerimento'}`}
                rotuloDasAcoes={`Ações do requerimento ${r.numero_protocolo ?? ''}`}
                acoes={acoesDoRequerimento(r)}
              />
            ))}
          </ListaNoCelular>
          <div className="hidden md:block">
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
                {/* Sem largura declarada: o protocolo e o selo da classe numa linha
                    só ditam a largura (antes, 20% e o selo caindo para baixo). */}
                <TH>Protocolo</TH>
                {/* Tribunal e órgão saíram do subtítulo do protocolo para uma coluna
                    própria: são a JURISDIÇÃO do requerimento, não parte da
                    identificação dele. Sob o número ficam as partes, que é o que
                    identifica a linha — igual "cedente v. cessionário" em Créditos. */}
                {/* nowrap no único cabeçalho de duas palavras que poderia quebrar em
                    tela estreita. Os outros são palavra única. */}
                <TH className="w-[16%] whitespace-nowrap">Tribunal / órgão</TH>
                {/* A COLUNA "CLASSE" SAIU (auditoria visual, R1): só tinha dois
                    valores ("Processo SEI" ou "Requerimento administrativo") e
                    forçava duas linhas por requerimento. A classe virou um selo
                    pálido ao lado do protocolo. */}
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
                {/* A coluna das ações tem largura fixa (C4): o "⋯" e o "›". */}
                <TH className="w-[72px] whitespace-nowrap text-right">Ações</TH>
              </tr>
            </THead>
            <TBody>
              {lista.map((r) => (
                <Fragment key={r.id}>
                <TR onClick={() => setDetalhe(r)}>
                  {/* Sem nowrap na célula: o número não quebra, mas os nomes das
                      partes podem. */}
                  <TD className="font-medium text-texto">
                    <span className="inline-flex items-center gap-s1.5 whitespace-nowrap">
                      <span className="font-semibold tabular-nums">
                        {r.numero_protocolo || '—'}
                      </span>
                      {seloDaClasse(r)}
                      {/* Mesmo padrão de Créditos: o contador de apensos fica
                          colado no número, não na coluna de ações. */}
                      {apensos.contador(r.id)}
                    </span>
                    {/* As PARTES sob o número, como em Créditos. É o que identifica
                        a linha: protocolo sozinho não diz de quem é o requerimento.
                        O travessão de cada lado aparece mesmo vazio, para a falta
                        ficar à vista de quem cadastrou pela metade. */}
                    <div className="mt-s0.5 text-xs font-normal text-texto-2">
                      <Partes a={r.requerente} b={r.requerido} />
                    </div>
                  </TD>
                  {/* Tribunal em cima, na cor do corpo; órgão embaixo, menor e mais
                      claro — a mesma hierarquia de devedora/comarca em Créditos. */}
                  <TD>
                    <div>{r.tribunal_entidade || '—'}</div>
                    <div className="text-xs text-texto-2">{r.orgao || '—'}</div>
                  </TD>
                  <TD>{r.materia || '—'}</TD>
                  {/* tabular-nums como em todas as outras colunas de data da
                      plataforma: sem ele os dígitos têm largura variável e a
                      coluna fica com as datas desalinhadas entre si. */}
                  <TD curto className="tabular-nums text-texto-2">
                    {formatDate(r.data_protocolo)}
                  </TD>
                  {/* Do cache do ADVBOX, como em Créditos — a mesma consulta e o
                      mesmo mapa, então as duas telas nunca discordam da data. O
                      requerimento entra nesse cache porque a sincronização casa
                      também pelo número de protocolo. Enquanto o mapa carrega,
                      mostra vazio em vez de "—", que afirmaria não haver
                      movimentação. */}
                  <TD curto className="tabular-nums text-texto-2">
                    {ultimaMov.isLoading
                      ? ''
                      : formatDate(
                          ultimaMov.data?.get(onlyDigits(r.numero_protocolo)) ?? null,
                        )}
                  </TD>
                  {/* O "›" é botão de verdade: sem ele a ficha só abria com o
                      mouse, clicando na linha. Os botões não deixam o clique
                      chegar à linha. */}
                  <TD className="w-[72px]">
                        {/* -3px: o centro dos botões de 28px na altura da primeira
                            linha de texto, e não abaixo dela. */}
                        <div className="-my-[3px]">
                    <AcoesDaLinha
                      onAbrir={() => setDetalhe(r)}
                      rotuloAbrir={`Abrir ficha de ${r.numero_protocolo ?? 'requerimento'}`}
                      rotuloDasAcoes={`Ações do requerimento ${r.numero_protocolo ?? ''}`}
                      acoes={acoesDoRequerimento(r)}
                    />
                    </div>
                  </TD>
                </TR>
                {apensos.detailRow(r.id, N_COLUNAS)}
                </Fragment>
              ))}
            </TBody>
          </Table>
          </div>
          </>
        )}
      </Card>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Editar requerimento' : 'Novo requerimento'}
        description={
          editing?.id ? (
            <span className="tabular-nums">{editing.numero_protocolo}</span>
          ) : undefined
        }
        // Formulário: 640px (auditoria visual, C8).
        size="md"
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
              {/* O botão diz o que faz (a amostra): cadastrar é criar — e é na
                  criação que o requerimento vai para a ADVBOX. */}
              {editing?.id ? 'Salvar alterações' : 'Cadastrar requerimento'}
            </Button>
          </>
        }
      >
        {editing && (
          <form id="form-requerimento" onSubmit={handleSubmit} className="space-y-s4">
            <div className="grid gap-s4 sm:grid-cols-2">
              {/* "Número do processo", e não "de protocolo": o mesmo campo recebe as
                  duas coisas. Requerimento nasce com protocolo do órgão e, quando é
                  distribuído, passa a ter CNJ — e é o formato do que está aqui que
                  decide em qual campo da ADVBOX ele entra. O rótulo antigo sugeria
                  que CNJ não caberia. A coluna do banco continua numero_protocolo:
                  renomeá-la exigiria migração e tocaria busca, ordenação e a
                  sincronização, sem ganho nenhum. */}
              <Field
                label="Número do processo"
                required
                error={erros.numero_protocolo}
                className="sm:col-span-2"
              >
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
              {/* Onde tramita, e depois quem pede e contra quem (a ordem da amostra).
                  As partes juntas e nesta ordem: é como elas aparecem na listagem
                  ("requerente v. requerido") e como se lê um requerimento. */}
              <Field label="Órgão">
                <Input
                  placeholder="Ex.: Setor de Precatórios"
                  value={editing.orgao ?? ''}
                  onChange={(e) => setEditing({ ...editing, orgao: e.target.value })}
                />
              </Field>
              <Field label="Tribunal / entidade">
                <Input
                  value={editing.tribunal_entidade ?? ''}
                  onChange={(e) =>
                    setEditing({ ...editing, tribunal_entidade: e.target.value })
                  }
                />
              </Field>
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
              <Field label="Classe processual">
                <Input
                  placeholder="Ex.: Pedido de habilitação"
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
                placeholder="Ex.: protocolado presencialmente; resposta por e-mail."
                value={editing.observacoes ?? ''}
                onChange={(e) => setEditing({ ...editing, observacoes: e.target.value })}
              />
            </Field>
          </form>
        )}
      </Modal>

      {/* Ficha do requerimento — abre ao clicar na linha. Editar e excluir o
          requerimento ficam nos botões da própria linha; as ações dos apensos,
          aqui dentro. */}
      <Drawer
        open={!!detalhe}
        onClose={() => setDetalhe(null)}
        title={
          detalhe && (
            // Subtítulo com as PARTES, e não com tribunal · órgão: é o mesmo
            // cabeçalho da ficha de Créditos ("cedente v. cessionário"), e o
            // tribunal tem seção própria logo abaixo.
            <CabecalhoDaFicha
              etiqueta="Requerimento administrativo"
              titulo={detalhe.numero_protocolo || '—'}
              apoio={<Partes a={detalhe.requerente} b={detalhe.requerido} />}
              // Copiar o número, como na ficha do crédito: é o que se cola no
              // sistema do órgão.
              acao={
                detalhe.numero_protocolo ? (
                  <BotaoCopiar
                    valor={detalhe.numero_protocolo}
                    rotulo="Copiar o número do processo"
                    aviso="Número copiado."
                  />
                ) : null
              }
            />
          )
        }
      >
        {detalhe && (
          <div className="space-y-s5">
            {/* Partes numa seção própria, antes do resto — mesma ordem da ficha de
                Créditos, que abre por "Partes". Quem abre a ficha quer saber de quem
                é o requerimento antes de saber onde ele tramita. */}
            <SecaoDaFicha
              titulo="Partes"
              pares={[
                ['Requerente', detalhe.requerente],
                ['Requerido', detalhe.requerido],
              ]}
            />
            <SecaoDaFicha
              titulo="Requerimento"
              pares={[
                ['Órgão', detalhe.orgao],
                ['Tribunal / entidade', detalhe.tribunal_entidade],
                ['Classe processual', detalhe.classe_processual],
                ['Matéria', detalhe.materia],
                ['Data de protocolo', detalhe.data_protocolo ? formatDate(detalhe.data_protocolo) : null],
              ]}
            />

            {/* Só quando há: seção vazia na ficha é ruído. */}
            {detalhe.observacoes && (
              <section>
                <TituloDaSecao>Observações</TituloDaSecao>
                <p className="whitespace-pre-wrap break-words text-corpo text-texto">
                  {detalhe.observacoes}
                </p>
              </section>
            )}

            {/* OS APENSOS COM AS AÇÕES DELES (item "Novo" da amostra): abrir,
                editar, excluir e "Adicionar apenso" sem sair da ficha. */}
            <section>
              <TituloDaSecao>Apensos ({apensos.contagem(detalhe.id)})</TituloDaSecao>
              {apensos.listaNaFicha(detalhe.id)}
            </section>

            {/* Histórico integral do ADVBOX — SÓ do principal. Andamento de
                apenso fica na ficha do apenso (clique no card dele): autos
                próprios, sem mistura. */}
            <DrawerHistorico numero={detalhe.numero_protocolo} />
          </div>
        )}
      </Drawer>

      <ConfirmDialog
        open={!!toDelete}
        danger
        loading={remove.isPending}
        title="Excluir requerimento"
        // A CASCATA NA PERGUNTA, como em Créditos: o banco apaga os apensos junto
        // (0009_apensos.sql), e eles são cadastro manual. Sem o aviso, excluir um
        // requerimento para recadastrá-lo levava os apensos embora em silêncio.
        message={
          toDelete && apensos.contagem(toDelete.id) > 0
            ? `Excluir o requerimento ${toDelete.numero_protocolo || ''}? ${
                apensos.contagem(toDelete.id) === 1
                  ? 'O apenso vinculado será excluído também.'
                  : `Os ${apensos.contagem(toDelete.id)} apensos vinculados serão excluídos também.`
              }`
            : `Excluir o requerimento ${toDelete?.numero_protocolo || ''}?`
        }
        confirmLabel="Excluir"
        onConfirm={confirmDelete}
        onClose={() => setToDelete(null)}
      />

      {apensos.modals()}
    </div>
  )
}
