// A COTAÇÃO QUE UM FUNDO DEVOLVEU: o valor da proposta e a comissão, e o texto
// com que ela fica gravada no card do Kommo.
//
// Pedido do dono em 05/10/2026: ao marcar "Cotado ‹fundo›" na Em precificação, a
// pessoa diz quanto o fundo ofereceu, e o valor vai para o campo daquele fundo
// no grupo "Cotações/propostas" do card. A janela "Escolher proposta" lê esses
// campos de volta, para comparar os fundos lado a lado.
//
// O TEXTO DO CAMPO É EXATAMENTE
//   "R$ 850.000,00 / R$ 40.000,00"   (proposta / comissão limitada)
//   "R$ 850.000,00 / Spread"         (a casa desconta o que puder da proposta)
// com espaço comum depois do "R$" — e não o espaço inseparável do
// `toLocaleString`, que no Kommo parece igual e não é: quem buscar "R$ 850" lá
// dentro não acharia. Por isso a formatação é feita à mão, em centavos inteiros
// (sem vírgula flutuante no caminho do dinheiro).
//
// A LEITURA DE VOLTA É TOLERANTE, porque o campo é de texto e o comercial pode
// escrever nele pelo Kommo: "850 mil / 40 mil", "R$ 850.000 - spread",
// "850000". O que não se lê com segurança fica como texto, sem número — melhor
// mostrar o que está escrito do que um valor adivinhado.
//
// MÓDULO PURO — sem `npm:` e sem `Deno.` —: roda no vitest, no navegador e na
// Edge Function (a `kommo-etiquetar`), e os dois lados escrevem o mesmo texto.

import { FUNDOS_DA_PRECIFICACAO, normalizarEtiqueta } from './etiquetasDoFundo.ts'

// ------------------------------------------------------------------ dinheiro

/** Teto de sanidade: R$ 1 trilhão. Acima disso é dígito colado a mais. */
const TETO_CENTAVOS = 100_000_000_000_000

/** "850.000,00" — os reais com ponto de milhar e vírgula, sem o "R$". */
export function formatarReaisSemPrefixo(centavos: number): string {
  const c = Math.round(Math.abs(centavos))
  const inteiro = String(Math.floor(c / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  const fracao = String(c % 100).padStart(2, '0')
  return `${centavos < 0 ? '-' : ''}${inteiro},${fracao}`
}

/** "R$ 1.234.567,89", com espaço COMUM depois do "R$" (ver o cabeçalho). */
export function formatarReais(centavos: number): string {
  return `R$ ${formatarReaisSemPrefixo(centavos)}`
}

/**
 * Lê um valor em reais escrito por gente e devolve CENTAVOS, ou null.
 *
 * O QUE SE LÊ (e é o que se cola de planilha, de e-mail e de WhatsApp):
 *   "850000" · "850.000" · "850.000,00" · "R$ 850.000,00" · "850000,5"
 *   "850000.00" (ponto decimal com DUAS casas, de sistema que exporta assim)
 *   "850 mil" · "1,5 mi" · "1.5 milhão" · "2 milhões"
 *
 * O QUE NÃO SE LÊ, de propósito: o que tem duas leituras. "850.5" (ponto com
 * uma casa e sem "mil"/"mi") pode ser 850,50 ou um dígito comido; "1.23.456",
 * "12,345" (vírgula com três casas é o milhar dos americanos). Devolver null
 * aqui é o que deixa o campo vazio para a pessoa conferir — um número errado
 * gravado no card seria comparado com os outros fundos como se fosse certo.
 */
export function lerReais(texto: unknown): number | null {
  let s = String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\s  ]+/g, ' ')
    .trim()
  s = s.replace(/^r\s?\$\s?/, '').replace(/^rs\s/, '').trim()
  if (!s) return null

  let mult = 1
  const escala = s.match(/^(.*?)\s*(mil|mi|mm|milhao|milhoes)\.?$/)
  if (escala) {
    s = escala[1].trim()
    mult = escala[2] === 'mil' ? 1_000 : 1_000_000
  }
  s = s.replace(/ /g, '')
  if (!s) return null

  let inteiro: string
  let fracao = ''
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s)) {
    // "850.000" e "850.000,00": o ponto é o milhar.
    const [i, f = ''] = s.split(',')
    inteiro = i.replace(/\./g, '')
    fracao = f
  } else if (/^\d+(,\d{1,2})?$/.test(s)) {
    // "850000" e "850000,5".
    const [i, f = ''] = s.split(',')
    inteiro = i
    fracao = f
  } else if (/^\d+\.\d{2}$/.test(s) || (mult > 1 && /^\d+\.\d{1,2}$/.test(s))) {
    // "850000.00" (duas casas: é decimal) e "1.5 mi" (com escala, o ponto não é
    // milhar — "1.500 mi" já caiu no primeiro caso).
    const [i, f] = s.split('.')
    inteiro = i
    fracao = f
  } else {
    return null
  }

  const centavos = (Number(inteiro) * 100 + Number(fracao.padEnd(2, '0'))) * mult
  if (!Number.isFinite(centavos) || centavos > TETO_CENTAVOS) return null
  return Math.round(centavos)
}

