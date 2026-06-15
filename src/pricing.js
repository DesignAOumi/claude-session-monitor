'use strict';

/**
 * Approximate Claude API pricing in USD per 1,000,000 tokens.
 * These are ESTIMATES used to give a rough cost signal — they are not billing-accurate.
 * Matched by substring against the model id (longest match wins).
 *
 * cacheWrite / cacheRead are derived from the input rate using the standard
 * multipliers (cache write = 1.25x input, cache read = 0.1x input) unless overridden.
 */
const MODEL_PRICING = [
  { match: 'opus', input: 15, output: 75 },
  { match: 'sonnet', input: 3, output: 15 },
  { match: 'haiku', input: 0.8, output: 4 },
];

const FALLBACK = { match: 'default', input: 3, output: 15 };

function rateFor(model) {
  if (!model) return FALLBACK;
  const id = String(model).toLowerCase();
  let best = null;
  for (const p of MODEL_PRICING) {
    if (id.includes(p.match)) {
      if (!best || p.match.length > best.match.length) best = p;
    }
  }
  return best || FALLBACK;
}

/**
 * Estimate USD cost for a usage object.
 * @param {string} model
 * @param {{input_tokens?:number, output_tokens?:number, cache_creation_input_tokens?:number, cache_read_input_tokens?:number}} usage
 */
function estimateCost(model, usage) {
  if (!usage) return 0;
  const r = rateFor(model);
  const cacheWriteRate = r.cacheWrite != null ? r.cacheWrite : r.input * 1.25;
  const cacheReadRate = r.cacheRead != null ? r.cacheRead : r.input * 0.1;

  const input = usage.input_tokens || 0;
  const output = usage.output_tokens || 0;
  const cacheWrite = usage.cache_creation_input_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;

  const cost =
    (input * r.input +
      output * r.output +
      cacheWrite * cacheWriteRate +
      cacheRead * cacheReadRate) /
    1_000_000;
  return cost;
}

module.exports = { estimateCost, rateFor, MODEL_PRICING };
