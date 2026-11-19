import { kvs, WhereConditions } from '@forge/kvs';

/**
 * Installation-scoped KVS. All access policies live in the resolver BEFORE
 * invoking this storage adapter; KVS is not Atlassian user-permission aware.
 */
export const privateReviewStorage = Object.freeze({
  async list(prefix, limit) {
    const page = await kvs.query().where('key', WhereConditions.beginsWith(prefix))
      .limit(limit).getMany();
    // Fail closed rather than interpret an incomplete history as the latest.
    if (page?.nextCursor) {
      throw new Error('Review history exceeds its retrievable limit.');
    }
    return (page?.results ?? []).map(entry=>({key:entry.key,value:entry.value}));
  },
  async putNew(key, value) {
    // A deterministic revision key must never be silently overwritten.
    await kvs.set(key, value, { keyPolicy: 'FAIL_IF_EXISTS' });
  },
});
