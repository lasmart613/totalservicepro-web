# AI Assistant — auto-open cited manual page

When a fresh assistant answer cites a manual page, the web app opens that page in the existing secure viewer (`/manuals/view?id=<manualId>&page=<page>`, added in PR #134). The viewer still loads bytes through `get-manual-url` / `/api/manuals/file` with `ai_context: true`. No storage URL is given to the page.

This is the contract the Android shell integrates against. The WebView already loads `https://repairplanet.net/ai-assistant`.

## Setting

**Auto-open cited manual page**, default **ON**.

| Store | Key | Values |
| --- | --- | --- |
| localStorage | `autoOpenCitedManual` | `"true"` or `"false"`. Missing means ON. |
| localStorage JSON blob `tsp_settings` | `autoOpenCitedManual` | boolean. Same blob as Zapp voice prefs. |

The dedicated key wins when it is set. The Settings page and the assistant toggle write both. No SQL and no production config change.

When the setting is off, citations stay ordinary links to `/manuals/view?...`. Nothing opens by itself.

## When it opens

- Only the **first** citation on that answer, and only if it has a manual id ≥ 1 and a physical page ≥ 1.
- Once per fresh answer, after the answer has been committed (not while a reply is still streaming).
- Not on history restore, conversation reload, or a later re-render of the same answer.
- Not when the signed-in user cannot view that manual. The chip stays a normal link. The panel is not mounted, so restricted PDF bytes are not requested.
- Access uses the same rule as AI cite reads: a service-company member may view a `shared/` catalog manual without a library slot. Any other manual is opened only when it is already in the company library. A manual id that is not in the loaded catalog is not auto-opened.

## Layout

- **Desktop / wide web** (viewport ≥ 1024px and not the Android shell): side panel next to the answer. Escape closes it. Focus moves to **Close**.
- **Mobile web** and the **Android WebView** (`TSPAndroid` in the user agent, or `window.Android`): full screen after the answer has painted. **Back to answer** returns to the thread and keeps its scroll position. Focus moves to that button.

Other citation chips stay links. With the setting on, a primary click jumps the open viewer to that manual and page (or opens it). Modified clicks still follow the href.

## Voice

The website assistant does not speak. Auto-open waits while a shell reports that voice playback is active, then opens when it goes idle.

Any one of these means “still speaking”:

- `window.TSP.isVoiceSpeaking()` returns `true`
- `window.speechSynthesis.speaking` is `true`
- `document.documentElement.dataset.assistantVoice === "speaking"`

The shell should also dispatch this when playback starts and when it ends (the end event is what releases a deferred open):

```js
window.dispatchEvent(new CustomEvent('assistant:voice-state', {
  detail: { speaking: false }
}));
```

## Events

### Web → native (auto-open only)

Dispatched on `window` when the web app itself auto-opens a page. Not dispatched for history, chip taps, a refused access check, or an inbound request (so a native listener must not call `openCitation` in response — that would loop).

```js
window.addEventListener('assistant:citation-open', (event) => {
  const { manualId, page } = event.detail;
  // manualId: number >= 1
  // page: number >= 1 (physical PDF page)
});
```

`event.detail` is exactly `{ manualId, page }`. It does not include a URL, storage path, or PDF bytes.

### Native → web

Opens the same panel / full-screen viewer. Ignored when `manualId` or `page` is missing or invalid, and when the user cannot view that manual. The auto-open setting is not consulted: the shell asked explicitly. This does **not** emit `assistant:citation-open`.

```js
window.TSP.openCitation(105, 42);
```

or

```js
window.dispatchEvent(new CustomEvent('assistant:open-citation', {
  detail: { manualId: 105, page: 42 }
}));
```

The page installs `window.TSP.openCitation` and leaves any other `window.TSP` fields in place. `manualId` and `page` may be numbers.
