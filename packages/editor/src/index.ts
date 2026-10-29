export { textToDoc, textToNode, docToText, OffsetMap, type TextBlock, type TextRange } from "./text.js";
export {
  createDiagnosticsPlugin,
  diagnosticsPluginKey,
  withDiagnostics,
  withoutDiagnostics,
  applyFixToTransaction,
  getDiagnosticsState,
  getDiagnostics,
  findDiagnostic,
  diagnosticsAt,
  diagnosticsAtCoords,
  changedRanges,
  getLintSnapshot,
  type ChangedRange,
  type ChangedRanges,
  type DiagnosticEntry,
  type DiagnosticsPluginOptions,
  type DiagnosticsPluginState,
  type HoverContext,
  type SetDiagnosticsOptions,
} from "./plugin.js";
export { Diagnostics, PlainTextDocument, type DiagnosticsOptions, type DiagnosticsStorage } from "./extension.js";
export { confidenceLabel, renderDiagnosticDetails, type DetailsOptions } from "./details.js";
export {
  Navigation,
  nameCandidatesAt,
  scrollSelectionToCenter,
  selectionTextRange,
  textRangeSelection,
  wordRangeAt,
  type DefinitionRequest,
  type NavigationOptions,
  type NavigationStorage,
} from "./navigation.js";
export {
  Suggestions,
  getSuggestions,
  suggestionsBetween,
  suggestionsPluginKey,
  type Suggestion,
  type SuggestionLabels,
  type SuggestionsOptions,
  type TextSuggestion,
} from "./suggestions.js";
export {
  FocusMode,
  SceneMarkers,
  focusPluginKey,
  getSceneMarkers,
  isFocusMode,
  sceneMarkersPluginKey,
  type SceneMarker,
  type SceneMarkersOptions,
} from "./writing.js";
