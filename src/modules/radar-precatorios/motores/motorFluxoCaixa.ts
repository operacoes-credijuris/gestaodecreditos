/**
 * motorFluxoCaixa — livros A (estoque, visão do § 30) e B (contas especiais),
 * com o registro do que foi pago aos credores (base do livro C).
 *
 * Regra central (T12): o depósito tira o valor do Livro A e o coloca no
 * Livro B; o pagamento tira do Livro B. O pagamento NUNCA abate de novo o
 * Livro A. Logo, saldo pendente para credores = A + B, e cada real só
 * reduz a obrigação uma vez.
 */
import type { Centavos, LivroInicial, Movimento, TipoMovimento } from '../dominio/tipos';

export interface EstadoLivros {
  /** Livro A: obrigações ainda não aportadas às contas especiais (§ 30). */
  estoqueForaDasContas: Centavos;
  /** Livro B: aportado e ainda não pago, por conta. */
  contaCronologica: Centavos;
  contaAcordos: Centavos;
  /** Dinheiro efetivamente pago aos credores. */
  pagoAosCredores: Centavos;
  /** Renúncias (deságio) em acordos diretos: extinguem dívida, não são dispêndio. */
  renunciaAcordos: Centavos;
  /** Extinções sem passagem pelas contas (§ 26, cancelamentos). */
  extincoesSemCaixa: Centavos;
}

export interface Indicadores {
  estoqueForaDasContas: Centavos;
  saldoNasContas: Centavos;
  pagoAosCredores: Centavos;
  obrigacaoNaoRecebida: Centavos;
}

export interface LinhaLivro {
  movimento: Movimento;
  aplicado: boolean;
  estado: EstadoLivros;
  mensagem?: string;
}

export interface ResultadoLivros {
  estado: EstadoLivros;
  indicadores: Indicadores;
  linhas: LinhaLivro[];
  erros: string[];
  avisos: string[];
}

export const ROTULO_MOVIMENTO: Record<TipoMovimento, string> = {
  deposito_conta_especial: 'Depósito na conta especial',
  pagamento_da_conta: 'Pagamento ao credor (da conta)',
  nova_inscricao: 'Nova inscrição de precatório',
  atualizacao: 'Atualização do estoque',
  acordo_direto: 'Acordo direto pago (§ 29)',
  extincao_sem_caixa: 'Extinção sem caixa (§ 26 / cancelamento)',
  estorno: 'Estorno de depósito',
};

export function estadoInicial(l: LivroInicial): EstadoLivros {
  return {
    estoqueForaDasContas: l.estoqueForaDasContas,
    contaCronologica: l.saldoContaCronologica,
    contaAcordos: l.saldoContaAcordos,
    pagoAosCredores: 0,
    renunciaAcordos: 0,
    extincoesSemCaixa: 0,
  };
}

export function indicadores(e: EstadoLivros): Indicadores {
  const saldo = e.contaCronologica + e.contaAcordos;
  return {
    estoqueForaDasContas: e.estoqueForaDasContas,
    saldoNasContas: saldo,
    pagoAosCredores: e.pagoAosCredores,
    obrigacaoNaoRecebida: e.estoqueForaDasContas + saldo,
  };
}

function chaveConta(m: Movimento): 'contaCronologica' | 'contaAcordos' {
  return m.conta === 'acordos' ? 'contaAcordos' : 'contaCronologica';
}

