import { readFile } from "fs/promises";
import { join } from "path";
import { PageContext } from "ginny";
import { marked } from "marked";
import { mangle } from "marked-mangle";
import { gfmHeadingId } from "marked-gfm-heading-id";

marked.use(mangle());
marked.use(gfmHeadingId());

marked.use({
  renderer: {
    image: (href, title, text) => {
      if (!title) {
        return `<a href="${href}"><img src="${href}" alt="${text}"></a>`;
      }

      return `<figure>
        <a href="${href}"><img src="${href}" alt="${text}"></a>
        <figcaption>${marked.parseInline(title)}</figcaption>
      </figure>`;
    },

    code: (code, language) => {
      if (language === "mermaid") {
        return '<pre class="mermaid">' + code + '</pre>';
      } else {
        return '<pre><code>' + code + '</code></pre>';
      }
    }
  },
});

export default async (props: MdBookProperties) => {
  const styleFilename = join(__dirname, "./style.css");
  props.context.addDependency(styleFilename);

  const style = await readFile(styleFilename, { encoding: "utf-8" });
  const index = await extractIndex(props.index, props.context);

  const content = (
    await Promise.all(
      index.files.map(async (file) => {
        const filepath = props.context.resolve(
          file + (file.endsWith(".md") ? "" : ".md")
        );
        const content = await readFile(filepath, { encoding: "utf-8" });
        props.context.addDependency(filepath);

        return content;
      })
    )
  ).join("\n\n");

  const headingTracker = new HeadingTracker();
  let hasMermaid = false;

  const html = marked(content, {
    walkTokens: async (token) => {
      if (token.type === "heading") {
        headingTracker.push(new Heading(token.text, token.depth));
      } else if (token.type === "code" && token.lang === "mermaid") {
        hasMermaid = true;
      }
    },
  });

  const headings = headingTracker.root.children;

  const dateFormatter = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const mermaidFilename = join(__dirname, "./mermaid.min.js");
  const mermaidjs = hasMermaid ? await readFile(mermaidFilename, { encoding: "utf-8" }) : null;

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no"
        />
        <title>{index.title}</title>
        <style>{style}</style>
        {mermaidjs ? <script type="text/javascript">{mermaidjs}</script> : null}
        {props.context.isDevelopment ? (
          <script
            type="text/javascript"
            src="https://livejs.com/live.js"
          ></script>
        ) : null}
      </head>
      <body>
        {mermaidjs ? <script type="text/javascript">mermaid.initialize({`{theme: "neutral"}`});</script> : null}
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
          <ol>{headings.map((heading, i) => heading.render("", i))}</ol>
        </div>
      </body>
    </html>
  );
};

async function extractIndex(
  index: string | MdBookIndex | undefined,
  context: PageContext
): Promise<MdBookIndex> {
  if (typeof index === "string") {
    return extractIndexFromFile([index], context);
  }

  if (index == null) {
    return extractIndexFromFile(["README.md", "index.md"], context);
  }

  return index;
}

async function extractIndexFromFile(
  tryFiles: string[],
  context: PageContext
): Promise<MdBookIndex> {
  for (const file of tryFiles) {
    try {
      const filepath = context.resolve(file);
      const content = await readFile(filepath, {
        encoding: "utf-8",
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
    } catch {}
  }

  throw new Error(
    `Could not find index file from candidates: ${tryFiles.join(", ")}`
  );
}

class Heading {
  id: string;
  children: Heading[] = [];

  constructor(readonly title: string, readonly depth: number) {
    this.id = title.toLowerCase().replace(/[^\w]+/g, "-");
  }

  render(prefix: string, index: number): any {
    const numbering = prefix ? `${prefix}.${index + 1}` : `${index + 1}`;

    return (
      <li>
        <a href={`#${this.id}`}>
          {numbering}. {this.title}
        </a>
        {this.children.length ? (
          <ol>{this.children.map((child, i) => child.render(numbering, i))}</ol>
        ) : null}
      </li>
    );
  }
}

class HeadingTracker {
  private parents: Heading[] = [new Heading("root", 0)];
  private ids = new Set<string>();

  get root(): Heading {
    return this.parents[0];
  }

  push(heading: Heading): void {
    if (heading.depth > 3) {
      return;
    }

    this.makeUniqueId(heading);

    while (
      this.parents.length > 0 &&
      this.parents[this.parents.length - 1].depth >= heading.depth
    ) {
      this.parents.pop();
    }

    if (this.parents.length > 0) {
      this.parents[this.parents.length - 1].children.push(heading);
    }

    this.parents.push(heading);
  }

  private makeUniqueId(heading: Heading): void {
    let id = heading.id;
    let i = 1;

    while (this.ids.has(id)) {
      id = `${heading.id}-${i++}`;
    }

    heading.id = id;
    this.ids.add(id);
  }
}

/**
 * MdBook properties.
 */
export interface MdBookProperties {
  /** The ginny page context (automatically injected by ginny). */
  context: PageContext;

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
