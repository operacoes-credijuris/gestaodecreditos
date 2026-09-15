// O QUE O CONECTOR ENTREGA quando o Claude vem buscar os autos.
//
// O ERRO QUE ESTE ARQUIVO CONSERTA. A primeira versão tentava empurrar o
// processo INTEIRO para dentro da janela da conversa, de uma vez. Isso é pior do
// que o método manual que ela veio substituir: quando alguém subia o PDF no
// Claude, o arquivo ficava FORA da conversa e o modelo abria o que precisava.
// Empurrando tudo, apareceu um teto que o método antigo não tinha — e um
// processo de 341 páginas chegava cortado pelo meio, com 20% do conteúdo.
//
// ENTÃO A FERRAMENTA PASSA A SE PARECER COM O ARQUIVO. Os autos ficam
// guardados inteiros, PÁGINA A PÁGINA, e a conversa recebe de uma vez só o que
// cabe com folga. O que não cabe não se perde: fica anunciado no índice, e o
// modelo o lê por página ou o procura por termo, como faria com um documento
// aberto ao lado.
//
// A PAGINAÇÃO TAMBÉM PAGA OUTRA DÍVIDA: o roteiro exige "valor + fonte
// (documento e página aproximada)" em cada campo da ficha. Com o texto num bloco
// só, a página era palpite. Agora é dado.
//
// MÓDULO PURO — sem `npm:` e sem `Deno.` —, então o mesmo arquivo roda no vitest
// do site. O que este texto diz decide como a análise sai, e isso merece teste.

import { ROTEIRO_QUALIFICACAO } from './roteiroQualificacao.ts'

export interface ArquivoGuardado {
  nome: string
  paginas: number
  /**
   * O texto de cada página, na ordem.
   *
   * É O FORMATO DE VERDADE: permite citar a página, ler um intervalo e dizer
   * onde um termo apareceu. O navegador já extraía assim (pdf.js devolve por
   * página) e a informação era jogada fora ao juntar tudo num bloco.
   */
  paginasTexto?: string[]
  /** Formato antigo, de linha gravada antes da paginação. Ainda lido. */
  texto?: string
  /**
   * POR QUE ESTE ARQUIVO NÃO TEM TEXTO: digitalizado, erro na leitura, anexo
   * que não é PDF.
   *
   * ARQUIVO SEM TEXTO NÃO É ARQUIVO SEM DADO — e antes ele nem chegava a ser
   * guardado: sumia entre o card e a conversa. A análise então declarava, com
   * as palavras que o roteiro exige, que nada havia sido localizado — sobre um
   * acórdão que estava ali, anexado ao card, e que ninguém tinha aberto. Um
   * arquivo que o modelo sabe que não leu vale mais que um que ele não sabe que
   * existe.
   */
  motivo?: string
  /** Páginas que o navegador vai subir como imagem (1-based), prometidas no depósito. */
  imagensPrevistas?: number[]
  /** Páginas já disponíveis como imagem, com o caminho no balde. */
  imagens?: ImagemDaPagina[]
}

/** Uma página digitalizada esperando no balde para ser VISTA, já que não se lê. */
export interface ImagemDaPagina {
  pagina: number
  caminho: string
}

export interface AutosGuardados {
  lead_id: number
  titulo: string
  arquivos: ArquivoGuardado[]
  criado_em: string
}

/** As páginas de um arquivo, venha ele no formato novo ou no antigo. */
export function paginasDoArquivo(a: ArquivoGuardado): string[] {
  if (Array.isArray(a.paginasTexto) && a.paginasTexto.length > 0) return a.paginasTexto
  return a.texto ? [a.texto] : []
}

/** O arquivo inteiro, com as páginas coladas na ordem. */
export function textoDoArquivo(a: ArquivoGuardado): string {
  return paginasDoArquivo(a).join('\n')
}

/** Arquivo do qual o pdf.js não tirou texto nenhum — imagem, ou falha na leitura. */
export function semTexto(a: ArquivoGuardado): boolean {
  return textoDoArquivo(a).trim().length === 0
}

