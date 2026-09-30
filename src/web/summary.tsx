import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function Summary({ text }: { text: string }) {
  return <div className="summary-markdown text-sm leading-6 text-muted-foreground">
    <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{
      // Model output must not cause requests to third-party images or services.
      img: ({ alt }) => alt ? <span>{alt}</span> : null,
      a: ({ children }) => <span className="underline decoration-muted-foreground/40 underline-offset-2">{children}</span>,
    }}>{text}</ReactMarkdown>
  </div>;
}
