# Python scripts that do things

## svgs_to_atlas.py

Generates an SVG atlas composed of the images in the given definition. Also spits out a TypeScript
struct to make client-side usage easy.

```
python svgs_to_atlas.py \
    -r 4 \
    ../java/org/trailcatalog/static/images/atlases/points/def.json \
    ../java/org/trailcatalog/static/images/atlases/points.png
```

## trim_emojibase.py

Trims emojibase-data's English emoji list to the glyph, label, and tags of each emoji that Noto
Emoji draws as a single glyph, grouped by category. The icon picker loads the result from
`/static/emoji.json`.

```
curl -sL https://registry.npmjs.org/emojibase-data/-/emojibase-data-17.0.0.tgz | tar xz
curl -sLo NotoEmoji.ttf 'https://github.com/google/fonts/raw/main/ofl/notoemoji/NotoEmoji%5Bwght%5D.ttf'
nix-shell -p 'python3.withPackages(p: [p.uharfbuzz])' --run \
    'python3 trim_emojibase.py package/en NotoEmoji.ttf ../third_party/emojibase/emoji.json'
```
