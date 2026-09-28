// O QUESTIONÁRIO DA ABA "ANÁLISE JURÍDICA" — ler, perguntar e preencher.
//
// POR QUE ISTO SAIU DA `analise-precatorio`. Até 28/09/2026 só ela preenchia a
// planilha: lia os autos de novo, com outro modelo, numa chamada paga à parte.
// A equipe pediu que a planilha nascesse da MESMA conversa em que o Claude faz a
// qualificação preliminar — "senão perde o contexto que está sendo desenvolvido
// no desktop". Agora são duas portas para o mesmo preenchimento:
//
//   • a `analise-precatorio`, que continua existindo (o motor antigo);
//   • a `planilha-juridica`, que recebe as respostas que o Claude escreveu na
//     conversa — coladas por quem opera — e as aplica no modelo.
//
// E o conector, que ENTREGA o questionário ao Claude. Os três leem daqui: as
// perguntas, as regras, o formato da resposta e a gravação na planilha. Duas
// cópias disto divergiriam na primeira pergunta nova do modelo.
//
// MÓDULO PURO — sem `Deno.` e sem `npm:`. A planilha chega como um objeto que
// só precisa saber dar a célula de uma linha (o ExcelJS sabe, e o teste também).

import { montarParcelas, rotuloDoCenario, type VerbasNegociadas } from './precificacao.ts'

/** A aba do modelo que este questionário preenche. */
export const ABA_JURIDICA = 'Análise Jurídica'

/**
 * Os blocos da aba e a coluna que recebe a resposta.
 *
 * A DIFERENÇA DE COLUNA NÃO É CAPRICHO, é o desenho da planilha: no bloco de
 * Dados Básicos a pergunta ocupa A:B mesclado e a resposta ocupa C:D mesclado —
 * confirmado pela aba Precificação, cuja célula B11 é `='Análise Jurídica'!C4`.
 * Nos outros blocos o cabeçalho é literal: A=Pergunta, B=Resposta,
 * C=Complemento, D=Resposta (do complemento).
 */
export const BLOCOS = [
  { nome: 'Dados Básicos do Crédito', de: 4, ate: 22, col: 'C', fonte: 'pdf' },
  { nome: 'Histórico do Cedente', de: 28, ate: 81, col: 'B', fonte: 'banco' },
  { nome: 'Saúde financeira da Entidade Devedora', de: 85, ate: 101, col: 'B', fonte: 'web' },
  { nome: 'Análise do Caderno Processual', de: 105, ate: 137, col: 'B', fonte: 'pdf' },
  { nome: 'Fechamento', de: 138, ate: 139, col: 'B', fonte: 'pdf' },
] as const

export type Fonte = (typeof BLOCOS)[number]['fonte']

export interface LinhaQuestionario {
  linha: number
  bloco: string
  fonte: Fonte
  pergunta: string
  /** Instrução da coluna C, quando é instrução de verdade (não "-"). */
  complemento: string | null
  col: string
}

/** O mínimo que o preenchimento precisa de uma planilha: dar a célula de uma linha. */
export interface CelulaDaPlanilha {
  value: unknown
}
export interface AbaDaPlanilha {
  model: { merges?: string[] }
  getRow: (n: number) => { getCell: (c: string) => CelulaDaPlanilha }
}

export const textoDaCelula = (c: { value: unknown }): string => {
  const v = c.value
  if (v == null) return ''
  if (typeof v === 'object') {
    const o = v as { richText?: { text: string }[]; formula?: string; text?: string }
    if (o.richText) return o.richText.map((t) => t.text).join('')
    if (o.formula) return '=' + o.formula
    if (o.text) return String(o.text)
    return ''
  }
  return String(v)
}
export const enxuto = (s: string) => s.replace(/\s+/g, ' ').trim()

/**
 * O questionário, lido da aba.
 *
 * Fica de fora o que não é pergunta:
 *   - cabeçalho de sub-bloco, reconhecido pelo merge A{n}:D{n} ("Cônjuge (se
 *     houver)", "Se Regime Geral"…) — é título, não pergunta;
 *   - linha cuja célula de resposta JÁ TEM conteúdo, que são as fórmulas da
 *     EC 136/2025 (B93/B94/B95). A planilha as calcula; ninguém escreve.
 */
