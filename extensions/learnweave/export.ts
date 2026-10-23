import type { NextRequest } from 'next/server';
import { withRequestOwner, probeStageAccess, ownerJson, ownerNotFound } from './adapter';
import { learnweaveEnabled } from './config';
import { produceBundle, ProductionError } from './production';
export async function exportBundle(req:NextRequest,stageId:string){
  if(!learnweaveEnabled())return new Response('Not found',{status:404});
  return withRequestOwner(req,async({ownerId},headers)=>{
    if((await probeStageAccess(ownerId,stageId)).kind!=='owned')return ownerNotFound(headers);
    try{return ownerJson(await produceBundle(ownerId,stageId),200,headers);}catch(e){return ownerJson({message:e instanceof Error?e.message:'导出失败',...(e instanceof ProductionError&&e.report?{report:e.report}:{})},e instanceof ProductionError?e.status:503,headers);}
  });
}
