/**
 * O OFÍCIO REQUISITÓRIO DEFINE O TITULAR.
 *
 * Regra do dono (03/10/2026): "para extração das certidões o cedente deve
 * corresponder ao titular do crédito, do precatório, o que precisa corresponder
 * ao ofício anexado no kommo." O título do card é escrito à mão; o ofício é o
 * documento do tribunal que diz a quem o dinheiro vai. Certidão tirada no nome
 * do título, quando ele diverge do ofício, é certidão de quem não recebe nada.
 *
 * Os textos abaixo imitam o que o pdf.js extrai dos modelos reais (CJF/TRF,
 * SAJ/TJ, PJe-JT): os pedaços de cada página juntados com espaço, SEM quebra de
 * linha — o nome acaba no próximo rótulo, e não no fim da linha.
 */
import { describe, it, expect } from 'vitest'
import {
  alinharQualificacaoAoOficio,
  anexosDoCorpo,
  blocoDoOficioParaIA,
  conferirTitularDaIA,
  dobrar,
  imporOficioAosTitulares,
  lerOficios,
  mesmaPessoa,
  nomePareceOficio,
  oficioParaACessao,
  SEM_OFICIO,
} from '../../../supabase/functions/_shared/oficioDoCredito.ts'
import type { QualificacaoLida } from '../../../supabase/functions/_shared/qualificacaoDoCedente.ts'
import type { TitularLido } from '../../../supabase/functions/_shared/titularesDaCessao.ts'

// ------------------------------------------------------------------ modelos

/** RPV do TRF (modelo do CJF), beneficiário pessoa física, crédito principal. */
const RPV_TRF_PF =
  'PODER JUDICIÁRIO JUSTIÇA FEDERAL TRIBUNAL REGIONAL FEDERAL DA 1ª REGIÃO SEÇÃO JUDICIÁRIA DE GOIÁS ' +
  'REQUISIÇÃO DE PEQUENO VALOR - RPV Nº 20250001234 Processo Originário: 1001234-56.2019.4.01.3500 ' +
  'Requerente: MARIA APARECIDA DOS SANTOS Requerido: INSTITUTO NACIONAL DO SEGURO SOCIAL - INSS ' +
  'Beneficiário: MARIA APARECIDA DOS SANTOS CPF/CNPJ: 529.982.247-25 Data de nascimento: 12/04/1960 ' +
  'Natureza do crédito: Alimentar Espécie: RPV Valor requisitado: R$ 45.000,00 Data-base: 01/2025 ' +
  'Advogado: JOÃO PEREIRA LIMA OAB/GO 12.345 CPF 111.444.777-35\n'

/** Precatório do TJ (SAJ), credor pessoa jurídica. */
const PRECATORIO_TJ_PJ =
  'TRIBUNAL DE JUSTIÇA DO ESTADO DE GOIÁS OFÍCIO REQUISITÓRIO Nº 123/2025 - PRECATÓRIO ' +
  'Processo nº 5012345-67.2018.8.09.0051 Entidade devedora: ESTADO DE GOIÁS Credor(es): ' +
  'Nome: CONSTRUTORA HORIZONTE LTDA CNPJ: 11.222.333/0001-81 Natureza: Comum ' +
  'Valor global da requisição: R$ 1.250.000,00 Data-base: 03/2024 Advogado: PAULO MENDES OAB/GO 9.876\n'

/** Precatório do TRF, ofício SEPARADO de honorários sucumbenciais: o beneficiário é o advogado. */
const HONORARIOS_TRF =
  'PODER JUDICIÁRIO TRIBUNAL REGIONAL FEDERAL DA 1ª REGIÃO REQUISIÇÃO DE PAGAMENTO - PRECATÓRIO Nº 2025.01.0001 ' +
  'Tipo de requisição: Honorários sucumbenciais Requerente: MARIA APARECIDA DOS SANTOS ' +
  'Requerido: UNIÃO FEDERAL Beneficiário: JOÃO PEREIRA LIMA CPF: 111.444.777-35 OAB: GO12345 ' +
  'Natureza do crédito: Alimentar Valor requisitado: R$ 9.000,00 Data-base: 01/2025\n'

