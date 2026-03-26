import { describe, it, expect } from 'vitest';
import { isBlocked } from '../moderation.js';

// --- isBlocked ---

describe('isBlocked', () => {
  it('blocks known slurs', () => {
    expect(isBlocked('nigger')).toBe(true);
    expect(isBlocked('chink')).toBe(true);
    expect(isBlocked('faggot')).toBe(true);
    expect(isBlocked('retard')).toBe(true);
  });

  it('blocks case-insensitively', () => {
    expect(isBlocked('NIGGER')).toBe(true);
    expect(isBlocked('Chink')).toBe(true);
    expect(isBlocked('FaGgOt')).toBe(true);
    expect(isBlocked('RETARDED')).toBe(true);
  });

  it('blocks slurs embedded in a sentence', () => {
    expect(isBlocked('you are a faggot')).toBe(true);
    expect(isBlocked('what a retard move')).toBe(true);
    expect(isBlocked('hey nigga what up')).toBe(true);
  });

  it('uses word boundary matching (does not block substrings)', () => {
    // "spic" should not match inside "despicable"
    expect(isBlocked('despicable')).toBe(false);
    // "fag" should not match inside "fagging" — actually "fag" has \b so "fagging" would not match
    // because \bfag\b requires word boundary after "g", and "fagging" has "g" followed by more chars
    expect(isBlocked('fagging')).toBe(false);
  });

  it('blocks multi-word patterns', () => {
    expect(isBlocked('kill yourself')).toBe(true);
    expect(isBlocked('buy followers')).toBe(true);
    expect(isBlocked('dm me for something')).toBe(true);
  });

  it('blocks multi-word patterns with extra spacing', () => {
    expect(isBlocked('kill  yourself')).toBe(true);
    expect(isBlocked('dm  me  for info')).toBe(true);
  });

  it('blocks "kys"', () => {
    expect(isBlocked('kys')).toBe(true);
    expect(isBlocked('just kys already')).toBe(true);
  });

  it('returns false for clean text', () => {
    expect(isBlocked('hello world')).toBe(false);
    expect(isBlocked('this is a normal message')).toBe(false);
    expect(isBlocked('working on the refactor')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isBlocked('')).toBe(false);
  });

  it('returns false for text with no matching patterns', () => {
    expect(isBlocked('The quick brown fox jumps over the lazy dog')).toBe(false);
    expect(isBlocked('function parseTeamPath(path) { return null; }')).toBe(false);
  });

  it('blocks plural forms in the blocklist', () => {
    expect(isBlocked('niggers')).toBe(true);
    expect(isBlocked('kikes')).toBe(true);
    expect(isBlocked('coons')).toBe(true);
    expect(isBlocked('trannies')).toBe(true);
  });

  it('blocks spam patterns', () => {
    expect(isBlocked('free crypto giveaway')).toBe(true);
    expect(isBlocked('buy followers cheap')).toBe(true);
  });
});

