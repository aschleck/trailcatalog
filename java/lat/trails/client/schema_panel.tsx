import { checkExhaustive, checkExists } from 'external/dev_april_corgi+/js/common/asserts';
import * as corgi from 'external/dev_april_corgi+/js/corgi';
import { Controller, Response } from 'external/dev_april_corgi+/js/corgi/controller';
import { CorgiEvent, DOM_MOUSE } from 'external/dev_april_corgi+/js/corgi/events';
import { DialogService } from 'external/dev_april_corgi+/js/emu/dialog';
import { ACTION, CHANGED } from 'external/dev_april_corgi+/js/emu/events';
import { Input } from 'external/dev_april_corgi+/js/emu/input';
import { Select } from 'external/dev_april_corgi+/js/emu/select';

import {
  IconButton,
  LIST,
  PANEL,
  RemoveButton,
  SecondaryButton,
  Section,
  SELECT_BOX,
  TEXT_BOX,
} from './controls';
import { DEFAULT_ICON, DEFAULT_POINT_COLOR } from './features';
import { IconPickerButton, IconPickerDialog } from './icon_picker';
import {
  addOption,
  appliesTo,
  byOption,
  Channel,
  channelOf,
  CollectionSchema,
  EDITABLE_KINDS,
  FieldDefinition,
  FieldKind,
  FieldType,
  moveField,
  PARTS,
  PATTERN_LABELS,
  PATTERN_NAMES,
  READS,
  removeFieldFrom,
  removeOption,
  withChannel,
} from './schema';

export function SchemaPanel(props: {
  schema: CollectionSchema;
  shown: boolean;
  styling: boolean;
  onChanged: (schema: CollectionSchema) => void;
}) {
  return <SchemaEditor {...props} />;
}

type Part = (typeof PARTS)[number];

// Where a part can take its value from. The key names it in the source select and in sourceCache.
interface Source {
  key: string;
  label: string;
  make: () => Channel<unknown>;
}

const TYPE_LABELS: {[type in FieldType]: string} = {
  checkbox: 'Checkbox',
  color: 'Color',
  date: 'Date',
  icon: 'Icon',
  number: 'Number',
  pattern: 'Pattern',
  select: 'Choice',
  text: 'Text',
};

const TYPES_BY_LABEL =
    (Object.keys(TYPE_LABELS) as FieldType[])
        .sort((a, b) => TYPE_LABELS[a].localeCompare(TYPE_LABELS[b]));

const KIND_LABELS: {[kind in FieldKind]: string} = {
  drawing: 'Drawings',
  line: 'Lines',
  point: 'Points',
  polygon: 'Polygons',
};

// A text box that only shows its border when it is pointed at or typed in
const QUIET_TEXT_BOX =
    'border border-transparent focus-within:border-blue-500 grow h-7 hover:border-gray-300 '
        + 'min-w-0 px-2 rounded';
const SWATCH = 'bg-white border border-gray-300 cursor-pointer h-7 p-0.5 rounded shrink-0 w-9';

interface State {
  draft: CollectionSchema;
  // What each part was before being set to something else, by kind, part, and source key, so that
  // switching back finds the values again
  sourceCache: {[key: string]: Channel<unknown>};
  // What is typed into each kind's new field row
  newFields: {[kind in FieldKind]: {label: string; type: FieldType}};
  // Typed into each select field's new option box, by field id
  newOptions: {[field: string]: string};
  // The field being dragged to reorder it, which only drops within the section it started in
  dragging: {kind: FieldKind; id: string}|undefined;
  dropTarget: {kind: FieldKind; id: string; side: 'after'|'before'}|undefined;
}

// Schema and style are one panel so that they edit the same draft.
function SchemaEditor(
    {schema, shown, styling, onChanged}: {
      schema: CollectionSchema;
      shown: boolean;
      styling: boolean;
      onChanged: (schema: CollectionSchema) => void;
    },
    inState: State|undefined,
    updateState: (newState: State) => void) {
  const state = inState ?? {
    draft: schema,
    sourceCache: {},
    newFields:
        Object.fromEntries(EDITABLE_KINDS.map(kind => [kind, {label: '', type: 'text'}])) as
            State['newFields'],
    newOptions: {},
    dragging: undefined,
    dropTarget: undefined,
  };
  const draft = state.draft;

  return <>
    <div
        js={corgi.bind({
          controller: SchemaController,
          args: {onChanged},
          events: {
            render: 'wakeup',
          },
          state: [state, updateState],
        })}
        className={`${shown ? 'flex' : 'hidden'} ${PANEL}`}
    >
      {styling
          ? EDITABLE_KINDS.map(kind =>
              <Section label={KIND_LABELS[kind]}>
                <div className={LIST}>
                  {PARTS.filter(p => p.kind === kind).map(part =>
                      <PartRow key={`${kind}.${part.part}`} draft={draft} part={part} />)}
                </div>
              </Section>)
          : EDITABLE_KINDS.map(kind =>
              <KindSection
                  draft={draft}
                  dropTarget={state.dropTarget?.kind === kind ? state.dropTarget : undefined}
                  kind={kind}
                  newField={state.newFields[kind]}
                  newOptions={state.newOptions}
              />)
      }
    </div>
  </>;
}

