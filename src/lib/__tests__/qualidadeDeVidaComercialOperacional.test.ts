import { describe, it, expect } from 'vitest'
import { escolhaLembrada, lerEscolha } from '../lembrarNaTela'
import { gravarPreferencia, type Armazenamento } from '../preferencias'
import { textoDaFicha } from '../dadosCadastrais'
import {
  apagarRascunhoDaPeticao,
  gravarRascunhoDaPeticao,
  lerRascunhoDaPeticao,
  VALIDADE_DO_RASCUNHO_MS,
} from '../rascunhoDaPeticao'
import { tarefaAlterada, type FormularioDaTarefa } from '../formularioDaTarefa'

/**
 * Revisão de qualidade de vida (03/10/2026) no Comercial e no Operacional. As
 * regras puras por trás de "a tela lembra a última escolha", "copiar dados da
 * ficha", "o rascunho da petição" e "a data da tarefa abre em hoje". Nenhuma
 * grava no banco.
 */

/** Um localStorage de mentira, com a opção de quebrar como o de verdade quebra. */
function armazenamento(quebrado = false): Armazenamento & { dados: Map<string, string> } {
  const dados = new Map<string, string>()
  const falha = () => {
    throw new Error('bloqueado')
  }
  return {
    dados,
    getItem: (k) => (quebrado ? falha() : (dados.get(k) ?? null)),
    setItem: (k, v) => (quebrado ? falha() : void dados.set(k, v)),
    removeItem: (k) => (quebrado ? falha() : void dados.delete(k)),
  }
}

describe('escolhaLembrada — a tela lembra só o que ainda existe', () => {
  const STATUS = ['ativo', 'complementar', 'encerrado', 'todos'] as const

  it('devolve o valor guardado quando ele é uma das escolhas', () => {
    expect(escolhaLembrada('encerrado', STATUS, 'ativo')).toBe('encerrado')
  })

  it('valor que saiu da tela, de outro tipo ou ausente volta ao padrão', () => {
    // Um filtro de uma versão antiga: o seletor não pode abrir numa opção que não existe.
    expect(escolhaLembrada('liquidado', STATUS, 'ativo')).toBe('ativo')
    expect(escolhaLembrada(3, STATUS, 'ativo')).toBe('ativo')
    expect(escolhaLembrada(null, STATUS, 'ativo')).toBe('ativo')
    expect(escolhaLembrada(undefined, STATUS, 'ativo')).toBe('ativo')
  })

  it('lê do armazenamento, e sem armazenamento a tela abre no padrão', () => {
    const a = armazenamento()
    gravarPreferencia('tela.teste', 'todos', a)
    expect(lerEscolha('tela.teste', STATUS, 'ativo', a)).toBe('todos')
    expect(lerEscolha('tela.outra', STATUS, 'ativo', a)).toBe('ativo')
    expect(lerEscolha('tela.teste', STATUS, 'ativo', armazenamento(true))).toBe('ativo')
    expect(lerEscolha('tela.teste', STATUS, 'ativo', null)).toBe('ativo')
  })
})

describe('textoDaFicha — "Copiar dados" da ficha', () => {
  it('um campo por linha, rotulado, sem as linhas vazias', () => {
    expect(
      textoDaFicha({
        nome: 'José da Silva ',
        cpf: '529.982.247-25',
        rg: '',
        banco: 'Banco do Brasil',
        agencia: '1234-5',
        conta: '67890-1',
        pix: '  ',
        endereco: 'Rua A, nº 1, Goiânia/GO, CEP 74000-000',
      }),
    ).toBe(
      [
        'Nome: José da Silva',
        'CPF: 529.982.247-25',
        'Banco: Banco do Brasil',
        'Agência: 1234-5',
        'Conta: 67890-1',
        'Endereço: Rua A, nº 1, Goiânia/GO, CEP 74000-000',
      ].join('\n'),
    )
  })

  it('com CNPJ, os rótulos seguem a tela: representante e o RG dele', () => {
    const t = textoDaFicha({
      nome: 'Acme Ltda',
      cpf: '11.222.333/0001-81',
      representante: 'Fulano de Tal',
      rg: '123',
    })
    expect(t).toContain('CNPJ: 11.222.333/0001-81')
    expect(t).toContain('Representante legal: Fulano de Tal')
    expect(t).toContain('RG do representante: 123')
  })

  it('o representante só sai em CNPJ (em CPF ele não é campo da ficha)', () => {
    expect(textoDaFicha({ nome: 'A', cpf: '529.982.247-25', representante: 'X' })).not.toContain(
      'Representante',
    )
  })

  it('só o nome não é o que copiar', () => {
    expect(textoDaFicha({ nome: 'Fulano' })).toBe('')
  })
})

