import { expect, test } from "bun:test";
import { GitnutConnection } from "../src/connection";

/** Minimal fake WebSocket: records sent frames, the test drives open / message / close. */
class FakeWS {
  static all: FakeWS[] = [];
  sent: any[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  constructor(
    public url: string,
    public protocols: string[],
  ) {
    FakeWS.all.push(this);
  }
  send(s: string) {
    this.sent.push(JSON.parse(s));
  }
  close() {
    this.onclose?.({ code: 1000 });
  }
  open() {
    this.onopen?.();
  }
  reply(id: number, result: unknown) {
    this.onmessage?.({ data: JSON.stringify({ id, result }) });
  }
  event(event: string, data: unknown) {
    this.onmessage?.({ data: JSON.stringify({ event, data }) });
  }
  drop(code = 1006) {
    this.onclose?.({ code });
  }
  methods() {
    return this.sent.map((m) => `${m.method}${m.params?.topics ? ":" + m.params.topics.join(",") : ""}`);
  }
}

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
let last: GitnutConnection | null = null;
const make = (health = { authRequired: false }) => {
  last?.close();
  FakeWS.all = [];
  const conn = new GitnutConnection({ url: "http://box:7420/", token: "tok_123" }, {
    WebSocket: FakeWS as unknown as typeof WebSocket,
    fetch: async () => new Response(JSON.stringify({ ok: true, ...health })),
    backoffMs: 5,
  });
  last = conn;
  return { conn, ws: () => FakeWS.all[FakeWS.all.length - 1] };
};

test("R-DAEMON-5: offers gitnut.v1 plus the bearer subprotocol", () => {
  const { ws } = make();
  expect(ws().url).toBe("ws://box:7420/ws");
  expect(ws().protocols).toEqual(["gitnut.v1", "gitnut.bearer.tok_123"]);
});

test("calls wait for the connection and resolve with their result", async () => {
  const { conn, ws } = make();
  const p = conn.call("repos.list");
  expect(ws().sent).toEqual([]);
  ws().open();
  const req = ws().sent.find((m) => m.method === "repos.list");
  ws().reply(req.id, []);
  expect(await p).toEqual([]);
});

test("R-DAEMON-2: topics are ref-counted per connection", async () => {
  const { conn, ws } = make();
  ws().open();
  const a = conn.retain("repo:abcdefabcdef");
  const b = conn.retain("repo:abcdefabcdef");
  expect(ws().methods().filter((m) => m.startsWith("subscribe"))).toEqual(["subscribe:repo:abcdefabcdef"]);
  a();
  a(); // releasing twice is harmless
  expect(ws().methods().some((m) => m.startsWith("unsubscribe"))).toBe(false);
  b();
  expect(ws().methods().filter((m) => m.startsWith("unsubscribe"))).toEqual(["unsubscribe:repo:abcdefabcdef"]);
  expect(conn.subscriptions.size).toBe(0);
});

test("reconnects with backoff and subscribes its topics again", async () => {
  const { conn, ws } = make();
  ws().open();
  conn.retain("repos");
  const first = ws();
  first.drop();
  expect(conn.state).toBe("offline");
  await tick(30);
  expect(FakeWS.all.length).toBe(2);
  ws().open();
  expect(conn.state).toBe("open");
  expect(ws().methods()).toContain("subscribe:repos");
});

test("in-flight calls fail when the socket drops", async () => {
  const { conn, ws } = make();
  ws().open();
  const p = conn.call("repos.list");
  ws().drop();
  await expect(p).rejects.toThrow("connection lost");
});

test("R-DAEMON-5: close code 4001 (token rotated) means unauthorized, no reconnect", async () => {
  const { conn, ws } = make();
  ws().open();
  ws().drop(4001);
  expect(conn.state).toBe("unauthorized");
  await tick(30);
  expect(FakeWS.all.length).toBe(1);
  await expect(conn.call("repos.list")).rejects.toThrow("unauthorized");
});

test("a refused handshake with authRequired shows the login state", async () => {
  const { conn, ws } = make({ authRequired: true });
  ws().drop();
  await tick(5);
  expect(conn.state).toBe("unauthorized");
});

test("events update shared queries", async () => {
  const { conn, ws } = make();
  ws().open();
  const q = conn.query("repos", async () => [] as any[], "repos");
  const off = q.subscribe(() => {});
  ws().event("repos.changed", [{ id: "r1", worktrees: [] }]);
  expect(q.getSnapshot().data).toEqual([{ id: "r1", worktrees: [] }]);
  off();
});