// A field shown on several kinds of feature is listed under each of them.
function KindSection({draft, dropTarget, kind, newField, newOptions}: {
  draft: CollectionSchema;
  dropTarget: {id: string; side: 'after'|'before'}|undefined;
  kind: FieldKind;
  newField: {label: string; type: FieldType};
  newOptions: {[field: string]: string};
}) {
  const fields = draft.fields.filter(field => appliesTo(field, kind));
  return (
    <Section label={KIND_LABELS[kind]}>
      <div className={LIST}>
        {fields.map(field =>
            <FieldRow
                key={`${kind}:${field.id}`}
                drop={dropTarget?.id === field.id ? dropTarget.side : undefined}
                field={field}
                kind={kind}
                newOption={newOptions[field.id] ?? ''}
            />)}
        <div className="bg-gray-50 flex gap-2 items-center p-2">
          <Input
              className={`${TEXT_BOX} grow`}
              data={{kind}}
              forceValue={true}
              placeholder="New property"
              value={newField.label}
              unboundEvents={{corgi: [[CHANGED, 'newLabelChanged'], [ACTION, 'fieldAdded']]}}
          />
          <Select
              ariaLabel="Type"
              className={`${SELECT_BOX} shrink-0 w-28`}
              data={{kind}}
              options={TYPES_BY_LABEL.map(type => ({
                label: TYPE_LABELS[type],
                value: type,
                selected: type === newField.type,
              }))}
              unboundEvents={{corgi: [[CHANGED, 'newTypeChanged']]}}
          />
          <SecondaryButton data={{kind}} unboundEvents={{corgi: [[ACTION, 'fieldAdded']]}}>
            Add
          </SecondaryButton>
        </div>
      </div>
    </Section>
  );
}

