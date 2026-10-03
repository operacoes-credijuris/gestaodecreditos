// A lógica de tela da Análise de crédito redesenhada (src/lib/quadroDaAnalise.ts):
// o tempo na etapa, o título quebrado em campos, o nome da coluna, as fases do
// quadro, as barras, os filtros rápidos, a ordem e o resultado da busca.
//
// NADA AQUI MOVE CARD NEM ABRE O QUE É PAGO — isso é de botoesDaAba e
// matrizDeMovimentos. Estes testes prendem o que a tela MOSTRA.
import { describe, it, expect } from 'vitest'
import { abasDoFunil, FUNIL_PRECATORIO, FUNIL_RPV, type Aba } from '@/lib/kommo'
import type { KommoLead } from '@/lib/types'
import {
  achadosDaBusca,
  camposDoTitulo,
  diasNaEtapa,
  estaParado,
  fasesDoQuadro,
  filtrarEOrdenar,
  idadeCurta,
  larguraDaBarra,
  nomeDaColuna,
  PRAZO_PARADO,
  temCotacao,
  textoDaBusca,
  textoDosDias,
} from '@/lib/quadroDaAnalise'
import { espelhoDosTresFunis } from './fixtures/kanbans'

const COLUNA = 107272803

/** Um card na coluna de Análise do RPV, que entrou nela em `etapa_em`. */
const card = (id: number, etapa_em: string | null, extras: Partial<KommoLead> = {}): KommoLead =>
  ({
    kommo_lead_id: id,
    pipeline_id: FUNIL_RPV,
    status_id: COLUNA,
    nome: `Card ${id}`,
    responsavel_id: null,
    responsavel_nome: null,
    nota_texto: null,
    notas: [],
    processo_cnj: null,
    drive_pasta_id: null,
    oportunidade: null,
    tags: [],
    criado_em: '2026-08-01T10:00:00',
    atualizado_em: null,
    etapa_em,
    etapa_status_id: COLUNA,
    ...extras,
  }) as KommoLead

const AGORA = new Date('2026-10-02T08:00:00')

describe('tempo na etapa', () => {
  it('conta dias de calendário desde a entrada na coluna', () => {
    expect(diasNaEtapa(card(1, '2026-10-02T07:00:00'), AGORA)).toBe(0)
    // ONTEM ÀS 23H não é "desde hoje" às 8h.
    expect(diasNaEtapa(card(1, '2026-10-01T23:00:00'), AGORA)).toBe(1)
    expect(diasNaEtapa(card(1, '2026-09-23T16:20:00'), AGORA)).toBe(9)
  })

  it('sem data conhecida, nada — nem "nesta etapa" nem "parado"', () => {
    expect(diasNaEtapa(card(1, null), AGORA)).toBeNull()
    // A DATA É DE OUTRA COLUNA (o card se moveu depois do último sync): não vale.
    expect(diasNaEtapa(card(1, '2026-09-01T10:00:00', { etapa_status_id: 999 }), AGORA)).toBeNull()
    expect(estaParado(null)).toBe(false)
  })

  it(`parado a partir de ${PRAZO_PARADO} dias`, () => {
    expect(estaParado(PRAZO_PARADO - 1)).toBe(false)
    expect(estaParado(PRAZO_PARADO)).toBe(true)
  })

  it('a idade curta da etiqueta', () => {
    expect(idadeCurta('2026-10-02T07:00:00', AGORA)).toBe('hoje')
    expect(idadeCurta('2026-09-30T18:00:00', AGORA)).toBe('2d')
    expect(idadeCurta(null, AGORA)).toBe('')
    expect(idadeCurta('lixo', AGORA)).toBe('')
  })

  it('o texto do "Nesta etapa"', () => {
    expect(textoDosDias(0)).toBe('desde hoje')
    expect(textoDosDias(1)).toBe('1 dia')
    expect(textoDosDias(9)).toBe('9 dias')
  })
})

