// Checklist de certidões do crédito: cadastro dos sujeitos e o placar de
// completude, no card do Kommo.
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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ClipboardPaste,
  ExternalLink,
  FileText,
  Pencil,
  Plus,
  Sparkles,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { invokeFunction } from '@/lib/functions'
import { cpfValido, formatCpfCnpjInput, onlyDigits } from '@/lib/format'
import type { ArquivoLido } from '@/pages/operacional/AnaliseCredito'
import { acharCpfs, type CpfEncontrado } from '@/lib/cpfNoTexto'
import {
  acharEstadoCivil,
  acharLocais,
  acharNascimentos,
  type EstadoCivilEncontrado,
  type LocalEncontrado,
  type NascimentoEncontrado,
} from '@/lib/dadosNoTexto'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'

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
  cpf: string
  uf: string
  municipio: string
  nascimento: string
}

const VAZIO: FormPessoa = { nome: '', cpf: '', uf: '', municipio: '', nascimento: '' }

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
const TOM_STATUS: Record<string, 'gray' | 'green' | 'yellow' | 'red' | 'blue'> = {
  OBTIDA: 'green',
  PENDENTE: 'gray',
  EM_EMISSAO: 'blue',
  PENDENTE_MANUAL: 'yellow',
  FALHA: 'red',
  NAO_APLICAVEL: 'blue',
}

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
function derivarAvisos(sujeitos: Sujeito[], itens: ItemChecklist[]): string[] {
  const a: string[] = []
  if (sujeitos.length === 0) return a

  for (const s of sujeitos) {
    if (!s.residencia_levantada) {
      a.push(
        `${s.papel} (${s.nome}): histórico de residência não levantado. O checklist ` +
          `cobre apenas os endereços conhecidos hoje — pode faltar certidão estadual ` +
          `ou municipal de onde a pessoa morou antes.`,
      )
    }
    if (!s.uf_atual) {
      a.push(
        `${s.papel} (${s.nome}): sem UF atual. Nenhuma certidão estadual foi ` +
          `exigida para esta pessoa.`,
      )
    }
    if (!s.municipio_atual) {
      a.push(
        `${s.papel} (${s.nome}): sem município atual. Nenhuma certidão municipal ` +
          `foi exigida para esta pessoa.`,
      )
    }
  }

  if (!sujeitos.some((s) => s.papel === 'CONJUGE')) {
    a.push(
      'Nenhum cônjuge informado. Se o cedente for casado, o checklist está ' +
        'INCOMPLETO: a planilha dá bloco próprio de certidões ao cônjuge ' +
        '(linhas 52 a 67).',
    )
  }

  // A 0042 nomeia três coisas esquecíveis: o estado anterior, o cônjuge e a
  // EMPRESA em que o cedente é sócio. As duas primeiras têm campo nesta tela; a
  // terceira ainda não, então o aviso é o que impede que a ausência passe por
  // "não se aplica".
  if (!sujeitos.some((s) => s.papel === 'PJ')) {
    a.push(
      'Nenhuma empresa (PJ) informada. Se o cedente for sócio de empresa, falta ' +
        'o bloco de certidões da PJ — CNPJ, FGTS e as estaduais/municipais dela ' +
        '(planilha, linhas 68 a 81). Esta tela ainda não cadastra PJ: por ora, ' +
        'cadastre pelo SQL ou trate como pendência manual.',
    )
  }

  const dispensadas = itens.filter((i) => i.status === 'NAO_APLICAVEL')
  if (dispensadas.length > 0) {
    a.push(
      `${dispensadas.length} certidão(ões) dispensada(s). Dispensa SAI do ` +
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
function LinhaCertidao({
  item,
  sujeito,
  cnj,
  url,
  onSalvarUrl,
}: {
  item: ItemChecklist
  sujeito: Sujeito | undefined
  cnj: string | null
  /** Link já conhecido: do catálogo, ou cadastrado para este escopo. */
  url: string | null
  onSalvarUrl: (codigo: string, escopo: string, url: string) => Promise<void>
}) {
  const [aberto, setAberto] = useState(false)
  const [novaUrl, setNovaUrl] = useState('')
  const [salvandoUrl, setSalvandoUrl] = useState(false)
  const [erroUrl, setErroUrl] = useState<string | null>(null)
  const [copiado, setCopiado] = useState<string | null>(null)

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

  async function copiar(texto: string, chave: string) {
    try {
      await navigator.clipboard.writeText(texto)
      setCopiado(chave)
      window.setTimeout(() => setCopiado(null), 1500)
    } catch {
      // Área de transferência bloqueada pelo navegador: o valor está na tela
      // do lado, então dá para selecionar à mão. Não vale virar erro.
    }
  }

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

  return (
    <div className="border-b border-slate-100 text-xs last:border-b-0">
      <div className="flex flex-wrap items-center gap-2 p-2.5">
        <Badge size="sm" tone={TOM_STATUS[item.status] ?? 'gray'}>
          {item.status}
        </Badge>
        <span className="font-medium text-slate-800">
          {cat?.nome_curto ?? item.certidao_codigo}
        </span>
        <span className="text-slate-500">{cat?.orgao_emissor}</span>
        {rotuloParametros(item.parametros) && (
          <span className="text-slate-500">({rotuloParametros(item.parametros)})</span>
        )}
        {!item.obrigatoria && (
          <Badge size="sm" tone="gray">
            opcional
          </Badge>
        )}
        {item.status === 'NAO_APLICAVEL' && (
          <span className="text-blue-700">
            dispensada
            {item.dispensa_motivo ? `: ${item.dispensa_motivo}` : ' (sem motivo!)'}
          </span>
        )}
        {item.erro_classe && (
          <span className="text-amber-700">
            {MOTIVO_MANUAL[item.erro_classe] ?? item.erro_classe}
            {item.erro_detalhe ? `: ${item.erro_detalhe}` : ''}
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setAberto((v) => !v)}
            className="font-medium text-slate-500 hover:text-slate-700 hover:underline"
          >
            {aberto ? 'Fechar' : 'Como emitir'}
          </button>
          {url ? (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-medium text-brand-600 hover:underline"
            >
              Abrir portal <ExternalLink className="h-3 w-3" />
            </a>
          ) : (
            <span className="text-amber-700">sem link</span>
          )}
        </div>
      </div>

      {aberto && (
        <div className="space-y-2 border-t border-slate-100 bg-slate-50 p-3">
          {barreiras.length > 0 ? (
            <div className="text-amber-800">
              ⚠️ {barreiras.join(' · ')}
            </div>
          ) : (
            <div className="text-emerald-700">Sem login e sem CAPTCHA conhecidos.</div>
          )}

          <div>
            <div className="mb-1 text-slate-600">O que o portal pede:</div>
            <div className="space-y-1">
              {insumos.map((x) => (
                <div key={x.chave} className="flex items-center gap-2">
                  <span className="w-36 flex-none text-slate-500">{x.rotulo}</span>
                  {x.valor ? (
                    <>
                      <span className="font-mono text-slate-800">{x.valor}</span>
                      <button
                        type="button"
                        onClick={() => copiar(x.valor, x.chave)}
                        className="text-brand-600 hover:underline"
                      >
                        {copiado === x.chave ? 'copiado' : 'copiar'}
                      </button>
                    </>
                  ) : (
                    // Campo vazio é PENDÊNCIA, não detalhe: sem ele o portal não
                    // emite, e descobrir isso só lá é viagem perdida.
                    <span className="text-red-700">falta no cadastro</span>
                  )}
                </div>
              ))}
              {insumos.length === 0 && (
                <div className="text-slate-500">Nada declarado no catálogo.</div>
              )}
            </div>
          </div>

          {faltando.length > 0 && (
            <div className="text-red-700">
              Não dá para emitir ainda: falta {faltando.map((x) => x.rotulo).join(', ')}.
            </div>
          )}

          {cat?.validade_dias && (
            <div className="text-slate-600">
              Validade: {cat.validade_dias} dias
              {cat.sla_horas ? ` · sai em até ${cat.sla_horas}h` : ''}
            </div>
          )}

          {/* SEM LINK: o endereço desta certidão depende da UF, do município ou da
              comarca, e cadastrar 54 links sem conferir cada um seria pior que não
              ter — link errado manda a pessoa para o lugar errado. Então quem
              precisa pela primeira vez cola aqui, e da segunda em diante aparece
              pronto para todo mundo. */}
          {!url && escopo && (
            <div className="rounded-md bg-white p-2 ring-1 ring-inset ring-slate-200">
              <div className="mb-1 text-slate-600">
                O link desta certidão depende de <strong>{escopo}</strong>, e ainda
                não está cadastrado. Cole o endereço oficial e ele passa a aparecer
                aqui para todos os créditos deste escopo:
              </div>
              <div className="flex flex-wrap gap-2">
                <Input
                  value={novaUrl}
                  onChange={(e) => setNovaUrl(e.target.value)}
                  placeholder="https://..."
                  className="min-w-0 flex-1"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={salvarUrl}
                  loading={salvandoUrl}
                  disabled={!/^https?:\/\/\S+$/.test(novaUrl.trim())}
                >
                  Salvar link
                </Button>
              </div>
              {erroUrl && <div className="mt-1 text-red-700">{erroUrl}</div>}
            </div>
          )}

          {!url && !escopo && (
            <div className="text-amber-800">
              Esta certidão não tem link no catálogo e não tem escopo (UF, município
              ou comarca) para cadastrar um. Emissão manual, procurando o portal.
            </div>
          )}
        </div>
      )}
    </div>
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
  nascimentos,
  locais,
  onNascimento,
  onLocal,
  vazio,
}: {
  nascimentos: (NascimentoEncontrado & { arquivo?: string })[]
  locais: (LocalEncontrado & { arquivo?: string })[]
  onNascimento: (iso: string) => void
  onLocal: (l: LocalEncontrado) => void
  vazio: string
}) {
  if (nascimentos.length === 0 && locais.length === 0) {
    return <p className="text-xs text-slate-600">{vazio}</p>
  }
  return (
    <div className="space-y-2">
      {nascimentos.length > 0 && (
        <div>
          <div className="mb-1 text-xs text-slate-600">
            Data de nascimento <strong>do cedente</strong> — só datas rotuladas como
            nascimento entram, senão a lista viria com toda data do processo:
          </div>
          <div className="space-y-1">
            {nascimentos.map((n) => (
              <button
                key={n.iso}
                type="button"
                onClick={() => onNascimento(n.iso)}
                className="block w-full rounded-md bg-white p-2 text-left text-xs ring-1 ring-inset ring-slate-200 transition-colors hover:bg-brand-50 hover:ring-brand-300"
              >
                <span className="font-mono font-medium text-slate-800">
                  {n.iso.split('-').reverse().join('/')}
                </span>
                {n.arquivo && (
                  <span className="ml-2 text-slate-400">em {n.arquivo}</span>
                )}
                <span className="mt-0.5 block truncate text-slate-500">
                  …{n.contexto}…
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      {locais.length > 0 && (
        <div>
          <div className="mb-1 text-xs text-slate-600">
            Cidade e UF <strong>do cedente</strong> — conferidas contra a lista do
            IBGE. Clicar preenche as duas juntas:
          </div>
          <div className="space-y-1">
            {locais.map((l) => (
              <button
                key={`${l.uf}-${l.municipio}`}
                type="button"
                onClick={() => onLocal(l)}
                className="block w-full rounded-md bg-white p-2 text-left text-xs ring-1 ring-inset ring-slate-200 transition-colors hover:bg-brand-50 hover:ring-brand-300"
              >
                <span className="font-medium text-slate-800">
                  {l.municipio}/{l.uf}
                </span>
                {l.residencial && (
                  <Badge size="sm" tone="blue" className="ml-2">
                    perto de &quot;residente&quot;
                  </Badge>
                )}
                {l.arquivo && (
                  <span className="ml-2 text-slate-400">em {l.arquivo}</span>
                )}
                {l.forma === 'rotulado' && (
                  <span className="ml-2 text-slate-400">(campo CIDADE/UF)</span>
                )}
                <span className="mt-0.5 block truncate text-slate-500">
                  …{l.contexto}…
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ componente

export function ChecklistCertidoes({
  leadId,
  cedenteDoCard,
  arquivos,
  lendoPdf,
  avisoPdf,
  open,
  onClose,
}: {
  leadId: number
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
  open: boolean
  onClose: () => void
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

  const [editando, setEditando] = useState(false)
  const [cedente, setCedente] = useState<FormPessoa>(VAZIO)
  const [conjuge, setConjuge] = useState<FormPessoa>(VAZIO)
  const [temConjuge, setTemConjuge] = useState(false)
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

  const [ufs, setUfs] = useState<string[]>([])
  const [municipios, setMunicipios] = useState<Record<string, string[]>>({})

  // A lista do IBGE tem 5571 municípios: importada sob demanda, como em
  // DadosPessoaisBancarios, para não entrar no bundle de quem nunca abre isto.
  const [erroMunicipios, setErroMunicipios] = useState<string | null>(null)
  useEffect(() => {
    if (!open || ufs.length > 0) return
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
  }, [open, ufs.length])

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
  const candidatos: (CpfEncontrado & { arquivo: string })[] = useMemo(() => {
    const fora: (CpfEncontrado & { arquivo: string })[] = []
    for (const a of arquivos) {
      if (!a.texto) continue
      for (const c of acharCpfs(a.texto)) {
        if (!fora.some((x) => x.cpf === c.cpf)) fora.push({ ...c, arquivo: a.nome })
      }
    }
    return fora
  }, [arquivos])

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
  const estadosCivis = useMemo(() => {
    const ancoras = [onlyDigits(cedente.cpf), cedente.nome.trim()].filter(
      (a) => a.length >= 4,
    )
    const fora: (EstadoCivilEncontrado & { arquivo: string })[] = []
    for (const a of arquivos) {
      if (!a.texto) continue
      for (const e of acharEstadoCivil(a.texto, ancoras)) {
        if (!fora.some((x) => x.estado === e.estado && x.conjuge === e.conjuge)) {
          fora.push({ ...e, arquivo: a.nome })
        }
      }
    }
    return fora.sort((x, y) => Number(y.doCedente) - Number(x.doCedente))
  }, [arquivos, cedente.cpf, cedente.nome])

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
    const doc = onlyDigits(cedente.cpf)
    if (doc.length !== 11 || !cpfValido(cedente.cpf)) return
    if (cpfAplicado.current === doc) return
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
      setTemConjuge(pede)
      if (pede && e.conjuge) setConjuge((f) => ({ ...f, nome: f.nome.trim() || e.conjuge! }))
      feitos.push(
        `${ROTULO_ESTADO_CIVIL[e.estado] ?? e.estado}${e.conjuge ? ` (cônjuge ${e.conjuge})` : ''}`,
      )
    }

    if (feitos.length > 0) {
      setMexeu(true)
      setPreenchido(feitos)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cedente.cpf, doPdf, estadosCivis])


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
    await recarregar()
  }

  /** Local escolhido preenche UF E MUNICÍPIO JUNTOS — nunca um sem o outro. */
  function usarLocal(l: { uf: string; municipio: string }) {
    setMexeu(true)
    setCedente((f) => ({ ...f, uf: l.uf, municipio: l.municipio }))
  }

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
        supabase
          .from('dd_certidao')
          .select(
            'id, sujeito_id, certidao_codigo, parametros, obrigatoria, status,' +
              ' erro_classe, erro_detalhe, dispensa_motivo,' +
              ' certidao_catalogo(nome_curto, orgao_emissor, metodo, captcha, login,' +
              ' url_oficial, dados_entrada, dados_entrada_pf, dados_entrada_pj,' +
              ' validade_dias, sla_horas)',
          )
          .eq('kommo_lead_id', leadId),
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
          .select('processo_cnj')
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
      setConjuge(daPessoa(cnj) ?? VAZIO)
      setTemConjuge(!!cnj)
      setResidenciaLevantada(ced?.residencia_levantada ?? false)
      setUfsAnteriores((ced?.ufs_anteriores ?? []).join(', '))
      setMunicipiosAnteriores((ced?.municipios_anteriores ?? []).join(', '))
      setEditando(listaS.length === 0)
      setMexeu(false)
    } catch (e) {
      setErro((e as Error)?.message ?? String(e))
    } finally {
      setCarregando(false)
    }
  }, [leadId, cedenteDoCard])

  useEffect(() => {
    if (open) void recarregar()
  }, [open, recarregar])

  // ---------------------------------------------------------------- validação

  const problemas = useMemo(() => {
    const p: string[] = []
    if (!cedente.nome.trim()) p.push('O nome do cedente é obrigatório.')
    if (!cpfValido(cedente.cpf) || onlyDigits(cedente.cpf).length !== 11) {
      p.push('CPF do cedente inválido — confira os 11 dígitos no processo.')
    }
    if (!cedente.uf) {
      p.push(
        'UF atual do cedente é obrigatória: é ela que define as certidões ' +
          'estaduais do checklist.',
      )
    }
    if (temConjuge) {
      if (!conjuge.nome.trim()) p.push('O nome do cônjuge é obrigatório.')
      if (!cpfValido(conjuge.cpf) || onlyDigits(conjuge.cpf).length !== 11) {
        p.push('CPF do cônjuge inválido.')
      }
      if (onlyDigits(conjuge.cpf) === onlyDigits(cedente.cpf)) {
        p.push('O CPF do cônjuge é o mesmo do cedente.')
      }
    }
    return p
  }, [cedente, conjuge, temConjuge])

  /**
   * O que a gravação vai DESTRUIR. Calculado do que já está na tela, sem ida ao
   * servidor: trocar o CPF de um sujeito apaga o sujeito antigo, e dd_certidao
   * cai em cascata — inclusive as OBTIDA, com o drive_file_id do PDF que alguém
   * já emitiu e guardou. Perder isso sem avisar é inaceitável; o número entra na
   * confirmação.
   */
  const impacto = useMemo(() => {
    const docCed = onlyDigits(cedente.cpf)
    const docCnj = temConjuge ? onlyDigits(conjuge.cpf) : null
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
  }, [sujeitos, itens, cedente.cpf, conjuge.cpf, temConjuge])

  // ---------------------------------------------------------------- gravação

  async function salvarEGerar() {
    if (problemas.length > 0) return

    if (impacto.sujeitos.length > 0) {
      const quem = impacto.sujeitos
        .map((s) => `${s.papel} ${s.nome} (${formatCpfCnpjInput(s.documento)})`)
        .join(', ')
      const perda =
        impacto.obtidas > 0
          ? `\n\nATENÇÃO: ${impacto.obtidas} certidão(ões) JÁ OBTIDA(S) serão ` +
            `apagadas do checklist, com o vínculo do arquivo no Drive. O arquivo ` +
            `continua no Drive, mas o registro de que ele existe se perde.`
          : ''
      const segue = window.confirm(
        `Isto vai REMOVER do crédito: ${quem}.\n` +
          `E apagar ${impacto.certidoes} item(ns) do checklist dessa(s) pessoa(s).` +
          `${perda}\n\nConfirma?`,
      )
      if (!segue) return
    }

    setSalvando(true)
    setErro(null)
    try {
      const listaUf = (s: string) =>
        s
          .split(/[,;]/)
          .map((x) => x.trim().toUpperCase())
          .filter((x) => /^[A-Z]{2}$/.test(x))
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
          data_nascimento: cedente.nascimento || null,
          uf_atual: cedente.uf,
          municipio_atual: cedente.municipio.trim(),
          ufs_anteriores: listaUf(ufsAnteriores),
          municipios_anteriores: listaTexto(municipiosAnteriores),
          residencia_levantada: residenciaLevantada,
        },
        // null APAGA o cônjuge no banco. É o que faz desmarcar a caixa valer
        // algo: antes, desmarcar era no-op e as certidões do cônjuge removido
        // continuavam contando como obrigatórias, para sempre.
        p_conjuge: temConjuge
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
        throw new Error(
          /documento_dv|documento_digitos|tipo_bate_documento/.test(error.message)
            ? 'O banco recusou o documento: dígito verificador inválido. Confira o CPF no processo.'
            : error.message,
        )
      }
      const rel = (data ?? {}) as { certidoes_removidas?: number }
      if (rel.certidoes_removidas) {
        toast.success(`${rel.certidoes_removidas} item(ns) do checklist antigo removido(s).`)
      }

      const r = await invokeFunction<RespostaGeracao>('gerar-checklist-certidoes', {
        kommo_lead_id: leadId,
      })
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
      await recarregar()
      toast.success(`Motor rodou: ${r.total ?? 0} item(ns) na regra de hoje.`)
    } catch (e) {
      setErro((e as Error)?.message ?? String(e))
    } finally {
      setSalvando(false)
    }
  }

  // ---------------------------------------------------------------- render

  const porSujeito = useMemo(() => {
    const mapa = new Map<string, ItemChecklist[]>()
    for (const i of itens) {
      const l = mapa.get(i.sujeito_id) ?? []
      l.push(i)
      mapa.set(i.sujeito_id, l)
    }
    for (const l of mapa.values()) {
      l.sort((a, b) =>
        (a.certidao_catalogo?.nome_curto ?? a.certidao_codigo).localeCompare(
          b.certidao_catalogo?.nome_curto ?? b.certidao_codigo,
          'pt-BR',
        ),
      )
    }
    return mapa
  }, [itens])

  const municipiosDaUf = (uf: string) => (uf ? (municipios[uf] ?? []) : [])
  const alterar = <T,>(set: (v: T) => void) => (v: T) => {
    setMexeu(true)
    set(v)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      dirty={editando && mexeu}
      title="Certidões do crédito"
      description={
        editando
          ? 'O checklist é montado por sujeito. Sem CPF e UF não há como saber quais certidões são exigidas.'
          : 'Checklist congelado no banco. A etapa documental só fecha com todas as obrigatórias em arquivo.'
      }
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={salvando}>
            Fechar
          </Button>
          {editando ? (
            <Button
              onClick={salvarEGerar}
              loading={salvando}
              disabled={problemas.length > 0}
              icon={<Sparkles className="h-4 w-4" />}
            >
              Gravar e montar checklist
            </Button>
          ) : (
            <>
              <Button
                variant="secondary"
                onClick={() => setEditando(true)}
                disabled={salvando}
                icon={<Pencil className="h-4 w-4" />}
              >
                Corrigir dados / cônjuge
              </Button>
              <Button
                variant="outline"
                onClick={gerarFaltantes}
                loading={salvando}
                icon={<Plus className="h-4 w-4" />}
              >
                Gerar itens faltantes
              </Button>
            </>
          )}
        </div>
      }
    >
      {erro && (
        <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 ring-1 ring-inset ring-red-200">
          {erro}
        </div>
      )}

      {erroLinks && (
        <div className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
          {erroLinks}
        </div>
      )}

      {erroMunicipios && (
        <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 ring-1 ring-inset ring-red-200">
          {erroMunicipios}
        </div>
      )}

      {carregando ? (
        <div className="py-8 text-center text-sm text-slate-500">Carregando…</div>
      ) : editando ? (
        <div className="space-y-5">
          {/* ---------------- candidatos de CPF ---------------- */}
          <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-inset ring-slate-200">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-slate-700">
              <FileText className="h-4 w-4" />
              O que achei nos anexos do card
              {arquivos.length > 0 && (
                <span className="font-normal text-slate-500">
                  ({arquivos.length} arquivo{arquivos.length > 1 ? 's' : ''})
                </span>
              )}
            </div>

            {/*
              ARQUIVO SEM TEXTO É DITO, não omitido.
              Petição digitalizada, foto de RG, comprovante escaneado: são IMAGEM,
              e o pdf.js extrai texto selecionável. Sem este aviso, o dado estaria
              no processo, a tela não acharia nada, e a leitura natural seria "o
              processo não tem" — que é falso. É a diferença entre "não consegui
              ler" e "não existe".
            */}
            {digitalizados.length > 0 && (
              <div className="mb-2 space-y-1 rounded-md bg-amber-50 p-2 text-xs text-amber-900 ring-1 ring-inset ring-amber-200">
                {digitalizados.map((a, i) => (
                  <div key={`${a.nome}-${i}`}>
                    <strong>{a.nome || '(anexo sem nome)'}</strong>
                    {a.erro
                      ? ` — ${a.erro}`
                      : ` — ${a.paginas} página(s) com só ${a.densidade} caractere(s) ` +
                        `por página: é digitalização (o texto que tem é o rodapé de ` +
                        `assinatura do tribunal). Se o nascimento ou o endereço ` +
                        `estiverem só aí — foto de RG, comprovante de residência —, eu ` +
                        `não leio: abra o arquivo e digite.`}
                  </div>
                ))}
              </div>
            )}
            {lendoPdf ? (
              <p className="text-xs text-slate-500">Lendo o PDF do card…</p>
            ) : candidatos.length > 0 ||
              doPdf.nascimentos.length > 0 ||
              doPdf.locais.length > 0 ||
              estadosCivis.length > 0 ||
              digitalizados.length > 0 ? (
              <>
                {candidatos.length > 0 && (
                  <p className="mb-2 text-xs text-slate-600">
                    Dígito verificador conferido. <strong>Escolher é seu</strong>: um
                    processo traz o CPF do cedente, do advogado e às vezes de terceiros —
                    o sistema não tem como saber qual é qual. A lista pode estar
                    incompleta: o PDF nem sempre entrega os números inteiros.
                  </p>
                )}
                {candidatos.length === 0 && (
                  <p className="mb-2 text-xs text-amber-800">
                    Nenhum CPF de dígito válido no texto — digite o do cedente abaixo,
                    conferindo no processo. O que achei do resto está logo abaixo.
                  </p>
                )}
                <div className="space-y-1.5">
                  {candidatos.map((c) => (
                    <button
                      key={c.cpf}
                      type="button"
                      onClick={() =>
                        alterar(setCedente)({ ...cedente, cpf: formatCpfCnpjInput(c.cpf) })
                      }
                      className="block w-full rounded-md bg-white p-2 text-left text-xs ring-1 ring-inset ring-slate-200 transition-colors hover:bg-brand-50 hover:ring-brand-300"
                    >
                      <span className="font-mono font-medium text-slate-800">
                        {formatCpfCnpjInput(c.cpf)}
                      </span>
                      {c.rotulado && (
                        <Badge size="sm" tone="blue" className="ml-2">
                          rotulado &quot;CPF&quot;
                        </Badge>
                      )}
                      {c.arquivo && (
                        <span className="ml-2 text-slate-400">em {c.arquivo}</span>
                      )}
                      <span className="mt-0.5 block truncate text-slate-500">
                        …{c.contexto}…
                      </span>
                    </button>
                  ))}
                </div>
                {/*
                  ESTADO CIVIL: é o que DOBRA o checklist.
                  Cedente casado tem bloco próprio de certidões para o cônjuge
                  (planilha, linhas 52 a 67). Deixar de marcar fecha o dossiê com
                  esse bloco inteiro faltando, e o placar não acusa nada — por isso
                  a sugestão fica aqui, do lado do CPF, e não escondida na caixinha
                  lá embaixo.
                */}
                {estadosCivis.length > 0 && (
                  <div className="mt-3 border-t border-slate-200 pt-3">
                    <div className="mb-1 text-xs text-slate-600">
                      Estado civil na qualificação das partes — clicar já liga ou
                      desliga o bloco do cônjuge:
                    </div>
                    <div className="space-y-1">
                      {estadosCivis.map((e) => (
                        <button
                          key={`${e.estado}-${e.conjuge ?? ''}`}
                          type="button"
                          onClick={() => usarEstadoCivil(e)}
                          className="block w-full rounded-md bg-white p-2 text-left text-xs ring-1 ring-inset ring-slate-200 transition-colors hover:bg-brand-50 hover:ring-brand-300"
                        >
                          <span className="font-medium text-slate-800">
                            {ROTULO_ESTADO_CIVIL[e.estado] ?? e.estado}
                          </span>
                          {e.conjuge && (
                            <span className="ml-2 text-slate-700">
                              — cônjuge: {e.conjuge}
                            </span>
                          )}
                          {e.doCedente ? (
                            <Badge size="sm" tone="blue" className="ml-2">
                              perto do cedente
                            </Badge>
                          ) : (
                            <Badge size="sm" tone="yellow" className="ml-2">
                              pode ser de outra parte
                            </Badge>
                          )}
                          <span className="ml-2 text-slate-400">em {e.arquivo}</span>
                          <span className="mt-0.5 block truncate text-slate-500">
                            …{e.contexto}…
                          </span>
                        </button>
                      ))}
                    </div>
                    <p className="mt-1 text-xs text-amber-800">
                      A petição pode ser antiga: &quot;casada&quot; naquela data não
                      é &quot;casada hoje&quot;. Confirme antes de gerar o checklist.
                    </p>
                  </div>
                )}

                {(doPdf.nascimentos.length > 0 || doPdf.locais.length > 0) && (
                  <div
                    className={
                      candidatos.length > 0
                        ? 'mt-3 border-t border-slate-200 pt-3'
                        : 'mt-2'
                    }
                  >
                    <Sugestoes
                      nascimentos={doPdf.nascimentos}
                      locais={doPdf.locais}
                      onNascimento={(iso) => {
                        setMexeu(true)
                        setCedente((f) => ({ ...f, nascimento: iso }))
                      }}
                      onLocal={usarLocal}
                      vazio=""
                    />
                  </div>
                )}
              </>
            ) : avisoPdf ? (
              <p className="text-xs text-slate-600">{avisoPdf}</p>
            ) : temTexto ? (
              // Só se pode afirmar isto DEPOIS de ler o PDF. Sem texto, o certo é
              // dizer que não leu — não que o documento não tem CPF.
              <p className="text-xs text-slate-600">
                Li o PDF e não achei nenhum CPF de dígito válido no texto. Pode ser que o
                documento traga o número partido de um jeito que a busca não pega — digite
                abaixo, conferindo no processo.
              </p>
            ) : (
              <p className="text-xs text-slate-600">
                O PDF do card ainda não foi lido. Digite o CPF conferindo no processo.
              </p>
            )}
          </div>

          {/* ---------------- colar de outra consulta ---------------- */}
          {/*
            POR QUE UMA CAIXA DE COLAR, e não integração.

            A Date Solutions é plataforma WEB: não publica API nem documentação de
            integração. Automatizar contra ela seria robô preenchendo formulário de
            terceiro — frágil e provavelmente contra os termos de uso. Mas o dado
            que ela mostra na tela é o mesmo dado: copiar e colar aqui aproveita a
            consulta que a pessoa JÁ fez, sem integração nenhuma, sem custo novo e
            sem depender de fornecedor.

            E vale para qualquer fonte, hoje e depois: o parser é o mesmo do PDF
            (lib/dadosNoTexto.ts). Se um dia a Date Solutions tiver API, ligá-la é
            trocar de onde vem o texto — o resto já está feito.
          */}
          <details className="rounded-lg bg-slate-50 p-3 ring-1 ring-inset ring-slate-200">
            <summary className="cursor-pointer text-xs font-medium text-slate-700">
              <ClipboardPaste className="mr-1 inline h-4 w-4" />
              Colar resultado de outra consulta (Date Solutions, etc.)
            </summary>
            <div className="mt-2 space-y-2">
              <Textarea
                value={colado}
                onChange={(e) => setColado(e.target.value)}
                rows={4}
                placeholder="Cole aqui o resultado da consulta do CEDENTE. Eu leio a data de nascimento e a cidade/UF; o resto do texto é ignorado e não fica guardado."
              />
              {colado.trim() && (
                <Sugestoes
                  nascimentos={doColado.nascimentos}
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
              <p className="text-xs text-slate-500">
                Este texto NÃO é gravado. Só os campos em que você clicar entram no
                cadastro — o resto morre quando a janela fecha.
              </p>
            </div>
          </details>

          {preenchido.length > 0 && (
            <div className="rounded-lg bg-emerald-50 p-3 text-xs text-emerald-900 ring-1 ring-inset ring-emerald-200">
              Preenchi a partir do processo: <strong>{preenchido.join(' · ')}</strong>.
              Confira antes de gerar — o trecho de onde saiu cada um está no painel
              acima. O CPF eu nunca preencho sozinho.
            </div>
          )}

          {/* ---------------- cedente ---------------- */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-slate-800">Cedente</h4>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nome completo" required>
                <Input
                  value={cedente.nome}
                  onChange={(e) => alterar(setCedente)({ ...cedente, nome: e.target.value })}
                  placeholder="Como está na qualificação das partes"
                />
              </Field>
              <Field
                label="CPF"
                required
                error={
                  cedente.cpf && !cpfValido(cedente.cpf)
                    ? 'Dígito verificador não fecha.'
                    : undefined
                }
              >
                <Input
                  value={cedente.cpf}
                  onChange={(e) =>
                    alterar(setCedente)({
                      ...cedente,
                      cpf: formatCpfCnpjInput(e.target.value),
                    })
                  }
                  inputMode="numeric"
                  placeholder="000.000.000-00"
                />
              </Field>

              <Field
                label="Data de nascimento"
                hint="A CND Federal (Receita/PGFN) não sai sem ela — é o primeiro item do checklist."
              >
                <Input
                  type="date"
                  value={cedente.nascimento}
                  onChange={(e) =>
                    alterar(setCedente)({ ...cedente, nascimento: e.target.value })
                  }
                />
              </Field>
              <Field
                label="UF atual"
                required
                hint="Define as certidões estaduais (TJ, SEFAZ, Justiça Estadual)."
              >
                <Select
                  value={cedente.uf}
                  onChange={(e) =>
                    alterar(setCedente)({ ...cedente, uf: e.target.value, municipio: '' })
                  }
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
                label="Município atual"
                hint="Em branco = nenhuma certidão municipal entra no checklist."
              >
                <Select
                  value={cedente.municipio}
                  onChange={(e) =>
                    alterar(setCedente)({ ...cedente, municipio: e.target.value })
                  }
                  disabled={!cedente.uf}
                >
                  <option value="">
                    {cedente.uf ? 'Selecione…' : 'Escolha a UF primeiro'}
                  </option>
                  {municipiosDaUf(cedente.uf).map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </div>

          {/* ---------------- residência ---------------- */}
          <div className="space-y-3 rounded-lg bg-amber-50/60 p-3 ring-1 ring-inset ring-amber-200">
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600"
                checked={residenciaLevantada}
                onChange={(e) => alterar(setResidenciaLevantada)(e.target.checked)}
              />
              <span className="text-sm text-slate-800">
                Levantei o histórico de residência do cedente
                <span className="mt-0.5 block text-xs text-slate-600">
                  Deixe desmarcado se não conferiu. &quot;Não sei se morou em outro
                  estado&quot; e &quot;não morou&quot; são respostas diferentes, e a segunda
                  dispensa certidão que a primeira não dispensa. Vale só para o cedente: o
                  cônjuge entra sempre como não levantado, porque esta tela não pergunta o
                  histórico dele.
                </span>
              </span>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="UFs anteriores" hint="Siglas separadas por vírgula: MG, SP">
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
          </div>

          {/* ---------------- cônjuge ---------------- */}
          <div className="space-y-3">
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600"
                checked={temConjuge}
                onChange={(e) => alterar(setTemConjuge)(e.target.checked)}
              />
              <span className="text-sm font-semibold text-slate-800">
                O cedente é casado / tem companheiro(a)
                <span className="mt-0.5 block text-xs font-normal text-slate-600">
                  A planilha dá bloco próprio de certidões ao cônjuge (linhas 52 a 67).
                  Sem isto, o checklist fecha completo com esse bloco inteiro faltando.
                  Desmarcar REMOVE o cônjuge já cadastrado e as certidões dele.
                </span>
              </span>
            </label>
            {temConjuge && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Nome do cônjuge" required>
                  <Input
                    value={conjuge.nome}
                    onChange={(e) =>
                      alterar(setConjuge)({ ...conjuge, nome: e.target.value })
                    }
                  />
                </Field>
                <Field
                  label="CPF do cônjuge"
                  required
                  error={
                    conjuge.cpf && !cpfValido(conjuge.cpf)
                      ? 'Dígito verificador não fecha.'
                      : undefined
                  }
                >
                  <Input
                    value={conjuge.cpf}
                    onChange={(e) =>
                      alterar(setConjuge)({
                        ...conjuge,
                        cpf: formatCpfCnpjInput(e.target.value),
                      })
                    }
                    inputMode="numeric"
                    placeholder="000.000.000-00"
                  />
                </Field>
                <Field label="Data de nascimento do cônjuge">
                  <Input
                    type="date"
                    value={conjuge.nascimento}
                    onChange={(e) =>
                      alterar(setConjuge)({ ...conjuge, nascimento: e.target.value })
                    }
                  />
                </Field>
                <Field
                  label="UF do cônjuge"
                  hint="Em branco = mesma UF E mesmo município do cedente."
                >
                  <Select
                    value={conjuge.uf}
                    onChange={(e) =>
                      alterar(setConjuge)({
                        ...conjuge,
                        uf: e.target.value,
                        municipio: '',
                      })
                    }
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
                      onChange={(e) =>
                        alterar(setConjuge)({ ...conjuge, municipio: e.target.value })
                      }
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

          {impacto.sujeitos.length > 0 && (
            <div className="rounded-lg bg-red-50 p-3 text-xs text-red-800 ring-1 ring-inset ring-red-200">
              Gravar assim REMOVE{' '}
              {impacto.sujeitos.map((s) => `${s.papel} ${s.nome}`).join(', ')} e apaga{' '}
              {impacto.certidoes} item(ns) do checklist
              {impacto.obtidas > 0 && (
                <>
                  , dos quais <strong>{impacto.obtidas} já obtida(s)</strong>
                </>
              )}
              . Vai pedir confirmação.
            </div>
          )}

          {problemas.length > 0 && (
            <ul className="space-y-1 rounded-lg bg-slate-50 p-3 text-xs text-slate-700 ring-1 ring-inset ring-slate-200">
              {problemas.map((p) => (
                <li key={p}>• {p}</li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          {/* ---------------- placar ---------------- */}
          {completude && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {[
                { r: 'Obrigatórias', v: completude.necessarias },
                { r: 'Obtidas', v: completude.obtidas_validas },
                { r: 'Pendentes', v: completude.pendentes },
                { r: 'Vencidas', v: completude.vencidas },
                // Dispensadas ao lado das outras quatro, e não escondida: ela SAI
                // do denominador (v_dd_completude), então um placar "14 de 14" com
                // 8 dispensadas é um dossiê fechado sobre 8 certidões que a regra
                // exigia. O número existia no banco e não aparecia na tela.
                { r: 'Dispensadas', v: completude.dispensadas },
              ].map((c) => (
                <div
                  key={c.r}
                  className="rounded-lg bg-slate-50 p-3 ring-1 ring-inset ring-slate-200"
                >
                  <div className="text-xs text-slate-500">{c.r}</div>
                  <div className="text-xl font-semibold text-slate-800">{c.v}</div>
                </div>
              ))}
            </div>
          )}

          {completude && completude.necessarias > 0 && (
            <div className="text-sm">
              {completude.obtidas_validas === completude.necessarias ? (
                <span className="font-medium text-emerald-700">
                  ✅ Documental completa — {completude.obtidas_validas} de{' '}
                  {completude.necessarias}
                  {completude.dispensadas > 0 && (
                    <span className="text-amber-700">
                      {' '}
                      · {completude.dispensadas} dispensada(s) fora da conta
                    </span>
                  )}
                  .
                </span>
              ) : (
                <span className="font-medium text-amber-700">
                  ⏳ {completude.obtidas_validas} de {completude.necessarias} obtidas. A
                  etapa documental não fecha até chegar a {completude.necessarias}.
                </span>
              )}
            </div>
          )}

          {/* ---------------- avisos ---------------- */}
          {avisos.length > 0 && (
            <div className="space-y-1.5 rounded-lg bg-amber-50 p-3 ring-1 ring-inset ring-amber-200">
              {avisos.map((a) => (
                <div key={a} className="flex gap-2 text-xs text-amber-900">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" />
                  <span>{a}</span>
                </div>
              ))}
            </div>
          )}

          {/*
            ---------------- o que o processo diz do estado civil ----------------

            AQUI, no placar, e não só dentro do formulário.

            O aviso logo acima pergunta, em letras maiúsculas, se o cedente é
            casado — e esta tela tem o texto do processo em memória, capaz de
            responder. Antes a resposta existia e morava atrás de "Corrigir dados
            / cônjuge", que é uma tela que só se abre quem já decidiu ir editar.
            Num crédito já cadastrado a janela abre no placar, então na prática a
            resposta nunca aparecia para quem estava lendo a pergunta.

            E este silêncio é o desfecho mais caro do sistema: falta o bloco
            inteiro de certidões do cônjuge (planilha, linhas 52 a 67) e o placar
            marca "completo" sem acusar nada, porque o que não foi exigido não
            entra no denominador.

            As três saídas abaixo são deliberadamente diferentes entre si, e
            NENHUMA delas é silêncio — inclusive a de não ter achado.
          */}
          {sujeitos.length > 0 && !respostaEstadoCivil.temConjugeCadastrado && (
            <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-inset ring-slate-200">
              <div className="mb-2 flex items-center gap-2 text-xs font-medium text-slate-700">
                <FileText className="h-4 w-4" />
                Estado civil, segundo os anexos do card
                {arquivos.length > 0 && (
                  <span className="font-normal text-slate-500">
                    ({arquivos.length} arquivo{arquivos.length > 1 ? 's' : ''})
                  </span>
                )}
              </div>

              {lendoPdf ? (
                <p className="text-xs text-slate-500">Lendo os anexos do card…</p>
              ) : respostaEstadoCivil.ancorado ? (
                <div className="space-y-2">
                  <div className="text-sm text-slate-800">
                    O processo qualifica{' '}
                    <strong>
                      {sujeitos.find((s) => s.papel === 'CEDENTE')?.nome ?? 'o cedente'}
                    </strong>{' '}
                    como{' '}
                    <strong className="text-brand-700">
                      {ROTULO_ESTADO_CIVIL[respostaEstadoCivil.ancorado.estado] ??
                        respostaEstadoCivil.ancorado.estado}
                    </strong>
                    {respostaEstadoCivil.ancorado.conjuge && (
                      <>
                        , cônjuge{' '}
                        <strong>{respostaEstadoCivil.ancorado.conjuge}</strong>
                      </>
                    )}
                    .
                  </div>
                  <div className="rounded-md bg-white p-2 text-xs text-slate-500 ring-1 ring-inset ring-slate-200">
                    …{respostaEstadoCivil.ancorado.contexto}…
                    {respostaEstadoCivil.ancorado.arquivo && (
                      <span className="mt-0.5 block text-slate-400">
                        em {respostaEstadoCivil.ancorado.arquivo}
                      </span>
                    )}
                  </div>

                  {PEDE_CONJUGE.has(respostaEstadoCivil.ancorado.estado) ? (
                    <div className="flex flex-wrap items-center gap-2 rounded-md bg-amber-50 p-2 ring-1 ring-inset ring-amber-200">
                      <span className="text-xs text-amber-900">
                        Então faltam as certidões do cônjuge — o bloco das linhas 52 a
                        67 da planilha. O placar acima <strong>não</strong> conta essa
                        falta.
                      </span>
                      <Button
                        size="sm"
                        onClick={() =>
                          cadastrarConjugeCom(respostaEstadoCivil.ancorado!)
                        }
                        disabled={salvando}
                        icon={<Pencil className="h-4 w-4" />}
                      >
                        Cadastrar o cônjuge
                      </Button>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-600">
                      Sem cônjuge, o bloco de certidões dele não se aplica — e o aviso
                      acima está respondido. <strong>Confira mesmo assim</strong>: o
                      documento pode ser de anos atrás, e estado civil muda.
                    </p>
                  )}
                </div>
              ) : respostaEstadoCivil.soltos.length > 0 ? (
                <div className="space-y-2">
                  {/*
                    Achei estado civil, mas NÃO consegui prendê-lo ao cedente. Numa
                    petição, a qualificação do advogado e a da parte contrária ficam
                    a poucos caracteres da do autor — oferecer isso como resposta
                    seria trocar "é do cedente" por "estava por perto". O trecho
                    aparece para a pessoa julgar; o sistema não julga.
                  */}
                  <p className="text-xs text-amber-800">
                    Achei estado civil no processo, mas{' '}
                    <strong>não consegui ligar ao nome nem ao CPF do cedente</strong> —
                    numa petição isso costuma ser do advogado ou da outra parte. Leia o
                    trecho antes de usar:
                  </p>
                  <div className="space-y-1">
                    {respostaEstadoCivil.soltos.slice(0, 3).map((e) => (
                      <div
                        key={`${e.estado}-${e.conjuge ?? ''}`}
                        className="rounded-md bg-white p-2 text-xs ring-1 ring-inset ring-slate-200"
                      >
                        <span className="font-medium text-slate-800">
                          {ROTULO_ESTADO_CIVIL[e.estado] ?? e.estado}
                        </span>
                        {e.arquivo && (
                          <span className="ml-2 text-slate-400">em {e.arquivo}</span>
                        )}
                        <span className="mt-0.5 block text-slate-500">…{e.contexto}…</span>
                      </div>
                    ))}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setEditando(true)}
                    disabled={salvando}
                    icon={<Pencil className="h-4 w-4" />}
                  >
                    Abrir o cadastro para decidir
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  {/*
                    NÃO ACHEI ≠ NÃO É CASADA. É a regra da casa desde o começo, e o
                    lugar onde ela mais importa é justamente este: a leitura natural
                    de uma tela calada é "então não tem cônjuge", que fecha o dossiê
                    com um bloco inteiro faltando.
                  */}
                  <p className="text-xs text-amber-800">
                    {arquivos.length === 0
                      ? 'Não consegui abrir nenhum anexo deste card.'
                      : temTexto
                        ? `Li o texto d${arquivos.length > 1 ? 'os' : 'o'} ${
                            arquivos.length
                          } anexo${arquivos.length > 1 ? 's' : ''} e não achei ` +
                          'estado civil na qualificação das partes.'
                        : `Nenhum d${arquivos.length > 1 ? 'os' : 'o'} ${
                            arquivos.length
                          } anexo${arquivos.length > 1 ? 's' : ''} tem texto para ler.`}{' '}
                    <strong>
                      &quot;Não achei&quot; não é &quot;não é casada&quot;
                    </strong>{' '}
                    — confira a petição inicial e cadastre à mão.
                  </p>
                  {digitalizados.length > 0 && (
                    <p className="text-xs text-amber-900">
                      E {digitalizados.length} anexo(s) são digitalização ou não
                      abriram:{' '}
                      <strong>{digitalizados.map((a) => a.nome).join(', ')}</strong>. Se
                      a qualificação estiver só aí, ela está em imagem — e imagem eu
                      ainda não leio.
                    </p>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setEditando(true)}
                    disabled={salvando}
                    icon={<Pencil className="h-4 w-4" />}
                  >
                    Cadastrar à mão
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* ---------------- lista por sujeito ---------------- */}
          {sujeitos.map((s) => {
            const lista = porSujeito.get(s.id) ?? []
            return (
              <div key={s.id}>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge size="sm" tone="blue">
                    {s.papel}
                  </Badge>
                  <span className="text-sm font-medium text-slate-800">{s.nome}</span>
                  <span className="font-mono text-xs text-slate-500">
                    {formatCpfCnpjInput(s.documento)}
                  </span>
                  <span className="text-xs text-slate-500">
                    {s.municipio_atual ? `${s.municipio_atual}/` : ''}
                    {s.uf_atual ?? 'sem UF'}
                  </span>
                  <span className="text-xs text-slate-500">
                    · {lista.length} item(ns)
                  </span>
                  {!s.residencia_levantada && (
                    <Badge size="sm" tone="yellow">
                      residência não levantada
                    </Badge>
                  )}
                </div>
                <div className="overflow-hidden rounded-lg ring-1 ring-inset ring-slate-200">
                  {lista.length === 0 ? (
                    <div className="p-3 text-xs text-slate-500">
                      Nenhuma certidão gerada para este sujeito.
                    </div>
                  ) : (
                    lista.map((i) => (
                      <LinhaCertidao
                        key={i.id}
                        item={i}
                        sujeito={s}
                        cnj={cnjDoCredito}
                        url={
                          i.certidao_catalogo?.url_oficial ||
                          urlPorEscopo.get(
                            `${i.certidao_codigo}|${escopoDe(i.parametros) ?? ''}`,
                          ) ||
                          null
                        }
                        onSalvarUrl={salvarUrlDoEscopo}
                      />
                    ))
                  )}
                </div>
              </div>
            )
          })}

          {sujeitos.length === 0 && (
            <div className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
              Nenhum sujeito cadastrado neste crédito. Clique em{' '}
              <strong>Corrigir dados / cônjuge</strong> para começar pelo cedente.
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
