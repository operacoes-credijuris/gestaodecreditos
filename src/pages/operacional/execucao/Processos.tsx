import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Plus,
  Pencil,
  Trash2,
  Search,
  ChevronRight,
  PenLine,
  Sparkles,
} from 'lucide-react'
import {
  processosCrud,
  apensosCrud,
  useInvestidorDados,
  useUltimaMovimentacao,
} from '@/lib/queries'
import { listarPessoas } from '@/lib/pessoas'
import { invokeFunction } from '@/lib/functions'
import {
  NovoCreditoDoDrive,
  type PreenchimentoDoDrive,
} from '@/components/NovoCreditoDoDrive'
import { cn } from '@/lib/cn'
import { useApensosManager } from '@/components/Apensos'
import { NumeroProcessoDrive } from '@/components/NumeroProcessoDrive'
import type {
  Processo,
  StatusProcesso,
  Instrumento,
  TipoCredito,
  IndiceAtualizacao,
  EspecieRequisitorio,
} from '@/lib/types'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Field, Input, Select } from '@/components/ui/Field'
import { ComboboxTexto } from '@/components/ui/Combobox'
import { Segmented } from '@/components/ui/Segmented'
import { Tabs } from '@/components/ui/Tabs'
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
  getLabel,
  STATUS_PROCESSO,
  INSTRUMENTO,
  TIPO_CREDITO,
  INDICE_ATUALIZACAO,
  ESPECIE_REQUISITORIO,
} from '@/lib/labels'
import {
  formatBRL,
  formatBRLInput,
  formatCNJ,
  formatDate,
  hojeISO,
  mesesDepois,
  normalizarBusca,
  onlyDigits,
  parseBRLInput,
  vazioNull,
} from '@/lib/format'

/**
 * Abas da janela de crédito novo. Mesmo componente e mesmo formato das abas da
 * geração de petição — duas janelas que oferecem "faça à mão ou deixe a
 * plataforma preencher" não têm por que parecer coisas diferentes.
 */
const ABAS_NOVO_CREDITO = [
  { key: 'manual', label: 'Manual', icon: <PenLine className="h-4 w-4" /> },
  { key: 'auto', label: 'Automatizado', icon: <Sparkles className="h-4 w-4" /> },
]

// Separa múltiplos nº RTDPJ (digitados com "e", vírgula, ";" ou quebra) para
// exibir um por linha.
//
// A BARRA SAIU da lista de separadores: ela faz parte do próprio número quando
// vem com o ano ("123456/2025"), e um registro único era exibido quebrado em dois
// — "123456" e "2025" —, dando a entender que havia dois registros.
function splitRtdpj(v: string): string[] {
  return v
    .split(/\s*(?:\be\b|,|;|\n)\s*/i)
    .map((s) => s.trim())
    .filter(Boolean)
}

// Antecedência que acende o âmbar na coluna Expectativa. Régua num só lugar:
// mudar aqui muda a cor e o texto da dica junto.
const MESES_ALERTA_EXPECTATIVA = 3

/**
 * Semáforo da expectativa de liquidação: vermelho já venceu, âmbar vence
 * dentro da janela de MESES_ALERTA_EXPECTATIVA, verde ainda tem folga.
 * Comparação por texto (ISO é ordenável) contra a data de hoje, recalculada a
 * cada render — então a cor vira sozinha na virada do dia, sem ninguém mexer
 * no cadastro.
 */
function corExpectativa(
  data: string | null | undefined,
  hoje: string,
  limiteAlerta: string,
): { classe: string; titulo?: string } {
  const d = (data ?? '').slice(0, 10)
  if (!d) return { classe: 'text-slate-600' }
  if (d < hoje) return { classe: 'font-medium text-red-600', titulo: 'Expectativa vencida' }
  if (d <= limiteAlerta) {
    return {
      classe: 'font-medium text-amber-700',
      titulo: `Vence em até ${MESES_ALERTA_EXPECTATIVA} meses`,
    }
  }
  return {
    classe: 'font-medium text-emerald-700',
    titulo: `Vence em mais de ${MESES_ALERTA_EXPECTATIVA} meses`,
  }
}

/**
 * Data de liquidação, já recebido e valor estimado complementar só existem
 * depois que o crédito começou a ser pago — ou seja, fora do status Ativo.
 * Ficam ocultos no formulário e na ficha, e o salvamento os descarta em Ativo.
 * Ponto único da regra: mudou aqui, mudou nos quatro lugares que a usam.
 */
const emLiquidacao = (status?: StatusProcesso): boolean =>
  status === 'complementar' || status === 'encerrado'

const VAZIO: Partial<Processo> = {
  numero_cnj: '',
  tribunal: '',
  comarca: '',
  vara: '',
  cedente: '',
  numero_processo_administrativo: '',
  cedente_advogado: '',
  cessionario: '',
  originador: '',
  entidade_devedora: '',
  data_aquisicao: '',
  expectativa_liquidacao: '',
  instrumento: null,
  numero_rtdpj: '',
  status: 'ativo',
  data_liquidacao: '',
  especie_requisitorio: null,
  tipo_credito: [],
  capital_investido: null,
  valor_face: null,
  data_referencia: '',
  indice_atualizacao: null,
  ja_recebido: null,
  valor_estimado_complementar: null,
}

/**
 * Campo de dinheiro com "R$" fixo à esquerda. O valor vive como número no
 * estado; os dígitos digitados entram como centavos (ver parseBRLInput), então
 * o campo nunca aceita um formato inválido.
 */
