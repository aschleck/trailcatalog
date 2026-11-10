import { checkExists } from 'external/dev_april_corgi+/js/common/asserts';
import { Future } from 'external/dev_april_corgi+/js/common/futures';
import * as corgi from 'external/dev_april_corgi+/js/corgi';
import { Controller, Response } from 'external/dev_april_corgi+/js/corgi/controller';
import { EmptyDeps } from 'external/dev_april_corgi+/js/corgi/deps';
import { CorgiEvent, DOM_POINTER } from 'external/dev_april_corgi+/js/corgi/events';
import { ACTION, CHANGED, FOCUSED, PRESSED } from 'external/dev_april_corgi+/js/emu/events';
import { Input } from 'external/dev_april_corgi+/js/emu/input';
import { Collection, ListCollectionsResponse, User } from 'trails_lat/proto/data_pb';

import { Tool } from '../model/events';
import { Icon, IconName } from './material_icons';
import { SearchState } from './search_box';
import { getToolIcon, getTools } from './toolbar';

type Children = corgi.VElementOrPrimitive|corgi.VElementOrPrimitive[];

export type Tab = 'map'|'search'|'library';

export type LayersSegment = 'collection'|'layers';

export interface MobileState {
  // Whether the page takes the phone layout, see layout.ts
  compact: boolean;
  tab: Tab;
  layersOpen: boolean;
  layersSegment: LayersSegment;
  toolsOpen: boolean;
  // Loaded the first time Library opens
  library: Future<ListCollectionsResponse>|undefined;
}

// Everything here is laid over the map or beside it, and leaves the map's controller alone.
// Buttons name ViewerController's methods in unboundEvents, so none of these elements may bind a
// controller around content that does the same.

/** The bar of destinations along the bottom of the screen. */
export function NavigationBar({tab}: {tab: Tab}) {
  return <>
    <nav
        className="
            bg-surface-container
            flex
            ios:backdrop-blur-xl
            ios:bg-surface-container/90!
            ios:border-outline
            ios:border-t
            shrink-0
            text-on-surface-variant
            z-40
        "
        style="padding-bottom: var(--inset-bottom)"
    >
      <NavigationItem active={tab === 'map'} icon="map" label="Map" tab="map" />
      <NavigationItem active={tab === 'search'} icon="search" label="Search" tab="search" />
      <NavigationItem
          active={tab === 'library'}
          icon="bookmarks"
          label="Library"
          tab="library"
      />
    </nav>
  </>;
}

const FILLED_ICONS: Partial<Record<IconName, IconName>> = {
  bookmarks: 'bookmarks_fill',
  map: 'map_fill',
};

// https://m3.material.io/components/navigation-bar/specs
// https://developer.apple.com/design/human-interface-guidelines/tab-bars
function NavigationItem({active, icon, label, tab}: {
  active: boolean;
  icon: IconName;
  label: string;
  tab: Tab;
}) {
  return <>
    <button
        className="
            flex
            flex-1
            flex-col
            gap-1
            h-20
            ios:gap-0.5!
            ios:h-[49px]!
            items-center
            justify-center
            select-none
        "
        data={{tab}}
        unboundEvents={{click: 'mobileTabClicked'}}
    >
      <div className={
        'flex h-8 ios:h-7! items-center justify-center rounded-full transition-colors w-16 '
            + (active
                ? 'bg-secondary-container ios:bg-transparent! ios:text-primary! '
                    + 'text-on-secondary-container'
                : '')
      }>
        <Icon name={active ? FILLED_ICONS[icon] ?? icon : icon} />
      </div>
      <span className={
        'font-medium ios:text-[10px]! text-xs '
            + (active ? 'font-bold ios:font-medium! ios:text-primary! text-on-surface' : '')
      }>
        {label}
      </span>
    </button>
  </>;
}

