import assert from "node:assert/strict";
import test from "node:test";
import { assertLoopback, localTransport } from "./local.ts";

test("local transport only accepts loopback endpoints", () => {
  assert.doesNotThrow(() => assertLoopback("http://127.0.0.1:8089"));
  assert.doesNotThrow(() => assertLoopback("http://localhost:1234"));
  for (const u of ["https://api.example.com", "http://192.168.1.5:8089", "http://10.0.0.2", "http://127.0.0.1.evil.example"]) assert.throws(() => localTransport({ baseUrl: u }), /loopback/, u);
});
