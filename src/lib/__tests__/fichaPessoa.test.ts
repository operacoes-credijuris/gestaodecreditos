import { describe, it, expect } from 'vitest'
import { chaveDaFicha, enderecoDaFicha, montarFichaPessoa, type CampoPessoa } from '../fichaPessoa'

/**
 * O Salvar da ficha de pessoa (Dados cadastrais), como ele é HOJE.
 *
 * Teste de caracterização, não de especificação: prende o que a tela grava para
 * o redesenho não mudar nada sem querer. O risco que ele guarda é o de um Salvar
 * novo apagar dado que vai para o contrato — o upsert é da linha inteira, e três
 * colunas (gênero, complemento da qualificação, endereço antigo) não têm campo
 * na tela: só sobrevivem porque o payload as copia da ficha anterior.
 *
 * MUDOU DE PROPÓSITO (02/10/2026, onda 2 do redesenho, decisão do dono): gênero
 * e complemento da qualificação ganharam campo na ficha do INVESTIDOR (seção
 * "Para o contrato"). Com os campos na tela (`paraContrato`), o Salvar grava o
 * que a pessoa escolheu — bloco "campos na tela" no fim. Os testes de
 * preservação abaixo continuam valendo para quando os campos NÃO estão na tela
 * (a ficha do originador): nada aqui foi afrouxado.
 */

const FORM_VAZIO: Record<CampoPessoa, string> = {
  cpf: '',
  rg: '',
  representante: '',
  banco: '',
  agencia: '',
  conta: '',
  pix: '',
  logradouro: '',
  numero: '',
  complemento: '',
  bairro: '',
  cidade: '',
  uf: '',
  cep: '',
}

const ANTERIOR = {
  endereco: 'Rua Antiga, 10, Centro, Barbacena/MG',
  genero: 'F',
  qualificacao_complemento: 'brasileira, casada, médica',
}

type Anterior = Parameters<typeof montarFichaPessoa>[0]['anterior']

/** Salvar sobre a ficha que já existe (`ANTERIOR`, salvo outra indicada). */
const montar = (form: Partial<Record<CampoPessoa, string>>, anterior: Anterior = ANTERIOR) =>
  montarFichaPessoa({
    tipo: 'investidor',
    chave: 'maria da silva',
    nome: 'Maria da Silva',
    form: { ...FORM_VAZIO, ...form },
    anterior,
  })

/**
 * Salvar de cadastro NOVO (sem ficha anterior). Helper à parte porque passar
 * `undefined` ao `montar` cairia no valor padrão do parâmetro.
 */
const montarNovo = (form: Partial<Record<CampoPessoa, string>>) =>
  montarFichaPessoa({
    tipo: 'investidor',
    chave: 'maria da silva',
    nome: 'Maria da Silva',
    form: { ...FORM_VAZIO, ...form },
    anterior: undefined,
  })

// CPF e CNPJ com dígito verificador certo (o Salvar barra os inválidos antes).
const CPF = '529.982.247-25'
const CNPJ = '11.222.333/0001-81'

