import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Download } from 'playwright';
import type { TaskResultFile } from '../shared/types.ts';

export class ResultFiles {
  private files = new Map<string, { path: string; name: string; taskId: string }>();

  constructor(private root = path.join(process.cwd(), 'server/.data/downloads')) {}

  async capture(taskId: string, download: Download): Promise<TaskResultFile> {
    fs.mkdirSync(this.root, { recursive: true });
    const id = randomUUID();
    const name = path.basename(download.suggestedFilename()) || 'download';
    const target = path.join(this.root, id);
    await download.saveAs(target);
    const size = fs.statSync(target).size;
    this.files.set(id, { path: target, name, taskId });
    return { id, name, size, url: `/api/files/${id}` };
  }

  resolve(id: string): { path: string; name: string } | null {
    const file = this.files.get(id);
    return file ? { path: file.path, name: file.name } : null;
  }
}

export const resultFiles = new ResultFiles();
