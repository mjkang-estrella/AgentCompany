import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(join(appDir, relativePath), "utf8");

test("web app manifest is valid and points at existing icons", () => {
  const manifest = JSON.parse(read("manifest.webmanifest"));

  assert.equal(manifest.name, "Reader");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 2);

  for (const icon of manifest.icons) {
    assert.ok(icon.src.startsWith("/"), `icon src should be absolute: ${icon.src}`);
    assert.ok(existsSync(join(appDir, icon.src.slice(1))), `missing icon ${icon.src}`);
    assert.match(icon.sizes, /^\d+x\d+$/u);
  }

  assert.ok(manifest.icons.some((icon) => icon.sizes === "512x512" && icon.purpose === "maskable"));
});

test("index.html declares home-screen app metadata", () => {
  const html = read("index.html");

  assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest">/u);
  assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes">/u);
  assert.match(html, /<meta name="apple-mobile-web-app-title" content="Reader">/u);
  assert.match(html, /<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">/u);
  assert.match(html, /<meta name="viewport" content="[^"]*viewport-fit=cover[^"]*">/u);
  assert.match(html, /<meta name="theme-color"/u);

  const touchIcon = html.match(/<link rel="apple-touch-icon" href="([^"]+)">/u);
  assert.ok(touchIcon, "apple-touch-icon link missing");
  assert.ok(existsSync(join(appDir, touchIcon[1].slice(1))), `missing ${touchIcon[1]}`);
});

test("service worker shell list only references files that exist", () => {
  const source = read("sw.js");
  const shell = source.match(/const SHELL_URLS = (\[[^\]]+\]);/u);
  assert.ok(shell, "SHELL_URLS not found");

  for (const url of JSON.parse(shell[1])) {
    const relativePath = url === "/" ? "index.html" : url.slice(1);
    assert.ok(existsSync(join(appDir, relativePath)), `missing shell asset ${url}`);
  }
});

test("service worker never caches API responses", () => {
  const source = read("sw.js");
  assert.match(source, /startsWith\("\/api\/"\)/u);
});

test("phone reading screen uses a list icon, not a third chevron, to reopen the list", () => {
  const icons = read("icons.js");
  const app = read("app.js");

  assert.match(icons, /export const listIconHtml = renderHugeIcon\(Menu01Icon/u);
  assert.match(app, /setTrustedHtml\(elements\.paneBackButton, listIconHtml\)/u);
  assert.doesNotMatch(app, /setTrustedHtml\(elements\.paneBackButton, previousIconHtml\)/u);
});

test("bottom safe-area inset only applies when Reader runs as a home-screen app", () => {
  const css = read("styles.css");

  // Browser tabs already cover the home indicator with their own toolbar, so
  // the inset must be zero there and only come from env() in standalone mode.
  assert.match(css, /:root\s*\{\s*--safe-area-bottom: 0px;\s*\}/u);
  assert.match(
    css,
    /@media \(display-mode: standalone\), \(display-mode: fullscreen\)\s*\{\s*:root\s*\{\s*--safe-area-bottom: env\(safe-area-inset-bottom\);/u
  );
  assert.doesNotMatch(css.replace(/--safe-area-bottom: env\(safe-area-inset-bottom\);/u, ""), /env\(safe-area-inset-bottom\)/u);
  assert.match(css, /padding: 6px 8px max\(6px, var\(--safe-area-bottom\)\);/u);
});
