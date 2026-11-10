import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cloneUrlFor, parseGithubUrl, pickSlug, toAppName } from '../../src/utils/repoUrl.js';

describe('parseGithubUrl', () => {
  it('accepts the usual forms', () => {
    for (const url of [
      'https://github.com/pulkit1245/Kairo',
      'https://github.com/pulkit1245/Kairo.git',
      'https://github.com/pulkit1245/Kairo/',
      '  https://github.com/pulkit1245/Kairo  ',
    ]) {
      const parsed = parseGithubUrl(url);
      assert.equal(parsed.repo, 'Kairo', url);
      assert.equal(parsed.cloneUrl, 'https://github.com/pulkit1245/Kairo.git');
    }
  });

  it('rejects non github / non https urls', () => {
    for (const url of [
      'git@github.com:a/b.git',
      'https://gitlab.com/a/b',
      'github.com/a/b',
      'https://github.com/a',
    ]) {
      assert.throws(() => parseGithubUrl(url), /GitHub URL/, url);
    }
  });
});

describe('toAppName', () => {
  it('makes a valid k8s name', () => {
    assert.equal(toAppName('My_Cool.App'), 'my-cool-app');
    assert.equal(toAppName('--weird--'), 'weird');
    assert.equal(toAppName('2048-game'), 'app-2048-game');
    assert.equal(toAppName('___'), 'app');
  });

  it('stays under the length limit', () => {
    const name = toAppName('a'.repeat(100));
    assert.ok(name.length <= 50);
  });
});

describe('cloneUrlFor', () => {
  it('builds the https clone url from owner/repo', () => {
    assert.equal(cloneUrlFor('PunitXd/kairo'), 'https://github.com/PunitXd/kairo.git');
  });
});

describe('pickSlug', () => {
  const takenFrom = (list) => async (slug) => list.includes(slug);

  it('uses the repo name when it is free', async () => {
    assert.equal(await pickSlug('alice', 'todo-api', takenFrom([])), 'todo-api');
  });

  it('adds the owner when the repo name is taken', async () => {
    assert.equal(await pickSlug('bob', 'todo-api', takenFrom(['todo-api'])), 'bob-todo-api');
  });

  it('adds a number when both are taken', async () => {
    const taken = takenFrom(['todo-api', 'bob-todo-api', 'bob-todo-api-2']);
    assert.equal(await pickSlug('bob', 'todo-api', taken), 'bob-todo-api-3');
  });
});
