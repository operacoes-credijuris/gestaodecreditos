// As UFs anteriores, como a pessoa digita no cadastro de certidões.
//
// O CAMPO É TEXTO LIVRE ("MG, SP"), e quem digita escreve também por extenso —
// "Minas Gerais, São Paulo". A leitura antiga guardava só o que tivesse a forma
// de sigla e jogava o resto fora EM SILÊNCIO: o estado escrito por extenso não
// entrava no cadastro, a certidão estadual dele não entrava no checklist, e o
// placar fechava completo sem ela. Agora o nome por extenso vira a sigla, e o
// que não for estado nenhum volta para a tela como problema, em vez de sumir.

import { UFS_DO_BRASIL } from '../../supabase/functions/_shared/qualificacaoDoCedente.ts'

const POR_NOME: Record<string, string> = {
  acre: 'AC', alagoas: 'AL', amapa: 'AP', amazonas: 'AM', bahia: 'BA', ceara: 'CE',
  'distrito federal': 'DF', 'espirito santo': 'ES', goias: 'GO', maranhao: 'MA',
  'mato grosso': 'MT', 'mato grosso do sul': 'MS', 'minas gerais': 'MG', para: 'PA',
  paraiba: 'PB', parana: 'PR', pernambuco: 'PE', piaui: 'PI', 'rio de janeiro': 'RJ',
  'rio grande do norte': 'RN', 'rio grande do sul': 'RS', rondonia: 'RO', roraima: 'RR',
  'santa catarina': 'SC', 'sao paulo': 'SP', sergipe: 'SE', tocantins: 'TO',
}

const plano = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

/** As siglas do texto (sem repetir), e o que não se reconheceu como estado. */
export function lerUfsDigitadas(texto: string): { ufs: string[]; naoReconhecidas: string[] } {
  const ufs: string[] = []
  const naoReconhecidas: string[] = []
  for (const parte of String(texto ?? '').split(/[,;/\n]/)) {
    const t = parte.trim()
    if (!t) continue
    const sigla = t.toUpperCase()
    const uf = (UFS_DO_BRASIL as readonly string[]).includes(sigla) ? sigla : POR_NOME[plano(t)]
    if (uf) {
      if (!ufs.includes(uf)) ufs.push(uf)
    } else {
      naoReconhecidas.push(t)
    }
  }
  return { ufs, naoReconhecidas }
}
