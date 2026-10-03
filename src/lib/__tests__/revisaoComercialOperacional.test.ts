// Revisão pós-atualização (03/10/2026) do Comercial e do Operacional (execução).
//
// Duas partes:
//   • a regra pura nova (os caminhos dos documentos da Geração de contratos);
//   • os defeitos de COMPONENTE (corrida de resposta assíncrona, gravação por
//     tecla, cache que não invalidava), conferidos no fonte como TEXTO — como o
//     rotas.test.ts e o quadroTentarDeNovo.test.ts: renderizar as telas no Vitest
//     puxaria o cliente do Supabase. Cada um destes falhava antes da correção.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { caminhosDosEnvios, nomeArquivoSeguro } from '../geracaoContratos'

const arquivo = (nome: string) => ({ name: nome })

describe('caminhosDosEnvios — os documentos da Geração de contratos no bucket', () => {
  it('nome que não repete sai exatamente como antes', () => {
    const r = caminhosDosEnvios('u1', 'job1', {
      cedente: [arquivo('RG.pdf'), arquivo('Comprovante de residência.pdf')],
      escritorio: [arquivo('Contrato social.pdf')],
    })
    expect(r.map((e) => e.caminho)).toEqual([
      'u1/job1/cedente/RG.pdf',
      'u1/job1/cedente/Comprovante_de_residencia.pdf',
      'u1/job1/escritorio/Contrato_social.pdf',
    ])
    // O índice aponta o arquivo da lista da tela, na ordem dela.
    expect(r.map((e) => [e.papel, e.indice])).toEqual([
      ['cedente', 0],
      ['cedente', 1],
      ['escritorio', 0],
    ])
  })

  // O DEFEITO: o envio é com upsert, e o mesmo caminho fazia o segundo arquivo
  // apagar o primeiro — a função lia um documento a menos do que a tela listava.
  it('dois arquivos com o mesmo nome no mesmo papel não caem no mesmo caminho', () => {
    const r = caminhosDosEnvios('u1', 'job1', {
      cedente: [arquivo('RG.pdf'), arquivo('RG.pdf'), arquivo('RG.pdf')],
      escritorio: [],
    })
    const caminhos = r.map((e) => e.caminho)
    expect(new Set(caminhos).size).toBe(3)
    expect(caminhos).toEqual([
      'u1/job1/cedente/RG.pdf',
      'u1/job1/cedente/RG_(2).pdf',
      'u1/job1/cedente/RG_(3).pdf',
    ])
  })

  it('nomes que a sanitização torna iguais também ficam distintos', () => {
    expect(nomeArquivoSeguro('Contrato á.pdf')).toBe(nomeArquivoSeguro('Contrato a.pdf'))
    const r = caminhosDosEnvios('u', 'j', {
      cedente: [arquivo('Contrato á.pdf'), arquivo('Contrato a.pdf'), arquivo('rg.PDF'), arquivo('RG.pdf')],
      escritorio: [],
    })
    expect(new Set(r.map((e) => e.caminho.toLowerCase())).size).toBe(4)
  })

  it('o mesmo nome em papéis diferentes não conflita (são pastas diferentes)', () => {
    const r = caminhosDosEnvios('u', 'j', {
      cedente: [arquivo('RG.pdf')],
      escritorio: [arquivo('RG.pdf')],
    })
    expect(r.map((e) => e.caminho)).toEqual(['u/j/cedente/RG.pdf', 'u/j/escritorio/RG.pdf'])
  })

  it('arquivo sem extensão ganha o sufixo no fim', () => {
    const r = caminhosDosEnvios('u', 'j', { cedente: [arquivo('LEIAME'), arquivo('LEIAME')], escritorio: [] })
    expect(r.map((e) => e.caminho)).toEqual(['u/j/cedente/LEIAME', 'u/j/cedente/LEIAME_(2)'])
  })
})

// ─── Defeitos de componente, conferidos no fonte ────────────────────────────
const fonte = (relativo: string) =>
  readFileSync(fileURLToPath(new URL(`../../${relativo}`, import.meta.url)), 'utf-8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')

