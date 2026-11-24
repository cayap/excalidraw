import {
  applySceneEdits,
  queryElements,
  summarizeScene,
} from "../src/ai-scene";

describe("ai-scene helpers", () => {
  const base = applySceneEdits(
    [],
    [
      {
        op: "add",
        element: {
          type: "rectangle",
          id: "box",
          x: 10,
          y: 20,
          width: 200,
          height: 100,
          label: { text: "Server" },
        },
      },
      {
        op: "add",
        element: { type: "text", id: "note", x: 0, y: 0, text: "hello" },
      },
    ],
  );

  it("adds elements and reports ids", () => {
    expect(base.errors).toEqual([]);
    expect(base.added).toContain("box");
    expect(base.added).toContain("note");
    expect(base.elements.length).toBe(base.added.length);
  });

  it("summarizes the scene compactly with labels", () => {
    const s = summarizeScene(base.elements);
    expect(s.elementCount).toBe(3);
    expect(s.elements.find((e) => e.id === "box")?.label).toBe("Server");
    expect(s.elements[0]).not.toHaveProperty("seed");
  });

  it("queries by text and type", () => {
    expect(
      queryElements(base.elements, { text: "server" }).map((e) => e.id),
    ).toContain("box");
    expect(
      queryElements(base.elements, { type: "text", text: "hello" }),
    ).toHaveLength(1);
  });

  it("updates, rejects protected props, and reports unknown ids", () => {
    const r = applySceneEdits(base.elements, [
      { op: "update", id: "box", props: { strokeColor: "#ff0000" } },
      { op: "update", id: "box", props: { id: "other" } },
      { op: "update", id: "missing", props: {} },
    ]);
    expect(r.updated).toEqual(["box"]);
    expect(r.errors).toHaveLength(2);
    expect(r.elements.find((e) => e.id === "box")?.strokeColor).toBe("#ff0000");
  });

  it("deletes a shape together with its label, without mutating input", () => {
    const r = applySceneEdits(base.elements, [{ op: "delete", id: "box" }]);
    expect(r.deleted).toHaveLength(2);
    expect(summarizeScene(r.elements).elementCount).toBe(1);
    expect(summarizeScene(base.elements).elementCount).toBe(3);
  });

  it("rejects duplicate ids", () => {
    const r = applySceneEdits(base.elements, [
      { op: "add", element: { type: "rectangle", id: "box", x: 0, y: 0 } },
    ]);
    expect(r.errors[0]).toMatch(/already exists/);
  });
});
