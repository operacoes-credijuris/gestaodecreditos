// O CADASTRO DO CARD: o que o título e as anotações do comercial dizem do crédito.
//
// MORA EM _shared desde 28/09/2026. Até ali só a tela lia o cadastro — e ele
// decide coisas caras: QUAL VERBA foi cedida (é sobre ela que a ficha calcula o
// valor), o número do processo, o nome da pasta no Drive. O CONECTOR passou a
// gravar a planilha jurídica quando o Claude a entrega, e precisa desses mesmos
// dados; uma segunda leitura, escrita no servidor, divergiria da tela na
// primeira vírgula. src/lib/kommo.ts reexporta tudo daqui.
//
// MÓDULO PURO — sem `Deno.` e sem `npm:`.

import { primeiroCnj } from './nucleo/cnj.ts'


/** O separador dos campos no título, como o comercial escreve. */
const SEP_TITULO = ' - '

/**
 * O separador na leitura: o hífen entre espaços, e as variantes tipográficas.
 *
 * O TRAVESSÃO ENTRA porque não é outro formato — é o mesmo caractere depois de
 * passar pela correção automática do teclado ou de um colar do Word. Exigir o
 * hífen exato fazia o título inteiro virar uma parte só, e daí não se lê nem o
 * intermediador (que é obrigatório): a análise nem começava.
 *
 * OS ESPAÇOS EM VOLTA SÃO OBRIGATÓRIOS, e é isso que salva o número: o CNJ tem
 * um hífen dentro ("0001234-56"), e sem exigir espaço ele seria separador.
 */
const RE_SEPARADOR = /\s+[-–—]\s+/

/** Uma porcentagem colada no fim de uma frase: "principal + honorários 30%". */
const RE_PORCENTAGEM_NO_FIM = /(\d{1,3}(?:[.,]\d+)?)\s*%\s*$/

/** Uma porcentagem e nada mais: "30", "30%", "12,5%". */
const RE_SO_PORCENTAGEM = /^(\d{1,3}(?:[.,]\d+)?)\s*%?$/
/** Palavra que só aparece em nome de verba, nunca em nome de pessoa ou empresa. */
const RE_VERBA = /principal|honor|sucumb|contratu/i

// O CNJ que houver num pedaço de texto, sempre pontuado. A leitura mora em
// _shared/nucleo/cnj.ts, com o resto: eram três implementações da mesma coisa, e
// a do kommo-sync — que não reconhecia o número cru — gravava no espelho o
// processo citado numa ANOTAÇÃO em vez do do título.
const cnjNoTexto = primeiroCnj

/** O que o título do card diz. Campo ausente vem como ''. */
export interface DadosDoTitulo {
  intermediador: string
  cedente: string
  /** CNJ pontuado. */
  numero: string
  /** O texto cru da parcela cedida — quem classifica é classificarParcelaCedida. */
  parcelaCedida: string
  /** Porcentagem pronta para Number(): "30", "12.5". */
  honorariosPct: string
}

const TITULO_VAZIO: DadosDoTitulo = {
  intermediador: '', cedente: '', numero: '', parcelaCedida: '', honorariosPct: '',
}

/**
 * Os campos do crédito escritos no título do card.
 *
 * O comercial vem encurtando o cadastro, e o destino disso é o título carregar
 * tudo: "[intermediador] - [cedente] - [nº] - [parcela cedida] - [% honorários]".
 *
 * LIDO POR CONTEÚDO, NÃO POR POSIÇÃO, e a diferença importa. Ler por posição
 * significa que um nome com " - " dentro — "SILVA - ADVOGADOS ASSOCIADOS" —
 * empurra todos os campos seguintes uma casa, e a parcela cedida passa a ser
 * lida do lugar do número. Isso não dá erro: precifica a verba errada e a
 * análise sai completa.
 *
 * Então o que ancora tudo é o NÚMERO CNJ, que é inconfundível. Antes dele estão
 * o intermediador (a primeira parte) e o cedente (o que sobra até o número,
 * remontado com o separador, o que devolve o nome inteiro); depois dele estão a
 * parcela cedida e a porcentagem, cada uma reconhecida pelo que é e em qualquer
 * ordem. As palavras de verba só são procuradas DEPOIS do número, para um
 * cedente chamado "Principal Logística" não virar parcela cedida.
 *
 * Título sem número reconhecível cai na leitura posicional antiga — as duas
 * primeiras partes —, porque sem a âncora não há como saber onde o nome termina.
 */
