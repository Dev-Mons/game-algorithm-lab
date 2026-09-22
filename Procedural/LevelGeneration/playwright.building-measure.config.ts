import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./e2e',workers:1,timeout:1800000,use:{baseURL:'http://127.0.0.1:5180',viewport:{width:1440,height:960},headless:true,screenshot:'off',trace:'off'},webServer:{command:'npm run preview -- --port 5180 --strictPort',url:'http://127.0.0.1:5180',reuseExistingServer:false}});
