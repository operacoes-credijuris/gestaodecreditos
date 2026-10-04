// Os gráficos do Quadro econômico, no desenho da amostra (graficos.js): poucos
// tipos e as mesmas regras em todos — barras de até 24px com a ponta
// arredondada, linhas de 2px, grade discreta, um eixo só, legenda a partir de
// duas séries e o valor exato ao passar o mouse. As contas moram em
// lib/graficosDoQuadro.ts; aqui só se desenha.
//
// EVOLUÇÃO, HISTOGRAMA E RANKING SÃO OS ITENS "NOVO" da amostra: a plataforma
// não os tinha, e eles saem das datas e valores já cadastrados.

import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip,
  CartesianGrid, LabelList,
} from 'recharts'
import { useState } from 'react'
import { useCoresDoGrafico, type CoresDoGrafico } from '@/lib/chartColors'
import {
  brlAbreviado, cabeRotuloNaBarra, valorAbreviado, type FaixaDoHistograma, type PontoDaEvolucao,
} from '@/lib/graficosDoQuadro'
import { formatBRL } from '@/lib/format'
import { DicaDoGrafico, LegendaDoGrafico } from './compartilhado'

/** O texto dos eixos, na cor de rótulo do tema que se vê. */
const eixo = (cores: CoresDoGrafico) => ({ fontSize: 11, fill: cores.label })

/** "2026-10" → "out" (o eixo da evolução) */
function mesCurto(ym: string): string {
  const [ano, mes] = ym.split('-').map(Number)
  return new Date(ano, mes - 1, 1).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')
}

