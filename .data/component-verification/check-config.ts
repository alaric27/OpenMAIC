import {readFileSync} from 'node:fs';
import {loadModelConfigFile} from '../../lib/server/model-config/openmaic-yml';
import {createRequire} from 'node:module';
const r=createRequire('/Users/zyn/Desktop/mycode/learnweave/server/package.json');
const env={...process.env,...r('dotenv').parse(readFileSync('.env.local'))};
const c=loadModelConfigFile(env)!;
console.log(JSON.stringify({video:c.slots?.video,provider:{...c.providers?.['learnweave-video'],apiKey:'[REDACTED]'}}));
