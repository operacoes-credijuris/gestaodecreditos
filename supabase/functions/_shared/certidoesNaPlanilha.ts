// _shared/certidoesNaPlanilha.ts
// O BLOCO "HISTÓRICO DO CEDENTE" DA PLANILHA, escrito direto do checklist.
//
// As linhas 28 a 81 da aba Análise Jurídica são as certidões — do cedente, do
// cônjuge e da pessoa jurídica — e o estado de residência que as puxa. É
// exatamente o que a aba Certidões da due diligence apura, e desde a BullAI com
// o RESULTADO de cada uma. Até aqui quem escrevia essas células era a IA, lendo
// um resumo do checklist; agora a plataforma as escreve ela mesma, do banco, no
// momento de gravar a planilha. Não há o que interpretar: é copiar o que está
// registrado, e copiar é trabalho de código.
//
// A PLATAFORMA PREVALECE. O preenchimento corre ANTES das respostas da conversa,
// e `aplicarRespostas` não escreve em célula ocupada — então, numa linha que o
// checklist responde, a resposta da IA é ignorada. Linha que o checklist não
// sabe responder (curatela, prioridade legal, o casamento quando não há cônjuge
// cadastrado) fica para a conversa, como antes.
//
// CADA LINHA CONFERE A PERGUNTA. O mapa é por número de linha, que é como a
// planilha foi transcrita (ver `origem_planilha` no catálogo, migração 0042) —
// e se alguém inserir uma linha no modelo, o número passa a apontar outra
// pergunta. Por isso cada linha traz o padrão do texto que espera encontrar ali:
// não bateu, não escreve, e avisa.
//
// MÓDULO PURO — sem `Deno.` e sem `npm:`.

import type { AbaDaPlanilha, LinhaQuestionario } from './questionarioJuridico.ts'
import { enxuto, textoDaCelula } from './questionarioJuridico.ts'

export interface SujeitoDaPlanilha {
  id: string
  papel: string
  tipo_pessoa: string
  nome: string
  documento: string
  data_nascimento?: string | null
  uf_atual: string | null
  municipio_atual: string | null
  ufs_anteriores: string[]
  municipios_anteriores: string[]
  residencia_levantada: boolean
}

export interface ItemDaPlanilha {
  sujeito_id: string
  certidao_codigo: string
  status: string
  parametros: Record<string, unknown> | null
  emitida_em?: string | null
  validade_ate?: string | null
  dispensa_motivo?: string | null
  resultado?: string | null
  drive_link?: string | null
  arquivos?: { drive_link?: string | null }[] | null
}

export interface Preenchimento {
  linha: number
  /** O texto que a pergunta daquela linha tem de conter. */
  padrao: RegExp
  resposta: string
  complemento: string | null
}

// ------------------------------------------------------------------ formato

const dataBR = (iso: string | null | undefined) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''))
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ''
}

const semAcento = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

const linkDo = (i: ItemDaPlanilha) =>
  i.drive_link || (i.arquivos ?? []).find((a) => a?.drive_link)?.drive_link || null

/**
 * Uma certidão em palavras de planilha: curto na resposta, e o que falta fazer
 * no complemento.
 *
 * O RESULTADO SÓ APARECE QUANDO FOI REGISTRADO. Certidão obtida antes da BullAI
 * (PDF subido à mão) não tem resultado no banco, e a célula diz isso em vez de
 * supor "negativa" — o mesmo cuidado que a regra da conversa sempre teve.
 */
