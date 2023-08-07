import defaultTheme from 'tailwindcss/defaultTheme';

export default {
  extend: {
    colors: {
      'tc-black': {
        800: '#000003',
      },
      'white-opaque': {
        160: '#ffffffa0',
        250: '#fffffffa',
      },
    },
    fontFamily: {
      'sans': ['"Source Sans 3"', ...defaultTheme.fontFamily.sans],
    },
    animation: {
      slide: 'slide 1.75s ease-in-out infinite',
    },
    keyframes: {
      slide: {
        '0%': {left: '-33%'},
        '100%': {left: '100%'},
      },
    },
  },
};

