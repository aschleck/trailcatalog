console.log(`${process.env['RUNFILES_DIR']}/**/*.{html,ts}`);

module.exports = {
  content: [`${process.env['RUNFILES_DIR']}/**/*.{html,ts}`],
  theme: {
    extend: {
      colors: {
        "white-translucent": "#ffffffa0",
      },
    },
  },
  plugins: [],
};
