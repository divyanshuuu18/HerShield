'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { sendAlert, app, CheckInSession } = require('./server');
const originalFetch = global.fetch;
const originalEnv = { ...process.env };
after(() => { global.fetch = originalFetch; for (const k of Object.keys(process.env)) if (!(k in originalEnv)) delete process.env[k]; Object.assign(process.env, originalEnv); });
const job = { id:'job1', stage:5, phone:'9876543210', channel:'sms' };
const s = { lastLocation: { lat:0,lng:-75,receivedAt:new Date('2026-10-08T12:00:00Z') } };
const user = { name:'Riya',phone:'9123456789' };
function configure() {
  Object.assign(process.env, { ALERTS_DRY_RUN:'false',FAST2SMS_API_KEY:'test-key',FAST2SMS_SENDER_ID:'HEADER',
    SMS_MESSAGE_ID_STAGE_5:'111111',WA_MESSAGE_ID_STAGE_5:'9',FAST2SMS_WA_PHONE_NUMBER_ID:'12345' });
}
test('dry run never calls provider', async () => {
  process.env.ALERTS_DRY_RUN='true';
  global.fetch = () => { throw new Error('should not contact provider'); };
  assert.deepEqual(await sendAlert(job,s,user), { simulated:true });
});
test('SMS uses DLT POST with stage-5 map link and timestamp', async () => {
  configure();
  global.fetch = async (url, options) => {
    assert.equal(url,'https://www.fast2sms.com/dev/bulkV2');
    assert.equal(options.method,'POST');
    assert.equal(options.headers.Authorization,'test-key');
    const body = JSON.parse(options.body);
    assert.equal(body.route,'dlt'); assert.equal(body.message,'111111');
    assert.equal(body.udf1,'job1');
    assert.ok(body.variables_values.includes('https://maps.google.com/?q=0,-75|2026-10-08T12:00:00.000Z'));
    return {ok:true,status:200,json:async()=>({return:true,request_id:'provider1'})};
  };
  assert.equal((await sendAlert(job,s,user)).requestId,'provider1');
});
test('WhatsApp uses separate documented endpoint', async () => {
  configure();
  global.fetch = async (url,options) => {
    assert.equal(url.pathname,'/dev/whatsapp'); assert.equal(options.method,'GET');
    assert.equal(url.searchParams.get('phone_number_id'),'12345');
    assert.equal(url.searchParams.get('message_id'),'9');
    assert.equal(url.searchParams.get('numbers'),job.phone);
    return {ok:true,status:200,json:async()=>({status:'success',request_id:'wa1'})};
  };
  assert.equal((await sendAlert({...job,channel:'whatsapp'},s,user)).requestId,'wa1');
});
test('missing location still alerts honestly', async () => {
  configure();
  global.fetch = async (url,options) => {
    assert.ok(JSON.parse(options.body).variables_values.includes('Location unavailable'));
    return {ok:true,status:200,json:async()=>({return:true})};
  };
  await sendAlert(job,{},user);
});
test('provider rejection and unknown response are failures', async () => {
  configure();
  for (const body of [{return:false},{unrecognized:true}]) {
    global.fetch = async () => ({ok:true,status:200,json:async()=>body});
    await assert.rejects(sendAlert(job,s,user));
  }
});
test('API requires auth, validates locations and scopes mutation to owner', async () => {
  global.fetch = originalFetch;
  process.env.JWT_SECRET = 'test-secret-longer-than-thirty-two-characters';
  const jwt = require('jsonwebtoken');
  const owner = '0123456789abcdef01234567', id = '0123456789abcdef01234568';
  const token = jwt.sign({},process.env.JWT_SECRET,{subject:owner,issuer:'hershield',audience:'hershield-web'});
  const server = app.listen(0,'127.0.0.1');
  await new Promise(resolve => server.once('listening',resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const previous = CheckInSession.findOneAndUpdate;
  try {
    const unauthorized = await originalFetch(base+'/api/commute/current'); assert.equal(unauthorized.status,401);
    const headers = {'Content-Type':'application/json',Authorization:`Bearer ${token}`};
    const bad = await originalFetch(base+'/api/commute/update-location',{method:'POST',headers,body:JSON.stringify({sessionId:id,location:{lat:91,lng:0}})});
    assert.equal(bad.status,400);
    let filter;
    CheckInSession.findOneAndUpdate = async f => { filter = f; return null; };
    const wrong = await originalFetch(base+'/api/commute/update-location',{method:'POST',headers,body:JSON.stringify({sessionId:id,location:{lat:0,lng:0}})});
    assert.equal(wrong.status,404);
    assert.deepEqual(filter,{_id:id,user:owner,status:'active'});
  } finally { CheckInSession.findOneAndUpdate = previous; await new Promise(resolve => server.close(resolve)); }
});
