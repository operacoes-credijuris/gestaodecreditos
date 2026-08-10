// Exporta a carteira de um investidor em .xlsx, no mesmo desenho da tela.
//
// PARA QUE SERVE: o arquivo é entregue a um agente de IA no fim do mês, que
// redige a atualização mensal do crédito de cada investidor.
//
// UMA ÚNICA ABA, com o resumo em cima e a carteira embaixo: é o que o agente lê
// melhor, e é o que a tela mostra. Os valores vão como NÚMERO e DATA de verdade
// nas células, com formato aplicado, e não como texto já formatado — texto
// ("R$ 1.234,56") obriga quem lê a desfazer a formatação e é onde nasce erro de
// leitura de valor.
//
// O ExcelJS entra por import dinâmico: são ~900 kB que só fazem sentido quando
// alguém clica em baixar, e o pacote inteiro no bundle inicial atrasaria a
// abertura de todas as outras telas.
import type { Processo } from './types'
import type { CarteiraResumo } from './queries'
import {
  diasEmCarteira,
  MESES_ALERTA_LIQUIDACAO,
  statusLiquidacao,
  statusTir,
} from './labels'
import { formatCNJ, hojeISO, mesesDepois, onlyDigits } from './format'

const MOEDA = 'R$ #,##0.00'
const DATA = 'dd/mm/yyyy'

// Paleta espelhando a tela (tons do Tailwind já usados na interface).
const C = {
  tinta: 'FF1E293B', // slate-800
  rotulo: 'FF64748B', // slate-500
  apagado: 'FF94A3B8', // slate-400
  linha: 'FFE2E8F0', // slate-200
  zebra: 'FFF8FAFC', // slate-50
  cabFundo: 'FFF1F5F9', // slate-100
  marca: 'FF1D4ED8', // brand/blue-700
}

/** Fundo e tinta de cada grupo de colunas, nas cores dos grupos da tela. */
const GRUPOS: { titulo: string; colunas: number; fundo: string; tinta: string }[] = [
  { titulo: 'Identificação', colunas: 5, fundo: 'FFF0F9FF', tinta: 'FF0369A1' },
  { titulo: 'TIR obrigatório', colunas: 2, fundo: 'FFFFFBEB', tinta: 'FFB45309' },
  { titulo: 'Crédito', colunas: 3, fundo: 'FFECFDF5', tinta: 'FF047857' },
  { titulo: 'Recebimento principal', colunas: 3, fundo: 'FFFEF2F2', tinta: 'FFB91C1C' },
  { titulo: 'Complementar', colunas: 1, fundo: 'FFFFF7ED', tinta: 'FFC2410C' },
  { titulo: 'Dados vivos', colunas: 4, fundo: 'FFEFF6FF', tinta: 'FF1E40AF' },
  { titulo: 'Calculado automaticamente', colunas: 7, fundo: 'FFF5F3FF', tinta: 'FF6D28D9' },
]

// Cor do texto da coluna Status, igual à da tela.
const COR_STATUS: Record<string, string> = {
  green: 'FF059669',
  blue: 'FF2563EB',
  yellow: 'FFD97706',
  red: 'FFDC2626',
  gray: 'FF94A3B8',
}

const COLUNAS: { titulo: string; largura: number; fmt?: string }[] = [
  { titulo: 'Nº processo', largura: 23 },
  { titulo: 'Cedente', largura: 28 },
  { titulo: 'Advogado', largura: 24 },
  { titulo: 'Tipo de crédito', largura: 32 },
  { titulo: 'Tribunal', largura: 12 },
  { titulo: 'Capital investido', largura: 15, fmt: MOEDA },
  { titulo: 'Data da cessão', largura: 13, fmt: DATA },
  { titulo: 'Valor de face', largura: 15, fmt: MOEDA },
  { titulo: 'Data ref. do face', largura: 13, fmt: DATA },
  { titulo: 'Índice de atualização', largura: 16 },
  { titulo: 'Data est. recebimento', largura: 15, fmt: DATA },
  { titulo: 'Já recebido', largura: 15, fmt: MOEDA },
  { titulo: 'Data receb. efetivo', largura: 15, fmt: DATA },
  { titulo: 'Valor est. complementar', largura: 17, fmt: MOEDA },
  { titulo: 'Status', largura: 11 },
  { titulo: 'Estágio processual', largura: 62 },
  { titulo: 'Providências / prox. passos', largura: 62 },
  { titulo: 'Últ. atualização', largura: 14, fmt: DATA },
  { titulo: 'Valor projetado', largura: 15, fmt: MOEDA },
  { titulo: 'Status TIR', largura: 12 },
  { titulo: 'TIR a.a.', largura: 10 },
  { titulo: 'TIR mensal', largura: 10 },
  { titulo: 'Dias em carteira', largura: 13 },
  { titulo: 'Ganho projetado', largura: 15, fmt: MOEDA },
  { titulo: 'Retorno', largura: 10 },
]

