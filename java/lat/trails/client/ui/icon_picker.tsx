import * as corgi from 'external/dev_april_corgi+/js/corgi';
import { Controller, Response } from 'external/dev_april_corgi+/js/corgi/controller';
import { EmptyDeps } from 'external/dev_april_corgi+/js/corgi/deps';
import { CorgiEvent, DOM_CLIPBOARD, DOM_MOUSE } from 'external/dev_april_corgi+/js/corgi/events';
import { ACTION, CHANGED, CLOSE } from 'external/dev_april_corgi+/js/emu/events';
import { Input } from 'external/dev_april_corgi+/js/emu/input';

import { PanelCloseButton } from 'js/pika/buttons';
import { DIALOG_SURFACE } from 'js/pika/dialog';
import { TEXT_BOX } from 'js/pika/fields';

import { pointIcon } from '../model/features';
import { getIconImageId, getImageUrl } from '../model/images';
import { DEFAULT_ICON, DEFAULT_POINT_RADIUS_PX } from '../workers/collection_schema';

// Outdoor places and hazards
const OUTDOORS = [
  '⛺', '🏕', '🏔', '⛰', '🌲', '🌄', '🌊', '💧',
  '🚰', '🔥', '🅿', '🚻', '🏠', '🛖', '🏨', '🍽',
  '☕', '🍺', '🛒', '⛪', '🚌', '🚡', '🚂', '⛽',
  '⚠', '⛔', 'ℹ', '⭐', '❤', '📍', '🚩', '🏁',
  '📷', '👀', '🐄', '🧗', '🥾', '🚲', '⛷',
];

// Built by py/trim_emojibase.py from emojibase-data, keeping what Noto Emoji draws
const CATALOG_URL = new URL('emoji.json', import.meta.url).href;

/**
 * Draws a point's icon the way the map does, see FeatureLayer#planLabels. SVG text anchored on its
 * middle, because CSS centers a glyph by its font's line box and emoji sit high in theirs.
 */
export function PointMarker({color, icon, size}: {
  color: string;
  icon: string|undefined;
  // Tailwind height and width classes, h-4 w-4 unless set
  size?: string;
}) {
  const glyph = pointIcon(icon);
  const image = getIconImageId(glyph);
  const sized = size ?? 'h-4 w-4';
  if (image !== undefined) {
    return (
      <img
          alt=""
          // the padding shows the fill as a ring, like FeatureLayer draws it
          className={`${sized} object-cover p-[1.5px] ring-1 ring-white rounded-full shrink-0`}
          src={getImageUrl(image, 'thumbnail')}
          style={`background-color: ${color}`}
      />
    );
  }
  if (glyph === DEFAULT_ICON) {
    // ringed in white like FeatureLayer's circles, with the stroke inside the radius
    return (
      <svg className={`${sized} shrink-0`} viewBox="0 0 16 16">
        <circle cx="8" cy="8" fill={color} r={DEFAULT_POINT_RADIUS_PX - 0.5} stroke="white" />
      </svg>
    );
  }
  return (
    <svg className={`${sized} shrink-0`} viewBox="0 0 16 16">
      <text
          dominantBaseline="central"
          fill={color}
          fontSize="15px"
          style={GLYPH_FONT}
          textAnchor="middle"
          x="8"
          y="8"
      >
        {glyph}
      </text>
    </svg>
  );
}

/** Shows an icon the way the map draws it, on a button that opens IconPickerDialog. */
export function IconPickerButton({color, icon, ...props}: {
  color: string;
  icon: string|undefined;
} & corgi.Properties) {
  return (
    <button
        className="
            border
            border-gray-300
            flex
            h-7
            hover:bg-gray-100
            items-center
            justify-center
            rounded
            shrink-0
            w-8
        "
        {...props}
    >
      <PointMarker color={color} icon={icon} />
    </button>
  );
}

interface Props {
  color: string;
  current: string|undefined;
  onChosen: (icon: string|undefined) => void;
  // Uploads a photo and returns the icon value that shows it. Unset where icons can't be images.
  upload?: (file: File) => Promise<string>;
  // Icons other points in the collection already have, most common first
  used: string[];
}

/** Picks an icon for a point and calls onChosen with it before closing. */
export function IconPickerDialog(props: Props) {
  return <IconPicker {...props} />;
}

interface Icon {
  glyph: string;
  label: string;
  labelWords: string[];
  tagWords: string[];
}

interface Catalog {
  groups: Array<{name: string; icon: string; icons: Icon[]}>;
  byGlyph: Map<string, Icon>;
}

