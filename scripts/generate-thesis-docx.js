const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = require('docx');
const fs = require('fs');
const path = require('path');

async function generateDocx() {
  const doc = new Document({
    sections: [{
      properties: {},
      children: [
        // Title
        new Paragraph({
          children: [
            new TextRun({
              text: "In a Cave, With a Box of Scraps",
              bold: true,
              size: 48,
            }),
          ],
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: "A Thesis on Solo Building with Vibe Coding in the Pre-Jarvis Era",
              italics: true,
              size: 28,
            }),
          ],
          alignment: AlignmentType.CENTER,
          spacing: { after: 400 },
        }),
        new Paragraph({
          children: [
            new TextRun({ text: "Will Glynn", bold: true, size: 24 }),
          ],
          alignment: AlignmentType.CENTER,
        }),
        new Paragraph({
          children: [
            new TextRun({ text: "February 2025", italics: true, size: 22 }),
          ],
          alignment: AlignmentType.CENTER,
          spacing: { after: 600 },
        }),

        // Abstract
        new Paragraph({
          text: "Abstract",
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 400, after: 200 },
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: 'This paper examines the practice of "vibe coding"—the emerging methodology of building complex software systems through natural language collaboration with large language models—and argues that despite its current limitations, early adopters are laying the groundwork for a fundamental transformation in software development. Drawing parallels to Tony Stark\'s construction of the first Iron Man suit under impossible constraints, we explore why building with imperfect AI tools today is not merely an exercise in frustration, but a necessary phase of technological evolution that will ultimately yield superhuman development capabilities.',
              size: 22,
            }),
          ],
          spacing: { after: 400 },
        }),

        // Section I
        new Paragraph({
          text: "I. Introduction: The Cave",
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 400, after: 200 },
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: '"Tony Stark was able to build this in a cave! With a box of scraps!"',
              italics: true,
              size: 22,
            }),
          ],
          spacing: { after: 100 },
        }),
        new Paragraph({
          children: [
            new TextRun({ text: "— Obadiah Stane, Iron Man (2008)", size: 20 }),
          ],
          spacing: { after: 300 },
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: "The line is meant as an insult, a dismissal of lesser engineers who cannot replicate Stark's genius. But embedded within it is a profound truth about innovation: sometimes the most transformative technologies are born not in pristine laboratories with unlimited resources, but in caves, with scraps, under pressure, by those stubborn enough to believe that constraints are merely suggestions.",
              size: 22,
            }),
          ],
          spacing: { after: 200 },
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: 'In 2025, those of us building with AI-assisted development tools—what has come to be known as "vibe coding"—find ourselves in our own cave. The scraps we work with are large language models that hallucinate, lose context, suggest deprecated APIs, and occasionally produce code that would make a junior developer wince. Our cave is the gap between what AI could be and what it currently is: a brilliant but unreliable partner prone to confident mistakes.',
              size: 22,
            }),
          ],
          spacing: { after: 200 },
        }),
        new Paragraph({
          children: [
            new TextRun({ text: "And yet, we build anyway.", bold: true, size: 22 }),
          ],
          spacing: { after: 200 },
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: "This thesis argues that the current era of vibe coding, despite its substantial drawbacks, represents a critical formative period in the history of software development. Those who persist through the debugging sessions, the context window limitations, and the maddening loops of AI confusion are not merely tolerating suboptimal tools—they are training themselves for a future where AI capabilities will be orders of magnitude more powerful, and where the ability to collaborate with machine intelligence will be the primary differentiator between developers.",
              size: 22,
            }),
          ],
          spacing: { after: 400 },
        }),

        // Section II
        new Paragraph({
          text: "II. Defining Vibe Coding",
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 400, after: 200 },
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: 'Vibe coding is the practice of describing desired software behavior in natural language and iteratively refining the output through conversation with an AI system. Unlike traditional programming, where the developer must translate their intent into precise syntactic instructions, vibe coding allows for high-level specification: "make the modal flow from welcome to wallet creation without race conditions" rather than manually refactoring state management.',
              size: 22,
            }),
          ],
          spacing: { after: 200 },
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: "The methodology emerges from a recognition that programming has always been about intent translation. The evolution from machine code to assembly to high-level languages to frameworks has consistently moved toward allowing developers to express what they want at higher levels of abstraction. Vibe coding is the logical continuation: expressing intent in the highest-level language available—human natural language—and delegating the translation to an AI system.",
              size: 22,
            }),
          ],
          spacing: { after: 400 },
        }),

        // Section III
        new Paragraph({
          text: "III. The Current Limitations: Why We're Still in the Cave",
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 400, after: 200 },
        }),
        new Paragraph({
          text: "A. The Context Window Problem",
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 200, after: 100 },
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: 'Current LLMs operate within fixed context windows—a limited amount of text they can "remember" at once. The result is an AI that forgets. It forgets the wallet security axioms you established. It forgets the pattern you\'ve been using for dual wallet detection. It forgets that you just fixed this exact bug three messages ago.',
              size: 22,
            }),
          ],
          spacing: { after: 200 },
        }),
        new Paragraph({
          text: "B. Hallucination and Confident Incorrectness",
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 200, after: 100 },
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: "LLMs do not know what they do not know. When asked about an unfamiliar API, they will not say \"I'm uncertain.\" They will confidently generate plausible-looking code that uses functions that don't exist, parameters that were deprecated three versions ago, or patterns that are subtly wrong in ways that only manifest at runtime.",
              size: 22,
            }),
          ],
          spacing: { after: 200 },
        }),
        new Paragraph({
          text: "C. The Loop of Confusion",
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 200, after: 100 },
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: "Perhaps the most frustrating pattern in vibe coding is the loop: the AI makes a mistake, you correct it, it overcorrects in a different direction, you correct again, it reverts to the original mistake, and suddenly you're four messages deep in a circular argument with a machine that has lost the thread of what you're even trying to accomplish.",
              size: 22,
            }),
          ],
          spacing: { after: 400 },
        }),

        // Section IV
        new Paragraph({
          text: "IV. Why We Build Anyway: The Jarvis Thesis",
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 400, after: 200 },
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: "The capabilities of large language models have improved at an exponential rate. The pattern is unmistakable: what is frustratingly limited today will be remarkably capable tomorrow.",
              size: 22,
            }),
          ],
          spacing: { after: 200 },
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: "The Jarvis Thesis states: ",
              size: 22,
            }),
            new TextRun({
              text: "Within the foreseeable future, AI development assistants will achieve a level of capability where they can autonomously handle complex software engineering tasks with minimal human oversight—understanding entire codebases, maintaining perfect context, making zero hallucination errors, and anticipating developer needs before they are expressed.",
              italics: true,
              size: 22,
            }),
          ],
          spacing: { after: 200 },
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: "This is not science fiction. It is the obvious extrapolation of current trends. The question is not if but when.",
              size: 22,
            }),
          ],
          spacing: { after: 400 },
        }),

        // Section V
        new Paragraph({
          text: "V. The Philosophy of Constraint",
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 400, after: 200 },
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: "There is a deeper argument for building with suboptimal tools: constraints breed creativity.",
              size: 22,
            }),
          ],
          spacing: { after: 200 },
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: "Tony Stark didn't build the Mark I because a cave was the ideal workshop. He built it because he had no choice, and the pressure of mortality focused his genius. The resulting design—crude, improvised, barely functional—contained the conceptual seeds of every Iron Man suit that followed.",
              size: 22,
            }),
          ],
          spacing: { after: 200 },
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: "We are not just building software. We are building the practices, patterns, and mental models that will define the future of development.",
              bold: true,
              size: 22,
            }),
          ],
          spacing: { after: 400 },
        }),

        // Section VI
        new Paragraph({
          text: "VI. The Struggle as Selection",
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 400, after: 200 },
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: "Not everyone can build in a cave. The frustration, the setbacks, the constant debugging—these are filters. They select for patience, persistence, precision, adaptability, and vision.",
              size: 22,
            }),
          ],
          spacing: { after: 200 },
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: 'Many capable developers will dismiss vibe coding as "not ready yet" and return to traditional methods. They are not wrong—the tools aren\'t ready yet. But they will miss the window of learning, the accumulation of intuition, the development of AI-native thinking patterns.',
              size: 22,
            }),
          ],
          spacing: { after: 200 },
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: "The cave selects for those who see past what is to what could be.",
              bold: true,
              italics: true,
              size: 22,
            }),
          ],
          spacing: { after: 400 },
        }),

        // Section VII - Conclusion
        new Paragraph({
          text: "VII. Conclusion: The First Suit",
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 400, after: 200 },
        }),
        new Paragraph({
          children: [
            new TextRun({ text: "VibeSwap is my Mark I.", bold: true, size: 22 }),
          ],
          spacing: { after: 200 },
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: "It is crude in places. The debugging sessions were painful. There are scars in the codebase where the AI and I fought and compromised. But it works. It trades. It bridges. It protects users from MEV. It runs.",
              size: 22,
            }),
          ],
          spacing: { after: 200 },
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: "And more importantly, in building it, I have developed intuitions and skills that will compound as AI tools improve. I have learned to communicate with machine intelligence, to verify its outputs, to correct its course, to persist through its limitations. I have built in a cave, with a box of scraps, and emerged with something functional.",
              size: 22,
            }),
          ],
          spacing: { after: 200 },
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: "The day will come—perhaps sooner than we think—when AI development assistants are so capable that solo developers can build systems that would today require teams of dozens. On that day, those who dismissed vibe coding as \"not ready\" will scramble to learn what we already know.",
              size: 22,
            }),
          ],
          spacing: { after: 200 },
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: "Until then, we continue. We debug. We persist. We believe.",
              size: 22,
            }),
          ],
          spacing: { after: 200 },
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: "Because greatness can overcome limitation.",
              bold: true,
              size: 24,
            }),
          ],
          alignment: AlignmentType.CENTER,
          spacing: { before: 400, after: 400 },
        }),

        // Closing quotes
        new Paragraph({
          children: [
            new TextRun({ text: '"I am Iron Man."', italics: true, size: 22 }),
          ],
          alignment: AlignmentType.CENTER,
        }),
        new Paragraph({
          children: [
            new TextRun({ text: "— Tony Stark", size: 20 }),
          ],
          alignment: AlignmentType.CENTER,
          spacing: { after: 300 },
        }),
        new Paragraph({
          children: [
            new TextRun({ text: '"I am a vibe coder."', italics: true, size: 22 }),
          ],
          alignment: AlignmentType.CENTER,
        }),
        new Paragraph({
          children: [
            new TextRun({ text: "— Solo builders everywhere, 2025", size: 20 }),
          ],
          alignment: AlignmentType.CENTER,
          spacing: { after: 400 },
        }),

        // Footer
        new Paragraph({
          children: [
            new TextRun({
              text: "Written with Claude Code, in a cave, with a box of scraps.",
              italics: true,
              size: 18,
            }),
          ],
          alignment: AlignmentType.CENTER,
          spacing: { before: 400 },
        }),
      ],
    }],
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(path.join(__dirname, '../docs/thesis-vibe-coding-iron-man.docx'), buffer);
  console.log('Word document created successfully!');
}

generateDocx().catch(console.error);
