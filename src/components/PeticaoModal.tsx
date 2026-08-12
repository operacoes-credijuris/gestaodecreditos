// Janela de geração de petição, aberta pelo botão de cada tarefa.
//
// Duas abas, para os dois casos que existem:
//
//   MODELO — o caso comum. Sugere qual dos dez modelos usar lendo a descrição da
//     tarefa e mostra a peça já preenchida com os dados do crédito.
//
//   GERAÇÃO POR IA — a peça fora da curva, para a qual não há modelo. Ao abrir,
//     analisa o histórico do processo e diz onde ele está e que peças cabem; o
//     advogado então pede a peça em texto livre.
//
// As duas terminam no MESMO lugar: texto em markdown → peticaoLayout →
// peticaoDocx → Drive. Uma formatação só, então a peça da IA sai idêntica à de
// modelo — mesmo timbrado, mesmas cores, mesmo recuo de citação.
//
// A sugestão de modelo NUNCA decide sozinha: os dez ficam sempre na lista, porque
// três pares deles colidem na mesma palavra ("sequestro", "registro público",
// "RPV") e porque a descrição da tarefa é texto livre digitado por gente. Pedir
// sequestro não é juntar planilha para fins de sequestro, e protocolar a peça
// errada custa mais que um clique a mais.
import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Copy,
  Download,
  FileText,
  RefreshCw,
  Send,
  Sparkles,
} from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Tabs } from '@/components/ui/Tabs'
import { Select, Textarea } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'
import { Loading } from '@/components/ui/Table'
import { TextoIA } from '@/components/ui/TextoIA'
import {
  aplicarModelo,
  baixarModelo,
  baixarTimbradoBytes,
  NOME_VARIAVEL,
  resolverVariaveis,
  rotulosDesconhecidos,
  sugerirModelos,
  variaveisUsadas,
} from '@/lib/peticao'
import { driveConfigurado } from '@/lib/drive'
import { invokeFunction } from '@/lib/functions'
import { peticaoTemplatesCrud, useInvestidorDados } from '@/lib/queries'
import { formatCNJ } from '@/lib/format'
import type { Processo } from '@/lib/types'

const ABAS = [
  { key: 'modelo', label: 'Modelo', icon: <FileText className="h-4 w-4" /> },
  { key: 'zero', label: 'Geração por IA', icon: <Sparkles className="h-4 w-4" /> },
]

/**
 * Teto do texto que vai no link do app do Claude. A documentação do esquema
 * `claude://` trunca o `q=` em ~14 mil caracteres; ficamos abaixo com folga para
 * a codificação de URL não empurrar o corte para o meio de uma frase.
 */
const MAX_PASSAGEM = 13000

interface RespostaPanorama {
  panorama: string
  gerado_em: string
  do_cache: boolean
}
interface RespostaRedacao {
  titulo: string
  texto: string
  truncada?: boolean
  /** Regras de forma que o texto ainda viola — a peça sai, mas avisada. */
  avisos?: string[]
}