/** RPV de TJ com o destaque dos contratuais para a sociedade de advogados. */
const RPV_TJ_COM_DESTAQUE =
  'PODER JUDICIÁRIO DO ESTADO DE SÃO PAULO OFÍCIO REQUISITÓRIO - REQUISIÇÃO DE PEQUENO VALOR ' +
  'Processo nº 0012345-67.2015.8.26.0053 Entidade devedora: MUNICÍPIO DE SÃO PAULO ' +
  'Beneficiário: JOSÉ CARLOS FERREIRA CPF: 123.456.789-09 Natureza do crédito: Alimentar ' +
  'Valor requisitado: R$ 30.000,00 Honorários contratuais (destaque) ' +
  'Beneficiário: LIMA ADVOGADOS ASSOCIADOS CNPJ: 11.444.777/0001-61 Valor: R$ 9.000,00 Data-base: 02/2025\n'

/** Precatório do TRT (PJe-JT): sem "Beneficiário", o titular é o Exequente. */
const PRECATORIO_TRT =
  'PODER JUDICIÁRIO JUSTIÇA DO TRABALHO TRIBUNAL REGIONAL DO TRABALHO DA 18ª REGIÃO ' +
  'PRECATÓRIO Nº 0010123-45.2020.5.18.0001 Exequente: ANTÔNIO DE PÁDUA ROCHA CPF: 935.411.347-80 ' +
  'Executado: MUNICÍPIO DE GOIÂNIA Natureza do crédito: Alimentar Valor bruto requisitado: R$ 210.000,00 ' +
  'Data-base: 06/2024\n'

/** Autos com dois autores — e o despacho que manda expedir o ofício (que NÃO é o ofício). */
const AUTOS_DOIS_AUTORES =
  'EXCELENTÍSSIMO SENHOR DOUTOR JUIZ DE DIREITO JOSÉ CARLOS FERREIRA, brasileiro, casado, aposentado, ' +
  'inscrito no CPF sob o nº 123.456.789-09, residente em Goiânia/GO, e MARIA APARECIDA DOS SANTOS, ' +
  'brasileira, viúva, inscrita no CPF sob o nº 529.982.247-25, residente em Anápolis/GO, vêm propor ' +
  'AÇÃO DE COBRANÇA em face do MUNICÍPIO DE SÃO PAULO. ' +
  'x '.repeat(4000) +
  'DESPACHO: Homologo os cálculos. Expeça-se ofício requisitório (RPV) em favor dos exequentes, ' +
  'observado o valor requisitado de cada um e a data-base dos cálculos. Intimem-se.\n'

const anexo = (nome: string, texto: string) => ({ nome, texto })

// ------------------------------------------------------------------ achar

