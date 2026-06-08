function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function retryable(error) {
  return error?.retryable === true
    || error?.code === 429
    || error?.code === 'ABORT'
    || /abort|timeout|network|qps|429/i.test(error?.message || '');
}

function createRateLimiter(qps = 5) {
  const intervalMs = qps > 0 ? Math.ceil(1000 / qps) : 0;
  let nextAt = 0;

  return async function waitForSlot() {
    if (!intervalMs) return;
    const now = Date.now();
    const waitMs = Math.max(0, nextAt - now);
    nextAt = Math.max(now, nextAt) + intervalMs;
    if (waitMs > 0) {
      await sleep(waitMs);
    }
  };
}

function serializeError(error) {
  if (!error) return '';
  return String(error.message || error).slice(0, 1000);
}

function createTaskRecord(task) {
  return {
    taskId: task.taskId,
    objectId: task.objectId,
    objectType: task.objectType,
    label: task.label || '',
    datePreset: task.datePreset || '',
    since: task.since || '',
    until: task.until || '',
    sourceTimeZone: task.sourceTimeZone || '',
    attempts: 0,
    durationMs: 0,
    status: 'queued',
    code: '',
    bodySize: 0,
    rows: 0,
    error: '',
    startedAt: '',
    completedAt: ''
  };
}

export async function runTaskQueue({
  tasks = [],
  worker,
  concurrency = 20,
  qps = 5,
  maxAttempts = 8,
  onAttempt
} = {}) {
  const queue = tasks.map((task, index) => ({
    ...task,
    taskId: task.taskId || `${task.objectType || 'task'}:${task.objectId || index}:${task.since || ''}:${task.until || ''}`
  }));
  const records = new Map(queue.map((task) => [task.taskId, createTaskRecord(task)]));
  const waitForSlot = createRateLimiter(qps);
  let cursor = 0;

  async function nextTask() {
    const task = queue[cursor];
    cursor += 1;
    return task;
  }

  async function runOne(task) {
    const record = records.get(task.taskId);
    if (!record.startedAt) {
      record.startedAt = new Date().toISOString();
    }
    record.status = 'running';

    while (record.attempts < maxAttempts) {
      record.attempts += 1;
      const attemptStartedAt = Date.now();
      try {
        await waitForSlot();
        const result = await worker(task, record.attempts);
        record.durationMs += Date.now() - attemptStartedAt;
        record.status = 'success';
        record.code = result?.code ?? 200;
        record.bodySize = result?.bodySize ?? 0;
        record.rows = result?.rows ?? 0;
        record.error = '';
        record.completedAt = new Date().toISOString();
        onAttempt?.({ task, record, result, ok: true });
        return {
          task,
          record,
          result
        };
      } catch (error) {
        record.durationMs += Date.now() - attemptStartedAt;
        record.code = error?.code ?? error?.httpStatus ?? 'ERROR';
        record.bodySize = error?.bodySize ?? 0;
        record.error = serializeError(error);
        onAttempt?.({ task, record, error, ok: false });

        if (!retryable(error) || record.attempts >= maxAttempts) {
          record.status = 'failed';
          record.completedAt = new Date().toISOString();
          return {
            task,
            record,
            error
          };
        }
      }
    }

    record.status = 'failed';
    record.completedAt = new Date().toISOString();
    return {
      task,
      record,
      error: new Error('max_attempts_exceeded')
    };
  }

  async function workerLoop() {
    const results = [];
    while (cursor < queue.length) {
      const task = await nextTask();
      if (!task) break;
      results.push(await runOne(task));
    }
    return results;
  }

  const workerCount = Math.max(1, Math.min(concurrency, queue.length || 1));
  const groups = await Promise.all(Array.from({ length: workerCount }, () => workerLoop()));
  const results = groups.flat();
  const taskRecords = [...records.values()];

  return {
    results,
    taskRecords,
    stats: {
      total: taskRecords.length,
      success: taskRecords.filter((record) => record.status === 'success').length,
      failed: taskRecords.filter((record) => record.status === 'failed').length,
      attempts: taskRecords.reduce((total, record) => total + record.attempts, 0),
      retries: taskRecords.reduce((total, record) => total + Math.max(0, record.attempts - 1), 0),
      bodySize: taskRecords.reduce((total, record) => total + Number(record.bodySize || 0), 0),
      rows: taskRecords.reduce((total, record) => total + Number(record.rows || 0), 0),
      durationMs: taskRecords.reduce((total, record) => total + Number(record.durationMs || 0), 0)
    }
  };
}
