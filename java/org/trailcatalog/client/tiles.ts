import { Camera } from './camera';
import { RenderPlanner } from './render_planner';
import { Renderer } from './renderer';
import { HashMap, HashSet, Vec2 } from './support';

interface TileId {
  x: number;
  y: number;
  z: number;
}

const TILE_SIZE_PX = 256;

export class TileData {

  private readonly inFlight: HashSet<TileId>;
  private readonly pool: TexturePool;
  // Some tilesets return 404 for ocean tile, so track those as undefined
  private readonly tiles: HashMap<TileId, WebGLTexture|undefined>;
  private readonly tileset: Tileset;

  constructor(
      private readonly camera: Camera,
      private readonly renderer: Renderer) {
    this.inFlight = new HashSet(id => `${id.x},${id.y},${id.z}`);
    this.pool = new TexturePool(renderer);
    this.tiles = new HashMap(id => `${id.x},${id.y},${id.z}`);
    this.tileset = new Landscape();
  }

  private fetchAndCull(viewportSize: Vec2): void {
    // World coordinates in this function are in tile pixels, not in screen pixels

    const extraZoom = 0;
    const tz = Math.floor(this.camera.zoom + extraZoom);
    const halfWorldSize = Math.pow(2, tz - 1); // - 1 gives us the half
    const center = this.camera.centerPixel;
    const centerInWorldPx = [center[0] * halfWorldSize, center[1] * halfWorldSize];
    const halfSize = TILE_SIZE_PX * Math.pow(2, this.camera.zoom - tz + 1);
    const halfViewportInWorldPx = [
      viewportSize[0] / halfSize,
      viewportSize[1] / halfSize,
    ];

    // We need to add 1 to y tiles because our coordinate system is flipped from the typical
    // coordinates.
    for (let y = Math.floor(centerInWorldPx[1] - halfViewportInWorldPx[1]) + 1;
         y < centerInWorldPx[1] + halfViewportInWorldPx[1] + 1;
         ++y) {
       for (let x = Math.floor(centerInWorldPx[0] - halfViewportInWorldPx[0]);
            x < centerInWorldPx[0] + halfViewportInWorldPx[0];
            ++x) {
          const id = {
            x,
            y,
            z: tz,
          };
          if (this.tiles.has(id) || this.inFlight.has(id)) {
            continue;
          }

          this.inFlight.add(id);
          // We use coordinates from -1 to 1 but servers use 0 to 1.
          const urlId = {
            x: x + halfWorldSize,
            y: halfWorldSize - y,
            z: tz,
          };
          fetch(this.tileset.urlFor(urlId))
              .then(response => {
                if (response.ok) {
                  return response.blob()
                      .then(blob => createImageBitmap(blob))
                      .then(bitmap => {
                        const texture = this.pool.acquire();
                        this.renderer.uploadTexture(bitmap, texture);
                        this.tiles.set(id, texture);
                      });
                } else if (response.status === 404) {
                  this.tiles.set(id, undefined);
                } else {
                  throw new Error(`Failed to download tile ${id.x},${id.y} at ${id.z}`);
                }
              })
              .catch(e => {
                console.error(e);
              })
              .finally(() => {
                this.inFlight.delete(id);
              });
      }
    }
  }

  plan(viewportSize: Vec2, planner: RenderPlanner): void {
    this.fetchAndCull(viewportSize);

    for (const [id, texture] of this.tiles) {
      if (!texture) {
        continue;
      }

      const halfWorldSize = Math.pow(2, id.z - 1);
      const size = TILE_SIZE_PX * Math.pow(2, this.camera.zoom - id.z);
      planner.addBillboard([
          (id.x + 0.5) / halfWorldSize,
          (id.y - 0.5) / halfWorldSize,
      ], [size, size], texture);
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
