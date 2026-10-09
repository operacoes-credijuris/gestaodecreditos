/**
 * AUDITORIA DE BUGS DAS EDGE FUNCTIONS (09/10/2026) — as correções que vivem
 * dentro do `index.ts` de cada função (Deno, `npm:`, rede), conferidas pelo
 * código. É o recurso de quando não há lógica pura a extrair; a lógica pura de
 * cada uma está em auditoriaServidorLogica.test.ts. Cada asserção falharia
 * contra o código de antes.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ler = (rel: string) =>
  readFileSync(join(__dirname, '..', '..', '..', 'supabase', 'functions', rel), 'utf8').replace(/\r\n/g, '\n')

describe('Kommo', () => {
  it('kommo-sync: pelo kommoFetch, sem limpar funil cortado, um card por linha, nome decodificado', () => {
    const f = ler('kommo-sync/index.ts')
    expect(f).toContain('const res = await kommoFetch(`${base}${path}`, { headers })')
    expect(f).not.toMatch(/const res = await fetch\(`\$\{base\}\$\{path\}`/)
    expect(f).toContain('if (funisCortados.has(funil)) {')
    expect(f).toContain('const unicos = ultimaPorId(leads)')
    expect(f).toContain('nome: l.name == null ? null : semEntidadesHtml(l.name),')
    // As três leituras do espelho, paginadas; a das órfãs, sem `not in`.
    expect(f.match(/lerTodasAsLinhas</g)?.length).toBeGreaterThanOrEqual(4)
    expect(f).not.toContain(".not('kommo_lead_id', 'in', `(${idsEspelho.join(',')})`)")
  })
  it('buscar-kommo e kommo-anexo: subdomínio da tabela, não fixo no código', () => {
    for (const arq of ['buscar-kommo/index.ts', 'kommo-anexo/index.ts']) {
      const f = ler(arq)
      expect(f, arq).not.toContain('const KOMMO_SUBDOMAIN = "contatocredijuriscom"')
      expect(f, arq).toContain('await contaKommo()')
      expect(f, arq).toContain('kommoFetch(')
    }
    expect(ler('buscar-kommo/index.ts')).toContain('const listaCortada = !!proxima;')
    expect(ler('buscar-kommo/index.ts')).toContain('ORCAMENTO_METADADOS_MS')
  })
  it('segredos: a tabela antes do ambiente, para todas as funções lerem o mesmo token', () => {
    const f = ler('_shared/segredos.ts')
    expect(f).toContain("const token = data?.token || Deno.env.get('KOMMO_TOKEN')")
    expect(f).toContain("return data?.token || Deno.env.get('KOMMO_TOKEN') || null")
  })
  it('mcp-autos: a nota no card pelo postarNotas (429 repetido), não por fetch cru', () => {
    const f = ler('mcp-autos/index.ts')
    expect(f).toContain('await postarNotas(conta, g.lead_id, [texto], { dePessoa: false })')
    expect(f).not.toContain('.kommo.com/api/v4/leads/notes`, {')
  })
  it('kommo-anexo-enviar: partes pelo kommoFetch, com teto por parte e prazo do envio', () => {
    const f = ler('kommo-anexo-enviar/index.ts')
    expect(f).toContain('if (Date.now() - inicio > PRAZO_DO_ENVIO_MS) {')
    expect(f).toContain('signal: AbortSignal.timeout(TEMPO_PARTE_MS),')
    expect(f).toContain('const s = await kommoFetch(`${drive}/v1.0/sessions`, {')
  })
})

describe('Escavador e autos', () => {
  it('rotina: sem a contagem da cota, nenhum pedido pago', () => {
    const f = ler('escavador-autos-rotina/index.ts')
    expect(f).toContain('if (erroCota || count == null) {')
    expect(f).toContain('if (resta() < FOLGA_PARA_PEDIR_MS) {')
    expect(f).toContain('await pedir(svc, chave, kommo, soEste, avisos, novas, resta)')
  })
  it('rotina: falha do Kommo ao listar anexos sobe (a leitura é refeita), não vira "sem anexo"', () => {
    const f = ler('escavador-autos-rotina/index.ts')
    expect(f).toContain('if (!r.ok) throw new Error(`a aba Arquivos do card não veio do Kommo (HTTP ${r.status})`)')
    expect(f).toContain('for (const u of await kommo.arquivosDoCard(Number(lead.kommo_lead_id))) uuids.add(u)')
    expect(f).not.toContain('.arquivosDoCard(Number(lead.kommo_lead_id)).catch(() => [])')
  })
  it('junção: o download leva o prazo da volta', () => {
    const f = ler('escavador-autos-rotina/juntar.ts')
    expect(f).toContain('const prazoDosDownloads = Date.now() + o.resta()')
    expect(f.match(/baixar\(o\.chave, cnj, d, prazoDosDownloads\)/g)).toHaveLength(2)
    expect(f).toContain('const tempo = tempoDaTentativa(prazoFinal, Date.now(), TEMPO_DOWNLOAD_MS)')
  })
  it('autos-guardar: apaga só as linhas cujas imagens saíram do balde', () => {
    const f = ler('autos-guardar/index.ts')
    expect(f).toContain('.delete().in("codigo", codigosVencidos)')
    expect(f).not.toContain('await db.from("analise_externa_autos").delete().lt("expira_em", agora);')
  })
  it('dd-processos: o custo da consulta da OAB entra no consumo; o parcial é dito', () => {
    const f = ler('dd-processos/index.ts')
    expect(f).toContain('centavos += quem.centavos')
    expect(f).toContain('if (busca.falha) {')
  })
  it('dd-titulares: a chamada à IA não passa do teto da invocação', () => {
    const f = ler('dd-titulares/index.ts')
    expect(f).toContain('signal: sinalAteOTeto(inicio),')
    expect(f).toContain("if (resposta?.stop_reason === 'max_tokens') {")
  })
})

describe('Anthropic', () => {
  it('analise-precatorio: resposta cortada não vira planilha no Drive; chamadas com teto', () => {
    const f = ler('analise-precatorio/index.ts')
    expect(f).toContain("if (resposta.stop_reason === 'max_tokens' || resposta.stop_reason === 'refusal') {")
    expect(f.match(/\{ signal: sinal \}\)/g)).toHaveLength(2)
  })
  it('assistente: pause_turn é retomado, não entregue como resposta final', () => {
    const f = ler('assistente/index.ts')
    expect(f).toContain("if (resposta.stop_reason === 'pause_turn' && rodada < MAX_RODADAS - 1) {")
    expect(f).toContain("const truncada = resposta.stop_reason === 'max_tokens' || resposta.stop_reason === 'pause_turn'")
  })
  it('justificativa-tecnica: o planejamento cabe no orçamento da invocação', () => {
    const f = ler('justificativa-tecnica/index.ts')
    expect(f).not.toContain('{ signal: AbortSignal.timeout(150_000) }')
    expect(f).toContain('{ signal: AbortSignal.timeout(Math.max(10_000, restante(r))) },')
  })
  it('dd-credor e dd-qualificar: falha da IA diz o motivo e não aprova', () => {
    const c = ler('dd-credor/index.ts')
    expect(c).toContain('const txt = seloDaClassificacao(c);')
    expect(c).toContain('conclusaoDoRelatorio(dd.processos || [], !!dd.algum_reprovado)')
    expect(c).not.toContain('return { txt: "APROVADA", cor: rgb(0.15, 0.55, 0.2) }; }')
    const q = ler('dd-qualificar/index.ts')
    expect(q).toContain('signal: sinalAteOTeto(inicio)')
    expect(q).toContain('if (j?.stop_reason === "max_tokens")')
  })
  it('planilhaJuridica: leitura que falha é erro, não "nenhum sujeito"', () => {
    const f = ler('_shared/planilhaJuridica.ts')
    expect(f).toContain('if (eSujeitos) throw new Error(')
    expect(f).toContain('if (eItens) throw new Error(')
    expect(f).toContain('if (eSujeitos || eItens) {')
  })
})

describe('ADVBOX, BullAI, admin', () => {
  it('advbox-movimentacoes: a fila do encadeamento só pelo cron', () => {
    const f = ler('advbox-movimentacoes/index.ts')
    expect(f).toContain("if (!primeira && !autorizadoPorCron) {\n      return jsonResponse({ error: 'Fila interna: apenas o encadeamento por cron.' }, 403)")
  })
  it('advbox-tarefas: criação pelo enviarJson (corpo do Cloudflare com 200 não é sucesso)', () => {
    const f = ler('advbox-tarefas/index.ts')
    expect(f).toContain("data = await enviarJson(ctx, 'POST', '/posts', payload)")
    expect(f).not.toContain('const res = await fetch(`${ctx.base}/posts`, {')
    expect(f).toContain('const dataDia = dataDoAdvbox')
  })
  it('advbox.ts: fetchAll pela paginação nova', () => {
    expect(ler('_shared/advbox.ts')).toContain('return paginarAdvbox(')
  })
  it('bullai-certidoes: o resultado do job só grava no item que ainda é dele; atualização com relógio', () => {
    const f = ler('bullai-certidoes/index.ts')
    expect(f).toContain('if (item && !itemEDoPedido(jobDoItem, String(p.job_id))) continue')
    expect(f).toContain("gravar.eq('bullai_job_id', jobDoItem)")
    expect(f).toContain('registrados.some((p) => pedidoCobreAReserva(p, i))')
    expect(f).toContain('if (semTempo()) {')
    expect(f).toContain('signal: AbortSignal.timeout(TEMPO_DO_DOWNLOAD_MS)')
  })
  it('admin-update-user: as credenciais da conta-mestra só pela própria', () => {
    const f = ler('admin-update-user/index.ts')
    expect(f).toContain('if (!podeTrocarCredenciais(caller?.email, alvo?.user?.email)) {')
  })
})

describe('RPV, contrato, carteira, Drive', () => {
  it('tetosRpv: a falha grava só na linha do município; a pesquisa morta conta como falha', () => {
    const f = ler('_shared/tetosRpv.ts')
    expect(f).toContain(".eq('uf', uf).eq('esfera', esfera).eq('ano', ano).eq('municipio_chave', chaveMun).maybeSingle()")
    expect(f).toContain("}).eq('uf', uf).eq('esfera', esfera).eq('ano', ano).eq('municipio_chave', chaveMun)\n")
    expect(f).not.toContain("if (await reabrir(svc, chave, esfera, ano, mun, 'pesquisando'))")
  })
  it('gerar-contrato: a data é do código, em Brasília, e vem por último', () => {
    const f = ler('gerar-contrato/index.ts')
    expect(f).not.toContain("DATA_EXTENSO: 'data de hoje por extenso")
    expect(f).toContain('      ...apresentacao,\n      // POR ÚLTIMO: nada lido de documento pode sobrescrever a data do contrato.\n      DATA_EXTENSO: dataExtenso(),')
    expect(f).toContain('return dataPorExtenso(hojeEmBrasilia());')
  })
  it('gerar-analise-rpv: aquisição e pagamento no dia de Brasília', () => {
    const f = ler('gerar-analise-rpv/index.ts')
    expect(f).toContain('return diaMesAno(hojeEmBrasilia());')
    expect(f).toContain('return diaMesAno(somarDiasAoDia(hojeEmBrasilia(), Math.round(Math.max(0, meses) * 30)));')
  })
  it('carteira-resumo: andamentos paginados; o erro apaga o hash para a próxima rodada tentar', () => {
    const f = ler('carteira-resumo/index.ts')
    expect(f).toContain('await lerTodasAsLinhas<MovRow>(')
    expect(f).toContain('await lerTodasAsLinhas<TarefaRow>(')
    expect(f).toContain('          fonte_hash: null,\n')
  })
  it('pasta-do-cedente: a pasta do card fica; criação de pasta converge na mais antiga', () => {
    const p = ler('pasta-do-cedente/index.ts')
    expect(p).toContain('await pastaDaAnaliseDoCard(svc, leadId, { originador: body.originador, cedente: body.cedente })')
    expect(p).not.toContain('await garantirPastaDoCedente(')
    expect(ler('_shared/credijuris.ts')).toContain('const fica = pastaQueFica(await pastasDeMesmoNome(token, name, parentId))')
  })
})
