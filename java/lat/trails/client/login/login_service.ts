import { checkExists } from 'external/dev_april_corgi+/js/common/asserts';
import { Future, resolvedFuture } from 'external/dev_april_corgi+/js/common/futures';
import { Service, ServiceResponse } from 'external/dev_april_corgi+/js/corgi/service';
import { DialogService } from 'external/dev_april_corgi+/js/emu/dialog';
import { GetCurrentUserResponse } from 'trails_lat/proto/data_pb';

import { requestData } from '../data/data';
import { LoginDialog, LoginReason } from './login_dialog';
import { LoginPopup } from './login_popup';
import { getConfiguredProviders } from './providers';

type Deps = typeof LoginService.deps;

type SignedInListener = (response: GetCurrentUserResponse) => void;

/** Thrown when somebody closes the login dialog or the popup without logging in. */
export class LoginDeclined extends Error {

  constructor() {
    super('Nobody signed in');
  }
}

/** Signs the user in through a popup and tells listeners whenever somebody signs in. */
export class LoginService extends Service<Deps> {

  static deps() {
    return {
      services: {
        dialog: DialogService,
      },
    };
  }

  private readonly dialog: DialogService;
  private readonly listeners: Set<SignedInListener>;
  // Kept here because the request cache holds 10 entries and other reads evict it, which would make
  // every requireLogin wait on the network before showing the dialog.
  private current: Future<GetCurrentUserResponse>|undefined;
  // Settles once the dialog and popup close and the user is fetched, so concurrent callers share it
  private login: Promise<void>|undefined;
  private readonly popup: LoginPopup;

  constructor(response: ServiceResponse<Deps>) {
    super(response);
    this.dialog = response.deps.services.dialog;
    this.listeners = new Set();
    this.current = undefined;
    this.login = undefined;
    this.popup = new LoginPopup(response => {
      response.then(r => {
        this.signedIn(r);
      }, e => {
        console.error(e);
      });
    });
    this.registerDisposable(this.popup);
  }

  /** Calls listener after every sign in until the returned function is called. */
  listen(listener: SignedInListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  self(): Future<GetCurrentUserResponse> {
    if (!this.current) {
      const fetching: Future<GetCurrentUserResponse> =
          requestData('lat.trails.DataService/GetCurrentUser', {});
      this.current = fetching;
      // A failed fetch is asked again next time, or else every later requireLogin rejects.
      fetching.catch(() => {
        if (this.current === fetching) {
          this.current = undefined;
        }
      });
    }
    return this.current;
  }

  /** Resolves once somebody is signed in, and rejects with LoginDeclined if they won't. */
  requireLogin(reason?: LoginReason): Promise<void> {
    // Somebody already signed in whose GetCurrentUser has not landed yet gets the dialog if we go
    // by finished, so wait the fetch out instead.
    return Promise.resolve(this.self()).then(response => {
      if (response.user) {
        return;
      }

      // Callers wait on this, so it has to settle even when the user fetch fails, or else the
      // write queue behind it never runs again.
      this.login ??= this.ask(reason).finally(() => {
        this.login = undefined;
      });
      return this.login;
    });
  }

  private ask(reason: LoginReason|undefined): Promise<void> {
    let opened: Promise<GetCurrentUserResponse>|undefined;
    const dialog =
        LoginDialog({
          onLogin: provider => {
            opened = this.popup.open(provider);
          },
          providers: getConfiguredProviders(),
          reason,
        });
    return this.dialog.display(dialog)
        .then(
            () => checkExists(opened),
            () => {
              throw new LoginDeclined();
            })
        .then(response => {
          this.signedIn(response);
          if (!response.user) {
            throw new LoginDeclined();
          }
        });
  }

  private signedIn(response: GetCurrentUserResponse): void {
    this.current = resolvedFuture(response);
    for (const listener of this.listeners) {
      listener(response);
    }
  }
}
