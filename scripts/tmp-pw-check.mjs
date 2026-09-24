import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
for (const name of ["playwright", "playwright-core", "puppeteer"]) {
  try {
    req.resolve(name);
    console.log(name + ": OK");
  } catch {
    console.log(name + ": missing");
  }
}
