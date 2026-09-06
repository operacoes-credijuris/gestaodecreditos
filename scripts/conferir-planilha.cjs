// Confere a planilha de Análise de RPV contra o modelo de verdade.
//
//   node scripts/conferir-planilha.cjs "<caminho do Modelo - Análise de RPV.xlsx>"
//
// MANUAL, e fora do `npm test`, porque o modelo não mora no repositório: ele é
// mantido no Storage do Supabase e muda quando o dono o edita. Baixe a versão
// que está lá e rode isto ANTES de mexer em gerarPlanilha.
//
// POR QUE EXISTE. Três classes de defeito que só aparecem no arquivo pronto:
//   1. escrita que quebra o arquivo — foi assim que apareceu a fórmula
//      compartilhada órfã que fazia o ExcelJS recusar gravar a planilha inteira,
//      depois de a análise já ter custado duas chamadas de IA;
//   2. divergência silenciosa entre o número que o motor calculou e o que a
//      planilha exibe — nenhum dos dois acusa erro, e o preço sai errado;
//   3. o mapa do questionário se afastando do modelo, o que faz a IA responder
//      certo a uma pergunta que não é a que está lá.
const ExcelJS = require('exceljs')
const path = require('node:path')
const os = require('node:os')

const MODELO = process.argv[2]
if (!MODELO) {
  console.error('uso: node scripts/conferir-planilha.cjs "<caminho do modelo .xlsx>"')
  process.exit(2)
}
const SAIDA = path.join(os.tmpdir(), 'conferir-planilha-saida.xlsx')
const FONTE = 'supabase/functions/gerar-analise-rpv/index.ts'

// ---------------------------------------------------------------------------
// Espelhos das regras que moram em _shared/
// ---------------------------------------------------------------------------

/** A tabela progressiva do IRRF, igual à de _shared/irpf.ts. */
const ir = (b) => {
  const T = [[2428.80, 0, 0], [2826.65, 0.075, 182.16], [3751.05, 0.15, 394.16],
             [4664.68, 0.225, 675.49], [null, 0.275, 908.73]]
  const f = T.find((x) => x[0] === null || b <= x[0])
  return Math.max(0, b * f[1] - f[2])
}
/** Um emolumento de teste: escritura por faixa + registro fixo. */
const emolumento = (v) => (v <= 0 ? 0 : (v <= 10000 ? 300 : v <= 50000 ? 800 : 1500) + 100)

const brl = (n) => 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const textoDaCelula = (v) => v == null ? ''
  : Array.isArray(v?.richText) ? v.richText.map((p) => String(p?.text ?? '')).join('')
  : String(v)

/** As quatro colunas de cenário: rótulo, valor, e o separador antes de cada. */
const CENARIOS = {
  principal:     { sep: 'R',  rot: 'S',  val: 'T' },
  ambos:         { sep: 'U',  rot: 'V',  val: 'W' },
  honorarios:    { sep: 'X',  rot: 'Y',  val: 'Z' },
  sucumbenciais: { sep: 'AA', rot: 'AB', val: 'AC' },
}
const VERBAS_POR_TIPO = {
  principal:     { principal: true,  contratuais: false, sucumbenciais: false },
  ambos:         { principal: true,  contratuais: true,  sucumbenciais: true },
  honorarios:    { principal: false, contratuais: true,  sucumbenciais: true },
  sucumbenciais: { principal: false, contratuais: false, sucumbenciais: true },
}
const DESAGIO = 0.295, DILIG = 250, PRAZO = 12, COMISSAO = 0.09

/**
 * O motor, espelhando _shared/precificacao.ts.
 *
 * O preço é a soma de até três parcelas. Havendo principal no negócio, o
 * deságio cai só sobre ele e os honorários vão pelo valor de face; e cada verba
 * tem a sua escritura e o seu registro.
 */