function CampoMoeda({
  valor,
  onChange,
}: {
  valor: number | null | undefined
  onChange: (v: number | null) => void
}) {
  // OS DÍGITOS são a fonte da verdade durante a digitação, não o número.
  //
  // Com o número, o estado "nenhum dígito" era inalcançável: ao apagar tudo, o
  // valor chegava a 0, e formatBRLInput(0) devolve "0,00" — reintroduzindo
  // dígitos no campo. O apagar seguinte movia entre 0,00 e 0,00 e o campo ficava
  // preso em R$ 0,00, que NÃO é "não informado": a carteira lê zero como valor
  // declarado e um "Já recebido" de R$ 0,00 num crédito liquidado produz ganho
  // fictício de todo o capital. Guardando os dígitos, apagar tudo devolve string
  // vazia e o campo volta a null.
  const [digitos, setDigitos] = useState(() => onlyDigits(formatBRLInput(valor)))

  // Ressincroniza quando o valor vem de FORA (abrir outro crédito, resetar o
  // formulário). Compara pelo valor, não pelo texto, para não brigar com a
  // digitação em curso.
  useEffect(() => {
    if (parseBRLInput(digitos) !== (valor ?? null))
      setDigitos(onlyDigits(formatBRLInput(valor)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valor])

  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-600">
        R$
      </span>
      <Input
        className="pl-9 text-right tabular-nums"
        inputMode="numeric"
        placeholder="0,00"
        value={digitos ? formatBRLInput(parseBRLInput(digitos)) : ''}
        onChange={(e) => {
          const d = onlyDigits(e.target.value)
          setDigitos(d)
          onChange(d ? parseBRLInput(d) : null)
        }}
      />
    </div>
  )
}

// Nº de colunas da tabela de créditos — usado no colSpan da linha de apensos.
// Atualizar ao adicionar/remover colunas para a linha continuar ocupando a largura toda.
// A tabela mostra só o essencial para escanear; a ficha completa (advogado,
// tribunal, datas de liquidação etc.) abre no Drawer ao clicar na linha.
const N_COLUNAS = 7

// Bolinha de status ao lado do nº do processo — o status por extenso é
// redundante com o filtro de pílulas acima da tabela; a cor basta.
// Só os tones que STATUS_PROCESSO produz; tone novo cai no fallback cinza.
const DOT_STATUS: Record<string, string> = {
  green: 'bg-emerald-500',
  yellow: 'bg-amber-400',
  gray: 'bg-slate-400',
}

export default function Processos() {
  const { useList, useCreate, useUpdate, useRemove } = processosCrud
  const { data, isLoading, isError, error, refetch } = useList()
  const create = useCreate()
  const update = useUpdate()
  const remove = useRemove()
  const toast = useToast()
  const qc = useQueryClient()
  const apensos = useApensosManager('processo_id')
  const ultimaMov = useUltimaMovimentacao()

  // Nomes que já existem, para os campos Cessionário e Originador oferecerem
  // em lista. Vêm dos próprios créditos e das fichas da aba "Dados pessoais e
  // bancários" — o comercial cadastra o investidor antes de haver crédito.
  //
  // Falha nesta consulta NÃO trava a página nem aparece em erro: sem ela os dois
  // campos continuam aceitando texto livre, só sem a metade cadastrada da lista.
  const fichas = useInvestidorDados()
  const nomesCessionario = useMemo(
    () => listarPessoas('investidor', data, fichas.data).map((p) => p.nome),
    [data, fichas.data],
  )
  const nomesOriginador = useMemo(
    () => listarPessoas('originador', data, fichas.data).map((p) => p.nome),
    [data, fichas.data],
  )

  // Referências do semáforo da coluna Expectativa. Data local (sv-SE dá o
  // formato ISO), calculada no render: no dia seguinte a régua anda sozinha.
  const hoje = useMemo(() => hojeISO(), [])
  const limiteAlerta = useMemo(
    () => mesesDepois(hoje, MESES_ALERTA_EXPECTATIVA),
    [hoje],
  )

  const [busca, setBusca] = useState('')
  // Padrão ao abrir a página: mostra apenas processos ativos.
  const [filtroStatus, setFiltroStatus] = useState('ativo')
  // Ordenação padrão: data de aquisição, do mais antigo para o mais novo.
  // ultima_movimentacao não é campo do processo — vem do cache do ADVBOX, e o
  // comparador resolve pelo mapa (ver `lista`).
  const [sortBy, setSortBy] = useState<
    'data_aquisicao' | 'expectativa_liquidacao' | 'ultima_movimentacao'
  >('data_aquisicao')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  /** Aba da janela de crédito novo. Na edição não aparece — ver o Modal. */
  const [abaForm, setAbaForm] = useState<'manual' | 'auto'>('manual')
  /** Uma pasta do Drive já preencheu os campos: libera a edição e o Salvar. */
  const [autoPreenchido, setAutoPreenchido] = useState(false)
  const [toDelete, setToDelete] = useState<Processo | null>(null)
  // Crédito com a ficha aberta no painel lateral (clique na linha).
  const [detalhe, setDetalhe] = useState<Processo | null>(null)
  // Apensos do crédito em detalhe (lista de leitura na ficha).
  const todosApensos = apensosCrud.useList()
  const apensosDoDetalhe = useMemo(
    () =>
      detalhe
        ? (todosApensos.data ?? []).filter((a) => a.processo_id === detalhe.id)
        : [],
    [todosApensos.data, detalhe],
  )
  // Erros de validação por campo, exibidos inline nos <Field>.
  const [erros, setErros] = useState<Record<string, string>>({})
  // Snapshot do formulário ao abrir — base do cálculo de "dirty".
  const snapshotRef = useRef('')

  /**
   * CADA ABA TEM O SEU RASCUNHO. Preencher no Automatizado não aparece no Manual,
   * e vice-versa.
   *
   * Era um formulário só, e a mesma pasta escolhida no Automatizado aparecia
   * preenchida no Manual. Confunde: as duas abas são dois CAMINHOS para cadastrar,
   * e quem começou à mão não quer ver o trabalho misturado com o que veio da pasta
   * — nem correr o risco de salvar uma mistura dos dois sem perceber.
   *
   * `editing` e `setEditing` continuam existindo e apontam para o rascunho da aba
   * ATIVA. É o que mantém os cerca de sessenta pontos do formulário abaixo
   * inalterados: quem escreve num campo escreve no rascunho de quem está na tela.
   */
  const [formManual, setFormManual] = useState<Partial<Processo> | null>(null)
  const [formAuto, setFormAuto] = useState<Partial<Processo> | null>(null)
  const naAuto = abaForm === 'auto'
  const editing = naAuto ? formAuto : formManual
  const setEditing = naAuto ? setFormAuto : setFormManual

  // Sujo se QUALQUER um dos dois rascunhos saiu do estado inicial: trocar de aba e
  // fechar não pode descartar em silêncio o que ficou na outra.
  const dirty =
    (!!formManual && JSON.stringify(formManual) !== snapshotRef.current) ||
    (!!formAuto && JSON.stringify(formAuto) !== snapshotRef.current)

  /** Fecha a janela, descartando os dois rascunhos. */
  function fecharTudo() {
    setFormManual(null)
    setFormAuto(null)
    setAutoPreenchido(false)
  }

  // Abre o formulário limpando erros e registrando o snapshot do estado inicial.
  function abrirForm(p: Partial<Processo>) {
    setErros({})
    snapshotRef.current = JSON.stringify(p)
    // Os dois rascunhos nascem iguais e vazios; o que a pessoa fizer em cada aba
    // fica em cada aba.
    setFormManual(p)
    setFormAuto(p)
    // Sempre na Manual: quem clica em Editar quer o formulário, e quem cadastra
    // um crédito novo pode não ter pasta no Drive ainda.
    setAbaForm('manual')
    setAutoPreenchido(false)
  }

  /**
   * Preenchimento vindo da aba Automatizado. Escreve SÓ no rascunho dela, soma ao
   * que já estava lá — campo que a pasta não informa fica como estava — e libera os
   * campos para edição, sem trocar de aba.
   */
  function preencherDoDrive(
    dados: PreenchimentoDoDrive,
    opts?: { avisar?: boolean },
  ) {
    // MESCLA, não substitui: as ondas do preenchimento se completam, e trocar o
    // estado apagaria o que o caminho da pasta já trouxe.
    setFormAuto((atual) => ({ ...(atual ?? {}), ...dados }))
    setErros({})
    setAutoPreenchido(true)
    // Só a onda final avisa. Avisar na primeira era pedir conferência de um
    // formulário que ainda estava sendo preenchido.
    if (opts?.avisar) {
      toast.success('Campos preenchidos pela pasta. Confira antes de salvar.')
    }
  }

  // Fecha pelo botão "Cancelar" respeitando alterações pendentes (o Modal já
  // cobre X/overlay/Escape via prop dirty).
  function fecharForm() {
    if (dirty && !window.confirm('Descartar alterações não salvas?')) return
    fecharTudo()
  }

  function toggleSort(
    col: 'data_aquisicao' | 'expectativa_liquidacao' | 'ultima_movimentacao',
  ) {
    if (sortBy === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortBy(col)
      setSortDir('asc')
    }
  }

  // Busca textual (sem o filtro de status) — reaproveitada na lista e nas
  // contagens exibidas no seletor de status.
  const baseBusca = useMemo(() => {
    let l = data ?? []
    if (busca.trim()) {
      // Mesmo padrão das outras telas: sem acento, e número de processo também
      // por dígito. Antes, "goiania" não achava "Goiânia" e o número copiado da
      // tela ("5001234-56.2020.8.13.0001") não achava nada, porque a comparação
      // era literal contra o valor cru do banco.
      const q = normalizarBusca(busca)
      const qd = onlyDigits(busca)
      l = l.filter((p) => {
        const achouTexto = [
          p.numero_cnj,
          // Entra na busca porque NÃO está na tabela: é o único número do crédito
          // que não se acha varrendo a lista com os olhos.
          p.numero_processo_administrativo,
          p.cedente,
          p.cedente_advogado,
          p.cessionario,
          p.entidade_devedora,
          p.comarca,
          p.tribunal,
          p.numero_rtdpj,
          p.instrumento ? getLabel(INSTRUMENTO, p.instrumento).label : null,
        ]
          .filter(Boolean)
          .some((v) => normalizarBusca(v!).includes(q))
        if (achouTexto) return true
        return (
          qd.length >= 4 &&
          (onlyDigits(p.numero_cnj).includes(qd) ||
            onlyDigits(p.numero_rtdpj).includes(qd) ||
            onlyDigits(p.numero_processo_administrativo).includes(qd))
        )
      })
    }
    return l
  }, [data, busca])

  const contagemStatus = useMemo(() => {
    const c: Record<string, number> = { todos: baseBusca.length }
    for (const k of Object.keys(STATUS_PROCESSO))
      c[k] = baseBusca.filter((p) => p.status === k).length
    return c
  }, [baseBusca])

  const lista = useMemo(() => {
    let l = baseBusca
    if (filtroStatus !== 'todos') l = l.filter((p) => p.status === filtroStatus)
    const dir = sortDir === 'asc' ? 1 : -1
    // A última movimentação não está no registro: resolve pelo mapa do ADVBOX.
    // Ambos os formatos são ISO (YYYY-MM-DD...), então localeCompare ordena
    // cronologicamente como texto.
    const valor = (p: Processo) =>
      sortBy === 'ultima_movimentacao'
        ? (ultimaMov.data?.get(onlyDigits(p.numero_cnj)) ?? '')
        : (p[sortBy] || '')
    return [...l].sort((a, b) => {
      const av = valor(a)
      const bv = valor(b)
      if (!av && !bv) return 0
      if (!av) return 1 // datas vazias sempre por último
      if (!bv) return -1
      return av.localeCompare(bv) * dir
    })
  }, [baseBusca, filtroStatus, sortBy, sortDir, ultimaMov.data])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!editing) return
    const novosErros: Record<string, string> = {}
    if (!editing.numero_cnj?.trim()) {
      // Validação inline: erro aparece junto ao campo, sem toast.
      novosErros.numero_cnj = 'Informe o número do processo'
    }

    // COERÊNCIA DA LIQUIDAÇÃO — é aqui que o estado nasce, e é aqui que tem de
    // ser barrado. TODA a plataforma decide "este crédito foi pago?" pela
    // PRESENÇA de data_liquidacao (projecao.ts, statusLiquidacao, statusTir,
    // diasEmCarteira), nunca pelo status. Salvar "Encerrado" com valor recebido e
    // sem a data fazia o mesmo dinheiro entrar em DOIS cards da carteira: somava
    // em "Já recebido" e, por ser lido como não liquidado, somava o valor de face
    // atualizado em "A receber estimado" — R$ 310 mil e R$ 372 mil do mesmo
    // crédito, num caso medido. Corrigir na projeção não resolveria: a regra é
    // compartilhada por quatro funções e mexer nela quebra a TIR.
    if (emLiquidacao(editing.status)) {
      const temValorRecebido =
        editing.ja_recebido != null || editing.valor_estimado_complementar != null
      if (temValorRecebido && !vazioNull(editing.data_liquidacao ?? null)) {
        novosErros.data_liquidacao =
          'Informe a data de liquidação do valor já recebido'
      }
      if (editing.status === 'encerrado' && !vazioNull(editing.data_liquidacao ?? null)) {
        novosErros.data_liquidacao =
          'Crédito encerrado precisa da data efetiva de liquidação'
      }
    }

    // DATA FORA DE ORDEM: liquidar antes de comprar não existe, e o efeito era
    // "Dias em carteira" imprimindo número negativo com a TIR justificando
    // "Prazo nulo" — erro de digitação de ano que passava calado.
    const aq = vazioNull(editing.data_aquisicao ?? null)
    const liq = vazioNull(editing.data_liquidacao ?? null)
    const exp = vazioNull(editing.expectativa_liquidacao ?? null)
    if (aq && liq && liq < aq)
      novosErros.data_liquidacao = 'A liquidação não pode ser anterior à cessão'
    if (aq && exp && exp < aq)
      novosErros.expectativa_liquidacao =
        'A expectativa não pode ser anterior à cessão'

    if (Object.keys(novosErros).length > 0) {
      setErros(novosErros)
      return
    }
    try {
      // drive_pasta_id fica FORA do payload: é cache que a resolução da pasta grava
      // por conta própria, e o formulário reenviaria o valor que carregou ao abrir —
      // sobrescrevendo com um id velho um que acabou de ser resolvido.
      const {
        id,
        created_at,
        updated_at,
        advbox_lawsuit_id,
        drive_pasta_id: _cachePasta,
        ...payload
      } =
        editing as Processo
      // Em Ativo os três campos ficam ocultos, então são descartados.
      if (!emLiquidacao(payload.status)) {
        payload.data_liquidacao = null
        payload.ja_recebido = null
        payload.valor_estimado_complementar = null
      }
      // Nº RTDPJ só se aplica a registro público e é opcional (vazio = nulo).
      payload.numero_rtdpj =
        payload.instrumento === 'registro_publico'
          ? vazioNull(payload.numero_rtdpj)
          : null
      // Nº do processo administrativo em branco vira null. Note que ele NÃO é
      // zerado quando a espécie deixa de ser precatório, ao contrário do RTDPJ
      // acima: aqui o valor foi digitado à mão ou lido de um ofício, e apagá-lo por
      // efeito colateral de trocar a espécie seria perder dado sem avisar. Ele
      // continua visível na ficha e no formulário justamente para poder ser
      // corrigido — incoerência à vista é melhor que sumiço silencioso.
      payload.numero_processo_administrativo = vazioNull(
        payload.numero_processo_administrativo,
      )
      // Originador em branco vira null: é ele que monta a lista de nomes da
      // aba Dados pessoais e bancários, e string vazia entraria como se fosse
      // alguém. (O cessionário não passa por aqui — mudar isso agora afetaria
      // filtros e comparações que já existem, e a tela trata os dois casos.)
      payload.originador = vazioNull(payload.originador)
      // Datas em branco viram null.
      payload.data_aquisicao = vazioNull(payload.data_aquisicao)
      payload.expectativa_liquidacao = vazioNull(payload.expectativa_liquidacao)
      payload.data_liquidacao = vazioNull(payload.data_liquidacao)
      payload.data_referencia = vazioNull(payload.data_referencia)
      // Sem tipo marcado o banco espera lista vazia, não null (coluna NOT NULL).
      payload.tipo_credito = payload.tipo_credito ?? []
      if (id) {
        await update.mutateAsync({ id, changes: payload })
        toast.success('Crédito atualizado.')
      } else {
        const criado = await create.mutateAsync(payload)
        toast.success('Crédito cadastrado.')
        // FORA do await do salvamento, de propósito: o cadastro na ADVBOX é
        // consequência, não condição. Se a ADVBOX estiver fora do ar, o crédito
        // continua salvo aqui — travar o cadastro da plataforma por causa de um
        // sistema externo seria trocar um problema pequeno por um grande.
        if (criado?.id) void cadastrarNaAdvbox(criado.id)
      }
      fecharTudo()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  /**
   * Cadastra o processo do crédito recém-criado na ADVBOX.
   *
   * A ADVBOX só traz movimentações de processo cadastrado nela, e o esquecimento
   * não aparece em lugar nenhum: a aba Movimentações simplesmente não mostra aquele
   * processo, o que é indistinguível de "não houve movimentação". Por isso é
   * automático — e por isso avisa quando NÃO consegue.
   *
   * O silêncio é escolhido caso a caso. Integração desligada não é notícia; falha
   * de verdade é, senão o esquecimento volta pela porta dos fundos.
   */
  async function cadastrarNaAdvbox(processoId: string) {
    try {
      const r = await invokeFunction<{
        ok?: boolean
        motivo?: string
        criado?: boolean
        ja_existia?: boolean
        detalhe?: string
        aviso?: string
      }>('advbox-processos', { action: 'criar', processo_id: processoId })

      if (r.ok && r.criado) toast.success('Processo cadastrado na ADVBOX.')
      // Já existia: nada a dizer. É o caso de quem cadastrou o processo lá antes,
      // e virou vínculo — informar aqui seria ruído sobre algo que deu certo.
      else if (r.motivo === 'incompleto')
        toast.error(
          'Cadastro automático na ADVBOX está ligado, mas falta escolher responsável, fase, tipo ou cliente em Configurações.',
        )
      else if (r.motivo === 'numero_invalido')
        toast.error(`Não cadastrei na ADVBOX: ${r.detalhe ?? 'número do processo inválido.'}`)
      else if (r.aviso) toast.error(r.aviso)
    } catch (err) {
      // O crédito JÁ está salvo. Isto é aviso, não falha de cadastro — daí a
      // mensagem dizer o que ficou pendente, e não parecer que nada funcionou.
      toast.error(`Crédito salvo, mas não cadastrei na ADVBOX: ${(err as Error).message}`)
    }
  }

  async function confirmDelete() {
    if (!toDelete) return
    try {
      await remove.mutateAsync(toDelete.id)
      // A exclusão do crédito cascateia no banco para apensos e resumos, e o
      // makeCrud só invalida a própria tabela. Sem isto, os apensos do crédito
      // apagado continuavam listados na tela até recarregar a página.
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['apensos'] }),
        qc.invalidateQueries({ queryKey: ['carteira_resumos'] }),
      ])
      toast.success('Crédito excluído.')
      setToDelete(null)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <div>
      <PageHeader
        title="Créditos"
        actions={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => abrirForm({ ...VAZIO })}>
            Novo crédito
          </Button>
        }
      />

      <Card className="mb-4 p-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <Input
              className="pl-9"
              placeholder="Buscar por número, cedente, advogado, cessionário, devedora, comarca, tribunal, instrumento, RTDPJ…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
          <Segmented
            ariaLabel="Filtrar créditos por status"
            items={[
              ...Object.entries(STATUS_PROCESSO).map(([k, v]) => ({
                key: k,
                label: v.label,
                count: contagemStatus[k] ?? 0,
              })),
              { key: 'todos', label: 'Todos', count: contagemStatus.todos },
            ]}
            value={filtroStatus}
            onChange={setFiltroStatus}
          />
        </div>
      </Card>

      <Card>
        {isLoading ? (
          <Loading />
        ) : isError ? (
          <ErrorState message={(error as Error)?.message} onRetry={() => refetch()} />
        ) : lista.length === 0 ? (
          // Vazio POR RECORTE é outra coisa: com 95 créditos cadastrados e um
          // filtro de status ativo, "Cadastre o primeiro crédito" afirma que a
          // base está vazia e esconde que há dado atrás do recorte. A saída
          // oferecida tem de ser limpar o recorte, não cadastrar de novo.
          (data ?? []).length > 0 ? (
            <EmptyState
              title="Nada encontrado"
              description={
                busca.trim()
                  ? `Nenhum crédito corresponde a "${busca.trim()}"${
                      filtroStatus !== 'todos'
                        ? ` no status ${getLabel(STATUS_PROCESSO, filtroStatus).label}`
                        : ''
                    }.`
                  : `Nenhum crédito no status ${
                      getLabel(STATUS_PROCESSO, filtroStatus).label
                    }.`
              }
              action={
                <Button
                  variant="outline"
                  onClick={() => {
                    setBusca('')
                    setFiltroStatus('todos')
                  }}
                >
                  Limpar busca e filtro
                </Button>
              }
            />
          ) : (
            <EmptyState
              title="Nenhum crédito"
              description="Cadastre o primeiro crédito."
              action={
                <Button
                  icon={<Plus className="h-4 w-4" />}
                  onClick={() => abrirForm({ ...VAZIO })}
                >
                  Novo crédito
                </Button>
              }
            />
          )
        ) : (
          <Table dense>
            <THead>
              <tr>
                <TH>Processo</TH>
                <TH>Entidade devedora</TH>
                <SortableTH
                  label="Aquisição"
                  active={sortBy === 'data_aquisicao'}
                  dir={sortDir}
                  onToggle={() => toggleSort('data_aquisicao')}
                />
                <SortableTH
                  label="Expectativa"
                  active={sortBy === 'expectativa_liquidacao'}
                  dir={sortDir}
                  onToggle={() => toggleSort('expectativa_liquidacao')}
                />
                <SortableTH
                  label="Últ. movimentação"
                  active={sortBy === 'ultima_movimentacao'}
                  dir={sortDir}
                  onToggle={() => toggleSort('ultima_movimentacao')}
                  className="w-[1%] whitespace-nowrap"
                />
                <TH>Instrumento</TH>
                <TH className="w-[1%] whitespace-nowrap">Ações</TH>
              </tr>
            </THead>
            <TBody>
              {lista.map((p) => {
                const st = getLabel(STATUS_PROCESSO, p.status)
                const inst = getLabel(INSTRUMENTO, p.instrumento)
                const exp = corExpectativa(p.expectativa_liquidacao, hoje, limiteAlerta)
                return (
                  <Fragment key={p.id}>
                  <TR onClick={() => setDetalhe(p)}>
                    <TD className="font-medium text-slate-800">
                      <div className="flex items-start gap-2">
                        <span
                          title={st.label}
                          aria-label={`Status: ${st.label}`}
                          className={cn(
                            'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                            DOT_STATUS[st.tone] ?? 'bg-slate-400',
                          )}
                        />
                        <div className="min-w-0">
                          <span className="inline-flex items-center gap-1.5">
                            {/* O SELO ALINHA ENTRE AS LINHAS sem precisar de coluna,
                                e são duas coisas que fazem isso:
                                  - tabular-nums, porque a fonte do app tem dígitos
                                    de largura VARIÁVEL e dois números CNJ de mesmo
                                    comprimento mediam diferente;
                                  - reservarIcone, porque o ícone da pasta do Drive
                                    só existe em crédito com pasta e a sua ausência
                                    puxava tudo 14px para a esquerda.
                                Com os dois, o número ocupa sempre a mesma largura e
                                o que vem depois começa sempre no mesmo ponto. */}
                            <NumeroProcessoDrive
                              processo={p}
                              numero={p.numero_cnj}
                              className="whitespace-nowrap tabular-nums"
                              reservarIcone
                            />
                            {/* Espécie colada no número: é natureza do requisitório,
                                como o número — não é situação do crédito (isso é o
                                status) nem valor. */}
                            {p.especie_requisitorio && (
                              <Badge
                                size="sm"
                                tone={
                                  ESPECIE_REQUISITORIO[p.especie_requisitorio]?.tone ??
                                  'gray'
                                }
                              >
                                {ESPECIE_REQUISITORIO[p.especie_requisitorio]?.label ??
                                  p.especie_requisitorio}
                              </Badge>
                            )}
                            {/* Apensos à direita da espécie: número e espécie
                                identificam o requisitório, e o contador é ação
                                sobre ele. */}
                            {apensos.contador(p.id)}
                          </span>
                          {/* Nomes completos: quebram em linhas em vez de truncar. */}
                          <div className="text-xs font-normal text-slate-600">
                            {p.cedente || '—'} v. {p.cessionario || '—'}
                          </div>
                        </div>
                      </div>
                    </TD>
                    <TD>
                      {/* Devedora e comarca/vara em linhas próprias, texto completo. */}
                      <div>{p.entidade_devedora || '—'}</div>
                      <div className="text-xs text-slate-600">
                        {[p.comarca, p.vara].filter(Boolean).join(' · ') || '—'}
                      </div>
                    </TD>
                    <TD className="whitespace-nowrap tabular-nums text-slate-600">
                      {formatDate(p.data_aquisicao)}
                    </TD>
                    {/* Semáforo: vencida (vermelho), dentro da janela de alerta
                        (âmbar), com folga (verde). O title mantém a informação
                        para quem não distingue as cores. */}
                    <TD className="whitespace-nowrap tabular-nums">
                      <span className={exp.classe} title={exp.titulo}>
                        {formatDate(p.expectativa_liquidacao)}
                      </span>
                    </TD>
                    {/* Puxada do cache do ADVBOX, não digitada. Enquanto o mapa
                        carrega mostra vazio em vez de "—", que seria mentira. */}
                    <TD className="whitespace-nowrap tabular-nums text-slate-600">
                      {ultimaMov.isLoading
                        ? ''
                        : formatDate(
                            ultimaMov.data?.get(onlyDigits(p.numero_cnj)) ?? null,
                          )}
                    </TD>
                    {/* Sem nowrap: nº RTDPJ longo deve quebrar em vez de
                        alargar a tabela. O Badge é inline-flex e não quebra. */}
                    <TD>
                      {p.instrumento ? (
                        <Badge tone={inst.tone}>{inst.label}</Badge>
                      ) : (
                        '—'
                      )}
                      {p.instrumento === 'registro_publico' && p.numero_rtdpj && (
                        <div className="mt-0.5 text-xs text-slate-600">
                          {splitRtdpj(p.numero_rtdpj).map((n, i) => (
                            <div key={i}>{n}</div>
                          ))}
                        </div>
                      )}
                    </TD>
                    <TD>
                      {/* stopPropagation: os botões não devem abrir a ficha da linha */}
                      <div
                        className="flex items-center gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {apensos.actions(p.id)}
                        <IconButton
                          label="Editar"
                          icon={<Pencil className="h-4 w-4" />}
                          onClick={() => abrirForm(p)}
                        />
                        <IconButton
                          label="Excluir"
                          variant="danger"
                          icon={<Trash2 className="h-4 w-4" />}
                          onClick={() => setToDelete(p)}
                        />
                        {/* Botão de verdade, e não seta decorativa: abrir a
                            ficha era possível SÓ com o mouse, clicando na linha.
                            Quem navega por teclado passava por Editar e Excluir e
                            nunca alcançava a ficha — que é onde estão partes,
                            valores, apensos e histórico. */}
                        <IconButton
                          label={`Abrir ficha de ${p.numero_cnj ?? 'crédito'}`}
                          icon={<ChevronRight className="h-4 w-4" />}
                          onClick={() => setDetalhe(p)}
                        />
                      </div>
                    </TD>
                  </TR>
                  {apensos.detailRow(p.id, N_COLUNAS)}
                  </Fragment>
                )
              })}
            </TBody>
          </Table>
        )}
      </Card>

      <Modal
        open={!!editing}
        onClose={fecharTudo}
        title={editing?.id ? 'Editar crédito' : 'Novo crédito'}
        size="lg"
        dirty={dirty}
        footer={
          <>
            <Button variant="outline" onClick={fecharForm}>
              Cancelar
            </Button>
            {/* Na aba Automatizado o Salvar só aparece depois de uma pasta
                preencher os campos: antes disso ele prometeria gravar um
                formulário vazio e travado. */}
            {(abaForm === 'manual' || !!editing?.id || autoPreenchido) && (
              <Button
                type="submit"
                form="form-processo"
                loading={create.isPending || update.isPending}
              >
                Salvar
              </Button>
            )}
          </>
        }
      >
        {/* Só no cadastro NOVO. Editar um crédito que já existe não tem por que
            passar pela descoberta de pastas — a pasta dele já é conhecida. */}
        {editing && !editing.id && (
          <div className="mb-4">
            <Tabs
              items={ABAS_NOVO_CREDITO}
              value={abaForm}
              onChange={(k) => setAbaForm(k as typeof abaForm)}
            />
          </div>
        )}

        {/* Linha divisória: separa a ESCOLHA da pasta do PREENCHIMENTO do crédito.
            São dois momentos diferentes do trabalho, e sem a divisão o campo de
            busca parecia o primeiro campo do formulário. */}
        {editing && abaForm === 'auto' && !editing.id && (
          <div className="mb-4 border-b border-slate-200 pb-4">
            <NovoCreditoDoDrive processos={data} onPreencher={preencherDoDrive} />
          </div>
        )}

        {editing && (
          <form id="form-processo" onSubmit={handleSubmit}>
            {/* Os campos aparecem NAS DUAS abas, e na automatizada nascem
                bloqueados: sem pasta escolhida não há o que editar, e um
                formulário em branco e mexível ao lado de um campo de busca convida
                a preencher à mão justamente onde a ideia era não precisar.
                Escolher a pasta preenche e libera.

                <fieldset disabled> em vez de `disabled` em cada campo: são
                dezenas, e um esquecido seria um campo editável no meio de campos
                travados — o tipo de inconsistência que ninguém reporta e todo
                mundo estranha. O navegador propaga para tudo o que está dentro. */}
            <fieldset
              disabled={abaForm === 'auto' && !editing.id && !autoPreenchido}
              className="m-0 min-w-0 space-y-4 border-0 p-0"
            >
            <Field label="Número do processo" required error={erros.numero_cnj}>
              <Input
                value={editing.numero_cnj ?? ''}
                onChange={(e) => {
                  setEditing({ ...editing, numero_cnj: e.target.value })
                  // Digitar no campo limpa o erro de validação dele.
                  if (erros.numero_cnj) setErros({})
                }}
                placeholder="0000000-00.0000.0.00.0000"
              />
            </Field>
            {/* O SEGUNDO NÚMERO DO PRECATÓRIO. Precatório tramita em dois lugares:
                o processo judicial, onde a dívida foi reconhecida, e um processo
                administrativo no tribunal, por onde ele anda na fila de pagamento.
                RPV não tem esse número, então o campo só existe em precatório — em
                RPV seria um campo vazio permanente convidando a preencher errado.

                A condição inclui "já tem valor" para o caso de a espécie ser
                trocada depois: sem isso, mudar para RPV esconderia um número já
                gravado, que continuaria no banco sem tela para editá-lo. */}
            {(editing.especie_requisitorio === 'precatorio' ||
              !!editing.numero_processo_administrativo) && (
              <Field label="Número do processo administrativo (Precatório)">
                <Input
                  value={editing.numero_processo_administrativo ?? ''}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      numero_processo_administrativo: e.target.value,
                    })
                  }
                />
              </Field>
            )}
            <div className="grid gap-4 sm:grid-cols-3">
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
              <Field label="Vara">
                <Input
                  value={editing.vara ?? ''}
                  onChange={(e) => setEditing({ ...editing, vara: e.target.value })}
                />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Cedente">
                <Input
                  value={editing.cedente ?? ''}
                  onChange={(e) => setEditing({ ...editing, cedente: e.target.value })}
                />
              </Field>
              <Field label="Advogado do cedente">
                <Input
                  value={editing.cedente_advogado ?? ''}
                  onChange={(e) =>
                    setEditing({ ...editing, cedente_advogado: e.target.value })
                  }
                />
              </Field>
              {/* Os dois campos abaixo aceitam texto livre E oferecem quem já
                  existe. A lista não é enfeite: é o nome digitado, normalizado,
                  que identifica a pessoa na aba "Dados pessoais e bancários", e
                  uma letra trocada aqui cria uma segunda pessoa com ficha
                  bancária própria — sem erro na tela, porque as duas linhas
                  parecem certas. */}
              <Field label="Cessionário">
                <ComboboxTexto
                  valor={editing.cessionario ?? ''}
                  onChange={(v) => setEditing({ ...editing, cessionario: v })}
                  opcoes={nomesCessionario}
                  placeholder="Escolha ou digite um nome novo"
                />
              </Field>
              <Field label="Originador">
                <ComboboxTexto
                  valor={editing.originador ?? ''}
                  onChange={(v) => setEditing({ ...editing, originador: v })}
                  opcoes={nomesOriginador}
                  placeholder="Escolha ou digite um nome novo"
                />
              </Field>
              <Field label="Entidade devedora">
                <Input
                  value={editing.entidade_devedora ?? ''}
                  onChange={(e) =>
                    setEditing({ ...editing, entidade_devedora: e.target.value })
                  }
                />
              </Field>
              <Field label="Data de aquisição">
                <Input
                  type="date"
                  value={editing.data_aquisicao ?? ''}
                  onChange={(e) =>
                    setEditing({ ...editing, data_aquisicao: e.target.value })
                  }
                />
              </Field>
              <Field
                label="Expectativa de liquidação"
                error={erros.expectativa_liquidacao}
              >
                <Input
                  type="date"
                  value={editing.expectativa_liquidacao ?? ''}
                  onChange={(e) => {
                    if (erros.expectativa_liquidacao)
                      setErros((v) => ({ ...v, expectativa_liquidacao: '' }))
                    setEditing({ ...editing, expectativa_liquidacao: e.target.value })
                  }}
                />
              </Field>
              <Field
                label="Instrumento"
                // Avisa que o campo condicional oculto será descartado no salvamento.
                hint={
                  editing.instrumento !== 'registro_publico' &&
                  editing.numero_rtdpj?.trim()
                    ? 'Ao salvar sem "Registro público", o nº RTDPJ será descartado.'
                    : undefined
                }
              >
                <Select
                  value={editing.instrumento ?? ''}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      instrumento: (e.target.value || null) as Instrumento | null,
                    })
                  }
                >
                  <option value="">Não informado</option>
                  {Object.entries(INSTRUMENTO).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </Select>
              </Field>
              {editing.instrumento === 'registro_publico' && (
                <Field label="Nº RTDPJ" hint="Opcional. Para mais de um, separe por vírgula.">
                  <Input
                    value={editing.numero_rtdpj ?? ''}
                    onChange={(e) =>
                      setEditing({ ...editing, numero_rtdpj: e.target.value })
                    }
                    placeholder="Número do registro no RTDPJ"
                  />
                </Field>
              )}
              <Field
                label="Status"
                required
                // Avisa que os campos condicionais ocultos serão descartados.
                hint={
                  !emLiquidacao(editing.status) &&
                  (editing.data_liquidacao ||
                    editing.ja_recebido != null ||
                    editing.valor_estimado_complementar != null)
                    ? 'Ao salvar como Ativo, a data de liquidação, o já recebido e o valor estimado complementar serão descartados.'
                    : undefined
                }
              >
                <Select
                  value={editing.status ?? 'ativo'}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      status: e.target.value as StatusProcesso,
                    })
                  }
                >
                  {Object.entries(STATUS_PROCESSO).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </Select>
              </Field>
              {emLiquidacao(editing.status) && (
                <Field label="Data de liquidação" error={erros.data_liquidacao}>
                  <Input
                    type="date"
                    value={editing.data_liquidacao ?? ''}
                    onChange={(e) => {
                      if (erros.data_liquidacao)
                        setErros((v) => ({ ...v, data_liquidacao: '' }))
                      setEditing({ ...editing, data_liquidacao: e.target.value })
                    }}
                  />
                </Field>
              )}
            </div>

            {/* Financeiro do crédito. Fica só aqui e na ficha lateral — de
                propósito fora da tabela, que segue enxuta para escanear. */}
            <div>
              <Field label="Tipo de crédito">
                <div className="flex flex-wrap gap-x-5 gap-y-2 pt-1">
                  {Object.entries(TIPO_CREDITO).map(([k, v]) => (
                    <label
                      key={k}
                      className="flex cursor-pointer items-center gap-2 text-sm text-slate-700"
                    >
                      <input
                        type="checkbox"
                        checked={(editing.tipo_credito ?? []).includes(
                          k as TipoCredito,
                        )}
                        onChange={() => {
                          const atuais = editing.tipo_credito ?? []
                          setEditing({
                            ...editing,
                            tipo_credito: atuais.includes(k as TipoCredito)
                              ? atuais.filter((t) => t !== k)
                              : [...atuais, k as TipoCredito],
                          })
                        }}
                      />
                      {v.label}
                    </label>
                  ))}
                </div>
              </Field>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {/* Dentro da grade, e não numa linha própria: sozinho ele deixava
                    metade da linha em branco. Aqui divide a linha com o capital
                    investido, e o vão que sobra cai no fim da grade. */}
                <Field label="Espécie do requisitório">
                  <Select
                    value={editing.especie_requisitorio ?? ''}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        especie_requisitorio: (e.target.value ||
                          null) as EspecieRequisitorio | null,
                      })
                    }
                  >
                    <option value="">Não informado</option>
                    {Object.entries(ESPECIE_REQUISITORIO).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Capital investido">
                  <CampoMoeda
                    valor={editing.capital_investido}
                    onChange={(v) => setEditing({ ...editing, capital_investido: v })}
                  />
                </Field>
                <Field label="Valor de face">
                  <CampoMoeda
                    valor={editing.valor_face}
                    onChange={(v) => setEditing({ ...editing, valor_face: v })}
                  />
                </Field>
                <Field label="Data de referência">
                  <Input
                    type="date"
                    value={editing.data_referencia ?? ''}
                    onChange={(e) =>
                      setEditing({ ...editing, data_referencia: e.target.value })
                    }
                  />
                </Field>
                <Field label="Índice de atualização">
                  <Select
                    value={editing.indice_atualizacao ?? ''}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        indice_atualizacao: (e.target.value ||
                          null) as IndiceAtualizacao | null,
                      })
                    }
                  >
                    <option value="">Não informado</option>
                    {Object.entries(INDICE_ATUALIZACAO).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                {emLiquidacao(editing.status) && (
                  <>
                    <Field label="Já recebido">
                      <CampoMoeda
                        valor={editing.ja_recebido}
                        onChange={(v) => setEditing({ ...editing, ja_recebido: v })}
                      />
                    </Field>
                    <Field label="Valor estimado complementar">
                      <CampoMoeda
                        valor={editing.valor_estimado_complementar}
                        onChange={(v) =>
                          setEditing({ ...editing, valor_estimado_complementar: v })
                        }
                      />
                    </Field>
                  </>
                )}
              </div>
            </div>
            </fieldset>
          </form>
        )}
      </Modal>

      {/* Ficha completa do crédito — abre ao clicar na linha da tabela. */}
      <Drawer
        open={!!detalhe}
        onClose={() => setDetalhe(null)}
        title={
          detalhe && (
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold tracking-tight text-slate-800">
                  {formatCNJ(detalhe.numero_cnj)}
                </h2>
                <Badge tone={getLabel(STATUS_PROCESSO, detalhe.status).tone}>
                  {getLabel(STATUS_PROCESSO, detalhe.status).label}
                </Badge>
              </div>
              <p className="text-xs text-slate-600">
                {detalhe.cedente || '—'} v. {detalhe.cessionario || '—'}
              </p>
            </div>
          )
        }
        // Sem footer: a ficha é só leitura. Editar e excluir ficam nos botões
        // da própria linha da tabela.
      >
        {detalhe && (
          <>
            <DrawerSection title="Partes">
              <DrawerField label="Cedente">{detalhe.cedente || '—'}</DrawerField>
              <DrawerField label="Advogado do cedente">
                {detalhe.cedente_advogado || '—'}
              </DrawerField>
              <DrawerField label="Cessionário">
                {detalhe.cessionario || '—'}
              </DrawerField>
              <DrawerField label="Originador">
                {detalhe.originador || '—'}
              </DrawerField>
              <DrawerField label="Entidade devedora">
                {detalhe.entidade_devedora || '—'}
              </DrawerField>
            </DrawerSection>

            <DrawerSection title="Processo">
              <DrawerField label="Tribunal">{detalhe.tribunal || '—'}</DrawerField>
              <DrawerField label="Comarca">{detalhe.comarca || '—'}</DrawerField>
              <DrawerField label="Vara">{detalhe.vara || '—'}</DrawerField>
              {/* Só em precatório, como no formulário — RPV não tem processo
                  administrativo, e um "—" fixo aqui afirmaria que falta o dado. */}
              {(detalhe.especie_requisitorio === 'precatorio' ||
                !!detalhe.numero_processo_administrativo) && (
                <DrawerField label="Nº do processo administrativo">
                  {detalhe.numero_processo_administrativo || '—'}
                </DrawerField>
              )}
            </DrawerSection>

            <DrawerSection title="Aquisição e liquidação">
              <DrawerField label="Instrumento">
                {detalhe.instrumento
                  ? getLabel(INSTRUMENTO, detalhe.instrumento).label
                  : '—'}
              </DrawerField>
              <DrawerField label="Nº RTDPJ">
                {detalhe.instrumento === 'registro_publico' && detalhe.numero_rtdpj
                  ? splitRtdpj(detalhe.numero_rtdpj).map((n, i) => (
                      <div key={i}>{n}</div>
                    ))
                  : '—'}
              </DrawerField>
              <DrawerField label="Data de aquisição">
                {formatDate(detalhe.data_aquisicao)}
              </DrawerField>
              <DrawerField label="Expectativa de liquidação">
                {formatDate(detalhe.expectativa_liquidacao)}
              </DrawerField>
              {emLiquidacao(detalhe.status) && (
                <DrawerField label="Data de liquidação">
                  {formatDate(detalhe.data_liquidacao)}
                </DrawerField>
              )}
              <DrawerField label="Espécie do requisitório">
                {detalhe.especie_requisitorio ? (
                  <Badge
                    tone={
                      getLabel(ESPECIE_REQUISITORIO, detalhe.especie_requisitorio).tone
                    }
                  >
                    {getLabel(ESPECIE_REQUISITORIO, detalhe.especie_requisitorio).label}
                  </Badge>
                ) : (
                  '—'
                )}
              </DrawerField>
              {/* Ocupa a linha inteira: são até três selos lado a lado. */}
              <div className="col-span-2">
                <DrawerField label="Tipo de crédito">
                  {detalhe.tipo_credito?.length ? (
                    <div className="flex flex-wrap gap-1.5">
                      {detalhe.tipo_credito.map((t) => {
                        const l = getLabel(TIPO_CREDITO, t)
                        return (
                          <Badge key={t} tone={l.tone}>
                            {l.label}
                          </Badge>
                        )
                      })}
                    </div>
                  ) : (
                    '—'
                  )}
                </DrawerField>
              </div>
              <DrawerField label="Capital investido">
                {formatBRL(detalhe.capital_investido)}
              </DrawerField>
              <DrawerField label="Valor de face">
                {formatBRL(detalhe.valor_face)}
              </DrawerField>
              <DrawerField label="Data de referência">
                {formatDate(detalhe.data_referencia)}
              </DrawerField>
              <DrawerField label="Índice de atualização">
                {detalhe.indice_atualizacao
                  ? getLabel(INDICE_ATUALIZACAO, detalhe.indice_atualizacao).label
                  : '—'}
              </DrawerField>
              {emLiquidacao(detalhe.status) && (
                <>
                  <DrawerField label="Já recebido">
                    {formatBRL(detalhe.ja_recebido)}
                  </DrawerField>
                  <DrawerField label="Valor estimado complementar">
                    {formatBRL(detalhe.valor_estimado_complementar)}
                  </DrawerField>
                </>
              )}
            </DrawerSection>

            <DrawerSection title={`Apensos (${apensosDoDetalhe.length})`}>
              {apensosDoDetalhe.length === 0 ? (
                <p className="col-span-2 text-sm text-slate-600">
                  Nenhum apenso vinculado.
                </p>
              ) : (
                <div className="col-span-2 space-y-2">
                  {apensosDoDetalhe.map((a) => (
                    <div
                      key={a.id}
                      className="rounded-lg border border-slate-200 p-2.5"
                    >
                      <div className="text-sm font-medium text-slate-800">
                        {formatCNJ(a.numero || '')}
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
            <DrawerHistorico numero={detalhe.numero_cnj} />
          </>
        )}
      </Drawer>

      <ConfirmDialog
        open={!!toDelete}
        danger
        loading={remove.isPending}
        // A cascata precisa estar na pergunta: o banco apaga os apensos junto, e
        // eles são cadastro manual (número, classe, tribunal, comarca, vara,
        // polos). Quem excluía um crédito para recadastrá-lo com o número certo
        // perdia os apensos sem nunca ter sido avisado.
        message={
          toDelete && apensos.contagem(toDelete.id) > 0
            ? `Excluir o crédito ${formatCNJ(toDelete.numero_cnj)}? Os ${apensos.contagem(
                toDelete.id,
              )} apensos vinculados serão excluídos também.`
            : `Excluir o crédito ${formatCNJ(toDelete?.numero_cnj)}?`
        }
        confirmLabel="Excluir"
        onConfirm={confirmDelete}
        onClose={() => setToDelete(null)}
      />

      {apensos.modals()}
    </div>
  )
}
