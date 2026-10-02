// O que o Salvar da ficha de pessoa (Dados cadastrais) grava.
//
// MORAVA DENTRO DE pages/comercial/DadosPessoaisBancarios.tsx, e saiu de lá para
// poder ser testada: o Salvar é upsert da LINHA INTEIRA de investidor_dados, e
// coluna que o payload esquece de carregar é coluna apagada. Três delas não têm
// campo na tela — gênero, complemento da qualificação e o endereço antigo em
// texto corrido — e as três vão para o contrato. Uma tela nova que montasse o
// payload do zero apagaria as três sem erro nenhum.
//
// Só `import type` de queries.ts: o valor de lá puxa o cliente do Supabase, e
// esta função tem de rodar no teste sem rede.
import { compilarEndereco, ehCnpj } from './format'
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
 * A linha que o Salvar grava.
 *
 * `chave` e `nome` chegam prontos (o nome já sem espaço nas pontas, a chave já
 * normalizada): a tela usa os dois ANTES, para barrar o cadastro sobre ficha
 * existente. `anterior` é a ficha como estava no banco — `undefined` no cadastro
 * novo —, e é dela que sai o que a tela não edita.
 */
export function montarFichaPessoa({
  tipo,
  chave,
  nome,
  form,
  anterior,
}: {
  tipo: TipoPessoa
  chave: string
  nome: string
  form: Record<CampoPessoa, string>
  anterior:
    | Pick<InvestidorDados, 'endereco' | 'genero' | 'qualificacao_complemento'>
    | undefined
}): Omit<InvestidorDados, 'atualizado_em'> {
  // Campo em branco vira null, não string vazia: no banco "não informado" é
  // ausência de valor, e "" faria a célula parecer preenchida com nada.
  const vazioNull = (s: string) => (s.trim() ? s.trim() : null)
  const compilado = vazioNull(compilarEndereco(form))
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
    // tabela direto no banco ver o endereço pronto.
    //
    // Partes vazias NÃO apagam o texto legado: quem abre a ficha de alguém que
    // só tem o endereço antigo em texto corrido, mexe no Pix e salva, perderia
    // o endereço.
    endereco: compilado ?? anterior?.endereco ?? null,
    // Sem campo próprio nesta tela ainda (usados só na geração de contratos,
    // preenchidos direto no banco por enquanto) — preserva o que já estava
    // na ficha, mesmo raciocínio do endereço legado acima.
    genero: anterior?.genero ?? null,
    qualificacao_complemento: anterior?.qualificacao_complemento ?? null,
  }
}
