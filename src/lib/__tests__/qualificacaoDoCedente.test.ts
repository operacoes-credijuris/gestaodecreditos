/**
 * O QUE A IA LEU DOS AUTOS, conferido antes de preencher o cadastro.
 *
 * O cadastro do cedente decide o checklist inteiro de certidões — e a regra que
 * mais custa se falhar é a do CPF: número que não está escrito nos autos não
 * entra, por mais plausível que pareça.
 */
import { describe, it, expect } from 'vitest'
import {
  cpfComDvValido,
  cpfsEscritosNoTexto,
  dataParaIso,
  nascimentoPlausivel,
  normalizarQualificacao,
} from '../../../supabase/functions/_shared/qualificacaoDoCedente.ts'

const HOJE = new Date('2026-09-28T12:00:00Z')
const AUTOS =
  'IANA KELLE PONTES, brasileira, casada, portadora do CPF nº 529.982.247-25, nascida em 12/04/1985, ' +
  'filha de Maria Pontes, residente na Rua A, Salvador/BA. Cônjuge: JOÃO PONTES, CPF 111.444.777-35.'

describe('cpfsEscritosNoTexto', () => {
  it('acha o CPF formatado e o de onze dígitos seguidos', () => {
    const s = cpfsEscritosNoTexto('CPF 529.982.247-25 e também 11144477735.')
    expect(s.has('52998224725')).toBe(true)
    expect(s.has('11144477735')).toBe(true)
  })

  // O FALSO POSITIVO DOCUMENTADO em cpfNoTexto.ts: protocolo encostado numa data.
  it('não inventa CPF de número que é pedaço de outro número', () => {
    const s = cpfsEscritosNoTexto('Protocolo 5299822472526082026 e processo 8015250-24.2020.8.05.0000')
    expect(s.has('52998224725')).toBe(false)
  })
})

describe('conferências', () => {
  it('dígito verificador', () => {
    expect(cpfComDvValido('529.982.247-25')).toBe(true)
    expect(cpfComDvValido('529.982.247-26')).toBe(false)
    expect(cpfComDvValido('111.111.111-11')).toBe(false)
  })

  it('data de nascimento', () => {
    expect(dataParaIso('12/04/1985')).toBe('1985-04-12')
    expect(nascimentoPlausivel('1985-04-12', HOJE)).toBe(true)
    expect(nascimentoPlausivel('2020-01-01', HOJE)).toBe(false)
    expect(nascimentoPlausivel('1985-02-30', HOJE)).toBe(false)
  })
})

describe('normalizarQualificacao', () => {
  const bruto = {
    cedente: { nome: 'Iana Kelle Pontes', cpf: '529.982.247-25', nascimento: '12/04/1985', nome_mae: 'Maria Pontes', evidencia: 'IANA KELLE PONTES, brasileira, casada' },
    estado_civil: { valor: 'casado', evidencia: 'casada' },
    conjuge: { nome: 'João Pontes', cpf: '11144477735' },
    residencias: [
      { uf: 'ba', municipio: 'Salvador', atual: true, evidencia: 'Salvador/BA' },
      { uf: 'SE', municipio: 'Aracaju', atual: false },
      { uf: 'XX', municipio: 'Lugar Nenhum' },
    ],
  }

  it('passa o que está escrito nos autos', () => {
    const q = normalizarQualificacao(bruto, AUTOS, HOJE)
    expect(q.cedente.cpf?.valor).toBe('52998224725')
    expect(q.cedente.nascimento?.valor).toBe('1985-04-12')
    expect(q.cedente.nome_mae?.valor).toBe('Maria Pontes')
    expect(q.conjuge?.cpf?.valor).toBe('11144477735')
    expect(q.residencias.map((r) => `${r.municipio}/${r.uf}`)).toEqual(['Salvador/BA', 'Aracaju/SE'])
    expect(q.residencias[0].atual).toBe(true)
    expect(q.avisos).toEqual([])
  })

  // A TRAVA: CPF válido e plausível, mas que não está nos autos, não entra.
  it('descarta CPF que não está escrito nos autos', () => {
    const q = normalizarQualificacao({ ...bruto, cedente: { ...bruto.cedente, cpf: '390.533.447-05' } }, AUTOS, HOJE)
    expect(q.cedente.cpf).toBeNull()
    expect(q.avisos.join(' ')).toContain('não está escrito nos autos')
  })

  it('descarta CPF de dígito inválido e nascimento de criança', () => {
    const q = normalizarQualificacao(
      { ...bruto, cedente: { ...bruto.cedente, cpf: '529.982.247-26', nascimento: '2019-05-05' } },
      AUTOS,
      HOJE,
    )
    expect(q.cedente.cpf).toBeNull()
    expect(q.cedente.nascimento).toBeNull()
    expect(q.avisos).toHaveLength(2)
  })

  // DIVORCIADO NÃO TEM CÔNJUGE no checklist: o nome é do ex.
  it('só traz cônjuge quando o estado civil pede', () => {
    const q = normalizarQualificacao({ ...bruto, estado_civil: { valor: 'divorciado' } }, AUTOS, HOJE)
    expect(q.conjuge).toBeNull()
  })

  it('cônjuge com o CPF do cedente é descartado', () => {
    const q = normalizarQualificacao({ ...bruto, conjuge: { nome: 'João', cpf: '52998224725' } }, AUTOS, HOJE)
    expect(q.conjuge?.cpf).toBeNull()
  })

  it('sem residência marcada como atual, a primeira é a atual', () => {
    const q = normalizarQualificacao(
      { ...bruto, residencias: [{ uf: 'SE', municipio: 'Aracaju' }, { uf: 'BA', municipio: 'Salvador' }] },
      AUTOS,
      HOJE,
    )
    expect(q.residencias.filter((r) => r.atual).map((r) => r.uf)).toEqual(['SE'])
  })
})
