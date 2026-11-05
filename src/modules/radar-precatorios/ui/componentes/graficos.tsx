/**
 * Gráficos em SVG desenhados com as cores do tema (tokens CSS).
 * Um eixo por gráfico; legenda sempre presente com 2+ séries; mira com
 * leitura de todas as séries no ano; tabela equivalente sob cada gráfico.
 */
import React, { useLayoutEffect, useRef, useState } from 'react';

function useLargura<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(640);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const medir = () => setW(Math.max(260, Math.floor(el.getBoundingClientRect().width)));
    medir();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function passoBonito(max: number, alvoTicks = 4): number {
  if (max <= 0) return 1;
  const bruto = max / alvoTicks;
  const mag = Math.pow(10, Math.floor(Math.log10(bruto)));
  const n = bruto / mag;
  const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return m * mag;
}

/** Mostra um ano a cada `passo`, sempre o último, e nunca um rótulo colado ao último. */
function mostrarAno(i: number, n: number, passo: number): boolean {
  if (i === n - 1) return true;
  if (i % passo !== 0) return false;
  return n - 1 - i >= Math.ceil(passo * 0.75);
}

export interface Serie {
  id: string;
  nome: string;
  cor: string; // var(--s1)
  valores: (number | null)[];
}

interface Referencia {
  valor: number;
  rotulo: string;
}

interface PropsLinhas {
  id: string;
  titulo: string;
  descricao?: string;
  anos: number[];
  series: Serie[];
  formatar: (v: number) => string;
  formatarEixo: (v: number) => string;
  referencias?: Referencia[];
  altura?: number;
  rotuloAnoFinal?: boolean;
  notaRodape?: React.ReactNode;
}

