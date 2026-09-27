import { checkExists } from 'external/dev_april_corgi+/js/common/asserts';
import { Future } from 'external/dev_april_corgi+/js/common/futures';
import * as corgi from 'external/dev_april_corgi+/js/corgi';
import { Controller, Response } from 'external/dev_april_corgi+/js/corgi/controller';
import { EmptyDeps } from 'external/dev_april_corgi+/js/corgi/deps';
import { CorgiEvent } from 'external/dev_april_corgi+/js/corgi/events';
import { Button } from 'external/dev_april_corgi+/js/emu/button';
import { Checkbox } from 'external/dev_april_corgi+/js/emu/checkbox';
import { ACTION, CHANGED, CLOSE } from 'external/dev_april_corgi+/js/emu/events';
import { Input } from 'external/dev_april_corgi+/js/emu/input';
import { Select } from 'external/dev_april_corgi+/js/emu/select';

import {
  Collection,
  GetSharingResponse,
  Role,
  SetSharingResponse,
} from 'trails_lat/proto/data_pb';

import { requestData } from './data';

/** Edits who can open a collection and saves it before closing. */
export function ShareDialog({collection}: {collection: Collection}) {
  return <Share collection={collection} />;
}

interface GrantRow {
  email: string;
  role: Role;
}

interface State {
  status: 'loading'|'idle'|'saving'|'failed';
  anyoneCanView: boolean;
  grants: GrantRow[];
  draftEmail: string;
  draftRole: Role;
  // The emails the last save found no account for
  unknown: string[];
  copied: boolean;
}

function Share(
    {collection}: {collection: Collection},
    inState: State|undefined,
    updateState: (newState: State) => void) {
  const state = inState ?? {
    status: 'loading',
    anyoneCanView: false,
    grants: [],
    draftEmail: '',
    draftRole: Role.READ,
    unknown: [],
    copied: false,
  };

  return <>
    <div
        js={corgi.bind({
          controller: ShareController,
          args: {collectionId: collection.id},
          events: {
            render: 'wakeup',
          },
          state: [state, updateState],
        })}
        className="bg-white flex flex-col gap-3 p-4 rounded shadow-lg text-gray-900 w-[28rem]"
    >
      <div className="flex font-bold gap-4 items-start justify-between">
        {`Share ${collection.name}`}
        <Button ariaLabel="Close" unboundEvents={{corgi: [[ACTION, 'dismiss']]}}>
          <svg className="h-4 stroke-current w-4" viewBox="0 0 12 12">
            <path d="M0 0 L12 12 M0 12 L12 0" />
          </svg>
        </Button>
      </div>
      {state.status === 'loading'
          ? <div className="text-gray-500">Loading</div>
          : <ShareForm state={state} />
      }
    </div>
  </>;
}

// Rendered only once the sharing loads, because Checkbox keeps the checked it first rendered with.
function ShareForm({state}: {state: State}) {
  const unknown = new Set(state.unknown);
  return <>
    <div className="flex flex-col gap-3">
      <Checkbox
          checked={state.anyoneCanView}
          className="select-none"
          unboundEvents={{corgi: [[ACTION, 'anyoneToggled']]}}
      >
        <span className="ml-2">Anyone with the link can view</span>
      </Checkbox>
      <div className="flex flex-col gap-1">
        {state.grants.map((grant, i) =>
            <div className="flex gap-2 items-center">
              <span
                  className={
                    'grow min-w-0 truncate' + (unknown.has(grant.email) ? ' text-red-700' : '')
                  }
              >
                {grant.email}
              </span>
              <RoleSelect
                  data={{index: i}}
                  role={grant.role}
                  unboundEvents={{corgi: [[CHANGED, 'roleChanged']]}}
              />
              <Button
                  ariaLabel={`Stop sharing with ${grant.email}`}
                  className="hover:bg-black/10 p-1 rounded"
                  data={{index: i}}
                  unboundEvents={{corgi: [[ACTION, 'removeClicked']]}}
              >
                <svg className="h-3 stroke-current w-3" viewBox="0 0 12 12">
                  <path d="M1 1 L11 11 M1 11 L11 1" strokeWidth="1.5" />
                </svg>
              </Button>
            </div>
        )}
      </div>
      <div className="flex gap-2 items-center">
        <Input
            className="border border-gray-300 grow min-w-0 px-1 rounded"
            forceValue={true}
            placeholder="Email"
            type="email"
            value={state.draftEmail}
            unboundEvents={{corgi: [[CHANGED, 'draftChanged'], [ACTION, 'addClicked']]}}
        />
        <RoleSelect
            role={state.draftRole}
            unboundEvents={{corgi: [[CHANGED, 'draftRoleChanged']]}}
        />
        <Button
            className="hover:bg-black/10 px-2 py-1 rounded"
            unboundEvents={{corgi: [[ACTION, 'addClicked']]}}
        >
          Add
        </Button>
      </div>
      {state.unknown.length > 0
          ? <div className="text-red-700">
              {`No trails.lat account for ${state.unknown.join(', ')}`}
            </div>
          : ''
      }
      {state.status === 'failed'
          ? <div className="text-red-700">Saving failed</div>
          : ''
      }
      <div className="flex gap-2 items-center">
        <Button
            className="hover:bg-black/10 px-3 py-1 rounded"
            unboundEvents={{corgi: [[ACTION, 'copyLinkClicked']]}}
        >
          {state.copied ? 'Copied' : 'Copy link'}
        </Button>
        <div className="grow" />
        <Button
            className="hover:bg-black/10 px-3 py-1 rounded"
            unboundEvents={{corgi: [[ACTION, 'dismiss']]}}
        >
          Cancel
        </Button>
        <Button
            className="bg-gray-900 hover:bg-gray-800 px-3 py-1 rounded text-white"
            unboundEvents={{corgi: [[ACTION, 'saveClicked']]}}
        >
          {state.status === 'saving' ? 'Saving' : 'Save'}
        </Button>
      </div>
    </div>
  </>;
}

