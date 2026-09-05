// Confere a planilha de Análise de RPV contra o modelo de verdade.
//
//   node scripts/conferir-planilha.cjs "<caminho do Modelo - Análise de RPV.xlsx>"
//
// MANUAL, e fora do `npm test`, porque o modelo não mora no repositório: ele é
// mantido no Storage do Supabase e muda quando o dono o edita. Baixe a versão
// que está lá e rode isto ANTES de mexer em gerarPlanilha.
//
// POR QUE EXISTE. Há duas classes de defeito que só aparecem no arquivo pronto.
// A primeira é escrita que quebra o arquivo — foi assim que apareceu a fórmula
// compartilhada órfã que fazia o ExcelJS recusar gravar a planilha inteira,
// depois de a análise já ter custado duas chamadas de IA. A segunda é
// divergência silenciosa entre o número que o motor calculou e o que a planilha
// exibe: nenhum dos dois acusa erro, e o preço sai errado.
//
// O QUE FAZ. Escreve as mesmas células que gerarPlanilha escreve, salva, relê o
// arquivo salvo, e confere: fórmulas de pé, bloco do modelo não usado oculto e
// vazio, só o cenário negociado visível, verba não contada duas vezes nos modos
// de só honorários, e a base do motor batendo com a da planilha.
const ExcelJS = require('exceljs')
const path = require('node:path')
const os = require('node:os')

const MODELO = process.argv[2]
if (!MODELO) {
  console.error('uso: node scripts/conferir-planilha.cjs "<caminho do modelo .xlsx>"')
  process.exit(2)
}
const SAIDA = path.join(os.tmpdir(), 'conferir-planilha-saida.xlsx')

/** A tabela progressiva do IRRF, igual à de _shared/irpf.ts. */
const ir = (b) => {
  const T = [[2428.80, 0, 0], [2826.65, 0.075, 182.16], [3751.05, 0.15, 394.16],
             [4664.68, 0.225, 675.49], [null, 0.275, 908.73]]
  const f = T.find((x) => x[0] === null || b <= x[0])
  return Math.max(0, b * f[1] - f[2])
}
const brl = (n) => 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** As quatro colunas de cenário: rótulo, valor, e o separador antes de cada. */
const CENARIOS = {
  principal:     { sep: 'R',  rot: 'S',  val: 'T' },
  ambos:         { sep: 'U',  rot: 'V',  val: 'W' },
  honorarios:    { sep: 'X',  rot: 'Y',  val: 'Z' },
  sucumbenciais: { sep: 'AA', rot: 'AB', val: 'AC' },
}
const DESAGIO = 0.295, CARTORIO = 1611.88, DILIG = 250, PRAZO = 12, COMISSAO = 0.09

/** O motor: o preparo dos dados mais a parte de calibrarDesagio que interessa. */
function motor(c) {
  const d = { tipo: c.tipo, sucumbenciais: c.sucumbenciais ?? 0 }
  if (c.tipo === 'sucumbenciais' || c.tipo === 'honorarios') {
    // A verba cedida VIRA o bruto e ocupa a linha do principal.
    d.soHonorarios = true
    d.soSucumbenciais = c.tipo === 'sucumbenciais'
    d.bruto = d.soSucumbenciais ? c.sucumbenciais : c.honorarios
    d.ir = ir(d.bruto); d.inss = 0; d.honorarios = 0
    d.modelo = 2
  } else {
    d.soHonorarios = false; d.soSucumbenciais = false
    d.bruto = c.bruto; d.ir = c.irPrincipal; d.inss = c.inss ?? 0
    d.honorarios = c.honorarios ?? 0
    d.modelo = c.tipo === 'ambos' ? 1 : 2
  }
  d.irHon = ir(d.honorarios)
  // L5 desconta o honorário BRUTO; L7 é o LÍQUIDO. A diferença é o IR, que não
  // fica com o credor nem com o advogado.
  d.L5 = d.bruto - (d.ir + d.inss + d.honorarios)
  d.L7 = Math.max(0, d.honorarios - d.irHon)
  d.base = d.modelo === 1 ? d.L5 + d.L7 : d.L5
  return d
}

