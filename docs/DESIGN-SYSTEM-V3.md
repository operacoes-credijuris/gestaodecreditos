# Design system v3 — "Claro premium" e "Escuro sóbrio"

Repaginação visual da plataforma de gestão de créditos (12/11/2026, branch
`repaginacao`, publicada primeiro no canal **beta**). Este é o guia que as quatro
frentes de tela seguem. A fonte de verdade dos valores é `src/index.css` (tokens)
e `tailwind.config.js` (nomes); aqui está **como usar**.

> Pedido do dono: limpeza profunda e redesenho visual — limpo, sólido, bonito,
> com efeitos visuais, leveza, sobriedade e alto nível. Estética de mercado
> financeiro. "Um produto que vale milhões."

---

## 1. Princípios

1. **Marinho + champanhe, nunca cassino.** O marinho profundo é a estrutura (menu,
   primário no claro, tinta do texto). O champanhe (#C8A96A) é **acento**: anel de
   foco, item aceso do menu, sublinhado da aba, régua do indicador, chip aceso. Nunca
   fundo de área grande, nunca degradê dourado, nunca texto champanhe puro no claro.
2. **Os dois temas são de primeira classe.** Todo componente é desenhado e conferido
   no claro **e** no escuro. Nada de cor fixa: só tokens (a catraca conta).
3. **Os números mandam.** Dinheiro em algarismos tabulares, alinhado à direita, no
   peso seminegrito; rótulos discretos em volta. O número-herói é o maior elemento do
   cartão.
4. **Linhas finas, sombras macias.** Divisória de 1px na `borda`; sombra em camadas
   (contato curto + penumbra larga) no claro; no escuro, separação pela luz (fio claro
   no alto) e não pela sombra.
5. **Efeito com contenção.** Cada efeito tem um lugar e só ele (§6). Se dois efeitos
   disputam a mesma área, um sai.
6. **Acessibilidade não é negociável.** As regras da auditoria visual de 03/10/2026
   (alturas de controle, grade de 4px, camadas, foco, rodapé das janelas, filtros,
   tabelas, estados) **continuam todas valendo** — a v3 muda a linguagem visual, não
   a ergonomia. Texto ≥ 4,5:1, contorno de campo / anel / sublinhado ≥ 3:1, nos dois
   temas (`src/lib/__tests__/contraste.test.ts`).

---

## 2. Tokens de cor

Os **nomes não mudaram**: `bg-superficie`, `text-texto-2`, `border-borda`,
`bg-marca`, `text-marca-texto`, `sucesso/aviso/perigo/info`… — por isso cada tela
já veste a v3 sem tocar em classe. Os **novos** estão marcados com ★.

### 2.1 Superfícies e texto

| Token (classe) | Claro | Escuro | Uso |
|---|---|---|---|
| `papel` | #F5F3EE porcelana | #0A0F18 noite | fundo da página |
| `superficie` | #FFFFFF | #111825 | cartão, campo, tabela |
| `superficie-2` | #FAF9F6 | #141C2B | cabeçalho de tabela, zebra, rodapé de janela |
| `superficie-3` | #F0EDE7 | #1B2435 | hover, trilho do segmentado, campo desligado |
| ★ `elevada` | #FFFFFF | #171F2F | janela, gaveta, menu suspenso, busca Ctrl+K |
| ★ `vidro` | branco | #111825 | tinta do vidro (sempre com opacidade + desfoque) |
| `borda` | #E5E0D6 | #222C3E | a linha fina (divisória, contorno de cartão) |
| `borda-forte` | #D2CABB | #2F3B52 | botão secundário, linha sob o cabeçalho de tabela |
| `borda-controle` | #8D8576 (3,7:1) | #606D86 (3,4:1) | contorno de campo |
| `texto` | #0E1A2B (17,5:1) | #E8ECF2 (15:1) | texto principal |
| `texto-2` | #3E4A5C (9,0:1) | #B3BDCC (9,4:1) | descrição, secundário |
| `texto-3` | #5F6878 (5,6:1) | #8C97A9 (6,0:1) | metadado, rótulo de seção, ícone discreto |
| `veu` | #060B14 | #020409 | fundo atrás de janela (`bg-veu/45`) |

### 2.2 Marca e champanhe

| Token | Claro | Escuro | Uso |
|---|---|---|---|
| `marca` | #1C355C marinho | #C8A96A champanhe | **fundo** do primário |
| `marca-hover` | #142946 | #D6BC86 | primário sob o mouse |
| ★ `marca-contraste` | #FFFFFF (12,3:1) | #0B1322 (8,3:1) | **letra** sobre `bg-marca` — nunca `text-white` |
| `marca-viva` | #A47E3B ouro forte | #C8A96A | sublinhado da aba, régua, barra, faixa "marca" |
| `marca-suave` | #F3EDE0 | #1C2840 | chip aceso, avatar, contagem acesa |
| `marca-leve` | #F9F6EF | #151F33 | hover de link, caixa de ajuda, opção destacada |
| `marca-texto` | #1F4472 (9,9:1) | #DCC28A (10,3:1) | link, opção escolhida, coluna ordenada |
| `anel` | #A47E3B (3,7:1) | #D4B77A (9,2:1) | anel de foco (champanhe) |
| ★ `ouro` | #C8A96A | #C8A96A | ornamento: barra, brilho, halo — **não é letra** |
| ★ `ouro-forte` | #A47E3B | #D4B77A | linha de 3:1 em champanhe |
| ★ `ouro-texto` | #7D5E25 (6,0:1) | #DCC28A | champanhe que se lê |
| ★ `ouro-suave` / `ouro-borda` | #F6F0E3 / #E4D5B4 | #292418 / #54462A | selo/placa champanhe |

Escala `brand-50…950`: virou o **marinho** (o 600 é o primário do claro, o 900 o
menu); no escuro é invertida, como antes. Prefira os papéis acima à escala.

### 2.3 Menu lateral (igual nos dois temas, marinho)

| Token | Claro | Escuro |
|---|---|---|
| `nav` / `nav-2` | #0B1A30 → #102544 (degradê) | #0F1A2D → #132139 |
| `nav-texto` / `nav-apagado` | #C1CAD8 / #8593AB | iguais |
| `nav-ativo` | #1A2B47 | #1D2C46 |
| `acento` | #C8A96A (barra e ícone do aceso) | igual |
| `nav-foco` | #E2C98F | igual |

### 2.4 Estados (semânticos — nunca enfeite)

| Estado | texto · fundo · cheio · borda (claro) | (escuro) |
|---|---|---|
| `sucesso` | #17694A · #EAF5EF · #1C7A55 · #BFDECE | #5FCB9A · #0F2A21 · #187A52 · #1E4A3A |
| `perigo` | #A92E25 · #FBEFED · #B83A2E · #EFC6C0 | #F0968C · #33171A · #BE4237 · #5A2A2C |
| `aviso` | #96500A · #FCF1E3 · #DD8A24 · #EFCFA5 | #F0B46A · #33240F · #E0912E · #5A3F1A |
| `info` | #1F4E86 · #EDF2F9 · — · #C9D6EA | #93B8E6 · #13213A · — · #23385A |

O **aviso puxa para o laranja-queimado** de propósito: o âmbar de antes era parente
do champanhe, e um aviso não pode parecer enfeite. Os tons categóricos (`tom-*`,
`parado-*`) não mudaram.

### 2.5 Gráficos (`src/lib/chartColors.ts`)

Séries em ordem fixa: **safira, champanhe envelhecido, verde-petróleo** — claro
`#2C64B0 · #C2852A · #13866F`, escuro `#3F78C9 · #B98A34 · #179077`. Validadas com o
validador do guia de visualização (luminosidade, croma, daltonismo em **todos os
pares** com ΔE ≥ 9, 3:1 contra o cartão). **Três e não mais**: uma 4ª série vira
"Outros" (cor `label`) ou gráficos pequenos lado a lado. Grade, eixo, rótulo, tinta e
superfície repetem os tokens (o teste confere). Trocou uma cor: rode o validador.

---

## 3. Tipografia

| Família | Classe | Onde |
|---|---|---|
| **Inter** (variável, peso + tamanho óptico) | `font-sans` (padrão) e `font-display` | toda a interface, números, rótulos, títulos de cartão |
| **Source Serif 4** (variável) | ★ `font-titulo` | **só** o h1 da página (PageHeader), o título da janela (Modal) e o nome "Credijuris" no menu |

Autoalojadas em `src/fontes.css`, **só o subconjunto latino** (≈125 KB as duas).
`font-display` agora é a mesma Inter (o nome ficou porque 70 lugares o usam).

| Papel | Classe | Medida |
|---|---|---|
| H1 da página | `font-titulo text-4xl font-semibold` (celular `text-2xl`) | 30/36 |
| Título de janela | `font-titulo text-2xl font-semibold` | 22/28 |
| H2 de seção / aba | `font-display text-xl font-semibold tracking-[-0.01em]` | 18/26 |
| Título de cartão | `font-display text-lg font-semibold` | 16/24 |
| Número-herói (indicador) | `cj-numero font-display text-3xl font-semibold` | 26/32 |
| Texto corrido, célula | `text-corpo` | 14/21 |
| Controles, rótulo de campo | `text-sm font-semibold` | 13/19 |
| Metadado | `text-xs text-texto-3` | 12/16 |
| Rótulo de seção (sobretítulo) | ★ `cj-sobretitulo` | 11,5/16, caixa alta, 0,08em |

Regras:
- **Peso máximo 600 em título** (nada de `font-extrabold`/`font-black` novo); 700 só em
  número pequeno que precisa saltar (contador).
- **`tabular-nums` em todo número que se compara em coluna** (dinheiro, data,
  percentual, quantidade). **Não** em número de identificação (CNJ, CPF): na Inter o
  modo tabular alarga também o ponto e o hífen. A tabela inteira não é tabular — só a
  célula `TD numero` e o que você marcar.
- A Inter já vem com o "l" de cauda e o "I" com serifa (`cv05`, `cv08`, no `body`):
  Il1 distintos em chaves e números.
- Serifa **nunca** em texto corrido, tabela, botão ou rótulo pequeno. Uma serifa por
  vista (o h1, ou o título da janela aberta).

---

## 4. Forma: raios, elevação, espaço

- **Raios** (mais secos, institucionais): `rounded-controle` 6px, `rounded-campo`
  8px, `rounded-cartao` 12px, `rounded-janela` 14px, `rounded-flutuante` 10px,
  `rounded-full` (chip de filtro, avatar). Proibidos os da escala em rem
  (`rounded-md/lg/xl/2xl`).
- **Elevação**: `shadow-nivel-1` cartão/campo/secundário; `shadow-nivel-2` menu,
  hover de cartão clicável, botão flutuante; `shadow-nivel-3` janela, gaveta, aviso.
  No escuro as sombras já trazem o fio de luz por dentro — **não** some mais
  `dark:shadow-none` nem `dark:ring-white/…` em cartão.
- **Espaço**: a grade de 4px (`s0.5…s16`) e as alturas de controle (`h-controle`
  36px, `h-controle-sm` 28/36px, `h-controle-lg` 40px) da auditoria continuam.
  Cartão `p-s5` (indicador também, `p-s4` no celular).

---

## 5. Componentes (src/components/ui)

As **props não mudaram** em nenhum componente. O que muda é o desenho:

| Componente | v3 |
|---|---|
| `Button` | primário `bg-marca` + `text-marca-contraste` + brilho (`cj-brilho`); secundário contornado com sombra de contato; ghost; perigo cheio só na confirmação final, `dangerOutline` na janela. Transição 150ms. |
| `Card` | linha fina + `shadow-nivel-1` nos dois temas; `CardHeader` título 16px seminegrito; `faixa="info"` agora é azul de info, `faixa="marca"` champanhe. |
| `StatCard` | placa de ícone com contorno (a da marca é champanhe); rótulo 13px; número-herói 26px seminegrito tabular que chega subindo 4px; clicável sobe 1px (`cj-ergue`). |
| `Badge` | etiqueta de canto 6px (não pílula), seminegrito, contorno a meia força no escuro. |
| `Chip` | pílula; aceso = `marca-suave` + contorno champanhe. |
| `Segmented` | trilho rebaixado; escolhida em relevo (`elevada` + sombra), letra na tinta; contagem acesa champanhe. |
| `Tabs` | aberta na tinta com sublinhado champanhe (`marca-viva`). |
| `Table` | cabeçalho `cj-sobretitulo` fixo, linha forte só sob o cabeçalho, hairlines entre linhas, **zebra sutil** (`cj-zebra`, especificidade zero: a cor da linha da tela sempre vence), hover `superficie-3/70`. |
| `Field`/`Input`/`Select` | rótulo 13px seminegrito; foco = borda + halo champanhe; seta própria no select (`cj-select`). |
| `Modal` | véu com desfoque de 6px; painel `elevada` com linha fina; título na serifa; rodapé em `superficie-2`. |
| `Drawer` | idem; `DrawerField` rótulo em sobretítulo; `DrawerSection` com fio champanhe antes do título. |
| `MenuDeAcoes`, `Combobox`, menu do usuário, "?" da tela | vidro elevado (`cj-vidro-elevado`) + `animate-menu-in`. |
| `Toast`, `Dica` | tinta marinho (claro) / clara (escuro) com fio interno e sombra funda. |
| `EmptyState`/`ErrorState` | placa champanhe / perigo com contorno; título seminegrito. |

Moldura (`src/components/layout`): menu `cj-menu` (marinho com degradê e halo
champanhe), fio champanhe sob a marca, item aceso com barra e **ícone** champanhe;
topo em vidro (`cj-vidro`); aurora no alto de toda página (`cj-aurora`); busca Ctrl+K
elevada; botão do assistente = disco do primário com a faísca champanhe.

---

## 6. Efeitos (todos em `src/index.css`, `@layer components`)

| Classe | O que faz | Onde (e só lá) |
|---|---|---|
| `cj-vidro` | tinta do tema a 78% + `blur(16px) saturate(1.5)` | barra do topo, barra de ferramentas flutuante |
| `cj-vidro-elevado` | `elevada` a 90% + desfoque | menus suspensos, balões, listas de combobox |
| `cj-brilho` | luz de cima + fio claro no alto | botões cheios, botão flutuante |
| `cj-menu` | marinho com degradê e halo champanhe | menu lateral |
| `cj-aurora` | luz champanhe/marinho no alto da página | moldura (já aplicada — não repita) |
| `cj-destaque` | luz champanhe no canto | **um** painel-herói por tela, se houver (ex.: o resumo do investidor) |
| `cj-ergue` | sobe 1px + sombra 2 sob o mouse | cartão inteiro clicável |
| `cj-zebra` | listra sutil | `TBody` (já aplicada) |
| `cj-numero` | tabular + altura de maiúscula + -0,015em | número-herói, total |
| `cj-sobretitulo` | rótulo de seção | cabeçalho de tabela, seção de ficha, grupo |
| `skeleton` | brilho que passa (1,6s) | carregamento |

---

## 7. Movimento

- Durações: `duration-rapida` 150ms (cor, hover), `duration-media` 200ms (painel,
  menu, gaveta), `duration-lenta` 250ms (página, janela). Nada acima de 250ms.
- Curvas: `ease-saida` (o que chega desacelera) e `ease-padrao` (vai e volta).
- Animações prontas: `animate-page`, `animate-modal-in`, `animate-menu-in`,
  `animate-fade-in`, `animate-toast-in`, `animate-numero`.
- **Movimento reduzido**: o `index.css` zera durações e o `cj-ergue` não sobe. Não
  crie animação em JS que ignore isso. Contagem numérica (count-up) **não**: o
  `animate-numero` é o substituto barato.
- Sem bibliotecas de animação.

---

## 8. Faça / não faça

**Faça**
- `bg-marca text-marca-contraste` (nunca `text-white` sobre `bg-marca`).
- Champanhe como linha, ícone do aceso, sublinhado, contorno de selecionado.
- Dinheiro à direita, `tabular-nums`, seminegrito quando for total.
- Um primário por vista; rodapé `[alternativa à esquerda] … [Cancelar] [Primário]`.
- Conferir **claro e escuro, 1440 e 375** antes de dar a tela por pronta.

**Não faça**
- Degradê dourado, texto dourado puro (#C8A96A) no claro, fundo champanhe grande.
- Cor da paleta do Tailwind (`text-amber-600`…) ou hex solto em `.tsx`.
- `font-extrabold`, `text-[NNpx]`, `rounded-xl`, `shadow-sm`, `dark:shadow-none` novos.
- Serifa fora do h1/título de janela.
- Cartão dentro de cartão (o bloco interno é `rounded-campo bg-superficie-2`, sem borda).
- Mais de um efeito na mesma área; brilho/aurora em lista.

---

## 9. Checklist das frentes de tela

Antes de abrir o PR de uma tela:

- [ ] Nenhuma cor fixa, nenhum `text-[NNpx]` (a catraca passa).
- [ ] `bg-marca` sempre com `text-marca-contraste`; nada de `text-white` sobre champanhe.
- [ ] Título da página pelo `PageHeader` (serifa automática); seções em `font-display text-xl font-semibold`.
- [ ] Rótulos de seção com `cj-sobretitulo` (troque os `font-display text-xs font-bold uppercase tracking-…` feitos à mão).
- [ ] `font-bold`/`font-extrabold` em título → `font-semibold`.
- [ ] Indicadores pelo `StatCard`/`GradeDeIndicadores`; números com `tabular-nums`; CNJ/CPF sem.
- [ ] Tabelas pelo `Table/THead/TBody/TR/TD` (`TD numero` nos valores); sem zebra manual.
- [ ] Menus e balões feitos à mão → `cj-vidro-elevado rounded-flutuante border border-borda shadow-nivel-2 animate-menu-in`.
- [ ] Janelas pelo `Modal`/`Drawer`; caixas internas `rounded-campo bg-superficie-2`.
- [ ] Remova `dark:shadow-none` e `dark:ring-1 dark:ring-white/[0.06]` de cartões (a sombra do escuro já tem o fio).
- [ ] Gráficos: só `useCoresDoGrafico()`, até 3 séries.
- [ ] Contraste: texto ≥ 4,5:1, linhas de controle ≥ 3:1 (par novo → entra em `contraste.test.ts`).
- [ ] Capturas no harness: claro e escuro, 1440 e 375, sem rolagem lateral no celular.
- [ ] `npx vitest run`, `npx tsc --noEmit`, `npm run build`.

---

## 10. O que cada frente faz a seguir

- **Análise de crédito** (`pages/operacional/AnaliseCredito.tsx`, `components/analise/*`, janelas de análise/desfecho/due diligence): quadro de fases com `superficie` + linha fina e a fase aberta com contorno champanhe; títulos de etapa em `font-display text-xl font-semibold`; os cards do funil como cartões `cj-ergue` (sem sombra dupla); sobretítulos; selos de risco pela Badge; rever os `rounded-[14px_…]` das bolhas do chat da análise de RPV.
- **Execução** (Publicações, Tarefas, Créditos, Requerimentos, Contatos, `CreditoDrawer`): tabelas pelo kit (zebra/hover já vêm), `TD numero`/`tabular-nums` nos valores e datas, linha do tempo de Publicações com o ponto `bg-brand-400` → token de marca, ficha lateral com a grade de rótulos única e `cj-sobretitulo`.
- **Quadro econômico / Carteiras / Comercial / Configurações**: um painel-herói por tela com `cj-destaque`; `compartilhado.tsx` (legenda e dica do gráfico) em vidro elevado; grupos de colunas da Carteira com `cj-sobretitulo`; formulários de Configurações com o novo `Field`; Geração de contratos sem cartão dentro de cartão.
- **Assistente + janelas de análise** (`components/Assistente.tsx`, `AnaliseRpvModal.tsx`): painel em `elevada` + `shadow-nivel-3` + linha fina; bolha do usuário `bg-marca text-marca-contraste` (já trocada) com raio `rounded-janela`; menus do painel em vidro elevado; títulos de grupo com `cj-sobretitulo`; o botão flutuante já está no desenho novo.
