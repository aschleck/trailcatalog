const fs = require("fs/promises");
const postcss = require("postcss");
const util = require("util");
const path = require("path");

module.exports = (options = { plugins: [] }) => ({
  name: "postcss",
  setup: function (build) {
    build.onResolve(
      { filter: /.\.(css)$/, namespace: "file" },
      async (args) => {
        const sourceExt = path.extname(args.path);
        const sourceBaseName = path.basename(args.path, sourceExt);
        const sourceDir = path.dirname(args.path);
        const sourceFullPath = path.resolve(args.resolveDir, args.path);
        const tmpDir = path.resolve(process.cwd(), sourceDir);
        const tmpFilePath = path.resolve(tmpDir, `${sourceBaseName}.css`);

        const css = await fs.readFile(sourceFullPath);

        const result = await postcss(options.plugins).process(css, {
          from: sourceFullPath,
          to: tmpFilePath,
        });

        // Write result file
        await fs.writeFile(tmpFilePath, result.css);

        return {
          path: tmpFilePath,
        };
      }
    );
  },
});
