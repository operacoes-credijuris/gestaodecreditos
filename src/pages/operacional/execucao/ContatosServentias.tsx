import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { lerPedidoDaBusca } from '@/lib/buscaGeral'
import { Plus, Pencil, Trash2, Copy, Phone, Mail, MessageCircle } from 'lucide-react'
import { apensosCrud, contatosCrud, processosCrud, requerimentosCrud } from '@/lib/queries'
import { cn } from '@/lib/cn'
import type { ContatoServentia } from '@/lib/types'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Field, Input, Select } from '@/components/ui/Field'
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
  Truncado,
} from '@/components/ui/Table'
import { AcoesDaLinha, type AcaoDoMenu } from '@/components/ui/MenuDeAcoes'
import { useToast } from '@/components/ui/Toast'
import {
  CampoDeBusca,
  CartaoNoCelular,
  FerramentasDoPainel,
  ListaNoCelular,
  SecaoDoFormulario,
} from '@/components/operacional/Pecas'
import { vazioNull } from '@/lib/format'
import { casaBusca } from '@/lib/buscaDaTela'
import { formatTelefone, telefoneIncompleto, waLink } from '@/lib/telefone'
import { perguntarDescarte } from '@/lib/descarte'

// Identificador do órgão julgador = "comarca / vara" (igual à aba Créditos).
function buildOrgao(comarca?: string | null, vara?: string | null): string {
  const c = (comarca ?? '').trim()
  const v = (vara ?? '').trim()
  if (c && v) return `${c} / ${v}`
  return c || v
}

// Exibição do órgão: "[vara] de [comarca]" (ex.: "11ª Vara Federal de Belo
// Horizonte").
//
// O `tipo` não é enfeite: para julgador, "comarca / vara" é formato que a própria
// plataforma monta, e inverter as partes produz o nome que se lê em petição. Para
// AUXILIAR o campo é texto livre, e a inversão estragava o que foi digitado —
// "Contadoria / Judicial" virava "Judicial de Contadoria". Sem o tipo a função
// não tinha como distinguir, e invertia os dois.
function formatOrgaoLabel(orgao: string, tipo?: OrgaoRow['tipo']): string {
  if (tipo === 'auxiliar') return orgao
  const parts = orgao.split(' / ')
  if (parts.length === 2) return `${parts[1]} de ${parts[0]}`
  return orgao
}

// Telefone (dígitos canônicos sem +55 e sem zero, máscara, completude, link do
// WhatsApp) mora em lib/telefone.ts, com teste.

interface OrgaoRow {
  key: string
  orgao: string
  tribunal: string
  tipo: 'julgador' | 'auxiliar'
  contato: ContatoServentia | null
}

// O TIPO DO ÓRGÃO COMO SELO PÁLIDO, COM O NOME ESCRITO (auditoria visual, CT2):
// antes era uma bolinha azul ou violeta, e a legenda acima da tabela só tinha
// cor — quem não distingue as duas, ou não achava a legenda, não sabia o tipo.
const SELO_TIPO: Record<OrgaoRow['tipo'], { tom: 'blue' | 'purple'; label: string }> = {
  julgador: { tom: 'blue', label: 'Julgador' },
  auxiliar: { tom: 'purple', label: 'Auxiliar' },
}

type TipoValor = 'telefone' | 'whatsapp' | 'email'

/**
 * Copia o contato com um clique (item "Novo" da amostra). Pela área de
 * transferência DE VERDADE; onde o navegador não deixa, o aviso diz como fazer à
 * mão — calar a falha deixaria a pessoa colar o que estava antes.
 */
function useCopiar() {
  const toast = useToast()
  return async (valor: string, tipo: TipoValor) => {
    try {
      await navigator.clipboard.writeText(valor)
      toast.success(tipo === 'email' ? 'E-mail copiado.' : 'Telefone copiado.')
    } catch {
      toast.error(
        'O navegador não liberou a área de transferência. Selecione o contato e copie com Ctrl+C.',
      )
    }
  }
}