/** gerarPlanilha, na parte que este script cobre. */
function montar(ws, d) {
  const off = d.modelo === 1 ? 0 : 12
  const cel = (col, lin) => ws.getCell(col + (lin + off))
  cel('K', 5).value = d.bruto
  cel('M', 5).value = d.ir
  cel('N', 5).value = d.inss
  const baseHon = d.modelo === 1 ? d.bruto : d.bruto - d.ir - d.inss
  const pctHon = baseHon > 0 ? d.honorarios / baseHon : 0
  cel('K', 7).value = Number(pctHon.toFixed(6))
  const pctSucumb = d.soHonorarios || !(d.bruto > 0) ? 0 : d.sucumbenciais / d.bruto
  cel('K', 8).value = Number(pctSucumb.toFixed(6))
  for (const l of [5, 7, 8]) cel('O', l).value = DESAGIO
  cel('Q', 5).value = PRAZO
  for (const col of ['T', 'W', 'Z', 'AC']) cel(col, 10).value = CARTORIO
  if (d.soHonorarios) cel('G', 5).value = d.soSucumbenciais ? 'Honorários Sucumbenciais' : 'Honorários Contratuais'

  const ini = d.modelo === 1 ? 13 : 1, fim = d.modelo === 1 ? 23 : 11
  for (let r = ini; r <= fim; r++) {
    const row = ws.getRow(r)
    for (let c = 1; c <= ws.columnCount; c++) {
      const cell = row.getCell(c)
      if (cell.isMerged && cell.master !== cell) continue
      cell.value = null
    }
  }
  ws.getCell('A' + ini).value = 'não utilizado nesta análise'
  for (let r = ini; r <= fim; r++) ws.getRow(r).hidden = true
  ws.getRow(12).hidden = true

  const usado = d.soHonorarios ? 'principal' : d.modelo === 1 ? 'ambos' : 'principal'
  for (const [nome, c] of Object.entries(CENARIOS)) {
    if (nome === usado) continue
    for (const col of [c.sep, c.rot, c.val]) ws.getColumn(col).hidden = true
  }
  if (d.soHonorarios) {
    ws.getCell(CENARIOS.principal.rot + (2 + off)).value =
      d.soSucumbenciais ? 'Negociando apenas Honorários Sucumbenciais' : 'Negociando apenas Honorários'
  }
  return { usado, off, pctHon, pctSucumb }
}

/** A cadeia de fórmulas do modelo, avaliada à mão a partir do que foi escrito. */
function planilha(d, pctHon, pctSucumb) {
  const baseHon = d.modelo === 1 ? d.bruto : d.bruto - d.ir - d.inss
  const L7 = baseHon * pctHon - ir(baseHon * pctHon)
  const L8 = d.bruto * pctSucumb - ir(d.bruto * pctSucumb)
  const L5 = d.modelo === 1
    ? d.bruto - (d.ir + d.inss + d.bruto * pctHon)
    : (d.bruto - d.ir - d.inss) * (1 - pctHon)
  const P = (x) => x * (1 - DESAGIO)
  const cen = (base, aquis) => {
    const total = COMISSAO * base + aquis + CARTORIO + DILIG
    return { base, total, rent: Math.pow(base / total, 1 / PRAZO) - 1 }
  }
  return {
    L5, L7, L8,
    principal: cen(L5, P(L5)),
    ambos: cen(L5 + L7 + L8, P(L5) + P(L7) + P(L8)),
    honorarios: cen(L7 + L8, P(L7) + P(L8)),
    sucumbenciais: cen(L8, P(L8)),
  }
}

