// Low precision sun and moon positions from Meeus's Astronomical Algorithms, good to about a minute
// of rise and set time, which is plenty for planning where to stand.
// https://www.aa.quae.nl/en/reken/zonpositie.html
// https://www.aa.quae.nl/en/reken/hemelpositie.html

const RAD = Math.PI / 180;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
// Julian day of the Unix epoch, and of J2000.0
const J1970 = 2440588;
const J2000 = 2451545;
const OBLIQUITY = 23.4397 * RAD;

// Where the sun's center sits for each event. Rise and set are its upper limb on the horizon
// through average refraction. Golden hour is from 6 degrees up to 4 below, and blue hour from 4 to
// 6 below.
// https://www.photopills.com/articles/understanding-golden-hour-blue-hour-and-twilights
const SUNRISE_ALTITUDE = -0.833 * RAD;
const GOLDEN_ALTITUDE = 6 * RAD;
const BLUE_ALTITUDE = -4 * RAD;
const CIVIL_ALTITUDE = -6 * RAD;
// The moon's center at rise and set, which includes its parallax
const MOONRISE_ALTITUDE = 0.133 * RAD;

/** Where something is in the sky, in radians. Azimuth runs clockwise from north. */
export interface SkyPosition {
  azimuth: number;
  altitude: number;
}

/** What the sun does over a day, as epoch ms. Missing events don't happen that day. */
export interface SunTimes {
  noon: number;
  sunrise?: number;
  sunset?: number;
  morningBlue?: {start: number; end: number};
  morningGolden?: {start: number; end: number};
  eveningGolden?: {start: number; end: number};
  eveningBlue?: {start: number; end: number};
}

export interface MoonTimes {
  moonrise?: number;
  moonset?: number;
}

export interface MoonPhase {
  // 0 is new, 0.25 first quarter, 0.5 full, and 0.75 last quarter.
  phase: number;
  // The lit fraction of the disc
  illumination: number;
}

/** Returns where the sun is at a time and place, without refraction. */
export function getSunPosition(ms: number, latRadians: number, lngRadians: number): SkyPosition {
  const d = toDays(ms);
  return horizontal(d, latRadians, lngRadians, sunCoordinates(d));
}

/** Returns where the moon is at a time and place, with refraction so it matches what rises. */
export function getMoonPosition(ms: number, latRadians: number, lngRadians: number): SkyPosition {
  const d = toDays(ms);
  const position = horizontal(d, latRadians, lngRadians, moonCoordinates(d));
  return {...position, altitude: position.altitude + refraction(position.altitude)};
}

export function getMoonPhase(ms: number): MoonPhase {
  const d = toDays(ms);
  const sun = sunCoordinates(d);
  const moon = moonCoordinates(d);
  // The angle between the sun and the moon seen from the Earth, and then from the moon
  const elongation =
      Math.acos(
          Math.sin(sun.declination) * Math.sin(moon.declination)
              + Math.cos(sun.declination) * Math.cos(moon.declination)
                  * Math.cos(sun.rightAscension - moon.rightAscension));
  const sunDistanceKm = 149598000;
  const inclination =
      Math.atan2(
          sunDistanceKm * Math.sin(elongation),
          moon.distanceKm - sunDistanceKm * Math.cos(elongation));
  const angle =
      Math.atan2(
          Math.cos(sun.declination) * Math.sin(sun.rightAscension - moon.rightAscension),
          Math.sin(sun.declination) * Math.cos(moon.declination)
              - Math.cos(sun.declination) * Math.sin(moon.declination)
                  * Math.cos(sun.rightAscension - moon.rightAscension));
  return {
    phase: 0.5 + 0.5 * inclination * (angle < 0 ? -1 : 1) / Math.PI,
    illumination: (1 + Math.cos(inclination)) / 2,
  };
}

/** Returns the sun's events over the solar day whose noon is nearest to ms at a longitude. */
export function getSunTimes(ms: number, latRadians: number, lngRadians: number): SunTimes {
  const lw = -lngRadians;
  const n = Math.round(toDays(ms) - 0.0009 - lw / (2 * Math.PI));
  const approxTransit = 0.0009 + lw / (2 * Math.PI) + n;
  const M = solarMeanAnomaly(approxTransit);
  const L = eclipticLongitude(M);
  const declination = getDeclination(L, 0);
  const transit = approxTransit + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);

  // The times either side of noon when the sun's center crosses an altitude
  const crossing = (altitude: number): {rise: number; set: number}|undefined => {
    const cos =
        (Math.sin(altitude) - Math.sin(latRadians) * Math.sin(declination))
            / (Math.cos(latRadians) * Math.cos(declination));
    if (cos < -1 || cos > 1) {
      return undefined;
    }
    const days = Math.acos(cos) / (2 * Math.PI);
    return {rise: fromDays(transit - days), set: fromDays(transit + days)};
  };
  const between = (low: number, high: number) => {
    const lower = crossing(low);
    const upper = crossing(high);
    if (!lower || !upper) {
      return undefined;
    }
    return {
      morning: {start: lower.rise, end: upper.rise},
      evening: {start: upper.set, end: lower.set},
    };
  };

  const sun = crossing(SUNRISE_ALTITUDE);
  const golden = between(BLUE_ALTITUDE, GOLDEN_ALTITUDE);
  const blue = between(CIVIL_ALTITUDE, BLUE_ALTITUDE);
  return {
    noon: fromDays(transit),
    sunrise: sun?.rise,
    sunset: sun?.set,
    morningBlue: blue?.morning,
    morningGolden: golden?.morning,
    eveningGolden: golden?.evening,
    eveningBlue: blue?.evening,
  };
}