/** O corpo de uma função `async function nome(...) { ... }` do fonte (até a próxima no mesmo nível). */
function corpo(texto: string, nome: string): string {
  const i = texto.indexOf(`function ${nome}(`)
  expect(i, `função ${nome}`).toBeGreaterThan(-1)
  const resto = texto.slice(i + 1)
  const fim = resto.search(/\n {2}(?:async )?function |\n {2}const [a-zA-Z]+ = use|\n {2}return \(/)
  return fim > 0 ? resto.slice(0, fim) : resto
}

describe('Dados cadastrais: a resposta atrasada do CEP/CNPJ não cai na ficha de outra pessoa', () => {
  const t = fonte('pages/comercial/DadosPessoaisBancarios.tsx')

  // Antes: `janelaNaChamada !== editando?.id` — os dois lados vinham da MESMA
  // closure, e a comparação dava sempre igual.
  it('a janela é conferida por uma ref, não pelo `editando` do render', () => {
    for (const nome of ['preencherPorCep', 'preencherPorCnpj']) {
      const c = corpo(t, nome)
      expect(c, nome).not.toMatch(/editando\?\.id/)
      expect(c, nome).toMatch(/janelaAberta\.current/)
    }
  })

  it('abrir outra ficha invalida as buscas em voo', () => {
    const c = corpo(t, 'abrirJanela')
    expect(c).toMatch(/reqCepRef\.current\+\+/)
    expect(c).toMatch(/reqCnpjRef\.current\+\+/)
    expect(c).toMatch(/janelaAberta\.current = id/)
  })

  it('CEP apagado ou incompleto invalida a busca em voo', () => {
    const c = corpo(t, 'preencherPorCep')
    const incompleto = c.slice(0, c.indexOf('const meuId'))
    expect(incompleto).toMatch(/reqCepRef\.current\+\+/)
  })
})

describe('Geração de contratos: cada tentativa num job novo', () => {
  const t = fonte('pages/comercial/GeracaoContratos.tsx')
  // Antes o job vivia no estado e só mudava depois de um SUCESSO: a tentativa
  // seguinte a um erro reaproveitava a pasta do bucket, com o documento removido
  // da lista ainda lá — e a função o lia e arquivava no Drive.
  it('o job nasce dentro do envio, não no estado da tela', () => {
    expect(t).not.toMatch(/setJobId/)
    expect(corpo(t, 'handleSubmit')).toMatch(/const jobId = crypto\.randomUUID\(\)/)
    expect(corpo(t, 'handleSubmit')).toMatch(/caminhosDosEnvios\(/)
  })
})

describe('Novo crédito pela pasta do Drive: uma pasta não se mistura com a outra', () => {
  const drive = fonte('components/NovoCreditoDoDrive.tsx')
  const modal = fonte('components/CreditoFormModal.tsx')

  it('só a última pasta escolhida escreve no formulário', () => {
    const c = corpo(drive, 'usarPasta')
    expect(c).toMatch(/\+\+escolhaAtual\.current/)
    // A resposta da IA é conferida antes de preencher.
    const antesDoPreenchimento = c.slice(0, c.indexOf('{ avisar: true }'))
    expect(antesDoPreenchimento).toMatch(/if \(!valendo\(\)\) return\s*\n\s*onPreencher\(camposParaProcesso/)
  })

  it('a primeira onda de outra pasta recomeça do formulário vazio', () => {
    expect(corpo(drive, 'usarPasta')).toMatch(/onPreencher\(contexto, \{ novaPasta: true \}\)/)
    expect(corpo(modal, 'preencherDoDrive')).toMatch(/opts\?\.novaPasta \? inicial : atual/)
  })
})

describe('Gerar petição', () => {
  const t = fonte('components/PeticaoModal.tsx')

  // Antes: trocar o modelo deixava o texto do anterior no estado enquanto o novo
  // baixava, e o Salvar gravava o texto antigo com o nome do novo.
  it('trocar de modelo apaga o texto do anterior antes de baixar o novo', () => {
    const efeito = t.slice(t.indexOf('baixarModelo(escolhido.arquivo)') - 400, t.indexOf('baixarModelo(escolhido.arquivo)'))
    expect(efeito).toMatch(/setMd\(null\)/)
  })

  it('a redação da IA que termina com a janela fechada não cai na próxima tarefa', () => {
    const c = corpo(t, 'redigir')
    expect(c).toMatch(/const minha = abertura\.current/)
    expect(c.slice(0, c.indexOf('setRedacao(r)'))).toMatch(/if \(minha !== abertura\.current\) return/)
    // Fechar a janela invalida o que está no ar.
    expect(t).toMatch(/if \(open\) return\s*\n\s*abertura\.current\+\+/)
  })
})

describe('Fase processual: a data da situação grava uma vez, ao sair do campo', () => {
  const t = fonte('pages/operacional/execucao/FaseProcessual.tsx')
  // Antes cada `change` do campo de data (um por pedaço digitado) chamava a
  // função no servidor, em paralelo, e a última a chegar ganhava.
  it('nenhum campo de data chama a mutação no onChange', () => {
    const campos = [...t.matchAll(/<input\s+type="date"[\s\S]*?\/>/g)].map((m) => m[0])
    expect(campos.length).toBeGreaterThan(0)
    for (const c of campos) {
      expect(c).not.toMatch(/onChange=\{[^}]*mutate/)
      expect(c).toMatch(/onBlur=/)
    }
  })
})

describe('Requerimentos: excluir atualiza os apensos (a exclusão cascateia)', () => {
  it('confirmDelete invalida a lista de apensos, como em Créditos', () => {
    const t = fonte('pages/operacional/execucao/Requerimentos.tsx')
    expect(corpo(t, 'confirmDelete')).toMatch(/invalidateQueries\(\{ queryKey: \['apensos'\] \}\)/)
  })
})