/**
 * Um valor de contato numa célula da grade: o ícone do tipo, o valor e, no
 * telefone e no e-mail, o botão de copiar; no WhatsApp, o link que abre a
 * conversa.
 *
 * O BOTÃO DE COPIAR FICA SEMPRE NA MESMA COLUNA (auditoria visual, CT1): o valor
 * ocupa o espaço que sobra, e o botão de 28px encosta na ponta da célula. O
 * E-MAIL NUMA LINHA SÓ, cortado com "…" e inteiro na dica — quebrado no meio
 * ("1.juizado.especial…an@ / exemplo.invalid"), ele não se lia.
 */
function ValorDoContato({ value, tipo }: { value: string | null | undefined; tipo: TipoValor }) {
  const copiar = useCopiar()
  if (!value) return <span className="text-texto-3">—</span>
  const Icone = tipo === 'email' ? Mail : tipo === 'whatsapp' ? MessageCircle : Phone
  if (tipo === 'whatsapp') {
    return (
      <a
        href={waLink(value)}
        target="_blank"
        rel="noreferrer"
        className="inline-flex min-h-[28px] items-center gap-s1.5 whitespace-nowrap text-sucesso hover:underline"
        title="Abrir conversa no WhatsApp"
      >
        <Icone className="h-[16px] w-[16px] shrink-0" aria-hidden="true" />
        <span className="tabular-nums">{value}</span>
      </a>
    )
  }
  return (
    <span className="flex min-w-0 items-center gap-s1.5 text-texto">
      <Icone className="h-[16px] w-[16px] shrink-0 text-texto-3" aria-hidden="true" />
      {tipo === 'email' ? (
        <Truncado texto={value} max={9999} className="min-w-0 flex-1" />
      ) : (
        <span className="min-w-0 flex-1 whitespace-nowrap tabular-nums">{value}</span>
      )}
      <button
        type="button"
        onClick={() => void copiar(value, tipo)}
        aria-label={`Copiar ${value}`}
        title="Copiar"
        className="grid h-controle-sm w-controle-sm shrink-0 place-items-center rounded-controle text-texto-3 transition-colors hover:bg-superficie-3 hover:text-texto focus:outline-none focus-visible:ring-2 focus-visible:ring-anel"
      >
        <Copy className="h-[16px] w-[16px]" aria-hidden="true" />
      </button>
    </span>
  )
}

/**
 * A GRADE DOS CONTATOS DE UM ÓRGÃO (auditoria visual, CT1): uma linha por órgão,
 * com as sublinhas FIXAS "Serventia" e "Gabinete" e as três colunas (telefone,
 * WhatsApp, e-mail) lado a lado. Antes, "SERV." e "GAB." se empilhavam dentro de
 * cada coluna, e uma linha chegava a 140px. O mesmo molde no cabeçalho
 * (`GRADE_CONTATOS`), para os títulos ficarem sobre os valores.
 */
// O E-MAIL LEVA UMA FATIA MAIOR que o telefone e o WhatsApp, que têm sempre
// 14 ou 15 caracteres: com três frações iguais, sobrava espaço nos números e
// o e-mail era cortado logo no começo.
const GRADE_CONTATOS =
  'grid grid-cols-[88px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.6fr)] items-center gap-x-s3'

function SubLinha({
  rotulo,
  telefone,
  whatsapp,
  email,
}: {
  rotulo: string
  telefone?: string | null
  whatsapp?: string | null
  email?: string | null
}) {
  return (
    <div className={cn(GRADE_CONTATOS, 'min-h-[28px]')}>
      <span className="text-xs font-semibold text-texto-3">{rotulo}</span>
      <ValorDoContato value={telefone} tipo="telefone" />
      <ValorDoContato value={whatsapp} tipo="whatsapp" />
      <ValorDoContato value={email} tipo="email" />
    </div>
  )
}

