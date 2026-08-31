import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Sparkles,
  X,
  Send,
  AlertCircle,
  Menu,
  Trash2,
  Paperclip,
  ChevronDown,
  Check,
  Puzzle,
  MessageCircle,
} from 'lucide-react'
import { invokeFunction, invokeFunctionForm } from '@/lib/functions'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/components/ui/Toast'
import { IconButton } from '@/components/ui/IconButton'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { TextoIA } from '@/components/ui/TextoIA'
import { PeticaoModal } from '@/components/PeticaoModal'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/cn'
import type { Processo } from '@/lib/types'

interface AcaoProposta {
  tipo: 'gerar_peticao'
  processo_id: string
  numero_cnj: string | null
  cessionario: string | null
  instrucao: string
}

interface ArquivoGerado {
  nome: string
  url: string
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
  const [texto, setTexto] = useState('')
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [modelo, setModelo] = useState(
    () => localStorage.getItem(CHAVE_MODELO_LOCAL) || MODELO_PADRAO,
  )

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
  const skillsInicializado = useRef(false)
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
    queryKey: ['assistente_skills_ativas'],
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

  // Todas ativas marcadas por padrão, uma única vez (quando a lista chega).
  useEffect(() => {
    if (skillsQuery.data && !skillsInicializado.current) {
      setSkillsSelecionadas(new Set(skillsQuery.data.map((s) => s.skill_id)))
      skillsInicializado.current = true
    }
  }, [skillsQuery.data])

  // Rola para a última mensagem a cada troca — sem isso a resposta nova nasce
  // fora da área visível justamente quando a pessoa está esperando por ela.
  useEffect(() => {
    fimDaLista.current?.scrollIntoView({ behavior: 'smooth' })
  }, [mensagens, carregando])

  useEffect(() => {
    if (aberto) campo.current?.focus()
  }, [aberto])

