const defaultTheme = require('tailwindcss/defaultTheme')

module.exports = {
  content: [
    `bazel-out/k8-fastbuild/bin/{java,js}/**/*.{js,ts,jsx,tsx}`,
    `{java,js}/**/*.{js,ts,jsx,tsx}`,
  ],
  theme: {
    extend: {
      colors: {
        'tc': {
          200: '#2c2c2c',
          300: '#3a3a3a',
          500: '#737a80',
          700: '#f3f3f3',
        },
        'white-translucent': '#ffffffa0',
      },
      fontFamily: {
        'sans': ['Barlow', ...defaultTheme.fontFamily.sans],
      },
    },
  },
  plugins: [],
};
