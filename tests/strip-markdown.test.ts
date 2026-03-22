import { describe, it, expect } from 'vitest';
import { stripMarkdown, gradeLatency } from '../src/services/turn-processor.js';

describe('stripMarkdown', () => {
  it('should strip bold formatting', () => {
    expect(stripMarkdown('This is **bold** text')).toBe('This is bold text');
  });

  it('should strip italic formatting', () => {
    expect(stripMarkdown('This is *italic* text')).toBe('This is italic text');
  });

  it('should strip underline bold', () => {
    expect(stripMarkdown('This is __bold__ text')).toBe('This is bold text');
  });

  it('should strip underline italic', () => {
    expect(stripMarkdown('This is _italic_ text')).toBe('This is italic text');
  });

  it('should strip inline code', () => {
    expect(stripMarkdown('Run `npm install` now')).toBe('Run npm install now');
  });

  it('should strip code blocks', () => {
    const input = 'Before\n```js\nconst x = 1;\n```\nAfter';
    expect(stripMarkdown(input)).toBe('Before After');
  });

  it('should strip strikethrough', () => {
    expect(stripMarkdown('This is ~~deleted~~ text')).toBe('This is deleted text');
  });

  it('should strip links preserving text', () => {
    expect(stripMarkdown('Check [this link](https://example.com)')).toBe('Check this link');
  });

  it('should strip headers', () => {
    expect(stripMarkdown('# Header\nContent')).toBe('Header Content');
    expect(stripMarkdown('## Sub Header\nContent')).toBe('Sub Header Content');
    expect(stripMarkdown('### Deep Header\nContent')).toBe('Deep Header Content');
  });

  it('should strip numbered lists', () => {
    expect(stripMarkdown('1. First\n2. Second\n3. Third')).toBe('First Second Third');
  });

  it('should strip bullet lists', () => {
    expect(stripMarkdown('- Item 1\n- Item 2\n* Item 3')).toBe('Item 1 Item 2 Item 3');
  });

  it('should strip block quotes', () => {
    expect(stripMarkdown('> This is quoted\n> text')).toBe('This is quoted text');
  });

  it('should strip horizontal rules', () => {
    expect(stripMarkdown('Above\n---\nBelow')).toBe('Above Below');
  });

  it('should strip bare URLs', () => {
    expect(stripMarkdown('Visit https://example.com for more')).toBe('Visit for more');
  });

  it('should collapse multiple whitespace', () => {
    expect(stripMarkdown('Too   many    spaces')).toBe('Too many spaces');
  });

  it('should truncate to 400 characters', () => {
    const longText = 'a'.repeat(500);
    expect(stripMarkdown(longText).length).toBe(400);
  });

  it('should handle empty string', () => {
    expect(stripMarkdown('')).toBe('');
  });

  it('should handle plain text with no markdown', () => {
    expect(stripMarkdown('Just plain text here.')).toBe('Just plain text here.');
  });

  it('should handle combined markdown', () => {
    const input = '## Title\n\n**Bold** and *italic* with `code`\n\n1. First item\n2. Second item\n\n> A quote\n\nVisit https://example.com';
    const result = stripMarkdown(input);
    expect(result).not.toContain('**');
    expect(result).not.toContain('*');
    expect(result).not.toContain('`');
    expect(result).not.toContain('##');
    expect(result).not.toContain('https://');
    expect(result).toContain('Bold');
    expect(result).toContain('italic');
    expect(result).toContain('code');
    expect(result).toContain('First item');
  });
});

describe('gradeLatency', () => {
  it('should grade < 10s as EXCELLENT', () => {
    expect(gradeLatency(5000)).toBe('EXCELLENT');
    expect(gradeLatency(9999)).toBe('EXCELLENT');
  });

  it('should grade 10-15s as GOOD', () => {
    expect(gradeLatency(10000)).toBe('GOOD');
    expect(gradeLatency(14999)).toBe('GOOD');
  });

  it('should grade 15-20s as ACCEPTABLE', () => {
    expect(gradeLatency(15000)).toBe('ACCEPTABLE');
    expect(gradeLatency(19999)).toBe('ACCEPTABLE');
  });

  it('should grade >= 20s as SLOW', () => {
    expect(gradeLatency(20000)).toBe('SLOW');
    expect(gradeLatency(30000)).toBe('SLOW');
  });

  it('should grade 0ms as EXCELLENT', () => {
    expect(gradeLatency(0)).toBe('EXCELLENT');
  });
});
