# AI Assistant native bridge

The Android WebView loads `https://repairplanet.net/ai-assistant`. Talk to that page through `window.TSP` and the events below. Do not patch `fetch`, type into the textarea, or click the Send button — those break when the page changes.

The page installs these `window.TSP` methods and leaves any other fields (including `isVoiceSpeaking`) in place.

No SQL. No production config change.

## Methods

| Method | Direction | Behavior |
| --- | --- | --- |
| `TSP.setVoiceMode(on)` | native → web | Session flag, default **off**, not persisted. A reload starts off. Call `setVoiceMode(false)` when leaving voice. |
| `TSP.getVoiceMode()` | native → web | Returns the current boolean. |
| `TSP.askAssistant(text)` | native → web | Submits `text` through the page's own send path. Returns `true` when the send starts. Returns `false` when the page is not signed in yet, a send is already in flight, or `text` is blank. |
| `TSP.openCitation(manualId, page)` | native → web | Opens the secure viewer at that page. Access-checked. Does not emit `assistant:citation-open`. |
| `TSP.isVoiceSpeaking()` | native owns this | Optional. Return `true` while TTS is playing. The page only reads it. |

While voice mode is on, the page sets `voiceMode: true` on its own `grok-assistant` chat request. The manual viewer panel does not.

`setVoiceMode` also dispatches `assistant:voice-mode`. The page listens for that event too, so either call works:

```js
window.TSP.setVoiceMode(true);
// or, same flag, no second event:
window.dispatchEvent(new CustomEvent('assistant:voice-mode', { detail: { on: true } }));
```

`on` must be a boolean. The flag is not written to `localStorage` or `tsp_settings`.

## Events

| Event | Direction | Detail | When |
| --- | --- | --- | --- |
| `assistant:voice-mode` | both | `{ on: boolean }` | After `setVoiceMode`, or native → web to set the flag. A listener must not call `setVoiceMode` in response to the page's own event (the page ignores an echo of the current value). |
| `assistant:answer` | web → native | `{ ts, text, citations, top, voiceMode }` | Once, when a **fresh** answer has settled. Not while streaming, not on history restore, not on a later re-render. |
| `assistant:voice-state` | native → web | `{ speaking: boolean }` | When TTS starts and when it ends. This is what releases a deferred auto-open. |
| `assistant:citation-open` | web → native | `{ manualId, page }` | Only when the page itself auto-opens. Not for chips, history, a refused access check, or an inbound open. |
| `assistant:open-citation` | native → web | `{ manualId, page }` | Same as `TSP.openCitation`. |

`assistant:answer` detail:

```js
window.addEventListener('assistant:answer', (event) => {
  const { ts, text, citations, top, voiceMode } = event.detail;
  // ts: number — the answer's timestamp; also the once-per-answer key
  // text: string — plain speech text; citation tokens and light markdown removed
  // citations: { manualId: number, page: number }[] — every physical page, chip order
  // top: { manualId: number, page: number } | null — the only page that may auto-open
  // voiceMode: boolean — the flag at settle time
});
```

`top` is the first citation only when that citation has a manual id and a physical page. A later chip is not promoted. `citations` can still list later pages when `top` is null.

```js
window.addEventListener('assistant:citation-open', (event) => {
  const { manualId, page } = event.detail; // numbers, both >= 1
});
```

That detail is exactly `{ manualId, page }`. It has no URL, storage path, or PDF bytes.

## Voice turn order

1. `TSP.setVoiceMode(true)`.
2. `TSP.askAssistant(transcript)`. If it returns `false`, the page was not ready or a send was already running — retry `askAssistant` after the page has signed in; do not click Send.
3. The page posts `grok-assistant` with `voiceMode: true`.
4. When the reply settles, the page dispatches `assistant:answer` **before** it decides whether to auto-open.
5. From that `assistant:answer` listener, synchronously dispatch `assistant:voice-state` with `{ speaking: true }` if TTS is starting (and/or make `TSP.isVoiceSpeaking()` return `true`). The page then waits.
6. Speak `event.detail.text`.
7. When playback ends, dispatch `assistant:voice-state` with `{ speaking: false }`, make `isVoiceSpeaking()` return `false`, and **remove** `document.documentElement.dataset.assistantVoice` (do not leave it as `"speaking"`).
8. If the user has not opened or dismissed the viewer, the page auto-opens `top` and dispatches `assistant:citation-open`.

