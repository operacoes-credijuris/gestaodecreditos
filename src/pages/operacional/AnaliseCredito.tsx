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
//   destinação        Interno | Externo           pílulas na mesma linha,
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
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { perguntarDescarte } from '@/lib/descarte'
import { guardarLugar, lugarGuardado } from '@/lib/lugarDaAnalise'
import { LinkTentarDeNovo } from '@/components/LinkTentarDeNovo'
import {
  BotaoJustificativa,
  JanelaJustificativa,
  useJustificativasDaAba,
  type ResumoDaJustificativa,
} from '@/components/JustificativaTecnica'
import {
  AlertTriangle,
  Search,
  ExternalLink,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  FileSignature,
  FileText,
  History,
  Info,
  Sparkles,
  Upload,
  FileSearch,
  ClipboardCheck,
  RefreshCw,
  Landmark,
  Handshake,
  Pencil,
  Loader2,
  MessageSquarePlus,
  Paperclip,
  Receipt,
  ScrollText,
  Tag,
  CheckCircle2,
  X,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { useCaixaNaTela, type AjusteDaCaixa } from '@/lib/dentroDaJanela'
import { invokeFunction } from '@/lib/functions'
import { enviarArquivo, type ProgressoDoEnvio } from '@/lib/enviarArquivo'
import { CaixaDeAnotacao, useAnotacaoDoCard } from '@/components/CaixaDeAnotacao'
import {
  FUNIL_RPV,
  FUNIL_PRECATORIO,
  KOMMO_SUBDOMINIO,
  type PapelDaTela,
  type DesfechoDaNegociacao,
  SUBDIVISOES_PRECATORIO,
  ABAS_COM_TAGS,
  botoesDaAba,
  type BotoesDoCard,
  type EtiquetaDoFundo,
  type AtoDoEnvio,
  type FundoDoEnvio,
  ATOS_DA_PRECIFICACAO,
  ETIQUETAS_DA_PRECIFICACAO,
  desdeQuandoAEtiqueta,
  etiquetaCanonica,
  etiquetasDaAba,
  etiquetasPorDestino,
  FUNDOS_DA_PRECIFICACAO,
  mensagemDaProposta,
  mesmaEtiqueta,
  ordenarEtiquetas,
  ehFunilPrecatorio,
  acaoDeReprovar,
  dataDaEtapa,
  ehCardExterno,
  abasDoFunil,
  agruparPorAba,
  statusExibidos,
  coresDasTags,
  telasRpvDesalinhadas,
  colunasPrecatorioDesalinhadas,
  useKommoLeads,
  useKommoEtapas,
  useAnalisesProntas,
  type TomDaTag,
  type AcaoTela,
  type SubdivisaoPrecatorio,
  lerCadastroDoCard,
  lerTituloCard,
} from '@/lib/kommo'
import type { KommoLead, KommoNota } from '@/lib/types'
import { semRodapeDeAssinatura } from '@/lib/textoDoProcesso'
import { resumoDaOportunidade, VEREDITO_JURIDICO } from '@/lib/anotacaoKommo'
import { Modal } from '@/components/ui/Modal'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Textarea } from '@/components/ui/Field'
import { SyncStatus } from '@/components/ui/SyncStatus'
import { Loading, ErrorState, EmptyState, SemResultado } from '@/components/ui/Table'
import { Chip } from '@/components/ui/Chip'
import { CampoDeBusca } from '@/components/ui/CampoDeBusca'
import { useToast } from '@/components/ui/Toast'
import { CaixaDeAviso, DicaDeAviso, Selo, icSelo } from '@/components/analise/Pecas'
import { haDialogoAberto } from '@/lib/dialogo'
import { estaDigitando } from '@/lib/atalhos'
import { gravarPreferencia, lerPreferencia } from '@/lib/preferencias'
import { apagarRascunho, guardarRascunho, rascunhoGuardado, type Rascunho } from '@/lib/rascunhoDoCard'
import {
  achadosDaBusca,
  camposDoTitulo,
  casaComABusca,
  diasNaEtapa,
  estaParado,
  fasesDoQuadro,
  filtrarEOrdenar,
  idadeCurta,
  indiceDaBusca,
  larguraDaBarra,
  lerOrdem,
  nomeDaColuna,
  passoDaTecla,
  POR_VEZ,
  PRAZO_PARADO,
  PREF_ORDEM_DA_ANALISE,
  prepararBusca,
  proximoCard,
  temCotacao,
  textoDosDias,
  type ConsultaDaBusca,
  type FiltroRapido,
  type OrdemDaLista,
} from '@/lib/quadroDaAnalise'
import { DueDiligence } from '@/components/DueDiligence'
import { JanelaDeCertidoes } from '@/components/JanelaDeCertidoes'
import { promptDaAnaliseExterna, urlDoClaude } from '@/lib/analiseExterna'
import { escolherPaginasParaImagem, LIMITES_DO_CONECTOR } from '@/lib/paginasDigitalizadas'
import { subirAnexosDeImagem, subirImagensDosAutos, type ImagemSubida } from '@/lib/imagensDosAutos'
import { agruparNotas, ehAnexo, nomeDoAnexo } from '@/lib/historicoDeNotas'
import { supabase } from '@/lib/supabase'
import {
  verbasQueSobram,
  type PapelApurado,
} from '../../../supabase/functions/_shared/titularesDaCessao.ts'
import {
  AnaliseRpvModal,
  GradeValoresRpv,
  type CartorioRpv,
  type DadosDoCardRpv,
  type RespostaAnaliseRpv,
  type ValoresRpv,
} from '@/components/AnaliseRpvModal'
import { formatDataHoraSegundos, formatDateTime, tempoDecorrido } from '@/lib/format'
import { anotacoesDaAnalise, type FichaDoCredito } from '@/lib/anotacaoKommo'
import { carregarPdfjs } from '@/lib/pdfjs'
import { useAuth } from '@/contexts/AuthContext'
import {
  comSugestao,
  montarNotaDoDesfecho,
  MOTIVOS_NAO_FECHOU,
  motivoSuficiente,
  notaDoFechado,
  notaDoNaoFechou,
  type TipoDeNaoFechou,
} from '@/lib/desfechoDoCard'
import { cardDoEndereco } from '@/lib/contratoDoCard'
import {
  chaveDoMovimento,
  comecarNoCard,
  movimentoRecusado,
  soDosAbertos,
  terminarNoCard,
  type PorCard,
} from '@/lib/emCursoPorCard'
import { TextoComTermos } from '@/components/layout/TextoComTermos'
import { CamposDaCotacao, JanelaDeCotacao, useCotacaoEmEdicao } from '@/components/JanelaDeCotacao'
import { registrarEnvioAoFundo, type ResultadoDoEnvio } from '@/lib/envioAoFundo'
import {
  comCotacaoGravada,
  type Cotacao,
  type CotacaoLida,
  cotacoesDoCard,
  formatarPercentual,
  formatarReais,
  NOME_DO_GRUPO_DAS_COTACOES,
  type ValorDeCampo,
} from '../../../supabase/functions/_shared/cotacaoDoFundo.ts'

// ===== Análise automática do card (Judit -> due diligence -> planilha) =====
// Lê os dados do próprio card (título + notas) e roda a sequência no motor.
type ResultadoAnalise = {
  reprovado?: boolean
  motivo?: string

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
  /** 'conversa' quando a planilha saiu do bloco que o Claude entregou; ausente, do motor antigo. */
  origem?: string
  /** A pasta do cedente no Drive — a mesma que o título do card passa a abrir. */
  pasta_id?: string
  erro?: string
}

/**
 * SÓ AS NOTAS DE GENTE alimentam a leitura do cadastro.
 *
 * O espelho passou a guardar TAMBÉM as notas de máquina — as nossas e as da
 * automação do Kommo —, para o histórico do card parar de aparecer com buracos.
 * Elas não podem entrar aqui: a ficha que a análise escreveu voltaria como "o
 * que o card diz", e o sistema confirmaria a si mesmo. Já aconteceu.
 */
const notasDeGente = (lead: KommoLead): KommoNota[] =>
  (lead.notas ?? []).filter((n) => !n.automatica)

