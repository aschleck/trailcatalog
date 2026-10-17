import { checkExists } from 'external/dev_april_corgi+/js/common/asserts';
import { Future } from 'external/dev_april_corgi+/js/common/futures';
import { Timer } from 'external/dev_april_corgi+/js/common/timer';
import * as corgi from 'external/dev_april_corgi+/js/corgi';
import { Controller, Response } from 'external/dev_april_corgi+/js/corgi/controller';
import { EmptyDeps } from 'external/dev_april_corgi+/js/corgi/deps';
import { CorgiEvent } from 'external/dev_april_corgi+/js/corgi/events';
import { Checkbox } from 'external/dev_april_corgi+/js/emu/checkbox';
import { ACTION, CHANGED } from 'external/dev_april_corgi+/js/emu/events';
import { Select } from 'external/dev_april_corgi+/js/emu/select';

import {
  CreateInviteResponse,
  GetSharingResponse,
  Grant,
  Invite,
  RevokeInviteResponse,
  Role,
  SetAnyoneCanViewResponse,
  SetGrantResponse,
  Sharing,
} from 'trails_lat/proto/data_pb';

import {
  LIST,
  PANEL,
  RemoveButton,
  SecondaryButton,
  Section,
  SELECT_BOX,
} from './controls';
import { requestData } from './data';

const DAY_S = 24 * 60 * 60;

const EXPIRY_OPTIONS: Array<{label: string; seconds: number|undefined}> = [
  {label: 'For 1 day', seconds: DAY_S},
  {label: 'For 7 days', seconds: 7 * DAY_S},
  {label: 'For 30 days', seconds: 30 * DAY_S},
  {label: 'Forever', seconds: undefined},
];

/** Edits who can open a collection. Every change saves as soon as it's made. */
export function SharingPanel(props: {collectionId: string; shown: boolean}) {
  return <SharingEditor {...props} />;
}

interface State {
  status: 'loading'|'loaded'|'unloadable';
  grants: Grant[];
  anyoneCanView: boolean;
  invites: Invite[];
  inviteRole: Role;
  // Undefined never expires.
  inviteExpirySeconds: number|undefined;
  creatingInvite: boolean;
  // The URL last copied, while its button says so
  copied: string|undefined;
  // What the last request that failed was doing
  error: string|undefined;
}

function SharingEditor(
    {collectionId, shown}: {collectionId: string; shown: boolean},
    inState: State|undefined,
    updateState: (newState: State) => void) {
  const state = inState ?? {
    status: 'loading',
    grants: [],
    anyoneCanView: false,
    invites: [],
    inviteRole: Role.READ,
    inviteExpirySeconds: 7 * DAY_S,
    creatingInvite: false,
    copied: undefined,
    error: undefined,
  };

  let body;
  if (state.status === 'loading') {
    body = <div className="py-8 text-center text-gray-500">Loading</div>;
  } else if (state.status === 'unloadable') {
    body =
        <div className="py-8 text-center text-red-700">Loading the sharing settings failed</div>;
  } else {
    body = <ShareForm collectionId={collectionId} state={state} />;
  }

  return <>
    <div
        js={corgi.bind({
          controller: ShareController,
          args: {collectionId},
          events: {
            render: 'wakeup',
          },
          state: [state, updateState],
        })}
        className={`${shown ? 'flex' : 'hidden'} ${PANEL}`}
    >
      {state.error ? <div className="text-red-700">{state.error}</div> : ''}
      {body}
    </div>
  </>;
}

