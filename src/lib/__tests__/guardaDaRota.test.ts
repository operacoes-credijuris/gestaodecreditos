/**
 * OS GUARDAS DE ROTA (components/ProtectedRoute.tsx), pela função pura.
 *
 * O DEFEITO (03/10/2026): logo depois do Entrar, a sessão chega antes do perfil.
 * O `AdminRoute` decidia nesse intervalo: quem é administrador PELO PERFIL (e não
 * pelo e-mail da casa), voltando a um link de Configurações com a sessão vencida,
 * entrava e era mandado ao início. Agora a guarda espera o perfil.
 */
import { describe, it, expect } from 'vitest'
import { decidirGuarda, destinoDepoisDoEntrar, type EstadoDaSessao } from '@/lib/guardaDaRota'

const PRONTO: EstadoDaSessao = {
  carregando: false,
  temSessao: true,
  perfilCarregando: false,
  acessoDesativado: false,
  isAdmin: false,
}

describe('decidirGuarda', () => {
  it('lendo a sessão guardada: espera', () => {
    expect(decidirGuarda({ ...PRONTO, carregando: true }, false)).toBe('carregando')
    expect(decidirGuarda({ ...PRONTO, carregando: true, temSessao: false }, true)).toBe('carregando')
  })

  it('sem sessão: vai ao login', () => {
    expect(decidirGuarda({ ...PRONTO, temSessao: false }, false)).toBe('login')
    expect(decidirGuarda({ ...PRONTO, temSessao: false }, true)).toBe('login')
  })

  it('O DEFEITO: com sessão e o perfil ainda chegando, Configurações ESPERA em vez de mandar ao início', () => {
    // O perfil não chegou: isAdmin ainda é false para o administrador pelo perfil.
    const recemEntrou = { ...PRONTO, perfilCarregando: true, isAdmin: false }
    expect(decidirGuarda(recemEntrou, true)).toBe('carregando')
    // Chegou o perfil de administrador: libera.
    expect(decidirGuarda({ ...PRONTO, isAdmin: true }, true)).toBe('liberar')
  })

  it('a conta desativada não vê a plataforma nem por um instante depois do Entrar', () => {
    expect(decidirGuarda({ ...PRONTO, perfilCarregando: true }, false)).toBe('carregando')
    expect(decidirGuarda({ ...PRONTO, acessoDesativado: true }, false)).toBe('desativado')
  })

  it('desativado vem antes da falta de permissão', () => {
    expect(decidirGuarda({ ...PRONTO, acessoDesativado: true }, true)).toBe('desativado')
  })

  it('quem não é administrador volta ao início só em Configurações', () => {
    expect(decidirGuarda(PRONTO, true)).toBe('inicio')
    expect(decidirGuarda(PRONTO, false)).toBe('liberar')
  })
})

describe('destinoDepoisDoEntrar', () => {
  const INICIO = '/operacional/analise'
  const de = (from: unknown) => ({ from })

  it('O DEFEITO: o link de card (com ?card=) chega ao card depois do Entrar', () => {
    expect(destinoDepoisDoEntrar(de({ pathname: '/operacional/analise', search: '?card=123' }), INICIO)).toBe(
      '/operacional/analise?card=123',
    )
  })

  it('o caminho pedido, sem busca', () => {
    expect(destinoDepoisDoEntrar(de({ pathname: '/configuracoes', search: '' }), INICIO)).toBe('/configuracoes')
  })

  it('sem pedido, pedido estranho ou o próprio login: o início', () => {
    expect(destinoDepoisDoEntrar(null, INICIO)).toBe(INICIO)
    expect(destinoDepoisDoEntrar({}, INICIO)).toBe(INICIO)
    expect(destinoDepoisDoEntrar(de({ pathname: '/login' }), INICIO)).toBe(INICIO)
    expect(destinoDepoisDoEntrar(de({ pathname: 'https://outro.site' }), INICIO)).toBe(INICIO)
    expect(destinoDepoisDoEntrar(de({ pathname: 42 }), INICIO)).toBe(INICIO)
  })
})
