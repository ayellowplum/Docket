import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type BrowserContext, type Page } from 'playwright';
import type { AgentAction, BrowserKey, ManifestElement, TaskResultFile } from '../shared/types.ts';
import { selectorForId } from './manifest.ts';
import { resolveField } from './credentialResolver.ts';
import { resultFiles } from './resultFiles.ts';
import { runStorageAction, runWorkspaceCommand } from './workspace.ts';
import { forgetMemory, listMemories, remember } from './vault.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USER_DATA_DIR = path.join(__dirname, '.data', 'chromium-profile');

const browserKeys = new Set<BrowserKey>([
  'Enter', 'Tab', 'Escape', 'Backspace', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Meta+A', 'Control+A', 'Meta+L', 'Control+L',
]);

function isBrowserKey(value: string): value is BrowserKey {
  return browserKeys.has(value as BrowserKey);
}

function shouldSubmitSearch(element: ManifestElement | undefined): boolean {
  if (!element) return false;
  return element.role.toLowerCase() === 'searchbox' || /\bsearch\b/i.test(element.label);
}

export interface ExecResult {
  ok: boolean;
  note: string;
  block?: { kind: import('../shared/types.ts').BlockedKind; reason: string };
  done?: boolean;
}

export class Executor {
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private activeTaskId: string | null = null;
  private downloads: Promise<TaskResultFile>[] = [];
  private attachments: TaskResultFile[] = [];

  async start(headless = false): Promise<Page> {
    this.context = await chromium.launchPersistentContext(USER_DATA_DIR, {
      channel: 'chrome',
      headless,
      viewport: { width: 1280, height: 800 },
      args: ['--disable-blink-features=AutomationControlled'],
    });
    this.page = this.context.pages()[0] ?? (await this.context.newPage());
    this.context.on('page', (page) => this.watchDownloads(page));
    this.context.pages().forEach((page) => this.watchDownloads(page));
    return this.page;
  }

  getPage(): Page {
    if (!this.page) throw new Error('Executor not started');
    return this.page;
  }

  domain(): string {
    try {
      return new URL(this.getPage().url()).hostname.replace(/^www\./, '');
    } catch {
      throw new Error('Browser URL has no resolvable domain');
    }
  }

  async screenshot(manual = false): Promise<string> {
    const buf = await this.getPage().screenshot({ type: 'jpeg', quality: manual ? 92 : 82 });
    return `data:image/jpeg;base64,${buf.toString('base64')}`;
  }

  setActiveTask(taskId: string | null) {
    this.activeTaskId = taskId;
    if (taskId) this.downloads = [];
    if (taskId) this.attachments = [];
  }

  private watchDownloads(page: Page) {
    page.on('download', (download) => {
      if (this.activeTaskId) this.downloads.push(resultFiles.capture(this.activeTaskId, download));
    });
  }

  async takeDownloads(): Promise<TaskResultFile[]> {
    const files = await Promise.all(this.downloads);
    this.downloads = [];
    const seen = new Set<string>();
    return [...files, ...this.attachments].filter((file) => {
      if (seen.has(file.id)) return false;
      seen.add(file.id);
      return true;
    });
  }

  async pointer(x: number, y: number) {
    await this.getPage().mouse.click(Math.min(1279, Math.max(0, x * 1280)), Math.min(799, Math.max(0, y * 800)));
  }

  async keyboard(key: string, text?: string) {
    if (text) await this.getPage().keyboard.insertText(text);
    else if (isBrowserKey(key)) await this.getPage().keyboard.press(key);
    else throw new Error('Unsupported browser key');
  }

