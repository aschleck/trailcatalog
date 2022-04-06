const defaultTheme = require('tailwindcss/defaultTheme')

module.exports = {
  content: [
    `bazel-out/k8-fastbuild/bin/{java,js}/**/*.{js,ts,jsx,tsx}`,
    `{java,js}/**/*.{js,ts,jsx,tsx}`,
  ],
  theme: {
    extend: {
      colors: {
        'white-translucent': '#ffffffa0',
      },
      fontFamily: {
        'sans': ['Barlow', ...defaultTheme.fontFamily.sans],
      },
    },
  },
  plugins: [],
};
