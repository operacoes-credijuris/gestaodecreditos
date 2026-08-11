-- Carga inicial dos 10 modelos de petição.
--
-- NÃO é migração: é DADO, e dado de conteúdo jurídico. Fica aqui, versionado no
-- git, para haver histórico de "o que dizia o modelo em tal data" — coisa que
-- importa quando a peça já foi protocolada em dezenas de processos.
--
-- Os modelos vieram da pasta "2. Modelos de petições" do Drive, lidos uma única
-- vez. Depois desta carga o Drive sai do caminho: a edição passa a ser dentro da
-- plataforma, e não há credencial do Google, nem sincronização, nem API externa
-- no caminho de gerar uma petição.
--
-- O `conteudo` é MARKDOWN: os modelos usam negrito nos títulos de seção e em
-- frases-chave, e o PDF final precisa disso. O texto jurídico está palavra por
-- palavra como no Doc; só foram corrigidos artefatos da conversão (asteriscos
-- duplicados que quebravam o negrito, e linhas com espaços soltos).
--
-- Reexecutável: o conflito é pelo drive_file_id, que é imutável. Rodar de novo
-- ATUALIZA o modelo em vez de criar uma cópia. Cuidado, portanto: rodar de novo
-- sobrescreve edições feitas na plataforma.
--
-- As palavras-chave resolvem as três colisões do acervo. "sequestro" existe em
-- dois modelos, "registro público" em dois e "RPV" em dois; por isso o modelo
-- mais específico ganha termos mais longos ("valor atualizado", "dilação",
-- "complementar"), e o critério de desempate é o tamanho do termo que casou.

