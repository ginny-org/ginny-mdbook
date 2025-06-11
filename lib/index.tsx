import { readFile } from "fs/promises";
import { join } from "path";
import { ContentContext, FileResultJSX } from "ginny";
import { marked } from "marked";
import * as katex from "katex";
import postcss from "postcss";
import * as cssnano from "cssnano";

type Purgecss = typeof import("@fullhuman/postcss-purgecss").default;

const mathMagicPrefix = "__math__:";
const mathMagicSuffix = ":__math__";

const macros = {
  "\\label": "\\htmlId{#1}{\\tag{#1}}"
};

const icons = {
  note: `<svg class="note" viewBox="0 0 16 16" version="1.1" width="16" height="16" aria-hidden="true"><path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"></path></svg>`,
  important: `<svg class="important" viewBox="0 0 16 16" version="1.1" width="16" height="16" aria-hidden="true"><path d="M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v9.5A1.75 1.75 0 0 1 14.25 13H8.06l-2.573 2.573A1.458 1.458 0 0 1 3 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25Zm1.75-.25a.25.25 0 0 0-.25.25v9.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h6.5a.25.25 0 0 0 .25-.25v-9.5a.25.25 0 0 0-.25-.25Zm7 2.25v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"></path></svg>`,
  warning: `<svg class="warning" viewBox="0 0 16 16" version="1.1" width="16" height="16" aria-hidden="true"><path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"></path></svg>`
};

let headingTracker: HeadingTracker;

marked.use({
  renderer: {
    heading({ text, depth }) {
      const heading = headingTracker.push(text, depth);

      return `<h${depth} id="${heading.id}">${text}<a class="header-link" href="#${heading.id}">🔗</a></h${depth}>\n`;
    }
  }
});

marked.use({
  tokenizer: {
    codespan(src) {
      const match = src.match(/^([`$]+)([^`$]|[^`$][\s\S]*?[^`$])\1(?![`$])/);

      if (!match) {
        return false;
      }

      const raw = match[0];
      const text = match[2].trim();
      const isMath = raw[0] === "$";

      return {
        type: "codespan",
        raw,
        text: isMath ? `${mathMagicPrefix}${text}${mathMagicSuffix}` : text
      };
    },

    inlineText(src) {
      const cap = src.match(/^([`$]+|[^`$])(?:[\s\S]*?(?:(?=[\\<![`$*]|\b_|$)|[^ ](?= {2,}\n))|(?= {2,}\n))/);

      if (!cap) {
        return false;
      }

      const raw = cap[0];

      return {
        type: "text",
        raw,
        text: raw
      };
    }
  }
});

const renderer = new marked.Renderer();

