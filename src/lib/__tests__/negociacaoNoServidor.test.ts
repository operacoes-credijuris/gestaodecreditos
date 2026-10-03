// O DESFECHO DA NEGOCIAÇÃO — Fechados, Não fechado(s), Sem resposta — NO
// SERVIDOR, e só nele (etapa 10a do redesenho, 02/10/2026).
//
// O PRINCÍPIO DA ETAPA: o servidor passa a ACEITAR mais destinos, e nenhum botão
// novo aparece na versão oficial. Os botões vêm depois, na beta e só para
// administrador. Por isso os destinos novos moram num campo próprio da trilha
// (`negociacao`) e em `colunasRpv.ts`, e NUNCA em `saidas` — que a tela oficial
// desenha como botão, para todo mundo, no mesmo deploy (`abasDoFunil`).
//
// E O SELO DA NOTA ("Comercial" para esses destinos, "Operacional" no resto) é
// decidido pelo servidor, pelo destino: `_shared/servicoDaNota.ts`, que a
// `kommo-mover` usa.

import { describe, it, expect } from 'vitest'
import {
  abasDoFunil,
  ACOES,
  botoesDaAba,
  FUNIL_PRECATORIO,
  FUNIL_PRECATORIO_EXTERNO,
  FUNIL_PRECATORIO_INTERNO,
  FUNIL_RPV,
  SUBDIVISOES_PRECATORIO,
  TELAS,
  type Aba,
} from '@/lib/kommo'
import {
  destinoPermitido,
  destinosDaNegociacao,
  TRILHAS_PRECATORIO,
} from '../../../supabase/functions/_shared/trilhasDoPrecatorio.ts'
import {
  negociacaoDoDestino,
  recusaDaOrigem,
} from '../../../supabase/functions/_shared/desfechoDaNegociacao.ts'
import {
  COLUNAS,
  DESTINOS_DA_NEGOCIACAO_RPV,
  NEGOCIACAO_RPV,
} from '../../../supabase/functions/_shared/colunasRpv.ts'
import { servicoDaNota } from '../../../supabase/functions/_shared/servicoDaNota.ts'
import { espelhoDosTresFunis, IDS_EXTERNO, IDS_INTERNO, IDS_RPV } from './fixtures/kanbans'

const trilha = (key: 'interno' | 'externo') => TRILHAS_PRECATORIO.find((t) => t.key === key)!

/** Os destinos de todo movimento que a tela oferece numa aba (ver matrizDeMovimentos). */
const destinosDaAba = (a: Aba): number[] => [
  ...a.acoes.map((x) => x.statusId),
  ...(a.escolhaDeProposta ? [a.escolhaDeProposta] : []),
  ...(a.anexarEMover ? [a.anexarEMover.statusId] : []),
  ...(a.envioAosFundos ? [a.envioAosFundos.destino] : []),
  // O DESFECHO DA NEGOCIAÇÃO DA ONDA 4 (só admin): conta também, para que um
  // vazamento dele à visão de quem não é admin derrube os testes abaixo.
  ...[a.negociacao?.fechado, a.negociacao?.naoFechou, a.negociacao?.semResposta]
    .filter((x) => x !== undefined)
    .map((x) => x.statusId),
]

/** Os três destinos da Negociação, por funil — os ids do Kommo de 02/10/2026. */
const DESTINOS = {
  RPV: [107830043, 107830067, 112466388],
  Interno: [111533952, 112382612, 112465960],
  Externo: [111533992, 111985976, 112346344],
} as const

