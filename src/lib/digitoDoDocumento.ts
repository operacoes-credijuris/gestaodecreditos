// O AVISO DO DÍGITO VERIFICADOR no campo CPF / CNPJ da ficha.
//
// SÓ COM O DOCUMENTO COMPLETO — 11 dígitos (CPF) ou 14 (CNPJ) —, como na
// amostra aprovada (paginas1.js). Antes, o "Dígito verificador não confere"
// aparecia a partir do primeiro dígito e acompanhava toda a digitação: um campo
// vermelho para quem ainda não terminou de escrever.
//
// É SÓ O AVISO. A trava do Salvar (`cpfCnpjValido`) não muda: documento com 12
// ou 13 dígitos, ou incompleto, continua barrado ao salvar, com a mensagem de lá.
import { cpfCnpjValido, onlyDigits } from './format'

export const AVISO_DO_DIGITO = 'Dígito verificador não confere'

/** O texto do erro no campo, ou undefined quando não há o que dizer ainda. */
export function avisoDoDigito(documento: string | null | undefined): string | undefined {
  const n = onlyDigits(documento).length
  if (n !== 11 && n !== 14) return undefined
  return cpfCnpjValido(documento) ? undefined : AVISO_DO_DIGITO
}
