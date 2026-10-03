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
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Clock,
  ExternalLink,
  FileText,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  X,
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
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { StatCard } from '@/components/ui/StatCard'
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
import { EmissaoBullai } from '@/components/EmissaoBullai'
import { classificarParcelaCedida, lerTituloCard } from '@/lib/kommo'
import type { QualificacaoLida } from '../../supabase/functions/_shared/qualificacaoDoCedente.ts'

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
  arquivos?: { portal: string; drive_link: string | null; nome: string }[] | null
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

  const estado = ESTADO_DA_LINHA[item.status]

  // O `.cert-row` da amostra: o que é (selo, nome, órgão, o detalhe) à esquerda,
  // as duas ações à direita, e o "Como emitir" abrindo embaixo, na largura toda.
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-b border-borda px-4 py-2.5 text-corpo last:border-b-0">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <Selo tom={estado?.tom ?? 'neutro'} icone={estado?.icone}>
          {estado?.rotulo ?? item.status}
        </Selo>
        <b className="font-bold text-texto">{cat?.nome_curto ?? item.certidao_codigo}</b>
        <span className="text-xs text-texto-3">{cat?.orgao_emissor}</span>
        {rotuloParametros(item.parametros) && (
          <span className="text-xs text-texto-3">({rotuloParametros(item.parametros)})</span>
        )}
        {!item.obrigatoria && <Selo tom="neutro">opcional</Selo>}
        {item.status === 'NAO_APLICAVEL' && (
          <span className="text-xs text-info">
            dispensada
            {item.dispensa_motivo ? `: ${item.dispensa_motivo}` : ' (sem motivo!)'}
          </span>
        )}
        {item.erro_classe && (
          <span className="text-xs text-aviso">
            {MOTIVO_MANUAL[item.erro_classe] ?? item.erro_classe}
            {item.erro_detalhe ? `: ${item.erro_detalhe}` : ''}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => setAberto((v) => !v)}
          aria-expanded={aberto}
          className={LINK_BTN}
        >
          {aberto ? 'Fechar' : 'Como emitir'}
        </button>
        {url ? (
          <a href={url} target="_blank" rel="noreferrer" className={LINK_BTN}>
            Abrir portal <ExternalLink className="h-4 w-4" aria-hidden />
          </a>
        ) : (
          <span className="text-xs text-aviso">sem link</span>
        )}
      </div>

      {aberto && (
        <div className="col-span-full space-y-2 rounded-campo bg-superficie-2 px-4 py-2.5 text-sm">
          {barreiras.length > 0 ? (
            <p className="flex items-start gap-1.5 text-aviso">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" aria-hidden />
              <span>{barreiras.join(' · ')}</span>
            </p>
          ) : (
            <p className="text-sucesso">Sem login e sem CAPTCHA conhecidos.</p>
          )}

          <div>
            <p className="mb-1 font-semibold text-texto">O que o portal pede:</p>
            {insumos.length > 0 ? (
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-0.5 text-corpo">
                {insumos.map((x) => (
                  <div key={x.chave} className="contents">
                    <dt className="text-texto-3">{x.rotulo}</dt>
                    <dd className="flex min-w-0 flex-wrap items-center gap-1 text-texto">
                      {x.valor ? (
                        <>
                          <span className="tabular-nums">{x.valor}</span>
                          <button
                            type="button"
                            onClick={() => copiar(x.valor, x.chave)}
                            className={LINK_BTN}
                          >
                            {copiado === x.chave ? 'copiado' : 'copiar'}
                          </button>
                        </>
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
              <p className="text-texto-3">Nada declarado no catálogo.</p>
            )}
          </div>

          {faltando.length > 0 && (
            <p className="text-perigo">
              Não dá para emitir ainda: falta {faltando.map((x) => x.rotulo).join(', ')}.
            </p>
          )}

          {cat?.validade_dias && (
            <p className="text-xs text-texto-3">
              Validade: {cat.validade_dias} dias
              {cat.sla_horas ? ` · sai em até ${cat.sla_horas}h` : ''}
            </p>
          )}

          {/* SEM LINK: o endereço desta certidão depende da UF, do município ou da
              comarca, e cadastrar 54 links sem conferir cada um seria pior que não
              ter — link errado manda a pessoa para o lugar errado. Então quem
              precisa pela primeira vez cola aqui, e da segunda em diante aparece
              pronto para todo mundo. */}
          {!url && escopo && (
            <div className="space-y-2">
              <p className="text-texto-2">
                O link desta certidão depende de <b className="text-texto">{escopo}</b>, e ainda
                não está cadastrado. Cole o endereço oficial e ele passa a aparecer
                aqui para todos os créditos deste escopo:
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
              Esta certidão não tem link no catálogo e não tem escopo (UF, município
              ou comarca) para cadastrar um. Emissão manual, procurando o portal.
            </p>
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
    return vazio ? <p className="text-xs text-texto-3">{vazio}</p> : null
  }
  return (
    <div>
      {nascimentos.length > 0 && (
        <>
          <p className="mt-2 text-xs text-texto-2">
            <b className="text-texto">Data de nascimento do cedente</b> — só datas rotuladas como
            nascimento entram, senão a lista viria com toda data do processo:
          </p>
          <div className="my-2 grid gap-2">
            {nascimentos.map((n) => (
              <button
                key={n.iso}
                type="button"
                onClick={() => onNascimento(n.iso)}
                className={CAND}
              >
                <b className="font-bold tabular-nums">{n.iso.split('-').reverse().join('/')}</b>
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
            <b className="text-texto">Cidade e UF do cedente</b> — conferidas contra a lista do
            IBGE. Clicar preenche as duas juntas:
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
  // A LEITURA DA IA sobre os autos (dd-qualificacao): o cadastro inteiro, com o
  // trecho de onde saiu cada campo.
  const [leituraIA, setLeituraIA] = useState<QualificacaoLida | null>(null)
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
    if (ativo) void recarregar()
  }, [ativo, recarregar])

  // O RECARREGAR DA EMISSÃO: só o checklist e o placar, sem o "Carregando…"
  // que desmonta a lista e sem mexer no formulário. É o que roda a cada minuto
  // enquanto a BullAI trabalha — o `recarregar` inteiro, ali, apagaria as marcações.
  const recarregarItens = useCallback(async () => {
    const [ri, rc] = await Promise.all([
      supabase.from('dd_certidao').select(SELECT_ITENS).eq('kommo_lead_id', leadId),
      supabase.from('v_dd_completude').select('*').eq('kommo_lead_id', leadId).maybeSingle(),
    ])
    if (!ri.error) setItens((ri.data ?? []) as unknown as ItemChecklist[])
    if (!rc.error) setCompletude((rc.data ?? null) as Completude | null)
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
  async function lerComIA() {
    const texto = arquivos
      .map((a) => a.texto ?? '')
      .filter((t) => t.trim())
      .join('\n\n===== PRÓXIMO ARQUIVO =====\n\n')
    if (!texto.trim()) return
    setLendoIA(true)
    try {
      const q = await invokeFunction<QualificacaoLida>('dd-qualificacao', {
        lead_id: leadId,
        titulo: tituloDoCard,
        texto,
        parcela: classificarParcelaCedida(lerTituloCard(tituloDoCard).parcelaCedida),
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
    // O parser de CPF preenche nascimento e endereço ao ver um CPF novo; com a
    // leitura da IA já feita, ele não tem o que acrescentar.
    if (c.cpf) cpfAplicado.current = c.cpf.valor
    setCedente((f) => {
      const n = { ...f }
      if (!n.nome.trim() && c.nome) n.nome = c.nome.valor
      if (!onlyDigits(n.cpf) && c.cpf) n.cpf = formatCpfCnpjInput(c.cpf.valor)
      if (!n.nascimento && c.nascimento) n.nascimento = c.nascimento.valor
      if (!n.uf && atual) {
        n.uf = atual.uf
        n.municipio = atual.municipio ? municipioDoIbge(atual.uf, atual.municipio) : ''
      }
      return n
    })
    if (c.cpf) feitos.push(`CPF ${formatCpfCnpjInput(c.cpf.valor)}`)
    if (c.nascimento) feitos.push(`nascimento ${c.nascimento.valor.split('-').reverse().join('/')}`)
    if (atual) feitos.push(`residência ${atual.municipio ? atual.municipio + '/' : ''}${atual.uf}`)
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
      feitos.push(`${anteriores.length} residência(s) anterior(es)`)
    }
    if (q.estado_civil) {
      const pede = PEDE_CONJUGE.has(q.estado_civil.valor)
      setTemConjuge(pede)
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
      setPreenchido(feitos)
    }
  }

  useEffect(() => {
    if (!ativo || carregando || !editando || sujeitos.length > 0 || lendoPdf || !temTexto) return
    if (leituraPedida.current === leadId) return
    leituraPedida.current = leadId
    void lerComIA()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ativo, carregando, editando, sujeitos.length, lendoPdf, temTexto, leadId])

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

  /**
   * A confirmação de remoção, numa janela da casa (a "Remover do crédito" da
   * amostra) em vez do `window.confirm`. O TEXTO É O MESMO, e a regra também:
   * sem o "sim" explícito, nada é gravado. `confirmado` só chega `true` pelo
   * botão da janela — o botão de gravar chama sem argumento.
   */
  const [confirmandoRemocao, setConfirmandoRemocao] = useState(false)

  async function salvarEGerar(confirmado = false) {
    if (problemas.length > 0) return

    if (impacto.sujeitos.length > 0 && !confirmado) {
      setConfirmandoRemocao(true)
      return
    }
    setConfirmandoRemocao(false)

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

      // O NOME DA MÃE, quando a IA o leu para ESTE CPF. O formulário não tem o
      // campo, e a BullAI o usa para separar homônimos; perder é pior que gravar
      // o que está escrito nos autos. Falha aqui não desfaz o cadastro.
      const mae = leituraIA?.cedente.nome_mae?.valor
      if (mae && leituraIA?.cedente.cpf?.valor === onlyDigits(cedente.cpf)) {
        await supabase
          .from('dd_sujeito')
          .update({ nome_mae: mae })
          .eq('kommo_lead_id', leadId)
          .eq('papel', 'CEDENTE')
          .is('nome_mae', null)
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

  return (
    <div>
      {/* OS ERROS VÊM PRIMEIRO, como na amostra: o que falhou ao ler é a primeira
          coisa a saber, antes de confiar no que está abaixo. */}
      {erro && (
        <CaixaDeAviso tom="perigo" role="alert" className="mb-4">
          {erro}
        </CaixaDeAviso>
      )}

      {erroMunicipios && (
        <CaixaDeAviso tom="perigo" className="mb-4">
          {erroMunicipios}
        </CaixaDeAviso>
      )}

      {erroLinks && (
        <CaixaDeAviso tom="aviso" className="mb-4">
          {erroLinks}
        </CaixaDeAviso>
      )}

      {/* A descrição era do modal e desceu para cá com ele: o painel divide a
          janela com outra aba, então o cabeçalho da janela não pode falar só de
          certidões. */}
      <p className="mb-4 text-corpo text-texto-3">
        {editando
          ? 'O checklist é montado por sujeito. Sem CPF e UF não há como saber quais certidões são exigidas.'
          : 'Checklist congelado no banco. A etapa documental só fecha com todas as obrigatórias em arquivo.'}
      </p>

      {carregando ? (
        <div className="py-8 text-center text-corpo text-texto-3">Carregando…</div>
      ) : editando ? (
        <div>
          {/* ---------------- o que achei nos anexos ---------------- */}
          {/* UMA CAIXA SÓ, a `.soft-box` da amostra: CPF, nascimento, cidade,
              estado civil e o texto colado de outra consulta são a mesma coisa —
              achados para conferir e clicar —, e ficam juntos. */}
          <CaixaSuave className="mb-3">
            <b className="text-texto">
              O que achei nos anexos do card
              {arquivos.length > 0 &&
                ` (${arquivos.length} arquivo${arquivos.length > 1 ? 's' : ''})`}
            </b>

            {/*
              ARQUIVO SEM TEXTO É DITO, não omitido.
              Petição digitalizada, foto de RG, comprovante escaneado: são IMAGEM,
              e o pdf.js extrai texto selecionável. Sem este aviso, o dado estaria
              no processo, a tela não acharia nada, e a leitura natural seria "o
              processo não tem" — que é falso. É a diferença entre "não consegui
              ler" e "não existe".
            */}
            {digitalizados.map((a, i) => (
              <DicaDeAviso key={`${a.nome}-${i}`}>
                <b>{a.nome || '(anexo sem nome)'}</b>
                {a.erro
                  ? ` — ${a.erro}`
                  : ` — ${a.paginas} página(s) com só ${a.densidade} caractere(s) ` +
                    `por página: é digitalização (o texto que tem é o rodapé de ` +
                    `assinatura do tribunal). Se o nascimento ou o endereço ` +
                    `estiverem só aí — foto de RG, comprovante de residência —, eu ` +
                    `não leio: abra o arquivo e digite.`}
              </DicaDeAviso>
            ))}
            {lendoPdf ? (
              <p className="mt-2 flex items-center gap-2">
                <RefreshCw className="h-[16px] w-[16px] animate-spin" aria-hidden />
                Lendo o PDF do card…
              </p>
            ) : candidatos.length > 0 ||
              doPdf.nascimentos.length > 0 ||
              doPdf.locais.length > 0 ||
              estadosCivis.length > 0 ||
              digitalizados.length > 0 ? (
              <>
                {/* A EXPLICAÇÃO VEM ANTES DA LISTA, como na amostra: quem lê
                    "escolher é seu" antes de ver os números não clica no primeiro
                    por reflexo. */}
                {candidatos.length > 0 && (
                  <p className="mt-2 text-xs text-texto-3">
                    Dígito verificador conferido. <b className="text-texto-2">Escolher é seu</b>: um
                    processo traz o CPF do cedente, do advogado e às vezes de terceiros —
                    o sistema não tem como saber qual é qual. A lista pode estar
                    incompleta: o PDF nem sempre entrega os números inteiros.
                  </p>
                )}
                {candidatos.length === 0 && (
                  <p className="mt-2 text-xs text-aviso">
                    Nenhum CPF de dígito válido no texto — digite o do cedente abaixo,
                    conferindo no processo. O que achei do resto está logo abaixo.
                  </p>
                )}
                {candidatos.length > 0 && (
                  <div className="my-2 grid gap-2">
                    {candidatos.map((c) => (
                      <button
                        key={c.cpf}
                        type="button"
                        onClick={() =>
                          alterar(setCedente)({ ...cedente, cpf: formatCpfCnpjInput(c.cpf) })
                        }
                        className={CAND}
                      >
                        <span className="flex flex-wrap items-center gap-2">
                          <b className="font-bold tabular-nums">{formatCpfCnpjInput(c.cpf)}</b>
                          {c.rotulado && <Selo tom="info">rotulado &quot;CPF&quot;</Selo>}
                        </span>
                        <span className={SUB}>
                          {c.arquivo ? `em ${c.arquivo} · ` : ''}…{c.contexto}…
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {(doPdf.nascimentos.length > 0 || doPdf.locais.length > 0) && (
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
                )}

                {/*
                  ESTADO CIVIL: é o que DOBRA o checklist.
                  Cedente casado tem bloco próprio de certidões para o cônjuge
                  (planilha, linhas 52 a 67). Deixar de marcar fecha o dossiê com
                  esse bloco inteiro faltando, e o placar não acusa nada — por isso
                  a sugestão fica aqui, na caixa dos achados junto com o CPF, e não
                  escondida na caixinha lá embaixo.
                */}
                {estadosCivis.length > 0 && (
                  <>
                    <p className="mt-2 text-xs text-texto-2">
                      <b className="text-texto">Estado civil</b> na qualificação das partes —
                      clicar já liga ou desliga o bloco do cônjuge:
                    </p>
                    <div className="my-2 grid gap-2">
                      {estadosCivis.map((e) => (
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
                      A petição pode ser antiga: &quot;casada&quot; naquela data não
                      é &quot;casada hoje&quot;. Confirme antes de gerar o checklist.
                    </p>
                  </>
                )}
              </>
            ) : avisoPdf ? (
              <DicaDeAviso>{avisoPdf}</DicaDeAviso>
            ) : temTexto ? (
              // Só se pode afirmar isto DEPOIS de ler o PDF. Sem texto, o certo é
              // dizer que não leu — não que o documento não tem CPF.
              <p className="mt-2 text-xs">
                Li o PDF e não achei nenhum CPF de dígito válido no texto. Pode ser que o
                documento traga o número partido de um jeito que a busca não pega — digite
                abaixo, conferindo no processo.
              </p>
            ) : (
              <p className="mt-2 text-xs">
                O PDF do card ainda não foi lido. Digite o CPF conferindo no processo.
              </p>
            )}

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
            <details className="mt-2.5 text-corpo">
              <summary className="cursor-pointer font-semibold text-marca-texto">
                Colar resultado de outra consulta (Date Solutions, etc.)
              </summary>
              <Textarea
                value={colado}
                onChange={(e) => setColado(e.target.value)}
                rows={3}
                aria-label="Resultado de outra consulta"
                className="mt-2.5"
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
              <p className="mt-2 text-xs text-texto-3">
                Este texto NÃO é gravado. Só os campos em que você clicar entram no
                cadastro — o resto morre quando a janela fecha.
              </p>
            </details>
          </CaixaSuave>

          {/* ---------------- leitura da IA ---------------- */}
          {/* A `.ai-box` da amostra: o ícone, o que a IA fez (e os avisos dela) e
              o botão à direita. O BOTÃO FICA À VISTA LENDO, desabilitado com
              "Lendo…" — antes sumia, e a caixa parecia ter perdido a ação. */}
          {(lendoIA || leituraIA || temTexto) && (
            <div className="my-3 flex items-start gap-2.5 rounded-campo border border-info-borda bg-marca-leve p-4 text-corpo">
              <Sparkles className="mt-0.5 h-[16px] w-[16px] flex-none text-marca-texto" aria-hidden />
              <div className="min-w-0 flex-1">
                <b className="text-texto">
                  {lendoIA
                    ? 'A IA está lendo a qualificação nos autos…'
                    : leituraIA
                      ? 'Cadastro lido dos autos pela IA — confira antes de gravar'
                      : 'A IA pode ler a qualificação do cedente nos autos'}
                </b>
                {(leituraIA?.avisos ?? []).map((a) => (
                  <DicaDeAviso key={a}>{a}</DicaDeAviso>
                ))}
                {leituraIA && (
                  <details className="mt-2 text-corpo text-texto-2">
                    <summary className="cursor-pointer font-semibold text-marca-texto">
                      De onde saiu cada campo
                    </summary>
                    <ul className="mt-2 space-y-1.5 text-xs">
                      {(
                        [
                          ['Nome', leituraIA.cedente.nome],
                          ['CPF', leituraIA.cedente.cpf],
                          ['Nascimento', leituraIA.cedente.nascimento],
                          ['Mãe', leituraIA.cedente.nome_mae],
                          ['Estado civil', leituraIA.estado_civil],
                          ['Cônjuge', leituraIA.conjuge?.nome ?? null],
                          ['CPF do cônjuge', leituraIA.conjuge?.cpf ?? null],
                        ] as [string, { valor: string; evidencia: string } | null][]
                      )
                        .filter(([, v]) => v)
                        .map(([rotulo, v]) => (
                          <li key={rotulo}>
                            <b className="text-texto">{rotulo}:</b> {v!.valor}
                            {v!.evidencia && <span className="text-texto-3"> — “{v!.evidencia}”</span>}
                          </li>
                        ))}
                      {leituraIA.residencias.map((r) => (
                        <li key={`${r.uf}|${r.municipio}`}>
                          <b className="text-texto">
                            {r.atual ? 'Residência atual' : 'Residência anterior'}:
                          </b>{' '}
                          {r.municipio ? `${r.municipio}/` : ''}
                          {r.uf}
                          {r.evidencia && <span className="text-texto-3"> — “{r.evidencia}”</span>}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
              {temTexto && (
                <Button
                  variant="secondary"
                  onClick={() => void lerComIA()}
                  disabled={lendoIA}
                  icon={
                    lendoIA ? (
                      <RefreshCw className="h-4 w-4 animate-spin" aria-hidden />
                    ) : undefined
                  }
                >
                  {lendoIA ? 'Lendo…' : leituraIA ? 'Ler de novo' : 'Ler com a IA'}
                </Button>
              )}
            </div>
          )}

          {preenchido.length > 0 && (
            <CaixaDeAviso tom="sucesso" className="mb-3">
              Preenchi a partir do processo: <b>{preenchido.join(' · ')}</b>.
              Confira antes de gerar — o trecho de onde saiu cada um está no painel
              acima.{' '}
              {leituraIA?.cedente.cpf
                ? 'O CPF só entrou porque está escrito nos autos — confira se é mesmo de quem cede.'
                : 'O CPF eu nunca preencho sozinho.'}
            </CaixaDeAviso>
          )}

          {/* ---------------- cedente ---------------- */}
          <div>
            <RotuloDeSecao className="mt-6">Cedente</RotuloDeSecao>
            <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
              <Field label="Nome completo" required className="sm:col-span-2">
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
          {/* AS RESIDÊNCIAS ANTERIORES SEMPRE À VISTA, ao lado da caixa, e não
              atrás dela: "não sei se morou em outro estado" e "não morou" são
              respostas diferentes, e os campos valem marcados ou não. */}
          <CaixaSuave aviso className="mt-4">
            <label className="inline-flex min-h-8 cursor-pointer items-center gap-2 text-corpo text-texto">
              <input
                type="checkbox"
                className={CAIXA_MARCAR}
                checked={residenciaLevantada}
                onChange={(e) => alterar(setResidenciaLevantada)(e.target.checked)}
              />
              Levantei o histórico de residência do cedente
            </label>
            <p className="mt-1 text-xs text-texto-3">
              Deixe desmarcado se não conferiu. &quot;Não sei se morou em outro
              estado&quot; e &quot;não morou&quot; são respostas diferentes, e a segunda
              dispensa certidão que a primeira não dispensa. Vale só para o cedente: o
              cônjuge entra sempre como não levantado, porque esta tela não pergunta o
              histórico dele.
            </p>
            <div className="mt-2.5 grid gap-x-5 gap-y-4 sm:grid-cols-2">
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
          </CaixaSuave>

          {/* ---------------- cônjuge ---------------- */}
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
            <p className="ml-[24px] mt-0.5 text-xs text-texto-3">
              A planilha dá bloco próprio de certidões ao cônjuge (linhas 52 a 67).
              Sem isto, o checklist fecha completo com esse bloco inteiro faltando.
              Desmarcar REMOVE o cônjuge já cadastrado e as certidões dele.
            </p>
            {temConjuge && (
              <div className="mt-3 grid gap-x-5 gap-y-4 sm:grid-cols-2">
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
            <CaixaDeAviso tom="perigo" className="mt-4">
              Gravar assim REMOVE{' '}
              {impacto.sujeitos.map((s) => `${s.papel} ${s.nome}`).join(', ')} e apaga{' '}
              {impacto.certidoes} item(ns) do checklist
              {impacto.obtidas > 0 && (
                <>
                  , dos quais <b>{impacto.obtidas} já obtida(s)</b>
                </>
              )}
              . Vai pedir confirmação.
            </CaixaDeAviso>
          )}

          {/* O `.erros-lista` da amostra: o que falta para gravar, em vermelho e
              com ícone — é o motivo de o botão abaixo estar desabilitado. */}
          {problemas.length > 0 && (
            <ul className="mt-4 grid gap-1">
              {problemas.map((p) => (
                <li key={p} className="flex items-start gap-1.5 text-corpo text-perigo">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" aria-hidden />
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div>
          {/* ---------------- placar ---------------- */}
          {/* Os `.kpis.five` da amostra: cinco cartões de número. */}
          {completude && (
            <div className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-5">
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
                <StatCard key={c.r} label={c.r} value={c.v} />
              ))}
            </div>
          )}

          {completude && completude.necessarias > 0 && (
            <p className="mb-2 text-corpo text-texto">
              {completude.obtidas_validas === completude.necessarias ? (
                <span className="font-semibold text-sucesso">
                  ✅ Documental completa — {completude.obtidas_validas} de{' '}
                  {completude.necessarias}
                  {completude.dispensadas > 0 && (
                    <span className="text-aviso">
                      {' '}
                      · {completude.dispensadas} dispensada(s) fora da conta
                    </span>
                  )}
                  .
                </span>
              ) : (
                <span className="inline-flex items-start gap-1.5">
                  <Clock className="mt-0.5 h-[16px] w-[16px] flex-none text-aviso" aria-hidden />
                  <span>
                    {completude.obtidas_validas} de {completude.necessarias} obtidas. A
                    etapa documental não fecha até chegar a {completude.necessarias}.
                  </span>
                </span>
              )}
            </p>
          )}

          {/* ---------------- avisos ---------------- */}
          {/* O `.avisos-placar` da amostra: uma lista âmbar, um aviso por item. */}
          {avisos.length > 0 && (
            <ul className="mb-3 mt-2 list-disc space-y-1 rounded-campo border border-aviso-borda bg-aviso-fundo py-3 pl-10 pr-4 text-corpo text-texto marker:text-aviso">
              {avisos.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
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
            // A `.ec-box` da amostra (estilo5.css): cabeçalho discreto, a resposta,
            // o trecho do documento e a ação.
            <div className="my-3 grid gap-2.5 rounded-campo border border-borda bg-superficie-2 px-[14px] py-3 text-corpo text-texto">
              <div className="flex items-center gap-2 text-sm text-texto-2">
                <FileText className="h-[16px] w-[16px] flex-none" aria-hidden />
                <b>Estado civil, segundo os anexos do card</b>
                {arquivos.length > 0 && (
                  <span className="text-xs text-texto-3">
                    ({arquivos.length} arquivo{arquivos.length > 1 ? 's' : ''})
                  </span>
                )}
              </div>

              {lendoPdf ? (
                <p className="text-xs text-texto-3">Lendo os anexos do card…</p>
              ) : respostaEstadoCivil.ancorado ? (
                <>
                  <p>
                    O processo qualifica{' '}
                    <b>{sujeitos.find((s) => s.papel === 'CEDENTE')?.nome ?? 'o cedente'}</b>{' '}
                    como{' '}
                    <b className="text-marca-texto">
                      {ROTULO_ESTADO_CIVIL[respostaEstadoCivil.ancorado.estado] ??
                        respostaEstadoCivil.ancorado.estado}
                    </b>
                    {respostaEstadoCivil.ancorado.conjuge && (
                      <>
                        , cônjuge <b>{respostaEstadoCivil.ancorado.conjuge}</b>
                      </>
                    )}
                    .
                  </p>
                  <div className="rounded-controle border border-borda bg-superficie px-3 py-2.5 text-sm text-texto-2">
                    …{respostaEstadoCivil.ancorado.contexto}…
                    {respostaEstadoCivil.ancorado.arquivo && (
                      <span className="mt-0.5 block text-xs text-texto-3">
                        em {respostaEstadoCivil.ancorado.arquivo}
                      </span>
                    )}
                  </div>

                  {PEDE_CONJUGE.has(respostaEstadoCivil.ancorado.estado) ? (
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 rounded-controle border border-aviso-borda bg-aviso-fundo px-3 py-2.5 text-sm text-aviso">
                      <AlertTriangle className="h-[16px] w-[16px] flex-none" aria-hidden />
                      <span className="min-w-0 flex-[1_1_260px] text-texto">
                        Então faltam as certidões do cônjuge — o bloco das linhas 52 a
                        67 da planilha. O placar acima <b>não</b> conta essa
                        falta.
                      </span>
                      <Button
                        className="ml-auto"
                        onClick={() =>
                          cadastrarConjugeCom(respostaEstadoCivil.ancorado!)
                        }
                        disabled={salvando}
                        icon={<Pencil className="h-4 w-4" aria-hidden />}
                      >
                        Cadastrar o cônjuge
                      </Button>
                    </div>
                  ) : (
                    <p className="text-xs">
                      Sem cônjuge, o bloco de certidões dele não se aplica — e o aviso
                      acima está respondido. <b>Confira mesmo assim</b>: o
                      documento pode ser de anos atrás, e estado civil muda.
                    </p>
                  )}
                </>
              ) : respostaEstadoCivil.soltos.length > 0 ? (
                <>
                  {/*
                    Achei estado civil, mas NÃO consegui prendê-lo ao cedente. Numa
                    petição, a qualificação do advogado e a da parte contrária ficam
                    a poucos caracteres da do autor — oferecer isso como resposta
                    seria trocar "é do cedente" por "estava por perto". O trecho
                    aparece para a pessoa julgar; o sistema não julga.
                  */}
                  <p className="text-xs text-aviso">
                    Achei estado civil no processo, mas{' '}
                    <b>não consegui ligar ao nome nem ao CPF do cedente</b> —
                    numa petição isso costuma ser do advogado ou da outra parte. Leia o
                    trecho antes de usar:
                  </p>
                  {respostaEstadoCivil.soltos.slice(0, 3).map((e) => (
                    <div
                      key={`${e.estado}-${e.conjuge ?? ''}`}
                      className="rounded-controle border border-borda bg-superficie px-3 py-2.5 text-sm text-texto-2"
                    >
                      <b className="text-texto">{ROTULO_ESTADO_CIVIL[e.estado] ?? e.estado}</b>
                      {e.arquivo && (
                        <span className="ml-1.5 text-xs text-texto-3">em {e.arquivo}</span>
                      )}
                      <span className="mt-0.5 block">…{e.contexto}…</span>
                    </div>
                  ))}
                  <Button
                    variant="secondary"
                    className="justify-self-start"
                    onClick={() => setEditando(true)}
                    disabled={salvando}
                    icon={<Pencil className="h-4 w-4" aria-hidden />}
                  >
                    Abrir o cadastro para decidir
                  </Button>
                </>
              ) : (
                <>
                  {/*
                    NÃO ACHEI ≠ NÃO É CASADA. É a regra da casa desde o começo, e o
                    lugar onde ela mais importa é justamente este: a leitura natural
                    de uma tela calada é "então não tem cônjuge", que fecha o dossiê
                    com um bloco inteiro faltando.
                  */}
                  <p className="text-xs text-aviso">
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
                    <b>&quot;Não achei&quot; não é &quot;não é casada&quot;</b>{' '}
                    — confira a petição inicial e cadastre à mão.
                  </p>
                  {digitalizados.length > 0 && (
                    <p className="text-xs text-aviso">
                      E {digitalizados.length} anexo(s) são digitalização ou não
                      abriram:{' '}
                      <b>{digitalizados.map((a) => a.nome).join(', ')}</b>. Se
                      a qualificação estiver só aí, ela está em imagem — e imagem eu
                      ainda não leio.
                    </p>
                  )}
                  <Button
                    variant="secondary"
                    className="justify-self-start"
                    onClick={() => setEditando(true)}
                    disabled={salvando}
                    icon={<Pencil className="h-4 w-4" aria-hidden />}
                  >
                    Cadastrar à mão
                  </Button>
                </>
              )}
            </div>
          )}

          {/* ---------------- lista por sujeito ---------------- */}
          {sujeitos.map((s) => {
            const lista = porSujeito.get(s.id) ?? []
            // O `.subj` da amostra: um bloco contornado por pessoa, com a faixa
            // de cabeçalho (papel, nome, documento, onde mora, quantos itens).
            return (
              <div key={s.id} className="my-3 overflow-hidden rounded-cartao border border-borda">
                <div className="flex flex-wrap items-center gap-2 border-b border-borda bg-superficie-2 px-4 py-3 text-corpo">
                  <Selo tom="info">{s.papel}</Selo>
                  <b className="font-bold text-texto">{s.nome}</b>
                  <span className="tabular-nums text-texto-3">
                    {formatCpfCnpjInput(s.documento)} ·{' '}
                    {s.municipio_atual ? `${s.municipio_atual}/` : ''}
                    {s.uf_atual ?? 'sem UF'} · {lista.length} item(ns)
                  </span>
                  {!s.residencia_levantada && (
                    <Selo tom="aviso" icone={<AlertTriangle className={icSelo} aria-hidden />}>
                      residência não levantada
                    </Selo>
                  )}
                </div>
                <div>
                  {lista.length === 0 ? (
                    <p className="px-4 py-2 text-xs text-texto-3">
                      Nenhuma certidão gerada para este sujeito.
                    </p>
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

          {sujeitos.length > 0 && itens.length > 0 && (
            <EmissaoBullai
              leadId={leadId}
              sujeitos={sujeitos}
              itens={itens}
              ativo={ativo}
              onMudou={() => void recarregarItens()}
            />
          )}

          {sujeitos.length === 0 && (
            <CaixaSuave>
              Nenhum sujeito cadastrado neste crédito. Clique em{' '}
              <b>Corrigir dados / cônjuge</b> para começar pelo cedente.
            </CaixaSuave>
          )}
        </div>
      )}

      {/* AS AÇÕES FICAM NO PAINEL, não no rodapé da janela. Eram do modal, e o
          rodapé agora é dividido com a aba de Processos Judiciais: "Gravar e
          montar checklist" ali embaixo pareceria valer para a janela toda. */}
      <div className="mt-6 flex flex-wrap items-center justify-end gap-2.5 border-t border-borda pt-5">
        {editando ? (
          <Button
            // SEM ARGUMENTO, de propósito: o `true` de salvarEGerar é o "sim" da
            // janela de remoção, e o evento do clique não pode passar por ele.
            onClick={() => void salvarEGerar()}
            loading={salvando}
            disabled={problemas.length > 0}
            icon={<Sparkles className="h-4 w-4" aria-hidden />}
          >
            Gravar e montar checklist
          </Button>
        ) : (
          <>
            <Button
              variant="secondary"
              onClick={() => setEditando(true)}
              disabled={salvando}
              icon={<Pencil className="h-4 w-4" aria-hidden />}
            >
              Corrigir dados / cônjuge
            </Button>
            <Button
              variant="outline"
              onClick={gerarFaltantes}
              loading={salvando}
              icon={<Plus className="h-4 w-4" aria-hidden />}
            >
              Gerar itens faltantes
            </Button>
          </>
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
