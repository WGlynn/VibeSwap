"""Generate Economítra PDF by converting MD → HTML → PDF via Edge headless."""

import re
import os
import subprocess
import tempfile

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MD_PATH = os.path.join(SCRIPT_DIR, 'ECONOMITRA.md')
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"


def process_inline(text):
    text = re.sub(r'\*\*\*(.*?)\*\*\*', r'<strong><em>\1</em></strong>', text)
    text = re.sub(r'\*\*(.*?)\*\*', r'<strong>\1</strong>', text)
    text = re.sub(r'(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)', r'<em>\1</em>', text)
    text = re.sub(r'`([^`]+)`', r'<code>\1</code>', text)
    return text


def md_to_html(md_text):
    lines = md_text.split('\n')
    parts = []
    in_code = False
    code_lines = []
    skip = True

    for line in lines:
        if skip:
            if line.startswith('# Preface'):
                skip = False
            else:
                continue

        if line.strip().startswith('```'):
            if in_code:
                parts.append(f'<pre>{chr(10).join(code_lines)}</pre>')
                code_lines = []
                in_code = False
            else:
                in_code = True
            continue

        if in_code:
            code_lines.append(line.replace('<', '&lt;').replace('>', '&gt;'))
            continue

        if line.strip() == '---':
            parts.append('<hr>')
            continue

        if line.startswith('# '):
            text = line[2:].strip()
            m = re.match(r'^([IVXLC]+)\.\s*(.*)', text)
            if m:
                parts.append(f'<h1><span class="num">{m.group(1)}</span><br>{m.group(2)}</h1>')
            else:
                parts.append(f'<h1>{process_inline(text)}</h1>')
            continue

        if line.startswith('## '):
            parts.append(f'<h2>{process_inline(line[3:].strip())}</h2>')
            continue

        if line.startswith('### '):
            parts.append(f'<h3>{process_inline(line[4:].strip())}</h3>')
            continue

        if line.strip().startswith('- '):
            parts.append(f'<p class="bullet">{process_inline(line.strip()[2:])}</p>')
            continue

        if line.strip() == '':
            continue

        if line.strip().startswith('*©') or line.strip().startswith('*The math doesn'):
            parts.append(f'<p class="footer">{line.strip().strip("*")}</p>')
            continue

        if line.strip().startswith('*Economítra'):
            parts.append(f'<p class="closing">{line.strip().strip("*")}</p>')
            continue

        text = process_inline(line.strip())
        if text:
            parts.append(f'<p>{text}</p>')

    return '\n'.join(parts)


def build():
    with open(MD_PATH, 'r', encoding='utf-8') as f:
        md = f.read()

    body = md_to_html(md)

    html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
@page {{ size: letter; margin: 2.5cm 3cm; }}
body {{ font-family: Georgia, 'Times New Roman', serif; font-size: 11pt; line-height: 1.55; color: #2a2a2a; max-width: 100%; }}

.cover {{ height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; page-break-after: always; }}
.cover .greek {{ font-size: 16pt; color: #999; margin-bottom: 8px; }}
.cover .title {{ font-size: 44pt; color: #1a1a1a; margin-bottom: 6px; }}
.cover .subtitle {{ font-size: 14pt; color: #666; font-style: italic; margin-bottom: 20px; }}
.cover .rule {{ width: 200px; border: none; border-top: 1px solid #ccc; margin: 20px 0; }}
.cover .author {{ font-size: 13pt; color: #333; margin-bottom: 4px; }}
.cover .year {{ font-size: 11pt; color: #999; }}

.epigraph {{ height: 50vh; display: flex; align-items: center; justify-content: center; page-break-after: always; }}
.epigraph p {{ font-size: 11pt; font-style: italic; color: #666; max-width: 400px; text-align: center; line-height: 1.6; }}

h1 {{ font-size: 20pt; color: #1a1a1a; margin-top: 32pt; margin-bottom: 10pt; page-break-after: avoid; }}
h1 .num {{ font-size: 11pt; color: #999; font-weight: normal; }}
h2 {{ font-size: 13pt; color: #2a2a2a; margin-top: 22pt; margin-bottom: 7pt; page-break-after: avoid; }}
h3 {{ font-size: 11.5pt; font-style: italic; color: #333; margin-top: 14pt; margin-bottom: 5pt; page-break-after: avoid; }}

p {{ margin: 4pt 0 6pt 0; text-align: justify; }}
p.bullet {{ margin-left: 20pt; margin-top: 2pt; margin-bottom: 2pt; }}
p.bullet::before {{ content: "\\2022\\00a0\\00a0"; color: #999; }}
p.closing {{ text-align: center; font-style: italic; color: #333; font-size: 12pt; margin-top: 20pt; }}
p.footer {{ text-align: center; font-style: italic; color: #999; font-size: 9pt; }}

pre {{ font-family: Consolas, monospace; font-size: 9pt; background: #f5f5f5; padding: 10pt; margin: 6pt 0 6pt 20pt; border-left: 2px solid #ddd; white-space: pre-wrap; }}
code {{ font-family: Consolas, monospace; font-size: 10pt; color: #444; }}
hr {{ border: none; border-top: 1px solid #ddd; margin: 20pt 0; }}
strong {{ color: #1a1a1a; }}
</style></head><body>

<div class="cover">
<div class="greek">\u039f\u03b9\u03ba\u03bf\u03bd\u03bf\u03bc\u03af\u03c4\u03c1\u03b1</div>
<div class="title">Econom\u00edtra</div>
<div class="subtitle">The Measurement of All Things</div>
<hr class="rule">
<div class="author">Will Glynn</div>
<div class="year">2026</div>
</div>

<div class="epigraph">
<p>From the Greek econom\u00eda (household management) and metron (measurement). The measurement of economic reality \u2014 not as governments report it, not as textbooks teach it, not as markets display it. As it actually is.</p>
</div>

{body}

</body></html>"""

    # Write HTML to temp file
    tmp = os.path.join(tempfile.gettempdir(), 'economitra_temp.html')
    with open(tmp, 'w', encoding='utf-8') as f:
        f.write(html)

    output = os.path.join(os.path.expanduser('~'), 'Desktop', 'ECONOMITRA.pdf')

    # Use Edge headless to print to PDF
    cmd = [
        EDGE,
        '--headless',
        '--disable-gpu',
        '--no-sandbox',
        f'--print-to-pdf={output}',
        '--print-to-pdf-no-header',
        f'file:///{tmp.replace(os.sep, "/")}'
    ]

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if os.path.exists(output):
        size = os.path.getsize(output)
        print(f"PDF saved to {output} ({size:,} bytes)")
    else:
        print(f"Failed. stderr: {result.stderr}")


if __name__ == '__main__':
    build()
