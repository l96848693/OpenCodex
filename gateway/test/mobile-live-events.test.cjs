const assert = require("node:assert/strict");
const test = require("node:test");

const { bindMobileLiveEvents, normalizeMobileLiveNotification } = require("../runtime/mobile/live-events.cjs");

test("mobile live events expose agent and reasoning-summary deltas only", () => {
  assert.deepEqual(normalizeMobileLiveNotification({
    method: "item/agentMessage/delta",
    params: { threadId: "thread-one", turnId: "turn-one", itemId: "item-one", delta: "处理中" },
  }), {
    type: "thread.message.delta",
    threadId: "thread-one",
    payload: { turnId: "turn-one", itemId: "item-one", kind: "message", delta: "处理中" },
  });
  assert.equal(normalizeMobileLiveNotification({
    method: "item/reasoning/textDelta",
    params: { threadId: "thread-one", turnId: "turn-one", itemId: "private", delta: "private chain" },
  }), null);
});

test("mobile live events publish ordered turn lifecycle envelopes", () => {
  let observer;
  const published = [];
  const dispose = bindMobileLiveEvents({
    transport: { observeNotifications(listener) { observer = listener; return () => { observer = null; }; } },
    publish: (event) => published.push(event),
  });
  observer({ method: "turn/started", params: { threadId: "thread-one", turn: { id: "turn-one" } } });
  observer({ method: "turn/completed", params: { threadId: "thread-one", turn: { id: "turn-one" } } });
  assert.deepEqual(published.map((event) => [event.sequence, event.type, event.payload.status]), [
    [1, "thread.turn.state", "streaming"],
    [2, "thread.turn.state", "completed"],
  ]);
  dispose();
  assert.equal(observer, null);
});

test("mobile live events accept official snake_case ids and notification wrappers", () => {
  assert.deepEqual(normalizeMobileLiveNotification({
    method: "notification",
    params: {
      method: "item/agentMessage/delta",
      params: { thread_id: "thread-two", turn_id: "turn-two", item_id: "item-two", delta: "新增" },
    },
  }), {
    type: "thread.message.delta",
    threadId: "thread-two",
    payload: { turnId: "turn-two", itemId: "item-two", kind: "message", delta: "新增" },
  });

  assert.deepEqual(normalizeMobileLiveNotification({
    method: "item/plan/delta",
    params: { thread: { id: "thread-three" }, turn: { id: "turn-three" }, item: { id: "item-three" }, delta: "计划" },
  }), {
    type: "thread.message.delta",
    threadId: "thread-three",
    payload: { turnId: "turn-three", itemId: "item-three", kind: "reasoning", delta: "计划" },
  });
});

test("mobile live events retain agent message phase for stable process styling", () => {
  assert.deepEqual(normalizeMobileLiveNotification({
    method: "item/agentMessage/delta",
    params: {
      threadId: "thread-phase",
      turnId: "turn-phase",
      itemId: "item-commentary",
      phase: "commentary",
      delta: "检查中",
    },
  }), {
    type: "thread.message.delta",
    threadId: "thread-phase",
    payload: { turnId: "turn-phase", itemId: "item-commentary", kind: "message", delta: "检查中", phase: "commentary" },
  });
});
