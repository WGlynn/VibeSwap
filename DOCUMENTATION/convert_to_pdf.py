#!/usr/bin/env python3
"""Convert THE_PSYCHONAUT_PAPER.md to a professional PDF."""

import markdown
from weasyprint import HTML
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MD_PATH = os.path.join(SCRIPT_DIR, "THE_PSYCHONAUT_PAPER.md")
PDF_PATH = os.path.join(SCRIPT_DIR, "THE_PSYCHONAUT_PAPER.pdf")

with open(MD_PATH, "r") as f:
    md_content = f.read()

html_body = markdown.markdown(
    md_content,
    extensions=["tables", "fenced_code", "codehilite", "toc"],
)

full_html = f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
@page {{
    size: letter;
    margin: 1in 1.2in;
    @bottom-center {{
        content: counter(page);
        font-family: 'Georgia', serif;
        font-size: 9pt;
        color: #666;
    }}
}}
body {{
    font-family: 'Georgia', 'Times New Roman', serif;
    font-size: 11pt;
    line-height: 1.6;
    color: #1a1a1a;
    max-width: 100%;
}}
h1 {{
    font-size: 22pt;
    font-weight: bold;
    text-align: center;
    margin-top: 2em;
    margin-bottom: 0.2em;
    color: #111;
    page-break-before: avoid;
}}
h2 {{
    font-size: 16pt;
    font-weight: bold;
    margin-top: 1.8em;
    margin-bottom: 0.4em;
    color: #222;
    border-bottom: 1px solid #ccc;
    padding-bottom: 0.2em;
}}
h3 {{
    font-size: 13pt;
    font-weight: bold;
    margin-top: 1.4em;
    margin-bottom: 0.3em;
    color: #333;
    font-style: italic;
}}
p {{
    margin-bottom: 0.8em;
    text-align: justify;
    hyphens: auto;
}}
code {{
    font-family: 'Courier New', monospace;
    font-size: 9.5pt;
    background-color: #f5f5f5;
    padding: 1px 4px;
    border-radius: 2px;
}}
pre {{
    background-color: #f5f5f5;
    border: 1px solid #ddd;
    border-radius: 4px;
    padding: 12px 16px;
    font-size: 9pt;
    line-height: 1.4;
    overflow-x: auto;
    margin: 1em 0;
}}
pre code {{
    background: none;
    padding: 0;
}}
blockquote {{
    border-left: 3px solid #999;
    margin-left: 0;
    padding-left: 1em;
    color: #555;
    font-style: italic;
}}
table {{
    border-collapse: collapse;
    width: 100%;
    margin: 1em 0;
    font-size: 10pt;
}}
th, td {{
    border: 1px solid #ccc;
    padding: 8px 12px;
    text-align: left;
}}
th {{
    background-color: #f0f0f0;
    font-weight: bold;
}}
tr:nth-child(even) {{
    background-color: #fafafa;
}}
hr {{
    border: none;
    border-top: 1px solid #ccc;
    margin: 2em 0;
}}
strong {{
    font-weight: bold;
}}
em {{
    font-style: italic;
}}
ul, ol {{
    margin-bottom: 0.8em;
    padding-left: 1.5em;
}}
li {{
    margin-bottom: 0.3em;
}}
</style>
</head>
<body>
{html_body}
</body>
</html>"""

HTML(string=full_html).write_pdf(PDF_PATH)
print(f"PDF generated: {PDF_PATH}")
