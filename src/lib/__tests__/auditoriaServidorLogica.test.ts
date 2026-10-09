/**
 * AUDITORIA DE BUGS DAS EDGE FUNCTIONS (09/10/2026) — a lógica pura de cada
 * correção. Cada bloco falharia contra o código de antes (o módulo novo não
 * existia, ou a função devolvia o resultado errado descrito no nome do teste).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { lerTodasAsLinhas, orfas, ultimaPorId } from '../../../supabase/functions/_shared/leituraPaginada'
import { itemEDoPedido, pedidoCobreAReserva } from '../../../supabase/functions/_shared/reservaBullai'
import { podeTrocarCredenciais } from '../../../supabase/functions/_shared/contaMestra'
import { paginarAdvbox } from '../../../supabase/functions/_shared/paginacaoAdvbox'
import { dataDoAdvbox } from '../../../supabase/functions/_shared/dataDoAdvbox'
import { cidadeSemUf } from '../../../supabase/functions/_shared/certidoesNaPlanilha'
import { MAX_PROCESSOS, normalizarProcessos } from '../../../supabase/functions/_shared/processosDoCredito'
import { tempoDaTentativa } from '../../../supabase/functions/_shared/autosJuntos'
import { processosDoEnvolvido } from '../../../supabase/functions/_shared/escavador'
import { conclusaoDoRelatorio, seloDaClassificacao } from '../../../supabase/functions/_shared/seloDoCredor'
import { estourouOTempo, tempoAteOTeto } from '../../../supabase/functions/_shared/relogioDaInvocacao'
import { dataPorExtenso, diaMesAno } from '../../../supabase/functions/_shared/dataDeBrasilia'
import { pastaQueFica } from '../../../supabase/functions/_shared/pastaDuplicada'

// ------------------------------------------------------------ espelho do Kommo
describe('leituraPaginada (kommo-sync, carteira-resumo)', () => {
  const tabela = Array.from({ length: 2350 }, (_, i) => ({ id: i + 1 }))
  const pagina = (de: number, ate: number) =>
    Promise.resolve({ data: tabela.slice(de, ate + 1), error: null })

  it('lê além das 1000 linhas que o PostgREST devolve por resposta', async () => {
    const r = await lerTodasAsLinhas(pagina)
    expect(r.linhas).toHaveLength(2350)
    expect(r.erro).toBeNull()
    expect(r.cortada).toBe(false)
  })
  it('erro no meio volta como erro, com o que veio antes', async () => {
    let n = 0
    const r = await lerTodasAsLinhas((de, ate) =>
      Promise.resolve(n++ === 1 ? { data: null, error: { message: 'timeout' } } : { data: tabela.slice(de, ate + 1), error: null }),
    )
    expect(r.erro).toBe('timeout')
    expect(r.linhas).toHaveLength(1000)
  })
  it('bater no teto de páginas é leitura cortada', async () => {
    const r = await lerTodasAsLinhas(pagina, { maxPaginas: 2 })
    expect(r.cortada).toBe(true)
  })
  it('órfãs só com o espelho lido inteiro — cortado em 1000, nada é órfão', () => {
    const espelho = { linhas: [1, 2, 3], erro: null, cortada: false }
    expect(orfas([2, 9, 9], espelho)).toEqual([9])
    expect(orfas([2, 9], { ...espelho, cortada: true })).toEqual([])
    expect(orfas([2, 9], { ...espelho, erro: 'x' })).toEqual([])
    expect(orfas([2, 9], { ...espelho, linhas: [] })).toEqual([])
  })
  it('o card lido em dois funis vira UMA linha (a última leitura)', () => {
    const r = ultimaPorId([{ id: 1, f: 'a' }, { id: 2, f: 'a' }, { id: 1, f: 'b' }])
    expect(r).toHaveLength(2)
    expect(r.find((x) => x.id === 1)?.f).toBe('b')
  })
})

// ------------------------------------------------------------ BullAI
describe('reservaBullai: pedido velho x item pedido de novo', () => {
  const item = { id: 'X', atualizado_em: '2026-10-09T15:00:00Z' }
  it('pedido ANTERIOR à reserva não a cobre (a reserva vencida é liberada)', () => {
    expect(pedidoCobreAReserva({ portais: { p: ['X'] }, criado_em: '2026-10-01T10:00:00Z' }, item)).toBe(false)
  })
  it('pedido criado depois da reserva cobre (o job saiu e não foi ligado)', () => {
    expect(pedidoCobreAReserva({ portais: { p: ['X'] }, criado_em: '2026-10-09T15:00:05Z' }, item)).toBe(true)
    // folga de relógio entre a função e o banco
    expect(pedidoCobreAReserva({ portais: { p: ['X'] }, criado_em: '2026-10-09T14:59:30Z' }, item)).toBe(true)
  })
  it('pedido sem o item não cobre; sem data, fica a regra antiga (cobre)', () => {
    expect(pedidoCobreAReserva({ portais: { p: ['Y'] }, criado_em: '2026-10-09T16:00:00Z' }, item)).toBe(false)
    expect(pedidoCobreAReserva({ portais: { p: ['X'] }, criado_em: null }, item)).toBe(true)
  })
  it('o resultado do job A não é mais do item que já está no job B', () => {
    expect(itemEDoPedido('B', 'A')).toBe(false)
    expect(itemEDoPedido('A', 'A')).toBe(true)
    expect(itemEDoPedido(null, 'A')).toBe(true)
    expect(itemEDoPedido('reserva:123', 'A')).toBe(true)
  })
})

// ------------------------------------------------------------ admin
describe('contaMestra', () => {
  it('admin comum não troca e-mail/senha da conta-mestra', () => {
    expect(podeTrocarCredenciais('admin@credijuris.com', 'contato@credijuris.com')).toBe(false)
    expect(podeTrocarCredenciais('admin@credijuris.com', ' Contato@Credijuris.com ')).toBe(false)
  })
  it('a mestra troca as próprias; qualquer admin troca as dos outros', () => {
    expect(podeTrocarCredenciais('contato@credijuris.com', 'contato@credijuris.com')).toBe(true)
    expect(podeTrocarCredenciais('admin@credijuris.com', 'fulano@credijuris.com')).toBe(true)
  })
})

// ------------------------------------------------------------ ADVBOX
describe('paginarAdvbox', () => {
  const registros = Array.from({ length: 250 }, (_, i) => ({ id: i }))
  it('endpoint que entrega 100 por página não perde metade (anda o que veio)', async () => {
    const offsets: number[] = []
    const r = await paginarAdvbox(async (offset) => {
      offsets.push(offset)
      return { totalCount: 250, data: registros.slice(offset, offset + 100) }
    })
    expect(r).toHaveLength(250)
    expect(new Set(r.map((x) => x.id)).size).toBe(250)
    expect(offsets).toEqual([0, 100, 200])
  })
  it('sem totalCount não para na primeira página cheia', async () => {
    const r = await paginarAdvbox(async (offset, limit) => ({ data: registros.slice(offset, offset + limit) }))
    expect(r).toHaveLength(250)
  })
  it('resposta que ignora a paginação e traz tudo não repete', async () => {
    const r = await paginarAdvbox(async () => registros)
    expect(r).toHaveLength(250)
  })
  it('passar do teto é ERRO, não lista cortada calada', async () => {
    await expect(
      paginarAdvbox(async (offset, limit) => ({ totalCount: 99999, data: Array.from({ length: limit }, (_, i) => ({ id: offset + i })) }), { cap: 400 }),
    ).rejects.toThrow(/cortada/)
  })
})

describe('dataDoAdvbox', () => {
  it('ISO que já traz fuso não vira data inválida', () => {
    expect(dataDoAdvbox('2026-02-15T10:00:00.000000Z')).toBe('2026-02-15')
    expect(dataDoAdvbox('2026-02-15T10:00:00-03:00')).toBe('2026-02-15')
  })
  it('instante com fuso cai no dia de Brasília', () => {
    expect(dataDoAdvbox('2026-02-16T01:30:00Z')).toBe('2026-02-15')
  })
  it('os formatos de antes seguem iguais', () => {
    expect(dataDoAdvbox('2026-02-15 10:00:00')).toBe('2026-02-15')
    expect(dataDoAdvbox('2026-02-15')).toBe('2026-02-15')
    expect(dataDoAdvbox('15/02/2026')).toBe('2026-02-15')
    expect(dataDoAdvbox('')).toBeNull()
    expect(dataDoAdvbox('lixo que não é data')).toBeNull()
  })
})

// ------------------------------------------------------------ certidões
describe('cidadeSemUf (CND municipal da residência atual)', () => {
  it('o hífen do nome da cidade fica', () => {
    expect(cidadeSemUf('Ji-Paraná')).toBe('ji-parana')
    expect(cidadeSemUf('Ji-Paraná/RO')).toBe('ji-parana')
    expect(cidadeSemUf('Xique-Xique (BA)')).toBe('xique-xique')
    expect(cidadeSemUf('Embu-Guaçu - SP')).toBe('embu-guacu')
  })
  it('a UF depois de hífen sai', () => {
    expect(cidadeSemUf('Goiânia - GO')).toBe('goiania')
    expect(cidadeSemUf('Goiânia-GO')).toBe('goiania')
    expect(cidadeSemUf('Goiânia')).toBe('goiania')
  })
})

// ------------------------------------------------------------ Escavador
/** Um CNJ válido (dígito verificador mod 97) a partir do número sequencial. */
function cnjValido(seq: number): string {
  const n = String(seq).padStart(7, '0')
  const resto = BigInt(`${n}2024809014900`) % 97n
  const dv = String(98n - resto).padStart(2, '0')
  return `${n}-${dv}.2024.8.09.0149`
}

