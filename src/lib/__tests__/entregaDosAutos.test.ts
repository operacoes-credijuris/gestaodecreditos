import { describe, it, expect } from 'vitest'
import {
  buscarNosAutos,
  buscarVarios,
  caminhoDaImagem,
  COMO_LER_OS_AUTOS,
  FORMA_DA_ENTREGA,
  lerPaginas,
  MAX_TERMOS_POR_BUSCA,
  montarEntrega,
  paginasComImagem,
  paginasDoArquivo,
  semTexto,
  termosDaBusca,
  textoDaBusca,
  textoDoArquivo,
  type AutosGuardados,
} from '../../../supabase/functions/_shared/entregaDosAutos.ts'

/**
 * O QUE O CONECTOR ENTREGA quando o Claude vem buscar os autos.
 *
 * A PRIMEIRA VERSÃO ERA PIOR QUE O MÉTODO MANUAL que veio substituir. Quando
 * alguém subia o PDF no Claude, o arquivo ficava FORA da conversa e o modelo
 * abria o que precisava; a ferramenta tentava empurrar tudo PARA DENTRO da
 * janela, e um processo de 341 páginas chegava cortado pelo meio, com um quinto
 * do conteúdo. Estes testes guardam a correção: o material fica inteiro, e a
 * conversa recebe o que cabe mais o caminho para o resto.
 */
const guardado: AutosGuardados = {
  lead_id: 15269795,
  titulo: 'Dr. Gabriel Perin - Kauá Henrique Silva Barros - 5012860-38.2023.4.03.6105 - Honorários contratuais - 30%',
  criado_em: '2026-09-11T03:12:00.000Z',
  arquivos: [
    {
      nome: 'processo.pdf',
      paginas: 3,
      paginasTexto: [
        'PETIÇÃO INICIAL do feito',
        'DESPACHO que defere a CESSÃO de crédito',
        'ALVARÁ de levantamento expedido',
      ],
    },
    { nome: 'requisitorio.pdf', paginas: 1, paginasTexto: ['OFÍCIO REQUISITÓRIO'] },
  ],
}

describe('o formato do que fica guardado', () => {
  // PÁGINA A PÁGINA é o formato de verdade: é o que permite citar a fonte que o
  // roteiro exige em todo campo da ficha.
  it('lê as páginas do formato novo', () => {
    expect(paginasDoArquivo(guardado.arquivos[0])).toHaveLength(3)
    expect(textoDoArquivo(guardado.arquivos[0])).toContain('PETIÇÃO INICIAL')
    expect(textoDoArquivo(guardado.arquivos[0])).toContain('ALVARÁ')
  })

  // O FORMATO ANTIGO AINDA É LIDO: as linhas do balcão duram duas horas, e
  // exigir que as duas pontas subissem no mesmo instante quebraria as que
  // estivessem em voo.
  it('lê o bloco único do formato antigo como uma página', () => {
    const velho = { nome: 'x.pdf', paginas: 9, texto: 'TUDO NUM BLOCO' }
    expect(paginasDoArquivo(velho)).toEqual(['TUDO NUM BLOCO'])
    expect(textoDoArquivo(velho)).toBe('TUDO NUM BLOCO')
  })

  it('arquivo sem texto nenhum não vira página vazia', () => {
    expect(paginasDoArquivo({ nome: 'x.pdf', paginas: 0 })).toEqual([])
  })
})

