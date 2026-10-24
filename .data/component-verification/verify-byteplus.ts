import {privateDecrypt,constants} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {submitSeedanceTask,pollSeedanceTask} from '../../lib/media/adapters/seedance-adapter';
const sealed='ovuM3Ptm+r4KjxIeYx1EK8DBH6xphGW0+bA441VGYhJCKeFM6cY4Z31aXVbMeqr1IygcPpVdsZyHkCbzr6XkJySu4EE2tNwtOo66YSgNRJtdd49nhIKclWNTNSb0BwVrEjqdQR6WKPnZcBSrmvkaioNb5X5F+bz6zBWdn4CKqhNmyfnyjoOLKHVFk7U6ZT5D/pGpmVjAlfzv9QEabv/G5PULk+nylDssVcOPCT+4aI6MrcB24ioVMrTidnY0unvS+prRRY2ONYF9BO6Zn67KV0ZdfAVKzhAkk1hycbmhe71BD5TOBpP2LXulqjvWdVbco2mdvW7ysY2nvF5p46+TEw==';
const apiKey=privateDecrypt({key:readFileSync('/tmp/component-video-transfer.private.pem'),oaepHash:'sha256',padding:constants.RSA_PKCS1_OAEP_PADDING},Buffer.from(sealed,'base64')).toString();
const config={providerId:'seedance',apiKey,model:'ep-20260916173130-m4h9n',baseUrl:'https://ark.ap-southeast.bytepluses.com/api/v3'};
writeFileSync('/tmp/component-byteplus.private.json',JSON.stringify(config),{mode:0o600});
(async()=>{
 const id=await submitSeedanceTask(config,{prompt:'A friendly cartoon camel standing in a sandy desert, gently turning its head. Educational illustration for children. No text, no subtitles.',duration:5,aspectRatio:'16:9',resolution:'720p'});
 console.log(JSON.stringify({phase:'submitted',taskId:id,model:config.model}));
 const receipt:any={provider:'BytePlus Ark',modelAlias:'seedance-2.5',endpoint:config.model,baseUrl:config.baseUrl,taskId:id,startedAt:new Date().toISOString(),status:'submitted'};
 const save=()=>writeFileSync('.data/component-verification/byteplus-video-receipt.json',JSON.stringify(receipt,null,2));save();
 for(let i=0;i<120;i++){
  const result=await pollSeedanceTask(config,id);
  if(result){receipt.status='succeeded';receipt.result=result;receipt.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({phase:'succeeded',taskId:id,duration:result.duration,width:result.width,height:result.height,videoHost:new URL(result.url).hostname}));return;}
  if(i%6===0)console.log(JSON.stringify({phase:'waiting',taskId:id,seconds:i*5}));
  await delay(5000);
 }
 receipt.status='pending-timeout';save();throw Error('同一任务等待超时，不重新生成');
})().catch(e=>{console.error(String(e.message).replaceAll(apiKey,'[REDACTED]'));process.exitCode=1;});
