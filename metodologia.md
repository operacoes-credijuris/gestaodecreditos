# Metodologia da Inteligência Econômica

Documentação para auditar qualquer número que o módulo exibe: de onde vem o
dado, qual a fórmula, o que é excluído e por quê.

Toda a implementação está em `supabase/functions/_shared/nucleo/`. Telas,
planilha e assistente chamam as mesmas funções — não existe segunda versão de
nenhum cálculo.

---

## 1. Origem dos dados

| Conceito | Coluna |
|---|---|
| Operação | `public.processos` — processo e operação são a mesma linha |
| Data da compra | `data_aquisicao` |
| Data-base do cálculo | `data_referencia` |
| Previsão de pagamento | `expectativa_liquidacao` |
| Pagamento efetivo | `data_liquidacao` |
| Capital investido | `capital_investido` |
| Valor de face | `valor_face` |
| Valor recebido | `ja_recebido` |
| Complemento a receber | `valor_estimado_complementar` |
| Índice de correção | `indice_atualizacao` (`selic` \| `ipca_2`) |
| Tribunal / ente / investidor | `tribunal`, `entidade_devedora`, `cessionario` — texto livre |
| Taxas vigentes | `public.parametros_atualizacao`, linha `id = 1` |
| Histórico de previsões | `public.processos_historico` (migration `0030`) |

`tribunal`, `entidade_devedora` e `cessionario` **não têm normalização no
banco**. O módulo aplica `trim()` na leitura porque a base já continha
`"Município de Goiânia"` convivendo com a mesma grafia terminada em
**tabulação**, contadas como dois entes. Atenção: `btrim()` do Postgres sem
segundo argumento **não** remove tabulação.

## 2. As três populações

| População | Critério | Uso |
|---|---|---|
| **Encerrada** | `status = 'encerrado'` **e** `data_aquisicao`, `data_liquidacao`, `capital_investido > 0`, `ja_recebido > 0` | Única elegível para performance realizada |
| **Realização parcial** | `status = 'complementar'` | Exibida em separado, fora de toda métrica de performance |
| **Aberta** | `data_liquidacao` nula | Forecast e projeção de valor |

**Por que `complementar` fica fora.** Essas operações receberam o principal e
aguardam complemento. Calcular `ja_recebido / capital − 1` nelas divide um
numerador incompleto por um denominador completo. O erro é sistemático e sempre
para baixo. Medido na carteira de 11/08/2026: incluí-las derrubaria a
rentabilidade ponderada de **34,61% para 27,27%**.

**Dado ausente nunca vira zero.** Operação sem o campo necessário fica fora do
numerador **e** do denominador, e o número de exclusões é publicado em toda
métrica. Entrar com zero afirmaria resultado zero onde o que falta é cadastro.

## 3. Fórmulas por operação

Implementadas em `nucleo/projecao.ts`, herdadas da plataforma sem alteração.

```
valor projetado (em aberto) = valor_face × (1 + i × anos)
valor projetado (liquidada) = ja_recebido
ganho                        = (valor + complementar) − capital_investido
rentabilidade total          = ganho / capital_investido
prazo efetivo                = data_liquidacao − data_aquisicao
rentabilidade anualizada     = (valor / capital_investido)^(365 / prazo) − 1
```

`i` é SELIC ou IPCA+2%, conforme `indice_atualizacao`. `anos` conta de
`data_referencia` até a data prevista — ou até **hoje**, quando a previsão já
venceu.

### Três decisões herdadas, mantidas de propósito

| Decisão | Efeito | Por que manter |
|---|---|---|
| Projeção por juros **simples** (`1 + i × anos`), enquanto a rentabilidade anualizada usa composta | A projeção erra para baixo em prazos acima de 1 ano | Escolha de produto documentada no código: é o lado seguro de errar num número mostrado a investidor. Alterar mudaria valores já entregues |
| **IPCA + 2% por soma** (4,50 + 2 = 6,50, não 6,59) | Diferença de 0,09 ponto | Convenção do produto |
| Previsão vencida corrige **até hoje** | Crédito atrasado continua se valorizando | O tempo correu de fato. Parar na data vencida congelaria justamente os créditos mais lentos |

### Limite conhecido da anualização

A fórmula pressupõe **um** desembolso e **uma** entrada. Vale para as
encerradas. Quando uma operação `complementar` receber o complemento, o cálculo
correto passa a ser XIRR sobre o fluxo real — possível a partir do momento em
que `processos_historico` registrar as duas datas e os dois valores.

### Inconsistência conhecida, não corrigida

`retorno()` inclui `valor_estimado_complementar` no ganho; `tir()` não, porque
usa o valor projetado, que numa operação liquidada é `ja_recebido` puro. Os dois
aparecem lado a lado na tela respondendo a definições diferentes. **31 operações
afetadas**; alinhá-los subiria a mediana da rentabilidade anualizada em cerca de
53 pontos percentuais. É decisão de produto, e alterá-la muda números já
exibidos.

## 4. Agregação: as duas leituras

Toda métrica agregada sai em duas formas que **nunca se substituem**:

```
operação típica          = mediana das rentabilidades individuais
comportamento do capital = Σ ganhos / Σ capitais
```