export function lerQuestionario(ws: AbaDaPlanilha): { linhas: LinhaQuestionario[]; comFormula: number[] } {
  const merges = new Set(ws.model.merges ?? [])
  const linhas: LinhaQuestionario[] = []
  const comFormula: number[] = []

  for (const b of BLOCOS) {
    for (let n = b.de; n <= b.ate; n++) {
      const row = ws.getRow(n)
      const pergunta = enxuto(textoDaCelula(row.getCell('A')))
      if (!pergunta) continue
      if (merges.has(`A${n}:D${n}`)) continue // título de sub-bloco
      if (row.getCell(b.col).value != null) {
        comFormula.push(n)
        continue
      }
      const c = enxuto(textoDaCelula(row.getCell('C')))
      const temComplemento =
        b.col === 'B' && c !== '' && c !== '-' && row.getCell('D').value == null
      linhas.push({
        linha: n,
        bloco: b.nome,
        fonte: b.fonte,
        pergunta,
        complemento: temComplemento ? c : null,
        col: b.col,
      })
    }
  }
  return { linhas, comFormula }
}

/**
 * AS REGRAS DO PREENCHIMENTO, as mesmas para as duas portas.
 *
 * Escritas para o motor antigo e testadas nele: não inventar, cada bloco com a
 * sua fonte, o checklist que não diz se a certidão veio positiva, o número de
 * orçamento público que não entra sem link. A conversa do Claude recebe o mesmo
 * texto — mudar uma regra aqui muda as duas, que é o ponto.
 */
export const REGRAS_DA_PLANILHA = `REGRAS, em ordem de importância:

1. NÃO INVENTE. Linha que você não consegue sustentar simplesmente NÃO ENTRA em "respostas". Deixar em branco para uma pessoa preencher é o resultado certo; um valor plausível e errado entra na planilha com cara de conferido e ninguém revisa duas vezes.

2. CADA BLOCO TEM UMA FONTE, e usar a fonte errada é o erro grave desta análise:

   • "Dados Básicos do Crédito", "Análise do Caderno Processual" e "Fechamento" — SÓ o texto do processo. Não busque na web para responder estas.

   • "Histórico do Cedente" — SÓ o estado do checklist de certidões da plataforma. Não busque na web e não deduza do processo.
     ⚠️ O CHECKLIST NÃO DIZ SE A CERTIDÃO VEIO POSITIVA OU NEGATIVA. Ele diz se ela foi obtida. Então responda o ESTADO ("Obtida em 12/08/2026 — resultado não registrado na plataforma; conferir o PDF na pasta", "Pendente de emissão", "Dispensada: <motivo>", "Não consta no checklist"). NUNCA escreva "negativa", "positiva", "nada consta" ou "regular": esse dado não existe no sistema, e inventá-lo aprova ou reprova crédito por informação que ninguém apurou.

   • "Saúde financeira da Entidade Devedora" — BUSCA WEB. É o único bloco em que você deve pesquisar. Procure a Receita Corrente Líquida na LOA do ente, o estoque de precatórios em mora no site do Tribunal, o regime (Geral ou Especial), a ordem cronológica e os editais de negociação.
     ⚠️ NÚMERO SEM LINK NÃO ENTRA. Toda resposta deste bloco exige "fonte_url" com o endereço exato da página. Se você não achou fonte oficial — ou não tem busca na web —, omita a linha e escreva em "avisos" o que falta buscar. Isto é orçamento público: número sem procedência é pior que célula vazia.
     Prefira fonte oficial — portal do Tribunal, Diário Oficial, portal da transparência, sítio da Fazenda do ente. Não use blog, notícia ou agregador para o VALOR; para achar o caminho até a fonte oficial, pode.

3. RESPONDA CURTO. A célula é de planilha, não de parecer. Pergunta fechada leva "Sim" ou "Não", com o dado pedido no complemento. "Sim — 14/03/2024" no lugar de um parágrafo.

4. O COMPLEMENTO É O QUE A LINHA PEDE. Quando o questionário mostra a instrução de complemento, ela diz exatamente o que vai ali: a data, o número do processo, o valor, o link da jurisprudência. Complemento vazio numa linha que pede complemento é resposta incompleta.

5. NÃO DECIDA A OPERAÇÃO. Você não aprova nem reprova. O modelo tem um bloco de "Critérios de Aceitação e Recusa" que uma pessoa aplica sobre o que você preencheu. Escreva os fatos e ponha o risco em "avisos"; a palavra final não é sua.

6. DISTINGA O QUE O PROCESSO DISTINGUE. As armadilhas frequentes: valor APRESENTADO não é valor HOMOLOGADO; cálculo homologado não é precatório expedido; precatório expedido não é autuado na Presidência; autuado não é incluído na LOA; cessão NOTICIADA não é cessão HOMOLOGADA; penhora REQUERIDA não é penhora DEFERIDA. Quando o processo mostra um estágio e não o seguinte, responda o que ele mostra.

7. DATAS EM DD/MM/AAAA. Dinheiro com separador de milhar brasileiro e duas casas: 1.234.567,89.`

