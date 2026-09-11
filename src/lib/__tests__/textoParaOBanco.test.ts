import { describe, it, expect } from 'vitest'
import { limparParaOBanco } from '../../../supabase/functions/_shared/textoParaOBanco.ts'

/**
 * O CARACTERE QUE DERRUBOU UMA ANÁLISE DE VERDADE.
 *
 * Guardar os autos de um processo de 239 páginas respondia `unsupported Unicode
 * escape sequence (HTTP 500)`. Não era a função, nem o JSON: o Postgres não
 * guarda o caractere nulo — nem em `jsonb`, nem em `text` —, e texto extraído de
 * PDF vem com ele quando a fonte tem glifo sem mapeamento.
 *
 * OS CARACTERES SÃO MONTADOS COM `fromCharCode` de propósito: escritos como
 * escape, eles somem no caminho entre editores e ferramentas, e o teste passaria
 * sem nunca ter testado o caso.
 */
const NUL = String.fromCharCode(0)

describe('limparParaOBanco', () => {
  it('tira o NUL, que é o que o banco recusa', () => {
    expect(limparParaOBanco('Kauã' + NUL + ' Barros')).toBe('Kauã Barros')
    expect(limparParaOBanco(NUL + NUL)).toBe('')
  })

  // ESTRUTURA NÃO É SUJEIRA: a quebra de linha separa uma decisão da seguinte, e
  // a tabulação alinha a coluna de valores da conta da contadoria.
  it('preserva tabulação, quebra de linha e retorno de carro', () => {
    const texto = 'a\tb\nc\rd'
    expect(limparParaOBanco(texto)).toBe(texto)
  })

  it('tira os outros controles C0', () => {
    const sujo = 'R$' + String.fromCharCode(1) + '1.234' + String.fromCharCode(31) + ',56'
    expect(limparParaOBanco(sujo)).toBe('R$1.234,56')
  })

  // NADA DE CONTEÚDO SAI. Um processo é escrito em português, com acento,
  // cedilha, travessão e cifrão — e a conta traz símbolo de moeda.
  it('não mexe no texto de um processo', () => {
    const trecho =
      'Requisitório expedido — execução nº 5012860-38.2023.4.03.6105, ' +
      'valor de R$ 1.234.567,89 (um milhão…), honorários contratuais de 30%.'
    expect(limparParaOBanco(trecho)).toBe(trecho)
  })

  // EMOJI INTEIRO É UM PAR de metades, e as duas juntas formam um caractere
  // válido: derrubá-lo por causa da regra dos substitutos soltos seria remover
  // conteúdo que o banco aceita.
  it('emoji completo atravessa; meia letra não', () => {
    expect(limparParaOBanco('nota 📎 anexa')).toBe('nota 📎 anexa')
    const metadeAlta = String.fromCharCode(0xd83d)
    const metadeBaixa = String.fromCharCode(0xdcce)
    expect(limparParaOBanco('a' + metadeAlta + 'b')).toBe('ab')
    expect(limparParaOBanco('a' + metadeBaixa + 'b')).toBe('ab')
    // Duas metades altas seguidas: a primeira não tem par, a segunda tem.
    expect(limparParaOBanco(metadeAlta + metadeAlta + metadeBaixa)).toBe(metadeAlta + metadeBaixa)
  })

  // O QUE CHEGA NEM SEMPRE É STRING: a lista de arquivos vem de JSON, e um campo
  // ausente não pode virar a palavra "undefined" dentro dos autos.
  it('o que não é texto vira texto vazio', () => {
    expect(limparParaOBanco(undefined)).toBe('')
    expect(limparParaOBanco(null)).toBe('')
  })
})