describe('lerOficios — achar o ofício entre os anexos', () => {
  it('RPV do TRF, beneficiário PF: nome, CPF de dígito válido e natureza principal', () => {
    const [o, ...resto] = lerOficios([anexo('RPV 20250001234.pdf', RPV_TRF_PF)])
    expect(resto).toHaveLength(0)
    expect(o.especie).toBe('RPV')
    expect(o.beneficiarios).toHaveLength(1)
    expect(o.beneficiarios[0]).toMatchObject({
      nome: 'MARIA APARECIDA DOS SANTOS',
      documento: '52998224725',
      tipo_pessoa: 'PF',
      natureza: 'principal',
    })
    // O ADVOGADO DO PROCESSO não é beneficiário de uma RPV do principal.
    expect(o.beneficiarios.some((b) => /JOÃO/.test(b.nome))).toBe(false)
  })

  it('precatório do TJ, credor PJ ("Credor(es): Nome: …"): CNPJ e tipo PJ', () => {
    const [o] = lerOficios([anexo('oficio precatorio.pdf', PRECATORIO_TJ_PJ)])
    expect(o.especie).toBe('PRECATORIO')
    expect(o.beneficiarios).toHaveLength(1)
    expect(o.beneficiarios[0]).toMatchObject({
      nome: 'CONSTRUTORA HORIZONTE LTDA',
      documento: '11222333000181',
      tipo_pessoa: 'PJ',
      natureza: 'principal',
    })
  })

  it('ofício separado de honorários: o advogado é o beneficiário, e o Requerente não', () => {
    const [o] = lerOficios([anexo('requisicao honorarios.pdf', HONORARIOS_TRF)])
    expect(o.especie).toBe('PRECATORIO')
    expect(o.beneficiarios).toHaveLength(1)
    expect(o.beneficiarios[0]).toMatchObject({
      nome: 'JOÃO PEREIRA LIMA',
      documento: '11144477735',
      natureza: 'sucumbenciais',
    })
  })

  it('destaque dos contratuais no mesmo ofício: dois beneficiários, cada um com a sua verba', () => {
    const [o] = lerOficios([anexo('rpv.pdf', RPV_TJ_COM_DESTAQUE)])
    expect(o.especie).toBe('RPV')
    const porNome = Object.fromEntries(o.beneficiarios.map((b) => [b.nome, b]))
    expect(porNome['JOSÉ CARLOS FERREIRA']).toMatchObject({ documento: '12345678909', natureza: 'principal' })
    expect(porNome['LIMA ADVOGADOS ASSOCIADOS']).toMatchObject({
      documento: '11444777000161',
      natureza: 'contratuais',
      tipo_pessoa: 'PJ',
    })
  })

  it('TRT sem "Beneficiário": o Exequente é o titular, e o Executado não entra', () => {
    const [o] = lerOficios([anexo('Precatório TRT18.pdf', PRECATORIO_TRT)])
    expect(o.especie).toBe('PRECATORIO')
    expect(o.beneficiarios.map((b) => b.nome)).toEqual(['ANTÔNIO DE PÁDUA ROCHA'])
    expect(o.beneficiarios[0].documento).toBe('93541134780')
  })

  // O NOME DO ARQUIVO NÃO DIZ NADA, e o conteúdo é de ofício: achado pelo conteúdo.
  it('nome genérico ("documento.pdf") com conteúdo de ofício: achado', () => {
    const oficios = lerOficios([anexo('documento.pdf', RPV_TRF_PF)])
    expect(oficios).toHaveLength(1)
    expect(oficios[0].porque).not.toContain('nome do arquivo')
    expect(oficios[0].beneficiarios[0].nome).toBe('MARIA APARECIDA DOS SANTOS')
  })

  // O DESPACHO QUE MANDA EXPEDIR o ofício tem o cabeçalho e cita "valor
  // requisitado" e "data-base" — e não é o ofício.
  it('o despacho "expeça-se ofício requisitório" nos autos não é ofício', () => {
    expect(lerOficios([anexo('autos completos.pdf', AUTOS_DOIS_AUTORES)])).toEqual([])
  })

  it('o ofício no meio dos autos inteiros: achado como TRECHO do arquivo', () => {
    const autos = AUTOS_DOIS_AUTORES + 'y '.repeat(5000) + RPV_TRF_PF + 'z '.repeat(8000)
    const oficios = lerOficios([anexo('processo integral.pdf', autos)])
    expect(oficios).toHaveLength(1)
    expect(oficios[0].texto.length).toBeLessThan(12_000)
    expect(oficios[0].beneficiarios.map((b) => b.nome)).toEqual(['MARIA APARECIDA DOS SANTOS'])
  })

  it('ofício digitalizado (nome de ofício, sem texto): fica na lista, sem beneficiário', () => {
    const [o] = lerOficios([anexo('Oficio_RPV.pdf', '   ')])
    expect(o).toMatchObject({ sem_texto: true, especie: 'RPV', beneficiarios: [] })
  })

  it('reconhece o nome de arquivo de ofício', () => {
    expect(nomePareceOficio('Ofício Requisitório.pdf')).toBe(true)
    expect(nomePareceOficio('RPV_123.pdf')).toBe(true)
    expect(nomePareceOficio('requisição-pagamento.pdf')).toBe(true)
    expect(nomePareceOficio('precatório.pdf')).toBe(true)
    expect(nomePareceOficio('documento.pdf')).toBe(false)
    expect(nomePareceOficio('procuração.pdf')).toBe(false)
  })

  it('dobrar mantém o comprimento (as posições cortam o original)', () => {
    const s = 'OFÍCIO REQUISITÓRIO — Beneficiário: JOÃO D’ÁVILA'
    expect(dobrar(s)).toHaveLength(s.length)
    expect(dobrar(s)).toContain('oficio requisitorio')
  })

  it('CPF de dígito inválido no ofício não vira documento', () => {
    const [o] = lerOficios([anexo('rpv.pdf', RPV_TRF_PF.replace('529.982.247-25', '529.982.247-26'))])
    expect(o.beneficiarios[0].documento).toBe('')
  })
})

