// Lê os documentos da pasta de um crédito e devolve os campos do cadastro.
//
// O NAVEGADOR MANDA TEXTO, NÃO ARQUIVO. Quem baixa do Drive e extrai o texto de
// PDF, DOCX e XLSX é a tela (lib/textoDeArquivo.ts), com a conta Google de quem
// está usando. Aqui chega texto puro. Duas razões: o teto de CPU da Edge Function
// não aguenta abrir PDF grande, e o IP de datacenter daqui é tratado pior por
// serviços externos — o DJEN nos devolve 403 por isso.
//
// A RESPOSTA NÃO É SALVA. Volta para a tela, que preenche o formulário e espera a
// pessoa conferir. Extração é leitura interpretada; gravar direto no banco é como
// se produz dado errado com cara de certo.
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { ERRO_ACESSO, getCallerAtivo, serviceClient } from '../_shared/auth.ts'
import Anthropic from 'npm:@anthropic-ai/sdk@0.115.0'

/**
 * OPUS, e não Sonnet como no resto da plataforma.
 *
 * Aqui o custo não é o critério: a extração roda UMA VEZ por crédito cadastrado —
 * dezenas por ano, não milhares por dia como o assistente. O que decide é a
 * natureza do trabalho, que é discriminação entre coisas parecidas, não resumo:
 * separar o advogado do cedente do advogado da cessionária, e o preço da cessão do
 * custo total do investidor (regras 5 e 6). Errar sai mais caro que o token, porque
 * o valor errado chega ao formulário com cara de conferido.
 *
 * Trocado de Sonnet 5 em 13/08/2026, junto com a reescrita das duas regras. Se um
 * dia isto passar a rodar em lote, o cálculo muda e vale reavaliar.
 */
const MODELO = 'claude-opus-5'

async function chaveAnthropic(): Promise<string | null> {
  const doAmbiente = Deno.env.get('ANTHROPIC_API_KEY')
  if (doAmbiente) return doAmbiente
  const { data } = await serviceClient()
    .from('integracao_anthropic_secret')
    .select('token')
    .eq('id', 1)
    .maybeSingle()
  return data?.token ?? null
}

/**
 * Os campos que a IA preenche — e SÓ eles.
 *
 * Ficam de fora espécie, originador, número do processo e cedente: esses vêm do
 * CAMINHO da pasta no Drive, com certeza total, e pedir à IA seria trocar certeza
 * por palpite.
 *
 * INSTRUMENTO e Nº RTDPJ entraram depois. Pareciam manuais até o dono explicar que
 * a resposta está na pasta: escritura pública, ou comprovante de protocolo de
 * registro no RTDPJ (que traz o número dentro), ou nada além do contrato
 * particular. É decisão por PRESENÇA de documento, com ordem de precedência — está
 * escrita na regra 7 do prompt.
 *
 * ÍNDICE DE ATUALIZAÇÃO também deixou de ser manual, e por um motivo diferente:
 * não se lê em documento nenhum, se CONCLUI da natureza do crédito. Tributário é
 * SELIC, todo o resto é IPCA + 2%. Regra 8.
 */
