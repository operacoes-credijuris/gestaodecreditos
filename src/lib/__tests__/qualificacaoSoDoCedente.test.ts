/**
 * O DADO TEM DE SER DO CEDENTE (pedido do dono, 03/10/2026).
 *
 * Os casos abaixo são os que faziam a leitura "pouco assertiva": processo com
 * vários autores, advogado qualificado com CPF no cabeçalho, e cedente que é
 * empresa. Em todos, o documento errado está ESCRITO nos autos e tem dígito
 * válido — as conferências de antes (qualificacaoDoCedente.test.ts) o deixavam
 * passar.
 */
import { describe, it, expect } from 'vitest'
import {
  cnpjComDvValido,
  cnpjsEscritosNoTexto,
  normalizarQualificacao,
} from '../../../supabase/functions/_shared/qualificacaoDoCedente.ts'

const HOJE = new Date('2026-10-03T12:00:00Z')

const VARIOS =
  'EXCELENTÍSSIMO SENHOR JUIZ. PAULO ROBERTO ALVES, brasileiro, solteiro, advogado, OAB/BA 1234, ' +
  'CPF 390.533.447-05, com escritório na Av. Sete, nº 100, Salvador/BA, vem, em nome de ' +
  'IANA KELLE PONTES, brasileira, casada, do lar, inscrita no CPF sob o nº 529.982.247-25, nascida em ' +
  '12/04/1985, filha de Maria Pontes, residente na Rua A, nº 5, Feira de Santana/BA; e ' +
  'JOSÉ CARLOS LIMA, brasileiro, solteiro, CPF 111.444.777-35, nascido em 03/03/1970, residente em Ilhéus/BA, ' +
  'propor a presente ação. ' +
  'x '.repeat(1500) +
  'SENTENÇA. A ré, UNIÃO FEDERAL, com sede em Brasília/DF, foi citada.'

const IANA = {
  encontrado: true,
  tipo_pessoa: 'PF',
  nome: 'IANA KELLE PONTES',
  cpf: '529.982.247-25',
  nascimento: '1985-04-12',
  nome_mae: 'Maria Pontes',
  evidencia_nome: 'IANA KELLE PONTES, brasileira, casada',
  evidencia_cpf: 'inscrita no CPF sob o nº 529.982.247-25',
  evidencia_nascimento: 'nascida em 12/04/1985',
  evidencia_nome_mae: 'filha de Maria Pontes',
}