// ------------------------------------------------------------------ titular

describe('oficioParaACessao — o titular é o do ofício', () => {
  it('título e ofício batem (nome curto, sem acento): sem divergência, sem aviso', () => {
    const l = oficioParaACessao([anexo('rpv.pdf', RPV_TRF_PF)], 'principal', 'Maria Santos')
    expect(l.titular?.documento).toBe('52998224725')
    expect(l.divergencia).toBeNull()
    expect(l.aviso).toBeNull()
  })

  it('título divergente: aviso "o título do card diz X; o ofício requisitório diz Y", e vale o ofício', () => {
    const l = oficioParaACessao([anexo('rpv.pdf', RPV_TRF_PF)], 'principal', 'José Carlos Ferreira')
    expect(l.titular?.nome).toBe('MARIA APARECIDA DOS SANTOS')
    expect(l.divergencia).toMatchObject({ titulo: 'José Carlos Ferreira', oficio: 'MARIA APARECIDA DOS SANTOS' })
    expect(l.aviso).toMatch(/O título do card diz José Carlos Ferreira; o ofício requisitório diz MARIA APARECIDA DOS SANTOS/)
  })

  it('vários autores nos autos, um só no ofício: o do ofício é o titular', () => {
    const anexos = [anexo('autos.pdf', AUTOS_DOIS_AUTORES), anexo('documento (3).pdf', RPV_TRF_PF)]
    const certo = oficioParaACessao(anexos, 'principal', 'Maria Aparecida')
    expect(certo.titular?.nome).toBe('MARIA APARECIDA DOS SANTOS')
    expect(certo.divergencia).toBeNull()
    // O título nomeia o OUTRO autor: divergência, e o ofício continua valendo.
    const errado = oficioParaACessao(anexos, 'principal', 'José Carlos Ferreira')
    expect(errado.titular?.documento).toBe('52998224725')
    expect(errado.divergencia).not.toBeNull()
  })

  it('sem ofício: o aviso "nenhum ofício requisitório nos anexos do card"', () => {
    const l = oficioParaACessao([anexo('autos.pdf', AUTOS_DOIS_AUTORES)], 'principal', 'Maria Aparecida')
    expect(l.oficios).toEqual([])
    expect(l.titular).toBeNull()
    expect(l.aviso).toBe(SEM_OFICIO)
  })

  it('ofício digitalizado: diz que achou e não leu, e usa o título', () => {
    const l = oficioParaACessao([anexo('oficio requisitorio.pdf', '')], 'principal', 'Maria')
    expect(l.titular).toBeNull()
    expect(l.aviso).toMatch(/sem texto legível/)
  })

  it('cessão de honorários: o titular é o advogado do ofício de honorários', () => {
    const anexos = [anexo('rpv principal.pdf', RPV_TRF_PF), anexo('rpv honorarios.pdf', HONORARIOS_TRF)]
    const l = oficioParaACessao(anexos, 'sucumbenciais', 'João Lima')
    expect(l.papelDoCedente).toBe('ADVOGADO')
    expect(l.titular).toMatchObject({ nome: 'JOÃO PEREIRA LIMA', documento: '11144477735' })
    expect(l.divergencia).toBeNull()
    // Contratuais pedidos, só sucumbenciais no ofício: usa, e avisa.
    const c = oficioParaACessao(anexos, 'contratuais', 'João Lima')
    expect(c.titular?.nome).toBe('JOÃO PEREIRA LIMA')
    expect(c.aviso).toMatch(/sucumbenciais/)
  })

  it('cessão de principal e honorários: um titular por papel', () => {
    const l = oficioParaACessao([anexo('rpv.pdf', RPV_TJ_COM_DESTAQUE)], 'ambos', 'José Carlos Ferreira')
    expect(l.porPapel.CEDENTE?.titular?.nome).toBe('JOSÉ CARLOS FERREIRA')
    expect(l.porPapel.ADVOGADO?.titular?.nome).toBe('LIMA ADVOGADOS ASSOCIADOS')
    expect(l.titular?.nome).toBe('JOSÉ CARLOS FERREIRA')
  })

  it('o card que não diz a verba: quem cede é quem o título nomeia', () => {
    const l = oficioParaACessao([anexo('rpv.pdf', RPV_TJ_COM_DESTAQUE)], 'auto', 'Lima Advogados')
    expect(l.titular?.nome).toBe('LIMA ADVOGADOS ASSOCIADOS')
    expect(l.divergencia).toBeNull()
  })

  it('vários beneficiários do principal num ofício só: o título escolhe; sem bater, ninguém', () => {
    const litis =
      'OFÍCIO REQUISITÓRIO Nº 77/2025 - PRECATÓRIO Entidade devedora: ESTADO DE GOIÁS Credor(es): ' +
      'Beneficiário: JOSÉ CARLOS FERREIRA CPF: 123.456.789-09 Valor: R$ 10.000,00 ' +
      'Beneficiário: MARIA APARECIDA DOS SANTOS CPF: 529.982.247-25 Valor: R$ 12.000,00 ' +
      'Natureza do crédito: Alimentar Valor global da requisição: R$ 22.000,00\n'
    const certo = oficioParaACessao([anexo('oficio.pdf', litis)], 'principal', 'Maria dos Santos')
    expect(certo.titular?.documento).toBe('52998224725')
    const nenhum = oficioParaACessao([anexo('oficio.pdf', litis)], 'principal', 'Pedro Álvares')
    expect(nenhum.titular).toBeNull()
    expect(nenhum.aviso).toMatch(/2 beneficiários/)
  })

  it('herdeiro: "Espólio de X" no título bate com a sucessora de X no ofício', () => {
    const herdeira =
      'REQUISIÇÃO DE PEQUENO VALOR - RPV Nº 99 Beneficiário: ANA LÚCIA FERREIRA (sucessora de JOSÉ CARLOS FERREIRA) ' +
      'CPF/CNPJ: 390.533.447-05 Natureza do crédito: Alimentar Valor requisitado: R$ 5.000,00 Data-base: 01/2025\n'
    const l = oficioParaACessao([anexo('rpv.pdf', herdeira)], 'principal', 'Espólio de José Carlos Ferreira')
    expect(l.titular).toMatchObject({ nome: 'ANA LÚCIA FERREIRA', sucede: 'JOSÉ CARLOS FERREIRA' })
    expect(l.divergencia).toBeNull()
    expect(l.aviso).toMatch(/sucede/)
  })
})

