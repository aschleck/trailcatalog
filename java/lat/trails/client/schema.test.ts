import { EditableFeature, EditableLine, EditablePoint, FeatureData } from './features';
import {
  addOption,
  adoptImported,
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
} from './schema';

// Lines colored by whether their night is booked, with a pattern field and a constant width
const BOOKED: CollectionSchema = {
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
  style: {
    ...DEFAULT_COLLECTION_SCHEMA.style,
    line: {
      ...DEFAULT_COLLECTION_SCHEMA.style.line,
      stroke: {kind: 'by_option', field: 'booked', values: {yes: '#00aa00', no: '#aa0000'}},
      width: {kind: 'constant', value: 5},
      pattern: {kind: 'field', field: 'pattern'},
    },
    point: {
      ...DEFAULT_COLLECTION_SCHEMA.style.point,
      fill: {kind: 'field', field: 'fill'},
      icon: {kind: 'constant', value: '⛺'},
    },
  },
};

test('the default schema draws the keys features already carry', () => {
  expect(lineLook(DEFAULT_COLLECTION_SCHEMA, line({stroke: '#ff0000', width_px: 4}))).toEqual({
    stroke: '#ff0000',
    widthPx: 4,
    pattern: 'solid',
  });
  expect(pointLook(DEFAULT_COLLECTION_SCHEMA, {fill: '#00ff00', icon: '⛺'})).toEqual({
    fill: '#00ff00',
    icon: '⛺',
  });
});

test('an empty schema column is the default', () => {
  expect(parseCollectionSchema('')).toBe(DEFAULT_COLLECTION_SCHEMA);
});

test('parts a saved schema lacks take the default', () => {
  const parsed = parseCollectionSchema(JSON.stringify({
    fields: [],
    style: {line: {width: {kind: 'constant', value: 7}}},
  }));
  expect(parsed.style.line.width).toEqual({kind: 'constant', value: 7});
  expect(parsed.style.line.stroke).toBe(DEFAULT_COLLECTION_SCHEMA.style.line.stroke);
  expect(parsed.style.point).toEqual(DEFAULT_COLLECTION_SCHEMA.style.point);
});

