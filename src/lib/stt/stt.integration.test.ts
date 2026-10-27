/**
 * Integration tests: the real provider sending real multipart HTTP to a stand-in transcription server.
 * They prove the request shape and the factory. They say nothing about how accurate any speech model is: see
 * voice/bench for that.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createStt } from "./index";
import { listSttModels } from "./models";

let server: Server;
let url: string;
let requests: { path: string; contentType: string; body: string }[];
let reply: { status: number; json: unknown };

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      requests.push({ path: req.url ?? "", contentType: req.headers["content-type"] ?? "", body: Buffer.concat(chunks).toString("latin1") });
      res.statusCode = reply.status;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(reply.json));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());
beforeEach(() => {
  requests = [];
  reply = { status: 200, json: { text: " Send $50 to Sam. " } };
});

const clip = new Blob(["fake audio bytes"], { type: "audio/webm" });

describe("createStt", () => {
  it("posts the clip with the configured model and returns trimmed text", async () => {
    const stt = createStt({ STT_URL: url, STT_MODEL: "small.en" });
    expect(stt.name).toBe("openai-compatible:small.en");
    expect(await stt.transcribe(clip)).toBe("Send $50 to Sam.");
    const [request] = requests;
    expect(request!.path).toBe("/v1/audio/transcriptions");
    expect(request!.contentType).toContain("multipart/form-data");
    expect(request!.body).toContain("fake audio bytes");
    expect(request!.body).toContain('name="model"');
    expect(request!.body).toContain("small.en");
    expect(request!.body).toContain('name="language"');
  });

  it("switches engine by config alone", async () => {
    const qwen = createStt({ STT_URL: url, STT_MODEL: "Qwen/Qwen3-ASR-0.6B" });
    await qwen.transcribe(clip);
    expect(qwen.name).toBe("openai-compatible:Qwen/Qwen3-ASR-0.6B");
    expect(requests[0]!.body).toContain("Qwen/Qwen3-ASR-0.6B");
  });

  it("lets the customer's pick override the configured model", async () => {
    const stt = createStt({ STT_URL: url, STT_MODEL: "small.en" }, "distil-small.en");
    await stt.transcribe(clip);
    expect(stt.name).toBe("openai-compatible:distil-small.en");
    expect(requests[0]!.body).toMatch(/name="model"\r\n\r\ndistil-small\.en\r\n/);
  });

  it("rejects an unknown provider with the known names", () => {
    expect(() => createStt({ STT_PROVIDER: "nope" })).toThrow(/Unknown STT_PROVIDER "nope".*openai-compatible/);
  });

  it("throws when the server fails or sends no text", async () => {
    const stt = createStt({ STT_URL: url });
    reply = { status: 500, json: {} };
    await expect(stt.transcribe(clip)).rejects.toThrow(/500/);
    reply = { status: 200, json: { nothing: true } };
    await expect(stt.transcribe(clip)).rejects.toThrow(/no text/);
  });
});

describe("listSttModels", () => {
  it("reads the server's models, leaving out the ones that can't run, and its default", async () => {
    reply = {
      status: 200,
      json: { default: "b", data: [{ id: "a", label: "Model A" }, { id: "b" }, { id: "c", label: "C", available: false }, { nope: 1 }] },
    };
    expect(await listSttModels({ STT_URL: url })).toEqual({ default: "b", models: [{ id: "a", label: "Model A" }, { id: "b", label: "b" }] });
    expect(requests[0]!.path).toBe("/v1/models");
  });

  it("gives an empty list, not an error, when the server is down or says something else", async () => {
    reply = { status: 500, json: {} };
    expect((await listSttModels({ STT_URL: url })).models).toEqual([]);
    reply = { status: 200, json: { data: "nothing" } };
    expect((await listSttModels({ STT_URL: url })).models).toEqual([]);
    expect((await listSttModels({ STT_URL: "http://127.0.0.1:1" })).models).toEqual([]);
  });
});
