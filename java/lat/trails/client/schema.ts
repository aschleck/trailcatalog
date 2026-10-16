import { Stipple } from 'js/map/rendering/line_program';

import {
  DEFAULT_ICON,
  DEFAULT_LINE_COLOR,
  DEFAULT_POINT_COLOR,
  DEFAULT_WIDTH_PX,
  EditableFeature,
  EditableLine,
  FeatureData,
  isMarker,
} from './features';
import { DEFAULT_MARKER_WIDTH_PX } from './marker';

// What the keys of a collection's feature data mean, so that the properties dialog can show them.
export interface Schema {
  title: {kind: 'text'; key: string}
      // The key holds an OpenStreetMap way id, or a point id that came from a node or a way, and
      // we fetch that element's tags
      |{kind: 'osm_point'; key: string}
      |{kind: 'osm_way'; key: string};
  description: string|undefined;
  // Shown in this order after the stats, skipping any the feature lacks
  fields: Field[];
}

interface Field {
  key: string;
  label: string;
  // How to show raw values, which pass through unchanged when missing
  values?: {[raw: string]: string};
}

// The type key is a WayCategory, which the way's own tags say better.
export const OSM_WAYS_SCHEMA: Schema = {
  title: {kind: 'osm_way', key: 'id'},
  description: undefined,
  fields: [],
};

// The type key is a PointCategory, which the element's own tags say better.
export const OSM_NODES_SCHEMA: Schema = {
  title: {kind: 'osm_point', key: 'id'},
  description: undefined,
  fields: [],
};

// A user collection's fields and what each part of a feature's look comes from, the JSON in
// collections.schema. A feature keeps a field's value in its data under the field's id.
export interface CollectionSchema {
  fields: FieldDefinition[];
  style: {[K in FieldKind]: {[P in PartName<K>]: Channel<ValueOf<K, P>>}};
}

// The open collection's schema, with the version the server last stamped on it, which a put of it
// sends back the way a feature's does
export interface SavedSchema {
  schema: CollectionSchema;
  version: bigint;
}

// A drawing is a line made with the marker. Folders have no fields.
export type FieldKind = 'drawing'|'line'|'point';

export const FIELD_KINDS: FieldKind[] = ['drawing', 'line', 'point'];

export type FieldType = 'checkbox'|'color'|'date'|'icon'|'number'|'pattern'|'select'|'text';

export interface FieldDefinition {
  id: string;
  label: string;
  type: FieldType;
  // Which features show the field, every kind when unset
  kinds?: FieldKind[];
  hideLabel?: boolean;
  // Only for text, which is a single line unless set
  multiline?: boolean;
  // Only for a select
  options?: SelectOption[];
}

export interface SelectOption {
  // What a feature's data holds, so that relabeling an option keeps every value
  id: string;
  label: string;
}

// Given to new options in turn, so that a color split by a select starts out telling them apart
export const OPTION_COLORS = [
  '#de29db', '#1f77b4', '#2ca02c', '#d62728', '#ff7f0e', '#9467bd', '#17becf', '#8c564b',
];

export type PatternName = 'alternating'|'dashed'|'solid'|'ticks';

export const PATTERN_NAMES: PatternName[] = ['alternating', 'dashed', 'solid', 'ticks'];

export const PATTERN_LABELS: {[name in PatternName]: string} = {
  alternating: 'Alternating',
  dashed: 'Dashed',
  solid: 'Solid',
  ticks: 'Ticks',
};

// What a part of a feature's look holds
export type StyleType = 'color'|'icon'|'label'|'number'|'pattern';