/** "2026-10" → "outubro de 2026" (a dica da evolução) */
function mesLongo(ym: string): string {
  const [ano, mes] = ym.split('-').map(Number)
  return new Date(ano, mes - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
}

/**
 * "Capital investido e já recebido": as duas linhas acumuladas no mesmo eixo,
 * com o valor final escrito na ponta de cada uma e a cruz com os valores do mês
 * sob o mouse.
 */
export function GraficoEvolucao({ pontos }: { pontos: PontoDaEvolucao[] }) {
  const CHART = useCoresDoGrafico()
  const EIXO = eixo(CHART)
  const dados = pontos.map((p) => ({ ...p, rotulo: mesCurto(p.mes), titulo: mesLongo(p.mes) }))
  const ultimo = dados.length - 1
  const series = [
    { chave: 'capital', nome: 'Capital investido', cor: CHART.series[0] },
    { chave: 'recebido', nome: 'Já recebido', cor: CHART.series[1] },
  ] as const
  const fim = dados[ultimo]
  return (
    <div className="px-s5 pb-s5">
      <LegendaDoGrafico itens={series.map((s) => ({ nome: s.nome, cor: s.cor }))} />
      <div
        className="h-[240px]"
        role="img"
        aria-label={
          fim
            ? `Capital investido e já recebido, acumulados mês a mês. Em ${fim.titulo}: ` +
              `capital ${formatBRL(fim.capital)}, recebido ${formatBRL(fim.recebido)}.`
            : 'Capital investido e já recebido, acumulados mês a mês.'
        }
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={dados} margin={{ top: 12, right: 72, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={CHART.grid} vertical={false} />
            <XAxis
              dataKey="rotulo"
              tick={EIXO}
              tickLine={false}
              axisLine={{ stroke: CHART.axis }}
              interval="preserveStartEnd"
              minTickGap={12}
            />
            <YAxis tick={EIXO} tickLine={false} axisLine={false} width={64} tickFormatter={brlAbreviado} />
            <Tooltip
              cursor={{ stroke: CHART.label, strokeWidth: 1 }}
              content={(p) => (
                <DicaDoGrafico
                  active={p.active}
                  payload={p.payload as never}
                  label={(p.payload?.[0]?.payload as { titulo?: string } | undefined)?.titulo ?? p.label}
                  formatar={(v) => formatBRL(v)}
                />
              )}
            />
            {series.map((s) => (
              <Line
                key={s.chave}
                type="linear"
                dataKey={s.chave}
                name={s.nome}
                stroke={s.cor}
                strokeWidth={2}
                isAnimationActive={false}
                activeDot={{ r: 4, stroke: CHART.surface, strokeWidth: 2 }}
                // SÓ O PONTO FINAL, com o valor escrito ao lado: o olho compara
                // onde cada linha chegou sem precisar passar o mouse.
                dot={(d: { cx?: number; cy?: number; index?: number }) =>
                  d.index === ultimo ? (
                    <circle key={d.index} cx={d.cx} cy={d.cy} r={4} fill={s.cor} stroke={CHART.surface} strokeWidth={2} />
                  ) : (
                    <g key={d.index} />
                  )
                }
              >
                <LabelList
                  dataKey={s.chave}
                  content={(l: { x?: number | string; y?: number | string; index?: number; value?: number | string }) =>
                    l.index === ultimo ? (
                      <text
                        x={Number(l.x) + 8}
                        y={Number(l.y) + 4}
                        fontSize={12}
                        fontWeight={700}
                        fill={CHART.ink}
                      >
                        {brlAbreviado(Number(l.value))}
                      </text>
                    ) : null
                  }
                />
              </Line>
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

/** "Como a rentabilidade se distribui": quantas encerradas caem em cada faixa. */
export function Histograma({ faixas }: { faixas: FaixaDoHistograma[] }) {
  const CHART = useCoresDoGrafico()
  const EIXO = eixo(CHART)
  const total = faixas.reduce((s, f) => s + f.operacoes, 0)
  return (
    <div
      className="h-[220px] px-s5 pb-s5"
      role="img"
      aria-label={
        `Distribuição da rentabilidade total de ${total} operações encerradas: ` +
        faixas.map((f) => `${f.rotulo}, ${f.operacoes}`).join('; ') + '.'
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={faixas} margin={{ top: 12, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={CHART.grid} vertical={false} />
          <XAxis dataKey="rotulo" tick={EIXO} tickLine={false} axisLine={{ stroke: CHART.axis }} interval={0} />
          {/* Contagem: só inteiros. Meia operação não existe. */}
          <YAxis tick={EIXO} tickLine={false} axisLine={false} allowDecimals={false} width={40} />
          <Tooltip
            cursor={{ fill: CHART.grid, fillOpacity: 0.5 }}
            content={(p) => (
              <DicaDoGrafico
                active={p.active}
                payload={p.payload as never}
                label={p.label}
                formatar={(v) => String(Math.round(v))}
              />
            )}
          />
          <Bar dataKey="operacoes" name="Operações" fill={CHART.primary} maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/**
 * "Operações a receber por mês" (Previsões): a ALTURA é o número de operações
 * e o valor curto ("84 mil") vai escrito acima da barra quando cabe; o exato e
 * a quantidade aparecem ao passar o mouse. Uma variável, uma codificação: a cor é a mesma em todas as
 * barras e não disputa leitura com a altura.
 *
 * A contagem na altura compara melhor que o dinheiro: são inteiros pequenos, e
 * a diferença entre 2 e 5 operações se enxerga de longe. Já o valor varia em
 * ordens de grandeza, e é mais útil lido do que estimado numa régua.
 */
export function GraficoPrevisoes({
  dados,
}: {
  dados: Array<{ mes: string; valor: number; n: number }>
}) {
  const CHART = useCoresDoGrafico()
  const EIXO = eixo(CHART)
  // A LARGURA MEDIDA decide se o valor cabe acima das barras (Q1). Antes de
  // medir (0), nenhum rótulo: melhor do que piscar rótulos encavalados.
  const [largura, setLargura] = useState(0)
  const comRotulo = cabeRotuloNaBarra(
    largura - MARGEM_PREVISOES.left - MARGEM_PREVISOES.right - EIXO_Y_PREVISOES,
    dados.length,
  )
  return (
    <div className="px-s5 pb-s5">
      {/* A LEGENDA DIZ O QUE É A ALTURA (Q1): a barra conta operações, e o
          número em cima é dinheiro — duas grandezas no mesmo desenho. */}
      <div className="mb-s2 flex flex-wrap gap-x-s4 gap-y-s1 text-sm text-texto-2">
        <span className="inline-flex items-center gap-s1">
          <i className="h-[10px] w-[10px] shrink-0 rounded-[3px]" style={{ background: CHART.primary }} aria-hidden />
          Altura da barra: número de operações
        </span>
        <span className="text-texto-3">
          {comRotulo
            ? 'Acima da barra, o valor previsto; o exato, ao passar o mouse.'
            : 'O valor previsto de cada mês aparece ao passar o mouse.'}
        </span>
      </div>
      <div
        className="h-[236px]"
        role="img"
        aria-label={
          'Operações a receber por mês: ' +
          dados.map((d) => `${d.mes}, ${d.n} ${d.n === 1 ? 'operação' : 'operações'}, ${formatBRL(d.valor)}`).join('; ') + '.'
        }
      >
        <ResponsiveContainer width="100%" height="100%" onResize={(w) => setLargura(w)}>
          <BarChart data={dados} margin={MARGEM_PREVISOES}>
            <CartesianGrid stroke={CHART.grid} vertical={false} />
            <XAxis dataKey="mes" tick={EIXO} tickLine={false} axisLine={{ stroke: CHART.axis }} interval={0} />
            <YAxis tick={EIXO} tickLine={false} axisLine={false} allowDecimals={false} width={EIXO_Y_PREVISOES} />
            <Tooltip
              cursor={{ fill: CHART.grid, fillOpacity: 0.5 }}
              content={(p) => (
                <DicaDoGrafico
                  active={p.active}
                  payload={p.payload as never}
                  label={p.label}
                  formatar={(v) => String(Math.round(v))}
                  extra={(ponto) => {
                    const n = Number(ponto.n ?? 0)
                    return `${n} ${n === 1 ? 'operação' : 'operações'} · ${formatBRL(Number(ponto.valor ?? 0))}`
                  }}
                />
              )}
            />
            <Bar dataKey="n" name="Operações" fill={CHART.primary} maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {comRotulo && (
                <LabelList
                  dataKey="valor"
                  // UM <text> SÓ, SEM LARGURA: o rótulo padrão do Recharts recebe a
                  // largura da barra (24px) e quebra o texto nela — era o "R$ / 84
                  // / mil" em três linhas. Aqui ele fica numa linha, centrado na
                  // barra, 12px e algarismos de largura igual.
                  content={(l: { x?: number | string; y?: number | string; width?: number | string; value?: number | string }) => (
                    <text
                      x={Number(l.x) + Number(l.width) / 2}
                      y={Number(l.y) - 6}
                      textAnchor="middle"
                      fontSize={12}
                      fontWeight={600}
                      fill={CHART.label}
                      style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
                    >
                      {valorAbreviado(Number(l.value))}
                    </text>
                  )}
                />
              )}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

/** As medidas do gráfico das Previsões, que a conta do "cabe o rótulo?" usa. */
const MARGEM_PREVISOES = { top: 22, right: 8, bottom: 0, left: 0 }
const EIXO_Y_PREVISOES = 40

/**
 * "Capital por …" (Recortes): barras horizontais já ordenadas, com o valor na
 * ponta. Comparação é barra; ordenar ajuda a ler. A tabela completa vem logo
 * abaixo, então aqui basta o capital.
 */
export function Ranking({ itens }: { itens: Array<{ rotulo: string; valor: number }> }) {
  const CHART = useCoresDoGrafico()
  const max = Math.max(...itens.map((i) => i.valor), 1)
  return (
    <ol className="grid gap-s2 px-s5 pb-s5 pt-s1" aria-label="Capital por grupo, do maior para o menor">
      {itens.map((i) => (
        <li
          key={i.rotulo}
          // O NOME COLADO NA BARRA (auditoria visual, Q2): a coluna do nome
          // tinha 38% da largura, e um "TJGO" ficava a ~400px da própria barra.
          // Agora ela vai de 80 a 160px, com o nome alinhado à direita, encostado
          // na barra; nome mais longo corta com "…" e fica inteiro no `title`.
          className="grid grid-cols-[minmax(80px,160px)_1fr_auto] items-center gap-s3 text-sm"
          title={`${i.rotulo}: ${formatBRL(i.valor)}`}
        >
          <span className="truncate text-right text-texto">{i.rotulo}</span>
          <span className="h-[10px] overflow-hidden rounded-r-[4px] bg-superficie-3" aria-hidden>
            <i
              className="block h-full rounded-r-[4px]"
              style={{ width: `${Math.max(2, (Math.max(0, i.valor) / max) * 100)}%`, background: CHART.primary }}
            />
          </span>
          <span className="min-w-[72px] text-right font-bold tabular-nums text-texto">
            {brlAbreviado(i.valor)}
            <span className="sr-only"> ({formatBRL(i.valor)})</span>
          </span>
        </li>
      ))}
    </ol>
  )
}
