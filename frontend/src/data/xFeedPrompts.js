/**
 * @godofprompt prompt feed data.
 *
 * This is the frontend-consumable version of .claude/x-feed/prompts.md.
 * When the GitHub Action fetches new tweets, it can also update this file.
 * For now, seeded with initial web-searched prompts.
 */

const PROMPT_CATEGORIES = {
  prompting: { label: 'Prompting', color: 'text-matrix-500', bg: 'bg-matrix-500/10', border: 'border-matrix-500/30' },
  reasoning: { label: 'Reasoning', color: 'text-terminal-500', bg: 'bg-terminal-500/10', border: 'border-terminal-500/30' },
  coding: { label: 'Coding', color: 'text-purple-400', bg: 'bg-purple-400/10', border: 'border-purple-400/30' },
  ai_tools: { label: 'AI Tools', color: 'text-blue-400', bg: 'bg-blue-400/10', border: 'border-blue-400/30' },
  productivity: { label: 'Productivity', color: 'text-yellow-400', bg: 'bg-yellow-400/10', border: 'border-yellow-400/30' },
  meta: { label: 'Meta', color: 'text-pink-400', bg: 'bg-pink-400/10', border: 'border-pink-400/30' },
  general: { label: 'General', color: 'text-black-300', bg: 'bg-black-300/10', border: 'border-black-300/30' },
}

const PROMPTS = [
  {
    id: '1',
    date: '2026-02-11',
    categories: ['prompting', 'ai_tools'],
    engagement: 'high',
    content: 'XML tags act as semantic boundaries for Claude, not just formatting. Claude treats outer tags as high-level intent and nested tags as execution details. Users report up to 39% improvement in response quality using XML-structured prompts. Combine XML tags with multishot prompting (<examples>) or chain of thought (<thinking>, <answer>).',
    source: 'https://x.com/godofprompt/status/2010649616262304049',
  },
  {
    id: '2',
    date: '2026-02-11',
    categories: ['prompting', 'reasoning'],
    engagement: 'high',
    content: 'Extended Thinking lets Claude reason through problems before answering. Cognition AI reported an 18% increase in planning performance. For complex tasks, enable Extended Thinking and let the model work through the problem space before committing to an answer.',
    source: 'https://x.com/godofprompt/status/2010649616262304049',
  },
  {
    id: '3',
    date: '2026-02-11',
    categories: ['prompting', 'reasoning'],
    engagement: 'high',
    content: '"Think step by step" makes the model slow down and reason before answering. Accuracy jumps. Tree-of-Thought lets it consider multiple options before deciding — great for planning or strategy. ReAct makes it switch between thinking and searching, with more complete and fact-checked results.',
    source: 'https://x.com/godofprompt/status/1953959797763478015',
  },
  {
    id: '4',
    date: '2026-02-11',
    categories: ['prompting', 'ai_tools'],
    engagement: 'high',
    content: 'Claude best practices: Use first principles decomposition for complex problems. Structure prompts as Role + Vibe + Goal + Constraints + Output Format. One prompt = one job. If you need more, break it into steps. Claude shines when you guide it step-by-step.',
    source: 'https://www.godofprompt.ai/blog/20-best-claude-ai-prompts',
  },
  {
    id: '5',
    date: '2026-02-11',
    categories: ['prompting', 'meta'],
    engagement: 'high',
    content: 'The Consultant Framework Mega Prompt: "You are a world-class strategy consultant trained by McKinsey, BCG, and Bain. Act as if you were hired to provide a $300,000 strategic analysis for a client in the [INDUSTRY] sector." — Role elevation forces higher quality reasoning.',
    source: 'https://x.com/godofprompt/status/1934636234305048917',
  },
  {
    id: '6',
    date: '2026-02-11',
    categories: ['prompting', 'meta'],
    engagement: 'high',
    content: 'Use systematic step-by-step process and self-correction via Tree of Thoughts for complex queries. Complex prompt frameworks still work, but modern models understand context so well that plain language is often better. Match complexity to the task.',
    source: 'https://x.com/godofprompt/status/1963421658581971023',
  },
  {
    id: '7',
    date: '2026-02-11',
    categories: ['prompting', 'productivity'],
    engagement: 'medium',
    content: 'Drop a mini example inside your prompt — even a simple 1-2 line example helps Claude lock in on your style fast. Always set the tone explicitly. Test small changes — tweak your prompt 2-3 different ways. Best outputs usually come after a little prompt testing.',
    source: 'https://www.godofprompt.ai/blog/20-best-claude-ai-prompts',
  },
  {
    id: '8',
    date: '2026-02-11',
    categories: ['prompting', 'productivity'],
    engagement: 'medium',
    content: 'NotebookLM prompts that went viral: 16 copy-paste prompts that turned a "cool AI toy" into a research weapon doing 10 hours of work in 20 seconds. The key insight: structured prompts with clear output formats dramatically compress research time.',
    source: 'https://x.com/godofprompt/status/2008938090950475816',
  },
]

export { PROMPTS, PROMPT_CATEGORIES }
