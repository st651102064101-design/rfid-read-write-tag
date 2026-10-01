import { readFile, writeFile } from "node:fs/promises";
const root = new URL("../", import.meta.url);
const html = await readFile(new URL("public/index.html", root), "utf8");
const css = await readFile(new URL("public/style.css", root), "utf8");
const js = await readFile(new URL("public/app.js", root), "utf8");
const page = html.replace('<link rel="stylesheet" href="style.css">', `<style>${css}</style>`)
  .replace('<script src="app.js"></script>', `<script>${js}</script>`);
const template = await readFile(new URL("worker/entry-template.js", root), "utf8");
await writeFile(new URL("worker/index.js", root), template.replace("__PAGE__", JSON.stringify(page)));
console.log("Built Worker with the existing USER tag writer and /rfid/events endpoint");