function ShareForm({collectionId, state}: {collectionId: string; state: State}) {
  const row = 'flex gap-2 items-center px-3 py-2';
  return <>
    <Section label="People with access">
      <div className={LIST}>
        {state.grants.length === 0
            ? <div className="px-3 py-3 text-gray-500">
                Only you. Invite people with a link below.
              </div>
            : state.grants.map(grant =>
                <div className={row}>
                  <div className="flex flex-col grow min-w-0">
                    <span className="truncate">{grant.displayName}</span>
                    {grant.email
                        ? <span className="text-gray-500 text-xs truncate">{grant.email}</span>
                        : ''
                    }
                  </div>
                  <RoleSelect
                      data={{userId: grant.userId}}
                      role={grant.role}
                      unboundEvents={{corgi: [[CHANGED, 'roleChanged']]}}
                  />
                  <RemoveButton
                      data={{userId: grant.userId}}
                      label={`Stop sharing with ${grant.displayName}`}
                      unboundEvents={{corgi: [[ACTION, 'removeClicked']]}}
                  />
                </div>)
        }
      </div>
    </Section>
    <Section label="General access">
      <div className="flex gap-2 items-center justify-between">
        <Checkbox
            checked={state.anyoneCanView}
            className="select-none"
            unboundEvents={{corgi: [[ACTION, 'anyoneToggled']]}}
        >
          <span className="ms-2">Anyone with the link can view</span>
        </Checkbox>
        <SecondaryButton unboundEvents={{corgi: [[ACTION, 'copyLinkClicked']]}}>
          <CopyLabel copied={state.copied === collectionUrl(collectionId)} idle="Copy link" />
        </SecondaryButton>
      </div>
    </Section>
    <Section label="Invite links">
      {state.invites.length > 0
          ? <div className={LIST}>
              {state.invites.map(invite =>
                  <div className={row}>
                    <div className="flex flex-col grow min-w-0">
                      <span className="truncate">{inviteUrl(invite.code)}</span>
                      <span className="text-gray-500 text-xs">{describeInvite(invite)}</span>
                    </div>
                    <SecondaryButton
                        data={{code: invite.code}}
                        unboundEvents={{corgi: [[ACTION, 'copyInviteClicked']]}}
                    >
                      <CopyLabel copied={state.copied === inviteUrl(invite.code)} idle="Copy" />
                    </SecondaryButton>
                    <RemoveButton
                        data={{code: invite.code}}
                        label={`Revoke ${invite.code}`}
                        unboundEvents={{corgi: [[ACTION, 'revokeClicked']]}}
                    />
                  </div>)}
            </div>
          : ''
      }
      <div className="flex gap-2 items-center mt-1.5">
        <RoleSelect
            role={state.inviteRole}
            unboundEvents={{corgi: [[CHANGED, 'inviteRoleChanged']]}}
        />
        <Select
            ariaLabel="Expires"
            className={`${SELECT_BOX} grow`}
            options={EXPIRY_OPTIONS.map(({label, seconds}) => ({
              label,
              value: String(seconds ?? ''),
              selected: seconds === state.inviteExpirySeconds,
            }))}
            unboundEvents={{corgi: [[CHANGED, 'inviteExpiryChanged']]}}
        />
        <SecondaryButton unboundEvents={{corgi: [[ACTION, 'createInviteClicked']]}}>
          {state.creatingInvite ? 'Creating' : 'Create link'}
        </SecondaryButton>
      </div>
    </Section>
  </>;
}

// Holds the width of "Copied" either way, so the row doesn't shift when it flips.
function CopyLabel({copied, idle}: {copied: boolean; idle: string}) {
  return <>
    <span className="grid">
      <span className="[grid-area:1/1] invisible">Copied</span>
      <span className="[grid-area:1/1] invisible">{idle}</span>
      <span className="[grid-area:1/1] text-center">{copied ? 'Copied' : idle}</span>
    </span>
  </>;
}

function RoleSelect({role, ...props}: {role: Role} & corgi.Properties) {
  return (
    <Select
        ariaLabel="Role"
        className={`${SELECT_BOX} shrink-0 w-24`}
        options={[
          {label: 'Can view', value: String(Role.READ), selected: role === Role.READ},
          {label: 'Can edit', value: String(Role.WRITE), selected: role === Role.WRITE},
        ]}
        {...props}
    />
  );
}

function showing(sharing: Sharing): Pick<State, 'anyoneCanView'|'grants'|'invites'> {
  return {
    anyoneCanView: sharing.anyoneCanView,
    grants: sharing.grants,
    invites: sharing.invites,
  };
}

function collectionUrl(id: string): string {
  return `${window.location.origin}/collection/${id}`;
}

function inviteUrl(code: string): string {
  return `${window.location.origin}/i/${code}`;
}

function describeInvite(invite: Invite): string {
  return [
    invite.role === Role.WRITE ? 'Can edit' : 'Can view',
    invite.uses === 0 ? 'unused' : invite.uses === 1 ? 'used once' : `used ${invite.uses} times`,
    invite.expiresEpochMs === undefined
        ? 'never expires'
        : `expires in ${formatDuration(Number(invite.expiresEpochMs) - Date.now())}`,
  ].join(', ');
}

function formatDuration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) {
    return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  }
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

interface Args {
  collectionId: string;
}

class ShareController extends Controller<Args, EmptyDeps, HTMLElement, State> {

  private readonly collectionId: string;
  private readonly copiedReset: Timer;
  // Writes go out one at a time or else two changes to the same grant could land out of order.
  private writes: Promise<void>;
  private pendingWrites: number;
  // What the server last said it has, which a refused write leaves as it was
  private confirmed: Sharing|undefined;

  constructor(response: Response<ShareController>) {
    super(response);
    this.collectionId = response.args.collectionId;
    this.copiedReset = new Timer(2000 /* ms */, () => {
      this.copiedReset.stop();
      this.updateState({...this.state, copied: undefined});
    });
    this.registerDisposable(this.copiedReset);
    this.writes = Promise.resolve();
    this.pendingWrites = 0;
    this.confirmed = undefined;

    if (this.state.status === 'loading') {
      this.load();
    }
  }

