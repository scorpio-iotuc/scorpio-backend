require("ts-node/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const NotifyClient = require("../src/jobs/notify/NotifyClient").default;
const DiscordBotClient =
  require("../src/jobs/notify/clients/DiscordBotClient").default;

test("sends webhook notifications and prefixed alerts without mentions", async (t) => {
  const requests = [];
  t.mock.method(global, "fetch", async (url, options) => {
    requests.push({ url, ...options });
    return { ok: true };
  });
  const client = new NotifyClient("discord-bot", {
    webhookUrl: "https://discord.com/api/webhooks/123/test-token",
  });
  await client.notify("Import completed @everyone");
  await client.alert("Import failed");
  assert.equal(
    requests[0].url,
    "https://discord.com/api/webhooks/123/test-token",
  );
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].headers.Authorization, undefined);
  assert.deepEqual(JSON.parse(requests[0].body), {
    content: "Import completed @everyone",
    allowed_mentions: { parse: [] },
  });
  assert.equal(
    JSON.parse(requests[1].body).content,
    "(@here)🚨: Import failed",
  );
});

test("rejects missing webhook configuration", () => {
  assert.throws(() => new DiscordBotClient(""), /DISCORD_WEBHOOK_URL/);
});

test("propagates HTTP and network failures to callers", async (t) => {
  const client = new NotifyClient("discord-bot", {
    webhookUrl: "https://discord.com/api/webhooks/123/test-token",
  });
  const mock = t.mock.method(global, "fetch", async () => ({
    ok: false,
    status: 429,
  }));
  await assert.rejects(client.notify("hello"), /HTTP 429/);
  mock.mock.mockImplementation(async () => {
    throw new Error("network unavailable");
  });
  await assert.rejects(client.alert("hello"), /network unavailable/);
});

test("validates message length before making a request, including alert prefix", async (t) => {
  const mock = t.mock.method(global, "fetch", async () => ({ ok: true }));
  const client = new DiscordBotClient(
    "https://discord.com/api/webhooks/123/test-token",
  );
  await assert.rejects(client.notify(" "), /between 1 and 2000/);
  await assert.rejects(client.notify("a".repeat(2001)), /between 1 and 2000/);
  await assert.rejects(client.alert("a".repeat(1998)), /between 1 and 2000/);
  assert.equal(mock.mock.callCount(), 0);
  await client.notify("a".repeat(2000));
  assert.equal(mock.mock.callCount(), 1);
});
