// ============ Task Queue — Deferred Execution Engine ============
//
// The difference between a chatbot and an agent: follow-through.
//
// When Jarvis says "I'll check the logs" or "Let me look into that",
// this module turns that from a hallucinated promise into an actual task.
//
// Architecture:
//   1. LLM calls `defer_task` tool with structured task data
//   2. Task is persisted to disk (survives restarts)
//   3. Background loop processes tasks at configurable intervals
//   4. Results are reported back to the originating chat
//   5. Failed tasks retry with exponential backoff (max 3 attempts)
//
// Task lifecycle: QUEUED → RUNNING → COMPLETED | FAILED | EXPIRED
//
// ============

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { config } from './config.js';

const DATA_DIR = config.dataDir;
const TASKS_FILE = join(DATA_DIR, 'task-queue.json');

// ============ Constants ============

const CHECK_INTERVAL_MS = 30_000;       // Check every 30s
const MAX_RETRIES = 3;                  // Max attempts per task
const TASK_EXPIRY_MS = 24 * 60 * 60_000; // Tasks expire after 24h
const MAX_QUEUE_SIZE = 50;              // Max queued tasks (prevent runaway)
const RETRY_BACKOFF_MS = [
  60_000,       // 1min after first failure
  300_000,      // 5min after second
  900_000,      // 15min after third
];

// ============ State ============

let tasks = [];           // All tasks (queued + completed history)
let dirty = false;
let checkInterval = null;
let sendFn = null;        // Telegram sendMessage function
let chatFn = null;        // LLM chat function for task execution
let running = false;      // Prevent concurrent processing

// ============ Task Types & Executors ============

// Each task type has an executor that does the actual work.
// Executors receive (task, context) and return { result: string, success: boolean }