Quando divergem, a divergência é a informação. Escolher uma seria enganoso nos
dois sentidos.

Publicado em todo recorte: `n` · capital · % do capital · média · mediana ·
ponderada · p10/p25/p75/p90 · mínimo/máximo · desvio-padrão · IQR · prazo médio
e mediano · anualizada · classe de representatividade · **quantas operações
ficaram de fora e por quê**.

Percentis por **interpolação linear** — mesma convenção do `percentile_cont` do
Postgres, para que tela, planilha e conferência no SQL Editor batam.

### Rentabilidade agregada da carteira

`(Σ valor / Σ capital)^(365 / prazo médio ponderado pelo capital) − 1`.

É uma aproximação. A medida exata é a XIRR do fluxo consolidado. Medido nas 22
operações encerradas de 11/08/2026: **48,39% pela aproximação, 47,16% pela XIRR
exata — diferença de 1,23 ponto (2,5% relativo)**. A aproximação foi mantida
porque já alimenta números entregues a investidores e o erro é conservador
(reporta acima da exata).

**Nunca se tira média de taxas já anualizadas.** Um crédito liquidado em 12
dias, com ganho normal de 21,8%, produz taxa de 40.426% ao ano — correta para
ele. Na carteira real, a média das anualizadas dá **1.899,86%** contra mediana
de **42,38%**.

## 5. Representatividade

Seja B o número de observações abaixo da mediana verdadeira, `B ~ Binomial(n, ½)`.
O intervalo `[X_(r), X_(n+1−r)]` cobre a mediana com probabilidade
`1 − 2·P(B ≤ r−1)`.

| n | Intervalo de 95% | Largura |
|---|---|---|
| ≤ 5 | **não existe** | — |
| 6 | postos 1 a 6 | 100% |
| 10 | postos 2 a 9 | 80% |
| 12 | postos 3 a 10 | 67% |
| 20 | postos 6 a 15 | 50% |
| 22 | postos 6 a 17 | 55% |
| 30 | postos 10 a 21 | 40% |
| 54 | postos 20 a 35 | 30% |

**Com n ≤ 5 nenhum intervalo de 95% existe** — nem o que vai do menor ao maior
valor observado. A cobertura máxima possível é `1 − 2·2⁻ⁿ`, que em n=5 chega a
93,75%. Não é que o intervalo fique largo: ele não existe.

| Classe | n | O que a interface libera |
|---|---|---|
| Insuficiente | ≤ 5 | Exibe o número; bloqueia comparação, ranking e insight |
| Baixa | 6 – 11 | Exibe com aviso; fora de ranking |
| Moderada | 12 – 29 | Comparação permitida, com o intervalo visível |
| Alta | ≥ 30 | Comparação e ranking permitidos |

**Segundo eixo, obrigatório:** peso econômico (capital do grupo / capital total).
Nunca fundido com a classe estatística num índice único — um grupo pode ser
economicamente decisivo e estatisticamente mudo ao mesmo tempo. Por isso não
existe "Score 87/100" no módulo.

## 6. Comparação entre grupos

1. Só há comparação se **ambos** os grupos forem ao menos moderados (n ≥ 12).
2. A medida é a **diferença de medianas com intervalo** (Hodges-Lehmann,
   intervalo por bootstrap com semente fixa `20260811`), não p-valor: p-valor
   convida à leitura binária "significativo = melhor".
3. **Amostras nunca são equalizadas.** Sem subamostragem, sem reponderação.
4. Ranking exige todos em classe alta (n ≥ 30). Quem não atinge aparece numa
   lista separada — visível, não escondido.

Semente fixa: o mesmo dado produz sempre o mesmo intervalo. É requisito de
auditabilidade.

## 7. Extremos

Regra do IQR: fora de `[p25 − 1,5×IQR ; p75 + 1,5×IQR]`.

**Marcados, nunca removidos** de nenhum cálculo publicado. Um resultado extremo
pode ser um evento econômico real. A visualização "sem extremos", quando
existir, é rotulada como visualização e não altera número publicado.

Na carteira de 11/08/2026 a rentabilidade total **não tem nenhum extremo** (as
22 encerradas ficam entre 13,99% e 54,24%). Os extremos aparecem só na
rentabilidade anualizada, e são inteiramente artefato de prazo curto — por isso
a interface sempre exibe o prazo ao lado dela.

## 8. Faixas de valor

Quartis **observados** de `capital_investido`, recalculados a cada carga. Nunca
valores fixos.

Quando a razão p90/p10 fica abaixo de 3×, a interface avisa que a carteira é
homogênea em tamanho e o recorte dificilmente revela comportamento distinto. Em
11/08/2026 essa razão era de **2,2×**.

## 9. Safras

**Não se compara resultado final.** Compara-se cada safra **na mesma idade**:
percentual do capital devolvido até *m* meses após a aquisição, contando em cada
idade apenas as operações que já tiveram tempo de chegar lá. Todas as curvas são
truncadas na idade máxima da safra mais nova.

