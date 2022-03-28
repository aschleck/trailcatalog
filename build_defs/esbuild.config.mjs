import postCssPlugin from '@deanc/esbuild-plugin-postcss';

import * as postCssConfig from './postcss.config.mjs';

export default {
  jsxFactory: "corgi.createElement",
  jsxFragment: "corgi.Fragment",
  plugins: [
    postCssPlugin(postCssConfig),
  ],
};
