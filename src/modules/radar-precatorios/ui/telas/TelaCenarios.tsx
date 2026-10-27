import React from 'react';
import type { BaseDeposito, Cenario, Choque, IdCenario, MomentoDeposito, Projeto, TipoChoque } from '../../dominio/tipos';
import { ROTULO_MOMENTO } from '../../motores/motorAtualizacao';
import { cenariosPadrao } from '../../exemplo/municipioExemplo';
import { formatarNumeroBRL, lerValorBRL } from '../../dominio/dinheiro';
import { CampoInteiro, CampoMoeda, CampoPct, CampoSelecao, Secao, Selo } from '../componentes/base';
import { novoId } from '../util';

type Atualizar = (fn: (p: Projeto) => Projeto) => void;

const ROTULO_CHOQUE: Record<TipoChoque, string> = {
  queda_rcl: 'Queda da RCL',
  aumento_inscricoes: 'Aumento das novas inscrições',
  precatorio_excepcional: 'Precatório excepcional',
  execucao_depositos: 'Execução dos depósitos',
};

export function TelaCenarios({ projeto, atualizar }: { projeto: Projeto; atualizar: Atualizar }) {
  const setCen = (id: IdCenario, patch: Partial<Cenario>) => atualizar((p) => ({ ...p, cenarios: p.cenarios.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
  return (
    <div className="tela">
      <Secao titulo="Horizonte e tolerância" subtitulo="Valem para os três cenários." id="horizonte">
        <div className="grade-campos">
          <CampoInteiro id="horizonte-anos" rotulo="Horizonte da projeção (anos)" valor={projeto.config.horizonteAnos} min={1} max={60} aoMudar={(v) => atualizar((p) => ({ ...p, config: { ...p.config, horizonteAnos: v } }))} ajuda={`De ${projeto.anoBase} a ${projeto.anoBase + projeto.config.horizonteAnos - 1}.`} />
          <CampoPct id="tolerancia" rotulo="Tolerância para “estável”" valor={projeto.config.toleranciaEstavel} min={0} max={50} aoMudar={(v) => atualizar((p) => ({ ...p, config: { ...p.config, toleranciaEstavel: v } }))} ajuda="Variação do passivo, no horizonte, considerada estável." />
        </div>
      </Secao>
      <p className="nota destaque-nota"><Selo origem="hipotese" /> Todos os valores desta tela são hipóteses do analista, não previsões oficiais. O cenário ativo no painel é o <strong>{projeto.cenarios.find((c) => c.id === projeto.config.cenarioAtivo)?.nome}</strong>.</p>
      <div className="cenarios">
        {projeto.cenarios.map((c) => (
          <CartaoCenario key={c.id} c={c} ativo={projeto.config.cenarioAtivo === c.id} anoBase={projeto.anoBase} setCen={(patch) => setCen(c.id, patch)}
            ativar={() => atualizar((p) => ({ ...p, config: { ...p.config, cenarioAtivo: c.id } }))}
            restaurar={() => atualizar((p) => ({ ...p, cenarios: p.cenarios.map((x) => (x.id === c.id ? cenariosPadrao().find((d) => d.id === c.id)! : x)) }))} />
        ))}
      </div>
    </div>
  );
}

function CartaoCenario({ c, ativo, anoBase, setCen, ativar, restaurar }: { c: Cenario; ativo: boolean; anoBase: number; setCen: (p: Partial<Cenario>) => void; ativar: () => void; restaurar: () => void }) {
  const id = (k: string) => `${c.id}-${k}`;
  const setChoque = (cid: string, patch: Partial<Choque>) => setCen({ choques: c.choques.map((x) => (x.id === cid ? { ...x, ...patch } : x)) });
  return (
    <article className={`cenario${ativo ? ' ativo' : ''}`} aria-labelledby={id('t')}>
      <header className="cenario-cab">
        <h3 id={id('t')}>{c.nome}</h3>
        <div className="cenario-acoes">
          {ativo ? <span className="pilula neutra">Ativo no painel</span> : <button type="button" className="botao pequeno" onClick={ativar}>Usar no painel</button>}
          <button type="button" className="botao pequeno fantasma" onClick={restaurar}>Restaurar padrão</button>
        </div>
      </header>

      <fieldset><legend>RCL</legend>
        <CampoPct id={id('rcl')} rotulo="Crescimento nominal da RCL (a.a.)" valor={c.crescimentoRCL} aoMudar={(v) => setCen({ crescimentoRCL: v })} />
      </fieldset>

      <fieldset><legend>Novos precatórios</legend>
        <CampoMoeda id={id('insc')} rotulo={`Apresentados em ${anoBase}`} valor={c.novasInscricoesAno} permitirVazio={false} aoMudar={(v) => setCen({ novasInscricoesAno: v ?? 0 })} />
        <CampoPct id={id('insc-g')} rotulo="Crescimento anual das inscrições" valor={c.crescimentoInscricoes} aoMudar={(v) => setCen({ crescimentoInscricoes: v })} />
        <CampoPct id={id('corte')} rotulo="Apresentados até 1º/fev" valor={c.pctApresentadoAteCorte} min={0} max={100} aoMudar={(v) => setCen({ pctApresentadoAteCorte: v })} ajuda="Esses vencem no ano seguinte; o restante, dois anos depois (§ 5º). Apresentação uniforme ≈ 8,33%." />
      </fieldset>

      <fieldset><legend>Atualização (atalho de cenário)</legend>
        <CampoPct id={id('tx-mora')} rotulo="Estoque em mora (IPCA + 2%, teto Selic)" valor={c.taxaMora} aoMudar={(v) => setCen({ taxaMora: v })} />
        <CampoPct id={id('tx-av')} rotulo="A vencer (só correção, período do § 5º)" valor={c.taxaAVencer} aoMudar={(v) => setCen({ taxaAVencer: v })} />
        <p className="campo-ajuda">Não equivale à atualização jurídica homologada de cada precatório.</p>
      </fieldset>

      <fieldset><legend>Aportes às contas especiais</legend>
        <CampoSelecao<BaseDeposito> id={id('base')} rotulo="Base do aporte ordinário" valor={c.baseDeposito} aoMudar={(v) => setCen({ baseDeposito: v })}
          opcoes={[{ valor: 'limite', rotulo: 'Limite do § 23' }, { valor: 'plano', rotulo: 'Plano anual (1º ano) e limite depois' }, { valor: 'valor_fixo', rotulo: 'Valor fixo por ano' }, { valor: 'pct_exigivel', rotulo: '% do exigível do ano' }]} />
        {c.baseDeposito === 'valor_fixo' && <CampoMoeda id={id('fixo')} rotulo="Valor fixo por ano" valor={c.valorDepositoFixo} permitirVazio={false} aoMudar={(v) => setCen({ valorDepositoFixo: v ?? 0 })} />}
        {c.baseDeposito === 'pct_exigivel' && <CampoPct id={id('pct-ex')} rotulo="Fração do exigível (mora + coorte do ano)" valor={c.pctExigivel} min={0} max={100} aoMudar={(v) => setCen({ pctExigivel: v })} />}
        <CampoPct id={id('exec')} rotulo="Execução dos depósitos" valor={c.execucaoDepositos} min={0} max={200} aoMudar={(v) => setCen({ execucaoDepositos: v })} ajuda="100% = deposita o previsto." />
        <CampoSelecao<MomentoDeposito> id={id('mom')} rotulo="Momento dos aportes" valor={c.momentoDeposito} aoMudar={(v) => setCen({ momentoDeposito: v })} opcoes={(Object.keys(ROTULO_MOMENTO) as MomentoDeposito[]).map((m) => ({ valor: m, rotulo: ROTULO_MOMENTO[m] }))} ajuda="Valor aportado deixa de ser atualizado a partir do aporte (§ 30)." />
        <CampoMoeda id={id('extra')} rotulo="Extraordinários por ano (§ 28)" valor={c.extraordinariosAno} permitirVazio={false} aoMudar={(v) => setCen({ extraordinariosAno: v ?? 0 })} ajuda="Acima do teto, com dotação específica." />
        <CampoPct id={id('dist')} rotulo="Distribuição aos credores no ano" valor={c.taxaDistribuicao} min={0} max={100} aoMudar={(v) => setCen({ taxaDistribuicao: v })} ajuda="Parte do saldo em conta efetivamente paga. O resto continua devido." />
        <CampoPct id={id('rem')} rotulo="Remuneração bancária da conta" valor={c.remuneracaoConta} min={0} max={100} aoMudar={(v) => setCen({ remuneracaoConta: v })} />
      </fieldset>

      <fieldset><legend>Acordos e extinções</legend>
        <CampoPct id={id('acordos')} rotulo="Parte dos aportes para acordos diretos (§ 29)" valor={c.pctAcordos} min={0} max={100} aoMudar={(v) => setCen({ pctAcordos: v })} />
        <CampoPct id={id('desagio')} rotulo="Deságio médio nos acordos" valor={c.desagioAcordos} min={0} max={99} aoMudar={(v) => setCen({ desagioAcordos: v })} ajuda="A renúncia extingue dívida, mas não conta como dispêndio do plano." />
        <CampoMoeda id={id('outras')} rotulo="Outras extinções por ano (§ 26, cancelamentos)" valor={c.outrasExtincoesAno} permitirVazio={false} aoMudar={(v) => setCen({ outrasExtincoesAno: v ?? 0 })} />
      </fieldset>

      <fieldset><legend>Choques</legend>
        {c.choques.length === 0 && <p className="campo-ajuda">Nenhum choque. Use para testar um evento específico.</p>}
        {c.choques.map((ch) => (
          <div key={ch.id} className="choque">
            <CampoSelecao<TipoChoque> id={id(`ch-${ch.id}-t`)} rotulo="Tipo" valor={ch.tipo} aoMudar={(v) => setChoque(ch.id, { tipo: v, valor: v === 'precatorio_excepcional' ? 0 : 0.1 })} opcoes={(Object.keys(ROTULO_CHOQUE) as TipoChoque[]).map((t) => ({ valor: t, rotulo: ROTULO_CHOQUE[t] }))} />
            <CampoInteiro id={id(`ch-${ch.id}-a`)} rotulo="Ano" valor={ch.anoInicio} min={anoBase} max={anoBase + 59} aoMudar={(v) => setChoque(ch.id, { anoInicio: v })} />
            {ch.tipo !== 'precatorio_excepcional' && <CampoInteiro id={id(`ch-${ch.id}-d`)} rotulo="Duração (anos)" valor={ch.duracaoAnos} min={1} max={60} aoMudar={(v) => setChoque(ch.id, { duracaoAnos: v })} />}
            {ch.tipo === 'precatorio_excepcional' ? (
              <div className="campo">
                <label htmlFor={id(`ch-${ch.id}-v`)}>Valor</label>
                <input id={id(`ch-${ch.id}-v`)} defaultValue={formatarNumeroBRL(ch.valor)} onBlur={(e) => { const v = lerValorBRL(e.target.value); if (v !== null && v >= 0) setChoque(ch.id, { valor: v }); }} />
              </div>
            ) : (
              <CampoPct id={id(`ch-${ch.id}-v`)} rotulo={ch.tipo === 'execucao_depositos' ? 'Execução no período' : ch.tipo === 'queda_rcl' ? 'Queda' : 'Aumento'} valor={ch.valor} min={0} max={200} aoMudar={(v) => setChoque(ch.id, { valor: v })} />
            )}
            <button type="button" className="botao pequeno fantasma" onClick={() => setCen({ choques: c.choques.filter((x) => x.id !== ch.id) })}>Remover choque</button>
          </div>
        ))}
        <button type="button" className="botao pequeno" onClick={() => setCen({ choques: [...c.choques, { id: novoId('ch'), tipo: 'queda_rcl', anoInicio: anoBase + 1, duracaoAnos: 1, valor: 0.1 }] })}>Adicionar choque</button>
      </fieldset>
    </article>
  );
}
