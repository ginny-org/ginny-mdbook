import { readFile } from "fs/promises";
import { join } from "path";
import { PageContext } from "ginny";
import { marked } from "marked";

export default async (props: MdBookProperties) => {
  const styleFilename = join(__dirname, "./style.css");
  props.context.addDependency(styleFilename);

  const style = await readFile(styleFilename, { encoding: "utf-8" });

  const content = (
    await Promise.all(
      props.files.map(async (file) => {
        const filepath = join(
          props.context.srcDir,
          props.context.url(file) + (file.endsWith(".md") ? "" : ".md")
        );

        const content = await readFile(filepath, { encoding: "utf-8" });
        props.context.addDependency(filepath);

        return content;
      })
    )
  ).join("\n\n");

  const headingTracker = new HeadingTracker();

  const html = marked(content, {
    walkTokens: (token) => {
      if (token.type === "heading") {
        headingTracker.push(new Heading(token.text, token.depth));
      }
    },
  });

  const headings = headingTracker.root.children;

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no"
        />
        <title>{props.title}</title>
        <style>{style}</style>
        {props.context.isDevelopment ? (
          <script
            type="text/javascript"
            src="https://livejs.com/live.js"
          ></script>
        ) : null}
      </head>
      <body>
        <main className="content">
          <div className="content__inner">{html}</div>
        </main>
        <div className="header">{props.title}</div>
        <div className="menu">
          <ol>{headings.map((heading, i) => heading.render("", i))}</ol>
        </div>
      </body>
    </html>
  );
};

class Heading {
  id: string;
  children: Heading[] = [];

  constructor(readonly title: string, readonly depth: number) {
    this.id = title.toLowerCase().replace(/ +/g, "-");
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

export interface MdBookProperties {
  title: string;
  context: PageContext;
  files: string[];
}
