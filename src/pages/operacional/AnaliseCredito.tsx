// Análise de Crédito: as etapas do fluxo do operacional, alimentadas pelos cards
// do kanban do Kommo (espelho local em public.kommo_leads).
//
// Cada aba corresponde a exatamente uma coluna do Kommo, e as ações de cada
// etapa aparecem como botões no próprio card, com um clique — nenhuma etapa
// pede justificativa: a análise, inclusive o motivo de uma eventual reprovação,
// já foi escrita em Pendentes (ver src/lib/kommo.ts).
//
// TRÊS EIXOS, e a tela dá uma forma visual a cada um, porque dois seletores
// iguais lado a lado se leem como a mesma pergunta feita duas vezes:
//
//   tipo de crédito   RPV | Precatórios          abas sublinhadas, com ícone
//   destinação        Interno | Fundos           pílulas na mesma linha,
//                     (só no Precatório)         encostadas na aba
//   etapa             as colunas daquela trilha  pílulas dentro do cartão
//
// As colunas de CADA trilha são fixas no código (src/lib/kommo.ts). Já foram
// configuráveis na própria tela — tabela etapa_visao, migration 0045 —, e
// deixaram de ser por decisão do dono: o mesmo caminho do RPV.
//
// O NÚMERO AO LADO DO TIPO conta só o que a tela exibe (statusExibidos), não o
// funil inteiro do Kommo: o kanban do comercial tem colunas que não são do
// operacional, e contá-las fazia o total de cima nunca fechar com a soma das
// pílulas de baixo.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Search,
  ExternalLink,
  ArrowRight,
  Check,
  FileSearch,
  ClipboardCheck,
  RefreshCw,
  Landmark,
  Receipt,
  Scale,
  X,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { invokeFunction } from '@/lib/functions'
import {
  FUNIL_RPV,
  FUNIL_PRECATORIO,
  KOMMO_SUBDOMINIO,
  ST_DECISAO,
  ST_PROPOSTA,
  ST_DILIGENCIA,
  ST_REPROVADO,
  SUBDIVISOES_PRECATORIO,
  SUBDIVISAO_PADRAO,
  ABA_JURIDICO,
  abasDoFunil,
  agruparPorAba,
  statusExibidos,
  telasRpvDesalinhadas,
  colunasPrecatorioDesalinhadas,
  useKommoLeads,
  useKommoEtapas,
  useAnalisesProntas,
  type AcaoTela,
  type SubdivisaoPrecatorio,
  classificarParcelaCedida,
  lerTituloCard,
  valorDoCampo,
} from '@/lib/kommo'
import type { KommoLead } from '@/lib/types'
import { resumoDaOportunidade } from '@/lib/anotacaoKommo'
import { Modal } from '@/components/ui/Modal'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Field'
import { Segmented } from '@/components/ui/Segmented'
import { Tabs } from '@/components/ui/Tabs'
import { SyncStatus } from '@/components/ui/SyncStatus'
import { Loading, ErrorState, EmptyState } from '@/components/ui/Table'
import { useToast } from '@/components/ui/Toast'
import { DueDiligence } from '@/components/DueDiligence'
import {
  AnaliseRpvModal,
  GradeValoresRpv,
  type CartorioRpv,
  type DadosDoCardRpv,
  type RespostaAnaliseRpv,
  type ValoresRpv,
} from '@/components/AnaliseRpvModal'
import { formatDate } from '@/lib/format'
import { anotacoesDaAnalise, type FichaDoCredito } from '@/lib/anotacaoKommo'
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
  atingiu_alvo?: boolean
  /**
   * Os números finais da precificação, em NÚMERO (frações para percentuais).
   * A planilha sempre os teve; a tela é que só mostrava "planilha gerada".
   */
  valores?: ValoresRpv
  cartorio?: CartorioRpv
  /** Os campos do cadastro do comercial, preenchidos com o que a análise leu dos autos. */
  ficha?: FichaDoCredito
  [k: string]: unknown
}

/** O que a analise-precatorio devolve. */
type ResultadoJuridico = {
  resumo?: string | null
  linhas_no_questionario?: number
  linhas_preenchidas?: number
  avisos?: string[]
  drive_file_url?: string | null
  drive_folder_url?: string | null
  /** Os campos do cadastro do comercial, preenchidos com o que a análise leu dos autos. */
  ficha?: FichaDoCredito
  erro?: string
}

function lerCardCredijuris(lead: KommoLead) {
  const notas =
    lead.notas && lead.notas.length > 0
      ? lead.notas.map((n) => n.texto).join('\n')
      : (lead.nota_texto ?? '')
  const pegar = (re: RegExp) => valorDoCampo(notas.match(re)?.[1] ?? '')

  // O TÍTULO É A OUTRA FONTE DE TUDO, e não só do nome.
  //
  // O comercial vem encurtando o cadastro, e o destino é o título carregar os
  // campos que a anotação carregava: número, parcela cedida e percentual de
  // honorários. A ANOTAÇÃO CONTINUA VENCENDO onde existe — é a declaração mais
  // explícita, e os cards antigos a têm —, mas onde ela falta o título responde.
  //
  // Sem isto, título com a parcela cedida e nenhuma anotação classificava tudo
  // como "auto", e "auto" assume que o principal está no negócio: uma cessão só
  // de sucumbenciais era precificada como principal + honorários, em silêncio.
  const doTitulo = lerTituloCard(lead.nome)

  // O TÍTULO PRIMEIRO. É o cadastro do card; o espelho (`processo_cnj`) vinha
  // da sync procurando primeiro nas ANOTAÇÕES, e qualquer CNJ citado numa nota
  // (processo conexo, "ver também") vencia o do título — e este número
  // sobrepõe o que a IA lê nos autos. Espelho e nota "PROCESSO:" continuam
  // como reserva para o card antigo sem número no título.
  const numero = (
    doTitulo.numero ||
    (lead.processo_cnj ?? '') ||
    pegar(/PROCESSO:\s*([0-9.\-]+)/i)
  ).trim()
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

  const intermediador = doTitulo.intermediador
  const cedente = pegar(/CEDENTE:\s*(.+)/i) || doTitulo.cedente

  const tipo_aquisicao = classificarParcelaCedida(
    pegar(/PARCELA CEDIDA:\s*(.+)/i) || doTitulo.parcelaCedida,
  )

  const honMatch = notas.match(/HONOR[ÁA]RIOS?[^:\n]*:\s*([\d.,]+)\s*%/i)
  // Na anotação o ponto é separador de milhar (o resto do cadastro é assim);
  // no título, lerTituloCard já normalizou — porcentagem não tem milhar.
  const honorarios_pct = honMatch
    ? honMatch[1].replace(/\./g, '').replace(',', '.')
    : doTitulo.honorariosPct

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

// RODAPÉ QUE O TRIBUNAL ESTAMPA EM TODA PÁGINA.
//
// Isto é o que quebrava a detecção de digitalização. PJe e e-SAJ imprimem em
// CADA página um rodapé de assinatura digital com uns 200 caracteres — e esse
// rodapé É texto selecionável. Num processo digitalizado de 200 páginas isso soma
// 40 mil caracteres, o arquivo passava folgado por "tem texto", e a tela então
// afirmava "li o PDF e não achei" sobre 200 páginas que nunca foram lidas.
//
// Nenhuma dessas linhas é conteúdo do processo, então saem da conta.
const RODAPE_TRIBUNAL =
  /^.*(documento\s+assinado\s+digitalmente|assinado\s+eletronicamente\s+por|este\s+documento\s+pode\s+ser\s+verificado|c[óo]digo\s+(de\s+)?verifica|conforme\s+MP\s*n?\.?\s*2\.?200-2|n[úu]mero\s+do\s+documento:|p[áa]gina\s+\d+\s+de\s+\d+).*$/gim

/**
 * Texto e número de páginas de um PDF.
 *
 * O número de páginas importa: é ele que permite medir DENSIDADE — caracteres por
 * página —, e é a densidade, não o total, que separa "documento de texto" de
 * "digitalização com rodapé de assinatura".
 */
async function extrairTextoDoPdf(
  url: string,
): Promise<{ texto: string; paginas: number; paginasTexto: string[]; bytes: ArrayBuffer }> {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`Falha ao baixar o PDF da Kommo (HTTP ${resp.status}).`)
  const buf = await resp.arrayBuffer()
  // O pdf.js toma posse do buffer que recebe; a cópia é para o chamador poder
  // renderizar páginas depois (processo digitalizado vira imagem para a IA).
  const pdf = await pdfjsLib.getDocument({ data: buf.slice(0) }).promise
  try {
    // POR PÁGINA, e não colado: é o que permite escolher o que vai para a IA
    // quando o processo não cabe inteiro (ver lib/textoDoProcesso.ts), e medir
    // página a página o que é imagem e o que é texto.
    //
    // EM BLOCOS, e não uma de cada vez. Eram dois `await` em fila por página —
    // num processo de 300 páginas, 600 idas e voltas em série, e é o tempo que a
    // janela leva antes de mostrar qualquer coisa. O pdf.js atende pedidos
    // concorrentes; oito por vez é o que aproveita isso sem encher a memória de
    // conteúdo de página, que é o que faz a aba travar.
    const BLOCO = 8
    const paginasTexto: string[] = new Array(pdf.numPages).fill('')
    for (let inicio = 1; inicio <= pdf.numPages; inicio += BLOCO) {
      const fim = Math.min(inicio + BLOCO - 1, pdf.numPages)
      const nums: number[] = []
      for (let p = inicio; p <= fim; p++) nums.push(p)
      await Promise.all(
        nums.map(async (p) => {
          const page = await pdf.getPage(p)
          try {
            const content = await page.getTextContent()
            paginasTexto[p - 1] = (content.items as Array<{ str?: string }>).map((it) => it.str ?? '').join(' ')
          } finally {
            // Sem isto, o conteúdo de cada página fica retido no documento até
            // a aba fechar — e um processo digitalizado de 300 páginas são
            // centenas de MB.
            page.cleanup()
          }
        }),
      )
    }
    return { texto: paginasTexto.join('\n'), paginas: pdf.numPages, paginasTexto, bytes: buf }
  } finally {
    // O documento do pdf.js NUNCA era destruído aqui (renderizarPaginas destrói,
    // este não): cada PDF lido deixava um worker e o cache de páginas vivos pelo
    // resto da sessão.
    await pdf.destroy()
  }
}

