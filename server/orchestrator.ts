import type { Task } from '../shared/types.ts';
import { serverStore as S } from './store.ts';
import { Executor } from './executor.ts';
import { decideAction, summarizeRun } from './llm.ts';
import { detectCaptcha, extractManifest, extractVisibleText } from './manifest.ts';
import { setPreferredPassword, allowDomain, setCredential, remember, memoryContext } from './vault.ts';

const MAX_STEPS = 25;

export class Orchestrator {
  private executor = new Executor();
  private started = false;
  private looping = false;
  private blockWaiters = new Map<string, (value: string, opts: ResolveOpts) => void>();
  private manualTaskId: string | null = null;
  private manualTimer: ReturnType<typeof setInterval> | null = null;
  private manualBusy = false;

  private async ensureStarted() {
    if (this.started) return;
    await this.executor.start(true);
    this.started = true;
  }

  async runLoop() {
    if (this.looping) return;
    this.looping = true;
    try {
      await this.ensureStarted();
      let next: Task | null;
      while ((next = S.nextQueued())) {
        try {
          await this.runTask(next);
        } catch (error) {
          const reason = `Browser run failed: ${(error as Error).message}`;
          console.error(`[browser] task=${next.id} ${reason}`);
          S.updateTask(next.id, { status: 'blocked', blockedKind: 'ambiguous', blockedReason: reason });
          this.clearOverlay();
        }
      }
    } finally {
      this.looping = false;
      this.clearOverlay();
    }
  }

  private async runTask(task: Task) {
    S.updateTask(task.id, { status: 'running' });
    this.executor.setActiveTask(task.id);
    const activityId = `act_${task.id}`;
    S.chat({ id: activityId, kind: 'activity', state: 'working', text: task.title, createdAt: Date.now() });
    const page = this.executor.getPage();
    const history: string[] = [];
    const actionCounts = new Map<string, number>();
    let failedActions = 0;
    let injectedContext: string | undefined;
    let finished = false;

    for (let step = 1; step <= MAX_STEPS; step++) {
      const manifest = await extractManifestEventually(page);
      S.overlay({ cursorPos: { x: 0.5, y: 0.5 }, isActive: true, hoveredBbox: null, isCapturing: true });
      const shot = await this.executor.screenshot();
      S.browser({ url: page.url(), title: await page.title(), screenshot: shot });

      if (step > 1 && (await detectCaptcha(page))) {
        S.addLog({ taskId: task.id, step, action: 'blocked', note: 'Captcha detected, handed over to you', at: Date.now() });
        const value = await this.park(task, 'captcha', 'This page is showing a captcha. Solve it in the browser view, then hit Resume agent.');
        if (value === CANCELLED) return this.finishCancelled(activityId, task);
        history.push('blocked: captcha was solved by the user');
        continue;
      }

      const pageText = await extractVisibleText(page);
      const action = await decideAction({ task, url: page.url(), manifest, pageText, userContext: userContextText(), history, injectedContext });
      injectedContext = undefined;

      const actionKey = JSON.stringify(action);
      const repeats = (actionCounts.get(actionKey) ?? 0) + 1;
      actionCounts.set(actionKey, repeats);
      if (repeats >= 3) {
        history.push('stopped: kept repeating the same action');
        S.addLog({ taskId: task.id, step, action: action.type, note: 'Stopped after repeating the same action', at: Date.now() });
        break;
      }

      const target = 'id' in action ? manifest.find((m) => m.id === (action as any).id) : undefined;
      if (target) {
        const vw = 1280, vh = 800;
        S.overlay({
          cursorPos: { x: (target.bbox.x + target.bbox.width / 2) / vw, y: (target.bbox.y + target.bbox.height / 2) / vh },
          isActive: true,
          hoveredBbox: { x: target.bbox.x / vw, y: target.bbox.y / vh, width: target.bbox.width / vw, height: target.bbox.height / vh },
          isCapturing: false,
        });
        await sleep(650);
      }

      const result = (await this.executor.execute(action, manifest)) ?? {
        ok: false,
        note: `Unsupported or empty action returned for "${action.type}"`,
      };
      this.clearOverlay();
      history.push(`${action.type}: ${result.note}`);
      S.addLog({ taskId: task.id, step, action: action.type, note: result.note, at: Date.now() });
      console.log(`[browser] task=${task.id} step=${step} action=${action.type} ok=${result.ok} note=${result.note}`);

      failedActions = result.ok ? 0 : failedActions + 1;

      if (repeats === 2) history.push('note: that exact action was already tried, do something different');

      if (result.done) {
        finished = true;
        break;
      }
      if (result.block) {
        const value = await this.park(task, result.block.kind, result.block.reason);
        if (value === CANCELLED) return this.finishCancelled(activityId, task);
        injectedContext = value;
        continue;
      }
      if (!result.ok && shouldUseManualMode(result.note, failedActions)) {
        const value = await this.park(task, 'manual', manualReason(result.note));
        if (value === CANCELLED) return this.finishCancelled(activityId, task);
        history.push(`manual: user helped with the page (${value})`);
        injectedContext = `The user helped with the page: ${value}`;
        failedActions = 0;
        continue;
      }
      await sleep(400);
    }

    const notes = S.logsFor(task.id).map((l) => l.note);
    const files = await this.executor.takeDownloads();
    const result = finished
      ? await summarizeRun(task.title, notes, files.map((file) => ({ name: file.name, size: file.size })))
      : {
          summary: 'This task could not be finished. Open it to see what happened.',
          details: notes,
        };
    S.updateTask(task.id, { status: 'done', summary: result.summary, result: { ...result, files } });
    this.executor.setActiveTask(null);
    this.clearOverlay();
    S.chat({ id: activityId, kind: 'activity', state: 'done', text: task.title, detail: result.summary, createdAt: Date.now() });
  }

