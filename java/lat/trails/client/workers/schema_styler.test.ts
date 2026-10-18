import { CollectionSchema, DEFAULT_COLOR, parseColor } from './collection_schema';
import { SchemaStyler } from './schema_styler';

// Closed areas drawn by status, rated points sized by a field, and trails dashed until visited
const SCHEMA: CollectionSchema = {
  fields: [
    {
      id: 'status',
      kind: 'polygon',
      label: 'Status',
      type: 'select',
      options: [{id: 'open', label: 'Open'}, {id: 'closed', label: 'Closed'}],
    },
    {id: 'tint', kind: 'point', label: 'Tint', type: 'color'},
    {id: 'size', kind: 'point', label: 'Size', type: 'number'},
    {id: 'visited', kind: 'line', label: 'Visited', type: 'checkbox'},
  ],
  layers: [{
    kind: 'polygon',
    filters: [{match: 'string_equals', key: 'type', value: 'park'}],
    fill: {kind: 'by_option', key: 'status', values: {open: '#00ff0080', closed: '#ff000080'}},
    stroke: {kind: 'constant', value: '#008000'},
    width: {kind: 'constant', value: 2},
    pattern: {kind: 'constant', value: 'solid'},
    label: {kind: 'field', key: 'name'},
  }, {
    kind: 'point',
    filters: [],
    fill: {kind: 'field', key: 'tint'},
    icon: {kind: 'constant', value: '⛺'},
    radius: {kind: 'field', key: 'size'},
    label: {kind: 'field', key: 'name'},
  }, {
    kind: 'line',
    filters: [],
    stroke: {kind: 'constant', value: '#0000ff'},
    width: {kind: 'constant', value: 4},
    pattern: {kind: 'by_option', key: 'visited', values: {true: 'solid', false: 'dashed'}},
    label: {kind: 'field', key: 'name'},
  }],
};

test('a polygon no layer matches is dropped', () => {
  const styler = new SchemaStyler(SCHEMA);
  expect(styler.polygon({type: 'park', status: 'closed'})?.fill).toBe(parseColor('#ff000080'));
  expect(styler.polygon({type: 'forest', status: 'closed'})).toBeUndefined();
});

test('a polygon outlines with its stroke unless the stroke is clear', () => {
  const outlined = new SchemaStyler(SCHEMA).polygon({type: 'park'});
  expect(outlined?.outline?.fill).toBe(parseColor('#008000'));

  const clear: CollectionSchema = {
    fields: [],
    layers: [{
      kind: 'polygon',
      filters: [],
      fill: {kind: 'constant', value: '#00ff0080'},
      stroke: {kind: 'constant', value: '#00000000'},
      width: {kind: 'constant', value: 2},
      pattern: {kind: 'constant', value: 'solid'},
      label: {kind: 'field', key: 'name'},
    }],
  };
  expect(new SchemaStyler(clear).polygon({})?.outline).toBeUndefined();
});

test('a point takes its color and radius from its own fields', () => {
  const styler = new SchemaStyler(SCHEMA);
  const style = styler.point({tint: '#123456', size: 9});
  expect(style?.fill).toBe(parseColor('#123456'));
  expect(style?.radius).toBe(9);
});

test('a line split by a checkbox dashes until it is checked', () => {
  const styler = new SchemaStyler(SCHEMA);
  expect(styler.line({visited: true})?.stipple).toBe(false);
  expect(styler.line({})?.stipple).toBe(true);
  expect(styler.line({})?.radius).toBe(3);
});

test('objects that look alike share a style', () => {
  const styler = new SchemaStyler(SCHEMA);
  expect(styler.point({tint: '#123456'})).toBe(styler.point({tint: '#123456', name: 'Camp'}));
  expect(styler.point({tint: '#123456'})).not.toBe(styler.point({tint: '#654321'}));
});

test('a part that resolves to nothing draws with the default', () => {
  const styler = new SchemaStyler({
    fields: [],
    layers: [{
      kind: 'line',
      filters: [],
      stroke: {kind: 'field', key: 'stroke'},
      width: {kind: 'field', key: 'width_px'},
      pattern: {kind: 'constant', value: 'solid'},
      label: {kind: 'field', key: 'name'},
    }],
  });
  expect(styler.line({})?.fill).toBe(parseColor(DEFAULT_COLOR));
});
