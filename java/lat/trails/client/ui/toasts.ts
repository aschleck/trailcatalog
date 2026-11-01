import { EmptyDeps } from 'external/dev_april_corgi+/js/corgi/deps';
import { Service } from 'external/dev_april_corgi+/js/corgi/service';

const TOAST_MS = 4000;

/** A toast that stays up and shows progress until it finishes or is dismissed. */
export interface ProgressToast {
  // fraction is from 0 to 1
  update(message: string, fraction: number): void;
  finish(message: string): void;
  dismiss(): void;
}

/** Shows brief messages at the bottom of the page. */
export class ToastService extends Service<EmptyDeps> {

  private stack: HTMLElement|undefined;

  show(message: string): void {
    this.start(message, /* fraction= */ 0).finish(message);
  }

  start(message: string, fraction: number): ProgressToast {
    const toast = document.createElement('div');
    toast.className =
        'bg-gray-900 flex gap-3 items-center overflow-hidden pl-4 pointer-events-auto pr-2 py-1.5 '
            + 'relative rounded shadow-lg text-sm text-white';
    const text = document.createElement('span');
    const close = document.createElement('button');
    close.ariaLabel = 'Close';
    close.className =
        'cursor-pointer hover:bg-white/10 hover:text-white p-1 rounded shrink-0 text-gray-400';
    close.innerHTML =
        '<svg class="h-4 stroke-current w-4" fill="none" viewBox="0 0 20 20">'
            + '<path d="M5 5 L15 15 M5 15 L15 5" stroke-width="1.5" /></svg>';
    const bar = document.createElement('div');
    bar.className = 'absolute bg-sky-400 bottom-0 h-0.5 left-0 transition-[width]';
    toast.append(text, close, bar);
    const update = (message: string, fraction: number) => {
      text.textContent = message;
      bar.style.width = `${fraction * 100}%`;
    };
    update(message, fraction);
    this.getStack().append(toast);

    let timeout: ReturnType<typeof setTimeout>|undefined;
    const dismiss = () => {
      clearTimeout(timeout);
      toast.remove();
    };
    close.addEventListener('click', dismiss);
    return {
      update,
      finish: (message: string) => {
        text.textContent = message;
        bar.remove();
        clearTimeout(timeout);
        timeout = setTimeout(() => {
          toast.remove();
        }, TOAST_MS);
      },
      dismiss,
    };
  }

  private getStack(): HTMLElement {
    if (!this.stack) {
      this.stack = document.createElement('div');
      this.stack.ariaLive = 'polite';
      this.stack.className =
          'bottom-4 fixed flex flex-col gap-2 items-start left-4 max-w-[calc(100vw-2rem)] '
              + 'pointer-events-none z-50';
      document.body.append(this.stack);
    }
    return this.stack;
  }
}
