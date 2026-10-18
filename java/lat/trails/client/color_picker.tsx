import { checkExists } from 'external/dev_april_corgi+/js/common/asserts';
import * as corgi from 'external/dev_april_corgi+/js/corgi';
import { disposeBoundElementsIn } from 'external/dev_april_corgi+/js/corgi/binder';
import { Controller, Response } from 'external/dev_april_corgi+/js/corgi/controller';
import { EmptyDeps } from 'external/dev_april_corgi+/js/corgi/deps';
import { CorgiEvent, DOM_MOUSE, DOM_POINTER } from 'external/dev_april_corgi+/js/corgi/events';
import { CHANGED } from 'external/dev_april_corgi+/js/emu/events';
import { Input } from 'external/dev_april_corgi+/js/emu/input';

import { OPTION_COLORS } from './schema';
import { isHexColor, parseColor } from './workers/collection_schema';

const CHECKERBOARD = 'repeating-conic-gradient(#d1d5db 0 25%, white 0 50%) 0 0 / 8px 8px';
const CUSTOM_KEY = 'color_picker.custom';
const MAX_CUSTOM = 8;

type Hsv = [h: number, s: number, v: number];

/**
 * Shows a color over a checkerboard, on a button that opens a picker and fires CHANGED with every
 * color chosen in it. A field's default leads the saved colors.
 */
export function ColorPickerButton(
    {color, fieldDefault, ...props}: {color: string; fieldDefault?: string} & corgi.Properties,
    state: {}|undefined,
    updateState: (newState: {}) => void) {
  return <>
    <button
        js={corgi.bind({
          controller: ColorPickerButtonController,
          args: {color, fieldDefault},
          events: {click: 'clicked'},
          state: [state ?? {}, updateState],
        })}
        className="
            bg-white
            border
            border-gray-300
            cursor-pointer
            h-7
            hover:border-gray-400
            p-0.5
            rounded
            shrink-0
            w-9
        "
        {...props}
    >
      <span className="block h-full rounded-sm" style={`background: ${over(color)}`} />
    </button>
  </>;
}

interface ButtonArgs {
  color: string;
  fieldDefault: string|undefined;
}

class ColorPickerButtonController extends Controller<ButtonArgs, EmptyDeps, HTMLElement, {}> {

  private args: ButtonArgs;

  constructor(response: Response<ColorPickerButtonController>) {
    super(response);
    this.args = response.args;
  }

  override updateArgs(newArgs: ButtonArgs): void {
    this.args = newArgs;
  }

  clicked(): void {
    corgi.appendElement(
        document.body,
        <ColorPicker
            anchor={this.root.getBoundingClientRect()}
            color={this.args.color}
            fieldDefault={this.args.fieldDefault}
            onChanged={color => {
              this.trigger(CHANGED, {value: color});
            }}
        />);
  }
}

interface State {
  // Kept as HSV rather than hex so that the hue survives dragging to gray or black
  hsv: Hsv;
  // 0 to 255
  alpha: number;
  // Most recent first
  custom: string[];
  // Undefined until the controller measures the popup
  position: {left: number; top: number}|undefined;
}