const executors = {
  // Generic LLM task — ask the LLM to do something and report back
  llm_query: async (task, { chat }) => {
    if (!chat) return { result: 'LLM not available', success: false };
    try {
      const response = await chat(
        task.chatId,
        'JARVIS-TASK-QUEUE',
        `[DEFERRED TASK — Execute and report results]\n\nOriginal request from ${task.requestedBy}: "${task.description}"\n\nContext: ${task.context || 'none'}\n\nDo the task now and provide a concise result. Do NOT defer further — execute immediately.`,
        task.chatType || 'private',
        [],
        { maxTokensOverride: 1024 }
      );
      return { result: response.text, success: true };
    } catch (err) {
      return { result: `LLM execution failed: ${err.message}`, success: false };
    }
  },

  // Web fetch — check a URL and summarize
  web_check: async (task) => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      const res = await fetch(task.url, { signal: controller.signal });
      clearTimeout(timer);

      if (!res.ok) {
        return { result: `HTTP ${res.status}: ${res.statusText}`, success: false };
      }
      const text = await res.text();
      const preview = text.slice(0, 500);
      return { result: `Fetched ${task.url} — ${res.status} OK (${text.length} bytes):\n${preview}...`, success: true };
    } catch (err) {
      return { result: `Fetch failed: ${err.message}`, success: false };
    }
  },

  // Price check — fetch and report a token price
  price_check: async (task) => {
    try {
      const token = (task.token || 'ethereum').toLowerCase();
      const res = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${token}&vs_currencies=usd&include_24hr_change=true`,
        { signal: AbortSignal.timeout(8000) }
      );
      const data = await res.json();
      if (!data[token]) return { result: `Token "${token}" not found on CoinGecko`, success: false };
      const price = data[token].usd;
      const change = data[token].usd_24h_change?.toFixed(2) || '0';
      return { result: `${token.toUpperCase()}: $${price.toLocaleString()} (${change > 0 ? '+' : ''}${change}% 24h)`, success: true };
    } catch (err) {
      return { result: `Price check failed: ${err.message}`, success: false };
    }
  },

  // Log/status check — internal system check
  system_check: async (task) => {
    const checks = [];

    // Memory usage
    const mem = process.memoryUsage();
    checks.push(`Memory: ${(mem.heapUsed / 1024 / 1024).toFixed(1)}MB / ${(mem.heapTotal / 1024 / 1024).toFixed(1)}MB`);

    // Uptime
    checks.push(`Uptime: ${(process.uptime() / 3600).toFixed(1)}h`);

    // Task queue status
    const queued = tasks.filter(t => t.status === 'queued').length;
    const completed = tasks.filter(t => t.status === 'completed').length;
    const failed = tasks.filter(t => t.status === 'failed').length;
    checks.push(`Task queue: ${queued} queued, ${completed} completed, ${failed} failed`);

    return { result: checks.join('\n'), success: true };
  },

  // Reminder — just echo back after delay (already handled by scheduling)
  reminder: async (task) => {
    return { result: task.message || task.description, success: true };
  },
};

// ============ Init / Persist ============

export async function initTaskQueue(telegramSendFn, llmChatFn) {
  sendFn = telegramSendFn;
  chatFn = llmChatFn;

  try {
    const data = await readFile(TASKS_FILE, 'utf-8');
    tasks = JSON.parse(data);
    // Clean expired tasks on load
    const now = Date.now();
    const before = tasks.length;
    tasks = tasks.filter(t => {
      if (t.status === 'queued' && now - t.createdAt > TASK_EXPIRY_MS) {
        return false; // Drop expired queued tasks
      }
      return true;
    });
    if (tasks.length !== before) dirty = true;
    console.log(`[task-queue] Loaded ${tasks.length} tasks (${tasks.filter(t => t.status === 'queued').length} queued)`);
  } catch {
    console.log('[task-queue] No saved tasks — starting fresh');
  }

  // Start background processing loop
  checkInterval = setInterval(processTasks, CHECK_INTERVAL_MS);
  console.log(`[task-queue] Background processor armed (${CHECK_INTERVAL_MS / 1000}s interval)`);
}

export async function flushTaskQueue() {
  if (!dirty) return;
  try {
    await writeFile(TASKS_FILE, JSON.stringify(tasks, null, 2));
    dirty = false;
  } catch (err) {
    console.error(`[task-queue] Flush failed: ${err.message}`);
  }
}

export function stopTaskQueue() {
  if (checkInterval) clearInterval(checkInterval);
}

// ============ Task Creation ============

export function createTask({
  type = 'llm_query',
  description,
  chatId,
  chatType = 'private',
  requestedBy = 'unknown',
  userId,
  context = '',
  delayMs = 0,
  // Type-specific fields
  url,
  token,
  message,
}) {
  // Enforce queue size limit
  const queuedCount = tasks.filter(t => t.status === 'queued').length;
  if (queuedCount >= MAX_QUEUE_SIZE) {
    return { error: `Task queue full (${MAX_QUEUE_SIZE} max). Complete or expire existing tasks first.` };
  }

  // Validate type
  if (!executors[type]) {
    return { error: `Unknown task type "${type}". Available: ${Object.keys(executors).join(', ')}` };
  }

  const task = {
    id: `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    type,
    description,
    chatId,
    chatType,
    requestedBy,
    userId,
    context,
    status: 'queued',
    attempts: 0,
    maxRetries: MAX_RETRIES,
    createdAt: Date.now(),
    executeAfter: Date.now() + delayMs,
    lastAttempt: null,
    completedAt: null,
    result: null,
    // Type-specific
    url,
    token,
    message,
  };

  tasks.push(task);
  dirty = true;

  console.log(`[task-queue] Created: ${task.id} (${type}) — "${description.slice(0, 60)}..." — execute after ${delayMs > 0 ? `${delayMs / 1000}s delay` : 'now'}`);

  return { taskId: task.id, status: 'queued', executeAfter: task.executeAfter };
}

// ============ Task Processing ============

