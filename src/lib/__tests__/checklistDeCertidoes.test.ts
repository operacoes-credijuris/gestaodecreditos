/**
 * O CHECKLIST DE CERTIDÕES ARRUMADO PARA A TELA (lib/checklistDeCertidoes.ts).
 *
 * A aba de certidões foi enxugada em 03/10/2026 (pedido do dono): o que pede
 * ação primeiro, as obtidas recolhidas no fim, e um placar curto no topo. Estes
 * testes prendem as regras que a pessoa lê como verdade — em que grupo cada
 * item cai, o que cada número conta, e qual pasta do Drive o atalho abre.
 */
import { describe, it, expect } from 'vitest'
import {
  agruparChecklist,
  avisoDaIAEmDestaque,
  conferenciaDoOficio,
  grupoDoItem,
  hojeEmBrasilia,
  origemDoCadastro,
  pastaDoChecklistNaTela,
  placarDoChecklist,
  rotuloNoNumero,
  vencida,
} from '../checklistDeCertidoes'

const HOJE = '2026-10-03'
const item = (status: string, extra: Record<string, unknown> = {}) => ({ status, obrigatoria: true, ...extra })

describe('grupoDoItem', () => {
  it('falha e pendência manual são problema', () => {
    expect(grupoDoItem(item('FALHA'), HOJE)).toBe('problema')
    expect(grupoDoItem(item('PENDENTE_MANUAL'), HOJE)).toBe('problema')
  })
  it('obtida vencida é problema; obtida válida (ou sem validade) é obtida', () => {
    expect(grupoDoItem(item('OBTIDA', { validade_ate: '2026-10-02' }), HOJE)).toBe('problema')
    expect(grupoDoItem(item('OBTIDA', { validade_ate: HOJE }), HOJE)).toBe('obtida')
    expect(grupoDoItem(item('OBTIDA', { validade_ate: null }), HOJE)).toBe('obtida')
  })
  it('em emissão, dispensada e pendente', () => {
    expect(grupoDoItem(item('EM_EMISSAO'), HOJE)).toBe('emissao')
    expect(grupoDoItem(item('NAO_APLICAVEL'), HOJE)).toBe('dispensada')
    expect(grupoDoItem(item('PENDENTE'), HOJE)).toBe('pendente')
  })
  it('estado desconhecido não some: vai para pendente', () => {
    expect(grupoDoItem(item('ESTADO_NOVO'), HOJE)).toBe('pendente')
  })
  it('vencida só vale para obtida', () => {
    expect(vencida(item('PENDENTE', { validade_ate: '2020-01-01' }), HOJE)).toBe(false)
  })
})

describe('agruparChecklist', () => {
  it('ordem da tela: problema, pendente, emissão, obtida, dispensada — sem grupo vazio', () => {
    const itens = [
      { ...item('OBTIDA'), nome: 'B' },
      { ...item('NAO_APLICAVEL'), nome: 'C' },
      { ...item('PENDENTE'), nome: 'Z' },
      { ...item('PENDENTE'), nome: 'A' },
      { ...item('FALHA'), nome: 'D' },
    ]
    const g = agruparChecklist(itens, HOJE, (i) => i.nome)
    expect(g.map((x) => x.grupo)).toEqual(['problema', 'pendente', 'obtida', 'dispensada'])
    expect(g[1].itens.map((i) => i.nome)).toEqual(['A', 'Z'])
  })
  it('nenhum item se perde no agrupamento', () => {
    const itens = ['OBTIDA', 'FALHA', 'X', 'EM_EMISSAO', 'NAO_APLICAVEL', 'PENDENTE'].map((s, n) => ({ ...item(s), nome: String(n) }))
    const g = agruparChecklist(itens, HOJE, (i) => i.nome)
    expect(g.reduce((t, x) => t + x.itens.length, 0)).toBe(itens.length)
  })
})