// A line along the top or bottom edge shows where a dragged field would drop.
function FieldRow({drop, field, kind, newOption}: {
  drop: 'after'|'before'|undefined;
  field: FieldDefinition;
  key: string;
  kind: FieldKind;
  newOption: string;
}) {
  const bound = {data: {field: field.id}};
  const labelAction = field.hideLabel ? 'Show the label' : 'Hide the label';
  return (
    <div
        className={
          'flex flex-col gap-1 pl-1 pr-2 py-1.5 '
              + (drop === 'before'
                  ? 'shadow-[inset_0_2px_0_0_#3b82f6]'
                  : drop === 'after' ? 'shadow-[inset_0_-2px_0_0_#3b82f6]' : '')
        }
        data={{field: field.id, kind}}
        unboundEvents={{dragover: 'fieldDraggedOver', drop: 'fieldDropped'}}
    >
      <div className="flex gap-1 items-center">
        <span
            ariaLabel={`Drag to reorder ${field.label}`}
            className="
                cursor-grab
                flex
                h-7
                hover:text-gray-700
                items-center
                justify-center
                shrink-0
                text-gray-300
                w-5
            "
            data={{field: field.id, kind}}
            draggable={true}
            title="Drag to reorder"
            unboundEvents={{dragend: 'fieldDragEnded', dragstart: 'fieldDragStarted'}}
        >
          <svg className="fill-current h-3.5 w-2" viewBox="0 0 8 14">
            <circle cx="2" cy="2" r="1.25" />
            <circle cx="6" cy="2" r="1.25" />
            <circle cx="2" cy="7" r="1.25" />
            <circle cx="6" cy="7" r="1.25" />
            <circle cx="2" cy="12" r="1.25" />
            <circle cx="6" cy="12" r="1.25" />
          </svg>
        </span>
        <Input
            {...bound}
            className={QUIET_TEXT_BOX}
            forceValue={true}
            value={field.label}
            unboundEvents={{corgi: [[CHANGED, 'fieldLabelChanged']]}}
        />
        <span className="bg-gray-100 px-1.5 py-0.5 rounded shrink-0 text-gray-600 text-xs">
          {TYPE_LABELS[field.type]}
        </span>
        {field.type === 'text'
            ? <IconButton
                  data={{field: field.id}}
                  label={field.multiline ? 'Make it a single line' : 'Make it multiple lines'}
                  unboundEvents={{corgi: [[ACTION, 'multilineToggled']]}}
              >
                {field.multiline
                    ? <path d="M1.5 2.5 H10.5 M1.5 6 H10.5 M1.5 9.5 H7" strokeWidth="1.2" />
                    : <path d="M1.5 6 H10.5" strokeWidth="1.2" />
                }
              </IconButton>
            : ''
        }
        <IconButton
            data={{field: field.id}}
            label={`${labelAction} in the feature editor`}
            unboundEvents={{corgi: [[ACTION, 'labelToggled']]}}
        >
          <path d="M1 1.5 H6 L11 6.5 L6.5 11 L1 6 Z" strokeWidth="1.1" />
          {field.hideLabel ? <path d="M0.5 11.5 L11.5 0.5" strokeWidth="1.2" /> : ''}
        </IconButton>
        <RemoveButton
            data={{field: field.id, kind}}
            label={`Remove ${field.label}`}
            unboundEvents={{corgi: [[ACTION, 'fieldRemoved']]}}
        />
      </div>
      {field.type === 'select'
          ? <div className="flex flex-col gap-1 pl-6">
              {(field.options ?? []).map(option =>
                  <div className="flex gap-2 items-center" key={option.id}>
                    <Input
                        className={QUIET_TEXT_BOX}
                        data={{field: field.id, option: option.id}}
                        forceValue={true}
                        value={option.label}
                        unboundEvents={{corgi: [[CHANGED, 'optionLabelChanged']]}}
                    />
                    <RemoveButton
                        data={{field: field.id, option: option.id}}
                        label={`Remove ${option.label}`}
                        unboundEvents={{corgi: [[ACTION, 'optionRemoved']]}}
                    />
                  </div>)}
              <div className="flex gap-2 items-center">
                <IconButton
                    {...bound}
                    label={`Add a choice to ${field.label}`}
                    unboundEvents={{corgi: [[ACTION, 'optionAdded']]}}
                >
                  <path d="M6 1 V11 M1 6 H11" strokeWidth="1.5" />
                </IconButton>
                <Input
                    {...bound}
                    className={QUIET_TEXT_BOX}
                    forceValue={true}
                    placeholder="Add a choice"
                    value={newOption}
                    unboundEvents={{
                      corgi: [[CHANGED, 'newOptionChanged'], [ACTION, 'optionAdded']],
                    }}
                />
                <span className="shrink-0 w-7" />
              </div>
            </div>
          : ''
      }
    </div>
  );
}

// Each part takes a constant, a field, or a value per option of a select.
function PartRow({draft, part}: {draft: CollectionSchema; key: string; part: Part}) {
  const channel = channelOf(draft, part.kind, part.part);
  const current = sourceKey(channel);
  const split =
      channel.kind === 'by_option' ? draft.fields.find(f => f.id === channel.key) : undefined;
  return (
    <div className="flex flex-col gap-1.5 px-3 py-2">
      <div className="flex gap-2 items-center">
        <span className="shrink-0 text-gray-600 w-24">{part.label}</span>
        <Select
            ariaLabel={`${part.label} from`}
            className={`${SELECT_BOX} grow`}
            data={{kind: part.kind, part: part.part}}
            options={sourcesFor(draft, part).map(source => ({
              label: source.label,
              value: source.key,
              selected: source.key === current,
            }))}
            unboundEvents={{corgi: [[CHANGED, 'sourceChanged']]}}
        />
        {channel.kind === 'constant'
            ? <ValueInput
                  key={`${part.kind}.${part.part}:constant`}
                  iconColor={iconColorOf(draft)}
                  option=""
                  part={part}
                  value={channel.value}
              />
            : ''
        }
      </div>
      {channel.kind === 'by_option'
          ? <div className="flex flex-col gap-1 pl-[6.5rem]">
              {(split?.options ?? []).map(option =>
                  <div className="flex gap-2 items-center">
                    <span className="grow min-w-0 text-gray-600 truncate">{option.label}</span>
                    <ValueInput
                        key={`${part.kind}.${part.part}:${option.id}`}
                        iconColor={iconColorOf(draft)}
                        option={option.id}
                        part={part}
                        value={channel.values[option.id]}
                    />
                  </div>)}
            </div>
          : ''
      }
    </div>
  );
}