export function descreverItem(i: ItemDaPlanilha, hoje: string): { resposta: string; complemento: string | null } {
  const emitida = dataBR(i.emitida_em)
  const link = linkDo(i)
  const noPdf = link ? `PDF: ${link}` : 'PDF na pasta da análise'
  switch (i.status) {
    case 'NAO_APLICAVEL':
      return { resposta: `Dispensada: ${i.dispensa_motivo ?? 'sem motivo registrado'}`, complemento: null }
    case 'EM_EMISSAO':
      return { resposta: 'Em emissão', complemento: null }
    case 'FALHA':
      return { resposta: 'Pendente — a emissão falhou', complemento: null }
    case 'PENDENTE_MANUAL':
      return { resposta: 'Pendente de emissão (manual)', complemento: null }
    case 'OBTIDA':
      break
    default:
      return { resposta: 'Pendente de emissão', complemento: null }
  }
  if (i.validade_ate && i.validade_ate.slice(0, 10) < hoje) {
    return { resposta: `Vencida em ${dataBR(i.validade_ate)} — emitir de novo`, complemento: null }
  }
  const quando = emitida ? ` (emitida em ${emitida})` : ''
  // A LINHA 69 PERGUNTA A SITUAÇÃO DA EMPRESA ("ativa", "inapta"), não se a
  // certidão é negativa — e a situação não é registrada no banco.
  if (i.certidao_codigo === 'PJ.CNPJ_SITUACAO') {
    return {
      resposta: `Comprovante obtido${quando} — conferir a situação cadastral no PDF`,
      complemento: `Se não ativa, registrar a razão — ${noPdf}`,
    }
  }
  switch (i.resultado) {
    case 'negativa':
      return { resposta: `Negativa${quando}`, complemento: null }
    case 'nada_consta':
      return { resposta: `Nada consta${quando}`, complemento: null }
    case 'positiva':
      return {
        resposta: `POSITIVA${quando}`,
        complemento: `A pesquisar: nº do processo, objeto, valor e estágio — ${noPdf}`,
      }
    case 'indeterminada':
      return { resposta: `Indeterminada${quando}`, complemento: `Conferir o resultado — ${noPdf}` }
    case 'emitida':
      return {
        resposta: `Emitida${quando} — resultado não declarado`,
        complemento: `Conferir o resultado — ${noPdf}`,
      }
    default:
      return {
        resposta: `Obtida${quando} — resultado não registrado na plataforma`,
        complemento: `Conferir o resultado — ${noPdf}`,
      }
  }
}

/** Várias certidões numa linha ("descrever todas"): uma por escopo, juntas. */
function juntar(itens: ItemDaPlanilha[], hoje: string, rotulo: (i: ItemDaPlanilha) => string) {
  if (itens.length === 1) return descreverItem(itens[0], hoje)
  const partes = itens.map((i) => ({ r: rotulo(i), d: descreverItem(i, hoje) }))
  const complementos = partes.filter((p) => p.d.complemento).map((p) => `${p.r}: ${p.d.complemento}`)
  return {
    resposta: partes.map((p) => `${p.r}: ${p.d.resposta}`).join(' · '),
    complemento: complementos.length ? complementos.join(' · ') : null,
  }
}

const escopoDe = (i: ItemDaPlanilha) => {
  const p = i.parametros ?? {}
  return String(p.municipio ?? p.uf ?? Object.values(p)[0] ?? '').trim()
}

// ------------------------------------------------------------------ o mapa

type Onde = 'atual' | 'anteriores' | null

interface LinhaDeCertidao {
  linha: number
  padrao: RegExp
  codigos: string[]
  onde: Onde
}

/** As certidões nacionais e as da residência — as mesmas para os três blocos. */
const CEDENTE: LinhaDeCertidao[] = [
  { linha: 28, padrao: /CND Federal/i, codigos: ['FED.CND_RFB_PGFN'], onde: null },
  { linha: 29, padrao: /CNDT/i, codigos: ['TRAB.CNDT'], onde: null },
  { linha: 30, padrao: /Unificada da Justi.a Federal/i, codigos: ['FED.CJF_UNIFICADA'], onde: null },
  { linha: 31, padrao: /TRF-?1\b/i, codigos: ['FED.TRF1'], onde: null },
  { linha: 32, padrao: /TRF-?2\b/i, codigos: ['FED.TRF2'], onde: null },
  { linha: 33, padrao: /TRF-?3\b/i, codigos: ['FED.TRF3'], onde: null },
  { linha: 34, padrao: /TRF-?4\b/i, codigos: ['FED.TRF4'], onde: null },
  { linha: 35, padrao: /TRF-?5\b/i, codigos: ['FED.TRF5'], onde: null },
  { linha: 36, padrao: /TRF-?6\b/i, codigos: ['FED.TRF6'], onde: null },
  { linha: 37, padrao: /Protestos/i, codigos: ['EXTRA.PROTESTO_CENPROT', 'EXTRA.PROTESTO_CENPROT_SP'], onde: null },
  { linha: 44, padrao: /Tribut.rios do Estado\?/i, codigos: ['EST.CDT'], onde: 'atual' },
  { linha: 46, padrao: /Tribut.rios do Munic.pio\?/i, codigos: ['MUN.CND'], onde: 'atual' },
  { linha: 47, padrao: /Tribunal de Justi.a do Estado\?/i, codigos: ['EST.TJ_CIVEL_CRIMINAL'], onde: 'atual' },
  { linha: 49, padrao: /Estado\(s\)/i, codigos: ['EST.CDT'], onde: 'anteriores' },
  { linha: 50, padrao: /Munic.pio\(s\)/i, codigos: ['MUN.CND'], onde: 'anteriores' },
  { linha: 51, padrao: /Tribunal\(is\)/i, codigos: ['EST.TJ_CIVEL_CRIMINAL'], onde: 'anteriores' },
]

