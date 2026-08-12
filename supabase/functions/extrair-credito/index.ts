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

const MODELO = 'claude-sonnet-5'

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
 * Fica de fora só o índice de atualização, que é escolha de negócio e não consta de
 * documento nenhum. Também ficam de fora espécie, originador, número do processo e
 * cedente: esses vêm do CAMINHO da pasta no Drive, com certeza total, e pedir à IA
 * seria trocar certeza por palpite.
 *
 * INSTRUMENTO e Nº RTDPJ entraram depois. Pareciam manuais até o dono explicar que
 * a resposta está na pasta: escritura pública, ou comprovante de protocolo de
 * registro no RTDPJ (que traz o número dentro), ou nada além do contrato
 * particular. É decisão por PRESENÇA de documento, com ordem de precedência — está
 * escrita na regra 7 do prompt.
 */
const CAMPOS = {
  tribunal: 'Sigla ou nome do tribunal (ex.: TJGO, TRF1). Do processo, não do contrato.',
  comarca: 'Comarca ou seção judiciária.',
  vara: 'Vara, juizado ou órgão julgador, como escrito no processo.',
  cedente: 'Nome do credor original — quem cedeu o crédito.',
  cedente_advogado: 'Nome do advogado que representa o cedente no processo.',
  entidade_devedora: 'Ente público devedor (Estado, Município, União, autarquia).',
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
    'Valor que a cessionária PAGOU pelo crédito, em reais, número puro. É o preço da cessão, sempre menor que o valor de face.',
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
        },
        required: [...Object.keys(CAMPOS), 'tipo_credito', 'instrumento'],
      },
      procedencia: {
        type: 'object',
        description:
          'Para cada campo preenchido, o NOME DO ARQUIVO de onde saiu o valor. Campo nulo não entra aqui.',
        additionalProperties: { type: 'string' },
      },
      observacoes: {
        type: 'array',
        items: { type: 'string' },
        description:
          'O que a pessoa precisa saber antes de salvar: contradição entre documentos, valor que apareceu de duas formas, contrato que menciona mais de um cessionário. Vazio se não houver.',
      },
    },
    required: ['campos', 'procedencia', 'observacoes'],
  },
}

const SISTEMA = `Você lê documentos de uma operação de compra de crédito judicial (precatório ou RPV) e extrai os campos do cadastro.

REGRAS, em ordem de importância:

1. NÃO INVENTE. Campo que os documentos não sustentam vem null. É melhor deixar em branco para a pessoa preencher do que entregar um valor plausível e errado — quem revisa confia no que está preenchido.

2. DIGA DE ONDE TIROU. Todo campo preenchido precisa do nome do arquivo em "procedencia". Sem isso a pessoa não tem como conferir.

3. NÃO CONTRADIGA O QUE JÁ SE SABE. O contexto informa número do processo, cedente, originador e espécie, lidos da estrutura de pastas do Drive — são certeza, não sugestão. Se um documento discordar, mantenha o do contexto e escreva a divergência em "observacoes".

4. A PLANILHA DE ANÁLISE é a fonte mais confiável para tribunal, valor de face, entidade devedora, data de referência, tipo de crédito e expectativa de liquidação. Ela vem como "Aba!Célula: valor". Existem DOIS modelos, um para RPV e outro para precatório, então o endereço da célula é pista, não garantia — confira sempre o rótulo escrito ao lado antes de usar um valor.

5. O CONTRATO DE CESSÃO é a fonte para cessionário, data de aquisição e capital investido. Cuidado para não trocar cedente por cessionário: o cedente é quem tinha o crédito, o cessionário é quem comprou.

6. VALOR DE FACE é o valor bruto do requisitório. CAPITAL INVESTIDO é o preço pago pela cessão, sempre menor. Se você só encontrar um número, decida qual dos dois é pelo contexto e explique em "observacoes".

7. INSTRUMENTO se decide pelo que EXISTE NA PASTA, nesta ordem exata — é a primeira condição satisfeita que vale, não a mais recente nem a mais parecida:
   a) há escritura pública lavrada em tabelionato de notas -> "escritura_publica";
   b) não há escritura, mas há comprovante de protocolo de pedido de registro no RTDPJ (Registro de Títulos e Documentos / Pessoas Jurídicas) -> "registro_publico". O NÚMERO DO RTDPJ está dentro desse comprovante: transcreva-o em "numero_rtdpj";
   c) só há o contrato particular de cessão, sem escritura e sem comprovante de registro -> "particular".
   Contrato particular que MENCIONA a intenção de registrar não basta para (b): é preciso o comprovante do protocolo. Se você viu a menção mas não achou o comprovante, marque "particular" e escreva isso em "observacoes".

7. Datas em AAAA-MM-DD. Dinheiro em número puro, sem "R$" e sem ponto de milhar: 120000.55.

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
