/**
 * A FALHA DO ROBÔ DO ESCAVADOR (pedido do dono, 07/10/2026): o que se repete,
 * de quanto em quanto, até quando, e quando o card recebe nota.
 */
import { describe, it, expect } from 'vitest'
import {
  codigoDoRoboNoDetalhe,
  depoisDaFalhaDoRobo,
  falhaPassageiraDoRobo,
  horaDeConferir,
  horaDeRepetir,
  INTERVALO_REPETIR_MIN,
  TENTATIVAS_DO_ROBO_PADRAO,
  tetoDoRobo,
  voltouParaAEntrada,
} from '../../../supabase/functions/_shared/falhasDosAutos.ts'
import {
  motivoDoEstado,
  notaDaDesistenciaDoRobo,
  notaDaFalhaDoRobo,
  notaDaNovaRodada,
  notaDeFalha,
} from '../../../supabase/functions/_shared/autosParaOKommo.ts'

const MIN = 60_000
const CNJ = '0001234-56.2021.8.03.0001'

describe('passageira × definitiva', () => {
  it('INTERNAL_ERROR e LOGIN_ERROR se repetem', () => {
    expect(falhaPassageiraDoRobo('ERRO', 'INTERNAL_ERROR')).toBe('INTERNAL_ERROR')
    expect(falhaPassageiraDoRobo('erro', 'login_error')).toBe('LOGIN_ERROR')
    expect(falhaPassageiraDoRobo('ERRO', 'TIMEOUT')).toBe('TIMEOUT')
  })

  it('processo físico, sigilo, não encontrado e o resto não se repetem', () => {
    expect(falhaPassageiraDoRobo('ERRO', 'PROCESSO_FISICO')).toBeNull()
    expect(falhaPassageiraDoRobo('ERRO', 'SEGREDO_JUSTICA')).toBeNull()
    expect(falhaPassageiraDoRobo('ERRO', 'CAPTCHA_ERROR')).toBeNull()
    expect(falhaPassageiraDoRobo('ERRO', null)).toBeNull()
    expect(falhaPassageiraDoRobo('NAO_ENCONTRADO', 'INTERNAL_ERROR')).toBeNull()
    expect(falhaPassageiraDoRobo('SUCESSO', null)).toBeNull()
  })

  it('acha o código no texto dos processos que já estão em FALHOU', () => {
    expect(codigoDoRoboNoDetalhe(motivoDoEstado('ERRO', 'INTERNAL_ERROR'))).toBe('INTERNAL_ERROR')
    expect(codigoDoRoboNoDetalhe('o robô não conseguiu entrar no tribunal (LOGIN_ERROR)')).toBe('LOGIN_ERROR')
    expect(codigoDoRoboNoDetalhe(motivoDoEstado('ERRO', 'PROCESSO_FISICO'))).toBeNull()
    // A recusa do pedido por certificado/2FA (HTTP 422) precisa do dono no painel do Escavador.
    expect(codigoDoRoboNoDetalhe('O Escavador recusou o pedido (HTTP 422): certificados … 2FA')).toBeNull()
    expect(codigoDoRoboNoDetalhe(null)).toBeNull()
  })
})

describe('o teto', () => {
  it('seis por padrão; configurável por processo, entre 1 e 24', () => {
    expect(TENTATIVAS_DO_ROBO_PADRAO).toBe(6)
    expect(tetoDoRobo(null)).toBe(6)
    expect(tetoDoRobo(3)).toBe(3)
    expect(tetoDoRobo(0)).toBe(6)
    expect(tetoDoRobo(500)).toBe(24)
  })
})

describe('a rodada inteira: nota só na primeira falha e no fim', () => {
  it('seis falhas seguidas: avisa na 1ª, silêncio, desiste na 6ª', () => {
    const notas: (string | null)[] = []
    const estados: string[] = []
    let jaAvisou = false
    for (let tentativas = 1; tentativas <= 6; tentativas++) {
      const d = depoisDaFalhaDoRobo({ tentativas, teto: 6, jaAvisou })
      notas.push(d.nota)
      estados.push(d.estado)
      jaAvisou = true
      if (d.estado === 'FALHOU') break
    }
    expect(notas).toEqual(['primeira', null, null, null, null, 'fim'])
    expect(estados).toEqual(['REPETIR', 'REPETIR', 'REPETIR', 'REPETIR', 'REPETIR', 'FALHOU'])
  })

  it('pedido de antes da contagem conta como 1', () => {
    expect(depoisDaFalhaDoRobo({ tentativas: 0, teto: 6, jaAvisou: false })).toMatchObject({ estado: 'REPETIR', tentativas: 1 })
  })

  it('teto 1: a única nota é a do fim', () => {
    expect(depoisDaFalhaDoRobo({ tentativas: 1, teto: 1, jaAvisou: false })).toMatchObject({ estado: 'FALHOU', nota: 'fim' })
  })
})

