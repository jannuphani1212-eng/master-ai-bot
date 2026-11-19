import test from "node:test";
import assert from "node:assert/strict";
import { parseSynthesisReuseRequest, validateSavedSpecialistReports } from "../lib/synthesis-reuse.js";

const ids = ["a","b","c","d","e"];
const rows = [
  {id:"a",agent_id:"affiliate",status:"completed",report:"Affiliate"},
  {id:"b",agent_id:"youtube",status:"completed",report:"YouTube"},
  {id:"c",agent_id:"blogging",status:"completed",report:"Blogging"},
  {id:"d",agent_id:"app-development",status:"completed",report:"App"},
  {id:"e",agent_id:"seo",status:"completed",report:"SEO"}
];

test("parses explicit saved report IDs", () => {
  assert.deepEqual(parseSynthesisReuseRequest("SYNTHESIS_ONLY_REPORT_IDS: a, b, c, d, e"), ids);
  assert.equal(parseSynthesisReuseRequest("normal task"), null);
});
test("accepts exactly five completed reports from all specialists", () => {
  assert.deepEqual(validateSavedSpecialistReports(rows, ids), rows);
});
test("rejects one report or incomplete source set", () => {
  assert.throws(() => validateSavedSpecialistReports(rows.slice(0,1), ids), /all five/i);
});
test("rejects duplicate IDs and specialist identities", () => {
  assert.throws(() => validateSavedSpecialistReports(rows, ["a","a","c","d","e"]), /five distinct/i);
  assert.throws(() => validateSavedSpecialistReports(rows.map((row,i)=>i===4?{...row,agent_id:"affiliate"}:row), ids), /one report from each/i);
});
test("rejects failed or empty saved reports", () => {
  assert.throws(() => validateSavedSpecialistReports(rows.map((row,i)=>i===0?{...row,status:"failed"}:row), ids), /completed/i);
});