Auto-open re-evaluates when `assistant:voice-state` fires (and when `speechSynthesis` ends). Flipping `dataset.assistantVoice` alone does not. On the `speaking: false` transition, clear the dataset attribute. If it stays `"speaking"`, a later read still looks busy and the manual never opens.

Call `TSP.setVoiceMode(false)` when the shell leaves voice mode so the next typed question is a normal text request.

## Auto-open

Setting **Auto-open cited manual page**, default **ON**.

| Store | Key | Values |
| --- | --- | --- |
| localStorage | `autoOpenCitedManual` | `"true"` or `"false"`. Missing means ON. |
| localStorage JSON blob `tsp_settings` | `autoOpenCitedManual` | boolean. Same blob as Zapp voice prefs. |

The dedicated key wins when it is set. The Settings page and the assistant toggle write both.

When the setting is off, citations stay ordinary links. Nothing opens by itself.

- Only the **first in-range citation of the open manual**, and only with a manual id ≥ 1 and a physical page ≥ 1. A cite for a different manual stays a chip and does not auto-open. A page flagged `page_out_of_range` (marker `oor=1`) does not auto-open and does not scroll; the viewer shows “Page N isn't in this PDF”. A later chip is not promoted when the first remaining cite is section-only or page-less.
- Once per fresh answer, after it has been committed.
- Not on history restore, conversation reload, or a later re-render.
- Not when the signed-in user cannot view that manual. The chip stays a normal link. The panel is not mounted, so restricted PDF bytes are not requested.
- Access matches AI cite reads: a service-company member may view a `shared/` catalog manual without a library slot. Any other manual opens only when it is already in the company library. An id that is not in the loaded catalog is not opened.

Wide web (viewport ≥ 1024px and not the Android shell): side panel. Escape closes it. Focus moves to **Close**.

Mobile web and the Android WebView (`TSPAndroid` in the user agent, or `window.Android`): full screen. **Back to answer** restores the thread scroll position and moves focus to the answer thread (`tabindex="-1"`), not the page body.

If the requested page is past the end of that PDF, or the citation has `page_out_of_range` / `oor=1`, the viewer does not jump to that page. It shows “Page N isn't in this PDF”. A page that exists in the file, and is not flagged, still opens on that page (`/manuals/view?id=&page=`).

A passage attributed to a different catalog row is a chip labeled “From: {that manual's title}, p. {page}”. The link opens that manual. It is not renamed to the manual that was open in the assistant.

Other chips stay links. With the setting on, a primary click jumps the open viewer to that manual and page.

## Cancelling a held auto-open

If voice playback is still going, auto-open stays pending. These mark that answer done so a later `{ speaking: false }` does not open the viewer again:

- `TSP.openCitation` or `assistant:open-citation` actually opens a manual (a refused access check does not cancel the hold).
- **Back to answer**, **Close**, or Escape on the panel.

```js
window.TSP.openCitation(105, 42);
// or
window.dispatchEvent(new CustomEvent('assistant:open-citation', {
  detail: { manualId: 105, page: 42 }
}));
```

`manualId` and `page` may be numbers or numeric strings. Invalid values are ignored.

## Still speaking

Any one of these means playback is active when the page evaluates auto-open:

- `window.TSP.isVoiceSpeaking()` returns `true`
- `window.speechSynthesis.speaking` is `true`
- `document.documentElement.dataset.assistantVoice === "speaking"`

```js
window.dispatchEvent(new CustomEvent('assistant:voice-state', {
  detail: { speaking: false }
}));
```

`speaking` must be a boolean. Dispatch this event on both edges. Clearing the dataset without the event does not release the hold.
