import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { lineTail } from '../../src/generator/deploy/build.service.js';

describe('lineTail', () => {
  it('keeps only the newest lines, across chunk boundaries', () => {
    const tail = lineTail(3);
    tail.push('one\ntwo\nthr');
    tail.push('ee\nfour\nfive');
    assert.deepEqual(tail.lines(), ['three', 'four', 'five']);
  });

  it('drops ANSI colour codes', () => {
    const tail = lineTail(5);
    tail.push('\x1b[31mERROR\x1b[0m: npm ci failed\n');
    assert.deepEqual(tail.lines(), ['ERROR: npm ci failed']);
  });
});