export interface ArquivoLido {
  nome: string
  texto: string
  paginas: number
  /** O texto de cada página, na ordem. Vazio quando o arquivo não é PDF legível. */
  paginasTexto?: string[]
  /**
   * As páginas SEM texto útil (1-based): digitalizadas, dentro de um arquivo
   * que tem texto no resto. É o caso híbrido — processo digital com a conta da
   * contadoria escaneada —, que a densidade média não vê.
   */
  paginasImagem?: number[]
  /** Os bytes do PDF, para renderizar páginas digitalizadas como imagem. */
  bytes?: ArrayBuffer
  /** Caracteres de conteúdo por página, descontado o rodapé do tribunal. */
  densidade: number
  /** Densidade baixa: é digitalização. pdf.js lê texto, não imagem. */
  digitalizado: boolean
  erro?: string
}

/**
 * Uma página com menos que isto de conteúdo (sem o rodapé do tribunal) é
 * imagem. Página de texto real tem centenas de caracteres; página digitalizada
 * tem o rodapé e nada.
 */
const CONTEUDO_MINIMO_PAGINA = 80

// Uma página de petição tem 1500 a 3500 caracteres. Uma página digitalizada, sem
// o rodapé, tem quase zero. 150 fica longe dos dois extremos, e o erro que ele
// pode cometer é para o lado seguro: marcar como suspeito um documento curtíssimo
// e de fato legível, o que faz a tela dizer "pode ser que eu não tenha lido" em
// vez de afirmar que leu.
const DENSIDADE_MINIMA = 150

/**
 * TODOS os PDFs anexados ao card, com o texto de cada um.
 *
 * Era um PDF só — o último anexado — e isso escondia um defeito real: processo
 * de precatório costuma vir em vários arquivos (petição inicial num, cálculo
 * noutro), e se a petição fosse anexada antes do cálculo, a qualificação das
 * partes nunca chegava à tela. O campo de nascimento aparecia vazio como se o
 * dado não existisse no processo.
 *
 * ARQUIVO SEM TEXTO NÃO É ARQUIVO SEM DADO. Petição digitalizada, foto de RG,
 * comprovante de residência escaneado: tudo isso é IMAGEM, e o pdf.js extrai
 * texto selecionável, não imagem. Então o arquivo é marcado `digitalizado` e a
 * tela DIZ isso — em vez de simplesmente não achar nada e deixar parecer que o
 * processo não tem a informação.
 *
 * Falha em um arquivo não derruba os outros: cada um carrega seu próprio erro.
 *
 * NUNCA DEVOLVE LISTA VAZIA: se não há PDF, lança. Quem lê o cache trata "tem
 * entrada" como "já leu", e uma lista vazia gravada ali significaria "já leu e não
 * achou nada" — a leitura nunca mais seria tentada, e a tela ficaria em branco
 * para sempre sem dizer por quê.
 */
async function lerArquivosDoCard(lead: KommoLead): Promise<ArquivoLido[]> {
  const bk = await invokeFunction<{
    pronto?: boolean
    download_url?: string
    erro?: string
    nome_arquivo?: string
    arquivos?: { nome: string; download: string; mime?: string }[]
    nao_pdf?: string[]
    sem_link?: string[]
  }>('buscar-kommo', { lead_id: lead.kommo_lead_id })
  if (bk.erro) throw new Error(bk.erro)

  const lista =
    bk.arquivos && bk.arquivos.length > 0
      ? bk.arquivos
      : bk.download_url
        ? [{ nome: bk.nome_arquivo ?? 'processo.pdf', download: bk.download_url }]
        : []
  if (lista.length === 0) {
    throw new Error('Não achei PDF no card. Confira se o PDF do processo está anexado.')
  }

  const lidos: ArquivoLido[] = []
  for (const a of lista) {
    try {
      const { texto, paginas, paginasTexto, bytes } = await extrairTextoDoPdf(a.download)
      const limpo = texto.trim()
      const conteudo = limpo.replace(RODAPE_TRIBUNAL, '').replace(/\s+/g, ' ').trim()
      const densidade = paginas > 0 ? Math.round(conteudo.length / paginas) : 0
      const paginasImagem = paginasTexto
        .map((t, i) => (t.replace(RODAPE_TRIBUNAL, '').replace(/\s+/g, ' ').trim().length < CONTEUDO_MINIMO_PAGINA ? i + 1 : 0))
        .filter((n) => n > 0)
      lidos.push({
        nome: a.nome,
        // Guarda o texto ORIGINAL: o rodapé sai da CONTA, não do conteúdo. Um CPF
        // ou uma data podem estar em qualquer parte, e recortar por precaução
        // perderia dado de verdade.
        texto: limpo,
        paginas,
        paginasTexto,
        paginasImagem,
        bytes,
        densidade,
        digitalizado: paginas > 0 && densidade < DENSIDADE_MINIMA,
      })
    } catch (e) {
      lidos.push({
        nome: a.nome,
        texto: '',
        paginas: 0,
        densidade: 0,
        digitalizado: false,
        erro: (e as Error)?.message ?? String(e),
      })
    }
  }

  // Anexo que não é PDF entra como aviso, não como silêncio: se o RG está em JPG,
  // "não achei o RG" seria falso — ele está ali, só não é legível por aqui.
  for (const nome of bk.nao_pdf ?? []) {
    lidos.push({
      nome,
      texto: '',
      paginas: 0,
      densidade: 0,
      digitalizado: false,
      erro: 'Não é PDF — não consigo ler por aqui.',
    })
  }

  // PDF que existe no card e não trouxe link de download. A função já reportava
  // isso e o navegador ignorava — então o arquivo desaparecia da contagem e de
  // todo aviso, que é o defeito exato que esta entrega veio consertar.
  for (const nome of bk.sem_link ?? []) {
    lidos.push({
      nome,
      texto: '',
      paginas: 0,
      densidade: 0,
      digitalizado: false,
      erro: 'A Kommo não deu link de download deste PDF — não consegui baixar.',
    })
  }

  return lidos
}

