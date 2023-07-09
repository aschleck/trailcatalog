# Notes on stuff

## Pulling Copernicus

Generate the URLs.

```
nix-shell -p parallel

for lat in range(-90, 90):
    for lng in range(-180, 180):
        y = f'S{-lat:02}' if lat < 0 else f'N{lat:02}'
        x = f'W{-lng:03}' if lng < 0 else f'E{lng:03}'
        print(
            'https://copernicus-dem-30m.s3.amazonaws.com/'
            f'Copernicus_DSM_COG_10_{y}_00_{x}_00_DEM/'
            f'Copernicus_DSM_COG_10_{y}_00_{x}_00_DEM.tif'
        )
```

Download them with `cat urls.txt | parallel -j16 wget`.

## Generating contours

```
nix-shell -p gdal openjdk17

curl \
    'https://overpass-api.de/api/interpreter?data=%5Bout%3Ajson%5D%3B%0A%28%0A%20%20node%5B%22natural%22%3D%22glacier%22%5D%28-89.1115678750941%2C-180%2C89.41464013250905%2C180%29%3B%0A%20%20way%5B%22natural%22%3D%22glacier%22%5D%28-89.1115678750941%2C-180%2C89.41464013250905%2C180%29%3B%0A%20%20relation%5B%22natural%22%3D%22glacier%22%5D%28-89.1115678750941%2C-180%2C89.41464013250905%2C180%29%3B%0A%29%3B%0Aout%20geom%3B' \
     -o /mnt/horse/glaciers.json
# Manually hack in way 229914265...

gdalbuildvrt /mnt/horse/copernicus/copernicus.vrt /mnt/horse/copernicus/*.tif

java -jar ~/tile_contours_deploy.jar \
    /mnt/horse/copernicus/ \
    /mnt/horse/tiles/contours/
```

## Making DEM tiles

<!-- doesn't work -->

```
nix-shell -p mbutil python310Packages.rasterio

rio rgbify \
    copernicus.vrt \
    copernicus.mbtiles \
    --co LOSSLESS=true \
    --format webp \
    --max-z 13 \
    --min-z 13

mb-util copernicus.mbtiles tiles/dem --image_format=webp
```

## Making hillshade tiles

```
nix-shell -p gdal imagemagick

gdalbuildvrt /mnt/horse/copernicus/copernicus.vrt /mnt/horse/copernicus/*.tif

java -jar ~/hillshader_deploy.jar \
    /mnt/horse/copernicus/ \
    /mnt/horse/tiles/hillshades/
```