const CONJUGE: LinhaDeCertidao[] = [
  { linha: 54, padrao: /CND Federal/i, codigos: ['FED.CND_RFB_PGFN'], onde: null },
  { linha: 55, padrao: /CNDT/i, codigos: ['TRAB.CNDT'], onde: null },
  { linha: 56, padrao: /Unificada da Justi.a Federal/i, codigos: ['FED.CJF_UNIFICADA'], onde: null },
  { linha: 57, padrao: /Protestos/i, codigos: ['EXTRA.PROTESTO_CENPROT', 'EXTRA.PROTESTO_CENPROT_SP'], onde: null },
  { linha: 58, padrao: /FGTS/i, codigos: ['FGTS.CRF'], onde: null },
  { linha: 60, padrao: /Tribut.rios do Estado\?/i, codigos: ['EST.CDT'], onde: 'atual' },
  { linha: 62, padrao: /Tribut.rios do Munic.pio\?/i, codigos: ['MUN.CND'], onde: 'atual' },
  { linha: 63, padrao: /Tribunal de Justi.a do Estado\?/i, codigos: ['EST.TJ_CIVEL_CRIMINAL'], onde: 'atual' },
  { linha: 65, padrao: /Estado\(s\)/i, codigos: ['EST.CDT'], onde: 'anteriores' },
  { linha: 66, padrao: /Munic.pio\(s\)/i, codigos: ['MUN.CND'], onde: 'anteriores' },
  { linha: 67, padrao: /Tribunal\(is\)/i, codigos: ['EST.TJ_CIVEL_CRIMINAL'], onde: 'anteriores' },
]

const PJ: LinhaDeCertidao[] = [
  { linha: 69, padrao: /status da empresa/i, codigos: ['PJ.CNPJ_SITUACAO'], onde: null },
  { linha: 70, padrao: /FGTS/i, codigos: ['FGTS.CRF'], onde: null },
  { linha: 73, padrao: /Tribut.rios do Estado\?/i, codigos: ['EST.CDT'], onde: 'atual' },
  { linha: 75, padrao: /Tribut.rios do Munic.pio\?/i, codigos: ['MUN.CND'], onde: 'atual' },
  { linha: 76, padrao: /Tribunal de Justi.a do Estado\?/i, codigos: ['EST.TJ_CIVEL_CRIMINAL'], onde: 'atual' },
  { linha: 79, padrao: /Estado\(s\)/i, codigos: ['EST.CDT'], onde: 'anteriores' },
  { linha: 80, padrao: /Munic.pio\(s\)/i, codigos: ['MUN.CND'], onde: 'anteriores' },
  { linha: 81, padrao: /Tribunal\(is\)/i, codigos: ['EST.TJ_CIVEL_CRIMINAL'], onde: 'anteriores' },
]

/** As linhas de residência de cada bloco: UF atual, município atual, "já residiu". */
const RESIDENCIA = {
  CEDENTE: { uf: 43, municipio: 45, outros: 48 },
  CONJUGE: { uf: 59, municipio: 61, outros: 64 },
  PJ: { uf: 72, municipio: 74, outros: 78 },
} as const