function lerCardCredijuris(lead: KommoLead) {
  // O CADASTRO É LIDO NUM LUGAR SÓ — _shared/cadastroDoCard.ts —, desde
  // 28/09/2026. O conector passou a gravar a planilha jurídica que o Claude
  // entrega, e precisa exatamente destes campos: a verba cedida, o número, o
  // cedente e o originador que nomeiam a pasta do Drive. Duas leituras, uma na
  // tela e outra no servidor, divergiriam na primeira vírgula. As regras de
  // cada campo (título primeiro para o número, anotação primeiro para o resto,
  // só notas de gente) estão comentadas lá.
  const cadastro = lerCadastroDoCard(lead)
  const tipo = cadastro.tipo

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
  // POR `ehFunilPrecatorio`, e não por igualdade com um id: o precatório vive
  // em mais de um funil desde que as trilhas foram separadas, e comparar com um
  // número só faria o card do funil novo ser analisado como RPV — com a
  // categoria errada, a pasta errada no Drive e nenhum sinal na tela.
  const ehPrecatorio = ehFunilPrecatorio(lead.pipeline_id)
  const categoria = ehPrecatorio ? 'Precatórios' : 'Requisições de Pequeno Valor'
  const divergenciaTipo =
    tipo && /precat/i.test(tipo) !== ehPrecatorio
      ? `O card está no funil de ${ehPrecatorio ? 'Precatórios' : 'RPV'}, ` +
        `mas a anotação diz "TIPO: ${tipo.trim()}". Analisei como ${categoria} ` +
        `(o funil manda). Se estiver errado, mova o card no Kommo.`
      : null

  return {
    numero: cadastro.numero,
    categoria,
    cedente: cadastro.cedente,
    intermediador: cadastro.intermediador,
    tipo_aquisicao: cadastro.tipo_aquisicao,
    honorarios_pct: cadastro.honorarios_pct,
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
// Nenhuma dessas linhas é conteúdo do processo, então saem da conta — pela
// função semRodapeDeAssinatura (lib/textoDoProcesso), que tira o carimbo e NÃO
// a página: a versão que vivia aqui casava a linha inteira, e cada página é uma
// linha só.

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
  const pdfjsLib = await carregarPdfjs()
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

/**
 * COMO VAI O PREPARO DOS AUTOS de um card, para o Claude vir buscá-los.
 *
 * ISTO NÃO É DIAGNÓSTICO, É A METADE QUE FALTAVA DO FLUXO. Quem clica em
 * "Executar análise" sai da plataforma no mesmo instante — o aplicativo do
 * Claude toma a frente da tela —, e a única notícia que existia do depósito era
 * um aviso passageiro que ninguém chega a ver. Quando ele falhava, a conversa
 * ficava do outro lado chamando o conector em vão, e aqui não sobrava rastro
 * nenhum do motivo.
 *
 * Então o estado FICA no card: enquanto lê, quando fica pronto, e sobretudo o
 * que deu errado, com a mensagem inteira que a função respondeu.
 */
export interface PreparoDosAutos {
  /**
   * 'parcial' É O ESTADO QUE FALTAVA, e a falta dele escondeu um defeito caro.
   *
   * Entre "deu certo" e "deu errado" existe "chegou incompleto": um anexo que
   * não é PDF, um processo grande demais que veio cortado pelo meio. Sem um
   * estado próprio, isso saía como sucesso — a tela dizia "3 arquivo(s) à
   * disposição" contando os LIDOS, e ninguém ficava sabendo que o Claude
   * recebeu dois, um deles pela metade.
   */
  /**
   * 'fila' desde 27/09/2026: a leitura virou fila, e um card clicado depois de
   * outros espera a sua vez — com a conversa do Claude já aberta, esperando
   * junto. Sem estado próprio, ele apareceria como 'lendo' sem estar.
   */
  estado: 'fila' | 'lendo' | 'pronto' | 'parcial' | 'falhou'
  detalhe: string
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
  /**
   * O anexo é IMAGEM (foto, print), e não PDF: o arquivo, já baixado. Continua
   * com o `erro` de "não é PDF" para quem só lê PDF; a análise pelo conector o
   * sobe como imagem (ver `subirAnexosDeImagem`).
   *
   * BAIXADO NA LEITURA, e não na hora de subir: o link do Kommo vence, e a
   * leitura fica guardada no cache da página por muito mais tempo que ele.
   */
  anexoDeImagem?: Blob
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
async function lerArquivosDoCard(
  lead: KommoLead,
  /**
   * Avisa a cada arquivo lido. Existe para a FILA das análises externas: o
   * conector diz ao Claude "7 de 15 arquivos" enquanto espera, e é o número que
   * o faz esperar em vez de desistir.
   */
  aoProgresso?: (feitos: number, total: number, nome: string) => void,
): Promise<ArquivoLido[]> {
  const bk = await invokeFunction<{
    pronto?: boolean
    download_url?: string
    erro?: string
    nome_arquivo?: string
    arquivos?: { nome: string; download: string; mime?: string }[]
    nao_pdf?: string[]
    imagens?: { nome: string; download: string; mime?: string }[]
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
    aoProgresso?.(lidos.length, lista.length, a.nome)
    try {
      const { texto, paginas, paginasTexto, bytes } = await extrairTextoDoPdf(a.download)
      const limpo = texto.trim()
      const conteudo = semRodapeDeAssinatura(limpo)
      const densidade = paginas > 0 ? Math.round(conteudo.length / paginas) : 0
      const paginasImagem = paginasTexto
        .map((t, i) => (semRodapeDeAssinatura(t).length < CONTEUDO_MINIMO_PAGINA ? i + 1 : 0))
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
  const imagensDoCard = new Map((bk.imagens ?? []).map((i) => [i.nome, i]))
  for (const nome of bk.nao_pdf ?? []) {
    const img = imagensDoCard.get(nome)
    let anexoDeImagem: Blob | undefined
    if (img) {
      try {
        const resp = await fetch(img.download)
        if (resp.ok) anexoDeImagem = await resp.blob()
      } catch {
        /* sem a imagem, o anexo segue como hoje: nomeado, e "não é PDF" */
      }
    }
    lidos.push({
      nome,
      texto: '',
      paginas: 0,
      densidade: 0,
      digitalizado: false,
      erro: 'Não é PDF — não consigo ler por aqui.',
      ...(anexoDeImagem ? { anexoDeImagem } : {}),
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
// O veredito mora em _shared/anotacaoKommo.ts: o conector também escreve esta nota.

// Escreve o resultado da análise no card do Kommo. Os TEXTOS moram em
// lib/anotacaoKommo.ts — é o único pedaço da análise que o comercial lê, então
// o formato é regra de negócio e fica onde dá para testar.
async function anotarResultadoNaKommo(
  leadId: number,
  r: ResultadoAnalise,
  analista: string,
  /** A primeira linha do veredito. Omitido = aprovado na análise automática. */
  veredito?: string,
): Promise<string[]> {
  const falhas: string[] = []
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
    } catch (e) {
      // DEVOLVE, EM VEZ DE ENGOLIR. Falhar aqui não derruba o resultado que já
      // está na tela — mas token do Kommo expirado ou 5xx do CRM deixava as
      // DUAS notas no chão em silêncio: a janela dizia "salvo" e o comercial
      // nunca via a ficha nem o link do Drive. É uma das duas únicas saídas
      // persistidas da análise, e a única que ele lê.
      falhas.push((e as Error)?.message ?? String(e))
    }
  }
  return falhas
}

/** Ícone por destino — dá para reconhecer a ação sem ler o rótulo. */
// PELO PAPEL, e não pelo status_id: as mesmas colunas têm ids diferentes em
// cada funil, e um mapa por id deixaria os botões do Precatório sem ícone.
const ICONES: Record<PapelDaTela, ReactNode> = {
  validar: <ArrowRight className="h-[16px] w-[16px]" aria-hidden />,
  aprovar: <Check className="h-[16px] w-[16px]" aria-hidden />,
  diligenciar: <FileSearch className="h-[16px] w-[16px]" aria-hidden />,
  reprovar: <X className="h-[16px] w-[16px]" aria-hidden />,
  // O "FECHADO!" DA NEGOCIAÇÃO (onda 4): o aperto de mão da amostra — o cedente
  // aceitou, e isso não é a aprovação do crédito.
  fechar: <Handshake className="h-[16px] w-[16px]" aria-hidden />,
}

/**
 * O selo que diz de quem é a nota — vazio para a do comercial, que é a regra.
 *
 * O HISTÓRICO MOSTRA TUDO desde 17/09/2026. Antes o espelho só trazia nota
 * `common` escrita por gente, e o card aparecia com anotações esparsas: faltavam
 * a movimentação (quem moveu e por quê), o anexo e a anotação da própria
 * análise. Trazer tudo sem dizer o que é cada coisa seria o defeito oposto —
 * uma ficha redigida pela IA lida como declaração de quem cadastrou o card.
 */
function rotuloDaNota(n: KommoNota): string {
  if (n.tipo === 'attachment') return 'anexo'
  if (n.tipo && n.tipo !== 'common') return 'movimentação'
  return n.automatica ? 'nota da plataforma' : ''
}

/** Link para o card no Kommo — o operacional às vezes precisa do original. */
function urlCard(leadId: number): string {
  return `https://${KOMMO_SUBDOMINIO}.kommo.com/leads/detail/${leadId}`
}

function tituloCard(lead: KommoLead): string {
  return lead.nome?.trim() || `Card ${lead.kommo_lead_id}`
}

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
/**
 * O MOTIVO É EXIGIDO ONDE A DECISÃO INTERROMPE o caminho do crédito.
 *
 * Diligência e reprovação mandam o card para trás ou para fora, e quem o recebe
 * não tem a análise à frente: sem a razão escrita, a movimentação sozinha não
 * diz nada. Aprovar segue o fluxo esperado e dispensa.
 */
const exigeMotivoDe = (acao: AcaoTela): boolean =>
  acao.papel === 'diligenciar' || acao.papel === 'reprovar'

/**
 * OS BOTÕES DO CARD NA MEDIDA DA AMOSTRA: 32 px de altura e 12 px de folga
 * lateral (`.btn`). O `size="sm"` do Button tem 27 px — pequeno para o alvo
 * principal da linha, que é o que a mão procura dezenas de vezes por dia.
 */
const BTN = 'h-[32px] px-4'
/** O ícone de 16 px dos botões e caixas da amostra (`h-4` vale 12 px aqui). */
const IC = 'h-[16px] w-[16px] flex-none'
/** O "Excluir" contornado da amostra (`.btn-danger-outline`): o negativo sem gritar. */
const PERIGO_CONTORNADO = 'border-perigo-borda bg-superficie text-perigo hover:bg-perigo-fundo'
/**
 * A AÇÃO DA ETAPA NO CARD: SECUNDÁRIO EM AZUL, e não primário cheio (auditoria
 * visual de 03/10/2026, A3/AP2, aprovado pelo dono). Com um primário por card,
 * a lista tinha dez botões azuis cheios na tela, e o primário deixava de dizer
 * "o principal". O contorno com ícone e texto no azul da marca ainda separa a
 * ação que avança das outras; o primário cheio fica só dentro das janelas.
 */
const ACAO_DA_ETAPA = 'text-marca-texto hover:bg-marca-leve hover:text-marca-texto'

/**
 * Fecha uma caixa flutuante ao clicar fora e no Esc.
 *
 * Sem isto, a lista de trinta cards ficaria com um painel aberto atrás do outro
 * conforme a pessoa fosse clicando. Era o mesmo efeito copiado em quatro caixas
 * (anotação, etiquetas, proposta); juntou aqui sem mudar o que ele faz.
 */
let caixasAbertas = 0

function useFecharFora(aberto: boolean, fechar: () => void, caixa: RefObject<HTMLElement | null>) {
  // O BOTÃO DO ASSISTENTE SAI DA FRENTE enquanto uma caixa do card está aberta
  // (05/10/2026): perto do pé da tela ele cobria o "Enviar" da anotação. A caixa
  // mora dentro da página, e a página não sobe acima do botão flutuante — então
  // quem cede é o botão (ver `data-caixa-aberta` em Assistente.tsx).
  useEffect(() => {
    if (!aberto) return
    caixasAbertas += 1
    document.body.dataset.caixaAberta = ''
    return () => {
      caixasAbertas -= 1
      if (caixasAbertas <= 0) {
        caixasAbertas = 0
        delete document.body.dataset.caixaAberta
      }
    }
  }, [aberto])
  useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent) => {
      if (!caixa.current?.contains(e.target as Node)) fechar()
    }
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') fechar()
    }
    document.addEventListener('mousedown', fora)
    document.addEventListener('keydown', tecla)
    return () => {
      document.removeEventListener('mousedown', fora)
      document.removeEventListener('keydown', tecla)
    }
  }, [aberto, fechar, caixa])
}

/**
 * A caixa flutuante da amostra (`.pop`): borda, sombra de menu, cantos de 12 px.
 * A MESMA DO `MenuDeAcoes` (revisão visual 2): `rounded-flutuante` (era o
 * `rounded-campo`, de 10 px) e, no escuro, o anel claro que a separa da página.
 * Quem a usa mede com `useCaixaNaTela` e aplica `posicaoDaCaixa`.
 */
const CAIXA_FLUTUANTE =
  'absolute z-20 rounded-flutuante border border-borda bg-superficie p-s1.5 text-left shadow-nivel-2 dark:ring-1 dark:ring-white/[0.06]'

/** Embaixo do botão (o natural) ou, sem lugar embaixo, em cima dele. */
const posicaoDaCaixa = (a: AjusteDaCaixa) => (a.acima ? 'bottom-full mb-s1' : 'top-full mt-s1')
/** O deslocamento lateral que faz a caixa caber na tela (celular). */
const deslocamentoDaCaixa = (a: AjusteDaCaixa) => (a.dx ? { transform: `translateX(${a.dx}px)` } : undefined)

/**
 * A PLANILHA QUE NASCE DA CONVERSA: colar o bloco que o Claude entregou.
 *
 * EXISTE PORQUE A PLANILHA PERDIA O CONTEXTO (28/09/2026). O motor antigo
 * preenchia a análise jurídica lendo os autos de novo, com outro modelo, longe
 * da conversa em que a qualificação era feita — e as duas podiam discordar.
 * Agora o conector entrega o questionário à conversa, o Claude o responde com
 * a leitura que acabou de fazer, e o bloco que ele devolve vem para cá.
 *
 * COLAR, E NÃO O CONECTOR GRAVAR SOZINHO: uma ferramenta de gravação no
 * conector pediria reconectá-lo e, conforme a organização, o administrador.
 * Colar funciona hoje. A gravação é a mesma nos dois caminhos.
 *
 * O MOTOR ANTIGO SOBREVIVE num link discreto, para o card cuja conversa não
 * trouxe o bloco — com o aviso do que ele é: outra leitura, sem o contexto.
 */
function JanelaDaPlanilha({
  lead,
  onFechar,
  onPreencher,
  onMotorAntigo,
}: {
  lead: KommoLead
  onFechar: () => void
  onPreencher: (colado: string) => Promise<void>
  onMotorAntigo: () => void
}) {
  const [colado, setColado] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  return (
    <Modal
      open
      // GRAVANDO, NÃO FECHA: o erro da gravação precisa de onde aparecer, com o
      // bloco colado ainda no campo para tentar de novo.
      onClose={enviando ? () => undefined : onFechar}
      title="Preencher planilha"
      description={tituloCard(lead)}
      size="lg"
      dirty={colado.trim() !== ''}
      footer={
        // O LINK DE RESERVA À ESQUERDA E A AÇÃO À DIREITA, como na amostra: o
        // motor antigo é exceção, e não pode disputar o lugar do botão principal.
        <div className="flex w-full flex-wrap items-center gap-2">
          <button
            type="button"
            className="-ml-2 inline-flex h-[28px] items-center rounded-controle px-2 text-sm font-semibold text-marca-texto hover:bg-marca-leve"
            onClick={() => {
              onMotorAntigo()
              onFechar()
            }}
            title="Lê os autos de novo, com outro modelo, sem o contexto da conversa com o Claude"
          >
            Não tenho o bloco — usar a análise jurídica antiga
          </button>
          <span className="flex-1" />
          <Button
            className={BTN}
            onClick={async () => {
              setErro(null)
              setEnviando(true)
              try {
                await onPreencher(colado)
                onFechar()
              } catch (e) {
                setErro((e as Error)?.message ?? String(e))
              } finally {
                setEnviando(false)
              }
            }}
            loading={enviando}
            disabled={!colado.trim() || enviando}
          >
            Preencher planilha
          </Button>
        </div>
      }
    >
      <p className="mb-3 text-corpo text-texto-2">
        Ao final da análise, o Claude entrega um bloco de código com as respostas da planilha.
        Copie <strong className="text-texto">esse bloco</strong> pelo botão de copiar dele e cole aqui:
        a plataforma preenche o modelo da casa, salva na pasta do cedente no Drive e anota no card.
      </p>
      <Textarea
        rows={10}
        value={colado}
        onChange={(e) => setColado(e.target.value)}
        placeholder={'```json\n{ "respostas": [ { "linha": 4, "resposta": "…" } ], … }\n```'}
        className="font-mono text-sm leading-relaxed"
        spellCheck={false}
        aria-label="Bloco da planilha entregue pelo Claude"
      />
      {erro && (
        <CaixaDeAviso tom="perigo" role="alert" className="mt-3">
          {erro}
        </CaixaDeAviso>
      )}
    </Modal>
  )
}

function JanelaDeMensagem({
  lead,
  acoes,
  titulo,
  sugestao,
  resumo = null,
  ocupado,
  jaMovido,
  onConfirmar,
  onFechar,
}: {
  lead: KommoLead
  /**
   * As saídas oferecidas nesta janela.
   *
   * UMA, quase sempre: o botão do card já disse para onde vai, e aqui só se
   * escreve o porquê. VÁRIAS nas etapas de decisão do precatório, onde quem
   * conclui escolhe entre aprovar, pedir o memorando, mandar diligenciar e
   * recusar — com a razão no mesmo campo, escrita uma vez.
   */
  acoes: AcaoTela[]
  titulo: string
  sugestao: string
  /**
   * O RESUMO DA OPORTUNIDADE NUMA CAIXA À PARTE, editável (o Concluir da Revisão
   * do RPV, onda 4): o texto inicial da caixa, ou null para a janela sem caixa —
   * a de sempre. Com a caixa, a nota do APROVAR é o resumo como ficou nela mais a
   * mensagem; nas outras saídas, só a mensagem (ver `montarNotaDoDesfecho`).
   */
  resumo?: string | null
  ocupado: boolean
  /**
   * O card JÁ se moveu para esta saída nesta janela? Depois de uma falha da nota
   * com o card movido, só a MESMA saída continua na mão — e ela só anota. Outra
   * saída moveria o card de novo, para outra coluna. Indefinido: nada trava.
   */
  jaMovido?: (statusId: number) => boolean
  onConfirmar: (acao: AcaoTela, mensagem: string) => Promise<void>
  onFechar: () => void
}) {
  const comResumo = resumo !== null
  // O RASCUNHO DESTA JANELA (ver rascunhoDoCard.ts): pelo card E pelas saídas —
  // o motivo escrito para reprovar não reaparece na janela de aprovar.
  const leadId = lead.kommo_lead_id
  const saidas = acoes.map((a) => a.statusId).join('-')
  const lugarDaMensagem = `mensagem.${saidas}`
  const lugarDoResumo = `resumo.${saidas}`
  const [recuperado, setRecuperado] = useState(() => {
    const m = rascunhoGuardado(leadId, lugarDaMensagem)
    const r = comResumo ? rascunhoGuardado(leadId, lugarDoResumo) : null
    return { mensagem: m, resumo: r, maisNovo: [m, r].reduce<Rascunho | null>((a, x) => (x && (!a || x.em > a.em) ? x : a), null) }
  })
  const [mensagem, setMensagem] = useState(recuperado.mensagem?.texto ?? sugestao)
  const [textoDoResumo, setTextoDoResumo] = useState(recuperado.resumo?.texto ?? resumo ?? '')
  // GUARDADO SÓ O QUE DIFERE DO SUGERIDO: o texto que a tela mesma preencheu não
  // é rascunho de ninguém.
  const mudarMensagem = (v: string) => {
    setMensagem(v)
    if (v.trim() === sugestao.trim()) apagarRascunho(leadId, lugarDaMensagem)
    else guardarRascunho(leadId, lugarDaMensagem, v)
  }
  const mudarResumo = (v: string) => {
    setTextoDoResumo(v)
    if (v.trim() === (resumo ?? '').trim()) apagarRascunho(leadId, lugarDoResumo)
    else guardarRascunho(leadId, lugarDoResumo, v)
  }
  const esquecerRascunho = () => {
    apagarRascunho(leadId, lugarDaMensagem)
    apagarRascunho(leadId, lugarDoResumo)
  }
  /** "Descartar rascunho": os campos voltam ao que a janela sugere ao abrir. */
  const descartarRascunho = () => {
    esquecerRascunho()
    setMensagem(sugestao)
    setTextoDoResumo(resumo ?? '')
    setRecuperado({ mensagem: null, resumo: null, maisNovo: null })
  }
  /** Fechar descartando (já perguntado, ou nada a perder): o rascunho vai junto. */
  const fecharDescartando = () => {
    esquecerRascunho()
    onFechar()
  }
  const [erro, setErro] = useState<string | null>(null)
  /** Qual saída está em curso — as outras ficam travadas enquanto isso. */
  const [emCurso, setEmCurso] = useState<number | null>(null)
  const exigeMotivo = acoes.some(exigeMotivoDe)
  // APROVAR SEM RESUMO É UM CARD SEM ANÁLISE SALVA.
  //
  // O resumo da oportunidade é gravado no card pelo 'salvar' da análise. Sem
  // ele, a janela de Aprovar abria com o campo VAZIO e o placeholder "Opcional",
  // e o Confirmar liberado: o card subia para Proposta sem uma linha sobre o que
  // se está comprando — que é justamente o que quem recebe precisa ler.
  //
  // SÓ ONDE HÁ ANÁLISE INTERNA PARA RESUMIR. No precatório externo a análise
  // acontece fora da plataforma, numa conversa com o Claude, e o card nunca vai
  // ter `oportunidade` gravada — exigi-la ali travaria a aprovação para sempre.
  // Lá o que faz as vezes do resumo é o texto que a pessoa escreve nesta janela.
  const semResumoDe = (acao: AcaoTela): boolean =>
    acao.papel === 'aprovar' &&
    !lead.oportunidade &&
    !ehFunilPrecatorio(lead.pipeline_id)
  // `ocupado` é o `isPending` da MOVIMENTAÇÃO, e ela é só a primeira metade: a
  // nota vem depois, noutra requisição. Nessa fresta o Confirmar voltava a
  // ficar habilitado e sem spinner, e um segundo clique disparava tudo de novo.
  const [enviando, setEnviando] = useState(false)
  const trabalhando = ocupado || enviando
  const semTexto = mensagem.trim().length < 10
  /** A nota que esta saída deixa no card — o resumo só entra ao aprovar. */
  const notaDe = (acao: AcaoTela) =>
    montarNotaDoDesfecho({ papel: acao.papel, mensagem, resumo: comResumo ? textoDoResumo : null })
  // MOVEU E A NOTA NÃO SUBIU: a saída que já moveu o card nesta janela. Só ela
  // continua na mão (e só anota, com texto); as outras moveriam o card de novo.
  const movida = erro ? acoes.find((a) => jaMovido?.(a.statusId)) : undefined
  const podeEnviar = (acao: AcaoTela) => {
    if (trabalhando) return false
    if (movida) return acao.statusId === movida.statusId && notaDe(acao) !== ''
    // COM A CAIXA DO RESUMO, aprovar sem resumo gravado pede o resumo escrito à
    // mão NA CAIXA DELE, com a mesma régua — e não na mensagem.
    if (comResumo && semResumoDe(acao)) return textoDoResumo.trim().length >= 10
    return !(exigeMotivoDe(acao) || semResumoDe(acao)) || !semTexto
  }
  const semResumo = acoes.some(semResumoDe)
  const varias = acoes.length > 1
  const sujo = mensagem.trim() !== sugestao.trim() || (comResumo && textoDoResumo.trim() !== (resumo ?? '').trim())

  const cancelar = async () => {
    // A MESMA CHECAGEM DO X, DO OVERLAY E DO ESC. O `dirty` do Modal só
    // protege aquelas três portas; este botão chamava `onFechar` direto e
    // descartava o texto digitado sem perguntar — e é o botão que está mais
    // perto do cursor de quem acabou de escrever.
    if (sujo && !(await perguntarDescarte())) return
    fecharDescartando()
  }

  return (
    <Modal
      open
      // NÃO FECHA COM A MOVIMENTAÇÃO NO AR (o X, o Esc, o fundo). Fechando, a
      // memória de "já movido" era apagada antes de o movimento terminar e
      // gravada depois — e o próximo movimento do card para esta coluna, na
      // sessão, seria pulado; e a falha da nota caía numa janela que não existia.
      onClose={trabalhando ? () => undefined : fecharDescartando}
      title={titulo}
      // O CARD EMBAIXO, e não colado no título: são duas informações de peso
      // diferente — o que se vai fazer, e sobre qual crédito. Juntas numa linha
      // só passavam de oitenta caracteres e quebravam o título em duas.
      description={tituloCard(lead)}
      size="lg"
      dirty={sujo}
      footer={
        // O QUE NÃO DECIDE À ESQUERDA, AS DECISÕES À DIREITA (amostra): com uma
        // saída, "Cancelar" e "Confirmar"; com várias, "cancelar" discreto e um
        // botão por saída — o negativo contornado, para não disputar com o
        // positivo.
        <div className="flex w-full flex-wrap items-center gap-2">
          {varias ? (
            <button
              type="button"
              onClick={cancelar}
              disabled={trabalhando}
              className="-ml-2 inline-flex h-[28px] items-center rounded-controle px-2 text-sm font-semibold text-marca-texto hover:bg-marca-leve disabled:opacity-50"
            >
              cancelar
            </button>
          ) : (
            <Button variant="ghost" className={BTN} onClick={cancelar} disabled={trabalhando}>
              Cancelar
            </Button>
          )}
          <span className="flex-1" />
          {acoes.map((acao) => (
            <Button
              key={acao.statusId}
              variant={acao.variant === 'danger' && varias ? 'outline' : acao.variant}
              className={cn(BTN, acao.variant === 'danger' && varias && PERIGO_CONTORNADO)}
              onClick={async () => {
                setErro(null)
                setEnviando(true)
                setEmCurso(acao.statusId)
                try {
                  await onConfirmar(acao, notaDe(acao))
                  // ENVIADO, O RASCUNHO SAI. Com falha (inclusive a da nota com o
                  // card já movido), ele fica — o texto ainda não chegou ao card.
                  esquecerRascunho()
                } catch (e) {
                  setErro((e as Error)?.message ?? String(e))
                } finally {
                  setEnviando(false)
                  setEmCurso(null)
                }
              }}
              disabled={!podeEnviar(acao)}
              // O SPINNER NO BOTÃO CLICADO, e não em todos: com `trabalhando`
              // solto, os demais pareceriam estar enviando também.
              loading={emCurso === acao.statusId || (acoes.length === 1 && trabalhando)}
            >
              {/* COM UMA SAÍDA SÓ, "Confirmar": o botão do card já disse o que
                  vai acontecer, e repetir o rótulo aqui é redundância. Com
                  várias, cada uma precisa dizer para onde leva. */}
              {varias ? acao.label : 'Confirmar'}
            </Button>
          ))}
        </div>
      }
    >
      {recuperado.maisNovo && <AvisoDoRascunho rascunho={recuperado.maisNovo} onDescartar={descartarRascunho} />}
      {semResumo && (
        <CaixaDeAviso tom="aviso" className="mb-3">
          {comResumo
            ? 'Este card não tem resumo da oportunidade gravado — a análise não foi salva por esta versão do sistema. Abra a análise e salve, ou, para aprovar, escreva o resumo à mão aqui: é o que a proposta vai ler.'
            : 'Este card não tem resumo da oportunidade gravado — a análise não foi salva por esta versão do sistema. Abra a análise e salve, ou escreva o resumo à mão aqui: é o que a proposta vai ler.'}
        </CaixaDeAviso>
      )}
      {/* O RESUMO DA OPORTUNIDADE NUMA CAIXA À PARTE (Revisão do RPV, onda 4):
          editável — a linha da cessão sai "a confirmar" do motor, e quem aprova
          é quem sabe completá-la —, e só entra na nota se a saída for aprovar.
          Assim ele nunca vira, por engano, a razão de uma reprovação. */}
      {comResumo && (
        // ABERTA TAMBÉM COM O RESUMO RECUPERADO DO RASCUNHO: fechada, a mudança
        // feita antes passaria sem ser vista e iria para o card na aprovação.
        <details className="mb-3 rounded-campo border border-borda bg-superficie-2" open={semResumo || Boolean(recuperado.resumo)}>
          <summary className="flex min-h-[36px] cursor-pointer items-center gap-2 px-4 py-2 text-corpo font-semibold text-texto">
            <FileText className={IC} aria-hidden />
            Resumo da oportunidade
            <span className="text-sm font-normal text-texto-3">— editável · vai para o card junto com a aprovação</span>
          </summary>
          <div className="border-t border-borda px-4 pb-3 pt-3">
            <textarea
              className="min-h-[132px] w-full resize-y rounded-campo border border-borda-controle bg-superficie px-4 py-[10px] font-mono text-sm leading-relaxed text-texto placeholder:font-sans placeholder:text-texto-3 focus:border-anel focus:outline-none focus:ring-[3px] focus:ring-anel/20 disabled:bg-superficie-3 disabled:text-texto-2"
              rows={textoDoResumo ? 11 : 6}
              value={textoDoResumo}
              disabled={trabalhando}
              aria-label="Resumo da oportunidade"
              placeholder="O que se está comprando: cedente, processo, ente devedor, objeto, valor líquido validado e prazo — é o que a proposta vai ler."
              onChange={(e) => mudarResumo(e.target.value)}
            />
            <p className="mt-1 text-sm text-texto-3">
              Complete o que o motor deixou "a confirmar" (a extensão da cessão, por exemplo). Nas outras
              saídas ele não vai para o card.
            </p>
            {semResumo && textoDoResumo.trim().length > 0 && textoDoResumo.trim().length < 10 && (
              <DicaDeAviso>Escreva o resumo por extenso — é o que a proposta vai ler.</DicaDeAviso>
            )}
          </div>
        </details>
      )}
      <textarea
        className="min-h-[220px] w-full resize-y rounded-campo border border-borda-controle bg-superficie px-4 py-[10px] font-mono text-sm leading-relaxed text-texto placeholder:font-sans placeholder:text-texto-3 focus:border-anel focus:outline-none focus:ring-[3px] focus:ring-anel/20 disabled:bg-superficie-3 disabled:text-texto-2"
        value={mensagem}
        disabled={trabalhando}
        aria-label="Mensagem"
        placeholder={
          exigeMotivo
            ? 'Por que o card está sendo movido. Quem lê não tem a análise à mão.'
            : 'Opcional — o que o próximo a pegar este card precisa saber.'
        }
        onChange={(e) => mudarMensagem(e.target.value)}
      />
      {exigeMotivo && mensagem.trim().length > 0 && mensagem.trim().length < 10 && (
        <DicaDeAviso>Escreva a razão por extenso — ela fica no card como registro da decisão.</DicaDeAviso>
      )}
      {erro && (
        <CaixaDeAviso tom="perigo" role="alert" className="mt-3">
          {erro}
        </CaixaDeAviso>
      )}
    </Modal>
  )
}

/**
 * "RASCUNHO RECUPERADO": o texto que voltou ao campo diz de onde veio — sem
 * isto, um motivo escrito há dias se leria como sugestão da tela. O
 * "Descartar rascunho" volta o campo ao que a janela sugere ao abrir.
 */
function AvisoDoRascunho({ rascunho, onDescartar }: { rascunho: Rascunho; onDescartar: () => void }) {
  return (
    <p className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-texto-3" role="status">
      <History className="h-[14px] w-[14px] flex-none" aria-hidden />
      <span>Rascunho recuperado — escrito em {formatDateTime(new Date(rascunho.em).toISOString())} e não enviado.</span>
      <button
        type="button"
        onClick={onDescartar}
        className="inline-flex h-[24px] items-center rounded-controle px-1.5 text-sm font-semibold text-marca-texto hover:bg-marca-leve"
      >
        Descartar rascunho
      </button>
    </p>
  )
}

/**
 * A aba em que o desfecho se decide DENTRO da janela da análise.
 *
 * Na Análise o trabalho é ler a análise e decidir, e as duas coisas passaram
 * a acontecer no mesmo lugar. Na Revisão não: ali a análise já foi feita e
 * salva, quem revisa lê a anotação e a planilha, e obrigá-lo a abrir a janela
 * custaria dois minutos de releitura do processo para mover um card.
 */
const ABA_RPV_DESFECHO_NA_JANELA = 'pendentes'

/**
 * Os avisos de cadastro do card — e isso é defeito, não ausência.
 *
 * A FALTA DO NÚMERO não é um campo vazio a mais: sem ele o card fica fora da
 * busca por processo e o checklist de certidões não acha o CNJ. Nenhuma outra
 * etapa destas abas checa isso.
 *
 * A DISCORDÂNCIA DE TIPO DISCORDA EM VOZ ALTA: card no funil de RPV com "TIPO:
 * Precatório" na anotação era analisado como RPV, em silêncio — prazo de meses
 * num crédito que a Fazenda paga em anos.
 *
 * NA LINHA DO TÍTULO desde a onda 2, como selos (amostra): é estado do card, e
 * é lido junto com o nome, na varredura de cima para baixo.
 */
function SelosDoCadastro({ d }: { d: ReturnType<typeof lerCardCredijuris> }) {
  return (
    <>
      {!d.numero && (
        <Selo
          tom="aviso"
          icone={<AlertTriangle className={icSelo} aria-hidden />}
          title="Sem número, o card fica fora da busca por processo e o checklist de certidões não acha o CNJ."
        >
          sem número de processo no card
        </Selo>
      )}
      {d.divergenciaTipo && (
        <Selo tom="aviso" icone={<AlertTriangle className={icSelo} aria-hidden />} title={d.divergenciaTipo}>
          funil e anotação discordam do tipo
        </Selo>
      )}
    </>
  )
}

/**
 * AS DUAS DATAS DO CARD, no rodapé: desde quando ele está NESTA coluna e desde
 * quando está na esteira.
 *
 * A PERGUNTA QUE A DE CIMA RESPONDE é há quanto tempo o crédito está parado na
 * etapa — a que decide o que puxar primeiro numa coluna de trinta cards. A data
 * de criação não responde (card de março movido ontem) e a de atualização
 * também não (muda quando alguém troca uma tag). A de criação vem logo depois
 * (pedido de 29/09/2026): um card que chegou hoje à revisão pode estar no funil
 * há dois meses.
 *
 * A DATA COM HORA E O DECORRIDO, JUNTOS. A data sozinha obriga a fazer a conta
 * de cabeça; o "há 3 dias" sozinho apaga o instante exato, que é o que se copia
 * para uma cobrança.
 *
 * SEM DATA, NADA — nem traço, nem "—". "ÚLT. MOV." e "CRIADO EM" NA FRENTE: as
 * duas têm o mesmo formato, e cada uma diz de que é.
 */
function DatasDoCard({ lead }: { lead: KommoLead }) {
  const etapa = dataDaEtapa(lead)
  const criado = lead.criado_em
  if (!etapa && !criado) return null
  const linha = (rotulo: string, quando: string, titulo: string) => {
    const decorrido = tempoDecorrido(quando)
    return (
      // A QUEBRA SÓ PODE CAIR ENTRE AS DUAS METADES: cada uma é `nowrap`, o
      // conjunto não.
      <span title={titulo}>
        <span className="whitespace-nowrap">
          {rotulo} {formatDateTime(quando)}
        </span>
        {decorrido && <span className="whitespace-nowrap"> · {decorrido}</span>}
      </span>
    )
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs text-texto-3">
      {etapa && linha('Últ. mov. em', etapa, 'Última movimentação: quando o card entrou na coluna em que está')}
      {criado && linha('Criado em', criado, 'Quando o card foi criado no Kommo')}
    </span>
  )
}

/** "há 3 dias", discreto, com a data e a hora exatas no passar do mouse. */
function DesdeQuando({ quando }: { quando: string | null }) {
  if (!quando) return <span />
  const decorrido = tempoDecorrido(quando)
  return (
    <span className="whitespace-nowrap text-right text-xs text-texto-3" title={`Desde ${formatDateTime(quando)}`}>
      {decorrido}
    </span>
  )
}

/**
 * O SELETOR DE ETIQUETAS: marcar e desmarcar, no card, as etiquetas da casa.
 *
 * UMA POR CLIQUE, E SÓ ELA. A API do Kommo tem dois caminhos para etiquetar, e
 * o óbvio — mandar `_embedded.tags` — SUBSTITUI a lista inteira do card: quem
 * acrescentasse uma etiqueta sem devolver as outras apagaria as do comercial.
 * Este seletor usa o outro, incremental (`tags_to_add`/`tags_to_delete`), e é
 * por isso que ele pode existir dentro de uma lista de trinta cards sem risco:
 * o que não foi clicado não é tocado. Ver a Edge Function `kommo-etiquetar`.
 *
 * SÓ AS DA CASA. A lista é fechada (ver `etiquetasDaAba`) porque o Kommo CRIA a
 * etiqueta ao receber um nome desconhecido — e depois não a renomeia nem a
 * apaga, nem pela API nem pelo painel. Etiqueta que o card já tenha e não esteja
 * na lista continua aparecendo no card, fora do alcance daqui: ela é de quem a
 * pôs.
 *
 * UMA OU NENHUMA POR FUNDO, e é o que a grade desenha: uma linha por fundo, uma
 * coluna por ato (Enviado, Cotado, Reprovado — o BTG só os dois últimos), e em
 * cada linha no máximo um círculo marcado. Marcar "Reprovado BTG" tira "Cotado
 * BTG", porque o crédito está num dos dois e não nos dois. Entre fundos não há
 * exclusão nenhuma. A troca vai num PATCH só, do lado do servidor.
 *
 * A GRADE COM CABEÇALHO desde a onda 2 (amostra): o nome do ato no topo de cada
 * coluna, e na linha só o círculo — o olho corre a coluna "Cotado" de cima a
 * baixo. CLICAR NA MARCADA DESMARCA: é como se desfaz um clique errado.
 */
function SeletorDeEtiquetas({
  oferecidas,
  aplicadas,
  datas,
  emVoo,
  onAlternar,
  onEditarCotacao,
}: {
  oferecidas: readonly EtiquetaDoFundo[]
  /** As etiquetas que o card tem hoje — inclusive as de fora da lista. */
  aplicadas: readonly string[]
  /** Desde quando cada etiqueta está no card — o "há 3 dias" ao lado da marcada. */
  datas?: Record<string, string | null> | null
  /** A etiqueta DESTE card que está em voo, ou null. */
  emVoo: string | null
  onAlternar: (etiqueta: string, acao: 'adicionar' | 'remover') => void
  /**
   * Reabre a janela da cotação de um "Cotado" já marcado — o lápis ao lado do
   * fundo. Clicar no círculo marcado continua DESMARCANDO (e não apaga o campo).
   */
  onEditarCotacao?: (etiqueta: string) => void
}) {
  const [aberto, setAberto] = useState(false)
  const caixa = useRef<HTMLDivElement>(null)
  const flutuante = useRef<HTMLDivElement>(null)
  const fechar = useCallback(() => setAberto(false), [])
  useFecharFora(aberto, fechar, caixa)
  const ajuste = useCaixaNaTela(flutuante, aberto)

  // POR NOME NORMALIZADO, e não por igualdade: o que está no card veio do
  // Kommo, e caixa ou espaço a mais ali deixariam a etiqueta marcada aparecer
  // como desmarcada — e o clique seguinte mandaria acrescentar o que já existe.
  const temEtiqueta = (nome: string) => aplicadas.some((t) => mesmaEtiqueta(t, nome))

  return (
    <div className="relative" ref={caixa}>
      {/* SÓ O ÍCONE, num selo tracejado (amostra `.tag-edit`): é ferramenta, não
          informação — discreto ao lado das etiquetas, e o título o explica. */}
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        title="Aplicar ou remover as etiquetas dos fundos"
        aria-label="Aplicar ou remover as etiquetas dos fundos"
        aria-expanded={aberto}
        className={cn(
          'inline-flex h-[24px] items-center gap-s1 rounded-full border border-dashed px-s2 text-xs font-semibold transition-colors',
          aberto
            ? 'border-marca-viva text-marca-texto'
            : 'border-borda-forte text-texto-2 hover:border-marca-viva hover:text-marca-texto',
        )}
      >
        <Tag className="h-[14px] w-[14px]" aria-hidden />
      </button>

      {aberto && (
        <div
          ref={flutuante}
          className={cn(
            CAIXA_FLUTUANTE,
            posicaoDaCaixa(ajuste),
            'left-0 w-[460px] max-w-[calc(100vw-24px)] px-s3 py-s2',
          )}
          style={deslocamentoDaCaixa(ajuste)}
        >
          <p className="px-s1 pb-s2 pt-s1 text-xs font-bold uppercase tracking-[0.06em] text-texto-3">
            Etiquetas dos fundos · uma por fundo
          </p>
          {/* NO CELULAR, SEM A COLUNA "DESDE" (revisão visual 2): a grade de
              460px não cabia nos 351px da caixa, e o nome do fundo virava
              "P…". As colunas dos atos medem o próprio título, e o "há 3 dias"
              desce para baixo do nome. */}
          <div
            role="group"
            aria-label="Etiquetas dos fundos"
            className={cn(
              'grid grid-cols-[minmax(0,1fr)_repeat(3,auto)] items-center gap-x-s2 gap-y-s1.5 text-sm sm:grid-cols-[minmax(0,1.4fr)_repeat(3,64px)_72px] sm:gap-x-s1',
              emVoo !== null && 'opacity-70',
            )}
          >
            <span />
            {ATOS_DA_PRECIFICACAO.map((ato) => (
              <span key={ato} className="text-center text-xs font-bold uppercase tracking-[0.06em] text-texto-3">
                {ato}
              </span>
            ))}
            <span className="hidden text-right text-xs font-bold uppercase tracking-[0.06em] text-texto-3 sm:block">
              Desde
            </span>
            {etiquetasPorDestino(oferecidas).map((grupo) => {
              const marcada = grupo.etiquetas.find((e) => temEtiqueta(e.nome))
              return (
                <Fragment key={grupo.destino}>
                  {/* O FUNDO COM ETIQUETA fica em destaque: numa lista de sete, é
                      o que se procura primeiro. */}
                  <span className="min-w-0">
                  <span
                    className={cn(
                      'flex min-w-0 items-center gap-s1',
                      marcada ? 'font-bold text-texto' : 'font-medium text-texto-2',
                    )}
                  >
                    <span className="truncate" title={grupo.destino}>
                      {grupo.destino}
                    </span>
                    {/* O LÁPIS DA COTAÇÃO, só com "Cotado" marcado: reabre a
                        janela com o valor do card, e Enviar o sobrescreve. */}
                    {onEditarCotacao && marcada?.ato === 'Cotado' && (
                      <button
                        type="button"
                        disabled={emVoo !== null}
                        onClick={() => onEditarCotacao(marcada.nome)}
                        title={`Alterar a cotação (${grupo.destino})`}
                        aria-label={`Alterar a cotação de "${marcada.nome}"`}
                        className="grid h-[24px] w-[24px] shrink-0 place-items-center rounded-controle text-texto-3 transition-colors hover:bg-superficie-3 hover:text-marca-texto disabled:cursor-progress"
                      >
                        <Pencil className="h-[14px] w-[14px]" aria-hidden />
                      </button>
                    )}
                  </span>
                  {/* O "DESDE" DO CELULAR, embaixo do nome. */}
                  {marcada && desdeQuandoAEtiqueta(datas, marcada.nome) && (
                    <span className="block text-xs text-texto-3 sm:hidden">
                      {tempoDecorrido(desdeQuandoAEtiqueta(datas, marcada.nome)!)}
                    </span>
                  )}
                  </span>
                  {ATOS_DA_PRECIFICACAO.map((ato) => {
                    const e = grupo.etiquetas.find((x) => x.ato === ato)
                    // O ATO QUE O FUNDO NÃO TEM (o Enviado do BTG) deixa o lugar
                    // em branco — é o que mantém as colunas alinhadas.
                    if (!e) return <span key={ato} />
                    const posta = temEtiqueta(e.nome)
                    return (
                      <button
                        key={e.nome}
                        type="button"
                        // Uma de cada vez NESTE card: duas chamadas simultâneas
                        // voltariam com listas diferentes, e a última a chegar
                        // sobrescreveria a outra na tela.
                        disabled={emVoo !== null}
                        onClick={() => onAlternar(e.nome, posta ? 'remover' : 'adicionar')}
                        title={posta ? `Tirar "${e.nome}"` : `Marcar "${e.nome}"`}
                        aria-label={posta ? `Tirar "${e.nome}"` : `Marcar "${e.nome}"`}
                        aria-pressed={posta}
                        className={cn(
                          // REDONDO, e não quadrado: no fundo a escolha é uma só,
                          // e círculo é a forma que diz isso antes de testar.
                          'grid h-[24px] w-[24px] place-items-center justify-self-center rounded-full border-[1.5px] text-white transition-colors disabled:cursor-progress',
                          posta ? 'border-marca bg-marca' : 'border-borda-forte bg-superficie hover:border-marca-viva',
                        )}
                      >
                        {emVoo === e.nome ? (
                          <Loader2 className="h-[14px] w-[14px] animate-spin text-marca-texto" aria-hidden />
                        ) : posta ? (
                          <Check className="h-[13px] w-[13px]" strokeWidth={3} aria-hidden />
                        ) : null}
                      </button>
                    )
                  })}
                  {/* HÁ QUANTO TEMPO a opção marcada está no card: é o controle
                      de quanto o fundo está demorando. */}
                  <span className="hidden text-right sm:block">
                    <DesdeQuando quando={marcada ? desdeQuandoAEtiqueta(datas, marcada.nome) : null} />
                  </span>
                </Fragment>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * A linha da comissão, embaixo do valor — limitada, spread novo, spread antigo —
 * em dois pedaços: o `detalhe` ("(spread 5%)") desce para a linha de baixo
 * quando a caixa é estreita (celular), em vez de empurrar o nome do fundo.
 */
function rotuloDaComissao(c: CotacaoLida['comissao']): { texto: string; detalhe?: string } {
  if (c === null) return { texto: 'Comissão —' }
  if (c.modalidade === 'limitada') return { texto: `Comissão ${formatarReais(c.centavos)}` }
  const pct = c.percentualCentesimos !== undefined ? `${formatarPercentual(c.percentualCentesimos)}%` : null
  if (c.centavos !== undefined) {
    return { texto: `Comissão ${formatarReais(c.centavos)}`, detalhe: `(spread${pct ? ` ${pct}` : ''})` }
  }
  return pct ? { texto: 'Comissão em spread', detalhe: `(${pct})` } : { texto: 'Comissão em spread' }
}

/**
 * O VALOR E A COMISSÃO de um fundo, alinhados à direita e em números tabulares:
 * a proposta na linha de cima, a comissão embaixo, em texto secundário. Sem
 * cotação, "—". O que alguém escreveu à mão no Kommo e não se lê como valor
 * aparece como está, cortado, com o texto inteiro no passar do mouse.
 *
 * NO SPREAD DO FORMATO NOVO ("R$ 807.500,00 / R$ 42.500,00 (Spread de 5%)"),
 * em cima vai a proposta FINAL — é o que o cedente recebe, e é o número que se
 * compara — e embaixo "Comissão R$ 42.500,00 (spread 5%)". O spread antigo,
 * sem percentual, continua "Comissão em spread".
 */
function ValoresDaCotacao({ cotacao }: { cotacao: CotacaoLida | null }) {
  if (!cotacao) return <span className="text-corpo tabular-nums text-texto-3">—</span>
  if (cotacao.proposta === null) {
    return (
      <span className="block max-w-[150px] truncate text-right text-xs text-texto-2" title={cotacao.texto}>
        {cotacao.texto}
      </span>
    )
  }
  const linha = rotuloDaComissao(cotacao.comissao)
  return (
    // NO CELULAR, NO MÁXIMO 160px: o "(spread 5%)" desce, e o "Cotado · há 2
    // dias" à esquerda não fica por baixo da comissão.
    <span className="block max-w-[160px] text-right tabular-nums sm:max-w-none">
      <span className="block whitespace-nowrap text-corpo font-semibold text-texto">{formatarReais(cotacao.proposta)}</span>
      <span className="block text-xs text-texto-2">
        <span className="whitespace-nowrap">{linha.texto}</span>
        {linha.detalhe && (
          <>
            {' '}
            <span className="whitespace-nowrap">{linha.detalhe}</span>
          </>
        )}
      </span>
    </span>
  )
}

/**
 * ESCOLHER A PROPOSTA: os fundos responderam, e a casa escolhe com qual seguir.
 *
 * DOIS PASSOS NA MESMA CAIXA — o fundo, e depois a confirmação —, porque o
 * clique move o card para a Produção de Proposta e deixa a nota "Seguir com a
 * proposta da PX Ativos." no Kommo: é o registro de uma decisão, e um clique
 * errado na lista não pode virar movimentação.
 *
 * AO LADO DE CADA FUNDO, O QUE ELE RESPONDEU — a etiqueta que o card tem dele e
 * há quanto tempo —, para escolher sem sair da caixa. O cotado fica em destaque.
 * E, à direita, O VALOR DA PROPOSTA E A COMISSÃO que ele ofereceu (05/10/2026),
 * lidos dos campos do card: lado a lado, sem ranking — spread e limitada não se
 * comparam direto.
 */
function BotaoEscolherProposta({
  lead,
  ocupado,
  carregando,
  onEscolher,
}: {
  lead: KommoLead
  ocupado: boolean
  carregando: boolean
  onEscolher: (fundo: string) => Promise<void>
}) {
  const [aberto, setAberto] = useState(false)
  const [fundo, setFundo] = useState<string | null>(null)
  const caixa = useRef<HTMLDivElement>(null)
  const flutuante = useRef<HTMLDivElement>(null)
  const pergunta = useRef<HTMLParagraphElement>(null)
  const fechar = useCallback(() => setAberto(false), [])
  useFecharFora(aberto, fechar, caixa)
  const ajuste = useCaixaNaTela(flutuante, aberto)

  // O FOCO ACOMPANHA O PASSO (revisão visual 2): o botão do fundo clicado some
  // com a troca, e o foco caía no <body> — pelo teclado, perdia-se o lugar. Vai
  // para a PERGUNTA, e não para o "Confirmar e mover": dois Enter seguidos não
  // podem mover o card. No "Voltar", volta à lista.
  const trocouDePasso = useRef(false)
  const irAoPasso = (f: string | null) => {
    trocouDePasso.current = true
    setFundo(f)
  }
  useEffect(() => {
    if (!trocouDePasso.current) return
    trocouDePasso.current = false
    if (fundo) pergunta.current?.focus()
    else flutuante.current?.querySelector<HTMLButtonElement>('button')?.focus()
  }, [fundo])

  /** A etiqueta que o card tem deste fundo, e desde quando. */
  const situacao = (destino: string) => {
    const grupo = etiquetasPorDestino().find((g) => g.destino === destino)
    const e = grupo?.etiquetas.find((x) => (lead.tags ?? []).some((t) => mesmaEtiqueta(t, x.nome)))
    return e ? { ato: e.ato, desde: desdeQuandoAEtiqueta(lead.tags_em, e.nome) } : null
  }

  /**
   * A COTAÇÃO DE CADA FUNDO, lida dos campos do card no Kommo (aba
   * "Cotações/propostas") — o espelho os guarda em `raw`, e a kommo-etiquetar
   * troca ali o que acabou de gravar. Só mostrar: spread e limitada não se
   * comparam direto, e a escolha é de quem lê.
   */
  const cotacoes = cotacoesDoCard(lead.raw?.custom_fields_values)

  async function confirmar() {
    if (!fundo) return
    try {
      await onEscolher(fundo)
      setAberto(false)
      setFundo(null)
    } catch {
      // O aviso é de quem chamou; a caixa fica aberta para tentar de novo.
    }
  }

  return (
    <div className="relative" ref={caixa}>
      <Button
        size="sm"
        variant="secondary"
        className={cn(BTN, ACAO_DA_ETAPA)}
        icon={<Handshake className={IC} aria-hidden />}
        onClick={() => {
          setFundo(null)
          setAberto((v) => !v)
        }}
        loading={carregando}
        disabled={ocupado}
        aria-expanded={aberto}
      >
        Escolher proposta
        <ChevronDown className="h-[14px] w-[14px]" aria-hidden />
      </Button>

      {aberto && (
        <div
          ref={flutuante}
          role="group"
          aria-label="Escolher a proposta"
          className={cn(CAIXA_FLUTUANTE, posicaoDaCaixa(ajuste), 'right-0 w-[360px] max-w-[calc(100vw-24px)]')}
          style={deslocamentoDaCaixa(ajuste)}
        >
          {fundo === null ? (
            <>
              <p className="flex items-baseline justify-between gap-s3 px-s3 pb-s1 pt-s2 text-xs font-bold uppercase tracking-[.06em] text-texto-3">
                <span>Seguir com a proposta de</span>
                <span className="whitespace-nowrap">Proposta</span>
              </p>
              {FUNDOS_DA_PRECIFICACAO.map((f) => {
                const s = situacao(f)
                const c = cotacoes[f]
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => irAoPasso(f)}
                    className="grid min-h-[36px] w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-s4 rounded-controle px-s3 py-s1.5 text-left hover:bg-superficie-3 focus-visible:bg-superficie-3"
                  >
                    <span className="min-w-0">
                      <span
                        className={cn(
                          'block truncate text-corpo text-texto',
                          s?.ato === 'Cotado' ? 'font-bold' : 'font-medium',
                        )}
                      >
                        {f}
                      </span>
                      {s && (
                        <span className="block truncate text-xs text-texto-3">
                          {s.ato}
                          {s.desde ? ` · ${tempoDecorrido(s.desde)}` : ''}
                        </span>
                      )}
                    </span>
                    <ValoresDaCotacao cotacao={c} />
                  </button>
                )
              })}
            </>
          ) : (
            <div>
              <p
                ref={pergunta}
                tabIndex={-1}
                className="rounded-controle px-s3 pb-s1 pt-s3 text-corpo text-texto focus:outline-none"
              >
                {mensagemDaProposta(fundo)}
              </p>
              {cotacoes[fundo] && (
                <div className="mx-s3 mt-s1 flex items-center justify-between gap-s4 rounded-campo bg-superficie-2 px-s3 py-s2">
                  <span className="text-xs font-bold uppercase tracking-[.06em] text-texto-3">Proposta</span>
                  <ValoresDaCotacao cotacao={cotacoes[fundo]} />
                </div>
              )}
              {/* O "VOLTAR" EM FANTASMA, como no "Fechado!": é o cancelar da caixa. */}
              <div className="flex justify-end gap-s2 p-s2">
                <Button size="sm" variant="ghost" className={BTN} onClick={() => irAoPasso(null)} disabled={carregando}>
                  Voltar
                </Button>
                <Button size="sm" className={BTN} onClick={() => void confirmar()} loading={carregando}>
                  Confirmar e mover
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** "ao BTG", "à PJus"; "do BTG", "da PJus". */
const aoFundo = (f: FundoDoEnvio) => `${f.artigo === 'a' ? 'à' : 'ao'} ${f.fundo}`
const doFundo = (f: FundoDoEnvio) => `${f.artigo === 'a' ? 'da' : 'do'} ${f.fundo}`

/** O desfecho do fundo já posto no card (a etiqueta de um dos atos dele), ou null. */
function atoFeito(f: FundoDoEnvio, tags: readonly string[] | null | undefined): AtoDoEnvio | null {
  return f.atos.find((a) => (tags ?? []).some((t) => mesmaEtiqueta(t, a.etiqueta))) ?? null
}

/**
 * OS CHECKS DO ENVIO AOS FUNDOS, na remessa: um por fundo com plataforma própria.
 *
 * O CHECK É A ETIQUETA DO CARD — a posta pela janela do envio e a posta à mão no
 * Kommo: verde com o fundo aceitando o crédito, vermelho com ele reprovando, e
 * há quanto tempo no passar do mouse.
 *
 * NA FAIXA DA AMOSTRA desde a onda 2: cada fundo é uma pílula com o quadrado e o
 * nome (abre a janela do envio) e, ao lado, o ícone que abre a plataforma dele
 * em outra aba. Antes o NOME era o link e só o quadrado abria a janela; as duas
 * portas continuam, cada uma num alvo próprio.
 *
 * COM TODOS FEITOS E O CARD AINDA AQUI (a movimentação falhou, ou as etiquetas
 * foram postas à mão no Kommo), aparece o botão de mover, na ponta da faixa.
 */
function ChecksDosFundos({
  lead,
  fundos,
  ocupado,
  movendo,
  onAbrir,
  onMover,
}: {
  lead: KommoLead
  fundos: FundoDoEnvio[]
  ocupado: boolean
  /** O "Mover para Em precificação" deste card está em curso. */
  movendo: boolean
  onAbrir: (f: FundoDoEnvio) => void
  onMover: () => void
}) {
  const todos = fundos.every((f) => atoFeito(f, lead.tags))
  return (
    <div
      role="group"
      aria-label="Envio aos fundos"
      className="mt-[10px] flex flex-wrap items-center gap-s2 rounded-campo border border-dashed border-borda-forte bg-superficie-2 px-s3 py-s2"
    >
      {fundos.map((f) => {
        const ato = atoFeito(f, lead.tags)
        const desde = ato ? desdeQuandoAEtiqueta(lead.tags_em, ato.etiqueta) : null
        return (
          <span
            key={f.fundo}
            className={cn(
              'inline-flex items-center overflow-hidden rounded-full border',
              ato?.reprova
                ? 'border-perigo-borda bg-perigo-fundo'
                : ato
                  ? 'border-sucesso-borda bg-sucesso-fundo'
                  : 'border-borda-forte bg-superficie',
            )}
          >
            <button
              type="button"
              onClick={() => onAbrir(f)}
              disabled={ocupado || ato !== null}
              aria-pressed={ato !== null}
              title={
                ato
                  ? `${ato.etiqueta}${desde ? ` · ${tempoDecorrido(desde)}` : ''}`
                  : `Registrar o envio ${aoFundo(f)}`
              }
              className="inline-flex h-[30px] items-center gap-s1.5 pl-s1.5 pr-s3 text-sm font-semibold text-texto hover:bg-superficie-3 disabled:cursor-default disabled:hover:bg-transparent"
            >
              <span
                className={cn(
                  'grid h-[18px] w-[18px] place-items-center rounded-[5px] border-[1.5px]',
                  ato?.reprova
                    ? 'border-perigo-cheio bg-perigo-cheio text-white'
                    : ato
                      ? 'border-sucesso-cheio bg-sucesso-cheio text-white'
                      : 'border-borda-forte bg-superficie',
                )}
              >
                {ato?.reprova ? (
                  <X className="h-[12px] w-[12px]" strokeWidth={3} aria-hidden />
                ) : ato ? (
                  <Check className="h-[12px] w-[12px]" strokeWidth={3} aria-hidden />
                ) : null}
              </span>
              {f.fundo}
            </button>
            <a
              href={f.plataforma}
              target="_blank"
              rel="noreferrer"
              title={`Abrir a plataforma ${doFundo(f)}`}
              aria-label={`Abrir a plataforma ${doFundo(f)}`}
              className="grid h-[30px] place-items-center border-l border-borda px-s2 text-texto-3 hover:bg-superficie-3 hover:text-marca-texto"
            >
              <ExternalLink className="h-[14px] w-[14px]" aria-hidden />
            </a>
          </span>
        )
      })}
      {todos && (
        <Button
          size="sm"
          variant="success"
          className={cn(BTN, 'ml-auto')}
          icon={<ArrowRight className={IC} aria-hidden />}
          onClick={onMover}
          loading={movendo}
          disabled={ocupado}
        >
          Mover para Em precificação
        </Button>
      )}
    </div>
  )
}

/**
 * A JANELA DO ENVIO A UM FUNDO: o texto (opcional) e as imagens — o print da
 * plataforma, colado com Ctrl+V ou escolhido no computador. A anotação no card
 * começa sempre pela linha padrão do desfecho ("Crédito enviado ao BTG.",
 * "Crédito reprovado pelo BTG."), e o que se escrever vem depois.
 *
 * UM BOTÃO POR DESFECHO, no lugar do "Confirmar envio" (01/10/2026): o fundo
 * aceita ou reprova, e o botão escolhido decide a etiqueta e a linha da nota.
 * No rodapé da casa (§0.6): o que reprova à esquerda, em contorno; à direita,
 * Cancelar e o que aceita.
 *
 * A COTAÇÃO DO BTG (05/10/2026): no fundo cujo ato a pede (`pedeCotacao`, o
 * "Cotado BTG"), a janela pede também o valor da proposta e a comissão — os
 * mesmos campos da janela da cotação (`CamposDaCotacao`). Obrigatórios só para
 * esse ato: "Reprovado BTG" não os usa, e a PJus não os vê.
 */
function JanelaDoEnvioAoFundo({
  fundo,
  atual,
  onFechar,
  onConfirmar,
}: {
  fundo: FundoDoEnvio
  /** O que o campo do fundo já tem no card (aba "Cotações/propostas"), lido de volta. */
  atual: CotacaoLida | null
  onFechar: () => void
  onConfirmar: (
    ato: AtoDoEnvio,
    texto: string,
    arquivos: File[],
    cotacao: Cotacao | null,
    onAndamento: (texto: string, pct?: number) => void,
  ) => Promise<void>
}) {
  const [texto, setTexto] = useState('')
  const [arquivos, setArquivos] = useState<File[]>([])
  const [andamento, setAndamento] = useState<{ texto: string; pct?: number; ato: string } | null>(null)
  // O ERRO FICA NA JANELA, e não só no aviso que some: é o que se copia para
  // pedir ajuda, e o aviso passa antes de alguém conseguir ler.
  const [erro, setErro] = useState<string | null>(null)
  const entrada = useRef<HTMLInputElement>(null)
  const ocupado = andamento !== null
  // A TRAVA DO DUPLO CLIQUE, num ref: o `andamento` só desliga os botões no
  // próximo render, e o segundo clique cabe antes dele.
  const emVoo = useRef(false)
  const idDaJanela = useId()

  // A COTAÇÃO, quando algum ato deste fundo a pede. O estado existe sempre (é
  // um hook), mas só aparece e só vale no fundo que a pede.
  const pedeCotacao = fundo.atos.some((a) => a.pedeCotacao)
  const cotacao = useCotacaoEmEdicao(atual)
  const [tentouCotar, setTentouCotar] = useState(false)

  // O PRINT COLADO chega como "image.png": ganha nome que diga de onde veio.
  const acrescentar = (lista: File[]) =>
    setArquivos((antes) => [
      ...antes,
      ...lista.map((a, i) =>
        a.name && a.name !== 'image.png'
          ? a
          : new File([a], `print-${fundo.fundo}-${Date.now()}-${i + 1}.png`, { type: a.type || 'image/png' }),
      ),
    ])

  // O MESMO CRITÉRIO DO X, DO ESCAPE E DO CANCELAR: texto escrito, imagem
  // colada ou valor digitado. O Cancelar do rodapé fechava sem perguntar, e o
  // print colado ia junto.
  const sujo = texto.trim().length > 0 || arquivos.length > 0 || (pedeCotacao && cotacao.sujo)
  const cancelar = async () => {
    if (sujo && !(await perguntarDescarte())) return
    onFechar()
  }

  async function confirmar(ato: AtoDoEnvio) {
    if (emVoo.current) return
    setErro(null)
    // FALTANDO VALOR, nada sai daqui: os campos dizem o que falta.
    if (ato.pedeCotacao) {
      setTentouCotar(true)
      if (!cotacao.cotacao) return
    }
    emVoo.current = true
    setAndamento({ texto: 'Começando…', pct: 0, ato: ato.etiqueta })
    try {
      await onConfirmar(ato, texto, arquivos, ato.pedeCotacao ? cotacao.cotacao : null, (t, pct) =>
        setAndamento({ texto: t, pct, ato: ato.etiqueta }),
      )
    } catch (e) {
      // A janela fica aberta para tentar de novo, com o motivo à vista.
      setErro((e as Error)?.message ?? String(e))
    } finally {
      emVoo.current = false
      setAndamento(null)
    }
  }

  const botaoDoAto = (a: AtoDoEnvio) => (
    <Button
      key={a.etiqueta}
      variant={a.reprova ? 'dangerOutline' : 'success'}
      onClick={() => void confirmar(a)}
      loading={andamento?.ato === a.etiqueta}
      disabled={ocupado}
    >
      {a.etiqueta}
    </Button>
  )

  const anotacao = (
    <div>
      {/* O CAMPO DA CASA (ui/Field), o mesmo dos da cotação acima. */}
      <Textarea
        // COM A COTAÇÃO, o foco começa no valor da proposta (o primeiro campo).
        autoFocus={!pedeCotacao}
        rows={4}
        value={texto}
        aria-label="Anotação"
        onChange={(e) => setTexto(e.target.value)}
        onPaste={(e) => {
          const imagens = [...e.clipboardData.files].filter((a) => a.type.startsWith('image/'))
          if (imagens.length) {
            e.preventDefault()
            acrescentar(imagens)
          }
        }}
        disabled={ocupado}
        placeholder="O que foi enviado, ou o motivo da reprovação (opcional) — dá para colar o print aqui com Ctrl+V."
      />
      <div className="mt-s3">
        <input
          ref={entrada}
          type="file"
          accept="image/*,application/pdf"
          multiple
          className="hidden"
          onChange={(e) => {
            acrescentar([...(e.target.files ?? [])])
            e.target.value = ''
          }}
        />
        {/* DENTRO DA JANELA, O `sm` DE 28PX (§0.2), como as ações dos painéis
            de certidões — os 32px de BTN são a medida do card. */}
        <Button
          size="sm"
          variant="secondary"
          icon={<Upload className={IC} aria-hidden />}
          onClick={() => entrada.current?.click()}
          disabled={ocupado}
        >
          Anexar imagem
        </Button>
        {arquivos.length > 0 && (
          // A COLUNA NÃO CRESCE COM O NOME: sem o minmax(0,1fr), um nome longo
          // alargava a lista e empurrava o X para fora da janela no celular.
          <ul className="mt-s2 grid grid-cols-[minmax(0,1fr)] gap-s1">
            {arquivos.map((a, i) => (
              <li
                key={`${a.name}-${i}`}
                className="flex items-center gap-s2 rounded-controle bg-superficie-2 py-s1 pl-s2 pr-s1 text-corpo text-texto"
              >
                {/* A LINHA DO ARQUIVO DA ANOTAÇÃO DO CARD (CaixaDeAnotacao): ícone
                    de 16px, tamanho em números tabulares, o X de 28px. */}
                <FileText className="h-[16px] w-[16px] flex-none text-texto-3" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{a.name}</span>
                <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-texto-3">{Math.max(1, Math.round(a.size / 1024))} KB</span>
                <button
                  type="button"
                  onClick={() => setArquivos((antes) => antes.filter((_, j) => j !== i))}
                  disabled={ocupado}
                  className="grid h-controle-sm w-controle-sm shrink-0 place-items-center rounded-controle text-texto-3 hover:bg-superficie-3 hover:text-perigo disabled:cursor-default disabled:opacity-40"
                  aria-label={`Tirar ${a.name}`}
                  title={`Tirar ${a.name}`}
                >
                  <X className="h-[14px] w-[14px]" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )

  return (
    <Modal
      open
      onClose={() => !ocupado && onFechar()}
      dirty={sujo}
      title={`Envio ${aoFundo(fundo)}`}
      description={
        <a
          href={fundo.plataforma}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-s1 font-medium text-marca-texto hover:underline"
        >
          Abrir a plataforma {doFundo(fundo)}
          <ExternalLink className="h-[16px] w-[16px]" aria-hidden />
        </a>
      }
      rodapeInicio={fundo.atos.some((a) => a.reprova) ? fundo.atos.filter((a) => a.reprova).map(botaoDoAto) : undefined}
      footer={
        // CANCELAR EM FANTASMA, como na janela da cotação e na due diligence; e
        // [Cancelar][ato] JUNTOS: no celular, o par quebra inteiro para a linha
        // de baixo, em vez de deixar o ato sozinho.
        <div className="flex gap-s2">
          <Button variant="ghost" onClick={() => void cancelar()} disabled={ocupado}>
            Cancelar
          </Button>
          {fundo.atos.filter((a) => !a.reprova).map(botaoDoAto)}
        </div>
      }
    >
      {pedeCotacao ? (
        <div className="space-y-s6">
          <section aria-labelledby={`${idDaJanela}-cotacao`} className="space-y-s3">
            <div>
              <h3 id={`${idDaJanela}-cotacao`} className="font-display text-xs font-bold uppercase tracking-[0.06em] text-texto-3">
                Cotação {doFundo(fundo)}
              </h3>
              <p className="mt-s1 text-xs text-texto-3">
                Obrigatória no “{fundo.atos.find((a) => a.pedeCotacao)?.etiqueta}”; vai para o campo {fundo.fundo} da aba “
                {NOME_DO_GRUPO_DAS_COTACOES}”. A reprovação não a usa.
              </p>
            </div>
            {/* ENTER NUM CAMPO DA COTAÇÃO é o ato que a pede ("Cotado BTG"):
                a janela tem dois atos no rodapé, e só este usa os campos. */}
            <CamposDaCotacao
              edicao={cotacao}
              fundo={fundo.fundo}
              tentou={tentouCotar}
              desligado={ocupado}
              onEnter={() => {
                const ato = fundo.atos.find((a) => a.pedeCotacao)
                if (ato) void confirmar(ato)
              }}
            />
          </section>
          <section aria-labelledby={`${idDaJanela}-anotacao`} className="space-y-s3">
            <h3 id={`${idDaJanela}-anotacao`} className="font-display text-xs font-bold uppercase tracking-[0.06em] text-texto-3">
              Anotação e print
            </h3>
            {anotacao}
          </section>
        </div>
      ) : (
        anotacao
      )}
      {andamento && (
        <div className="mt-s3 grid gap-s1.5 text-corpo text-texto-2" role="status">
          <div className="h-2 overflow-hidden rounded-full bg-superficie-3">
            <div
              className={cn(
                'h-full rounded-full bg-marca-viva transition-all duration-300',
                andamento.pct === undefined && 'animate-pulse',
              )}
              style={{ width: `${andamento.pct ?? 100}%` }}
            />
          </div>
          <span>{andamento.texto}</span>
        </div>
      )}
      {erro && !andamento && (
        <CaixaDeAviso tom="perigo" role="alert" className="mt-s3">
          Não deu certo: {erro}
        </CaixaDeAviso>
      )}
    </Modal>
  )
}

/** O andamento do anexar-e-mover: o arquivo subindo, o Kommo gravando, o card se movendo. */
type AndamentoDoAnexo = ProgressoDoEnvio | { fase: 'movendo' }

/**
 * ANEXAR E MOVER: escolher um arquivo no computador, subi-lo ao card no Kommo
 * com a anotação padrão, e mover o card (ver `anexarEMover` na trilha).
 *
 * UM CLIQUE, SEM JANELA NO MEIO: escolher o arquivo já é a confirmação — é o que
 * a operação pediu. Enquanto sobe, a barra ocupa o lugar do botão (amostra):
 * o arquivo subindo, depois "gravando no Kommo" e "movendo o card", que não têm
 * porcentagem.
 *
 * SE O ARQUIVO SUBIU E O CARD NÃO SE MOVEU, o botão passa a só mover: escolher o
 * arquivo de novo o anexaria duas vezes.
 */
function BotaoAnexarEMover({
  rotulo,
  soMover,
  ocupado,
  onEnviar,
}: {
  rotulo: string
  soMover: boolean
  ocupado: boolean
  onEnviar: (arquivo: File | null, onAndamento: (p: AndamentoDoAnexo) => void) => Promise<void>
}) {
  const entrada = useRef<HTMLInputElement>(null)
  const [andamento, setAndamento] = useState<AndamentoDoAnexo | null>(null)

  async function enviar(arquivo: File | null) {
    setAndamento(arquivo ? { fase: 'enviando', pct: 0 } : { fase: 'movendo' })
    try {
      await onEnviar(arquivo, setAndamento)
    } catch {
      // O aviso é de quem chamou.
    } finally {
      setAndamento(null)
    }
  }

  const texto = !andamento
    ? null
    : andamento.fase === 'enviando'
      ? `Enviando ${andamento.pct}%`
      : andamento.fase === 'processando'
        ? 'Gravando no Kommo…'
        : 'Movendo o card…'
  const pct = andamento?.fase === 'enviando' ? andamento.pct : andamento ? 100 : 0

  return (
    <>
      <input
        ref={entrada}
        type="file"
        className="hidden"
        onChange={(e) => {
          const arquivo = e.target.files?.[0] ?? null
          e.target.value = ''
          if (arquivo) void enviar(arquivo)
        }}
      />
      {andamento ? (
        <div className="grid w-[180px] gap-1 text-xs text-texto-2" role="status">
          <div className="h-1.5 overflow-hidden rounded-full bg-superficie-3">
            <div
              className={cn(
                'h-full rounded-full bg-marca-viva transition-all duration-200',
                andamento.fase !== 'enviando' && 'animate-pulse',
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span>{texto}</span>
        </div>
      ) : (
        <Button
          size="sm"
          variant="success"
          className={BTN}
          icon={soMover ? <ArrowRight className={IC} aria-hidden /> : <Upload className={IC} aria-hidden />}
          onClick={() => (soMover ? void enviar(null) : entrada.current?.click())}
          disabled={ocupado}
          title={soMover ? 'O arquivo já está no card — falta só mover' : 'Escolher o arquivo no computador'}
        >
          {soMover ? 'Tentar mover de novo' : rotulo}
        </Button>
      )}
    </>
  )
}

/**
 * A ANOTAÇÃO NO CARD, de qualquer card da análise de crédito.
 *
 * NASCEU NA FILA DE PRECIFICAÇÃO, onde o fundo responde a proposta, pede
 * documento, muda o deságio. Desde 30/09/2026 está em todos os cards, de todas
 * as etapas e funis, a pedido da equipe: em qualquer fase acontece algo que
 * precisa ser escrito no Kommo, e sem ela era preciso abrir o card lá.
 *
 * VAI COMO NOTA DE PESSOA, com o nome de quem escreveu no rodapé (ver
 * `marcarComoDePessoa`): é o que o comercial lê, e é o que a análise seguinte
 * precisa ler como informação do card — não como anotação da própria máquina.
 *
 * O RASCUNHO NÃO SE PERDE AO FECHAR: clicar fora ou apertar Esc fecha a caixa e
 * mantém o texto, e o botão fica marcado (âmbar, com o ponto) enquanto houver
 * rascunho. Só o envio bem-sucedido limpa (ou apagar o texto à mão). Desde
 * 03/10/2026 ele fica guardado no navegador, por card: antes sumia quando o
 * card saía da tela.
 *
 * "ANOTAR" COM TEXTO desde a onda 2 (amostra): era um ícone de 20 px ao lado do
 * título; virou botão com rótulo, na zona de ações, com alvo de 32 px.
 *
 * COM ARQUIVOS desde 05/10/2026 (pedido do dono): o miolo da caixa e o estado
 * moram em components/CaixaDeAnotacao.tsx. ENVIANDO, A CAIXA NÃO FECHA por um
 * clique fora: o andamento e a falha parcial precisam de onde aparecer.
 */
function BotaoDeAnotacao({ leadId, onEnviar }: { leadId: number; onEnviar: (texto: string) => Promise<void> }) {
  const [aberto, setAberto] = useState(false)
  const anotacao = useAnotacaoDoCard(leadId, onEnviar)
  const caixa = useRef<HTMLDivElement>(null)
  const flutuante = useRef<HTMLDivElement>(null)
  const enviando = anotacao.enviando
  const fechar = useCallback(() => {
    if (!enviando) setAberto(false)
  }, [enviando])
  useFecharFora(aberto, fechar, caixa)
  const ajuste = useCaixaNaTela(flutuante, aberto)

  const temRascunho = anotacao.temRascunho
  return (
    <div className="relative" ref={caixa}>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setAberto((v) => !v)}
        title={temRascunho ? 'Anotação em rascunho — clique para continuar' : 'Escrever uma anotação no card do Kommo'}
        aria-expanded={aberto}
        className={cn(BTN, temRascunho && 'border-aviso-borda bg-aviso-fundo text-aviso hover:bg-aviso-fundo hover:text-aviso')}
        icon={<MessageSquarePlus className={IC} aria-hidden />}
      >
        Anotar
        {temRascunho && <span className="ml-0.5 h-[7px] w-[7px] rounded-full bg-aviso-cheio" aria-hidden />}
      </Button>

      {aberto && (
        <div
          ref={flutuante}
          role="group"
          aria-label="Anotação no card"
          className={cn(CAIXA_FLUTUANTE, posicaoDaCaixa(ajuste), 'right-0 w-[360px] max-w-[calc(100vw-24px)] p-s3')}
          style={deslocamentoDaCaixa(ajuste)}
        >
          <CaixaDeAnotacao anotacao={anotacao} classeDoBotao={BTN} onFeito={() => setAberto(false)} />
        </div>
      )}
    </div>
  )
}

/**
 * O "FECHADO!" DA NEGOCIAÇÃO (onda 4 do redesenho, etapa 10b — para todos desde
 * 03/10/2026, ver `BOTOES_NOVOS_PARA_TODOS`): o
 * cedente aceitou a proposta. Confirma num passo, numa caixa presa ao botão
 * (amostra, `confirmarFechado`), com uma anotação opcional.
 *
 * A NOTA É "Proposta aceita pelo cedente." mais a anotação, se houver; o
 * movimento é o da `kommo-mover`, que confere a origem (a Negociação) e marca a
 * nota de serviço como "Comercial". FALHA DA NOTA COM O CARD MOVIDO: a caixa fica
 * aberta com o aviso, e confirmar de novo só anota (ver `moverComNota`).
 */
function BotaoFechado({
  acao,
  cedente,
  destino,
  ocupado,
  onConfirmar,
}: {
  acao: AcaoTela
  cedente: string
  /** O nome da coluna de destino, como a tela a mostra. */
  destino: string
  ocupado: boolean
  onConfirmar: (nota: string) => Promise<void>
}) {
  const [aberto, setAberto] = useState(false)
  const [anotacao, setAnotacao] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const caixa = useRef<HTMLDivElement>(null)
  const flutuante = useRef<HTMLDivElement>(null)
  // ENVIANDO, A CAIXA NÃO FECHA POR UM CLIQUE FORA: o aviso de falha da nota
  // precisa de onde aparecer.
  const fechar = useCallback(() => {
    if (!enviando) setAberto(false)
  }, [enviando])
  useFecharFora(aberto, fechar, caixa)
  const ajuste = useCaixaNaTela(flutuante, aberto)

  async function confirmar() {
    if (enviando) return
    setErro(null)
    setEnviando(true)
    try {
      await onConfirmar(notaDoFechado(anotacao))
      setAberto(false)
      setAnotacao('')
    } catch (e) {
      setErro((e as Error)?.message ?? String(e))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="relative" ref={caixa}>
      <Button
        size="sm"
        variant="success"
        className={BTN}
        icon={<Handshake className={IC} aria-hidden />}
        onClick={() => {
          setErro(null)
          setAberto((v) => !v)
        }}
        disabled={ocupado && !aberto}
        aria-expanded={aberto}
      >
        {acao.label}
      </Button>

      {aberto && (
        <div
          role="dialog"
          aria-label="Confirmar negócio fechado"
          ref={flutuante}
          className={cn(
            CAIXA_FLUTUANTE,
            posicaoDaCaixa(ajuste),
            'right-0 w-[320px] max-w-[calc(100vw-24px)] p-s4 text-center',
          )}
          style={deslocamentoDaCaixa(ajuste)}
        >
          <span
            aria-hidden
            className="mx-auto mb-2 grid h-[36px] w-[36px] place-items-center rounded-full bg-sucesso-fundo text-sucesso"
          >
            <Handshake className="h-[20px] w-[20px]" />
          </span>
          <p className="font-display text-corpo font-bold text-texto">O cedente aceitou a proposta?</p>
          <p className="mt-1 text-corpo text-texto-2">
            {cedente} vai para <strong className="text-texto">{destino}</strong>.
          </p>
          <input
            value={anotacao}
            disabled={enviando}
            onChange={(e) => setAnotacao(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void confirmar()
            }}
            aria-label="Anotação (opcional)"
            placeholder="Anotação (opcional) — ex.: aceitou por telefone"
            className="mt-3 h-[36px] w-full rounded-controle border border-borda-controle bg-superficie px-[10px] text-corpo text-texto placeholder:text-texto-3 focus:border-anel focus:outline-none focus:ring-[3px] focus:ring-anel/20 disabled:bg-superficie-3"
          />
          {erro && (
            <CaixaDeAviso tom="perigo" role="alert" className="mt-3 text-left">
              {erro}
            </CaixaDeAviso>
          )}
          <div className="mt-3 flex justify-center gap-2">
            <Button size="sm" variant="ghost" className={BTN} onClick={() => setAberto(false)} disabled={enviando}>
              Voltar
            </Button>
            <Button
              // O FOCO NO CONFIRMAR ao abrir (amostra): é a ação que se procura.
              autoFocus
              size="sm"
              variant="success"
              className={BTN}
              icon={<Check className={IC} aria-hidden />}
              onClick={() => void confirmar()}
              loading={enviando}
            >
              Confirmar: fechado!
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * O "NÃO FECHOU" DA NEGOCIAÇÃO (onda 4 do redesenho, etapa 10b — para todos desde
 * 03/10/2026, ver `BOTOES_NOVOS_PARA_TODOS`): o
 * cedente recusou (vai para Não fechado/s) ou sumiu (vai para Sem resposta), com
 * o motivo escrito — pelo menos 10 caracteres — e motivos de um clique (amostra,
 * `janelaNaoFechou`).
 *
 * FALHA DA NOTA COM O CARD MOVIDO: a janela fica aberta com o aviso, a escolha
 * trava no destino que já recebeu o card, e confirmar de novo só anota — trocar
 * de opção ali moveria o card uma segunda vez.
 */
function JanelaNaoFechou({
  lead,
  opcoes,
  nomeDaColuna,
  jaMovido,
  onConfirmar,
  onFechar,
}: {
  lead: KommoLead
  opcoes: Partial<Record<TipoDeNaoFechou, AcaoTela>>
  nomeDaColuna: (statusId: number) => string
  jaMovido: (statusId: number) => boolean
  onConfirmar: (acao: AcaoTela, nota: string) => Promise<void>
  onFechar: () => void
}) {
  const tipos = (['recusou', 'sumiu'] as const).filter((t) => opcoes[t])
  const [tipo, setTipo] = useState<TipoDeNaoFechou>(tipos[0] ?? 'recusou')
  // O MOTIVO ESCRITO E NÃO ENVIADO volta (ver rascunhoDoCard.ts); a opção
  // (recusou/sumiu) não — ela é um clique, e quem reabre escolhe de novo.
  const leadId = lead.kommo_lead_id
  const [recuperado, setRecuperado] = useState(() => rascunhoGuardado(leadId, 'naofechou'))
  const [motivo, setMotivo] = useState(recuperado?.texto ?? '')
  const mudarMotivo = (v: string) => {
    setMotivo(v)
    guardarRascunho(leadId, 'naofechou', v)
  }
  const fecharDescartando = () => {
    apagarRascunho(leadId, 'naofechou')
    onFechar()
  }
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const campo = useRef<HTMLTextAreaElement>(null)
  const acao = opcoes[tipo]
  // O DESTINO QUE JÁ RECEBEU O CARD nesta janela (só depois de um erro).
  const movido = erro ? tipos.find((t) => opcoes[t] && jaMovido(opcoes[t]!.statusId)) : undefined
  const m = MOTIVOS_NAO_FECHOU[tipo]
  const pode = Boolean(acao) && !enviando && motivoSuficiente(motivo) && (!movido || movido === tipo)

  const escolher = (t: TipoDeNaoFechou) => {
    if (movido || enviando) return
    setTipo(t)
  }
  // AS SETAS ANDAM ENTRE AS OPÇÕES, como num grupo de rádios.
  const aoTeclar = (e: React.KeyboardEvent) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) || tipos.length < 2) return
    e.preventDefault()
    const i = tipos.indexOf(tipo)
    const prox = tipos[(i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? tipos.length - 1 : 1)) % tipos.length]
    escolher(prox)
    document.getElementById(`nf-${lead.kommo_lead_id}-${prox}`)?.focus()
  }

  async function confirmar() {
    if (!acao || !pode) return
    setErro(null)
    setEnviando(true)
    try {
      await onConfirmar(acao, notaDoNaoFechou(tipo, motivo))
      apagarRascunho(leadId, 'naofechou')
    } catch (e) {
      setErro((e as Error)?.message ?? String(e))
    } finally {
      setEnviando(false)
    }
  }

  const cancelar = async () => {
    if (motivo.trim() && !(await perguntarDescarte())) return
    fecharDescartando()
  }

  return (
    <Modal
      open
      // NÃO FECHA COM A MOVIMENTAÇÃO NO AR — o mesmo motivo da JanelaDeMensagem.
      onClose={enviando ? () => undefined : fecharDescartando}
      title="O cedente não fechou"
      description={tituloCard(lead)}
      size="lg"
      dirty={motivo.trim() !== ''}
      footer={
        <div className="flex w-full flex-wrap items-center gap-2">
          <Button variant="ghost" className={BTN} onClick={cancelar} disabled={enviando}>
            Cancelar
          </Button>
          <span className="flex-1" />
          <Button
            variant="outline"
            className={cn(BTN, PERIGO_CONTORNADO)}
            icon={<X className={IC} aria-hidden />}
            onClick={() => void confirmar()}
            disabled={!pode}
            loading={enviando}
          >
            {m.confirmar}
          </Button>
        </div>
      }
    >
      {recuperado && (
        <AvisoDoRascunho
          rascunho={recuperado}
          onDescartar={() => {
            apagarRascunho(leadId, 'naofechou')
            setMotivo('')
            setRecuperado(null)
          }}
        />
      )}
      <p id={`nf-${lead.kommo_lead_id}-rotulo`} className="mb-2 text-sm font-semibold text-texto">
        O que aconteceu?
      </p>
      <div
        role="radiogroup"
        aria-labelledby={`nf-${lead.kommo_lead_id}-rotulo`}
        className="grid gap-2 sm:grid-cols-2"
        onKeyDown={aoTeclar}
      >
        {tipos.map((t) => {
          const o = MOTIVOS_NAO_FECHOU[t]
          const marcado = t === tipo
          return (
            <button
              key={t}
              id={`nf-${lead.kommo_lead_id}-${t}`}
              type="button"
              role="radio"
              aria-checked={marcado}
              tabIndex={marcado ? 0 : -1}
              disabled={Boolean(movido) && movido !== t}
              onClick={() => escolher(t)}
              className={cn(
                'flex min-h-[56px] items-start gap-3 rounded-campo border px-4 py-3 text-left transition-colors disabled:opacity-50',
                marcado ? 'border-marca-viva bg-marca-suave' : 'border-borda bg-superficie hover:bg-superficie-3',
              )}
            >
              {t === 'recusou' ? (
                <X className="mt-0.5 h-[20px] w-[20px] flex-none text-perigo" aria-hidden />
              ) : (
                <Clock className="mt-0.5 h-[20px] w-[20px] flex-none text-aviso" aria-hidden />
              )}
              <span className="min-w-0">
                <span className="block text-corpo font-bold text-texto">{o.rotulo}</span>
                <span className="block text-sm text-texto-2">
                  {o.apoio} · vai para <i>{nomeDaColuna(opcoes[t]!.statusId)}</i>
                </span>
              </span>
            </button>
          )
        })}
      </div>
      <div role="group" aria-label="Motivos mais comuns" className="mt-4 flex flex-wrap items-center gap-1.5">
        <span className="text-sm text-texto-3">Motivos comuns:</span>
        {m.sugestoes.map((s) => (
          <button
            key={s}
            type="button"
            disabled={enviando}
            onClick={() => {
              mudarMotivo(comSugestao(motivo, s))
              campo.current?.focus()
            }}
            className="inline-flex min-h-[28px] items-center rounded-full border border-borda-forte bg-superficie px-3 text-sm font-medium text-texto-2 hover:bg-superficie-3"
          >
            {s}
          </button>
        ))}
      </div>
      <textarea
        ref={campo}
        autoFocus
        rows={4}
        value={motivo}
        disabled={enviando}
        aria-label="Motivo"
        placeholder={m.exemplo}
        onChange={(e) => mudarMotivo(e.target.value)}
        className="mt-3 min-h-[112px] w-full resize-y rounded-campo border border-borda-controle bg-superficie px-4 py-[10px] text-corpo text-texto placeholder:text-texto-3 focus:border-anel focus:outline-none focus:ring-[3px] focus:ring-anel/20 disabled:bg-superficie-3 disabled:text-texto-2"
      />
      {motivo.trim().length > 0 && !motivoSuficiente(motivo) && (
        <DicaDeAviso>Escreva o motivo por extenso — é o que o comercial lê depois para entender a perda.</DicaDeAviso>
      )}
      {erro && (
        <CaixaDeAviso tom="perigo" role="alert" className="mt-3">
          {erro}
        </CaixaDeAviso>
      )}
    </Modal>
  )
}

/** O "·" entre os campos do título do card. */
const Ponto = () => (
  <span className="text-borda-forte" aria-hidden>
    •
  </span>
)

/** O ícone de cada tom de etiqueta (amostra): cotado ✓, reprovado ✕, enviado →. */
function iconeDaEtiqueta(tom: TomDaTag): ReactNode {
  if (tom === 'green') return <Check className="h-[12px] w-[12px]" strokeWidth={3} aria-hidden />
  if (tom === 'red') return <X className="h-[12px] w-[12px]" strokeWidth={3} aria-hidden />
  if (tom === 'blue') return <ArrowRight className="h-[12px] w-[12px]" aria-hidden />
  if (tom === 'yellow') return <Clock className="h-[12px] w-[12px]" aria-hidden />
  return null
}

/** O link discreto da amostra (`.link-btn`), para o "Ver histórico" e afins. */
const LINK_BTN =
  '-ml-2 inline-flex h-[28px] items-center gap-1.5 rounded-controle px-2 text-sm font-semibold text-marca-texto transition-colors hover:bg-marca-leve'

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
  onAnaliseExterna,
  onBaixarAnexos,
  onConcluir,
  onAbrirAnexo,
  onPrepararAnexo,
  preparoDosAutos,
  onPreencherPlanilha,
  analisandoJuridico,
  resultadoJuridico,
  botoes,
  desfechoNoCard,
  mostrarTags,
  etiquetasOferecidas,
  onEtiquetar,
  onEditarCotacao,
  etiquetaEmVoo,
  onAnotar,
  onEscolherProposta,
  anexarEMover,
  envioAosFundos,
  onCertidoes,
  justificativa,
  onCopiar,
  negociacao,
  onGerarContrato,
  realcado = false,
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
  /** Abre a conversa da análise no Claude — no precatório. */
  onAnaliseExterna: (l: KommoLead) => void
  /** Baixa os anexos do card para o disco — o resgate, quando os autos não subiram. */
  onBaixarAnexos?: (l: KommoLead) => void
  /**
   * Fecha a etapa: abre a janela com a razão e as saídas possíveis.
   *
   * Indefinido nas abas cujo desfecho não é agrupado — lá as saídas continuam
   * sendo um botão cada.
   */
  onConcluir?: (l: KommoLead) => void
  /**
   * Abre um arquivo do histórico.
   *
   * RECEBE A NOTA INTEIRA, e não o nome: o que abre o arquivo é o `file_uuid`
   * que a anotação do Kommo carrega. O endereço de download é assinado e vence,
   * então o espelho guarda a chave e a tela pede o endereço no clique.
   */
  onAbrirAnexo: (l: KommoLead, anexo: KommoNota) => void
  /**
   * Começa a resolver o endereço antes do clique, no passar do mouse.
   *
   * O tempo de abrir um anexo é quase todo espera de rede. Começando aqui, ela
   * corre enquanto a pessoa ainda está mirando o link.
   */
  onPrepararAnexo: (l: KommoLead, anexo: KommoNota) => void
  /** Como vai o preparo dos autos deste card, se já foi pedido. */
  preparoDosAutos?: PreparoDosAutos
  /** Abre a janela que recebe o bloco da planilha entregue pela conversa do Claude. */
  onPreencherPlanilha?: (l: KommoLead) => void
  analisandoJuridico: boolean
  resultadoJuridico?: ResultadoJuridico
  botoes: BotoesDoCard
  /** Os desfechos ficam no card, ou na janela da análise? */
  desfechoNoCard: boolean
  /**
   * As etiquetas do Kommo aparecem neste card? Quais abas, exatamente, é
   * `ABAS_COM_TAGS` quem diz: passado o trabalho, a etiqueta é o que resta
   * dizendo para qual fundo o crédito foi, ou por que não foi; nas etapas de
   * trabalho seria ruído.
   */
  mostrarTags: boolean
  /**
   * As etiquetas que ESTA aba deixa aplicar e remover — vazio, só leitura.
   * Mostrar e EDITAR são coisas diferentes, e por isso são duas portas.
   */
  etiquetasOferecidas: readonly EtiquetaDoFundo[]
  onEtiquetar: (l: KommoLead, etiqueta: string, acao: 'adicionar' | 'remover') => void
  /** Reabre a janela da cotação de um "Cotado" já marcado (o lápis do seletor). */
  onEditarCotacao?: (l: KommoLead, etiqueta: string) => void
  /** A etiqueta deste card que está sendo gravada, ou null. */
  etiquetaEmVoo: string | null
  /** Escreve uma anotação no card do Kommo — ver `BotaoDeAnotacao`. */
  onAnotar?: (l: KommoLead, texto: string) => Promise<void>
  /**
   * Escolhe o fundo com que seguir e move o card para a Produção de Proposta.
   * Só na aba que declara `escolhaDeProposta` (Em precificação do Externo).
   */
  onEscolherProposta?: (l: KommoLead, fundo: string) => Promise<void>
  /** O botão de anexar e mover, onde a aba o declara (o Memorando do Externo). */
  anexarEMover?: {
    rotulo: string
    soMover: boolean
    onEnviar: (l: KommoLead, arquivo: File | null, onAndamento: (p: AndamentoDoAnexo) => void) => Promise<void>
  }
  /** Os checks do envio aos fundos, onde a aba os declara (a Remessa do Externo). */
  envioAosFundos?: {
    fundos: FundoDoEnvio[]
    destino: number
    onAbrir: (l: KommoLead, f: FundoDoEnvio) => void
    onMover: (l: KommoLead) => void
  }
  /** Abre o painel de certidões, onde a aba o declara (a Obtenção de documentação do Externo). */
  onCertidoes?: (l: KommoLead) => void
  /**
   * A justificativa técnica, onde a aba a declara (a Produção de proposta dos
   * três funis): o botão, ou o cheque de enviada. Não move o card.
   */
  justificativa?: {
    resumo?: ResumoDaJustificativa
    onAbrir: (l: KommoLead) => void
  }
  /**
   * Copia um texto do card (o número do processo, o nome do cedente) — o aviso
   * de sucesso ou de falha é da página; `aviso` é o que ela diz quando dá certo.
   */
  onCopiar: (texto: string, aviso: string) => void
  /**
   * O desfecho da Negociação no card (onda 4 — para todos desde 03/10/2026, ver
   * `abaParaQuemVe`): o "Fechado!" e o "Não fechou".
   */
  negociacao?: {
    opcoes: DesfechoDaNegociacao
    /** O nome da coluna de Fechados, como a tela a mostra. */
    destinoDoFechado: string
    onFechado: (l: KommoLead, nota: string) => Promise<void>
    onNaoFechou: (l: KommoLead) => void
  }
  /** Leva à Geração de contratos com este card (onda 4 — para todos desde 03/10/2026). Não move card. */
  onGerarContrato?: (l: KommoLead) => void
  /** O card que o endereço apontou ("Voltar ao card"): moldura de destaque, sem abrir nada. */
  realcado?: boolean
}) {
  const [aberto, setAberto] = useState(false)
  const ocupado = statusEmAndamento !== null
  // A planilha jurídica é do Interno: é só nele que o conector a pede à conversa.
  const planilhaDeReserva =
    Boolean(onPreencherPlanilha) && ehFunilPrecatorio(lead.pipeline_id) && !ehCardExterno(lead.pipeline_id)
  // Compatibilidade com cards sincronizados antes da coluna `notas` existir:
  // cai no nota_texto para não sumir o dado do crédito antes do próximo sync.
  const notas: KommoNota[] =
    lead.notas?.length > 0
      ? lead.notas
      : lead.nota_texto?.trim()
        ? [{ id: 0, texto: lead.nota_texto, criado_em: null, autor: null }]
        : []
  const posteriores = notas.length - 1
  const grupos = useMemo(() => agruparNotas(notas), [notas])
  const ultima = grupos[grupos.length - 1]

  // O TÍTULO QUEBRADO EM CAMPOS (amostra), pela mesma leitura que a análise usa.
  const campos = useMemo(() => camposDoTitulo(lead.nome), [lead.nome])
  // OS AVISOS DE CADASTRO só onde não há análise de RPV para dizer: nas abas de
  // due diligence e nas sem botão de trabalho. Memoizado porque
  // lerCardCredijuris junta TODAS as anotações do card numa string, e há cards
  // com histórico longo.
  const mostrarAvisos = botoes === 'nenhum' || botoes === 'dd'
  const cadastro = useMemo(() => (mostrarAvisos ? lerCardCredijuris(lead) : null), [lead, mostrarAvisos])
  const dias = diasNaEtapa(lead)
  const parado = estaParado(dias)
  const quandoNaEtapa = dataDaEtapa(lead)

  // A MIRA NO ANEXO: o passar do mouse só vira consulta depois de uma pausa. Um
  // relógio só basta porque o mouse está sobre um link de cada vez.
  const miraDoAnexo = useRef<number | null>(null)
  const cancelarMira = () => {
    if (miraDoAnexo.current !== null) window.clearTimeout(miraDoAnexo.current)
    miraDoAnexo.current = null
  }
  const aoMirarAnexo = (a: KommoNota) => {
    cancelarMira()
    miraDoAnexo.current = window.setTimeout(() => onPrepararAnexo(lead, a), 200)
  }
  useEffect(() => cancelarMira, [])

  const titulo = campos?.cedente ?? tituloCard(lead)
  // OS AUTOS DESTE CARD AINDA ESTÃO SENDO LIDOS (precatório): o botão continua
  // valendo — cada clique abre outra conversa e entra na fila —, só gira.
  const lendoAutos = preparoDosAutos?.estado === 'fila' || preparoDosAutos?.estado === 'lendo'

  return (
    <article
      data-lead={lead.kommo_lead_id}
      tabIndex={-1}
      className={cn(
        'relative grid grid-cols-1 gap-x-6 gap-y-2 rounded-cartao border border-borda bg-superficie px-[18px] shadow-nivel-1 transition-[border-color,box-shadow] duration-150 hover:border-borda-forte hover:shadow-nivel-2 focus:outline-none focus-visible:border-marca-viva focus-visible:ring-[3px] focus-visible:ring-marca-viva/20 min-[900px]:grid-cols-[minmax(0,1fr)_auto]',
        'py-4',
        realcado && 'border-marca-viva ring-[3px] ring-marca-viva/20',
      )}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-display text-lg font-bold leading-snug tracking-tight text-texto">
            {/* O NOME VIRA LINK PARA A PASTA DO CEDENTE no Drive, quando ela já
                existe — e é onde estão as planilhas daquele processo. LINK DE
                VERDADE: o id vem gravado no card (migração 0059). Sem id fica
                texto, porque título que parece link e não leva a nada é pior
                que título. */}
            {lead.drive_pasta_id ? (
              <a
                href={`https://drive.google.com/drive/folders/${lead.drive_pasta_id}`}
                target="_blank"
                rel="noreferrer"
                title="Abrir a pasta deste cedente no Drive"
                className="underline decoration-borda-forte decoration-1 underline-offset-[3px] hover:text-marca-texto"
              >
                {titulo}
              </a>
            ) : (
              titulo
            )}
          </h3>
          {/* COPIAR O NOME, como o número do processo: é o que se cola na busca
              do tribunal, das certidões e do Drive — e com o título virando
              link para a pasta, selecioná-lo com o mouse abria o Drive. Sem os
              campos separados, copia o título inteiro do card. */}
          <button
            type="button"
            onClick={() =>
              onCopiar(titulo, campos?.cedente ? 'Nome do cedente copiado.' : 'Título do card copiado.')
            }
            aria-label={campos?.cedente ? 'Copiar nome do cedente' : 'Copiar título do card'}
            title={campos?.cedente ? 'Copiar nome do cedente' : 'Copiar título do card'}
            className="-ml-1 grid h-[24px] w-[24px] place-items-center rounded-[6px] text-texto-3 hover:bg-superficie-3 hover:text-texto"
          >
            <Copy className="h-[14px] w-[14px]" aria-hidden />
          </button>
          {/* SÓ O "FINALIZADO": o que a pessoa procura na fila é o card cuja
              análise JÁ ESTÁ PRONTA; a ausência do selo diz o resto. */}
          {analisePronta === true && (
            <Selo tom="sucesso" icone={<Check className={icSelo} aria-hidden />}>
              Finalizado
            </Selo>
          )}
          {/* PARADO HÁ N DIAS, depois do prazo (amostra): o dado que pede ação
              vem junto do nome. Só com a data da etapa conhecida. */}
          {parado && dias !== null && (
            <Selo tom="aviso" icone={<Clock className={icSelo} aria-hidden />}>
              Parado há {dias} dias
            </Selo>
          )}
          {cadastro && <SelosDoCadastro d={cadastro} />}
        </div>

        {campos ? (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-corpo text-texto-2">
            <span>{campos.intermediador}</span>
            {/* SEM NÚMERO NO TÍTULO, O CAMPO SOME (amostra) — o resto do título
                continua separado. Quem avisa da falta é o selo do cadastro. */}
            {campos.numero && (
              <>
                <Ponto />
                <span className="inline-flex items-center gap-0.5 font-medium tabular-nums tracking-[.01em] text-texto">
                  {campos.numero}
                  <button
                    type="button"
                    onClick={() => onCopiar(campos.numero, 'Número do processo copiado.')}
                    aria-label="Copiar número do processo"
                    title="Copiar número do processo"
                    className="grid h-[24px] w-[24px] place-items-center rounded-[6px] text-texto-3 hover:bg-superficie-3 hover:text-texto"
                  >
                    <Copy className="h-[14px] w-[14px]" aria-hidden />
                  </button>
                </span>
              </>
            )}
            {(campos.objeto || campos.percentual) && <Ponto />}
            {campos.objeto && <Selo>{campos.objeto}</Selo>}
            {campos.percentual && <Selo>{campos.percentual}</Selo>}
            {lead.responsavel_nome && (
              <>
                <Ponto />
                <span className="text-texto-3" title="Responsável no Kommo">
                  resp. {lead.responsavel_nome}
                </span>
              </>
            )}
          </div>
        ) : (
          // TÍTULO FORA DO PADRÃO: cru, como sempre foi, com o aviso de que os
          // campos não foram separados — separar sem âncora (o número ou, sem
          // ele, a parcela cedida) inventaria um cedente.
          <p
            className="mt-1 flex items-start gap-1.5 text-xs text-texto-3"
            title="O título não segue o padrão intermediador - cedente - processo - objeto - percentual"
          >
            <Info className="mt-0.5 h-[14px] w-[14px] flex-none" aria-hidden />
            <span>
              Título fora do padrão — os campos não foram separados.
              {lead.responsavel_nome && <> · resp. {lead.responsavel_nome}</>}
            </span>
          </p>
        )}

        {resultadoAnalise && (
          <div className="mt-[10px] rounded-campo border border-borda bg-superficie-2 px-4 py-[10px] text-corpo">
            {/* OS RAMOS DE REPROVAÇÃO SAÍRAM: eles nunca renderizavam. Este
                painel só existe depois de `onSalvo`, e salvar exige
                `!atual.reprovado`. */}
            {resultadoAnalise.erro ? (
              <p className="flex items-start gap-2 text-perigo">
                <AlertTriangle className={cn(IC, 'mt-0.5')} aria-hidden />
                Erro: {resultadoAnalise.erro}
              </p>
            ) : (
              // O PAINEL DO CARD É UM RESUMO: os números, os links e a contagem
              // de alertas. O detalhe está na janela, que é onde se confere.
              <div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Selo tom="sucesso" icone={<Check className={icSelo} aria-hidden />}>
                    Planilha gerada
                  </Selo>
                  {typeof resultadoAnalise.drive_file_url === 'string' && (
                    <a
                      className="font-semibold text-marca-texto hover:underline"
                      href={resultadoAnalise.drive_file_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Abrir planilha
                    </a>
                  )}
                  {typeof resultadoAnalise.due_diligence_url === 'string' && (
                    <a
                      className="font-semibold text-marca-texto hover:underline"
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
                    <GradeValoresRpv valores={resultadoAnalise.valores} atingiuAlvo={resultadoAnalise.atingiu_alvo} />
                  </div>
                )}
                {/* A CONTAGEM, e não o texto: um número de alertas é lido de
                    relance e leva a abrir a janela. */}
                {(() => {
                  const alertas = (resultadoAnalise.avisos ?? []).filter((a) => String(a).trim().startsWith('⚠️')).length
                  if (!alertas) return null
                  return (
                    <p className="mt-2 flex items-center gap-1.5 text-sm text-aviso">
                      <AlertTriangle className="h-[14px] w-[14px]" aria-hidden />
                      {alertas === 1 ? '1 ponto de atenção' : `${alertas} pontos de atenção`}
                      <span className="text-texto-3">· abra a análise para ver</span>
                    </p>
                  )
                })()}
              </div>
            )}
          </div>
        )}

        {/* AS ETIQUETAS DO KOMMO, na linha de baixo — nas abas de `ABAS_COM_TAGS`.
            A ORDEM É A DA CASA (PJus, BTG, PX Ativos…), e não a do Kommo: fixa, a
            POSIÇÃO passa a informar. A COR SAI DO ATO (cotado verde, enviado
            azul, reprovado vermelho, pendente âmbar), com ícone, e a idade ao
            lado; a data exata no passar do mouse. O seletor fica no fim, e
            aparece mesmo no card que ainda não tem etiqueta. */}
        {mostrarTags && ((lead.tags ?? []).length > 0 || etiquetasOferecidas.length > 0) && (
          <div className="mt-[10px] flex flex-wrap items-center gap-1.5">
            {[...coresDasTags(ordenarEtiquetas(lead.tags ?? []))].map(([t, tom]) => {
              const quando = desdeQuandoAEtiqueta(lead.tags_em, t)
              const idade = idadeCurta(quando)
              return (
                <span key={t} title={quando ? `Desde ${formatDateTime(quando)}` : 'Etiqueta do Kommo'}>
                  <Badge size="sm" tone={tom} className="h-[22px] gap-1 px-2">
                    {iconeDaEtiqueta(tom)}
                    {/* O NOME DA CASA, e não a grafia que o card tem: "Enviado
                        PJUS", de antes de 01/10/2026, aparece como "Enviado PJus". */}
                    {etiquetaCanonica(t) ?? t}
                    {idade && <span className="font-medium opacity-80"> · {idade}</span>}
                  </Badge>
                </span>
              )
            })}
            {etiquetasOferecidas.length > 0 && (
              <SeletorDeEtiquetas
                oferecidas={etiquetasOferecidas}
                aplicadas={lead.tags ?? []}
                datas={lead.tags_em}
                emVoo={etiquetaEmVoo}
                onAlternar={(etiqueta, acao) => onEtiquetar(lead, etiqueta, acao)}
                onEditarCotacao={onEditarCotacao ? (etiqueta) => onEditarCotacao(lead, etiqueta) : undefined}
              />
            )}
          </div>
        )}

        {envioAosFundos && (
          <ChecksDosFundos
            lead={lead}
            fundos={envioAosFundos.fundos}
            ocupado={ocupado}
            movendo={statusEmAndamento === envioAosFundos.destino}
            onAbrir={(f) => envioAosFundos.onAbrir(lead, f)}
            onMover={() => envioAosFundos.onMover(lead)}
          />
        )}

        {/* COMO VAI O PREPARO DOS AUTOS, no card: enquanto lê, quando fica
            pronto, e sobretudo o que deu errado, com a mensagem inteira que a
            função respondeu (ver `PreparoDosAutos`). */}
        {preparoDosAutos && (
          <CaixaDeAviso
            className="mt-[10px] px-4 py-[10px]"
            tom={
              preparoDosAutos.estado === 'pronto'
                ? 'sucesso'
                : preparoDosAutos.estado === 'parcial'
                  ? 'aviso'
                  : preparoDosAutos.estado === 'falhou'
                    ? 'perigo'
                    : 'neutro'
            }
            icone={
              preparoDosAutos.estado === 'lendo' ? (
                <RefreshCw className={cn(IC, 'animate-spin')} aria-hidden />
              ) : preparoDosAutos.estado === 'fila' ? (
                <Clock className={IC} aria-hidden />
              ) : undefined
            }
          >
            {preparoDosAutos.estado === 'falhou' && (
              // O QUE A CONVERSA VAI DIZER, dito aqui primeiro: do outro lado o
              // Claude só sabe que não achou o código.
              <p className="font-bold">Os autos não subiram — o Claude não vai achá-los por este código.</p>
            )}
            {preparoDosAutos.estado === 'parcial' && (
              <p className="font-bold">Os autos chegaram incompletos ao Claude.</p>
            )}
            <p
              className={cn(
                'whitespace-pre-line break-words',
                (preparoDosAutos.estado === 'fila' || preparoDosAutos.estado === 'lendo') && 'text-texto-2',
              )}
            >
              {preparoDosAutos.detalhe}
            </p>
            {/* O RESGATE É UM BOTÃO, e não um download que acontece sozinho:
                quem decide encher a pasta de Downloads com o processo é quem
                opera. */}
            {preparoDosAutos.estado === 'falhou' && onBaixarAnexos && (
              <button type="button" onClick={() => onBaixarAnexos(lead)} className={cn(LINK_BTN, 'mt-1')}>
                Baixar os anexos para arrastar à conversa
              </button>
            )}
            {/* A SAÍDA DE EMERGÊNCIA DA PLANILHA, e só ela: se uma conversa
                entregar o bloco em vez de gravar, o bloco precisa ter para onde
                ir. Um link discreto aqui, e não um botão na fileira: é exceção. */}
            {planilhaDeReserva && (preparoDosAutos.estado === 'pronto' || preparoDosAutos.estado === 'parcial') && (
              <button type="button" onClick={() => onPreencherPlanilha?.(lead)} className={cn(LINK_BTN, 'mt-1')}>
                A planilha não foi gravada pelo Claude? Colar o bloco que ele entregou
              </button>
            )}
          </CaixaDeAviso>
        )}
        {analisandoJuridico && (
          <CaixaDeAviso tom="neutro" className="mt-[10px] px-4 py-[10px]" icone={<Clock className={IC} aria-hidden />}>
            ⏳ Rodando a análise jurídica antiga — a planilha vai para o Drive quando terminar.
          </CaixaDeAviso>
        )}
        {resultadoJuridico && (
          <CaixaDeAviso
            tom={resultadoJuridico.erro ? 'perigo' : 'sucesso'}
            className="mt-[10px] px-4 py-[10px]"
          >
            {resultadoJuridico.erro ? (
              <p>Erro: {resultadoJuridico.erro}</p>
            ) : (
              <div className="space-y-1.5">
                {/* A CONTAGEM VEM PRIMEIRO, e é a informação mais honesta: "62
                    de 85" diz de cara que 23 linhas ficaram para uma pessoa. */}
                <p>
                  ✅ {resultadoJuridico.origem === 'conversa' ? 'Planilha preenchida a partir da conversa' : 'Análise jurídica preenchida'} —{' '}
                  <strong>
                    {resultadoJuridico.linhas_preenchidas} de {resultadoJuridico.linhas_no_questionario}
                  </strong>{' '}
                  linhas do modelo.{' '}
                  {typeof resultadoJuridico.drive_file_url === 'string' && (
                    <a
                      className="font-semibold text-marca-texto hover:underline"
                      href={resultadoJuridico.drive_file_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Abrir planilha
                    </a>
                  )}
                </p>
                {resultadoJuridico.resumo && (
                  <p className="whitespace-pre-line text-xs text-texto-2">{resultadoJuridico.resumo}</p>
                )}
                {!!resultadoJuridico.avisos?.length && (
                  <ul className="space-y-1 text-xs text-aviso">
                    {resultadoJuridico.avisos.map((a, i) => (
                      <li key={i}>⚠️ {a}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </CaixaDeAviso>
        )}

        {/* A ÚLTIMA NOTA À VISTA (amostra): a mais recente, com data e selo do
            tipo, numa linha; "Ver histórico" abre o resto. */}
        {ultima && (
          <div className="mt-[10px] flex min-w-0 flex-wrap items-baseline gap-2 rounded-r-controle border-l-[3px] border-borda-forte bg-superficie-2 px-[10px] py-2 text-corpo text-texto-2 sm:flex-nowrap">
            {ultima.nota.criado_em && (
              <span className="flex-none text-xs text-texto-3">{formatDataHoraSegundos(ultima.nota.criado_em)}</span>
            )}
            {(() => {
              const arquivos = ehAnexo(ultima.nota) ? [ultima.nota, ...ultima.anexos] : ultima.anexos
              const selo =
                ehAnexo(ultima.nota) && arquivos.length > 1 ? `${arquivos.length} anexos` : rotuloDaNota(ultima.nota)
              const texto = ehAnexo(ultima.nota)
                ? arquivos.map(nomeDoAnexo).join(', ')
                : ultima.nota.texto || arquivos.map(nomeDoAnexo).join(', ')
              return (
                <>
                  {selo && <Selo className="flex-none">{selo}</Selo>}
                  <span className="min-w-0 truncate" title={texto}>
                    {texto}
                  </span>
                </>
              )
            })()}
          </div>
        )}

        <div className="mt-[10px] flex flex-wrap items-center gap-x-4 gap-y-1">
          {/* As anotações vêm em texto livre e o formato varia entre cards, então
              são exibidas cruas, recolhidas por padrão. A contagem no rótulo evita
              que anotação nova passe batida com o bloco fechado.
              SÓ A PARTIR DE DUAS NOTAS (amostra): com uma, o histórico é a
              própria linha da última nota, já à vista acima. */}
          {notas.length > 1 && (
            <button type="button" onClick={() => setAberto((v) => !v)} aria-expanded={aberto} className={LINK_BTN}>
              <History className={IC} aria-hidden />
              <span>
                {aberto ? 'Ocultar histórico' : 'Ver histórico'}
                {!aberto && posteriores > 0 && ` (+${posteriores})`}
              </span>
              <ChevronDown className={cn('h-[14px] w-[14px] transition-transform', aberto && 'rotate-180')} aria-hidden />
            </button>
          )}
          <a
            href={urlCard(lead.kommo_lead_id)}
            target="_blank"
            rel="noreferrer"
            className={cn(LINK_BTN, 'text-texto-3 hover:bg-superficie-3 hover:text-texto-2')}
          >
            <ExternalLink className={IC} aria-hidden />
            Abrir no Kommo
          </a>
          <DatasDoCard lead={lead} />
        </div>
      </div>

      {/* A ZONA DE AÇÕES, SEMPRE À DIREITA (amostra): o tempo na etapa em cima,
          os botões embaixo, a ação que avança em destaque e as outras
          contornadas. Em tela estreita desce para baixo do card. */}
      {/* NA GRADE DE 4/8 (revisão visual 2): 8px entre os botões, como em toda
          barra de controles (§0.1) — eram 4,5px, e a fileira que ganhou
          Justificativa, Certidões e Anotar parecia um bloco só. */}
      <div className="flex min-w-0 flex-row flex-wrap items-center justify-between gap-s3 min-[900px]:flex-col min-[900px]:items-end">
        {dias !== null && quandoNaEtapa && (
          <div
            className="leading-tight min-[900px]:text-right"
            title={`Na coluna desde ${formatDateTime(quandoNaEtapa)}`}
          >
            {/* O TEMPO NA ETAPA EM 14PX SEMIBOLD (auditoria visual, A2): em 18px
                negrito ele disputava com o nome do card, que é o que se lê
                primeiro. */}
            <span className="block text-xs text-texto-3">Nesta etapa</span>
            <span className={cn('text-corpo font-semibold tabular-nums', parado ? 'text-aviso' : 'text-texto')}>
              {textoDosDias(dias)}
            </span>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-end gap-s2 min-[900px]:mt-auto min-[900px]:max-w-[420px]">
          {/* A ANOTAÇÃO EM TODO CARD, de toda etapa e funil (30/09/2026). */}
          {onAnotar && <BotaoDeAnotacao leadId={lead.kommo_lead_id} onEnviar={(t) => onAnotar(lead, t)} />}

          {/* OS BOTÕES DE TRABALHO DEPENDEM DA ETAPA — a regra é `botoesDaAba`.
              A MESMA ORDEM NOS DOIS FUNIS: due diligence primeiro, análise
              depois — quem alterna entre as telas clica pela POSIÇÃO, e a ordem
              também é a do trabalho: apura-se antes de analisar. Due diligence
              nunca automática: o checklist depende de CPF e UF que uma pessoa
              confere no processo. */}
          {botoes !== 'nenhum' && (
            <Button
              size="sm"
              variant="secondary"
              className={BTN}
              icon={<ClipboardCheck className={IC} aria-hidden />}
              onClick={() => onDueDiligence(lead)}
              disabled={ocupado}
            >
              Due diligence
            </Button>
          )}

          {/* "Executar análise" do RPV: qualifica, extrai e PRECIFICA (deságio,
              prazo, preço de cessão). EM DESTAQUE na Análise, onde é a ação que
              avança; contornado na Revisão, onde o desfecho é que avança. */}
          {botoes === 'rpv' && (
            <Button
              size="sm"
              // CONTORNADO TAMBÉM COM O CONCLUIR (a Revisão do RPV, onda 4):
              // lá o desfecho é que avança. ONDE ELE AVANÇA, o secundário em
              // azul da ação da etapa (AP2), e não mais o primário cheio.
              variant="secondary"
              className={cn(BTN, !((desfechoNoCard && acoes.length > 0) || onConcluir) && ACAO_DA_ETAPA)}
              icon={<FileSearch className={IC} aria-hidden />}
              onClick={() => onAnalisar(lead)}
              loading={analisando}
              disabled={ocupado || analisando}
            >
              {analisando ? 'Analisando…' : 'Executar análise'}
            </Button>
          )}

          {/* A ANÁLISE DO PRECATÓRIO ACONTECE FORA DAQUI, e o botão é a porta:
              abre uma conversa no Claude, que vem buscar os autos pelo conector.
              A LEITURA DOS AUTOS NÃO TRAVA O CARD: cada clique abre outra
              conversa (serve a quem fechou a primeira) e a leitura entra na fila;
              o ícone só gira. */}
          {botoes === 'dd' && (
            <Button
              size="sm"
              variant="secondary"
              className={BTN}
              icon={
                lendoAutos ? (
                  <RefreshCw className={cn(IC, 'animate-spin')} aria-hidden />
                ) : (
                  <Sparkles className={IC} aria-hidden />
                )
              }
              onClick={() => onAnaliseExterna(lead)}
              disabled={ocupado}
              title={lendoAutos ? 'Os autos deste card estão sendo lidos — clicar de novo abre outra conversa' : undefined}
            >
              Executar análise
            </Button>
          )}

          {/* CONCLUIR FECHA A ETAPA, e fica à direita da análise porque é o que
              vem depois dela. O AZUL DA MARCA: concluir também é recusar, e
              verde ficaria errado. EM TODA ABA DE TRABALHO, e não só nas de 'dd':
              a Revisão do RPV ('rpv') o ganha na onda 4 — para todos desde
              03/10/2026. As abas agrupadas, e a porta de cada uma ('dd' ou
              'rpv'), estão em matrizDeMovimentos.test.ts. */}
          {botoes !== 'nenhum' && onConcluir && (
            <Button
              size="sm"
              variant="secondary"
              className={cn(BTN, ACAO_DA_ETAPA)}
              icon={<CheckCircle2 className={IC} aria-hidden />}
              onClick={() => onConcluir(lead)}
              disabled={ocupado}
            >
              Concluir
            </Button>
          )}

          {/* OS DESFECHOS NO CARD onde eles moram no card (a Revisão do RPV, o
              Sanar da Diligência do Externo). Cores em vez de hierarquia: são
              alternativas legítimas, e verde/âmbar/vermelho se lê mais rápido
              que o rótulo. Trava as outras ações do card enquanto uma corre:
              duas movimentações simultâneas no mesmo card se atropelariam. */}
          {acoes.length > 0 &&
            desfechoNoCard &&
            acoes.map((a) => (
              <Button
                key={a.statusId}
                size="sm"
                variant={a.variant}
                className={BTN}
                icon={ICONES[a.papel]}
                onClick={() => onAcao(lead, a)}
                loading={statusEmAndamento === a.statusId}
                disabled={ocupado}
              >
                {a.label}
              </Button>
            ))}

          {anexarEMover && (
            <BotaoAnexarEMover
              rotulo={anexarEMover.rotulo}
              soMover={anexarEMover.soMover}
              ocupado={ocupado}
              onEnviar={(arquivo, onAndamento) => anexarEMover.onEnviar(lead, arquivo, onAndamento)}
            />
          )}

          {onEscolherProposta && (
            <BotaoEscolherProposta
              lead={lead}
              ocupado={ocupado}
              carregando={ocupado}
              onEscolher={(f) => onEscolherProposta(lead, f)}
            />
          )}

          {/* AS CERTIDÕES (a Obtenção de documentação do Externo): é trabalho,
              como a due diligence, e não desfecho. */}
          {onCertidoes && (
            <Button
              size="sm"
              variant="secondary"
              className={BTN}
              icon={<ScrollText className={IC} aria-hidden />}
              onClick={() => onCertidoes(lead)}
              disabled={ocupado}
            >
              Certidões
            </Button>
          )}

          {/* A JUSTIFICATIVA TÉCNICA (a Produção de proposta dos três funis):
              trabalho, não desfecho — o card não se move. Enviada, o botão
              vira o cheque, que reabre o texto enviado. */}
          {justificativa && (
            <BotaoJustificativa
              resumo={justificativa.resumo}
              ocupado={ocupado}
              onAbrir={() => justificativa.onAbrir(lead)}
            />
          )}

          {/* A NEGOCIAÇÃO (onda 4, para todos desde 03/10/2026): o cedente respondeu. O negativo
              contornado à esquerda, o positivo em destaque à direita (amostra). */}
          {negociacao && (negociacao.opcoes.naoFechou || negociacao.opcoes.semResposta) && (
            <Button
              size="sm"
              variant="outline"
              className={cn(BTN, PERIGO_CONTORNADO)}
              icon={<X className={IC} aria-hidden />}
              onClick={() => negociacao.onNaoFechou(lead)}
              disabled={ocupado}
            >
              Não fechou
            </Button>
          )}
          {negociacao?.opcoes.fechado && (
            <BotaoFechado
              acao={negociacao.opcoes.fechado}
              cedente={campos?.cedente ?? tituloCard(lead)}
              destino={negociacao.destinoDoFechado}
              ocupado={ocupado}
              onConfirmar={(nota) => negociacao.onFechado(lead, nota)}
            />
          )}

          {/* "GERAR CONTRATO" (onda 4, para todos desde 03/10/2026): abre a Geração de contratos com
              este card no endereço. Não move o card. */}
          {onGerarContrato && (
            <Button
              size="sm"
              variant="secondary"
              className={cn(BTN, ACAO_DA_ETAPA)}
              icon={<FileSignature className={IC} aria-hidden />}
              onClick={() => onGerarContrato(lead)}
              disabled={ocupado}
              title="Abre a Geração de contratos com o processo e o originador deste card"
            >
              Gerar contrato
            </Button>
          )}
        </div>
      </div>

      {aberto && notas.length > 0 && (
        <div className="col-span-full mt-1 border-t border-borda pt-3">
          {/* A LINHA DO TEMPO (amostra), da mais antiga à mais nova. O ANEXO
              VOLTA PARA A ANOTAÇÃO DELE: no Kommo o arquivo é uma nota separada,
              sem texto, escrita segundos antes ou depois do comentário que o
              explica. Ver historicoDeNotas.ts. */}
          <ol className="m-0 list-none pl-1">
            {grupos.map(({ nota: n, anexos }, i) => {
              // O ANEXO ÓRFÃO É O PRÓPRIO BLOCO: a nota de arquivo não tem texto
              // no Kommo, e exibi-la como parágrafo fazia um nome de arquivo
              // ocupar um bloco inteiro.
              const arquivos = ehAnexo(n) ? [n, ...anexos] : anexos
              const corpo = ehAnexo(n) ? '' : n.texto
              // "3 anexos" em vez de "anexo" quando o bloco é só de arquivos.
              const selo = ehAnexo(n) && arquivos.length > 1 ? `${arquivos.length} anexos` : rotuloDaNota(n)
              const ultimo = i === grupos.length - 1
              return (
                <li key={n.id || i} className="relative pb-[14px] pl-[22px]">
                  <span
                    aria-hidden
                    className={cn(
                      'absolute left-1 top-1.5 h-[9px] w-[9px] rounded-full border-2 bg-superficie',
                      n.automatica || (n.tipo && n.tipo !== 'common') ? 'border-texto-3' : 'border-marca-viva',
                    )}
                  />
                  {!ultimo && <span aria-hidden className="absolute bottom-0 left-2 top-[18px] w-px bg-borda" />}
                  {/* DATA COM HORA, MINUTO E SEGUNDO: as anotações chegam em
                      rajada, e só com a data some da tela a ORDEM. SEM AUTOR: a
                      equipe usa um login só e se identifica no próprio texto. */}
                  <div className="flex flex-wrap items-center gap-2">
                    {n.criado_em && (
                      <span className="text-xs text-texto-3">{formatDataHoraSegundos(n.criado_em)}</span>
                    )}
                    {/* DE QUEM É A NOTA, quando não é do comercial: sem o selo,
                        uma ficha redigida pela análise se leria como declaração
                        de quem cadastrou o card. */}
                    {selo && <Selo>{selo}</Selo>}
                  </div>
                  {corpo && (
                    <pre
                      className={cn(
                        'mt-0.5 whitespace-pre-wrap break-words font-sans text-corpo',
                        n.automatica ? 'text-texto-3' : 'text-texto-2',
                      )}
                    >
                      {corpo}
                    </pre>
                  )}
                  {arquivos.length > 0 && (
                    <div className="mt-1 flex flex-wrap items-start gap-1.5">
                      {arquivos.map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => onAbrirAnexo(lead, a)}
                          // 200 ms ANTES DE COMEÇAR: quem passa o mouse por cima
                          // a caminho de outro lugar não dispara consulta.
                          onMouseEnter={() => aoMirarAnexo(a)}
                          onMouseLeave={cancelarMira}
                          onFocus={() => onPrepararAnexo(lead, a)}
                          title={
                            a.criado_em
                              ? `Anexado em ${formatDataHoraSegundos(a.criado_em)} — clique para abrir`
                              : 'Clique para abrir'
                          }
                          className="inline-flex min-h-[26px] max-w-full items-center gap-1.5 rounded-controle border border-borda bg-superficie px-2 py-0.5 text-sm font-medium text-marca-texto hover:bg-marca-leve"
                        >
                          <Paperclip className="h-[14px] w-[14px] shrink-0" aria-hidden />
                          <span className="break-all text-left">{nomeDoAnexo(a)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              )
            })}
          </ol>
        </div>
      )}
    </article>
  )
}

/**
 * O CONTROLE SEGMENTADO da amostra (`.seg`): para o tipo de crédito, a destinação
 * e a densidade. A contagem só no escolhido — o outro funil fica sem número até
 * ser aberto: melhor sem número que com número errado.
 *
 * VIVE NESTA TELA, e não em components/ui: o Segmented de lá não leva ícone e
 * mostra a contagem em todos. Se aparecer um segundo consumidor, promove.
 */
function Seg<K extends string>({
  rotulo,
  itens,
  valor,
  onChange,
  className,
}: {
  rotulo: string
  itens: { key: K; label: string; icone?: ReactNode; n?: number }[]
  valor: K
  onChange: (k: K) => void
  className?: string
}) {
  return (
    <div
      role="group"
      // O ÚNICO rótulo do controle: sem isto o leitor de tela anuncia botões soltos.
      aria-label={rotulo}
      // 36PX, COMO O SEGMENTADO DE ui E A BUSCA AO LADO (auditoria visual, A3):
      // o trilho com 3px de folga e as opções de 28px. Eram 39px contra os 35px
      // da busca, na mesma linha.
      className={cn('inline-flex gap-s0.5 rounded-campo border border-borda bg-superficie-3 p-[3px]', className)}
    >
      {itens.map((it) => {
        const ativo = it.key === valor
        return (
          <button
            key={it.key}
            type="button"
            aria-pressed={ativo}
            onClick={() => onChange(it.key)}
            className={cn(
              'inline-flex h-controle-sm items-center gap-s1.5 whitespace-nowrap rounded-controle px-s3 text-sm font-semibold transition-colors',
              ativo ? 'bg-superficie text-marca-texto shadow-nivel-1' : 'text-texto-2 hover:text-texto',
            )}
          >
            {it.icone}
            {it.label}
            {it.n !== undefined && (
              <span
                className={cn(
                  'rounded-full px-s1.5 text-xs tabular-nums',
                  ativo ? 'bg-marca-suave text-marca-texto' : 'bg-superficie-3 text-texto-2',
                )}
              >
                {it.n}
              </span>
            )}
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
  //
  // O LUGAR DA ÚLTIMA VISITA (amostra): funil, destinação e etapa voltam como a
  // pessoa deixou. Lido UMA VEZ, na montagem; o `?card=` vem depois e manda mais.
  const [lugarInicial] = useState(lugarGuardado)
  const [funil, setFunil] = useState<number>(lugarInicial.funil)
  const leads = useKommoLeads(funil)
  const etapas = useKommoEtapas()
  const prontas = useAnalisesProntas()
  /**
   * Os pares (card, coluna) já movidos nesta sessão.
   *
   * Serve a `moverComNota`, que tem duas fases — mover e anotar — e só a
   * segunda é segura de repetir. Ver lá.
   */
  const jaMovidos = useRef<Set<string>>(new Set())

  // SEM ETAPA GUARDADA, 'pendentes' (a Análise do RPV), como sempre foi; uma
  // etapa que não existe mais cai na primeira com função (ver `abaAtual`).
  const [aba, setAba] = useState<string>(lugarInicial.etapa || 'pendentes')
  // Destinação do precatório. Só tem efeito no funil de Precatórios; em RPV o
  // valor fica guardado e ignorado, para voltar ao mesmo lugar na troca de funil.
  const [subdivisao, setSubdivisao] = useState<SubdivisaoPrecatorio>(lugarInicial.destinacao)
  useEffect(() => {
    guardarLugar({ funil, destinacao: subdivisao, etapa: aba })
  }, [funil, subdivisao, aba])
  const [busca, setBusca] = useState('')
  // OS FILTROS RÁPIDOS, A ORDEM E O "MOSTRAR MAIS" (itens "Novo" da amostra).
  // Só estado da tela: trocar de etapa volta tudo ao padrão (ver `irParaAba`).
  const [filtro, setFiltro] = useState<FiltroRapido>('todos')
  // A ORDEM, ESTA SIM, LEMBRADA ENTRE VISITAS (ver `lerOrdem`).
  const [ordem, setOrdem] = useState<OrdemDaLista>(() => lerOrdem(lerPreferencia<unknown>(PREF_ORDEM_DA_ANALISE, 'recente')))
  const [mostrar, setMostrar] = useState(POR_VEZ)
  // J E K ANDAM ENTRE OS CARDS (ver `passoDaTecla`): só o foco se move — nenhum
  // card abre, nenhum botão é apertado. Fora de campo e de janela, como o "/".
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      const passo = passoDaTecla(e)
      if (passo === null || estaDigitando(e.target as HTMLElement | null) || haDialogoAberto()) return
      const cards = [...document.querySelectorAll<HTMLElement>('article[data-lead]')]
      const atual = cards.findIndex((c) => c.contains(document.activeElement))
      const i = proximoCard(cards.length, atual, passo)
      if (i === null) return
      e.preventDefault()
      cards[i].focus({ preventScroll: true })
      cards[i].scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
    document.addEventListener('keydown', aoTeclar)
    return () => document.removeEventListener('keydown', aoTeclar)
  }, [])
  // "/" LEVA À BUSCA (amostra), fora de campo e de janela. DESDE A AUDITORIA
  // VISUAL (03/10/2026) quem faz isso é o atalho comum da moldura
  // (layout/Consultas), pelo `data-filtro-tela` que o CampoDeBusca põe: a mesma
  // regra — não age com alguém digitando nem com janela aberta. Dois ouvintes
  // para a mesma tecla seriam dois lugares para a regra divergir.
  /** Abre uma etapa: o filtro e o "Mostrar mais" voltam ao padrão. */
  const irParaAba = (key: string) => {
    setAba(key)
    setFiltro('todos')
    setMostrar(POR_VEZ)
  }
  // Ação em curso, para o botão certo do card certo mostrar o spinner — o
  // destino, POR CARD (ver lib/emCursoPorCard.ts).
  const [emAndamento, setEmAndamento] = useState<PorCard<number>>({})
  /**
   * A MESMA TRAVA, SÍNCRONA. O estado só chega aos botões no render seguinte;
   * o ref vale já no clique, e é o que garante que um card não recebe duas
   * movimentações ao mesmo tempo, venha o segundo clique de onde vier.
   */
  const cardsTravados = useRef<Set<number>>(new Set())
  // Análise automática (Judit + due diligence + planilha) por card.
  // `isAdmin` VAI PARA `abasDoFunil`, que libera o que é `soAdmin`. OS BOTÕES DA
  // ONDA 4 (os que movem card de um jeito novo e o "Gerar contrato") são de TODO
  // MUNDO desde 03/10/2026 (`BOTOES_NOVOS_PARA_TODOS`, ver `abaParaQuemVe`); o
  // `isAdmin` segue passado para o próximo lançamento por etapas.
  const { user: authUser, profile: authProfile, isAdmin } = useAuth()
  const analistaNome = authProfile?.nome || authUser?.email || 'Usuário'
  // A análise de RPV abre uma JANELA (AnaliseRpvModal): preliminar, conversa e
  // só então o salvamento. `rpvLead` é o card cuja janela está aberta.
  const [rpvLead, setRpvLead] = useState<KommoLead | null>(null)
  // POR CARD, como as movimentações (lib/emCursoPorCard.ts): com um id só, a
  // análise do card A terminando apagava o "rodando" do card B, ainda no ar.
  const [analisandoJur, setAnalisandoJur] = useState<PorCard<true>>({})
  /** A mesma trava, síncrona: a análise jurídica antiga é paga (IA), uma por card. */
  const juridicasNoAr = useRef<Set<number>>(new Set())
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
  const lerUmaVezSo = useCallback((
    lead: KommoLead,
    aoProgresso?: (feitos: number, total: number, nome: string) => void,
  ): Promise<ArquivoLido[]> => {
    const id = lead.kommo_lead_id
    const emVoo = leiturasEmVoo.current.get(id)
    if (emVoo) return emVoo
    const p = lerArquivosDoCard(lead, aoProgresso).finally(() => leiturasEmVoo.current.delete(id))
    leiturasEmVoo.current.set(id, p)
    return p
  }, [])
  const [ddLead, setDdLead] = useState<KommoLead | null>(null)
  const [certLead, setCertLead] = useState<KommoLead | null>(null)
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

  /**
   * As verbas que a due diligence RECUSOU, por card.
   *
   * Lido antes de abrir a janela, e não durante: o seletor de cenário nasce com
   * `useState(dadosDoCard.tipo_aquisicao)`, então um valor que chegasse depois
   * não seria adotado — a análise precificaria a verba recusada.
   */
  const [verbasRecusadas, setVerbasRecusadas] = useState<Record<number, PapelApurado[]>>({})

  /**
   * O ÚLTIMO CARD cuja análise foi pedida. A janela só abre depois de uma
   * consulta ao banco; clicando em dois cards seguidos, a resposta do primeiro
   * podia chegar depois e abrir a janela do card errado.
   */
  const analisePedida = useRef<number | null>(null)

  async function onAnalisar(lead: KommoLead) {
    analisePedida.current = lead.kommo_lead_id
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

    // O QUE A DILIGÊNCIA JÁ RECUSOU, antes de a janela abrir.
    //
    // Recusada a verba de um titular, ela está fora da cessão: analisar o card
    // como se ele ainda cedesse as duas precificaria um crédito que a casa
    // acabou de dizer que não compra. Falha de leitura não impede analisar — o
    // cenário fica o do card, que é o comportamento de sempre.
    const { data: recusadas } = await supabase
      .from('dd_historico')
      .select('papel')
      .eq('kommo_lead_id', lead.kommo_lead_id)
      .not('reprovado_em', 'is', null)
    if (analisePedida.current !== lead.kommo_lead_id) return
    setVerbasRecusadas((p) => ({
      ...p,
      [lead.kommo_lead_id]: ((recusadas ?? []) as { papel: string }[])
        .map((r) => String(r.papel))
        .filter((x): x is PapelApurado => x === 'CEDENTE' || x === 'ADVOGADO'),
    }))
    setRpvLead(lead)
  }

  /**
   * A ANÁLISE DO PRECATÓRIO EXTERNO: abre a conversa no Claude e baixa os anexos.
   *
   * DUAS METADES, porque só duas são possíveis. Não existe forma de anexar
   * arquivo a uma conversa do claude.ai por link — nem parâmetro de URL, nem
   * área de transferência (o navegador só deixa escrever texto e imagem no
   * clipboard, não PDF). O anexo entra pela mão de quem conversa. Então o botão
   * abre a conversa com a pergunta pronta E baixa os arquivos do card, para o
   * arrasto ser um gesto só.
   *
   * A ABA ABRE PRIMEIRO, e isto não é ordem arbitrária: abrir janela depois de um
   * `await` é bloqueado como popup. A pergunta sai do título, que já está na
   * memória, então nada precisa ser esperado antes de abrir.
   */
  const [preparoDosAutos, setPreparoDosAutos] = useState<Record<number, PreparoDosAutos>>({})
  const anotarPreparo = (id: number, estado: PreparoDosAutos['estado'], detalhe: string) =>
    setPreparoDosAutos((p) => ({ ...p, [id]: { estado, detalhe } }))

  function onAnaliseExterna(lead: KommoLead) {
    // O CÓDIGO NASCE AQUI, ANTES DE QUALQUER `await`, e é isso que deixa o
    // clique síncrono: o esquema `claude://` só é aceito com a ativação do
    // gesto valendo, e ela morre na primeira espera. Gerar um uuid não espera
    // nada, então a conversa abre na hora e os autos correm atrás.
    const codigo = crypto.randomUUID()
    const prompt = promptDaAnaliseExterna(lerTituloCard(tituloCard(lead)), codigo)
    // O ESQUEMA PRECISA DE UM CLIQUE DE VERDADE, e é por isso que sai de um <a>
    // e não de `location.href`: navegação programática para esquema externo é
    // recusada por algumas versões do Chrome, e o clique sintético num link
    // carrega a ativação do gesto que ainda está valendo.
    const link = document.createElement('a')
    link.href = urlDoClaude(prompt)
    link.click()
    enfileirarAutos(lead, codigo)
    void criarPastaDoCard(lead)
  }

  /** O card passa a ter a pasta do Drive: o título vira link na mesma hora. */
  function anotarPastaNoCard(leadId: number, pastaId: string | undefined) {
    if (!pastaId) return
    qc.setQueriesData<KommoLead[]>({ queryKey: ['kommo_leads'] }, (antes) =>
      antes?.map((l) => (l.kommo_lead_id === leadId ? { ...l, drive_pasta_id: pastaId } : l)),
    )
  }

  /**
   * A PASTA DO CEDENTE NASCE NO CLIQUE, e não no fim — ideia da equipe
   * (28/09/2026). Quem abre a conversa com o Claude já tem, no título do card,
   * o caminho para onde o resultado vai; e qualquer arquivo da análise tem casa
   * antes de existir. É a mesma pasta em que a planilha é salva depois.
   *
   * EM PARALELO E SEM TRAVAR NADA: a conversa já abriu, os autos já estão na
   * fila. Se a pasta falhar, a análise segue — só o atalho fica para depois.
   */
  async function criarPastaDoCard(lead: KommoLead) {
    if (lead.drive_pasta_id) return
    const dados = lerCardCredijuris(lead)
    if (!dados.cedente.trim()) return
    try {
      const r = await invokeFunction<{ pasta_id?: string }>('pasta-do-cedente', {
        kommo_lead_id: lead.kommo_lead_id,
        originador: dados.intermediador,
        cedente: dados.cedente,
      })
      anotarPastaNoCard(lead.kommo_lead_id, r.pasta_id)
    } catch (e) {
      toast.error('A análise seguiu, mas não consegui criar a pasta no Drive: ' + ((e as Error)?.message ?? String(e)))
    }
  }

  // ------------------------------------------------ A FILA DAS ANÁLISES EXTERNAS
  //
  // POR QUE FILA. Cada clique em "Executar análise" abre uma conversa no Claude
  // e manda ler os PDFs do card — e os PDFs daqui são grandes. Disparadas juntas,
  // as leituras disputavam o mesmo processador e TODAS terminavam tarde; cada
  // conversa esperava pelos seus autos, desistia, e às vezes seguia sem eles.
  // Em fila, a primeira termina cedo e a sua conversa começa, enquanto as de
  // trás esperam — sabendo que esperam, porque o conector diz a posição.
  //
  // DUAS DE CADA VEZ, e não uma: boa parte da leitura é download do Kommo, que
  // espera a rede e não o processador. Com duas, o download de uma corre
  // enquanto a outra lê.
  //
  // A FILA VIVE NA PÁGINA, e não no card: fechar uma janela ou trocar de aba
  // dentro da plataforma não a interrompe. Fechar ou recarregar a ABA DO
  // NAVEGADOR interrompe — e para isso há a guarda do `beforeunload` abaixo, e o
  // batimento que deixa o conector perceber quando ela morreu.
  const MAX_LEITURAS_SIMULTANEAS = 2
  const filaDosAutos = useRef<{ lead: KommoLead; codigo: string }[]>([])
  const andamentoDosAutos = useRef(
    new Map<string, { leadId: number; estado: string; progresso: Record<string, unknown> }>(),
  )
  const leiturasCorrendo = useRef(0)

  /** Anota o andamento de uma análise, e o manda já — quando a mudança importa. */
  function anotarAndamento(
    codigo: string,
    leadId: number,
    estado: string,
    progresso: Record<string, unknown>,
    enviarJa = false,
  ) {
    andamentoDosAutos.current.set(codigo, { leadId, estado, progresso })
    if (enviarJa) {
      void invokeFunction('autos-guardar', {
        acao: 'progresso',
        itens: [{ codigo, estado, progresso }],
      }).catch(() => undefined)
    }
  }

  /** Diz a cada card na fila quantas análises estão à frente dele. */
  function renumerarFila() {
    filaDosAutos.current.forEach((job, i) => {
      const naFrente = i + leiturasCorrendo.current
      anotarPreparo(
        job.lead.kommo_lead_id,
        'fila',
        naFrente > 0
          ? `Na fila: ${naFrente} análise(s) à frente. A conversa do Claude já está aberta e espera os autos.`
          : 'Começando a leitura…',
      )
      anotarAndamento(job.codigo, job.lead.kommo_lead_id, 'fila', { etapa: 'fila', na_frente: naFrente })
    })
  }

  function enfileirarAutos(lead: KommoLead, codigo: string) {
    const naFrente = filaDosAutos.current.length + leiturasCorrendo.current
    // A RESERVA VAI JÁ, antes da leitura: é ela que diz ao conector que este
    // código existe e está a caminho. Sem ela, "não achei" continuaria
    // significando três coisas diferentes.
    void invokeFunction('autos-guardar', {
      acao: 'reservar',
      codigo,
      lead_id: lead.kommo_lead_id,
      titulo: tituloCard(lead),
      na_frente: naFrente,
    }).catch(() => undefined)
    filaDosAutos.current.push({ lead, codigo })
    processarFila()
  }

  function processarFila() {
    while (leiturasCorrendo.current < MAX_LEITURAS_SIMULTANEAS && filaDosAutos.current.length > 0) {
      const job = filaDosAutos.current.shift()!
      leiturasCorrendo.current++
      void depositarAutos(job.lead, job.codigo).finally(() => {
        leiturasCorrendo.current--
        andamentoDosAutos.current.delete(job.codigo)
        processarFila()
      })
    }
    renumerarFila()
  }

  // O BATIMENTO: a cada 45 segundos, o andamento de TODAS as análises pendentes
  // numa chamada só. É o que mantém vivo, do lado do conector, o sinal de que a
  // leitura continua — parado há mais de três minutos, ele conclui que a aba
  // morreu e manda o Claude parar em vez de esperar para sempre.
  useEffect(() => {
    const t = window.setInterval(() => {
      const itens = [...andamentoDosAutos.current.entries()].map(([codigo, a]) => ({
        codigo,
        estado: a.estado,
        progresso: a.progresso,
      }))
      if (itens.length === 0) return
      void invokeFunction('autos-guardar', { acao: 'progresso', itens }).catch(() => undefined)
    }, 45_000)
    return () => window.clearInterval(t)
  }, [])

  // A GUARDA DA ABA. Fechar ou recarregar com leitura em curso entrega ao
  // Claude autos pela metade — ou nenhum. O navegador pergunta antes; a frase
  // própria ele não mostra mais, mas a pergunta basta para evitar o acidente.
  useEffect(() => {
    const aoSair = (e: BeforeUnloadEvent) => {
      if (filaDosAutos.current.length === 0 && leiturasCorrendo.current === 0) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', aoSair)
    return () => window.removeEventListener('beforeunload', aoSair)
  }, [])

  /**
   * Põe os autos no balcão, para o Claude vir buscá-los pelo conector.
   *
   * DEPOIS DE ABRIR A CONVERSA, e não antes — a leitura dos PDFs leva segundos e
   * o aplicativo não pode esperar por ela. A corrida está prevista do outro
   * lado: a ferramenta do conector espera o depósito chegar antes de dizer que
   * não achou.
   *
   * QUEM LÊ O PDF É ESTE NAVEGADOR, com pdf.js, como em toda a plataforma — e
   * pelo mesmo cache que a due diligence usa, então um card já aberto não é
   * lido duas vezes. Para o servidor vai só o TEXTO.
   */
  async function depositarAutos(lead: KommoLead, codigo: string) {
    const id = lead.kommo_lead_id
    anotarPreparo(id, 'lendo', 'Lendo os PDFs do card. Num processo grande isto leva um minuto.')
    anotarAndamento(codigo, id, 'lendo', { etapa: 'lendo', feitos: 0, total: 0 }, true)
    try {
      const lidos = await lerArquivosComCache(lead, (feitos, total, nome) => {
        anotarPreparo(id, 'lendo', `Lendo os PDFs do card: ${feitos} de ${total} — ${nome}`)
        anotarAndamento(codigo, id, 'lendo', { etapa: 'lendo', feitos, total })
      })
      // AS PÁGINAS QUE SERÃO VISTAS SÃO ESCOLHIDAS ANTES DO DEPÓSITO, e não
      // depois. O índice da entrega sai no instante em que o texto chega, e
      // precisa já anunciar o que está a caminho em imagem — senão ele descreve
      // o acórdão digitalizado como ilegível, e a análise segue sem ele. Que foi
      // exatamente o defeito: dezenove anexos no card, dezessete na análise.
      // COM A PARTE GARANTIDA DE CADA ARQUIVO (ver LIMITES_DO_CONECTOR): o
      // processo grande não gasta o teto sozinho e deixa o extrato sem página.
      const selecao = escolherPaginasParaImagem(lidos, LIMITES_DO_CONECTOR)
      const anexosDeImagem = lidos.flatMap((a) => (a.anexoDeImagem ? [{ nome: a.nome, blob: a.anexoDeImagem }] : []))

      // AS IMAGENS VÃO ANTES DO TEXTO, e numa gravação só com ele — desde
      // 27/09/2026. Antes o texto ia primeiro e as imagens depois, por uma
      // segunda função que BAIXAVA O BALCÃO INTEIRO (todo o texto do processo)
      // só para pendurar nele o caminho de dez páginas, e o GRAVAVA INTEIRO DE
      // VOLTA. Com processo de milhares de páginas, era essa segunda viagem que
      // quebrava — e a quebra derrubava a entrega toda como "falhou".
      //
      // E A FALHA DAS IMAGENS NÃO É MAIS A FALHA DE TUDO: página que não subiu
      // vai para o aviso, e o texto segue. Antes ela caía no mesmo tratamento de
      // um depósito que não aconteceu.
      let prontas: ImagemSubida[] = []
      let falhasDeImagem: string[] = []
      if (selecao.length > 0 || anexosDeImagem.length > 0) {
        const totalImg = selecao.reduce((n, s) => n + s.numeros.length, 0) + anexosDeImagem.length
        anotarPreparo(id, 'lendo', `Preparando ${totalImg} página(s) em imagem para o Claude ver…`)
        try {
          const { data: { user } } = await supabase.auth.getUser()
          if (!user) {
            falhasDeImagem.push('sessão expirada — entre de novo para subir as páginas digitalizadas')
          } else {
            const envio = await subirImagensDosAutos(selecao, codigo, user.id, (feitas, t) =>
              anotarPreparo(id, 'lendo', `Preparando páginas digitalizadas: ${feitas}/${t}…`),
            )
            prontas = envio.prontas
            falhasDeImagem = envio.falhas
            // OS ANEXOS EM IMAGEM (foto, print do extrato), cada um uma página.
            if (anexosDeImagem.length > 0) {
              const dosAnexos = await subirAnexosDeImagem(anexosDeImagem, codigo, user.id)
              prontas = [...prontas, ...dosAnexos.prontas]
              falhasDeImagem = [...falhasDeImagem, ...dosAnexos.falhas]
            }
          }
        } catch (e) {
          falhasDeImagem.push((e as Error)?.message ?? String(e))
        }
      }
      const imagensDo = (nome: string) =>
        prontas.filter((p) => p.arquivo === nome).map((p) => ({ pagina: p.pagina, caminho: p.caminho }))
      const imagemDoAnexo = new Set(
        anexosDeImagem.filter((a) => prontas.some((p) => p.arquivo === a.nome)).map((a) => a.nome),
      )

      anotarPreparo(id, 'lendo', 'Entregando os autos ao Claude…')
      // A RESPOSTA É LIDA, e antes não era. Ela sempre disse o que ficou de
      // fora; jogá-la fora fazia a tela afirmar uma entrega completa que não
      // aconteceu.
      const r = await invokeFunction<{
        guardados?: number
        com_texto?: number
        caracteres?: number
        paginas?: number
        de_fora?: string[]
        sem_texto?: { nome: string; motivo: string; imagens: number }[]
      }>('autos-guardar', {
        codigo,
        lead_id: lead.kommo_lead_id,
        titulo: tituloCard(lead),
        // PÁGINA A PÁGINA, e não o bloco colado. O pdf.js já devolve assim, e
        // era essa a informação que se perdia: o roteiro exige a PÁGINA como
        // fonte de todo campo da ficha, e sem ela a citação virava estimativa.
        // Os `bytes` do PDF continuam fora — são megabytes e não têm o que
        // fazer no servidor.
        arquivos: lidos.map((a) => ({
          nome: a.nome,
          paginas: a.paginas,
          paginasTexto: a.paginasTexto ?? (a.texto ? [a.texto] : []),
          // O DIAGNÓSTICO VIAJA JUNTO. Sem ele o servidor não distingue um
          // escaneado de um download que falhou, e a análise recebe os dois com
          // a mesma etiqueta — sendo que só um deles tem conserto.
          digitalizado: a.digitalizado,
          erro: imagemDoAnexo.has(a.nome) ? '' : (a.erro ?? ''),
          // AS IMAGENS JÁ PRONTAS, e não mais a promessa delas: nada fica "a
          // caminho" depois do depósito, e o conector não precisa esperar.
          imagens: imagensDo(a.nome),
          // O ANEXO EM IMAGEM é um arquivo de uma página só, e ela é imagem.
          ...(imagemDoAnexo.has(a.nome) ? { imagem: true, paginas: 1 } : {}),
        })),
      })

      const guardados = r.guardados ?? lidos.length
      const comTexto = r.com_texto ?? guardados
      const deFora = r.de_fora ?? []
      const semTexto = r.sem_texto ?? []
      const num = (n: number) => n.toLocaleString('pt-BR')

      // O QUE FALTOU, NOMEADO. "Parte não foi entregue" sem dizer qual parte
      // obriga quem opera a descobrir sozinho — e foi assim que um processo de
      // 341 páginas chegou pela metade sem ninguém notar.
      const semLeitura = semTexto.filter((s) => !prontas.some((p) => p.arquivo === s.nome))
      const linhas = [
        `${comTexto} arquivo(s) com texto à disposição do Claude` +
          (r.paginas ? `, ${num(r.paginas)} páginas` : '') +
          '.',
        ...(prontas.length > 0
          ? [`${prontas.length} página(s) digitalizada(s) subiram como imagem — o Claude as vê por lá.`]
          : []),
      ]

      if (deFora.length === 0 && semLeitura.length === 0 && falhasDeImagem.length === 0) {
        const recado = linhas.join(' ') + ' Peça a análise na conversa.'
        anotarPreparo(id, 'pronto', recado)
        toast.success(recado)
      } else {
        if (deFora.length > 0) linhas.push('Fora por tamanho: ' + deFora.join('; ') + '.')
        if (semLeitura.length > 0) {
          linhas.push(
            'Sem leitura: ' + semLeitura.map((s) => `${s.nome} (${s.motivo})`).join('; ') + '. ' +
              'O Claude sabe que existem e é instruído a tratá-los como diligência, ' +
              'em vez de concluir que o documento não existe.',
          )
        }
        if (falhasDeImagem.length > 0) {
          linhas.push('Páginas que não subiram: ' + falhasDeImagem.slice(0, 3).join('; ') + '.')
        }
        anotarPreparo(id, 'parcial', linhas.join('\n'))
        toast.error('Os autos foram entregues com pendência — veja o aviso no card.')
      }
    } catch (e) {
      // A MENSAGEM INTEIRA FICA NO CARD. `erroDaFuncao` já traz o motivo real do
      // corpo da resposta e o status HTTP; jogá-la fora num aviso passageiro era
      // perder a única explicação que existe do lado de cá.
      const motivo = (e as Error)?.message ?? String(e)
      anotarPreparo(id, 'falhou', motivo)
      // O CONECTOR PRECISA SABER, ou a conversa espera para sempre por autos que
      // não vêm — ou pior, desiste e segue sem eles.
      void invokeFunction('autos-guardar', { acao: 'falhou', codigo, motivo }).catch(() => undefined)
      // SEM DOWNLOAD AUTOMÁTICO desde 27/09/2026. O resgate pelo disco era de
      // antes do conector saber avisar a conversa: baixava os PDFs sozinho
      // para a pessoa arrastar ao Claude. Hoje o conector diz à conversa que a
      // leitura falhou, e um processo de 17 MB caindo na pasta de Downloads a
      // cada tentativa era só susto. O resgate continua — num botão, no card.
      toast.error('Não consegui pôr os autos à disposição do Claude: ' + motivo)
    }
  }

  /** A lista de anexos que o card tem no Kommo, com os links de download. */
  async function listarAnexosDoCard(
    lead: KommoLead,
  ): Promise<{ nome: string; download: string }[]> {
    const bk = await invokeFunction<{
      erro?: string
      download_url?: string
      nome_arquivo?: string
      arquivos?: { nome: string; download: string }[]
    }>('buscar-kommo', { lead_id: lead.kommo_lead_id })
    if (bk.erro) throw new Error(bk.erro)
    if (bk.arquivos && bk.arquivos.length > 0) return bk.arquivos
    return bk.download_url
      ? [{ nome: bk.nome_arquivo ?? 'processo.pdf', download: bk.download_url }]
      : []
  }

  /**
   * Baixa para a máquina os anexos que o card tem no Kommo.
   *
   * PELO BLOB, e não por um link com o atributo `download`: ele é ignorado em URL
   * de outro domínio, e o navegador ABRIRIA o PDF numa aba em vez de salvá-lo —
   * o que não serve, porque o que se quer é o arquivo no disco para arrastar.
   */
  /**
   * Abre, numa aba, o arquivo que a pessoa clicou no histórico do card.
   *
   * O LINK NÃO ESTÁ NA ANOTAÇÃO. A nota de anexo do Kommo traz o NOME do
   * arquivo; o endereço de download vive na API de arquivos e é assinado na
   * hora. Guardá-lo no espelho seria guardar um link que vence — por isso a
   * busca acontece no clique.
   *
   * A ABA ABRE ANTES DA BUSCA, e isto não é ordem arbitrária: janela aberta
   * depois de um `await` perde a ativação do gesto e é barrada como popup. Ela
   * nasce em branco e recebe o endereço quando ele chega; falhando a busca, é
   * fechada — aba em branco esquecida é pior que erro nenhum.
   */
  /**
   * O endereço de download de um anexo — pelo uuid quando ele existe.
   *
   * O UUID É A CHAVE DE VERDADE. A primeira versão procurava o arquivo pelo NOME
   * na lista de anexos do card, e o caminho quebrava por dois motivos: a lista
   * vem do que está anexado À ENTIDADE, e o arquivo de uma anotação nem sempre
   * aparece ali; e nome de arquivo repete — "default.aspx1.pdf",
   * "default.aspx2.pdf", que é como um tribunal exporta —, então a comparação
   * escolhia o primeiro que casasse. Abrir a peça errada é pior que não abrir.
   *
   * A BUSCA POR NOME FICA DE RESERVA, para as notas gravadas antes de o espelho
   * guardar o uuid: elas continuam abrindo, com a fragilidade de sempre, até a
   * próxima sincronização trazer a chave.
   */
  async function enderecoDoAnexo(
    lead: KommoLead,
    anexo: KommoNota,
    nome: string,
  ): Promise<{ download: string }> {
    if (anexo.arquivo_uuid) {
      const r = await invokeFunction<{ download?: string; erro?: string }>('kommo-anexo', {
        file_uuid: anexo.arquivo_uuid,
      })
      if (r.erro || !r.download) throw new Error(r.erro ?? 'o Kommo não devolveu o endereço.')
      return { download: r.download }
    }
    const r = await invokeFunction<{
      arquivos?: { nome: string; download: string }[]
      erro?: string
    }>('buscar-kommo', { lead_id: lead.kommo_lead_id, todos: true })
    if (r.erro) throw new Error(r.erro)
    const igual = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
    const alvo = (r.arquivos ?? []).find((a) => igual(a.nome, nome))
    if (!alvo) {
      throw new Error(
        `não achei "${nome}" entre os anexos do card. Sincronize o Kommo — depois disso ` +
          'a plataforma passa a abrir o arquivo pelo identificador dele, e não pelo nome',
      )
    }
    return alvo
  }

  /**
   * O ENDEREÇO RESOLVIDO ANTES DO CLIQUE, quando dá tempo.
   *
   * Abrir um anexo custa uma ida à Edge Function e dela ao Kommo — perto de um
   * segundo, todo ele DEPOIS do clique, com a aba aberta em branco esperando.
   * Começando no passar do mouse, esse tempo corre enquanto a pessoa ainda está
   * mirando o link, e o clique costuma encontrar a resposta pronta.
   *
   * O CACHE É DA SESSÃO e serve também ao segundo clique no mesmo arquivo. Guarda
   * a PROMESSA, e não o valor: dois cliques seguidos entram na mesma espera em
   * vez de abrirem duas consultas.
   */
  const anexosResolvidos = useRef<Map<string, Promise<{ download: string }>>>(new Map())

  function prepararAnexo(lead: KommoLead, anexo: KommoNota) {
    const chave = anexo.arquivo_uuid ?? `${lead.kommo_lead_id}:${nomeDoAnexo(anexo)}`
    const guardada = anexosResolvidos.current.get(chave)
    if (guardada) return guardada
    const pedido = enderecoDoAnexo(lead, anexo, nomeDoAnexo(anexo))
    // FALHA NÃO FICA GUARDADA — o clique seguinte tenta de novo, em vez de
    // repetir para sempre um erro que pode ter sido de rede. O `catch` também
    // impede o aviso de promessa rejeitada sem dono, já que ninguém espera por
    // esta aqui quando ela nasce de um passar de mouse.
    pedido.catch(() => anexosResolvidos.current.delete(chave))
    anexosResolvidos.current.set(chave, pedido)
    return pedido
  }

  async function abrirAnexo(lead: KommoLead, anexo: KommoNota) {
    // SEM `noopener` AQUI, e isso não é descuido: com ele o `window.open`
    // devolve NULL por definição — o opener não recebe referência nenhuma da
    // janela nova. A aba abria e ficava órfã em "about:blank" para sempre,
    // enquanto o código caía no ramo de reserva e tentava abrir uma SEGUNDA
    // janela, essa sim barrada como popup por já não haver gesto.
    //
    // A proteção continua, por outro caminho: `opener = null` logo depois faz o
    // mesmo que a flag, e ainda assim devolve a referência que precisamos para
    // apontar a aba ao arquivo.
    const aba = window.open('', '_blank')
    if (aba) {
      aba.opener = null
      // Uma linha enquanto o link é resolvido: a aba em branco por dois segundos
      // parece defeito, e é o que estava sendo relatado como "abriu em branco".
      aba.document.write(
        '<title>Abrindo anexo…</title>' +
          '<p style="font:14px system-ui,sans-serif;color:#475569;padding:24px">Abrindo o anexo…</p>',
      )
      aba.document.close()
    }
    try {
      const alvo = await prepararAnexo(lead, anexo)
      // A ABA JÁ ESTÁ ABERTA: só recebe o endereço. O ramo de reserva existe
      // para o caso de o bloqueador de popup ter impedido a abertura lá em cima
      // — aí se tenta de novo, e se também for barrado o toast conta o que houve.
      if (aba) aba.location.href = alvo.download
      else if (!window.open(alvo.download, '_blank', 'noopener')) {
        throw new Error('o navegador bloqueou a janela — libere os popups deste site')
      }
    } catch (e) {
      aba?.close()
      toast.error('Não consegui abrir o anexo: ' + ((e as Error)?.message ?? String(e)))
    }
  }

  async function baixarAnexosDoCard(lead: KommoLead) {
    try {
      const lista = await listarAnexosDoCard(lead)
      if (lista.length === 0) {
        toast.error('Este card não tem anexo no Kommo — a conversa abriu sem os autos.')
        return
      }
      for (const a of lista) {
        const res = await fetch(a.download)
        if (!res.ok) throw new Error(a.nome + ': HTTP ' + res.status)
        const url = URL.createObjectURL(await res.blob())
        const link = document.createElement('a')
        link.href = url
        link.download = a.nome
        link.click()
        // Solta o objeto depois do clique: revogar na mesma linha cancelaria o
        // download em alguns navegadores.
        setTimeout(() => URL.revokeObjectURL(url), 30_000)
      }
      toast.success(
        lista.length + ' anexo(s) baixado(s) — arraste-os para a janela do Claude.',
      )
    } catch (e) {
      toast.error('Não consegui baixar os anexos: ' + (e as Error).message)
    }
  }

  /** Lê os anexos do card, guardando no cache na hora — a janela e a due diligence dividem o mesmo PDF. */
  async function lerArquivosComCache(
    lead: KommoLead,
    aoProgresso?: (feitos: number, total: number, nome: string) => void,
  ): Promise<ArquivoLido[]> {
    const id = lead.kommo_lead_id
    const lidos = arquivosCache[id] ?? (await lerUmaVezSo(lead, aoProgresso))
    guardarNoCache(id, lidos)
    return lidos
  }

  /** O que a função de RPV precisa saber do card, em toda chamada da janela. */
  /**
   * OS MEGABYTES DOS PDFs SAEM DA MEMÓRIA — por qualquer porta.
   *
   * Eles serviam a uma coisa só, renderizar as páginas digitalizadas, e isso já
   * aconteceu. O TEXTO fica, porque a aba de Certidões ainda o usa para sugerir
   * CPF. O descarte morava dentro do `onClose` da janela, e o caminho do
   * DESFECHO — Enviar para validação, Confirmar da janela de reprovar — fecha
   * com `setRpvLead(null)` direto: um processo digitalizado de 150 MB ficava
   * retido até o próximo sync, e o comentário do onClose afirmava o contrário.
   */
  function soltarBytes(id: number) {
    setArquivosCache((p) => {
      const atual = p[id]
      if (!atual) return p
      return { ...p, [id]: atual.map(({ bytes: _b, ...resto }) => resto) }
    })
  }

  function dadosParaRpv(lead: KommoLead): DadosDoCardRpv {
    const d = lerCardCredijuris(lead)
    // O CENÁRIO É O QUE SOBROU, e não o que o card cede.
    //
    // Achada execução contra o cedente e recusado o principal, o que se compra
    // são os honorários do advogado — crédito dele, que não responde pelas
    // dívidas do exequente. Sem esta linha a análise precificaria o principal
    // recusado junto, e a planilha sairia oferecendo o que a casa não compra.
    const sobra = verbasQueSobram(
      d.tipo_aquisicao,
      verbasRecusadas[lead.kommo_lead_id] ?? [],
    )
    return {
      numero_processo: d.numero,
      categoria: d.categoria,
      intermediador: d.intermediador,
      cedente: d.cedente,
      tipo_aquisicao: sobra.parcela ?? d.tipo_aquisicao,
      honorarios_pct: d.honorarios_pct,
    }
  }

  /** Todas as anotações do card, da mais antiga à mais nova: a IA lê junto com os autos. */
  function notasDoCard(lead: KommoLead): string {
    // DE GENTE, pelo mesmo motivo de `notasDeGente`: a IA lendo a própria
    // anotação anterior confirma a si mesma.
    const daGente = notasDeGente(lead)
    const lista = daGente.length > 0 ? daGente.map((n) => n.texto) : [lead.nota_texto ?? '']
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
  /** O card cuja planilha está sendo colada, ou null. */
  const [planilhaLead, setPlanilhaLead] = useState<KommoLead | null>(null)

  /**
   * Grava a planilha com o bloco que a conversa do Claude entregou.
   *
   * O MESMO DESTINO DO MOTOR ANTIGO — mesma planilha, mesma pasta no Drive,
   * mesma anotação no card —, só que as respostas vêm da conversa, e não de
   * uma segunda leitura. O erro sobe para a janela, que o mostra sem perder o
   * que foi colado.
   */
  async function preencherPlanilha(lead: KommoLead, colado: string) {
    const id = lead.kommo_lead_id
    const dados = lerCardCredijuris(lead)
    const r = await invokeFunction<ResultadoJuridico>('planilha-juridica', {
      kommo_lead_id: id,
      colado,
      numero_processo: dados.numero,
      cedente: dados.cedente,
      originador: dados.intermediador,
      tipo_aquisicao: dados.tipo_aquisicao,
      honorarios_pct: dados.honorarios_pct,
    })
    setResultadoJuridico((p) => ({ ...p, [id]: r }))
    anotarPastaNoCard(id, r.pasta_id)
    void anotarResultadoNaKommo(id, r as unknown as ResultadoAnalise, analistaNome, VEREDITO_JURIDICO).then(
      (falhas) => {
        if (falhas.length) toast.error('A planilha ficou pronta, mas a anotação no card do Kommo não subiu: ' + falhas.join('; '))
      },
    )
    toast.success('Planilha preenchida e salva no Drive.')
  }

  async function onAnaliseJuridica(lead: KommoLead) {
    const id = lead.kommo_lead_id
    // UMA POR CARD: o link "Colar o bloco" continua no card enquanto a antiga
    // roda, e um segundo "Não tenho o bloco" pagava outra leitura dos autos e
    // deixava duas anotações no Kommo.
    if (juridicasNoAr.current.has(id)) {
      toast.error('A análise jurídica antiga deste card já está rodando — espere ela terminar.')
      return
    }
    juridicasNoAr.current.add(id)
    setAnalisandoJur((m) => comecarNoCard(m, id, true as const))
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
      void anotarResultadoNaKommo(id, r as unknown as ResultadoAnalise, analistaNome, VEREDITO_JURIDICO).then(
        (falhas) => {
          if (falhas.length) toast.error('A análise ficou pronta, mas a anotação no card do Kommo não subiu: ' + falhas.join('; '))
        },
      )
    } catch (e) {
      setResultadoJuridico((p) => ({
        ...p,
        [id]: { erro: (e as Error)?.message ?? String(e) },
      }))
    } finally {
      juridicasNoAr.current.delete(id)
      setAnalisandoJur((m) => terminarNoCard(m, id))
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
    lerAnexosDoCard(lead)
  }
  /** As certidões sozinhas (ver `certidoes` na trilha), com a mesma leitura dos anexos. */
  function onCertidoes(lead: KommoLead) {
    setCertLead(lead)
    lerAnexosDoCard(lead)
  }
  /** Os PDFs do card, lidos em segundo plano para as sugestões do painel de certidões. */
  function lerAnexosDoCard(lead: KommoLead) {
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
            `Digite o CPF ou CNPJ conferindo no processo.`,
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
      //
      // AS DUAS JANELAS QUE LEEM O CACHE: a due diligence E as certidões (a
      // Obtenção de documentação do Externo). Só a primeira era poupada, e a
      // janela de Certidões esvaziava pelo mesmo caminho descrito acima.
      const abertos = [ddLead?.kommo_lead_id, certLead?.kommo_lead_id]
      setArquivosCache((antes) => soDosAbertos(antes, abertos))
      setAvisoPdf((antes) => soDosAbertos(antes, abertos))
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
    // A VISÃO DE QUEM ESTÁ LOGADO: o que é `soAdmin` só entra para o admin — salvo
    // com `BOTOES_NOVOS_PARA_TODOS` ligado (a onda 4, desde 03/10/2026), quando
    // entra para todos.
    () => abasDoFunil(funil, etapas.data ?? [], subdivisao, { admin: isAdmin }),
    [funil, etapas.data, subdivisao, isAdmin],
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
  /**
   * Onde a busca procura em cada card, montado UMA VEZ por carga dos cards — ver
   * `indiceDaBusca`. Era refeito (todas as anotações em minúsculas) três vezes
   * por tecla digitada, para o funil inteiro.
   */
  const indicesDaBusca = useMemo(
    () => new Map((leads.data ?? []).map((l) => [l.kommo_lead_id, indiceDaBusca(l)])),
    [leads.data],
  )
  /**
   * A busca preparada uma vez por tecla: sem acento e, sendo número, só os
   * dígitos — o CNJ colado sem pontuação acha o card (ver `prepararBusca`).
   */
  const consulta = useMemo(() => prepararBusca(busca), [busca])
  /** O card bate com a busca? */
  const casaComBusca = useCallback(
    (x: KommoLead, c: ConsultaDaBusca) =>
      casaComABusca(indicesDaBusca.get(x.kommo_lead_id) ?? indiceDaBusca(x), c),
    [indicesDaBusca],
  )

  // COM BUSCA, O NÚMERO DO FUNIL TAMBÉM É O DE RESULTADOS — o mesmo critério das
  // etapas logo abaixo, senão o topo diria 150 e as etapas somariam 3.
  const totalExibido = useMemo(() => {
    if (!leads.data) return undefined
    const ids = statusExibidos(funil, etapas.data ?? [])
    return leads.data.filter((l) => ids.has(l.status_id) && (!consulta || casaComBusca(l, consulta))).length
  }, [leads.data, funil, etapas.data, consulta, casaComBusca])

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
  // RPV são 'pendentes'…, as de Precatório são 'int-…'/'ext-…'). Cai na primeira
  // QUE TEM FUNÇÃO, e não na primeira com cards: no kanban inteiro a primeira
  // coluna pode ser só de leitura.
  const abaAtual = abas.find((a) => a.key === aba) ?? abas.find((a) => !a.soLeitura) ?? abas[0] ?? null

  // O QUADRO DE FASES (amostra), genérico sobre `Aba.fase`: o RPV pelas fases de
  // kommo.ts, o Interno pela exibição do front, o Externo pelas da trilha.
  const fasesDoFunil = useMemo(() => fasesDoQuadro(abas), [abas])
  const indiceDaFase = fasesDoFunil.findIndex((f) => f.abas.some((a) => a.key === abaAtual?.key))
  const faseAberta = indiceDaFase >= 0 ? fasesDoFunil[indiceDaFase] : null

  // OS BOTÕES DE TRABALHO DA ETAPA ABERTA. A regra e o porquê estão em
  // `botoesDaAba` (src/lib/kommo.ts), que saiu daqui para os testes prenderem o
  // que cada aba oferece — análise e due diligence são pagas.
  const botoesDoCard: BotoesDoCard = botoesDaAba(funil, subdivisao, abaAtual)

  /**
   * A BUSCA VALE PARA TODAS AS ABAS, e não só para a aberta. Filtrando só a lista
   * da aba aberta, o número de cada etapa continuava o total, e quem buscava um
   * card não tinha como saber em qual etapa ele estava sem abrir uma por uma. Com
   * as abas filtradas juntas, o número de cada etapa é o de resultados nela.
   */
  const porAbaNaBusca = useMemo(() => {
    if (!consulta) return porAba
    return Object.fromEntries(
      Object.entries(porAba).map(([k, l]) => [k, l.filter((x) => casaComBusca(x, consulta))]),
    ) as Record<string, KommoLead[]>
  }, [porAba, consulta, casaComBusca])

  /**
   * O NÚMERO DE CADA DESTINAÇÃO, ao lado de Interno e Externo (item "Novo":
   * contadores nas pílulas). A soma das abas de cada trilha, pelo mesmo
   * critério das etapas — com busca, é contagem de resultado.
   */
  // O AGRUPAMENTO DE CADA TRILHA À PARTE DA BUSCA: ele ordena o funil inteiro
  // duas vezes, e não muda com o que se digita — só a contagem muda.
  const cardsPorTrilha = useMemo(() => {
    if (!leads.data || !ehFunilPrecatorio(funil)) return null
    return SUBDIVISOES_PRECATORIO.map(
      (s) => [s.key, Object.values(agruparPorAba(leads.data!, abasDoFunil(funil, etapas.data ?? [], s.key)).porAba)] as const,
    )
  }, [leads.data, funil, etapas.data])
  const totalDaTrilha = useMemo(() => {
    if (!cardsPorTrilha) return null
    const total: Partial<Record<SubdivisaoPrecatorio, number>> = {}
    for (const [key, listas] of cardsPorTrilha) {
      total[key] = listas.reduce(
        (t, l) => t + (consulta ? l.filter((x) => casaComBusca(x, consulta)).length : l.length),
        0,
      )
    }
    return total
  }, [cardsPorTrilha, consulta, casaComBusca])

  const lista = useMemo(
    () => (abaAtual ? (porAbaNaBusca[abaAtual.key] ?? []) : []),
    [porAbaNaBusca, abaAtual],
  )

  /**
   * O CARD TEM NÚMERO DE PROCESSO? Pela mesma leitura do cadastro que o aviso do
   * card usa (título primeiro, anotação depois). Só para a etapa aberta: é o que
   * o filtro "Sem nº do processo" e a contagem dele precisam.
   */
  const temNumero = useMemo(
    () => new Map(lista.map((l) => [l.kommo_lead_id, Boolean(lerCardCredijuris(l).numero)])),
    [lista],
  )
  const ehPronta = useCallback((l: KommoLead) => prontas.data?.has(l.kommo_lead_id) ?? false, [prontas.data])
  // OS FILTROS QUE A ETAPA OFERECE. "Com cotação" só onde a etiqueta do fundo é
  // trabalho (Em precificação); "Análise pronta" só na Análise do RPV, a única
  // coluna em que o selo "Finalizado" existe; "Sem nº do processo" só quando há.
  const ofereceCotacao = etiquetasDaAba(abaAtual?.key).length > 0
  const ofereceProntas = funil === FUNIL_RPV && abaAtual?.key === 'pendentes'
  const contagemDoFiltro = useMemo(() => {
    const agora = new Date()
    return {
      todos: lista.length,
      parados: lista.filter((l) => estaParado(diasNaEtapa(l, agora))).length,
      cotados: lista.filter(temCotacao).length,
      prontas: lista.filter(ehPronta).length,
      semnum: lista.filter((l) => !temNumero.get(l.kommo_lead_id)).length,
    } satisfies Record<FiltroRapido, number>
  }, [lista, ehPronta, temNumero])
  const filtrados = useMemo(
    () =>
      filtrarEOrdenar(lista, {
        filtro,
        ordem,
        temNumero: (l) => temNumero.get(l.kommo_lead_id) ?? true,
        pronta: ehPronta,
      }),
    [lista, filtro, ordem, temNumero, ehPronta],
  )

  /** Onde a busca achou cards: a faixa de cima conta todas; o vazio, só as outras. */
  const achadosNoFunil = busca.trim() ? achadosDaBusca(abas, porAbaNaBusca, abaAtual, true) : []
  const achadosEmOutrasAbas = busca.trim() ? achadosDaBusca(abas, porAbaNaBusca, abaAtual, false) : []

  // ---------------------------------------- "VOLTAR AO CARD" (onda 4, para todos)
  //
  // A Geração de contratos aberta pelo card volta para cá com `?card=<id>`. O
  // PARÂMETRO SÓ REALÇA E ROLA ATÉ O CARD — NUNCA abre janela nem move nada (a
  // due diligence busca no Escavador sozinha, e cada consulta custa; mover card
  // não se desfaz). Lido uma vez e tirado do endereço, para um F5 não repetir.
  const [parametros, setParametros] = useSearchParams()
  // PARA TODOS desde a onda 3: a busca geral (Ctrl+K) também chega aqui com
  // `?card=`, e realçar e rolar não move nada nem custa nada.
  const cardPedido = cardDoEndereco(parametros.get('card'))
  const [realce, setRealce] = useState<number | null>(null)
  const procurouNoOutroFunil = useRef(false)
  const rolouAte = useRef<number | null>(null)
  useEffect(() => {
    if (cardPedido === null || !leads.data || !etapas.data) return
    // O PEDIDO ACABA AQUI, achado ou não — e a procura no outro funil volta a
    // valer para o próximo. A página não remonta quando a busca geral (Ctrl+K)
    // pede outro card com ela aberta; sem zerar a marca, todo pedido seguinte de
    // card do outro funil desistia de cara com "Não achei este card".
    const tirarDoEndereco = () => {
      procurouNoOutroFunil.current = false
      setParametros(
        (p) => {
          const n = new URLSearchParams(p)
          n.delete('card')
          return n
        },
        { replace: true },
      )
    }
    const lead = leads.data.find((l) => l.kommo_lead_id === cardPedido)
    if (!lead) {
      // O CARD PODE ESTAR NO OUTRO FUNIL: procura lá uma vez, e só então desiste.
      if (!procurouNoOutroFunil.current) {
        procurouNoOutroFunil.current = true
        setFunil(funil === FUNIL_RPV ? FUNIL_PRECATORIO : FUNIL_RPV)
        irParaAba('')
        return
      }
      toast.error('Não achei este card no espelho do Kommo. Sincronize e procure pela busca.')
      tirarDoEndereco()
      return
    }
    const trilha = SUBDIVISOES_PRECATORIO.find((s) => s.pipelineId === lead.pipeline_id)
    if (trilha && trilha.key !== subdivisao) {
      setSubdivisao(trilha.key)
      return
    }
    const destino = abas.find((a) => a.statusIds.includes(lead.status_id))
    if (destino) irParaAba(destino.key)
    setBusca('')
    rolouAte.current = null
    setRealce(lead.kommo_lead_id)
    tirarDoEndereco()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardPedido, leads.data, etapas.data, abas, funil, subdivisao])
  useEffect(() => {
    if (realce === null || rolouAte.current === realce) return
    const i = filtrados.findIndex((l) => l.kommo_lead_id === realce)
    if (i < 0) return
    if (i >= mostrar) {
      setMostrar(i + 1)
      return
    }
    rolouAte.current = realce
    const el = document.querySelector<HTMLElement>(`[data-lead="${realce}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el?.focus({ preventScroll: true })
  }, [realce, filtrados, mostrar])
  // O DESTAQUE SOME SOZINHO depois de alguns segundos: é para achar, não marca.
  useEffect(() => {
    if (realce === null) return
    const t = window.setTimeout(() => setRealce(null), 6000)
    return () => window.clearTimeout(t)
  }, [realce])

  /** Copia um texto do card — e diz se deu certo, que é o que se quer saber. */
  const copiar = (texto: string, aviso: string) => {
    Promise.resolve()
      .then(() => navigator.clipboard.writeText(texto))
      .then(
        () => toast.success(aviso),
        () =>
          toast.error(
            'Não consegui copiar: o navegador bloqueou a área de transferência. Selecione o texto e copie à mão.',
          ),
      )
  }

  /** O card e o desfecho aguardando a mensagem, quando a decisão vem do card. */
  const [mensagemDoCard, setMensagemDoCard] = useState<{
    lead: KommoLead
    acoes: AcaoTela[]
    titulo: string
  } | null>(
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
    },
    // A TRAVA DO CARD NÃO SAI DAQUI: quem a solta é `comCardTravado`, quando a
    // operação inteira acaba — o movimento E a nota que vem depois dele. Solta
    // aqui, ela caía entre os dois, e na fresta os botões do card voltavam.
    onError: (e) => {
      toast.error((e as Error).message)
    },
  })

  /**
   * Uma operação que MOVE O CARD, do começo ao fim (o movimento e a nota): o
   * card fica travado enquanto ela corre, e um segundo pedido para o mesmo card
   * é recusado em vez de mover de novo. Os outros cards seguem livres.
   */
  async function comCardTravado<T>(leadId: number, statusId: number, operacao: () => Promise<T>): Promise<T> {
    if (cardsTravados.current.has(leadId)) {
      throw new Error('Este card já está sendo movido — espere terminar.')
    }
    cardsTravados.current.add(leadId)
    setEmAndamento((m) => comecarNoCard(m, leadId, statusId))
    try {
      return await operacao()
    } finally {
      cardsTravados.current.delete(leadId)
      setEmAndamento((m) => terminarNoCard(m, leadId))
    }
  }

  /** Etiqueta em gravação: uma por card, para o seletor DAQUELE card travar. */
  const [etiquetaEmVoo, setEtiquetaEmVoo] = useState<PorCard<string>>({})

  /**
   * Marcar e desmarcar uma etiqueta do card, no Kommo.
   *
   * A LISTA DE VOLTA É A DO KOMMO — a função relê o card depois de gravar — e é
   * ela que entra no cache. Invalidar a consulta em vez disso recarregaria os
   * cards todos por causa de um clique, e ainda assim mostraria o espelho, que
   * é o que acabou de mudar; escrever a lista relida é ao mesmo tempo mais
   * barato e mais verdadeiro.
   *
   * SEM AVISO DE SUCESSO. A etiqueta aparece no card — o resultado É o aviso. O
   * toast só entra quando algo saiu do lugar, que é quando ele informa algo.
   */
  const etiquetar = useMutation({
    mutationFn: (args: {
      leadId: number
      etiqueta: string
      acao: 'adicionar' | 'remover'
    }) =>
      invokeFunction<{ tags: string[]; aviso: string | null; mensagem: string }>(
        'kommo-etiquetar',
        args,
      ),
    onSuccess: (r, args) => {
      qc.setQueriesData<KommoLead[]>({ queryKey: ['kommo_leads'] }, (antes) =>
        antes?.map((l) => {
          if (l.kommo_lead_id !== args.leadId) return l
          // A DATA JUNTO DA ETIQUETA: a que entrou é de agora, as que saíram
          // (inclusive a irmã trocada) deixam o mapa — o mesmo que a
          // kommo-etiquetar grava no espelho.
          const tags = r?.tags ?? l.tags
          const datas: Record<string, string | null> = Object.fromEntries(
            Object.entries(l.tags_em ?? {}).filter(
              ([k]) => tags.some((t) => mesmaEtiqueta(t, k)) && !mesmaEtiqueta(k, args.etiqueta),
            ),
          )
          if (args.acao === 'adicionar') {
            datas[etiquetaCanonica(args.etiqueta) ?? args.etiqueta] = new Date().toISOString()
          }
          return { ...l, tags, tags_em: datas }
        }),
      )
      setEtiquetaEmVoo((m) => terminarNoCard(m, args.leadId))
      if (r?.aviso) toast.error(r.aviso)
    },
    onError: (e, args) => {
      setEtiquetaEmVoo((m) => terminarNoCard(m, args.leadId))
      toast.error((e as Error).message)
    },
  })

  /**
   * A JANELA DA COTAÇÃO aberta, ou null: o card e a etiqueta "Cotado ‹fundo›"
   * que entra quando ela for enviada.
   */
  const [cotando, setCotando] = useState<{ lead: KommoLead; etiqueta: string; fundo: string } | null>(null)
  /**
   * A TRAVA DA COTAÇÃO, num ref: o estado `etiquetaEmVoo` só muda no próximo
   * render, e um duplo clique em Enviar cabe antes dele — gravaria duas vezes e
   * deixaria duas notas no card. O estado continua sendo o que trava o seletor.
   */
  const cotacaoEmVoo = useRef(new Set<number>())

  /** "Cotado ‹fundo›" na Em precificação: em vez de etiquetar já, abre a janela. */
  function abrirCotacao(lead: KommoLead, etiqueta: string) {
    const e = ETIQUETAS_DA_PRECIFICACAO.find((x) => mesmaEtiqueta(x.nome, etiqueta))
    if (!e || e.ato !== 'Cotado') return
    setCotando({ lead, etiqueta: e.nome, fundo: e.destino })
  }

  /**
   * ENVIA A COTAÇÃO: o valor no campo do fundo e a etiqueta, num pedido só (ver
   * a `kommo-etiquetar`). LANÇA com a mensagem quando falha — a janela a mostra
   * e fica aberta, com o que foi digitado.
   */
  async function enviarCotacao(lead: KommoLead, etiqueta: string, cotacao: Cotacao) {
    await gravarCotacaoNoCard(lead, etiqueta, cotacao)
    setCotando(null)
  }

  /**
   * A COTAÇÃO E A ETIQUETA "Cotado ‹fundo›" no card, num pedido só à
   * `kommo-etiquetar`, com a trava do card e o cache atualizado — o caminho
   * comum da janela da cotação (Em precificação) e do envio ao BTG (Remessa aos
   * fundos). LANÇA com a mensagem quando falha.
   *
   * `cotacaoGravada` é a função confirmando que gravou o campo (a `cotacao` da
   * resposta): é com ela que o envio ao BTG decide se pode mover o card.
   */
  async function gravarCotacaoNoCard(
    lead: KommoLead,
    etiqueta: string,
    cotacao: Cotacao,
  ): Promise<{ tags: string[]; cotacaoGravada: boolean }> {
    const id = lead.kommo_lead_id
    if (cotacaoEmVoo.current.has(id) || etiquetaEmVoo[id] !== undefined) {
      throw new Error('Há uma etiqueta deste card sendo gravada — espere terminar.')
    }
    cotacaoEmVoo.current.add(id)
    setEtiquetaEmVoo((m) => comecarNoCard(m, id, etiqueta))
    try {
      const r = await invokeFunction<{
        tags: string[]
        aviso: string | null
        cotacao?: { texto: string; campo: { id: number; name: string; type: string } }
        campos?: ValorDeCampo[] | null
      }>('kommo-etiquetar', { leadId: id, etiqueta, acao: 'adicionar', cotacao })
      qc.setQueriesData<KommoLead[]>({ queryKey: ['kommo_leads'] }, (antes) =>
        antes?.map((l) => {
          if (l.kommo_lead_id !== id) return l
          const tags = r?.tags ?? l.tags
          // As datas como no `etiquetar`: a que entrou é de agora, as que
          // saíram deixam o mapa.
          const datas: Record<string, string | null> = Object.fromEntries(
            Object.entries(l.tags_em ?? {}).filter(
              ([k]) => tags.some((t) => mesmaEtiqueta(t, k)) && !mesmaEtiqueta(k, etiqueta),
            ),
          )
          datas[etiqueta] = new Date().toISOString()
          // OS CAMPOS RELIDOS do Kommo; sem eles, só o campo gravado trocado.
          const campos =
            r?.campos ??
            (r?.cotacao ? comCotacaoGravada(l.raw?.custom_fields_values, r.cotacao.campo, r.cotacao.texto) : null)
          return {
            ...l,
            tags,
            tags_em: datas,
            ...(campos ? { raw: { ...(l.raw ?? {}), custom_fields_values: campos } } : {}),
          }
        }),
      )
      if (r?.aviso) toast.error(r.aviso)
      return { tags: r?.tags ?? [...(lead.tags ?? []), etiqueta], cotacaoGravada: Boolean(r?.cotacao) }
    } finally {
      cotacaoEmVoo.current.delete(id)
      setEtiquetaEmVoo((m) => terminarNoCard(m, id))
    }
  }

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
    // MOVER UMA VEZ, ANOTAR QUANTAS PRECISAR.
    //
    // Falhando a nota DEPOIS de o card já ter mudado de coluna, a janela fica
    // aberta com "o texto continua aqui" convidando a tentar de novo — e o novo
    // Confirmar movia o card OUTRA VEZ para o mesmo status, deixando duas
    // movimentações no histórico por causa de uma nota. A memória por
    // (card, coluna) sobrevive ao retry porque mora num ref da página.
    const chave = chaveDoMovimento(leadId, statusId)
    // E NUNCA PARA OUTRA COLUNA enquanto falta a nota de um movimento anterior
    // desta janela (ver `movimentoRecusado`).
    const recusa = movimentoRecusado(jaMovidos.current, leadId, statusId)
    if (recusa) throw new Error(recusa)
    if (!jaMovidos.current.has(chave)) {
      await mover.mutateAsync({ leadId, statusId, comentario: '' })
      jaMovidos.current.add(chave)
    }
    const texto = mensagem.trim()
    if (texto) {
      try {
        // DE PESSOA: o texto é dela, e é o que a análise seguinte precisa ler no
        // card. Ver marcarComoDePessoa, em _shared/notaCredijuris.ts.
        await invokeFunction('kommo-anotar', {
          lead_id: leadId, texto, origem: 'pessoa', autor: analistaNome,
        })
      } catch (e) {
        throw new Error(
          'O card foi movido, mas a nota com a mensagem não subiu (' +
            ((e as Error)?.message ?? String(e)) +
            '). O texto continua aqui — confirmar de novo tenta só a nota.',
        )
      }
    }
    // TUDO FEITO, A MEMÓRIA SAI. Ela só existe para o retry da nota; se ficasse,
    // o mesmo card voltando a esta coluna mais tarde na sessão — Revisão,
    // Diligência, Sanar, Revisão de novo (onda 4) — teria o movimento PULADO, e a
    // nota subiria dizendo um movimento que não aconteceu.
    jaMovidos.current.delete(chave)
  }

  /** Esquece os movimentos pendentes de nota de um card — a janela dele fechou. */
  function esquecerMovimentos(leadId: number) {
    for (const k of [...jaMovidos.current]) if (k.startsWith(`${leadId}:`)) jaMovidos.current.delete(k)
  }

  /** O card já se moveu para esta coluna nesta janela, e falta só a nota? */
  const jaMovidoPara = (leadId: number) => (statusId: number) => jaMovidos.current.has(chaveDoMovimento(leadId, statusId))

  /**
   * A anotação escrita no card (ver `BotaoDeAnotacao`).
   *
   * APARECE NO CARD NA HORA: o espelho só a traria na próxima sincronização, e
   * quem acabou de escrever procuraria a nota e não a veria.
   * A sincronização seguinte troca esta cópia pela do Kommo.
   */
  async function anotarNoCard(lead: KommoLead, texto: string) {
    try {
      await invokeFunction('kommo-anotar', {
        lead_id: lead.kommo_lead_id, texto, origem: 'pessoa', autor: analistaNome,
      })
    } catch (e) {
      toast.error(`A anotação não subiu para o Kommo: ${(e as Error)?.message ?? e}. O texto continua na caixa.`)
      throw e
    }
    const nova: KommoNota = {
      id: -Date.now(),
      texto,
      criado_em: new Date().toISOString(),
      autor: analistaNome,
      tipo: 'common',
      automatica: false,
    }
    qc.setQueriesData<KommoLead[]>({ queryKey: ['kommo_leads'] }, (antes) =>
      antes?.map((l) =>
        l.kommo_lead_id === lead.kommo_lead_id ? { ...l, notas: [...(l.notas ?? []), nova] } : l,
      ),
    )
    toast.success('Anotação enviada ao card no Kommo.')
  }

  /**
   * ANEXAR E MOVER (ver `BotaoAnexarEMover`): o arquivo e a anotação padrão
   * sobem pela kommo-anexo-enviar; o card se move pela kommo-mover, como todo
   * desfecho.
   *
   * O CARD QUE JÁ RECEBEU O ARQUIVO e não se moveu fica registrado aqui: o
   * próximo clique só move — o arquivo não sobe duas vezes.
   */
  const [anexadosSemMover, setAnexadosSemMover] = useState<Set<number>>(new Set())

  /**
   * O ENVIO A UM FUNDO (ver `ChecksDosFundos`): a anotação (com as imagens, se
   * houver), a etiqueta do fundo e — com todos os checks feitos — o card para o
   * destino da aba.
   *
   * A ANOTAÇÃO QUE JÁ SUBIU não sobe de novo: se a etiqueta falhar, confirmar
   * outra vez só etiqueta.
   *
   * O TEXTO VAI PELA kommo-anotar, em JSON, e não num cabeçalho do envio do
   * arquivo: um texto de alguns parágrafos, codificado, pode passar do tamanho
   * que o caminho até a função aceita num cabeçalho — e aí a requisição inteira
   * é recusada. Os arquivos sobem depois, sem texto.
   *
   * CADA PARTE FEITA FICA REGISTRADA (o texto, cada arquivo): se o terceiro
   * print falhar, confirmar de novo não repete o texto nem os dois primeiros.
   */
  const [envioAberto, setEnvioAberto] = useState<{ lead: KommoLead; fundo: FundoDoEnvio } | null>(null)

  /**
   * A JUSTIFICATIVA TÉCNICA (05/10/2026): a janela do card aberto e o estado de
   * cada card da aba — uma consulta só, que se repete sozinha enquanto algum
   * card gera. Só nas abas que a declaram (a Produção de proposta dos três
   * funis); nas outras, nada é consultado.
   */
  const [justificativaLead, setJustificativaLead] = useState<KommoLead | null>(null)
  const justificativas = useJustificativasDaAba(
    useMemo(() => filtrados.map((l) => l.kommo_lead_id), [filtrados]),
    Boolean(abaAtual?.justificativaTecnica),
  )
  /** A nota subiu: entra no histórico do card já, sem esperar a sincronização. */
  function justificativaEnviada(lead: KommoLead, texto: string) {
    const nova: KommoNota = {
      id: -Date.now(),
      texto,
      criado_em: new Date().toISOString(),
      autor: analistaNome,
      tipo: 'common',
      automatica: false,
    }
    qc.setQueriesData<KommoLead[]>({ queryKey: ['kommo_leads'] }, (antes) =>
      antes?.map((l) =>
        l.kommo_lead_id === lead.kommo_lead_id ? { ...l, notas: [...(l.notas ?? []), nova] } : l,
      ),
    )
  }
  const [notasDoEnvio, setNotasDoEnvio] = useState<Set<string>>(new Set())
  const partesDoEnvio = useRef<Set<string>>(new Set())
  async function moverAposOsFundos(lead: KommoLead) {
    const cfg = abaAtual?.envioAosFundos
    if (!cfg) return
    await comCardTravado(lead.kommo_lead_id, cfg.destino, () =>
      mover.mutateAsync({ leadId: lead.kommo_lead_id, statusId: cfg.destino, comentario: '' }),
    )
  }
  /**
   * A ORDEM DAS CHAMADAS e as mensagens de cada falha moram em
   * `registrarEnvioAoFundo` (lib/envioAoFundo.ts): a anotação, depois a etiqueta
   * — com a cotação no campo do fundo, no ato que a pede ("Cotado BTG"), no
   * mesmo PATCH —, e só então o movimento. Aqui ficam as chamadas, o cache e o
   * que já subiu.
   *
   * LANÇA com a mensagem quando o envio falha: a janela a mostra e fica aberta.
   */
  async function enviarAoFundo(
    lead: KommoLead,
    fundo: FundoDoEnvio,
    ato: AtoDoEnvio,
    texto: string,
    arquivos: File[],
    cotacao: Cotacao | null,
    onAndamento: (texto: string, pct?: number) => void,
  ) {
    const cfg = abaAtual?.envioAosFundos
    if (!cfg) return
    const id = lead.kommo_lead_id
    // PELO DESFECHO, e não só pelo fundo: a nota de "enviado" que subiu não
    // vale por uma de "reprovado", se a pessoa mudar de botão ao tentar de novo.
    const chave = `${id}:${fundo.fundo}:${ato.etiqueta}`
    const nota = [ato.nota, texto.trim()].filter(Boolean).join('\n\n')

    let r: ResultadoDoEnvio
    try {
      r = await registrarEnvioAoFundo({
        fundo: fundo.fundo,
        ato,
        cotacao,
        anotacaoFeita: notasDoEnvio.has(chave),
        todosFeitos: (tags) => cfg.fundos.every((f) => atoFeito(f, tags)),
        destino: 'Em precificação',
        onAndamento: (t) => onAndamento(t),
        passos: {
          // 1. A ANOTAÇÃO, e depois as imagens, se houver.
          anotar: async () => {
            const feitas = partesDoEnvio.current
            if (!feitas.has(`${chave}:texto`)) {
              onAndamento('Gravando a anotação no Kommo…')
              await invokeFunction('kommo-anotar', { lead_id: id, texto: nota, origem: 'pessoa', autor: analistaNome })
              feitas.add(`${chave}:texto`)
            }
            for (let i = 0; i < arquivos.length; i++) {
              const a = arquivos[i]
              const parteDoArquivo = `${chave}:arquivo:${a.name}:${a.size}:${a.lastModified}`
              if (feitas.has(parteDoArquivo)) continue
              if (a.size > 100 * 1024 * 1024) throw new Error(`${a.name} passa de 100 MB.`)
              const qual = arquivos.length > 1 ? `arquivo ${i + 1} de ${arquivos.length} — ` : ''
              const rArq = await enviarArquivo<{ aviso?: string | null }>(
                'kommo-anexo-enviar',
                a,
                { 'x-lead-id': String(id), 'x-nome': encodeURIComponent(a.name), 'x-texto': '' },
                (p) =>
                  p.fase === 'enviando'
                    ? onAndamento(`Enviando ${qual}${p.pct}%`, p.pct)
                    : onAndamento(`Gravando no Kommo ${qual}…`),
              )
              if (rArq?.aviso) toast.error(rArq.aviso)
              feitas.add(parteDoArquivo)
            }
            setNotasDoEnvio((antes) => new Set(antes).add(chave))
            for (const p of [...feitas]) if (p.startsWith(`${chave}:`)) feitas.delete(p)
          },
          // 2. A ETIQUETA DO FUNDO — com a cotação, pelo caminho da janela da
          // cotação (a mesma trava do card e o mesmo cache).
          etiquetar: async (comCotacao) => {
            if (comCotacao) return gravarCotacaoNoCard(lead, ato.etiqueta, comCotacao)
            const rEt = await invokeFunction<{ tags?: string[]; aviso?: string | null }>('kommo-etiquetar', {
              leadId: id,
              etiqueta: ato.etiqueta,
              acao: 'adicionar',
            })
            const tags = rEt?.tags ?? [...(lead.tags ?? []), ato.etiqueta]
            if (rEt?.aviso) toast.error(rEt.aviso)
            qc.setQueriesData<KommoLead[]>({ queryKey: ['kommo_leads'] }, (antes) =>
              antes?.map((l) =>
                l.kommo_lead_id === id
                  ? { ...l, tags, tags_em: { ...(l.tags_em ?? {}), [ato.etiqueta]: new Date().toISOString() } }
                  : l,
              ),
            )
            return { tags, cotacaoGravada: false }
          },
          // 3. O CARD PARA O DESTINO, com todos os fundos feitos.
          mover: () => moverAposOsFundos(lead),
        },
      })
    } catch (e) {
      toast.error((e as Error).message)
      throw e
    }

    // A ETIQUETA ENTROU: a anotação deste desfecho não fica mais pendente.
    setNotasDoEnvio((antes) => {
      const n = new Set(antes)
      n.delete(chave)
      return n
    })

    if (r.movido) return
    if (r.faltamFundos) {
      toast.success(r.cotacao ? `${ato.nota} Cotação no campo ${fundo.fundo}: ${r.cotacao}.` : ato.nota)
      return
    }
    // A FALHA DO MOVIMENTO NÃO É FALHA DO ENVIO (ver `ResultadoDoEnvio`): a janela
    // fecha, e quem refaz o movimento é o botão "Mover para Em precificação",
    // que aparece no card com todos os checks feitos. O motivo já foi avisado
    // (o onError do mover); este diz o que fazer.
    toast.error('O envio está registrado no card, mas ele não se moveu — clique em "Mover para Em precificação" no card.')
  }
  async function anexarEMover(
    lead: KommoLead,
    arquivo: File | null,
    onAndamento: (p: AndamentoDoAnexo) => void,
  ) {
    const cfg = abaAtual?.anexarEMover
    if (!cfg) return
    const id = lead.kommo_lead_id
    const jaAnexado = anexadosSemMover.has(id)
    if (!jaAnexado) {
      if (!arquivo) return
      if (arquivo.size > 100 * 1024 * 1024) {
        const msg = `O arquivo tem ${Math.round(arquivo.size / 1048576)} MB; o limite é 100 MB.`
        toast.error(msg)
        throw new Error(msg)
      }
      try {
        const r = await enviarArquivo<{ aviso?: string | null }>(
          'kommo-anexo-enviar',
          arquivo,
          {
            'x-lead-id': String(id),
            'x-nome': encodeURIComponent(arquivo.name),
            'x-texto': encodeURIComponent(cfg.nota),
          },
          onAndamento,
        )
        if (r?.aviso) toast.error(r.aviso)
      } catch (e) {
        toast.error(`O arquivo não subiu para o Kommo: ${(e as Error).message}`)
        throw e
      }
      setAnexadosSemMover((antes) => new Set(antes).add(id))
    }
    onAndamento({ fase: 'movendo' })
    try {
      await comCardTravado(id, cfg.statusId, () =>
        mover.mutateAsync({ leadId: id, statusId: cfg.statusId, comentario: '' }),
      )
      setAnexadosSemMover((antes) => {
        const n = new Set(antes)
        n.delete(id)
        return n
      })
    } catch (e) {
      // A falha do movimento já tem aviso (o onError do mover); este diz o que
      // já está feito e o que o próximo clique faz.
      toast.error('O arquivo e a anotação já estão no card — clique em "Tentar mover de novo" para só mover.')
      throw e
    }
  }

  /**
   * A proposta escolhida (ver `BotaoEscolherProposta`): move o card para a
   * coluna que a aba declara e deixa a nota "Seguir com a proposta do(a) …".
   *
   * PELO MESMO CAMINHO DOS DESFECHOS (`moverComNota`): o movimento primeiro e a
   * nota depois, e o retry que só refaz a nota quando o card já se moveu.
   */
  async function escolherProposta(lead: KommoLead, fundo: string) {
    const statusId = abaAtual?.escolhaDeProposta
    if (!statusId) {
      toast.error('Não achei no Kommo a coluna Produção de Proposta. Sincronize e tente de novo.')
      throw new Error('coluna de destino ausente')
    }
    try {
      await comCardTravado(lead.kommo_lead_id, statusId, () =>
        moverComNota(lead.kommo_lead_id, statusId, mensagemDaProposta(fundo)),
      )
    } catch (e) {
      // A falha do MOVIMENTO já tem aviso (o onError do mover); a da NOTA, não.
      // E A RECUSA DE MOVER DE NOVO (ver `movimentoRecusado`), que também não tem.
      if (
        jaMovidos.current.has(chaveDoMovimento(lead.kommo_lead_id, statusId)) ||
        movimentoRecusado(jaMovidos.current, lead.kommo_lead_id, statusId)
      ) {
        toast.error((e as Error).message)
      }
      throw e
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
    setMensagemDoCard({ lead, acoes: [acao], titulo: acao.label })
  }

  /**
   * O desfecho AGRUPADO: um botão, três saídas, uma razão.
   *
   * É a qualificação do precatório externo. A análise aconteceu numa conversa
   * com o Claude, fora daqui, e a plataforma não tem como saber o que foi
   * decidido — quem volta é que sabe. Três botões soltos no card convidariam o
   * clique antes do texto, e o texto é o único registro que aquela análise vai
   * deixar dentro do CRM.
   */
  function concluir(lead: KommoLead, acoes: AcaoTela[]) {
    setMensagemDoCard({ lead, acoes, titulo: 'Concluir a qualificação' })
  }

  // ------------------------------------------------ ONDA 4: PARA TODOS (03/10/2026)
  //
  // Os handlers abaixo só são chamados pelos botões da onda 4 que `abaParaQuemVe`
  // entrega — a todo mundo desde 03/10/2026 (`BOTOES_NOVOS_PARA_TODOS`), antes só
  // ao administrador. NENHUM DELES RODA SOZINHO: nada move ao abrir a tela, ao
  // carregar os cards ou por parâmetro de endereço — só pelo clique.

  /** O nome de uma coluna, como a tela a mostra (o rótulo da aba dela). */
  const nomeDaColunaDoId = (statusId: number) =>
    nomeDaColuna(abas.find((a) => a.statusIds.includes(statusId))?.label ?? String(statusId))

  /** A janela do "Não fechou" aberta, com as saídas daquela Negociação. */
  const [naoFechou, setNaoFechou] = useState<{ lead: KommoLead; opcoes: DesfechoDaNegociacao } | null>(null)

  /**
   * UM DESFECHO DA NEGOCIAÇÃO: o movimento pela `kommo-mover` (que confere que o
   * card está na Negociação e marca a nota de serviço como "Comercial") e a nota
   * com o texto, pelo mesmo `moverComNota` dos desfechos — falhando a nota, quem
   * chamou mantém a janela aberta e confirmar de novo só anota.
   */
  async function desfechoDaNegociacaoNoCard(lead: KommoLead, acao: AcaoTela, nota: string) {
    await comCardTravado(lead.kommo_lead_id, acao.statusId, () =>
      moverComNota(lead.kommo_lead_id, acao.statusId, nota),
    )
  }

  /** "Gerar contrato": a Geração de contratos com SÓ o id do card no endereço. */
  const navegar = useNavigate()
  const gerarContratoDoCard = (lead: KommoLead) =>
    navegar(`/comercial/contratos?card=${encodeURIComponent(String(lead.kommo_lead_id))}`)

  // AS FASES DO FLUXO SE COMPARAM ENTRE SI (a mesma régua para a barra); a dos
  // perdidos tem régua própria — 73 reprovados não podem apagar as barras de
  // quem está em trabalho.
  const nDaAba = (key: string) => porAbaNaBusca[key]?.length ?? 0
  const fasesDoFluxo = fasesDoFunil.filter((f) => !f.discreta)
  const maiorNoFluxo = Math.max(1, ...fasesDoFluxo.flatMap((f) => f.abas.map((a) => nDaAba(a.key))))
  const temPerdidos = fasesDoFunil.some((f) => f.discreta)
  /** A grade do quadro: as fases lado a lado na tela larga, a dos perdidos mais estreita. */
  const gradeDoQuadro =
    fasesDoFunil.length === 4 && temPerdidos
      ? 'min-[1180px]:grid-cols-[repeat(3,minmax(0,1fr))_minmax(0,0.85fr)]'
      : fasesDoFunil.length >= 4
        ? 'min-[1180px]:grid-cols-4'
        : fasesDoFunil.length === 3
          ? 'min-[1180px]:grid-cols-3'
          : fasesDoFunil.length === 2
            ? 'min-[621px]:grid-cols-2'
            : ''
  const nomeDoFunil = funil === FUNIL_PRECATORIO ? 'Precatórios' : 'RPV'

  /** Os nomes das etapas achadas, como links que levam a elas (item "Novo"). */
  const linksDosAchados = (achados: typeof achadosNoFunil) =>
    achados.map((a, i) => (
      <Fragment key={a.key}>
        {i > 0 && ', '}
        <button
          type="button"
          onClick={() => irParaAba(a.key)}
          className="font-semibold text-marca-texto underline-offset-2 hover:underline"
        >
          {nomeDaColuna(a.label)} ({a.n})
        </button>
        {a.outraFase && `, na fase ${a.outraFase}`}
      </Fragment>
    ))

  const chips: { key: FiltroRapido; rotulo: string; icone?: ReactNode }[] = [
    { key: 'todos', rotulo: 'Todos' },
    { key: 'parados', rotulo: `Parados há ${PRAZO_PARADO}+ dias`, icone: <Clock className="h-[14px] w-[14px]" aria-hidden /> },
    ...(ofereceCotacao ? [{ key: 'cotados' as const, rotulo: 'Com cotação' }] : []),
    ...(ofereceProntas ? [{ key: 'prontas' as const, rotulo: 'Análise pronta' }] : []),
    ...(contagemDoFiltro.semnum > 0
      ? [{ key: 'semnum' as const, rotulo: 'Sem nº do processo', icone: <AlertTriangle className="h-[14px] w-[14px]" aria-hidden /> }]
      : []),
  ]

  return (
    <div>
      <PageHeader
        title="Análise de crédito"
        description="Acompanhe cada crédito pelo funil e aja no que está parado."
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
            {/* SECUNDÁRIO `md`, NA ALTURA DE CONTROLE (auditoria visual, A3): era
                um botão de 38px com texto de 14px, mais alto que tudo na linha. */}
            <Button
              variant="secondary"
              icon={<RefreshCw className={IC} aria-hidden />}
              onClick={() => sync.mutate()}
              loading={sync.isPending}
            >
              Sincronizar
            </Button>
          </div>
        }
      />

      {/* A BARRA DE CIMA (amostra): o tipo de crédito, a destinação (só no
          Precatório), a busca e a densidade, numa linha. A contagem sai do funil
          CARREGADO, então o outro fica sem número até ser aberto: melhor sem
          número que com número errado. */}
      <div className="mb-s3 flex flex-wrap items-center gap-s2">
        <Seg
          rotulo="Tipo de crédito"
          valor={funil === FUNIL_RPV ? 'rpv' : 'prec'}
          onChange={(k) => {
            const novo = k === 'rpv' ? FUNIL_RPV : FUNIL_PRECATORIO
            if (novo === funil) return
            setFunil(novo)
            // A chave da aba não é comparável entre funis ('pendentes' vs
            // 'int-…'). Limpar aqui evita a tela abrir vazia por casar nada.
            irParaAba('')
            // TROCAR DE FUNIL LIMPA A BUSCA; trocar de destinação a mantém.
            setBusca('')
          }}
          itens={[
            {
              key: 'rpv',
              label: 'RPV',
              icone: <Receipt className={IC} aria-hidden />,
              n: funil === FUNIL_RPV ? totalExibido : undefined,
            },
            {
              key: 'prec',
              label: 'Precatórios',
              icone: <Landmark className={IC} aria-hidden />,
              n: funil === FUNIL_PRECATORIO ? totalExibido : undefined,
            },
          ]}
        />
        {funil === FUNIL_PRECATORIO && (
          <Seg
            rotulo="Destinação do precatório"
            valor={subdivisao}
            onChange={(v) => {
              if (v === subdivisao) return
              setSubdivisao(v)
              // As chaves das abas são próprias de cada trilha ('int-…' e
              // 'ext-…'): sem limpar, a tela cairia na primeira por acidente
              // em vez de por decisão.
              irParaAba('')
            }}
            itens={SUBDIVISOES_PRECATORIO.map((s) => ({
              key: s.key,
              label: s.label,
              n: s.key === subdivisao ? totalDaTrilha?.[s.key] : undefined,
            }))}
          />
        )}
        {/* A BUSCA DAS LISTAS DE ui (auditoria visual, C3/A3): a lupa de 16px, os
            36px de altura e a tecla "/" desenhada, como o "Ctrl K" do topo — e
            não mais o "( / )" no fim do texto de exemplo, que cortava a 1280px.
            O exemplo tem até 40 caracteres; a lista inteira do que se busca vai
            no `title`. O Esc limpa a busca (o CampoDeBusca faz isso), e o "/"
            vem para cá pelo atalho comum da moldura (layout/Consultas). */}
        <CampoDeBusca
          classeDaCaixa="min-w-[240px] flex-1"
          aria-label="Buscar nos cards"
          placeholder="Buscar por nome, processo ou responsável"
          title="Busca no nome do card, no número do processo (com ou sem pontuação), no responsável e no conteúdo das anotações"
          valor={busca}
          onMudar={(v) => {
            setBusca(v)
            setMostrar(POR_VEZ)
          }}
          aria-describedby="dica-da-busca"
        />
        <span id="dica-da-busca" className="sr-only">
          Aceita o número do processo com ou sem pontuação. Esc limpa a busca; J e K andam entre os cards.
        </span>
        {/* SEM ESCOLHA DE DENSIDADE (decisão do dono, 03/10/2026): a lista é
            sempre a confortável. */}
      </div>

      {/* Coluna fixada que o kanban não tem. Vermelho, e não amarelo: aqui a aba
          fica vazia PARA SEMPRE, e é defeito de configuração, não recado. */}
      {rpvDesalinhado.length > 0 && (
        <CaixaDeAviso tom="perigo" className="mb-4">
          A coluna do Kommo de <strong>{rpvDesalinhado.map((t) => t.label).join(', ')}</strong> não existe
          mais neste funil. A aba vai mostrar zero card até alguém corrigir o número da coluna em
          src/lib/kommo.ts.
        </CaixaDeAviso>
      )}
      {precatorioDesalinhado.length > 0 && (
        <CaixaDeAviso tom="perigo" className="mb-4">
          Não achei no Kommo a coluna{' '}
          <strong>{precatorioDesalinhado.map((a) => `"${a.colunaKommo}"`).join(', ')}</strong>. A aba
          correspondente ({precatorioDesalinhado.map((a) => a.label).join(', ')}) fica com zero card até o
          nome bater. Causa provável: a coluna foi renomeada no Kommo — é só alinhar o nome lá ou em
          src/lib/kommo.ts.
        </CaixaDeAviso>
      )}

      {/* ONDE A BUSCA ACHOU (item "Novo"): uma faixa sobre o quadro, com as
          etapas e as contagens, e cada nome leva à etapa. */}
      {achadosNoFunil.length > 0 && (
        <p className="-mt-1 mb-[14px] flex flex-wrap items-center gap-x-1 gap-y-1 text-corpo text-texto-2" role="status">
          <Search className={cn(IC, 'mr-1 text-marca-texto')} aria-hidden />
          Achei em: {linksDosAchados(achadosNoFunil)}.
        </p>
      )}

      {abas.length > 0 ? (
        // O QUADRO DE FASES (amostra): Qualificação, Comercialização,
        // Formalização e Perdidos, as colunas do Kommo em cada uma, com a
        // contagem e uma barra do tamanho dela. A fase da coluna aberta ganha
        // moldura; a dos perdidos é mais discreta, porque não é etapa do fluxo;
        // coluna vazia fica esmaecida, mas legível. COM BUSCA, todo número vira
        // contagem de resultado.
        // MAIS BAIXO, E SEMPRE ABERTO (auditoria visual, A1a; o recolhível, AP1,
        // foi recusado pelo dono em 03/10/2026): linhas de 32px, a barrinha de
        // 2px colada ao nome e o cartão com 12px de folga — os cards sobem para
        // a dobra sem esconder fase nenhuma.
        <section
          aria-label="Visão do funil por fases"
          className={cn('mb-s4 grid grid-cols-1 gap-s2 min-[621px]:grid-cols-2', gradeDoQuadro)}
        >
          {fasesDoFunil.map((f, i) => {
            const total = f.abas.reduce((t, a) => t + nDaAba(a.key), 0)
            const atual = i === indiceDaFase
            const maior = f.discreta ? Math.max(1, ...f.abas.map((a) => nDaAba(a.key))) : maiorNoFluxo
            const proxima = fasesDoFunil[i + 1]
            return (
              <div
                key={f.nome ?? 'etapas'}
                className={cn(
                  'relative min-w-0 rounded-cartao border p-s3 shadow-nivel-1 dark:shadow-none',
                  f.discreta ? 'bg-superficie-2' : 'bg-superficie',
                  atual ? 'border-marca-viva/45 ring-[3px] ring-marca-viva/10' : 'border-borda',
                )}
              >
                <div className="flex items-center gap-s2 px-s1 pb-s2">
                  {f.nome && (
                    <span
                      aria-hidden
                      className={cn(
                        'font-display grid h-[22px] w-[22px] flex-none place-items-center rounded-full text-xs font-bold',
                        atual ? 'bg-marca text-white' : 'bg-superficie-3 text-texto-2',
                      )}
                    >
                      {f.discreta ? <X className="h-[12px] w-[12px]" aria-hidden /> : i + 1}
                    </span>
                  )}
                  <h2
                    className={cn(
                      'font-display text-corpo font-bold',
                      f.discreta ? 'text-texto-2' : 'text-texto',
                    )}
                  >
                    {f.nome ?? 'Etapas'}
                  </h2>
                  <span className="ml-auto text-sm font-bold tabular-nums text-texto-2">{total}</span>
                </div>
                <ul className="m-0 grid list-none gap-s0.5 p-0">
                  {f.abas.map((a) => {
                    const n = nDaAba(a.key)
                    const ativa = a.key === abaAtual?.key
                    const vazia = n === 0
                    const nome = nomeDaColuna(a.label)
                    return (
                      <li key={a.key}>
                        <button
                          type="button"
                          aria-pressed={ativa}
                          onClick={() => irParaAba(a.key)}
                          title={`${nome} — ${n} ${busca.trim() ? 'resultado(s) da busca' : 'crédito(s)'}`}
                          className={cn(
                            'relative grid h-[32px] w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-s2 rounded-controle px-s2 pb-s0.5 text-left transition-colors',
                            ativa ? 'bg-marca-suave' : 'hover:bg-superficie-3',
                          )}
                        >
                          <span
                            className={cn(
                              'truncate text-sm',
                              ativa
                                ? 'font-bold text-marca-texto'
                                : vazia
                                  ? 'font-medium text-texto-3'
                                  : 'font-medium text-texto',
                            )}
                          >
                            {nome}
                          </span>
                          <span
                            className={cn(
                              'text-right text-sm tabular-nums',
                              ativa ? 'font-bold text-marca-texto' : vazia ? 'font-medium text-texto-3' : 'font-bold text-texto',
                            )}
                          >
                            {n}
                          </span>
                          {/* A BARRA EMBAIXO DO NOME: o comprimento compara as
                              etapas sem ler número, e o nome inteiro cabe. 2PX,
                              COLADA AO NOME (A1a): era um traço de 3px a meio
                              caminho da linha seguinte. */}
                          <span
                            aria-hidden
                            className={cn(
                              'absolute bottom-[4px] left-s2 right-s2 h-[2px] overflow-hidden rounded-full',
                              ativa ? 'bg-marca-viva/20' : 'bg-superficie-3',
                            )}
                          >
                            <span
                              className={cn(
                                'block h-full rounded-full',
                                ativa ? 'bg-marca-viva' : f.discreta ? 'bg-texto-3/50' : 'bg-marca-viva/70',
                              )}
                              style={{ width: `${larguraDaBarra(n, maior)}%` }}
                            />
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
                {/* A SETA ENTRE AS FASES DO FLUXO — não entre o fluxo e os perdidos. */}
                {!f.discreta && proxima && !proxima.discreta && (
                  <span
                    aria-hidden
                    className="absolute -right-[13px] top-[14px] z-[1] hidden h-[18px] w-[18px] place-items-center rounded-full bg-papel text-texto-3 min-[1180px]:grid"
                  >
                    <ChevronRight className="h-[14px] w-[14px]" />
                  </span>
                )}
              </div>
            )
          })}
        </section>
      ) : etapas.isLoading ? (
        <Card className="mb-6 p-4">
          <Loading label="Carregando as etapas do Kommo…" />
        </Card>
      ) : etapas.isError ? (
        // A MENSAGEM REAL, não um palpite: se o problema fosse permissão de
        // leitura da tabela, sincronizar de novo não mudaria nada.
        <CaixaDeAviso tom="perigo" className="mb-6">
          Não consegui ler as etapas deste funil: {(etapas.error as Error)?.message}{' '}
          <LinkTentarDeNovo tentando={etapas.isFetching} onClick={() => void etapas.refetch()} />
        </CaixaDeAviso>
      ) : (
        // Espelho vazio: o kommo-sync não gravou a estrutura do kanban. Dizer
        // isso é melhor que mostrar uma tela vazia, que se leria como "não tem
        // crédito nenhum".
        <Card className="mb-6">
          <EmptyState
            title="Ainda não sei as etapas deste funil"
            description={
              <>
                Elas vêm do próprio Kommo — clique em <strong>Sincronizar</strong>, no alto da página. Se
                continuar assim, a sincronização não conseguiu ler a estrutura do kanban e o aviso dela vai
                aparecer aqui.
              </>
            }
          />
        </Card>
      )}

      <section aria-live="polite" aria-label="Cards da etapa">
        {abaAtual && (
          // O CABEÇALHO DA ETAPA (item "Novo"): a fase, o nome com a contagem e
          // uma frase do que se faz nela.
          //
          // H2 DE 18PX (auditoria visual, A2): em 24px extrabold a etapa tinha
          // quase o tamanho do título da página. A FRASE NUMA LINHA SÓ (A1a), com
          // o texto inteiro no `title`: em duas linhas ela empurrava os cards.
          <div className="mb-s3 min-w-0">
            {faseAberta?.nome && (
              <p className="font-display text-xs font-bold uppercase tracking-[.06em] text-marca-texto">
                {faseAberta.discreta ? 'Fora do fluxo' : `Fase ${indiceDaFase + 1} · ${faseAberta.nome}`}
              </p>
            )}
            <h2 className="font-display mt-s0.5 flex items-center gap-s2 text-xl font-bold tracking-tight text-texto">
              {nomeDaColuna(abaAtual.label)}
              <span className="rounded-full bg-marca-suave px-s2 py-s0.5 text-sm font-bold tabular-nums text-marca-texto">
                {lista.length}
              </span>
            </h2>
            {abaAtual.descricao && (
              <p className="mt-s1 line-clamp-1 max-w-[720px] text-corpo text-texto-2" title={abaAtual.descricao}>
                <TextoComTermos texto={abaAtual.descricao} />
              </p>
            )}
          </div>
        )}

        {/* OS FILTROS RÁPIDOS (item "Novo"), com a contagem: um clique mostra os
            parados, os com cotação, os com análise pronta ou os sem número. */}
        {/* VISÍVEIS TAMBÉM COM A ETAPA VAZIA ("Todos 0"), como na amostra: a
            barra que some e volta conforme a etapa faz a lista pular. Só não
            aparecem antes de os cards chegarem — "0" ali seria afirmação falsa. */}
        {/* OS CHIPS E O ORDENAR NA MESMA LINHA (auditoria visual, A1a): a ordem
            ficava sozinha à direita do cabeçalho da etapa, numa linha a mais. Os
            chips são o `Chip` de ui (C7): aceso, o azul suave da marca — o preto
            de antes era o elemento mais escuro da tela. */}
        {abaAtual && (
          <div className="mb-s3 flex flex-wrap items-center gap-s2">
            {leads.data && (
              <div role="group" aria-label="Filtros rápidos" className="flex flex-wrap gap-s2">
                {chips.map((c) => (
                  <Chip
                    key={c.key}
                    ativo={filtro === c.key}
                    icone={c.icone}
                    contagem={contagemDoFiltro[c.key]}
                    onClick={() => {
                      setFiltro(c.key)
                      setMostrar(POR_VEZ)
                    }}
                  >
                    {c.rotulo}
                  </Chip>
                ))}
              </div>
            )}
            <label className="ml-auto flex h-controle w-[270px] items-center gap-s2 rounded-campo border border-borda-controle bg-superficie px-s3 text-texto-3 focus-within:border-anel focus-within:ring-[3px] focus-within:ring-anel/20 max-[900px]:w-full">
              <span className="sr-only">Ordenar</span>
              <History className={IC} aria-hidden />
              <select
                value={ordem}
                onChange={(e) => {
                  const nova = lerOrdem(e.target.value)
                  setOrdem(nova)
                  gravarPreferencia(PREF_ORDEM_DA_ANALISE, nova)
                  setMostrar(POR_VEZ)
                }}
                className="w-full min-w-0 cursor-pointer bg-transparent text-corpo text-texto outline-none"
              >
                <option value="recente">Entrada mais recente na etapa</option>
                <option value="parado">Mais tempo na etapa</option>
              </select>
            </label>
          </div>
        )}

        {leads.isLoading ? (
          <Card>
            <Loading />
          </Card>
        ) : leads.isError ? (
          <Card>
            <ErrorState message={(leads.error as Error)?.message} onRetry={() => leads.refetch()} />
          </Card>
        ) : filtrados.length === 0 ? (
          // OS VAZIOS COM A REGRA DE ui (auditoria visual, §0.10): o que o FILTRO
          // ou a BUSCA esconderam é uma linha simples, com o jeito de desfazer ao
          // lado; a moldura tracejada fica para o vazio de verdade, a etapa que
          // não tem card nenhum.
          lista.length > 0 ? (
            <Card>
              <SemResultado
                texto="Nenhum card com esse filtro nesta etapa."
                onLimpar={() => setFiltro('todos')}
                rotuloLimpar="Limpar filtro"
              />
            </Card>
          ) : busca.trim() ? (
            <Card>
              <SemResultado
                texto={
                  achadosEmOutrasAbas.length ? (
                    <>Nenhum card corresponde à busca nesta etapa. Achei em: {linksDosAchados(achadosEmOutrasAbas)}.</>
                  ) : (
                    `Nenhum card corresponde à busca em nenhuma etapa do funil de ${nomeDoFunil}. O card pode estar no outro funil${
                      funil === FUNIL_PRECATORIO ? ' ou na outra destinação' : ''
                    }.`
                  )
                }
                onLimpar={() => {
                  setBusca('')
                  setMostrar(POR_VEZ)
                }}
                rotuloLimpar="Limpar a busca"
              />
            </Card>
          ) : (
            <div className="rounded-cartao border border-dashed border-borda-forte bg-superficie">
              <EmptyState
                title={`Nenhum card em ${abaAtual ? nomeDaColuna(abaAtual.label) : 'nenhuma etapa'}`}
                description={
                  abaAtual?.descricaoVazia ??
                  'Este funil ainda não tem card nenhum no Kommo. Quando o comercial criar um, ele aparece aqui na próxima sincronização.'
                }
              />
            </div>
          )
        ) : (
          <>
            <div className="grid gap-s2">
              {filtrados.slice(0, mostrar).map((l) => (
                <CardCredito
                  key={l.kommo_lead_id}
                  lead={l}
                  onCopiar={copiar}
                  acoes={abaAtual?.acoes ?? []}
                  // O AGRUPADO NÃO VAI UM BOTÃO POR SAÍDA: ele sai de um botão
                  // só, o "Concluir", junto dos outros de trabalho.
                  desfechoNoCard={
                    abaAtual?.key !== ABA_RPV_DESFECHO_NA_JANELA && !abaAtual?.desfechoAgrupado
                  }
                  onConcluir={
                    abaAtual?.desfechoAgrupado && (abaAtual?.acoes.length ?? 0) > 0
                      ? (l) => concluir(l, abaAtual.acoes)
                      : undefined
                  }
                  onAbrirAnexo={abrirAnexo}
                  onPrepararAnexo={prepararAnexo}
                  // AS ETIQUETAS NAS ABAS DE `ABAS_COM_TAGS`: é onde elas dizem
                  // para qual fundo o crédito foi, ou por que não foi.
                  mostrarTags={ABAS_COM_TAGS.has(abaAtual?.key ?? '')}
                  // E EDITÁVEIS SÓ EM "EM PRECIFICAÇÃO" — ver `etiquetasDaAba`.
                  etiquetasOferecidas={etiquetasDaAba(abaAtual?.key)}
                  onEtiquetar={(l, etiqueta, acao) => {
                    if (etiquetaEmVoo[l.kommo_lead_id] !== undefined) return
                    // "COTADO ‹FUNDO›" ABRE A JANELA DA COTAÇÃO (05/10/2026): a
                    // etiqueta só entra com o valor, pelo Enviar dela. Tirar a
                    // etiqueta, e "Enviado"/"Reprovado", seguem como sempre. O
                    // seletor só existe na Em precificação (`etiquetasDaAba`) — a
                    // Remessa aos fundos tem o seu próprio caminho e não passa aqui.
                    if (
                      acao === 'adicionar' &&
                      etiquetasDaAba(abaAtual?.key).some((e) => e.ato === 'Cotado' && mesmaEtiqueta(e.nome, etiqueta))
                    ) {
                      abrirCotacao(l, etiqueta)
                      return
                    }
                    setEtiquetaEmVoo((m) => comecarNoCard(m, l.kommo_lead_id, etiqueta))
                    etiquetar.mutate({ leadId: l.kommo_lead_id, etiqueta, acao })
                  }}
                  onEditarCotacao={etiquetasDaAba(abaAtual?.key).length > 0 ? abrirCotacao : undefined}
                  etiquetaEmVoo={etiquetaEmVoo[l.kommo_lead_id] ?? null}
                  // A ANOTAÇÃO EM TODO CARD, de toda etapa e funil (30/09/2026).
                  onAnotar={anotarNoCard}
                  // A ESCOLHA DA PROPOSTA, onde a aba a declara — ver
                  // `escolhaDeProposta` em trilhasDoPrecatorio.ts.
                  onEscolherProposta={abaAtual?.escolhaDeProposta ? escolherProposta : undefined}
                  // OS CHECKS DO ENVIO AOS FUNDOS, onde a aba os declara — a Remessa.
                  envioAosFundos={
                    abaAtual?.envioAosFundos
                      ? {
                          fundos: abaAtual.envioAosFundos.fundos,
                          destino: abaAtual.envioAosFundos.destino,
                          onAbrir: (lead, fundo) => setEnvioAberto({ lead, fundo }),
                          onMover: (lead) => void moverAposOsFundos(lead).catch(() => null),
                        }
                      : undefined
                  }
                  // ANEXAR E MOVER, onde a aba o declara — o Memorando do Externo.
                  anexarEMover={
                    abaAtual?.anexarEMover
                      ? {
                          rotulo: abaAtual.anexarEMover.rotulo,
                          soMover: anexadosSemMover.has(l.kommo_lead_id),
                          onEnviar: anexarEMover,
                        }
                      : undefined
                  }
                  onAcao={acionar}
                  // EM RPV o selo aparece só na Análise: nas etapas seguintes a
                  // análise já passou pela revisão, e dizer "finalizado" ali seria
                  // ruído. NO PRECATÓRIO ele aparece em toda aba — sem o selo,
                  // card com análise pronta ficaria idêntico a card que ninguém tocou.
                  analisePronta={
                    funil === FUNIL_RPV && abaAtual?.key !== 'pendentes'
                      ? null
                      : (prontas.data?.has(l.kommo_lead_id) ?? false)
                  }
                  statusEmAndamento={emAndamento[l.kommo_lead_id] ?? null}
                  onAnalisar={onAnalisar}
                  analisando={rpvLead?.kommo_lead_id === l.kommo_lead_id}
                  resultadoAnalise={
                    funil === FUNIL_RPV && abaAtual?.key !== 'pendentes' ? undefined : resultadoAnalise[l.kommo_lead_id]
                  }
                  onDueDiligence={onDueDiligence}
                  onAnaliseExterna={onAnaliseExterna}
                  onBaixarAnexos={(l) => void baixarAnexosDoCard(l)}
                  preparoDosAutos={preparoDosAutos[l.kommo_lead_id]}
                  onPreencherPlanilha={(l) => setPlanilhaLead(l)}
                  analisandoJuridico={analisandoJur[l.kommo_lead_id] === true}
                  resultadoJuridico={resultadoJuridico[l.kommo_lead_id]}
                  botoes={botoesDoCard}
                  onCertidoes={abaAtual?.certidoes ? onCertidoes : undefined}
                  // A JUSTIFICATIVA TÉCNICA, onde a aba a declara.
                  justificativa={
                    abaAtual?.justificativaTecnica
                      ? { resumo: justificativas.data?.[l.kommo_lead_id], onAbrir: setJustificativaLead }
                      : undefined
                  }
                  // ONDA 4: os campos só existem na aba que `abaParaQuemVe`
                  // entrega com eles — a todos desde 03/10/2026; sem eles, nada
                  // disto é passado.
                  negociacao={
                    abaAtual?.negociacao
                      ? {
                          opcoes: abaAtual.negociacao,
                          destinoDoFechado: abaAtual.negociacao.fechado
                            ? nomeDaColunaDoId(abaAtual.negociacao.fechado.statusId)
                            : '',
                          onFechado: (lead, nota) =>
                            desfechoDaNegociacaoNoCard(lead, abaAtual.negociacao!.fechado!, nota),
                          onNaoFechou: (lead) => setNaoFechou({ lead, opcoes: abaAtual.negociacao! }),
                        }
                      : undefined
                  }
                  onGerarContrato={abaAtual?.gerarContrato ? gerarContratoDoCard : undefined}
                  realcado={realce === l.kommo_lead_id}
                />
              ))}
            </div>
            {/* DE 8 EM 8 (item "Novo"): a lista longa não empurra a página
                inteira, e o botão diz quantos faltam. */}
            {filtrados.length > mostrar && (
              <div className="mt-[14px] flex justify-center">
                <Button variant="secondary" className={BTN} onClick={() => setMostrar((m) => m + POR_VEZ)}>
                  Mostrar mais {Math.min(POR_VEZ, filtrados.length - mostrar)}
                  <span className="font-medium text-texto-3">
                    · {mostrar} de {filtrados.length}
                  </span>
                </Button>
              </div>
            )}
          </>
        )}
      </section>

      {planilhaLead && (
        <JanelaDaPlanilha
          lead={planilhaLead}
          onFechar={() => setPlanilhaLead(null)}
          onPreencher={(colado) => preencherPlanilha(planilhaLead, colado)}
          onMotorAntigo={() => void onAnaliseJuridica(planilhaLead)}
        />
      )}

      {/* A JUSTIFICATIVA TÉCNICA: uma janela só, sempre montada — a trava do
          Enviar, por card, sobrevive a fechar e reabrir. */}
      <JanelaJustificativa
        lead={justificativaLead}
        autor={analistaNome}
        onFechar={() => setJustificativaLead(null)}
        onEnviada={justificativaEnviada}
      />

      {envioAberto && (
        <JanelaDoEnvioAoFundo
          key={`${envioAberto.lead.kommo_lead_id}-${envioAberto.fundo.fundo}`}
          fundo={envioAberto.fundo}
          // O CAMPO DO FUNDO COMO ESTÁ NO CARD: a cotação começa dele (o BTG).
          atual={
            cotacoesDoCard(envioAberto.lead.raw?.custom_fields_values, [envioAberto.fundo.fundo])[
              envioAberto.fundo.fundo
            ] ?? null
          }
          onFechar={() => setEnvioAberto(null)}
          onConfirmar={async (ato, texto, arquivos, cotacao, onAndamento) => {
            await enviarAoFundo(envioAberto.lead, envioAberto.fundo, ato, texto, arquivos, cotacao, onAndamento)
            setEnvioAberto(null)
          }}
        />
      )}

      {/* A JANELA DA COTAÇÃO, aberta pelo "Cotado ‹fundo›" do seletor (ou pelo
          lápis ao lado dele): pré-preenchida com o que o campo do card já tem. */}
      {cotando && (
        <JanelaDeCotacao
          key={`${cotando.lead.kommo_lead_id}-${cotando.etiqueta}`}
          fundo={cotando.fundo}
          etiqueta={cotando.etiqueta}
          atual={cotacoesDoCard(cotando.lead.raw?.custom_fields_values)[cotando.fundo] ?? null}
          enviando={etiquetaEmVoo[cotando.lead.kommo_lead_id] !== undefined}
          onEnviar={(c) => enviarCotacao(cotando.lead, cotando.etiqueta, c)}
          onFechar={() => setCotando(null)}
        />
      )}

      {mensagemDoCard && (
        <JanelaDeMensagem
          key={`${mensagemDoCard.lead.kommo_lead_id}-${mensagemDoCard.acoes.map((a) => a.statusId).join('-')}`}
          lead={mensagemDoCard.lead}
          acoes={mensagemDoCard.acoes}
          titulo={mensagemDoCard.titulo}
          // O RESUMO DA OPORTUNIDADE SÓ NA APROVAÇÃO, e só quando a janela tem
          // UMA saída: é o que a coluna seguinte precisa para montar a proposta.
          // Numa diligência ou reprovação ele seria a ficha de um crédito que
          // não vai adiante — e numa janela de três saídas ele apareceria antes
          // de a pessoa ter escolhido, sugerindo a aprovação.
          sugestao={
            mensagemDoCard.acoes.length === 1 &&
            mensagemDoCard.acoes[0].papel === 'aprovar' &&
            mensagemDoCard.lead.oportunidade
              ? resumoDaOportunidade(mensagemDoCard.lead.oportunidade)
              : ''
          }
          // A CAIXA DO RESUMO (onda 4): no Concluir do RPV — várias saídas, uma
          // delas aprovar —, para todos desde 03/10/2026. Fora dele, a janela de sempre.
          resumo={
            mensagemDoCard.lead.pipeline_id === FUNIL_RPV &&
            mensagemDoCard.acoes.length > 1 &&
            mensagemDoCard.acoes.some((a) => a.papel === 'aprovar')
              ? mensagemDoCard.lead.oportunidade
                ? resumoDaOportunidade(mensagemDoCard.lead.oportunidade)
                : ''
              : null
          }
          // O CARD DESTA JANELA, e não a página: `mover.isPending` diz só da
          // última movimentação pedida, de qualquer card.
          ocupado={emAndamento[mensagemDoCard.lead.kommo_lead_id] !== undefined}
          jaMovido={jaMovidoPara(mensagemDoCard.lead.kommo_lead_id)}
          onConfirmar={async (acao, mensagem) => {
            const leadId = mensagemDoCard.lead.kommo_lead_id
            await comCardTravado(leadId, acao.statusId, () => moverComNota(leadId, acao.statusId, mensagem))
            setMensagemDoCard(null)
          }}
          onFechar={() => {
            esquecerMovimentos(mensagemDoCard.lead.kommo_lead_id)
            setMensagemDoCard(null)
          }}
        />
      )}

      {naoFechou && (
        <JanelaNaoFechou
          key={naoFechou.lead.kommo_lead_id}
          lead={naoFechou.lead}
          opcoes={{
            ...(naoFechou.opcoes.naoFechou ? { recusou: naoFechou.opcoes.naoFechou } : {}),
            ...(naoFechou.opcoes.semResposta ? { sumiu: naoFechou.opcoes.semResposta } : {}),
          }}
          nomeDaColuna={nomeDaColunaDoId}
          jaMovido={jaMovidoPara(naoFechou.lead.kommo_lead_id)}
          onConfirmar={async (acao, nota) => {
            await desfechoDaNegociacaoNoCard(naoFechou.lead, acao, nota)
            setNaoFechou(null)
          }}
          onFechar={() => {
            esquecerMovimentos(naoFechou.lead.kommo_lead_id)
            setNaoFechou(null)
          }}
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
            await comCardTravado(rpvLead.kommo_lead_id, statusId, () =>
              moverComNota(rpvLead.kommo_lead_id, statusId, comentario),
            )
            // A janela fecha porque o card saiu desta aba: manter aberta uma
            // análise de um card que já foi movido é oferecer botões que não
            // valem mais. E os bytes saem por aqui também — ver soltarBytes: o
            // desfecho é uma porta de saída como qualquer outra.
            soltarBytes(rpvLead.kommo_lead_id)
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
            // O SELO "FINALIZADO" da lista: o 'salvar' acabou de gravar a linha
            // em kommo_analise_interna, e sem invalidar o cache ele só apareceria
            // na próxima visita à tela.
            qc.invalidateQueries({ queryKey: ['kommo_analise_interna'] })
            // E O CARD: o 'salvar' gravou drive_pasta_id e oportunidade em
            // kommo_leads. Com staleTime de 30 s e sem refetch no foco, o título
            // ficava sem link e o Aprovar de Validação abria sem resumo até
            // alguém mover o card ou sincronizar.
            qc.invalidateQueries({ queryKey: ['kommo_leads'] })
            void anotarResultadoNaKommo(rpvLead.kommo_lead_id, final, analistaNome).then((falhas) => {
              if (falhas.length) toast.error('A análise foi salva no Drive, mas a anotação no card do Kommo não subiu: ' + falhas.join('; '))
            })
          }}
          onClose={() => {
            soltarBytes(rpvLead.kommo_lead_id)
            // COMO AS OUTRAS JANELAS QUE MOVEM: o movimento que ficou sem nota
            // aqui não pode fazer um movimento futuro do card ser PULADO.
            esquecerMovimentos(rpvLead.kommo_lead_id)
            setRpvLead(null)
          }}
        />
      )}

      {certLead && (
        <JanelaDeCertidoes
          key={certLead.kommo_lead_id}
          leadId={certLead.kommo_lead_id}
          tituloDoCard={tituloCard(certLead)}
          cedenteDoCard={lerCardCredijuris(certLead).cedente}
          arquivos={arquivosCache[certLead.kommo_lead_id] ?? []}
          lendoPdf={
            lendoPdf.has(certLead.kommo_lead_id) ||
            rpvLead?.kommo_lead_id === certLead.kommo_lead_id
          }
          avisoPdf={avisoPdf[certLead.kommo_lead_id] ?? null}
          onClose={() => setCertLead(null)}
        />
      )}

      {ddLead && (
        <DueDiligence
          // key pelo card: trocar de card remonta a janela do zero, em vez de
          // reaproveitar o formulário já preenchido com os dados do anterior.
          key={ddLead.kommo_lead_id}
          open
          leadId={ddLead.kommo_lead_id}
          tituloDoCard={tituloCard(ddLead)}
          cedenteDoCard={lerCardCredijuris(ddLead).cedente}
          arquivos={arquivosCache[ddLead.kommo_lead_id] ?? []}
          lendoPdf={
            lendoPdf.has(ddLead.kommo_lead_id) ||
            rpvLead?.kommo_lead_id === ddLead.kommo_lead_id
          }
          avisoPdf={avisoPdf[ddLead.kommo_lead_id] ?? null}
          // Certidões só no precatório do INTERNO. Lido do CARD, não do funil
          // nem da pílula abertos: o card guardado no estado é quem manda, e
          // trocar de recorte com a janela aberta não pode mudar as frentes da
          // diligência em curso — daí `ehCardExterno` responder pelo FUNIL do
          // card e não por `subdivisao`.
          //
          // NOS FUNDOS SÓ PROCESSOS JUDICIAIS, como em RPV. O checklist de
          // certidões é a diligência documental que precede a NOSSA aquisição;
          // no crédito que vai ao fundo quem a monta é ele, e abrir a aba aqui
          // convidaria a equipe a emitir certidão para um dossiê que não é nosso.
          // A exceção é a Obtenção de documentação (29/09/2026): vendido o
          // crédito, o fundo pede as certidões — e lá o card tem o botão
          // "Certidões", que abre só este painel (ver JanelaDeCertidoes).
          comCertidoes={
            ehFunilPrecatorio(ddLead.pipeline_id) && !ehCardExterno(ddLead.pipeline_id)
          }
          // A RECUSA, no rodapé da janela.
          //
          // NÃO É UMA SEGUNDA PORTA para a mesma decisão. A janela da análise
          // recusa pelos ACHADOS deste processo; aqui se recusa pelos PROCESSOS
          // DE TERCEIRO que a apuração achou — evidência que a análise não tem e
          // que só existe depois que alguém apurou. Obrigar a fechar a
          // diligência, achar o card na lista e abrir outra coisa seria pedir
          // para decidir com a lista de processos fora da vista.
          //
          // DO FUNIL DO CARD, e não da aba aberta: a apuração acontece em
          // qualquer etapa, inclusive na trilha Externa, que não tem desfecho
          // nenhum — lá a janela ficava só com "Seguir", achando execução contra
          // o cedente e sem oferecer como recusar. Só não aparece no card que já
          // está em Reprovados: mover para onde ele já está não é decisão.
          acaoReprovar={(() => {
            const a = acaoDeReprovar(ddLead.pipeline_id, etapas.data ?? [])
            return a && a.statusId !== ddLead.status_id ? a : null
          })()}
          // SEGUIR É O QUE DESTRAVA O TRABALHO SEGUINTE, e qual é ele depende do
          // funil: em RPV a análise precifica, no precatório interno a jurídica
          // opina. Onde não há análise — a trilha Externa, cuja opinião é do
          // fundo — Seguir apenas libera a diligência e fecha a janela.
          // NO PRECATÓRIO, SEGUIR SÓ LIBERA E FECHA, nas duas trilhas. No
          // Interno ele rodava a análise jurídica antiga — que desde 28/09/2026
          // é justamente o que a equipe pediu para evitar: planilha feita numa
          // leitura à parte, sem o contexto da conversa. O próximo passo é o
          // "Executar análise" do card, que não pode sair daqui: o Seguir chama
          // depois de gravar no banco, e aí o navegador já não deixa abrir o Claude.
          onSeguir={
            botoesDoCard === 'rpv' ? () => onAnalisar(ddLead) : undefined
          }
          onMover={async (statusId, comentario) => {
            await comCardTravado(ddLead.kommo_lead_id, statusId, () =>
              moverComNota(ddLead.kommo_lead_id, statusId, comentario),
            )
            // O card saiu desta aba: manter a diligência aberta seria oferecer
            // uma apuração de um crédito que já foi recusado.
            setDdLead(null)
          }}
          onClose={() => {
            esquecerMovimentos(ddLead.kommo_lead_id)
            setDdLead(null)
          }}
        />
      )}
    </div>
  )
}
