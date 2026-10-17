import * as corgi from 'external/dev_april_corgi+/js/corgi';
import { VElementOrPrimitive } from 'external/dev_april_corgi+/js/corgi';
import { ACTION } from 'external/dev_april_corgi+/js/emu/events';

import { DangerButton, PanelCloseButton, SecondaryButton } from './controls';

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
        <SecondaryButton unboundEvents={{corgi: [[ACTION, 'outsideClose']]}}>
          Cancel
        </SecondaryButton>
        <DangerButton unboundEvents={{corgi: [[ACTION, 'close']]}}>Delete</DangerButton>
      </div>
    </div>
  </>;
}

export function ConfirmDeleteCollectionDialog({count, name}: {count: number; name: string}) {
  return <>
    <div className="bg-white max-w-prose p-4 rounded text-gray-900">
      <div className="font-bold">{`Delete ${name}?`}</div>
      <p className="mt-2">
        {count > 0
            ? `This deletes the ${count} ${count === 1 ? 'item' : 'items'} in it for everyone it is `
                + 'shared with, and cannot be undone.'
            : 'This cannot be undone.'}
      </p>
      <div className="flex gap-2 justify-end mt-4">
        <SecondaryButton unboundEvents={{corgi: [[ACTION, 'outsideClose']]}}>
          Cancel
        </SecondaryButton>
        <DangerButton unboundEvents={{corgi: [[ACTION, 'close']]}}>Delete</DangerButton>
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
      <div className="flex font-bold gap-4 items-center justify-between">
        {title}
        <PanelCloseButton unboundEvents={{corgi: [[ACTION, 'close']]}} />
      </div>
      <div className="mt-2">
        {children ?? []}
      </div>
    </div>
  </>;
}
