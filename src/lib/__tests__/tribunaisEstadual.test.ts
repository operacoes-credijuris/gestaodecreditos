import { describe, it, expect } from 'vitest'
import { lerNumeroCnj, resolverUf, municipioDoEnte } from '../../../supabase/functions/_shared/tribunais.ts'

/**
 * O estado de um processo ESTADUAL, tirado do número CNJ.
 *
 * Antes não havia mapa para a Justiça Estadual: a UF saía só do que a IA
 * escrevesse em `uf_tramitacao` ou na sigla — e "TJ-GO" com hífen nem casava.
 * Sem UF não há tabela de cartório nem teto de RPV, e a análise seguia sem
 * dizer que era por isso. O número está no título do card e não depende de
 * transcrição.
 *
 * Códigos do Anexo I da Resolução CNJ 65/2008, conferidos com o formato que se
 * vê nos processos de cada estado.
 */
describe('Justiça Estadual pelo número CNJ', () => {
  const CASOS: Array<[string, string, string]> = [
    ['0001234-56.2023.8.26.0100', 'SP', 'TJSP'],
    ['0001234-56.2023.8.19.0001', 'RJ', 'TJRJ'],
    ['0001234-56.2023.8.13.0024', 'MG', 'TJMG'],
    ['0001234-56.2023.8.09.0051', 'GO', 'TJGO'],
    ['0001234-56.2023.8.17.0001', 'PE', 'TJPE'],
    ['0001234-56.2023.8.21.0001', 'RS', 'TJRS'],
    ['0001234-56.2023.8.16.0004', 'PR', 'TJPR'],
    ['0001234-56.2023.8.05.0001', 'BA', 'TJBA'],
    ['0001234-56.2023.8.07.0001', 'DF', 'TJDFT'],
    ['0001234-56.2023.8.24.0023', 'SC', 'TJSC'],
    ['0001234-56.2023.8.25.0001', 'SE', 'TJSE'],
    ['0001234-56.2023.8.27.2729', 'TO', 'TJTO'],
    ['0001234-56.2023.8.01.0001', 'AC', 'TJAC'],
  ]

  for (const [numero, uf] of CASOS) {
    it(`${numero} é ${uf}`, () => {
      expect(lerNumeroCnj(numero)).toEqual({ segmento: 'estadual', tribunal: Number(numero.slice(18, 20)) })
      expect(resolverUf({ numero_processo: numero })).toEqual({ uf, fonte: 'regiao' })
    })
  }

  it('a inversão conhecida: Sergipe é 25 e São Paulo é 26', () => {
    expect(resolverUf({ numero_processo: '0000000-00.2020.8.25.0001' }).uf).toBe('SE')
    expect(resolverUf({ numero_processo: '0000000-00.2020.8.26.0001' }).uf).toBe('SP')
  })

  it('o que a IA leu nos autos continua vindo primeiro — e é conferido contra o número', () => {
    // Autos dizem SP e o número diz SP: sem aviso.
    expect(resolverUf({ numero_processo: '0001234-56.2023.8.26.0100', uf_tramitacao: 'SP' })).toEqual({ uf: 'SP', fonte: 'autos' })
    // Autos dizem GO e o número é de SP: contradição dita, não escolhida em silêncio.
    const r = resolverUf({ numero_processo: '0001234-56.2023.8.26.0100', uf_tramitacao: 'GO' })
    expect(r.uf).toBe('GO')
    expect(r.aviso).toMatch(/TJSP/)
    expect(r.candidatas).toEqual(['SP'])
  })

  it('sigla com hífen, barra ou espaço é a mesma sigla', () => {
    for (const sigla of ['TJ-GO', 'TJ/GO', 'TJ GO', 'tj-go']) {
      expect(resolverUf({ tribunal: sigla }).uf).toBe('GO')
    }
  })

  it('código de TJ que não existe não inventa estado', () => {
    // 8.28 não é tribunal nenhum.
    expect(resolverUf({ numero_processo: '0001234-56.2023.8.28.0001' })).toEqual({ uf: null, fonte: 'nenhuma' })
  })
})

describe('qual município é o devedor', () => {
  /**
   * O teto da RPV municipal é de CADA município (CF, art. 100, §4º), e o número
   * que o sistema herdou é o da CAPITAL. Sem isolar o nome, um crédito contra
   * Anápolis era comparado com o teto de Goiânia — e o erro anda para os dois
   * lados: passa sem alerta o que precisa de renúncia, ou alerta o que não
   * precisa.
   */
  it('as redações que o ente costuma ter', () => {
    expect(municipioDoEnte('Município de Anápolis')).toBe('Anápolis')
    expect(municipioDoEnte('MUNICÍPIO DE SÃO PAULO')).toBe('SÃO PAULO')
    expect(municipioDoEnte('Prefeitura Municipal de Caruaru')).toBe('Caruaru')
    expect(municipioDoEnte('Prefeitura de Belo Horizonte')).toBe('Belo Horizonte')
    expect(municipioDoEnte('Câmara Municipal de Goiânia')).toBe('Goiânia')
    expect(municipioDoEnte('Fazenda Pública do Município de Recife')).toBe('Recife')
  })

  it('a UF colada no fim sai fora — o que se pesquisa é a cidade', () => {
    expect(municipioDoEnte('Município de São Paulo/SP')).toBe('São Paulo')
    expect(municipioDoEnte('Município de Campinas - SP')).toBe('Campinas')
    expect(municipioDoEnte('Município de Anápolis (GO)')).toBe('Anápolis')
  })

  it('nomes com "dos" e "da" continuam inteiros', () => {
    expect(municipioDoEnte('Município dos Barreiros')).toBe('Barreiros')
    expect(municipioDoEnte('Município de Aparecida de Goiânia')).toBe('Aparecida de Goiânia')
  })

  it('ente que não é municipal devolve null', () => {
    expect(municipioDoEnte('Estado de Goiás')).toBeNull()
    expect(municipioDoEnte('União')).toBeNull()
    expect(municipioDoEnte('GOIASPREV')).toBeNull()
    expect(municipioDoEnte('')).toBeNull()
    expect(municipioDoEnte(null)).toBeNull()
  })

  it('NÃO ADIVINHA: municipal sem cidade nomeada devolve null', () => {
    // Devolver a capital aqui gravaria no cache o teto de um município que não
    // é o do crédito, com cara de apurado.
    expect(municipioDoEnte('Fazenda Pública Municipal')).toBeNull()
    expect(municipioDoEnte('Prefeitura Municipal')).toBeNull()
  })
})
