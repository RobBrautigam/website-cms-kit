# Third-party notices

`tiptap-3.31.4.min.js` is a single minified bundle of the TipTap rich-text editor and the ProseMirror packages it is built on, made with esbuild so the static demo runs with no CDN and no build step. It exposes `window.TipTap = { Editor, generateHTML, StarterKit, Image, Placeholder }`.

Every bundled package is MIT licensed:

| Package | Version | License | Copyright |
|---|---|---|---|
| `@tiptap/core`, `@tiptap/starter-kit`, `@tiptap/extension-*`, `@tiptap/extensions`, `@tiptap/pm` | 3.31.4 | MIT | Copyright (c) 2025, Tiptap GmbH |
| `prosemirror-model`, `prosemirror-state`, `prosemirror-view`, `prosemirror-transform`, `prosemirror-commands`, `prosemirror-keymap`, `prosemirror-history`, `prosemirror-inputrules`, `prosemirror-schema-list`, `prosemirror-dropcursor`, `prosemirror-gapcursor`, `prosemirror-tables`, `prosemirror-changeset` | 1.x / 2.x | MIT | Copyright (C) 2015-2017 by Marijn Haverbeke and others |
| `orderedmap`, `rope-sequence`, `w3c-keyname` | 2.1.1, 1.3.4, 2.2.8 | MIT | Copyright (C) 2016 by Marijn Haverbeke and others |
| `linkifyjs` | 4.3.3 | MIT | Copyright (c) 2024 Nick Frasser |

## MIT License (applies to each package above, with its own copyright line)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Rebuilding the bundle

```bash
npm i @tiptap/core@3.31.4 @tiptap/starter-kit@3.31.4 @tiptap/extension-image@3.31.4 \
      @tiptap/extension-placeholder@3.31.4 @tiptap/pm@3.31.4 esbuild
# entry.js:
#   import { Editor, generateHTML } from '@tiptap/core'
#   import StarterKit from '@tiptap/starter-kit'
#   import Image from '@tiptap/extension-image'
#   import Placeholder from '@tiptap/extension-placeholder'
#   window.TipTap = { Editor, generateHTML, StarterKit, Image, Placeholder }
npx esbuild entry.js --bundle --minify --format=iife --target=es2020 --outfile=tiptap-3.31.4.min.js
```
