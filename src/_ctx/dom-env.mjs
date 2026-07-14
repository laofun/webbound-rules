// Install a node DOM (linkedom) so the DOM-based utils and `$` from
// scriptable-context.mjs run outside a browser. Import this FIRST (before
// building ctx) in any test that touches qs/qsa/text/html/attr/remove/
// decodeEntities/$ or a parser's `new DOMParser()`. Pure-string tests
// (cleanText/sanitize/formatParagraphs/resolveUrl) do not need it.
import { DOMParser, parseHTML } from 'linkedom';

const { document } = parseHTML('<!DOCTYPE html><html><head></head><body></body></html>');
globalThis.document = document;
globalThis.DOMParser = DOMParser;
