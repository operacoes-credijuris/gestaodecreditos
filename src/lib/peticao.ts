// Preenchimento dos modelos de petição.
//
// Os modelos são arquivos .md no bucket `modelos-peticoes` do Storage, e marcam
// as lacunas com rótulos entre colchetes — [NÚMERO DO PROCESSO], e não
// {{processo_cnj}}. A escolha é deliberada: quem edita o modelo é advogado, e o
// texto continua legível como petição. O preço é que o rótulo é um CONTRATO entre
// o arquivo e este módulo: mudar de um lado sem o outro deixa o campo sem
// preencher.
//
// Este arquivo não formata nada por conta própria: reaproveita formatCNJ,
// textoTipoCredito e compilarEndereco, as mesmas que a tela e o Excel usam. Uma
// segunda implementação faria a petição dizer uma coisa e a carteira outra sobre
// o mesmo crédito — o defeito que estaPago() e textoTipoCredito fecharam.
import {
  compilarEndereco,
  formatCNJ,
  normalizarBusca,
  normalizarNome,
  onlyDigits,
} from './format'
import { textoTipoCredito } from './labels'
import { chavePessoa, type InvestidorDados } from './queries'
import { supabase } from './supabase'
import type { Processo } from './types'

/** Bucket onde vivem os modelos e o papel timbrado. */
export const BUCKET_MODELOS = 'modelos-peticoes'

/** Papel timbrado A4 (1242x1755 px, 150 DPI), fundo de todas as páginas do PDF. */
export const ARQUIVO_TIMBRADO = 'timbrado-credijuris.jpg'

/**
 * Baixa o texto de um modelo do Storage.
 *
 * Lança em erro em vez de devolver vazio: modelo que não carrega tem de parar a
 * geração com mensagem, porque string vazia viraria um PDF em branco com o
 * timbrado — documento que parece pronto e não é.
 */
export async function baixarModelo(arquivo: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET_MODELOS).download(arquivo)
  if (error) {
    throw new Error(`Não foi possível carregar o modelo "${arquivo}": ${error.message}`)
  }
  const texto = (await data.text()).trim()
  if (!texto) throw new Error(`O modelo "${arquivo}" está vazio no bucket.`)
  return texto
}

/**
 * Papel timbrado em bytes, para o .docx embutir a imagem no arquivo.
 *
 * Devolve null em vez de lançar: sem a arte a petição sai em papel branco, o que
 * ainda serve num aperto. Petição que não gera, não serve para nada.
 */
export async function baixarTimbradoBytes(): Promise<Uint8Array | null> {
  const { data, error } = await supabase.storage
    .from(BUCKET_MODELOS)
    .download(ARQUIVO_TIMBRADO)
  if (error || !data) return null
  return new Uint8Array(await data.arrayBuffer())
}

export type VariavelPeticao =
  | 'juizo'
  | 'processo_cnj'
  | 'cessionario'
  | 'tipo_credito'
  | 'dados_bancarios'
  | 'qualificacao_cessionario'

/**
 * O rótulo, como está escrito nos modelos, e a variável que ele pede.
 *
 * As chaves já estão sem acento e em minúsculas, porque é assim que chaveRotulo
 * entrega o que leu do arquivo. A ordem das palavras importa:
 * "CESSIONÁRIO/INVESTIDOR" e "INVESTIDOR/CESSIONÁRIO" são rótulos diferentes, e
 * essa divergência já apareceu de verdade em um dos dez modelos.
 */
const ROTULOS: Record<string, VariavelPeticao> = {
  'enderecamento do juizo': 'juizo',
  'numero do processo': 'processo_cnj',
  'nome do cessionario': 'cessionario',
  'tipo de credito': 'tipo_credito',
  'dados bancarios do cessionario/investidor': 'dados_bancarios',
  'qualificacao do cessionario': 'qualificacao_cessionario',
}