export function GraficoLinhas({ id, titulo, descricao, anos, series, formatar, formatarEixo, referencias = [], altura = 260, notaRodape }: PropsLinhas) {
  const [ref, largura] = useLargura<HTMLDivElement>();
  const [idx, setIdx] = useState<number | null>(null);
  const padL = 64, padR = 16, padT = 12, padB = 28;
  const w = largura;
  const h = altura;
  const n = anos.length;
  const todos = series.flatMap((s) => s.valores.filter((v): v is number => v !== null && Number.isFinite(v)));
  const maxRef = referencias.length ? Math.max(...referencias.map((r) => r.valor)) : 0;
  const maxDados = Math.max(0, ...todos);
  const refsVisiveis = referencias.filter((r) => r.valor <= Math.max(maxDados * 1.25, referencias[0]?.valor ?? 0));
  const maxV = Math.max(maxDados, refsVisiveis.length ? Math.max(...refsVisiveis.map((r) => r.valor)) : 0, 1) * 1.05;
  void maxRef;
  const passo = passoBonito(maxV);
  const topo = Math.ceil(maxV / passo) * passo;
  const ticks: number[] = [];
  for (let v = 0; v <= topo + passo / 2; v += passo) ticks.push(v);
  const x = (i: number) => padL + (n <= 1 ? 0 : (i * (w - padL - padR)) / (n - 1));
  const y = (v: number) => padT + (h - padT - padB) * (1 - v / topo);
  const passoAno = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((w - padL - padR) / 52))));

  const caminho = (vals: (number | null)[]) => {
    let d = '';
    let aberto = false;
    vals.forEach((v, i) => {
      if (v === null || !Number.isFinite(v)) { aberto = false; return; }
      d += `${aberto ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      aberto = true;
    });
    return d;
  };

  const aoMover = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const px = e.clientX - r.left;
    const i = Math.round(((px - padL) / (w - padL - padR)) * (n - 1));
    setIdx(Math.max(0, Math.min(n - 1, i)));
  };
  const aoTeclar = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight') { setIdx((v) => Math.min(n - 1, (v ?? -1) + 1)); e.preventDefault(); }
    if (e.key === 'ArrowLeft') { setIdx((v) => Math.max(0, (v ?? n) - 1)); e.preventDefault(); }
    if (e.key === 'Escape') setIdx(null);
  };

  const ultimoIdx = n - 1;
  const rotulosFinais = series
    .map((s) => ({ s, v: s.valores[ultimoIdx] }))
    .filter((o): o is { s: Serie; v: number } => o.v !== null && o.v !== undefined)
    .sort((a, b) => b.v - a.v);
  const podeRotular = series.length <= 4 && rotulosFinais.every((o, i) => i === 0 || Math.abs(y(o.v) - y(rotulosFinais[i - 1].v)) > 16);

  const tipX = idx !== null ? x(idx) : 0;
  const tipEsq = tipX > w * 0.6;

  return (
    <figure className="grafico" aria-labelledby={`${id}-t`}>
      <figcaption>
        <h3 id={`${id}-t`}>{titulo}</h3>
        {descricao && <p>{descricao}</p>}
      </figcaption>
      {series.length > 1 && (
        <ul className="legenda" aria-label="Legenda">
          {series.map((s) => (
            <li key={s.id}><span className="chave-linha" style={{ background: s.cor }} aria-hidden="true" />{s.nome}</li>
          ))}
        </ul>
      )}
      <div className="grafico-area" ref={ref}>
        <svg width={w} height={h} role="img" aria-label={`${titulo}. Use as setas para percorrer os anos.`} tabIndex={0} onPointerMove={aoMover} onPointerLeave={() => setIdx(null)} onKeyDown={aoTeclar} onBlur={() => setIdx(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={w - padR} y1={y(t)} y2={y(t)} className={t === 0 ? 'eixo' : 'grade'} />
              <text x={padL - 8} y={y(t)} className="rotulo-eixo" textAnchor="end" dominantBaseline="middle">{formatarEixo(t)}</text>
            </g>
          ))}
          {refsVisiveis.map((r) => (
            <g key={r.rotulo}>
              <line x1={padL} x2={w - padR} y1={y(r.valor)} y2={y(r.valor)} className="referencia" />
              <text x={padL + 4} y={y(r.valor) - 4} className="rotulo-ref" textAnchor="start">{r.rotulo}</text>
            </g>
          ))}
          {anos.map((a, i) => (mostrarAno(i, n, passoAno) ? (
            <text key={a} x={x(i)} y={h - 8} className="rotulo-eixo" textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>{a}</text>
          ) : null))}
          {series.map((s) => (
            <path key={s.id} d={caminho(s.valores)} fill="none" stroke={s.cor} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {series.map((s) => {
            const v = s.valores[ultimoIdx];
            return v !== null && v !== undefined ? <circle key={`f-${s.id}`} cx={x(ultimoIdx)} cy={y(v)} r={4} fill={s.cor} stroke="var(--folha)" strokeWidth={2} /> : null;
          })}
          {idx !== null && (
            <g>
              <line x1={x(idx)} x2={x(idx)} y1={padT} y2={h - padB} className="mira" />
              {series.map((s) => {
                const v = s.valores[idx];
                return v !== null && v !== undefined ? <circle key={`m-${s.id}`} cx={x(idx)} cy={y(v)} r={4.5} fill={s.cor} stroke="var(--folha)" strokeWidth={2} /> : null;
              })}
            </g>
          )}
        </svg>
        {podeRotular && idx === null && (
          <div className="rotulos-finais" aria-hidden="true">
            {rotulosFinais.slice(0, 1).map((o) => (
              <span key={o.s.id} style={{ top: Math.max(0, y(o.v) - 26), right: padR }}>{formatar(o.v)}</span>
            ))}
          </div>
        )}
        {idx !== null && (
          <div className="dica" style={tipEsq ? { right: w - tipX + 12, top: padT } : { left: tipX + 12, top: padT }} role="status">
            <p className="dica-ano">{anos[idx]}</p>
            {series.map((s) => (
              <p key={s.id} className="dica-linha">
                <span className="chave-linha" style={{ background: s.cor }} aria-hidden="true" />
                <strong className="num">{s.valores[idx] === null || s.valores[idx] === undefined ? '—' : formatar(s.valores[idx] as number)}</strong>
                <span>{s.nome}</span>
              </p>
            ))}
          </div>
        )}
      </div>
      {notaRodape && <p className="grafico-nota">{notaRodape}</p>}
      <TabelaDados anos={anos} series={series} formatar={formatar} />
    </figure>
  );
}

interface PropsBarras {
  id: string;
  titulo: string;
  descricao?: string;
  anos: number[];
  series: Serie[];
  formatar: (v: number) => string;
  formatarEixo: (v: number) => string;
  altura?: number;
}

export function GraficoBarras({ id, titulo, descricao, anos, series, formatar, formatarEixo, altura = 240 }: PropsBarras) {
  const [ref, largura] = useLargura<HTMLDivElement>();
  const [idx, setIdx] = useState<number | null>(null);
  const padL = 64, padR = 12, padT = 12, padB = 28;
  const w = largura, h = altura, n = anos.length;
  const maxV = Math.max(1, ...series.flatMap((s) => s.valores.map((v) => v ?? 0))) * 1.05;
  const passo = passoBonito(maxV);
  const topo = Math.ceil(maxV / passo) * passo;
  const ticks: number[] = [];
  for (let v = 0; v <= topo + passo / 2; v += passo) ticks.push(v);
  const slot = (w - padL - padR) / n;
  const gap = 2;
  const barra = Math.max(2, Math.min(24, (slot * 0.8 - gap * (series.length - 1)) / series.length));
  const grupo = barra * series.length + gap * (series.length - 1);
  const y = (v: number) => padT + (h - padT - padB) * (1 - v / topo);
  const passoAno = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((w - padL - padR) / 52))));
  const raio = Math.min(4, barra / 2);
  const barraPath = (x0: number, v: number) => {
    const y0 = y(0), y1 = y(v);
    if (y0 - y1 < raio) return `M${x0},${y0}V${y1}H${x0 + barra}V${y0}Z`;
    return `M${x0},${y0}V${y1 + raio}Q${x0},${y1} ${x0 + raio},${y1}H${x0 + barra - raio}Q${x0 + barra},${y1} ${x0 + barra},${y1 + raio}V${y0}Z`;
  };
  const tipX = idx !== null ? padL + slot * idx + slot / 2 : 0;
  const tipEsq = tipX > w * 0.6;
  return (
    <figure className="grafico" aria-labelledby={`${id}-t`}>
      <figcaption>
        <h3 id={`${id}-t`}>{titulo}</h3>
        {descricao && <p>{descricao}</p>}
      </figcaption>
      <ul className="legenda" aria-label="Legenda">
        {series.map((s) => (
          <li key={s.id}><span className="chave-barra" style={{ background: s.cor }} aria-hidden="true" />{s.nome}</li>
        ))}
      </ul>
      <div className="grafico-area" ref={ref}>
        <svg width={w} height={h} role="img" aria-label={`${titulo}. Use as setas para percorrer os anos.`} tabIndex={0}
          onPointerMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); const i = Math.floor((e.clientX - r.left - padL) / slot); setIdx(i >= 0 && i < n ? i : null); }}
          onPointerLeave={() => setIdx(null)} onBlur={() => setIdx(null)}
          onKeyDown={(e) => { if (e.key === 'ArrowRight') { setIdx((v) => Math.min(n - 1, (v ?? -1) + 1)); e.preventDefault(); } if (e.key === 'ArrowLeft') { setIdx((v) => Math.max(0, (v ?? n) - 1)); e.preventDefault(); } }}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={w - padR} y1={y(t)} y2={y(t)} className={t === 0 ? 'eixo' : 'grade'} />
              <text x={padL - 8} y={y(t)} className="rotulo-eixo" textAnchor="end" dominantBaseline="middle">{formatarEixo(t)}</text>
            </g>
          ))}
          {idx !== null && <rect x={padL + slot * idx} y={padT} width={slot} height={h - padT - padB} className="faixa-hover" />}
          {anos.map((a, i) => {
            const x0 = padL + slot * i + (slot - grupo) / 2;
            return (
              <g key={a}>
                {series.map((s, k) => {
                  const v = s.valores[i] ?? 0;
                  return v > 0 ? <path key={s.id} d={barraPath(x0 + k * (barra + gap), v)} fill={s.cor} opacity={idx === null || idx === i ? 1 : 0.55} /> : null;
                })}
                {mostrarAno(i, n, passoAno) && <text x={padL + slot * i + slot / 2} y={h - 8} className="rotulo-eixo" textAnchor="middle">{a}</text>}
              </g>
            );
          })}
        </svg>
        {idx !== null && (
          <div className="dica" style={tipEsq ? { right: w - tipX + 12, top: padT } : { left: tipX + 12, top: padT }} role="status">
            <p className="dica-ano">{anos[idx]}</p>
            {series.map((s) => (
              <p key={s.id} className="dica-linha">
                <span className="chave-barra" style={{ background: s.cor }} aria-hidden="true" />
                <strong className="num">{formatar(s.valores[idx] ?? 0)}</strong>
                <span>{s.nome}</span>
              </p>
            ))}
          </div>
        )}
      </div>
      <TabelaDados anos={anos} series={series} formatar={formatar} />
    </figure>
  );
}

function TabelaDados({ anos, series, formatar }: { anos: number[]; series: Serie[]; formatar: (v: number) => string }) {
  return (
    <details className="grafico-tabela">
      <summary>Ver dados em tabela</summary>
      <div className="rolagem-x">
        <table className="tabela compacta">
          <thead>
            <tr>
              <th scope="col">Ano</th>
              {series.map((s) => <th key={s.id} scope="col" className="num">{s.nome}</th>)}
            </tr>
          </thead>
          <tbody>
            {anos.map((a, i) => (
              <tr key={a}>
                <th scope="row">{a}</th>
                {series.map((s) => <td key={s.id} className="num">{s.valores[i] === null || s.valores[i] === undefined ? '—' : formatar(s.valores[i] as number)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** Régua das nove faixas do § 23 com o marcador da razão mora/RCL. */
export function ReguaFaixas({ razao, faixaAtiva, limiaresBp, aliquotasBp }: { razao: number | null; faixaAtiva: number | null; limiaresBp: number[]; aliquotasBp: number[] }) {
  const maxEscala = 1.0; // 100% da RCL
  const pos = (frac: number) => `${Math.min(100, (frac / maxEscala) * 100)}%`;
  const bordas = [0, ...limiaresBp.map((b) => b / 10000), maxEscala];
  return (
    <div className="regua" role="img" aria-label={razao === null ? 'Faixa indeterminada' : `Razão mora/RCL de ${(razao * 100).toFixed(2).replace('.', ',')}%, faixa ${faixaAtiva}`}>
      <div className="regua-trilho">
        {aliquotasBp.map((a, i) => (
          <div key={i} className={`regua-seg${faixaAtiva === i + 1 ? ' ativa' : ''}`} style={{ left: pos(bordas[i]), width: `calc(${pos(bordas[i + 1])} - ${pos(bordas[i])})` }}>
            <span>{(a / 100).toLocaleString('pt-BR')}%</span>
          </div>
        ))}
        {razao !== null && <div className="regua-marca" style={{ left: pos(Math.min(razao, maxEscala)) }} />}
      </div>
      <div className="regua-escala" aria-hidden="true">
        {[0, ...limiaresBp.map((b) => b / 10000)].map((b) => (
          <span key={b} style={{ left: pos(b) }}>{Math.round(b * 100)}%</span>
        ))}
        <span style={{ left: '100%' }}>100%+</span>
      </div>
    </div>
  );
}
