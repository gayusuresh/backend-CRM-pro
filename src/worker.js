const { Worker } = require('bullmq');
const { workerConcurrency } = require('./config');
const { QUEUE_NAME, newConnection, enqueue } = require('./services/queue');
const { deliverLead } = require('./services/delivery');
const { Lead } = require('./models');

async function sweep() {
  const now = Date.now();
  try {
    // Saved but never reached Redis (e.g. Redis was down during ingest)
    const lost = await Lead.find({
      status: 'queued',
      $or: [{ enqueuedAt: null }, { enqueuedAt: { $lt: new Date(now - 5 * 60e3) } }],
    }).limit(500).select('_id');
    for (const l of lost) await enqueue(l._id);

    // Retry time passed but the delayed job is missing
    const due = await Lead.find({ status: 'pending', nextRetryAt: { $ne: null, $lt: new Date(now - 2 * 60e3) } }).limit(500).select('_id');
    for (const l of due) {
      await Lead.updateOne({ _id: l._id }, { nextRetryAt: new Date(now + 10 * 60e3) });
      await enqueue(l._id);
    }

    // Worker crashed mid-push
    await Lead.updateMany(
      { status: 'processing', lastAttemptAt: { $lt: new Date(now - 10 * 60e3) } },
      { status: 'pending', nextRetryAt: new Date(now), lastError: 'Worker interrupted; re-queued' }
    );
  } catch (e) {
    console.error('sweeper error', e.message);
  }
}

function startWorker() {
  const worker = new Worker(QUEUE_NAME, (job) => deliverLead(job.data.id), {
    connection: newConnection(),
    concurrency: workerConcurrency,
  });
  worker.on('failed', (job, err) => console.error(`job ${job?.id} crashed:`, err.message));
  setInterval(sweep, 60e3).unref();
  console.log(`Worker started (concurrency ${workerConcurrency})`);
  return worker;
}

module.exports = { startWorker };

if (require.main === module) {
  const mongoose = require('mongoose');
  mongoose.connect(require('./config').mongoUri).then(startWorker).catch((e) => { console.error(e); process.exit(1); });
}
