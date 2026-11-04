import {copyFile, mkdir, readFile, readdir, writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {chromium} from "@playwright/test";

const assets = ["index.html", "dashboard.css", "local-loader.css", "view.js",
  "local-loader.js", "workflow.svg", "workflow.mmd", ".nojekyll"];
const source = await readFile("workflow.mmd", "utf8");
const config = JSON.parse(await readFile(new URL("mermaid.json", import.meta.url), "utf8"));
const browser = await chromium.launch();
let svg;
try {
  const page = await browser.newPage();
  await page.setContent("<!doctype html><html><body></body></html>");
  await page.addScriptTag({path: resolve("node_modules", "mermaid", "dist", "mermaid.min.js")});
  svg = await page.evaluate(async ({source, config}) => {
    window.mermaid.initialize({...config, startOnLoad: false, securityLevel: "strict",
      deterministicIds: true, deterministicIDSeed: "public-opportunity-workflow"});
    const svg = (await window.mermaid.render("workflow", source)).svg;
    const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
    if (parsed.querySelector("parsererror,script,foreignObject")) throw new Error("Workflow must be a valid, passive SVG");
    const [, , width, height] = parsed.documentElement.getAttribute("viewBox").split(/\s+/);
    parsed.documentElement.setAttribute("width", width);
    parsed.documentElement.setAttribute("height", height);
    return new XMLSerializer().serializeToString(parsed.documentElement);
  }, {source, config});
} finally {
  await browser.close();
}
await mkdir("dist", {recursive: true});
const unexpected = (await readdir("dist")).filter(name => !assets.includes(name));
if (unexpected.length) throw new Error(`Refusing mixed deployment: ${unexpected.join(", ")}`);
for (const name of assets) {
  if (name === "workflow.svg") await writeFile(resolve("dist", name), svg + "\n");
  else await copyFile(name, resolve("dist", name));
}
if (process.argv.includes("--update-svg")) await writeFile("workflow.svg", svg + "\n");
console.log(`Built ${assets.length} public, data-free assets.`);
