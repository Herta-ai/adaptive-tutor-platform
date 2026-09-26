import {writeFileSync} from 'node:fs';
import {Store,dataRoot,uuid} from '../src/storage/database.js';
import {createApplication} from '../src/server/http.js';
import {publishConnection} from '../src/server/connection.js';

// Manual follow-through probe of the production queue and publication path.
const store=new Store(dataRoot(),true),app=createApplication(store);let dispose=()=>{};
try{
 await app.listen();dispose=publishConnection(store.root,app.origin,app.mcpToken);
 const course=store.list('course').find(c=>c.title==='M0 协议验证课程');if(!course)throw Error('请先执行已授权的 M0 探针');const node=store.list('node',course.id)[0];
 const request=store.command('probe.lesson',uuid(),{},()=>app.jobs.enqueue('generate_lesson',{nodeId:node.id},course.id));console.log('M0/M1：生产任务队列生成一个合成学习节点');let job:any;
 for(let i=0;i<330;i++){await new Promise(r=>setTimeout(r,1000));job=store.must('job',request.requestId);if(['completed','failed','cancelled','interrupted'].includes(job.state))break;if(i%30===29)console.log('生成仍在进行，状态：'+job.state);}
 if(!['completed','failed','cancelled','interrupted'].includes(job.state))job=app.jobs.cancel(request.requestId);
 const lesson=store.list('lesson',course.id,node.id).at(-1);const report={cliVersion:app.jobs.runtime.version,status:job.state,error:job.error??null,blocks:lesson?.document.blocks.length??0,exercises:lesson?.document.exercises.length??0,elapsedMs:job.elapsedMs??null};writeFileSync('specs/phase-1/M0/live-generation.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(job.state!=='completed')process.exitCode=1;
}finally{dispose();await app.close();store.close();}
