// AUDITORIA DE BUGS DA ANÁLISE DE CRÉDITO (09/10/2026).
//
// Os defeitos daqui moram na LIGAÇÃO dos componentes — um `disabled` que
// faltava, um `error` não lido, uma caixa que se desmonta no meio da operação —
// e não numa regra que se teste sozinha (as regras novas têm testes próprios:
// emCursoPorCard, baixarSemAba, linksNoTexto, rascunhoDaJustificativa,
// apuracaoMaisRecente). O projeto não tem jsdom nem biblioteca de componentes,
// então estes testes leem o código-fonte e prendem a correção no lugar.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ler = (caminho: string) => readFileSync(join(__dirname, '..', '..', caminho), 'utf8').replace(/\r\n/g, '\n')
const tela = ler('pages/operacional/AnaliseCredito.tsx')
/** O trecho entre dois marcadores do arquivo. */
const trecho = (t: string, de: string, ate: string) => {
  const i = t.indexOf(de)
  expect(i, `não achei "${de}"`).toBeGreaterThanOrEqual(0)
  const j = t.indexOf(ate, i + de.length)
  expect(j, `não achei "${ate}" depois de "${de}"`).toBeGreaterThan(i)
  return t.slice(i, j)
}

describe('Fechado! e Escolher proposta: a nota que falha com o card já movido', () => {
  it('moverComNota lança o erro com tipo próprio', () => {
    const corpo = trecho(tela, 'async function moverComNota(', 'function esquecerMovimentos(')
    expect(corpo).toContain('throw new NotaNaoSubiu(')
  })

  it('o "Fechado!" avisa a falha da nota mesmo com a caixa já desmontada', () => {
    const corpo = trecho(tela, 'async function fechadoNoCard(', '/** "Gerar contrato"')
    expect(corpo).toContain('if (ehNotaNaoSubiu(e)) toast.error((e as Error).message)')
    expect(tela).toContain('onFechado: (lead, nota) => fechadoNoCard(lead, abaAtual.negociacao!.fechado!, nota),')
  })

  it('o "Escolher proposta" avisa pelo tipo do erro, e não pela memória (que a caixa fechada já esqueceu)', () => {
    const corpo = trecho(tela, 'async function escolherProposta(', 'function acionar(')
    expect(corpo).toContain('if (ehNotaNaoSubiu(e) || movimentoRecusado(jaMovidos.current, lead.kommo_lead_id, statusId)) {')
  })

  it('as duas caixas esquecem o movimento sem nota ao fechar ou sumir com o card', () => {
    expect(trecho(tela, 'function BotaoEscolherProposta(', '/** Quanto o passar do mouse')).toContain(
      'useAoFecharACaixa(aberto, onDesistir)',
    )
    expect(trecho(tela, 'function BotaoFechado(', 'function JanelaNaoFechou(')).toContain(
      'useAoFecharACaixa(aberto, onDesistir)',
    )
    expect(tela).toContain('onDesistir={() => onDesistirDoMovimento?.(lead.kommo_lead_id)}')
    expect(tela).toContain('onDesistirDoMovimento={esquecerMovimentos}')
  })

  it('com o card ainda no ar, o esquecer fica para quando a operação acabar', () => {
    expect(trecho(tela, 'function esquecerMovimentos(', '/** O card já se moveu')).toContain(
      'if (!esquecerAgoraOuDepois(cardsTravados.current, esquecerDepois.current, leadId)) return',
    )
    expect(trecho(tela, 'async function comCardTravado<T>(', '/** Etiqueta em gravação')).toContain(
      'if (esquecerDepois.current.has(leadId)) esquecerMovimentos(leadId)',
    )
  })
})

