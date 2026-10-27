import React from 'react';
import type { Esfera, Projeto, Regime } from '../../dominio/tipos';
import { CampoInteiro, CampoSelecao, CampoTexto, Secao } from '../componentes/base';

export function TelaEnte({ projeto, atualizar }: { projeto: Projeto; atualizar: (fn: (p: Projeto) => Projeto) => void }) {
  const e = projeto.ente;
  const set = <K extends keyof Projeto['ente']>(k: K, v: Projeto['ente'][K]) => atualizar((p) => ({ ...p, ente: { ...p.ente, [k]: v } }));
  return (
    <div className="tela">
      <Secao titulo="Ente devedor" subtitulo="Identificação inequívoca do devedor e do regime de pagamento. Não registre dados pessoais de credores." id="ente">
        <div className="grade-campos">
          <CampoTexto id="ente-nome" rotulo="Nome do ente" valor={e.nome} aoMudar={(v) => set('nome', v)} />
          <CampoSelecao<Esfera> id="ente-esfera" rotulo="Esfera" valor={e.esfera} aoMudar={(v) => set('esfera', v)} opcoes={[{ valor: 'municipio', rotulo: 'Município' }, { valor: 'estado', rotulo: 'Estado' }, { valor: 'df', rotulo: 'Distrito Federal' }]} />
          <CampoTexto id="ente-uf" rotulo="UF" valor={e.uf} aoMudar={(v) => set('uf', v.toUpperCase().slice(0, 2))} />
          <CampoTexto id="ente-ibge" rotulo="Código IBGE" valor={e.codIbge} aoMudar={(v) => set('codIbge', v.replace(/\D/g, '').slice(0, 7))} />
          <CampoSelecao<Regime> id="ente-regime" rotulo="Regime de pagamento" valor={e.regime} aoMudar={(v) => set('regime', v)} opcoes={[{ valor: 'nao_informado', rotulo: 'Não informado' }, { valor: 'geral', rotulo: 'Geral' }, { valor: 'especial', rotulo: 'Especial (ADCT, art. 101)' }]} ajuda="Os §§ 23 a 30 se aplicam também ao regime especial (ADCT, art. 101, § 6º)." />
          <CampoTexto id="ente-fonte-regime" rotulo="Fonte do regime" valor={e.fonteRegime} aoMudar={(v) => set('fonteRegime', v)} placeholder="Ato do tribunal / painel do CNJ" />
          <CampoTexto id="ente-tribunal" rotulo="Tribunal competente" valor={e.tribunal} aoMudar={(v) => set('tribunal', v)} />
          <CampoInteiro id="ente-ano" rotulo="Ano-base da simulação" valor={projeto.anoBase} min={2026} max={2100} aoMudar={(v) => atualizar((p) => ({ ...p, anoBase: v }))} ajuda={`A RCL deve ser a de ${projeto.anoBase - 1}; a mora, a de 1º/1/${projeto.anoBase}.`} />
        </div>
        <div className="campo largo">
          <label htmlFor="ente-abrangencia">Abrangência do passivo</label>
          <textarea id="ente-abrangencia" rows={3} value={e.abrangencia} onChange={(ev) => set('abrangencia', ev.target.value)} placeholder="Ex.: lista do TJ e do TRT; administração direta e autarquias; exclui fundações." />
          <p className="campo-ajuda">A lista visível de um único tribunal nem sempre equivale à dívida total do ente.</p>
        </div>
        <div className="campo largo">
          <label htmlFor="ente-obs">Observações</label>
          <textarea id="ente-obs" rows={3} value={e.observacoes} onChange={(ev) => set('observacoes', ev.target.value)} />
        </div>
      </Secao>
    </div>
  );
}