describe('o agendamento de 10 em 10 minutos', () => {
  const t0 = Date.parse('2026-10-07T12:00:00Z')

  it('repete 10 minutos depois do último pedido pago (com a folga do cron), não antes', () => {
    expect(INTERVALO_REPETIR_MIN).toBe(10)
    expect(horaDeRepetir(t0, t0 + 3 * MIN)).toBe(false)
    // O aviso do Escavador acorda a rotina a qualquer hora: não pode virar pedido.
    expect(horaDeRepetir(t0, t0 + 8 * MIN)).toBe(false)
    expect(horaDeRepetir(t0, t0 + 9 * MIN + 30_000)).toBe(true)
    expect(horaDeRepetir(t0, t0 + 10 * MIN)).toBe(true)
    expect(horaDeRepetir(null, t0)).toBe(true)
  })

  it('na rodada, confere de 10 em 10; fora dela, de 30 em 30', () => {
    expect(horaDeConferir(t0, t0 + 10 * MIN, true)).toBe(true)
    expect(horaDeConferir(t0, t0 + 10 * MIN, false)).toBe(false)
    expect(horaDeConferir(t0, t0 + 30 * MIN, false)).toBe(true)
    expect(horaDeConferir(null, t0, false)).toBe(true)
  })

  it('seis tentativas cabem em uma hora: um ciclo de cron por tentativa', () => {
    // pedido pago no minuto 0; o cron confere no 10, vê a falha e pede de novo na mesma volta.
    let ultimo = t0
    let pedidos = 1
    for (let m = 10; m <= 60; m += 10) {
      const agora = t0 + m * MIN
      if (horaDeConferir(ultimo, agora, true) && horaDeRepetir(ultimo, agora) && pedidos < 6) {
        pedidos++
        ultimo = agora
      }
    }
    expect(pedidos).toBe(6)
  })
})

describe('outra rodada: o card devolvido à entrada', () => {
  it('vale só se voltou DEPOIS da desistência e está na entrada', () => {
    const desistiu = '2026-10-07T13:00:00Z'
    expect(voltouParaAEntrada({ naEntrada: true, etapaEm: '2026-10-07T14:00:00Z', desistiuEm: desistiu })).toBe(true)
    expect(voltouParaAEntrada({ naEntrada: true, etapaEm: '2026-10-07T12:00:00Z', desistiuEm: desistiu })).toBe(false)
    expect(voltouParaAEntrada({ naEntrada: false, etapaEm: '2026-10-07T14:00:00Z', desistiuEm: desistiu })).toBe(false)
    expect(voltouParaAEntrada({ naEntrada: true, etapaEm: null, desistiuEm: desistiu })).toBe(false)
  })
})

describe('as notas', () => {
  it('a primeira diz que é do Escavador, não da Credijuris, e que tenta de novo', () => {
    const t = notaDaFalhaDoRobo({ cnj: CNJ, rotulo: 'Precatório', codigo: 'LOGIN_ERROR', teto: 6, intervaloMin: 10 })
    expect(t).toContain('Falha do Escavador')
    expect(t).toContain(`processo ${CNJ} (precatório)`)
    expect(t).toContain('(LOGIN_ERROR)')
    expect(t).toContain('Não é erro da Credijuris')
    expect(t).toContain('a cada 10 minutos')
    expect(t).toContain('até 6 vezes')
  })

  it('a do fim diz quantas vezes e como tentar de novo', () => {
    const t = notaDaDesistenciaDoRobo({ cnj: CNJ, rotulo: 'Conhecimento', codigo: 'INTERNAL_ERROR', tentativas: 6 })
    expect(t).toContain('depois de 6 tentativa(s)')
    expect(t).toContain('parei de tentar')
    expect(t).toContain('devolva-o a ela')
  })

  it('a nova rodada e a falha comum dizem o processo e o papel', () => {
    expect(notaDaNovaRodada({ cnj: CNJ, rotulo: 'Autos', codigo: 'INTERNAL_ERROR', teto: 6, intervaloMin: 10, porque: 'O card voltou' }))
      .toContain(`processo ${CNJ} ao Escavador`)
    expect(notaDeFalha(CNJ, 'o robô não achou o processo', 'Cumprimento')).toContain(`processo ${CNJ} (cumprimento) pelo Escavador`)
  })
})