describe('Preencher planilha: a reserva não vale com o bloco sendo gravado', () => {
  it('"Não tenho o bloco" fica desligado enquanto a gravação está no ar', () => {
    const corpo = trecho(tela, 'function JanelaDaPlanilha(', 'function JanelaDeMensagem(')
    expect(corpo).toMatch(/disabled=\{enviando\}\s*onClick=\{\(\) => \{\s*onMotorAntigo\(\)/)
  })
})

describe('Anexo do histórico: o link do Kommo vence', () => {
  it('o cache por nome guarda o prazo do link, e não a promessa para sempre', () => {
    const corpo = trecho(tela, 'function prepararAnexo(', 'async function abrirAnexo(')
    expect(corpo).toContain('guardada.venceEm === null || Date.now() < guardada.venceEm')
    expect(corpo).toContain('novo.venceEm = validadeDoLink(r.download, Date.now())')
  })

  it('o download que falhou tira o link do cache — o próximo clique pede outro', () => {
    const corpo = trecho(tela, 'async function abrirAnexo(', 'async function baixarAnexosDoCard(')
    expect(corpo).toMatch(/catch \(e\) \{\s*esquecerLinkDoAnexo\(lead, anexo\)/)
  })
})

describe('Executar análise do precatório: uma pasta do Drive por card', () => {
  it('dois cliques seguidos não pedem duas pastas ao mesmo tempo', () => {
    const corpo = trecho(tela, 'async function criarPastaDoCard(', '// ------------------------------------------------ A FILA')
    expect(corpo).toContain('if (pastasEmCriacao.current.has(lead.kommo_lead_id)) return')
    expect(corpo).toContain('pastasEmCriacao.current.delete(lead.kommo_lead_id)')
  })
})

describe('Executar análise do RPV: a leitura das verbas recusadas', () => {
  it('o erro da consulta é lido e dito, em vez de precificar a verba recusada em silêncio', () => {
    const fn = trecho(tela, 'async function onAnalisar(', 'setRpvLead(lead)')
    expect(fn).toContain('const { data: recusadas, error: erroDasRecusadas } = await supabase')
    expect(fn).toContain('if (erroDasRecusadas) {')
  })
})

describe('Etiqueta de fora do Kommo com "&"', () => {
  it('aparece legível no card (a API devolve "&amp;")', () => {
    expect(tela).toContain('const nomeNaTela = etiquetaCanonica(t) ?? semEntidadesHtml(t)')
    expect(tela).not.toContain('{etiquetaCanonica(t) ?? t}')
    // Para tirar, vai o nome como veio do Kommo.
    expect(tela).toContain("onClick={() => onEtiquetar(lead, t, 'remover')}")
  })
})

describe('Justificativa técnica', () => {
  const j = ler('components/JustificativaTecnica.tsx')

  it('a edição salva entra no cache (reabrir depois de outro card trazia o texto antigo)', () => {
    expect(j).toContain('qc.setQueryData<Linha | null>([TABELA, doCard], (antes) =>')
    expect(j).toContain('comRascunhoSalvo(antes,')
  })

  it('o envio que volta só fecha a janela se ela ainda for do mesmo card', () => {
    expect(trecho(j, 'async function enviar()', '// ---------------- o que mostrar')).toContain(
      'if (cardAberto.current === leadId) onFechar()',
    )
  })

  it('sair da tela salva a edição que ainda esperava a pausa', () => {
    expect(j).toMatch(/const valor = pendente\.current\s*cancelarRelogio\(\)\s*if \(valor !== null\) void salvarAgora\.current\(valor\)/)
  })
})

describe('Caixa do Anotar', () => {
  const c = ler('components/CaixaDeAnotacao.tsx')

  it('arrastar arquivo enquanto envia não deixa o navegador abri-lo (e derrubar o envio)', () => {
    const corpo = trecho(c, 'const sobre = (e: DragEvent) => {', 'const saiu =')
    expect(corpo).toMatch(/if \(!temArquivos\(e\)\) return\s*e\.preventDefault\(\)\s*if \(a\.enviando\)/)
    expect(trecho(c, 'const soltou = (e: DragEvent) => {', '// COLAR UM PRINT')).toContain('if (a.enviando) return')
  })

  it('tirado o último arquivo que falhou, a rodada acaba (a linha "Arquivo anexado" volta)', () => {
    expect(trecho(c, 'const tirar = (chave: string) => {', 'const mudarEstado')).toContain(
      'if (resto.length === 0) textoSubiu.current = false',
    )
  })
})

describe('Due diligence: Seguir sem nada para liberar', () => {
  it('confere quantas linhas a liberação pegou, e diz quando foi nenhuma', () => {
    const d = ler('components/DueDiligence.tsx')
    const corpo = trecho(d, 'async function seguir()', 'async function redigir(')
    expect(corpo).toContain(".select('id')")
    expect(corpo).toContain('if ((data ?? []).length === 0) {')
  })
})

describe('Análise de RPV: o levantamento do cartório', () => {
  const r = ler('components/AnaliseRpvModal.tsx')

  it('trocar de cenário retoma o levantamento, com o cenário novo', () => {
    const corpo = trecho(r, 'async function trocarCenario(', 'async function pedirAlteracao(')
    expect(corpo).toContain('void levantarRegraCartorio(r, novo)')
    expect(corpo).toContain('void levantarRegraCartorio(atual, anterior)')
    expect(trecho(r, 'async function levantarRegraCartorio(', 'async function trocarCenario(')).toContain(
      '...(tipo ? { tipo_aquisicao: tipo } : {}),',
    )
  })

  it('o pedido do chat que falha retoma o levantamento da análise na tela', () => {
    const corpo = trecho(r, 'async function pedirAlteracao(', '* Aplica um custo de cartório DIGITADO')
    expect(corpo).toMatch(/Não consegui aplicar[\s\S]*void levantarRegraCartorio\(atual\)/)
  })

  it('a execução que sai não apaga o andamento da que entrou, e não pergunta com a janela fechada', () => {
    const corpo = trecho(r, 'async function levantarRegraCartorio(', 'async function trocarCenario(')
    expect(corpo).toContain('if (execucaoDoCartorio.current === minha) setPassoCartorio(null)')
    expect(corpo).toMatch(/for \(let volta = 0; ; volta\+\+\) \{[\s\S]{0,300}?if \(parou\(\)\) return\s*try \{/)
  })
})

describe('Certidões', () => {
  const p = ler('components/PainelCertidoes.tsx')

  it('cadastro gravado e checklist falhado: diz as duas coisas e mostra o banco como ficou', () => {
    const corpo = trecho(p, "await supabase.rpc('dd_registrar_sujeitos'", 'async function gerarFaltantes()')
    expect(corpo).toMatch(/catch \(e\) \{\s*await recarregar\(\)\s*setErro\(\s*`O cadastro foi gravado, mas o checklist não foi montado/)
  })

  it('a falha ao ler o card (número do processo) é dita, e não vira "falta no cadastro"', () => {
    expect(p).toContain('`Não consegui ler o card (número do processo e pasta do Drive): ${rl.error.message}. `')
    expect(p).toMatch(/if \(!rl\.error\) \{\s*setCnjDoCredito\(/)
  })

  it('a atualização do checklist durante a emissão não falha em silêncio', () => {
    const corpo = trecho(p, 'const recarregarItens = useCallback(async () => {', '}, [leadId])')
    expect(corpo).toContain('const falha = ri.error ?? rc.error')
    expect(p).toContain('{erroDaAtualizacao && (')
  })

  it('a leitura da IA que chega depois de gravar não mexe no formulário do banco', () => {
    const corpo = trecho(p, 'async function lerComIA()', 'function municipioDoIbge(')
    expect(corpo).toMatch(/setLeituraIA\(q\)[\s\S]*if \(!editandoRef\.current\) return\s*aplicarLeitura\(q\)/)
  })
})
