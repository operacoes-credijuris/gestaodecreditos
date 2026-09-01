// Relatório do investidor em HTML — o mesmo documento que hoje é montado à mão
// fora da plataforma, gerado aqui a partir dos dados que já estão na tela.
//
// O QUE MUDA EM RELAÇÃO AO FLUXO DE HOJE
//
// Hoje a carteira é baixada em .xlsx, colada num assistente que redige o
// relatório e depois num segundo que audita o resultado. O assistente é quem
// faz as contas, e por isso a auditoria existe: um modelo de linguagem pode
// somar errado, arredondar diferente ou tirar média de taxas anualizadas.
//
// Aqui não há conta nova. Todo número deste arquivo vem de
// montarCarteiraDoInvestidor — as mesmas funções que pintam a tela e a planilha.
// Se o relatório e a tela discordarem, é bug de formatação, não de cálculo.
//
// O QUE ESTE ARQUIVO NÃO FAZ
//
// Não inventa texto. Estágio processual e providências saem de carteira_resumos
// (gerados pelo botão "Gerar resumos"); onde não houver resumo, o relatório diz
// que não há, em vez de escrever algo plausível.
//
// AUTOCONTIDO: um único .html, CSS embutido, gráficos em SVG escrito à mão,
// zero requisição externa. O arquivo é enviado por e-mail e WhatsApp e precisa
// abrir igual no celular de quem investiu, sem internet e sem CDN.
import type { CarteiraCalculada, LinhaCarteira } from './carteiraInvestidor'
import { formatBRL, formatCNJ, formatDate, formatPercent } from './format'
import { diasEntre } from '../../supabase/functions/_shared/nucleo/datas.ts'

// ---------------------------------------------------------------------------
// Texto
// ---------------------------------------------------------------------------

/** Escapa para HTML. Cedente, advogado e os textos da IA passam por aqui. */
function esc(v: string | null | undefined): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** "R$ 498.678" — sem centavos, para o miolo do donut e os selos. */
function brlCurto(v: number | null | undefined): string {
  if (typeof v !== 'number' || Number.isNaN(v)) return '—'
  return `R$ ${Math.round(v).toLocaleString('pt-BR')}`
}

/** "R$ 687k" — para o rótulo de fim de linha do gráfico. */
function brlMil(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1).replace('.', ',')}M`
  return `R$ ${Math.round(v / 1000)}k`
}

/** "2026-09-01" -> "01/09/26". */
function dataCurta(iso: string | null | undefined): string {
  const s = (iso ?? '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '—'
  return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(2, 4)}`
}

const MES_CURTO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

/** "2026-09" -> "set/26". */
function rotuloMes(ym: string): string {
  const [a, m] = ym.split('-').map(Number)
  return `${MES_CURTO[m - 1] ?? '?'}/${String(a).slice(2)}`
}