insert into public.peticao_templates (nome, palavras_chave, conteudo, drive_file_id)
values
-- ---------------------------------------------------------------------------
(
  'Sequestro',
  array['sequestro','bloqueio de valores','penhora online'],
  $md$**AO JUÍZO DE DIREITO DA [ENDEREÇAMENTO DO JUÍZO]**

**Processo n°: [NÚMERO DO PROCESSO]**

**[NOME DO CESSIONÁRIO]**, já qualificado(a) nos autos em epígrafe, vem respeitosamente, por intermédio de seu procurador *in fine* assinado, manifestar nos seguintes termos.

No presente cumprimento de sentença, houve a **cessão** de **[TIPO DE CRÉDITO]**, regularmente homologada(s), com a consequente substituição da titularidade do crédito.

Por sua vez, a(s) Requisição(ões) de Pequeno Valor foi(oram) expedida(as).

Considerando que se encerrou o prazo legal de 60 (sessenta) dias para o pagamento da(s) RPV(s), nos termos do art. 13, inciso I, da Lei nº 12.153/2009, sem que tenha havido a devida quitação até o presente momento, resta plenamente caracterizado o inadimplemento da(s) obrigação(ões) por parte do ente devedor.

Assim, superado o prazo legal para pagamento e inexistindo óbice jurídico à adoção de medidas executivas, mostra-se cabível a determinação de sequestro de valores, como meio de assegurar a efetividade da tutela jurisdicional e o cumprimento da decisão judicial transitada em julgado.

Diante do exposto, requer, cordialmente, o reconhecimento da mora do EXECUTADO quanto ao pagamento da(s) RPV(s) expedida(s), bem como determinada a expedição de ordem de sequestro/bloqueio de valores por penhora *online*, até o limite do valor total requisitado, com a devida vinculação do numerário ao presente feito em favor do(a) cessionário(a).

Requer, ainda, caso o bloqueio inicial se mostre insuficiente, a reiteração da ordem em horários alternados e junto às diversas contas do ente executado, até a integral satisfação do crédito judicial.

Na oportunidade, efetuado o bloqueio do montante nas contas estatais, solicita-se desde já, cordialmente, que os valores sejam levantados em nome da parte beneficiária.

**[DADOS BANCÁRIOS DO CESSIONÁRIO/INVESTIDOR]**

Nestes termos, pede deferimento.
Belo Horizonte, data da assinatura eletrônica.

**Pedro Carrara Avilés**
**OAB/GO nº 76.236**$md$,
  '1PfLw-xru2_xKdU-Hx3bKEowe7NiOEaWKZLwhEsaBKAw'
),
-- ---------------------------------------------------------------------------
(
  'Levantamento',
  array['levantamento','levantar valores','alvará de levantamento'],
  $md$**AO JUÍZO DE DIREITO DO(A) [ENDEREÇAMENTO DO JUÍZO]**

**Processo n°: [NÚMERO DO PROCESSO]**

**[NOME DO CESSIONÁRIO]**, já qualificado(a) nos autos em epígrafe, vem respeitosamente, por intermédio de seu procurador *in fine* assinado, manifestar nos seguintes termos.

Conforme se verifica, quando do retorno dos autos com o resultado da penhora, a ordem judicial determinando o sequestro do numerário constante da RPV nas contas bancárias do Estado de Goiás, foi devidamente cumprida, tendo sido efetivado o bloqueio do montante indicado no processo.

Ressalte-se que, no presente cumprimento de sentença, houve a **cessão** de **[TIPO DE CRÉDITO]**, regularmente homologada(s), com a consequente substituição da titularidade do crédito.

Diante do exposto, considerando que a constrição judicial foi regularmente realizada, bem como que o(s) crédito(s) objeto da presente demanda foi(oram) cedido(s) ao cessionário(a), com a devida homologação por este Juízo, requer-se, cordialmente, o levantamento do(s) valore(s) bloqueado(s), com a respectiva transferência diretamente em favor do cessionário(a), cujos dados bancários são reiterados a seguir:

**[DADOS BANCÁRIOS DO CESSIONÁRIO/INVESTIDOR]**

Nestes termos, pede deferimento.
Belo Horizonte, data da assinatura eletrônica.

**Pedro Carrara Avilés**
**OAB/GO nº 76.236**$md$,
  '1hThy8Bl-lkTsMZMNaXLGYZ7C1SZQprr6IEy5XrcsT3M'
),
-- ---------------------------------------------------------------------------
(
  'Juntada de valor atualizado do crédito para fins de sequestro',
  array['valor atualizado','planilha de atualização','juntada de valor','atualização do débito'],
  $md$**AO JUÍZO DE DIREITO DA [ENDEREÇAMENTO DO JUÍZO]**

**Processo n°: [NÚMERO DO PROCESSO]**

**[NOME DO CESSIONÁRIO]**, já qualificado(a) nos autos em epígrafe, vem respeitosamente, por intermédio de seu procurador *in fine* assinado, manifestar nos seguintes termos.

Em cumprimento à determinação judicial, o(a) cessionário(a) apresenta a planilha de atualização integral do débito.

Desse modo, requer a juntada aos autos da planilha de atualização ora apresentada para viabilizar o sequestro dos valores nas contas do Estado, com o imediato prosseguimento do feito.

Na oportunidade, efetuado o bloqueio do montante nas contas estatais, solicita-se desde já, cordialmente, que os valores sejam levantados em nome da parte beneficiária:

**[DADOS BANCÁRIOS DO CESSIONÁRIO/INVESTIDOR]**

Neste termos, pede deferimento.
Belo Horizonte, data da assinatura eletrônica.

**Pedro Carrara Avilés**
**OAB/GO n.º 76.236**$md$,
  '1F3aD_Ax61rWAdLLkgeiFeUe1wLXZ080TmaCV2WOOopM'
),
-- ---------------------------------------------------------------------------
(
  'Concordância com os cálculos',
  array['concordância','concordância com os cálculos','cálculos'],
  $md$**AO JUÍZO DE DIREITO DO(A) [ENDEREÇAMENTO DO JUÍZO]**

**Processo n° [NÚMERO DO PROCESSO]**

**[NOME DO CESSIONÁRIO],** já qualificado(a) nos autos em epígrafe, vem respeitosamente, por intermédio de seu procurador *in fine* assinado, manifestar concordância com os cálculos apresentados.

Neste termos, pede deferimento.
Belo Horizonte, data da assinatura eletrônica.

**Pedro Carrara Avilés**
**OAB/GO nº 76.236**$md$,
  '1eFRa1UqDPG3LU5kzRGA8ZGfW0n7X-KNXEsmrdDJP1Y0'
),
-- ---------------------------------------------------------------------------
(
  'Requer comprovação de pagamento',
  array['comprovação de pagamento','comprovante de pagamento','comprovar pagamento'],
  $md$**AO JUÍZO DE DIREITO DO (A) [ENDEREÇAMENTO DO JUÍZO]**

**Processo n°: [NÚMERO DO PROCESSO]**

**[NOME DO CESSIONÁRIO]**, já qualificado(a) nos autos em epígrafe, vem respeitosamente, por intermédio de seu procurador *in fine* assinado, manifestar nos seguintes termos.

Verifica-se que, até o presente momento, não consta nos autos o adimplemento da Requisição de Pequeno Valor (RPV), inexistindo comprovação de que tenha sido efetivado o respectivo pagamento.

Dessa forma, a fim de viabilizar o regular prosseguimento do feito e a satisfação do crédito da parte autora, requer seja a parte devedora intimada para que apresente o competente comprovante de pagamento da RPV.

Nestes termos, pede deferimento.
Belo Horizonte, data da assinatura eletrônica.

**Pedro Carrara Avilés**
**OAB/GO nº 76.236**$md$,
  '1ivHSF-SkMlAYqf2Cg9BsouefgVck_fbQwunCLlus05A'
),
-- ---------------------------------------------------------------------------
(
  'Ilegitimidade passiva do patrono',
  array['ilegitimidade','ex-patrono','patrono'],
  $md$**AO JUÍZO DE DIREITO DA [ENDEREÇAMENTO DO JUÍZO]**

**Processo n°: [NÚMERO DO PROCESSO]**

**[NOME DO CESSIONÁRIO]**, já qualificado(a) nos autos em epígrafe, vem respeitosamente, por intermédio de seu procurador *in fine* assinado, manifestar nos seguintes termos.

Neste cumprimento de sentença, operou-se a **cessão integral de [TIPO DE CRÉDITO]**, a qual foi regularmente homologada por este Juízo, com a consequente substituição da titularidade de todo o objeto da lide. Nesse sentido, o antigo patrono da parte não mais integra a relação jurídica processual.

Todavia, verifica-se que, mesmo ciente de sua **ilegitimidade para atuar nos autos**, o ex-patrono protocolou petição requerendo a transferência dos valores bloqueados para conta bancária de sua titularidade, conduta que ocasiona grave tumulto processual e contribui significativamente para o retardamento da satisfação do crédito exequendo.

Diante disso, requer-se, desde já, a **desconsideração de qualquer manifestação ou requerimento** protocolado pela referida parte, em razão da manifesta ausência de legitimidade e capacidade postulatória no presente feito.

Por fim, para evitar qualquer equívoco operacional, reitera-se que eventual levantamento dos valores constritos deverá observar exclusivamente os dados bancários do cessionário, quais sejam:

**[DADOS BANCÁRIOS DO CESSIONÁRIO/INVESTIDOR]**

Nestes termos, pede deferimento.
Belo Horizonte, data da assinatura eletrônica.

**Pedro Carrara Avilés**
**OAB/GO nº 76.236**$md$,
  '166B0k-G0pXQKDJWAyEY8-ANpRwbg_9obRijarK11s7E'
),
-- ---------------------------------------------------------------------------
(
  'Juntada de registro público',
  array['juntada de registro','juntar registro','registro público juntada','contrato registrado'],
  $md$**AO JUÍZO DE DIREITO DO(A) [ENDEREÇAMENTO DO JUÍZO]**

**Processo n° [NÚMERO DO PROCESSO]**

**[NOME DO CESSIONÁRIO],** já qualificado(a) nos autos em epígrafe, vem respeitosamente, por intermédio de seu procurador *in fine* assinado, manifestar nos seguintes termos.

Em cumprimento à decisão proferida, requer a juntada, aos autos, do(s) contrato(s) de cessão de crédito, devidamente registrado(s) no cartório competente, em conformidade com o disposto no art. 129, 10º, da Lei nº 6.015/1973 (Lei de Registros Públicos).

Na oportunidade, solicita-se, ainda, que os pedidos da petição de homologação e substituição processual sejam analisados.

Neste termos, pede deferimento.
Belo Horizonte, data da assinatura eletrônica.

**Pedro Carrara Avilés**
**OAB/GO nº 76.236**$md$,
  '1aq110_EElD-PGbZXzCGl_txWNRb75LPQAwpLegke560'
),
-- ---------------------------------------------------------------------------
(
  'Dilação de prazo para registro público',
  array['dilação','dilação de prazo','prorrogação de prazo','prazo para registro'],
  $md$**AO JUÍZO DE DIREITO DO(A) [ENDEREÇAMENTO DO JUÍZO]**

**Processo n° [NÚMERO DO PROCESSO]**

**[NOME DO CESSIONÁRIO],** já qualificado(a) nos autos em epígrafe, vem respeitosamente, por intermédio de seu procurador *in fine* assinado, manifestar nos seguintes termos.

Em atenção à decisão retro, informa que já foi iniciado o procedimento junto ao Cartório Extrajudicial competente. Todavia, por fatores alheios à vontade das partes, não será possível concluí-lo no prazo fixado, em razão de adequações documentais exigidas em trâmite interno do cartório, cujo processamento demanda prazo superior.

Portanto, requer-se, cordialmente, a **dilação do prazo** concedido por mais 15 (quinze) dias, para que seja possível a regularização completa e sua devida apresentação nos autos.

Neste termos, pede deferimento.
Belo Horizonte, data da assinatura eletrônica.

**Pedro Carrara Avilés**
**OAB/GO nº 76.236**$md$,
  '1AhPr_OpSc-yApuCLjCjkyopXoYFfHG4LO9MDatB0hgQ'
)
on conflict (drive_file_id) do update
  set nome           = excluded.nome,
      palavras_chave = excluded.palavras_chave,
      conteudo       = excluded.conteudo,
      updated_at     = now();

-- Verificação depois de rodar:
--   select nome, array_length(palavras_chave, 1) as termos, length(conteudo) as tamanho
--     from public.peticao_templates order by nome;
--   -> esperado: 8 linhas nesta carga; os dois modelos longos (homologação de
--      cessão de RPV e RPV complementar) entram no arquivo seguinte, para o
--      comando não ficar impossível de revisar.
