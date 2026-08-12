// Descobre no Drive pastas de crédito que ainda NÃO estão cadastradas na
// plataforma, para alimentar a aba "Automatizado" da janela de novo crédito.
//
// A ORDEM DO TRABALHO É ESTA, e é o que torna a aba possível: a pasta do crédito
// é criada e os documentos entram nela ANTES de o crédito ser lançado aqui. Então,
// no momento do cadastro, a pasta já existe e já tem o que ler.
//
// A árvore de B. Processos (a mesma que as petições percorrem):
//
//   B. Processos
//   └── Precatórios | Requisições de Pequeno Valor      (espécie)
//       └── Intermediador - NOME                        (originador)
//           └── CEDENTE - CNJ   (hoje)                  ← o crédito
//               ou CEDENTE      (convenção antiga)
//               └── 1..7 subpastas numeradas
//
// DUAS CONVENÇÕES DE NOME, e a diferença muda a confiança do resultado:
//   • hoje se escreve "nome do cedente - número do processo". Tendo o CNJ, o
//     cotejo com o que já está cadastrado é por DÍGITO, e é sólido.
//   • antigamente era só o nome do cedente, e o número só aparecia quando o mesmo
//     cedente tinha mais de um crédito. Aí o cotejo é por nome, com a fragilidade
//     de sempre — daí a tela falar em CANDIDATOS, e não em "créditos novos".
import { onlyDigits, normalizarNome } from './format'
import { baixarArquivo, listarArquivos, listarSubpastas, PASTA_PROCESSOS } from './drive'
import { textoDeArquivo } from './textoDeArquivo'
import { PASTA_DA_ESPECIE, nomeDePasta } from './peticaoPasta'
import type { EspecieRequisitorio, Processo } from './types'

/**
 * As sete subpastas de dentro do crédito ("1. Análise(s) de crédito" etc.).
 *
 * Precisam ser reconhecidas e IGNORADAS na varredura, porque nem toda pasta está
 * onde deveria: em `Intermediador - Hebert` existe uma `5. Petições` solta no
 * nível do originador, criada em 20/07/2026 — uma peça salva um nível acima do
 * lugar. Sem este filtro, ela seria oferecida como crédito novo.
 *
 * O reconhecimento é pelo NÚMERO seguido de ponto, que é a parte estável da
 * convenção: renomear "5. Petições" para "5. Peças" não pode reintroduzir o erro.
 */
const RE_SUBPASTA_NUMERADA = /^\s*\d+\s*\./

/**
 * O número de processo dentro do nome da pasta, se houver.
 *
 * Casa o formato CNJ com ou sem pontuação, porque as pastas variam. Não usa
 * `onlyDigits` no nome inteiro: nome de cedente pode ter número (um "II", um ano),
 * e aí a contagem de dígitos enganaria.
 */
const RE_CNJ = /\d{7}-?\d{2}\.?\d{4}\.?\d\.?\d{2}\.?\d{4}/

/**
 * O nome do originador sem o prefixo da pasta, PRESERVANDO acento e caixa.
 *
 * Existe separado de `nomeDePasta` porque aquela normaliza para COMPARAR — devolve
 * "hebert rogerio arantes mateus". Aqui o nome vai para dentro de um campo do
 * cadastro, e gravar tudo minúsculo e sem acento sujaria o dado.
 */
const RE_PREFIXO_ORIGINADOR = /^\s*(?:intermediador|originador)\s*-\s*/i

export function originadorDoNome(bruto: string): string {
  return bruto.replace(RE_PREFIXO_ORIGINADOR, '').trim()
}

export interface PastaCredito {
  /** Id da pasta do crédito no Drive. Vira o atalho gravado no cadastro. */
  id: string
  /** Nome cru, como está no Drive. */
  nome: string
  especie: EspecieRequisitorio
  /** Originador já sem o prefixo "Intermediador - ". */
  originador: string
  /** CNJ formatado como está no nome, ou null na convenção antiga. */
  cnj: string | null
  /** O que sobra do nome depois de tirar o CNJ — o cedente, quando dá. */
  cedente: string | null
  /** ["Precatórios", "Intermediador - X"] — para a tela mostrar de onde veio. */
  caminho: string[]
}

