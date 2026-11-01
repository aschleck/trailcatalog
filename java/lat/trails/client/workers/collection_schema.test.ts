import { CollectionSchema, getDrawnFields } from './collection_schema';

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
    {id: 'symbol', kind: 'point', label: 'Symbol', type: 'icon'},
    {id: 'size', kind: 'point', label: 'Size', type: 'number'},
  ],
  layers: [{
    kind: 'polygon',
    filters: [],
    fill: {kind: 'by_option', key: 'status', values: {open: '#00ff0080', closed: '#ff000080'}},
    stroke: {kind: 'constant', value: '#008000'},
    width: {kind: 'constant', value: 2},
    pattern: {kind: 'constant', value: 'solid'},
    label: {kind: 'field', key: 'name'},
  }, {
    kind: 'point',
    filters: [{match: 'string_equals', key: 'type', value: 'hut'}],
    fill: {kind: 'field', key: 'tint'},
    icon: {kind: 'field', key: 'symbol'},
    radius: {kind: 'constant', value: 6},
    label: {kind: 'field', key: 'name'},
  }, {
    kind: 'point',
    filters: [],
    fill: {kind: 'constant', value: '#ff0000'},
    icon: {kind: 'field', key: 'symbol'},
    radius: {kind: 'field', key: 'size'},
    label: {kind: 'field', key: 'name'},
  }],
};

test('drawn fields are the ones the matching layer reads directly', () => {
  expect(getDrawnFields(SCHEMA, 'point', {type: 'hut'})).toEqual(new Set(['tint', 'symbol']));
  expect(getDrawnFields(SCHEMA, 'point', {type: 'camp'})).toEqual(new Set(['symbol', 'size']));
});

test('labels and splits by option are not drawn fields', () => {
  expect(getDrawnFields(SCHEMA, 'polygon', {})).toEqual(new Set());
});

test('a kind without a layer has no drawn fields', () => {
  expect(getDrawnFields(SCHEMA, 'line', {})).toEqual(new Set());
});
