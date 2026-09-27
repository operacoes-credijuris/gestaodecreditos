/**
 * EM QUE PÉ ESTÃO OS AUTOS — a pergunta que o conector faz antes de entregar.
 *
 * O defeito que isto corrige: "não achei os autos" cobria três situações — ainda
 * lendo, leitura interrompida, código errado —, e o modelo, sem saber qual,
 * às vezes seguia sem eles. A análise saía com cara de completa, feita sobre
 * nada. Agora toda situação que não é "pronto" leva uma ordem de NÃO COMEÇAR.
 */
import { describe, it, expect } from 'vitest'
import {
  SILENCIO_MAXIMO_MS,
  situacaoDosAutos,
} from '../../../supabase/functions/_shared/esperaDosAutos.ts'

const AGORA = new Date('2026-09-27T15:00:00Z').getTime()
const ha = (ms: number) => new Date(AGORA - ms).toISOString()
const daquiA = (ms: number) => new Date(AGORA + ms).toISOString()

describe('situacaoDosAutos', () => {
  it('sem linha nenhuma, quem decide é a espera de quem chama', () => {
    expect(situacaoDosAutos(null, AGORA)).toBeNull()
  })

  // O TEXTO CHEGOU, entrega — mesmo com imagens a caminho. Segurar o texto por
  // causa delas atrasaria a análise inteira, e ver_paginas espera por elas.
  it('com arquivos, está pronto — inclusive com imagens ainda subindo', () => {
    expect(situacaoDosAutos({ arquivos: [{ nome: 'x.pdf' }], expira_em: daquiA(3600_000) }, AGORA))
      .toEqual({ tipo: 'pronto' })
    expect(
      situacaoDosAutos({ arquivos: [{ nome: 'x.pdf' }], estado: 'imagens', expira_em: daquiA(3600_000) }, AGORA),
    ).toEqual({ tipo: 'pronto' })
  })

  it('código vencido manda clicar de novo', () => {
    const s = situacaoDosAutos({ arquivos: [{ nome: 'x.pdf' }], expira_em: ha(1000) }, AGORA)
    expect(s?.tipo).toBe('vencido')
  })

  describe('enquanto os autos não chegaram', () => {
    const reservado = {
      arquivos: [],
      expira_em: daquiA(3600_000),
      atualizado_em: ha(10_000),
    }

    // A PROIBIÇÃO É O PONTO. Esperar não basta: sem a ordem expressa, o modelo
    // desistia e escrevia a análise com o que tinha.
    it('na fila, diz quantas estão à frente e proíbe começar', () => {
      const s = situacaoDosAutos(
        { ...reservado, estado: 'fila', progresso: { etapa: 'fila', na_frente: 2 } },
        AGORA,
      )
      expect(s?.tipo).toBe('esperando')
      expect(s && 'mensagem' in s && s.mensagem).toContain('2 análise(s) à frente')
      expect(s && 'mensagem' in s && s.mensagem).toContain('NÃO COMECE A ANÁLISE')
    })

    it('lendo, diz quantos arquivos já foram', () => {
      const s = situacaoDosAutos(
        { ...reservado, estado: 'lendo', progresso: { feitos: 7, total: 15 } },
        AGORA,
      )
      expect(s?.tipo).toBe('esperando')
      expect(s && 'mensagem' in s && s.mensagem).toContain('7 de 15 arquivo(s)')
    })

    it('falhou, diz o motivo e manda parar', () => {
      const s = situacaoDosAutos(
        { ...reservado, estado: 'falhou', progresso: { motivo: 'Não achei PDF no card.' } },
        AGORA,
      )
      expect(s?.tipo).toBe('falhou')
      const m = s && 'mensagem' in s ? s.mensagem : ''
      expect(m).toContain('Não achei PDF no card.')
      expect(m).toContain('NÃO faça a análise sem os autos')
    })

    // A ABA MORREU: sem sinal há mais de três minutos, esperar não traz nada.
    it('sem sinal de vida há muito tempo, conclui que a leitura parou', () => {
      const s = situacaoDosAutos(
        { ...reservado, estado: 'lendo', atualizado_em: ha(SILENCIO_MAXIMO_MS + 60_000) },
        AGORA,
      )
      expect(s?.tipo).toBe('parou')
      expect(s && 'mensagem' in s && s.mensagem).toContain('clicar de novo')
    })

    // UM ARQUIVO GRANDE NÃO É MORTE: o sinal vem a cada 45 segundos, e dois
    // minutos de silêncio ainda estão dentro do normal.
    it('silêncio curto ainda é espera', () => {
      const s = situacaoDosAutos(
        { ...reservado, estado: 'lendo', atualizado_em: ha(2 * 60_000) },
        AGORA,
      )
      expect(s?.tipo).toBe('esperando')
    })

    // ANTES DA MIGRAÇÃO 0069 não há estado nem sinal de vida: a linha reservada
    // vazia continua sendo espera, como sempre foi — nunca "parou" por engano.
    it('sem as colunas de andamento, é espera — e nunca "parou" por engano', () => {
      const s = situacaoDosAutos({ arquivos: [], expira_em: daquiA(3600_000) }, AGORA)
      expect(s?.tipo).toBe('esperando')
    })
  })
})
