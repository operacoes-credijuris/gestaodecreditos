// O que o Salvar da ficha de pessoa (Dados cadastrais) grava.
//
// MORAVA DENTRO DE pages/comercial/DadosPessoaisBancarios.tsx, e saiu de lá para
// poder ser testada: o Salvar é upsert da LINHA INTEIRA de investidor_dados, e
// coluna que o payload esquece de carregar é coluna apagada. Três delas iam para
// o contrato sem campo na tela — gênero, complemento da qualificação e o
// endereço antigo em texto corrido. Uma tela nova que montasse o payload do zero
// apagaria as três sem erro nenhum.
//
// Desde a onda 2 do redesenho (02/10/2026, decisão do dono), gênero e
// complemento GANHARAM CAMPO na ficha do INVESTIDOR (seção "Para o contrato"):
// lá o Salvar grava o que a pessoa escolheu. Na ficha do ORIGINADOR, que não
// tem os campos, continuam preservados da ficha anterior — ver `paraContrato`.
//
// Só `import type` de queries.ts: o valor de lá puxa o cliente do Supabase, e
// esta função tem de rodar no teste sem rede.
import { compilarEndereco, ehCnpj, normalizarNome } from './format'
import type { InvestidorDados, TipoPessoa } from './queries'

/** Os campos que a ficha edita. São as chaves do formulário da tela. */
export type CampoPessoa =
  | 'cpf'
  | 'rg'
  | 'representante'
  | 'banco'
  | 'agencia'
  | 'conta'
  | 'pix'
  | 'logradouro'
  | 'numero'
  | 'complemento'
  | 'bairro'
  | 'cidade'
  | 'uf'
  | 'cep'

/**
 * A chave da linha que o Salvar grava.
 *
 * NO CADASTRO NOVO ela sai do NOME, que é digitado agora e é ele que identifica
 * a pessoa no banco. NA FICHA QUE JÁ EXISTE, é a chave da LINHA ABERTA — o nome
 * ali é fixo na tela. Recalculada do nome exibido, ela divergia da guardada
 * sempre que o nome_chave não fosse o nome normalizado (ficha inserida direto
 * no banco, normalização antiga), e o Salvar criava OUTRA linha, sem gênero,
 * qualificação nem endereço antigo, deixando a original órfã. Decisão do dono
 * (02/10/2026).
 */
export function chaveDaFicha(janela: { novo: boolean; chave: string; nome: string }): string {
  return janela.novo ? normalizarNome(janela.nome.trim()) : janela.chave
}

/**
 * O endereço em texto corrido que o Salvar grava — e que a prévia da tela mostra.
 *
 * O TEXTO ANTIGO SÓ CEDE A UM ENDEREÇO NOVO COM RUA E CIDADE. A ficha de quem
 * só tem o endereço legado em texto corrido perdia o endereço inteiro quando
 * alguém preenchia uma parte só — o CEP, por exemplo — e salvava: o texto
 * gravado virava "CEP 30140-071", e é ele que vai para o contrato. Decisão do
 * dono (02/10/2026). As partes digitadas são gravadas mesmo assim, nas colunas
 * delas; só o texto corrido espera o endereço novo ficar utilizável.
 *
 * `mantemAntigo` diz à tela que o texto mostrado é o antigo, para ela explicar.
 */
export function enderecoDaFicha(
  form: Pick<Record<CampoPessoa, string>, 'logradouro' | 'numero' | 'complemento' | 'bairro' | 'cidade' | 'uf' | 'cep'>,
  antigo: string | null | undefined,
): { texto: string | null; mantemAntigo: boolean } {
  const compilado = compilarEndereco(form).trim() || null
  const temAntigo = Boolean(antigo?.trim())
  // Partes vazias NÃO apagam o texto legado: quem abre a ficha de alguém que só
  // tem o endereço antigo em texto corrido, mexe no Pix e salva, perderia o
  // endereço.
  if (!compilado) return { texto: antigo ?? null, mantemAntigo: temAntigo }
  if (temAntigo && !(form.logradouro.trim() && form.cidade.trim())) {
    return { texto: antigo ?? null, mantemAntigo: true }
  }
  return { texto: compilado, mantemAntigo: false }
}

/**
 * Os dois campos da seção "Para o contrato" da ficha do investidor, como a tela
 * os tem: `genero` é '', 'M' ou 'F' (o '' é "Não informado").
 */
