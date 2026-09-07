// analise-precatorio — preenche a aba "Análise Jurídica" do modelo de precatórios.
//
// SEPARADA DA gerar-analise-rpv de propósito, e não por organização de arquivos.
// Aquela função é o motor de RPV: template Modelo_Analise_de_RPV.xlsx, cenários
// "RPV expedida / não expedida", prazo tirado do convênio de 60 dias do TJGO e um
// prompt que se apresenta como "especializado em créditos RPV". Rodá-la num
// precatório entregava parecer e planilha errados sem nenhum sinal na tela — foi
// o defeito que originou esta função. Precatório tem regime, fila, LOA e EC
// 136/2025; nada disso cabe como remendo lá.
//
// PREENCHE SÓ A ABA "ANÁLISE JURÍDICA". As abas Precificação e Indicadores da
// operação ficam para a etapa de Precificação (a coluna "Análise
// Econômico-Financeira (TIER 1)" do Kommo) — decisão do dono. Elas dependem de
// PRAZO DE RESGATE e DESÁGIO, que no modelo são campos DIGITADOS, sem fórmula:
// não há o que derivar do processo.
//
// O QUESTIONÁRIO VEM DO PRÓPRIO TEMPLATE, não de uma constante aqui. O template é
// baixado do Storage, lido com ExcelJS, e as perguntas da coluna A viram o
// questionário do prompt. Assim a planilha é a única fonte de verdade: mudar uma
// pergunta lá muda o que a IA responde, sem deploy. A alternativa — copiar as
// ~85 perguntas para cá — cria duas verdades que divergem no primeiro ajuste.
//
// TRÊS FONTES, UMA POR BLOCO, e a regra de cada uma está no prompt:
//
//   Dados Básicos (L4-22)         o PDF do processo
//   Histórico do Cedente (28-81)  O BANCO — é o checklist de certidões da
//                                 plataforma (dd_sujeito/dd_certidao), não a IA
//   Saúde financeira (85-101)     BUSCA WEB, com link obrigatório
//   Caderno Processual (105-137)  o PDF do processo
//   Fechamento (138-139)          o PDF do processo
//
// CÉLULA QUE JÁ TEM CONTEÚDO NUNCA É ESCRITA. É o guard que impede o maior risco
// desta função: escrever a resposta na célula errada produz planilha que PARECE
// preenchida e está errada. Ele já pegou três casos reais — B93, B94 e B95
// (Mora/RCL, % de repasse da EC 136/2025 e valor do repasse) contêm FÓRMULAS que
// a planilha calcula sozinha a partir de B91 e B92. Escrever ali apagaria a conta.
//
// A DECISÃO NÃO É AUTOMÁTICA. O bloco "Critérios de Aceitação e Recusa"
// (L141-150) do modelo já vem escrito e não é preenchido: ele é a régua que uma
// pessoa aplica. O motor entrega o parecer e os avisos; aprovar ou reprovar
// segue sendo clique de gente, diferente do RPV, que tem portão automático.
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { ERRO_ACESSO, getCallerAtivo, serviceClient } from '../_shared/auth.ts'
import { chaveAnthropic, segredoGoogle } from '../_shared/segredos.ts'
import {
  driveEncontrarAnalisesRoot,
  driveFindChildByTolerantName,
  driveFindOrCreateFolder,
  driveUploadBytes,
  refreshGoogleAccessToken,
  storageGetBytes,
} from '../_shared/credijuris.ts'
import { montarParcelas, rotuloDoCenario, type VerbasNegociadas } from '../_shared/precificacao.ts'
import Anthropic from 'npm:@anthropic-ai/sdk@0.115.0'
import ExcelJS from 'npm:exceljs@4.4.0'

/**
 * OPUS 5, e não Sonnet.
 *
 * Mesmo raciocínio da extrair-credito: roda UMA VEZ por crédito e o trabalho é
 * discriminação jurídica — separar homologação de trânsito em julgado, cessão
 * noticiada de cessão homologada, penhora requerida de penhora deferida. Errar
 * sai mais caro que o token, porque a resposta errada entra numa planilha que a
 * pessoa vai ler como conferida.
 */
