// Testes das duas trilhas do funil de Precatórios.
//
// Existem porque este é o tipo de coisa que revisão visual não pega: as abas são
// uma TABELA de rótulos e nomes de coluna do Kommo, e um nome errado não quebra
// nada — a aba simplesmente mostra zero card, para sempre, e zero card se lê
// como "não tem trabalho aqui".
//
// O vínculo com o Kommo é pelo NOME da coluna (ver SUBDIVISOES_PRECATORIO), e é
// exatamente esse vínculo que os testes exercitam: dado um espelho de kanban,
// as abas têm de casar; dado um espelho com a coluna renomeada, o desalinhamento
// tem de ser DENUNCIADO em vez de virar aba vazia.
//
// DESDE 14/09/2026 SÃO DOIS KANBANS. As trilhas foram separadas em pipelines
// próprios, uma de cada vez: o Externo em 14/09 e o Interno em 16/09. O funil
// antigo, que tinha as duas dentro, não é lido por nenhuma delas.
//
// AQUI TAMBÉM SE PROVA O QUE O SERVIDOR ACEITA. A Edge Function que move o card
// guardava uma lista própria de colunas de destino, e ela ficou para trás na
// migração: a tela oferecia saídas que o servidor recusava. Hoje as duas leem a
// mesma definição, e o teste `destinos que o servidor aceita` é o que impede a
// divergência de voltar.

import { describe, it, expect } from 'vitest'
import { normalizarBusca } from '@/lib/format'
import { destinoPermitido, destinosDaTrilha } from '../../../supabase/functions/_shared/trilhasDoPrecatorio.ts'
import {
  ABA_ANALISE_INTERNA,
  ABA_APROVADOS_EXTERNO,
  ABA_EM_PRECIFICACAO_EXTERNO,
  ABA_REPROVADOS_EXTERNO,
  ABAS_COM_TAGS,
  ABAS_EXTERNO_SEM_TRABALHO,
  ABAS_INTERNO_SEM_TRABALHO,
  acaoDeReprovar,
  botoesDaAba,
  ehCardExterno,
  ehFunilPrecatorio,
  ESPELHO_RPV,
  FUNIL_PRECATORIO,
  FUNIL_PRECATORIO_EXTERNO,
  FUNIL_RPV,
  funisExibidos,
  SUBDIVISOES_PRECATORIO,
  ST_ANALISE,
  ST_DECISAO,
  ST_DILIGENCIA,
  ST_PROPOSTA,
  ST_PROTOCOLO,
  ST_REPROVADO,
  abasDoFunil,
  etiquetaCanonica,
  agruparPorAba,
  dataDaEtapa,
  colunasPrecatorioDesalinhadas,
  statusExibidos,
  telasRpvDesalinhadas,
  coresDasTags,
  TONS_DA_TAG,
  tomDaTag,
} from '@/lib/kommo'
import type { KommoLead } from '@/lib/types'
// OS KANBANS MORAM EM `fixtures/kanbans.ts` — os mesmos que os testes de botões
// e de movimentos usam. Ver lá de quando é cada um.
import {
  COLUNAS_EXTERNO,
  COLUNAS_INTERNO,
  colunasDe,
  colunasExterno,
  colunasInterno,
  DE_SISTEMA,
  espelho,
  idDe,
  idExt,
  IDS_EXTERNO,
  IDS_INTERNO,
  KANBAN_RPV,
} from './fixtures/kanbans'

const lead =(statusId: number, id = statusId, pipelineId = FUNIL_PRECATORIO): KommoLead =>
  ({
    kommo_lead_id: id,
    pipeline_id: pipelineId,
    status_id: statusId,
  }) as KommoLead

describe('SUBDIVISOES_PRECATORIO', () => {
  it('tem as duas trilhas, nomeadas Interno e Externo', () => {
    expect(SUBDIVISOES_PRECATORIO.map((s) => s.key)).toEqual(['interno', 'externo'])
    expect(SUBDIVISOES_PRECATORIO.map((s) => s.label)).toEqual(['Interno', 'Externo'])
  })

  // CADA TRILHA NO SEU FUNIL. Enquanto a migração não termina os dois ids são
  // diferentes; quando o Interno migrar, é esta linha que muda — e se alguém
  // apontar as duas para o mesmo funil sem querer, o teste cai.
  it('cada trilha lê de um funil próprio', () => {
    const porKey = new Map(SUBDIVISOES_PRECATORIO.map((s) => [s.key, s.pipelineId]))
    expect(porKey.get('interno')).toBe(FUNIL_PRECATORIO)
    expect(porKey.get('externo')).toBe(FUNIL_PRECATORIO_EXTERNO)
    expect(porKey.get('interno')).not.toBe(porKey.get('externo'))
  })

  it('os dois funis são reconhecidos como de precatório', () => {
    expect(ehFunilPrecatorio(FUNIL_PRECATORIO)).toBe(true)
    expect(ehFunilPrecatorio(FUNIL_PRECATORIO_EXTERNO)).toBe(true)
    expect(ehFunilPrecatorio(FUNIL_RPV)).toBe(false)
    expect(ehFunilPrecatorio(999)).toBe(false)
  })

  /**
   * A CONSULTA DE CARDS TEM DE COBRIR OS DOIS FUNIS.
   *
   * Foi o defeito que a separação criou e que nada acusava: as abas do Externo
   * resolviam certo, e a lista vinha vazia porque os cards eram buscados por um
   * id só — o da aba de cima, que é o funil antigo. Lista vazia se lê como "não
   * tem trabalho aqui".
   */
  it('a tela busca cards dos dois funis quando o Precatório está aberto', () => {
    expect(new Set(funisExibidos(FUNIL_PRECATORIO))).toEqual(
      new Set([FUNIL_PRECATORIO, FUNIL_PRECATORIO_EXTERNO]),
    )
    expect(new Set(funisExibidos(FUNIL_PRECATORIO_EXTERNO))).toEqual(
      new Set([FUNIL_PRECATORIO, FUNIL_PRECATORIO_EXTERNO]),
    )
  })

  it('fora do Precatório, busca só o funil aberto', () => {
    expect(funisExibidos(FUNIL_RPV)).toEqual([FUNIL_RPV])
    expect(funisExibidos(999)).toEqual([999])
  })

  it('não repete chave de aba entre as trilhas', () => {
    // Chave repetida faria a aba escolhida numa trilha "casar" na outra, e a
    // tela abriria numa etapa que a pessoa não escolheu.
    const chaves = SUBDIVISOES_PRECATORIO.flatMap((s) => s.abas.map((a) => a.key))
    expect(new Set(chaves).size).toBe(chaves.length)
  })

  /**
   * A CHAVE QUE A TELA IMPORTA TEM DE EXISTIR NA TRILHA.
   *
   * Os cards das abas terminais do Externo são os que mostram as etiquetas do
   * Kommo, e a tela as reconhece por estas constantes. Renomear a chave na
   * definição sem mexer aqui faria as etiquetas sumirem sem erro nenhum — que é a
   * família de defeito que este arquivo inteiro existe para pegar.
   */
  it('as abas que mostram etiqueta existem na trilha', () => {
    const externo = SUBDIVISOES_PRECATORIO.find((s) => s.key === 'externo')!
    const porChave = new Map(externo.abas.map((a) => [a.key, a]))
    expect(porChave.get(ABA_APROVADOS_EXTERNO)?.colunaKommo).toBe('ENCAMINHAR AOS FUNDOS')
    expect(porChave.get(ABA_APROVADOS_EXTERNO)?.label).toBe('Aprovados')
    expect(porChave.get(ABA_REPROVADOS_EXTERNO)?.colunaKommo).toBe('REPROVADOS')
    // O CONJUNTO É O QUE A TELA CONSULTA: chave que não existe na trilha é
    // etiqueta que nunca aparece, sem erro nenhum para denunciar.
    for (const chave of ABAS_COM_TAGS) {
      expect(porChave.has(chave), chave).toBe(true)
    }
  })

  // REPROVADOS NÃO MOSTRA ETIQUETA desde 29/09/2026, a pedido.
  it('a coluna de reprovados não mostra etiquetas', () => {
    expect(ABAS_COM_TAGS.has(ABA_REPROVADOS_EXTERNO)).toBe(false)
  })

  it('toda aba aponta para uma coluna que existe no kanban', () => {
    // O teste que pega erro de digitação no nome da coluna.
    expect(colunasPrecatorioDesalinhadas(espelho())).toEqual([])
  })
})

/**
 * AS ABAS DO INTERNO MUDARAM DE PROPÓSITO NA ONDA 2 DO REDESENHO (02/10/2026, só
 * na beta): o Interno passou a mostrar o kanban INTEIRO, nas quatro fases, com
 * os nomes do Kommo — pela exibição do front (`EXIBICAO_NO_FRONT`), sem tocar na
 * trilha. Antes eram seis abas com rótulos da plataforma ("Análise", "Aprovados",
 * "p/ Protocolo") e as colunas do comercial ficavam fora.
 *
 * AS SEIS ABAS DE TRABALHO SÃO AS MESMAS: mesmas chaves, mesmas colunas, mesmos
 * desfechos e destinos. Por isso os testes abaixo passaram a achar cada aba pela
 * CHAVE, e não pelo rótulo — o rótulo agora é o do Kommo.
 */
