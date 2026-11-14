import test from "node:test";
import assert from "node:assert/strict";
import { createBlogDraftHandlers } from "../lib/blog-drafts.js";

const ownerId = "11111111-2222-4333-8444-555555555555";
const draftId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const env = {
  SUPABASE_URL: "https://supabase.example.test",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key"
};

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return body === null ? "" : JSON.stringify(body); }
  };
}

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return value; }
  };
}

const article = {
  title: "A Helpful Guide to Budget Smartwatches",
  alternateTitles: ["Budget smartwatch buying guide"],
  slug: "budget-smartwatch-guide",
  metaTitle: "Budget Smartwatch Buying Guide",
  metaDescription: "Learn what to compare before choosing a budget smartwatch.",
  excerpt: "A practical guide for first-time buyers.",
  targetKeyword: "budget smartwatch",
  secondaryKeywords: ["smartwatch buying guide"],
  outline: ["What to compare", "Common mistakes"],
  articleMarkdown: "# Budget Smartwatch Guide\n\n" + "A practical article for buyers. ".repeat(12),
  faq: [],
  imageBrief: "A neutral product comparison image.",
  factChecksNeeded: ["Verify current prices"],
  qualityChecklist: ["Review factual claims"]
};

test("blog draft generation saves private owner-scoped SEO content", async () => {
  const originalFetch = global.fetch;
  let saved;
  let prompt = "";
  global.fetch = async (url, options = {}) => {
    assert.match(String(url), /blog_drafts\?select=/);
    assert.equal(options.method, "POST");
    saved = JSON.parse(options.body)[0];
    return response(201, [{ id: draftId, ...saved }]);
  };
  try {
    const handlers = createBlogDraftHandlers({
      env,
      generateAI: async (task, instructions) => {
        prompt = task + "\n" + instructions;
        return { result: JSON.stringify(article), provider: "Groq" };
      }
    });
    const res = mockRes();
    await handlers.generate({
      ownerUser: { id: ownerId },
      body: {
        topic: "Budget smartwatch buying guide",
        language: "English",
        audience: "Indian first-time buyers",
        targetKeyword: "budget smartwatch",
        notes: "Compare features without inventing prices."
      }
    }, res);

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.success, true);
    assert.equal(saved.owner_user_id, ownerId);
    assert.equal(saved.status, "draft");
    assert.equal(saved.generation_provider, "Groq");
    assert.deepEqual(saved.content_json, article);
    assert.match(prompt, /Do not claim live research/);
    assert.match(prompt, /factChecksNeeded/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("blog draft generation rejects invalid language before calling AI", async () => {
  const originalFetch = global.fetch;
  let called = false;
  global.fetch = async () => { throw new Error("Database must not be called"); };
  try {
    const handlers = createBlogDraftHandlers({
      env,
      generateAI: async () => { called = true; return { result: "{}", provider: "Groq" }; }
    });
    const res = mockRes();
    await handlers.generate({
      ownerUser: { id: ownerId },
      body: { topic: "A valid topic", language: "Klingon" }
    }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(called, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("blog draft list is filtered to the authenticated owner", async () => {
  const originalFetch = global.fetch;
  let requestedUrl = "";
  global.fetch = async url => {
    requestedUrl = String(url);
    return response(200, [{ id: draftId, owner_user_id: ownerId, status: "draft" }]);
  };
  try {
    const handlers = createBlogDraftHandlers({
      env,
      generateAI: async () => ({ result: "{}", provider: "Groq" })
    });
    const res = mockRes();
    await handlers.list({ ownerUser: { id: ownerId } }, res);
    assert.equal(res.body.drafts.length, 1);
    assert.match(requestedUrl, new RegExp("owner_user_id=eq\\." + ownerId));
  } finally {
    global.fetch = originalFetch;
  }
});

test("blog draft approval records a review decision without publishing", async () => {
  const originalFetch = global.fetch;
  let requestedUrl = "";
  let saved;
  global.fetch = async (url, options = {}) => {
    requestedUrl = String(url);
    saved = JSON.parse(options.body);
    return response(200, [{ id: draftId, status: saved.status, approved_at: saved.approved_at }]);
  };
  try {
    const handlers = createBlogDraftHandlers({
      env,
      generateAI: async () => ({ result: "{}", provider: "Groq" })
    });
    const res = mockRes();
    await handlers.decide({
      params: { id: draftId },
      ownerUser: { id: ownerId },
      body: { decision: "approved" }
    }, res);
    assert.equal(res.body.success, true);
    assert.equal(res.body.draft.status, "approved");
    assert.match(requestedUrl, /status=eq\.draft/);
    assert.match(requestedUrl, new RegExp("owner_user_id=eq\\." + ownerId));
    assert.match(res.body.message, /Nothing has been published/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("blog draft updates require a valid draft and preserve owner filtering", async () => {
  const originalFetch = global.fetch;
  let requestedUrl = "";
  let saved;
  global.fetch = async (url, options = {}) => {
    requestedUrl = String(url);
    saved = JSON.parse(options.body);
    return response(200, [{ id: draftId, status: "draft", content_json: saved.content_json }]);
  };
  try {
    const handlers = createBlogDraftHandlers({
      env,
      generateAI: async () => ({ result: "{}", provider: "Groq" })
    });
    const res = mockRes();
    await handlers.update({
      params: { id: draftId },
      ownerUser: { id: ownerId },
      body: { content: article }
    }, res);
    assert.equal(res.body.success, true);
    assert.equal(saved.content_json.title, article.title);
    assert.match(requestedUrl, /status=eq\.draft/);
    assert.match(requestedUrl, new RegExp("owner_user_id=eq\\." + ownerId));
  } finally {
    global.fetch = originalFetch;
  }
});
