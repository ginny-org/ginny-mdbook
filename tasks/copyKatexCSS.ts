import { readFileSync } from "fs";
import { readFile, writeFile } from "fs/promises";
import * as postcss from "postcss";

async function run(): Promise<void> {
  const katexCSS = await readFile("node_modules/katex/dist/katex.min.css", "utf-8");
  const inlined = inlineFonts(katexCSS);
  await writeFile(`${__dirname}/../lib/katex.css`, inlined, "utf-8");
}

function inlineFonts(css: string): string {
  const parsed = postcss.parse(css);
  const urlRegex = /url\((.*\.woff2)\)/;

  parsed.walkAtRules("font-face", (rule) => {
    rule.walkDecls(/.*/, (decl) => {
      if (decl.prop !== "src") {
        return;
      }

      const parts = decl.value.split(",");
      const woff2 = parts.find((value) => urlRegex.test(value));
      const match = woff2?.match(urlRegex);

      if (!match) {
        throw new Error(`Expected woff2 font, but none found in ${decl.value}`);
      }

      const buffer = readFileSync(`node_modules/katex/dist/${match[1]}`);
      const dataUrl = `url(data:font/woff2;base64,${buffer.toString("base64")})`;

      decl.value = `${dataUrl} format("woff2")`;
    });
  });

  return parsed.toString();
}

run();