/** The buttons floating over the map's top right corner. */
export function MapButtons({canRedo, canUndo, layersOpen, readOnly, tool, toolsOpen, user}: {
  canRedo: boolean;
  canUndo: boolean;
  layersOpen: boolean;
  readOnly: boolean;
  tool: Tool;
  toolsOpen: boolean;
  user: User|undefined;
}) {
  // The drawing tools' sheets undo their own points, which this would confuse with undoing edits.
  const history =
      !readOnly
          && (canUndo || canRedo)
          && tool !== 'line'
          && tool !== 'polygon'
          && tool !== 'measure'
          && tool !== 'terrain';
  return <>
    {toolsOpen
        ? <div className="absolute inset-0 z-20" unboundEvents={{click: 'mobileToolsClosed'}} />
        : ''
    }
    <div
        className="absolute flex flex-col gap-3 right-4 z-20"
        style="top: calc(var(--inset-top) + 12px)"
    >
      {user
          ? <MapButton data={{menu: 'user'}} label="Account" onClick="menubarMenuClicked">
              {user.pictureUrl
                  ? <img alt="" className="rounded-full size-8" src={user.pictureUrl} />
                  : <Icon className="size-7" name="account_circle" />
              }
            </MapButton>
          : <MapButton data={{menu: 'guest'}} label="Account" onClick="menubarMenuClicked">
              <Icon className="size-7" name="account_circle" />
            </MapButton>
      }
      <MapButton active={layersOpen} label="Layers" onClick="mobileLayersClicked">
        <Icon name="layers" />
      </MapButton>
      <div className="relative">
        <MapButton
            active={toolsOpen || tool !== 'pointer'}
            label="Tools"
            onClick="mobileToolsClicked"
        >
          {toolsOpen
              ? <Icon name="close" />
              : <svg className="fill-current size-5 stroke-current" viewBox="0 0 20 20">
                  {getToolIcon(tool)}
                </svg>
          }
        </MapButton>
        {toolsOpen ? <ToolsMenu readOnly={readOnly} tool={tool} /> : ''}
      </div>
      {history
          ? <>
              <MapButton disabled={!canUndo} label="Undo" onClick="undoEditClicked">
                <Icon name="undo" />
              </MapButton>
              <MapButton disabled={!canRedo} label="Redo" onClick="redoEditClicked">
                <Icon name="redo" />
              </MapButton>
            </>
          : ''
      }
    </div>
  </>;
}

// https://m3.material.io/components/fab-menu/specs
function ToolsMenu({readOnly, tool}: {readOnly: boolean; tool: Tool}) {
  return <>
    <div className="absolute flex flex-col gap-2 items-end mr-3 right-full top-0">
      {getTools(readOnly).map(({tool: t, label}) =>
          <button
              className={
                'flex gap-3 h-12 ios:backdrop-blur-xl ios:rounded-xl! items-center pl-4 pr-5 '
                    + 'rounded-full select-none shadow-md text-base whitespace-nowrap '
                    + (tool === t
                        ? 'bg-primary-container ios:bg-primary! ios:text-on-primary! '
                            + 'text-on-primary-container'
                        : 'bg-surface-container-high ios:bg-white/85! text-on-surface')
              }
              data={{tool: t}}
              unboundEvents={{click: 'mobileToolClicked'}}
          >
            <svg className="fill-current size-5 shrink-0 stroke-current" viewBox="0 0 20 20">
              {getToolIcon(t)}
            </svg>
            {label}
          </button>
      )}
    </div>
  </>;
}

function MapButton({active, children, data, disabled, label, onClick}: {
  active?: boolean;
  children?: Children;
  data?: {[key: string]: string};
  disabled?: boolean;
  label: string;
  onClick: string;
}) {
  return <>
    <button
        ariaLabel={label}
        className={
          'flex ios:backdrop-blur-xl ios:rounded-xl! ios:size-11! items-center justify-center '
              + 'rounded-full select-none shadow-md size-12 '
              + (disabled ? 'opacity-40 ' : '')
              + (active
                  ? 'bg-primary-container ios:bg-primary! ios:text-on-primary! '
                      + 'text-on-primary-container'
                  : 'bg-surface-container-high ios:bg-white/85! ios:text-primary! '
                      + 'text-on-surface-variant')
        }
        data={data ?? {}}
        disabled={disabled ?? false}
        title={label}
        unboundEvents={{click: onClick}}
    >
      {children ?? []}
    </button>
  </>;
}

