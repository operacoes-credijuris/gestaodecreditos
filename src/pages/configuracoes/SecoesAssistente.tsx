// As seções do assistente nas Configurações: as Skills e o Roteiro da
// qualificação preliminar.

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
              <span className="inline-flex items-center gap-1 text-sm font-semibold text-aviso">
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
