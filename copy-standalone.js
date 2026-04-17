const fs = require("fs");
const path = require("path");

const standalone = path.join(__dirname, ".next", "standalone");
const staticSrc = path.join(__dirname, ".next", "static");
const publicSrc = path.join(__dirname, "public");

function copyRecursiveSync(src, dest) {
  if (!fs.existsSync(src)) return;
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyRecursiveSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

copyRecursiveSync(staticSrc, path.join(standalone, ".next", "static"));
copyRecursiveSync(publicSrc, path.join(standalone, "public"));

console.log("Copied .next/static and public into standalone");
