// No provider calls: operation classification, not document prose or auth transport.
import assert from 'node:assert/strict';
import { protectedAppAction as app, protectedRequest as request, needsActionConfirm as gate } from '../src/approval-scope.js';
for (const s of ['GOOGLEDOCS_CREATE_DOCUMENT_MARKDOWN','GOOGLESHEETS_BATCH_UPDATE','GMAIL_SEND_EMAIL','GMAIL_DELETE_EMAIL','GOOGLECALENDAR_CREATE_EVENT','NOTION_CREATE_PAGE','CLOUDFLARE_SEARCH','CLOUDFLARE_EXECUTE','CLOUDFLARE_API_KEY_GET_ZONES','DROPBOX_TRANSFER_FILE','SLACK_CREATE_SUBSCRIPTION']) {
  assert.equal(app(s,{body:'please pay rent',title:'API keys',attendees:['a@example.com']}),false,s);
}
for (const s of ['STRIPE_CREATE_PAYMENT_INTENT','PAYPAL_CAPTURE_ORDER','STRIPE_PAY_INVOICE','STRIPE_CREATE_SUBSCRIPTION','WISE_CREATE_TRANSFER','CLOUDFLARE_CREATE_API_TOKEN','SERVICE_GET_API_KEY','SERVICE_REVOKE_ACCESS_KEY']) assert.equal(app(s),true,s);
for (const s of ['STRIPE_LIST_PAYMENTS','PAYPAL_GET_ORDER','STRIPE_RETRIEVE_INVOICE']) assert.equal(app(s),false,s);
assert.equal(app('SERVICE_BATCH',{actions:[{action:'STRIPE_CREATE_PAYMENT_INTENT',arguments:{amount:100}}]}),true);
assert.equal(app('CLOUDFLARE_CREATE_TOKEN'),true);
assert.equal(request('POST','/client/v4/user/tokens','api.cloudflare.com'),true);
assert.equal(request('GET','/client/v4/accounts/abc/tokens','cloudflare'),true);
assert.equal(request('POST','/oauth/token','api.cloudflare.com'),false);
assert.equal(app('SERVICE_BATCH',{requests:[{method:'POST',path:'/v1/payments'}]}),true);
assert.equal(app('SERVICE_BATCH',{requests:[{method:'PATCH',path:'/v1/documents'}]}),false);
assert.equal(app('SERVICE_BATCH',{tools:[{tool_slug:'GOOGLEDOCS_CREATE_DOCUMENT',arguments:{text:'STRIPE_CREATE_PAYMENT_INTENT'}}]}),false);
const cyclic={};cyclic.actions=[{action:'SERVICE_BATCH',arguments:cyclic}];assert.equal(app('SERVICE_BATCH',cyclic),true,'bounded recursion');
for(const [method,path,service,want] of [
 ['GET','/v1/api_keys','service',true],['GET','/v1/%61pi_keys','service',true],
 ['POST','/v1/payment_intents','stripe',true],['POST','/v2/checkout/orders','paypal',true],
 ['POST','/v1/transfers','api.stripe.com',true],['POST','/v1/transfers','files.example',false],
 ['POST','/v1/subscriptions','slack',false],['POST','/oauth/token','service',false],
 ['GET','/v1/payments','stripe',false],['POST','/notes?title=api_keys','service',false],
 ['DELETE','/documents/42','googledocs',false],['POST','https://api.stripe.com/v1/transfers','',true],
]) assert.equal(request(method,path,service),want,`${method} ${path} ${service}`);
assert.equal(gate({tool:'gmail_send',payload:{body:'pay'}}),false);
assert.equal(gate({tool:'app_run',payload:{action:'STRIPE_CREATE_PAYMENT_INTENT',arguments:{amount:100}}}),true);
assert.equal(gate({tool:'app_proxy',payload:{app:'paypal',method:'POST',endpoint:'https://api.paypal.com/v2/checkout/orders'}}),true);
assert.equal(gate({tool:'app_proxy',payload:{app:'cloudflare',method:'POST',endpoint:'https://api.cloudflare.com/client/v4/zones'}}),false);
console.log('approval-scope: ordinary actions, protected payments/keys, provider auth prefixes, batches and URL normalization passed');
