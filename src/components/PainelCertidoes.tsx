// Checklist de certidões do crédito: cadastro dos sujeitos e o placar de
// completude, no card do Kommo.
//
// É A ABA "CERTIDÕES" DA JANELA DE DUE DILIGENCE (components/DueDiligence.tsx).
// Já foi um modal inteiro, com título e rodapé próprios; virou painel quando a
// due diligence passou a ter duas frentes — certidões e processos judiciais. Daí
// as ações ("Gravar e montar checklist", "Corrigir dados") ficarem no fim do
// PAINEL e não no rodapé da janela: ali embaixo pareceriam valer para as duas
// abas. Daí também `ativo` no lugar de `open`, e `onDirtyChange` — só a janela
// pede confirmação de descarte, e só o painel sabe que há o que descartar.
//
// A REGRA QUE ESTA TELA SERVE, e que é a razão de o sistema existir: "não
// consegui emitir" não é "não precisa emitir". O checklist é montado ANTES de
// qualquer emissão, congelado no banco, e a etapa documental só fecha quando
// todas as obrigatórias existem em arquivo (migração 0042, dd_concluir_documental).
// Esta tela é a porta de entrada disso: sem sujeito cadastrado não há checklist,
// e sem checklist ninguém sabe o que está faltando.
//
// TRÊS COISAS ELA NÃO FAZ, e não é falta de implementação:
//
// 1. NÃO ADIVINHA O CPF. Os candidatos vindos do PDF são sugestão com o trecho
//    do documento ao lado; quem confere escolhe. Ver src/lib/cpfNoTexto.ts.
// 2. NÃO ESCONDE LACUNA. Cônjuge não informado, sócio PJ não informado,
//    histórico de residência não levantado e certidão dispensada aparecem como
//    aviso mesmo com o placar cheio.
// 3. NÃO DIZ "COMPLETO" SOZINHA. O placar vem de v_dd_completude, e as dispensas
//    aparecem ao lado dele — porque dispensar encolhe o denominador, e "14 de 14
//    com 8 dispensadas" lido como "14 de 14" é a forma mais fácil de fechar um
//    dossiê furado.
//
// Os avisos são DERIVADOS do banco em cada abertura, não guardados da resposta
// da função. A versão anterior só os mostrava nos segundos seguintes ao clique
// em "Montar checklist": reabrir o card fazia o aviso "nenhum cônjuge informado"
// desaparecer, e nada mais na tela dizia que o bloco do cônjuge nunca foi
// considerado.
//
// O VISUAL É O DA AMOSTRA (janelas-analise.js, `painelCertidoes`): cadastro em
// grade, "o que achei nos anexos" numa caixa suave com os candidatos, a caixa da
// IA, o placar em cartões de número, os avisos numa lista âmbar e o checklist em
// blocos por pessoa. SÓ A APRESENTAÇÃO MUDOU: as regras acima, as gravações e as
// mensagens são as de antes.
//
// 03/10/2026, MAIS ENXUTO (pedido do dono: "tá muito poluído"): o placar em
// cartões e a lista âmbar viraram uma FAIXA DE RESUMO (cedente, origem, placar e
// o atalho da pasta no Drive) e uma linha de lacunas que abre; o checklist passou
// de blocos por pessoa a grupos por ESTADO (problemas primeiro, obtidas
// recolhidas), uma linha densa por certidão; a leitura da IA e dos anexos virou
// uma linha de estado que abre. As regras de agrupar e contar moram em
// lib/checklistDeCertidoes.ts. Nada saiu: tudo continua a um clique.
//
// 03/10/2026, PEDIDO DO DONO: a leitura da IA tem de trazer os dados DO CEDENTE,
// "e ninguém mais", e o cedente pode ser empresa. Daí: o nome do cedente vai
// para dd-qualificacao, que só devolve o que está na qualificação dele; a caixa
// dos achados mostra o que a IA identificou, com o trecho, e a busca crua (todo
// CPF do processo) vai para um "Outros números" recolhido; e o cadastro escolhe
// pessoa física ou jurídica — CNPJ, razão social e sede, sem nascimento nem
// cônjuge —, gravada com tipo_pessoa 'PJ' (migração 0075).
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  Clock,
  ExternalLink,
  FileText,
  Folder,
  HelpCircle,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  X,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/cn'
import { perguntarDescarte } from '@/lib/descarte'
import { CopiarTexto } from '@/components/ui/BotaoCopiar'
import {
  agruparChecklist,
  avisoDaIAEmDestaque,
  conferenciaDoOficio,
  GRUPOS_RECOLHIDOS,
  hojeEmBrasilia,
  origemDoCadastro,
  pastaDoChecklistNaTela,
  placarDoChecklist,
  ROTULO_DO_GRUPO,
  rotuloNoNumero,
  vencida,
  type PastaNaTela,
} from '@/lib/checklistDeCertidoes'
import { invokeFunction } from '@/lib/functions'
import { cnpjValido, cpfValido, formatCpfCnpjInput, onlyDigits } from '@/lib/format'
import type { ArquivoLido } from '@/pages/operacional/AnaliseCredito'
import { acharDocumentos, type DocumentoEncontrado } from '@/lib/cpfNoTexto'
import { lerUfsDigitadas } from '@/lib/ufsDigitadas'
import { Segmented } from '@/components/ui/Segmented'
import {
  acharEstadoCivil,
  acharLocais,
  acharNascimentos,
  type EstadoCivilEncontrado,
  type LocalEncontrado,
  type NascimentoEncontrado,
} from '@/lib/dadosNoTexto'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import {
  CaixaDeAviso,
  CaixaSuave,
  DicaDeAviso,
  RotuloDeSecao,
  Selo,
  icSelo,
  type TomDaPeca,
} from '@/components/analise/Pecas'
import { EmissaoBullai, seloDoResultado } from '@/components/EmissaoBullai'
import { classificarParcelaCedida, lerTituloCard } from '@/lib/kommo'
import type { Lido, QualificacaoLida } from '../../supabase/functions/_shared/qualificacaoDoCedente.ts'
import { mencionaNome, tipoPessoaPeloNome } from '../../supabase/functions/_shared/focoNoCedente.ts'
import {
  formatarDocumento,
  mesmaPessoa,
  oficioParaACessao,
  type CamposDoOficio,
  type TitularDoOficio,
} from '../../supabase/functions/_shared/oficioDoCredito.ts'

/** A resposta de dd-qualificacao: a qualificação e, desde 03/10/2026, o ofício. */
type LeituraDaIA = QualificacaoLida & CamposDoOficio

// ------------------------------------------------------------------ tipos

interface Sujeito {
  id: string
  papel: 'CEDENTE' | 'CONJUGE' | 'PJ' | 'ADVOGADO'
  tipo_pessoa: 'PF' | 'PJ'
  nome: string
  documento: string
  data_nascimento: string | null
  uf_atual: string | null
  municipio_atual: string | null
  ufs_anteriores: string[]
  municipios_anteriores: string[]
  residencia_levantada: boolean
}

interface Completude {
  necessarias: number
  obtidas_validas: number
  pendentes: number
  vencidas: number
  dispensadas: number
}

interface ItemChecklist {
  id: string
  sujeito_id: string
  certidao_codigo: string
  parametros: Record<string, unknown>
  obrigatoria: boolean
  status: string
  erro_classe: string | null
  erro_detalhe: string | null
  dispensa_motivo: string | null
  // Da migration 0071: o que a BullAI devolveu. Opcionais porque o select é `*`
  // e, antes da migration, eles simplesmente não vêm.
  resultado?: string | null
  /** A pasta "Certidões" onde o PDF caiu (desde 03/10/2026; os de antes não a têm). */
  arquivos?: { portal: string; drive_link: string | null; nome: string; pasta_id?: string | null }[] | null
  // Da 0042, vindas pelo `*`: o PDF da certidão obtida e as datas dela.
  drive_link?: string | null
  emitida_em?: string | null
  validade_ate?: string | null
  certidao_catalogo: {
    nome_curto: string
    orgao_emissor: string
    metodo: string
    captcha: string
    login: string
    url_oficial: string | null
    dados_entrada: string[]
    dados_entrada_pf: string[]
    dados_entrada_pj: string[]
    validade_dias: number | null
    sla_horas: number | null
  } | null
}

/** Link de emissão por escopo (migration 0046). */
interface UrlPorEscopo {
  certidao_codigo: string
  escopo_valor: string
  url: string
  informado_em: string
}

interface RespostaGeracao {
  ok?: boolean
  total?: number
  obrigatorias?: number
  pendencia_imediata?: number
  completude?: Completude | null
  avisos?: string[]
  erro?: string
}

interface FormPessoa {
  nome: string
  /**
   * O DOCUMENTO, com máscara: CPF, ou CNPJ quando o cedente é pessoa jurídica
   * (ver `tipoCedente`). O nome do campo ficou `cpf` para não mexer em toda a
   * tela — o cônjuge é sempre pessoa física, e o cedente PJ é o caso novo.
   */
  cpf: string
  uf: string
  municipio: string
  nascimento: string
}

const VAZIO: FormPessoa = { nome: '', cpf: '', uf: '', municipio: '', nascimento: '' }

type TipoPessoa = 'PF' | 'PJ'

/** O documento cabe no tipo? 11 dígitos de CPF válido, ou 14 de CNPJ válido. */
function documentoValido(doc: string, tipo: TipoPessoa): boolean {
  const d = onlyDigits(doc)
  return tipo === 'PJ' ? d.length === 14 && cnpjValido(d) : d.length === 11 && cpfValido(d)
}

/** A máscara do tipo: CPF não passa de 11 dígitos, CNPJ vai a 14. */
function mascaraDoTipo(v: string, tipo: TipoPessoa): string {
  return formatCpfCnpjInput(onlyDigits(v).slice(0, tipo === 'PJ' ? 14 : 11))
}

/** "CPF" ou "CNPJ". */
const rotuloDoc = (tipo: TipoPessoa) => (tipo === 'PJ' ? 'CNPJ' : 'CPF')

/** 'AAAA-MM-DD' → 'DD/MM/AAAA'. */
const dataBr = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/')

// ------------------------------------------------------------------ rótulos

/** Por que a certidão não sai sozinha. É a informação que decide o que fazer. */
const MOTIVO_MANUAL: Record<string, string> = {
  DADO_FALTANTE: 'falta dado no cadastro',
  BLOQUEIO: 'exige login ou CAPTCHA',
  SEM_ADAPTER: 'sem emissão automática ainda',
  ESCOPO_INDEFINIDO: 'escopo indefinido',
}

// NAO_APLICAVEL em azul, não em cinza. Em cinza ficava idêntico a PENDENTE, e as
// duas coisas são opostas: uma está por fazer, a outra saiu da conta de vez.
//
// O SELO DA AMOSTRA (`selo()` em base.js): tom, ícone e o estado por extenso —
// "Pendente manual" em vez de PENDENTE_MANUAL. Estado que o mapa não conhece sai
// com o nome cru, para nunca sumir da tela.
const ESTADO_DA_LINHA: Record<string, { tom: TomDaPeca; rotulo: string; icone?: ReactNode }> = {
  OBTIDA: { tom: 'sucesso', rotulo: 'Obtida', icone: <Check className={icSelo} aria-hidden /> },
  PENDENTE: { tom: 'neutro', rotulo: 'Pendente' },
  EM_EMISSAO: {
    tom: 'info',
    rotulo: 'Em emissão',
    icone: <ArrowRight className={icSelo} aria-hidden />,
  },
  PENDENTE_MANUAL: {
    tom: 'aviso',
    rotulo: 'Pendente manual',
    icone: <Clock className={icSelo} aria-hidden />,
  },
  FALHA: { tom: 'perigo', rotulo: 'Falha', icone: <X className={icSelo} aria-hidden /> },
  NAO_APLICAVEL: { tom: 'info', rotulo: 'Dispensada' },
}

/** O `.cand` da amostra: um achado do documento, clicável, com o trecho embaixo. */
const CAND =
  'block w-full rounded-campo border border-borda bg-superficie px-3 py-2.5 text-left text-corpo ' +
  'text-texto transition-colors hover:border-marca-viva'

/** O `.sub` da amostra: a linha de baixo do candidato — arquivo e trecho. */
const SUB = 'mt-0.5 block truncate text-xs text-texto-3'

/**
 * O trecho dos autos de um dado lido pela IA: inteiro, em quantas linhas
 * precisar. É a prova do dado — cortado em uma linha, sumia justamente o nome
 * de quem ele é.
 */
const TRECHO = 'mt-0.5 block text-xs text-texto-3'

/** Um achado que não se clica (o nome da mãe, que o formulário não tem). */
const CAND_FIXO = 'block w-full rounded-campo border border-borda bg-superficie px-3 py-2.5 text-left text-corpo text-texto'

/** O `.link-btn` da amostra: link na cor da marca, com área de clique de 24 px. */
const LINK_BTN =
  'inline-flex min-h-8 items-center gap-1 rounded-controle px-1.5 text-sm font-semibold ' +
  'text-marca-texto hover:bg-marca-leve'

/** A caixa de marcar da amostra (`.check input`): 16 px, na cor da marca. */
const CAIXA_MARCAR = 'h-[16px] w-[16px] flex-none accent-marca'

const ROTULO_ESTADO_CIVIL: Record<string, string> = {
  solteiro: 'solteiro(a)',
  casado: 'casado(a)',
  divorciado: 'divorciado(a)',
  viuvo: 'viúvo(a)',
  separado: 'separado(a) judicialmente',
  uniao_estavel: 'união estável',
}

/**
 * Estado civil que EXIGE o bloco de certidões do cônjuge.
 *
 * Casado e união estável, sim. Divorciado, viúvo e separado, não — o vínculo
 * acabou. Solteiro, obviamente não. A planilha dá bloco próprio ao cônjuge nas
 * linhas 52 a 67, e é este booleano que decide se ele entra.
 */
const PEDE_CONJUGE = new Set(['casado', 'uniao_estavel'])

/** O que espera quem clicar no link. É o que decide se dá para emitir agora. */
const BARREIRA_LOGIN: Record<string, string> = {
  govbr: 'exige login gov.br',
  cadastro: 'exige cadastro no site',
  certificado_digital: 'exige certificado digital',
}

const BARREIRA_CAPTCHA: Record<string, string> = {
  imagem: 'CAPTCHA de imagem',
  recaptcha: 'reCAPTCHA — só manual',
  hcaptcha: 'hCaptcha — só manual',
  desconhecido: 'CAPTCHA não verificado',
}

/** Nome legível dos insumos que cada portal pede. */
const ROTULO_INSUMO: Record<string, string> = {
  documento: 'CPF/CNPJ',
  nome: 'Nome completo',
  data_nascimento: 'Data de nascimento',
  nome_mae: 'Nome da mãe',
  uf: 'UF',
  municipio: 'Município',
  comarca: 'Comarca',
  cnj: 'Número do processo',
}

/**
 * O valor do escopo da certidão, para casar com certidao_url.escopo_valor.
 *
 * Tem de sair do MESMO lugar que gerou o parâmetro (dd_certidao.parametros),
 * senão o link cadastrado para 'MG' não é achado por um item cujo parâmetro diz
 * 'MG' — e a tela mostra "sem link" para um link que existe.
 *
 * `cnj` FICA DE FORA de propósito, e isto saiu de um teste. Com ele na lista, o
 * Caderno Processual — cujo parâmetro é o número do processo — passaria a pedir
 * "cole o link de 5001234-85.2021.8.13.0024". Link por número de processo não
 * existe: o caderno se consulta no sistema do TRIBUNAL. Cada crédito criaria uma
 * linha inútil na tabela, e nenhuma serviria ao crédito seguinte.
 *
 * Sem escopo, a linha diz que é emissão manual — que é a verdade enquanto não
 * houver uma tabela de sistema por tribunal.
 */
