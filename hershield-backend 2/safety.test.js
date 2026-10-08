'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { stageAt, mapsLink, locationInput, phoneInput } = require('./safety');
const eta = new Date('2026-10-08T12:00:00Z');
for (const [offset, stage] of [[-1,1],[0,2],[299999,2],[300000,3],[599999,3],[600000,4],[1799999,4],[1800000,5],[86400000,5]]) {
  test(`overdue ${offset} ms => stage ${stage}`, () => assert.equal(stageAt(eta, +eta + offset), stage));
}
test('zero and negative coordinates remain valid', () => {
  assert.equal(mapsLink(locationInput({lat:0,lng:-75.123456})), 'https://maps.google.com/?q=0,-75.123456');
  assert.equal(mapsLink(null), null);
});
test('invalid GPS cannot become a fabricated location', () => {
  for (const l of [{lat:91,lng:0},{lat:0,lng:181},{lat:'26',lng:75},{lat:NaN,lng:0},{lat:0,lng:0,accuracy:-1}]) assert.throws(() => locationInput(l));
});
test('Indian contact normalization', () => {
  assert.equal(phoneInput('+91 98765 43210'), '9876543210');
  assert.throws(() => phoneInput('123'));
});
