import { Camera } from './camera';
import { RenderPlanner } from './render_planner';
import { Renderer } from './renderer';
import { HashMap, HashSet, Vec2 } from './support';

interface TileId {
  x: number;
  y: number;
  z: number;
}

export class TileData {

  private readonly inFlight: HashSet<TileId>;
  private readonly pool: TexturePool;
  private readonly tiles: HashMap<TileId, WebGLTexture>;
  private readonly tileset: Tileset;

  constructor(
      private readonly camera: Camera,
      private readonly renderer: Renderer) {
    this.inFlight = new HashSet(id => `${id.x},${id.y},${id.z}`);
    this.pool = new TexturePool(renderer);
    this.tiles = new HashMap(id => `${id.x},${id.y},${id.z}`);
    this.tileset = new Landscape();
  }

  plan(viewportSize: Vec2, planner: RenderPlanner): void {
    const tz = Math.floor(this.camera.zoom + 1);
    const halfWorldSize = Math.pow(2, tz - 1);
    const size = 256 * Math.pow(2, this.camera.zoom - tz);

    const center = this.camera.centerPixel;
    const tileCenter: Vec2 = [
        (Math.floor(center[0] * halfWorldSize) + 0.5) / halfWorldSize,
        (Math.floor(center[1] * halfWorldSize) + 0.5) / halfWorldSize,
    ];
    const tileCoordinate = [
        Math.floor((center[0] + 1) * halfWorldSize),
        Math.floor((1 - center[1]) * halfWorldSize),
    ];

    const id = {
      x: tileCoordinate[0],
      y: tileCoordinate[1],
      z: tz,
    };

    const tile = this.tiles.get(id);
    if (tile) {
      planner.addBillboard(tileCenter, [size, size], tile);
    } else if (this.inFlight.has(id)) {
      // pass
    } else {
      this.inFlight.add(id);

      fetch(this.tileset.urlFor(id))
          .then(response => {
            if (response.ok) {
              return response.blob();
            } else {
              throw new Error(`Failed to download tile ${id.x},${id.y} at ${id.z}`);
            }
          })
          .then(blob => createImageBitmap(blob))
          .then(bitmap => {
            const texture = this.pool.acquire();
            this.renderer.uploadTexture(bitmap, texture);
            this.tiles.set(id, texture);
          })
          .finally(() => {
            this.inFlight.delete(id);
          });
    }
  }
}

class TexturePool {
  private readonly free: WebGLTexture[];

  constructor(private readonly renderer: Renderer) {
    this.free = [];
  }

  acquire(): WebGLTexture {
    return this.free.pop() ?? this.renderer.createTexture();
  }

  release(texture: WebGLTexture): void {
    this.free.push(texture);
  }
}

interface Tileset {
  urlFor(id: TileId): string;
}

class Landscape implements Tileset {
  urlFor(id: TileId): string {
    return `https://tile.thunderforest.com/landscape/${id.z}/${id.x}/${id.y}.png?` +
        `apikey=d72e980f5f1849fbb9fb3a113a119a6f`;
  }
}
