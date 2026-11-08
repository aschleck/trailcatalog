import { Future, resolvedFuture } from 'external/dev_april_corgi+/js/common/futures';
import { EmptyDeps } from 'external/dev_april_corgi+/js/corgi/deps';
import { Service, ServiceResponse } from 'external/dev_april_corgi+/js/corgi/service';
import { GetCurrentUserResponse } from 'trails_lat/proto/data_pb';

import { requestData } from '../data/data';
import { LoginReason } from './login_page';
import { LoginPopup } from './login_popup';

type SignedInListener = (response: GetCurrentUserResponse) => void;

/** Signs the user in through a popup and tells listeners whenever somebody signs in. */
export class LoginService extends Service<EmptyDeps> {

  private readonly listeners: Set<SignedInListener>;
  // Kept here because the request cache holds 10 entries and other reads evict it, and a popup
  // opened after waiting on the network is blocked once the click's user activation lapses.
  private current: Future<GetCurrentUserResponse>|undefined;
  // Settles once the login popup closes and the user is fetched, so concurrent callers share it
  private login: Promise<void>|undefined;
  private readonly popup: LoginPopup;

  constructor(response: ServiceResponse<EmptyDeps>) {
    super(response);
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

  requireLogin(reason?: LoginReason): Promise<void> {
    // Somebody already signed in whose GetCurrentUser has not landed yet gets a popup if we go by
    // finished, so wait the fetch out instead.
    return Promise.resolve(this.self()).then(response => {
      if (response.user) {
        return;
      }

      // Callers wait on this, so it has to settle even when the user fetch fails, or else the
      // write queue behind it never runs again.
      this.login ??= this.popup.open(reason)
          .then(response => {
            this.signedIn(response);
            if (!response.user) {
              throw new Error('Nobody signed in');
            }
          })
          .finally(() => {
            this.login = undefined;
          });
      return this.login;
    });
  }

  private signedIn(response: GetCurrentUserResponse): void {
    this.current = resolvedFuture(response);
    for (const listener of this.listeners) {
      listener(response);
    }
  }
}
