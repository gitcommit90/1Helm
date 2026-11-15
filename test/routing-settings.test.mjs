import assert from 'node:assert/strict';
import { seedFresh } from '../src/ee/model-seed.js';
import { validateModelSettings, pruneCatalog } from '../src/ee/model-settings.js';
import { routingCategories, routingChain, withRoutingConfig } from '../src/ee/routing-config.js';
const copy = value => structuredClone(value);
const baseline = validateModelSettings(seedFresh({}));
const config = validateModelSettings(withRoutingConfig(baseline));   // the first-run settings are already version 3
// An earlier version 2 setting: one chat job with its models and limits. Moving it to categories drops the job and copies its limits onto General.
const legacy = copy(baseline), seen = Object.values(baseline.routing.categories[0].chains).flat();
legacy.version = 2; delete legacy.routing;
{ const list = [...new Set(seen.map(e => e.model))].map(m => seen.find(e => e.model === m)), [first, ...rest] = list; legacy.jobs.chat = { ...copy(first), fallbacks: copy(rest), max_output: 900, sort: 'latency' }; }
assert.equal(config.version,3);assert.equal(routingCategories(config).length,1);
assert.deepEqual(config.jobs,baseline.jobs);
for (const chain of Object.values(config.routing.categories[0].chains)) assert.equal(chain.length,3);
assert.equal(routingChain(config,'unknown','zdr')[0].model,config.routing.categories[0].chains.zdr[0].model);
const arbitraryTitle = 'Life sciences / biology <script>not instructions</script>';
config.routing.categories.push({...copy(config.routing.categories[0]),id:'cat_science',title:arbitraryTitle});
assert.equal(validateModelSettings(config).routing.categories[1].title,arbitraryTitle);
const invalid = fn => {const bad=copy(config);fn(bad);assert.throws(()=>validateModelSettings(bad),e=>e.status===400);};
invalid(c=>c.routing.categories.shift());
invalid(c=>c.routing.categories[0].title='Primary');
invalid(c=>c.routing.categories[1].title='');
invalid(c=>c.routing.categories[1].title='General');
invalid(c=>c.routing.categories[1].title='line\nbreak');
invalid(c=>c.routing.categories[1].chains.zdr[2]=null);
invalid(c=>c.routing.categories[1].chains.zdr[2]=copy(c.routing.categories[1].chains.zdr[0]));
invalid(c=>c.routing.categories[1].chains.zdr.pop());
invalid(c=>c.routing.categories[1].chains.zdr[2]=copy(c.routing.categories[0].chains.unrestricted[0]));
const explicit=copy(legacy);explicit.jobs['chat'].fallbacks=explicit.jobs['chat'].fallbacks.filter(e=>e.model!=='anthropic/claude-haiku-5.5');
assert.throws(()=>withRoutingConfig(explicit),/three eligible/);
const migrated=withRoutingConfig(explicit,{zdrThirdModel:'anthropic/claude-haiku-5.5'});validateModelSettings(migrated);
assert.equal(migrated.routing.categories[0].chains.zdr[2].model,'anthropic/claude-haiku-5.5');assert.equal(migrated.routing.categories[0].max_output,900);assert.equal(migrated.routing.categories[0].sort,'latency');assert.ok(!('chat' in migrated.jobs),'the chat job is dropped');
assert.deepEqual(migrated.routing.categories[0].chains.zdr[2],Object.values(explicit.jobs).flatMap(j=>[j,...j.fallbacks]).filter(e=>e.model==='anthropic/claude-haiku-5.5').map(({fallbacks,...e})=>e)[0]);
const dynamicOnly=copy(config);const id='fixture/routing-only';dynamicOnly.catalog[id]={...copy(dynamicOnly.catalog[config.routing.categories[0].chains.zdr[0].model]),id,name:'Routing only'};dynamicOnly.routing.categories[1].chains.zdr[2]={model:id,effort:dynamicOnly.catalog[id].efforts[0]};
assert.ok(pruneCatalog(dynamicOnly).catalog[id]);
console.log('PASS dynamic routing settings, protected category, privacy chains, explicit migration and catalog retention');