describe('montarEntrega', () => {
  // A ORDEM É O ARGUMENTO: o método antes do material. O roteiro diz o que fazer
  // com o que vem depois dele, então tem de vir antes.
  it('põe o método antes dos autos', () => {
    const t = montarEntrega(guardado)
    expect(t.indexOf('# PROMPT — Qualificação Jurídica Preliminar')).toBe(0)
    expect(t.indexOf('FORMA DA ENTREGA')).toBeLessThan(t.indexOf('## AUTOS'))
    expect(t.indexOf('## DADOS DO CARD')).toBeLessThan(t.indexOf('## AUTOS'))
  })

  // SEM A INSTRUÇÃO DE COMO LER, a leitura integral da regra [9].7 seria cumprida
  // só na aparência: o modelo leria o que chegou e concluiria.
  it('ensina a buscar o que não veio', () => {
    const t = montarEntrega(guardado)
    expect(t).toContain(COMO_LER_OS_AUTOS)
    expect(t).toContain('ler_paginas')
    expect(t).toContain('buscar_nos_autos')
  })

  it('traz o índice com o tamanho de cada arquivo', () => {
    const t = montarEntrega(guardado)
    expect(t).toContain('## ÍNDICE DOS ARQUIVOS')
    expect(t).toContain('processo.pdf')
    expect(t).toContain('requisitorio.pdf')
  })

  it('entrega inteiros os arquivos que cabem', () => {
    const t = montarEntrega(guardado)
    expect(t).toContain('=== ARQUIVO: processo.pdf (3 páginas) ===')
    expect(t).toContain('ALVARÁ de levantamento expedido')
    expect(t).toContain('OFÍCIO REQUISITÓRIO')
  })

  /**
   * O QUE NÃO CABE NÃO É MUTILADO — é anunciado.
   *
   * Antes, o arquivo grande vinha cortado pelo meio com um marcador no miolo:
   * quem lesse a primeira metade e concluísse nunca passava pelo aviso. Agora ele
   * não vem, aparece no índice com o tamanho e o modelo recebe a ordem de ir
   * buscá-lo.
   */
  it('o arquivo que não cabe fica de fora inteiro, e é anunciado', () => {
    const t = montarEntrega(guardado, undefined, 30)
    expect(t).toContain('**não veio — leia com `ler_paginas`**')
    expect(t).toContain('não vieram nesta mensagem por tamanho')
    expect(t).not.toContain('PETIÇÃO INICIAL do feito')
    // E o índice continua dizendo que ele existe e quanto tem.
    expect(t).toContain('processo.pdf')
  })

  // ARQUIVO PEQUENO ATRÁS DE UM GRANDE CONTINUA ENTRANDO: o grande é pulado, não
  // é cortado, então o orçamento que ele não usou fica para os seguintes.
  it('o arquivo grande não come o pequeno', () => {
    const t = montarEntrega(guardado, undefined, 40)
    expect(t).not.toContain('DESPACHO que defere')
    expect(t).toContain('OFÍCIO REQUISITÓRIO')
  })

  it('cabendo tudo, não há aviso de falta', () => {
    const t = montarEntrega(guardado)
    expect(t).not.toContain('não vieram nesta mensagem')
    expect(t).toContain('veio inteira nesta mensagem')
  })

  // CADASTRO NÃO É PROVA, e o texto tem de dizer isso: o roteiro exige documento
  // e página para cada campo da ficha, e o título do card é o que o comercial
  // escreveu.
  it('rotula o título do card como cadastro, não como fonte', () => {
    const t = montarEntrega(guardado)
    expect(t).toContain('NÃO é fonte documental')
    expect(t).toContain(guardado.titulo)
    expect(t).toContain('divergência entre o card e os autos')
  })

  it('sem título, o card não finge ter um', () => {
    expect(montarEntrega({ ...guardado, titulo: '' })).toContain('(card sem título)')
  })

  /**
   * O ROTEIRO É EDITÁVEL PELA OPERAÇÃO, e o padrão do repositório é o CHÃO.
   *
   * Quem edita está num campo de texto, e um salvamento em branco não pode
   * significar uma análise sem método — sairia uma redação convincente sem ficha,
   * sem eixos e sem regra de ancoragem, que é a pior forma de errar aqui.
   */
  it('usa o roteiro que a operação editou', () => {
    const t = montarEntrega(guardado, '# ROTEIRO NOVO DA CASA')
    expect(t.indexOf('# ROTEIRO NOVO DA CASA')).toBe(0)
    expect(t).not.toContain('# PROMPT — Qualificação Jurídica Preliminar')
    expect(t).toContain('OFÍCIO REQUISITÓRIO')
  })

  it('roteiro vazio ou em branco cai no padrão do sistema', () => {
    for (const vazio of ['', '   ', '\n\n']) {
      expect(montarEntrega(guardado, vazio), JSON.stringify(vazio)).toContain(
        '# PROMPT — Qualificação Jurídica Preliminar',
      )
    }
  })
})