const PADRAO_RESIDENCIA = {
  uf: /Estado d[ea] (residência|atual sede)/i,
  municipio: /Munic.pio d[ea] (residência|atual sede)/i,
  outros: /(residiu|sede) em outro Munic.pio\/Estado/i,
}

/** O item é da residência atual do sujeito? (UF para estaduais, cidade para municipais.) */
function daResidenciaAtual(i: ItemDaPlanilha, s: SujeitoDaPlanilha): boolean {
  const p = i.parametros ?? {}
  if (i.certidao_codigo === 'MUN.CND') {
    const cidade = semAcento(String(p.municipio ?? '')).split(/[/(-]/)[0].trim()
    return !!s.municipio_atual && cidade === semAcento(s.municipio_atual)
  }
  return !!s.uf_atual && String(p.uf ?? '').toUpperCase() === s.uf_atual.toUpperCase()
}

function idadeEm(nascimento: string, hoje: string): number {
  const [a, m, d] = nascimento.slice(0, 10).split('-').map(Number)
  const [ha, hm, hd] = hoje.split('-').map(Number)
  return ha - a - (hm < m || (hm === m && hd < d) ? 1 : 0)
}

function doBloco(
  s: SujeitoDaPlanilha,
  meus: ItemDaPlanilha[],
  mapa: LinhaDeCertidao[],
  residencia: { uf: number; municipio: number; outros: number },
  hoje: string,
): Preenchimento[] {
  const fora: Preenchimento[] = []
  const temAnteriores = s.ufs_anteriores.length > 0 || s.municipios_anteriores.length > 0

  // A RESIDÊNCIA, que é o que puxa as estaduais e as municipais.
  if (s.uf_atual) {
    fora.push({ linha: residencia.uf, padrao: PADRAO_RESIDENCIA.uf, resposta: s.uf_atual, complemento: null })
  }
  if (s.municipio_atual) {
    fora.push({
      linha: residencia.municipio,
      padrao: PADRAO_RESIDENCIA.municipio,
      resposta: s.municipio_atual,
      complemento: null,
    })
  }
  if (temAnteriores) {
    const partes = [
      s.ufs_anteriores.length ? `Estados: ${s.ufs_anteriores.join(', ')}` : '',
      s.municipios_anteriores.length ? `Municípios: ${s.municipios_anteriores.join(', ')}` : '',
    ].filter(Boolean)
    fora.push({ linha: residencia.outros, padrao: PADRAO_RESIDENCIA.outros, resposta: 'Sim', complemento: partes.join('; ') })
  } else if (s.residencia_levantada) {
    fora.push({ linha: residencia.outros, padrao: PADRAO_RESIDENCIA.outros, resposta: 'Não', complemento: null })
  } else {
    fora.push({
      linha: residencia.outros,
      padrao: PADRAO_RESIDENCIA.outros,
      resposta: 'Histórico de residência não levantado',
      complemento: null,
    })
  }

  for (const l of mapa) {
    let itens = meus.filter((i) => l.codigos.includes(i.certidao_codigo))
    if (l.onde === 'atual') itens = itens.filter((i) => daResidenciaAtual(i, s))
    if (l.onde === 'anteriores') itens = itens.filter((i) => !daResidenciaAtual(i, s))

    if (itens.length === 0) {
      // SEM ITEM, a resposta depende do motivo: residência anterior que não
      // existe não é pendência; certidão que devia estar e não está, é.
      const resposta =
        l.onde === 'anteriores'
          ? temAnteriores
            ? 'Não consta no checklist'
            : s.residencia_levantada
              ? 'Não se aplica — sem residência anterior'
              : 'Histórico de residência não levantado'
          : 'Não consta no checklist'
      fora.push({ linha: l.linha, padrao: l.padrao, resposta, complemento: null })
      continue
    }
    const d = juntar(itens, hoje, (i) =>
      l.codigos.length > 1 && !Object.keys(i.parametros ?? {}).length
        ? i.certidao_codigo === 'EXTRA.PROTESTO_CENPROT_SP'
          ? 'CENPROT-SP'
          : 'CENPROT'
        : escopoDe(i) || i.certidao_codigo,
    )
    fora.push({ linha: l.linha, padrao: l.padrao, ...d })
  }
  return fora
}

/**
 * O que o checklist responde do bloco "Histórico do Cedente", linha a linha.
 *
 * `hoje` em AAAA-MM-DD: é contra ele que se vê se a certidão venceu.
 */
export function certidoesParaPlanilha(
  sujeitos: SujeitoDaPlanilha[],
  itens: ItemDaPlanilha[],
  hoje: string,
): Preenchimento[] {
  const fora: Preenchimento[] = []
  const de = (s: SujeitoDaPlanilha) => itens.filter((i) => i.sujeito_id === s.id)

  const cedente = sujeitos.find((s) => s.papel === 'CEDENTE')
  const conjuge = sujeitos.find((s) => s.papel === 'CONJUGE')
  // A PJ é a do bloco próprio; cedente pessoa jurídica também responde por ele.
  const pj = sujeitos.find((s) => s.papel === 'PJ') ?? (cedente?.tipo_pessoa === 'PJ' ? cedente : undefined)

  if (cedente?.tipo_pessoa === 'PJ') {
    // Cedente pessoa jurídica: as nacionais aqui, e a sede no bloco da PJ — as
    // linhas de residência são de pessoa física.
    for (const l of CEDENTE.filter((x) => x.onde === null)) {
      const doItem = de(cedente).filter((i) => l.codigos.includes(i.certidao_codigo))
      fora.push({
        linha: l.linha,
        padrao: l.padrao,
        ...(doItem.length
          ? juntar(doItem, hoje, (i) => escopoDe(i) || i.certidao_codigo)
          : { resposta: 'Não consta no checklist', complemento: null }),
      })
    }
  } else if (cedente) {
    fora.push(...doBloco(cedente, de(cedente), CEDENTE, RESIDENCIA.CEDENTE, hoje))
    if (cedente.data_nascimento) {
      const anos = idadeEm(cedente.data_nascimento, hoje)
      fora.push({
        linha: 40,
        padrao: /Maior de Idade/i,
        resposta: `${anos >= 18 ? 'Sim' : 'Não'} (${anos} anos — nascimento em ${dataBR(cedente.data_nascimento)})`,
        complemento: null,
      })
    }
  }

  // O CÔNJUGE SÓ QUANDO CADASTRADO. Sem ele, a linha 53 ("é casado?") fica para
  // a conversa: "não há cônjuge no checklist" não quer dizer "não é casado".
  if (conjuge) {
    fora.push({
      linha: 53,
      padrao: /casado/i,
      resposta: 'Sim',
      complemento: `${conjuge.nome} — CPF ${conjuge.documento}`,
    })
    fora.push(...doBloco(conjuge, de(conjuge), CONJUGE, RESIDENCIA.CONJUGE, hoje))
  }

  if (pj) fora.push(...doBloco(pj, de(pj), PJ, RESIDENCIA.PJ, hoje))
  return fora
}

/**
 * Escreve os preenchimentos na aba, conferindo a pergunta de cada linha.
 *
 * Só escreve em linha que está no questionário (célula vazia, não é título) e
 * cuja pergunta bate com o padrão esperado. Devolve o que escreveu e as linhas
 * em que a pergunta não era a esperada — sinal de que o modelo mudou.
 */
export function escreverCertidoes(
  ws: AbaDaPlanilha,
  linhas: LinhaQuestionario[],
  preenchimentos: Preenchimento[],
): { escritas: number; desalinhadas: number[] } {
  const porLinha = new Map(linhas.map((l) => [l.linha, l]))
  const desalinhadas: number[] = []
  let escritas = 0
  for (const p of preenchimentos) {
    const def = porLinha.get(p.linha)
    const pergunta = enxuto(textoDaCelula(ws.getRow(p.linha).getCell('A')))
    if (!def || def.bloco !== 'Histórico do Cedente' || !p.padrao.test(pergunta)) {
      desalinhadas.push(p.linha)
      continue
    }
    const row = ws.getRow(p.linha)
    if (row.getCell(def.col).value != null) continue
    row.getCell(def.col).value = p.resposta
    escritas++
    if (p.complemento && def.col === 'B' && row.getCell('D').value == null) {
      row.getCell('D').value = p.complemento
    }
  }
  return { escritas, desalinhadas }
}