function motor(c) {
  const verbas = VERBAS_POR_TIPO[c.tipo]
  const d = {
    tipo: c.tipo, verbas, modelo: c.tipo === 'ambos' ? 1 : 2,
    bruto: c.bruto ?? 0, ir: c.irPrincipal ?? 0, inss: c.inss ?? 0,
    contratuais: c.honorarios ?? 0, sucumbenciais: c.sucumbenciais ?? 0,
  }
  // Cada verba de honorário é tributada em SEPARADO, como as fórmulas M7 e M8
  // do modelo. Tributar a soma aplicaria a parcela a deduzir uma vez só.
  const todas = [
    { nome: 'principal', liquido: d.bruto - d.ir - d.inss - d.contratuais },
    { nome: 'contratuais', liquido: d.contratuais - ir(d.contratuais) },
    { nome: 'sucumbenciais', liquido: d.sucumbenciais - ir(d.sucumbenciais) },
  ]
  const dentro = todas.filter((p) => verbas[p.nome] && p.liquido > 0)
  const temPrincipal = dentro.some((p) => p.nome === 'principal')
  d.parcelas = dentro.map((p) => ({ ...p, desagiavel: temPrincipal ? p.nome === 'principal' : true }))
  d.base = d.parcelas.reduce((s, p) => s + p.liquido, 0)
  d.cessao = d.parcelas.reduce((s, p) => s + p.liquido * (1 - (p.desagiavel ? DESAGIO : 0)), 0)
  d.cartorio = d.parcelas.reduce((s, p) => s + emolumento(p.liquido * (1 - (p.desagiavel ? DESAGIO : 0))), 0)
  d.cenario = verbas.principal && (verbas.contratuais || verbas.sucumbenciais) ? 'ambos'
    : verbas.principal ? 'principal'
    : verbas.contratuais ? 'honorarios' : 'sucumbenciais'
  return d
}

/** As mesmas células que gerarPlanilha escreve. */
function montar(ws, d) {
  const off = d.modelo === 1 ? 0 : 12
  const cel = (col, lin) => ws.getCell(col + (lin + off))
  cel('K', 5).value = d.bruto
  cel('M', 5).value = d.ir
  cel('N', 5).value = d.inss
  const baseHon = d.modelo === 1 ? d.bruto : d.bruto - d.ir - d.inss
  const pctHon = baseHon > 0 ? d.contratuais / baseHon : 0
  const pctSucumb = d.bruto > 0 ? d.sucumbenciais / d.bruto : 0
  cel('K', 7).value = Number(pctHon.toFixed(6))
  cel('K', 8).value = Number(pctSucumb.toFixed(6))
  // O deságio vai onde ele incide, e zero onde a verba não está no negócio.
  const desagioDe = (nome) => {
    const p = d.parcelas.find((x) => x.nome === nome)
    return p ? (p.desagiavel ? DESAGIO : 0) : 0
  }
  cel('O', 5).value = desagioDe('principal')
  cel('O', 7).value = desagioDe('contratuais')
  cel('O', 8).value = desagioDe('sucumbenciais')
  cel('Q', 5).value = PRAZO
  for (const col of ['T', 'W', 'Z', 'AC']) cel(col, 10).value = d.cartorio

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
  for (const [nome, c] of Object.entries(CENARIOS)) {
    if (nome === d.cenario) continue
    for (const col of [c.sep, c.rot, c.val]) ws.getColumn(col).hidden = true
  }
  return { off, pctHon, pctSucumb }
}

/** A cadeia de fórmulas do modelo, avaliada à mão a partir do que foi escrito. */
function planilha(d, pctHon, pctSucumb) {
  const dsg = (nome) => {
    const p = d.parcelas.find((x) => x.nome === nome)
    return p ? (p.desagiavel ? DESAGIO : 0) : 0
  }
  const baseHon = d.modelo === 1 ? d.bruto : d.bruto - d.ir - d.inss
  const L7 = baseHon * pctHon - ir(baseHon * pctHon)
  const L8 = d.bruto * pctSucumb - ir(d.bruto * pctSucumb)
  const L5 = d.modelo === 1
    ? d.bruto - (d.ir + d.inss + d.bruto * pctHon)
    : (d.bruto - d.ir - d.inss) * (1 - pctHon)
  const P5 = L5 * (1 - dsg('principal')), P7 = L7 * (1 - dsg('contratuais')), P8 = L8 * (1 - dsg('sucumbenciais'))
  const cen = (base, aquis) => {
    const total = COMISSAO * base + aquis + d.cartorio + DILIG
    return { base, aquis, total, rent: base > 0 ? Math.pow(base / total, 1 / PRAZO) - 1 : 0 }
  }
  return {
    L5, L7, L8,
    principal: cen(L5, P5),
    ambos: cen(L5 + L7 + L8, P5 + P7 + P8),
    honorarios: cen(L7 + L8, P7 + P8),
    sucumbenciais: cen(L8, P8),
  }
}

