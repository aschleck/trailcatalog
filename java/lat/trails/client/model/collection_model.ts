import { checkExists } from 'external/dev_april_corgi+/js/common/asserts';
import { Future } from 'external/dev_april_corgi+/js/common/futures';
import { declareEvent } from 'external/dev_april_corgi+/js/corgi/events';
import { Model, ModelResponse } from 'external/dev_april_corgi+/js/corgi/model';
import {
  Collection,
  CreateCollectionResponse,
  GetCollectionResponse,
  GetCurrentUserResponse,
  SaveResponse,
} from 'trails_lat/proto/data_pb';

import { canEdit } from '../data/collection_data';
import { requestData } from '../data/data';
import { LoginService } from '../login/login_service';
import { FeatureStore } from './feature_store';
import { featuresFromProto, schemaToWrite, toWrite } from './features';
import { SaveEntry, SaveQueue } from './save_queue';
import { parseCollectionSchema } from './schema';

export const COLLECTION_CREATED = declareEvent<{collection: Collection}>('collectionCreated');
// The store already holds the response's features when this lands. Undefined when the load failed.
export const COLLECTION_LOADED =
    declareEvent<{response: GetCollectionResponse|undefined}>('collectionLoaded');
export const COLLECTION_LOADING = declareEvent<{}>('collectionLoading');
export const FEATURES_CHANGED = declareEvent<{}>('featuresChanged');
export const SAVE_FAILED = declareEvent<{}>('saveFailed');

type Deps = typeof CollectionModel.deps;

/**
 * Holds the collection the viewer has open: which one it is, its features, and their saves. It
 * creates a collection on the first save when the URL names none.
 */
export class CollectionModel extends Model<Deps> {

  static deps() {
    return {
      services: {
        login: LoginService,
      },
    };
  }

  readonly store: FeatureStore;
  private readonly login: LoginService;
  private readonly saves: SaveQueue;
  // The collection id from the URL, or the one we created
  private id: string|undefined;
  // Moves with every collection opened or loaded, so that a slow load of an earlier one is dropped
  private generation: number;
  // Settles once a new collection is created, so concurrent saves and uploads share one
  private creating: Promise<string>|undefined;

  constructor(response: ModelResponse<Deps>) {
    super(response);
    this.login = response.deps.services.login;
    this.saves =
        new SaveQueue(
            entries => this.save(entries),
            error => {
              console.error(error);
              this.broadcast(SAVE_FAILED, {});
            });
    // Read only until start, which knows whether a collection is loading into it
    this.store =
        new FeatureStore(
            this.saves,
            () => {
              this.broadcast(FEATURES_CHANGED, {});
            },
            /* readOnly= */ true);
    this.id = undefined;
    this.generation = 0;
    this.creating = undefined;
    this.registerDisposer(this.login.listen(response => {
      this.signedIn(response);
    }));
  }

  getGeneration(): number {
    return this.generation;
  }

  getId(): string|undefined {
    return this.id;
  }

  /**
   * Opens the collection the page rendered with. The store starts empty and read only, and a reset
   * would empty the rows the server rendered before the load replaces them.
   */
  start(id: string|undefined, load: boolean): void {
    this.id = id;
    if (id === undefined) {
      this.store.reset([], /* readOnly= */ false);
    } else if (load) {
      this.load(id);
    }
  }

  /** Empties the store and opens id, which is read only until it loads. */
  open(id: string|undefined): void {
    this.id = id;
    this.generation += 1;
    this.saves.clear();
    this.store.reset([], /* readOnly= */ id !== undefined);
    if (id !== undefined) {
      this.load(id);
    }
  }

  /** Returns the collection in the URL, even while it loads, or else creates one. */
  current(): Promise<string> {
    if (this.id !== undefined) {
      return Promise.resolve(this.id);
    }

    this.creating ??= this.login.requireLogin('save')
        .then(() => {
          const created: Future<CreateCollectionResponse> =
              requestData(
                  'lat.trails.DataService/CreateCollection', {
                    name: newCollectionName(),
                    schema: JSON.stringify(this.store.schema()),
                  });
          return created;
        })
        .then(response => {
          const collection = checkExists(response.collection);
          this.id = collection.id;
          this.broadcast(COLLECTION_CREATED, {collection});
          return collection.id;
        })
        .finally(() => {
          this.creating = undefined;
        });
    return this.creating;
  }

  private load(id: string): void {
    this.generation += 1;
    const generation = this.generation;
    this.broadcast(COLLECTION_LOADING, {});
    const loading: Future<GetCollectionResponse> =
        requestData('lat.trails.DataService/GetCollection', {id});
    loading
        .then(response => {
          if (generation !== this.generation) {
            return;
          }
          this.store.reset(
              featuresFromProto(response),
              !canEdit(response.collection),
              {schema: parseCollectionSchema(response.schema), version: response.schemaVersion});
          this.broadcast(COLLECTION_LOADED, {response});
        })
        .catch(e => {
          console.error(e);
          if (generation === this.generation) {
            this.broadcast(COLLECTION_LOADED, {response: undefined});
          }
        });
  }

  // Resolves with the version the server stamped onto the batch
  private save(entries: SaveEntry[]): Promise<bigint> {
    return this.current()
        .then(collectionId => {
          const saved: Future<SaveResponse> =
              requestData('lat.trails.DataService/Save', {
                collectionId,
                writes:
                    entries.map(e =>
                        e.kind === 'schema'
                            ? schemaToWrite(e.schema)
                            : toWrite(e.op, e.feature)),
              });
          return saved;
        })
        .then(response => response.version);
  }

  // Somebody who signed in may have edit rights to a collection they could only view, so we reload
  // it, or else retry the saves that were waiting on the login.
  private signedIn(response: GetCurrentUserResponse): void {
    if (!response.user) {
      return;
    }

    if (this.id !== undefined && this.store.isReadOnly()) {
      this.load(this.id);
    } else {
      this.saves.flush();
    }
  }
}

function newCollectionName(): string {
  return `Untitled collection ${new Date().toLocaleDateString()}`;
}
