import { describe, it, expect } from 'vitest';
import {
  TOOL_CALL_CATEGORIES,
  RESEARCH_TOOLS,
  EDIT_TOOLS,
  classifyToolCall,
  sqlInList,
} from '../tool-call-categories.js';

describe('tool-call-categories', () => {
  describe('TOOL_CALL_CATEGORIES', () => {
    it('classifies core Claude Code research tools', () => {
      expect(TOOL_CALL_CATEGORIES.Read).toBe('research');
      expect(TOOL_CALL_CATEGORIES.Grep).toBe('research');
      expect(TOOL_CALL_CATEGORIES.Glob).toBe('research');
    });

    it('classifies core Claude Code edit tools', () => {
      expect(TOOL_CALL_CATEGORIES.Edit).toBe('edit');
      expect(TOOL_CALL_CATEGORIES.Write).toBe('edit');
      expect(TOOL_CALL_CATEGORIES.NotebookEdit).toBe('edit');
    });

    it('classifies shell execution tools as exec', () => {
      expect(TOOL_CALL_CATEGORIES.Bash).toBe('exec');
    });

    it('classifies chinmeister memory tools under the memory namespace', () => {
      expect(TOOL_CALL_CATEGORIES.chinmeister_save_memory).toBe('memory');
      expect(TOOL_CALL_CATEGORIES.chinmeister_search_memory).toBe('memory');
    });
  });

  describe('RESEARCH_TOOLS and EDIT_TOOLS', () => {
    it('research and edit tool sets are disjoint', () => {
      const research = new Set(RESEARCH_TOOLS);
      for (const t of EDIT_TOOLS) expect(research.has(t)).toBe(false);
    });

    it('every tool in RESEARCH_TOOLS has category research in the canonical map', () => {
      for (const t of RESEARCH_TOOLS) expect(TOOL_CALL_CATEGORIES[t]).toBe('research');
    });

    it('every tool in EDIT_TOOLS has category edit in the canonical map', () => {
      for (const t of EDIT_TOOLS) expect(TOOL_CALL_CATEGORIES[t]).toBe('edit');
    });

    it('arrays are sorted and immutable', () => {
      const sorted = [...RESEARCH_TOOLS].sort();
      expect(RESEARCH_TOOLS).toEqual(sorted);
    });
  });

  describe('classifyToolCall', () => {
    it('returns the canonical category for known tools', () => {
      expect(classifyToolCall('Read')).toBe('research');
      expect(classifyToolCall('Edit')).toBe('edit');
      expect(classifyToolCall('Bash')).toBe('exec');
      expect(classifyToolCall('chinmeister_save_memory')).toBe('memory');
    });

    it('returns "other" for unknown tools', () => {
      expect(classifyToolCall('DefinitelyNotARealTool')).toBe('other');
    });

    it('returns "other" for null and undefined', () => {
      expect(classifyToolCall(null)).toBe('other');
      expect(classifyToolCall(undefined)).toBe('other');
      expect(classifyToolCall('')).toBe('other');
    });

    it('is case-sensitive (matches how agents actually emit names)', () => {
      // Claude Code emits 'Read' not 'read' - this is the canonical spelling.
      expect(classifyToolCall('read')).toBe('other');
      expect(classifyToolCall('Read')).toBe('research');
    });
  });

  describe('sqlInList', () => {
    it('quotes each name and comma-joins them', () => {
      expect(sqlInList(['Read', 'Grep'])).toBe("'Read', 'Grep'");
    });

    it('returns an empty string for an empty array', () => {
      expect(sqlInList([])).toBe('');
    });
  });
});
