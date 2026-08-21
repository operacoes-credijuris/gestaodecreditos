// Análise de Crédito: as etapas do fluxo do operacional, alimentadas pelos cards
// do kanban do Kommo (espelho local em public.kommo_leads).
//
// Cada tela corresponde a exatamente uma coluna do Kommo, e as ações de cada
// etapa aparecem como botões no próprio card, com um clique — nenhuma etapa
// pede justificativa: a análise, inclusive o motivo de uma eventual reprovação,
// já foi escrita em Pendentes (ver src/lib/kommo.ts).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Search,
  ExternalLink,
  ArrowRight,
  Check,
  FileSearch,
  ClipboardCheck,
  RefreshCw,
  X,
} from 'lucide-react'
import { invokeFunction } from '@/lib/functions'
import {
  FUNIL_RPV,
  FUNIL_PRECATORIO,
  KOMMO_SUBDOMINIO,
  ST_DECISAO,
  ST_PROPOSTA,
  ST_DILIGENCIA,
  ST_REPROVADO,
  ABA_OUTRAS,
  abasDoFunil,
  agruparPorAba,
  nomeDaEtapa,
  telasRpvDesalinhadas,
  useKommoLeads,
  useKommoEtapas,
  useAnalisesProntas,
  type AcaoTela,
} from '@/lib/kommo'
import type { KommoLead } from '@/lib/types'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Field'
import { Segmented } from '@/components/ui/Segmented'
import { SyncStatus } from '@/components/ui/SyncStatus'
import { Loading, ErrorState, EmptyState } from '@/components/ui/Table'
import { useToast } from '@/components/ui/Toast'
import { ChecklistCertidoes } from '@/components/ChecklistCertidoes'
import { formatDate } from '@/lib/format'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.js?url'
import { useAuth } from '@/contexts/AuthContext'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

// ===== Análise automática do card (Judit -> due diligence -> planilha) =====
// Lê os dados do próprio card (título + notas) e roda a sequência no motor.
type ResultadoAnalise = {
  reprovado?: boolean
  motivo?: string
  relatorio_due_diligence?: string | null
  due_diligence_url?: string | null
  drive_file_url?: string | null
  drive_folder_url?: string | null
  aviso?: string | null
  erro?: string
  motivos?: string[]
  avisos?: string[]
  [k: string]: unknown
}

function lerCardCredijuris(lead: KommoLead) {
  const notas =
    lead.notas && lead.notas.length > 0
      ? lead.notas.map((n) => n.texto).join('\n')
      : (lead.nota_texto ?? '')
  const pegar = (re: RegExp) => (notas.match(re)?.[1] ?? '').trim()

  const numero = (lead.processo_cnj ?? pegar(/PROCESSO:\s*([0-9.\-]+)/i)).trim()
  const tipo = pegar(/TIPO:\s*(.+)/i)

  // A CATEGORIA VEM DO FUNIL, não do texto da anotação.
  //
  // Antes saía de /precat/ na linha "TIPO:", com RPV como padrão. Isso funcionava
  // por acidente: só cards de RPV chegavam a esta tela, então o padrão estava
  // quase sempre certo. Com a aba de Precatórios ligada, um card de precatório
  // cuja anotação não traga a linha TIPO cairia no padrão e seria analisado como
  // RPV — e a categoria é o NOME DA PASTA no Drive (ver gerar-analise-rpv). O
  // parecer e a planilha iriam para "Requisições de Pequeno Valor", sem erro
  // nenhum na tela: o "✅ Planilha gerada" é idêntico nos dois casos.
  //
  // O funil é dado do CRM, não texto livre. É a fonte certa. A linha TIPO passa a
  // servir só para DISCORDAR em voz alta.
  const categoria =
    lead.pipeline_id === FUNIL_PRECATORIO
      ? 'Precatórios'
      : 'Requisições de Pequeno Valor'
  const divergenciaTipo =
    tipo && /precat/i.test(tipo) !== (lead.pipeline_id === FUNIL_PRECATORIO)
      ? `O card está no funil de ${
          lead.pipeline_id === FUNIL_PRECATORIO ? 'Precatórios' : 'RPV'
        }, mas a anotação diz "TIPO: ${tipo.trim()}". Analisei como ${categoria} ` +
        `(o funil manda). Se estiver errado, mova o card no Kommo.`
      : null

  const partesTitulo = (lead.nome ?? '').split(' - ')
  const intermediador = (partesTitulo[0] ?? '').trim()
  const cedente =
    pegar(/CEDENTE:\s*(.+)/i) || (partesTitulo.length >= 2 ? partesTitulo[1].trim() : '')

  const parcela = pegar(/PARCELA CEDIDA:\s*(.+)/i).toLowerCase()
  const tipo_aquisicao =
    parcela.includes('principal') && parcela.includes('honor')
      ? 'ambos'
      : parcela.includes('honor')
        ? 'honorarios'
        : parcela.includes('principal')
          ? 'principal'
          : 'auto'

  const honMatch = notas.match(/HONOR[ÁA]RIOS?\s*C\.?:\s*([\d.,]+)\s*%/i)
  const honorarios_pct = honMatch ? honMatch[1].replace(/\./g, '').replace(',', '.') : ''

  return {
    numero,
    categoria,
    cedente,
    intermediador,
    tipo_aquisicao,
    honorarios_pct,
    divergenciaTipo,
  }
}

