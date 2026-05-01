const fs = require('fs')
const path = require('path')
const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle } = require('docx')
const markdownpdf = require('markdown-pdf')

const inputFile = path.join(__dirname, 'WALLET_RECOVERY_WHITEPAPER.md')
const outputDocx = path.join(__dirname, 'WALLET_RECOVERY_WHITEPAPER.docx')
const outputPdf = path.join(__dirname, 'WALLET_RECOVERY_WHITEPAPER.pdf')

// Read markdown content
const markdown = fs.readFileSync(inputFile, 'utf-8')

// Parse markdown to docx
function parseMarkdownToDocx(md) {
  const lines = md.split('\n')
  const children = []
  let inCodeBlock = false
  let codeContent = []
  let inTable = false
  let tableRows = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Handle code blocks
    if (line.startsWith('```')) {
      if (inCodeBlock) {
        // End code block
        children.push(new Paragraph({
          children: [new TextRun({ text: codeContent.join('\n'), font: 'Consolas', size: 20 })],
          shading: { fill: 'f0f0f0' },
          spacing: { before: 100, after: 100 },
        }))
        codeContent = []
        inCodeBlock = false
      } else {
        inCodeBlock = true
      }
      continue
    }

    if (inCodeBlock) {
      codeContent.push(line)
      continue
    }

    // Handle tables
    if (line.includes('|') && line.trim().startsWith('|')) {
      if (!inTable) {
        inTable = true
        tableRows = []
      }
      // Skip separator rows
      if (line.includes('---')) continue

      const cells = line.split('|').filter(c => c.trim()).map(c => c.trim())
      tableRows.push(cells)
      continue
    } else if (inTable) {
      // End table
      if (tableRows.length > 0) {
        const table = new Table({
          rows: tableRows.map((row, idx) => new TableRow({
            children: row.map(cell => new TableCell({
              children: [new Paragraph({
                children: [new TextRun({ text: cell, bold: idx === 0, size: 22 })]
              })],
              width: { size: 100 / row.length, type: WidthType.PERCENTAGE },
            }))
          })),
          width: { size: 100, type: WidthType.PERCENTAGE },
        })
        children.push(table)
        children.push(new Paragraph({ text: '' }))
      }
      tableRows = []
      inTable = false
    }

    // Handle headings
    if (line.startsWith('# ')) {
      children.push(new Paragraph({
        text: line.replace('# ', ''),
        heading: HeadingLevel.TITLE,
        spacing: { before: 400, after: 200 },
      }))
    } else if (line.startsWith('## ')) {
      children.push(new Paragraph({
        text: line.replace('## ', ''),
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 300, after: 150 },
      }))
    } else if (line.startsWith('### ')) {
      children.push(new Paragraph({
        text: line.replace('### ', ''),
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 200, after: 100 },
      }))
    } else if (line.startsWith('#### ')) {
      children.push(new Paragraph({
        text: line.replace('#### ', ''),
        heading: HeadingLevel.HEADING_3,
        spacing: { before: 150, after: 75 },
      }))
    } else if (line.startsWith('---')) {
      // Horizontal rule - add spacing
      children.push(new Paragraph({ text: '', spacing: { before: 200, after: 200 } }))
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      // Bullet point
      const text = line.replace(/^[-*] /, '')
      children.push(new Paragraph({
        children: [new TextRun({ text: '• ' + cleanMarkdown(text), size: 24 })],
        spacing: { before: 50, after: 50 },
        indent: { left: 720 },
      }))
    } else if (/^\d+\. /.test(line)) {
      // Numbered list
      const text = line.replace(/^\d+\. /, '')
      children.push(new Paragraph({
        children: [new TextRun({ text: cleanMarkdown(text), size: 24 })],
        spacing: { before: 50, after: 50 },
        indent: { left: 720 },
        numbering: { reference: 'default-numbering', level: 0 },
      }))
    } else if (line.trim() === '') {
      children.push(new Paragraph({ text: '' }))
    } else {
      // Regular paragraph
      children.push(new Paragraph({
        children: parseInlineMarkdown(line),
        spacing: { before: 100, after: 100 },
      }))
    }
  }

  return children
}

function cleanMarkdown(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/`(.*?)`/g, '$1')
}

function parseInlineMarkdown(text) {
  const runs = []
  let remaining = text

  while (remaining.length > 0) {
    // Bold
    const boldMatch = remaining.match(/\*\*(.*?)\*\*/)
    if (boldMatch && remaining.indexOf(boldMatch[0]) === 0) {
      runs.push(new TextRun({ text: boldMatch[1], bold: true, size: 24 }))
      remaining = remaining.slice(boldMatch[0].length)
      continue
    }

    // Italic
    const italicMatch = remaining.match(/\*(.*?)\*/)
    if (italicMatch && remaining.indexOf(italicMatch[0]) === 0) {
      runs.push(new TextRun({ text: italicMatch[1], italics: true, size: 24 }))
      remaining = remaining.slice(italicMatch[0].length)
      continue
    }

    // Code
    const codeMatch = remaining.match(/`(.*?)`/)
    if (codeMatch && remaining.indexOf(codeMatch[0]) === 0) {
      runs.push(new TextRun({ text: codeMatch[1], font: 'Consolas', size: 22 }))
      remaining = remaining.slice(codeMatch[0].length)
      continue
    }

    // Find next special character
    const nextSpecial = remaining.search(/\*|`/)
    if (nextSpecial === -1) {
      runs.push(new TextRun({ text: remaining, size: 24 }))
      break
    } else if (nextSpecial > 0) {
      runs.push(new TextRun({ text: remaining.slice(0, nextSpecial), size: 24 }))
      remaining = remaining.slice(nextSpecial)
    } else {
      // Special char at start but no match - treat as regular text
      runs.push(new TextRun({ text: remaining[0], size: 24 }))
      remaining = remaining.slice(1)
    }
  }

  return runs
}

async function convert() {
  console.log('Converting WALLET_RECOVERY_WHITEPAPER.md...\n')

  // Create Word document
  console.log('Creating Word document...')
  const doc = new Document({
    sections: [{
      properties: {},
      children: parseMarkdownToDocx(markdown),
    }],
  })

  const buffer = await Packer.toBuffer(doc)
  fs.writeFileSync(outputDocx, buffer)
  console.log(`  ✓ Created: ${outputDocx}`)

  // Create PDF
  console.log('Creating PDF...')
  return new Promise((resolve, reject) => {
    markdownpdf({
      cssPath: null,
      paperFormat: 'Letter',
      paperBorder: '1in',
    })
      .from(inputFile)
      .to(outputPdf, () => {
        console.log(`  ✓ Created: ${outputPdf}`)
        console.log('\nDone!')
        resolve()
      })
  })
}

convert().catch(console.error)
