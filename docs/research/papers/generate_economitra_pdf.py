"""Generate Economítra PDF with minimalist cover page via WeasyPrint."""

import re
import os
from weasyprint import HTML

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MD_PATH = os.path.join(SCRIPT_DIR, 'ECONOMITRA.md')


def md_to_html(md_text):
    """Convert markdown to HTML with inline styling."""
    lines = md_text.split('\n')
    html_parts = []
    in_code = False
    code_lines = []
    skip_front = True

    for line in lines:
        # Skip title block (cover page handles it)
        if skip_front:
            if line.startswith('# Preface') or line.startswith('# I.'):
                skip_front = False
            elif line.strip() == '---' or line.startswith('#') or line.startswith('*') or line.startswith('**Will'):
                continue
            else:
                continue

        # Code blocks
        if line.strip().startswith('```'):
            if in_code:
                html_parts.append(f'<pre>{chr(10).join(code_lines)}</pre>')
                code_lines = []
                in_code = False
            else:
                in_code = True
            continue

        if in_code:
            code_lines.append(line.replace('<', '&lt;').replace('>', '&gt;'))
            continue

        # Horizontal rules
        if line.strip() == '---':
            html_parts.append('<hr>')
            continue

        # Headers
        if line.startswith('# '):
            text = line[2:].strip()
            match = re.match(r'^([IVXLC]+)\.\s*(.*)', text)
            if match:
                html_parts.append(f'<h1><span class="numeral">{match.group(1)}</span><br>{match.group(2)}</h1>')
            else:
                html_parts.append(f'<h1>{text}</h1>')
            continue

        if line.startswith('## '):
            text = process_inline(line[3:].strip())
            html_parts.append(f'<h2>{text}</h2>')
            continue

        if line.startswith('### '):
            text = process_inline(line[4:].strip())
            html_parts.append(f'<h3>{text}</h3>')
            continue

        # Bullets
        if line.strip().startswith('- '):
            text = process_inline(line.strip()[2:])
            html_parts.append(f'<p class="bullet">{text}</p>')
            continue

        # Empty line
        if line.strip() == '':
            continue

        # Footer lines
        if line.strip().startswith('*©') or line.strip().startswith('*The math doesn'):
            text = line.strip().strip('*')
            html_parts.append(f'<p class="footer">{text}</p>')
            continue

        # Closing lines
        if line.strip().startswith('*Economítra'):
            text = line.strip().strip('*')
            html_parts.append(f'<p class="closing">{text}</p>')
            continue

        # Regular paragraph
        text = process_inline(line.strip())
        if text:
            html_parts.append(f'<p>{text}</p>')

    return '\n'.join(html_parts)


def process_inline(text):
    """Process bold, italic, inline code."""
    # Bold + italic
    text = re.sub(r'\*\*\*(.*?)\*\*\*', r'<strong><em>\1</em></strong>', text)
    # Bold
    text = re.sub(r'\*\*(.*?)\*\*', r'<strong>\1</strong>', text)
    # Italic
    text = re.sub(r'\*(.*?)\*', r'<em>\1</em>', text)
    # Inline code
    text = re.sub(r'`([^`]+)`', r'<code>\1</code>', text)
    return text


def build_pdf(md_path, output_path):
    with open(md_path, 'r', encoding='utf-8') as f:
        md_text = f.read()

    body_html = md_to_html(md_text)

    full_html = f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
@page {{
    size: letter;
    margin: 2.5cm 3cm;
    @bottom-center {{
        content: counter(page);
        font-family: Georgia, serif;
        font-size: 9pt;
        color: #999;
    }}
}}

@page cover {{
    margin: 0;
    @bottom-center {{ content: none; }}
}}

body {{
    font-family: Georgia, serif;
    font-size: 11pt;
    line-height: 1.5;
    color: #2a2a2a;
}}

/* Cover page */
.cover {{
    page: cover;
    width: 100%;
    height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    page-break-after: always;
}}

.cover-greek {{
    font-size: 16pt;
    color: #999;
    font-family: Georgia, serif;
    margin-bottom: 8px;
}}

