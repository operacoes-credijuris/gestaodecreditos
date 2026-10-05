// A JUSTIFICATIVA TÉCNICA DA PROPOSTA: o amparo técnico do PREÇO que a Credijuris
// apresenta ao cedente.
//
// Pedido do dono em 05/10/2026: na Produção de proposta (Externo, Interno e RPV),
// um botão abre uma janela em que a IA pesquisa e redige a justificativa; a
// pessoa edita, e o Enviar grava o texto como NOTA no card do Kommo. O prompt é
// da operação, editável em Configurações, como o roteiro da qualificação.
//
// O QUE MORA AQUI, e por quê: as regras que a tela e a Edge Function precisam
// dizer IGUAL — as variáveis do prompt e de onde cada uma sai, a montagem do
// prompt, a lista de domínios, a numeração das fontes, a divisão da nota e as
// transições de estado com a trava. Duas cópias divergiriam no primeiro ajuste.
//
// MÓDULO PURO — sem `npm:` e sem `Deno.` —, como `trilhasDoPrecatorio.ts`: roda
// no vitest, no navegador e na Edge Function `justificativa-tecnica`.

import { lerCadastroDoCard, lerTituloCard, valorDoCampo } from './cadastroDoCard.ts'
import {
  cotacoesDoCard,
  formatarPercentual,
  formatarReais,
  type CotacaoLida,
  type ValorDeCampo,
} from './cotacaoDoFundo.ts'
import { FUNDOS_DA_PRECIFICACAO, mesmaEtiqueta } from './etiquetasDoFundo.ts'
import { lerNumeroCnj } from './tribunais.ts'
import { FUNIL_PRECATORIO_EXTERNO, FUNIL_PRECATORIO_INTERNO } from './trilhasDoPrecatorio.ts'

// ------------------------------------------------------------------ onde vale

/** O funil Geral RPV (o mesmo `FUNIL_RPV` de `src/lib/kommo.ts`). */
export const FUNIL_RPV_JUSTIFICATIVA = 13901939

/**
 * OS TRÊS FUNIS EM QUE HÁ JUSTIFICATIVA, com o nome que vai para o prompt.
 *
 * O SERVIDOR SÓ GERA PARA CARD DESTES FUNIS: a geração é paga, e um id solto no
 * corpo da requisição não pode pôr a IA para pesquisar um card do comercial.
 * Não exige a COLUNA: o card pode ter seguido para a Negociação depois de
 * gerada a justificativa, e reabrir ou reenviar dali tem de continuar valendo.
 */
export const FUNIS_DA_JUSTIFICATIVA: Readonly<Record<number, string>> = {
  [FUNIL_PRECATORIO_EXTERNO]: 'Precatório externo',
  [FUNIL_PRECATORIO_INTERNO]: 'Precatório interno',
  [FUNIL_RPV_JUSTIFICATIVA]: 'RPV',
}

/**
 * AS COLUNAS ONDE O BOTÃO APARECE — a Produção de proposta de cada funil. Pelo
 * id, como o resto. A tela liga o botão pela marca da aba (`justificativaTecnica`
 * na trilha, e a aba 'aprovados' do RPV); esta lista é a mesma coisa dita para
 * os testes, que prendem uma à outra.
 */
export const COLUNAS_DA_JUSTIFICATIVA: Readonly<Record<number, number>> = {
  [FUNIL_PRECATORIO_EXTERNO]: 111533988,
  [FUNIL_PRECATORIO_INTERNO]: 111533948,
  [FUNIL_RPV_JUSTIFICATIVA]: 107830035,
}

// ------------------------------------------------------------------ configuração

/** A chave do prompt na tabela `prompts_operacao` (migração 0065). */
export const CHAVE_PROMPT_JUSTIFICATIVA = 'justificativa_tecnica'
/** A chave da lista de domínios permitidos na pesquisa, na mesma tabela. */
export const CHAVE_DOMINIOS_JUSTIFICATIVA = 'justificativa_tecnica_dominios'

/** O texto que entra no lugar de uma variável que a plataforma não tem. */
export const NAO_INFORMADO = '(não informado)'

/**
 * AS VARIÁVEIS DO PROMPT: o nome, o que vale e de onde a plataforma tira.
 *
 * A TELA DE CONFIGURAÇÕES LISTA ESTA MESMA LISTA ao lado do campo, e a função a
 * preenche: quem escreve o prompt vê exatamente o que pode usar. Só entra aqui o
 * que se obtém com segurança; o resto sai como "(não informado)", e o prompt
 * padrão manda a IA dizer isso em vez de supor.
 */