describe('abas do Interno', () => {
  const abas = abasDoFunil(FUNIL_PRECATORIO, espelho(), 'interno')
  const daChave = (key: string) => abas.find((a) => a.key === key)!

  it('mostra o kanban inteiro, na ordem e com os nomes do Kommo, nas quatro fases', () => {
    expect(abas.map((a) => [a.key, a.label, a.fase])).toEqual([
      ['int-analise', 'Análise jurídica e econômica', 'Qualificação'],
      ['int-revisao', 'Revisão', 'Qualificação'],
      ['int-diligencia', 'Diligência', 'Qualificação'],
      ['int-aprovados', 'Produção de proposta', 'Comercialização'],
      [`col-${idDe('Negociação')}`, 'Negociação', 'Comercialização'],
      [`col-${idDe('Fechados')}`, 'Fechados', 'Comercialização'],
      [`col-${idDe('Oferta aos investidores')}`, 'Oferta aos investidores', 'Comercialização'],
      [`col-${idDe('Escritura pública')}`, 'Escritura pública', 'Formalização'],
      ['int-protocolo', 'Protocolo', 'Formalização'],
      [`col-${idDe('Pagamento finalizado')}`, 'Pagamento finalizado', 'Formalização'],
      ['int-reprovados', 'Reprovados', 'Perdidos'],
      [`col-${idDe('Sem resposta')}`, 'Sem resposta', 'Perdidos'],
      [`col-${idDe('Não fechados')}`, 'Não fechados', 'Perdidos'],
    ])
    // A ENTRADA DE LEADS continua fora, como no Externo e no RPV.
    expect(abas.some((a) => a.statusIds[0] === idDe('Etapa de leads de entrada'))).toBe(false)
  })

  it('cada aba de trabalho resolve para a coluna certa do funil novo', () => {
    expect(daChave(ABA_ANALISE_INTERNA).statusIds[0]).toBe(idDe('Análise jurídica e econômica'))
    expect(daChave('int-revisao').statusIds[0]).toBe(idDe('Revisão'))
    expect(daChave('int-aprovados').statusIds[0]).toBe(idDe('Produção de proposta'))
    expect(daChave('int-diligencia').statusIds[0]).toBe(idDe('Diligência'))
    expect(daChave('int-reprovados').statusIds[0]).toBe(idDe('Reprovados'))
    expect(daChave('int-protocolo').statusIds[0]).toBe(idDe('Protocolo'))
  })

  /**
   * DUAS COLUNAS VIRARAM UMA. O kanban antigo separava "Análise Jurídica (TIER
   * 1)" de "Análise Econômico-Financeira (TIER 1)", e a plataforma tinha uma aba
   * para cada. O funil novo as fundiu em "ANÁLISE JURÍDICA E ECONÔMICA".
   */
  it('a análise jurídica e a econômica moram na mesma aba', () => {
    expect(daChave(ABA_ANALISE_INTERNA).label).toBe('Análise jurídica e econômica')
    expect(abas.map((a) => a.label)).not.toContain('Precificação')
  })

  /**
   * O CAMINHO POSITIVO TEM DOIS PASSOS, como no Externo: quem analisa passa
   * adiante, quem revisa aprova. A mesma palavra em botões diferentes significa
   * destinos diferentes, e é a ETAPA que diz qual — por isso `aprovaPara` é da
   * aba e não da trilha.
   */
  it('a análise envia para revisão; a revisão aprova', () => {
    const daAnalise = daChave(ABA_ANALISE_INTERNA).acoes.find((x) => x.papel === 'aprovar')!
    expect(daAnalise.label).toBe('Enviar para revisão')
    expect(daAnalise.variant).toBe('secondary')
    expect(daAnalise.statusId).toBe(idDe('Revisão'))

    const daRevisao = daChave('int-revisao').acoes.find((x) => x.papel === 'aprovar')!
    expect(daRevisao.label).toBe('Aprovar crédito')
    expect(daRevisao.variant).toBe('primary')
    expect(daRevisao.statusId).toBe(idDe('Produção de proposta'))
  })

  it('as duas abas de decisão também interrompem', () => {
    for (const key of [ABA_ANALISE_INTERNA, 'int-revisao']) {
      const aba = daChave(key)
      expect(aba.acoes.map((x) => x.papel), key).toEqual(['aprovar', 'diligenciar', 'reprovar'])
      expect(aba.acoes.find((x) => x.papel === 'diligenciar')!.statusId, key).toBe(idDe('Diligência'))
      expect(aba.acoes.find((x) => x.papel === 'reprovar')!.statusId, key).toBe(idDe('Reprovados'))
      // A janela de Concluir é o único lugar onde a anotação que vai para o
      // Kommo é escrita ANTES de o card se mover.
      expect(aba.desfechoAgrupado, key).toBe(true)
    }
  })

  // Das terminais o card não volta pelo app: de Aprovados e Reprovados não se
  // sai, a diligência quem devolve é o comercial, e o protocolo é dele também.
  it('as abas terminais não oferecem desfecho', () => {
    for (const key of ['int-aprovados', 'int-diligencia', 'int-reprovados', 'int-protocolo']) {
      const aba = daChave(key)
      expect(aba.acoes, key).toEqual([])
      expect(aba.desfechoAgrupado, key).toBe(false)
    }
  })

  // O ID VEM DO ESPELHO, e coluna que ele não tem não vira botão: melhor a aba
  // sem desfecho do que um botão que move o card para lugar nenhum.
  it('sem a coluna no kanban, o botão não aparece', () => {
    const semReprovados = espelho(COLUNAS_INTERNO.filter((n) => n !== 'Reprovados'))
    const emAnalise = abasDoFunil(FUNIL_PRECATORIO, semReprovados, 'interno').find(
      (a) => a.key === ABA_ANALISE_INTERNA,
    )!
    expect(emAnalise.acoes.map((x) => x.papel)).toEqual(['aprovar', 'diligenciar'])
  })

  /**
   * AS COLUNAS DO COMERCIAL ENTRAM, MAS SÓ PARA LEITURA. Até a onda 2 elas
   * ficavam fora da tela; agora aparecem para a equipe acompanhar o crédito até
   * o fim — sem botão de trabalho (nem análise nem due diligence, que são
   * pagas) e sem desfecho nenhum.
   */
  it('as colunas do comercial viram aba só de leitura', () => {
    for (const nome of [
      'Negociação',
      'Fechados',
      'Oferta aos investidores',
      'Escritura pública',
      'Pagamento finalizado',
      'Sem resposta',
      'Não fechados',
    ]) {
      const aba = abas.find((a) => a.statusIds[0] === idDe(nome))!
      expect(aba, nome).toMatchObject({ key: `col-${idDe(nome)}`, soLeitura: true, acoes: [] })
      expect(botoesDaAba(FUNIL_PRECATORIO, 'interno', aba), nome).toBe('nenhum')
    }
  })

  // SEM ESPELHO AINDA, o kanban de 02/10/2026 da exibição do front: as mesmas abas.
  it('sem espelho, o mesmo kanban, pelos ids de 02/10/2026', () => {
    const semEspelho = abasDoFunil(FUNIL_PRECATORIO, [], 'interno')
    expect(semEspelho.map((a) => [a.key, a.label, a.fase])).toEqual(abas.map((a) => [a.key, a.label, a.fase]))
  })
})

/**
 * A LISTA DE PERMISSÃO DO SERVIDOR sai da mesma definição que desenha os botões.
 *
 * ELA JÁ FOI ESCRITA À MÃO dentro da Edge Function `kommo-mover`, com dois nomes
 * do funil antigo. Quando as trilhas migraram para pipelines próprios, a tela
 * passou a oferecer saídas que o servidor recusava com "Coluna de destino não
 * reconhecida": o botão existia, o card não se movia, e nada no caminho dizia
 * que a causa eram duas listas que precisavam concordar e não concordavam.
 */
describe('destinos que o servidor aceita', () => {
  const colunaDoId = new Map(espelho().map((e) => [e.status_id, e.nome]))

  it('cobre toda saída que a tela oferece, nas duas trilhas', () => {
    for (const trilha of SUBDIVISOES_PRECATORIO) {
      const permitidos = destinosDaTrilha(trilha.pipelineId).map(normalizarBusca)
      for (const aba of abasDoFunil(trilha.pipelineId, espelho(), trilha.key)) {
        for (const acao of aba.acoes) {
          expect(
            permitidos,
            `${trilha.label} · ${aba.label} · ${acao.label}`,
          ).toContain(normalizarBusca(colunaDoId.get(acao.statusId)!))
        }
      }
    }
  })

  // A RECUSA NASCE EM QUALQUER CARD, e não numa etapa: ela vem do que a
  // diligência achou. Se o servidor não a aceitasse, a janela ofereceria um
  // botão de reprovar que não reprova.
  it('a recusa da janela de due diligence também é aceita', () => {
    for (const trilha of SUBDIVISOES_PRECATORIO) {
      const acao = acaoDeReprovar(trilha.pipelineId, espelho())!
      expect(destinosDaTrilha(trilha.pipelineId).map(normalizarBusca), trilha.label).toContain(
        normalizarBusca(colunaDoId.get(acao.statusId)!),
      )
    }
  })

  // A ESCOLHA DA PROPOSTA não é saída comum — não vira botão genérico —, mas o
  // servidor precisa aceitá-la: senão o "Confirmar e mover" não moveria nada.
  it('a escolha da proposta também é aceita', () => {
    let vistas = 0
    for (const trilha of SUBDIVISOES_PRECATORIO) {
      for (const aba of abasDoFunil(trilha.pipelineId, espelho(), trilha.key)) {
        if (!aba.escolhaDeProposta) continue
        vistas++
        expect(destinosDaTrilha(trilha.pipelineId).map(normalizarBusca), aba.label).toContain(
          normalizarBusca(colunaDoId.get(aba.escolhaDeProposta)!),
        )
        // E NÃO GANHA OS BOTÕES GENÉRICOS: a aba segue sem desfecho próprio.
        expect(aba.acoes, aba.label).toEqual([])
      }
    }
    expect(vistas).toBe(1)
  })

  // A PERMISSÃO É PELO ID: o servidor aceita mover para a coluna renomeada, e
  // continua recusando a coluna que a tela não oferece, qualquer que seja o nome.
  it('renomear a coluna não tira a permissão de mover para ela', () => {
    expect(destinoPermitido(FUNIL_PRECATORIO_EXTERNO, 111533988, 'PROPOSTA AO CEDENTE')).toBe(true)
    expect(destinoPermitido(FUNIL_PRECATORIO_EXTERNO, 111534212, 'RECUSADOS')).toBe(true)
    expect(destinoPermitido(FUNIL_PRECATORIO_EXTERNO, 111533964, 'Etapa de leads de entrada')).toBe(false)
    expect(destinoPermitido(FUNIL_PRECATORIO_EXTERNO, 112006404, 'PAGOS')).toBe(false)
  })

  it('funil que não é de precatório não tem destino nenhum', () => {
    expect(destinosDaTrilha(FUNIL_RPV)).toEqual([])
    expect(destinosDaTrilha(999)).toEqual([])
  })

  // UM statusId SOLTO NO CORPO DA REQUISIÇÃO moveria o card para uma coluna do
  // comercial. A lista é de desfechos, e só.
  it('não aceita coluna que não é desfecho', () => {
    const permitidos = destinosDaTrilha(FUNIL_PRECATORIO).map(normalizarBusca)
    for (const fora of ['Fechados', 'Protocolo', 'Negociação', 'Etapa de leads de entrada']) {
      expect(permitidos, fora).not.toContain(normalizarBusca(fora))
    }
  })
})

