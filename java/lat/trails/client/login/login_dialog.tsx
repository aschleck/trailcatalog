import * as corgi from 'external/dev_april_corgi+/js/corgi';
import { Controller, Response } from 'external/dev_april_corgi+/js/corgi/controller';
import { EmptyDeps } from 'external/dev_april_corgi+/js/corgi/deps';
import { CorgiEvent } from 'external/dev_april_corgi+/js/corgi/events';
import { checkExists } from 'external/dev_april_corgi+/js/common/asserts';
import { ACTION, CLOSE } from 'external/dev_april_corgi+/js/emu/events';

import { SecondaryButton } from 'js/pika/buttons';
import { DIALOG, DialogHeader } from 'js/pika/dialog';

import { PROVIDER_IDENTITIES, ProviderName } from './providers';

/** Why somebody is asked to log in. */
export type LoginReason = 'save';

type OnLogin = (provider: ProviderName) => void;

interface Props {
  onLogin: OnLogin;
  providers: ProviderName[];
  reason: LoginReason|undefined;
}

/**
 * Offers a button per provider. Resolves after calling onLogin with the one they picked, and
 * rejects when they close it or continue without saving.
 */
export function LoginDialog({onLogin, providers, reason}: Props) {
  return <>
    <div
        js={corgi.bind({
          controller: LoginDialogController,
          args: {onLogin},
        })}
        className={`${DIALOG} max-w-full w-80`}
    >
      <DialogHeader
          onClose="dismiss"
          title={reason === 'save' ? 'Log in to save' : 'Log in to trails.lat'}
      />
      <div className="flex flex-col gap-2">
        {providers.map(name =>
            <SecondaryButton
                className="gap-2 h-9"
                data={{provider: name}}
                unboundEvents={{corgi: [[ACTION, 'providerClicked']]}}
            >
              <img alt="" className="h-4" src={`/static/${PROVIDER_IDENTITIES[name].logo}`} />
              Log in with {PROVIDER_IDENTITIES[name].label}
            </SecondaryButton>
        )}
      </div>
      {reason === 'save'
          ? <div className="border-gray-200 border-t flex justify-center pt-3">
            <button
                className="cursor-pointer px-2 py-1 text-gray-600 underline underline-offset-2"
                unboundEvents={{click: 'dismiss'}}
            >
              Continue without saving
            </button>
          </div>
          : ''
      }
    </div>
  </>;
}

interface Args {
  onLogin: OnLogin;
}

class LoginDialogController extends Controller<Args, EmptyDeps, HTMLElement, undefined> {

  private readonly onLogin: OnLogin;

  constructor(response: Response<LoginDialogController>) {
    super(response);
    this.onLogin = response.args.onLogin;
  }

  // onLogin opens the popup, so it has to run inside the click or else popup blockers stop it.
  providerClicked(e: CorgiEvent<typeof ACTION>): void {
    this.onLogin(checkExists(e.actionElement.data('provider')).string() as ProviderName);
    this.trigger(CLOSE, {kind: 'resolve'});
  }

  dismiss(): void {
    this.trigger(CLOSE, {kind: 'reject'});
  }
}
