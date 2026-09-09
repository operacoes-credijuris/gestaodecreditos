import { describe, it, expect } from 'vitest'
import { acharOabs } from '../dadosNoTexto'

/**
 * A OAB NOS AUTOS é a única identidade que o advogado tem ali — não há CPF de
 * advogado numa petição. É por ela que a linha 11 do questionário ("Histórico
 * do advogado: tem dívida?") finalmente tem fonte: a OAB vai ao Escavador, o
 * CPF volta, e a busca de dívidas é a mesma dos demais sujeitos.
 *
 * Por isso apontar a OAB errada não é um campo errado: é diligenciar a dívida
 * de outra pessoa. A função devolve CANDIDATOS com o trecho em volta, e quem
 * confere escolhe — igual a cpfNoTexto.ts.
 */
describe('acharOabs', () => {
  it('lê as formas em que os autos escrevem uma inscrição', () => {
    const casos = [
      'OAB/GO 12.345',
      'OAB GO 12345',
      'OAB: GO nº 12.345',
      'OAB nº 12.345/GO',
      'OAB 12345/GO',
    ]
    for (const escrito of casos) {
      const [a] = acharOabs(`Assinado por procurador, ${escrito}, nos autos.`)
      expect(a, escrito).toBeTruthy()
      expect({ uf: a.uf, numero: a.numero }, escrito).toEqual({ uf: 'GO', numero: '12345' })
    }
  })

  it('pega o nome que vem antes da inscrição', () => {
    const [a] = acharOabs('Representado por Marcos Vinicius de Souza, OAB/MG 98765.')
    expect(a.nome).toBe('Marcos Vinicius de Souza')
  })

  // A palavra que cola na inscrição não é nome de ninguém.
  it('não confunde o cargo com o nome', () => {
    const [a] = acharOabs('O advogado OAB/SP 11111 peticionou.')
    expect(a.nome).toBeNull()
  })

  // SEMPRE ANCORADA EM "OAB": um par número/UF solto casa com data, com número
  // de lei e com metade dos endereços.
  it('número solto com sigla de estado não é OAB', () => {
    expect(acharOabs('Rua 12345 - GO, CEP 74000-000')).toEqual([])
    expect(acharOabs('Lei 12.345 de SP')).toEqual([])
    expect(acharOabs('')).toEqual([])
  })

  it('sigla que não é UF não entra', () => {
    expect(acharOabs('OAB/XX 12345')).toEqual([])
  })

  it('a mesma inscrição citada dez vezes aparece uma', () => {
    const texto = 'OAB/GO 12345 ... depois OAB GO 12.345 ... e enfim OAB nº 12345/GO'
    expect(acharOabs(texto)).toHaveLength(1)
  })

  it('vários advogados, na ordem do documento', () => {
    const texto =
      'Pelo cedente: Ana Paula Ribeiro, OAB/GO 11111. ' +
      'Pelo ente: Carlos Eduardo Lima, OAB/DF 22222.'
    const achados = acharOabs(texto)
    expect(achados.map((o) => `${o.uf} ${o.numero}`)).toEqual(['GO 11111', 'DF 22222'])
    expect(achados[0].nome).toBe('Ana Paula Ribeiro')
    expect(achados[1].nome).toBe('Carlos Eduardo Lima')
  })
})