describe('abas da trilha Externa', () => {
  const abas = abasDoFunil(FUNIL_PRECATORIO_EXTERNO, espelho(), 'externo')

  /**
   * O KANBAN INTEIRO, com os nomes e a ordem do Kommo — pedido de 29/09/2026,
   * quando o funil ganhou sete colunas: "desta vez vamos usar o mesmo nome da
   * coluna, não criar um diferente". Só as duas de sistema ficam de fora.
   */
  it('toda coluna do Kommo vira aba, com o nome e na ordem de lá', () => {
    // MENOS A DE ENTRADA DE LEADS, que é do comercial (pedido de 29/09/2026), e
    // as duas de sistema.
    expect(abas.map((a) => a.label)).toEqual(COLUNAS_EXTERNO.filter((n) => n !== 'Etapa de leads de entrada'))
    expect(abas.some((a) => /closed/i.test(a.label))).toBe(false)
  })

  // PELO TIPO, e não pelo nome: renomeada, ela continua de fora.
  it('a coluna de entrada fica de fora mesmo renomeada', () => {
    const renomeado = [
      ...colunasDe(FUNIL_PRECATORIO, COLUNAS_INTERNO, 90_000),
      ...colunasExterno(COLUNAS_EXTERNO, { 'Etapa de leads de entrada': 'ENTRADA' }),
    ]
    const labels = abasDoFunil(FUNIL_PRECATORIO_EXTERNO, renomeado, 'externo').map((a) => a.label)
    expect(labels).not.toContain('ENTRADA')
  })

  /**
   * RENOMEAR NO KOMMO NÃO TIRA FUNÇÃO NENHUMA (29/09/2026). Até então a ligação
   * era pelo nome, e cada coluna renomeada perdia botões, etiquetas e automações
   * até alguém renomear aqui também. Agora é pelo id.
   */
  it('coluna renomeada no Kommo mantém a função, com o nome novo', () => {
    const renomeado = [
      ...colunasDe(FUNIL_PRECATORIO, COLUNAS_INTERNO, 90_000),
      ...colunasExterno(COLUNAS_EXTERNO, {
        'EM PRECIFICAÇÃO': 'COM OS FUNDOS',
        'REVISÃO DA QUALIFICAÇÃO': 'SEGUNDA LEITURA',
        'PRODUÇÃO DE PROPOSTA': 'PROPOSTA AO CEDENTE',
        'REPROVADOS': 'RECUSADOS',
      }),
    ]
    const lista = abasDoFunil(FUNIL_PRECATORIO_EXTERNO, renomeado, 'externo')
    const precificacao = lista.find((a) => a.key === ABA_EM_PRECIFICACAO_EXTERNO)!
    expect(precificacao.label).toBe('COM OS FUNDOS')
    expect(precificacao.statusIds).toEqual([111533984])
    expect(precificacao.escolhaDeProposta).toBe(111533988)
    // A saída da qualificação continua apontando para a revisão renomeada…
    const qualificacao = lista.find((a) => a.key === 'ext-qualificacao')!
    expect(qualificacao.acoes[0].statusId).toBe(111533972)
    // …a recusa da revisão, para a coluna de reprovados renomeada…
    const revisao = lista.find((a) => a.key === 'ext-revisao')!
    expect(revisao.label).toBe('SEGUNDA LEITURA')
    expect(revisao.acoes.find((x) => x.papel === 'reprovar')?.statusId).toBe(111534212)
    // …e nenhum aviso de coluna não encontrada.
    expect(colunasPrecatorioDesalinhadas(renomeado, 'externo')).toEqual([])
    expect(acaoDeReprovar(FUNIL_PRECATORIO_EXTERNO, renomeado)?.statusId).toBe(111534212)
  })

  /**
   * AS QUATRO FASES do Externo (29/09/2026), acima das abas — pelos ids.
   */
  it('cada coluna cai na fase que a operação definiu', () => {
    const fase = Object.fromEntries(abas.map((x) => [x.label, x.fase]))
    expect(fase).toEqual({
      'QUALIFICAÇÃO PRELIMINAR': 'Qualificação',
      'REVISÃO DA QUALIFICAÇÃO': 'Qualificação',
      'DILIGÊNCIA': 'Qualificação',
      'MEMORANDO DE NEGOCIAÇÃO': 'Qualificação',
      'ENCAMINHAR AOS FUNDOS': 'Comercialização',
      'EM PRECIFICAÇÃO': 'Comercialização',
      'PRODUÇÃO DE PROPOSTA': 'Comercialização',
      'NEGOCIAÇÃO': 'Comercialização',
      'FECHADOS': 'Comercialização',
      'OBTENÇÃO DE DOCUMENTAÇÃO': 'Formalização',
      'AGUARDANDO APROVAÇÃO DO FUNDO': 'Formalização',
      'REVISÃO/ASSINATURA DA ESCRITURA': 'Formalização',
      'PAGOS': 'Formalização',
      'REPROVADOS': 'Perdidos',
      'NÃO FECHADO': 'Perdidos',
    })
  })

  // COLUNA NOVA NO KOMMO entra na fase da que vem antes dela no kanban.
  it('coluna nova herda a fase da coluna anterior', () => {
    const comNova = [
      ...espelho(),
      { pipeline_id: FUNIL_PRECATORIO_EXTERNO, status_id: 99_998, pipeline_nome: null, nome: 'CONTRAPROPOSTA', ordem: 8.5, tipo: 0 },
    ]
    const nova = abasDoFunil(FUNIL_PRECATORIO_EXTERNO, comNova, 'externo').find((x) => x.label === 'CONTRAPROPOSTA')!
    expect(nova.fase).toBe('Comercialização')
  })

  it('renomear a coluna não a tira da fase', () => {
    const renomeado = [
      ...colunasDe(FUNIL_PRECATORIO, COLUNAS_INTERNO, 90_000),
      ...colunasExterno(COLUNAS_EXTERNO, { 'PAGOS': 'LIQUIDADOS' }),
    ]
    const pagos = abasDoFunil(FUNIL_PRECATORIO_EXTERNO, renomeado, 'externo').find((x) => x.label === 'LIQUIDADOS')!
    expect(pagos.fase).toBe('Formalização')
  })

  // MUDOU DE PROPÓSITO NA ONDA 2 (02/10/2026, só na beta): o Interno ganhou as
  // quatro fases pela exibição do front (`EXIBICAO_NO_FRONT`). A TRILHA dele
  // continua sem fases — é ela que a tela oficial e o servidor leem.
  it('o Interno tem as quatro fases pelo front, e a trilha dele não', () => {
    const interno = SUBDIVISOES_PRECATORIO.find((x) => x.key === 'interno')!
    expect(interno.fases).toBeUndefined()
    expect(interno.espelhoCompleto).toBeFalsy()
    const fases = [...new Set(abasDoFunil(FUNIL_PRECATORIO, espelho(), 'interno').map((x) => x.fase))]
    expect(fases).toEqual(['Qualificação', 'Comercialização', 'Formalização', 'Perdidos'])
  })

  // OS IDS DA TRILHA SÃO OS DO KOMMO: cada um aponta para a coluna que tinha
  // aquele nome em 29/09/2026. Um dígito trocado cai aqui.
  it('cada id declarado na trilha é o da coluna com aquele nome', () => {
    const externo = SUBDIVISOES_PRECATORIO.find((x) => x.key === 'externo')!
    for (const a of externo.abas) {
      expect(a.statusId, a.colunaKommo).toBe(IDS_EXTERNO[a.colunaKommo])
      for (const saida of a.saidas ?? []) expect(saida.statusId, saida.label).toBe(IDS_EXTERNO[saida.colunaKommo])
    }
    expect(externo.idDiligencia).toBe(IDS_EXTERNO['DILIGÊNCIA'])
    expect(externo.idReprovados).toBe(IDS_EXTERNO['REPROVADOS'])
  })

  it('cada aba resolve para a própria coluna', () => {
    for (const a of abas) expect(a.statusIds, a.label).toEqual([idExt(a.label)])
  })

  // AS COLUNAS COM FUNÇÃO levam a aba da plataforma (botões, desfechos,
  // etiquetas); as outras entram só para leitura.
  it('a coluna com função leva a aba dela; a nova é só leitura', () => {
    const chave = new Map(abas.map((a) => [a.label, a.key]))
    expect(chave.get('QUALIFICAÇÃO PRELIMINAR')).toBe('ext-qualificacao')
    expect(chave.get('REVISÃO DA QUALIFICAÇÃO')).toBe('ext-revisao')
    expect(chave.get('MEMORANDO DE NEGOCIAÇÃO')).toBe('ext-memorando')
    expect(chave.get('ENCAMINHAR AOS FUNDOS')).toBe(ABA_APROVADOS_EXTERNO)
    expect(chave.get('EM PRECIFICAÇÃO')).toBe(ABA_EM_PRECIFICACAO_EXTERNO)
    expect(chave.get('REPROVADOS')).toBe(ABA_REPROVADOS_EXTERNO)
    expect(chave.get('OBTENÇÃO DE DOCUMENTAÇÃO')).toBe('ext-documentacao')
    const soLeitura = abas.filter((a) => a.soLeitura).map((a) => a.label)
    expect(soLeitura).toEqual([
      'NEGOCIAÇÃO',
      'AGUARDANDO APROVAÇÃO DO FUNDO',
      'REVISÃO/ASSINATURA DA ESCRITURA',
      'PAGOS',
      'NÃO FECHADO',
    ])
    for (const a of abas.filter((x) => x.soLeitura)) {
      expect(a.acoes, a.label).toEqual([])
      expect(a.escolhaDeProposta ?? null, a.label).toBeNull()
    }
  })

  // COLUNA CRIADA NO KOMMO APARECE SOZINHA, sem mexer no código.
  it('coluna nova no kanban vira aba de leitura', () => {
    const comNova = [
      ...espelho(),
      { pipeline_id: FUNIL_PRECATORIO_EXTERNO, status_id: 99_999, pipeline_nome: null, nome: 'JURÍDICO DO FUNDO', ordem: 8, tipo: 0 },
    ]
    const nova = abasDoFunil(FUNIL_PRECATORIO_EXTERNO, comNova, 'externo').find((a) => a.label === 'JURÍDICO DO FUNDO')!
    expect(nova).toMatchObject({ statusIds: [99_999], soLeitura: true, acoes: [] })
  })

  // A ABA CONHECIDA CUJA COLUNA SUMIU fica no fim, vazia, com o nome esperado —
  // é o que o aviso de coluna não encontrada aponta.
  it('coluna com função que sumiu do kanban fica no fim, vazia', () => {
    const sem = espelho(COLUNAS_INTERNO, COLUNAS_EXTERNO.filter((n) => n !== 'MEMORANDO DE NEGOCIAÇÃO'))
    const lista = abasDoFunil(FUNIL_PRECATORIO_EXTERNO, sem, 'externo')
    const ultima = lista[lista.length - 1]
    expect(ultima).toMatchObject({ key: 'ext-memorando', label: 'MEMORANDO DE NEGOCIAÇÃO', statusIds: [] })
  })

  // ETAPA DE TRABALHO, NÃO DE DECISÃO. A Revisão passou a MANDAR cards para cá
  // ("Pedir memorando"), mas a volta continua sendo do Kommo, por decisão de quem
  // opera: pronto o memorando, quem move o card é quem o escreveu.
  it('o Memorando não oferece desfecho', () => {
    const memorando = abas.find((a) => a.key === 'ext-memorando')!
    expect(memorando.acoes).toEqual([])
    expect(memorando.desfechoAgrupado).toBe(false)
  })

  /** As duas etapas em que a casa decide algo — as demais são de espera. */
  const DECISORIAS = ['ext-qualificacao', 'ext-revisao']

  /**
   * A QUALIFICAÇÃO TEM UMA SAÍDA SÓ, desde 21/09/2026.
   *
   * Ela oferecia três: encaminhar à revisão, exigir diligência e recusar. As duas
   * últimas saíam DIRETO de quem analisa — e a revisão, que existe para ler o que
   * a casa decide, só via o que tinha sido aprovado. Recusa e diligência são
   * decisões sobre o crédito tanto quanto a aprovação, e agora passam pela mesma
   * segunda leitura.
   *
   * O QUE ESTE TESTE GUARDA é a ausência: uma etapa que volta a interromper sem
   * ninguém decidir isso é o tipo de coisa que se descobre pelo card que já se
   * moveu.
   */
  it('a Qualificação só encaminha para a revisão', () => {
    const qualificacao = abas.find((a) => a.key === 'ext-qualificacao')!
    expect(qualificacao.acoes.map((x) => x.papel)).toEqual(['aprovar'])
    expect(qualificacao.acoes[0].statusId).toBe(idExt('REVISÃO DA QUALIFICAÇÃO'))
    expect(qualificacao.acoes[0].label).toBe('Enviar para revisão')
  })

  /**
   * NEM TODO "SEGUIR" É UM "APROVAR".
   *
   * Na qualificação a saída positiva manda o crédito para a REVISÃO de outra
   * pessoa: não se aprovou nada ainda, apenas se passou adiante. O rótulo diz
   * isso e o tom é neutro — no azul da aprovação, o botão de quem analisa teria
   * o peso do de quem decide.
   */
  it('a saída positiva da Qualificação envia para revisão, em tom neutro', () => {
    const qualificacao = abas.find((a) => a.key === 'ext-qualificacao')!
    const aprovar = qualificacao.acoes.find((x) => x.papel === 'aprovar')!
    expect(aprovar.label).toBe('Enviar para revisão')
    expect(aprovar.variant).toBe('secondary')
  })

  /**
   * NA REVISÃO A APROVAÇÃO ENCAMINHA DE VERDADE — é a segunda leitura, e depois
   * dela não há terceira. As outras duas saídas são as mesmas: quem revisa
   * também pode exigir diligência ou recusar.
   */
  it('a Revisão oferece quatro saídas, e aprova para os fundos', () => {
    const revisao = abas.find((a) => a.key === 'ext-revisao')!
    expect(revisao.acoes.map((x) => x.papel)).toEqual([
      'aprovar',
      'validar',
      'diligenciar',
      'reprovar',
    ])
    const porLabel = new Map(revisao.acoes.map((a) => [a.label, a.statusId]))
    expect(porLabel.get('Aprovar crédito')).toBe(idExt('ENCAMINHAR AOS FUNDOS'))
    expect(porLabel.get('Exigir diligência')).toBe(idExt('DILIGÊNCIA'))
    expect(porLabel.get('Reprovar crédito')).toBe(idExt('REPROVADOS'))
  })

  /**
   * PEDIR MEMORANDO NÃO É APROVAR NEM RECUSAR.
   *
   * O crédito não foi recusado e ainda não vai ao fundo: falta uma peça, e ela é
   * trabalho da casa — o caso do valor alto ou do originador sem vínculo direto.
   * O papel é `validar`, o mesmo de "Enviar para revisão" no RPV: passa adiante
   * para outra etapa de trabalho sem dizer nada sobre o mérito. É o papel que
   * decide o ícone, se o motivo é exigido e o tom que a IA usa na anotação —
   * marcá-lo como aprovação faria a nota do Kommo anunciar um encaminhamento que
   * não aconteceu.
   */
  it('a Revisão pode pedir o memorando, ao lado de aprovar', () => {
    const revisao = abas.find((a) => a.key === 'ext-revisao')!
    const memorando = revisao.acoes.find((x) => x.label === 'Pedir memorando')!
    expect(memorando.statusId).toBe(idExt('MEMORANDO DE NEGOCIAÇÃO'))
    expect(memorando.papel).toBe('validar')
    expect(memorando.variant).toBe('secondary')
    // AO LADO DE APROVAR, e logo depois: a ordem dos botões é a ordem das saídas
    // declaradas na etapa, e a aprovação é o caminho que se busca.
    expect(revisao.acoes.map((x) => x.label).slice(0, 2)).toEqual([
      'Aprovar crédito',
      'Pedir memorando',
    ])
  })

  /**
   * AQUI O RÓTULO NÃO DIZ O DESTINO, e é de propósito: o derivado sairia
   * "Aprovar e enviar para Aprovados", que gagueja e não informa nada. O nome do
   * destino só precisa ser dito quando ele SURPREENDE — como na qualificação,
   * onde aprovar manda para a revisão.
   */
  it('na Revisão é aprovação de verdade, e no azul da casa', () => {
    const revisao = abas.find((a) => a.key === 'ext-revisao')!
    const aprovar = revisao.acoes.find((x) => x.papel === 'aprovar')!
    expect(aprovar.label).toBe('Aprovar crédito')
    expect(aprovar.variant).toBe('primary')
  })

  /**
   * DILIGÊNCIA SANADA VOLTA PARA A REVISÃO (29/09/2026): um botão próprio no
   * card — não o "Concluir" agrupado, porque a Diligência não tem fileira de
   * trabalho —, e sem diligência nem recusa ao lado.
   */
  it('a Diligência devolve o card à revisão, num botão próprio', () => {
    const diligencia = abas.find((a) => a.key === 'ext-diligencia')!
    expect(diligencia.acoes).toHaveLength(1)
    expect(diligencia.acoes[0]).toMatchObject({
      label: 'Sanar',
      variant: 'success',
      statusId: idExt('REVISÃO DA QUALIFICAÇÃO'),
      papel: 'validar',
    })
    expect(diligencia.desfechoAgrupado).toBe(false)
  })

  // O MEMORANDO ASSINADO leva o card à remessa aos fundos — pelo id, mesmo com a
  // coluna renomeada ("Remessa aos fundos" no Kommo desde 29/09/2026).
  it('o Memorando tem o botão de anexar e mover para a remessa aos fundos', () => {
    const memorando = abas.find((a) => a.key === 'ext-memorando')!
    expect(memorando.anexarEMover).toEqual({
      rotulo: 'Anexar',
      nota: 'Memorando assinado.',
      statusId: idExt('ENCAMINHAR AOS FUNDOS'),
    })
    expect(destinoPermitido(FUNIL_PRECATORIO_EXTERNO, 111533980, 'Remessa aos fundos')).toBe(true)
    // E SÓ ELE: o resto das abas não tem o botão.
    expect(abas.filter((a) => a.anexarEMover).map((a) => a.key)).toEqual(['ext-memorando'])
  })

  /**
   * O ENVIO AOS FUNDOS na remessa (29/09/2026): um check por fundo com
   * plataforma própria; a etiqueta de cada um é das da casa (senão a
   * kommo-etiquetar a recusaria), e o destino é Em precificação — pelo id.
   */
  it('a Remessa aos fundos tem os checks do BTG e da PJus, e leva a Em precificação', () => {
    const remessa = abas.find((a) => a.key === ABA_APROVADOS_EXTERNO)!
    // DOIS DESFECHOS POR FUNDO (01/10/2026): aceito ou reprovado.
    expect(
      remessa.envioAosFundos?.fundos.map((f) => [f.fundo, f.atos.map((a) => [a.etiqueta, a.reprova ?? false])]),
    ).toEqual([
      ['BTG', [['Cotado BTG', false], ['Reprovado BTG', true]]],
      ['PJus', [['Enviado PJus', false], ['Reprovado PJus', true]]],
    ])
    for (const f of remessa.envioAosFundos!.fundos) {
      for (const a of f.atos) expect(etiquetaCanonica(a.etiqueta), a.etiqueta).toBe(a.etiqueta)
      expect(f.plataforma, f.fundo).toMatch(/^https:\/\//)
    }
    expect(remessa.envioAosFundos?.destino).toBe(idExt('EM PRECIFICAÇÃO'))
    expect(destinoPermitido(FUNIL_PRECATORIO_EXTERNO, 111533984, 'EM PRECIFICAÇÃO')).toBe(true)
  })

  /**
   * AS CERTIDÕES NA OBTENÇÃO DE DOCUMENTAÇÃO (29/09/2026): o botão que abre o
   * painel de certidões do Interno — só ali, e sem os botões de trabalho nem
   * desfecho.
   */
  it('a Obtenção de documentação tem o botão de certidões, e só ela', () => {
    const doc = abas.find((a) => a.key === 'ext-documentacao')!
    expect(doc.statusIds).toEqual([idExt('OBTENÇÃO DE DOCUMENTAÇÃO')])
    expect(doc.certidoes).toBe(true)
    expect(doc.acoes).toEqual([])
    expect(ABAS_EXTERNO_SEM_TRABALHO.has('ext-documentacao')).toBe(true)
    expect(abas.filter((a) => a.certidoes).map((a) => a.key)).toEqual(['ext-documentacao'])
  })

  it('as demais abas do Externo não oferecem desfecho', () => {
    for (const aba of abas.filter((a) => !DECISORIAS.includes(a.key) && a.key !== 'ext-diligencia')) {
      expect(aba.acoes, aba.label).toEqual([])
    }
  })

  /**
   * AS TRÊS SAEM DE UM BOTÃO SÓ. A análise acontece fora da plataforma, numa
   * conversa com o Claude; três botões soltos no card convidariam o clique antes
   * do texto, e o texto é o único registro que aquela análise deixa no CRM.
   */
  it('as duas etapas de decisão marcam o desfecho como agrupado', () => {
    for (const aba of abas) {
      expect(aba.desfechoAgrupado, aba.label).toBe(DECISORIAS.includes(aba.key))
    }
  })

  // Sem a coluna no espelho não há saída: melhor a janela com duas do que um
  // botão que move o card para lugar nenhum.
  it('saída sem coluna no kanban simplesmente não aparece', () => {
    const sem = espelho(
      COLUNAS_INTERNO,
      COLUNAS_EXTERNO.filter((n) => n !== 'DILIGÊNCIA'),
    )
    const revisao = abasDoFunil(FUNIL_PRECATORIO_EXTERNO, sem, 'externo').find(
      (a) => a.key === 'ext-revisao',
    )!
    expect(revisao.acoes.map((x) => x.papel)).toEqual(['aprovar', 'validar', 'reprovar'])
  })
})

describe('as duas trilhas não dividem mais nenhuma coluna', () => {
  /**
   * O REMENDO QUE OS FUNIS SEPARADOS DESFIZERAM.
   *
   * Enquanto as trilhas moravam no mesmo pipeline, "Apresentação de Proposta"
   * era a MESMA coluna nas duas — "Aprovados" no Interno, "Apresentação" no
   * Externo —, e o mesmo card era contado duas vezes. Agora cada funil tem a
   * sua, e a contagem por trilha fecha com a do topo.
   */
  it('nenhum status_id aparece nas abas das duas', () => {
    const ids = (sub: 'interno' | 'externo') =>
      new Set(
        abasDoFunil(
          sub === 'interno' ? FUNIL_PRECATORIO : FUNIL_PRECATORIO_EXTERNO,
          espelho(),
          sub,
        ).flatMap((a) => a.statusIds),
      )
    const interno = ids('interno')
    const externo = ids('externo')
    expect([...interno].filter((id) => externo.has(id))).toEqual([])
  })
})

describe('coluna renomeada no Kommo', () => {
  /**
   * RENOMEAR NO KOMMO NÃO TIRA A COLUNA DO INTERNO (02/10/2026). Foi exatamente o
   * que aconteceu: "REVISÃO DA ANÁLISE" virou "Revisão" e "PROTOCOLAR" virou
   * "Protocolo", e com o vínculo só pelo nome as duas abas ficaram vazias, o
   * "Enviar para revisão" sumiu e o servidor recusava o destino.
   */
  it('renomear no Kommo não tira a coluna do Interno', () => {
    const renomeado = [
      ...colunasInterno(COLUNAS_INTERNO, { 'Revisão': 'Segunda leitura', 'Protocolo': 'A protocolar' }),
      ...colunasExterno(COLUNAS_EXTERNO),
      ...DE_SISTEMA(FUNIL_PRECATORIO_EXTERNO),
    ]
    expect(colunasPrecatorioDesalinhadas(renomeado, 'interno')).toEqual([])
    const abas = abasDoFunil(FUNIL_PRECATORIO, renomeado, 'interno')
    // PELA CHAVE: desde a onda 2 o rótulo da aba é o nome do Kommo — o novo.
    expect(abas.find((a) => a.key === 'int-revisao')!).toMatchObject({
      label: 'Segunda leitura',
      statusIds: [IDS_INTERNO['Revisão']],
    })
    expect(abas.find((a) => a.key === 'int-protocolo')!).toMatchObject({
      label: 'A protocolar',
      statusIds: [IDS_INTERNO['Protocolo']],
    })
    const emAnalise = abas.find((a) => a.key === ABA_ANALISE_INTERNA)!
    expect(emAnalise.acoes.find((x) => x.papel === 'aprovar')!.statusId).toBe(IDS_INTERNO['Revisão'])
  })

  it('o servidor aceita o destino renomeado, pelo id', () => {
    expect(destinoPermitido(FUNIL_PRECATORIO, IDS_INTERNO['Revisão'], 'Segunda leitura')).toBe(true)
    expect(destinoPermitido(FUNIL_PRECATORIO, IDS_INTERNO['Produção de proposta'], 'Proposta ao cedente')).toBe(true)
    // E continua recusando coluna do comercial, com qualquer nome.
    expect(destinoPermitido(FUNIL_PRECATORIO, IDS_INTERNO['Fechados'], 'Fechados')).toBe(false)
    expect(destinoPermitido(FUNIL_PRECATORIO, IDS_INTERNO['Protocolo'], 'Protocolo')).toBe(false)
  })

  // O MODO DE FALHA QUE SOBRA: coluna APAGADA E RECRIADA no Kommo ganha id novo,
  // e se vier com outro nome nada a liga. Isso tem de ser denunciado, não calado.
  const recriado = [
    ...colunasInterno(COLUNAS_INTERNO.filter((n) => n !== 'Revisão')),
    { pipeline_id: FUNIL_PRECATORIO, status_id: 99_999, pipeline_nome: 'Funil Precatório Interno', nome: 'Revisão da análise feita', ordem: 99, tipo: 0 },
    ...colunasExterno(COLUNAS_EXTERNO),
    ...DE_SISTEMA(FUNIL_PRECATORIO_EXTERNO),
  ]

  it('é denunciada, com o nome que se esperava', () => {
    const faltando = colunasPrecatorioDesalinhadas(recriado, 'interno')
    expect(faltando.map((a) => a.colunaKommo)).toEqual(['REVISÃO'])
    expect(faltando.map((a) => a.label)).toEqual(['Revisão'])
  })

  it('deixa a aba na tela, vazia, em vez de sumir com ela', () => {
    // Sumir com a aba esconderia o defeito: a pessoa não teria como saber qual
    // faltou. DESDE A ONDA 2 o Interno mostra o kanban inteiro: a coluna
    // recriada entra só para leitura, e a aba de trabalho cuja coluna sumiu fica
    // no fim, vazia, com o nome de 02/10/2026.
    const abas = abasDoFunil(FUNIL_PRECATORIO, recriado, 'interno')
    expect(abas.at(-1)).toMatchObject({ key: 'int-revisao', label: 'Revisão', statusIds: [] })
    expect(abas.find((a) => a.key === 'col-99999')).toMatchObject({ soLeitura: true, acoes: [] })
    expect(abas.filter((a) => a.key === 'int-revisao')).toHaveLength(1)
  })

  it('também é denunciada no funil novo do Externo', () => {
    const torto = espelho(
      COLUNAS_INTERNO,
      COLUNAS_EXTERNO.map((n) => (n === 'FECHADOS' ? 'FECHADO' : n)),
    )
    const faltando = colunasPrecatorioDesalinhadas(torto, 'externo')
    expect(faltando.map((a) => a.colunaKommo)).toEqual(['FECHADOS'])
  })

  it('não acusa nada quando o espelho ainda não chegou', () => {
    // Espelho vazio é "não sei ainda", não "está errado".
    expect(colunasPrecatorioDesalinhadas([])).toEqual([])
  })

  /**
   * ESPELHO DE UMA TRILHA SÓ NÃO ACUSA A OUTRA.
   *
   * Com as trilhas em funis diferentes, o espelho de uma pode chegar antes do da
   * outra — e acusar a que ainda não sincronizou seria apontar defeito onde só
   * falta dado. Este é o caso que não existia enquanto havia um funil só.
   */
  it('funil ainda não espelhado não é tratado como desalinhado', () => {
    const soInterno = colunasDe(FUNIL_PRECATORIO, COLUNAS_INTERNO, 90_000)
    expect(colunasPrecatorioDesalinhadas(soInterno, 'externo')).toEqual([])
    expect(colunasPrecatorioDesalinhadas(soInterno)).toEqual([])
  })
})

describe('acento, caixa e espaço não quebram o casamento', () => {
  // PELO NOME DE RESERVA: ids que o espelho não conhece forçam o casamento pelo
  // nome, que tem de tolerar acento, caixa e espaço sobrando.
  it('casa a coluna escrita sem acento e em caixa alta', () => {
    const torto = [
      ...colunasDe(
        FUNIL_PRECATORIO,
        COLUNAS_INTERNO.map((n) => (n === 'Análise jurídica e econômica' ? 'ANALISE  JURIDICA E ECONOMICA ' : n === 'Revisão' ? 'REVISAO' : n)),
        90_000,
      ),
      ...colunasExterno(COLUNAS_EXTERNO),
      ...DE_SISTEMA(FUNIL_PRECATORIO_EXTERNO),
    ]
    expect(colunasPrecatorioDesalinhadas(torto, 'interno')).toEqual([])
  })

  // O funil novo escreve tudo em caixa alta e a plataforma fixa o mesmo texto;
  // se um dia o Kommo voltar à caixa mista, nada pode quebrar.
  it('casa a coluna do funil novo escrita em caixa mista', () => {
    const torto = espelho(
      COLUNAS_INTERNO,
      COLUNAS_EXTERNO.map((n) => (n === 'REPROVADOS' ? 'Reprovados' : n)),
    )
    expect(colunasPrecatorioDesalinhadas(torto, 'externo')).toEqual([])
  })
})

describe('cards fora das trilhas', () => {
  it('não entram em aba nenhuma, e nem se misturam na primeira', () => {
    // A tela não exibe mais esse saldo (nem aba, nem linha de contagem). O que
    // este teste garante é o particionamento: card de coluna que não é do
    // operacional fica FORA das abas, e não encostado na primeira delas.
    const etapas = espelho()
    const abas = abasDoFunil(FUNIL_PRECATORIO, etapas, 'interno')
    // DESDE A ONDA 2 o Interno mostra o kanban inteiro (Fechados e Escritura
    // pública viraram abas só de leitura); fora das abas ficam a entrada de
    // leads e as colunas de sistema.
    const { porAba, outras } = agruparPorAba(
      [
        lead(idDe('Análise jurídica e econômica', etapas), 1),
        lead(idDe('Etapa de leads de entrada', etapas), 2),
        lead(143, 3),
      ],
      abas,
    )
    expect(porAba[ABA_ANALISE_INTERNA].map((l) => l.kommo_lead_id)).toEqual([1])
    // A ORDEM AQUI NAO E O ASSUNTO: cada coluna passou a sair do mais novo para
    // o mais antigo, e o que este teste guarda e o particionamento.
    expect([...outras.map((l) => l.kommo_lead_id)].sort((a, b) => a - b)).toEqual([2, 3])
  })
})

/**
 * A ORDEM DENTRO DA COLUNA, e a data que a decide.
 *
 * A pergunta de quem abre a tela é há quanto tempo um crédito está parado
 * naquela etapa. Nenhum campo do card do Kommo responde isso: `created_at` é o
 * nascimento — um card de março movido ontem erra por cinco meses — e
 * `updated_at` muda quando alguém troca uma tag. A resposta vem do evento
 * `lead_status_changed`, que o kommo-sync grava em `etapa_em`.
 */
describe('a ordem dentro da coluna', () => {
  const etapas = espelho()
  const abas = abasDoFunil(FUNIL_PRECATORIO, etapas, 'interno')
  const juridico = idDe('Análise jurídica e econômica', etapas)
  const naColuna = (
    id: number,
    etapa_em: string | null,
    extras: Partial<KommoLead> = {},
  ): KommoLead =>
    ({
      ...lead(juridico, id),
      etapa_em,
      etapa_status_id: juridico,
      criado_em: null,
      ...extras,
    }) as KommoLead

  it('o mais recente vem primeiro', () => {
    const { porAba } = agruparPorAba(
      [
        naColuna(1, '2026-09-01T10:00:00Z'),
        naColuna(2, '2026-09-14T10:00:00Z'),
        naColuna(3, '2026-09-08T10:00:00Z'),
      ],
      abas,
    )
    expect(porAba[ABA_ANALISE_INTERNA].map((l) => l.kommo_lead_id)).toEqual([2, 3, 1])
  })

  /**
   * A DATA SÓ VALE PARA A COLUNA EM QUE FOI APURADA.
   *
   * Entre uma sincronização e outra alguém move o card no Kommo. Sem comparar
   * `etapa_status_id` com `status_id`, a tela exibiria com toda a confiança há
   * quanto tempo o card está num lugar onde ele já não está — e o erro seria
   * invisível, porque data errada tem a mesma cara de data certa.
   */
  it('data de outra coluna não é exibida', () => {
    const mudouDeColuna = naColuna(1, '2026-09-14T10:00:00Z', { etapa_status_id: 999 })
    expect(dataDaEtapa(mudouDeColuna)).toBeNull()
    expect(dataDaEtapa(naColuna(2, '2026-09-14T10:00:00Z'))).toBe('2026-09-14T10:00:00Z')
    expect(dataDaEtapa(naColuna(3, null))).toBeNull()
  })

  // CARD SEM DATA APURADA NÃO AFUNDA. Ele cairia para o fim da lista com zero —
  // o pior lugar para um card que pode ter chegado hoje —, e a data de criação
  // erra por pouco e na direção certa.
  it('sem data apurada, a criação segura a posição', () => {
    const { porAba } = agruparPorAba(
      [
        naColuna(1, '2026-09-10T10:00:00Z'),
        naColuna(2, null, { criado_em: '2026-09-15T10:00:00Z' }),
        naColuna(3, null, { criado_em: '2026-09-02T10:00:00Z' }),
      ],
      abas,
    )
    expect(porAba[ABA_ANALISE_INTERNA].map((l) => l.kommo_lead_id)).toEqual([2, 1, 3])
  })

  // Empate pelo id, que também cresce no tempo: dois cards movidos no mesmo
  // instante (uma movimentação em lote) não podem trocar de lugar a cada render.
  it('empate desempata pelo id, do maior para o menor', () => {
    const { porAba } = agruparPorAba(
      [naColuna(7, '2026-09-10T10:00:00Z'), naColuna(9, '2026-09-10T10:00:00Z')],
      abas,
    )
    expect(porAba[ABA_ANALISE_INTERNA].map((l) => l.kommo_lead_id)).toEqual([9, 7])
  })
})

describe('statusExibidos — o número ao lado do tipo de crédito', () => {
  it('no Precatório, é a UNIÃO das duas trilhas, não a trilha aberta', () => {
    // O número descreve o FUNIL: trocar de destinação não muda quantos
    // precatórios existem. Se mudasse, se leria como dado mudando.
    const etapas = espelho()
    const ids = statusExibidos(FUNIL_PRECATORIO, etapas)
    // O kanban inteiro das duas trilhas, menos a entrada de leads de cada uma
    // (e as de sistema), e nada compartilhado desde a separação. ERAM 6 ABAS DO
    // INTERNO até a onda 2, quando ele passou a mostrar as 13 colunas.
    expect(ids.size).toBe(COLUNAS_INTERNO.length - 1 + COLUNAS_EXTERNO.length - 1)
  })

  it('a união vale seja qual for o funil de precatório perguntado', () => {
    // O parâmetro é o funil que a TELA tem aberto no topo. Como o precatório é
    // um tipo só para quem olha, os dois funis respondem a mesma união.
    const etapas = espelho()
    expect(statusExibidos(FUNIL_PRECATORIO_EXTERNO, etapas)).toEqual(
      statusExibidos(FUNIL_PRECATORIO, etapas),
    )
  })

  // MUDOU NA ONDA 2: as colunas do comercial do Interno (Fechados, Escritura
  // pública…) passaram a ser abas só de leitura, e por isso contam. O que fica
  // fora é o que não é aba: a entrada de leads e as de sistema.
  it('não inclui coluna do kanban que não está na tela', () => {
    const etapas = espelho()
    const ids = statusExibidos(FUNIL_PRECATORIO, etapas)
    expect(ids.has(idDe('Fechados', etapas))).toBe(true)
    expect(ids.has(idDe('Escritura pública', etapas))).toBe(true)
    expect(ids.has(idDe('Etapa de leads de entrada', etapas))).toBe(false)
    // NO EXTERNO O KANBAN É ESPELHADO INTEIRO, menos a entrada e as de sistema.
    expect(ids.has(idExt('Etapa de leads de entrada', etapas))).toBe(false)
    expect(ids.has(142)).toBe(false)
    expect(ids.has(143)).toBe(false)
  })

  it('a soma das pílulas fecha com o número do tipo de crédito', () => {
    // A invariante que o usuário vê: o número de cima é a soma dos de baixo.
    // AGORA ELA FECHA POR TRILHA TAMBÉM — antes não fechava, porque uma coluna
    // servia às duas e era contada duas vezes.
    const etapas = espelho()
    const leads = [
      lead(idDe('Análise jurídica e econômica', etapas), 1),
      lead(idDe('Revisão', etapas), 2),
      lead(idExt('QUALIFICAÇÃO PRELIMINAR', etapas), 3, FUNIL_PRECATORIO_EXTERNO),
      lead(idExt('FECHADOS', etapas), 4, FUNIL_PRECATORIO_EXTERNO),
      // A entrada de leads não é aba (nem no Interno, nem no Externo): não conta.
      lead(idDe('Etapa de leads de entrada', etapas), 5),
    ]
    const ids = statusExibidos(FUNIL_PRECATORIO, etapas)
    expect(leads.filter((l) => ids.has(l.status_id)).length).toBe(4)

    const somaDe = (sub: 'interno' | 'externo') => {
      const { porAba } = agruparPorAba(
        leads,
        abasDoFunil(
          sub === 'interno' ? FUNIL_PRECATORIO : FUNIL_PRECATORIO_EXTERNO,
          etapas,
          sub,
        ),
      )
      return Object.values(porAba).reduce((t, l) => t + l.length, 0)
    }
    expect(somaDe('interno')).toBe(2)
    expect(somaDe('externo')).toBe(2)
    expect(somaDe('interno') + somaDe('externo')).toBe(4)
  })

  // MUDOU DE PROPÓSITO NA ETAPA 7 (02/10/2026): eram os seis status curados; o
  // RPV passou a mostrar o kanban inteiro, e o número de cima conta o que a tela
  // mostra. Sem o funil do RPV no espelho (este só tem os de precatório), vale o
  // kanban de 02/10/2026 (`ESPELHO_RPV`): as 15 colunas.
  it('em RPV, são as colunas do kanban inteiro', () => {
    const ids = statusExibidos(FUNIL_RPV, espelho())
    expect(ids).toEqual(new Set(ESPELHO_RPV.map((c) => c.statusId)))
    expect(ids.size).toBe(15)
    for (const id of [ST_ANALISE, ST_DECISAO, ST_PROPOSTA, ST_DILIGENCIA, ST_REPROVADO, ST_PROTOCOLO]) {
      expect(ids.has(id)).toBe(true)
    }
    // A ENTRADA DE LEADS E AS DE SISTEMA continuam fora, como no Externo.
    expect(ids.has(107272795)).toBe(false)
    expect(ids.has(142)).toBe(false)
  })

  it('devolve vazio para funil desconhecido', () => {
    expect(statusExibidos(999, espelho()).size).toBe(0)
  })
})

describe('RPV não é afetado pela subdivisão', () => {
  // MUDOU DE PROPÓSITO NA ETAPA 7 (02/10/2026): eram as seis telas curadas, com
  // os rótulos da plataforma; agora é o kanban inteiro, com os nomes do Kommo
  // (decisão do dono), nas quatro fases. Os botões de mover são os mesmos.
  it('devolve o kanban inteiro nas quatro fases, com os botões de mover de antes', () => {
    // A subdivisão é um eixo só do Precatório. Passá-la aqui não pode mudar nada.
    const abas = abasDoFunil(FUNIL_RPV, espelho(), 'externo')
    expect(abas).toEqual(abasDoFunil(FUNIL_RPV, espelho(), 'interno'))
    expect(abas.map((a) => [a.label, a.fase])).toEqual([
      ['Análise Jurídica e Econômica', 'Qualificação'],
      ['Revisão', 'Qualificação'],
      ['Diligência', 'Qualificação'],
      ['Produção de proposta', 'Comercialização'],
      ['Negociação', 'Comercialização'],
      ['Fechados', 'Comercialização'],
      ['Oferta aos investidores', 'Comercialização'],
      ['Elaboração de contratos', 'Formalização'],
      ['Aguardando assinaturas', 'Formalização'],
      ['Protocolo', 'Formalização'],
      ['Pagamento finalizado', 'Formalização'],
      ['Reprovados operacional', 'Perdidos'],
      ['Reprovados comercial', 'Perdidos'],
      ['Sem resposta', 'Perdidos'],
      ['Não fechado', 'Perdidos'],
    ])
    // SÓ OS PERDIDOS SÃO DISCRETOS: não são etapa do fluxo.
    expect(abas.filter((a) => a.faseDiscreta).map((a) => a.label)).toEqual([
      'Reprovados operacional',
      'Reprovados comercial',
      'Sem resposta',
      'Não fechado',
    ])
    expect(abas.find((a) => a.key === 'validacao')!.acoes).toHaveLength(3)
    expect(abas.find((a) => a.key === 'pendentes')!.acoes).toHaveLength(3)
    // NENHUMA OUTRA ABA MOVE CARD — nem as seis de antes além destas duas, nem as
    // nove colunas novas, que são só leitura.
    expect(abas.filter((a) => a.acoes.length > 0).map((a) => a.key)).toEqual(['pendentes', 'validacao'])
    expect(abas.filter((a) => a.soLeitura).every((a) => a.key.startsWith('col-'))).toBe(true)
    expect(abas.filter((a) => a.soLeitura)).toHaveLength(9)
  })

  it('com o espelho do RPV, o nome é o do Kommo e a coluna que sumiu vai para o fim', () => {
    const renomeado = KANBAN_RPV.filter((e) => e.status_id !== ST_PROTOCOLO).map((e) =>
      e.status_id === ST_DECISAO ? { ...e, nome: 'Revisão e decisão' } : e,
    )
    const abas = abasDoFunil(FUNIL_RPV, renomeado)
    expect(abas.find((a) => a.key === 'validacao')!.label).toBe('Revisão e decisão')
    // A ABA DE TRABALHO CUJA COLUNA SUMIU continua existindo, no fim, com o nome
    // de 02/10/2026 — e o aviso de coluna sumida a aponta.
    expect(abas.at(-1)).toMatchObject({ key: 'protocolo', label: 'Protocolo', statusIds: [ST_PROTOCOLO] })
    expect(telasRpvDesalinhadas(renomeado).map((t) => t.key)).toEqual(['protocolo'])
  })
})

describe('ehCardExterno', () => {
  /**
   * A DESTINAÇÃO SAI DO CARD, não da pílula aberta.
   *
   * A subdivisão é um recorte da TELA. Se a due diligence perguntasse a ela,
   * alternar Interno/Externo atrás de uma janela aberta trocaria as frentes da
   * diligência em curso — a aba de certidões aparecendo e sumindo enquanto
   * alguém preenche o formulário.
   *
   * QUEM RESPONDE AGORA É O FUNIL, e não mais um conjunto de colunas resolvido
   * pelo nome: com um pipeline por trilha a resposta é exata e não depende de o
   * espelho ter chegado.
   */
  it('card do funil externo é externo', () => {
    expect(ehCardExterno(FUNIL_PRECATORIO_EXTERNO)).toBe(true)
  })

  it('card do funil interno não é', () => {
    expect(ehCardExterno(FUNIL_PRECATORIO)).toBe(false)
  })

  it('funil que não é de precatório não é', () => {
    expect(ehCardExterno(FUNIL_RPV)).toBe(false)
    expect(ehCardExterno(999)).toBe(false)
  })
})

describe('ABAS_EXTERNO_SEM_TRABALHO', () => {
  /**
   * As abas do Externo onde o trabalho da casa já passou — apresentação,
   * fechado, em diligência, reprovado. A tela as usa para esconder os botões;
   * chave escrita errada aqui faria o botão reaparecer na aba errada, sem erro.
   */
  it('toda chave listada existe entre as abas do Externo', () => {
    const externo = SUBDIVISOES_PRECATORIO.find((s) => s.key === 'externo')!
    const chaves = new Set(externo.abas.map((a) => a.key))
    for (const k of ABAS_EXTERNO_SEM_TRABALHO) {
      expect(chaves.has(k), k).toBe(true)
    }
  })

  // O MEMORANDO NÃO TEM BOTÃO DE TRABALHO: a análise já passou pela revisão.
  it('o memorando fica sem due diligence e sem Executar análise', () => {
    expect(ABAS_EXTERNO_SEM_TRABALHO.has('ext-memorando')).toBe(true)
  })

  // A REMESSA AOS FUNDOS saiu das abas de trabalho em 29/09/2026: o crédito já
  // foi ao mercado.
  it('deixa de fora as duas abas onde o trabalho acontece', () => {
    expect(ABAS_EXTERNO_SEM_TRABALHO.has('ext-encaminhar')).toBe(true)
    for (const k of ['ext-qualificacao', 'ext-revisao']) {
      expect(ABAS_EXTERNO_SEM_TRABALHO.has(k), k).toBe(false)
    }
  })
})

/**
 * AS FERRAMENTAS DO EXTERNO NO INTERNO (28/09/2026). A equipe pediu due
 * diligence com o Escavador, Executar análise e Concluir nas duas trilhas; a
 * tela esconde os botões onde o trabalho da casa já passou, e a lista do
 * Interno é o espelho da do Externo.
 */
describe('ABAS_INTERNO_SEM_TRABALHO', () => {
  // CHAVE ESCRITA ERRADA faria o botão reaparecer na aba errada, sem erro — o
  // mesmo risco, e o mesmo teste, da lista do Externo.
  it('toda chave listada existe entre as abas do Interno', () => {
    const interno = SUBDIVISOES_PRECATORIO.find((s) => s.key === 'interno')!
    const chaves = new Set(interno.abas.map((a) => a.key))
    for (const k of ABAS_INTERNO_SEM_TRABALHO) {
      expect(chaves.has(k), k).toBe(true)
    }
  })

  it('as abas de trabalho do Interno ficam com as ferramentas', () => {
    for (const k of ['int-analise', 'int-revisao', 'int-aprovados']) {
      expect(ABAS_INTERNO_SEM_TRABALHO.has(k), k).toBe(false)
    }
  })

  // A REVISÃO É O CASO QUE MOTIVOU O TESTE: sem botão ali, Aprovar crédito não
  // tinha como ser acionado pela plataforma — a aba tem saída e nenhuma porta.
  it('toda aba do Interno com saída é aba de trabalho', () => {
    const interno = SUBDIVISOES_PRECATORIO.find((s) => s.key === 'interno')!
    for (const aba of interno.abas.filter((a) => (a.saidas ?? []).length > 0)) {
      expect(ABAS_INTERNO_SEM_TRABALHO.has(aba.key), aba.key).toBe(false)
    }
  })

  // SÓ O DESFECHO AGRUPADO depende da fileira de trabalho (o "Concluir" mora
  // nela); o de botão próprio aparece no canto do card, em qualquer aba.
  it('o mesmo vale para o Externo', () => {
    const externo = SUBDIVISOES_PRECATORIO.find((s) => s.key === 'externo')!
    for (const aba of externo.abas.filter((a) => (a.saidas ?? []).length > 0 && a.desfechoAgrupado !== false)) {
      expect(ABAS_EXTERNO_SEM_TRABALHO.has(aba.key), aba.key).toBe(false)
    }
  })
})

describe('acaoDeReprovar', () => {
  /**
   * A RECUSA DA JANELA DE DUE DILIGENCE não segue o mapa das etapas.
   *
   * As ações de uma aba são as saídas daquela ETAPA: existem onde o trabalho
   * acontece e somem nas terminais. A recusa por diligência nasce do que a
   * apuração achou, e a apuração pode acontecer em qualquer card — inclusive na
   * trilha Externa, que não tem desfecho nenhum e deixava a janela achando
   * execução contra o cedente sem oferecer como recusar.
   */
  it('no interno, resolve a coluna pelo nome no espelho', () => {
    const a = acaoDeReprovar(FUNIL_PRECATORIO, espelho())
    expect(a?.statusId).toBe(idDe('Reprovados'))
    expect(a?.papel).toBe('reprovar')
  })

  /**
   * O NOME MUDOU NO FUNIL NOVO, e é por isso que cada trilha nomeia a sua
   * coluna: "Reprovados Operacional" virou "REPROVADOS". Um nome só, fixo no
   * arquivo, mandaria o botão procurar coluna inexistente — e sem coluna não há
   * botão, então a recusa sumiria da tela sem erro nenhum.
   */
  it('no externo, resolve a coluna com o nome do funil novo', () => {
    const a = acaoDeReprovar(FUNIL_PRECATORIO_EXTERNO, espelho())
    expect(a?.statusId).toBe(idExt('REPROVADOS'))
    expect(a?.papel).toBe('reprovar')
  })

  it('em RPV, é a constante de sempre', () => {
    expect(acaoDeReprovar(FUNIL_RPV, espelho())?.statusId).toBe(ST_REPROVADO)
  })

  // Sem a coluna no espelho não há botão: melhor a janela sem recusa do que um
  // botão que move o card para lugar nenhum.
  it('sem a coluna no kanban, não há ação', () => {
    const sem = espelho(COLUNAS_INTERNO.filter((n) => n !== 'Reprovados'))
    expect(acaoDeReprovar(FUNIL_PRECATORIO, sem)).toBeNull()
    expect(acaoDeReprovar(FUNIL_PRECATORIO, [])).toBeNull()
    expect(acaoDeReprovar(FUNIL_PRECATORIO_EXTERNO, [])).toBeNull()
  })

  it('funil que não é do operacional não tem recusa', () => {
    expect(acaoDeReprovar(999, espelho())).toBeNull()
  })
})

/**
 * A COR DA ETIQUETA SAI DO ATO, e o ato é a primeira palavra dela.
 *
 * As etiquetas da casa se escrevem "‹ato› ‹fundo›" — "Cotado BTG", "Reprovado
 * PJus", "Enviado ao Luiz". Na varredura de uma coluna o que a cor precisa dizer
 * é o ATO: quem cotou está vivo, quem reprovou acabou. O fundo é o texto, lido
 * depois que a cor chamou o olho.
 *
 * O que não casa com regra nenhuma cai numa paleta de reserva, e ali a cor não
 * tem recado: serve só para distinguir, e por isso verde e vermelho ficam fora
 * dela — uma etiqueta desconhecida que caísse no vermelho seria lida como recusa
 * por acaso.
 */
describe('tomDaTag', () => {
  it('a mesma etiqueta tem sempre a mesma cor', () => {
    expect(tomDaTag('Fundo Alfa')).toBe(tomDaTag('Fundo Alfa'))
    expect(tomDaTag('')).toBe(tomDaTag(''))
  })

  it('o ato manda na cor', () => {
    expect(tomDaTag('Cotado PJus')).toBe('green')
    expect(tomDaTag('Cotado BTG')).toBe('green')
    expect(tomDaTag('Enviado PJus')).toBe('blue')
    expect(tomDaTag('Reprovado BTG')).toBe('red')
    expect(tomDaTag('Reprovado PJus')).toBe('red')
    expect(tomDaTag('Sem proposta')).toBe('red')
  })

  // O FUNDO MUDA E A FLEXÃO TAMBÉM: a regra olha o começo do nome, não o nome
  // inteiro. "Cotado XP" entra amanhã e já nasce verde.
  it('a regra vale para o fundo que ainda não existe', () => {
    expect(tomDaTag('Cotado XP')).toBe('green')
    expect(tomDaTag('Enviado ao Luiz')).toBe('blue')
    expect(tomDaTag('Reprovada na mesa')).toBe('red')
    expect(tomDaTag('COTADO BTG')).toBe('green')
  })

  // A PALETA DE RESERVA NÃO TEM RECADO: verde e vermelho são cores que dizem
  // "passou" e "não passou", e uma etiqueta desconhecida não pode dizer isso por
  // acaso.
  it('etiqueta sem regra não cai em verde nem vermelho', () => {
    for (const nome of ['Fundo Alfa', 'Beta', 'urgente', 'XP', 'a', 'zzz', '2026']) {
      expect(TONS_DA_TAG, nome).toContain(tomDaTag(nome))
    }
    expect(TONS_DA_TAG).not.toContain('green')
    expect(TONS_DA_TAG).not.toContain('red')
  })

  // Etiquetas diferentes não podem cair todas na mesma cor: com um punhado de
  // fundos, a paleta tem de se dividir.
  it('nomes diferentes se espalham pela paleta', () => {
    const nomes = ['Fundo Alfa', 'Fundo Beta', 'Fundo Gama', 'Fundo Delta', 'Fundo Épsilon']
    expect(new Set(nomes.map(tomDaTag)).size).toBeGreaterThan(1)
  })
})

/**
 * DUAS ETIQUETAS IGUAIS EM COR, NO MESMO CARD, sugerem parentesco que não existe.
 *
 * Seis cores não bastam para toda etiqueta que existe — o comercial cria quantas
 * quiser — e nunca bastariam. O que se garante é o que o olho precisa: dentro de
 * um card, nenhuma se repete.
 */
describe('coresDasTags', () => {
  // As etiquetas reais de um card do funil externo, em 21/09/2026.
  const doCard = ['Enviado PJus', 'Reprovado BTG', 'Cotado BTG', 'Sem proposta']

  /**
   * A COR DO ATO NÃO DESVIA, e é a exceção que dá sentido à regra.
   *
   * "Reprovado BTG" e "Reprovado PJus" no mesmo card têm de sair vermelhas as
   * duas: a cor ali não separa etiquetas, diz o que aconteceu com o crédito em
   * cada fundo. Desviar a segunda por higiene visual apagaria a informação.
   */
  it('o mesmo ato repete a cor, de propósito', () => {
    const cores = coresDasTags(['Reprovado BTG', 'Reprovado PJus', 'Cotado XP'])
    expect(cores.get('Reprovado BTG')).toBe('red')
    expect(cores.get('Reprovado PJus')).toBe('red')
    expect(cores.get('Cotado XP')).toBe('green')
  })

  it('cada ato do card sai com a sua cor', () => {
    const cores = coresDasTags(doCard)
    expect(cores.get('Enviado PJus')).toBe('blue')
    expect(cores.get('Cotado BTG')).toBe('green')
    expect(cores.get('Reprovado BTG')).toBe('red')
    expect(cores.get('Sem proposta')).toBe('red')
  })

  it('as sem regra não se repetem entre si no mesmo card', () => {
    const semRegra = ['Fundo Alfa', 'Beta', 'urgente', 'XP', 'zzz']
    const cores = [...coresDasTags(semRegra).values()]
    expect(new Set(cores).size).toBe(semRegra.length)
  })

  it('a cor sai do nome quando não há choque', () => {
    const so = coresDasTags(['Reprovado BTG'])
    expect(so.get('Reprovado BTG')).toBe(tomDaTag('Reprovado BTG'))
  })

  // O DESVIO É LOCAL: só a segunda etiqueta do choque muda, e a primeira guarda
  // a cor do nome dela — é o que mantém a mancha reconhecível pela coluna.
  it('quem chega primeiro fica com a cor do próprio nome', () => {
    const nomes = [...TONS_DA_TAG.keys()].map((i) => `tag ${i}`)
    const cores = coresDasTags(nomes)
    expect(cores.get(nomes[0])).toBe(tomDaTag(nomes[0]))
    expect(new Set(cores.values()).size).toBe(TONS_DA_TAG.length)
  })

  // Mais etiquetas que cores: aí repete mesmo, e repetir é melhor do que deixar
  // de mostrar a etiqueta.
  it('não some com etiqueta quando as cores acabam', () => {
    const nomes = Array.from({ length: TONS_DA_TAG.length + 3 }, (_, i) => `t${i}`)
    expect(coresDasTags(nomes).size).toBe(nomes.length)
  })

  it('etiqueta repetida na lista não vira duas entradas', () => {
    expect(coresDasTags(['A', 'A', 'B']).size).toBe(2)
  })
})
