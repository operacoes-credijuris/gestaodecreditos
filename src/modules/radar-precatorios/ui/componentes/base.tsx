import React, { useEffect, useId, useState } from 'react';
import type { Centavos, DadoRastreado, Origem } from '../../dominio/tipos';
import { formatarBRL, formatarData, formatarNumeroBRL, lerPct, lerValorBRL } from '../../dominio/dinheiro';
import { ROTULO_ORIGEM } from '../../motores/motorRiscos';
import type { NivelAlerta } from '../../motores/motorRiscos';

/* ---------- Etiqueta de origem (requisito 9 / T24) ---------- */

const SIMBOLO_ORIGEM: Record<Origem, string> = { oficial: '●', analista: '◆', hipotese: '◇', estimado: '○', ausente: '×' };

export function Selo({ origem, compacto }: { origem: Origem; compacto?: boolean }) {
  return (
    <span className={`selo selo-${origem}`} title={ROTULO_ORIGEM[origem]}>
      <span aria-hidden="true">{SIMBOLO_ORIGEM[origem]}</span>
      {compacto ? <span className="sr">{ROTULO_ORIGEM[origem]}</span> : ROTULO_ORIGEM[origem]}
    </span>
  );
}

/* ---------- "De onde veio este número?" ---------- */

export function DeOndeVeio({ itens, formula }: { itens: { rotulo: string; valor?: string; origem?: Origem; fonte?: string; dataBase?: string }[]; formula?: string[] }) {
  return (
    <details className="origem-pop">
      <summary>De onde veio?</summary>
      <div className="origem-corpo">
        {formula && formula.length > 0 && (
          <div className="formula">
            {formula.map((f, i) => (
              <div key={i}>{f}</div>
            ))}
          </div>
        )}
        <dl>
          {itens.map((it, i) => (
            <div key={i} className="origem-item">
              <dt>{it.rotulo}</dt>
              <dd>
                {it.valor && <strong className="num">{it.valor}</strong>} {it.origem && <Selo origem={it.origem} />}
                {(it.fonte || it.dataBase) && (
                  <span className="origem-fonte">
                    {it.fonte ?? 'Sem fonte registrada'}
                    {it.dataBase ? ` · data-base ${formatarData(it.dataBase)}` : ''}
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </details>
  );
}

/* ---------- Campos ---------- */

export function CampoMoeda({ id, rotulo, valor, aoMudar, ajuda, desabilitado, permitirVazio = true }: { id: string; rotulo: string; valor: Centavos | null; aoMudar: (v: Centavos | null) => void; ajuda?: string; desabilitado?: boolean; permitirVazio?: boolean }) {
  const [texto, setTexto] = useState(formatarNumeroBRL(valor));
  const [erro, setErro] = useState<string | null>(null);
  const [foco, setFoco] = useState(false);
  useEffect(() => {
    if (!foco) setTexto(formatarNumeroBRL(valor));
  }, [valor, foco]);
  const confirmar = () => {
    setFoco(false);
    if (texto.trim() === '') {
      if (permitirVazio) { setErro(null); aoMudar(null); } else setErro('Campo obrigatório.');
      return;
    }
    const v = lerValorBRL(texto);
    if (v === null) { setErro('Valor ilegível. Use o formato 2.500.000,00.'); return; }
    if (v < 0) { setErro('Valor negativo não é aceito aqui.'); return; }
    setErro(null);
    aoMudar(v);
    setTexto(formatarNumeroBRL(v));
  };
  return (
    <div className="campo">
      <label htmlFor={id}>{rotulo}</label>
      <div className="entrada-moeda">
        <span aria-hidden="true">R$</span>
        <input id={id} inputMode="decimal" value={texto} disabled={desabilitado} placeholder="—" onFocus={() => setFoco(true)} onChange={(e) => setTexto(e.target.value)} onBlur={confirmar} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} aria-invalid={!!erro} aria-describedby={ajuda || erro ? `${id}-ajuda` : undefined} />
      </div>
      {(erro || ajuda) && <p id={`${id}-ajuda`} className={erro ? 'campo-erro' : 'campo-ajuda'}>{erro ?? ajuda}</p>}
    </div>
  );
}

export function CampoPct({ id, rotulo, valor, aoMudar, ajuda, min = -50, max = 200, casas = 2 }: { id: string; rotulo: string; valor: number; aoMudar: (v: number) => void; ajuda?: string; min?: number; max?: number; casas?: number }) {
  const fmt = (v: number) => (v * 100).toLocaleString('pt-BR', { maximumFractionDigits: casas });
  const [texto, setTexto] = useState(fmt(valor));
  const [erro, setErro] = useState<string | null>(null);
  const [foco, setFoco] = useState(false);
  useEffect(() => {
    if (!foco) setTexto(fmt(valor));
  }, [valor, foco]); // eslint-disable-line react-hooks/exhaustive-deps
  const confirmar = () => {
    setFoco(false);
    const v = lerPct(texto);
    if (v === null) { setErro('Use um número, por exemplo 6,5.'); return; }
    if (v * 100 < min || v * 100 > max) { setErro(`Entre ${min}% e ${max}%.`); return; }
    setErro(null);
    aoMudar(v);
  };
  return (
    <div className="campo">
      <label htmlFor={id}>{rotulo}</label>
      <div className="entrada-pct">
        <input id={id} inputMode="decimal" value={texto} onFocus={() => setFoco(true)} onChange={(e) => setTexto(e.target.value)} onBlur={confirmar} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} aria-invalid={!!erro} aria-describedby={ajuda || erro ? `${id}-ajuda` : undefined} />
        <span aria-hidden="true">%</span>
      </div>
      {(erro || ajuda) && <p id={`${id}-ajuda`} className={erro ? 'campo-erro' : 'campo-ajuda'}>{erro ?? ajuda}</p>}
    </div>
  );
}

export function CampoTexto({ id, rotulo, valor, aoMudar, ajuda, tipo = 'text', placeholder }: { id: string; rotulo: string; valor: string; aoMudar: (v: string) => void; ajuda?: string; tipo?: string; placeholder?: string }) {
  return (
    <div className="campo">
      <label htmlFor={id}>{rotulo}</label>
      <input id={id} type={tipo} value={valor} placeholder={placeholder} onChange={(e) => aoMudar(e.target.value)} aria-describedby={ajuda ? `${id}-ajuda` : undefined} />
      {ajuda && <p id={`${id}-ajuda`} className="campo-ajuda">{ajuda}</p>}
    </div>
  );
}

export function CampoSelecao<T extends string>({ id, rotulo, valor, opcoes, aoMudar, ajuda }: { id: string; rotulo: string; valor: T; opcoes: { valor: T; rotulo: string }[]; aoMudar: (v: T) => void; ajuda?: string }) {
  return (
    <div className="campo">
      <label htmlFor={id}>{rotulo}</label>
      <select id={id} value={valor} onChange={(e) => aoMudar(e.target.value as T)} aria-describedby={ajuda ? `${id}-ajuda` : undefined}>
        {opcoes.map((o) => (
          <option key={o.valor} value={o.valor}>{o.rotulo}</option>
        ))}
      </select>
      {ajuda && <p id={`${id}-ajuda`} className="campo-ajuda">{ajuda}</p>}
    </div>
  );
}

export function CampoInteiro({ id, rotulo, valor, aoMudar, min, max, ajuda }: { id: string; rotulo: string; valor: number; aoMudar: (v: number) => void; min: number; max: number; ajuda?: string }) {
  const [texto, setTexto] = useState(String(valor));
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => setTexto(String(valor)), [valor]);
  return (
    <div className="campo">
      <label htmlFor={id}>{rotulo}</label>
      <input id={id} inputMode="numeric" value={texto} onChange={(e) => setTexto(e.target.value)} onBlur={() => {
        const n = Number(texto);
        if (!Number.isInteger(n) || n < min || n > max) { setErro(`Inteiro entre ${min} e ${max}.`); return; }
        setErro(null);
        aoMudar(n);
      }} aria-invalid={!!erro} />
      {(erro || ajuda) && <p className={erro ? 'campo-erro' : 'campo-ajuda'}>{erro ?? ajuda}</p>}
    </div>
  );
}

/* ---------- Dado rastreado (valor + procedência) ---------- */

const OPCOES_ORIGEM: { valor: Origem; rotulo: string }[] = [
  { valor: 'oficial', rotulo: 'Oficial (documento público)' },
  { valor: 'analista', rotulo: 'Informado pelo analista' },
  { valor: 'hipotese', rotulo: 'Hipótese' },
  { valor: 'estimado', rotulo: 'Estimado' },
];

export function CampoRastreado({ id, rotulo, dado, aoMudar, ajuda, mostrarPeriodo, dataBaseEsperada }: { id: string; rotulo: string; dado: DadoRastreado; aoMudar: (d: DadoRastreado) => void; ajuda?: string; mostrarPeriodo?: boolean; dataBaseEsperada?: string }) {
  const uid = useId();
  const mudarValor = (v: Centavos | null) => aoMudar({ ...dado, valor: v, origem: v === null ? 'ausente' : dado.origem === 'ausente' ? 'analista' : dado.origem });
  return (
    <fieldset className="rastreado">
      <legend>
        {rotulo} <Selo origem={dado.origem} />
      </legend>
      <div className="rastreado-grade">
        <CampoMoeda id={id} rotulo="Valor" valor={dado.valor} aoMudar={mudarValor} ajuda={ajuda} />
        <CampoSelecao id={`${id}-origem`} rotulo="Natureza do número" valor={dado.origem === 'ausente' ? 'analista' : dado.origem} opcoes={OPCOES_ORIGEM} aoMudar={(o) => dado.valor !== null && aoMudar({ ...dado, origem: o })} />
      </div>
      <details className="rastreado-mais">
        <summary>Fonte e datas{dado.fonte ? `: ${dado.fonte}` : ' (não registradas)'}</summary>
        <div className="rastreado-grade">
          <CampoTexto id={`${id}-fonte-${uid}`} rotulo="Fonte (documento, URL ou arquivo)" valor={dado.fonte ?? ''} aoMudar={(v) => aoMudar({ ...dado, fonte: v })} />
          <CampoTexto id={`${id}-db-${uid}`} rotulo="Data-base" tipo="date" valor={dado.dataBase ?? ''} aoMudar={(v) => aoMudar({ ...dado, dataBase: v })} ajuda={dataBaseEsperada ? `Esperado: ${formatarData(dataBaseEsperada)}` : undefined} />
          {mostrarPeriodo && <CampoTexto id={`${id}-per-${uid}`} rotulo="Período de referência" valor={dado.periodoReferencia ?? ''} placeholder="Exercício 2025" aoMudar={(v) => aoMudar({ ...dado, periodoReferencia: v })} />}
          <CampoTexto id={`${id}-col-${uid}`} rotulo="Data de coleta" tipo="date" valor={dado.dataColeta ?? ''} aoMudar={(v) => aoMudar({ ...dado, dataColeta: v })} />
          <CampoTexto id={`${id}-resp-${uid}`} rotulo="Responsável pela validação" valor={dado.responsavel ?? ''} aoMudar={(v) => aoMudar({ ...dado, responsavel: v })} />
          <CampoTexto id={`${id}-obs-${uid}`} rotulo="Observação" valor={dado.observacao ?? ''} aoMudar={(v) => aoMudar({ ...dado, observacao: v })} />
        </div>
      </details>
    </fieldset>
  );
}

/* ---------- Avisos ---------- */

const ICONE_NIVEL: Record<NivelAlerta, string> = { bloqueio: '■', critico: '▲', atencao: '!', info: 'i' };
const ROTULO_NIVEL: Record<NivelAlerta, string> = { bloqueio: 'Bloqueio', critico: 'Crítico', atencao: 'Atenção', info: 'Informação' };

export function Aviso({ nivel, titulo, children }: { nivel: NivelAlerta; titulo: string; children?: React.ReactNode }) {
  return (
    <div className={`aviso aviso-${nivel}`} role={nivel === 'bloqueio' || nivel === 'critico' ? 'alert' : undefined}>
      <span className="aviso-icone" aria-hidden="true">{ICONE_NIVEL[nivel]}</span>
      <div>
        <p className="aviso-titulo"><span className="sr">{ROTULO_NIVEL[nivel]}: </span>{titulo}</p>
        {children && <div className="aviso-texto">{children}</div>}
      </div>
    </div>
  );
}

export function Secao({ titulo, subtitulo, children, acoes, id }: { titulo: string; subtitulo?: React.ReactNode; children: React.ReactNode; acoes?: React.ReactNode; id?: string }) {
  return (
    <section className="secao" id={id} aria-labelledby={id ? `${id}-t` : undefined}>
      <header className="secao-cab">
        <div>
          <h2 id={id ? `${id}-t` : undefined}>{titulo}</h2>
          {subtitulo && <p className="secao-sub">{subtitulo}</p>}
        </div>
        {acoes && <div className="secao-acoes">{acoes}</div>}
      </header>
      {children}
    </section>
  );
}

export function Valor({ c, compacto }: { c: Centavos | null | undefined; compacto?: boolean }) {
  return <span className="num">{compacto ? formatarBRL(c) : formatarBRL(c)}</span>;
}
