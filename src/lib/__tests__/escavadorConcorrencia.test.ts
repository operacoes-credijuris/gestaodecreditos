/**
 * A ROTINA DOS AUTOS CONTRA ELA MESMA — auditoria de 23/10/2026.
 *
 * O cron, o sync e o aviso do Escavador acordam a rotina ao mesmo tempo. Fixa:
 *  1. a conferência do pedido grava condicionada ao que leu (sem reabrir o
 *     processo que outra volta já levou adiante — PDFs em dobro no card);
 *  2. a conferência para com folga antes do teto da invocação;
 *  3. a cota paga do dia é reservada no banco antes de cada POST;
 *  4. o download do anexo do Kommo que falha não deixa o card LIDO sem ele;
 *  5. a verificação do Escavador só vale se for DESTE pedido (pelo id);
 *  6. a leitura da interrupção é paginada (sem o corte de 1000 linhas).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  cobrancaPossivel,
  downloadSumiu,
  FOLGA_PARA_CONFERIR_MS,
  inicioDoDiaEmBrasilia,
  reservaCabeNaCota,
  temTempoParaConferir,
  verificacaoDoPedido,
} from '../../../supabase/functions/escavador-autos-rotina/concorrencia.ts'
import { lerTodasAsLinhas } from '../../../supabase/functions/_shared/leituraPaginada.ts'
import { podePagarPedido, type SituacaoDoCard } from '../../../supabase/functions/_shared/interrupcaoDosAutos.ts'

// SEM O \r DO WINDOWS (23/10/2026): com core.autocrlf, o checkout no Windows
// grava CRLF, e a asserção que procura um trecho terminado em '\n' falhava aqui
// e passava no Linux — o código era o mesmo.
const rotina = readFileSync(
  join(__dirname, '..', '..', '..', 'supabase/functions/escavador-autos-rotina/index.ts'),
  'utf8',
).replace(/\r\n/g, '\n')
/** O corpo de uma função da rotina, do cabeçalho até o próximo `async function` de topo. */
function corpo(nome: string): string {
  const i = rotina.indexOf(`async function ${nome}(`)
  expect(i).toBeGreaterThan(0)
  const fim = rotina.indexOf('\nasync function ', i + 10)
  return rotina.slice(i, fim > 0 ? fim : undefined)
}

// ------------------------------------------------------------------ 5. A VERIFICAÇÃO DO PEDIDO
describe('verificacaoDoPedido: a verificação é deste pedido?', () => {
  const linha = '2026-10-20T12:00:00Z'

  it('com pedido_id, só o mesmo id casa', () => {
    expect(verificacaoDoPedido({ id: 58021125, criado_em: '2026-10-21T00:00:00Z' }, 58021125, linha)).toBe(true)
    expect(verificacaoDoPedido({ id: '58021125' }, '58021125', linha)).toBe(true)
  })

  it('verificação mais nova de OUTRO pedido não casa (era o defeito)', () => {
    const outra = { id: 99, criado_em: '2026-10-22T00:00:00Z', opcoes: { autos: true } }
    expect(verificacaoDoPedido(outra, 58021125, linha)).toBe(false)
    // nem a consulta de documentos públicos feita à mão
    expect(verificacaoDoPedido({ id: 100, criado_em: '2026-10-22T00:00:00Z', opcoes: {} }, 58021125, linha)).toBe(false)
  })

  it('sem verificação, ou sem id, não casa', () => {
    expect(verificacaoDoPedido(null, 1, linha)).toBe(false)
    expect(verificacaoDoPedido(undefined, 1, linha)).toBe(false)
    expect(verificacaoDoPedido({ criado_em: '2026-10-22T00:00:00Z' }, 1, linha)).toBe(false)
  })

  it('linha antiga sem pedido_id: casa pela data, mas só um pedido de AUTOS', () => {
    expect(verificacaoDoPedido({ id: 7, criado_em: '2026-10-21T00:00:00Z', opcoes: { autos: true } }, null, linha)).toBe(true)
    expect(verificacaoDoPedido({ id: 7, criado_em: '2026-10-21T00:00:00Z', opcoes: {} }, null, linha)).toBe(false)
    expect(verificacaoDoPedido({ id: 7, criado_em: '2026-10-19T00:00:00Z', opcoes: { autos: true } }, null, linha)).toBe(false)
    expect(verificacaoDoPedido({ id: 7, criado_em: 'lixo', opcoes: { autos: true } }, 0, linha)).toBe(false)
  })

  it('a rotina usa a regra, e não mais "qualquer verificação mais nova"', () => {
    expect(corpo('acompanhar')).toContain('const doPedido = verificacaoDoPedido(v, p.pedido_id, p.criado_em)')
    expect(rotina).not.toContain('Date.parse(String(v.criado_em)) >= Date.parse(p.criado_em)')
  })
})