describe('título do card quebrado em campos', () => {
  it('o padrão da casa: intermediador - cedente - processo - objeto - percentual', () => {
    expect(
      camposDoTitulo('AN Soberana Consultoria - Maria Aparecida Nogueira - 0001734-06.2024.5.05.0006 - principal + honorários contratuais - 25%'),
    ).toEqual({
      cedente: 'Maria Aparecida Nogueira',
      intermediador: 'AN Soberana Consultoria',
      numero: '0001734-06.2024.5.05.0006',
      objeto: 'Principal + honorários contratuais',
      percentual: '25%',
    })
  })

  it('o percentual com decimal sai com vírgula; objeto e percentual podem faltar', () => {
    const c = camposDoTitulo('Credijuris - João da Silva - 0001734-06.2024.5.05.0006 - 12,5%')!
    expect(c.percentual).toBe('12,5%')
    expect(c.objeto).toBe('')
    expect(camposDoTitulo('Credijuris - João da Silva - 0001734-06.2024.5.05.0006')).toMatchObject({
      objeto: '',
      percentual: '',
    })
  })

  // MUDADO DE PROPÓSITO (acabamento do redesenho, 03/10/2026): "sem número" saiu
  // do nome deste teste. O dono quer o card sem processo com o título quebrado
  // em campos, como a amostra (o nº pode faltar); continua cru só o título que
  // não tem âncora nenhuma — nem número, nem parcela cedida.
  it('fora do padrão (sem número nem parcela, sem cedente, sem título), o título fica cru', () => {
    expect(camposDoTitulo('Maria — proposta enviada por e-mail, aguardar')).toBeNull()
    expect(camposDoTitulo('Credijuris - Maria')).toBeNull()
    expect(camposDoTitulo('Credijuris - Maria - 30%')).toBeNull()
    expect(camposDoTitulo('0001734-06.2024.5.05.0006')).toBeNull()
    expect(camposDoTitulo('')).toBeNull()
    expect(camposDoTitulo(null)).toBeNull()
  })

  describe('sem o número do processo', () => {
    it('quebra em campos com a parcela como âncora; o número fica vazio', () => {
      expect(
        camposDoTitulo('AN Soberana Consultoria - Maria Aparecida Nogueira - principal + honorários contratuais - 25%'),
      ).toEqual({
        cedente: 'Maria Aparecida Nogueira',
        intermediador: 'AN Soberana Consultoria',
        numero: '',
        objeto: 'Principal + honorários contratuais',
        percentual: '25%',
      })
    })

    it('o marcador no lugar do número não entra no nome do cedente', () => {
      for (const marcador of ['sem número', 'Sem nº', 's/n', 'S/N', '?', '0001734-06.2024']) {
        expect(camposDoTitulo(`Credijuris - João da Silva - ${marcador} - Crédito principal - 30%`)).toMatchObject({
          intermediador: 'Credijuris',
          cedente: 'João da Silva',
          numero: '',
          objeto: 'Crédito principal',
          percentual: '30%',
        })
      }
    })

    it('o percentual pode faltar, ou vir colado na parcela', () => {
      expect(camposDoTitulo('Credijuris - João da Silva - honorários contratuais')).toMatchObject({
        cedente: 'João da Silva',
        objeto: 'Honorários contratuais',
        percentual: '',
      })
      expect(camposDoTitulo('Credijuris - João da Silva - principal 12,5%')).toMatchObject({
        objeto: 'Principal',
        percentual: '12,5%',
      })
    })

    it('nome com " - " dentro continua inteiro, como na leitura com número', () => {
      expect(camposDoTitulo('CBR - Silva - Advogados Associados - honorários - 30%')).toMatchObject({
        intermediador: 'CBR',
        cedente: 'Silva - Advogados Associados',
      })
    })

    it('verba na segunda parte não é âncora: falta o cedente', () => {
      expect(camposDoTitulo('Credijuris - principal - 30%')).toBeNull()
    })
  })
})

