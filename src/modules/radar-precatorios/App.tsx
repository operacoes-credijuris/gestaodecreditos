import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { IdCenario, Projeto } from './dominio/tipos';
import { obterRegras } from './regras/regrasJuridicas';
import { projetar, type ResultadoProjecao } from './motores/motorProjecao';
import { alertasDaProjecao, alertasDeDados, grauRobustez, oQueFalta } from './motores/motorRiscos';
import { projetoExemplo } from './exemplo/municipioExemplo';
import { carregarLocal, gravarAba, lerAba } from './persistencia/armazenamentoLocal';
import { armazenamentoNavegador, type Armazenamento } from './persistencia/armazenamento';
import { formatarBp } from './dominio/dinheiro';
import { calcularEnquadramento } from './motores/motorPercentualRCL';
import { ABAS, agoraISO, hojeISO, type Aba } from './ui/util';
import { TelaPainel } from './ui/telas/TelaPainel';
import { TelaEnquadramento } from './ui/telas/TelaEnquadramento';
import { TelaEnte } from './ui/telas/TelaEnte';
import { TelaHistorico } from './ui/telas/TelaHistorico';
import { TelaCenarios } from './ui/telas/TelaCenarios';
import { TelaAlvo, TelaRegras, TelaTestes } from './ui/telas/TelaOutras';
import { TelaProjeto, type Downloads } from './ui/telas/TelaProjeto';

declare global {
  interface Window {
    claude?: { use?: (nome: string) => Promise<unknown> };
  }
}

function abaValida(a: string | null | undefined): a is Aba {
  return !!a && ABAS.some((x) => x.id === a);
}

function abaInicial(usarHash: boolean): Aba {
  const h = usarHash && typeof location !== 'undefined' ? location.hash.replace('#', '') : '';
  if (abaValida(h)) return h;
  const salva = lerAba();
  return abaValida(salva) ? salva : 'painel';
}

export interface PropsApp {
  /** Dentro da plataforma: esconde a marca e não mexe no endereço (#aba). */
  incorporado?: boolean;
  /** Onde salvar o projeto. Padrão: navegador do usuário. */
  armazenamento?: Armazenamento;
}

export function App({ incorporado = false, armazenamento }: PropsApp) {
  const arm = armazenamento ?? armazenamentoNavegador;
  const assincrono = !!armazenamento;
  const [projeto, setProjeto] = useState<Projeto | null>(() => (assincrono ? null : carregarLocal() ?? projetoExemplo(agoraISO())));
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [aba, setAba] = useState<Aba>(() => abaInicial(!incorporado));
  const [salvo, setSalvo] = useState<boolean | null>(null);
  const [downloads, setDownloads] = useState<Downloads | null>(null);
  const primeira = useRef(true);
  const topoRef = useRef<HTMLElement>(null);
  const mainRef = useRef<HTMLElement>(null);

  // Carga assíncrona (armazenamento da plataforma)
  useEffect(() => {
    if (!assincrono) return;
    let vivo = true;
    arm.carregar()
      .then((p) => { if (vivo) setProjeto(p ?? projetoExemplo(agoraISO())); })
      .catch((e: unknown) => {
        if (!vivo) return;
        setErroCarga(e instanceof Error ? e.message : 'Falha ao carregar o projeto.');
        setProjeto(projetoExemplo(agoraISO()));
      });
    return () => { vivo = false; };
  }, [arm, assincrono]);

  // Capacidade de download do visualizador do claude.ai (ausente na plataforma)
  useEffect(() => {
    let vivo = true;
    try {
      const p = typeof window !== 'undefined' ? window.claude?.use?.('downloads') : undefined;
      if (p) p.then((d) => { if (vivo) setDownloads((d as Downloads) ?? null); }).catch(() => undefined);
    } catch {
      /* fora do visualizador */
    }
    return () => { vivo = false; };
  }, []);

  // Salvamento com espera de 600 ms após a última alteração
  useEffect(() => {
    if (!projeto) return;
    if (primeira.current) { primeira.current = false; return; }
    const t = setTimeout(() => {
      arm.salvar(projeto).then(() => setSalvo(true)).catch(() => setSalvo(false));
    }, 600);
    return () => clearTimeout(t);
  }, [projeto, arm]);

  const atualizar = useCallback((fn: (p: Projeto) => Projeto) => setProjeto((p) => (p ? { ...fn(p), atualizadoEm: agoraISO() } : p)), []);
  const substituir = useCallback((p: Projeto) => setProjeto({ ...p, atualizadoEm: agoraISO() }), []);
  const irPara = useCallback((a: Aba) => {
    setAba(a);
    gravarAba(a);
    if (!incorporado) {
      try { history.replaceState(history.state, '', `#${a}`); } catch { /* sem histórico */ }
    }
    mainRef.current?.focus({ preventScroll: true });
    const topo = topoRef.current?.getBoundingClientRect().top ?? 0;
    if (topo < 0) topoRef.current?.scrollIntoView({ block: 'start' });
  }, [incorporado]);

  if (!projeto) {
    return <div className="carregando" role="status">Carregando o projeto…</div>;
  }
  return <Conteudo projeto={projeto} aba={aba} irPara={irPara} atualizar={atualizar} substituir={substituir} incorporado={incorporado} salvo={salvo} descricaoArmazenamento={arm.descricao} downloads={downloads} erroCarga={erroCarga} topoRef={topoRef} mainRef={mainRef} />;
}

interface PropsConteudo {
  projeto: Projeto;
  aba: Aba;
  irPara: (a: Aba) => void;
  atualizar: (fn: (p: Projeto) => Projeto) => void;
  substituir: (p: Projeto) => void;
  incorporado: boolean;
  salvo: boolean | null;
  descricaoArmazenamento: string;
  downloads: Downloads | null;
  erroCarga: string | null;
  topoRef: React.Ref<HTMLElement>;
  mainRef: React.Ref<HTMLElement>;
}