export interface CamposParaContrato {
  genero: string
  qualificacao_complemento: string
}

/**
 * O valor da tela para uma coluna que pode estar vazia na ficha.
 *
 * VAZIO CONTINUA VAZIO, e do mesmo jeito: campo em branco grava null — salvo se
 * a ficha já guardava "" (aí fica ""), para o Salvar de quem não mexeu no campo
 * não trocar um vazio por outro. Valor preenchido vai sem espaço nas pontas.
 */
function daTela(valor: string, anterior: string | null | undefined): string | null {
  const v = valor.trim()
  if (v) return v
  return anterior === '' ? '' : null
}

/**
 * O gênero que a tela manda. O banco só aceita 'M', 'F' ou vazio
 * (investidor_dados_genero_valido, migração 0047); qualquer outra coisa conta
 * como "Não informado" — nunca vira masculino por conta própria.
 */
function generoDaTela(valor: string, anterior: string | null | undefined): string | null {
  const g = valor.trim().toUpperCase()
  return g === 'M' || g === 'F' ? g : daTela('', anterior)
}

/**
 * A linha que o Salvar grava.
 *
 * `chave` e `nome` chegam prontos (o nome já sem espaço nas pontas, a chave já
 * normalizada): a tela usa os dois ANTES, para barrar o cadastro sobre ficha
 * existente. `anterior` é a ficha como estava no banco — `undefined` no cadastro
 * novo —, e é dela que sai o que a tela não edita.
 *
 * `paraContrato` são o gênero e o complemento da qualificação QUANDO A TELA OS
 * TEM (ficha do investidor): aí valem os da tela, inclusive para apagar. Sem
 * ele (ficha do originador), os dois são preservados da ficha anterior, como
 * sempre foram.
 */
export function montarFichaPessoa({
  tipo,
  chave,
  nome,
  form,
  anterior,
  paraContrato,
}: {
  tipo: TipoPessoa
  chave: string
  nome: string
  form: Record<CampoPessoa, string>
  anterior:
    | Pick<InvestidorDados, 'endereco' | 'genero' | 'qualificacao_complemento'>
    | undefined
  paraContrato?: CamposParaContrato
}): Omit<InvestidorDados, 'atualizado_em'> {
  // Campo em branco vira null, não string vazia: no banco "não informado" é
  // ausência de valor, e "" faria a célula parecer preenchida com nada.
  const vazioNull = (s: string) => (s.trim() ? s.trim() : null)
  return {
    tipo,
    nome_chave: chave,
    nome_exibicao: nome,
    cpf: vazioNull(form.cpf),
    rg: vazioNull(form.rg),
    // Representante só vale para pessoa jurídica. Se o documento não é CNPJ,
    // grava null: mesmo padrão dos campos condicionais de Créditos — o campo
    // saiu da tela, então o valor não pode ficar viajando escondido. Sem isso,
    // corrigir um CNPJ digitado por engano deixaria a pessoa física com um
    // "representante legal" invisível na ficha.
    representante: ehCnpj(form.cpf) ? vazioNull(form.representante) : null,
    banco: vazioNull(form.banco),
    agencia: vazioNull(form.agencia),
    conta: vazioNull(form.conta),
    pix: vazioNull(form.pix),
    logradouro: vazioNull(form.logradouro),
    numero: vazioNull(form.numero),
    complemento: vazioNull(form.complemento),
    bairro: vazioNull(form.bairro),
    cidade: vazioNull(form.cidade),
    uf: vazioNull(form.uf),
    cep: vazioNull(form.cep),
    // O texto corrido é derivado das partes e gravado junto, para quem lê a
    // tabela direto no banco ver o endereço pronto — com a regra do texto
    // legado de `enderecoDaFicha`.
    endereco: enderecoDaFicha(form, anterior?.endereco).texto,
    // Com os campos na tela (investidor), grava o que a pessoa escolheu. Sem
    // eles (originador), preserva o que já estava na ficha — mesmo raciocínio
    // do endereço legado acima: coluna sem campo não pode ser apagada.
    genero: paraContrato
      ? generoDaTela(paraContrato.genero, anterior?.genero)
      : (anterior?.genero ?? null),
    qualificacao_complemento: paraContrato
      ? daTela(paraContrato.qualificacao_complemento, anterior?.qualificacao_complemento)
      : (anterior?.qualificacao_complemento ?? null),
  }
}