function escopoDe(p: Record<string, unknown>): string | null {
  for (const k of ['uf', 'municipio', 'comarca']) {
    const v = p?.[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return null
}

function rotuloParametros(p: Record<string, unknown>): string {
  return Object.entries(p)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(' · ')
}

/**
 * Os avisos, reconstruídos do estado do banco.
 *
 * Reproduz o que gerar-checklist-certidoes emite na resposta, mais o que só se
 * vê olhando o conjunto. Existe como função separada porque um aviso que só
 * aparece uma vez, no instante do clique, não é aviso — é notificação, e a
 * lacuna que ele denuncia continua lá depois de fechar o modal.
 */
/**
 * CADA AVISO COM UM NOME CURTO (03/10/2026): a tela enxuta mostra os nomes
 * numa linha só ("residência não levantada · sem cônjuge informado"), e o texto
 * inteiro a um clique. Nenhum aviso deixou de existir — continuam todos à vista,
 * só que encolhidos.
 */
interface AvisoDoPlacar {
  curto: string
  texto: string
}

function derivarAvisos(sujeitos: Sujeito[], itens: ItemChecklist[]): AvisoDoPlacar[] {
  const a: AvisoDoPlacar[] = []
  const push = (curto: string, texto: string) => a.push({ curto, texto })
  if (sujeitos.length === 0) return a
  // CEDENTE EMPRESA: não casa e não é "sócio de empresa" — os dois avisos de
  // bloco esquecido abaixo não se aplicam, e o bloco da PJ já é dele (o motor
  // o aplica ao cedente PJ).
  const cedentePJ = sujeitos.some((s) => s.papel === 'CEDENTE' && s.tipo_pessoa === 'PJ')

  for (const s of sujeitos) {
    const quem = s.papel === 'CEDENTE' ? '' : ` (${s.papel.toLowerCase()})`
    if (!s.residencia_levantada) {
      push(
        `residência não levantada${quem}`,
        `${s.papel} (${s.nome}): histórico de residência não levantado. O checklist ` +
          `cobre apenas os endereços conhecidos hoje — pode faltar certidão estadual ` +
          `ou municipal de onde a pessoa morou antes.`,
      )
    }
    if (!s.uf_atual) {
      push(
        `sem UF atual${quem}`,
        `${s.papel} (${s.nome}): sem UF atual. Nenhuma certidão estadual foi ` +
          `exigida para esta pessoa.`,
      )
    }
    if (!s.municipio_atual) {
      push(
        `sem município atual${quem}`,
        `${s.papel} (${s.nome}): sem município atual. Nenhuma certidão municipal ` +
          `foi exigida para esta pessoa.`,
      )
    }
  }

  if (!cedentePJ && !sujeitos.some((s) => s.papel === 'CONJUGE')) {
    push(
      'nenhum cônjuge informado',
      'Nenhum cônjuge informado. Se o cedente for casado, o checklist está ' +
        'INCOMPLETO: a planilha dá bloco próprio de certidões ao cônjuge ' +
        '(linhas 52 a 67).',
    )
  }

  // A 0042 nomeia três coisas esquecíveis: o estado anterior, o cônjuge e a
  // EMPRESA em que o cedente é sócio. As duas primeiras têm campo nesta tela; a
  // terceira ainda não, então o aviso é o que impede que a ausência passe por
  // "não se aplica".
  if (!cedentePJ && !sujeitos.some((s) => s.papel === 'PJ')) {
    push(
      'nenhuma empresa (PJ) informada',
      'Nenhuma empresa (PJ) informada. Se o cedente for sócio de empresa, falta ' +
        'o bloco de certidões da PJ — CNPJ, FGTS e as estaduais/municipais dela ' +
        '(planilha, linhas 68 a 81). Esta tela ainda não cadastra PJ: por ora, ' +
        'cadastre pelo SQL ou trate como pendência manual.',
    )
  }

  const dispensadas = itens.filter((i) => i.status === 'NAO_APLICAVEL')
  if (dispensadas.length > 0) {
    push(
      `${dispensadas.length} ${rotuloNoNumero(dispensadas.length, 'dispensada', 'dispensadas')} fora da conta`,
      `${dispensadas.length} ${rotuloNoNumero(dispensadas.length, 'certidão dispensada', 'certidões dispensadas')}. Dispensa SAI do ` +
        `denominador do placar: "completo" abaixo significa completo entre as que ` +
        `sobraram, não entre as que a regra exigia.`,
    )
  }

  return a
}


/**
 * Uma linha do checklist — e, para as que não saem sozinhas, a FILA DE EMISSÃO.
 *
 * A pesquisa dos portais mudou o que esta tela tem de fazer. Das 19 certidões,
 * exatamente UMA tem API oficial gratuita; 6 dos 10 portais federais nem
 * respondem a um cliente automatizado, e a regra da casa é não burlar CAPTCHA,
 * login nem controle de acesso de tribunal. Então o valor não está em emitir
 * sozinho: está em quem emite abrir a lista e conseguir trabalhar sem procurar
 * nada — o link, o que digitar lá, e o que vai barrar.
 *
 * O QUE ESPERA APARECE ANTES DO CLIQUE, de propósito. Saber que o portal exige
 * gov.br evita a viagem: a pessoa junta as que dá para fazer agora e deixa as
 * outras para quando tiver o acesso.
 */
//
// A LINHA DENSA (03/10/2026, pedido do dono de "condensar"): o que é e em que pé
// está numa linha só — estado, nome, órgão e escopo, o resultado da BullAI — e
// UMA ação à vista: abrir o PDF quando já existe, senão abrir o portal, senão
// cadastrar o link. O resto (barreiras, o que o portal pede com o botão de
// copiar, validade, os outros PDFs, o portal quando a ação principal é o PDF)
// fica no "Como emitir", que abre embaixo, na largura toda.
function LinhaCertidao({
  item,
  sujeito,
  cnj,
  url,
  onSalvarUrl,
  papel,
  hoje,
}: {
  item: ItemChecklist
  sujeito: Sujeito | undefined
  cnj: string | null
  /** Link já conhecido: do catálogo, ou cadastrado para este escopo. */
  url: string | null
  onSalvarUrl: (codigo: string, escopo: string, url: string) => Promise<void>
  /** O papel do sujeito, quando há mais de um no crédito (senão a linha não o repete). */
  papel?: string
  hoje: string
}) {
  const [aberto, setAberto] = useState(false)
  const [novaUrl, setNovaUrl] = useState('')
  const [salvandoUrl, setSalvandoUrl] = useState(false)
  const [erroUrl, setErroUrl] = useState<string | null>(null)

  const cat = item.certidao_catalogo
  const escopo = escopoDe(item.parametros)

  const barreiras = [
    BARREIRA_LOGIN[cat?.login ?? ''],
    BARREIRA_CAPTCHA[cat?.captcha ?? ''],
  ].filter(Boolean) as string[]

  // O que o portal pede, com o valor que já temos. Campo sem valor aparece como
  // FALTA — é a diferença entre "é só colar" e "não dá para emitir ainda".
  const insumos = useMemo(() => {
    const pedidos = new Set<string>([
      ...(cat?.dados_entrada ?? []),
      ...(sujeito?.tipo_pessoa === 'PJ'
        ? (cat?.dados_entrada_pj ?? [])
        : (cat?.dados_entrada_pf ?? [])),
    ])
    const valorDe = (k: string): string => {
      if (k === 'documento') return formatCpfCnpjInput(sujeito?.documento ?? '')
      if (k === 'nome') return sujeito?.nome ?? ''
      if (k === 'data_nascimento') {
        return sujeito?.data_nascimento
          ? sujeito.data_nascimento.split('-').reverse().join('/')
          : ''
      }
      if (k === 'cnj') return String(item.parametros?.cnj ?? cnj ?? '')
      const p = item.parametros?.[k]
      return typeof p === 'string' ? p : ''
    }
    return [...pedidos].map((k) => ({
      chave: k,
      rotulo: ROTULO_INSUMO[k] ?? k,
      valor: valorDe(k),
    }))
  }, [cat, sujeito, item.parametros, cnj])

  const faltando = insumos.filter((x) => !x.valor)

  async function salvarUrl() {
    if (!escopo) return
    setSalvandoUrl(true)
    setErroUrl(null)
    try {
      await onSalvarUrl(item.certidao_codigo, escopo, novaUrl.trim())
      setNovaUrl('')
    } catch (e) {
      setErroUrl((e as Error)?.message ?? String(e))
    } finally {
      setSalvandoUrl(false)
    }
  }

  const estado = ESTADO_DA_LINHA[item.status]
  const estaVencida = vencida(item, hoje)
  // OS PDFs DESTA CERTIDÃO no Drive: o da coluna e os que a BullAI trouxe por
  // portal. O primeiro vira a ação principal; os outros, o "Como emitir".
  const pdfs = [
    ...(item.drive_link ? [{ link: item.drive_link, nome: 'PDF' }] : []),
    ...(item.arquivos ?? [])
      .filter((a) => a.drive_link && a.drive_link !== item.drive_link)
      .map((a) => ({ link: a.drive_link!, nome: a.nome })),
  ]
  const pdfPrincipal = item.status === 'OBTIDA' ? pdfs[0] : undefined
  const outrosPdfs = pdfPrincipal ? pdfs.slice(1) : pdfs
  const escopoTexto = rotuloParametros(item.parametros)

  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b border-borda px-3 py-2 text-corpo last:border-b-0">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <Selo tom={estaVencida ? 'perigo' : (estado?.tom ?? 'neutro')} icone={estaVencida ? undefined : estado?.icone}>
          {estaVencida ? 'Vencida' : (estado?.rotulo ?? item.status)}
        </Selo>
        <b className="min-w-0 font-semibold text-texto">{cat?.nome_curto ?? item.certidao_codigo}</b>
        <span className="text-xs text-texto-3">
          {[cat?.orgao_emissor, escopoTexto].filter(Boolean).join(' · ')}
        </span>
        {papel && <Selo tom="info">{papel}</Selo>}
        {!item.obrigatoria && <Selo tom="neutro">opcional</Selo>}
        {item.status === 'OBTIDA' && seloDoResultado(item.resultado)}
        {estaVencida && <span className="text-xs text-perigo">venceu em {dataBr(item.validade_ate!)}</span>}
        {item.status === 'NAO_APLICAVEL' && (
          <span className="text-xs text-info">
            {item.dispensa_motivo ? item.dispensa_motivo : 'sem motivo!'}
          </span>
        )}
        {item.erro_classe && (
          <span className="text-xs text-aviso">
            {MOTIVO_MANUAL[item.erro_classe] ?? item.erro_classe}
            {item.erro_detalhe ? `: ${item.erro_detalhe}` : ''}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-1">
        {pdfPrincipal ? (
          <a href={pdfPrincipal.link} target="_blank" rel="noreferrer" className={LINK_BTN}>
            <FileText className="h-[16px] w-[16px]" aria-hidden /> Abrir PDF
          </a>
        ) : url ? (
          <a href={url} target="_blank" rel="noreferrer" className={LINK_BTN}>
            Abrir portal <ExternalLink className="h-[16px] w-[16px]" aria-hidden />
          </a>
        ) : escopo ? (
          <button type="button" className={LINK_BTN} onClick={() => setAberto(true)}>
            Cadastrar link
          </button>
        ) : (
          <span className="px-1.5 text-xs text-aviso">sem link</span>
        )}
        <button
          type="button"
          onClick={() => setAberto((v) => !v)}
          aria-expanded={aberto}
          aria-label={`${aberto ? 'Fechar' : 'Como emitir'}: ${cat?.nome_curto ?? item.certidao_codigo}`}
          title={aberto ? 'Fechar' : 'Como emitir, o que o portal pede e os outros arquivos'}
          className={LINK_BTN}
        >
          <span className="hidden sm:inline">{aberto ? 'Fechar' : 'Como emitir'}</span>
          <ChevronDown className={cn('h-[16px] w-[16px] transition-transform', aberto && 'rotate-180')} aria-hidden />
        </button>
      </div>

      {aberto && (
        <div className="col-span-full space-y-2 rounded-campo bg-superficie-2 px-3 py-2.5 text-sm">
          {barreiras.length > 0 ? (
            <p className="flex items-start gap-1.5 text-aviso">
              <AlertTriangle className="mt-0.5 h-[16px] w-[16px] flex-none" aria-hidden />
              <span>{barreiras.join(' · ')}</span>
            </p>
          ) : (
            <p className="text-sucesso">Sem login e sem CAPTCHA conhecidos.</p>
          )}

          {insumos.length > 0 ? (
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-0.5 text-corpo">
              {insumos.map((x) => (
                <div key={x.chave} className="contents">
                  <dt className="text-texto-3">{x.rotulo}</dt>
                  <dd className="flex min-w-0 items-center gap-1 text-texto">
                    {x.valor ? (
                      // O NOME DIZ O QUE SE COPIA: o leitor de tela ouvia "copiar"
                      // repetido, sem saber de qual campo.
                      <CopiarTexto valor={x.valor} rotulo={`Copiar ${x.rotulo}`} className="tabular-nums" />
                    ) : (
                      // Campo vazio é PENDÊNCIA, não detalhe: sem ele o portal não
                      // emite, e descobrir isso só lá é viagem perdida.
                      <span className="text-perigo">falta no cadastro</span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-texto-3">O portal não declara o que pede no catálogo.</p>
          )}

          {faltando.length > 0 && (
            <p className="text-perigo">
              Não dá para emitir ainda: falta {faltando.map((x) => x.rotulo).join(', ')}.
            </p>
          )}

          {(cat?.validade_dias || item.emitida_em) && (
            <p className="text-xs text-texto-3">
              {[
                item.emitida_em ? `emitida em ${dataBr(item.emitida_em)}` : null,
                item.validade_ate ? `vale até ${dataBr(item.validade_ate)}` : null,
                cat?.validade_dias ? `validade de ${cat.validade_dias} dias` : null,
                cat?.sla_horas ? `sai em até ${cat.sla_horas}h` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}

          {(outrosPdfs.length > 0 || (pdfPrincipal && url)) && (
            <div className="flex flex-wrap items-center gap-1">
              {outrosPdfs.map((a) => (
                <a key={a.link} href={a.link} target="_blank" rel="noreferrer" className={LINK_BTN}>
                  <FileText className="h-[16px] w-[16px]" aria-hidden /> {a.nome}
                </a>
              ))}
              {pdfPrincipal && url && (
                <a href={url} target="_blank" rel="noreferrer" className={LINK_BTN}>
                  Abrir portal <ExternalLink className="h-[16px] w-[16px]" aria-hidden />
                </a>
              )}
            </div>
          )}

          {/* SEM LINK: o endereço desta certidão depende da UF, do município ou da
              comarca, e cadastrar 54 links sem conferir cada um seria pior que não
              ter — link errado manda a pessoa para o lugar errado. Então quem
              precisa pela primeira vez cola aqui, e da segunda em diante aparece
              pronto para todo mundo. */}
          {!url && escopo && (
            <div className="space-y-1.5">
              <p className="text-texto-2">
                Link de <b className="text-texto">{escopo}</b> ainda não cadastrado — o que você colar vale
                para todos os créditos deste escopo.
              </p>
              <div className="flex flex-wrap gap-2">
                <Input
                  value={novaUrl}
                  onChange={(e) => setNovaUrl(e.target.value)}
                  placeholder="https://..."
                  aria-label="Link de emissão"
                  className="min-w-0 flex-1"
                />
                <Button
                  variant="secondary"
                  onClick={salvarUrl}
                  loading={salvandoUrl}
                  disabled={!/^https?:\/\/\S+$/.test(novaUrl.trim())}
                >
                  Salvar link
                </Button>
              </div>
              {erroUrl && (
                <p role="alert" className="text-perigo">
                  {erroUrl}
                </p>
              )}
            </div>
          )}

          {!url && !escopo && (
            <p className="text-aviso">
              Sem link no catálogo nem escopo (UF, município ou comarca) para cadastrar um: emissão
              manual, procurando o portal.
            </p>
          )}
        </div>
      )}
    </li>
  )
}

/**
 * Candidatos de nascimento e cidade/UF achados num texto.
 *
 * O MESMO componente serve ao PDF do processo e ao texto colado de outra
 * consulta, porque a origem não muda o que se faz com o achado: mostrar com o
 * trecho em volta e deixar quem confere clicar. Ver lib/dadosNoTexto.ts.
 */
function Sugestoes({
  nascimentos: nascimentosBrutos,
  locais: locaisBrutos,
  onNascimento,
  onLocal,
  vazio,
  marcarCedente,
}: {
  nascimentos: (NascimentoEncontrado & { arquivo?: string })[]
  locais: (LocalEncontrado & { arquivo?: string })[]
  onNascimento: (iso: string) => void
  onLocal: (l: LocalEncontrado) => void
  vazio: string
  /**
   * O nome do cedente, quando a lista é a dos "outros dados do processo" (com
   * a leitura da IA feita): o achado cujo trecho o menciona sobe e ganha selo.
   */
  marcarCedente?: string
}) {
  const doCedente = (contexto: string) => Boolean(marcarCedente) && mencionaNome(contexto, marcarCedente!)
  const primeiroDoCedente = <T extends { contexto: string }>(l: T[]) =>
    marcarCedente ? [...l].sort((a, b) => Number(doCedente(b.contexto)) - Number(doCedente(a.contexto))) : l
  const nascimentos = primeiroDoCedente(nascimentosBrutos)
  const locais = primeiroDoCedente(locaisBrutos)
  if (nascimentos.length === 0 && locais.length === 0) {
    return vazio ? <p className="text-xs text-texto-3">{vazio}</p> : null
  }
  return (
    <div>
      {nascimentos.length > 0 && (
        <>
          <p className="mt-2 text-xs text-texto-2">
            <b className="text-texto">Nascimento</b> — só datas rotuladas como nascimento:
          </p>
          <div className="my-2 grid gap-2">
            {nascimentos.map((n) => (
              <button
                key={n.iso}
                type="button"
                onClick={() => onNascimento(n.iso)}
                className={CAND}
              >
                <span className="flex flex-wrap items-center gap-2">
                  <b className="font-bold tabular-nums">{n.iso.split('-').reverse().join('/')}</b>
                  {doCedente(n.contexto) && <Selo tom="info">menciona o cedente</Selo>}
                </span>
                <span className={SUB}>
                  {n.arquivo ? `em ${n.arquivo} · ` : ''}…{n.contexto}…
                </span>
              </button>
            ))}
          </div>
        </>
      )}
      {locais.length > 0 && (
        <>
          <p className="mt-2 text-xs text-texto-2">
            <b className="text-texto">Cidade/UF</b> — conferidas no IBGE; clicar preenche as duas:
          </p>
          <div className="my-2 grid gap-2">
            {locais.map((l) => (
              <button
                key={`${l.uf}-${l.municipio}`}
                type="button"
                onClick={() => onLocal(l)}
                className={CAND}
              >
                <span className="flex flex-wrap items-center gap-2">
                  <b className="font-bold">
                    {l.municipio}/{l.uf}
                  </b>
                  {l.residencial && <Selo tom="info">perto de &quot;residente&quot;</Selo>}
                  {doCedente(l.contexto) && <Selo tom="info">menciona o cedente</Selo>}
                  {l.forma === 'rotulado' && (
                    <span className="text-xs text-texto-3">(campo CIDADE/UF)</span>
                  )}
                </span>
                <span className={SUB}>
                  {l.arquivo ? `em ${l.arquivo} · ` : ''}…{l.contexto}…
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/**
 * O select do checklist. `*` na tabela, e não a lista de colunas: coluna que
 * uma migration ainda não criou, pedida pelo nome, derruba a consulta inteira —
 * e com `*` a tela funciona antes e depois da 0071.
 */
const SELECT_ITENS =
  '*, certidao_catalogo(nome_curto, orgao_emissor, metodo, captcha, login,' +
  ' url_oficial, dados_entrada, dados_entrada_pf, dados_entrada_pj,' +
  ' validade_dias, sla_horas)'

// ------------------------------------------------------------------ componente

export function PainelCertidoes({
  leadId,
  tituloDoCard,
  cedenteDoCard,
  arquivos,
  lendoPdf,
  avisoPdf,
  ativo,
  onDirtyChange,
}: {
  leadId: number
  /** O título do card: diz QUAIS verbas se cedem, e portanto quem cede. */
  tituloDoCard: string
  /** Nome do cedente lido do card. Sugestão: o campo continua editável. */
  cedenteDoCard: string
  /**
   * TODOS os PDFs do card, com o texto de cada um. Lista vazia = ainda não lidos.
   *
   * Era um texto só, do último PDF anexado. Processo de precatório vem em vários
   * arquivos, e a petição inicial — que é onde está a qualificação das partes —
   * podia ser justamente a que não estava sendo lida.
   */
  arquivos: ArquivoLido[]
  lendoPdf: boolean
  avisoPdf: string | null
  /**
   * A aba deste painel está à vista.
   *
   * Antes era `open`, do modal que este componente era. Agora quem abre e fecha
   * a janela é o DueDiligence; aqui só interessa se a ABA está visível, porque é
   * isso que decide se vale carregar UFs e recarregar o checklist. O painel NÃO
   * é desmontado ao trocar de aba, de propósito: um formulário meio preenchido
   * não pode se perder porque alguém foi olhar Processos Judiciais.
   */
  ativo: boolean
  /**
   * Avisa a janela quando há alteração não salva, para ela pedir confirmação
   * antes de fechar. O painel sabe disso; o modal, não.
   */
  onDirtyChange?: (dirty: boolean) => void
}) {
  const toast = useToast()
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const [sujeitos, setSujeitos] = useState<Sujeito[]>([])
  const [itens, setItens] = useState<ItemChecklist[]>([])
  const [completude, setCompletude] = useState<Completude | null>(null)
  const [urls, setUrls] = useState<UrlPorEscopo[]>([])
  const [erroLinks, setErroLinks] = useState<string | null>(null)
  const [cnjDoCredito, setCnjDoCredito] = useState<string | null>(null)
  /** A pasta da análise do card no Drive (kommo_leads.drive_pasta_id): o atalho do topo. */
  const [drivePastaId, setDrivePastaId] = useState<string | null>(null)
  /** A pasta que a última atualização da BullAI disse ter usado (vence a calculada aqui). */
  const [pastaDaResposta, setPastaDaResposta] = useState<PastaNaTela | null>(null)
  // O QUE ESTÁ ABERTO NA TELA ENXUTA (03/10/2026). `null` em achadosAbertos é
  // "decide sozinho" (abre enquanto falta o documento do cedente).
  const [ajudaAberta, setAjudaAberta] = useState(false)
  const [achadosAbertos, setAchadosAbertos] = useState<boolean | null>(null)
  const [residenciaAberta, setResidenciaAberta] = useState(false)
  const [conjugeAberto, setConjugeAberto] = useState(false)

  const [editando, setEditando] = useState(false)
  const [cedente, setCedente] = useState<FormPessoa>(VAZIO)
  /**
   * O cedente é pessoa física ou jurídica (pedido do dono, 03/10/2026). Vem do
   * banco; sem cadastro, do nome ("LTDA", "S/A"…) e depois da leitura da IA —
   * esta só enquanto ninguém escolheu à mão nem digitou documento.
   */
  const [tipoCedente, setTipoCedente] = useState<TipoPessoa>('PF')
  const tipoEscolhido = useRef(false)
  const [conjuge, setConjuge] = useState<FormPessoa>(VAZIO)
  const [temConjuge, setTemConjuge] = useState(false)
  // EMPRESA NÃO CASA. A caixa do cônjuge guarda o que estava marcado (voltar
  // para PF devolve), mas só vale para cedente pessoa física.
  const comConjuge = tipoCedente === 'PF' && temConjuge
  const [residenciaLevantada, setResidenciaLevantada] = useState(false)
  const [ufsAnteriores, setUfsAnteriores] = useState('')
  const [municipiosAnteriores, setMunicipiosAnteriores] = useState('')
  const [mexeu, setMexeu] = useState(false)
  // só na tela: NÃO é gravado em lugar nenhum. O que a pessoa aproveita dele são
  // os campos que ela clicar — o resto do texto, que costuma vir cheio de dado
  // pessoal sem uso aqui, morre quando o modal fecha.
  const [colado, setColado] = useState('')
  // O que foi preenchido sozinho a partir do processo. Fica VISÍVEL: campo que se
  // preencheu sem ninguém mandar tem de dizer de onde veio.
  const [preenchido, setPreenchido] = useState<string[]>([])
  // A LEITURA DA IA sobre os autos (dd-qualificacao): o cadastro inteiro, com o
  // trecho de onde saiu cada campo.
  const [leituraIA, setLeituraIA] = useState<LeituraDaIA | null>(null)
  const [lendoIA, setLendoIA] = useState(false)
  const leituraPedida = useRef<number | null>(null)

  const [ufs, setUfs] = useState<string[]>([])
  const [municipios, setMunicipios] = useState<Record<string, string[]>>({})

  // A lista do IBGE tem 5571 municípios: importada sob demanda, como em
  // DadosPessoaisBancarios, para não entrar no bundle de quem nunca abre isto.
  const [erroMunicipios, setErroMunicipios] = useState<string | null>(null)
  useEffect(() => {
    if (!ativo || ufs.length > 0) return
    void import('@/lib/municipios')
      .then((m) => {
        setUfs(m.UFS)
        setMunicipios(m.MUNICIPIOS_POR_UF)
        setErroMunicipios(null)
      })
      // A lista é um chunk carregado sob demanda, e o nome do arquivo tem hash:
      // uma aba deixada aberta durante um deploy dá 404 nele. Sem este catch a
      // promessa era rejeitada em silêncio, `municipios` ficava vazio, e a tela
      // dizia "não achei cidade/UF — cidade só entra se existir na lista do
      // IBGE". A cidade estava na lista; a LISTA é que não tinha carregado.
      .catch((e) =>
        setErroMunicipios(
          `Não consegui carregar a lista de municípios (${
            (e as Error)?.message ?? e
          }). Recarregue a página com Ctrl+Shift+R — sem ela eu não confiro cidade nenhuma.`,
        ),
      )
  }, [ativo, ufs.length])

  const temTexto = useMemo(() => arquivos.some((a) => a.texto.length > 0), [arquivos])

  /**
   * CPFs candidatos, buscados ARQUIVO POR ARQUIVO.
   *
   * NUNCA sobre a junção dos textos, e o motivo é um falso positivo que passa em
   * toda validação: juntando os arquivos, os dígitos do fim de um encostam nos do
   * começo do outro. "Protocolo 529982247" + "25 de agosto de 2026" viram
   * 529.982.247-25 — CPF de dígito verificador VÁLIDO, oferecido na tela como
   * conferido, e que não existe em documento nenhum. Um cálculo terminando em
   * número de protocolo seguido de um contrato começando com data é rotina.
   *
   * Emitir certidão sobre CPF inventado é o pior desfecho do sistema: todo portal
   * responde "nada consta", corretamente, e o dossiê fecha limpo sobre ninguém.
   */
  //
  // CEDENTE EMPRESA: a lista é de CNPJs, com as mesmas regras (ver cpfNoTexto.ts).
  const candidatos: (DocumentoEncontrado & { arquivo: string })[] = useMemo(() => {
    const fora: (DocumentoEncontrado & { arquivo: string })[] = []
    for (const a of arquivos) {
      if (!a.texto) continue
      for (const c of acharDocumentos(a.texto, tipoCedente)) {
        if (!fora.some((x) => x.doc === c.doc)) fora.push({ ...c, arquivo: a.nome })
      }
    }
    return fora
  }, [arquivos, tipoCedente])

  const digitalizados = useMemo(
    () => arquivos.filter((a) => a.digitalizado || a.erro),
    [arquivos],
  )

  const avisos = useMemo(() => derivarAvisos(sujeitos, itens), [sujeitos, itens])

  /**
   * Estado civil na qualificação das partes, ancorado no cedente.
   *
   * ANCORADO, e não "qualquer 'casada' do documento": uma petição qualifica o
   * autor, o réu e o advogado, e cada um tem o seu. As âncoras são o CPF e o nome
   * que já estão no formulário — então a lista melhora conforme a pessoa escolhe
   * o CPF, que é a ordem natural de preenchimento.
   */
  //
  // AS ÂNCORAS ESPERAM A DIGITAÇÃO PARAR. Cada tecla no nome varria de novo
  // todos os anexos (um processo de 200 páginas, a cada letra); agora a varredura
  // roda 400 ms depois da última tecla. O efeito do "escolheu o CPF", abaixo,
  // espera as âncoras alcançarem o CPF novo antes de usar a lista.
  const [ancorasEc, setAncorasEc] = useState<string[]>([])
  useEffect(() => {
    const t = window.setTimeout(
      () => setAncorasEc([onlyDigits(cedente.cpf), cedente.nome.trim()].filter((a) => a.length >= 4)),
      400,
    )
    return () => window.clearTimeout(t)
  }, [cedente.cpf, cedente.nome])
  const estadosCivis = useMemo(() => {
    const ancoras = ancorasEc
    const fora: (EstadoCivilEncontrado & { arquivo: string })[] = []
    for (const a of arquivos) {
      if (!a.texto) continue
      for (const e of acharEstadoCivil(a.texto, ancoras)) {
        // A REPETIDA PODE SER A BOA, também entre arquivos (o mesmo cuidado de
        // dadosNoTexto.ts dentro de um arquivo): a do primeiro arquivo, solta
        // (do advogado), não pode descartar a do segundo ligada ao cedente.
        const j = fora.findIndex((x) => x.estado === e.estado && x.conjuge === e.conjuge)
        if (j < 0) fora.push({ ...e, arquivo: a.nome })
        else if (e.doCedente && !fora[j].doCedente) fora[j] = { ...e, arquivo: a.nome }
      }
    }
    return fora.sort((x, y) => Number(y.doCedente) - Number(x.doCedente))
  }, [arquivos, ancorasEc])

  /**
   * Aplica o estado civil escolhido: liga ou desliga o bloco do cônjuge, e traz o
   * nome dele quando o texto trouxe.
   */
  function usarEstadoCivil(e: EstadoCivilEncontrado) {
    setMexeu(true)
    const pede = PEDE_CONJUGE.has(e.estado)
    setTemConjuge(pede)
    if (pede && e.conjuge) {
      setConjuge((f) => ({ ...f, nome: f.nome.trim() || e.conjuge! }))
    }
  }

  /**
   * O MESMO, mas partindo do PLACAR: aplica e já abre o formulário.
   *
   * Num crédito já cadastrado a janela abre no placar, e o formulário só existe
   * para quem clicar em "Corrigir dados / cônjuge". Sem este atalho, a resposta
   * que o processo dá exigiria: ler o aviso, decidir ir editar, achar a sugestão
   * lá dentro, clicar. Quatro passos para registrar um dado que a tela já sabe.
   */
  function cadastrarConjugeCom(e: EstadoCivilEncontrado) {
    usarEstadoCivil(e)
    setEditando(true)
  }

  /**
   * A RESPOSTA DO PROCESSO SOBRE O ESTADO CIVIL, para mostrar NO PLACAR.
   *
   * O aviso do placar diz "Nenhum cônjuge informado. Se o cedente for casado, o
   * checklist está INCOMPLETO" — e esta tela tem o texto do processo na memória,
   * capaz de responder exatamente isso. A detecção já existia; morava só dentro
   * do formulário. Num crédito já cadastrado — que é todo crédito depois da
   * primeira vez — a resposta nunca aparecia onde a pergunta é feita.
   *
   * `ancorado` é o que o parser conseguiu ligar ao NOME ou ao CPF do cedente.
   * `solto` é estado civil que existe no processo mas ficou longe de qualquer
   * âncora: numa petição isso costuma ser do advogado ou da parte contrária, e
   * por isso aparece com aviso em vez de virar resposta.
   */
  const respostaEstadoCivil = useMemo(() => {
    const ancorados = estadosCivis.filter((e) => e.doCedente)
    const soltos = estadosCivis.filter((e) => !e.doCedente)
    return {
      ancorado: ancorados[0] ?? null,
      soltos,
      temConjugeCadastrado: sujeitos.some((s) => s.papel === 'CONJUGE'),
    }
  }, [estadosCivis, sujeitos])

  // Nascimento e cidade/UF, POR ARQUIVO. Custo zero: o texto já está lido.
  const doPdf = useMemo(() => {
    const nascimentos: (NascimentoEncontrado & { arquivo: string })[] = []
    const locais: (LocalEncontrado & { arquivo: string })[] = []
    for (const a of arquivos) {
      if (!a.texto) continue
      for (const n of acharNascimentos(a.texto)) {
        if (!nascimentos.some((x) => x.iso === n.iso)) {
          nascimentos.push({ ...n, arquivo: a.nome })
        }
      }
      for (const l of acharLocais(a.texto, municipios)) {
        if (!locais.some((x) => x.uf === l.uf && x.municipio === l.municipio)) {
          locais.push({ ...l, arquivo: a.nome })
        }
      }
    }
    // Residencial primeiro, igual ao parser: o processo traz o endereço do
    // advogado e do fórum, e eles casam o mesmo padrão.
    locais.sort((x, y) => Number(y.residencial) - Number(x.residencial))
    return { nascimentos, locais }
  }, [arquivos, municipios])

  /**
   * ESCOLHEU O CPF, O RESTO VEM JUNTO.
   *
   * Preenche sozinho todo campo que tenha UMA ÚNICA resposta no processo, assim
   * que o CPF do cedente é escolhido. Não é adivinhação: com um candidato só, não
   * há entre o que escolher — e tudo continua editável, com o trecho do documento
   * à vista logo acima.
   *
   * O CPF NUNCA É PREENCHIDO SOZINHO, e essa é a linha. Ele é o parâmetro de
   * emissão de toda certidão do checklist: errar o CPF faz cada portal responder
   * "nada consta", corretamente, e o dossiê fecha limpo sobre quem não é. Um
   * processo traz o CPF do cedente, o do advogado e às vezes o de terceiros —
   * essa escolha é de quem confere, sempre.
   *
   * Só toca em campo VAZIO: o que a pessoa digitou vence o que o documento diz.
   */
  const cpfAplicado = useRef<string>('')
  useEffect(() => {
    // Só pessoa física: nascimento, "residente" e estado civil são da gente.
    if (tipoCedente !== 'PF') return
    const doc = onlyDigits(cedente.cpf)
    if (doc.length !== 11 || !cpfValido(cedente.cpf)) return
    if (cpfAplicado.current === doc) return
    // As âncoras do estado civil ainda são as de antes do CPF (ver `ancorasEc`):
    // esperar, senão a lista usada seria a errada e o CPF ficaria "aplicado".
    if (!ancorasEc.includes(doc)) return
    cpfAplicado.current = doc

    const feitos: string[] = []

    const nasc = doPdf.nascimentos
    if (nasc.length === 1 && !cedente.nascimento) {
      setCedente((f) => ({ ...f, nascimento: nasc[0].iso }))
      feitos.push(`nascimento ${nasc[0].iso.split('-').reverse().join('/')}`)
    }

    // Só o local marcado como RESIDENCIAL, e só se houver um. O processo traz o
    // endereço do fórum e o do advogado, e os dois casam o mesmo padrão.
    const resid = doPdf.locais.filter((l) => l.residencial)
    if (resid.length === 1 && !cedente.uf) {
      const l = resid[0]
      setCedente((f) => ({ ...f, uf: l.uf, municipio: l.municipio }))
      feitos.push(`${l.municipio}/${l.uf}`)
    }

    // Estado civil: só o que está perto do cedente, e só se houver um.
    const ec = estadosCivis.filter((e) => e.doCedente)
    if (ec.length === 1) {
      const e = ec[0]
      const pede = PEDE_CONJUGE.has(e.estado)
      // SÓ LIGA, NUNCA DESLIGA: desligar esconde o cônjuge que a pessoa marcou,
      // e gravar assim o APAGA do banco. "Só toca em campo vazio" vale aqui.
      setTemConjuge((v) => v || pede)
      if (pede && e.conjuge) setConjuge((f) => ({ ...f, nome: f.nome.trim() || e.conjuge! }))
      feitos.push(
        `${ROTULO_ESTADO_CIVIL[e.estado] ?? e.estado}${e.conjuge ? ` (cônjuge ${e.conjuge})` : ''}`,
      )
    }

    if (feitos.length > 0) {
      setMexeu(true)
      // O QUE VEIO DO OFÍCIO FICA: era apagado por esta lista, e a tela passava
      // a dizer que o documento foi digitado.
      setPreenchido((v) => [...v.filter((x) => x.endsWith('(do ofício)')), ...feitos])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cedente.cpf, doPdf, estadosCivis, tipoCedente])


  // O mesmo, do texto colado.
  const doColado = useMemo(
    () => ({
      nascimentos: acharNascimentos(colado),
      locais: acharLocais(colado, municipios),
    }),
    [colado, municipios],
  )

  /** Mapa (codigo|escopo) -> url, para a linha resolver sem varrer a lista. */
  const urlPorEscopo = useMemo(() => {
    const m = new Map<string, string>()
    for (const u of urls) m.set(`${u.certidao_codigo}|${u.escopo_valor}`, u.url)
    return m
  }, [urls])

  /**
   * Grava o link de um escopo. Global de propósito: cadastrar o TJ do Paraná uma
   * vez vale para todo crédito do Paraná, agora e depois.
   */
  async function salvarUrlDoEscopo(codigo: string, escopo: string, url: string) {
    const { data: sessao } = await supabase.auth.getUser()
    const { error } = await supabase.from('certidao_url').upsert(
      {
        certidao_codigo: codigo,
        // O escopo vai como veio do parâmetro da certidão. Normalizar aqui
        // (minúsculo, sem acento) faria a gravação divergir da busca, e o link
        // salvo nunca mais seria encontrado.
        escopo_valor: escopo,
        url: url.trim(),
        informado_por: sessao?.user?.id ?? null,
        informado_em: new Date().toISOString(),
      },
      { onConflict: 'certidao_codigo,escopo_valor' },
    )
    if (error) {
      throw new Error(
        /certidao_url_parece_url/.test(error.message)
          ? 'O banco recusou: precisa ser um endereço começando com http:// ou https://.'
          : error.message,
      )
    }
    // SÓ O LINK MUDOU, e só ele entra na tela. O `recarregar` inteiro punha o
    // painel em "Carregando…", desmontava a lista e a emissão pela BullAI — e
    // as marcações e as certidões acrescentadas por lá se perdiam, o mesmo
    // estrago que o `recarregarItens` existe para evitar.
    const gravado: UrlPorEscopo = {
      certidao_codigo: codigo,
      escopo_valor: escopo,
      url: url.trim(),
      informado_em: new Date().toISOString(),
    }
    setUrls((antes) => [
      ...antes.filter((u) => !(u.certidao_codigo === codigo && u.escopo_valor === escopo)),
      gravado,
    ])
  }

  /** Local escolhido preenche UF E MUNICÍPIO JUNTOS — nunca um sem o outro. */
  function usarLocal(l: { uf: string; municipio: string }) {
    setMexeu(true)
    setCedente((f) => ({ ...f, uf: l.uf, municipio: l.municipio }))
  }

  /**
   * O cadastro do banco já foi lido alguma vez nesta janela?
   *
   * SEM ISSO, GRAVAR APAGAVA ÀS CEGAS. Falhando a primeira leitura (a view do
   * placar, por exemplo), `sujeitos` fica vazio — e a confirmação de remoção,
   * que é calculada sobre ele, não aparece. Gravar então trocava o cedente que
   * já estava no banco, levando junto as certidões já obtidas, sem uma pergunta.
   */
  const carregouUmaVez = useRef(false)

  const recarregar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      const [rs, ri, rc, ru, rl] = await Promise.all([
        supabase
          .from('dd_sujeito')
          .select(
            'id, papel, tipo_pessoa, nome, documento, data_nascimento, uf_atual,' +
              ' municipio_atual, ufs_anteriores, municipios_anteriores,' +
              ' residencia_levantada',
          )
          .eq('kommo_lead_id', leadId)
          .order('papel'),
        supabase.from('dd_certidao').select(SELECT_ITENS).eq('kommo_lead_id', leadId),
        supabase
          .from('v_dd_completude')
          .select('*')
          .eq('kommo_lead_id', leadId)
          .maybeSingle(),
        // Links por escopo (migration 0046). Tabela global: o link do TJ do
        // Paraná serve a todo crédito do Paraná, não só a este.
        supabase
          .from('certidao_url')
          .select('certidao_codigo, escopo_valor, url, informado_em'),
        supabase
          .from('kommo_leads')
          .select('processo_cnj, drive_pasta_id')
          .eq('kommo_lead_id', leadId)
          .maybeSingle(),
      ])
      if (rs.error) throw new Error(rs.error.message)
      if (ri.error) throw new Error(ri.error.message)
      // O erro da view era engolido: o placar simplesmente não aparecia, e
      // "falhou ao ler" ficava indistinguível de "não tem nada aqui ainda".
      if (rc.error) throw new Error(`Placar de completude: ${rc.error.message}`)
      // Falha aqui não derruba a tela: sem os links a lista ainda serve, e cada
      // linha mostra "sem link" com o campo para cadastrar. Mas o erro aparece,
      // porque "não consegui ler os links" e "não há link" são coisas diferentes.
      if (ru.error) {
        setErroLinks(
          `Não consegui ler os links de emissão: ${ru.error.message}. ` +
            `A migration 0046 já rodou no SQL Editor?`,
        )
      } else {
        setErroLinks(null)
      }

      const listaS = (rs.data ?? []) as unknown as Sujeito[]
      setSujeitos(listaS)
      setItens((ri.data ?? []) as unknown as ItemChecklist[])
      setCompletude((rc.data ?? null) as Completude | null)
      setUrls((ru.data ?? []) as unknown as UrlPorEscopo[])
      setCnjDoCredito(
        ((rl.data as { processo_cnj?: string } | null)?.processo_cnj ?? null),
      )
      setDrivePastaId((rl.data as { drive_pasta_id?: string | null } | null)?.drive_pasta_id ?? null)

      // Sem sujeito nenhum, a única coisa útil é o formulário. Com sujeito, o
      // padrão é ver o que já existe — corrigir é ação explícita.
      const ced = listaS.find((s) => s.papel === 'CEDENTE')
      const cnj = listaS.find((s) => s.papel === 'CONJUGE')
      const daPessoa = (s: Sujeito | undefined): FormPessoa | null =>
        s
          ? {
              nome: s.nome,
              cpf: formatCpfCnpjInput(s.documento),
              uf: s.uf_atual ?? '',
              municipio: s.municipio_atual ?? '',
              nascimento: s.data_nascimento ?? '',
            }
          : null
      setCedente(daPessoa(ced) ?? { ...VAZIO, nome: cedenteDoCard })
      // PF OU PJ: o que está gravado; sem cadastro, o que o nome do card diz
      // ("LTDA", "S/A"…). O gravado conta como escolha — a IA não o troca.
      setTipoCedente(ced?.tipo_pessoa ?? tipoPessoaPeloNome(cedenteDoCard) ?? 'PF')
      tipoEscolhido.current = Boolean(ced)
      // O CPF QUE VEM DO BANCO NÃO É UMA ESCOLHA NOVA. Sem isto, o efeito do
      // "escolheu o CPF" o tratava como tal e, achando um estado civil nos autos,
      // trocava a caixa do cônjuge do cadastro gravado e marcava a janela como
      // alterada — antes de alguém mexer em nada.
      cpfAplicado.current = ced ? onlyDigits(ced.documento) : ''
      setConjuge(daPessoa(cnj) ?? VAZIO)
      setTemConjuge(!!cnj)
      setResidenciaLevantada(ced?.residencia_levantada ?? false)
      setUfsAnteriores((ced?.ufs_anteriores ?? []).join(', '))
      setMunicipiosAnteriores((ced?.municipios_anteriores ?? []).join(', '))
      setEditando(listaS.length === 0)
      setMexeu(false)
      setAchadosAbertos(null)
      setResidenciaAberta(false)
      setConjugeAberto(false)
      carregouUmaVez.current = true
    } catch (e) {
      setErro((e as Error)?.message ?? String(e))
    } finally {
      setCarregando(false)
    }
  }, [leadId, cedenteDoCard])

  // VOLTAR À ABA NÃO PODE APAGAR O FORMULÁRIO. O painel fica montado ao trocar
  // de aba justamente para isso (ver `ativo`), mas o `recarregar` da volta
  // reescrevia o cedente, o cônjuge e as UFs com o que está no banco e zerava o
  // `mexeu` — o que foi digitado sumia, e fechar a janela já nem perguntava.
  // Com alteração não salva, a volta só atualiza o checklist e o placar.
  const sujoNaVolta = useRef(false)
  sujoNaVolta.current = editando && mexeu
  useEffect(() => {
    if (!ativo) return
    if (sujoNaVolta.current) void recarregarItens()
    else void recarregar()
    // `recarregarItens` não entra: ele só serve à volta com o formulário sujo,
    // e muda junto com `recarregar` (os dois dependem de `leadId`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ativo, recarregar])

  // O RECARREGAR DA EMISSÃO: só o checklist e o placar, sem o "Carregando…"
  // que desmonta a lista e sem mexer no formulário. É o que roda a cada minuto
  // enquanto a BullAI trabalha — o `recarregar` inteiro, ali, apagaria as marcações.
  const recarregarItens = useCallback(async () => {
    // A PASTA DO CARD JUNTO: a primeira certidão baixada pode tê-la gravado
    // (quando o card ainda não tinha nenhuma), e o atalho do topo a mostra.
    const [ri, rc, rl] = await Promise.all([
      supabase.from('dd_certidao').select(SELECT_ITENS).eq('kommo_lead_id', leadId),
      supabase.from('v_dd_completude').select('*').eq('kommo_lead_id', leadId).maybeSingle(),
      supabase.from('kommo_leads').select('drive_pasta_id').eq('kommo_lead_id', leadId).maybeSingle(),
    ])
    if (!ri.error) setItens((ri.data ?? []) as unknown as ItemChecklist[])
    if (!rc.error) setCompletude((rc.data ?? null) as Completude | null)
    if (!rl.error) setDrivePastaId((rl.data as { drive_pasta_id?: string | null } | null)?.drive_pasta_id ?? null)
  }, [leadId])

  /**
   * A IA LÊ OS AUTOS E PREENCHE O CADASTRO — ao abrir a aba de um crédito ainda
   * sem ninguém cadastrado, ou quando alguém pede de novo.
   *
   * É o que o parser de CPF não sabe fazer: dizer QUAL dos CPFs do processo é
   * de quem cede. Por isso aqui o CPF entra, e no parser não — mas só depois de
   * `normalizarQualificacao` conferir que aquele número está ESCRITO nos autos
   * e tem dígito válido. O trecho de cada campo fica à vista, e nada é gravado
   * até alguém clicar em "Gravar e montar checklist".
   *
   * SÓ TOCA EM CAMPO VAZIO: o que a pessoa digitou vence o que a IA leu.
   */
  //
  // E SÓ DO CEDENTE (pedido do dono, 03/10/2026): o nome vai junto — o do
  // formulário, que é o do card ou o que alguém já corrigiu —, e o servidor
  // devolve só os dados dessa pessoa, conferidos contra a qualificação DELA.
  const cedenteRef = useRef(cedente)
  cedenteRef.current = cedente
  const tipoRef = useRef(tipoCedente)
  tipoRef.current = tipoCedente

  async function lerComIA() {
    const comTexto = arquivos.filter((a) => (a.texto ?? '').trim())
    const texto = comTexto.map((a) => a.texto).join('\n\n===== PRÓXIMO ARQUIVO =====\n\n')
    if (!texto.trim()) return
    setLendoIA(true)
    try {
      const q = await invokeFunction<LeituraDaIA>('dd-qualificacao', {
        lead_id: leadId,
        titulo: tituloDoCard,
        // OS ANEXOS COM O NOME (03/10/2026): é pelo nome ("ofício", "RPV") e
        // pelo conteúdo que o servidor acha o ofício requisitório. O `texto`
        // junto é para o servidor anterior, enquanto o deploy não termina.
        // Vão também os SEM texto: um ofício digitalizado é "achei e não li", e
        // não "não há ofício".
        arquivos: arquivos.map((a) => ({ nome: a.nome, texto: a.texto ?? '' })),
        texto,
        parcela: classificarParcelaCedida(lerTituloCard(tituloDoCard).parcelaCedida),
        cedente: cedenteRef.current.nome.trim() || cedenteDoCard,
      })
      setLeituraIA(q)
      aplicarLeitura(q)
    } catch (e) {
      toast.error(`A IA não conseguiu ler a qualificação: ${(e as Error).message}`)
    } finally {
      setLendoIA(false)
    }
  }

  /** O nome do município como o IBGE escreve, para o campo aceitar. */
  function municipioDoIbge(uf: string, nome: string): string {
    const sem = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
    return (municipios[uf] ?? []).find((m) => sem(m) === sem(nome)) ?? nome
  }

  function aplicarLeitura(q: QualificacaoLida) {
    const feitos: string[] = []
    const atual = q.residencias.find((r) => r.atual)
    const anteriores = q.residencias.filter((r) => !r.atual)
    const c = q.cedente
    // PF OU PJ: a IA marca o tipo só enquanto ninguém escolheu à mão nem
    // digitou documento — a mesma regra do "só toca em campo vazio".
    const tipo: TipoPessoa =
      c.tipo_pessoa && !tipoEscolhido.current && !onlyDigits(cedenteRef.current.cpf)
        ? c.tipo_pessoa
        : tipoRef.current
    if (tipo !== tipoRef.current) setTipoCedente(tipo)
    // O documento da IA só entra se for do tipo escolhido: um CNPJ não vai para
    // o campo de quem a pessoa marcou como pessoa física.
    // (Servidor anterior a 03/10/2026 não manda o tipo: é pessoa física.)
    const tipoLido: TipoPessoa = c.tipo_pessoa ?? 'PF'
    const doc = tipoLido !== tipo ? null : tipoLido === 'PJ' ? (c.cnpj ?? null) : c.cpf
    const pf = tipo === 'PF'
    // O parser de CPF preenche nascimento e endereço ao ver um CPF novo; com a
    // leitura da IA já feita, ele não tem o que acrescentar.
    if (pf && c.cpf) cpfAplicado.current = c.cpf.valor
    setCedente((f) => {
      const n = { ...f }
      if (!n.nome.trim() && c.nome) n.nome = c.nome.valor
      if (!onlyDigits(n.cpf) && doc) n.cpf = mascaraDoTipo(doc.valor, tipo)
      if (pf && !n.nascimento && c.nascimento) n.nascimento = c.nascimento.valor
      if (!n.uf && atual) {
        n.uf = atual.uf
        n.municipio = atual.municipio ? municipioDoIbge(atual.uf, atual.municipio) : ''
      }
      return n
    })
    if (doc) feitos.push(`${rotuloDoc(tipo)} ${formatCpfCnpjInput(doc.valor)}`)
    if (pf && c.nascimento) feitos.push(`nascimento ${c.nascimento.valor.split('-').reverse().join('/')}`)
    if (atual) {
      feitos.push(`${pf ? 'residência' : 'sede'} ${atual.municipio ? atual.municipio + '/' : ''}${atual.uf}`)
    }
    if (anteriores.length > 0) {
      setUfsAnteriores((v) => v.trim() || [...new Set(anteriores.map((r) => r.uf))].join(', '))
      setMunicipiosAnteriores(
        (v) =>
          v.trim() ||
          anteriores
            .filter((r) => r.municipio)
            .map((r) => municipioDoIbge(r.uf, r.municipio))
            .join(', '),
      )
      feitos.push(`${anteriores.length} ${pf ? 'residência(s)' : 'endereço(s) de sede'} anterior(es)`)
    }
    if (pf && q.estado_civil) {
      const pede = PEDE_CONJUGE.has(q.estado_civil.valor)
      // SÓ LIGA, NUNCA DESLIGA (ver o efeito do CPF): a leitura leva segundos, e
      // o cônjuge marcado à mão nesse meio-tempo não pode sumir com a resposta.
      setTemConjuge((v) => v || pede)
      feitos.push(ROTULO_ESTADO_CIVIL[q.estado_civil.valor] ?? q.estado_civil.valor)
      if (pede && q.conjuge) {
        const j = q.conjuge
        setConjuge((f) => ({
          ...f,
          nome: f.nome.trim() || j.nome?.valor || '',
          cpf: onlyDigits(f.cpf) ? f.cpf : j.cpf ? formatCpfCnpjInput(j.cpf.valor) : '',
          nascimento: f.nascimento || j.nascimento?.valor || '',
        }))
        if (j.nome) feitos.push(`cônjuge ${j.nome.valor}`)
      }
    }
    if (feitos.length > 0) {
      setMexeu(true)
      // O QUE VEIO DO OFÍCIO FICA: era apagado por esta lista, e a tela passava
      // a dizer que o documento foi digitado.
      setPreenchido((v) => [...v.filter((x) => x.endsWith('(do ofício)')), ...feitos])
    }
  }

  useEffect(() => {
    if (!ativo || carregando || !editando || sujeitos.length > 0 || lendoPdf || !temTexto) return
    if (leituraPedida.current === leadId) return
    leituraPedida.current = leadId
    void lerComIA()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ativo, carregando, editando, sujeitos.length, lendoPdf, temTexto, leadId])

  // ---------------------------------------------------------------- o ofício
  //
  // O TITULAR É O DO OFÍCIO REQUISITÓRIO (regra do dono, 03/10/2026): "o
  // cedente deve corresponder ao titular do crédito, do precatório, o que
  // precisa corresponder ao ofício anexado no kommo". A MESMA leitura do
  // servidor (_shared/oficioDoCredito.ts, pura) roda aqui sobre os anexos já
  // lidos: sem custo, ela pré-preenche e avisa antes de a IA responder — e
  // também com o cadastro já gravado, quando a IA nem é chamada. Chegando a
  // resposta do servidor (que a IA confirmou), vale a dele.
  const parcelaDoCard = useMemo(
    () => classificarParcelaCedida(lerTituloCard(tituloDoCard).parcelaCedida),
    [tituloDoCard],
  )
  const oficioLocal = useMemo(
    () =>
      lendoPdf || arquivos.length === 0
        ? null
        : oficioParaACessao(
            arquivos.map((a) => ({ nome: a.nome, texto: a.texto ?? '' })),
            parcelaDoCard,
            cedenteDoCard,
          ),
    [arquivos, lendoPdf, parcelaDoCard, cedenteDoCard],
  )
  // O servidor anterior a 03/10/2026 não manda os campos do ofício: aí, o local.
  const servidorLeuOficio = Boolean(leituraIA && leituraIA.aviso_do_oficio !== undefined)
  const titularOficio: TitularDoOficio | null = servidorLeuOficio
    ? (leituraIA?.titular_do_oficio ?? null)
    : (oficioLocal?.titular ?? null)
  const avisoOficio: string | null = servidorLeuOficio
    ? (leituraIA?.aviso_do_oficio ?? null)
    : (oficioLocal?.aviso ?? null)
  const divergenciaDoTitulo = servidorLeuOficio
    ? (leituraIA?.divergencia ?? null)
    : (oficioLocal?.divergencia ?? null)
  const semOficio = servidorLeuOficio
    ? leituraIA?.oficio?.achado === false
    : Boolean(oficioLocal && oficioLocal.oficios.length === 0)

  /**
   * O OFÍCIO PRÉ-PREENCHE O CADASTRO — a regra de sempre: só campo vazio, e o
   * que a pessoa digitou vence. O NOME QUE VEIO DO CARD NÃO É DIGITAÇÃO: o
   * formulário de um crédito sem cadastro nasce com o nome do título, e é
   * justamente ele que o ofício corrige. O tipo PF/PJ segue o documento do
   * ofício (14 dígitos é PJ), enquanto ninguém escolheu à mão nem digitou
   * documento. Uma vez por titular: apagar o campo depois não o traz de volta.
   */
  const oficioAplicado = useRef('')
  useEffect(() => {
    const t = titularOficio
    if (!t || !editando || sujeitos.length > 0) return
    const chave = `${leadId}|${t.nome}|${t.documento}`
    if (oficioAplicado.current === chave) return
    oficioAplicado.current = chave
    const atual = cedenteRef.current
    const doc = t.documento
    const tipoDoOficio: TipoPessoa | null = doc.length === 14 ? 'PJ' : doc.length === 11 ? 'PF' : null
    let tipo = tipoRef.current
    if (tipoDoOficio && tipoDoOficio !== tipo && !tipoEscolhido.current && !onlyDigits(atual.cpf)) {
      tipo = tipoDoOficio
      setTipoCedente(tipo)
    }
    const nomeEntra =
      Boolean(t.nome) &&
      (!atual.nome.trim() || atual.nome.trim() === cedenteDoCard.trim()) &&
      atual.nome.trim() !== t.nome
    const docEntra = Boolean(doc) && !onlyDigits(atual.cpf) && tipoDoOficio === tipo
    if (!nomeEntra && !docEntra) return
    setCedente((f) => ({
      ...f,
      nome: nomeEntra ? t.nome : f.nome,
      cpf: docEntra && !onlyDigits(f.cpf) ? mascaraDoTipo(doc, tipo) : f.cpf,
    }))
    setMexeu(true)
    const feitos = [
      ...(nomeEntra ? [`nome ${t.nome}`] : []),
      ...(docEntra ? [`${rotuloDoc(tipo)} ${formatarDocumento(doc)}`] : []),
    ]
    setPreenchido((v) => [...v.filter((x) => !x.endsWith('(do ofício)')), `${feitos.join(' e ')} (do ofício)`])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [titularOficio, editando, sujeitos.length, leadId, cedenteDoCard])

  /**
   * O CADASTRO (gravado ou digitado) DIVERGE DO OFÍCIO? É a pessoa ou o
   * documento: nome que não é a mesma pessoa (tolerando acento, nome do meio,
   * espólio), ou documento diferente.
   */
  const docDoCadastro = onlyDigits(cedente.cpf)
  const cadastroDivergeDoOficio = Boolean(
    titularOficio &&
      ((cedente.nome.trim() &&
        titularOficio.nome &&
        !mesmaPessoa(cedente.nome, titularOficio.nome, [titularOficio.sucede])) ||
        (docDoCadastro && titularOficio.documento && docDoCadastro !== titularOficio.documento)),
  )

  /** "Usar o do ofício": nome, documento e o tipo que o documento diz. */
  function usarDoOficio() {
    const t = titularOficio
    if (!t) return
    const tipo: TipoPessoa =
      t.documento.length === 14 ? 'PJ' : t.documento.length === 11 ? 'PF' : tipoCedente
    tipoEscolhido.current = true
    setEditando(true)
    setMexeu(true)
    setTipoCedente(tipo)
    setCedente((f) => ({
      ...f,
      nome: t.nome || f.nome,
      cpf: t.documento
        ? mascaraDoTipo(t.documento, tipo)
        : onlyDigits(f.cpf).length === (tipo === 'PJ' ? 14 : 11)
          ? f.cpf
          : '',
    }))
    setPreenchido((v) => [
      ...v.filter((x) => !x.endsWith('(do ofício)')),
      `nome${t.documento ? ` e ${rotuloDoc(tipo)}` : ''} (do ofício)`,
    ])
  }

  const comDoc = (nome: string, doc: string) =>
    doc ? `${nome} (${doc.length === 14 ? 'CNPJ' : 'CPF'} ${formatarDocumento(doc)})` : nome

  /**
   * O AVISO DE DESTAQUE DO OFÍCIO, no topo do painel e fora da lista dos
   * outros avisos — "não some no meio dos outros" (pedido do dono). A
   * divergência com o título em âmbar e com a frase inteira; sem ofício, uma
   * nota; o ofício que confirma, uma linha verde com o documento.
   */
  function avisoDoOficio(): ReactNode {
    if (carregando || (!oficioLocal && !servidorLeuOficio)) return null
    if (divergenciaDoTitulo) {
      return (
        <CaixaDeAviso tom="aviso" role="alert" className="mb-3">
          <b className="text-texto">O título do card e o ofício requisitório divergem.</b>{' '}
          {divergenciaDoTitulo.mensagem}
        </CaixaDeAviso>
      )
    }
    if (avisoOficio) {
      return (
        <CaixaDeAviso tom={semOficio ? 'info' : 'aviso'} className="mb-3">
          <b className="text-texto">Ofício requisitório:</b> {avisoOficio}
        </CaixaDeAviso>
      )
    }
    // O OFÍCIO QUE CONFIRMA virou o selo "conferido no ofício" da faixa de
    // resumo (com o arquivo ao lado e o titular na dica): confirmação não é
    // aviso, e uma caixa verde inteira para ela era metade da poluição.
    return null
  }

  /** "O cadastro tem X; o ofício diz Y", com o botão para usar o do ofício. */
  function divergenciaDoCadastro(): ReactNode {
    if (!titularOficio || !cadastroDivergeDoOficio) return null
    return (
      <CaixaDeAviso tom="perigo" role="alert" className="mb-3">
        <span className="flex flex-wrap items-center justify-between gap-3">
          <span className="min-w-0 flex-1">
            <b className="text-texto">O cadastro não bate com o ofício requisitório.</b> Cadastro:{' '}
            {comDoc(cedente.nome.trim() || '(sem nome)', docDoCadastro)}; ofício:{' '}
            {comDoc(titularOficio.nome, titularOficio.documento)}. As certidões saem no nome de quem está no
            ofício.
          </span>
          <Button variant="secondary" size="sm" onClick={usarDoOficio}>
            Usar o do ofício
          </Button>
        </span>
      </CaixaDeAviso>
    )
  }

  // ---------------------------------------------------------------- validação

  const problemas = useMemo(() => {
    const p: string[] = []
    const pj = tipoCedente === 'PJ'
    if (!cedente.nome.trim()) {
      p.push(pj ? 'A razão social do cedente é obrigatória.' : 'O nome do cedente é obrigatório.')
    }
    if (!documentoValido(cedente.cpf, tipoCedente)) {
      p.push(
        pj
          ? 'CNPJ do cedente inválido — confira os 14 dígitos no processo.'
          : 'CPF do cedente inválido — confira os 11 dígitos no processo.',
      )
    }
    if (!cedente.uf) {
      p.push(
        (pj ? 'UF da sede do cedente é obrigatória' : 'UF atual do cedente é obrigatória') +
          ': é ela que define as certidões estaduais do checklist.',
      )
    }
    // ESTADO ESCRITO DE UM JEITO QUE NÃO SE RECONHECE NÃO SOME CALADO: era
    // descartado na gravação, e a certidão estadual dele saía do checklist.
    const ufsNaoReconhecidas = lerUfsDigitadas(ufsAnteriores).naoReconhecidas
    if (ufsNaoReconhecidas.length > 0) {
      p.push(
        `UF anterior não reconhecida: ${ufsNaoReconhecidas.join(', ')}. Use a sigla (MG, SP) ou o nome ` +
          'do estado por extenso.',
      )
    }
    if (comConjuge) {
      if (!conjuge.nome.trim()) p.push('O nome do cônjuge é obrigatório.')
      if (!cpfValido(conjuge.cpf) || onlyDigits(conjuge.cpf).length !== 11) {
        p.push('CPF do cônjuge inválido.')
      }
      if (onlyDigits(conjuge.cpf) === onlyDigits(cedente.cpf)) {
        p.push('O CPF do cônjuge é o mesmo do cedente.')
      }
    }
    return p
  }, [cedente, conjuge, comConjuge, tipoCedente, ufsAnteriores])

  /**
   * O que a gravação vai DESTRUIR. Calculado do que já está na tela, sem ida ao
   * servidor: trocar o CPF de um sujeito apaga o sujeito antigo, e dd_certidao
   * cai em cascata — inclusive as OBTIDA, com o drive_file_id do PDF que alguém
   * já emitiu e guardou. Perder isso sem avisar é inaceitável; o número entra na
   * confirmação.
   */
  const impacto = useMemo(() => {
    const docCed = onlyDigits(cedente.cpf)
    // Cedente PJ: o cônjuge que houver no banco sai (p_conjuge vai nulo).
    const docCnj = comConjuge ? onlyDigits(conjuge.cpf) : null
    const condenados = sujeitos.filter(
      (s) =>
        (s.papel === 'CEDENTE' && s.documento !== docCed) ||
        (s.papel === 'CONJUGE' && (docCnj === null || s.documento !== docCnj)),
    )
    const ids = new Set(condenados.map((s) => s.id))
    const perdidas = itens.filter((i) => ids.has(i.sujeito_id))
    return {
      sujeitos: condenados,
      certidoes: perdidas.length,
      obtidas: perdidas.filter((i) => i.status === 'OBTIDA').length,
    }
  }, [sujeitos, itens, cedente.cpf, conjuge.cpf, comConjuge])

  // ---------------------------------------------------------------- gravação

  /**
   * A confirmação de remoção, numa janela da casa (a "Remover do crédito" da
   * amostra) em vez do `window.confirm`. O TEXTO É O MESMO, e a regra também:
   * sem o "sim" explícito, nada é gravado. `confirmado` só chega `true` pelo
   * botão da janela — o botão de gravar chama sem argumento.
   */
  const [confirmandoRemocao, setConfirmandoRemocao] = useState(false)

  /**
   * A REGRA QUE O MOTOR IGNOROU, dita. É o único aviso do servidor que a tela
   * não refaz sozinha (`derivarAvisos` cobre os outros): uma regra apontando
   * para certidão fora do catálogo deixa uma obrigatória fora do checklist, e o
   * placar sai "completo".
   */
  function avisarRegrasIgnoradas(r: RespostaGeracao) {
    const ignoradas = (r.avisos ?? []).filter((a) => a.startsWith('Regra '))
    if (ignoradas.length > 0) toast.error(ignoradas.join(' · '))
  }

  async function salvarEGerar(confirmado = false) {
    if (problemas.length > 0) return
    if (!carregouUmaVez.current) {
      setErro(
        'Não consegui ler o que já está cadastrado para este crédito, e gravar agora poderia apagar o ' +
          'cedente e as certidões já obtidas sem perguntar. Feche e abra a janela de novo para reler.',
      )
      return
    }

    if (impacto.sujeitos.length > 0 && !confirmado) {
      setConfirmandoRemocao(true)
      return
    }
    setConfirmandoRemocao(false)

    setSalvando(true)
    setErro(null)
    try {
      // Sigla ou nome por extenso; o que não for estado já barrou a gravação
      // (ver `problemas`).
      const listaUf = (s: string) => lerUfsDigitadas(s).ufs
      const pj = tipoCedente === 'PJ'
      const listaTexto = (s: string) =>
        s
          .split(/[,;]/)
          .map((x) => x.trim())
          .filter(Boolean)

      // UMA CHAMADA, UMA TRANSAÇÃO. A versão anterior fazia DELETE e depois
      // INSERT em requisições separadas: se a segunda falhasse — token expirado
      // depois de esperar um PDF de 200 páginas, 502, conexão caída — o crédito
      // ficava sem cedente nenhum, e a tela ainda mostrava os dados antigos.
      // Ver dd_registrar_sujeitos, migração 0043.
      const { data, error } = await supabase.rpc('dd_registrar_sujeitos', {
        p_lead_id: leadId,
        p_cedente: {
          nome: cedente.nome.trim(),
          documento: onlyDigits(cedente.cpf),
          // O TIPO VAI EXPLÍCITO (migração 0075). A função antiga ignora o
          // campo e grava PF — que para CPF é o certo, e para CNPJ o banco
          // recusa (ver o tratamento do erro abaixo).
          tipo_pessoa: tipoCedente,
          data_nascimento: pj ? null : cedente.nascimento || null,
          uf_atual: cedente.uf,
          municipio_atual: cedente.municipio.trim(),
          ufs_anteriores: listaUf(ufsAnteriores),
          municipios_anteriores: listaTexto(municipiosAnteriores),
          residencia_levantada: residenciaLevantada,
        },
        // null APAGA o cônjuge no banco. É o que faz desmarcar a caixa valer
        // algo: antes, desmarcar era no-op e as certidões do cônjuge removido
        // continuavam contando como obrigatórias, para sempre.
        p_conjuge: comConjuge
          ? {
              nome: conjuge.nome.trim(),
              documento: onlyDigits(conjuge.cpf),
              data_nascimento: conjuge.nascimento || null,
              // UF e município viajam JUNTOS. Herdados em separado, escolher SP
              // para o cônjuge e deixar o município em branco gravava
              // "Contagem/SP" — e mandava alguém à prefeitura de Minas buscar
              // certidão de quem está registrado em São Paulo.
              uf_atual: conjuge.uf || cedente.uf,
              municipio_atual: conjuge.uf
                ? conjuge.municipio.trim()
                : cedente.municipio.trim(),
            }
          : null,
      })
      if (error) {
        // CNPJ RECUSADO POR "tipo_bate_documento" É MIGRAÇÃO PENDENTE, e não
        // dígito errado: a função de antes da 0075 grava todo cedente como PF.
        // Dizer "dígito inválido" mandaria conferir um CNPJ que está certo.
        throw new Error(
          pj && /tipo_bate_documento/.test(error.message)
            ? 'O banco ainda não aceita cedente pessoa jurídica: falta rodar a migração 0075 ' +
                '(0075_cedente_pessoa_juridica.sql) no SQL Editor do Supabase. Nada foi gravado.'
            : /documento_dv|documento_digitos|tipo_bate_documento/.test(error.message)
              ? `O banco recusou o documento: dígito verificador inválido. Confira o ${rotuloDoc(tipoCedente)} no processo.`
              : error.message,
        )
      }
      const rel = (data ?? {}) as { certidoes_removidas?: number }
      if (rel.certidoes_removidas) {
        toast.success(`${rel.certidoes_removidas} item(ns) do checklist antigo removido(s).`)
      }

      // O NOME DA MÃE, quando a IA o leu para ESTE CPF. O formulário não tem o
      // campo, e a BullAI o usa para separar homônimos; perder é pior que gravar
      // o que está escrito nos autos. Falha aqui não desfaz o cadastro — mas é
      // DITA: engolida, a BullAI seguia sem o nome da mãe e ninguém sabia por quê.
      // Só de pessoa física: empresa não tem mãe.
      const mae = leituraIA?.cedente.nome_mae?.valor
      if (!pj && mae && leituraIA?.cedente.cpf?.valor === onlyDigits(cedente.cpf)) {
        const { error: erroMae } = await supabase
          .from('dd_sujeito')
          .update({ nome_mae: mae })
          .eq('kommo_lead_id', leadId)
          .eq('papel', 'CEDENTE')
          .is('nome_mae', null)
        if (erroMae) {
          toast.error(`Cadastro gravado, mas o nome da mãe lido dos autos não: ${erroMae.message}`)
        }
      }

      const r = await invokeFunction<RespostaGeracao>('gerar-checklist-certidoes', {
        kommo_lead_id: leadId,
      })
      avisarRegrasIgnoradas(r)
      toast.success(
        `Checklist montado: ${r.total ?? 0} item(ns), ${r.obrigatorias ?? 0} obrigatório(s)` +
          (r.pendencia_imediata ? `, ${r.pendencia_imediata} já em pendência manual` : '') +
          '.',
      )
      await recarregar()
    } catch (e) {
      setErro((e as Error)?.message ?? String(e))
    } finally {
      setSalvando(false)
    }
  }

  /**
   * Roda o motor de regras de novo sobre os sujeitos já cadastrados.
   *
   * ELE SÓ ACRESCENTA. A função grava com `ignoreDuplicates`, então item que
   * deixou de ser exigido — porque a UF foi corrigida, por exemplo — NÃO sai da
   * lista, e `obrigatoria` de item existente não é atualizado. Daí o rótulo ser
   * "Gerar itens faltantes" e não "Recalcular": o botão faz o que o nome diz, e
   * um nome que prometesse reconciliação faria a pessoa confiar num acerto que
   * não aconteceu. Para tirar item que sobrou, corrija os dados — a troca de
   * sujeito apaga e remonta.
   */
  async function gerarFaltantes() {
    setSalvando(true)
    setErro(null)
    try {
      const r = await invokeFunction<RespostaGeracao>('gerar-checklist-certidoes', {
        kommo_lead_id: leadId,
      })
      avisarRegrasIgnoradas(r)
      await recarregar()
      toast.success(`Motor rodou: ${r.total ?? 0} item(ns) na regra de hoje.`)
    } catch (e) {
      setErro((e as Error)?.message ?? String(e))
    } finally {
      setSalvando(false)
    }
  }

  // ---------------------------------------------------------------- render


  /**
   * Publica o "tem alteração não salva" para a janela.
   *
   * Era o `dirty` do modal que este componente foi. Quem pede a confirmação de
   * descarte é a janela, e ela não tem como saber de `editando` e `mexeu` — que
   * são estado interno do formulário. Daí subir por callback em vez de a janela
   * adivinhar.
   */
  const sujo = editando && mexeu
  useEffect(() => {
    onDirtyChange?.(sujo)
  }, [sujo, onDirtyChange])

  const municipiosDaUf = (uf: string) => (uf ? (municipios[uf] ?? []) : [])
  const alterar = <T,>(set: (v: T) => void) => (v: T) => {
    setMexeu(true)
    set(v)
  }

  /**
   * PF ↔ PJ, escolhido à mão. A escolha manda daí em diante (a IA não a
   * desfaz), e o documento digitado que não cabe no tipo novo sai — um CPF no
   * campo de CNPJ é necessariamente errado, e cortar dígitos o deixaria errado
   * em silêncio.
   */
  function escolherTipo(t: TipoPessoa) {
    if (t === tipoCedente) return
    tipoEscolhido.current = true
    setMexeu(true)
    setTipoCedente(t)
    setCedente((f) => (onlyDigits(f.cpf).length === (t === 'PJ' ? 14 : 11) ? f : { ...f, cpf: '' }))
  }

  // ---------------------------------------------------------------- achados
  //
  // A CAIXA DE ACHADOS, ASSERTIVA (pedido do dono, 03/10/2026). Antes ela listava
  // todo CPF de dígito válido do processo, toda data de nascimento rotulada e
  // toda cidade com UF — de todas as pessoas: o cedente, o outro autor, o
  // advogado, o réu. Com a leitura da IA feita, a caixa mostra o que a IA
  // identificou DO CEDENTE, cada dado com o trecho de onde saiu; a busca crua
  // fica recolhida embaixo, como recurso manual. Sem leitura (falhou, processo
  // digitalizado), a caixa é a de sempre.
  const tipoDaLeitura: TipoPessoa = leituraIA?.cedente.tipo_pessoa ?? 'PF'
  const docDaLeitura: Lido<string> | null = leituraIA
    ? tipoDaLeitura === 'PJ'
      ? (leituraIA.cedente.cnpj ?? null)
      : leituraIA.cedente.cpf
    : null
  const iaAchouCedente = Boolean(
    leituraIA &&
      (docDaLeitura ||
        leituraIA.cedente.nascimento ||
        leituraIA.estado_civil ||
        leituraIA.residencias.length > 0),
  )
  const nomeProcurado = leituraIA?.alvo?.nome || cedente.nome.trim() || cedenteDoCard

  /** Usa uma residência (ou sede) lida: a atual vai para UF/município; a anterior, para as listas. */
  function usarResidenciaLida(r: { uf: string; municipio: string; atual: boolean }) {
    const municipio = r.municipio ? municipioDoIbge(r.uf, r.municipio) : ''
    if (r.atual) {
      usarLocal({ uf: r.uf, municipio })
      return
    }
    setMexeu(true)
    const junta = (lista: string, item: string) => {
      const itens = lista.split(/[,;]/).map((x) => x.trim()).filter(Boolean)
      return itens.some((x) => x.toLowerCase() === item.toLowerCase()) ? lista : [...itens, item].join(', ')
    }
    setUfsAnteriores((v) => junta(v, r.uf))
    if (municipio) setMunicipiosAnteriores((v) => junta(v, municipio))
  }

  /** Aplica o estado civil lido pela IA, com o cônjuge que ela trouxe (só em campo vazio). */
  function usarEstadoCivilLido() {
    const ec = leituraIA?.estado_civil
    if (!ec) return
    setMexeu(true)
    const pede = PEDE_CONJUGE.has(ec.valor)
    setTemConjuge(pede)
    const j = leituraIA?.conjuge
    if (pede && j) {
      setConjuge((f) => ({
        ...f,
        nome: f.nome.trim() || j.nome?.valor || '',
        cpf: onlyDigits(f.cpf) ? f.cpf : j.cpf ? formatCpfCnpjInput(j.cpf.valor) : '',
        nascimento: f.nascimento || j.nascimento?.valor || '',
      }))
    }
  }

  /** Um dado lido pela IA: o valor, o trecho dos autos embaixo, e clicar usa. */
  function itemDaLeitura(chave: string, rotulo: string, valor: ReactNode, evidencia: string, usar?: () => void) {
    const corpo = (
      <>
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-xs text-texto-3">{rotulo}</span>
          <b className="font-bold">{valor}</b>
        </span>
        {evidencia && <span className={TRECHO}>“{evidencia}”</span>}
      </>
    )
    return usar ? (
      <button key={chave} type="button" onClick={usar} className={CAND}>
        {corpo}
      </button>
    ) : (
      <div key={chave} className={CAND_FIXO}>
        {corpo}
      </div>
    )
  }

  /** O que a IA identificou do cedente — a parte principal da caixa, com a leitura feita. */
  function achadosDaLeitura() {
    if (!leituraIA) return null
    const c = leituraIA.cedente
    const pj = tipoDaLeitura === 'PJ'
    const itensLidos: ReactNode[] = []
    if (c.nome) {
      itensLidos.push(
        itemDaLeitura('nome', pj ? 'Razão social' : 'Nome', c.nome.valor, c.nome.evidencia, () =>
          alterar(setCedente)({ ...cedente, nome: c.nome!.valor }),
        ),
      )
    }
    if (docDaLeitura) {
      itensLidos.push(
        itemDaLeitura(
          'doc',
          rotuloDoc(tipoDaLeitura),
          <span className="tabular-nums">{formatCpfCnpjInput(docDaLeitura.valor)}</span>,
          docDaLeitura.evidencia,
          () => {
            if (tipoDaLeitura !== tipoCedente) {
              tipoEscolhido.current = true
              setTipoCedente(tipoDaLeitura)
            }
            alterar(setCedente)({ ...cedente, cpf: mascaraDoTipo(docDaLeitura.valor, tipoDaLeitura) })
          },
        ),
      )
    }
    if (!pj && c.nascimento) {
      itensLidos.push(
        itemDaLeitura(
          'nasc',
          'Nascimento',
          <span className="tabular-nums">{c.nascimento.valor.split('-').reverse().join('/')}</span>,
          c.nascimento.evidencia,
          () => alterar(setCedente)({ ...cedente, nascimento: c.nascimento!.valor }),
        ),
      )
    }
    if (!pj && c.nome_mae) {
      // SEM CLIQUE: o formulário não tem o campo. O nome da mãe é gravado junto
      // com o cadastro quando o CPF gravado é este mesmo (ver salvarEGerar).
      itensLidos.push(itemDaLeitura('mae', 'Mãe (gravada junto com este CPF)', c.nome_mae.valor, c.nome_mae.evidencia))
    }
    if (!pj && leituraIA.estado_civil) {
      const j = leituraIA.conjuge
      itensLidos.push(
        itemDaLeitura(
          'ec',
          'Estado civil',
          <>
            {ROTULO_ESTADO_CIVIL[leituraIA.estado_civil.valor] ?? leituraIA.estado_civil.valor}
            {j?.nome && ` — cônjuge: ${j.nome.valor}`}
            {j?.cpf && <span className="tabular-nums"> (CPF {formatCpfCnpjInput(j.cpf.valor)})</span>}
          </>,
          leituraIA.estado_civil.evidencia,
          usarEstadoCivilLido,
        ),
      )
    }
    for (const r of leituraIA.residencias) {
      itensLidos.push(
        itemDaLeitura(
          `res-${r.uf}-${r.municipio}`,
          pj ? (r.atual ? 'Sede atual' : 'Sede anterior') : r.atual ? 'Residência atual' : 'Residência anterior',
          `${r.municipio ? `${r.municipio}/` : ''}${r.uf}`,
          r.evidencia,
          () => usarResidenciaLida(r),
        ),
      )
    }
    return (
      <>
        <p className="mt-2 text-xs text-texto-3">
          Só a qualificação de <b className="text-texto-2">{nomeProcurado || 'o cedente'}</b>
          {pj ? ' (pessoa jurídica)' : ''}, cada dado com o trecho dos autos. Clicar usa no cadastro.
        </p>
        <div className="my-2 grid gap-2">{itensLidos}</div>
      </>
    )
  }

  /**
   * A BUSCA CRUA DOS ANEXOS: documentos de dígito válido, datas rotuladas como
   * nascimento, cidades com UF e estados civis — de todas as pessoas do
   * processo. Sem leitura da IA, é a caixa (como sempre foi). Com a leitura,
   * vai para o "Outros números no processo", recolhido: sai dela o documento
   * que a IA já identificou, e o achado cujo trecho menciona o cedente sobe,
   * com selo.
   */
  function achadosManuais(outros: boolean) {
    const pj = tipoCedente === 'PJ'
    const doc = rotuloDoc(tipoCedente)
    const marcar = outros ? nomeProcurado : undefined
    const menciona = (contexto: string) => Boolean(marcar) && mencionaNome(contexto, marcar!)
    const docs = outros
      ? candidatos
          .filter((c) => c.doc !== docDaLeitura?.valor)
          .sort((a, b) => Number(menciona(b.contexto)) - Number(menciona(a.contexto)))
      : candidatos
    const nascimentos = pj ? [] : doPdf.nascimentos
    const ecs = pj ? [] : estadosCivis
    const vazio = docs.length === 0 && nascimentos.length === 0 && doPdf.locais.length === 0 && ecs.length === 0
    if (outros && vazio) {
      return <p className="mt-2 text-xs text-texto-3">Nada além do que a IA já identificou.</p>
    }
    return (
      <>
        {/* A EXPLICAÇÃO VEM ANTES DA LISTA, como na amostra: quem lê
            "escolher é seu" antes de ver os números não clica no primeiro
            por reflexo. */}
        {docs.length > 0 && (
          <p className="mt-2 text-xs text-texto-3">
            Dígito conferido. <b className="text-texto-2">Escolher é seu</b>: o processo traz o {doc} do
            cedente, do advogado e de terceiros
            {outros ? ' — estes a leitura não atribuiu ao cedente' : ''}. A lista pode estar incompleta.
          </p>
        )}
        {docs.length === 0 && !outros && (
          <p className="mt-2 text-xs text-aviso">
            Nenhum {doc} de dígito válido no texto — digite o do cedente, conferindo no processo.
          </p>
        )}
        {docs.length > 0 && (
          <div className="my-2 grid gap-2">
            {docs.map((c) => (
              <button
                key={c.doc}
                type="button"
                onClick={() => alterar(setCedente)({ ...cedente, cpf: mascaraDoTipo(c.doc, tipoCedente) })}
                className={CAND}
              >
                <span className="flex flex-wrap items-center gap-2">
                  <b className="font-bold tabular-nums">{formatCpfCnpjInput(c.doc)}</b>
                  {c.rotulado && <Selo tom="info">rotulado &quot;{doc}&quot;</Selo>}
                  {menciona(c.contexto) && <Selo tom="info">menciona o cedente</Selo>}
                </span>
                <span className={SUB}>
                  {c.arquivo ? `em ${c.arquivo} · ` : ''}…{c.contexto}…
                </span>
              </button>
            ))}
          </div>
        )}
        {(nascimentos.length > 0 || doPdf.locais.length > 0) && (
          <Sugestoes
            nascimentos={nascimentos}
            locais={doPdf.locais}
            onNascimento={(iso) => {
              setMexeu(true)
              setCedente((f) => ({ ...f, nascimento: iso }))
            }}
            onLocal={usarLocal}
            vazio=""
            marcarCedente={marcar}
          />
        )}

        {/*
          ESTADO CIVIL: é o que DOBRA o checklist.
          Cedente casado tem bloco próprio de certidões para o cônjuge
          (planilha, linhas 52 a 67). Deixar de marcar fecha o dossiê com
          esse bloco inteiro faltando, e o placar não acusa nada — por isso
          a sugestão fica aqui, na caixa dos achados junto com o CPF, e não
          escondida na caixinha lá embaixo.
        */}
        {ecs.length > 0 && (
          <>
            <p className="mt-2 text-xs text-texto-2">
              <b className="text-texto">Estado civil</b> — clicar liga ou desliga o bloco do cônjuge:
            </p>
            <div className="my-2 grid gap-2">
              {ecs.map((e) => (
                <button
                  key={`${e.estado}-${e.conjuge ?? ''}`}
                  type="button"
                  onClick={() => usarEstadoCivil(e)}
                  className={CAND}
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span>
                      {ROTULO_ESTADO_CIVIL[e.estado] ?? e.estado}
                      {e.conjuge && ` — cônjuge: ${e.conjuge}`}
                    </span>
                    {e.doCedente ? (
                      <Selo tom="info">perto do cedente</Selo>
                    ) : (
                      <Selo tom="aviso">pode ser de outra parte</Selo>
                    )}
                  </span>
                  <span className={SUB}>
                    em {e.arquivo} · …{e.contexto}…
                  </span>
                </button>
              ))}
            </div>
            <p className="text-xs text-aviso">
              Petição antiga: &quot;casada&quot; naquela data não é &quot;casada hoje&quot;. Confirme.
            </p>
          </>
        )}
      </>
    )
  }

  const temAchadosManuais =
    candidatos.length > 0 ||
    (tipoCedente === 'PF' && doPdf.nascimentos.length > 0) ||
    doPdf.locais.length > 0 ||
    (tipoCedente === 'PF' && estadosCivis.length > 0) ||
    digitalizados.length > 0

  // ================================================================ A TELA ENXUTA
  //
  // PEDIDO DO DONO (03/10/2026): "tá muito poluído [...] condensar mais as
  // informações importantes". A ordem passou a ser:
  //   1. a FAIXA DE RESUMO — quem é o cedente, de onde veio o cadastro, o placar
  //      e o atalho para a pasta no Drive;
  //   2. os avisos que mudam o que se faz (erro, ofício, cadastro × ofício), em
  //      destaque; os outros, juntos e recolhidos numa linha que diz quais são;
  //   3. o checklist por ESTADO — problemas e pendências primeiro, obtidas e
  //      dispensadas recolhidas no fim —, uma linha densa por certidão;
  //   4. a emissão pela BullAI, com a seleção recolhida.
  // NADA SAIU: cada texto e cada ação continuam a um clique. As regras também
  // são as de antes — a ficha digitada vence a IA, cedente → checklist →
  // emissão, as confirmações, a trava da BullAI e a regra do ofício.
  const hoje = hojeEmBrasilia()
  const grupos = useMemo(
    () => agruparChecklist(itens, hoje, (i) => i.certidao_catalogo?.nome_curto ?? i.certidao_codigo),
    [itens, hoje],
  )
  const placar = useMemo(() => placarDoChecklist(itens, hoje), [itens, hoje])
  const sujeitoPorId = useMemo(() => new Map(sujeitos.map((s) => [s.id, s])), [sujeitos])
  const variosSujeitos = sujeitos.length > 1
  const semItens = itens.length > 0 ? sujeitos.filter((s) => !itens.some((i) => i.sujeito_id === s.id)) : []
  const pasta: PastaNaTela | null = pastaDaResposta ?? pastaDoChecklistNaTela(itens, drivePastaId)
  const cedenteGravado = sujeitos.find((s) => s.papel === 'CEDENTE')
  const conjugeGravado = sujeitos.find((s) => s.papel === 'CONJUGE')
  const conferencia = conferenciaDoOficio({
    temTitular: Boolean(titularOficio),
    diverge: cadastroDivergeDoOficio,
    semOficio,
  })
  const origem = origemDoCadastro({
    gravado: Boolean(cedenteGravado),
    mexeu,
    doOficio: preenchido.some((x) => x.endsWith('(do ofício)')),
    daIA: iaAchouCedente,
  })
  // O aviso do ofício já está em destaque no topo; os da IA que falam do
  // documento também; os outros vão com os achados, recolhidos.
  const avisosDaIA = (leituraIA?.avisos ?? []).filter((a) => a !== leituraIA?.aviso_do_oficio)
  const avisosIADestaque = avisosDaIA.filter(avisoDaIAEmDestaque)
  const avisosIAMenores = avisosDaIA.filter((a) => !avisoDaIAEmDestaque(a))
  const achadosVisiveis = achadosAbertos ?? !documentoValido(cedente.cpf, tipoCedente)
  const residenciaVisivel = residenciaAberta || Boolean(ufsAnteriores.trim() || municipiosAnteriores.trim())
  const conjugeCompleto =
    Boolean(conjuge.nome.trim()) &&
    onlyDigits(conjuge.cpf).length === 11 &&
    cpfValido(conjuge.cpf) &&
    onlyDigits(conjuge.cpf) !== onlyDigits(cedente.cpf)
  const conjugeVisivel = conjugeAberto || !conjugeCompleto
  /** Mexer no cônjuge mantém o formulário dele aberto até gravar. */
  const alterarConjuge = (f: FormPessoa) => {
    setConjugeAberto(true)
    alterar(setConjuge)(f)
  }

  /** "Cancelar" da edição: volta ao que está gravado, perguntando se havia o que perder. */
  async function cancelarEdicao() {
    if (mexeu && !(await perguntarDescarte())) return
    await recarregar()
  }

  /** Quantos dados do cedente a IA identificou (para a linha de estado da leitura). */
  const dadosLidos = leituraIA
    ? [
        leituraIA.cedente.nome,
        docDaLeitura,
        tipoDaLeitura === 'PF' ? leituraIA.cedente.nascimento : null,
        tipoDaLeitura === 'PF' ? leituraIA.cedente.nome_mae : null,
        tipoDaLeitura === 'PF' ? leituraIA.estado_civil : null,
        ...leituraIA.residencias,
      ].filter(Boolean).length
    : 0
  const estadoDaLeitura = lendoPdf
    ? 'Lendo o PDF do card…'
    : lendoIA
      ? 'A IA está lendo a qualificação nos autos…'
      : iaAchouCedente
        ? `Lido dos autos pela IA · ${dadosLidos} dado${dadosLidos === 1 ? '' : 's'}`
        : leituraIA
          ? 'A IA não achou os dados do cedente com segurança'
          : temAchadosManuais
            ? 'Achados nos anexos para conferir'
            : avisoPdf
              ? 'Não consegui ler os anexos do card'
              : temTexto
                ? `Nenhum ${rotuloDoc(tipoCedente)} de dígito válido nos anexos`
                : 'Os anexos do card ainda não foram lidos'

  /** Um número do placar, com o rótulo ao lado. */
  const numero = (n: ReactNode, rotulo: string, tom = 'text-texto') => (
    <span className="inline-flex items-baseline gap-1.5">
      <b className={cn('font-display text-lg font-bold tabular-nums', tom)}>{n}</b>
      <span className="text-texto-2">{rotulo}</span>
    </span>
  )

  /** O topo da aba: o cedente numa linha, o placar noutra, e os atalhos. */
  function faixaDeResumo(): ReactNode {
    const nome = editando ? cedente.nome.trim() : (cedenteGravado?.nome ?? '')
    const tipo: TipoPessoa = editando ? tipoCedente : (cedenteGravado?.tipo_pessoa ?? tipoCedente)
    const doc = editando ? onlyDigits(cedente.cpf) : (cedenteGravado?.documento ?? '')
    const lugar = (
      editando
        ? [cedente.municipio, cedente.uf]
        : [cedenteGravado?.municipio_atual, cedenteGravado?.uf_atual]
    )
      .filter(Boolean)
      .join('/')
    const completa = Boolean(completude && completude.necessarias > 0 && completude.obtidas_validas === completude.necessarias)
    return (
      <div className="mb-3 rounded-cartao border border-borda bg-superficie px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <div className="flex min-w-[min(100%,300px)] flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-corpo">
            <span className="text-sm font-semibold text-texto-2">Cedente</span>
            <b className="min-w-0 break-words font-bold text-texto">{nome || 'ainda sem cadastro'}</b>
            {doc && (
              <CopiarTexto
                valor={doc}
                rotulo={`Copiar o ${rotuloDoc(tipo)} do cedente`}
                className="flex-none tabular-nums text-texto-2"
              >
                {formatCpfCnpjInput(doc)}
              </CopiarTexto>
            )}
            <Selo tom="neutro" title={tipo === 'PJ' ? 'Pessoa jurídica' : 'Pessoa física'}>
              {tipo}
            </Selo>
            {lugar && <span className="text-texto-2">{lugar}</span>}
            {(nome || doc) && (
              <Selo tom="neutro" title="De onde vieram os dados do cedente">
                {origem}
              </Selo>
            )}
            {conferencia && (
              <Selo
                tom={conferencia.tom}
                title={
                  titularOficio
                    ? `Ofício requisitório: ${comDoc(titularOficio.nome, titularOficio.documento)}`
                    : undefined
                }
              >
                {conferencia.rotulo}
              </Selo>
            )}
            {conferencia?.tom === 'sucesso' && titularOficio?.arquivo && (
              <span className="text-xs text-texto-3">({titularOficio.arquivo})</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {pasta && (
              <a
                href={pasta.url}
                target="_blank"
                rel="noreferrer"
                className={LINK_BTN}
                title={
                  pasta.qual === 'certidoes'
                    ? 'Abrir no Drive a pasta Certidões, dentro da pasta da análise'
                    : 'Abrir no Drive a pasta da análise (a subpasta Certidões nasce com o primeiro PDF)'
                }
              >
                <Folder className="h-[16px] w-[16px]" aria-hidden /> Pasta no Drive
              </a>
            )}
            {!editando && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setEditando(true)}
                disabled={salvando}
                icon={<Pencil className="h-[16px] w-[16px]" aria-hidden />}
                title="Corrigir dados / cônjuge"
              >
                Editar
              </Button>
            )}
            <button
              type="button"
              onClick={() => setAjudaAberta((v) => !v)}
              aria-expanded={ajudaAberta}
              aria-label="Como funciona esta aba"
              title="Como funciona esta aba"
              className="inline-grid h-8 w-8 place-items-center rounded-controle text-texto-3 transition-colors hover:bg-superficie-3 hover:text-texto focus:outline-none focus-visible:ring-2 focus-visible:ring-anel"
            >
              <HelpCircle className="h-[16px] w-[16px]" aria-hidden />
            </button>
          </div>
        </div>

        {!editando && conjugeGravado && (
          <p className="mt-1 text-sm text-texto-2">
            Cônjuge: <b className="text-texto">{conjugeGravado.nome}</b> ·{' '}
            <span className="tabular-nums">{formatCpfCnpjInput(conjugeGravado.documento)}</span>
            {conjugeGravado.uf_atual &&
              ` · ${[conjugeGravado.municipio_atual, conjugeGravado.uf_atual].filter(Boolean).join('/')}`}
          </p>
        )}

        {/* O PLACAR: o oficial (v_dd_completude) e os pendentes dela repartidos
            pelo que se faz com cada um. As DISPENSADAS ao lado, e não
            escondidas: elas saem do denominador, e "8 de 8" com 6 dispensadas
            é um dossiê fechado sobre o que a regra exigia. */}
        {!editando && completude && (
          <div className="mt-2.5 flex flex-wrap items-baseline gap-x-5 gap-y-1 border-t border-borda pt-2.5 text-sm">
            {numero(
              `${completude.obtidas_validas} de ${completude.necessarias}`,
              'obrigatórias obtidas',
              completa ? 'text-sucesso' : 'text-texto',
            )}
            {/* NO NÚMERO CERTO (auditoria visual, A4): era "1 pendentes". */}
            {numero(placar.pendentes, rotuloNoNumero(placar.pendentes, 'pendente', 'pendentes'))}
            {numero(
              placar.problema,
              `com problema${completude.vencidas > 0 ? ` (${completude.vencidas} vencida${completude.vencidas > 1 ? 's' : ''})` : ''}`,
              placar.problema > 0 ? 'text-perigo' : 'text-texto',
            )}
            {numero(placar.emissao, 'em emissão', placar.emissao > 0 ? 'text-info' : 'text-texto')}
            {completude.dispensadas > 0 &&
              numero(
                completude.dispensadas,
                rotuloNoNumero(completude.dispensadas, 'dispensada, fora da conta', 'dispensadas, fora da conta'),
                'text-aviso',
              )}
            <span className={cn('basis-full text-xs', completa ? 'font-semibold text-sucesso' : 'text-texto-3')}>
              {completude.necessarias === 0
                ? 'Nenhuma certidão obrigatória no checklist.'
                : completa
                  ? '✅ Documental completa.'
                  : `A etapa documental não fecha até chegar a ${completude.necessarias}.`}
            </span>
          </div>
        )}

        {ajudaAberta && (
          <div className="mt-2.5 space-y-1 border-t border-borda pt-2.5 text-sm text-texto-2">
            <p>
              O checklist é montado por sujeito, antes de qualquer emissão, e congelado no banco. Sem CPF (ou
              CNPJ) e UF não há como saber quais certidões são exigidas.
            </p>
            <p>
              A etapa documental só fecha com todas as obrigatórias em arquivo. Dispensar tira a certidão da
              conta — por isso as dispensadas aparecem no placar.
            </p>
            <p>
              A ordem é cedente → checklist → emissão. O que você digita vence o que a IA leu, e o titular é o
              do ofício requisitório.
            </p>
            <p>Os PDFs da BullAI vão para a pasta da análise do card no Drive, na subpasta Certidões.</p>
          </div>
        )}
      </div>
    )
  }

  /**
   * Um cabeçalho de grupo do checklist: o nome e quantos.
   *
   * SUBTÍTULO, E NÃO RÓTULO EM CAIXA ALTA (auditoria visual de 03/10/2026, A4):
   * "CEDENTE", "CHECKLIST", "COM PROBLEMA", "PENDENTES"… empilhados em caixa
   * alta viravam uma parede de rótulos. A caixa alta fica só no "Checklist".
   */
  const cabecalhoDoGrupo = (rotulo: string, n: number) => (
    <span className="flex items-center gap-s1.5 text-sm font-semibold text-texto-2">
      {rotulo} <span className="font-normal tabular-nums text-texto-3">{n}</span>
    </span>
  )

  /** O que os anexos dizem do estado civil, para quem ainda não tem cônjuge cadastrado. */
  function estadoCivilDosAnexos(): ReactNode {
    const nomeCed = cedenteGravado?.nome ?? 'o cedente'
    if (lendoPdf) return <p className="text-xs text-texto-3">Lendo os anexos do card…</p>
    const a = respostaEstadoCivil.ancorado
    if (a) {
      return (
        <div className="text-sm text-texto">
          Estado civil nos anexos: <b>{ROTULO_ESTADO_CIVIL[a.estado] ?? a.estado}</b>
          {a.conjuge && <>, cônjuge <b>{a.conjuge}</b></>} — o bloco do cônjuge não se aplica.{' '}
          <b>Confira mesmo assim</b>: o documento pode ser antigo, e estado civil muda.
          <span className="mt-1 block rounded-controle border border-borda bg-superficie px-2.5 py-1.5 text-xs text-texto-2">
            …{a.contexto}… {a.arquivo && <span className="text-texto-3">(em {a.arquivo})</span>}
          </span>
        </div>
      )
    }
    if (respostaEstadoCivil.soltos.length > 0) {
      return (
        <div className="space-y-1.5 text-sm">
          {/* Achei, mas NÃO consegui prender ao cedente: numa petição a
              qualificação do advogado e a da outra parte ficam a poucos
              caracteres da do autor. O trecho aparece; o sistema não julga. */}
          <p className="text-aviso">
            Achei estado civil nos anexos, mas <b>não ligado ao nome nem ao CPF de {nomeCed}</b> — costuma ser do
            advogado ou da outra parte. Leia o trecho:
          </p>
          {respostaEstadoCivil.soltos.slice(0, 3).map((e) => (
            <span
              key={`${e.estado}-${e.conjuge ?? ''}`}
              className="block rounded-controle border border-borda bg-superficie px-2.5 py-1.5 text-xs text-texto-2"
            >
              <b className="text-texto">{ROTULO_ESTADO_CIVIL[e.estado] ?? e.estado}</b>
              {e.arquivo && <span className="text-texto-3"> (em {e.arquivo})</span>} …{e.contexto}…
            </span>
          ))}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setEditando(true)}
            disabled={salvando}
            icon={<Pencil className="h-[16px] w-[16px]" aria-hidden />}
          >
            Abrir o cadastro para decidir
          </Button>
        </div>
      )
    }
    // NÃO ACHEI ≠ NÃO É CASADA: a leitura natural de uma tela calada é "então
    // não tem cônjuge", que fecha o dossiê com um bloco inteiro faltando.
    return (
      <div className="space-y-1.5 text-sm">
        <p className="text-aviso">
          {arquivos.length === 0
            ? 'Não consegui abrir nenhum anexo deste card.'
            : temTexto
              ? 'Não achei estado civil na qualificação das partes.'
              : 'Nenhum anexo tem texto para ler.'}{' '}
          <b>&quot;Não achei&quot; não é &quot;não é casada&quot;</b> — confira a petição inicial.
          {digitalizados.length > 0 && (
            <> Digitalizados (não leio imagem): <b>{digitalizados.map((x) => x.nome).join(', ')}</b>.</>
          )}
        </p>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setEditando(true)}
          disabled={salvando}
          icon={<Pencil className="h-[16px] w-[16px]" aria-hidden />}
        >
          Cadastrar à mão
        </Button>
      </div>
    )
  }

  // A PERGUNTA DO ESTADO CIVIL, no placar e não só no formulário: o aviso
  // "Nenhum cônjuge informado" pergunta, e a tela tem o texto dos autos para
  // responder. Cedente empresa não casa.
  const perguntaDoConjuge =
    sujeitos.length > 0 &&
    !respostaEstadoCivil.temConjugeCadastrado &&
    !sujeitos.some((s) => s.papel === 'CEDENTE' && s.tipo_pessoa === 'PJ')
  const conjugeFaltando =
    perguntaDoConjuge &&
    !lendoPdf &&
    Boolean(respostaEstadoCivil.ancorado && PEDE_CONJUGE.has(respostaEstadoCivil.ancorado.estado))

  return (
    <div>
      {/* OS ERROS VÊM PRIMEIRO: o que falhou ao ler é a primeira coisa a saber,
          antes de confiar no que está abaixo. */}
      {erro && (
        <CaixaDeAviso tom="perigo" role="alert" className="mb-3">
          {erro}
        </CaixaDeAviso>
      )}
      {erroMunicipios && (
        <CaixaDeAviso tom="perigo" className="mb-3">
          {erroMunicipios}
        </CaixaDeAviso>
      )}
      {erroLinks && (
        <CaixaDeAviso tom="aviso" className="mb-3">
          {erroLinks}
        </CaixaDeAviso>
      )}

      {!carregando && faixaDeResumo()}

      {/* O OFÍCIO REQUISITÓRIO, em destaque e antes de tudo o que depende dele:
          é ele que diz de quem são as certidões. */}
      {avisoDoOficio()}
      {!carregando && divergenciaDoCadastro()}

      {carregando ? (
        <div className="py-8 text-center text-corpo text-texto-3">Carregando…</div>
      ) : editando ? (
        <div>
          {/* ---------------- a leitura dos anexos e da IA ---------------- */}
          {/* UMA LINHA DE ESTADO que abre: o que a IA e a busca acharam, cada
              dado com o trecho e clicável, os anexos sem texto e o colar de
              outra consulta. Abre sozinha enquanto o documento do cedente não
              está preenchido — escolher o CPF é de quem confere. */}
          <div className="rounded-campo border border-info-borda bg-marca-leve text-corpo">
            <div className="flex flex-wrap items-center gap-2 px-3 py-1.5">
              {lendoIA || lendoPdf ? (
                <RefreshCw className="h-[16px] w-[16px] flex-none animate-spin text-marca-texto" aria-hidden />
              ) : (
                <Sparkles className="h-[16px] w-[16px] flex-none text-marca-texto" aria-hidden />
              )}
              <button
                type="button"
                onClick={() => setAchadosAbertos(!achadosVisiveis)}
                aria-expanded={achadosVisiveis}
                className="flex min-h-8 min-w-0 flex-1 items-center gap-1.5 rounded-controle text-left font-semibold text-texto focus:outline-none focus-visible:ring-2 focus-visible:ring-anel"
              >
                <span className="min-w-0">
                  {estadoDaLeitura}
                  {arquivos.length > 0 && (
                    <span className="font-normal text-texto-3">
                      {' '}
                      · {arquivos.length} anexo{arquivos.length > 1 ? 's' : ''}
                    </span>
                  )}
                </span>
                <span className="ml-auto inline-flex flex-none items-center gap-0.5 text-sm text-marca-texto">
                  {achadosVisiveis ? 'ocultar' : 'ver'}
                  <ChevronDown
                    className={cn('h-[16px] w-[16px] transition-transform', achadosVisiveis && 'rotate-180')}
                    aria-hidden
                  />
                </span>
              </button>
              {/* O BOTÃO FICA À VISTA LENDO, desabilitado com "Lendo…" — antes
                  sumia, e a caixa parecia ter perdido a ação. */}
              {temTexto && (
                <Button variant="secondary" size="sm" onClick={() => void lerComIA()} disabled={lendoIA}>
                  {lendoIA ? 'Lendo…' : leituraIA ? 'Ler de novo' : 'Ler com a IA'}
                </Button>
              )}
            </div>
            {avisosIADestaque.length > 0 && (
              <div className="px-3 pb-2">
                {avisosIADestaque.map((a) => (
                  <DicaDeAviso key={a} className="mt-0">
                    {a}
                  </DicaDeAviso>
                ))}
              </div>
            )}

            {achadosVisiveis && (
              <div className="border-t border-info-borda px-3 pb-3 text-texto-2">
                {avisosIAMenores.map((a) => (
                  <DicaDeAviso key={a}>{a}</DicaDeAviso>
                ))}
                {/* ARQUIVO SEM TEXTO É DITO, não omitido: é a diferença entre
                    "não consegui ler" e "não existe". */}
                {digitalizados.map((a, i) => (
                  <DicaDeAviso key={`${a.nome}-${i}`}>
                    <b>{a.nome || '(anexo sem nome)'}</b>
                    {a.erro
                      ? ` — ${a.erro}`
                      : ` — ${a.paginas} página(s), ${a.densidade} caractere(s) por página: digitalização. ` +
                        'O que estiver só aí (foto de RG, comprovante) eu não leio: abra e digite.'}
                  </DicaDeAviso>
                ))}
                {lendoPdf ? (
                  <p className="mt-2 text-xs text-texto-3">Lendo o PDF do card…</p>
                ) : iaAchouCedente ? (
                  <>
                    {achadosDaLeitura()}
                    {/* A BUSCA CRUA, RECOLHIDA: continua à mão para o caso de a
                        leitura ter deixado escapar algo. */}
                    {temAchadosManuais && (
                      <details className="mt-2 text-corpo">
                        <summary className="cursor-pointer font-semibold text-marca-texto">
                          Outros números no processo (de outras pessoas, segundo a leitura)
                        </summary>
                        {achadosManuais(true)}
                      </details>
                    )}
                  </>
                ) : temAchadosManuais ? (
                  <>
                    {/* A LEITURA VEIO, MAS SEM O CEDENTE: dito, para a lista
                        abaixo não ser lida como "do cedente". */}
                    {leituraIA && (
                      <DicaDeAviso>
                        A IA não identificou com segurança os dados de <b>{nomeProcurado || 'quem cede'}</b>. Os
                        achados abaixo são de todas as pessoas do processo — escolha conferindo o trecho.
                      </DicaDeAviso>
                    )}
                    {achadosManuais(false)}
                  </>
                ) : avisoPdf ? (
                  <DicaDeAviso>{avisoPdf}</DicaDeAviso>
                ) : temTexto ? (
                  // Só se pode afirmar isto DEPOIS de ler o PDF.
                  <p className="mt-2 text-xs">
                    Li o PDF e não achei {rotuloDoc(tipoCedente)} de dígito válido (o número pode vir partido) —
                    digite conferindo no processo.
                  </p>
                ) : (
                  <p className="mt-2 text-xs">
                    O PDF do card ainda não foi lido. Digite o {rotuloDoc(tipoCedente)} conferindo no processo.
                  </p>
                )}

                {/* COLAR DE OUTRA CONSULTA, e não integração: a Date Solutions
                    não publica API, e o dado que ela mostra é o mesmo. O parser
                    é o do PDF (lib/dadosNoTexto.ts). */}
                <details className="mt-2 text-corpo">
                  <summary className="cursor-pointer font-semibold text-marca-texto">
                    Colar resultado de outra consulta (Date Solutions, etc.)
                  </summary>
                  <Textarea
                    value={colado}
                    onChange={(e) => setColado(e.target.value)}
                    rows={3}
                    aria-label="Resultado de outra consulta"
                    className="mt-2"
                    placeholder="Cole aqui o resultado da consulta do CEDENTE. Eu leio a data de nascimento e a cidade/UF; o resto do texto é ignorado e não fica guardado."
                  />
                  {colado.trim() && (
                    <Sugestoes
                      nascimentos={tipoCedente === 'PJ' ? [] : doColado.nascimentos}
                      locais={doColado.locais}
                      onNascimento={(iso) => {
                        setMexeu(true)
                        setCedente((f) => ({ ...f, nascimento: iso }))
                      }}
                      onLocal={usarLocal}
                      vazio={
                        Object.keys(municipios).length === 0
                          ? 'Ainda estou carregando a lista de municípios — sem ela não ' +
                            'consigo conferir cidade. Aguarde um instante e cole de novo.'
                          : 'Não achei nascimento nem cidade/UF neste texto. Data de ' +
                            'nascimento só é reconhecida se vier rotulada ("nascimento", ' +
                            '"nascido em"), e cidade só se existir na lista do IBGE junto ' +
                            'com a UF.'
                      }
                    />
                  )}
                  <p className="mt-1.5 text-xs text-texto-3">
                    Este texto NÃO é gravado: só entram os campos em que você clicar.
                  </p>
                </details>
              </div>
            )}
          </div>

          {preenchido.length > 0 && (
            <CaixaDeAviso tom="sucesso" className="mt-3">
              Preenchi do processo: <b>{preenchido.join(' · ')}</b>. Confira antes de gravar.{' '}
              {docDaLeitura
                ? `O ${rotuloDoc(tipoDaLeitura)} só entrou porque está escrito na qualificação de ` +
                  `${leituraIA?.cedente.nome?.valor || nomeProcurado || 'quem cede'}.`
                : preenchido.some((x) => x.endsWith('(do ofício)') && /CPF|CNPJ/.test(x))
                  ? `O ${rotuloDoc(tipoCedente)} veio do ofício requisitório — confira.`
                  : `O ${rotuloDoc(tipoCedente)} eu nunca preencho sozinho.`}
            </CaixaDeAviso>
          )}

          {/* ---------------- cedente ---------------- */}
          <RotuloDeSecao className="mt-5">Cedente</RotuloDeSecao>
          {/* PESSOA FÍSICA OU JURÍDICA (pedido do dono, 03/10/2026): a escolha
              troca o documento (CPF ↔ CNPJ) e tira o que não se aplica a empresa. */}
          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <Segmented
              ariaLabel="O cedente é pessoa física ou jurídica"
              items={[
                { key: 'PF', label: 'Pessoa física' },
                { key: 'PJ', label: 'Pessoa jurídica' },
              ]}
              value={tipoCedente}
              onChange={(k) => escolherTipo(k as TipoPessoa)}
            />
            {tipoCedente === 'PJ' && (
              <span className="text-xs text-texto-3">
                Sem nascimento, estado civil nem cônjuge; entra o bloco da PJ (CNPJ e FGTS).
              </span>
            )}
          </div>
          <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
            <Field label={tipoCedente === 'PJ' ? 'Razão social' : 'Nome completo'} required className="sm:col-span-2">
              <Input
                value={cedente.nome}
                onChange={(e) => alterar(setCedente)({ ...cedente, nome: e.target.value })}
                placeholder={
                  tipoCedente === 'PJ'
                    ? 'Como está no contrato social ou na qualificação'
                    : 'Como está na qualificação das partes'
                }
              />
            </Field>
            <Field
              label={rotuloDoc(tipoCedente)}
              required
              error={
                cedente.cpf && !documentoValido(cedente.cpf, tipoCedente) ? 'Dígito verificador não fecha.' : undefined
              }
            >
              <Input
                value={cedente.cpf}
                onChange={(e) => alterar(setCedente)({ ...cedente, cpf: mascaraDoTipo(e.target.value, tipoCedente) })}
                inputMode="numeric"
                placeholder={tipoCedente === 'PJ' ? '00.000.000/0000-00' : '000.000.000-00'}
              />
            </Field>
            {tipoCedente === 'PF' && (
              <Field label="Data de nascimento" hint="A CND Federal não sai sem ela.">
                <Input
                  type="date"
                  value={cedente.nascimento}
                  onChange={(e) => alterar(setCedente)({ ...cedente, nascimento: e.target.value })}
                />
              </Field>
            )}
            <Field label={tipoCedente === 'PJ' ? 'UF da sede' : 'UF atual'} required hint="Define as certidões estaduais.">
              <Select
                value={cedente.uf}
                onChange={(e) => alterar(setCedente)({ ...cedente, uf: e.target.value, municipio: '' })}
              >
                <option value="">Selecione…</option>
                {ufs.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label={tipoCedente === 'PJ' ? 'Município da sede' : 'Município atual'}
              hint="Em branco, nenhuma certidão municipal."
            >
              <Select
                value={cedente.municipio}
                onChange={(e) => alterar(setCedente)({ ...cedente, municipio: e.target.value })}
                disabled={!cedente.uf}
              >
                <option value="">{cedente.uf ? 'Selecione…' : 'Escolha a UF primeiro'}</option>
                {municipiosDaUf(cedente.uf).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {/* ---------------- histórico de endereços ---------------- */}
          {/* A CAIXA SEMPRE À VISTA, e âmbar enquanto desmarcada: "não sei se
              morou em outro estado" e "não morou" são respostas diferentes. Os
              campos dos anteriores abrem a pedido — e ficam abertos quando têm
              conteúdo. */}
          <div
            className={cn(
              'mt-4 rounded-campo border px-3 py-2',
              residenciaLevantada ? 'border-borda bg-superficie-2' : 'border-aviso-borda bg-aviso-fundo',
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-x-3">
              <label className="inline-flex min-h-8 cursor-pointer items-center gap-2 text-corpo text-texto">
                <input
                  type="checkbox"
                  className={CAIXA_MARCAR}
                  checked={residenciaLevantada}
                  onChange={(e) => alterar(setResidenciaLevantada)(e.target.checked)}
                />
                {tipoCedente === 'PJ'
                  ? 'Levantei o histórico de endereços da sede'
                  : 'Levantei o histórico de residência do cedente'}
              </label>
              <button
                type="button"
                className={LINK_BTN}
                aria-expanded={residenciaVisivel}
                onClick={() => setResidenciaAberta((v) => !v)}
              >
                {tipoCedente === 'PJ' ? 'Sedes anteriores' : 'Endereços anteriores'}
                <ChevronDown className={cn('h-[16px] w-[16px] transition-transform', residenciaVisivel && 'rotate-180')} aria-hidden />
              </button>
            </div>
            <p className="text-xs text-texto-3">
              Desmarcado = não conferido: &quot;não sei&quot; e &quot;nunca foi em outro estado&quot; são respostas
              diferentes, e só a segunda dispensa certidão.{' '}
              {tipoCedente === 'PJ'
                ? 'O contrato social e as alterações dizem por onde a sede passou.'
                : 'Vale só para o cedente: o cônjuge entra sempre como não levantado.'}
            </p>
            {residenciaVisivel && (
              <div className="mt-2 grid gap-x-5 gap-y-3 sm:grid-cols-2">
                <Field
                  label={tipoCedente === 'PJ' ? 'UFs anteriores da sede' : 'UFs anteriores'}
                  hint="Siglas ou nomes, por vírgula: MG, São Paulo"
                >
                  <Input
                    value={ufsAnteriores}
                    onChange={(e) => alterar(setUfsAnteriores)(e.target.value)}
                    placeholder="MG, SP"
                  />
                </Field>
                <Field label="Municípios anteriores" hint="Separados por vírgula.">
                  <Input
                    value={municipiosAnteriores}
                    onChange={(e) => alterar(setMunicipiosAnteriores)(e.target.value)}
                    placeholder="Belo Horizonte, Campinas"
                  />
                </Field>
              </div>
            )}
          </div>

          {/* ---------------- cônjuge ---------------- */}
          {/* SÓ PARA PESSOA FÍSICA. Completo e sem mexer, vira uma linha com
              "Editar"; faltando algo, o formulário fica aberto. */}
          {tipoCedente === 'PF' && (
            <div className="mt-4">
              <label className="inline-flex min-h-8 cursor-pointer items-center gap-2 text-corpo text-texto">
                <input
                  type="checkbox"
                  className={CAIXA_MARCAR}
                  checked={temConjuge}
                  onChange={(e) => alterar(setTemConjuge)(e.target.checked)}
                />
                O cedente é casado / tem companheiro(a)
              </label>
              <p className="ml-[24px] text-xs text-texto-3">
                O cônjuge tem bloco próprio de certidões (planilha, linhas 52 a 67): sem isto, o checklist fecha
                completo com ele faltando. Desmarcar REMOVE o cônjuge cadastrado e as certidões dele.
              </p>
              {temConjuge && !conjugeVisivel && (
                <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-campo border border-borda bg-superficie-2 px-3 py-1.5 text-sm text-texto-2">
                  <b className="text-texto">{conjuge.nome}</b>
                  <span className="tabular-nums">CPF {conjuge.cpf}</span>
                  {conjuge.nascimento && <span className="tabular-nums">{dataBr(conjuge.nascimento)}</span>}
                  <span>
                    {conjuge.uf
                      ? [conjuge.municipio, conjuge.uf].filter(Boolean).join('/')
                      : 'mesmo endereço do cedente'}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto"
                    onClick={() => setConjugeAberto(true)}
                    icon={<Pencil className="h-[16px] w-[16px]" aria-hidden />}
                  >
                    Editar
                  </Button>
                </div>
              )}
              {temConjuge && conjugeVisivel && (
                <div className="mt-2 grid gap-x-5 gap-y-3 sm:grid-cols-2">
                  <Field label="Nome do cônjuge" required>
                    <Input value={conjuge.nome} onChange={(e) => alterarConjuge({ ...conjuge, nome: e.target.value })} />
                  </Field>
                  <Field
                    label="CPF do cônjuge"
                    required
                    error={conjuge.cpf && !cpfValido(conjuge.cpf) ? 'Dígito verificador não fecha.' : undefined}
                  >
                    <Input
                      value={conjuge.cpf}
                      onChange={(e) => alterarConjuge({ ...conjuge, cpf: formatCpfCnpjInput(e.target.value) })}
                      inputMode="numeric"
                      placeholder="000.000.000-00"
                    />
                  </Field>
                  <Field label="Data de nascimento do cônjuge">
                    <Input
                      type="date"
                      value={conjuge.nascimento}
                      onChange={(e) => alterarConjuge({ ...conjuge, nascimento: e.target.value })}
                    />
                  </Field>
                  <Field label="UF do cônjuge" hint="Em branco = mesma UF E mesmo município do cedente.">
                    <Select
                      value={conjuge.uf}
                      onChange={(e) => alterarConjuge({ ...conjuge, uf: e.target.value, municipio: '' })}
                    >
                      <option value="">Mesmo endereço do cedente</option>
                      {ufs.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  {conjuge.uf && (
                    <Field label="Município do cônjuge">
                      <Select
                        value={conjuge.municipio}
                        onChange={(e) => alterarConjuge({ ...conjuge, municipio: e.target.value })}
                      >
                        <option value="">Nenhuma certidão municipal</option>
                        {municipiosDaUf(conjuge.uf).map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  )}
                </div>
              )}
            </div>
          )}

          {impacto.sujeitos.length > 0 && (
            <CaixaDeAviso tom="perigo" className="mt-4">
              Gravar assim REMOVE {impacto.sujeitos.map((s) => `${s.papel} ${s.nome}`).join(', ')} e apaga{' '}
              {impacto.certidoes} item(ns) do checklist
              {impacto.obtidas > 0 && (
                <>
                  , dos quais <b>{impacto.obtidas} já obtida(s)</b>
                </>
              )}
              . Vai pedir confirmação.
            </CaixaDeAviso>
          )}

          {/* O que falta para gravar, em vermelho e com ícone — é o motivo de o
              botão abaixo estar desabilitado. */}
          {problemas.length > 0 && (
            <ul className="mt-4 grid gap-1">
              {problemas.map((p) => (
                <li key={p} className="flex items-start gap-1.5 text-corpo text-perigo">
                  <AlertTriangle className="mt-0.5 h-[16px] w-[16px] flex-none" aria-hidden />
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div>
          {/* ---------------- o cônjuge que falta, em destaque ---------------- */}
          {conjugeFaltando && respostaEstadoCivil.ancorado && (
            <CaixaDeAviso tom="aviso" className="mb-3">
              <span className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className="min-w-0 flex-[1_1_260px]">
                  Os anexos qualificam <b>{cedenteGravado?.nome ?? 'o cedente'}</b> como{' '}
                  <b>
                    {ROTULO_ESTADO_CIVIL[respostaEstadoCivil.ancorado.estado] ?? respostaEstadoCivil.ancorado.estado}
                  </b>
                  {respostaEstadoCivil.ancorado.conjuge && (
                    <>
                      , cônjuge <b>{respostaEstadoCivil.ancorado.conjuge}</b>
                    </>
                  )}
                  : faltam as certidões do cônjuge (planilha, linhas 52 a 67), e o placar <b>não</b> conta essa
                  falta.
                </span>
                <Button
                  className="ml-auto"
                  size="sm"
                  onClick={() => cadastrarConjugeCom(respostaEstadoCivil.ancorado!)}
                  disabled={salvando}
                  icon={<Pencil className="h-[16px] w-[16px]" aria-hidden />}
                >
                  Cadastrar o cônjuge
                </Button>
              </span>
              <details className="mt-1.5 text-sm">
                <summary className="cursor-pointer font-semibold text-marca-texto">Ver o trecho</summary>
                <span className="mt-1 block rounded-controle border border-borda bg-superficie px-2.5 py-1.5 text-xs text-texto-2">
                  …{respostaEstadoCivil.ancorado.contexto}…
                  {respostaEstadoCivil.ancorado.arquivo && (
                    <span className="text-texto-3"> (em {respostaEstadoCivil.ancorado.arquivo})</span>
                  )}
                </span>
              </details>
            </CaixaDeAviso>
          )}

          {/* ---------------- as lacunas, juntas e recolhidas ---------------- */}
          {/* NÃO ESCONDE LACUNA: a linha diz QUAIS são, mesmo fechada, e abre o
              texto inteiro de cada uma (e o que os anexos dizem do estado civil). */}
          {/* NO ESCURO, O ÂMBAR SÓ NO CONTORNO E NO ÍCONE (auditoria visual, E7): o
              fundo `aviso-fundo` de lá é um marrom que, na largura da janela,
              virava uma faixa pesada. O texto fica na cor do corpo. */}
          {avisos.length > 0 && (
            <details className="group mb-s3 rounded-campo border border-aviso-borda bg-aviso-fundo text-corpo dark:bg-superficie-2">
              <summary className="flex min-h-[32px] cursor-pointer list-none items-start gap-s2 px-s3 py-s2 text-texto [&::-webkit-details-marker]:hidden">
                <AlertTriangle className="mt-0.5 h-[16px] w-[16px] flex-none text-aviso" aria-hidden />
                <span className="min-w-0 flex-1">
                  <b>
                    {avisos.length} lacuna{avisos.length > 1 ? 's' : ''} no cadastro:
                  </b>{' '}
                  {avisos.map((a) => a.curto).join(' · ')}
                </span>
                <ChevronDown
                  className="mt-0.5 h-[16px] w-[16px] flex-none text-texto-3 transition-transform group-open:rotate-180"
                  aria-hidden
                />
              </summary>
              <div className="space-y-s2 border-t border-aviso-borda px-s3 py-s2 dark:border-borda">
                <ul className="list-disc space-y-1 pl-6 text-sm text-texto marker:text-aviso">
                  {avisos.map((a) => (
                    <li key={a.texto}>{a.texto}</li>
                  ))}
                </ul>
                {perguntaDoConjuge && !conjugeFaltando && estadoCivilDosAnexos()}
              </div>
            </details>
          )}

          {/* ---------------- o checklist, por estado ---------------- */}
          {itens.length > 0 && (
            <section>
              <RotuloDeSecao className="mt-4">Checklist · {itens.length} certidões</RotuloDeSecao>
              <div className="overflow-hidden rounded-cartao border border-borda">
                {grupos.map(({ grupo, itens: lista }) => {
                  const linhas = (
                    <ul>
                      {lista.map((i) => {
                        const s = sujeitoPorId.get(i.sujeito_id)
                        return (
                          <LinhaCertidao
                            key={i.id}
                            item={i}
                            sujeito={s}
                            papel={variosSujeitos ? s?.papel : undefined}
                            hoje={hoje}
                            cnj={cnjDoCredito}
                            url={
                              i.certidao_catalogo?.url_oficial ||
                              urlPorEscopo.get(`${i.certidao_codigo}|${escopoDe(i.parametros) ?? ''}`) ||
                              null
                            }
                            onSalvarUrl={salvarUrlDoEscopo}
                          />
                        )
                      })}
                    </ul>
                  )
                  const cab = cabecalhoDoGrupo(ROTULO_DO_GRUPO[grupo], lista.length)
                  return GRUPOS_RECOLHIDOS.has(grupo) ? (
                    <details key={grupo} className="group border-t border-borda first:border-t-0">
                      <summary className="flex min-h-[32px] cursor-pointer list-none items-center justify-between gap-s2 bg-superficie-2 px-s3 py-s1.5 [&::-webkit-details-marker]:hidden">
                        {cab}
                        <ChevronDown
                          className="h-[16px] w-[16px] flex-none text-texto-3 transition-transform group-open:rotate-180"
                          aria-hidden
                        />
                      </summary>
                      {linhas}
                    </details>
                  ) : (
                    <div key={grupo} className="border-t border-borda first:border-t-0">
                      <div className="bg-superficie-2 px-s3 py-s1.5">{cab}</div>
                      {linhas}
                    </div>
                  )
                })}
              </div>
              {semItens.map((s) => (
                <p key={s.id} className="mt-1.5 text-xs text-texto-3">
                  Nenhuma certidão gerada para {s.papel} {s.nome}.
                </p>
              ))}
            </section>
          )}
          {sujeitos.length > 0 && itens.length === 0 && (
            <CaixaSuave className="mt-3">
              Nenhuma certidão no checklist ainda. <b>Gerar itens faltantes</b> roda as regras sobre o cadastro.
            </CaixaSuave>
          )}

          {sujeitos.length > 0 && itens.length > 0 && (
            <EmissaoBullai
              leadId={leadId}
              sujeitos={sujeitos}
              itens={itens}
              ativo={ativo}
              onMudou={recarregarItens}
              pasta={pasta}
              onPasta={(url) => setPastaDaResposta({ url, qual: 'certidoes' })}
            />
          )}

          {sujeitos.length === 0 && (
            <CaixaSuave>
              Nenhum sujeito cadastrado neste crédito. Clique em <b>Editar</b> para começar pelo cedente.
            </CaixaSuave>
          )}
        </div>
      )}

      {/* AS AÇÕES FICAM NO PAINEL, não no rodapé da janela: o rodapé é dividido
          com a aba de Processos Judiciais. */}
      <div className="mt-5 flex flex-wrap items-center justify-end gap-2.5 border-t border-borda pt-4">
        {editando ? (
          <>
            {sujeitos.length > 0 && (
              <Button variant="ghost" onClick={() => void cancelarEdicao()} disabled={salvando}>
                Cancelar
              </Button>
            )}
            <Button
              // SEM ARGUMENTO, de propósito: o `true` de salvarEGerar é o "sim" da
              // janela de remoção, e o evento do clique não pode passar por ele.
              onClick={() => void salvarEGerar()}
              loading={salvando}
              disabled={problemas.length > 0}
              icon={<Sparkles className="h-[16px] w-[16px]" aria-hidden />}
            >
              Gravar e montar checklist
            </Button>
          </>
        ) : (
          // "Gerar itens faltantes" e não "Recalcular": o motor só acrescenta
          // (ver gerarFaltantes).
          <Button
            variant="outline"
            onClick={gerarFaltantes}
            loading={salvando}
            icon={<Plus className="h-[16px] w-[16px]" aria-hidden />}
            title="Roda as regras de novo sobre o cadastro e acrescenta o que faltar (não tira nada)"
          >
            Gerar itens faltantes
          </Button>
        )}
      </div>

      {/* A "Remover do crédito" da amostra. O texto é o do confirm de antes,
          palavra por palavra — inclusive o ATENÇÃO das certidões já obtidas. */}
      <ConfirmDialog
        open={confirmandoRemocao}
        title="Remover do crédito"
        danger
        loading={salvando}
        confirmLabel="Remover e gravar"
        // SPANS EM BLOCO, e não <p>: o ConfirmDialog já embrulha a mensagem num
        // <p>, e parágrafo dentro de parágrafo é HTML inválido.
        message={
          <>
            <span className="block">
              Isto vai REMOVER do crédito:{' '}
              <b>
                {impacto.sujeitos
                  .map((s) => `${s.papel} ${s.nome} (${formatCpfCnpjInput(s.documento)})`)
                  .join(', ')}
              </b>
              .
            </span>
            <span className="block">
              E apagar {impacto.certidoes} item(ns) do checklist dessa(s) pessoa(s).
            </span>
            {impacto.obtidas > 0 && (
              <span className="mt-3 block">
                ATENÇÃO: {impacto.obtidas} certidão(ões) JÁ OBTIDA(S) serão apagadas do
                checklist, com o vínculo do arquivo no Drive. O arquivo continua no
                Drive, mas o registro de que ele existe se perde.
              </span>
            )}
            <span className="mt-3 block">Confirma?</span>
          </>
        }
        onConfirm={() => void salvarEGerar(true)}
        onClose={() => setConfirmandoRemocao(false)}
      />
    </div>
  )
}
