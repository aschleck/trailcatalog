import { checkExhaustive, checkExists } from 'js/common/asserts';
import * as corgi from 'js/corgi';

import './app.css';

export function App() {
  return <span>Hello</span>;
}

corgi.appendElement(checkExists(document.getElementById('root')), <App />);
