import * as corgi from 'external/dev_april_corgi+/js/corgi';
import { ACTION } from 'external/dev_april_corgi+/js/emu/events';

import { PanelCloseButton } from './buttons';

// What every dialog looks like from the outside, for a dialog that lays out its own insides
export const DIALOG_SURFACE = 'bg-white rounded shadow-lg text-gray-900 text-sm';
// Each dialog adds its own width, since that depends on what it holds
export const DIALOG = `${DIALOG_SURFACE} flex flex-col gap-3 p-4`;
// Rows in a dialog list, each giving itself padding
export const LIST = 'border border-gray-200 divide-gray-200 divide-y rounded';
// The scrolling body of a settings panel, which adds flex or hidden itself
export const PANEL = 'flex-col gap-6 grow min-h-0 overflow-y-auto px-5 py-4';

/** Renders a dialog's title beside a button that closes it. */
export function DialogHeader({onClose, title}: {
  // The method that closes the dialog, which is corgi's own close unless the dialog binds a
  // controller of its own
  onClose?: string;
  title: string;
}) {
  return <>
    <div className="flex font-bold gap-4 items-center justify-between">
      {title}
      <PanelCloseButton unboundEvents={{corgi: [[ACTION, onClose ?? 'close']]}} />
    </div>
  </>;
}

export function Section({children, label}: {
  children?: corgi.VElementOrPrimitive|corgi.VElementOrPrimitive[];
  label: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="font-semibold text-gray-500 text-xs tracking-wide uppercase">{label}</div>
      {children ?? []}
    </div>
  );
}
