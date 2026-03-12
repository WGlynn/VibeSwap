// ============ Scheduler Module ============
// Protocol Task Scheduling — managing batch auction timing, epoch boundaries,
// recurring protocol tasks (reward distribution, fee collection, oracle updates),
// and automated maintenance coordination.
//
// On CKB, the scheduler coordinates off-chain keeper activities with on-chain
// state transitions. Tasks are scheduled around the 10-second batch auction
// cycle and CKB's ~4-hour epoch boundaries.
//
// Key capabilities:
// - Batch auction phase tracking (commit/reveal timing)
// - Epoch-aware task scheduling with CKB epoch boundaries
// - Priority-based execution ordering (Critical > High > Normal > Low)
// - Recurrence patterns (block-based, time-based, epoch, batch cycle)
// - Timeout detection and automatic failure marking
// - Analytics: throughput, success rates, gas usage

// ============ Constants ============

/// Default batch cycle duration in milliseconds (10 seconds)
const DEFAULT_BATCH_CYCLE_MS: u64 = 10_000;

/// Default maximum concurrent tasks
const DEFAULT_MAX_CONCURRENT: u32 = 10;

/// Default task timeout in milliseconds (30 seconds)
const DEFAULT_TIMEOUT_MS: u64 = 30_000;

/// CKB epoch duration in milliseconds (~4 hours)
const EPOCH_MS: u64 = 14_400_000;

/// Milliseconds per day
const DAY_MS: u64 = 86_400_000;

/// Milliseconds per week
const WEEK_MS: u64 = 604_800_000;

/// Basis points denominator
const BPS: u64 = 10_000;

// ============ Error Types ============

#[derive(Debug, Clone, PartialEq)]
pub enum SchedulerError {
    TaskNotFound,
    AlreadyRunning,
    SchedulerPaused,
    MaxConcurrentReached,
    InvalidRecurrence,
    TaskExpired,
    DuplicateTask,
    InvalidPriority,
    TimeoutExceeded,
    InvalidEpoch,
    CancelledTask,
    Overflow,
}

// ============ Enums ============

#[derive(Debug, Clone, PartialEq)]
pub enum TaskPriority {
    Low,
    Normal,
    High,
    Critical,
}

#[derive(Debug, Clone, PartialEq)]
pub enum TaskStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Cancelled,
    Overdue,
}

#[derive(Debug, Clone, PartialEq)]
pub enum RecurrenceType {
    Once,
    EveryNBlocks(u64),
    EveryNSeconds(u64),
    EpochBoundary,
    BatchCycle,
    Daily,
    Weekly,
}

// ============ Data Types ============

#[derive(Debug, Clone)]
pub struct ScheduledTask {
    pub task_id: u64,
    pub name_hash: [u8; 32],
    pub task_type: u32,
    pub priority: TaskPriority,
    pub status: TaskStatus,
    pub recurrence: RecurrenceType,
    pub next_run: u64,
    pub last_run: Option<u64>,
    pub run_count: u64,
    pub max_runs: Option<u64>,
    pub timeout_ms: u64,
    pub created_at: u64,
    pub executor: Option<[u8; 32]>,
    pub data: u64,
}

#[derive(Debug, Clone)]
pub struct TaskResult {
    pub task_id: u64,
    pub success: bool,
    pub started_at: u64,
    pub completed_at: u64,
    pub gas_used: u64,
    pub error_code: Option<u32>,
}

#[derive(Debug, Clone)]
pub struct Scheduler {
    pub tasks: Vec<ScheduledTask>,
    pub results: Vec<TaskResult>,
    pub next_task_id: u64,
    pub current_epoch: u64,
    pub batch_cycle_ms: u64,
    pub max_concurrent: u32,
    pub paused: bool,
}

#[derive(Debug, Clone)]
pub struct EpochInfo {
    pub epoch_number: u64,
    pub start_block: u64,
    pub end_block: u64,
    pub start_time: u64,
    pub duration_ms: u64,
    pub batch_count: u64,
}

#[derive(Debug, Clone)]
pub struct SchedulerStats {
    pub total_tasks: u64,
    pub pending_tasks: u64,
    pub completed_tasks: u64,
    pub failed_tasks: u64,
    pub overdue_tasks: u64,
    pub avg_execution_ms: u64,
    pub success_rate_bps: u64,
    pub tasks_per_epoch: u64,
}

// ============ Scheduler Management ============

/// Create a new scheduler with custom batch cycle and concurrency limit.
pub fn create_scheduler(batch_cycle_ms: u64, max_concurrent: u32) -> Scheduler {
    Scheduler {
        tasks: Vec::new(),
        results: Vec::new(),
        next_task_id: 1,
        current_epoch: 0,
        batch_cycle_ms,
        max_concurrent,
        paused: false,
    }
}

/// Create a default scheduler: 10s batch cycles, 10 max concurrent tasks.
pub fn default_scheduler() -> Scheduler {
    create_scheduler(DEFAULT_BATCH_CYCLE_MS, DEFAULT_MAX_CONCURRENT)
}

/// Pause the scheduler — prevents starting new tasks.
pub fn pause_scheduler(scheduler: &mut Scheduler) {
    scheduler.paused = true;
}

/// Resume the scheduler — allows starting tasks again.
pub fn resume_scheduler(scheduler: &mut Scheduler) {
    scheduler.paused = false;
}

// ============ Task Creation ============

/// Schedule a task with full control over parameters.
/// Returns the assigned task_id.
pub fn schedule_task(
    scheduler: &mut Scheduler,
    task_type: u32,
    priority: TaskPriority,
    recurrence: RecurrenceType,
    first_run: u64,
    timeout_ms: u64,
    data: u64,
) -> Result<u64, SchedulerError> {
    // Validate recurrence
    match &recurrence {
        RecurrenceType::EveryNBlocks(n) if *n == 0 => {
            return Err(SchedulerError::InvalidRecurrence);
        }
        RecurrenceType::EveryNSeconds(n) if *n == 0 => {
            return Err(SchedulerError::InvalidRecurrence);
        }
        _ => {}
    }

    let task_id = scheduler.next_task_id;
    scheduler.next_task_id = scheduler
        .next_task_id
        .checked_add(1)
        .ok_or(SchedulerError::Overflow)?;

    let task = ScheduledTask {
        task_id,
        name_hash: [0u8; 32],
        task_type,
        priority,
        status: TaskStatus::Pending,
        recurrence,
        next_run: first_run,
        last_run: None,
        run_count: 0,
        max_runs: None,
        timeout_ms,
        created_at: first_run,
        executor: None,
        data,
    };

    scheduler.tasks.push(task);
    Ok(task_id)
}

/// Schedule a one-shot task (runs once, then done).
pub fn schedule_once(
    scheduler: &mut Scheduler,
    task_type: u32,
    run_at: u64,
    priority: TaskPriority,
    data: u64,
) -> Result<u64, SchedulerError> {
    let task_id = scheduler.next_task_id;
    scheduler.next_task_id = scheduler
        .next_task_id
        .checked_add(1)
        .ok_or(SchedulerError::Overflow)?;

    let task = ScheduledTask {
        task_id,
        name_hash: [0u8; 32],
        task_type,
        priority,
        status: TaskStatus::Pending,
        recurrence: RecurrenceType::Once,
        next_run: run_at,
        last_run: None,
        run_count: 0,
        max_runs: Some(1),
        timeout_ms: DEFAULT_TIMEOUT_MS,
        created_at: run_at,
        executor: None,
        data,
    };

    scheduler.tasks.push(task);
    Ok(task_id)
}

/// Schedule a recurring task with optional run limit.
pub fn schedule_recurring(
    scheduler: &mut Scheduler,
    task_type: u32,
    recurrence: RecurrenceType,
    first_run: u64,
    max_runs: Option<u64>,
    data: u64,
) -> Result<u64, SchedulerError> {
    // Validate: Once is not a valid recurrence for schedule_recurring
    if recurrence == RecurrenceType::Once {
        return Err(SchedulerError::InvalidRecurrence);
    }

    match &recurrence {
        RecurrenceType::EveryNBlocks(n) if *n == 0 => {
            return Err(SchedulerError::InvalidRecurrence);
        }
        RecurrenceType::EveryNSeconds(n) if *n == 0 => {
            return Err(SchedulerError::InvalidRecurrence);
        }
        _ => {}
    }

    let task_id = scheduler.next_task_id;
    scheduler.next_task_id = scheduler
        .next_task_id
        .checked_add(1)
        .ok_or(SchedulerError::Overflow)?;

    let task = ScheduledTask {
        task_id,
        name_hash: [0u8; 32],
        task_type,
        priority: TaskPriority::Normal,
        status: TaskStatus::Pending,
        recurrence,
        next_run: first_run,
        last_run: None,
        run_count: 0,
        max_runs,
        timeout_ms: DEFAULT_TIMEOUT_MS,
        created_at: first_run,
        executor: None,
        data,
    };

    scheduler.tasks.push(task);
    Ok(task_id)
}

/// Cancel a pending or overdue task. Cannot cancel running/completed tasks.
pub fn cancel_task(scheduler: &mut Scheduler, task_id: u64) -> Result<(), SchedulerError> {
    let task = scheduler
        .tasks
        .iter_mut()
        .find(|t| t.task_id == task_id)
        .ok_or(SchedulerError::TaskNotFound)?;

    match task.status {
        TaskStatus::Pending | TaskStatus::Overdue => {
            task.status = TaskStatus::Cancelled;
            Ok(())
        }
        TaskStatus::Running => Err(SchedulerError::AlreadyRunning),
        TaskStatus::Cancelled => Err(SchedulerError::CancelledTask),
        TaskStatus::Completed | TaskStatus::Failed => Err(SchedulerError::TaskExpired),
    }
}

/// Reschedule a task to a new next_run time.
pub fn reschedule(
    scheduler: &mut Scheduler,
    task_id: u64,
    new_next_run: u64,
) -> Result<(), SchedulerError> {
    let task = scheduler
        .tasks
        .iter_mut()
        .find(|t| t.task_id == task_id)
        .ok_or(SchedulerError::TaskNotFound)?;

    match task.status {
        TaskStatus::Cancelled => return Err(SchedulerError::CancelledTask),
        TaskStatus::Running => return Err(SchedulerError::AlreadyRunning),
        _ => {}
    }

    task.next_run = new_next_run;
    // If it was completed/failed/overdue, reset to pending so it can run again
    if task.status == TaskStatus::Completed
        || task.status == TaskStatus::Failed
        || task.status == TaskStatus::Overdue
    {
        task.status = TaskStatus::Pending;
    }
    Ok(())
}

// ============ Task Execution ============

/// Return all tasks whose next_run <= now and status is Pending or Overdue,
/// sorted by priority (Critical first, then High, Normal, Low).
pub fn due_tasks(scheduler: &Scheduler, now: u64) -> Vec<&ScheduledTask> {
    let mut result: Vec<&ScheduledTask> = scheduler
        .tasks
        .iter()
        .filter(|t| {
            (t.status == TaskStatus::Pending || t.status == TaskStatus::Overdue)
                && t.next_run <= now
        })
        .collect();

    result.sort_by(|a, b| priority_rank(&a.priority).cmp(&priority_rank(&b.priority)));
    result
}

/// Map priority to sort rank (lower = higher priority = runs first).
fn priority_rank(p: &TaskPriority) -> u8 {
    match p {
        TaskPriority::Critical => 0,
        TaskPriority::High => 1,
        TaskPriority::Normal => 2,
        TaskPriority::Low => 3,
    }
}

