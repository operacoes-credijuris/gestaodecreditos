// Busca de endereço por CEP.
//
// POR QUE AQUI É ACEITÁVEL DEPENDER DE SERVIÇO EXTERNO, ao contrário da lista de
// municípios (que virou arquivo estático): existem ~1 milhão de CEPs, então não
// há como embutir. E se o serviço estiver fora, o pior caso é continuar
// preenchendo o endereço à mão — o campo não deixa de funcionar. Já a lista de
// cidades, se dependesse de rede, tornaria o campo inutilizável offline.
//
// Só o CEP sai daqui. Nenhum dado do investidor é enviado.
//
// Duas fontes, na ordem: ViaCEP é a canônica no Brasil; BrasilAPI agrega várias
// bases e cobre casos em que a primeira não responde.

/**
 * O COMPLEMENTO das bases de CEP fica de fora de propósito. O que vem ali não é
 * complemento de endereço, é descritor da faixa do CEP: o 01310-100 devolve
 * "de 612 a 1510 - lado par". Preencher com isso poluiria todo endereço e ainda
 * apareceria no texto que vai para o contrato. Complemento é do investidor
 * ("apto. 1102") e só ele informa.
 */
export interface EnderecoCep {
  logradouro: string
  bairro: string
  cidade: string
  uf: string
}

const soDigitos = (v: string) => v.replace(/\D/g, '')

async function viaCep(cep: string): Promise<EnderecoCep | null> {
  const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`)
  if (!r.ok) return null
  const j = (await r.json()) as Record<string, unknown>
  // ViaCEP responde 200 com { erro: true } para CEP inexistente.
  if (j.erro) return null
  return {
    logradouro: String(j.logradouro ?? ''),
    bairro: String(j.bairro ?? ''),
    cidade: String(j.localidade ?? ''),
    uf: String(j.uf ?? ''),
  }
}

async function brasilApi(cep: string): Promise<EnderecoCep | null> {
  const r = await fetch(`https://brasilapi.com.br/api/cep/v2/${cep}`)
  if (!r.ok) return null
  const j = (await r.json()) as Record<string, unknown>
  return {
    logradouro: String(j.street ?? ''),
    bairro: String(j.neighborhood ?? ''),
    cidade: String(j.city ?? ''),
    uf: String(j.state ?? ''),
  }
}

/**
 * Endereço de um CEP, ou null quando não existe / nenhuma fonte respondeu.
 * Nunca lança: falha de rede é o caso comum aqui, e não deve derrubar o
 * formulário nem virar toast de erro — quem digita segue preenchendo à mão.
 */
export async function buscarCep(cep: string): Promise<EnderecoCep | null> {
  const d = soDigitos(cep)
  if (d.length !== 8) return null
  for (const fonte of [viaCep, brasilApi]) {
    try {
      const r = await fonte(d)
      // Sem logradouro não há o que preencher (CEP de cidade inteira, por
      // exemplo). Segue para a próxima fonte, que pode ter o detalhe.
      if (r && r.logradouro) return r
      if (r && r.cidade) return r
    } catch {
      /* tenta a próxima */
    }
  }
  return null
}
