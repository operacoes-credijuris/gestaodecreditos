// O menu lateral das Configurações: as seções, o ponto de estado de cada
// integração, o saldo ao lado do nome e o que conta como pacote de Skill.
//
// FUNÇÕES PURAS, separadas da tela, porque o ponto do menu e o selo do cartão
// têm de dizer A MESMA COISA: se um deles mudar de regra sozinho, o menu passa a
// afirmar "configurada" ao lado de um cartão que diz "Estado não carregado".
// Aqui a regra mora uma vez só, e o teste a prende.

export type SecaoId =
  | 'advbox'
  | 'kommo'
  | 'anthropic'
  | 'escavador'
  | 'bullai'
  | 'djen'
  | 'skills'
  | 'roteiro'
  | 'usuarios'

/** Os grupos do menu, na ordem da amostra. */
export const GRUPOS_DO_MENU: ReadonlyArray<{
  titulo: string
  itens: ReadonlyArray<{ id: SecaoId; rotulo: string }>
}> = [
  {
    titulo: 'Integrações',
    itens: [
      { id: 'advbox', rotulo: 'ADVBOX' },
      { id: 'kommo', rotulo: 'Kommo' },
      { id: 'anthropic', rotulo: 'Anthropic' },
      { id: 'escavador', rotulo: 'Escavador' },
      { id: 'bullai', rotulo: 'BullAI' },
      { id: 'djen', rotulo: 'DJEN' },
    ],
  },
  {
    titulo: 'Assistente',
    itens: [
      { id: 'skills', rotulo: 'Skills' },
      { id: 'roteiro', rotulo: 'Roteiro da qualificação' },
    ],
  },
  { titulo: 'Equipe', itens: [{ id: 'usuarios', rotulo: 'Usuários' }] },
]

/** A seção que abre primeiro. */
export const SECAO_INICIAL: SecaoId = 'advbox'

/**
 * Frase do Salvar travado quando a leitura falhou (ADVBOX e DJEN). Fica no
 * `title` do botão: a caixa âmbar acima já diz o que houve, e o botão apagado
 * sem explicação parece defeito.
 */
export const TRAVA_LEITURA =
  'O estado atual não foi lido: salvar agora gravaria por cima sem saber o que está lá.'

export type TomDoPonto = 'ok' | 'off' | 'aviso'

export interface PontoDoMenu {
  tom: TomDoPonto
  /** Vai no `title` da bolinha e no texto para leitor de tela. */
  rotulo: string
}

/**
 * O ponto das integrações de selo simples (ADVBOX, Anthropic, Escavador,
 * BullAI). REPETE O `SeloIntegracao`: erro de leitura vem primeiro, porque
 * leitura que falhou não é "não configurada" — é "não deu para saber".
 */
export function pontoDaIntegracao(error: unknown, configurado: boolean): PontoDoMenu {
  if (error) return { tom: 'aviso', rotulo: 'Estado não carregado' }
  return configurado
    ? { tom: 'ok', rotulo: 'Configurada' }
    : { tom: 'off', rotulo: 'Não configurada' }
}

/**
 * O ponto do Kommo, que REPETE O SELO DELE: além de configurado ou não, há o
 * "Salvo, sem conexão" — o token foi gravado, mas o Kommo não confirmou. Isso é
 * âmbar, e não verde: quem olha o menu precisa saber que há o que conferir.
 */
export function pontoDoKommo(
  error: unknown,
  configurado: boolean,
  validado: boolean,
): PontoDoMenu {
  if (error) return { tom: 'aviso', rotulo: 'Estado não carregado' }
  if (!configurado) return { tom: 'off', rotulo: 'Não configurada' }
  return validado
    ? { tom: 'ok', rotulo: 'Configurada' }
    : { tom: 'aviso', rotulo: 'Salvo, sem conexão' }
}

export interface ExtraDoMenu {
  texto: string
  aviso: boolean
  title: string
}

/**
 * O número ao lado do nome no menu (saldo do Escavador, plano da BullAI).
 *
 * SÓ COM A INTEGRAÇÃO CONFIGURADA, e NADA ENQUANTO A CONSULTA CORRE — a mesma
 * regra do selo do cartão: um "…" piscando no menu chamaria mais atenção do que
 * o próprio número. Na falha, "indisponível" com o motivo no `title`, porque
 * silêncio ali faria o menu parecer dizer que está tudo bem.
 */
export function extraDoMenu<T>(
  configurado: boolean,
  data: T | undefined,
  error: unknown,
  texto: (d: T) => string,
  title: string,
): ExtraDoMenu | null {
  if (!configurado) return null
  if (error) {
    const motivo = error instanceof Error ? error.message : String(error)
    return { texto: 'indisponível', aviso: true, title: `Saldo indisponível: ${motivo}` }
  }
  if (data === undefined) return null
  return { texto: texto(data), aviso: false, title }
}

/** O plano da BullAI em poucas letras, para caber ao lado do nome no menu. */
export function textoDoPlanoBullai(restantes: number | null): string {
  return restantes == null ? 'ilimitado' : `${restantes.toLocaleString('pt-BR')} consulta(s)`
}

/**
 * O PACOTE DA SKILL É UM .zip. O seletor de arquivo já filtra por `accept`, mas
 * o que se SOLTA na caixa não passa por esse filtro — daí conferir pelo nome.
 */
export function ehPacoteZip(nome: string): boolean {
  return /\.zip$/i.test(nome.trim())
}

/** Tamanho para mostrar na caixa do .zip: nunca "0 KB" para arquivo que existe. */
export function tamanhoEmKB(bytes: number): number {
  return Math.max(1, Math.round(bytes / 1024))
}
