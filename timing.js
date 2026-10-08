const MINUTE = 60000;
function stageAt(session, now = new Date()) {
  if (!session.active) return 'SAFE';
  if (session.stage === 'STAGE_4' || now >= new Date(session.escalateAt)) return 'STAGE_4';
  if (now >= new Date(session.concernAt)) return 'STAGE_3';
  if (now >= new Date(session.expectedAt)) return 'STAGE_2';
  return 'STAGE_1';
}
module.exports = { stageAt, MINUTE };
