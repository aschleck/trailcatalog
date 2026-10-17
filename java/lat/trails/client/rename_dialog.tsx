import { checkExists } from 'external/dev_april_corgi+/js/common/asserts';
import { Future } from 'external/dev_april_corgi+/js/common/futures';
import * as corgi from 'external/dev_april_corgi+/js/corgi';
import { Controller, Response } from 'external/dev_april_corgi+/js/corgi/controller';
import { EmptyDeps } from 'external/dev_april_corgi+/js/corgi/deps';
import { CorgiEvent } from 'external/dev_april_corgi+/js/corgi/events';
import { ACTION, CHANGED, CLOSE } from 'external/dev_april_corgi+/js/emu/events';
import { Input } from 'external/dev_april_corgi+/js/emu/input';

import { Collection, RenameCollectionResponse } from 'trails_lat/proto/data_pb';

import { PrimaryButton, SecondaryButton, TEXT_BOX } from './controls';
import { requestData } from './data';

// DialogService#display resolves without a value, so the renamed collection comes back through a
// callback.
export function RenameDialog({collection, renamed}: {
  collection: Collection;
  renamed: (collection: Collection) => void;
}) {
  return <Rename collection={collection} renamed={renamed} />;
}

interface State {
  status: 'idle'|'saving'|'failed';
  name: string;
}

function Rename(
    {collection, renamed}: {collection: Collection; renamed: (collection: Collection) => void},
    inState: State|undefined,
    updateState: (newState: State) => void) {
  const state = inState ?? {status: 'idle', name: collection.name};

  return <>
    <div
        js={corgi.bind({
          controller: RenameController,
          args: {collectionId: collection.id, renamed},
          events: {
            render: 'wakeup',
          },
          state: [state, updateState],
        })}
        className="bg-white flex flex-col gap-3 p-4 rounded shadow-lg text-gray-900 w-[28rem]"
    >
      <div className="font-bold">Rename collection</div>
      <Input
          autofocus={true}
          className={TEXT_BOX}
          placeholder="Name"
          value={state.name}
          unboundEvents={{corgi: [[CHANGED, 'nameChanged'], [ACTION, 'saveClicked']]}}
      />
      {state.status === 'failed'
          ? <div className="text-red-700">Renaming failed</div>
          : ''
      }
      <div className="flex gap-2 justify-end">
        <SecondaryButton unboundEvents={{corgi: [[ACTION, 'dismiss']]}}>Cancel</SecondaryButton>
        <PrimaryButton unboundEvents={{corgi: [[ACTION, 'saveClicked']]}}>
          {state.status === 'saving' ? 'Saving' : 'Save'}
        </PrimaryButton>
      </div>
    </div>
  </>;
}

interface Args {
  collectionId: string;
  renamed: (collection: Collection) => void;
}

class RenameController extends Controller<Args, EmptyDeps, HTMLElement, State> {

  private readonly collectionId: string;
  private readonly renamed: (collection: Collection) => void;

  constructor(response: Response<RenameController>) {
    super(response);
    this.collectionId = response.args.collectionId;
    this.renamed = response.args.renamed;
  }

  nameChanged(e: CorgiEvent<typeof CHANGED>): void {
    this.updateState({...this.state, name: e.detail.value});
  }

  saveClicked(): void {
    const name = this.state.name.trim();
    if (this.state.status === 'saving' || !name) {
      return;
    }

    this.updateState({...this.state, status: 'saving'});
    const saved: Future<RenameCollectionResponse> =
        requestData('lat.trails.DataService/RenameCollection', {id: this.collectionId, name});
    saved
        .then(response => {
          this.renamed(checkExists(response.collection));
          this.trigger(CLOSE, {kind: 'resolve'});
        })
        .catch(e => {
          console.error(e);
          this.updateState({...this.state, status: 'failed'});
        });
  }

  dismiss(): void {
    this.trigger(CLOSE, {kind: 'reject'});
  }
}
