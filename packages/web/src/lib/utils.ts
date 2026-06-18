import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function safeJsonStringify(obj: any): string {
  const cache = new Set();
  return JSON.stringify(obj, (_key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (cache.has(value)) {
        return undefined;
      }
      if (
        value instanceof HTMLElement ||
        value.constructor?.name === 'HTMLButtonElement' ||
        value.constructor?.name === 'FiberNode' ||
        '_reactFiber' in value
      ) {
        return undefined;
      }
      cache.add(value);
    }
    return value;
  });
}
