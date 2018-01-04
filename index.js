"use strict";

const fs = require('fs');
const path = require('path');
const glob = require('glob');
const PNG = require('pngjs').PNG;
const execFile = require('child_process').execFile;

function localPath(input)
{
    return path.relative(process.cwd(), input);
}

class Crunchitize {
    static cli()
    {
        const minimist = require('minimist');
        const args = minimist(process.argv.slice(2), {
            string: ['files', 'format', 'resize'],
            boolean: ['premultiplied', 'deleteInput'],
            alias: {
                f: 'files',
                q: 'quality',
                pm: 'premultiplied',
                d: 'deleteInput',
                r: 'resize',
                h: 'help'
            },
            default: {
                quality: 0.5,
                premultiplied: true,
                format: 'crn',
                deleteInput: false,
                resize: null
            }
        });
        
        if (args.hasOwnProperty('help') || !args.files)
        {
            const help = `
    crunchitize usage:
        -f, --files  Glob path or path to .txt file list of glob paths to .pngs to process.
        -q, --quality  Quality of crunch output, 0-1. Default is 0.5.
        -pm, --premultiplied  If the input pngs should be converted to premultiplied alpha images first. Default is true.
        --format  'crn' for .crn, or 'dds' for .dds. Default is 'crn'.
        -d, --deleteInput  If the input pngs should be deleted after being converted. Default is false.
        -r, --resize  How to resize input images to be multiple of 4 dimensions. Options are 'scale' to scale up, 'border' to add transparency to the right and bottom. The default is to not resize, and skip invalid images.
`;
            console.log(help);
            return;
        }
        
        const crunch = new Crunchitize();
        crunch.process(args.files, (err) => {
            if (err)
            {
                console.error(err);
                process.exitCode = 1;
            }
            else
            {
                process.exitCode = 0;
            }
        }, {
            quality: args.quality,
            premultiply: args.hasOwnProperty('premultiplied') ? !!args.premultiplied : true,
            format: args.format,
            delete: args.hasOwnProperty('deleteInput') ? args.deleteInput !== false : false,
            resize: args.resize
        });
    }
    
    constructor()
    {
        this.qualityDict = {};
        this.resizeDict = {};
        switch (process.platform)
        {
            case 'win32':
                this.executable = 'ex/crunch.exe';
                break;
            case 'darwin':
                this.executable = 'ex/crunch_osx';
                break;
            case 'linux':
                this.executable = 'ex/crunch_lin';
                break;
            default:
                console.log('Unknown OS - trying linux crunch executable');
                this.executable = 'ex/crunch_lin';
        }
    }
    
    process(targetGlobs, callback, options)
    {
        if (!options)
            options = {};
        const maxParallel = 4;
        const active = [];
        let prom;
        if (typeof targetGlobs === 'string' && path.extname(targetGlobs) === '.txt')
        {
            prom = this.readListFile(targetGlobs).then((list) => {
                return this.getGlobMatches(list);
            });
        }
        else
        {
            prom = this.getGlobMatches(targetGlobs);
        }
        prom = prom.then((matches) => {
            return this.handleImages(matches, options);
        });
        prom.then(() => {
            callback();
        }).catch((err) => {
            callback(err);
        });
    }
    
    readListFile(target)
    {
        return new Promise((resolve, reject) => {
            fs.readFile(path.resolve(target), 'utf8', (err, data) => {
                if (err)
                    return reject(err);
                const lines = data.split(/\r?\n/g);
                const qualityCheck = /.*? ((?:0\.)?\d+)? ?(scale|border)?$/;
                const whitespace = /^\s*$/;
                //see if any lines include a quality value
                for (let i = 0; i < lines.length; ++i)
                {
                    //skip empty lines
                    if (whitespace.test(lines[i])) {
                        lines.splice(i--, 1);
                        continue;
                    }
                    lines[i] = lines[i].trim();
                    let result = qualityCheck.exec(lines[i]);
                    if (result)
                    {
                        //remove quality value from line
                        if (result[1])
                            lines[i] = lines[i].replace(result[1], '').trim();
                        if (result[2])
                            lines[i] = lines[i].replace(result[2], '').trim();
                        //store quality value for that file
                        this.qualityDict[lines[i]] = parseFloat(result[1]);
                        //store resize info
                        this.resizeDict[lines[i]] = result[2];
                    }
                }
                resolve(lines);
            });
        });
    }
    