// ---------------------------------------------------------------------------
// As âncoras da aba jurídica
// ---------------------------------------------------------------------------
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
const semAcento = (x) => textoDaCelula(x).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').toLowerCase()
const foraDeLugar = (aj) => ANCORAS.filter(([l, t]) => !semAcento(aj.getCell('A' + l).value).includes(t))

async function checarAncoras() {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(MODELO)
  const fora = foraDeLugar(wb.getWorksheet('Análise jurídica'))
  if (fora.length) {
    console.log('  FALHA  âncoras: ' + fora.map(([l, , o]) => `linha ${l} devia ser "${o}"`).join('; '))
    return false
  }
  console.log(`  ok     âncoras da aba jurídica (${ANCORAS.length} conferidas)`)

  // E a guarda tem de DISPARAR quando o modelo anda. Guarda que só diz ok não
  // vale nada: é a que deixou as respostas caírem nas perguntas erradas.
  const wb2 = new ExcelJS.Workbook(); await wb2.xlsx.readFile(MODELO)
  const aj2 = wb2.getWorksheet('Análise jurídica')
  aj2.spliceRows(30, 0, ['pergunta inserida no meio'])
  const tmp = path.join(os.tmpdir(), 'conferir-deslocado.xlsx')
  await wb2.xlsx.writeFile(tmp)
  const wb3 = new ExcelJS.Workbook(); await wb3.xlsx.readFile(tmp)
  const disparou = foraDeLugar(wb3.getWorksheet('Análise jurídica'))
  console.log(disparou.length
    ? `  ok     a guarda dispara quando o modelo anda (${disparou.length} âncoras)`
    : '  FALHA  a guarda NÃO dispara num modelo deslocado')
  return disparou.length > 0
}

// ---------------------------------------------------------------------------
// O que o modelo PEDE x o que o prompt MANDA a IA responder
// ---------------------------------------------------------------------------
const PRIMEIRA = 10, ULTIMA = 38, BANNER = 25

/**
 * Confere uma lista suspensa contra o texto que manda preenchê-la.
 *
 * A ARMADILHA DO FORMATO: no .xlsx a lista é UMA string separada por vírgula, e
 * vírgula dentro de uma opção não tem como ser escapada — ela vira separador. O
 * Sheets guarda direito na tela dele, mas ao exportar achata tudo, e quem abrir
 * o arquivo vê a opção partida em duas. Aí o valor que a IA escreve não
 * pertence mais à lista e a célula abre marcada como inválida.
 */
function conferirLista(ws, endereco, textoQueManda) {
  const dv = ws.getCell(endereco).dataValidation
  if (!dv || dv.type !== 'list') return []
  const bruto = String(dv.formulae[0]).replace(/"\s*&\s*"/g, '').replace(/^"|"$/g, '')
  const opcoes = bruto.split(',').map((o) => o.trim()).filter(Boolean)
  const problemas = []
  const suspeitas = opcoes.filter((o) => textoQueManda && !textoQueManda.includes(o) && o.length < 18)
  if (suspeitas.length) {
    problemas.push(
      `a lista tem opção com VÍRGULA dentro, e no .xlsx a vírgula é o separador — ela chega partida ` +
      `(${opcoes.length} pedaços: ${opcoes.map((o) => `"${o}"`).join(', ').slice(0, 160)}...). ` +
      'Troque as vírgulas por travessão no modelo.')
    return problemas
  }
  for (const o of opcoes) {
    if (o === 'Sim' || o === 'Não') continue
    if (textoQueManda && !textoQueManda.includes(o)) problemas.push(`a opção "${o}" da lista não aparece no prompt`)
  }
  return problemas
}

/**
 * O mapa do m2, lido do próprio prompt no código-fonte.
 *
 * Entradas longas ocupam VÁRIAS linhas de fonte — a da 26 lista quatro cenários
 * e quebra em três. Ler só a primeira fazia a conferência reclamar de opções
 * que estavam lá, duas linhas abaixo.
 */