export function lerTituloCard(titulo: unknown): DadosDoTitulo {
  const cru = String(titulo ?? '').split(RE_SEPARADOR).map((p) => p.trim())

  // A PORCENTAGEM É INCONFUNDÍVEL EM QUALQUER POSIÇÃO: nenhum nome de pessoa ou
  // de empresa é um número solto de até três dígitos. Então ela é colhida antes
  // de tudo e RETIRADA da lista — escrita fora do lugar combinado, ela deixa de
  // entrar no nome do cedente, que era o efeito de lê-la pela posição. Até três
  // dígitos, de propósito: assim um ano ("2023") não é confundido com ela.
  //
  // Vírgula é o decimal, e ponto também: porcentagem não tem separador de
  // milhar, então não há o que descartar.
  let honorariosPct = ''
  const partes: string[] = []
  cru.forEach((p, i) => {
    const m = i > 0 && !honorariosPct ? p.match(RE_SO_PORCENTAGEM) : null
    if (m) honorariosPct = m[1].replace(',', '.')
    else partes.push(p)
  })

  const iCnj = partes.findIndex((p) => cnjNoTexto(p))
  if (iCnj < 0) {
    return {
      ...TITULO_VAZIO,
      honorariosPct,
      intermediador: partes[0] ?? '',
      cedente: partes[1] ?? '',
    }
  }

  // TODAS as partes de verba, juntadas — não a primeira.
  //
  // "principal - honorários" é uma parcela cedida escrita com o separador entre
  // as verbas, e é escrita provável: o hífen é o que o comercial já usa para
  // tudo no título. Pegando só a primeira, isso virava cessão SÓ DO PRINCIPAL —
  // o honorário caía fora do negócio sem nada acusar. Juntadas, a classificação
  // vê as duas verbas e responde "ambos", que é o que estava escrito.
  const verbas: string[] = []
  for (const p of partes.slice(iCnj + 1)) {
    if (!RE_VERBA.test(p)) continue
    // "principal + honorários 30%" numa parte só, sem separar: a verba fica e a
    // porcentagem colada nela é aproveitada. AQUI O SINAL DE % É EXIGIDO —
    // número solto no meio de uma frase pode ser qualquer coisa, e adivinhar
    // seria pior que perder.
    const m = p.match(RE_PORCENTAGEM_NO_FIM)
    if (!m) {
      verbas.push(p)
      continue
    }
    if (!honorariosPct) honorariosPct = m[1].replace(',', '.')
    verbas.push(p.slice(0, m.index).replace(/[\s,;:]+$/, ''))
  }

  return {
    intermediador: iCnj > 0 ? partes[0] : '',
    cedente: iCnj > 1 ? partes.slice(1, iCnj).join(SEP_TITULO) : '',
    numero: cnjNoTexto(partes[iCnj]),
    parcelaCedida: verbas.join(SEP_TITULO),
    honorariosPct,
  }
}

// ---------- A anotação do comercial ----------

/**
 * Um ponto-e-vírgula seguido de outro rótulo — "; HONORÁRIOS C.:".
 *
 * A anotação é texto livre, e o comercial escreve os campos NUMA LINHA SÓ.
 * Capturar do rótulo até o fim da linha fazia "PARCELA CEDIDA: principal;
 * HONORÁRIOS C.: 30%" valer "principal; HONORÁRIOS C.: 30%" — e a palavra
 * "honorários" ali dentro classificava uma cessão de PRINCIPAL como PRINCIPAL
 * + HONORÁRIOS. O erro não aparece em lugar nenhum: a análise sai completa,
 * com uma verba a mais no preço — justamente a que fica com o advogado.
 *
 * O PONTO-E-VÍRGULA SOZINHO NÃO CORTA: "honorários contratuais +
 * sucumbenciais; sem principal" é um valor só. O que corta é o rótulo depois
 * dele — dois-pontos precedidos de poucas palavras.
 */
const RE_PROXIMO_ROTULO = /;\s*[^:;\n]{1,40}:/

/** O valor de um campo da anotação: do rótulo até o fim da linha ou até o próximo rótulo. */
export function valorDoCampo(bruto: unknown): string {
  const t = String(bruto ?? '')
  const m = t.match(RE_PROXIMO_ROTULO)
  return (m ? t.slice(0, m.index) : t).trim()
}

/**
 * O que está sendo cedido, lido do "PARCELA CEDIDA" das anotações do card.
 *
 * Os quatro valores correspondem, um a um, aos quatro cenários da planilha de
 * precificação e à lista suspensa da célula C3 da aba jurídica. É esta
 * classificação que decide qual coluna sobra no arquivo entregue e sobre o que
 * o deságio é calibrado — errar aqui precifica a coisa errada, em silêncio.
 *
 * 'auto' = o card não disse; quem decide passa a ser o destaque dos honorários
 * nos cálculos da contadoria.
 */