describe('lerPaginas', () => {
  it('devolve o intervalo pedido, com o número de cada página', () => {
    const t = lerPaginas(guardado, 'processo.pdf', 2, 3)
    expect(t).toContain('processo.pdf — páginas 2 a 3 de 3')
    expect(t).toContain('--- página 2 ---')
    expect(t).toContain('DESPACHO que defere')
    expect(t).toContain('ALVARÁ')
    expect(t).not.toContain('PETIÇÃO INICIAL')
  })

  // O NOME VEM DIGITADO PELO MODELO, de memória: acento e caixa não podem
  // quebrar, e a posição no índice é a saída quando o nome é feio.
  it('acha o arquivo pela posição e por parte do nome', () => {
    expect(lerPaginas(guardado, '2', 1, 1)).toContain('OFÍCIO REQUISITÓRIO')
    expect(lerPaginas(guardado, 'REQUISITORIO', 1, 1)).toContain('OFÍCIO REQUISITÓRIO')
  })

  // ARQUIVO QUE NÃO EXISTE DEVOLVE A LISTA, e não um "não achei" seco: o modelo
  // erra o nome e precisa do certo para tentar de novo.
  it('arquivo inexistente devolve os nomes que existem', () => {
    const t = lerPaginas(guardado, 'contrato.pdf', 1, 1)
    expect(t).toContain('Não há arquivo')
    expect(t).toContain('1. processo.pdf')
    expect(t).toContain('2. requisitorio.pdf')
  })

  it('página além do fim diz quantas existem', () => {
    expect(lerPaginas(guardado, 'processo.pdf', 99, 100)).toContain('tem 3 páginas')
  })
})

describe('buscarNosAutos', () => {
  /**
   * É O CAMINHO DOS EIXOS DE VARREDURA. O Eixo 2 é literalmente uma lista de
   * termos, e o Eixo 7 outra; sem isto, cumpri-los num processo de trezentas
   * páginas exigia despejar o processo inteiro para achar três parágrafos.
   */
  it('acha o termo e devolve a página', () => {
    const achados = buscarNosAutos(guardado, 'cessão')
    expect(achados).toHaveLength(1)
    expect(achados[0].arquivo).toBe('processo.pdf')
    expect(achados[0].pagina).toBe(2)
    expect(achados[0].trecho).toContain('DESPACHO')
  })

  it('acento e caixa não atrapalham', () => {
    expect(buscarNosAutos(guardado, 'CESSAO')).toHaveLength(1)
    expect(buscarNosAutos(guardado, 'alvara')[0].pagina).toBe(3)
  })

  it('termo vazio não procura nada', () => {
    expect(buscarNosAutos(guardado, '   ')).toEqual([])
  })

  /**
   * AUSÊNCIA É RESPOSTA VÁLIDA e o roteiro depende dela — o Eixo 2 exige a
   * declaração expressa de que nada foi localizado. Mas ela vale sobre o TEXTO:
   * página digitalizada não tem texto para procurar, e dizer só "não achei"
   * convidaria a análise a afirmar uma inexistência que ela não verificou.
   */
  it('não achando, ressalva o processo digitalizado', () => {
    const t = textoDaBusca(guardado, 'penhora')
    expect(t).toContain('nenhuma ocorrência no texto')
    expect(t).toContain('digitalizada não tem texto')
  })

  it('achando, escreve arquivo e página', () => {
    const t = textoDaBusca(guardado, 'alvará')
    expect(t).toContain('1 ocorrência(s)')
    expect(t).toContain('processo.pdf — página 3')
  })
})

/**
 * VÁRIOS TERMOS NUMA CHAMADA SÓ, e o motivo não é economia de código.
 *
 * Cada chamada de ferramenta pede autorização a quem está na conversa. A
 * primeira versão desta busca dizia, na própria descrição, "um termo por
 * chamada" — e como o Eixo 2 do roteiro é uma lista de termos, a varredura
 * virava uma fila de dez pedidos de permissão para a mesma operação. Quem opera
 * cansa antes do fim, e parar no meio de uma varredura é exatamente o que a
 * análise não pode fazer.
 */
