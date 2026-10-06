// A prévia pequena de um arquivo do drive do Kommo (kommo-anexo). Separada da
// função para o teste (src/lib/__tests__/previaDoAnexo.test.ts) alcançá-la.

/** A largura que a miniatura pede: 80px na tela, o dobro em tela de alta densidade. */
export const LARGURA_DA_MINIATURA = 160;

/**
 * A PRÉVIA DO DRIVE que serve à miniatura, ou nulo.
 *
 * O drive do Kommo gera prévias das imagens (`previews`, cada uma com
 * `download_link`, `width` e `height`) — muitas vezes NULO, e então a tela usa o
 * próprio arquivo. Havendo, a menor que ainda tenha 160px de largura (uma foto
 * de celular de 4 MB vira algumas dezenas de KB); nenhuma tão larga, a maior.
 * Lê com folga — lista ou objeto, `download_link` ou `_links.download.href` —,
 * porque a documentação mostra as duas formas e a resposta real nem sempre a
 * traz.
 */
export function previaPequena(previews: unknown): string | null {
  const lista = Array.isArray(previews)
    ? previews
    : previews && typeof previews === "object"
    ? Object.values(previews as Record<string, unknown>)
    : [];
  const validas = lista
    .map((p: any) => ({
      url: String(p?.download_link ?? p?._links?.download?.href ?? ""),
      largura: Number(p?.width) || 0,
    }))
    .filter((p) => /^https:\/\//i.test(p.url));
  if (!validas.length) return null;
  const largas = validas.filter((p) => p.largura >= LARGURA_DA_MINIATURA).sort((a, b) => a.largura - b.largura);
  if (largas.length) return largas[0].url;
  return validas.sort((a, b) => b.largura - a.largura)[0].url;
}
