// Tag validation for memory entries.
// Uses shared constants — single source of truth across all packages.

import { MAX_TAG_LENGTH, MAX_TAGS_PER_MEMORY } from '@chinmeister/shared/constants.js';

export { MAX_TAG_LENGTH };
export const MAX_TAGS_COUNT = MAX_TAGS_PER_MEMORY;

const TAG_CHAR_RE = /[^a-z0-9\-_]/g;

interface ValidateTagsResult {
  tags: string[];
  error: string | null;
}

export function validateTags(raw: string): ValidateTagsResult {
  const parsed = raw
    .split(',')
    .map((t) => t.trim().toLowerCase().replace(TAG_CHAR_RE, ''))
    .filter(Boolean);

  const tags = [...new Set(parsed)];

  if (tags.length > MAX_TAGS_COUNT) {
    return { tags: [], error: `Maximum ${MAX_TAGS_COUNT} tags allowed` };
  }

  for (const tag of tags) {
    if (tag.length > MAX_TAG_LENGTH) {
      return {
        tags: [],
        error: `Tag "${tag.slice(0, 20)}..." exceeds ${MAX_TAG_LENGTH} characters`,
      };
    }
  }

  return { tags, error: null };
}
