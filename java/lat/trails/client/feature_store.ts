import {
  EditableFeature,
  EditableFolder,
  EditableLine,
  EditablePoint,
  EditablePolygon,
  snapshot,
} from './features';
import { SaveQueue } from './save_queue';
import { DEFAULT_COLLECTION_SCHEMA, SavedSchema } from './schema';
import { CollectionSchema } from './workers/collection_schema';

// An edit, which undo reverts as a unit. Edits sharing a merge key in a row become one, so typing
// a name is one undo rather than one per keystroke.
interface Edit {
  changes: Change[];
  schema: {before: CollectionSchema; after: CollectionSchema}|undefined;
  mergeKey: string|undefined;
}

// One feature's side of an edit. An undefined state is a feature that does not exist, so a change
// from undefined creates and a change to undefined deletes.
export interface Change {
  id: string;
  before: EditableFeature|undefined;
  after: EditableFeature|undefined;
}

/**
 * Holds the open collection's features, saves every change to them, and undoes and redoes edits.
 *
 * States in a Change are copies, never the live feature, because the live one carries the
 * version the server last stamped on it and an undo has to put back with that version rather than
 * the one the feature had when the edit was made.
 */
export class FeatureStore {

  private readonly live: Map<string, EditableFeature>;
  // Deleted features, kept so that undoing the delete puts at the version the delete landed at.
  private readonly removed: Map<string, EditableFeature>;
  private savedSchema: SavedSchema;
  private readonly undoStack: Edit[];
  private readonly redoStack: Edit[];
  private readonly listeners: Array<() => void>;
  // Set for a collection shared with the user to view, where every edit would fail to save.
  private readOnly: boolean;
  // Moves on every change so that readers can tell whether they are stale.
  generation: number;

  constructor(private readonly saves: SaveQueue) {
    this.live = new Map();
    this.removed = new Map();
    this.savedSchema = {schema: DEFAULT_COLLECTION_SCHEMA, version: 0n};
    this.undoStack = [];
    this.redoStack = [];
    this.listeners = [];
    this.readOnly = false;
    this.generation = 0;
  }

  listen(listener: () => void): void {
    this.listeners.push(listener);
  }

  /**
   * Replaces every feature without saving, for opening a collection or starting a new one. A
   * read only store drops every edit.
   */
  reset(
      features: EditableFeature[],
      readOnly: boolean,
      schema: SavedSchema = {schema: DEFAULT_COLLECTION_SCHEMA, version: 0n}): void {
    this.readOnly = readOnly;
    this.savedSchema = schema;
    this.live.clear();
    this.removed.clear();
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    for (const feature of features) {
      this.live.set(feature.id, feature);
    }
    this.changed();
  }

  isReadOnly(): boolean {
    return this.readOnly;
  }

  schema(): CollectionSchema {
    return this.savedSchema.schema;
  }

  get(id: string): EditableFeature|undefined {
    return this.live.get(id);
  }

  all(): IterableIterator<EditableFeature> {
    return this.live.values();
  }

  folders(): EditableFolder[] {
    return this.ofKind('folder');
  }

  lines(): EditableLine[] {
    return this.ofKind('line');
  }

  points(): EditablePoint[] {
    return this.ofKind('point');
  }

  polygons(): EditablePolygon[] {
    return this.ofKind('polygon');
  }

  /** Returns the features directly inside a folder, or at the root for undefined. */
  children(folderId: string|undefined): EditableFeature[] {
    const children = [];
    for (const feature of this.live.values()) {
      if (this.parentOf(feature) === folderId) {
        children.push(feature);
      }
    }
    return children;
  }

  /** Returns everything under a folder, deepest first, so deleting in order empties each folder. */
  descendants(folderId: string): EditableFeature[] {
    const descendants = [];
    for (const child of this.children(folderId)) {
      if (child.kind === 'folder') {
        descendants.push(...this.descendants(child.id));
      }
      descendants.push(child);
    }
    return descendants;
  }