export const VARIAVEIS_DA_JUSTIFICATIVA: readonly { nome: string; vale: string; fonte: string }[] = [
  // O ATALHO (05/10/2026): a operação escreveu {{card}} esperando "os dados do
  // card" — e a variável não existia, a IA recebia o texto literal. Agora existe.
  { nome: 'card', vale: 'Todos os dados do crédito de uma vez, um por linha (as variáveis abaixo, com rótulo).', fonte: 'Montado pela plataforma a partir das variáveis abaixo.' },
  { nome: 'funil', vale: 'RPV, Precatório interno ou Precatório externo.', fonte: 'O funil do card no Kommo.' },
  { nome: 'cedente', vale: 'O titular do crédito.', fonte: 'A anotação "CEDENTE:" do comercial; na falta, o título do card.' },
  { nome: 'processo', vale: 'O número CNJ do processo.', fonte: 'O título do card; na falta, o espelho e a anotação "PROCESSO:".' },
  { nome: 'tribunal', vale: 'O tribunal onde o crédito tramita.', fonte: 'A ficha da análise (resumo salvo ou a ficha anotada no card); na falta, o número CNJ (ex.: "TJSP").' },
  { nome: 'ente_devedor', vale: 'Quem paga: União, estado, município, autarquia.', fonte: 'A ficha da análise; na falta, a anotação "ENTIDADE DEVEDORA:" do card.' },
  { nome: 'parcela_cedida', vale: 'O que está sendo cedido (principal, honorários…).', fonte: 'A anotação "PARCELA CEDIDA:"; na falta, o título do card.' },
  { nome: 'valor_face', vale: 'O valor de face (nominal) do crédito.', fonte: 'A anotação "VALOR DE FACE:" (ou "VALOR NOMINAL:", "VALOR ORIGINAL:") do card.' },
  { nome: 'valor_atualizado', vale: 'O valor atualizado do crédito.', fonte: 'A anotação "VALOR ATUALIZADO:" do card.' },
  { nome: 'valor_cedido', vale: 'O valor do crédito negociado (soma dos líquidos das verbas cedidas).', fonte: 'A ficha da análise (RPV: o resumo salvo; precatório: a ficha anotada no card).' },
  { nome: 'prazo_estimado', vale: 'Meses até o pagamento e a previsão.', fonte: 'O resumo salvo pela análise de RPV. Fora do RPV, quase sempre não informado.' },
  { nome: 'teto_rpv', vale: 'O teto de RPV do ente devedor.', fonte: 'Só no RPV: o cache de tetos da plataforma (sem pesquisar nada novo).' },
  { nome: 'fundo_escolhido', vale: 'O fundo cuja proposta a casa escolheu.', fonte: 'A anotação "Seguir com a proposta do(a) ‹fundo›." do Escolher proposta.' },
  { nome: 'valor_proposta', vale: 'O valor da proposta do fundo escolhido (no spread, a proposta final, já sem a comissão).', fonte: 'O campo do fundo na aba "Cotações/propostas" do card.' },
  { nome: 'comissao', vale: 'A comissão da proposta escolhida: em R$ (limitada) ou em spread (o valor, o percentual e sobre quanto).', fonte: 'O mesmo campo do fundo, depois da barra.' },
  { nome: 'cotacoes_recebidas', vale: 'Todas as cotações dos fundos no card, uma por linha.', fonte: 'Os campos da aba "Cotações/propostas" e as etiquetas dos fundos.' },
  { nome: 'data_hoje', vale: 'A data de hoje (dd/mm/aaaa).', fonte: 'O relógio do servidor, no horário de Brasília.' },
]

/**
 * A LISTA SUGERIDA DE DOMÍNIOS para restringir a pesquisa a fontes oficiais.
 *
 * SÓ DOMÍNIOS QUE EXISTEM, conferidos um a um: os tribunais superiores, o CNJ,
 * o CJF, os seis TRFs, os 27 Tribunais de Justiça (todos em tjXX.jus.br), o
 * Tesouro (o Tesouro Transparente, e o portal gov.br, onde mora a página do
 * Tesouro Nacional), o Banco Central, o Diário Oficial da União, o Planalto, a
 * Transparência, o TCU e o Congresso.
 *
 * É SUGESTÃO, não padrão: a referência de deságio de mercado quase nunca está
 * em site oficial — está em notícia, relatório de gestora, plataforma de
 * negociação. Restringir por padrão cortaria justamente essa parte da pesquisa.
 * Campo vazio = sem restrição.
 */
export const DOMINIOS_SUGERIDOS: readonly string[] = [
  'cnj.jus.br', 'stf.jus.br', 'stj.jus.br', 'tst.jus.br', 'cjf.jus.br',
  'trf1.jus.br', 'trf2.jus.br', 'trf3.jus.br', 'trf4.jus.br', 'trf5.jus.br', 'trf6.jus.br',
  'tjac.jus.br', 'tjal.jus.br', 'tjap.jus.br', 'tjam.jus.br', 'tjba.jus.br', 'tjce.jus.br',
  'tjdft.jus.br', 'tjes.jus.br', 'tjgo.jus.br', 'tjma.jus.br', 'tjmt.jus.br', 'tjms.jus.br',
  'tjmg.jus.br', 'tjpa.jus.br', 'tjpb.jus.br', 'tjpr.jus.br', 'tjpe.jus.br', 'tjpi.jus.br',
  'tjrj.jus.br', 'tjrn.jus.br', 'tjrs.jus.br', 'tjro.jus.br', 'tjrr.jus.br', 'tjsc.jus.br',
  'tjsp.jus.br', 'tjse.jus.br', 'tjto.jus.br',
  'tesourotransparente.gov.br', 'www.gov.br', 'bcb.gov.br', 'in.gov.br', 'planalto.gov.br',
  'portaldatransparencia.gov.br', 'tcu.gov.br', 'camara.leg.br', 'senado.leg.br',
]

/** O teto da API para a lista de domínios de uma ferramenta. */
export const MAX_DOMINIOS = 64

/**
 * A lista de domínios digitada (um por linha, ou separados por vírgula), limpa:
 * sem protocolo, sem caminho, sem "www." repetido, em minúsculas, sem repetição.
 *
 * O QUE NÃO É DOMÍNIO SAI, e é devolvido em `recusados` para a tela dizer qual:
 * um item inválido na lista faria a API recusar a chamada INTEIRA, e a geração
 * paga falharia por causa de uma vírgula.
 */
