import * as earcut from 'earcut';
import * as opentype from 'opentype.js';

import { checkExhaustive } from './models/asserts';
import { Vec2 } from './models/types';

import { RenderPlanner } from './render_planner';

const NOTO_SANS = 'https://fonts.gstatic.com/ea/notosansjp/v5/NotoSansJP-Regular.woff';
//const ROBOTO = 'https://cdnjs.buttflare.com/ajax/libs/ink/3.1.10/fonts/Roboto/roboto-regular-webfont.woff';
const ROBOTO = 'https://fonts.gstatic.com/s/roboto/v29/KFOmCnqEu92Fr1Me5g.woff';

export class TextRenderer {

  private font: opentype.Font|undefined;

  constructor() {
    opentype.load(NOTO_SANS).then(font => {
      if (!font.supported) {
        throw new Error('Font is unsupported by OpenType');
      }

      if (font.outlinesFormat !== 'truetype') {
        throw new Error('Unsupported type of outlines');
      }

      this.font = font;
    });
  }

  plan(planner: RenderPlanner): void {
    if (!this.font) {
      return;
    }

    //const path = this.font.getPath('こんにちは', 0, 0, 128);
    const path = this.font.getPath('こんにちは hello!', 0, 0, 128);
    const polygons = [];
    let polygon: Vec2[] = [];
    let winding = 0;
    for (const command of path.commands) {
      if (command.type === 'M') {
        polygon = [[command.x, command.y]];
      } else if (command.type === 'L') {
        polygon.push([command.x, command.y]);
      } else if (command.type === 'C') {
        // cubic curve
        const origin = polygon[polygon.length - 1];
        const c1: Vec2 = [command.x1, command.y1];
        const c2: Vec2 = [command.x2, command.y2];
        const destination: Vec2 = [command.x, command.y];
        for (let i = 1; i <= 16; ++i) {
          const t = i / 16;
          const a = lerp(lerp(origin, c1, t), lerp(c1, c2, t), t);
          const b = lerp(lerp(c1, c2, t), lerp(c2, destination, t), t);
          polygon.push(lerp(a, b, t));
        }
      } else if (command.type === 'Q') {
        // quadratic curve
        const origin = polygon[polygon.length - 1];
        const control: Vec2 = [command.x1, command.y1];
        const destination: Vec2 = [command.x, command.y];
        for (let i = 1; i <= 16; ++i) {
          const t = i / 16;
          polygon.push(lerp(lerp(origin, control, t), lerp(control, destination, t), t));
        }
      } else if (command.type === 'Z') {
        polygons.push(polygon);
      } else {
        checkExhaustive(command, 'Unknown type of command');
      }
    }

    const flattened = polygons.map(p => p.flatMap(v => v));
    const vertices = flattened.flatMap(p => p);
    const indices = [];
    let offset = 0;
    for (const polygon of flattened) {
      const holes: number[] = [];
      for (let i = 0; i < polygon.length; i += 2) {
        const y = polygon[i + 1] + 1e-6;

        let winding = 0;
        for (let j = 0; j < polygon.length - 2; j += 2) {
          if (polygon[j + 1] < y && y < polygon[j + 3]) {
            winding += 1;
          } else if (polygon[j + 1] > y && y > polygon[j + 3]) {
            winding -= 1;
          }
        }

        if (winding !== 0) {
          holes.push(i);
        }
      }

      const triangles = earcut(polygon, holes);
      for (const i of triangles) {
        indices.push(i + offset);
      }
      offset += polygon.length / 2;
    }

    planner.addScreenSpaceTriangles({
      indices,
      vertices,
    });
  }
}

function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
    return [(1 - t) * a[0] + t * b[0], (1 - t) * a[1] + t * b[1]];
}

