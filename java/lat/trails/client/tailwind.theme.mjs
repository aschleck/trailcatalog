import defaultTheme from 'tailwindcss/defaultTheme';

export default {
  extend: {
    colors: {
      'tc-black': {
        800: '#000003',
      },
      'white-opaque': {
        160: '#ffffffa0',
      },
    },
    fontFamily: {
      'sans': ['"Source Sans 3"', ...defaultTheme.fontFamily.sans],
    },
  },
};

