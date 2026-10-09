// As seções do assistente nas Configurações: as Skills, o Roteiro da
// qualificação preliminar e o prompt da Justificativa técnica.

import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FileArchive, Pencil, Trash2, Upload } from 'lucide-react'
import { cn } from '@/lib/cn'
import { formatDateTime } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import { invokeFunction, invokeFunctionForm } from '@/lib/functions'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/Button'
import { Field, Input, Textarea } from '@/components/ui/Field'
import { IconButton } from '@/components/ui/IconButton'
import { Table, THead, TH, TBody, TR, TD, Loading } from '@/components/ui/Table'
import { useToast } from '@/components/ui/Toast'
import { ROTEIRO_QUALIFICACAO } from '../../../supabase/functions/_shared/roteiroQualificacao.ts'
import {
  CHAVE_PROMPT_JUSTIFICATIVA,
  PROMPT_JUSTIFICATIVA_PADRAO,
  promptEmVigor,
} from '../../../supabase/functions/_shared/justificativaTecnica.ts'
import {
  AvisoLeitura,
  CabecalhoSecao,
  DUAS_COLUNAS,
  GradeCampos,
  IconeOk,
  RodapeSecao,
  Selo,
  TituloBloco,
} from './comum'
import { ehPacoteZip, tamanhoEmKB } from '@/lib/menuDasConfiguracoes'
import type { Pendencia } from './SecoesIntegracoes'

// ----------------------- Skills do assistente -----------------------

interface SkillAssistente {
  id: string
  skill_id: string
  nome: string
  descricao: string | null
  ativo: boolean
  criado_em: string
}

/**
 * Pacotes de Agent Skills da Anthropic (feitos no Claude) que o assistente
 * pode usar. O pacote em si fica hospedado na Anthropic — aqui só se decide
 * QUAIS estão ativas; a Edge Function `assistente` lê essa lista a cada
 * pergunta. Uma skill ativa vale para todo mundo que usa o assistente.
 */
