// AUDITORIA A DA ANÁLISE DE CRÉDITO (12/11/2026): os defeitos achados na tela
// (AnaliseCredito.tsx) e nas regras dela (kommo.ts, envioAoFundo.ts), presos
// aqui. Lógica pura onde a regra mora num módulo; leitura da fonte onde ela é
// uma linha da tela (sem jsdom).

import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  comNotasLocais,
  esquecerNotasLocais,
  guardarEdicaoLocal,
  guardarNotaLocal,
  VALIDADE_DA_NOTA_LOCAL,
} from '../kommo'
import { ArquivoDoEnvioNaoSubiu, registrarEnvioAoFundo, type PassosDoEnvio } from '../envioAoFundo'
import { TRILHAS_PRECATORIO, type AtoDoEnvio } from '../../../supabase/functions/_shared/trilhasDoPrecatorio.ts'
import type { Cotacao } from '../../../supabase/functions/_shared/cotacaoDoFundo.ts'
import type { KommoLead, KommoNota } from '../types'

// SEM O \r DO WINDOWS: as fontes estão em CRLF, e os trechos procurados aqui, em LF.
const ler = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
const TELA = ler('../../pages/operacional/AnaliseCredito.tsx')
const KOMMO = ler('../kommo.ts')

/** O trecho da fonte entre duas marcas. */
const trecho = (fonte: string, de: string, ate: string) => {
  const i = fonte.indexOf(de)
  expect(i, `não achei "${de}"`).toBeGreaterThanOrEqual(0)
  const j = fonte.indexOf(ate, i + de.length)
  expect(j, `não achei "${ate}" depois de "${de}"`).toBeGreaterThan(i)
  return fonte.slice(i, j)
}

const nota = (id: number, texto: string, extra: Partial<KommoNota> = {}): KommoNota => ({
  id,
  texto,
  criado_em: '2026-11-12T13:00:00.000Z',
  autor: 'Ana',
  tipo: 'common',
  automatica: false,
  ...extra,
})
const card = (id: number, notas: KommoNota[]): KommoLead => ({ kommo_lead_id: id, notas }) as unknown as KommoLead
const textos = (l: KommoLead | undefined) => (l?.notas ?? []).map((n) => n.texto)

