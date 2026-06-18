export function truncateLog(val: any, maxLen = 400): string {
  if (val === undefined) return "undefined";
  if (val === null) return "null";
  if (typeof val === "function") return "[Function]";

  try {
    if (typeof val === "object") {
      if (Array.isArray(val)) {
        if (val.length > 5) {
          const firstFew = val.slice(0, 3).map((item) => truncateLog(item, 100));
          return `[Array(${val.length})] [ ${firstFew.join(", ")}, ... and ${val.length - 3} more items ]`;
        }
      }
      // If it's a Buffer or typed data, summarize it
      if (val.type === "Buffer" && Array.isArray(val.data)) {
        return `<Buffer size=${val.data.length}>`;
      }

      const str = JSON.stringify(val);
      if (str.length > maxLen) {
        const keys = Object.keys(val);
        if (keys.length > 10) {
          return `[Object with ${keys.length} keys] { ${keys.slice(0, 5).join(", ")}, ... }`;
        }
        return str.substring(0, maxLen) + `... (truncated, total length: ${str.length})`;
      }
      return str;
    }

    const str = String(val);
    if (str.length > maxLen) {
      return str.substring(0, maxLen) + `... (truncated, total length: ${str.length})`;
    }
    return str;
  } catch (e) {
    return "[Object/Value]";
  }
}
