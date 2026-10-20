import { debugMode } from 'external/dev_april_corgi+/js/common/debug';

/** Returns the cookie's raw value, read from the request during a server render. */
export function readCookie(name: string): string|undefined {
  return (window.SERVER_SIDE_RENDER?.cookies() ?? window.document?.cookie)
      ?.split('; ')
      ?.find(c => c.startsWith(`${name}=`))
      ?.substring(name.length + 1);
}

/** Sets a cookie for the whole site, with a value the caller has already made cookie safe. */
export function writeCookie(name: string, value: string): void {
  const secure = debugMode() ? '' : '; Secure';
  // a year, so that it outlives the browser session
  document.cookie = `${name}=${value}; Max-Age=31536000; Path=/; SameSite=Strict${secure}`;
}
