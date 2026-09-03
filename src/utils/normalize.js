export const normalizeText = (value = '') => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
export function escapeRegex(value='') { return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
export function compactObject(obj={}) { return Object.fromEntries(Object.entries(obj).filter(([,v]) => v !== undefined)); }