interface Section {
  name: string;
  icon: string;
  glyphs: string[];
}

interface State {
  catalog: Catalog|undefined;
  // Set while a file is dragged over the upload button
  dragging: boolean;
  pane: 'icons'|'upload';
  query: string;
  uploading: 'failed'|'started'|undefined;
}

function IconPicker(
    {color, current, onChosen, upload, used}: Props,
    inState: State|undefined,
    updateState: (newState: State) => void) {
  const state: State =
      inState ?? {
        catalog: undefined,
        dragging: false,
        pane: 'icons',
        query: '',
        uploading: undefined,
      };
  const chosen = pointIcon(current);
  const currentImage = getIconImageId(chosen);

  return <>
    <div
        js={corgi.bind({
          controller: IconPickerController,
          args: {onChosen, upload},
          events: {
            paste: 'pasted',
            render: 'wakeup',
          },
          state: [state, updateState],
        })}
        className={`${DIALOG_SURFACE} flex flex-col w-96`}
    >
      <div className="border-b border-gray-200 flex gap-1 items-center px-3">
        <PaneTab label="Icons" pane="icons" selected={state.pane === 'icons'} />
        {upload ? <PaneTab label="Upload" pane="upload" selected={state.pane === 'upload'} /> : ''}
        <div className="grow" />
        {chosen !== DEFAULT_ICON
            ? <button
                  className="px-2 py-1 rounded text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                  unboundEvents={{click: 'removeClicked'}}
              >
                Remove
              </button>
            : ''
        }
        <PanelCloseButton unboundEvents={{corgi: [[ACTION, 'dismiss']]}} />
      </div>
      {state.pane === 'icons'
          ? <IconsPane
                catalog={state.catalog}
                chosen={chosen}
                color={color}
                query={state.query}
                used={used}
            />
          : <UploadPane
                dragging={state.dragging}
                replacing={currentImage !== undefined}
                uploading={state.uploading}
            />
      }
    </div>
  </>;
}

function PaneTab({label, pane, selected}: {label: string; pane: State['pane']; selected: boolean}) {
  return (
    <button
        className={
          '-mb-px border-b-2 outline-none px-2 py-2.5 focus-visible:bg-gray-100 '
              + (selected
                  ? 'border-gray-900 font-medium text-gray-900'
                  : 'border-transparent text-gray-500 hover:text-gray-900')
        }
        data={{pane}}
        unboundEvents={{click: 'paneClicked'}}
    >
      {label}
    </button>
  );
}

// Every section stacks in one scrolling list, and the bar under it jumps to a section.
function IconsPane({catalog, chosen, color, query, used}: {
  catalog: Catalog|undefined;
  chosen: string;
  color: string;
  query: string;
  used: string[];
}) {
  const sections = sectionsFor(used, catalog);
  const shown =
      !query ? sections
          : catalog ? [{name: 'Results', icon: '', glyphs: search(catalog, query)}]
          : [{name: 'Loading…', icon: '', glyphs: []}];
  return <>
    <div className="pb-1 pt-3 px-3">
      <Input
          autofocus={true}
          className={`${TEXT_BOX} h-8`}
          icon={
            <svg className="h-4 shrink-0 stroke-gray-400 w-4" fill="none" viewBox="0 0 16 16">
              <circle cx="7" cy="7" r="4.5" strokeWidth="1.5" />
              <path d="M10.5 10.5 L14 14" strokeWidth="1.5" />
            </svg>
          }
          placeholder="Search icons"
          type="search"
          unboundEvents={{corgi: [[CHANGED, 'queryChanged'], [ACTION, 'queryEntered']]}}
      />
    </div>
    <div className="h-80 overflow-y-auto pb-2 px-3">
      {shown.map(({name, glyphs}, i) =>
          <div data={{section: i}}>
            <div className="font-medium pb-1 pt-3 text-gray-500 text-xs">
              {query && glyphs.length === 0 ? 'No icons match' : name}
            </div>
            <div className="grid grid-cols-10">
              {glyphs.map(glyph => {
                const label = catalog?.byGlyph.get(glyph)?.label;
                return (
                  <button
                      ariaLabel={label ?? (getIconImageId(glyph) ? 'Uploaded image' : glyph)}
                      className={cellClass(glyph === chosen)}
                      data={{icon: glyph}}
                      title={label ?? ''}
                      unboundEvents={{click: 'chosen'}}
                  >
                    <PointMarker color={color} icon={glyph} size="h-6 w-6" />
                  </button>
                );
              })}
            </div>
          </div>
      )}
    </div>
    {query
        ? ''
        : <div className="border-gray-200 border-t flex justify-between px-2 py-1">
            {sections.map(({name, icon}, i) =>
                <button
                    ariaLabel={name}
                    className="hover:bg-gray-100 hover:text-gray-900 p-1.5 rounded text-gray-500"
                    data={{section: i}}
                    title={name}
                    unboundEvents={{click: 'sectionClicked'}}
                >
                  <PointMarker color="currentColor" icon={icon} size="h-5 w-5" />
                </button>
            )}
          </div>
    }
  </>;
}

