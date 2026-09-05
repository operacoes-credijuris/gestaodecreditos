const fs = require('fs')
const p = 'src/components/AnaliseRpvModal.tsx'
let s = fs.readFileSync(p, 'utf8')
const nl = s.includes('\r\n') ? '\r\n' : '\n'
const L = (t) => t.split('\n').join(nl)
let n = 0
function troca(old, nw, r) {
  const a = L(old), b = L(nw)
  if (!s.includes(a)) { console.error('NAO ACHOU [' + r + ']'); process.exit(1) }
  s = s.replace(a, b); n++; console.log('ok: ' + r)
}

troca(`import { formatBRL, formatPercent } from '@/lib/format'`,
      `import { formatBRL, formatBRLInput, formatPercent, onlyDigits, parseBRLInput } from '@/lib/format'`, 'import')

troca(`  /** Custo de cartório digitado à mão, quando a consulta não resolve. */
  const [manual, setManual] = useState({ escritura: '', registro: '' })`,
`  /**
   * Custo de cartório digitado à mão, quando a consulta não resolve.
   *
   * Guarda SÓ DÍGITOS, e eles são centavos — a mesma máscara de dinheiro do
   * cadastro de créditos (ver parseBRLInput). Aceitar texto livre trazia uma
   * ambiguidade cara: em pt-BR o ponto é separador de milhar, então "1234.56"
   * digitado por quem pensa em inglês viraria R$ 123.456,00. Num campo que
   * entra no preço, esse é um erro de 100x que ninguém vê.
   */
  const [manual, setManual] = useState({ escritura: '', registro: '' })`, 'estado em digitos')

troca(`    const num = (s: string) => {
      const v = Number(s.replace(/\./g, '').replace(',', '.'))
      return isFinite(v) && v > 0 ? v : null
    }
    const escritura = num(manual.escritura)
    const registro = num(manual.registro)`,
`    const positivo = (v: number | null) => (v !== null && v > 0 ? v : null)
    const escritura = positivo(parseBRLInput(manual.escritura))
    const registro = positivo(parseBRLInput(manual.registro))`, 'handler usa parseBRLInput')

troca(`                    inputMode="decimal"
                    placeholder="1.234,56"
                    value={manual.escritura}
                    disabled={ocupado}
                    onChange={(e) => setManual((m) => ({ ...m, escritura: e.target.value }))}`,
`                    inputMode="numeric"
                    placeholder="0,00"
                    value={manual.escritura ? formatBRLInput(parseBRLInput(manual.escritura)) : ''}
                    disabled={ocupado}
                    onChange={(e) =>
                      setManual((m) => ({ ...m, escritura: onlyDigits(e.target.value) }))
                    }`, 'campo escritura mascarado')

troca(`                    inputMode="decimal"
                    placeholder="89,10"
                    value={manual.registro}
                    disabled={ocupado}
                    onChange={(e) => setManual((m) => ({ ...m, registro: e.target.value }))}`,
`                    inputMode="numeric"
                    placeholder="0,00"
                    value={manual.registro ? formatBRLInput(parseBRLInput(manual.registro)) : ''}
                    disabled={ocupado}
                    onChange={(e) =>
                      setManual((m) => ({ ...m, registro: onlyDigits(e.target.value) }))
                    }`, 'campo registro mascarado')

troca(`                Informe o custo de cartório à mão e o preço se refaz. Em reais; deixe
                em branco o que não souber.`,
`                Informe o custo de cartório à mão e o preço se refaz. Digite só os
                números — os dois últimos dígitos são os centavos. Deixe em branco o
                que não souber.`, 'texto de ajuda')

fs.writeFileSync(p, s)
console.log('\n' + n + ' trocas')