describe('nome da coluna', () => {
  it('o que vem todo em maiúsculas vira frase', () => {
    expect(nomeDaColuna('REVISÃO/ASSINATURA DA ESCRITURA')).toBe('Revisão/assinatura da escritura')
    expect(nomeDaColuna('ENCAMINHAR AOS FUNDOS')).toBe('Encaminhar aos fundos')
  })

  it('sigla continua sigla', () => {
    expect(nomeDaColuna('ENVIO AO BTG')).toBe('Envio ao BTG')
  })

  it('o que já tem minúscula fica como veio', () => {
    expect(nomeDaColuna('Análise Jurídica e Econômica')).toBe('Análise Jurídica e Econômica')
    expect(nomeDaColuna('Produção de proposta')).toBe('Produção de proposta')
  })
})

describe('fases do quadro', () => {
  it('o RPV nas quatro fases, na ordem do kanban, com os perdidos discretos', () => {
    const fases = fasesDoQuadro(abasDoFunil(FUNIL_RPV, espelhoDosTresFunis()))
    expect(fases.map((f) => [f.nome, f.abas.length, f.discreta])).toEqual([
      ['Qualificação', 3, false],
      ['Comercialização', 4, false],
      ['Formalização', 4, false],
      ['Perdidos', 4, true],
    ])
  })

  it('o Externo pelas fases da trilha', () => {
    const fases = fasesDoQuadro(abasDoFunil(FUNIL_PRECATORIO, espelhoDosTresFunis(), 'externo'))
    expect(fases.map((f) => f.nome)).toEqual(['Qualificação', 'Comercialização', 'Formalização', 'Perdidos'])
  })

  /**
   * FUNIL SEM FASES (o Interno, até a trilha dele declarar `fases`): um grupo
   * só, sem nome. Quando a trilha ganhar fases, o quadro as desenha sem mudar
   * nada na tela.
   */
  it('funil sem fases vira um grupo só, sem nome', () => {
    const abas = abasDoFunil(FUNIL_PRECATORIO, espelhoDosTresFunis(), 'interno')
    const semFase = abas.every((a) => !a.fase)
    const fases = fasesDoQuadro(abas)
    if (semFase) expect(fases).toEqual([{ nome: null, discreta: false, abas }])
    else expect(fases.every((f) => f.nome)).toBe(true)
    expect(fasesDoQuadro([])).toEqual([])
  })
})

describe('barra de cada coluna', () => {
  it('proporcional à maior, sem barra no zero e com um mínimo visível', () => {
    expect(larguraDaBarra(0, 38)).toBe(0)
    expect(larguraDaBarra(38, 38)).toBe(100)
    expect(larguraDaBarra(19, 38)).toBe(50)
    expect(larguraDaBarra(1, 300)).toBe(6)
    expect(larguraDaBarra(3, 0)).toBe(100)
  })
})

describe('filtros rápidos e ordem', () => {
  const lista = [
    card(1, '2026-10-01T10:00:00'), // 1 dia
    card(2, '2026-09-20T10:00:00', { tags: ['Cotado BTG'] }), // 12 dias
    card(3, null), // sem data
    card(4, '2026-09-25T10:00:00', { tags: ['Reprovado PJus'] }), // 7 dias
  ]
  const opcoes = {
    agora: AGORA,
    temNumero: (l: KommoLead) => l.kommo_lead_id !== 3,
    pronta: (l: KommoLead) => l.kommo_lead_id === 1,
  }
  const ids = (l: KommoLead[]) => l.map((x) => x.kommo_lead_id)

  it('a ordem padrão é a da plataforma: entrada mais recente primeiro', () => {
    // O SEM DATA cai na data de criação (ordemNaColuna), que é a mais antiga.
    expect(ids(filtrarEOrdenar([...lista], { ...opcoes, filtro: 'todos', ordem: 'recente' }))).toEqual([1, 4, 2, 3])
  })

  it('"Mais tempo na etapa": mais dias primeiro, sem data no fim', () => {
    expect(ids(filtrarEOrdenar([...lista], { ...opcoes, filtro: 'todos', ordem: 'parado' }))).toEqual([2, 4, 1, 3])
  })

  it('os filtros', () => {
    const f = (filtro: Parameters<typeof filtrarEOrdenar>[1]['filtro']) =>
      ids(filtrarEOrdenar([...lista], { ...opcoes, filtro, ordem: 'recente' }))
    expect(f('parados')).toEqual([4, 2])
    expect(f('cotados')).toEqual([2])
    expect(f('prontas')).toEqual([1])
    expect(f('semnum')).toEqual([3])
  })

  it('a cotação sai do começo do nome da etiqueta, sem acento e caixa', () => {
    expect(temCotacao(card(9, null, { tags: ['cotado PX Ativos'] }))).toBe(true)
    expect(temCotacao(card(9, null, { tags: ['Enviado PJus', 'Pendente Luiz'] }))).toBe(false)
  })
})