/** O questionário em texto, bloco a bloco, com a fonte de cada um e o número da linha. */
export function montarQuestionario(linhas: LinhaQuestionario[]): string {
  const porBloco = new Map<string, LinhaQuestionario[]>()
  for (const l of linhas) {
    const atual = porBloco.get(l.bloco) ?? []
    atual.push(l)
    porBloco.set(l.bloco, atual)
  }
  const partes: string[] = []
  for (const [bloco, ls] of porBloco) {
    const fonte = ls[0].fonte
    const rotulo =
      fonte === 'pdf'
        ? 'FONTE: o texto do processo'
        : fonte === 'banco'
          ? 'FONTE: o checklist de certidões da plataforma'
          : 'FONTE: busca web, com fonte_url obrigatório'
    partes.push(`\n### ${bloco}  (${rotulo})`)
    for (const l of ls) {
      partes.push(
        `L${l.linha}: ${l.pergunta}` +
          (l.complemento ? `\n      complemento -> ${l.complemento}` : ''),
      )
    }
  }
  return partes.join('\n')
}

/**
 * O FORMATO DA RESPOSTA — o esquema JSON que as duas portas devolvem.
 *
 * É o `input_schema` da ferramenta do motor antigo, e é também o que a conversa
 * do Claude escreve no bloco que quem opera copia. Um formato só: a gravação na
 * planilha não sabe (nem precisa saber) de onde a resposta veio.
 */