Isso não atenua o viés de sobrevivência — elimina. Sem ele, "a safra nova paga
mais rápido" seria apenas o efeito de que só as operações rápidas tiveram tempo
de encerrar.

A taxa de encerramento de cada safra é exibida ao lado, sempre.

## 10. Forecast

**Fase 1 — nominal (ativa).** Soma do valor projetado das operações abertas,
agrupada pelo mês da previsão. Três blocos ficam **fora do eixo do tempo**:
previsão vencida, sem previsão, e complementar a receber. Distribuí-los em meses
futuros seria atribuir uma data que ninguém estimou.

**Fase 2 — ajustada (bloqueada).** Exige **30 pares** (previsão → pagamento) com
histórico completo. Em 11/08/2026 havia 13, todos anteriores à implantação do
histórico. Até lá a interface diz isso, em vez de exibir número inventado.

Método quando liberada: deslocar cada data prevista pelo desvio mediano
observado (cenário mediano) e pelo percentil 75 (cenário conservador). **Nunca
um ponto único** — um número sem intervalo é falsa precisão.

## 11. Anomalias

Duas naturezas, rotuladas de forma diferente:

- **Impossibilidade lógica** — o dado se contradiz. É erro.
- **Sinal estatístico** — o dado é atípico. Pode ser um evento real.

Todo achado sai como *"Possível inconsistência — requer revisão"*. **Nada é
alterado automaticamente**, em nenhuma hipótese.

Regra que **não** existe, de propósito: "data-base anterior à aquisição". A
data-base do cálculo homologado é, por natureza, anterior à compra — na carteira
real a defasagem mediana é de 259 dias. Marcá-la acusaria quase toda a carteira.

Os cortes de 90 e 180 dias em previsão vencida são **convenção operacional
declarada**, não limiar estatístico: com 13 observações de desvio não há base
para derivá-los dos dados, e fingir que há seria pior.

## 12. Insights

**Gerados por regra determinística, nunca por texto livre de modelo.** Cada um é
um template preenchido com números já calculados. O assistente pode *explicar*
um insight; não pode inventá-lo.

Todo insight carrega `n` e, quando cabe, participação no capital. **Insight
sobre grupo em classe insuficiente não é gerado** — nem com ressalva, porque
ressalva em texto curto não é lida.

## 13. Histórico de previsões

`public.processos_historico`, alimentada pelo gatilho
`trg_processos_historico` (`AFTER INSERT OR UPDATE` em `processos`). Monitora
`expectativa_liquidacao`, `data_liquidacao`, `capital_investido`, `valor_face`,
`ja_recebido`, `valor_estimado_complementar`, `data_referencia`,
`indice_atualizacao` e `status`.

- Blindado com `exception when others`: falha no histórico **nunca** impede o
  usuário de salvar.
- Somente leitura para a aplicação: `INSERT`/`UPDATE`/`DELETE` revogados. Só o
  gatilho escreve.
- Edição de campo não monitorado (vara, comarca, advogado) não gera registro.

**Duas populações que nunca se somam.** Operações cadastradas antes da
implantação têm como marco inicial o estado de 11/08/2026, não a previsão de
origem — tudo o que mudou antes disso foi perdido de forma irrecuperável, antes
deste módulo. O registro traz
`contexto->>'evento' = 'implantacao_do_modulo'` para marcar a diferença no
próprio dado.

## 14. Limitações declaradas

1. **Carteira monotribunal.** 91,6% TJGO, 87,4% Estado de Goiás. Não há
   comparação entre tribunais ou entes possível.
2. **22 operações encerradas** sustentam toda a performance realizada.
3. **Tribunal e ente são texto livre**, sem normalização no banco.
4. **O histórico de previsões começa em 2026.** Nada anterior é recuperável.
5. **13 de 54 operações pagas** têm previsão registrada para comparação.
6. **`originador` está vazio** em 95 de 95 registros.
7. **21 investidores para 95 operações** — quase todo recorte por investidor cai
   em classe insuficiente.
8. **A projeção depende de dois parâmetros manuais** (SELIC e IPCA em
   `parametros_atualizacao`). Desatualizados, todo valor projetado desvia junto.
   A data-base deles é exibida na Visão Geral.

## 15. Performance técnica

Nenhuma materialized view, nenhum cache, nenhum índice novo. Com 95 operações o
Postgres varre a tabela mais rápido do que consultaria um índice, e o cálculo
inteiro roda no cliente em milissegundos.

**Gatilho para revisitar:** cerca de 5.000 operações, ou qualquer consulta acima
de 300 ms.

## 16. Testes

`npm test` — 138 testes em `src/lib/__tests__/`.

Cobrem os casos exigidos: uma operação · muitas · muito pequena · muito grande ·
o extremo de 12 dias · prazo curto · prazo longo · valores iguais · ausência de
data · ausência de valor · operação aberta · encerrada · `complementar` · grupos
de tamanhos muito diferentes (87 × 2) · grupo com n=1 · grupo vazio.

Os testes ficam em `src/`, **nunca** em `supabase/functions/`: o CI roda
`deno check --node-modules-dir=none supabase/functions` sem instalar
`node_modules`, e um import de `vitest` ali quebraria o deploy das Edge
Functions.
