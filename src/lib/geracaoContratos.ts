// Regras de TELA da Geração de contratos (onda 2 do redesenho): o que falta para
// gerar e os nomes em português das peças e das variáveis.
//
// A TRADUÇÃO É SÓ DE TELA. A função gerar-contrato recebe e devolve as chaves
// (`cessao_credito`, `CEDENTE_NACIONALIDADE`), e o que vai para ela continua
// sendo a chave — só o que a pessoa lê muda.
import { TIPO_CONTRATO } from './labels'

/** As peças que a escolha à mão oferece, na ordem da tela. */
export const PECAS_DO_CONTRATO = [
  'cessao_credito',
  'cessao_honorarios_contratuais',
  'cessao_honorarios_sucumbenciais',
  'intermediacao',
  'procuracao',
] as const

/** "cessao_credito" → "Cessão de crédito". Chave desconhecida sai como veio. */
export function nomeDaPeca(chave: string): string {
  return TIPO_CONTRATO[chave]?.label ?? chave
}

/** Nomes fixos das variáveis que a função preenche (supabase/functions/gerar-contrato). */
const VARIAVEIS: Record<string, string> = {
  INVESTIDOR_NOME: 'nome do investidor',
  INVESTIDOR_CPF: 'CPF/CNPJ do investidor',
  INVESTIDOR_QUALIFICACAO: 'qualificação do investidor',
  I_QL: 'qualificação do investidor',
  ESCRITORIO_NOME: 'razão social do escritório',
  ESCRITORIO_CNPJ: 'CNPJ do escritório',
  ESCRITORIO_SOCIO_NOME: 'nome do sócio responsável',
  NUMERO_PROCESSO: 'número do processo',
  VALOR_CREDITO_TOTAL: 'valor total do crédito',
  PERCENTUAL_HONORARIOS: 'percentual de honorários',
  VALOR_HONORARIOS: 'valor dos honorários',
  VALOR_CESSAO: 'valor da cessão',
  DATA_EXTENSO: 'data por extenso',
  JUIZO_TRIBUNAL: 'juízo e tribunal',
  CLASSE_ATIVO: 'classe do ativo',
  CAPITAL_INVESTIDO: 'capital investido',
  NEGOCIAR_CREDITO_PRINCIPAL: 'se o crédito principal é negociado',
  NEGOCIAR_HONORARIOS_CONTRATUAIS: 'se os honorários contratuais são negociados',
  NEGOCIAR_HONORARIOS_SUCUMBENCIAIS: 'se os honorários sucumbenciais são negociados',
}

/**
 * De quem é a variável, pelo prefixo. ORDEM DELIBERADA: o sócio antes do
 * escritório, senão ESCRITORIO_SOCIO_CPF sairia "socio cpf do escritório".
 */
const DONOS: [prefixo: string, dono: string][] = [
  ['INVESTIDOR_', 'do investidor'],
  ['CEDENTE_', 'do cedente'],
  ['ESCRITORIO_SOCIO_', 'do sócio responsável'],
  ['ESCRITORIO_', 'do escritório'],
]

/** Palavras que perdem o acento na chave (a chave só tem A-Z e "_"). */
const ACENTOS: Record<string, string> = {
  ENDERECO: 'endereço',
  PROFISSAO: 'profissão',
  NUMERO: 'número',
  AGENCIA: 'agência',
  SOCIO: 'sócio',
  ESCRITORIO: 'escritório',
  CESSAO: 'cessão',
  HONORARIOS: 'honorários',
  JUIZO: 'juízo',
  RAZAO: 'razão',
  QUALIFICACAO: 'qualificação',
  ORGAO: 'órgão',
  EMISSAO: 'emissão',
  CODIGO: 'código',
  REGIAO: 'região',
  PRECATORIO: 'precatório',
}

/** Siglas que ficam em maiúsculas. */
const SIGLAS = new Set(['CPF', 'CNPJ', 'RG', 'CEP', 'PIX', 'OAB', 'UF', 'RPV'])

const palavra = (p: string) =>
  SIGLAS.has(p) ? (p === 'PIX' ? 'Pix' : p) : (ACENTOS[p] ?? p.toLowerCase())

