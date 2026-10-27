import React, { useMemo, useState } from 'react';
import type { Leitura24, Projeto, Verificacao24 } from '../../dominio/tipos';
import type { RegrasJuridicas } from '../../regras/regrasJuridicas';
import { preverRecebimentoIndividual } from '../../motores/motorFila';
import { anoEntradaEmMora, exercicioDePagamento } from '../../motores/motorEstoque';
import { executarCasos } from '../../casos/casosAceite';
import { formatarBp, formatarData } from '../../dominio/dinheiro';
import { Aviso, Secao } from '../componentes/base';

type Atualizar = (fn: (p: Projeto) => Projeto) => void;

/* ------------------------- Precatório-alvo (Fase 1) ------------------------- */

export function TelaAlvo({ regras }: { regras: RegrasJuridicas }) {
  const prev = preverRecebimentoIndividual({});
  const [data, setData] = useState('2026-03-15');
  let crono: { exercicio: number; mora: number } | null = null;
  try {
    const ex = exercicioDePagamento(data, regras);
    crono = { exercicio: ex, mora: anoEntradaEmMora(ex) };
  } catch {
    crono = null;
  }
  return (
    <div className="tela">
      <div className="indeterminado-grande" role="status">
        <p className="indet-rotulo">Precatório-alvo</p>
        <p className="indet-texto">{prev.texto}</p>
        <p>{prev.observacao}</p>
      </div>
      <div className="duas-colunas">
        <Secao titulo="O que falta para estimar o recebimento" subtitulo="Sem a posição na fila, o total da dívida não diz quando um título específico será pago." id="alvo-falta">
          <ul className="checklist">
            {prev.faltantes.map((f) => (
              <li key={f} className="check-fase2"><span className="check-icone" aria-hidden="true">○</span><div><p>{f}</p></div><span className="check-status">Fase 2</span></li>
            ))}
          </ul>
          <p className="nota">Ordem financeira alcançada não é recebimento: cessão, reserva de honorários, penhora, suspensão, habilitação de herdeiros e pendências documentais podem impedir o levantamento.</p>
        </Secao>
        <Secao titulo="Cronologia orçamentária" subtitulo={`${regras.dataCorte.dispositivo}: apresentação até ${String(regras.dataCorte.dia).padStart(2, '0')}/${String(regras.dataCorte.mes).padStart(2, '0')}.`} id="alvo-crono">
          <div className="campo">
            <label htmlFor="alvo-data">Data de apresentação do requisitório</label>
            <input id="alvo-data" type="date" value={data} onChange={(e) => setData(e.target.value)} />
            <p className="campo-ajuda">Use a apresentação do requisitório ao tribunal, nunca a data da sentença, do trânsito ou da autuação.</p>
          </div>
          {crono && (
            <ol className="linha-tempo">
              <li><span className="lt-data">{formatarData(data)}</span> Apresentação</li>
              <li><span className="lt-data">Orçamento {crono.exercicio}</span> Pagamento devido até 31/12/{crono.exercicio}</li>
              <li><span className="lt-data">1º/1/{crono.mora}</span> Se não pago, passa a compor o estoque em mora</li>
            </ol>
          )}
          <p className="nota">Isso mostra quando o título se torna exigível, não quando será pago: com o teto do § 23, a coorte pode ficar na fila por anos.</p>
        </Secao>
      </div>
    </div>
  );
}

/* ------------------------- Regras jurídicas ------------------------- */