describe('Negociação: os ids conferem com o kanban de 02/10/2026', () => {
  // UM DÍGITO TROCADO apontaria para outra coluna que também existe.
  it('RPV', () => {
    expect(NEGOCIACAO_RPV).toEqual({
      coluna: IDS_RPV['Negociação'],
      fechados: IDS_RPV['Fechados'],
      naoFechados: IDS_RPV['Não fechado'],
      semResposta: IDS_RPV['Sem resposta'],
    })
    expect([...DESTINOS_DA_NEGOCIACAO_RPV].sort()).toEqual([...DESTINOS.RPV].sort())
  })

  it('Interno', () => {
    const n = trilha('interno').negociacao!
    expect(n.coluna).toEqual({ colunaKommo: 'Negociação', statusId: IDS_INTERNO['Negociação'] })
    expect(n.fechados).toEqual({ colunaKommo: 'Fechados', statusId: IDS_INTERNO['Fechados'] })
    expect(n.naoFechados).toEqual({ colunaKommo: 'Não fechados', statusId: IDS_INTERNO['Não fechados'] })
    expect(n.semResposta).toEqual({ colunaKommo: 'Sem resposta', statusId: IDS_INTERNO['Sem resposta'] })
  })

  it('Externo', () => {
    const n = trilha('externo').negociacao!
    expect(n.coluna).toEqual({ colunaKommo: 'NEGOCIAÇÃO', statusId: IDS_EXTERNO['NEGOCIAÇÃO'] })
    expect(n.fechados).toEqual({ colunaKommo: 'FECHADOS', statusId: IDS_EXTERNO['FECHADOS'] })
    expect(n.naoFechados).toEqual({ colunaKommo: 'NÃO FECHADO', statusId: IDS_EXTERNO['NÃO FECHADO'] })
    // O "SEM RESPOSTA" DO EXTERNO não está no espelho destes testes (29/09/2026);
    // o id vem do kommo_etapa de 02/10/2026.
    expect(n.semResposta).toEqual({ colunaKommo: 'SEM RESPOSTA', statusId: 112346344 })
  })
})

describe('Negociação: o servidor aceita os três destinos, e só eles', () => {
  it('RPV: os três estão em `COLUNAS`; a Negociação e a Oferta aos investidores, não', () => {
    for (const id of DESTINOS.RPV) expect(COLUNAS[id], String(id)).toBeDefined()
    expect(COLUNAS[NEGOCIACAO_RPV.coluna]).toBeUndefined()
    expect(COLUNAS[107830047]).toBeUndefined()
  })

  it('Interno e Externo: pelo id', () => {
    for (const id of DESTINOS.Interno) expect(destinoPermitido(FUNIL_PRECATORIO_INTERNO, id, null), String(id)).toBe(true)
    for (const id of DESTINOS.Externo) expect(destinoPermitido(FUNIL_PRECATORIO_EXTERNO, id, null), String(id)).toBe(true)
  })

  // COLUNA APAGADA E RECRIADA no Kommo ganha id novo; o nome de reserva a aceita,
  // como em todo destino da trilha.
  it('Interno e Externo: pelo nome de reserva, com outro id', () => {
    expect(destinoPermitido(FUNIL_PRECATORIO_INTERNO, 99_001, 'FECHADOS')).toBe(true)
    expect(destinoPermitido(FUNIL_PRECATORIO_INTERNO, 99_002, 'nao fechados')).toBe(true)
    expect(destinoPermitido(FUNIL_PRECATORIO_EXTERNO, 99_003, 'Sem Resposta')).toBe(true)
  })

  // A ORIGEM NÃO É DESTINO: mover PARA a Negociação continua recusado.
  it('a própria Negociação continua recusada', () => {
    expect(destinoPermitido(FUNIL_PRECATORIO_INTERNO, IDS_INTERNO['Negociação'], 'Negociação')).toBe(false)
    expect(destinoPermitido(FUNIL_PRECATORIO_EXTERNO, IDS_EXTERNO['NEGOCIAÇÃO'], 'NEGOCIAÇÃO')).toBe(false)
  })

  // OS DESTINOS SÃO DO FUNIL CERTO: o Fechados de um não abre o do outro.
  it('o destino de uma trilha não vale na outra', () => {
    expect(destinoPermitido(FUNIL_PRECATORIO_INTERNO, IDS_EXTERNO['FECHADOS'], null)).toBe(false)
    expect(destinoPermitido(FUNIL_PRECATORIO_EXTERNO, IDS_INTERNO['Fechados'], null)).toBe(false)
  })
})