  // Esc fecha, como no Drawer e no Modal.
  useEffect(() => {
    if (!aberto) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAberto(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
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
    localStorage.setItem(CHAVE_MODELO_LOCAL, key)
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
  }

  async function confirmarExclusao() {
    if (!excluirId) return
    const id = excluirId
    setExcluirId(null)
    try {
      await supabase.from('assistente_conversas').delete().eq('id', id)
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
        type="button"
        onClick={() => setAberto(true)}
        aria-label="Abrir assistente de dados"
        title="Perguntar ao assistente"
        className={cn(
          'fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center',
          'rounded-full bg-gradient-to-b from-brand-600 to-brand-700 text-white shadow-lg',
          'transition-all duration-150 hover:from-brand-500 hover:to-brand-600 hover:shadow-xl',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2',
          'active:scale-95',
        )}
      >
        <Sparkles className="h-6 w-6" />
      </button>
    )
  }

  return (
    <>
      <div
        role="dialog"
        aria-label="Assistente de dados"
        className={cn(
          'fixed z-40 flex flex-col overflow-hidden rounded-xl border border-slate-200',
          'bg-white shadow-2xl',
          // Celular: ocupa a tela. Desktop: painel no canto, como um chat.
          'inset-x-3 bottom-3 top-16 sm:inset-x-auto sm:top-auto sm:bottom-5 sm:right-5',
          'sm:h-[min(620px,calc(100vh-4rem))] sm:w-[420px]',
        )}
      >
        <header className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3">
          <IconButton
            label="Histórico de conversas"
            icon={<Menu className="h-4 w-4" />}
            onClick={() => setHistoricoAberto((v) => !v)}
          />
          <Sparkles className="h-4 w-4 shrink-0 text-brand-700" />
          <p className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">
            Assistente de dados
          </p>
          <IconButton
            label="Fechar assistente"
            icon={<X className="h-4 w-4" />}
            onClick={() => setAberto(false)}
          />
        </header>

        {/* Wrapper único (seletor de modelo + mensagens): é sobre ELE que a
            gaveta de histórico se sobrepõe, então ela cobre o seletor
            também — não só a lista de mensagens abaixo dele. */}
        <div className="relative flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 space-y-3 overflow-y-auto scrollbar-thin px-4 py-4">
            {mensagens.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
                <div>
                  <p className="font-display text-lg font-bold text-slate-800">
                    Olá{primeiroNome ? `, ${primeiroNome}` : ''}!
                  </p>
                </div>
                <div className="flex w-full max-w-xs flex-col gap-2">
                  {SUGESTOES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => enviar(s)}
                      className={cn(
                        'rounded-lg border border-slate-200 px-3 py-2 text-left text-sm',
                        'text-slate-700 transition-colors hover:border-brand-300 hover:bg-brand-50',
                        'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
                      )}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {mensagens.map((m, i) => (
              <div
                key={i}
                className={cn(
                  'rounded-lg px-3 py-2 text-sm',
                  m.role === 'user'
                    ? 'ml-auto max-w-[92%] bg-brand-600 text-white'
                    : // A resposta pode trazer tabela de processos: ocupa a
                      // largura inteira, senão a tabela nasce comprimida.
                      'w-full bg-slate-100 text-slate-800',
                )}
              >
                {m.role === 'user' ? (
                  <p className="whitespace-pre-wrap break-words">{m.content}</p>
                ) : (
                  <div className="break-words">
                    <TextoIA texto={m.content} />

                    {m.arquivos && m.arquivos.length > 0 && (
                      <div className="mt-2 flex flex-col gap-1">
                        {m.arquivos.map((f) => (
                          <a
                            key={f.url}
                            href={f.url}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline"
                          >
                            <Paperclip className="h-3.5 w-3.5 shrink-0" />
                            {f.nome}
                          </a>
                        ))}
                      </div>
                    )}

                    {m.acaoProposta && (
                      <div className="mt-3 rounded-lg border border-brand-200 bg-brand-50 p-3">
                        <p className="font-medium text-brand-900">
                          Gerar petição — processo {m.acaoProposta.numero_cnj ?? '(a confirmar)'}
                        </p>
                        <p className="mt-1 text-brand-800">{m.acaoProposta.instrucao}</p>
                        <p className="mt-1.5 text-xs text-brand-700">
                          Abre a tela de revisão de sempre — nada é gerado sem você conferir.
                        </p>
                        <div className="mt-2 flex gap-2">
                          <Button size="sm" onClick={() => confirmarAcao(m.acaoProposta!, i)}>
                            Confirmar
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => descartarAcao(i)}>
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
                          'mt-3 flex w-full items-center gap-2.5 rounded-lg border border-emerald-200',
                          'bg-emerald-50 p-3 text-left transition-colors hover:bg-emerald-100',
                          'focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500',
                        )}
                      >
                        <MessageCircle className="h-5 w-5 shrink-0 text-emerald-700" />
                        <span className="min-w-0 flex-1">
                          {m.contatoSugerido.nome_contato && (
                            <span className="block truncate text-xs text-emerald-700">
                              {m.contatoSugerido.nome_contato}
                            </span>
                          )}
                          <span className="block font-medium text-emerald-900">
                            {m.contatoSugerido.whatsapp}
                          </span>
                          <span className="block text-xs text-emerald-700">
                            Clique para abrir o WhatsApp e copiar a mensagem
                          </span>
                        </span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}

            {carregando && (
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <span className="flex gap-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:0ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:150ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:300ms]" />
                </span>
                Consultando os dados…
              </div>
            )}

            {erro && (
              <div className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="break-words">{erro}</span>
              </div>
            )}

            <div ref={fimDaLista} />
          </div>

          {/* Sempre montada (mesmo fechada): é o transform que anima a entrada
              pelo lado — condicionar a montagem trocaria a animação por um
              "pop" instantâneo. */}
          <div
            className={cn(
              'absolute inset-y-0 left-0 z-10 flex w-[82%] max-w-[280px] flex-col overflow-hidden',
              'border-r border-slate-200 bg-white',
              'transition-transform duration-200 ease-out',
              historicoAberto ? 'translate-x-0' : '-translate-x-full pointer-events-none',
            )}
          >
            <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-sm font-semibold text-slate-800">Conversas</p>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={novaConversa}
                  className="rounded px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50"
                >
                  Nova
                </button>
                <IconButton
                  label="Fechar histórico"
                  icon={<X className="h-4 w-4" />}
                  onClick={() => setHistoricoAberto(false)}
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-thin">
              {conversasQuery.isLoading && (
                <p className="p-4 text-sm text-slate-500">Carregando…</p>
              )}
              {conversasQuery.data?.length === 0 && (
                <p className="p-4 text-sm text-slate-500">
                  Nenhuma conversa salva ainda — as últimas 10 aparecem aqui.
                </p>
              )}
              {conversasQuery.data?.map((c) => (
                <div
                  key={c.id}
                  className={cn(
                    'group flex items-center gap-1 border-b border-slate-100 px-3 py-2.5 hover:bg-slate-50',
                    c.id === conversaAtualId && 'bg-brand-50',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => carregarConversa(c)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="truncate text-sm text-slate-800">{c.titulo}</p>
                    <p className="text-xs text-slate-500">{formatDateTime(c.atualizado_em)}</p>
                  </button>
                  <IconButton
                    label="Excluir conversa"
                    icon={<Trash2 className="h-4 w-4" />}
                    onClick={() => setExcluirId(c.id)}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            enviar(texto)
          }}
          className="border-t border-slate-200 bg-slate-50 px-3 py-3"
        >
          {arquivos.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {arquivos.map((f, i) => (
                <span
                  key={`${f.name}-${i}`}
                  className="flex items-center gap-1 rounded-full bg-slate-200 py-1 pl-2.5 pr-1 text-xs text-slate-700"
                >
                  <Paperclip className="h-3 w-3 shrink-0" />
                  <span className="max-w-[120px] truncate">{f.name}</span>
                  <button
                    type="button"
                    onClick={() => removerArquivo(i)}
                    aria-label={`Remover ${f.name}`}
                    className="rounded-full p-0.5 hover:bg-slate-300"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <textarea
            ref={campo}
            rows={1}
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
            className={cn(
              'max-h-28 min-h-[2.5rem] w-full resize-none rounded-lg border border-slate-300',
              'px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400',
              'focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500',
            )}
          />

          {/* Seletor de modelo, no mesmo lugar do claude.ai: abaixo da caixa de
              texto, um botão compacto que abre a lista ao clicar. Skills e o
              clipe de anexo ficam do lado dele, no mesmo grupo. */}
          <div className="mt-2 flex items-center justify-between">
            <div className="flex items-center gap-1">
              <div className="relative" ref={modeloRef}>
                <button
                  type="button"
                  onClick={() => setModeloAberto((v) => !v)}
                  aria-haspopup="listbox"
                  aria-expanded={modeloAberto}
                  className={cn(
                    'flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-600',
                    'hover:bg-slate-200/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
                  )}
                >
                  <Sparkles className="h-3 w-3" />
                  {MODELOS.find((m) => m.key === modelo)?.label ?? 'Sonnet'}
                  <ChevronDown className="h-3 w-3" />
                </button>

                {modeloAberto && (
                  <div
                    role="listbox"
                    className="absolute bottom-full left-0 z-20 mb-1 w-44 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
                  >
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
                        className={cn(
                          'flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-slate-50',
                          m.key === modelo ? 'font-semibold text-brand-700' : 'text-slate-700',
                        )}
                      >
                        {m.label}
                        {m.key === modelo && <Check className="h-3.5 w-3.5" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Só aparece se houver skill ativa — não faz sentido escolher
                  dentro de uma lista vazia. */}
              {skillsQuery.data && skillsQuery.data.length > 0 && (
                <div className="relative" ref={skillsRef}>
                  <button
                    type="button"
                    onClick={() => setSkillsAberto((v) => !v)}
                    aria-haspopup="listbox"
                    aria-expanded={skillsAberto}
                    className={cn(
                      'flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-600',
                      'hover:bg-slate-200/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
                    )}
                  >
                    <Puzzle className="h-3 w-3" />
                    Skills
                    {skillsSelecionadas.size > 0 && ` (${skillsSelecionadas.size})`}
                    <ChevronDown className="h-3 w-3" />
                  </button>

                  {skillsAberto && (
                    <div
                      role="listbox"
                      aria-multiselectable="true"
                      className="absolute bottom-full left-0 z-20 mb-1 w-52 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
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
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"
                          >
                            <span
                              className={cn(
                                'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                                marcada
                                  ? 'border-brand-600 bg-brand-600 text-white'
                                  : 'border-slate-300',
                              )}
                            >
                              {marcada && <Check className="h-3 w-3" />}
                            </span>
                            <span className="truncate">{s.nome}</span>
                          </button>
                        )
                      })}
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
              <button
                type="button"
                onClick={() => inputArquivos.current?.click()}
                aria-label="Anexar arquivo"
                title="Anexar arquivo"
                className={cn(
                  'flex items-center justify-center rounded-md p-1.5 text-slate-600',
                  'hover:bg-slate-200/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
                )}
              >
                <Paperclip className="h-3.5 w-3.5" />
              </button>
            </div>

            <button
              type="submit"
              disabled={!texto.trim() || carregando}
              aria-label="Enviar pergunta"
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                'bg-gradient-to-b from-brand-600 to-brand-700 text-white transition-all',
                'hover:from-brand-500 hover:to-brand-600 active:scale-95',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
                'disabled:from-brand-300 disabled:to-brand-300 disabled:active:scale-100',
              )}
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </form>
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
      )}
    </>
  )
}
