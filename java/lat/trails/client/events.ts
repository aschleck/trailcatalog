import { declareEvent } from 'external/dev_april_corgi+/js/corgi/events';
import { RawUuid } from 'js/map/common/types';

import { EditableFeature } from './features';
import { Data } from './workers/collection_loader';

/** What pointer tools are possible. */
export type Tool = 'pointer'|'point'|'line'|'measure';

export const FEATURE_CLICKED = declareEvent<{
  // Undefined when the click missed every feature
  id: string|undefined;
}>('feature_clicked');

export const FEATURE_EDITED = declareEvent<{
  before: EditableFeature;
  after: EditableFeature;
}>('feature_edited');

export const FEATURE_HOVERED = declareEvent<{
  // Undefined when the pointer left every feature
  id: string|undefined;
}>('feature_hovered');

export const HOVER_CHANGED = declareEvent<{
  target: {
    id: RawUuid;
    data: Data;
  }|undefined;
}>('hover_changed');

export const LINE_DRAWN = declareEvent<{
  latLngE7: Int32Array;
}>('line_drawn');

export const POINT_PLACED = declareEvent<{
  latE7: number;
  lngE7: number;
}>('point_placed');

export const TOOL_REQUESTED = declareEvent<{
  tool: Tool;
}>('tool_requested');
