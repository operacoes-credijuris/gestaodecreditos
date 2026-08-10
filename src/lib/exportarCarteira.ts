// Exporta a carteira de um investidor em .xlsx, com o mesmo conteúdo da tela.
//
// PARA QUE SERVE: o arquivo é entregue a um agente de IA no fim do mês, que
// redige a atualização mensal do crédito de cada investidor. Por isso os valores
// vão como NÚMERO e DATA de verdade nas células, com formato aplicado, e não
// como texto já formatado — texto ("R$ 1.234,56") obriga quem lê a desfazer a
// formatação e é onde nasce erro de leitura de valor.
//
// O ExcelJS entra por import dinâmico: são ~900 kB que só fazem sentido quando
// alguém clica em baixar, e o pacote inteiro no bundle inicial atrasaria a
// abertura de todas as outras telas.
import type { Processo } from './types'
import type { CarteiraResumo } from './queries'
import { MESES_ALERTA_LIQUIDACAO, statusLiquidacao } from './labels'
import { formatCNJ, hojeISO, mesesDepois, onlyDigits } from './format'

const MOEDA = 'R$ #,##0.00'
const DATA = 'dd/mm/yyyy'

/**
 * Arredonda para centavos. Somar float acumula resíduo (464266.27999999997 em
 * vez de 464266.28) e, apesar de o formato da célula exibir certo, quem lê o
 * valor BRUTO — o agente que recebe a planilha — vê o resíduo.
 */
function centavos(v: number | null): number | null {
  return v === null ? null : Math.round(v * 100) / 100
}

