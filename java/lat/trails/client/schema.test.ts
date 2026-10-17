import { EditableFeature, EditableLine, EditablePoint, FeatureData } from './features';
import {
  addOption,
  adoptImported,
  Channel,
  channelOf,
  CollectionSchema,
  DEFAULT_COLLECTION_SCHEMA,
  fieldKindOf,
  fieldsFor,
  lineLook,
  moveField,
  OPTION_COLORS,
  parseCollectionSchema,
  pointLook,
  removeFieldFrom,
  removeOption,
  titleField,
  titleOf,
  withChannel,
} from './schema';

// Lines colored by whether their night is booked, with a pattern field and a constant width
const BOOKED: CollectionSchema =
    restyle(
        restyle(
            {
              ...DEFAULT_COLLECTION_SCHEMA,
              fields: [
                {
                  id: 'booked',
                  label: 'Booked',
                  type: 'select',
                  options: [{id: 'yes', label: 'Booked'}, {id: 'no', label: 'Unbooked'}],
                },
                {id: 'pattern', label: 'Pattern', type: 'pattern', kinds: ['line']},
                {id: 'fill', label: 'Point color', type: 'color', kinds: ['point']},
              ],
            },
            'line',
            {
              stroke: {kind: 'by_option', key: 'booked', values: {yes: '#00aa00', no: '#aa0000'}},
              width: {kind: 'constant', value: 5},
              pattern: {kind: 'field', key: 'pattern'},
            }),
        'point',
        {fill: {kind: 'field', key: 'fill'}, icon: {kind: 'constant', value: '⛺'}});

test('the default schema draws the keys features already carry', () => {
  expect(lineLook(DEFAULT_COLLECTION_SCHEMA, line({stroke: '#ff0000', width_px: 4}))).toEqual({
    stroke: '#ff0000',
    widthPx: 4,
    pattern: 'solid',
  });
  expect(pointLook(DEFAULT_COLLECTION_SCHEMA, {fill: '#00ff00', icon: '⛺'})).toEqual({
    fill: '#00ff00',
    icon: '⛺',
    radiusPx: 6,
  });
});

test('an empty schema column is the default', () => {
  expect(parseCollectionSchema('')).toBe(DEFAULT_COLLECTION_SCHEMA);
});

test('parts a saved layer lacks take the default', () => {
  const parsed = parseCollectionSchema(JSON.stringify({
    fields: [],
    layers: [{kind: 'line', filters: [], width: {kind: 'constant', value: 7}}],
  }));
  expect(channelOf(parsed, 'line', 'width')).toEqual({kind: 'constant', value: 7});
  expect(channelOf(parsed, 'line', 'stroke'))
      .toBe(channelOf(DEFAULT_COLLECTION_SCHEMA, 'line', 'stroke'));
  expect(parsed.layers.map(l => l.kind)).toEqual(['line']);
});

test('malformed parts take the default and malformed fields and layers are dropped', () => {
  const parsed = parseCollectionSchema(JSON.stringify({
    fields: [{id: 'ok', label: 'Ok', type: 'text'}, {id: 'bad', type: 'text'}, 'nope'],
    layers: [
      {kind: 'line', filters: [], stroke: {kind: 'field'}, width: 'wide'},
      {kind: 'blob', filters: []},
      {kind: 'point'},
    ],
  }));
  expect(parsed.fields.map(f => f.id)).toEqual(['ok']);
  expect(parsed.layers.map(l => l.kind)).toEqual(['line']);
  expect(channelOf(parsed, 'line', 'stroke'))
      .toBe(channelOf(DEFAULT_COLLECTION_SCHEMA, 'line', 'stroke'));
  expect(channelOf(parsed, 'line', 'width'))
      .toBe(channelOf(DEFAULT_COLLECTION_SCHEMA, 'line', 'width'));
});