describe('busca em lote', () => {
  it('a lista inteira do eixo vai numa chamada só', () => {
    const t = textoDaBusca(guardado, ['cessão', 'penhora', 'alvará'])
    expect(t).toContain('3 termo(s)')
    expect(t).toContain('"cessão" — 1 ocorrência(s)')
    expect(t).toContain('"penhora" — nenhuma ocorrência')
    expect(t).toContain('"alvará" — 1 ocorrência(s)')
  })

  it('o que não achou é nomeado, e não some entre os que acharam', () => {
    const t = textoDaBusca(guardado, ['cessão', 'penhora'])
    expect(t).toContain('Sem ocorrência no texto:** "penhora"')
    expect(t).toContain('digitalizada não tem texto')
  })

  // O modelo pode mandar a lista numa string só. Separar demais erra para o
  // lado seguro: termo partido procura MAIS, não menos, e o cabeçalho de cada
  // bloco diz o que de fato foi procurado.
  it('vírgula e ponto e vírgula também separam', () => {
    expect(termosDaBusca('cessão, cessionário; habilitação')).toEqual([
      'cessão',
      'cessionário',
      'habilitação',
    ])
  })

  it('termo repetido não vira duas buscas', () => {
    expect(termosDaBusca(['Cessão', 'CESSAO', 'cessão'])).toEqual(['Cessão'])
  })

  it('vazio não procura nada', () => {
    expect(termosDaBusca('  ,  ; ')).toEqual([])
    expect(textoDaBusca(guardado, [])).toContain('Nenhum termo para procurar')
  })

  it('a lista tem teto', () => {
    const muitos = Array.from({ length: 40 }, (_, i) => `termo ${i}`)
    expect(termosDaBusca(muitos)).toHaveLength(MAX_TERMOS_POR_BUSCA)
  })

  it('buscarVarios devolve um resultado por termo, na ordem pedida', () => {
    const r = buscarVarios(guardado, ['alvará', 'cessão'])
    expect(r.map((x) => x.termo)).toEqual(['alvará', 'cessão'])
    expect(r[0].ocorrencias[0].pagina).toBe(3)
    expect(r[1].ocorrencias[0].pagina).toBe(2)
  })
})

/**
 * O ARQUIVO SEM TEXTO — a correção mais importante desta entrega.
 *
 * Dezenove anexos no card, dezessete na análise. Um acórdão e um ofício vinham
 * escaneados; o pdf.js não tira texto de imagem, e eles eram DESCARTADOS antes
 * de chegar ao balcão. A análise saía inteira na aparência e declarava, com as
 * palavras que o roteiro exige, que nada fora localizado — sem ter aberto os
 * dois documentos que poderiam dizer o contrário.
 *
 * Um arquivo que o modelo SABE que não leu vale mais do que um que ele não sabe
 * que existe.
 */
const comDigitalizado: AutosGuardados = {
  ...guardado,
  arquivos: [
    ...guardado.arquivos,
    {
      nome: 'acordao.pdf',
      paginas: 12,
      paginasTexto: [],
      motivo: 'digitalizado (sem camada de texto)',
      imagensPrevistas: [1, 2, 11, 12],
      imagens: [{ pagina: 1, caminho: 'u1/c1/autos/02-acordao-p0001.jpg' }],
    },
    {
      nome: 'oficio.pdf',
      paginas: 0,
      paginasTexto: [],
      motivo: 'não consegui ler: HTTP 404 ao baixar do Kommo',
    },
  ],
}

