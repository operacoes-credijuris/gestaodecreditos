/**
 * ONDE O CEDENTE ESTÁ NOS AUTOS — e o recorte que vai à IA montado em volta dele.
 *
 * Pedido do dono (03/10/2026): a leitura trazia dados de várias pessoas do
 * processo. A primeira metade da correção é a IA receber os trechos certos, e
 * isso depende de achar o nome do cedente como o comercial o escreve no título
 * (curto, abreviado, às vezes com uma letra trocada) nos autos (por extenso, em
 * maiúsculas, com acento).
 */
import { describe, it, expect } from 'vitest'
import {
  MARCA_DE_CORTE,
  documentoDepoisDoNome,
  fimDaQualificacao,
  documentosNoTexto,
  localizarTrecho,
  nomesCompativeis,
  posicoesDoNome,
  preparar,
  recortarAutos,
  tipoPessoaPeloNome,
} from '../../../supabase/functions/_shared/focoNoCedente.ts'
import { MAX_TEXTO_CHARS } from '../../../supabase/functions/_shared/orcamentoLeitura.ts'
import { acharCnpjs, acharDocumentos } from '../cpfNoTexto'

describe('tipoPessoaPeloNome', () => {
  it('reconhece a forma societária e as palavras de razão social', () => {
    expect(tipoPessoaPeloNome('Credijuris Gestão de Ativos Ltda')).toBe('PJ')
    expect(tipoPessoaPeloNome('ACME S/A')).toBe('PJ')
    expect(tipoPessoaPeloNome('Acme S.A.')).toBe('PJ')
    expect(tipoPessoaPeloNome('Silva & Souza Advogados Associados')).toBe('PJ')
    expect(tipoPessoaPeloNome('Padaria Pão Bom ME')).toBe('PJ')
    expect(tipoPessoaPeloNome('Fulano Comércio EIRELI')).toBe('PJ')
  })

  // "SÁ" É SOBRENOME: não pode virar "S/A".
  it('não confunde gente com empresa', () => {
    expect(tipoPessoaPeloNome('José de Sá')).toBeNull()
    expect(tipoPessoaPeloNome('Maria Eduarda Mendes')).toBeNull()
    expect(tipoPessoaPeloNome('Iana Kelle Pontes')).toBeNull()
    expect(tipoPessoaPeloNome('')).toBeNull()
  })
})

describe('posicoesDoNome', () => {
  const T = 'Vem IANA KELLE PONTES, brasileira, e também Iâna K. Pontes, e depois a autora IANA PONTES.'

  it('acha o nome com acento, caixa e nome do meio abreviado ou omitido', () => {
    expect(posicoesDoNome(T, 'Iana Kelle Pontes')).toHaveLength(3)
    expect(posicoesDoNome(T, 'Iana Pontes')).toHaveLength(3)
    expect(posicoesDoNome(T, 'IANA K. PONTES')).toHaveLength(3)
  })

  it('devolve a posição no texto ORIGINAL', () => {
    const [o] = posicoesDoNome(T, 'Iana Pontes')
    expect(T.slice(o.inicio, o.fim)).toBe('IANA KELLE PONTES')
  })

  // O PRIMEIRO NOME DIGITADO ERRADO no título: o par seguinte salva.
  it('tolera o primeiro nome trocado quando o nome tem três palavras', () => {
    expect(posicoesDoNome(T, 'Yana Kelle Pontes').length).toBeGreaterThan(0)
  })

  it('não acha quem não está lá', () => {
    expect(posicoesDoNome(T, 'José Carlos Lima')).toHaveLength(0)
    expect(posicoesDoNome(T, '')).toHaveLength(0)
  })

  it('empresa pelo nome de fantasia', () => {
    const t = 'A CREDIJURIS LTDA, pessoa jurídica de direito privado, inscrita no CNPJ…'
    expect(posicoesDoNome(t, 'Credijuris Gestão de Ativos Ltda')).toHaveLength(1)
    // Palavra de ramo não serve de âncora sozinha.
    expect(posicoesDoNome('O BANCO réu, citado…', 'Banco Fulano S/A')).toHaveLength(0)
  })
})

describe('nomesCompativeis', () => {
  it('mesma pessoa com o nome mais curto ou abreviado', () => {
    expect(nomesCompativeis('Iana Pontes', 'IANA KELLE PONTES')).toBe(true)
    expect(nomesCompativeis('Iana K. Pontes', 'Iana Kelle Pontes')).toBe(true)
    expect(nomesCompativeis('Iana Kele Pontes', 'IANA KELLE PONTES')).toBe(true)
  })

  it('outra pessoa', () => {
    expect(nomesCompativeis('Iana Kelle Pontes', 'José Carlos Lima')).toBe(false)
    // Só o primeiro nome em comum não basta.
    expect(nomesCompativeis('Maria Silva', 'Maria José Souza')).toBe(false)
  })
})

