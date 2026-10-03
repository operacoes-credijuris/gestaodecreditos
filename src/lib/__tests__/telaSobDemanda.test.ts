/**
 * AS TELAS SOB DEMANDA (revisão pós-virada, 03/10/2026) — a regra da recarga.
 *
 * Com cada tela num pedaço do pacote, uma publicação no meio do dia apaga os
 * pedaços da versão antiga, e quem está com a aba aberta pede um arquivo que já
 * não existe. A tela recarrega UMA vez para buscar a versão nova; uma segunda
 * falha logo em seguida não recarrega (seria um laço).
 */
import { describe, it, expect } from 'vitest'
import {
  deveRecarregar,
  ehFalhaDeCarga,
  INTERVALO_ENTRE_RECARGAS_MS,
} from '@/lib/telaSobDemanda'

describe('ehFalhaDeCarga', () => {
  it('reconhece a falha de pedaço do pacote nos navegadores', () => {
    for (const msg of [
      // Chrome / Edge
      'Failed to fetch dynamically imported module: https://x/gestaodecreditos/assets/Processos-abc.js',
      // Firefox
      'error loading dynamically imported module: https://x/assets/Tarefas-1.js',
      // Safari
      'Importing a module script failed.',
      // Vite, ao pré-carregar o CSS de um pedaço
      'Unable to preload CSS for /assets/Configuracoes-9.css',
    ]) {
      expect(ehFalhaDeCarga(new Error(msg)), msg).toBe(true)
    }
  })

  it('não confunde com erro de tela ou de dado', () => {
    expect(ehFalhaDeCarga(new Error('Cannot read properties of undefined (reading "map")'))).toBe(false)
    expect(ehFalhaDeCarga(new Error('Não foi possível carregar os dados.'))).toBe(false)
    expect(ehFalhaDeCarga(null)).toBe(false)
    expect(ehFalhaDeCarga(undefined)).toBe(false)
  })
})

describe('deveRecarregar', () => {
  const agora = 1_800_000_000_000

  it('recarrega quando não houve recarga antes', () => {
    expect(deveRecarregar(agora, null)).toBe(true)
    expect(deveRecarregar(agora, Number.NaN)).toBe(true)
  })

  it('NÃO recarrega de novo logo depois de uma recarga (laço)', () => {
    expect(deveRecarregar(agora, agora - 1_000)).toBe(false)
    expect(deveRecarregar(agora, agora - INTERVALO_ENTRE_RECARGAS_MS)).toBe(false)
  })

  it('recarrega de novo passado o intervalo (outra publicação, mais tarde)', () => {
    expect(deveRecarregar(agora, agora - INTERVALO_ENTRE_RECARGAS_MS - 1)).toBe(true)
  })

  it('relógio que voltou conta como "não houve recarga"', () => {
    expect(deveRecarregar(agora, agora + 60_000)).toBe(true)
  })
})
