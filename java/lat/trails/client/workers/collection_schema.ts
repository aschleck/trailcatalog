import { checkExhaustive } from 'external/dev_april_corgi+/js/common/asserts';

import { RgbaU32 } from 'js/map/common/types';
import { LINE_PATTERNS, LinePattern } from 'js/map/rendering/line_program';

import { Match, matches } from './filters';

// A collection's schema and how a feature's look resolves from it. The collection loader worker
// styles read-only collections with it, so it can't reach into the client package.

// Magenta because nothing on the basemap is near it, and dark enough for 3:1 over forest. See also
// schema.ts#OPTION_COLORS.
export const DEFAULT_COLOR = '#be0bb2';
// DEFAULT_COLOR at 30% so the map shows through: 0.3 * 255 = 77 = 0x4d
export const DEFAULT_POLYGON_FILL = '#be0bb24d';
// The radius a point's circle draws at, and the size every other icon scales from
export const DEFAULT_POINT_RADIUS_PX = 6;
export const DEFAULT_WIDTH_PX = 3;
// Close to tldraw's default m, whose perfect-freehand size of 4.5 draws 6.4 px wide. See
// marker.ts.
export const DEFAULT_MARKER_WIDTH_PX = 6;

// What a point without an icon of its own is drawn as
export const DEFAULT_ICON = '⬤';

// A feature's data, whether an editable feature's or a row a collection tile carries
export type LookData = {readonly [key: string]: boolean|number|string|undefined};

// A collection's fields and what each part of a feature's look comes from, the JSON in
// collections.schema. A feature keeps a field's value in its data under the field's id.
export interface CollectionSchema {
  fields: FieldDefinition[];
  layers: StyleLayer[];
}

// A feature draws with the first layer of its kind whose filters all match, and one that no layer
// matches doesn't draw. See lineLook.
export type StyleLayer = {[K in FieldKind]: {kind: K; filters: Match[]} & Parts<K>}[FieldKind];

type Parts<K extends FieldKind> =
    {[P in Exclude<PartName<K>, OptionalPart>]: Channel<ValueOf<K, P>>}
        & {[P in Extract<PartName<K>, OptionalPart>]?: Channel<ValueOf<K, P>>};

// Parts that schemas saved before them lack, which resolve to their fallbacks
type OptionalPart = 'casing'|'halo';

// A drawing is a line made with the marker. Folders have no fields.
export type FieldKind = 'drawing'|'line'|'point'|'polygon';

export const FIELD_KINDS: FieldKind[] = ['drawing', 'line', 'point', 'polygon'];

export type FieldType = 'checkbox'|'color'|'date'|'icon'|'number'|'pattern'|'select'|'text';

// Each kind has its own fields, so that renaming one or giving it a default in one section of the
// schema dialog doesn't change another. Two kinds can each have a field with the same id, such as
// drawings' and lines' stroke, because a feature has only one kind.
export interface FieldDefinition {
  // The key a feature's data holds the value under
  id: string;
  kind: FieldKind;
  label: string;
  type: FieldType;
  hideLabel?: boolean;
  // Only for text, which is a single line unless set
  multiline?: boolean;
  // Only for a select
  options?: SelectOption[];
  // Copied into a new feature's data, so changing it leaves existing features alone. Checked
  // against the type when used, since removing a select's option can strand it.
  default?: boolean|number|string;
}

// Which field, since a field's id is only unique within its kind
export type FieldRef = Pick<FieldDefinition, 'id'|'kind'>;

export interface SelectOption {
  // What a feature's data holds, so that relabeling an option keeps every value
  id: string;
  label: string;
}

// What a part of a feature's look holds
export type StyleType = 'color'|'icon'|'label'|'number'|'pattern';

interface StyleValues {
  color: string;
  icon: string;
  label: string;
  number: number;
  pattern: LinePattern;
}

// The fallback is what draws when the part's channel gives nothing usable.
interface PartSpec {
  label: string;
  type: StyleType;
  fallback: number|string;
}

