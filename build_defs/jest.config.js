require('process');

module.exports = {
  haste: {
    enableSymlinks: true,
  },
  moduleDirectories: [
    process.cwd(),
    "node_modules",
  ],
  testEnvironment: "jsdom",
};
