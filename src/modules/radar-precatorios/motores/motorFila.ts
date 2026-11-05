/**
 * motorFila — Fase 1.
 *
 * A Fase 1 não tem fila individual. Por regra do produto (seção 6.5 e
 * requisito 10), nenhum ano de recebimento individual é exibido sem a
 * posição na fila e o valor à frente do alvo. O resultado é sempre
 * "indeterminado", acompanhado do que falta (T15).
 */
import type { Centavos } from '../dominio/tipos';

export interface DadosAlvo {
  dataApresentacao?: string | null;
  exercicioPagamento?: number | null;
  classe?: 'comum' | 'alimentar' | 'superpreferencia' | null;
  valorAFrente?: Centavos | null;
  fluxoAnualDaClasse?: Centavos | null;
  listaDoTribunal?: string | null;
}

export interface PrevisaoIndividual {
  status: 'indeterminado';
  texto: string;
  faltantes: string[];
  observacao: string;
}

export const TEXTO_INDETERMINADO = 'Ano de recebimento individual: indeterminado com os dados atuais';

export function preverRecebimentoIndividual(alvo: DadosAlvo = {}): PrevisaoIndividual {
  const faltantes: string[] = [];
  if (!alvo.dataApresentacao) faltantes.push('Data de apresentação do requisitório (não a da sentença ou do trânsito)');
  if (!alvo.exercicioPagamento) faltantes.push('Exercício orçamentário do precatório');
  if (!alvo.classe) faltantes.push('Classe de precedência (comum, alimentar, superpreferência deferida)');
  if (alvo.valorAFrente === null || alvo.valorAFrente === undefined) faltantes.push('Valor atualizado dos créditos à frente na mesma fila');
  if (alvo.fluxoAnualDaClasse === null || alvo.fluxoAnualDaClasse === undefined) faltantes.push('Parcela dos recursos que chega à fila do alvo');
  if (!alvo.listaDoTribunal) faltantes.push('Lista oficial do tribunal competente, com data de consulta');
  faltantes.push('Padrão de liberação e pendências (cessão, honorários, penhora, habilitação)');
  return {
    status: 'indeterminado',
    texto: TEXTO_INDETERMINADO,
    faltantes,
    observacao: 'A projeção por posição na fila (alcance, primeiro pagamento e quitação integral, por cenário) é escopo da Fase 2.',
  };
}