/**
 * Qualquer [texto entre colchetes] do modelo.
 *
 * A barra invertida opcional é obrigatória aqui: a conversão de .docx para .md
 * ESCAPA os colchetes, e os arquivos no bucket trazem `\[NÚMERO DO PROCESSO\]`.
 * Sem tolerar isso, o rótulo capturado terminaria em barra, não casaria com
 * nenhuma chave, e a petição sairia com o rótulo impresso — sem erro nenhum. O
 * `*?` é preguiçoso para a barra final sobrar para o `\\?` e não entrar no nome.
 */
const RE_ROTULO = /\\?\[([^\][\n]*?)\\?\]/g

/**
 * O rótulo pronto para procurar no mapa: sem barra de escape, sem acento, em
 * minúsculas. A limpeza da barra vem antes da normalização porque o escape pode
 * aparecer no meio do rótulo, não só nas pontas.
 */
const chaveRotulo = (rotulo: string) => normalizarBusca(rotulo.replace(/\\/g, ''))

/** O nome da variável em português, para mensagem de tela. */
export const NOME_VARIAVEL: Record<VariavelPeticao, string> = {
  juizo: 'endereçamento do juízo',
  processo_cnj: 'número do processo',
  cessionario: 'nome do cessionário',
  tipo_credito: 'tipo de crédito',
  dados_bancarios: 'dados bancários',
  qualificacao_cessionario: 'qualificação do cessionário',
}

/**
 * Uma lacuna que o modelo pede e o cadastro não tem como preencher.
 *
 * Existe porque petição vai a juízo: emitir o PDF com o campo vazio é pior que
 * não emitir. A janela mostra as pendências ANTES de gerar, e só das variáveis
 * que o modelo escolhido usa — cobrar dados bancários numa petição que não os
 * menciona seria falso bloqueio.
 */
export interface Pendencia {
  variavel: VariavelPeticao
  motivo: string
}

/** As variáveis que este modelo realmente usa. */
export function variaveisUsadas(conteudo: string): VariavelPeticao[] {
  const achadas = new Set<VariavelPeticao>()
  for (const m of conteudo.matchAll(RE_ROTULO)) {
    const v = ROTULOS[chaveRotulo(m[1])]
    if (v) achadas.add(v)
  }
  return [...achadas]
}

/**
 * Rótulos entre colchetes que este módulo não conhece.
 *
 * É a rede contra erro de digitação no modelo: um "[NÚMERO DO PROCESO]" com um S
 * a menos nunca seria preenchido, e a petição sairia com o rótulo impresso. A
 * importação avisa na hora, em vez de a descoberta acontecer depois de
 * protocolar.
 */
export function rotulosDesconhecidos(conteudo: string): string[] {
  const fora = new Set<string>()
  for (const m of conteudo.matchAll(RE_ROTULO)) {
    if (!ROTULOS[chaveRotulo(m[1])]) fora.add(m[1].replace(/\\/g, '').trim())
  }
  return [...fora]
}

/**
 * Qualificação completa do cessionário: documento, RG e endereço.
 *
 * Só a petição de homologação pede, e por um motivo jurídico — é a primeira vez
 * que o cessionário se manifesta nos autos. Nas outras nove ele já está
 * qualificado, e o texto fixo diz "já qualificado(a) nos autos em epígrafe".
 */
function qualificacao(d: InvestidorDados | undefined): string | null {
  if (!d) return null
  const doc = onlyDigits(d.cpf)
  // A ficha guarda CPF e CNPJ na MESMA coluna (a máscara da aba aceita os dois),
  // então o comprimento é o que distingue — 11 é pessoa física, 14 é jurídica.
  const pj = doc.length === 14
  const partes: string[] = []
  if (doc.length === 11 || pj) {
    partes.push(
      pj
        ? `inscrita no CNPJ sob o nº ${d.cpf}`
        : `inscrito(a) no CPF sob o nº ${d.cpf}`,
    )
  }
  // RG não existe para pessoa jurídica.
  if (!pj && d.rg?.trim()) partes.push(`portador(a) do RG nº ${d.rg.trim()}`)
  // As partes mandam; `endereco` é o texto corrido legado, fallback de quem ainda
  // não teve a ficha migrada (ver migração 0024).
  const end = compilarEndereco(d) || (d.endereco ?? '').trim()
  if (end) {
    partes.push(pj ? `com sede em ${end}` : `residente e domiciliado(a) em ${end}`)
  }
  return partes.length ? partes.join(', ') : null
}