function RoleSelect({role, ...props}: {role: Role} & corgi.Properties) {
  return (
    <Select
        ariaLabel="Role"
        className="border border-gray-300 rounded shrink-0 w-24"
        options={[
          {label: 'Can view', value: String(Role.READ), selected: role === Role.READ},
          {label: 'Can edit', value: String(Role.WRITE), selected: role === Role.WRITE},
        ]}
        {...props}
    />
  );
}

interface Args {
  collectionId: string;
}

class ShareController extends Controller<Args, EmptyDeps, HTMLElement, State> {

  private readonly collectionId: string;

  constructor(response: Response<ShareController>) {
    super(response);
    this.collectionId = response.args.collectionId;

    if (this.state.status === 'loading') {
      const loading: Future<GetSharingResponse> =
          requestData('lat.trails.DataService/GetSharing', {collectionId: this.collectionId});
      loading
          .then(response => {
            const sharing = checkExists(response.sharing);
            this.updateState({
              ...this.state,
              status: 'idle',
              anyoneCanView: sharing.anyoneCanView,
              grants: sharing.grants.map(({email, role}) => ({email, role})),
            });
          })
          .catch(e => {
            console.error(e);
            this.updateState({...this.state, status: 'failed'});
          });
    }
  }

  anyoneToggled(): void {
    this.updateState({...this.state, anyoneCanView: !this.state.anyoneCanView});
  }

  roleChanged(e: CorgiEvent<typeof CHANGED>): void {
    const index = checkExists(e.actionElement.data('index')).number();
    const grants = [...this.state.grants];
    grants[index] = {...grants[index], role: Number(e.detail.value) as Role};
    this.updateState({...this.state, grants});
  }

  removeClicked(e: CorgiEvent<typeof ACTION>): void {
    const index = checkExists(e.actionElement.data('index')).number();
    this.updateState({...this.state, grants: this.state.grants.filter((_, i) => i !== index)});
  }

  draftChanged(e: CorgiEvent<typeof CHANGED>): void {
    this.updateState({...this.state, draftEmail: e.detail.value});
  }

  draftRoleChanged(e: CorgiEvent<typeof CHANGED>): void {
    this.updateState({...this.state, draftRole: Number(e.detail.value) as Role});
  }

  // Adding an email already listed changes its role, because the server refuses duplicates.
  addClicked(): void {
    const email = this.state.draftEmail.trim().toLowerCase();
    if (!email) {
      return;
    }

    const grants = this.state.grants.filter(g => g.email !== email);
    grants.push({email, role: this.state.draftRole});
    this.updateState({...this.state, grants, draftEmail: ''});
  }

  copyLinkClicked(): void {
    const url = `${window.location.origin}/collection/${this.collectionId}`;
    navigator.clipboard.writeText(url).then(
        () => {
          this.updateState({...this.state, copied: true});
        },
        e => {
          console.error(e);
        });
  }

  // Takes an email left in the box too, because leaving it unadded and clicking Save looks the same
  // as adding it.
  saveClicked(): void {
    if (this.state.status === 'saving') {
      return;
    }
    this.addClicked();

    this.updateState({...this.state, status: 'saving', unknown: []});
    const saved: Future<SetSharingResponse> =
        requestData('lat.trails.DataService/SetSharing', {
          collectionId: this.collectionId,
          sharing: {
            anyoneCanView: this.state.anyoneCanView,
            grants: this.state.grants,
          },
        });
    saved
        .then(response => {
          if (response.unknownEmails.length > 0) {
            this.updateState({...this.state, status: 'idle', unknown: response.unknownEmails});
          } else {
            this.trigger(CLOSE, {kind: 'resolve'});
          }
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
