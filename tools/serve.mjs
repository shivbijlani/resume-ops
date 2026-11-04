import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";

const types = {".html": "text/html", ".css": "text/css", ".js": "text/javascript",
  ".svg": "image/svg+xml", ".mmd": "text/plain"};
const assets = ["index.html", "dashboard.css", "local-loader.css", "view.js",
  "local-loader.js", "workflow.svg", "workflow.mmd", ".nojekyll"];
const port = Number(process.env.PORT || 4177);
createServer(async (request, response) => {
  const pathname = new URL(request.url, `http://127.0.0.1:${port}`).pathname;
  const name = pathname === "/" ? "index.html" : pathname.slice(1);
  if (!assets.includes(name)) {
    response.writeHead(404).end("Not found");
    return;
  }
  try {
    const body = await readFile(resolve("dist", name));
    const extension = name.slice(name.lastIndexOf("."));
    response.writeHead(200, {"Content-Type": types[extension] || "application/octet-stream"});
    response.end(body);
  } catch (error) {
    console.error(`Could not serve ${name}: ${error.message}`);
    response.writeHead(500).end("Build the public site before previewing it.");
  }
}).listen(port, "127.0.0.1", () => console.log(`Public preview: http://127.0.0.1:${port}`));