/** Separa o nome da pasta em CNJ e cedente. */
export function lerNomeDaPasta(nome: string): {
  cnj: string | null
  cedente: string | null
} {
  const achado = nome.match(RE_CNJ)
  const cnj = achado ? achado[0] : null
  // Tira o número e o separador que sobrou nas pontas. O separador é " - ", que
  // não aparece dentro de nome de pessoa — é o que permite cortar sem adivinhar.
  const resto = (cnj ? nome.replace(cnj, '') : nome)
    .replace(/\s*-\s*$/, '')
    .replace(/^\s*-\s*/, '')
    .trim()
  return { cnj, cedente: resto || null }
}

/**
 * Percorre a árvore e devolve TODAS as pastas de crédito que existem no Drive.
 *
 * São 1 + 2 + (um por originador) chamadas — hoje, umas 14. Sequencial de
 * propósito: o Drive é acessado com a conta de quem está usando, e uma rajada de
 * requisições paralelas só serve para irritar limite de taxa (foi o que custou
 * caro na sincronização do DJEN).
 */
export async function listarPastasDeCredito(): Promise<PastaCredito[]> {
  const encontradas: PastaCredito[] = []
  const naRaiz = await listarSubpastas(PASTA_PROCESSOS)

  for (const [especie, rotulo] of Object.entries(PASTA_DA_ESPECIE) as [
    EspecieRequisitorio,
    string,
  ][]) {
    const pastaEspecie = naRaiz.find((p) => nomeDePasta(p.nome) === nomeDePasta(rotulo))
    if (!pastaEspecie) continue

    for (const orig of await listarSubpastas(pastaEspecie.id)) {
      if (RE_SUBPASTA_NUMERADA.test(orig.nome)) continue
      for (const cred of await listarSubpastas(orig.id)) {
        if (RE_SUBPASTA_NUMERADA.test(cred.nome)) continue
        const { cnj, cedente } = lerNomeDaPasta(cred.nome)
        encontradas.push({
          id: cred.id,
          nome: cred.nome,
          especie,
          originador: originadorDoNome(orig.nome),
          cnj,
          cedente,
          caminho: [pastaEspecie.nome, orig.nome],
        })
      }
    }
  }
  return encontradas
}

/**
 * As subpastas de dentro do crédito que valem a leitura, pelo número do prefixo.
 *
 *   1. Análise(s) de crédito       — a fonte mais rica: tribunal, valor de face,
 *                                    entidade devedora, expectativa de liquidação
 *   2. Contratos assinados         — cessionário, data de aquisição, capital
 *   4. Documentos do cedente e advogado — qualificação do cedente
 *
 * As outras ficam de fora de propósito: comprovantes de pagamento (3), petições
 * geradas (5), desempenho final (6) e RPV complementar (7) são consequência do
 * crédito, não a origem dos dados dele — e mandá-las à IA custaria tokens para
 * confundir a leitura com texto que fala do mesmo processo em outro momento.
 */
const PASTAS_COM_DADOS = [1, 2, 4]

/** Teto do total mandado à IA, somando todos os arquivos. */
const MAX_CHARS_TOTAL = 400_000

export interface DocumentoLido {
  /** Nome da subpasta, para a tela dizer de onde saiu cada campo. */
  pasta: string
  nome: string
  texto: string
}

export interface LeituraDoCredito {
  documentos: DocumentoLido[]
  /** O que não deu para ler, com o motivo. Aparece na tela; não é engolido. */
  ignorados: { nome: string; motivo: string }[]
}

/**
 * Lê os documentos da pasta do crédito e devolve o texto de cada um.
 *
 * Sequencial, e não em paralelo: são poucos arquivos, o Drive é acessado com a
 * conta de quem está usando, e rajada de requisições é o que irrita limite de taxa.
 * O `progresso` existe porque isto leva alguns segundos e a tela precisa dizer o
 * que está acontecendo — barra parada sem texto parece travada.
 */
