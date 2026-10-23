/**
 * O QUE A VARREDURA DE 23/10/2026 DEIXOU PARA A JUNÇÃO: os itens que os
 * revisores apontaram fora da área deles — listas que paravam em 1000 linhas
 * sem avisar, a cópia sem o jeito antigo e as siglas que viravam minúsculas.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sentenceCase } from '@/lib/format'
import { textoDoPlanoBullai } from '@/lib/menuDasConfiguracoes'

const ler = (p: string) => readFileSync(join(__dirname, '..', '..', '..', p), 'utf8')

describe('listas inteiras', () => {
  it('o CRUD genérico lê em páginas, com o id desempatando a ordem', () => {
    const f = ler('src/lib/crud.ts')
    expect(f).toContain('lerTodasAsPaginas<TRow>((de, ate) =>')
    expect(f).toContain(".order('id', { ascending: true })")
  })
  it('os dados cadastrais dos investidores também', () => {
    const f = ler('src/lib/queries.ts')
    expect(f.match(/\.order\('tipo'\)\s*\.order\('nome_chave'\)\s*\.range\(de, ate\)/g)?.length).toBe(2)
  })
})

describe('a cópia', () => {
  it('a petição e o card copiam pelo copiarTexto', () => {
    expect(ler('src/components/PeticaoModal.tsx')).toContain('if (await copiarTexto(passagem)) {')
    const a = ler('src/pages/operacional/AnaliseCredito.tsx')
    expect(a).toContain('copiarTexto(texto)')
    expect(a).not.toContain('navigator.clipboard')
  })
})

describe('sentenceCase', () => {
  it('mantém as siglas', () => {
    expect(sentenceCase('ACOMPANHAR EXPEDIÇÃO DE RPV')).toBe('Acompanhar expedição de RPV')
    expect(sentenceCase('CONFERIR CPF E OAB NO TRF1')).toBe('Conferir CPF e OAB no TRF1')
    expect(sentenceCase('ENTRAR EM CONTATO')).toBe('Entrar em contato')
    expect(sentenceCase('RECURSO')).toBe('Recurso')
  })
})

describe('o plano da BullAI', () => {
  it('no plural certo', () => {
    expect(textoDoPlanoBullai(1)).toBe('1 consulta')
    expect(textoDoPlanoBullai(180)).toBe('180 consultas')
  })
})
