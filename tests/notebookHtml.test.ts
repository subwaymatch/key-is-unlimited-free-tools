import { describe, expect, it } from "vitest";

import { notebookToHtml, renderBundle, stripAnsi } from "@/lib/data/notebookHtml";

const NOTEBOOK = {
  nbformat: 4,
  nbformat_minor: 5,
  metadata: { kernelspec: { name: "python3", language: "python" }, language_info: { name: "python" } },
  cells: [
    { cell_type: "markdown", metadata: {}, source: ["# Sales report\n", "\n", "Figures for *May*. ![logo](attachment:logo.png)"], attachments: { "logo.png": { "image/png": "iVBORw0KGgo=" } } },
    { cell_type: "code", execution_count: 1, metadata: {}, outputs: [{ output_type: "stream", name: "stdout", text: ["loaded 3 rows\n"] }], source: ["import pandas as pd\n", "df = pd.read_csv('x.csv')"] },
    {
      cell_type: "code",
      execution_count: 2,
      metadata: {},
      outputs: [{ output_type: "execute_result", execution_count: 2, metadata: {}, data: { "text/plain": ["   a\n0  1"], "text/html": ["<table><tr><td onclick=\"x()\">1</td></tr></table><script>evil()</script>"] } }],
      source: ["df"],
    },
    { cell_type: "code", execution_count: 3, metadata: {}, outputs: [{ output_type: "display_data", metadata: {}, data: { "image/png": "AAAA\n", "text/plain": ["<Figure>"] } }], source: ["df.plot()"] },
    { cell_type: "code", execution_count: 4, metadata: {}, outputs: [{ output_type: "error", ename: "ZeroDivisionError", evalue: "division by zero", traceback: ["\u001b[0;31mZeroDivisionError\u001b[0m: division by zero"] }], source: ["1/0"] },
    { cell_type: "raw", metadata: {}, source: ["raw <text>"] },
  ],
};

describe("notebook to HTML", () => {
  it("renders Markdown, code, outputs and errors, and counts them", () => {
    const result = notebookToHtml(JSON.stringify(NOTEBOOK), "fallback", { showCode: true, showPrompts: true });
    expect(result.title).toBe("Sales report");
    expect(result.language).toBe("python");
    expect(result.cells).toEqual({ code: 4, markdown: 1, outputs: 4, images: 1 });
    const { html } = result;
    expect(html).toContain("<title>Sales report</title>");
    expect(html).toContain('<h1 id="sales-report">Sales report</h1>');
    expect(html).toContain('<img src="data:image/png;base64,iVBORw0KGgo=" alt="logo">');
    expect(html).toContain(`<div class="prompt">In [1]:</div><div class="source"><pre><code class="language-python">import pandas as pd\ndf = pd.read_csv('x.csv')</code></pre></div>`);
    expect(html).toContain('<pre class="stdout">loaded 3 rows\n</pre>');
    expect(html).toContain('<div class="prompt">Out [2]:</div><div class="output"><div class="html"><table><tr><td>1</td></tr></table></div></div>');
    expect(html).not.toContain("evil");
    expect(html).not.toContain("onclick");
    expect(html).toContain('<img src="data:image/png;base64,AAAA" alt="">');
    expect(html).toContain('<pre class="error">ZeroDivisionError: division by zero</pre>');
    expect(html).toContain("<pre>raw &lt;text&gt;</pre>");
  });

  it("can leave the code and the prompts out, for a report", () => {
    const { html } = notebookToHtml(JSON.stringify(NOTEBOOK), "fallback", { showCode: false, showPrompts: false });
    expect(html).not.toContain("read_csv");
    expect(html).toContain('<div class="cell no-prompt">');
    expect(html).toContain("loaded 3 rows");
  });

  it("falls back to the file name for a notebook without a heading", () => {
    const bare = { ...NOTEBOOK, cells: [NOTEBOOK.cells[1]] };
    expect(notebookToHtml(JSON.stringify(bare), "analysis", { showCode: true, showPrompts: true }).title).toBe("analysis");
  });

  it("picks the richest output a page can show without running anything", () => {
    expect(renderBundle({ "text/plain": "x", "image/svg+xml": ['<svg onload="a()"><circle r="1"/></svg>'] })).toBe('<div class="svg"><svg><circle r="1"/></svg></div>');
    // A plot that is only a script says nothing without it, so its text stands in.
    expect(renderBundle({ "text/html": "<script>Plotly.newPlot()</script>", "text/plain": "Figure" })).toBe("<pre>Figure</pre>");
    expect(renderBundle({ "text/markdown": "**b**" })).toBe('<div class="markdown"><p><strong>b</strong></p>\n</div>');
    expect(renderBundle({ "application/json": { a: 1 } })).toBe("<pre>{\n  &quot;a&quot;: 1\n}</pre>");
    expect(stripAnsi("\u001b[1;32mok\u001b[0m")).toBe("ok");
  });
});