export const ESQUEMA_DA_SAIDA = {
  type: 'object' as const,
  properties: {
    respostas: {
      type: 'array',
      description:
        'Uma entrada por linha respondida. Linha que você não conseguiu responder NÃO entra aqui.',
      items: {
        type: 'object',
        properties: {
          linha: {
            type: 'integer',
            description: 'O número da linha da planilha, como veio no questionário.',
          },
          resposta: {
            type: 'string',
            description:
              'A resposta, curta e direta. Sim/Não quando a pergunta é fechada, com o dado pedido junto.',
          },
          complemento: {
            type: ['string', 'null'],
            description:
              'Só quando a linha tem instrução de complemento — a data, o número do processo, o valor que ela pede.',
          },
          fonte_url: {
            type: ['string', 'null'],
            description:
              'OBRIGATÓRIO para toda resposta obtida por busca web: o endereço exato da página que sustenta o número. Sem ele a resposta é descartada.',
          },
        },
        required: ['linha', 'resposta'],
      },
    },
    avisos: {
      type: 'array',
      maxItems: 6,
      items: { type: 'string' },
      description:
        'O que a pessoa precisa conferir ou buscar à mão. Uma linha por assunto, até 25 palavras.',
    },
    resumo: {
      type: 'string',
      description:
        'Três a cinco linhas sobre o crédito: o que é, em que fase está, e o que mais pesa no risco.',
    },
    ficha: {
      type: 'object',
      description:
        'OS DADOS DO CRÉDITO EM CAMPOS, para a anotação que volta ao card do Kommo. ' +
        'É a mesma leitura que você já fez para o questionário, agora em campos separados — o comercial lê ISTO no card, não a planilha. ' +
        'Número que você não achou nos autos vai como null; não estime, porque ele aparece no card como se fosse lido.',
      properties: {
        tribunal: { type: ['string', 'null'], description: 'sigla do tribunal onde tramita, ex.: "TJSP", "TRF3", "TRT2"' },
        entidade_devedora: { type: ['string', 'null'], description: 'quem vai pagar, ex.: "Estado de São Paulo", "Município de Campinas", "União"' },
        cedente_nome: { type: ['string', 'null'], description: 'nome completo do titular do crédito, SEM o CPF' },
        bruto_total: { type: ['number', 'null'], description: 'valor BRUTO atualizado do precatório, número sem R$: o total antes de qualquer retenção. INCLUI os honorários contratuais destacados, porque saem de dentro dele; NÃO inclui os sucumbenciais, que têm campo próprio' },
        ir: { type: ['number', 'null'], description: 'IR retido sobre o principal, número. 0 quando não há' },
        inss: { type: ['number', 'null'], description: 'contribuição previdenciária retida, número. 0 quando não há' },
        honorarios_contratuais: { type: ['number', 'null'], description: 'honorários contratuais DESTACADOS, número. 0 quando não houve destaque (art. 22 §4º da Lei 8.906/94)' },
        honorarios_sucumbenciais: { type: ['number', 'null'], description: 'honorários sucumbenciais, número. 0 quando não há. Verba própria, paga pelo vencido, por fora do crédito do credor' },
        honorarios_contratuais_pct: {
          type: ['number', 'null'],
          description:
            'A PORCENTAGEM dos honorários contratuais sobre o crédito, em pontos (30 = 30%). ' +
            'PROCURE A PORCENTAGEM ESCRITA, primeiro: contrato de honorários juntado aos autos, petição que pede o destaque do art. 22 §4º, despacho que o defere, e muitas vezes a própria conta da contadoria. ' +
            'SÓ SE NÃO HOUVER EM PARTE NENHUMA, calcule: o valor dos honorários dividido pelo valor do crédito, os dois DO MESMO DOCUMENTO — de preferência a conta da contadoria, que é onde as duas linhas convivem e a base é a que valeu de verdade. Não monte uma base de outra peça',
        },
        honorarios_contratuais_pct_origem: {
          type: ['string', 'null'],
          description: 'de onde saiu a porcentagem, em uma linha: a peça que a traz escrita ("contrato de honorários, fl. 12"), ou a divisão que você fez com os dois números ("R$ 12.400 / R$ 41.333 da conta da contadoria")',
        },
      },
      required: ['tribunal', 'entidade_devedora', 'cedente_nome', 'bruto_total'],
    },
  },
  required: ['respostas', 'avisos', 'resumo', 'ficha'],
}

/** O que as duas portas devolvem — o bloco preenchido. */
export interface SaidaDaPlanilha {
  respostas?: {
    linha?: number
    resposta?: string
    complemento?: string | null
    fonte_url?: string | null
  }[]
  avisos?: string[]
  resumo?: string
  ficha?: {
    tribunal?: string | null
    entidade_devedora?: string | null
    cedente_nome?: string | null
    bruto_total?: number | null
    ir?: number | null
    inss?: number | null
    honorarios_contratuais?: number | null
    honorarios_sucumbenciais?: number | null
    honorarios_contratuais_pct?: number | null
    honorarios_contratuais_pct_origem?: string | null
  }
}

/**
 * O bloco que a conversa entregou, tirado do texto que foi colado.
 *
 * TOLERANTE COM O QUE VEM EM VOLTA, porque quem cola não é um programa: pode
 * ser só o bloco (o botão de copiar do Claude), pode ser a resposta inteira, com
 * a qualificação antes e um comentário depois. O que importa é achar o JSON que
 * tem `respostas` — e dizer com clareza quando não há, em vez de gravar uma
 * planilha vazia com cara de preenchida.
 */
