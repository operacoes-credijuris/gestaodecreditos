// O PRAZO ATÉ O DINHEIRO — e, por ele, o deságio.
//
// SEM DEPENDÊNCIA DE NADA, como precificacao.ts e irpf.ts. Isto morava dentro
// da Edge Function, junto do SDK da IA, e nenhum teste alcançava a função que
// decide T5 — a variável que mais mexe no preço. Um roteiro de 41 atos, um ato
// de 1.101 dias, uma data inválida: cada um deles muda o deságio, e nenhum
// tinha caso escrito.
//
// A REGRA VEM DA ESFERA DO ENTE DEVEDOR, não do tribunal: um TRT pode executar
// a União (federal) ou um município (estadual). O que é igual em toda esfera
// são os CICLOS DO PRÓPRIO PROCESSO — tempo médio de serventia e de gabinete,
// medidos dos pares de datas dos autos. Esses não são de tribunal nenhum; são
// do processo em análise.

export type Esfera = 'federal' | 'estadual' | 'goias';

export interface RegraPrazo {
  /** Dias que o ente tem para pagar depois da requisição. */
  pagamentoDias: number;
  /** Dias de alvará: número fixo, 0 (sem alvará), ou 'se_exigir' (só quando os autos dizem que o tribunal exige). */
  alvaraDias: number | 'se_exigir';
  /** O tribunal tem convênio com data-limite para expedir (TJGO)? */
  convenio: boolean;
  /** Piso em meses — proteção contra extração otimista dos ciclos. */
  descricao: string;
}

// PISO ÚNICO DE 8 MESES, decisão do dono, e vale para TODA esfera: o que o
// cálculo achar abaixo disso vira 8. Substituiu os pisos por esfera (6 no TJGO,
// vindo do template; 3 nas demais, chute meu) — a experiência da equipe é que
// requisitório não paga antes disso, e prometer menos contamina o deságio, que
// é calibrado sobre o prazo.
//
// O piso NÃO se aplica a prazo digitado à mão no chat de revisão: ali é uma
// pessoa dizendo o que sabe daquele caso, e o motor avisa em vez de sobrepor.
export const PISO_MESES = 8;
export const REGRAS_PRAZO: Record<Esfera, RegraPrazo> = {
  federal: {
    pagamentoDias: 60, alvaraDias: 0, convenio: false,
    descricao: 'RPV federal: pagamento em 60 dias da requisição (Lei 10.259/2001, art. 17), depósito direto ao credor, sem alvará',
  },
  estadual: {
    pagamentoDias: 60, alvaraDias: 'se_exigir', convenio: false,
    descricao: 'RPV estadual/municipal: pagamento em 2 meses da requisição (CPC, art. 535, §3º); alvará só onde os autos mostram que o tribunal exige',
  },
  goias: {
    pagamentoDias: 60, alvaraDias: 21, convenio: true,
    descricao: 'TJGO: convênio com data-limite de expedição (60 dias) quando consta dos autos, período de graça e alvará de 21 dias — o fluxo do template original',
  },
};

/** Um ato do roteiro, já validado. */
export interface AtoRoteiro { ato: string; dias: number; base: string }

/**
 * O roteiro que a IA montou, se ele serve para somar.
 *
 * Teto de 1.100 dias no ato e 40 itens: número solto de uma leitura ruim não
 * pode virar prazo de três anos num campo que manda no preço. Ato sem nome ou
 * com dias inválido é descartado; o roteiro inteiro só vale se sobrar pelo menos
 * um ato e a soma for plausível (até 60 meses).
 */
export function roteiroValido(bruto: unknown): AtoRoteiro[] | null {
  if (!Array.isArray(bruto) || bruto.length === 0 || bruto.length > 40) return null;
  const atos: AtoRoteiro[] = [];
  for (const x of bruto as Array<Record<string, unknown>>) {
    const ato = String(x?.ato ?? '').trim();
    const dias = Number(x?.dias);
    if (!ato || !isFinite(dias) || dias < 0 || dias > 1100) continue;
    atos.push({ ato, dias, base: String(x?.base ?? '').trim() });
  }
  if (atos.length === 0) return null;
  const total = atos.reduce((t, a) => t + a.dias, 0);
  if (!(total > 0) || total / 30 > 60) return null;
  return atos;
}

