## About
Crunchitize is a tool to assist in making Crunch compressed DXT textures. It currently converts PNG images, and by default makes them pre-multiplied to be friendly to pixi.js. If it finds a .json file with the same name as a converted .png, it also modifies that json file's `meta.image` property to point at the new texture file instead of the (assumed) png. Crunchitize can resize your images for you, but the output texture must have dimensions that are each a multiple of 4.
## Usage:
    -f, --files  Glob path or path to .txt file list of glob paths to .pngs to process.
    -q, --quality  Quality of crunch output, 0-1. Default is 0.5.
    -pm, --premultiplied  If the input pngs should be converted to premultiplied alpha images first. Default is true.
    --format  'crn' for .crn, or 'dds' for .dds. Default is 'crn'.
    -d, --deleteInput  If the input pngs should be deleted after being converted. Default is false.
    -r, --resize  How to resize input images to be multiple of 4 dimensions. Options are 'scale' to scale up, 'border' to add transparency to the right and bottom. The default is to not resize, and skip invalid images.
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
path/to/other.png 0.3 scale
path/to/another.png border
```
shell:
```
crunchitize -f path/to/list.txt
```

Executables for the crunch compression itself are taken from https://github.com/BKcore/crunch-osx.
