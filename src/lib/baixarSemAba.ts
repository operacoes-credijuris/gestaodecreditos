// BAIXAR UM ARQUIVO DE OUTRO DOMÍNIO SEM ABRIR ABA (07/10/2026, pedido do dono).
//
// PELO BLOB, e não por `<a download>` direto: o atributo é ignorado em endereço
// de outro domínio (o drive do Kommo), e o navegador abriria o arquivo numa aba
// em vez de salvá-lo. O drive responde com CORS — é o mesmo `fetch` que o
// visualizador de imagem e o "baixar anexos do card" já fazem.
//
// A RESERVA, se o `fetch` falhar (rede, CORS que mude um dia), é um <iframe>
// escondido apontado ao link: o drive responde como download, então o arquivo é
// salvo e nenhuma aba aparece. Uma aba nova depois de um `await` seria barrada
// como popup de qualquer forma.

export async function baixarSemAba(endereco: string, nome: string): Promise<void> {
  let url: string
  try {
    const r = await fetch(endereco)
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    url = URL.createObjectURL(await r.blob())
  } catch {
    const quadro = document.createElement('iframe')
    quadro.hidden = true
    quadro.src = endereco
    document.body.appendChild(quadro)
    // Tempo de sobra para o download começar; o quadro não carrega nada visível.
    setTimeout(() => quadro.remove(), 60_000)
    return
  }
  const a = document.createElement('a')
  a.href = url
  a.download = nome
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revogar na mesma linha cancelaria o download em alguns navegadores.
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
