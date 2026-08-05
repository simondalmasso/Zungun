import { cpSync, mkdirSync } from 'node:fs';
mkdirSync('dist/apps/control-room/public',{recursive:true});
cpSync('apps/control-room/public','dist/apps/control-room/public',{recursive:true});
mkdirSync('dist/docs',{recursive:true});
cpSync('docs','dist/docs',{recursive:true});