test('a schema saved with one style per kind becomes one layer per kind', () => {
  const parsed = parseCollectionSchema(JSON.stringify({
    fields: [],
    style: {line: {stroke: {kind: 'field', field: 'tint'}, width: {kind: 'constant', value: 3}}},
  }));
  expect(parsed.layers.map(l => l.kind)).toEqual(['drawing', 'line', 'point']);
  expect(channelOf(parsed, 'line', 'stroke')).toEqual({kind: 'field', key: 'tint'});
  expect(channelOf(parsed, 'line', 'width')).toEqual({kind: 'constant', value: 3});
  expect(channelOf(parsed, 'point', 'icon'))
      .toBe(channelOf(DEFAULT_COLLECTION_SCHEMA, 'point', 'icon'));
});

test('styling a kind without a layer adds one', () => {
  const lines = parseCollectionSchema(JSON.stringify({
    fields: [],
    layers: [{kind: 'line', filters: []}],
  }));
  const restyled = withChannel(lines, 'point', 'icon', {kind: 'constant', value: '⛺'});
  expect(restyled.layers.map(l => l.kind)).toEqual(['line', 'point']);
  expect(channelOf(restyled, 'point', 'icon')).toEqual({kind: 'constant', value: '⛺'});
  expect(channelOf(restyled, 'point', 'fill'))
      .toBe(channelOf(DEFAULT_COLLECTION_SCHEMA, 'point', 'fill'));
});

test('a feature draws with the first layer whose filters match', () => {
  const schema: CollectionSchema = {
    fields: [],
    layers: [{
      kind: 'point',
      filters: [{match: 'string_equals', key: 'status', value: 'closed'}],
      fill: {kind: 'constant', value: '#ff0000'},
      icon: {kind: 'constant', value: '⛺'},
      radius: {kind: 'constant', value: 6},
      label: {kind: 'constant', value: 'Closed'},
    }, {
      kind: 'point',
      filters: [{match: 'always'}],
      fill: {kind: 'constant', value: '#00ff00'},
      icon: {kind: 'constant', value: '⛺'},
      radius: {kind: 'constant', value: 6},
      label: {kind: 'field', key: 'name'},
    }],
  };
  expect(pointLook(schema, {status: 'closed', name: 'Camp'}))
      .toEqual({fill: '#ff0000', icon: '⛺', label: 'Closed', radiusPx: 6});
  expect(pointLook(schema, {name: 'Camp'}))
      .toEqual({fill: '#00ff00', icon: '⛺', label: 'Camp', radiusPx: 6});
});

test('a value per option picks by the feature\'s option and leaves the rest unset', () => {
  expect(lineLook(BOOKED, line({booked: 'yes'})).stroke).toBe('#00aa00');
  expect(lineLook(BOOKED, line({booked: 'no'})).stroke).toBe('#aa0000');
  expect(lineLook(BOOKED, line({})).stroke).toBeUndefined();
});

test('a feature\'s own stroke is ignored once the color comes from elsewhere', () => {
  expect(lineLook(BOOKED, line({booked: 'yes', stroke: '#123456'})).stroke).toBe('#00aa00');
});

test('constants apply to every feature', () => {
  expect(lineLook(BOOKED, line({width_px: 9})).widthPx).toBe(5);
  expect(pointLook(BOOKED, {}).icon).toBe('⛺');
});

test('a schema saved before points had a radius draws them at the default', () => {
  const parsed = parseCollectionSchema(JSON.stringify({
    fields: [],
    style: {point: {icon: {kind: 'constant', value: '⛺'}}},
  }));
  expect(channelOf(parsed, 'point', 'radius')).toEqual({kind: 'constant', value: 6});
  expect(pointLook(parsed, {}).radiusPx).toBe(6);
});

test('a field value of the wrong type draws as unset', () => {
  expect(lineLook(BOOKED, line({pattern: 'wavy'})).pattern).toBeUndefined();
  expect(lineLook(BOOKED, line({pattern: 'dashed'})).pattern).toBe('dashed');
  expect(pointLook(BOOKED, {fill: 'green'}).fill).toBeUndefined();
  expect(lineLook(DEFAULT_COLLECTION_SCHEMA, line({width_px: -1})).widthPx).toBeUndefined();
});

