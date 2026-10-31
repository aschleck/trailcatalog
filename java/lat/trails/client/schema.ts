import { checkExists } from 'external/dev_april_corgi+/js/common/asserts';

import { PointCategory, WayCategory } from 'java/org/trailcatalog/models/categories';
import { LinePattern } from 'js/map/rendering/line_program';

import { EditableFeature, FeatureData } from './features';
import { Data } from './workers/collection_loader';
import {
  Channel,
  CollectionSchema,
  DEFAULT_COLOR,
  DEFAULT_POINT_RADIUS_PX,
  FIELD_KINDS,
  FieldDefinition,
  FieldKind,
  FieldRef,
  FieldType,
  getField,
  getLineKind,
  isValidFieldValue,
  lineLook,
  PARTS,
  pointLook,
  polygonLook,
  SelectOption,
  splitOptions,
  StyleLayer,
  StyleType,
} from './workers/collection_schema';

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

// The open collection's schema, with the version the server last stamped on it, which a put of it
// sends back the way a feature's does
export interface SavedSchema {
  schema: CollectionSchema;
  version: bigint;
}

// Given to new options in turn, so that a color split by a select starts out telling them apart.
// Every pair is at least 15 OKLab ΔE×100 apart, and every adjacent pair at least 8 under simulated
// protanopia and deuteranopia, so the first few options stay distinct for colorblind readers too.
// Gold and cyan are under 3:1 against the basemap's cream, so lines in them lean on the darkened
// edge LineProgram draws.
//
// magenta, green, blue, orange, cyan, red, charcoal, gold
export const OPTION_COLORS = [
  DEFAULT_COLOR,
  '#179a53',
  '#0d3bea',
  '#dc6322',
  '#13adcf',
  '#c10231',
  '#2a3045',
  '#c5a101',
];

export const PATTERN_LABELS: {[name in LinePattern]: string} = {
  alternating: 'Alternating',
  dashed: 'Dashed',
  dotted: 'Dotted',
  fine_dotted: 'Fine dots',
  short_dashed: 'Short dashes',
  solid: 'Solid',
  ticks: 'Ticks',
};

// The field types each part reads directly. A label shows a select by its option's label.
export const READS: {[type in StyleType]: FieldType[]} = {
  color: ['color'],
  icon: ['icon'],
  label: ['date', 'number', 'select', 'text'],
  number: ['number'],
  pattern: ['pattern'],
};

// What a collection without a schema of its own has. Its field ids are the keys geojson.ts writes
// simplestyle into, which adoptImported moves wherever another schema reads them.
export const DEFAULT_COLLECTION_SCHEMA: CollectionSchema = {
  fields: [
    ...FIELD_KINDS.flatMap((kind): FieldDefinition[] => [
      {id: 'name', kind, label: 'Name', type: 'text', hideLabel: true},
      {
        id: 'description',
        kind,
        label: 'Description',
        type: 'text',
        hideLabel: true,
        multiline: true,
      },
    ]),
    {id: 'stroke', kind: 'drawing', label: 'Stroke', type: 'color', hideLabel: true},
    {id: 'width_px', kind: 'drawing', label: 'Width (px)', type: 'number', hideLabel: true},
    {id: 'stroke', kind: 'line', label: 'Stroke', type: 'color', hideLabel: true},
    {id: 'width_px', kind: 'line', label: 'Width (px)', type: 'number', hideLabel: true},
    {id: 'icon', kind: 'point', label: 'Icon', type: 'icon', hideLabel: true},
    {id: 'fill', kind: 'point', label: 'Fill', type: 'color', hideLabel: true},
    {id: 'fill', kind: 'polygon', label: 'Fill', type: 'color', hideLabel: true},
    {id: 'stroke', kind: 'polygon', label: 'Stroke', type: 'color', hideLabel: true},
    {id: 'width_px', kind: 'polygon', label: 'Width (px)', type: 'number', hideLabel: true},
  ],
  layers: [{
    kind: 'drawing',
    filters: [],
    stroke: {kind: 'field', key: 'stroke'},
    width: {kind: 'field', key: 'width_px'},
    label: {kind: 'field', key: 'name'},
  }, {
    kind: 'line',
    filters: [],
    stroke: {kind: 'field', key: 'stroke'},
    width: {kind: 'field', key: 'width_px'},
    pattern: {kind: 'constant', value: 'solid'},
    label: {kind: 'field', key: 'name'},
  }, {
    kind: 'point',
    filters: [],
    fill: {kind: 'field', key: 'fill'},
    icon: {kind: 'field', key: 'icon'},
    radius: {kind: 'constant', value: DEFAULT_POINT_RADIUS_PX},
    label: {kind: 'field', key: 'name'},
  }, {
    kind: 'polygon',
    filters: [],
    fill: {kind: 'field', key: 'fill'},
    stroke: {kind: 'field', key: 'stroke'},
    width: {kind: 'field', key: 'width_px'},
    pattern: {kind: 'constant', value: 'solid'},
    label: {kind: 'field', key: 'name'},
  }],
};

