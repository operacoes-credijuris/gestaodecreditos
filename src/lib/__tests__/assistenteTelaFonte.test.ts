// A tela do assistente (revisão de 12/11/2026), no FONTE do componente: o que
// não dá para exercitar sem montar o React (o vitest daqui roda em `node`).
// Cada asserção falharia no Assistente.tsx de antes da correção.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const src = readFileSync(
  fileURLToPath(new URL('../../components/Assistente.tsx', import.meta.url)),
  'utf-8',
)
/** Sem comentários: o que vale é o código. */
const codigo = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('o pedido em curso é da conversa, não do painel (defeito 1)', () => {
  it('carregando e erro saem da pendência da conversa aberta', () => {
    expect(codigo).not.toMatch(/const \[carregando, setCarregando\]/)
    expect(codigo).not.toMatch(/const \[erro, setErro\]/)
    expect(codigo).toMatch(/const carregando = pendenciaAtual\?\.estado === 'enviando'/)
    expect(codigo).toMatch(/const pendenciaAtual = pendencias\[conversaAtualId\]/)
  })

  it('as conversas abertas ficam por id, e reabrir prefere a versão desta visita', () => {
    expect(codigo).toMatch(/const mensagens = conversas\[conversaAtualId\] \?\? SEM_MENSAGENS/)
    expect(codigo).toMatch(/const jaAberta = conversas\[c\.id\]/)
  })

  it('a gravação relê a linha e aplica a mudança, uma por vez por conversa', () => {
    const grava = codigo.slice(codigo.indexOf('function gravarNoBanco'), codigo.indexOf('function novaConversa'))
    expect(grava).toMatch(/\.select\('mensagens'\)/)
    expect(grava).toMatch(/mensagens: mudar\(guardadas\)/)
    expect(grava).toMatch(/filaDeGravacao\.current\.set\(id, proxima\)/)
  })

  it('a pergunta é gravada no envio, antes da resposta', () => {
    const envia = codigo.slice(codigo.indexOf('function enviar('), codigo.indexOf('function tentarDeNovo'))
    expect(envia).toMatch(/void gravarNoBanco\(id, mudar\)/)
  })
})

describe('as Skills no pedido (defeitos 2 e 9)', () => {
  it('o campo `skills` só vai quando a lista chegou', () => {
    expect(codigo).toMatch(/skillsDoPedido\(skillsQuery\.isSuccess, skillsSelecionadas, skillsQuery\.data\)/)
    expect(codigo).toMatch(/if \(skills\) form\.append\('skills'/)
    expect(codigo).toMatch(/\.\.\.\(skills \? \{ skills \} : \{\}\)/)
  })

  it('o botão conta só as Skills que existem', () => {
    expect(codigo).not.toMatch(/skillsSelecionadas\.size \+/)
    expect(codigo).toMatch(/\{totalDeSkills > 0 && ` \(\$\{totalDeSkills\}\)`\}/)
  })
})

describe('o histórico com notas e os anexos na bolha (defeito 3)', () => {
  it('o histórico enviado passa por historicoParaOModelo', () => {
    expect(codigo).toMatch(/const historico = historicoParaOModelo\(anteriores\)/)
    expect(codigo).not.toMatch(/const historico = mensagens\b/)
  })
  it('a pergunta guarda os nomes dos anexos, e a bolha os mostra', () => {
    expect(codigo).toMatch(/anexos: nomes/)
    expect(codigo).toMatch(/m\.anexos\.map\(\(nome, j\)/)
  })
})

describe('o erro: Tentar de novo e o texto de volta (defeito 4)', () => {
  it('há o botão, que reenvia o pedido guardado', () => {
    expect(codigo).toMatch(/onClick=\{tentarDeNovo\}/)
    expect(codigo).toMatch(/void pedirResposta\(id, mensagens\.slice\(0, fim\), pedido\)/)
  })
  it('o texto e os anexos voltam ao campo vazio', () => {
    expect(codigo).toMatch(/setTexto\(\(t\) => \(t\.trim\(\) \? t : limpa\)\)/)
  })
})

describe('a petição resolvida e o aviso de corte (defeitos 5 e 6)', () => {
  it('Cancelar e Confirmar gravam na conversa', () => {
    expect(codigo).toMatch(/onClick=\{\(\) => resolverAcao\(i, 'cancelada'\)\}/)
    expect(codigo).toMatch(/resolverAcao\(indice, 'confirmada'\)/)
    expect(codigo).toMatch(/m\.acaoProposta && !m\.acaoResolvida/)
  })
  it('o aviso de corte não vai mais no texto da resposta', () => {
    expect(codigo).not.toMatch(/\$\{resposta\}\\n\\n---/)
    expect(codigo).toMatch(/\.\.\.\(truncada \? \{ truncada: true \} : \{\}\)/)
    expect(codigo).toMatch(/\{m\.truncada && \(/)
  })
})

describe('a tela no celular e a Base do Kommo lembrada (defeitos 7, 8, 10)', () => {
  it('as listas têm largura máxima, e a de Skills se ancora na linha no celular', () => {
    expect(codigo).toMatch(/max-w-\[calc\(100vw-16px\)\]/)
    expect(codigo).toMatch(/'inset-x-0 sm:inset-x-auto sm:left-0'/)
    expect(codigo).toMatch(/<div className="sm:relative" ref=\{skillsRef\}>/)
  })
  it('a Base do Kommo é lida e gravada nas preferências (com try/catch lá dentro)', () => {
    expect(codigo).toMatch(/lerPreferenciaValida\(PREF_BASE_KOMMO, false/)
    expect(codigo).toMatch(/gravarPreferencia\(PREF_BASE_KOMMO, comBaseDoKommo\)/)
  })
  it('o Enter passa por enterEnvia, com a composição e o toque', () => {
    expect(codigo).toMatch(/isComposing: e\.nativeEvent\.isComposing/)
    expect(codigo).toMatch(/toque: telaDeToque\(\)/)
  })
})

describe('o anexo sem leitor e a acessibilidade (defeitos 11 e 13)', () => {
  it('avisa antes de enviar e não envia', () => {
    expect(codigo).toMatch(/if \(anexosSemLeitor\.length > 0\) return/)
    expect(codigo).toMatch(/Marque uma Skill para ler este tipo de arquivo/)
  })
  it('as listas recebem o foco e respondem às setas e ao Escape', () => {
    expect(codigo).toMatch(/useFocoNaLista\(modeloAberto, listaDeModelos\)/)
    expect(codigo).toMatch(/useFocoNaLista\(skillsAberto, listaDeSkills\)/)
    expect(codigo).toMatch(/onKeyDown=\{\(e\) => teclasDaLista\(e, fecharModelos\)\}/)
    expect(codigo).toMatch(/onKeyDown=\{\(e\) => teclasDaLista\(e, fecharSkills\)\}/)
  })
  it('no celular o painel é modal e prende o Tab', () => {
    expect(codigo).toMatch(/aria-modal=\{telaCheia \? true : undefined\}/)
    expect(codigo).toMatch(/onKeyDown=\{prenderTab\}/)
  })
})
