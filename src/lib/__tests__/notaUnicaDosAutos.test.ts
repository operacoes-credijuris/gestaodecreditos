/**
 * OS AUTOS DO ESCAVADOR NO CARD — pedido do dono de 20/10/2026.
 *
 *  1. O card que sai da coluna de análise de um funil operacional não pede
 *     mais autos: o que ainda não foi pedido vira INTERROMPIDO, e volta para a
 *     fila se o card voltar.
 *  2. UMA nota por card, editada no lugar: o texto vem do estado no banco, e
 *     nenhuma nota nova é criada depois da primeira.
 *  3. Os PDFs só na aba Arquivos: nenhuma nota de anexo.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DETALHE_INTERROMPIDO,
  ESTADOS_INTERROMPIVEIS,
  FUNIS_OPERACIONAIS,
  INTERROMPIDO,
  podePagarPedido,
  proximoEstadoDaLeitura,
  proximoEstadoDoProcesso,
  ROTULO_INTERROMPIDO,
  situacaoDoCard,
} from '../../../supabase/functions/_shared/interrupcaoDosAutos.ts'
import {
  andamentoDoProcesso,
  type NotaDoCard,
  notaUnicaDosAutos,
  type PortaDaNota,
  POSSE_DA_CRIACAO_MS,
  type ProcessoDaNota,
  processoDaNota,
  sincronizarNotaDoCard,
} from '../../../supabase/functions/_shared/notaUnicaDosAutos.ts'
import { ENTRADA_RPV, FUNIL_GERAL, FUNIL_RPV } from '../../../supabase/functions/_shared/autosParaOKommo.ts'
import { juntadaInicial, nomeDaParte, type ParteFeita } from '../../../supabase/functions/_shared/autosJuntos.ts'
import {
  FUNIL_PRECATORIO_EXTERNO,
  FUNIL_PRECATORIO_INTERNO,
} from '../../../supabase/functions/_shared/trilhasDoPrecatorio.ts'
import { assinarNota } from '../../../supabase/functions/_shared/notaCredijuris.ts'

const ENTRADA_INTERNO = 501
const ENTRADA_EXTERNO = 601
const ENTRADA_NOVOS = 701
const ENTRADAS = [
  { pipeline_id: FUNIL_RPV, status_id: ENTRADA_RPV },
  { pipeline_id: FUNIL_PRECATORIO_INTERNO, status_id: ENTRADA_INTERNO },
  { pipeline_id: FUNIL_PRECATORIO_EXTERNO, status_id: ENTRADA_EXTERNO },
  { pipeline_id: FUNIL_GERAL, status_id: ENTRADA_NOVOS },
]

const CONHEC = '0001234-56.2020.8.05.0001'
const CUMPR = '0005555-11.2022.8.05.0001'
const PREC = '8015250-24.2020.8.05.0000'

// ------------------------------------------------------------------ 1. A INTERRUPÇÃO
describe('onde o card está', () => {
  it('os três funis operacionais: RPV, Precatório Interno e Externo', () => {
    expect(FUNIS_OPERACIONAIS).toEqual([FUNIL_RPV, FUNIL_PRECATORIO_INTERNO, FUNIL_PRECATORIO_EXTERNO])
    expect(FUNIS_OPERACIONAIS).not.toContain(FUNIL_GERAL)
  })

  it('na coluna de entrada do funil operacional: na_entrada', () => {
    expect(situacaoDoCard({ pipeline_id: FUNIL_RPV, status_id: ENTRADA_RPV }, ENTRADAS)).toBe('na_entrada')
    expect(situacaoDoCard({ pipeline_id: FUNIL_PRECATORIO_INTERNO, status_id: ENTRADA_INTERNO }, ENTRADAS)).toBe('na_entrada')
    expect(situacaoDoCard({ pipeline_id: String(FUNIL_PRECATORIO_EXTERNO), status_id: String(ENTRADA_EXTERNO) }, ENTRADAS)).toBe('na_entrada')
  })

  it('movido adiante no mesmo funil (a equipe baixou a íntegra à mão): saiu_da_analise', () => {
    expect(situacaoDoCard({ pipeline_id: FUNIL_RPV, status_id: 999 }, ENTRADAS)).toBe('saiu_da_analise')
    expect(situacaoDoCard({ pipeline_id: FUNIL_PRECATORIO_INTERNO, status_id: 999 }, ENTRADAS)).toBe('saiu_da_analise')
    expect(situacaoDoCard({ pipeline_id: FUNIL_PRECATORIO_EXTERNO, status_id: ENTRADA_INTERNO }, ENTRADAS)).toBe('saiu_da_analise')
  })

  it('funil comercial, card fora do espelho: segue como sempre', () => {
    expect(situacaoDoCard({ pipeline_id: FUNIL_GERAL, status_id: ENTRADA_NOVOS }, ENTRADAS)).toBe('fora_do_operacional')
    expect(situacaoDoCard({ pipeline_id: FUNIL_GERAL, status_id: 12345 }, ENTRADAS)).toBe('fora_do_operacional')
    expect(situacaoDoCard({ pipeline_id: 42, status_id: 1 }, ENTRADAS)).toBe('fora_do_operacional')
    expect(situacaoDoCard(null, ENTRADAS)).toBe('fora_do_operacional')
  })

  it('a entrada do funil não resolvida no espelho: NADA se interrompe (leitura falhada não para o funil inteiro)', () => {
    const soRpv = [{ pipeline_id: FUNIL_RPV, status_id: ENTRADA_RPV }]
    expect(situacaoDoCard({ pipeline_id: FUNIL_PRECATORIO_INTERNO, status_id: 999 }, soRpv)).toBe('fora_do_operacional')
    expect(situacaoDoCard({ pipeline_id: FUNIL_PRECATORIO_EXTERNO, status_id: 999 }, [])).toBe('fora_do_operacional')
  })
})

describe('a regra da interrupção e da retomada', () => {
  it('saiu da análise: o que não foi pedido vira INTERROMPIDO', () => {
    for (const e of ['NOVO', 'FILA', 'SEM_SALDO', 'REPETIR']) {
      expect(proximoEstadoDoProcesso(e, 'saiu_da_analise')).toBe(INTERROMPIDO)
    }
    expect([...ESTADOS_INTERROMPIVEIS]).toEqual(['NOVO', 'FILA', 'SEM_SALDO', 'REPETIR'])
  })

  it('o pedido já iniciado termina; o que terminou fica', () => {
    for (const e of ['PEDINDO', 'AGUARDANDO', 'ANEXANDO', 'CONCLUIDO', 'FALHOU', INTERROMPIDO]) {
      expect(proximoEstadoDoProcesso(e, 'saiu_da_analise')).toBeNull()
    }
  })

  it('voltou para a entrada: o INTERROMPIDO volta para a fila (NOVO); o resto não muda', () => {
    expect(proximoEstadoDoProcesso(INTERROMPIDO, 'na_entrada')).toBe('NOVO')
    for (const e of ['NOVO', 'FILA', 'AGUARDANDO', 'CONCLUIDO', 'FALHOU']) {
      expect(proximoEstadoDoProcesso(e, 'na_entrada')).toBeNull()
    }
  })

  it('fora do operacional (funil comercial): nada muda, nem para interromper nem para retomar', () => {
    for (const e of ['NOVO', 'FILA', 'SEM_SALDO', 'REPETIR', INTERROMPIDO]) {
      expect(proximoEstadoDoProcesso(e, 'fora_do_operacional')).toBeNull()
    }
  })

  it('a leitura pendente do card (NOVO) também se interrompe e volta', () => {
    expect(proximoEstadoDaLeitura('NOVO', 'saiu_da_analise')).toBe(INTERROMPIDO)
    expect(proximoEstadoDaLeitura(INTERROMPIDO, 'na_entrada')).toBe('NOVO')
    for (const e of ['LENDO', 'LIDO', 'SEM_PROCESSO']) expect(proximoEstadoDaLeitura(e, 'saiu_da_analise')).toBeNull()
    expect(proximoEstadoDaLeitura('NOVO', 'fora_do_operacional')).toBeNull()
  })

  it('pedido pago só para card que não saiu da análise (card desconhecido segue como sempre)', () => {
    expect(podePagarPedido('saiu_da_analise')).toBe(false)
    expect(podePagarPedido('na_entrada')).toBe(true)
    expect(podePagarPedido('fora_do_operacional')).toBe(true)
    expect(podePagarPedido(undefined)).toBe(true)
  })

  it('o rótulo claro do estado novo', () => {
    expect(ROTULO_INTERROMPIDO).toBe('Interrompido — o card saiu da análise')
    expect(DETALHE_INTERROMPIDO).toContain('saiu da coluna de análise')
  })
})

describe('a rotina aplica a regra antes do pedido pago', () => {
  const rotina = readFileSync(join(__dirname, '..', '..', '..', 'supabase/functions/escavador-autos-rotina/index.ts'), 'utf8')
  it('interrompe depois de acompanhar e antes de pedir', () => {
    const a = rotina.indexOf('await acompanhar(svc, chave, soEste, novas)')
    const i = rotina.indexOf('const situacoes = await interromperERetomar(svc, soEste)')
    const p = rotina.indexOf('await pedir(svc, chave, situacoes, soEste, avisos, novas, resta)')
    expect(a).toBeGreaterThan(0)
    expect(i).toBeGreaterThan(a)
    expect(p).toBeGreaterThan(i)
  })
  it('o pedido confere a situação e grava INTERROMPIDO antes do POST pago', () => {
    const guarda = rotina.indexOf('if (!podePagar) {')
    const post = rotina.indexOf('/solicitar-atualizacao`')
    expect(guarda).toBeGreaterThan(0)
    expect(post).toBeGreaterThan(guarda)
    expect(rotina).toContain('await gravar({ estado: INTERROMPIDO, detalhe: DETALHE_INTERROMPIDO })')
  })
})

// ------------------------------------------------------------------ 2. O TEXTO DA NOTA
const proc = (o: Partial<ProcessoDaNota> & { cnj: string; rotulo: string; estado: string }): ProcessoDaNota => o

function parte(n: number, total: number, extra: Partial<ParteFeita> = {}): ParteFeita {
  return {
    n,
    de: n * 10 - 9,
    ate: n * 10,
    nome: nomeDaParte('Precatório', PREC, n, total),
    uuid: `u${n}`,
    versao: null,
    bytes: 1000,
    paginas: 100,
    documentos: 10,
    primeiro: '2020-06-09T15:54:00',
    ultimo: '2025-09-08T14:35:23',
    ligada: true,
    nota: 'pendente',
    ...extra,
  }
}

describe('a nota única: o texto em cada estado', () => {
  it('logo depois da identificação: os processos, o papel de cada um e "na fila"', () => {
    const t = notaUnicaDosAutos([
      proc({ cnj: PREC, rotulo: 'Precatório', estado: 'NOVO' }),
      proc({ cnj: CONHEC, rotulo: 'Conhecimento', estado: 'NOVO' }),
      proc({ cnj: CUMPR, rotulo: 'Cumprimento', estado: 'NOVO' }),
    ])
    expect(t.startsWith('📂 Autos deste crédito pelo Escavador — 3 processos identificados:')).toBe(true)
    // NA ORDEM DO PROCESSO: conhecimento, cumprimento, requisitório.
    expect(t.indexOf(`• Conhecimento — ${CONHEC}`)).toBeLessThan(t.indexOf(`• Cumprimento — ${CUMPR}`))
    expect(t.indexOf(`• Cumprimento — ${CUMPR}`)).toBeLessThan(t.indexOf(`• Precatório — ${PREC}`))
    expect(t.match(/Na fila para pedir os autos ao Escavador/g)).toHaveLength(3)
    expect(t).toContain('Esta nota é atualizada sozinha a cada passo')
    expect(t).toContain('aba Arquivos do card')
    // Sem a assinatura: quem envia assina.
    expect(t).not.toContain('Credijuris · nota automática')
  })

  it('aguardando, anexados (com os nomes dos PDFs) e falhou — cada um com o seu andamento', () => {
    const j = juntadaInicial('novo')
    j.partes = [parte(1, 2), parte(2, 2)]
    j.concluida = true
    const t = notaUnicaDosAutos([
      proc({ cnj: CONHEC, rotulo: 'Conhecimento', estado: 'AGUARDANDO' }),
      proc({ cnj: PREC, rotulo: 'Precatório', estado: 'CONCLUIDO', juntada: j }),
      proc({ cnj: CUMPR, rotulo: 'Cumprimento', estado: 'FALHOU', detalhe: 'O robô não achou o processo no sistema do tribunal (pode ser físico, sigiloso ou arquivado)' }),
    ])
    expect(t).toContain('⏳ Pedido feito ao Escavador. Aguardando o robô dele trazer os autos do tribunal')
    expect(t).toContain('✅ Autos anexados na aba Arquivos do card — 20 documento(s), 200 páginas, de 09/06/2020 a 08/09/2025, em 2 PDFs:')
    expect(t).toContain(`📄 ${nomeDaParte('Precatório', PREC, 1, 2)}`)
    expect(t).toContain(`📄 ${nomeDaParte('Precatório', PREC, 2, 2)}`)
    expect(t).toContain('❌ Não consegui baixar os autos: o robô não achou o processo no sistema do tribunal (pode ser físico, sigiloso ou arquivado). Anexe os autos à mão.')
  })

  it('interrompido porque o card saiu da coluna de análise', () => {
    const t = notaUnicaDosAutos([proc({ cnj: CONHEC, rotulo: 'Conhecimento', estado: INTERROMPIDO, detalhe: DETALHE_INTERROMPIDO })])
    expect(t).toContain('1 processo identificado:')
    expect(t).toContain('⏸️ Interrompido — o card saiu da coluna de análise antes do pedido ao Escavador.')
    expect(t).toContain('se voltar à coluna, o pedido volta para a fila')
  })

  it('a falha do robô: diz que é do Escavador, a tentativa e o teto; e a desistência ensina a pedir outra rodada', () => {
    const [rep] = andamentoDoProcesso(proc({ cnj: PREC, rotulo: 'Precatório', estado: 'REPETIR', falhaDoRobo: 'LOGIN_ERROR', tentativas: 2, teto: null }))
    expect(rep).toContain('(LOGIN_ERROR) — falha do Escavador, não da Credijuris. Tentativa 2 de 6; peço de novo a cada 10 minutos.')
    const [fim] = andamentoDoProcesso(proc({ cnj: PREC, rotulo: 'Precatório', estado: 'FALHOU', falhaDoRobo: 'INTERNAL_ERROR', tentativas: 6, desistiu: true }))
    expect(fim).toContain('seguiu falhando no tribunal (INTERNAL_ERROR) depois de 6 tentativa(s); parei de tentar')
    expect(fim).toContain('tire o card da coluna de análise e devolva-o a ela')
  })

  it('anexando: o que já está na aba Arquivos; a parte que não ligou ao card não é prometida lá', () => {
    const j = juntadaInicial('novo')
    j.partes = [parte(1, 3)]
    const l = andamentoDoProcesso(proc({ cnj: PREC, rotulo: 'Precatório', estado: 'ANEXANDO', juntada: j }))
    expect(l[0]).toContain('os PDFs estão subindo para a aba Arquivos do card. Já estão lá:')
    expect(l[1]).toContain(nomeDaParte('Precatório', PREC, 1, 3))

    const k = juntadaInicial('novo')
    k.partes = [parte(1, 2), parte(2, 2, { ligada: false })]
    k.concluida = true
    const c = andamentoDoProcesso(proc({ cnj: PREC, rotulo: 'Precatório', estado: 'CONCLUIDO', juntada: k })).join('\n')
    expect(c).toContain('num PDF só')
    expect(c).toContain(`⚠️ 1 PDF(s) subiram ao Kommo mas não ficaram ligados ao card: ${nomeDaParte('Precatório', PREC, 2, 2)}`)
  })

  it('o formato antigo (um arquivo por documento) e o rejuntar', () => {
    const [velho] = andamentoDoProcesso(proc({ cnj: CONHEC, rotulo: 'Conhecimento', estado: 'CONCLUIDO', anexados: 206, totalDocumentos: 206 }))
    expect(velho).toContain('um arquivo por documento ("Conhecimento 001, 002…"): 206 de 206 documento(s).')
    const j = juntadaInicial('rejuntar')
    const [rej] = andamentoDoProcesso(proc({ cnj: CONHEC, rotulo: 'Conhecimento', estado: 'ANEXANDO', juntada: j }))
    expect(rej).toContain('Os documentos soltos de antes continuam na aba Arquivos')
  })

  it('a linha do banco vira o processo da nota (colunas da 0077 ausentes não quebram)', () => {
    const p = processoDaNota({ numero_cnj: CONHEC, rotulo: 'Conhecimento', estado: 'AGUARDANDO', anexados: 0, total_documentos: 0 })
    expect(p).toMatchObject({ cnj: CONHEC, rotulo: 'Conhecimento', estado: 'AGUARDANDO', falhaDoRobo: null, tentativas: 0, desistiu: false })
    expect(processoDaNota({ numero_cnj: CONHEC, estado: 'FALHOU', desistiu_em: '2026-10-20T10:00:00Z' }).desistiu).toBe(true)
  })

  it('DETERMINÍSTICA: o mesmo estado dá o mesmo texto, em qualquer ordem — é o que evita editar à toa', () => {
    const a = [
      proc({ cnj: PREC, rotulo: 'Precatório', estado: 'AGUARDANDO' }),
      proc({ cnj: CONHEC, rotulo: 'Conhecimento', estado: 'FILA', detalhe: 'Cota de 40 pedidos por dia atingida; pede amanhã.' }),
    ]
    expect(notaUnicaDosAutos(a)).toBe(notaUnicaDosAutos([...a].reverse()))
    // O detalhe passageiro (que muda a cada volta) não entra no texto de quem espera.
    const b = [proc({ cnj: PREC, rotulo: 'Precatório', estado: 'FILA', detalhe: 'Não consegui consultar o Escavador antes de pedir (HTTP 502); tento de novo na próxima volta.' })]
    const c = [proc({ cnj: PREC, rotulo: 'Precatório', estado: 'FILA', detalhe: 'Outro card deste processo está fazendo o pedido.' })]
    expect(notaUnicaDosAutos(b)).toBe(notaUnicaDosAutos(c))
  })

  it('cabe numa nota do Kommo mesmo no pior caso (quatro processos, muitas partes, muitos de fora)', () => {
    const j = juntadaInicial('novo')
    j.partes = Array.from({ length: 12 }, (_, i) => parte(i + 1, 12))
    j.naoJuntados = Array.from({ length: 40 }, (_, i) => ({ ordem: i, nome: `Documento ${i}`, data: null, motivo: 'cifrado' }))
    j.concluida = true
    const t = assinarNota(notaUnicaDosAutos(['1', '2', '3', '4'].map((n) => proc({ cnj: `${n}${PREC.slice(1)}`, rotulo: 'Precatório', estado: 'CONCLUIDO', juntada: j }))))
    expect(t.length).toBeLessThan(8_000)
    expect(t).toContain('… e mais 6 PDF(s)')
  })
})

// ------------------------------------------------------------------ 3. UMA NOTA SÓ
/** O Kommo e o banco de mentira: conta as criações e as edições. */
function falso(inicial: Partial<NotaDoCard> = {}) {
  const banco: NotaDoCard = { kommo_lead_id: 77, nota_id: null, nota_texto: null, nota_em: null, ...inicial }
  const kommo = { notas: new Map<number, string>(), criadas: 0, editadas: 0, proximoId: 1000, falharCriacao: false, falharEdicao: false }
  let relogio = Date.parse('2026-10-20T12:00:00Z')
  const porta: PortaDaNota = {
    async criar(_lead, texto) {
      if (kommo.falharCriacao) return { erro: 'HTTP 502' }
      kommo.criadas++
      const id = kommo.proximoId++
      kommo.notas.set(id, texto)
      return { id }
    },
    async editar(_lead, id, texto) {
      if (kommo.falharEdicao) return { erro: 'HTTP 502' }
      if (!kommo.notas.has(id)) return 'apagada'
      kommo.editadas++
      kommo.notas.set(id, texto)
      return 'ok'
    },
    async tomarCriacao(_lead, lido) {
      if (banco.nota_id !== lido.notaId || banco.nota_em !== lido.notaEm) return false
      banco.nota_id = null
      banco.nota_em = new Date(relogio).toISOString()
      return true
    },
    async gravarCriada(_lead, id, texto) {
      if (banco.nota_id == null) Object.assign(banco, { nota_id: id, nota_texto: texto })
    },
    async gravarTexto(_lead, texto, lido) {
      if (banco.nota_texto === lido) banco.nota_texto = texto
    },
  }
  return {
    banco,
    kommo,
    porta,
    andar: (ms: number) => (relogio += ms),
    agora: () => relogio,
    /** Uma volta da rotina: o texto do estado de agora, levado à nota. */
    volta: (processos: ProcessoDaNota[]) =>
      sincronizarNotaDoCard({ ...banco }, assinarNota(notaUnicaDosAutos(processos)), porta, relogio),
  }
}