const CAMPOS = {
  tribunal:
    'Sigla CURTA do tribunal do processo — nunca o nome por extenso, nunca o tribunal citado no contrato. Padrão: estadual sem hífen (TJGO, TJMG, TJRS); regional com hífen e número (TRF-1, TRT-18); eleitoral regional com hífen e UF (TRE-MG); superior só a sigla (STF, STJ, TST, TSE, STM).',
  comarca: 'Comarca ou seção judiciária — só a localidade: "São Paulo", "Goiânia".',
  vara:
    'Só o juízo, SEM a comarca: "32ª Vara do Trabalho", nunca "32ª Vara do Trabalho de São Paulo". A comarca tem campo próprio, e repetida aqui aparece duas vezes na mesma linha da tabela.',
  cedente: 'Nome do credor original — quem cedeu o crédito.',
  cedente_advogado:
    'Quem representa o CEDENTE — quem vendeu o crédito. O ADVOGADO pessoa física ou a SOCIEDADE DE ADVOGADOS (escritório) que atua por ele; escritório é resposta válida, não deixe em branco por não ser pessoa física. ONDE ESTÁ: na planilha de análise de crédito, na aba de análise jurídica, na linha "Nome do advogado ou escritório de advocacia e CPF/CNPJ" — é essa linha que manda, porque fala do cedente por definição. NUNCA o advogado, procurador ou representante da CESSIONÁRIA, nunca o procurador do ente devedor, nunca o tabelião: ver regra 5. Grave só o nome ou a razão social, sem o CPF/CNPJ que vem colado na mesma célula. Essa linha pode estar vazia quando a cessão é de honorários (aí o advogado é o próprio cedente) — nesse caso procure o representante nos documentos do processo.',
  numero_processo_administrativo:
    'Número do processo ADMINISTRATIVO do precatório no tribunal — o segundo número, além do judicial, por onde o precatório anda na fila de pagamento do ente devedor. Costuma aparecer na análise de crédito e nos ofícios do tribunal. Só existe em precatório: em RPV é null, e em precatório sem o número localizado também é null.',
  entidade_devedora:
    'Ente público devedor na forma padronizada, e nada além dela: "União" (nunca "União Federal", "Fazenda Nacional" ou "Fazenda Pública"); "Estado de X" ou "Estado do X" conforme o nome pede (Estado de Goiás, Estado de São Paulo, Estado do Rio Grande do Sul, Estado do Amapá); "Município de X" (Município de Jacarezinho, Município de Goiânia). Autarquia e fundação ficam na sigla pela qual são conhecidas: INSS, DNIT, IBAMA.',
  valor_face:
    'Valor de face do crédito, em reais, NÚMERO puro (ex.: 120000.55). É o valor BRUTO do requisitório, não o que a Credijuris pagou.',
  data_referencia:
    'Data a que o valor de face se refere (data-base do cálculo), em AAAA-MM-DD.',
  expectativa_liquidacao:
    'Data prevista de pagamento do requisitório, em AAAA-MM-DD. Na análise de crédito costuma ser a data de pagamento projetada.',
  cessionario:
    'Quem ADQUIRIU o crédito — a parte cessionária do contrato de cessão. Não confundir com o cedente.',
  data_aquisicao: 'Data da assinatura do contrato de cessão, em AAAA-MM-DD.',
  capital_investido:
    'CUSTO TOTAL da cessionária para adquirir o crédito, em reais, número puro: preço da cessão MAIS comissões MAIS emolumentos. NÃO é o preço da cessão sozinho — esse é só o que o cedente recebeu, e é menor do que o investidor desembolsou. Sem as parcelas de custo, este campo vem null. Ver regra 6, que é a regra desta extração mais fácil de errar.',
  numero_rtdpj:
    'Número do registro no RTDPJ, como está no comprovante de protocolo. Havendo mais de um, separe por vírgula. Null se não houver comprovante na pasta.',
} as const