  private finishCancelled(activityId: string, task: Task) {
    S.chat({ id: activityId, kind: 'activity', state: 'done', text: task.title, detail: 'Removed before it finished.', createdAt: Date.now() });
    this.executor.setActiveTask(null);
    this.clearOverlay();
  }

  private park(task: Task, kind: Task['blockedKind'], reason: string): Promise<string> {
    S.updateTask(task.id, { status: 'blocked', blockedKind: kind, blockedReason: reason });
    this.manualTaskId = task.id;
    S.browser({ ...S.browserView, manual: true, manualReason: reason });
    this.clearOverlay();
    this.startManualRefresh();
    return new Promise((resolve) => {
      this.blockWaiters.set(task.id, (value, opts) => {
        this.stopManualRefresh();
        if (opts.cancelled) return resolve(CANCELLED);
        if (kind === 'password_setup') {
          const domain = this.safeDomain();
          if (opts.applyToAll) setPreferredPassword(value);
          setCredential(domain, { username: '', password: value });
        }
        if (kind === 'memory') remember(memoryKeyFromReason(reason), value);
        if (kind === 'domain_permission' || opts.allowDomain) allowDomain(this.safeDomain());
        S.updateTask(task.id, { status: 'running', blockedKind: undefined, blockedReason: undefined });
        this.manualTaskId = null;
        S.browser({ ...S.browserView, manual: false, manualReason: undefined });
        resolve(value);
      });
    });
  }

  resolveBlock(taskId: string, value: string, opts: ResolveOpts) {
    const w = this.blockWaiters.get(taskId);
    if (w) {
      this.blockWaiters.delete(taskId);
      w(value, opts);
    }
  }

  cancelBlock(taskId: string) {
    const w = this.blockWaiters.get(taskId);
    if (!w) return;
    this.blockWaiters.delete(taskId);
    if (this.manualTaskId === taskId) {
      this.manualTaskId = null;
      S.browser({ ...S.browserView, manual: false, manualReason: undefined });
    }
    w(CANCELLED, { cancelled: true });
  }

