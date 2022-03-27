import { Controller } from './map/controller';

import './app.css';

// TODO: assert little endian

new Controller(document.getElementById('canvas') as HTMLCanvasElement);
