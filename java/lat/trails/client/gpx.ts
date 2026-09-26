import { EditableFeature, EditableLine, EditablePoint } from './features';

/**
 * Reads the waypoints of a GPX into points and its tracks into lines, one per track segment.
 *
 * Routes are dropped because a route is a plan rather than a record.
 */
export function parseGpx(text: string): EditableFeature[] {
  const parsed = new DOMParser().parseFromString(text, 'application/xml');
  if (parsed.getElementsByTagName('parsererror').length > 0) {
    throw new Error('Unable to parse the GPX');
  }

  const points: EditablePoint[] = [];
  for (const waypoint of Array.from(parsed.getElementsByTagNameNS('*', 'wpt'))) {
    const lat = degrees(waypoint.getAttribute('lat'), 90);
    const lng = degrees(waypoint.getAttribute('lon'), 180);
    if (lat === undefined || lng === undefined) {
      continue;
    }

    const name = childText(waypoint, 'name');
    const description = childText(waypoint, 'desc');
    const elevation = Number(childText(waypoint, 'ele') ?? NaN);
    points.push({
      kind: 'point',
      id: crypto.randomUUID(),
      version: 0n,
      data: {
        ...(name !== undefined ? {name} : {}),
        ...(description !== undefined ? {description} : {}),
      },
      latE7: Math.round(lat * 1e7),
      lngE7: Math.round(lng * 1e7),
      elevationCentimeters: Number.isFinite(elevation) ? Math.round(elevation * 100) : undefined,
    });
  }

  const lines: EditableLine[] = [];
  // Tags are matched in any namespace because a GPX declares one and some writers put it on a
  // prefix.
  for (const track of Array.from(parsed.getElementsByTagNameNS('*', 'trk'))) {
    const name = childText(track, 'name');
    for (const segment of Array.from(track.getElementsByTagNameNS('*', 'trkseg'))) {
      const points = Array.from(segment.getElementsByTagNameNS('*', 'trkpt'));
      if (points.length < 2) {
        continue;
      }

      const latLngE7 = new Int32Array(2 * points.length);
      const elevationCentimeters = new Int32Array(points.length);
      const timeSeconds = new BigInt64Array(points.length);
      // If any point is missing an elevation or time, we drop them from the whole track
      let haveElevations = true;
      let haveTimes = true;
      // A missing lat or lon reads as 0 through Number, so a segment carrying one would plant a
      // point off Africa rather than fail.
      let haveCoordinates = true;
      for (let i = 0; i < points.length; ++i) {
        const point = points[i];
        const lat = degrees(point.getAttribute('lat'), 90);
        const lng = degrees(point.getAttribute('lon'), 180);
        if (lat === undefined || lng === undefined) {
          haveCoordinates = false;
          break;
        }

        latLngE7[2 * i] = Math.round(lat * 1e7);
        latLngE7[2 * i + 1] = Math.round(lng * 1e7);

        const elevation = childText(point, 'ele');
        if (elevation === undefined || !Number.isFinite(Number(elevation))) {
          haveElevations = false;
        } else {
          elevationCentimeters[i] = Math.round(Number(elevation) * 100);
        }

        const time = childText(point, 'time');
        const at = time !== undefined ? Date.parse(time) : NaN;
        if (Number.isNaN(at)) {
          haveTimes = false;
        } else {
          timeSeconds[i] = BigInt(Math.round(at / 1000));
        }
      }

      if (!haveCoordinates) {
        continue;
      }

      lines.push({
        kind: 'line',
        id: crypto.randomUUID(),
        version: 0n,
        data: name !== undefined ? {name} : {},
        latLngE7,
        elevationCentimeters: haveElevations ? elevationCentimeters : undefined,
        timeSeconds: haveTimes ? timeSeconds : undefined,
      });
    }
  }
  return [...points, ...lines];
}

function degrees(value: string|null, limit: number): number|undefined {
  // Number('') is 0, so an empty attribute has to go out before the parse.
  if (value === null || value.trim() === '') {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || Math.abs(parsed) > limit) {
    return undefined;
  }
  return parsed;
}

function childText(element: Element, tag: string): string|undefined {
  for (const child of Array.from(element.children)) {
    if (child.localName === tag) {
      return child.textContent ?? undefined;
    }
  }
  return undefined;
}
