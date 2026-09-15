const assert=require('node:assert/strict');
const {PrismaClient}=require(process.cwd()+'/node_modules/@prisma/client');
const {createHash,createHmac,randomBytes}=require('node:crypto');
const {hash}=require('bcryptjs');
const dburl=new URL(process.env.DATABASE_URL);
assert.equal(dburl.hostname,'127.0.0.1');assert.equal(dburl.port,'55487');assert.equal(dburl.pathname,'/strengthsync_security');assert.ok(!dburl.search);
for(const key of ['OPENAI_API_KEY','RESEND_API_KEY','AWS_ACCESS_KEY_ID','MICROSOFT_APP_PASSWORD','TEAMS_WEBHOOK_URL']) assert.ok(!process.env[key]);
const db=new PrismaClient();const base='http://127.0.0.1:3107';const run='http-'+Date.now();let checks=0;
class Client {
 constructor(){this.cookies=new Map()}
 async request(path,method='GET',body,form=false){
  const headers={cookie:[...this.cookies].map(([k,v])=>k+'='+v).join('; ')};
  if(body)headers['content-type']=form?'application/x-www-form-urlencoded':'application/json';
  const r=await fetch(base+path,{method,headers,body:body?(form?new URLSearchParams(body):JSON.stringify(body)):undefined,redirect:'manual'});
  for(const c of r.headers.getSetCookie()){const [kv]=c.split(';');const ix=kv.indexOf('=');this.cookies.set(kv.slice(0,ix),kv.slice(ix+1));}
  let data;try{data=await r.json()}catch{}
  return {status:r.status,data};
 }
 async login(email,password){const csrf=await this.request('/api/auth/csrf');const r=await this.request('/api/auth/callback/credentials','POST',{csrfToken:csrf.data.csrfToken,email,password,callbackUrl:base+'/dashboard',json:'true'},true);assert.equal(r.status,200);const s=await this.request('/api/auth/session');assert.ok(s.data.user?.id);return s.data.user;}
}
const check=(name,condition)=>{assert.ok(condition,name);checks++;console.log('PASS '+name)};
(async()=>{
const a=new Client(),v=new Client(),anon=new Client();const pw='LocalTesting123!';
const reg=async(c,label)=>{
 const email=run+label+'@example.test';
 const org=await db.organization.create({data:{name:run+label,slug:run+label}});
 const user=await db.user.create({data:{email,fullName:label+' Test',passwordHash:await hash(pw,12),emailVerified:false,emailVerificationRequired:false}});
 await db.organizationMember.create({data:{organizationId:org.id,userId:user.id,role:'OWNER',status:'ACTIVE'}});
 return c.login(email,pw);
};
const missingEmailRegistration=await anon.request('/api/auth/register','POST',{email:run+'new@example.test',password:pw,fullName:'New Test',organizationName:run+'new'});
check('registration fails closed without an email service',missingEmailRegistration.status>=400);
check('failed registration leaves no unverified account',await db.user.count({where:{email:run+'new@example.test'}})===0);
const owner=await reg(a,'owner'),victim=await reg(v,'recipient');check('credentials sign-in returns bound memberships',owner.organizationId!==victim.organizationId);
const unauth=await anon.request('/api/admin/members');check('anonymous API denied',unauth.status===401);
check('foreign profile denied',(await a.request('/api/members/'+victim.memberId)).status===404);
check('foreign card denied',(await a.request('/api/cards/'+victim.memberId)).status===404);
check('tenant owner cannot edit global settings',(await a.request('/api/admin/constants/themes')).status===403);
const settings=await a.request('/api/settings/organization');check('organization response omits raw settings',!Object.hasOwn(settings.data.data,'settings'));
const before=await db.user.findUnique({where:{id:victim.id},select:{passwordHash:true}});
const invite=await a.request('/api/admin/members','POST',{email:run+'recipient@example.test',fullName:'Changed name',role:'MEMBER'});
check('missing email configuration fails closed',invite.status>=400);
check('no silent existing-user membership',await db.organizationMember.count({where:{userId:victim.id,organizationId:owner.organizationId}})===0);
check('global credential remains unchanged',(await db.user.findUnique({where:{id:victim.id},select:{passwordHash:true}})).passwordHash===before.passwordHash);
// Fixture simulates an already issued email invitation. No provider is called.
const pending=await db.organizationMember.create({data:{userId:victim.id,organizationId:owner.organizationId,role:'MEMBER',status:'PENDING'}});
const payload=Buffer.from(JSON.stringify({purpose:'organization-invitation',userId:victim.id,organizationId:owner.organizationId,memberId:pending.id,role:'MEMBER',version:pending.updatedAt.toISOString(),expiresAt:Date.now()+600000})).toString('base64url');
const token=payload+'.'+createHmac('sha256',process.env.NEXTAUTH_SECRET).update(payload).digest('base64url');
const invitationPath='/api/organizations/invitations?token='+encodeURIComponent(token);
check('wrong account cannot accept recipient invitation',(await a.request(invitationPath,'POST')).status===403);
check('pending invite cannot be admin-activated',(await a.request('/api/admin/members/'+pending.id,'PATCH',{status:'ACTIVE'})).status>=400);
check('pending card not exposed',(await a.request('/api/cards/'+pending.id)).status===404);
check('recipient can review invitation',(await v.request(invitationPath)).status===200);
check('recipient explicitly accepts once',(await v.request(invitationPath,'POST')).status===200);
check('invitation replay rejected',(await v.request(invitationPath,'POST')).status===400);
const csrf=await v.request('/api/auth/csrf');const switched=await v.request('/api/auth/session','POST',{csrfToken:csrf.data.csrfToken,data:{organizationId:owner.organizationId,role:'OWNER',memberId:owner.memberId}});
check('organization switch ignores forged role',switched.data.user.organizationId===owner.organizationId&&switched.data.user.role==='MEMBER'&&switched.data.user.memberId===pending.id);
check('member cannot administer members',(await v.request('/api/admin/members')).status===403);
const cycle=await db.reviewCycle.create({data:{organizationId:owner.organizationId,name:'Synthetic cycle',cycleType:'QUARTERLY',status:'ACTIVE',startsAt:new Date(Date.now()-86400000),endsAt:new Date(Date.now()+86400000)}});
const review=await db.performanceReview.create({data:{cycleId:cycle.id,memberId:pending.id,reviewerId:owner.memberId,status:'SELF_ASSESSMENT',strengthsUsed:[]}});
const reviewPath='/api/reviews/'+review.id;
check('subject can add a goal during self assessment',(await v.request(reviewPath+'/goals','POST',{title:'Synthetic goal'})).status===201);
check('subject submits self assessment',(await v.request(reviewPath,'PATCH',{selfAssessment:'Synthetic self assessment',submitSelfAssessment:true})).status===200);
check('submitted self assessment cannot be rewritten',(await v.request(reviewPath,'PATCH',{selfAssessment:'Changed after submission'})).status===403);
check('reviewer completes manager assessment',(await a.request(reviewPath,'PATCH',{managerAssessment:'Synthetic manager assessment',completeReview:true})).status===200);
check('completed review cannot be reopened by subject',(await v.request(reviewPath,'PATCH',{submitSelfAssessment:true})).status===403);
check('completed review goal creation is denied',(await v.request(reviewPath+'/goals','POST',{title:'Post-completion goal'})).status===403);
check('completed review evidence creation is denied',(await v.request(reviewPath+'/evidence','POST',{evidenceType:'CUSTOM',title:'Post-completion evidence',date:new Date().toISOString()})).status===403);
check('subject can acknowledge completed review',(await v.request(reviewPath,'PATCH',{acknowledge:true})).status===200);
const raw=randomBytes(32).toString('hex');await db.user.update({where:{id:victim.id},data:{passwordResetToken:createHash('sha256').update(raw).digest('hex'),passwordResetExpires:new Date(Date.now()+600000)}});
check('reset link validates',(await anon.request('/api/auth/reset-password?token='+raw)).status===200);
check('reset link changes password',(await anon.request('/api/auth/reset-password','POST',{token:raw,password:'ChangedLocal123!'})).status===200);
check('reset token is single use',(await anon.request('/api/auth/reset-password','POST',{token:raw,password:'AgainLocal123!'})).status===400);
check('old session revoked by password reset',!(await v.request('/api/auth/session')).data.user);
check('revoked session can reach login page',(await v.request('/auth/login')).status===200);
await v.login(run+'recipient@example.test','ChangedLocal123!');check('new password signs in',true);
await db.organizationMember.update({where:{id:owner.memberId},data:{role:'MEMBER'}});check('role change effective immediately',(await a.request('/api/admin/members')).status===403);
await db.organizationMember.update({where:{id:owner.memberId},data:{status:'INACTIVE'}});check('suspended membership invalidates session',!(await a.request('/api/auth/session')).data.user);
const outCsrf=await v.request('/api/auth/csrf');await v.request('/api/auth/signout','POST',{csrfToken:outCsrf.data.csrfToken,callbackUrl:base+'/auth/login',json:'true'},true);check('logout clears session',!(await v.request('/api/auth/session')).data.user);
const setupToken=randomBytes(32).toString('hex');
const setupUser=await db.user.create({data:{email:run+'setup@example.test',fullName:'Setup Test',passwordHash:null,emailVerifyToken:createHash('sha256').update(setupToken).digest('hex'),emailVerifyExpires:new Date(Date.now()+600000)}});
await db.organizationMember.create({data:{userId:setupUser.id,organizationId:owner.organizationId,role:'MEMBER',status:'ACTIVE'}});
check('email setup link can be reviewed',(await anon.request('/api/auth/verify-email?token='+setupToken)).status===200);
check('email setup saves recipient-selected password',(await anon.request('/api/auth/verify-email','POST',{token:setupToken,password:'RecipientChosen123!'})).status===200);
check('email setup token cannot be reused',(await anon.request('/api/auth/verify-email','POST',{token:setupToken,password:'ReplayedPassword123!'})).status===400);
const verified=await db.user.findUnique({where:{id:setupUser.id}});
check('email setup verifies mailbox and clears token',verified.emailVerified&&verified.emailVerifyToken===null);
const setupClient=new Client();await setupClient.login(run+'setup@example.test','RecipientChosen123!');check('verified recipient can sign in',true);
check('scheduler GET rejects anonymous callers',(await anon.request('/api/cron/weekly-digest')).status===401);
console.log('HTTP workflow checks passed: '+checks);
})().catch(e=>{console.error(e.name+': '+e.message);process.exitCode=1}).finally(async()=>{await db.organization.deleteMany({where:{slug:{startsWith:run}}});await db.user.deleteMany({where:{email:{startsWith:run}}});await db.$disconnect()});
