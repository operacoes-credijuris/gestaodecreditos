// As regras das janelas de Configurações e dos Parâmetros de atualização que não
// dependem de tela: quando um formulário está "sujo" (fechar pergunta "Descartar
// alterações?") e o que se diz quando a busca no Banco Central falha.
//
// FICAM AQUI, E NÃO NOS COMPONENTES, para serem testadas sem React: uma regra de
// sujeira errada ou pergunta a quem não digitou nada, ou deixa fechar e perder o
// que foi digitado.

/** O formulário do "Novo usuário", como a tela o guarda. */
export interface FormNovoUsuario {
  nome: string
  email: string
  password: string
  role: string
}

/** O perfil com que o "Novo usuário" abre. */
export const PERFIL_INICIAL = 'usuario'

/**
 * O "Novo usuário" tem algo digitado (ou o perfil trocado).
 *
 * ESPAÇO EM BRANCO NÃO CONTA no nome e no e-mail — o Criar os apara antes de
 * enviar, então não há o que perder. A SENHA CONTA COMO VEIO: espaço é caractere
 * de senha.
 */
export function novoUsuarioSujo(f: FormNovoUsuario): boolean {
  return (
    f.nome.trim() !== '' ||
    f.email.trim() !== '' ||
    f.password !== '' ||
    f.role !== PERFIL_INICIAL
  )
}

/** O que a janela "Editar usuário" mostra e altera. */
export interface EdicaoDeUsuario {
  nome: string
  email: string
  password: string
}

/**
 * Algum campo do "Editar usuário" difere do que está gravado.
 *
 * COMPARA COM O GRAVADO, e não com "campo vazio": a janela abre preenchida, e
 * abrir e fechar sem mexer em nada não pode perguntar nada. Nome nulo no
 * cadastro é o campo vazio da tela. A senha nova abre em branco: qualquer coisa
 * nela é alteração.
 */
export function edicaoDeUsuarioSuja(
  e: EdicaoDeUsuario,
  gravado: { nome: string | null; email: string },
): boolean {
  return e.nome !== (gravado.nome ?? '') || e.email !== gravado.email || e.password !== ''
}

/** SELIC e IPCA como a janela os guarda (número, ou nulo quando vazio). */
export interface IndicesDosParametros {
  selic: number | null
  ipca: number | null
}

/**
 * SELIC ou IPCA diferentes do que está gravado — fechar a janela pergunta antes
 * de descartar.
 *
 * O QUE O BANCO CENTRAL ACABOU DE GRAVAR NÃO CONTA como alteração (a amostra:
 * "fechar a janela não pergunta se quer descartar o que já está salvo"): quem
 * chama passa como `gravados` o resultado da busca, quando houve uma.
 */
export function parametrosAlterados(
  campos: IndicesDosParametros,
  gravados: IndicesDosParametros,
): boolean {
  return campos.selic !== gravados.selic || campos.ipca !== gravados.ipca
}

/** O aviso de sucesso do "Buscar no Banco Central" (a frase da amostra). */
export const MSG_BCB_ATUALIZADO = 'Índices atualizados pelo Banco Central e já gravados.'

/**
 * A mensagem de erro do "Buscar no Banco Central".
 *
 * NA FALHA TOTAL (a função responde `gravado: false`: nenhum índice veio), a
 * frase da amostra diz o que importa — que NADA FOI GRAVADO, e por quê, índice
 * por índice. Qualquer outro erro (acesso negado, rede) segue com a mensagem de
 * sempre: sem a função dizer que não gravou, a tela não pode afirmar isso.
 */
export function mensagemDaFalhaDoBcb(e: unknown): string {
  const erro = e as { message?: unknown; nadaGravado?: unknown; avisos?: unknown } | null
  const mensagem = typeof erro?.message === 'string' ? erro.message : 'erro desconhecido'
  if (erro?.nadaGravado !== true) return mensagem
  const avisos = Array.isArray(erro.avisos)
    ? erro.avisos.filter((a): a is string => typeof a === 'string' && a.trim() !== '')
    : []
  const motivo = (avisos.length ? avisos.join('; ') : mensagem).replace(/[.\s]+$/, '')
  return `Não consegui atualizar pelo Banco Central, e nada foi gravado: ${motivo}.`
}

/** As 27 UFs (a mesma lista da leitura do servidor, em djen-publicacoes). */
const UFS_DA_OAB = new Set(
  'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' '),
)

/**
 * Lê uma OAB gravada nas Configurações do DJEN para o formulário — A MESMA
 * LEITURA do servidor (`lerOab` em djen-publicacoes), que já aceita "54.162/GO",
 * "SP/54162", "54162-SP" e "OAB/SP 54162" (auditoria de bugs, 09/10/2026).
 *
 * A tela lia com a expressão antiga: "54.162/GO" virava 54/GO, e "SP/54162",
 * 54162/GO — e o primeiro Salvar na seção (ao incluir outra OAB, por exemplo)
 * regravava a OAB errada, e a busca no DJEN deixava de achar as intimações dela.
 *
 * Devolve null quando não dá para ler: quem chama decide o que mostrar.
 */
export function lerOabGravada(bruto: unknown): { numero: string; uf: string } | null {
  const t = String(bruto ?? '')
    .toUpperCase()
    .replace(/[.\s]/g, '')
  const numeroPrimeiro = t.match(/(\d{2,7})[/-]?([A-Z]{2})/)
  if (numeroPrimeiro && UFS_DA_OAB.has(numeroPrimeiro[2])) {
    return { numero: numeroPrimeiro[1].replace(/\D/g, ''), uf: numeroPrimeiro[2] }
  }
  const ufPrimeiro = t.match(/([A-Z]{2})[/-]?(\d{2,7})/)
  if (ufPrimeiro && UFS_DA_OAB.has(ufPrimeiro[1])) {
    return { numero: ufPrimeiro[2].replace(/\D/g, ''), uf: ufPrimeiro[1] }
  }
  return null
}