describe('montarFichaPessoa — o que o Salvar não pode perder', () => {
  it('PRESERVA o gênero da ficha anterior', () => {
    expect(montar({ pix: 'maria@x.com' }).genero).toBe('F')
  })

  it('PRESERVA o complemento da qualificação da ficha anterior', () => {
    expect(montar({ pix: 'maria@x.com' }).qualificacao_complemento).toBe(
      'brasileira, casada, médica',
    )
  })

  it('PRESERVA o endereço antigo quando as partes estão em branco', () => {
    // O caso que o comentário da tela descreve: ficha só com o texto corrido
    // legado, a pessoa mexe no Pix e salva.
    expect(montar({ pix: 'maria@x.com' }).endereco).toBe(
      'Rua Antiga, 10, Centro, Barbacena/MG',
    )
  })

  it('partes só com espaço contam como em branco: o endereço antigo fica', () => {
    expect(montar({ logradouro: '   ', bairro: ' ' }).endereco).toBe(
      'Rua Antiga, 10, Centro, Barbacena/MG',
    )
  })

  it('só a UF, sem cidade, não compila endereço: o antigo fica', () => {
    // compilarEndereco ignora UF sem cidade, então nada substitui o legado.
    expect(montar({ uf: 'MG' }).endereco).toBe('Rua Antiga, 10, Centro, Barbacena/MG')
  })

  it('com partes preenchidas, o endereço é o COMPILADO, e substitui o antigo', () => {
    const f = montar({
      logradouro: 'Rua Nova',
      numero: '223',
      complemento: 'apto. 1102',
      bairro: 'Savassi',
      cidade: 'Belo Horizonte',
      uf: 'MG',
      cep: '30140-071',
    })
    expect(f.endereco).toBe(
      'Rua Nova, nº 223, apto. 1102, bairro Savassi, Belo Horizonte/MG, CEP 30140-071',
    )
  })

  // MUDOU DE PROPÓSITO (02/10/2026, decisão do dono). Até ali, qualquer parte
  // sozinha substituía o antigo inteiro — o CEP digitado virava o endereço do
  // contrato. Agora o texto antigo só cede a um endereço novo com rua e cidade.
  it('uma parte sozinha NÃO substitui o antigo (nem só o CEP, nem só o bairro)', () => {
    expect(montar({ cep: '30140-071' }).endereco).toBe('Rua Antiga, 10, Centro, Barbacena/MG')
    expect(montar({ bairro: 'Savassi' }).endereco).toBe('Rua Antiga, 10, Centro, Barbacena/MG')
    expect(montar({ logradouro: 'Rua Nova', numero: '1' }).endereco).toBe('Rua Antiga, 10, Centro, Barbacena/MG')
    expect(montar({ cidade: 'Belo Horizonte', uf: 'MG' }).endereco).toBe('Rua Antiga, 10, Centro, Barbacena/MG')
  })

  it('rua e cidade bastam para o endereço novo substituir o antigo', () => {
    expect(montar({ logradouro: 'Rua Nova', cidade: 'Belo Horizonte', uf: 'MG' }).endereco).toBe(
      'Rua Nova, Belo Horizonte/MG',
    )
  })

  it('sem endereço antigo, qualquer parte vira o texto, como antes', () => {
    expect(montar({ cep: '30140-071' }, { ...ANTERIOR, endereco: null }).endereco).toBe('CEP 30140-071')
  })

  it('as partes digitadas são gravadas nas colunas delas mesmo quando o texto antigo fica', () => {
    const f = montar({ cep: '30140-071' })
    expect(f.cep).toBe('30140-071')
    expect(f.endereco).toBe('Rua Antiga, 10, Centro, Barbacena/MG')
  })

  it('sem ficha anterior (cadastro novo): gênero, qualificação e endereço null', () => {
    const f = montarNovo({ pix: 'maria@x.com' })
    expect(f.genero).toBeNull()
    expect(f.qualificacao_complemento).toBeNull()
    expect(f.endereco).toBeNull()
  })

  it('ficha anterior com as três colunas null: continuam null', () => {
    const f = montar(
      { pix: 'maria@x.com' },
      { endereco: null, genero: null, qualificacao_complemento: null },
    )
    expect(f.genero).toBeNull()
    expect(f.qualificacao_complemento).toBeNull()
    expect(f.endereco).toBeNull()
  })

  it('gênero e qualificação vêm da ficha mesmo com o endereço compilado', () => {
    const f = montar({ logradouro: 'Rua Nova', cidade: 'Belo Horizonte', uf: 'MG' })
    expect(f.genero).toBe('F')
    expect(f.qualificacao_complemento).toBe('brasileira, casada, médica')
    expect(f.endereco).toBe('Rua Nova, Belo Horizonte/MG')
  })

  it('gênero vazio na ficha ("") passa como está, não vira null', () => {
    // `??` só troca null/undefined. O banco aceita M, F ou vazio.
    expect(montar({}, { ...ANTERIOR, genero: '' }).genero).toBe('')
  })
})

describe('montarFichaPessoa — representante legal', () => {
  it('documento CPF: representante vira null, mesmo preenchido', () => {
    expect(montar({ cpf: CPF, representante: 'João Sócio' }).representante).toBeNull()
  })

  it('documento em branco: representante vira null', () => {
    expect(montar({ representante: 'João Sócio' }).representante).toBeNull()
  })

  it('documento CNPJ: representante é gravado (sem espaço nas pontas)', () => {
    expect(montar({ cpf: CNPJ, representante: '  João Sócio ' }).representante).toBe(
      'João Sócio',
    )
  })

  it('documento CNPJ com representante em branco: null', () => {
    expect(montar({ cpf: CNPJ, representante: '  ' }).representante).toBeNull()
  })

  it('a régua é a do ehCnpj: mais de 11 dígitos já é CNPJ', () => {
    // 12 dígitos não passam no Salvar (cpfCnpjValido barra antes), mas a função
    // em si decide só pela contagem.
    expect(montar({ cpf: '123456789012', representante: 'X' }).representante).toBe('X')
    expect(montar({ cpf: '12345678901', representante: 'X' }).representante).toBeNull()
  })
})