/**
 * As páginas deste arquivo que podem ser VISTAS — as prontas e as a caminho.
 *
 * AS PROMETIDAS CONTAM, e isso não é otimismo. O texto é depositado em segundos;
 * as imagens levam o tempo da rasterização no navegador, que é muito maior. Se o
 * índice anunciasse só o que já chegou, a primeira entrega — que sai assim que o
 * texto chega — descreveria o acórdão digitalizado como ilegível, e o modelo
 * concluiria a análise sem ele, com a razão de sempre: ninguém lhe disse.
 */
export function paginasComImagem(a: ArquivoGuardado): number[] {
  const n = new Set<number>()
  for (const i of a.imagens ?? []) n.add(i.pagina)
  for (const p of a.imagensPrevistas ?? []) n.add(p)
  return [...n].sort((x, y) => x - y)
}

/** O caminho da imagem de uma página, quando ela já subiu. */
export function caminhoDaImagem(a: ArquivoGuardado, pagina: number): string | undefined {
  return (a.imagens ?? []).find((i) => i.pagina === pagina)?.caminho
}

/**
 * O QUE CABE NA PRIMEIRA ENTREGA, em caracteres.
 *
 * Não é o tamanho do que a plataforma guarda — isso é muito maior. É quanto do
 * material entra na conversa DE UMA VEZ, deixando janela para o roteiro, para a
 * análise inteira e para a conversa que vem depois dela. O resto continua
 * inteiro do outro lado, a uma chamada de distância.
 */
export const ORCAMENTO_DA_PRIMEIRA_ENTREGA = 250_000

/** Teto de uma leitura por páginas, para uma chamada não estourar a janela. */
export const MAX_POR_LEITURA = 120_000

/**
 * A FORMA DA ENTREGA — regra desta esteira, não do roteiro.
 *
 * SEPARADA DE PROPÓSITO. O roteiro é o método da casa e está aqui verbatim; o
 * que segue é do CANAL. A conversa nasce no Cowork, que é uma superfície de
 * trabalho: deixada à própria sorte, ela produz arquivo, artefato, planilha — e
 * o que a operação precisa ler está então a um download de distância, fora do
 * histórico da conversa e fora do que se pode colar numa nota do Kommo.
 *
 * A ANÁLISE É A RESPOSTA. Não o anexo dela.
 */
export const FORMA_DA_ENTREGA = [
  '## FORMA DA ENTREGA (regra desta esteira, complementar ao roteiro)',
  '',
  'Escreva a análise inteira NA PRÓPRIA RESPOSTA, como texto da conversa.',
  '',
  '- Não crie arquivo, documento, planilha, artefato nem anexo de espécie alguma,',
  '  e não use ferramenta que gere um. A resposta é o entregável.',
  '- Não pergunte se deve gerar um documento, e não ofereça gerar um depois.',
  '- As tabelas que o roteiro pede — a Ficha de Identificação, a tabela de partes',
  '  do Eixo 2, o batimento financeiro do Eixo 7 — vão em Markdown, no corpo da',
  '  mensagem, como o roteiro as desenha.',
  '- Não abra com resumo nem com plano de trabalho: comece pela Fase 1 e siga até',
  '  a linha de checagem final.',
].join('\n')

/**
 * COMO LER OS AUTOS — a instrução que substitui o processo manual.
 *
 * Ela existe porque a leitura integral que o roteiro exige (regra [9].7) deixou
 * de ser "ler o que veio na mensagem": parte do material pode estar do outro
 * lado das outras duas ferramentas. Sem dizer isso, o modelo leria o que
 * chegou, concluiria, e a regra teria sido cumprida só na aparência.
 */
