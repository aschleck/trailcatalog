import * as fs from 'fs';
import * as path from 'path';

const bazelResolve = {
  name: 'bazel',
  setup: function (build) {
    build.onResolve({ filter: /^java/ }, args => {
      console.error(args.resolveDir);

      const root = path.join(args.resolveDir.slice(0, args.resolveDir.lastIndexOf('/bin/')), 'bin');
      const suffixless = path.join(root, args.path);
      console.error(root);
      let candidate = undefined;
      fs.readdirSync(root + "/java/org/trailcatalog/s2").forEach(file => {
        console.error(file);
      });

      return undefined;
      return {
        path: path.join("/home/april/work/trailcatalog", args.path + ".js"),
      };
    });
  },
};

export default {
  plugins: [bazelResolve],
}