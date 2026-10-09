/**
 * O BOTÃO "SEM PROPOSTA" (09/10/2026, pedido do dono): na Em precificação do
 * Externo, quando nenhum fundo propôs — tira TODAS as etiquetas, põe "Sem
 * proposta", move para Reprovados (num PATCH só) e anota o motivo.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ABA_EM_PRECIFICACAO_EXTERNO,
  ehDestinoDoSemProposta,
  ETIQUETA_SEM_PROPOSTA,
  FUNIL_PRECATORIO_EXTERNO,
  NOTA_SEM_PROPOSTA,
  TRILHAS_PRECATORIO as SUBDIVISOES_PRECATORIO,
} from '../../../supabase/functions/_shared/trilhasDoPrecatorio.ts'

const ler = (rel: string) => readFileSync(join(__dirname, '..', '..', '..', rel), 'utf8')

describe('Sem proposta', () => {
  it('só a Em precificação do Externo declara, e o destino é Reprovados (111534212)', () => {
    const comBotao = SUBDIVISOES_PRECATORIO.flatMap((s) => s.abas.filter((a) => a.semProposta).map((a) => a.key))
    expect(comBotao).toEqual([ABA_EM_PRECIFICACAO_EXTERNO])
    const externo = SUBDIVISOES_PRECATORIO.find((s) => s.key === 'externo')!
    expect(externo.abas.find((a) => a.key === ABA_EM_PRECIFICACAO_EXTERNO)?.semProposta).toEqual({
      colunaKommo: 'REPROVADOS',
      statusId: 111534212,
    })
  })

  it('a kommo-mover só limpa as etiquetas para esse destino', () => {
    expect(ehDestinoDoSemProposta(FUNIL_PRECATORIO_EXTERNO, 111534212)).toBe(true)
    expect(ehDestinoDoSemProposta(FUNIL_PRECATORIO_EXTERNO, 111533988)).toBe(false)
    expect(ehDestinoDoSemProposta(0, 111534212)).toBe(false)
  })

  it('a etiqueta e a nota são as pedidas', () => {
    expect(ETIQUETA_SEM_PROPOSTA).toBe('Sem proposta')
    expect(NOTA_SEM_PROPOSTA).toBe('Não conseguimos qualquer proposta para este crédito.')
  })

  it('o movimento leva as etiquetas no mesmo PATCH, lidas do Kommo; sem a leitura, nada se move', () => {
    const f = ler('supabase/functions/kommo-mover/index.ts')
    expect(f).toContain('JSON.stringify({ status_id: statusId, ...etiquetasDoPatch })')
    expect(f).toContain("Não consegui ler as etiquetas do card no Kommo; nada foi movido.")
    expect(f).toContain('ehDestinoDoSemProposta(Number(linhaDoPrecatorio.pipeline_id), statusId)')
  })

  it('a tela pede confirmação e vai pelo caminho dos desfechos', () => {
    const t = ler('src/pages/operacional/AnaliseCredito.tsx')
    expect(t).toContain('onSemProposta={abaAtual?.semProposta ? (l) => setSemPropostaDe(l) : undefined}')
    expect(t).toContain('moverComNota(lead.kommo_lead_id, statusId, NOTA_SEM_PROPOSTA, { semProposta: true })')
    expect(t).toContain('confirmLabel="Confirmar sem proposta"')
  })
})
