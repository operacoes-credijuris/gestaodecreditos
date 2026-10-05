// As seções do assistente nas Configurações: as Skills, o Roteiro da
// qualificação preliminar e o prompt da Justificativa técnica.

import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FileArchive, Pencil, Trash2, TriangleAlert, Upload } from 'lucide-react'
import { cn } from '@/lib/cn'
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
  CHAVE_DOMINIOS_JUSTIFICATIVA,
  CHAVE_PROMPT_JUSTIFICATIVA,
  DOMINIOS_SUGERIDOS,
  lerDominios,
  montarPrompt,
  PROMPT_JUSTIFICATIVA_PADRAO,
  promptEmVigor,
  VARIAVEIS_DA_JUSTIFICATIVA,
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

  async function alternar(id: string) {
    try {
      await invokeFunction('assistente-skills', { acao: 'alternar', id })
      await qc.invalidateQueries({ queryKey: ['assistente_skills'] })
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  async function remover(id: string) {
    try {
      await invokeFunction('assistente-skills', { acao: 'remover', id })
      await qc.invalidateQueries({ queryKey: ['assistente_skills'] })
      toast.success('Skill removida.')
    } catch (err) {
      toast.error((err as Error).message)
    }
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
        apoio="Pacotes de habilidade da Anthropic (feitos no Claude, subidos como .zip) que o assistente passa a usar. Uma skill ativa vale para todo mundo que usa o assistente."
      />
      {isLoading ? (
        <Loading />
      ) : (
        <>
          <AvisoLeitura error={error} />
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
                        <button
                          type="button"
                          onClick={() => alternar(s.id)}
                          title={s.ativo ? 'Clique para desativar' : 'Clique para ativar'}
                          className="inline-flex min-h-[24px] items-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-anel"
                        >
                          {s.ativo ? (
                            <Selo tom="ok" icone={IconeOk}>
                              Ativa
                            </Selo>
                          ) : (
                            <Selo tom="neutro">Desativada</Selo>
                          )}
                        </button>
                      </TD>
                      <TD className="text-right">
                        <IconButton
                          label={`Remover skill ${s.nome}`}
                          variant="danger"
                          icon={<Trash2 className="h-[16px] w-[16px]" />}
                          onClick={() => remover(s.id)}
                        />
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          )}

          <div className={cn(data && data.length > 0 && 'mt-[16px]')}>
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
                    'cursor-pointer rounded-campo border-[1.5px] border-dashed border-borda-forte bg-superficie-2 p-[12px] text-center text-corpo text-texto-2 transition-colors [&>*]:pointer-events-none',
                    'hover:bg-superficie-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-anel',
                    arrastando && 'border-marca bg-marca-leve',
                  )}
                >
                  {arquivo ? (
                    <>
                      <FileArchive className="mx-auto mb-[6px] block h-[22px] w-[22px] text-texto-3" aria-hidden />
                      <b className="font-semibold text-marca-texto">{arquivo.name}</b> ·{' '}
                      {tamanhoEmKB(arquivo.size)} KB
                    </>
                  ) : (
                    <>
                      <Upload className="mx-auto mb-[6px] block h-[22px] w-[22px] text-texto-3" aria-hidden />
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
                icon={<Upload className="h-[14px] w-[14px]" />}
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
      const { error } = await supabase.from('prompts_operacao').upsert({
        chave: CHAVE_ROTEIRO,
        texto: novo,
        // O QUE ESTAVA VALENDO VIRA O ANTERIOR — é o desfazer de um clique. São
        // 17 mil caracteres que a análise inteira obedece, e quem edita está
        // colando num campo de texto.
        texto_anterior: emVigor,
        atualizado_em: new Date().toISOString(),
        atualizado_por: user?.email ?? null,
      })
      if (error) throw new Error(error.message)
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
            <Selo tom="ok" icone={Pencil}>
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
                  {new Date(data.atualizado_em).toLocaleString('pt-BR')}
                  {data.atualizado_por ? ' por ' + data.atualizado_por : ''}
                </>
              )}
            </span>
            {mudou && (
              <span className="inline-flex items-center gap-s1 text-sm font-semibold text-aviso">
                <TriangleAlert className="h-[14px] w-[14px]" aria-hidden />
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
 * padrão). Ao lado, as variáveis que a plataforma preenche e de onde cada uma
 * sai — a mesma lista que a Edge Function usa. Embaixo, os domínios a que a
 * pesquisa se restringe (vazio = sem restrição).
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
        .in('chave', [CHAVE_PROMPT_JUSTIFICATIVA, CHAVE_DOMINIOS_JUSTIFICATIVA])
      if (error) throw new Error(error.message)
      return (data ?? []) as LinhaDoPrompt[]
    },
  })
  const linhaDoPrompt = data?.find((l) => l.chave === CHAVE_PROMPT_JUSTIFICATIVA)
  const linhaDosDominios = data?.find((l) => l.chave === CHAVE_DOMINIOS_JUSTIFICATIVA)
  const promptSalvo = promptEmVigor(linhaDoPrompt?.texto)
  const dominiosSalvos = lerDominios(linhaDosDominios?.texto ?? '').dominios.join('\n')

  const [prompt, setPrompt] = useState('')
  const [dominios, setDominios] = useState('')
  const [tocado, setTocado] = useState(false)
  const [salvando, setSalvando] = useState(false)

  // O CAMPO NASCE COM O QUE ESTÁ VALENDO, e só para de acompanhar o servidor
  // depois que alguém digita — a mesma regra do roteiro.
  useEffect(() => {
    if (!tocado && !isLoading) {
      setPrompt(promptSalvo)
      setDominios(dominiosSalvos)
    }
  }, [promptSalvo, dominiosSalvos, isLoading, tocado])

  const lidos = lerDominios(dominios)
  const mudouPrompt = prompt.trim() !== promptSalvo.trim()
  const mudouDominios = lidos.dominios.join('\n') !== dominiosSalvos
  const mudou = mudouPrompt || mudouDominios
  const ehOPadrao = promptSalvo.trim() === PROMPT_JUSTIFICATIVA_PADRAO.trim()
  // LEITURA FALHOU, NADA FOI LIDO: salvar gravaria por cima sem saber o que está lá.
  const naoLido = !!error && data === undefined
  const desconhecidas = montarPrompt(prompt, {}).desconhecidas

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
      if (mudouDominios) {
        linhas.push({
          chave: CHAVE_DOMINIOS_JUSTIFICATIVA,
          texto: lidos.dominios.join('\n'),
          texto_anterior: dominiosSalvos,
          atualizado_em: agora,
          atualizado_por: quem,
        })
      }
      const { error } = await supabase.from('prompts_operacao').upsert(linhas)
      if (error) throw new Error(error.message)
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
        apoio='O prompt que a IA segue no botão "Justificativa técnica" da Produção de proposta (RPV, precatório interno e externo).'
        direita={
          ehOPadrao ? null : (
            <Selo tom="ok" icone={Pencil}>
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
          <div className="grid grid-cols-[minmax(0,1fr)] gap-[16px] min-[1180px]:grid-cols-[minmax(0,1fr)_300px]">
            <div className="min-w-0">
              <TituloBloco>Prompt da justificativa técnica</TituloBloco>
              <Textarea
                rows={20}
                className="font-mono text-xs leading-relaxed"
                value={prompt}
                spellCheck={false}
                aria-label="Prompt da justificativa técnica"
                onChange={(e) => {
                  setTocado(true)
                  setPrompt(e.target.value)
                }}
              />
              {desconhecidas.length > 0 && (
                <p className="mt-s2 flex items-start gap-s1.5 text-xs text-aviso">
                  <TriangleAlert className="mt-[1px] h-[14px] w-[14px] shrink-0" aria-hidden />
                  <span>
                    Variável que a plataforma não conhece (fica no texto como está):{' '}
                    {desconhecidas.map((v) => `{{${v}}}`).join(', ')}
                  </span>
                </p>
              )}
            </div>
            <aside aria-label="Variáveis do prompt" className="min-w-0">
              <TituloBloco>Variáveis</TituloBloco>
              <p className="mb-s3 text-xs text-texto-3">
                Escreva entre chaves duplas. O que a plataforma não tiver entra como “(não informado)”.
              </p>
              <dl className="m-0 max-h-[460px] space-y-s3 overflow-y-auto rounded-campo bg-superficie-2 p-s3 scrollbar-thin">
                {VARIAVEIS_DA_JUSTIFICATIVA.map((v) => (
                  <div key={v.nome}>
                    <dt className="font-mono text-xs font-semibold text-marca-texto">{`{{${v.nome}}}`}</dt>
                    <dd className="m-0 text-xs text-texto-2">
                      {v.vale} <span className="text-texto-3">{v.fonte}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            </aside>
          </div>

          <div className="mt-[20px]">
            <TituloBloco>Domínios permitidos na pesquisa</TituloBloco>
            <p className="mb-s2 text-xs text-texto-3">
              Um por linha. Vazio = sem restrição — e é o recomendado: a referência de deságio de mercado quase nunca
              está em site oficial.
            </p>
            <Textarea
              rows={5}
              className="font-mono text-xs leading-relaxed"
              value={dominios}
              spellCheck={false}
              placeholder={'cnj.jus.br\nstf.jus.br'}
              aria-label="Domínios permitidos na pesquisa"
              onChange={(e) => {
                setTocado(true)
                setDominios(e.target.value)
              }}
            />
            <div className="mt-s2 flex flex-wrap items-center gap-s2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setTocado(true)
                  setDominios(DOMINIOS_SUGERIDOS.join('\n'))
                }}
              >
                Usar a lista sugerida de fontes oficiais
              </Button>
              <span className="text-xs text-texto-3">
                {lidos.dominios.length === 0
                  ? 'Sem restrição de domínio.'
                  : `${lidos.dominios.length} domínio(s): a pesquisa só busca e abre páginas deles.`}
              </span>
            </div>
            {lidos.recusados.length > 0 && (
              <p className="mt-s2 flex items-start gap-s1.5 text-xs text-aviso">
                <TriangleAlert className="mt-[1px] h-[14px] w-[14px] shrink-0" aria-hidden />
                <span>Não é domínio e fica de fora ao salvar: {lidos.recusados.join(', ')}</span>
              </p>
            )}
          </div>

          <RodapeSecao>
            <span className="mr-auto text-xs text-texto-3">
              {prompt.length.toLocaleString('pt-BR')} caracteres
              {linhaDoPrompt?.atualizado_em && (
                <>
                  {' · Última alteração em '}
                  {new Date(linhaDoPrompt.atualizado_em).toLocaleString('pt-BR')}
                  {linhaDoPrompt.atualizado_por ? ' por ' + linhaDoPrompt.atualizado_por : ''}
                </>
              )}
            </span>
            {mudou && (
              <span className="inline-flex items-center gap-s1 text-sm font-semibold text-aviso">
                <TriangleAlert className="h-[14px] w-[14px]" aria-hidden />
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
