import * as corgi from 'js/corgi';
import { MapElement } from './map/map_element';

import { checkExists } from './common/asserts';

import './app.css';

// TODO: assert little endian

//new Controller(document.getElementById('canvas') as HTMLCanvasElement);

corgi.appendElement(checkExists(document.getElementById('root')), MapElement());
