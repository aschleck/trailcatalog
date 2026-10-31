import * as corgi from 'external/dev_april_corgi+/js/corgi';
import { Controller } from 'external/dev_april_corgi+/js/corgi/controller';
import { EmptyDeps } from 'external/dev_april_corgi+/js/corgi/deps';
import { CorgiEvent } from 'external/dev_april_corgi+/js/corgi/events';
import { ACTION, CHANGED, CLOSE } from 'external/dev_april_corgi+/js/emu/events';
import { Input } from 'external/dev_april_corgi+/js/emu/input';

import { DangerButton, PanelCloseButton, PrimaryButton, SecondaryButton } from 'js/pika/buttons';
import { LIST, Section } from 'js/pika/dialog';
import { TEXT_BOX } from 'js/pika/fields';
import { GetAccountResponse, User } from 'trails_lat/proto/data_pb';

const CONFIRMATION = 'delete my account';
const DIALOG = 'bg-white flex flex-col max-w-full p-4 rounded text-gray-900 text-sm w-[32rem]';

export const PROVIDER_LABELS: {[issuer: string]: string} = {
  'https://accounts.google.com': 'Google',
  'https://appleid.apple.com': 'Apple',
  'https://www.openstreetmap.org': 'OpenStreetMap',
};

/** Shows the caller's profile. Resolves when they ask to delete their account. */
export function AccountDialog(props: {account: GetAccountResponse; user: User}) {
  return <Account {...props} />;
}

function Account(
    {account, user}: {account: GetAccountResponse; user: User},
    state: {}|undefined,
    updateState: (newState: {}) => void) {
  const providers = account.loginIssuers.map(issuer => PROVIDER_LABELS[issuer] ?? issuer);
  return <>
    <div
        js={corgi.bind({
          controller: AccountController,
          args: {},
          state: [state ?? {}, updateState],
        })}
        className={`${DIALOG} gap-6`}
    >
      <div className="flex font-bold gap-4 items-center justify-between text-base">
        Account
        <PanelCloseButton unboundEvents={{corgi: [[ACTION, 'dismiss']]}} />
      </div>
      <Section label="Profile">
        <div className="flex gap-3 items-center">
          {user.pictureUrl
              ? <img alt="" className="h-10 rounded-full w-10" src={user.pictureUrl} />
              : ''
          }
          <div className="flex flex-col min-w-0">
            <div className="font-semibold truncate">{user.displayName}</div>
            {account.email ? <div className="text-gray-500 truncate">{account.email}</div> : ''}
          </div>
        </div>
        {providers.length > 0
            ? <div className="text-gray-500">{`Signed in with ${joinNames(providers)}`}</div>
            : ''
        }
      </Section>
      <Section label="Danger zone">
        <div className="flex">
          <DangerButton
              className="shrink-0"
              unboundEvents={{corgi: [[ACTION, 'deleteClicked']]}}
          >
            Delete account…
          </DangerButton>
        </div>
      </Section>
      <div className="flex justify-end">
        <PrimaryButton unboundEvents={{corgi: [[ACTION, 'dismiss']]}}>Done</PrimaryButton>
      </div>
    </div>
  </>;
}

class AccountController extends Controller<{}, EmptyDeps, HTMLElement, {}> {

  deleteClicked(): void {
    this.trigger(CLOSE, {kind: 'resolve'});
  }

  dismiss(): void {
    this.trigger(CLOSE, {kind: 'reject'});
  }
}

interface ConfirmState {
  typed: string;
}

/** Lists what deleting the account takes with it. Resolves once the caller types CONFIRMATION. */
export function ConfirmDeleteAccountDialog(props: {account: GetAccountResponse}) {
  return <ConfirmDeleteAccount {...props} />;
}

function ConfirmDeleteAccount(
    {account}: {account: GetAccountResponse},
    inState: ConfirmState|undefined,
    updateState: (newState: ConfirmState) => void) {
  const state = inState ?? {typed: ''};
  const owned = account.owned.length;
  const shared = account.owned.filter(c => c.shared).length;
  const granted = account.grantedCount;
  return <>
    <div
        js={corgi.bind({
          controller: ConfirmController,
          args: {},
          state: [state, updateState],
        })}
        className={`${DIALOG} gap-3`}
    >
      <div className="font-bold text-base">Delete your account?</div>
      <p>This will permanently delete your account and data. It cannot be undone.</p>
      {owned > 0
          ? <>
              <p>
                {`${plural(owned, 'collection')} will be deleted:`}
              </p>
              <div className={`${LIST} max-h-48 overflow-y-auto`}>
                {account.owned.map(collection =>
                    <div className="flex gap-2 items-center justify-between px-3 py-1.5">
                      <span className="truncate">{collection.name}</span>
                      {collection.shared
                          ? <span className="shrink-0 text-gray-500 text-xs">Shared</span>
                          : ''
                      }
                    </div>
                )}
              </div>
            </>
          : ''
      }
      {shared > 0
          ? <p className="bg-red-50 border border-red-200 px-3 py-2 rounded text-red-800">
              {(owned === 1
                  ? 'It is shared'
                  : `${shared} of them ${shared === 1 ? 'is' : 'are'} shared`)
                  + `, so the people you shared ${shared === 1 ? 'it' : 'them'} with lose `
                  + `${shared === 1 ? 'it' : 'them'} too.`}
            </p>
          : ''
      }
      {granted > 0
          ? <p>
              {`You also lose access to the ${plural(granted, 'collection')} other people `
                  + `shared with you. ${granted === 1 ? 'It stays' : 'Those stay'} with `
                  + `${granted === 1 ? 'its owner' : 'their owners'}.`}
            </p>
          : ''
      }
      <p>{`To confirm, type "${CONFIRMATION}" below.`}</p>
      <Input
          autofocus={true}
          className={TEXT_BOX}
          value={state.typed}
          unboundEvents={{corgi: [[CHANGED, 'typedChanged'], [ACTION, 'confirm']]}}
      />
      <div className="flex gap-2 justify-end mt-1">
        <SecondaryButton unboundEvents={{corgi: [[ACTION, 'cancel']]}}>Cancel</SecondaryButton>
        <DangerButton
            disabled={state.typed !== CONFIRMATION}
            unboundEvents={{corgi: [[ACTION, 'confirm']]}}
        >
          Delete account
        </DangerButton>
      </div>
    </div>
  </>;
}

class ConfirmController extends Controller<{}, EmptyDeps, HTMLElement, ConfirmState> {

  typedChanged(e: CorgiEvent<typeof CHANGED>): void {
    this.updateState({...this.state, typed: e.detail.value});
  }

  // Enter in the box lands here too, so this checks the text rather than trusting the button's
  // disabled state.
  confirm(): void {
    if (this.state.typed === CONFIRMATION) {
      this.trigger(CLOSE, {kind: 'resolve'});
    }
  }

  cancel(): void {
    this.trigger(CLOSE, {kind: 'reject'});
  }
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function joinNames(names: string[]): string {
  return names.length <= 1
      ? names.join('')
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