describe('normalizarQualificacao — só o cedente', () => {
  const opcoes = { nomeDoCedente: 'Iana Pontes' }

  it('passa a qualificação do cedente, com o nome curto do título', () => {
    const q = normalizarQualificacao(
      {
        cedente: IANA,
        estado_civil: { valor: 'casado', evidencia: 'IANA KELLE PONTES, brasileira, casada' },
        residencias: [
          {
            uf: 'BA',
            municipio: 'Feira de Santana',
            atual: true,
            evidencia: 'residente na Rua A, nº 5, Feira de Santana/BA',
          },
        ],
      },
      VARIOS,
      HOJE,
      opcoes,
    )
    expect(q.cedente.tipo_pessoa).toBe('PF')
    expect(q.cedente.cpf?.valor).toBe('52998224725')
    expect(q.cedente.nascimento?.valor).toBe('1985-04-12')
    expect(q.cedente.nome_mae?.valor).toBe('Maria Pontes')
    expect(q.estado_civil?.valor).toBe('casado')
    expect(q.residencias.map((r) => r.municipio)).toEqual(['Feira de Santana'])
    expect(q.avisos).toEqual([])
  })

  // O OUTRO AUTOR: CPF escrito, dígito válido, a poucos caracteres do cedente.
  it('derruba o CPF do outro autor', () => {
    const q = normalizarQualificacao({ cedente: { ...IANA, cpf: '111.444.777-35' } }, VARIOS, HOJE, opcoes)
    expect(q.cedente.cpf).toBeNull()
    expect(q.avisos.join(' ')).toContain('não na qualificação')
  })

  // O ADVOGADO: qualificado ANTES do cedente, no cabeçalho.
  it('derruba o CPF do advogado', () => {
    const q = normalizarQualificacao({ cedente: { ...IANA, cpf: '390.533.447-05' } }, VARIOS, HOJE, opcoes)
    expect(q.cedente.cpf).toBeNull()
  })

  it('o segundo autor, quando é ele quem cede, sai com o CPF dele', () => {
    const q = normalizarQualificacao(
      {
        cedente: {
          nome: 'José Carlos Lima',
          cpf: '11144477735',
          nascimento: '1970-03-03',
          evidencia_cpf: 'JOSÉ CARLOS LIMA, brasileiro, solteiro, CPF 111.444.777-35',
          evidencia_nascimento: 'CPF 111.444.777-35, nascido em 03/03/1970',
        },
      },
      VARIOS,
      HOJE,
      { nomeDoCedente: 'José Carlos Lima' },
    )
    expect(q.cedente.cpf?.valor).toBe('11144477735')
    expect(q.cedente.nascimento?.valor).toBe('1970-03-03')
  })

  // OUTRA PESSOA INTEIRA: tudo cai, nada de "aproveitar" o que parece certo.
  it('a resposta com o nome de outra pessoa cai inteira', () => {
    const q = normalizarQualificacao(
      {
        cedente: { nome: 'José Carlos Lima', cpf: '11144477735' },
        residencias: [{ uf: 'BA', municipio: 'Ilhéus', evidencia: 'residente em Ilhéus/BA' }],
      },
      VARIOS,
      HOJE,
      opcoes,
    )
    expect(q.cedente.cpf).toBeNull()
    expect(q.cedente.nome).toBeNull()
    expect(q.residencias).toEqual([])
    expect(q.avisos.join(' ')).toContain('tudo descartado')
  })

  it('a IA que diz não ter achado devolve vazio, com aviso', () => {
    const q = normalizarQualificacao(
      { cedente: { encontrado: false }, aviso: 'Há duas Ianas.' },
      VARIOS,
      HOJE,
      opcoes,
    )
    expect(q.cedente.cpf).toBeNull()
    expect(q.avisos[0]).toContain('não achou')
    expect(q.avisos).toContain('Há duas Ianas.')
  })

  it('o cedente que não aparece nos autos não recebe dado nenhum', () => {
    const q = normalizarQualificacao(
      { cedente: { ...IANA, nome: '' } },
      VARIOS,
      HOJE,
      { nomeDoCedente: 'Roberta Andrade Sousa' },
    )
    expect(q.cedente.cpf).toBeNull()
    expect(q.cedente.nascimento).toBeNull()
    expect(q.avisos.join(' ')).toContain('não aparece')
  })

  it('endereço tirado de longe do cedente (a sede da ré) cai; trecho que não está nos autos também', () => {
    const q = normalizarQualificacao(
      {
        cedente: IANA,
        residencias: [
          { uf: 'DF', municipio: 'Brasília', atual: true, evidencia: 'UNIÃO FEDERAL, com sede em Brasília/DF' },
          { uf: 'SP', municipio: 'Campinas', evidencia: 'residente e domiciliada em Campinas/SP' },
          { uf: 'BA', municipio: 'Feira de Santana', evidencia: 'residente na Rua A, nº 5, Feira de Santana/BA' },
        ],
      },
      VARIOS,
      HOJE,
      opcoes,
    )
    expect(q.residencias.map((r) => r.uf)).toEqual(['BA'])
    expect(q.residencias[0].atual).toBe(true)
    expect(q.avisos.join(' ')).toContain('longe do nome')
    expect(q.avisos.join(' ')).toContain('não está nos autos')
  })

  it('sem o nome do card, as conferências de sempre (tela antiga, título sem nome)', () => {
    const q = normalizarQualificacao({ cedente: { ...IANA, cpf: '111.444.777-35' } }, VARIOS, HOJE)
    expect(q.cedente.cpf?.valor).toBe('11144477735')
  })
})

