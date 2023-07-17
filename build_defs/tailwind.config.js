const defaultTheme = require('tailwindcss/defaultTheme')

module.exports = {
  content: [
    `bazel-out/*-fastbuild/bin/{java,js}/**/*.{js,ts,jsx,tsx}`,
    `{java,js}/**/*.{js,ts,jsx,tsx}`,
  ],
  theme: {
    extend: {
      colors: {
        'black-opaque': {
          20: '#00000014',
        },
        'tc-error': {
          900: '#ac0000',
          500: '#e93636',
          200: '#ffcccc',
          100: '#ffeeee',
        },
        'tc-highlight': {
          1: '#ffe600',
          2: '#9fe26b',
          3: '#4f8d1f',
        },
        'tc-gray': {
          900: '#222222',
          700: '#363636',
          600: '#3a3a3a',
          400: '#737a80',
          200: '#e2e2e2',
          100: '#f3f3f3',
        },
        'white-opaque': {
          160: '#ffffffa0',
        },
      },
      fontFamily: {
        'header': ['Barlow', ...defaultTheme.fontFamily.sans],
        'input': ['Nunito Sans', ...defaultTheme.fontFamily.sans],
        'sans': ['Roboto', ...defaultTheme.fontFamily.sans],
      },
    },
  },
  plugins: [],
};