export function lerDominios(texto: unknown): { dominios: string[]; recusados: string[] } {
  const dominios: string[] = []
  const recusados: string[] = []
  for (const bruto of String(texto ?? '').split(/[\n,;\s]+/)) {
    const item = bruto.trim()
    if (!item) continue
    const host = item
      .toLowerCase()
      .replace(/^[a-z]+:\/\//, '')
      .replace(/[/?#].*$/, '')
      .replace(/:\d+$/, '')
      .replace(/\.$/, '')
    const valido =
      /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(host) &&
      host !== 'localhost'
    if (!valido) {
      recusados.push(item)
      continue
    }
    if (!dominios.includes(host)) dominios.push(host)
  }
  return { dominios: dominios.slice(0, MAX_DOMINIOS), recusados }
}

// ------------------------------------------------------------------ o prompt padrão

/**
 * O PROMPT PADRÃO. Campo vazio, linha ausente ou banco sem a tabela caem nele —
 * a mesma regra do roteiro da qualificação: nenhuma justificativa sai sem método.
 *
 * ESCRITO PARA A NOTA DO KOMMO: texto puro, sem markdown (o feed mostra
 * asteriscos e cerquilhas como estão), títulos em caixa alta. E sem linhas no
 * formato "RÓTULO: valor" com os rótulos do cadastro — a nota é de pessoa e
 * volta para o espelho; uma linha "CEDENTE: …" seria lida como cadastro do card.
 *
 * FUNCIONA SEM PROPOSTA DE FUNDO: no RPV e no Interno a proposta pode ser da
 * própria Credijuris, e então a justificativa ampara o preço que a casa oferece.
 */
export const PROMPT_JUSTIFICATIVA_PADRAO = `Você é analista de crédito da Credijuris e vai redigir a JUSTIFICATIVA TÉCNICA da proposta de compra de um crédito judicial contra a Fazenda Pública. A justificativa é apresentada ao CEDENTE (o titular do crédito) e explica, com fatos verificáveis, por que o preço oferecido é justo diante do risco e do tempo de espera do pagamento. Quem lê é leigo em direito financeiro: escreva com clareza, sem jargão desnecessário, em tom respeitoso e profissional.

Os DADOS DO CRÉDITO vêm no fim, anexados pela plataforma ("(não informado)" quando ela não tem o dado): tipo, cedente, processo, tribunal, ente devedor, parcela cedida, valores, prazo estimado, a proposta escolhida (fundo, valor e comissão), as cotações recebidas e a data de hoje.

O QUE PESQUISAR (na internet, em fontes confiáveis e recentes, de preferência oficiais)
1. A situação de pagamento do ente devedor: se está no regime especial ou no regime comum de precatórios (ADCT, arts. 97 e 101 a 105, EC 62/2009, EC 94/2016, EC 99/2017, EC 109/2021, EC 113 e 114/2021 e EC 136/2025), a posição e o ritmo da fila cronológica no tribunal, a dotação para precatórios e RPVs na Lei Orçamentária Anual do exercício, os aportes mensais ou o percentual da receita corrente líquida destinado ao pagamento, e o histórico de atrasos, sequestros ou atrasos de repasse. Para RPV: o teto de RPV do ente (lei própria ou o piso do ADCT) e o prazo legal de pagamento (60 dias, art. 17 da Lei 10.259/2001 ou a lei local), e se o ente costuma cumpri-lo.
2. O contexto jurídico e normativo recente que afeta o prazo ou o valor: emendas constitucionais, decisões do STF e do STJ (por exemplo sobre índices de correção e o teto de pagamento), resoluções do CNJ (como a Resolução CNJ 303/2019 e suas alterações) e normas do próprio tribunal.
3. Referências de deságio praticado no mercado para créditos semelhantes (mesmo ente ou mesma esfera, mesmo tipo de crédito, prazo parecido), com a data da informação.

COMO A JUSTIFICATIVA DEVE SER
- Comece por um resumo de três a cinco linhas: o crédito, o preço proposto e a razão principal do preço.
- Depois, em seções com título em CAIXA ALTA: SITUAÇÃO DE PAGAMENTO DO ENTE DEVEDOR; CONTEXTO JURÍDICO E NORMATIVO; PRAZO ESTIMADO E RISCOS; REFERÊNCIAS DE MERCADO; POR QUE O PREÇO É ADEQUADO.
- Se há proposta de fundo (valor e comissão informados), explique o preço a partir dela: o valor oferecido frente ao valor do crédito, o deságio implícito em percentual (mostre a conta), e o que o justifica (tempo até o pagamento, custo do dinheiro no período, risco do ente, risco jurídico). Se não há proposta de fundo, a proposta é da própria Credijuris: ampare o preço com o mesmo raciocínio, sem citar fundo nenhum.
- Quando um dado do crédito estiver "(não informado)", não o invente nem o estime como se fosse certo: diga que não consta e, se fizer falta, diga o que conferir.
- Toda afirmação de fato tirada da pesquisa (números, datas, normas, posições de fila, decisões) precisa da fonte citada pelo número entre colchetes, assim: [1]. Não cite fonte que não foi consultada e não invente número, data, decisão ou norma.
- Valores em reais no formato R$ 1.234.567,89; datas em dd/mm/aaaa.
- Texto puro, sem markdown (sem asteriscos, cerquilhas ou tabelas). Não escreva linhas no formato "RÓTULO: valor" com os rótulos do cadastro (CEDENTE:, PROCESSO:, PARCELA CEDIDA: etc.).
- Entre 500 e 1.200 palavras.
- Não escreva a lista de fontes no fim: a plataforma acrescenta a lista numerada a partir das citações.`

// ------------------------------------------------------------------ a montagem do prompt

const RE_VARIAVEL = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g

/**
 * O prompt com as variáveis no lugar.
 *
 * VARIÁVEL CONHECIDA SEM VALOR vira "(não informado)". VARIÁVEL DESCONHECIDA (um
 * nome digitado errado em Configurações) fica como está no texto e volta em
 * `desconhecidas` — trocá-la por "(não informado)" esconderia o erro de
 * digitação, e a IA leria "(não informado)" num lugar onde a pessoa queria um
 * dado.
 */
/** Os rótulos de {{card}}, na ordem em que a IA os lê. */
const ROTULOS_DO_CARD: readonly [string, string][] = [
  ['funil', 'Tipo'],
  ['cedente', 'Cedente'],
  ['processo', 'Processo'],
  ['tribunal', 'Tribunal'],
  ['ente_devedor', 'Ente devedor'],
  ['parcela_cedida', 'Parcela cedida'],
  ['valor_face', 'Valor de face'],
  ['valor_atualizado', 'Valor atualizado'],
  ['valor_cedido', 'Valor do crédito negociado'],
  ['prazo_estimado', 'Prazo estimado de pagamento'],
  ['teto_rpv', 'Teto de RPV do ente (só RPV)'],
  ['fundo_escolhido', 'Fundo da proposta escolhida'],
  ['valor_proposta', 'Valor da proposta'],
  ['comissao', 'Comissão'],
  ['data_hoje', 'Data de hoje'],
]

/** {{card}}: todos os dados do crédito, um por linha, com as cotações no fim. */
export function blocoDoCard(valores: Readonly<Record<string, string | null | undefined>>): string {
  const v = (nome: string) => String(valores[nome] ?? '').trim() || NAO_INFORMADO
  const linhas = ROTULOS_DO_CARD.map(([nome, rotulo]) => `- ${rotulo}: ${v(nome)}`)
  return [...linhas, `- Cotações recebidas no card:\n${v('cotacoes_recebidas')}`].join('\n')
}

/**
 * O prompt montado. `anexouDados`: a plataforma anexou ao fim o bloco com
 * TODOS os dados do crédito.
 *
 * O PROMPT É SÓ INSTRUÇÃO (pedido do dono, 05/10/2026: "quero ir mudando o
 * prompt sem depender das variáveis"). Os dados vão SEMPRE junto, a menos que o
 * prompt já os traga inteiros — pelo {{card}} ou usando todas as variáveis de
 * dado, como o padrão. Um prompt com só {{cedente}} recebe o bloco completo:
 * repetir um dado não atrapalha a IA; faltar o valor da proposta, sim.
 */
export function montarPrompt(
  modelo: string,
  valores: Readonly<Record<string, string | null | undefined>>,
): { texto: string; desconhecidas: string[]; anexouDados: boolean } {
  const conhecidas = new Set(VARIAVEIS_DA_JUSTIFICATIVA.map((v) => v.nome))
  const desconhecidas: string[] = []
  const usadas = new Set<string>()
  let texto = String(modelo ?? '').replace(RE_VARIAVEL, (inteiro, nome: string) => {
    if (!conhecidas.has(nome)) {
      if (!desconhecidas.includes(nome)) desconhecidas.push(nome)
      return inteiro
    }
    usadas.add(nome)
    if (nome === 'card') return blocoDoCard(valores)
    const v = String(valores[nome] ?? '').trim()
    return v || NAO_INFORMADO
  })
  const completo =
    usadas.has('card') ||
    VARIAVEIS_DA_JUSTIFICATIVA.every((v) => v.nome === 'card' || v.nome === 'data_hoje' || usadas.has(v.nome))
  const anexouDados = !completo
  if (anexouDados) {
    texto =
      `${texto.trimEnd()}\n\nDADOS DO CRÉDITO (anexados pela plataforma; "${NAO_INFORMADO}" quando ela não tem o dado):\n` +
      blocoDoCard(valores)
  }
  return { texto, desconhecidas, anexouDados }
}

/** O prompt em vigor: o da operação, ou o padrão quando o campo está vazio. */
export function promptEmVigor(salvo: string | null | undefined): string {
  return String(salvo ?? '').trim() || PROMPT_JUSTIFICATIVA_PADRAO
}

// ------------------------------------------------------------------ os dados do card

/** Uma anotação do card, no que a leitura precisa dela (o formato do espelho). */
export interface NotaDoCard {
  texto?: string | null
  criado_em?: string | null
  automatica?: boolean | null
}

/** O card, no que a justificativa lê dele (a linha de `kommo_leads`). */
export interface CardDaJustificativa {
  kommo_lead_id?: number | null
  pipeline_id?: number | null
  nome?: string | null
  processo_cnj?: string | null
  notas?: NotaDoCard[] | null
  nota_texto?: string | null
  tags?: string[] | null
  raw?: { custom_fields_values?: ValorDeCampo[] | null } | null
  oportunidade?: {
    ficha?: {
      tribunal?: string | null
      uf?: string | null
      cedente?: string | null
      entidade_devedora?: string | null
      parcela_cedida?: string | null
      valor_cedido?: number | null
    } | null
    prazoMeses?: number | null
    dataPagamento?: string | null
  } | null
}

/** O valor do ÚLTIMO rótulo que casar, no texto das notas (a mais nova vence). */
function ultimoRotulo(notas: NotaDoCard[], re: RegExp): string {
  const ordenadas = [...notas].sort((a, b) => String(a.criado_em ?? '').localeCompare(String(b.criado_em ?? '')))
  let achado = ''
  for (const n of ordenadas) {
    const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
    for (const m of String(n.texto ?? '').matchAll(global)) {
      const v = valorDoCampo(m[1] ?? '')
      if (v) achado = v
    }
  }
  return achado
}

/** "Seguir com a proposta do BTG." → "BTG" (a nota do Escolher proposta). */
const RE_ESCOLHA = /Seguir com a proposta d(?:o|a|o\(a\))\s+(.+?)\.\s*(?:$|\n)/gim

/**
 * O FUNDO ESCOLHIDO, pela nota do "Escolher proposta" — a mais nova, se houver
 * mais de uma (a casa mudou de ideia). Devolvido com o nome da lista de fundos
 * quando casa com um deles, para achar o campo da cotação.
 */
export function fundoEscolhido(notas: readonly NotaDoCard[] | null | undefined): string {
  const ordenadas = [...(notas ?? [])].sort((a, b) =>
    String(a.criado_em ?? '').localeCompare(String(b.criado_em ?? '')),
  )
  let achado = ''
  for (const n of ordenadas) {
    for (const m of String(n.texto ?? '').matchAll(RE_ESCOLHA)) achado = m[1].trim()
  }
  if (!achado) return ''
  return FUNDOS_DA_PRECIFICACAO.find((f) => mesmaEtiqueta(f, achado)) ?? achado
}

/** O tribunal lido do número CNJ: "TJSP", "TRF1", "TRT18" — ou ''. */
export function tribunalDoCnj(numero: unknown): string {
  const r = lerNumeroCnj(numero)
  if (!r) return ''
  if (r.segmento === 'federal') return `TRF${r.tribunal}`
  if (r.segmento === 'trabalho') return `TRT${r.tribunal}`
  if (r.segmento !== 'estadual') return ''
  const UF_DO_TJ: Record<number, string> = {
    1: 'AC', 2: 'AL', 3: 'AP', 4: 'AM', 5: 'BA', 6: 'CE', 7: 'DFT', 8: 'ES', 9: 'GO',
    10: 'MA', 11: 'MT', 12: 'MS', 13: 'MG', 14: 'PA', 15: 'PB', 16: 'PR', 17: 'PE', 18: 'PI',
    19: 'RJ', 20: 'RN', 21: 'RS', 22: 'RO', 23: 'RR', 24: 'SC', 25: 'SE', 26: 'SP', 27: 'TO',
  }
  const uf = UF_DO_TJ[r.tribunal]
  return uf ? `TJ${uf}` : ''
}

/** Reais (número) em "R$ 1.234,56", com o mesmo espaço comum da cotação. */
const reais = (v: number | null | undefined): string =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? formatarReais(Math.round(v * 100)) : ''

/**
 * A COMISSÃO, por extenso — o que a cotação diz:
 *   limitada:      "R$ 40.000,00 (limitada)"
 *   spread novo:   "R$ 42.500,00 (spread de 5% sobre R$ 850.000,00)"
 *   spread antigo: "Spread (a comissão da casa sai da diferença sobre a proposta)"
 * No spread novo, "sobre" é o valor que a pessoa digitou (a final + a
 * comissão): sem ele, a IA tomaria os 5% como sobre a final.
 */
function textoDaComissao(c: CotacaoLida | null): string {
  const k = c?.comissao
  if (!k) return ''
  if (k.modalidade === 'limitada') return `${formatarReais(k.centavos)} (limitada)`
  const pct = k.percentualCentesimos !== undefined ? `${formatarPercentual(k.percentualCentesimos)}%` : null
  if (k.centavos !== undefined && c.proposta !== null) {
    const sobre = formatarReais(c.proposta + k.centavos)
    return `${formatarReais(k.centavos)} (spread${pct ? ` de ${pct}` : ''} sobre ${sobre})`
  }
  return pct
    ? `Spread de ${pct} sobre a proposta (a comissão da casa sai dela)`
    : 'Spread (a comissão da casa sai da diferença sobre a proposta)'
}

/**
 * UMA LINHA DE {{cotacoes_recebidas}}: o texto do campo como está, e — no
 * spread do formato novo — a conta por extenso, para a IA não ler a comissão
 * como limitada nem os 5% como sobre a final.
 */
function linhaDaCotacao(fundo: string, c: CotacaoLida): string {
  const k = c.comissao
  if (k?.modalidade === 'spread' && k.centavos !== undefined && c.proposta !== null) {
    return `  - ${fundo}: proposta final ${formatarReais(c.proposta)}, comissão ${textoDaComissao(c)}`
  }
  return `  - ${fundo}: ${c.texto}`
}

/** A data de hoje em Brasília, dd/mm/aaaa. */
export function dataDeHoje(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(agora)
}

/** O que vem de fora do card e a função já resolveu (o teto, o relógio). */
export interface ExtrasDaJustificativa {
  /** O teto de RPV já escrito, ou ''. Só o RPV o preenche. */
  tetoRpv?: string
  agora?: Date
}

/**
 * OS VALORES DAS VARIÁVEIS, lidos do card.
 *
 * A FICHA DA ANÁLISE VEM PRIMEIRO para tribunal, ente e valor cedido: ela foi
 * lida dos autos. O cadastro do comercial é a reserva. Para o cedente e o
 * processo vale o cadastro (`lerCadastroDoCard`), que é a régua da plataforma
 * toda.
 *
 * AS FICHAS ANOTADAS NO CARD são notas NOSSAS (automáticas): elas não servem de
 * cadastro do card — é a regra do espelho —, mas aqui são justamente o que se
 * quer: o que a análise leu. Por isso a leitura de rótulos olha TODAS as notas,
 * as nossas por último (vencem as de gente) só para tribunal, ente e valor.
 */
export function valoresDoCard(card: CardDaJustificativa, extras: ExtrasDaJustificativa = {}): Record<string, string> {
  const notas = card.notas ?? []
  const daGente = notas.filter((n) => !n.automatica)
  const nossas = notas.filter((n) => n.automatica)
  const cadastro = lerCadastroDoCard({
    nome: card.nome,
    processo_cnj: card.processo_cnj,
    notas: notas.map((n) => ({ texto: String(n.texto ?? ''), automatica: !!n.automatica })),
    nota_texto: card.nota_texto,
  })
  const titulo = lerTituloCard(card.nome)
  const ficha = card.oportunidade?.ficha ?? null
  const daAnalise = (re: RegExp) => ultimoRotulo(nossas, re)
  const doComercial = (re: RegExp) =>
    ultimoRotulo(daGente.length > 0 ? daGente : [{ texto: card.nota_texto ?? '' }], re)

  const RE_TRIBUNAL = /^\s*TRIBUNAL:\s*(.+)$/im
  const RE_ENTE = /^\s*(?:ENTIDADE DEVEDORA|ENTE DEVEDOR):\s*(.+)$/im
  const RE_VALOR_CEDIDO = /^\s*VALOR CEDIDO:\s*(.+)$/im

  const tribunal =
    String(ficha?.tribunal ?? '').trim() ||
    daAnalise(RE_TRIBUNAL) ||
    doComercial(RE_TRIBUNAL) ||
    (tribunalDoCnj(cadastro.numero) ? `${tribunalDoCnj(cadastro.numero)} (pelo número do processo)` : '')

  const ente =
    String(ficha?.entidade_devedora ?? '').trim() || daAnalise(RE_ENTE) || doComercial(RE_ENTE)

  const parcela =
    doComercial(/^\s*PARCELA CEDIDA:\s*(.+)$/im) ||
    titulo.parcelaCedida ||
    String(ficha?.parcela_cedida ?? '').trim()

  const valorCedido = reais(ficha?.valor_cedido) || daAnalise(RE_VALOR_CEDIDO) || doComercial(RE_VALOR_CEDIDO)

  const meses = card.oportunidade?.prazoMeses
  const prazo = [
    typeof meses === 'number' && meses > 0
      ? `${meses.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${meses === 1 ? 'mês' : 'meses'}`
      : '',
    String(card.oportunidade?.dataPagamento ?? '').trim()
      ? `previsão ${String(card.oportunidade?.dataPagamento).trim()}`
      : '',
  ]
    .filter(Boolean)
    .join(', ')

  // A PROPOSTA: o fundo da nota do Escolher proposta, e a cotação DELE.
  const cotacoes = cotacoesDoCard(card.raw?.custom_fields_values ?? [])
  const fundo = fundoEscolhido(notas)
  const cotacaoDoFundo = fundo ? (cotacoes[fundo] ?? null) : null
  const valorProposta =
    cotacaoDoFundo?.proposta != null ? formatarReais(cotacaoDoFundo.proposta) : (cotacaoDoFundo?.texto ?? '')

  // TODAS AS COTAÇÕES, e as recusas pelas etiquetas: é o retrato do mercado
  // para este crédito, e a justificativa pode usá-lo como referência.
  const tags = card.tags ?? []
  const linhas: string[] = []
  for (const f of FUNDOS_DA_PRECIFICACAO) {
    const c = cotacoes[f]
    if (c) {
      linhas.push(linhaDaCotacao(f, c))
      continue
    }
    if (tags.some((t) => mesmaEtiqueta(t, `Reprovado ${f}`))) linhas.push(`  - ${f}: reprovou o crédito`)
  }

  return {
    funil: FUNIS_DA_JUSTIFICATIVA[Number(card.pipeline_id)] ?? '',
    cedente: cadastro.cedente || String(ficha?.cedente ?? '').trim(),
    processo: cadastro.numero,
    tribunal,
    ente_devedor: ente,
    parcela_cedida: parcela,
    valor_face: doComercial(/^\s*VALOR (?:DE FACE|FACE|NOMINAL|ORIGINAL):\s*(.+)$/im),
    valor_atualizado: doComercial(/^\s*VALOR ATUALIZADO:\s*(.+)$/im),
    valor_cedido: valorCedido,
    prazo_estimado: prazo,
    teto_rpv: Number(card.pipeline_id) === FUNIL_RPV_JUSTIFICATIVA ? (extras.tetoRpv ?? '') : '',
    fundo_escolhido: fundo,
    valor_proposta: valorProposta,
    comissao: textoDaComissao(cotacaoDoFundo),
    cotacoes_recebidas: linhas.length > 0 ? linhas.join('\n') : '',
    data_hoje: dataDeHoje(extras.agora),
  }
}

/** Para o teto: a esfera do ente pelo nome (a mesma ordem da análise de RPV). */
export function esferaDoEnte(ente: unknown, tribunal?: unknown): 'federal' | 'estadual' | 'municipal' | null {
  const e = String(ente ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  if (!e.trim()) return null
  const trib = String(tribunal ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (/\bmunicipio\b|prefeitura|camara municipal|\bmunicipal\b/.test(e)) return 'municipal'
  if (
    /\buniao\b|fazenda nacional|\binss\b|\bibama\b|\bdnit\b|\bincra\b|\bfunasa\b|\bfnde\b|\bibge\b|universidade federal|instituto federal|autarquia federal|fundacao.*federal/.test(e) ||
    /^TRF/.test(trib)
  ) return 'federal'
  return 'estadual'
}

/** O teto de RPV em uma linha, com a origem dita (ou '' quando não há número). */
export function textoDoTeto(t: {
  valor: number | null
  escopo?: string | null
  origem?: string | null
  municipio?: string | null
  vigencia?: string | null
  fonte?: string | null
} | null): string {
  if (!t || typeof t.valor !== 'number' || !(t.valor > 0)) return ''
  const partes = [reais(t.valor)]
  if (t.escopo === 'capital') partes.push('referência do município-capital — o do município devedor não foi apurado')
  if (t.origem === 'semente') partes.push('do mapa da plataforma, não conferido este ano')
  if (t.vigencia) partes.push(String(t.vigencia))
  if (t.fonte) partes.push(`fonte: ${t.fonte}`)
  return partes.join('; ')
}

// ------------------------------------------------------------------ as fontes

/** Uma fonte da pesquisa, como fica guardada e numerada. */
export interface FonteDaJustificativa {
  url: string
  titulo: string
}

/** A forma mínima dos blocos da resposta que a coleta lê (a da SDK serve). */
export interface BlocoDaResposta {
  type: string
  text?: string
  citations?: Array<{ type?: string; url?: string; title?: string | null }> | null
  content?: unknown
}

/** Endereço normalizado para não contar a mesma página duas vezes. */
const chaveDaUrl = (u: string) => u.trim().replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase()

/**
 * O DOSSIÊ DA PESQUISA e as fontes, a partir dos blocos da resposta.
 *
 * AS FONTES SÃO AS CITADAS, e as páginas abertas pelo web_fetch: a citação da
 * busca vem amarrada ao trecho do texto que ela sustenta, e é ela que dá a
 * lista de fontes do texto final. Cada bloco de texto citado ganha, no fim, os
 * números das fontes dele — "[1, 3]" — e é assim que a redação, que não vê as
 * citações da API, sabe qual número citar para cada fato.
 */
export function dossieDaResposta(blocos: readonly BlocoDaResposta[]): { texto: string; fontes: FonteDaJustificativa[] } {
  const fontes: FonteDaJustificativa[] = []
  const indice = new Map<string, number>()
  const numero = (url: string, titulo: string): number => {
    const k = chaveDaUrl(url)
    const ja = indice.get(k)
    if (ja) return ja
    fontes.push({ url: url.trim(), titulo: titulo.trim() || url.trim() })
    indice.set(k, fontes.length)
    return fontes.length
  }

  let texto = ''
  for (const b of blocos) {
    if (b.type === 'web_fetch_tool_result') {
      const c = b.content as { type?: string; url?: string; content?: { title?: string | null } } | null
      if (c && c.type === 'web_fetch_result' && c.url) numero(c.url, String(c.content?.title ?? ''))
      continue
    }
    if (b.type !== 'text' || !b.text) continue
    const nums: number[] = []
    for (const c of b.citations ?? []) {
      if (c?.type !== 'web_search_result_location' || !c.url) continue
      const n = numero(c.url, String(c.title ?? ''))
      if (!nums.includes(n)) nums.push(n)
    }
    texto += b.text + (nums.length > 0 ? ` [${nums.join(', ')}]` : '')
  }
  return { texto: texto.trim(), fontes }
}

/** A lista numerada que vai para a redação: "[1] Título — https://…". */
export function listaDeFontes(fontes: readonly FonteDaJustificativa[]): string {
  return fontes.map((f, i) => `[${i + 1}] ${f.titulo} — ${f.url}`).join('\n')
}

/**
 * O TEXTO FINAL, com as fontes renumeradas na ordem em que aparecem e a lista
 * no fim.
 *
 * SÓ AS CITADAS NO TEXTO entram na lista, renumeradas 1, 2, 3 na ordem da
 * leitura: a pesquisa pode ter juntado vinte páginas, e o cedente não precisa
 * de dezessete que o texto não usa. Número citado que não existe na lista (a IA
 * inventou um [9] com oito fontes) é retirado do texto — citação que não leva a
 * lugar nenhum é pior que nenhuma. Texto sem citação nenhuma sai sem lista.
 */
export function textoComFontes(
  redacao: string,
  fontes: readonly FonteDaJustificativa[],
): { texto: string; fontes: FonteDaJustificativa[] } {
  const novaOrdem = new Map<number, number>()
  const usadas: FonteDaJustificativa[] = []
  const corpo = String(redacao ?? '')
    .replace(/\[(\s*\d+\s*(?:[,;–-]\s*\d+\s*)*)\]/g, (_inteiro, dentro: string) => {
      const ns: number[] = []
      for (const parte of dentro.split(/[,;]/)) {
        const faixa = parte.split(/[–-]/).map((x) => Number(x.trim()))
        const [a, b] = faixa.length === 2 ? faixa : [faixa[0], faixa[0]]
        for (let n = a; n <= b && n - a < 50; n++) {
          if (!Number.isInteger(n) || n < 1 || n > fontes.length) continue
          if (!novaOrdem.has(n)) {
            usadas.push(fontes[n - 1])
            novaOrdem.set(n, usadas.length)
          }
          const novo = novaOrdem.get(n)!
          if (!ns.includes(novo)) ns.push(novo)
        }
      }
      return ns.length > 0 ? `[${ns.sort((x, y) => x - y).join(', ')}]` : ''
    })
    .replace(/[ \t]+([.,;:])/g, '$1')
    .trim()
  if (usadas.length === 0) return { texto: corpo, fontes: [] }
  return {
    texto: `${corpo}\n\nFONTES\n${listaDeFontes(usadas)}`,
    fontes: usadas,
  }
}

// ------------------------------------------------------------------ a nota no Kommo

/**
 * O TAMANHO DE CADA NOTA, em caracteres.
 *
 * O KOMMO NÃO DOCUMENTA LIMITE para o texto de uma nota `common` (conferido em
 * 05/10/2026 na referência v4: "Add notes" e "Notes" não dizem nada). O limite
 * prático conhecido de CRMs dessa família é o campo TEXT do banco, 64 KB — que,
 * com acento e emoji contando até 4 bytes, dá uns 16 mil caracteres no pior
 * caso. 10 mil fica com folga e ainda é uma nota legível no feed; a assinatura
 * de quem registrou entra por cima disso.
 */
export const NOTA_MAX_CARACTERES = 10_000

/**
 * O texto dividido em notas, em partes numeradas quando não cabe numa só.
 *
 * QUEBRA ONDE O TEXTO QUEBRA: entre parágrafos; um parágrafo maior que a nota
 * quebra entre linhas, e uma linha maior que a nota (não deveria haver) é
 * cortada no último espaço. Nenhuma parte sai vazia, e a soma das partes é o
 * texto inteiro.
 */
export function dividirNota(texto: string, limite = NOTA_MAX_CARACTERES): string[] {
  const t = String(texto ?? '').trim()
  if (!t) return []
  const cabecalho = (i: number, n: number) => `JUSTIFICATIVA TÉCNICA (parte ${i} de ${n})\n\n`
  // Espaço para o cabeçalho das partes (até "parte 99 de 99").
  const util = Math.max(200, limite - cabecalho(99, 99).length)
  if (t.length <= limite) return [t]

  const pedacos: string[] = []
  const quebrarLonga = (s: string): string[] => {
    const fora: string[] = []
    let resto = s
    while (resto.length > util) {
      let corte = resto.lastIndexOf(' ', util)
      if (corte < util * 0.5) corte = util
      fora.push(resto.slice(0, corte).trimEnd())
      resto = resto.slice(corte).trimStart()
    }
    if (resto) fora.push(resto)
    return fora
  }
  for (const par of t.split(/\n{2,}/)) {
    if (par.length <= util) pedacos.push(par)
    else {
      let atual = ''
      for (const linha of par.split('\n')) {
        for (const l of linha.length > util ? quebrarLonga(linha) : [linha]) {
          if (atual && atual.length + 1 + l.length > util) {
            pedacos.push(atual)
            atual = l
          } else atual = atual ? `${atual}\n${l}` : l
        }
      }
      if (atual) pedacos.push(atual)
    }
  }

  const partes: string[] = []
  let atual = ''
  for (const p of pedacos) {
    if (atual && atual.length + 2 + p.length > util) {
      partes.push(atual)
      atual = p
    } else atual = atual ? `${atual}\n\n${p}` : p
  }
  if (atual) partes.push(atual)
  return partes.map((p, i) => cabecalho(i + 1, partes.length) + p)
}

// ------------------------------------------------------------------ os estados e a trava

export type EstadoDaJustificativa = 'gerando' | 'pronta' | 'falha' | 'enviada'
export type EtapaDaJustificativa = 'lendo' | 'pesquisando' | 'redigindo'

/** A linha de `justificativa_tecnica`, no que as regras leem. */
export interface LinhaDaJustificativa {
  kommo_lead_id: number
  status: EstadoDaJustificativa
  etapa?: EtapaDaJustificativa | null
  tentativa?: string | null
  texto?: string | null
  texto_editado?: string | null
  texto_enviado?: string | null
  erro?: string | null
  atualizado_em?: string | null
  enviando_desde?: string | null
  enviado_em?: string | null
}

/**
 * Uma geração parada há mais que isto morreu (o worker foi derrubado no meio).
 *
 * Pouco acima do teto de tempo de parede de uma invocação (400 s ≈ 6,7 min):
 * cada etapa é uma invocação nova e grava `atualizado_em` ao começar, então
 * parado há mais de 8 minutos é morte, não lentidão.
 */
export const TRAVA_GERACAO_MIN = 8
/** Um envio que não terminou em 3 minutos morreu — a nota é uma chamada só. */
export const TRAVA_ENVIO_MIN = 3
/** Quantas gerações podem correr ao mesmo tempo na casa toda (limite de taxa da API). */
export const MAX_GERACOES_SIMULTANEAS = 3

const minutosDesde = (iso: unknown, agora: number): number => {
  const t = Date.parse(String(iso ?? ''))
  return Number.isFinite(t) ? (agora - t) / 60_000 : Infinity
}

/** A geração está parada (morta)? Só faz sentido com status 'gerando'. */
export function geracaoParada(l: Pick<LinhaDaJustificativa, 'status' | 'atualizado_em'>, agora = Date.now()): boolean {
  return l.status === 'gerando' && minutosDesde(l.atualizado_em, agora) > TRAVA_GERACAO_MIN
}

/** O texto que a janela mostra: o editado, se houver, senão o gerado. */
export function textoEmVigor(l: Pick<LinhaDaJustificativa, 'texto' | 'texto_editado' | 'texto_enviado' | 'status'>): string {
  if (l.status === 'enviada' && l.texto_enviado) return l.texto_enviado
  return l.texto_editado ?? l.texto ?? ''
}

/**
 * PODE GERAR AGORA? A regra do servidor, dita uma vez.
 *
 *   - sem linha: gera (é a primeira abertura da janela);
 *   - gerando e viva: NÃO — a geração em curso é a que vale (o clique duplo e a
 *     segunda aba caem aqui);
 *   - gerando e parada: gera de novo, por cima da que morreu;
 *   - pronta, falha ou enviada: só com `refazer` — gerar é pago, e reabrir a
 *     janela não pode pagar de novo. A falha também pede `refazer`, para a
 *     tela ser quem decide tentar outra vez (o botão "Tentar de novo").
 *
 * A TRAVA DE VERDADE É O BANCO (update condicional na `tentativa` lida), e não
 * esta função: ela decide se vale tentar; duas abas que passem por ela juntas
 * ainda disputam a mesma linha, e só uma ganha.
 */
export function podeGerar(
  linha: LinhaDaJustificativa | null,
  refazer: boolean,
  agora = Date.now(),
): { ok: true } | { ok: false; motivo: 'em-curso' | 'ja-existe' } {
  if (!linha) return { ok: true }
  if (linha.status === 'gerando') return geracaoParada(linha, agora) ? { ok: true } : { ok: false, motivo: 'em-curso' }
  return refazer ? { ok: true } : { ok: false, motivo: 'ja-existe' }
}

/**
 * PODE ENVIAR? Só a justificativa pronta, com texto, e sem outro envio vivo.
 * A enviada não se reenvia daqui: a janela dela é só leitura, e reenviar
 * duplicaria a nota no card — o caminho é gerar de novo.
 */
export function podeEnviar(
  linha: LinhaDaJustificativa | null,
  texto: string,
  agora = Date.now(),
): { ok: true } | { ok: false; erro: string } {
  if (!linha) return { ok: false, erro: 'Não há justificativa gerada para este card.' }
  if (linha.status === 'enviada') return { ok: false, erro: 'Esta justificativa já foi enviada ao Kommo.' }
  if (linha.status === 'gerando') return { ok: false, erro: 'A justificativa ainda está sendo gerada.' }
  if (linha.status !== 'pronta') return { ok: false, erro: 'A geração falhou: gere de novo antes de enviar.' }
  if (!String(texto ?? '').trim()) return { ok: false, erro: 'O texto está vazio: nada a enviar.' }
  if (linha.enviando_desde && minutosDesde(linha.enviando_desde, agora) <= TRAVA_ENVIO_MIN) {
    return { ok: false, erro: 'Esta justificativa já está sendo enviada (outra aba ou um clique repetido).' }
  }
  return { ok: true }
}

/** O rascunho só se grava na pronta: a gerando não tem texto, a enviada é registro. */
export function aceitaRascunho(linha: Pick<LinhaDaJustificativa, 'status'> | null): boolean {
  return linha?.status === 'pronta'
}

/** A frase da etapa, para a janela. */
export const ROTULO_DA_ETAPA: Readonly<Record<EtapaDaJustificativa, string>> = {
  lendo: 'Lendo o crédito',
  pesquisando: 'Pesquisando na internet',
  redigindo: 'Redigindo a justificativa',
}

// ------------------------------------------------------------------ o consumo

/** O que uma geração gastou, somado chamada a chamada. */
export interface ConsumoDaJustificativa {
  modelo?: string
  chamadas: number
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
  buscas: number
  fetches: number
  segundos: number
}

export const CONSUMO_ZERO: ConsumoDaJustificativa = {
  chamadas: 0, input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0, buscas: 0, fetches: 0, segundos: 0,
}

/** Soma o `usage` de uma resposta ao consumo acumulado. Campo ausente conta zero. */
export function somarConsumo(
  antes: Partial<ConsumoDaJustificativa> | null | undefined,
  usage: {
    input_tokens?: number | null
    output_tokens?: number | null
    cache_creation_input_tokens?: number | null
    cache_read_input_tokens?: number | null
    server_tool_use?: { web_search_requests?: number | null; web_fetch_requests?: number | null } | null
  } | null | undefined,
): ConsumoDaJustificativa {
  const a = { ...CONSUMO_ZERO, ...(antes ?? {}) }
  const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0)
  return {
    ...a,
    chamadas: a.chamadas + 1,
    input_tokens: a.input_tokens + n(usage?.input_tokens),
    output_tokens: a.output_tokens + n(usage?.output_tokens),
    cache_creation_input_tokens: a.cache_creation_input_tokens + n(usage?.cache_creation_input_tokens),
    cache_read_input_tokens: a.cache_read_input_tokens + n(usage?.cache_read_input_tokens),
    buscas: a.buscas + n(usage?.server_tool_use?.web_search_requests),
    fetches: a.fetches + n(usage?.server_tool_use?.web_fetch_requests),
  }
}

// ------------------------------------------------------------------ o banco antes da migração

/**
 * O erro diz que a tabela não existe? É a migração 0076 que não rodou.
 *
 * As formas que o PostgREST e o Postgres usam: PGRST205 ("Could not find the
 * table … in the schema cache"), 42P01 ("relation … does not exist").
 */
export function ehTabelaAusente(erro: unknown): boolean {
  const e = erro as { code?: unknown; message?: unknown } | null
  const codigo = String(e?.code ?? '')
  const msg = String(e?.message ?? erro ?? '')
  return (
    codigo === 'PGRST205' ||
    codigo === '42P01' ||
    /PGRST205|schema cache|relation .*justificativa_tecnica.* does not exist|justificativa_tecnica.*does not exist/i.test(msg)
  )
}

/** A frase única do "falta rodar a migração", para a tela e a função dizerem igual. */
export const AVISO_MIGRACAO_0076 =
  'A justificativa técnica ainda não está ligada no banco: falta rodar a migração 0076 ' +
  '(0076_justificativa_tecnica.sql) no SQL Editor do Supabase. Nada foi gerado nem cobrado.'
