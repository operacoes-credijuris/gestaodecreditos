// Etapa 4 do plano: nenhum erro de carga do Quadro econômico deixa a tela
// parada. Antes, as quatro abas mostravam "Não foi possível carregar os dados"
// sem botão, e o único jeito de tentar outra vez era recarregar a página.
//
// Lido como TEXTO (como o rotas.test.ts): renderizar as telas no Vitest puxaria
// o cliente do Supabase e os gráficos.

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const PASTA = fileURLToPath(new URL('../../pages/inteligencia/', import.meta.url))
const fonte = (caminho: string) =>
  readFileSync(caminho, 'utf-8').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\/.*$/gm, '')

const TELAS = [
  join(PASTA, 'VisaoGeral.tsx'),
  join(PASTA, 'Previsoes.tsx'),
  join(PASTA, 'Performance.tsx'),
  join(PASTA, 'Recortes.tsx'),
  fileURLToPath(new URL('../../pages/comercial/CarteirasInvestidores.tsx', import.meta.url)),
]

/** O trecho de cada `<ErrorState …/>` do fonte. */
const errorStates = (texto: string) =>
  [...texto.matchAll(/<ErrorState\b[\s\S]*?\/>/g)].map((m) => m[0])

describe('Quadro econômico: erro de carga com "Tentar novamente"', () => {
  it('todo ErrorState em pages/inteligencia tem onRetry', () => {
    const arquivos = readdirSync(PASTA).filter((n) => n.endsWith('.tsx'))
    expect(arquivos.length).toBeGreaterThan(4)
    for (const nome of arquivos) {
      for (const tag of errorStates(fonte(join(PASTA, nome)))) {
        expect(tag, nome).toMatch(/onRetry=/)
      }
    }
  })

  it('o ErroPainel passa o tentarDeNovo ao ErrorState, e o usePainel o expõe', () => {
    const comum = fonte(join(PASTA, 'compartilhado.tsx'))
    expect(comum).toMatch(/onRetry=\{tentarDeNovo\}/)
    expect(comum).toMatch(/tentarDeNovo: \(\) => void/)
  })

  it('as quatro abas do painel e as Carteiras tratam o erro com tentativa', () => {
    for (const caminho of TELAS) {
      const texto = fonte(caminho)
      const comErroPainel = /<ErroPainel tentarDeNovo=\{tentarDeNovo\}/.test(texto)
      const comRetry = errorStates(texto).length > 0 && errorStates(texto).every((t) => /onRetry=/.test(t))
      expect(comErroPainel || comRetry, caminho).toBe(true)
    }
  })
})
