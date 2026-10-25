from argparse import ArgumentParser
import hashlib
import os

# Keep in sync with the hashed /static/ locations in the nginx configs
HASH_LENGTH = 12


def main():
    parser = ArgumentParser()
    parser.add_argument('out', metavar='O', type=str, help='TypeScript file to write')
    parser.add_argument('root', metavar='R', type=str, help='URL the static files are served under')
    parser.add_argument('files', metavar='F', type=str, nargs='+')
    args = parser.parse_args()

    digest = hashlib.sha256()
    for path in expand_directories(args.files):
        with open(path, 'rb') as f:
            digest.update(f.read())

    prefix = f'{args.root}/{digest.hexdigest()[:HASH_LENGTH]}'
    with open(args.out, 'w') as f:
        f.write(f"export const STATIC_PREFIX = '{prefix}';\n")


def expand_directories(paths):
    for path in paths:
        if os.path.isdir(path):
            for root, dirs, files in os.walk(path):
                # os.walk lists in filesystem order, which would make the hash vary by machine.
                dirs.sort()
                for name in sorted(files):
                    yield os.path.join(root, name)
        else:
            yield path


if __name__ == '__main__':
    main()