export function PeticaoModal({
  open,
  onClose,
  descricao,
  processo,
  numeroTarefa,
  tarefaId,
}: {
  open: boolean
  onClose: () => void
  /** Descrição da tarefa no ADVBOX — é dela que sai a sugestão do modelo. */
  descricao: string | null
  /** O crédito da tarefa. Nulo quando a tarefa não casou com nenhum cadastrado. */
  processo: Processo | null
  numeroTarefa: string
  /**
   * Id da tarefa no ADVBOX. É a CHAVE DO CACHE do panorama: a mesma execução
   * recebe várias tarefas ao longo do tempo, e cada uma se analisa com um recorte
   * diferente do mesmo processo (ver migração 0035).
   */
  tarefaId: string | null
}) {
  const toast = useToast()
  const qc = useQueryClient()
  const [aba, setAba] = useState('modelo')
  const [idEscolhido, setIdEscolhido] = useState<string | null>(null)
  const [md, setMd] = useState<string | null>(null)
  const [carregandoMd, setCarregandoMd] = useState(false)
  const [erroMd, setErroMd] = useState<string | null>(null)
  const [gerando, setGerando] = useState(false)
  /** Etapa em curso, para o botão dizer o que está acontecendo. */
  const [passo, setPasso] = useState<string | null>(null)
  /** Quando o caminho no Drive não resolve: o motivo e até onde desceu. */
  const [semPasta, setSemPasta] = useState<{
    motivo: string
    caminho: string[]
  } | null>(null)

  // ---------- Estado da aba de IA ----------
  /** O comando do advogado ("peça o sequestro dos valores porque…"). */
  const [instrucao, setInstrucao] = useState('')
  const [redigindo, setRedigindo] = useState(false)
  const [redacao, setRedacao] = useState<RespostaRedacao | null>(null)
  /**
   * O texto da peça, EDITÁVEL. Separado de `redacao` de propósito: a peça vai a
   * protocolo, e obrigar a refazer o prompt por causa de uma vírgula seria
   * absurdo. `redacao` guarda o que a IA devolveu; isto, o que vai ser salvo.
   */
  const [textoIA, setTextoIA] = useState('')

  const templates = peticaoTemplatesCrud.useList()
  const fichas = useInvestidorDados()

  const ativos = useMemo(
    () => (templates.data ?? []).filter((t) => t.ativo && t.arquivo),
    [templates.data],
  )

  const sugeridos = useMemo(
    () => sugerirModelos(descricao, ativos),
    [descricao, ativos],
  )

  // A sugestão entra como valor INICIAL, não como trava: assim que a lista chega,
  // o primeiro sugerido fica escolhido, e a pessoa troca à vontade depois.
  useEffect(() => {
    if (!open) return
    setIdEscolhido((atual) => atual ?? sugeridos[0]?.id ?? ativos[0]?.id ?? null)
  }, [open, sugeridos, ativos])

  // Ao fechar, esquece a escolha e o texto: reabrir noutra tarefa tem de partir da
  // sugestão daquela tarefa, não da anterior. O mesmo vale para a redação da IA —
  // peça escrita para uma tarefa não pode reaparecer na janela de outra.
  useEffect(() => {
    if (open) return
    setIdEscolhido(null)
    setMd(null)
    setErroMd(null)
    setSemPasta(null)
    setAba('modelo')
    setInstrucao('')
    setRedacao(null)
    setTextoIA('')
  }, [open])

  const escolhido = ativos.find((t) => t.id === idEscolhido) ?? null

  /**
   * O que está escolhido é um dos sugeridos?
   *
   * Serve para engrossar o PRÓPRIO campo, e não só a opção na lista: o select
   * nativo desenha o valor fechado com o estilo dele mesmo, ignorando o da opção
   * selecionada. Sem isto, o negrito aparecia ao abrir a lista e desaparecia ao
   * escolher — justamente quando a informação importa.
   *
   * De quebra, o campo desengrossa ao trocar para um modelo fora da sugestão, o
   * que avisa que a escolha saiu do que a ferramenta indicou.
   */
  const escolhidoEhSugerido = !!idEscolhido && sugeridos.some((s) => s.id === idEscolhido)

  // Baixa o .md do bucket quando o modelo muda.
  useEffect(() => {
    if (!open || !escolhido?.arquivo) return
    let cancelado = false
    setCarregandoMd(true)
    setErroMd(null)
    baixarModelo(escolhido.arquivo)
      .then((texto) => {
        if (!cancelado) setMd(texto)
      })
      .catch((err: Error) => {
        if (!cancelado) {
          setMd(null)
          setErroMd(err.message)
        }
      })
      .finally(() => {
        if (!cancelado) setCarregandoMd(false)
      })
    return () => {
      cancelado = true
    }
  }, [open, escolhido?.arquivo])

  const preenchimento = useMemo(
    () => (processo ? resolverVariaveis(processo, fichas.data) : null),
    [processo, fichas.data],
  )

  /**
   * Só as pendências que ESTE modelo usa. A petição de concordância com os
   * cálculos não menciona dados bancários; exigir conta bancária para gerá-la
   * seria bloqueio falso.
   */
  const pendencias = useMemo(() => {
    if (!md || !preenchimento) return []
    const usadas = new Set(variaveisUsadas(md))
    return preenchimento.pendencias.filter((p) => usadas.has(p.variavel))
  }, [md, preenchimento])

  /**
   * Rótulo entre colchetes que o código não conhece: erro de digitação no arquivo
   * do bucket, ou arquivo trocado. Já aconteceu — um modelo foi substituído por
   * um OCR do papel timbrado, e sem esta checagem a petição sairia em branco.
   */
  const desconhecidos = useMemo(() => (md ? rotulosDesconhecidos(md) : []), [md])
  const semRotuloNenhum = !!md && variaveisUsadas(md).length === 0

  const textoFinal = useMemo(
    () => (md && preenchimento ? aplicarModelo(md, preenchimento.valores) : null),
    [md, preenchimento],
  )

  /**
   * Panorama do caso, disparado ao ENTRAR na aba de IA — não ao abrir a janela:
   * quem só quer o modelo não deve pagar análise nenhuma.
   *
   * `staleTime: Infinity` + a chave pela tarefa evitam refazer na mesma sessão; o
   * cache de verdade é no servidor (peticao_panorama), então nem trocar de aba nem
   * recarregar a página custam chamada nova enquanto o processo não andar.
   */
  const chavePanorama = ['peticao-panorama', tarefaId, processo?.id]
  const panorama = useQuery({
    queryKey: chavePanorama,
    queryFn: () =>
      invokeFunction<RespostaPanorama>('peticao-ia', {
        action: 'panorama',
        tarefa_id: tarefaId,
        processo_id: processo?.id,
      }),
    enabled: open && aba === 'zero' && !!tarefaId && !!processo,
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    retry: false,
  })

  const [reanalisando, setReanalisando] = useState(false)

  /**
   * Nova análise, DE VERDADE.
   *
   * Por que não é `panorama.refetch()`: o refetch repete a mesma chamada, e a
   * função devolve o panorama GUARDADO quando a impressão digital dos insumos não
   * mudou — que é o caso normal. O texto voltava idêntico e o botão parecia
   * quebrado. Aqui vai `forcar`, que manda a função ignorar o cache, e o
   * resultado é escrito na chave da consulta para a tela reagir.
   */
  async function reanalisar() {
    if (!processo || !tarefaId || reanalisando) return
    setReanalisando(true)
    try {
      const r = await invokeFunction<RespostaPanorama>('peticao-ia', {
        action: 'panorama',
        tarefa_id: tarefaId,
        processo_id: processo.id,
        forcar: true,
      })
      qc.setQueryData(chavePanorama, r)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setReanalisando(false)
    }
  }

  /** Os dados do crédito que a IA deve usar no texto, com os rótulos dos modelos. */
  const dadosParaIA = useMemo(() => {
    const v = preenchimento?.valores ?? {}
    const saida: Record<string, string> = {}
    for (const [chave, valor] of Object.entries(v)) {
      if (!valor) continue
      const nome = NOME_VARIAVEL[chave as keyof typeof NOME_VARIAVEL]
      if (nome) saida[nome] = valor
    }
    return saida
  }, [preenchimento])

  async function redigir() {
    if (!processo || !instrucao.trim()) return
    setRedigindo(true)
    try {
      const r = await invokeFunction<RespostaRedacao>('peticao-ia', {
        action: 'redigir',
        processo_id: processo.id,
        instrucao: instrucao.trim(),
        panorama: panorama.data?.panorama,
        dados: dadosParaIA,
      })
      setRedacao(r)
      setTextoIA(r.texto)
      if (r.truncada) {
        toast.toast(
          'A resposta atingiu o limite de tamanho e pode estar incompleta. Confira o fecho.',
          'info',
        )
      }
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setRedigindo(false)
    }
  }

  /**
   * Passa o caso adiante para o app do Claude, onde o refinamento continua sem
   * consumir a API.
   *
   * FAZ AS DUAS COISAS, e é de propósito: o esquema `claude://` só funciona com o
   * app instalado — no navegador puro, clicar não faria nada. Copiando primeiro, a
   * pessoa tem o texto na mão de qualquer jeito, e o texto completo, já que o
   * link é truncado em ~14 mil caracteres.
   */
  async function abrirNoClaude() {
    if (!processo) return
    const passagem = [
      'Estou redigindo uma petição num cumprimento de sentença contra a Fazenda Pública em que houve cessão de crédito.',
      '',
      `## O caso`,
      `- Processo: ${formatCNJ(processo.numero_cnj)}`,
      `- Cedente: ${processo.cedente || 'não informado'}`,
      `- Cessionário: ${processo.cessionario || 'não informado'}`,
      `- Ente devedor: ${processo.entidade_devedora || 'não informado'}`,
      `- Juízo: ${[processo.tribunal, processo.comarca, processo.vara].filter(Boolean).join(' · ') || 'não informado'}`,
      '',
      panorama.data?.panorama
        ? `## Panorama levantado do caso\n${panorama.data.panorama}\n`
        : '',
      `## O que eu pedi`,
      instrucao.trim() || '(nada ainda)',
      '',
      textoIA ? `## O que veio como resposta\n\n${textoIA}\n` : '',
      '---',
      'Continue daqui comigo: quero ajustar esta petição.',
    ]
      .filter(Boolean)
      .join('\n')

    try {
      await navigator.clipboard.writeText(passagem)
      toast.success('Contexto copiado. Se o Claude não abrir, cole com Ctrl+V.')
    } catch {
      toast.toast(
        'Não consegui copiar o contexto. Abrindo o Claude; refaça o pedido por lá.',
        'info',
      )
    }
    // Âncora em vez de location.href: sem app instalado, navegar direto para um
    // esquema desconhecido deixa a página num estado de erro; o clique numa
    // âncora simplesmente não faz nada.
    const a = document.createElement('a')
    a.href = `claude://claude.ai/new?q=${encodeURIComponent(passagem.slice(0, MAX_PASSAGEM))}`
    a.click()
  }

  const impedido =
    !processo ||
    !md ||
    !!erroMd ||
    pendencias.length > 0 ||
    desconhecidos.length > 0 ||
    semRotuloNenhum

  /** Baixa no computador. É o caminho de escape quando o Drive não resolve. */
  function baixar(blob: Blob, nome: string) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = nome
    a.click()
    URL.revokeObjectURL(url)
  }

  /**
   * Markdown → .docx → Drive. CAMINHO ÚNICO das duas abas.
   *
   * É aqui que a decisão de a IA "entregar só o texto" se paga: a peça escrita
   * pelo modelo passa exatamente pelas mesmas etapas da peça de modelo, então sai
   * com o mesmo timbrado, as mesmas margens, as mesmas cores e o mesmo recuo de
   * citação. Não existe uma segunda formatação para divergir da primeira.
   *
   * @param nomeBase  nomeia o arquivo; nos modelos é o nome do modelo, na IA é o
   *                  título curto que ela devolveu.
   * @param pastaForcada  destino fixo dentro do crédito. A IA passa 5 sempre —
   *                  ver resolverPastaDaPeticao.
   */
  async function salvarPeticao(
    texto: string,
    nomeBase: string,
    pastaForcada?: number,
  ) {
    if (!processo) return
    setGerando(true)
    setPasso(null)
    setSemPasta(null)
    try {
      // Sob demanda: a biblioteca de .docx só desce para quem realmente gera uma
      // petição, não para quem abre a lista de tarefas.
      const { gerarDocxPeticao } = await import('@/lib/peticaoDocx')
      const timbrado = await baixarTimbradoBytes()
      const blob = await gerarDocxPeticao(texto, timbrado)
      const cnj = processo.numero_cnj ? formatCNJ(processo.numero_cnj) : numeroTarefa
      const nome = `${nomeBase} - ${cnj}.docx`.replace(/[/\\?%*:|"<>]/g, '-')

      // O arquivo é gerado ANTES de procurar a pasta: se a pasta não resolver, o
      // trabalho não se perde — cai no download e a pessoa sobe à mão.
      if (!driveConfigurado) {
        baixar(blob, nome)
        toast.toast('Drive não configurado neste build. Baixei o arquivo.', 'info')
        return
      }

      setPasso('Procurando a pasta no Drive…')
      const { resolverPastaDaPeticao } = await import('@/lib/peticaoPasta')
      const alvo = await resolverPastaDaPeticao(processo, nomeBase, pastaForcada)

      if (alvo.tipo !== 'pronto') {
        setSemPasta({ motivo: alvo.motivo, caminho: alvo.caminho })
        baixar(blob, nome)
        toast.toast('Não achei a pasta no Drive. Baixei o arquivo.', 'info')
        return
      }

      setPasso('Salvando no Drive…')
      const { subirDocx } = await import('@/lib/drive')
      const { link } = await subirDocx(alvo.pastaId, nome, blob)
      // Nova aba, como pedido. `noopener` porque abrir aba com referência à página
      // de origem é brecha conhecida, e aqui não há motivo para manter o vínculo.
      window.open(link, '_blank', 'noopener,noreferrer')
      toast.success(`Salvo em ${alvo.caminho.join(' › ')}`)
    } catch (err) {
      const msg = (err as Error).message ?? ''
      // Chunk que não baixa quase nunca é falha de rede: é DEPLOY NOVO com a aba
      // aberta. O index.js em memória aponta para um nome de arquivo que o build
      // seguinte substituiu, e o antigo deixa de existir no servidor. Acontece
      // justamente aqui porque a biblioteca de .docx é carregada sob demanda — quem abriu a
      // plataforma antes do deploy e só depois clicou em gerar cai nisto.
      // "Failed to fetch" seco não diz nada a quem está tentando protocolar.
      const versaoVelha =
        /dynamically imported module|Importing a module script failed|Failed to fetch/i.test(
          msg,
        )
      if (versaoVelha) {
        toast.error(
          'A plataforma foi atualizada enquanto esta aba estava aberta. ' +
            'Recarregue a página e gere novamente.',
        )
      } else {
        toast.error(msg)
      }
    } finally {
      setGerando(false)
      setPasso(null)
    }
  }

  // ---------- O que o botão "Salvar" faz em cada aba ----------
  const naIA = aba === 'zero'
  /** Título curto da IA para nomear o arquivo; sem ele, um nome genérico. */
  const nomeDaPecaIA = (redacao?.titulo || 'Petição').trim()
  const impedidoSalvar = naIA
    ? !processo || !textoIA.trim() || gerando
    : impedido || gerando

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title="Gerar petição"
      // "Cedente v. Cessionário", a mesma forma que a lista de tarefas usa sob o
      // número do processo — quem abre a janela vê a mesma identificação que viu
      // no card, sem ter de reconciliar duas descrições do mesmo crédito.
      description={
        processo
          ? `${formatCNJ(processo.numero_cnj)} · ${processo.cedente || '—'} v. ${
              processo.cessionario || '—'
            }`
          : 'A tarefa não está vinculada a um crédito cadastrado.'
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
          <Button
            onClick={() =>
              naIA
                ? // 5 sempre: por decisão do produto, peça de IA vai toda para
                  // "5. Petições" — o título que a IA escreveu não decide pasta.
                  salvarPeticao(textoIA, nomeDaPecaIA, 5)
                : textoFinal && escolhido
                  ? salvarPeticao(textoFinal, escolhido.nome)
                  : undefined
            }
            disabled={impedidoSalvar}
            icon={<Download className="h-4 w-4" />}
          >
            {/* "Salvar", e não "Gerar petição": repetir o título da janela no
                botão não informa nada, e o que o clique faz é salvar a peça no
                Drive. */}
            {gerando ? (passo ?? 'Gerando…') : 'Salvar'}
          </Button>
        </>
      }
    >
      <div className="mb-4">
        <Tabs items={ABAS} value={aba} onChange={setAba} />
      </div>

      {naIA ? (
        <div className="space-y-4">
          {!processo ? (
            <Aviso tom="erro">
              Esta tarefa não casou com nenhum crédito cadastrado. Sem crédito não há
              processo para analisar. Confira se o número do processo da tarefa no
              ADVBOX está cadastrado em Créditos.
            </Aviso>
          ) : (
            <>
              {/* ---------- Panorama ---------- */}
              <section>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h4 className="font-display text-xs font-bold uppercase tracking-wide text-brand-800">
                    Panorama do caso
                  </h4>
                  {panorama.data && (
                    <button
                      type="button"
                      onClick={() => void reanalisar()}
                      disabled={reanalisando}
                      className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 transition-colors hover:text-brand-700 disabled:opacity-50"
                    >
                      <RefreshCw
                        className={`h-3 w-3 ${reanalisando ? 'animate-spin' : ''}`}
                      />
                      {reanalisando ? 'Analisando…' : 'Analisar de novo'}
                    </button>
                  )}
                </div>

                {panorama.isLoading ? (
                  <div className="rounded-lg border border-brand-100 bg-brand-50/40 p-4">
                    <p className="text-sm text-brand-800">
                      Lendo as movimentações e as tarefas deste processo…
                    </p>
                    <div className="mt-3 space-y-2">
                      <div className="skeleton h-3 w-full rounded" />
                      <div className="skeleton h-3 w-11/12 rounded" />
                      <div className="skeleton h-3 w-9/12 rounded" />
                    </div>
                  </div>
                ) : panorama.isError ? (
                  <Aviso tom="atencao">
                    <p>{(panorama.error as Error).message}</p>
                    <button
                      type="button"
                      onClick={() => void panorama.refetch()}
                      className="mt-1 font-medium underline"
                    >
                      Tentar de novo
                    </button>
                  </Aviso>
                ) : panorama.data ? (
                  <div className="rounded-lg border border-brand-100 bg-brand-50/40 p-4 text-sm leading-relaxed text-slate-700">
                    <TextoIA texto={panorama.data.panorama} />
                  </div>
                ) : null}
              </section>

              {/* ---------- Comando do advogado ---------- */}
              <section>
                <label
                  htmlFor="peticao-instrucao"
                  className="mb-1.5 block text-sm font-medium text-slate-700"
                >
                  Objeto da petição
                </label>
                <Textarea
                  id="peticao-instrucao"
                  rows={3}
                  value={instrucao}
                  placeholder="Ex.: peça o sequestro do valor do RPV, que venceu o prazo de 60 dias sem pagamento, e requeira a intimação do ente devedor."
                  onChange={(e) => setInstrucao(e.target.value)}
                />
                <div className="mt-2 flex justify-end">
                  <Button
                    size="sm"
                    variant="outline"
                    icon={<Send className="h-4 w-4" />}
                    loading={redigindo}
                    disabled={!instrucao.trim() || redigindo}
                    onClick={() => void redigir()}
                  >
                    {redigindo ? 'Redigindo…' : 'Enviar'}
                  </Button>
                </div>
              </section>

              {/* ---------- A peça ---------- */}
              {redacao && (
                <section>
                  {/* O título que a IA devolveu NOMEIA O ARQUIVO, mas não aparece
                      aqui: como é frase e não etiqueta, saía tomando a linha
                      inteira em negrito e roubando a atenção do texto da peça, que
                      é o que precisa ser lido. */}
                  <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                    <label
                      htmlFor="peticao-texto"
                      className="text-sm font-medium text-slate-700"
                    >
                      Revisar
                    </label>
                    {/* O escape quando a resposta não serve: leva o caso inteiro
                        para o app do Claude e o refinamento segue lá, fora da API. */}
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Copy className="h-4 w-4" />}
                      onClick={() => void abrirNoClaude()}
                    >
                      Continuar no Claude
                    </Button>
                  </div>

                  {redacao.avisos && redacao.avisos.length > 0 && (
                    <div className="mb-2">
                      <Aviso tom="atencao">
                        <p className="font-medium">
                          A peça saiu fora do padrão de formatação em{' '}
                          {redacao.avisos.length === 1 ? 'um ponto' : 'alguns pontos'}.
                          O arquivo sai, mas confira:
                        </p>
                        <ul className="mt-1 list-disc space-y-0.5 pl-5">
                          {redacao.avisos.map((a, i) => (
                            <li key={i}>{a}</li>
                          ))}
                        </ul>
                      </Aviso>
                    </div>
                  )}

                  {/* Editável, e em fonte de largura fixa: o que se confere aqui é
                      onde cada bloco começa e acaba, e é isso que a formatação do
                      .docx lê. */}
                  <Textarea
                    id="peticao-texto"
                    rows={16}
                    value={textoIA}
                    onChange={(e) => setTextoIA(e.target.value)}
                    className="font-mono text-xs leading-relaxed"
                  />
                </section>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {/* Sem crédito não há de onde tirar juízo, processo, cessionário nem
              dados bancários — a tarefa precisa estar vinculada. */}
          {!processo && (
            <Aviso tom="erro">
              Esta tarefa não casou com nenhum crédito cadastrado. Sem crédito não
              há dados para preencher a petição. Confira se o número do processo da
              tarefa no ADVBOX está cadastrado em Créditos.
            </Aviso>
          )}

          {templates.isLoading ? (
            <Loading />
          ) : ativos.length === 0 ? (
            <Aviso tom="erro">
              Nenhum modelo cadastrado. Rode a carga de modelos no Supabase.
            </Aviso>
          ) : (
            // Sem rótulo visível, por pedido — daí o aria-label, para quem usa
            // leitor de tela continuar sabendo o que o campo é.
            <Select
              aria-label="Modelo de petição"
              className={escolhidoEhSugerido ? 'font-semibold' : undefined}
              value={idEscolhido ?? ''}
              onChange={(e) => setIdEscolhido(e.target.value || null)}
            >
              {/* Os sugeridos vêm PRIMEIRO e em negrito. A ordem carrega o mesmo
                  recado do negrito e não depende do navegador: estilo em <option>
                  é respeitado no Chrome e no Firefox do desktop, mas alguns
                  ignoram. Com as duas coisas, o sinal não se perde. */}
              {sugeridos.map((t) => (
                <option key={t.id} value={t.id} style={{ fontWeight: 700 }}>
                  {t.nome}
                </option>
              ))}
              {ativos
                .filter((t) => !sugeridos.some((s) => s.id === t.id))
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nome}
                  </option>
                ))}
            </Select>
          )}

          {erroMd && <Aviso tom="erro">{erroMd}</Aviso>}

          {semPasta && (
            <Aviso tom="atencao">
              <p className="font-medium">
                O arquivo foi baixado no seu computador, mas não subiu no Drive.
              </p>
              <p className="mt-1">{semPasta.motivo}</p>
              {semPasta.caminho.length > 0 && (
                <p className="mt-1">
                  Desci até: <strong>{semPasta.caminho.join(' › ')}</strong>
                </p>
              )}
              <p className="mt-1">
                Suba o arquivo à mão nessa pasta, ou crie a pasta que falta e gere de
                novo.
              </p>
            </Aviso>
          )}

          {semRotuloNenhum && (
            <Aviso tom="erro">
              O arquivo <strong>{escolhido?.arquivo}</strong> não tem nenhum campo
              para preencher. Provavelmente foi substituído pelo arquivo errado no
              bucket.
            </Aviso>
          )}

          {desconhecidos.length > 0 && (
            <Aviso tom="erro">
              O modelo tem {desconhecidos.length === 1 ? 'um campo' : 'campos'} que a
              plataforma não reconhece:{' '}
              <strong>{desconhecidos.map((d) => `[${d}]`).join(', ')}</strong>.
              Confira a grafia no arquivo do bucket.
            </Aviso>
          )}

          {pendencias.length > 0 && (
            <Aviso tom="atencao">
              <p className="font-medium">
                Falta preencher no cadastro antes de gerar:
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {pendencias.map((p) => (
                  <li key={p.variavel}>
                    <span className="font-medium">{NOME_VARIAVEL[p.variavel]}</span>{' '}
                    — {p.motivo}
                  </li>
                ))}
              </ul>
            </Aviso>
          )}

          {carregandoMd ? (
            <Loading />
          ) : (
            textoFinal && (
              // Pré-visualização em texto, e não formatada: o que importa conferir
              // aqui é o CONTEÚDO preenchido. A forma final está no arquivo, e uma
              // prévia parecida-mas-não-igual daria falsa segurança.
              <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3 font-sans text-xs leading-relaxed text-slate-700 scrollbar-thin">
                {textoFinal}
              </pre>
            )
          )}
        </div>
      )}
    </Modal>
  )
}

/** Caixa de aviso. Âmbar pede providência; vermelho impede a geração. */
function Aviso({
  tom,
  children,
}: {
  tom: 'atencao' | 'erro'
  children: React.ReactNode
}) {
  const cores =
    tom === 'erro'
      ? 'border-red-200 bg-red-50 text-red-800'
      : 'border-amber-200 bg-amber-50 text-amber-900'
  const Icone = tom === 'erro' ? AlertTriangle : FileText
  return (
    <div className={`flex gap-2 rounded-lg border p-3 text-sm ${cores}`}>
      <Icone className="mt-0.5 h-4 w-4 flex-none" />
      <div className="min-w-0">{children}</div>
    </div>
  )
}
