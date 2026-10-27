import React, { useState } from 'react';
import type { CampoRastreado as Campo, Centavos, DadoRastreado, ObservacaoFonte, Origem, Projeto } from '../../dominio/tipos';
import type { RegrasJuridicas } from '../../regras/regrasJuridicas';
import { calcularEnquadramento } from '../../motores/motorPercentualRCL';
import { detectarConflitos, ROTULO_CAMPO, ROTULO_ORIGEM } from '../../motores/motorRiscos';
import { formatarBRL, formatarBp, formatarData, formatarPct } from '../../dominio/dinheiro';
import { Aviso, CampoMoeda, CampoPct, CampoRastreado, CampoSelecao, CampoTexto, Secao, Selo } from '../componentes/base';
import { ReguaFaixas } from '../componentes/graficos';
import { hojeISO, novoId } from '../util';

interface Props {
  projeto: Projeto;
  regras: RegrasJuridicas;
  atualizar: (fn: (p: Projeto) => Projeto) => void;
}

export function TelaEnquadramento({ projeto, regras, atualizar }: Props) {
  const t0 = projeto.anoBase;
  const d = projeto.dados;
  const setDado = (campo: keyof Projeto['dados'], v: DadoRastreado<number>) => atualizar((p) => ({ ...p, dados: { ...p.dados, [campo]: v } }));
  const e = calcularEnquadramento({ ano: t0, rclAnterior: d.rclAnterior.valor, moraEm1Jan: d.moraEm1Jan.valor, regras, leitura24: projeto.juridico.leitura24, verificacao24: projeto.juridico.verificacao24, aliquotaManualBp: d.aliquotaManual.valor });
  const total = d.totalPendente1Jan.valor;
  const aVencer = total !== null && d.moraEm1Jan.valor !== null ? total - d.moraEm1Jan.valor - (d.aVencerExercicioSeguinte.valor ?? 0) : null;

  return (
    <div className="tela">
      <div className="duas-colunas">
        <div className="coluna">
          <Secao titulo="Dados do enquadramento" subtitulo={`Insumos do art. 100, § 23, para o exercício de ${t0}. Cada número carrega sua natureza e sua fonte.`} id="insumos">
            <CampoRastreado id="rcl" rotulo={`RCL realizada em ${t0 - 1}`} dado={d.rclAnterior} aoMudar={(v) => setDado('rclAnterior', v)} mostrarPeriodo dataBaseEsperada={`${t0 - 1}-12-31`} ajuda="Exercício anterior completo (RGF/Siconfi), não 12 meses móveis." />
            <CampoRastreado id="mora" rotulo={`Estoque EM MORA em 1º/1/${t0}`} dado={d.moraEm1Jan} aoMudar={(v) => setDado('moraEm1Jan', v)} dataBaseEsperada={`${t0}-01-01`} ajuda="Precatórios vencidos e não pagos, atualizados e com juros. Não use o estoque total." />
            <CampoRastreado id="total" rotulo={`Estoque total pendente em 1º/1/${t0}`} dado={d.totalPendente1Jan} aoMudar={(v) => setDado('totalPendente1Jan', v)} dataBaseEsperada={`${t0}-01-01`} ajuda="Mora + créditos a vencer, fora das contas especiais. Recomendado para projetar o passivo." />
            <CampoRastreado id="avencer-seg" rotulo={`Já apresentados para o orçamento de ${t0 + 1}`} dado={d.aVencerExercicioSeguinte} aoMudar={(v) => setDado('aVencerExercicioSeguinte', v)} ajuda={`Parte do total que só vence em ${t0 + 1}. O restante do "a vencer" vence em ${t0}.`} />
            <CampoRastreado id="contas" rotulo={`Saldo nas contas especiais em 1º/1/${t0}`} dado={d.saldoContaEspecial1Jan} aoMudar={(v) => setDado('saldoContaEspecial1Jan', v)} ajuda="Aportado e ainda não pago aos credores (§ 30): fora do estoque, mas ainda devido." />
            <CampoRastreado id="plano" rotulo={`Plano anual homologado para ${t0}`} dado={d.planoAnual} aoMudar={(v) => setDado('planoAnual', v)} ajuda="Valor do plano aprovado pelo tribunal, se houver." />
            <fieldset className="rastreado">
              <legend>Alíquota manual <Selo origem={d.aliquotaManual.valor ? 'analista' : 'ausente'} /></legend>
              {d.moraEm1Jan.valor === null ? (
                <>
                  <CampoPct id="aliq-manual" rotulo="Alíquota sobre a RCL (simulação não verificada)" valor={(d.aliquotaManual.valor ?? 0) / 10000} min={0} max={20} aoMudar={(v) => setDado('aliquotaManual', { valor: v > 0 ? Math.round(v * 10000) : null, origem: v > 0 ? 'analista' : 'ausente' })} ajuda="Só é usada enquanto o estoque em mora for desconhecido. Use 0 para desligar." />
                </>
              ) : (
                <p className="campo-ajuda">Disponível apenas sem estoque em mora: com a mora informada, a faixa é calculada pela regra constitucional.</p>
              )}
            </fieldset>
          </Secao>
        </div>

        <div className="coluna">
          <Secao titulo={`Enquadramento ${t0}`} subtitulo={`${regras.faixas.dispositivo} · regras v${regras.versao}`} id="resultado-enq">
            {e.status === 'bloqueada' && <Aviso nivel="bloqueio" titulo="Faixa bloqueada"><p>{e.mensagem}</p></Aviso>}
            {e.status === 'indeterminada' && <Aviso nivel="bloqueio" titulo="Faixa indeterminada"><p>{e.mensagem}</p></Aviso>}
            {e.status === 'manual' && <Aviso nivel="critico" titulo="Simulação parametrizada"><p>{e.aviso}</p></Aviso>}
            {(e.status === 'calculada' || e.status === 'indeterminada') && (
              <ReguaFaixas razao={e.status === 'calculada' ? e.razao : null} faixaAtiva={e.status === 'calculada' ? e.faixa : null} limiaresBp={regras.faixas.limiaresBp} aliquotasBp={regras.faixas.aliquotasBp} />
            )}
            {e.status === 'calculada' && (
              <>
                <dl className="enq-numeros">
                  <div><dt>Mora ÷ RCL</dt><dd className="enq-destaque">{formatarPct(e.razao, 2)}</dd></div>
                  <div><dt>Faixa</dt><dd>{e.descricaoFaixa}</dd></div>
                  <div><dt>Alíquota-base</dt><dd className="num">{formatarBp(e.aliquotaBaseBp)}</dd></div>
                  <div><dt>Adicional do § 24</dt><dd className="num">{e.adicional.bp ? `+${formatarBp(e.adicional.bp)}` : 'nenhum'} <span className="campo-ajuda">{e.adicional.explicacao}</span></dd></div>
                  <div><dt>Limite (teto) {t0}</dt><dd className="enq-destaque">{formatarBRL(e.limite)}</dd></div>
                </dl>
                <div className="formula" aria-label="Memória de cálculo">
                  <div>razão = {formatarBRL(e.moraEm1Jan)} ÷ {formatarBRL(e.rclAnterior)} = {formatarPct(e.razao, 6)}</div>
                  <div>alíquota = {formatarBp(e.aliquotaBaseBp)} {e.adicional.bp ? `+ ${formatarBp(e.adicional.bp)}` : ''} = {formatarBp(e.aliquotaAplicavelBp)}</div>
                  <div>limite = {formatarBRL(e.rclAnterior)} × {formatarBp(e.aliquotaAplicavelBp)} = {formatarBRL(e.limite)}</div>
                  <div className="formula-nota">Comparação exata em centavos; arredondamento só na tela.</div>
                </div>
              </>
            )}
            {e.status === 'manual' && (
              <dl className="enq-numeros">
                <div><dt>Alíquota manual</dt><dd className="num">{formatarBp(e.aliquotaAplicavelBp)}</dd></div>
                <div><dt>Limite simulado {t0}</dt><dd className="enq-destaque">{formatarBRL(e.limite)}</dd></div>
              </dl>
            )}
            <div className="compos">
              <p className="sub">Composição do estoque em 1º/1/{t0}</p>
              <table className="tabela compacta">
                <tbody>
                  <tr><th scope="row">Em mora (vencido)</th><td className="num">{formatarBRL(d.moraEm1Jan.valor)}</td><td><Selo origem={d.moraEm1Jan.origem} compacto /></td></tr>
                  <tr><th scope="row">A vencer em {t0}</th><td className="num">{aVencer === null ? '—' : formatarBRL(aVencer)}</td><td>{aVencer !== null && aVencer < 0 ? <span className="falha">incompatível</span> : null}</td></tr>
                  <tr><th scope="row">A vencer em {t0 + 1}</th><td className="num">{formatarBRL(d.aVencerExercicioSeguinte.valor)}</td><td /></tr>
                  <tr><th scope="row">Total fora das contas</th><td className="num forte">{formatarBRL(total)}</td><td><Selo origem={d.totalPendente1Jan.origem} compacto /></td></tr>
                  <tr><th scope="row">Nas contas especiais (§ 30)</th><td className="num">{formatarBRL(d.saldoContaEspecial1Jan.valor)}</td><td /></tr>
                </tbody>
              </table>
              <p className="nota">A faixa usa só a mora. O total e as contas entram na projeção do passivo, nunca no lugar da mora.</p>
            </div>
          </Secao>

          <Fontes projeto={projeto} atualizar={atualizar} />
        </div>
      </div>
    </div>
  );
}