/**
 * A primeira linha da anotação da ANÁLISE JURÍDICA do precatório.
 *
 * NÃO É "APROVADO", e a diferença não é de estilo. Esta etapa preenche um
 * questionário e para ali: o bloco "Critérios de Aceitação e Recusa" do modelo
 * é régua que uma PESSOA aplica, e aprovar ou reprovar é clique de gente —
 * decisão do dono, e o oposto do RPV, que tem portão automático. Escrever
 * "APROVADO" no card afirmaria uma decisão que ninguém tomou, e o comercial age
 * sobre o que está escrito ali.
 */
const VEREDITO_JURIDICO = '✅ ANÁLISE JURÍDICA CONCLUÍDA.'

// Escreve o resultado da análise no card do Kommo. Os TEXTOS moram em
// lib/anotacaoKommo.ts — é o único pedaço da análise que o comercial lê, então
// o formato é regra de negócio e fica onde dá para testar.
async function anotarResultadoNaKommo(
  leadId: number,
  r: ResultadoAnalise,
  analista: string,
  /** A primeira linha do veredito. Omitido = aprovado na análise automática. */
  veredito?: string,
) {
  const textos = anotacoesDaAnalise({
    reprovado: r.reprovado,
    motivo: r.motivo,
    motivos: r.motivos,
    link:
      (typeof r.drive_folder_url === 'string' && r.drive_folder_url) ||
      (typeof r.drive_file_url === 'string' && r.drive_file_url) ||
      '',
    ficha: r.ficha,
    avisos: r.avisos,
    analista,
    veredito,
  })
  // UMA POR VEZ, e não em paralelo: o feed do Kommo ordena pela chegada, e duas
  // chamadas simultâneas trocariam a ficha com o veredito na tela do comercial.
  //
  // Cada uma no seu try: a anotação é um extra e não trava o resultado que já
  // apareceu na tela — mas falhar na ficha não é motivo para o veredito, que é
  // o que carrega o link do Drive, também deixar de ser escrito.
  for (const texto of textos) {
    try {
      await invokeFunction('kommo-anotar', { lead_id: leadId, texto })
    } catch {
      /* segue para a próxima */
    }
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

/**
 * Que botões de trabalho o card oferece.
 *
 *   'rpv'         a análise de RPV que já existia, mais a due diligence
 *   'precatorio'  due diligence + análise jurídica (só na aba Jurídico)
 *   'nenhum'      etapa em que não se analisa: aprovados, diligência, reprovados
 */
type BotoesDoCard = 'rpv' | 'precatorio' | 'nenhum'

/**
 * As abas de RPV em que a análise JÁ ACABOU.
 *
 * Due diligence e "Executar análise" apareciam em todas as abas do funil de
 * RPV, inclusive nestas três. O raciocínio que já valia para o precatório —
 * "analisar um card já aprovado ou reprovado não é trabalho, é retrabalho" —
 * nunca foi aplicado aqui, e o botão escuro de análise ficava oferecendo, num
 * card reprovado, os dois minutos de leitura do processo.
 *
 * EXPLÍCITO, e não derivado de ACOES estar vazio. Dava na mesma hoje, e daria
 * errado no dia em que uma aba terminal ganhasse uma saída — que é justamente o
 * que acabou de acontecer com Pendentes na direção contrária.
 */
/**
 * A mensagem que acompanha o desfecho decidido PELO CARD.
 *
 * Existe porque mover um card é um ato que alguém vai ler depois, do outro lado
 * do funil, sem a análise à frente. Em Pendentes essa mensagem é escrita dentro
 * da janela de análise, com os achados para marcar; aqui não há análise aberta
 * — quem aprova em Validação está lendo o card, não rodando a leitura dos autos
 * (que custa minutos) —, então a janela é só o campo.
 *
 * APROVAR CHEGA PREENCHIDO com o resumo da oportunidade, que a análise gravou
 * no card quando foi salva. Preenchido no CAMPO, e não escondido no envio: a
 * nota sai sob o nome de quem confirma, e a linha da cessão pede complemento à
 * mão.
 */
function JanelaDeMensagem({
  lead,
  acao,
  sugestao,
  exigeMotivo,
  ocupado,
  onConfirmar,
  onFechar,
}: {
  lead: KommoLead
  acao: AcaoTela
  sugestao: string
  exigeMotivo: boolean
  ocupado: boolean
  onConfirmar: (mensagem: string) => Promise<void>
  onFechar: () => void
}) {
  const [mensagem, setMensagem] = useState(sugestao)
  const [erro, setErro] = useState<string | null>(null)
  const podeEnviar = !ocupado && (!exigeMotivo || mensagem.trim().length >= 10)

  return (
    <Modal
      open
      onClose={onFechar}
      title={acao.label}
      // O CARD EMBAIXO, e não colado no título: são duas informações de peso
      // diferente — o que se vai fazer, e sobre qual crédito. Juntas numa linha
      // só passavam de oitenta caracteres e quebravam o título em duas.
      description={tituloCard(lead)}
      size="lg"
      dirty={mensagem.trim() !== sugestao.trim()}
      footer={
        <div className="flex items-center gap-2">
          <Button
            variant={acao.variant}
            onClick={async () => {
              setErro(null)
              try {
                await onConfirmar(mensagem.trim())
              } catch (e) {
                setErro((e as Error)?.message ?? String(e))
              }
            }}
            disabled={!podeEnviar}
            loading={ocupado}
          >
            Confirmar
          </Button>
          <button
            type="button"
            onClick={onFechar}
            disabled={ocupado}
            className="text-xs text-slate-400 underline-offset-2 hover:text-slate-600 hover:underline disabled:opacity-50"
          >
            cancelar
          </button>
        </div>
      }
    >
      <textarea
        className="min-h-[220px] w-full resize-y rounded-xl border border-slate-200 px-3.5 py-2 font-mono text-[13px] leading-relaxed placeholder:font-sans placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
        value={mensagem}
        disabled={ocupado}
        placeholder={
          exigeMotivo
            ? 'Por que o card está sendo movido. Quem lê não tem a análise à mão.'
            : 'Opcional — o que o próximo a pegar este card precisa saber.'
        }
        onChange={(e) => setMensagem(e.target.value)}
      />
      {exigeMotivo && mensagem.trim().length > 0 && mensagem.trim().length < 10 && (
        <p className="mt-1.5 text-xs text-amber-700">
          Escreva a razão por extenso — ela fica no card como registro da decisão.
        </p>
      )}
      {erro && <p className="mt-1.5 text-xs text-red-700">{erro}</p>}
    </Modal>
  )
}

const ABAS_RPV_TERMINAIS: ReadonlySet<string> = new Set(['aprovados', 'diligencia', 'reprovados'])

/**
 * A aba em que o desfecho se decide DENTRO da janela da análise.
 *
 * Em Pendentes o trabalho é ler a análise e decidir, e as duas coisas passaram
 * a acontecer no mesmo lugar. Em Validação não: ali a análise já foi feita e
 * salva, quem revisa lê a anotação e a planilha, e obrigá-lo a abrir a janela
 * custaria dois minutos de releitura do processo para mover um card.
 */
const ABA_RPV_DESFECHO_NA_JANELA = 'pendentes'

/**
 * O card não tem número de processo — e isso é defeito, não ausência.
 *
 * ISTO ERA UMA LINHA DE METADADOS: "Precatório · 1057424-52.2022.8.26.0053 ·
 * principal + honorários · hon. 30%", abaixo do título, nas abas sem botão de
 * trabalho. Saiu por decisão do dono, e ela se sustenta: o número já está no
 * título do card, a espécie está na aba em que a pessoa acabou de clicar, e a
 * parcela cedida aparece na janela de análise, onde ela decide algo.
 *
 * O QUE NÃO SAIU É O AVISO. A falta do número não é um campo vazio a mais: sem
 * ele o card fica fora da busca por processo e o checklist de certidões não acha
 * o CNJ. Nenhuma outra etapa destas abas checa isso, então some com a linha e o
 * defeito passa a não ter onde aparecer.
 */
function AvisoSemNumero({ lead }: { lead: KommoLead }) {
  // Memoizado porque lerCardCredijuris junta TODAS as anotações do card numa
  // string, e há cards com histórico longo. Refazer isso a cada render de cada
  // card de uma lista de centenas é desperdício sem contrapartida.
  const d = useMemo(() => lerCardCredijuris(lead), [lead])
  if (d.numero) return null
  return (
    <div className="mt-1.5">
      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800 ring-1 ring-inset ring-amber-200">
        sem número de processo no card
      </span>
    </div>
  )
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
  onDueDiligence,
  onAnaliseJuridica,
  analisandoJuridico,
  resultadoJuridico,
  botoes,
  desfechoNoCard,
}: {
  lead: KommoLead
  acoes: AcaoTela[]
  onAcao: (l: KommoLead, a: AcaoTela) => void
  /** null = não mostrar o selo (só faz sentido na etapa de revisão). */
  analisePronta: boolean | null
  /** Destino sendo processado neste card, ou null. */
  statusEmAndamento: number | null
  onAnalisar: (l: KommoLead) => void
  analisando: boolean
  resultadoAnalise?: ResultadoAnalise
  onDueDiligence: (l: KommoLead) => void
  onAnaliseJuridica: (l: KommoLead) => void
  analisandoJuridico: boolean
  resultadoJuridico?: ResultadoJuridico
  botoes: BotoesDoCard
  /** Os desfechos ficam no card, ou na janela da análise? */
  desfechoNoCard: boolean
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
            {/* O TÍTULO VIRA LINK PARA A PASTA DO CEDENTE no Drive, quando ela
                já existe — e é onde estão as planilhas daquele processo.
                Chegar até ela era abrir o Drive e navegar três níveis, ou caçar
                o link numa anotação antiga do Kommo.

                LINK DE VERDADE, e não um clique que resolve a pasta na hora: o
                id vem gravado no card (ver migração 0059), então o destino é
                instantâneo e não há chance de falhar. Sem id — card nunca
                analisado, ou analisado antes da 0059 — fica texto, porque
                título que parece link e não leva a nada é pior que título. */}
            {lead.drive_pasta_id ? (
              <a
                href={`https://drive.google.com/drive/folders/${lead.drive_pasta_id}`}
                target="_blank"
                rel="noreferrer"
                title="Abrir a pasta deste cedente no Drive"
                className="font-medium text-slate-800 underline decoration-slate-300 decoration-1 underline-offset-2 hover:text-brand-700 hover:decoration-brand-400"
              >
                {tituloCard(lead)}
              </a>
            ) : (
              <span className="font-medium text-slate-800">{tituloCard(lead)}</span>
            )}
            {analisePronta !== null && (
              <Badge size="sm" tone={analisePronta ? 'green' : 'yellow'}>
                {analisePronta ? 'Finalizado' : 'Em curso'}
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
        {/* OS DESFECHOS SAÍRAM DO CARD NA ABA DE PENDENTES e vivem na janela da
            análise: aprovar, diligenciar ou reprovar são decisões que se tomam
            DEPOIS de ler a análise, e ali ficavam a um clique de qualquer
            leitura, ao lado do botão que ainda ia gerá-la.

            EM VALIDAÇÃO ELES FICAM. Naquela aba a análise já foi feita e salva
            — quem revisa lê a anotação e a planilha, não roda de novo —, e tirar
            os botões de lá obrigaria a abrir a janela e pagar dois minutos de
            leitura do processo para mover um card. */}
        {acoes.length > 0 && desfechoNoCard && (
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

      {/* O QUE O TÍTULO DIZ, onde não há análise para dizer.

          Nas etapas sem botão de trabalho — as quatro outras abas do Interno e
          as CINCO DO FUNDO — o card mostrava só o título cru. A leitura do
          título sempre valeu ali (lerTituloCard não tem porta por funil nem por
          subdivisão), mas nada a consumia: o comercial escrevia a parcela cedida
          e o percentual, e eles não apareciam em lugar nenhum.

          UMA LINHA, e não a ficha de sete: o card é item de lista, lido de
          relance. Campo que o título não trouxe é omitido — a ausência se lê
          por comparação com os cards vizinhos.

          Sem número em parte nenhuma é DEFEITO, e é dito: sem ele o card fica
          fora da busca por processo e o checklist de certidões não acha o CNJ.
          É a única checagem daqui, porque é a única que nenhuma outra etapa faz
          nestas abas. */}
      {botoes === 'nenhum' && (
        <AvisoSemNumero lead={lead} />
      )}

      {/* OS BOTÕES DE TRABALHO DEPENDEM DA ETAPA, e por dois motivos distintos.
          Em RPV segue o de sempre, que precifica 150 cards que funcionam. No
          precatório, só a aba Jurídico os oferece — analisar um card já aprovado
          ou reprovado não é trabalho, é retrabalho — e "Analisar" NÃO aparece: o
          motor dele é o de RPV (template, cenários e prazo de RPV), e rodá-lo num
          precatório produzia parecer errado com cara de conferido. */}
      {botoes !== 'nenhum' && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {/* A MESMA ORDEM NOS DOIS FUNIS: due diligence primeiro, análise
              depois. Em RPV estava invertida — o botão escuro vinha antes —, e
              duas telas irmãs com a ordem trocada fazem a mão errar: quem opera
              alterna entre elas o dia inteiro e clica pela POSIÇÃO, não pelo
              rótulo. A ordem também é a do trabalho: apura-se antes de analisar.

              DUE DILIGENCE NOS DOIS, com frentes diferentes: em RPV não se faz
              diligência de CERTIDÕES, só de processos judiciais, então a janela
              abre sem a aba de certidões (ver `comCertidoes`). Nunca automático:
              o checklist depende de CPF e UF que uma pessoa confere no processo,
              e rodar sozinho só produziria checklist sobre dado adivinhado. */}
          <Button
            size="sm"
            variant="outline"
            icon={<ClipboardCheck className="h-4 w-4" />}
            onClick={() => onDueDiligence(lead)}
            disabled={ocupado}
          >
            Due diligence
          </Button>

          {botoes === 'rpv' && (
            <Button
              size="sm"
              variant="secondary"
              icon={<FileSearch className="h-4 w-4" />}
              onClick={() => onAnalisar(lead)}
              loading={analisando}
              disabled={ocupado || analisando}
            >
              {/* "Executar análise", e não "Análise jurídica" como no precatório:
                  aqui a análise não é só jurídica — ela qualifica, extrai e
                  PRECIFICA (deságio, prazo, preço de cessão). Dar o mesmo nome
                  esconderia que este botão mexe em dinheiro e o outro não. */}
              {analisando ? 'Analisando…' : 'Executar análise'}
            </Button>
          )}

          {botoes === 'precatorio' && (
            <Button
              size="sm"
              variant="secondary"
              icon={<Scale className="h-4 w-4" />}
              onClick={() => onAnaliseJuridica(lead)}
              loading={analisandoJuridico}
              disabled={ocupado || analisandoJuridico}
            >
              {analisandoJuridico ? 'Analisando…' : 'Análise jurídica'}
            </Button>
          )}
        </div>
      )}
      {resultadoJuridico && (
        <div className="mt-2 rounded-lg bg-slate-50 p-3 text-xs ring-1 ring-inset ring-slate-100">
          {resultadoJuridico.erro ? (
            <div className="text-red-700">Erro: {resultadoJuridico.erro}</div>
          ) : (
            <div className="space-y-1.5">
              <div className="text-green-700">
                ✅ Análise jurídica preenchida —{' '}
                <strong>
                  {resultadoJuridico.linhas_preenchidas} de{' '}
                  {resultadoJuridico.linhas_no_questionario}
                </strong>{' '}
                linhas do modelo.{' '}
                {typeof resultadoJuridico.drive_file_url === 'string' && (
                  <a
                    className="font-medium underline"
                    href={resultadoJuridico.drive_file_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Abrir planilha
                  </a>
                )}
              </div>
              {/* A CONTAGEM VEM PRIMEIRO, e é a informação mais honesta da tela:
                  "62 de 85" diz de cara que 23 linhas ficaram para uma pessoa.
                  Sem ela, "análise preenchida" se leria como análise completa. */}
              {resultadoJuridico.resumo && (
                <p className="whitespace-pre-line text-slate-700">
                  {resultadoJuridico.resumo}
                </p>
              )}
              {!!resultadoJuridico.avisos?.length && (
                <ul className="space-y-1 text-amber-800">
                  {resultadoJuridico.avisos.map((a, i) => (
                    <li key={i}>⚠️ {a}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

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
              // O PAINEL DO CARD É UM RESUMO, e o card é um item de lista lido
              // de relance entre dezenas. Antes ele trazia a grade inteira mais
              // TODOS os avisos juntos num parágrafo só — quinze linhas de
              // âmbar, com o preço perdido no meio. Agora: os três números, os
              // links, e a contagem de alertas. O detalhe está na janela, que é
              // onde se confere.
              <div>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-medium text-green-700">Planilha gerada</span>
                  {typeof resultadoAnalise.drive_file_url === 'string' && (
                    <a
                      className="font-medium text-brand-600 hover:underline"
                      href={resultadoAnalise.drive_file_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Abrir planilha
                    </a>
                  )}
                  {typeof resultadoAnalise.due_diligence_url === 'string' && (
                    <a
                      className="font-medium text-brand-600 hover:underline"
                      href={resultadoAnalise.due_diligence_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Due diligence
                    </a>
                  )}
                </div>

                {resultadoAnalise.valores && (
                  <div className="mt-2">
                    <GradeValoresRpv
                      valores={resultadoAnalise.valores}
                      cartorio={resultadoAnalise.cartorio}
                      atingiuAlvo={resultadoAnalise.atingiu_alvo}
                      compacta
                    />
                  </div>
                )}

                {/* A CONTAGEM, e não o texto. Um número de alertas é lido de
                    relance e leva a abrir a janela; quinze linhas de aviso na
                    lista não são lidas por ninguém. */}
                {(() => {
                  const alertas = (resultadoAnalise.avisos ?? []).filter((a) =>
                    String(a).trim().startsWith('⚠️'),
                  ).length
                  if (!alertas) return null
                  return (
                    <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs text-amber-800 ring-1 ring-inset ring-amber-200">
                      <span aria-hidden>⚠️</span>
                      {alertas === 1 ? '1 ponto de atenção' : `${alertas} pontos de atenção`}
                      <span className="text-amber-700/70">· abra a análise para ver</span>
                    </p>
                  )
                })()}
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

/**
 * Alternador Interno | Fundos, ao lado das abas de tipo de crédito.
 *
 * NÃO É UM Segmented, ainda que a mecânica seja a mesma, e a diferença é o
 * ponto: a pílula cinza do Segmented tem o mesmo peso visual das abas, e dois
 * controles de peso igual lado a lado não dizem qual manda. Aqui o contorno é
 * fino e o escolhido é azul CHEIO — a forma redonda o separa das abas
 * sublinhadas, e o preenchimento deixa óbvio que ali se escolhe uma das duas.
 *
 * Fonte no tamanho do resto da tela. A tentativa anterior encolhia a letra para
 * subordinar o controle, e encolher letra para hierarquizar só piora a leitura:
 * quem subordina aqui é a forma, não o tamanho.
 *
 * Vive nesta tela, e não em components/ui, porque tem um consumidor só. Se
 * aparecer um segundo, promove.
 */
function SeletorDestinacao({
  valor,
  onChange,
}: {
  valor: SubdivisaoPrecatorio
  onChange: (v: SubdivisaoPrecatorio) => void
}) {
  return (
    <div
      role="group"
      // O ÚNICO rótulo do controle: não há texto visível dizendo o que ele
      // decide, então sem isto o leitor de tela anuncia dois botões soltos.
      aria-label="Destinação do precatório"
      className="inline-flex items-center rounded-full bg-white p-0.5 ring-1 ring-inset ring-slate-200"
    >
      {SUBDIVISOES_PRECATORIO.map((s) => {
        const ativo = s.key === valor
        return (
          <button
            key={s.key}
            type="button"
            aria-pressed={ativo}
            onClick={() => onChange(s.key)}
            className={cn(
              'font-display rounded-full px-3 py-1 text-sm transition-colors',
              // Contraste medido: brand-600 com branco dá 6,56:1 e slate-500 no
              // branco 4,76:1. Os dois passam o AA de texto normal (4,5:1), que
              // a plataforma toda já cumpre — o inativo com pouca folga, então
              // não clarear esse cinza sem medir de novo.
              ativo
                ? 'bg-brand-600 font-semibold text-white'
                : 'font-medium text-slate-500 hover:text-slate-700',
            )}
          >
            {s.label}
          </button>
        )
      })}
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
  // Destinação do precatório. Só tem efeito no funil de Precatórios; em RPV o
  // valor fica guardado e ignorado, para voltar ao mesmo lugar na troca de funil.
  const [subdivisao, setSubdivisao] =
    useState<SubdivisaoPrecatorio>(SUBDIVISAO_PADRAO)
  const [busca, setBusca] = useState('')
  // Ação em curso, para o botão certo do card certo mostrar o spinner.
  const [emAndamento, setEmAndamento] = useState<{
    leadId: number
    statusId: number
  } | null>(null)
  // Análise automática (Judit + due diligence + planilha) por card.
  const { user: authUser, profile: authProfile } = useAuth()
  const analistaNome = authProfile?.nome || authUser?.email || 'Usuário'
  // A análise de RPV abre uma JANELA (AnaliseRpvModal): preliminar, conversa e
  // só então o salvamento. `rpvLead` é o card cuja janela está aberta.
  const [rpvLead, setRpvLead] = useState<KommoLead | null>(null)
  const [analisandoJurId, setAnalisandoJurId] = useState<number | null>(null)
  const [resultadoJuridico, setResultadoJuridico] = useState<
    Record<number, ResultadoJuridico>
  >({})
  const [resultadoAnalise, setResultadoAnalise] = useState<Record<number, ResultadoAnalise>>({})

  // Texto do PDF por card, compartilhado entre a análise e o checklist de
  // certidões: o mesmo PDF serve aos dois e baixar duas vezes seria espera à
  // toa. Vive enquanto a página estiver aberta; o sync limpa (ver abaixo),
  // porque o PDF do card pode ter sido substituído no Kommo.
  const [arquivosCache, setArquivosCache] = useState<Record<number, ArquivoLido[]>>({})
  /**
   * Quantos cards ficam com os anexos na memória.
   *
   * Cada `ArquivoLido` carrega `bytes` — o PDF inteiro. Processo digitalizado
   * tem 50 a 150 MB, e o cache guardava TODO card aberto até o próximo sync:
   * quatro cards e a aba começava a engasgar. Dois cobrem o uso real (o card em
   * que se está e o anterior, para quem alterna entre Analisar e Certidões).
   */
  const MAX_CARDS_EM_CACHE = 2
  /** A ordem em que os cards entraram no cache — objeto não guarda ordem de chave numérica. */
  const ordemCache = useRef<number[]>([])
  /**
   * Leituras em voo, por card.
   *
   * Sem isto, clicar em Certidões e Analisar no mesmo card em sequência rápida
   * baixava e reprocessava os mesmos PDFs duas vezes — o cache só existe DEPOIS
   * que a primeira leitura termina.
   */
  const leiturasEmVoo = useRef<Map<number, Promise<ArquivoLido[]>>>(new Map())

  /** Guarda no cache e descarta os cards mais antigos, liberando os bytes deles. */
  const guardarNoCache = useCallback((id: number, lidos: ArquivoLido[]) => {
    ordemCache.current = [...ordemCache.current.filter((x) => x !== id), id]
    const manter = new Set(ordemCache.current.slice(-MAX_CARDS_EM_CACHE))
    ordemCache.current = [...manter]
    setArquivosCache((p) => {
      const novo: Record<number, ArquivoLido[]> = { [id]: lidos }
      for (const [k, v] of Object.entries(p)) if (manter.has(Number(k))) novo[Number(k)] = v
      return novo
    })
  }, [])

  /** Lê uma vez só, ainda que dois lugares peçam ao mesmo tempo. */
  const lerUmaVezSo = useCallback((lead: KommoLead): Promise<ArquivoLido[]> => {
    const id = lead.kommo_lead_id
    const emVoo = leiturasEmVoo.current.get(id)
    if (emVoo) return emVoo
    const p = lerArquivosDoCard(lead).finally(() => leiturasEmVoo.current.delete(id))
    leiturasEmVoo.current.set(id, p)
    return p
  }, [])
  const [ddLead, setDdLead] = useState<KommoLead | null>(null)
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

  function onAnalisar(lead: KommoLead) {
    // O CACHE DE ANEXOS CAI ao abrir a análise. Ele existe para a due diligence
    // e a análise dividirem o mesmo download; mas o comercial anexa o cálculo
    // corrigido e o operador reabre a janela sem sincronizar — e a análise lia
    // o anexo antigo, sem nada dizer. Abrir a análise é o momento em que ler
    // fresco vale mais que economizar um download.
    setArquivosCache((p) => {
      const { [lead.kommo_lead_id]: _descartado, ...resto } = p
      void _descartado
      return resto
    })
    setRpvLead(lead)
  }

  /** Lê os anexos do card, guardando no cache na hora — a janela e a due diligence dividem o mesmo PDF. */
  async function lerArquivosComCache(lead: KommoLead): Promise<ArquivoLido[]> {
    const id = lead.kommo_lead_id
    const lidos = arquivosCache[id] ?? (await lerUmaVezSo(lead))
    guardarNoCache(id, lidos)
    return lidos
  }

  /** O que a função de RPV precisa saber do card, em toda chamada da janela. */
  function dadosParaRpv(lead: KommoLead): DadosDoCardRpv {
    const d = lerCardCredijuris(lead)
    return {
      numero_processo: d.numero,
      categoria: d.categoria,
      intermediador: d.intermediador,
      tipo_aquisicao: d.tipo_aquisicao,
      honorarios_pct: d.honorarios_pct,
    }
  }

  /** Todas as anotações do card, da mais antiga à mais nova: a IA lê junto com os autos. */
  function notasDoCard(lead: KommoLead): string {
    const lista = lead.notas && lead.notas.length > 0 ? lead.notas.map((n) => n.texto) : [lead.nota_texto ?? '']
    return lista.filter(Boolean).join('\n---\n')
  }

  /**
   * Análise jurídica do precatório: manda o caderno inteiro para o modelo.
   *
   * TODOS OS PDFs, e não o último como na análise de RPV. A diferença tem razão:
   * lá o motor PRECIFICA, e juntar a petição inicial ao cálculo faria o valor da
   * causa entrar como valor do crédito. Aqui não se precifica nada — o
   * questionário pergunta por sentença, recursos, trânsito, cumprimento,
   * manifestação da contadoria e expedição, que estão espalhados por documentos
   * diferentes. Ler só o último deixaria a maior parte das linhas em branco.
   *
   * Arquivo sem texto entra como aviso no corpo, não é omitido: "não consegui
   * ler" e "não existe nos autos" são respostas diferentes, e o modelo precisa
   * saber qual das duas está diante dele.
   */
  async function onAnaliseJuridica(lead: KommoLead) {
    const id = lead.kommo_lead_id
    setAnalisandoJurId(id)
    try {
      const lidos = arquivosCache[id] ?? (await lerUmaVezSo(lead))
      guardarNoCache(id, lidos)

      const comTexto = lidos.filter((a) => a.texto.trim().length > 0)
      if (comTexto.length === 0) {
        const motivos = lidos
          .map(
            (a) =>
              `${a.nome}: ${
                a.erro ??
                (a.digitalizado
                  ? `${a.paginas} página(s) com ${a.densidade} caractere(s) por página — digitalizado`
                  : 'sem texto selecionável')
              }`,
          )
          .join('; ')
        throw new Error(`Nenhum anexo do card tem texto para ler. ${motivos}`)
      }
      const corpo = comTexto
        .map((a) => `\n===== ARQUIVO: ${a.nome} (${a.paginas} pág.) =====\n${a.texto}`)
        .join('\n')
      const ilegiveis = lidos
        .filter((a) => a.texto.trim().length === 0)
        .map((a) => `${a.nome} (${a.erro ?? 'digitalizado, sem texto'})`)
      const aviso = ilegiveis.length
        ? `\n\nANEXOS QUE NÃO DEU PARA LER (o dado pode estar neles): ${ilegiveis.join('; ')}`
        : ''

      const dados = lerCardCredijuris(lead)
      const r = await invokeFunction<ResultadoJuridico>('analise-precatorio', {
        kommo_lead_id: id,
        texto: corpo + aviso,
        numero_processo: dados.numero,
        cedente: dados.cedente,
        originador: dados.intermediador,
        // O QUE ESTÁ SENDO CEDIDO, do título do card — as mesmas regras da RPV.
        // Sem isto a ficha do precatório não saberia sobre que verbas é o
        // negócio, e o VALOR CEDIDO sairia do crédito inteiro.
        tipo_aquisicao: dados.tipo_aquisicao,
        honorarios_pct: dados.honorarios_pct,
      })
      setResultadoJuridico((p) => ({ ...p, [id]: r }))
      // A ANOTAÇÃO NO CARD, como na RPV: a ficha do crédito e o veredito.
      // Antes esta etapa não escrevia nada no Kommo — quem rodava a análise via
      // o resultado na tela, e o comercial não via nada.
      void anotarResultadoNaKommo(id, r as unknown as ResultadoAnalise, analistaNome, VEREDITO_JURIDICO)
    } catch (e) {
      setResultadoJuridico((p) => ({
        ...p,
        [id]: { erro: (e as Error)?.message ?? String(e) },
      }))
    } finally {
      setAnalisandoJurId(null)
    }
  }

  // Analisar e Certidões escreviam atrás de um window.confirm quando o card
  // estava fora do fluxo. A confirmação morreu com a aba "Outras etapas": ela só
  // disparava lá, e sem aquela aba não há como abrir na tela um card que esteja
  // fora das colunas listadas — logo, nada a confirmar.

  /**
   * Abre o checklist. O modal aparece NA HORA e o PDF é lido em segundo plano:
   * a sugestão de CPF é conveniência, não requisito. Se o PDF não existir ou for
   * digitalizado, o formulário continua utilizável — quem confere digita.
   */
  function onDueDiligence(lead: KommoLead) {
    setDdLead(lead)
    const id = lead.kommo_lead_id
    // Lê os anexos sempre, mesmo quando a janela vai abrir no placar e as
    // sugestões não vão aparecer. É desperdício de rede conhecido, e uma escolha:
    // evitá-lo exigiria a página saber de antemão quais créditos já têm sujeito
    // cadastrado — consulta nova, estado novo, e uma chance nova de a janela abrir
    // sem os dados por engano. Um download a mais é mais barato que isso.
    // Já tem o texto, já está lendo, ou o Analisar está lendo o mesmo PDF agora:
    // em todos os casos, disparar de novo só baixaria o arquivo duas vezes.
    if (arquivosCache[id] || lendoPdf.has(id) || rpvLead?.kommo_lead_id === id) return
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
    void lerUmaVezSo(lead)
      .then((as) => guardarNoCache(id, as))
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
      // invalidar, coluna renomeada no Kommo continuaria com o nome antigo aqui
      // até o próximo F5 — e é pelo nome que o Precatório acha as dele.
      qc.invalidateQueries({ queryKey: ['kommo_etapa'] })
      // Aviso de sucesso PARCIAL: os cards vieram, a estrutura do kanban não.
      // Silenciar isto deixaria uma aba faltando sem explicação.
      if (r?.aviso) toast.error(r.aviso)
      // O sync pode ter trazido um PDF novo no card — versão corrigida do
      // processo é rotina —, e servir CPF de documento vencido é o erro que a
      // lista de candidatos existe para evitar. Então descarta.
      //
      // MENOS O CARD ABERTO NA JANELA. O sync de abertura de página leva
      // dezenas de segundos; quem clicava em Certidões antes de ele acabar via a
      // janela esvaziar embaixo de si — candidatos, sugestões E o aviso de
      // digitalização — e nada refazia a leitura, porque ela só dispara no
      // clique. Perder o aviso é o pior dos três: a janela voltava a dizer que o
      // PDF não tinha sido lido.
      const aberto = ddLead?.kommo_lead_id
      const manter = (antes: Record<number, unknown>) =>
        aberto !== undefined && antes[aberto] !== undefined
          ? { [aberto]: antes[aberto] }
          : {}
      setArquivosCache((antes) => manter(antes) as Record<number, ArquivoLido[]>)
      setAvisoPdf((antes) => manter(antes) as Record<number, string>)
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
    () => abasDoFunil(funil, etapas.data ?? [], subdivisao),
    [funil, etapas.data, subdivisao],
  )

  const { porAba } = useMemo(
    () => agruparPorAba(leads.data ?? [], abas),
    [leads.data, abas],
  )

  /**
   * Quantos cards o funil aberto EXIBE — o número ao lado de RPV/Precatórios.
   *
   * Não é o tamanho do funil no Kommo: o kanban do comercial tem colunas que não
   * são do operacional, e contá-las fazia o número de cima nunca fechar com a
   * soma das pílulas de baixo. Dois totais discordando na mesma tela, sem nada
   * explicando a diferença, é pior que um total a menos.
   *
   * `undefined` enquanto a consulta está em voo ou falhou, nunca 0: "Precatórios
   * 0" ao lado de uma mensagem de erro afirma que o funil está vazio.
   */
  const totalExibido = useMemo(() => {
    if (!leads.data) return undefined
    const ids = statusExibidos(funil, etapas.data ?? [])
    return leads.data.filter((l) => ids.has(l.status_id)).length
  }, [leads.data, funil, etapas.data])

  // Coluna que a tela fixa e o kanban não tem. Em RPV o vínculo é por id (quebra
  // se a coluna for recriada); em Precatório é por nome (quebra se for
  // renomeada). O sintoma é o mesmo — aba com zero card para sempre — e sem
  // aviso ninguém liga o sintoma à causa.
  const rpvDesalinhado = useMemo(
    () => (funil === FUNIL_RPV ? telasRpvDesalinhadas(etapas.data ?? []) : []),
    [funil, etapas.data],
  )
  const precatorioDesalinhado = useMemo(
    () =>
      funil === FUNIL_PRECATORIO
        ? colunasPrecatorioDesalinhadas(etapas.data ?? [], subdivisao)
        : [],
    [funil, etapas.data, subdivisao],
  )

  // A aba escolhida pode não existir no funil recém-selecionado (as chaves de
  // RPV são 'pendentes'…, as de Precatório são 'int-…'/'fun-…'). Cai na primeira.
  const abaAtual = abas.find((a) => a.key === aba) ?? abas[0] ?? null

  /**
   * Os botões de trabalho da etapa aberta.
   *
   * RPV segue como era em toda aba. No PRECATÓRIO só a aba Jurídico oferece
   * trabalho: é lá que a due diligence e a análise jurídica acontecem, e oferecer
   * "analisar" num card já aprovado ou reprovado convida ao retrabalho.
   *
   * E o "Analisar" de RPV não aparece em precatório NENHUM — nem na aba Jurídico.
   * Era o defeito relatado: o motor por trás dele é o `gerar-analise-rpv`, com
   * template, cenários (RPV expedida ou não) e cálculo de prazo de RPV, e num
   * precatório ele entregava parecer e planilha errados sem nenhum sinal na tela.
   */
  const botoesDoCard: BotoesDoCard =
    funil === FUNIL_RPV
      ? (ABAS_RPV_TERMINAIS.has(abaAtual?.key ?? '') ? 'nenhum' : 'rpv')
      : abaAtual?.key === ABA_JURIDICO
        ? 'precatorio'
        : 'nenhum'

  const lista = useMemo(() => {
    let l = abaAtual ? (porAba[abaAtual.key] ?? []) : []
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
  }, [porAba, abaAtual, busca])

  /** O card e o desfecho aguardando a mensagem, quando a decisão vem do card. */
  const [mensagemDoCard, setMensagemDoCard] = useState<{ lead: KommoLead; acao: AcaoTela } | null>(
    null,
  )

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

  /**
   * Mover o card e deixar a mensagem como NOTA — o único caminho, para os dois
   * lugares em que se decide um desfecho (a janela de análise, em Pendentes, e
   * a janela do card, em Validação).
   *
   * A MENSAGEM NÃO VAI NA LINHA DE AUDITORIA DO MOVIMENTO. Colada nela, o feed
   * do Kommo a renderiza como continuação do "Movido de X para Y por admin.":
   * bloco corrido, sem as quebras, atrás de um "mais". A nota do kommo-anotar
   * aparece como nota de verdade, com autor e parágrafos preservados.
   *
   * O MOVIMENTO PRIMEIRO, a nota depois: o feed ordena pela chegada, e a ordem
   * de leitura é o que aconteceu e então por quê.
   */
  async function moverComNota(leadId: number, statusId: number, mensagem: string) {
    await mover.mutateAsync({ leadId, statusId, comentario: '' })
    const texto = mensagem.trim()
    if (!texto) return
    try {
      await invokeFunction('kommo-anotar', { lead_id: leadId, texto })
    } catch (e) {
      throw new Error(
        'O card foi movido, mas a nota com a mensagem não subiu (' +
          ((e as Error)?.message ?? String(e)) +
          '). O texto continua aqui.',
      )
    }
  }

  /**
   * O desfecho pelo CARD: abre a janela da mensagem.
   *
   * ANTES ERA UM CLIQUE SECO, e o card mudava de coluna sem uma linha de
   * explicação. Quem pega o card do outro lado — para apresentar a proposta,
   * para refazer a diligência — não tem a análise à frente, e a movimentação
   * sozinha não diz por quê.
   */
  function acionar(lead: KommoLead, acao: AcaoTela) {
    setMensagemDoCard({ lead, acao })
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

      {/* TRÊS EIXOS, TRÊS FORMAS. O tipo de crédito e a destinação já foram o
          mesmo componente, um do lado do outro: liam-se como a mesma pergunta
          feita duas vezes. A distinção agora é de forma e de posição —

            tipo de crédito   abas sublinhadas, com ícone
            destinação        pílulas encostadas na aba de Precatórios
            etapa             pílulas dentro do cartão, sob a busca

          A contagem sai do funil CARREGADO, então o outro fica sem número até
          ser aberto: melhor sem número que com número errado. */}
      <div className="mb-4">
        <Tabs
          items={[
            {
              key: String(FUNIL_RPV),
              label: 'RPV',
              icon: <Receipt className="h-4 w-4" />,
              count: funil === FUNIL_RPV ? totalExibido : undefined,
            },
            {
              key: String(FUNIL_PRECATORIO),
              label: 'Precatórios',
              icon: <Landmark className="h-4 w-4" />,
              count: funil === FUNIL_PRECATORIO ? totalExibido : undefined,
            },
          ]}
          value={String(funil)}
          onChange={(v) => {
            setFunil(Number(v))
            // A chave da aba não é comparável entre funis ('pendentes' vs
            // 'int-…'). Limpar aqui evita a tela abrir vazia por casar nada.
            setAba('')
            setBusca('')
          }}
          trailing={
            funil === FUNIL_PRECATORIO ? (
              <SeletorDestinacao
                valor={subdivisao}
                onChange={(v) => {
                  setSubdivisao(v)
                  // As chaves das abas são próprias de cada trilha ('int-…' e
                  // 'fun-…'): sem limpar, a tela cairia na primeira por acidente
                  // em vez de por decisão.
                  setAba('')
                }}
              />
            ) : undefined
          }
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
          {abas.length > 0 ? (
            <Segmented
              ariaLabel="Etapa da análise"
              items={abas.map((a) => ({
                key: a.key,
                label: a.label,
                count: porAba[a.key]?.length ?? 0,
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

      {/* Coluna fixada que o kanban não tem. Vermelho, e não amarelo: aqui a aba
          fica vazia PARA SEMPRE, e é defeito de configuração, não recado. */}
      {rpvDesalinhado.length > 0 && (
        <div className="mb-4 rounded-lg bg-red-50 p-3 text-xs text-red-800 ring-1 ring-inset ring-red-200">
          A coluna do Kommo de{' '}
          <strong>{rpvDesalinhado.map((t) => t.label).join(', ')}</strong> não existe
          mais neste funil. A aba vai mostrar zero card até alguém corrigir o número
          da coluna em src/lib/kommo.ts.
        </div>
      )}

      {precatorioDesalinhado.length > 0 && (
        <div className="mb-4 rounded-lg bg-red-50 p-3 text-xs text-red-800 ring-1 ring-inset ring-red-200">
          Não achei no Kommo a coluna{' '}
          <strong>
            {precatorioDesalinhado.map((a) => `"${a.colunaKommo}"`).join(', ')}
          </strong>
          . A aba correspondente ({precatorioDesalinhado.map((a) => a.label).join(', ')}
          ) fica com zero card até o nome bater. Causa provável: a coluna foi
          renomeada no Kommo — é só alinhar o nome lá ou em src/lib/kommo.ts.
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
                desfechoNoCard={abaAtual?.key !== ABA_RPV_DESFECHO_NA_JANELA}
                onAcao={acionar}
                // EM RPV o selo aparece só em Pendentes: nas etapas seguintes a
                // análise já passou pela revisão, e dizer "finalizado" ali seria
                // ruído. NO PRECATÓRIO ele aparece em toda aba, porque o fluxo
                // de análise automática ainda não tem uma etapa definida como "a
                // fila" — e sem o selo, card com análise pronta ficaria
                // visualmente idêntico a card que ninguém tocou.
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
                analisando={rpvLead?.kommo_lead_id === l.kommo_lead_id}
                resultadoAnalise={
                  funil === FUNIL_RPV && abaAtual?.key !== 'pendentes'
                    ? undefined
                    : resultadoAnalise[l.kommo_lead_id]
                }
                onDueDiligence={onDueDiligence}
                onAnaliseJuridica={onAnaliseJuridica}
                analisandoJuridico={analisandoJurId === l.kommo_lead_id}
                resultadoJuridico={resultadoJuridico[l.kommo_lead_id]}
                botoes={botoesDoCard}
              />
            ))}
          </div>
        )}
      </Card>

      {mensagemDoCard && (
        <JanelaDeMensagem
          key={`${mensagemDoCard.lead.kommo_lead_id}-${mensagemDoCard.acao.statusId}`}
          lead={mensagemDoCard.lead}
          acao={mensagemDoCard.acao}
          // O RESUMO DA OPORTUNIDADE SÓ NA APROVAÇÃO: é o que a coluna seguinte
          // precisa para montar a proposta. Numa diligência ou reprovação ele
          // seria a ficha de um crédito que não vai adiante.
          sugestao={
            mensagemDoCard.acao.statusId === ST_PROPOSTA && mensagemDoCard.lead.oportunidade
              ? resumoDaOportunidade(mensagemDoCard.lead.oportunidade)
              : ''
          }
          exigeMotivo={
            mensagemDoCard.acao.statusId === ST_DILIGENCIA ||
            mensagemDoCard.acao.statusId === ST_REPROVADO
          }
          ocupado={mover.isPending}
          onConfirmar={async (mensagem) => {
            setEmAndamento({
              leadId: mensagemDoCard.lead.kommo_lead_id,
              statusId: mensagemDoCard.acao.statusId,
            })
            await moverComNota(
              mensagemDoCard.lead.kommo_lead_id,
              mensagemDoCard.acao.statusId,
              mensagem,
            )
            setMensagemDoCard(null)
          }}
          onFechar={() => setMensagemDoCard(null)}
        />
      )}

      {rpvLead && (
        <AnaliseRpvModal
          // key pelo card: trocar de card recomeça a análise do zero.
          key={rpvLead.kommo_lead_id}
          open
          leadId={rpvLead.kommo_lead_id}
          titulo={tituloCard(rpvLead)}
          // SÓ NA ABA EM QUE O DESFECHO MORA AQUI. Nas outras a seção não
          // aparece — os botões continuam no card, e mostrá-los nos dois
          // lugares daria duas portas para a mesma decisão.
          acoes={abaAtual?.key === ABA_RPV_DESFECHO_NA_JANELA ? (abaAtual?.acoes ?? []) : []}
          onMover={async (statusId, comentario) => {
            await moverComNota(rpvLead.kommo_lead_id, statusId, comentario)
            // A janela fecha porque o card saiu desta aba: manter aberta uma
            // análise de um card que já foi movido é oferecer botões que não
            // valem mais.
            setRpvLead(null)
          }}
          dadosDoCard={dadosParaRpv(rpvLead)}
          notasKommo={notasDoCard(rpvLead)}
          lerArquivos={() => lerArquivosComCache(rpvLead)}
          onSalvo={(r: RespostaAnaliseRpv) => {
            // Só depois de salvar o card ganha o resultado e a anotação no Kommo —
            // era isso que a versão de um clique fazia cedo demais.
            const final = r as unknown as ResultadoAnalise
            setResultadoAnalise((p) => ({ ...p, [rpvLead.kommo_lead_id]: final }))
            void anotarResultadoNaKommo(rpvLead.kommo_lead_id, final, analistaNome)
          }}
          onClose={() => {
            // OS BYTES DOS PDFs SAEM DA MEMÓRIA AO FECHAR. Eles serviam a uma
            // coisa só — renderizar as páginas digitalizadas —, e isso já
            // aconteceu. O TEXTO fica, porque a aba de Certidões ainda o usa
            // para sugerir CPF; os megabytes, não.
            const id = rpvLead.kommo_lead_id
            setArquivosCache((p) => {
              const atual = p[id]
              if (!atual) return p
              return { ...p, [id]: atual.map((a) => (a.bytes ? { ...a, bytes: undefined } : a)) }
            })
            setRpvLead(null)
          }}
        />
      )}

      {ddLead && (
        <DueDiligence
          // key pelo card: trocar de card remonta a janela do zero, em vez de
          // reaproveitar o formulário já preenchido com os dados do anterior.
          key={ddLead.kommo_lead_id}
          open
          leadId={ddLead.kommo_lead_id}
          cedenteDoCard={lerCardCredijuris(ddLead).cedente}
          arquivos={arquivosCache[ddLead.kommo_lead_id] ?? []}
          lendoPdf={
            lendoPdf.has(ddLead.kommo_lead_id) ||
            rpvLead?.kommo_lead_id === ddLead.kommo_lead_id
          }
          avisoPdf={avisoPdf[ddLead.kommo_lead_id] ?? null}
          // Certidões só no precatório. Lido do CARD, não do funil aberto: o
          // card guardado no estado é quem manda, e trocar de funil com a janela
          // aberta não pode mudar as frentes da diligência em curso.
          comCertidoes={ddLead.pipeline_id === FUNIL_PRECATORIO}
          onClose={() => setDdLead(null)}
        />
      )}
    </div>
  )
}