/** "2026-08-10" -> Date local. Sem isto o Excel recebe um dia a menos (UTC). */
function paraData(iso: string | null | undefined): Date | null {
  const s = (iso ?? '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const [a, m, d] = s.split('-').map(Number)
  return new Date(a, m - 1, d)
}

/** Tipos do crédito em texto, na mesma leitura da tela. */
function tiposTexto(tipos: string[] | null | undefined): string {
  const rotulos: Record<string, string> = {
    principal: 'crédito principal',
    honorarios_contratuais: 'honorários contratuais',
    honorarios_advocaticios: 'honorários sucumbenciais',
  }
  const t = (tipos ?? []).map((x) => rotulos[x] ?? x)
  if (t.length === 0) return ''
  if (t.length === 1) return t[0]
  return `${t.slice(0, -1).join(', ')} e ${t[t.length - 1]}`
}

// Colunas da aba Carteira, na MESMA ordem da tabela da tela. As sete últimas
// (grupo "Calculado automaticamente") saem vazias porque ainda não são
// calculadas em lugar nenhum; ficam no arquivo para o layout não mudar quando
// passarem a existir.
const COLUNAS: { titulo: string; largura: number; fmt?: string }[] = [
  { titulo: 'Nº processo', largura: 24 },
  { titulo: 'Cedente', largura: 30 },
  { titulo: 'Advogado', largura: 26 },
  { titulo: 'Tipo de crédito', largura: 34 },
  { titulo: 'Tribunal', largura: 14 },
  { titulo: 'Capital investido', largura: 16, fmt: MOEDA },
  { titulo: 'Data da cessão', largura: 14, fmt: DATA },
  { titulo: 'Valor de face', largura: 16, fmt: MOEDA },
  { titulo: 'Data ref. do face', largura: 14, fmt: DATA },
  { titulo: 'Índice de atualização', largura: 18 },
  { titulo: 'Data est. recebimento', largura: 16, fmt: DATA },
  { titulo: 'Já recebido', largura: 16, fmt: MOEDA },
  { titulo: 'Data receb. efetivo', largura: 16, fmt: DATA },
  { titulo: 'Valor est. complementar', largura: 18, fmt: MOEDA },
  { titulo: 'Status', largura: 10 },
  { titulo: 'Estágio processual', largura: 70 },
  { titulo: 'Providências / prox. passos', largura: 70 },
  { titulo: 'Últ. atualização', largura: 14, fmt: DATA },
  { titulo: 'Valor projetado', largura: 16, fmt: MOEDA },
  { titulo: 'Status TIR', largura: 12 },
  { titulo: 'TIR a.a.', largura: 10 },
  { titulo: 'TIR mensal', largura: 10 },
  { titulo: 'Dias em carteira', largura: 14 },
  { titulo: 'Ganho projetado', largura: 16, fmt: MOEDA },
  { titulo: 'Retorno', largura: 10 },
]

const INDICES: Record<string, string> = {
  selic: 'SELIC',
  ipca_2: 'IPCA + 2% a.a.',
}

export interface DadosExportacao {
  investidor: string
  mesRef: string
  carteira: Processo[]
  resumos: Map<string, CarteiraResumo> | undefined
  ultimaMov: Map<string, string> | undefined
  /** Totais dos cards que já têm valor; null = ainda não cadastrado. */
  capitalTotal: number | null
  jaRecebidoTotal: number | null
}

export async function exportarCarteiraXlsx(d: DadosExportacao): Promise<void> {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Credijuris — Gestão de Cessões'

  const hoje = hojeISO()
  const limite = mesesDepois(hoje, MESES_ALERTA_LIQUIDACAO)

  // ---------- Aba 1: Resumo ----------
  // Duas abas em vez de uma: metadados acima de uma tabela quebram a leitura
  // tabular de quem consome o arquivo. Aqui, cada linha é um par rótulo/valor.
  const resumo = wb.addWorksheet('Resumo')
  resumo.columns = [
    { header: 'Indicador', key: 'k', width: 26 },
    { header: 'Valor', key: 'v', width: 34 },
    { header: 'Observação', key: 'o', width: 52 },
  ]
  resumo.getRow(1).font = { bold: true }

  const AGUARDANDO = 'aguardando dados financeiros no cadastro de Créditos'
  const linhasResumo: [string, string | number | null, string][] = [
    ['Investidor', d.investidor, ''],
    ['Mês de referência', d.mesRef, ''],
    ['Nº de operações', d.carteira.length, 'créditos deste investidor'],
    ['Capital total', centavos(d.capitalTotal), d.capitalTotal === null ? AGUARDANDO : ''],
    ['TIR média', null, AGUARDANDO],
    ['Retorno projetado', null, AGUARDANDO],
    [
      'Já recebido',
      centavos(d.jaRecebidoTotal),
      d.jaRecebidoTotal === null ? AGUARDANDO : '',
    ],
    ['A receber estimado', null, AGUARDANDO],
  ]
  for (const [k, v, o] of linhasResumo) {
    const linha = resumo.addRow({ k, v, o })
    if (typeof v === 'number' && (k === 'Capital total' || k === 'Já recebido')) {
      linha.getCell('v').numFmt = MOEDA
    }
  }

  // ---------- Aba 2: Carteira ----------
  const aba = wb.addWorksheet('Carteira')
  aba.columns = COLUNAS.map((c) => ({ header: c.titulo, width: c.largura }))
  const cab = aba.getRow(1)
  cab.font = { bold: true }
  cab.alignment = { vertical: 'middle', wrapText: true }
  aba.views = [{ state: 'frozen', ySplit: 1 }]

  for (const p of d.carteira) {
    const sl = statusLiquidacao(p.data_liquidacao, p.expectativa_liquidacao, hoje, limite)
    const r = d.resumos?.get(p.id)
    const linha = aba.addRow([
      formatCNJ(p.numero_cnj),
      p.cedente ?? '',
      p.cedente_advogado ?? '',
      tiposTexto(p.tipo_credito),
      p.tribunal ?? '',
      p.capital_investido ?? null,
      paraData(p.data_aquisicao),
      p.valor_face ?? null,
      paraData(p.data_referencia),
      p.indice_atualizacao ? (INDICES[p.indice_atualizacao] ?? p.indice_atualizacao) : '',
      paraData(p.expectativa_liquidacao),
      p.ja_recebido ?? null,
      paraData(p.data_liquidacao),
      p.valor_estimado_complementar ?? null,
      sl.label === '—' ? '' : sl.label,
      r?.estagio_processual ?? '',
      r?.providencias ?? '',
      paraData(d.ultimaMov?.get(onlyDigits(p.numero_cnj)) ?? null),
      null, // Valor projetado
      '', // Status TIR
      null, // TIR a.a.
      null, // TIR mensal
      null, // Dias em carteira
      null, // Ganho projetado
      null, // Retorno
    ])
    COLUNAS.forEach((c, i) => {
      if (c.fmt) linha.getCell(i + 1).numFmt = c.fmt
    })
    // Os dois textos longos quebram na célula; o resto fica no topo para a
    // linha continuar legível quando eles ocuparem várias linhas.
    linha.alignment = { vertical: 'top', wrapText: true }
  }

  // ---------- Download ----------
  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  // Nome sem acento nem barra: o arquivo circula entre sistemas.
  const slug = d.investidor
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
  a.href = url
  a.download = `carteira-${slug || 'investidor'}-${hoje}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}