describe('montarFichaPessoa — campo a campo', () => {
  it('campo vazio vira null, nunca ""', () => {
    const f = montarNovo({})
    for (const c of [
      'cpf',
      'rg',
      'representante',
      'banco',
      'agencia',
      'conta',
      'pix',
      'logradouro',
      'numero',
      'complemento',
      'bairro',
      'cidade',
      'uf',
      'cep',
    ] as const) {
      expect(f[c], c).toBeNull()
    }
  })

  it('campo só com espaço vira null', () => {
    const f = montar({ rg: '   ', banco: '\t', pix: ' ' })
    expect(f.rg).toBeNull()
    expect(f.banco).toBeNull()
    expect(f.pix).toBeNull()
  })

  it('valor preenchido é gravado sem espaço nas pontas, e só isso', () => {
    const f = montar({
      cpf: ` ${CPF} `,
      rg: ' MG-12.345.678 ',
      banco: ' Banco do Brasil ',
      agencia: '1234-5',
      conta: '98765-0',
      pix: ' maria@x.com ',
      logradouro: ' Rua  Nova ',
      numero: '223',
      complemento: 'apto. 1102',
      bairro: 'Savassi',
      cidade: 'Belo Horizonte',
      uf: 'MG',
      cep: '30140-071',
    })
    // A MÁSCARA FICA: o CPF e o CEP são gravados como foram digitados (com
    // ponto, traço), não reduzidos a dígitos. Espaço do meio também fica.
    expect(f.cpf).toBe(CPF)
    expect(f.rg).toBe('MG-12.345.678')
    expect(f.banco).toBe('Banco do Brasil')
    expect(f.agencia).toBe('1234-5')
    expect(f.conta).toBe('98765-0')
    expect(f.pix).toBe('maria@x.com')
    expect(f.logradouro).toBe('Rua  Nova')
    expect(f.numero).toBe('223')
    expect(f.complemento).toBe('apto. 1102')
    expect(f.bairro).toBe('Savassi')
    expect(f.cidade).toBe('Belo Horizonte')
    expect(f.uf).toBe('MG')
    expect(f.cep).toBe('30140-071')
  })

  it('tipo, chave e nome de exibição saem como chegaram', () => {
    const f = montarFichaPessoa({
      tipo: 'originador',
      chave: 'jose da silva',
      nome: 'José da Silva',
      form: FORM_VAZIO,
      anterior: undefined,
    })
    expect(f.tipo).toBe('originador')
    expect(f.nome_chave).toBe('jose da silva')
    expect(f.nome_exibicao).toBe('José da Silva')
  })

  it('a linha tem TODAS as colunas da ficha, e nenhuma a mais', () => {
    // Upsert da linha inteira: coluna que some daqui é coluna que o Salvar deixa
    // de carregar. `atualizado_em` e `atualizado_por` quem põe é a mutação.
    expect(Object.keys(montar({ pix: 'x' })).sort()).toEqual(
      [
        'tipo',
        'nome_chave',
        'nome_exibicao',
        'cpf',
        'rg',
        'representante',
        'banco',
        'agencia',
        'conta',
        'pix',
        'endereco',
        'logradouro',
        'numero',
        'complemento',
        'bairro',
        'cidade',
        'uf',
        'cep',
        'genero',
        'qualificacao_complemento',
      ].sort(),
    )
  })

  it('o formulário não é alterado', () => {
    const form = { ...FORM_VAZIO, pix: ' x ', representante: 'R' }
    const copia = { ...form }
    montarFichaPessoa({ tipo: 'investidor', chave: 'a', nome: 'A', form, anterior: ANTERIOR })
    expect(form).toEqual(copia)
  })
})

describe('chaveDaFicha — o Salvar grava na linha certa', () => {
  it('cadastro novo: a chave sai do nome digitado, normalizado', () => {
    expect(chaveDaFicha({ novo: true, chave: '', nome: '  Maria  da Silva ' })).toBe(
      chaveDaFicha({ novo: true, chave: '', nome: 'maria da silva' }),
    )
  })

  it('ficha existente: a chave é a da linha aberta, mesmo se o nome normalizado for outro', () => {
    // Ficha inserida direto no banco com nome_chave diferente do nome exibido:
    // antes, o Salvar recalculava a chave e criava outra linha, órfã a primeira.
    expect(chaveDaFicha({ novo: false, chave: 'chave-gravada-no-banco', nome: 'Maria da Silva' })).toBe(
      'chave-gravada-no-banco',
    )
  })
})

describe('enderecoDaFicha — a prévia diz o que vai para o contrato', () => {
  const vazio = { logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '', cep: '' }
  it('com endereço antigo e só o CEP novo, mostra o antigo e avisa', () => {
    expect(enderecoDaFicha({ ...vazio, cep: '30140-071' }, 'Rua Antiga, 10')).toEqual({
      texto: 'Rua Antiga, 10',
      mantemAntigo: true,
    })
  })
  it('sem nada novo, o antigo continua (e a tela não precisa avisar: o compilado é vazio)', () => {
    expect(enderecoDaFicha(vazio, 'Rua Antiga, 10')).toEqual({ texto: 'Rua Antiga, 10', mantemAntigo: true })
  })
  it('sem endereço antigo, o compilado vale como está', () => {
    expect(enderecoDaFicha({ ...vazio, cep: '30140-071' }, null).mantemAntigo).toBe(false)
  })
})

