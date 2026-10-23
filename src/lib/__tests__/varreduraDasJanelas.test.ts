import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  type AnexoDaAnotacao,
  type ArquivoNoDrive,
  type PassosDaAnotacao,
  acrescentarAnexos,
  enviarAnotacao,
} from '@/lib/anexosDaAnotacao'

/**
 * A VARREDURA DE 23/10/2026 NAS JANELAS DA ANÁLISE: o arquivo que já subiu e
 * ficou sem nota não sobe de novo, e as janelas não deixam editar nem fechar
 * no meio do que está gravando. Sem Kommo nem navegador.
 */

const arq = (nome: string, em = 1) => new File([new Uint8Array(10)], nome, { type: 'application/pdf', lastModified: em })

const noDrive: ArquivoNoDrive = { file_uuid: 'u-1', version_uuid: null, file_name: 'a.pdf' }

/** A lista com o primeiro arquivo já no card (a nota dele falhou na tentativa anterior). */
function listaComONoDrive(...outros: File[]): AnexoDaAnotacao[] {
  const { lista } = acrescentarAnexos([], [...outros, arq('a.pdf', 9)])
  return lista.map((a) => (a.arquivo.name === 'a.pdf' ? { ...a, noDrive } : a))
}

function passos() {
  const chamadas: string[] = []
  const p: PassosDaAnotacao = {
    anotar: async (t) => {
      chamadas.push(`anotar:${t}`)
    },
    anexar: async (a) => {
      chamadas.push(`anexar:${a.name}`)
      return { aviso: null }
    },
    subir: async (a) => {
      chamadas.push(`subir:${a.name}`)
      return { file_uuid: `u-${a.name}`, version_uuid: null, file_name: a.name }
    },
    anotarComArquivo: async (t, d) => {
      chamadas.push(`anotarComArquivo:${t}:${d.file_uuid}`)
    },
  }
  return { p, chamadas }
}

describe('o arquivo que já está no card (noDrive)', () => {
  it('com texto, a nota vai com ELE, mesmo com outro arquivo à frente na lista', async () => {
    const { p, chamadas } = passos()
    const r = await enviarAnotacao('Segue o RG.', listaComONoDrive(arq('b.pdf')), p, () => {})
    expect(chamadas).toEqual(['anotarComArquivo:Segue o RG.:u-1', 'anexar:b.pdf'])
    expect(r.enviados).toEqual(['a.pdf', 'b.pdf'])
    expect(r.falhas).toEqual([])
  })

  it('sem texto, não sobe de novo: conta como entregue e a linha de "anexado" o nomeia', async () => {
    const { p, chamadas } = passos()
    const r = await enviarAnotacao('', listaComONoDrive(arq('b.pdf')), p, () => {})
    expect(chamadas).not.toContain('anexar:a.pdf')
    expect(chamadas).not.toContain('subir:a.pdf')
    expect(chamadas).toEqual(['anexar:b.pdf', 'anotar:Arquivos anexados: b.pdf e a.pdf.'])
    expect(r.enviados).toEqual(['b.pdf', 'a.pdf'])
  })
})

const ler = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf-8').replace(/\r\n/g, '\n')

describe('as janelas com a gravação no ar', () => {
  it('a cotação trava os campos enquanto grava', () => {
    expect(ler('../../components/JanelaDeCotacao.tsx')).toContain(
      '<CamposDaCotacao edicao={edicao} fundo={fundo} tentou={tentou} desligado={enviando} />',
    )
  })

  it('o desfecho não pergunta "descartar?" quando fechar não faria nada', () => {
    expect(ler('../../components/JanelaDeDesfecho.tsx')).toContain('dirty={sujo && !enviando}')
  })

  it('a justificativa fica só de leitura enquanto envia (o texto e as notas internas)', () => {
    const fonte = ler('../../components/JustificativaTecnica.tsx')
    expect(fonte).toContain('readOnly={enviando}')
    expect(fonte).toContain('travado={enviando}')
    expect(fonte).toContain('readOnly={travado}')
  })

  it('a due diligence não fecha com o "Seguir" no ar', () => {
    const fonte = ler('../../components/DueDiligence.tsx')
    expect(fonte).toContain('onClose={seguindo ? () => undefined : onClose}')
    expect(fonte).toContain("onClick={() => void fechar()} disabled={seguindo}")
  })

  it('reler o cadastro do banco apaga o "Preenchi do processo" do formulário anterior', () => {
    const fonte = ler('../../components/PainelCertidoes.tsx')
    const i = fonte.indexOf('const recarregar = useCallback(')
    const corpo = fonte.slice(i, fonte.indexOf('}, [leadId, cedenteDoCard])', i))
    expect(corpo).toContain('setPreenchido([])')
  })
})
