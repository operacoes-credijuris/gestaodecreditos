/**
 * O QUE CHEGA PELO CALLBACK DO ESCAVADOR.
 *
 * O formato do evento de atualização de processo NÃO está documentado — a
 * documentação descreve o mecanismo (URL no painel, token no header
 * Authorization, retentativas) e mostra o corpo de um callback de monitoramento.
 * Por isso a função não confia no corpo: ela extrai o número do processo, que
 * tem forma inconfundível, e pergunta à API qual é o estado de verdade.
 *
 * Estes testes protegem justamente essa leitura tolerante, e a idempotência —
 * que é o que impede um reenvio de baixar os mesmos PDFs de novo, cada um
 * podendo custar.
 */
import { describe, it, expect } from 'vitest'
import {
  caminhoDoDocumento,
  chaveDoEvento,
  cnjDoEvento,
  documentosDaLista,
  nomeDoEvento,
  pedidoBemSucedido,
  pedidoEncerrado,
} from '../../../supabase/functions/_shared/autosDoEscavador.ts'

describe('cnjDoEvento', () => {
  const cnj = '8015250-24.2020.8.05.0000'

  // VARRE O CORPO INTEIRO: o campo pode se chamar de qualquer coisa e vir em
  // qualquer profundidade; a forma do número é que não muda.
  it('acha o processo em qualquer lugar do corpo', () => {
    expect(cnjDoEvento({ numero_cnj: cnj })).toBe(cnj)
    expect(cnjDoEvento({ event: 'x', event_data: { processo: { numero: cnj } } })).toBe(cnj)
    expect(cnjDoEvento({ a: [{ b: { c: `Processo ${cnj} atualizado` } }] })).toBe(cnj)
    expect(cnjDoEvento(JSON.stringify({ numero_cnj: cnj }))).toBe(cnj)
  })

  it('não inventa processo onde não há', () => {
    expect(cnjDoEvento({ event: 'update_time' })).toBeNull()
    expect(cnjDoEvento({})).toBeNull()
    expect(cnjDoEvento(null)).toBeNull()
    // Número que não é CNJ não vira CNJ por parecer comprido.
    expect(cnjDoEvento({ id: 8015250242020805 })).toBeNull()
  })
})

/**
 * REENVIO NÃO PODE VIRAR DOWNLOAD DOBRADO. O Escavador reenvia o que não recebeu
 * confirmação — o endpoint de listagem mostra `attempts` e `next_run_at`.
 */
describe('chaveDoEvento', () => {
  it('usa o uuid do evento quando ele vem', () => {
    expect(chaveDoEvento({ uuid: '027efc36e537d8f9b89c73869b69c941' }))
      .toBe('027efc36e537d8f9b89c73869b69c941')
    expect(chaveDoEvento({ id: 42 })).toBe('42')
  })

  // SEM UUID, A CHAVE SAI DO CONTEÚDO — e tem de ser a mesma para o mesmo corpo,
  // senão a idempotência não existe. Hash do conteúdo, nunca do relógio.
  it('sem uuid, o mesmo corpo dá sempre a mesma chave', () => {
    const corpo = { event: 'atualizacao', numero_cnj: '8015250-24.2020.8.05.0000' }
    expect(chaveDoEvento(corpo)).toBe(chaveDoEvento({ ...corpo }))
    expect(chaveDoEvento(corpo)).toMatch(/^sem-uuid-[0-9a-f]{8}$/)
  })

  it('corpos diferentes não colidem', () => {
    expect(chaveDoEvento({ a: 1 })).not.toBe(chaveDoEvento({ a: 2 }))
  })
})

describe('o estado do pedido', () => {
  it('só PENDENTE é espera', () => {
    expect(pedidoEncerrado('PENDENTE')).toBe(false)
    expect(pedidoEncerrado('SUCESSO')).toBe(true)
    expect(pedidoEncerrado('ERRO')).toBe(true)
    expect(pedidoEncerrado('NAO_ENCONTRADO')).toBe(true)
    // Estado ausente é espera, não conclusão: concluir por omissão daria o
    // processo por lido sem nenhum documento.
    expect(pedidoEncerrado('')).toBe(false)
    expect(pedidoEncerrado(null)).toBe(false)
  })

  it('só SUCESSO manda buscar documento', () => {
    expect(pedidoBemSucedido('SUCESSO')).toBe(true)
    expect(pedidoBemSucedido('sucesso')).toBe(true)
    expect(pedidoBemSucedido('NAO_ENCONTRADO')).toBe(false)
    expect(pedidoBemSucedido('PENDENTE')).toBe(false)
  })
})

describe('documentosDaLista', () => {
  it('lê a lista do jeito que o Escavador a devolve', () => {
    const corpo = {
      items: [
        { key: 'abc123', nome: 'Petição inicial', tipo: 'PETICAO' },
        { key: 'def456', tipo: 'SENTENCA' },
      ],
    }
    expect(documentosDaLista(corpo)).toEqual([
      { chave: 'abc123', nome: 'Petição inicial', tipo: 'PETICAO' },
      { chave: 'def456', nome: 'SENTENCA', tipo: 'SENTENCA' },
    ])
  })

  // SEM CHAVE NÃO HÁ DOWNLOAD: o item é descartado, porque guardá-lo criaria
  // uma linha que nunca vira arquivo.
  it('descarta item sem chave e não repete chave', () => {
    const corpo = {
      items: [{ nome: 'sem chave' }, { key: 'x' }, { key: 'x', nome: 'repetida' }],
    }
    expect(documentosDaLista(corpo).map((d) => d.chave)).toEqual(['x'])
  })

  it('lista vazia, ou resposta que não é lista, não quebra', () => {
    expect(documentosDaLista({ items: [] })).toEqual([])
    expect(documentosDaLista({})).toEqual([])
    expect(documentosDaLista(null)).toEqual([])
    expect(documentosDaLista('erro')).toEqual([])
  })

  it('documento sem nome guarda a chave como nome', () => {
    expect(documentosDaLista({ items: [{ key: 'só-a-chave' }] })[0].nome).toBe('só-a-chave')
  })
})

/**
 * O CAMINHO SAI DA CHAVE, não do nome: nome se repete ("Petição" aparece oito
 * vezes num processo) e vem com barra, acento e espaço — e barra em nome de
 * objeto cria pasta onde não devia.
 */
describe('caminhoDoDocumento', () => {
  it('é o processo e a chave', () => {
    expect(caminhoDoDocumento('8015250-24.2020.8.05.0000', 'abc123'))
      .toBe('8015250-24.2020.8.05.0000/abc123.pdf')
  })

  it('não deixa a chave criar pasta nem sair da do processo', () => {
    const caminho = caminhoDoDocumento('8015250-24.2020.8.05.0000', '../../segredo/x')
    expect(caminho.startsWith('8015250-24.2020.8.05.0000/')).toBe(true)
    expect(caminho).not.toContain('..')
    expect(caminho.split('/')).toHaveLength(2)
  })

  it('o processo entra só com o que é número do processo', () => {
    expect(caminhoDoDocumento('  8015250-24.2020.8.05.0000 ', 'k'))
      .toBe('8015250-24.2020.8.05.0000/k.pdf')
  })
})

describe('nomeDoEvento', () => {
  it('registra o nome quando ele se apresenta', () => {
    expect(nomeDoEvento({ event: 'novo_processo' })).toBe('novo_processo')
    expect(nomeDoEvento({ resultado: { event: 'update_time' } })).toBe('update_time')
    expect(nomeDoEvento({})).toBeNull()
  })
})
