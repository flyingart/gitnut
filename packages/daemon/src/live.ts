import { createHash } from "node:crypto";
import type { EventName, Events } from "@gitnut/commons";
import { fail } from "./errors";
import type { GraphCache } from "./graph";
import { repoSummaries, type RepoIndex } from "./repos";
import { parseStatus, runStatus, statusHash, toSummary } from "./status";

export interface Subscriber {
  send(msg: string): void;
}

const REPOS_MIN_INTERVAL = 5000;
const TOPIC = /^(repos|repo:[0-9a-f]{12}|worktree:[0-9a-f]{12})$/;

export const eventMessage = <E extends EventName>(event: E, data: Events[E]) => JSON.stringify({ event, data });

/**
 * Polls only what someone subscribed to and pushes events on change.
 * One poll per topic at a time; the first poll of a topic only records a baseline.
 */
export class Live {
  private subs = new Map<string, Set<Subscriber>>();
  private last = new Map<string, string>();
  private busy = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private reposAt = 0;

  constructor(
    private index: RepoIndex,
    private graphs: GraphCache,
  ) {}

  start(intervalMs: number) {
    this.stop();
    this.timer = setInterval(() => this.tick(), intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  subscribe(sub: Subscriber, topics: unknown) {
    for (const t of checkTopics(topics)) {
      let set = this.subs.get(t);
      if (!set) this.subs.set(t, (set = new Set()));
      set.add(sub);
      if (!this.last.has(t)) void this.poll(t, true);
    }
  }

  unsubscribe(sub: Subscriber, topics: unknown) {
    for (const t of checkTopics(topics)) this.remove(sub, t);
  }

  drop(sub: Subscriber) {
    for (const t of [...this.subs.keys()]) this.remove(sub, t);
  }

  private remove(sub: Subscriber, t: string) {
    const set = this.subs.get(t);
    set?.delete(sub);
    if (set && !set.size) {
      this.subs.delete(t);
      this.last.delete(t);
    }
  }

  /** Check now instead of waiting for the next tick (after our own git writes). */
  poke(...topics: string[]) {
    for (const t of topics) if (this.subs.has(t)) void this.poll(t);
  }

  tick() {
    for (const t of this.subs.keys()) {
      if (t === "repos" && Date.now() - this.reposAt < REPOS_MIN_INTERVAL) continue;
      void this.poll(t);
    }
  }

  private async poll(topic: string, baseline = false) {
    if (this.busy.has(topic)) return;
    this.busy.add(topic);
    try {
      const r = await this.check(topic);
      if (!r || !this.subs.has(topic)) return;
      const prev = this.last.get(topic);
      this.last.set(topic, r.hash);
      if (!baseline && prev !== undefined && prev !== r.hash) {
        for (const s of this.subs.get(topic) ?? []) s.send(r.message);
      }
    } catch {
      // Transient git errors (repo being rewritten, lock held) are retried on the next tick.
    } finally {
      this.busy.delete(topic);
    }
  }

  private async check(topic: string): Promise<{ hash: string; message: string } | null> {
    if (topic === "repos") {
      this.reposAt = Date.now();
      const summaries = await repoSummaries(await this.index.refresh());
      const json = JSON.stringify(summaries);
      return { hash: createHash("sha1").update(json).digest("hex"), message: eventMessage("repos.changed", summaries) };
    }
    const [kind, id] = topic.split(":");
    if (!this.index.repos.size) await this.index.list();
    if (kind === "repo") {
      const repo = this.index.repos.get(id);
      if (!repo) return null;
      const { graphId } = await this.graphs.state(repo);
      return { hash: graphId, message: eventMessage("graph.changed", { repoId: id, graphId }) };
    }
    const wt = this.index.worktrees.get(id);
    if (!wt) return null;
    const out = await runStatus(wt.path);
    const p = parseStatus(out);
    const summary = toSummary({ id: wt.id, repoId: wt.repoId, path: wt.path, isMain: wt.isMain }, p);
    return { hash: await statusHash(wt.path, out, p), message: eventMessage("worktree.changed", summary) };
  }
}

function checkTopics(topics: unknown): string[] {
  if (!Array.isArray(topics) || !topics.every((t) => typeof t === "string" && TOPIC.test(t))) {
    fail("bad_request", "topics must be repos, repo:<id> or worktree:<id>");
  }
  return topics as string[];
}