/**
 * A NEGOCIAÇÃO NÃO TEM `saidas`, NOS TRÊS FUNIS. É a trava do princípio da
 * etapa: saída vira botão na tela oficial para todo mundo. Quem puser os
 * destinos da Negociação em `saidas` derruba este teste.
 */
describe('Negociação não tem `saidas`', () => {
  for (const key of ['interno', 'externo'] as const) {
    it(`${key}: nenhuma aba da trilha é a Negociação, nem sai para os destinos dela`, () => {
      const t = trilha(key)
      const n = t.negociacao!
      const destinos = destinosDaNegociacao(t).map((d) => d.statusId)
      for (const aba of t.abas) {
        expect(aba.statusId, aba.key).not.toBe(n.coluna.statusId)
        for (const s of aba.saidas ?? []) expect(destinos, `${aba.key} · ${s.label}`).not.toContain(s.statusId)
      }
    })
  }

  // O RPV NÃO TEM TRILHA: as abas são `TELAS` e os botões, `ACOES`. Nenhuma tela
  // é a Negociação, e nenhum botão move para os destinos dela.
  it('RPV: nenhuma tela é a Negociação, e nenhuma ação vai aos destinos dela', () => {
    expect(TELAS.some((t) => t.statusId === NEGOCIACAO_RPV.coluna)).toBe(false)
    for (const acoes of Object.values(ACOES)) {
      for (const a of acoes) expect(DESTINOS_DA_NEGOCIACAO_RPV.has(a.statusId), a.label).toBe(false)
    }
  })
})

/**
 * A TELA OFICIAL NÃO GANHA BOTÃO. Em nenhuma aba de nenhum funil algum movimento
 * vai para os destinos da Negociação, e a aba da Negociação (leitura, no Interno
 * e no Externo) não oferece nada — nem os botões pagos.
 */
describe('a tela oficial não oferece o desfecho da Negociação', () => {
  const etapas = espelhoDosTresFunis()

  it('nenhum movimento da tela vai para os destinos da Negociação', () => {
    const casos = [
      [FUNIL_RPV, 'interno', DESTINOS.RPV],
      [FUNIL_PRECATORIO, 'interno', DESTINOS.Interno],
      [FUNIL_PRECATORIO, 'externo', DESTINOS.Externo],
    ] as const
    for (const [funil, sub, destinos] of casos) {
      for (const a of abasDoFunil(funil, etapas, sub)) {
        for (const id of destinosDaAba(a)) expect(destinos as readonly number[], `${sub} · ${a.label}`).not.toContain(id)
      }
    }
  })

  it('a aba da Negociação, onde existe, é só de leitura, sem botão nenhum', () => {
    // NO EXTERNO ela existe, pelo espelho completo: leitura, sem nada.
    const id = IDS_EXTERNO['NEGOCIAÇÃO']
    const a = abasDoFunil(FUNIL_PRECATORIO, etapas, 'externo').find((x) => x.statusIds[0] === id)!
    expect(a).toMatchObject({ key: `col-${id}`, soLeitura: true, acoes: [] })
    expect(destinosDaAba(a)).toEqual([])
    expect(botoesDaAba(FUNIL_PRECATORIO, 'externo', a)).toBe('nenhum')
    // NA BETA (branch redesenho), o Interno e o RPV mostram TODAS as colunas do
    // Kommo nas quatro fases (etapa 7), então a Negociação vira aba aqui também —
    // e vale a mesma regra do Externo: só leitura, sem movimento e sem botão
    // pago. Na main, onde o redesenho ainda não chegou, ela nem é aba.
    for (const [funil, idNeg] of [
      [FUNIL_PRECATORIO, IDS_INTERNO['Negociação']],
      [FUNIL_RPV, NEGOCIACAO_RPV.coluna],
    ] as const) {
      const abas = funil === FUNIL_RPV ? abasDoFunil(FUNIL_RPV, etapas) : abasDoFunil(FUNIL_PRECATORIO, etapas, 'interno')
      const neg = abas.find((x) => x.statusIds.includes(idNeg))
      expect(neg, `Negociação deveria ser aba no funil ${funil}`).toBeDefined()
      expect(neg!.soLeitura).toBe(true)
      expect(destinosDaAba(neg!)).toEqual([])
      expect(botoesDaAba(funil, 'interno', neg!)).toBe('nenhum')
    }
  })

  it('as duas trilhas declaram a Negociação', () => {
    expect(SUBDIVISOES_PRECATORIO.every((s) => s.negociacao !== undefined)).toBe(true)
  })
})

