import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { httpRequest } from "@/packages/http";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise((resolve) => server.close(resolve)))
  );
});

const listen = async () => {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.statusCode = req.url === "/missing" ? 404 : 200;
      res.end(JSON.stringify({ method: req.method, url: req.url, body }));
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("the test server has no port");
  }
  return `http://127.0.0.1:${address.port}`;
};

describe("httpRequest", () => {
  it("sends the request and answers with the response", async () => {
    const base = await listen();
    const response = await httpRequest(`${base}/echo`, {
      method: "POST",
      body: "hello",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      method: "POST",
      url: "/echo",
      body: "hello",
    });
  });

  it("resolves with an error status rather than throwing", async () => {
    const base = await listen();
    const response = await httpRequest(new URL("/missing", base));
    expect(response.status).toBe(404);
  });
});