const CAMPOS: Campo[] = ['rclAnterior', 'moraEm1Jan', 'totalPendente1Jan', 'aVencerExercicioSeguinte', 'saldoContaEspecial1Jan', 'planoAnual'];

function Fontes({ projeto, atualizar }: { projeto: Projeto; atualizar: Props['atualizar'] }) {
  const [campo, setCampo] = useState<Campo>('rclAnterior');
  const [valor, setValor] = useState<Centavos | null>(null);
  const [fonte, setFonte] = useState('');
  const [dataBase, setDataBase] = useState('');
  const [origem, setOrigem] = useState<Origem>('oficial');
  const [erro, setErro] = useState<string | null>(null);
  const conflitos = detectarConflitos(projeto);

  const registrar = () => {
    if (valor === null || !fonte.trim()) { setErro('Informe o valor e a fonte.'); return; }
    const o: ObservacaoFonte = { id: novoId('fonte'), campo, valor, origem, fonte: fonte.trim(), dataBase: dataBase || undefined, dataColeta: hojeISO() };
    atualizar((p) => ({ ...p, observacoes: [...p.observacoes, o] }));
    setValor(null); setFonte(''); setDataBase(''); setErro(null);
  };

  const usar = (o: ObservacaoFonte) => {
    atualizar((p) => {
      const atual = p.dados[o.campo];
      const preservar: ObservacaoFonte[] = atual.valor !== null && !p.observacoes.some((x) => x.campo === o.campo && x.valor === atual.valor && x.fonte === (atual.fonte ?? ''))
        ? [{ id: novoId('fonte'), campo: o.campo, valor: atual.valor, origem: atual.origem, fonte: atual.fonte ?? 'Valor anterior (sem fonte registrada)', dataBase: atual.dataBase, dataColeta: atual.dataColeta }]
        : [];
      return { ...p, observacoes: [...p.observacoes, ...preservar], dados: { ...p.dados, [o.campo]: { ...atual, valor: o.valor, origem: o.origem, fonte: o.fonte, dataBase: o.dataBase, dataColeta: o.dataColeta } } };
    });
  };

  return (
    <Secao titulo="Fontes registradas" subtitulo="Registre cada fonte consultada. Divergências geram alerta; o valor em uso só muda quando você escolhe." id="fontes">
      {conflitos.map((c) => (
        <Aviso key={c.campo} nivel="critico" titulo={`Fontes divergentes: ${ROTULO_CAMPO[c.campo]}`}>
          <ul className="lista-simples">
            {c.valores.map((v, i) => (
              <li key={i}><span className="num">{formatarBRL(v.valor)}</span> · {v.fonte}{v.dataBase ? ` · data-base ${formatarData(v.dataBase)}` : ''}{v.emUso ? ' · em uso' : ''}{v.possivelmenteDefasada ? ' · possivelmente defasada' : ''}</li>
            ))}
          </ul>
        </Aviso>
      ))}
      {projeto.observacoes.length > 0 && (
        <div className="rolagem-x">
          <table className="tabela compacta">
            <thead><tr><th scope="col">Campo</th><th scope="col" className="num">Valor</th><th scope="col">Fonte</th><th scope="col">Data-base</th><th scope="col">Natureza</th><th scope="col"><span className="sr">Ações</span></th></tr></thead>
            <tbody>
              {projeto.observacoes.map((o) => {
                const emUso = projeto.dados[o.campo].valor === o.valor && (projeto.dados[o.campo].fonte ?? '') === o.fonte;
                return (
                  <tr key={o.id}>
                    <td>{ROTULO_CAMPO[o.campo]}</td>
                    <td className="num">{formatarBRL(o.valor)}</td>
                    <td>{o.fonte}</td>
                    <td>{formatarData(o.dataBase)}</td>
                    <td><Selo origem={o.origem} /></td>
                    <td className="acoes">
                      {emUso ? <span className="ok">Em uso</span> : <button type="button" className="botao pequeno" onClick={() => usar(o)}>Usar este valor</button>}
                      <button type="button" className="botao pequeno fantasma" onClick={() => atualizar((p) => ({ ...p, observacoes: p.observacoes.filter((x) => x.id !== o.id) }))}>Remover</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="form-linha">
        <CampoSelecao id="fonte-campo" rotulo="Campo" valor={campo} opcoes={CAMPOS.map((c) => ({ valor: c, rotulo: ROTULO_CAMPO[c] }))} aoMudar={setCampo} />
        <CampoMoeda id="fonte-valor" rotulo="Valor" valor={valor} aoMudar={setValor} />
        <CampoTexto id="fonte-fonte" rotulo="Fonte" valor={fonte} aoMudar={setFonte} placeholder="RGF 2025, 3º quadrimestre" />
        <CampoTexto id="fonte-db" rotulo="Data-base" tipo="date" valor={dataBase} aoMudar={setDataBase} />
        <CampoSelecao id="fonte-origem" rotulo="Natureza" valor={origem} opcoes={(['oficial', 'analista', 'hipotese', 'estimado'] as Origem[]).map((o) => ({ valor: o, rotulo: ROTULO_ORIGEM[o] }))} aoMudar={setOrigem} />
        <div className="campo campo-botao"><button type="button" className="botao" onClick={registrar}>Registrar fonte</button></div>
      </div>
      {erro && <p className="campo-erro">{erro}</p>}
    </Secao>
  );
}
