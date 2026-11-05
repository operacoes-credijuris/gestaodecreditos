import React, { useRef, useState } from 'react';
import type { Projeto, Snapshot } from '../../dominio/tipos';
import type { ResultadoProjecao } from '../../motores/motorProjecao';
import { criarSnapshot, entradasDoProjeto, exportarProjeto, hashTexto, importarProjeto, validarProjeto } from '../../persistencia/projetoJSON';
import { projetoEmBranco, projetoExemplo } from '../../exemplo/municipioExemplo';
import { formatarCompacto, formatarDataHora } from '../../dominio/dinheiro';
import { Aviso, CampoTexto, Secao } from '../componentes/base';
import { agoraISO, hojeISO } from '../util';

export interface Downloads {
  save: (r: { filename: string; data: string }) => Promise<{ status: string }>;
}

interface Props {
  projeto: Projeto;
  resultadoAtivo: ResultadoProjecao;
  substituir: (p: Projeto) => void;
  atualizar: (fn: (p: Projeto) => Projeto) => void;
  downloads: Downloads | null;
  salvo: boolean | null;
  descricaoArmazenamento: string;
}

function slug(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'ente';
}

export function TelaProjeto({ projeto, resultadoAtivo, substituir, atualizar, downloads, salvo, descricaoArmazenamento }: Props) {
  const [msgExport, setMsgExport] = useState<{ nivel: 'info' | 'atencao'; texto: string } | null>(null);
  const [mostrarJSON, setMostrarJSON] = useState(false);
  const [colado, setColado] = useState('');
  const [importacao, setImportacao] = useState<{ ok: boolean; erros: string[]; avisos: string[]; projeto?: Projeto } | null>(null);
  const [confirmar, setConfirmar] = useState<null | { titulo: string; acao: () => void }>(null);
  const [rotulo, setRotulo] = useState('');
  const [comparando, setComparando] = useState<string | null>(null);
  const areaJSON = useRef<HTMLTextAreaElement>(null);
  const textoJSON = mostrarJSON ? exportarProjeto(projeto, agoraISO()) : '';

  const exportar = async () => {
    const texto = exportarProjeto(projeto, agoraISO());
    const nome = `radar-precatorios_${slug(projeto.ente.nome)}_${hojeISO()}.json`;
    if (!downloads) {
      // Navegador comum (plataforma): download direto pelo próprio navegador.
      try {
        const url = URL.createObjectURL(new Blob([texto], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = nome;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        setMsgExport({ nivel: 'info', texto: `Arquivo ${nome} baixado.` });
      } catch {
        setMostrarJSON(true);
        setMsgExport({ nivel: 'atencao', texto: 'Download direto indisponível. Copie o JSON abaixo e salve como arquivo .json.' });
      }
      return;
    }
    try {
      await downloads.save({ filename: nome, data: texto });
      setMsgExport({ nivel: 'info', texto: `Arquivo ${nome} entregue para salvar.` });
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === 'declined') setMsgExport({ nivel: 'atencao', texto: 'Download cancelado.' });
      else {
        setMostrarJSON(true);
        setMsgExport({ nivel: 'atencao', texto: 'Não foi possível salvar o arquivo aqui. Copie o JSON abaixo.' });
      }
    }
  };

  const copiar = async () => {
    const t = exportarProjeto(projeto, agoraISO());
    setMostrarJSON(true);
    try {
      await navigator.clipboard.writeText(t);
      setMsgExport({ nivel: 'info', texto: 'JSON copiado para a área de transferência.' });
    } catch {
      setTimeout(() => { areaJSON.current?.select(); }, 0);
      setMsgExport({ nivel: 'atencao', texto: 'Cópia automática indisponível: o texto foi selecionado; use Ctrl+C / Cmd+C.' });
    }
  };

  const lerArquivo = (f: File | undefined) => {
    if (!f) return;
    const r = new FileReader();
    r.onload = () => setImportacao(importarProjeto(String(r.result ?? '')));
    r.onerror = () => setImportacao({ ok: false, erros: ['Não foi possível ler o arquivo.'], avisos: [] });
    r.readAsText(f);
  };

  const registrar = () => {
    const s = criarSnapshot(projeto, resultadoAtivo, rotulo.trim() || `Versão de ${formatarDataHora(agoraISO())}`, agoraISO(), projeto.config.cenarioAtivo);
    atualizar((p) => ({ ...p, snapshots: [...p.snapshots, { ...s, resumo: { ...s.resumo } }] }));
    setRotulo('');
  };

  const hashAtual = hashTexto(entradasDoProjeto(projeto));
  const ultimo = resultadoAtivo.linhas[resultadoAtivo.linhas.length - 1];
  const resumoAtual = { limite: resultadoAtivo.linhas[0]?.limite ?? null, passivoFinal: ultimo?.passivoFinal ?? null, zeragem: resultadoAtivo.anoZeragemMora };

  return (
    <div className="tela">
      {confirmar && (
        <Aviso nivel="atencao" titulo={confirmar.titulo}>
          <p>O projeto atual será substituído. Exporte-o antes, se quiser guardá-lo.</p>
          <div className="linha-botoes">
            <button type="button" className="botao" onClick={() => { confirmar.acao(); setConfirmar(null); }}>Confirmar</button>
            <button type="button" className="botao fantasma" onClick={() => setConfirmar(null)}>Cancelar</button>
          </div>
        </Aviso>
      )}

      <Secao titulo="Projeto" subtitulo={`O projeto fica salvo ${descricaoArmazenamento} e pode ser exportado em JSON. Não registre CPF, dados médicos ou bancários.`} id="projeto">
        <div className="grade-campos">
          <CampoTexto id="proj-nome" rotulo="Nome do projeto" valor={projeto.nome} aoMudar={(v) => atualizar((p) => ({ ...p, nome: v }))} />
          <div className="campo">
            <span className="rotulo-campo">Salvamento {descricaoArmazenamento}</span>
            <p className={salvo === false ? 'campo-erro' : 'campo-ajuda'}>{salvo === null ? 'Aguardando a primeira alteração.' : salvo ? `Salvo em ${formatarDataHora(projeto.atualizadoEm)}.` : 'Falhou. Exporte o JSON para não perder o trabalho.'}</p>
          </div>
          <div className="campo"><span className="rotulo-campo">Identificador das entradas</span><p className="mono">{hashAtual}</p></div>
        </div>
        <div className="linha-botoes">
          <button type="button" className="botao" onClick={() => setConfirmar({ titulo: 'Carregar o exemplo do enunciado?', acao: () => substituir(projetoExemplo(agoraISO())) })}>Carregar exemplo</button>
          <button type="button" className="botao fantasma" onClick={() => setConfirmar({ titulo: 'Começar um projeto em branco?', acao: () => substituir(projetoEmBranco(new Date().getFullYear() + 1, agoraISO())) })}>Novo projeto em branco</button>
        </div>
      </Secao>

      <div className="duas-colunas">
        <Secao titulo="Exportar" subtitulo="Arquivo JSON com entradas, cenários, regras usadas e versões registradas." id="exportar">
          <div className="linha-botoes">
            <button type="button" className="botao" onClick={exportar}>Baixar JSON</button>
            <button type="button" className="botao fantasma" onClick={copiar}>Copiar JSON</button>
            <button type="button" className="botao fantasma" onClick={() => setMostrarJSON((v) => !v)}>{mostrarJSON ? 'Ocultar JSON' : 'Ver JSON'}</button>
          </div>
          {msgExport && <Aviso nivel={msgExport.nivel} titulo={msgExport.texto} />}
          {mostrarJSON && <textarea ref={areaJSON} className="json" readOnly value={textoJSON} rows={12} aria-label="Projeto em JSON" id="json-exportado" />}
        </Secao>

        <Secao titulo="Importar" subtitulo="O arquivo é validado antes de substituir o projeto atual." id="importar">
          <div className="campo">
            <label htmlFor="arquivo-json">Arquivo .json</label>
            <input id="arquivo-json" type="file" accept=".json,application/json" onChange={(e) => lerArquivo(e.target.files?.[0])} />
          </div>
          <div className="campo">
            <label htmlFor="colar-json">Ou cole o conteúdo</label>
            <textarea id="colar-json" rows={4} value={colado} onChange={(e) => setColado(e.target.value)} placeholder='{"formato":"radar-precatorios", …}' />
            <div className="linha-botoes"><button type="button" className="botao fantasma" onClick={() => setImportacao(importarProjeto(colado))} disabled={!colado.trim()}>Validar</button></div>
          </div>
          {importacao && !importacao.ok && (
            <Aviso nivel="critico" titulo="Arquivo rejeitado">
              <ul className="lista-simples">{importacao.erros.slice(0, 12).map((e) => <li key={e}>{e}</li>)}</ul>
            </Aviso>
          )}
          {importacao?.ok && importacao.projeto && (
            <Aviso nivel="info" titulo={`Projeto válido: ${importacao.projeto.ente.nome}, ano-base ${importacao.projeto.anoBase}`}>
              {importacao.avisos.length > 0 && <ul className="lista-simples">{importacao.avisos.map((a) => <li key={a}>{a}</li>)}</ul>}
              <div className="linha-botoes">
                <button type="button" className="botao" onClick={() => { substituir(importacao.projeto as Projeto); setImportacao(null); setColado(''); }}>Substituir projeto atual</button>
                <button type="button" className="botao fantasma" onClick={() => setImportacao(null)}>Cancelar</button>
              </div>
            </Aviso>
          )}
        </Secao>
      </div>

      <Secao titulo="Versões registradas (auditoria)" subtitulo="Cada versão congela as entradas, o cenário, a versão das regras e o resultado. Alterações posteriores não mudam o que foi registrado." id="versoes">
        <div className="form-linha">
          <CampoTexto id="snap-rotulo" rotulo="Rótulo da versão" valor={rotulo} aoMudar={setRotulo} placeholder="Ex.: proposta de compra, 14/10/2026" />
          <div className="campo campo-botao"><button type="button" className="botao" onClick={registrar} disabled={resultadoAtivo.status === 'bloqueada'}>Registrar versão</button></div>
        </div>
        {projeto.snapshots.length === 0 ? <p className="vazio">Nenhuma versão registrada.</p> : (
          <div className="rolagem-x tabela-moldura">
            <table className="tabela">
              <thead><tr><th scope="col">Registrada em</th><th scope="col">Rótulo</th><th scope="col">Cenário</th><th scope="col">Regras</th><th scope="col">Entradas</th><th scope="col" className="num">Limite 1º ano</th><th scope="col" className="num">Passivo final</th><th scope="col">Mora zerada</th><th scope="col"><span className="sr">Ações</span></th></tr></thead>
              <tbody>
                {[...projeto.snapshots].reverse().map((s: Snapshot) => (
                  <React.Fragment key={s.id}>
                    <tr>
                      <td>{formatarDataHora(s.criadoEm)}</td>
                      <td>{s.rotulo}</td>
                      <td>{s.cenario}</td>
                      <td>v{s.versaoRegras}</td>
                      <td className="mono">{s.hashEntradas}{s.hashEntradas === hashAtual ? ' (iguais às atuais)' : ''}</td>
                      <td className="num">{formatarCompacto(s.resumo.limiteAnoBase)}</td>
                      <td className="num">{formatarCompacto(s.resumo.passivoFinal)}</td>
                      <td>{s.resumo.anoZeragemMora ? `1º/1/${s.resumo.anoZeragemMora}` : 'não'}</td>
                      <td className="acoes">
                        <button type="button" className="botao pequeno fantasma" onClick={() => setComparando(comparando === s.id ? null : s.id)}>{comparando === s.id ? 'Fechar' : 'Comparar'}</button>
                        <button type="button" className="botao pequeno fantasma" onClick={() => setConfirmar({ titulo: `Restaurar a versão “${s.rotulo}”?`, acao: () => {
                          const v = validarProjeto(JSON.parse(s.projetoCongelado));
                          if (v.ok && v.projeto) substituir({ ...v.projeto, snapshots: projeto.snapshots, atualizadoEm: agoraISO() });
                        } })}>Restaurar</button>
                      </td>
                    </tr>
                    {comparando === s.id && (
                      <tr className="comparacao"><td colSpan={9}>
                        Atual × registrada: limite {formatarCompacto(resumoAtual.limite)} × {formatarCompacto(s.resumo.limiteAnoBase)}; passivo final {formatarCompacto(resumoAtual.passivoFinal)} × {formatarCompacto(s.resumo.passivoFinal)}; mora zerada {resumoAtual.zeragem ?? 'não'} × {s.resumo.anoZeragemMora ?? 'não'}; entradas {s.hashEntradas === hashAtual ? 'idênticas' : 'alteradas'}.
                      </td></tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Secao>
    </div>
  );
}
