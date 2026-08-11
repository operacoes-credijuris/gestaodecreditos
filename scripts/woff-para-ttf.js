// Converte os .woff da Carlito (@fontsource/carlito) em .ttf para o pdfmake.
//
// POR QUE ISTO EXISTE: o PDF da petição usa Calibri por decisão de produto, e a
// Calibri é da Microsoft — embuti-la num aplicativo web não é coberto pela
// licença dela. A Carlito é desenhada para ser METRICAMENTE IDÊNTICA à Calibri
// (mesmas larguras, então mesmas quebras de linha) e está sob SIL OFL, que
// permite redistribuir. O problema é só de formato: o fontsource publica woff e
// woff2, e o pdfkit — que o pdfmake usa por baixo — lê TTF/OTF.
//
// WOFF v1 não é um formato novo: é o mesmo SFNT do TTF com cada tabela comprimida
// em zlib e um cabeçalho diferente. Converter é desmontar e remontar o
// contêiner, sem tocar nos glifos.
//
// Rode uma vez, com `node scripts/woff-para-ttf.js`. Os .ttf gerados entram no
// repositório: são o insumo do PDF, e depender de um passo manual de build para
// gerar fonte seria uma forma silenciosa de o PDF sair sem a fonte certa.
// O projeto é ESM ("type": "module" no package.json), daí import em vez de require.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const ORIGEM = path.join(AQUI, '..', 'node_modules', '@fontsource', 'carlito', 'files')
const DESTINO = path.join(AQUI, '..', 'src', 'assets', 'fontes')

const ARQUIVOS = {
  'carlito-latin-400-normal.woff': 'Carlito-Regular.ttf',
  'carlito-latin-700-normal.woff': 'Carlito-Bold.ttf',
  'carlito-latin-400-italic.woff': 'Carlito-Italic.ttf',
  'carlito-latin-700-italic.woff': 'Carlito-BoldItalic.ttf',
}

function woffParaTtf(buf) {
  if (buf.toString('ascii', 0, 4) !== 'wOFF') throw new Error('não é um WOFF')
  const numTables = buf.readUInt16BE(12)

  // Diretório do WOFF: 20 bytes por tabela, a partir do byte 44.
  const tabelas = []
  for (let i = 0; i < numTables; i++) {
    const p = 44 + i * 20
    const tag = buf.toString('ascii', p, p + 4)
    const offset = buf.readUInt32BE(p + 4)
    const compLength = buf.readUInt32BE(p + 8)
    const origLength = buf.readUInt32BE(p + 12)
    const origChecksum = buf.readUInt32BE(p + 16)
    const bruto = buf.subarray(offset, offset + compLength)
    // Tabela igual ao original = não comprimida. É o que a especificação define,
    // e acontece com tabelas pequenas, onde o zlib não compensaria.
    const dados = compLength < origLength ? zlib.inflateSync(bruto) : bruto
    if (dados.length !== origLength) {
      throw new Error(`tabela ${tag}: esperava ${origLength} bytes, obteve ${dados.length}`)
    }
    tabelas.push({ tag, dados, origChecksum })
  }

  // Cabeçalho SFNT exige as tabelas em ordem alfabética de tag.
  tabelas.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0))

  // searchRange/entrySelector/rangeShift: campos herdados, calculados a partir da
  // maior potência de 2 que caiba em numTables. Leitores modernos ignoram, mas
  // valor errado faz validador reclamar.
  let pot = 1
  let expoente = 0
  while (pot * 2 <= numTables) {
    pot *= 2
    expoente++
  }

  const cabecalho = Buffer.alloc(12 + numTables * 16)
  cabecalho.writeUInt32BE(0x00010000, 0) // versão TrueType
  cabecalho.writeUInt16BE(numTables, 4)
  cabecalho.writeUInt16BE(pot * 16, 6)
  cabecalho.writeUInt16BE(expoente, 8)
  cabecalho.writeUInt16BE(numTables * 16 - pot * 16, 10)

  // Cada tabela começa em múltiplo de 4; o padding NÃO conta no length gravado.
  let offset = cabecalho.length
  const corpos = []
  tabelas.forEach((t, i) => {
    const p = 12 + i * 16
    cabecalho.write(t.tag, p, 4, 'ascii')
    cabecalho.writeUInt32BE(t.origChecksum, p + 4)
    cabecalho.writeUInt32BE(offset, p + 8)
    cabecalho.writeUInt32BE(t.dados.length, p + 12)
    corpos.push(t.dados)
    offset += t.dados.length
    const sobra = (4 - (t.dados.length % 4)) % 4
    if (sobra) {
      corpos.push(Buffer.alloc(sobra))
      offset += sobra
    }
  })

  return Buffer.concat([cabecalho, ...corpos])
}

fs.mkdirSync(DESTINO, { recursive: true })
for (const [origem, destino] of Object.entries(ARQUIVOS)) {
  const woff = fs.readFileSync(path.join(ORIGEM, origem))
  const ttf = woffParaTtf(woff)
  fs.writeFileSync(path.join(DESTINO, destino), ttf)
  console.log(`${destino}  ${(ttf.length / 1024).toFixed(0)} KB  (de ${origem})`)
}
console.log('\npronto em src/assets/fontes')
