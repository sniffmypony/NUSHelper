import "katex/dist/katex.min.css";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

// The assistant's replies: Markdown with $...$ and $$...$$ LaTeX, as on
// Telegram. Raw HTML in a reply is shown as text, never run.

// "S$9.80 and S$5" must not become a formula, so those dollar signs are
// escaped. A formula written as $$...$$ on one line (fine on Telegram) is
// put on lines of its own, which is what makes it a display formula here.
function prepareMarkdown(markdown: string): string {
  return markdown
    .replace(/\bS\$(?=\d)/g, "S\\$")
    .replace(/^[ \t]*\$\$([^\n]+?)\$\$[ \t]*$/gm, "$$$$\n$1\n$$$$");
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="chat-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false }]]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
        }}
      >
        {prepareMarkdown(text)}
      </ReactMarkdown>
    </div>
  );
}