/** "2026-09" -> "2026-10". */
function mesSeguinte(ym: string): string {
  const [a, m] = ym.split('-').map(Number)
  return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`
}

/** Pluraliza sem gambiarra de "(s)": "1 operação" / "3 operações". */
function plural(n: number, um: string, muitos: string): string {
  return `${n} ${n === 1 ? um : muitos}`
}

// ---------------------------------------------------------------------------
// Cores
// ---------------------------------------------------------------------------

// Paleta dos tribunais, na ordem em que é atribuída (maior capital primeiro).
// Os quatro primeiros tons são os do relatório que a Credijuris já enviava, para
// quem recebe todo mês não estranhar a troca. Cada tom vem com o par pálido
// usado no selo da tabela — fundo claro e tinta escura, para o selo continuar
// legível impresso em preto e branco.
const TRIBUNAIS: { linha: string; selo: string; tinta: string }[] = [
  { linha: '#042C53', selo: '#E8F2FC', tinta: '#1A4E7A' },
  { linha: '#EF9F27', selo: '#FEF5E6', tinta: '#7A4A00' },
  { linha: '#7B5BCC', selo: '#F5E8FC', tinta: '#5A007A' },
  { linha: '#2A9D7C', selo: '#E8FCF0', tinta: '#00614A' },
  { linha: '#378ADD', selo: '#E8F2FC', tinta: '#10456F' },
  { linha: '#B5476B', selo: '#FCE8EF', tinta: '#7A0033' },
  { linha: '#8A6A2F', selo: '#F7F0E2', tinta: '#5A4415' },
  { linha: '#5F5E5A', selo: '#F1EFE8', tinta: '#40403C' },
]

/** Tom do semáforo — os mesmos nomes de cor que a tela usa na coluna Status. */
const SEMAFORO: Record<string, { classe: string; glifo: string }> = {
  green: { classe: 'sem-verde', glifo: '●' },
  blue: { classe: 'sem-azul', glifo: '●' },
  yellow: { classe: 'sem-amber', glifo: '⚠' },
  red: { classe: 'sem-vermelho', glifo: '⚠' },
  gray: { classe: 'sem-cinza', glifo: '○' },
}

// ---------------------------------------------------------------------------
// Recortes da carteira
// ---------------------------------------------------------------------------

const SEM_TRIBUNAL = '(sem tribunal)'

interface GrupoTribunal {
  nome: string
  n: number
  capital: number
  fracao: number
  cor: { linha: string; selo: string; tinta: string }
}

/**
 * Capital por tribunal, do maior para o menor. Operação sem capital cadastrado
 * fica FORA: uma fatia de tamanho zero num gráfico de composição afirmaria que
 * aquele tribunal não recebeu dinheiro, quando o que falta é cadastro.
 */
function porTribunal(c: CarteiraCalculada): { grupos: GrupoTribunal[]; total: number; foraN: number } {
  const mapa = new Map<string, { n: number; capital: number }>()
  let foraN = 0
  for (const l of c.linhas) {
    const cap = l.p.capital_investido
    if (typeof cap !== 'number' || cap <= 0) {
      foraN++
      continue
    }
    const nome = (l.p.tribunal ?? '').trim() || SEM_TRIBUNAL
    const atual = mapa.get(nome) ?? { n: 0, capital: 0 }
    atual.n++
    atual.capital += cap
    mapa.set(nome, atual)
  }
  const total = [...mapa.values()].reduce((s, g) => s + g.capital, 0)
  const grupos = [...mapa.entries()]
    .map(([nome, g]) => ({ nome, ...g }))
    .sort((a, b) => b.capital - a.capital)
    .map((g, i) => ({
      ...g,
      fracao: total > 0 ? g.capital / total : 0,
      cor: TRIBUNAIS[Math.min(i, TRIBUNAIS.length - 1)],
    }))
  return { grupos, total, foraN }
}

/** Cor do tribunal, para o selo da tabela e a barra dos recebimentos. */
function corDoTribunal(grupos: GrupoTribunal[], tribunal: string | null): GrupoTribunal['cor'] {
  const nome = (tribunal ?? '').trim() || SEM_TRIBUNAL
  return grupos.find((g) => g.nome === nome)?.cor ?? TRIBUNAIS[TRIBUNAIS.length - 1]
}

/** Em aberto, da expectativa mais próxima para a mais distante; sem data no fim. */
function proximosRecebimentos(c: CarteiraCalculada): LinhaCarteira[] {
  return c.linhas
    .filter((l) => !l.pago)
    .sort((a, b) => {
      const av = (a.p.expectativa_liquidacao ?? '').slice(0, 10)
      const bv = (b.p.expectativa_liquidacao ?? '').slice(0, 10)
      if (!av && !bv) return 0
      if (!av) return 1
      if (!bv) return -1
      return av.localeCompare(bv)
    })
}

/** Adquiridas no mês de referência — as "novas" do ciclo. */
function novasDoCiclo(c: CarteiraCalculada): LinhaCarteira[] {
  const ym = c.hoje.slice(0, 7)
  return c.linhas.filter((l) => (l.p.data_aquisicao ?? '').slice(0, 7) === ym)
}

/** Dias de hoje até a data; negativo quando já passou. */
function emDias(c: CarteiraCalculada, iso: string | null | undefined): number | null {
  const alvo = (iso ?? '').slice(0, 10)
  if (!alvo) return null
  return diasEntre(c.hoje, alvo)
}

/** "em 27 dias" / "vencida há 12 dias" / "hoje". */
function prazoTexto(dias: number | null): string {
  if (dias === null) return 'sem data'
  if (dias === 0) return 'hoje'
  if (dias > 0) return `em ${plural(dias, 'dia', 'dias')}`
  return `vencida há ${plural(-dias, 'dia', 'dias')}`
}

// ---------------------------------------------------------------------------
// Gráfico 1 — composição por tribunal (donut)
// ---------------------------------------------------------------------------

const RAIO = 58
const CIRC = 2 * Math.PI * RAIO // 364.42

function donut(grupos: GrupoTribunal[], total: number): string {
  if (grupos.length === 0 || total <= 0) return ''
  let acumulado = 0
  const fatias = grupos
    .map((g) => {
      const comprimento = g.fracao * CIRC
      const offset = -acumulado
      acumulado += comprimento
      return (
        `<circle cx="80" cy="80" r="${RAIO}" fill="none" stroke="${g.cor.linha}" stroke-width="32" ` +
        `stroke-dasharray="${comprimento.toFixed(1)} ${CIRC.toFixed(1)}" ` +
        `stroke-dashoffset="${offset.toFixed(1)}" transform="rotate(-90 80 80)"/>`
      )
    })
    .join('')
  return (
    `<svg width="140" height="140" viewBox="0 0 160 160" xmlns="http://www.w3.org/2000/svg" ` +
    `role="img" aria-label="Composição do capital investido por tribunal">` +
    `<circle cx="80" cy="80" r="${RAIO}" fill="none" stroke="#f5f5f3" stroke-width="32"/>` +
    fatias +
    `<text x="80" y="73" text-anchor="middle" fill="#042C53" font-size="7.5" font-family="Arial" font-weight="600">Capital total</text>` +
    `<text x="80" y="85" text-anchor="middle" fill="#042C53" font-size="9" font-family="Arial" font-weight="700">${esc(brlCurto(total))}</text>` +
    `</svg>`
  )
}

// ---------------------------------------------------------------------------
// Gráfico 2 — evolução da carteira
// ---------------------------------------------------------------------------

interface Evolucao {
  meses: string[]
  idxHoje: number
  capital: number[]
  recebido: number[]
  /** Indexado a partir de idxHoje; antes disso é null (a linha ainda não nasceu). */
  projetado: (number | null)[]
  maximo: number
}

/**
 * Três séries mensais acumuladas.
 *
 *   Capital comprometido  quanto está aplicado no fim de cada mês — sobe na
 *                         cessão e desce na liquidação (efetiva, no passado;
 *                         esperada, no futuro). É a única que cai.
 *   Recebido acumulado    soma do que entrou até o fim do mês. Para em hoje.
 *   Projetado acumulado   começa no recebido de hoje e soma, mês a mês, o valor
 *                         esperado de cada operação em aberto. Termina no
 *                         resultado bruto da carteira.
 *
 * Operação em aberto com expectativa VENCIDA entra no primeiro mês depois de
 * hoje, não no mês em que venceu: o dinheiro não entrou, e lançá-lo no passado
 * faria a linha projetada nascer acima da recebida.
 */
function evolucao(c: CarteiraCalculada): Evolucao | null {
  const datas: string[] = [c.hoje]
  for (const l of c.linhas) {
    for (const d of [l.p.data_aquisicao, l.p.data_liquidacao, l.p.expectativa_liquidacao]) {
      const s = (d ?? '').slice(0, 10)
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) datas.push(s)
    }
  }
  if (datas.length < 2) return null
  datas.sort()
  const inicio = datas[0].slice(0, 7)
  const fim = datas[datas.length - 1].slice(0, 7)

  const meses: string[] = []
  let m = inicio
  // Teto de 120 meses: dez anos de carteira já é mais do que o gráfico consegue
  // rotular, e uma data digitada errada (ano 2206) não pode travar a geração.
  while (m <= fim && meses.length < 120) {
    meses.push(m)
    m = mesSeguinte(m)
  }
  const idxHoje = Math.max(0, meses.indexOf(c.hoje.slice(0, 7)))

  // Eventos da linha projetada: cada operação em aberto entra na data em que se
  // espera receber, nunca antes de hoje. O complementar de operação já paga
  // entra logo depois de hoje — é dinheiro devido que ainda não caiu.
  const eventos: { data: string; valor: number }[] = []
  for (const l of c.linhas) {
    const exp = (l.p.expectativa_liquidacao ?? '').slice(0, 10)
    if (!l.pago && l.proj.valor !== null && exp) {
      eventos.push({ data: exp > c.hoje ? exp : c.hoje, valor: l.proj.valor })
    }
    const comp = l.p.valor_estimado_complementar
    if (typeof comp === 'number' && comp > 0) {
      const quando = !l.pago && exp && exp > c.hoje ? exp : c.hoje
      eventos.push({ data: quando, valor: comp })
    }
  }

  const capital: number[] = []
  const recebido: number[] = []
  const projetado: (number | null)[] = []

  for (let i = 0; i < meses.length; i++) {
    // Corte exclusivo: primeiro dia do mês seguinte. Comparar ISO como texto
    // funciona porque YYYY-MM-DD é ordenável.
    const corte = `${mesSeguinte(meses[i])}-01`

    let cap = 0
    let rec = 0
    for (const l of c.linhas) {
      const aq = (l.p.data_aquisicao ?? '').slice(0, 10)
      const liq = (l.p.data_liquidacao ?? '').slice(0, 10)
      const exp = (l.p.expectativa_liquidacao ?? '').slice(0, 10)
      const valorCap = l.p.capital_investido
      const saida = l.pago ? liq : exp
      if (typeof valorCap === 'number' && aq && aq < corte) {
        // Sem data de saída a operação nunca deixa o comprometido — é o que
        // acontece com crédito em aberto e sem expectativa cadastrada.
        if (!saida || saida >= corte) cap += valorCap
      }
      if (liq && liq < corte && typeof l.p.ja_recebido === 'number') rec += l.p.ja_recebido
    }
    capital.push(cap)
    recebido.push(rec)

    if (i < idxHoje) {
      projetado.push(null)
    } else if (i === idxHoje) {
      // As duas linhas se encontram em hoje: o projetado parte do que já entrou.
      projetado.push(rec)
    } else {
      const soma = eventos.filter((e) => e.data < corte).reduce((s, e) => s + e.valor, 0)
      projetado.push(recebido[idxHoje] + soma)
    }
  }

  const maximo = Math.max(
    ...capital,
    ...recebido,
    ...projetado.map((v) => v ?? 0),
    1,
  )
  return { meses, idxHoje, capital, recebido, projetado, maximo }
}

/** Teto "redondo" do eixo Y, para as linhas de grade caírem em número legível. */
function tetoRedondo(v: number): number {
  if (v <= 0) return 1
  const escala = Math.pow(10, Math.floor(Math.log10(v)))
  for (const passo of [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (v <= passo * escala) return passo * escala
  }
  return 10 * escala
}

function graficoEvolucao(e: Evolucao): string {
  const X0 = 60
  const X1 = 790
  const Y0 = 240
  const ALTURA = 220
  const n = e.meses.length
  const teto = tetoRedondo(e.maximo)
  const x = (i: number) => (n === 1 ? X0 : X0 + (i * (X1 - X0)) / (n - 1))
  const y = (v: number) => Y0 - (v / teto) * ALTURA
  const pontos = (serie: (number | null)[], de = 0) =>
    serie
      .map((v, i) => (v === null || i < de ? null : `${x(i).toFixed(0)},${y(v).toFixed(0)}`))
      .filter(Boolean)
      .join(' ')

  const grade = [0.25, 0.5, 0.75, 1]
    .map((f) => {
      const yy = y(teto * f).toFixed(0)
      return (
        `<line x1="${X0}" y1="${yy}" x2="${X1}" y2="${yy}" stroke="#eee" stroke-width="0.8"/>` +
        `<text x="${X0 - 6}" y="${Number(yy) + 2}" text-anchor="end" font-size="8" fill="#888" font-family="Arial">${esc(brlMil(teto * f))}</text>`
      )
    })
    .join('')

  // No máximo 8 rótulos no eixo X, sempre incluindo o primeiro, o último e hoje.
  const passo = Math.max(1, Math.ceil(n / 8))
  const rotulos = e.meses
    .map((m, i) => {
      const destaque = i === e.idxHoje
      if (!destaque && i % passo !== 0 && i !== n - 1) return ''
      // Rótulo colado no de hoje sairia por cima dele.
      if (!destaque && Math.abs(i - e.idxHoje) < passo / 2) return ''
      return (
        `<text x="${x(i).toFixed(0)}" y="256" text-anchor="middle" font-size="7" ` +
        `fill="${destaque ? '#E24B4A' : '#888'}" font-family="Arial"${destaque ? ' font-weight="700"' : ''}>` +
        `${esc(rotuloMes(m))}</text>`
      )
    })
    .join('')

  const xHoje = x(e.idxHoje).toFixed(0)
  const fimProjetado = e.projetado[n - 1]

  return (
    `<svg viewBox="0 0 820 270" xmlns="http://www.w3.org/2000/svg" style="width:100%;display:block" ` +
    `role="img" aria-label="Evolução mensal do capital comprometido, do recebido e do projetado">` +
    `<line x1="${X0}" y1="20" x2="${X0}" y2="${Y0}" stroke="#ddd" stroke-width="1"/>` +
    `<line x1="${X0}" y1="${Y0}" x2="${X1}" y2="${Y0}" stroke="#ddd" stroke-width="1"/>` +
    `<text x="${X0 - 6}" y="${Y0 + 4}" text-anchor="end" font-size="8" fill="#888" font-family="Arial">R$0</text>` +
    grade +
    rotulos +
    `<polyline points="${pontos(e.recebido.slice(0, e.idxHoje + 1))}" fill="none" stroke="#97C459" stroke-width="2.5"/>` +
    `<polyline points="${pontos(e.projetado, e.idxHoje)}" fill="none" stroke="#85B7EB" stroke-width="2" stroke-dasharray="5,3"/>` +
    `<polyline points="${pontos(e.capital)}" fill="none" stroke="#042C53" stroke-width="2.5" stroke-dasharray="6,3"/>` +
    `<line x1="${xHoje}" y1="20" x2="${xHoje}" y2="${Y0}" stroke="#E24B4A" stroke-width="1.5" stroke-dasharray="4,3" opacity="0.8"/>` +
    `<text x="${Number(xHoje) + 3}" y="32" font-size="8" fill="#E24B4A" font-family="Arial" font-weight="600">Hoje</text>` +
    (typeof fimProjetado === 'number'
      ? `<text x="${X1 - 4}" y="${(y(fimProjetado) - 6).toFixed(0)}" text-anchor="end" font-size="9" fill="#85B7EB" font-family="Arial" font-weight="600">${esc(brlMil(fimProjetado))}</text>`
      : '') +
    `</svg>`
  )
}

// ---------------------------------------------------------------------------
// Blocos
// ---------------------------------------------------------------------------

function bloco1(c: CarteiraCalculada, grupos: GrupoTribunal[]): string {
  const selic = c.parametros?.selic_aa ?? null
  const tirValor = c.tirMedia.valor
  // Selo da TIR: comparação com a SELIC, que é o parâmetro que a plataforma
  // conhece e que a equipe mantém em Parâmetros de atualização. Sem SELIC
  // cadastrada não há comparação a fazer, e o selo some — inventar um número de
  // referência para um documento que vai ao investidor não é opção.
  let seloTir = '<span class="kpi-badge badge-neutral">Sem taxa de referência cadastrada</span>'
  if (typeof selic === 'number' && selic > 0 && typeof tirValor === 'number') {
    const vezes = tirValor / selic
    seloTir =
      tirValor >= selic
        ? `<span class="kpi-badge badge-above-cdi">≥ SELIC · ${vezes.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}× a SELIC</span>`
        : `<span class="kpi-badge badge-neutral">abaixo da SELIC (${formatPercent(selic)} a.a.)</span>`
  }

  const resultadoBruto =
    c.jaRecebidoTotal !== null || c.aReceber.total !== null
      ? (c.jaRecebidoTotal ?? 0) + (c.aReceber.total ?? 0)
      : null

  const nomesTribunais = grupos.slice(0, 5).map((g) => g.nome).join(' · ')
  const prox = proximosRecebimentos(c)[0]
  const proxDias = prox ? emDias(c, prox.p.expectativa_liquidacao) : null
  const proxVencido = proxDias !== null && proxDias < 0

  const cartaoProximo = prox
    ? `<div class="kpi-card kc-light" style="border:1.5px solid ${proxVencido ? '#E24B4A' : '#EF9F27'}">
      <div class="kpi-label">${proxVencido ? 'Recebimento em atraso' : 'Próximo recebimento'}</div>
      <div class="kpi-value" style="color:${proxVencido ? '#E24B4A' : '#8B5E00'};font-size:12px">${esc(formatDate(prox.p.expectativa_liquidacao))}</div>
      <div class="kpi-sub" style="color:${proxVencido ? '#E24B4A' : '#8B5E00'};font-weight:600">${esc(prox.p.cedente ?? 'Cedente não cadastrado')}${prox.p.tribunal ? ` (${esc(prox.p.tribunal)})` : ''} · est. ${esc(brlCurto(prox.proj.valor))} · ${esc(prazoTexto(proxDias))}</div>
    </div>`
    : `<div class="kpi-card kc-light">
      <div class="kpi-label">Próximo recebimento</div>
      <div class="kpi-value">—</div>
      <div class="kpi-sub">Nenhuma operação em aberto nesta carteira.</div>
    </div>`

  return `<div class="section">
  <div class="sec-title">Parecer consolidado</div>
  <div class="kpi-top">
    <div class="kpi-card kc-navy">
      <div class="kpi-label">Capital investido total</div>
      <div class="kpi-value">${esc(formatBRL(c.capitalTotal))}</div>
      <div class="kpi-sub">${esc(plural(c.linhas.length, 'operação', 'operações'))}${nomesTribunais ? ` · ${esc(nomesTribunais)}` : ''}</div>
      <span class="kpi-badge badge-neutral">Neutro · referência</span>
    </div>
    <div class="kpi-card kc-darknavy">
      <div class="kpi-label">TIR consolidada</div>
      <div class="kpi-value">${esc(formatPercent(tirValor))}${tirValor === null ? '' : ' a.a.'}</div>
      <div class="kpi-sub">${
        c.tirMedia.prazoMedioDias === null
          ? 'sem prazo calculável'
          : `carteira como fluxo único · prazo médio de ${esc(plural(c.tirMedia.prazoMedioDias, 'dia', 'dias'))} · ${c.tirMedia.considerados} de ${c.linhas.length} operações`
      }</div>
      ${seloTir}
    </div>
    <div class="kpi-card kc-green">
      <div class="kpi-label">Ganho de capital projetado</div>
      <div class="kpi-value">${esc(formatBRL(c.ganhoTotal))}</div>
      <div class="kpi-sub">${
        c.retornoCarteira.valor === null
          ? 'sem retorno calculável'
          : `${c.retornoCarteira.valor >= 0 ? '+ ' : ''}${esc(formatPercent(c.retornoCarteira.valor))} sobre o capital investido`
      }</div>
      <span class="kpi-badge ${c.ganhoTotal !== null && c.ganhoTotal < 0 ? 'badge-neg' : 'badge-pos'}">${
        c.ganhoTotal === null
          ? 'Sem base para calcular'
          : c.ganhoTotal < 0
            ? 'Resultado negativo'
            : 'Resultado positivo'
      }</span>
    </div>
  </div>
  <div class="kpi-bottom">
    <div class="kpi-card kc-light">
      <div class="kpi-label">Já recebido</div>
      <div class="kpi-value">${esc(formatBRL(c.jaRecebidoTotal))}</div>
      <div class="kpi-sub">${esc(plural(c.liquidadas, 'operação liquidada', 'operações liquidadas'))}</div>
    </div>
    <div class="kpi-card kc-light">
      <div class="kpi-label">A receber estimado</div>
      <div class="kpi-value">${esc(formatBRL(c.aReceber.total))}</div>
      <div class="kpi-sub">${esc(
        [
          c.aReceber.emAberto > 0 && plural(c.aReceber.emAberto, 'em aberto', 'em aberto'),
          c.aReceber.complementares > 0 &&
            plural(c.aReceber.complementares, 'complementar', 'complementares'),
          c.aReceber.incalculaveis > 0 &&
            `${plural(c.aReceber.incalculaveis, 'operação', 'operações')} sem projeção calculável`,
        ]
          .filter(Boolean)
          .join(' + ') || 'nada a receber nesta carteira',
      )}</div>
    </div>
    <div class="kpi-card kc-light">
      <div class="kpi-label">Resultado bruto da carteira</div>
      <div class="kpi-value">${esc(formatBRL(resultadoBruto))}</div>
      <div class="kpi-sub">Recebido + a receber estimado</div>
    </div>
    ${cartaoProximo}
  </div>
</div>`
}

function bloco2(c: CarteiraCalculada, grupos: GrupoTribunal[], total: number, foraN: number): string {
  const legenda = grupos
    .map(
      (g) =>
        `<div style="display:flex;align-items:center;gap:6px;margin-bottom:7px"><div style="width:9px;height:9px;border-radius:50%;background:${g.cor.linha};flex-shrink:0"></div><div><div style="font-weight:600">${esc(g.nome)} — ${esc(plural(g.n, 'operação', 'operações'))}</div><div style="font-size:9px;color:#5F5E5A">${(g.fracao * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}% · ${esc(brlCurto(g.capital))}</div></div></div>`,
    )
    .join('')

  const novas = novasDoCiclo(c)
  const caixaNovas =
    novas.length > 0
      ? `<div style="margin-top:9px;padding:7px 9px;background:#E8F5E0;border-radius:4px;font-size:9px;color:#2E6B04">
            <strong style="display:block;margin-bottom:2px">Novas operações em ${esc(c.mesRef)}</strong>
            ${esc(novas.map((l) => `${l.p.cedente ?? 'sem cedente'} (${l.p.tribunal ?? 'sem tribunal'})`).join(' · '))}
          </div>`
      : ''

  const caixaFora =
    foraN > 0
      ? `<div style="margin-top:9px;padding:7px 9px;background:#F1EFE8;border-radius:4px;font-size:9px;color:#5F5E5A">
            ${esc(plural(foraN, 'operação', 'operações'))} fora deste gráfico por não ter capital investido cadastrado.
          </div>`
      : ''

  const proximos = proximosRecebimentos(c).slice(0, 5)
  const maiorValor = Math.max(1, ...proximos.map((l) => l.proj.valor ?? 0))
  const barras = proximos
    .map((l) => {
      const dias = emDias(c, l.p.expectativa_liquidacao)
      const urgente = dias !== null && dias <= 30
      const largura = Math.max(12, Math.round(((l.proj.valor ?? 0) / maiorValor) * 100))
      const cor = corDoTribunal(grupos, l.p.tribunal)
      return `<div style="margin-bottom:6px"><div style="display:flex;justify-content:space-between;gap:8px;font-size:9px;margin-bottom:2px"><span style="font-weight:600${urgente ? ';color:#E24B4A' : ''}">${esc(l.p.cedente ?? 'Cedente não cadastrado')}${l.p.tribunal ? ` · ${esc(l.p.tribunal)}` : ''}</span><span style="color:${urgente ? '#E24B4A' : '#378ADD'};font-size:8px;font-weight:600;white-space:nowrap">${esc(formatDate(l.p.expectativa_liquidacao))} · ${esc(prazoTexto(dias))}</span></div><div style="background:#eee;border-radius:3px;height:4px"><div style="background:${cor.linha};border-radius:3px;height:4px;width:${largura}%"></div></div><div style="font-size:8px;color:#5F5E5A;margin-top:1px">${esc(brlCurto(l.proj.valor))} · ${esc(formatPercent(l.tir.anual))} a.a.</div></div>`
    })
    .join('')

  const comComplementar = c.linhas.filter(
    (l) => typeof l.p.valor_estimado_complementar === 'number' && l.p.valor_estimado_complementar > 0,
  )
  const somaComplementar = comComplementar.reduce(
    (s, l) => s + (l.p.valor_estimado_complementar ?? 0),
    0,
  )
  const caixaComplementar =
    comComplementar.length > 0
      ? `<div style="padding:6px 8px;background:#FEF5E6;border-radius:4px;font-size:9px;color:#8B5E00">
        <strong style="display:block;margin-bottom:1px">Complementares · ${esc(formatBRL(somaComplementar))} em ${esc(plural(comComplementar.length, 'operação', 'operações'))}</strong>
        ${esc(comComplementar.map((l) => `${l.p.cedente ?? 'sem cedente'} (${formatBRL(l.p.valor_estimado_complementar)})`).join(' · '))}
      </div>`
      : ''

  const grafico = donut(grupos, total)
  if (!grafico && proximos.length === 0 && !caixaComplementar) return ''

  return `<div class="divider"></div>
<div class="section">
  <div class="sec-title">Visão gráfica</div>
  <div class="visual-grid">
    <div class="chart-box">
      <div class="chart-title">Composição por tribunal · capital investido</div>
      ${
        grafico
          ? `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <div style="flex-shrink:0">${grafico}</div>
        <div style="flex:1;min-width:160px;font-size:10px">${legenda}${caixaNovas}${caixaFora}</div>
      </div>`
          : `<div style="font-size:10px;color:#5F5E5A">Nenhuma operação com capital investido cadastrado.</div>${caixaNovas}`
      }
    </div>
    <div class="chart-box">
      <div class="chart-title">Próximos recebimentos · barra proporcional ao valor estimado</div>
      ${barras || '<div style="font-size:10px;color:#5F5E5A;margin-bottom:8px">Nenhuma operação em aberto.</div>'}
      ${caixaComplementar}
    </div>
  </div>
</div>`
}

function bloco3(c: CarteiraCalculada): string {
  const e = evolucao(c)
  if (!e) return ''
  return `<div class="divider"></div>
<div class="section">
  <div class="sec-title">Evolução da carteira</div>
  <div class="evo-section">
    <div class="evo-legend">
      <div class="evo-leg-item"><svg width="24" height="4" aria-hidden="true"><line x1="0" y1="2" x2="24" y2="2" stroke="#042C53" stroke-width="2.5" stroke-dasharray="6,3"/></svg>Capital comprometido</div>
      <div class="evo-leg-item"><svg width="24" height="4" aria-hidden="true"><line x1="0" y1="2" x2="24" y2="2" stroke="#97C459" stroke-width="2.5"/></svg>Recebido acumulado</div>
      <div class="evo-leg-item"><svg width="24" height="4" aria-hidden="true"><line x1="0" y1="2" x2="24" y2="2" stroke="#85B7EB" stroke-width="2" stroke-dasharray="5,3"/></svg>Projetado acumulado</div>
      <div class="evo-leg-item" style="margin-left:auto"><svg width="2" height="14" aria-hidden="true"><line x1="1" y1="0" x2="1" y2="14" stroke="#E24B4A" stroke-width="1.5" stroke-dasharray="3,2"/></svg>&nbsp;Hoje (${esc(formatDate(c.hoje))})</div>
    </div>
    ${graficoEvolucao(e)}
  </div>
</div>`
}

function bloco4(c: CarteiraCalculada, grupos: GrupoTribunal[]): string {
  if (c.linhas.length === 0) return ''
  // Em aberto primeiro, da expectativa mais próxima para a mais distante; depois
  // as liquidadas, da mais recente para a mais antiga. É a ordem de quem lê:
  // "o que vem aí" antes de "o que já aconteceu".
  const abertas = proximosRecebimentos(c)
  const pagas = c.linhas
    .filter((l) => l.pago)
    .sort((a, b) =>
      (b.p.data_liquidacao ?? '').localeCompare(a.p.data_liquidacao ?? ''),
    )

  const linha = (l: LinhaCarteira) => {
    const sem = SEMAFORO[l.status.tone] ?? SEMAFORO.gray
    const cor = corDoTribunal(grupos, l.p.tribunal)
    const dias = emDias(c, l.p.expectativa_liquidacao)
    const urgente = !l.pago && dias !== null && dias <= 30
    const fundo = l.pago ? '#FAFAF8' : urgente ? '#FFF5F5' : ''
    const comp = l.p.valor_estimado_complementar
    return `<tr${fundo ? ` style="background:${fundo}"` : ''}>
          <td><div style="font-weight:600">${esc(l.p.cedente ?? 'Cedente não cadastrado')}${l.p.tribunal ? `<span class="trib-badge" style="background:${cor.selo};color:${cor.tinta}">${esc(l.p.tribunal)}</span>` : ''}</div><div class="process-num">${esc(formatCNJ(l.p.numero_cnj))}</div></td>
          <td><div style="font-weight:600">${esc(formatBRL(l.p.capital_investido))}</div><div style="font-size:7px;color:#888">${esc(formatDate(l.p.data_aquisicao))}</div></td>
          <td><div style="font-weight:600">${esc(formatBRL(l.proj.valor))}</div><span class="tag ${l.pago ? 'tag-efetivado' : 'tag-proj'}">${l.pago ? 'Efetivado' : 'Proj.'}</span>${
            typeof comp === 'number' && comp > 0
              ? `<div style="font-size:7px;color:#639922">+ ${esc(formatBRL(comp))} compl.</div>`
              : ''
          }</td>
          <td>${l.dias ?? '—'}</td>
          <td>${l.tir.anual === null ? '<span style="color:#888">—</span>' : `<span class="tir-badge ${l.tir.anual >= 0 ? 'tir-up' : 'tir-down'}">${esc(formatPercent(l.tir.anual))}</span>`}</td>
          <td><div class="${sem.classe}">${sem.glifo} ${esc(l.status.label)}</div></td>
          <td style="white-space:nowrap">${
            l.pago
              ? `<span style="font-size:7px;color:#639922">Pago ${esc(formatDate(l.p.data_liquidacao))}</span>`
              : l.p.expectativa_liquidacao
                ? `<span style="color:${urgente ? '#E24B4A' : '#378ADD'};font-weight:600">${esc(dataCurta(l.p.expectativa_liquidacao))}</span><br><span style="font-size:7px">${esc(prazoTexto(dias))}</span>`
                : '<span style="font-size:7px;color:#888">sem previsão</span>'
          }</td>
        </tr>`
  }

  return `<div class="divider"></div>
<div class="section">
  <div class="sec-title">Painel de operações</div>
  <div class="ops-table-wrap">
    <table class="ops-table">
      <thead><tr><th>Cedente / processo / tribunal</th><th>Capital · cessão</th><th>Valor</th><th>Dias em carteira</th><th>TIR a.a.</th><th>Status</th><th>Previsão</th></tr></thead>
      <tbody>
${[...abertas, ...pagas].map(linha).join('\n')}
      </tbody>
    </table>
  </div>
</div>`
}

function bloco5(c: CarteiraCalculada): string {
  // Quem ganha ficha: o que exige acompanhamento (vencido ou a menos de um mês)
  // e o que entrou neste ciclo. O resto está na tabela e não pede narrativa.
  const urgentes = c.linhas.filter(
    (l) => !l.pago && (l.status.tone === 'red' || l.status.tone === 'yellow'),
  )
  const novas = novasDoCiclo(c).filter((l) => !urgentes.includes(l))
  const escolhidas = [...urgentes, ...novas].slice(0, 8)
  if (escolhidas.length === 0) return ''

  const cartao = (l: LinhaCarteira) => {
    const nova = novas.includes(l)
    const classe =
      l.status.tone === 'red' ? 'card-red' : l.status.tone === 'yellow' ? 'card-amber' : 'card-blue'
    const glifo = nova ? '★' : (SEMAFORO[l.status.tone] ?? SEMAFORO.gray).glifo
    const dias = emDias(c, l.p.expectativa_liquidacao)
    const corpo =
      l.textos.estagio || l.textos.providencias
        ? `<div class="card-row">
        <div><div class="card-col-label">Estágio</div><div class="card-col-val">${esc(l.textos.estagio ?? '—')}</div></div>
        <div><div class="card-col-label">Providências</div><div class="card-col-val">${esc(l.textos.providencias ?? '—')}</div></div>
      </div>`
        : `<div class="card-col-val" style="color:#5F5E5A">Resumo ainda não gerado para este crédito.</div>`
    return `<div class="card ${classe}"><div class="card-header"><span>${glifo} ${esc(l.p.cedente ?? 'Cedente não cadastrado')}${l.p.tribunal ? ` · ${esc(l.p.tribunal)}` : ''}</span><span style="font-size:7px;font-weight:400">${nova ? `Nova · cessão ${esc(formatDate(l.p.data_aquisicao))} · ` : ''}${esc(prazoTexto(dias))}</span></div><div class="card-body">${corpo}<div style="font-size:8px;color:#888;margin-top:4px">${esc(formatCNJ(l.p.numero_cnj))} · últ. movimentação ${esc(formatDate(l.ultimaMovimentacao))}${l.p.cedente_advogado ? ` · adv. ${esc(l.p.cedente_advogado)}` : ''}</div></div></div>`
  }

  return `<div class="divider"></div>
<div class="section">
  <div class="sec-title">Detalhamento processual · operações que exigem acompanhamento</div>
  <div class="cards-grid">
${escolhidas.map(cartao).join('\n')}
  </div>
</div>`
}

function bloco6(c: CarteiraCalculada): string {
  const alertas: string[] = []
  const alerta = (tom: string, titulo: string, corpo: string) =>
    `<div class="alert alert-${tom}"><div class="alert-dot"></div><div><strong>${esc(titulo)}</strong>${esc(corpo)}</div></div>`

  if (c.liquidadas > 0) {
    const melhores = c.linhas
      .filter((l) => l.pago && l.tir.anual !== null)
      .sort((a, b) => (b.tir.anual ?? 0) - (a.tir.anual ?? 0))
      .slice(0, 4)
      .map((l) => `${l.p.cedente ?? 'sem cedente'} (${formatPercent(l.tir.anual)} a.a. · ${l.dias ?? '?'} dias)`)
      .join(' · ')
    alertas.push(
      alerta(
        'green',
        `Positivo · ${plural(c.liquidadas, 'operação liquidada', 'operações liquidadas')} · ${formatBRL(c.jaRecebidoTotal)} recebidos`,
        melhores ? `Destaques por taxa efetivada: ${melhores}.` : '',
      ),
    )
  }

  // O corpo destes alertas NÃO repete a narrativa: ela está inteira na ficha do
  // bloco anterior, e o mesmo parágrafo duas vezes na mesma página faz quem lê
  // desconfiar de que o documento foi montado no automático. Aqui vão só os
  // fatos que decidem prioridade — quanto, quando, e o que a cor significa.
  const alertaPrazo = (l: LinhaCarteira, tom: 'red' | 'amber', rotulo: string) => {
    const dias = emDias(c, l.p.expectativa_liquidacao)
    alertas.push(
      alerta(
        tom,
        `${rotulo} · ${l.p.cedente ?? 'sem cedente'}${l.p.tribunal ? ` · ${l.p.tribunal}` : ''} — ${prazoTexto(dias)} (${formatDate(l.p.expectativa_liquidacao)})`,
        `Valor estimado de ${brlCurto(l.proj.valor)} · capital de ${formatBRL(l.p.capital_investido)} · ${l.status.dica.toLowerCase()}. Estágio e providências na ficha desta operação, acima.`,
      ),
    )
  }
  for (const l of c.linhas.filter((x) => !x.pago && x.status.tone === 'red').slice(0, 4)) {
    alertaPrazo(l, 'red', 'Vencido')
  }
  for (const l of c.linhas.filter((x) => !x.pago && x.status.tone === 'yellow').slice(0, 4)) {
    alertaPrazo(l, 'amber', 'Acompanhar')
  }

  const novas = novasDoCiclo(c)
  if (novas.length > 0) {
    alertas.push(
      alerta(
        'blue',
        `★ ${plural(novas.length, 'nova operação', 'novas operações')} em ${c.mesRef}`,
        novas
          .map(
            (l) =>
              `${l.p.cedente ?? 'sem cedente'} (${formatBRL(l.p.capital_investido)} · ${formatPercent(l.tir.anual)} a.a. · est. ${formatDate(l.p.expectativa_liquidacao)})`,
          )
          .join(' · '),
      ),
    )
  }

  const comComplementar = c.linhas.filter(
    (l) => typeof l.p.valor_estimado_complementar === 'number' && l.p.valor_estimado_complementar > 0,
  )
  if (comComplementar.length > 0) {
    const soma = comComplementar.reduce((s, l) => s + (l.p.valor_estimado_complementar ?? 0), 0)
    alertas.push(
      alerta(
        'amber',
        `Complementares · ${formatBRL(soma)} em ${plural(comComplementar.length, 'operação', 'operações')}`,
        `${comComplementar.map((l) => `${l.p.cedente ?? 'sem cedente'} (${formatBRL(l.p.valor_estimado_complementar)})`).join(' · ')}. Incluídos no a receber estimado.`,
      ),
    )
  }

  const semProjecao = c.linhas.filter((l) => !l.pago && l.proj.valor === null)
  if (semProjecao.length > 0) {
    alertas.push(
      alerta(
        'red',
        `${plural(semProjecao.length, 'operação', 'operações')} sem valor projetado`,
        `${semProjecao.map((l) => `${l.p.cedente ?? 'sem cedente'}: ${l.proj.motivo ?? 'motivo não informado'}`).join(' · ')} Enquanto faltar o dado, estas operações ficam fora do a receber e da TIR consolidada.`,
      ),
    )
  }

  if (alertas.length === 0) return ''
  return `<div class="divider"></div>
<div class="section">
  <div class="sec-title">Alertas e eventos</div>
  ${alertas.join('\n  ')}
</div>`
}

function notaMetodologica(c: CarteiraCalculada): string {
  const pr = c.parametros
  const semCapital = c.linhas.filter(
    (l) => typeof l.p.capital_investido !== 'number' || l.p.capital_investido <= 0,
  ).length
  const cobertura: string[] = []
  if (semCapital > 0) {
    cobertura.push(
      `${plural(semCapital, 'operação', 'operações')} sem capital investido cadastrado — ficam fora do capital total, do retorno e da composição por tribunal.`,
    )
  }
  if (c.aReceber.incalculaveis > 0) {
    cobertura.push(
      `${plural(c.aReceber.incalculaveis, 'operação em aberto', 'operações em aberto')} sem projeção calculável (falta índice de atualização ou o parâmetro correspondente).`,
    )
  }
  if (c.tirMedia.considerados < c.linhas.length) {
    cobertura.push(
      `A TIR consolidada considera ${c.tirMedia.considerados} de ${c.linhas.length} operações; as demais não têm capital, valor ou prazo suficientes para entrar no fluxo.`,
    )
  }

  return `<div class="divider"></div>
<div class="section">
  <div class="nota">
    <p><strong>Nota metodológica · parâmetros e fórmulas</strong></p>
    <p><strong>Parâmetros utilizados:</strong> SELIC ${esc(formatPercent(pr?.selic_aa))} a.a. · IPCA 12 meses ${esc(formatPercent(pr?.ipca_12m_aa))} a.a. · IPCA + 2% ${esc(formatPercent(c.ipca2))} a.a. Data de referência dos cálculos: ${esc(formatDate(c.hoje))}.</p>
    <p><strong>Valor projetado:</strong> operação liquidada entra pelo valor efetivamente recebido — não se projeta o que já aconteceu. Operação em aberto tem o valor de face corrigido da data de referência do face até a data estimada de recebimento, a juros simples, pelo índice cadastrado no próprio crédito. Quando a data estimada já venceu e o crédito não foi pago, a correção segue até hoje.</p>
    <p><strong>TIR consolidada:</strong> a carteira é tratada como um fluxo único — (soma dos valores ÷ soma dos capitais) elevado a (365 ÷ prazo médio ponderado pelo capital), menos 1. Não é a média das TIRs individuais: média de taxas já anualizadas deixa uma operação de prazo curto dominar o resultado e superestima a carteira. A TIR de cada operação continua exibida individualmente na tabela.</p>
    <p><strong>Ganho e retorno:</strong> ganho = (valor projetado − capital investido) + complementar estimado. O retorno da carteira é a soma dos ganhos sobre a soma dos capitais, e não a média dos retornos — assim cada real investido pesa igual.</p>
    <p><strong>A receber estimado:</strong> valor projetado das operações em aberto mais o complementar declarado, liquidado ou não, porque o complementar é dinheiro por vir nos dois casos.</p>
    ${cobertura.length > 0 ? `<p><strong>Cobertura dos dados:</strong> ${esc(cobertura.join(' '))}</p>` : ''}
    <p><strong>Origem dos textos:</strong> estágio processual e providências são gerados a partir das movimentações do processo e revisados pela equipe. Todos os números deste relatório saem da mesma base e das mesmas fórmulas da plataforma de gestão — nenhum foi digitado à mão para este documento.</p>
  </div>
</div>`
}

// ---------------------------------------------------------------------------
// Documento
// ---------------------------------------------------------------------------

const CSS = `*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,Helvetica,sans-serif;background:#f5f5f3;color:#333;font-size:14px;line-height:1.5}
.wrap{max-width:920px;margin:0 auto;background:#fff}
.marca{background:#fff;text-align:center;padding:18px 0 14px;line-height:0;border-bottom:1px solid #e8e8e6}
.marca img{height:46px;display:block;margin:0 auto}
.header{background:#042C53;padding:20px 28px;display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px}
.header-left .investor-name{color:#fff;font-size:17px;font-weight:700;margin-bottom:4px}
.header-left .subtitle{color:#85B7EB;font-size:13px}
.header-right{text-align:right}
.gen-date{color:#85B7EB;font-size:12px;margin-bottom:6px}
.header-meta{display:flex;gap:14px;flex-wrap:wrap;justify-content:flex-end}
.hm-item .hm-val{color:#fff;font-size:13px;font-weight:700}
.hm-item .hm-lab{color:#85B7EB;font-size:11px}
.section{padding:20px 28px}
.sec-title{font-size:13px;font-weight:700;color:#5F5E5A;text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid #ddd;padding-bottom:8px;margin-bottom:14px}
.kpi-top{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px}
.kpi-bottom{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.kpi-card{border-radius:6px;padding:14px}
.kc-navy{background:#042C53;color:#fff}
.kc-darknavy{background:#0A3D6B;color:#fff}
.kc-green{background:#173404;color:#fff}
.kc-light{background:#F1EFE8;color:#333}
.kpi-label{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;opacity:.75;margin-bottom:4px}
.kpi-value{font-size:19px;font-weight:700;margin-bottom:3px}
.kpi-sub{font-size:11px;opacity:.85;margin-bottom:6px}
.kpi-badge{display:inline-block;padding:2px 7px;border-radius:3px;font-size:10px;font-weight:600}
.badge-neutral{background:rgba(255,255,255,.15);color:#fff}
.badge-pos{background:#639922;color:#fff}
.badge-neg{background:#E24B4A;color:#fff}
.badge-above-cdi{background:#97C459;color:#173404}
.kc-light .kpi-label{color:#5F5E5A}
.kc-light .kpi-value{color:#042C53;font-size:16px}
.kc-light .kpi-sub{color:#5F5E5A}
.visual-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;align-items:start}
.chart-box{background:#FAFAF8;border-radius:6px;padding:14px}
.chart-title{font-size:10px;font-weight:700;color:#5F5E5A;text-transform:uppercase;letter-spacing:.4px;margin-bottom:8px}
.evo-section{background:#FAFAF8;border-radius:6px;padding:14px}
.evo-legend{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:8px}
.evo-leg-item{display:flex;align-items:center;gap:5px;font-size:11px;color:#5F5E5A}
.ops-table-wrap{overflow-x:auto}
table.ops-table{width:100%;border-collapse:collapse;font-size:8.5px}
.ops-table th{background:#042C53;color:#85B7EB;font-weight:600;padding:4px 5px;text-align:left;white-space:nowrap;font-size:8px}
.ops-table td{padding:4px 5px;border-bottom:1px solid #eee;vertical-align:top}
.process-num{font-size:7px;color:#888;margin-top:1px}
.tag{display:inline-block;padding:1px 3px;border-radius:3px;font-size:7px;font-weight:600;white-space:nowrap}
.tag-proj{background:#E1F5EE;color:#085041}
.tag-efetivado{background:#EEEDFE;color:#3C3489}
.sem-verde{color:#3F7A00;font-weight:700;font-size:8.5px;white-space:nowrap}
.sem-vermelho{color:#C7302F;font-weight:700;font-size:8.5px;white-space:nowrap}
.sem-azul{color:#2C6FB5;font-weight:700;font-size:8.5px;white-space:nowrap}
.sem-amber{color:#8B5E00;font-weight:700;font-size:8.5px;white-space:nowrap}
.sem-cinza{color:#5F5E5A;font-weight:700;font-size:8.5px;white-space:nowrap}
.trib-badge{display:inline-block;padding:0 3px;border-radius:2px;font-size:7px;font-weight:700;margin-left:3px;white-space:nowrap}
.tir-badge{display:inline-block;padding:1px 3px;border-radius:3px;font-size:7px;font-weight:600;white-space:nowrap}
.tir-up{background:#E8F5E0;color:#2E6B04}
.tir-down{background:#FEECEC;color:#A81F1E}
.cards-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.card{border-radius:6px;overflow:hidden;border:1px solid #eee}
.card-header{padding:8px 10px;font-weight:700;font-size:9px;display:flex;justify-content:space-between;align-items:center;gap:8px}
.card-body{padding:9px;background:#fff;font-size:9px}
.card-row{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:4px}
.card-col-label{font-size:8px;font-weight:600;color:#5F5E5A;text-transform:uppercase;letter-spacing:.4px;margin-bottom:2px}
.card-col-val{color:#333;line-height:1.4}
.card-blue .card-header{background:#2C6FB5;color:#fff}
.card-amber .card-header{background:#8B5E00;color:#fff}
.card-red .card-header{background:#C7302F;color:#fff}
.alert{display:flex;align-items:flex-start;gap:8px;padding:9px 11px;border-radius:5px;margin-bottom:6px;font-size:10px}
.alert-dot{width:6px;height:6px;border-radius:50%;margin-top:4px;flex-shrink:0}
.alert-green{background:#F0F7E8}.alert-green .alert-dot{background:#639922}
.alert-amber{background:#FEF5E6}.alert-amber .alert-dot{background:#EF9F27}
.alert-blue{background:#E8F2FC}.alert-blue .alert-dot{background:#378ADD}
.alert-red{background:#FEECEC}.alert-red .alert-dot{background:#E24B4A}
.alert strong{display:block;margin-bottom:2px}
.nota{background:#F1EFE8;border-radius:6px;padding:12px 14px;font-size:10px;color:#5F5E5A;line-height:1.6}
.nota strong{color:#333}
.nota p{margin-bottom:5px}
.nota p:last-child{margin-bottom:0}
.footer{background:#042C53;padding:12px 28px;text-align:center;color:#85B7EB;font-size:11px;line-height:1.8}
.divider{height:1px;background:#e8e8e6;margin:0}
@media print{body{background:#fff}.wrap{max-width:100%}.section{break-inside:avoid}.card{break-inside:avoid}}
@media (max-width:640px){
  .header{flex-direction:column}.header-right{text-align:left}.header-meta{justify-content:flex-start}
  .kpi-top{grid-template-columns:1fr 1fr}.kpi-bottom{grid-template-columns:1fr 1fr}
  .visual-grid{grid-template-columns:1fr}.cards-grid{grid-template-columns:1fr}.card-row{grid-template-columns:1fr}
}`

export interface OpcoesRelatorio {
  /** Marca em data: URI. Sem ela o cabeçalho sai só com o texto. */
  logoDataUri?: string
}

/**
 * O relatório inteiro, como uma string de HTML autocontido.
 *
 * Função PURA: não toca no DOM, não busca nada, não lê a data do sistema. Tudo
 * o que ela sabe vem de `c` — inclusive o "hoje", que a tela congelou. É o que
 * torna o relatório testável e o que garante que dois cliques no mesmo segundo
 * produzam exatamente o mesmo arquivo.
 */
export function gerarRelatorioCarteiraHtml(
  c: CarteiraCalculada,
  opts: OpcoesRelatorio = {},
): string {
  const { grupos, total, foraN } = porTribunal(c)
  const titulo = `Credijuris · Carteira do Investidor · ${c.investidor} · ${c.mesRef}`
  const meta: [string, string][] = [
    [String(c.linhas.length), c.linhas.length === 1 ? 'Operação' : 'Operações'],
    [formatPercent(c.parametros?.selic_aa), 'SELIC a.a.'],
    [formatPercent(c.parametros?.ipca_12m_aa), 'IPCA a.a.'],
    [formatPercent(c.ipca2), 'IPCA+2% a.a.'],
  ]

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(titulo)}</title>
<style>
${CSS}
</style>
</head>
<body>
<div class="wrap">
${opts.logoDataUri ? `<div class="marca"><img src="${esc(opts.logoDataUri)}" alt="Credijuris"></div>` : ''}
<div class="header">
  <div class="header-left">
    <div class="investor-name">${esc(c.investidor)}</div>
    <div class="subtitle">Credijuris · Carteira do investidor · ${esc(c.mesRef)}</div>
  </div>
  <div class="header-right">
    <div class="gen-date">Gerado em ${esc(formatDate(c.hoje))}</div>
    <div class="header-meta">
${meta.map(([v, l]) => `      <div class="hm-item"><div class="hm-val">${esc(v)}</div><div class="hm-lab">${esc(l)}</div></div>`).join('\n')}
    </div>
  </div>
</div>

${bloco1(c, grupos)}
${bloco2(c, grupos, total, foraN)}
${bloco3(c)}
${bloco4(c, grupos)}
${bloco5(c)}
${bloco6(c)}
${notaMetodologica(c)}

<div class="footer">
  <div>Credijuris Créditos Judiciais</div>
  <div>R. Felipe dos Santos, 825, Sala 203 · Belo Horizonte / MG</div>
  <div>contato@credijuris.com · credijuris.com · 31 97228-3172</div>
</div>
</div>
</body>
</html>
`
}

// ---------------------------------------------------------------------------
// Mensagem de acompanhamento
// ---------------------------------------------------------------------------

/**
 * O texto que acompanha o relatório no WhatsApp.
 *
 * Só números que estão no relatório, escritos da mesma forma. A versão curta é
 * a que cabe numa notificação sem cortar; a longa entra quando o investidor
 * pede detalhe. Nenhuma das duas promete data de pagamento — o que existe é
 * expectativa, e a mensagem diz isso com essa palavra.
 */
export function mensagemWhatsapp(c: CarteiraCalculada, opcoes: { curta?: boolean } = {}): string {
  const primeiroNome = c.investidor.trim().split(/\s+/)[0] || c.investidor
  const prox = proximosRecebimentos(c)[0]
  const proxDias = prox ? emDias(c, prox.p.expectativa_liquidacao) : null

  if (opcoes.curta) {
    return [
      `Olá, ${primeiroNome}! Segue o relatório da sua carteira — ${c.mesRef}.`,
      '',
      `• Capital investido: ${formatBRL(c.capitalTotal)}`,
      `• TIR consolidada: ${formatPercent(c.tirMedia.valor)} a.a.`,
      `• Já recebido: ${formatBRL(c.jaRecebidoTotal)}`,
      `• A receber estimado: ${formatBRL(c.aReceber.total)}`,
      '',
      'O arquivo em anexo tem o detalhe operação por operação. Qualquer dúvida, é só chamar.',
    ].join('\n')
  }

  const linhas = [
    `Olá, ${primeiroNome}! Segue o relatório da sua carteira referente a ${c.mesRef}.`,
    '',
    `*Posição consolidada*`,
    `• Capital investido: ${formatBRL(c.capitalTotal)} em ${plural(c.linhas.length, 'operação', 'operações')}`,
    `• TIR consolidada: ${formatPercent(c.tirMedia.valor)} a.a.`,
    `• Ganho de capital projetado: ${formatBRL(c.ganhoTotal)}${
      c.retornoCarteira.valor === null ? '' : ` (${formatPercent(c.retornoCarteira.valor)} sobre o capital)`
    }`,
    `• Já recebido: ${formatBRL(c.jaRecebidoTotal)} em ${plural(c.liquidadas, 'operação liquidada', 'operações liquidadas')}`,
    `• A receber estimado: ${formatBRL(c.aReceber.total)}`,
  ]

  if (prox) {
    linhas.push(
      '',
      proxDias !== null && proxDias < 0 ? '*Recebimento em atraso*' : '*Próximo recebimento*',
      `${prox.p.cedente ?? 'operação em aberto'}${prox.p.tribunal ? ` (${prox.p.tribunal})` : ''} — expectativa em ${formatDate(prox.p.expectativa_liquidacao)}, ${prazoTexto(proxDias)}, valor estimado de ${brlCurto(prox.proj.valor)}.`,
    )
  }

  const novas = novasDoCiclo(c)
  if (novas.length > 0) {
    linhas.push(
      '',
      `*${plural(novas.length, 'nova operação', 'novas operações')} neste ciclo*`,
      novas
        .map((l) => `• ${l.p.cedente ?? 'sem cedente'} — ${formatBRL(l.p.capital_investido)}`)
        .join('\n'),
    )
  }

  linhas.push(
    '',
    'O arquivo em anexo traz o detalhe de cada operação, o estágio processual e as providências em curso. Os valores em aberto são estimativas de recebimento, não datas garantidas de pagamento.',
    '',
    'Qualquer dúvida, é só chamar.',
  )
  return linhas.join('\n')
}

// ---------------------------------------------------------------------------
// Entrega no navegador
// ---------------------------------------------------------------------------

/** Nome de arquivo sem acento nem barra: ele circula entre sistemas. */
function slug(nome: string): string {
  return (
    nome
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase() || 'investidor'
  )
}

/**
 * A marca como data: URI.
 *
 * NÃO dá para usar `?inline` aqui. No Vite esse sufixo vale para CSS; num .png
 * ele devolve a URL do arquivo com hash no nome, e o relatório sairia com
 * `<img src="/assets/logo-abc123.png">` — que funciona na aba aberta a partir
 * do sistema e quebra no instante em que alguém abre o arquivo salvo, que é
 * justamente o uso: o investidor recebe o .html e abre no celular.
 *
 * Então a imagem é buscada e convertida na hora. Falhou a busca, o relatório
 * sai sem marca — melhor que um ícone quebrado no topo de um documento
 * financeiro.
 */
async function marcaEmDataUri(): Promise<string | undefined> {
  try {
    const { default: url } = await import('@/assets/logo-credijuris.png')
    const resp = await fetch(url)
    if (!resp.ok) return undefined
    const blob = await resp.blob()
    return await new Promise<string | undefined>((resolve) => {
      const fr = new FileReader()
      fr.onload = () => resolve(typeof fr.result === 'string' ? fr.result : undefined)
      fr.onerror = () => resolve(undefined)
      fr.readAsDataURL(blob)
    })
  } catch {
    return undefined
  }
}

/**
 * Gera, baixa e abre o relatório numa aba nova.
 *
 * Baixa E abre: o arquivo é o que vai para o investidor, e a aba é para quem
 * gerou conferir antes de enviar. Se o navegador bloquear a aba, o download já
 * aconteceu — por isso ele vem primeiro.
 */
export async function baixarRelatorioCarteira(c: CarteiraCalculada): Promise<void> {
  const html = gerarRelatorioCarteiraHtml(c, { logoDataUri: await marcaEmDataUri() })
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)

  const a = document.createElement('a')
  a.href = url
  a.download = `relatorio-${slug(c.investidor)}-${c.hoje.slice(0, 7)}.html`
  // Os dois cuidados que já falharam na prática no exportador de Excel: o <a>
  // precisa estar NO documento, e revogar a URL logo após o clique cancela o
  // download, porque o clique apenas agenda a transferência.
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()

  window.open(url, '_blank', 'noopener')
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
