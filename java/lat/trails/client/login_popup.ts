import { checkExists, checkState } from 'external/dev_april_corgi+/js/common/asserts';
import { Disposable } from 'external/dev_april_corgi+/js/common/disposable';
import { Future } from 'external/dev_april_corgi+/js/common/futures';
import { Timer } from 'external/dev_april_corgi+/js/common/timer';

import { GetCurrentUserResponse } from 'trails_lat/proto/data_pb';

import { invalidateCurrentUser, requestData } from './data';

// Keep in sync with oidc.ts#FINISHED_PAGE
const CHANNEL = 'login';
const SIGNED_IN = 'signed-in';
const ACKNOWLEDGED = 'acknowledged';

/** Runs /login in a popup so the page underneath keeps its state. */
export class LoginPopup extends Disposable {

  private readonly channel: BroadcastChannel;
  private pending: {
    popup: Window;
    resolve: (response: PromiseLike<GetCurrentUserResponse>) => void;
  }|undefined;
  // Set when we gave up on a popup that may still be open, so that a login it finishes later
  // reaches onLateLogin
  private abandoned: boolean;
  private readonly watcher: Timer;

  constructor(onLateLogin: (response: Promise<GetCurrentUserResponse>) => void) {
    super();
    this.abandoned = false;

    // The popup's callback page tells us it finished over this channel rather than through
    // window.opener, because OpenStreetMap sends Cross-Origin-Opener-Policy: same-origin and that
    // severs the popup from its opener.
    this.channel = new BroadcastChannel(CHANNEL);
    this.channel.onmessage = e => {
      if (e.data !== SIGNED_IN || (!this.pending && !this.abandoned)) {
        return;
      }

      this.channel.postMessage(ACKNOWLEDGED);
      if (this.pending) {
        this.finish().resolve(fetchSelf());
      } else {
        this.abandoned = false;
        onLateLogin(fetchSelf());
      }
    };
    this.registerDisposer(() => {
      this.channel.close();
    });

    // A severed popup reports closed while it is still open, so closed alone doesn't mean they gave
    // up. Coming back to this window does.
    this.watcher = new Timer(250 /* ms */, () => {
      if (!checkExists(this.pending).popup.closed || !document.hasFocus()) {
        return;
      }

      this.abandoned = true;
      this.finish().resolve(fetchSelf());
    });
    this.registerDisposable(this.watcher);
  }

  // Answers who is signed in once the popup finishes, which is nobody when they gave up. Callers
  // dedupe their own logins so that whatever they do after one runs once.
  open(): Promise<GetCurrentUserResponse> {
    checkState(!this.pending, 'A login is already open');

    const popup = window.open('/login', 'login', 'height=700,popup,width=500');
    if (!popup) {
      return Promise.reject(new Error('Unable to open the login window'));
    }

    this.abandoned = false;
    return new Promise(resolve => {
      this.pending = {popup, resolve};
      this.watcher.start();
    });
  }

  private finish(): NonNullable<LoginPopup['pending']> {
    const pending = checkExists(this.pending);
    this.watcher.stop();
    this.pending = undefined;
    return pending;
  }
}

function fetchSelf(): Promise<GetCurrentUserResponse> {
  invalidateCurrentUser();
  const self: Future<GetCurrentUserResponse> =
      requestData('lat.trails.DataService/GetCurrentUser', {});
  return Promise.resolve(self);
}
