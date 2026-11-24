/**
 * Helpers that make it easy for an AI agent (or any script) to read and edit
 * scene data without touching editor internals.
 *
 * Everything here is pure: inputs are never mutated, and no LLM is called.
 *
 *   const summary = summarizeScene(elements);          // compact, LLM-friendly
 *   const result = applySceneEdits(elements, [         // batch of edits
 *     { op: "add", element: { type: "rectangle", x: 0, y: 0, label: { text: "Hi" } } },
 *     { op: "update", id: "abc", props: { strokeColor: "#f00" } },
 *     { op: "delete", id: "xyz" },
 *   ]);
 */
import {
  convertToExcalidrawElements,
  getCommonBounds,
  newElementWith,
} from "@excalidraw/element";

import type { ExcalidrawElementSkeleton } from "@excalidraw/element";
import type { ExcalidrawElement } from "@excalidraw/element/types";

export type SceneElementSummary = {
  id: string;
  type: ExcalidrawElement["type"];
  x: number;
  y: number;
  width: number;
  height: number;
  /** text content, for text elements */
  text?: string;
  /** id of the shape that contains this text */
  containerId?: string;
  /** id of the shape this text is labelling, resolved from the container */
  label?: string;
  /** ids of arrows connected to this shape */
  arrows?: string[];
  /** for arrows: ids of the connected shapes */
  from?: string;
  to?: string;
  groupIds?: string[];
  frameId?: string;
  strokeColor?: string;
  backgroundColor?: string;
};

export type SceneSummary = {
  elementCount: number;
  bounds: [minX: number, minY: number, maxX: number, maxY: number] | null;
  elements: SceneElementSummary[];
};

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Produces a compact, JSON-serializable overview of the scene that is cheap
 * to put into a prompt: no versions, seeds, roughness, etc. Deleted elements
 * are omitted.
 */
export const summarizeScene = (
  elements: readonly ExcalidrawElement[],
): SceneSummary => {
  const live = elements.filter((el) => !el.isDeleted);
  const byId = new Map(live.map((el) => [el.id, el]));

  const summaries = live.map((el): SceneElementSummary => {
    const s: SceneElementSummary = {
      id: el.id,
      type: el.type,
      x: round(el.x),
      y: round(el.y),
      width: round(el.width),
      height: round(el.height),
    };

    if (el.type === "text") {
      s.text = el.text;
      if (el.containerId) {
        s.containerId = el.containerId;
      }
    }

    const text = el.boundElements?.find((b) => b.type === "text");
    if (text) {
      const t = byId.get(text.id);
      if (t && t.type === "text") {
        s.label = t.text;
      }
    }

    const arrows = el.boundElements
      ?.filter((b) => b.type === "arrow" && byId.has(b.id))
      .map((b) => b.id);
    if (arrows?.length) {
      s.arrows = arrows;
    }

    if (el.type === "arrow") {
      if (el.startBinding) {
        s.from = el.startBinding.elementId;
      }
      if (el.endBinding) {
        s.to = el.endBinding.elementId;
      }
    }

    if (el.groupIds.length) {
      s.groupIds = [...el.groupIds];
    }
    if (el.frameId) {
      s.frameId = el.frameId;
    }
    if (el.strokeColor !== "transparent") {
      s.strokeColor = el.strokeColor;
    }
    if (el.backgroundColor !== "transparent") {
      s.backgroundColor = el.backgroundColor;
    }
    return s;
  });

  const bounds = live.length
    ? (getCommonBounds(live).map(round) as SceneSummary["bounds"])
    : null;

  return { elementCount: live.length, bounds, elements: summaries };
};

export type SceneQuery = {
  type?: ExcalidrawElement["type"] | ExcalidrawElement["type"][];
  /** case-insensitive substring match on text content / bound label */
  text?: string;
  groupId?: string;
  frameId?: string;
  ids?: string[];
};

