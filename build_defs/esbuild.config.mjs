import postCssPlugin from '../third_party/deanc-esbuild-plugin-postcss/index.js';

import * as postCssConfig from './postcss.config.mjs';

export default {
  jsxFactory: 'corgi.createVirtualElement',
  jsxFragment: 'corgi.Fragment',
  plugins: [
    postCssPlugin(postCssConfig),
  ],
};
