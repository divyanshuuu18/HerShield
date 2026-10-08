const { test } = require('node:test');
const assert = require('node:assert/strict');
const { stageAt, MINUTE } = require('../timing');
const s = { active: true, stage: 'STAGE_1', expectedAt: new Date(15*MINUTE), concernAt: new Date(20*MINUTE), escalateAt: new Date(25*MINUTE) };
test('exact boundaries and overdue catch-up', () => {
  for (const [ms,stage] of [[15*MINUTE-1,'STAGE_1'],[15*MINUTE,'STAGE_2'],[20*MINUTE,'STAGE_3'],[25*MINUTE,'STAGE_4'],[60*MINUTE,'STAGE_4']]) assert.equal(stageAt(s,new Date(ms)),stage);
});
test('safe is terminal; immediate escalation cannot be downgraded', () => {
  assert.equal(stageAt({...s,active:false},new Date(60*MINUTE)),'SAFE');
  assert.equal(stageAt({...s,stage:'STAGE_4'},new Date(0)),'STAGE_4');
});
