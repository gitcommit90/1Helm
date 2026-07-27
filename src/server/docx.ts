import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";

const inlineRuns = (input: string, options: { code?: boolean; italics?: boolean } = {}): TextRun[] => {
  if (options.code) return [new TextRun({ text: input, font: "Courier New", size: 20 })];
  const runs: TextRun[] = [];
  const pattern = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*]+\*|_.*?_)/g;
  let offset = 0;
  for (const match of input.matchAll(pattern)) {
    const index = match.index || 0;
    if (index > offset) runs.push(new TextRun({ text: input.slice(offset, index), italics: options.italics }));
    const value = match[0];
    if ((value.startsWith("**") && value.endsWith("**")) || (value.startsWith("__") && value.endsWith("__"))) {
      runs.push(new TextRun({ text: value.slice(2, -2), bold: true, italics: options.italics }));
    } else if (value.startsWith("`") && value.endsWith("`")) {
      runs.push(new TextRun({ text: value.slice(1, -1), font: "Courier New", size: 20, italics: options.italics }));
    } else {
      runs.push(new TextRun({ text: value.slice(1, -1), italics: true }));
    }
    offset = index + value.length;
  }
  if (offset < input.length) runs.push(new TextRun({ text: input.slice(offset), italics: options.italics }));
  return runs.length ? runs : [new TextRun({ text: input, italics: options.italics })];
};

/** A contained Markdown file becomes a genuine Office Open XML document.
 * The converter deliberately favors predictable Word structure over trying to
 * reproduce every browser-only Markdown extension. */
export async function markdownToDocx(markdown: string): Promise<Buffer> {
  const children: Paragraph[] = [];
  const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
  let paragraph: string[] = [];
  let code: string[] | null = null;
  const flushParagraph = (): void => {
    if (!paragraph.length) return;
    children.push(new Paragraph({ children: inlineRuns(paragraph.join(" ")), spacing: { after: 160 } }));
    paragraph = [];
  };
  const flushCode = (): void => {
    if (!code) return;
    children.push(new Paragraph({ children: inlineRuns(code.join("\n"), { code: true }), spacing: { before: 80, after: 160 } }));
    code = null;
  };
  for (const line of lines) {
    if (/^```/.test(line)) {
      if (code) flushCode();
      else { flushParagraph(); code = []; }
      continue;
    }
    if (code) { code.push(line); continue; }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      const levels = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];
      children.push(new Paragraph({ heading: levels[heading[1].length - 1], children: inlineRuns(heading[2]), spacing: { before: 160, after: 100 } }));
      continue;
    }
    const unordered = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (unordered) { flushParagraph(); children.push(new Paragraph({ bullet: { level: 0 }, children: inlineRuns(unordered[1]) })); continue; }
    const ordered = /^\s*(\d+)[.)]\s+(.*)$/.exec(line);
    if (ordered) { flushParagraph(); children.push(new Paragraph({ children: [new TextRun({ text: `${ordered[1]}. `, bold: true }), ...inlineRuns(ordered[2])] })); continue; }
    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote) { flushParagraph(); children.push(new Paragraph({ indent: { left: 480 }, children: inlineRuns(quote[1], { italics: true }) })); continue; }
    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) { flushParagraph(); children.push(new Paragraph({ text: "────────────────────────" })); continue; }
    if (!line.trim()) { flushParagraph(); continue; }
    paragraph.push(line.trim());
  }
  flushParagraph(); flushCode();
  if (!children.length) children.push(new Paragraph({ text: "" }));
  return Packer.toBuffer(new Document({ sections: [{ properties: {}, children }] }));
}
