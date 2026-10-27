import React, { useEffect, useState } from 'react';
import type { Centavos, LinhaHistorico, Movimento, Origem, Projeto, TipoMovimento, TipoSerie } from '../../dominio/tipos';
import { conciliarHistorico, estatisticasHistoricas, interpretarSerie } from '../../motores/motorEstoque';
import { aplicarMovimentos, conservacaoLivros, ROTULO_MOVIMENTO } from '../../motores/motorFluxoCaixa';
import { ROTULO_ORIGEM } from '../../motores/motorRiscos';
import { formatarBRL, formatarNumeroBRL, formatarPct, lerValorBRL } from '../../dominio/dinheiro';
import { Aviso, CampoMoeda, Secao } from '../componentes/base';
import { novoId } from '../util';

type Atualizar = (fn: (p: Projeto) => Projeto) => void;

function CelulaMoeda({ id, rotulo, valor, aoMudar }: { id: string; rotulo: string; valor: Centavos | null | undefined; aoMudar: (v: Centavos | null) => void }) {
  const [t, setT] = useState(formatarNumeroBRL(valor ?? null));
  const [foco, setFoco] = useState(false);
  const [erro, setErro] = useState(false);
  useEffect(() => { if (!foco) setT(formatarNumeroBRL(valor ?? null)); }, [valor, foco]);
  return (
    <input id={id} aria-label={rotulo} className={`celula${erro ? ' invalida' : ''}`} inputMode="decimal" value={t} placeholder="—"
      onFocus={() => setFoco(true)} onChange={(e) => setT(e.target.value)}
      onBlur={() => {
        setFoco(false);
        if (t.trim() === '') { setErro(false); aoMudar(null); return; }
        const v = lerValorBRL(t);
        if (v === null || v < 0) { setErro(true); return; }
        setErro(false);
        aoMudar(v);
      }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
  );
}

const COLS: { k: keyof LinhaHistorico; rotulo: string; tipo: 'fluxo' | 'saldo' | 'movimento' }[] = [
  { k: 'rcl', rotulo: 'RCL do exercício', tipo: 'fluxo' },
  { k: 'moraEm1Jan', rotulo: 'Mora em 1º/jan', tipo: 'saldo' },
  { k: 'estoqueInicial', rotulo: 'Estoque inicial', tipo: 'saldo' },
  { k: 'novasInscricoes', rotulo: 'Novas inscrições', tipo: 'movimento' },
  { k: 'atualizacao', rotulo: 'Atualização', tipo: 'movimento' },
  { k: 'depositos', rotulo: 'Depósitos nas contas', tipo: 'movimento' },
  { k: 'pagamentos', rotulo: 'Pagamentos a credores', tipo: 'movimento' },
  { k: 'baixas', rotulo: 'Outras baixas', tipo: 'movimento' },
  { k: 'estoqueFinal', rotulo: 'Estoque final', tipo: 'saldo' },
];

export function TelaHistorico({ projeto, atualizar }: { projeto: Projeto; atualizar: Atualizar }) {
  return (
    <div className="tela">
      <Historico projeto={projeto} atualizar={atualizar} />
      <Serie projeto={projeto} atualizar={atualizar} />
      <Livros projeto={projeto} atualizar={atualizar} />
    </div>
  );
}

function Historico({ projeto, atualizar }: { projeto: Projeto; atualizar: Atualizar }) {
  const linhas = [...projeto.historico].sort((a, b) => a.exercicio - b.exercicio);
  const conc = new Map(conciliarHistorico(linhas).map((c) => [c.id, c]));
  const est = estatisticasHistoricas(linhas);
  const setLinha = (id: string, patch: Partial<LinhaHistorico>) => atualizar((p) => ({ ...p, historico: p.historico.map((h) => (h.id === id ? { ...h, ...patch } : h)) }));
  const adicionar = () => atualizar((p) => {
    const ult = Math.max(p.anoBase - 4, ...p.historico.map((h) => h.exercicio));
    const ant = p.historico.find((h) => h.exercicio === ult);
    return { ...p, historico: [...p.historico, { id: novoId('h'), exercicio: ult + 1, rcl: null, moraEm1Jan: null, estoqueInicial: ant?.estoqueFinal ?? null, novasInscricoes: null, atualizacao: null, depositos: null, pagamentos: null, baixas: null, estoqueFinal: null, origem: 'analista', fonte: '' }] };
  });
  const aplicarCenarioBase = (patch: { novasInscricoesAno?: number; crescimentoRCL?: number }) => atualizar((p) => ({ ...p, cenarios: p.cenarios.map((c) => (c.id === 'base' ? { ...c, ...patch } : c)) }));

  return (
    <Secao titulo="Histórico da dívida e dos pagamentos" subtitulo="Cada coluna tem natureza declarada: saldo (fotografia numa data), movimento (no exercício) ou fluxo anual. A conciliação usa a visão do saldo pendente para os credores; depósitos ficam de fora, porque depósito não é pagamento." id="historico"
      acoes={<button type="button" className="botao" onClick={adicionar}>Adicionar exercício</button>}>
      {linhas.length === 0 ? <p className="vazio">Nenhum exercício informado. Adicione ao menos três exercícios comparáveis.</p> : (
        <div className="rolagem-x tabela-moldura">
          <table className="tabela editavel">
            <thead>
              <tr>
                <th scope="col">Exercício</th>
                {COLS.map((c) => <th key={c.k} scope="col" className="num">{c.rotulo}<span className="tipo-col">{c.tipo}</span></th>)}
                <th scope="col">Natureza</th>
                <th scope="col">Conciliação</th>
                <th scope="col"><span className="sr">Remover</span></th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((h) => {
                const c = conc.get(h.id);
                return (
                  <tr key={h.id}>
                    <th scope="row"><input aria-label="Exercício" className="celula curta" inputMode="numeric" value={h.exercicio} onChange={(e) => { const n = Number(e.target.value); if (Number.isInteger(n) && n > 1990 && n < 2100) setLinha(h.id, { exercicio: n }); }} /></th>
                    {COLS.map((col) => (
                      <td key={col.k}><CelulaMoeda id={`h-${h.id}-${col.k}`} rotulo={`${col.rotulo} ${h.exercicio}`} valor={h[col.k] as Centavos | null} aoMudar={(v) => setLinha(h.id, { [col.k]: v } as Partial<LinhaHistorico>)} /></td>
                    ))}
                    <td>
                      <select aria-label={`Natureza ${h.exercicio}`} value={h.origem} onChange={(e) => setLinha(h.id, { origem: e.target.value as Origem })}>
                        {(['oficial', 'analista', 'hipotese', 'estimado'] as Origem[]).map((o) => <option key={o} value={o}>{ROTULO_ORIGEM[o]}</option>)}
                      </select>
                    </td>
                    <td className="conc">
                      {c?.status === 'conciliado' && <span className="ok">✓ conciliado</span>}
                      {c?.status === 'divergente' && <span className="falha" title={c.mensagem}>✗ dif. {formatarBRL(c.diferenca)}</span>}
                      {c?.status === 'incompleto' && <span className="neutro">incompleto</span>}
                      {c?.continuidade === 'quebra' && <span className="falha" title="O estoque inicial não é igual ao final do exercício anterior."> · quebra de série</span>}
                    </td>
                    <td><button type="button" className="botao pequeno fantasma" onClick={() => atualizar((p) => ({ ...p, historico: p.historico.filter((x) => x.id !== h.id) }))} aria-label={`Remover ${h.exercicio}`}>Remover</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="estatisticas">
        <div><p className="rotulo">Média de novas inscrições</p><p className="valor num">{formatarBRL(est.mediaInscricoes)}</p>{est.mediaInscricoes !== null && <button type="button" className="link" onClick={() => aplicarCenarioBase({ novasInscricoesAno: est.mediaInscricoes as number })}>Usar no cenário base</button>}</div>
        <div><p className="rotulo">Crescimento médio da RCL (CAGR)</p><p className="valor num">{formatarPct(est.cagrRCL)}</p>{est.cagrRCL !== null && <button type="button" className="link" onClick={() => aplicarCenarioBase({ crescimentoRCL: Math.round((est.cagrRCL as number) * 10000) / 10000 })}>Usar no cenário base</button>}</div>
        <div><p className="rotulo">Variação anual da RCL (mín.–máx.)</p><p className="valor num">{est.crescimentoRCLMin === null ? '—' : `${formatarPct(est.crescimentoRCLMin)} a ${formatarPct(est.crescimentoRCLMax)}`}</p></div>
      </div>
    </Secao>
  );
}

function Serie({ projeto, atualizar }: { projeto: Projeto; atualizar: Atualizar }) {
  const s = projeto.serie;
  const i = interpretarSerie(s);
  const setTipo = (tipo: TipoSerie) => atualizar((p) => ({ ...p, serie: { ...p.serie, tipo } }));
  return (
    <Secao titulo="Valores anuais informados: saldo ou entrada?" subtitulo="Primeira decisão do formulário (seção 10): fotografias sucessivas do mesmo estoque nunca são somadas como se fossem títulos novos." id="serie"
      acoes={<button type="button" className="botao fantasma" onClick={() => atualizar((p) => ({ ...p, serie: { ...p.serie, pontos: [...p.serie.pontos, { ano: (p.serie.pontos[p.serie.pontos.length - 1]?.ano ?? p.anoBase - 2) + 1, valor: 0 }] } }))}>Adicionar ano</button>}>
      <div className="serie">
        <div className="serie-pontos">
          {s.pontos.map((pt, k) => (
            <div key={k} className="serie-ponto">
              <input aria-label="Ano" className="celula curta" inputMode="numeric" value={pt.ano} onChange={(e) => { const n = Number(e.target.value); if (Number.isInteger(n)) atualizar((p) => ({ ...p, serie: { ...p.serie, pontos: p.serie.pontos.map((x, j) => (j === k ? { ...x, ano: n } : x)) } })); }} />
              <CelulaMoeda id={`serie-${k}`} rotulo={`Valor de ${pt.ano}`} valor={pt.valor} aoMudar={(v) => atualizar((p) => ({ ...p, serie: { ...p.serie, pontos: p.serie.pontos.map((x, j) => (j === k ? { ...x, valor: v ?? 0 } : x)) } }))} />
              <button type="button" className="botao pequeno fantasma" onClick={() => atualizar((p) => ({ ...p, serie: { ...p.serie, pontos: p.serie.pontos.filter((_, j) => j !== k) } }))}>Remover</button>
            </div>
          ))}
        </div>
        <fieldset className="opcoes-radio">
          <legend>Esses valores são…</legend>
          {([['fotografia', 'Fotografias do estoque total em cada data'], ['lote', 'Lotes de novos precatórios de cada exercício'], ['nao_informado', 'Ainda não sei']] as [TipoSerie, string][]).map(([v, r]) => (
            <label key={v}><input type="radio" name="serie-tipo" value={v} checked={s.tipo === v} onChange={() => setTipo(v)} /> {r}</label>
          ))}
        </fieldset>
      </div>
      {i.status === 'pendente' && <Aviso nivel="atencao" titulo="Classificação pendente"><p>{i.pergunta}</p></Aviso>}
      {i.status === 'fotografia' && (
        <Aviso nivel="info" titulo={`Estoque mais recente: ${formatarBRL(i.estoqueMaisRecente)} (${i.anoMaisRecente})`}>
          <p>{i.texto}</p>
          <p>{i.variacoes.map((v) => `${v.ano}: ${v.variacao >= 0 ? '+' : ''}${formatarBRL(v.variacao)}`).join(' · ')}. A soma das fotos ({formatarBRL(i.somaIndevida)}) não tem significado.</p>
        </Aviso>
      )}
      {i.status === 'lote' && <Aviso nivel="info" titulo={`Agregado dos lotes: ${formatarBRL(i.agregadoLotes)}`}><p>{i.texto}</p></Aviso>}
    </Secao>
  );
}

const TIPOS: TipoMovimento[] = ['deposito_conta_especial', 'pagamento_da_conta', 'nova_inscricao', 'atualizacao', 'acordo_direto', 'extincao_sem_caixa', 'estorno'];

function Livros({ projeto, atualizar }: { projeto: Projeto; atualizar: Atualizar }) {
  const li = projeto.livroInicial;
  const r = aplicarMovimentos(li, projeto.movimentos);
  const cons = conservacaoLivros(li, r);
  const setMov = (idx: number, patch: Partial<Movimento>) => atualizar((p) => ({ ...p, movimentos: p.movimentos.map((m, j) => (j === idx ? { ...m, ...patch } : m)) }));
  const setLi = (patch: Partial<Projeto['livroInicial']>) => atualizar((p) => ({ ...p, livroInicial: { ...p.livroInicial, ...patch } }));
  const situacao = new Map(r.linhas.map((l) => [l.movimento, l]));
  return (
    <Secao titulo="Livros A e B: conciliação de depósitos e pagamentos" subtitulo="O depósito tira o valor do estoque (Livro A, § 30) e o põe na conta especial (Livro B). O pagamento sai da conta. Nunca abate o estoque de novo." id="livros"
      acoes={<button type="button" className="botao" onClick={() => atualizar((p) => ({ ...p, movimentos: [...p.movimentos, { id: `MOV-${String(p.movimentos.length + 1).padStart(3, '0')}`, data: `${p.anoBase}-01-31`, tipo: 'deposito_conta_especial', valor: 0, conta: 'cronologica', origem: 'analista' }] }))}>Lançar movimento</button>}>
      <div className="grade-campos">
        <CampoMoeda id="li-a" rotulo="Estoque inicial fora das contas" valor={li.estoqueForaDasContas} aoMudar={(v) => setLi({ estoqueForaDasContas: v ?? 0 })} />
        <CampoMoeda id="li-bc" rotulo="Saldo inicial, conta cronológica" valor={li.saldoContaCronologica} aoMudar={(v) => setLi({ saldoContaCronologica: v ?? 0 })} />
        <CampoMoeda id="li-ba" rotulo="Saldo inicial, conta de acordos" valor={li.saldoContaAcordos} aoMudar={(v) => setLi({ saldoContaAcordos: v ?? 0 })} />
      </div>
      <div className="rolagem-x tabela-moldura">
        <table className="tabela editavel">
          <thead>
            <tr><th scope="col">Identificador</th><th scope="col">Data</th><th scope="col">Tipo</th><th scope="col">Conta</th><th scope="col" className="num">Valor</th><th scope="col" className="num">Face (acordo)</th><th scope="col">Referência</th><th scope="col">Situação</th><th scope="col"><span className="sr">Remover</span></th></tr>
          </thead>
          <tbody>
            {projeto.movimentos.map((m, k) => {
              const s = situacao.get(m);
              return (
                <tr key={`${m.id}-${k}`}>
                  <td><input aria-label="Identificador" className="celula" value={m.id} onChange={(e) => setMov(k, { id: e.target.value })} /></td>
                  <td><input aria-label="Data" type="date" className="celula" value={m.data} onChange={(e) => setMov(k, { data: e.target.value })} /></td>
                  <td><select aria-label="Tipo" value={m.tipo} onChange={(e) => setMov(k, { tipo: e.target.value as TipoMovimento })}>{TIPOS.map((t) => <option key={t} value={t}>{ROTULO_MOVIMENTO[t]}</option>)}</select></td>
                  <td><select aria-label="Conta" value={m.conta ?? 'cronologica'} onChange={(e) => setMov(k, { conta: e.target.value as 'cronologica' | 'acordos' })}><option value="cronologica">Cronológica</option><option value="acordos">Acordos</option></select></td>
                  <td><CelulaMoeda id={`mov-${k}-v`} rotulo="Valor" valor={m.valor} aoMudar={(v) => setMov(k, { valor: v ?? 0 })} /></td>
                  <td>{m.tipo === 'acordo_direto' ? <CelulaMoeda id={`mov-${k}-f`} rotulo="Valor de face" valor={m.valorFace ?? null} aoMudar={(v) => setMov(k, { valorFace: v ?? undefined })} /> : <span className="neutro">—</span>}</td>
                  <td><input aria-label="Referência" className="celula" value={m.referencia ?? ''} onChange={(e) => setMov(k, { referencia: e.target.value })} /></td>
                  <td>{s?.aplicado ? <span className="ok">✓ aplicado</span> : <span className="falha" title={s?.mensagem}>✗ {s?.mensagem ?? 'não aplicado'}</span>}</td>
                  <td><button type="button" className="botao pequeno fantasma" onClick={() => atualizar((p) => ({ ...p, movimentos: p.movimentos.filter((_, j) => j !== k) }))}>Remover</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {r.avisos.map((a, i) => <Aviso key={`a${i}`} nivel="atencao" titulo="Possível duplicidade"><p>{a}</p></Aviso>)}
      <div className="indicadores">
        <div><p className="rotulo">Estoque fora das contas (§ 30)</p><p className="valor num">{formatarBRL(r.indicadores.estoqueForaDasContas)}</p></div>
        <div><p className="rotulo">Depositado e ainda não pago</p><p className="valor num">{formatarBRL(r.indicadores.saldoNasContas)}</p></div>
        <div><p className="rotulo">Pago aos credores</p><p className="valor num">{formatarBRL(r.indicadores.pagoAosCredores)}</p></div>
        <div className="destaque"><p className="rotulo">Obrigação ainda não recebida</p><p className="valor num">{formatarBRL(r.indicadores.obrigacaoNaoRecebida)}</p></div>
      </div>
      <p className="nota">{cons.ok ? '✓ Livro conciliado: obrigação não recebida = inicial + inscrições + atualização − pagamentos − renúncias − extinções.' : `✗ Diferença de conciliação: ${formatarBRL(cons.diferenca)}.`} Controle gerencial, não definição contábil oficial dos saldos.</p>
    </Secao>
  );
}