describe('mesmaPessoa', () => {
  it('tolera acento, caixa, nome do meio e espólio', () => {
    expect(mesmaPessoa('Antonio Rocha', 'ANTÔNIO DE PÁDUA ROCHA')).toBe(true)
    expect(mesmaPessoa('maria santos', 'MARIA APARECIDA DOS SANTOS')).toBe(true)
    expect(mesmaPessoa('Espólio de João da Silva', 'JOÃO DA SILVA')).toBe(true)
    expect(mesmaPessoa('Maria Santos', 'ANA FERREIRA', ['MARIA DOS SANTOS'])).toBe(true)
  })
  it('não junta pessoas diferentes', () => {
    expect(mesmaPessoa('José Carlos Ferreira', 'MARIA APARECIDA DOS SANTOS')).toBe(false)
    expect(mesmaPessoa('', 'MARIA')).toBe(false)
  })
})

// ------------------------------------------------------------------ servidor

describe('anexosDoCorpo — o campo novo e o antigo', () => {
  it('arquivos [{nome, texto}] vira os anexos, e o texto junto', () => {
    const r = anexosDoCorpo({ arquivos: [{ nome: 'a.pdf', texto: 'um' }, { nome: 'b.pdf', texto: 'dois' }] })
    expect(r.anexos.map((a) => a.nome)).toEqual(['a.pdf', 'b.pdf'])
    expect(r.texto).toContain('um')
    expect(r.texto).toContain('dois')
  })
  // A ABA ABERTA ANTES DO DEPLOY manda só `texto`: continua funcionando, e o
  // ofício ainda é achado pelo conteúdo.
  it('só `texto` (tela antiga): anexos sem nome, e o ofício achado pelo conteúdo', () => {
    const r = anexosDoCorpo({ texto: AUTOS_DOIS_AUTORES + '\n\n===== PRÓXIMO ARQUIVO =====\n\n' + RPV_TRF_PF })
    expect(r.anexos).toHaveLength(2)
    expect(r.anexos.every((a) => a.nome === '')).toBe(true)
    const l = oficioParaACessao(r.anexos, 'principal', 'Maria')
    expect(l.titular?.documento).toBe('52998224725')
  })
})

