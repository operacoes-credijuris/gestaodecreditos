/**
 * Onde o projeto fica salvo. A Fase 1 usa o navegador (padrão). Na
 * plataforma, troque por `criarArmazenamentoHTTP('/api/radar/projeto')`
 * para guardar por usuário no banco, sem mudar nada nos motores.
 */
import type { Projeto } from '../dominio/tipos';
import { carregarLocal, salvarLocal } from './armazenamentoLocal';
import { validarProjeto } from './projetoJSON';

export interface Armazenamento {
  /** Texto exibido na tela Projeto: "neste navegador", "na plataforma"… */
  descricao: string;
  /** Devolve o projeto salvo, ou null se ainda não houver. */
  carregar(): Promise<Projeto | null>;
  /** Grava o projeto inteiro. Rejeite a promessa em caso de falha. */
  salvar(projeto: Projeto): Promise<void>;
}

export const armazenamentoNavegador: Armazenamento = {
  descricao: 'neste navegador',
  carregar: async () => carregarLocal(),
  salvar: async (p) => {
    if (!salvarLocal(p)) throw new Error('Armazenamento do navegador indisponível.');
  },
};

/**
 * Armazenamento via API da plataforma.
 * GET  url → 200 com o projeto em JSON (ou 404/204 se não houver)
 * PUT  url ← projeto em JSON; responde 2xx
 * A sessão do usuário segue nos cookies (credentials: 'include').
 */
export function criarArmazenamentoHTTP(url: string, cabecalhos: Record<string, string> = {}): Armazenamento {
  return {
    descricao: 'na plataforma',
    async carregar() {
      const r = await fetch(url, { credentials: 'include', headers: cabecalhos });
      if (r.status === 404 || r.status === 204) return null;
      if (!r.ok) throw new Error(`Falha ao carregar o projeto (HTTP ${r.status}).`);
      const v = validarProjeto(await r.json());
      return v.ok && v.projeto ? v.projeto : null;
    },
    async salvar(projeto) {
      const r = await fetch(url, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...cabecalhos },
        body: JSON.stringify(projeto),
      });
      if (!r.ok) throw new Error(`Falha ao salvar o projeto (HTTP ${r.status}).`);
    },
  };
}