  async handlePointer(x: number, y: number) {
    if (!this.manualTaskId || !Number.isFinite(x) || !Number.isFinite(y)) return;
    try {
      await this.executor.pointer(x, y);
      await this.refreshManualView();
    } catch (error) {
      console.error(`[browser] manual pointer failed: ${(error as Error).message}`);
    }
  }

  async handleKey(key: string, text?: string) {
    if (!this.manualTaskId) return;
    try {
      await this.executor.keyboard(key, text);
      await this.refreshManualView();
    } catch (error) {
      console.error(`[browser] manual key failed: ${(error as Error).message}`);
    }
  }

  resumeManual() {
    if (this.manualTaskId) this.resolveBlock(this.manualTaskId, 'done', {});
  }

  async goHome() {
    await this.ensureStarted();
    this.stopManualRefresh();
    this.manualTaskId = null;
    const page = this.executor.getPage();
    await page.goto('https://www.google.com/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    S.browser({
      url: page.url(),
      title: await page.title().catch(() => 'Google'),
      screenshot: await this.executor.screenshot(true).catch(() => undefined),
      manual: false,
      manualReason: undefined,
    });
    this.clearOverlay();
  }

  private startManualRefresh() {
    this.stopManualRefresh();
    this.manualTimer = setInterval(async () => {
      if (this.manualBusy || !this.manualTaskId) return;
      this.manualBusy = true;
      try {
        await this.refreshManualView();
      } catch {
      } finally {
        this.manualBusy = false;
      }
    }, 300);
  }

  private stopManualRefresh() {
    if (this.manualTimer) {
      clearInterval(this.manualTimer);
      this.manualTimer = null;
    }
  }

  private async refreshManualView() {
    const page = this.executor.getPage();
    S.browser({
      url: page.url(),
      title: await page.title(),
      screenshot: await this.executor.screenshot(true),
      manual: true,
      manualReason: S.browserView.manualReason,
    });
  }

  private clearOverlay() {
    S.overlay({ cursorPos: { x: 0.5, y: 0.5 }, isActive: false, hoveredBbox: null, isCapturing: false });
  }

  private safeDomain(): string {
    try {
      return this.executor.domain();
    } catch {
      return 'unknown';
    }
  }
}

interface ResolveOpts {
  applyToAll?: boolean;
  allowDomain?: boolean;
  cancelled?: boolean;
}

const CANCELLED = 'docket:task-cancelled';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function userContextText(): string {
  return memoryContext();
}

function memoryKeyFromReason(reason: string): string {
  const lower = reason.toLowerCase();
  if (/city|where.*live|live in|town/.test(lower)) return 'city';
  if (/location|zip|postal|area|near me|nearby/.test(lower)) return 'location';
  if (/timezone|time zone/.test(lower)) return 'timezone';
  if (/diet|food|meal|allerg|vegetarian|vegan/.test(lower)) return 'food preferences';
  if (/format|style|tone|write/.test(lower)) return 'response preferences';
  return 'user context';
}

function shouldUseManualMode(note: string, failures: number): boolean {
  return (
    /intercepts pointer events|Timeout .*exceeded|not visible|not enabled|detached|no interactive elements|Unsupported action/i.test(note) ||
    failures >= 2
  );
}

function manualReason(note: string): string {
  if (/intercepts pointer events|modal|dialog/i.test(note)) {
    return 'A popup is blocking the page. Close it or choose the needed option, then resume.';
  }
  if (/Timeout .*exceeded|not visible|not enabled|detached/i.test(note)) {
    return 'The page control did not respond. Help with the next small browser action, then resume.';
  }
  return 'The browser got stuck. Make the next small page action, then resume.';
}

async function extractManifestEventually(page: Parameters<typeof extractManifest>[0]) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await extractManifest(page);
    } catch (error) {
      lastError = error;
      if (!/context was destroyed|navigation/i.test(String(error))) throw error;
      await sleep(400 * (attempt + 1));
    }
  }
  throw lastError;
}

export const orchestrator = new Orchestrator();