describe('a nota escrita pela tela não some na releitura do espelho (comNotasLocais)', () => {
  beforeEach(() => esquecerNotasLocais())
  const AGORA = Date.parse('2026-11-12T13:00:00.000Z')

  it('sem nada esperando, a lista volta a mesma (nenhuma cópia à toa)', () => {
    const leads = [card(1, [nota(10, 'a')])]
    expect(comNotasLocais(leads, AGORA)).toBe(leads)
  })

  it('a nota com o id do Kommo fica até o espelho trazer esse id — e aí sai, sem duplicar', () => {
    guardarNotaLocal(1, nota(77, 'Falei com o advogado.'), { agora: AGORA })
    // O espelho de antes (outro card movido releu a lista): a nota continua.
    const antes = comNotasLocais([card(1, [nota(10, 'cadastro')])], AGORA + 1000)
    expect(textos(antes[0])).toEqual(['cadastro', 'Falei com o advogado.'])
    // O espelho sincronizado: a nota vem dele, com o rodapé, uma vez só.
    const depois = comNotasLocais(
      [card(1, [nota(10, 'cadastro'), nota(77, 'Falei com o advogado.\n\n— registrado por Ana pela plataforma Credijuris')])],
      AGORA + 2000,
    )
    expect(depois[0].notas.filter((n) => n.id === 77)).toHaveLength(1)
    // E não volta mais, nem com um espelho atrasado.
    expect(textos(comNotasLocais([card(1, [nota(10, 'cadastro')])], AGORA + 3000)[0])).toEqual(['cadastro'])
  })

  it('sem id (função antiga), sai quando o espelho tem nota que começa pelo texto dela; o anexo, pelo arquivo', () => {
    guardarNotaLocal(1, nota(-5, 'Pedido de documento.'), { agora: AGORA })
    guardarNotaLocal(1, nota(-6, '📎 rg.pdf', { tipo: 'attachment', arquivo_uuid: 'uuid-rg' }), { agora: AGORA })
    expect(comNotasLocais([card(1, [])], AGORA)[0].notas).toHaveLength(2)
    const sincronizado = comNotasLocais(
      [card(1, [nota(90, 'Pedido de documento.\n\n— registrado por Ana pela plataforma Credijuris'), nota(91, 'rg.pdf', { tipo: 'attachment', arquivo_uuid: 'uuid-rg' })])],
      AGORA + 1000,
    )
    expect(sincronizado[0].notas.map((n) => n.id)).toEqual([90, 91])
  })

  it('a justificativa em partes sai quando o espelho traz as partes (pelos ids delas)', () => {
    guardarNotaLocal(1, nota(-9, 'parte um parte dois'), { agora: AGORA, idsNoKommo: [501, 502] })
    expect(comNotasLocais([card(1, [])], AGORA)[0].notas).toHaveLength(1)
    const comAsPartes = comNotasLocais([card(1, [nota(501, 'parte um'), nota(502, 'parte dois')])], AGORA + 1000)
    expect(comAsPartes[0].notas.map((n) => n.id)).toEqual([501, 502])
  })

  it('o card de fora desta leitura (o outro funil) não perde a nota; passado o teto, ela sai', () => {
    guardarNotaLocal(2, nota(55, 'Nota do card do outro funil.'), { agora: AGORA })
    expect(comNotasLocais([card(1, [])], AGORA + 1000)).toHaveLength(1)
    expect(textos(comNotasLocais([card(2, [])], AGORA + 2000)[0])).toEqual(['Nota do card do outro funil.'])
    expect(textos(comNotasLocais([card(2, [])], AGORA + VALIDADE_DA_NOTA_LOCAL + 1)[0])).toEqual([])
  })

  it('a edição vale enquanto o espelho tem o texto de antes, e sai quando ele muda', () => {
    guardarEdicaoLocal(1, 10, 'texto velho', 'texto novo', AGORA)
    expect(textos(comNotasLocais([card(1, [nota(10, 'texto velho')])], AGORA)[0])).toEqual(['texto novo'])
    const sincronizado = comNotasLocais([card(1, [nota(10, 'texto novo\n\n— editado por Ana')])], AGORA + 1000)
    expect(textos(sincronizado[0])).toEqual(['texto novo\n\n— editado por Ana'])
  })

  it('a segunda edição antes da sincronização continua contra o texto do espelho', () => {
    guardarEdicaoLocal(1, 10, 'original', 'primeira', AGORA)
    guardarEdicaoLocal(1, 10, 'primeira', 'segunda', AGORA + 10)
    expect(textos(comNotasLocais([card(1, [nota(10, 'original')])], AGORA + 20)[0])).toEqual(['segunda'])
  })

  it('editar a nota que ainda só existe aqui muda a cópia dela', () => {
    guardarNotaLocal(1, nota(77, 'com erro'), { agora: AGORA })
    guardarEdicaoLocal(1, 77, 'com erro', 'corrigida', AGORA + 10)
    expect(textos(comNotasLocais([card(1, [])], AGORA + 20)[0])).toEqual(['corrigida'])
  })
})

