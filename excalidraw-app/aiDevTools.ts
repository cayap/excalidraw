import {
  applySceneEdits,
  queryElements,
  summarizeScene,
} from "@excalidraw/utils";
import { CaptureUpdateAction } from "@excalidraw/element";

import type { SceneEdit, SceneQuery } from "@excalidraw/utils";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

/**
 * Dev-only: exposes `window.aiScene` so scene edits can be tried from the
 * browser console against the live editor.
 */
export const installAiDevTools = (api: ExcalidrawImperativeAPI) => {
  const tools = {
    summarize: () => summarizeScene(api.getSceneElements()),
    query: (q: SceneQuery) =>
      queryElements(api.getSceneElements(), q).map((el) => el.id),
    apply: (edits: SceneEdit[]) => {
      const result = applySceneEdits(
        api.getSceneElementsIncludingDeleted(),
        edits,
      );
      api.updateScene({
        elements: result.elements,
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
      const { elements: _elements, ...report } = result;
      return report;
    },
  };
  (window as any).aiScene = tools;
  return () => {
    delete (window as any).aiScene;
  };
};