function ColorPicker(
    {anchor, color, fieldDefault, onChanged}: {
      anchor: DOMRect;
      color: string;
      fieldDefault: string|undefined;
      onChanged: (color: string) => void;
    },
    inState: State|undefined,
    updateState: (newState: State) => void) {
  const parsed = parseHex(color) ?? {rgb: [0, 0, 0], alpha: 255};
  const state = inState ?? {
    hsv: rgbToHsv(parsed.rgb),
    alpha: parsed.alpha,
    custom: loadCustom(),
    position: undefined,
  };
  const [h, s, v] = state.hsv;
  const hex = toHex(state.hsv, state.alpha);
  const opaque = toHex(state.hsv, 255);
  const position = state.position;
  const swatches =
      [...new Set([...OPTION_COLORS, ...(fieldDefault ? [fieldDefault] : []), ...state.custom])]
          .slice(0, OPTION_COLORS.length + MAX_CUSTOM);

  return <>
    <div
        js={corgi.bind({
          controller: ColorPickerController,
          args: {anchor, onChanged},
          events: {
            corgi: [[CHANGED, 'hexChanged']],
            render: 'wakeup',
          },
          state: [state, updateState],
        })}
        className="fixed inset-0 z-50"
    >
      <div className="absolute inset-0" unboundEvents={{click: 'close'}} />
      <div
          className={
            'absolute bg-white border border-gray-200 flex flex-col gap-2 p-2.5 rounded shadow-lg '
                + `w-60${position ? '' : ' invisible'}`
          }
          style={position ? `left: ${position.left}px; top: ${position.top}px` : ''}
      >
        <div className="flex gap-2 h-40">
          <div
              ariaLabel="Saturation and brightness"
              className="cursor-crosshair grow relative rounded-sm touch-none"
              style={
                'background: linear-gradient(to top, black, transparent), '
                    + `linear-gradient(to right, white, ${toHex([h, 1, 1], 255)})`
              }
              unboundEvents={{pointerdown: 'shadeDragged', pointermove: 'shadeDragged'}}
          >
            <div
                className="
                    -translate-x-1/2
                    -translate-y-1/2
                    absolute
                    border-2
                    border-white
                    h-3
                    pointer-events-none
                    rounded-full
                    shadow
                    w-3
                "
                style={`left: ${s * 100}%; top: ${(1 - v) * 100}%`}
            />
          </div>
          <Strip
              background="linear-gradient(to bottom, red, yellow, lime, cyan, blue, magenta, red)"
              fraction={h / 360}
              label="Hue"
              unboundEvents={{pointerdown: 'hueDragged', pointermove: 'hueDragged'}}
          />
          <Strip
              background={`linear-gradient(to bottom, ${opaque}, transparent), ${CHECKERBOARD}`}
              fraction={1 - state.alpha / 255}
              label="Opacity"
              unboundEvents={{pointerdown: 'alphaDragged', pointermove: 'alphaDragged'}}
          />
        </div>
        <div className="border border-gray-300 flex gap-2 h-8 items-center pl-2 pr-1 rounded">
          <Input
              ariaLabel="Hex color"
              className="grow min-w-0"
              forceValue={true}
              value={hex}
          />
          <span
              className="border border-gray-200 h-6 rounded-sm shrink-0 w-6"
              style={`background: ${over(hex)}`}
          />
        </div>
        <div className="gap-1.5 grid grid-cols-8">
          {swatches.map(swatch =>
              <button
                  ariaLabel={swatch}
                  className={
                    'aspect-square border cursor-pointer rounded-sm '
                        + (swatch === hex
                            ? 'border-gray-900 outline outline-1 outline-gray-900'
                            : 'border-black/10 hover:border-gray-500')
                  }
                  data={{color: swatch}}
                  style={`background: ${over(swatch)}`}
                  title={swatch === fieldDefault ? `Default, ${swatch}` : swatch}
                  unboundEvents={{click: 'swatchClicked'}}
              />
          )}
          <button
              ariaLabel="Save color"
              className="
                  aspect-square
                  cursor-pointer
                  flex
                  hover:bg-gray-100
                  items-center
                  justify-center
                  rounded-sm
                  text-gray-600
              "
              title="Save color"
              unboundEvents={{click: 'saveClicked'}}
          >
            <svg className="h-3 stroke-current w-3" fill="none" viewBox="0 0 12 12">
              <path d="M6 1 V11 M1 6 H11" strokeWidth="1.5" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  </>;
}

// A vertical gradient with a bar across it at fraction from the top
function Strip({background, fraction, label, ...props}: {
  background: string;
  fraction: number;
  label: string;
} & corgi.Properties) {
  return (
    <div
        {...props}
        ariaLabel={label}
        className="cursor-pointer relative rounded-sm shrink-0 touch-none w-4"
        style={`background: ${background}`}
        title={label}
    >
      <div
          className="
              -inset-x-0.5
              -translate-y-1/2
              absolute
              border-2
              border-white
              h-1.5
              pointer-events-none
              rounded-sm
              shadow
          "
          style={`top: ${fraction * 100}%`}
      />
    </div>
  );
}

interface Args {
  anchor: DOMRect;
  onChanged: (color: string) => void;
}

class ColorPickerController extends Controller<Args, EmptyDeps, HTMLElement, State> {

  private readonly onChanged: (color: string) => void;

  constructor(response: Response<ColorPickerController>) {
    super(response);
    this.onChanged = response.args.onChanged;

    this.registerListener(document, 'keydown', e => {
      if (e.key === 'Escape') {
        this.close();
      }
    });

    // Below the anchor unless that runs off the bottom, and always inside the window
    const anchor = response.args.anchor;
    const popup = checkExists(this.root.lastElementChild).getBoundingClientRect();
    const below = anchor.bottom + 4;
    const top =
        below + popup.height <= window.innerHeight
            ? below
            : Math.max(0, anchor.top - 4 - popup.height);
    const left = Math.max(0, Math.min(anchor.left, window.innerWidth - popup.width));
    this.updateState({...this.state, position: {left, top}});
  }

  // Removing the root doesn't dispose us, because only the vdom's own removals do that.
  close(): void {
    this.root.remove();
    disposeBoundElementsIn(this.root);
  }

  shadeDragged(e: CorgiEvent<typeof DOM_POINTER>): void {
    const at = dragFraction(e);
    if (at) {
      this.choose([this.state.hsv[0], at[0], 1 - at[1]], this.state.alpha);
    }
  }

  hueDragged(e: CorgiEvent<typeof DOM_POINTER>): void {
    const at = dragFraction(e);
    if (at) {
      const [, s, v] = this.state.hsv;
      this.choose([at[1] * 360, s, v], this.state.alpha);
    }
  }

