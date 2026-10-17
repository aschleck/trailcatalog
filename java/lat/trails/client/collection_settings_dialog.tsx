import { checkExists } from 'external/dev_april_corgi+/js/common/asserts';
import { Future } from 'external/dev_april_corgi+/js/common/futures';
import { Timer } from 'external/dev_april_corgi+/js/common/timer';
import * as corgi from 'external/dev_april_corgi+/js/corgi';
import { Controller, Response } from 'external/dev_april_corgi+/js/corgi/controller';
import { EmptyDeps } from 'external/dev_april_corgi+/js/corgi/deps';
import { CorgiEvent, DOM_MOUSE } from 'external/dev_april_corgi+/js/corgi/events';
import { Button } from 'external/dev_april_corgi+/js/emu/button';
import { ACTION, CHANGED, CLOSE } from 'external/dev_april_corgi+/js/emu/events';
import { Input } from 'external/dev_april_corgi+/js/emu/input';

import { Collection, Role, UpdateCollectionResponse } from 'trails_lat/proto/data_pb';

import { descriptionOf } from './collection_data';
import {
  DangerButton,
  PANEL,
  PanelCloseButton,
  PrimaryButton,
  Section,
  TEXT_BOX,
} from './controls';
import { requestData } from './data';
import { SchemaPanel } from './schema_panel';
import { CollectionSchema } from './schema';
import { SharingPanel } from './sharing_panel';

export type SettingsPanel = 'overview'|'sharing'|'schema'|'style';

const PANEL_LABELS: {[panel in SettingsPanel]: string} = {
  overview: 'Overview',
  sharing: 'Sharing',
  schema: 'Schema',
  style: 'Style',
};

export function CollectionSettingsDialog(props: {
  collection: Collection;
  editable: boolean;
  panel: SettingsPanel;
  schema: CollectionSchema;
  onDelete: () => Promise<boolean>;
  onSchemaChanged: (schema: CollectionSchema) => void;
  onUpdated: (collection: Collection) => void;
}) {
  return <Settings {...props} />;
}

interface State {
  panel: SettingsPanel;
}

// Every panel stays rendered while hidden so that switching away keeps its state, and so that
// sharing writes still in flight finish against a live controller.
function Settings(
    {collection, editable, panel, schema, onDelete, onSchemaChanged, onUpdated}: {
      collection: Collection;
      editable: boolean;
      panel: SettingsPanel;
      schema: CollectionSchema;
      onDelete: () => Promise<boolean>;
      onSchemaChanged: (schema: CollectionSchema) => void;
      onUpdated: (collection: Collection) => void;
    },
    inState: State|undefined,
    updateState: (newState: State) => void) {
  const sharing = collection.role === Role.OWNER;
  const panels: SettingsPanel[] = [
    'overview',
    ...(sharing ? ['sharing' as const] : []),
    ...(editable ? ['schema' as const, 'style' as const] : []),
  ];
  const state = inState ?? {panel: panels.includes(panel) ? panel : 'overview'};

  return <>
    <div
        js={corgi.bind({
          controller: SettingsController,
          args: {},
          state: [state, updateState],
        })}
        className="
            bg-white
            flex
            flex-col
            h-[36rem]
            max-h-[85vh]
            max-w-[calc(100vw-2rem)]
            overflow-hidden
            rounded-lg
            shadow-xl
            sm:flex-row
            text-gray-900
            text-sm
            w-[46rem]
        "
    >
      <div
          className="
              bg-gray-50
              border-b
              border-gray-200
              flex
              gap-0.5
              overflow-x-auto
              p-2
              shrink-0
              sm:border-b-0
              sm:border-e
              sm:flex-col
              sm:w-44
          "
      >
        <div
            className="
                font-semibold
                hidden
                pb-2
                pt-1
                px-2
                sm:block
                text-gray-500
                text-xs
                tracking-wide
                uppercase
            "
        >
          Settings
        </div>
        {panels.map(p => <NavButton panel={p} selected={p === state.panel} />)}
      </div>
      <div className="flex flex-col grow min-h-0 min-w-0">
        <div className="flex gap-4 items-center justify-between pe-3 ps-5 pt-3">
          <span className="font-semibold text-base truncate">{PANEL_LABELS[state.panel]}</span>
          <PanelCloseButton unboundEvents={{corgi: [[ACTION, 'dismiss']]}} />
        </div>
        <OverviewPanel
            collection={collection}
            editable={editable}
            shown={state.panel === 'overview'}
            onDelete={onDelete}
            onUpdated={onUpdated}
        />
        {sharing
            ? <SharingPanel collectionId={collection.id} shown={state.panel === 'sharing'} />
            : ''
        }
        {editable
            ? <SchemaPanel
                  schema={schema}
                  shown={state.panel === 'schema' || state.panel === 'style'}
                  styling={state.panel === 'style'}
                  onChanged={onSchemaChanged}
              />
            : ''
        }
        <div className="border-gray-200 border-t flex justify-end px-5 py-3">
          <PrimaryButton unboundEvents={{corgi: [[ACTION, 'dismiss']]}}>Done</PrimaryButton>
        </div>
      </div>
    </div>
  </>;
}

function NavButton({panel, selected}: {panel: SettingsPanel; selected: boolean}) {
  return (
    <Button
        ariaLabel={PANEL_LABELS[panel]}
        className={
          'active:bg-black/10 cursor-pointer px-2 py-1.5 rounded shrink-0 text-start '
              + (selected ? 'bg-black/5 font-semibold' : 'hover:bg-black/5 text-gray-600')
        }
        data={{panel}}
        unboundEvents={{corgi: [[ACTION, 'panelClicked']]}}
    >
      {PANEL_LABELS[panel]}
    </Button>
  );
}