describe('documentoDepoisDoNome', () => {
  const T =
    'IANA KELLE PONTES, brasileira, casada, inscrita no CPF sob o nº 529.982.247-25, residente em Feira de ' +
    'Santana/BA; e JOSÉ CARLOS LIMA, brasileiro, solteiro, CPF 111.444.777-35, residente em Ilhéus/BA.'
  const docs = documentosNoTexto(T)

  it('o CPF de cada um é o que vem depois do nome dele', () => {
    expect(documentoDepoisDoNome(T, '52998224725', posicoesDoNome(T, 'Iana Pontes'), docs)).toBe(true)
    expect(documentoDepoisDoNome(T, '11144477735', posicoesDoNome(T, 'José Carlos Lima'), docs)).toBe(true)
  })

  // O ERRO QUE MOTIVOU TUDO: o CPF do outro autor, a poucos caracteres do nome.
  it('o CPF do outro autor não é do cedente', () => {
    expect(documentoDepoisDoNome(T, '11144477735', posicoesDoNome(T, 'Iana Pontes'), docs)).toBe(false)
    expect(documentoDepoisDoNome(T, '52998224725', posicoesDoNome(T, 'José Carlos Lima'), docs)).toBe(false)
  })
})

describe('localizarTrecho', () => {
  it('acha o trecho mesmo com espaço, quebra e pontuação diferentes', () => {
    const p = preparar('Fulano, residente\nna Rua   A, nº 10 — Salvador / BA.')
    expect(localizarTrecho(p, 'residente na Rua A, nº 10, Salvador/BA')).toHaveLength(1)
    expect(localizarTrecho(p, 'residente em Recife/PE')).toHaveLength(0)
  })
})

describe('recortarAutos', () => {
  const enchimento = (n: number, c = 'x') => (c + ' ').repeat(Math.ceil(n / 2)).slice(0, n)
  const QUALIF = 'IANA KELLE PONTES, brasileira, casada, CPF 529.982.247-25, residente em Salvador/BA'
  const max = 20_000
  const grande =
    'PETIÇÃO INICIAL. ' + enchimento(40_000, 'a') + QUALIF + enchimento(40_000, 'b') + ' ÚLTIMA PEÇA.'

  it('cabendo, vai inteiro', () => {
    const r = recortarAutos('curto ' + QUALIF, 'Iana Pontes', max)
    expect(r.texto).toBe('curto ' + QUALIF)
    expect(r.focado).toBe(true)
    expect(r.ocorrencias).toBe(1)
  })

  it('não cabendo, leva a qualificação do meio, o começo e o fim — dentro do teto', () => {
    const r = recortarAutos(grande, 'Iana Pontes', max)
    expect(r.texto.length).toBeLessThanOrEqual(max)
    expect(r.texto).toContain(QUALIF)
    expect(r.texto.startsWith('PETIÇÃO INICIAL.')).toBe(true)
    expect(r.texto.endsWith('ÚLTIMA PEÇA.')).toBe(true)
    expect(r.texto).toContain(MARCA_DE_CORTE)
    expect(r.focado).toBe(true)
  })

  // SEM NOME, como sempre foi: as duas pontas. O meio fica de fora.
  it('sem nome, as duas pontas — e o meio fica de fora', () => {
    const r = recortarAutos(grande, '', max)
    expect(r.texto.length).toBeLessThanOrEqual(max)
    expect(r.texto).not.toContain(QUALIF)
    expect(r.focado).toBe(false)
  })

  it('muitas aparições do nome não estouram o teto de verdade', () => {
    const muitas = Array.from({ length: 400 }, (_, i) => `Peça ${i}. ${QUALIF}. ${enchimento(3000)}`).join('\n')
    const r = recortarAutos(muitas, 'Iana Pontes', MAX_TEXTO_CHARS)
    expect(muitas.length).toBeGreaterThan(MAX_TEXTO_CHARS)
    expect(r.texto.length).toBeLessThanOrEqual(MAX_TEXTO_CHARS)
  })
})

describe('acharCnpjs', () => {
  it('acha o CNPJ formatado e o cru, com dígito válido', () => {
    const t = 'inscrita no CNPJ sob o nº 11.222.333/0001-81, e outro 11444777000161, e 11.222.333/0001-82'
    const achados = acharCnpjs(t)
    expect(achados.map((c) => c.cnpj)).toEqual(['11222333000181', '11444777000161'])
    expect(achados[0].rotulado).toBe(true)
  })

  it('acharDocumentos escolhe CPF ou CNPJ pelo tipo', () => {
    const t = 'CPF 529.982.247-25 e CNPJ 11.222.333/0001-81'
    expect(acharDocumentos(t, 'PF').map((d) => d.doc)).toEqual(['52998224725'])
    expect(acharDocumentos(t, 'PJ').map((d) => d.doc)).toEqual(['11222333000181'])
  })
})

describe('fimDaQualificacao', () => {
  it('a frase terminada, o ponto-e-vírgula e a passagem para a parte contrária encerram', () => {
    expect(fimDaQualificacao(', sede em Aracaju/SE (contrato social). A ré, FAZENDA, ')).toBe(true)
    expect(fimDaQualificacao(', residente em Ilhéus/BA; e JOSÉ, ')).toBe(true)
    expect(fimDaQualificacao(', propõe ação em face de UNIÃO, ')).toBe(true)
  })

  it('abreviação com ponto não encerra', () => {
    expect(fimDaQualificacao(', residente na Av. Sete, nº. 5, Apto. 3, inscrita no ')).toBe(false)
    expect(fimDaQualificacao(', brasileira, casada, do lar, inscrita no CPF sob o nº ')).toBe(false)
  })
})