// Keyed, because the raw inputs only take their value when created.
function ValueInput({iconColor, option, part, value}: {
  // What an icon is previewed in
  iconColor: string;
  key: string;
  // The select option the value is for, or empty for a constant
  option: string;
  part: Part;
  value: unknown;
}) {
  const bound = {data: {kind: part.kind, part: part.part, option}};
  const shown = value ?? part.fallback;
  switch (part.type) {
    case 'color':
      return (
        <input
            {...bound}
            ariaLabel={part.label}
            className={SWATCH}
            type="color"
            value={String(shown)}
            unboundEvents={{input: 'valueInput'}}
        />
      );
    case 'icon':
      return (
        <IconPickerButton
            {...bound}
            ariaLabel={part.label}
            color={iconColor}
            icon={String(shown)}
            title={part.label}
            unboundEvents={{click: 'iconValueClicked'}}
        />
      );
    case 'label':
      return (
        <Input
            {...bound}
            className={`${TEXT_BOX} shrink-0 w-32`}
            forceValue={true}
            placeholder="No label"
            value={String(value ?? '')}
            unboundEvents={{corgi: [[CHANGED, 'valueChanged']]}}
        />
      );
    case 'number':
      return (
        <input
            {...bound}
            className={`${TEXT_BOX} shrink-0 w-20`}
            min="1"
            type="number"
            value={String(shown)}
            unboundEvents={{input: 'valueInput'}}
        />
      );
    case 'pattern':
      return (
        <Select
            {...bound}
            ariaLabel={part.label}
            className={`${SELECT_BOX} shrink-0 w-32`}
            options={PATTERN_NAMES.map(name => ({
              label: PATTERN_LABELS[name],
              value: name,
              selected: name === shown,
            }))}
            unboundEvents={{corgi: [[CHANGED, 'valueChanged']]}}
        />
      );
    default:
      throw checkExhaustive(part.type);
  }
}

// A label never splits by a select because it shows the option's label.
function sourcesFor(draft: CollectionSchema, part: Part): Source[] {
  const usable = draft.fields.filter(f => appliesTo(f, part.kind));
  const selects = part.type === 'label' ? [] : usable.filter(f => f.type === 'select');
  return [
    {
      key: 'constant',
      label: '(constant value)',
      make: () => ({kind: 'constant', value: part.fallback}),
    },
    ...usable.filter(f => READS[part.type].includes(f.type)).map(f => ({
      key: `field:${f.id}`,
      label: f.label,
      make: () => ({kind: 'field', key: f.id}) as const,
    })),
    ...selects.map(f => ({
      key: `by_option:${f.id}`,
      label: `By ${f.label}`,
      make: () => byOption(f, part.type),
    })),
  ];
}

function sourceKey(channel: Channel<unknown>): string {
  return channel.kind === 'constant' ? 'constant' : `${channel.kind}:${channel.key}`;
}

// A constant point color, or else the default, since a color read from a field varies by point
function iconColorOf(schema: CollectionSchema): string {
  const fill = channelOf(schema, 'point', 'fill');
  return fill.kind === 'constant' ? String(fill.value) : DEFAULT_POINT_COLOR;
}

interface Args {
  onChanged: (schema: CollectionSchema) => void;
}

type Deps = typeof SchemaController.deps;

class SchemaController extends Controller<Args, Deps, HTMLElement, State> {

  static deps() {
    return {
      services: {
        dialog: DialogService,
      },
    };
  }

  private readonly dialog: DialogService;
  private readonly onChanged: (schema: CollectionSchema) => void;

  constructor(response: Response<SchemaController>) {
    super(response);
    this.dialog = response.deps.services.dialog;
    this.onChanged = response.args.onChanged;
  }

  newLabelChanged(e: CorgiEvent<typeof CHANGED>): void {
    const kind = this.kindOf(e);
    this.setNewField(kind, {...this.state.newFields[kind], label: e.detail.value});
  }

  newTypeChanged(e: CorgiEvent<typeof CHANGED>): void {
    const kind = this.kindOf(e);
    this.setNewField(kind, {...this.state.newFields[kind], type: e.detail.value as FieldType});
  }