describe('servicoDaNota — o selo da anotação, decidido pelo destino', () => {
  it('"Comercial" para os três destinos da Negociação, nos três funis', () => {
    for (const id of DESTINOS.RPV) expect(servicoDaNota(FUNIL_RPV, id, null), String(id)).toBe('Comercial')
    // NO RPV, PELO ID SÓ: o status_id é único na conta, e o funil pode faltar.
    for (const id of DESTINOS.RPV) expect(servicoDaNota(null, id, null), String(id)).toBe('Comercial')
    for (const id of DESTINOS.Interno) expect(servicoDaNota(FUNIL_PRECATORIO_INTERNO, id, null), String(id)).toBe('Comercial')
    for (const id of DESTINOS.Externo) expect(servicoDaNota(FUNIL_PRECATORIO_EXTERNO, id, null), String(id)).toBe('Comercial')
  })

  // O MESMO NOME DE RESERVA QUE AUTORIZOU O MOVIMENTO decide o selo.
  it('"Comercial" também pelo nome de reserva, no Precatório', () => {
    expect(servicoDaNota(FUNIL_PRECATORIO_INTERNO, 99_001, 'Fechados')).toBe('Comercial')
    expect(servicoDaNota(FUNIL_PRECATORIO_EXTERNO, 99_002, 'NÃO FECHADO')).toBe('Comercial')
    expect(servicoDaNota(FUNIL_PRECATORIO_EXTERNO, 99_003, 'sem resposta')).toBe('Comercial')
  })

  it('"Operacional" em todo o resto, como sempre foi', () => {
    // Os destinos de antes, nos três funis.
    for (const id of [107272803, 107272807, 107830027, 107830035, 107830031]) {
      expect(servicoDaNota(null, id, null), String(id)).toBe('Operacional')
    }
    expect(servicoDaNota(FUNIL_PRECATORIO_INTERNO, IDS_INTERNO['Revisão'], 'Revisão')).toBe('Operacional')
    expect(servicoDaNota(FUNIL_PRECATORIO_INTERNO, IDS_INTERNO['Reprovados'], 'Reprovados')).toBe('Operacional')
    expect(servicoDaNota(FUNIL_PRECATORIO_EXTERNO, IDS_EXTERNO['EM PRECIFICAÇÃO'], 'EM PRECIFICAÇÃO')).toBe('Operacional')
    expect(servicoDaNota(FUNIL_PRECATORIO_EXTERNO, IDS_EXTERNO['REPROVADOS'], 'REPROVADOS')).toBe('Operacional')
    // A Negociação em si não é destino, e não muda o selo.
    expect(servicoDaNota(FUNIL_PRECATORIO_INTERNO, IDS_INTERNO['Negociação'], 'Negociação')).toBe('Operacional')
    expect(servicoDaNota(FUNIL_RPV, NEGOCIACAO_RPV.coluna, 'Negociação')).toBe('Operacional')
    // Sem funil, no Precatório, nada a casar: o padrão.
    expect(servicoDaNota(null, IDS_INTERNO['Fechados'], 'Fechados')).toBe('Operacional')
  })

  // O DESTINO DE UM FUNIL não carimba "Comercial" no outro.
  it('o Fechados de uma trilha não vale na outra', () => {
    expect(servicoDaNota(FUNIL_PRECATORIO_EXTERNO, IDS_INTERNO['Fechados'], null)).toBe('Operacional')
    expect(servicoDaNota(999, IDS_INTERNO['Fechados'], 'Fechados')).toBe('Operacional')
  })
})

