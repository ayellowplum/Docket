import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Download } from 'playwright';
import type { TaskResultFile } from '../shared/types.ts';
import { taskWorkspace } from './workspace.ts';

export class ResultFiles {
  private files = new Map<string, { path: string; name: string; taskId: string }>();

  constructor(private root = path.join(process.cwd(), 'server/.data/downloads')) {}

  async capture(taskId: string, download: Download): Promise<TaskResultFile> {
    const name = path.basename(download.suggestedFilename()) || 'download';
    const target = uniquePath(path.join(taskWorkspace(taskId), 'downloads'), name);
    await download.saveAs(target);
    return this.register(taskId, target, name);
  }

  register(taskId: string, filePath: string, name = path.basename(filePath)): TaskResultFile {
    fs.mkdirSync(this.root, { recursive: true });
    const id = randomUUID();
    const stat = fs.statSync(filePath);
    this.files.set(id, { path: filePath, name, taskId });
    return { id, name, size: stat.size, url: `/api/files/${id}` };
  }

  resolve(id: string): { path: string; name: string } | null {
    const file = this.files.get(id);
    return file ? { path: file.path, name: file.name } : null;
  }
}

export const resultFiles = new ResultFiles();

function uniquePath(dir: string, name: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const parsed = path.parse(name);
  let target = path.join(dir, name);
  let index = 2;
  while (fs.existsSync(target)) {
    target = path.join(dir, `${parsed.name}-${index}${parsed.ext}`);
    index++;
  }
  return target;
}
