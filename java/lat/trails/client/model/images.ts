import { IMAGE_SIZES, MAX_ORIGINAL_SIZE_BYTES } from 'java/lat/trails/wire/wire';

export type ImageSize = typeof IMAGE_SIZES[number][0];

const ICON_PREFIX = 'image:';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Returns the icon field value that shows an image. */
export function getImageIcon(id: string): string {
  return ICON_PREFIX + id;
}

/** Returns the image an icon field value shows, if it shows one. */
export function getIconImageId(icon: string|undefined): string|undefined {
  if (!icon?.startsWith(ICON_PREFIX)) {
    return undefined;
  }
  const id = icon.substring(ICON_PREFIX.length);
  return UUID.test(id) ? id : undefined;
}

export function getImageUrl(id: string, size: ImageSize): string {
  return `/api/images/${id}/${size}`;
}

// Keep in sync with ApiServer.kt#uploadImage
export interface UploadedImage {
  id: string;
  // where the photo's GPS tags say it was taken
  location?: {latDegrees: number; lngDegrees: number};
}

/** Uploads a photo as it is, which the server re-encodes at each of IMAGE_SIZES. */
export async function uploadImage(collection: string, file: File): Promise<UploadedImage> {
  if (file.size > MAX_ORIGINAL_SIZE_BYTES) {
    throw new Error(`Image is ${file.size} bytes, over ${MAX_ORIGINAL_SIZE_BYTES}`);
  }
  const name = encodeURIComponent(file.name);
  const response = await fetch(`/api/collections/${collection}/images?name=${name}`, {
    method: 'POST',
    headers: {'Content-Type': 'application/octet-stream'},
    body: file,
  });
  if (!response.ok) {
    throw new Error(`Uploading an image failed with ${response.status}`);
  }
  return await response.json() as UploadedImage;
}