function mapaDoPrompt() {
  const src = require('node:fs').readFileSync(FONTE, 'utf8')
  const mapa = new Map()
  let atual = null
  for (const linha of src.split(/\r?\n/)) {
    const inicio = /^\s*'(\d+):\s([\s\S]*?)'\s*\+\s*$/.exec(linha)
    if (inicio) { atual = Number(inicio[1]); mapa.set(atual, inicio[2]); continue }
    if (atual === null) continue
    if (/^\s*'(===|NÃO EXISTEM)/.test(linha)) { atual = null; continue }
    const cont = /^\s*'([\s\S]*?)'\s*\+\s*$/.exec(linha)
    if (cont) mapa.set(atual, mapa.get(atual) + cont[1]); else atual = null
  }
  return mapa
}

async function checarMapa() {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(MODELO)
  const aj = wb.getWorksheet('Análise jurídica')
  const mapa = mapaDoPrompt()
  const problemas = []

  for (let r = PRIMEIRA; r <= ULTIMA; r++) {
    const entrada = mapa.get(r)
    if (r === BANNER) {
      if (entrada && !/BLOCO FIXO/i.test(entrada)) problemas.push(`linha ${r} é o bloco CUIDADO, mas o mapa a trata como pergunta`)
      continue
    }
    if (!entrada) { problemas.push(`linha ${r} ("${textoDaCelula(aj.getCell('A' + r).value).slice(0, 40)}") não está no mapa`); continue }
    for (const p of conferirLista(aj, 'B' + r, entrada)) problemas.push(`linha ${r}: ${p}`)
    const dica = textoDaCelula(aj.getCell('C' + r).value).toLowerCase()
    if (dica.includes('percentual') && !entrada.toLowerCase().includes('percentual')) {
      problemas.push(`linha ${r}: o modelo pede o PERCENTUAL no complemento e o prompt não menciona percentual`)
    }
  }
  for (const r of mapa.keys()) {
    if (r < PRIMEIRA || r > ULTIMA) problemas.push(`o mapa cita a linha ${r}, fora da faixa (${PRIMEIRA}..${ULTIMA})`)
  }

  // A C3 não vem do m2 — quem a escreve é o código, com tipo_credito.
  const TIPOS = require('node:fs').readFileSync(FONTE, 'utf8')
    .match(/dados\.tipo_credito = '([^']+)'/g)?.map((m) => m.replace(/.*'([^']+)'.*/, '$1')) ?? []
  for (const p of conferirLista(aj, 'C3', TIPOS.join(' | '))) problemas.push(`C3: ${p}`)
  const dvC3 = aj.getCell('C3').dataValidation
  const opcoesC3 = dvC3 ? String(dvC3.formulae[0]).replace(/^"|"$/g, '').split(',').map((o) => o.trim()) : []
  for (const tipo of TIPOS) {
    if (opcoesC3.length && !opcoesC3.includes(tipo)) problemas.push(`C3: o código escreve "${tipo}", que não é opção inteira da lista`)
  }

  if (problemas.length) {
    console.log('  FALHA  mapa do m2 x modelo:')
    problemas.forEach((p) => console.log('           - ' + p))
    return false
  }
  console.log(`  ok     mapa do m2 bate com o modelo (linhas ${PRIMEIRA}..${ULTIMA})`)
  return true
}

// ---------------------------------------------------------------------------
// Os cenários
// ---------------------------------------------------------------------------
const CASOS = [
  { nome: 'ambos, com sucumbenciais', tipo: 'ambos', bruto: 72186.12, irPrincipal: 8000, honorarios: 21655.84, sucumbenciais: 7218.61 },
  { nome: 'ambos, sem sucumbenciais', tipo: 'ambos', bruto: 50000, irPrincipal: 3000, inss: 1200, honorarios: 15000, sucumbenciais: 0 },
  { nome: 'so principal', tipo: 'principal', bruto: 72186.12, irPrincipal: 8000, honorarios: 19255.84, sucumbenciais: 0 },
  { nome: 'so honorarios', tipo: 'honorarios', bruto: 80000, irPrincipal: 6000, honorarios: 20000, sucumbenciais: 5000 },
  { nome: 'so sucumbenciais', tipo: 'sucumbenciais', bruto: 80000, irPrincipal: 6000, honorarios: 20000, sucumbenciais: 15000 },
]