class SettingsController extends Controller<{}, EmptyDeps, HTMLElement, State> {

  panelClicked(e: CorgiEvent<typeof ACTION>): void {
    const panel = checkExists(e.actionElement.data('panel')).string() as SettingsPanel;
    this.updateState({...this.state, panel});
  }

  dismiss(): void {
    this.trigger(CLOSE, {kind: 'resolve'});
  }
}

interface OverviewState {
  name: string;
  description: string;
  error: string|undefined;
}

function OverviewPanel(
    {collection, editable, shown, onDelete, onUpdated}: {
      collection: Collection;
      editable: boolean;
      shown: boolean;
      onDelete: () => Promise<boolean>;
      onUpdated: (collection: Collection) => void;
    },
    inState: OverviewState|undefined,
    updateState: (newState: OverviewState) => void) {
  const state = inState ?? {
    name: collection.name,
    description: descriptionOf(collection),
    error: undefined,
  };

  return <>
    <div
        js={corgi.bind({
          controller: OverviewController,
          args: {collectionId: collection.id, onDelete, onUpdated},
          events: {
            render: 'wakeup',
          },
          state: [state, updateState],
        })}
        className={`${shown ? 'flex' : 'hidden'} ${PANEL}`}
    >
      {state.error ? <div className="text-red-700">{state.error}</div> : ''}
      <Section label="Name">
        {editable
            ? <Input
                  className={TEXT_BOX}
                  placeholder="Name"
                  value={state.name}
                  unboundEvents={{
                    corgi: [[CHANGED, 'nameChanged'], [ACTION, 'flush']],
                    focusout: 'flush',
                  }}
              />
            : <div>{state.name}</div>
        }
      </Section>
      <Section label="Description">
        {editable
            ? <textarea
                  className="
                      border
                      border-gray-300
                      focus:border-blue-500
                      min-h-32
                      outline-none
                      px-2
                      py-1
                      resize-y
                      rounded
                  "
                  placeholder="What this collection is for"
                  value={state.description}
                  unboundEvents={{focusout: 'flush', input: 'descriptionInput'}}
              />
            : <div className={`whitespace-pre-wrap ${state.description ? '' : 'text-gray-500'}`}>
                {state.description || 'No description'}
              </div>
        }
      </Section>
      {collection.role === Role.OWNER
          ? <Section label="Delete">
              <div className="flex">
                <DangerButton
                    className="shrink-0"
                    unboundEvents={{corgi: [[ACTION, 'deleteClicked']]}}
                >
                  Delete collection
                </DangerButton>
              </div>
            </Section>
          : ''
      }
    </div>
  </>;
}

interface OverviewArgs {
  collectionId: string;
  onDelete: () => Promise<boolean>;
  onUpdated: (collection: Collection) => void;
}

// Closing the dialog removes it without disposing its controllers, so a pending save still fires.
class OverviewController extends Controller<OverviewArgs, EmptyDeps, HTMLElement, OverviewState> {

  private readonly collectionId: string;
  private readonly onDelete: () => Promise<boolean>;
  private readonly onUpdated: (collection: Collection) => void;
  private readonly idle: Timer;
  // Writes go out one at a time or else an older name could land after a newer one.
  private writes: Promise<void>;
  private sent: {name: string; description: string};
  private confirmed: {name: string; description: string};

  constructor(response: Response<OverviewController>) {
    super(response);
    this.collectionId = response.args.collectionId;
    this.onDelete = response.args.onDelete;
    this.onUpdated = response.args.onUpdated;
    this.idle = new Timer(1000 /* ms */, () => {
      this.flush();
    });
    this.registerDisposable(this.idle);
    this.writes = Promise.resolve();
    this.sent = {name: this.state.name, description: this.state.description};
    this.confirmed = this.sent;
  }

  nameChanged(e: CorgiEvent<typeof CHANGED>): void {
    this.updateState({...this.state, name: e.detail.value});
    this.idle.start();
  }

  descriptionInput(e: CorgiEvent<typeof DOM_MOUSE>): void {
    const description = (e.actionElement.element() as HTMLTextAreaElement).value;
    this.updateState({...this.state, description});
    this.idle.start();
  }

  deleteClicked(): void {
    this.onDelete().then(deleted => {
      if (deleted) {
        this.trigger(CLOSE, {kind: 'resolve'});
      }
    });
  }

  flush(): void {
    this.idle.stop();
    const name = this.state.name.trim();
    const description = this.state.description;
    this.updateState({...this.state, error: name ? undefined : 'A collection needs a name'});
    const nameChanged = !!name && name !== this.sent.name;
    const descriptionChanged = description !== this.sent.description;
    if (!nameChanged && !descriptionChanged) {
      return;
    }

    const target = {name: nameChanged ? name : this.sent.name, description};
    this.sent = target;
    this.writes = this.writes
        .then((): Future<UpdateCollectionResponse> =>
            requestData('lat.trails.DataService/UpdateCollection', {
              id: this.collectionId,
              name: nameChanged ? name : undefined,
              data: descriptionChanged ? JSON.stringify({description: description || null}) : '',
            }))
        .then(
            response => {
              this.confirmed = target;
              this.onUpdated(checkExists(response.collection));
            },
            e => {
              console.error(e);
              this.sent = this.confirmed;
              this.updateState({...this.state, error: 'Saving failed'});
            });
  }
}