/// Start executing a task. Checks scheduler is not paused and concurrency limit.
pub fn start_task(
    scheduler: &mut Scheduler,
    task_id: u64,
    now: u64,
) -> Result<(), SchedulerError> {
    if scheduler.paused {
        return Err(SchedulerError::SchedulerPaused);
    }

    let current_running = running_count(scheduler);
    if current_running >= scheduler.max_concurrent {
        return Err(SchedulerError::MaxConcurrentReached);
    }

    let task = scheduler
        .tasks
        .iter_mut()
        .find(|t| t.task_id == task_id)
        .ok_or(SchedulerError::TaskNotFound)?;

    match task.status {
        TaskStatus::Running => return Err(SchedulerError::AlreadyRunning),
        TaskStatus::Cancelled => return Err(SchedulerError::CancelledTask),
        TaskStatus::Completed | TaskStatus::Failed => {
            // Check if expired (run_count >= max_runs)
            if is_expired(task) {
                return Err(SchedulerError::TaskExpired);
            }
        }
        _ => {}
    }

    task.status = TaskStatus::Running;
    task.last_run = Some(now);
    Ok(())
}

/// Complete a task successfully. Records the result and schedules the next run
/// for recurring tasks.
pub fn complete_task(
    scheduler: &mut Scheduler,
    task_id: u64,
    result: TaskResult,
) -> Result<(), SchedulerError> {
    let batch_cycle = scheduler.batch_cycle_ms;

    let task = scheduler
        .tasks
        .iter_mut()
        .find(|t| t.task_id == task_id)
        .ok_or(SchedulerError::TaskNotFound)?;

    if task.status != TaskStatus::Running {
        return Err(SchedulerError::TaskNotFound);
    }

    task.run_count += 1;

    // Check if recurring and not expired
    if task.recurrence != RecurrenceType::Once && !is_expired(task) {
        task.next_run = next_run_time(&task.recurrence, result.completed_at, batch_cycle);
        task.status = TaskStatus::Pending;
    } else {
        task.status = TaskStatus::Completed;
    }

    scheduler.results.push(result);
    Ok(())
}

/// Fail a task with an error code. Does NOT schedule next run for recurring.
pub fn fail_task(
    scheduler: &mut Scheduler,
    task_id: u64,
    error_code: u32,
    now: u64,
) -> Result<(), SchedulerError> {
    let task = scheduler
        .tasks
        .iter_mut()
        .find(|t| t.task_id == task_id)
        .ok_or(SchedulerError::TaskNotFound)?;

    if task.status != TaskStatus::Running {
        return Err(SchedulerError::TaskNotFound);
    }

    task.status = TaskStatus::Failed;

    let result = TaskResult {
        task_id,
        success: false,
        started_at: task.last_run.unwrap_or(now),
        completed_at: now,
        gas_used: 0,
        error_code: Some(error_code),
    };

    scheduler.results.push(result);
    Ok(())
}

/// Return references to all currently running tasks.
pub fn running_tasks(scheduler: &Scheduler) -> Vec<&ScheduledTask> {
    scheduler
        .tasks
        .iter()
        .filter(|t| t.status == TaskStatus::Running)
        .collect()
}

/// Count of currently running tasks.
pub fn running_count(scheduler: &Scheduler) -> u32 {
    scheduler
        .tasks
        .iter()
        .filter(|t| t.status == TaskStatus::Running)
        .count() as u32
}

// ============ Recurrence ============

/// Calculate the next run time for a recurrence type based on the current time.
pub fn next_run_time(recurrence: &RecurrenceType, current: u64, batch_cycle_ms: u64) -> u64 {
    match recurrence {
        RecurrenceType::Once => current, // no next run, but return current as safe default
        RecurrenceType::EveryNBlocks(n) => current.saturating_add(*n),
        RecurrenceType::EveryNSeconds(n) => current.saturating_add(n.saturating_mul(1000)),
        RecurrenceType::EpochBoundary => current.saturating_add(EPOCH_MS),
        RecurrenceType::BatchCycle => current.saturating_add(batch_cycle_ms),
        RecurrenceType::Daily => current.saturating_add(DAY_MS),
        RecurrenceType::Weekly => current.saturating_add(WEEK_MS),
    }
}

/// Return the interval in milliseconds for a recurrence type.
/// For block-based recurrence, returns the block count directly (not ms).
pub fn recurrence_interval_ms(recurrence: &RecurrenceType, batch_cycle_ms: u64) -> u64 {
    match recurrence {
        RecurrenceType::Once => 0,
        RecurrenceType::EveryNBlocks(n) => *n, // block count, not ms
        RecurrenceType::EveryNSeconds(n) => n.saturating_mul(1000),
        RecurrenceType::EpochBoundary => EPOCH_MS,
        RecurrenceType::BatchCycle => batch_cycle_ms,
        RecurrenceType::Daily => DAY_MS,
        RecurrenceType::Weekly => WEEK_MS,
    }
}

/// Remaining runs before a task expires. None if unlimited.
pub fn remaining_runs(task: &ScheduledTask) -> Option<u64> {
    match task.max_runs {
        Some(max) => Some(max.saturating_sub(task.run_count)),
        None => None,
    }
}

/// Whether a task has exhausted its max_runs.
pub fn is_expired(task: &ScheduledTask) -> bool {
    match task.max_runs {
        Some(max) => task.run_count >= max,
        None => false,
    }
}

// ============ Epoch Management ============

/// Create epoch info with computed batch count.
pub fn create_epoch(
    epoch_number: u64,
    start_block: u64,
    start_time: u64,
    duration_ms: u64,
    batch_cycle_ms: u64,
) -> EpochInfo {
    let bc = if batch_cycle_ms > 0 {
        duration_ms / batch_cycle_ms
    } else {
        0
    };
    let end_block = start_block.saturating_add(duration_ms / 1000); // rough: 1 block/sec estimate
    EpochInfo {
        epoch_number,
        start_block,
        end_block,
        start_time,
        duration_ms,
        batch_count: bc,
    }
}

/// Advance the scheduler to a new epoch. Sets epoch-boundary tasks to pending
/// and returns the count of tasks triggered.
pub fn advance_epoch(scheduler: &mut Scheduler, new_epoch: u64) -> u64 {
    scheduler.current_epoch = new_epoch;
    let mut count = 0u64;

    for task in scheduler.tasks.iter_mut() {
        if task.recurrence == RecurrenceType::EpochBoundary
            && (task.status == TaskStatus::Pending
                || task.status == TaskStatus::Completed
                || task.status == TaskStatus::Failed)
            && !is_expired(task)
        {
            task.status = TaskStatus::Pending;
            count += 1;
        }
    }

    count
}

/// How many batches fit in one epoch.
pub fn batches_per_epoch(epoch_duration_ms: u64, batch_cycle_ms: u64) -> u64 {
    if batch_cycle_ms == 0 {
        return 0;
    }
    epoch_duration_ms / batch_cycle_ms
}

/// Which batch number within the current epoch are we in (0-indexed).
pub fn current_batch_in_epoch(epoch_start: u64, now: u64, batch_cycle_ms: u64) -> u64 {
    if batch_cycle_ms == 0 || now < epoch_start {
        return 0;
    }
    (now - epoch_start) / batch_cycle_ms
}

/// Epoch progress in basis points (0..10000).
pub fn epoch_progress_bps(epoch: &EpochInfo, now: u64) -> u64 {
    if epoch.duration_ms == 0 {
        return 0;
    }
    if now <= epoch.start_time {
        return 0;
    }
    let elapsed = now - epoch.start_time;
    if elapsed >= epoch.duration_ms {
        return BPS;
    }
    (elapsed as u128 * BPS as u128 / epoch.duration_ms as u128) as u64
}

// ============ Queries ============

/// Get a reference to a task by ID.
pub fn get_task(scheduler: &Scheduler, task_id: u64) -> Option<&ScheduledTask> {
    scheduler.tasks.iter().find(|t| t.task_id == task_id)
}

/// All tasks of a given type.
pub fn tasks_by_type(scheduler: &Scheduler, task_type: u32) -> Vec<&ScheduledTask> {
    scheduler
        .tasks
        .iter()
        .filter(|t| t.task_type == task_type)
        .collect()
}

/// All tasks with a given priority.
pub fn tasks_by_priority<'a>(scheduler: &'a Scheduler, priority: &TaskPriority) -> Vec<&'a ScheduledTask> {
    scheduler
        .tasks
        .iter()
        .filter(|t| t.priority == *priority)
        .collect()
}

/// All tasks with a given status.
pub fn tasks_by_status<'a>(scheduler: &'a Scheduler, status: &TaskStatus) -> Vec<&'a ScheduledTask> {
    scheduler
        .tasks
        .iter()
        .filter(|t| t.status == *status)
        .collect()
}

/// Pending tasks that are past their next_run time.
pub fn overdue_tasks(scheduler: &Scheduler, now: u64) -> Vec<&ScheduledTask> {
    scheduler
        .tasks
        .iter()
        .filter(|t| t.status == TaskStatus::Pending && t.next_run < now)
        .collect()
}

/// Total task count in the scheduler.
pub fn task_count(scheduler: &Scheduler) -> usize {
    scheduler.tasks.len()
}

/// Count of pending tasks.
pub fn pending_count(scheduler: &Scheduler) -> usize {
    scheduler
        .tasks
        .iter()
        .filter(|t| t.status == TaskStatus::Pending)
        .count()
}

// ============ Timeout & Cleanup ============

/// Check all running tasks for timeout. Mark timed-out tasks as Failed
/// and record a result. Returns count of tasks timed out.
pub fn check_timeouts(scheduler: &mut Scheduler, now: u64) -> usize {
    let mut timed_out_ids: Vec<(u64, u64)> = Vec::new();

    for task in scheduler.tasks.iter() {
        if task.status == TaskStatus::Running {
            if let Some(started) = task.last_run {
                if now.saturating_sub(started) > task.timeout_ms {
                    timed_out_ids.push((task.task_id, started));
                }
            }
        }
    }

    let count = timed_out_ids.len();

    for (tid, started) in &timed_out_ids {
        if let Some(task) = scheduler.tasks.iter_mut().find(|t| t.task_id == *tid) {
            task.status = TaskStatus::Failed;
        }
        scheduler.results.push(TaskResult {
            task_id: *tid,
            success: false,
            started_at: *started,
            completed_at: now,
            gas_used: 0,
            error_code: Some(9999), // timeout error code
        });
    }

    count
}

/// Remove completed tasks from the task list, keeping at most `keep_results`
/// entries in the results log. Returns count of tasks removed.
pub fn cleanup_completed(scheduler: &mut Scheduler, keep_results: usize) -> usize {
    let before = scheduler.tasks.len();
    scheduler
        .tasks
        .retain(|t| t.status != TaskStatus::Completed);
    let removed = before - scheduler.tasks.len();

    // Trim results if over limit
    if scheduler.results.len() > keep_results {
        let excess = scheduler.results.len() - keep_results;
        scheduler.results.drain(0..excess);
    }

    removed
}

/// Remove cancelled tasks from the task list. Returns count removed.
pub fn prune_cancelled(scheduler: &mut Scheduler) -> usize {
    let before = scheduler.tasks.len();
    scheduler
        .tasks
        .retain(|t| t.status != TaskStatus::Cancelled);
    before - scheduler.tasks.len()
}

/// Mark pending tasks whose next_run has passed as Overdue. Returns count marked.
pub fn mark_overdue(scheduler: &mut Scheduler, now: u64) -> usize {
    let mut count = 0;
    for task in scheduler.tasks.iter_mut() {
        if task.status == TaskStatus::Pending && task.next_run < now {
            task.status = TaskStatus::Overdue;
            count += 1;
        }
    }
    count
}

// ============ Analytics ============

/// Compute aggregate scheduler statistics.
pub fn compute_stats(scheduler: &Scheduler) -> SchedulerStats {
    let total = scheduler.tasks.len() as u64;
    let pending = scheduler
        .tasks
        .iter()
        .filter(|t| t.status == TaskStatus::Pending)
        .count() as u64;
    let completed = scheduler
        .tasks
        .iter()
        .filter(|t| t.status == TaskStatus::Completed)
        .count() as u64;
    let failed = scheduler
        .tasks
        .iter()
        .filter(|t| t.status == TaskStatus::Failed)
        .count() as u64;
    let overdue = scheduler
        .tasks
        .iter()
        .filter(|t| t.status == TaskStatus::Overdue)
        .count() as u64;

    let avg_exec = avg_execution_time(scheduler);
    let sr = success_rate(scheduler);

    // Tasks completed per epoch (rough: results count / max(1, current_epoch))
    let tpe = if scheduler.current_epoch > 0 {
        scheduler.results.len() as u64 / scheduler.current_epoch
    } else {
        scheduler.results.len() as u64
    };

    SchedulerStats {
        total_tasks: total,
        pending_tasks: pending,
        completed_tasks: completed,
        failed_tasks: failed,
        overdue_tasks: overdue,
        avg_execution_ms: avg_exec,
        success_rate_bps: sr,
        tasks_per_epoch: tpe,
    }
}