    getGlobMatches(target)
    {
        //ensure that we have a glob array, so we can do some checking
        if (typeof target === 'string')
        {
            target = [target];
        }
        const origTarget = target.slice();
        for (let i = 0; i < target.length; ++i)
        {
            if (target[i].indexOf('.png') === -1)
            {
                target[i] = path.join(target[i], '**/*.png');
            }
            const targetPath = target[i];
            target[i] = new Promise((resolve, reject) => {
                glob(targetPath, (err, matches) => {
                    if (err) {
                        return reject(err);
                    }
                    resolve(matches);
                });
            });
        }
        return Promise.all(target).then((globList) => {
            const matches = [];
            for (let i = 0; i < globList.length; ++i)
            {
                const list = globList[i];
                const target = origTarget[i];
                for (let j = 0; j < list.length; ++j)
                {
                    const fullPath = list[j];
                    this.qualityDict[fullPath] = this.qualityDict[target];
                    this.resizeDict[fullPath] = this.resizeDict[target];
                    matches.push(fullPath);
                }
            }
            return matches;
        });
    }
    
    handleImages(matches, options)
    {
        let prom = Promise.resolve();
        matches.forEach((match) => {
            prom = prom.then(() => {
                return this.handleImage(match,
                    this.qualityDict[match] || options.quality || 0.5,
                    typeof options.premultiply === 'boolean' ? options.premultiply : true,
                    options.format || 'crn',
                    options.delete,
                    this.resizeDict[match] || options.resize)
            });
        });
        return prom;
    }
    
    handleImage(pngPath, quality, premultiply, format, deleteFile, resize)
    {
        console.log('\nhandling ' + localPath(pngPath));
        pngPath = path.resolve(pngPath);
        const props = path.parse(pngPath);
        props.ext = format === 'dds' ? '.dds' : '.crn';
        const crnPath = path.join(props.dir, props.name + props.ext);
        //target size for 'scale' resize mode
        let targetWidth = 0;
        let targetHeight = 0;
        let tempFile;
        let prom = this.readPNG(pngPath);
        if (!resize)
        {
            prom = prom.then((png) => {
                return this.assertValidSize(png);
            });
        }
        else if (resize === 'border')
        {
            prom = prom.then((png) => {
                return this.addEdge(png);
            });
        }
        else if (resize === 'scale')
        {
            prom = prom.then((png) => {
                let {width, height} = this.getValidSize(png);
                targetWidth = width;
                targetHeight = height;
                return png;
            });
        }
        if (premultiply)
        {
            prom = prom.then((png) => {
                return this.premultiplyPNG(pngPath, png).then((outPath) => {
                    tempFile = outPath;
                    return outPath;
                });
            });
        }
        else
        {
            prom = prom.then(() => {
                return Promise.resolve(pngPath);
            });
        }
        prom = prom.then((srcPath) => {
            return this.crunch(srcPath, crnPath, quality, format === 'dds' ? 'dds' : 'crn', targetWidth, targetHeight);
        }).then(() => {
            if (tempFile)
            {
                console.log('removing temp image ' + localPath(tempFile));
                return this.deleteFile(tempFile);
            }
        }).then(() => {
            const props = path.parse(pngPath);
            props.ext = '.json';
            const jsonPath = path.join(props.dir, props.name + props.ext);
            if (fs.existsSync(jsonPath))
            {
                return this.modifySpritesheet(jsonPath, crnPath);
            }
        }).then(() => {
            if (deleteFile)
            {
                console.log('removing source image ' + localPath(pngPath));
                return this.deleteFile(pngPath);
            }
        }).catch((err) => {
            console.error('failed on ' + localPath(pngPath) + ': ' + err);
        });
        return prom;
    }
    