export const COMO_LER_OS_AUTOS = [
  '## COMO LER OS AUTOS',
  '',
  'Os autos estão guardados INTEIROS, página a página. O que coube veio abaixo; o',
  'que não coube está a uma chamada de distância, e é seu dever ir buscá-lo — a',
  'leitura integral prévia da regra [9].7 vale sobre o processo, não sobre o que',
  'chegou nesta primeira mensagem.',
  '',
  '- `ler_paginas` devolve um intervalo de páginas de um arquivo. Use para ler por',
  '  inteiro o que ficou de fora, e para conferir o entorno de um achado.',
  '- `buscar_nos_autos` procura TERMOS — vários numa chamada só — em todos os',
  '  arquivos, e devolve os trechos COM O NÚMERO DA PÁGINA. Mande a lista inteira',
  '  do eixo de uma vez: o Eixo 2 ("cessão", "cessionário", "habilitação", "reserva',
  '  de crédito", "expeça-se em nome de") é UMA chamada, não cinco; o Eixo 7',
  '  (alvará, depósito, levantamento) é outra. Cada chamada dessas pede autorização',
  '  a quem está operando: um termo por vez enche a tela de pedidos.',
  '- `ver_paginas` devolve páginas DIGITALIZADAS como imagem. Documento escaneado',
  '  não tem texto para extrair nem para procurar — a busca é cega nele, e o',
  '  índice diz quais arquivos estão nessa situação. Nesses, ver é a única leitura',
  '  que existe.',
  '',
  'CITE A PÁGINA que a ferramenta devolveu. O roteiro pede fonte com página em',
  'todo campo da ficha, e agora ela é dado, não estimativa.',
  '',
  'NÃO DECLARE AUSÊNCIA DO QUE VOCÊ NÃO ABRIU. O roteiro exige declaração expressa',
  'quando nada é localizado, e ela vale sobre o que foi lido: enquanto houver',
  'arquivo do índice que você não leu nem viu, escrever "não há cessão nos autos"',
  'é afirmar o que não se verificou. Leia primeiro; se não der para ler, diga qual',
  'arquivo ficou sem leitura e registre a diligência.',
].join('\n')

/** Uma linha do índice: o que existe, quanto tem e por onde se lê. */
interface LinhaDoIndice {
  nome: string
  paginas: number
  caracteres: number
  inteiro: boolean
  /** Por que não há texto, quando não há. */
  motivo?: string
  /** Quantas páginas deste arquivo podem ser vistas como imagem. */
  imagens: number
}

/**
 * A COLUNA QUE IMPORTA NO ÍNDICE não é o tamanho: é por onde se lê cada arquivo.
 *
 * Um arquivo digitalizado tem zero caractere, e uma tabela que só mostrasse
 * números deixaria a linha dele parecendo um arquivo vazio — que é exatamente a
 * leitura errada. Ele não está vazio; ele está em imagem.
 */
function comoLer(l: LinhaDoIndice): string {
  // O HÍBRIDO É O CASO QUE MAIS ENGANA: arquivo nato-digital com a conta da
  // contadoria escaneada no meio. Ele tem texto, então chega inteiro e parece
  // lido — e justamente a folha que decide o preço está numa página que o texto
  // não alcança. A coluna diz quantas são.
  const escaneadas = l.imagens > 0 ? ` · ${l.imagens} pág. escaneada(s), veja com \`ver_paginas\`` : ''
  if (l.inteiro) return 'veio inteira nesta mensagem' + escaneadas
  if (l.caracteres > 0) return '**não veio — leia com `ler_paginas`**' + escaneadas
  if (l.imagens > 0) {
    return `**sem texto (${l.motivo ?? 'digitalizado'}) — ${l.imagens} pág. em imagem, use \`ver_paginas\`**`
  }
  return `**NÃO LIDO — ${l.motivo ?? 'sem texto extraível'}**`
}

function indice(linhas: LinhaDoIndice[]): string {
  const num = (n: number) => n.toLocaleString('pt-BR')
  return [
    '## ÍNDICE DOS ARQUIVOS',
    '',
    '| # | Arquivo | Páginas | Caracteres | Como ler |',
    '|---|---------|--------:|-----------:|----------|',
    ...linhas.map(
      (l, i) => `| ${i + 1} | ${l.nome} | ${l.paginas || '—'} | ${num(l.caracteres)} | ${comoLer(l)} |`,
    ),
  ].join('\n')
}

/**
 * A primeira entrega: o método, o cadastro, o índice e o que couber dos autos.
 *
 * O ROTEIRO VEM PRIMEIRO porque diz o que fazer com tudo que vem depois. O
 * CADASTRO vem rotulado como cadastro e separado dos autos: o título do card é o
 * que o comercial escreveu, e o roteiro exige documento e página para cada campo
 * da ficha — oferecer um como o outro é o que a regra de ancoragem proíbe.
 *
 * O QUE NÃO COUBER NÃO É CORTADO PELO MEIO. Antes era, e o resultado era um
 * arquivo mutilado com um aviso no miolo. Agora um arquivo vem inteiro ou não
 * vem — e o que não veio está no índice, nomeado, com o tamanho, e o modelo sabe
 * como buscá-lo.
 *
 * O ARQUIVO SEM TEXTO TAMBÉM ESTÁ NO ÍNDICE, e esta é a segunda correção. Ele
 * não chegava nem a ser guardado: dois anexos de dezenove — um acórdão e um
 * ofício, ambos digitalizados — desapareciam entre o card e a conversa. A
 * análise saía completa na aparência, declarando ausências que ninguém tinha
 * verificado naqueles dois.
 */
