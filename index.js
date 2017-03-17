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
            string: ['target'],
            alias: {
                f: 'files',
                q: 'quality',
                pm: 'premultiplied',
                h: 'help'
            },
            default: {
                quality: 0.5,
                premultiplied: true
            }
        });
        
        if (args.hasOwnProperty('help') || !args.files)
        {
            const help = `
    crunchitize usage:
        -f, --files  Glob path or path to .txt file list of glob paths to .pngs to process.
        -q, --quality  Quality of crunch output, 0-1. Default is 0.5.
        -pm, --premultiplied  If the input pngs should be converted to premultiplied alpha images first. Default is true.
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
        }, args.quality, args.premultiplied);
    }
    
    constructor()
    {
        this.qualityDict = {};
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
    
    process(targetGlobs, callback, quality, premultiply)
    {
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
            return this.handleImages(matches, quality, premultiply);
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
                const qualityCheck = /.* ((?:0\.)?\d+)$/g;
                //see if any lines include a quality value
                for (let i = 0; i < lines.length; ++i)
                {
                    let result = qualityCheck.exec(lines[i]);
                    if (result)
                    {
                        //remove quality value from line
                        lines[i] = lines[i].replace(result[1], '').trim();
                        //store quality value for that file
                        this.qualityDict[lines[i]] = parseFloat(result[1]);
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
                for (let j = 0; j < list.length; ++j)
                {
                    matches.push(list[j]);
                }
            }
            return matches;
        });
    }
    
    handleImages(matches, quality, premultiply)
    {
        let prom = Promise.resolve();
        matches.forEach((match) => {
            prom = prom.then(() => {
                return this.handleImage(match, this.qualityDict[match] || quality || 0.5, typeof premultiply === 'boolean' ? premultiply : true)
            });
        });
        return prom;
    }
    
    handleImage(pngPath, quality, premultiply)
    {
        console.log('\nhandling ' + localPath(pngPath));
        pngPath = path.resolve(pngPath);
        const props = path.parse(pngPath);
        props.ext = '.crn';
        const crnPath = path.join(props.dir, props.name + props.ext);
        let tempFile;
        let prom;
        if (premultiply)
        {
            prom = this.premultiplyPNG(pngPath).then((outPath) => {
                tempFile = outPath;
                return outPath;
            });
        }
        else
        {
            prom = Promise.resolve(pngPath);
        }
        prom = prom.then((srcPath) => {
            return this.crunch(srcPath, crnPath, quality);
        }).then(() => {
            if (tempFile)
            {
                return new Promise((resolve, reject) => {
                    console.log('removing temp image ' + localPath(tempFile));
                    fs.unlink(tempFile, (err) => {
                        if (err)
                            return reject(err);
                        resolve();
                    });
                });
            }
        }).then(() => {
            const props = path.parse(pngPath);
            props.ext = '.json';
            const jsonPath = path.join(props.dir, props.name + props.ext);
            if (fs.existsSync(jsonPath))
            {
                return this.modifySpritesheet(jsonPath, crnPath);
            }
        });
        return prom;
    }
    
    premultiplyPNG(pngPath)
    {
        return new Promise((resolve, reject) => {
            console.log('converting ' + localPath(pngPath) + ' to premultiplied alpha');
            fs.createReadStream(pngPath)
            .pipe(new PNG())
            .on('parsed', function() {
                for (let y = 0; y < this.height; y++) {
                    for (let x = 0; x < this.width; x++) {
                        let idx = (this.width * y + x) << 2;
                        let alpha = this.data[idx+3] / 255;
                        // multiply by alpha
                        this.data[idx] = Math.round(this.data[idx] * alpha);
                        this.data[idx+1] = Math.round(this.data[idx+1] * alpha);
                        this.data[idx+2] = Math.round(this.data[idx+2] * alpha);
                    }
                }
                
                const props = path.parse(pngPath);
                props.name += '_pma';
                const outPath = path.join(props.dir, props.name + props.ext);
                this.pack().pipe(fs.createWriteStream(outPath)).on('close', () => {
                    resolve(outPath);
                });
            });
        });
    }
    
    crunch(pngPath, crnPath, quality)
    {
        return new Promise((resolve, reject) => {
            console.log('crunching ' + localPath(pngPath) + ' to ' + localPath(crnPath) + ' with quality of ' + quality);
            const args = [
                '-file', pngPath,
                '-out', crnPath,
                '-fileformat', 'crn',
                '-DXT5',
                '-quality', Math.max(Math.min(Math.round(quality * 255), 255), 0),
                '-mipMode', 'None'
            ];
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
}

module.exports = Crunchitize;