const INDICES: Record<string, string> = {
  selic: 'SELIC',
  ipca_2: 'IPCA + 2% a.a.',
}

/** "2026-08-10" -> Date local. Sem isto o Excel recebe um dia a menos (UTC). */
function paraData(iso: string | null | undefined): Date | null {
  const s = (iso ?? '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const [a, m, d] = s.split('-').map(Number)
  return new Date(a, m - 1, d)
}

/**
 * Arredonda para centavos. Somar float acumula resíduo (464266.27999999997 em
 * vez de 464266.28) e, apesar de o formato da célula exibir certo, quem lê o
 * valor BRUTO — o agente que recebe a planilha — vê o resíduo.
 */
function centavos(v: number | null): number | null {
  return v === null ? null : Math.round(v * 100) / 100
}

/** Tipos do crédito em texto, na mesma leitura da tela. */
function tiposTexto(tipos: string[] | null | undefined): string {
  const rotulos: Record<string, string> = {
    principal: 'crédito principal',
    honorarios_contratuais: 'honorários contratuais',
    honorarios_advocaticios: 'honorários sucumbenciais',
  }
  const t = (tipos ?? []).map((x) => rotulos[x] ?? x)
  if (t.length === 0) return '—'
  if (t.length === 1) return t[0]
  return `${t.slice(0, -1).join(', ')} e ${t[t.length - 1]}`
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
  const ws = wb.addWorksheet('Carteira')

  const hoje = hojeISO()
  const limite = mesesDepois(hoje, MESES_ALERTA_LIQUIDACAO)

  COLUNAS.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.largura
  })

  const borda = { style: 'thin' as const, color: { argb: C.linha } }
  const contorno = { top: borda, left: borda, bottom: borda, right: borda }

  // ---------- Título ----------
  ws.mergeCells(1, 1, 1, 5)
  const titulo = ws.getCell(1, 1)
  titulo.value = 'Carteira de investimentos'
  titulo.font = { bold: true, size: 14, color: { argb: C.marca } }
  ws.getRow(1).height = 22

  // ---------- Investidor e competência ----------
  const par = (linha: number, rotulo: string, valor: string) => {
    const r = ws.getCell(linha, 1)
    r.value = rotulo
    r.font = { bold: true, size: 10, color: { argb: C.rotulo } }
    ws.mergeCells(linha, 2, linha, 4)
    const v = ws.getCell(linha, 2)
    v.value = valor
    v.font = { size: 11, color: { argb: C.tinta } }
  }
  par(3, 'Investidor', d.investidor)
  par(4, 'Mês de referência', d.mesRef)

  // ---------- Indicadores (os seis cards da tela) ----------
  // Em coluna, e não lado a lado: as larguras desta planilha são as da TABELA,
  // e seis pares espalhados por elas ficariam esparsos e difíceis de ler.
  const tituloSecao = (linha: number, texto: string) => {
    const c = ws.getCell(linha, 1)
    c.value = texto
    c.font = { bold: true, size: 10, color: { argb: C.rotulo } }
    ws.getRow(linha).height = 18
  }
  tituloSecao(6, 'INDICADORES')

  // "—" e não célula vazia nos que ainda não são calculados: vazio seria lido
  // como zero por quem consome a planilha, e a tela também mostra "—".
  const SEM = '—'
  // Mesma ordem dos cards na tela.
  const indicadores: [string, number | string | null, string | undefined][] = [
    ['Capital total', centavos(d.capitalTotal) ?? SEM, MOEDA],
    ['TIR média', SEM, undefined],
    ['Retorno projetado', SEM, undefined],
    ['Já recebido', centavos(d.jaRecebidoTotal) ?? SEM, MOEDA],
    ['A receber estimado', SEM, undefined],
    ['Nº de operações', d.carteira.length, undefined],
  ]
  indicadores.forEach(([rotulo, valor, fmt], i) => {
    const linha = 7 + i
    const r = ws.getCell(linha, 1)
    r.value = rotulo
    r.font = { size: 10, color: { argb: C.rotulo } }
    r.border = contorno
    r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.zebra } }
    const v = ws.getCell(linha, 2)
    v.value = valor
    v.font = { bold: true, size: 11, color: { argb: typeof valor === 'number' ? C.tinta : C.apagado } }
    v.border = contorno
    v.alignment = { horizontal: 'right' }
    if (fmt && typeof valor === 'number') v.numFmt = fmt
  })

  // ---------- Cabeçalho de dois níveis, como na tela ----------
  const LINHA_GRUPO = 14
  const LINHA_COLUNA = 15
  const PRIMEIRA_DADO = 16
  tituloSecao(13, 'CARTEIRA')

  let col = 1
  for (const g of GRUPOS) {
    // Grupo de uma coluna só (Complementar) não pede merge.
    if (g.colunas > 1) {
      ws.mergeCells(LINHA_GRUPO, col, LINHA_GRUPO, col + g.colunas - 1)
    }
    const c = ws.getCell(LINHA_GRUPO, col)
    c.value = g.titulo
    c.font = { bold: true, size: 10, color: { argb: g.tinta } }
    c.alignment = { horizontal: 'center', vertical: 'middle' }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: g.fundo } }
    // A borda tem de ir em TODA célula do intervalo mesclado: o Excel desenha
    // borda por célula, então só a primeira ficaria contornada.
    for (let i = 0; i < g.colunas; i++) {
      ws.getCell(LINHA_GRUPO, col + i).border = contorno
    }
    col += g.colunas
  }
  ws.getRow(LINHA_GRUPO).height = 18

  const cab = ws.getRow(LINHA_COLUNA)
  COLUNAS.forEach((c, i) => {
    const cel = cab.getCell(i + 1)
    cel.value = c.titulo
    cel.font = { bold: true, size: 9, color: { argb: C.tinta } }
    cel.alignment = { vertical: 'middle', wrapText: true }
    cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.cabFundo } }
    cel.border = contorno
  })
  cab.height = 28

  // ---------- Linhas da carteira ----------
  d.carteira.forEach((p, idx) => {
    const sl = statusLiquidacao(p.data_liquidacao, p.expectativa_liquidacao, hoje, limite)
    const r = d.resumos?.get(p.id)
    const linha = ws.getRow(PRIMEIRA_DADO + idx)
    const valores: (string | number | Date | null)[] = [
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
      sl.label,
      r?.estagio_processual ?? '',
      r?.providencias ?? '',
      paraData(d.ultimaMov?.get(onlyDigits(p.numero_cnj)) ?? null),
      null, // Valor projetado
      statusTir(p.data_liquidacao),
      null, // TIR a.a.
      null, // TIR mensal
      diasEmCarteira(p.data_aquisicao, p.data_liquidacao, hoje),
      null, // Ganho projetado
      null, // Retorno
    ]
    const zebrar = idx % 2 === 1
    valores.forEach((v, i) => {
      const cel = linha.getCell(i + 1)
      cel.value = v
      cel.border = contorno
      cel.font = { size: 10, color: { argb: C.tinta } }
      cel.alignment = { vertical: 'top', wrapText: i === 15 || i === 16 }
      if (zebrar) {
        cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.zebra } }
      }
      const fmt = COLUNAS[i].fmt
      if (fmt) cel.numFmt = fmt
    })
    // Nº do processo em negrito e Status na cor do semáforo, como na tela.
    linha.getCell(1).font = { size: 10, bold: true, color: { argb: C.tinta } }
    linha.getCell(15).font = {
      size: 10,
      bold: true,
      color: { argb: COR_STATUS[sl.tone] ?? C.apagado },
    }
    // Status TIR segue a mesma convenção: pago em verde, projeção em cinza.
    linha.getCell(20).font = {
      size: 10,
      color: { argb: p.data_liquidacao ? COR_STATUS.green : C.rotulo },
    }
  })

  // Cabeçalho sempre visível e filtro na tabela: com 25 colunas e dezenas de
  // linhas, rolar sem isso faz perder de vista qual coluna se está lendo. Só a
  // LINHA congela — a primeira coluna fica livre, por decisão de produto.
  ws.views = [{ state: 'frozen', ySplit: LINHA_COLUNA }]
  if (d.carteira.length > 0) {
    ws.autoFilter = {
      from: { row: LINHA_COLUNA, column: 1 },
      to: { row: PRIMEIRA_DADO + d.carteira.length - 1, column: COLUNAS.length },
    }
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
  // Dois cuidados, e os dois já falharam na prática (downloads que simplesmente
  // não aconteciam, de forma intermitente):
  //   1. o <a> precisa estar NO documento — clique em elemento solto é ignorado
  //      por parte dos navegadores;
  //   2. revogar a URL logo depois do clique CANCELA o download, porque o
  //      clique só agenda a transferência. A revogação vai para depois.
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  window.setTimeout(() => {
    a.remove()
    URL.revokeObjectURL(url)
  }, 60_000)
}