export function SecaoSkills({ pendencia }: { pendencia: Pendencia }) {
  const qc = useQueryClient()
  const toast = useToast()
  const { data, isLoading, error } = useQuery({
    queryKey: ['assistente_skills'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('assistente_skills')
        .select('*')
        .order('criado_em', { ascending: false })
      if (error) throw new Error(error.message)
      return (data ?? []) as SkillAssistente[]
    },
  })

  const [nome, setNome] = useState('')
  const [descricao, setDescricao] = useState('')
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [arrastando, setArrastando] = useState(false)
  const inputArquivo = useRef<HTMLInputElement>(null)

  async function enviar() {
    if (!nome.trim()) {
      toast.error('Dê um nome para a Skill.')
      return
    }
    if (!arquivo) {
      toast.error('Selecione o arquivo .zip da Skill.')
      return
    }
    setEnviando(true)
    try {
      const form = new FormData()
      form.append('nome', nome.trim())
      if (descricao.trim()) form.append('descricao', descricao.trim())
      form.append('arquivo', arquivo)
      await invokeFunctionForm('assistente-skills', form)
      setNome('')
      setDescricao('')
      setArquivo(null)
      if (inputArquivo.current) inputArquivo.current.value = ''
      await qc.invalidateQueries({ queryKey: ['assistente_skills'] })
      toast.success('Skill enviada. O assistente já pode usá-la.')
      pendencia(false)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  /**
   * As skills com uma ação em curso. O "alternar" do servidor LÊ E INVERTE o
   * estado: um clique duplo invertia duas vezes (ou uma, conforme a corrida), e
   * a skill que a pessoa desligou podia continuar ligada para todos. Enquanto a
   * ação corre, os botões daquela skill ficam desligados.
   */
  const [emCurso, setEmCurso] = useState<ReadonlySet<string>>(() => new Set())
  const emCursoRef = useRef(new Set<string>())
  async function comTrava(id: string, acao: () => Promise<void>) {
    if (emCursoRef.current.has(id)) return
    emCursoRef.current.add(id)
    setEmCurso(new Set(emCursoRef.current))
    try {
      await acao()
    } finally {
      emCursoRef.current.delete(id)
      setEmCurso(new Set(emCursoRef.current))
    }
  }

  async function alternar(id: string) {
    await comTrava(id, async () => {
      try {
        await invokeFunction('assistente-skills', { acao: 'alternar', id })
        await qc.invalidateQueries({ queryKey: ['assistente_skills'] })
      } catch (err) {
        toast.error((err as Error).message)
      }
    })
  }

  async function remover(id: string) {
    await comTrava(id, async () => {
      try {
        await invokeFunction('assistente-skills', { acao: 'remover', id })
        await qc.invalidateQueries({ queryKey: ['assistente_skills'] })
        toast.success('Skill removida.')
      } catch (err) {
        toast.error((err as Error).message)
      }
    })
  }

  // SOLTAR O .zip NA CAIXA (item "Novo" da amostra). O seletor de arquivo filtra
  // por `accept=".zip"`; o que se solta não passa por esse filtro, e por isso é
  // conferido aqui — um .rar ou um PDF subiria até a Anthropic só para voltar
  // com um erro que não diz o que houve.
  function soltar(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setArrastando(false)
    const f = e.dataTransfer?.files?.[0]
    if (!f) return
    if (!ehPacoteZip(f.name)) {
      toast.error('O pacote da Skill precisa ser um arquivo .zip.')
      return
    }
    setArquivo(f)
    pendencia(true)
  }

  function escolherPeloTeclado(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      inputArquivo.current?.click()
    }
  }

  return (
    <>
      <CabecalhoSecao
        titulo="Skills do assistente"
        apoio="Pacotes .zip de habilidades, feitos no Claude, que o assistente passa a usar. Uma skill ativa vale para todos."
      />
      {isLoading ? (
        <Loading />
      ) : (
        <>
          <AvisoLeitura error={error} />
          {data && data.length === 0 && (
            <p className="text-corpo text-texto-2">Nenhuma skill enviada ainda.</p>
          )}
          {data && data.length > 0 && (
            <div className="rounded-cartao border border-borda">
              <Table>
                <THead>
                  <tr>
                    <TH>Nome</TH>
                    <TH>Status</TH>
                    <TH className="w-[1%] text-right">
                      <span className="sr-only">Ações</span>
                    </TH>
                  </tr>
                </THead>
                <TBody>
                  {data.map((s) => (
                    <TR key={s.id}>
                      <TD>
                        <p className="font-semibold text-texto">{s.nome}</p>
                        {s.descricao && <p className="text-xs text-texto-3">{s.descricao}</p>}
                      </TD>
                      <TD>
                        {s.ativo ? (
                          <Selo tom="ok" icone={IconeOk}>
                            Ativa
                          </Selo>
                        ) : (
                          <Selo tom="neutro">Desativada</Selo>
                        )}
                      </TD>
                      {/* O LIGA-DESLIGA COMO EM USUÁRIOS (revisão visual 2): o selo só
                          diz o estado, e o botão diz o que o clique faz. Antes o
                          próprio selo era o botão, de 20px e com o nome "Ativa" —
                          o leitor de tela não sabia que ali se desligava a skill. */}
                      <TD className="whitespace-nowrap text-right">
                        <div className="flex items-center justify-end gap-s1">
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`${s.ativo ? 'Desativar' : 'Ativar'} a skill ${s.nome}`}
                            loading={emCurso.has(s.id)}
                            onClick={() => alternar(s.id)}
                          >
                            {s.ativo ? 'Desativar' : 'Ativar'}
                          </Button>
                          <IconButton
                            label={`Remover skill ${s.nome}`}
                            variant="danger"
                            icon={<Trash2 className="h-[16px] w-[16px]" />}
                            disabled={emCurso.has(s.id)}
                            onClick={() => remover(s.id)}
                          />
                        </div>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          )}

          <div className={cn(data && 'mt-s6')}>
            <TituloBloco>Enviar uma skill</TituloBloco>
            <GradeCampos>
              <Field label="Nome">
                <Input
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  placeholder="Ex: Análise de precatório"
                />
              </Field>
              <Field label="Descrição (opcional)">
                <Input value={descricao} onChange={(e) => setDescricao(e.target.value)} />
              </Field>
              <Field label="Arquivo .zip da Skill" className={DUAS_COLUNAS}>
                {/* O SELETOR CONTINUA EXISTINDO, escondido: é ele que filtra por
                    .zip no clique e é por ele que o clique e o teclado abrem a
                    janela de arquivos. A caixa tracejada é só a cara dele. */}
                <input
                  ref={inputArquivo}
                  type="file"
                  accept=".zip"
                  hidden
                  onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
                />
                <div
                  role="button"
                  tabIndex={0}
                  aria-label={
                    arquivo
                      ? `Arquivo escolhido: ${arquivo.name}. Clique para trocar.`
                      : 'Escolher o arquivo .zip da Skill'
                  }
                  onClick={() => inputArquivo.current?.click()}
                  onKeyDown={escolherPeloTeclado}
                  onDragOver={(e) => {
                    e.preventDefault()
                    setArrastando(true)
                  }}
                  onDragLeave={() => setArrastando(false)}
                  onDrop={soltar}
                  className={cn(
                    // Os filhos não recebem o mouse: senão passar do ícone para o
                    // texto contava como sair da caixa, e o realce do arrastar piscava.
                    'cursor-pointer rounded-campo border-[1.5px] border-dashed border-borda-forte bg-superficie-2 p-s3 text-center text-corpo text-texto-2 transition-colors [&>*]:pointer-events-none',
                    'hover:bg-superficie-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-anel',
                    arrastando && 'border-marca bg-marca-leve',
                  )}
                >
                  {arquivo ? (
                    <>
                      <FileArchive className="mx-auto mb-s1.5 block h-[20px] w-[20px] text-texto-3" aria-hidden />
                      <b className="font-semibold text-marca-texto">{arquivo.name}</b> ·{' '}
                      {tamanhoEmKB(arquivo.size)} KB
                    </>
                  ) : (
                    <>
                      <Upload className="mx-auto mb-s1.5 block h-[20px] w-[20px] text-texto-3" aria-hidden />
                      <b className="font-semibold text-marca-texto">Solte o .zip aqui</b> ou clique
                      para escolher
                    </>
                  )}
                </div>
              </Field>
            </GradeCampos>
            <RodapeSecao>
              <Button
                onClick={enviar}
                loading={enviando}
                icon={<Upload className="h-[16px] w-[16px]" />}
              >
                Enviar Skill
              </Button>
            </RodapeSecao>
          </div>
        </>
      )}
    </>
  )
}

// ----------------------- Roteiro da qualificação -----------------------

/** A chave do roteiro na tabela `prompts_operacao` (migration 0065). */
const CHAVE_ROTEIRO = 'qualificacao_preliminar'

interface PromptDaOperacao {
  chave: string
  texto: string
  texto_anterior: string | null
  atualizado_em: string
  atualizado_por: string | null
}

/**
 * O ROTEIRO DA QUALIFICAÇÃO, editável por quem analisa.
 *
 * ELE É O MÉTODO: que fases percorrer, que eixos varrer, o que é proibido
 * afirmar sem fonte. Nasceu dentro do repositório, e ali mudá-lo custava um
 * programador e um deploy — caro demais para um texto que a operação ajusta toda
 * vez que um caso novo ensina alguma coisa.
 *
 * O PADRÃO CONTINUA NO CÓDIGO e é o chão: campo vazio, linha ausente ou banco
 * novo caem nele. Nenhuma análise roda sem método, nem por salvamento em branco.
 */
export function SecaoRoteiro({ pendencia }: { pendencia: Pendencia }) {
  const qc = useQueryClient()
  const toast = useToast()
  const { user } = useAuth()
  const { data, isLoading, error } = useQuery({
    queryKey: ['prompts_operacao', CHAVE_ROTEIRO],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('prompts_operacao')
        .select('*')
        .eq('chave', CHAVE_ROTEIRO)
        .maybeSingle()
      if (error) throw new Error(error.message)
      return (data ?? null) as PromptDaOperacao | null
    },
  })

  const emVigor = (data?.texto ?? '').trim() || ROTEIRO_QUALIFICACAO
  const [texto, setTexto] = useState('')
  const [tocado, setTocado] = useState(false)
  const [salvando, setSalvando] = useState(false)

  // O CAMPO NASCE COM O QUE ESTÁ VALENDO, e só para de acompanhar o servidor
  // depois que alguém digita: recarregar a lista não pode apagar a edição em
  // curso, e abrir a tela não pode mostrar texto velho.
  useEffect(() => {
    if (!tocado && !isLoading) setTexto(emVigor)
  }, [emVigor, isLoading, tocado])

  const mudou = texto.trim() !== emVigor.trim()
  const ehOPadrao = emVigor.trim() === ROTEIRO_QUALIFICACAO.trim()
  // LEITURA FALHOU, NADA FOI LIDO: o campo nasceu com o PADRÃO, não com o roteiro
  // em vigor. Salvar daqui gravaria o padrão editado por cima do roteiro real, e o
  // padrão viraria o "texto anterior" — o desfazer de um clique iria junto. Mesma
  // trava dos Parâmetros de atualização: sem leitura, não se salva por cima.
  const naoLido = !!error && data === undefined

  // O LÁPIS DO MENU SEGUE O `mudou`, e não "alguém digitou": voltar ao texto em
  // vigor apaga a pendência. O `tocado` evita o lápis piscar no instante em que
  // o campo ainda está vazio, antes de receber o texto do servidor.
  const pendente = tocado && mudou
  useEffect(() => {
    pendencia(pendente)
  }, [pendente, pendencia])

  async function gravar(novo: string, recado: string) {
    if (naoLido) return
    setSalvando(true)
    try {
      const linha: PromptDaOperacao = {
        chave: CHAVE_ROTEIRO,
        texto: novo,
        // O QUE ESTAVA VALENDO VIRA O ANTERIOR — é o desfazer de um clique. São
        // 17 mil caracteres que a análise inteira obedece, e quem edita está
        // colando num campo de texto.
        texto_anterior: emVigor,
        atualizado_em: new Date().toISOString(),
        atualizado_por: user?.email ?? null,
      }
      const { error } = await supabase.from('prompts_operacao').upsert(linha)
      if (error) throw new Error(error.message)
      // O GRAVADO ENTRA NO CACHE ANTES DE SOLTAR O CAMPO: solto, o campo volta a
      // acompanhar o servidor — e, até a releitura chegar (ou se ela falhar), ele
      // voltava ao texto ANTIGO sob o aviso de "salvo", e o próximo Salvar
      // gravava esse antigo como "texto anterior".
      qc.setQueryData(['prompts_operacao', CHAVE_ROTEIRO], linha)
      setTocado(false)
      await qc.invalidateQueries({ queryKey: ['prompts_operacao', CHAVE_ROTEIRO] })
      toast.success(recado)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <>
      <CabecalhoSecao
        titulo="Roteiro da qualificação preliminar"
        apoio='O texto que a conversa do Claude segue no "Executar análise" do Externo.'
        // SÓ O SELO DE EDITADO. Estar no padrão é o estado comum, e um selo que
        // aparece sempre não informa nada — o que vale a pena flagrar é o texto
        // ter saído do que o sistema entrega.
        direita={
          ehOPadrao ? null : (
            <Selo tom="neutro" icone={Pencil}>
              Editado pela operação
            </Selo>
          )
        }
      />
      <AvisoLeitura error={error} />
      {isLoading ? (
        <Loading />
      ) : (
        <>
          <Textarea
            rows={18}
            className="font-mono text-xs leading-relaxed"
            value={texto}
            spellCheck={false}
            aria-label="Roteiro da qualificação preliminar"
            onChange={(e) => {
              setTocado(true)
              setTexto(e.target.value)
            }}
          />

          {/* UMA LINHA SÓ, com o Salvar à direita: contagem e data à esquerda, o
              aviso de não salvo junto do botão. Cada faixa a mais embaixo de um
              campo de dezoito linhas empurraria o botão para fora da vista. */}
          <RodapeSecao>
            <span className="mr-auto text-xs text-texto-3">
              {texto.length.toLocaleString('pt-BR')} caracteres
              {data?.atualizado_em && (
                <>
                  {' · Última alteração em '}
                  {formatDateTime(data.atualizado_em)}
                  {data.atualizado_por ? ' por ' + data.atualizado_por : ''}
                </>
              )}
            </span>
            {mudou && (
              <span className="inline-flex items-center gap-s1 text-sm font-semibold text-aviso">
                <Pencil className="h-[16px] w-[16px]" aria-hidden />
                alterações não salvas
              </span>
            )}
            <Button
              onClick={() => gravar(texto, 'Roteiro salvo. A próxima análise já o usa.')}
              disabled={!mudou || salvando || naoLido}
              loading={salvando}
              title={
                naoLido
                  ? 'O roteiro atual não foi lido: salvar agora gravaria por cima sem saber o que está lá.'
                  : undefined
              }
            >
              Salvar
            </Button>
          </RodapeSecao>
        </>
      )}
    </>
  )
}

// ----------------------- Justificativa técnica -----------------------

interface LinhaDoPrompt {
  chave: string
  texto: string | null
  atualizado_em: string | null
  atualizado_por: string | null
}

/** A chave da consulta das duas linhas da justificativa em `prompts_operacao`. */
const CONSULTA_DA_JUSTIFICATIVA = ['prompts_operacao', CHAVE_PROMPT_JUSTIFICATIVA] as const

/**
 * O PROMPT DA JUSTIFICATIVA TÉCNICA, como o roteiro da qualificação: texto
 * longo em `prompts_operacao`, com o padrão no código como chão (campo vazio =
 * padrão).
 *
 * SÓ O PROMPT (decisão do dono, 05/10/2026): ele é só instrução — os dados do
 * crédito vão junto sozinhos (ver `montarPrompt`) — e a pesquisa é livre na
 * internet. A lista de variáveis e o campo de domínios saíram da tela; a Edge
 * Function também ignora qualquer lista de domínios que tenha ficado salva.
 *
 * SÓ ADMIN EDITA porque esta tela inteira é de admin (o guarda da rota).
 * "Restaurar padrão" só põe o padrão no campo: salvar continua sendo um clique
 * de quem decide, e o texto anterior fica guardado para desfazer.
 */
export function SecaoJustificativa({ pendencia }: { pendencia: Pendencia }) {
  const qc = useQueryClient()
  const toast = useToast()
  const { user } = useAuth()
  const { data, isLoading, error } = useQuery({
    queryKey: CONSULTA_DA_JUSTIFICATIVA,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('prompts_operacao')
        .select('chave, texto, atualizado_em, atualizado_por')
        .eq('chave', CHAVE_PROMPT_JUSTIFICATIVA)
      if (error) throw new Error(error.message)
      return (data ?? []) as LinhaDoPrompt[]
    },
  })
  const linhaDoPrompt = data?.find((l) => l.chave === CHAVE_PROMPT_JUSTIFICATIVA)
  const promptSalvo = promptEmVigor(linhaDoPrompt?.texto)

  const [prompt, setPrompt] = useState('')
  const [tocado, setTocado] = useState(false)
  const [salvando, setSalvando] = useState(false)

  // O CAMPO NASCE COM O QUE ESTÁ VALENDO, e só para de acompanhar o servidor
  // depois que alguém digita — a mesma regra do roteiro.
  useEffect(() => {
    if (!tocado && !isLoading) {
      setPrompt(promptSalvo)
    }
  }, [promptSalvo, isLoading, tocado])

  const mudouPrompt = prompt.trim() !== promptSalvo.trim()
  const mudou = mudouPrompt
  const ehOPadrao = promptSalvo.trim() === PROMPT_JUSTIFICATIVA_PADRAO.trim()
  // LEITURA FALHOU, NADA FOI LIDO: salvar gravaria por cima sem saber o que está lá.
  const naoLido = !!error && data === undefined

  const pendente = tocado && mudou
  useEffect(() => {
    pendencia(pendente)
  }, [pendente, pendencia])

  async function salvar() {
    if (naoLido) return
    setSalvando(true)
    try {
      const agora = new Date().toISOString()
      const quem = user?.email ?? null
      const linhas: Record<string, unknown>[] = []
      if (mudouPrompt) {
        linhas.push({
          chave: CHAVE_PROMPT_JUSTIFICATIVA,
          // O PADRÃO NÃO SE GRAVA COMO TEXTO: salvar o padrão grava vazio, e o
          // campo continua acompanhando o padrão do código quando ele melhorar.
          texto: prompt.trim() === PROMPT_JUSTIFICATIVA_PADRAO.trim() ? '' : prompt,
          texto_anterior: promptSalvo,
          atualizado_em: agora,
          atualizado_por: quem,
        })
      }
      const { error } = await supabase.from('prompts_operacao').upsert(linhas)
      if (error) throw new Error(error.message)
      // O gravado entra no cache antes de soltar o campo (ver o Roteiro).
      if (mudouPrompt) {
        const gravada = linhas[0] as unknown as LinhaDoPrompt
        qc.setQueryData<LinhaDoPrompt[]>(CONSULTA_DA_JUSTIFICATIVA, (antes) => [
          ...(antes ?? []).filter((l) => l.chave !== CHAVE_PROMPT_JUSTIFICATIVA),
          gravada,
        ])
      }
      setTocado(false)
      await qc.invalidateQueries({ queryKey: CONSULTA_DA_JUSTIFICATIVA })
      toast.success('Justificativa técnica salva. A próxima geração já a usa.')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <>
      <CabecalhoSecao
        titulo="Justificativa técnica"
        apoio='O prompt do botão "Justificativa técnica" da Produção de proposta (RPV, precatório interno e externo).'
        direita={
          ehOPadrao ? null : (
            <Selo tom="neutro" icone={Pencil}>
              Editado pela operação
            </Selo>
          )
        }
      />
      <AvisoLeitura error={error} />
      {isLoading ? (
        <Loading />
      ) : (
        <>
          {/* COMO O ROTEIRO, A IRMÃ DELA (revisão visual 2): o campo direto, sem o
              título de bloco que repetia o da seção, na mesma altura (18 linhas)
              e com a dica de UMA linha no lugar de sempre — a do Field, ligada
              ao campo para o leitor de tela. */}
          <Field hint="Só as instruções: os dados do crédito (cedente, processo, valores, proposta e cotações) vão junto, e a pesquisa é livre na internet.">
            <Textarea
              rows={18}
              className="font-mono text-xs leading-relaxed"
              value={prompt}
              spellCheck={false}
              aria-label="Prompt da justificativa técnica"
              onChange={(e) => {
                setTocado(true)
                setPrompt(e.target.value)
              }}
            />
          </Field>

          <RodapeSecao>
            <span className="mr-auto text-xs text-texto-3">
              {prompt.length.toLocaleString('pt-BR')} caracteres
              {linhaDoPrompt?.atualizado_em && (
                <>
                  {' · Última alteração em '}
                  {formatDateTime(linhaDoPrompt.atualizado_em)}
                  {linhaDoPrompt.atualizado_por ? ' por ' + linhaDoPrompt.atualizado_por : ''}
                </>
              )}
            </span>
            {mudou && (
              <span className="inline-flex items-center gap-s1 text-sm font-semibold text-aviso">
                <Pencil className="h-[16px] w-[16px]" aria-hidden />
                alterações não salvas
              </span>
            )}
            <Button
              variant="ghost"
              onClick={() => {
                setTocado(true)
                setPrompt(PROMPT_JUSTIFICATIVA_PADRAO)
              }}
              disabled={prompt.trim() === PROMPT_JUSTIFICATIVA_PADRAO.trim()}
              title="Põe o prompt padrão no campo. Nada é gravado até Salvar."
            >
              Restaurar padrão
            </Button>
            <Button
              onClick={() => void salvar()}
              disabled={!mudou || salvando || naoLido}
              loading={salvando}
              title={
                naoLido
                  ? 'O prompt atual não foi lido: salvar agora gravaria por cima sem saber o que está lá.'
                  : undefined
              }
            >
              Salvar
            </Button>
          </RodapeSecao>
        </>
      )}
    </>
  )
}
