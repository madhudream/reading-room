# Reading Room for Chrome

Read on the original site and still keep the time. On any article in your [Reading Room](https://reading.carebun.com)
list, a small pill appears in the corner:

- **Start reading**: the timer runs only while that tab is focused, and stops after 5 minutes without a key or a scroll.
- **Digest**: for long posts. The timer keeps counting while you step away to think it over, even with the tab in
  the background, and stops by itself after 30 minutes.
- **Pause**: stops the timer.
- **I've finished**: shows this visit's split ("18:02 reading + 7:10 digesting"), lets you correct the minutes,
  logs them, and opens the quiz and recall in the Reading Room.

A started article resumes by itself when you come back to it. The toolbar button shows today's reading, whether
this page is in your list, and **Add & start reading** for any page that is not (it goes on the *Saved from the
web* shelf).

## Privacy

The extension downloads your list of URLs and matches pages **on your computer**. It never sends the addresses of
pages you visit; it only talks to the Reading Room about articles already in your list (time, finish) or a page you
ask it to add. Changing your password signs it out.

## Install

1. [Download the zip](https://reading.carebun.com/reading-room-extension.zip) and unzip it (or use this folder).
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. **Load unpacked** → choose the folder.
4. Pin it, click it, sign in with your Reading Room username and password.

Works in Chrome, Edge, Brave and Arc. The server defaults to `https://reading.carebun.com`; for your own copy,
open the popup's **Server** field before signing in (and add its origin to `host_permissions` in `manifest.json`).

## Files

`manifest.json` (Manifest V3) · `background.js` (sign-in token, the URL list, API calls) · `content.js` (the pill,
in a shadow root so no page can restyle it) · `popup.html/js/css` · `icons/` (drawn by `../scripts/ext-icons.ts`).