test('removing a field from lines unbinds only the line parts that read it', () => {
  const removed = removeFieldFrom(BOOKED, 'booked', 'line');
  expect(removed.fields.find(f => f.id === 'booked')?.kinds)
      .toEqual(['drawing', 'point', 'polygon']);
  expect(channelOf(removed, 'line', 'stroke')).toEqual({kind: 'constant', value: '#de29db'});
  expect(channelOf(removed, 'line', 'pattern')).toBe(channelOf(BOOKED, 'line', 'pattern'));
  expect(removed.layers[2]).toBe(BOOKED.layers[2]);
});

test('removing a field from its last kind removes it', () => {
  const removed = removeFieldFrom(BOOKED, 'pattern', 'line');
  expect(removed.fields.map(f => f.id)).toEqual(['booked', 'fill']);
  expect(channelOf(removed, 'line', 'pattern')).toEqual({kind: 'constant', value: 'solid'});
});

test('fields show on the kinds they name', () => {
  expect(fieldsFor(BOOKED, 'line').map(f => f.id)).toEqual(['booked', 'pattern']);
  expect(fieldsFor(BOOKED, 'point').map(f => f.id)).toEqual(['booked', 'fill']);
  expect(fieldsFor(BOOKED, 'folder')).toEqual([]);
});

test('moves a field before or after another', () => {
  const ids = (schema: CollectionSchema) => schema.fields.map(f => f.id);
  expect(ids(moveField(BOOKED, 'fill', 'booked', 'before'))).toEqual(['fill', 'booked', 'pattern']);
  expect(ids(moveField(BOOKED, 'booked', 'pattern', 'after')))
      .toEqual(['pattern', 'booked', 'fill']);
  expect(moveField(BOOKED, 'booked', 'booked', 'after')).toBe(BOOKED);
});

test('a drawing takes its look from the drawing parts', () => {
  const schema =
      restyle(DEFAULT_COLLECTION_SCHEMA, 'drawing', {width: {kind: 'constant', value: 12}});
  const drawing = line({marker_zoom: 14, stroke: '#123456', width_px: 3});
  expect(fieldKindOf(drawing)).toBe('drawing');
  expect(lineLook(schema, drawing)).toEqual({pattern: undefined, stroke: '#123456', widthPx: 12});
  expect(lineLook(schema, line({width_px: 3})).widthPx).toBe(3);
});

test('removing a field from drawings leaves lines reading it', () => {
  const removed = removeFieldFrom(DEFAULT_COLLECTION_SCHEMA, 'stroke', 'drawing');
  expect(removed.fields.find(f => f.id === 'stroke')?.kinds).toEqual(['line']);
  expect(channelOf(removed, 'drawing', 'stroke')).toEqual({kind: 'constant', value: '#de29db'});
  expect(channelOf(removed, 'line', 'stroke'))
      .toBe(channelOf(DEFAULT_COLLECTION_SCHEMA, 'line', 'stroke'));
});

test('labels come from text, numbers, and option labels', () => {
  expect(lineLook(BOOKED, line({name: 'Day 1'})).label).toBe('Day 1');
  expect(lineLook(BOOKED, line({})).label).toBeUndefined();
  const byBooking = restyle(BOOKED, 'point', {label: {kind: 'field', key: 'booked'}});
  expect(pointLook(byBooking, {booked: 'yes'}).label).toBe('Booked');
  const byNumber = restyle(BOOKED, 'point', {label: {kind: 'field', key: 'elevation'}});
  expect(pointLook(byNumber, {elevation: 2400}).label).toBe('2400');
  expect(lineLook(BOOKED, line({marker_zoom: 14, name: 'Scribble'})).label).toBe('Scribble');
});

