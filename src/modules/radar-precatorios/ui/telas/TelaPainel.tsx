import React, { useMemo, useState } from 'react';
import type { IdCenario, Projeto } from '../../dominio/tipos';
import type { RegrasJuridicas } from '../../regras/regrasJuridicas';
import type { ResultadoProjecao, LinhaProjecao } from '../../motores/motorProjecao';
import { ROTULO_TRAJETORIA } from '../../motores/motorProjecao';
import type { Alerta, Grau, ItemChecklist } from '../../motores/motorRiscos';
import { aporteParaEstabilizar, aporteParaZerar, testesDeEstresse } from '../../motores/motorSensibilidade';
import { TEXTO_INDETERMINADO } from '../../motores/motorFila';
import { formatarBRL, formatarBp, formatarCompacto, formatarPct } from '../../dominio/dinheiro';
import { Aviso, DeOndeVeio, Secao, Selo } from '../componentes/base';
import { GraficoBarras, GraficoLinhas } from '../componentes/graficos';
import { eixoReais, origemMaisFraca, type Aba } from '../util';
import { cenarioPorId } from '../../persistencia/projetoJSON';

interface Props {
  projeto: Projeto;
  regras: RegrasJuridicas;
  resultados: Record<IdCenario, ResultadoProjecao>;
  alertas: Alerta[];
  grau: Grau;
  checklist: ItemChecklist[];
  aoMudarCenario: (id: IdCenario) => void;
  irPara: (aba: Aba) => void;
}

const NOMES: Record<IdCenario, string> = { conservador: 'Conservador', base: 'Base', favoravel: 'Favorável' };

export function SeletorCenario({ ativo, aoMudar }: { ativo: IdCenario; aoMudar: (id: IdCenario) => void }) {
  return (
    <div className="segmentado" role="radiogroup" aria-label="Cenário">
      {(['conservador', 'base', 'favoravel'] as IdCenario[]).map((id) => (
        <button key={id} type="button" role="radio" aria-checked={ativo === id} className={ativo === id ? 'ativo' : ''} onClick={() => aoMudar(id)}>
          {NOMES[id]}
        </button>
      ))}
    </div>
  );
}

function Trajetoria({ t }: { t: ResultadoProjecao['trajetoria'] }) {
  const icone = { encolhendo: '▼', estavel: '●', crescendo: '▲', nao_mensuravel: '?' }[t];
  return <span className={`pilula traj-${t}`}><span aria-hidden="true">{icone}</span> {ROTULO_TRAJETORIA[t]}</span>;
}

export function ListaAlertas({ alertas, irPara }: { alertas: Alerta[]; irPara?: (a: Aba) => void }) {
  const graves = alertas.filter((a) => a.nivel !== 'info');
  const info = alertas.filter((a) => a.nivel === 'info');
  const ordem = { bloqueio: 0, critico: 1, atencao: 2, info: 3 };
  return (
    <div className="lista-alertas">
      {[...graves].sort((a, b) => ordem[a.nivel] - ordem[b.nivel]).map((a) => (
        <Aviso key={a.id + a.detalhe.slice(0, 12)} nivel={a.nivel} titulo={a.titulo}>
          <p>{a.detalhe}</p>
          {a.tela && irPara && a.tela !== 'painel' && <button type="button" className="link" onClick={() => irPara(a.tela as Aba)}>Abrir {a.tela === 'regras' ? 'regras jurídicas' : a.tela}</button>}
        </Aviso>
      ))}
      {info.length > 0 && (
        <details className="alertas-info">
          <summary>{info.length} {info.length === 1 ? 'informação' : 'informações'} sobre regras e premissas</summary>
          {info.map((a) => (
            <Aviso key={a.id} nivel="info" titulo={a.titulo}><p>{a.detalhe}</p></Aviso>
          ))}
        </details>
      )}
    </div>
  );
}