export function montarEntrega(
  g: AutosGuardados,
  /**
   * O roteiro em vigor.
   *
   * VEM DE FORA porque a operação o edita pela tela de Configurações, e o que
   * está no repositório é o CHÃO: texto vazio, linha ausente ou banco novo caem
   * no padrão versionado. Nenhuma análise roda sem método.
   */
  roteiro: string = ROTEIRO_QUALIFICACAO,
  orcamento: number = ORCAMENTO_DA_PRIMEIRA_ENTREGA,
): string {
  // QUEM CABE VEM INTEIRO, na ordem da Kommo. Arquivo pequeno atrás de um
  // grande continua entrando: o grande é pulado, não é cortado.
  let usado = 0
  const linhas: LinhaDoIndice[] = []
  const corpos: string[] = []
  for (const a of g.arquivos) {
    const texto = textoDoArquivo(a)
    const cabe = texto.length > 0 && usado + texto.length <= orcamento
    linhas.push({
      nome: a.nome,
      paginas: a.paginas,
      caracteres: texto.length,
      inteiro: cabe,
      motivo: a.motivo,
      imagens: paginasComImagem(a).length,
    })
    if (!cabe) continue
    usado += texto.length
    const paginas = a.paginas > 0 ? ` (${a.paginas} páginas)` : ''
    corpos.push(`\n\n=== ARQUIVO: ${a.nome}${paginas} ===\n\n${texto}`)
  }

  // TRÊS SITUAÇÕES DIFERENTES, e confundi-las já custou uma análise. Um arquivo
  // que não coube se lê; um digitalizado se vê; um que falhou não se lê de jeito
  // nenhum e vira diligência. Só a terceira autoriza seguir sem ele — e mesmo
  // ela não autoriza afirmar que o que estava nele não existe.
  const porTamanho = linhas.filter((l) => !l.inteiro && l.caracteres > 0)
  const emImagem = linhas.filter((l) => l.caracteres === 0 && l.imagens > 0)
  const perdidos = linhas.filter((l) => l.caracteres === 0 && l.imagens === 0)

  const nomes = (ls: LinhaDoIndice[]) => ls.map((l) => `"${l.nome}"`).join(', ')
  const avisos = [
    ...(porTamanho.length > 0
      ? [
          '',
          `> **${porTamanho.length} arquivo(s) não vieram nesta mensagem por tamanho:** ${nomes(porTamanho)}.`,
          '> Estão guardados inteiros. Leia-os com `ler_paginas` antes de concluir',
          '> qualquer coisa que dependa deles.',
        ]
      : []),
    ...(emImagem.length > 0
      ? [
          '',
          `> **${emImagem.length} arquivo(s) estão DIGITALIZADOS:** ${nomes(emImagem)}.`,
          '> Não têm texto para extrair nem para procurar — `buscar_nos_autos` é cega',
          '> neles. Abra-os com `ver_paginas`, que devolve as páginas como imagem.',
          '> Enquanto não abrir, nada que dependa desses documentos está verificado.',
        ]
      : []),
    ...(perdidos.length > 0
      ? [
          '',
          `> **${perdidos.length} arquivo(s) não puderam ser lidos:** ${nomes(perdidos)}.`,
          '> Não há texto nem imagem deles aqui. Registre na análise QUAL arquivo ficou',
          '> sem leitura e trate como diligência — não como documento inexistente.',
        ]
      : []),
  ]

  const cabeca = [
    (roteiro || '').trim() || ROTEIRO_QUALIFICACAO,
    '',
    '---',
    '',
    FORMA_DA_ENTREGA,
    '',
    '---',
    '',
    COMO_LER_OS_AUTOS,
    '',
    '---',
    '',
    '## DADOS DO CARD (cadastro do comercial — NÃO é fonte documental)',
    '',
    'O título do card segue o formato `[intermediador] - [cedente] - [nº CNJ] - ' +
      '[parcela cedida] - [% de honorários contratuais]`, e neste crédito está assim:',
    '',
    `> ${g.titulo || '(card sem título)'}`,
    '',
    'Use-o para preencher o que puder do bloco [0]. Ele NÃO substitui os autos em',
    'nenhum campo da Ficha de Identificação: divergência entre o card e os autos é,',
    'ela própria, achado a registrar.',
    '',
    '---',
    '',
    indice(linhas),
    '',
    `Card Kommo ${g.lead_id} · lidos da Kommo em ${g.criado_em}`,
    ...avisos,
    '',
    '---',
    '',
    '## AUTOS',
  ].join('\n')

  return cabeca + corpos.join('')
}

