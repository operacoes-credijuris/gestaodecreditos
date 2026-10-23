/**
 * VARREDURA D (23/10/2026): os defeitos achados no kit de interface, no layout,
 * na sessão e nas telas do Comercial, do Quadro e das Configurações. O que é
 * regra pura é testado pela função; o que é desenho de componente, pelo texto do
 * fonte (o ambiente de teste é node, sem navegador). Cada bloco diz o defeito que
 * prende.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mesesDepois } from '@/lib/format'
import { situacaoDaImagem, type Situacao } from '@/components/ui/VisualizadorDeImagem'

const ler = (arq: string) => readFileSync(join(__dirname, '..', '..', arq), 'utf8')
/** O código sem os comentários (que citam os padrões que o código não pode ter). */
const semComentarios = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

describe('mesesDepois: meses para trás', () => {
  it('um mês antes de janeiro é dezembro do ano anterior (era o mês 0)', () => {
    expect(mesesDepois('2026-01-15', -1)).toBe('2025-12-15')
    expect(mesesDepois('2026-03-31', -1)).toBe('2026-02-28')
    expect(mesesDepois('2026-01-10', -13)).toBe('2024-12-10')
  })
  it('para frente segue igual', () => {
    expect(mesesDepois('2026-01-31', 1)).toBe('2026-02-28')
    expect(mesesDepois('2026-11-05', 3)).toBe('2027-02-05')
    expect(mesesDepois('2026-10-23', 0)).toBe('2026-10-23')
  })
})

describe('visualizador de imagem: a falha de uma imagem com endereço pronto aparece', () => {
  const falhou: Situacao = { fase: 'falhou', erro: 'o arquivo não é uma imagem que o navegador abra.' }
  it('o print colado que o navegador não abre mostra a falha, e não o esqueleto para sempre', () => {
    expect(situacaoDaImagem({ chave: 'a', src: 'blob:x' }, { a: falhou })).toEqual(falhou)
  })
  it('sem falha anotada, o endereço pronto é a imagem', () => {
    expect(situacaoDaImagem({ chave: 'a', src: 'blob:x' }, {})).toEqual({ fase: 'pronta', src: 'blob:x' })
  })
  it('a que é pedida (o link do Kommo) segue o que foi anotado', () => {
    expect(situacaoDaImagem({ chave: 'a' }, {})).toBeUndefined()
    expect(situacaoDaImagem({ chave: 'a' }, { a: { fase: 'carregando' } })).toEqual({ fase: 'carregando' })
    expect(situacaoDaImagem(undefined, { a: falhou })).toBeUndefined()
  })
})

