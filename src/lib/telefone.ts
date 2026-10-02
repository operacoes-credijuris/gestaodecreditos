// Telefone brasileiro: dígitos canônicos, máscara, completude e link do WhatsApp.
//
// MORAVA DENTRO DE pages/operacional/execucao/ContatosServentias.tsx, e saiu de lá
// para poder ser testado: a máscara é aplicada a cada tecla, então o que ela
// devolve é o que o Salvar grava — e o erro que ela já teve (ver
// digitosTelefoneBR) passava por máscara, validação e banco sem acusar nada.
import { onlyDigits } from './format'

/**
 * Dígitos de um telefone brasileiro em forma canônica: DDD + número, sem código
 * de país e sem zero de operadora.
 *
 * POR QUE PRECISA EXISTIR: quem pega o contato da vara copia de uma conversa do
 * WhatsApp ou da agenda do celular, e o que vem colado é "+55 31 98888-7777". A
 * máscara antiga fazia só onlyDigits().slice(0, 11), ou seja, cortava o EXCESSO
 * PELA DIREITA — e nesse caso o excesso está à esquerda. Sobrava "55319888877",
 * exibido como "(55) 31988-8877": onze dígitos, DDD 55 que existe de verdade
 * (Pelotas), máscara sem defeito, validação aprovada, banco gravado. Ninguém
 * tinha como perceber, e o link do WhatsApp na tabela apontava para um número de
 * terceiro. Cortar pela direita só serve quando a sobra está na direita.
 */
export function digitosTelefoneBR(v?: string | null): string {
  let d = onlyDigits(v)
  // ORDEM IMPORTA: o zero sai antes do código do país. "031 3222-1234" tem
  // exatamente 11 dígitos, então uma guarda de "acima de 11" não pegaria o zero
  // e o número viraria "(03) 13222-1234" — foi o que o teste mostrou. Número
  // brasileiro nunca começa com zero, e abaixo de 11 dígitos é digitação em
  // curso, que não se deve mexer.
  while (d.startsWith('0') && d.length > 10) d = d.slice(1)
  // Código do país colado junto (12 ou 13 dígitos começando em 55). Só corta
  // acima de 11 dígitos, então celular legítimo de DDD 55 passa intacto.
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2)
  return d.slice(0, 11)
}

// Máscara de telefone brasileiro: (DD) XXXXX-XXXX (9 díg.) ou (DD) XXXX-XXXX (8 díg.).
export function formatTelefone(v: string): string {
  const d = digitosTelefoneBR(v)
  if (d.length === 0) return ''
  if (d.length <= 2) return `(${d}`
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}

export function telefoneIncompleto(v?: string | null): boolean {
  const d = digitosTelefoneBR(v)
  return d.length > 0 && d.length < 10
}

// Normaliza também aqui, e não só na máscara: os contatos gravados antes desta
// correção continuam no banco com o código do país embutido, e sem isto o link
// sairia com 55 duplicado ("wa.me/5555319888877").
export function waLink(v: string): string {
  return `https://wa.me/55${digitosTelefoneBR(v)}`
}
