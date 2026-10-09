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
//
// RESPOSTA DE ERRO NÃO VAI PARA O QUADRO (09/10/2026): com o link vencido o
// drive responde 403, e o quadro carregava essa página de erro, invisível — nada
// era salvo e a função voltava como se tivesse dado certo, sem aviso nenhum. O
// quadro só serve quando o `fetch` nem chega à resposta; com resposta de erro,
// a função LANÇA, e quem chamou diz o que houve (e pede um link novo).

export async function baixarSemAba(endereco: string, nome: string): Promise<void> {
  let r: Response
  try {
    r = await fetch(endereco)
  } catch {
    const quadro = document.createElement('iframe')
    quadro.hidden = true
    quadro.src = endereco
    document.body.appendChild(quadro)
    // Tempo de sobra para o download começar; o quadro não carrega nada visível.
    setTimeout(() => quadro.remove(), 60_000)
    return
  }
  if (!r.ok) throw new Error(`o Kommo recusou o download (HTTP ${r.status}) — o link pode ter vencido; clique de novo.`)
  const url = URL.createObjectURL(await r.blob())
  const a = document.createElement('a')
  a.href = url
  a.download = nome
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revogar na mesma linha cancelaria o download em alguns navegadores.
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
