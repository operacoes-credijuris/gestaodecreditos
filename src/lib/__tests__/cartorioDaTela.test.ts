// O CARTÓRIO DA PLANILHA É O DA TELA (revisão de 03/10/2026).
//
// O 'salvar' da `gerar-analise-rpv` recalculava o preço com a regra do corpo ou
// do cache, e as duas podiam ter chegado DEPOIS do preço que a tela mostrava
// (tabela que chega no meio de uma troca de cenário; levantamento que termina
// no servidor depois de a tela desistir). Agora cada rodada marca em `dados` a
// regra que usou, e o 'salvar' reproduz exatamente aquela.

import { describe, it, expect } from 'vitest'
import {
  CHAVE_EMOLUMENTOS_PRECIFICADOS as CHAVE,
  regraParaPrecificar,
} from '../../../supabase/functions/_shared/cartorioDaTela.ts'

const tabelaGO = { uf: 'GO', regra: { escritura: { faixas: [{ ate: null, valor: 900 }] } } }
const manualGO = { uf: 'GO', regra: { escritura: { faixas: [{ ate: null, valor: 1500 }] } } }

describe('regraParaPrecificar — no salvar, a regra que a tela viu manda', () => {
  it('a tela precificou SEM cartório e a tabela chegou depois (no corpo): a planilha sai sem cartório, como a tela', () => {
    expect(regraParaPrecificar('salvar', { [CHAVE]: null }, tabelaGO, 'GO')).toEqual({
      tipo: 'PRONTA',
      emolumentos: null,
      origem: 'nenhuma',
    })
  })

  it('a tela precificou sem cartório e nada veio no corpo: NÃO vai ao cache (que pode ter enchido depois)', () => {
    expect(regraParaPrecificar('salvar', { [CHAVE]: null }, null, 'GO').tipo).toBe('PRONTA')
  })

  it('a tela precificou com o custo manual e o corpo traz a tabela que chegou depois: vale o manual', () => {
    const r = regraParaPrecificar('salvar', { [CHAVE]: manualGO }, tabelaGO, 'GO')
    expect(r).toEqual({ tipo: 'PRONTA', emolumentos: manualGO, origem: 'tela_precificada' })
  })

  it('dados sem a marca (tela aberta antes do deploy): decide como sempre decidiu', () => {
    expect(regraParaPrecificar('salvar', {}, tabelaGO, 'GO')).toEqual({ tipo: 'PRONTA', emolumentos: tabelaGO, origem: 'corpo' })
    expect(regraParaPrecificar('salvar', {}, null, 'GO')).toEqual({ tipo: 'CACHE' })
  })
})

describe('regraParaPrecificar — nas outras rodadas, como sempre', () => {
  it('refinar/reprecificar ignoram a marca: elas reprecificam e a tela mostra o resultado', () => {
    expect(regraParaPrecificar('reprecificar', { [CHAVE]: null }, tabelaGO, 'GO')).toEqual({
      tipo: 'PRONTA',
      emolumentos: tabelaGO,
      origem: 'corpo',
    })
    expect(regraParaPrecificar('refinar', { [CHAVE]: manualGO }, null, 'GO')).toEqual({ tipo: 'CACHE' })
  })

  it('regra de outra UF é descartada (o tribunal foi corrigido no chat)', () => {
    expect(regraParaPrecificar('analisar', {}, { uf: 'SP', regra: {} }, 'GO')).toEqual({ tipo: 'CACHE' })
  })

  it('sem UF e sem regra: sem cartório, sem consultar nada', () => {
    expect(regraParaPrecificar('analisar', {}, null, null)).toEqual({ tipo: 'PRONTA', emolumentos: null, origem: 'nenhuma' })
  })

  it('regra sem `regra` dentro (a busca não achou) não conta como regra', () => {
    expect(regraParaPrecificar('reprecificar', {}, { uf: 'GO', regra: null }, 'GO')).toEqual({ tipo: 'CACHE' })
  })
})
