import defaultTheme from 'tailwindcss/defaultTheme';

export default {
  extend: {
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