/**
 * A ORIGEM: o desfecho da Negociação só sai da Negociação DO MESMO FUNIL, pelo
 * espelho (`kommo_leads.status_id`). Card fora do espelho é recusado — não há como
 * saber de onde ele sai, e mover para "Fechados" dispara automações que não se
 * desfazem. Os outros destinos não passam por esta conferência.
 */
describe('recusaDaOrigem — o desfecho só sai da Negociação do mesmo funil', () => {
  const NEG = {
    RPV: { statusId: NEGOCIACAO_RPV.coluna, pipelineId: FUNIL_RPV, nome: 'Negociação' },
    Interno: { statusId: IDS_INTERNO['Negociação'], pipelineId: FUNIL_PRECATORIO_INTERNO, nome: 'Negociação' },
    Externo: { statusId: IDS_EXTERNO['NEGOCIAÇÃO'], pipelineId: FUNIL_PRECATORIO_EXTERNO, nome: 'NEGOCIAÇÃO' },
  }
  const destino = (pipelineId: number | null, statusId: number, nome = 'Fechados') => ({ pipelineId, statusId, nome })

  it('da Negociação do mesmo funil: aceita, nos três funis', () => {
    // NO RPV a kommo-mover não tem o funil do destino (a permissão é `COLUNAS`).
    for (const id of DESTINOS.RPV) expect(recusaDaOrigem(destino(null, id), NEG.RPV), String(id)).toBeNull()
    for (const id of DESTINOS.Interno) expect(recusaDaOrigem(destino(FUNIL_PRECATORIO_INTERNO, id), NEG.Interno), String(id)).toBeNull()
    for (const id of DESTINOS.Externo) expect(recusaDaOrigem(destino(FUNIL_PRECATORIO_EXTERNO, id), NEG.Externo), String(id)).toBeNull()
  })

  it('de outra coluna: recusa, dizendo onde o card está', () => {
    const daAnalise = { statusId: IDS_INTERNO['Análise jurídica e econômica'], pipelineId: FUNIL_PRECATORIO_INTERNO, nome: 'Análise jurídica e econômica' }
    expect(recusaDaOrigem(destino(FUNIL_PRECATORIO_INTERNO, IDS_INTERNO['Fechados']), daAnalise)).toBe(
      'Só se move para "Fechados" a partir da Negociação, e o card está em "Análise jurídica e econômica".',
    )
    expect(recusaDaOrigem(destino(null, 107830043), { statusId: 107830035, pipelineId: FUNIL_RPV, nome: 'Produção de proposta' })).toMatch(
      /a partir da Negociação, e o card está em "Produção de proposta"/,
    )
    // SEM O NOME DA ORIGEM, a mensagem não inventa um.
    expect(recusaDaOrigem(destino(FUNIL_PRECATORIO_EXTERNO, IDS_EXTERNO['FECHADOS'], 'FECHADOS'), { statusId: IDS_EXTERNO['PAGOS'] })).toBe(
      'Só se move para "FECHADOS" a partir da Negociação, e o card está em outra coluna.',
    )
  })

  // O MESMO FUNIL: a Negociação de uma trilha não abre o desfecho da outra.
  it('da Negociação de OUTRO funil: recusa', () => {
    expect(recusaDaOrigem(destino(FUNIL_PRECATORIO_INTERNO, IDS_INTERNO['Fechados']), NEG.Externo)).not.toBeNull()
    expect(recusaDaOrigem(destino(FUNIL_PRECATORIO_EXTERNO, IDS_EXTERNO['FECHADOS']), NEG.Interno)).not.toBeNull()
    expect(recusaDaOrigem(destino(null, 107830043), NEG.Interno)).not.toBeNull()
    expect(recusaDaOrigem(destino(FUNIL_PRECATORIO_INTERNO, IDS_INTERNO['Fechados']), NEG.RPV)).not.toBeNull()
  })

  it('card fora do espelho: recusa, com o caminho para resolver', () => {
    const msg = recusaDaOrigem(destino(FUNIL_PRECATORIO_INTERNO, IDS_INTERNO['Sem resposta'], 'Sem resposta'), null)
    expect(msg).toBe(
      'Só se move para "Sem resposta" a partir da Negociação, e o card não está no espelho local ' +
        'para conferir em que coluna ele está. Sincronize o Kommo e tente de novo.',
    )
    expect(recusaDaOrigem(destino(null, 112466388, 'Sem resposta'), null)).not.toBeNull()
  })

  // A NEGOCIAÇÃO RECRIADA NO KOMMO (id novo) casa pelo nome — só no mesmo funil.
  it('pelo nome de reserva da Negociação, no mesmo funil', () => {
    expect(recusaDaOrigem(destino(FUNIL_PRECATORIO_INTERNO, IDS_INTERNO['Fechados']), { statusId: 99_100, pipelineId: FUNIL_PRECATORIO_INTERNO, nome: 'NEGOCIACAO' })).toBeNull()
    expect(recusaDaOrigem(destino(FUNIL_PRECATORIO_INTERNO, IDS_INTERNO['Fechados']), { statusId: 99_100, pipelineId: FUNIL_PRECATORIO_EXTERNO, nome: 'Negociação' })).not.toBeNull()
    // NO RPV NÃO HÁ NOME DE RESERVA: liga-se só pelo id.
    expect(recusaDaOrigem(destino(null, 107830043), { statusId: 99_100, pipelineId: FUNIL_RPV, nome: 'Negociação' })).not.toBeNull()
  })

  // O DESTINO ACEITO PELO NOME DE RESERVA (coluna recriada) também exige a origem.
  it('o destino aceito pelo nome de reserva também exige a Negociação', () => {
    expect(recusaDaOrigem(destino(FUNIL_PRECATORIO_EXTERNO, 99_200, 'SEM RESPOSTA'), { statusId: IDS_EXTERNO['PAGOS'], pipelineId: FUNIL_PRECATORIO_EXTERNO })).not.toBeNull()
    expect(recusaDaOrigem(destino(FUNIL_PRECATORIO_EXTERNO, 99_200, 'SEM RESPOSTA'), NEG.Externo)).toBeNull()
  })

  // OS OUTROS DESTINOS NÃO MUDAM: nada de conferência, nem com o card fora do espelho.
  it('os outros destinos passam direto, como sempre', () => {
    expect(recusaDaOrigem(destino(null, 107830031, 'Reprovados operacional'), null)).toBeNull()
    expect(recusaDaOrigem(destino(null, 107272807, 'Revisão'), { statusId: 107272803, pipelineId: FUNIL_RPV })).toBeNull()
    expect(recusaDaOrigem(destino(FUNIL_PRECATORIO_INTERNO, IDS_INTERNO['Revisão'], 'Revisão'), null)).toBeNull()
    expect(recusaDaOrigem(destino(FUNIL_PRECATORIO_EXTERNO, IDS_EXTERNO['EM PRECIFICAÇÃO'], 'EM PRECIFICAÇÃO'), null)).toBeNull()
  })

  it('negociacaoDoDestino: a Negociação exigida, ou null', () => {
    expect(negociacaoDoDestino(null, 107830067, null)).toEqual({ pipelineId: null, coluna: { colunaKommo: 'Negociação', statusId: 107830039 } })
    expect(negociacaoDoDestino(FUNIL_PRECATORIO_INTERNO, IDS_INTERNO['Não fechados'], null)).toEqual({
      pipelineId: FUNIL_PRECATORIO_INTERNO,
      coluna: { colunaKommo: 'Negociação', statusId: IDS_INTERNO['Negociação'] },
    })
    expect(negociacaoDoDestino(FUNIL_PRECATORIO_EXTERNO, IDS_EXTERNO['NÃO FECHADO'], null)?.coluna.statusId).toBe(IDS_EXTERNO['NEGOCIAÇÃO'])
    expect(negociacaoDoDestino(FUNIL_PRECATORIO_INTERNO, IDS_INTERNO['Negociação'], 'Negociação')).toBeNull()
    expect(negociacaoDoDestino(null, IDS_INTERNO['Fechados'], 'Fechados')).toBeNull()
    expect(negociacaoDoDestino(999, 1, 'Fechados')).toBeNull()
  })
})
