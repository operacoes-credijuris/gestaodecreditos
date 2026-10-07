// OS LINKS NO TEXTO DE UMA ANOTAÇÃO (07/10/2026, pedido do dono): a equipe
// deixa links no histórico do card, e eles apareciam como texto comum.
//
// SÓ ENDEREÇOS COM http(s):// OU www. — "processo.pdf" ou "fulano@x.com" não
// viram link: a chance de errar é maior que o ganho.
//
// A PONTUAÇÃO DO FIM DA FRASE NÃO É DO LINK: "veja https://x.gov.br/doc." leva
// o ponto para fora; o ")" final também, quando o link não abriu parêntese
// (o caso "(https://x.gov.br)").

export type PedacoDoTexto = { tipo: 'texto'; texto: string } | { tipo: 'link'; texto: string; href: string }

const ENDERECO = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi

function semPontuacaoFinal(url: string): string {
  let u = url.replace(/[.,;:!?]+$/, '')
  while (u.endsWith(')') && (u.match(/\(/g)?.length ?? 0) < (u.match(/\)/g)?.length ?? 0)) {
    u = u.slice(0, -1).replace(/[.,;:!?]+$/, '')
  }
  return u
}

export function pedacosComLinks(texto: string): PedacoDoTexto[] {
  const pedacos: PedacoDoTexto[] = []
  let desde = 0
  for (const m of texto.matchAll(ENDERECO)) {
    const url = semPontuacaoFinal(m[0])
    const inicio = m.index ?? 0
    if (!url || /^www\.?$/i.test(url)) continue
    if (inicio > desde) pedacos.push({ tipo: 'texto', texto: texto.slice(desde, inicio) })
    pedacos.push({ tipo: 'link', texto: url, href: /^https?:\/\//i.test(url) ? url : `https://${url}` })
    desde = inicio + url.length
  }
  if (desde < texto.length) pedacos.push({ tipo: 'texto', texto: texto.slice(desde) })
  return pedacos
}