export function parseCollectionSchema(json: string): CollectionSchema {
  if (!json) {
    return DEFAULT_COLLECTION_SCHEMA;
  }
  const parsed = JSON.parse(json) as {fields?: unknown; layers?: unknown};
  return {
    fields: Array.isArray(parsed.fields) ? parsed.fields.filter(isField) : [],
    layers: (Array.isArray(parsed.layers) ? parsed.layers : []).flatMap(layer => {
      const {kind, filters} = (layer ?? {}) as {kind?: unknown; filters?: unknown};
      if (!FIELD_KINDS.includes(kind as FieldKind) || !Array.isArray(filters)) {
        return [];
      }
      const parts = {} as {[part: string]: Channel<unknown>};
      for (const {fallback, part} of PARTS.filter(p => p.kind === kind)) {
        const channel = (layer as {[part: string]: unknown})[part];
        parts[part] = isChannel(channel) ? channel : defaultChannel(kind as FieldKind, part);
      }
      return [{kind, filters, ...parts} as StyleLayer];
    }),
  };
}

function defaultChannel(kind: FieldKind, part: string): Channel<unknown> {
  const layer =
      DEFAULT_COLLECTION_SCHEMA.layers.find(l => l.kind === kind) as
          {[part: string]: Channel<unknown>}|undefined;
  const fallback = checkExists(PARTS.find(p => p.kind === kind && p.part === part)).fallback;
  return layer?.[part] ?? {kind: 'constant', value: fallback};
}

const FIELD_TYPES: FieldType[] =
    ['checkbox', 'color', 'date', 'icon', 'number', 'pattern', 'select', 'text'];

function isField(value: unknown): value is FieldDefinition {
  const field = value as Partial<FieldDefinition>|null;
  return typeof field === 'object'
      && field !== null
      && typeof field.id === 'string'
      && FIELD_KINDS.includes(field.kind as FieldKind)
      && typeof field.label === 'string'
      && FIELD_TYPES.includes(field.type as FieldType);
}

// A channel's value is checked when it draws, so only its shape matters here.
function isChannel(value: unknown): value is Channel<unknown> {
  const channel = value as {kind?: unknown; key?: unknown; values?: unknown}|null;
  if (typeof channel !== 'object' || channel === null) {
    return false;
  }
  switch (channel.kind) {
    case 'constant':
      return 'value' in channel;
    case 'field':
      return typeof channel.key === 'string';
    case 'by_option':
      return typeof channel.key === 'string'
          && typeof channel.values === 'object'
          && channel.values !== null;
    default:
      return false;
  }
}

/** Returns a part's channel in the first layer of a kind, which the style panel edits. */
export function channelOf(schema: CollectionSchema, kind: FieldKind, part: string):
    Channel<unknown> {
  const layer =
      schema.layers.find(l => l.kind === kind) as {[part: string]: Channel<unknown>}|undefined;
  return layer?.[part] ?? defaultChannel(kind, part);
}

export function withChannel(
    schema: CollectionSchema, kind: FieldKind, part: string, channel: Channel<unknown>):
    CollectionSchema {
  const at = schema.layers.findIndex(l => l.kind === kind);
  if (at < 0) {
    const parts = {} as {[part: string]: Channel<unknown>};
    for (const p of PARTS.filter(p => p.kind === kind)) {
      parts[p.part] = defaultChannel(kind, p.part);
    }
    parts[part] = channel;
    const layer = {kind, filters: [], ...parts} as unknown as StyleLayer;
    return {...schema, layers: [...schema.layers, layer]};
  }
  return {
    ...schema,
    layers: schema.layers.map((l, i) => i === at ? {...l, [part]: channel} as StyleLayer : l),
  };
}

/**
 * Returns a channel that reads a select or checkbox, with colors from OPTION_COLORS when it is a
 * color.
 */
export function byOption(field: FieldDefinition, type: StyleType): Channel<unknown> {
  const values: {[option: string]: unknown} = {};
  if (type === 'color') {
    splitOptions(field).forEach((option, i) => {
      values[option.id] = OPTION_COLORS[i % OPTION_COLORS.length];
    });
  }
  return {kind: 'by_option', key: field.id, values};
}

/** Moves a field before or after another of its kind, or does nothing if either is missing. */
export function moveField(
    schema: CollectionSchema, {kind, id}: FieldRef, target: string, side: 'after'|'before'):
    CollectionSchema {
  const moved = getField(schema, kind, id);
  if (!moved || id === target) {
    return schema;
  }
  const fields = schema.fields.filter(f => f !== moved);
  const at = fields.findIndex(f => f.kind === kind && f.id === target);
  if (at < 0) {
    return schema;
  }
  fields.splice(side === 'before' ? at : at + 1, 0, moved);
  return {...schema, fields};
}

/**
 * Removes a kind's field and points that kind's parts that read it at their fallbacks. Feature data
 * is left alone so that undoing the removal brings the values back.
 */
export function removeField(schema: CollectionSchema, {kind, id}: FieldRef): CollectionSchema {
  const field = getField(schema, kind, id);
  if (!field) {
    return schema;
  }

  let removed = {...schema, fields: schema.fields.filter(f => f !== field)};
  for (const {fallback, part} of PARTS.filter(p => p.kind === kind)) {
    const channel = channelOf(removed, kind, part);
    if (channel.kind !== 'constant' && channel.key === id) {
      removed = withChannel(removed, kind, part, {kind: 'constant', value: fallback});
    }
  }
  return removed;
}

