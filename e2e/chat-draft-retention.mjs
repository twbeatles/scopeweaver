import { request } from "playwright";
import { writeFile } from "node:fs/promises";
import { en } from "../web/src/i18n/messages/interface.ts";
import { waitChatState } from "./chat-controls.mjs";

async function bounded(promise, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), 5000);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

async function attachDocument(page, input, name) {
  await input.evaluate((element, name) => {
    const clipboardData = new DataTransfer();
    clipboardData.items.add(new File(["retained document"], name, { type: "text/plain" }));
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  }, name);
  await page.getByRole("button", { name, exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector("[data-attachment-id] .animate-spin"));
}

async function captureSelectedLoading(page, name) {
  const dir = process.env.SCOPEWEAVER_E2E_ARTIFACTS;
  if (!dir) return;
  await writeFile(`${dir}/${name}.html`, await page.content(), { mode: 0o600 });
  await page.screenshot({ path: `${dir}/${name}.png` });
}

// Hold an actual successful list response; the optional first failure exercises
// the existing poll retry without manufacturing conversation data.
async function holdConversationList(page, failFirst = false) {
  let releaseGate, resolveHeld;
  let released = false;
  const gate = new Promise(resolve => { releaseGate = resolve; });
  const held = new Promise(resolve => { resolveHeld = resolve; });
  await page.route(url => url.pathname === "/api/conversations", async route => {
    if (route.request().method() !== "GET") return route.continue();
    if (failFirst) {
      failFirst = false;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "List unavailable fixture" }) });
      return;
    }
    const response = await route.fetch();
    const body = await response.json();
    resolveHeld({ status: response.status(), ids: body.conversations.map(item => item.id) });
    if (!released) await gate;
    await route.fulfill({ response });
  });
  return { held, release: () => { released = true; releaseGate(); } };
}

async function runSelectedConversationLoadingChecks({ base, token, fixture, step, check, openPage }, api) {
  const calls = await fixture.calls();
  for (const { width, failFirst } of [{ width: 1440, failFirst: false }, { width: 390, failFirst: false }, { width: 1440, failFirst: true }]) {
    const created = await api.post("/api/conversations", { data: { agent_key: "auto", title: "Selected conversation loading" } });
    check(created.ok(), await created.text());
    const conversation = await created.json();
    const page = await openPage("en", token);
    await page.setViewportSize({ width, height: 900 });
    const list = await holdConversationList(page, failFirst);
    let releaseControls, resolveControls;
    const controlsGate = new Promise(resolve => { releaseControls = resolve; });
    const controlsSeen = new Promise(resolve => { resolveControls = resolve; });
    const controlsPath = `/api/conversations/${conversation.id}/controls`;
    await page.route(url => url.pathname === controlsPath, async route => {
      if (route.request().method() !== "GET") return route.continue();
      resolveControls();
      await controlsGate;
      await route.continue();
    });
    try {
      await step(`[en/${width}/standalone] selected conversation blocks fallback input during ${failFirst ? "list retry" : "list loading"}`, async () => {
        await page.goto(`${base}/chat?c=${conversation.id}`);
        const held = await bounded(list.held, "real conversation list response");
        check(held.status === 200 && held.ids.includes(conversation.id), "held list does not contain the requested real conversation");
        await page.getByRole("status").filter({ hasText: en.m0129 }).waitFor();
        check(await page.locator("textarea[data-chat-draft]").count() === 0, "requested conversation exposes a fallback composer before its list resolves");
        await captureSelectedLoading(page, `selected-loading-${width}-${failFirst ? "retry" : "initial"}`);
        const delivered = page.waitForResponse(response => new URL(response.url()).pathname === "/api/conversations" && response.ok());
        list.release();
        await delivered;
        const input = page.locator(`textarea[data-chat-draft="chat:conv-${conversation.id}"]`);
        await input.waitFor();
        await bounded(controlsSeen, "initial controls GET");
        const original = await input.elementHandle();
        const text = "draft survives mounted controls hydration";
        await input.fill(text);
        check(await page.locator("[data-chat-queue]").count() === 0, "initial controls response escaped its gate");
        releaseControls();
        await page.locator("[data-chat-queue]").waitFor();
        check(await input.evaluate((node, previous) => node === previous, original), "controls hydration replaced the mounted conversation input");
        check(await input.inputValue() === text, "controls hydration lost the existing-conversation draft");
        check(!await input.isDisabled(), "hydrated conversation composer is disabled");
        check(await page.getByRole("button", { name: en.m0073, exact: true }).isEnabled(), "hydrated conversation cannot send its draft");
        await input.press("End");
        await input.press("!");
        check(await input.inputValue() === `${text}!`, "conversation composer cannot accept keyboard input after hydration");
        await captureSelectedLoading(page, `selected-composer-${width}-${failFirst ? "retry" : "initial"}`);
      });
    } finally {
      list.release();
      releaseControls();
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await page.context().close();
      check((await api.delete(`/api/conversations/${conversation.id}`)).ok(), "selected loading conversation cleanup failed");
    }
  }

  for (const { name, query, loading, missing } of [
    { name: "new chat", query: "", loading: false, missing: false },
    { name: "invalid selection", query: "?c=not-a-number", loading: false, missing: false },
    { name: "missing selection", query: "?c=2147483647", loading: true, missing: false },
    { name: "missing approval source", query: "?c=2147483647&approval=fixture", loading: true, missing: true },
  ]) {
    const page = await openPage("en", token);
    await page.setViewportSize({ width: 1440, height: 900 });
    const list = await holdConversationList(page);
    try {
      await step(`[en/1440/standalone] ${name} preserves its initial composer policy`, async () => {
        await page.goto(`${base}/chat${query}`);
        const held = await bounded(list.held, "fallback-policy conversation list");
        check(held.status === 200 && held.ids.length === 0, "fallback-policy fixture must use the real empty conversation list");
        const input = page.locator('textarea[data-chat-draft="chat:draft"]');
        const text = `${name} draft`;
        if (loading) {
          await page.getByRole("status").filter({ hasText: en.m0129 }).waitFor();
          check(await page.locator("textarea[data-chat-draft]").count() === 0, "pending requested selection exposes a new-chat composer");
        } else {
          await input.fill(text);
        }
        const delivered = page.waitForResponse(response => new URL(response.url()).pathname === "/api/conversations" && response.ok());
        list.release();
        await delivered;
        if (missing) {
          await page.getByRole("status").filter({ hasText: en.m0128 }).waitFor();
          check(await page.locator("textarea[data-chat-draft]").count() === 0, "missing approval source became an editable new chat");
        } else {
          await input.waitFor();
          if (loading) await input.fill(text);
          check(await input.inputValue() === text && !await input.isDisabled(), "new-chat fallback lost its independent editable draft");
        }
      });
    } finally {
      list.release();
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await page.context().close();
    }
  }
  check(await fixture.calls() === calls, "conversation loading checks called the model provider");
}

