// Material 3's compact window class, and phones held sideways, which are wide but too short for the
// menubar and sidebar.
// https://m3.material.io/foundations/layout/applying-layout/window-size-classes
export const COMPACT_QUERY = '(max-width: 599px), (pointer: coarse) and (max-height: 599px)';

let hydrating = false;

export function setHydrating(value: boolean): void {
  hydrating = value;
}

// The server can't know the screen, so it and the hydration of what it rendered both take the
// desktop layout, and ViewerController switches once it's running.
/** Returns whether a page rendering now should take the phone layout. */
export function startsCompact(): boolean {
  return !!process.env.CORGI_FOR_BROWSER && !hydrating && matchMedia(COMPACT_QUERY).matches;
}

/**
 * Marks the page as iOS for app.css's ios: variant. ?platform= forces it, for trying one platform's
 * look on another.
 */
export function detectPlatform(): void {
  const root = document.documentElement;
  if (root.dataset.platform) {
    return;
  }

  const forced = new URLSearchParams(location.search).get('platform');
  // iPadOS asks for desktop sites as a Mac, which only its touch screen gives away
  const ios =
      /iPhone|iPad|iPod/.test(navigator.userAgent)
          || (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1);
  const platform = forced ?? (ios ? 'ios' : '');
  if (platform) {
    root.dataset.platform = platform;
  }
}
