import { debugMode } from 'external/dev_april_corgi+/js/common/debug';
import * as corgi from 'external/dev_april_corgi+/js/corgi';
import { Controller, Response } from 'external/dev_april_corgi+/js/corgi/controller';
import { EmptyDeps } from 'external/dev_april_corgi+/js/corgi/deps';

type Children = corgi.VElementOrPrimitive|corgi.VElementOrPrimitive[];

interface SidebarState {
  expanded: boolean;
}

// On a narrow screen the sidebar is a panel under the map that starts collapsed to one bar, so the
// map gets the whole screen until someone asks for the list. SSR can't know the screen width, so
// the md: classes are what keep it open on a wide one.
/** Stacks sections down the side of the map, or under it on a narrow screen. */
export function SidebarElement(
    {children}: {children?: Children},
    inState: SidebarState|undefined,
    updateState: (newState: SidebarState) => void) {
  const state = inState ?? {expanded: false};
  return <>
    <div className={
      'bg-white border-gray-300 border-t flex flex-col min-h-0 shrink-0 text-gray-900 text-sm '
          + 'md:border-l md:border-t-0 md:h-full md:w-72 '
          + (state.expanded ? 'h-[45%]' : '')
    }>
      <div
          js={corgi.bind({
            controller: SidebarController,
            events: {
              click: 'toggle',
            },
            state: [state, updateState],
          })}
          className="
              border-b
              border-gray-300
              cursor-pointer
              flex
              items-center
              justify-center
              md:hidden
              min-h-11
              select-none
          "
      >
        <svg className="h-4 stroke-current text-gray-500 w-4" fill="none" viewBox="0 0 16 16">
          <path d={state.expanded ? 'M3 6 L8 11 L13 6' : 'M3 10 L8 5 L13 10'} strokeWidth="2" />
        </svg>
        <span className="font-bold px-1">Features and layers</span>
      </div>
      <div className={
        'flex-col grow min-h-0 md:flex ' + (state.expanded ? 'flex' : 'hidden')
      }>
        {children ?? []}
        {/*
          Holds the closed sections at the top when every section is closed, and grows so little
          that open sections take nearly all the space.
        */}
        <div style="flex: 0.001 1 0" />
      </div>
    </div>
  </>;
}

class SidebarController extends Controller<{}, EmptyDeps, HTMLElement, SidebarState> {

  constructor(response: Response<SidebarController>) {
    super(response);
  }

  toggle(): void {
    this.updateState({expanded: !this.state.expanded});
  }
}

interface SectionState {
  open: boolean;
}

/** A titled part of the sidebar that opens and closes itself. Open sections share the space. */
export function SidebarSection(
    {children, controls, label, open, persist}: {
      children?: Children;
      // Beside the title, and outside the toggle so they reach the controller their events name
      controls?: Children;
      label: string;
      open?: boolean;
      // The key in SidebarCookie#sections to remember whether the section is open under, which then
      // wins over open
      persist?: string;
    },
    inState: SectionState|undefined,
    updateState: (newState: SectionState) => void) {
  const remembered = persist ? readSidebarCookie().sections?.[persist] : undefined;
  const state = inState ?? {open: remembered ?? open ?? true};
  return (
    <div
        className={'border-b border-gray-300 flex flex-col ' + (state.open ? 'min-h-0' : 'shrink-0')}
        style={state.open ? 'flex: 1 1 0' : ''}
    >
      <div className="flex items-center pr-2">
        <div
            js={corgi.bind({
              controller: SidebarSectionController,
              args: {persist},
              events: {
                click: 'toggle',
              },
              state: [state, updateState],
            })}
            className="cursor-pointer flex gap-1 grow items-center px-2 py-1 select-none"
        >
          <svg
              className="h-3 shrink-0 stroke-current text-gray-500 w-3"
              fill="none"
              viewBox="0 0 16 16"
          >
            <path d={state.open ? 'M3 6 L8 11 L13 6' : 'M6 3 L11 8 L6 13'} strokeWidth="2" />
          </svg>
          <span className="font-bold">{label}</span>
        </div>
        {controls ?? []}
      </div>
      {state.open
          ? <div className="border-gray-300 border-t grow min-h-0 overflow-y-auto py-1">
              {children ?? []}
            </div>
          : ''
      }
    </div>
  );
}

class SidebarSectionController
    extends Controller<{persist: string|undefined}, EmptyDeps, HTMLElement, SectionState> {

  private readonly persist: string|undefined;

  constructor(response: Response<SidebarSectionController>) {
    super(response);
    this.persist = response.args.persist;
  }

  toggle(): void {
    const open = !this.state.open;
    this.updateState({open});
    const persist = this.persist;
    if (persist) {
      const cookie = readSidebarCookie();
      writeSidebarCookie({...cookie, sections: {...cookie.sections, [persist]: open}});
    }
  }
}

const SIDEBAR_COOKIE = 'sidebar';

// How the sidebar was left, kept in a cookie rather than local storage so that the server render
// comes up the same way. Every field is optional because an older client may have written it.
export interface SidebarCookie {
  // Whether each section is open, by SidebarSection#persist
  sections?: {[key: string]: boolean};
}

export function readSidebarCookie(): SidebarCookie {
  const raw =
      (window.SERVER_SIDE_RENDER?.cookies() ?? window.document?.cookie)
          ?.split('; ')
          ?.find(c => c.startsWith(`${SIDEBAR_COOKIE}=`))
          ?.substring(SIDEBAR_COOKIE.length + 1);
  if (!raw) {
    return {};
  }

  // A cookie the user mangled shouldn't break the page, so start over from the defaults.
  try {
    const parsed = JSON.parse(decodeURIComponent(raw));
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export function writeSidebarCookie(cookie: SidebarCookie): void {
  const secure = debugMode() ? '' : '; Secure';
  // a year, so that it outlives the browser session
  document.cookie =
      `${SIDEBAR_COOKIE}=${encodeURIComponent(JSON.stringify(cookie))}; Max-Age=31536000; `
          + `Path=/; SameSite=Strict${secure}`;
}