describe('normalizarProcessos: o do título não sai no corte', () => {
  it('com a IA trazendo outros quatro, o do título fica', () => {
    const titulo = '8015250-24.2020.8.05.0000'
    const daIA = [1, 2, 3, 4].map((i) => ({ cnj: cnjValido(1000 + i), papeis: ['conhecimento'], fonte: 'anexo' }))
    const r = normalizarProcessos({ processos: daIA }, { titulo: `X - Y - ${titulo}`, anotacoes: '', cnjDoTitulo: titulo })
    expect(r.processos).toHaveLength(MAX_PROCESSOS)
    expect(r.processos.map((p) => p.cnj)).toContain(titulo)
    expect(r.processos.map((p) => p.cnj)).toContain(cnjValido(1001))
  })
})

describe('tempoDaTentativa (download dos autos não passa do prazo da volta)', () => {
  it('o menor entre o teto e o que resta', () => {
    expect(tempoDaTentativa(100_000, 0, 90_000)).toBe(90_000)
    expect(tempoDaTentativa(100_000, 40_000, 90_000)).toBe(60_000)
  })
  it('sem o mínimo, nem tenta', () => {
    expect(tempoDaTentativa(100_000, 98_000, 90_000)).toBeNull()
    expect(tempoDaTentativa(100_000, 120_000, 90_000)).toBeNull()
  })
})