const MODELO = 'claude-opus-5'
const ABA = 'Análise Jurídica'
const BUCKET_TEMPLATES = 'contratos-templates'
const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const CATEGORIA = 'Precatórios'

/** Teto do texto do processo mandado ao modelo. Corta o MEIO, mantendo pontas. */
const MAX_CHARS = 380_000
/**
 * Buscas web e retomadas.
 *
 * As duas existem pelo mesmo motivo: a Edge Function tem teto de tempo de
 * parede. Uma varredura sem limite estoura o teto e o usuário recebe erro de
 * rede em vez de análise. 8 buscas cobrem RCL, estoque de mora, regime, ordem
 * cronológica e editais; 3 retomadas cobrem o laço de amostragem do servidor.
 */
const MAX_BUSCAS = 8
const MAX_RETOMADAS = 3

/**
 * Os blocos da aba e a coluna que recebe a resposta.
 *
 * A DIFERENÇA DE COLUNA NÃO É CAPRICHO, é o desenho da planilha: no bloco de
 * Dados Básicos a pergunta ocupa A:B mesclado e a resposta ocupa C:D mesclado —
 * confirmado pela aba Precificação, cuja célula B11 é `='Análise Jurídica'!C4`.
 * Nos outros blocos o cabeçalho é literal: A=Pergunta, B=Resposta,
 * C=Complemento, D=Resposta (do complemento).
 */
const BLOCOS = [
  { nome: 'Dados Básicos do Crédito', de: 4, ate: 22, col: 'C', fonte: 'pdf' },
  { nome: 'Histórico do Cedente', de: 28, ate: 81, col: 'B', fonte: 'banco' },
  { nome: 'Saúde financeira da Entidade Devedora', de: 85, ate: 101, col: 'B', fonte: 'web' },
  { nome: 'Análise do Caderno Processual', de: 105, ate: 137, col: 'B', fonte: 'pdf' },
  { nome: 'Fechamento', de: 138, ate: 139, col: 'B', fonte: 'pdf' },
] as const

type Fonte = (typeof BLOCOS)[number]['fonte']

interface LinhaQuestionario {
  linha: number
  bloco: string
  fonte: Fonte
  pergunta: string
  /** Instrução da coluna C, quando é instrução de verdade (não "-"). */
  complemento: string | null
  col: string
}

// ---------------------------------------------------------------------------
// Leitura do template
// ---------------------------------------------------------------------------

