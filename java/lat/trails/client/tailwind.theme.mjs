import defaultTheme from 'tailwindcss/defaultTheme';

export default {
  extend: {
    colors: {
      'gray': {
        900: '#212121',
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

