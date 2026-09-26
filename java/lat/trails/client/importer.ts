import { EditableFeature } from './features';
import { parseGeoJson } from './geojson';
import { parseGpx } from './gpx';

/** Reads a GPX or GeoJSON file, told apart by its first character since extensions lie. */
export function parseImport(text: string): EditableFeature[] {
  const start = text.trimStart()[0];
  if (start === '<') {
    return parseGpx(text);
  } else if (start === '{') {
    return parseGeoJson(text);
  } else {
    throw new Error('Unable to tell what kind of file this is');
  }
}