// The parts of each kind of feature's look, in the order the schema dialog lists them
export const STYLE = {
  drawing: {
    label: {label: 'Label', type: 'label', fallback: ''},
    stroke: {label: 'Stroke', type: 'color', fallback: DEFAULT_COLOR},
    width: {label: 'Width', type: 'number', fallback: DEFAULT_MARKER_WIDTH_PX},
  },
  line: {
    label: {label: 'Label', type: 'label', fallback: ''},
    // Empty is the stroke darkened, see getCasing.
    casing: {label: 'Casing', type: 'color', fallback: ''},
    // Clear is no halo.
    halo: {label: 'Halo', type: 'color', fallback: '#00000000'},
    pattern: {label: 'Pattern', type: 'pattern', fallback: 'solid'},
    stroke: {label: 'Stroke', type: 'color', fallback: DEFAULT_COLOR},
    width: {label: 'Width', type: 'number', fallback: DEFAULT_WIDTH_PX},
  },
  point: {
    label: {label: 'Label', type: 'label', fallback: ''},
    fill: {label: 'Fill', type: 'color', fallback: DEFAULT_COLOR},
    icon: {label: 'Icon', type: 'icon', fallback: DEFAULT_ICON},
    radius: {label: 'Radius', type: 'number', fallback: DEFAULT_POINT_RADIUS_PX},
  },
  polygon: {
    label: {label: 'Label', type: 'label', fallback: ''},
    fill: {label: 'Fill', type: 'color', fallback: DEFAULT_POLYGON_FILL},
    pattern: {label: 'Pattern', type: 'pattern', fallback: 'solid'},
    stroke: {label: 'Stroke', type: 'color', fallback: DEFAULT_COLOR},
    width: {label: 'Width', type: 'number', fallback: DEFAULT_WIDTH_PX},
  },
} as const satisfies {[kind in FieldKind]: {[part: string]: PartSpec}};

export type PartName<K extends FieldKind> = keyof (typeof STYLE)[K] & string;

type ValueOf<K extends FieldKind, P extends PartName<K>> =
    (typeof STYLE)[K][P] extends {type: infer T extends StyleType} ? StyleValues[T] : never;

// Every part of every kind, for code that treats them all alike
export const PARTS: Array<PartSpec & {kind: FieldKind; part: string}> =
    FIELD_KINDS.flatMap(kind =>
        Object.entries(STYLE[kind] as {[part: string]: PartSpec})
            .map(([part, spec]) => ({...spec, kind, part})));

export type Channel<T> =
    {kind: 'constant'; value: T}
    |{kind: 'field'; key: string}
    // Each option of a select draws with its own value, and a feature with no option draws with
    // none.
    |{kind: 'by_option'; key: string; values: {[option: string]: T}};

/** Returns a kind's field by its id. */
export function getField(schema: CollectionSchema, kind: FieldKind, id: string):
    FieldDefinition|undefined {
  return schema.fields.find(f => f.kind === kind && f.id === id);
}

// A checkbox splits a part like a select of these two.
const CHECKBOX_OPTIONS: SelectOption[] = [
  {id: 'true', label: 'Checked'},
  {id: 'false', label: 'Unchecked'},
];

/** Returns whether a part can take a value per option of this field. */
export function splitsParts(field: FieldDefinition): boolean {
  return field.type === 'checkbox' || field.type === 'select';
}

/** Returns the options a select or checkbox splits a part by. */
export function splitOptions(field: FieldDefinition): SelectOption[] {
  return field.type === 'checkbox' ? CHECKBOX_OPTIONS : field.options ?? [];
}

// Which of splitOptions a feature's value picks. A feature that was never checked is unchecked,
// while one without a select's option picks none.
function getOption(field: FieldDefinition|undefined, value: unknown): string|undefined {
  if (field?.type === 'checkbox') {
    return value === true ? 'true' : 'false';
  }
  return typeof value === 'string' ? value : undefined;
}

/** Returns whether a value fits a field, as a default or in a feature's data. */
export function isValidFieldValue(field: FieldDefinition, value: unknown): boolean {
  switch (field.type) {
    case 'checkbox':
      return typeof value === 'boolean';
    case 'color':
      return VALID.color(value);
    case 'date':
      return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
    case 'icon':
    case 'text':
      return typeof value === 'string' && value !== '';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'pattern':
      return VALID.pattern(value);
    case 'select':
      return (field.options ?? []).some(o => o.id === value);
    default:
      throw checkExhaustive(field.type);
  }
}

// Each part falls back to STYLE's fallback when its channel gives nothing usable. An empty label
// means none.
export interface LineLook {
  casing: string;
  halo: string;
  label: string;
  pattern: LinePattern;
  stroke: string;
  widthPx: number;
}

export interface PointLook {
  fill: string;
  icon: string;
  label: string;
  radiusPx: number;
}

export interface PolygonLook {
  fill: string;
  label: string;
  pattern: LinePattern;
  stroke: string;
  widthPx: number;
}

/** Returns which kind a line is styled as. A drawing carries the zoom it was drawn at. */
export function getLineKind(data: LookData): 'drawing'|'line' {
  return typeof data.marker_zoom === 'number' ? 'drawing' : 'line';
}

/**
 * Resolves a line's look, or a drawing's, which is always solid. Undefined means no layer draws it.
 */
export function lineLook(schema: CollectionSchema, data: LookData): LineLook|undefined {
  const layer = getLayer(schema, getLineKind(data), data);
  const line = layer?.kind === 'line' ? layer : undefined;
  return layer && {
    casing: line ? resolve(schema, line, 'casing', data) : '',
    halo: line ? resolve(schema, line, 'halo', data) : '#00000000',
    label: resolve(schema, layer, 'label', data),
    pattern: line ? resolve(schema, line, 'pattern', data) : 'solid',
    stroke: resolve(schema, layer, 'stroke', data),
    widthPx: resolve(schema, layer, 'width', data),
  };
}

