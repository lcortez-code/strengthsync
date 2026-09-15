const test = require('node:test');
const assert = require('node:assert/strict');
test('readiness checks fail missing configuration without printing secret values', async () => {
  const {checkReleaseReadiness} = await import('./check-release-readiness.mjs');
  const result = checkReleaseReadiness({}, {artifactExists:()=>false});
  assert.equal(result.ready,false);
  assert.ok(result.checks.filter(x=>x.status==='BLOCKED').length>=7);
  const complete = {NEXTAUTH_SECRET:'x'.repeat(48),CRON_SECRET:'y'.repeat(48),NEXTAUTH_URL:'https://app.example.test',DATABASE_URL:'postgresql://db.internal/app',STRENGTHSYNC_PLATFORM_ADMIN_USER_IDS:'operator-id',RESEND_API_KEY:'private-test-credential',RESEND_FROM_EMAIL:'sender@example.test'};
  assert.equal(checkReleaseReadiness(complete,{artifactExists:()=>true}).ready,true);
  const unsafe = checkReleaseReadiness({...complete,NODE_TLS_REJECT_UNAUTHORIZED:'0',MICROSOFT_APP_ID:'partial',STRENGTHSYNC_TRUSTED_CLIENT_IP_HEADER:'x-forwarded-for'},{artifactExists:()=>true});
  assert.equal(unsafe.ready,false);
  assert.ok(unsafe.checks.filter(x=>x.status==='BLOCKED').length===3);
  assert.doesNotMatch(JSON.stringify(unsafe),/private-test-credential|operator-id|sender@example/);
});


test('pagination rejects malformed/negative/nonfinite values and caps allocations',()=>{
 const {loadModule}=require('./load-module.cjs');const {boundedPageNumber}=loadModule('src/lib/api/pagination.ts');
 for(const value of [null,'','-1','0','NaN','Infinity','1e9','2.5','10garbage','9'.repeat(1000)]) assert.equal(boundedPageNumber(value,20,100),20);
 assert.equal(boundedPageNumber('1000000',20,100),100);assert.equal(boundedPageNumber('3',20,100),3);
});
