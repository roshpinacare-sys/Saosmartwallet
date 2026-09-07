/**
 * Saosmartwallet — minimal valid PDF renderer (layer 6 support)
 * =============================================================
 * Zero-dependency, hand-assembled PDF 1.4 for audit/compliance reports:
 * plain Helvetica text, one content stream per page, correct cross-reference
 * table with exact byte offsets, trailer + startxref.
 *
 * Layout: A4 (595×842 pt), 40 pt margins, Helvetica 8.5 pt, 11 pt leading,
 * 66 lines per page. Every line is sanitized to printable ASCII (typographic
 * punctuation is mapped, everything else becomes "?") and PDF-escaped
 * (backslash and parentheses), so the output is byte-safe regardless of input.
 */

/** A4 width in points. */
const PAGE_WIDTH = 595;
/** A4 height in points. */
const PAGE_HEIGHT = 842;
/** Page margin in points (all sides). */
const MARGIN = 40;
/** Text leading (line height) in points. */
const LINE_HEIGHT = 11;
/** Helvetica font size in points. */
const FONT_SIZE = 8.5;
/** Lines per page (66 × 11 pt fits between the 40 pt margins). */
const LINES_PER_PAGE = 66;

/** Common typographic characters mapped to ASCII equivalents before escaping. */
const CHAR_REPLACEMENTS: Record<string, string> = {
  "\t": "    ",
  "–": "-",
  "—": "-",
  "‘": "'",
  "’": "'",
  "‚": ",",
  "“": '"',
  "”": '"',
  "„": '"',
  "•": "*",
  "·": "*",
  "…": "...",
  "×": "x",
  "÷": "/",
  "\u00a0": " ",
  "\u2009": " ",
};

/** Sanitize one line to printable ASCII (the sanitizer runs BEFORE escaping). */
function sanitize(line: string): string {
  let out = "";
  for (const ch of line) {
    const mapped = CHAR_REPLACEMENTS[ch];
    if (mapped !== undefined) {
      out += mapped;
      continue;
    }
    const code = ch.codePointAt(0) ?? 63;
    out += code >= 32 && code <= 126 ? ch : "?";
  }
  return out;
}

/** Escape PDF string-literal metacharacters: backslash and parentheses. */
function escapePdfText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/**
 * Render text lines into a minimal but VALID multi-page PDF document.
 *
 * Object layout: 1 = Catalog, 2 = Pages, then one Page + one Content object
 * per page (3..N-1), and the Font object last (N). Content streams use
 * `BT /F1 8.5 Tf 11 TL 40 802 Td (line) Tj T* … ET`. The xref table contains
 * exact byte offsets (objects are pure ASCII, measured in latin-1 bytes) and
 * the file ends with `startxref` + `%%EOF`.
 *
 * @param lines — report text lines; chunked 66 per page (at least one page is
 *   always emitted, even for an empty list).
 * @returns the PDF document bytes.
 */
export function renderPdfReport(lines: string[]): Uint8Array {
  const clean = lines.map((l) => escapePdfText(sanitize(l)));
  const pageCount = Math.max(1, Math.ceil(clean.length / LINES_PER_PAGE));
  const totalObjects = 3 + 2 * pageCount; // catalog + pages + 2/page + font
  const fontObj = totalObjects; // the font object is always last

  const parts: string[] = [];
  let pos = 0;
  const offsets: number[] = new Array<number>(totalObjects + 1).fill(0);

  const write = (s: string): void => {
    parts.push(s);
    pos += Buffer.byteLength(s, "latin1");
  };
  const beginObj = (n: number): void => {
    offsets[n] = pos;
    write(`${n} 0 obj\n`);
  };

  write("%PDF-1.4\n");

  // Object 1 — Catalog.
  beginObj(1);
  write("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

  // Object 2 — Pages (kids are the page objects 3, 5, 7, …).
  const kids = Array.from({ length: pageCount }, (_, p) => `${3 + 2 * p} 0 R`).join(" ");
  beginObj(2);
  write(`<< /Type /Pages /Count ${pageCount} /Kids [${kids}] >>\nendobj\n`);

  // Objects 3..N-1 — Page + Content pairs.
  for (let p = 0; p < pageCount; p++) {
    const pageObj = 3 + 2 * p;
    const contentObj = 4 + 2 * p;
    const pageLines = clean.slice(p * LINES_PER_PAGE, (p + 1) * LINES_PER_PAGE);
    const content =
      pageLines.length === 0
        ? ""
        : `BT\n/F1 ${FONT_SIZE} Tf\n${LINE_HEIGHT} TL\n${MARGIN} ${PAGE_HEIGHT - MARGIN} Td\n` +
          pageLines.map((l) => `(${l}) Tj\nT*`).join("\n") +
          "\nET";

    beginObj(pageObj);
    write(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        `/Resources << /Font << /F1 ${fontObj} 0 R >> >> /Contents ${contentObj} 0 R >>\nendobj\n`,
    );
    beginObj(contentObj);
    // /Length counts exactly the stream data between "stream\n" and "\nendstream".
    write(`<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream\nendobj\n`);
  }

  // Object N — Font.
  beginObj(fontObj);
  write("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n");

  // Cross-reference table + trailer.
  const xrefOffset = pos;
  let xref = `xref\n0 ${totalObjects + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= totalObjects; n++) {
    xref += `${offsets[n].toString().padStart(10, "0")} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  write(xref);

  return new Uint8Array(Buffer.from(parts.join(""), "latin1"));
}
