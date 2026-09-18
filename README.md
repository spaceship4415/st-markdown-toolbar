# Markdown Toolbar

A row of one-tap formatting buttons right above the SillyTavern input box.
Wrap the selection in `**bold**`, turn the current line into a `> quote`, or open a fresh `---` line — without reaching for the symbols.

## Features

- **Five buttons out of the box** — dialogue `"`, action `*`, emphasis `**`, strikethrough `~~`, OOC `> `.
- **Three insert modes** per button:
  - *around the selection* — paired symbols like `"` or `**`; press again to undo. With nothing selected, the word under the cursor is wrapped.
  - *at the start of this line* — `> `, `- `, `# `; press again to undo
  - *at the start of a new line* — OOC notes, `---` scene breaks
- **Icons chosen for you** — type a symbol and a matching Font Awesome icon is suggested. Pick a different one from the built-in icon picker, or show an emoji or a short label instead.
- **Reaches the message you are editing** — the buttons act on whichever box your cursor was last in, so they work while you rewrite a reply, not just in the input line.
- **Live preview** — every row shows what you will get, with `|` marking where the cursor lands.
- **Drag to reorder**, toggle a button off without deleting it, and fold extra buttons into a `...` menu to keep the toolbar short.
- **Localized** — English by default, Korean included.

## Install

1. Open **Extensions** (the puzzle icon) in SillyTavern.
2. Click **Install Extension**.
3. Paste this repository's URL and press **Install**.

## Settings

Extensions → **Markdown Toolbar**.

| Setting | What it does |
| --- | --- |
| Enable markdown toolbar | Shows or hides the whole toolbar |
| Buttons shown in the toolbar | `0` shows them all; otherwise the rest move into a `...` menu |
| Buttons | Add, edit, reorder, disable or delete individual buttons |

Open a row to set its **name** (the tooltip), **icon or custom label**, **insert mode** and **symbols**.
A button with no symbols does nothing, so it is marked in the list and left out of the toolbar.

## Translating

Drop a `<locale>.json` next to `i18n/ko-kr.json` — keys are the English strings — and add the locale id to `i18n/locales.json`.

## Notes

- Custom labels are plain text. Emoji and short labels render as typed; markup never does. The extension renders no HTML from its settings, so a shared button set cannot run scripts or pull in remote images.
- Settings live in SillyTavern's own settings file, so they follow your profile.

## Custom CSS

The toolbar reads a handful of custom properties, so most tweaks are one line in
**User Settings → Custom CSS** — no need to fight the extension's own rules.

On a touch device the buttons grow to roughly the size of SillyTavern's own
buttons, so they are not the smallest thing on the screen to hit. Three of the
properties below have a second default for that case; setting them yourself
overrides both.

```css
:root {
    --qsg-toolbar-justify: flex-start;  /* line the buttons up on the left */
    --qsg-toolbar-gap: 10px;
    --qsg-button-max-width: 90px;
    --qsg-icon-size: 20px;
}
```

| Property | Default | Notes |
| --- | --- | --- |
| `--qsg-toolbar-order` | `20` | `#send_form` stacks its rows by `order`; the input row is `25`, so `30` moves the toolbar below it |
| `--qsg-toolbar-justify` | `center` | Any `justify-content` value |
| `--qsg-toolbar-gap` | `6px`, `8px` on touch | Space between buttons |
| `--qsg-toolbar-padding` | `0 10px` | |
| `--qsg-toolbar-margin` | `0 0 3px`, `0 0 5px` on touch | Gap to the input row below |
| `--qsg-button-padding` | `3px 8px`, `9px 10px` on touch | What makes the button a comfortable size to tap |
| `--qsg-button-min-width` | icon size + 18px | Keeps icon buttons an even width |
| `--qsg-button-max-width` | `140px` | Keeps a long label from eating the row |
| `--qsg-overflow-max-width` | `min(90vw, 320px)` | Where the `...` menu starts wrapping to a second row |
| `--qsg-icon-size` | `16px` | Size of the icon inside a button, and what `--qsg-button-min-width` is measured from |

For anything the properties do not cover, these hooks are stable:

| Selector | What it is |
| --- | --- |
| `#custom-md-toolbar` | The toolbar row |
| `#custom-md-toolbar button` | Every toolbar button |
| `.qsg-overflow-wrapper` / `.qsg-overflow-trigger` / `.qsg-overflow-menu` | The `...` menu and its popup |
| `#custom_md_buttons_container` | The settings block in the Extensions panel |
| `.custom-md-settings` | The settings body |
| `.qsg-item` / `.qsg-item-head` / `.qsg-item-detail` | One button's row, its summary line, its expanded panel |
| `.qsg-item-disabled` / `.qsg-item-blank` | A button that is turned off / has no symbols |

Buttons are plain `<button class="menu_button text_button">`, so they inherit your
theme. To style one specific button, match it on its name:

```css
#custom-md-toolbar button[title="OOC / Quote"] {
    color: var(--SmartThemeQuoteColor);
}
```

## License

MIT — see [LICENSE](LICENSE).
