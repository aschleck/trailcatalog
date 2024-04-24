import { Long } from 'java/org/trailcatalog/s2';
import { LatLng, LatLngRect, LatLngZoom, RgbaU32, Vec2, Vec4 } from 'js/map2/common/types';

export function celsiusToFahrenheit(celsius: number): number {
  return 1.8 * celsius + 32;
}

export function metersToFeet(meters: number): number {
  return meters * 3.28084;
}

export function metersToMiles(meters: number): number {
  return meters * 0.00062137119224;
}

export function degreesE7ToLatLng(lat: number, lng: number): LatLng {
  return [
    lat / 10_000_000,
    lng / 10_000_000,
  ] as const as LatLng;
}

export function projectLatLng(latLng: LatLng): Vec2 {
  const radians = [latLng[0] / 180 * Math.PI, latLng[1] / 180 * Math.PI];
  const x = radians[1] / Math.PI;
  const y = Math.log((1 + Math.sin(radians[0])) / (1 - Math.sin(radians[0]))) / (2 * Math.PI);
  return [x, y];
}

const reinterpretLongBuffer = new ArrayBuffer(8);
const reinterpretFloatArray = new Float64Array(reinterpretLongBuffer);
const reinterpretIntArray = new Int32Array(reinterpretLongBuffer);

/** Reads a float using the bits of a Closure Long. */
export function reinterpretLong(v: Long): number {
  reinterpretIntArray[0] = v.getHighBits();
  reinterpretIntArray[1] = v.getLowBits();
  return reinterpretFloatArray[0];
}

