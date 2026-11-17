import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GTA6_LAUNCH_DAY,
  GTA6_LAUNCH_MONTH_INDEX,
  GTA6_LAUNCH_YEAR,
  buildGta6Source,
  formatCountdownPart,
  formatGta6Views,
  getGta6Countdown,
  gta6LaunchDate,
} from './gta6';
import type { Gta6VideoCandidate } from './gta6';

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

const REAL_CANDIDATE: Gta6VideoCandidate = {
  videoId: 'dQw4w9WgXcQ',
  title: 'Grand Theft Auto VI: An Extended Look',
  channel: 'Rockstar Games',
  youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
  durationSec: 1800,
  qualityNote: 'Best Quality 1080p/4K via yt-dlp',
  views: 37_927_003,
};

test('buildGta6Source carries only the video’s real metadata', () => {
  const src = buildGta6Source(REAL_CANDIDATE);
  assert.equal(src.id, 'gta6-dQw4w9WgXcQ');
  assert.equal(src.title, REAL_CANDIDATE.title);
  assert.equal(src.channel, REAL_CANDIDATE.channel);
  assert.equal(src.youtubeUrl, REAL_CANDIDATE.youtubeUrl);
  assert.equal(src.thumbnailUrl, REAL_CANDIDATE.thumbnailUrl);
  assert.equal(src.durationSec, REAL_CANDIDATE.durationSec);
  assert.equal(src.category, 'gaming');
});

test('buildGta6Source invents no transcript, hooks or energy', () => {
  const src = buildGta6Source(REAL_CANDIDATE);
  assert.deepEqual(src.segments, []);
  assert.equal(src.presetHooks, undefined);
  assert.deepEqual(src.audioEnergyProfile, []);
  assert.deepEqual(src.faceTrackProfile, []);
});

test('buildGta6Source contains no fabricated Vice City placeholder text', () => {
  const src = buildGta6Source(REAL_CANDIDATE);
  const flat = JSON.stringify(src);
  for (const banned of [
    'Vice City',
    'ray-traced',
    'Leonida',
    'helicopter',
    'drawbridge',
    'Welcome back',
    'hookScore',
  ]) {
    assert.equal(
      flat.includes(banned),
      false,
      `built source must not contain fabricated text: "${banned}"`
    );
  }
});