describe('placarDoChecklist', () => {
  it('conta só as obrigatórias, e reparte os pendentes da view pelo que se faz com eles', () => {
    const p = placarDoChecklist(
      [
        item('PENDENTE'),
        item('PENDENTE', { obrigatoria: false }),
        item('FALHA'),
        item('PENDENTE_MANUAL'),
        item('EM_EMISSAO'),
        item('OBTIDA', { validade_ate: '2026-01-01' }),
        item('OBTIDA', { validade_ate: '2027-01-01' }),
        item('NAO_APLICAVEL'),
      ],
      HOJE,
    )
    expect(p).toEqual({ pendentes: 1, problema: 3, emissao: 1, vencidas: 1 })
  })
})

describe('pastaDoChecklistNaTela', () => {
  it('a subpasta Certidões, quando um PDF já a registrou', () => {
    expect(
      pastaDoChecklistNaTela([{ arquivos: null }, { arquivos: [{ pasta_id: null }, { pasta_id: 'cert1' }] }], 'analise1'),
    ).toEqual({ url: 'https://drive.google.com/drive/folders/cert1', qual: 'certidoes' })
  })
  it('sem PDF com pasta, a pasta da análise do card', () => {
    expect(pastaDoChecklistNaTela([{ arquivos: [{}] }], 'analise1')).toEqual({
      url: 'https://drive.google.com/drive/folders/analise1',
      qual: 'analise',
    })
  })
  it('sem nenhuma das duas, nada', () => {
    expect(pastaDoChecklistNaTela([], '  ')).toBeNull()
    expect(pastaDoChecklistNaTela([], null)).toBeNull()
  })
})

describe('de onde veio o cadastro', () => {
  it('gravado e intocado não inventa origem', () => {
    expect(origemDoCadastro({ gravado: true, mexeu: false, doOficio: true, daIA: true })).toBe('cadastro gravado')
  })
  it('no formulário: ofício, depois IA, depois digitado', () => {
    expect(origemDoCadastro({ gravado: true, mexeu: true, doOficio: true, daIA: true })).toBe('do ofício')
    expect(origemDoCadastro({ gravado: false, mexeu: true, doOficio: false, daIA: true })).toBe('lido pela IA')
    expect(origemDoCadastro({ gravado: false, mexeu: false, doOficio: false, daIA: false })).toBe('digitado')
  })
  it('conferência com o ofício', () => {
    expect(conferenciaDoOficio({ temTitular: true, diverge: true, semOficio: false })?.tom).toBe('perigo')
    expect(conferenciaDoOficio({ temTitular: true, diverge: false, semOficio: false })?.tom).toBe('sucesso')
    expect(conferenciaDoOficio({ temTitular: false, diverge: false, semOficio: true })?.rotulo).toBe('sem ofício nos anexos')
    expect(conferenciaDoOficio({ temTitular: false, diverge: false, semOficio: false })).toBeNull()
  })
})

describe('auxiliares', () => {
  it('aviso da IA sobre documento vai em destaque', () => {
    expect(avisoDaIAEmDestaque('O CPF que a IA indicou não está escrito nos autos — descartado.')).toBe(true)
    expect(avisoDaIAEmDestaque('A residência anterior é de 2010.')).toBe(false)
  })
  it('hoje em Brasília', () => {
    expect(hojeEmBrasilia(new Date('2026-10-04T02:00:00Z'))).toBe('2026-10-03')
  })
})

describe('o rótulo do placar no número certo (auditoria visual, A4)', () => {
  it('um é singular; zero e dois ou mais, plural — nada de "1 pendentes"', () => {
    expect(rotuloNoNumero(1, 'pendente', 'pendentes')).toBe('pendente')
    expect(rotuloNoNumero(0, 'pendente', 'pendentes')).toBe('pendentes')
    expect(rotuloNoNumero(2, 'pendente', 'pendentes')).toBe('pendentes')
  })
})
