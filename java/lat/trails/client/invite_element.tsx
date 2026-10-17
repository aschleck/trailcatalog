import { Future } from 'external/dev_april_corgi+/js/common/futures';
import * as corgi from 'external/dev_april_corgi+/js/corgi';
import { Controller, Response } from 'external/dev_april_corgi+/js/corgi/controller';
import { HistoryService } from 'external/dev_april_corgi+/js/corgi/history/history_service';
import { DataRequestError } from 'external/dev_april_corgi+/js/data/requestor';
import { ACTION } from 'external/dev_april_corgi+/js/emu/events';
import {
  redirectTo,
  setIndexable,
  setStatusCode,
  setTitle,
} from 'external/dev_april_corgi+/js/server/ssr_aware';

import {
  AcceptInviteResponse,
  GetCurrentUserResponse,
  GetInviteResponse,
  Role,
} from 'trails_lat/proto/data_pb';

import { PrimaryButton } from './controls';
import { requestData } from './data';

interface State {
  invite: Future<GetInviteResponse>;
  status: 'idle'|'accepting'|'failed';
}

export function InviteElement(
    {acceptToken, code}: {acceptToken: string|undefined; code: string},
    inState: State|undefined,
    updateState: (newState: State) => void) {
  if (!inState) {
    const invite: Future<GetInviteResponse> =
        requestData('lat.trails.DataService/GetInvite', {code});
    inState = {invite, status: acceptToken === undefined ? 'idle' : 'accepting'};
    if (!invite.finished) {
      // The future settles in place, so rendering again is enough.
      const settling = inState;
      invite.finally(() => {
        updateState({...settling});
      });
    }
  }
  const state = inState;
  setIndexable(false);

  if (!state.invite.finished) {
    setTitle('trails.lat');
    return <><div className="p-4 text-gray-500">Loading</div></>;
  }

  if (!state.invite.ok) {
    const error = state.invite.error();
    setStatusCode(error instanceof DataRequestError ? error.code : 500);
    setTitle('Invalid invite - trails.lat');
    return <>
      <div className="p-4">
        <p>This invite is invalid or has expired.</p>
        <p><a href="/">Back to the map</a></p>
      </div>
    </>;
  }

  const invite = state.invite.value();
  setTitle(`Join ${invite.collectionName} - trails.lat`);
  const hasAccess = invite.currentRole >= invite.role;
  if (hasAccess && acceptToken !== undefined) {
    redirectTo(`/collection/${invite.collectionId}`);
    return <><div className="p-4 text-gray-500">Loading</div></>;
  }
  return <>
    <div
        js={corgi.bind({
          controller: InviteController,
          args: {acceptToken, code},
          events: {
            render: 'wakeup',
          },
          state: [state, updateState],
        })}
        className="flex flex-col gap-6 h-full items-center justify-center p-4"
    >
      <img alt="trails.lat" className="h-16" src="/static/cat_moon_dark.webp" />
      <div
          className="
              bg-white
              flex
              flex-col
              gap-3
              max-w-full
              p-4
              rounded
              shadow-lg
              text-gray-900
              w-[24rem]
          "
      >
        <div className="text-gray-500">
          {`${invite.inviterName} invited you to ${invite.role === Role.WRITE ? 'edit' : 'view'}`}
        </div>
        <div className="font-bold text-lg">{invite.collectionName}</div>
        {state.status === 'failed'
            ? <div className="text-red-700">Accepting the invite failed</div>
            : ''
        }
        {hasAccess
            ? <div className="text-gray-500">You already have access.</div>
            : <div className="text-gray-500 text-xs">
                Accepting shares your name and email with the collection's owner.
              </div>
        }
        <div className="flex justify-end">
          <PrimaryButton
              unboundEvents={{corgi: [[ACTION, hasAccess ? 'openClicked' : 'acceptClicked']]}}
          >
            {hasAccess ? 'Open' : state.status === 'accepting' ? 'Accepting' : 'Accept'}
          </PrimaryButton>
        </div>
      </div>
    </div>
  </>;
}

interface Args {
  acceptToken: string|undefined;
  code: string;
}

type Deps = typeof InviteController.deps;

class InviteController extends Controller<Args, Deps, HTMLElement, State> {

  static deps() {
    return {
      services: {
        history: HistoryService,
      },
    };
  }

  private readonly code: string;
  private readonly history: HistoryService;

  constructor(response: Response<InviteController>) {
    super(response);
    this.code = response.args.code;
    this.history = response.deps.services.history;

    // Only a click in this tab stores the token, so a link carrying ?accept= can't accept an invite
    // on someone's behalf.
    const token = response.args.acceptToken;
    if (token !== undefined) {
      const key = acceptTokenKey(this.code);
      const stored = sessionStorage.getItem(key);
      sessionStorage.removeItem(key);
      if (token === stored) {
        this.accept();
      } else {
        this.updateState({...this.state, status: 'idle'});
      }
    }
  }

  acceptClicked(): void {
    if (this.state.status === 'accepting') {
      return;
    }
    this.accept();
  }

  openClicked(): void {
    this.history.goTo(`/collection/${this.state.invite.value().collectionId}`);
  }

  private accept(): void {
    this.updateState({...this.state, status: 'accepting'});

    const self: Future<GetCurrentUserResponse> =
        requestData('lat.trails.DataService/GetCurrentUser', {});
    self
        .then(response => {
          if (!response.user) {
            const token = crypto.randomUUID();
            sessionStorage.setItem(acceptTokenKey(this.code), token);
            // /login is served outside of the client, so this leaves the app.
            const returnTo = `/i/${this.code}?accept=${token}`;
            window.location.assign(`/login?return=${encodeURIComponent(returnTo)}`);
            return;
          }

          const accepted: Future<AcceptInviteResponse> =
              requestData('lat.trails.DataService/AcceptInvite', {code: this.code});
          return accepted.then(response => {
            this.history.goTo(`/collection/${response.collectionId}`);
          });
        })
        .catch(e => {
          console.error(e);
          this.updateState({...this.state, status: 'failed'});
        });
  }
}

function acceptTokenKey(code: string): string {
  return `invite_accept_${code}`;
}