describe('combobox: o Tab não perde o foco, e o leitor de tela ouve a lista', () => {
  const src = ler('components/ui/Combobox.tsx')
  it('as opções ficam fora da ordem do Tab (o blur do campo as desmontava com o foco nelas)', () => {
    expect(src).toMatch(/role="option"[\s\S]{0,700}tabIndex=\{-1\}/)
  })
  it('a lista que rola também fica fora (no Chrome, caixa com overflow recebe o Tab)', () => {
    expect(src).toMatch(/role="listbox"[\s\S]{0,300}tabIndex=\{-1\}/)
  })
  it('lista e campo com os papéis de combobox, nos três componentes', () => {
    expect(src).toMatch(/role="listbox"/)
    expect(src).toMatch(/role: 'combobox'/)
    expect(semComentarios(src).match(/\{\.\.\.atributosDoCampo\(/g)?.length).toBe(3)
    expect(semComentarios(src).match(/id=\{idDaLista\}/g)?.length).toBe(3)
  })
})

describe('kit de interface: travas que valem para toda tela', () => {
  it('a confirmação em andamento não fecha pelo X nem pelo Esc', () => {
    const c = semComentarios(ler('components/ui/ConfirmDialog.tsx'))
    expect(c).toMatch(/const fechar = loading \? \(\) => \{\} : onClose/)
    expect(c).toMatch(/onClose=\{fechar\}/)
    expect(c).not.toMatch(/onClose=\{onClose\}/)
  })
  it('o Button é `button` por padrão (sem type, dentro de <form>, gravaria o formulário)', () => {
    const b = semComentarios(ler('components/ui/Button.tsx'))
    expect(b).toMatch(/type = 'button'/)
    expect(b).toMatch(/type=\{type\}/)
  })
})

describe('busca geral: o destaque nunca vai abaixo de zero', () => {
  it('a seta para baixo com a lista vazia não deixa o destaque em -1', () => {
    expect(semComentarios(ler('components/layout/BuscaGeral.tsx'))).toMatch(
      /setSel\(Math\.max\(0, Math\.min\(resultados\.length - 1, atual \+ 1\)\)\)/,
    )
  })
})

describe('o menu do usuário fecha quando o Tab sai dele', () => {
  it('o blur com destino fora da caixa fecha', () => {
    const t = semComentarios(ler('components/layout/Topbar.tsx'))
    expect(t).toMatch(/onBlur=\{\(e\) => \{[\s\S]{0,200}setMenuOpen\(false\)/)
  })
})

describe('sessão: a abertura não fica presa no "Carregando…"', () => {
  const a = semComentarios(ler('contexts/AuthContext.tsx'))
  it('a leitura da sessão que lança libera a tela', () => {
    expect(a).toMatch(/\.getSession\(\)[\s\S]{0,700}\.catch\([\s\S]{0,160}setLoading\(false\)/)
  })
  it('o INITIAL_SESSION não lê o perfil de novo (o getSession já leu)', () => {
    expect(a).toMatch(/if \(event === 'INITIAL_SESSION'\) return/)
  })
  it('a guarda de conta desativada continua no lugar', () => {
    expect(a).toMatch(/const acessoDesativado = profile\?\.ativo === false/)
  })
})

describe('copiar pela regra da plataforma, com o jeito antigo de reserva', () => {
  it('Carteiras e o Assistente não usam mais o navigator.clipboard direto', () => {
    for (const arq of ['pages/comercial/CarteirasInvestidores.tsx', 'components/Assistente.tsx']) {
      const s = semComentarios(ler(arq))
      expect(s).not.toMatch(/navigator\.clipboard/)
      expect(s).toMatch(/copiarTexto\(/)
    }
  })
})

describe('Dados cadastrais: o fim de uma gravação fecha só a ficha que foi gravada', () => {
  it('compara a janela aberta com a que pediu a gravação', () => {
    const d = semComentarios(ler('pages/comercial/DadosPessoaisBancarios.tsx'))
    expect(d).toMatch(/const idDaJanela = editando\.id/)
    expect(d).toMatch(/setEditando\(\(atual\) => \(atual\?\.id === idDaJanela \? null : atual\)\)/)
  })
})

describe('Configurações › Usuários: a senha curta é barrada antes do servidor', () => {
  it('o "Novo usuário" confere os 6 caracteres que a dica promete', () => {
    const u = semComentarios(ler('pages/configuracoes/SecaoUsuarios.tsx'))
    const criar = u.slice(u.indexOf('async function criar'), u.indexOf('async function criar') + 600)
    expect(criar).toMatch(/form\.password\.length < 6/)
  })
})

describe('Quadro › Performance: a dica do prazo fala do prazo', () => {
  it('"Mais rápida – mais demorada" não usa a dica da rentabilidade', () => {
    const p = ler('pages/inteligencia/Performance.tsx')
    const linha = p.slice(p.indexOf('rotulo="Mais rápida – mais demorada"'), p.indexOf('rotulo="Mais rápida – mais demorada"') + 200)
    expect(linha).toMatch(/explicacao=\{DIZ\.maisRapidaDemorada\}/)
  })
})

describe('Varredura D (UI/UX): o que a revisão visual mudou', () => {
  it('o ⓘ das métricas fica colado na última palavra do rótulo', () => {
    const c = semComentarios(ler('pages/inteligencia/compartilhado.tsx'))
    expect(c).toMatch(/rotulo\.slice\(rotulo\.lastIndexOf\(' '\) \+ 1\)/)
  })
  it('o eixo da evolução cabe "R$ 650 mil" numa linha', () => {
    expect(ler('pages/inteligencia/graficos.tsx')).toMatch(/width=\{76\} tickFormatter=\{brlAbreviado\}/)
  })
  it('o plano da BullAI no menu sai no plural certo, sem "(s)"', () => {
    expect(semComentarios(ler('pages/configuracoes/Configuracoes.tsx'))).toMatch(/contar\(c\.restantes, 'consulta', 'consultas'\)/)
  })
  it('o botão de parâmetros das Carteiras mantém o nome inteiro para o leitor de tela', () => {
    expect(ler('pages/comercial/CarteirasInvestidores.tsx')).toMatch(/aria-label="Parâmetros de atualização"/)
  })
})
