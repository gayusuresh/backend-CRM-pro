const { Queue } = require('bullmq');
const IORedis = require('ioredis');
const { redisUrl } = require('../config');
const { Lead } = require('../models');

const QUEUE_NAME = 'lead-push';
const newConnection = () => new IORedis(redisUrl, { maxRetriesPerRequest: null });

let queue;
const getQueue = () =>
  (queue ||= new Queue(QUEUE_NAME, {
    connection: newConnection(),
    defaultJobOptions: { removeOnComplete: true, removeOnFail: { age: 86400 }, attempts: 1 },
  }));

/** Schedule a delivery attempt. Retry timing is controlled by us (per-client config), not BullMQ backoff. */
async function enqueue(leadId, delayMs = 0) {
  await Lead.updateOne({ _id: leadId }, { $set: { enqueuedAt: new Date() } });
  await getQueue().add('push', { id: String(leadId) }, { delay: delayMs, jobId: `${leadId}-${Date.now()}` });
}

// Used by the ingest API: never let a slow/unavailable Redis block the acknowledgement.
// If this times out, the worker's sweeper re-enqueues the lead (it is already saved in MongoDB).
const enqueueSafe = (leadId, delayMs = 0) =>
  Promise.race([enqueue(leadId, delayMs), new Promise((_, rej) => setTimeout(() => rej(new Error('enqueue timeout')), 2000))]).catch((e) =>
    console.error(`enqueue ${leadId} deferred to sweeper:`, e.message)
  );

module.exports = { QUEUE_NAME, newConnection, enqueue, enqueueSafe };
