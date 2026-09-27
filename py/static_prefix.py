from argparse import ArgumentParser
import hashlib

# Keep in sync with the hashed /static/ locations in the nginx configs
HASH_LENGTH = 12


def main():
    parser = ArgumentParser()
    parser.add_argument('out', metavar='O', type=str, help='TypeScript file to write')
    parser.add_argument('root', metavar='R', type=str, help='URL the static files are served under')
    parser.add_argument('files', metavar='F', type=str, nargs='+')
    args = parser.parse_args()

    digest = hashlib.sha256()
    for path in args.files:
        with open(path, 'rb') as f:
            digest.update(f.read())

    prefix = f'{args.root}/{digest.hexdigest()[:HASH_LENGTH]}'
    with open(args.out, 'w') as f:
        f.write(f"export const STATIC_PREFIX = '{prefix}';\n")


if __name__ == '__main__':
    main()
