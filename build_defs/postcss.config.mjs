import autoprefixer from 'autoprefixer';
import path from 'path';
import tailwindcss from 'tailwindcss';
import {fileURLToPath} from 'url';

const directory = path.dirname(fileURLToPath(import.meta.url));
export const plugins = [
  tailwindcss(path.join(directory, 'tailwind.config.mjs')),
  autoprefixer,
];