async function extrairTextoDoPdf(url: string): Promise<string> {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`Falha ao baixar o PDF da Kommo (HTTP ${resp.status}).`)
  const buf = await resp.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise
  let texto = ''
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const content = await page.getTextContent()
    texto += (content.items as Array<{ str?: string }>).map((it) => it.str ?? '').join(' ') + '\n'
  }
  return texto
}

/**
 * Texto do PDF anexado ao card.
 *
 * Separado de analisarLeadCredijuris porque agora DUAS coisas dependem dele: a
 * análise (que manda o texto ao motor) e o checklist de certidões (que procura
 * nele os CPFs candidatos). Baixar e extrair duas vezes o mesmo PDF de 200
 * páginas seria desperdício visível na tela, então quem chama guarda o
 * resultado — ver `textoCache` no componente.
 *
 * Devolve o texto INTEIRO. O corte por tamanho é do consumidor: o motor tem
 * limite de contexto, a busca de CPF não tem e não pode perder o fim do
 * documento.
 */
async function lerTextoDoCard(lead: KommoLead): Promise<string> {
  // 1) Kommo: pega o LINK de download do PDF anexado no card
  const bk = await invokeFunction<{
    pronto?: boolean
    download_url?: string
    erro?: string
    nome_arquivo?: string
  }>('buscar-kommo', { lead_id: lead.kommo_lead_id })
  if (bk.erro) throw new Error(bk.erro)
  if (!bk.pronto || !bk.download_url)
    throw new Error('Não achei o PDF no card. Confira se o PDF do processo está anexado.')

  // 2) O NAVEGADOR baixa o PDF e extrai o texto (pdf.js) — o trabalho pesado fica aqui,
  //    não no servidor, então aguenta PDF de qualquer tamanho sem estourar a CPU.
  const texto = (await extrairTextoDoPdf(bk.download_url)).trim()
  if (!texto) {
    throw new Error(
      'O PDF não tem texto selecionável (parece escaneado/imagem). Não foi possível ler o conteúdo.',
    )
  }
  return texto
}

async function analisarLeadCredijuris(
  lead: KommoLead,
  textoJaLido?: string,
): Promise<{ resultado: ResultadoAnalise; texto: string }> {
  const dados = lerCardCredijuris(lead)

  const completo = textoJaLido ?? (await lerTextoDoCard(lead))
  let texto = completo
  // corta se gigante (mantém início e final — cálculo/RPV costumam estar no fim)
  const MAX = 360000
  if (texto.length > MAX) {
    const iniCorte = Math.floor(MAX * 0.6)
    texto =
      texto.slice(0, iniCorte) +
      '\n\n[...TRECHO INTERMEDIÁRIO OMITIDO POR TAMANHO...]\n\n' +
      texto.slice(texto.length - (MAX - iniCorte))
  }

  // 3) Análise + precificação — manda só o TEXTO (leve) pro motor
  const res = await invokeFunction<ResultadoAnalise>('gerar-analise-rpv', {
    texto,
    intermediador: dados.intermediador,
    numero_processo: dados.numero,
    categoria: dados.categoria,
    tipo_aquisicao: dados.tipo_aquisicao,
    honorarios_pct: dados.honorarios_pct,
  })
  // Divergência entre o funil e a linha TIPO da anotação sobe junto do resultado,
  // e não no lugar dele: a análise rodou, a categoria escolhida está dita.
  const resultado: ResultadoAnalise = dados.divergenciaTipo
    ? {
        ...res,
        aviso: [res.aviso, dados.divergenciaTipo].filter(Boolean).join(' '),
      }
    : res
  return { resultado, texto: completo }
}

