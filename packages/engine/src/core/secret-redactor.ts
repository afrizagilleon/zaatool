/**
 * Replaces the values of a run's secrets, wherever they turn up in what the run produced.
 *
 * A cell is user-written code that holds its secrets in `process.env`, so anything it can
 * print, throw or return can carry one: `console.log(key)`, an exception message that quotes
 * the URL it called, a stack trace, an output nobody declared. Without this, all of that was
 * stored in `notebook_runs` as plain text and handed to whoever could read the run.
 *
 * This stops *accidents*, not a determined author. Code that wants a secret out can split
 * it, reverse it, XOR it or send it over the network, and no pattern match will catch that.
 * That is why the real defence is elsewhere: a run only ever holds secrets that belong to
 * whoever started it (or, in production, to the owner who approved the deploy). Redaction is
 * the second line, for the log line somebody forgot to delete.
 *
 * What is matched, for each secret value `v` (UTF-8):
 *  - the value itself, its JSON-escaped form (inside a serialized object) and its
 *    `encodeURIComponent` form, plus the form-encoding spelling (`+` for a space);
 *  - hex, lower and upper case;
 *  - base64 and base64url, at all three byte alignments. `v` inside a longer base64 stream
 *    does not encode to the same characters it does on its own: it depends on how many
 *    bytes precede it (mod 3). So `v` is encoded with 0, 1 and 2 bytes of prefix, and only
 *    the characters that depend on `v` alone are kept — the "stable middle", without the
 *    first characters shared with the prefix and the last ones shared with what follows.
 *
 * Values shorter than {@link MIN_SECRET_LENGTH} are not redacted. A secret of "1" or "abc"
 * would turn every "1" in a log into a marker and make the output unreadable, and such a
 * value is not a credential anyway (it is a flag, a region, a mode).
 *
 * Not covered: a value split across two log lines, a value embedded in a multi-line secret
 * (a PEM key is matched as a whole, not per line), and any transformation other than the
 * above.
 */

/** A secret this short is a setting, not a credential, and matching it would mangle ordinary text. */
export const MIN_SECRET_LENGTH = 6;

/** The marker that takes the place of a value. Names the secret, never anything about its value. */
export const markerFor = (name: string): string => `[secret:${name}]`;

/** Keys an event or a record uses to say *which* run or cell it is: never touched, or a secret equal to an id would break the row. */
const STRUCTURAL_KEYS = new Set(["type", "runId", "notebookId", "cellId"]);

/** Deeper than any real output; a guard so a pathological value cannot blow the stack. */
const MAX_DEPTH = 64;

interface Pattern {
  needle: string;
  marker: string;
}

/** The characters of a base64 stream that depend only on `value`, for one byte alignment. */
function base64Middle(value: Buffer, prefixBytes: number, urlSafe: boolean): string | null {
  const bits = 8 * (prefixBytes + value.length);
  // A character is stable when every one of its six bits is the value's: it must start at or
  // after the end of the prefix and end at or before the end of the value.
  const first = Math.ceil((8 * prefixBytes) / 6);
  const last = Math.floor(bits / 6);
  if (last - first < MIN_SECRET_LENGTH) return null;

  const encoded = Buffer.concat([Buffer.alloc(prefixBytes), value]).toString(
    urlSafe ? "base64url" : "base64"
  );
  return encoded.slice(first, last);
}

function variantsOf(secret: string): string[] {
  const bytes = Buffer.from(secret, "utf8");
  const out = new Set<string>();

  out.add(secret);
  out.add(JSON.stringify(secret).slice(1, -1));

  const uri = encodeURIComponent(secret);
  out.add(uri);
  out.add(uri.replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase()));
  // Form encoding writes a space as "+", encodeURIComponent as "%20".
  out.add(uri.replace(/%20/g, "+"));

  const hex = bytes.toString("hex");
  out.add(hex);
  out.add(hex.toUpperCase());

  for (const urlSafe of [false, true]) {
    for (const prefix of [0, 1, 2]) {
      const middle = base64Middle(bytes, prefix, urlSafe);
      if (middle) out.add(middle);
    }
  }

  return [...out].filter((v) => v.length >= MIN_SECRET_LENGTH);
}

export interface SecretRedactor {
  /** No secret is long enough to redact, so every call returns its input unchanged. */
  readonly empty: boolean;
  string(text: string): string;
  /** Any JSON-like value, with every string (and every object key) redacted. Returns a new value only where something changed. */
  value<T>(value: T): T;
  /** An event or a record: like `value`, but identity fields are left alone. */
  record<T extends object>(record: T): T;
}

export function createRedactor(secrets: Record<string, string>): SecretRedactor {
  const patterns: Pattern[] = [];
  const seen = new Set<string>();

  // Longest needles first, so a value that contains a shorter one is replaced as a whole.
  const entries = Object.entries(secrets)
    .filter(([, value]) => typeof value === "string" && value.length >= MIN_SECRET_LENGTH)
    .sort(([, a], [, b]) => b.length - a.length);

  for (const [name, value] of entries) {
    for (const needle of variantsOf(value)) {
      if (seen.has(needle)) continue;
      seen.add(needle);
      patterns.push({ needle, marker: markerFor(name) });
    }
  }
  patterns.sort((a, b) => b.needle.length - a.needle.length);

  const rawValues = new Map(entries.map(([name, value]) => [value, name]));

  const string = (text: string): string => {
    if (patterns.length === 0 || text.length < MIN_SECRET_LENGTH) return text;
    let result = text;
    for (const { needle, marker } of patterns) {
      if (result.includes(needle)) result = result.split(needle).join(marker);
    }
    return result;
  };

  const walk = (input: unknown, depth: number, skipStructural: boolean): unknown => {
    if (typeof input === "string") return string(input);
    if (typeof input === "number" || typeof input === "bigint") {
      // A numeric secret (a PIN, an account number) that came back as a number.
      const name = rawValues.get(String(input));
      return name === undefined ? input : markerFor(name);
    }
    if (typeof input !== "object" || input === null) return input;
    if (depth >= MAX_DEPTH) return "[nested too deep to redact]";

    if (Array.isArray(input)) {
      let changed = false;
      const mapped = input.map((item) => {
        const next = walk(item, depth + 1, false);
        if (next !== item) changed = true;
        return next;
      });
      return changed ? mapped : input;
    }

    let changed = false;
    const mapped: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(input as Record<string, unknown>)) {
      if (skipStructural && STRUCTURAL_KEYS.has(key)) {
        mapped[key] = item;
        continue;
      }
      const safeKey = string(key);
      const next = walk(item, depth + 1, false);
      if (next !== item || safeKey !== key) changed = true;
      mapped[safeKey] = next;
    }
    return changed ? mapped : input;
  };

  return {
    empty: patterns.length === 0,
    string,
    value: <T>(value: T): T => (patterns.length === 0 ? value : (walk(value, 0, false) as T)),
    record: <T extends object>(record: T): T =>
      patterns.length === 0 ? record : (walk(record, 0, true) as T),
  };
}

/** The redactor of a run that holds no secrets. */
export const NO_REDACTION: SecretRedactor = createRedactor({});
