import { describe, expect, it } from 'vitest'
import { AVISO_DO_DIGITO, avisoDoDigito } from '@/lib/digitoDoDocumento'
import { cpfCnpjValido } from '@/lib/format'

/**
 * O AVISO DO DÍGITO SÓ COM O DOCUMENTO COMPLETO (amostra, paginas1.js): no
 * meio da digitação o campo não acusa erro. A trava do Salvar é outra coisa e
 * não muda — o último teste a prende.
 */
describe('aviso do dígito verificador na ficha', () => {
  it('campo vazio ou incompleto: nada a dizer ainda', () => {
    expect(avisoDoDigito('')).toBeUndefined()
    expect(avisoDoDigito(null)).toBeUndefined()
    expect(avisoDoDigito('529.982')).toBeUndefined()
    expect(avisoDoDigito('529.982.247-2')).toBeUndefined()
    expect(avisoDoDigito('11.222.333/0001-8')).toBeUndefined()
  })

  it('CPF e CNPJ completos e certos: sem aviso', () => {
    expect(avisoDoDigito('529.982.247-25')).toBeUndefined()
    expect(avisoDoDigito('11.222.333/0001-81')).toBeUndefined()
  })

  it('CPF e CNPJ completos com o dígito errado: o aviso', () => {
    expect(avisoDoDigito('529.982.247-26')).toBe(AVISO_DO_DIGITO)
    expect(avisoDoDigito('11.222.333/0001-82')).toBe(AVISO_DO_DIGITO)
  })

  it('a trava do Salvar continua barrando o incompleto que o aviso cala', () => {
    expect(avisoDoDigito('529.982.247-2')).toBeUndefined()
    expect(cpfCnpjValido('529.982.247-2')).toBe(false)
    expect(cpfCnpjValido('11.222.333/0001-8')).toBe(false)
  })
})
