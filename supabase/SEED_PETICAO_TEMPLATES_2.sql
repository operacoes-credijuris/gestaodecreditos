-- Carga inicial dos modelos de petição — parte 2: os dois longos.
--
-- Separados do primeiro arquivo por tamanho: homologação de cessão de RPV e RPV
-- complementar têm seis e duas seções numeradas, com fundamentação e ementas do
-- STF. Juntos com os outros oito, o comando ficaria impossível de revisar antes
-- de rodar — e é texto que vai a juízo.
--
-- Rode DEPOIS do SEED_PETICAO_TEMPLATES.sql. Mesmas regras: conteúdo em
-- markdown, conflito pelo drive_file_id, reexecutável (sobrescreve edições
-- feitas na plataforma).

insert into public.peticao_templates (nome, palavras_chave, conteudo, drive_file_id)
values
-- ---------------------------------------------------------------------------
(
  'Homologação de cessão de crédito de RPV',
  array['homologação','homologar cessão','homologação de cessão','substituição do polo ativo'],
  $md$**AO JUÍZO DE DIREITO DO(A) [ENDEREÇAMENTO DO JUÍZO]**

**Processo n°: [NÚMERO DO PROCESSO]**

**[NOME DO CESSIONÁRIO]**, [QUALIFICAÇÃO DO CESSIONÁRIO], vem respeitosamente, por intermédio de seu procurador *in fine* assinado, manifestar nos seguintes termos.

**I - DISPENSA DE ANUÊNCIA DA PARTE EXECUTADA PARA HOMOLOGAÇÃO DA CESSÃO DE CRÉDITO - ART. 290 DO CC/02**

Em verdade, a homologação da cessão de crédito visa unicamente à produção de efeitos jurídicos *inter partes* e perante o devedor cedido, **sendo suficiente, para a eficácia em relação a este, a mera cientificação acerca da cessão operada, nos termos do art. 290 do Código Civil de 2002**.

Em outras palavras, **a notificação do devedor em casos de cessão de crédito tem finalidade meramente informativa, servindo apenas para cientificá-lo acerca do novo titular da obrigação.** A anuência da parte executada não constitui requisito para a validade da cessão, tampouco para a substituição do credor nos autos. O Código de Processo Civil de 2015, em seu art. 778, §1º, inciso III, e §2º, reforça essa diretriz ao admitir expressamente a substituição do exequente pelo cessionário independentemente de concordância do devedor, sendo suficiente a comprovação da cessão e a sua ciência quanto ao novo beneficiário do crédito.

Dessa forma, solicita-se, desde já, a **dispensa da intimação da parte executada** tanto em relação a sua anuência à homologação da(s) cessão(ões) do(s) crédito(s) judicial(is) quanto ao pedido de regularização do polo ativo com a substituição do(s) credor(es) primitivo(s) pelo novo titular do(s) crédito(s) nos autos.

**Subsidiariamente,** em hipótese de eventual intimação da parte executada sobre a(s) cessão(ões) de crédito, sendo a anuência do devedor juridicamente dispensável para fins de homologação, **requer-se, cordialmente, que seja realizada com prazo de 05 (cinco) dias**, considerando tratar-se de ato de baixa complexidade, cujo único objetivo é dar ciência formal da(s) cessão(ões) de crédito celebrada(s).

**II - COMPROVAÇÃO DO ACORDO CELEBRADO E DA SUBSTITUIÇÃO DO POLO ATIVO**

Conforme se extrai dos documentos ora acostados, o(a) peticionário(a) celebrou contrato(s) oneroso(s) de cessão de crédito judicial referente ao presente feito, por meio do qual assumiu a titularidade plena de **[TIPO DE CRÉDITO]** decorrente do provimento jurisdicional exarado nestes autos, passando a figurar, assim, como legítimo(a) titular da integralidade do(s) crédito(s) objeto da presente demanda.

Referido(s) instrumento(s) contratual(is), ademais, estabeleceu(eram) obrigação expressa no sentido de que, após a assinatura do(s) contrato(s) por ambas as partes, deve-se peticionar nos autos do processo de referência, requerendo o deferimento da(s) cessão(ões) de crédito, com a juntada da íntegra do(s) contrato(s) devidamente subscrito(s) pelas partes.

Dessa forma, em atenção ao art. 778, §1º, III, do CPC/2015, e aos arts. 42 a 44 da Resolução CNJ nº 303/2019, aplicáveis ao caso por força de seu art. 50, III, requer-se o **deferimento da(s) cessão(ões) de crédito celebrada(s) e, via de consequência, da substituição processual no polo ativo**, bem como a cientificação da entidade devedora acerca da realização da(s) cessão(ões), nos termos do art. 44, §1º, da Resolução CNJ nº 303/2019.

Portanto, diante do exposto, requer-se a regularização do polo ativo, com a devida substituição da(s) parte(s) cedente(s) pelo novo titular do(s) crédito(s) judicial(is).

**III – DO REGISTRO DO(S) INSTRUMENTO(S) DE CESSÃO DE CRÉDITO PERANTE O REGISTRO DE TÍTULOS E DOCUMENTOS**

Visando conferir publicidade e oponibilidade a terceiros ao(s) negócio(s) jurídico(s) ora noticiado(s), o(a) peticionário(a) já promoveu a abertura do protocolo de registro do(s) instrumento(s) de cessão de crédito perante o competente Cartório de Registro de Títulos e Documentos, nos termos do art. 129, item 10º, da Lei nº 6.015/1973 (redação dada pela Lei nº 14.382/2022), cujo comprovante de protocolo segue anexo à presente manifestação.

O registro encontra-se em regular tramitação perante a serventia extrajudicial, pendente tão somente da conclusão do procedimento. Dessa forma, compromete-se o(a) peticionário(a) a carrear aos autos a respectiva certidão/instrumento devidamente registrado tão logo haja o retorno por parte do cartório, independentemente de nova intimação, **restando, desde já, demonstrada — por meio do protocolo anexo — a adoção das medidas tendentes à formalização e à publicidade da(s) cessão(ões) de crédito celebrada(s).**

**IV - NOVOS DADOS BANCÁRIOS EM RAZÃO DA CESSÃO DE CRÉDITO**

Homologada(s) a(s) cessão(ões) de crédito judicial nos presentes autos, cumpre esclarecer que, caso haja algum dado bancário anteriormente informado, este se encontra superado, uma vez que o(s) cedente(s) deixou(aram) de ostentar a titularidade do(s) crédito(s) ora executado(s).

Assim, eventual pagamento deverá observar exclusivamente os dados vinculados ao novo titular. Vide:

**[DADOS BANCÁRIOS DO CESSIONÁRIO/INVESTIDOR]**

Portanto, em atenção à regularidade da execução do(s) crédito(s), requer-se que sejam considerados os dados bancários do(a) cessionário(a) para fins de efetivação do pagamento.

**V – DA TROCA DE TITULARIDADE DO CRÉDITO NO ALVARÁ DE LEVANTAMENTO**

Em caso de Requisição(ões) de Pequeno Valor **já devidamente expedida(s) nos autos**, requer o(a) peticionário(a) que a **alteração da titularidade do(s) crédito(s) seja refletida exclusivamente no(s) alvará(s) de levantamento**, a ser(em) expedido(s) em favor do(a) cessionário(a), atual e legítima(o) titular do(s) crédito(s) judicial(is) reconhecido(s).

Tal providência revela-se juridicamente adequada e plenamente compatível com a fase procedimental em que se encontra o feito, não havendo qualquer necessidade de reemissão ou retificação da(s) RPV(s) já expedida(s), medida que apenas acarretaria atraso desnecessário na satisfação do(s) crédito(s).

Dessa forma, a limitação da alteração de titularidade ao(s) próprio(s) alvará(s) de levantamento prestigia os princípios da economia, da celeridade e da efetividade processual, assegurando que o pagamento seja direcionado ao(à) legítimo(a) titular do crédito, em estrita consonância com a realidade jurídica atualmente configurada nos autos, **sem qualquer prejuízo à regularidade do(s) requisitório(s) já expedido(s)**.

**VI - REQUERIMENTOS**

Diante de todo expostos e pelas razões consignadas, requer-se, cordialmente:

1. **Homologação da(s) cessão(ões) de crédito** celebrada(s) nestes autos, dispensada a anuência do executado, que deverá ser apenas intimado para ciência do(a) novo(a) credor(a) no prazo 05 (cinco) dias;
2. **Retificação do polo ativo**, com a substituição do(s) credor(es) originário(s) pelo(a) cessionário(a);
3. **Expedição de ofícios às unidades judiciárias** responsáveis pela expedição e pagamento da(s) RPV(s), a fim de que anotem a(s) cessão(ões) homologada(s) em seus sistemas internos e adotem as providências correlatas;
4. Em caso de RPV(s) já expedida(s), **a substituição da titularidade exclusivamente no(s) alvará(s) de levantamento**, a ser emitido em favor do(a) cessionário(a), contendo seus dados bancários, medida que assegura a economia e a celeridade processuais, dispensando-se qualquer retificação ou reemissão da(s) Requisição(ões) de Pequeno Valor já expedida(s) nos autos, uma vez que a alteração pretendida restringe-se à fase de levantamento do(s) numerário(s).

Neste termos, pede deferimento.
Belo Horizonte/MG, data da assinatura eletrônica.

**Pedro Carrara Avilés**
**OAB/GO n° 76.236**$md$,
  '12nX5m7M2Suh20hn5kK-EV46VQASI1ploq68gvZYBXXY'
),
-- ---------------------------------------------------------------------------
(
  'RPV complementar',
  array['rpv complementar','complementar','complementação','pagamento insuficiente','depósito a menor'],
  $md$**AO JUÍZO DE DIREITO DO(A) [ENDEREÇAMENTO DO JUÍZO]**

**Processo n°: [NÚMERO DO PROCESSO]**

**[NOME DO CESSIONÁRIO]**, já qualificado(a) nos autos em epígrafe, vem respeitosamente, por intermédio de seu procurador *in fine* assinado, manifestar nos seguintes termos.

**I - DO PAGAMENTO INSUFICIENTE DA RPV EM AFRONTA À ATUALIZAÇÃO MONETÁRIA PREVISTA NAS EC's Nº 113/2021 E Nº 136/2025 E NOS TEMAS 96, 450, 810 E 1037 DO STF**

Verifica-se, da análise dos autos, que o(s) crédito(s) judicial(is) exequendo(os) têm como fundamento título executivo regularmente transitado em julgado.

Posteriormente, foram apresentados os cálculos nos autos, devidamente homologados, motivo pelo qual esse cálculo passou a constituir o último valor atualizado do(s) crédito(s) judicial(is) constante dos autos.

Todavia, observa-se dos comprovantes de transferência da(s) Requisição(ões) de Pequeno Valor que o montante efetivamente depositado não observou a metodologia constitucional e jurisprudencial aplicável à atualização monetária no período posterior à homologação dos cálculos.

No caso concreto, a linha do tempo dos autos acompanha os seguintes marcos temporais:

**Até 31 de julho de 2025 (EC 113 de 2021):**

- Entre a data dos cálculos homologados e a da expedição da(s) RPV(s): incidência da **Taxa Selic**, com base nos **Temas 96 e 450 do STF**.
- Durante o período de graça: incidência do **IPCA-E**, apenas, com base na **Súmula Vinculante 17** e no **Tema 1037 do STF**.
- Entre o fim do período de graça e o efetivo pagamento: incidência da **Taxa Selic**, com base no **Tema 1037 do STF**.

**Após 01 de agosto de 2025 (EC 136 de 2025):**

- Correção pelo **IPCA** e juros de mora simples de **2% ao ano**, nos termos do art. 3° da EC 136 de 2025.

Observa-se que a atualização correta exige um encadeamento lógico de índices, de forma a evitar tanto a supressão indevida das orientações pacificadas pelo STF quanto à incidência de juros em período juridicamente protegido contra a mora e à correção monetária devida ao longo de todo o lapso temporal observado.

Aplicada essa metodologia cronologicamente segmentada aos autos, evidencia-se a insuficiência objetiva do pagamento, pois, observados de modo rigorosamente encadeado os marcos temporais delineados e os índices devidos em cada intervalo, **verifica-se que, na data do adimplemento, o valor atualizado do(s) crédito(s) correspondia a montante efetivamente maior do que o depositado,** resultando em **diferença de numerário**, conforme demonstra a memória de cálculo anexa, razão pela qual o referido depósito não configura adimplemento integral do(s) requisitório(s), mas pagamento parcial, impondo-se a complementação do saldo remanescente.

**II - CONSTRIÇÃO DO VALOR REMANESCENTE SEM NECESSIDADE DE EMISSÃO DE RPV COMPLEMENTAR**

À luz da necessidade de complementação da(s) RPV(s), cumpre destacar que o Supremo Tribunal Federal possui entendimento consolidado no sentido de ser **desnecessária a expedição de novo(s) precatório(s) ou RPV(s)** quando a divergência constatada decorre de **erro material ou inexatidão aritmética** dos cálculos apresentados.

No caso concreto, a inobservância dos consectários legais caracteriza a hipótese ora sustentada, em que o complemento deve ser realizado mediante bloqueio do erário imediato, sem qualquer necessidade de emissão de novo(s) requisitório(s).

Neste sentido:

AGRAVO REGIMENTAL NO RECURSO EXTRAORDINÁRIO COM AGRAVO. CONSTITUCIONAL E PROCESSUAL CIVIL. EXECUÇÃO CONTRA A FAZENDA PÚBLICA. **EXPEDIÇÃO DE NOVO PRECATÓRIO: DESNECESSIDADE NAS HIPÓTESES DE ERRO MATERIAL, INEXATIDÕES ARITMÉTICAS OU SUBSTITUIÇÃO DE ÍNDICES DE ATUALIZAÇÃO**. IMPOSSIBILIDADE DE REEXAME DO CONJUNTO FÁTICO-PROBATÓRIO: SÚMULA N. 279 DO SUPREMO TRIBUNAL FEDERAL. AGRAVO REGIMENTAL AO QUAL SE NEGA PROVIMENTO.

*(STF - AgR ARE: 1239688 SP - SÃO PAULO 0025231-15.2012.8.26.0000, Relator: Min. CÁRMEN LÚCIA, Data de Julgamento: 14/02/2020, Segunda Turma, Data de Publicação: Dje-041 28-02-2020)*

Agravo regimental em recurso extraordinário com agravo. Precatório. Crédito complementar. Depósitos insuficientes. Valores residuais. Dispensa da expedição de novo precatório. Precedentes. **1. Segundo a pacífica jurisprudência da Suprema Corte, o objetivo da vedação de expedição complementar do precatório é impedir a quebra da ordem cronológica dos pagamentos, situação diversa da postergação do pagamento por meio de depósito aquém do efetivamente devido.** 2. Agravo regimental não provido, com imposição de multa de 1% (um por cento) do valor atualizado da causa (art. 1.021, § 4º, do CPC). 3. Inaplicável o art. 85, § 11, do CPC, pois não houve prévia fixação de honorários advocatícios na causa. *(STF - ARE: 1325270 SP 3002946-93.2020.8.26.0000, Relator: DIAS TOFFOLI, Data de Julgamento: 29/11/2021, Primeira Turma, Data de Publicação: 15/03/2022)*

DIREITO PROCESSUAL CIVIL. AGRAVO REGIMENTAL EM RECURSO EXTRAORDINÁRIO. EXECUÇÃO CONTRA A FAZENDA PÚBLICA. ERRO DE CÁLCULO. EXPEDIÇÃO DE REQUISIÇÃO DE PEQUENO VALOR COMPLEMENTAR. POSSIBILIDADE. PRECEDENTES. 1. A jurisprudência do Supremo Tribunal Federal é firme no sentido da desnecessidade de expedição de novo precatório ou RPV para correção de erro ou inexatidão aritmética dos cálculos. Precedentes. 2. Ausência de argumentos capazes de infirmar a decisão agravada. 3. Agravo regimental a que se nega provimento. *(STF - AgR RE: 420827 PR - PARANÁ, Relator: Min. ROBERTO BARROSO, Data de Julgamento: 26/05/2015, Primeira Turma, Data de Publicação: Dje-123 25-06-2015)*

Como se vê, a complementação decorre de depósito insuficiente da(s) RPV(s) em razão da aplicação incorreta dos índices de correção monetária e dos juros de mora, os quais constituem consectários legais indispensáveis e intrínsecos ao(s) crédito(s), não representando acréscimo novo, mas parcela indissociável da(s) condenação(ões), de modo que a diferença deve ser satisfeita por mera retificação/adimplemento complementar do saldo, sem expedição de RPV(s) acessória(s), a fim de evitar o artificial deslocamento do credor na ordem cronológica.

Portanto, diante do exposto, **requer-se, respeitosamente, a imediata determinação de bloqueio do valor a complementar** nas contas da parte executada, a fim de suplementar o montante devido e assegurar a satisfação integral do(s) crédito(s) reconhecido(s) nos presentes autos. Ato contínuo ao bloqueio e à transferência dos valores penhorados à conta judicial, solicita-se que o(s) alvará(s) de levantamento seja(m) expedido(s) em nome do(a) cessionário(a), ora beneficiário(a) do(s) presente(s) crédito(s), cujos dados bancários seguem desde já informados:

**[DADOS BANCÁRIOS DO CESSIONÁRIO/INVESTIDOR]**

**II - PEDIDOS**

Diante de todo o exposto, solicita-se, respeitosamente, que:

1. **Haja a imediata determinação de bloqueio do numerário correspondente à diferença entre o montante efetivamente devido a título da condenação e o valor depositado, conforme memória de cálculo anexa,** acrescida da devida atualização monetária até a data da efetiva liquidação, em todas as contas bancárias da parte executada, de modo a assegurar a satisfação integral do(s) crédito(s) e superar o depósito realizado a menor;
2. Que o(s) alvará(s) de levantamento, e, se necessário, a(s) RPV(s) complementar(es) seja(m) expedida(as) em nome do(a) cessionário(a), ora beneficiário(a) do(s) crédito(s), nos seguintes termos:

1. Subsidiariamente, apenas na hipótese de se entender pela necessidade de expedição de RPV(s) complementar(es), que esta siga exclusivamente o regime do CPC, com disponibilização do valor no prazo máximo de 60 (sessenta) dias, sob pena de constrição e adoção das medidas executivas cabíveis.

E, ato contínuo, que a expedição dos documentos seja realizada nos mesmos termos dos dados já informados no item supra.

Neste termos, pede deferimento.
Belo Horizonte, data da assinatura eletrônica.

**Pedro Carrara Avilés**
**OAB/GO n.º 76.236**$md$,
  '1Pb1CJwm0VN0lZyfw2fu8UC4KerNNd9s6yErkwMpIXVk'
)
on conflict (drive_file_id) do update
  set nome           = excluded.nome,
      palavras_chave = excluded.palavras_chave,
      conteudo       = excluded.conteudo,
      updated_at     = now();

-- Verificação depois de rodar os DOIS arquivos:
--   select nome, array_length(palavras_chave, 1) as termos, length(conteudo) as tamanho
--     from public.peticao_templates order by nome;
--   -> esperado: 10 linhas.
