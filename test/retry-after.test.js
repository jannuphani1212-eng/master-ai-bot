import test from "node:test";
import assert from "node:assert/strict";
import { getRetrySeconds } from "../lib/retry-after.js";

test("uses numeric Retry-After seconds when supplied", () => {
  assert.equal(getRetrySeconds("rate limited", "17"), 17);
});

test("uses an HTTP-date Retry-After header", () => {
  const now = Date.parse("2026-11-17T12:00:00Z");
  assert.equal(
    getRetrySeconds("rate limited", "Tue, 17 Nov 2026 12:00:23 GMT", now),
    23
  );
});

test("uses provider message retry guidance when header is absent", () => {
  assert.equal(getRetrySeconds("Please try again in 14.2s"), 15);
});

test("keeps a safe default when provider gives no retry guidance", () => {
  assert.equal(getRetrySeconds("Too many requests"), 60);
});

test("caps untrusted retry values at one hour", () => {
  assert.equal(getRetrySeconds("rate limited", "99999"), 3600);
});