    readPNG(pngPath)
    {
        return new Promise((resolve, reject) => {
            fs.createReadStream(pngPath)
            .pipe(new PNG())
            .on('parsed', function() {
                resolve(this);
            });
        });
    }
    
    assertValidSize(png)
    {
        return new Promise((resolve, reject) => {
            if (png.width < 64 || png.height < 64)
            {
                return reject('width and height must be at least 64 pixels');
            }
            if (png.width % 4 !== 0)
            {
                return reject('width must be a multiple of 4');
            }
            if (png.height % 4 !== 0)
            {
                return reject('height must be a multiple of 4');
            }
            resolve(png);
        });
    }
    
    getValidSize(png)
    {
        let width = 4 - (png.width % 4);
        if (width === 4) width = 0;
        width += png.width;
        let height = 4 - (png.height % 4);
        if (height === 4) height = 0;
        height += png.height;
        if (width < 64) width = 64;
        if (height < 64) height = 64;
        return {width, height};
    }
    
    addEdge(png)
    {
        return new Promise((resolve, reject) => {
            let {width, height} = this.getValidSize(png);
            const resized = new PNG({
                inputHasAlpha: true,
                bgColor: {
                    red: 0,
                    green: 0,
                    blue: 0
                },
                width,
                height
            });
            png.bitblt(resized, 0, 0, png.width, png.height, 0, 0);
            
            resolve(resized);
        });
    }
    
    premultiplyPNG(pngPath, png)
    {
        return new Promise((resolve, reject) => {
            console.log('converting ' + localPath(pngPath) + ' to premultiplied alpha');
            for (let y = 0; y < png.height; y++) {
                for (let x = 0; x < png.width; x++) {
                    let idx = (png.width * y + x) << 2;
                    let alpha = png.data[idx+3] / 255;
                    // multiply by alpha
                    png.data[idx] = Math.round(png.data[idx] * alpha);
                    png.data[idx+1] = Math.round(png.data[idx+1] * alpha);
                    png.data[idx+2] = Math.round(png.data[idx+2] * alpha);
                }
            }
            
            const props = path.parse(pngPath);
            props.name += '_pma';
            const outPath = path.join(props.dir, props.name + props.ext);
            png.pack().pipe(fs.createWriteStream(outPath)).on('close', () => {
                resolve(outPath);
            });
        });
    }
    
    crunch(pngPath, crnPath, quality, format, width, height)
    {
        return new Promise((resolve, reject) => {
            console.log('crunching ' + localPath(pngPath) + ' to ' + localPath(crnPath) + ' with quality of ' + quality);
            const args = [
                '-file', pngPath,
                '-out', crnPath,
                '-fileformat', format,
                '-DXT5',
                '-quality', Math.max(Math.min(Math.round(quality * 255), 255), 0),
                '-mipMode', 'None',
                '-noprogress',// don't fill up stdout buffer
            ];
            if (width && height)
            {
                args.push('-rescale', width, height);
            }
            execFile(path.join(__dirname, this.executable), args, {
                cwd: process.cwd(),
                env: process.env,
                maxBuffer: 1024 * 1000
            }, (err, stdout, stderr) => {
                if (err)
                    return reject(err);
                resolve();
            });
        });
    }
    
    modifySpritesheet(jsonPath, crnPath)
    {
        return new Promise((resolve, reject) => {
            console.log('modifying ' + localPath(jsonPath) + ' to point to crn file');
            fs.readFile(path.resolve(jsonPath), 'utf8', (err, data) => {
                if (err)
                    return reject(err);
                let json;
                try
                {
                    json = JSON.parse(data);
                }
                catch (e)
                {
                    return reject('Error parsing ' + jsonPath);
                }
                json.meta.image = path.basename(crnPath);
                fs.writeFile(jsonPath, JSON.stringify(json), (err) => {
                    if (err)
                        return reject(err);
                    resolve();
                });
            });
        });
    }
    
    deleteFile(file)
    {
        return new Promise((resolve, reject) => {
            fs.unlink(file, (err) => {
                if (err)
                    return reject(err);
                resolve();
            });
        });
    }
}

module.exports = Crunchitize;