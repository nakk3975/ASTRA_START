import test from "node:test";
import assert from "node:assert/strict";
import { CarryConnection } from "../apps/web/src/carry/network.ts";

test("rejected sessions stop polling and expose reconnect while transient failures back off", async () => {
  for (const status of [400, 401, 409, 429, 503]) {
    const n = new CarryConnection();
    n.session = {
      roomId: "test",
      member: "p",
      token: "test-only",
      code: "TEST",
    };
    n.stopped = false;
    let calls = 0,
      message = "";
    n.onStatus = (s) => (message = s);
    n.api = async () => {
      calls++;
      throw Object.assign(Error("연결이 끊어졌습니다."), { status });
    };
    await n.sync();
    await n.sync();
    await n.sync(true);
    assert.equal(calls, 1, "failed requests must not loop at 80 ms");
    assert.equal(n.busy, false);
    assert.equal(n.inFlight, 0);
    if (status === 429 || status === 503) {
      assert.equal(n.stopped, false);
      assert.match(message, /재시도/);
    } else {
      assert.equal(n.stopped, true);
      assert.match(message, /다시 연결/);
    }
  }
});