.cover-title {{
    font-size: 48pt;
    color: #1a1a1a;
    font-family: Georgia, serif;
    margin-bottom: 6px;
}}

.cover-subtitle {{
    font-size: 14pt;
    color: #666;
    font-family: Georgia, serif;
    font-style: italic;
    margin-bottom: 20px;
}}

.cover-rule {{
    width: 200px;
    border: none;
    border-top: 1px solid #ccc;
    margin: 20px 0;
}}

.cover-author {{
    font-size: 13pt;
    color: #333;
    font-family: Georgia, serif;
    margin-bottom: 4px;
}}

.cover-year {{
    font-size: 11pt;
    color: #999;
    font-family: Georgia, serif;
}}

/* Epigraph page */
.epigraph-page {{
    page-break-after: always;
    padding-top: 120px;
    text-align: center;
}}

.epigraph-page p {{
    font-size: 11pt;
    font-style: italic;
    color: #666;
    max-width: 400px;
    margin: 0 auto;
    line-height: 1.6;
}}

/* Content */
h1 {{
    font-size: 22pt;
    font-weight: bold;
    color: #1a1a1a;
    margin-top: 36pt;
    margin-bottom: 12pt;
    page-break-after: avoid;
}}

h1 .numeral {{
    font-size: 11pt;
    color: #999;
    font-weight: normal;
}}

h2 {{
    font-size: 14pt;
    font-weight: bold;
    color: #2a2a2a;
    margin-top: 24pt;
    margin-bottom: 8pt;
    page-break-after: avoid;
}}

h3 {{
    font-size: 12pt;
    font-weight: bold;
    font-style: italic;
    color: #333;
    margin-top: 16pt;
    margin-bottom: 6pt;
    page-break-after: avoid;
}}

p {{
    margin-top: 4pt;
    margin-bottom: 6pt;
    text-align: justify;
}}

p.bullet {{
    margin-left: 24pt;
    text-indent: -12pt;
    margin-top: 2pt;
    margin-bottom: 2pt;
}}

p.bullet::before {{
    content: "\\2022\\00a0\\00a0";
    color: #999;
}}

pre {{
    font-family: Consolas, monospace;
    font-size: 9pt;
    color: #333;
    background: #f5f5f5;
    padding: 12pt;
    margin: 8pt 0 8pt 24pt;
    border-left: 2px solid #ddd;
    white-space: pre-wrap;
}}

code {{
    font-family: Consolas, monospace;
    font-size: 10pt;
    color: #444;
}}

hr {{
    border: none;
    border-top: 1px solid #ddd;
    margin: 24pt 0;
}}

strong {{
    font-weight: bold;
    color: #1a1a1a;
}}

em {{
    font-style: italic;
}}

p.closing {{
    text-align: center;
    font-style: italic;
    color: #333;
    font-size: 12pt;
    margin-top: 24pt;
    margin-bottom: 8pt;
}}

p.footer {{
    text-align: center;
    font-style: italic;
    color: #999;
    font-size: 9pt;
    margin-top: 4pt;
}}
</style>
</head>
<body>

<!-- Cover Page -->
<div class="cover">
    <div class="cover-greek">&#927;&#953;&#954;&#959;&#957;&#959;&#956;&#943;&#964;&#961;&#945;</div>
    <div class="cover-title">Econom&#237;tra</div>
    <div class="cover-subtitle">The Measurement of All Things</div>
    <hr class="cover-rule">
    <div class="cover-author">Will Glynn</div>
    <div class="cover-year">2026</div>
</div>

<!-- Epigraph -->
<div class="epigraph-page">
    <p>From the Greek econom&#237;a (household management) and metron (measurement). The measurement of economic reality &mdash; not as governments report it, not as textbooks teach it, not as markets display it. As it actually is.</p>
</div>

<!-- Content -->
{body_html}

</body>
</html>"""

    HTML(string=full_html).write_pdf(output_path)
    print(f"PDF saved to {output_path}")


if __name__ == '__main__':
    output = os.path.join(os.path.expanduser('~'), 'Desktop', 'ECONOMITRA.pdf')
    build_pdf(MD_PATH, output)