/**
 * Acha um arquivo pelo nome (parcial, sem acento/caixa) ou pela posição (1-based).
 *
 * EXPORTADO porque o conector também precisa dele: `ver_paginas` recebe o mesmo
 * "arquivo" digitado de memória pelo modelo, e resolvê-lo de outro jeito faria a
 * mesma palavra apontar para documentos diferentes em ferramentas diferentes.
 */
export function arquivoDosAutos(g: AutosGuardados, alvo: string): ArquivoGuardado | undefined {
  const cru = String(alvo ?? '').trim()
  if (!cru) return undefined
  const n = Number(cru)
  if (Number.isInteger(n) && n >= 1 && n <= g.arquivos.length) return g.arquivos[n - 1]
  const chave = normalizar(cru)
  return (
    g.arquivos.find((a) => normalizar(a.nome) === chave) ??
    g.arquivos.find((a) => normalizar(a.nome).includes(chave))
  )
}

/** Sem acento, sem caixa: o nome do arquivo é digitado pelo modelo, de memória. */
function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * Um intervalo de páginas de um arquivo.
 *
 * O TETO É POR CHAMADA, e não pelo que existe: pedir mais do que cabe devolve o
 * que cabe e DIZ onde parou, com a página seguinte a pedir. Uma leitura que se
 * interrompe em silêncio é o defeito que esta entrega inteira veio corrigir.
 */
export function lerPaginas(
  g: AutosGuardados,
  arquivo: string,
  de: number,
  ate: number,
): string {
  const a = arquivoDosAutos(g, arquivo)
  if (!a) {
    const nomes = g.arquivos.map((x, i) => `${i + 1}. ${x.nome}`).join('\n')
    return `Não há arquivo "${arquivo}" neste crédito. Os arquivos são:\n${nomes}`
  }
  const paginas = paginasDoArquivo(a)
  if (paginas.length === 0) {
    // NEM TODO ARQUIVO SEM TEXTO ESTÁ PERDIDO: o digitalizado se vê. Devolver
    // a quem procurou um "não tem texto" seco era condenar o acórdão escaneado
    // ao mesmo silêncio de antes.
    const imgs = paginasComImagem(a)
    return imgs.length > 0
      ? `O arquivo "${a.nome}" é digitalizado: não tem texto, tem imagem. ` +
        `Use \`ver_paginas\` — há ${imgs.length} página(s) disponível(is) para ver.`
      : `O arquivo "${a.nome}" não tem texto legível${a.motivo ? ` (${a.motivo})` : ''}. ` +
        'Registre-o como NÃO LIDO em vez de concluir sobre o conteúdo dele.'
  }

  const ini = Math.max(1, Math.floor(de) || 1)
  const fim = Math.min(paginas.length, Math.floor(ate) || paginas.length)
  if (ini > paginas.length) {
    return `O arquivo "${a.nome}" tem ${paginas.length} páginas; a ${ini} não existe.`
  }

  const partes: string[] = []
  let usado = 0
  let ultima = ini - 1
  for (let p = ini; p <= fim; p++) {
    const texto = paginas[p - 1] ?? ''
    if (usado + texto.length > MAX_POR_LEITURA && partes.length > 0) break
    partes.push(`\n\n--- página ${p} ---\n\n${texto}`)
    usado += texto.length
    ultima = p
  }

  const cabeca = `${a.nome} — páginas ${ini} a ${ultima} de ${paginas.length}`
  const resto =
    ultima < fim
      ? `\n\n[A leitura parou na página ${ultima} por tamanho. Peça de ${ultima + 1} a ${fim} para continuar.]`
      : ''
  return cabeca + partes.join('') + resto
}

