import * as corgi from 'external/dev_april_corgi+/js/corgi';
import { VElementOrPrimitive } from 'external/dev_april_corgi+/js/corgi';
import { ACTION } from 'external/dev_april_corgi+/js/emu/events';

import { DangerButton, SecondaryButton } from 'js/pika/buttons';
import { DIALOG, DialogHeader } from 'js/pika/dialog';

export function ImportFailedDialog({files}: {files: string[]}) {
  return <>
    <Shell title="Import failed">
      <ul className="list-disc list-inside mt-2">
        {files.map(file => <li>{file}</li>)}
      </ul>
      <p className="mt-2">
        Only the following file types are supported: images, GPX, and GeoJSON
      </p>
    </Shell>
  </>;
}

export function ConfirmDeleteDialog({message, title}: {message: string; title: string}) {
  return <>
    <div className={`${DIALOG} max-w-prose`}>
      <div className="font-bold">{title}</div>
      <p>{message}</p>
      <div className="flex gap-2 justify-end mt-1">
        <SecondaryButton unboundEvents={{corgi: [[ACTION, 'outsideClose']]}}>
          Cancel
        </SecondaryButton>
        <DangerButton unboundEvents={{corgi: [[ACTION, 'close']]}}>Delete</DangerButton>
      </div>
    </div>
  </>;
}

export function DeleteAccountFailedDialog({}: {}) {
  return <>
    <Shell title="Deleting your account failed">
      <p>
        Your account was not deleted. Try again, or email april@trails.lat.
      </p>
    </Shell>
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
    <div className={`${DIALOG} max-w-prose`}>
      <DialogHeader title={title} />
      <div>
        {children ?? []}
      </div>
    </div>
  </>;
}
