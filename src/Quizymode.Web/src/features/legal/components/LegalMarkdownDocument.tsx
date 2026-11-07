import { useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { SEO } from "@/components/SEO";

interface LegalMarkdownDocumentProps {
  title: string;
  description: string;
  canonical: string;
  markdown: string;
}

type MarkdownBlock =
  | { type: "h1" | "h2" | "h3" | "p"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "hr" };

const INLINE_PATTERN =
  /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|`([^`]+)`/g;

const LegalMarkdownDocument = ({
  title,
  description,
  canonical,
  markdown,
}: LegalMarkdownDocumentProps) => {
  const blocks = useMemo(() => parseMarkdown(markdown), [markdown]);

  return (
    <>
      <SEO title={title} description={description} canonical={canonical} />
      <div className="mx-auto max-w-4xl rounded-lg bg-surface px-4 py-8 shadow-sm sm:px-6 lg:px-8">
        <article className="space-y-6">
          {blocks.map((block, index) => {
            if (block.type === "h1") {
              return (
                <h1
                  key={`block-${index}`}
                  className="text-4xl font-bold tracking-tight text-slate-900"
                >
                  {renderInline(block.text)}
                </h1>
              );
            }

            if (block.type === "h2") {
              return (
                <h2
                  key={`block-${index}`}
                  className="pt-2 text-2xl font-semibold text-slate-900"
                >
                  {renderInline(block.text)}
                </h2>
              );
            }

            if (block.type === "h3") {
              return (
                <h3
                  key={`block-${index}`}
                  className="text-lg font-semibold text-slate-900"
                >
                  {renderInline(block.text)}
                </h3>
              );
            }

            if (block.type === "p") {
              return (
                <p
                  key={`block-${index}`}
                  className="text-base leading-7 text-slate-700"
                >
                  {renderInline(block.text)}
                </p>
              );
            }

            if (block.type === "ul") {
              return (
                <ul
                  key={`block-${index}`}
                  className="list-disc space-y-2 pl-6 text-base leading-7 text-slate-700"
                >
                  {block.items.map((item, itemIndex) => (
                    <li key={`item-${index}-${itemIndex}`}>{renderInline(item)}</li>
                  ))}
                </ul>
              );
            }

            return (
              <hr
                key={`block-${index}`}
                className="border-slate-200"
              />
            );
          })}
        </article>
      </div>
    </>
  );
};

function parseMarkdown(markdown: string): MarkdownBlock[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let paragraphLines: string[] = [];
  let listItems: string[] = [];

  const flushParagraph = () => {
    if (paragraphLines.length === 0) {
      return;
    }

    blocks.push({
      type: "p",
      text: paragraphLines.join(" ").trim(),
    });
    paragraphLines = [];
  };

  const flushList = () => {
    if (listItems.length === 0) {
      return;
    }

    blocks.push({
      type: "ul",
      items: [...listItems],
    });
    listItems = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      flushParagraph();
      flushList();
      continue;
    }

    if (trimmed === "---") {
      flushParagraph();
      flushList();
      blocks.push({ type: "hr" });
      continue;
    }

    if (trimmed.startsWith("- ")) {
      flushParagraph();
      listItems.push(trimmed.slice(2).trim());
      continue;
    }

    const headingMatch = /^(#{1,3})\s+(.*)$/.exec(trimmed);
    if (headingMatch) {
      flushParagraph();
      flushList();

      const level = headingMatch[1].length;
      blocks.push({
        type: level === 1 ? "h1" : level === 2 ? "h2" : "h3",
        text: headingMatch[2].trim(),
      });
      continue;
    }

    flushList();
    paragraphLines.push(trimmed);
  }

  flushParagraph();
  flushList();

  return blocks;
}

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  INLINE_PATTERN.lastIndex = 0;

  while ((match = INLINE_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    if (match[1] && match[2]) {
      nodes.push(renderLink(match[1], match[2], match.index));
    } else if (match[3]) {
      nodes.push(
        <strong key={`strong-${match.index}`} className="font-semibold text-slate-900">
          {match[3]}
        </strong>
      );
    } else if (match[4]) {
      nodes.push(
        <code
          key={`code-${match.index}`}
          className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[0.95em] text-slate-900"
        >
          {match[4]}
        </code>
      );
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes.length > 0 ? nodes : [text];
}

function renderLink(label: string, href: string, key: number): ReactNode {
  const className = "font-medium text-indigo-ink hover:text-indigo-ink underline";

  if (href.startsWith("/")) {
    return (
      <Link key={`link-${key}`} to={href} className={className}>
        {label}
      </Link>
    );
  }

  return (
    <a
      key={`link-${key}`}
      href={href}
      className={className}
      target="_blank"
      rel="noreferrer"
    >
      {label}
    </a>
  );
}

export default LegalMarkdownDocument;