describe('conferirTitularDaIA', () => {
  const oficios = lerOficios([anexo('rpv.pdf', RPV_TRF_PF)])
  const det = oficios[0].beneficiarios[0]

  it('a IA que confirma o campo do ofício: fica o do campo', () => {
    const r = conferirTitularDaIA(
      { nome: 'Maria Aparecida dos Santos', documento: '529.982.247-25', natureza: 'principal', evidencia: 'x' },
      oficios,
      det,
    )
    expect(r.titular?.documento).toBe('52998224725')
    expect(r.avisos).toEqual([])
  })

  it('a IA que aponta outra pessoa perde para o campo do ofício', () => {
    const r = conferirTitularDaIA({ nome: 'José Carlos Ferreira', documento: '12345678909' }, oficios, det)
    expect(r.titular?.nome).toBe('MARIA APARECIDA DOS SANTOS')
    expect(r.avisos.join(' ')).toMatch(/vale o que está escrito no ofício/)
  })

  it('documento que não está escrito no ofício, ou de dígito inválido: descartado', () => {
    const naoEscrito = conferirTitularDaIA({ nome: 'MARIA APARECIDA DOS SANTOS', documento: '12345678909' }, oficios, null)
    expect(naoEscrito.titular?.documento).toBe('')
    expect(naoEscrito.avisos.join(' ')).toMatch(/não está escrito no ofício/)
    const invalido = conferirTitularDaIA({ nome: 'MARIA APARECIDA DOS SANTOS', documento: '52998224726' }, oficios, null)
    expect(invalido.titular?.documento).toBe('')
    expect(invalido.avisos.join(' ')).toMatch(/dígito verificador inválido/)
  })

  it('sem leitura determinística: vale a da IA, se o nome estiver no ofício', () => {
    const r = conferirTitularDaIA({ nome: 'Maria Aparecida dos Santos', documento: '52998224725' }, oficios, null, [
      'principal',
    ])
    expect(r.titular).toMatchObject({ documento: '52998224725', tipo_pessoa: 'PF', natureza: 'principal' })
    const fora = conferirTitularDaIA({ nome: 'Pedro Álvares Cabral' }, oficios, null)
    expect(fora.titular).toBeNull()
  })

  it('o bloco que vai à IA traz o nome do arquivo', () => {
    expect(blocoDoOficioParaIA(oficios)).toMatch(/^\[arquivo: rpv\.pdf · RPV\]/)
  })
})