// Escreve o resultado da análise no card do Kommo (motivo se recusado, link do Drive se aprovado).
async function anotarResultadoNaKommo(leadId: number, r: ResultadoAnalise, analista: string) {
  let texto = ''
  if (r.reprovado) {
    const motivo = r.motivo || (r.motivos ?? []).join(' ') || 'Crédito reprovado na análise.'
    texto = `❌ RECUSADO na análise automática.\nMotivo: ${motivo}`
  } else {
    const link =
      (typeof r.drive_folder_url === 'string' && r.drive_folder_url) ||
      (typeof r.drive_file_url === 'string' && r.drive_file_url) ||
      ''
    const base = link
      ? `✅ APROVADO na análise automática.\nPlanilha e análise no Drive: ${link}`
      : '✅ APROVADO na análise automática. (Confira a pasta do Drive.)'
    const avisoTxt = typeof r.aviso === 'string' && r.aviso.trim() ? `\n\n${r.aviso.trim()}` : ''
    texto = base + avisoTxt
  }
  texto = `(${analista}) ${texto}`
  try {
    await invokeFunction('kommo-anotar', { lead_id: leadId, texto })
  } catch {
    /* a anotação é um extra: se falhar, não trava o resultado que já apareceu na tela */
  }
}

/** Ícone por destino — dá para reconhecer a ação sem ler o rótulo. */
const ICONES: Record<number, ReactNode> = {
  [ST_DECISAO]: <ArrowRight className="h-4 w-4" />,
  [ST_PROPOSTA]: <Check className="h-4 w-4" />,
  [ST_DILIGENCIA]: <FileSearch className="h-4 w-4" />,
  [ST_REPROVADO]: <X className="h-4 w-4" />,
}

/** Link para o card no Kommo — o operacional às vezes precisa do original. */
function urlCard(leadId: number): string {
  return `https://${KOMMO_SUBDOMINIO}.kommo.com/leads/detail/${leadId}`
}

function tituloCard(lead: KommoLead): string {
  return lead.nome?.trim() || `Card ${lead.kommo_lead_id}`
}

