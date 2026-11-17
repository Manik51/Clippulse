import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GTA6_LAUNCH_DAY,
  GTA6_LAUNCH_MONTH_INDEX,
  GTA6_LAUNCH_YEAR,
  formatCountdownPart,
  formatGta6Views,
  getGta6Countdown,
  gta6LaunchDate,
} from './gta6';

test('launch target is local midnight, November 19, 2026', () => {
  const target = gta6LaunchDate();
  assert.equal(target.getFullYear(), GTA6_LAUNCH_YEAR);
  assert.equal(target.getMonth(), GTA6_LAUNCH_MONTH_INDEX);
  assert.equal(target.getMonth(), 10); // November, 0-indexed
  assert.equal(target.getDate(), GTA6_LAUNCH_DAY);
  assert.equal(target.getHours(), 0);
  assert.equal(target.getMinutes(), 0);
  assert.equal(target.getSeconds(), 0);
});

test('two days before launch: 2 days left, not live', () => {
  const cd = getGta6Countdown(new Date(2026, 10, 17, 0, 0, 0));
  assert.equal(cd.isLive, false);
  assert.equal(cd.days, 2);
  assert.equal(cd.hours, 0);
  assert.equal(cd.minutes, 0);
  assert.equal(cd.seconds, 0);
});

test('Nov 17, 09:15 local: 1 day 14 hours 45 minutes left', () => {
  const cd = getGta6Countdown(new Date(2026, 10, 17, 9, 15, 0));
  assert.equal(cd.isLive, false);
  assert.equal(cd.days, 1);
  assert.equal(cd.hours, 14);
  assert.equal(cd.minutes, 45);
  assert.equal(cd.seconds, 0);
});

test('90 seconds before launch: 0d 0h 1m 30s', () => {
  const cd = getGta6Countdown(new Date(2026, 10, 18, 23, 58, 30));
  assert.equal(cd.isLive, false);
  assert.equal(cd.days, 0);
  assert.equal(cd.hours, 0);
  assert.equal(cd.minutes, 1);
  assert.equal(cd.seconds, 30);
});

test('exactly at launch: live, all zeros (zero-crossing)', () => {
  const cd = getGta6Countdown(new Date(2026, 10, 19, 0, 0, 0));
  assert.equal(cd.isLive, true);
  assert.equal(cd.days, 0);
  assert.equal(cd.hours, 0);
  assert.equal(cd.minutes, 0);
  assert.equal(cd.seconds, 0);
  assert.equal(cd.totalMs, 0);
});

test('after launch: live', () => {
  const cd = getGta6Countdown(new Date(2026, 10, 20, 12, 0, 0));
  assert.equal(cd.isLive, true);
  assert.equal(cd.totalMs, 0);
});

test('countdown part formatting pads to two digits', () => {
  assert.equal(formatCountdownPart(0), '00');
  assert.equal(formatCountdownPart(5), '05');
  assert.equal(formatCountdownPart(12), '12');
  assert.equal(formatCountdownPart(59), '59');
});

test('view count chips compact to K / M, null stays null', () => {
  assert.equal(formatGta6Views(null), null);
  assert.equal(formatGta6Views(undefined), null);
  assert.equal(formatGta6Views(950), '950');
  assert.equal(formatGta6Views(34_000), '34K');
  assert.equal(formatGta6Views(1_234_567), '1.2M');
  assert.equal(formatGta6Views(25_000_000), '25M');
});