const CASOS = [
  { nome: 'ambos, com sucumbenciais', tipo: 'ambos', bruto: 72186.12, irPrincipal: 8000, honorarios: 21655.84, sucumbenciais: 7218.61 },
  { nome: 'ambos, sem sucumbenciais', tipo: 'ambos', bruto: 50000, irPrincipal: 3000, inss: 1200, honorarios: 15000, sucumbenciais: 0 },
  { nome: 'so principal', tipo: 'principal', bruto: 72186.12, irPrincipal: 8000, honorarios: 19255.84, sucumbenciais: 0 },
  { nome: 'so honorarios', tipo: 'honorarios', honorarios: 20000, sucumbenciais: 0 },
  { nome: 'so sucumbenciais', tipo: 'sucumbenciais', sucumbenciais: 15000, honorarios: 0 },
]

// ---------------------------------------------------------------------------
// As âncoras da aba jurídica
// ---------------------------------------------------------------------------
//
// O questionário é escrito POR NÚMERO DE LINHA, então inserir uma pergunta no
// meio do modelo faz as respostas caírem nas perguntas erradas — sem erro, que
// é o pior jeito de quebrar. gerarPlanilha confere isto antes de escrever; aqui
// se confere a mesma coisa, e de quebra que a conferência DISPARA quando deve.
const ANCORAS = [
  [19, 'tipo da sentenca', 'tipo da sentença'],
  [24, 'foi apresentado valor', 'valor apresentado no CS / execução invertida'],
  [25, 'cuidado', 'bloco fixo CUIDADO'],
  [26, 'execucao invertida', 'cenários da execução invertida'],
  [28, 'impugnacao', 'houve impugnação ao valor'],
  [36, 'sucumbenciais', 'há honorários sucumbenciais'],
  [38, 'expedicao de algum documento', 'houve expedição de documento'],
  [39, 'valor total final', 'valor final do crédito'],
  [40, 'observacao importante', 'observações e riscos'],
]
/** A mesma normalizar() do index.ts: sem acento, sem pontuação, sem espaço. */
const normalizar = (s) => String(s).toLowerCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/[.\-/() ]/g, '')
const textoDaCelula = (v) => {
  if (v == null) return ''
  return Array.isArray(v.richText) ? v.richText.map((p) => String(p?.text ?? '')).join('') : String(v)
}
const conferirAncoras = (aj) =>
  ANCORAS.filter(([l, t]) => !normalizar(textoDaCelula(aj.getCell('A' + l).value)).includes(normalizar(t)))

async function checarAncoras() {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(MODELO)
  const fora = conferirAncoras(wb.getWorksheet('Análise jurídica'))
  if (fora.length) {
    console.log('  FALHA  ancoras da aba juridica: ' +
      fora.map(([l, , o]) => `linha ${l} devia ser "${o}"`).join('; '))
    return false
  }
  console.log(`  ok     ancoras da aba juridica (${ANCORAS.length} conferidas)`)

  // E a conferência precisa DISPARAR quando o modelo anda: uma guarda que nunca
  // acusa nada é indistinguível de guarda nenhuma.
  const wb2 = new ExcelJS.Workbook()
  await wb2.xlsx.readFile(MODELO)
  wb2.getWorksheet('Análise jurídica').spliceRows(30, 0, ['linha inserida de propósito'])
  await wb2.xlsx.writeFile(SAIDA)
  const wb3 = new ExcelJS.Workbook()
  await wb3.xlsx.readFile(SAIDA)
  const fora2 = conferirAncoras(wb3.getWorksheet('Análise jurídica'))
  if (!fora2.length) {
    console.log('  FALHA  a guarda nao disparou num modelo deslocado de proposito')
    return false
  }
  console.log(`  ok     a guarda dispara quando o modelo anda (${fora2.length} ancoras)`)
  return true
}