const textoDaCelula = (c: { value: unknown }): string => {
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
const enxuto = (s: string) => s.replace(/\s+/g, ' ').trim()

/**
 * Acha o template no bucket sem depender do nome exato.
 *
 * O arquivo foi subido à mão, e nome subido à mão varia: acento que o Storage
 * recusa, extensão dobrada (".xlsx.xlsx" acontece quando se renomeia no
 * Windows com as extensões ocultas). Amarrar num literal fazia a função morrer
 * com "objeto não encontrado" sem dizer o que ELA achou — daí listar e escolher.
 */
async function acharTemplate(
  svc: ReturnType<typeof serviceClient>,
): Promise<{ path: string; bytes: Uint8Array }> {
  const { data, error } = await svc.storage.from(BUCKET_TEMPLATES).list('', { limit: 200 })
  if (error) throw new Error(`Não consegui listar o bucket ${BUCKET_TEMPLATES}: ${error.message}`)
  const nomes = (data ?? []).map((o) => o.name)
  const alvo = nomes.find((n) => /precat/i.test(n) && /\.xlsx(\.xlsx)?$/i.test(n))
  if (!alvo) {
    throw new Error(
      `Não achei o modelo de precatórios no bucket ${BUCKET_TEMPLATES}. ` +
        `Encontrei: ${nomes.length ? nomes.join(', ') : '(bucket vazio)'}. ` +
        `Suba o arquivo com "precatorios" no nome e extensão .xlsx.`,
    )
  }
  return { path: alvo, bytes: await storageGetBytes(svc, BUCKET_TEMPLATES, alvo) }
}

/**
 * O questionário, lido da aba.
 *
 * Fica de fora o que não é pergunta:
 *   - cabeçalho de sub-bloco, reconhecido pelo merge A{n}:D{n} ("Cônjuge (se
 *     houver)", "Se Regime Geral"…) — é título, não pergunta;
 *   - linha cuja célula de resposta JÁ TEM conteúdo, que são as fórmulas da
 *     EC 136/2025 (B93/B94/B95). A planilha as calcula; o motor não escreve.
 */
function lerQuestionario(ws: {
  model: { merges?: string[] }
  getRow: (n: number) => { getCell: (c: string) => { value: unknown } }
}): { linhas: LinhaQuestionario[]; comFormula: number[] } {
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

// ---------------------------------------------------------------------------
// O que a plataforma já sabe: o checklist de certidões
// ---------------------------------------------------------------------------

interface Sujeito {
  id: string
  papel: string
  tipo_pessoa: string
  nome: string
  documento: string
  uf_atual: string | null
  municipio_atual: string | null
  ufs_anteriores: string[]
  municipios_anteriores: string[]
  residencia_levantada: boolean
}

/**
 * O bloco "Histórico do Cedente" em texto, a partir do banco.
 *
 * A PLATAFORMA NÃO GUARDA SE A CERTIDÃO VEIO POSITIVA OU NEGATIVA. `dd_certidao`
 * registra se ela foi OBTIDA (status), não o resultado dela — `regra_positiva`
 * fica no catálogo e diz o que fazer quando é positiva, sem que ninguém anote
 * que foi. Então o texto abaixo diz o estado do checklist, e o prompt proíbe a
 * IA de concluir positivo/negativo a partir dele. Confundir "obtida" com
 * "negativa" reprovaria ou aprovaria crédito por dado que não existe.
 */
async function checklistEmTexto(
  svc: ReturnType<typeof serviceClient>,
  leadId: number,
): Promise<{ texto: string; temChecklist: boolean }> {
  const { data: sujeitos } = await svc
    .from('dd_sujeito')
    .select(
      'id, papel, tipo_pessoa, nome, documento, uf_atual, municipio_atual, ufs_anteriores, municipios_anteriores, residencia_levantada',
    )
    .eq('kommo_lead_id', leadId)
  const suj = (sujeitos ?? []) as Sujeito[]
  if (suj.length === 0) {
    return {
      texto:
        'NENHUM SUJEITO CADASTRADO. A due diligence de certidões deste crédito ainda ' +
        'não foi iniciada na plataforma (aba Certidões da janela de Due diligence).',
      temChecklist: false,
    }
  }

  const { data: itens } = await svc
    .from('dd_certidao')
    .select(
      'sujeito_id, certidao_codigo, status, obrigatoria, parametros, emitida_em, validade_ate, dispensa_motivo',
    )
    .eq('kommo_lead_id', leadId)
  const { data: catalogo } = await svc
    .from('certidao_catalogo')
    .select('codigo, nome_curto')
  const nomeDaCertidao = new Map(
    ((catalogo ?? []) as { codigo: string; nome_curto: string }[]).map((c) => [
      c.codigo,
      c.nome_curto,
    ]),
  )

  const partes: string[] = []
  for (const s of suj) {
    const meus = ((itens ?? []) as Record<string, unknown>[]).filter(
      (i) => i.sujeito_id === s.id,
    )
    const enderecos = [
      s.uf_atual || s.municipio_atual
        ? `residência atual: ${[s.municipio_atual, s.uf_atual].filter(Boolean).join('/')}`
        : 'residência atual não informada',
      s.ufs_anteriores.length || s.municipios_anteriores.length
        ? `anteriores: ${[...s.municipios_anteriores, ...s.ufs_anteriores].join(', ')}`
        : s.residencia_levantada
          ? 'histórico de residência levantado, sem endereços anteriores'
          : 'HISTÓRICO DE RESIDÊNCIA NÃO LEVANTADO',
    ].join('; ')

    partes.push(
      `— ${s.papel} (${s.tipo_pessoa}): ${s.nome}, doc ${s.documento}. ${enderecos}.`,
    )
    if (meus.length === 0) {
      partes.push('    checklist não montado para este sujeito.')
      continue
    }
    for (const i of meus) {
      const nome = nomeDaCertidao.get(String(i.certidao_codigo)) ?? String(i.certidao_codigo)
      const p = i.parametros as Record<string, unknown> | null
      const escopo = p && Object.keys(p).length ? ` [${Object.values(p).join('/')}]` : ''
      const extra = [
        i.emitida_em ? `emitida ${i.emitida_em}` : null,
        i.validade_ate ? `vale até ${i.validade_ate}` : null,
        i.dispensa_motivo ? `DISPENSADA: ${i.dispensa_motivo}` : null,
      ]
        .filter(Boolean)
        .join(', ')
      partes.push(
        `    ${nome}${escopo}: ${i.status}${i.obrigatoria ? '' : ' (não obrigatória)'}` +
          (extra ? ` — ${extra}` : ''),
      )
    }
  }
  return { texto: partes.join('\n'), temChecklist: true }
}

// ---------------------------------------------------------------------------
// A ferramenta e o prompt
// ---------------------------------------------------------------------------

const FERRAMENTA = {
  name: 'preencher_analise_juridica',
  description:
    'Devolve as respostas do questionário da aba "Análise Jurídica", uma por linha da planilha.',
  input_schema: {
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
  },
}

function montarSistema(qtdLinhas: number): string {
  return `Você é analista jurídico da Credijuris e faz a ANÁLISE JURÍDICA de um precatório para aquisição. Preenche um questionário de ${qtdLinhas} linhas que é o modelo interno da casa.

REGRAS, em ordem de importância:

1. NÃO INVENTE. Linha que você não consegue sustentar simplesmente NÃO ENTRA em "respostas". Deixar em branco para uma pessoa preencher é o resultado certo; um valor plausível e errado entra na planilha com cara de conferido e ninguém revisa duas vezes.

2. CADA BLOCO TEM UMA FONTE, e usar a fonte errada é o erro grave desta análise:

   • "Dados Básicos do Crédito", "Análise do Caderno Processual" e "Fechamento" — SÓ o texto do processo, que vem abaixo. Não busque na web para responder estas.

   • "Histórico do Cedente" — SÓ o estado do checklist de certidões da plataforma, que vem abaixo. Não busque na web e não deduza do processo.
     ⚠️ O CHECKLIST NÃO DIZ SE A CERTIDÃO VEIO POSITIVA OU NEGATIVA. Ele diz se ela foi obtida. Então responda o ESTADO ("Obtida em 12/08/2026 — resultado não registrado na plataforma; conferir o PDF na pasta", "Pendente de emissão", "Dispensada: <motivo>", "Não consta no checklist"). NUNCA escreva "negativa", "positiva", "nada consta" ou "regular": esse dado não existe no sistema, e inventá-lo aprova ou reprova crédito por informação que ninguém apurou.

   • "Saúde financeira da Entidade Devedora" — BUSCA WEB. É o único bloco em que você deve pesquisar. Procure a Receita Corrente Líquida na LOA do ente, o estoque de precatórios em mora no site do Tribunal, o regime (Geral ou Especial), a ordem cronológica e os editais de negociação.
     ⚠️ NÚMERO SEM LINK NÃO ENTRA. Toda resposta deste bloco exige "fonte_url" com o endereço exato da página. Se você não achou fonte oficial, omita a linha e escreva em "avisos" o que falta buscar. Isto é orçamento público: número sem procedência é pior que célula vazia.
     Prefira fonte oficial — portal do Tribunal, Diário Oficial, portal da transparência, sítio da Fazenda do ente. Não use blog, notícia ou agregador para o VALOR; para achar o caminho até a fonte oficial, pode.

3. RESPONDA CURTO. A célula é de planilha, não de parecer. Pergunta fechada leva "Sim" ou "Não", com o dado pedido no complemento. "Sim — 14/03/2024" no lugar de um parágrafo.

4. O COMPLEMENTO É O QUE A LINHA PEDE. Quando o questionário mostra a instrução de complemento, ela diz exatamente o que vai ali: a data, o número do processo, o valor, o link da jurisprudência. Complemento vazio numa linha que pede complemento é resposta incompleta.

5. NÃO DECIDA A OPERAÇÃO. Você não aprova nem reprova. O modelo tem um bloco de "Critérios de Aceitação e Recusa" que uma pessoa aplica sobre o que você preencheu. Escreva os fatos e ponha o risco em "avisos"; a palavra final não é sua.

6. DISTINGA O QUE O PROCESSO DISTINGUE. As armadilhas frequentes: valor APRESENTADO não é valor HOMOLOGADO; cálculo homologado não é precatório expedido; precatório expedido não é autuado na Presidência; autuado não é incluído na LOA; cessão NOTICIADA não é cessão HOMOLOGADA; penhora REQUERIDA não é penhora DEFERIDA. Quando o processo mostra um estágio e não o seguinte, responda o que ele mostra.

7. DATAS EM DD/MM/AAAA. Dinheiro com separador de milhar brasileiro e duas casas: 1.234.567,89.

Responda chamando a ferramenta preencher_analise_juridica uma única vez, ao final.`
}

function montarQuestionario(linhas: LinhaQuestionario[]): string {
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

/** Corta o meio, preservando início e fim: a inicial abre, a homologação fecha. */
function cortarTexto(t: string): { texto: string; cortou: boolean } {
  if (t.length <= MAX_CHARS) return { texto: t, cortou: false }
  const cabeca = Math.floor(MAX_CHARS * 0.55)
  return {
    texto:
      t.slice(0, cabeca) +
      '\n\n[...TRECHO INTERMEDIÁRIO OMITIDO POR TAMANHO...]\n\n' +
      t.slice(t.length - (MAX_CHARS - cabeca)),
    cortou: true,
  }
}

// ---------------------------------------------------------------------------
// Drive — a árvore "A. Análises de crédito" mora em _shared/credijuris.ts
// (driveEncontrarAnalisesRoot), a mesma que a análise de RPV percorre. Havia
// aqui uma terceira cópia dela; saiu.
// ---------------------------------------------------------------------------

const limparNomeArquivo = (s: string) =>
  s.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 180)

// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const svc = serviceClient()
    const caller = await getCallerAtivo(req, svc)
    if (!caller) return jsonResponse({ error: ERRO_ACESSO }, 401)

    const body = (await req.json().catch(() => ({}))) as {
      kommo_lead_id?: number
      texto?: string
      numero_processo?: string
      cedente?: string
      originador?: string
      /** O que está sendo cedido, do título do card. Ver lerTituloCard/classificarParcelaCedida. */
      tipo_aquisicao?: string
      /** % dos honorários contratuais que o comercial cadastrou, em pontos. */
      honorarios_pct?: string | number | null
    }
    const leadId = Number(body.kommo_lead_id)
    const bruto = String(body.texto ?? '')
    if (!leadId) return jsonResponse({ error: 'kommo_lead_id é obrigatório.' }, 400)
    if (bruto.trim().length < 500) {
      return jsonResponse(
        {
          error:
            'O texto do processo veio vazio ou curto demais para analisar. ' +
            'Confira se o PDF do card tem texto selecionável (processo digitalizado não serve).',
        },
        400,
      )
    }

    const chave = await chaveAnthropic()
    if (!chave) {
      return jsonResponse(
        { error: 'Chave da Anthropic não configurada. Veja Configurações → Anthropic.' },
        500,
      )
    }
    const google = await segredoGoogle()
    if (!google) {
      return jsonResponse(
        { error: 'Credenciais do Google não configuradas — sem elas não dá para salvar no Drive.' },
        500,
      )
    }

    // 1. Template do Storage, que é também a fonte do questionário.
    const { path: templatePath, bytes: templateBytes } = await acharTemplate(svc)
    const wb = new ExcelJS.Workbook()
    // O tipo do ExcelJS pede Buffer do Node; no Deno o que existe é Uint8Array,
    // e a biblioteca lê os dois igual. Mesmo elenco da gerar-analise-rpv.
    await wb.xlsx.load(templateBytes as unknown as Parameters<typeof wb.xlsx.load>[0])
    // TOLERANTE A CAIXA E ACENTO de propósito: o template de RPV chama a aba de
    // "Análise jurídica" e o de precatórios de "Análise Jurídica". Amarrar no
    // literal quebraria a função por uma letra maiúscula.
    const chaveAba = (n: string) =>
      n.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
    const ws = wb.worksheets.find(
      (w: { name: string }) => chaveAba(w.name) === chaveAba(ABA),
    )
    if (!ws) {
      throw new Error(
        `O template ${templatePath} não tem a aba "${ABA}". Abas encontradas: ` +
          wb.worksheets.map((w: { name: string }) => w.name).join(', '),
      )
    }
    const { linhas, comFormula } = lerQuestionario(
      ws as unknown as Parameters<typeof lerQuestionario>[0],
    )
    if (linhas.length === 0) {
      throw new Error(`Não achei pergunta nenhuma na aba "${ABA}" de ${templatePath}.`)
    }

    // 2. O que a plataforma já sabe sobre os sujeitos e as certidões.
    const checklist = await checklistEmTexto(svc, leadId)

    // 3. A leitura.
    const { texto, cortou } = cortarTexto(bruto)
    const anthropic = new Anthropic({ apiKey: chave })
    const mensagens: Anthropic.MessageParam[] = [
      {
        role: 'user',
        content:
          `QUESTIONÁRIO (responda pelo número da linha):\n${montarQuestionario(linhas)}\n\n` +
          `CHECKLIST DE CERTIDÕES DA PLATAFORMA:\n${checklist.texto}\n\n` +
          `O QUE JÁ SE SABE DO CARD:\n` +
          `Número do processo: ${body.numero_processo || '(não informado)'}\n` +
          `Cedente: ${body.cedente || '(não informado)'}\n` +
          `Originador: ${body.originador || '(não informado)'}\n\n` +
          `TEXTO DO PROCESSO:\n${texto}`,
      },
    ]

    let resposta = await (async () => {
      let atual = await anthropic.messages
        .stream({
          model: MODELO,
          max_tokens: 24000,
          system: [
            {
              type: 'text',
              text: montarSistema(linhas.length),
              cache_control: { type: 'ephemeral' },
            },
          ],
          // Ferramenta NOSSA + busca web da Anthropic. `tool_choice` fica em
          // 'auto' (o padrão) de propósito: forçar a ferramenta impediria o
          // modelo de pesquisar antes de responder, e o bloco da saúde
          // financeira do ente depende exatamente disso.
          tools: [
            FERRAMENTA,
            { type: 'web_search_20260209', name: 'web_search', max_uses: MAX_BUSCAS },
          ],
          messages: mensagens,
        })
        .finalMessage()

      // O laço de amostragem do servidor tem teto próprio; ao bater nele a
      // resposta volta com stop_reason 'pause_turn'. Reenviar o turno pausado
      // faz o servidor retomar de onde parou — e NÃO se acrescenta mensagem de
      // usuário nenhuma, o próprio bloco de server_tool_use sinaliza a retomada.
      for (let i = 0; i < MAX_RETOMADAS && atual.stop_reason === 'pause_turn'; i++) {
        mensagens.push({ role: 'assistant', content: atual.content })
        atual = await anthropic.messages
          .stream({
            model: MODELO,
            max_tokens: 24000,
            system: [
              {
                type: 'text',
                text: montarSistema(linhas.length),
                cache_control: { type: 'ephemeral' },
              },
            ],
            tools: [
              FERRAMENTA,
              { type: 'web_search_20260209', name: 'web_search', max_uses: MAX_BUSCAS },
            ],
            messages: mensagens,
          })
          .finalMessage()
      }
      return atual
    })()

    const uso = resposta.content.find(
      (c) => c.type === 'tool_use' && c.name === FERRAMENTA.name,
    )
    if (!uso || uso.type !== 'tool_use') {
      const texto = resposta.content
        .filter((c) => c.type === 'text')
        .map((c) => (c as { text: string }).text)
        .join(' ')
        .slice(0, 400)
      return jsonResponse(
        {
          error:
            'O modelo não devolveu o questionário preenchido' +
            (resposta.stop_reason === 'pause_turn'
              ? ' — a pesquisa não terminou dentro do limite de retomadas.'
              : '.') +
            (texto ? ` Ele disse: "${texto}"` : ''),
        },
        502,
      )
    }
    const saida = uso.input as {
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

    // 4. Preenchimento, com os guards.
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
    if (!checklist.temChecklist) {
      avisos.push(
        'O bloco "Histórico do Cedente" ficou em branco: nenhum sujeito cadastrado. Monte o checklist na aba Certidões da Due diligence e gere de novo.',
      )
    }
    if (cortou) {
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
    const _pc = String(body.tipo_aquisicao ?? 'auto')
    const _f = saida.ficha ?? {}
    const _n = (v: unknown) => Number(v) || 0
    const _honPctRaw = (body.honorarios_pct === '' || body.honorarios_pct == null) ? null : Number(body.honorarios_pct)
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
    const _verbasNome = _parcelas.map((p) => SIGLA_VERBA[p.nome] ?? p.nome).join(' + ')

    const ficha = {
      tipo: 'Precatório',
      processo: String(body.numero_processo ?? ''),
      tribunal: String(_f.tribunal ?? '').trim(),
      // O nome LIDO DOS AUTOS, e não o do título do card: é o mesmo que nomeia
      // a pasta no Drive, então ficha e arquivo não divergem.
      cedente: String(_f.cedente_nome ?? body.cedente ?? '').trim(),
      entidade_devedora: String(_f.entidade_devedora ?? '').trim(),
      parcela_cedida: rotuloDoCenario(_verbas),
      valor_cedido: _valorCedido,
      honorarios_pct: _honPctCard ?? _pctAutos,
    }

    // 5. Drive: A. Análises de crédito / Precatórios / {originador} / {cedente}
    const token = await refreshGoogleAccessToken(
      google.client_id,
      google.client_secret,
      google.refresh_token,
    )
    const raiz = await driveEncontrarAnalisesRoot(token)
    const catFolder = await driveFindChildByTolerantName(token, raiz, CATEGORIA)
    const catId = catFolder?.id ?? (await driveFindOrCreateFolder(token, CATEGORIA, raiz))
    const originador = (body.originador || 'Sem originador').trim()
    const cedente = (body.cedente || 'Sem cedente').trim()
    const origId = await driveFindOrCreateFolder(token, originador, catId)
    const cedId = await driveFindOrCreateFolder(token, cedente, origId)

    const saidaBytes = new Uint8Array(await wb.xlsx.writeBuffer())
    // AS VERBAS NO NOME DO ARQUIVO, como na análise de RPV.
    //
    // Duas análises do mesmo precatório com cenários diferentes ficavam
    // indistinguíveis na pasta — e, pior, a segunda SOBRESCREVIA a primeira,
    // porque o upload substitui por nome. Com as verbas no nome, cenário
    // diferente é arquivo diferente, e refazer o MESMO cenário continua
    // substituindo, que é o que se quer.
    //
    // Fica logo depois de "Análise Jurídica", e não no fim: nome de arquivo é
    // truncado pela direita em toda lista.
    const nomeArquivo =
      limparNomeArquivo(
        `Análise Jurídica${_verbasNome ? ` [${_verbasNome}]` : ''} - ${cedente}` +
        `${body.numero_processo ? ` - ${body.numero_processo}` : ''}`,
      ) + '.xlsx'
    const up = await driveUploadBytes(token, nomeArquivo, cedId, saidaBytes, XLSX_MIME, true)

    return jsonResponse({
      ok: true,
      resumo: saida.resumo ?? null,
      linhas_no_questionario: linhas.length,
      linhas_preenchidas: escritas,
      avisos,
      ficha,
      template: templatePath,
      drive_file_url: up.webViewLink ?? null,
      drive_folder_url: `https://drive.google.com/drive/folders/${cedId}`,
    })
  } catch (e) {
    return jsonResponse(
      { error: 'Falha na análise jurídica: ' + (e instanceof Error ? e.message : String(e)) },
      500,
    )
  }
})
