import * as corgi from 'external/dev_april_corgi+/js/corgi';
import { VElementOrPrimitive } from 'external/dev_april_corgi+/js/corgi';
import { Button } from 'external/dev_april_corgi+/js/emu/button';
import { ACTION } from 'external/dev_april_corgi+/js/emu/events';

export function ImportFailedDialog({files}: {files: string[]}) {
  return <>
    <Shell title="No tracks imported">
      <p>We found no track segments in:</p>
      <ul className="list-disc list-inside mt-2">
        {files.map(file => <li>{file}</li>)}
      </ul>
      <p className="mt-2">Waypoints and routes are not imported.</p>
    </Shell>
  </>;
}

export function SaveFailedDialog({}: {}) {
  return <>
    <Shell title="Nothing is being saved">
      <p>
        We could not save what you drew. Check that you are signed in, then draw it again. What is
        on the map stays until you reload the page.
      </p>
    </Shell>
  </>;
}

// ACTION reaches DialogController#close because the button is unbound, so the dialog does not need
// a controller of its own to dismiss.
function Shell({children, title}: {
  children?: VElementOrPrimitive|VElementOrPrimitive[];
  title: string;
}) {
  return <>
    <div className="bg-white max-w-prose p-4 rounded text-gray-900">
      <div className="flex font-bold gap-4 items-start justify-between">
        {title}
        <Button
            ariaLabel="Close"
            unboundEvents={{
              corgi: [
                [ACTION, 'close'],
              ],
            }}
        >
          <svg className="h-4 stroke-current w-4" viewBox="0 0 12 12">
            <path d="M0 0 L12 12 M0 12 L12 0" />
          </svg>
        </Button>
      </div>
      <div className="mt-2">
        {children ?? []}
      </div>
    </div>
  </>;
}