  fieldAdded(e: CorgiEvent<typeof ACTION>): void {
    const kind = this.kindOf(e);
    const {label, type} = this.state.newFields[kind];
    if (!label.trim()) {
      return;
    }

    const field: FieldDefinition = {
      id: crypto.randomUUID(),
      label: label.trim(),
      type,
      kinds: [kind],
      ...(type === 'select' ? {options: []} : {}),
    };
    this.setDraft({...this.state.draft, fields: [...this.state.draft.fields, field]}, {
      newFields: {...this.state.newFields, [kind]: {label: '', type}},
    });
  }

  fieldLabelChanged(e: CorgiEvent<typeof CHANGED>): void {
    const id = this.fieldId(e);
    this.editField(id, field => ({...field, label: e.detail.value}));
  }

  multilineToggled(e: CorgiEvent<typeof ACTION>): void {
    this.editField(this.fieldId(e), field => {
      const {multiline, ...rest} = field;
      return multiline ? rest : {...rest, multiline: true};
    });
  }

  labelToggled(e: CorgiEvent<typeof ACTION>): void {
    this.editField(this.fieldId(e), field => {
      const {hideLabel, ...rest} = field;
      return hideLabel ? rest : {...rest, hideLabel: true};
    });
  }

  fieldDragStarted(e: CorgiEvent<typeof DOM_MOUSE>): void {
    const id = checkExists(e.actionElement.data('field')).string();
    const kind = checkExists(e.actionElement.data('kind')).string() as FieldKind;
    const event = e.detail as DragEvent;
    if (event.dataTransfer) {
      // Firefox refuses to start a drag that carries no data.
      event.dataTransfer.setData('text/plain', id);
      event.dataTransfer.effectAllowed = 'move';
      const row = e.actionElement.element().closest('[data-field]')?.parentElement;
      if (row) {
        event.dataTransfer.setDragImage(row, 0, 0);
      }
    }
    this.updateState({...this.state, dragging: {kind, id}});
  }

  // The upper half of a row drops before it and the lower half after it.
  fieldDraggedOver(e: CorgiEvent<typeof DOM_MOUSE>): void {
    const dragging = this.state.dragging;
    const kind = checkExists(e.actionElement.data('kind')).string() as FieldKind;
    if (!dragging || dragging.kind !== kind) {
      return;
    }

    const event = e.detail as DragEvent;
    event.preventDefault();
    const id = checkExists(e.actionElement.data('field')).string();
    const box = e.actionElement.element().getBoundingClientRect();
    const side = event.clientY < box.top + box.height / 2 ? 'before' : 'after';
    const target = this.state.dropTarget;
    if (target?.id !== id || target.side !== side || target.kind !== kind) {
      this.updateState({...this.state, dropTarget: {kind, id, side}});
    }
  }

  fieldDropped(e: CorgiEvent<typeof DOM_MOUSE>): void {
    const dragging = this.state.dragging;
    const target = this.state.dropTarget;
    (e.detail as DragEvent).preventDefault();
    if (dragging && target && dragging.kind === target.kind) {
      this.setDraft(moveField(this.state.draft, dragging.id, target.id, target.side), {
        dragging: undefined,
        dropTarget: undefined,
      });
    }
  }

  fieldDragEnded(): void {
    this.updateState({...this.state, dragging: undefined, dropTarget: undefined});
  }

  fieldRemoved(e: CorgiEvent<typeof ACTION>): void {
    this.setDraft(removeFieldFrom(this.state.draft, this.fieldId(e), this.kindOf(e)));
  }

  newOptionChanged(e: CorgiEvent<typeof CHANGED>): void {
    const id = this.fieldId(e);
    this.updateState({...this.state, newOptions: {...this.state.newOptions, [id]: e.detail.value}});
  }

  optionAdded(e: CorgiEvent<typeof ACTION>): void {
    const id = this.fieldId(e);
    const label = (this.state.newOptions[id] ?? '').trim();
    if (!label) {
      return;
    }

    this.setDraft(addOption(this.state.draft, id, label), {
      newOptions: {...this.state.newOptions, [id]: ''},
    });
  }

  optionLabelChanged(e: CorgiEvent<typeof CHANGED>): void {
    const id = this.fieldId(e);
    const option = checkExists(e.actionElement.data('option')).string();
    this.editField(id, field => ({
      ...field,
      options: (field.options ?? []).map(o => o.id === option ? {...o, label: e.detail.value} : o),
    }));
  }

