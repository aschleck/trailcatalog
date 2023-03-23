export { bind } from './binder';
export type { InputProperties, Properties } from './elements';
export { appendElement, createVirtualElement, Fragment, hydrateElement, vdomCaching } from './vdom';
export type { VElementOrPrimitive } from './vdom';

import { Binder } from './binder';
import { addListener } from './vdom';

addListener(new Binder());

