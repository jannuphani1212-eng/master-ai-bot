import test from "node:test";
import assert from "node:assert/strict";
import { buildYoutubeTaskContext } from "../lib/youtube-task-context.js";

test("passes the request channel ID into saved rhyme resume context and YouTube channel context", async () => {
  const calls = [];
  const result = await buildYoutubeTaskContext({
    ownerId: "owner-1",
    channelId: "channel-1",
    task: "Resume the unfinished rhyme scene",
    rhymeMemory: {
      async context(ownerId, channelId) {
        calls.push(["rhyme", ownerId, channelId]);
        return "SAVED RHYME: continue at scene 4";
      }
    },
    async getYoutubeAgentContext(input) {
      calls.push(["channel", input.ownerId, input.channelId]);
      return "CHANNEL: Global Rhymes 4U";
    }
  });

  assert.deepEqual(calls, [
    ["rhyme", "owner-1", "channel-1"],
    ["channel", "owner-1", "channel-1"]
  ]);
  assert.match(result, /continue at scene 4/);
  assert.match(result, /Global Rhymes 4U/);
});

test("does not load rhyme memory for unrelated tasks but still loads channel context", async () => {
  let rhymeCalls = 0;
  let channelCalls = 0;
  const result = await buildYoutubeTaskContext({
    ownerId: "owner-1",
    channelId: "channel-2",
    task: "Review my channel performance",
    rhymeMemory: { async context() { rhymeCalls += 1; return "unexpected rhyme"; } },
    async getYoutubeAgentContext({ channelId }) {
      channelCalls += 1;
      return "channel " + channelId;
    }
  });

  assert.equal(rhymeCalls, 0);
  assert.equal(channelCalls, 1);
  assert.equal(result.trim(), "channel channel-2");
});

test("continues safely when one context source fails", async () => {
  const errors = [];
  const result = await buildYoutubeTaskContext({
    ownerId: "owner-1",
    channelId: "channel-3",
    task: "Continue the rhyme",
    rhymeMemory: { async context() { throw new Error("memory offline"); } },
    async getYoutubeAgentContext() { return "channel context available"; },
    onError(kind, error) { errors.push([kind, error.message]); }
  });

  assert.deepEqual(errors, [["rhyme_memory", "memory offline"]]);
  assert.match(result, /channel context available/);
});

test("returns no context without an authenticated owner", async () => {
  let called = false;
  const result = await buildYoutubeTaskContext({
    task: "Resume the rhyme",
    rhymeMemory: { async context() { called = true; return "private memory"; } }
  });
  assert.equal(result, "");
  assert.equal(called, false);
});
