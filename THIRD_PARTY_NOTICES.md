# Third-party notices

## DM Sans

The variable DM Sans font is bundled locally as `web/fonts/dm-sans.ttf`, from the [Google Fonts DM Sans source](https://github.com/google/fonts/tree/main/ofl/dmsans). Its SIL Open Font License is preserved at `web/fonts/OFL.txt`.

## PDF.js

PDF.js 5.6.205 browser module and worker are bundled locally at `web/vendor/`, copied from the Codex bundled dependency runtime. Upstream: [Mozilla PDF.js](https://github.com/mozilla/pdf.js). The Apache 2.0 license is preserved at `web/vendor/PDFJS-LICENSE.txt`. The app extracts selectable PDF text; it does not render or execute embedded document scripts.

## Playwright

Playwright 1.62.1 is a development dependency for browser verification. It uses the installed Microsoft Edge channel in this project. It is not shipped to the application frontend.

## PyMuPDF

PyMuPDF 1.27.2.2 is installed in the isolated local `.ocr-venv` for CPU PDF extraction and page rendering. Its installed package metadata identifies dual licensing: GNU Affero GPL 3.0 or Artifex Commercial License. Upstream: [PyMuPDF](https://github.com/pymupdf/PyMuPDF). It is used by the local fallback worker, not bundled into the browser.

## Unlimited-OCR — prepared integration

The optional adapter targets [Baidu Unlimited-OCR](https://huggingface.co/baidu/Unlimited-OCR), revision `8249d20b2822a7d8a4c22c8d8c9069b5ac36bda3`, labelled MIT by the publisher. The model weights are not installed and GPU inference remains paused/unvalidated at the 0.10 CPU checkpoint. Downloading the model later preserves its upstream LICENSE in the local model folder. The adapter uses the upstream text-return path without drawing/postprocessing output.
