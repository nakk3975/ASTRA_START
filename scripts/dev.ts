import {spawn} from 'node:child_process';
const api=spawn('node',['--import','tsx','apps/server/src/main.ts'],{stdio:'inherit',env:process.env});
const web=spawn('node',['node_modules/vite/bin/vite.js','--config','apps/web/vite.config.ts','--host','0.0.0.0','--port',process.env.PORT??'3000'],{stdio:'inherit',env:process.env});
for(const s of ['SIGTERM','SIGINT'] as const)process.on(s,()=>{api.kill(s);web.kill(s);});
