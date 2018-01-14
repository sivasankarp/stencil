import { FileSystem, FileSystemWriteOptions, Path } from './interfaces';
import { normalizePath } from '../compiler/util';


export class InMemoryFileSystem {
  private d: FsItems = {};
  private copyFileTasks: FsCopyFileTask[] = [];

  constructor(public fs: FileSystem, private path: Path) {}

  async access(filePath: string) {
    filePath = normalizePath(filePath);
    if (this.d[filePath]) {
      return this.d[filePath].exists;
    }

    let hasAccess = false;
    try {
      const s = await this.stat(filePath);
      this.d[filePath] = {
        exists: true,
        isDirectory: s.isDirectory(),
        isFile: s.isFile()
      };
      hasAccess = true;

    } catch (e) {
      this.d[filePath] = {
        exists: false
      };
    }

    return hasAccess;
  }

  accessSync(filePath: string) {
    filePath = normalizePath(filePath);
    if (this.d[filePath]) {
      return this.d[filePath].exists;
    }

    let hasAccess = false;
    try {
      const s = this.statSync(filePath);
      this.d[filePath] = {
        exists: true,
        isDirectory: s.isDirectory(),
        isFile: s.isFile()
      };
      hasAccess = true;

    } catch (e) {
      this.d[filePath] = {
        exists: false
      };
    }

    return hasAccess;
  }

  async copy(src: string, dest: string, opts?: { filter?: (src: string, dest?: string) => boolean; }) {
    const stats = await this.stat(src);

    if (stats.isDirectory()) {
      return this.copyDir(src, dest, opts);

    } else if (stats.isFile()) {
      return this.copyFile(src, dest, opts);
    }
  }

  async copyDir(src: string, dest: string, opts?: { filter?: (src: string, dest?: string) => boolean; }): Promise<any> {
    const dirItems = await this.readdir(src);

    return Promise.all(dirItems.map(dirItem => {
      const srcPath = normalizePath(this.path.join(src, dirItem));
      const destPath = normalizePath(this.path.join(dest, dirItem));

      return this.stat(srcPath).then(s => {
        if (s.isDirectory()) {
          return this.copyDir(srcPath, destPath, opts);
        } else if (s.isFile()) {
          return this.copyFile(srcPath, destPath, opts);
        }
        return Promise.resolve();
      });
    }));
  }

  async copyFile(src: string, dest: string, opts?: { filter?: (src: string, dest?: string) => boolean; }) {
    src = normalizePath(src);
    dest = normalizePath(dest);

    if (opts && typeof opts.filter === 'function' && !opts.filter(src, dest)) {
      return;
    }

    this.copyFileTasks.push({
      src: src,
      dest: dest
    });
  }

  async emptyDir(dirPath: string) {
    dirPath = normalizePath(dirPath);

    await this.removeDir(dirPath);

    this.d[dirPath] = {
      isFile: false,
      isDirectory: true,
      queueEnsureDir: true
    };
  }

  async readdir(dirPath: string) {
    // always a disk read
    dirPath = normalizePath(dirPath);
    const dirItems = await this.fs.readdir(dirPath);
    this.d[dirPath] = {
      exists: true,
      isFile: false,
      isDirectory: true
    };
    dirItems.forEach(f => {
      const dirItem = this.path.join(dirPath, f);
      this.d[dirItem] = {
        exists: true
      };
    });
    return dirItems;
  }

  async readFile(filePath: string) {
    filePath = normalizePath(filePath);
    let f = this.d[filePath];
    if (f && f.exists && typeof f.fileText === 'string') {
      return f.fileText;
    }

    const fileContent = await this.fs.readFile(filePath, 'utf-8');

    f = this.d[filePath] = this.d[filePath] || {};
    f.exists = true;
    f.isFile = true;
    f.isDirectory = false;
    f.fileText = fileContent;

    return fileContent;
  }

  readFileSync(filePath: string) {
    filePath = normalizePath(filePath);
    let f = this.d[filePath];
    if (f && f.exists && typeof f.fileText === 'string') {
      return f.fileText;
    }

    const fileContent = this.fs.readFileSync(filePath, 'utf-8');

    f = this.d[filePath] = this.d[filePath] || {};
    f.exists = true;
    f.isFile = true;
    f.isDirectory = false;
    f.fileText = fileContent;

    return fileContent;
  }

  async removeDir(dirPath: string): Promise<any> {
    dirPath = normalizePath(dirPath);

    this.d[dirPath] = {
      isFile: false,
      isDirectory: true,
      queueDeleteFromDisk: true
    };

    return this.fs.readdir(dirPath).then(dirItems => {

      return Promise.all(dirItems.map(dirItem => {
        const itemPath = this.path.join(dirPath, dirItem);

        return this.fs.stat(itemPath).then(s => {
          if (s.isDirectory()) {
            return this.removeDir(itemPath);

          } else if (s.isFile()) {
            return this.removeFile(itemPath);
          }
          return Promise.resolve();
        });

      }));
    });
  }