describe('uma nota só por card: criada uma vez, depois só editada', () => {
  const linhaDoTempo: ProcessoDaNota[][] = [
    [proc({ cnj: CONHEC, rotulo: 'Conhecimento', estado: 'NOVO' }), proc({ cnj: PREC, rotulo: 'Precatório', estado: 'NOVO' })],
    [proc({ cnj: CONHEC, rotulo: 'Conhecimento', estado: 'AGUARDANDO' }), proc({ cnj: PREC, rotulo: 'Precatório', estado: 'AGUARDANDO' })],
    [proc({ cnj: CONHEC, rotulo: 'Conhecimento', estado: 'AGUARDANDO' }), proc({ cnj: PREC, rotulo: 'Precatório', estado: 'AGUARDANDO' })],
    [proc({ cnj: CONHEC, rotulo: 'Conhecimento', estado: 'ANEXANDO' }), proc({ cnj: PREC, rotulo: 'Precatório', estado: 'REPETIR', falhaDoRobo: 'LOGIN_ERROR', tentativas: 1 })],
    [proc({ cnj: CONHEC, rotulo: 'Conhecimento', estado: 'CONCLUIDO', anexados: 3, totalDocumentos: 3 }), proc({ cnj: PREC, rotulo: 'Precatório', estado: INTERROMPIDO })],
  ]

  it('a primeira leitura cria (a da rotina); daí em diante, a cada mudança, uma EDIÇÃO — nenhuma nota nova', async () => {
    const f = falso()
    // A leitura do card entra no regime e cria a nota (o que `lerCards` faz).
    f.banco.nota_em = new Date(f.agora()).toISOString()
    const primeira = assinarNota(notaUnicaDosAutos(linhaDoTempo[0]))
    const r0 = await f.porta.criar(77, primeira)
    if ('erro' in r0) throw new Error('não criou')
    await f.porta.gravarCriada(77, r0.id, primeira)
    expect(f.kommo.criadas).toBe(1)

    const resultados = []
    for (const estado of linhaDoTempo) {
      f.andar(10 * 60_000)
      resultados.push(await f.volta(estado))
    }
    expect(resultados).toEqual(['igual', 'editada', 'igual', 'editada', 'editada'])
    expect(f.kommo.criadas).toBe(1)
    expect(f.kommo.editadas).toBe(3)
    expect(f.kommo.notas.size).toBe(1)
    expect(f.kommo.notas.get(r0.id)).toContain('⏸️ Interrompido')
    expect(f.kommo.notas.get(r0.id)).toContain('Credijuris · nota automática')
  })

  it('card lido ANTES da mudança (sem nota_em): nenhuma chamada ao Kommo, nunca', async () => {
    const f = falso({ nota_em: null, nota_id: null })
    for (const estado of linhaDoTempo) {
      f.andar(10 * 60_000)
      expect(await f.volta(estado)).toBe('sem_nota')
    }
    expect(f.kommo.criadas).toBe(0)
    expect(f.kommo.editadas).toBe(0)
  })

  it('a edição que falha de passagem é refeita na volta seguinte, com o mesmo texto', async () => {
    const f = falso({ nota_em: '2026-10-20T11:00:00.000Z', nota_id: 1000, nota_texto: 'velho' })
    f.kommo.notas.set(1000, 'velho')
    f.kommo.proximoId = 1001
    f.kommo.falharEdicao = true
    expect(await f.volta(linhaDoTempo[1])).toBe('falhou')
    expect(f.banco.nota_texto).toBe('velho')
    f.kommo.falharEdicao = false
    expect(await f.volta(linhaDoTempo[1])).toBe('editada')
    expect(f.kommo.criadas).toBe(0)
    expect(f.banco.nota_texto).toBe(assinarNota(notaUnicaDosAutos(linhaDoTempo[1])))
  })

  it('nota apagada no Kommo (404): UMA nova, e o id novo fica guardado; a volta concorrente não cria outra', async () => {
    const f = falso({ nota_em: '2026-10-20T11:00:00.000Z', nota_id: 1000, nota_texto: 'velho' })
    // A nota 1000 não existe mais no Kommo; a nova recebe o 2000.
    f.kommo.proximoId = 2000
    const lida = { ...f.banco }
    const texto = assinarNota(notaUnicaDosAutos(linhaDoTempo[1]))
    const [a, b] = await Promise.all([
      sincronizarNotaDoCard(lida, texto, f.porta, f.agora()),
      sincronizarNotaDoCard(lida, texto, f.porta, f.agora()),
    ])
    expect([a, b].sort()).toEqual(['criada', 'esperando'])
    expect(f.kommo.criadas).toBe(1)
    expect(f.banco.nota_id).toBe(2000)
    expect(f.kommo.notas.has(f.banco.nota_id!)).toBe(true)
    // Daqui em diante, edição.
    expect(await f.volta(linhaDoTempo[3])).toBe('editada')
    expect(f.kommo.criadas).toBe(1)
  })

  it('a criação da primeira leitura falhou: espera a posse de quem tentou, e então cria UMA vez', async () => {
    const f = falso({ nota_em: '2026-10-20T12:00:00.000Z', nota_id: null })
    expect(await f.volta(linhaDoTempo[0])).toBe('esperando')
    f.andar(POSSE_DA_CRIACAO_MS + 1)
    f.kommo.falharCriacao = true
    expect(await f.volta(linhaDoTempo[0])).toBe('falhou')
    expect(f.banco.nota_id).toBeNull()
    // A tentativa que falhou renovou a posse: a próxima volta logo em seguida espera.
    expect(await f.volta(linhaDoTempo[0])).toBe('esperando')
    f.andar(POSSE_DA_CRIACAO_MS + 1)
    f.kommo.falharCriacao = false
    expect(await f.volta(linhaDoTempo[0])).toBe('criada')
    expect(await f.volta(linhaDoTempo[1])).toBe('editada')
    expect(f.kommo.criadas).toBe(1)
  })

  it('nota criada sem id devolvido (nota_id 0): não edita e não cria outra', async () => {
    const f = falso({ nota_em: '2026-10-20T11:00:00.000Z', nota_id: 0, nota_texto: 'x' })
    expect(await f.volta(linhaDoTempo[1])).toBe('sem_nota')
    expect(f.kommo.criadas + f.kommo.editadas).toBe(0)
  })
})

