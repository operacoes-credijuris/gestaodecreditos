// ABRIR EM NOVA ABA DEPOIS DE ESPERAR (auditoria de bugs, 09/10/2026).
//
// O navegador só deixa abrir aba perto do clique. A pasta do crédito (três
// chamadas ao Drive, às vezes com a janela de autorização do Google) e a petição
// salva no Drive (gerar o .docx e subir) passam desse prazo, e o bloqueador de
// pop-up engolia a aba SEM AVISO: o primeiro clique "não fazia nada". Com o
// `noopener` na chamada o retorno é sempre null, e nem dava para perceber.
//
// Aqui a aba abre sem `noopener` — para saber se abriu — e o vínculo com esta
// página é cortado logo em seguida (`opener = null`, o que o `noopener` fazia).
// Bloqueada, quem chama oferece o link num botão, que é um clique novo.

/** Abre `url` numa aba nova. false: o navegador bloqueou. */
export function abrirEmNovaAba(url: string, abrir: typeof window.open = window.open.bind(window)): boolean {
  const aba = abrir(url, '_blank')
  if (!aba) return false
  try {
    aba.opener = null
  } catch {
    /* outra origem já carregando: o vínculo não é acessível, e tanto faz */
  }
  return true
}
