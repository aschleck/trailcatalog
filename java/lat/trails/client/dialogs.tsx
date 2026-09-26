import * as corgi from 'external/dev_april_corgi+/js/corgi';
import { VElementOrPrimitive } from 'external/dev_april_corgi+/js/corgi';
import { Button } from 'external/dev_april_corgi+/js/emu/button';
import { ACTION } from 'external/dev_april_corgi+/js/emu/events';

export function ImportFailedDialog({files}: {files: string[]}) {
  return <>
    <Shell title="Nothing imported">
      <p>We found nothing to import in:</p>
      <ul className="list-disc list-inside mt-2">
        {files.map(file => <li>{file}</li>)}
      </ul>
      <p className="mt-2">We import GPX waypoints and tracks, and GeoJSON points and lines.</p>
    </Shell>
  </>;
}

export function ConfirmDeleteDialog({count}: {count: number}) {
  return <>
    <div className="bg-white max-w-prose p-4 rounded text-gray-900">
      <div className="font-bold">Delete this folder?</div>
      <p className="mt-2">
        {`This also deletes the ${count} ${count === 1 ? 'item' : 'items'} inside it.`}
      </p>
      <div className="flex gap-2 justify-end mt-4">
        <Button
            className="hover:bg-black/10 px-3 py-1 rounded"
            unboundEvents={{corgi: [[ACTION, 'outsideClose']]}}
        >
          Cancel
        </Button>
        <Button
            className="bg-red-700 hover:bg-red-800 px-3 py-1 rounded text-white"
            unboundEvents={{corgi: [[ACTION, 'close']]}}
        >
          Delete
        </Button>
      </div>
    </div>
  </>;
}

export function SaveFailedDialog({}: {}) {
  return <>
    <Shell title="Saving failed">
      <p>
        Your changes failed to save. If you are not logged in, click "Log in".
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