export type ParcelaCedida =
  | 'principal'      // só o crédito principal
  | 'ambos'          // principal + honorários
  | 'honorarios'     // honorários contratuais E sucumbenciais
  | 'contratuais'    // só os honorários contratuais
  | 'sucumbenciais'  // só os honorários sucumbenciais
  | 'indefinido'     // diz "honorários" e não diz quais — resolva contra os autos
  | 'auto'           // o card não disse nada

export function classificarParcelaCedida(texto: unknown): ParcelaCedida {
  const t = String(texto ?? '').toLowerCase()
  const principal = /principal/.test(t)
  const sucumbenciais = /sucumb/.test(t)
  const contratuais = /contratu/.test(t)
  const honorarios = /honor/.test(t) || sucumbenciais || contratuais

  if (principal && honorarios) return 'ambos'
  if (principal) return 'principal'

  // Daqui para baixo é cessão só de honorários, e QUAL verba muda o preço:
  // contratuais saem do bolo do principal, sucumbenciais vêm por fora, pagos
  // pelo vencido. Somar as duas quando só uma foi cedida é comprar crédito que
  // não vem junto.
  if (contratuais && sucumbenciais) return 'honorarios'      // as duas verbas
  if (sucumbenciais) return 'sucumbenciais'                  // só a do vencido
  // Card que diz só "contratuais" é, quase sempre, processo SEM sucumbenciais —
  // não cessão que os deixa de fora. Por isso o preço trata este caso igual ao
  // de cima (cede-se o honorário que existe); a distinção sobrevive aqui só
  // para o motor poder avisar quando o processo tiver a outra verba.
  if (contratuais) return 'contratuais'                      // só a do contrato

  // "HONORÁRIOS", SEM DIZER QUAIS: A PERGUNTA VAI PARA OS AUTOS.
  //
  // Quem responde é o motor, e só ele pode: a maioria das RPVs vem do JUIZADO
  // ESPECIAL, onde não há sucumbência em primeiro grau (art. 55 da Lei
  // 9.099/95) — existe um honorário só, o contratual, e "honorários" não é
  // ambíguo ali. Havendo as DUAS verbas no processo, aí sim a escolha é real
  // (contratuais saem de dentro do principal, sucumbenciais vêm por fora,
  // pagos pelo vencido) e a análise para, pedindo que o card diga qual.
  //
  // Esta função não sabe o que há nos autos, então não decide: devolve
  // 'indefinido', que quer dizer "resolva contra o processo".
  if (honorarios) return 'indefinido'
  return 'auto'
}


/** Uma anotação do card, no que a leitura do cadastro precisa dela. */
export interface NotaDoCadastro {
  texto: string
  /** Nota de máquina — nossa ou da automação do Kommo. Não é cadastro. */
  automatica?: boolean
}

/** O card, no que a leitura do cadastro precisa dele. */
export interface CardDoCadastro {
  nome?: string | null
  processo_cnj?: string | null
  notas?: NotaDoCadastro[] | null
  nota_texto?: string | null
}

/** O que o cadastro diz do crédito — os campos que a análise e a planilha usam. */
export interface CadastroDoCard {
  numero: string
  cedente: string
  intermediador: string
  tipo_aquisicao: ParcelaCedida
  honorarios_pct: string
  /** A linha "TIPO:" da anotação, crua — quem a compara com o funil é a tela. */
  tipo: string
}

/**
 * O cadastro do card, lido do título e das anotações de GENTE.
 *
 * SÓ AS NOTAS DE GENTE: o espelho guarda também as de máquina — as nossas e as
 * da automação do Kommo —, e a ficha que a análise escreveu voltaria como "o
 * que o card diz". O sistema confirmaria a si mesmo. Já aconteceu.
 *
 * A ANOTAÇÃO VENCE ONDE EXISTE, o título responde onde ela falta: o comercial
 * vem encurtando o cadastro, e o destino é o título carregar tudo. Para o
 * NÚMERO é o contrário — o título primeiro, porque qualquer CNJ citado numa nota
 * (processo conexo, "ver também") venceria o do título.
 */
export function lerCadastroDoCard(card: CardDoCadastro): CadastroDoCard {
  const daGente = (card.notas ?? []).filter((n) => !n.automatica)
  const notas =
    daGente.length > 0
      ? daGente.map((n) => n.texto).join('\n')
      : (card.nota_texto ?? '')
  const pegar = (re: RegExp) => valorDoCampo(notas.match(re)?.[1] ?? '')
  const doTitulo = lerTituloCard(card.nome)

  const numero = (
    doTitulo.numero ||
    (card.processo_cnj ?? '') ||
    pegar(/PROCESSO:\s*([0-9.\-]+)/i)
  ).trim()
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
    cedente,
    intermediador: doTitulo.intermediador,
    tipo_aquisicao,
    honorarios_pct,
    tipo: pegar(/TIPO:\s*(.+)/i),
  }
}
