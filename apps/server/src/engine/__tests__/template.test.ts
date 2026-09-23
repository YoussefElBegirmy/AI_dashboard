import { describe, expect, it } from "vitest";
import { extractPath, lookup, render, renderDeep, tryParseJson } from "../template";

const ctx = { input: { q: "hi", n: 3, obj: { a: [1, 2] } }, secrets: { KEY: "sk" }, steps: { first: { output: "done" } } };

describe("template", () => {
  it("looks up dotted and indexed paths", () => {
    expect(lookup(ctx, "input.obj.a[1]")).toBe(2);
    expect(lookup(ctx, "input.missing.x")).toBeUndefined();
  });

  it("renders strings, stringifying objects and blanking missing values", () => {
    expect(render("Q: {{ input.q }} / {{input.obj}} / {{nope}}", ctx)).toBe('Q: hi / {"a":[1,2]} / ');
    expect(render("Bearer {{secrets.KEY}}", ctx)).toBe("Bearer sk");
  });

  it("renderDeep keeps types for exact placeholders", () => {
    expect(renderDeep({ n: "{{input.n}}", o: "{{input.obj}}", s: "x {{input.n}}", arr: ["{{steps.first.output}}"] }, ctx)).toEqual({
      n: 3,
      o: { a: [1, 2] },
      s: "x 3",
      arr: ["done"],
    });
  });

  it("extracts JSONPath and parses fenced JSON", () => {
    expect(extractPath({ choices: [{ message: { content: "yo" } }] }, "$.choices[0].message.content")).toBe("yo");
    expect(extractPath({ a: 1 }, "")).toEqual({ a: 1 });
    expect(tryParseJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(tryParseJson("plain text")).toBeUndefined();
  });
});