// MUDOU DE PROPÓSITO (02/10/2026, onda 2): a ficha do investidor passou a ter os
// campos de gênero e complemento da qualificação. Ver o comentário do topo.
describe('montarFichaPessoa — gênero e qualificação com os campos na tela (investidor)', () => {
  const comTela = (
    paraContrato: { genero: string; qualificacao_complemento: string },
    anterior: Anterior = ANTERIOR,
  ) =>
    montarFichaPessoa({
      tipo: 'investidor',
      chave: 'maria da silva',
      nome: 'Maria da Silva',
      form: { ...FORM_VAZIO, pix: 'maria@x.com' },
      anterior,
      paraContrato,
    })

  it('quem não mexe nos campos grava o que já estava', () => {
    const f = comTela({ genero: 'F', qualificacao_complemento: 'brasileira, casada, médica' })
    expect(f.genero).toBe('F')
    expect(f.qualificacao_complemento).toBe('brasileira, casada, médica')
  })

  it('grava o gênero escolhido, mesmo diferente do anterior', () => {
    expect(comTela({ genero: 'M', qualificacao_complemento: '' }).genero).toBe('M')
  })

  it('"Não informado" sobre um gênero gravado: vazio (null), nunca masculino', () => {
    expect(comTela({ genero: '', qualificacao_complemento: '' }).genero).toBeNull()
  })

  it('vazio continua vazio: null fica null, "" fica ""', () => {
    expect(comTela({ genero: '', qualificacao_complemento: '' }, { ...ANTERIOR, genero: null }).genero).toBeNull()
    expect(comTela({ genero: '', qualificacao_complemento: '' }, { ...ANTERIOR, genero: '' }).genero).toBe('')
    expect(
      comTela({ genero: '', qualificacao_complemento: '' }, { ...ANTERIOR, qualificacao_complemento: '' })
        .qualificacao_complemento,
    ).toBe('')
  })

  it('o banco só aceita M, F ou vazio: outro valor conta como "Não informado"', () => {
    expect(comTela({ genero: 'X', qualificacao_complemento: '' }, { ...ANTERIOR, genero: null }).genero).toBeNull()
    expect(comTela({ genero: 'f', qualificacao_complemento: '' }).genero).toBe('F')
  })

  it('grava o complemento digitado, sem espaço nas pontas', () => {
    expect(comTela({ genero: 'F', qualificacao_complemento: '  solteira, advogada ' }).qualificacao_complemento).toBe(
      'solteira, advogada',
    )
  })

  it('complemento apagado na tela: null', () => {
    expect(comTela({ genero: 'F', qualificacao_complemento: '   ' }).qualificacao_complemento).toBeNull()
  })

  it('cadastro novo com os campos preenchidos grava os dois', () => {
    const f = montarFichaPessoa({
      tipo: 'investidor',
      chave: 'joao souza',
      nome: 'João Souza',
      form: FORM_VAZIO,
      anterior: undefined,
      paraContrato: { genero: 'M', qualificacao_complemento: 'casado, empresário' },
    })
    expect(f.genero).toBe('M')
    expect(f.qualificacao_complemento).toBe('casado, empresário')
  })

  it('cadastro novo com os campos em branco: null', () => {
    const f = montarFichaPessoa({
      tipo: 'investidor',
      chave: 'joao souza',
      nome: 'João Souza',
      form: FORM_VAZIO,
      anterior: undefined,
      paraContrato: { genero: '', qualificacao_complemento: '' },
    })
    expect(f.genero).toBeNull()
    expect(f.qualificacao_complemento).toBeNull()
  })

  it('os campos da tela não mexem no endereço antigo', () => {
    expect(comTela({ genero: 'M', qualificacao_complemento: '' }).endereco).toBe(
      'Rua Antiga, 10, Centro, Barbacena/MG',
    )
  })

  it('SEM os campos na tela (ficha do originador): preserva os dois da ficha', () => {
    const f = montarFichaPessoa({
      tipo: 'originador',
      chave: 'an soberana',
      nome: 'AN Soberana',
      form: { ...FORM_VAZIO, pix: 'x' },
      anterior: ANTERIOR,
    })
    expect(f.genero).toBe('F')
    expect(f.qualificacao_complemento).toBe('brasileira, casada, médica')
  })

  it('a linha continua com todas as colunas, e nenhuma a mais', () => {
    expect(Object.keys(comTela({ genero: 'M', qualificacao_complemento: '' })).sort()).toEqual(
      Object.keys(montar({ pix: 'x' })).sort(),
    )
  })
})
