import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * Renderiza texto vindo do modelo, que chega em Markdown — negrito, listas e
 * tabelas. Sem isto o usuário lê os asteriscos e os pipes crus.
 *
 * COMPARTILHADO entre o assistente flutuante e o panorama da geração de petição
 * por IA: os dois exibem prosa do mesmo modelo, e duas cópias do estilo
 * divergiriam — uma ganharia tabela rolável e a outra não, sem motivo nenhum.
 *
 * O estilo vai bloco a bloco em vez de via plugin de tipografia: os dois lugares
 * são estreitos (painel de 420px, janela de petição), e os tamanhos padrão de um
 * artigo ficariam grandes demais.
 */
export function TextoIA({ texto }: { texto: string }) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
        strong: ({ children }) => (
          <strong className="font-semibold text-slate-900">{children}</strong>
        ),
        em: ({ children }) => <em className="italic">{children}</em>,
        ul: ({ children }) => (
          <ul className="mb-2 list-disc space-y-0.5 pl-4 last:mb-0">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="mb-2 list-decimal space-y-0.5 pl-4 last:mb-0">{children}</ol>
        ),
        // Tabela larga em quadro estreito: rola dentro do próprio quadro, em vez
        // de esticar o container.
        table: ({ children }) => (
          <div className="mb-2 overflow-x-auto scrollbar-thin last:mb-0">
            <table className="w-full border-collapse text-xs">{children}</table>
          </div>
        ),
        th: ({ children }) => (
          <th className="border-b border-slate-300 px-2 py-1 text-left font-semibold">
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className="whitespace-nowrap border-b border-slate-200 px-2 py-1">
            {children}
          </td>
        ),
        code: ({ children }) => (
          <code className="rounded bg-slate-200 px-1 py-0.5 font-mono text-xs">
            {children}
          </code>
        ),
        h1: ({ children }) => (
          <p className="mb-1 font-semibold text-slate-900">{children}</p>
        ),
        h2: ({ children }) => (
          <p className="mb-1 font-semibold text-slate-900">{children}</p>
        ),
        h3: ({ children }) => (
          <p className="mb-1 font-semibold text-slate-900">{children}</p>
        ),
      }}
    >
      {texto}
    </Markdown>
  )
}
