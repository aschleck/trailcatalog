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
