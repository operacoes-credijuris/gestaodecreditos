import { describe, it, expect } from 'vitest'
import { classificarParcelaCedida, valorDoCampo } from '../kommo'

/**
 * Onde termina o valor de um campo da anotação do card.
 *
 * Testado porque o defeito que ele conserta é SILENCIOSO e caro. O comercial
 * escreve os campos numa linha só — "PARCELA CEDIDA: principal; HONORÁRIOS C.:
 * 30%" —, e a captura até o fim da linha levava a palavra "honorários" para
 * dentro da parcela cedida. Resultado: cessão do PRINCIPAL classificada como
 * PRINCIPAL + HONORÁRIOS, preço pagando uma verba que fica com o advogado, e
 * nada na tela acusando — a análise sai completa e plausível.
 *
 * O formato enxuto que o comercial passou a usar (título com intermediador,
 * cedente e número; anotação com parcela cedida e percentual de honorários)
 * torna a linha única a forma normal de escrever, não a exceção.
 */
describe('valorDoCampo', () => {
  it('corta no rótulo seguinte, na mesma linha', () => {
    expect(valorDoCampo('principal; HONORÁRIOS C.: 30%')).toBe('principal')
    expect(valorDoCampo('principal + honorários; HONORÁRIOS C.: 30%')).toBe(
      'principal + honorários',
    )
  })

  it('deixa passar o valor inteiro quando não há outro rótulo', () => {
    expect(valorDoCampo('principal')).toBe('principal')
    // Ponto-e-vírgula SEM rótulo depois é parte do valor: quem separa campos é
    // o rótulo, não a pontuação.
    expect(valorDoCampo('honorários contratuais + sucumbenciais; sem principal')).toBe(
      'honorários contratuais + sucumbenciais; sem principal',
    )
  })

  it('tolera vazio e nulo', () => {
    expect(valorDoCampo('')).toBe('')
    expect(valorDoCampo(null)).toBe('')
    expect(valorDoCampo(undefined)).toBe('')
  })

  it('tira o espaço das pontas', () => {
    expect(valorDoCampo('  principal  ')).toBe('principal')
    expect(valorDoCampo(' principal ;  TIPO: RPV')).toBe('principal')
  })
})

/**
 * O par que importa: o corte serve para a classificação não mudar de resposta
 * por causa do campo vizinho.
 */
describe('anotação de uma linha só não contamina a parcela cedida', () => {
  const CASOS: Array<[string, string]> = [
    ['principal; HONORÁRIOS C.: 30%', 'principal'],
    ['principal + honorários; HONORÁRIOS C.: 30%', 'ambos'],
    ['honorários sucumbenciais; HONORÁRIOS C.: 20%', 'sucumbenciais'],
    ['honorários contratuais + sucumbenciais; HONORÁRIOS C.: 30%', 'honorarios'],
  ]

  for (const [escrito, esperado] of CASOS) {
    it(`"${escrito}" -> ${esperado}`, () => {
      expect(classificarParcelaCedida(valorDoCampo(escrito))).toBe(esperado)
    })
  }

  it('sem o corte, o principal viraria "ambos" — é o defeito que isto impede', () => {
    // Guarda de regressão pelo avesso: se alguém tirar o valorDoCampo do
    // caminho, este é o preço que se paga.
    expect(classificarParcelaCedida('principal; HONORÁRIOS C.: 30%')).toBe('ambos')
  })
})