  // A folder_id naming a folder that is gone puts the feature at the root, or else it would
  // vanish from the list with nothing to open to find it. Keep in sync with
  // feature_list.tsx#buildTree.
  parentOf(feature: EditableFeature): string|undefined {
    const parent = feature.data.folder_id;
    return parent !== undefined && this.live.get(parent)?.kind === 'folder' ? parent : undefined;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /**
   * Applies one edit, which undo reverts as a unit. An edit with the same merge key as the one
   * before it folds into that one, keeping its before states.
   */
  apply(changes: Change[], mergeKey?: string): void {
    if (changes.length === 0) {
      return;
    }
    this.record({changes, schema: undefined, mergeKey});
  }

  /** Replaces the schema as one edit, merging like apply. */
  setSchema(after: CollectionSchema, mergeKey?: string): void {
    this.record({changes: [], schema: {before: this.savedSchema.schema, after}, mergeKey});
  }

  private record(edit: Edit): void {
    if (this.readOnly) {
      return;
    }

    const last = this.undoStack[this.undoStack.length - 1];
    if (edit.mergeKey !== undefined
        && last?.mergeKey === edit.mergeKey
        && this.redoStack.length === 0) {
      for (const change of edit.changes) {
        const existing = last.changes.find(c => c.id === change.id);
        if (existing) {
          existing.after = change.after;
        } else {
          last.changes.push(change);
        }
      }
      if (edit.schema) {
        last.schema = {before: last.schema?.before ?? edit.schema.before, after: edit.schema.after};
      }
    } else {
      this.undoStack.push(edit);
    }
    this.redoStack.length = 0;
    this.commit(edit, 'forward');
  }

  undo(): void {
    const edit = this.undoStack.pop();
    if (!edit) {
      return;
    }

    // Undone edits never merge again, or else redoing and then typing would fold into a stale edit.
    edit.mergeKey = undefined;
    this.redoStack.push(edit);
    this.commit(edit, 'backward');
  }

  redo(): void {
    const edit = this.redoStack.pop();
    if (!edit) {
      return;
    }

    this.undoStack.push(edit);
    this.commit(edit, 'forward');
  }

  // Backward runs the changes in reverse, so undoing a folder delete that emptied the folder
  // first puts the folder back before its children, and undoing an import deletes the children
  // before their folders.
  private commit(edit: Edit, direction: 'backward'|'forward'): void {
    if (edit.schema) {
      this.savedSchema.schema = direction === 'forward' ? edit.schema.after : edit.schema.before;
      this.saves.writeSchema(this.savedSchema);
    }
    const ordered = direction === 'forward' ? edit.changes : [...edit.changes].reverse();
    for (const change of ordered) {
      const state = direction === 'forward' ? change.after : change.before;
      if (state) {
        const feature = this.live.get(change.id) ?? this.removed.get(change.id);
        const version = feature?.version ?? 0n;
        const restored = Object.assign(feature ?? {}, snapshot(state), {version});
        this.removed.delete(change.id);
        this.live.set(change.id, restored);
        this.saves.write('put', [restored]);
      } else {
        const feature = this.live.get(change.id);
        if (!feature) {
          continue;
        }

        this.live.delete(change.id);
        this.removed.set(change.id, feature);
        this.saves.write('delete', [feature]);
      }
    }
    this.changed();
  }

  private ofKind<K extends EditableFeature['kind']>(kind: K):
      Array<Extract<EditableFeature, {kind: K}>> {
    const matching = [];
    for (const feature of this.live.values()) {
      if (feature.kind === kind) {
        matching.push(feature as Extract<EditableFeature, {kind: K}>);
      }
    }
    return matching;
  }

  private changed(): void {
    this.generation += 1;
    for (const listener of this.listeners) {
      listener();
    }
  }
}
