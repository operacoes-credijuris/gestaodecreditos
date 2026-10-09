// UF e cidade que o CNPJ preenche na ficha de Dados pessoais e bancários.
//
// Nasceu de um defeito: com a UF já escolhida e diferente da Receita, a cidade
// vinha da UF da Receita e a UF ficava a antiga — "Goiânia/SP" no contrato.

import { describe, it, expect } from 'vitest'
import { ufCidadeDoCnpj } from '@/lib/cnpj'

const MUNICIPIOS: Record<string, string[]> = {
  GO: ['Anápolis', 'Goiânia'],
  SP: ['Campinas', 'São Paulo'],
}
const RECEITA_GO = { uf: 'GO', cidade: 'GOIANIA' }

describe('ufCidadeDoCnpj', () => {
  it('ficha sem UF nem cidade recebe as duas da Receita, com o nome do IBGE', () => {
    expect(ufCidadeDoCnpj({ uf: '', cidade: '' }, RECEITA_GO, MUNICIPIOS)).toEqual({
      uf: 'GO',
      cidade: 'Goiânia',
      aviso: null,
    })
  })

  it('UF já escolhida e igual à da Receita: preenche só a cidade', () => {
    expect(ufCidadeDoCnpj({ uf: 'GO', cidade: '' }, RECEITA_GO, MUNICIPIOS)).toEqual({
      uf: 'GO',
      cidade: 'Goiânia',
      aviso: null,
    })
  })

  it('UF já escolhida e DIFERENTE da Receita: não põe cidade de outra UF, e avisa', () => {
    const r = ufCidadeDoCnpj({ uf: 'SP', cidade: '' }, RECEITA_GO, MUNICIPIOS)
    expect(r.uf).toBe('SP')
    expect(r.cidade).toBe('')
    expect(r.aviso).toContain('Goiânia/GO')
    expect(r.aviso).toContain('SP')
  })

  it('UF e cidade já preenchidas ficam como estão', () => {
    expect(
      ufCidadeDoCnpj({ uf: 'SP', cidade: 'Campinas' }, RECEITA_GO, MUNICIPIOS),
    ).toEqual({ uf: 'SP', cidade: 'Campinas', aviso: null })
  })

  it('ficha antiga com cidade e sem UF só ganha a UF da Receita se a cidade for de lá', () => {
    expect(ufCidadeDoCnpj({ uf: '', cidade: 'Anápolis' }, RECEITA_GO, MUNICIPIOS).uf).toBe('GO')
    expect(ufCidadeDoCnpj({ uf: '', cidade: 'Campinas' }, RECEITA_GO, MUNICIPIOS)).toEqual({
      uf: '',
      cidade: 'Campinas',
      aviso: null,
    })
  })

  it('Receita sem UF não mexe em nada nem avisa', () => {
    expect(
      ufCidadeDoCnpj({ uf: 'SP', cidade: '' }, { uf: '', cidade: '' }, MUNICIPIOS),
    ).toEqual({ uf: 'SP', cidade: '', aviso: null })
  })

  it('município da Receita fora da lista do IBGE deixa a cidade em branco', () => {
    expect(
      ufCidadeDoCnpj({ uf: '', cidade: '' }, { uf: 'GO', cidade: 'INEXISTENTE' }, MUNICIPIOS),
    ).toMatchObject({ uf: 'GO', cidade: '' })
    // E DIZ POR QUÊ (auditoria de bugs, 09/10/2026): antes ficava calada.
    expect(
      ufCidadeDoCnpj({ uf: '', cidade: '' }, { uf: 'GO', cidade: 'INEXISTENTE' }, MUNICIPIOS).aviso,
    ).toMatch(/INEXISTENTE/)
  })
})