// ------------------------------------------------------------------ cotação

/**
 * A COMISSÃO, em duas modalidades:
 *   - LIMITADA: o fundo já diz quanto aceita pagar de comissão, em reais;
 *   - SPREAD: a casa desconta o que puder do valor da proposta — não há valor.
 */
export type Comissao = { modalidade: 'limitada'; centavos: number } | { modalidade: 'spread' }

export interface Cotacao {
  propostaCentavos: number
  comissao: Comissao
}

/** O texto do campo do fundo no Kommo: "R$ 850.000,00 / R$ 40.000,00" ou "R$ 850.000,00 / Spread". */
export function textoDaCotacao(c: Cotacao): string {
  const comissao = c.comissao.modalidade === 'spread' ? 'Spread' : formatarReais(c.comissao.centavos)
  return `${formatarReais(c.propostaCentavos)} / ${comissao}`
}

const centavosValidos = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n > 0 && n <= TETO_CENTAVOS

/**
 * A cotação que chegou na requisição, conferida — é a porta do servidor.
 *
 * EM CENTAVOS INTEIROS, e não em reais com casas: 0,1 + 0,2 não é 0,3 em ponto
 * flutuante, e um centavo a mais no card é um centavo que ninguém digitou.
 */
export function validarCotacao(x: unknown): { ok: true; cotacao: Cotacao } | { ok: false; erro: string } {
  const c = (x ?? {}) as { propostaCentavos?: unknown; comissao?: { modalidade?: unknown; centavos?: unknown } }
  if (!centavosValidos(c.propostaCentavos)) {
    return { ok: false, erro: 'Informe o valor da proposta (em reais, maior que zero).' }
  }
  const m = c.comissao?.modalidade
  if (m === 'spread') {
    return { ok: true, cotacao: { propostaCentavos: c.propostaCentavos, comissao: { modalidade: 'spread' } } }
  }
  if (m === 'limitada') {
    if (!centavosValidos(c.comissao?.centavos)) {
      return { ok: false, erro: 'Com a comissão limitada, informe o valor da comissão (em reais, maior que zero).' }
    }
    return {
      ok: true,
      cotacao: {
        propostaCentavos: c.propostaCentavos,
        comissao: { modalidade: 'limitada', centavos: c.comissao!.centavos as number },
      },
    }
  }
  return { ok: false, erro: 'A comissão precisa ser "limitada" ou "spread".' }
}

/** O que se leu de um campo de cotação: os números, quando se leem, e o texto como está. */
export interface CotacaoLida {
  /** O texto do campo, como está no Kommo (aparado). */
  texto: string
  /** A proposta em centavos, ou null se o texto não a diz com segurança. */
  proposta: number | null
  /** A comissão, ou null se o texto não a diz. */
  comissao: Comissao | null
}

