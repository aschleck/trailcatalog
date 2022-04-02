import * as corgi from 'js/corgi';

import { checkExists } from './common/asserts';

import { OverviewElement } from './overview_element';

import './app.css';

// TODO: assert little endian

//new Controller(document.getElementById('canvas') as HTMLCanvasElement);

function App() {
  return <OverviewElement />;
}

corgi.appendElement(checkExists(document.getElementById('root')), <App />);
