// O CACHE DOS LINKS DOS ANEXOS DO KOMMO, um só para a página inteira.
//
// UM SÓ, e não um por card nem um por miniatura: a miniatura da última anotação
// no card e a do histórico aberto são o MESMO arquivo, e o clique que abre o
// visualizador quer o mesmo link. Cada um pedindo o seu seria a mesma ida à
// `kommo-anexo` (e dela ao Kommo) duas ou três vezes. As regras — a validade do
// link, a promessa compartilhada, duas idas ao mesmo tempo no máximo — estão em
// previaDoAnexo.ts, testadas.
//
// POR QUE A `kommo-anexo` POR ARQUIVO: ela faz UMA consulta ao Kommo (os
// metadados do drive, `{drive}/v1.0/files/{uuid}`; a URL do drive fica guardada
// na instância), e devolve o link de download e, desde 06/10/2026, a prévia
// pequena que o drive gera (`miniatura`). A lista de anexos do card
// (`buscar-kommo`) consultaria o Kommo uma vez por arquivo do card — para mostrar
// uma imagem.

import { invokeFunction } from '@/lib/functions'
import { criarCacheDeLinks, type LinkDoAnexo } from '@/lib/previaDoAnexo'

export const linksDosAnexos = criarCacheDeLinks({
  concorrencia: 2,
  buscar: async (uuid) => {
    const r = await invokeFunction<Partial<LinkDoAnexo> & { erro?: string }>('kommo-anexo', { file_uuid: uuid })
    if (r?.erro || !r?.download) throw new Error(r?.erro ?? 'o Kommo não devolveu o endereço.')
    return {
      download: r.download,
      miniatura: r.miniatura ?? null,
      nome: r.nome ?? '',
      mime: r.mime ?? '',
    }
  },
})