type Snap = 'peek'|'half'|'full';

const SNAP_HEIGHTS: Record<Snap, string> = {
  peek: '7rem',
  half: '50%',
  full: 'calc(100% - var(--inset-top) - 1rem)',
};

interface SheetState {
  snap: Snap;
}

/** A standard bottom sheet that drags between a peek, half the map, and nearly all of it. */
export function BottomSheet(
    {children, initial}: {children?: Children; initial: Snap},
    inState: SheetState|undefined,
    updateState: (newState: SheetState) => void) {
  const state = inState ?? {snap: initial};
  return <>
    <div
        className="
            absolute
            bg-surface-container-low
            bottom-0
            duration-500
            ease-emphasized
            flex
            flex-col
            inset-x-0
            ios:backdrop-blur-xl
            ios:bg-white/90!
            ios:rounded-t-[12px]!
            rounded-t-[28px]
            shadow-[0_-1px_4px_rgb(0_0_0/0.15)]
            text-on-surface
            transition-[height]
            z-30
        "
        style={`height: ${SNAP_HEIGHTS[state.snap]}`}
    >
      <div
          js={corgi.bind({
            controller: SheetController,
            events: {
              pointercancel: 'pointerUp',
              pointerdown: 'pointerDown',
              pointermove: 'pointerMove',
              pointerup: 'pointerUp',
            },
            state: [state, updateState],
          })}
          className="flex justify-center py-4 shrink-0 touch-none"
      >
        <div className="
            bg-on-surface-variant/40
            h-1
            ios:bg-[#c5c5c7]!
            ios:h-[5px]!
            ios:w-9!
            rounded-full
            w-8
        " />
      </div>
      {/* The dialogs inside are styled to float over the map, which the sheet already does */}
      <div className="
          [&>*]:bg-transparent
          [&>*]:rounded-none
          [&>*]:shadow-none
          flex
          flex-col
          grow
          min-h-0
          overflow-y-auto
          overscroll-contain
      ">
        {children ?? []}
      </div>
    </div>
  </>;
}

// A fling faster than this goes to the next snap in its direction, in pixels per millisecond
const FLING_SPEED = 0.5;

class SheetController extends Controller<{}, EmptyDeps, HTMLElement, SheetState> {

  private drag: {
    pointer: number;
    startY: number;
    startHeight: number;
    lastY: number;
    lastTime: number;
    // Positive downward
    velocity: number;
  }|undefined;

  constructor(response: Response<SheetController>) {
    super(response);
    this.drag = undefined;
  }

  pointerDown(e: CorgiEvent<typeof DOM_POINTER>): void {
    const sheet = this.sheet();
    this.root.setPointerCapture(e.detail.pointerId);
    this.drag = {
      pointer: e.detail.pointerId,
      startY: e.detail.clientY,
      startHeight: sheet.getBoundingClientRect().height,
      lastY: e.detail.clientY,
      lastTime: e.detail.timeStamp,
      velocity: 0,
    };
    // The sheet follows the finger, and only eases into place once it lets go
    sheet.style.transitionDuration = '0s';
  }

  pointerMove(e: CorgiEvent<typeof DOM_POINTER>): void {
    const drag = this.drag;
    if (drag?.pointer !== e.detail.pointerId) {
      return;
    }

    const elapsed = e.detail.timeStamp - drag.lastTime;
    if (elapsed > 0) {
      drag.velocity = (e.detail.clientY - drag.lastY) / elapsed;
    }
    drag.lastY = e.detail.clientY;
    drag.lastTime = e.detail.timeStamp;
    const height = Math.max(0, drag.startHeight - (e.detail.clientY - drag.startY));
    this.sheet().style.height = `${height}px`;
  }

  pointerUp(e: CorgiEvent<typeof DOM_POINTER>): void {
    const drag = this.drag;
    if (drag?.pointer !== e.detail.pointerId) {
      return;
    }
    this.drag = undefined;

    const sheet = this.sheet();
    sheet.style.transitionDuration = '';
    const moved = Math.abs(e.detail.clientY - drag.startY);
    // A tap on the handle opens a peeking sheet and drops an open one back to its peek
    if (moved < 4) {
      this.snapTo(this.state.snap === 'peek' ? 'half' : 'peek');
      return;
    }

    const order: Snap[] = ['peek', 'half', 'full'];
    const parent = checkExists(sheet.parentElement).getBoundingClientRect().height;
    const height = sheet.getBoundingClientRect().height;
    let snap: Snap;
    if (Math.abs(drag.velocity) > FLING_SPEED) {
      const current = nearestSnap(height, parent);
      const step = drag.velocity > 0 ? -1 : 1;
      snap = order[Math.max(0, Math.min(order.length - 1, order.indexOf(current) + step))];
    } else {
      snap = nearestSnap(height, parent);
    }
    this.snapTo(snap);
  }

  private snapTo(snap: Snap): void {
    // The drag left a height in pixels, which the render won't replace when the snap is unchanged
    this.sheet().style.height = SNAP_HEIGHTS[snap];
    this.updateState({snap});
  }

  private sheet(): HTMLElement {
    return checkExists(this.root.parentElement);
  }
}

function nearestSnap(height: number, parent: number): Snap {
  let best: Snap = 'peek';
  let bestDistance = Infinity;
  for (const snap of ['peek', 'half', 'full'] as const) {
    const target = resolveHeight(SNAP_HEIGHTS[snap], parent);
    const distance = Math.abs(target - height);
    if (distance < bestDistance) {
      best = snap;
      bestDistance = distance;
    }
  }
  return best;
}

// Measures a CSS height inside a box of the parent's height, since the snaps mix rem, percents,
// and the inset variables.
function resolveHeight(css: string, parent: number): number {
  const box = document.createElement('div');
  box.style.cssText = `position: fixed; visibility: hidden; height: ${parent}px`;
  const probe = document.createElement('div');
  probe.style.height = css;
  box.appendChild(probe);
  document.body.appendChild(box);
  const height = probe.getBoundingClientRect().height;
  box.remove();
  return height;
}

/** Names the open collection over the map, and opens its features. */
export function CollectionChip({name}: {name: string}) {
  return <>
    <div
        className="
            absolute
            bg-surface-container-high
            cursor-pointer
            flex
            h-10
            ios:backdrop-blur-xl
            ios:bg-white/85!
            items-center
            left-4
            max-w-[calc(100%-6rem)]
            pl-3
            rounded-full
            select-none
            shadow-md
            text-on-surface
            z-20
        "
        style="top: calc(var(--inset-top) + 16px)"
        unboundEvents={{click: 'mobileCollectionChipClicked'}}
    >
      <Icon className="shrink-0 size-5 text-on-surface-variant" name="bookmarks" />
      <span className="font-medium px-2 text-sm truncate">{name}</span>
      <button
          ariaLabel="Collection options"
          className="flex items-center justify-center rounded-full shrink-0 size-10"
          data={{menu: 'collection'}}
          unboundEvents={{click: 'menubarMenuClicked'}}
      >
        <Icon className="size-5 text-on-surface-variant" name="more_vert" />
      </button>
      <button
          ariaLabel="Close collection"
          className="flex items-center justify-center rounded-full shrink-0 size-10"
          unboundEvents={{click: 'mobileCollectionClosed'}}
      >
        <Icon className="size-5 text-on-surface-variant" name="close" />
      </button>
    </div>
  </>;
}

/**
 * A modal sheet over the map with what's drawn on it: the open collection's features and the map
 * layers.
 */
export function LayersSheet({collection, layers, segment}: {
  // The feature list, when a collection is open
  collection: corgi.VElementOrPrimitive|undefined;
  layers: corgi.VElementOrPrimitive;
  segment: LayersSegment;
}) {
  const shown = collection ? segment : 'layers';
  return <>
    <div
        className="absolute bg-black/30 inset-0 z-40"
        unboundEvents={{click: 'mobileLayersClosed'}}
    />
    <div className="
        absolute
        bg-surface-container-low
        bottom-0
        flex
        flex-col
        inset-x-0
        ios:backdrop-blur-xl
        ios:bg-white/90!
        ios:rounded-t-[12px]!
        max-h-[70%]
        rounded-t-[28px]
        shadow-lg
        text-on-surface
        z-40
    ">
      <div className="flex gap-2 items-center pl-4 pr-2 pt-4 pb-2 shrink-0">
        {collection
            ? <div className="flex grow ios:bg-[#7676801f] ios:p-0.5 ios:rounded-[9px]">
                <Segment active={shown === 'collection'} label="Collection" segment="collection" />
                <Segment active={shown === 'layers'} label="Map layers" segment="layers" />
              </div>
            : <span className="grow pl-2 text-xl">Layers</span>
        }
        <button
            ariaLabel="Close"
            className="flex items-center justify-center rounded-full shrink-0 size-12"
            unboundEvents={{click: 'mobileLayersClosed'}}
        >
          <Icon name="close" />
        </button>
      </div>
      <div className="min-h-0 overflow-y-auto overscroll-contain pb-4 px-2 text-base">
        {shown === 'collection' ? collection ?? '' : layers}
      </div>
    </div>
  </>;
}

// https://m3.material.io/components/segmented-buttons/specs
// https://developer.apple.com/design/human-interface-guidelines/segmented-controls
function Segment({active, label, segment}: {
  active: boolean;
  label: string;
  segment: LayersSegment;
}) {
  return <>
    <button
        className={
          'border border-outline first:rounded-l-full flex-1 font-medium h-10 ios:border-0! '
              + 'ios:font-semibold! ios:h-8! ios:ml-0! ios:rounded-[7px]! ios:text-[13px]! '
              + 'last:rounded-r-full not-first:-ml-px px-3 text-sm '
              + (active
                  ? 'bg-secondary-container ios:shadow-sm text-on-secondary-container'
                  : 'text-on-surface')
        }
        data={{segment}}
        unboundEvents={{click: 'mobileLayersSegmentClicked'}}
    >
      {label}
    </button>
  </>;
}

/** The Search destination, a page covering the map until a result sends it there. */
export function SearchPage({state}: {state: SearchState}) {
  const results = state.results;
  return <>
    <Page>
      <div className="px-4 py-2">
        <Input
            className="
                [&_input]:outline-none
                bg-surface-container-high
                h-14
                ios:bg-[#7676801f]!
                ios:h-9!
                ios:px-2!
                ios:rounded-[10px]!
                ios:text-[17px]!
                px-4
                rounded-full
                text-base
                text-on-surface
            "
            forceValue={true}
            icon={<Icon className="shrink-0 size-6 text-on-surface-variant" name="search" />}
            placeholder="Search places, trails, or coordinates"
            size={1}
            type="search"
            value={state.query}
            // Results stay up when the keyboard goes away, so this leaves out searchBlurred.
            unboundEvents={{
              corgi: [
                [ACTION, 'searchSubmitted'],
                [CHANGED, 'searchChanged'],
                [FOCUSED, 'searchFocused'],
                [PRESSED, 'searchKeyPressed'],
              ],
            }}
        />
      </div>
      {/* https://m3.material.io/components/progress-indicators/specs */}
      <div className={
        'bg-secondary-container h-1 mx-4 overflow-hidden relative rounded-full shrink-0 '
            + (state.searching ? '' : 'invisible')
      }>
        <div className="absolute animate-slide bg-primary h-full rounded-full w-1/3" />
      </div>
      <div className="grow min-h-0 overflow-y-auto overscroll-contain">
        {!results
            ? ''
            : results.length === 0
                ? <div className="px-6 py-4 text-on-surface-variant">No results</div>
                : results.map((hit, i) =>
                    <ListItem
                        data={{index: String(i)}}
                        headline={hit.name}
                        onClick="searchResultPicked"
                        supporting={
                          [hit.label, hit.matched, ...hit.within].filter(s => s).join(' · ')
                        }
                    />
                )
        }
      </div>
    </Page>
  </>;
}

/** The Library destination, which lists the collections the user can open. */
export function LibraryPage({library, user}: {
  library: Future<ListCollectionsResponse>|undefined;
  user: User|undefined;
}) {
  let content;
  if (!user) {
    content =
        <div className="flex flex-col gap-4 items-start px-6 py-4">
          <span className="text-on-surface-variant">Log in to see your collections.</span>
          <button
              className="
                  bg-primary
                  font-medium
                  h-10
                  ios:font-semibold!
                  ios:h-11!
                  ios:rounded-xl!
                  px-6
                  rounded-full
                  text-on-primary
              "
              unboundEvents={{click: 'loginClicked'}}
          >
            Log in
          </button>
        </div>;
  } else if (!library?.finished) {
    content = <div className="px-6 py-4 text-on-surface-variant">Loading…</div>;
  } else if (!library.ok) {
    content = <div className="px-6 py-4 text-on-surface-variant">Couldn't load collections</div>;
  } else {
    const {collections, shared} = library.value();
    content = <>
      <LibrarySection collections={collections} label="Yours" />
      <LibrarySection collections={shared} label="Shared with you" />
    </>;
  }

  return <>
    <Page>
      <div className="ios:font-bold ios:px-4! ios:text-[34px]! px-6 py-4 text-[22px]">Library</div>
      <div className="grow min-h-0 overflow-y-auto overscroll-contain">{content}</div>
    </Page>
  </>;
}

function LibrarySection({collections, label}: {collections: Collection[]; label: string}) {
  if (collections.length === 0) {
    return <></>;
  }

  return <>
    <div className="font-medium pb-2 pt-4 px-6 text-on-surface-variant text-sm">{label}</div>
    {collections.map(collection =>
        <ListItem
            data={{collection: collection.id}}
            headline={collection.name || 'Untitled collection'}
            icon="bookmarks"
            onClick="libraryCollectionClicked"
        />
    )}
  </>;
}

function Page({children}: {children?: Children}) {
  return <>
    <div
        className="absolute bg-surface flex flex-col inset-0 text-on-surface z-30"
        style="padding-top: var(--inset-top)"
    >
      {children ?? []}
    </div>
  </>;
}

// https://m3.material.io/components/lists/specs
function ListItem({data, headline, icon, onClick, supporting}: {
  data: {[key: string]: string};
  headline: string;
  icon?: IconName;
  onClick: string;
  supporting?: string;
}) {
  return <>
    <div
        className="
            active:bg-on-surface/10
            cursor-pointer
            flex
            gap-4
            ios:border-b
            ios:border-outline-variant
            ios:min-h-11!
            items-center
            min-h-14
            px-6
            py-2
        "
        data={data}
        unboundEvents={{click: onClick}}
    >
      {icon ? <Icon className="shrink-0 size-6 text-on-surface-variant" name={icon} /> : ''}
      <div className="flex flex-col min-w-0">
        <span className="text-base truncate">{headline}</span>
        {supporting
            ? <span className="text-on-surface-variant text-sm truncate">{supporting}</span>
            : ''
        }
      </div>
    </div>
  </>;
}
