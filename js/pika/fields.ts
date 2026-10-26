// 28px tall like the buttons in buttons.tsx, so rows of mixed controls line up. The blue border
// marks focus, so the browser's outline would be a second ring.
export const TEXT_BOX =
    '[&_input]:outline-none bg-white border border-gray-300 focus-within:border-blue-500 h-7 '
        + 'min-w-0 outline-none px-2 rounded';
export const SELECT_BOX = 'bg-white border border-gray-300 h-7 min-w-0 px-1 rounded';