export function extrairSaidaColada(
  texto: unknown,
): { ok: true; saida: SaidaDaPlanilha } | { ok: false; erro: string } {
  const bruto = String(texto ?? '').trim()
  if (!bruto) return { ok: false, erro: 'Nada foi colado.' }

  const candidatos: string[] = []
  // 1. Os blocos de código, que é como a conversa é instruída a entregar.
  for (const m of bruto.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) candidatos.push(m[1])
  // 2. Do primeiro "{" ao último "}", para quem colou sem as cercas.
  const ini = bruto.indexOf('{')
  const fim = bruto.lastIndexOf('}')
  if (ini >= 0 && fim > ini) candidatos.push(bruto.slice(ini, fim + 1))

  let viuJson = false
  for (const c of candidatos) {
    let obj: unknown
    try {
      obj = JSON.parse(c.trim())
    } catch {
      continue
    }
    viuJson = true
    const s = obj as SaidaDaPlanilha
    if (s && typeof s === 'object' && Array.isArray(s.respostas)) return { ok: true, saida: s }
  }
  return {
    ok: false,
    erro: viuJson
      ? 'O texto colado tem um JSON, mas sem a lista "respostas". Copie o bloco da planilha que o Claude entregou ao final da análise.'
      : 'Não achei o bloco da planilha no texto colado. Ele é o bloco de código (JSON) que o Claude entrega ao final da análise — use o botão de copiar do próprio bloco.',
  }
}

/** O contexto do card que a gravação precisa, além das respostas. */
export interface ContextoDoCard {
  numero_processo?: string
  cedente?: string
  /** O que está sendo cedido, do título do card. Ver lerTituloCard/classificarParcelaCedida. */
  tipo_aquisicao?: string
  /** % dos honorários contratuais que o comercial cadastrou, em pontos. */
  honorarios_pct?: string | number | null
  /** O bloco "Histórico do Cedente" tem de onde sair? Sem checklist, ele fica em branco. */
  temChecklist: boolean
  /** A leitura omitiu parte do processo por tamanho (só o motor antigo corta). */
  cortou?: boolean
}

/** A ficha do crédito que vai para o card do Kommo — mesmos rótulos da RPV. */
export interface FichaDoPrecatorio {
  tipo: 'Precatório'
  processo: string
  tribunal: string
  cedente: string
  entidade_devedora: string
  parcela_cedida: string
  valor_cedido: number
  honorarios_pct: number | null
}

/**
 * Grava as respostas na aba e monta a ficha do card.
 *
 * É O PASSO 4 E 4b DO MOTOR ANTIGO, movido para cá sem mudar uma regra: a célula
 * que já tem conteúdo nunca é escrita; resposta de busca web sem link é
 * descartada; linha fora do questionário é ignorada com aviso; e a ficha segue a
 * mesma tabela de verbas da RPV, pelo mesmo módulo de preço.
 */
