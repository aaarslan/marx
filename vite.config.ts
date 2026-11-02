import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {resolve} from 'node:path';
export default defineConfig({root:'src/renderer',plugins:[react()],resolve:{alias:{'@shared':resolve('src/shared'),'@':resolve('src/renderer/src')}},build:{outDir:resolve('native/frontend/dist'),emptyOutDir:true}});