function UploadPane({dragging, replacing, uploading}: {
  dragging: boolean;
  // Set when the point shows an image already
  replacing: boolean;
  uploading: State['uploading'];
}) {
  return <>
    <div className="flex flex-col gap-2 p-3">
      <button
          className={
            'border-2 border-dashed disabled:opacity-50 flex flex-col gap-2 h-48 items-center '
                + 'justify-center rounded [&_*]:pointer-events-none '
                + (dragging
                    ? 'bg-blue-50 border-blue-500 text-blue-700'
                    : 'bg-gray-50 border-gray-300 hover:bg-gray-100 text-gray-700')
          }
          disabled={uploading === 'started'}
          unboundEvents={{
            click: 'uploadClicked',
            dragleave: 'uploadDragLeft',
            dragover: 'uploadDraggedOver',
            drop: 'uploadDropped',
          }}
      >
        <svg className="h-8 stroke-current w-8" fill="none" viewBox="0 0 20 20">
          <rect height="13" rx="1.5" strokeWidth="1" width="16" x="2" y="3.5" />
          <circle cx="7" cy="8" r="1.5" strokeWidth="1" />
          <path d="M2.5 14.5 L7.5 10.5 L11 13 L14 10.5 L17.5 13.5" strokeWidth="1" />
        </svg>
        <div className="font-medium">
          {uploading === 'started'
              ? 'Uploading…'
              : dragging ? 'Drop to upload' : replacing ? 'Replace image' : 'Upload an image'}
        </div>
        {dragging
            ? ''
            : <div className="text-gray-500 text-xs">or drop a photo here, or paste one</div>
        }
      </button>
      {uploading === 'failed'
          ? <div className="text-center text-red-700 text-xs">Couldn't upload that image</div>
          : ''
      }
    </div>
  </>;
}

// Noto Emoji is the single color font the map draws icons with, so the list and the picker show
// icons in the point's color the way the map does.
const GLYPH_FONT = 'font-family: "Noto Emoji", sans-serif';

function sectionsFor(used: string[], catalog: Catalog|undefined): Section[] {
  const sections: Section[] = [];
  if (used.length > 0) {
    sections.push({name: 'In this collection', icon: '📍', glyphs: used});
  }
  sections.push({name: 'Outdoors', icon: '🌲', glyphs: OUTDOORS});
  for (const {name, icon, icons} of catalog?.groups ?? []) {
    sections.push({name, icon, glyphs: icons.map(i => i.glyph)});
  }
  return sections;
}

/**
 * Returns the icons where every query term starts a word of the label or tags, best first so that
 * "bear" puts the bear ahead of "bearded" and "water bearer".
 */
function search(catalog: Catalog, query: string): string[] {
  const terms = wordsOf(query);
  const matches: Array<[score: number, glyph: string]> = [];
  for (const {icons} of catalog.groups) {
    for (const icon of icons) {
      let score = 0;
      for (const term of terms) {
        const rank = rankTerm(term, icon);
        if (rank === undefined) {
          score = -1;
          break;
        }
        score += rank;
      }
      if (score >= 0) {
        matches.push([score, icon.glyph]);
      }
    }
  }
  return matches.sort((a, b) => a[0] - b[0]).map(([, glyph]) => glyph);
}

// Lower is better: a whole label word, a label prefix, a whole tag, then a tag prefix
function rankTerm(term: string, icon: Icon): number|undefined {
  if (icon.labelWords.includes(term)) {
    return 0;
  } else if (icon.labelWords.some(w => w.startsWith(term))) {
    return 1;
  } else if (icon.tagWords.includes(term)) {
    return 2;
  } else if (icon.tagWords.some(w => w.startsWith(term))) {
    return 3;
  } else {
    return undefined;
  }
}

function wordsOf(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w);
}

function cellClass(chosen: boolean): string {
  return 'flex h-9 items-center justify-center rounded '
      + (chosen ? 'bg-blue-100' : 'hover:bg-gray-100');
}

let catalogLoad: Promise<Catalog>|undefined;