export function TelaRegras({ projeto, regras, atualizar }: { projeto: Projeto; regras: RegrasJuridicas; atualizar: Atualizar }) {
  const j = projeto.juridico;
  const setJ = (patch: Partial<Projeto['juridico']>) => atualizar((p) => ({ ...p, juridico: { ...p.juridico, ...patch } }));
  const ad = regras.adicionalDecenal;
  const status: Record<string, string> = { vigente: 'Vigente', vigente_sob_controle: 'Vigente, sob controle no STF', pendente_revisao: 'Pendente de revisão jurídica', informativa: 'Informativa' };
  return (
    <div className="tela">
      <div className="regras-cab">
        <div>
          <p className="eyebrow">Configuração jurídica versionada</p>
          <h2>Regras v{regras.versao}</h2>
          <p>Revisão em {formatarData(regras.dataRevisao)} · {regras.responsavelRevisao} · aprovação {regras.aprovacao === 'aprovada' ? 'concedida' : 'pendente'}</p>
        </div>
        <Aviso nivel="info" titulo="Nenhuma regra está embutida no cálculo">
          <p>Limiares, alíquotas, datas e leituras vêm deste arquivo de regras. Cada snapshot guarda a versão usada.</p>
        </Aviso>
      </div>

      <div className="duas-colunas">
        <Secao titulo="Leitura do § 24 (adicional decenal)" subtitulo={ad.nota} id="par24">
          <fieldset className="opcoes-radio">
            <legend>Leitura aplicada</legend>
            {(Object.keys(ad.leituras) as Leitura24[]).map((l) => (
              <label key={l}><input type="radio" name="leitura24" checked={j.leitura24 === l} onChange={() => setJ({ leitura24: l })} /> <strong>{l === 'fixa' ? 'Fixa' : l === 'cumulativa' ? 'Cumulativa' : 'Desligada'}</strong>{l === ad.leituraPadrao ? ' (padrão do projeto)' : ''}: {ad.leituras[l]}</label>
            ))}
          </fieldset>
          <fieldset className="opcoes-radio">
            <legend>Verificação da mora</legend>
            {(Object.keys(ad.verificacoes) as Verificacao24[]).map((v) => (
              <label key={v}><input type="radio" name="verif24" checked={j.verificacao24 === v} onChange={() => setJ({ verificacao24: v })} /> {ad.verificacoes[v]}</label>
            ))}
          </fieldset>
          <p className="pilula atencao">Pendente de revisão jurídica</p>
        </Secao>
        <Secao titulo="Cenário normativo" subtitulo={`${regras.controleConcentrado.acao} · ${regras.controleConcentrado.autor} · rel. ${regras.controleConcentrado.relator}`} id="normativo">
          <p>{regras.controleConcentrado.situacao} Consulta em {formatarData(regras.controleConcentrado.consultadoEm)}.</p>
          <fieldset className="opcoes-radio">
            <legend>Teto do § 23</legend>
            <label><input type="radio" name="teto" checked={j.aplicarTeto} onChange={() => setJ({ aplicarTeto: true })} /> <strong>EC 136 vigente:</strong> aportes ordinários limitados ao teto.</label>
            <label><input type="radio" name="teto" checked={!j.aplicarTeto} onChange={() => setJ({ aplicarTeto: false })} /> <strong>Teto afastado (contrafactual):</strong> o limite segue calculado como referência, mas não corta os aportes. Combine com a base “% do exigível” nos cenários.</label>
          </fieldset>
          <p className="nota">{regras.controleConcentrado.nota}</p>
        </Secao>
      </div>

      <Secao titulo="Faixas do § 23" subtitulo={regras.faixas.nota} id="faixas">
        <div className="rolagem-x">
          <table className="tabela compacta">
            <thead><tr><th scope="col">Inciso</th><th scope="col">Estoque em mora ÷ RCL do exercício anterior</th><th scope="col" className="num">Limite sobre a RCL</th></tr></thead>
            <tbody>
              {regras.faixas.aliquotasBp.map((a, i) => {
                const lim = regras.faixas.limiaresBp;
                const faixa = i === 0 ? `Sem estoque ou até ${lim[0] / 100}%` : i === lim.length ? `Acima de ${lim[lim.length - 1] / 100}%` : `Acima de ${lim[i - 1] / 100}% até ${lim[i] / 100}%`;
                return <tr key={i}><th scope="row">{['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'][i]}</th><td>{faixa}</td><td className="num">{formatarBp(a)}</td></tr>;
              })}
            </tbody>
          </table>
        </div>
      </Secao>

      <Secao titulo="Demais dispositivos" id="dispositivos">
        <div className="regras-lista">
          {[regras.dataCorte, ...regras.complementares].map((r) => (
            <article key={r.id} className="regra">
              <header>
                <h3>{r.titulo}</h3>
                <span className={`pilula ${r.status === 'pendente_revisao' ? 'atencao' : 'neutra'}`}>{status[r.status]}</span>
              </header>
              <p className="regra-disp">{r.dispositivo} · vigência desde {formatarData(r.vigenciaInicio)}</p>
              {r.nota && <p>{r.nota}</p>}
              <p className="regra-fonte">Fonte: {r.urlFonte ? <a href={r.urlFonte} target="_blank" rel="noreferrer">{r.fonte}</a> : r.fonte}</p>
            </article>
          ))}
        </div>
      </Secao>
    </div>
  );
}

/* ------------------------- Testes ------------------------- */

export function TelaTestes() {
  const [rodada, setRodada] = useState(0);
  const casos = useMemo(() => executarCasos(), [rodada]); // eslint-disable-line react-hooks/exhaustive-deps
  const exec = casos.filter((c) => c.executar);
  const passou = exec.filter((c) => c.resultado?.ok).length;
  return (
    <div className="tela">
      <Secao titulo="Testes de aceitação T01–T24" subtitulo="Os mesmos casos do Vitest, executados aqui contra os motores reais do aplicativo." id="testes"
        acoes={<button type="button" className="botao" onClick={() => setRodada((r) => r + 1)}>Executar novamente</button>}>
        <p className={`placar ${passou === exec.length ? 'bom' : 'ruim'}`}>{passou} de {exec.length} casos da Fase 1 passaram. {casos.length - exec.length} casos pertencem à Fase 2.</p>
        <div className="rolagem-x tabela-moldura">
          <table className="tabela">
            <thead><tr><th scope="col">ID</th><th scope="col">Teste</th><th scope="col">Comportamento esperado</th><th scope="col">Resultado</th><th scope="col">Esperado</th><th scope="col">Obtido</th></tr></thead>
            <tbody>
              {casos.map((c) => (
                <tr key={c.id}>
                  <th scope="row">{c.id}</th>
                  <td>{c.titulo}{c.escopo === 'fase1_parcial' && <span className="pilula neutra">parcial</span>}</td>
                  <td>{c.comportamento}</td>
                  <td>{!c.executar ? <span className="pilula neutra">Fase 2</span> : c.erro ? <span className="falha">Erro: {c.erro}</span> : c.resultado?.ok ? <span className="ok">✓ Passou</span> : <span className="falha">✗ Falhou</span>}</td>
                  <td className="pequeno">{c.resultado?.esperado ?? '—'}</td>
                  <td className="pequeno">{c.resultado?.obtido ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Secao>
    </div>
  );
}
