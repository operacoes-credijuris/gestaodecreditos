// A extração dos campos do cadastro de um crédito (Edge Function
// `extrair-credito`): o que se pede ao modelo, no formato de SAÍDA ESTRUTURADA,
// e a tradução do que ele devolve para o formato que a tela já espera. Puro:
// a função e os testes importam daqui.
//
// SAÍDA ESTRUTURADA, E NÃO MAIS FERRAMENTA FORÇADA (05/10/2026). No Opus 5 a
// resposta vinha por `tool_choice: {type: 'tool'}`; o Opus 5.5 recusa
// ferramenta forçada (400). A ferramenta só existia para trazer JSON de volta,
// e para isso a API tem `output_config.format` com esquema: o JSON vem no bloco
// de texto e SEGUE o esquema — garantia mais forte que a da ferramenta, cujo
// esquema não era conferido. O preço é o esquema caber no subconjunto aceito:
// todo objeto com `additionalProperties: false`, sem `maxItems`, sem objeto de
// chaves livres, no máximo 16 campos com tipo em união.

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
export const CAMPOS_DO_CREDITO = {
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

export type CampoDoCredito = keyof typeof CAMPOS_DO_CREDITO | 'tipo_credito' | 'instrumento' | 'indice_atualizacao'

/** Os campos que levam número; o resto é texto. */
const NUMERICOS = new Set<string>(['valor_face', 'capital_investido'])

/** Todos os campos, na ordem do esquema — os que têm procedência. */
export const CHAVES_DO_CREDITO: readonly CampoDoCredito[] = [
  ...(Object.keys(CAMPOS_DO_CREDITO) as (keyof typeof CAMPOS_DO_CREDITO)[]),
  'tipo_credito',
  'instrumento',
  'indice_atualizacao',
]

/**
 * O esquema da resposta.
 *
 * DUAS DIFERENÇAS do que era o esquema da ferramenta, as duas forçadas pelo
 * subconjunto de JSON Schema que a saída estruturada aceita:
 *
 *   - PROCEDÊNCIA vira LISTA de {campo, arquivo}. Antes era um objeto de chaves
 *     livres (`additionalProperties: {type: 'string'}`), que o esquema não
 *     aceita; e um objeto com cada campo anulável estouraria o limite de 16
 *     uniões (os campos já usam 15). `saidaDaExtracao` devolve o objeto de
 *     antes, e a tela não percebe a troca.
 *   - OBSERVAÇÕES perdem o `maxItems: 4`, que o esquema não aceita. O limite
 *     continua na descrição e na regra 9 do prompt — onde ele sempre valeu: o
 *     esquema da ferramenta também não era conferido.
 */
export const ESQUEMA_DA_EXTRACAO = {
  type: 'object',
  additionalProperties: false,
  properties: {
    campos: {
      type: 'object',
      additionalProperties: false,
      description: 'Campo não encontrado nos documentos deve vir null.',
      properties: {
        ...Object.fromEntries(
          Object.entries(CAMPOS_DO_CREDITO).map(([k, d]) => [
            k,
            NUMERICOS.has(k)
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
      required: [...CHAVES_DO_CREDITO],
    },
    procedencia: {
      type: 'array',
      description:
        'Para cada campo preenchido, um item com o campo e o NOME DO ARQUIVO de onde saiu o valor. Campo nulo não entra aqui.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          campo: { type: 'string', enum: [...CHAVES_DO_CREDITO] },
          arquivo: {
            type: 'string',
            description:
              'Nome do arquivo. Valor composto de mais de um arquivo: os nomes separados por " + ".',
          },
        },
        required: ['campo', 'arquivo'],
      },
    },
    observacoes: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Só o que muda o que a pessoa vai fazer antes de salvar: a composição do capital investido (sempre, e como primeiro item), contradição entre documentos, valor que apareceu de duas formas, mais de um cessionário. Uma linha curta por assunto, no máximo 15 palavras, no máximo 4 itens no total. Vazio se não houver nada a conferir.',
    },
  },
  required: ['campos', 'procedencia', 'observacoes'],
} as const

/** O que a tela recebe — o MESMO formato de quando a resposta vinha pela ferramenta. */
export interface SaidaDaExtracao {
  campos: Record<string, unknown>
  procedencia: Record<string, string>
  observacoes: string[]
}

/**
 * Traduz a resposta do modelo para o formato de sempre: a procedência volta a
 * ser `{campo: arquivo}`. Tolerante a falta (o esquema garante a forma, mas a
 * leitura não confia nisso para não derrubar a tela).
 */
export function saidaDaExtracao(bruto: unknown): SaidaDaExtracao {
  const r = (bruto && typeof bruto === 'object' ? bruto : {}) as {
    campos?: unknown
    procedencia?: unknown
    observacoes?: unknown
  }
  const procedencia: Record<string, string> = {}
  if (Array.isArray(r.procedencia)) {
    for (const p of r.procedencia as { campo?: unknown; arquivo?: unknown }[]) {
      if (typeof p?.campo !== 'string' || typeof p.arquivo !== 'string' || !p.arquivo.trim()) continue
      // O mesmo campo duas vezes: os arquivos se somam, como no valor composto.
      procedencia[p.campo] = procedencia[p.campo] ? `${procedencia[p.campo]} + ${p.arquivo}` : p.arquivo
    }
  }
  return {
    campos: r.campos && typeof r.campos === 'object' && !Array.isArray(r.campos)
      ? (r.campos as Record<string, unknown>)
      : {},
    procedencia,
    observacoes: Array.isArray(r.observacoes)
      ? r.observacoes.filter((o): o is string => typeof o === 'string')
      : [],
  }
}
