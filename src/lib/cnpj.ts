// Busca do endereço de uma empresa pelo CNPJ.
//
// Mesma justificativa do CEP (ver lib/cep.ts): não há como embutir a base, e se o
// serviço estiver fora o pior caso é preencher à mão — o campo não deixa de
// funcionar.
//
// SÓ O CNPJ SAI DAQUI. Nenhum dado do investidor é enviado, e o que volta é
// informação pública do cadastro da Receita.
//
// NÃO EXISTE EQUIVALENTE PARA CPF, e não é limitação de implementação: nome ligado a
// CPF é dado pessoal protegido, e as bases oficiais (API Consulta CPF do Serpro) são
// pagas e contratadas. O que dá para fazer sem serviço nenhum é validar o dígito
// verificador, e isso a plataforma já faz em cpfCnpjValido.

export interface EmpresaCnpj {
  razao_social: string
  logradouro: string
  numero: string
  complemento: string
  bairro: string
  cidade: string
  uf: string
  cep: string
}

const soDigitos = (v: string) => v.replace(/\D/g, '')

/**
 * Dados públicos de um CNPJ, ou null quando não existe / o serviço não respondeu.
 *
 * Nunca lança: falha de rede é o caso comum, e não deve derrubar o formulário nem
 * virar erro na tela — quem digita segue preenchendo à mão.
 */
export async function buscarCnpj(cnpj: string): Promise<EmpresaCnpj | null> {
  const d = soDigitos(cnpj)
  if (d.length !== 14) return null
  try {
    const r = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${d}`)
    // 404 é CNPJ inexistente; 429 é limite de uso da API pública. Nos dois casos o
    // resultado para quem está digitando é o mesmo: preencher à mão.
    if (!r.ok) return null
    const j = (await r.json()) as Record<string, unknown>
    const txt = (v: unknown) => String(v ?? '').trim()
    return {
      razao_social: txt(j.razao_social),
      logradouro: txt(j.logradouro),
      numero: soDigitos(txt(j.numero)),
      complemento: txt(j.complemento),
      bairro: txt(j.bairro),
      // A Receita devolve o município em CAIXA ALTA ("GOIANIA"); a lista do IBGE
      // usada no combobox está em caixa mista e com acento, então quem chama tem de
      // casar contra ela em vez de confiar neste texto.
      cidade: txt(j.municipio),
      uf: txt(j.uf),
      cep: soDigitos(txt(j.cep)),
    }
  } catch {
    return null
  }
}