describe('Escavador: página que falha depois da primeira não joga fora o que foi pago', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('volta o parcial, com os centavos, marcado', async () => {
    let n = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      n++
      if (n === 1) {
        return new Response(JSON.stringify({ items: [{ numero_cnj: '1' }], links: { next: 'https://x/pagina2' } }), {
          status: 200,
          headers: { 'Creditos-Utilizados': '134' },
        })
      }
      return new Response('erro', { status: 503 })
    }))
    const r = await processosDoEnvolvido('chave', { documento: '12345678901' })
    expect(r.items).toHaveLength(1)
    expect(r.centavos).toBe(134)
    expect(r.truncado).toBe(true)
    expect(r.falha).toBeTruthy()
  })
  it('a primeira página que falha continua sendo erro', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('erro', { status: 503 })))
    await expect(processosDoEnvolvido('chave', { documento: '12345678901' })).rejects.toBeTruthy()
  })
})

// ------------------------------------------------------------ dd-credor
describe('seloDoCredor', () => {
  it('sem classificação é NÃO QUALIFICADO, nunca APROVADA', () => {
    expect(seloDaClassificacao(undefined)).toBe('NÃO QUALIFICADO')
    expect(seloDaClassificacao('')).toBe('NÃO QUALIFICADO')
    expect(seloDaClassificacao('🟢 Aprovada')).toBe('APROVADA')
    expect(seloDaClassificacao('🟡 Ressalvas')).toBe('RESSALVAS')
    expect(seloDaClassificacao('🔴 Reprovada')).toBe('REPROVADA')
  })
  it('a frase verde só sai com todos qualificados', () => {
    expect(conclusaoDoRelatorio([{ qualificacao: { classificacao: '🟢 Aprovada' } }, { qualificacao: null }], false).tom).toBe('incompleto')
    expect(conclusaoDoRelatorio([{ qualificacao: { classificacao: '🟢 Aprovada' } }], false).tom).toBe('ok')
    expect(conclusaoDoRelatorio([{ qualificacao: null }], true).tom).toBe('risco')
  })
})

// ------------------------------------------------------------ relógio
describe('relogioDaInvocacao', () => {
  it('conta do começo da invocação, não do começo da chamada', () => {
    expect(tempoAteOTeto(0, 0)).toBe(135_000)
    expect(tempoAteOTeto(0, 100_000)).toBe(35_000)
    expect(tempoAteOTeto(0, 149_000)).toBe(5_000)
  })
  it('reconhece o estouro do AbortSignal.timeout', () => {
    expect(estourouOTempo({ name: 'TimeoutError' })).toBe(true)
    expect(estourouOTempo(new Error('x'))).toBe(false)
  })
})

// ------------------------------------------------------------ datas e Drive
describe('formatos de data do contrato e da RPV', () => {
  it('por extenso e dd/mm/aaaa, do dia de Brasília', () => {
    expect(dataPorExtenso('2026-10-09')).toBe('09 de outubro de 2026')
    expect(diaMesAno('2026-12-31')).toBe('31/12/2026')
  })
})

describe('pastaQueFica (duas pastas de mesmo nome criadas ao mesmo tempo)', () => {
  it('todos escolhem a mais antiga; empate pelo id', () => {
    const a = { id: 'b', createdTime: '2026-10-09T10:00:01Z' }
    const b = { id: 'a', createdTime: '2026-10-09T10:00:02Z' }
    expect(pastaQueFica([b, a])?.id).toBe('b')
    expect(pastaQueFica([{ id: 'z', createdTime: 't' }, { id: 'y', createdTime: 't' }])?.id).toBe('y')
    expect(pastaQueFica([])).toBeNull()
  })
})
