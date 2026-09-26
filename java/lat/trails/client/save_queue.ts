import { EditableFeature, SaveOp } from './features';

export interface SaveEntry {
  feature: EditableFeature;
  op: SaveOp;
}

/** Saves features to the server in batches, holding each write until a batch carrying it lands. */
export class SaveQueue {

  // One entry per feature, the last write to it. Ordered by when that write happened, which a Map
  // iterates in once we reinsert on every write, so a folder's delete follows its children's.
  private readonly unsaved: Map<string, SaveEntry>;
  // Serialized so that two saves cannot each decide the collection does not exist yet and create
  // their own.
  private writes: Promise<void>;

  constructor(
      // Resolves with the version the server stamped onto the batch
      private readonly save: (entries: SaveEntry[]) => Promise<bigint>,
      private readonly onFailure: (e: unknown) => void,
  ) {
    this.unsaved = new Map();
    this.writes = Promise.resolve();
  }

  write(op: SaveOp, features: EditableFeature[]): void {
    for (const feature of features) {
      this.unsaved.delete(feature.id);
      this.unsaved.set(feature.id, {feature, op});
    }
    this.flush();
  }

  /** Saves whatever is still unsaved. */
  flush(): void {
    this.writes = this.writes.then(() => this.saveUnsaved());
  }

  /** Forgets the unsaved features, for when the collection they belong to closes. */
  clear(): void {
    this.unsaved.clear();
  }

  // A failed batch stays queued for the next flush rather than retrying here, because whatever
  // failed it usually fails the retry too, and a login popup somebody closed would open again.
  private saveUnsaved(): Promise<void> {
    if (this.unsaved.size === 0) {
      return Promise.resolve();
    }

    const batch = [...this.unsaved.values()];
    return this.save(batch).then(
        version => {
          for (const entry of batch) {
            entry.feature.version = version;
            // A feature written again while the batch was in flight has a newer entry, which
            // still needs saving.
            if (this.unsaved.get(entry.feature.id) === entry) {
              this.unsaved.delete(entry.feature.id);
            }
          }
          return this.saveUnsaved();
        },
        e => {
          this.onFailure(e);
        });
  }
}