/// Average execution time across all results, in milliseconds.
pub fn avg_execution_time(scheduler: &Scheduler) -> u64 {
    if scheduler.results.is_empty() {
        return 0;
    }
    let total: u128 = scheduler
        .results
        .iter()
        .map(|r| r.completed_at.saturating_sub(r.started_at) as u128)
        .sum();
    (total / scheduler.results.len() as u128) as u64
}

/// Success rate in basis points (0-10000).
pub fn success_rate(scheduler: &Scheduler) -> u64 {
    if scheduler.results.is_empty() {
        return 0;
    }
    let successes = scheduler.results.iter().filter(|r| r.success).count() as u128;
    (successes * BPS as u128 / scheduler.results.len() as u128) as u64
}

/// Count of tasks completed within a time window ending at `now`.
pub fn task_throughput(scheduler: &Scheduler, window_ms: u64, now: u64) -> u64 {
    let window_start = now.saturating_sub(window_ms);
    scheduler
        .results
        .iter()
        .filter(|r| r.success && r.completed_at >= window_start && r.completed_at <= now)
        .count() as u64
}

/// The task_type with the most failures. Returns None if no failures.
pub fn most_failed_task_type(scheduler: &Scheduler) -> Option<u32> {
    if scheduler.results.is_empty() {
        return None;
    }

    let mut counts: std::collections::HashMap<u32, u64> = std::collections::HashMap::new();

    for result in scheduler.results.iter().filter(|r| !r.success) {
        // Look up the task type from the task list
        if let Some(task) = scheduler.tasks.iter().find(|t| t.task_id == result.task_id) {
            *counts.entry(task.task_type).or_insert(0) += 1;
        }
    }

    counts
        .into_iter()
        .max_by_key(|(_k, v)| *v)
        .map(|(k, _v)| k)
}

/// Total gas used across all results (u128 to avoid overflow).
pub fn gas_usage_total(scheduler: &Scheduler) -> u128 {
    scheduler
        .results
        .iter()
        .map(|r| r.gas_used as u128)
        .sum()
}

// ============ Batch Auction Integration ============

/// When does the next batch cycle start? Aligns to batch_cycle_ms boundaries.
pub fn next_batch_start(now: u64, batch_cycle_ms: u64) -> u64 {
    if batch_cycle_ms == 0 {
        return now;
    }
    let remainder = now % batch_cycle_ms;
    if remainder == 0 {
        now
    } else {
        now + (batch_cycle_ms - remainder)
    }
}

/// Is the current time within the commit phase of a batch?
/// Commit phase = first `commit_duration_ms` of each batch cycle.
pub fn is_in_commit_phase(now: u64, batch_cycle_ms: u64, commit_duration_ms: u64) -> bool {
    if batch_cycle_ms == 0 {
        return false;
    }
    let position = now % batch_cycle_ms;
    position < commit_duration_ms
}

