class TileData {


}

class Tileset {
  urlFor(x: number, y: number, z: number): string {
    return `https://tile.thunderforest.com/landscape/${z}/${x}/${y}.png?apikey=d72e980f5f1849fbb9fb3a113a119a6f`;
  }
}