  async execute(action: AgentAction, manifest: ManifestElement[]): Promise<ExecResult> {
    const page = this.getPage();
    try {
      switch (action.type) {
        case 'navigate':
          await page.goto(action.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
          return { ok: true, note: `Navigated to ${action.url}` };

        case 'home':
          await page.goto('https://www.google.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
          return { ok: true, note: 'Reset browser to Google home' };

        case 'click': {
          await page.click(selectorForId(action.id), { timeout: 8000 });
          const el = manifest.find((m) => m.id === action.id);
          return { ok: true, note: `Clicked "${el?.label ?? action.id}"` };
        }

        case 'type': {
          await page.fill(selectorForId(action.id), action.value, { timeout: 8000 });
          const element = manifest.find((entry) => entry.id === action.id);
          if (shouldSubmitSearch(element)) {
            await page.keyboard.press('Enter');
            await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
            return { ok: true, note: `Typed into "${element?.label || `field ${action.id}`}" and pressed Enter` };
          }
          return { ok: true, note: `Typed into "${element?.label || `field ${action.id}`}"` };
        }

        case 'press':
          if (!isBrowserKey(action.key)) return { ok: false, note: 'Unsupported browser key' };
          await page.keyboard.press(action.key);
          return { ok: true, note: `Pressed ${action.key}` };

        case 'fill_field': {
          const res = resolveField(action.field, this.domain());
          if (!res.ok) return { ok: false, note: `Blocked on ${action.field}`, block: res.block };
          await page.fill(selectorForId(action.id), res.value, { timeout: 8000 });
          return { ok: true, note: `Filled ${action.field} from vault` };
        }

        case 'scroll': {
          if (action.to != null) {
            const sel = selectorForId(action.to);
            await page.evaluate(
              `document.querySelector('${sel}')?.scrollIntoView({behavior:'smooth',block:'center',inline:'center'})`
            );
            await page.waitForTimeout(500);
            const el = manifest.find((m) => m.id === action.to);
            return { ok: true, note: `Scrolled to "${el?.label ?? action.to}"` };
          }
          const dy = (action.direction === 'up' ? -1 : 1) * 0.85 * 800;
          await page.evaluate(`window.scrollBy({top:${dy},behavior:'smooth'})`);
          await page.waitForTimeout(500);
          return { ok: true, note: `Scrolled ${action.direction ?? 'down'} a page` };
        }

        case 'wait':
          await page.waitForTimeout(Math.min(action.ms, 10000));
          return { ok: true, note: `Waited ${action.ms}ms` };

        case 'storage': {
          if (!this.activeTaskId) return { ok: false, note: 'No active task storage is available' };
          const result = runStorageAction(this.activeTaskId, action);
          if (result.attachPath) {
            this.attachments.push(resultFiles.register(this.activeTaskId, result.attachPath));
          }
          return { ok: true, note: result.note };
        }

        case 'memory': {
          if (action.op === 'list') {
            const entries = listMemories();
            return {
              ok: true,
              note: entries.length ? `Permanent memories:\n${entries.map((entry) => `${entry.key}: ${entry.value}`).join('\n')}` : 'No permanent memories saved.',
            };
          }
          if (action.op === 'remember') {
            const entry = remember(action.key ?? 'memory', action.value ?? '');
            return { ok: true, note: `Remembered ${entry.key}: ${entry.value}` };
          }
          if (action.op === 'forget') {
            const removed = forgetMemory(action.query ?? action.key ?? '');
            return { ok: true, note: removed.length ? `Forgot ${removed.map((entry) => entry.key).join(', ')}` : 'No matching memory found.' };
          }
          return { ok: false, note: `Unsupported memory operation: ${action.op}` };
        }

        case 'command': {
          if (!this.activeTaskId) return { ok: false, note: 'No active task workspace is available' };
          const output = await runWorkspaceCommand(this.activeTaskId, action.command);
          return { ok: true, note: `Ran command: ${action.command}\n${output}` };
        }

        case 'done':
          return { ok: true, note: action.note ?? 'Task complete', done: true };

        case 'blocked':
          return { ok: false, note: action.reason, block: { kind: action.kind, reason: action.reason } };
      }
      return { ok: false, note: `Unsupported action: ${(action as { type?: string }).type ?? 'unknown'}` };
    } catch (err) {
      return { ok: false, note: `Action failed: ${(err as Error).message}` };
    }
  }

  async stop() {
    await this.context?.close();
    this.context = null;
    this.page = null;
  }
}
