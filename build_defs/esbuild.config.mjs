import postCssPlugin from './index.js';
import * as postCssConfig from './postcss.config.mjs';

export default {
  jsxFactory: 'corgi.createVirtualElement',
  jsxFragment: 'corgi.Fragment',
  // tsc transpiles TS to JS, so we end up with *both* sets of files. This forces esbuild to only
  // look at JS instead of bundling MapController twice.
  resolveExtensions: ['.jsx', '.js', '.css', '.json'],
  plugins: [
    postCssPlugin(postCssConfig),
  ],
};
