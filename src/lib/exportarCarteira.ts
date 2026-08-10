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
  textosResumo,
} from './labels'
import { formatCNJ, hojeISO, mesesDepois, onlyDigits } from './format'
import {
  aReceberEstimado,
  ganhoProjetado,
  ipcaMais2,
  retorno,
  retornoProjetadoCarteira,
  tir,
  tirMediaPonderada,
  valorProjetado,
  type ParametrosAtualizacao,
} from './projecao'

const MOEDA = 'R$ #,##0.00'
const DATA = 'dd/mm/yyyy'
// 0.00"%" e não 0.00%: os valores já vêm em pontos percentuais (15.23 = 15,23%),
// e o formato % do Excel multiplicaria por 100.
const PCT = '0.00"%"'

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
  { titulo: 'TIR a.a.', largura: 11, fmt: PCT },
  { titulo: 'TIR mensal', largura: 11, fmt: PCT },
  { titulo: 'Dias em carteira', largura: 13 },
  { titulo: 'Ganho projetado', largura: 15, fmt: MOEDA },
  { titulo: 'Retorno', largura: 11, fmt: PCT },
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
  /** SELIC/IPCA da projeção do valor. */
  parametros: ParametrosAtualizacao | undefined
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

  // TIR média e A receber estimado saem calculados AQUI, com as mesmas funções
  // da tela, em vez de vir por parâmetro: recomputar da mesma fonte é mais
  // seguro que plumbing, que poderia entregar no arquivo um número diferente do
  // exibido.
  const porCredito = d.carteira.map((p) => {
    const proj = valorProjetado(p, d.parametros, hoje)
    return { p, proj, t: tir(p.capital_investido, p.data_aquisicao, proj) }
  })
  const tirMedia = tirMediaPonderada(
    porCredito.map(({ p, t }) => ({ tirAnual: t.anual, capital: p.capital_investido })),
  )
  const aReceber = aReceberEstimado(
    porCredito.map(({ p, proj }) => ({
      proj,
      dataLiquidacao: p.data_liquidacao,
      valorComplementar: p.valor_estimado_complementar,
    })),
  )
  const retornoCarteira = retornoProjetadoCarteira(
    porCredito.map(({ p, proj }) => ({
      ganho: ganhoProjetado(proj, p.capital_investido, p.valor_estimado_complementar),
      capital: p.capital_investido,
    })),
  )

  // Mesma ordem dos cards na tela.
  const indicadores: [string, number | string | Date | null, string | undefined][] = [
    ['Capital total', centavos(d.capitalTotal) ?? SEM, MOEDA],
    ['TIR média', tirMedia.valor ?? SEM, PCT],
    ['Retorno projetado', retornoCarteira.valor ?? SEM, PCT],
    ['Já recebido', centavos(d.jaRecebidoTotal) ?? SEM, MOEDA],
    ['A receber estimado', centavos(aReceber.total) ?? SEM, MOEDA],
    ['Nº de operações', d.carteira.length, undefined],
  ]
  // Bloco rótulo/valor com moldura, usado por indicadores e parâmetros.
  const bloco = (
    linhaInicial: number,
    itens: [string, number | string | Date | null, string | undefined][],
  ) => {
    itens.forEach(([rotulo, valor, fmt], i) => {
      const linha = linhaInicial + i
      const r = ws.getCell(linha, 1)
      r.value = rotulo
      r.font = { size: 10, color: { argb: C.rotulo } }
      r.border = contorno
      r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.zebra } }
      const v = ws.getCell(linha, 2)
      v.value = valor
      v.font = {
        bold: true,
        size: 11,
        color: { argb: typeof valor === 'number' ? C.tinta : C.apagado },
      }
      v.border = contorno
      v.alignment = { horizontal: 'right' }
      if (fmt && typeof valor === 'number') v.numFmt = fmt
    })
    return linhaInicial + itens.length
  }
  let linha = bloco(7, indicadores)

  // ---------- Parâmetros usados na projeção ----------
  // Vão no arquivo porque quem lê precisa saber sobre QUAL taxa o valor
  // projetado foi calculado; sem isso o número não é auditável.
  const pr = d.parametros
  linha += 1
  tituloSecao(linha, 'PARÂMETROS DE ATUALIZAÇÃO')
  linha = bloco(linha + 1, [
    ['SELIC vigente (% a.a.)', pr?.selic_aa ?? SEM, PCT],
    ['IPCA acumulado 12m (% a.a.)', pr?.ipca_12m_aa ?? SEM, PCT],
    ['IPCA + 2% a.a.', ipcaMais2(pr?.ipca_12m_aa) ?? SEM, PCT],
  ])

  // ---------- Cabeçalho de dois níveis, como na tela ----------
  // Linhas calculadas, não fixas: um bloco novo no topo desloca a tabela toda.
  linha += 1
  const LINHA_SECAO = linha
  const LINHA_GRUPO = linha + 1
  const LINHA_COLUNA = linha + 2
  const PRIMEIRA_DADO = linha + 3
  tituloSecao(LINHA_SECAO, 'CARTEIRA')

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
    // Encerrado sai com a mensagem fixa, igual à tela.
    const textos = textosResumo(p.status, d.resumos?.get(p.id))
    const proj = valorProjetado(p, d.parametros, hoje)
    const t = tir(p.capital_investido, p.data_aquisicao, proj)
    const ganho = ganhoProjetado(
      proj,
      p.capital_investido,
      p.valor_estimado_complementar,
    )
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
      textos.estagio ?? '',
      textos.providencias ?? '',
      paraData(d.ultimaMov?.get(onlyDigits(p.numero_cnj)) ?? null),
      proj.valor,
      statusTir(p.data_liquidacao),
      t.anual,
      t.mensal,
      diasEmCarteira(p.data_aquisicao, p.data_liquidacao, hoje),
      ganho,
      retorno(ganho, p.capital_investido),
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

  // Sem painel congelado, por decisão de produto: o arquivo é lido e entregue a
  // um agente, não navegado como planilha de trabalho. O autofiltro fica.
  // Planilha protegida contra edição: este arquivo é RETRATO do que a plataforma
  // calculou, e editar aqui criaria um número que não existe no sistema. Não há
  // fórmula em célula nenhuma, só valores.
  // Senha vazia de propósito — é trava contra edição acidental, não segredo:
  // quem precisar desproteger consegue em dois cliques, sem pedir senha a
  // ninguém. Selecionar e copiar seguem liberados.
  await ws.protect('', {
    selectLockedCells: true,
    selectUnlockedCells: true,
    autoFilter: true,
    sort: true,
  })
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