/** Finds live elements matching every given criterion. */
export const queryElements = (
  elements: readonly ExcalidrawElement[],
  query: SceneQuery,
): ExcalidrawElement[] => {
  const types = query.type
    ? new Set(Array.isArray(query.type) ? query.type : [query.type])
    : null;
  const ids = query.ids ? new Set(query.ids) : null;
  const needle = query.text?.toLowerCase();
  const byId = new Map(elements.map((el) => [el.id, el]));

  return elements.filter((el) => {
    if (el.isDeleted) {
      return false;
    }
    if (types && !types.has(el.type)) {
      return false;
    }
    if (ids && !ids.has(el.id)) {
      return false;
    }
    if (query.groupId && !el.groupIds.includes(query.groupId)) {
      return false;
    }
    if (query.frameId && el.frameId !== query.frameId) {
      return false;
    }
    if (needle) {
      let haystack = el.type === "text" ? el.text : "";
      const labelRef = el.boundElements?.find((b) => b.type === "text");
      const label = labelRef && byId.get(labelRef.id);
      if (label && label.type === "text") {
        haystack += ` ${label.text}`;
      }
      if (!haystack.toLowerCase().includes(needle)) {
        return false;
      }
    }
    return true;
  });
};

export type SceneEdit =
  | {
      op: "add";
      /** same skeleton format as `convertToExcalidrawElements` */
      element: ExcalidrawElementSkeleton;
    }
  | {
      op: "update";
      id: string;
      props: Record<string, unknown>;
    }
  | {
      op: "delete";
      id: string;
    };

export type ApplySceneEditsResult = {
  elements: ExcalidrawElement[];
  /** ids of elements created by `add` edits (labels and children included) */
  added: string[];
  updated: string[];
  deleted: string[];
  /** human-readable problems, one per edit that could not be applied */
  errors: string[];
};

/** props an edit may never touch; changing them would corrupt the scene */
const PROTECTED_PROPS = new Set([
  "id",
  "type",
  "version",
  "versionNonce",
  "index",
  "seed",
]);

/**
 * Applies a batch of edits and returns a new elements array. Invalid edits
 * are skipped and reported in `errors` instead of throwing, so an agent can
 * read the feedback and retry just the failed ones.
 *
 * Deleting a shape also deletes its bound text label.
 */
export const applySceneEdits = (
  elements: readonly ExcalidrawElement[],
  edits: readonly SceneEdit[],
): ApplySceneEditsResult => {
  let next: ExcalidrawElement[] = [...elements];
  const added: string[] = [];
  const updated: string[] = [];
  const deleted: string[] = [];
  const errors: string[] = [];

  const replace = (id: string, updates: Record<string, unknown>) => {
    next = next.map((el) => (el.id === id ? newElementWith(el, updates) : el));
  };

  edits.forEach((edit, i) => {
    const where = `edit[${i}] (${edit.op})`;

    if (edit.op === "add") {
      try {
        const created = convertToExcalidrawElements([edit.element], {
          regenerateIds: false,
        });
        const clash = created.find((c) => next.some((el) => el.id === c.id));
        if (clash) {
          errors.push(`${where}: id "${clash.id}" already exists`);
          return;
        }
        next.push(...created);
        added.push(...created.map((c) => c.id));
      } catch (e) {
        errors.push(`${where}: ${e instanceof Error ? e.message : String(e)}`);
      }
      return;
    }

    const target = next.find((el) => el.id === edit.id && !el.isDeleted);
    if (!target) {
      errors.push(`${where}: no element with id "${edit.id}"`);
      return;
    }

    if (edit.op === "update") {
      const banned = Object.keys(edit.props).filter((k) =>
        PROTECTED_PROPS.has(k),
      );
      if (banned.length) {
        errors.push(`${where}: cannot change ${banned.join(", ")}`);
        return;
      }
      replace(edit.id, edit.props);
      updated.push(edit.id);
      return;
    }

    // delete (soft: the editor syncs and undoes on `isDeleted`)
    const ids = [edit.id];
    const label = target.boundElements?.find((b) => b.type === "text");
    if (label) {
      ids.push(label.id);
    }
    for (const id of ids) {
      replace(id, { isDeleted: true });
      deleted.push(id);
    }
  });

  return { elements: next, added, updated, deleted, errors };
};