/** Aplica um movimento; devolve o novo estado ou uma mensagem de erro (estado inalterado). */
export function aplicarMovimento(e: EstadoLivros, m: Movimento): { estado: EstadoLivros; erro?: string } {
  const s = { ...e };
  if (!Number.isInteger(m.valor)) return { estado: e, erro: 'Valor deve estar em centavos inteiros.' };
  if (m.valor < 0) return { estado: e, erro: 'Valor negativo só é aceito como "Estorno de depósito", lançado com valor positivo.' };
  switch (m.tipo) {
    case 'deposito_conta_especial': {
      if (m.valor > s.estoqueForaDasContas) return { estado: e, erro: 'Depósito maior que o estoque fora das contas: confira se o estoque inicial está completo.' };
      s.estoqueForaDasContas -= m.valor;
      s[chaveConta(m)] += m.valor;
      return { estado: s };
    }
    case 'pagamento_da_conta': {
      const k = chaveConta(m);
      if (m.valor > s[k]) return { estado: e, erro: 'Pagamento maior que o saldo da conta: o depósito de origem foi lançado? Pagamento não abate o estoque diretamente.' };
      s[k] -= m.valor;
      s.pagoAosCredores += m.valor;
      return { estado: s };
    }
    case 'nova_inscricao':
    case 'atualizacao':
      s.estoqueForaDasContas += m.valor;
      return { estado: s };
    case 'acordo_direto': {
      const face = m.valorFace ?? m.valor;
      if (face < m.valor) return { estado: e, erro: 'No acordo, o valor de face extinto não pode ser menor que o valor pago.' };
      if (m.valor > s.contaAcordos) return { estado: e, erro: 'Acordo pago acima do saldo da conta de acordos: falta o depósito correspondente.' };
      const renuncia = face - m.valor;
      if (renuncia > s.estoqueForaDasContas) return { estado: e, erro: 'Renúncia do acordo maior que o estoque fora das contas.' };
      s.contaAcordos -= m.valor;
      s.pagoAosCredores += m.valor;
      s.estoqueForaDasContas -= renuncia;
      s.renunciaAcordos += renuncia;
      return { estado: s };
    }
    case 'extincao_sem_caixa': {
      if (m.valor > s.estoqueForaDasContas) return { estado: e, erro: 'Extinção maior que o estoque fora das contas.' };
      s.estoqueForaDasContas -= m.valor;
      s.extincoesSemCaixa += m.valor;
      return { estado: s };
    }
    case 'estorno': {
      const k = chaveConta(m);
      if (m.valor > s[k]) return { estado: e, erro: 'Estorno maior que o saldo da conta.' };
      s[k] -= m.valor;
      s.estoqueForaDasContas += m.valor;
      return { estado: s };
    }
    default:
      return { estado: e, erro: 'Tipo de movimento desconhecido.' };
  }
}

/** Aplica a lista em ordem cronológica, rejeitando identificadores repetidos com aviso. */
export function aplicarMovimentos(inicial: LivroInicial, movimentos: Movimento[]): ResultadoLivros {
  let estado = estadoInicial(inicial);
  const linhas: LinhaLivro[] = [];
  const erros: string[] = [];
  const avisos: string[] = [];
  const ids = new Set<string>();
  const assinaturas = new Map<string, string>();
  const ordenados = [...movimentos].sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));

  for (const m of ordenados) {
    if (ids.has(m.id)) {
      const msg = `Movimento "${m.id}" lançado mais de uma vez: a repetição foi ignorada.`;
      avisos.push(msg);
      linhas.push({ movimento: m, aplicado: false, estado, mensagem: msg });
      continue;
    }
    ids.add(m.id);
    const assinatura = `${m.data}|${m.tipo}|${m.valor}|${m.conta ?? ''}|${m.referencia ?? ''}`;
    if (assinaturas.has(assinatura)) {
      avisos.push(`Possível duplicidade: "${m.id}" tem data, tipo, valor e referência iguais a "${assinaturas.get(assinatura)}". Confira antes de manter.`);
    } else {
      assinaturas.set(assinatura, m.id);
    }
    const r = aplicarMovimento(estado, m);
    if (r.erro) {
      erros.push(`${m.id}: ${r.erro}`);
      linhas.push({ movimento: m, aplicado: false, estado, mensagem: r.erro });
    } else {
      estado = r.estado;
      linhas.push({ movimento: m, aplicado: true, estado });
    }
  }
  return { estado, indicadores: indicadores(estado), linhas, erros, avisos };
}

/** Verifica a conservação do livro: A+B inicial + entradas − pagamentos − renúncias − extinções = A+B final. */
export function conservacaoLivros(inicial: LivroInicial, r: ResultadoLivros): { ok: boolean; diferenca: Centavos } {
  const ini = inicial.estoqueForaDasContas + inicial.saldoContaCronologica + inicial.saldoContaAcordos;
  const entradas = r.linhas.filter((l) => l.aplicado && (l.movimento.tipo === 'nova_inscricao' || l.movimento.tipo === 'atualizacao')).reduce((s, l) => s + l.movimento.valor, 0);
  const esperado = ini + entradas - r.estado.pagoAosCredores - r.estado.renunciaAcordos - r.estado.extincoesSemCaixa;
  const dif = r.indicadores.obrigacaoNaoRecebida - esperado;
  return { ok: dif === 0, diferenca: dif };
}