const FERRAMENTA = {
  name: 'preencher_credito',
  description:
    'Devolve os campos do cadastro do crédito lidos dos documentos, com a procedência de cada um.',
  // `as const` no type, como nas outras funções: o SDK exige o literal 'object',
  // e sem isto o TypeScript alarga para `string` e o deploy das functions falha.
  input_schema: {
    type: 'object' as const,
    properties: {
      campos: {
        type: 'object',
        description: 'Campo não encontrado nos documentos deve vir null.',
        properties: {
          ...Object.fromEntries(
            Object.entries(CAMPOS).map(([k, d]) => [
              k,
              k === 'valor_face' || k === 'capital_investido'
                ? { type: ['number', 'null'], description: d }
                : { type: ['string', 'null'], description: d },
            ]),
          ),
          tipo_credito: {
            type: 'array',
            items: {
              type: 'string',
              enum: ['principal', 'honorarios_contratuais', 'honorarios_advocaticios'],
            },
            description:
              'O que foi adquirido. Pode ser mais de um: "principal" é o crédito do credor; "honorarios_contratuais" são os do advogado por contrato; "honorarios_advocaticios" são os sucumbenciais. Lista vazia se não der para saber.',
          },
          instrumento: {
            type: ['string', 'null'],
            enum: ['escritura_publica', 'registro_publico', 'particular', null],
            description:
              'Como a cessão foi formalizada. Decidido pelo que EXISTE na pasta, na ordem: escritura pública lavrada em notas -> "escritura_publica"; senão, comprovante de protocolo de registro no RTDPJ -> "registro_publico"; senão, só o contrato particular -> "particular". Null se não houver nem contrato.',
          },
          indice_atualizacao: {
            type: 'string',
            enum: ['selic', 'ipca_2'],
            description:
              'Índice de correção. DERIVADO da natureza do crédito, não transcrito: natureza tributária -> "selic"; qualquer outra natureza -> "ipca_2". Nunca null — "não tributário" é o caso geral.',
          },
        },
        required: [
          ...Object.keys(CAMPOS),
          'tipo_credito',
          'instrumento',
          'indice_atualizacao',
        ],
      },
      procedencia: {
        type: 'object',
        description:
          'Para cada campo preenchido, o NOME DO ARQUIVO de onde saiu o valor. Campo nulo não entra aqui.',
        additionalProperties: { type: 'string' },
      },
      observacoes: {
        type: 'array',
        maxItems: 4,
        items: { type: 'string' },
        description:
          'Só o que muda o que a pessoa vai fazer antes de salvar: a composição do capital investido (sempre, e como primeiro item), contradição entre documentos, valor que apareceu de duas formas, mais de um cessionário. Uma linha curta por assunto, no máximo 15 palavras, no máximo 4 no total. Vazio se não houver nada a conferir.',
      },
    },
    required: ['campos', 'procedencia', 'observacoes'],
  },
}

