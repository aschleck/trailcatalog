import { checkExhaustive } from 'external/dev_april_corgi+/js/common/asserts';
import * as corgi from 'external/dev_april_corgi+/js/corgi';
import { Controller, Response } from 'external/dev_april_corgi+/js/corgi/controller';
import { EmptyDeps } from 'external/dev_april_corgi+/js/corgi/deps';
import { CorgiEvent, DOM_EVENT } from 'external/dev_april_corgi+/js/corgi/events';
import { CHANGED } from 'external/dev_april_corgi+/js/emu/events';
import { Input } from 'external/dev_april_corgi+/js/emu/input';
import { Select } from 'external/dev_april_corgi+/js/emu/select';
import { LINE_PATTERNS, LinePattern } from 'js/map/rendering/line_program';

import { ColorPickerButton } from './color_picker';
import { FIELD_EDITED, FIELD_ICON_CLICKED } from './events';
import { FeatureData } from './features';
import { IconPickerButton } from './icon_picker';
import { PATTERN_LABELS } from './schema';
import {
  DEFAULT_COLOR,
  FieldDefinition,
} from './workers/collection_schema';

// Keyed by feature and field, because the raw inputs only take their value when created. A
// compact input sizes to what it holds and names its field in a tooltip, since it has no label.
//
// An input shows only its own field's value, so an unset color shows the default color rather than
// the drawn one, because a schema may draw a feature by some other field.
/** Renders the box that edits one field's value in values, firing FIELD_EDITED with each edit. */
export function FieldInput(
    {compact, field, iconColor, values, ...props}: {
      compact: boolean;
      field: FieldDefinition;
      // What an icon is previewed in, which is the feature's drawn fill
      iconColor: string;
      key: string;
      values: FeatureData;
    } & corgi.Properties,
    state: {}|undefined,
    updateState: (newState: {}) => void) {
  return (
    <span
        js={corgi.bind({
          controller: FieldInputController,
          args: {field},
          state: [state ?? {}, updateState],
        })}
        className="contents"
        {...props}
    >
      {renderInput(compact, values[field.id], field, iconColor)}
    </span>
  );
}

function renderInput(
    compact: boolean,
    value: FeatureData[string],
    field: FieldDefinition,
    iconColor: string) {
  const bound = {ariaLabel: field.label, title: field.label};
  const boxed = 'border border-gray-300 h-7 px-1 rounded';
  const width = (compactWidth: string) => compact ? `${compactWidth} shrink-0` : 'w-full';
  switch (field.type) {
    case 'checkbox':
      return compact
          ? <label className="flex gap-1 h-7 items-center shrink-0">
              <input
                  {...bound}
                  checked={value === true || undefined}
                  type="checkbox"
                  unboundEvents={{change: 'toggled'}}
              />
              {field.label}
            </label>
          : <input
                {...bound}
                checked={value === true || undefined}
                type="checkbox"
                unboundEvents={{change: 'toggled'}}
            />;
    case 'color':
      return (
        <ColorPickerButton
            {...bound}
            color={typeof value === 'string' ? value : DEFAULT_COLOR}
            fieldDefault={typeof field.default === 'string' ? field.default : undefined}
            unboundEvents={{corgi: [[CHANGED, 'changed']]}}
        />
      );
    case 'date':
      return (
        <input
            {...bound}
            className={`${boxed} ${width('w-36')}`}
            type="date"
            value={typeof value === 'string' ? value : ''}
            unboundEvents={{change: 'typed'}}
        />
      );
    case 'icon':
      return (
        <IconPickerButton
            {...bound}
            color={iconColor}
            icon={typeof value === 'string' ? value : undefined}
            unboundEvents={{click: 'iconClicked'}}
        />
      );
    case 'number':
      return (
        <input
            {...bound}
            className={`${boxed} ${width('w-16')}`}
            placeholder={compact ? field.label : ''}
            type="number"
            value={typeof value === 'number' ? String(value) : ''}
            unboundEvents={{input: 'typed'}}
        />
      );
    case 'select':
      return (
        <Select
            {...bound}
            className={`${boxed} ${width('w-32')}`}
            options={[
              ...unsetOption(field, compact, (field.options ?? []).some(o => o.id === value)),
              ...(field.options ?? []).map(option => ({
                label: option.label,
                value: option.id,
                selected: option.id === value,
              })),
            ]}
            unboundEvents={{corgi: [[CHANGED, 'changed']]}}
        />
      );
    case 'pattern':
      return (
        <Select
            {...bound}
            className={`${boxed} ${width('w-28')}`}
            options={[
              ...unsetOption(field, compact, LINE_PATTERNS.includes(value as LinePattern)),
              ...LINE_PATTERNS.map(name => ({
                label: PATTERN_LABELS[name],
                value: name,
                selected: name === value,
              })),
            ]}
            unboundEvents={{corgi: [[CHANGED, 'changed']]}}
        />
      );
    case 'text':
      return field.multiline
          ? <textarea
                {...bound}
                className="border border-gray-300 px-1 py-0.5 rounded w-full"
                placeholder={field.hideLabel ? field.label : ''}
                value={typeof value === 'string' ? value : ''}
                unboundEvents={{input: 'typed'}}
            />
          : <Input
                {...bound}
                className={`${boxed} ${width('w-32')}`}
                forceValue={true}
                placeholder={field.hideLabel ? field.label : ''}
                value={typeof value === 'string' ? value : ''}
                unboundEvents={{corgi: [[CHANGED, 'changed']]}}
            />;
    default:
      throw checkExhaustive(field.type);
  }
}

// A blank to show while the feature holds none of the options, which goes away once one is picked.
// Choosing it does nothing, so clearing a value is up to an option the user made for it.
function unsetOption(field: FieldDefinition, compact: boolean, known: boolean):
    Array<{label: string; value: string; selected: boolean}> {
  return known ? [] : [{label: compact ? field.label : '', value: '', selected: true}];
}

interface Args {
  field: FieldDefinition;
}

class FieldInputController extends Controller<Args, EmptyDeps, HTMLElement, {}> {

  private field: FieldDefinition;

  constructor(response: Response<FieldInputController>) {
    super(response);
    this.field = response.args.field;
  }

  override updateArgs(newArgs: Args): void {
    this.field = newArgs.field;
  }

  // A color, select, pattern, or single line of text, where an empty box clears the field
  changed(e: CorgiEvent<typeof CHANGED>): void {
    this.edited(e.detail.value || undefined);
  }

  // A date, number, or multiline text. A number the box can't parse yet, like "-", is skipped.
  typed(e: CorgiEvent<typeof DOM_EVENT>): void {
    const raw = (e.actionElement.element() as HTMLInputElement|HTMLTextAreaElement).value;
    if (this.field.type !== 'number' || raw === '') {
      this.edited(raw || undefined);
    } else if (Number.isFinite(Number(raw))) {
      this.edited(Number(raw));
    }
  }

  // Unchecked clears the field, since a feature without it reads as unchecked anyway.
  toggled(e: CorgiEvent<typeof DOM_EVENT>): void {
    this.edited((e.actionElement.element() as HTMLInputElement).checked || undefined);
  }

  iconClicked(): void {
    this.trigger(FIELD_ICON_CLICKED, {field: this.field});
  }

  private edited(value: boolean|number|string|undefined): void {
    this.trigger(FIELD_EDITED, {field: this.field, value});
  }
}