/** Adds an option to a select, giving it the next of OPTION_COLORS in every color split by it. */
export function addOption(schema: CollectionSchema, {kind, id}: FieldRef, label: string):
    CollectionSchema {
  const field = getField(schema, kind, id);
  if (!field) {
    return schema;
  }

  const options = field.options ?? [];
  const option = {id: crypto.randomUUID(), label};
  let added = {
    ...schema,
    fields: schema.fields.map(f => f === field ? {...f, options: [...options, option]} : f),
  };
  const color = OPTION_COLORS[options.length % OPTION_COLORS.length];
  for (const {part, type} of PARTS.filter(p => p.kind === kind)) {
    const channel = channelOf(added, kind, part);
    if (type === 'color' && channel.kind === 'by_option' && channel.key === id) {
      added =
          withChannel(
              added, kind, part, {...channel, values: {...channel.values, [option.id]: color}});
    }
  }
  return added;
}

/** Removes an option from a select, along with the value each part gave it. */
export function removeOption(schema: CollectionSchema, {kind, id}: FieldRef, option: string):
    CollectionSchema {
  const field = getField(schema, kind, id);
  if (!field) {
    return schema;
  }

  let removed = {
    ...schema,
    fields:
        schema.fields.map(f =>
            f === field ? {...f, options: (f.options ?? []).filter(o => o.id !== option)} : f),
  };
  for (const {part} of PARTS.filter(p => p.kind === kind)) {
    const channel = channelOf(removed, kind, part);
    if (channel.kind === 'by_option' && channel.key === id && option in channel.values) {
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
  const kind = getFieldKind(feature);
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
    const fromType = getField(DEFAULT_COLLECTION_SCHEMA, kind, from.key)?.type;
    if (getField(schema, kind, to.key)?.type === fromType) {
      moves.push([from.key, to.key]);
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
      return PATTERN_LABELS[value as LinePattern] ?? String(value);
    case 'select':
      return field.options?.find(o => o.id === value)?.label ?? String(value);
    default:
      return String(value);
  }
}

/** Returns what titles a feature in lists and exports: its label, or a folder's name. */
export function getTitle(schema: CollectionSchema, feature: EditableFeature): string|undefined {
  if (feature.kind === 'folder') {
    return feature.data.name || undefined;
  }
  const look =
      feature.kind === 'line' ? lineLook(schema, feature.data)
          : feature.kind === 'point' ? pointLook(schema, feature.data)
          : polygonLook(schema, feature.data);
  return look?.label || undefined;
}

/**
 * Returns what titles an object from a map layer. An OpenStreetMap title key holds an element id,
 * so the element goes by its name, or else by its category, which still tells it apart from its
 * neighbors.
 */
export function getObjectTitle(schema: Schema, data: Data): string|undefined {
  const title =
      schema.title.kind === 'text'
          ? data[schema.title.key]
          : data.name
              ?? categoryName(
                  schema.title.kind === 'osm_way' ? WayCategory : PointCategory, data.type);
  return title !== undefined ? String(title) : undefined;
}

// The most specific part of a category's name, like Footway for PATH_FOOTWAY
function categoryName(names: Record<number, string>, type: unknown): string|undefined {
  const name = typeof type === 'number' ? names[type] : undefined;
  if (!name) {
    return undefined;
  }
  const parts = name.split('_');
  const words = (parts.length > 1 ? parts.slice(1) : parts).join(' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.substring(1);
}

/**
 * Returns the field that renaming a feature writes, which is the text field its label reads, or
 * nothing when the label is a constant or reads something other than text.
 */
export function titleField(schema: CollectionSchema, feature: EditableFeature): string|undefined {
  const kind = getFieldKind(feature);
  if (kind === 'folder') {
    return 'name';
  }
  const label = channelOf(schema, kind, 'label');
  return label.kind === 'field' && getField(schema, kind, label.key)?.type === 'text'
      ? label.key
      : undefined;
}

/** Returns which kind of feature's fields and style a feature takes. */
export function getFieldKind(feature: EditableFeature): FieldKind|'folder' {
  return feature.kind === 'line' ? getLineKind(feature.data) : feature.kind;
}

/** Returns the fields a feature of this kind shows, in schema order. */
export function fieldsFor(schema: CollectionSchema, kind: FieldKind|'folder'): FieldDefinition[] {
  if (kind === 'folder') {
    return [];
  }
  return schema.fields.filter(field => field.kind === kind);
}

/** Returns a new feature's data with its fields' defaults under whatever it already has. */
export function withDefaults(schema: CollectionSchema, feature: EditableFeature): FeatureData {
  const defaults: FeatureData = {};
  for (const field of fieldsFor(schema, getFieldKind(feature))) {
    if (field.default !== undefined && isValidFieldValue(field, field.default)) {
      defaults[field.id] = field.default;
    }
  }
  return {...defaults, ...feature.data};
}