;(async () => {
  let ok = 0
  const ancorasOk = await checarAncoras()
  for (const c of CASOS) {
    const d = motor(c)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(MODELO)
    const ws = wb.getWorksheet('Precificação')
    const { usado, off, pctHon, pctSucumb } = montar(ws, d)
    const p = planilha(d, pctHon, pctSucumb)

    const erros = []
    try {
      await wb.xlsx.writeFile(SAIDA)
      const wb2 = new ExcelJS.Workbook()
      await wb2.xlsx.readFile(SAIDA)
      const w = wb2.getWorksheet('Precificação')

      // 1. As fórmulas do bloco usado sobreviveram à escrita.
      for (const nome of ['L5', 'L7', 'M7', 'L8', 'M8']) {
        const cel = nome[0] + (Number(nome.slice(1)) + off)
        const v = w.getCell(cel).value
        if (!(v && typeof v === 'object' && (v.formula || v.sharedFormula))) erros.push('formula de ' + cel + ' destruida')
      }
      // 2. O bloco do outro modelo sumiu, e está vazio para quem reexibir.
      const ini = d.modelo === 1 ? 13 : 1, fim = d.modelo === 1 ? 23 : 11
      for (let r = ini; r <= fim; r++) if (!w.getRow(r).hidden) erros.push('linha ' + r + ' visivel')
      if (w.getCell('K' + (d.modelo === 1 ? 17 : 5)).value) erros.push('bloco nao usado ainda tem valor')
      if (!w.getRow(12).hidden) erros.push('separadora 12 visivel')
      // 3. Só o cenário negociado aparece.
      for (const [nome, cn] of Object.entries(CENARIOS)) {
        for (const col of [cn.sep, cn.rot, cn.val]) {
          if ((nome === usado) === !!w.getColumn(col).hidden) erros.push(`coluna ${col} (${nome}) errada`)
        }
      }
      // 4. Em "só honorários" a verba não pode ser contada duas vezes.
      if (d.soHonorarios) {
        if (w.getCell('K' + (7 + off)).value !== 0) erros.push('K7 nao zerado em so-honorarios')
        if (w.getCell('K' + (8 + off)).value !== 0) erros.push('K8 nao zerado em so-honorarios (verba contada 2x)')
        if (!(Number(w.getCell('M' + (5 + off)).value) > 0)) erros.push('IR nao descontado da verba')
        const rot = String(w.getCell('S' + (2 + off)).value ?? '')
        if (!rot.includes(d.soSucumbenciais ? 'Sucumbenciais' : 'Honorários')) erros.push('rotulo: ' + rot)
      }
      // 5. O NÚMERO: a planilha reproduz a base do motor. No cenário "ambos" a
      //    coluna soma também os sucumbenciais, que o motor não modela.
      const extra = usado === 'ambos' ? p.L8 : 0
      if (Math.abs(p[usado].base - d.base - extra) > 0.01) {
        erros.push('base motor ' + brl(d.base) + ' x planilha ' + brl(p[usado].base))
      }
      if (Math.abs(p.L5 - d.L5) > 0.01) erros.push('L5 motor ' + brl(d.L5) + ' x planilha ' + brl(p.L5))
      if (Math.abs(p.L7 - d.L7) > 0.01) erros.push('L7 motor ' + brl(d.L7) + ' x planilha ' + brl(p.L7))
    } catch (e) { erros.push('SAVE: ' + (e.message || e)) }

    if (!erros.length) ok++
    console.log((erros.length ? '  FALHA ' : '  ok    ') + c.nome.padEnd(26) +
      usado.padEnd(12) + 'base ' + brl(p[usado].base).padStart(14) + '   rent ' + (p[usado].rent * 100).toFixed(2) + '%/mes')
    erros.forEach((e) => console.log('           - ' + e))
  }
  console.log(`${ok}/${CASOS.length} cenarios` + (ancorasOk ? '' : '   + ancoras REPROVADAS'))
  process.exit(ok === CASOS.length && ancorasOk ? 0 : 1)
})()
