from argparse import ArgumentParser
import io
import json
from pathlib import Path
import subprocess
import tempfile

import svgutils.transform as sg
from reportlab.graphics import renderSVG
from reportlab.graphics.shapes import Drawing


def main():
    parser = ArgumentParser(add_help=False)
    parser.add_argument('-c', '--cols', default=8, type=int)
    parser.add_argument('-r', '--rows', default=8, type=int)
    parser.add_argument('-h', '--height', default=32, type=int)
    parser.add_argument('-w', '--width', default=32, type=int)
    parser.add_argument('defs', metavar='D', type=str)
    parser.add_argument('out', metavar='O', type=str)
    args = parser.parse_args()

    defs_path = Path(args.defs)
    with open(defs_path, 'r') as f:
        defs = json.load(f)

    textures = []
    commented = []
    keys = []
    for d in defs["images"]:
        textures.append(Path(defs_path.parent, d["file"]))
        commented.append("key" not in d)
        keys.append(d.get("key", d["file"]))

    if args.cols * args.height < len(textures):
        raise Exception('Atlas is too small')

    atlas = sg.SVGFigure()
    print(f'const ATLAS = new Map<{defs["key_type"]}, number>([')
    for i in range(len(textures)):
        name = textures[i]
        x = i % args.cols
        y = i // args.cols
        if commented[i]:
            print(f'  // [{keys[i]}, {i}], // {name.name}')
        else:
            print(f'  [{keys[i]}, {i}], // {name.name}')

        element = sg.fromfile(name)
        root = element.getroot()
        root.scale(args.width / int(element.width), args.height / int(element.height))
        root.moveto(x * args.width, y * args.height)
        atlas.append([root])
    print(']);')

    with tempfile.NamedTemporaryFile(suffix='.svg') as f:
        size = (args.cols * args.width, args.rows * args.height)
        atlas.set_size([f'{u}px' for u in size])
        atlas.save(f.name)

        command = ['inkscape', '-w', str(size[0]), '-h', str(size[1]), f.name, '-o', args.out]
        print(' '.join(command))
        subprocess.run(command)


if __name__ == '__main__':
    main()

