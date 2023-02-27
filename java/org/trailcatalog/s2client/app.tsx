import { checkExhaustive, checkExists } from 'js/common/asserts';
import * as corgi from 'js/corgi';

import './app.css';

export function App() {
  return <>
    Hello
  </>;
}

corgi.appendElement(checkExists(document.getElementById('root')), <App />);