/** Uma ocorrência do termo procurado. */
export interface Ocorrencia {
  arquivo: string
  pagina: number
  trecho: string
}

/** O que um termo achou, dentro de uma busca que pode ter vários. */
export interface BuscaDeUmTermo {
  termo: string
  ocorrencias: Ocorrencia[]
}

/** Teto do texto de uma busca, somando todos os termos da mesma chamada. */
export const MAX_POR_BUSCA = 120_000

/** Termos por chamada. Acima disso não é varredura de eixo, é pescaria. */
export const MAX_TERMOS_POR_BUSCA = 25

/** Ocorrências por termo quando a chamada traz vários. */
const POR_TERMO_NA_LISTA = 15

/**
 * Os termos de uma chamada, sem repetição e sem vazios.
 *
 * VÁRIOS DE UMA VEZ, E ISSO NÃO É CONVENIÊNCIA. Cada chamada de ferramenta pede
 * autorização a quem está na conversa, e um eixo do roteiro é uma lista de
 * cinco ou dez termos. Um termo por chamada — que foi como esta ferramenta
 * nasceu — transformava a varredura do Eixo 2 numa fila de permissões, com o
 * operador clicando "permitir uma vez" dez vezes para a mesma varredura.
 *
 * VÍRGULA E PONTO E VÍRGULA TAMBÉM SEPARAM, porque o modelo pode mandar a lista
 * numa string só. Separar demais erra para o lado seguro: um termo partido
 * procura MAIS, não menos, e o cabeçalho de cada bloco diz exatamente o que foi
 * procurado — quem lê vê o que a busca fez.
 */
export function termosDaBusca(termos: string | string[] | undefined): string[] {
  const crus = Array.isArray(termos) ? termos : [String(termos ?? '')]
  const vistos = new Set<string>()
  const lista: string[] = []
  for (const cru of crus) {
    for (const parte of String(cru ?? '').split(/[,;\n]/)) {
      const termo = parte.trim()
      const chave = normalizar(termo)
      if (!chave || vistos.has(chave)) continue
      vistos.add(chave)
      lista.push(termo)
      if (lista.length >= MAX_TERMOS_POR_BUSCA) return lista
    }
  }
  return lista
}

/**
 * Procura um termo em todos os arquivos, e devolve a PÁGINA de cada ocorrência.
 *
 * É O CAMINHO DOS EIXOS DE VARREDURA. O Eixo 2 é literalmente uma lista de
 * termos ("cessão", "cessionário", "habilitação", "reserva de crédito") e o
 * Eixo 7 outra; sem isto, cumpri-los num processo de trezentas páginas exigia
 * despejar o processo inteiro na conversa para achar três parágrafos.
 */
export function buscarNosAutos(
  g: AutosGuardados,
  termo: string,
  maxOcorrencias = 40,
  margem = 400,
): Ocorrencia[] {
  const alvo = normalizar(termo)
  if (!alvo) return []
  const achados: Ocorrencia[] = []
  for (const a of g.arquivos) {
    const paginas = paginasDoArquivo(a)
    for (let p = 0; p < paginas.length; p++) {
      const texto = paginas[p] ?? ''
      const onde = normalizar(texto).indexOf(alvo)
      if (onde < 0) continue
      const ini = Math.max(0, onde - margem)
      const fim = Math.min(texto.length, onde + alvo.length + margem)
      achados.push({
        arquivo: a.nome,
        // A página é 1-based para quem lê — é assim que ela será citada.
        pagina: p + 1,
        trecho: (ini > 0 ? '…' : '') + texto.slice(ini, fim).trim() + (fim < texto.length ? '…' : ''),
      })
      if (achados.length >= maxOcorrencias) return achados
    }
  }
  return achados
}