export function prazoMeses(o: {
  esfera: Esfera; serventiaDias: number; gabineteDias: number; scenario: 'A' | 'B';
  dataAquisicao: Date; dataFatalConvenio?: Date; dataExpedicao?: Date; exigeAlvara: boolean;
  /** O caminho que a IA montou até a liquidação. Quando serve, é ele que vale. */
  roteiro?: unknown;
}): { meses: number; regra: RegraPrazo; detalhe: string; roteiro: AtoRoteiro[] | null } {
  const regra = REGRAS_PRAZO[o.esfera];

  // O ROTEIRO VEM PRIMEIRO, e a fórmula fica de rede.
  //
  // A fórmula é (serventia+gabinete)*2 + serventia*1,5: dois ciclos e meio,
  // sempre, para qualquer processo. Ela não sabe em que etapa o processo está,
  // quantos atos faltam, nem que a CESSÃO tem atos próprios — habilitação,
  // intimação da Fazenda, homologação, substituição — que só acontecem depois
  // da compra e que ela nunca contou. O roteiro conta o caminho que falta, ato a
  // ato, com a velocidade medida neste juízo.
  const atos = roteiroValido(o.roteiro);
  if (atos) {
    const dias = atos.reduce((t, a) => t + a.dias, 0);
    const meses = Math.max(PISO_MESES, dias / 30);
    let detalhe = `${atos.length} ato(s) até a liquidação, somando ${Math.round(dias)}d`;
    if (meses > dias / 30) detalhe += ` — piso de ${PISO_MESES} meses aplicado (o roteiro deu ${(dias / 30).toFixed(1)})`;
    return { meses, regra, detalhe, roteiro: atos };
  }
  const sg = o.serventiaDias + o.gabineteDias;
  const ciclos = sg * 2 + o.serventiaDias * 1.5;
  const alvara = regra.alvaraDias === 'se_exigir' ? (o.exigeAlvara ? 21 : 0) : regra.alvaraDias;
  // DATA INVÁLIDA É DATA AUSENTE.
  //
  // `new Date('31/02/2025')` é um Date, passa no `if (d)` e devolve NaN em
  // getTime(). O NaN atravessava a soma, chegava a `Math.max(8, NaN)` — que é
  // NaN — e a calibragem, sem prazo, devolvia 95% de deságio. O defeito estava
  // fechado no CHAMADOR (que valida as datas antes), e não aqui: quem chamasse
  // de outro lugar pegava a armadilha inteira.
  const valida = (d?: Date) => (d && Number.isFinite(d.getTime()) ? d : undefined);
  const aquisicao = valida(o.dataAquisicao)?.getTime() ?? Date.now();
  const diasDesde = (d?: Date) => {
    const v = valida(d);
    return v ? Math.max(0, Math.round((aquisicao - v.getTime()) / 86400000)) : null;
  };
  const diasAte = (d?: Date) => {
    const v = valida(d);
    return v ? Math.round((v.getTime() - aquisicao) / 86400000) : null;
  };

  let dias: number;
  let detalhe: string;
  if (o.esfera === 'goias') {
    // Fiel ao template do TJGO.
    if (o.scenario === 'A') {
      const e23 = diasAte(o.dataFatalConvenio) ?? 60;
      dias = ciclos + e23 + regra.pagamentoDias;
      detalhe = `ciclos do processo ${Math.round(ciclos)}d + até a expedição ${e23}d${o.dataFatalConvenio ? ' (convênio)' : ' (estimado)'} + pagamento ${regra.pagamentoDias}d`;
    } else {
      dias = ciclos + alvara + regra.pagamentoDias;
      detalhe = `ciclos do processo ${Math.round(ciclos)}d + alvará ${alvara}d + pagamento ${regra.pagamentoDias}d`;
    }
  } else if (o.scenario === 'A') {
    dias = ciclos + regra.pagamentoDias + alvara;
    detalhe = `ciclos do processo ${Math.round(ciclos)}d + pagamento ${regra.pagamentoDias}d${alvara ? ` + alvará ${alvara}d` : ''}`;
  } else {
    const decorridos = diasDesde(o.dataExpedicao) ?? 0;
    const restante = Math.max(0, regra.pagamentoDias - decorridos);
    dias = restante + alvara + sg;
    detalhe = `pagamento restante ${restante}d${o.dataExpedicao ? ` (${decorridos}d já decorridos)` : ''}${alvara ? ` + alvará ${alvara}d` : ''} + um ciclo de liberação ${Math.round(sg)}d`;
  }
  // O PRAZO SAI FINITO, SEMPRE. Última rede: número não finito aqui vira
  // deságio de 95% na calibragem, que é um preço absurdo com cara de preço.
  if (!Number.isFinite(dias)) {
    return {
      meses: PISO_MESES,
      regra,
      detalhe: `não foi possível somar o prazo com os dados desta análise — piso de ${PISO_MESES} meses aplicado`,
      roteiro: null,
    };
  }
  const meses = Math.max(PISO_MESES, dias / 30);
  if (meses > dias / 30) detalhe += ` — piso de ${PISO_MESES} meses aplicado (o cálculo deu ${(dias / 30).toFixed(1)})`;
  return { meses, regra, detalhe, roteiro: null };
}