describe('alinharQualificacaoAoOficio', () => {
  const q = (): QualificacaoLida => ({
    cedente: {
      nome: { valor: 'MARIA APARECIDA DOS SANTOS', evidencia: 'e' },
      cpf: { valor: '12345678909', evidencia: 'e' },
      nascimento: null,
      nome_mae: null,
      tipo_pessoa: 'PF',
      cnpj: null,
    },
    estado_civil: null,
    conjuge: null,
    residencias: [],
    avisos: [],
  })
  const [maria] = lerOficios([anexo('rpv.pdf', RPV_TRF_PF)])[0].beneficiarios
  const [construtora] = lerOficios([anexo('oficio.pdf', PRECATORIO_TJ_PJ)])[0].beneficiarios

  it('CPF diferente do ofício: vale o do ofício, com aviso', () => {
    const r = alinharQualificacaoAoOficio(q(), maria)
    expect(r.cedente.cpf?.valor).toBe('52998224725')
    expect(r.avisos.join(' ')).toMatch(/vale o do ofício/)
  })

  it('o tipo segue o documento do ofício: 14 dígitos é PJ', () => {
    const r = alinharQualificacaoAoOficio(q(), construtora)
    expect(r.cedente.tipo_pessoa).toBe('PJ')
    expect(r.cedente.cnpj?.valor).toBe('11222333000181')
    expect(r.cedente.cpf).toBeNull()
  })

  it('sem titular do ofício: nada muda', () => {
    expect(alinharQualificacaoAoOficio(q(), null).cedente.cpf?.valor).toBe('12345678909')
  })
})

describe('imporOficioAosTitulares', () => {
  const [maria] = lerOficios([anexo('rpv.pdf', RPV_TRF_PF)])[0].beneficiarios
  const lidoErrado: TitularLido = {
    papel: 'CEDENTE',
    nome: 'JOSÉ CARLOS FERREIRA',
    documento: '12345678909',
    oab: '',
    tipoPessoa: 'PF',
    evidencia: 'inicial',
  }

  it('a leitura que apontou outro autor é trocada pelo do ofício', () => {
    const r = imporOficioAosTitulares([lidoErrado], { CEDENTE: maria })
    expect(r.titulares[0]).toMatchObject({ papel: 'CEDENTE', nome: 'MARIA APARECIDA DOS SANTOS', documento: '52998224725' })
    expect(r.avisos.join(' ')).toMatch(/vale o ofício/)
  })

  it('a leitura que não achou ninguém ganha o do ofício', () => {
    const r = imporOficioAosTitulares([], { CEDENTE: maria })
    expect(r.titulares).toHaveLength(1)
    expect(r.titulares[0].documento).toBe('52998224725')
  })

  it('a mesma pessoa sem documento ganha o do ofício, e a OAB lida fica', () => {
    const adv: TitularLido = { papel: 'ADVOGADO', nome: 'João Lima', documento: '', oab: 'GO 12345', tipoPessoa: '', evidencia: '' }
    const [joao] = lerOficios([anexo('honorarios.pdf', HONORARIOS_TRF)])[0].beneficiarios
    const r = imporOficioAosTitulares([adv], { ADVOGADO: joao })
    expect(r.titulares[0]).toMatchObject({ documento: '11144477735', oab: 'GO 12345' })
    expect(r.avisos).toEqual([])
  })
})
