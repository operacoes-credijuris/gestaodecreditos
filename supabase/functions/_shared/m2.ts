// AS LISTAS SUSPENSAS DA ABA JURÍDICA, e a resposta que cabe em cada célula.
//
// POR QUE ISTO IMPORTA. Texto fora da lista o Excel ACEITA: o arquivo sai
// "preenchido", a validação só reclama quando alguém edita a célula, e a cor
// condicional não pinta. O prompt promete que a resposta inválida é "marcada
// como inválida" — esta função é o que marca.
//
// SEM DEPENDÊNCIA DE INTEGRAÇÃO: ela era pura e ainda assim inalcançável pelos
// testes, porque `normalizar` morava em credijuris.ts, que importa o SDK do
// Supabase. A comparação desceu para nucleo/texto.ts.
import { normalizarParaComparar as normalizar } from './nucleo/texto.ts'

/**
 * As listas suspensas da aba jurídica, linha a linha. Texto fora delas a célula
 * aceita e o Excel só reclama quando alguém edita — o arquivo sai "preenchido" e
 * a cor condicional não pinta. O prompt promete "marcado como inválido"; isto é
 * o que marca.
 */
export const SIM_NAO = ['Sim', 'Não'];
export const LISTAS_M2: Record<string, string[]> = {
  '10': SIM_NAO, '11': SIM_NAO, '14': SIM_NAO, '15': SIM_NAO, '16': SIM_NAO, '18': SIM_NAO,
  '21': SIM_NAO, '22': SIM_NAO, '23': SIM_NAO, '27': SIM_NAO, '28': SIM_NAO, '31': SIM_NAO,
  '32': SIM_NAO, '33': SIM_NAO, '34': SIM_NAO, '35': SIM_NAO, '37': SIM_NAO,
  '19': ['Improcedência', 'Procedência', 'Procedência parcial', 'Homologatória de acordo'],
  // "Iliquída" é a grafia da lista do modelo; a correção ortográfica tem de vir do modelo, não daqui.
  '20': ['Líquida', 'Iliquída'],
  '24': ['Valor apresentado no CS', 'Execução invertida'],
  '26': [
    'Executado não apresentou valores e prazo ainda em curso',
    'Executado não apresentou valores — prazo decorrido — sem manifestação da parte exequente',
    'Executado não apresentou valores — prazo decorrido — já houve manifestação da parte exequente',
    'Executado apresentou valores',
  ],
  '38': ['Minuta de RPV', 'RPV', 'Alvará de pagamento', 'Sem expedição'],
};

/**
 * Traz cada resposta para o valor EXATO da lista da sua linha, quando dá.
 *
 * "sim", "SIM", "Sim, em 12/03/2026" viram "Sim"; "procedencia parcial" vira
 * "Procedência parcial"; "Executado apresentou valores (fls. 300)" casa pela
 * opção mais longa contida. O que não casa fica como veio e é devolvido em
 * `foraDaLista`, para a análise avisar — corrigir sem saber o que a IA quis
 * dizer seria inventar resposta.
 */
export function normalizarM2(m2: unknown): { m2: Record<string, any>; foraDaLista: string[] } {
  const saida: Record<string, any> = {};
  const fora: string[] = [];
  const entrada = (m2 && typeof m2 === 'object') ? (m2 as Record<string, any>) : {};
  for (const [linha, item] of Object.entries(entrada)) {
    const lista = LISTAS_M2[linha];
    const resposta = item?.resposta;
    if (!lista || typeof resposta !== 'string' || !resposta.trim()) { saida[linha] = item; continue; }
    const r = normalizar(resposta);
    let canon: string | null = lista.find((op) => normalizar(op) === r) ?? null;
    if (!canon && lista === SIM_NAO) canon = r.startsWith('sim') ? 'Sim' : r.startsWith('nao') ? 'Não' : null;
    if (!canon) {
      // A opção mais longa que a resposta contém: "Procedência parcial" antes de "Procedência".
      canon = [...lista].sort((a, b) => b.length - a.length).find((op) => r.includes(normalizar(op))) ?? null;
    }
    if (canon) saida[linha] = { ...item, resposta: canon };
    else { saida[linha] = item; fora.push(`linha ${linha}: "${resposta.slice(0, 60)}"`); }
  }
  return { m2: saida, foraDaLista: fora };
}
