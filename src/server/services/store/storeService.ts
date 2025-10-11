// services/fileStore.ts
import fs from 'fs';
import path from 'path';
import os from 'os';

interface FileEntry {
  fileName: string;
  active: boolean;
}

class FileStore {
  private storePath: string;
  private fileList: Set<string> = new Set();
  private activeFileName: string | null = null;

  constructor() {
    const baseDir = path.join(os.homedir(), 'kobello', 'state');
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }
    this.storePath = path.join(baseDir, 'fileStore.json');
    this.load();
  }

  private save(): void {
    const data = {
      files: Array.from(this.fileList),
      activeFileName: this.activeFileName,
    };
    fs.writeFileSync(this.storePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  private load(): void {
    if (fs.existsSync(this.storePath)) {
      try {
        const raw = fs.readFileSync(this.storePath, 'utf-8');
        const parsed = JSON.parse(raw);
        this.fileList = new Set(parsed.files || []);
        this.activeFileName = parsed.activeFileName || null;
      } catch (err) {
        console.error('Failed to load fileStore.json:', err);
      }
    }
  }

  async addFile(fileName: string, active: boolean): Promise<FileEntry> {
    this.fileList.add(fileName);

    if (active) {
      this.activeFileName = fileName;
    } else if (this.activeFileName === fileName) {
      // unset if it was active
      this.activeFileName = null;
    }

    this.save();
    return { fileName, active };
  }

  async getFiles(): Promise<{ files: string[]; activeFileName: string | null }> {
    return {
      files: Array.from(this.fileList),
      activeFileName: this.activeFileName,
    };
  }
}

export default new FileStore();