marked.use({
  renderer: {
    image: ({ href, title, text }) => {
      if (!title) {
        return `<p class="image-container"><a href="${href}"><img src="${href}" alt="${text}"></a></p>`;
      }

      return `<figure class="image-container">
        <a href="${href}"><img src="${href}" alt="${text}"></a>
        <figcaption>${marked.parseInline(title)}</figcaption>
      </figure>`;
    },

    link(token) {
      token.href = token.href?.replace(/^\.\/(.*\.md)(#.*)$/, "$2") ?? null;
      return renderer.link(token);
    },

    codespan: ({ text }) => {
      if (text.startsWith(mathMagicPrefix) && text.endsWith(mathMagicSuffix)) {
        return katex.renderToString(text.slice(mathMagicPrefix.length, -mathMagicSuffix.length), {
          throwOnError: false,
          strict: "ignore",
          macros,
          trust: true
        });
      }

      return `<code>${text}</code>`;
    },

    blockquote: ({ text }) => {
      const alert = text.match(/^<p>\[!(NOTE|IMPORTANT|WARNING)\]([\s\S]*)<\/p>$/m);
      const type = alert?.[1]?.toLowerCase();

      if (alert && isAlertType(type)) {
        const typeTitle = type[0].toUpperCase() + type.slice(1);

        return `
        <div class="alert ${type}">
          <p>
            <span class="alert-title">${icons[type]} ${typeTitle}</span>
            <br>
            ${alert[2]}
          </p>
        </div>`;
      }

      return `<blockquote>${text}</blockquote>`;
    },

    code: ({ text, lang }) => {
      if (lang === "mermaid") {
        return '<pre class="mermaid">' + text + "</pre>";
      } else if (lang === "math") {
        return katex.renderToString(text, {
          macros,
          strict: "ignore",
          displayMode: true,
          throwOnError: false,
          trust: true
        });
      } else {
        return "<pre><code>" + text + "</code></pre>";
      }
    }
  }
});

/**
 * The MdBook component renders markdown files in a single page book format.
 */
export default async (props: MdBookProperties): Promise<FileResultJSX> => {
  const styleFilename = join(__dirname, "./style.css");
  props.context.addDependency(styleFilename);

  const style = await readFile(styleFilename, { encoding: "utf-8" });
  const index = await extractIndex(props.index, props.context);

  const content = (
    await Promise.all(
      index.files.map(async (file) => {
        const filepath = props.context.resolve(file + (file.endsWith(".md") ? "" : ".md"));

        const content = await readFile(filepath, { encoding: "utf-8" });
        props.context.addDependency(filepath);

        return content;
      })
    )
  ).join("\n\n");

  let hasMermaid = false;
  let hasKatex = false;

  headingTracker = new HeadingTracker();

  const html = marked(content, {
    walkTokens: async (token) => {
      if (token.type === "code") {
        if (token.lang === "mermaid") {
          hasMermaid = true;
        }

        if (token.lang === "math") {
          hasKatex = true;
        }
      } else if (token.type === "codespan" && token.raw[0] === "$") {
        hasKatex = true;
      }
    }
  });

  const headings = headingTracker.root.children;

  const dateFormatter = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric"
  });

  const mermaidFilename = join(__dirname, "./mermaid.min.js");
  const mermaidjs = hasMermaid ? await readFile(mermaidFilename, "utf-8") : null;

  const katexCSSFilename = join(__dirname, "./katex.css");
  const katexcss = hasKatex ? await readFile(katexCSSFilename, "utf-8") : null;

  const rendered = (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <title>{index.title}</title>
        <style></style>
        {mermaidjs ? <script type="text/javascript">{mermaidjs}</script> : null}
        {props.context.isWatch ? <script type="text/javascript" src="https://livejs.com/live.js"></script> : null}
      </head>
      <body>
        {mermaidjs ? (
          <script type="text/javascript">
            const isDarkMode = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches; const
            theme = isDarkMode ? "dark" : "neutral"; mermaid.initialize({`{theme}`});
          </script>
        ) : null}
        <main className="content">
          <div className="content__inner">
            <div className="book-title">{index.title}</div>
            {html}
          </div>
        </main>
        <div className="header">
          <div className="title">{index.title}</div>
          <div className="date">{dateFormatter.format()}</div>
        </div>
        <div className="menu">
          <ol>{headings.map((heading, i) => heading.renderToc("", i))}</ol>
        </div>
      </body>
    </html>
  );

  return {
    filename: "index.html",
    content: {
      node: rendered,
      postprocess: (html) => postProcessHTML(html, style, katexcss)
    }
  };
};

async function postProcessHTML(html: string, style: string, katexcss: string | null): Promise<string> {
  const fullStyle = katexcss ? style + katexcss : style;

  const purgecss = (await import("@fullhuman/postcss-purgecss")) as unknown as Purgecss;

  const result = await postcss([purgecss({ content: [{ raw: html, extension: "html" }] }), cssnano()]).process(
    fullStyle,
    { from: undefined }
  );

  const css = removeUnusedKatexFontfaces(result.css, katexcss !== null);

  return html.replace("<style></style>", `<style>${css}</style>`);
}

// Remove unused font faces. PurgeCSS doesn't do this correctly for katex fonts by itself
function removeUnusedKatexFontfaces(css: string, hasKatex: boolean): string {
  if (!hasKatex) {
    return css;
  }

  // First remove all the font faces, then add them back by dumbly checking if the font name
  // appears anywhere literal in the css.
  const parsed = postcss.parse(css);
  const fontFaces: postcss.AtRule[] = [];

  parsed.walkAtRules("font-face", (atRule) => {
    fontFaces.push(atRule);
    atRule.remove();
  });

  const withoutFontFaces = parsed.toString();
  const usedFontFaces = new Set<postcss.AtRule>();

  for (const fontFace of fontFaces) {
    fontFace.walkDecls("font-family", (decl) => {
      const fontName = decl.value.replace(/^"(.*)"$/, "$1");

      if (withoutFontFaces.includes(fontName)) {
        usedFontFaces.add(fontFace);
      }
    });
  }

  for (const fontFace of usedFontFaces) {
    parsed.prepend(fontFace);
  }

  return parsed.toString();
}

