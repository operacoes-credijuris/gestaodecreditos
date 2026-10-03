// O que os guardas de rota (components/ProtectedRoute.tsx) decidem, como função
// pura — para o teste conferir a ordem das perguntas sem montar React.

/** O que a guarda faz com o endereço pedido. */
export type DecisaoDaGuarda = 'carregando' | 'login' | 'desativado' | 'inicio' | 'liberar'

export interface EstadoDaSessao {
  /** A sessão guardada ainda está sendo lida (a abertura da plataforma). */
  carregando: boolean
  temSessao: boolean
  /**
   * Há sessão, mas o perfil DESTE usuário ainda não foi lido. É o intervalo logo
   * depois do Entrar: a sessão chega antes do perfil, e sem o perfil não se sabe
   * nem se a pessoa é administradora nem se a conta foi desativada.
   */
  perfilCarregando: boolean
  acessoDesativado: boolean
  isAdmin: boolean
}

/**
 * A decisão, na ordem: sessão sendo lida → sem sessão → perfil sendo lido →
 * conta desativada → falta de permissão → libera.
 *
 * ESPERAR O PERFIL É O QUE IMPEDE O DEFEITO DO ENTRAR (03/10/2026): quem é
 * administrador pelo perfil (e não pelo e-mail da casa), com o link de
 * Configurações aberto e a sessão vencida, entrava e era mandado ao início — a
 * guarda olhava o `isAdmin` no instante em que a sessão chegava e o perfil
 * ainda não. Pela mesma razão, a conta desativada via a plataforma por um
 * instante antes do aviso.
 */
export function decidirGuarda(e: EstadoDaSessao, exigeAdmin: boolean): DecisaoDaGuarda {
  if (e.carregando) return 'carregando'
  if (!e.temSessao) return 'login'
  if (e.perfilCarregando) return 'carregando'
  // Desativado antes de admin: quem foi desligado não deve ver Configurações
  // nem ser mandado ao início sem explicação.
  if (e.acessoDesativado) return 'desativado'
  if (exigeAdmin && !e.isAdmin) return 'inicio'
  return 'liberar'
}

/**
 * Para onde o Entrar leva: o endereço que a pessoa pediu antes de cair no login
 * (o `ProtectedRoute` o guarda em `state.from`), ou o início.
 *
 * COM A BUSCA DO ENDEREÇO (`?card=…`), e não só o caminho. É por ela que um link
 * de card mandado por colega — e o "Voltar ao card" — chega ao card certo; o
 * Entrar levava só o caminho, e a pessoa caía na Análise sem o card.
 */
export function destinoDepoisDoEntrar(state: unknown, inicio: string): string {
  const de = (state as { from?: { pathname?: unknown; search?: unknown; hash?: unknown } } | null)?.from
  const caminho = typeof de?.pathname === 'string' ? de.pathname : ''
  if (!caminho.startsWith('/') || caminho === '/login') return inicio
  const busca = typeof de?.search === 'string' ? de.search : ''
  const ancora = typeof de?.hash === 'string' ? de.hash : ''
  return caminho + busca + ancora
}