/**
 * Bloco de dados bancários, uma linha por campo.
 *
 * Formato de ofício, não de tela: o juízo lê para expedir alvará, então cada dado
 * vem rotulado e em linha própria, sem depender de alinhamento.
 */
function dadosBancarios(nome: string, d: InvestidorDados | undefined): string | null {
  if (!d) return null
  // Sem conta nem Pix não há para onde pagar, e a petição pediria transferência
  // para lugar nenhum — pior que não gerar.
  if (!d.conta?.trim() && !d.pix?.trim()) return null
  const linhas: string[] = [`Favorecido: ${maiusculo(nome)}`]
  if (d.cpf?.trim()) linhas.push(`CPF/CNPJ: ${d.cpf.trim()}`)
  if (d.banco?.trim()) linhas.push(`Banco: ${d.banco.trim()}`)
  if (d.agencia?.trim()) linhas.push(`Agência: ${d.agencia.trim()}`)
  if (d.conta?.trim()) linhas.push(`Conta: ${d.conta.trim()}`)
  if (d.pix?.trim()) linhas.push(`Pix: ${d.pix.trim()}`)
  return linhas.join('\n')
}

/**
 * Caixa alta com acento correto. `toUpperCase()` puro erra em algumas línguas;
 * a versão com locale não.
 */
const maiusculo = (s: string) => s.toLocaleUpperCase('pt-BR')

/**
 * Juízo endereçado: a vara, com a comarca quando as duas existem.
 *
 * Em CAIXA ALTA porque o endereçamento do modelo já está assim ("AO JUÍZO DE
 * DIREITO DO(A) ..."), e o cadastro guarda a vara como foi digitada — sem isso
 * saía "AO JUÍZO DE DIREITO DO(A) 1ª Vara Civil ... DA COMARCA DE Luziânia",
 * misturando as duas grafias na mesma linha.
 */
function juizo(p: Processo): string | null {
  const vara = (p.vara ?? '').trim()
  const comarca = (p.comarca ?? '').trim()
  if (vara && comarca) return maiusculo(`${vara} DA COMARCA DE ${comarca}`)
  return vara ? maiusculo(vara) : comarca ? maiusculo(comarca) : null
}

export interface Preenchimento {
  valores: Partial<Record<VariavelPeticao, string>>
  pendencias: Pendencia[]
}

/**
 * Resolve as variáveis de UM crédito. Devolve o que conseguiu e o que faltou, sem
 * lançar: quem decide se dá para gerar é a janela, que sabe quais variáveis o
 * modelo escolhido usa.
 */