async function extractIndex(index: string | MdBookIndex | undefined, context: ContentContext): Promise<MdBookIndex> {
  if (typeof index === "string") {
    return extractIndexFromFile([index], context);
  }

  if (index == null) {
    return extractIndexFromFile(["README.md", "index.md"], context);
  }

  return index;
}

async function extractIndexFromFile(tryFiles: string[], context: ContentContext): Promise<MdBookIndex> {
  for (const file of tryFiles) {
    try {
      const filepath = context.resolve(file);
      const content = await readFile(filepath, {
        encoding: "utf-8"
      });

      context.addDependency(filepath);
      const lexed = marked.Lexer.lex(content);

      const index: MdBookIndex = { title: "", files: [] };

      marked.walkTokens(lexed, (token) => {
        if (token.type === "heading" && token.depth === 1) {
          index.title = token.text;
          return;
        }

        if (token.type === "link" && token.href.endsWith(".md")) {
          index.files.push(context.resolve(token.href));
        }
      });

      return index;
    } catch {
      // ignore, most likely file does not exist
    }
  }

  throw new Error(`Could not find index file from candidates: ${tryFiles.join(", ")}`);
}

class Heading {
  children: Heading[] = [];

  constructor(
    readonly id: string,
    readonly title: string,
    readonly level: number
  ) {}

  renderToc(prefix: string, index: number, maxLevel = 3) {
    const numbering = prefix ? `${prefix}.${index + 1}` : `${index + 1}`;

    return (
      <li>
        <a href={`#${this.id}`}>
          {numbering}. {this.title}
        </a>
        {this.children.length && this.level < maxLevel ? (
          <ol>{this.children.map((child, i) => child.renderToc(numbering, i))}</ol>
        ) : null}
      </li>
    );
  }
}

class HeadingTracker {
  private parents: Heading[] = [new Heading("root", "root", 0)];
  private ids = new Set<string>();

  get root(): Heading {
    return this.parents[0];
  }

  push(title: string, level: number): Heading {
    const id = this.addUniqueId(title.toLowerCase().replace(/[^\w]+/g, "-"));
    const heading = new Heading(id, title, level);

    while (this.parents.length > 0 && this.parents[this.parents.length - 1].level >= heading.level) {
      this.parents.pop();
    }

    if (this.parents.length > 0) {
      this.parents[this.parents.length - 1].children.push(heading);
    }

    this.parents.push(heading);
    return heading;
  }

  private addUniqueId(id: string): string {
    let i = 1;
    let uniqueId = id;

    while (this.ids.has(uniqueId)) {
      uniqueId = `${id}-${i++}`;
    }

    this.ids.add(uniqueId);
    return uniqueId;
  }
}

type AlertType = "note" | "important" | "warning";

function isAlertType(type: string | undefined): type is AlertType {
  switch (type) {
    case "note":
    case "important":
    case "warning":
      return true;
  }

  return false;
}

/**
 * MdBook properties.
 */
export interface MdBookProperties {
  /** The ginny page context (automatically injected by ginny). */
  context: ContentContext;

  /**
   * Index of the book. This can either:
   *
   * - be a string, referencing a markdown file. In this case the title of the book comes from the
   *   level 1 header of the referenced file. Any links to markdowns become individual chapters of
   *   the book.
   * - be an MdBookIndex object, where title and list of chapter markdown files is explicitly given.
   *
   * By default this will read the book index from a README.md file in the same location as the tsx
   * file including the <MdBook/> tag.
   */
  index?: string | MdBookIndex;
}

/**
 * An explicit book index definition providing a title and files for the book contents.
 */
export interface MdBookIndex {
  /** The title of the book. */
  title: string;

  /** Files that make up the chapters of the book. */
  files: string[];
}