function loadCatalog(): Promise<Catalog> {
  if (!catalogLoad) {
    catalogLoad = fetch(CATALOG_URL)
        .then(response => response.json())
        // group,tab icon,[emoji,label,tags]
        .then((raw: Array<[string, string, Array<[string, string, string]>]>) => {
          const byGlyph = new Map<string, Icon>();
          const groups = raw.map(([name, tabIcon, entries]) => ({
            name,
            icon: tabIcon,
            icons: entries.map(([glyph, label, tags]) => {
              const icon = {glyph, label, labelWords: wordsOf(label), tagWords: wordsOf(tags)};
              byGlyph.set(glyph, icon);
              return icon;
            }),
          }));
          return {groups, byGlyph};
        })
        .catch(e => {
          // Or else one failed fetch empties every picker until the page reloads
          catalogLoad = undefined;
          throw e;
        });
  }
  return catalogLoad;
}

interface Args {
  onChosen: (icon: string|undefined) => void;
  upload?: (file: File) => Promise<string>;
}

class IconPickerController extends Controller<Args, EmptyDeps, HTMLElement, State> {

  private readonly onChosen: (icon: string|undefined) => void;
  private readonly upload: ((file: File) => Promise<string>)|undefined;

  constructor(response: Response<IconPickerController>) {
    super(response);
    this.onChosen = response.args.onChosen;
    this.upload = response.args.upload;

    if (!this.state.catalog) {
      loadCatalog()
          .then(catalog => {
            this.updateState({...this.state, catalog});
          })
          .catch(e => {
            console.error(e);
          });
    }
  }

  // The default is stored as no icon, so that it follows DEFAULT_ICON.
  chosen(e: CorgiEvent<typeof DOM_MOUSE>): void {
    const icon = e.actionElement.data('icon')?.string();
    if (icon) {
      this.choose(icon);
    }
  }

  paneClicked(e: CorgiEvent<typeof DOM_MOUSE>): void {
    const pane = e.actionElement.data('pane')?.string();
    if (pane === 'icons' || pane === 'upload') {
      this.updateState({...this.state, pane});
    }
  }

  sectionClicked(e: CorgiEvent<typeof DOM_MOUSE>): void {
    const section = e.actionElement.data('section')?.number();
    this.root
        .querySelector(`[data-section="${section}"]`)
        ?.scrollIntoView({block: 'start'});
  }

  removeClicked(): void {
    this.choose(DEFAULT_ICON);
  }

  queryChanged(e: CorgiEvent<typeof CHANGED>): void {
    this.updateState({...this.state, query: e.detail.value.trim()});
  }

  queryEntered(): void {
    const {catalog, query} = this.state;
    const first = catalog && query ? search(catalog, query)[0] : undefined;
    if (first) {
      this.choose(first);
    }
  }

  dismiss(): void {
    this.trigger(CLOSE, {kind: 'reject'});
  }

  uploadClicked(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.addEventListener('change', () => {
      this.uploadFile(input.files?.[0]);
    });
    input.click();
  }

  pasted(e: CorgiEvent<typeof DOM_CLIPBOARD>): void {
    const file = e.detail.clipboardData?.files[0];
    if (file?.type.startsWith('image/')) {
      e.detail.preventDefault();
      this.uploadFile(file);
    }
  }

  uploadDraggedOver(e: CorgiEvent<typeof DOM_MOUSE>): void {
    const transfer = (e.detail as DragEvent).dataTransfer;
    if (transfer?.types.includes('Files')) {
      transfer.dropEffect = 'copy';
      if (!this.state.dragging) {
        this.updateState({...this.state, dragging: true});
      }
    }
  }

  uploadDragLeft(): void {
    this.updateState({...this.state, dragging: false});
  }

  uploadDropped(e: CorgiEvent<typeof DOM_MOUSE>): void {
    this.updateState({...this.state, dragging: false});
    this.uploadFile((e.detail as DragEvent).dataTransfer?.files[0]);
  }

  private uploadFile(file: File|undefined): void {
    const upload = this.upload;
    if (!upload || !file || this.state.uploading === 'started') {
      return;
    }

    this.updateState({...this.state, pane: 'upload', uploading: 'started'});
    upload(file)
        .then(icon => {
          this.choose(icon);
        })
        .catch(e => {
          console.error(e);
          this.updateState({...this.state, uploading: 'failed'});
        });
  }

  private choose(icon: string): void {
    this.onChosen(icon === DEFAULT_ICON ? undefined : icon);
    this.trigger(CLOSE, {kind: 'resolve'});
  }
}
