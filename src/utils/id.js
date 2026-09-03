import { rawModel } from '../models/raw.js';
import { recoveredLegacyId } from './legacySeedIdentity.js';

/**
 * Return the next numeric legacy ID for a migrated collection.
 *
 * Older Mongo conversions may have documents without the old MySQL `id` field.
 * The previous counter implementation only inspected numeric `id` values already
 * stored in MongoDB. That allowed a newly-created branch to receive id=1 even
 * though CN001 (Trụ sở chính) is the recovered legacy id=1.
 *
 * We now calculate a safe floor from both persisted ids and the deterministic
 * legacy identity catalog before incrementing the counter. Existing stale
 * counters are automatically raised with $max.
 */
export async function nextId(collectionName) {
  const Counter = rawModel('_counters');
  const Collection = rawModel(collectionName);

  const rows = await Collection.find({}).lean();
  let maxUsed = 0;
  for (const row of rows) {
    const recovered = recoveredLegacyId(collectionName, row);
    const values = [row?.id, recovered];
    for (const value of values) {
      const n = Number(value);
      if (Number.isFinite(n) && n > maxUsed) maxUsed = n;
    }
  }

  await Counter.updateOne(
    { collection: collectionName },
    {
      $setOnInsert: { collection: collectionName },
      $max: { seq: maxUsed }
    },
    { upsert: true }
  );

  const updated = await Counter.findOneAndUpdate(
    { collection: collectionName },
    { $inc: { seq: 1 } },
    { new: true }
  );
  return Number(updated.seq);
}