/** Os rótulos que alguém pode ter escrito antes do número, no Kommo. */
const ROTULO = /^(?:proposta|valor(?:\s+da\s+proposta)?|comissao|com\.?|cotacao)\s*[:=-]?\s*/

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/**
 * LÊ DE VOLTA o texto do campo do fundo — o que a plataforma gravou e o que
 * alguém digitou à mão no Kommo.
 *
 * Devolve null para o campo vazio (inclusive o "..." que o Kommo mostra em campo
 * sem valor, se alguém o digitar). Com texto, devolve sempre o texto, e os
 * números só quando se leem: "proposta boa, ligar" fica como texto, sem valor.
 */
export function lerCotacao(texto: unknown): CotacaoLida | null {
  const bruto = String(texto ?? '').replace(/\s+/g, ' ').trim()
  if (!bruto || /^[.…\-–—\s]*$/.test(bruto)) return null

  // A PRIMEIRA BARRA (ou |, ;, ou travessão entre espaços) separa as duas partes.
  const partes = bruto.split(/\s*[/|;]\s*|\s+[-–—]\s+/)
  const [p1, ...resto] = partes
  const p2 = resto.join(' ')

  const limpa = (s: string) => semAcento(s).trim().replace(ROTULO, '')
  const temSpread = (s: string) => /\bspread\b/.test(semAcento(s))

  let proposta = lerReais(limpa(p1))
  let comissao: Comissao | null = null
  if (resto.length > 0) {
    if (temSpread(p2)) comissao = { modalidade: 'spread' }
    else {
      const c = lerReais(limpa(p2))
      if (c !== null && c > 0) comissao = { modalidade: 'limitada', centavos: c }
    }
  } else if (temSpread(p1)) {
    // "850 mil spread", sem separador.
    comissao = { modalidade: 'spread' }
    proposta = lerReais(limpa(semAcento(p1).replace(/\bspread\b/, '')))
  }
  if (proposta !== null && proposta <= 0) proposta = null
  return { texto: bruto, proposta, comissao }
}

// ------------------------------------------------------------------ os campos do Kommo

/** Um campo personalizado de lead, como `GET /leads/custom_fields` o devolve (o que usamos). */
export interface CampoDoKommo {
  id: number
  name: string
  type: string
  /** "leads_1592396812437", ou null/ausente no grupo principal. */
  group_id?: string | null
}

/** Um grupo (aba) de campos, como `GET /leads/custom_fields/groups` o devolve. */
export interface GrupoDoKommo {
  id: string
  name: string
}

/**
 * Os tipos de campo que guardam um texto livre. `numeric` e `price` não aceitam
 * "R$ 850.000,00 / Spread", e `select` só aceita uma das opções dele.
 */
export const TIPOS_QUE_ACEITAM_TEXTO: readonly string[] = ['text', 'textarea']

/** O nome do grupo de campos que o dono criou no card. */
export const NOME_DO_GRUPO_DAS_COTACOES = 'Cotações/propostas'

/**
 * A CHAVE DE UM NOME, para casar o fundo com o campo: sem acento, sem caixa e
 * só letra e número. "PJUS" é "PJus"; "K&WC Ativos" é "K & WC Ativos".
 */
export function chaveDoNome(nome: unknown): string {
  return normalizarEtiqueta(nome).replace(/[^A-Z0-9]/g, '')
}

/** "Cotações/propostas", "Cotacoes / Propostas", "Cotações e propostas"… */
export function ehGrupoDasCotacoes(nome: unknown): boolean {
  const k = chaveDoNome(nome)
  return k.includes('COTAC') && k.includes('PROPOST')
}

/**
 * O CAMPO DO FUNDO, achado pelo NOME entre os campos de lead da conta.
 *
 * O DO GRUPO "Cotações/propostas" PRIMEIRO: um campo "BTG" noutra aba (de outro
 * assunto) não pode receber a cotação. Sem campo do fundo no grupo — ou sem o
 * grupo —, vale o de mesmo nome em qualquer aba, se for um só.
 *
 * O ERRO DIZ O QUE FALTA, com o nome: é ele que aparece na janela, e é com ele
 * que alguém vai ao Kommo criar ou corrigir o campo.
 */