/**
 * "CEDENTE_NACIONALIDADE" → "nacionalidade do cedente".
 *
 * OS MODELOS .docx PODEM TER QUALQUER {{VARIÁVEL}} — a função pede à IA as que
 * achar nos modelos —, então a lista fixa acima não cobre tudo. O que não está
 * nela é montado pelo prefixo (de quem é) e pelas palavras da chave. Chave que
 * não se deixa ler assim (os marcadores de gênero de uma letra, por exemplo)
 * SAI COMO VEIO: um nome inventado esconderia qual campo do modelo ficou vazio.
 */
export function nomeDaVariavel(chave: string): string {
  const fixo = VARIAVEIS[chave]
  if (fixo) return fixo
  for (const [prefixo, dono] of DONOS) {
    if (chave.startsWith(prefixo) && chave.length > prefixo.length) {
      const resto = chave.slice(prefixo.length).split('_').filter(Boolean)
      if (resto.length) return `${resto.map(palavra).join(' ')} ${dono}`
    }
  }
  return chave
}

/** Os dois grupos de documentos do passo 2, como a função os lê no bucket. */
export type PapelDoDocumento = 'cedente' | 'escritorio'

/**
 * O nome do arquivo como vai para o bucket: o Storage rejeita nome acentuado —
 * mesma sanitização do app de origem (controledecessoes).
 */
export function nomeArquivoSeguro(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w.\-()]/g, '_')
}

/**
 * Onde cada documento escolhido é gravado no bucket `contratos`:
 * `{user_id}/{job_id}/{papel}/<arquivo>`, a convenção que a função gerar-contrato
 * lista e que a policy do Storage espera.
 *
 * NOME ÚNICO DENTRO DE CADA PAPEL. O envio é com `upsert`, então dois documentos
 * com o mesmo nome — dois "RG.pdf" de pastas diferentes, ou "Contrato á.pdf" e
 * "Contrato a.pdf", que a sanitização torna iguais — gravavam no MESMO caminho, e
 * o segundo apagava o primeiro sem aviso: a função lia (e arquivava no Drive) um
 * documento a menos do que a tela listava. O repetido ganha "_(2)", "_(3)" antes
 * da extensão; o nome que não repete sai exatamente como antes.
 *
 * `jobId` é de UMA tentativa — ver o envio em GeracaoContratos.tsx.
 */
export function caminhosDosEnvios(
  userId: string,
  jobId: string,
  uploads: Record<PapelDoDocumento, ReadonlyArray<{ name: string }>>,
): { papel: PapelDoDocumento; indice: number; caminho: string }[] {
  const saida: { papel: PapelDoDocumento; indice: number; caminho: string }[] = []
  for (const papel of ['cedente', 'escritorio'] as const) {
    const usados = new Set<string>()
    uploads[papel].forEach((arquivo, indice) => {
      const seguro = nomeArquivoSeguro(arquivo.name)
      let nome = seguro
      const ponto = seguro.lastIndexOf('.')
      const base = ponto > 0 ? seguro.slice(0, ponto) : seguro
      const ext = ponto > 0 ? seguro.slice(ponto) : ''
      for (let n = 2; usados.has(nome.toLowerCase()); n++) nome = `${base}_(${n})${ext}`
      // Sem distinção de caixa: "RG.pdf" e "rg.PDF" viram o mesmo arquivo no Drive
      // de quem abre no Windows.
      usados.add(nome.toLowerCase())
      saida.push({ papel, indice, caminho: `${userId}/${jobId}/${papel}/${nome}` })
    })
  }
  return saida
}

/**
 * O que falta para liberar "Gerar contrato" — o mesmo critério do botão da
 * plataforma (investidor, originador, número do processo e, na escolha à mão,
 * ao menos uma peça), dito em palavras para o resumo lateral.
 *
 * A PEÇA ENTRA NA LISTA porque a escolha à mão sem peça nenhuma não pode ir: a
 * função lê lista vazia como "escolha automática" e geraria as peças da análise.
 */
export function faltaParaGerar(f: {
  investidor: string
  originador: string
  numeroProcesso: string
  automatico: boolean
  pecas: ReadonlySet<string>
}): string[] {
  const falta: string[] = []
  if (!f.investidor) falta.push('investidor')
  if (!f.originador) falta.push('originador')
  if (!f.numeroProcesso.trim()) falta.push('número do processo')
  if (!f.automatico && f.pecas.size === 0) falta.push('ao menos uma peça')
  return falta
}