describe('resultado da busca', () => {
  const abas = abasDoFunil(FUNIL_RPV, espelhoDosTresFunis())
  const por = (pares: [string, number][]): Record<string, KommoLead[]> =>
    Object.fromEntries(pares.map(([k, n]) => [k, Array.from({ length: n }, (_, i) => card(i, null))]))
  const aberta = abas.find((a) => a.key === 'pendentes') as Aba

  it('a faixa de cima conta todas as etapas com achado, na ordem das abas', () => {
    const r = achadosDaBusca(abas, por([['col-107830039', 1], ['pendentes', 2], ['validacao', 1]]), aberta, true)
    expect(r.map((a) => [a.key, a.n, a.outraFase])).toEqual([
      ['pendentes', 2, null],
      ['validacao', 1, null],
      ['col-107830039', 1, 'Comercialização'],
    ])
  })

  it('o vazio diz só onde MAIS achou', () => {
    const r = achadosDaBusca(abas, por([['pendentes', 2], ['validacao', 1]]), aberta, false)
    expect(r.map((a) => a.key)).toEqual(['validacao'])
  })
})

describe('o texto da busca, montado uma vez por card', () => {
  // A REGRA DE ANTES, campo a campo: é contra ela que o texto montado se mede.
  const casavaAntes = (x: KommoLead, q: string) =>
    [x.nome, x.processo_cnj, x.responsavel_nome, ...(x.notas ?? []).map((n) => n.texto), x.nota_texto]
      .filter(Boolean)
      .some((v) => v!.toLowerCase().includes(q))
  const c = card(7, null, {
    nome: 'PX - Maria da Silva - 0001234-56.2020.8.09.0051 - principal',
    processo_cnj: '0001234-56.2020.8.09.0051',
    responsavel_nome: 'Luiz',
    nota_texto: 'Primeira nota',
    notas: [
      { id: 1, texto: 'Cedente enviou o RG', criado_em: null, autor: null },
      { id: 2, texto: 'Falta o COMPROVANTE de endereço', criado_em: null, autor: null },
    ],
  })

  it('acha em qualquer campo e em qualquer anotação, sem caixa', () => {
    const t = textoDaBusca(c)
    for (const q of ['maria', '0001234-56', 'luiz', 'enviou o rg', 'comprovante', 'primeira']) {
      expect(t.includes(q)).toBe(true)
    }
  })

  it('responde igual à busca campo a campo — inclusive sem juntar o fim de um campo ao começo do outro', () => {
    const t = textoDaBusca(c)
    for (const q of ['maria', 'principal', 'rg', 'luizcedente', 'principal0001', 'rgfalta', 'xyz', 'endereço']) {
      expect(t.includes(q)).toBe(casavaAntes(c, q))
    }
  })

  it('card sem nada além do id não quebra', () => {
    const vazio = card(8, null, { nome: null as unknown as string, notas: undefined as unknown as [] })
    expect(textoDaBusca(vazio)).toBe('')
  })
})