test('a new option gets the next color in every color split by its select', () => {
  const added = addOption(BOOKED, 'booked', 'Maybe');
  const maybe = added.fields[0].options![2];
  expect(maybe.label).toBe('Maybe');
  expect(lineLook(added, line({booked: maybe.id})).stroke).toBe(OPTION_COLORS[2]);
});

test('removing an option drops the values given to it', () => {
  const removed = removeOption(BOOKED, 'booked', 'no');
  expect(removed.fields[0].options!.map(o => o.id)).toEqual(['yes']);
  expect(channelOf(removed, 'line', 'stroke'))
      .toEqual({kind: 'by_option', key: 'booked', values: {yes: '#00aa00'}});
});

test('imported style keys move to the fields the schema reads', () => {
  const imported = point({name: 'Camp', fill: '#00ff00', icon: '⛺'});
  adoptImported(BOOKED, imported);
  expect(imported.data).toEqual({name: 'Camp', fill: '#00ff00', icon: '⛺'});

  const elsewhere =
      restyle(
          {...BOOKED, fields: [...BOOKED.fields, {id: 'tint', label: 'Tint', type: 'color'}]},
          'point',
          {fill: {kind: 'field', key: 'tint'}});
  adoptImported(elsewhere, imported);
  expect(imported.data).toEqual({name: 'Camp', tint: '#00ff00', icon: '⛺'});
});

test('imported keys stay put when the field read instead is of another type', () => {
  const imported = point({name: 'Camp'});
  const byStatus = restyle(BOOKED, 'point', {label: {kind: 'field', key: 'booked'}});
  adoptImported(byStatus, imported);
  expect(imported.data).toEqual({name: 'Camp'});
});

test('an imported description moves to the first multiline text field', () => {
  const imported = point({name: 'Camp', description: 'By the lake'});
  const notes: CollectionSchema = {
    ...DEFAULT_COLLECTION_SCHEMA,
    fields: [{id: 'notes', label: 'Notes', type: 'text', multiline: true}],
  };
  adoptImported(notes, imported);
  expect(imported.data).toEqual({name: 'Camp', notes: 'By the lake'});

  const kept = point({description: 'By the lake'});
  adoptImported(DEFAULT_COLLECTION_SCHEMA, kept);
  expect(kept.data).toEqual({description: 'By the lake'});
});

test('a feature is titled by its label and renamed through the text field it reads', () => {
  const camp = point({name: 'Camp', booked: 'yes'});
  expect(titleOf(DEFAULT_COLLECTION_SCHEMA, camp)).toBe('Camp');
  expect(titleField(DEFAULT_COLLECTION_SCHEMA, camp)).toBe('name');

  const byStatus = restyle(BOOKED, 'point', {label: {kind: 'field', key: 'booked'}});
  expect(titleOf(byStatus, camp)).toBe('Booked');
  expect(titleField(byStatus, camp)).toBeUndefined();

  const folder: EditableFeature = {kind: 'folder', id: 'f', version: 0n, data: {name: 'Trip'}};
  expect(titleOf(byStatus, folder)).toBe('Trip');
  expect(titleField(byStatus, folder)).toBe('name');
});

function restyle(
    schema: CollectionSchema,
    kind: 'drawing'|'line'|'point',
    parts: {[part: string]: Channel<unknown>}): CollectionSchema {
  return Object.entries(parts)
      .reduce((restyled, [part, channel]) => withChannel(restyled, kind, part, channel), schema);
}

function line(data: FeatureData): EditableLine {
  return {
    kind: 'line',
    id: 'line',
    version: 0n,
    data,
    latLngE7: new Int32Array(4),
    elevationCentimeters: undefined,
    timeSeconds: undefined,
  };
}

function point(data: FeatureData): EditablePoint {
  return {
    kind: 'point',
    id: 'point',
    version: 0n,
    data,
    latE7: 0,
    lngE7: 0,
    elevationCentimeters: undefined,
  };
}
