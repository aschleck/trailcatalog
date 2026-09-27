import { declareEvent } from 'external/dev_april_corgi+/js/corgi/events';
import { RawUuid } from 'js/map/common/types';
import { Layer } from 'js/map/layer';

import { EditableFeature } from './features';
import { Data, Line, Polygon } from './workers/collection_loader';

// Two clicks on one object this close together count as a double click.
export const DOUBLE_CLICK_MS = 400;

/** What pointer tools are possible. */
export type Tool = 'pointer'|'point'|'line'|'measure';

export const FEATURE_CLICKED = declareEvent<{
  // Undefined when the click missed every feature
  id: string|undefined;
}>('feature_clicked');

/** Where on a line a right click was nearest. */
export type LineSpot =
    // Index is the vertex, and handle is whether the click was on its handle while editing.
    {kind: 'vertex'; index: number; handle: boolean}
    // A spot partway along the segment that ends at vertex index
    |{kind: 'segment'; index: number; latE7: number; lngE7: number};

export const FEATURE_CONTEXT_MENU = declareEvent<{
  // Undefined when the click missed every feature
  id: string|undefined;
  // Set when id is a line
  spot: LineSpot|undefined;
  latE7: number;
  lngE7: number;
  // Relative to the map's canvas
  px: [number, number];
}>('feature_context_menu');

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

/** An object a map layer drew from a collection. */
export type LayerObject = {kind: 'line'; value: Line}|{kind: 'polygon'; value: Polygon};

export const OBJECT_OPENED = declareEvent<{
  layer: Layer;
  object: LayerObject;
}>('object_opened');

export const POINT_PLACED = declareEvent<{
  latE7: number;
  lngE7: number;
}>('point_placed');

export const TOOL_REQUESTED = declareEvent<{
  tool: Tool;
}>('tool_requested');
