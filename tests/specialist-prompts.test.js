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
  assert.match(getSpecialistInstructions("app-development"), /Android cloud AAB workflow/);
  assert.match(getSpecialistInstructions("app-development"), /persistent signing keystore/);
  assert.match(getSpecialistInstructions("seo"), /crawlability/);
});

test("affiliate specialist supports the separate Telugu and English short-form strategy", () => {
  const prompt = getSpecialistInstructions("affiliate");
  assert.match(prompt, /Telugu \+ English/);
  assert.match(prompt, /YouTube Shorts and Instagram Reels/);
  assert.match(prompt, /above 5%/);
  assert.match(prompt, /Never invent product URLs, prices, discounts, ratings, review counts, stock, commission rates/);
  assert.match(prompt, /distinct from Global Rhymes 4U/);
});

test("SEO specialist uses only actual Search Console evidence", () => {
  const prompt = getSpecialistInstructions("seo");
  assert.match(prompt, /exact property and date range/);
  assert.match(prompt, /do not extrapolate missing rows/);
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
