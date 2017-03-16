## Usage:
    -f, --files  Glob path or path to .txt file list of glob paths to .pngs to process.
    -q, --quality  Quality of crunch output, 0-1. Default is 0.5.
    -pm, --premultiplied  If the input pngs should be converted to premultiplied alpha images first. Default is true.
### Convert a single file
```
crunchitize -f path/to/my.png
```
### Convert all .pngs in a folder, at max quality
```
crunchitize -f path/to/folder/ -q 1
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