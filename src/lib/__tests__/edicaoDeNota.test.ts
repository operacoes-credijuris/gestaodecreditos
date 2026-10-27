/** EDITAR A NOTA PELO HISTÓRICO DO CARD (20/10/2026, pedido do dono). */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { corpoEditavel, notaEditavel, textoEditado } from '../../../supabase/functions/_shared/edicaoDeNota.ts'

const QUANDO = new Date('2026-10-20T18:40:00Z') // 15:40 em Brasília

describe('notaEditavel', () => {
  it('só a nota de texto de gente', () => {
    expect(notaEditavel({ id: 10, tipo: 'common', automatica: false })).toBe(true)
    expect(notaEditavel({ id: 10, tipo: undefined, automatica: undefined })).toBe(true)
    expect(notaEditavel({ id: 10, tipo: 'common', automatica: true })).toBe(false)
    expect(notaEditavel({ id: 10, tipo: 'service_message' })).toBe(false)
    expect(notaEditavel({ id: 10, tipo: 'attachment', arquivo_uuid: 'x' })).toBe(false)
    // A nota local ainda sem id do Kommo (acabou de ser escrita).
    expect(notaEditavel({ id: -1700000000000, tipo: 'common' })).toBe(false)
  })
})

describe('corpoEditavel e textoEditado', () => {
  const daPlataforma = 'Cedente pediu prazo até sexta.\n\n— registrado por Maria pela plataforma Credijuris'

  it('o campo abre sem o rodapé', () => {
    expect(corpoEditavel(daPlataforma)).toBe('Cedente pediu prazo até sexta.')
  })

  it('mantém quem registrou e acrescenta quem editou, uma linha só', () => {
    const t = textoEditado(daPlataforma, 'Cedente pediu prazo até segunda.', 'João', QUANDO)
    expect(t).toBe(
      'Cedente pediu prazo até segunda.\n\n— registrado por Maria pela plataforma Credijuris · editado por João em 20/10/2026 15:40',
    )
    // Editada de novo: a edição anterior sai, fica a nova.
    const t2 = textoEditado(t, 'Prazo: terça.', 'Ana', QUANDO)
    expect(t2).toBe('Prazo: terça.\n\n— registrado por Maria pela plataforma Credijuris · editado por Ana em 20/10/2026 15:40')
    expect(corpoEditavel(t2)).toBe('Prazo: terça.')
  })

  it('nota escrita direto no Kommo ganha o rodapé de edição', () => {
    expect(textoEditado('Ligar amanhã', 'Ligar amanhã às 10h', 'João', QUANDO)).toBe(
      'Ligar amanhã às 10h\n\n— editado por João em 20/10/2026 15:40 pela plataforma Credijuris',
    )
  })

  it('a função confere a nota no Kommo antes de editar, e a tela tem o lápis no histórico', () => {
    const f = readFileSync(join(__dirname, '..', '..', '..', 'supabase/functions/kommo-editar-nota/index.ts'), 'utf8')
    expect(f).toContain("if (!nota || Number(nota.entity_id) !== leadId)")
    expect(f).toContain("if (nota.note_type !== 'common')")
    expect(f).toContain('if (ehNotaNossa(original, criadaEm))')
    // O Kommo exige o card no PATCH da nota (400 FieldMissing: entity_id, 23/10/2026).
    expect(f).toContain("JSON.stringify({ entity_id: leadId, note_type: 'common', params: { text: texto } })")
    const t = readFileSync(join(__dirname, '..', '..', 'pages/operacional/AnaliseCredito.tsx'), 'utf8')
    expect(t).toContain('onEditarNota={editarNotaDoCard}')
  })
})

describe('o lápis na nota recém-enviada (27/10/2026)', () => {
  const raiz = join(__dirname, '..', '..', '..')
  it('a kommo-anotar devolve o id da nota de texto, também com o arquivo em nota à parte', () => {
    const f = readFileSync(join(raiz, 'supabase/functions/kommo-anotar/index.ts'), 'utf8')
    expect(f).toContain('const notaDeTexto = anexo && !junto ? r.ids[r.ids.length - 1] ?? null : r.ids[0] ?? null;')
  })
  it('a tela põe o id do Kommo na nota, e não o provisório', () => {
    const t = readFileSync(join(raiz, 'src/pages/operacional/AnaliseCredito.tsx'), 'utf8')
    expect(t).toContain("{ ...base, id: idDe(ids.texto, provisorio), texto, tipo: 'common' },")
    expect(t).toContain('id: ids.length === 1 && ids[0] > 0 ? ids[0] : -Date.now(),')
    const j = readFileSync(join(raiz, 'src/components/JustificativaTecnica.tsx'), 'utf8')
    expect(j).toContain('onEnviada?.(lead, texto, r?.nota_kommo_ids ?? [])')
  })
})