// ------------------------------------------------------------------ 4. A ROTINA NÃO ESCREVE OUTRA NOTA
describe('a rotina dos autos: nenhuma nota além da única, nenhuma nota de anexo', () => {
  const ler = (rel: string) => readFileSync(join(__dirname, '..', '..', '..', 'supabase/functions', rel), 'utf8')
  const rotina = ler('escavador-autos-rotina/index.ts')
  const juntar = ler('escavador-autos-rotina/juntar.ts')

  it('nenhuma nota de anexo (os PDFs só na aba Arquivos), e o PUT dos arquivos continua', () => {
    for (const f of [rotina, juntar]) {
      expect(f).not.toContain("note_type: 'attachment'")
      expect(f).not.toContain('anotarAnexo')
    }
    expect(rotina).toContain('api(`/leads/${leadId}/files`, {') // o PUT da aba Arquivos
    expect(juntar).toContain('await o.kommo.anexar(leadId, [arquivo.uuid])')
  })

  it('nenhuma nota avulsa: o único POST de nota é a criação da nota única, chamada só na leitura e na sincronização', () => {
    for (const f of [rotina, juntar]) {
      expect(f).not.toMatch(/kommo\.anotar\(/)
      expect(f).not.toMatch(/notaDeFalha|notaDaFalhaDoRobo|notaDaDesistenciaDoRobo|notaDaNovaRodada|notaDosAutosJuntos|notaDaJuntadaQueFalhou/)
    }
    expect(rotina.match(/\/leads\/notes'/g)).toHaveLength(1)
    expect(rotina.match(/kommo\.criarNota\(/g)).toHaveLength(2) // lerCards e a porta da sincronização
    expect(rotina).toContain("method: 'PATCH',")
  })

  it('o próprio PDF dos autos continua fora da leitura da IA (ele está na aba Arquivos)', () => {
    expect(rotina).toContain('if (!pdf || ehAnexoDosAutos(m.nome) || m.bytes > MAX_BYTES_PDF_LEITURA) continue')
  })
})
