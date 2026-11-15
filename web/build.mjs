// Builds a single self-contained HTML page for hosting as a Claude artifact.
// Usage: node web/build.mjs  → web/dist/index.html
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const r = await build({
  entryPoints: ["web/main.tsx"],
  bundle: true, minify: true, write: false, format: "iife", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"', "process.env.SOCRATA_APP_TOKEN": "undefined" },
});
const js = r.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const css = readFileSync("app/globals.css", "utf8");
mkdirSync("web/dist", { recursive: true });
writeFileSync("web/dist/index.html", `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Is my apartment rent stabilized?</title>
<meta name="description" content="A free, guided check of NYC public records, with letters to find out for sure. Not legal advice.">
<style>${css}</style></head>
<body><div id="root"></div><script>${js}</script></body></html>`);
console.log("wrote web/dist/index.html", Math.round(readFileSync("web/dist/index.html").length / 1024), "KB");
