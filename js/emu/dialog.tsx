import * as corgi from 'js/corgi';
import { Controller, Response } from 'js/corgi/controller';
import { EmptyDeps } from 'js/corgi/deps';
import { Service } from 'js/corgi/service';

export class DialogService extends Service<EmptyDeps> {

  display(content: corgi.VElementOrPrimitive) {
    corgi.appendElement(document.body, <Dialog>{content}</Dialog>);
  }
}

interface State {}

class DialogController extends Controller<{}, EmptyDeps, HTMLDivElement, State> {

  constructor(response: Response<DialogController>) {
    super(response);
  }

  close(): void {
    this.root.remove();
  }

  outsideClose(e: MouseEvent): void {
    if (e.target === this.root) {
      this.close();
    }
  }
}

function Dialog(
  {children}: {children?: corgi.VElementOrPrimitive},
  state: State|undefined,
  updateState: (newState: State) => void,
) {
  if (!state) {
    state = {};
  }

  return <>
    <div
        js={corgi.bind({
          controller: DialogController,
          state: [state, updateState],
          events: {
            click: 'outsideClose',
          },
        })}
        className="absolute bg-black/25 inset-0 z-50">
      <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
        {children}
      </div>
    </div>
  </>;
}