export function aplicarRespostas(
  ws: AbaDaPlanilha,
  linhas: LinhaQuestionario[],
  comFormula: number[],
  saida: SaidaDaPlanilha,
  ctx: ContextoDoCard,
): { escritas: number; avisos: string[]; ficha: FichaDoPrecatorio; verbasNome: string } {
  const porLinha = new Map(linhas.map((l) => [l.linha, l]))
  const avisos: string[] = [...(saida.avisos ?? [])]
  const semFonte: number[] = []
  const foraDoQuestionario: number[] = []
  let escritas = 0

  for (const r of saida.respostas ?? []) {
    const def = porLinha.get(Number(r.linha))
    if (!def) {
      foraDoQuestionario.push(Number(r.linha))
      continue
    }
    const valor = String(r.resposta ?? '').trim()
    if (!valor) continue

    // NÚMERO DE ORÇAMENTO PÚBLICO SEM LINK NÃO ENTRA. Decisão do dono, e o
    // próprio modelo pede a fonte: as células C91, C92, C96, C97, C99, C100 e
    // C101 são rótulos de "Link da fonte utilizada".
    if (def.fonte === 'web' && !String(r.fonte_url ?? '').trim()) {
      semFonte.push(def.linha)
      continue
    }

    const row = ws.getRow(def.linha)
    // O guard de novo, agora contra o valor: a célula pode ter sido preenchida
    // por uma resposta anterior desta mesma rodada (linha repetida na saída).
    if (row.getCell(def.col).value != null) continue
    row.getCell(def.col).value = valor
    escritas++

    const complemento = String(r.complemento ?? '').trim()
    const link = String(r.fonte_url ?? '').trim()
    // Em D vai o complemento; quando a linha é de busca, o link entra junto —
    // é o que o rótulo da coluna C pede naquelas linhas.
    const emD = [complemento, def.fonte === 'web' ? link : ''].filter(Boolean).join(' — ')
    if (emD && def.col === 'B' && row.getCell('D').value == null) {
      row.getCell('D').value = emD
    }
  }

  if (semFonte.length) {
    avisos.push(
      `${semFonte.length} resposta(s) sobre a saúde financeira do ente foram DESCARTADAS por vir sem link da fonte (linhas ${semFonte.join(', ')}). Busque na LOA e no site do Tribunal e preencha à mão.`,
    )
  }
  if (comFormula.length) {
    avisos.push(
      `As linhas ${comFormula.join(', ')} têm fórmula na planilha e a IA não escreve nelas: a própria planilha calcula Mora/RCL, a faixa de repasse da EC 136/2025 e o valor do repasse a partir da RCL e do estoque de mora.`,
    )
  }
  if (!ctx.temChecklist) {
    avisos.push(
      'O bloco "Histórico do Cedente" ficou em branco: nenhum sujeito cadastrado. Monte o checklist na aba Certidões da Due diligence e gere de novo.',
    )
  }
  if (ctx.cortou) {
    avisos.push(
      'O processo é grande e PARTE do conteúdo foi omitida na leitura. Confira as datas e os valores do caderno processual.',
    )
  }
  if (foraDoQuestionario.length) {
    avisos.push(
      `A IA respondeu ${foraDoQuestionario.length} linha(s) que não existem no questionário (${foraDoQuestionario.join(', ')}) — foram ignoradas.`,
    )
  }

  // 4b. A FICHA QUE VOLTA PARA O CARD DO KOMMO.
  //
  // Mesmos rótulos e mesmo significado da análise de RPV, de propósito: é o
  // comercial lendo o card, e ele não deve ter de aprender dois formatos por
  // causa de uma diferença que só existe do nosso lado.
  //
  // O QUE ESTÁ SENDO CEDIDO VEM DO TÍTULO DO CARD, com as mesmas regras da
  // RPV (ver lerTituloCard e classificarParcelaCedida no navegador).
  const _pc = String(ctx.tipo_aquisicao ?? 'auto')
  const _f = saida.ficha ?? {}
  const _n = (v: unknown) => Number(v) || 0
  const _honPctRaw = (ctx.honorarios_pct === '' || ctx.honorarios_pct == null) ? null : Number(ctx.honorarios_pct)
  const _honPctCard = (_honPctRaw != null && !isNaN(_honPctRaw) && _honPctRaw >= 0) ? _honPctRaw : null

  const _brutoAutos = _n(_f.bruto_total)
  const _contratuaisAutos = _n(_f.honorarios_contratuais)
  const _sucumbAutos = _n(_f.honorarios_sucumbenciais)
  // O % do card manda no valor do contratual, como na RPV: aqui a base é o
  // bruto quando houve destaque e o líquido quando não — e sem destaque não
  // há contratual nos autos, então o bruto é a base só se ele existir.
  const _baseHon = _contratuaisAutos > 0 ? _brutoAutos : (_brutoAutos - _n(_f.ir) - _n(_f.inss))
  const _contratuais = _honPctCard != null ? _baseHon * (_honPctCard / 100) : _contratuaisAutos

  // AS VERBAS DO NEGÓCIO, na mesma tabela de decisão da RPV. 'indefinido' —
  // o card diz "honorários" e não diz quais — é resolvido contra os autos:
  // a maioria dos precatórios de Juizado não tem sucumbência (art. 55 da Lei
  // 9.099/95), e ali "honorários" é o contratual, o único que existe.
  const _temCon = _contratuais > 0
  const _temSuc = _sucumbAutos > 0
  const _verbas: VerbasNegociadas =
    _pc === 'principal' ? { principal: true, contratuais: false, sucumbenciais: false }
    : _pc === 'sucumbenciais' ? { principal: false, contratuais: false, sucumbenciais: true }
    : (_pc === 'honorarios' || _pc === 'contratuais' || _pc === 'indefinido')
      ? { principal: false, contratuais: true, sucumbenciais: true }
      : { principal: true, contratuais: true, sucumbenciais: true }

  if (_pc === 'indefinido' && _temCon && _temSuc)
    avisos.unshift(
      '⚠️ O card diz apenas "honorários" e este processo tem OS DOIS: contratuais e sucumbenciais. ' +
      'Escreva no card qual verba está sendo cedida — disso depende o valor do negócio.',
    )
  else if (_pc === 'indefinido' && (_temCon || _temSuc))
    avisos.push(
      `O card diz apenas "honorários"; o processo tem só os ${_temSuc ? 'sucumbenciais' : 'contratuais'}, ` +
      'então é essa a verba da ficha.',
    )
  if (_pc === 'auto')
    avisos.unshift(
      '⚠️ PARCELA CEDIDA NÃO INFORMADA no card: a ficha assume principal + honorários. ' +
      'Se a cessão for só de honorários, o VALOR CEDIDO está muito alto — escreva a parcela cedida no título do card.',
    )

  // A PORCENTAGEM CONFERIDA EM PONTOS, e não em reais: o mesmo percentual
  // sobre bases diferentes dá reais diferentes, e é a base que costuma
  // divergir. Um ponto de tolerância cobre arredondamento de divisão.
  const _pctLido = Number(_f.honorarios_contratuais_pct)
  const _pctDoProcesso = Number.isFinite(_pctLido) && _pctLido > 0
  const _pctAutos = _pctDoProcesso
    ? _pctLido
    : (_baseHon > 0 && _contratuaisAutos > 0 ? (_contratuaisAutos / _baseHon) * 100 : null)
  if (_honPctCard != null && _pctAutos != null && Math.abs(_honPctCard - _pctAutos) > 1)
    avisos.unshift(
      `⚠️ HONORÁRIOS CONTRATUAIS DIVERGENTES: o card diz ${_honPctCard.toFixed(2)}% e o processo indica ` +
      `${_pctAutos.toFixed(2)}% (${_pctDoProcesso ? String(_f.honorarios_contratuais_pct_origem ?? 'lida no processo') : 'estimada aqui, porque o processo não traz a porcentagem escrita'}). ` +
      'Confira o contrato de honorários.',
    )

  // VALOR CEDIDO = a soma dos líquidos das verbas negociadas, pelo MESMO
  // módulo que a RPV usa (_shared/precificacao.ts). Mesmo rótulo no card tem
  // de querer dizer a mesma coisa nos dois fluxos; reimplementar a conta aqui
  // é como os dois divergiriam. Verba de valor zero é descartada lá dentro.
  //
  // NÃO É PREÇO: a etapa jurídica do precatório não precifica (deságio e prazo
  // de resgate são digitados na aba Precificação). É o valor do crédito.
  const _parcelas = montarParcelas({
    brutoTotal: _brutoAutos,
    ir: _n(_f.ir),
    inss: _n(_f.inss),
    contratuaisBrutos: _contratuais,
    sucumbenciaisBrutos: _sucumbAutos,
    verbas: _verbas,
  })
  const _valorCedido = _parcelas.reduce((t, p) => t + p.liquido, 0)
  const SIGLA_VERBA: Record<string, string> = {
    principal: 'Principal', contratuais: 'Contratuais', sucumbenciais: 'Sucumbenciais',
  }
  const verbasNome = _parcelas.map((p) => SIGLA_VERBA[p.nome] ?? p.nome).join(' + ')

  const ficha: FichaDoPrecatorio = {
    tipo: 'Precatório',
    processo: String(ctx.numero_processo ?? ''),
    tribunal: String(_f.tribunal ?? '').trim(),
    // O nome LIDO DOS AUTOS, e não o do título do card: é o mesmo que nomeia
    // a pasta no Drive, então ficha e arquivo não divergem.
    cedente: String(_f.cedente_nome ?? ctx.cedente ?? '').trim(),
    entidade_devedora: String(_f.entidade_devedora ?? '').trim(),
    parcela_cedida: rotuloDoCenario(_verbas),
    valor_cedido: _valorCedido,
    honorarios_pct: _honPctCard ?? _pctAutos,
  }

  return { escritas, avisos, ficha, verbasNome }
}