describe('rascunho da petição de IA', () => {
  const agora = 1_000_000_000_000
  const rascunho = {
    instrucao: 'peça o sequestro',
    redacao: { titulo: 'Pedido de sequestro', texto: 'EXCELENTÍSSIMO…', avisos: ['recuo'] },
    textoIA: 'EXCELENTÍSSIMO… (revisado)',
  }

  it('guarda e devolve por tarefa — nunca o de outra', () => {
    const a = armazenamento()
    gravarRascunhoDaPeticao('101', rascunho, agora, a)
    const lido = lerRascunhoDaPeticao('101', agora + 1000, a)
    expect(lido?.textoIA).toBe(rascunho.textoIA)
    expect(lido?.redacao?.titulo).toBe('Pedido de sequestro')
    expect(lido?.redacao?.avisos).toEqual(['recuo'])
    expect(lerRascunhoDaPeticao('102', agora, a)).toBeNull()
  })

  it('sem tarefa (aberta pelo assistente) não há rascunho', () => {
    const a = armazenamento()
    gravarRascunhoDaPeticao(null, rascunho, agora, a)
    expect(a.dados.size).toBe(0)
    expect(lerRascunhoDaPeticao(null, agora, a)).toBeNull()
  })

  it('vence em 7 dias, e o vencido sai do armazenamento', () => {
    const a = armazenamento()
    gravarRascunhoDaPeticao('101', rascunho, agora, a)
    expect(lerRascunhoDaPeticao('101', agora + VALIDADE_DO_RASCUNHO_MS + 1, a)).toBeNull()
    expect(a.dados.size).toBe(0)
  })

  it('apagar esquece; forma errada ou vazio é como se não houvesse', () => {
    const a = armazenamento()
    gravarRascunhoDaPeticao('101', rascunho, agora, a)
    apagarRascunhoDaPeticao('101', a)
    expect(lerRascunhoDaPeticao('101', agora, a)).toBeNull()

    a.setItem('credijuris.peticao.rascunho.7', '{"instrucao": 3}')
    expect(lerRascunhoDaPeticao('7', agora, a)).toBeNull()
    a.setItem('credijuris.peticao.rascunho.8', 'não é json')
    expect(lerRascunhoDaPeticao('8', agora, a)).toBeNull()
    gravarRascunhoDaPeticao('9', { instrucao: ' ', redacao: null, textoIA: '' }, agora, a)
    expect(lerRascunhoDaPeticao('9', agora, a)).toBeNull()
  })

  it('armazenamento bloqueado não quebra a janela', () => {
    const a = armazenamento(true)
    expect(() => gravarRascunhoDaPeticao('101', rascunho, agora, a)).not.toThrow()
    expect(lerRascunhoDaPeticao('101', agora, a)).toBeNull()
    expect(() => apagarRascunhoDaPeticao('101', a)).not.toThrow()
  })
})

describe('Nova tarefa — a data que abre em hoje não conta como alteração', () => {
  const vazio: FormularioDaTarefa = {
    lawsuit_id: null,
    tasks_id: '',
    start_date: '',
    date_deadline: '',
    from: '',
    guests: [],
    important: false,
    urgent: false,
    comments: '',
  }
  const op = { processoInicial: null, escolheRemetente: false, dataInicial: '2026-10-03' }

  it('a data de hoje, posta pela tela, não pergunta "Descartar alterações?"', () => {
    expect(tarefaAlterada({ ...vazio, start_date: '2026-10-03' }, op)).toBe(false)
  })

  it('trocar ou apagar a data conta', () => {
    expect(tarefaAlterada({ ...vazio, start_date: '2026-10-10' }, op)).toBe(true)
    expect(tarefaAlterada({ ...vazio, start_date: '' }, op)).toBe(true)
  })
})
