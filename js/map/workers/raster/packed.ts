// Each pixel's 24 RGB bits hold the channels packed from the high bits down as
// round((value - offset) / scale), and a channel's largest code means no data.
export interface Channel {
  name: string;
  bits: number;
  scale: number;
  offset: number;
}

/** Channel values by name, NaN where a channel has no data. */
export type Values = Record<string, number>;

/** Unpacks every channel of a pixel's 24 packed bits into values. */
export function unpackPixel(channels: Channel[], packed: number, values: Values = {}): Values {
  let shift = 24;
  for (const channel of channels) {
    shift -= channel.bits;
    const noData = (1 << channel.bits) - 1;
    const code = (packed >>> shift) & noData;
    values[channel.name] = code === noData ? NaN : channel.offset + channel.scale * code;
  }
  return values;
}

/** Unpacks one channel of each of a tile's packed pixels, with NaN where there's no data. */
export function unpackChannel(
    channels: Channel[], name: string, rgba: Uint8ClampedArray): Float32Array {
  let shift = 24;
  let channel;
  for (channel of channels) {
    shift -= channel.bits;
    if (channel.name === name) {
      break;
    }
  }
  if (channel?.name !== name) {
    throw new Error(`No channel ${name}`);
  }
  const noData = (1 << channel.bits) - 1;
  const values = new Float32Array(rgba.length / 4);
  for (let i = 0; i < values.length; ++i) {
    const packed = (rgba[4 * i] << 16) | (rgba[4 * i + 1] << 8) | rgba[4 * i + 2];
    const code = (packed >>> shift) & noData;
    values[i] = code === noData ? NaN : channel.offset + channel.scale * code;
  }
  return values;
}

// Decodes without color management or alpha premultiplication, because either would change the
// pixel values and corrupt the data.
export async function readPacked(blob: Blob): Promise<ImageData> {
  const packed =
      await createImageBitmap(blob, {colorSpaceConversion: 'none', premultiplyAlpha: 'none'});
  const canvas = new OffscreenCanvas(packed.width, packed.height);
  const context = canvas.getContext('2d', {willReadFrequently: true})!;
  context.drawImage(packed, 0, 0);
  packed.close();
  return context.getImageData(0, 0, canvas.width, canvas.height);
}
