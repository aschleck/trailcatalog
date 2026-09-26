from argparse import ArgumentParser
import json
from pathlib import Path

import uharfbuzz as hb

# The glyph on each group's tab, keyed by emojibase's group key
TAB_ICONS = {
    'smileys-emotion': '😀',
    'people-body': '👋',
    'animals-nature': '🐾',
    'food-drink': '🍎',
    'travel-places': '🚗',
    'activities': '⚽',
    'objects': '💡',
    'symbols': '🔣',
    'flags': '🏁',
}


def main():
    parser = ArgumentParser()
    parser.add_argument('emojibase', metavar='E', type=str, help='emojibase-data/en directory')
    parser.add_argument('font', metavar='F', type=str, help='Noto Emoji TTF')
    parser.add_argument('out', metavar='O', type=str)
    args = parser.parse_args()

    root = Path(args.emojibase)
    with open(root / 'data.json') as f:
        data = json.load(f)
    with open(root / 'messages.json') as f:
        messages = json.load(f)

    font = hb.Font(hb.Face(hb.Blob.from_file_path(args.font)))

    # Components are skin tone and hair swatches rather than things to pick
    names = {g['order']: g['message'] for g in messages['groups'] if g['key'] != 'component'}
    icons = {g['order']: TAB_ICONS[g['key']] for g in messages['groups'] if g['key'] in TAB_ICONS}
    groups = {order: [] for order in sorted(names)}
    dropped = []
    for e in sorted(data, key=lambda e: e.get('order', 0)):
        if e.get('group') not in groups:
            continue
        # We draw every icon in Noto Emoji, which needs no presentation selector, and the icons
        # in icon_picker.tsx#OUTDOORS have none, so picking one from either place matches.
        emoji = e['emoji'].replace('\ufe0f', '')
        if not draws_as_one_glyph(font, emoji):
            dropped.append(emoji)
            continue
        groups[e['group']].append([emoji, e['label'], ' '.join(e.get('tags', []))])

    # group,tab icon,[emoji,label,tags]
    out = [[names[order].capitalize(), icons[order], emoji] for order, emoji in groups.items()]
    with open(args.out, 'w') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    print(f'Dropped {len(dropped)} that Noto Emoji lacks: {"".join(dropped)}')


def draws_as_one_glyph(font, text):
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(font, buf)
    # Default ignorables like the zero width joiner shape to empty glyphs with no advance
    inked = [p for p in buf.glyph_positions if p.x_advance != 0]
    return len(inked) == 1 and all(i.codepoint != 0 for i in buf.glyph_infos)


if __name__ == '__main__':
    main()