/// Is the current time within the reveal phase of a batch?
/// Reveal phase = after commit_duration_ms, before batch_cycle_ms ends.
pub fn is_in_reveal_phase(now: u64, batch_cycle_ms: u64, commit_duration_ms: u64) -> bool {
    if batch_cycle_ms == 0 {
        return false;
    }
    let position = now % batch_cycle_ms;
    position >= commit_duration_ms && position < batch_cycle_ms
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    // ============ Scheduler Management Tests ============

    #[test]
    fn test_create_scheduler_custom() {
        let s = create_scheduler(5000, 5);
        assert_eq!(s.batch_cycle_ms, 5000);
        assert_eq!(s.max_concurrent, 5);
        assert_eq!(s.next_task_id, 1);
        assert!(!s.paused);
        assert!(s.tasks.is_empty());
        assert!(s.results.is_empty());
    }

    #[test]
    fn test_default_scheduler() {
        let s = default_scheduler();
        assert_eq!(s.batch_cycle_ms, DEFAULT_BATCH_CYCLE_MS);
        assert_eq!(s.max_concurrent, DEFAULT_MAX_CONCURRENT);
        assert_eq!(s.current_epoch, 0);
    }

    #[test]
    fn test_pause_scheduler() {
        let mut s = default_scheduler();
        assert!(!s.paused);
        pause_scheduler(&mut s);
        assert!(s.paused);
    }

    #[test]
    fn test_resume_scheduler() {
        let mut s = default_scheduler();
        pause_scheduler(&mut s);
        assert!(s.paused);
        resume_scheduler(&mut s);
        assert!(!s.paused);
    }

    #[test]
    fn test_pause_resume_idempotent() {
        let mut s = default_scheduler();
        pause_scheduler(&mut s);
        pause_scheduler(&mut s);
        assert!(s.paused);
        resume_scheduler(&mut s);
        resume_scheduler(&mut s);
        assert!(!s.paused);
    }

    // ============ Task Creation Tests ============

    #[test]
    fn test_schedule_task_basic() {
        let mut s = default_scheduler();
        let id = schedule_task(
            &mut s,
            1,
            TaskPriority::Normal,
            RecurrenceType::Once,
            1000,
            5000,
            42,
        )
        .unwrap();
        assert_eq!(id, 1);
        assert_eq!(s.tasks.len(), 1);
        assert_eq!(s.tasks[0].task_type, 1);
        assert_eq!(s.tasks[0].data, 42);
        assert_eq!(s.tasks[0].timeout_ms, 5000);
    }

    #[test]
    fn test_schedule_task_increments_id() {
        let mut s = default_scheduler();
        let id1 = schedule_task(
            &mut s,
            1,
            TaskPriority::Normal,
            RecurrenceType::Once,
            1000,
            5000,
            0,
        )
        .unwrap();
        let id2 = schedule_task(
            &mut s,
            2,
            TaskPriority::High,
            RecurrenceType::Daily,
            2000,
            5000,
            0,
        )
        .unwrap();
        assert_eq!(id1, 1);
        assert_eq!(id2, 2);
        assert_eq!(s.next_task_id, 3);
    }

    #[test]
    fn test_schedule_task_invalid_recurrence_zero_blocks() {
        let mut s = default_scheduler();
        let r = schedule_task(
            &mut s,
            1,
            TaskPriority::Normal,
            RecurrenceType::EveryNBlocks(0),
            1000,
            5000,
            0,
        );
        assert_eq!(r, Err(SchedulerError::InvalidRecurrence));
    }

    #[test]
    fn test_schedule_task_invalid_recurrence_zero_seconds() {
        let mut s = default_scheduler();
        let r = schedule_task(
            &mut s,
            1,
            TaskPriority::Normal,
            RecurrenceType::EveryNSeconds(0),
            1000,
            5000,
            0,
        );
        assert_eq!(r, Err(SchedulerError::InvalidRecurrence));
    }

    #[test]
    fn test_schedule_task_all_priorities() {
        let mut s = default_scheduler();
        for p in [
            TaskPriority::Low,
            TaskPriority::Normal,
            TaskPriority::High,
            TaskPriority::Critical,
        ] {
            let _ = schedule_task(&mut s, 1, p, RecurrenceType::Once, 1000, 5000, 0).unwrap();
        }
        assert_eq!(s.tasks.len(), 4);
    }

    #[test]
    fn test_schedule_task_all_recurrence_types() {
        let mut s = default_scheduler();
        let types = vec![
            RecurrenceType::Once,
            RecurrenceType::EveryNBlocks(10),
            RecurrenceType::EveryNSeconds(60),
            RecurrenceType::EpochBoundary,
            RecurrenceType::BatchCycle,
            RecurrenceType::Daily,
            RecurrenceType::Weekly,
        ];
        for r in types {
            let _ =
                schedule_task(&mut s, 1, TaskPriority::Normal, r, 1000, 5000, 0).unwrap();
        }
        assert_eq!(s.tasks.len(), 7);
    }

    #[test]
    fn test_schedule_once() {
        let mut s = default_scheduler();
        let id = schedule_once(&mut s, 5, 2000, TaskPriority::High, 99).unwrap();
        let task = get_task(&s, id).unwrap();
        assert_eq!(task.recurrence, RecurrenceType::Once);
        assert_eq!(task.max_runs, Some(1));
        assert_eq!(task.next_run, 2000);
        assert_eq!(task.data, 99);
        assert_eq!(task.priority, TaskPriority::High);
    }

    #[test]
    fn test_schedule_recurring_batch_cycle() {
        let mut s = default_scheduler();
        let id = schedule_recurring(
            &mut s,
            10,
            RecurrenceType::BatchCycle,
            5000,
            Some(100),
            0,
        )
        .unwrap();
        let task = get_task(&s, id).unwrap();
        assert_eq!(task.recurrence, RecurrenceType::BatchCycle);
        assert_eq!(task.max_runs, Some(100));
    }

    #[test]
    fn test_schedule_recurring_unlimited() {
        let mut s = default_scheduler();
        let id = schedule_recurring(
            &mut s,
            10,
            RecurrenceType::Daily,
            5000,
            None,
            0,
        )
        .unwrap();
        let task = get_task(&s, id).unwrap();
        assert_eq!(task.max_runs, None);
    }

    #[test]
    fn test_schedule_recurring_rejects_once() {
        let mut s = default_scheduler();
        let r = schedule_recurring(&mut s, 10, RecurrenceType::Once, 5000, None, 0);
        assert_eq!(r, Err(SchedulerError::InvalidRecurrence));
    }

    #[test]
    fn test_schedule_recurring_rejects_zero_blocks() {
        let mut s = default_scheduler();
        let r = schedule_recurring(
            &mut s,
            10,
            RecurrenceType::EveryNBlocks(0),
            5000,
            None,
            0,
        );
        assert_eq!(r, Err(SchedulerError::InvalidRecurrence));
    }

    #[test]
    fn test_schedule_recurring_rejects_zero_seconds() {
        let mut s = default_scheduler();
        let r = schedule_recurring(
            &mut s,
            10,
            RecurrenceType::EveryNSeconds(0),
            5000,
            None,
            0,
        );
        assert_eq!(r, Err(SchedulerError::InvalidRecurrence));
    }

    // ============ Cancel & Reschedule Tests ============

    #[test]
    fn test_cancel_pending_task() {
        let mut s = default_scheduler();
        let id = schedule_once(&mut s, 1, 1000, TaskPriority::Normal, 0).unwrap();
        cancel_task(&mut s, id).unwrap();
        assert_eq!(get_task(&s, id).unwrap().status, TaskStatus::Cancelled);
    }

    #[test]
    fn test_cancel_overdue_task() {
        let mut s = default_scheduler();
        let id = schedule_once(&mut s, 1, 1000, TaskPriority::Normal, 0).unwrap();
        mark_overdue(&mut s, 2000);
        assert_eq!(get_task(&s, id).unwrap().status, TaskStatus::Overdue);
        cancel_task(&mut s, id).unwrap();
        assert_eq!(get_task(&s, id).unwrap().status, TaskStatus::Cancelled);
    }

    #[test]
    fn test_cancel_running_task_fails() {
        let mut s = default_scheduler();
        let id = schedule_once(&mut s, 1, 1000, TaskPriority::Normal, 0).unwrap();
        start_task(&mut s, id, 1000).unwrap();
        let r = cancel_task(&mut s, id);
        assert_eq!(r, Err(SchedulerError::AlreadyRunning));
    }

    #[test]
    fn test_cancel_already_cancelled_fails() {
        let mut s = default_scheduler();
        let id = schedule_once(&mut s, 1, 1000, TaskPriority::Normal, 0).unwrap();
        cancel_task(&mut s, id).unwrap();
        let r = cancel_task(&mut s, id);
        assert_eq!(r, Err(SchedulerError::CancelledTask));
    }

    #[test]
    fn test_cancel_nonexistent_task() {
        let mut s = default_scheduler();
        let r = cancel_task(&mut s, 999);
        assert_eq!(r, Err(SchedulerError::TaskNotFound));
    }

    #[test]
    fn test_reschedule_pending_task() {
        let mut s = default_scheduler();
        let id = schedule_once(&mut s, 1, 1000, TaskPriority::Normal, 0).unwrap();
        reschedule(&mut s, id, 5000).unwrap();
        assert_eq!(get_task(&s, id).unwrap().next_run, 5000);
        assert_eq!(get_task(&s, id).unwrap().status, TaskStatus::Pending);
    }

    #[test]
    fn test_reschedule_failed_resets_to_pending() {
        let mut s = default_scheduler();
        let id = schedule_task(
            &mut s,
            1,
            TaskPriority::Normal,
            RecurrenceType::Daily,
            1000,
            5000,
            0,
        )
        .unwrap();
        start_task(&mut s, id, 1000).unwrap();
        fail_task(&mut s, id, 1, 2000).unwrap();
        assert_eq!(get_task(&s, id).unwrap().status, TaskStatus::Failed);
        reschedule(&mut s, id, 10000).unwrap();
        assert_eq!(get_task(&s, id).unwrap().status, TaskStatus::Pending);
    }

    #[test]
    fn test_reschedule_cancelled_fails() {
        let mut s = default_scheduler();
        let id = schedule_once(&mut s, 1, 1000, TaskPriority::Normal, 0).unwrap();
        cancel_task(&mut s, id).unwrap();
        let r = reschedule(&mut s, id, 5000);
        assert_eq!(r, Err(SchedulerError::CancelledTask));
    }

    #[test]
    fn test_reschedule_running_fails() {
        let mut s = default_scheduler();
        let id = schedule_once(&mut s, 1, 1000, TaskPriority::Normal, 0).unwrap();
        start_task(&mut s, id, 1000).unwrap();
        let r = reschedule(&mut s, id, 5000);
        assert_eq!(r, Err(SchedulerError::AlreadyRunning));
    }

    #[test]
    fn test_reschedule_nonexistent() {
        let mut s = default_scheduler();
        let r = reschedule(&mut s, 999, 5000);
        assert_eq!(r, Err(SchedulerError::TaskNotFound));
    }

    // ============ Task Execution Tests ============

    #[test]
    fn test_due_tasks_empty() {
        let s = default_scheduler();
        assert!(due_tasks(&s, 1000).is_empty());
    }

    #[test]
    fn test_due_tasks_returns_ready() {
        let mut s = default_scheduler();
        schedule_once(&mut s, 1, 1000, TaskPriority::Normal, 0).unwrap();
        schedule_once(&mut s, 2, 2000, TaskPriority::Normal, 0).unwrap();

        let due = due_tasks(&s, 1500);
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].task_type, 1);
    }

    #[test]
    fn test_due_tasks_includes_exact_time() {
        let mut s = default_scheduler();
        schedule_once(&mut s, 1, 1000, TaskPriority::Normal, 0).unwrap();
        let due = due_tasks(&s, 1000);
        assert_eq!(due.len(), 1);
    }

    #[test]
    fn test_due_tasks_sorted_by_priority() {
        let mut s = default_scheduler();
        schedule_once(&mut s, 1, 500, TaskPriority::Low, 0).unwrap();
        schedule_once(&mut s, 2, 500, TaskPriority::Critical, 0).unwrap();
        schedule_once(&mut s, 3, 500, TaskPriority::High, 0).unwrap();
        schedule_once(&mut s, 4, 500, TaskPriority::Normal, 0).unwrap();

        let due = due_tasks(&s, 1000);
        assert_eq!(due.len(), 4);
        assert_eq!(due[0].priority, TaskPriority::Critical);
        assert_eq!(due[1].priority, TaskPriority::High);
        assert_eq!(due[2].priority, TaskPriority::Normal);
        assert_eq!(due[3].priority, TaskPriority::Low);
    }

    #[test]
    fn test_due_tasks_excludes_running() {
        let mut s = default_scheduler();
        let id = schedule_once(&mut s, 1, 500, TaskPriority::Normal, 0).unwrap();
        start_task(&mut s, id, 500).unwrap();
        assert!(due_tasks(&s, 1000).is_empty());
    }

    #[test]
    fn test_due_tasks_excludes_cancelled() {
        let mut s = default_scheduler();
        let id = schedule_once(&mut s, 1, 500, TaskPriority::Normal, 0).unwrap();
        cancel_task(&mut s, id).unwrap();
        assert!(due_tasks(&s, 1000).is_empty());
    }

    #[test]
    fn test_due_tasks_includes_overdue() {
        let mut s = default_scheduler();
        schedule_once(&mut s, 1, 500, TaskPriority::Normal, 0).unwrap();
        mark_overdue(&mut s, 600);
        let due = due_tasks(&s, 1000);
        assert_eq!(due.len(), 1);
    }

    #[test]
    fn test_start_task_basic() {
        let mut s = default_scheduler();
        let id = schedule_once(&mut s, 1, 1000, TaskPriority::Normal, 0).unwrap();
        start_task(&mut s, id, 1000).unwrap();
        assert_eq!(get_task(&s, id).unwrap().status, TaskStatus::Running);
        assert_eq!(get_task(&s, id).unwrap().last_run, Some(1000));
    }

    #[test]
    fn test_start_task_when_paused() {
        let mut s = default_scheduler();
        let id = schedule_once(&mut s, 1, 1000, TaskPriority::Normal, 0).unwrap();
        pause_scheduler(&mut s);
        let r = start_task(&mut s, id, 1000);
        assert_eq!(r, Err(SchedulerError::SchedulerPaused));
    }

    #[test]
    fn test_start_task_max_concurrent() {
        let mut s = create_scheduler(10000, 1);
        let id1 = schedule_once(&mut s, 1, 1000, TaskPriority::Normal, 0).unwrap();
        let id2 = schedule_once(&mut s, 2, 1000, TaskPriority::Normal, 0).unwrap();
        start_task(&mut s, id1, 1000).unwrap();
        let r = start_task(&mut s, id2, 1000);
        assert_eq!(r, Err(SchedulerError::MaxConcurrentReached));
    }

    #[test]
    fn test_start_task_already_running() {
        let mut s = default_scheduler();
        let id = schedule_once(&mut s, 1, 1000, TaskPriority::Normal, 0).unwrap();
        start_task(&mut s, id, 1000).unwrap();
        let r = start_task(&mut s, id, 1100);
        assert_eq!(r, Err(SchedulerError::AlreadyRunning));
    }

    #[test]
    fn test_start_cancelled_task() {
        let mut s = default_scheduler();
        let id = schedule_once(&mut s, 1, 1000, TaskPriority::Normal, 0).unwrap();
        cancel_task(&mut s, id).unwrap();
        let r = start_task(&mut s, id, 1000);
        assert_eq!(r, Err(SchedulerError::CancelledTask));
    }

    #[test]
    fn test_start_expired_task() {
        let mut s = default_scheduler();
        let id = schedule_once(&mut s, 1, 1000, TaskPriority::Normal, 0).unwrap();
        start_task(&mut s, id, 1000).unwrap();
        complete_task(
            &mut s,
            id,
            TaskResult {
                task_id: id,
                success: true,
                started_at: 1000,
                completed_at: 1500,
                gas_used: 100,
                error_code: None,
            },
        )
        .unwrap();
        // Task is completed and max_runs=1, so expired
        let r = start_task(&mut s, id, 2000);
        assert_eq!(r, Err(SchedulerError::TaskExpired));
    }

    #[test]
    fn test_start_nonexistent_task() {
        let mut s = default_scheduler();
        let r = start_task(&mut s, 999, 1000);
        assert_eq!(r, Err(SchedulerError::TaskNotFound));
    }

    #[test]
    fn test_complete_task_once() {
        let mut s = default_scheduler();
        let id = schedule_once(&mut s, 1, 1000, TaskPriority::Normal, 0).unwrap();
        start_task(&mut s, id, 1000).unwrap();
        complete_task(
            &mut s,
            id,
            TaskResult {
                task_id: id,
                success: true,
                started_at: 1000,
                completed_at: 1500,
                gas_used: 200,
                error_code: None,
            },
        )
        .unwrap();
        let task = get_task(&s, id).unwrap();
        assert_eq!(task.status, TaskStatus::Completed);
        assert_eq!(task.run_count, 1);
        assert_eq!(s.results.len(), 1);
    }

    #[test]
    fn test_complete_recurring_reschedules() {
        let mut s = default_scheduler();
        let id = schedule_recurring(
            &mut s,
            1,
            RecurrenceType::BatchCycle,
            1000,
            Some(5),
            0,
        )
        .unwrap();
        start_task(&mut s, id, 1000).unwrap();
        complete_task(
            &mut s,
            id,
            TaskResult {
                task_id: id,
                success: true,
                started_at: 1000,
                completed_at: 1500,
                gas_used: 100,
                error_code: None,
            },
        )
        .unwrap();
        let task = get_task(&s, id).unwrap();
        assert_eq!(task.status, TaskStatus::Pending);
        assert_eq!(task.run_count, 1);
        // next_run should be 1500 + 10000 = 11500
        assert_eq!(task.next_run, 1500 + DEFAULT_BATCH_CYCLE_MS);
    }

    #[test]
    fn test_complete_recurring_last_run_completes() {
        let mut s = default_scheduler();
        let id = schedule_recurring(
            &mut s,
            1,
            RecurrenceType::BatchCycle,
            1000,
            Some(1),
            0,
        )
        .unwrap();
        start_task(&mut s, id, 1000).unwrap();
        complete_task(
            &mut s,
            id,
            TaskResult {
                task_id: id,
                success: true,
                started_at: 1000,
                completed_at: 1500,
                gas_used: 100,
                error_code: None,
            },
        )
        .unwrap();
        let task = get_task(&s, id).unwrap();
        assert_eq!(task.status, TaskStatus::Completed);
    }

    #[test]
    fn test_complete_not_running_fails() {
        let mut s = default_scheduler();
        let id = schedule_once(&mut s, 1, 1000, TaskPriority::Normal, 0).unwrap();
        let r = complete_task(
            &mut s,
            id,
            TaskResult {
                task_id: id,
                success: true,
                started_at: 1000,
                completed_at: 1500,
                gas_used: 0,
                error_code: None,
            },
        );
        assert_eq!(r, Err(SchedulerError::TaskNotFound));
    }

    #[test]
    fn test_fail_task_basic() {
        let mut s = default_scheduler();
        let id = schedule_once(&mut s, 1, 1000, TaskPriority::Normal, 0).unwrap();
        start_task(&mut s, id, 1000).unwrap();
        fail_task(&mut s, id, 42, 1500).unwrap();
        let task = get_task(&s, id).unwrap();
        assert_eq!(task.status, TaskStatus::Failed);
        assert_eq!(s.results.len(), 1);
        assert_eq!(s.results[0].error_code, Some(42));
        assert!(!s.results[0].success);
    }

    #[test]
    fn test_fail_task_not_running() {
        let mut s = default_scheduler();
        let id = schedule_once(&mut s, 1, 1000, TaskPriority::Normal, 0).unwrap();
        let r = fail_task(&mut s, id, 1, 1500);
        assert_eq!(r, Err(SchedulerError::TaskNotFound));
    }

    #[test]
    fn test_fail_nonexistent_task() {
        let mut s = default_scheduler();
        let r = fail_task(&mut s, 999, 1, 1500);
        assert_eq!(r, Err(SchedulerError::TaskNotFound));
    }

    #[test]
    fn test_running_tasks() {
        let mut s = default_scheduler();
        let id1 = schedule_once(&mut s, 1, 1000, TaskPriority::Normal, 0).unwrap();
        let _id2 = schedule_once(&mut s, 2, 1000, TaskPriority::Normal, 0).unwrap();
        start_task(&mut s, id1, 1000).unwrap();

        let running = running_tasks(&s);
        assert_eq!(running.len(), 1);
        assert_eq!(running[0].task_id, id1);
    }

    #[test]
    fn test_running_count() {
        let mut s = default_scheduler();
        assert_eq!(running_count(&s), 0);
        let id = schedule_once(&mut s, 1, 1000, TaskPriority::Normal, 0).unwrap();
        start_task(&mut s, id, 1000).unwrap();
        assert_eq!(running_count(&s), 1);
    }

    // ============ Recurrence Tests ============

    #[test]
    fn test_next_run_time_once() {
        assert_eq!(next_run_time(&RecurrenceType::Once, 5000, 10000), 5000);
    }

    #[test]
    fn test_next_run_time_every_n_blocks() {
        assert_eq!(
            next_run_time(&RecurrenceType::EveryNBlocks(100), 5000, 10000),
            5100
        );
    }

    #[test]
    fn test_next_run_time_every_n_seconds() {
        assert_eq!(
            next_run_time(&RecurrenceType::EveryNSeconds(60), 5000, 10000),
            65000
        );
    }

    #[test]
    fn test_next_run_time_epoch_boundary() {
        assert_eq!(
            next_run_time(&RecurrenceType::EpochBoundary, 5000, 10000),
            5000 + EPOCH_MS
        );
    }

    #[test]
    fn test_next_run_time_batch_cycle() {
        assert_eq!(
            next_run_time(&RecurrenceType::BatchCycle, 5000, 10000),
            15000
        );
    }

    #[test]
    fn test_next_run_time_daily() {
        assert_eq!(
            next_run_time(&RecurrenceType::Daily, 5000, 10000),
            5000 + DAY_MS
        );
    }

    #[test]
    fn test_next_run_time_weekly() {
        assert_eq!(
            next_run_time(&RecurrenceType::Weekly, 5000, 10000),
            5000 + WEEK_MS
        );
    }

    #[test]
    fn test_next_run_time_saturating() {
        // Near u64::MAX, should not overflow
        let r = next_run_time(&RecurrenceType::Weekly, u64::MAX - 100, 10000);
        assert_eq!(r, u64::MAX);
    }

    #[test]
    fn test_recurrence_interval_once() {
        assert_eq!(recurrence_interval_ms(&RecurrenceType::Once, 10000), 0);
    }

    #[test]
    fn test_recurrence_interval_blocks() {
        assert_eq!(
            recurrence_interval_ms(&RecurrenceType::EveryNBlocks(50), 10000),
            50
        );
    }

    #[test]
    fn test_recurrence_interval_seconds() {
        assert_eq!(
            recurrence_interval_ms(&RecurrenceType::EveryNSeconds(120), 10000),
            120_000
        );
    }

    #[test]
    fn test_recurrence_interval_epoch() {
        assert_eq!(
            recurrence_interval_ms(&RecurrenceType::EpochBoundary, 10000),
            EPOCH_MS
        );
    }

    #[test]
    fn test_recurrence_interval_batch() {
        assert_eq!(
            recurrence_interval_ms(&RecurrenceType::BatchCycle, 10000),
            10000
        );
    }

    #[test]
    fn test_recurrence_interval_daily() {
        assert_eq!(
            recurrence_interval_ms(&RecurrenceType::Daily, 10000),
            DAY_MS
        );
    }

    #[test]
    fn test_recurrence_interval_weekly() {
        assert_eq!(
            recurrence_interval_ms(&RecurrenceType::Weekly, 10000),
            WEEK_MS
        );
    }

    #[test]
    fn test_remaining_runs_unlimited() {
        let task = make_task(1, TaskPriority::Normal, RecurrenceType::Daily, None, 0);
        assert_eq!(remaining_runs(&task), None);
    }

    #[test]
    fn test_remaining_runs_limited() {
        let mut task = make_task(1, TaskPriority::Normal, RecurrenceType::Daily, Some(10), 0);
        assert_eq!(remaining_runs(&task), Some(10));
        task.run_count = 3;
        assert_eq!(remaining_runs(&task), Some(7));
    }

    #[test]
    fn test_remaining_runs_exhausted() {
        let mut task = make_task(1, TaskPriority::Normal, RecurrenceType::Daily, Some(5), 0);
        task.run_count = 5;
        assert_eq!(remaining_runs(&task), Some(0));
    }

    #[test]
    fn test_remaining_runs_over_max() {
        let mut task = make_task(1, TaskPriority::Normal, RecurrenceType::Daily, Some(3), 0);
        task.run_count = 10;
        // saturating_sub means 0
        assert_eq!(remaining_runs(&task), Some(0));
    }

    #[test]
    fn test_is_expired_false_unlimited() {
        let task = make_task(1, TaskPriority::Normal, RecurrenceType::Daily, None, 0);
        assert!(!is_expired(&task));
    }

    #[test]
    fn test_is_expired_false_under_max() {
        let mut task = make_task(1, TaskPriority::Normal, RecurrenceType::Daily, Some(5), 0);
        task.run_count = 3;
        assert!(!is_expired(&task));
    }

    #[test]
    fn test_is_expired_true_at_max() {
        let mut task = make_task(1, TaskPriority::Normal, RecurrenceType::Daily, Some(5), 0);
        task.run_count = 5;
        assert!(is_expired(&task));
    }

    #[test]
    fn test_is_expired_true_over_max() {
        let mut task = make_task(1, TaskPriority::Normal, RecurrenceType::Daily, Some(5), 0);
        task.run_count = 10;
        assert!(is_expired(&task));
    }

    // ============ Epoch Management Tests ============

    #[test]
    fn test_create_epoch() {
        let epoch = create_epoch(1, 1000, 50000, EPOCH_MS, 10000);
        assert_eq!(epoch.epoch_number, 1);
        assert_eq!(epoch.start_block, 1000);
        assert_eq!(epoch.start_time, 50000);
        assert_eq!(epoch.duration_ms, EPOCH_MS);
        assert_eq!(epoch.batch_count, EPOCH_MS / 10000);
    }

    #[test]
    fn test_create_epoch_zero_batch_cycle() {
        let epoch = create_epoch(1, 0, 0, EPOCH_MS, 0);
        assert_eq!(epoch.batch_count, 0);
    }

    #[test]
    fn test_create_epoch_end_block() {
        let epoch = create_epoch(1, 1000, 0, 60_000, 10000);
        // 60000/1000 = 60 blocks
        assert_eq!(epoch.end_block, 1060);
    }

    #[test]
    fn test_advance_epoch_no_tasks() {
        let mut s = default_scheduler();
        let count = advance_epoch(&mut s, 1);
        assert_eq!(count, 0);
        assert_eq!(s.current_epoch, 1);
    }

    #[test]
    fn test_advance_epoch_triggers_epoch_tasks() {
        let mut s = default_scheduler();
        schedule_recurring(
            &mut s,
            1,
            RecurrenceType::EpochBoundary,
            0,
            None,
            0,
        )
        .unwrap();
        // Complete a run so it becomes Completed
        let id = s.tasks[0].task_id;
        start_task(&mut s, id, 0).unwrap();
        complete_task(
            &mut s,
            id,
            TaskResult {
                task_id: id,
                success: true,
                started_at: 0,
                completed_at: 100,
                gas_used: 0,
                error_code: None,
            },
        )
        .unwrap();

        let count = advance_epoch(&mut s, 1);
        assert_eq!(count, 1);
        assert_eq!(get_task(&s, id).unwrap().status, TaskStatus::Pending);
    }

    #[test]
    fn test_advance_epoch_skips_cancelled() {
        let mut s = default_scheduler();
        let id = schedule_recurring(
            &mut s,
            1,
            RecurrenceType::EpochBoundary,
            0,
            None,
            0,
        )
        .unwrap();
        cancel_task(&mut s, id).unwrap();
        let count = advance_epoch(&mut s, 1);
        assert_eq!(count, 0);
    }

    #[test]
    fn test_advance_epoch_skips_expired() {
        let mut s = default_scheduler();
        let id = schedule_recurring(
            &mut s,
            1,
            RecurrenceType::EpochBoundary,
            0,
            Some(1),
            0,
        )
        .unwrap();
        start_task(&mut s, id, 0).unwrap();
        complete_task(
            &mut s,
            id,
            TaskResult {
                task_id: id,
                success: true,
                started_at: 0,
                completed_at: 100,
                gas_used: 0,
                error_code: None,
            },
        )
        .unwrap();
        // Now expired (max_runs=1, run_count=1) and Completed
        let count = advance_epoch(&mut s, 1);
        assert_eq!(count, 0);
    }

    #[test]
    fn test_advance_epoch_skips_non_epoch_tasks() {
        let mut s = default_scheduler();
        schedule_recurring(
            &mut s,
            1,
            RecurrenceType::Daily,
            0,
            None,
            0,
        )
        .unwrap();
        let count = advance_epoch(&mut s, 1);
        // Daily task is Pending but not EpochBoundary — gets counted because
        // it matches status=Pending and recurrence=EpochBoundary... wait, it shouldn't.
        // Actually it's Daily so it should NOT be counted.
        assert_eq!(count, 0);
    }

    #[test]
    fn test_batches_per_epoch_standard() {
        assert_eq!(batches_per_epoch(EPOCH_MS, 10000), EPOCH_MS / 10000);
    }

    #[test]
    fn test_batches_per_epoch_zero_cycle() {
        assert_eq!(batches_per_epoch(EPOCH_MS, 0), 0);
    }

    #[test]
    fn test_batches_per_epoch_larger_than_epoch() {
        assert_eq!(batches_per_epoch(10000, 20000), 0);
    }

    #[test]
    fn test_current_batch_in_epoch_start() {
        assert_eq!(current_batch_in_epoch(1000, 1000, 10000), 0);
    }

    #[test]
    fn test_current_batch_in_epoch_first_batch() {
        assert_eq!(current_batch_in_epoch(1000, 5000, 10000), 0);
    }

    #[test]
    fn test_current_batch_in_epoch_second_batch() {
        assert_eq!(current_batch_in_epoch(1000, 11001, 10000), 1);
    }

    #[test]
    fn test_current_batch_in_epoch_before_epoch() {
        assert_eq!(current_batch_in_epoch(5000, 3000, 10000), 0);
    }

    #[test]
    fn test_current_batch_in_epoch_zero_cycle() {
        assert_eq!(current_batch_in_epoch(1000, 5000, 0), 0);
    }

    #[test]
    fn test_epoch_progress_bps_start() {
        let epoch = create_epoch(1, 0, 1000, 10000, 10000);
        assert_eq!(epoch_progress_bps(&epoch, 1000), 0);
    }

    #[test]
    fn test_epoch_progress_bps_half() {
        let epoch = create_epoch(1, 0, 0, 10000, 10000);
        assert_eq!(epoch_progress_bps(&epoch, 5000), 5000);
    }

    #[test]
    fn test_epoch_progress_bps_end() {
        let epoch = create_epoch(1, 0, 0, 10000, 10000);
        assert_eq!(epoch_progress_bps(&epoch, 10000), BPS);
    }

    #[test]
    fn test_epoch_progress_bps_past_end() {
        let epoch = create_epoch(1, 0, 0, 10000, 10000);
        assert_eq!(epoch_progress_bps(&epoch, 20000), BPS);
    }

    #[test]
    fn test_epoch_progress_bps_before_start() {
        let epoch = create_epoch(1, 0, 5000, 10000, 10000);
        assert_eq!(epoch_progress_bps(&epoch, 3000), 0);
    }

    #[test]
    fn test_epoch_progress_bps_zero_duration() {
        let epoch = create_epoch(1, 0, 0, 0, 10000);
        assert_eq!(epoch_progress_bps(&epoch, 5000), 0);
    }

    #[test]
    fn test_epoch_progress_bps_quarter() {
        let epoch = create_epoch(1, 0, 0, 10000, 10000);
        assert_eq!(epoch_progress_bps(&epoch, 2500), 2500);
    }

    // ============ Query Tests ============

    #[test]
    fn test_get_task_found() {
        let mut s = default_scheduler();
        let id = schedule_once(&mut s, 5, 1000, TaskPriority::High, 77).unwrap();
        let task = get_task(&s, id).unwrap();
        assert_eq!(task.task_type, 5);
        assert_eq!(task.data, 77);
    }

    #[test]
    fn test_get_task_not_found() {
        let s = default_scheduler();
        assert!(get_task(&s, 999).is_none());
    }

    #[test]
    fn test_tasks_by_type() {
        let mut s = default_scheduler();
        schedule_once(&mut s, 1, 1000, TaskPriority::Normal, 0).unwrap();
        schedule_once(&mut s, 2, 1000, TaskPriority::Normal, 0).unwrap();
        schedule_once(&mut s, 1, 2000, TaskPriority::Normal, 0).unwrap();
        assert_eq!(tasks_by_type(&s, 1).len(), 2);
        assert_eq!(tasks_by_type(&s, 2).len(), 1);
        assert_eq!(tasks_by_type(&s, 3).len(), 0);
    }

    #[test]
    fn test_tasks_by_priority() {
        let mut s = default_scheduler();
        schedule_once(&mut s, 1, 1000, TaskPriority::High, 0).unwrap();
        schedule_once(&mut s, 2, 1000, TaskPriority::Low, 0).unwrap();
        schedule_once(&mut s, 3, 1000, TaskPriority::High, 0).unwrap();
        assert_eq!(tasks_by_priority(&s, &TaskPriority::High).len(), 2);
        assert_eq!(tasks_by_priority(&s, &TaskPriority::Low).len(), 1);
        assert_eq!(tasks_by_priority(&s, &TaskPriority::Critical).len(), 0);
    }

    #[test]
    fn test_tasks_by_status() {
        let mut s = default_scheduler();
        let id1 = schedule_once(&mut s, 1, 1000, TaskPriority::Normal, 0).unwrap();
        let _id2 = schedule_once(&mut s, 2, 2000, TaskPriority::Normal, 0).unwrap();
        start_task(&mut s, id1, 1000).unwrap();

        assert_eq!(tasks_by_status(&s, &TaskStatus::Running).len(), 1);
        assert_eq!(tasks_by_status(&s, &TaskStatus::Pending).len(), 1);
        assert_eq!(tasks_by_status(&s, &TaskStatus::Completed).len(), 0);
    }

    #[test]
    fn test_overdue_tasks_none() {
        let mut s = default_scheduler();
        schedule_once(&mut s, 1, 5000, TaskPriority::Normal, 0).unwrap();
        assert!(overdue_tasks(&s, 3000).is_empty());
    }

    #[test]
    fn test_overdue_tasks_found() {
        let mut s = default_scheduler();
        schedule_once(&mut s, 1, 1000, TaskPriority::Normal, 0).unwrap();
        schedule_once(&mut s, 2, 5000, TaskPriority::Normal, 0).unwrap();
        let overdue = overdue_tasks(&s, 3000);
        assert_eq!(overdue.len(), 1);
        assert_eq!(overdue[0].task_type, 1);
    }

    #[test]
    fn test_overdue_tasks_exact_boundary() {
        let mut s = default_scheduler();
        schedule_once(&mut s, 1, 1000, TaskPriority::Normal, 0).unwrap();
        // next_run == now is NOT overdue (it's due, not overdue)
        assert!(overdue_tasks(&s, 1000).is_empty());
    }

    #[test]
    fn test_task_count() {
        let mut s = default_scheduler();
        assert_eq!(task_count(&s), 0);
        schedule_once(&mut s, 1, 1000, TaskPriority::Normal, 0).unwrap();
        schedule_once(&mut s, 2, 2000, TaskPriority::Normal, 0).unwrap();
        assert_eq!(task_count(&s), 2);
    }

    #[test]
    fn test_pending_count() {
        let mut s = default_scheduler();
        let id1 = schedule_once(&mut s, 1, 1000, TaskPriority::Normal, 0).unwrap();
        schedule_once(&mut s, 2, 2000, TaskPriority::Normal, 0).unwrap();
        assert_eq!(pending_count(&s), 2);
        start_task(&mut s, id1, 1000).unwrap();
        assert_eq!(pending_count(&s), 1);
    }

    // ============ Timeout & Cleanup Tests ============

    #[test]
    fn test_check_timeouts_none() {
        let mut s = default_scheduler();
        let id = schedule_once(&mut s, 1, 1000, TaskPriority::Normal, 0).unwrap();
        start_task(&mut s, id, 1000).unwrap();
        // Not timed out yet (timeout is DEFAULT_TIMEOUT_MS=30000)
        assert_eq!(check_timeouts(&mut s, 2000), 0);
    }

    #[test]
    fn test_check_timeouts_timed_out() {
        let mut s = default_scheduler();
        let id = schedule_task(
            &mut s,
            1,
            TaskPriority::Normal,
            RecurrenceType::Once,
            1000,
            5000,
            0,
        )
        .unwrap();
        start_task(&mut s, id, 1000).unwrap();
        // 5001ms later, timeout_ms=5000
        let count = check_timeouts(&mut s, 6001);
        assert_eq!(count, 1);
        assert_eq!(get_task(&s, id).unwrap().status, TaskStatus::Failed);
        assert_eq!(s.results.len(), 1);
        assert_eq!(s.results[0].error_code, Some(9999));
    }

    #[test]
    fn test_check_timeouts_multiple() {
        let mut s = create_scheduler(10000, 10);
        let id1 = schedule_task(
            &mut s,
            1,
            TaskPriority::Normal,
            RecurrenceType::Once,
            1000,
            5000,
            0,
        )
        .unwrap();
        let id2 = schedule_task(
            &mut s,
            2,
            TaskPriority::Normal,
            RecurrenceType::Once,
            1000,
            5000,
            0,
        )
        .unwrap();
        start_task(&mut s, id1, 1000).unwrap();
        start_task(&mut s, id2, 1000).unwrap();
        let count = check_timeouts(&mut s, 7000);
        assert_eq!(count, 2);
    }

    #[test]
    fn test_check_timeouts_exact_boundary() {
        let mut s = default_scheduler();
        let id = schedule_task(
            &mut s,
            1,
            TaskPriority::Normal,
            RecurrenceType::Once,
            1000,
            5000,
            0,
        )
        .unwrap();
        start_task(&mut s, id, 1000).unwrap();
        // Exactly at timeout (6000 - 1000 = 5000, not > 5000)
        assert_eq!(check_timeouts(&mut s, 6000), 0);
    }

    #[test]
    fn test_cleanup_completed_removes_tasks() {
        let mut s = default_scheduler();
        let id = schedule_once(&mut s, 1, 1000, TaskPriority::Normal, 0).unwrap();
        start_task(&mut s, id, 1000).unwrap();
        complete_task(
            &mut s,
            id,
            TaskResult {
                task_id: id,
                success: true,
                started_at: 1000,
                completed_at: 1500,
                gas_used: 0,
                error_code: None,
            },
        )
        .unwrap();
        let removed = cleanup_completed(&mut s, 100);
        assert_eq!(removed, 1);
        assert_eq!(task_count(&s), 0);
    }

    #[test]
    fn test_cleanup_completed_preserves_pending() {
        let mut s = default_scheduler();
        let id1 = schedule_once(&mut s, 1, 1000, TaskPriority::Normal, 0).unwrap();
        schedule_once(&mut s, 2, 2000, TaskPriority::Normal, 0).unwrap();
        start_task(&mut s, id1, 1000).unwrap();
        complete_task(
            &mut s,
            id1,
            TaskResult {
                task_id: id1,
                success: true,
                started_at: 1000,
                completed_at: 1500,
                gas_used: 0,
                error_code: None,
            },
        )
        .unwrap();
        cleanup_completed(&mut s, 100);
        assert_eq!(task_count(&s), 1);
        assert_eq!(pending_count(&s), 1);
    }

    #[test]
    fn test_cleanup_completed_trims_results() {
        let mut s = default_scheduler();
        // Add many results
        for i in 0..20 {
            s.results.push(TaskResult {
                task_id: i,
                success: true,
                started_at: 0,
                completed_at: 100,
                gas_used: 0,
                error_code: None,
            });
        }
        cleanup_completed(&mut s, 5);
        assert_eq!(s.results.len(), 5);
    }

    #[test]
    fn test_prune_cancelled() {
        let mut s = default_scheduler();
        let id1 = schedule_once(&mut s, 1, 1000, TaskPriority::Normal, 0).unwrap();
        schedule_once(&mut s, 2, 2000, TaskPriority::Normal, 0).unwrap();
        cancel_task(&mut s, id1).unwrap();
        let removed = prune_cancelled(&mut s);
        assert_eq!(removed, 1);
        assert_eq!(task_count(&s), 1);
    }

    #[test]
    fn test_prune_cancelled_nothing_to_prune() {
        let mut s = default_scheduler();
        schedule_once(&mut s, 1, 1000, TaskPriority::Normal, 0).unwrap();
        assert_eq!(prune_cancelled(&mut s), 0);
    }

    #[test]
    fn test_mark_overdue() {
        let mut s = default_scheduler();
        schedule_once(&mut s, 1, 1000, TaskPriority::Normal, 0).unwrap();
        schedule_once(&mut s, 2, 5000, TaskPriority::Normal, 0).unwrap();
        let count = mark_overdue(&mut s, 3000);
        assert_eq!(count, 1);
        assert_eq!(
            tasks_by_status(&s, &TaskStatus::Overdue).len(),
            1
        );
    }

    #[test]
    fn test_mark_overdue_exact_boundary_not_overdue() {
        let mut s = default_scheduler();
        schedule_once(&mut s, 1, 1000, TaskPriority::Normal, 0).unwrap();
        // next_run == now is due, not overdue
        assert_eq!(mark_overdue(&mut s, 1000), 0);
    }

    #[test]
    fn test_mark_overdue_skips_running() {
        let mut s = default_scheduler();
        let id = schedule_once(&mut s, 1, 1000, TaskPriority::Normal, 0).unwrap();
        start_task(&mut s, id, 1000).unwrap();
        assert_eq!(mark_overdue(&mut s, 5000), 0);
    }

    // ============ Analytics Tests ============

    #[test]
    fn test_compute_stats_empty() {
        let s = default_scheduler();
        let stats = compute_stats(&s);
        assert_eq!(stats.total_tasks, 0);
        assert_eq!(stats.pending_tasks, 0);
        assert_eq!(stats.completed_tasks, 0);
        assert_eq!(stats.failed_tasks, 0);
        assert_eq!(stats.success_rate_bps, 0);
    }

    #[test]
    fn test_compute_stats_mixed() {
        let mut s = default_scheduler();
        // Two pending
        schedule_once(&mut s, 1, 1000, TaskPriority::Normal, 0).unwrap();
        schedule_once(&mut s, 2, 2000, TaskPriority::Normal, 0).unwrap();
        // One running
        let id3 = schedule_once(&mut s, 3, 500, TaskPriority::Normal, 0).unwrap();
        start_task(&mut s, id3, 500).unwrap();

        let stats = compute_stats(&s);
        assert_eq!(stats.total_tasks, 3);
        assert_eq!(stats.pending_tasks, 2);
    }

    #[test]
    fn test_compute_stats_with_epoch() {
        let mut s = default_scheduler();
        s.current_epoch = 5;
        // Add 10 results
        for i in 0..10 {
            s.results.push(TaskResult {
                task_id: i,
                success: true,
                started_at: 0,
                completed_at: 100,
                gas_used: 0,
                error_code: None,
            });
        }
        let stats = compute_stats(&s);
        assert_eq!(stats.tasks_per_epoch, 2); // 10 / 5
    }

    #[test]
    fn test_avg_execution_time_empty() {
        let s = default_scheduler();
        assert_eq!(avg_execution_time(&s), 0);
    }

    #[test]
    fn test_avg_execution_time_single() {
        let mut s = default_scheduler();
        s.results.push(TaskResult {
            task_id: 1,
            success: true,
            started_at: 1000,
            completed_at: 1500,
            gas_used: 0,
            error_code: None,
        });
        assert_eq!(avg_execution_time(&s), 500);
    }

    #[test]
    fn test_avg_execution_time_multiple() {
        let mut s = default_scheduler();
        s.results.push(TaskResult {
            task_id: 1,
            success: true,
            started_at: 0,
            completed_at: 100,
            gas_used: 0,
            error_code: None,
        });
        s.results.push(TaskResult {
            task_id: 2,
            success: true,
            started_at: 0,
            completed_at: 300,
            gas_used: 0,
            error_code: None,
        });
        assert_eq!(avg_execution_time(&s), 200); // (100+300)/2
    }

    #[test]
    fn test_success_rate_empty() {
        let s = default_scheduler();
        assert_eq!(success_rate(&s), 0);
    }

    #[test]
    fn test_success_rate_all_success() {
        let mut s = default_scheduler();
        for _ in 0..5 {
            s.results.push(TaskResult {
                task_id: 1,
                success: true,
                started_at: 0,
                completed_at: 100,
                gas_used: 0,
                error_code: None,
            });
        }
        assert_eq!(success_rate(&s), BPS);
    }

    #[test]
    fn test_success_rate_half() {
        let mut s = default_scheduler();
        for i in 0..10 {
            s.results.push(TaskResult {
                task_id: i,
                success: i < 5,
                started_at: 0,
                completed_at: 100,
                gas_used: 0,
                error_code: if i >= 5 { Some(1) } else { None },
            });
        }
        assert_eq!(success_rate(&s), 5000);
    }

    #[test]
    fn test_success_rate_none_succeed() {
        let mut s = default_scheduler();
        for _ in 0..3 {
            s.results.push(TaskResult {
                task_id: 1,
                success: false,
                started_at: 0,
                completed_at: 100,
                gas_used: 0,
                error_code: Some(1),
            });
        }
        assert_eq!(success_rate(&s), 0);
    }

    #[test]
    fn test_task_throughput_none() {
        let s = default_scheduler();
        assert_eq!(task_throughput(&s, 10000, 50000), 0);
    }

    #[test]
    fn test_task_throughput_in_window() {
        let mut s = default_scheduler();
        s.results.push(TaskResult {
            task_id: 1,
            success: true,
            started_at: 45000,
            completed_at: 48000,
            gas_used: 0,
            error_code: None,
        });
        s.results.push(TaskResult {
            task_id: 2,
            success: true,
            started_at: 30000,
            completed_at: 35000,
            gas_used: 0,
            error_code: None,
        });
        // Window: 40000-50000
        assert_eq!(task_throughput(&s, 10000, 50000), 1);
    }

    #[test]
    fn test_task_throughput_excludes_failures() {
        let mut s = default_scheduler();
        s.results.push(TaskResult {
            task_id: 1,
            success: false,
            started_at: 45000,
            completed_at: 48000,
            gas_used: 0,
            error_code: Some(1),
        });
        assert_eq!(task_throughput(&s, 10000, 50000), 0);
    }

    #[test]
    fn test_most_failed_task_type_none() {
        let s = default_scheduler();
        assert_eq!(most_failed_task_type(&s), None);
    }

    #[test]
    fn test_most_failed_task_type_found() {
        let mut s = default_scheduler();
        schedule_once(&mut s, 10, 1000, TaskPriority::Normal, 0).unwrap(); // task_id=1
        schedule_once(&mut s, 20, 1000, TaskPriority::Normal, 0).unwrap(); // task_id=2
        schedule_once(&mut s, 10, 2000, TaskPriority::Normal, 0).unwrap(); // task_id=3

        // task_type 10 fails twice, task_type 20 fails once
        s.results.push(TaskResult {
            task_id: 1,
            success: false,
            started_at: 0,
            completed_at: 100,
            gas_used: 0,
            error_code: Some(1),
        });
        s.results.push(TaskResult {
            task_id: 2,
            success: false,
            started_at: 0,
            completed_at: 100,
            gas_used: 0,
            error_code: Some(1),
        });
        s.results.push(TaskResult {
            task_id: 3,
            success: false,
            started_at: 0,
            completed_at: 100,
            gas_used: 0,
            error_code: Some(1),
        });

        assert_eq!(most_failed_task_type(&s), Some(10));
    }

    #[test]
    fn test_most_failed_task_type_all_success() {
        let mut s = default_scheduler();
        s.results.push(TaskResult {
            task_id: 1,
            success: true,
            started_at: 0,
            completed_at: 100,
            gas_used: 0,
            error_code: None,
        });
        assert_eq!(most_failed_task_type(&s), None);
    }

    #[test]
    fn test_gas_usage_total_empty() {
        let s = default_scheduler();
        assert_eq!(gas_usage_total(&s), 0);
    }

    #[test]
    fn test_gas_usage_total() {
        let mut s = default_scheduler();
        s.results.push(TaskResult {
            task_id: 1,
            success: true,
            started_at: 0,
            completed_at: 100,
            gas_used: 1000,
            error_code: None,
        });
        s.results.push(TaskResult {
            task_id: 2,
            success: true,
            started_at: 0,
            completed_at: 100,
            gas_used: 2500,
            error_code: None,
        });
        assert_eq!(gas_usage_total(&s), 3500);
    }

    #[test]
    fn test_gas_usage_total_large_values() {
        let mut s = default_scheduler();
        s.results.push(TaskResult {
            task_id: 1,
            success: true,
            started_at: 0,
            completed_at: 100,
            gas_used: u64::MAX,
            error_code: None,
        });
        s.results.push(TaskResult {
            task_id: 2,
            success: true,
            started_at: 0,
            completed_at: 100,
            gas_used: u64::MAX,
            error_code: None,
        });
        // u128 handles this without overflow
        assert_eq!(gas_usage_total(&s), u64::MAX as u128 * 2);
    }

    // ============ Batch Auction Integration Tests ============

    #[test]
    fn test_next_batch_start_aligned() {
        // Already at batch boundary
        assert_eq!(next_batch_start(10000, 10000), 10000);
    }

    #[test]
    fn test_next_batch_start_mid_cycle() {
        assert_eq!(next_batch_start(13000, 10000), 20000);
    }

    #[test]
    fn test_next_batch_start_just_after_boundary() {
        assert_eq!(next_batch_start(10001, 10000), 20000);
    }

    #[test]
    fn test_next_batch_start_zero_cycle() {
        assert_eq!(next_batch_start(5000, 0), 5000);
    }

    #[test]
    fn test_next_batch_start_from_zero() {
        assert_eq!(next_batch_start(0, 10000), 0);
    }

    #[test]
    fn test_is_in_commit_phase_start() {
        // At batch start, position=0 < commit_duration=8000
        assert!(is_in_commit_phase(0, 10000, 8000));
    }

    #[test]
    fn test_is_in_commit_phase_mid() {
        // Position 3000 < 8000
        assert!(is_in_commit_phase(3000, 10000, 8000));
    }

    #[test]
    fn test_is_in_commit_phase_boundary() {
        // Position 8000, not < 8000
        assert!(!is_in_commit_phase(8000, 10000, 8000));
    }

    #[test]
    fn test_is_in_commit_phase_in_reveal() {
        assert!(!is_in_commit_phase(9000, 10000, 8000));
    }

    #[test]
    fn test_is_in_commit_phase_second_cycle() {
        // Time 13000 -> position = 13000 % 10000 = 3000 < 8000
        assert!(is_in_commit_phase(13000, 10000, 8000));
    }

    #[test]
    fn test_is_in_commit_phase_zero_cycle() {
        assert!(!is_in_commit_phase(5000, 0, 8000));
    }

    #[test]
    fn test_is_in_reveal_phase_in_reveal() {
        // Position 9000: >= 8000 and < 10000
        assert!(is_in_reveal_phase(9000, 10000, 8000));
    }

    #[test]
    fn test_is_in_reveal_phase_at_boundary() {
        // Position 8000: >= 8000 and < 10000
        assert!(is_in_reveal_phase(8000, 10000, 8000));
    }

    #[test]
    fn test_is_in_reveal_phase_in_commit() {
        assert!(!is_in_reveal_phase(3000, 10000, 8000));
    }

    #[test]
    fn test_is_in_reveal_phase_at_cycle_end() {
        // Position 9999: >= 8000 and < 10000
        assert!(is_in_reveal_phase(9999, 10000, 8000));
    }

    #[test]
    fn test_is_in_reveal_phase_zero_cycle() {
        assert!(!is_in_reveal_phase(5000, 0, 8000));
    }

    #[test]
    fn test_commit_reveal_complementary() {
        // For every point in the cycle, exactly one of commit/reveal is true
        let batch = 10000;
        let commit_dur = 8000;
        for t in 0..batch {
            let in_commit = is_in_commit_phase(t, batch, commit_dur);
            let in_reveal = is_in_reveal_phase(t, batch, commit_dur);
            assert!(
                in_commit ^ in_reveal,
                "t={}: commit={}, reveal={}",
                t,
                in_commit,
                in_reveal
            );
        }
    }

    // ============ Integration / End-to-End Tests ============

    #[test]
    fn test_full_task_lifecycle() {
        let mut s = default_scheduler();
        let id = schedule_once(&mut s, 1, 1000, TaskPriority::Normal, 42).unwrap();

        // Check it's due
        let due = due_tasks(&s, 1000);
        assert_eq!(due.len(), 1);

        // Start it
        start_task(&mut s, id, 1000).unwrap();
        assert_eq!(running_count(&s), 1);

        // Complete it
        complete_task(
            &mut s,
            id,
            TaskResult {
                task_id: id,
                success: true,
                started_at: 1000,
                completed_at: 1200,
                gas_used: 500,
                error_code: None,
            },
        )
        .unwrap();

        assert_eq!(get_task(&s, id).unwrap().status, TaskStatus::Completed);
        assert_eq!(running_count(&s), 0);
        assert_eq!(s.results.len(), 1);
    }

    #[test]
    fn test_recurring_task_multiple_cycles() {
        let mut s = default_scheduler();
        let id = schedule_recurring(
            &mut s,
            1,
            RecurrenceType::EveryNSeconds(10),
            1000,
            Some(3),
            0,
        )
        .unwrap();

        // Run 1
        start_task(&mut s, id, 1000).unwrap();
        complete_task(
            &mut s,
            id,
            TaskResult {
                task_id: id,
                success: true,
                started_at: 1000,
                completed_at: 1100,
                gas_used: 50,
                error_code: None,
            },
        )
        .unwrap();
        assert_eq!(get_task(&s, id).unwrap().run_count, 1);
        assert_eq!(get_task(&s, id).unwrap().status, TaskStatus::Pending);
        assert_eq!(get_task(&s, id).unwrap().next_run, 11100); // 1100 + 10*1000

        // Run 2
        start_task(&mut s, id, 11100).unwrap();
        complete_task(
            &mut s,
            id,
            TaskResult {
                task_id: id,
                success: true,
                started_at: 11100,
                completed_at: 11200,
                gas_used: 50,
                error_code: None,
            },
        )
        .unwrap();
        assert_eq!(get_task(&s, id).unwrap().run_count, 2);
        assert_eq!(get_task(&s, id).unwrap().status, TaskStatus::Pending);

        // Run 3 (final)
        start_task(&mut s, id, 21200).unwrap();
        complete_task(
            &mut s,
            id,
            TaskResult {
                task_id: id,
                success: true,
                started_at: 21200,
                completed_at: 21300,
                gas_used: 50,
                error_code: None,
            },
        )
        .unwrap();
        assert_eq!(get_task(&s, id).unwrap().run_count, 3);
        assert_eq!(get_task(&s, id).unwrap().status, TaskStatus::Completed);
    }

    #[test]
    fn test_scheduler_pause_resume_lifecycle() {
        let mut s = default_scheduler();
        let id = schedule_once(&mut s, 1, 1000, TaskPriority::Normal, 0).unwrap();

        pause_scheduler(&mut s);
        assert_eq!(start_task(&mut s, id, 1000), Err(SchedulerError::SchedulerPaused));

        resume_scheduler(&mut s);
        start_task(&mut s, id, 1000).unwrap();
        assert_eq!(get_task(&s, id).unwrap().status, TaskStatus::Running);
    }

    #[test]
    fn test_timeout_and_cleanup_flow() {
        let mut s = create_scheduler(10000, 10);
        let id = schedule_task(
            &mut s,
            1,
            TaskPriority::Normal,
            RecurrenceType::Once,
            1000,
            2000,
            0,
        )
        .unwrap();
        start_task(&mut s, id, 1000).unwrap();

        // Check timeout at 3001 (2001ms elapsed > 2000ms timeout)
        let timed = check_timeouts(&mut s, 3001);
        assert_eq!(timed, 1);
        assert_eq!(get_task(&s, id).unwrap().status, TaskStatus::Failed);

        // Reschedule
        reschedule(&mut s, id, 5000).unwrap();
        assert_eq!(get_task(&s, id).unwrap().status, TaskStatus::Pending);
    }

    #[test]
    fn test_many_tasks_stress() {
        let mut s = default_scheduler();
        for i in 0..100 {
            schedule_once(&mut s, i as u32, i * 100, TaskPriority::Normal, 0).unwrap();
        }
        assert_eq!(task_count(&s), 100);
        let due = due_tasks(&s, 5000);
        // Tasks with next_run <= 5000: 0,100,200,...,5000 = 51 tasks
        assert_eq!(due.len(), 51);
    }

    #[test]
    fn test_concurrent_limit_respected() {
        let mut s = create_scheduler(10000, 3);
        let mut ids = Vec::new();
        for _ in 0..5 {
            ids.push(
                schedule_once(&mut s, 1, 1000, TaskPriority::Normal, 0).unwrap(),
            );
        }
        start_task(&mut s, ids[0], 1000).unwrap();
        start_task(&mut s, ids[1], 1000).unwrap();
        start_task(&mut s, ids[2], 1000).unwrap();
        assert_eq!(
            start_task(&mut s, ids[3], 1000),
            Err(SchedulerError::MaxConcurrentReached)
        );
        assert_eq!(running_count(&s), 3);
    }

    #[test]
    fn test_epoch_boundary_tasks_with_advance() {
        let mut s = default_scheduler();
        let id1 = schedule_recurring(
            &mut s,
            100,
            RecurrenceType::EpochBoundary,
            0,
            None,
            0,
        )
        .unwrap();
        let id2 = schedule_recurring(
            &mut s,
            200,
            RecurrenceType::EpochBoundary,
            0,
            None,
            0,
        )
        .unwrap();

        // Both are Pending, advance epoch should trigger both
        let count = advance_epoch(&mut s, 1);
        assert_eq!(count, 2);

        // Start and complete both
        start_task(&mut s, id1, EPOCH_MS).unwrap();
        start_task(&mut s, id2, EPOCH_MS).unwrap();
        complete_task(
            &mut s,
            id1,
            TaskResult {
                task_id: id1,
                success: true,
                started_at: EPOCH_MS,
                completed_at: EPOCH_MS + 100,
                gas_used: 0,
                error_code: None,
            },
        )
        .unwrap();
        complete_task(
            &mut s,
            id2,
            TaskResult {
                task_id: id2,
                success: true,
                started_at: EPOCH_MS,
                completed_at: EPOCH_MS + 100,
                gas_used: 0,
                error_code: None,
            },
        )
        .unwrap();

        // Advance again
        let count2 = advance_epoch(&mut s, 2);
        assert_eq!(count2, 2);
    }

    #[test]
    fn test_analytics_after_mixed_results() {
        let mut s = default_scheduler();
        for i in 0..10 {
            s.results.push(TaskResult {
                task_id: i,
                success: i % 3 != 0, // 0,3,6,9 fail = 4 failures, 6 successes
                started_at: i * 100,
                completed_at: i * 100 + 50,
                gas_used: 1000,
                error_code: if i % 3 == 0 { Some(1) } else { None },
            });
        }
        assert_eq!(avg_execution_time(&s), 50);
        assert_eq!(success_rate(&s), 6000); // 6/10 * 10000
        assert_eq!(gas_usage_total(&s), 10000);
    }

    #[test]
    fn test_batch_timing_across_multiple_cycles() {
        let batch = 10000u64;
        let commit = 8000u64;

        for cycle in 0..5 {
            let cycle_start = cycle * batch;
            // Start of commit phase
            assert!(is_in_commit_phase(cycle_start, batch, commit));
            // End of commit phase
            assert!(is_in_commit_phase(cycle_start + commit - 1, batch, commit));
            // Start of reveal phase
            assert!(is_in_reveal_phase(cycle_start + commit, batch, commit));
            // End of reveal phase
            assert!(is_in_reveal_phase(cycle_start + batch - 1, batch, commit));
        }
    }

    #[test]
    fn test_overdue_marking_and_due_tasks_interaction() {
        let mut s = default_scheduler();
        schedule_once(&mut s, 1, 1000, TaskPriority::Normal, 0).unwrap();

        // At 2000, task is overdue
        mark_overdue(&mut s, 2000);
        assert_eq!(tasks_by_status(&s, &TaskStatus::Overdue).len(), 1);

        // Overdue tasks should still be returned by due_tasks
        let due = due_tasks(&s, 3000);
        assert_eq!(due.len(), 1);
    }

    #[test]
    fn test_cancel_completed_task_fails() {
        let mut s = default_scheduler();
        let id = schedule_once(&mut s, 1, 1000, TaskPriority::Normal, 0).unwrap();
        start_task(&mut s, id, 1000).unwrap();
        complete_task(
            &mut s,
            id,
            TaskResult {
                task_id: id,
                success: true,
                started_at: 1000,
                completed_at: 1100,
                gas_used: 0,
                error_code: None,
            },
        )
        .unwrap();
        let r = cancel_task(&mut s, id);
        assert_eq!(r, Err(SchedulerError::TaskExpired));
    }

    #[test]
    fn test_reschedule_overdue_resets_to_pending() {
        let mut s = default_scheduler();
        let id = schedule_once(&mut s, 1, 1000, TaskPriority::Normal, 0).unwrap();
        mark_overdue(&mut s, 2000);
        assert_eq!(get_task(&s, id).unwrap().status, TaskStatus::Overdue);
        reschedule(&mut s, id, 5000).unwrap();
        assert_eq!(get_task(&s, id).unwrap().status, TaskStatus::Pending);
        assert_eq!(get_task(&s, id).unwrap().next_run, 5000);
    }

    #[test]
    fn test_due_tasks_not_yet_due() {
        let mut s = default_scheduler();
        schedule_once(&mut s, 1, 5000, TaskPriority::Normal, 0).unwrap();
        assert!(due_tasks(&s, 3000).is_empty());
    }

    #[test]
    fn test_cleanup_then_stats() {
        let mut s = default_scheduler();
        let id = schedule_once(&mut s, 1, 1000, TaskPriority::Normal, 0).unwrap();
        start_task(&mut s, id, 1000).unwrap();
        complete_task(
            &mut s,
            id,
            TaskResult {
                task_id: id,
                success: true,
                started_at: 1000,
                completed_at: 1100,
                gas_used: 200,
                error_code: None,
            },
        )
        .unwrap();
        cleanup_completed(&mut s, 100);
        let stats = compute_stats(&s);
        assert_eq!(stats.total_tasks, 0);
        assert_eq!(stats.completed_tasks, 0);
        // Results still exist
        assert_eq!(s.results.len(), 1);
        assert_eq!(stats.avg_execution_ms, 100);
    }

    #[test]
    fn test_task_throughput_window_boundary() {
        let mut s = default_scheduler();
        // Result at exactly window_start should be included
        s.results.push(TaskResult {
            task_id: 1,
            success: true,
            started_at: 0,
            completed_at: 40000,
            gas_used: 0,
            error_code: None,
        });
        assert_eq!(task_throughput(&s, 10000, 50000), 1); // 40000 >= 40000
    }

    #[test]
    fn test_task_throughput_at_now() {
        let mut s = default_scheduler();
        s.results.push(TaskResult {
            task_id: 1,
            success: true,
            started_at: 0,
            completed_at: 50000,
            gas_used: 0,
            error_code: None,
        });
        assert_eq!(task_throughput(&s, 10000, 50000), 1); // 50000 <= 50000
    }

    #[test]
    fn test_multiple_task_types_query() {
        let mut s = default_scheduler();
        schedule_once(&mut s, 10, 1000, TaskPriority::Normal, 0).unwrap();
        schedule_once(&mut s, 20, 1000, TaskPriority::Normal, 0).unwrap();
        schedule_once(&mut s, 10, 2000, TaskPriority::High, 0).unwrap();
        schedule_once(&mut s, 30, 3000, TaskPriority::Critical, 0).unwrap();

        assert_eq!(tasks_by_type(&s, 10).len(), 2);
        assert_eq!(tasks_by_type(&s, 20).len(), 1);
        assert_eq!(tasks_by_type(&s, 30).len(), 1);
        assert_eq!(tasks_by_type(&s, 99).len(), 0);
    }

    #[test]
    fn test_complete_nonexistent_task() {
        let mut s = default_scheduler();
        let r = complete_task(
            &mut s,
            999,
            TaskResult {
                task_id: 999,
                success: true,
                started_at: 0,
                completed_at: 100,
                gas_used: 0,
                error_code: None,
            },
        );
        assert_eq!(r, Err(SchedulerError::TaskNotFound));
    }

    #[test]
    fn test_schedule_task_with_executor() {
        let mut s = default_scheduler();
        let id = schedule_task(
            &mut s,
            1,
            TaskPriority::Normal,
            RecurrenceType::Once,
            1000,
            5000,
            0,
        )
        .unwrap();
        // Executor defaults to None
        assert_eq!(get_task(&s, id).unwrap().executor, None);
    }

    #[test]
    fn test_batch_start_large_time() {
        let now = 1_000_000_000u64;
        let batch = 10000u64;
        let next = next_batch_start(now, batch);
        assert_eq!(next, now); // 1_000_000_000 is divisible by 10000
    }

    #[test]
    fn test_batch_start_non_aligned_large() {
        let now = 1_000_000_001u64;
        let batch = 10000u64;
        let next = next_batch_start(now, batch);
        assert_eq!(next, 1_000_010_000);
    }

    #[test]
    fn test_epoch_progress_precise() {
        let epoch = create_epoch(1, 0, 0, 30000, 10000);
        // 1/3 of the way through
        assert_eq!(epoch_progress_bps(&epoch, 10000), 3333);
    }

    #[test]
    fn test_prune_cancelled_multiple() {
        let mut s = default_scheduler();
        let id1 = schedule_once(&mut s, 1, 1000, TaskPriority::Normal, 0).unwrap();
        let id2 = schedule_once(&mut s, 2, 1000, TaskPriority::Normal, 0).unwrap();
        schedule_once(&mut s, 3, 1000, TaskPriority::Normal, 0).unwrap();
        cancel_task(&mut s, id1).unwrap();
        cancel_task(&mut s, id2).unwrap();
        let removed = prune_cancelled(&mut s);
        assert_eq!(removed, 2);
        assert_eq!(task_count(&s), 1);
    }

    #[test]
    fn test_cleanup_completed_no_results_trim() {
        let mut s = default_scheduler();
        s.results.push(TaskResult {
            task_id: 1,
            success: true,
            started_at: 0,
            completed_at: 100,
            gas_used: 0,
            error_code: None,
        });
        // keep_results=10, only 1 result -> no trimming
        cleanup_completed(&mut s, 10);
        assert_eq!(s.results.len(), 1);
    }

    // ============ Helper ============

    fn make_task(
        task_id: u64,
        priority: TaskPriority,
        recurrence: RecurrenceType,
        max_runs: Option<u64>,
        run_count: u64,
    ) -> ScheduledTask {
        ScheduledTask {
            task_id,
            name_hash: [0u8; 32],
            task_type: 1,
            priority,
            status: TaskStatus::Pending,
            recurrence,
            next_run: 1000,
            last_run: None,
            run_count,
            max_runs,
            timeout_ms: DEFAULT_TIMEOUT_MS,
            created_at: 0,
            executor: None,
            data: 0,
        }
    }
}