  async removeFile(filePath: string) {
    filePath = normalizePath(filePath);
    this.d[filePath] = this.d[filePath] || {};
    this.d[filePath].queueDeleteFromDisk = true;
  }

  async stat(itemPath: string) {
    itemPath = normalizePath(itemPath);

    let f = this.d[itemPath];
    if (!f || typeof f.isDirectory !== 'boolean' || typeof f.isFile !== 'boolean') {
      const s = await this.fs.stat(itemPath);
      this.d[itemPath] = {
        exists: true,
        isFile: s.isFile(),
        isDirectory: s.isDirectory()
      };
      return s;
    }

    return {
      isFile: () => f.isFile,
      isDirectory: () => f.isDirectory
    };
  }

  statSync(itemPath: string) {
    itemPath = normalizePath(itemPath);

    let f = this.d[itemPath];
    if (!f || typeof f.isDirectory !== 'boolean' || typeof f.isFile !== 'boolean') {
      const s = this.fs.statSync(itemPath);
      f = this.d[itemPath] = {
        exists: true,
        isFile: s.isFile(),
        isDirectory: s.isDirectory()
      };
    }

    return {
      isFile: () => f.isFile,
      isDirectory: () => f.isDirectory
    };
  }

  async writeFile(filePath: string, content: string, opts?: FileSystemWriteOptions) {
    filePath = normalizePath(filePath);

    if (!this.d[filePath]) {
      this.d[filePath] = {};
    }
    const d = this.d[filePath];
    d.exists = true;
    d.isFile = true;
    d.isDirectory = false;
    d.queueDeleteFromDisk = false;

    if (opts && opts.inMemoryOnly) {
      // we don't want to actually write this to disk
      // just keep it in memory
      if (!d.queueWriteToDisk) {
        // we only want this in memory and
        // it wasn't already queued to be written
        d.queueWriteToDisk = false;
      }
      d.fileText = content;

    } else {
      // we want to write this to disk (eventually)
      // but only if the content is different
      // from our existing cached content
      if (!d.queueWriteToDisk && d.fileText !== content) {
        // not already queued to be written
        // and the content is different
        d.queueWriteToDisk = true;
      }
      d.fileText = content;
    }
  }

  async commit() {
    const instructions = getCommitInstructions(this.path, this.d, this.copyFileTasks);

    // ensure directories we need exist
    const dirsAdded = await this.commitEnsureDirs(instructions.dirsToEnsure);

    // write all queued the files
    // copy all the files queued to be copied
    const results = await Promise.all([
      this.commitWriteFiles(instructions.filesToWrite),
      this.commitCopyFiles(instructions.copyFileTasks)
    ]);

    // remove all the queued files to be deleted
    const filesDeleted = await this.commitDeleteFiles(instructions.filesToDelete);

    // remove all the queued dirs to be deleted
    const dirsDeleted = await this.commitDeleteDirs(instructions.dirsToDelete);

    instructions.filesToDelete.forEach(fileToDelete => {
      this.clearFileCache(fileToDelete);
    });

    instructions.dirsToDelete.forEach(dirToDelete => {
      this.clearDirCache(dirToDelete);
    });

    // return only the files that were
    return {
      filesWritten: results[0],
      filesCopied: results[1],
      filesDeleted: filesDeleted,
      dirsDeleted: dirsDeleted,
      dirsAdded: dirsAdded
    };
  }

  private async commitEnsureDirs(dirsToEnsure: string[]) {
    const dirsAdded: string[] = [];

    await Promise.all(dirsToEnsure.map(async dirPath => {
      if (this.d[dirPath] && this.d[dirPath].exists && this.d[dirPath].isDirectory) {
        // already cached that this path is indeed an existing directory
        return;
      }

      try {
        // cache that we know this is a directory on disk
        const d = this.d[dirPath] = this.d[dirPath] || {};
        d.exists = true;
        d.isDirectory = true;
        d.isFile = false;

        await this.fs.mkdir(dirPath);
        dirsAdded.push(dirPath);

      } catch (e) {
        console.log('commitEnsureDirs', e);
      }
    }));

    return dirsAdded;
  }

  private async commitWriteFiles(filesToWrite: string[]) {
    return Promise.all(filesToWrite.map(async filePath => {
      const item = this.d[filePath];

      await this.fs.writeFile(filePath, item.fileText);

      return filePath;
    }));
  }

  private async commitDeleteFiles(filesToDelete: string[]) {
    return Promise.all(filesToDelete.map(async filePath => {
      await this.fs.unlink(filePath);
      return filePath;
    }));
  }

