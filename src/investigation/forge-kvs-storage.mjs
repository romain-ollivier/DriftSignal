import { kvs } from '@forge/kvs';

/**
 * Installation-scoped KVS adapter. Access control is performed by the server
 * before this adapter is called. KVS query() has eventual consistency and
 * MUST NOT be used to determine the latest review revision.
 */
export const privateReviewStorage = Object.freeze({
  async get(key) {
    // A direct kvs.get(key) is strictly consistent.
    return kvs.get(key);
  },
  async putNew(key, value) {
    // Deterministic key + FAIL_IF_EXISTS avoids last-writer-wins.
    await kvs.set(key, value, { keyPolicy: 'FAIL_IF_EXISTS' });
  },
});