test('malformed parts take the default and malformed fields are dropped', () => {
  const parsed = parseCollectionSchema(JSON.stringify({
    fields: [{id: 'ok', label: 'Ok', type: 'text'}, {id: 'bad', type: 'text'}, 'nope'],
    style: {line: {stroke: {kind: 'field'}, width: 'wide'}},
  }));
  expect(parsed.fields.map(f => f.id)).toEqual(['ok']);
  expect(parsed.style.line.stroke).toBe(DEFAULT_COLLECTION_SCHEMA.style.line.stroke);
  expect(parsed.style.line.width).toBe(DEFAULT_COLLECTION_SCHEMA.style.line.width);
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

test('a field value of the wrong type draws as unset', () => {
  expect(lineLook(BOOKED, line({pattern: 'wavy'})).pattern).toBeUndefined();
  expect(lineLook(BOOKED, line({pattern: 'dashed'})).pattern).toBe('dashed');
  expect(pointLook(BOOKED, {fill: 'green'}).fill).toBeUndefined();
  expect(lineLook(DEFAULT_COLLECTION_SCHEMA, line({width_px: -1})).widthPx).toBeUndefined();
});

test('removing a field from lines unbinds only the line parts that read it', () => {
  const removed = removeFieldFrom(BOOKED, 'booked', 'line');
  expect(removed.fields.find(f => f.id === 'booked')?.kinds).toEqual(['drawing', 'point']);
  expect(removed.style.line.stroke).toEqual({kind: 'constant', value: '#de29db'});
  expect(removed.style.line.pattern).toBe(BOOKED.style.line.pattern);
  expect(removed.style.point).toBe(BOOKED.style.point);
});

test('removing a field from its last kind removes it', () => {
  const removed = removeFieldFrom(BOOKED, 'pattern', 'line');
  expect(removed.fields.map(f => f.id)).toEqual(['booked', 'fill']);
  expect(removed.style.line.pattern).toEqual({kind: 'constant', value: 'solid'});
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
  const schema: CollectionSchema = {
    ...DEFAULT_COLLECTION_SCHEMA,
    style: {
      ...DEFAULT_COLLECTION_SCHEMA.style,
      drawing: {...DEFAULT_COLLECTION_SCHEMA.style.drawing, width: {kind: 'constant', value: 12}},
    },
  };
  const drawing = line({marker_zoom: 14, stroke: '#123456', width_px: 3});
  expect(fieldKindOf(drawing)).toBe('drawing');
  expect(lineLook(schema, drawing)).toEqual({pattern: undefined, stroke: '#123456', widthPx: 12});
  expect(lineLook(schema, line({width_px: 3})).widthPx).toBe(3);
});

test('removing a field from drawings leaves lines reading it', () => {
  const removed = removeFieldFrom(DEFAULT_COLLECTION_SCHEMA, 'stroke', 'drawing');
  expect(removed.fields.find(f => f.id === 'stroke')?.kinds).toEqual(['line']);
  expect(removed.style.drawing.stroke).toEqual({kind: 'constant', value: '#de29db'});
  expect(removed.style.line.stroke).toBe(DEFAULT_COLLECTION_SCHEMA.style.line.stroke);
});

test('labels come from text, numbers, and option labels', () => {
  expect(lineLook(BOOKED, line({name: 'Day 1'})).label).toBe('Day 1');
  expect(lineLook(BOOKED, line({})).label).toBeUndefined();
  const byBooking: CollectionSchema = {
    ...BOOKED,
    style: {
      ...BOOKED.style,
      point: {...BOOKED.style.point, label: {kind: 'field', field: 'booked'}},
    },
  };
  expect(pointLook(byBooking, {booked: 'yes'}).label).toBe('Booked');
  const byNumber: CollectionSchema = {
    ...BOOKED,
    style: {
      ...BOOKED.style,
      point: {...BOOKED.style.point, label: {kind: 'field', field: 'elevation'}},
    },
  };
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
  expect(removed.style.line.stroke)
      .toEqual({kind: 'by_option', field: 'booked', values: {yes: '#00aa00'}});
});

test('imported style keys move to the fields the schema reads', () => {
  const imported = point({name: 'Camp', fill: '#00ff00', icon: '⛺'});
  adoptImported(BOOKED, imported);
  expect(imported.data).toEqual({name: 'Camp', fill: '#00ff00', icon: '⛺'});

  const elsewhere: CollectionSchema = {
    fields: [...BOOKED.fields, {id: 'tint', label: 'Tint', type: 'color'}],
    style: {...BOOKED.style, point: {...BOOKED.style.point, fill: {kind: 'field', field: 'tint'}}},
  };
  adoptImported(elsewhere, imported);
  expect(imported.data).toEqual({name: 'Camp', tint: '#00ff00', icon: '⛺'});
});

test('imported keys stay put when the field read instead is of another type', () => {
  const imported = point({name: 'Camp'});
  const byStatus: CollectionSchema = {
    ...BOOKED,
    style: {
      ...BOOKED.style,
      point: {...BOOKED.style.point, label: {kind: 'field', field: 'booked'}},
    },
  };
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

  const byStatus: CollectionSchema = {
    ...BOOKED,
    style: {
      ...BOOKED.style,
      point: {...BOOKED.style.point, label: {kind: 'field', field: 'booked'}},
    },
  };
  expect(titleOf(byStatus, camp)).toBe('Booked');
  expect(titleField(byStatus, camp)).toBeUndefined();

  const folder: EditableFeature = {kind: 'folder', id: 'f', version: 0n, data: {name: 'Trip'}};
  expect(titleOf(byStatus, folder)).toBe('Trip');
  expect(titleField(byStatus, folder)).toBe('name');
});

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