  private async commitDeleteDirs(dirsToDelete: string[]) {
    return Promise.all(dirsToDelete.map(async dirPath => {
      await this.fs.rmdir(dirPath);
      return dirPath;
    }));
  }

  private async commitCopyFiles(copyFileTasks: FsCopyFileTask[]) {
    return Promise.all(copyFileTasks.map(async copyFileTask => {
      await this.fs.copyFile(copyFileTask.src, copyFileTask.dest);
      return copyFileTask.dest;
    }));
  }

  clearDirCache(dirPath: string) {
    dirPath = normalizePath(dirPath);

    const filePaths = Object.keys(this.d);

    filePaths.forEach(f => {
      const filePath = this.path.relative(dirPath, f).split('/')[0];
      if (!filePath.startsWith('.') && !filePath.startsWith('/')) {
        this.clearFileCache(f);
      }
    });
  }

  clearFileCache(filePath: string) {
    filePath = normalizePath(filePath);
    delete this.d[filePath];
  }

  clearCache() {
    this.d = {};
  }

  get disk() {
    return this.fs;
  }
}


function getCommitInstructions(path: Path, d: FsItems, copyFileTasks: FsCopyFileTask[]) {
  const instructions = {
    filesToDelete: [] as string[],
    filesToWrite: [] as string[],
    dirsToDelete: [] as string[],
    dirsToEnsure: [] as string[],
    copyFileTasks: copyFileTasks
  };

  Object.keys(d).forEach(filePath => {
    const item = d[filePath];

    if (item.queueWriteToDisk) {
      instructions.filesToWrite.push(filePath);

      const dir = normalizePath(path.dirname(filePath));
      if (!instructions.dirsToEnsure.includes(dir)) {
        instructions.dirsToEnsure.push(dir);
      }

      const i = instructions.filesToDelete.indexOf(filePath);
      if (i > -1) {
        instructions.filesToDelete.splice(i, 1);
      }

    } else if (item.queueEnsureDir) {
      if (!instructions.dirsToEnsure.includes(filePath)) {
        instructions.dirsToEnsure.push(filePath);
      }

    } else if (item.queueDeleteFromDisk) {
      if (item.isDirectory) {
        instructions.dirsToDelete.push(filePath);

      } else if (item.isFile) {
        instructions.filesToDelete.push(filePath);
      }
    }

    item.queueDeleteFromDisk = false;
    item.queueWriteToDisk = false;
    item.queueEnsureDir = false;
  });

  copyFileTasks.map(copyFileTask => {
    const dir = normalizePath(path.dirname(copyFileTask.dest));
    if (!instructions.dirsToEnsure.includes(dir)) {
      instructions.dirsToEnsure.push(dir);
    }
  });

  // add all the ancestor directories for each directory too
  for (let i = 0, ilen = instructions.dirsToEnsure.length; i < ilen; i++) {
    const segments = instructions.dirsToEnsure[i].split('/');

    for (let j = 2; j < segments.length; j++) {
      const dir = segments.slice(0, j).join('/');
      if (!instructions.dirsToEnsure.includes(dir)) {
        instructions.dirsToEnsure.push(dir);
      }
    }
  }

  // sort so the the shortest paths ensured first
  instructions.dirsToEnsure.sort((a, b) => {
    const segmentsA = a.split('/').length;
    const segmentsB = b.split('/').length;
    if (segmentsA < segmentsB) return -1;
    if (segmentsA > segmentsB) return 1;
    if (a.length < b.length) return -1;
    if (a.length > b.length) return 1;
    return 0;
  });

  // sort so the the longest paths are removed first
  instructions.dirsToDelete.sort((a, b) => {
    const segmentsA = a.split('/').length;
    const segmentsB = b.split('/').length;
    if (segmentsA < segmentsB) return 1;
    if (segmentsA > segmentsB) return -1;
    if (a.length < b.length) return 1;
    if (a.length > b.length) return -1;
    return 0;
  });

  instructions.dirsToEnsure.forEach(dirToEnsure => {
    const i = instructions.dirsToDelete.indexOf(dirToEnsure);
    if (i > -1) {
      instructions.dirsToDelete.splice(i, 1);
    }
  });

  instructions.dirsToEnsure = instructions.dirsToEnsure.filter(dir => {
    if (d[dir] && d[dir].exists && d[dir].isDirectory) {
      return false;
    }
    return true;
  });

  return instructions;
}

interface FsItems {
  [filePath: string]: FsItem;
}

interface FsItem {
  fileText?: string;
  isFile?: boolean;
  isDirectory?: boolean;
  exists?: boolean;
  queueWriteToDisk?: boolean;
  queueDeleteFromDisk?: boolean;
  queueEnsureDir?: boolean;
}

interface FsCopyFileTask {
  src: string;
  dest: string;
}