/**
 * Returns the moon's first rise and set in the 24 hours from start. The moon moves too fast for a
 * closed form, so we fit a parabola to its altitude every two hours and solve it.
 */
export function getMoonTimes(start: number, latRadians: number, lngRadians: number): MoonTimes {
  const toMs = (hours: number) => start + hours * HOUR_MS;
  const altitudeAt = (hours: number) =>
      getMoonPosition(toMs(hours), latRadians, lngRadians).altitude - MOONRISE_ALTITUDE;

  const times: MoonTimes = {};
  let h0 = altitudeAt(0);
  for (let i = 1; i <= 24; i += 2) {
    const h1 = altitudeAt(i);
    const h2 = altitudeAt(i + 1);
    const a = (h0 + h2) / 2 - h1;
    const b = (h2 - h0) / 2;
    const xe = -b / (2 * a);
    const ye = (a * xe + b) * xe + h1;
    const discriminant = b * b - 4 * a * h1;
    const roots: number[] = [];
    if (discriminant >= 0) {
      const dx = Math.sqrt(discriminant) / (Math.abs(a) * 2);
      for (const x of [xe - dx, xe + dx]) {
        if (Math.abs(x) <= 1) {
          roots.push(x);
        }
      }
    }
    // With one root the sign of h0 says which way it crosses, and with two the vertex does.
    if (roots.length === 1) {
      if (h0 < 0) {
        times.moonrise ??= toMs(i + roots[0]);
      } else {
        times.moonset ??= toMs(i + roots[0]);
      }
    } else if (roots.length === 2) {
      const [first, second] = ye < 0 ? [roots[1], roots[0]] : roots;
      times.moonrise ??= toMs(i + first);
      times.moonset ??= toMs(i + second);
    }
    if (times.moonrise !== undefined && times.moonset !== undefined) {
      break;
    }
    h0 = h2;
  }
  return times;
}

// Days since J2000.0
function toDays(ms: number): number {
  return ms / DAY_MS - 0.5 + J1970 - J2000;
}

function fromDays(days: number): number {
  return (days + 0.5 + J2000 - J1970) * DAY_MS;
}

function horizontal(
    d: number,
    latRadians: number,
    lngRadians: number,
    {declination, rightAscension}: {declination: number; rightAscension: number}): SkyPosition {
  const hourAngle = siderealTime(d, -lngRadians) - rightAscension;
  const fromSouth =
      Math.atan2(
          Math.sin(hourAngle),
          Math.cos(hourAngle) * Math.sin(latRadians)
              - Math.tan(declination) * Math.cos(latRadians));
  const altitude =
      Math.asin(
          Math.sin(latRadians) * Math.sin(declination)
              + Math.cos(latRadians) * Math.cos(declination) * Math.cos(hourAngle));
  return {azimuth: normalize(fromSouth + Math.PI), altitude};
}

function siderealTime(d: number, lw: number): number {
  return RAD * (280.16 + 360.9856235 * d) - lw;
}

function solarMeanAnomaly(d: number): number {
  return RAD * (357.5291 + 0.98560028 * d);
}

function eclipticLongitude(M: number): number {
  const center = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const perihelion = RAD * 102.9372;
  return M + center + perihelion + Math.PI;
}

function getDeclination(l: number, b: number): number {
  return Math.asin(
      Math.sin(b) * Math.cos(OBLIQUITY) + Math.cos(b) * Math.sin(OBLIQUITY) * Math.sin(l));
}

function getRightAscension(l: number, b: number): number {
  return Math.atan2(
      Math.sin(l) * Math.cos(OBLIQUITY) - Math.tan(b) * Math.sin(OBLIQUITY), Math.cos(l));
}

function sunCoordinates(d: number): {declination: number; rightAscension: number} {
  const L = eclipticLongitude(solarMeanAnomaly(d));
  return {declination: getDeclination(L, 0), rightAscension: getRightAscension(L, 0)};
}

function moonCoordinates(d: number):
    {declination: number; rightAscension: number; distanceKm: number} {
  const L = RAD * (218.316 + 13.176396 * d); // ecliptic longitude
  const M = RAD * (134.963 + 13.064993 * d); // mean anomaly
  const F = RAD * (93.272 + 13.22935 * d); // mean distance
  const l = L + RAD * 6.289 * Math.sin(M);
  const b = RAD * 5.128 * Math.sin(F);
  return {
    declination: getDeclination(l, b),
    rightAscension: getRightAscension(l, b),
    distanceKm: 385001 - 20905 * Math.cos(M),
  };
}

// Bennett's formula, clamped at the horizon because it blows up below it
function refraction(altitude: number): number {
  const h = Math.max(altitude, 0);
  return 0.0002967 / Math.tan(h + 0.00312536 / (h + 0.08901179));
}

function normalize(radians: number): number {
  const turn = 2 * Math.PI;
  return ((radians % turn) + turn) % turn;
}