/**
 * O que a CONVERSA recebe junto com os autos, no Interno: o questionário, o
 * checklist, as regras e o formato do bloco que ela devolve.
 *
 * DEPOIS DA QUALIFICAÇÃO, e não no lugar dela: o roteiro da casa segue sendo o
 * trabalho principal, e a planilha é a mesma leitura escrita em células. É o que
 * faz a planilha nascer do contexto que a conversa construiu — o pedido da
 * equipe —, e não de uma segunda leitura feita por outro modelo, em outro lugar.
 */
export function secaoDaPlanilhaParaAConversa(
  linhas: LinhaQuestionario[],
  checklist: string,
): string {
  return [
    '## PLANILHA DA ANÁLISE JURÍDICA (precatório interno)',
    '',
    'DEPOIS DA QUALIFICAÇÃO, na mesma resposta, preencha o questionário abaixo. Ele é a',
    'aba "Análise Jurídica" do modelo de planilha da casa, lida agora do modelo em vigor;',
    'a plataforma grava as suas respostas nele, salva no Drive e anota no card. Use a',
    'leitura que você acabou de fazer: é para isso que a planilha está nesta conversa.',
    '',
    REGRAS_DA_PLANILHA,
    '',
    '8. ENTREGUE A PLANILHA NO FIM, de um destes dois jeitos:',
    '',
    '   a) SE VOCÊ TEM A FERRAMENTA `entregar_planilha`, chame-a UMA VEZ, com o código',
    '      desta análise e o objeto inteiro. Ela grava a planilha no modelo da casa,',
    '      salva no Drive e anota no card — e devolve o link, que você põe na resposta.',
    '      Nada precisa ser colado por ninguém.',
    '',
    '   b) SE NÃO TEM, entregue um bloco de código ```json com o mesmo objeto. Quem',
    '      opera COPIA ESSE BLOCO e cola na plataforma — nada fora dele é lido, e um',
    '      JSON quebrado não entra.',
    '',
    '   O objeto tem exatamente estas chaves: "respostas" (lista de {"linha", "resposta",',
    '   "complemento", "fonte_url"}), "avisos" (lista de frases), "resumo" (texto) e',
    '   "ficha" (objeto com tribunal, entidade_devedora, cedente_nome, bruto_total, ir,',
    '   inss, honorarios_contratuais, honorarios_sucumbenciais, honorarios_contratuais_pct,',
    '   honorarios_contratuais_pct_origem). Números da ficha sem "R$" e sem separador de',
    '   milhar (1234567.89); número que você não achou vai null.',
    '',
    'O esquema completo, para não haver dúvida:',
    '',
    '```json',
    JSON.stringify(ESQUEMA_DA_SAIDA),
    '```',
    '',
    '### QUESTIONÁRIO (responda pelo número da linha)',
    montarQuestionario(linhas),
    '',
    '### CHECKLIST DE CERTIDÕES DA PLATAFORMA (a fonte do "Histórico do Cedente")',
    checklist,
  ].join('\n')
}