/** Os contatos do órgão: as duas sublinhas do julgador, a única do auxiliar. */
function ContatosDoOrgao({ row }: { row: OrgaoRow }) {
  const c = row.contato
  const algum =
    !!c &&
    [
      c.serventia_telefone,
      c.serventia_whatsapp,
      c.serventia_email,
      c.gabinete_telefone,
      c.gabinete_whatsapp,
      c.gabinete_email,
    ].some(Boolean)
  // Órgão sem nenhum contato: uma linha só, e não duas sublinhas de traços.
  if (!algum) {
    return (
      <div className={cn(GRADE_CONTATOS, 'min-h-[28px]')}>
        <span aria-hidden="true" />
        <span className="col-span-3 text-texto-3">Nenhum contato cadastrado</span>
      </div>
    )
  }
  if (row.tipo === 'auxiliar') {
    // Auxiliar não tem separação serventia/gabinete: uma sublinha.
    return (
      <SubLinha
        rotulo="Contato"
        telefone={c?.serventia_telefone}
        whatsapp={c?.serventia_whatsapp}
        email={c?.serventia_email}
      />
    )
  }
  return (
    <div className="space-y-s1">
      <SubLinha
        rotulo="Serventia"
        telefone={c?.serventia_telefone}
        whatsapp={c?.serventia_whatsapp}
        email={c?.serventia_email}
      />
      <SubLinha
        rotulo="Gabinete"
        telefone={c?.gabinete_telefone}
        whatsapp={c?.gabinete_whatsapp}
        email={c?.gabinete_email}
      />
    </div>
  )
}

// Campos de texto do formulário que podem carregar erro de validação inline.
type CampoContato =
  | 'orgao'
  | 'tribunal'
  | 'serventia_telefone'
  | 'serventia_whatsapp'
  | 'gabinete_telefone'
  | 'gabinete_whatsapp'

// Telefones sujeitos à validação de completude (DDD + 8 ou 9 dígitos).
const CAMPOS_FONE = [
  'serventia_telefone',
  'serventia_whatsapp',
  'gabinete_telefone',
  'gabinete_whatsapp',
] as const

// Sem chaves gabinete_*: contato auxiliar não tem separação serventia/gabinete
// (o formulário nem renderiza esses campos e o submit os força a null).
const AUXILIAR_VAZIO: Partial<ContatoServentia> = {
  tipo: 'auxiliar',
  orgao: '',
  tribunal: '',
  serventia_telefone: '',
  serventia_whatsapp: '',
  serventia_email: '',
}