interface StyleValues {
  color: string;
  icon: string;
  label: string;
  number: number;
  pattern: PatternName;
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
    stroke: {label: 'Stroke', type: 'color', fallback: DEFAULT_LINE_COLOR},
    width: {label: 'Width', type: 'number', fallback: DEFAULT_MARKER_WIDTH_PX},
  },
  line: {
    label: {label: 'Label', type: 'label', fallback: ''},
    pattern: {label: 'Pattern', type: 'pattern', fallback: 'solid'},
    stroke: {label: 'Stroke', type: 'color', fallback: DEFAULT_LINE_COLOR},
    width: {label: 'Width', type: 'number', fallback: DEFAULT_WIDTH_PX},
  },
  point: {
    fill: {label: 'Fill', type: 'color', fallback: DEFAULT_POINT_COLOR},
    icon: {label: 'Icon', type: 'icon', fallback: DEFAULT_ICON},
    label: {label: 'Label', type: 'label', fallback: ''},
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

// The field types each part reads directly. A label shows a select by its option's label.
export const READS: {[type in StyleType]: FieldType[]} = {
  color: ['color'],
  icon: ['icon'],
  label: ['date', 'number', 'select', 'text'],
  number: ['number'],
  pattern: ['pattern'],
};

export type Channel<T> =
    {kind: 'constant'; value: T}
    |{kind: 'field'; field: string}
    // Each option of a select draws with its own value, and a feature with no option draws with
    // none.
    |{kind: 'by_option'; field: string; values: {[option: string]: T}};

// What a collection without a schema of its own has. Its field ids are the keys geojson.ts writes
// simplestyle into, which adoptImported moves wherever another schema reads them.
export const DEFAULT_COLLECTION_SCHEMA: CollectionSchema = {
  fields: [
    {id: 'name', label: 'Name', type: 'text', hideLabel: true},
    {id: 'description', label: 'Description', type: 'text', hideLabel: true, multiline: true},
    {id: 'stroke', label: 'Stroke', type: 'color', kinds: ['drawing', 'line'], hideLabel: true},
    {
      id: 'width_px',
      label: 'Width (px)',
      type: 'number',
      kinds: ['drawing', 'line'],
      hideLabel: true,
    },
    {id: 'icon', label: 'Icon', type: 'icon', kinds: ['point'], hideLabel: true},
    {id: 'fill', label: 'Fill', type: 'color', kinds: ['point'], hideLabel: true},
  ],
  style: {
    drawing: {
      stroke: {kind: 'field', field: 'stroke'},
      width: {kind: 'field', field: 'width_px'},
      label: {kind: 'field', field: 'name'},
    },
    line: {
      stroke: {kind: 'field', field: 'stroke'},
      width: {kind: 'field', field: 'width_px'},
      pattern: {kind: 'constant', value: 'solid'},
      label: {kind: 'field', field: 'name'},
    },
    point: {
      fill: {kind: 'field', field: 'fill'},
      icon: {kind: 'field', field: 'icon'},
      label: {kind: 'field', field: 'name'},
    },
  },
};

/**
 * Parses collections.schema as the server sends it, which is empty on a collection an importer
 * built. Parts missing from a schema saved before they existed, or that aren't channels, take the
 * default's channel, and fields that aren't fields are dropped, or else drawing would throw.
 */
export function parseCollectionSchema(json: string): CollectionSchema {
  if (!json) {
    return DEFAULT_COLLECTION_SCHEMA;
  }
  const parsed =
      JSON.parse(json) as {fields?: unknown; style?: {[kind: string]: {[part: string]: unknown}}};
  const style = {} as {[kind: string]: {[part: string]: Channel<unknown>}};
  for (const {kind, part} of PARTS) {
    const channel = parsed.style?.[kind]?.[part];
    style[kind] ??= {};
    style[kind][part] =
        isChannel(channel) ? channel : channelOf(DEFAULT_COLLECTION_SCHEMA, kind, part);
  }
  return {
    fields: Array.isArray(parsed.fields) ? parsed.fields.filter(isField) : [],
    style: style as CollectionSchema['style'],
  };
}

const FIELD_TYPES: FieldType[] =
    ['checkbox', 'color', 'date', 'icon', 'number', 'pattern', 'select', 'text'];

function isField(value: unknown): value is FieldDefinition {
  const field = value as Partial<FieldDefinition>|null;
  return typeof field === 'object'
      && field !== null
      && typeof field.id === 'string'
      && typeof field.label === 'string'
      && FIELD_TYPES.includes(field.type as FieldType);
}

// A channel's value is checked when it draws, so only its shape matters here.
function isChannel(value: unknown): value is Channel<unknown> {
  const channel = value as {kind?: unknown; field?: unknown; values?: unknown}|null;
  if (typeof channel !== 'object' || channel === null) {
    return false;
  }
  switch (channel.kind) {
    case 'constant':
      return 'value' in channel;
    case 'field':
      return typeof channel.field === 'string';
    case 'by_option':
      return typeof channel.field === 'string'
          && typeof channel.values === 'object'
          && channel.values !== null;
    default:
      return false;
  }
}

export function channelOf(schema: CollectionSchema, kind: FieldKind, part: string):
    Channel<unknown> {
  return (schema.style[kind] as {[part: string]: Channel<unknown>})[part];
}

export function withChannel(
    schema: CollectionSchema, kind: FieldKind, part: string, channel: Channel<unknown>):
    CollectionSchema {
  return {...schema, style: {...schema.style, [kind]: {...schema.style[kind], [part]: channel}}};
}

/** Returns a channel that reads a select, with colors from OPTION_COLORS when it is a color. */
export function byOption(field: FieldDefinition, type: StyleType): Channel<unknown> {
  const values: {[option: string]: unknown} = {};
  if (type === 'color') {
    (field.options ?? []).forEach((option, i) => {
      values[option.id] = OPTION_COLORS[i % OPTION_COLORS.length];
    });
  }
  return {kind: 'by_option', field: field.id, values};
}

/** Moves a field to just before or after another, or does nothing if either is missing. */
export function moveField(
    schema: CollectionSchema, id: string, target: string, side: 'after'|'before'):
    CollectionSchema {
  const moved = schema.fields.find(f => f.id === id);
  if (!moved || id === target) {
    return schema;
  }
  const fields = schema.fields.filter(f => f.id !== id);
  const at = fields.findIndex(f => f.id === target);
  if (at < 0) {
    return schema;
  }
  fields.splice(side === 'before' ? at : at + 1, 0, moved);
  return {...schema, fields};
}

/**
 * Takes a field off one kind of feature, removing it once no kind shows it, and points that kind's
 * parts that read it at their fallbacks. Feature data is left alone so that undoing the removal
 * brings the values back.
 */
export function removeFieldFrom(schema: CollectionSchema, id: string, kind: FieldKind):
    CollectionSchema {
  const field = schema.fields.find(f => f.id === id);
  if (!field) {
    return schema;
  }

  const kinds = (field.kinds ?? FIELD_KINDS).filter(k => k !== kind);
  let removed = {
    ...schema,
    fields:
        kinds.length > 0
            ? schema.fields.map(f => f.id === id ? {...f, kinds} : f)
            : schema.fields.filter(f => f.id !== id),
  };
  for (const {fallback, part} of PARTS.filter(p => p.kind === kind)) {
    const channel = channelOf(removed, kind, part);
    if (channel.kind !== 'constant' && channel.field === id) {
      removed = withChannel(removed, kind, part, {kind: 'constant', value: fallback});
    }
  }
  return removed;
}

/** Adds an option to a select, giving it the next of OPTION_COLORS in every color split by it. */
export function addOption(schema: CollectionSchema, id: string, label: string): CollectionSchema {
  const field = schema.fields.find(f => f.id === id);
  if (!field) {
    return schema;
  }

  const options = field.options ?? [];
  const option = {id: crypto.randomUUID(), label};
  let added = {
    ...schema,
    fields: schema.fields.map(f => f.id === id ? {...f, options: [...options, option]} : f),
  };
  const color = OPTION_COLORS[options.length % OPTION_COLORS.length];
  for (const {kind, part, type} of PARTS) {
    const channel = channelOf(added, kind, part);
    if (type === 'color' && channel.kind === 'by_option' && channel.field === id) {
      added =
          withChannel(
              added, kind, part, {...channel, values: {...channel.values, [option.id]: color}});
    }
  }
  return added;
}

/** Removes an option from a select, along with the value each part gave it. */
export function removeOption(schema: CollectionSchema, id: string, option: string):
    CollectionSchema {
  let removed = {
    ...schema,
    fields:
        schema.fields.map(f =>
            f.id === id ? {...f, options: (f.options ?? []).filter(o => o.id !== option)} : f),
  };
  for (const {kind, part} of PARTS) {
    const channel = channelOf(removed, kind, part);
    if (channel.kind === 'by_option' && channel.field === id && option in channel.values) {
      const values = {...channel.values};
      delete values[option];
      removed = withChannel(removed, kind, part, {...channel, values});
    }
  }
  return removed;
}

/**
 * Moves the keys that importers write, which are the default schema's fields, into the fields this
 * schema reads the same parts from when those fields are of the same type, and the description
 * into descriptionField.
 */
export function adoptImported(schema: CollectionSchema, feature: EditableFeature): void {
  const kind = fieldKindOf(feature);
  if (kind === 'folder') {
    return;
  }

  const moves: Array<[from: string, to: string]> = [];
  for (const {part} of PARTS.filter(p => p.kind === kind)) {
    const from = channelOf(DEFAULT_COLLECTION_SCHEMA, kind, part);
    const to = channelOf(schema, kind, part);
    if (from.kind !== 'field' || to.kind !== 'field') {
      continue;
    }
    const fromType = DEFAULT_COLLECTION_SCHEMA.fields.find(f => f.id === from.field)?.type;
    if (schema.fields.find(f => f.id === to.field)?.type === fromType) {
      moves.push([from.field, to.field]);
    }
  }
  const description = descriptionField(schema, kind);
  if (description) {
    moves.push(['description', description.id]);
  }

  for (const [from, to] of moves) {
    const value = feature.data[from];
    if (from !== to && value !== undefined) {
      feature.data[to] = value;
      delete feature.data[from];
    }
  }
}

/**
 * Returns the field that holds a feature's description in GeoJSON and GPX, which is the first
 * multiline text field the kind shows.
 */
export function descriptionField(schema: CollectionSchema, kind: FieldKind|'folder'):
    FieldDefinition|undefined {
  return fieldsFor(schema, kind).find(f => f.type === 'text' && f.multiline);
}

/** Returns how a field's value reads to a person, which for a select is its option's label. */
export function formatField(field: FieldDefinition, value: boolean|number|string): string {
  switch (field.type) {
    case 'checkbox':
      return value ? 'Yes' : 'No';
    case 'pattern':
      return PATTERN_LABELS[value as PatternName] ?? String(value);
    case 'select':
      return field.options?.find(o => o.id === value)?.label ?? String(value);
    default:
      return String(value);
  }
}

/** Returns what titles a feature in lists and exports: its label, or a folder's name. */
export function titleOf(schema: CollectionSchema, feature: EditableFeature): string|undefined {
  if (feature.kind === 'folder') {
    return feature.data.name || undefined;
  }
  return feature.kind === 'line'
      ? lineLook(schema, feature).label
      : pointLook(schema, feature.data).label;
}

/**
 * Returns the field that renaming a feature writes, which is the text field its label reads, or
 * nothing when the label is a constant or reads something other than text.
 */
export function titleField(schema: CollectionSchema, feature: EditableFeature): string|undefined {
  const kind = fieldKindOf(feature);
  if (kind === 'folder') {
    return 'name';
  }
  const label = channelOf(schema, kind, 'label');
  return label.kind === 'field' && schema.fields.find(f => f.id === label.field)?.type === 'text'
      ? label.field
      : undefined;
}

/** Returns which kind of feature's fields and style a feature takes. */
export function fieldKindOf(feature: EditableFeature): FieldKind|'folder' {
  return feature.kind === 'line' && isMarker(feature) ? 'drawing' : feature.kind;
}

/** Returns the fields a feature of this kind shows, in schema order. */
export function fieldsFor(schema: CollectionSchema, kind: FieldKind|'folder'): FieldDefinition[] {
  if (kind === 'folder') {
    return [];
  }
  return schema.fields.filter(field => appliesTo(field, kind));
}

export function appliesTo(field: FieldDefinition, kind: FieldKind): boolean {
  return !field.kinds || field.kinds.includes(kind);
}

// Each part is unset when its channel gives nothing usable, so callers fall back to their own
// default.
export interface LineLook {
  label: string|undefined;
  pattern: PatternName|undefined;
  stroke: string|undefined;
  widthPx: number|undefined;
}

export interface PointLook {
  fill: string|undefined;
  icon: string|undefined;
  label: string|undefined;
}

/** Resolves a line's look, or a drawing's, which has no pattern. */
export function lineLook(schema: CollectionSchema, line: EditableLine): LineLook {
  if (isMarker(line)) {
    return {
      label: resolve(schema, 'drawing', 'label', line.data),
      pattern: undefined,
      stroke: resolve(schema, 'drawing', 'stroke', line.data),
      widthPx: resolve(schema, 'drawing', 'width', line.data),
    };
  }
  return {
    label: resolve(schema, 'line', 'label', line.data),
    pattern: resolve(schema, 'line', 'pattern', line.data),
    stroke: resolve(schema, 'line', 'stroke', line.data),
    widthPx: resolve(schema, 'line', 'width', line.data),
  };
}

export function pointLook(schema: CollectionSchema, data: FeatureData): PointLook {
  return {
    fill: resolve(schema, 'point', 'fill', data),
    icon: resolve(schema, 'point', 'icon', data),
    label: resolve(schema, 'point', 'label', data),
  };
}

/** Converts a pattern into the stipple LineProgram takes. */
export function toStipple(name: PatternName|undefined): Stipple {
  return name === 'dashed' ? true
      : name === 'ticks' || name === 'alternating' ? name
      : false;
}

const VALID: {[type in StyleType]: (value: unknown) => boolean} = {
  color: value =>
      typeof value === 'string' && /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value),
  icon: value => typeof value === 'string' && value !== '',
  label: value => typeof value === 'string' && value !== '',
  number: value => typeof value === 'number' && Number.isFinite(value) && value > 0,
  pattern: value => PATTERN_NAMES.includes(value as PatternName),
};

function resolve<K extends FieldKind, P extends PartName<K>>(
    schema: CollectionSchema, kind: K, part: P, data: FeatureData): ValueOf<K, P>|undefined {
  const type = (STYLE[kind][part] as PartSpec).type;
  const channel = channelOf(schema, kind, part);
  let value: unknown;
  if (channel.kind === 'constant') {
    value = channel.value;
  } else if (channel.kind === 'by_option') {
    const option = data[channel.field];
    value = typeof option === 'string' ? channel.values[option] : undefined;
  } else if (type === 'label') {
    value = labelOf(schema, channel.field, data);
  } else {
    value = data[channel.field];
  }
  return VALID[type](value) ? value as ValueOf<K, P> : undefined;
}

function labelOf(schema: CollectionSchema, id: string, data: FeatureData): string|undefined {
  const value = data[id];
  const field = schema.fields.find(f => f.id === id);
  if (field?.type === 'select') {
    return field.options?.find(o => o.id === value)?.label;
  }
  return typeof value === 'number' || typeof value === 'string' ? String(value) : undefined;
}