const SISTEMA = `Você lê documentos de uma operação de compra de crédito judicial (precatório ou RPV) e extrai os campos do cadastro.

REGRAS, em ordem de importância:

1. NÃO INVENTE. Campo que os documentos não sustentam vem null. É melhor deixar em branco para a pessoa preencher do que entregar um valor plausível e errado — quem revisa confia no que está preenchido.

2. DIGA DE ONDE TIROU. Todo campo preenchido precisa do nome do arquivo em "procedencia". Sem isso a pessoa não tem como conferir. Valor que você compôs de mais de um arquivo leva os nomes dos arquivos separados por " + ": é o caso do capital investido, e ver os três nomes ali é como a pessoa confere a soma.

3. NÃO CONTRADIGA O QUE JÁ SE SABE. O contexto informa número do processo, cedente, originador e espécie, lidos da estrutura de pastas do Drive — são certeza, não sugestão. Se um documento discordar, mantenha o do contexto e escreva a divergência em "observacoes".

4. A PLANILHA DE ANÁLISE é a fonte mais confiável para tribunal, valor de face, entidade devedora, data de referência, tipo de crédito, expectativa de liquidação e advogado do cedente. Ela vem como "Aba!Célula: valor". Existem DOIS modelos, um para RPV e outro para precatório, então o endereço da célula é pista, não garantia — confira sempre o rótulo escrito ao lado antes de usar um valor.

5. QUEM É QUEM. Todo campo de nome errado desta extração vem de trocar um papel por outro, e os papéis são quatro:
   - CEDENTE: quem tinha o crédito e o vendeu. Vem no contexto, com certeza.
   - CESSIONÁRIA: quem comprou. Assina o contrato de cessão do lado do comprador.
   - ADVOGADO DO CEDENTE: quem representa QUEM VENDEU.
   - ORIGINADOR: quem apresentou o negócio. Vem no contexto, e não é parte da cessão nem advogado de ninguém — nunca o escreva em campo de parte.
   O ERRO A EVITAR NO ADVOGADO DO CEDENTE é preencher com o advogado da CESSIONÁRIA. Ele aparece muito nos documentos que você está lendo — assina o contrato de cessão, procura o tribunal depois da cessão, aparece na procuração da compradora — e por isso é o nome errado mais disponível. Também não serve o procurador do ente devedor, nem o tabelião da escritura, nem o juiz.
   COMO ACERTAR, nesta ordem: (a) a linha "Nome do advogado ou escritório de advocacia e CPF/CNPJ" da aba de análise jurídica da planilha — essa linha fala do cedente por definição, e é a resposta; (b) não havendo, o advogado que atua pela parte AUTORA/exequente no cabeçalho do processo, porque o exequente é o cedente; (c) não havendo nenhum dos dois, null. Antes de gravar, faça a pergunta: este nome atua por quem VENDEU? Se atua por quem comprou, está errado e o campo é null.

6. CAPITAL INVESTIDO É UMA SOMA, e confundi-lo com o preço da cessão é o erro mais frequente desta extração.
   - VALOR DE FACE: valor bruto do requisitório, o que o tribunal vai pagar.
   - CAPITAL INVESTIDO: tudo o que a cessionária DESEMBOLSOU para adquirir o crédito, isto é, preço da cessão + comissões + emolumentos.
   O preço da cessão é só a parcela que o CEDENTE recebeu. Sozinho, ele NÃO é o capital investido, e preenchê-lo aqui produz um custo menor que o real — o que faz a operação parecer mais rentável do que foi.
   ONDE ESTÃO AS PARCELAS. Nos três lugares, e você soma o que achar:
     a) planilha de análise de crédito — linhas de comissão, emolumentos, custos, despesas;
     b) contrato de cessão — cláusula da comissão do originador e de quem paga os emolumentos de escritura e registro;
     c) comprovantes de pagamento — as transferências efetivamente feitas: o preço vai para o cedente, a comissão para o originador, os emolumentos para o tabelionato ou o registro.
   TOTAL JÁ SOMADO TEM PRECEDÊNCIA. Se algum documento traz "total investido", "custo total" ou "total desembolsado", use esse número e NÃO some as parcelas por cima — somar duas vezes é pior que não somar.
   NÃO ACHOU AS PARCELAS? Deixe capital_investido NULL e escreva em "observacoes" o preço da cessão que você encontrou, para a pessoa somar à mão: "Preço da cessão 90.000; comissões e emolumentos não localizados". Aqui a regra 1 vale com força redobrada: um número plausível é pior que branco, porque parece o custo, passa pela conferência e não é o custo.
   E diga em "observacoes" o que compôs o valor sempre que você tiver somado: "Capital = 90.000 de preço + 4.500 de comissão + 820 de emolumentos".

7. INSTRUMENTO se decide pelo que EXISTE NA PASTA, nesta ordem exata — é a primeira condição satisfeita que vale, não a mais recente nem a mais parecida:
   a) há escritura pública lavrada em tabelionato de notas -> "escritura_publica";
   b) não há escritura, mas há comprovante de protocolo de pedido de registro no RTDPJ (Registro de Títulos e Documentos / Pessoas Jurídicas) -> "registro_publico". O NÚMERO DO RTDPJ está dentro desse comprovante: transcreva-o em "numero_rtdpj";
   c) só há o contrato particular de cessão, sem escritura e sem comprovante de registro -> "particular".
   Contrato particular que MENCIONA a intenção de registrar não basta para (b): é preciso o comprovante do protocolo. Se você viu a menção mas não achou o comprovante, marque "particular" e escreva isso em "observacoes".

8. ÍNDICE DE ATUALIZAÇÃO não se lê, se conclui — e é a única exceção à regra 1, porque nunca vem null:
   - crédito de natureza TRIBUTÁRIA (repetição de indébito, restituição ou compensação de tributo, exclusão de tributo da base de cálculo, execução fiscal invertida) -> "selic";
   - qualquer outra natureza (servidor público, indenização, desapropriação, previdenciário, honorários, aluguel, fornecedor) -> "ipca_2".
   Não havendo como identificar a natureza nos documentos, use "ipca_2", que é o caso geral, e diga em "observacoes" que a natureza não ficou clara.

9. AVISO CURTO. "observacoes" tem no máximo quatro itens, um por assunto, até quinze palavras cada. Escreva o que a pessoa precisa CONFERIR ou DECIDIR, não o que você fez nem o que já está preenchido. "Valor de face: 120.000,55 no contrato, 118.300,00 na planilha" serve. "Analisei os documentos e identifiquei que o valor de face..." não serve.
   UMA EXCEÇÃO, e é o que você fez: a composição do capital investido (regra 6) entra sempre, e entra primeiro, porque é a conta que a pessoa mais precisa checar. O quarto item existe para ela não empurrar um aviso de verdade para fora.

10. CADA CAMPO DIZ UMA COISA SÓ e não repete o que já está em outro. Tribunal, comarca e vara descrevem o MESMO juízo em três níveis, então cada um fica com o seu nível: TRT-2 / São Paulo / 32ª Vara do Trabalho. O erro mais comum é a vara vir com a localidade colada, como está escrito na petição — corte a localidade, ela já está na comarca.

11. Datas em AAAA-MM-DD. Dinheiro em número puro, sem "R$" e sem ponto de milhar: 120000.55.

12. NOME É SÓ NOME. A planilha escreve o nome junto com o documento, na mesma célula: "Tatiana Hiiga - CPF: 292.686.098-60", "Tedeschi de Amorim Sociedade Individual de Advocacia - CNPJ nº 29.799.354/0001-20". Grave apenas o nome da pessoa ou a razão social, cortando CPF, CNPJ, OAB e tudo o que vier depois. Isso vale para cedente, advogado do cedente e cessionário. A plataforma não tem campo para documento, e número colado no nome quebra a busca e a ligação com as fichas de dados bancários, que se faz pelo nome.

Responda apenas chamando a ferramenta.`

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const caller = await getCallerAtivo(req, serviceClient())
    if (!caller) return jsonResponse({ error: ERRO_ACESSO }, 401)

    const body = await req.json().catch(() => ({}))
    const documentos = (body.documentos ?? []) as {
      pasta?: string
      nome?: string
      texto?: string
    }[]
    if (!Array.isArray(documentos) || documentos.length === 0) {
      return jsonResponse(
        { error: 'Nenhum documento com texto foi enviado para leitura.' },
        400,
      )
    }

    const chave = await chaveAnthropic()
    if (!chave) {
      return jsonResponse(
        { error: 'Chave da Anthropic não configurada. Veja Configurações → Anthropic.' },
        500,
      )
    }

    const ctx = (body.contexto ?? {}) as Record<string, unknown>
    const contexto = [
      `Número do processo: ${ctx.numero_cnj ?? '(não informado)'}`,
      `Cedente (da pasta): ${ctx.cedente ?? '(não informado)'}`,
      `Originador: ${ctx.originador ?? '(não informado)'}`,
      `Espécie: ${ctx.especie_requisitorio === 'precatorio' ? 'precatório' : 'RPV'}`,
    ].join('\n')

    const corpo = documentos
      .map(
        (d) =>
          `\n===== ARQUIVO: ${d.nome ?? 'sem nome'}  (pasta: ${d.pasta ?? '?'}) =====\n${
            d.texto ?? ''
          }`,
      )
      .join('\n')

    const anthropic = new Anthropic({ apiKey: chave })
    const r = await anthropic.messages.create({
      model: MODELO,
      max_tokens: 4000,
      system: [{ type: 'text', text: SISTEMA, cache_control: { type: 'ephemeral' } }],
      tools: [FERRAMENTA],
      // Ferramenta FORÇADA e sem `thinking`: a API não aceita os dois juntos —
      // tool_choice de tipo 'tool' exige raciocínio desligado. Mesmo par que a
      // carteira-resumo e a peticao-ia já usam.
      tool_choice: { type: 'tool', name: FERRAMENTA.name },
      messages: [
        {
          role: 'user',
          content: `O que já se sabe com certeza (da estrutura de pastas):\n${contexto}\n\nDocumentos:\n${corpo}`,
        },
      ],
    })

    const uso = r.content.find((c) => c.type === 'tool_use')
    if (!uso || uso.type !== 'tool_use') {
      return jsonResponse({ error: 'O modelo não devolveu os campos.' }, 502)
    }
    const saida = uso.input as {
      campos?: Record<string, unknown>
      procedencia?: Record<string, string>
      observacoes?: string[]
    }

    return jsonResponse({
      ok: true,
      campos: saida.campos ?? {},
      procedencia: saida.procedencia ?? {},
      observacoes: saida.observacoes ?? [],
      lidos: documentos.map((d) => d.nome ?? '?'),
    })
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500)
  }
})
