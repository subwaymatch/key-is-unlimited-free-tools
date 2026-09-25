import { describe, expect, it } from "vitest";

import { renderInline, renderMarkdown, slugify, tableOfContents } from "@/lib/text/markdown";

const inline = (text: string, allowHtml = true) => renderInline(text, { references: new Map(), options: { allowHtml } });

describe("Markdown inlines", () => {
  it("marks emphasis, strong, strikethrough and code, and leaves code alone", () => {
    expect(inline("*a* **b** _c_ __d__ ~~e~~ `*f*`")).toBe("<em>a</em> <strong>b</strong> <em>c</em> <strong>d</strong> <del>e</del> <code>*f*</code>");
    expect(inline("snake_case_name and 2*3*4")).toBe("snake_case_name and 2<em>3</em>4");
    expect(inline("``code with ` tick``")).toBe("<code>code with ` tick</code>");
    expect(inline("\\*not emphasis\\*")).toBe("*not emphasis*");
  });

  it("writes links, images, autolinks and bare links, and refuses script links", () => {
    expect(inline('[site](https://example.com "Home") ![logo](a.png)')).toBe('<a href="https://example.com" title="Home">site</a> <img src="a.png" alt="logo">');
    expect(inline("<https://example.com/x> and www.example.org.")).toBe('<a href="https://example.com/x">https://example.com/x</a> and <a href="http://www.example.org">www.example.org</a>.');
    expect(inline("[x](javascript:alert(1))")).toBe('<a href="#">x</a>');
    expect(inline("[**bold** link](/a)")).toBe('<a href="/a"><strong>bold</strong> link</a>');
  });

  it("escapes HTML, or lets it through without scripts", () => {
    expect(inline("a < b & <kbd>Ctrl</kbd>")).toBe("a &lt; b &amp; <kbd>Ctrl</kbd>");
    expect(inline("<kbd>x</kbd>", false)).toBe("&lt;kbd&gt;x&lt;/kbd&gt;");
    expect(inline("<script>alert(1)</script>")).toBe("alert(1)");
  });

  it("breaks lines on two spaces or a backslash", () => {
    expect(inline("one  \ntwo\\\nthree\nfour")).toBe("one<br>\ntwo<br>\nthree\nfour");
  });
});

describe("Markdown blocks", () => {
  it("renders headings, paragraphs, rules, quotes and code", () => {
    const { html, headings, title } = renderMarkdown("# Title\n\nSome *text*\ncontinued.\n\nSub\n---\n\n***\n\n> quoted\n> > nested\n\n```js\nconst a = 1 < 2;\n```\n\n    indented\n");
    expect(html).toBe(
      [
        '<h1 id="title">Title</h1>',
        "<p>Some <em>text</em>\ncontinued.</p>",
        '<h2 id="sub">Sub</h2>',
        "<hr>",
        "<blockquote>\n<p>quoted</p>\n<blockquote>\n<p>nested</p>\n</blockquote>\n</blockquote>",
        '<pre><code class="language-js">const a = 1 &lt; 2;\n</code></pre>',
        "<pre><code>indented\n</code></pre>",
        "",
      ].join("\n"),
    );
    expect(headings.map((heading) => heading.id)).toEqual(["title", "sub"]);
    expect(title).toBe("Title");
  });

  it("renders tight and loose lists, nesting, numbering and task items", () => {
    expect(renderMarkdown("- one\n- two\n  - inner\n- [x] done\n- [ ] todo\n").html).toBe('<ul class="tasks">\n<li>one</li>\n<li>two\n<ul>\n<li>inner</li>\n</ul></li>\n<li class="task"><input type="checkbox" disabled checked> done</li>\n<li class="task"><input type="checkbox" disabled> todo</li>\n</ul>\n');
    expect(renderMarkdown("3. three\n4. four\n").html).toBe('<ol start="3">\n<li>three</li>\n<li>four</li>\n</ol>\n');
    expect(renderMarkdown("- a\n\n- b\n").html).toBe("<ul>\n<li><p>a</p></li>\n<li><p>b</p></li>\n</ul>\n");
  });

  it("renders GitHub tables with alignment", () => {
    expect(renderMarkdown("| Name | Qty |\n|:-----|----:|\n| a `|` b | 2 |\n| c \\| d |\n").html).toBe('<table>\n<thead>\n<tr><th style="text-align:left">Name</th><th style="text-align:right">Qty</th></tr>\n</thead>\n<tbody>\n<tr><td style="text-align:left">a <code>|</code> b</td><td style="text-align:right">2</td></tr>\n<tr><td style="text-align:left">c | d</td><td style="text-align:right"></td></tr>\n</tbody>\n</table>\n');
  });

  it("resolves reference links and keeps HTML blocks", () => {
    expect(renderMarkdown("See [the docs][d] and [d].\n\n[d]: https://example.com/docs \"Docs\"\n").html).toBe('<p>See <a href="https://example.com/docs" title="Docs">the docs</a> and <a href="https://example.com/docs" title="Docs">d</a>.</p>\n');
    expect(renderMarkdown("<div align=\"center\">\n  <img src=\"x.png\">\n</div>\n").html).toBe('<div align="center">\n  <img src="x.png">\n</div>\n');
  });

  it("makes heading ids unique and a nested table of contents", () => {
    const { headings } = renderMarkdown("# A\n## B\n## B\n### C\n# D\n");
    expect(headings.map((heading) => heading.id)).toEqual(["a", "b", "b-1", "c", "d"]);
    expect(tableOfContents(headings)).toBe('<nav class="toc"><ul><li><a href="#a">A</a><ul><li><a href="#b">B</a></li><li><a href="#b-1">B</a><ul><li><a href="#c">C</a></li></ul></li></ul></li><li><a href="#d">D</a></li></ul></nav>');
    expect(slugify("Hello, World! \u00c9t\u00e9")).toBe("hello-world-\u00e9t\u00e9");
  });
});