describe('normalizarQualificacao — cedente pessoa jurídica', () => {
  const PJ =
    'CREDIJURIS GESTÃO DE ATIVOS LTDA, pessoa jurídica de direito privado, inscrita no CNPJ sob o nº ' +
    '11.222.333/0001-81, com sede na Rua B, nº 10, Salvador/BA, neste ato representada por seu sócio ' +
    'JOÃO PONTES, brasileiro, casado, CPF 111.444.777-35. Antes, a sede da CREDIJURIS era em Aracaju/SE ' +
    '(contrato social). A ré, FAZENDA ALFA S/A, CNPJ 11.444.777/0001-61.'
  const opcoes = { nomeDoCedente: 'Credijuris Gestão de Ativos Ltda' }

  it('traz razão social, CNPJ e sede — e nada de pessoa física', () => {
    const q = normalizarQualificacao(
      {
        cedente: {
          tipo_pessoa: 'PJ',
          nome: 'CREDIJURIS GESTÃO DE ATIVOS LTDA',
          cnpj: '11.222.333/0001-81',
          cpf: '111.444.777-35',
          nascimento: '1970-01-01',
          evidencia_cnpj: 'inscrita no CNPJ sob o nº 11.222.333/0001-81',
        },
        estado_civil: { valor: 'casado', evidencia: 'casado' },
        conjuge: { nome: 'Fulana' },
        residencias: [
          { uf: 'BA', municipio: 'Salvador', atual: true, evidencia: 'com sede na Rua B, nº 10, Salvador/BA' },
          { uf: 'SE', municipio: 'Aracaju', atual: false, evidencia: 'Antes, a sede da CREDIJURIS era em Aracaju/SE' },
        ],
      },
      PJ,
      HOJE,
      opcoes,
    )
    expect(q.cedente.tipo_pessoa).toBe('PJ')
    expect(q.cedente.cnpj?.valor).toBe('11222333000181')
    expect(q.cedente.nome?.valor).toBe('CREDIJURIS GESTÃO DE ATIVOS LTDA')
    expect(q.cedente.cpf).toBeNull()
    expect(q.cedente.nascimento).toBeNull()
    expect(q.estado_civil).toBeNull()
    expect(q.conjuge).toBeNull()
    expect(q.residencias.map((r) => `${r.municipio}/${r.uf}/${r.atual}`)).toEqual([
      'Salvador/BA/true',
      'Aracaju/SE/false',
    ])
    expect(q.avisos.join(' ')).toContain('CPF para a empresa')
  })

  it('o nome com LTDA decide, mesmo com a IA dizendo PF', () => {
    const q = normalizarQualificacao(
      { cedente: { tipo_pessoa: 'PF', nome: 'Credijuris Ltda', cnpj: '11222333000181' } },
      PJ,
      HOJE,
      opcoes,
    )
    expect(q.cedente.tipo_pessoa).toBe('PJ')
    expect(q.cedente.cnpj?.valor).toBe('11222333000181')
  })

  it('o CNPJ da ré não é o do cedente', () => {
    const q = normalizarQualificacao(
      { cedente: { tipo_pessoa: 'PJ', nome: 'Credijuris Gestão de Ativos Ltda', cnpj: '11.444.777/0001-61' } },
      PJ,
      HOJE,
      opcoes,
    )
    expect(q.cedente.cnpj).toBeNull()
  })

  it('CNPJ de dígito inválido, ou fora dos autos, cai', () => {
    const invalido = normalizarQualificacao({ cedente: { tipo_pessoa: 'PJ', cnpj: '11222333000182' } }, PJ, HOJE, opcoes)
    expect(invalido.cedente.cnpj).toBeNull()
    const fora = normalizarQualificacao(
      { cedente: { tipo_pessoa: 'PJ', cnpj: '11444777000161' } },
      'nada aqui da CREDIJURIS',
      HOJE,
      opcoes,
    )
    expect(fora.cedente.cnpj).toBeNull()
  })

  it('o dígito do CNPJ e os CNPJs escritos', () => {
    expect(cnpjComDvValido('11.222.333/0001-81')).toBe(true)
    expect(cnpjComDvValido('11.222.333/0001-82')).toBe(false)
    expect(cnpjComDvValido('11111111111111')).toBe(false)
    expect([...cnpjsEscritosNoTexto(PJ)].sort()).toEqual(['11222333000181', '11444777000161'])
  })
})
