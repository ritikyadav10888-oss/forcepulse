import type { ReactNode } from "react";

/**
 * The small markdown the site pages use: "## " headings, "- " bullets, blank-line paragraphs, **bold**.
 * Rendered as React elements, so page text can never inject HTML.
 */
export function Markdown({ text }: { text: string }) {
  const blocks = text.replace(/\r\n/g, "\n").split(/\n{2,}/);
  return (
    <div className="max-w-prose space-y-4 leading-relaxed">
      {blocks.map((b, i) => {
        const lines = b.split("\n");
        if (lines.every((l) => l.startsWith("- "))) {
          return (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {lines.map((l, j) => (
                <li key={j}>{inline(l.slice(2))}</li>
              ))}
            </ul>
          );
        }
        if (lines[0].startsWith("## ")) {
          return (
            <div key={i} className="space-y-2 pt-2">
              <h2 className="text-xl font-bold">{lines[0].slice(3)}</h2>
              {lines.length > 1 ? <Markdown text={lines.slice(1).join("\n")} /> : null}
            </div>
          );
        }
        return <p key={i}>{inline(b)}</p>;
      })}
    </div>
  );
}

function inline(s: string): ReactNode[] {
  return s.split(/(\*\*[^*]+\*\*)/).map((part, i) => (part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : part));
}