function aliquotaTexto(l: LinhaProjecao): string {
  const e = l.enquadramento;
  if (e.status === 'calculada') return e.adicional.bp > 0 ? `${formatarBp(e.aliquotaBaseBp)} + ${formatarBp(e.adicional.bp)}` : formatarBp(e.aliquotaBaseBp);
  if (e.status === 'manual') return `${formatarBp(e.aliquotaAplicavelBp)} (manual)`;
  return '—';
}

export function MemoriaCalculo({ res }: { res: ResultadoProjecao }) {
  const [detalhar, setDetalhar] = useState(false);
  if (!res.linhas.length) return null;
  return (
    <div>
      <div className="barra-ferramentas">
        <label className="alternador">
          <input type="checkbox" checked={detalhar} onChange={(e) => setDetalhar(e.target.checked)} id="memoria-detalhar" /> Mostrar colunas de detalhe (coortes, contas, execução)
        </label>
      </div>
      <div className="rolagem-x tabela-moldura">
        <table className="tabela memoria">
          <thead>
            <tr>
              <th scope="col" className="fixa">Ano</th>
              <th scope="col" className="num">RCL anterior<span className="tipo-col">fluxo</span></th>
              <th scope="col" className="num">Mora 1º/jan<span className="tipo-col">saldo</span></th>
              <th scope="col" className="num">Mora/RCL</th>
              <th scope="col">Faixa</th>
              <th scope="col" className="num">Alíquota</th>
              <th scope="col" className="num">Limite § 23<span className="tipo-col">teto</span></th>
              {detalhar && <th scope="col" className="num">A vencer no ano<span className="tipo-col">saldo</span></th>}
              {detalhar && <th scope="col" className="num">Execução</th>}
              <th scope="col" className="num">Aporte às contas<span className="tipo-col">movimento</span></th>
              {detalhar && <th scope="col" className="num">Extra § 28</th>}
              {detalhar && <th scope="col" className="num">Conta acordos</th>}
              <th scope="col" className="num">Pago aos credores<span className="tipo-col">movimento</span></th>
              <th scope="col" className="num">Renúncias e extinções</th>
              <th scope="col" className="num">Novos créditos<span className="tipo-col">movimento</span></th>
              <th scope="col" className="num">Atualização</th>
              <th scope="col" className="num">Variação antes da atualização</th>
              {detalhar && <th scope="col" className="num">Saldo nas contas 31/12</th>}
              <th scope="col" className="num">Passivo 31/12<span className="tipo-col">saldo</span></th>
              <th scope="col" className="num">Variação líquida</th>
              <th scope="col">Conciliação</th>
            </tr>
          </thead>
          <tbody>
            {res.linhas.map((l) => {
              const e = l.enquadramento;
              return (
                <tr key={l.ano} className={l.avisos.length ? 'com-aviso' : ''} title={l.avisos.join(' ')}>
                  <th scope="row" className="fixa">{l.ano}</th>
                  <td className="num">{formatarCompacto(l.rclAnterior.valor)} <Selo origem={l.rclAnterior.origem} compacto /></td>
                  <td className="num">{l.moraEm1Jan.valor === null ? 'indet.' : formatarCompacto(l.moraEm1Jan.valor)} <Selo origem={l.moraEm1Jan.origem} compacto /></td>
                  <td className="num">{e.status === 'calculada' ? formatarPct(e.razao) : '—'}</td>
                  <td>{e.status === 'calculada' ? ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'][e.faixa - 1] : e.status === 'manual' ? 'manual' : '—'}</td>
                  <td className="num">{aliquotaTexto(l)}</td>
                  <td className="num">{formatarCompacto(l.limite)}</td>
                  {detalhar && <td className="num">{formatarCompacto(l.aVencerNoAno)}</td>}
                  {detalhar && <td className="num">{formatarPct(l.execucao, 0)}</td>}
                  <td className="num">{formatarCompacto(l.depositoTotal)}{l.limitadoAoExigivel ? ' *' : ''}</td>
                  {detalhar && <td className="num">{formatarCompacto(l.extraordinario)}</td>}
                  {detalhar && <td className="num">{formatarCompacto(l.depositoAcordos)}</td>}
                  <td className="num">{formatarCompacto(l.pagamentosCredores)}</td>
                  <td className="num">{formatarCompacto(l.renunciaAcordos + l.outrasExtincoes)}</td>
                  <td className="num">{formatarCompacto(l.novosCreditos)}</td>
                  <td className="num">{formatarCompacto(l.atualizacaoTotal)}</td>
                  <td className={`num ${l.variacaoAntesAtualizacao > 0 ? 'sobe' : 'desce'}`}>{l.variacaoAntesAtualizacao > 0 ? '+' : ''}{formatarCompacto(l.variacaoAntesAtualizacao)}</td>
                  {detalhar && <td className="num">{formatarCompacto(l.saldoContasFinal)}</td>}
                  <td className="num forte">{formatarCompacto(l.passivoFinal)}</td>
                  <td className={`num ${l.variacaoLiquida > 0 ? 'sobe' : 'desce'}`}>{l.variacaoLiquida > 0 ? '+' : ''}{formatarCompacto(l.variacaoLiquida)}</td>
                  <td>{l.conservacao.ok ? <span className="ok">✓ fecha</span> : <span className="falha">✗ {formatarBRL(l.conservacao.diferenca)}</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="nota">
        Passivo = estoque fora das contas (Livro A, visão do § 30) + saldo nas contas especiais (Livro B). Conciliação: passivo final = inicial + novos créditos + atualização − pagamentos − renúncias − extinções. * aporte limitado ao exigível do ano. Linhas destacadas têm premissas aplicadas: passe o cursor para ler.
      </p>
    </div>
  );
}

export function TelaPainel({ projeto, regras, resultados, alertas, grau, checklist, aoMudarCenario, irPara }: Props) {
  const ativo = projeto.config.cenarioAtivo;
  const res = resultados[ativo];
  const cen = cenarioPorId(projeto, ativo);
  const d = projeto.dados;

  const extras = useMemo(() => {
    if (res.status !== 'ok') return null;
    return {
      zerar: [10, 15, 20].map((n) => aporteParaZerar(projeto, cen, regras, n)),
      estabilizar: aporteParaEstabilizar(projeto, cen, regras),
      estresse: testesDeEstresse(projeto, cen, regras),
    };
  }, [projeto, cen, regras, res.status]);

  const filtros = (
    <div className="filtros">
      <SeletorCenario ativo={ativo} aoMudar={aoMudarCenario} />
      <span className="pilula neutra">Horizonte {res.anoInicial}–{res.anoFinal}</span>
      <span className={`pilula ${projeto.juridico.aplicarTeto ? 'neutra' : 'atencao'}`}>{projeto.juridico.aplicarTeto ? 'EC 136 vigente (teto aplicado)' : 'Teto afastado (contrafactual)'}</span>
      <span className="pilula neutra">§ 24: leitura {projeto.juridico.leitura24}</span>
      <span className="pilula neutra">Regras v{regras.versao}</span>
    </div>
  );

  if (res.status === 'bloqueada' || !res.linhas.length) {
    return (
      <div className="tela">
        {filtros}
        <Aviso nivel="bloqueio" titulo="A projeção não pode ser calculada com os dados atuais">
          <p>{res.motivoBloqueio ?? 'Dados insuficientes.'}</p>
          <button type="button" className="botao" onClick={() => irPara('enquadramento')}>Completar o enquadramento</button>
        </Aviso>
        <Secao titulo="O que falta para melhorar a previsão?" id="falta">
          <Checklist itens={checklist} />
        </Secao>
      </div>
    );
  }

  const L = res.linhas;
  const l0 = L[0];
  const ult = L[L.length - 1];
  const anos = L.map((l) => l.ano);
  const e0 = l0.enquadramento;
  const origemLimite = origemMaisFraca(d.rclAnterior.origem, d.moraEm1Jan.valor === null ? 'analista' : d.moraEm1Jan.origem);
  const entra0 = l0.novosCreditos + l0.atualizacaoTotal;
  const zerar10 = extras?.zerar[0];

  return (
    <div className="tela">
      {filtros}
      {res.status === 'parametrica' && (
        <Aviso nivel="critico" titulo="Simulação parametrizada, sem verificação legal da faixa">
          <p>O estoque em mora é desconhecido; a alíquota manual de {formatarBp(d.aliquotaManual.valor)} foi aplicada em todos os anos. Use só como exploração.</p>
        </Aviso>
      )}

      <div className="respostas" aria-label={`Respostas do cenário ${NOMES[ativo]}`}>
        <article className="resposta">
          <p className="resposta-pergunta">Qual o limite do § 23 em {l0.ano}?</p>
          <p className="resposta-valor">{formatarBRL(l0.limite)}</p>
          <p className="resposta-apoio">
            {e0.status === 'calculada' ? <>{formatarBp(e0.aliquotaAplicavelBp)} da RCL de {l0.ano - 1} · mora/RCL {formatarPct(e0.razao)}</> : e0.status === 'manual' ? 'Alíquota manual, não verificada' : '—'}
          </p>
          <div className="resposta-rodape">
            <Selo origem={origemLimite} />
            <DeOndeVeio
              formula={e0.status === 'calculada' ? [
                `razão = ${formatarBRL(e0.moraEm1Jan)} ÷ ${formatarBRL(e0.rclAnterior)} = ${formatarPct(e0.razao, 4)}`,
                `${e0.descricaoFaixa} → ${formatarBp(e0.aliquotaBaseBp)}${e0.adicional.bp ? ` + ${formatarBp(e0.adicional.bp)} (§ 24)` : ''}`,
                `limite = ${formatarBRL(e0.rclAnterior)} × ${formatarBp(e0.aliquotaAplicavelBp)} = ${formatarBRL(e0.limite)}`,
              ] : undefined}
              itens={[
                { rotulo: `RCL de ${l0.ano - 1}`, valor: formatarBRL(d.rclAnterior.valor), origem: d.rclAnterior.origem, fonte: d.rclAnterior.fonte, dataBase: d.rclAnterior.dataBase },
                { rotulo: `Estoque em mora em 1º/1/${l0.ano}`, valor: d.moraEm1Jan.valor === null ? 'indeterminado' : formatarBRL(d.moraEm1Jan.valor), origem: d.moraEm1Jan.origem, fonte: d.moraEm1Jan.fonte, dataBase: d.moraEm1Jan.dataBase },
                { rotulo: 'Regra aplicada', valor: `${regras.faixas.dispositivo}, v${regras.versao}` },
              ]}
            />
          </div>
          <p className="resposta-nota">É teto, não pagamento esperado.</p>
        </article>

        <article className="resposta">
          <p className="resposta-pergunta">Quanto entra em {l0.ano}?</p>
          <p className="resposta-valor">{formatarBRL(entra0)}</p>
          <p className="resposta-apoio">Novos créditos {formatarCompacto(l0.novosCreditos)} + atualização {formatarCompacto(l0.atualizacaoTotal)}</p>
          <div className="resposta-rodape">
            <Selo origem="hipotese" />
            <DeOndeVeio itens={[
              { rotulo: 'Novas inscrições apresentadas no ano', valor: formatarBRL(l0.novosCreditos), origem: 'hipotese', fonte: `Cenário ${NOMES[ativo]}` },
              { rotulo: 'Atualização do estoque (mora, a vencer e contas)', valor: formatarBRL(l0.atualizacaoTotal), origem: 'estimado', fonte: `Taxas do cenário: mora ${formatarPct(cen.taxaMora)}, a vencer ${formatarPct(cen.taxaAVencer)}` },
            ]} formula={['A atualização é atalho de cenário, sem valor jurídico homologável.']} />
          </div>
        </article>

        <article className="resposta">
          <p className="resposta-pergunta">Quanto sai em {l0.ano}?</p>
          <p className="resposta-valor">{formatarBRL(l0.reducoes)}</p>
          <p className="resposta-apoio">Aportado às contas {formatarCompacto(l0.depositoTotal)} · pago aos credores {formatarCompacto(l0.pagamentosCredores)}{l0.renunciaAcordos + l0.outrasExtincoes > 0 ? ` · renúncias e extinções ${formatarCompacto(l0.renunciaAcordos + l0.outrasExtincoes)}` : ''}</p>
          <div className="resposta-rodape">
            <Selo origem="estimado" />
            <DeOndeVeio itens={[
              { rotulo: 'Base do aporte', valor: { limite: 'Limite do § 23', plano: 'Plano anual', valor_fixo: 'Valor fixo', pct_exigivel: '% do exigível' }[cen.baseDeposito] },
              { rotulo: 'Execução dos depósitos', valor: formatarPct(l0.execucao, 0), origem: 'hipotese' },
              { rotulo: 'Aporte às contas especiais', valor: formatarBRL(l0.depositoTotal) },
              { rotulo: 'Pago aos credores no ano', valor: formatarBRL(l0.pagamentosCredores) },
            ]} formula={['Depósito não é pagamento: o que fica na conta continua devido aos credores.']} />
          </div>
        </article>

        <article className="resposta">
          <p className="resposta-pergunta">O passivo cresce?</p>
          <p className="resposta-valor"><Trajetoria t={res.trajetoria} /></p>
          <p className="resposta-apoio">
            {formatarCompacto(l0.passivoInicial)} em 1º/1/{l0.ano} → {formatarCompacto(ult.passivoFinal)} em 31/12/{ult.ano}
            {res.variacaoRelativa !== null ? ` (${res.variacaoRelativa > 0 ? '+' : ''}${formatarPct(res.variacaoRelativa, 0)})` : ''}
          </p>
          <p className="resposta-nota">Em {l0.ano}: {l0.variacaoAntesAtualizacao >= 0 ? '+' : ''}{formatarCompacto(l0.variacaoAntesAtualizacao)} antes da atualização; {l0.variacaoLiquida >= 0 ? '+' : ''}{formatarCompacto(l0.variacaoLiquida)} com ela.</p>
        </article>

        <article className="resposta">
          <p className="resposta-pergunta">É possível zerar a mora?</p>
          <p className={`resposta-frase ${res.convergiu ? 'bom' : 'ruim'}`}>{res.mensagemConvergencia}</p>
          {zerar10 && zerar10.alcancavel && zerar10.extraAnual !== null && zerar10.extraAnual > 0 && (
            <p className="resposta-apoio">Para zerar até 1º/1/{zerar10.anoAlvo}: aporte extra de {formatarCompacto(zerar10.extraAnual)}/ano ({formatarPct(zerar10.pctRCL, 2)} da RCL de {l0.ano - 1}), acima do teto, com dotação específica (§ 28).</p>
          )}
        </article>
      </div>

      <div className="faixa-status">
        <div className={`grau grau-${grau.grau}`}>
          <span className="grau-letra" aria-hidden="true">{grau.grau}</span>
          <div>
            <p className="grau-titulo">Robustez dos dados: {grau.grau} — {grau.titulo}</p>
            <p>{grau.motivo}</p>
          </div>
        </div>
        <button type="button" className="indeterminado" onClick={() => irPara('alvo')}>
          <span className="indet-rotulo">Precatório-alvo</span>
          <span>{TEXTO_INDETERMINADO}</span>
        </button>
      </div>

      <Secao titulo="Alertas" subtitulo="Bloqueios, premissas sensíveis e pontos de atenção do cenário." id="alertas">
        <ListaAlertas alertas={alertas} irPara={irPara} />
      </Secao>

      <Secao titulo="Evolução" subtitulo={`Cenário ${NOMES[ativo]}. Valores nominais em R$. Passe o cursor ou use as setas para ler cada ano.`} id="evolucao">
        <div className="graficos-grade">
          <GraficoLinhas id="g-passivo" titulo="Passivo pendente para os credores" descricao="Saldo em 31/12 de cada ano (R$)" anos={anos} formatar={(v) => formatarCompacto(v)} formatarEixo={eixoReais}
            series={[
              { id: 'passivo', nome: 'Passivo total (estoque + contas)', cor: 'var(--s1)', valores: L.map((l) => l.passivoFinal) },
              { id: 'mora', nome: 'Estoque em mora (1º/jan seguinte)', cor: 'var(--s2)', valores: L.map((l) => l.moraProximo1Jan) },
            ]} />
          <GraficoBarras id="g-entradas" titulo="Entradas × reduções" descricao="Movimentos de cada exercício (R$)" anos={anos} formatar={(v) => formatarCompacto(v)} formatarEixo={eixoReais}
            series={[
              { id: 'entradas', nome: 'Entradas: novos créditos + atualização', cor: 'var(--s2)', valores: L.map((l) => l.novosCreditos + l.atualizacaoTotal) },
              { id: 'reducoes', nome: 'Reduções: pagamentos + extinções', cor: 'var(--s3)', valores: L.map((l) => l.reducoes) },
            ]} />
          <GraficoLinhas id="g-razao" titulo="Mora/RCL e as faixas do § 23" descricao="Razão em 1º/jan; as linhas horizontais marcam os limiares (%)" anos={anos} formatar={(v) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`} formatarEixo={(v) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%`}
            referencias={regras.faixas.limiaresBp.map((b, i) => ({ valor: b / 100, rotulo: `${b / 100}%: ${formatarBp(regras.faixas.aliquotasBp[i])} → ${formatarBp(regras.faixas.aliquotasBp[i + 1])}` }))}
            series={[{ id: 'razao', nome: 'Mora/RCL', cor: 'var(--s1)', valores: L.map((l) => (l.enquadramento.status === 'calculada' ? l.enquadramento.razao * 100 : null)) }]}
            notaRodape="Quando a razão cruza um limiar, a alíquota sobe meio ponto. Abaixo dele, o teto acompanha só a RCL." />
          <GraficoLinhas id="g-rcl" titulo="RCL × estoque em mora" descricao="RCL do exercício anterior e mora em 1º/jan de cada ano (R$)" anos={anos} formatar={(v) => formatarCompacto(v)} formatarEixo={eixoReais}
            series={[
              { id: 'rcl', nome: 'RCL do exercício anterior', cor: 'var(--s1)', valores: L.map((l) => l.rclAnterior.valor) },
              { id: 'mora', nome: 'Estoque em mora em 1º/jan', cor: 'var(--s2)', valores: L.map((l) => l.moraEm1Jan.valor) },
            ]} />
          <GraficoLinhas id="g-cenarios" titulo="Passivo nos três cenários" descricao="Passivo total em 31/12 (R$)" anos={anos} formatar={(v) => formatarCompacto(v)} formatarEixo={eixoReais}
            series={(['conservador', 'base', 'favoravel'] as IdCenario[]).map((id) => ({ id, nome: NOMES[id], cor: id === 'base' ? 'var(--s1)' : id === 'conservador' ? 'var(--s2)' : 'var(--s3)', valores: anos.map((a) => resultados[id].linhas.find((l) => l.ano === a)?.passivoFinal ?? null) }))} />
        </div>
      </Secao>

      <Secao titulo="Memória de cálculo" subtitulo="Cada exercício da projeção, com a natureza de cada número e a conciliação." id="memoria">
        <MemoriaCalculo res={res} />
      </Secao>

      {extras && (
        <Secao titulo="Sensibilidade" subtitulo={`Um parâmetro por vez sobre o cenário ${NOMES[ativo]} (seção 7 da especificação).`} id="sensibilidade">
          <div className="rolagem-x tabela-moldura">
            <table className="tabela">
              <thead>
                <tr>
                  <th scope="col">Teste</th>
                  <th scope="col">Premissa</th>
                  <th scope="col" className="num">Passivo em {ult.ano}</th>
                  <th scope="col" className="num">Diferença</th>
                  <th scope="col" className="num">Mora em 1º/1/{ult.ano + 1}</th>
                  <th scope="col">Mora zerada em</th>
                </tr>
              </thead>
              <tbody>
                <tr className="linha-base">
                  <th scope="row">Cenário {NOMES[ativo]}</th>
                  <td>Sem choque</td>
                  <td className="num">{formatarCompacto(extras.estresse.base.passivoFinal)}</td>
                  <td className="num">—</td>
                  <td className="num">{formatarCompacto(extras.estresse.base.moraFinal)}</td>
                  <td>{extras.estresse.base.anoZeragemMora ? `1º/1/${extras.estresse.base.anoZeragemMora}` : 'Não zera no horizonte'}</td>
                </tr>
                {extras.estresse.testes.map((t) => (
                  <tr key={t.id}>
                    <th scope="row">{t.titulo}</th>
                    <td>{t.premissa}</td>
                    <td className="num">{formatarCompacto(t.resumo.passivoFinal)}</td>
                    <td className={`num ${(t.deltaPassivo ?? 0) > 0 ? 'sobe' : (t.deltaPassivo ?? 0) < 0 ? 'desce' : ''}`}>{t.deltaPassivo === null ? '—' : `${t.deltaPassivo > 0 ? '+' : ''}${formatarCompacto(t.deltaPassivo)}`}</td>
                    <td className="num">{formatarCompacto(t.resumo.moraFinal)}</td>
                    <td>{t.resumo.anoZeragemMora ? `1º/1/${t.resumo.anoZeragemMora}` : 'Não zera no horizonte'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="nota">Mudanças de faixa podem produzir efeitos contraintuitivos: mais dívida em mora pode elevar a alíquota e, com ela, o teto de pagamento.</p>
          <h3 className="sub">Quanto precisaria aportar?</h3>
          <div className="aportes">
            {extras.zerar.map((z) => (
              <div key={z.anoAlvo} className="aporte">
                <p className="aporte-rotulo">Zerar a mora até 1º/1/{z.anoAlvo}</p>
                <p className="aporte-valor">{z.extraAnual === null ? '—' : z.extraAnual === 0 ? 'Já zera' : `+${formatarCompacto(z.extraAnual)}/ano`}</p>
                <p className="aporte-apoio">{z.pctRCL !== null && z.extraAnual ? `${formatarPct(z.pctRCL)} da RCL de ${l0.ano - 1}` : z.texto}</p>
              </div>
            ))}
            <div className="aporte">
              <p className="aporte-rotulo">Estabilizar o passivo até {extras.estabilizar.anoAlvo ?? ult.ano}</p>
              <p className="aporte-valor">{extras.estabilizar.extraAnual === null ? '—' : extras.estabilizar.extraAnual === 0 ? 'Já estável' : `+${formatarCompacto(extras.estabilizar.extraAnual)}/ano`}</p>
              <p className="aporte-apoio">{extras.estabilizar.pctRCL !== null && extras.estabilizar.extraAnual ? `${formatarPct(extras.estabilizar.pctRCL)} da RCL de ${l0.ano - 1}` : extras.estabilizar.texto}</p>
            </div>
          </div>
          <p className="nota">Aporte extra constante somado ao cenário, acima do teto do § 23: só é possível com dotação orçamentária específica (§ 28). Simulação, não recomendação.</p>
        </Secao>
      )}

      <Secao titulo="O que falta para melhorar a previsão?" subtitulo="Perguntas de qualificação da seção 16, conferidas contra os dados do projeto." id="falta">
        <Checklist itens={checklist} />
      </Secao>
    </div>
  );
}

export function Checklist({ itens }: { itens: ItemChecklist[] }) {
  const rot = { ok: 'Respondida', pendente: 'Pendente', fase2: 'Fase 2' };
  const ic = { ok: '✓', pendente: '○', fase2: '…' };
  return (
    <ul className="checklist">
      {itens.map((i) => (
        <li key={i.id} className={`check-${i.status}`}>
          <span className="check-icone" aria-hidden="true">{ic[i.status]}</span>
          <div>
            <p>{i.pergunta}</p>
            {i.status !== 'ok' && <p className="check-como">{i.comoResolver}</p>}
          </div>
          <span className="check-status">{rot[i.status]}</span>
        </li>
      ))}
    </ul>
  );
}
