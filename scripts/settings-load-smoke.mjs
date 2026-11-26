import { whatsNewVersion } from './visual-current-version.mjs';
// Isolated local demo only; never point this smoke test at production.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
const base='http://127.0.0.1:5173', fp='nav-test-'+Date.now();
const r=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json','x-device-fingerprint':fp},body:JSON.stringify({username:'test',password:'test',fingerprint:fp,client:'web'})}); const auth=await r.json();
const browser=await puppeteer.launch({executablePath:await chromium.executablePath(),args:[...chromium.args,'--no-sandbox'],headless:true});
try {const page=await browser.newPage();await page.setViewport({width:1440,height:900});await page.evaluateOnNewDocument((a,f,whatsNewVersion)=>{for(const [k,v] of Object.entries({stock_auth_token:a.token,stock_auth_user:'test',stock_role:a.role,stock_display_name:a.display_name,stock_device_fp:f,atlas_demo_session:JSON.stringify({...a.demo,intro_seen:true}),atlas_lang:'fr',atlas_welcome_completed:'true',atlas_onboarding:JSON.stringify({status:'done',step:0}), 'atlas-whats-new-modal-seen':whatsNewVersion,atlas_cookie_consent_v1:JSON.stringify({version:1,necessary:true,preferences:false,analytics:false,method:'necessary_only',decidedAt:'2026-01-01T00:00:00Z'})}))localStorage.setItem(k,String(v));},auth,fp,whatsNewVersion);
let paths=[];page.on('request',req=>{if(req.url().includes('/api/'))paths.push(new URL(req.url()).pathname)});
await page.goto(base+'/settings?tab=profile',{waitUntil:'networkidle2'});await page.waitForSelector('.settings-main');assert.deepEqual(paths.filter(p=>['/api/categories','/api/units','/api/admin/audit'].includes(p)), []); paths=[];
async function nav(tab){await page.evaluate(t=>{history.pushState({},'',`/settings?tab=${t}`);dispatchEvent(new PopStateEvent('popstate'));},tab);}
await nav('categories');await page.waitForSelector('[data-visual-review="category-create"]',{timeout:30000});assert.deepEqual(paths.filter(p=>p==='/api/categories'||p==='/api/units').sort(), ['/api/categories', '/api/units']); paths=[];await nav('profile');await nav('categories');await page.waitForSelector('[data-visual-review="category-create"]');await new Promise(r=>setTimeout(r,500));assert.deepEqual(paths.filter(p=>p==='/api/categories'||p==='/api/units'), []); console.log('Settings lazy-load and tab revisit smoke test passed.');
}finally{await browser.close()}
