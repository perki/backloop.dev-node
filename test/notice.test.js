const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { readNotice, resetNotice } = require('../src/notice');

const NOW = Date.parse('2026-09-04T12:00:00.000Z');

beforeEach(resetNotice);

describe('readNotice', () => {
  it('says nothing when the pack carries no notice', () => {
    assert.strictEqual(readNotice({}, NOW), null);
    assert.strictEqual(readNotice({ notice: null }, NOW), null);
  });

  it('accepts a plain string, which is what a hand-edited pack will hold', () => {
    assert.strictEqual(readNotice({ notice: 'The secret changes soon.' }, NOW), 'The secret changes soon.');
  });

  it('accepts an object with a message', () => {
    assert.strictEqual(readNotice({ notice: { message: 'Rotating on the 15th.' } }, NOW), 'Rotating on the 15th.');
  });

  it('trims, so indentation in the JSON does not leak into the output', () => {
    assert.strictEqual(readNotice({ notice: '  padded  ' }, NOW), 'padded');
  });

  it('treats an empty or blank message as nothing to say', () => {
    assert.strictEqual(readNotice({ notice: '' }, NOW), null);
    assert.strictEqual(readNotice({ notice: '   \n  ' }, NOW), null);
    assert.strictEqual(readNotice({ notice: { message: '' } }, NOW), null);
  });

  it('keeps showing a notice whose deadline has not passed', () => {
    const pack = { notice: { message: 'soon', until: '2026-12-01T00:00:00.000Z' } };
    assert.strictEqual(readNotice(pack, NOW), 'soon');
  });

  it('goes quiet once the deadline has passed', () => {
    // A pack lives on disk until the certificate nears expiry, so without this
    // a rotation notice would nag for months about a date already gone.
    const pack = { notice: { message: 'soon', until: '2026-08-01T00:00:00.000Z' } };
    assert.strictEqual(readNotice(pack, NOW), null);
  });

  it('shows the message when the deadline is unparseable, rather than swallowing it', () => {
    // A typo in the date must not silence an announcement.
    const pack = { notice: { message: 'important', until: 'next tuesday' } };
    assert.strictEqual(readNotice(pack, NOW), 'important');
  });

  it('ignores shapes it does not understand instead of throwing', () => {
    for (const notice of [42, [], true, { until: '2027-01-01' }]) {
      assert.strictEqual(readNotice({ notice }, NOW), null, JSON.stringify(notice));
    }
  });

  it('never looks at version.message, which is a different and fatal channel', () => {
    const pack = { version: { num: '1', message: 'incompatible' } };
    assert.strictEqual(readNotice(pack, NOW), null);
  });
});