export async function lerDocumentosDoCredito(
  pastaCreditoId: string,
  progresso?: (passo: string) => void,
): Promise<LeituraDoCredito> {
  const documentos: DocumentoLido[] = []
  const ignorados: { nome: string; motivo: string }[] = []
  let total = 0

  const subpastas = await listarSubpastas(pastaCreditoId)
  for (const numero of PASTAS_COM_DADOS) {
    const pasta = subpastas.find((p) => p.nome.trim().startsWith(`${numero}.`))
    if (!pasta) continue
    progresso?.(`Lendo ${pasta.nome}…`)
    const arquivos = await listarArquivos(pasta.id)
    for (const arq of arquivos) {
      if (total >= MAX_CHARS_TOTAL) {
        ignorados.push({ nome: arq.nome, motivo: 'limite de tamanho da leitura' })
        continue
      }
      try {
        progresso?.(`Lendo ${arq.nome}…`)
        const { bytes, mime } = await baixarArquivo(arq)
        const texto = await textoDeArquivo(bytes, mime, arq.nome)
        if (!texto) {
          ignorados.push({ nome: arq.nome, motivo: 'formato sem texto (imagem?)' })
          continue
        }
        if (!texto.trim()) {
          // PDF de digitalização cai aqui: tem páginas, não tem texto.
          ignorados.push({ nome: arq.nome, motivo: 'sem texto selecionável' })
          continue
        }
        documentos.push({ pasta: pasta.nome, nome: arq.nome, texto })
        total += texto.length
      } catch (e) {
        ignorados.push({ nome: arq.nome, motivo: (e as Error).message })
      }
    }
  }
  return { documentos, ignorados }
}

/**
 * Processos que NÃO devem ser oferecidos, por decisão de negócio.
 *
 * São dois negócios que não foram adiante. As pastas continuam no Drive de
 * propósito — servem de lembrete de qual é qual —, mas não são candidatas a
 * cadastro e não têm por que reaparecer na lista para sempre.
 *
 * LISTA ESPECÍFICA, e não uma regra geral: decisão do dono, em 12/08/2026. Não há
 * tela para editá-la, então acrescentar um terceiro é mexer aqui — e este
 * comentário existe justamente para quem chegar depois não achar que a ausência
 * deles é defeito da varredura.
 */
const IGNORADAS_POR_DECISAO = new Set(
  ['0019323-75.2001.8.09.0051', '5222044-59.2024.8.09.0168'].map(onlyDigits),
)

/**
 * As pastas do Drive que valem como candidatas a cadastro.
 *
 * Fica de fora o que já está cadastrado, reconhecido de duas maneiras, na ordem
 * da confiança:
 *   1. pelos DÍGITOS do número do processo, quando a pasta o tem — exato;
 *   2. pelo nome do cedente normalizado, para as pastas da convenção antiga.
 *
 * O segundo critério existe justamente para as pastas antigas não ficarem
 * aparecendo como novidade para sempre. Ele erra para os dois lados (cedente com
 * dois créditos, grafia diferente), e é por isso que o resultado é apresentado
 * como candidato a confirmar, não como fato.
 *
 * E fica de fora, também, a lista de ignorados acima.
 */
export function candidatasACadastro(
  pastas: PastaCredito[],
  processos: Pick<Processo, 'numero_cnj' | 'cedente'>[] | undefined,
): PastaCredito[] {
  const cnjs = new Set<string>()
  const cedentes = new Set<string>()
  for (const p of processos ?? []) {
    const d = onlyDigits(p.numero_cnj)
    if (d.length >= 15) cnjs.add(d)
    const c = normalizarNome(p.cedente ?? '')
    if (c) cedentes.add(c)
  }
  return pastas.filter((pasta) => {
    if (pasta.cnj) {
      const d = onlyDigits(pasta.cnj)
      return !IGNORADAS_POR_DECISAO.has(d) && !cnjs.has(d)
    }
    const c = normalizarNome(pasta.cedente ?? '')
    return !c || !cedentes.has(c)
  })
}
