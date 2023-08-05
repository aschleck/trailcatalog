# Notes on stuff

## Pulling DEMs

### Copernicus

Generate the URLs.

```
nix-shell -p parallel python3

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

`cat urls.txt | parallel -j16 wget`

### NASADEM
```
# Tiles specifically around Armenia and Azerbaijan
for lat in range(38, 43):
    for lng in range(42, 52):
        y = f's{-lat:02}' if lat < 0 else f'n{lat:02}'
        x = f'w{-lng:03}' if lng < 0 else f'e{lng:03}'
        print(
            'https://e4ftl01.cr.usgs.gov//DP132/MEASURES/'
            f'NASADEM_HGT.001/2000.02.11/NASADEM_HGT_{y}{x}.zip'
        )
        print('-O')
        print(f'{y}{x}.hgt.zip')
```

1. Sign up for Earthdata: https://urs.earthdata.nasa.gov/users/new
2. Login and activate account
3. `cat urls.txt | parallel -N 3 -j16 wget --user '<username>' --password '<password>'`

### Merging them

1. `for i in nasadem/*.zip; do gdal_translate -ot Float32 $i $i.tif; done`
1. `gdalbuildvrt copernicus/copernicus.vrt copernicus/Copernicus_DSM_COG_10_* nasadem/*.zip.tif -resolution highest`

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

## Making a public access dataset layer

* Download "National GeoPackage" from
  https://www.usgs.gov/programs/gap-analysis-project/science/pad-us-data-download
