# Notes on stuff

## Pulling Copernicus

Generate the URLs.

```
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
java -jar ~/generate_contours_deploy.jar \
    /mnt/horse/copernicus /mnt/horse/contours/

for z in 9 10 11 12 13 14; do
    java -jar ~/tile_contours_deploy.jar \
        /mnt/horse/contours/ \
        /mnt/horse/tiles/contours/ \
        $z
done
```