describe('a tela guarda a nota, a edição e a justificativa até o espelho', () => {
  it('useKommoLeads devolve a leitura já com as notas locais', () => {
    expect(trecho(KOMMO, 'export function useKommoLeads', '\n}\n')).toContain('return comNotasLocais(todos)')
  })

  it('o Anotar, a edição e a justificativa registram o que gravaram', () => {
    expect(trecho(TELA, 'async function anotarNoCard', "toast.success('Anotação enviada")).toContain(
      'for (const n of novas) guardarNotaLocal(lead.kommo_lead_id, n)',
    )
    expect(trecho(TELA, 'async function editarNotaDoCard', "toast.success('Nota editada")).toContain(
      'guardarEdicaoLocal(lead.kommo_lead_id, nota.id, nota.texto, r?.texto ?? texto)',
    )
    expect(trecho(TELA, 'function justificativaEnviada', 'const [notasDoEnvio')).toContain(
      'guardarNotaLocal(lead.kommo_lead_id, nova, { idsNoKommo: ids })',
    )
  })

  it('o que o servidor grava no espelho (etiqueta, cotação, pasta) passa pela escrita que relê se houver releitura no ar', () => {
    const helper = trecho(TELA, 'function gravarNoCacheDosCards', '\n  }\n')
    expect(helper).toContain("qc.isFetching({ queryKey: ['kommo_leads'] }) > 0")
    expect(helper).toContain("void qc.invalidateQueries({ queryKey: ['kommo_leads'] })")
    // Só as três escritas de NOTA continuam direto no cache (quem as segura é o registro).
    expect(TELA.match(/qc\.setQueriesData<KommoLead\[\]>\(\{ queryKey: \['kommo_leads'\] \}/g)).toHaveLength(4)
    expect(TELA.match(/gravarNoCacheDosCards\(\(antes\) =>/g)).toHaveLength(5)
  })
})

describe('o anexo com uuid preparado no passar do mouse não deixa promessa rejeitada sem dono', () => {
  it('o caminho pelo uuid ganha um catch e devolve a mesma promessa ao clique', () => {
    const preparar = trecho(TELA, 'function prepararAnexo', 'const chave = `${lead.kommo_lead_id}:${nomeDoAnexo(anexo)}`')
    expect(preparar).toContain('pedido.catch(() => undefined)')
    expect(preparar).toContain('return pedido')
    expect(preparar).not.toMatch(/if \(anexo\.arquivo_uuid\) return enderecoDoAnexo/)
  })
})

describe('Remessa aos fundos: o arquivo que falha depois da anotação não diz que a anotação não subiu', () => {
  const remessa = TRILHAS_PRECATORIO.flatMap((t) => t.abas).find((a) => a.envioAosFundos)!.envioAosFundos!
  const pjus = remessa.fundos.find((f) => f.fundo === 'PJus')!
  const btg = remessa.fundos.find((f) => f.fundo === 'BTG')!
  const ENVIADO_PJUS: AtoDoEnvio = pjus.atos.find((a) => a.etiqueta === 'Enviado PJus')!
  const COTADO_BTG: AtoDoEnvio = btg.atos.find((a) => a.etiqueta === 'Cotado BTG')!
  const LIMITADA: Cotacao = { propostaCentavos: 85_000_000, comissao: { modalidade: 'limitada', centavos: 4_000_000 } }
  const passos = (erro: Error): PassosDoEnvio & { chamadas: string[] } => {
    const chamadas: string[] = []
    return {
      chamadas,
      anotar: async () => {
        chamadas.push('anotar')
        throw erro
      },
      etiquetar: async () => {
        chamadas.push('etiquetar')
        return { tags: [], cotacaoGravada: true }
      },
      mover: async () => {
        chamadas.push('mover')
      },
    }
  }
  const base = { destino: 'Em precificação', todosFeitos: () => false, anotacaoFeita: false }

  it('o texto no card e um print de depois falhando: diz o que entrou e o que não, e nada mais sai', async () => {
    const p = passos(new ArquivoDoEnvioNaoSubiu('o arquivo "print-2.png" não subiu (HTTP 500).'))
    await expect(
      registrarEnvioAoFundo({ ...base, fundo: 'PJus', ato: ENVIADO_PJUS, cotacao: null, passos: p }),
    ).rejects.toThrow(
      'A anotação está no card, mas o arquivo "print-2.png" não subiu (HTTP 500). A etiqueta não entrou e o card não se moveu. Confirme de novo — o que já subiu não se repete.',
    )
    expect(p.chamadas).toEqual(['anotar'])
  })

  it('com a cotação, diz também que ela não foi gravada', async () => {
    const p = passos(new ArquivoDoEnvioNaoSubiu('o arquivo "x.png" não subiu (rede).'))
    await expect(
      registrarEnvioAoFundo({ ...base, fundo: 'BTG', ato: COTADO_BTG, cotacao: LIMITADA, passos: p }),
    ).rejects.toThrow(/^A anotação está no card, mas .*A cotação não foi gravada, a etiqueta não entrou e o card não se moveu\./)
  })

  it('a falha do próprio texto continua dizendo que a anotação não subiu', async () => {
    const p = passos(new Error('HTTP 502'))
    await expect(
      registrarEnvioAoFundo({ ...base, fundo: 'PJus', ato: ENVIADO_PJUS, cotacao: null, passos: p }),
    ).rejects.toThrow(/^A anotação não subiu para o Kommo: HTTP 502/)
  })

  it('a tela lança o tipo próprio só depois do texto, e confere os 100 MB antes de tudo', () => {
    const anotar = trecho(TELA, 'anotar: async () => {', '// 2. A ETIQUETA DO FUNDO')
    expect(anotar).toContain('throw new ArquivoDoEnvioNaoSubiu(`o arquivo "${a.name}" não subiu')
    expect(anotar).toContain("throw feitas.has(`${chave}:texto`) ? new ArquivoDoEnvioNaoSubiu(motivo) : new Error(motivo)")
    // O tamanho de cada arquivo é conferido antes da primeira chamada.
    expect(anotar.indexOf('a.size > LIMITE_DO_ANEXO')).toBeLessThan(anotar.indexOf('arquivoComTextoNoCard('))
    expect(anotar).not.toContain('100 * 1024 * 1024')
  })
})