  optionRemoved(e: CorgiEvent<typeof ACTION>): void {
    const option = checkExists(e.actionElement.data('option')).string();
    this.setDraft(removeOption(this.state.draft, this.fieldId(e), option));
  }

  // A source starts at the part's fallback, unless the part was set that way earlier in the dialog.
  sourceChanged(e: CorgiEvent<typeof CHANGED>): void {
    const part = this.partOf(e);
    const draft = this.state.draft;
    const source = sourcesFor(draft, part).find(s => s.key === e.detail.value);
    if (!source) {
      return;
    }

    const prefix = `${part.kind}.${part.part}/`;
    const current = channelOf(draft, part.kind, part.part);
    const sourceCache = {...this.state.sourceCache, [prefix + sourceKey(current)]: current};
    const channel = sourceCache[prefix + source.key] ?? source.make();
    this.setDraft(withChannel(draft, part.kind, part.part, channel), {sourceCache});
  }

  valueInput(e: CorgiEvent<typeof DOM_MOUSE>): void {
    const element = e.actionElement.element() as HTMLInputElement;
    this.setValue(e, element.value);
  }

  // The picker stores its default as no icon, which a channel draws as DEFAULT_ICON anyway.
  iconValueClicked(e: CorgiEvent<typeof DOM_MOUSE>): void {
    const part = this.partOf(e);
    const option = checkExists(e.actionElement.data('option')).string();
    const channel = channelOf(this.state.draft, part.kind, part.part);
    const current =
        channel.kind === 'constant' ? channel.value
            : channel.kind === 'by_option' ? channel.values[option]
            : undefined;
    this.dialog.display(IconPickerDialog({
      color: iconColorOf(this.state.draft),
      current: typeof current === 'string' ? current : undefined,
      onChosen: icon => {
        this.setValueAt(part, option, icon ?? DEFAULT_ICON);
      },
      used: [],
    })).catch(() => {});
  }

  valueChanged(e: CorgiEvent<typeof CHANGED>): void {
    this.setValue(e, e.detail.value);
  }

  private setValue(e: CorgiEvent<typeof CHANGED>|CorgiEvent<typeof DOM_MOUSE>, raw: string):
      void {
    const option = checkExists(e.actionElement.data('option')).string();
    this.setValueAt(this.partOf(e), option, raw);
  }

  private setValueAt(part: Part, option: string, raw: string): void {
    let value: string|number = raw;
    if (part.type === 'number') {
      value = Number(raw);
      if (!Number.isFinite(value) || value <= 0) {
        return;
      }
    } else if (part.type === 'icon' && !raw.trim()) {
      return;
    }

    const draft = this.state.draft;
    const channel = channelOf(draft, part.kind, part.part);
    if (!option) {
      this.setDraft(withChannel(draft, part.kind, part.part, {kind: 'constant', value}));
    } else if (channel.kind === 'by_option') {
      this.setDraft(
          withChannel(
              draft,
              part.kind,
              part.part,
              {...channel, values: {...channel.values, [option]: value}}));
    }
  }

  private partOf(e: CorgiEvent<typeof CHANGED>|CorgiEvent<typeof DOM_MOUSE>): Part {
    const kind = checkExists(e.actionElement.data('kind')).string();
    const part = checkExists(e.actionElement.data('part')).string();
    return checkExists(PARTS.find(p => p.kind === kind && p.part === part));
  }

  private fieldId(e: CorgiEvent<typeof ACTION>|CorgiEvent<typeof CHANGED>): string {
    return checkExists(e.actionElement.data('field')).string();
  }

  private kindOf(e: CorgiEvent<typeof ACTION>|CorgiEvent<typeof CHANGED>): FieldKind {
    return checkExists(e.actionElement.data('kind')).string() as FieldKind;
  }

  private setNewField(kind: FieldKind, field: {label: string; type: FieldType}): void {
    this.updateState({...this.state, newFields: {...this.state.newFields, [kind]: field}});
  }

  private editField(
      id: string,
      edit: (field: FieldDefinition) => FieldDefinition,
      also: Partial<State> = {}): void {
    this.setDraft({
      ...this.state.draft,
      fields: this.state.draft.fields.map(field => field.id === id ? edit(field) : field),
    }, also);
  }

  private setDraft(draft: CollectionSchema, also: Partial<State> = {}): void {
    this.updateState({...this.state, ...also, draft});
    this.onChanged(draft);
  }
}