export async function runChatDraftRetentionChecks({ base, token, fixture, step, check, openPage }) {
  const api = await request.newContext({ baseURL: base, timeout: 5000, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
  try {
    await runSelectedConversationLoadingChecks({ base, token, fixture, step, check, openPage }, api);
    const created = await api.post("/api/tasks", { data: { description: "Segment draft retention", goal: "Keep idle", seed_first_intent: false } });
    check(created.ok(), await created.text());
    const task = await created.json();
    const taskPage = await openPage("en", token);
    await taskPage.setViewportSize({ width: 1440, height: 900 });
    try {
      check((await api.post(`/api/tasks/${task.id}/control`, { data: { action: "pause" } })).ok(), "draft fixture pause failed");
      await step("[en/1440/task] segment zero retains draft and attachment after creating another session", async () => {
        await taskPage.goto(`${base}/function/tasks/detail?id=${task.id}`);
        const input = taskPage.locator("textarea[data-chat-draft]").first();
        await input.fill("segment zero draft");
        await attachDocument(taskPage, input, "segment-zero.txt");
        const originalKey = await input.getAttribute("data-chat-draft");
        await taskPage.getByRole("button", { name: en.m0727, exact: true }).click();
        await taskPage.getByRole("alertdialog").getByRole("button", { name: en.m0778, exact: true }).click();
        await taskPage.waitForFunction((key) => document.querySelector("textarea[data-chat-draft]")?.dataset.chatDraft !== key, originalKey);
        await input.fill("segment one draft");
        const sessions = taskPage.locator("#session-list-panel");
        await sessions.getByRole("button", { name: en.m0697.replace("{p0}", "1"), exact: true }).click();
        check(await input.getAttribute("data-chat-draft") === originalKey, "segment zero's draft key changed when the current segment advanced");
        check(await input.inputValue() === "segment zero draft", "segment zero's unsent text was lost");
        await taskPage.getByRole("button", { name: "segment-zero.txt", exact: true }).waitFor();
        await sessions.getByRole("button", { name: en.m0697.replace("{p0}", "2"), exact: true }).click();
        check(await input.inputValue() === "segment one draft", "switching back lost segment one's separate draft");
        check(await taskPage.locator("[data-attachment-id]").count() === 0, "segment zero's attachment leaked into segment one");
      });
    } finally {
      await taskPage.context().close();
      const deleted = await api.delete(`/api/tasks/${task.id}`, { data: { delete_files: true } });
      check(deleted.ok(), `draft fixture cleanup ${deleted.status()}`);
    }

    for (const mode of ["queue", "steer"]) {
      for (const outcome of ["success", "failure"]) {
        const created = await api.post("/api/conversations", { data: { agent_key: "auto", title: `Pending ${mode} ${outcome}` } });
        check(created.ok(), await created.text());
        const conversation = await created.json();
        const path = `/api/conversations/${conversation.id}/controls`;
        const page = await openPage("en", token);
        await page.setViewportSize({ width: 1440, height: 900 });
        let release;
        const barrier = new Promise(resolve => { release = resolve; });
        let routeTask = Promise.resolve();
        let phase = "open conversation";
        let routeFailure;
        page.on("request", request => {
          if (request.method() === "POST" && new URL(request.url()).pathname.includes("/controls/inputs")) {
            console.log(`REQUEST pending ${mode} ${outcome}: ${request.url()} mode=${request.postDataJSON().mode}`);
          }
        });
        try {
          await step(`[en/1440/standalone] pending ${mode} ${outcome} protects composer and payload`, async () => {
            console.log(`START pending ${mode} ${outcome}`);
            await page.goto(`${base}/chat?c=${conversation.id}`);
            const input = page.locator(`textarea[data-chat-draft="chat:conv-${conversation.id}"]`);
            await input.waitFor();
            await page.locator("[data-chat-queue]").waitFor();
            phase = "start held run";
            await fixture.holdNext();
            await input.fill("hold the active run");
            await page.getByRole("button", { name: en.m0073, exact: true }).click();
            await waitChatState(api, path, state => !!state.active);
            phase = "pause follow-ups";
            // Keep accepted follow-ups queued when the held model is released.
            const state = await (await api.get(path)).json();
            check((await api.post(`${path}/pause`, { data: { expected_revision: state.revision } })).ok(), "pending fixture queue pause failed");
            const submit = page.getByRole("button", { name: mode === "queue" ? en.chatQueue : en.chatSteer, exact: true });
            await submit.waitFor();
            const text = `${mode} original ${outcome}`;
            await input.fill(text);
            if (mode === "queue") await attachDocument(page, input, "pending-document.txt");
            let enter;
            const entered = new Promise(resolve => { enter = resolve; });
            let posted;
            await page.route(url => url.pathname === `${path}/inputs`, async route => {
              posted = route.request().postDataJSON();
              enter();
              routeTask = (async () => {
                const response = outcome === "success" ? await route.fetch({ timeout: 5000 }) : null;
                await bounded(barrier, "admission response release");
                if (response) await route.fulfill({ response });
                else await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Admission unavailable fixture" }) });
              })().catch(async error => {
                routeFailure = error;
                console.error(`Pending ${mode} ${outcome} route failed: ${error.stack}`);
                await route.abort("failed").catch(() => {});
              });
              await routeTask;
            });
            phase = "intercept admission";
            await Promise.all([
              page.waitForRequest(request => new URL(request.url()).pathname === `${path}/inputs` && request.method() === "POST", { timeout: 5000 }),
              submit.click({ timeout: 5000 }),
            ]);
            await bounded(entered, "admission route interception");
            phase = "assert pending composer";
            check(await input.isDisabled(), "pending admission leaves the standalone composer editable");
            check(await input.inputValue() === text, "pending admission changed the original draft");
            check(posted.mode === mode && posted.message === text, "admission payload differs from the original draft");
            check(posted.attachments.length === (mode === "queue" ? 1 : 0), "admission attachment payload changed");
            const responseReady = page.waitForResponse(response => new URL(response.url()).pathname === `${path}/inputs` && response.request().method() === "POST", { timeout: 5000 });
            phase = "release admission response";
            release();
            await responseReady;
            check(!routeFailure, `admission route failed: ${routeFailure?.message}`);
            await page.waitForFunction(() => !document.querySelector("textarea[data-chat-draft]")?.disabled);
            const after = await (await api.get(path)).json();
            const accepted = after.inputs.filter(item => item.client_request_id === posted.client_request_id);
            if (outcome === "success") {
              check(await input.inputValue() === "", "accepted draft was not cleared");
              check(await page.locator("[data-attachment-id]").count() === 0, "accepted attachments remain in the composer");
              check(accepted.length === 1 && accepted[0].prompt.text === text, "admission did not retain exactly one original prompt");
              check(accepted[0].prompt.attachments.length === (mode === "queue" ? 1 : 0), "accepted prompt lost its attachment");
            } else {
              check(await input.inputValue() === text, "failed admission lost the original draft");
              check(await page.locator("[data-attachment-id]").count() === (mode === "queue" ? 1 : 0), "failed admission lost its attachment");
              check(accepted.length === 0, "rejected response unexpectedly admitted a prompt");
            }
          });
        } finally {
          console.log(`CLEANUP pending ${mode} ${outcome} after ${phase}`);
          release();
          await bounded(routeTask, "admission route cleanup");
          await page.unrouteAll({ behavior: "ignoreErrors" });
          await api.post(`/api/conversations/${conversation.id}/stop`);
          await fixture.release();
          await waitChatState(api, path, state => !state.active);
          await page.context().close();
          check((await api.delete(`/api/conversations/${conversation.id}`)).ok(), "pending conversation cleanup failed");
        }
      }
    }
  } finally {
    await api.dispose();
  }
}
