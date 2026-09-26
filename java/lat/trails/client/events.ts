import { declareEvent } from 'external/dev_april_corgi+/js/corgi/events';
import { RawUuid } from 'js/map/common/types';

import { Data } from './workers/collection_loader';

/** What pointer tools are possible. */
export type Tool = 'pointer'|'line'|'measure';

export const FEATURE_CLICKED = declareEvent<{
  // Undefined when the click missed every feature
  id: string|undefined;
}>('feature_clicked');

export const HOVER_CHANGED = declareEvent<{
  target: {
    id: RawUuid;
    data: Data;
  }|undefined;
}>('hover_changed');

export const LINE_DRAWN = declareEvent<{
  latLngE7: Int32Array;
}>('line_drawn');

export const TOOL_REQUESTED = declareEvent<{
  tool: Tool;
}>('tool_requested');
