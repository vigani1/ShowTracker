import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const distDir = process.env.WEB_EXPORT_DIR
  ? isAbsolute(process.env.WEB_EXPORT_DIR)
    ? process.env.WEB_EXPORT_DIR
    : join(projectRoot, process.env.WEB_EXPORT_DIR)
  : join(projectRoot, "dist");
const indexPath = join(distDir, "index.html");
const manifestPath = join(distDir, "manifest.json");
const iconPath = join(distDir, "assets", "icon.png");

const headTags = `
    <meta name="theme-color" content="#0b0f1a" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-title" content="ShowTracker" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <link rel="manifest" href="/manifest.json" />
    <link rel="apple-touch-icon" href="/assets/icon.png" />`;

const manifest = {
  name: "ShowTracker",
  short_name: "ShowTracker",
  description: "Track shows, anime, and movies across web and mobile.",
  start_url: "/home",
  scope: "/",
  display: "standalone",
  background_color: "#0b0f1a",
  theme_color: "#0b0f1a",
  orientation: "portrait",
  icons: [
    {
      src: "/assets/icon.png",
      sizes: "1024x1024",
      type: "image/png",
      purpose: "any maskable",
    },
  ],
};

let html = await readFile(indexPath, "utf8");

html = html.replace(
  /<meta name="viewport"[^>]*>/,
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />'
);

for (const pattern of [
  /\s*<meta name="theme-color"[^>]*>/g,
  /\s*<meta name="mobile-web-app-capable"[^>]*>/g,
  /\s*<meta name="apple-mobile-web-app-capable"[^>]*>/g,
  /\s*<meta name="apple-mobile-web-app-title"[^>]*>/g,
  /\s*<meta name="apple-mobile-web-app-status-bar-style"[^>]*>/g,
  /\s*<link rel="manifest"[^>]*>/g,
  /\s*<link rel="apple-touch-icon"[^>]*>/g,
]) {
  html = html.replace(pattern, "");
}

html = html.replace("</head>", `${headTags}\n  </head>`);

await mkdir(dirname(iconPath), { recursive: true });
await copyFile(join(projectRoot, "assets", "icon.png"), iconPath);
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(indexPath, html);

console.log("Patched web export with iOS PWA metadata.");