export default function ContatosServentias() {
  const contatos = contatosCrud.useList()
  const processos = processosCrud.useList()
  const requerimentos = requerimentosCrud.useList()
  const apensos = apensosCrud.useList()
  const create = contatosCrud.useCreate()
  const update = contatosCrud.useUpdate()
  const remove = contatosCrud.useRemove()
  const toast = useToast()

  const [busca, setBusca] = useState('')

  // VEIO DA BUSCA GERAL (Ctrl+K) com um contato escolhido: a lista já abre
  // filtrada pelo órgão dele. O pedido sai do histórico logo depois.
  const location = useLocation()
  const navigate = useNavigate()
  const { filtrarContatos } = lerPedidoDaBusca(location.state)
  useEffect(() => {
    if (!filtrarContatos) return
    setBusca(filtrarContatos)
    navigate(location.pathname, { replace: true, state: null })
  }, [filtrarContatos, navigate, location.pathname])
  // Filtro por tribunal — 'todos' mostra todos os órgãos.
  const [filtroTribunal, setFiltroTribunal] = useState('todos')
  const [editing, setEditing] = useState<Partial<ContatoServentia> | null>(null)
  const [toDelete, setToDelete] = useState<ContatoServentia | null>(null)
  // Erros de validação por campo (mensagens inline nos <Field>).
  const [erros, setErros] = useState<Record<string, string>>({})
  // Snapshot do formulário ao abrir — base do cálculo de dirty.
  const snapshotRef = useRef('')

  const dirty = !!editing && JSON.stringify(editing) !== snapshotRef.current

  // Abre o formulário zerando erros e registrando o snapshot inicial.
  function abrirForm(valores: Partial<ContatoServentia>) {
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

  // Atualiza um campo do formulário e limpa o erro inline correspondente.
  function alterarCampo(campo: CampoContato, valor: string) {
    setEditing((atual) => (atual ? { ...atual, [campo]: valor } : atual))
    setErros((prev) => {
      if (!(campo in prev)) return prev
      const proximos = { ...prev }
      delete proximos[campo]
      return proximos
    })
  }

  const isLoading =
    contatos.isLoading || processos.isLoading || requerimentos.isLoading || apensos.isLoading
  const isError =
    contatos.isError || processos.isError || requerimentos.isError || apensos.isError
  const error = (contatos.error ||
    processos.error ||
    requerimentos.error ||
    apensos.error) as Error | null

  // Base completa (sem busca/filtro) — alimenta a lista e as opções de tribunal.
  const todasLinhas = useMemo<OrgaoRow[]>(() => {
    // Separa contatos salvos: julgadores (por órgão) e auxiliares.
    const julgadorContatos = new Map<string, ContatoServentia>()
    const auxiliares: ContatoServentia[] = []
    for (const c of contatos.data ?? []) {
      if (c.tipo === 'auxiliar') auxiliares.push(c)
      else if (c.orgao) julgadorContatos.set(c.orgao, c)
    }

    // Julgadores: órgãos puxados de Créditos e Requerimentos.
    const julgMap = new Map<string, OrgaoRow>()
    const addJulgador = (orgao: string, tribunal: string) => {
      if (!orgao) return
      const ex = julgMap.get(orgao)
      if (ex) {
        if (!ex.tribunal && tribunal) ex.tribunal = tribunal
        return
      }
      julgMap.set(orgao, {
        key: `j:${orgao}`,
        orgao,
        tribunal,
        tipo: 'julgador',
        contato: julgadorContatos.get(orgao) ?? null,
      })
    }
    for (const p of processos.data ?? []) {
      addJulgador(buildOrgao(p.comarca, p.vara), (p.tribunal ?? '').trim())
    }
    for (const req of requerimentos.data ?? []) {
      addJulgador((req.orgao ?? '').trim(), (req.tribunal_entidade ?? '').trim())
    }
    // Apensos (de créditos e requerimentos) têm comarca/vara/tribunal próprios.
    for (const a of apensos.data ?? []) {
      addJulgador(buildOrgao(a.comarca, a.vara), (a.tribunal ?? '').trim())
    }
    // Julgadores são SEMPRE derivados das origens (Créditos/Requerimentos/
    // Apensos). Se o órgão some da origem, some daqui — contato salvo órfão
    // (de um órgão que não existe mais) não aparece na lista.

    let l: OrgaoRow[] = [...julgMap.values()]
    // Auxiliares (cadastro manual).
    for (const c of auxiliares) {
      l.push({
        key: `a:${c.id}`,
        orgao: c.orgao ?? '',
        tribunal: c.tribunal ?? '',
        tipo: 'auxiliar',
        contato: c,
      })
    }

    // `numeric` porque vara é numerada: sem ele a comparação é caractere por
    // caractere e dígito vem antes de letra, então a 11ª Vara aparecia antes da
    // 1ª e a 21ª antes da 2ª — a lista parecia fora de ordem justamente onde o
    // usuário procura por número.
    return l.sort((a, b) =>
      formatOrgaoLabel(a.orgao, a.tipo).localeCompare(
        formatOrgaoLabel(b.orgao, b.tipo),
        'pt-BR',
        { numeric: true },
      ),
    )
  }, [contatos.data, processos.data, requerimentos.data, apensos.data])

  // Tribunais distintos (com contagem de órgãos) para o filtro.
  const tribunais = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of todasLinhas) {
      const t = r.tribunal.trim()
      if (!t) continue
      m.set(t, (m.get(t) ?? 0) + 1)
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'))
  }, [todasLinhas])

  const linhas = useMemo<OrgaoRow[]>(() => {
    let l = todasLinhas
    if (filtroTribunal !== 'todos') {
      l = l.filter((r) => r.tribunal.trim() === filtroTribunal)
    }
    if (busca.trim()) {
      // Duas comparações, porque são dois jeitos de procurar a mesma coisa
      // (lib/buscaDaTela.ts):
      //   texto  sem acento ("goiania" acha "Goiânia");
      //   número só dígito ("3132221234" acha "(31) 3222-1234", que é como o
      //          telefone está gravado) — a partir de 3 dígitos, para "31" não
      //          trazer meia lista, e EM QUALQUER CAMPO (a amostra): também no
      //          e-mail ("vara13@…") e no nome do órgão ("13ª Vara").
      l = l.filter((r) =>
        casaBusca(
          [
            formatOrgaoLabel(r.orgao, r.tipo),
            r.tribunal,
            r.contato?.serventia_telefone,
            r.contato?.serventia_whatsapp,
            r.contato?.serventia_email,
            r.contato?.gabinete_telefone,
            r.contato?.gabinete_whatsapp,
            r.contato?.gabinete_email,
          ],
          busca,
          3,
        ),
      )
    }
    return l
  }, [todasLinhas, filtroTribunal, busca])

  function abrirEdicao(row: OrgaoRow) {
    if (row.contato) {
      abrirForm(row.contato)
      return
    }
    abrirForm({
      tipo: 'julgador',
      orgao: row.orgao,
      serventia_telefone: '',
      serventia_whatsapp: '',
      serventia_email: '',
      gabinete_telefone: '',
      gabinete_whatsapp: '',
      gabinete_email: '',
    })
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!editing) return
    const auxiliar = editing.tipo === 'auxiliar'
    // Validação inline por campo — toast fica só para erro de rede/backend.
    const novosErros: Record<string, string> = {}
    if (auxiliar && !editing.orgao?.trim()) novosErros.orgao = 'Informe o órgão'
    if (auxiliar && !editing.tribunal?.trim()) {
      novosErros.tribunal = 'Informe o tribunal / entidade'
    }
    for (const campo of CAMPOS_FONE) {
      if (telefoneIncompleto(editing[campo])) {
        novosErros[campo] = 'Use DDD + 8 ou 9 dígitos'
      }
    }
    if (Object.keys(novosErros).length > 0) {
      setErros(novosErros)
      return
    }
    try {
      const payload = {
        tipo: editing.tipo ?? 'julgador',
        orgao: vazioNull(editing.orgao),
        tribunal: auxiliar ? vazioNull(editing.tribunal) : null,
        serventia_telefone: vazioNull(editing.serventia_telefone),
        serventia_whatsapp: vazioNull(editing.serventia_whatsapp),
        serventia_email: vazioNull(editing.serventia_email),
        // Auxiliar não tem separação serventia/gabinete.
        gabinete_telefone: auxiliar ? null : vazioNull(editing.gabinete_telefone),
        gabinete_whatsapp: auxiliar ? null : vazioNull(editing.gabinete_whatsapp),
        gabinete_email: auxiliar ? null : vazioNull(editing.gabinete_email),
      }
      if (editing.id) {
        await update.mutateAsync({ id: editing.id, changes: payload })
        toast.success('Contato atualizado.')
      } else {
        await create.mutateAsync(payload)
        toast.success('Contato salvo.')
      }
      setEditing(null)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  async function confirmDelete() {
    if (!toDelete) return
    try {
      await remove.mutateAsync(toDelete.id)
      toast.success('Contato auxiliar removido.')
      setToDelete(null)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const editandoAuxiliar = editing?.tipo === 'auxiliar'

  /** O menu "⋯" do órgão: só o contato AUXILIAR se exclui por aqui. */
  const acoesDoOrgao = (row: OrgaoRow): AcaoDoMenu[] => [
    { rotulo: 'Editar contatos', icone: <Pencil aria-hidden="true" />, onSelecionar: () => abrirEdicao(row) },
    ...(row.tipo === 'auxiliar' && row.contato
      ? [
          {
            rotulo: 'Excluir contato auxiliar',
            icone: <Trash2 aria-hidden="true" />,
            perigo: true,
            onSelecionar: () => setToDelete(row.contato),
          },
        ]
      : []),
  ]

  return (
    <div>
      <PageHeader
        title="Contatos"
        description="Telefones e e-mails das serventias, gabinetes e órgãos auxiliares dos processos da carteira."
        actions={
          // No celular, o primário ocupa a largura (auditoria visual, K2).
          <Button
            icon={<Plus className="h-[16px] w-[16px]" />}
            onClick={() => abrirForm({ ...AUXILIAR_VAZIO })}
            className="w-full sm:w-auto"
          >
            Novo contato
          </Button>
        }
      />

      {/* A BUSCA E O FILTRO MORAM NO CARTÃO DA LISTA (a amostra). A legenda das
          bolinhas saiu: o tipo agora vem escrito num selo em cada linha (CT2). */}
      <Card>
        <FerramentasDoPainel
          fim={
            <span className="inline-flex items-center gap-s1.5">
              <Copy className="h-[16px] w-[16px]" aria-hidden="true" />
              copia o contato com um clique
            </span>
          }
        >
          <CampoDeBusca
            valor={busca}
            onChange={setBusca}
            placeholder="Buscar por órgão, telefone ou e-mail"
            title="Busca em: órgão, tribunal, telefones, WhatsApp e e-mails (o número com ou sem pontuação)"
            className="min-w-[14rem]"
          />
          {/* SEM LARGURA FIXA (auditoria visual, C7 e CT2): com `w-64` o texto
              cortava em "Todos os tribunais (5…". Só a largura mínima. */}
          <Select
            className="w-auto min-w-[220px]"
            value={filtroTribunal}
            onChange={(e) => setFiltroTribunal(e.target.value)}
            aria-label="Filtrar por tribunal"
          >
            <option value="todos">Todos os tribunais ({todasLinhas.length})</option>
            {tribunais.map(([t, n]) => (
              <option key={t} value={t}>
                {t} ({n})
              </option>
            ))}
          </Select>
        </FerramentasDoPainel>

        {isLoading ? (
          <Loading />
        ) : isError ? (
          <ErrorState
            message={error?.message}
            // Refaz as quatro consultas que alimentam a listagem; o botão diz
            // "Tentando…" até as quatro voltarem.
            onRetry={() =>
              Promise.all([
                contatos.refetch(),
                processos.refetch(),
                requerimentos.refetch(),
                apensos.refetch(),
              ])
            }
          />
        ) : linhas.length === 0 ? (
          // Lista vazia POR CAUSA da busca/filtro é outra situação: convidar a
          // cadastrar ali sugere que não existe nada, quando o que há é um
          // recorte ativo escondendo o resto. A saída oferecida tem que ser
          // limpar o recorte, não criar registro.
          // Sem resultado é uma linha simples (§0.10), sem a moldura do vazio.
          todasLinhas.length > 0 ? (
            <SemResultado
              texto={
                busca.trim()
                  ? `Nenhum órgão corresponde a "${busca.trim()}"${
                      filtroTribunal !== 'todos' ? ` no tribunal ${filtroTribunal}` : ''
                    }.`
                  : `Nenhum órgão no tribunal ${filtroTribunal}.`
              }
              rotuloLimpar="Limpar busca e filtro"
              onLimpar={() => {
                setBusca('')
                setFiltroTribunal('todos')
              }}
            />
          ) : (
            <EmptyState
              title="Nenhum órgão"
              description="Cadastre créditos/requerimentos ou um contato auxiliar."
              action={
                <Button
                  icon={<Plus className="h-[16px] w-[16px]" />}
                  onClick={() => abrirForm({ ...AUXILIAR_VAZIO })}
                >
                  Novo contato
                </Button>
              }
            />
          )
        ) : (
          <>
          {/* NO CELULAR, CARTÕES (K1): o órgão, o tribunal com o tipo e o
              primeiro contato que houver. */}
          <ListaNoCelular rotulo="Órgãos">
            {linhas.map((row) => {
              const c = row.contato
              const primeiro =
                c?.serventia_telefone || c?.gabinete_telefone || c?.serventia_email || c?.gabinete_email
              return (
                <CartaoNoCelular
                  key={row.key}
                  titulo={formatOrgaoLabel(row.orgao, row.tipo)}
                  linhas={[
                    [row.tribunal, SELO_TIPO[row.tipo].label].filter(Boolean).join(' · '),
                    primeiro ?? 'Nenhum contato cadastrado',
                  ]}
                  onAbrir={() => abrirEdicao(row)}
                  rotuloAbrir={`Editar contatos de ${formatOrgaoLabel(row.orgao, row.tipo)}`}
                  rotuloDasAcoes={`Ações de ${formatOrgaoLabel(row.orgao, row.tipo)}`}
                  acoes={acoesDoOrgao(row)}
                />
              )
            })}
          </ListaNoCelular>
          <div className="hidden md:block">
          <Table dense>
            <THead>
              <tr>
                <TH className="w-[26%]">Órgão</TH>
                {/* Só a largura da sigla: a sobra vai para os contatos. */}
                <TH className="w-[1%] whitespace-nowrap">Tribunal</TH>
                {/* Os títulos das três colunas no MESMO MOLDE da grade das linhas. */}
                <TH>
                  <div className={GRADE_CONTATOS}>
                    {/* Um invólucro no fluxo: o `sr-only` sozinho é absoluto e
                        não ocuparia a primeira coluna da grade. */}
                    <span>
                      <span className="sr-only">Contato de</span>
                    </span>
                    <span>Telefone</span>
                    <span>WhatsApp</span>
                    <span>E-mail</span>
                  </div>
                </TH>
                {/* A coluna das ações tem largura fixa (C4). */}
                <TH className="w-[72px] whitespace-nowrap text-right">Ações</TH>
              </tr>
            </THead>
            <TBody>
              {linhas.map((row) => (
                <TR key={row.key}>
                  <TD className="font-semibold text-texto">
                    {/* Nome do órgão é longo: quebra em várias linhas, sem truncar. */}
                    <div>{formatOrgaoLabel(row.orgao, row.tipo)}</div>
                    <Badge size="sm" tone={SELO_TIPO[row.tipo].tom} className="mt-s1">
                      {SELO_TIPO[row.tipo].label}
                    </Badge>
                  </TD>
                  <TD curto className="text-texto-2">{row.tribunal || '—'}</TD>
                  <TD className="py-s2">
                    <ContatosDoOrgao row={row} />
                  </TD>
                  {/* O "›" abre a edição dos contatos; o "⋯" traz Editar e, no
                      auxiliar, Excluir — em vermelho, por último, e não mais
                      colado no lápis (C4). */}
                  <TD className="w-[72px] py-s2">
                    <AcoesDaLinha
                      onAbrir={() => abrirEdicao(row)}
                      rotuloAbrir={`Editar contatos de ${formatOrgaoLabel(row.orgao, row.tipo)}`}
                      rotuloDasAcoes={`Ações de ${formatOrgaoLabel(row.orgao, row.tipo)}`}
                      acoes={acoesDoOrgao(row)}
                    />
                  </TD>
                </TR>
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
        title={
          editandoAuxiliar
            ? editing?.id
              ? `Editar — ${editing?.orgao ?? ''}`
              : 'Novo contato auxiliar'
            : `Contatos — ${formatOrgaoLabel(editing?.orgao ?? '')}`
        }
        description={
          editandoAuxiliar
            ? editing?.id
              ? undefined
              : 'Cartório, contadoria, setor de precatórios — o que não é vara nem gabinete.'
            : editing?.orgao
              ? todasLinhas.find((r) => r.tipo === 'julgador' && r.orgao === editing.orgao)
                  ?.tribunal || undefined
              : undefined
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
              form="form-contato"
              loading={create.isPending || update.isPending}
            >
              Salvar
            </Button>
          </>
        }
      >
        {editing && (
          <form id="form-contato" onSubmit={handleSubmit} className="space-y-s5">
            {editandoAuxiliar ? (
              <>
                <div className="grid gap-s4 sm:grid-cols-2">
                  <Field label="Órgão" required error={erros.orgao}>
                    <Input
                      value={editing.orgao ?? ''}
                      onChange={(e) => alterarCampo('orgao', e.target.value)}
                      placeholder="Ex.: Cartório do 2º Ofício"
                    />
                  </Field>
                  <Field label="Tribunal / entidade" required error={erros.tribunal}>
                    <Input
                      placeholder="Ex.: TJBA"
                      value={editing.tribunal ?? ''}
                      onChange={(e) => alterarCampo('tribunal', e.target.value)}
                    />
                  </Field>
                </div>
                <div className="grid gap-s4 sm:grid-cols-2">
                  <Field label="Telefone" error={erros.serventia_telefone}>
                    <Input
                      value={editing.serventia_telefone ?? ''}
                      onChange={(e) =>
                        alterarCampo('serventia_telefone', formatTelefone(e.target.value))
                      }
                      placeholder="(00) 0000-0000"
                    />
                  </Field>
                  <Field label="WhatsApp" error={erros.serventia_whatsapp}>
                    <Input
                      value={editing.serventia_whatsapp ?? ''}
                      onChange={(e) =>
                        alterarCampo('serventia_whatsapp', formatTelefone(e.target.value))
                      }
                      placeholder="(00) 00000-0000"
                    />
                  </Field>
                  <Field label="E-mail" className="sm:col-span-2">
                    <Input
                      type="email"
                      placeholder="nome@tribunal.jus.br"
                      value={editing.serventia_email ?? ''}
                      onChange={(e) =>
                        setEditing({ ...editing, serventia_email: e.target.value })
                      }
                    />
                  </Field>
                </div>
              </>
            ) : (
              <>
                <SecaoDoFormulario titulo="Serventia">
                  <div className="grid gap-s4 sm:grid-cols-2">
                    <Field label="Telefone" error={erros.serventia_telefone}>
                      <Input
                        value={editing.serventia_telefone ?? ''}
                        onChange={(e) =>
                          alterarCampo('serventia_telefone', formatTelefone(e.target.value))
                        }
                        placeholder="(00) 0000-0000"
                      />
                    </Field>
                    <Field label="WhatsApp" error={erros.serventia_whatsapp}>
                      <Input
                        value={editing.serventia_whatsapp ?? ''}
                        onChange={(e) =>
                          alterarCampo('serventia_whatsapp', formatTelefone(e.target.value))
                        }
                        placeholder="(00) 00000-0000"
                      />
                    </Field>
                    <Field label="E-mail" className="sm:col-span-2">
                      <Input
                        type="email"
                        placeholder="nome@tribunal.jus.br"
                        value={editing.serventia_email ?? ''}
                        onChange={(e) =>
                          setEditing({ ...editing, serventia_email: e.target.value })
                        }
                      />
                    </Field>
                  </div>
                </SecaoDoFormulario>
                <SecaoDoFormulario titulo="Gabinete">
                  <div className="grid gap-s4 sm:grid-cols-2">
                    <Field label="Telefone" error={erros.gabinete_telefone}>
                      <Input
                        value={editing.gabinete_telefone ?? ''}
                        onChange={(e) =>
                          alterarCampo('gabinete_telefone', formatTelefone(e.target.value))
                        }
                        placeholder="(00) 0000-0000"
                      />
                    </Field>
                    <Field label="WhatsApp" error={erros.gabinete_whatsapp}>
                      <Input
                        value={editing.gabinete_whatsapp ?? ''}
                        onChange={(e) =>
                          alterarCampo('gabinete_whatsapp', formatTelefone(e.target.value))
                        }
                        placeholder="(00) 00000-0000"
                      />
                    </Field>
                    <Field label="E-mail" className="sm:col-span-2">
                      <Input
                        type="email"
                        placeholder="nome@tribunal.jus.br"
                        value={editing.gabinete_email ?? ''}
                        onChange={(e) =>
                          setEditing({ ...editing, gabinete_email: e.target.value })
                        }
                      />
                    </Field>
                  </div>
                </SecaoDoFormulario>
              </>
            )}
          </form>
        )}
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        danger
        loading={remove.isPending}
        // Só o contato AUXILIAR tem lixeira (ver a coluna Ações); o contato de
        // órgão julgador não é excluído por aqui.
        title="Excluir contato auxiliar"
        message={`Excluir o contato auxiliar "${toDelete?.orgao || ''}"?`}
        confirmLabel="Excluir"
        onConfirm={confirmDelete}
        onClose={() => setToDelete(null)}
      />
    </div>
  )
}
