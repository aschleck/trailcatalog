import { EditableLine } from './edit_layer';

/** Puts lines to the server one at a time, holding each one until its put succeeds. */
export class SaveQueue {

  // In the order they were saved, which a Set iterates in.
  private readonly unsaved: Set<EditableLine>;
  // Serialized so that two puts cannot each decide the collection does not exist yet and create
  // their own.
  private writes: Promise<void>;

  constructor(
      private readonly put: (line: EditableLine) => Promise<void>,
      private readonly onFailure: (e: unknown) => void,
  ) {
    this.unsaved = new Set();
    this.writes = Promise.resolve();
  }

  save(lines: EditableLine[]): void {
    for (const line of lines) {
      this.unsaved.add(line);
    }
    this.flush();
  }

  /** Puts whatever is still unsaved, stopping at the first failure. */
  flush(): void {
    this.writes = this.writes.then(() => this.putUnsaved());
  }

  /** Forgets the unsaved lines, for when the collection they belong to closes. */
  clear(): void {
    this.unsaved.clear();
  }

  // Whatever fails one put usually fails the rest, and a login popup somebody closed would open
  // again for every line behind it, so a failure ends the run and the lines wait for the next
  // flush.
  private putUnsaved(): Promise<void> {
    const next = this.unsaved.values().next();
    if (next.done) {
      return Promise.resolve();
    }

    const line = next.value;
    return this.put(line).then(
        () => {
          this.unsaved.delete(line);
          return this.putUnsaved();
        },
        e => {
          this.onFailure(e);
        });
  }
}