describe('arquivo sem texto', () => {
  it('o digitalizado aparece no índice, apontando para ver_paginas', () => {
    const t = montarEntrega(comDigitalizado)
    expect(t).toContain('acordao.pdf')
    expect(t).toContain('ver_paginas')
    expect(t).toContain('4 pág. em imagem')
  })

  it('o que não tem texto nem imagem é NÃO LIDO, e vira diligência', () => {
    const t = montarEntrega(comDigitalizado)
    expect(t).toContain('**NÃO LIDO — não consegui ler: HTTP 404 ao baixar do Kommo**')
    expect(t).toContain('trate como diligência')
    expect(t).toContain('não como documento inexistente')
  })

  // A REGRA QUE FECHA O BURACO: o roteiro pede declaração expressa de ausência,
  // e ela vale sobre o que foi lido. Sem esta linha, "não há cessão nos autos"
  // sairia de uma varredura que nunca passou pelo acórdão.
  it('proíbe declarar ausência do que não foi aberto', () => {
    expect(COMO_LER_OS_AUTOS).toContain('NÃO DECLARE AUSÊNCIA DO QUE VOCÊ NÃO ABRIU')
    expect(montarEntrega(comDigitalizado)).toContain('nada que dependa desses documentos está verificado')
  })

  it('lerPaginas manda ver o que é para ver', () => {
    const t = lerPaginas(comDigitalizado, 'acordao.pdf', 1, 5)
    expect(t).toContain('é digitalizado')
    expect(t).toContain('ver_paginas')
  })

  it('lerPaginas não finge que o ilegível é vazio', () => {
    const t = lerPaginas(comDigitalizado, 'oficio.pdf', 1, 5)
    expect(t).toContain('HTTP 404')
    expect(t).toContain('NÃO LIDO')
  })

  // A BUSCA É CEGA NO QUE ESTÁ EM IMAGEM, e calar isso seria apoiar a declaração
  // de ausência do Eixo 2 numa varredura que não passou por dois documentos.
  it('a busca declara sua própria cegueira', () => {
    const t = textoDaBusca(comDigitalizado, 'penhora')
    expect(t).toContain('2 arquivo(s) deste crédito são digitalizados')
    expect(t).toContain('"acordao.pdf"')
    expect(t).toContain('"oficio.pdf"')
  })

  it('achando o termo, não há por que alarmar', () => {
    expect(textoDaBusca(comDigitalizado, 'cessão')).not.toContain('são digitalizados e esta busca')
  })

  /**
   * AS PROMETIDAS CONTAM. O texto é depositado em segundos e as imagens levam o
   * tempo da rasterização no navegador; se o índice anunciasse só o que já
   * chegou, a primeira entrega diria que o acórdão é ilegível.
   */
  it('conta as páginas prontas e as a caminho, sem repetir', () => {
    expect(paginasComImagem(comDigitalizado.arquivos[2])).toEqual([1, 2, 11, 12])
    expect(paginasComImagem(comDigitalizado.arquivos[3])).toEqual([])
  })

  it('o caminho só existe para a página que já subiu', () => {
    expect(caminhoDaImagem(comDigitalizado.arquivos[2], 1)).toBe('u1/c1/autos/02-acordao-p0001.jpg')
    expect(caminhoDaImagem(comDigitalizado.arquivos[2], 2)).toBeUndefined()
  })

  // O HIBRIDO E O CASO QUE MAIS ENGANA: arquivo nato-digital com a conta da
  // contadoria escaneada no meio. Ele chega inteiro e parece lido, e a folha que
  // decide o preco esta numa pagina que o texto nao alcanca.
  it('o hibrido avisa a pagina escaneada mesmo tendo vindo inteiro', () => {
    const hibrido: AutosGuardados = {
      ...guardado,
      arquivos: [{ ...guardado.arquivos[0], imagensPrevistas: [2] }],
    }
    const t = montarEntrega(hibrido)
    expect(t).toContain('veio inteira nesta mensagem · 1 pág. escaneada(s)')
    expect(t).toContain('ver_paginas')
  })

  it('semTexto separa o que se lê do que se vê', () => {
    expect(semTexto(comDigitalizado.arquivos[0])).toBe(false)
    expect(semTexto(comDigitalizado.arquivos[2])).toBe(true)
  })
})

describe('FORMA_DA_ENTREGA', () => {
  /**
   * A ANÁLISE É A RESPOSTA, NÃO O ANEXO DELA.
   *
   * A conversa nasce no Cowork, que é superfície de trabalho: deixada à própria
   * sorte, ela produz arquivo. Aí o que a operação precisa ler fica a um
   * download de distância — fora do histórico da conversa e fora do que se cola
   * numa nota do Kommo.
   */
  it('manda escrever na própria resposta e proíbe gerar arquivo', () => {
    expect(FORMA_DA_ENTREGA).toContain('NA PRÓPRIA RESPOSTA')
    expect(FORMA_DA_ENTREGA).toMatch(/Não crie arquivo, documento, planilha, artefato nem anexo/)
    expect(FORMA_DA_ENTREGA).toContain('A resposta é o entregável.')
  })

  // Proibir o arquivo sem dizer onde as tabelas vão convidaria a resposta a
  // abandoná-las — e elas são metade do roteiro.
  it('diz onde as tabelas do roteiro devem sair', () => {
    expect(FORMA_DA_ENTREGA).toContain('Markdown')
    expect(FORMA_DA_ENTREGA).toContain('Eixo 2')
    expect(FORMA_DA_ENTREGA).toContain('Eixo 7')
  })

  it('vai junto na entrega', () => {
    expect(montarEntrega(guardado)).toContain(FORMA_DA_ENTREGA)
  })
})