/** Cada termo da chamada com o que achou, na ordem em que foram pedidos. */
export function buscarVarios(
  g: AutosGuardados,
  termos: string | string[],
  margem = 400,
): BuscaDeUmTermo[] {
  const lista = termosDaBusca(termos)
  // MENOS OCORRÊNCIAS POR TERMO QUANDO SÃO MUITOS. A chamada devolve uma
  // varredura, não o processo inteiro de volta pela porta dos fundos; quem
  // precisar de todas as ocorrências de um termo pede aquele termo sozinho.
  const porTermo = lista.length > 1 ? POR_TERMO_NA_LISTA : 40
  return lista.map((termo) => ({ termo, ocorrencias: buscarNosAutos(g, termo, porTermo, margem) }))
}

/**
 * AUSÊNCIA É RESPOSTA VÁLIDA, e o roteiro depende dela: o Eixo 2 exige a
 * declaração expressa de que nada foi localizado. Mas ela vale sobre o que está
 * NO TEXTO — e um processo digitalizado não tem texto para procurar. Sem esta
 * ressalva, a declaração viraria afirmação sobre o que não foi verificado.
 */
const RESSALVA_DA_AUSENCIA =
  'Ausência no texto não é prova de ausência nos autos: página digitalizada não tem ' +
  'texto para procurar. Se o arquivo for imagem, diga isso na análise em vez de afirmar ' +
  'que nada existe.'

/**
 * A BUSCA É CEGA NO QUE ESTÁ EM IMAGEM, e calar isso é o pior jeito de errar
 * aqui: o Eixo 2 pede declaração expressa de ausência, e ela sairia apoiada numa
 * varredura que nunca passou pelo acórdão digitalizado.
 */
function avisoDosCegos(g: AutosGuardados): string {
  const cegos = g.arquivos.filter((a) => semTexto(a))
  if (cegos.length === 0) return ''
  return (
    ` ATENÇÃO: ${cegos.length} arquivo(s) deste crédito são digitalizados e esta busca ` +
    `NÃO passou por eles — ${cegos.map((a) => `"${a.nome}"`).join(', ')}. Veja-os com ` +
    '`ver_paginas` antes de declarar qualquer ausência.'
  )
}

/** A busca, escrita para quem vai ler. */
export function textoDaBusca(g: AutosGuardados, termos: string | string[]): string {
  const buscas = buscarVarios(g, termos)
  if (buscas.length === 0) {
    return 'Nenhum termo para procurar. Mande em `termos` a lista do eixo que você está varrendo.'
  }

  const blocos: string[] = []
  const semNada: string[] = []
  const naoCoube: string[] = []
  let usado = 0
  for (const b of buscas) {
    if (b.ocorrencias.length === 0) {
      semNada.push(b.termo)
      blocos.push(`\n\n## "${b.termo}" — nenhuma ocorrência no texto`)
      continue
    }
    const bloco = [
      `\n\n## "${b.termo}" — ${b.ocorrencias.length} ocorrência(s)`,
      ...b.ocorrencias.map((o) => `\n\n### ${o.arquivo} — página ${o.pagina}\n\n${o.trecho}`),
    ].join('')
    // O QUE NÃO COUBER É NOMEADO, nunca sumido: engolir um termo em silêncio
    // depois de tê-lo achado é o defeito que esta entrega inteira veio corrigir.
    if (usado + bloco.length > MAX_POR_BUSCA && blocos.length > 0) {
      naoCoube.push(b.termo)
      continue
    }
    usado += bloco.length
    blocos.push(bloco)
  }

  const cabeca =
    `Busca em ${g.arquivos.length} arquivo(s) — ${buscas.length} termo(s): ` +
    buscas.map((b) => `"${b.termo}"`).join(', ') +
    '.'

  const rodape = [
    ...(semNada.length > 0
      ? [
          `\n\n> **Sem ocorrência no texto:** ${semNada.map((t) => `"${t}"`).join(', ')}. ` +
            RESSALVA_DA_AUSENCIA +
            avisoDosCegos(g),
        ]
      : []),
    ...(naoCoube.length > 0
      ? [
          `\n\n> **${naoCoube.length} termo(s) acharam ocorrências que não couberam nesta resposta:** ` +
            `${naoCoube.map((t) => `"${t}"`).join(', ')}. Eles EXISTEM nos autos — peça cada um ` +
            `numa chamada separada antes de concluir qualquer coisa a respeito deles.`,
        ]
      : []),
  ].join('')

  return cabeca + blocos.join('') + rodape
}
