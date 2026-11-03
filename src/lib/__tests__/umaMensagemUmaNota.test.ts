/**
 * UMA MENSAGEM, UMA NOTA (03/11/2026, pedido do dono): a mensagem com o anexo
 * gera uma anotação só no Kommo. A Remessa aos fundos e o "Anexar e mover"
 * gravavam o texto e o arquivo em notas separadas; e a conferência do "Anotar"
 * dizia "não ficou" por um travessão ou um acento, e repetia o texto ao lado.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { textoFicou } from '../../../supabase/functions/_shared/notaComArquivo.ts'

const pagina = readFileSync(join(__dirname, '..', '..', 'pages/operacional/AnaliseCredito.tsx'), 'utf8')

describe('a conferência do texto na nota do arquivo', () => {
  const enviado = 'Enviado à PJus — segue o “ofício” atualizado.\n\n— registrado por Ana pela plataforma Credijuris'
  it('aceita o que o Kommo devolve com entidades, aspas curvas, acentos e <br>', () => {
    expect(textoFicou(enviado, 'Enviado &agrave; PJus &mdash; segue o &ldquo;of&iacute;cio&rdquo; atualizado.<br><br>— registrado por Ana')).toBe(true)
    expect(textoFicou(enviado, 'Enviado a PJus - segue o "oficio" atualizado. — registrado por Ana pela plataforma')).toBe(true)
  })
  it('e ainda recusa o nome do arquivo no lugar do texto', () => {
    expect(textoFicou(enviado, 'oficio.pdf')).toBe(false)
    expect(textoFicou(enviado, '')).toBe(false)
  })
})

describe('a Remessa aos fundos e o "Anexar e mover"', () => {
  it('passam pelo mesmo caminho do "Anotar": arquivo sem nota, e a nota dele com o texto', () => {
    expect(pagina).toContain("{ 'x-lead-id': String(leadId), 'x-nome': encodeURIComponent(arquivo.name), 'x-texto': '', 'x-sem-nota': '1' },")
    expect(pagina).toContain("await invokeFunction('kommo-anotar', { lead_id: leadId, texto, origem: 'pessoa', autor: analistaNome, anexo: noDrive })")
    expect(pagina).toContain('await arquivoComTextoNoCard(id, primeiro, nota, parteDe(primeiro), (p) =>')
    expect(pagina).not.toContain("'x-texto': encodeURIComponent(cfg.nota)")
  })
  it('o arquivo que subiu e ficou sem nota não sobe de novo na próxima tentativa', () => {
    expect(pagina).toContain('let noDrive = arquivosNoCard.current.get(parte) ?? null')
  })
})