  alphaDragged(e: CorgiEvent<typeof DOM_POINTER>): void {
    const at = dragFraction(e);
    if (at) {
      this.choose(this.state.hsv, Math.round((1 - at[1]) * 255));
    }
  }

  // Ignores text that isn't a color yet, so that typing one doesn't fight the box. The box also
  // reports the color we put in it, which is already chosen.
  hexChanged(e: CorgiEvent<typeof CHANGED>): void {
    const text = e.detail.value.trim().toLowerCase();
    if (text === toHex(this.state.hsv, this.state.alpha)) {
      return;
    }
    const parsed = parseHex(text.startsWith('#') ? text : `#${text}`);
    if (parsed) {
      this.choose(this.hsvKeepingHue(parsed.rgb), parsed.alpha);
    }
  }

  swatchClicked(e: CorgiEvent<typeof DOM_MOUSE>): void {
    const parsed = parseHex(checkExists(e.actionElement.data('color')).string());
    if (parsed) {
      this.choose(this.hsvKeepingHue(parsed.rgb), parsed.alpha);
    }
  }

  saveClicked(): void {
    const hex = toHex(this.state.hsv, this.state.alpha);
    if (OPTION_COLORS.includes(hex)) {
      return;
    }
    const custom = [hex, ...this.state.custom.filter(c => c !== hex)].slice(0, MAX_CUSTOM);
    window.localStorage.setItem(CUSTOM_KEY, JSON.stringify(custom));
    this.updateState({...this.state, custom});
  }

  private choose(hsv: Hsv, alpha: number): void {
    const before = toHex(this.state.hsv, this.state.alpha);
    this.updateState({...this.state, hsv, alpha});
    const after = toHex(hsv, alpha);
    if (after !== before) {
      this.onChanged(after);
    }
  }

  // Gray has no hue of its own, so it takes the current one and the hue strip doesn't jump to red.
  private hsvKeepingHue(rgb: [number, number, number]): Hsv {
    const [h, s, v] = rgbToHsv(rgb);
    return s === 0 ? [this.state.hsv[0], s, v] : [h, s, v];
  }
}

// Where the pointer is across the element from 0 to 1, or undefined for a move without a press. The
// element captures the press so a drag that leaves it keeps steering.
function dragFraction(e: CorgiEvent<typeof DOM_POINTER>): [number, number]|undefined {
  const element = e.actionElement.element();
  const pointer = e.detail;
  if (pointer.type === 'pointerdown') {
    element.setPointerCapture(pointer.pointerId);
  } else if (!element.hasPointerCapture(pointer.pointerId)) {
    return undefined;
  }
  const bounds = element.getBoundingClientRect();
  return [
    clamp01((pointer.clientX - bounds.left) / bounds.width),
    clamp01((pointer.clientY - bounds.top) / bounds.height),
  ];
}

// Text that isn't JSON, say from editing storage by hand, reads as no saved colors.
function loadCustom(): string[] {
  let saved: unknown;
  try {
    saved = JSON.parse(window.localStorage.getItem(CUSTOM_KEY) ?? '[]');
  } catch {
    return [];
  }
  return Array.isArray(saved)
      ? saved.filter(isHexColor).slice(0, MAX_CUSTOM)
      : [];
}

// A CSS background that shows color over a checkerboard, so translucent colors read as such
function over(color: string): string {
  return `linear-gradient(${color}, ${color}), ${CHECKERBOARD}`;
}

function parseHex(hex: string): {rgb: [number, number, number]; alpha: number}|undefined {
  if (!isHexColor(hex)) {
    return undefined;
  }
  const rgba = parseColor(hex);
  return {rgb: [rgba >>> 24, (rgba >>> 16) & 0xFF, (rgba >>> 8) & 0xFF], alpha: rgba & 0xFF};
}

// Opaque colors are #rrggbb so that they match the default swatches.
function toHex(hsv: Hsv, alpha: number): string {
  const bytes = alpha === 255 ? hsvToRgb(hsv) : [...hsvToRgb(hsv), alpha];
  return `#${bytes.map(b => b.toString(16).padStart(2, '0')).join('')}`;
}

// https://en.wikipedia.org/wiki/HSL_and_HSV#HSV_to_RGB_alternative
function hsvToRgb([h, s, v]: Hsv): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return [f(5), f(3), f(1)];
}

function rgbToHsv([r, g, b]: [number, number, number]): Hsv {
  const max = Math.max(r, g, b);
  const range = max - Math.min(r, g, b);
  let h = 0;
  if (range > 0) {
    if (max === r) {
      h = 60 * (((g - b) / range + 6) % 6);
    } else if (max === g) {
      h = 60 * ((b - r) / range + 2);
    } else {
      h = 60 * ((r - g) / range + 4);
    }
  }
  return [h, max === 0 ? 0 : range / max, max / 255];
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
