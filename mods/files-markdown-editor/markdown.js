// Minimal, offset-preserving Markdown block splitter for click-to-edit previews.
const FENCE = /^[ \t]{0,3}(`{3,}|~{3,})/;
const HEADING = /^[ \t]{0,3}#{1,6}[ \t]/;
const QUOTE = /^[ \t]{0,3}>/;
const LIST = /^[ \t]{0,3}(?:[-+*]|\d{1,9}[.)])[ \t]/;
const INDENT = /^(?:[ \t]{4}|\t)/;
const RULE = /^[ \t]{0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const TABLE_DIVIDER = /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)+\|?[ \t]*$/;

export function isMarkdown(path) {
  return /\.(md|markdown)$/i.test(path);
}

function splitLines(text) {
  const out = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") { out.push({ start, end: i }); start = i + 1; }
  }
  if (start < text.length) out.push({ start, end: text.length });
  return out;
}

function special(body) {
  return FENCE.test(body) || HEADING.test(body) || QUOTE.test(body) || LIST.test(body) || INDENT.test(body) || RULE.test(body);
}

function closesFence(body, marker) {
  const found = body.match(FENCE);
  return Boolean(found && found[1][0] === marker[0] && found[1].length >= marker.length);
}

export function blocks(text) {
  const lines = splitLines(text).map(line => ({ ...line, body: text.slice(line.start, line.end).replace(/\r$/, "") }));
  const out = [];
  const push = (from, to, kind) => {
    const start = lines[from].start, end = lines[to].end;
    out.push({ start, end, text: text.slice(start, end), kind });
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.body.trim()) { i++; continue; }

    const fence = line.body.match(FENCE);
    if (fence) {
      let j = i + 1;
      while (j < lines.length && !closesFence(lines[j].body, fence[1])) j++;
      push(i, Math.min(j, lines.length - 1), "code");
      i = j + 1;
      continue;
    }
    if (HEADING.test(line.body)) { push(i, i, "heading"); i++; continue; }
    if (RULE.test(line.body)) { push(i, i, "rule"); i++; continue; }
    if (QUOTE.test(line.body)) {
      let j = i + 1;
      while (j < lines.length && (QUOTE.test(lines[j].body) || (/^[ \t]/.test(lines[j].body) && lines[j].body.trim()))) j++;
      push(i, j - 1, "quote");
      i = j;
      continue;
    }
    if (LIST.test(line.body)) {
      let j = i + 1;
      while (j < lines.length && (LIST.test(lines[j].body) || (/^[ \t]{2,}/.test(lines[j].body) && lines[j].body.trim()))) j++;
      push(i, j - 1, "list");
      i = j;
      continue;
    }
    if (INDENT.test(line.body)) {
      let j = i + 1;
      while (j < lines.length && (INDENT.test(lines[j].body) || (/^[ \t]/.test(lines[j].body) && lines[j].body.trim()))) j++;
      push(i, j - 1, "code");
      i = j;
      continue;
    }
    if (line.body.includes("|") && i + 1 < lines.length && TABLE_DIVIDER.test(lines[i + 1].body)) {
      let j = i + 2;
      while (j < lines.length && lines[j].body.includes("|")) j++;
      push(i, j - 1, "table");
      i = j;
      continue;
    }
    let j = i + 1;
    while (j < lines.length && lines[j].body.trim() && !special(lines[j].body)) j++;
    push(i, j - 1, "paragraph");
    i = j;
  }
  return out;
}

export function applyBlockEdit(text, blockList, index, value) {
  const block = blockList[index];
  if (!block) return { text, blocks: blockList };
  const delta = value.length - (block.end - block.start);
  return {
    text: text.slice(0, block.start) + value + text.slice(block.end),
    blocks: blockList.map((item, i) =>
      i < index ? item
        : i === index ? { ...item, text: value, end: block.end + delta }
          : { ...item, start: item.start + delta, end: item.end + delta }),
  };
}

export function selfCheck() {
  const assert = (ok, message) => { if (!ok) throw new Error(`markdown self-check: ${message}`); };
  const sample = "# Title\r\n\r\n- one\r\n- two\r\n\r\nbody";
  const parsed = blocks(sample);
  assert(parsed.length === 3, "expected three blocks");
  assert(parsed[0].kind === "heading" && parsed[0].text === "# Title\r", "heading block");
  assert(parsed[1].kind === "list" && parsed[1].text === "- one\r\n- two\r", "list block");
  assert(parsed[2].kind === "paragraph" && parsed[2].text === "body", "paragraph block");

  const replacement = "- one\r\n- two\r\n- three";
  const edited = applyBlockEdit(sample, parsed, 1, replacement);
  const delta = replacement.length - parsed[1].text.length;
  assert(edited.text.startsWith("# Title\r\n\r\n") && edited.text.endsWith("- three\n\r\nbody"), "surrounding source preserved");
  assert(edited.blocks[2].start === parsed[2].start + delta, "following offsets shifted");
  assert(edited.blocks[1].text === replacement, "edited block text");

  const fenced = "text\n\n```js\nconst a = 1\n```\n\nend";
  const withCode = blocks(fenced);
  assert(withCode.length === 3 && withCode[1].kind === "code" && withCode[1].text.includes("```js"), "fenced code block");
}
