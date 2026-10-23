/**
 * A COTAÇÃO FORA DA PRECIFICAÇÃO (23/10/2026, pedido do dono): na Produção de
 * proposta e na Negociação chega proposta nova depois que o card saiu da
 * precificação. O "+" ao lado das propostas abre a janela da cotação, que grava
 * só o campo do fundo — as etiquetas ficam na precificação.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const raiz = join(__dirname, '..', '..', '..')
const ler = (p: string) => readFileSync(join(raiz, p), 'utf8')
const f = ler('supabase/functions/kommo-etiquetar/index.ts')
const pagina = ler('src/pages/operacional/AnaliseCredito.tsx')

/** O corpo de `gravarSoACotacao`, até a próxima função de topo. */
const soACotacao = f.slice(f.indexOf('async function gravarSoACotacao('), f.indexOf('Deno.serve('))

describe('kommo-etiquetar — cotar', () => {
  it('aceita a ação, pede a cotação e só a etiqueta "Cotado" diz o fundo', () => {
    expect(f).toContain("acao !== 'adicionar' && acao !== 'remover' && acao !== 'cotar'")
    expect(f).toContain("if (acao === 'cotar' && (body.cotacao === undefined || body.cotacao === null)) {")
    expect(f).toContain("if ((acao !== 'adicionar' && acao !== 'cotar') || daLista?.ato !== 'Cotado') {")
  })
  it('vale também no RPV, e só para a cotação', () => {
    expect(f).toContain("(acao === 'cotar' && Number(espelho.pipeline_id) === FUNIL_RPV)")
  })
  it('o PATCH leva só o campo: nenhuma etiqueta é posta nem tirada', () => {
    expect(soACotacao).toContain('body: JSON.stringify({ custom_fields_values: [{ field_id: campo.id, values: [{ value: textoDoCampo }] }] }),')
    expect(soACotacao).not.toMatch(/tags_to_add|tags_to_delete|tags_em/)
  })
  it('anota quem fez, dizendo se registrou ou alterou', () => {
    expect(soACotacao).toContain("const texto = `Cotação ${fundo} ${tinha ? 'alterada' : 'registrada'} por ${autor}: ${textoDoCampo}${sobre}.`")
  })
  it('"cotar" nunca segue para o caminho das etiquetas', () => {
    expect(f).toContain("if (acao === 'cotar') return jsonResponse({ error: 'Não consegui gravar a cotação.', gravado: false }, 500)")
  })
})

describe('a tela', () => {
  it('o "+" aparece onde as propostas aparecem e abre a janela sem etiqueta', () => {
    expect(pagina).toContain('onCotarProposta={mostraAsPropostas(abaAtual?.statusIds) ? cotarSemEtiqueta : undefined}')
    expect(pagina).toContain("setCotando({ lead, etiqueta: e.nome, fundo, semEtiqueta: true })")
    expect(pagina).toContain("}>('kommo-etiquetar', { leadId: id, etiqueta, acao: 'cotar', cotacao })")
  })
  it('sem proposta nenhuma, o "+" ainda aparece (é por ele que a primeira entra)', () => {
    expect(pagina).toContain('return onCotar ? <BotaoCotarProposta lead={lead} onCotar={onCotar} ocupado={ocupado} vazio /> : null')
  })
  it('a janela diz que nenhuma etiqueta muda', () => {
    const j = ler('src/components/JanelaDeCotacao.tsx')
    expect(j).toContain("{semEtiqueta ? ', e nenhuma etiqueta muda.' : ', e a etiqueta entra junto.'}")
  })
})
