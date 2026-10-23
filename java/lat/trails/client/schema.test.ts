import { EditableFeature, EditableLine, EditablePoint, FeatureData } from './features';
import {
  addOption,
  adoptImported,
  byOption,
  channelOf,
  DEFAULT_COLLECTION_SCHEMA,
  fieldsFor,
  getFieldKind,
  getTitle,
  moveField,
  OPTION_COLORS,
  parseCollectionSchema,
  removeField,
  removeOption,
  titleField,
  withChannel,
  withDefaults,
} from './schema';
import {
  Channel,
  CollectionSchema,
  DEFAULT_COLOR,
  DEFAULT_ICON,
  DEFAULT_MARKER_WIDTH_PX,
  DEFAULT_WIDTH_PX,
  FieldDefinition,
  lineLook,
  pointLook,
  StyleLayer,
} from './workers/collection_schema';

const BOOKED_SELECT = {
  id: 'booked',
  label: 'Booked',
  type: 'select',
  options: [{id: 'yes', label: 'Booked'}, {id: 'no', label: 'Unbooked'}],
} as const satisfies Omit<FieldDefinition, 'kind'>;

// Lines colored by whether their night is booked, with a pattern field and a constant width, and
// points with a booked select of their own
const BOOKED: CollectionSchema =
    restyle(
        restyle(
            {
              ...DEFAULT_COLLECTION_SCHEMA,
              fields: [
                {...BOOKED_SELECT, kind: 'line', options: [...BOOKED_SELECT.options]},
                {id: 'pattern', kind: 'line', label: 'Pattern', type: 'pattern'},
                {...BOOKED_SELECT, kind: 'point', options: [...BOOKED_SELECT.options]},
                {id: 'fill', kind: 'point', label: 'Point color', type: 'color'},
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
  expect(lineLook(DEFAULT_COLLECTION_SCHEMA, {stroke: '#ff0000', width_px: 4})).toEqual({
    casing: '',
    halo: '#00000000',
    label: '',
    stroke: '#ff0000',
    widthPx: 4,
    pattern: 'solid',
  });
  expect(pointLook(DEFAULT_COLLECTION_SCHEMA, {fill: '#00ff00', icon: '⛺'})).toEqual({
    fill: '#00ff00',
    icon: '⛺',
    label: '',
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
    fields: [
      {id: 'ok', kind: 'line', label: 'Ok', type: 'text'},
      {id: 'kindless', label: 'Kindless', type: 'text'},
      {id: 'bad', kind: 'line', type: 'text'},
      'nope',
    ],
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

test('a feature no layer matches has no look', () => {
  const schema: CollectionSchema = {
    fields: [],
    layers: [{
      ...DEFAULT_COLLECTION_SCHEMA.layers[2],
      filters: [{match: 'string_equals', key: 'status', value: 'open'}],
    } as StyleLayer],
  };
  expect(pointLook(schema, {status: 'open'})).toBeDefined();
  expect(pointLook(schema, {status: 'closed'})).toBeUndefined();
  expect(lineLook(schema, {})).toBeUndefined();
});

test('a value per option picks by the feature\'s option and falls back for the rest', () => {
  expect(lineLook(BOOKED, {booked: 'yes'})?.stroke).toBe('#00aa00');
  expect(lineLook(BOOKED, {booked: 'no'})?.stroke).toBe('#aa0000');
  expect(lineLook(BOOKED, {})?.stroke).toBe(DEFAULT_COLOR);
});

test('a checkbox splits a part into checked and unchecked, and unset is unchecked', () => {
  const visited: CollectionSchema = {
    ...BOOKED,
    fields: [...BOOKED.fields, {id: 'visited', kind: 'line', label: 'Visited', type: 'checkbox'}],
  };
  const split = restyle(visited, 'line', {
    pattern: {kind: 'by_option', key: 'visited', values: {true: 'solid', false: 'dashed'}},
    width: {kind: 'by_option', key: 'visited', values: {true: 4}},
  });
  expect(lineLook(split, {visited: true})).toMatchObject({pattern: 'solid', widthPx: 4});
  expect(lineLook(split, {visited: false})).toMatchObject({pattern: 'dashed'});
  expect(lineLook(split, {})).toMatchObject({pattern: 'dashed', widthPx: DEFAULT_WIDTH_PX});
  expect(byOption(visited.fields[4], 'color'))
      .toEqual({
        kind: 'by_option',
        key: 'visited',
        values: {true: OPTION_COLORS[0], false: OPTION_COLORS[1]},
      });
});

test('a label can take its text per option', () => {
  const split = restyle(BOOKED, 'point', {
    label: {kind: 'by_option', key: 'booked', values: {yes: 'Ours'}},
  });
  expect(pointLook(split, {booked: 'yes'})?.label).toBe('Ours');
  expect(pointLook(split, {booked: 'no'})?.label).toBe('');
});

test('a feature\'s own stroke is ignored once the color comes from elsewhere', () => {
  expect(lineLook(BOOKED, {booked: 'yes', stroke: '#123456'})?.stroke).toBe('#00aa00');
});

test('constants apply to every feature', () => {
  expect(lineLook(BOOKED, {width_px: 9})?.widthPx).toBe(5);
  expect(pointLook(BOOKED, {})?.icon).toBe('⛺');
});

test('a layer saved without a part draws it at the default', () => {
  const parsed = parseCollectionSchema(JSON.stringify({
    fields: [],
    layers: [{kind: 'point', filters: [], icon: {kind: 'constant', value: '⛺'}}],
  }));
  expect(channelOf(parsed, 'point', 'radius')).toEqual({kind: 'constant', value: 6});
  expect(pointLook(parsed, {})?.radiusPx).toBe(6);
});

test('a field value of the wrong type draws as the fallback', () => {
  expect(lineLook(BOOKED, {pattern: 'wavy'})?.pattern).toBe('solid');
  expect(lineLook(BOOKED, {pattern: 'dashed'})?.pattern).toBe('dashed');
  expect(pointLook(BOOKED, {fill: 'green'})?.fill).toBe(DEFAULT_COLOR);
  expect(lineLook(DEFAULT_COLLECTION_SCHEMA, {width_px: -1})?.widthPx).toBe(DEFAULT_WIDTH_PX);
  expect(lineLook(DEFAULT_COLLECTION_SCHEMA, {marker_zoom: 14})?.widthPx)
      .toBe(DEFAULT_MARKER_WIDTH_PX);
  expect(pointLook(DEFAULT_COLLECTION_SCHEMA, {})?.icon).toBe(DEFAULT_ICON);
});

test('a new feature takes the defaults of its own kind\'s fields', () => {
  const schema: CollectionSchema = {
    ...BOOKED,
    fields: [
      {...BOOKED.fields[0], default: 'yes'},
      {...BOOKED.fields[1], default: 'dashed'},
      {...BOOKED.fields[2], default: 'no'},
      {...BOOKED.fields[3], default: '#123456'},
      {id: 'water', kind: 'point', label: 'Water', type: 'checkbox', default: true},
    ],
  };
  expect(withDefaults(schema, line({}))).toEqual({booked: 'yes', pattern: 'dashed'});
  expect(withDefaults(schema, point({}))).toEqual({booked: 'no', fill: '#123456', water: true});
  expect(withDefaults(schema, point({fill: '#654321'})))
      .toEqual({booked: 'no', fill: '#654321', water: true});
  const folder: EditableFeature = {kind: 'folder', id: 'f', version: 0n, data: {name: 'Trip'}};
  expect(withDefaults(schema, folder)).toEqual({name: 'Trip'});
});

test('a default that no longer fits its field is skipped', () => {
  const schema: CollectionSchema = {
    ...BOOKED,
    fields: [
      {...BOOKED.fields[2], default: 'maybe'},
      {...BOOKED.fields[3], default: 'red'},
      {id: 'rating', kind: 'point', label: 'Rating', type: 'number', default: '3'},
    ],
  };
  expect(withDefaults(schema, point({}))).toEqual({});
});

test('removing a line field leaves points\' field of the same id and unbinds line parts', () => {
  const removed = removeField(BOOKED, {kind: 'line', id: 'booked'});
  expect(removed.fields.map(f => `${f.kind}:${f.id}`))
      .toEqual(['line:pattern', 'point:booked', 'point:fill']);
  expect(channelOf(removed, 'line', 'stroke'))
      .toEqual({kind: 'constant', value: DEFAULT_COLOR});
  expect(channelOf(removed, 'line', 'pattern')).toBe(channelOf(BOOKED, 'line', 'pattern'));
  expect(removed.layers[2]).toBe(BOOKED.layers[2]);
});

test('removing a field points the parts that read it at their fallbacks', () => {
  const removed = removeField(BOOKED, {kind: 'line', id: 'pattern'});
  expect(channelOf(removed, 'line', 'pattern')).toEqual({kind: 'constant', value: 'solid'});
});

test('fields show on the kinds they name', () => {
  expect(fieldsFor(BOOKED, 'line').map(f => f.id)).toEqual(['booked', 'pattern']);
  expect(fieldsFor(BOOKED, 'point').map(f => f.id)).toEqual(['booked', 'fill']);
  expect(fieldsFor(BOOKED, 'folder')).toEqual([]);
});

test('moves a field before or after another of its kind', () => {
  const keys = (schema: CollectionSchema) => schema.fields.map(f => `${f.kind}:${f.id}`);
  expect(keys(moveField(BOOKED, {kind: 'point', id: 'fill'}, 'booked', 'before')))
      .toEqual(['line:booked', 'line:pattern', 'point:fill', 'point:booked']);
  expect(keys(moveField(BOOKED, {kind: 'line', id: 'booked'}, 'pattern', 'after')))
      .toEqual(['line:pattern', 'line:booked', 'point:booked', 'point:fill']);
  expect(moveField(BOOKED, {kind: 'line', id: 'booked'}, 'booked', 'after')).toBe(BOOKED);
  expect(moveField(BOOKED, {kind: 'point', id: 'fill'}, 'pattern', 'before')).toBe(BOOKED);
});

test('a drawing takes its look from the drawing parts', () => {
  const schema =
      restyle(DEFAULT_COLLECTION_SCHEMA, 'drawing', {width: {kind: 'constant', value: 12}});
  const drawing = line({marker_zoom: 14, stroke: '#123456', width_px: 3});
  expect(getFieldKind(drawing)).toBe('drawing');
  expect(lineLook(schema, drawing.data))
      .toEqual({
        casing: '',
        halo: '#00000000',
        label: '',
        pattern: 'solid',
        stroke: '#123456',
        widthPx: 12,
      });
  expect(lineLook(schema, {width_px: 3})?.widthPx).toBe(3);
});

test('removing a field from drawings leaves lines reading it', () => {
  const removed = removeField(DEFAULT_COLLECTION_SCHEMA, {kind: 'drawing', id: 'stroke'});
  expect(fieldsFor(removed, 'drawing').map(f => f.id)).toEqual(['name', 'description', 'width_px']);
  expect(fieldsFor(removed, 'line').map(f => f.id))
      .toEqual(['name', 'description', 'stroke', 'width_px']);
  expect(channelOf(removed, 'drawing', 'stroke'))
      .toEqual({kind: 'constant', value: DEFAULT_COLOR});
  expect(channelOf(removed, 'line', 'stroke'))
      .toBe(channelOf(DEFAULT_COLLECTION_SCHEMA, 'line', 'stroke'));
});

test('labels come from text, numbers, and option labels', () => {
  expect(lineLook(BOOKED, {name: 'Day 1'})?.label).toBe('Day 1');
  expect(lineLook(BOOKED, {})?.label).toBe('');
  const byBooking = restyle(BOOKED, 'point', {label: {kind: 'field', key: 'booked'}});
  expect(pointLook(byBooking, {booked: 'yes'})?.label).toBe('Booked');
  const byNumber = restyle(BOOKED, 'point', {label: {kind: 'field', key: 'elevation'}});
  expect(pointLook(byNumber, {elevation: 2400})?.label).toBe('2400');
  expect(lineLook(BOOKED, {marker_zoom: 14, name: 'Scribble'})?.label).toBe('Scribble');
});

test('a new option gets the next color in every color split by its select', () => {
  const added = addOption(BOOKED, {kind: 'line', id: 'booked'}, 'Maybe');
  const maybe = added.fields[0].options![2];
  expect(maybe.label).toBe('Maybe');
  expect(lineLook(added, {booked: maybe.id})?.stroke).toBe(OPTION_COLORS[2]);
  expect(added.fields[2].options).toHaveLength(2);
});

test('removing an option drops the values given to it', () => {
  const removed = removeOption(BOOKED, {kind: 'line', id: 'booked'}, 'no');
  expect(removed.fields[0].options!.map(o => o.id)).toEqual(['yes']);
  expect(removed.fields[2].options).toHaveLength(2);
  expect(channelOf(removed, 'line', 'stroke'))
      .toEqual({kind: 'by_option', key: 'booked', values: {yes: '#00aa00'}});
});

test('imported style keys move to the fields the schema reads', () => {
  const imported = point({name: 'Camp', fill: '#00ff00', icon: '⛺'});
  adoptImported(BOOKED, imported);
  expect(imported.data).toEqual({name: 'Camp', fill: '#00ff00', icon: '⛺'});

  const elsewhere =
      restyle(
          {
            ...BOOKED,
            fields: [...BOOKED.fields, {id: 'tint', kind: 'point', label: 'Tint', type: 'color'}],
          },
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
    fields: [{id: 'notes', kind: 'point', label: 'Notes', type: 'text', multiline: true}],
  };
  adoptImported(notes, imported);
  expect(imported.data).toEqual({name: 'Camp', notes: 'By the lake'});

  const kept = point({description: 'By the lake'});
  adoptImported(DEFAULT_COLLECTION_SCHEMA, kept);
  expect(kept.data).toEqual({description: 'By the lake'});
});

test('a feature is titled by its label and renamed through the text field it reads', () => {
  const camp = point({name: 'Camp', booked: 'yes'});
  expect(getTitle(DEFAULT_COLLECTION_SCHEMA, camp)).toBe('Camp');
  expect(titleField(DEFAULT_COLLECTION_SCHEMA, camp)).toBe('name');

  const byStatus = restyle(BOOKED, 'point', {label: {kind: 'field', key: 'booked'}});
  expect(getTitle(byStatus, camp)).toBe('Booked');
  expect(titleField(byStatus, camp)).toBeUndefined();

  const folder: EditableFeature = {kind: 'folder', id: 'f', version: 0n, data: {name: 'Trip'}};
  expect(getTitle(byStatus, folder)).toBe('Trip');
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
