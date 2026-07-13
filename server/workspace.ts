import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { StorageOp } from '../shared/types.ts';

const execAsync = promisify(exec);
const ROOT = path.join(process.cwd(), 'server/.data/workspaces');
const MAX_READ_BYTES = 80_000;
const MAX_WRITE_BYTES = 1_000_000;
const MAX_OUTPUT = 6_000;

export interface StorageAction {
  op: StorageOp;
  path?: string;
  content?: string;
}

export function taskWorkspace(taskId: string): string {
  const dir = path.join(ROOT, safeSegment(taskId));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function resolveWorkspacePath(taskId: string, relativePath = '.'): string {
  const root = taskWorkspace(taskId);
  const target = path.resolve(root, relativePath || '.');
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error('Path is outside the task workspace');
  }
  return target;
}

export function relativeWorkspacePath(taskId: string, absolutePath: string): string {
  return path.relative(taskWorkspace(taskId), absolutePath) || '.';
}

export function runStorageAction(taskId: string, action: StorageAction): { note: string; attachPath?: string } {
  const op = action.op;
  if (op === 'list') {
    const dir = resolveWorkspacePath(taskId, action.path || '.');
    const entries = fs.existsSync(dir)
      ? fs.readdirSync(dir, { withFileTypes: true }).map((entry) => {
          const full = path.join(dir, entry.name);
          const stat = fs.statSync(full);
          return `${entry.isDirectory() ? 'dir ' : 'file'} ${path.relative(taskWorkspace(taskId), full)} ${stat.size} bytes`;
        })
      : [];
    return { note: entries.length ? `Storage list:\n${entries.join('\n')}` : 'Storage is empty.' };
  }

  if (op === 'read') {
    const file = resolveWorkspacePath(taskId, requiredPath(action.path));
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return { note: `File not found: ${action.path}` };
    const buffer = fs.readFileSync(file);
    const text = buffer.subarray(0, MAX_READ_BYTES).toString('utf8');
    const suffix = buffer.length > MAX_READ_BYTES ? '\n...truncated...' : '';
    return { note: `Read ${relativeWorkspacePath(taskId, file)}:\n${text}${suffix}` };
  }

  if (op === 'write') {
    const file = resolveWorkspacePath(taskId, requiredPath(action.path));
    const content = action.content ?? '';
    if (Buffer.byteLength(content, 'utf8') > MAX_WRITE_BYTES) throw new Error('File content is too large');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, 'utf8');
    return { note: `Wrote ${relativeWorkspacePath(taskId, file)} (${Buffer.byteLength(content, 'utf8')} bytes)` };
  }

  if (op === 'delete') {
    const target = resolveWorkspacePath(taskId, requiredPath(action.path));
    if (!fs.existsSync(target)) return { note: `Nothing to delete at ${action.path}` };
    fs.rmSync(target, { recursive: true, force: true });
    return { note: `Deleted ${action.path}` };
  }

  if (op === 'attach') {
    const file = resolveWorkspacePath(taskId, requiredPath(action.path));
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return { note: `File not found: ${action.path}` };
    return { note: `Attached ${relativeWorkspacePath(taskId, file)} to the final result`, attachPath: file };
  }

  return { note: `Unsupported storage operation: ${op}` };
}

export async function runWorkspaceCommand(taskId: string, command: string): Promise<string> {
  const cwd = taskWorkspace(taskId);
  const { stdout, stderr } = await execAsync(command, {
    cwd,
    timeout: 60_000,
    maxBuffer: 1_000_000,
    env: { ...process.env, npm_config_prefix: path.join(cwd, '.npm-global') },
  });
  const output = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
  return output ? truncate(output) : 'Command finished with no output.';
}

function requiredPath(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error('A storage path is required');
  return trimmed;
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function truncate(value: string): string {
  return value.length > MAX_OUTPUT ? `${value.slice(0, MAX_OUTPUT)}\n...truncated...` : value;
}