function Conteudo({ projeto, aba, irPara, atualizar, substituir, incorporado, salvo, descricaoArmazenamento, downloads, erroCarga, topoRef, mainRef }: PropsConteudo) {
  const regras = obterRegras(projeto.juridico.versaoRegras);
  const resultados = useMemo(() => {
    const r = {} as Record<IdCenario, ResultadoProjecao>;
    for (const c of projeto.cenarios) r[c.id] = projetar(projeto, c, regras);
    return r;
  }, [projeto, regras]);
  const ativo = resultados[projeto.config.cenarioAtivo];
  const hoje = hojeISO();
  const alertas = useMemo(() => [...alertasDeDados(projeto, regras, hoje), ...alertasDaProjecao(projeto, ativo)], [projeto, regras, ativo, hoje]);
  const grau = useMemo(() => grauRobustez(projeto, alertas), [projeto, alertas]);
  const checklist = useMemo(() => oQueFalta(projeto), [projeto]);
  const enq0 = calcularEnquadramento({ ano: projeto.anoBase, rclAnterior: projeto.dados.rclAnterior.valor, moraEm1Jan: projeto.dados.moraEm1Jan.valor, regras, leitura24: projeto.juridico.leitura24, verificacao24: projeto.juridico.verificacao24, aliquotaManualBp: projeto.dados.aliquotaManual.valor });
  const bloqueios = alertas.filter((a) => a.nivel === 'bloqueio').length;
  const criticos = alertas.filter((a) => a.nivel === 'critico').length;

  return (
    <div className="app">
      <a className="pular" href="#conteudo-radar">Pular para o conteúdo</a>
      <header className="capa" ref={topoRef}>
        <div className={`capa-interna${incorporado ? ' sem-marca' : ''}`}>
          {!incorporado && (
            <div className="capa-marca">
              <p className="marca">Radar de Precatórios</p>
              <p className="marca-sub">Credijuris · Fase 1 · EC 136/2025</p>
            </div>
          )}
          <div className="capa-autos">
            <p className="capa-rotulo">{incorporado ? 'Radar de Precatórios · ente devedor' : 'Ente devedor'}</p>
            <h1>{projeto.ente.nome || 'Ente sem nome'}</h1>
            <p className="capa-meta">
              {projeto.ente.uf || '—'} · {projeto.ente.regime === 'especial' ? 'regime especial' : projeto.ente.regime === 'geral' ? 'regime geral' : 'regime não informado'} · ano-base {projeto.anoBase}
              {enq0.status === 'calculada' ? ` · limite ${formatarBp(enq0.aliquotaAplicavelBp)} da RCL` : ''}
            </p>
          </div>
          <div className="capa-selos">
            {projeto.ehExemplo && <span className="capa-chip">Exemplo fictício</span>}
            <span className="capa-chip">Grau {grau.grau}</span>
            {bloqueios > 0 && <span className="capa-chip alerta">{bloqueios} bloqueio{bloqueios > 1 ? 's' : ''}</span>}
            {criticos > 0 && <span className="capa-chip alerta">{criticos} crítico{criticos > 1 ? 's' : ''}</span>}
          </div>
        </div>
        <nav className="abas" aria-label="Seções do Radar de Precatórios">
          <div className="abas-interna" role="tablist">
            {ABAS.map((a) => (
              <button key={a.id} type="button" role="tab" aria-selected={aba === a.id} className={aba === a.id ? 'ativa' : ''} onClick={() => irPara(a.id)}>
                <span className="aba-longa">{a.rotulo}</span><span className="aba-curta">{a.curto}</span>
              </button>
            ))}
          </div>
        </nav>
      </header>

      <main id="conteudo-radar" ref={mainRef} tabIndex={-1} className="conteudo">
        {erroCarga && <p className="erro-carga" role="alert">Não foi possível carregar o projeto salvo ({erroCarga}). Exibindo o exemplo; nada foi sobrescrito até você editar.</p>}
        {aba === 'painel' && <TelaPainel projeto={projeto} regras={regras} resultados={resultados} alertas={alertas} grau={grau} checklist={checklist} aoMudarCenario={(id) => atualizar((p) => ({ ...p, config: { ...p.config, cenarioAtivo: id } }))} irPara={irPara} />}
        {aba === 'ente' && <TelaEnte projeto={projeto} atualizar={atualizar} />}
        {aba === 'enquadramento' && <TelaEnquadramento projeto={projeto} regras={regras} atualizar={atualizar} />}
        {aba === 'historico' && <TelaHistorico projeto={projeto} atualizar={atualizar} />}
        {aba === 'cenarios' && <TelaCenarios projeto={projeto} atualizar={atualizar} />}
        {aba === 'alvo' && <TelaAlvo regras={regras} />}
        {aba === 'regras' && <TelaRegras projeto={projeto} regras={regras} atualizar={atualizar} />}
        {aba === 'testes' && <TelaTestes />}
        {aba === 'projeto' && <TelaProjeto projeto={projeto} resultadoAtivo={ativo} substituir={substituir} atualizar={atualizar} downloads={downloads} salvo={salvo} descricaoArmazenamento={descricaoArmazenamento} />}
      </main>

      <footer className="rodape">
        <p>Simulação gerencial, não parecer jurídico nem promessa de pagamento. Regras v{regras.versao} pendentes de aprovação jurídica; EC 136/2025 sob exame do STF (ADI 7873). Nenhum ano de recebimento individual é estimado sem a posição na fila.</p>
      </footer>
    </div>
  );
}
