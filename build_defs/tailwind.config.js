const defaultTheme = require('tailwindcss/defaultTheme')

module.exports = {
  content: [
    `bazel-out/k8-fastbuild/bin/{java,js}/**/*.{js,ts,jsx,tsx}`,
    `{java,js}/**/*.{js,ts,jsx,tsx}`,
  ],
  theme: {
    extend: {
      colors: {
        'highlight': '#ffe600',
        'tc-gray': {
          200: '#2c2c2c',
          300: '#3a3a3a',
          400: '#737a80',
          600: '#e2e2e2',
          700: '#f3f3f3',
        },
        'white-translucent': '#ffffffa0',
      },
      fontFamily: {
        'header': ['Barlow', ...defaultTheme.fontFamily.sans],
        'sans': ['Roboto', ...defaultTheme.fontFamily.sans],
      },
    },
  },
  plugins: [],
};