  roleChanged(e: CorgiEvent<typeof CHANGED>): void {
    const userId = checkExists(e.actionElement.data('userId')).string();
    const role = Number(e.detail.value) as Role;
    this.updateState({
      ...this.state,
      grants: this.state.grants.map(g => g.userId === userId ? {...g, role} : g),
    });
    this.write(
        (): Future<SetGrantResponse> =>
            requestData('lat.trails.DataService/SetGrant', {
              collectionId: this.collectionId,
              userId,
              role,
            }),
        'Changing their access failed');
  }

  removeClicked(e: CorgiEvent<typeof ACTION>): void {
    const userId = checkExists(e.actionElement.data('userId')).string();
    this.updateState({
      ...this.state,
      grants: this.state.grants.filter(g => g.userId !== userId),
    });
    this.write(
        (): Future<SetGrantResponse> =>
            requestData('lat.trails.DataService/SetGrant', {
              collectionId: this.collectionId,
              userId,
              role: Role.UNSPECIFIED,
            }),
        'Removing them failed');
  }

  anyoneToggled(): void {
    const anyoneCanView = !this.state.anyoneCanView;
    this.updateState({...this.state, anyoneCanView});
    this.write(
        (): Future<SetAnyoneCanViewResponse> =>
            requestData('lat.trails.DataService/SetAnyoneCanView', {
              collectionId: this.collectionId,
              anyoneCanView,
            }),
        'Changing who can view failed');
  }

  copyLinkClicked(): void {
    this.copy(collectionUrl(this.collectionId));
  }

  copyInviteClicked(e: CorgiEvent<typeof ACTION>): void {
    this.copy(inviteUrl(checkExists(e.actionElement.data('code')).string()));
  }

  revokeClicked(e: CorgiEvent<typeof ACTION>): void {
    const code = checkExists(e.actionElement.data('code')).string();
    this.updateState({
      ...this.state,
      invites: this.state.invites.filter(invite => invite.code !== code),
    });
    this.write(
        (): Future<RevokeInviteResponse> =>
            requestData('lat.trails.DataService/RevokeInvite', {code}),
        'Revoking the invite failed');
  }

  inviteRoleChanged(e: CorgiEvent<typeof CHANGED>): void {
    this.updateState({...this.state, inviteRole: Number(e.detail.value) as Role});
  }

  inviteExpiryChanged(e: CorgiEvent<typeof CHANGED>): void {
    const value = e.detail.value;
    this.updateState({...this.state, inviteExpirySeconds: value ? Number(value) : undefined});
  }

  createInviteClicked(): void {
    if (this.state.creatingInvite) {
      return;
    }

    this.updateState({...this.state, creatingInvite: true});
    const {inviteRole, inviteExpirySeconds} = this.state;
    this.write(
        (): Future<CreateInviteResponse> =>
            requestData('lat.trails.DataService/CreateInvite', {
              collectionId: this.collectionId,
              role: inviteRole,
              expiresAfterSeconds:
                  inviteExpirySeconds === undefined ? undefined : BigInt(inviteExpirySeconds),
            }),
        'Creating the invite failed')
        .then(response => {
          this.updateState({...this.state, creatingInvite: false});
          if (response) {
            this.copy(inviteUrl(checkExists(response.invite).code));
          }
        });
  }

  private load(): void {
    const loading: Future<GetSharingResponse> =
        requestData('lat.trails.DataService/GetSharing', {collectionId: this.collectionId});
    loading
        .then(response => {
          this.confirmed = checkExists(response.sharing);
          this.updateState({...this.state, ...showing(this.confirmed), status: 'loaded'});
        })
        .catch(e => {
          console.error(e);
          this.updateState({...this.state, status: 'unloadable'});
        });
  }

  // Sends a change the state already shows. Once the queue drains we show what the server last
  // confirmed, which undoes whatever it refused. Answers undefined when the server refuses.
  private write<R extends {sharing?: Sharing}>(
      send: () => PromiseLike<R>, failure: string): Promise<R|undefined> {
    this.updateState({...this.state, error: undefined});
    this.pendingWrites += 1;
    const written = this.writes.then(send).then(
        response => {
          this.confirmed = checkExists(response.sharing);
          return response;
        },
        e => {
          console.error(e);
          this.updateState({...this.state, error: failure});
          return undefined;
        });
    this.writes = written.then(() => {
      this.pendingWrites -= 1;
      if (this.pendingWrites === 0) {
        this.updateState({...this.state, ...showing(checkExists(this.confirmed))});
      }
    });
    return written;
  }

  private copy(url: string): void {
    navigator.clipboard.writeText(url).then(
        () => {
          this.updateState({...this.state, copied: url});
          this.copiedReset.start();
        },
        e => {
          console.error(e);
        });
  }
}
