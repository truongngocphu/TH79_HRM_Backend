/** Helpers for MySQL numeric IDs kept inside MongoDB during migration. */
export function idVariants(value) {
  if (value === null || value === undefined || value === '') return [];
  const out = [];
  const text = String(value).trim();
  if (text) out.push(text);
  const num = Number(text);
  if (Number.isFinite(num)) out.push(num);
  return [...new Set(out)];
}

export function legacyEq(field, value) {
  const values = idVariants(value);
  return values.length ? { [field]: { $in: values } } : { [field]: '__NO_MATCH__' };
}

export function legacyIn(field, values = []) {
  const all = [...new Set(values.flatMap(idVariants))];
  return all.length ? { [field]: { $in: all } } : { [field]: { $in: [] } };
}

export function legacyId(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : value;
}

export function mapByLegacyId(rows = []) {
  const map = new Map();
  for (const row of rows) {
    for (const key of idVariants(row?.id)) map.set(String(key), row);
  }
  return map;
}

export function getByLegacyId(map, value) {
  for (const key of idVariants(value)) {
    const hit = map.get(String(key));
    if (hit) return hit;
  }
  return null;
}