;(async () => {
  let ok = 0
  const ancorasOk = await checarAncoras()
  const mapaOk = await checarMapa()

  for (const c of CASOS) {
    const d = motor(c)
    const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(MODELO)
    const ws = wb.getWorksheet('Precificação')
    const { off, pctHon, pctSucumb } = montar(ws, d)
    const p = planilha(d, pctHon, pctSucumb)

    const erros = []
    try {
      await wb.xlsx.writeFile(SAIDA)
      const wb2 = new ExcelJS.Workbook(); await wb2.xlsx.readFile(SAIDA)
      const w = wb2.getWorksheet('Precificação')

      // 1. As fórmulas do bloco usado sobreviveram à escrita.
      for (const nome of ['L5', 'L7', 'M7', 'L8', 'M8']) {
        const cel = nome[0] + (Number(nome.slice(1)) + off)
        const v = w.getCell(cel).value
        if (!(v && typeof v === 'object' && (v.formula || v.sharedFormula))) erros.push(`fórmula de ${cel} destruída`)
      }
      // 2. O bloco do outro modelo sumiu, e está vazio para quem reexibir.
      const ini = d.modelo === 1 ? 13 : 1, fim = d.modelo === 1 ? 23 : 11
      for (let r = ini; r <= fim; r++) if (!w.getRow(r).hidden) erros.push(`linha ${r} visível`)
      if (w.getCell('K' + (d.modelo === 1 ? 17 : 5)).value) erros.push('bloco não usado ainda tem valor')
      // 3. Só o cenário negociado aparece.
      for (const [nome, cn] of Object.entries(CENARIOS)) {
        for (const col of [cn.sep, cn.rot, cn.val]) {
          if ((nome === d.cenario) === !!w.getColumn(col).hidden) erros.push(`coluna ${col} (${nome}) errada`)
        }
      }
      // 4. O DESÁGIO ZERO NOS HONORÁRIOS quando há principal no negócio.
      if (d.verbas.principal) {
        for (const [lin, nome] of [[7, 'contratuais'], [8, 'sucumbenciais']]) {
          if (d.verbas[nome] && w.getCell('O' + (lin + off)).value !== 0) {
            erros.push(`O${lin + off} devia ser 0 (honorário comprado pelo valor de face) e é ${w.getCell('O' + (lin + off)).value}`)
          }
        }
        if (w.getCell('O' + (5 + off)).value !== DESAGIO) erros.push('o principal não recebeu o deságio')
      }
      // 5. UMA ESCRITURA POR VERBA: o cartório é a soma, não um par sobre o total.
      const umParSobreOTotal = emolumento(d.cessao)
      if (d.parcelas.length > 1 && !(d.cartorio > umParSobreOTotal)) {
        erros.push(`cartório ${brl(d.cartorio)} não é a soma por verba (um par sobre o total daria ${brl(umParSobreOTotal)})`)
      }
      if (w.getCell(CENARIOS[d.cenario].val + (10 + off)).value !== d.cartorio) erros.push('o cartório da coluna usada não é o total')
      // 6. O NÚMERO: a planilha reproduz a base do motor.
      if (Math.abs(p[d.cenario].base - d.base) > 0.01) {
        erros.push(`base motor ${brl(d.base)} x planilha ${brl(p[d.cenario].base)}`)
      }
      if (Math.abs(p[d.cenario].aquis - d.cessao) > 0.01) {
        erros.push(`cessão motor ${brl(d.cessao)} x planilha ${brl(p[d.cenario].aquis)}`)
      }
    } catch (e) { erros.push('SAVE: ' + (e.message || e)) }

    if (!erros.length) ok++
    console.log((erros.length ? '  FALHA ' : '  ok    ') + c.nome.padEnd(26) +
      d.cenario.padEnd(14) + `${d.parcelas.length} verba(s)  base ${brl(d.base).padStart(13)}  ` +
      `cessão ${brl(d.cessao).padStart(13)}  cartório ${brl(d.cartorio).padStart(10)}`)
    erros.forEach((e) => console.log('           - ' + e))
  }

  const extras = [ancorasOk ? null : 'âncoras', mapaOk ? null : 'mapa do m2'].filter(Boolean)
  console.log(`${ok}/${CASOS.length} cenários` + (extras.length ? `   + REPROVADO em: ${extras.join(', ')}` : ''))
  process.exit(ok === CASOS.length && ancorasOk && mapaOk ? 0 : 1)
})()
