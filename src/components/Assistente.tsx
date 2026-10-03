import { Suspense, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Sparkles,
  X,
  ArrowRight,
  AlertCircle,
  Menu,
  Trash2,
  Paperclip,
  ChevronDown,
  Check,
  Plus,
  MessageCircle,
  RefreshCw,
  Copy,
} from 'lucide-react'
import { invokeFunction, invokeFunctionForm } from '@/lib/functions'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/components/ui/Toast'
import { IconButton } from '@/components/ui/IconButton'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { BotaoCopiar, useCopiarTexto } from '@/components/ui/BotaoCopiar'
import { gravarPreferencia, lerPreferenciaValida } from '@/lib/preferencias'
import { chaveDoRascunho, LIMITE_DO_RASCUNHO, textoDaConversa } from '@/lib/conversaDoAssistente'
import { formatDateTime } from '@/lib/format'
import { haDialogoAberto } from '@/lib/dialogo'
import { pecaSobDemanda } from '@/lib/telaSobDemanda'
import {
  BUCKET_ARQUIVOS,
  caminhoDoArquivo,
  type ArquivoGerado,
} from '@/lib/arquivosDoAssistente'
import { cn } from '@/lib/cn'
import type { Processo } from '@/lib/types'

// O ASSISTENTE MORA EM TODA TELA, mas o leitor de Markdown (react-markdown e o
// GFM) e a janela de petição só servem com ele aberto e respondendo. Importados
// direto, iam no pacote de entrada de toda a plataforma; sob demanda, chegam na
// primeira resposta (e a janela, na primeira petição confirmada).
// FALHANDO O PEDAÇO (rede, versão nova publicada), as reservas abaixo: o texto
// cru no lugar do formatado, e um aviso no lugar da janela — nunca a plataforma
// em branco (ver `pecaSobDemanda`).
const TextoIA = pecaSobDemanda(
  () => import('@/components/ui/TextoIA').then((m) => m.TextoIA),
  ({ texto }: { texto: string }) => <p className="whitespace-pre-wrap">{texto}</p>,
)
const PeticaoModal = pecaSobDemanda(
  () => import('@/components/PeticaoModal').then((m) => m.PeticaoModal),
  PeticaoIndisponivel,
)

