// _shared/contaMestra.ts
// A CONTA-MESTRA E QUEM PODE MEXER NELA (auditoria de bugs, 09/10/2026).
//
// `ADMIN_EMAIL` é o escape deliberado do portão de acesso (ver auth.ts): a
// conta-mestra não se autotranca, e é ela quem reativa os outros. Esse escape
// é POR E-MAIL — e a admin-update-user deixava qualquer administrador trocar o
// e-mail e a senha de qualquer conta, inclusive a mestra. Um admin comum
// trocava o e-mail dela (e o escape sumia) ou só a senha (e o dono ficava de
// fora). Agora as credenciais da mestra só mudam pela própria mestra; o nome,
// qualquer admin muda.
//
// Sem `npm:` e sem `Deno.`, para o vitest.

export const ADMIN_EMAIL = 'contato@credijuris.com'

const igual = (a: string | null | undefined, b: string) => (a ?? '').trim().toLowerCase() === b

/** Pode trocar e-mail/senha do alvo? Só a mestra mexe nas credenciais da mestra. */
export function podeTrocarCredenciais(
  emailDeQuemPede: string | null | undefined,
  emailDoAlvo: string | null | undefined,
): boolean {
  if (!igual(emailDoAlvo, ADMIN_EMAIL)) return true
  return igual(emailDeQuemPede, ADMIN_EMAIL)
}
