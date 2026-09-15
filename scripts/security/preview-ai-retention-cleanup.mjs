import { PrismaClient } from '@prisma/client';

// Read-only and restricted to the disposable verification database for this assessment.
const url = new URL(process.env.DATABASE_URL || '');
if (!['postgres:','postgresql:'].includes(url.protocol) || !['127.0.0.1','localhost'].includes(url.hostname) || url.port !== '55487' || url.pathname !== '/strengthsync_security' || url.search) throw new Error('Disposable security database required');
const prisma = new PrismaClient();
try {
  const usageRows = await prisma.aIUsageLog.count({where:{OR:[{requestSummary:{not:null}},{responseSummary:{not:null}},{errorMessage:{not:null,notIn:['generation_failed']}}]}});
  const deletedConversationMessages = await prisma.aIMessage.count({where:{conversation:{status:'DELETED'}}});
  console.log(JSON.stringify({mode:'preview-only',usageRows,deletedConversationMessages}));
} finally { await prisma.$disconnect(); }