function PeticaoIndisponivel({ onClose }: { onClose: () => void }) {
  const toast = useToast()
  useEffect(() => {
    toast.error('Não foi possível abrir a revisão da petição agora. Recarregue a página e tente de novo.')
    onClose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

/**
 * O modelo escolhido, guardado neste navegador. EM try/catch: com o
 * armazenamento bloqueado (janela anônima restrita, política da empresa), ler o
 * `localStorage` LANÇA — e o assistente, que é montado em toda tela, levava a
 * plataforma inteira junto, com a página em branco.
 */
function lerModeloGuardado(): string | null {
  try {
    return localStorage.getItem(CHAVE_MODELO_LOCAL)
  } catch {
    return null
  }
}
function guardarModelo(key: string) {
  try {
    localStorage.setItem(CHAVE_MODELO_LOCAL, key)
  } catch {
    /* sem armazenamento: a escolha vale até fechar a aba */
  }
}

interface AcaoProposta {
  tipo: 'gerar_peticao'
  processo_id: string
  numero_cnj: string | null
  cessionario: string | null
  instrucao: string
}

interface ContatoSugerido {
  nome_contato: string | null
  whatsapp: string
  mensagem: string
}

interface Mensagem {
  role: 'user' | 'assistant'
  content: string
  /** Presente só na última resposta que propôs uma ação — some ao confirmar/cancelar. */
  acaoProposta?: AcaoProposta
  /** Arquivos que uma Skill gerou nesta resposta (ver Configurações → Skills). */
  arquivos?: ArquivoGerado[]
  /** Contato + mensagem prontos pra abrir o WhatsApp e copiar de um clique. */
  contatoSugerido?: ContatoSugerido
}

interface RespostaAssistente {
  resposta: string
  /** O modelo bateu no limite de tokens: o texto está incompleto. */
  truncada?: boolean
  acao_proposta?: AcaoProposta
  contato_sugerido?: ContatoSugerido
  arquivos?: ArquivoGerado[]
}

interface ConversaSalva {
  id: string
  titulo: string
  mensagens: Mensagem[]
  atualizado_em: string
}

interface SkillOpcao {
  id: string
  skill_id: string
  nome: string
}

// Sugestões de partida: o painel em branco não dá pista do que ele sabe
// responder, e "pergunte qualquer coisa" na prática vira nenhuma pergunta.
const SUGESTOES = [
  'Entrar em contato com a serventia',
  'Quais processos estão conclusos para decisão?',
  'Quais créditos estão próximos da data de liquidação?',
  'Consultar processos por situação',
]

const MODELOS = [
  { key: 'claude-haiku-4-5-20251001', label: 'Haiku' },
  { key: 'claude-sonnet-5', label: 'Sonnet' },
  { key: 'claude-opus-5', label: 'Opus' },
]
const MODELO_PADRAO = 'claude-sonnet-5'
const CHAVE_MODELO_LOCAL = 'assistente_modelo'

/**
 * Assistente flutuante de perguntas sobre os dados do sistema.
 *
 * Toda a inteligência fica na Edge Function `assistente` — aqui só há a
 * conversa. A chave da API nunca passa pelo navegador. O modelo (Sonnet,
 * Opus, Haiku) é escolha de quem está usando, guardada neste navegador; as
 * ferramentas de leitura, a possível ação proposta (gerar petição) e as
 * Skills habilitadas continuam decisão exclusiva do backend.
 */
export function Assistente() {
  const { user, profile } = useAuth()
  const primeiroNome = profile?.nome?.trim().split(/\s+/)[0]
  const toast = useToast()
  const qc = useQueryClient()

  const [aberto, setAberto] = useState(false)
  const [mensagens, setMensagens] = useState<Mensagem[]>([])
  // O RASCUNHO DA PERGUNTA FICA GUARDADO neste navegador, por pessoa
  // (lib/conversaDoAssistente.ts): recarregar a página — ou o "recarregar" do
  // aviso de versão nova — não leva embora a pergunta longa pela metade.
  const chaveRascunho = chaveDoRascunho(user?.id)
  const [texto, setTexto] = useState(() =>
    chaveRascunho
      ? lerPreferenciaValida(chaveRascunho, '', (v): v is string => typeof v === 'string')
      : '',
  )
  useEffect(() => {
    if (!chaveRascunho || texto.length > LIMITE_DO_RASCUNHO) return
    gravarPreferencia(chaveRascunho, texto)
  }, [chaveRascunho, texto])
  const copiar = useCopiarTexto()
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [modelo, setModelo] = useState(() => lerModeloGuardado() || MODELO_PADRAO)

  // Histórico de conversas
  const [historicoAberto, setHistoricoAberto] = useState(false)
  const [conversaAtualId, setConversaAtualId] = useState<string | null>(null)
  const [excluirId, setExcluirId] = useState<string | null>(null)

  // Ação proposta confirmada: abre a mesma tela de revisão da tela de Execução.
  const [peticaoAlvo, setPeticaoAlvo] = useState<{
    processo: Processo
    instrucao: string
    numeroCnj: string | null
  } | null>(null)

  const [modeloAberto, setModeloAberto] = useState(false)
  const modeloRef = useRef<HTMLDivElement>(null)

  // Skills selecionadas PARA ESTA CONVERSA — subconjunto das ativas em
  // Configurações. Começa com todas marcadas (mesmo comportamento de antes de
  // existir o seletor); a pessoa desmarca quem não quer nesta pergunta.
  const [skillsAberto, setSkillsAberto] = useState(false)
  const [skillsSelecionadas, setSkillsSelecionadas] = useState<Set<string>>(new Set())
  const skillsRef = useRef<HTMLDivElement>(null)

  // Arquivos anexados à próxima pergunta — limpos depois do envio.
  const [arquivos, setArquivos] = useState<File[]>([])
  const inputArquivos = useRef<HTMLInputElement>(null)

  const fimDaLista = useRef<HTMLDivElement>(null)
  const campo = useRef<HTMLTextAreaElement>(null)

  const conversasQuery = useQuery({
    queryKey: ['assistente_conversas', user?.id],
    queryFn: async (): Promise<ConversaSalva[]> => {
      const { data, error } = await supabase
        .from('assistente_conversas')
        .select('id, titulo, mensagens, atualizado_em')
        .eq('user_id', user!.id)
        .order('atualizado_em', { ascending: false })
        .limit(10)
      if (error) throw error
      return (data ?? []) as ConversaSalva[]
    },
    enabled: historicoAberto && !!user,
  })

  const skillsQuery = useQuery({
    // SOB A CHAVE DAS CONFIGURAÇÕES ('assistente_skills'): ativar, desativar ou
    // remover uma Skill lá invalida esta lista junto (o React Query casa por
    // prefixo). Com a chave própria de antes, o seletor seguia mostrando a Skill
    // removida — e mandando-a na pergunta — até a lista vencer.
    queryKey: ['assistente_skills', 'ativas'],
    queryFn: async (): Promise<SkillOpcao[]> => {
      const { data, error } = await supabase
        .from('assistente_skills')
        .select('id, skill_id, nome')
        .eq('ativo', true)
        .order('nome')
      if (error) throw error
      return (data ?? []) as SkillOpcao[]
    },
    enabled: aberto,
  })

  // Todas ativas marcadas por padrão — e A SKILL QUE PASSA A EXISTIR DEPOIS
  // também chega marcada. Antes a marcação era feita uma vez só, na primeira
  // lista: a Skill ativada em Configurações com o assistente já usado entrava
  // DESMARCADA, e não era enviada até recarregar a página. O que a pessoa
  // desmarcou continua desmarcado (só as novas entram).
  const skillsConhecidas = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!skillsQuery.data) return
    const novas = skillsQuery.data
      .map((s) => s.skill_id)
      .filter((id) => !skillsConhecidas.current.has(id))
    if (novas.length === 0) return
    novas.forEach((id) => skillsConhecidas.current.add(id))
    setSkillsSelecionadas((atual) => new Set([...atual, ...novas]))
  }, [skillsQuery.data])

  // Rola para a última mensagem a cada troca — sem isso a resposta nova nasce
  // fora da área visível justamente quando a pessoa está esperando por ela.
  useEffect(() => {
    fimDaLista.current?.scrollIntoView({ behavior: 'smooth' })
  }, [mensagens, carregando])

  useEffect(() => {
    if (aberto) campo.current?.focus()
  }, [aberto])

  // AO FECHAR (pelo X ou pelo Esc), O FOCO VOLTA AO BOTÃO FLUTUANTE. Sem isto
  // ele caía no <body> junto com o painel desmontado, e quem navega pelo
  // teclado recomeçava do topo da página. Só depois de ter aberto uma vez: na
  // primeira montagem o botão não pode roubar o foco da tela.
  const botaoFlutuante = useRef<HTMLButtonElement>(null)
  const jaAbriu = useRef(false)
  useEffect(() => {
    if (aberto) {
      jaAbriu.current = true
      return
    }
    if (jaAbriu.current) botaoFlutuante.current?.focus()
  }, [aberto])

  // Esc fecha, como no Drawer e no Modal — MAS SÓ SE NÃO HOUVER DIÁLOGO ABERTO.
  // O Escape chega a todos os listeners: o que era para a confirmação de excluir
  // conversa, para a revisão da petição ou para qualquer janela da página fechava
  // também o assistente, e a conversa sumia da tela junto.
  //
  // A PILHA É LIDA NA CAPTURA, antes de qualquer janela tratar a tecla. Este
  // listener roda por último (window, fase de bolha), e até lá o React já pode
  // ter desmontado a janela que fechou com este mesmo Escape — a pilha estaria
  // vazia e o assistente fecharia junto, que é o defeito.
  //
  // E UMA CAMADA POR VEZ, de dentro para fora: com a lista de modelos ou de
  // Skills aberta, o Escape fecha a lista; com o histórico por cima, fecha o
  // histórico; só então fecha o assistente. Antes, o Escape dado para fechar a
  // listinha de modelos fechava o painel inteiro.
  const camadas = useRef({ menu: false, historico: false })
  camadas.current = { menu: modeloAberto || skillsAberto, historico: historicoAberto }
  useEffect(() => {
    if (!aberto) return
    let haviaDialogo = false
    const naCaptura = (e: KeyboardEvent) => {
      if (e.key === 'Escape') haviaDialogo = haDialogoAberto()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || haviaDialogo) return
      if (camadas.current.menu) {
        setModeloAberto(false)
        setSkillsAberto(false)
      } else if (camadas.current.historico) {
        setHistoricoAberto(false)
      } else {
        setAberto(false)
      }
    }
    window.addEventListener('keydown', naCaptura, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', naCaptura, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [aberto])

  // Clique fora fecha o menu de modelo — mesmo padrão de qualquer dropdown.
  useEffect(() => {
    if (!modeloAberto) return
    const onClick = (e: MouseEvent) => {
      if (modeloRef.current && !modeloRef.current.contains(e.target as Node)) {
        setModeloAberto(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [modeloAberto])

  useEffect(() => {
    if (!skillsAberto) return
    const onClick = (e: MouseEvent) => {
      if (skillsRef.current && !skillsRef.current.contains(e.target as Node)) {
        setSkillsAberto(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [skillsAberto])

  function alternarSkill(skillId: string) {
    setSkillsSelecionadas((atual) => {
      const novo = new Set(atual)
      if (novo.has(skillId)) novo.delete(skillId)
      else novo.add(skillId)
      return novo
    })
  }

  function selecionarArquivos(e: ChangeEvent<HTMLInputElement>) {
    const novos = Array.from(e.target.files ?? [])
    setArquivos((atual) => [...atual, ...novos])
    e.target.value = ''
  }

  function removerArquivo(indice: number) {
    setArquivos((atual) => atual.filter((_, i) => i !== indice))
  }

  function trocarModelo(key: string) {
    setModelo(key)
    guardarModelo(key)
  }

  /**
   * Grava (ou atualiza) a conversa atual. Sempre melhor-esforço: uma falha
   * aqui não pode derrubar a conversa que a pessoa está tendo — o histórico é
   * conveniência, não o produto principal do assistente.
   */
  async function salvarConversa(msgs: Mensagem[]) {
    if (!user) return
    try {
      if (conversaAtualId) {
        await supabase
          .from('assistente_conversas')
          .update({
            mensagens: msgs,
            modelo,
            atualizado_em: new Date().toISOString(),
          })
          .eq('id', conversaAtualId)
      } else {
        const primeira = msgs.find((m) => m.role === 'user')?.content ?? 'Conversa'
        const titulo = primeira.length > 60 ? `${primeira.slice(0, 60)}…` : primeira
        const { data } = await supabase
          .from('assistente_conversas')
          .insert({ user_id: user.id, titulo, mensagens: msgs, modelo })
          .select('id')
          .single()
        if (data) setConversaAtualId(data.id as string)
      }
      qc.invalidateQueries({ queryKey: ['assistente_conversas', user.id] })
    } catch {
      /* histórico é conveniência — não interrompe o chat */
    }
  }

  function novaConversa() {
    setMensagens([])
    setConversaAtualId(null)
    setErro(null)
    setHistoricoAberto(false)
  }

  function carregarConversa(c: ConversaSalva) {
    setMensagens(c.mensagens ?? [])
    setConversaAtualId(c.id)
    setErro(null)
    setHistoricoAberto(false)
    void renovarLinks(c.mensagens ?? [])
  }

  /**
   * Assina de novo os links dos arquivos de uma conversa reaberta.
   *
   * O LINK GRAVADO NO HISTÓRICO VALE UMA HORA (ver lib/arquivosDoAssistente.ts),
   * e o arquivo continua no bucket. A policy do bucket deixa cada um assinar os
   * próprios arquivos, então o navegador resolve sozinho. Falhando, ficam os
   * links antigos — o mesmo que acontecia antes.
   */
  async function renovarLinks(msgs: Mensagem[]) {
    const caminhos = [
      ...new Set(
        msgs
          .flatMap((m) => (m.arquivos ?? []).map(caminhoDoArquivo))
          .filter((c): c is string => !!c),
      ),
    ]
    if (caminhos.length === 0) return
    const { data, error } = await supabase.storage
      .from(BUCKET_ARQUIVOS)
      .createSignedUrls(caminhos, 3600)
    if (error || !data) return
    const novos = new Map<string, string>()
    for (const d of data) if (d.path && d.signedUrl && !d.error) novos.set(d.path, d.signedUrl)
    if (novos.size === 0) return
    setMensagens((atual) =>
      atual.map((m) =>
        m.arquivos
          ? {
              ...m,
              arquivos: m.arquivos.map((f) => {
                const caminho = caminhoDoArquivo(f)
                const url = caminho ? novos.get(caminho) : undefined
                return caminho && url ? { ...f, url, caminho } : f
              }),
            }
          : m,
      ),
    )
  }

  async function confirmarExclusao() {
    if (!excluirId) return
    const id = excluirId
    setExcluirId(null)
    try {
      // O supabase-js NÃO LANÇA: devolve `{ error }`. Sem conferir, a falha
      // passava calada — a conversa continuava no banco, e a atual perdia o
      // vínculo com ela, de modo que a próxima pergunta abria uma conversa nova
      // em vez de continuar aquela.
      const { error } = await supabase.from('assistente_conversas').delete().eq('id', id)
      if (error) throw new Error(`Não foi possível excluir a conversa: ${error.message}`)
      if (id === conversaAtualId) setConversaAtualId(null)
      qc.invalidateQueries({ queryKey: ['assistente_conversas', user?.id] })
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  async function enviar(pergunta: string) {
    const limpa = pergunta.trim()
    if (!limpa || carregando) return

    // O histórico enviado é o de ANTES desta pergunta: a função recebe a
    // pergunta atual separada, no campo `pergunta`.
    const historico = mensagens
    const comPergunta = [...historico, { role: 'user' as const, content: limpa }]
    setMensagens(comPergunta)
    setTexto('')
    setErro(null)
    setCarregando(true)
    const anexos = arquivos
    const skillsArray = [...skillsSelecionadas]
    try {
      let respostaFn: RespostaAssistente
      if (anexos.length > 0) {
        // Anexo exige multipart — o caminho comum (sem anexo) continua indo
        // por invokeFunction, mais simples e mais barato de montar.
        const form = new FormData()
        form.append('pergunta', limpa)
        form.append('historico', JSON.stringify(historico))
        form.append('modelo', modelo)
        form.append('skills', JSON.stringify(skillsArray))
        anexos.forEach((f) => form.append('arquivo', f))
        respostaFn = await invokeFunctionForm<RespostaAssistente>('assistente', form)
      } else {
        respostaFn = await invokeFunction<RespostaAssistente>('assistente', {
          pergunta: limpa,
          historico,
          modelo,
          skills: skillsArray,
        })
      }
      const { resposta, truncada, acao_proposta, contato_sugerido, arquivos: arquivosGerados } =
        respostaFn
      // Aviso no PRÓPRIO texto, e não num selo à parte: lista cortada no meio
      // parece completa, e quem lê usa o pedaço como se fosse o todo.
      const conteudo = truncada
        ? `${resposta}\n\n---\n\n**Resposta interrompida** por tamanho. Peça um recorte menor (por tribunal, por período) para ver o restante.`
        : resposta
      const comResposta: Mensagem[] = [
        ...comPergunta,
        {
          role: 'assistant',
          content: conteudo,
          acaoProposta: acao_proposta,
          arquivos: arquivosGerados,
          contatoSugerido: contato_sugerido,
        },
      ]
      setMensagens(comResposta)
      setArquivos([])
      salvarConversa(comResposta)
    } catch (e) {
      // A pergunta continua na tela; o erro aparece embaixo. Recolher a
      // pergunta obrigaria a pessoa a digitar tudo de novo para tentar.
      setErro((e as Error).message)
    } finally {
      setCarregando(false)
    }
  }

  /**
   * Copia a mensagem sugerida e abre o WhatsApp do número — um clique só,
   * porque separar em "copiar" e "abrir" obriga a pessoa a lembrar de colar
   * depois de já ter mudado de janela.
   */
  async function abrirWhatsapp(contato: ContatoSugerido) {
    try {
      await navigator.clipboard.writeText(contato.mensagem)
      toast.success('Mensagem copiada — cole no WhatsApp que abriu.')
    } catch {
      toast.error('Não consegui copiar a mensagem automaticamente; copie manualmente.')
    }
    const digitos = contato.whatsapp.replace(/\D/g, '')
    window.open(`https://wa.me/${digitos}`, '_blank', 'noopener,noreferrer')
  }

  /** Remove só o cartão de proposta daquela mensagem (Cancelar). */
  function descartarAcao(indice: number) {
    setMensagens((atual) =>
      atual.map((m, i) => (i === indice ? { ...m, acaoProposta: undefined } : m)),
    )
  }

  /** Confirmar: carrega o crédito e abre a MESMA tela de revisão da Execução. */
  async function confirmarAcao(a: AcaoProposta, indice: number) {
    const { data, error } = await supabase
      .from('processos')
      .select('*')
      .eq('id', a.processo_id)
      .maybeSingle()
    if (error || !data) {
      toast.error('Não foi possível carregar o crédito para gerar a petição.')
      return
    }
    descartarAcao(indice)
    setPeticaoAlvo({
      processo: data as Processo,
      instrucao: a.instrucao,
      numeroCnj: a.numero_cnj,
    })
  }

  if (!aberto) {
    return (
      <button
        ref={botaoFlutuante}
        type="button"
        onClick={() => setAberto(true)}
        aria-label="Abrir assistente de dados"
        title="Perguntar ao assistente"
        className={cn(
          'fixed bottom-[20px] right-[20px] z-40 flex h-[56px] w-[56px] items-center justify-center',
          'rounded-full bg-gradient-to-br from-marca-viva to-marca-hover text-white shadow-nivel-2',
          'transition-transform duration-150 hover:scale-105 active:scale-95',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-anel focus-visible:ring-offset-2',
        )}
      >
        <Sparkles className="h-[22px] w-[22px]" />
      </button>
    )
  }

  // Item de menu da amostra (`.pop .mi`): 36px de altura, o ✓ à esquerda.
  const itemDeMenu = cn(
    'flex h-12 w-full items-center gap-[10px] rounded-controle px-[10px] text-left text-corpo text-texto',
    'hover:bg-superficie-3 focus:outline-none focus-visible:bg-superficie-3',
  )
  const menuFlutuante =
    'absolute bottom-full left-0 z-20 mb-1 min-w-[220px] rounded-[12px] border border-borda bg-superficie p-[6px] shadow-nivel-2'

  return (
    <>
      <div
        role="dialog"
        aria-label="Assistente de dados"
        className={cn(
          'fixed z-40 flex flex-col overflow-hidden rounded-[18px] border border-borda',
          'bg-superficie shadow-nivel-3',
          // Celular: ocupa a tela. Desktop: painel no canto, como um chat.
          'inset-x-3 bottom-3 top-16 sm:inset-x-auto sm:top-auto sm:bottom-[20px] sm:right-[20px]',
          'sm:h-[min(620px,calc(100vh-40px))] sm:w-[420px]',
        )}
      >
        <header className="flex items-center gap-[6px] border-b border-borda bg-superficie p-[10px]">
          <IconButton
            label="Histórico de conversas"
            icon={<Menu className="h-[16px] w-[16px]" />}
            onClick={() => setHistoricoAberto((v) => !v)}
          />
          <p className="flex min-w-0 flex-1 items-center gap-[8px] font-display text-corpo font-bold text-texto">
            <Sparkles className="h-[16px] w-[16px] shrink-0 text-marca-texto" />
            <span className="truncate">Assistente de dados</span>
          </p>
          {/* A CONVERSA INTEIRA, em texto corrido, para colar num e-mail ou
              mandar a um colega. Só com conversa na tela. */}
          {mensagens.length > 0 && (
            <IconButton
              label="Copiar conversa"
              icon={<Copy className="h-[16px] w-[16px]" />}
              onClick={() => void copiar(textoDaConversa(mensagens), 'Conversa copiada.')}
            />
          )}
          <IconButton
            label="Fechar assistente"
            icon={<X className="h-[16px] w-[16px]" />}
            onClick={() => setAberto(false)}
          />
        </header>

        {/* O HISTÓRICO COBRE O PAINEL INTEIRO ABAIXO DO CABEÇALHO (o `.asst-hist`
            da amostra), a caixa de pergunta inclusive: escolher uma conversa é
            o que se faz ali, e a pergunta pela metade continua embaixo, intacta. */}
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* Sempre montada (mesmo fechada): é o transform que anima a entrada
              pelo lado — condicionar a montagem trocaria a animação por um
              "pop" instantâneo. */}
          <div
            className={cn(
              'absolute inset-0 z-10 flex flex-col overflow-hidden bg-superficie',
              // `invisible` FECHADO: fora da vista pelo transform, os botões do
              // histórico continuavam na ordem do Tab — o teclado entrava em
              // conversas que não estavam na tela. A visibilidade entra na
              // transição para o painel só sumir DEPOIS de sair deslizando.
              'transition-[transform,visibility] duration-200 ease-out',
              historicoAberto ? 'translate-x-0' : 'invisible -translate-x-full pointer-events-none',
            )}
          >
            <div className="flex items-center gap-[6px] px-3 pb-[6px] pt-3">
              <p className="min-w-0 flex-1 font-display text-corpo font-bold text-texto">
                Conversas
              </p>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                icon={<Plus className="h-[16px] w-[16px]" />}
                onClick={novaConversa}
              >
                Nova
              </Button>
              <IconButton
                label="Fechar histórico"
                icon={<X className="h-[16px] w-[16px]" />}
                onClick={() => setHistoricoAberto(false)}
              />
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-thin px-[8px] pb-[8px]">
              {conversasQuery.isLoading && (
                // O ÍCONE GIRA (a amostra): texto parado parecia lista travada.
                <p role="status" className="flex items-center gap-[6px] p-3 text-sm text-texto-3">
                  <RefreshCw className="h-[14px] w-[14px] shrink-0 animate-spin" aria-hidden />
                  Carregando…
                </p>
              )}
              {conversasQuery.data?.length === 0 && (
                <p className="p-3 text-sm text-texto-3">
                  Nenhuma conversa salva ainda — as últimas 10 aparecem aqui.
                </p>
              )}
              {conversasQuery.data?.map((c) => {
                const atual = c.id === conversaAtualId
                return (
                  <div
                    key={c.id}
                    className={cn(
                      'flex items-center rounded-campo',
                      atual ? 'bg-marca-leve' : 'hover:bg-superficie-3',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => carregarConversa(c)}
                      aria-current={atual ? 'true' : undefined}
                      className={cn(
                        'grid min-w-0 flex-1 rounded-campo px-[10px] py-[8px] text-left',
                        'focus:outline-none focus-visible:ring-2 focus-visible:ring-anel',
                      )}
                    >
                      <span
                        className={cn(
                          'truncate text-corpo font-bold',
                          atual ? 'text-marca-texto' : 'text-texto',
                        )}
                      >
                        {c.titulo}
                      </span>
                      <span className="text-xs text-texto-3">
                        {formatDateTime(c.atualizado_em)}
                      </span>
                    </button>
                    <IconButton
                      label="Excluir conversa"
                      icon={<Trash2 className="h-[16px] w-[16px]" />}
                      onClick={() => setExcluirId(c.id)}
                    />
                  </div>
                )
              })}
            </div>
          </div>

          <div className="relative flex flex-1 flex-col overflow-hidden">
            <div className="flex flex-1 flex-col gap-3 overflow-y-auto scrollbar-thin p-[14px]">
              {mensagens.length === 0 && (
                <div className="my-auto text-center">
                  <div className="mx-auto mb-[8px] flex h-[48px] w-[48px] items-center justify-center rounded-cartao bg-marca-suave text-marca-texto">
                    <Sparkles className="h-[20px] w-[20px]" />
                  </div>
                  <p className="font-display text-xl font-extrabold text-texto">
                    Olá{primeiroNome ? `, ${primeiroNome}` : ''}!
                  </p>
                  {/* A FRASE DE APOIO diz o que ele sabe responder antes das
                      sugestões — o painel só com "Olá" não dava pista nenhuma. */}
                  <p className="mb-[14px] mt-1 text-corpo text-texto-2">
                    Pergunte sobre a carteira, os processos ou os contatos.
                  </p>
                  <div className="grid gap-[6px]">
                    {SUGESTOES.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => enviar(s)}
                        className={cn(
                          'rounded-campo border border-borda bg-superficie-2 px-4 py-[10px] text-left text-sm text-texto',
                          'transition-colors hover:border-marca-viva hover:bg-marca-leve',
                          'focus:outline-none focus-visible:ring-2 focus-visible:ring-anel',
                        )}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {mensagens.map((m, i) =>
                m.role === 'user' ? (
                  <p
                    key={i}
                    className={cn(
                      'max-w-[85%] self-end rounded-[14px_14px_4px_14px] bg-marca px-4 py-[8px]',
                      'whitespace-pre-wrap text-corpo text-white [overflow-wrap:anywhere]',
                    )}
                  >
                    {m.content}
                  </p>
                ) : (
                  // A resposta pode trazer tabela de processos: ocupa a largura
                  // inteira, senão a tabela nasce comprimida.
                  <div
                    key={i}
                    className="relative w-full rounded-[14px_14px_14px_4px] bg-superficie-3 px-4 py-[10px] pr-[34px] text-corpo text-texto"
                  >
                    {/* COPIAR A RESPOSTA com um clique, no canto — a lista de
                        processos ou o texto pronto vão para a conversa com o
                        cliente sem selecionar à mão. */}
                    <BotaoCopiar
                      valor={m.content}
                      rotulo="Copiar resposta"
                      className="absolute right-[6px] top-[6px]"
                    />
                    <div className="[overflow-wrap:anywhere]">
                      {/* Enquanto o leitor de Markdown chega (só na primeira
                          resposta), o texto cru — legível, só sem formatação. */}
                      <Suspense fallback={<p className="whitespace-pre-wrap">{m.content}</p>}>
                        <TextoIA texto={m.content} />
                      </Suspense>
                    </div>

                    {m.arquivos && m.arquivos.length > 0 && (
                      <div className="mt-[8px] grid gap-1">
                        {m.arquivos.map((f) => (
                          <a
                            key={f.url}
                            href={f.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-[6px] text-sm font-semibold text-marca-texto hover:underline"
                          >
                            <Paperclip className="h-[16px] w-[16px] shrink-0" />
                            {f.nome}
                          </a>
                        ))}
                      </div>
                    )}

                    {m.acaoProposta && (
                      <div className="mt-[8px] grid gap-1 rounded-[12px] border border-info-borda bg-marca-leve p-[10px]">
                        <p className="font-bold text-texto">
                          Gerar petição — processo {m.acaoProposta.numero_cnj ?? '(a confirmar)'}
                        </p>
                        <p className="text-texto-2">{m.acaoProposta.instrucao}</p>
                        <p className="text-xs text-texto-3">
                          Abre a tela de revisão de sempre — nada é gerado sem você conferir.
                        </p>
                        <div className="mt-1 flex gap-[6px]">
                          <Button
                            type="button"
                            size="md"
                            onClick={() => confirmarAcao(m.acaoProposta!, i)}
                          >
                            Confirmar
                          </Button>
                          <Button
                            type="button"
                            size="md"
                            variant="ghost"
                            onClick={() => descartarAcao(i)}
                          >
                            Cancelar
                          </Button>
                        </div>
                      </div>
                    )}

                    {m.contatoSugerido && (
                      <button
                        type="button"
                        onClick={() => abrirWhatsapp(m.contatoSugerido!)}
                        className={cn(
                          'mt-[8px] flex w-full items-center gap-[10px] rounded-[12px] border border-sucesso-borda',
                          'bg-sucesso-fundo p-[10px] text-left text-texto transition-colors hover:bg-sucesso-borda/40',
                          'focus:outline-none focus-visible:ring-2 focus-visible:ring-anel',
                        )}
                      >
                        <MessageCircle className="h-[22px] w-[22px] shrink-0 text-sucesso" />
                        <span className="grid min-w-0 flex-1">
                          {m.contatoSugerido.nome_contato && (
                            <span className="truncate text-xs text-sucesso">
                              {m.contatoSugerido.nome_contato}
                            </span>
                          )}
                          <span className="font-bold tabular-nums text-texto">
                            {m.contatoSugerido.whatsapp}
                          </span>
                          <span className="text-xs text-texto-3">
                            Clique para abrir o WhatsApp e copiar a mensagem
                          </span>
                        </span>
                      </button>
                    )}
                  </div>
                ),
              )}

              {carregando && (
                <div
                  role="status"
                  className={cn(
                    'flex w-full items-center gap-[8px] rounded-[14px_14px_14px_4px] bg-superficie-3',
                    'px-4 py-[10px] text-corpo text-texto-2',
                  )}
                >
                  <span className="inline-flex gap-[3px]">
                    <span className="h-[6px] w-[6px] animate-bounce rounded-full bg-texto-3 [animation-delay:0ms]" />
                    <span className="h-[6px] w-[6px] animate-bounce rounded-full bg-texto-3 [animation-delay:150ms]" />
                    <span className="h-[6px] w-[6px] animate-bounce rounded-full bg-texto-3 [animation-delay:300ms]" />
                  </span>
                  Consultando os dados…
                </div>
              )}

              {/* O ERRO FICA NUMA CAIXA À PARTE, depois da conversa: não entra no
                  histórico, e a pergunta continua lá para tentar de novo. */}
              {erro && (
                <div
                  role="alert"
                  className={cn(
                    'mt-[2px] flex items-start gap-[8px] rounded-[12px] border border-perigo-borda',
                    'bg-perigo-fundo px-4 py-[10px] text-corpo text-perigo',
                  )}
                >
                  <AlertCircle className="mt-[2px] h-[16px] w-[16px] shrink-0" />
                  <span className="break-words text-texto">{erro}</span>
                </div>
              )}

              <div ref={fimDaLista} />
            </div>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault()
              enviar(texto)
            }}
            className="grid gap-[6px] border-t border-borda bg-superficie p-[10px]"
          >
            {arquivos.length > 0 && (
              <div className="flex flex-wrap gap-[6px]">
                {arquivos.map((f, i) => (
                  <span
                    key={`${f.name}-${i}`}
                    className="inline-flex h-[24px] max-w-full items-center gap-[6px] rounded-full bg-superficie-3 pl-[8px] text-xs text-texto-2"
                  >
                    <Paperclip className="h-[12px] w-[12px] shrink-0" />
                    <span className="max-w-[160px] truncate">{f.name}</span>
                    <button
                      type="button"
                      onClick={() => removerArquivo(i)}
                      aria-label={`Remover ${f.name}`}
                      title={`Remover ${f.name}`}
                      className={cn(
                        'flex h-[24px] w-[24px] shrink-0 items-center justify-center rounded-full text-texto-3',
                        'hover:bg-borda-forte hover:text-texto focus:outline-none focus-visible:ring-2 focus-visible:ring-anel',
                      )}
                    >
                      <X className="h-[12px] w-[12px]" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <textarea
              ref={campo}
              rows={2}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                // Enter envia, Shift+Enter quebra linha — convenção de chat.
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  enviar(texto)
                }
              }}
              placeholder="Faça uma pergunta…"
              aria-label="Pergunta"
              className={cn(
                'max-h-28 w-full resize-none rounded-campo border border-borda-forte bg-superficie',
                'px-[10px] py-[8px] text-corpo text-texto placeholder:text-texto-3',
                'focus:border-anel focus:outline-none',
              )}
            />

            {/* Seletor de modelo, no mesmo lugar do claude.ai: abaixo da caixa de
                texto, um botão compacto que abre a lista ao clicar. Skills e o
                clipe de anexo ficam do lado dele, e o Enviar na ponta direita. */}
            <div className="flex items-center gap-1">
              <div className="relative" ref={modeloRef}>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setModeloAberto((v) => !v)}
                  aria-haspopup="listbox"
                  aria-expanded={modeloAberto}
                  title="Modelo do assistente"
                  className="px-3"
                >
                  <Sparkles className="h-[16px] w-[16px]" />
                  {MODELOS.find((m) => m.key === modelo)?.label ?? 'Sonnet'}
                  <ChevronDown className="h-[16px] w-[16px]" />
                </Button>

                {modeloAberto && (
                  <div role="listbox" aria-label="Modelo" className={menuFlutuante}>
                    {MODELOS.map((m) => (
                      <button
                        key={m.key}
                        type="button"
                        role="option"
                        aria-selected={m.key === modelo}
                        onClick={() => {
                          trocarModelo(m.key)
                          setModeloAberto(false)
                        }}
                        className={itemDeMenu}
                      >
                        {m.key === modelo ? (
                          <Check className="h-[16px] w-[16px] shrink-0 text-marca-texto" />
                        ) : (
                          <span className="w-[16px] shrink-0" />
                        )}
                        {m.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Só aparece se houver skill ativa — não faz sentido escolher
                  dentro de uma lista vazia. */}
              {skillsQuery.data && skillsQuery.data.length > 0 && (
                <div className="relative" ref={skillsRef}>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setSkillsAberto((v) => !v)}
                    aria-haspopup="listbox"
                    aria-expanded={skillsAberto}
                    title="Skills desta conversa"
                    className="px-3"
                  >
                    {/* Num span só: solto, o "(N)" virava outro item do flex e
                        ganhava o espaço do gap além do próprio. */}
                    <span>
                      Skills
                      {skillsSelecionadas.size > 0 && ` (${skillsSelecionadas.size})`}
                    </span>
                    <ChevronDown className="h-[16px] w-[16px]" />
                  </Button>

                  {skillsAberto && (
                    <div className={menuFlutuante}>
                      <p
                        id="assistente-skills-titulo"
                        className="px-[10px] pb-1 pt-[6px] text-xs font-bold uppercase tracking-wider text-texto-3"
                      >
                        Skills desta conversa
                      </p>
                      <div
                        role="listbox"
                        aria-multiselectable="true"
                        aria-labelledby="assistente-skills-titulo"
                      >
                        {skillsQuery.data.map((s) => {
                          const marcada = skillsSelecionadas.has(s.skill_id)
                          return (
                            <button
                              key={s.id}
                              type="button"
                              role="option"
                              aria-selected={marcada}
                              onClick={() => alternarSkill(s.skill_id)}
                              className={itemDeMenu}
                            >
                              <span
                                className={cn(
                                  'flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-[4px] border',
                                  marcada
                                    ? 'border-marca bg-marca text-white'
                                    : 'border-borda-forte bg-superficie',
                                )}
                              >
                                {marcada && <Check className="h-[12px] w-[12px]" />}
                              </span>
                              <span className="truncate">{s.nome}</span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <input
                ref={inputArquivos}
                type="file"
                multiple
                onChange={selecionarArquivos}
                className="hidden"
              />
              <IconButton
                label="Anexar arquivo"
                icon={<Paperclip className="h-[16px] w-[16px]" />}
                onClick={() => inputArquivos.current?.click()}
              />

              <button
                type="submit"
                disabled={!texto.trim() || carregando}
                aria-label="Enviar pergunta"
                title="Enviar pergunta"
                className={cn(
                  'ml-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-controle',
                  'bg-marca text-white shadow-nivel-1 transition-colors hover:bg-marca-hover active:scale-95',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-anel focus-visible:ring-offset-2',
                  'disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none disabled:hover:bg-marca disabled:active:scale-100',
                )}
              >
                <ArrowRight className="h-[16px] w-[16px]" />
              </button>
            </div>
          </form>
        </div>
      </div>

      <ConfirmDialog
        open={!!excluirId}
        title="Excluir conversa"
        message="A conversa some da lista e não pode ser recuperada. Continuar?"
        confirmLabel="Excluir"
        danger
        onConfirm={confirmarExclusao}
        onClose={() => setExcluirId(null)}
      />

      {/* Montagem condicional de propósito: cada abertura precisa de uma instância
          nova, para `instrucaoInicial` semear o campo de instrução de novo. */}
      {peticaoAlvo && (
        <Suspense fallback={null}>
          <PeticaoModal
            open
            onClose={() => setPeticaoAlvo(null)}
            descricao={null}
            processo={peticaoAlvo.processo}
            apenso={null}
            numeroTarefa={peticaoAlvo.numeroCnj ?? peticaoAlvo.processo.numero_cnj ?? 'Assistente'}
            tarefaId={null}
            instrucaoInicial={peticaoAlvo.instrucao}
          />
        </Suspense>
      )}
    </>
  )
}
