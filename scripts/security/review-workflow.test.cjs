const test=require('node:test'),assert=require('node:assert/strict');
const {loadModule}=require('./load-module.cjs');
const date=new Date();
function fixture(status='SELF_ASSESSMENT', actor='subject') {
 const writes=[];
 const review={id:'review',memberId:'subject',reviewerId:'reviewer',status,cycle:{status:'ACTIVE',organizationId:'org',includeSelfAssessment:true,includeManagerReview:true}};
 const prisma={performanceReview:{findFirst:async()=>review,updateMany:async args=>{writes.push(args);return {count:1}},update:async({data})=>({...review,...data})},
 reviewGoal:{findFirst:async()=>({id:'goal'}),create:async()=>({id:'goal',title:'Goal',createdAt:date}),update:async()=>({id:'goal',createdAt:date}),deleteMany:async()=>({count:1})},
 reviewEvidence:{create:async()=>({id:'evidence',date,createdAt:date}),deleteMany:async()=>({count:1})},$transaction:async work=>work(prisma)};
 const mocks={'@/lib/prisma':{prisma},'@/lib/auth/config':{authOptions:{}},'next-auth':{getServerSession:async()=>({user:{id:'user',memberId:actor,organizationId:'org',role:'MEMBER'}})},'@/lib/ai':{}};
 return {review,prisma,writes,route:path=>loadModule(`src/app/api/reviews/[reviewId]${path}/route.ts`,mocks)};
}
const req=(method,body,query='')=>new Request('https://app.example.test/api'+query,{method,...(body?{headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});
const params={params:Promise.resolve({reviewId:'review'})};
for(const status of ['MANAGER_REVIEW','COMPLETED','ACKNOWLEDGED']) test(`subject cannot rewrite ${status} self assessment/goals/evidence`,async()=>{
 const f=fixture(status);
 for(const [path,method,body,query] of [['','PATCH',{selfAssessment:'rewrite',submitSelfAssessment:true}],['/goals','POST',{title:'New'}],['/goals','PATCH',{progress:100},'?goalId=goal'],['/goals','DELETE',null,'?goalId=goal'],['/evidence','POST',{evidenceType:'CUSTOM',title:'New',date:date.toISOString()}],['/evidence','DELETE',null,'?evidenceId=evidence']]) {
  const response=await f.route(path)[method](req(method,body,query),params);assert.equal(response.status,403,`${path}/${method}`);
 }
 assert.equal(f.writes.length,0);
});
test('correct phases preserve self submission, manager completion and subject acknowledgment',async()=>{
 const self=fixture();assert.equal((await self.route('').PATCH(req('PATCH',{selfAssessment:'Done',submitSelfAssessment:true}),params)).status,200);
 assert.equal(self.writes[0].where.status,'SELF_ASSESSMENT');
 const manager=fixture('MANAGER_REVIEW','reviewer');assert.equal((await manager.route('').PATCH(req('PATCH',{managerAssessment:'Reviewed',completeReview:true}),params)).status,200);
 const subject=fixture('COMPLETED');assert.equal((await subject.route('').PATCH(req('PATCH',{acknowledge:true}),params)).status,200);
 const wrong=fixture('SELF_ASSESSMENT','reviewer');assert.equal((await wrong.route('').PATCH(req('PATCH',{completeReview:true}),params)).status,403);
});
test('state or reviewer changed after read blocks both parent and child writes',async()=>{
 for(const [path,method,body] of [['','PATCH',{selfAssessment:'Text'}],['/goals','POST',{title:'Goal'}],['/evidence','POST',{evidenceType:'CUSTOM',title:'Evidence',date:date.toISOString()}]]) {
  const f=fixture();f.prisma.performanceReview.updateMany=async()=>({count:0});
  let child=0;f.prisma.reviewGoal.create=async()=>{child++};f.prisma.reviewEvidence.create=async()=>{child++};f.prisma.performanceReview.update=async()=>{child++};
  assert.equal((await f.route(path)[method](req(method,body),params)).status,409);assert.equal(child,0);
 }
});
test('dashboard filters recent shoutouts and counts through participant/public visibility',async()=>{
 const where=[];
 const prisma={organizationMember:{findUnique:async()=>null,findMany:async({include})=>{assert.equal(include.strengths.where.rank.lte,5);return[]}},shoutout:{findMany:async args=>{where.push(args.where);return[]},count:async args=>{where.push(args.where);return 0}},skillRequest:{findMany:async()=>[]}};
 const route=loadModule('src/app/api/dashboard/route.ts',{'@/lib/prisma':{prisma},'@/lib/auth/config':{authOptions:{}},'next-auth':{getServerSession:async()=>({user:{id:'user',memberId:'member',organizationId:'org',role:'MEMBER'}})},'@/lib/strengths/analytics':{generatePartnershipSuggestions:()=>[]}});
 assert.equal((await route.GET(req('GET'))).status,200);
 assert.equal(where.length,2);for(const scope of where){assert.equal(scope.organizationId,'org');assert.deepEqual(scope.OR,[{isPublic:true},{giverId:'member'},{receiverId:'member'}]);}
});


test('manager-only legacy initial phase permits reviewer content and denies subject content',async()=>{
 for(const actor of ['subject','reviewer']) {
  const f=fixture('NOT_STARTED',actor);f.review.cycle.includeSelfAssessment=false;
  assert.equal((await f.route('/goals').POST(req('POST',{title:'Goal'}),params)).status,actor==='reviewer'?201:403);
  assert.equal((await f.route('/evidence').POST(req('POST',{evidenceType:'CUSTOM',title:'Evidence',date:date.toISOString()}),params)).status,actor==='reviewer'?201:403);
 }
});
