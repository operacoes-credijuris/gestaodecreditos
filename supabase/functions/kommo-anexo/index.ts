// kommo-anexo — o endereço de download de UM arquivo do Kommo, pelo uuid dele.
//
// POR QUE PELO UUID, E NÃO PELO NOME. A primeira versão disto perguntava ao
// `buscar-kommo` a lista de anexos do card e procurava o arquivo clicado pelo
// NOME. Duas coisas quebram esse caminho, e as duas são comuns:
//
//   - a lista vem de /leads/{id}/files, que é o que está ANEXADO À ENTIDADE. O
//     arquivo de uma anotação vive no drive da conta e nem sempre aparece ali;
//   - nome de arquivo repete. Um card com "default.aspx.pdf", "default.aspx1.pdf"
//     e "default.aspx2.pdf" — que é como um tribunal exporta — faz a comparação
//     por nome escolher o primeiro que casar, e abrir a peça errada é pior do
//     que não abrir nada.
//
// A ANOTAÇÃO JÁ TRAZ O `file_uuid`, que é a chave de verdade do arquivo. O
// kommo-sync passou a guardá-lo, e aqui ele vira endereço: os metadados do drive
// (`{drive}/v1.0/files/{uuid}`) trazem `_links.download.href`, que é o mesmo
// link que o navegador usa para baixar o PDF na due diligence.
//
// O LINK É ASSINADO E VENCE, e é por isso que ele não é guardado no espelho: o
// que se guarda é o uuid, que não muda, e o endereço se pede no clique.
//
// USO (POST, com sessão logada): { "file_uuid": "…" }
//   -> { pronto: true, download, nome, mime }

import { corsHeaders } from "../_shared/cors.ts";
import { ERRO_ACESSO, getCallerAtivo, serviceClient } from "../_shared/auth.ts";
import { chaveKommo } from "../_shared/segredos.ts";

const CORS = corsHeaders;
const KOMMO_SUBDOMAIN = "contatocredijuriscom";

function json(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), {
    status: s,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });
}

/** O formato do uuid do drive — recusar o resto poupa uma ida à API. */
const UUID = /^[0-9a-f-]{20,64}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    // ATIVO, e não só autenticado: quem foi desativado em Configurações continua
    // com o JWT válido, e o que passa por aqui são os documentos de um processo.
    const user = await getCallerAtivo(req, serviceClient());
    if (!user) return json({ erro: ERRO_ACESSO }, 401);

    const body = await req.json().catch(() => ({}));
    const uuid = String((body as any).file_uuid ?? "").trim();
    if (!UUID.test(uuid)) return json({ erro: "file_uuid inválido." }, 400);

    const token = await chaveKommo();
    if (!token) return json({ erro: "Token da Kommo não configurado." }, 500);
    const auth = { Authorization: `Bearer ${token}` };

    // A URL do drive é da CONTA, e não fixa: contas diferentes respondem em
    // hosts diferentes (drive-g, drive-b…). É a mesma descoberta que o
    // buscar-kommo faz antes de ler os metadados de um anexo.
    const accRes = await fetch(
      `https://${KOMMO_SUBDOMAIN}.kommo.com/api/v4/account?with=drive_url`,
      { headers: auth },
    );
    const drive = ((await accRes.json().catch(() => ({}))) as any)?.drive_url;
    if (!drive) return json({ erro: "Não consegui descobrir a drive_url da conta Kommo." }, 502);

    const mRes = await fetch(`${drive}/v1.0/files/${uuid}`, { headers: auth });
    if (!mRes.ok) {
      // 404 AQUI É ARQUIVO APAGADO no Kommo, e é uma resposta útil: a anotação
      // continua no espelho dizendo que ele existiu.
      return json(
        {
          erro:
            mRes.status === 404
              ? "Este arquivo não está mais no Kommo (pode ter sido apagado)."
              : `O Kommo recusou os metadados do arquivo (HTTP ${mRes.status}).`,
        },
        mRes.status === 404 ? 404 : 502,
      );
    }
    const m = (await mRes.json().catch(() => null)) as any;
    const download = m?._links?.download?.href;
    if (!download) return json({ erro: "O arquivo não trouxe link de download." }, 502);

    return json({
      pronto: true,
      download,
      nome: String(m?.name ?? ""),
      mime: String(m?.metadata?.mime_type ?? ""),
    });
  } catch (e) {
    return json({ erro: String((e as Error)?.message || e) }, 500);
  }
});
