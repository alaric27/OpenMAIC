import type {NextRequest} from 'next/server';
import {withRequestOwner,probeStageAccess,ownerJson,ownerNotFound} from '@/extensions/learnweave/adapter';
import {learnweaveEnabled} from '@/extensions/learnweave/config';
import {readCourse,saveCourse,productionSpec,ProductionError} from '@/extensions/learnweave/production';
export const runtime='nodejs';
async function run(req:NextRequest,context:{params:Promise<{id:string}>},write:boolean){if(!learnweaveEnabled())return new Response('Not found',{status:404});const {id}=await context.params;return withRequestOwner(req,async({ownerId},headers)=>{if((await probeStageAccess(ownerId,id)).kind!=='owned')return ownerNotFound(headers);try{if(!write)return ownerJson({...(await readCourse(id)||{revision:0,manifest:null}),productionSpec:await productionSpec()},200,headers);const body=await req.json();if(!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0||Object.keys(body).some(k=>!['expectedRevision','manifest'].includes(k)))throw new ProductionError('输入格式无效');return ownerJson(await saveCourse(ownerId,id,body.expectedRevision,body.manifest),200,headers);}catch(e){return ownerJson({message:e instanceof Error?e.message:'清单操作失败',...(e instanceof ProductionError&&e.report?{report:e.report}:{})},e instanceof ProductionError?e.status:503,headers);}});}
export function GET(req:NextRequest,context:{params:Promise<{id:string}>}){return run(req,context,false);}
export function PUT(req:NextRequest,context:{params:Promise<{id:string}>}){return run(req,context,true);}
