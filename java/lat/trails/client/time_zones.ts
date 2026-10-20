import { readCookie, writeCookie } from 'js/cookies/cookies';

const DAY_MS = 24 * 60 * 60 * 1000;
const ZONE_CHOICE_COOKIE = 'time_zone';

export type ZoneChoice = 'device'|'map';

export function readZoneChoice(): ZoneChoice {
  return readCookie(ZONE_CHOICE_COOKIE) === 'map' ? 'map' : 'device';
}

export function writeZoneChoice(choice: ZoneChoice): void {
  writeCookie(ZONE_CHOICE_COOKIE, choice);
}

// A tzdb id, or undefined for the device's zone
let shownZone: string|undefined;

export function getShownZone(): string|undefined {
  return shownZone;
}

export function setShownZone(zone: string|undefined): void {
  shownZone = zone;
}

// A browser with older tzdb data than the server's boundaries doesn't know zones added since.
export function isKnownZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat(undefined, {timeZone: zone});
    return true;
  } catch {
    return false;
  }
}

export function toWallClock(at: number, zone: string|undefined): string {
  const f = getWallClockFields(at, zone);
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return `${pad(f.year, 4)}-${pad(f.month)}-${pad(f.day)}T${pad(f.hour)}:${pad(f.minute)}`;
}

// A time the clock repeats resolves to the earlier one and a time it skips to an hour later, like
// Temporal's compatible disambiguation.
export function fromWallClock(value: string, zone: string|undefined): number {
  const match = /^(\d{4,})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d))?/.exec(value);
  if (!match) {
    return NaN;
  }
  const [year, month, day, hour, minute, second] = match.slice(1).map(n => Number(n ?? 0));
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  // Any transition near the time is between the offsets a day on either side of it.
  const before = getOffsetMs(asUtc - DAY_MS, zone);
  const after = getOffsetMs(asUtc + DAY_MS, zone);
  const valid =
      [before, after]
          .filter(offset => getOffsetMs(asUtc - offset, zone) === offset)
          .map(offset => asUtc - offset);
  return valid.length > 0 ? Math.min(...valid) : asUtc - before;
}

function getOffsetMs(at: number, zone: string|undefined): number {
  const f = getWallClockFields(at, zone);
  const wall = Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute, f.second);
  return wall - Math.floor(at / 1000) * 1000;
}

function getWallClockFields(at: number, zone: string|undefined) {
  const parts =
      new Intl.DateTimeFormat('en-US', {
        timeZone: zone,
        hourCycle: 'h23',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
      }).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find(part => part.type === type)?.value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}
