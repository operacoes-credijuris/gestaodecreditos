import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// LINK SUBLINHADO, e não só colorido: no meio da prosa, a cor sozinha não
// separa o link do negrito para quem enxerga pouco as cores.
const LINK = 'text-marca-texto underline underline-offset-2'

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
        p: ({ children }) => <p className="mb-[8px] last:mb-0">{children}</p>,
        strong: ({ children }) => (
          <strong className="font-bold text-texto">{children}</strong>
        ),
        em: ({ children }) => <em className="italic">{children}</em>,
        ul: ({ children }) => (
          <ul className="mb-[8px] list-disc pl-[20px] last:mb-0">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="mb-[8px] list-decimal pl-[20px] last:mb-0">{children}</ol>
        ),
        li: ({ children }) => <li className="my-[2px]">{children}</li>,
        // Tabela larga em quadro estreito: rola dentro do próprio quadro, em vez
        // de esticar o container.
        table: ({ children }) => (
          <div className="mb-[8px] overflow-x-auto scrollbar-thin last:mb-0">
            <table className="w-full border-collapse text-xs">{children}</table>
          </div>
        ),
        th: ({ children }) => (
          <th className="border-b border-borda-forte px-[8px] py-[4px] text-left font-bold">
            {children}
          </th>
        ),
        // Tabulares: valores e datas em coluna só se comparam com os dígitos
        // na mesma largura.
        td: ({ children }) => (
          <td className="whitespace-nowrap border-b border-borda px-[8px] py-[4px] tabular-nums">
            {children}
          </td>
        ),
        code: ({ children }) => (
          <code className="rounded-[4px] border border-borda bg-superficie-2 px-1 font-mono text-xs">
            {children}
          </code>
        ),
        // Bloco de código: o `code` de dentro perde a moldura do inline (o
        // quadro já é do `pre`) e NÃO QUEBRA LINHA — rola de lado, como a tabela.
        pre: ({ children }) => (
          <pre
            className={
              'mb-[8px] overflow-x-auto scrollbar-thin rounded-controle border border-borda bg-superficie-2 px-[10px] py-[8px] last:mb-0 ' +
              '[&>code]:whitespace-pre [&>code]:border-0 [&>code]:bg-transparent [&>code]:p-0'
            }
          >
            {children}
          </pre>
        ),
        hr: () => <hr className="my-[10px] border-borda-forte" />,
        blockquote: ({ children }) => (
          <blockquote className="mb-[8px] border-l-[3px] border-borda-forte pl-[10px] text-texto-2 last:mb-0">
            {children}
          </blockquote>
        ),
        h1: ({ children }) => (
          <p className="mb-[4px] font-bold text-texto">{children}</p>
        ),
        h2: ({ children }) => (
          <p className="mb-[4px] font-bold text-texto">{children}</p>
        ),
        h3: ({ children }) => (
          <p className="mb-[4px] font-bold text-texto">{children}</p>
        ),
        // LINK EXTERNO ABRE EM OUTRA ABA. Na mesma aba, o clique trocava a
        // plataforma pelo site do link, e iam embora o painel do assistente, a
        // pergunta que estava sendo digitada e a tela que estava aberta atrás.
        // `noopener noreferrer` porque o destino é texto do modelo, não um
        // endereço que a plataforma escolheu.
        a: ({ href, title, children }) =>
          /^https?:\/\//i.test(href ?? '') ? (
            <a
              href={href}
              title={title}
              target="_blank"
              rel="noopener noreferrer"
              className={LINK}
            >
              {children}
            </a>
          ) : (
            <a href={href} title={title} className={LINK}>
              {children}
            </a>
          ),
      }}
    >
      {texto}
    </Markdown>
  )
}