export function pointLook(schema: CollectionSchema, data: LookData): PointLook|undefined {
  const layer = getLayer(schema, 'point', data);
  return layer && {
    fill: resolve(schema, layer, 'fill', data),
    icon: resolve(schema, layer, 'icon', data),
    label: resolve(schema, layer, 'label', data),
    radiusPx: resolve(schema, layer, 'radius', data),
  };
}

export function polygonLook(schema: CollectionSchema, data: LookData): PolygonLook|undefined {
  const layer = getLayer(schema, 'polygon', data);
  return layer && {
    fill: resolve(schema, layer, 'fill', data),
    label: resolve(schema, layer, 'label', data),
    pattern: resolve(schema, layer, 'pattern', data),
    stroke: resolve(schema, layer, 'stroke', data),
    widthPx: resolve(schema, layer, 'width', data),
  };
}

const VALID: {[type in StyleType]: (value: unknown) => boolean} = {
  color: isHexColor,
  icon: value => typeof value === 'string' && value !== '',
  label: value => typeof value === 'string' && value !== '',
  number: value => typeof value === 'number' && Number.isFinite(value) && value > 0,
  pattern: value => LINE_PATTERNS.includes(value as LinePattern),
};

type LayerOf<K extends FieldKind> = Extract<StyleLayer, {kind: K}>;

function getLayer<K extends FieldKind>(schema: CollectionSchema, kind: K, data: LookData):
    LayerOf<K>|undefined {
  return schema.layers.find(l => l.kind === kind && matches(data, l.filters)) as
      LayerOf<K>|undefined;
}

function resolve<K extends FieldKind, P extends PartName<K>>(
    schema: CollectionSchema, layer: LayerOf<K>, part: P, data: LookData):
    ValueOf<K, P> {
  const kind = layer.kind as K;
  const {fallback, type} = STYLE[kind][part] as PartSpec;
  const channel = (layer as {[part: string]: unknown})[part] as Channel<unknown>|undefined;
  let value: unknown;
  if (channel === undefined) {
    value = undefined;
  } else if (channel.kind === 'constant') {
    value = channel.value;
  } else if (channel.kind === 'by_option') {
    const option = getOption(getField(schema, kind, channel.key), data[channel.key]);
    value = option !== undefined ? channel.values[option] : undefined;
  } else if (type === 'label') {
    value = getLabel(schema, kind, channel.key, data);
  } else {
    value = data[channel.key];
  }
  return (VALID[type](value) ? value : fallback) as ValueOf<K, P>;
}

function getLabel(schema: CollectionSchema, kind: FieldKind, id: string, data: LookData):
    string|undefined {
  const value = data[id];
  const field = getField(schema, kind, id);
  if (field?.type === 'select') {
    return field.options?.find(o => o.id === value)?.label;
  }
  return typeof value === 'number' || typeof value === 'string' ? String(value) : undefined;
}

// The casing LineProgram draws is a pixel wide on each side, see line_program.ts.
const CASING_PX = 1;

// How far a halo reaches past its line's casing
const HALO_PX = 3;

/** Returns the radius LineProgram draws a line of this width at, casing included. */
export function lineRadiusPx(widthPx: number): number {
  return widthPx / 2 + CASING_PX;
}

/** Returns the radius a line's halo draws at under it. */
export function haloRadiusPx(widthPx: number): number {
  return lineRadiusPx(widthPx) + HALO_PX;
}

/** Returns the color a line's casing draws in. */
export function getCasing(look: LineLook): RgbaU32 {
  return look.casing ? parseColor(look.casing) : darken(parseColor(look.stroke));
}

/** Returns the color a line's halo draws in, or undefined if it has none. */
export function getHalo(look: LineLook): RgbaU32|undefined {
  const halo = parseColor(look.halo);
  return (halo & 0xFF) === 0 ? undefined : halo;
}

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value);
}

/** Parses a color that passed isHexColor, where #rrggbb is opaque. */
export function parseColor(hex: string): RgbaU32 {
  const value = parseInt(hex.slice(1), 16);
  return (hex.length === 9 ? value >>> 0 : ((value << 8) | 0xFF) >>> 0) as RgbaU32;
}

/** Returns the color a casing draws in when its look doesn't set one. */
export function darken(color: RgbaU32): RgbaU32 {
  const r = Math.round(((color >>> 24) & 0xFF) * 0.4);
  const g = Math.round(((color >>> 16) & 0xFF) * 0.4);
  const b = Math.round(((color >>> 8) & 0xFF) * 0.4);
  return ((r << 24) | (g << 16) | (b << 8) | (color & 0xFF)) >>> 0 as RgbaU32;
}