export function campoDoFundo(
  fundo: string,
  campos: readonly CampoDoKommo[],
  grupos: readonly GrupoDoKommo[],
): { ok: true; campo: CampoDoKommo } | { ok: false; erro: string } {
  const chave = chaveDoNome(fundo)
  const candidatos = campos.filter((c) => chaveDoNome(c.name) === chave)
  const doGrupo = new Set(grupos.filter((g) => ehGrupoDasCotacoes(g.name)).map((g) => g.id))
  const noGrupo = candidatos.filter((c) => c.group_id != null && doGrupo.has(c.group_id))
  const escolhidos = noGrupo.length > 0 ? noGrupo : candidatos

  if (escolhidos.length === 0) {
    return {
      ok: false,
      erro:
        `Falta no Kommo o campo "${fundo}" no grupo "${NOME_DO_GRUPO_DAS_COTACOES}" do card. ` +
        'Crie o campo (de texto) com o nome do fundo e tente de novo.',
    }
  }
  if (escolhidos.length > 1) {
    return {
      ok: false,
      erro:
        `Há ${escolhidos.length} campos chamados "${fundo}" no Kommo` +
        (noGrupo.length > 0 ? ` dentro do grupo "${NOME_DO_GRUPO_DAS_COTACOES}"` : '') +
        ', e não sei em qual gravar. Deixe um só.',
    }
  }
  const campo = escolhidos[0]
  if (!TIPOS_QUE_ACEITAM_TEXTO.includes(campo.type)) {
    return {
      ok: false,
      erro:
        `O campo "${campo.name}" do Kommo é do tipo "${campo.type}", que não aceita o texto da cotação. ` +
        'Troque-o por um campo de texto.',
    }
  }
  return { ok: true, campo }
}

// ------------------------------------------------------------------ a leitura do card

/** Um valor de campo, como vem em `custom_fields_values` do lead (o que usamos). */
export interface ValorDeCampo {
  field_id?: number | null
  field_name?: string | null
  field_type?: string | null
  values?: { value?: unknown }[] | null
}

/** O texto de um valor de campo (o primeiro valor, que é o que um campo de texto tem). */
function textoDoValor(v: ValorDeCampo): string {
  const x = v.values?.[0]?.value
  return typeof x === 'string' || typeof x === 'number' ? String(x) : ''
}

/**
 * AS COTAÇÕES DO CARD, por fundo (na ordem da tela), lidas de
 * `custom_fields_values` — o que o espelho guarda em `raw` e o que a
 * `kommo-etiquetar` devolve depois de gravar.
 *
 * PELO NOME DO CAMPO, porque é o que o lead traz: os valores não dizem a que
 * grupo o campo pertence. Havendo dois campos com o nome do fundo, vale o que
 * tem uma cotação legível — o da aba "Cotações/propostas" é o que a plataforma
 * escreve, e escreve sempre legível.
 */
export function cotacoesDoCard(
  valores: readonly ValorDeCampo[] | null | undefined,
  fundos: readonly string[] = FUNDOS_DA_PRECIFICACAO,
): Record<string, CotacaoLida | null> {
  const fora: Record<string, CotacaoLida | null> = {}
  for (const fundo of fundos) {
    const chave = chaveDoNome(fundo)
    const lidas = (valores ?? [])
      .filter((v) => chaveDoNome(v.field_name) === chave)
      .map((v) => lerCotacao(textoDoValor(v)))
      .filter((l): l is CotacaoLida => l !== null)
    fora[fundo] = lidas.find((l) => l.proposta !== null) ?? lidas[0] ?? null
  }
  return fora
}

/**
 * Os valores de campo do card com o do fundo trocado — o que a tela põe no
 * cache depois de gravar, quando a releitura do card não voltou.
 */
export function comCotacaoGravada(
  valores: readonly ValorDeCampo[] | null | undefined,
  campo: { id: number; name: string; type?: string },
  texto: string,
): ValorDeCampo[] {
  const outros = (valores ?? []).filter((v) => v.field_id !== campo.id)
  return [...outros, { field_id: campo.id, field_name: campo.name, field_type: campo.type ?? 'text', values: [{ value: texto }] }]
}