export function resolverVariaveis(
  processo: Processo,
  dados: Map<string, InvestidorDados> | undefined,
): Preenchimento {
  const valores: Partial<Record<VariavelPeticao, string>> = {}
  const pendencias: Pendencia[] = []
  const falta = (variavel: VariavelPeticao, motivo: string) =>
    pendencias.push({ variavel, motivo })

  const j = juizo(processo)
  if (j) valores.juizo = j
  else falta('juizo', 'O crédito não tem vara nem comarca cadastradas.')

  const cnj = (processo.numero_cnj ?? '').trim()
  if (cnj) valores.processo_cnj = formatCNJ(cnj)
  else falta('processo_cnj', 'O crédito não tem número de processo.')

  // Em caixa alta: é o nome que abre a peça, ao lado de um endereçamento que já
  // está todo em maiúsculas. O cadastro guarda como foi digitado.
  const nome = (processo.cessionario ?? '').trim()
  if (nome) valores.cessionario = maiusculo(nome)
  else falta('cessionario', 'O crédito não tem cessionário informado.')

  // textoTipoCredito devolve '—' para lista vazia, o que é certo na tela e
  // inaceitável numa petição ("cessão de —").
  if (processo.tipo_credito?.length) {
    valores.tipo_credito = textoTipoCredito(processo.tipo_credito)
  } else {
    falta('tipo_credito', 'O crédito não tem tipo marcado na ficha.')
  }

  // A ficha da pessoa não é vinculada por id: o cessionário é TEXTO no crédito, e
  // o encontro se dá pelo nome normalizado (migração 0023). Aqui vale
  // normalizarNome, e não normalizarBusca, porque é a CHAVE da tabela.
  const ficha = nome
    ? dados?.get(chavePessoa('investidor', normalizarNome(nome)))
    : undefined

  const banc = nome ? dadosBancarios(nome, ficha) : null
  if (banc) valores.dados_bancarios = banc
  else {
    falta(
      'dados_bancarios',
      ficha
        ? `A ficha de ${nome} não tem conta nem Pix.`
        : `Não há ficha cadastral para ${nome || 'o cessionário'}.`,
    )
  }

  const qual = qualificacao(ficha)
  if (qual) valores.qualificacao_cessionario = qual
  else {
    falta(
      'qualificacao_cessionario',
      ficha
        ? `A ficha de ${nome} não tem CPF/CNPJ nem endereço.`
        : `Não há ficha cadastral para ${nome || 'o cessionário'}.`,
    )
  }

  return { valores, pendencias }
}

/**
 * Troca os rótulos pelos valores.
 *
 * O que não resolveu FICA como está, com colchetes e tudo. O produto final é um
 * PDF que vai direto ao PJe, sem passar por edição: ninguém protocola um
 * documento com [QUALIFICAÇÃO DO CESSIONÁRIO] no meio, enquanto uma linha em
 * branco passa por lacuna proposital e é protocolada.
 *
 * Na prática é rede de segurança, não caminho normal — a janela usa as pendências
 * de resolverVariaveis para BLOQUEAR a geração quando falta dado.
 */
export function aplicarModelo(
  conteudo: string,
  valores: Partial<Record<VariavelPeticao, string>>,
): string {
  return conteudo.replace(RE_ROTULO, (inteiro, rotulo: string) => {
    const v = ROTULOS[chaveRotulo(rotulo)]
    return (v && valores[v]) || inteiro
  })
}

/**
 * Modelos sugeridos para uma descrição de tarefa, do mais específico ao menos.
 *
 * Ordenado pelo tamanho da palavra que casou: "juntada de valor atualizado" é
 * mais específica que "sequestro", e três pares de modelos colidem na mesma
 * palavra (sequestro, registro público, RPV). Devolve LISTA, nunca um só — quem
 * desempata é a pessoa. Escolher sozinho protocolaria a peça errada: pedir
 * sequestro não é juntar planilha para fins de sequestro.
 *
 * A janela mostra os 10 de todo jeito, porque a sugestão pode simplesmente errar.
 */
export function sugerirModelos<T extends { palavras_chave: string[] }>(
  descricao: string | null | undefined,
  modelos: T[],
): T[] {
  const texto = normalizarBusca(descricao)
  if (!texto) return []
  const casados: { modelo: T; peso: number }[] = []
  for (const m of modelos) {
    let peso = 0
    for (const palavra of m.palavras_chave) {
      const p = normalizarBusca(palavra)
      if (p && texto.includes(p)) peso = Math.max(peso, p.length)
    }
    if (peso > 0) casados.push({ modelo: m, peso })
  }
  return casados.sort((a, b) => b.peso - a.peso).map((c) => c.modelo)
}
