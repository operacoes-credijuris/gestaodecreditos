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
import { ESQUEMA_DA_EXTRACAO, saidaDaExtracao } from '../_shared/extracaoDoCredito.ts'
import {
  lerSaidaEstruturada,
  type NoFormatoDoOpus,
} from '../_shared/respostaDoClaude.ts'

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
const MODELO = 'claude-opus-5-5'

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

Responda só com o JSON do formato pedido, sem texto antes ou depois.`

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
      // 16000, e não os 4000 de antes: no Opus 5.5 o raciocínio está sempre
      // ligado e conta DENTRO deste teto. Com 4000 ele podia comer o espaço do
      // JSON, que então sai cortado. (Abaixo de ~21 mil, o SDK aceita sem
      // streaming.)
      max_tokens: 16000,
      system: [{ type: 'text', text: SISTEMA, cache_control: { type: 'ephemeral' } }],
      // SAÍDA ESTRUTURADA no lugar da ferramenta forçada, que o Opus 5.5 recusa
      // (400). O JSON volta no bloco de texto, seguindo o esquema — ver
      // _shared/extracaoDoCredito.ts. Esforço 'high', o padrão do Opus 5: o
      // do 5.5 é 'medium', e omitir seria rebaixar a leitura sem decidir.
      output_config: {
        // 'medium': extração de campos, que no Opus 5 rodava sem raciocínio
        // nenhum; 'high' só alongaria a espera de quem escolheu a pasta.
        effort: 'medium',
        format: { type: 'json_schema', schema: ESQUEMA_DA_EXTRACAO },
      },
      messages: [
        {
          role: 'user',
          content: `O que já se sabe com certeza (da estrutura de pastas):\n${contexto}\n\nDocumentos:\n${corpo}`,
        },
      ],
    } satisfies NoFormatoDoOpus<Anthropic.MessageCreateParamsNonStreaming>)

    const lida = lerSaidaEstruturada(r)
    if (!lida.ok) {
      const motivo = {
        recusa: 'O modelo recusou a leitura destes documentos (filtro de segurança da Anthropic).',
        cortada: 'A resposta do modelo saiu cortada por tamanho. Tente com menos documentos.',
        vazia: 'O modelo não devolveu os campos.',
        invalida: 'O modelo não devolveu os campos num formato legível.',
      }[lida.motivo]
      return jsonResponse({ error: motivo }, 502)
    }
    const saida = saidaDaExtracao(lida.valor)

    return jsonResponse({
      ok: true,
      campos: saida.campos,
      procedencia: saida.procedencia,
      observacoes: saida.observacoes,
      lidos: documentos.map((d) => d.nome ?? '?'),
    })
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500)
  }
})