function CardCredito({
  lead,
  acoes,
  onAcao,
  analisePronta,
  statusEmAndamento,
  onAnalisar,
  analisando,
  resultadoAnalise,
  onCertidoes,
  etapaOrigem,
}: {
  lead: KommoLead
  acoes: AcaoTela[]
  onAcao: (l: KommoLead, a: AcaoTela) => void
  /** Nome da coluna do Kommo, quando o card está fora das abas conhecidas. */
  etapaOrigem: string | null
  /** null = não mostrar o selo (só faz sentido na etapa de revisão). */
  analisePronta: boolean | null
  /** Destino sendo processado neste card, ou null. */
  statusEmAndamento: number | null
  onAnalisar: (l: KommoLead) => void
  analisando: boolean
  resultadoAnalise?: ResultadoAnalise
  onCertidoes: (l: KommoLead) => void
}) {
  const [aberto, setAberto] = useState(false)
  const ocupado = statusEmAndamento !== null
  // Compatibilidade com cards sincronizados antes da coluna `notas` existir:
  // cai no nota_texto para não sumir o dado do crédito antes do próximo sync.
  const notas =
    lead.notas?.length > 0
      ? lead.notas
      : lead.nota_texto?.trim()
        ? [{ id: 0, texto: lead.nota_texto, criado_em: null, autor: null }]
        : []
  const posteriores = notas.length - 1

  return (
    <div className="border-b border-slate-100 p-4 transition-colors last:border-b-0 hover:bg-slate-50/70">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-800">{tituloCard(lead)}</span>
            {analisePronta !== null && (
              <Badge size="sm" tone={analisePronta ? 'green' : 'yellow'}>
                {analisePronta ? 'Finalizado' : 'Em curso'}
              </Badge>
            )}
            {etapaOrigem && (
              <Badge size="sm" tone="gray">
                {etapaOrigem}
              </Badge>
            )}
          </div>
          {/* Sem linha de metadados: o processo já vem no título, o responsável é
              sempre a Credijuris, e a data de criação do card é redundante com as
              datas das próprias anotações. Tags também ficam de fora — as atuais
              são artefato da migração do Chatwoot. Tudo continua em kommo_leads. */}
        </div>

        {/* Lado a lado: os rótulos são curtos e assim cada card ocupa uma linha
            em vez de três. flex-wrap para não estourar em tela estreita. */}
        {acoes.length > 0 && (
          <div className="flex flex-none flex-wrap items-center justify-end gap-1.5">
            {acoes.map((a) => (
              <Button
                key={a.statusId}
                size="sm"
                variant={a.variant}
                icon={ICONES[a.statusId]}
                onClick={() => onAcao(lead, a)}
                loading={statusEmAndamento === a.statusId}
                // Trava as outras ações do card enquanto uma corre: duas
                // movimentações simultâneas no mesmo card se atropelariam.
                disabled={ocupado}
              >
                {a.label}
              </Button>
            ))}
          </div>
        )}
      </div>

      {/* Análise automática Credijuris: Judit -> due diligence -> planilha */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          icon={<FileSearch className="h-4 w-4" />}
          onClick={() => onAnalisar(lead)}
          loading={analisando}
          disabled={ocupado || analisando}
        >
          {analisando ? 'Analisando…' : 'Analisar (PDF do card)'}
        </Button>
        {/* Botão separado, e nunca automático: o checklist depende de CPF e UF
            que uma pessoa confere no processo. Rodar sozinho só produziria
            checklist sobre dado adivinhado. */}
        <Button
          size="sm"
          variant="outline"
          icon={<ClipboardCheck className="h-4 w-4" />}
          onClick={() => onCertidoes(lead)}
          disabled={ocupado}
        >
          Certidões
        </Button>
      </div>
      <div>
        {resultadoAnalise && (
          <div className="mt-2 rounded-lg bg-slate-50 p-3 text-xs ring-1 ring-inset ring-slate-100">
            {resultadoAnalise.erro ? (
              <div className="text-red-700">Erro: {resultadoAnalise.erro}</div>
            ) : resultadoAnalise.reprovado && resultadoAnalise.motivo ? (
              <div className="text-red-700">
                ⛔ {resultadoAnalise.motivo}{' '}
                {resultadoAnalise.relatorio_due_diligence && (
                  <a
                    className="font-medium underline"
                    href={resultadoAnalise.relatorio_due_diligence}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Ver relatório
                  </a>
                )}
              </div>
            ) : resultadoAnalise.reprovado ? (
              <div className="text-red-700">
                Reprovado no Portão 1: {(resultadoAnalise.motivos ?? []).join(' ')}
              </div>
            ) : (
              <div className="text-green-700">
                ✅ Planilha gerada.{' '}
                {typeof resultadoAnalise.drive_file_url === 'string' && (
                  <a
                    className="font-medium underline"
                    href={resultadoAnalise.drive_file_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Abrir planilha
                  </a>
                )}{' '}
                {typeof resultadoAnalise.due_diligence_url === 'string' && (
                  <a
                    className="font-medium underline"
                    href={resultadoAnalise.due_diligence_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Relatório de due diligence
                  </a>
                )}
                {resultadoAnalise.aviso && (
                  <div className="mt-1 text-amber-700">⚠️ {resultadoAnalise.aviso}</div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mt-2 flex items-center gap-3">
        {/* As anotações vêm em texto livre e o formato varia entre cards, então
            são exibidas cruas, recolhidas por padrão. A contagem no rótulo evita
            que anotação nova passe batida com o bloco fechado. */}
        {notas.length > 0 && (
          <button
            type="button"
            onClick={() => setAberto((v) => !v)}
            className="text-xs font-medium text-brand-600 hover:underline"
          >
            {aberto ? 'Ocultar histórico' : 'Ver histórico'}
            {posteriores > 0 && ` (+${posteriores})`}
          </button>
        )}
        <a
          href={urlCard(lead.kommo_lead_id)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-slate-400 transition-colors hover:text-slate-600"
        >
          <ExternalLink className="h-3.5 w-3.5" /> Abrir no Kommo
        </a>
      </div>

      {aberto && notas.length > 0 && (
        <div className="mt-2 space-y-2">
          {notas.map((n, i) => (
            <div key={n.id || i}>
              {/* Só a data. Sem rótulo de posição, porque há cards em que a
                  primeira anotação é um comentário curto e o bloco de dados vem
                  depois — numerar sugeriria uma ordem semântica que não existe.
                  E sem autor: a equipe usa um login só e se identifica no próprio
                  texto da anotação; os nomes que aparecem são de antes disso.
                  O campo continua guardado em kommo_leads.notas. */}
              <div className="mb-0.5 text-xs text-slate-400">
                {n.criado_em && formatDate(n.criado_em)}
              </div>
              <pre className="whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-xs text-slate-700 ring-1 ring-inset ring-slate-100">
                {n.texto}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function AnaliseCredito() {
  const qc = useQueryClient()
  const toast = useToast()
  // Funil escolhido no seletor de cima. Os dois funis têm cards de crédito e o
  // mesmo trabalho de certidões; o que muda é a precificação e a análise do
  // caderno processual.
  const [funil, setFunil] = useState<number>(FUNIL_RPV)
  const leads = useKommoLeads(funil)
  const etapas = useKommoEtapas()
  const prontas = useAnalisesProntas()

  const [aba, setAba] = useState<string>('pendentes')
  const [busca, setBusca] = useState('')
  // Ação em curso, para o botão certo do card certo mostrar o spinner.
  const [emAndamento, setEmAndamento] = useState<{
    leadId: number
    statusId: number
  } | null>(null)
  // Análise automática (Judit + due diligence + planilha) por card.
  const { user: authUser, profile: authProfile } = useAuth()
  const analistaNome = authProfile?.nome || authUser?.email || 'Usuário'
  const [analisandoId, setAnalisandoId] = useState<number | null>(null)
  const [resultadoAnalise, setResultadoAnalise] = useState<Record<number, ResultadoAnalise>>({})

  // Texto do PDF por card, compartilhado entre a análise e o checklist de
  // certidões: o mesmo PDF serve aos dois e baixar duas vezes seria espera à
  // toa. Vive enquanto a página estiver aberta; o sync limpa (ver abaixo),
  // porque o PDF do card pode ter sido substituído no Kommo.
  const [textoCache, setTextoCache] = useState<Record<number, string>>({})
  const [certidoesLead, setCertidoesLead] = useState<KommoLead | null>(null)
  // CONJUNTO, não um id só. Com um id só, a leitura do card A terminando
  // limpava o indicador do card B, e o modal de B — ainda sem texto — passava a
  // afirmar "não achei nenhum CPF no PDF" sobre um PDF que nem tinha sido lido.
  const [lendoPdf, setLendoPdf] = useState<Set<number>>(new Set())
  const [avisoPdf, setAvisoPdf] = useState<Record<number, string>>({})

  const marcarLendo = (id: number, lendo: boolean) =>
    setLendoPdf((p) => {
      const n = new Set(p)
      if (lendo) n.add(id)
      else n.delete(id)
      return n
    })

  async function onAnalisar(lead: KommoLead) {
    if (!confirmaForaDoFluxo(lead, 'Rodar a analise automatica')) return
    setAnalisandoId(lead.kommo_lead_id)
    try {
      const { resultado, texto } = await analisarLeadCredijuris(
        lead,
        textoCache[lead.kommo_lead_id],
      )
      setTextoCache((p) => ({ ...p, [lead.kommo_lead_id]: texto }))
      setResultadoAnalise((p) => ({ ...p, [lead.kommo_lead_id]: resultado }))
      await anotarResultadoNaKommo(lead.kommo_lead_id, resultado, analistaNome)
    } catch (e) {
      setResultadoAnalise((p) => ({
        ...p,
        [lead.kommo_lead_id]: { erro: (e as Error)?.message ?? String(e) },
      }))
    } finally {
      setAnalisandoId(null)
    }
  }

  /**
   * Abre o checklist. O modal aparece NA HORA e o PDF é lido em segundo plano:
   * a sugestão de CPF é conveniência, não requisito. Se o PDF não existir ou for
   * digitalizado, o formulário continua utilizável — quem confere digita.
   */
  /**
   * Confirmacao para card fora do fluxo.
   *
   * Analisar e Certidoes ESCREVEM: a analise grava anotacao no card do Kommo (que
   * o comercial le) e arquivo no Drive; o checklist grava os sujeitos e o
   * checklist no banco. Na aba "Outras etapas" o card pode estar em "Venda
   * ganha" ou "Venda perdida" — estampar "APROVADO na analise automatica" num
   * negocio fechado e pior que nao ter o botao. Nao escondo o botao: as vezes e
   * exatamente o que se quer. Mas nao deixo acontecer sem querer.
   */
  function confirmaForaDoFluxo(lead: KommoLead, acao: string): boolean {
    if (abaAtual?.key !== ABA_OUTRAS) return true
    const coluna = nomeDaEtapa(lead.status_id, lead.pipeline_id, etapas.data ?? [])
    return window.confirm(
      `Este card esta na coluna "${coluna}" do Kommo, fora das etapas de analise.\n\n` +
        `${acao} vai gravar no card e no Drive de todo jeito.\n\nConfirma?`,
    )
  }

  function onCertidoes(lead: KommoLead) {
    if (!confirmaForaDoFluxo(lead, 'Montar o checklist de certidoes')) return
    setCertidoesLead(lead)
    const id = lead.kommo_lead_id
    // Já tem o texto, já está lendo, ou o Analisar está lendo o mesmo PDF agora:
    // em todos os casos, disparar de novo só baixaria o arquivo duas vezes.
    if (textoCache[id] || lendoPdf.has(id) || analisandoId === id) return
    // Limpa o aviso da tentativa ANTERIOR antes de tentar de novo. Sem isto, uma
    // releitura bem-sucedida ficava com o aviso velho grudado — e o modal mostra
    // o aviso com PREFERENCIA sobre a lista de candidatos, entao ele afirmava
    // "nao consegui ler o PDF" enquanto escondia os CPFs que acabara de achar.
    setAvisoPdf((p) => {
      if (!(id in p)) return p
      const n = { ...p }
      delete n[id]
      return n
    })
    marcarLendo(id, true)
    void lerTextoDoCard(lead)
      .then((t) => setTextoCache((p) => ({ ...p, [id]: t })))
      .catch((e) =>
        setAvisoPdf((p) => ({
          ...p,
          [id]:
            `Não consegui ler o PDF do card (${(e as Error)?.message ?? e}). ` +
            `Digite o CPF conferindo no processo.`,
        })),
      )
      .finally(() => marcarLendo(id, false))
  }

  // Sincroniza com o Kommo ao abrir a página, no mesmo padrão de Publicações e
  // Tarefas. O cron cobre o intervalo; isto cobre o "acabei de sentar".
  const sync = useMutation({
    mutationFn: () =>
      invokeFunction<{ aviso?: string | null }>('kommo-sync', {}),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['kommo_leads'] })
      qc.invalidateQueries({ queryKey: ['kommo_analise_interna'] })
      // As colunas do kanban também vêm deste sync (migration 0044): sem
      // invalidar, uma coluna nova no Kommo só apareceria no próximo F5.
      qc.invalidateQueries({ queryKey: ['kommo_etapa'] })
      // Aviso de sucesso PARCIAL: os cards vieram, a estrutura do kanban não.
      // Silenciar isto deixaria uma aba faltando sem explicação.
      if (r?.aviso) toast.error(r.aviso)
      // O sync pode ter trazido um PDF novo no card — versão corrigida do
      // processo é rotina. O texto guardado passa a ser de um documento
      // superado, e é dele que sai a lista de CPFs candidatos: servir CPF de
      // documento vencido é exatamente o erro que essa lista existe para
      // evitar. Descarta.
      setTextoCache({})
      setAvisoPdf({})
    },
    onError: (e) => toast.error(`Sincronização Kommo: ${(e as Error).message}`),
  })
  const jaSincronizou = useRef(false)
  useEffect(() => {
    if (jaSincronizou.current) return
    jaSincronizou.current = true
    sync.mutate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const abas = useMemo(
    () => abasDoFunil(funil, etapas.data ?? []),
    [funil, etapas.data],
  )

  const { porAba, outras } = useMemo(
    () => agruparPorAba(leads.data ?? [], abas),
    [leads.data, abas],
  )

  // "Outras etapas" só existe quando tem card dentro. É a rede que impede um
  // card de sumir: coluna do Kommo que a tela não conhece cai aqui, com o nome
  // da coluna ao lado, em vez de desaparecer.
  const abasVisiveis = useMemo(
    () =>
      outras.length > 0
        ? [
            ...abas,
            {
              key: ABA_OUTRAS,
              label: 'Outras etapas',
              statusIds: [],
              descricaoVazia: '',
              acoes: [] as AcaoTela[],
            },
          ]
        : abas,
    [abas, outras.length],
  )

  // Coluna de RPV que sumiu do Kommo: a aba dela mostraria zero card para sempre,
  // e o único vestígio seria a pílula "Outras etapas" — que ninguém liga à causa.
  const rpvDesalinhado = useMemo(
    () => (funil === FUNIL_RPV ? telasRpvDesalinhadas(etapas.data ?? []) : []),
    [funil, etapas.data],
  )

  // A aba escolhida pode não existir no funil recém-selecionado (as chaves de
  // RPV são 'pendentes'…, as de Precatório são 'st<id>'). Cai na primeira.
  const abaAtual = abasVisiveis.find((a) => a.key === aba) ?? abasVisiveis[0] ?? null

  const lista = useMemo(() => {
    let l = abaAtual
      ? abaAtual.key === ABA_OUTRAS
        ? outras
        : (porAba[abaAtual.key] ?? [])
      : []
    if (busca.trim()) {
      const q = busca.toLowerCase()
      l = l.filter((x) =>
        [
          x.nome,
          x.processo_cnj,
          x.responsavel_nome,
          // Busca em TODAS as anotações, não só na primeira: informação
          // relevante costuma vir num comentário posterior.
          ...(x.notas ?? []).map((n) => n.texto),
          x.nota_texto,
        ]
          .filter(Boolean)
          .some((v) => v!.toLowerCase().includes(q)),
      )
    }
    return l
  }, [porAba, outras, abaAtual, busca])

  const mover = useMutation({
    mutationFn: (args: { leadId: number; statusId: number; comentario: string }) =>
      invokeFunction<{ mensagem: string; aviso: string | null }>('kommo-mover', args),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['kommo_leads'] })
      qc.invalidateQueries({ queryKey: ['kommo_analise_interna'] })
      // A função devolve aviso quando o card moveu mas a anotação não gravou —
      // é sucesso parcial, não erro, e o usuário precisa saber da diferença.
      if (r?.aviso) toast.error(r.aviso)
      else toast.success(r?.mensagem ?? 'Card movido.')
      setEmAndamento(null)
    },
    onError: (e) => {
      setEmAndamento(null)
      toast.error((e as Error).message)
    },
  })

  /** Toda ação é um clique: nenhuma etapa pede justificativa. */
  function acionar(lead: KommoLead, acao: AcaoTela) {
    setEmAndamento({ leadId: lead.kommo_lead_id, statusId: acao.statusId })
    mover.mutate({ leadId: lead.kommo_lead_id, statusId: acao.statusId, comentario: '' })
  }

  return (
    <div>
      <PageHeader
        title="Análise de Crédito"
        actions={
          <div className="flex items-center gap-3">
            <SyncStatus
              syncing={sync.isPending}
              updatedAt={leads.dataUpdatedAt}
              label="sincronizando com o Kommo…"
            />
            {/* BOTÃO DE VERDADE. A sincronização só rodava uma vez, no efeito de
                montagem, e não havia nada para clicar — então o aviso de sucesso
                parcial só aparecia uma vez por carregamento de página, e
                "sincronize de novo" era instrução impossível de seguir sem dar
                F5. Card criado no Kommo agora também chega sem recarregar. */}
            <Button
              size="sm"
              variant="outline"
              icon={<RefreshCw className="h-4 w-4" />}
              onClick={() => sync.mutate()}
              loading={sync.isPending}
            >
              Sincronizar
            </Button>
          </div>
        }
      />

      {/* Os dois funis do Kommo. A contagem sai do funil carregado, então o do
          outro lado fica sem número até ser aberto — melhor sem número que com
          número errado. */}
      <div className="mb-4">
        <Segmented
          ariaLabel="Tipo de crédito"
          items={[
            {
              key: String(FUNIL_RPV),
              label: 'RPV',
              // `leads.data?.length`, e nao `(leads.data ?? []).length`: o
              // segundo renderiza um 0 DURO enquanto a consulta esta em voo e,
              // pior, quando ela falhou. "Precatorios 0" ao lado de uma
              // mensagem de erro afirma que o funil esta vazio.
              count: funil === FUNIL_RPV ? leads.data?.length : undefined,
            },
            {
              key: String(FUNIL_PRECATORIO),
              label: 'Precatórios',
              count: funil === FUNIL_PRECATORIO ? leads.data?.length : undefined,
            },
          ]}
          value={String(funil)}
          onChange={(v) => {
            setFunil(Number(v))
            // A chave da aba não é comparável entre funis ('pendentes' vs
            // 'st123'). Limpar aqui evita a tela abrir vazia por casar nada.
            setAba('')
            setBusca('')
          }}
        />
      </div>

      <Card className="mb-4 p-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            className="pl-9"
            placeholder="Buscar por nome do card, processo, responsável ou conteúdo…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        <div className="mt-3">
          {abasVisiveis.length > 0 ? (
            <Segmented
              ariaLabel="Etapa da análise"
              items={abasVisiveis.map((a) => ({
                key: a.key,
                label: a.label,
                count:
                  a.key === ABA_OUTRAS ? outras.length : (porAba[a.key]?.length ?? 0),
              }))}
              value={abaAtual?.key ?? ''}
              onChange={(v) => setAba(v)}
            />
          ) : etapas.isLoading ? (
            <p className="text-sm text-slate-500">Carregando as etapas do Kommo…</p>
          ) : etapas.isError ? (
            // A MENSAGEM REAL, não um palpite. A versão anterior descartava
            // etapas.error e afirmava uma causa ("a sincronização não conseguiu
            // ler o kanban") que podia estar errada — se o problema fosse
            // permissão de leitura da tabela, sincronizar de novo não mudaria
            // nada e a tela repetiria o mesmo diagnóstico falso para sempre.
            <p className="text-sm text-red-700">
              Não consegui ler as etapas deste funil: {(etapas.error as Error)?.message}{' '}
              <button
                type="button"
                onClick={() => etapas.refetch()}
                className="font-medium underline"
              >
                Tentar de novo
              </button>
            </p>
          ) : (
            // Espelho vazio: o kommo-sync não gravou a estrutura do kanban.
            // Dizer isso é melhor que mostrar uma tela vazia, que se leria como
            // "não tem crédito nenhum".
            <p className="text-sm text-amber-700">
              Ainda não sei as etapas deste funil. Elas vêm do próprio Kommo —
              clique em <strong>Sincronizar</strong>, no alto da página. Se
              continuar assim, a sincronização não conseguiu ler a estrutura do
              kanban e o aviso dela vai aparecer aqui.
            </p>
          )}
        </div>
      </Card>

      {rpvDesalinhado.length > 0 && (
        <div className="mb-4 rounded-lg bg-red-50 p-3 text-xs text-red-800 ring-1 ring-inset ring-red-200">
          A coluna do Kommo de{' '}
          <strong>{rpvDesalinhado.map((t) => t.label).join(', ')}</strong> não existe
          mais neste funil. A aba vai mostrar zero card até alguém corrigir o número
          da coluna em src/lib/kommo.ts — os cards que estariam nela aparecem em
          &quot;Outras etapas&quot;.
        </div>
      )}

      {abaAtual?.key === ABA_OUTRAS && (
        <div className="mb-4 rounded-lg bg-amber-50 p-3 text-xs text-amber-900 ring-1 ring-inset ring-amber-200">
          Estes cards estão em colunas do Kommo que a tela não cobre. Antes eles
          não apareciam em lugar nenhum — ficam aqui para nenhum crédito sumir.
        </div>
      )}

      <Card>
        {leads.isLoading ? (
          <Loading />
        ) : leads.isError ? (
          <ErrorState
            message={(leads.error as Error)?.message}
            onRetry={() => leads.refetch()}
          />
        ) : lista.length === 0 ? (
          <EmptyState
            title={
              busca.trim()
                ? 'Nada encontrado'
                : `Nenhum card em ${abaAtual?.label ?? 'nenhuma etapa'}`
            }
            description={
              busca.trim()
                ? `Nenhum card corresponde à busca nesta etapa do funil de ${
                    funil === FUNIL_PRECATORIO ? 'Precatórios' : 'RPV'
                  }. O card pode estar em outra etapa, ou no outro funil.`
                : (abaAtual?.descricaoVazia ??
                  'Este funil ainda não tem card nenhum no Kommo. Quando o comercial criar um, ele aparece aqui na próxima sincronização.')
            }
          />
        ) : (
          <div>
            {lista.map((l) => (
              <CardCredito
                key={l.kommo_lead_id}
                lead={l}
                acoes={abaAtual?.acoes ?? []}
                onAcao={acionar}
                // Em "Outras etapas" o card vem de uma coluna que a tela não
                // cobre. Dizer QUAL coluna é o que evita a pessoa achar que o
                // card está fora do fluxo por defeito.
                etapaOrigem={
                  abaAtual?.key === ABA_OUTRAS
                    ? nomeDaEtapa(l.status_id, l.pipeline_id, etapas.data ?? [])
                    : null
                }
                // O selo só aparece em Pendentes: nas etapas seguintes a
                // análise já passou pela revisão, então dizer "finalizado"
                // seria ruído.
                // Em RPV o selo so aparece em Pendentes: nas etapas seguintes a
                // analise ja passou pela revisao, e dizer "finalizado" seria
                // ruido. No funil de Precatorios nao existe essa curadoria — sem
                // o selo, card com analise pronta fica visualmente IDENTICO a
                // card ainda na fila, em toda aba, para sempre.
                analisePronta={
                  funil === FUNIL_RPV && abaAtual?.key !== 'pendentes'
                    ? null
                    : (prontas.data?.has(l.kommo_lead_id) ?? false)
                }
                statusEmAndamento={
                  emAndamento?.leadId === l.kommo_lead_id
                    ? emAndamento.statusId
                    : null
                }
                onAnalisar={onAnalisar}
                analisando={analisandoId === l.kommo_lead_id}
                resultadoAnalise={resultadoAnalise[l.kommo_lead_id]}
                onCertidoes={onCertidoes}
              />
            ))}
          </div>
        )}
      </Card>

      {certidoesLead && (
        <ChecklistCertidoes
          // key pelo card: trocar de card remonta o modal do zero, em vez de
          // reaproveitar o formulário já preenchido com os dados do anterior.
          key={certidoesLead.kommo_lead_id}
          open
          leadId={certidoesLead.kommo_lead_id}
          cedenteDoCard={lerCardCredijuris(certidoesLead).cedente}
          textoDoProcesso={textoCache[certidoesLead.kommo_lead_id] ?? ''}
          lendoPdf={
            lendoPdf.has(certidoesLead.kommo_lead_id) ||
            analisandoId === certidoesLead.kommo_lead_id
          }
          avisoPdf={avisoPdf[certidoesLead.kommo_lead_id] ?? null}
          onClose={() => setCertidoesLead(null)}
        />
      )}
    </div>
  )
}
