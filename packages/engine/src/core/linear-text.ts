/**
 * Small string scanners that stand in for regular expressions whose shape is quadratic on
 * hostile input (`/x+$/`, `/\s*…\s*$/`): a regex engine retries from every start position,
 * so a long run of the repeated character followed by something else costs n² steps.
 * These walk the string once.
 */

/** `text` without any trailing characters that appear in `chars`. */
export function trimEndChars(text: string, chars: string): string {
  let end = text.length;
  while (end > 0 && chars.includes(text[end - 1])) end -= 1;
  return end === text.length ? text : text.slice(0, end);
}

/** `text` without leading or trailing characters that appear in `chars`. */
export function trimChars(text: string, chars: string): string {
  let start = 0;
  while (start < text.length && chars.includes(text[start])) start += 1;
  return trimEndChars(text.slice(start), chars);
}

/** The number of `char` repeated at the very end of `text`. */
export function trailingRun(text: string, char: string): number {
  let count = 0;
  while (count < text.length && text[text.length - 1 - count] === char) count += 1;
  return count;
}

/** True for the characters a regular expression's `.` refuses to match. */
export function hasLineTerminator(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code === 10 || code === 13 || code === 0x2028 || code === 0x2029) return true;
  }
  return false;
}

/**
 * `message` without a trailing ` (line:column)` and the whitespace around it — the position
 * acorn appends, which the caller reports in its own terms.
 */
export function stripLocationSuffix(message: string): string {
  const trimmed = message.trimEnd();
  if (!trimmed.endsWith(")")) return message;
  const open = trimmed.lastIndexOf("(");
  if (open === -1) return message;
  const inside = trimmed.slice(open + 1, -1);
  const colon = inside.indexOf(":");
  if (colon <= 0 || colon === inside.length - 1) return message;
  for (let index = 0; index < inside.length; index += 1) {
    if (index !== colon && (inside.charCodeAt(index) < 48 || inside.charCodeAt(index) > 57)) return message;
  }
  return trimmed.slice(0, open).trimEnd();
}

/** `text` with a trailing run of three or more `\n` shortened to a single one. */
export function collapseTrailingBlankLines(text: string): string {
  const run = trailingRun(text, "\n");
  return run >= 3 ? `${text.slice(0, text.length - run)}\n` : text;
}

/**
 * A markdown HTML-comment marker line, `<!-- zaa:name attributes -->`, with whitespace
 * allowed anywhere around the parts. Returns the name and the attribute text, or null.
 */
export function parseMarkerLine(line: string): { name: string; attrs: string } | null {
  const trimmed = line.trim();
  if (trimmed.length < 7 || !trimmed.startsWith("<!--") || !trimmed.endsWith("-->")) return null;
  const inner = trimmed.slice(4, -3).trimStart();
  if (!inner.startsWith("zaa:")) return null;
  let end = 4;
  while (end < inner.length && inner[end] >= "a" && inner[end] <= "z") end += 1;
  if (end === 4) return null;
  const attrs = inner.slice(end).trim();
  // The pattern this replaces used `.`, which does not cross a line break.
  if (hasLineTerminator(attrs)) return null;
  return { name: inner.slice(4, end), attrs };
}

/**
 * The fence at the start of a line: up to three spaces, then three or more backticks or
 * tildes, then anything. Null when the line is not one.
 */
export function parseFenceLine(line: string): { marker: string; length: number } | null {
  let at = 0;
  while (at < 3 && /\s/.test(line[at] ?? "x")) at += 1;
  const marker = line[at];
  if (marker !== "`" && marker !== "~") return null;
  let end = at;
  while (line[end] === marker) end += 1;
  if (end - at < 3 || hasLineTerminator(line.slice(end))) return null;
  return { marker, length: end - at };
}

/** Whether `line` closes a fence of `length` or more `marker`s: up to three spaces, the run, spaces. */
export function closesFence(line: string, marker: string, length: number): boolean {
  let at = 0;
  while (at < 3 && /\s/.test(line[at] ?? "x")) at += 1;
  const rest = line.slice(at).trimEnd();
  return rest.length >= length && trailingRun(rest, marker) === rest.length;
}

/** `key=value` pairs, the value either `"quoted \" text"` or a run without spaces. */
export function parseAttributePairs(text: string): Array<{ key: string; quoted?: string; bare?: string }> {
  const found: Array<{ key: string; quoted?: string; bare?: string }> = [];
  const isLetter = (char: string): boolean => (char >= "a" && char <= "z") || (char >= "A" && char <= "Z");
  const isSpace = (char: string): boolean => /\s/.test(char);
  let at = 0;
  while (at < text.length) {
    if (!isLetter(text[at])) {
      at += 1;
      continue;
    }
    let keyEnd = at;
    while (keyEnd < text.length && isLetter(text[keyEnd])) keyEnd += 1;
    if (text[keyEnd] !== "=" || keyEnd + 1 >= text.length || isSpace(text[keyEnd + 1])) {
      // No value here, and none for any start inside the same word either.
      at = keyEnd;
      continue;
    }
    const key = text.slice(at, keyEnd);
    const valueStart = keyEnd + 1;
    const quotedEnd = text[valueStart] === '"' ? closingQuote(text, valueStart + 1) : -1;
    if (quotedEnd !== -1) {
      found.push({ key, quoted: text.slice(valueStart + 1, quotedEnd) });
      at = quotedEnd + 1;
      continue;
    }
    let bareEnd = valueStart;
    while (bareEnd < text.length && !isSpace(text[bareEnd])) bareEnd += 1;
    found.push({ key, bare: text.slice(valueStart, bareEnd) });
    at = bareEnd;
  }
  return found;
}

/** Index of the quote that closes a string whose body starts at `from`, or -1. */
function closingQuote(text: string, from: number): number {
  let at = from;
  while (at < text.length) {
    const char = text[at];
    if (char === '"') return at;
    if (char === "\\") {
      // A backslash takes the next character with it, unless that is a line break.
      if (at + 1 >= text.length || hasLineTerminator(text[at + 1])) return -1;
      at += 2;
      continue;
    }
    at += 1;
  }
  return -1;
}
