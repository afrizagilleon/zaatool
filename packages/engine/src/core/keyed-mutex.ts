/**
 * Runs async tasks one at a time per key, in the order they were asked for.
 *
 * In memory and per process, which is the right size for what it guards: the engine is one
 * process, and what needs ordering here (a notebook's files, checked and written as one
 * step) is not something a second process is ever allowed to touch.
 */
export class KeyedMutex {
  private readonly tails = new Map<string, Promise<unknown>>();

  async run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    // A failure of the task before this one is that task's business, not this one's.
    const result = previous.catch(() => undefined).then(task);
    const tail = result.catch(() => undefined);
    this.tails.set(key, tail);
    try {
      return await result;
    } finally {
      // Forgotten once nothing queued behind it, so the map does not grow with every id ever seen.
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}