async function processTasks() {
  if (running) return; // Prevent concurrent processing
  running = true;

  const now = Date.now();
  const ready = tasks.filter(t =>
    t.status === 'queued' &&
    now >= t.executeAfter &&
    t.attempts < t.maxRetries
  );

  if (ready.length === 0) {
    running = false;
    return;
  }

  console.log(`[task-queue] Processing ${ready.length} ready task(s)`);

  for (const task of ready) {
    try {
      task.status = 'running';
      task.attempts++;
      task.lastAttempt = now;
      dirty = true;

      const executor = executors[task.type];
      if (!executor) {
        task.status = 'failed';
        task.result = `No executor for type "${task.type}"`;
        continue;
      }

      const { result, success } = await executor(task, { chat: chatFn, send: sendFn });

      if (success) {
        task.status = 'completed';
        task.result = result;
        task.completedAt = Date.now();

        // Report back to originating chat
        if (sendFn && task.chatId) {
          const report = formatTaskReport(task);
          try {
            await sendFn(task.chatId, report, { parse_mode: 'Markdown' });
          } catch (sendErr) {
            // Try without markdown if it fails
            try {
              await sendFn(task.chatId, report.replace(/[*_`\[\]]/g, ''));
            } catch {
              console.error(`[task-queue] Failed to report task ${task.id}: ${sendErr.message}`);
            }
          }
        }

        console.log(`[task-queue] Completed: ${task.id} — "${task.description.slice(0, 40)}..."`);
      } else {
        // Failed — check if retries remain
        if (task.attempts >= task.maxRetries) {
          task.status = 'failed';
          task.result = result;
          task.completedAt = Date.now();

          // Report failure to chat
          if (sendFn && task.chatId) {
            try {
              await sendFn(task.chatId, `Task failed after ${task.attempts} attempts: ${task.description}\n\nLast error: ${result}`);
            } catch {
              // Silent — can't report
            }
          }

          console.log(`[task-queue] Failed permanently: ${task.id} after ${task.attempts} attempts`);
        } else {
          // Retry with backoff
          const backoff = RETRY_BACKOFF_MS[task.attempts - 1] || RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1];
          task.status = 'queued';
          task.executeAfter = Date.now() + backoff;
          console.log(`[task-queue] Retry scheduled: ${task.id} in ${backoff / 1000}s (attempt ${task.attempts}/${task.maxRetries})`);
        }
      }
    } catch (err) {
      task.status = 'queued'; // Put back for retry
      task.executeAfter = Date.now() + 60_000; // 1min backoff on crash
      console.error(`[task-queue] Executor crashed for ${task.id}: ${err.message}`);
    }

    dirty = true;
  }

  // Prune old completed/failed tasks (keep last 100)
  const history = tasks.filter(t => t.status === 'completed' || t.status === 'failed');
  if (history.length > 100) {
    const toRemove = history.slice(0, history.length - 100);
    const removeIds = new Set(toRemove.map(t => t.id));
    tasks = tasks.filter(t => !removeIds.has(t.id));
    dirty = true;
  }

  await flushTaskQueue();
  running = false;
}

// ============ Formatting ============

function formatTaskReport(task) {
  const duration = task.completedAt - task.createdAt;
  const durationStr = duration < 60_000
    ? `${(duration / 1000).toFixed(0)}s`
    : `${(duration / 60_000).toFixed(1)}min`;

  return [
    `*Task completed* (${durationStr})`,
    `> ${task.description}`,
    '',
    task.result,
  ].join('\n');
}

// ============ View / Management ============

export function listTasks(userId) {
  const userTasks = userId
    ? tasks.filter(t => t.userId === userId || t.requestedBy === userId)
    : tasks;

  const queued = userTasks.filter(t => t.status === 'queued');
  const running = userTasks.filter(t => t.status === 'running');
  const completed = userTasks.filter(t => t.status === 'completed').slice(-5);
  const failed = userTasks.filter(t => t.status === 'failed').slice(-3);

  const lines = ['Task Queue\n'];

  if (queued.length > 0) {
    lines.push('Queued:');
    for (const t of queued) {
      const eta = t.executeAfter > Date.now()
        ? ` (in ${Math.ceil((t.executeAfter - Date.now()) / 1000)}s)`
        : ' (ready)';
      lines.push(`  [${t.id}] ${t.description.slice(0, 50)}${eta}`);
    }
  }

  if (running.length > 0) {
    lines.push('\nRunning:');
    for (const t of running) lines.push(`  [${t.id}] ${t.description.slice(0, 50)}`);
  }

  if (completed.length > 0) {
    lines.push('\nRecent completed:');
    for (const t of completed) {
      const ago = Math.ceil((Date.now() - t.completedAt) / 60_000);
      lines.push(`  [${t.id}] ${t.description.slice(0, 50)} (${ago}min ago)`);
    }
  }

  if (failed.length > 0) {
    lines.push('\nRecent failed:');
    for (const t of failed) lines.push(`  [${t.id}] ${t.description.slice(0, 50)}`);
  }

  if (queued.length === 0 && running.length === 0 && completed.length === 0 && failed.length === 0) {
    lines.push('No tasks. Jarvis will create tasks when he commits to deferred work.');
  }

  return lines.join('\n');
}

export function cancelTask(taskId, userId) {
  const task = tasks.find(t => t.id === taskId);
  if (!task) return `Task "${taskId}" not found.`;
  if (task.status !== 'queued') return `Task "${taskId}" is ${task.status} — can only cancel queued tasks.`;
  task.status = 'failed';
  task.result = `Cancelled by ${userId || 'user'}`;
  task.completedAt = Date.now();
  dirty = true;
  return `Cancelled task: ${task.description}`;
}

export function getTaskStats() {
  return {
    total: tasks.length,
    queued: tasks.filter(t => t.status === 'queued').length,
    running: tasks.filter(t => t.status === 'running').length,
    completed: tasks.filter(t => t.status === 'completed').length,
    failed: tasks.filter(t => t.status === 'failed').length,
  };
}

// ============ Tool Definition (for LLM) ============

export const DEFER_TASK_TOOL = {
  name: 'defer_task',
  description: 'Create a deferred task that will be executed in the background and reported back when complete. Use this INSTEAD of saying "I\'ll check..." or "Let me look into..." — this actually follows through. Types: llm_query (general task via LLM), web_check (fetch a URL), price_check (token price), system_check (internal diagnostics), reminder (timed message). IMPORTANT: If you commit to doing something later, you MUST call this tool. Hallucinated promises are unacceptable.',
  input_schema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['llm_query', 'web_check', 'price_check', 'system_check', 'reminder'],
        description: 'Task type. llm_query = general task (default), web_check = fetch URL, price_check = token price, system_check = internal health, reminder = timed message',
      },
      description: {
        type: 'string',
        description: 'What the task will do. Be specific — this is shown to the user when reporting results.',
      },
      delay_seconds: {
        type: 'number',
        description: 'Delay in seconds before executing (0 = next processing cycle, ~30s). Use for "check in 5 minutes" type requests.',
      },
      context: {
        type: 'string',
        description: 'Additional context for the task executor (conversation context, relevant details, etc.)',
      },
      url: {
        type: 'string',
        description: 'URL to check (for web_check type)',
      },
      token: {
        type: 'string',
        description: 'CoinGecko token ID (for price_check type, e.g. "bitcoin", "ethereum", "nervos-network")',
      },
      message: {
        type: 'string',
        description: 'Reminder message (for reminder type)',
      },
    },
    required: ['description'],
  },
};

// ============ Tool Group Entry ============

export const TASK_TOOL_GROUP_NAME = 'tasks';
export const TASK_TOOL_NAMES = ['defer_task'];
