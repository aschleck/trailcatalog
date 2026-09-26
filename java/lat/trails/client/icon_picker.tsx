import * as corgi from 'external/dev_april_corgi+/js/corgi';
import { Controller, Response } from 'external/dev_april_corgi+/js/corgi/controller';
import { EmptyDeps } from 'external/dev_april_corgi+/js/corgi/deps';
import { CorgiEvent, DOM_MOUSE } from 'external/dev_april_corgi+/js/corgi/events';
import { Button } from 'external/dev_april_corgi+/js/emu/button';
import { ACTION, CHANGED, CLOSE } from 'external/dev_april_corgi+/js/emu/events';
import { Input } from 'external/dev_april_corgi+/js/emu/input';

import { DEFAULT_ICON, DEFAULT_ICON_SHRINK, pointIcon } from './features';

// The default, then outdoor places and hazards
const OUTDOORS = [
  DEFAULT_ICON, '⛺', '🏕', '🏔', '⛰', '🌲', '🌄', '🌊', '💧',
  '🚰', '🔥', '🅿', '🚻', '🏠', '🛖', '🏨', '🍽',
  '☕', '🍺', '🛒', '⛪', '🚌', '🚡', '🚂', '⛽',
  '⚠', '⛔', 'ℹ', '⭐', '❤', '📍', '🚩', '🏁',
  '📷', '👀', '🐄', '🧗', '🥾', '🚲', '⛷',
];

// Built by py/trim_emojibase.py from emojibase-data, keeping what Noto Emoji draws
const CATALOG_URL = '/static/emoji.json';

/**
 * Draws a point's icon the way the map does, see FeatureLayer#planLabels. SVG text anchored on its
 * middle, because CSS centers a glyph by its font's line box and emoji sit high in theirs.
 */
export function PointMarker({color, icon}: {color: string; icon: string|undefined}) {
  const glyph = pointIcon(icon);
  const size = glyph === DEFAULT_ICON ? 15 * DEFAULT_ICON_SHRINK : 15;
  return (
    <svg className="h-4 shrink-0 w-4" viewBox="0 0 16 16">
      <text
          dominantBaseline="central"
          fill={color}
          fontSize={`${size}px`}
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

/** Picks an icon for a point and calls onChosen with it before closing. */
export function IconPickerDialog(props: {
  color: string;
  current: string|undefined;
  onChosen: (icon: string|undefined) => void;
  // Icons other points in the collection already have, most common first
  used: string[];
}) {
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

interface Tab {
  name: string;
  icon: string;
  glyphs: string[];
}

interface State {
  catalog: Catalog|undefined;
  query: string;
  tab: number;
}

function IconPicker(
    {color, current, onChosen, used}: {
      color: string;
      current: string|undefined;
      onChosen: (icon: string|undefined) => void;
      used: string[];
    },
    inState: State|undefined,
    updateState: (newState: State) => void) {
  const state = inState ?? {catalog: undefined, query: '', tab: 0};
  const chosen = pointIcon(current);
  const tabs = tabsFor(used, state.catalog);
  const tab = tabs[state.tab];

  let glyphs: string[];
  let heading: string;
  if (!state.query) {
    glyphs = tab.glyphs;
    heading = tab.name;
  } else if (state.catalog) {
    glyphs = search(state.catalog, state.query);
    heading = glyphs.length > 0 ? 'Results' : 'No icons match';
  } else {
    glyphs = [];
    heading = 'Loading…';
  }

  return <>
    <div
        js={corgi.bind({
          controller: IconPickerController,
          args: {onChosen},
          events: {
            render: 'wakeup',
          },
          state: [state, updateState],
        })}
        className="bg-white flex flex-col gap-2 p-3 rounded shadow-lg text-gray-900 w-96"
    >
      <div className="flex font-bold items-center justify-between">
        Icon
        <Button ariaLabel="Close" unboundEvents={{corgi: [[ACTION, 'dismiss']]}}>
          <svg className="h-4 stroke-current w-4" viewBox="0 0 12 12">
            <path d="M0 0 L12 12 M0 12 L12 0" />
          </svg>
        </Button>
      </div>
      <Input
          autofocus={true}
          className="border border-gray-300 px-1 rounded"
          placeholder="Search"
          type="search"
          unboundEvents={{corgi: [[CHANGED, 'queryChanged'], [ACTION, 'queryEntered']]}}
      />
      <div className={'border-b border-gray-300 flex' + (state.query ? ' invisible' : '')}>
        {tabs.map((t, i) =>
            <button
                ariaLabel={t.name}
                className={tabClass(i === state.tab)}
                data={{tab: i}}
                title={t.name}
                unboundEvents={{click: 'tabClicked'}}
            >
              <PointMarker color="currentColor" icon={t.icon} />
            </button>
        )}
      </div>
      <div className="text-gray-500 text-sm">{heading}</div>
      <div className="gap-1 grid grid-cols-10 h-64 overflow-y-auto" style="align-content: start">
        {glyphs.map(glyph => {
          const label =
              glyph === DEFAULT_ICON ? 'Default' : state.catalog?.byGlyph.get(glyph)?.label;
          return (
            <button
                ariaLabel={label ?? glyph}
                className={cellClass(glyph === chosen)}
                data={{icon: glyph}}
                title={label ?? ''}
                unboundEvents={{click: 'chosen'}}
            >
              <PointMarker color={color} icon={glyph} />
            </button>
          );
        })}
      </div>
    </div>
  </>;
}

// Noto Emoji is the single color font the map draws icons with, so the list and the picker show
// icons in the point's color the way the map does.
const GLYPH_FONT = 'font-family: "Noto Emoji", sans-serif';

function tabsFor(used: string[], catalog: Catalog|undefined): Tab[] {
  const tabs = [{name: 'Outdoors', icon: '🌲', glyphs: OUTDOORS}];
  if (used.length > 0) {
    tabs.push({name: 'In this collection', icon: '📍', glyphs: used});
  }
  for (const {name, icon, icons} of catalog?.groups ?? []) {
    tabs.push({name, icon, glyphs: icons.map(i => i.glyph)});
  }
  return tabs;
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

function tabClass(selected: boolean): string {
  return 'flex grow justify-center py-1 '
      + (selected ? 'border-b-2 border-blue-600 text-blue-600' : 'hover:bg-gray-100 text-gray-500');
}

function cellClass(chosen: boolean): string {
  return 'flex h-8 items-center justify-center rounded '
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
}

class IconPickerController extends Controller<Args, EmptyDeps, HTMLElement, State> {

  private readonly onChosen: (icon: string|undefined) => void;

  constructor(response: Response<IconPickerController>) {
    super(response);
    this.onChosen = response.args.onChosen;

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

  tabClicked(e: CorgiEvent<typeof DOM_MOUSE>): void {
    const tab = e.actionElement.data('tab')?.number();
    if (tab !== undefined) {
      this.updateState({...this.state, tab});
    }
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

  private choose(icon: string): void {
    this.onChosen(icon === DEFAULT_ICON ? undefined : icon);
    this.trigger(CLOSE, {kind: 'resolve'});
  }
}
