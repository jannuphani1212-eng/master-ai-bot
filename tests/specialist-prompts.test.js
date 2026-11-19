import test from "node:test";
import assert from "node:assert/strict";
import {
  SPECIALIST_IDS,
  getMasterInstructions,
  getSpecialistInstructions
} from "../lib/specialist-prompts.js";

test("all five specialist agents have distinct professional instructions", () => {
  assert.deepEqual(SPECIALIST_IDS, [
    "affiliate",
    "youtube",
    "blogging",
    "app-development",
    "seo"
  ]);

  const prompts = SPECIALIST_IDS.map(getSpecialistInstructions);
  assert.equal(new Set(prompts).size, 5);

  for (const prompt of prompts) {
    assert.match(prompt, /PROFESSIONAL OPERATING STANDARD/);
    assert.match(prompt, /REQUIRED REPORT FORMAT/);
    assert.match(prompt, /Do not guarantee income, rankings, views/);
  }
});

test("specialist prompts contain domain-specific quality requirements", () => {
  assert.match(getSpecialistInstructions("affiliate"), /commission/);
  assert.match(getSpecialistInstructions("youtube"), /retention/);
  assert.match(getSpecialistInstructions("blogging"), /editorial calendar/);
  assert.match(getSpecialistInstructions("app-development"), /acceptance criteria/);
  assert.match(getSpecialistInstructions("seo"), /crawlability/);
});

test("unknown specialist IDs are rejected", () => {
  assert.throws(
    () => getSpecialistInstructions("unknown"),
    /Unknown specialist agent/
  );
});

test("master instructions require independent quality review and honest reporting", () => {
  const prompt = getMasterInstructions();
  assert.match(prompt, /quality controller/);
  assert.match(prompt, /Do not blindly trust specialist output/);
  assert.match(prompt, /proposal-only/);
});


test("affiliate prompt uses relevant fashion and watches context and ASCI disclosure", () => {
  const prompt = getSpecialistInstructions("affiliate");
  assert.ok(prompt.includes("fashion and watches"));
  assert.ok(prompt.includes("ASCI"));
  assert.ok(prompt.includes("unrelated health"));
});

test("YouTube prompt requires exact-count concepts and Global Rhymes 4U context", () => {
  const prompt = getSpecialistInstructions("youtube");
  assert.ok(prompt.includes("exactly that number"));
  assert.ok(prompt.includes("Global Rhymes 4U"));
  assert.ok(prompt.includes("scene-by-scene visual direction"));
  assert.ok(prompt.includes("Made for Kids"));
});

test("blogging prompt prevents incorrect ASCI spelling and unsupported tax advice", () => {
  const prompt = getSpecialistInstructions("blogging");
  assert.ok(prompt.includes("ASCI (Advertising Standards Council of India)"));
  assert.ok(prompt.includes("specific ITR form"));
});

test("master checks requested deliverables beyond report structure", () => {
  const prompt = getMasterInstructions();
  assert.ok(prompt.includes("requested deliverable counts"));
  assert.ok(prompt.includes("structurally complete report is not automatically high quality"));
});

test("affiliate prompt requires usable campaign deliverables rather than generic advice", () => {
  const prompt = getSpecialistInstructions("affiliate");
  assert.match(prompt, /product-shortlist template/);
  assert.match(prompt, /comparison scorecard/);
  assert.match(prompt, /sample asset/);
  assert.match(prompt, /affiliate disclosure/);
  assert.match(prompt, /tracking plan/);
  assert.match(prompt, /first-week checklist/);
});
