## About
Crunchitize is a tool to assist in making Crunch compressed DXT textures. It currently converts PNG images, and by default makes them pre-multiplied to be friendly to pixi.js. If it finds a .json file with the same name as a converted .png, it also modifies that json file's `meta.image` property to point at the new texture file instead of the (assumed) png.
Crunchitize currently does not modify image sizes, so your input images *must* be valid Power of Two images.
## Usage:
    -f, --files  Glob path or path to .txt file list of glob paths to .pngs to process.
    -q, --quality  Quality of crunch output, 0-1. Default is 0.5.
    -pm, --premultiplied  If the input pngs should be converted to premultiplied alpha images first. Default is true.
    --format  'crn' for .crn, or 'dds' for .dds. Default is 'crn'.
    -d, --deleteInput  If the input pngs should be deleted after being converted. Default is false.
### Convert a single file
```
crunchitize -f path/to/my.png
```
### Convert all .pngs in a folder, at max quality
```
crunchitize -f path/to/folder/ -q 1
```
### Convert all .pngs in a folder to dds
```
crunchitize -f path/to/folder/ --format dds
```
### Convert all listed images at varying qualities
list.txt:
```
path/to/my.png 0.8
path/to/other.png 0.3
```
shell:
```
crunchitize -f path/to/list.txt
```

Executables for the crunch compression itself are taken from https://github.com/BKcore/crunch-osx.