// ------------------------------------------------------------------ 1. A GRAVAÇÃO CONDICIONADA
describe('acompanhar: a gravação condicionada ao que se leu', () => {
  const a = corpo('acompanhar')

  it('só grava se a linha ainda está AGUARDANDO e com o mesmo atualizado_em', () => {
    const g = a.slice(a.indexOf('const gravar = async'), a.indexOf('const consulta = await ultimaVerificacao'))
    expect(g).toContain(".eq('estado', 'AGUARDANDO')")
    expect(g).toContain(".eq('atualizado_em', p.atualizado_em)")
    // e sabe se gravou (0 linhas = outra volta levou o processo)
    expect(g).toContain(".select('kommo_lead_id')")
    expect(g).toContain('return !!gravou?.length')
  })

  it('a juntada nova só sai pela gravação condicionada', () => {
    // a única escrita do laço é o `gravar` condicionado
    expect(a.match(/\.update\(/g)).toHaveLength(1)
    expect(a).toContain("juntada: juntadaInicial('novo')")
  })
})

// ------------------------------------------------------------------ 2. O RELÓGIO DA CONFERÊNCIA
describe('acompanhar: o relógio', () => {
  it('folga de 15 s sobre o orçamento', () => {
    expect(FOLGA_PARA_CONFERIR_MS).toBe(15_000)
    expect(temTempoParaConferir(100_000)).toBe(true)
    expect(temTempoParaConferir(15_000)).toBe(true)
    expect(temTempoParaConferir(14_999)).toBe(false)
    expect(temTempoParaConferir(-5_000)).toBe(false)
  })

  it('pior caso: a última conferência começa com 15 s e termina antes do teto de ~150 s', () => {
    const orcamento = 100_000
    const consulta = 30_000
    const banco = 5_000
    const comecaEm = orcamento - FOLGA_PARA_CONFERIR_MS
    expect(comecaEm + consulta + banco).toBeLessThan(150_000)
  })

  it('a rotina confere o relógio antes de cada consulta e recebe o `resta`', () => {
    const a = corpo('acompanhar')
    expect(a).toContain('resta: () => number')
    const relogio = a.indexOf('if (!temTempoParaConferir(resta())) break')
    expect(relogio).toBeGreaterThan(0)
    expect(a.indexOf('await ultimaVerificacao(chave, p.numero_cnj)')).toBeGreaterThan(relogio)
    expect(rotina).toContain('await acompanhar(svc, chave, soEste, novas, resta)')
    // os mais esquecidos primeiro, para a fila andar quando o relógio corta
    expect(a).toContain(".order('verificado_em', { ascending: true, nullsFirst: true })")
  })
})

// ------------------------------------------------------------------ 3. A COTA RESERVADA
describe('a cota paga do dia: reserva no banco antes do POST', () => {
  it('posição 1..40 cabe; 41 não', () => {
    expect(reservaCabeNaCota(1, 40)).toBe(true)
    expect(reservaCabeNaCota(40, 40)).toBe(true)
    expect(reservaCabeNaCota(41, 40)).toBe(false)
    expect(reservaCabeNaCota(0, 40)).toBe(false)
    expect(reservaCabeNaCota(Number.NaN, 40)).toBe(false)
  })

  it('duas voltas ao mesmo tempo não passam do teto (simulação das reservas)', () => {
    // O banco: as reservas do dia, cada uma com o seu criado_em. Cada volta
    // conta as de criado_em <= a sua, como o `reservarPedidoDoDia` faz.
    const LIMITE = 40
    const banco: { id: number; t: number }[] = []
    for (let i = 0; i < 38; i++) banco.push({ id: i, t: i })
    // Volta A e volta B, intercaladas: cada uma reserva 3 vezes.
    const pagos: number[] = []
    let t = 100
    for (let rodada = 0; rodada < 3; rodada++) {
      for (const volta of ['A', 'B']) {
        const minha = { id: banco.length, t: t++ }
        banco.push(minha)
        const posicao = banco.filter((r) => r.t <= minha.t).length
        if (reservaCabeNaCota(posicao, LIMITE)) pagos.push(minha.id)
        else banco.splice(banco.indexOf(minha), 1) // desfaz
        void volta
      }
    }
    expect(38 + pagos.length).toBe(LIMITE)
  })

  it('empate exato de horário: as duas recuam, nenhuma passa', () => {
    const banco = Array.from({ length: 39 }, (_, i) => ({ t: i }))
    const a = { t: 1000 }
    const b = { t: 1000 }
    banco.push(a, b)
    const posA = banco.filter((r) => r.t <= a.t).length
    const posB = banco.filter((r) => r.t <= b.t).length
    expect(reservaCabeNaCota(posA, 40)).toBe(false)
    expect(reservaCabeNaCota(posB, 40)).toBe(false)
  })

  it('a reserva fica quando o dinheiro pode ter saído; desfaz na recusa afirmada', () => {
    expect(cobrancaPossivel(0, 0)).toBe(true) // sem resposta
    expect(cobrancaPossivel(200, 0)).toBe(true)
    expect(cobrancaPossivel(500, 134)).toBe(true) // cabeçalho de crédito usado
    expect(cobrancaPossivel(402, 0)).toBe(false)
    expect(cobrancaPossivel(422, 0)).toBe(false)
    expect(cobrancaPossivel(503, 0)).toBe(false)
  })

  it('o começo do dia é meia-noite em Brasília', () => {
    expect(inicioDoDiaEmBrasilia(new Date('2026-10-23T02:59:00Z'))).toBe('2026-10-22T03:00:00Z')
    expect(inicioDoDiaEmBrasilia(new Date('2026-10-23T03:00:00Z'))).toBe('2026-10-23T03:00:00Z')
  })

  it('no pedir, a reserva vem antes do POST pago, e a linha de consumo só nasce nela', () => {
    const p = corpo('pedir')
    const reserva = p.indexOf('const reserva = await reservarPedidoDoDia(svc, leadId, cnj, inicioDoDia)')
    const cabe = p.indexOf('if (!reservaCabeNaCota(reserva.posicao, LIMITE_PEDIDOS_DIA)) {')
    const post = p.indexOf('/solicitar-atualizacao`')
    const fecha = p.indexOf('await fecharReserva(svc, reserva.id, r, pedidoId)')
    expect(reserva).toBeGreaterThan(0)
    expect(cabe).toBeGreaterThan(reserva)
    expect(post).toBeGreaterThan(cabe)
    expect(fecha).toBeGreaterThan(post)
    expect(p).not.toContain('pedidosHoje++')
    // um só insert em escavador_consumo na rotina: o da reserva
    expect(rotina.match(/from\('escavador_consumo'\)\s*\.insert\(/g)).toHaveLength(1)
    const r = corpo('reservarPedidoDoDia')
    expect(r).toContain(".lte('criado_em', String(linha.criado_em))")
    expect(r).toContain('erro: RESERVA_EM_ABERTO')
  })
})

// ------------------------------------------------------------------ 4. O DOWNLOAD DO ANEXO
describe('o anexo do card que não desce', () => {
  it('só o 404 é "sumiu"', () => {
    expect(downloadSumiu(404)).toBe(true)
    for (const s of [0, 401, 403, 408, 429, 500, 502, 503]) expect(downloadSumiu(s)).toBe(false)
  })

  it('o baixar lança na falha, e a leitura não engole o erro', () => {
    const i = rotina.indexOf('async baixar(url: string)')
    const b = rotina.slice(i, rotina.indexOf('async subir(', i))
    expect(b).toContain('if (downloadSumiu(r.status)) {')
    expect(b).toContain('throw new Error(`um anexo do card não desceu do Kommo (HTTP ${r.status})`)')
    expect(b).not.toContain('r.ok ? new Uint8Array(await r.arrayBuffer()) : null')
    expect(rotina).toContain('const b = await kommo.baixar(c.download)\n')
    expect(rotina).not.toContain('kommo.baixar(c.download).catch(')
  })
})

// ------------------------------------------------------------------ 6. A LEITURA PAGINADA
describe('a interrupção lê todas as linhas', () => {
  it('com 2.500 processos, o corte de 1000 deixava cards fora do mapa — e eles "podiam pagar"', async () => {
    const linhas = Array.from({ length: 2500 }, (_, i) => ({ kommo_lead_id: i + 1 }))
    // O mapa de situações: todo card saiu da análise.
    const montarMapa = (ids: number[]) => new Map<number, SituacaoDoCard>(ids.map((id) => [id, 'saiu_da_analise']))

    const cortado = montarMapa(linhas.slice(0, 1000).map((l) => l.kommo_lead_id))
    expect(podePagarPedido(cortado.get(2400))).toBe(true) // o defeito

    const r = await lerTodasAsLinhas<{ kommo_lead_id: number }>(async (de, ate) => ({
      data: linhas.slice(de, ate + 1),
      error: null,
    }))
    expect(r.erro).toBeNull()
    expect(r.cortada).toBe(false)
    const inteiro = montarMapa(r.linhas.map((l) => l.kommo_lead_id))
    expect(podePagarPedido(inteiro.get(2400))).toBe(false)
  })

  it('a rotina pagina com ordem estável, e leitura incompleta não paga nada', () => {
    const f = corpo('interromperERetomar')
    expect(f.match(/lerTodasAsLinhas</g)).toHaveLength(2)
    expect(f).toContain(".order('kommo_lead_id').order('numero_cnj').range(de, ate)")
    expect(f).toContain(".order('kommo_lead_id').range(de, ate)")
    expect(f).toContain('if (lp.erro || lp.cortada || lc.erro || lc.cortada) {')
    expect(f).toContain('if (!situacoes) return null')
    // situacoesDosCards: erro é null, e não o mapa vazio (= "pode pagar" para todos)
    const s = corpo('situacoesDosCards')
    expect(s).not.toContain('return new Map()')
    expect(s).toContain('if (erroEtapas) return null')
    // o pedir recusa o mapa ausente antes de qualquer coisa
    const p = corpo('pedir')
    expect(p.indexOf('if (!situacoes) {')).toBeGreaterThan(0)
    expect(p.indexOf('if (!situacoes) {')).toBeLessThan(p.indexOf("from('escavador_autos_processo')"))
  })
})
