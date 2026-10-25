/*! img-fx (https://libraries.dev/image), bundled with react and three.
 * MIT License
 * 
 * Copyright (c) 2026 Jakub Antalik
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
var Yb=Object.create;var pv=Object.defineProperty;var Zb=Object.getOwnPropertyDescriptor;var Jb=Object.getOwnPropertyNames;var Kb=Object.getPrototypeOf,Qb=Object.prototype.hasOwnProperty;var Hi=(e,t)=>()=>{try{return t||e((t={exports:{}}).exports,t),t.exports}catch(n){throw t=0,n}};var jb=(e,t,n,i)=>{if(t&&typeof t=="object"||typeof t=="function")for(let a of Jb(t))!Qb.call(e,a)&&a!==n&&pv(e,a,{get:()=>t[a],enumerable:!(i=Zb(t,a))||i.enumerable});return e};var Hc=(e,t,n)=>(n=e!=null?Yb(Kb(e)):{},jb(t||!e||!e.__esModule?pv(n,"default",{value:e,enumerable:!0}):n,e));var wv=Hi(kt=>{"use strict";var Rd=Symbol.for("react.transitional.element"),$b=Symbol.for("react.portal"),tT=Symbol.for("react.fragment"),eT=Symbol.for("react.strict_mode"),nT=Symbol.for("react.profiler"),iT=Symbol.for("react.consumer"),aT=Symbol.for("react.context"),sT=Symbol.for("react.forward_ref"),rT=Symbol.for("react.suspense"),oT=Symbol.for("react.memo"),xv=Symbol.for("react.lazy"),lT=Symbol.for("react.activity"),cT=Symbol.for("react.view_transition"),mv=Symbol.iterator;function uT(e){return e===null||typeof e!="object"?null:(e=mv&&e[mv]||e["@@iterator"],typeof e=="function"?e:null)}var yv={isMounted:function(){return!1},enqueueForceUpdate:function(){},enqueueReplaceState:function(){},enqueueSetState:function(){}},Sv=Object.assign,Mv={};function br(e,t,n){this.props=e,this.context=t,this.refs=Mv,this.updater=n||yv}br.prototype.isReactComponent={};br.prototype.setState=function(e,t){if(typeof e!="object"&&typeof e!="function"&&e!=null)throw Error("takes an object of state variables to update or a function which returns an object of state variables.");this.updater.enqueueSetState(this,e,t,"setState")};br.prototype.forceUpdate=function(e){this.updater.enqueueForceUpdate(this,e,"forceUpdate")};function bv(){}bv.prototype=br.prototype;function Dd(e,t,n){this.props=e,this.context=t,this.refs=Mv,this.updater=n||yv}var Nd=Dd.prototype=new bv;Nd.constructor=Dd;Sv(Nd,br.prototype);Nd.isPureReactComponent=!0;var gv=Array.isArray;function Cd(){}var Re={H:null,A:null,T:null,S:null},Tv=Object.prototype.hasOwnProperty;function Ud(e,t,n){var i=n.ref;return{$$typeof:Rd,type:e,key:t,ref:i!==void 0?i:null,props:n}}function fT(e,t){return Ud(e.type,t,e.props)}function Ld(e){return typeof e=="object"&&e!==null&&e.$$typeof===Rd}function hT(e){var t={"=":"=0",":":"=2"};return"$"+e.replace(/[=:]/g,function(n){return t[n]})}var vv=/\/+/g;function wd(e,t){return typeof e=="object"&&e!==null&&e.key!=null?hT(""+e.key):t.toString(36)}function dT(e){switch(e.status){case"fulfilled":return e.value;case"rejected":throw e.reason;default:switch(typeof e.status=="string"?e.then(Cd,Cd):(e.status="pending",e.then(function(t){e.status==="pending"&&(e.status="fulfilled",e.value=t)},function(t){e.status==="pending"&&(e.status="rejected",e.reason=t)})),e.status){case"fulfilled":return e.value;case"rejected":throw e.reason}}throw e}function Mr(e,t,n,i,a){var s=typeof e;(s==="undefined"||s==="boolean")&&(e=null);var r=!1;if(e===null)r=!0;else switch(s){case"bigint":case"string":case"number":r=!0;break;case"object":switch(e.$$typeof){case Rd:case $b:r=!0;break;case xv:return r=e._init,Mr(r(e._payload),t,n,i,a)}}if(r)return a=a(e),r=i===""?"."+wd(e,0):i,gv(a)?(n="",r!=null&&(n=r.replace(vv,"$&/")+"/"),Mr(a,t,n,"",function(c){return c})):a!=null&&(Ld(a)&&(a=fT(a,n+(a.key==null||e&&e.key===a.key?"":(""+a.key).replace(vv,"$&/")+"/")+r)),t.push(a)),1;r=0;var o=i===""?".":i+":";if(gv(e))for(var l=0;l<e.length;l++)i=e[l],s=o+wd(i,l),r+=Mr(i,t,n,s,a);else if(l=uT(e),typeof l=="function")for(e=l.call(e),l=0;!(i=e.next()).done;)i=i.value,s=o+wd(i,l++),r+=Mr(i,t,n,s,a);else if(s==="object"){if(typeof e.then=="function")return Mr(dT(e),t,n,i,a);throw t=String(e),Error("Objects are not valid as a React child (found: "+(t==="[object Object]"?"object with keys {"+Object.keys(e).join(", ")+"}":t)+"). If you meant to render a collection of children, use an array instead.")}return r}function Vc(e,t,n){if(e==null)return e;var i=[],a=0;return Mr(e,i,"","",function(s){return t.call(n,s,a++)}),i}function pT(e){if(e._status===-1){var t=e._result,n=t();n.then(function(i){(e._status===0||e._status===-1)&&(e._status=1,e._result=i,n.status===void 0&&(n.status="fulfilled",n.value=i))},function(i){(e._status===0||e._status===-1)&&(e._status=2,e._result=i,n.status===void 0&&(n.status="rejected",n.reason=i))}),e._status===-1&&(e._status=0,e._result=n)}if(e._status===1)return e._result.default;throw e._result}var _v=typeof reportError=="function"?reportError:function(e){if(typeof window=="object"&&typeof window.ErrorEvent=="function"){var t=new window.ErrorEvent("error",{bubbles:!0,cancelable:!0,message:typeof e=="object"&&e!==null&&typeof e.message=="string"?String(e.message):String(e),error:e});if(!window.dispatchEvent(t))return}else if(typeof process=="object"&&typeof process.emit=="function"){process.emit("uncaughtException",e);return}console.error(e)};function Ev(e){var t=Re.T,n={};n.types=t!==null?t.types:null,Re.T=n;try{var i=e(),a=Re.S;a!==null&&a(n,i),typeof i=="object"&&i!==null&&typeof i.then=="function"&&i.then(Cd,_v)}catch(s){_v(s)}finally{t!==null&&n.types!==null&&(t.types=n.types),Re.T=t}}function Av(e){var t=Re.T;if(t!==null){var n=t.types;n===null?t.types=[e]:n.indexOf(e)===-1&&n.push(e)}else Ev(Av.bind(null,e))}var mT={map:Vc,forEach:function(e,t,n){Vc(e,function(){t.apply(this,arguments)},n)},count:function(e){var t=0;return Vc(e,function(){t++}),t},toArray:function(e){return Vc(e,function(t){return t})||[]},only:function(e){if(!Ld(e))throw Error("React.Children.only expected to receive a single React element child.");return e}};kt.Activity=lT;kt.Children=mT;kt.Component=br;kt.Fragment=tT;kt.Profiler=nT;kt.PureComponent=Dd;kt.StrictMode=eT;kt.Suspense=rT;kt.ViewTransition=cT;kt.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE=Re;kt.__COMPILER_RUNTIME={__proto__:null,c:function(e){return Re.H.useMemoCache(e)}};kt.addTransitionType=Av;kt.cache=function(e){return function(){return e.apply(null,arguments)}};kt.cacheSignal=function(){return null};kt.cloneElement=function(e,t,n){if(e==null)throw Error("The argument must be a React element, but you passed "+e+".");var i=Sv({},e.props),a=e.key;if(t!=null)for(s in t.key!==void 0&&(a=""+t.key),t)!Tv.call(t,s)||s==="key"||s==="__self"||s==="__source"||s==="ref"&&t.ref===void 0||(i[s]=t[s]);var s=arguments.length-2;if(s===1)i.children=n;else if(1<s){for(var r=Array(s),o=0;o<s;o++)r[o]=arguments[o+2];i.children=r}return Ud(e.type,a,i)};kt.createContext=function(e){return e={$$typeof:aT,_currentValue:e,_currentValue2:e,_threadCount:0,Provider:null,Consumer:null},e.Provider=e,e.Consumer={$$typeof:iT,_context:e},e};kt.createElement=function(e,t,n){var i,a={},s=null;if(t!=null)for(i in t.key!==void 0&&(s=""+t.key),t)Tv.call(t,i)&&i!=="key"&&i!=="__self"&&i!=="__source"&&(a[i]=t[i]);var r=arguments.length-2;if(r===1)a.children=n;else if(1<r){for(var o=Array(r),l=0;l<r;l++)o[l]=arguments[l+2];a.children=o}if(e&&e.defaultProps)for(i in r=e.defaultProps,r)a[i]===void 0&&(a[i]=r[i]);return Ud(e,s,a)};kt.createRef=function(){return{current:null}};kt.forwardRef=function(e){return{$$typeof:sT,render:e}};kt.isValidElement=Ld;kt.lazy=function(e){return{$$typeof:xv,_payload:{_status:-1,_result:e},_init:pT}};kt.memo=function(e,t){return{$$typeof:oT,type:e,compare:t===void 0?null:t}};kt.startTransition=Ev;kt.unstable_useCacheRefresh=function(){return Re.H.useCacheRefresh()};kt.use=function(e){return Re.H.use(e)};kt.useActionState=function(e,t,n){return Re.H.useActionState(e,t,n)};kt.useCallback=function(e,t){return Re.H.useCallback(e,t)};kt.useContext=function(e){return Re.H.useContext(e)};kt.useDebugValue=function(){};kt.useDeferredValue=function(e,t){return Re.H.useDeferredValue(e,t)};kt.useEffect=function(e,t){return Re.H.useEffect(e,t)};kt.useEffectEvent=function(e){return Re.H.useEffectEvent(e)};kt.useId=function(){return Re.H.useId()};kt.useImperativeHandle=function(e,t,n){return Re.H.useImperativeHandle(e,t,n)};kt.useInsertionEffect=function(e,t){return Re.H.useInsertionEffect(e,t)};kt.useLayoutEffect=function(e,t){return Re.H.useLayoutEffect(e,t)};kt.useMemo=function(e,t){return Re.H.useMemo(e,t)};kt.useOptimistic=function(e,t){return Re.H.useOptimistic(e,t)};kt.useReducer=function(e,t,n){return Re.H.useReducer(e,t,n)};kt.useRef=function(e){return Re.H.useRef(e)};kt.useState=function(e){return Re.H.useState(e)};kt.useSyncExternalStore=function(e,t,n){return Re.H.useSyncExternalStore(e,t,n)};kt.useTransition=function(){return Re.H.useTransition()};kt.version="19.3.1"});var Ko=Hi((YN,Cv)=>{"use strict";Cv.exports=wv()});var zv=Hi(Ie=>{"use strict";function Bd(e,t){var n=e.length;e.push(t);t:for(;0<n;){var i=n-1>>>1,a=e[i];if(0<Gc(a,t))e[i]=t,e[n]=a,n=i;else break t}}function Vi(e){return e.length===0?null:e[0]}function Xc(e){if(e.length===0)return null;var t=e[0],n=e.pop();if(n!==t){e[0]=n;t:for(var i=0,a=e.length,s=a>>>1;i<s;){var r=2*(i+1)-1,o=e[r],l=r+1,c=e[l];if(0>Gc(o,n))l<a&&0>Gc(c,o)?(e[i]=c,e[l]=n,i=l):(e[i]=o,e[r]=n,i=r);else if(l<a&&0>Gc(c,n))e[i]=c,e[l]=n,i=l;else break t}}return t}function Gc(e,t){var n=e.sortIndex-t.sortIndex;return n!==0?n:e.id-t.id}Ie.unstable_now=void 0;typeof performance=="object"&&typeof performance.now=="function"?(Rv=performance,Ie.unstable_now=function(){return Rv.now()}):(Od=Date,Dv=Od.now(),Ie.unstable_now=function(){return Od.now()-Dv});var Rv,Od,Dv,ha=[],za=[],gT=1,ri=null,vn=3,zd=!1,Qo=!1,jo=!1,Fd=!1,Lv=typeof setTimeout=="function"?setTimeout:null,Ov=typeof clearTimeout=="function"?clearTimeout:null,Nv=typeof setImmediate<"u"?setImmediate:null;function kc(e){for(var t=Vi(za);t!==null;){if(t.callback===null)Xc(za);else if(t.startTime<=e)Xc(za),t.sortIndex=t.expirationTime,Bd(ha,t);else break;t=Vi(za)}}function Hd(e){if(jo=!1,kc(e),!Qo)if(Vi(ha)!==null)Qo=!0,Er||(Er=!0,Tr());else{var t=Vi(za);t!==null&&Vd(Hd,t.startTime-e)}}var Er=!1,$o=-1,Iv=5,Pv=-1;function Bv(){return Fd?!0:!(Ie.unstable_now()-Pv<Iv)}function Id(){if(Fd=!1,Er){var e=Ie.unstable_now();Pv=e;var t=!0;try{t:{Qo=!1,jo&&(jo=!1,Ov($o),$o=-1),zd=!0;var n=vn;try{e:{for(kc(e),ri=Vi(ha);ri!==null&&!(ri.expirationTime>e&&Bv());){var i=ri.callback;if(typeof i=="function"){ri.callback=null,vn=ri.priorityLevel;var a=i(ri.expirationTime<=e);if(e=Ie.unstable_now(),typeof a=="function"){ri.callback=a,kc(e),t=!0;break e}ri===Vi(ha)&&Xc(ha),kc(e)}else Xc(ha);ri=Vi(ha)}if(ri!==null)t=!0;else{var s=Vi(za);s!==null&&Vd(Hd,s.startTime-e),t=!1}}break t}finally{ri=null,vn=n,zd=!1}t=void 0}}finally{t?Tr():Er=!1}}}var Tr;typeof Nv=="function"?Tr=function(){Nv(Id)}:typeof MessageChannel<"u"?(Pd=new MessageChannel,Uv=Pd.port2,Pd.port1.onmessage=Id,Tr=function(){Uv.postMessage(null)}):Tr=function(){Lv(Id,0)};var Pd,Uv;function Vd(e,t){$o=Lv(function(){e(Ie.unstable_now())},t)}Ie.unstable_IdlePriority=5;Ie.unstable_ImmediatePriority=1;Ie.unstable_LowPriority=4;Ie.unstable_NormalPriority=3;Ie.unstable_Profiling=null;Ie.unstable_UserBlockingPriority=2;Ie.unstable_cancelCallback=function(e){e.callback=null};Ie.unstable_forceFrameRate=function(e){0>e||125<e?console.error("forceFrameRate takes a positive int between 0 and 125, forcing frame rates higher than 125 fps is not supported"):Iv=0<e?Math.floor(1e3/e):5};Ie.unstable_getCurrentPriorityLevel=function(){return vn};Ie.unstable_next=function(e){switch(vn){case 1:case 2:case 3:var t=3;break;default:t=vn}var n=vn;vn=t;try{return e()}finally{vn=n}};Ie.unstable_requestPaint=function(){Fd=!0};Ie.unstable_runWithPriority=function(e,t){switch(e){case 1:case 2:case 3:case 4:case 5:break;default:e=3}var n=vn;vn=e;try{return t()}finally{vn=n}};Ie.unstable_scheduleCallback=function(e,t,n){var i=Ie.unstable_now();switch(typeof n=="object"&&n!==null?(n=n.delay,n=typeof n=="number"&&0<n?i+n:i):n=i,e){case 1:var a=-1;break;case 2:a=250;break;case 5:a=1073741823;break;case 4:a=1e4;break;default:a=5e3}return a=n+a,e={id:gT++,callback:t,priorityLevel:e,startTime:n,expirationTime:a,sortIndex:-1},n>i?(e.sortIndex=n,Bd(za,e),Vi(ha)===null&&e===Vi(za)&&(jo?(Ov($o),$o=-1):jo=!0,Vd(Hd,n-i))):(e.sortIndex=a,Bd(ha,e),Qo||zd||(Qo=!0,Er||(Er=!0,Tr()))),e};Ie.unstable_shouldYield=Bv;Ie.unstable_wrapCallback=function(e){var t=vn;return function(){var n=vn;vn=t;try{return e.apply(this,arguments)}finally{vn=n}}}});var Hv=Hi((JN,Fv)=>{"use strict";Fv.exports=zv()});var kv=Hi(_n=>{"use strict";var vT=Ko();function Gv(e){var t="https://react.dev/errors/"+e;if(1<arguments.length){t+="?args[]="+encodeURIComponent(arguments[1]);for(var n=2;n<arguments.length;n++)t+="&args[]="+encodeURIComponent(arguments[n])}return"Minified React error #"+e+"; visit "+t+" for the full message or use the non-minified dev environment for full errors and additional helpful warnings."}function Fa(){}var Tn={d:{f:Fa,r:function(){throw Error(Gv(522))},D:Fa,C:Fa,L:Fa,m:Fa,X:Fa,S:Fa,M:Fa},p:0,findDOMNode:null},_T=Symbol.for("react.portal"),xT=Symbol.for("react.recoverable"),Vv=Symbol.for("react.optimistic_key");function yT(e,t,n){var i=3<arguments.length&&arguments[3]!==void 0?arguments[3]:null;return{$$typeof:_T,key:i==null?null:i===Vv?Vv:""+i,children:e,containerInfo:t,implementation:n}}var tl=vT.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;function Wc(e,t){if(e==="font")return"";if(typeof t=="string")return t==="use-credentials"?t:""}_n.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE=Tn;_n.browser=function(e){return{$$typeof:xT,_reason:e}};_n.createPortal=function(e,t){var n=2<arguments.length&&arguments[2]!==void 0?arguments[2]:null;if(!t||t.nodeType!==1&&t.nodeType!==9&&t.nodeType!==11)throw Error(Gv(299));return yT(e,t,null,n)};_n.flushSync=function(e){var t=tl.T,n=Tn.p;try{if(tl.T=null,Tn.p=2,e)return e()}finally{tl.T=t,Tn.p=n,Tn.d.f()}};_n.preconnect=function(e,t){typeof e=="string"&&(t?(t=t.crossOrigin,t=typeof t=="string"?t==="use-credentials"?t:"":void 0):t=null,Tn.d.C(e,t))};_n.prefetchDNS=function(e){typeof e=="string"&&Tn.d.D(e)};_n.preinit=function(e,t){if(typeof e=="string"&&t&&typeof t.as=="string"){var n=t.as,i=Wc(n,t.crossOrigin),a=typeof t.integrity=="string"?t.integrity:void 0,s=typeof t.fetchPriority=="string"?t.fetchPriority:void 0;n==="style"?Tn.d.S(e,typeof t.precedence=="string"?t.precedence:void 0,{crossOrigin:i,integrity:a,fetchPriority:s}):n==="script"&&Tn.d.X(e,{crossOrigin:i,integrity:a,fetchPriority:s,nonce:typeof t.nonce=="string"?t.nonce:void 0})}};_n.preinitModule=function(e,t){if(typeof e=="string")if(typeof t=="object"&&t!==null){if(t.as==null||t.as==="script"){var n=Wc(t.as,t.crossOrigin);Tn.d.M(e,{crossOrigin:n,integrity:typeof t.integrity=="string"?t.integrity:void 0,nonce:typeof t.nonce=="string"?t.nonce:void 0,fetchPriority:typeof t.fetchPriority=="string"?t.fetchPriority:void 0})}}else t==null&&Tn.d.M(e)};_n.preload=function(e,t){if(typeof e=="string"&&typeof t=="object"&&t!==null&&typeof t.as=="string"){var n=t.as,i=Wc(n,t.crossOrigin);Tn.d.L(e,n,{crossOrigin:i,integrity:typeof t.integrity=="string"?t.integrity:void 0,nonce:typeof t.nonce=="string"?t.nonce:void 0,type:typeof t.type=="string"?t.type:void 0,fetchPriority:typeof t.fetchPriority=="string"?t.fetchPriority:void 0,referrerPolicy:typeof t.referrerPolicy=="string"?t.referrerPolicy:void 0,imageSrcSet:typeof t.imageSrcSet=="string"?t.imageSrcSet:void 0,imageSizes:typeof t.imageSizes=="string"?t.imageSizes:void 0,media:typeof t.media=="string"?t.media:void 0})}};_n.preloadModule=function(e,t){if(typeof e=="string")if(t){var n=Wc(t.as,t.crossOrigin);Tn.d.m(e,{as:typeof t.as=="string"&&t.as!=="script"?t.as:void 0,crossOrigin:n,integrity:typeof t.integrity=="string"?t.integrity:void 0,nonce:typeof t.nonce=="string"?t.nonce:void 0,fetchPriority:typeof t.fetchPriority=="string"?t.fetchPriority:void 0})}else Tn.d.m(e)};_n.requestFormReset=function(e){Tn.d.r(e)};_n.unstable_batchedUpdates=function(e,t){return e(t)};_n.useFormState=function(e,t,n){return tl.H.useFormState(e,t,n)};_n.useFormStatus=function(){return tl.H.useHostTransitionStatus()};_n.version="19.3.1"});var qv=Hi((QN,Wv)=>{"use strict";function Xv(){if(!(typeof __REACT_DEVTOOLS_GLOBAL_HOOK__>"u"||typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE!="function"))try{__REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(Xv)}catch(e){console.error(e)}}Xv(),Wv.exports=kv()});var U1=Hi(wf=>{"use strict";var je=Hv(),Nx=Ko(),ST=qv();function nt(e){var t="https://react.dev/errors/"+e;if(1<arguments.length){t+="?args[]="+encodeURIComponent(arguments[1]);for(var n=2;n<arguments.length;n++)t+="&args[]="+encodeURIComponent(arguments[n])}return"Minified React error #"+e+"; visit "+t+" for the full message or use the non-minified dev environment for full errors and additional helpful warnings."}function Ux(e){return!(!e||e.nodeType!==1&&e.nodeType!==9&&e.nodeType!==11)}function Vl(e){for(var t=e,n=t;n&&!n.alternate;)t=n,(t.flags&4098)!==0&&(e=t.return),n=t.return;for(;t.return;)t=t.return;return t.tag===3?e:null}function Lx(e){if(e.tag===13){var t=e.memoizedState;if(t===null&&(e=e.alternate,e!==null&&(t=e.memoizedState)),t!==null)return t.dehydrated}return null}function Ox(e){if(e.tag===31){var t=e.memoizedState;if(t===null&&(e=e.alternate,e!==null&&(t=e.memoizedState)),t!==null)return t.dehydrated}return null}function Yv(e){if(Vl(e)!==e)throw Error(nt(188))}function MT(e){var t=e.alternate;if(!t){if(t=Vl(e),t===null)throw Error(nt(188));return t!==e?null:e}for(var n=e,i=t;;){var a=n.return;if(a===null)break;var s=a.alternate;if(s===null){if(i=a.return,i!==null){n=i;continue}break}if(a.child===s.child){for(s=a.child;s;){if(s===n)return Yv(a),e;if(s===i)return Yv(a),t;s=s.sibling}throw Error(nt(188))}if(n.return!==i.return)n=a,i=s;else{for(var r=!1,o=a.child;o;){if(o===n){r=!0,n=a,i=s;break}if(o===i){r=!0,i=a,n=s;break}o=o.sibling}if(!r){for(o=s.child;o;){if(o===n){r=!0,n=s,i=a;break}if(o===i){r=!0,i=s,n=a;break}o=o.sibling}if(!r)throw Error(nt(189))}}if(n.alternate!==i)throw Error(nt(190))}if(n.tag!==3)throw Error(nt(188));return n.stateNode.current===n?e:t}function Ix(e){var t=e.tag;if(t===5||t===26||t===27||t===6)return e;for(e=e.child;e!==null;){if(t=Ix(e),t!==null)return t;e=e.sibling}return null}function Pn(e,t,n,i,a,s){for(;e!==null;){if((e.tag===5||e.tag===27||e.tag===6)&&n(e,i,a,s)||(e.tag!==22||e.memoizedState===null)&&(t||e.tag!==5&&e.tag!==27)&&Pn(e.child,t,n,i,a,s))return!0;e=e.sibling}return!1}function er(e){for(e=e.return;e!==null;){if(e.tag===3||e.tag===5||e.tag===27)return e;e=e.return}return null}function Zv(e){var t=!1;for(e=e.return;e!==null&&(e.tag===4&&(t=!0),!(e.tag===3||e.tag===5||e.tag===27));)e=e.return;return t}function Px(e){var t=[null,null],n=er(e);return n===null||Bx(t,e,n.child,{foundSelf:!1}),t}function Bx(e,t,n,i){for(;n!==null;){if(n===t)i.foundSelf=!0;else if(n.tag===5||n.tag===27||n.tag===6){if(i.foundSelf)return e[1]=n,!0;e[0]=n}else if((n.tag!==22||n.memoizedState===null)&&Bx(e,t,n.child,i))return!0;n=n.sibling}return!1}function Qe(e){switch(e.tag){case 5:case 27:case 6:return e.stateNode;case 3:return e.stateNode.containerInfo;default:throw Error(nt(559))}}var Ur=null,xp=null;function bT(e,t,n){return e===n?!0:e===t?(Ur=e,!0):!1}function TT(e,t,n){return e===n?(xp=e,!1):e===t?(xp!==null&&(Ur=e),!0):!1}function Jv(e){if(e===null)return null;do e=e===null?null:e.return;while(e&&e.tag!==5&&e.tag!==27&&e.tag!==3);return e||null}function yp(e,t,n){for(var i=0,a=e;a;a=n(a))i++;a=0;for(var s=t;s;s=n(s))a++;for(;0<i-a;)e=n(e),i--;for(;0<a-i;)t=n(t),a--;for(;i--;){if(e===t||t!==null&&e===t.alternate)return e;e=n(e),t=n(t)}return null}var Ae=Object.assign,ET=Symbol.for("react.element"),qc=Symbol.for("react.transitional.element"),ol=Symbol.for("react.portal"),Lr=Symbol.for("react.fragment"),zx=Symbol.for("react.strict_mode"),Sp=Symbol.for("react.profiler"),Fx=Symbol.for("react.consumer"),Yi=Symbol.for("react.context"),Dm=Symbol.for("react.forward_ref"),Mp=Symbol.for("react.suspense"),bp=Symbol.for("react.suspense_list"),Nm=Symbol.for("react.memo"),ka=Symbol.for("react.lazy"),Tp=Symbol.for("react.activity"),AT=Symbol.for("react.legacy_hidden"),wT=Symbol.for("react.memo_cache_sentinel"),Ep=Symbol.for("react.view_transition"),CT=Symbol.for("react.recoverable"),Kv=Symbol.iterator;function el(e){return e===null||typeof e!="object"?null:(e=Kv&&e[Kv]||e["@@iterator"],typeof e=="function"?e:null)}var RT=Symbol.for("react.client.reference");function Ap(e){if(e==null)return null;if(typeof e=="function")return e.$$typeof===RT?null:e.displayName||e.name||null;if(typeof e=="string")return e;switch(e){case Lr:return"Fragment";case Sp:return"Profiler";case zx:return"StrictMode";case Mp:return"Suspense";case bp:return"SuspenseList";case Tp:return"Activity";case Ep:return"ViewTransition"}if(typeof e=="object")switch(e.$$typeof){case ol:return"Portal";case Yi:return e.displayName||"Context";case Fx:return(e._context.displayName||"Context")+".Consumer";case Dm:var t=e.render;return e=e.displayName,e||(e=t.displayName||t.name||"",e=e!==""?"ForwardRef("+e+")":"ForwardRef"),e;case Nm:return t=e.displayName||null,t!==null?t:Ap(e.type)||"Memo";case ka:t=e._payload,e=e._init;try{return Ap(e(t))}catch{}}return null}var ll=Array.isArray,Ht=Nx.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE,he=ST.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE,Gs={pending:!1,data:null,method:null,action:null},wp=[],Or=-1;function ta(e){return{current:e}}function fn(e){0>Or||(e.current=wp[Or],wp[Or]=null,Or--)}function Ue(e,t){Or++,wp[Or]=e.current,e.current=t}var Qi=ta(null),El=ta(null),ja=ta(null),Uu=ta(null);function Lu(e,t){switch(Ue(ja,t),Ue(El,e),Ue(Qi,null),t.nodeType){case 9:case 11:e=(e=t.documentElement)&&(e=e.namespaceURI)?ux(e):0;break;default:if(e=t.tagName,t=t.namespaceURI)t=ux(t),e=o1(t,e);else switch(e){case"svg":e=1;break;case"math":e=2;break;default:e=0}}fn(Qi),Ue(Qi,e)}function to(){fn(Qi),fn(El),fn(ja)}function Cp(e){var t=e.memoizedState;t!==null&&(uo._currentValue=t.memoizedState,Ue(Uu,e)),t=Qi.current;var n=o1(t,e.type);t!==n&&(Ue(El,e),Ue(Qi,n))}function Ou(e){El.current===e&&(fn(Qi),fn(El)),Uu.current===e&&(fn(Uu),uo._currentValue=Gs)}var Gd,Qv;function Va(e){if(Gd===void 0)try{throw Error()}catch(n){var t=n.stack.trim().match(/\n( *(at )?)/);Gd=t&&t[1]||"",Qv=-1<n.stack.indexOf(`
    at`)?" (<anonymous>)":-1<n.stack.indexOf("@")?"@unknown:0:0":""}return`
`+Gd+e+Qv}var kd=!1;function Xd(e,t){if(!e||kd)return"";kd=!0;var n=Error.prepareStackTrace;Error.prepareStackTrace=void 0;try{var i={DetermineComponentFrameRoot:function(){try{if(t){var p=function(){throw Error()};if(Object.defineProperty(p.prototype,"props",{set:function(){throw Error()}}),typeof Reflect=="object"&&Reflect.construct){try{Reflect.construct(p,[])}catch(_){var u=_}Reflect.construct(e,[],p)}else{try{p.call()}catch(_){u=_}p=!1;try{var d=Object.getOwnPropertyDescriptor(e.prototype,"props");Object.defineProperty(e.prototype,"props",{configurable:!0,set:function(){throw Error()}}),p=!0,new e}finally{p&&(d!==void 0?Object.defineProperty(e.prototype,"props",d):delete e.prototype.props)}}}else{try{throw Error()}catch(_){u=_}(p=e())&&typeof p.catch=="function"&&p.catch(function(){})}}catch(_){if(_&&u&&typeof _.stack=="string")return[_.stack,u.stack]}return[null,null]}};i.DetermineComponentFrameRoot.displayName="DetermineComponentFrameRoot";var a=Object.getOwnPropertyDescriptor(i.DetermineComponentFrameRoot,"name");a&&a.configurable&&Object.defineProperty(i.DetermineComponentFrameRoot,"name",{value:"DetermineComponentFrameRoot"});var s=i.DetermineComponentFrameRoot(),r=s[0],o=s[1];if(r&&o){var l=r.split(`
`),c=o.split(`
`);for(a=i=0;i<l.length&&!l[i].includes("DetermineComponentFrameRoot");)i++;for(;a<c.length&&!c[a].includes("DetermineComponentFrameRoot");)a++;if(i===l.length||a===c.length)for(i=l.length-1,a=c.length-1;1<=i&&0<=a&&l[i]!==c[a];)a--;for(;1<=i&&0<=a;i--,a--)if(l[i]!==c[a]){if(i!==1||a!==1)do if(i--,a--,0>a||l[i]!==c[a]){var f=`
`+l[i].replace(" at new "," at ");return e.displayName&&f.includes("<anonymous>")&&(f=f.replace("<anonymous>",e.displayName)),f}while(1<=i&&0<=a);break}}}finally{kd=!1,Error.prepareStackTrace=n}return(n=e?e.displayName||e.name:"")?Va(n):""}function DT(e,t){switch(e.tag){case 26:case 27:case 5:return Va(e.type);case 16:return Va("Lazy");case 13:return e.child!==t&&t!==null?Va("Suspense Fallback"):Va("Suspense");case 19:return Va("SuspenseList");case 0:case 15:return Xd(e.type,!1);case 11:return Xd(e.type.render,!1);case 1:return Xd(e.type,!0);case 31:return Va("Activity");case 30:return Va("ViewTransition");default:return""}}function jv(e){try{var t="",n=null;do t+=DT(e,n),n=e,e=e.return;while(e);return t}catch(i){return`
Error generating stack: `+i.message+`
`+i.stack}}var Rp=Object.prototype.hasOwnProperty,Um=je.unstable_scheduleCallback,Wd=je.unstable_cancelCallback,NT=je.unstable_shouldYield,UT=je.unstable_requestPaint,Zn=je.unstable_now,LT=je.unstable_getCurrentPriorityLevel,Hx=je.unstable_ImmediatePriority,Vx=je.unstable_UserBlockingPriority,Iu=je.unstable_NormalPriority,OT=je.unstable_LowPriority,Gx=je.unstable_IdlePriority,IT=je.log,PT=je.unstable_setDisableYieldValue,Gl=null,Jn=null;function qa(e){if(typeof IT=="function"&&PT(e),Jn&&typeof Jn.setStrictMode=="function")try{Jn.setStrictMode(Gl,e)}catch{}}var Kn=Math.clz32?Math.clz32:FT,BT=Math.log,zT=Math.LN2;function FT(e){return e>>>=0,e===0?32:31-(BT(e)/zT|0)|0}var Yc=256,Zc=262144,Jc=4194304;function Bs(e){var t=e&42;if(t!==0)return t;switch(e&-e){case 1:return 1;case 2:return 2;case 4:return 4;case 8:return 8;case 16:return 16;case 32:return 32;case 64:return 64;case 128:return 128;case 256:case 512:case 1024:case 2048:case 4096:case 8192:case 16384:case 32768:case 65536:case 131072:return e&-e;case 262144:case 524288:case 1048576:case 2097152:return e&3932160;case 4194304:case 8388608:case 16777216:case 33554432:return e&62914560;case 67108864:return 67108864;case 134217728:return 134217728;case 268435456:return 268435456;case 536870912:return 536870912;case 1073741824:return 0;default:return e}}function lf(e,t,n){var i=e.pendingLanes;if(i===0)return 0;var a=0,s=e.suspendedLanes,r=e.pingedLanes;e=e.warmLanes;var o=i&134217727;return o!==0?(i=o&~s,i!==0?a=Bs(i):(r&=o,r!==0?a=Bs(r):n||(n=o&~e,n!==0&&(a=Bs(n))))):(o=i&~s,o!==0?a=Bs(o):r!==0?a=Bs(r):n||(n=i&~e,n!==0&&(a=Bs(n)))),a===0?0:t!==0&&t!==a&&(t&s)===0&&(s=a&-a,n=t&-t,s>=n||s===32&&(n&4194048)!==0)?t:a}function kl(e,t){return(e.pendingLanes&~(e.suspendedLanes&~e.pingedLanes)&t)===0}function kx(e,t){(t&8)!==0&&(t|=t&32);var n=e.entangledLanes;if(n!==0)for(e=e.entanglements,n&=t;0<n;){var i=31-Kn(n),a=1<<i;t|=e[i],n&=~a}return t}function HT(e,t){switch(e){case 1:case 2:case 4:case 8:case 64:return t+250;case 16:case 32:case 128:case 256:case 512:case 1024:case 2048:case 4096:case 8192:case 16384:case 32768:case 65536:case 131072:case 262144:case 524288:case 1048576:case 2097152:return t+5e3;case 4194304:case 8388608:case 16777216:case 33554432:return-1;case 67108864:case 134217728:case 268435456:case 536870912:case 1073741824:return-1;default:return-1}}function Xx(){var e=Jc;return Jc<<=1,(Jc&62914560)===0&&(Jc=4194304),e}function qd(e){for(var t=[],n=0;31>n;n++)t.push(e);return t}function Xl(e,t){e.pendingLanes|=t,t!==268435456&&(e.suspendedLanes=0,e.pingedLanes=0,e.warmLanes=0)}function VT(e,t,n,i,a,s){var r=e.pendingLanes;e.pendingLanes=n,e.suspendedLanes=0,e.pingedLanes=0,e.warmLanes=0,e.expiredLanes&=n,e.entangledLanes&=n,e.errorRecoveryDisabledLanes&=n,e.shellSuspendCounter=0;var o=e.entanglements,l=e.expirationTimes,c=e.hiddenUpdates;for(n=r&~n;0<n;){var f=31-Kn(n),p=1<<f;o[f]=0,l[f]=-1;var u=c[f];if(u!==null)for(c[f]=null,f=0;f<u.length;f++){var d=u[f];d!==null&&(d.lane&=-536870913)}n&=~p}i!==0&&Wx(e,i,0),s!==0&&a===0&&e.tag!==0&&(e.suspendedLanes|=s&~(r&~t))}function Wx(e,t,n){e.pendingLanes|=t,e.suspendedLanes&=~t;var i=31-Kn(t);e.entangledLanes|=t,e.entanglements[i]=e.entanglements[i]|1073741824|n&261930}function qx(e,t){var n=e.entangledLanes|=t;for(e=e.entanglements;n;){var i=31-Kn(n),a=1<<i;a&t|e[i]&t&&(e[i]|=t),n&=~a}}function Yx(e,t){var n=t&-t;return n=(n&42)!==0?1:Lm(n),(n&(e.suspendedLanes|t))!==0?0:n}function Lm(e){switch(e){case 2:e=1;break;case 8:e=4;break;case 32:e=16;break;case 256:case 512:case 1024:case 2048:case 4096:case 8192:case 16384:case 32768:case 65536:case 131072:case 262144:case 524288:case 1048576:case 2097152:case 4194304:case 8388608:case 16777216:case 33554432:e=128;break;case 268435456:e=134217728;break;default:e=0}return e}function Om(e){return e&=-e,2<e?8<e?(e&134217727)!==0?32:268435456:8:2}function Zx(){var e=he.p;return e!==0?e:(e=window.event,e===void 0?32:R1(e.type))}function $v(e,t){var n=he.p;try{return he.p=e,t()}finally{he.p=n}}var Ea=Math.random().toString(36).slice(2),cn="__reactFiber$"+Ea,Bn="__reactProps$"+Ea,po="__reactContainer$"+Ea,t_="__reactEvents$"+Ea,GT="__reactListeners$"+Ea,kT="__reactHandles$"+Ea,e_="__reactResources$"+Ea,Wl="__reactMarker$"+Ea,Pu="__reactLoad$"+Ea;function cf(e){delete e[cn],delete e[Bn],delete e[GT],delete e[kT]}function Hs(e){var t;if(t=e[cn])return t;for(var n=e.parentNode;n;){if(t=n[po]||n[cn]){if(n=t.alternate,t.child!==null||n!==null&&n.child!==null)for(e=_x(e);e!==null;){if(n=e[cn])return n;e=_x(e)}return t}e=n,n=e.parentNode}return null}function mo(e){if(e=e[cn]||e[po]){var t=e.tag;if(t===5||t===6||t===13||t===31||t===26||t===27||t===3)return e}return null}function cl(e){var t=e.tag;if(t===5||t===26||t===27||t===6)return e.stateNode;throw Error(nt(33))}function Xr(e){var t=e[e_];return t||(t=e[e_]={hoistableStyles:new Map,hoistableScripts:new Map}),t}function an(e){e[Wl]=!0}function Jx(e){e[Pu]=void 0}var Kx=new Set,Qx={};function nr(e,t){eo(e,t),eo(e+"Capture",t)}function eo(e,t){for(Qx[e]=t,e=0;e<t.length;e++)Kx.add(t[e])}var XT=RegExp("^[:A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD][:A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\-.0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040]*$"),n_={},i_={};function WT(e){return Rp.call(i_,e)?!0:Rp.call(n_,e)?!1:XT.test(e)?i_[e]=!0:(n_[e]=!0,!1)}var ue=!1;function a_(){var e=ue;return ue=!1,e}function du(e,t,n){if(WT(t))if(n===null)e.removeAttribute(t);else{switch(typeof n){case"undefined":case"function":case"symbol":e.removeAttribute(t);return;case"boolean":var i=t.toLowerCase().slice(0,5);if(i!=="data-"&&i!=="aria-"){e.removeAttribute(t);return}}e.setAttribute(t,n)}}function Kc(e,t,n){if(n===null)e.removeAttribute(t);else{switch(typeof n){case"undefined":case"function":case"symbol":case"boolean":e.removeAttribute(t);return}e.setAttribute(t,n)}}function da(e,t,n,i){if(i===null)e.removeAttribute(n);else{switch(typeof i){case"undefined":case"function":case"symbol":case"boolean":e.removeAttribute(n);return}e.setAttributeNS(t,n,i)}}function Xn(e){switch(typeof e){case"bigint":case"boolean":case"number":case"string":case"undefined":return e;case"object":return e;default:return""}}function jx(e){var t=e.type;return(e=e.nodeName)&&e.toLowerCase()==="input"&&(t==="checkbox"||t==="radio")}function qT(e,t,n){var i=Object.getOwnPropertyDescriptor(e.constructor.prototype,t);if(!e.hasOwnProperty(t)&&typeof i<"u"&&typeof i.get=="function"&&typeof i.set=="function"){var a=i.get,s=i.set;return Object.defineProperty(e,t,{configurable:!0,get:function(){return a.call(this)},set:function(r){n=""+r,s.call(this,r)}}),Object.defineProperty(e,t,{enumerable:i.enumerable}),{getValue:function(){return n},setValue:function(r){n=""+r},stopTracking:function(){e._valueTracker=null,delete e[t]}}}}function Dp(e){if(!e._valueTracker){var t=jx(e)?"checked":"value";e._valueTracker=qT(e,t,""+e[t])}}function $x(e){if(!e)return!1;var t=e._valueTracker;if(!t)return!0;var n=t.getValue(),i="";return e&&(i=jx(e)?e.checked?"true":"false":e.value),e=i,e!==n?(t.setValue(e),!0):!1}var YT=/[\n"\\]/g;function fi(e){return e.replace(YT,function(t){return"\\"+t.charCodeAt(0).toString(16)+" "})}function Np(e,t,n,i,a,s,r,o){e.name="",r!=null&&typeof r!="function"&&typeof r!="symbol"&&typeof r!="boolean"?e.type=r:e.removeAttribute("type"),t!=null?r==="number"?(t===0&&e.value===""||e.value!=t)&&(e.value=""+Xn(t)):e.value!==""+Xn(t)&&(e.value=""+Xn(t)):r!=="submit"&&r!=="reset"||e.removeAttribute("value"),t!=null?r==="number"&&e.value==t?Yd(e,Xn(e.value)):Yd(e,Xn(t)):n!=null?Yd(e,Xn(n)):i!=null&&e.removeAttribute("value"),a==null&&s!=null&&(e.defaultChecked=!!s),a!=null&&(e.checked=a&&typeof a!="function"&&typeof a!="symbol"),o!=null&&typeof o!="function"&&typeof o!="symbol"&&typeof o!="boolean"?e.name=""+Xn(o):e.removeAttribute("name")}function ty(e,t,n,i,a,s,r,o){if(s!=null&&typeof s!="function"&&typeof s!="symbol"&&typeof s!="boolean"&&(e.type=s),t!=null||n!=null){if(!(s!=="submit"&&s!=="reset"||t!=null)){Dp(e);return}n=n!=null?""+Xn(n):"",t=t!=null?""+Xn(t):n,o||t===e.value||(e.value=t),e.defaultValue=t}i=i??a,i=typeof i!="function"&&typeof i!="symbol"&&!!i,e.checked=o?e.checked:!!i,e.defaultChecked=!!i,r!=null&&typeof r!="function"&&typeof r!="symbol"&&typeof r!="boolean"&&(e.name=r),Dp(e)}function Yd(e,t){e.defaultValue!==""+t&&(e.defaultValue=""+t)}function Wr(e,t,n,i){if(e=e.options,t){t={};for(var a=0;a<n.length;a++)t["$"+n[a]]=!0;for(n=0;n<e.length;n++)a=t.hasOwnProperty("$"+e[n].value),e[n].selected!==a&&(e[n].selected=a),a&&i&&(e[n].defaultSelected=!0)}else{for(n=""+Xn(n),t=null,a=0;a<e.length;a++){if(e[a].value===n){e[a].selected=!0,i&&(e[a].defaultSelected=!0);return}t!==null||e[a].disabled||(t=e[a])}t!==null&&(t.selected=!0)}}function ey(e,t,n){if(t!=null&&(t=""+Xn(t),t!==e.value&&(e.value=t),n==null)){e.defaultValue!==t&&(e.defaultValue=t);return}e.defaultValue=n!=null?""+Xn(n):""}function ny(e,t,n,i){if(t==null){if(i!=null){if(n!=null)throw Error(nt(92));if(ll(i)){if(1<i.length)throw Error(nt(93));i=i[0]}n=i}n==null&&(n=""),t=n}n=Xn(t),e.defaultValue=n,i=e.textContent,i===n&&i!==""&&i!==null&&(e.value=i),Dp(e)}function no(e,t){if(t){var n=e.firstChild;if(n&&n===e.lastChild&&n.nodeType===3){n.nodeValue=t;return}}e.textContent=t}var ZT=new Set("animationIterationCount aspectRatio borderImageOutset borderImageSlice borderImageWidth boxFlex boxFlexGroup boxOrdinalGroup columnCount columns flex flexGrow flexPositive flexShrink flexNegative flexOrder gridArea gridRow gridRowEnd gridRowSpan gridRowStart gridColumn gridColumnEnd gridColumnSpan gridColumnStart fontWeight lineClamp lineHeight opacity order orphans scale tabSize widows zIndex zoom fillOpacity floodOpacity stopOpacity strokeDasharray strokeDashoffset strokeMiterlimit strokeOpacity strokeWidth MozAnimationIterationCount MozBoxFlex MozBoxFlexGroup MozLineClamp msAnimationIterationCount msFlex msZoom msFlexGrow msFlexNegative msFlexOrder msFlexPositive msFlexShrink msGridColumn msGridColumnSpan msGridRow msGridRowSpan WebkitAnimationIterationCount WebkitBoxFlex WebKitBoxFlexGroup WebkitBoxOrdinalGroup WebkitColumnCount WebkitColumns WebkitFlex WebkitFlexGrow WebkitFlexPositive WebkitFlexShrink WebkitLineClamp".split(" "));function s_(e,t,n){var i=t.indexOf("--")===0;n==null||typeof n=="boolean"||n===""?i?e.setProperty(t,""):t==="float"?e.cssFloat="":e[t]="":i?e.setProperty(t,n):typeof n!="number"||n===0||ZT.has(t)?t==="float"?e.cssFloat=n:e[t]=(""+n).trim():e[t]=n+"px"}function iy(e,t,n){if(t!=null&&typeof t!="object")throw Error(nt(62));if(e=e.style,n!=null){for(var i in n)!n.hasOwnProperty(i)||t!=null&&t.hasOwnProperty(i)||(i.indexOf("--")===0?e.setProperty(i,""):i==="float"?e.cssFloat="":e[i]="",ue=!0);for(var a in t)i=t[a],t.hasOwnProperty(a)&&n[a]!==i&&(s_(e,a,i),ue=!0)}else for(var s in t)t.hasOwnProperty(s)&&s_(e,s,t[s])}function Im(e){if(e.indexOf("-")===-1)return!1;switch(e){case"annotation-xml":case"color-profile":case"font-face":case"font-face-src":case"font-face-uri":case"font-face-format":case"font-face-name":case"missing-glyph":return!1;default:return!0}}var JT=new Map([["acceptCharset","accept-charset"],["htmlFor","for"],["httpEquiv","http-equiv"],["crossOrigin","crossorigin"],["accentHeight","accent-height"],["alignmentBaseline","alignment-baseline"],["arabicForm","arabic-form"],["baselineShift","baseline-shift"],["capHeight","cap-height"],["clipPath","clip-path"],["clipRule","clip-rule"],["colorInterpolation","color-interpolation"],["colorInterpolationFilters","color-interpolation-filters"],["colorProfile","color-profile"],["colorRendering","color-rendering"],["dominantBaseline","dominant-baseline"],["enableBackground","enable-background"],["fillOpacity","fill-opacity"],["fillRule","fill-rule"],["floodColor","flood-color"],["floodOpacity","flood-opacity"],["fontFamily","font-family"],["fontSize","font-size"],["fontSizeAdjust","font-size-adjust"],["fontStretch","font-stretch"],["fontStyle","font-style"],["fontVariant","font-variant"],["fontWeight","font-weight"],["glyphName","glyph-name"],["glyphOrientationHorizontal","glyph-orientation-horizontal"],["glyphOrientationVertical","glyph-orientation-vertical"],["horizAdvX","horiz-adv-x"],["horizOriginX","horiz-origin-x"],["imageRendering","image-rendering"],["letterSpacing","letter-spacing"],["lightingColor","lighting-color"],["markerEnd","marker-end"],["markerMid","marker-mid"],["markerStart","marker-start"],["maskType","mask-type"],["overlinePosition","overline-position"],["overlineThickness","overline-thickness"],["paintOrder","paint-order"],["panose-1","panose-1"],["pointerEvents","pointer-events"],["renderingIntent","rendering-intent"],["shapeRendering","shape-rendering"],["stopColor","stop-color"],["stopOpacity","stop-opacity"],["strikethroughPosition","strikethrough-position"],["strikethroughThickness","strikethrough-thickness"],["strokeDasharray","stroke-dasharray"],["strokeDashoffset","stroke-dashoffset"],["strokeLinecap","stroke-linecap"],["strokeLinejoin","stroke-linejoin"],["strokeMiterlimit","stroke-miterlimit"],["strokeOpacity","stroke-opacity"],["strokeWidth","stroke-width"],["textAnchor","text-anchor"],["textDecoration","text-decoration"],["textRendering","text-rendering"],["transformOrigin","transform-origin"],["underlinePosition","underline-position"],["underlineThickness","underline-thickness"],["unicodeBidi","unicode-bidi"],["unicodeRange","unicode-range"],["unitsPerEm","units-per-em"],["vAlphabetic","v-alphabetic"],["vHanging","v-hanging"],["vIdeographic","v-ideographic"],["vMathematical","v-mathematical"],["vectorEffect","vector-effect"],["vertAdvY","vert-adv-y"],["vertOriginX","vert-origin-x"],["vertOriginY","vert-origin-y"],["wordSpacing","word-spacing"],["writingMode","writing-mode"],["xmlnsXlink","xmlns:xlink"],["xHeight","x-height"]]),KT=/^[\u0000-\u001F ]*j[\r\n\t]*a[\r\n\t]*v[\r\n\t]*a[\r\n\t]*s[\r\n\t]*c[\r\n\t]*r[\r\n\t]*i[\r\n\t]*p[\r\n\t]*t[\r\n\t]*:/i;function pu(e){return KT.test(""+e)?"javascript:throw new Error('React has blocked a javascript: URL as a security precaution.')":e}function Zi(){}var Up=null;function Pm(e){return e=e.target||e.srcElement||window,e.correspondingUseElement&&(e=e.correspondingUseElement),e.nodeType===3?e.parentNode:e}var Ir=null,qr=null;function r_(e){var t=mo(e);if(t&&(e=t.stateNode)){var n=e[Bn]||null;t:switch(e=t.stateNode,t.type){case"input":if(Np(e,n.value,n.defaultValue,n.defaultValue,n.checked,n.defaultChecked,n.type,n.name),t=n.name,n.type==="radio"&&t!=null){for(n=e;n.parentNode;)n=n.parentNode;for(n=n.querySelectorAll('input[name="'+fi(""+t)+'"][type="radio"]'),t=0;t<n.length;t++){var i=n[t];if(i!==e&&i.form===e.form){var a=i[Bn]||null;if(!a)throw Error(nt(90));Np(i,a.value,a.defaultValue,a.defaultValue,a.checked,a.defaultChecked,a.type,a.name)}}for(t=0;t<n.length;t++)i=n[t],i.form===e.form&&$x(i)}break t;case"textarea":ey(e,n.value,n.defaultValue);break t;case"select":t=n.value,t!=null&&Wr(e,!!n.multiple,t,!1)}}}var Zd=!1;function ay(e,t,n){if(Zd)return e(t,n);Zd=!0;try{var i=e(t);return i}finally{if(Zd=!1,(Ir!==null||qr!==null)&&(bf(),Ir&&(t=Ir,e=qr,qr=Ir=null,r_(t),e)))for(t=0;t<e.length;t++)r_(e[t])}}function Al(e,t){var n=e.stateNode;if(n===null)return null;var i=n[Bn]||null;if(i===null)return null;n=i[t];t:switch(t){case"onClick":case"onClickCapture":case"onDoubleClick":case"onDoubleClickCapture":case"onMouseDown":case"onMouseDownCapture":case"onMouseMove":case"onMouseMoveCapture":case"onMouseUp":case"onMouseUpCapture":case"onMouseEnter":(i=!i.disabled)||(e=e.type,i=!(e==="button"||e==="input"||e==="select"||e==="textarea")),e=!i;break t;default:e=!1}if(e)return null;if(n&&typeof n!="function")throw Error(nt(231,t,typeof n));return n}var xa=!(typeof window>"u"||typeof window.document>"u"||typeof window.document.createElement>"u"),Lp=!1;if(xa)try{Ar={},Object.defineProperty(Ar,"passive",{get:function(){Lp=!0}}),window.addEventListener("test",Ar,Ar),window.removeEventListener("test",Ar,Ar)}catch{Lp=!1}var Ar,Ya=null,Bm=null,mu=null;function sy(){if(mu)return mu;var e,t=Bm,n=t.length,i,a="value"in Ya?Ya.value:Ya.textContent,s=a.length;for(e=0;e<n&&t[e]===a[e];e++);var r=n-e;for(i=1;i<=r&&t[n-i]===a[s-i];i++);return mu=a.slice(e,1<i?1-i:void 0)}function gu(e){var t=e.keyCode;return"charCode"in e?(e=e.charCode,e===0&&t===13&&(e=13)):e=t,e===10&&(e=13),32<=e||e===13?e:0}function Qc(){return!0}function o_(){return!1}function Cn(e){function t(n,i,a,s,r){this._reactName=n,this._targetInst=a,this.type=i,this.nativeEvent=s,this.target=r,this.currentTarget=null;for(var o in e)e.hasOwnProperty(o)&&(n=e[o],this[o]=n?n(s):s[o]);return this.isDefaultPrevented=(s.defaultPrevented!=null?s.defaultPrevented:s.returnValue===!1)?Qc:o_,this.isPropagationStopped=o_,this}return Ae(t.prototype,{preventDefault:function(){this.defaultPrevented=!0;var n=this.nativeEvent;n&&(n.preventDefault?n.preventDefault():typeof n.returnValue!="unknown"&&(n.returnValue=!1),this.isDefaultPrevented=Qc)},stopPropagation:function(){var n=this.nativeEvent;n&&(n.stopPropagation?n.stopPropagation():typeof n.cancelBubble!="unknown"&&(n.cancelBubble=!0),this.isPropagationStopped=Qc)},persist:function(){},isPersistent:Qc}),t}var ds={eventPhase:0,bubbles:0,cancelable:0,timeStamp:function(e){return e.timeStamp||Date.now()},defaultPrevented:0,isTrusted:0},uf=Cn(ds),ql=Ae({},ds,{view:0,detail:0}),QT=Cn(ql),Jd,Kd,nl,ff=Ae({},ql,{screenX:0,screenY:0,clientX:0,clientY:0,pageX:0,pageY:0,ctrlKey:0,shiftKey:0,altKey:0,metaKey:0,getModifierState:zm,button:0,buttons:0,relatedTarget:function(e){return e.relatedTarget===void 0?e.fromElement===e.srcElement?e.toElement:e.fromElement:e.relatedTarget},movementX:function(e){return"movementX"in e?e.movementX:(e!==nl&&(nl&&e.type==="mousemove"?(Jd=e.screenX-nl.screenX,Kd=e.screenY-nl.screenY):Kd=Jd=0,nl=e),Jd)},movementY:function(e){return"movementY"in e?e.movementY:Kd}}),l_=Cn(ff),jT=Ae({},ff,{dataTransfer:0}),$T=Cn(jT),tE=Ae({},ql,{relatedTarget:0}),Qd=Cn(tE),eE=Ae({},ds,{animationName:0,elapsedTime:0,pseudoElement:0}),nE=Cn(eE),iE=Ae({},ds,{clipboardData:function(e){return"clipboardData"in e?e.clipboardData:window.clipboardData}}),aE=Cn(iE),sE=Ae({},ds,{data:0}),c_=Cn(sE),rE={Esc:"Escape",Spacebar:" ",Left:"ArrowLeft",Up:"ArrowUp",Right:"ArrowRight",Down:"ArrowDown",Del:"Delete",Win:"OS",Menu:"ContextMenu",Apps:"ContextMenu",Scroll:"ScrollLock",MozPrintableKey:"Unidentified"},oE={8:"Backspace",9:"Tab",12:"Clear",13:"Enter",16:"Shift",17:"Control",18:"Alt",19:"Pause",20:"CapsLock",27:"Escape",32:" ",33:"PageUp",34:"PageDown",35:"End",36:"Home",37:"ArrowLeft",38:"ArrowUp",39:"ArrowRight",40:"ArrowDown",45:"Insert",46:"Delete",112:"F1",113:"F2",114:"F3",115:"F4",116:"F5",117:"F6",118:"F7",119:"F8",120:"F9",121:"F10",122:"F11",123:"F12",144:"NumLock",145:"ScrollLock",224:"Meta"},lE={Alt:"altKey",Control:"ctrlKey",Meta:"metaKey",Shift:"shiftKey"};function cE(e){var t=this.nativeEvent;return t.getModifierState?t.getModifierState(e):(e=lE[e])?!!t[e]:!1}function zm(){return cE}var uE=Ae({},ql,{key:function(e){if(e.key){var t=rE[e.key]||e.key;if(t!=="Unidentified")return t}return e.type==="keypress"?(e=gu(e),e===13?"Enter":String.fromCharCode(e)):e.type==="keydown"||e.type==="keyup"?oE[e.keyCode]||"Unidentified":""},code:0,location:0,ctrlKey:0,shiftKey:0,altKey:0,metaKey:0,repeat:0,locale:0,getModifierState:zm,charCode:function(e){return e.type==="keypress"?gu(e):0},keyCode:function(e){return e.type==="keydown"||e.type==="keyup"?e.keyCode:0},which:function(e){return e.type==="keypress"?gu(e):e.type==="keydown"||e.type==="keyup"?e.keyCode:0}}),fE=Cn(uE),hE=Ae({},ff,{pointerId:0,width:0,height:0,pressure:0,tangentialPressure:0,tiltX:0,tiltY:0,twist:0,pointerType:0,isPrimary:0}),u_=Cn(hE),dE=Ae({},ds,{submitter:0}),pE=Cn(dE),mE=Ae({},ql,{touches:0,targetTouches:0,changedTouches:0,altKey:0,metaKey:0,ctrlKey:0,shiftKey:0,getModifierState:zm}),gE=Cn(mE),vE=Ae({},ds,{propertyName:0,elapsedTime:0,pseudoElement:0}),_E=Cn(vE),xE=Ae({},ff,{deltaX:function(e){return"deltaX"in e?e.deltaX:"wheelDeltaX"in e?-e.wheelDeltaX:0},deltaY:function(e){return"deltaY"in e?e.deltaY:"wheelDeltaY"in e?-e.wheelDeltaY:"wheelDelta"in e?-e.wheelDelta:0},deltaZ:0,deltaMode:0}),yE=Cn(xE),SE=Ae({},ds,{newState:0,oldState:0,source:0}),ME=Cn(SE),bE=[9,13,27,32],Fm=xa&&"CompositionEvent"in window,hl=null;xa&&"documentMode"in document&&(hl=document.documentMode);var TE=xa&&"TextEvent"in window&&!hl,ry=xa&&(!Fm||hl&&8<hl&&11>=hl),f_=" ",h_=!1;function oy(e,t){switch(e){case"keyup":return bE.indexOf(t.keyCode)!==-1;case"keydown":return t.keyCode!==229;case"keypress":case"mousedown":case"focusout":return!0;default:return!1}}function ly(e){return e=e.detail,typeof e=="object"&&"data"in e?e.data:null}var Pr=!1;function EE(e,t){switch(e){case"compositionend":return ly(t);case"keypress":return t.which!==32?null:(h_=!0,f_);case"textInput":return e=t.data,e===f_&&h_?null:e;default:return null}}function AE(e,t){if(Pr)return e==="compositionend"||!Fm&&oy(e,t)?(e=sy(),mu=Bm=Ya=null,Pr=!1,e):null;switch(e){case"paste":return null;case"keypress":if(!(t.ctrlKey||t.altKey||t.metaKey)||t.ctrlKey&&t.altKey){if(t.char&&1<t.char.length)return t.char;if(t.which)return String.fromCharCode(t.which)}return null;case"compositionend":return ry&&t.locale!=="ko"?null:t.data;default:return null}}var wE={color:!0,date:!0,datetime:!0,"datetime-local":!0,email:!0,month:!0,number:!0,password:!0,range:!0,search:!0,tel:!0,text:!0,time:!0,url:!0,week:!0};function d_(e){var t=e&&e.nodeName&&e.nodeName.toLowerCase();return t==="input"?!!wE[e.type]:t==="textarea"}function cy(e,t,n,i){Ir?qr?qr.push(i):qr=[i]:Ir=i,t=sf(t,"onChange"),0<t.length&&(n=new uf("onChange","change",null,n,i),e.push({event:n,listeners:t}))}var dl=null,wl=null;function CE(e){a1(e,0)}function hf(e){var t=cl(e);if($x(t))return e}function p_(e,t){if(e==="change")return t}var uy=!1;xa&&(xa?($c="oninput"in document,$c||(jd=document.createElement("div"),jd.setAttribute("oninput","return;"),$c=typeof jd.oninput=="function"),jc=$c):jc=!1,uy=jc&&(!document.documentMode||9<document.documentMode));var jc,$c,jd;function m_(){dl&&(dl.detachEvent("onpropertychange",fy),wl=dl=null)}function fy(e){if(e.propertyName==="value"&&hf(wl)){var t=[];cy(t,wl,e,Pm(e)),ay(CE,t)}}function RE(e,t,n){e==="focusin"?(m_(),dl=t,wl=n,dl.attachEvent("onpropertychange",fy)):e==="focusout"&&m_()}function DE(e){if(e==="selectionchange"||e==="keyup"||e==="keydown")return hf(wl)}function NE(e,t){if(e==="click")return hf(t)}function UE(e,t){if(e==="input"||e==="change")return hf(t)}function LE(e,t){return e===t&&(e!==0||1/e===1/t)||e!==e&&t!==t}var jn=typeof Object.is=="function"?Object.is:LE;function Cl(e,t){if(jn(e,t))return!0;if(typeof e!="object"||e===null||typeof t!="object"||t===null)return!1;var n=Object.keys(e),i=Object.keys(t);if(n.length!==i.length)return!1;for(i=0;i<n.length;i++){var a=n[i];if(!Rp.call(t,a)||!jn(e[a],t[a]))return!1}return!0}function Op(e){if(e=e||(typeof document<"u"?document:void 0),typeof e>"u")return null;try{return e.activeElement||e.body}catch{return e.body}}function g_(e){for(;e&&e.firstChild;)e=e.firstChild;return e}function v_(e,t){var n=g_(e);e=0;for(var i;n;){if(n.nodeType===3){if(i=e+n.textContent.length,e<=t&&i>=t)return{node:n,offset:t-e};e=i}t:{for(;n;){if(n.nextSibling){n=n.nextSibling;break t}n=n.parentNode}n=void 0}n=g_(n)}}function hy(e,t){return e&&t?e===t?!0:e&&e.nodeType===3?!1:t&&t.nodeType===3?hy(e,t.parentNode):"contains"in e?e.contains(t):e.compareDocumentPosition?!!(e.compareDocumentPosition(t)&16):!1:!1}function dy(e){e=e!=null&&e.ownerDocument!=null&&e.ownerDocument.defaultView!=null?e.ownerDocument.defaultView:window;for(var t=Op(e.document);t instanceof e.HTMLIFrameElement;){try{var n=typeof t.contentWindow.location.href=="string"}catch{n=!1}if(n)e=t.contentWindow;else break;t=Op(e.document)}return t}function Hm(e){var t=e&&e.nodeName&&e.nodeName.toLowerCase();return t&&(t==="input"&&(e.type==="text"||e.type==="search"||e.type==="tel"||e.type==="url"||e.type==="password")||t==="textarea"||e.contentEditable==="true")}var OE=xa&&"documentMode"in document&&11>=document.documentMode,Br=null,Ip=null,pl=null,Pp=!1;function __(e,t,n){var i=n.window===n?n.document:n.nodeType===9?n:n.ownerDocument;Pp||Br==null||Br!==Op(i)||(i=Br,"selectionStart"in i&&Hm(i)?i={start:i.selectionStart,end:i.selectionEnd}:(i=(i.ownerDocument&&i.ownerDocument.defaultView||window).getSelection(),i={anchorNode:i.anchorNode,anchorOffset:i.anchorOffset,focusNode:i.focusNode,focusOffset:i.focusOffset}),pl&&Cl(pl,i)||(pl=i,i=sf(Ip,"onSelect"),0<i.length&&(t=new uf("onSelect","select",null,t,n),e.push({event:t,listeners:i}),t.target=Br)))}function Is(e,t){var n={};return n[e.toLowerCase()]=t.toLowerCase(),n["Webkit"+e]="webkit"+t,n["Moz"+e]="moz"+t,n}var zr={animationend:Is("Animation","AnimationEnd"),animationiteration:Is("Animation","AnimationIteration"),animationstart:Is("Animation","AnimationStart"),transitionrun:Is("Transition","TransitionRun"),transitionstart:Is("Transition","TransitionStart"),transitioncancel:Is("Transition","TransitionCancel"),transitionend:Is("Transition","TransitionEnd")},$d={},py={};xa&&(py=document.createElement("div").style,"AnimationEvent"in window||(delete zr.animationend.animation,delete zr.animationiteration.animation,delete zr.animationstart.animation),"TransitionEvent"in window||delete zr.transitionend.transition);function ir(e){if($d[e])return $d[e];if(!zr[e])return e;var t=zr[e],n;for(n in t)if(t.hasOwnProperty(n)&&n in py)return $d[e]=t[n];return e}var my=ir("animationend"),gy=ir("animationiteration"),vy=ir("animationstart"),IE=ir("transitionrun"),PE=ir("transitionstart"),BE=ir("transitioncancel"),_y=ir("transitionend"),xy=new Map,Bp="abort auxClick beforeToggle cancel canPlay canPlayThrough click close contextMenu copy cut drag dragEnd dragEnter dragExit dragLeave dragOver dragStart drop durationChange emptied encrypted ended error fullscreenChange fullscreenError gotPointerCapture input invalid keyDown keyPress keyUp load loadedData loadedMetadata loadStart lostPointerCapture mouseDown mouseMove mouseOut mouseOver mouseUp paste pause play playing pointerCancel pointerDown pointerMove pointerOut pointerOver pointerUp progress rateChange reset resize seeked seeking stalled submit suspend timeUpdate touchCancel touchEnd touchStart volumeChange scroll toggle touchMove waiting wheel".split(" ");Bp.push("scrollEnd");function wi(e,t){xy.set(e,t),nr(t,[e])}var zE=0;function ya(e,t){if(e.name!=null&&e.name!=="auto")return e.name;if(t.autoName!==null)return t.autoName;e=Ai.identifierPrefix;var n=zE++;return e="_"+e+"t_"+n.toString(32)+"_",t.autoName=e}function x_(e){if(e==null||typeof e=="string")return e;var t=null,n=$r;if(n!==null)for(var i=0;i<n.length;i++){var a=e[n[i]];if(a!=null){if(a==="none")return"none";t=t==null?a:t+(" "+a)}}return t??e.default}function Aa(e,t){return e=x_(e),t=x_(t),t==null?e==="auto"?null:e:t==="auto"?null:t}var Bu=typeof reportError=="function"?reportError:function(e){if(typeof window=="object"&&typeof window.ErrorEvent=="function"){var t=new window.ErrorEvent("error",{bubbles:!0,cancelable:!0,message:typeof e=="object"&&e!==null&&typeof e.message=="string"?String(e.message):String(e),error:e});if(!window.dispatchEvent(t))return}else if(typeof process=="object"&&typeof process.emit=="function"){process.emit("uncaughtException",e);return}console.error(e)},li=[],Fr=0,Vm=0;function df(){for(var e=Fr,t=Vm=Fr=0;t<e;){var n=li[t];li[t++]=null;var i=li[t];li[t++]=null;var a=li[t];li[t++]=null;var s=li[t];if(li[t++]=null,i!==null&&a!==null){var r=i.pending;r===null?a.next=a:(a.next=r.next,r.next=a),i.pending=a}s!==0&&yy(n,a,s)}}function pf(e,t,n,i){li[Fr++]=e,li[Fr++]=t,li[Fr++]=n,li[Fr++]=i,Vm|=i,e.lanes|=i,e=e.alternate,e!==null&&(e.lanes|=i)}function Gm(e,t,n,i){return pf(e,t,n,i),zu(e)}function ar(e,t){return pf(e,null,null,t),zu(e)}function yy(e,t,n){e.lanes|=n;var i=e.alternate;i!==null&&(i.lanes|=n);for(var a=!1,s=e.return;s!==null;)s.childLanes|=n,i=s.alternate,i!==null&&(i.childLanes|=n),s.tag===22&&(e=s.stateNode,e===null||e._visibility&1||(a=!0)),e=s,s=s.return;return e.tag===3?(s=e.stateNode,a&&t!==null&&(a=31-Kn(n),e=s.hiddenUpdates,i=e[a],i===null?e[a]=[t]:i.push(t),t.lane=n|536870912),s):null}function zu(e){if(50<Tl)throw Tl=0,Au=null,Error(nt(185));for(var t=e.return;t!==null;)e=t,t=e.return;return e.tag===3?e.stateNode:null}var Hr={};function FE(e,t,n,i){this.tag=e,this.key=n,this.sibling=this.child=this.return=this.stateNode=this.type=this.elementType=null,this.index=0,this.refCleanup=this.ref=null,this.pendingProps=t,this.dependencies=this.memoizedState=this.updateQueue=this.memoizedProps=null,this.mode=i,this.subtreeFlags=this.flags=0,this.deletions=null,this.childLanes=this.lanes=0,this.alternate=null}function On(e,t,n,i){return new FE(e,t,n,i)}function km(e){return e=e.prototype,!(!e||!e.isReactComponent)}function va(e,t){var n=e.alternate;return n===null?(n=On(e.tag,t,e.key,e.mode),n.elementType=e.elementType,n.type=e.type,n.stateNode=e.stateNode,n.alternate=e,e.alternate=n):(n.pendingProps=t,n.type=e.type,n.flags=0,n.subtreeFlags=0,n.deletions=null),n.flags=e.flags&1206910976,n.childLanes=e.childLanes,n.lanes=e.lanes,n.child=e.child,n.memoizedProps=e.memoizedProps,n.memoizedState=e.memoizedState,n.updateQueue=e.updateQueue,t=e.dependencies,n.dependencies=t===null?null:{lanes:t.lanes,firstContext:t.firstContext},n.sibling=e.sibling,n.index=e.index,n.ref=e.ref,n.refCleanup=e.refCleanup,n}function Sy(e,t){e.flags&=1206910978;var n=e.alternate;return n===null?(e.childLanes=0,e.lanes=t,e.child=null,e.subtreeFlags=0,e.memoizedProps=null,e.memoizedState=null,e.updateQueue=null,e.dependencies=null,e.stateNode=null):(e.childLanes=n.childLanes,e.lanes=n.lanes,e.child=n.child,e.subtreeFlags=0,e.deletions=null,e.memoizedProps=n.memoizedProps,e.memoizedState=n.memoizedState,e.updateQueue=n.updateQueue,e.type=n.type,t=n.dependencies,e.dependencies=t===null?null:{lanes:t.lanes,firstContext:t.firstContext}),e}function vu(e,t,n,i,a,s){var r=0;if(i=e,typeof i=="function")km(i)&&(r=1);else if(typeof i=="string")r=fw(e,n,Qi.current)?26:e==="html"||e==="head"||e==="body"?27:5;else t:switch(i){case Tp:return e=On(31,n,t,a),e.elementType=Tp,e.lanes=s,e;case Lr:return ks(n.children,a,s,t);case zx:r=8,a|=24;break;case Sp:return e=On(12,n,t,a|2),e.elementType=Sp,e.lanes=s,e;case Mp:return e=On(13,n,t,a),e.elementType=Mp,e.lanes=s,e;case bp:return e=On(19,n,t,a),e.elementType=bp,e.lanes=s,e;case AT:case Ep:return e=a|32,e=On(30,n,t,e),e.elementType=Ep,e.lanes=s,e.stateNode={autoName:null,paired:null,clones:null,ref:null},e;default:if(typeof i=="object"&&i!==null)switch(i.$$typeof){case Yi:r=10;break t;case Fx:r=9;break t;case Dm:r=11;break t;case Nm:r=14;break t;case ka:r=16,i=null;break t}r=29,n=Error(nt(130,e===null?"null":typeof e,"")),i=null}return t=On(r,n,t,a),t.elementType=e,t.type=i,t.lanes=s,t}function ks(e,t,n,i){return e=On(7,e,i,t),e.lanes=n,e}function tp(e,t,n){return e=On(6,e,null,t),e.lanes=n,e}function My(e){var t=On(18,null,null,0);return t.stateNode=e,t}function ep(e,t,n){return t=On(4,e.children!==null?e.children:[],e.key,t),t.lanes=n,t.stateNode={containerInfo:e.containerInfo,pendingChildren:null,implementation:e.implementation},t}var y_=new WeakMap;function hi(e,t){if(typeof e=="object"&&e!==null){var n=y_.get(e);return n!==void 0?n:(t={value:e,source:t,stack:jv(t)},y_.set(e,t),t)}return{value:e,source:t,stack:jv(t)}}var Vr=[],Gr=0,Fu=null,Rl=0,ci=[],ui=0,ls=null,Ji=1,Ki="";function ma(e,t){Vr[Gr++]=Rl,Vr[Gr++]=Fu,Fu=e,Rl=t}function by(e,t,n){ci[ui++]=Ji,ci[ui++]=Ki,ci[ui++]=ls,ls=e;var i=Ji;e=Ki;var a=32-Kn(i)-1;i&=~(1<<a),n+=1;var s=32-Kn(t)+a;if(30<s){var r=a-a%5;s=(i&(1<<r)-1).toString(32),i>>=r,a-=r,Ji=1<<32-Kn(t)+a|n<<a|i,Ki=s+e}else Ji=1<<s|n<<a|i,Ki=e}function mf(e){e.return!==null&&(ma(e,1),by(e,1,0))}function Xm(e){for(;e===Fu;)Fu=Vr[--Gr],Vr[Gr]=null,Rl=Vr[--Gr],Vr[Gr]=null;for(;e===ls;)ls=ci[--ui],ci[ui]=null,Ki=ci[--ui],ci[ui]=null,Ji=ci[--ui],ci[ui]=null}function Ty(e,t){ci[ui++]=Ji,ci[ui++]=Ki,ci[ui++]=ls,Ji=t.id,Ki=t.overflow,ls=e}var sn=null,Ne=null,Qt=!1,$a=null,di=!1,zp=Error(nt(519));function cs(e){var t=Error(nt(418,1<arguments.length&&arguments[1]!==void 0&&arguments[1]?"text":"HTML",""));throw Dl(hi(t,e)),zp}function S_(e){var t=e.stateNode,n=e.type,i=e.memoizedProps;switch(t[cn]=e,t[Bn]=i,n){case"dialog":ee("cancel",t),ee("close",t);break;case"iframe":case"object":case"embed":ee("load",t);break;case"video":case"audio":for(n=0;n<Ol.length;n++)ee(Ol[n],t);break;case"source":ee("error",t);break;case"img":case"image":case"link":ee("error",t),ee("load",t);break;case"details":ee("toggle",t);break;case"input":ee("invalid",t),ty(t,i.value,i.defaultValue,i.checked,i.defaultChecked,i.type,i.name,!0);break;case"select":ee("invalid",t);break;case"textarea":ee("invalid",t),ny(t,i.value,i.defaultValue,i.children)}n=i.children,typeof n!="string"&&typeof n!="number"&&typeof n!="bigint"||t.textContent===""+n||i.suppressHydrationWarning===!0||r1(t.textContent,n)?(i.popover!=null&&(ee("beforetoggle",t),ee("toggle",t)),i.onScroll!=null&&ee("scroll",t),i.onScrollEnd!=null&&ee("scrollend",t),i.onClick!=null&&(t.onclick=Zi),t=!0):t=!1,t||cs(e,!0)}function Hu(e){for(sn=e.return;sn;)switch(sn.tag){case 5:case 31:case 13:di=!1;return;case 27:case 3:di=!0;return;default:sn=sn.return}}function wr(e){if(e!==sn)return!1;if(!Qt)return Hu(e),Qt=!0,!1;var t=e.tag,n;if((n=t!==3&&t!==27)&&((n=t===5)&&(n=e.type,n=!(n!=="form"&&n!=="button")||Mm(e.type,e.memoizedProps)),n=!n),n&&Ne&&cs(e),Hu(e),t===13){if(e=e.memoizedState,e=e!==null?e.dehydrated:null,!e)throw Error(nt(317));Ne=vx(e)}else if(t===31){if(e=e.memoizedState,e=e!==null?e.dehydrated:null,!e)throw Error(nt(317));Ne=vx(e)}else t===27?(t=Ne,ps(e.type)?(e=Am,Am=null,Ne=e):Ne=t):Ne=sn?pi(e.stateNode.nextSibling):null;return!0}function Ys(){Ne=sn=null,Qt=!1}function np(){var e=$a;return e!==null&&(Un===null?Un=e:Un.push.apply(Un,e),$a=null),e}function Dl(e){$a===null?$a=[e]:$a.push(e)}var Fp=ta(null),sr=null,ga=null;function Za(e,t,n){Ue(Fp,t._currentValue),t._currentValue=n}function _a(e){e._currentValue=Fp.current,fn(Fp)}function _u(e,t,n){for(;e!==null;){var i=e.alternate;if((e.childLanes&t)!==t?(e.childLanes|=t,i!==null&&(i.childLanes|=t)):i!==null&&(i.childLanes&t)!==t&&(i.childLanes|=t),e===n)break;e=e.return}}function Hp(e,t,n,i){var a=e.child;for(a!==null&&(a.return=e);a!==null;){var s=a.dependencies;if(s!==null){var r=a.child;s=s.firstContext;t:for(;s!==null;){var o=s;s=a;for(var l=0;l<t.length;l++)if(o.context===t[l]){s.lanes|=n,o=s.alternate,o!==null&&(o.lanes|=n),_u(s.return,n,e),i||(r=null);break t}s=o.next}}else if(a.tag===18){if(r=a.return,r===null)throw Error(nt(341));r.lanes|=n,s=r.alternate,s!==null&&(s.lanes|=n),_u(r,n,e),r=null}else a.tag===13&&a.memoizedState!==null&&a.memoizedState.dehydrated===null?(a.lanes|=n,r=a.alternate,r!==null&&(r.lanes|=n),_u(a.return,n,e),r=a.child,r=r!==null?r.sibling:null):r=a.child;if(r!==null)r.return=a;else for(r=a;r!==null;){if(r===e){r=null;break}if(a=r.sibling,a!==null){a.return=r.return,r=a;break}r=r.return}a=r}}function Zs(e,t,n,i){e=null;for(var a=t,s=!1;a!==null;){if(!s){if((a.flags&524288)!==0)s=!0;else if((a.flags&262144)!==0)break}if(a.tag===10){var r=a.alternate;if(r===null)throw Error(nt(387));if(r=r.memoizedProps,r!==null){var o=a.type;jn(a.pendingProps.value,r.value)||(e!==null?e.push(o):e=[o])}}else if(a===Uu.current){if(r=a.alternate,r===null)throw Error(nt(387));r.memoizedState.memoizedState!==a.memoizedState.memoizedState&&(e!==null?e.push(uo):e=[uo])}a=a.return}return e!==null&&Hp(t,e,n,i),t.flags|=262144,e!==null}function Vu(e){for(e=e.firstContext;e!==null;){if(!jn(e.context._currentValue,e.memoizedValue))return!0;e=e.next}return!1}function Js(e){sr=e,ga=null,e=e.dependencies,e!==null&&(e.firstContext=null)}function un(e){return Ey(sr,e)}function tu(e,t){return sr===null&&Js(e),Ey(e,t)}function Ey(e,t){var n=t._currentValue;if(t={context:t,memoizedValue:n,next:null},ga===null){if(e===null)throw Error(nt(308));ga=t,e.dependencies={lanes:0,firstContext:t},e.flags|=524288}else ga=ga.next=t;return n}var HE=typeof AbortController<"u"?AbortController:function(){var e=[],t=this.signal={aborted:!1,addEventListener:function(n,i){e.push(i)}};this.abort=function(){t.aborted=!0,e.forEach(function(n){return n()})}},VE=je.unstable_scheduleCallback,GE=je.unstable_NormalPriority,Ye={$$typeof:Yi,Consumer:null,Provider:null,_currentValue:null,_currentValue2:null,_threadCount:0};function Wm(){return{controller:new HE,data:new Map,refCount:0}}function Yl(e){e.refCount--,e.refCount===0&&VE(GE,function(){e.controller.abort()})}function M_(e,t){if((e.pendingLanes&4194048)!==0){var n=e.transitionTypes;for(n===null&&(n=e.transitionTypes=[]),e=0;e<t.length;e++){var i=t[e];n.indexOf(i)===-1&&n.push(i)}}}var ul=null;function kE(e){var t=e.transitionTypes;return e.transitionTypes=null,t}var ml=null,Vp=0,Ks=0,Yr=null;function XE(e,t){if(ml===null){var n=ml=[];Vp=0,Ks=x0(),Yr={status:"pending",value:void 0,then:function(i){n.push(i)}}}return Vp++,t.then(b_,b_),t}function b_(){if(--Vp===0&&(ul=null,ml!==null)){Yr!==null&&(Yr.status="fulfilled");var e=ml;ml=null,Ks=0,Yr=null;for(var t=0;t<e.length;t++)(0,e[t])()}}function WE(e,t){var n=[],i={status:"pending",value:null,reason:null,then:function(a){n.push(a)}};return e.then(function(){i.status="fulfilled",i.value=t;for(var a=0;a<n.length;a++)(0,n[a])(t)},function(a){for(i.status="rejected",i.reason=a,a=0;a<n.length;a++)(0,n[a])(void 0)}),i}var T_=Ht.S;Ht.S=function(e,t){if(kS=Zn(),typeof t=="object"&&t!==null&&typeof t.then=="function"&&XE(e,t),ul!==null)for(var n=oo;n!==null;)M_(n,ul),n=n.next;if(n=e.types,n!==null){for(var i=oo;i!==null;)M_(i,n),i=i.next;if(Ks!==0){i=ul,i===null&&(i=ul=[]);for(var a=0;a<n.length;a++){var s=n[a];i.indexOf(s)===-1&&i.push(s)}}}T_!==null&&T_(e,t)};var Xs=ta(null);function qm(){var e=Xs.current;return e!==null?e:Ee.pooledCache}function xu(e,t){t===null?Ue(Xs,Xs.current):Ue(Xs,t.pool)}function Ay(){var e=qm();return e===null?null:{parent:Ye._currentValue,pool:e}}var go=Error(nt(460)),Ym=Error(nt(474)),gf=Error(nt(542)),Gu={then:function(){}};function E_(e){return e=e.status,e==="fulfilled"||e==="rejected"}function wy(e,t,n){switch(n=e[n],n===void 0?e.push(t):n!==t&&(t.then(Zi,Zi),t=n),t.status){case"fulfilled":return t.value;case"rejected":throw e=t.reason,w_(e),e===void 0&&!("reason"in t)?Error(nt(600)):e;default:if(typeof t.status=="string")t.then(Zi,Zi);else{if(e=Ee,e!==null&&100<e.shellSuspendCounter)throw Error(nt(482));e=t,e.status="pending",e.then(function(i){if(t.status==="pending"){var a=t;a.status="fulfilled",a.value=i}},function(i){if(t.status==="pending"){var a=t;a.status="rejected",a.reason=i}})}switch(t.status){case"fulfilled":return t.value;case"rejected":throw e=t.reason,w_(e),e}throw Ws=t,go}}function zs(e){try{var t=e._init;return t(e._payload)}catch(n){throw n!==null&&typeof n=="object"&&typeof n.then=="function"?(Ws=n,go):n}}var Ws=null;function A_(){if(Ws===null)throw Error(nt(459));var e=Ws;return Ws=null,e}function w_(e){if(e===go||e===gf)throw Error(nt(483))}var Zr=null,Nl=0;function eu(e){var t=Nl;return Nl+=1,Zr===null&&(Zr=[]),wy(Zr,e,t)}function Ha(e,t){t=t.props.ref,e.ref=t!==void 0?t:null}function nu(e,t){throw t.$$typeof===ET?Error(nt(525)):(e=Object.prototype.toString.call(t),Error(nt(31,e==="[object Object]"?"object with keys {"+Object.keys(t).join(", ")+"}":e)))}function Cy(e){function t(h,g){if(e){var S=h.deletions;S===null?(h.deletions=[g],h.flags|=16):S.push(g)}}function n(h,g){if(!e)return null;for(;g!==null;)t(h,g),g=g.sibling;return null}function i(h){for(var g=new Map;h!==null;)h.key===null?g.set(h.index,h):g.set(h.key,h),h=h.sibling;return g}function a(h,g){return h=va(h,g),h.index=0,h.sibling=null,h}function s(h,g,S){return h.index=S,e?(S=h.alternate,S!==null?(S=S.index,S<g?(h.flags|=2,g):S):(h.flags|=134217730,g)):(h.flags|=1048576,g)}function r(h){return e&&h.alternate===null&&(h.flags|=134217730),h}function o(h,g,S,y){return g===null||g.tag!==6?(g=tp(S,h.mode,y),g.return=h,g):(g=a(g,S),g.return=h,g)}function l(h,g,S,y){var T=S.type;return T===Lr?(h=f(h,g,S.props.children,y,S.key),Ha(h,S),h):g!==null&&(g.elementType===T||typeof T=="object"&&T!==null&&T.$$typeof===ka&&zs(T)===g.type)?(g=a(g,S.props),Ha(g,S),g.return=h,g):(g=vu(S.type,S.key,S.props,null,h.mode,y),Ha(g,S),g.return=h,g)}function c(h,g,S,y){return g===null||g.tag!==4||g.stateNode.containerInfo!==S.containerInfo||g.stateNode.implementation!==S.implementation?(g=ep(S,h.mode,y),g.return=h,g):(g=a(g,S.children||[]),g.return=h,g)}function f(h,g,S,y,T){return g===null||g.tag!==7?(g=ks(S,h.mode,y,T),g.return=h,g):(g=a(g,S),g.return=h,g)}function p(h,g,S){if(typeof g=="string"&&g!==""||typeof g=="number"||typeof g=="bigint")return g=tp(""+g,h.mode,S),g.return=h,g;if(typeof g=="object"&&g!==null){switch(g.$$typeof){case qc:return S=vu(g.type,g.key,g.props,null,h.mode,S),Ha(S,g),S.return=h,S;case ol:return g=ep(g,h.mode,S),g.return=h,g;case ka:return g=zs(g),p(h,g,S)}if(ll(g)||el(g))return g=ks(g,h.mode,S,null),g.return=h,g;if(typeof g.then=="function")return p(h,eu(g),S);if(g.$$typeof===Yi)return p(h,tu(h,g),S);nu(h,g)}return null}function u(h,g,S,y){var T=g!==null?g.key:null;if(typeof S=="string"&&S!==""||typeof S=="number"||typeof S=="bigint")return T!==null?null:o(h,g,""+S,y);if(typeof S=="object"&&S!==null){switch(S.$$typeof){case qc:return S.key===T?l(h,g,S,y):null;case ol:return S.key===T?c(h,g,S,y):null;case ka:return S=zs(S),u(h,g,S,y)}if(ll(S)||el(S))return T!==null?null:f(h,g,S,y,null);if(typeof S.then=="function")return u(h,g,eu(S),y);if(S.$$typeof===Yi)return u(h,g,tu(h,S),y);nu(h,S)}return null}function d(h,g,S,y,T){if(typeof y=="string"&&y!==""||typeof y=="number"||typeof y=="bigint")return h=h.get(S)||null,o(g,h,""+y,T);if(typeof y=="object"&&y!==null){switch(y.$$typeof){case qc:return h=h.get(y.key===null?S:y.key)||null,l(g,h,y,T);case ol:return h=h.get(y.key===null?S:y.key)||null,c(g,h,y,T);case ka:return y=zs(y),d(h,g,S,y,T)}if(ll(y)||el(y))return h=h.get(S)||null,f(g,h,y,T,null);if(typeof y.then=="function")return d(h,g,S,eu(y),T);if(y.$$typeof===Yi)return d(h,g,S,tu(g,y),T);nu(g,y)}return null}function _(h,g,S,y){for(var T=null,A=null,E=g,x=g=0,w=null;E!==null&&x<S.length;x++){E.index>x?(w=E,E=null):w=E.sibling;var R=u(h,E,S[x],y);if(R===null){E===null&&(E=w);break}e&&E&&R.alternate===null&&t(h,E),g=s(R,g,x),A===null?T=R:A.sibling=R,A=R,E=w}if(x===S.length)return n(h,E),Qt&&ma(h,x),T;if(E===null){for(;x<S.length;x++)E=p(h,S[x],y),E!==null&&(g=s(E,g,x),A===null?T=E:A.sibling=E,A=E);return Qt&&ma(h,x),T}for(E=i(E);x<S.length;x++)w=d(E,h,x,S[x],y),w!==null&&(e&&(R=w.alternate,R!==null&&E.delete(R.key===null?x:R.key)),g=s(w,g,x),A===null?T=w:A.sibling=w,A=w);return e&&E.forEach(function(D){return t(h,D)}),Qt&&ma(h,x),T}function b(h,g,S,y){if(S==null)throw Error(nt(151));for(var T=null,A=null,E=g,x=g=0,w=null,R=S.next();E!==null&&!R.done;x++,R=S.next()){E.index>x?(w=E,E=null):w=E.sibling;var D=u(h,E,R.value,y);if(D===null){E===null&&(E=w);break}e&&E&&D.alternate===null&&t(h,E),g=s(D,g,x),A===null?T=D:A.sibling=D,A=D,E=w}if(R.done)return n(h,E),Qt&&ma(h,x),T;if(E===null){for(;!R.done;x++,R=S.next())R=p(h,R.value,y),R!==null&&(g=s(R,g,x),A===null?T=R:A.sibling=R,A=R);return Qt&&ma(h,x),T}for(E=i(E);!R.done;x++,R=S.next())R=d(E,h,x,R.value,y),R!==null&&(e&&(w=R.alternate,w!==null&&E.delete(w.key===null?x:w.key)),g=s(R,g,x),A===null?T=R:A.sibling=R,A=R);return e&&E.forEach(function(P){return t(h,P)}),Qt&&ma(h,x),T}function m(h,g,S,y){if(typeof S=="object"&&S!==null&&S.type===Lr&&S.key===null&&S.props.ref===void 0&&(S=S.props.children),typeof S=="object"&&S!==null){switch(S.$$typeof){case qc:t:{for(var T=S.key;g!==null;){if(g.key===T){if(T=S.type,T===Lr){if(g.tag===7){n(h,g.sibling),y=a(g,S.props.children),Ha(y,S),y.return=h,h=y;break t}}else if(g.elementType===T||typeof T=="object"&&T!==null&&T.$$typeof===ka&&zs(T)===g.type){n(h,g.sibling),y=a(g,S.props),Ha(y,S),y.return=h,h=y;break t}n(h,g);break}else t(h,g);g=g.sibling}S.type===Lr?(y=ks(S.props.children,h.mode,y,S.key),Ha(y,S),y.return=h,h=y):(y=vu(S.type,S.key,S.props,null,h.mode,y),Ha(y,S),y.return=h,h=y)}return r(h);case ol:t:{for(T=S.key;g!==null;){if(g.key===T)if(g.tag===4&&g.stateNode.containerInfo===S.containerInfo&&g.stateNode.implementation===S.implementation){n(h,g.sibling),y=a(g,S.children||[]),y.return=h,h=y;break t}else{n(h,g);break}else t(h,g);g=g.sibling}y=ep(S,h.mode,y),y.return=h,h=y}return r(h);case ka:return S=zs(S),m(h,g,S,y)}if(ll(S))return _(h,g,S,y);if(el(S)){if(T=el(S),typeof T!="function")throw Error(nt(150));return S=T.call(S),b(h,g,S,y)}if(typeof S.then=="function")return m(h,g,eu(S),y);if(S.$$typeof===Yi)return m(h,g,tu(h,S),y);nu(h,S)}return typeof S=="string"&&S!==""||typeof S=="number"||typeof S=="bigint"?(S=""+S,g!==null&&g.tag===6?(n(h,g.sibling),y=a(g,S),y.return=h,h=y):(n(h,g),y=tp(S,h.mode,y),y.return=h,h=y),r(h)):n(h,g)}return function(h,g,S,y){try{Nl=0;var T=m(h,g,S,y);return Zr=null,T}catch(E){if(E===go||E===gf)throw E;var A=On(29,E,null,h.mode);return A.lanes=y,A.return=h,A}}}var Qs=Cy(!0),Ry=Cy(!1),Xa=!1;function Zm(e){e.updateQueue={baseState:e.memoizedState,firstBaseUpdate:null,lastBaseUpdate:null,shared:{pending:null,lanes:0,hiddenCallbacks:null},callbacks:null}}function Gp(e,t){e=e.updateQueue,t.updateQueue===e&&(t.updateQueue={baseState:e.baseState,firstBaseUpdate:e.firstBaseUpdate,lastBaseUpdate:e.lastBaseUpdate,shared:e.shared,callbacks:null})}function ts(e){return{lane:e,tag:0,payload:null,callback:null,next:null}}function es(e,t,n){var i=e.updateQueue;if(i===null)return null;if(i=i.shared,(fe&2)!==0){var a=i.pending;return a===null?t.next=t:(t.next=a.next,a.next=t),i.pending=t,t=zu(e),yy(e,null,n),t}return pf(e,i,t,n),zu(e)}function gl(e,t,n){if(t=t.updateQueue,t!==null&&(t=t.shared,(n&4194048)!==0)){var i=t.lanes;i&=e.pendingLanes,n|=i,t.lanes=n,qx(e,n)}}function ip(e,t){var n=e.updateQueue,i=e.alternate;if(i!==null&&(i=i.updateQueue,n===i)){var a=null,s=null;if(n=n.firstBaseUpdate,n!==null){do{var r={lane:n.lane,tag:n.tag,payload:n.payload,callback:null,next:null};s===null?a=s=r:s=s.next=r,n=n.next}while(n!==null);s===null?a=s=t:s=s.next=t}else a=s=t;n={baseState:i.baseState,firstBaseUpdate:a,lastBaseUpdate:s,shared:i.shared,callbacks:i.callbacks},e.updateQueue=n;return}e=n.lastBaseUpdate,e===null?n.firstBaseUpdate=t:e.next=t,n.lastBaseUpdate=t}var kp=!1;function vl(){if(kp){var e=Yr;if(e!==null)throw e}}function _l(e,t,n,i){kp=!1;var a=e.updateQueue;Xa=!1;var s=a.firstBaseUpdate,r=a.lastBaseUpdate,o=a.shared.pending;if(o!==null){a.shared.pending=null;var l=o,c=l.next;l.next=null,r===null?s=c:r.next=c,r=l;var f=e.alternate;f!==null&&(f=f.updateQueue,o=f.lastBaseUpdate,o!==r&&(o===null?f.firstBaseUpdate=c:o.next=c,f.lastBaseUpdate=l))}if(s!==null){var p=a.baseState;r=0,f=c=l=null,o=s;do{var u=o.lane&-536870913,d=u!==o.lane;if(d?(ae&u)===u:(i&u)===u){u!==0&&u===Ks&&(kp=!0),f!==null&&(f=f.next={lane:0,tag:o.tag,payload:o.payload,callback:null,next:null});t:{var _=e,b=o;u=t;var m=n;switch(b.tag){case 1:if(_=b.payload,typeof _=="function"){p=_.call(m,p,u);break t}p=_;break t;case 3:_.flags=_.flags&-65537|128;case 0:if(_=b.payload,u=typeof _=="function"?_.call(m,p,u):_,u==null)break t;p=Ae({},p,u);break t;case 2:Xa=!0}}u=o.callback,u!==null&&(e.flags|=64,d&&(e.flags|=8192),d=a.callbacks,d===null?a.callbacks=[u]:d.push(u))}else d={lane:u,tag:o.tag,payload:o.payload,callback:o.callback,next:null},f===null?(c=f=d,l=p):f=f.next=d,r|=u;if(o=o.next,o===null){if(o=a.shared.pending,o===null)break;d=o,o=d.next,d.next=null,a.lastBaseUpdate=d,a.shared.pending=null}}while(!0);f===null&&(l=p),a.baseState=l,a.firstBaseUpdate=c,a.lastBaseUpdate=f,s===null&&(a.shared.lanes=0),hs|=r,e.lanes=r,e.memoizedState=p}}function Dy(e,t){if(typeof e!="function")throw Error(nt(191,e));e.call(t)}function Ny(e,t){var n=e.callbacks;if(n!==null)for(e.callbacks=null,e=0;e<n.length;e++)Dy(n[e],t)}var us=ta(null),ku=ta(0);function C_(e,t){e=Ta,Ue(ku,e),Ue(us,t),Ta=e|t.baseLanes}function Xp(){Ue(ku,Ta),Ue(us,us.current)}function Jm(){Ta=ku.current,fn(us),fn(ku)}var pn=ta(null),xn=null;function ns(e){var t=e.alternate;Ue(hn,hn.current&1),Ue(pn,e),xn===null&&(t===null||us.current!==null||t.memoizedState!==null)&&(xn=e)}function Wp(e){Ue(hn,hn.current),Ue(pn,e),xn===null&&(xn=e)}function Uy(e){e.tag===22?(Ue(hn,hn.current),Ue(pn,e),xn===null&&(xn=e)):is()}function is(){Ue(hn,hn.current),Ue(pn,pn.current)}function Wn(e){fn(pn),xn===e&&(xn=null),fn(hn)}var hn=ta(0);function Ul(e,t){Ue(pn,pn.current),Ue(hn,t)}function Km(e){fn(hn),fn(pn),xn===e&&(xn=null)}function Xu(e){for(var t=e;t!==null;){if(t.tag===13){var n=t.memoizedState;if(n!==null&&(n=n.dehydrated,n===null||Em(n)||b0(n)))return t}else if(t.tag===19&&t.memoizedProps.revealOrder!=="independent"){if((t.flags&128)!==0)return t}else if(t.child!==null){t.child.return=t,t=t.child;continue}if(t===e)break;for(;t.sibling===null;){if(t.return===null||t.return===e)return null;t=t.return}t.sibling.return=t.return,t=t.sibling}return null}var Sa=0,Yt=null,Me=null,qe=null,Wu=!1,Jr=!1,js=!1,qu=0,Ll=0,Kr=null,qE=0;function He(){throw Error(nt(321))}function Qm(e,t){if(t===null)return!1;for(var n=0;n<t.length&&n<e.length;n++)if(!jn(e[n],t[n]))return!1;return!0}function jm(e,t,n,i,a,s){return Sa=s,Yt=t,t.memoizedState=null,t.updateQueue=null,t.lanes=0,Ht.H=e===null||e.memoizedState===null?cS:uS,js=!1,s=n(i,a),js=!1,Jr&&(s=Oy(t,n,i,a)),Ly(e),s}function Ly(e){Ht.H=Yu;var t=Me!==null&&Me.next!==null;if(Sa=0,qe=Me=Yt=null,Wu=!1,Ll=0,Kr=null,t)throw Error(nt(300));e===null||Ze||(e=e.dependencies,e!==null&&Vu(e)&&(Ze=!0))}function Oy(e,t,n,i){Yt=e;var a=0;do{if(Jr&&(Kr=null),Ll=0,Jr=!1,25<=a)throw Error(nt(301));if(a+=1,qe=Me=null,e.updateQueue!=null){var s=e.updateQueue;s.lastEffect=null,s.events=null,s.stores=null,s.memoCache!=null&&(s.memoCache.index=0)}Ht.H=tA,s=t(n,i)}while(Jr);return s}function YE(){var e=Ht.H,t=e.useState()[0];return t=typeof t.then=="function"?Zl(t):t,e=e.useState()[0],(Me!==null?Me.memoizedState:null)!==e&&(Yt.flags|=1024),t}function $m(){var e=qu!==0;return qu=0,e}function t0(e,t,n){t.updateQueue=e.updateQueue,t.flags&=-2053,e.lanes&=~n}function e0(e){if(Wu){for(e=e.memoizedState;e!==null;){var t=e.queue;t!==null&&(t.pending=null),e=e.next}Wu=!1}Sa=0,qe=Me=Yt=null,Jr=!1,Ll=qu=0,Kr=null}function wn(){var e={memoizedState:null,baseState:null,baseQueue:null,queue:null,next:null};return qe===null?Yt.memoizedState=qe=e:qe=qe.next=e,qe}function ke(){if(Me===null){var e=Yt.alternate;e=e!==null?e.memoizedState:null}else e=Me.next;var t=qe===null?Yt.memoizedState:qe.next;if(t!==null)qe=t,Me=e;else{if(e===null)throw Yt.alternate===null?Error(nt(467)):Error(nt(310));Me=e,e={memoizedState:Me.memoizedState,baseState:Me.baseState,baseQueue:Me.baseQueue,queue:Me.queue,next:null},qe===null?Yt.memoizedState=qe=e:qe=qe.next=e}return qe}function vf(){return{lastEffect:null,events:null,stores:null,memoCache:null}}function Zl(e){var t=Ll;return Ll+=1,Kr===null&&(Kr=[]),e=wy(Kr,e,t),t=Yt,(qe===null?t.memoizedState:qe.next)===null&&(t=t.alternate,Ht.H=t===null||t.memoizedState===null?cS:uS),e}function _f(e){if(e!==null&&typeof e=="object"){if(typeof e.then=="function")return Zl(e);if(e.$$typeof===CT)return;if(e.$$typeof===Yi)return un(e)}throw Error(nt(438,String(e)))}function n0(e){var t=null,n=Yt.updateQueue;if(n!==null&&(t=n.memoCache),t==null){var i=Yt.alternate;i!==null&&(i=i.updateQueue,i!==null&&(i=i.memoCache,i!=null&&(t={data:i.data.map(function(a){return a.slice()}),index:0})))}if(t==null&&(t={data:[],index:0}),n===null&&(n=vf(),Yt.updateQueue=n),n.memoCache=t,n=t.data[t.index],n===void 0)for(n=t.data[t.index]=Array(e),i=0;i<e;i++)n[i]=wT;return t.index++,n}function Ma(e,t){return typeof t=="function"?t(e):t}function yu(e){var t=ke();return i0(t,Me,e)}function i0(e,t,n){var i=e.queue;if(i===null)throw Error(nt(311));i.lastRenderedReducer=n;var a=e.baseQueue,s=i.pending;if(s!==null){if(a!==null){var r=a.next;a.next=s.next,s.next=r}t.baseQueue=a=s,i.pending=null}if(s=e.baseState,a===null)e.memoizedState=s;else{t=a.next;var o=r=null,l=null,c=t,f=!1;do{var p=c.lane&-536870913;if(p!==c.lane?(ae&p)===p:(Sa&p)===p){var u=c.revertLane;if(u===0)l!==null&&(l=l.next={lane:0,revertLane:0,gesture:null,action:c.action,hasEagerState:c.hasEagerState,eagerState:c.eagerState,next:null}),p===Ks&&(f=!0);else if((Sa&u)===u){c=c.next,u===Ks&&(f=!0);continue}else p={lane:0,revertLane:c.revertLane,gesture:null,action:c.action,hasEagerState:c.hasEagerState,eagerState:c.eagerState,next:null},l===null?(o=l=p,r=s):l=l.next=p,Yt.lanes|=u,hs|=u;p=c.action,js&&n(s,p),s=c.hasEagerState?c.eagerState:n(s,p)}else u={lane:p,revertLane:c.revertLane,gesture:c.gesture,action:c.action,hasEagerState:c.hasEagerState,eagerState:c.eagerState,next:null},l===null?(o=l=u,r=s):l=l.next=u,Yt.lanes|=p,hs|=p;c=c.next}while(c!==null&&c!==t);if(l===null?r=s:l.next=o,!jn(s,e.memoizedState)&&(Ze=!0,f&&(n=Yr,n!==null)))throw n;e.memoizedState=s,e.baseState=r,e.baseQueue=l,i.lastRenderedState=s}return a===null&&(i.lanes=0),[e.memoizedState,i.dispatch]}function ap(e){var t=ke(),n=t.queue;if(n===null)throw Error(nt(311));n.lastRenderedReducer=e;var i=n.dispatch,a=n.pending,s=t.memoizedState;if(a!==null){n.pending=null;var r=a=a.next;do s=e(s,r.action),r=r.next;while(r!==a);jn(s,t.memoizedState)||(Ze=!0),t.memoizedState=s,t.baseQueue===null&&(t.baseState=s),n.lastRenderedState=s}return[s,i]}function Iy(e,t,n){var i=Yt,a=ke(),s=Qt;if(s){if(n===void 0)throw Error(nt(407));n=n()}else n=t();var r=!jn((Me||a).memoizedState,n);if(r&&(a.memoizedState=n,Ze=!0),a=a.queue,a0(zy.bind(null,i,a,e),[e]),e=a.getSnapshot!==t||r||qe!==null&&(qe.memoizedState.tag&1)!==0,io(e?9:8,{destroy:void 0},By.bind(null,i,a,n,t),null),e){if(i.flags|=2048,Ee===null)throw Error(nt(349));s||(Sa&127)!==0||Py(i,t,n)}return n}function Py(e,t,n){e.flags|=16384,e={getSnapshot:t,value:n},t=Yt.updateQueue,t===null?(t=vf(),Yt.updateQueue=t,t.stores=[e]):(n=t.stores,n===null?t.stores=[e]:n.push(e))}function By(e,t,n,i){t.value=n,t.getSnapshot=i,Fy(t)&&Hy(e)}function zy(e,t,n){return n(function(){Fy(t)&&Hy(e)})}function Fy(e){var t=e.getSnapshot;e=e.value;try{var n=t();return!jn(e,n)}catch{return!0}}function Hy(e){var t=ar(e,2);t!==null&&In(t,e,2)}function qp(e){var t=wn();if(typeof e=="function"){var n=e;if(e=n(),js){qa(!0);try{n()}finally{qa(!1)}}}return t.memoizedState=t.baseState=e,t.queue={pending:null,lanes:0,dispatch:null,lastRenderedReducer:Ma,lastRenderedState:e},t}function Vy(e,t,n,i){return e.baseState=n,i0(e,Me,typeof i=="function"?i:Ma)}function ZE(e,t,n,i,a){if(yf(e))throw Error(nt(485));if(e=t.action,e!==null){var s={payload:a,action:e,next:null,isTransition:!0,status:"pending",value:null,reason:null,listeners:[],then:function(r){s.listeners.push(r)}};Ht.T!==null?n(!0):s.isTransition=!1,i(s),n=t.pending,n===null?(s.next=t.pending=s,Gy(t,s)):(s.next=n.next,t.pending=n.next=s)}}function Gy(e,t){var n=t.action,i=t.payload,a=e.state;if(t.isTransition){var s=Ht.T,r={};r.types=s!==null?s.types:null,Ht.T=r;try{var o=n(a,i),l=Ht.S;l!==null&&l(r,o),R_(e,t,o)}catch(c){Yp(e,t,c)}finally{s!==null&&r.types!==null&&(s.types=r.types),Ht.T=s}}else try{s=n(a,i),R_(e,t,s)}catch(c){Yp(e,t,c)}}function R_(e,t,n){n!==null&&typeof n=="object"&&typeof n.then=="function"?n.then(function(i){D_(e,t,i)},function(i){return Yp(e,t,i)}):D_(e,t,n)}function D_(e,t,n){t.status="fulfilled",t.value=n,ky(t),e.state=n,t=e.pending,t!==null&&(n=t.next,n===t?e.pending=null:(n=n.next,t.next=n,Gy(e,n)))}function Yp(e,t,n){var i=e.pending;if(e.pending=null,i!==null){i=i.next;do t.status="rejected",t.reason=n,ky(t),t=t.next;while(t!==i)}e.action=null}function ky(e){e=e.listeners;for(var t=0;t<e.length;t++)(0,e[t])()}function Xy(e,t){return t}function N_(e,t){if(Qt){var n=Ee.formState;if(n!==null){t:{var i=Yt;if(Qt){if(Ne){e:{for(var a=Ne,s=di;a.nodeType!==8;){if(!s){a=null;break e}if(a=pi(a.nextSibling),a===null){a=null;break e}}s=a.data,a=s==="F!"||s==="F"?a:null}if(a){Ne=pi(a.nextSibling),i=a.data==="F!";break t}}cs(i)}i=!1}i&&(t=n[0])}}return n=wn(),n.memoizedState=n.baseState=t,i={pending:null,lanes:0,dispatch:null,lastRenderedReducer:Xy,lastRenderedState:t},n.queue=i,n=rS.bind(null,Yt,i),i.dispatch=n,i=qp(!1),s=l0.bind(null,Yt,!1,i.queue),i=wn(),a={state:t,dispatch:null,action:e,pending:null},i.queue=a,n=ZE.bind(null,Yt,a,s,n),a.dispatch=n,i.memoizedState=e,[t,n,!1]}function U_(e){var t=ke();return Wy(t,Me,e)}function Wy(e,t,n){if(t=i0(e,t,Xy)[0],e=yu(Ma)[0],typeof t=="object"&&t!==null&&typeof t.then=="function")try{var i=Zl(t)}catch(r){throw r===go?gf:r}else i=t;t=ke();var a=t.queue,s=a.dispatch;return n!==t.memoizedState&&(Yt.flags|=2048,io(9,{destroy:void 0},JE.bind(null,a,n),null)),[i,s,e]}function JE(e,t){e.action=t}function L_(e){var t=ke(),n=Me;if(n!==null)return Wy(t,n,e);ke(),t=t.memoizedState,n=ke();var i=n.queue.dispatch;return n.memoizedState=e,[t,i,!1]}function io(e,t,n,i){return e={tag:e,create:n,deps:i,inst:t,next:null},t=Yt.updateQueue,t===null&&(t=vf(),Yt.updateQueue=t),n=t.lastEffect,n===null?t.lastEffect=e.next=e:(i=n.next,n.next=e,e.next=i,t.lastEffect=e),e}function qy(){return ke().memoizedState}function Su(e,t,n,i){var a=wn();Yt.flags|=e,a.memoizedState=io(1|t,{destroy:void 0},n,i===void 0?null:i)}function xf(e,t,n,i){var a=ke();i=i===void 0?null:i;var s=a.memoizedState.inst;Me!==null&&i!==null&&Qm(i,Me.memoizedState.deps)?a.memoizedState=io(t,s,n,i):(Yt.flags|=e,a.memoizedState=io(1|t,s,n,i))}function O_(e,t){Su(8390656,8,e,t)}function a0(e,t){xf(2048,8,e,t)}function KE(e){Yt.flags|=4;var t=Yt.updateQueue;if(t===null)t=vf(),Yt.updateQueue=t,t.events=[e];else{var n=t.events;n===null?t.events=[e]:n.push(e)}}function Yy(e){var t=ke().memoizedState;return KE({ref:t,nextImpl:e}),function(){if((fe&2)!==0)throw Error(nt(440));return t.impl.apply(void 0,arguments)}}function Zy(e,t){return xf(4,2,e,t)}function Jy(e,t){return xf(4,4,e,t)}function Ky(e,t){if(typeof t=="function"){e=e();var n=t(e);return function(){typeof n=="function"?n():t(null)}}if(t!=null)return e=e(),t.current=e,function(){t.current=null}}function Qy(e,t,n){n=n!=null?n.concat([e]):null,xf(4,4,Ky.bind(null,t,e),n)}function s0(){}function jy(e,t){var n=ke();t=t===void 0?null:t;var i=n.memoizedState;return t!==null&&Qm(t,i[1])?i[0]:(n.memoizedState=[e,t],e)}function $y(e,t){var n=ke();t=t===void 0?null:t;var i=n.memoizedState;if(t!==null&&Qm(t,i[1]))return i[0];if(i=e(),js){qa(!0);try{e()}finally{qa(!1)}}return n.memoizedState=[i,t],i}function r0(e,t,n){return n===void 0||(Sa&1073741824)!==0&&(ae&261930)===0?e.memoizedState=t:(e.memoizedState=n,e=WS(),Yt.lanes|=e,hs|=e,n)}function tS(e,t,n,i){return jn(n,t)?n:us.current!==null?(e=r0(e,n,i),jn(e,t)||(Ze=!0),e):(Sa&106)===0||(Sa&1073741824)!==0&&(ae&261930)===0?(Ze=!0,e.memoizedState=n):(e=WS(),Yt.lanes|=e,hs|=e,t)}function eS(e,t,n,i,a){var s=he.p;he.p=s!==0&&8>s?s:8;var r=Ht.T,o={};o.types=r!==null?r.types:null,Ht.T=o,l0(e,!1,t,n);try{var l=a(),c=Ht.S;if(c!==null&&c(o,l),l!==null&&typeof l=="object"&&typeof l.then=="function"){var f=WE(l,i);xl(e,t,f,Qn(e))}else xl(e,t,i,Qn(e))}catch(p){xl(e,t,{then:function(){},status:"rejected",reason:p},Qn())}finally{he.p=s,r!==null&&o.types!==null&&(r.types=o.types),Ht.T=r}}function QE(){}function Zp(e,t,n,i){if(e.tag!==5)throw Error(nt(476));var a=nS(e).queue;eS(e,a,t,Gs,n===null?QE:function(){return iS(e),n(i)})}function nS(e){var t=e.memoizedState;if(t!==null)return t;t={memoizedState:Gs,baseState:Gs,baseQueue:null,queue:{pending:null,lanes:0,dispatch:null,lastRenderedReducer:Ma,lastRenderedState:Gs},next:null};var n={};return t.next={memoizedState:n,baseState:n,baseQueue:null,queue:{pending:null,lanes:0,dispatch:null,lastRenderedReducer:Ma,lastRenderedState:n},next:null},e.memoizedState=t,e=e.alternate,e!==null&&(e.memoizedState=t),t}function iS(e){var t=nS(e);t.next===null&&(t=e.alternate.memoizedState),xl(e,t.next.queue,{},Qn())}function o0(){return un(uo)}function aS(){return ke().memoizedState}function sS(){return ke().memoizedState}function jE(e){for(var t=e.return;t!==null;){switch(t.tag){case 24:case 3:var n=Qn();e=ts(n);var i=es(t,e,n);i!==null&&(In(i,t,n),gl(i,t,n)),t={cache:Wm()},e.payload=t;return}t=t.return}}function $E(e,t,n){var i=Qn();n={lane:i,revertLane:0,gesture:null,action:n,hasEagerState:!1,eagerState:null,next:null},yf(e)?oS(t,n):(n=Gm(e,t,n,i),n!==null&&(In(n,e,i),lS(n,t,i)))}function rS(e,t,n){var i=Qn();xl(e,t,n,i)}function xl(e,t,n,i){var a={lane:i,revertLane:0,gesture:null,action:n,hasEagerState:!1,eagerState:null,next:null};if(yf(e))oS(t,a);else{var s=e.alternate;if(e.lanes===0&&(s===null||s.lanes===0)&&(s=t.lastRenderedReducer,s!==null))try{var r=t.lastRenderedState,o=s(r,n);if(a.hasEagerState=!0,a.eagerState=o,jn(o,r))return pf(e,t,a,0),Ee===null&&df(),!1}catch{}if(n=Gm(e,t,a,i),n!==null)return In(n,e,i),lS(n,t,i),!0}return!1}function l0(e,t,n,i){if(i={lane:2,revertLane:x0(),gesture:null,action:i,hasEagerState:!1,eagerState:null,next:null},yf(e)){if(t)throw Error(nt(479))}else t=Gm(e,n,i,2),t!==null&&In(t,e,2)}function yf(e){var t=e.alternate;return e===Yt||t!==null&&t===Yt}function oS(e,t){Jr=Wu=!0;var n=e.pending;n===null?t.next=t:(t.next=n.next,n.next=t),e.pending=t}function lS(e,t,n){if((n&4194048)!==0){var i=t.lanes;i&=e.pendingLanes,n|=i,t.lanes=n,qx(e,n)}}var Yu={readContext:un,use:_f,useCallback:He,useContext:He,useEffect:He,useImperativeHandle:He,useLayoutEffect:He,useInsertionEffect:He,useMemo:He,useReducer:He,useRef:He,useState:He,useDebugValue:He,useDeferredValue:He,useTransition:He,useSyncExternalStore:He,useId:He,useHostTransitionStatus:He,useFormState:He,useActionState:He,useOptimistic:He,useMemoCache:He,useCacheRefresh:He,useEffectEvent:He},cS={readContext:un,use:_f,useCallback:function(e,t){return wn().memoizedState=[e,t===void 0?null:t],e},useContext:un,useEffect:O_,useImperativeHandle:function(e,t,n){n=n!=null?n.concat([e]):null,Su(4194308,4,Ky.bind(null,t,e),n)},useLayoutEffect:function(e,t){return Su(4194308,4,e,t)},useInsertionEffect:function(e,t){Su(4,2,e,t)},useMemo:function(e,t){var n=wn();t=t===void 0?null:t;var i=e();if(js){qa(!0);try{e()}finally{qa(!1)}}return n.memoizedState=[i,t],i},useReducer:function(e,t,n){var i=wn();if(n!==void 0){var a=n(t);if(js){qa(!0);try{n(t)}finally{qa(!1)}}}else a=t;return i.memoizedState=i.baseState=a,e={pending:null,lanes:0,dispatch:null,lastRenderedReducer:e,lastRenderedState:a},i.queue=e,e=e.dispatch=$E.bind(null,Yt,e),[i.memoizedState,e]},useRef:function(e){var t=wn();return e={current:e},t.memoizedState=e},useState:function(e){e=qp(e);var t=e.queue,n=rS.bind(null,Yt,t);return t.dispatch=n,[e.memoizedState,n]},useDebugValue:s0,useDeferredValue:function(e,t){var n=wn();return r0(n,e,t)},useTransition:function(){var e=qp(!1);return e=eS.bind(null,Yt,e.queue,!0,!1),wn().memoizedState=e,[!1,e]},useSyncExternalStore:function(e,t,n){var i=Yt,a=wn();if(Qt){if(n===void 0)throw Error(nt(407));n=n()}else{if(n=t(),Ee===null)throw Error(nt(349));(ae&127)!==0||Py(i,t,n)}a.memoizedState=n;var s={value:n,getSnapshot:t};return a.queue=s,O_(zy.bind(null,i,s,e),[e]),i.flags|=2048,io(9,{destroy:void 0},By.bind(null,i,s,n,t),null),n},useId:function(){var e=wn(),t=Ee.identifierPrefix;if(Qt){var n=Ki,i=Ji;n=(i&~(1<<32-Kn(i)-1)).toString(32)+n,t="_"+t+"R_"+n,n=qu++,0<n&&(t+="H"+n.toString(32)),t+="_"}else n=qE++,t="_"+t+"r_"+n.toString(32)+"_";return e.memoizedState=t},useHostTransitionStatus:o0,useFormState:N_,useActionState:N_,useOptimistic:function(e){var t=wn();t.memoizedState=t.baseState=e;var n={pending:null,lanes:0,dispatch:null,lastRenderedReducer:null,lastRenderedState:null};return t.queue=n,t=l0.bind(null,Yt,!0,n),n.dispatch=t,[e,t]},useMemoCache:n0,useCacheRefresh:function(){return wn().memoizedState=jE.bind(null,Yt)},useEffectEvent:function(e){var t=wn(),n={impl:e};return t.memoizedState=n,function(){if((fe&2)!==0)throw Error(nt(440));return n.impl.apply(void 0,arguments)}}},uS={readContext:un,use:_f,useCallback:jy,useContext:un,useEffect:a0,useImperativeHandle:Qy,useInsertionEffect:Zy,useLayoutEffect:Jy,useMemo:$y,useReducer:yu,useRef:qy,useState:function(){return yu(Ma)},useDebugValue:s0,useDeferredValue:function(e,t){var n=ke();return tS(n,Me.memoizedState,e,t)},useTransition:function(){var e=yu(Ma)[0],t=ke().memoizedState;return[typeof e=="boolean"?e:Zl(e),t]},useSyncExternalStore:Iy,useId:aS,useHostTransitionStatus:o0,useFormState:U_,useActionState:U_,useOptimistic:function(e,t){var n=ke();return Vy(n,Me,e,t)},useMemoCache:n0,useCacheRefresh:sS,useEffectEvent:Yy},tA={readContext:un,use:_f,useCallback:jy,useContext:un,useEffect:a0,useImperativeHandle:Qy,useInsertionEffect:Zy,useLayoutEffect:Jy,useMemo:$y,useReducer:ap,useRef:qy,useState:function(){return ap(Ma)},useDebugValue:s0,useDeferredValue:function(e,t){var n=ke();return Me===null?r0(n,e,t):tS(n,Me.memoizedState,e,t)},useTransition:function(){var e=ap(Ma)[0],t=ke().memoizedState;return[typeof e=="boolean"?e:Zl(e),t]},useSyncExternalStore:Iy,useId:aS,useHostTransitionStatus:o0,useFormState:L_,useActionState:L_,useOptimistic:function(e,t){var n=ke();return Me!==null?Vy(n,Me,e,t):(n.baseState=e,[e,n.queue.dispatch])},useMemoCache:n0,useCacheRefresh:sS,useEffectEvent:Yy};function sp(e,t,n,i){t=e.memoizedState,n=n(i,t),n=n==null?t:Ae({},t,n),e.memoizedState=n,e.lanes===0&&(e.updateQueue.baseState=n)}var Jp={enqueueSetState:function(e,t,n){e=e._reactInternals;var i=Qn(),a=ts(i);a.payload=t,n!=null&&(a.callback=n),t=es(e,a,i),t!==null&&(In(t,e,i),gl(t,e,i))},enqueueReplaceState:function(e,t,n){e=e._reactInternals;var i=Qn(),a=ts(i);a.tag=1,a.payload=t,n!=null&&(a.callback=n),t=es(e,a,i),t!==null&&(In(t,e,i),gl(t,e,i))},enqueueForceUpdate:function(e,t){e=e._reactInternals;var n=Qn(),i=ts(n);i.tag=2,t!=null&&(i.callback=t),t=es(e,i,n),t!==null&&(In(t,e,n),gl(t,e,n))}};function I_(e,t,n,i,a,s,r){return e=e.stateNode,typeof e.shouldComponentUpdate=="function"?e.shouldComponentUpdate(i,s,r):t.prototype&&t.prototype.isPureReactComponent?!Cl(n,i)||!Cl(a,s):!0}function P_(e,t,n,i){e=t.state,typeof t.componentWillReceiveProps=="function"&&t.componentWillReceiveProps(n,i),typeof t.UNSAFE_componentWillReceiveProps=="function"&&t.UNSAFE_componentWillReceiveProps(n,i),t.state!==e&&Jp.enqueueReplaceState(t,t.state,null)}function $s(e,t){var n=t;if("ref"in t){n={};for(var i in t)i!=="ref"&&(n[i]=t[i])}if(e=e.defaultProps){n===t&&(n=Ae({},n));for(var a in e)n[a]===void 0&&(n[a]=e[a])}return n}function fS(e){Bu(e)}function hS(e){console.error(e)}function dS(e){Bu(e)}function Zu(e,t){try{var n=e.onUncaughtError;n(t.value,{componentStack:t.stack})}catch(i){setTimeout(function(){throw i})}}function B_(e,t,n){try{var i=e.onCaughtError;i(n.value,{componentStack:n.stack,errorBoundary:t.tag===1?t.stateNode:null})}catch(a){setTimeout(function(){throw a})}}function Kp(e,t,n){return n=ts(n),n.tag=3,n.payload={element:null},n.callback=function(){Zu(e,t)},n}function pS(e){return e=ts(e),e.tag=3,e}function mS(e,t,n,i){var a=n.type.getDerivedStateFromError;if(typeof a=="function"){var s=i.value;e.payload=function(){return a(s)},e.callback=function(){B_(t,n,i)}}var r=n.stateNode;r!==null&&typeof r.componentDidCatch=="function"&&(e.callback=function(){B_(t,n,i),typeof a!="function"&&(as===null?as=new Set([this]):as.add(this));var o=i.stack;this.componentDidCatch(i.value,{componentStack:o!==null?o:""})})}function eA(e,t,n,i,a){if(n.flags|=32768,i!==null&&typeof i=="object"&&typeof i.then=="function"){if(t=n.alternate,t!==null&&Zs(t,n,a,!0),n=pn.current,n!==null){switch(n.tag){case 31:case 13:case 19:return xn===null?nf():n.alternate===null&&Ve===0&&(Ve=3),n.flags&=-257,n.flags|=65536,n.lanes=a,i===Gu?n.flags|=16384:(t=n.updateQueue,t===null?n.updateQueue=new Set([i]):t.add(i),hp(e,i,a)),!1;case 22:return n.flags|=65536,i===Gu?n.flags|=16384:(t=n.updateQueue,t===null?(t={transitions:null,markerInstances:null,retryQueue:new Set([i])},n.updateQueue=t):(n=t.retryQueue,n===null?t.retryQueue=new Set([i]):n.add(i)),hp(e,i,a)),!1}throw Error(nt(435,n.tag))}return hp(e,i,a),nf(),!1}if(Qt)return t=pn.current,t!==null?((t.flags&65536)===0&&(t.flags|=256),t.flags|=65536,t.lanes=a,i!==zp&&(e=Error(nt(422),{cause:i}),Dl(hi(e,n)))):(i!==zp&&(t=Error(nt(423),{cause:i}),Dl(hi(t,n))),e=e.current.alternate,e.flags|=65536,a&=-a,e.lanes|=a,i=hi(i,n),a=Kp(e.stateNode,i,a),ip(e,a),Ve!==4&&(Ve=2)),!1;var s=Error(nt(520),{cause:i});if(s=hi(s,n),bl===null?bl=[s]:bl.push(s),Ve!==4&&(Ve=2),t===null)return!0;i=hi(i,n),n=t;do{switch(n.tag){case 3:return n.flags|=65536,e=a&-a,n.lanes|=e,e=Kp(n.stateNode,i,e),ip(n,e),!1;case 1:if(t=n.type,s=n.stateNode,(n.flags&128)===0&&(typeof t.getDerivedStateFromError=="function"||s!==null&&typeof s.componentDidCatch=="function"&&(as===null||!as.has(s))))return n.flags|=65536,a&=-a,n.lanes|=a,a=pS(a),mS(a,e,n,i),ip(n,a),!1;break;case 22:if(n.memoizedState!==null)return n.flags|=65536,!1}n=n.return}while(n!==null);return!1}var c0=Error(nt(461)),Ze=!1;function Ke(e,t,n,i){t.child=e===null?Ry(t,null,n,i):Qs(t,e.child,n,i)}function z_(e,t,n,i,a){n=n.render;var s=t.ref;if("ref"in i){var r={};for(var o in i)o!=="ref"&&(r[o]=i[o])}else r=i;return Js(t),i=jm(e,t,n,r,s,a),o=$m(),e!==null&&!Ze?(t0(e,t,a),ba(e,t,a)):(Qt&&o&&mf(t),t.flags|=1,Ke(e,t,i,a),t.child)}function F_(e,t,n,i,a){if(e===null){var s=n.type;return typeof s=="function"&&!km(s)&&s.defaultProps===void 0&&n.compare===null?(t.tag=15,t.type=s,gS(e,t,s,i,a)):(e=vu(n.type,null,i,t,t.mode,a),e.ref=t.ref,e.return=t,t.child=e)}if(s=e.child,!f0(e,a)){var r=s.memoizedProps;if(n=n.compare,n=n!==null?n:Cl,n(r,i)&&e.ref===t.ref)return ba(e,t,a)}return t.flags|=1,e=va(s,i),e.ref=t.ref,e.return=t,t.child=e}function gS(e,t,n,i,a){if(e!==null){var s=e.memoizedProps;if(Cl(s,i)&&e.ref===t.ref)if(Ze=!1,t.pendingProps=i=s,f0(e,a))(e.flags&131072)!==0&&(Ze=!0);else return t.lanes=e.lanes,ba(e,t,a)}return Qp(e,t,n,i,a)}function vS(e,t,n,i){var a=i.children,s=e!==null?e.memoizedState:null;if(e===null&&t.stateNode===null&&(t.stateNode={_visibility:1,_pendingMarkers:null,_retryCache:null,_transitions:null}),i.mode==="hidden"){if((t.flags&128)!==0){if(s=s!==null?s.baseLanes|n:n,e!==null){for(i=t.child=e.child,a=0;i!==null;)a=a|i.lanes|i.childLanes,i=i.sibling;i=a&~s}else i=0,t.child=null;return H_(e,t,s,n,i)}if((n&536870912)!==0)t.memoizedState={baseLanes:0,cachePool:null},e!==null&&xu(t,s!==null?s.cachePool:null),s!==null?C_(t,s):Xp(),Uy(t);else return i=t.lanes=536870912,H_(e,t,s!==null?s.baseLanes|n:n,n,i)}else s!==null?(xu(t,s.cachePool),C_(t,s),is(),t.memoizedState=null):(e!==null&&xu(t,null),Xp(),is());return Ke(e,t,a,n),t.child}function yl(e,t){return e!==null&&e.tag===22||t.stateNode!==null||(t.stateNode={_visibility:1,_pendingMarkers:null,_retryCache:null,_transitions:null}),t.sibling}function H_(e,t,n,i,a){var s=qm();return s=s===null?null:{parent:Ye._currentValue,pool:s},t.memoizedState={baseLanes:n,cachePool:s},e!==null&&xu(t,null),Xp(),Uy(t),e!==null&&Zs(e,t,i,!0),t.childLanes=a,null}function Mu(e,t){return t=Sf({mode:t.mode,children:t.children},e.mode),t.ref=e.ref,e.child=t,t.return=e,t}function V_(e,t,n){return Qs(t,e.child,null,n),e=Mu(t,t.pendingProps),e.flags|=2,Wn(t),t.memoizedState=null,e}function nA(e,t,n){var i=t.pendingProps,a=(t.flags&128)!==0;if(t.flags&=-129,e===null){if(Qt){if(i.mode==="hidden")return e=Mu(t,i),t.lanes=536870912,e.memoizedState={baseLanes:0,cachePool:null},yl(null,e);if(Wp(t),(e=Ne)?(e=v1(e,di),e=e!==null&&e.data==="&"?e:null,e!==null&&(t.memoizedState={dehydrated:e,treeContext:ls!==null?{id:Ji,overflow:Ki}:null,retryLane:536870912,hydrationErrors:null},n=My(e),n.return=t,t.child=n,sn=t,Ne=null)):e=null,e===null)throw cs(t);return t.lanes=536870912,null}return Mu(t,i)}var s=e.memoizedState;if(s!==null){var r=s.dehydrated;if(Wp(t),a)if(t.flags&256)t.flags&=-257,t=V_(e,t,n);else if(t.memoizedState!==null)t.child=e.child,t.flags|=128,t=null;else throw Error(nt(558));else if(Ze||Zs(e,t,n,!1),a=(n&e.childLanes)!==0,Ze||a){if(us.current===null){if(i=Ee,i!==null&&(r=Yx(i,n),r!==0&&r!==s.retryLane))throw s.retryLane=r,ar(e,r),In(i,e,r),c0;nf()}t=V_(e,t,n)}else e=s.treeContext,Ne=pi(r.nextSibling),sn=t,Qt=!0,$a=null,di=!1,e!==null&&Ty(t,e),t=Mu(t,i),t.flags|=134221824;return t}return e=va(e.child,{mode:i.mode,children:i.children}),e.ref=t.ref,t.child=e,e.return=t,e}function Rr(e,t){var n=t.ref;if(n===null)e!==null&&e.ref!==null&&(t.flags|=4194816);else{if(typeof n!="function"&&typeof n!="object")throw Error(nt(284));(e===null||e.ref!==n)&&(t.flags|=4194816)}}function Qp(e,t,n,i,a){return Js(t),n=jm(e,t,n,i,void 0,a),i=$m(),e!==null&&!Ze?(t0(e,t,a),ba(e,t,a)):(Qt&&i&&mf(t),t.flags|=1,Ke(e,t,n,a),t.child)}function G_(e,t,n,i,a,s){return Js(t),t.updateQueue=null,n=Oy(t,i,n,a),Ly(e),i=$m(),e!==null&&!Ze?(t0(e,t,s),ba(e,t,s)):(Qt&&i&&mf(t),t.flags|=1,Ke(e,t,n,s),t.child)}function k_(e,t,n,i,a){if(Js(t),t.stateNode===null){var s=Hr,r=n.contextType;typeof r=="object"&&r!==null&&(s=un(r)),s=new n(i,s),t.memoizedState=s.state!==null&&s.state!==void 0?s.state:null,s.updater=Jp,t.stateNode=s,s._reactInternals=t,s=t.stateNode,s.props=i,s.state=t.memoizedState,s.refs={},Zm(t),r=n.contextType,s.context=typeof r=="object"&&r!==null?un(r):Hr,s.state=t.memoizedState,r=n.getDerivedStateFromProps,typeof r=="function"&&(sp(t,n,r,i),s.state=t.memoizedState),typeof n.getDerivedStateFromProps=="function"||typeof s.getSnapshotBeforeUpdate=="function"||typeof s.UNSAFE_componentWillMount!="function"&&typeof s.componentWillMount!="function"||(r=s.state,typeof s.componentWillMount=="function"&&s.componentWillMount(),typeof s.UNSAFE_componentWillMount=="function"&&s.UNSAFE_componentWillMount(),r!==s.state&&Jp.enqueueReplaceState(s,s.state,null),_l(t,i,s,a),vl(),s.state=t.memoizedState),typeof s.componentDidMount=="function"&&(t.flags|=4194308),i=!0}else if(e===null){s=t.stateNode;var o=t.memoizedProps,l=$s(n,o);s.props=l;var c=s.context,f=n.contextType;r=Hr,typeof f=="object"&&f!==null&&(r=un(f));var p=n.getDerivedStateFromProps;f=typeof p=="function"||typeof s.getSnapshotBeforeUpdate=="function",o=t.pendingProps!==o,f||typeof s.UNSAFE_componentWillReceiveProps!="function"&&typeof s.componentWillReceiveProps!="function"||(o||c!==r)&&P_(t,s,i,r),Xa=!1;var u=t.memoizedState;s.state=u,_l(t,i,s,a),vl(),c=t.memoizedState,o||u!==c||Xa?(typeof p=="function"&&(sp(t,n,p,i),c=t.memoizedState),(l=Xa||I_(t,n,l,i,u,c,r))?(f||typeof s.UNSAFE_componentWillMount!="function"&&typeof s.componentWillMount!="function"||(typeof s.componentWillMount=="function"&&s.componentWillMount(),typeof s.UNSAFE_componentWillMount=="function"&&s.UNSAFE_componentWillMount()),typeof s.componentDidMount=="function"&&(t.flags|=4194308)):(typeof s.componentDidMount=="function"&&(t.flags|=4194308),t.memoizedProps=i,t.memoizedState=c),s.props=i,s.state=c,s.context=r,i=l):(typeof s.componentDidMount=="function"&&(t.flags|=4194308),i=!1)}else{s=t.stateNode,Gp(e,t),r=t.memoizedProps,f=$s(n,r),s.props=f,p=t.pendingProps,u=s.context,c=n.contextType,l=Hr,typeof c=="object"&&c!==null&&(l=un(c)),o=n.getDerivedStateFromProps,(c=typeof o=="function"||typeof s.getSnapshotBeforeUpdate=="function")||typeof s.UNSAFE_componentWillReceiveProps!="function"&&typeof s.componentWillReceiveProps!="function"||(r!==p||u!==l)&&P_(t,s,i,l),Xa=!1,u=t.memoizedState,s.state=u,_l(t,i,s,a),vl();var d=t.memoizedState;r!==p||u!==d||Xa||e!==null&&e.dependencies!==null&&Vu(e.dependencies)?(typeof o=="function"&&(sp(t,n,o,i),d=t.memoizedState),(f=Xa||I_(t,n,f,i,u,d,l)||e!==null&&e.dependencies!==null&&Vu(e.dependencies))?(c||typeof s.UNSAFE_componentWillUpdate!="function"&&typeof s.componentWillUpdate!="function"||(typeof s.componentWillUpdate=="function"&&s.componentWillUpdate(i,d,l),typeof s.UNSAFE_componentWillUpdate=="function"&&s.UNSAFE_componentWillUpdate(i,d,l)),typeof s.componentDidUpdate=="function"&&(t.flags|=4),typeof s.getSnapshotBeforeUpdate=="function"&&(t.flags|=1024)):(typeof s.componentDidUpdate!="function"||r===e.memoizedProps&&u===e.memoizedState||(t.flags|=4),typeof s.getSnapshotBeforeUpdate!="function"||r===e.memoizedProps&&u===e.memoizedState||(t.flags|=1024),t.memoizedProps=i,t.memoizedState=d),s.props=i,s.state=d,s.context=l,i=f):(typeof s.componentDidUpdate!="function"||r===e.memoizedProps&&u===e.memoizedState||(t.flags|=4),typeof s.getSnapshotBeforeUpdate!="function"||r===e.memoizedProps&&u===e.memoizedState||(t.flags|=1024),i=!1)}return s=i,Rr(e,t),i=(t.flags&128)!==0,s||i?(s=t.stateNode,n=i&&typeof n.getDerivedStateFromError!="function"?null:s.render(),t.flags|=1,e!==null&&i?(t.child=Qs(t,e.child,null,a),t.child=Qs(t,null,n,a)):Ke(e,t,n,a),t.memoizedState=s.state,e=t.child):e=ba(e,t,a),e}function X_(e,t,n,i){return Ys(),t.flags|=256,Ke(e,t,n,i),t.child}var jp={dehydrated:null,treeContext:null,retryLane:0,hydrationErrors:null};function $p(e){return{baseLanes:e,cachePool:Ay()}}function tm(e,t,n){return e=e!==null?e.childLanes&~n:0,t&&(e|=Yn),e}function _S(e,t,n){var i=t.pendingProps,a=!1,s=(t.flags&128)!==0,r;if((r=s)||(r=e!==null&&e.memoizedState===null?!1:(hn.current&2)!==0),r&&(a=!0,t.flags&=-129),r=(t.flags&32)!==0,t.flags&=-33,e===null){if(Qt){if(a?ns(t):is(),(e=Ne)?(e=v1(e,di),e=e!==null&&e.data!=="&"?e:null,e!==null&&(t.memoizedState={dehydrated:e,treeContext:ls!==null?{id:Ji,overflow:Ki}:null,retryLane:536870912,hydrationErrors:null},n=My(e),n.return=t,t.child=n,sn=t,Ne=null)):e=null,e===null)throw cs(t);return b0(e)?t.lanes=32:t.lanes=536870912,null}return s=i.children,i=i.fallback,a?(is(),a=t.mode,s=Sf({mode:"hidden",children:s},a),i=ks(i,a,n,null),s.return=t,i.return=t,s.sibling=i,t.child=s,i=t.child,i.memoizedState=$p(n),i.childLanes=tm(e,r,n),t.memoizedState=jp,yl(null,i)):(ns(t),u0(t,s))}var o=e.memoizedState;if(o!==null){var l=o.dehydrated;if(l!==null)return iA(e,t,s,r,i,l,o,n)}return a?(is(),a=i.fallback,s=t.mode,o=e.child,l=o.sibling,i=va(o,{mode:"hidden",children:i.children}),i.subtreeFlags=o.subtreeFlags&1206910976,l!==null?a=va(l,a):(a=ks(a,s,n,null),a.flags|=2),a.return=t,i.return=t,i.sibling=a,t.child=i,yl(null,i),i=t.child,a=e.child.memoizedState,a===null?a=$p(n):(s=a.cachePool,s!==null?(o=Ye._currentValue,s=s.parent!==o?{parent:o,pool:o}:s):s=Ay(),a={baseLanes:a.baseLanes|n,cachePool:s}),i.memoizedState=a,i.childLanes=tm(e,r,n),t.memoizedState=jp,yl(e.child,i)):(ns(t),n=e.child,e=n.sibling,n=va(n,{mode:"visible",children:i.children}),n.return=t,n.sibling=null,e!==null&&(r=t.deletions,r===null?(t.deletions=[e],t.flags|=16):r.push(e)),t.child=n,t.memoizedState=null,n)}function u0(e,t){return t=Sf({mode:"visible",children:t},e.mode),t.return=e,e.child=t}function Sf(e,t){return e=On(22,e,null,t),e.lanes=0,e}function iu(e,t,n){return Qs(t,e.child,null,n),e=u0(t,t.pendingProps.children),e.flags|=2,t.memoizedState=null,e}function iA(e,t,n,i,a,s,r,o){if(n)return t.flags&256?(ns(t),t.flags&=-257,iu(e,t,o)):t.memoizedState!==null?(is(),t.child=e.child,t.flags|=128,null):(is(),s=a.fallback,r=t.mode,a=Sf({mode:"visible",children:a.children},r),s=ks(s,r,o,null),s.flags|=2,a.return=t,s.return=t,a.sibling=s,t.child=a,Qs(t,e.child,null,o),a=t.child,a.memoizedState=$p(o),a.childLanes=tm(e,i,o),t.memoizedState=jp,yl(null,a));if(ns(t),b0(s)){if(i=s.nextSibling&&s.nextSibling.dataset,i)var l=i.dgst;return i=l,i!==""&&(a=Error(nt(419)),a.stack="",a.digest=i,Dl({value:a,source:null,stack:null})),iu(e,t,o)}if(Ze||Zs(e,t,o,!1),i=(o&e.childLanes)!==0,Ze||i){if(us.current!==null)return iu(e,t,o);if(i=Ee,i!==null&&(a=Yx(i,o),a!==0&&a!==r.retryLane))throw r.retryLane=a,ar(e,a),In(i,e,a),c0;return Em(s)||nf(),iu(e,t,o)}return Em(s)?(t.flags|=192,t.child=e.child,null):(e=r.treeContext,Ne=pi(s.nextSibling),sn=t,Qt=!0,$a=null,di=!1,e!==null&&Ty(t,e),t=u0(t,a.children),t.flags|=134221824,t)}function W_(e,t,n){e.lanes|=t;var i=e.alternate;i!==null&&(i.lanes|=t),_u(e.return,t,n)}function q_(e){for(var t=null;e!==null;){var n=e.alternate;n!==null&&Xu(n)===null&&(t=e),e=e.sibling}return t}function au(e,t,n,i,a,s){var r=e.memoizedState;r===null?e.memoizedState={isBackwards:t,rendering:null,renderingStartTime:0,last:i,tail:n,tailMode:a,treeForkCount:s}:(r.isBackwards=t,r.rendering=null,r.renderingStartTime=0,r.last=i,r.tail=n,r.tailMode=a,r.treeForkCount=s)}function rp(e){var t=e.child;for(e.child=null;t!==null;){var n=t.sibling;t.sibling=e.child,e.child=t,t=n}}function em(e,t,n){var i=t.pendingProps,a=i.revealOrder,s=i.tail;i=i.children;var r=hn.current;if(t.flags&128)return Ul(t,r),null;var o=(r&2)!==0;if(o?(r=r&1|2,t.flags|=128):r&=1,Ul(t,r),a==="backwards"&&e!==null?(rp(e),Ke(e,t,i,n),rp(e)):Ke(e,t,i,n),i=Qt?Rl:0,!o&&e!==null&&(e.flags&128)!==0)t:for(e=t.child;e!==null;){if(e.tag===13)e.memoizedState!==null&&W_(e,n,t);else if(e.tag===19)W_(e,n,t);else if(e.child!==null){e.child.return=e,e=e.child;continue}if(e===t)break t;for(;e.sibling===null;){if(e.return===null||e.return===t)break t;e=e.return}e.sibling.return=e.return,e=e.sibling}switch(a){case"backwards":n=q_(t.child),n===null?(a=t.child,t.child=null):(a=n.sibling,n.sibling=null,rp(t)),au(t,!0,a,null,s,i);break;case"unstable_legacy-backwards":for(n=null,a=t.child,t.child=null;a!==null;){if(e=a.alternate,e!==null&&Xu(e)===null){t.child=a;break}e=a.sibling,a.sibling=n,n=a,a=e}au(t,!0,n,null,s,i);break;case"together":au(t,!1,null,null,void 0,i);break;case"independent":t.memoizedState=null;break;default:n=q_(t.child),n===null?(a=t.child,t.child=null):(a=n.sibling,n.sibling=null),au(t,!1,a,n,s,i)}return t.child}function Y_(e,t,n){var i=t.pendingProps;return Za(t,t.type,i.value),Ke(e,t,i.children,n),t.child}function ba(e,t,n){if(e!==null&&(t.dependencies=e.dependencies),hs|=t.lanes,(n&t.childLanes)===0)if(e!==null){if(Zs(e,t,n,!1),(n&t.childLanes)===0)return null}else return null;if(e!==null&&t.child!==e.child)throw Error(nt(153));if(t.child!==null){for(e=t.child,n=va(e,e.pendingProps),t.child=n,n.return=t;e.sibling!==null;)e=e.sibling,n=n.sibling=va(e,e.pendingProps),n.return=t;n.sibling=null}return t.child}function f0(e,t){return(e.lanes&t)!==0?!0:(e=e.dependencies,!!(e!==null&&Vu(e)))}function aA(e,t,n){switch(t.tag){case 3:Lu(t,t.stateNode.containerInfo),Za(t,Ye,e.memoizedState.cache),Ys();break;case 27:case 5:Cp(t);break;case 4:Lu(t,t.stateNode.containerInfo);break;case 10:Za(t,t.type,t.memoizedProps.value);break;case 31:if(t.memoizedState!==null)return t.flags|=128,Wp(t),null;break;case 13:var i=t.memoizedState;if(i!==null){if(i.dehydrated!==null)return ns(t),t.flags|=128,null;i=Zs(e,t,n,!1);var a=t.child.childLanes;return i||(n&a)!==0?_S(e,t,n):(ns(t),e=ba(e,t,n),e!==null?e.sibling:null)}ns(t);break;case 19:if(t.flags&128)return em(e,t,n);if(a=(e.flags&128)!==0,i=(n&t.childLanes)!==0,i||(Zs(e,t,n,!1),i=(n&t.childLanes)!==0),a){if(i)return em(e,t,n);t.flags|=128}if(a=t.memoizedState,a!==null&&(a.rendering=null,a.tail=null,a.lastEffect=null),Ul(t,hn.current),i)break;return null;case 22:return t.lanes=0,vS(e,t,n,t.pendingProps);case 24:Za(t,Ye,e.memoizedState.cache)}return ba(e,t,n)}function xS(e,t,n){if(e!==null)if(e.memoizedProps!==t.pendingProps)Ze=!0;else{if(!f0(e,n)&&(t.flags&128)===0)return Ze=!1,aA(e,t,n);Ze=(e.flags&131072)!==0}else Ze=!1,Qt&&(t.flags&1048576)!==0&&by(t,Rl,t.index);switch(t.lanes=0,t.tag){case 16:t:{var i=t.pendingProps;if(e=zs(t.elementType),t.type=e,typeof e=="function")km(e)?(i=$s(e,i),t.tag=1,t=k_(null,t,e,i,n)):(t.tag=0,t=Qp(null,t,e,i,n));else{if(e!=null){var a=e.$$typeof;if(a===Dm){t.tag=11,t=z_(null,t,e,i,n);break t}else if(a===Nm){t.tag=14,t=F_(null,t,e,i,n);break t}else if(a===Yi){t.tag=10,t.type=e,t=Y_(null,t,n);break t}}throw t=Ap(e)||e,Error(nt(306,t,""))}}return t;case 0:return Qp(e,t,t.type,t.pendingProps,n);case 1:return i=t.type,a=$s(i,t.pendingProps),k_(e,t,i,a,n);case 3:t:{if(Lu(t,t.stateNode.containerInfo),e===null)throw Error(nt(387));i=t.pendingProps;var s=t.memoizedState;a=s.element,Gp(e,t),_l(t,i,null,n);var r=t.memoizedState;if(i=r.cache,Za(t,Ye,i),i!==s.cache&&Hp(t,[Ye],n,!0),vl(),i=r.element,s.isDehydrated)if(s={element:i,isDehydrated:!1,cache:r.cache},t.updateQueue.baseState=s,t.memoizedState=s,t.flags&256){t=X_(e,t,i,n);break t}else if(i!==a){a=hi(Error(nt(424)),t),Dl(a),t=X_(e,t,i,n);break t}else for(e=t.stateNode.containerInfo,e.nodeType===9?e=e.body:e=e.nodeName==="HTML"?e.ownerDocument.body:e,Ne=pi(e.firstChild),sn=t,Qt=!0,$a=null,di=!0,n=Ry(t,null,i,n),t.child=n;n;)n.flags=n.flags&-3|134221824,n=n.sibling;else{if(Ys(),i===a){t=ba(e,t,n);break t}Ke(e,t,i,n)}t=t.child}return t;case 26:return Rr(e,t),e===null?(n=yx(t.type,null,t.pendingProps,null))?t.memoizedState=n:Qt||(t.stateNode=l1(t.type,t.pendingProps,ja.current,t)):t.memoizedState=yx(t.type,e.memoizedProps,t.pendingProps,e.memoizedState),null;case 27:return Cp(t),e===null&&Qt&&(i=t.stateNode=_1(t.type,t.pendingProps,ja.current),sn=t,di=!0,a=Ne,ps(t.type)?(Am=a,Ne=pi(i.firstChild)):Ne=a),Ke(e,t,t.pendingProps.children,n),Rr(e,t),e===null&&(t.flags|=4194304),t.child;case 5:return e===null&&Qt&&((a=i=Ne)&&(i=KA(i,t.type,t.pendingProps,di),i!==null?(t.stateNode=i,sn=t,Ne=pi(i.firstChild),di=!1,a=!0):a=!1),a||cs(t)),Cp(t),a=t.type,s=t.pendingProps,r=e!==null?e.memoizedProps:null,i=s.children,Mm(a,s)?i=null:r!==null&&Mm(a,r)&&(t.flags|=32),t.memoizedState!==null&&(a=jm(e,t,YE,null,null,n),uo._currentValue=a),Rr(e,t),Ke(e,t,i,n),t.child;case 6:return e===null&&Qt&&((e=n=Ne)&&(n=QA(n,t.pendingProps,di),n!==null?(t.stateNode=n,sn=t,Ne=null,e=!0):e=!1),e||cs(t)),null;case 13:return _S(e,t,n);case 4:return Lu(t,t.stateNode.containerInfo),i=t.pendingProps,e===null?t.child=Qs(t,null,i,n):Ke(e,t,i,n),t.child;case 11:return z_(e,t,t.type,t.pendingProps,n);case 7:return i=t.pendingProps,Rr(e,t),Ke(e,t,i,n),t.child;case 8:return Ke(e,t,t.pendingProps.children,n),t.child;case 12:return Ke(e,t,t.pendingProps.children,n),t.child;case 10:return Y_(e,t,n);case 9:return a=t.type._context,i=t.pendingProps.children,Js(t),a=un(a),i=i(a),t.flags|=1,Ke(e,t,i,n),t.child;case 14:return F_(e,t,t.type,t.pendingProps,n);case 15:return gS(e,t,t.type,t.pendingProps,n);case 19:return em(e,t,n);case 31:return nA(e,t,n);case 22:return vS(e,t,n,t.pendingProps);case 24:return Js(t),i=un(Ye),e===null?(a=qm(),a===null&&(a=Ee,s=Wm(),a.pooledCache=s,s.refCount++,s!==null&&(a.pooledCacheLanes|=n),a=s),t.memoizedState={parent:i,cache:a},Zm(t),Za(t,Ye,a)):((e.lanes&n)!==0&&(Gp(e,t),_l(t,null,null,n),vl()),a=e.memoizedState,s=t.memoizedState,a.parent!==i?(a={parent:i,cache:i},t.memoizedState=a,t.lanes===0&&(t.memoizedState=t.updateQueue.baseState=a),Za(t,Ye,i)):(i=s.cache,Za(t,Ye,i),i!==a.cache&&Hp(t,[Ye],n,!0))),Ke(e,t,t.pendingProps.children,n),t.child;case 30:return t.stateNode===null&&(t.stateNode={autoName:null,paired:null,clones:null,ref:null}),i=t.pendingProps,i.name!=null&&i.name!=="auto"?t.flags|=e===null?18882560:18874368:Qt&&mf(t),e!==null&&e.memoizedProps.name!==i.name?t.flags|=4194816:Rr(e,t),Ke(e,t,i.children,n),t.child;case 29:throw t.pendingProps}throw Error(nt(156,t.tag))}function pa(e){e.flags|=4}function op(e,t,n,i,a){var s;if((s=(e.mode&32)!==0)&&(s=n===null?bx(t,i):bx(t,i)&&(i.src!==n.src||i.srcSet!==n.srcSet)),s){if(e.flags|=16777216,(a&335544128)===a)if(e.stateNode.complete)e.flags|=8192;else if(ZS())e.flags|=8192;else throw Ws=Gu,Ym}else e.flags&=-16777217}function Z_(e,t){if(t.type!=="stylesheet"||(t.state.loading&4)!==0)e.flags&=-16777217;else if(e.flags|=16777216,!M1(t))if(ZS())e.flags|=8192;else throw Ws=Gu,Ym}function su(e,t){t!==null&&(e.flags|=4),e.flags&16384&&(t=e.tag!==22?Xx():536870912,e.lanes|=t,ao|=t)}function il(e,t){if(!Qt)switch(e.tailMode){case"visible":break;case"collapsed":for(var n=e.tail,i=null;n!==null;)n.alternate!==null&&(i=n),n=n.sibling;i===null?t||e.tail===null?e.tail=null:e.tail.sibling=null:i.sibling=null;break;default:for(t=e.tail,n=null;t!==null;)t.alternate!==null&&(n=t),t=t.sibling;n===null?e.tail=null:n.sibling=null}}function De(e){var t=e.alternate!==null&&e.alternate.child===e.child,n=0,i=0;if(t)for(var a=e.child;a!==null;)n|=a.lanes|a.childLanes,i|=a.subtreeFlags&1206910976,i|=a.flags&1206910976,a.return=e,a=a.sibling;else for(a=e.child;a!==null;)n|=a.lanes|a.childLanes,i|=a.subtreeFlags,i|=a.flags,a.return=e,a=a.sibling;return e.subtreeFlags|=i,e.childLanes=n,t}function sA(e,t,n){var i=t.pendingProps;switch(Xm(t),t.tag){case 16:case 15:case 0:case 11:case 7:case 8:case 12:case 9:case 14:return De(t),null;case 1:return De(t),null;case 3:return n=t.stateNode,i=null,e!==null&&(i=e.memoizedState.cache),t.memoizedState.cache!==i&&(t.flags|=2048),_a(Ye),to(),n.pendingContext&&(n.context=n.pendingContext,n.pendingContext=null),(e===null||e.child===null)&&(wr(t)?pa(t):e===null||e.memoizedState.isDehydrated&&(t.flags&256)===0||(t.flags|=1024,np())),De(t),null;case 26:var a=t.type,s=t.memoizedState;return e===null?(pa(t),s!==null?(De(t),Z_(t,s)):(De(t),op(t,a,null,i,n))):s?s!==e.memoizedState?(pa(t),De(t),Z_(t,s)):(De(t),t.flags&=-16777217):(e=e.memoizedProps,e!==i&&pa(t),De(t),op(t,a,e,i,n)),null;case 27:if(Ou(t),n=ja.current,a=t.type,e!==null&&t.stateNode!=null)e.memoizedProps!==i&&pa(t);else{if(!i){if(t.stateNode===null)throw Error(nt(166));return De(t),t.subtreeFlags&=-33554433,null}e=Qi.current,wr(t)?S_(t,e):(e=_1(a,i,n),t.stateNode=e,pa(t))}return De(t),t.subtreeFlags&=-33554433,null;case 5:if(Ou(t),a=t.type,e!==null&&t.stateNode!=null)e.memoizedProps!==i&&pa(t);else{if(!i){if(t.stateNode===null)throw Error(nt(166));return De(t),t.subtreeFlags&=-33554433,null}if(s=Qi.current,wr(t))S_(t,s);else{var r=Pl(ja.current);switch(s){case 1:s=r.createElementNS("http://www.w3.org/2000/svg",a);break;case 2:s=r.createElementNS("http://www.w3.org/1998/Math/MathML",a);break;default:switch(a){case"svg":s=r.createElementNS("http://www.w3.org/2000/svg",a);break;case"math":s=r.createElementNS("http://www.w3.org/1998/Math/MathML",a);break;case"script":s=r.createElement("div"),s.innerHTML="<script><\/script>",s=s.removeChild(s.firstChild);break;case"select":s=typeof i.is=="string"?r.createElement("select",{is:i.is}):r.createElement("select"),i.multiple?s.multiple=!0:i.size&&(s.size=i.size);break;default:s=typeof i.is=="string"?r.createElement(a,{is:i.is}):r.createElement(a)}}s[cn]=t,s[Bn]=i;t:for(r=t.child;r!==null;){if(r.tag===5||r.tag===6)s.appendChild(r.stateNode);else if(r.tag!==4&&r.tag!==27&&r.child!==null){r.child.return=r,r=r.child;continue}if(r===t)break t;for(;r.sibling===null;){if(r.return===null||r.return===t)break t;r=r.return}r.sibling.return=r.return,r=r.sibling}t.stateNode=s;t:switch(dn(s,a,i),a){case"button":case"input":case"select":case"textarea":i=!!i.autoFocus;break t;case"img":i=!0;break t;default:i=!1}i&&pa(t)}}return De(t),t.subtreeFlags&=-33554433,op(t,t.type,e===null?null:e.memoizedProps,t.pendingProps,n),null;case 6:if(e&&t.stateNode!=null)e.memoizedProps!==i&&pa(t);else{if(typeof i!="string"&&t.stateNode===null)throw Error(nt(166));if(e=ja.current,wr(t)){if(e=t.stateNode,n=t.memoizedProps,i=null,a=sn,a!==null)switch(a.tag){case 27:case 5:i=a.memoizedProps}e[cn]=t,e=!!(e.nodeValue===n||i!==null&&i.suppressHydrationWarning===!0||r1(e.nodeValue,n)),e||cs(t,!0)}else e=Pl(e).createTextNode(i),e[cn]=t,t.stateNode=e}return De(t),null;case 31:if(n=t.memoizedState,e===null||e.memoizedState!==null){if(i=wr(t),n!==null){if(e===null){if(!i)throw Error(nt(318));if(e=t.memoizedState,e=e!==null?e.dehydrated:null,!e)throw Error(nt(557));e[cn]=t}else Ys(),(t.flags&128)===0&&(t.memoizedState=null),t.flags|=4;De(t),e=!1}else n=np(),e!==null&&e.memoizedState!==null&&(e.memoizedState.hydrationErrors=n),e=!0;if(!e)return t.flags&256?(Wn(t),t):(Wn(t),null);if((t.flags&128)!==0)throw Error(nt(558))}return De(t),null;case 13:if(i=t.memoizedState,e===null||e.memoizedState!==null&&e.memoizedState.dehydrated!==null){if(a=wr(t),i!==null&&i.dehydrated!==null){if(e===null){if(!a)throw Error(nt(318));if(a=t.memoizedState,a=a!==null?a.dehydrated:null,!a)throw Error(nt(317));a[cn]=t}else Ys(),(t.flags&128)===0&&(t.memoizedState=null),t.flags|=4;De(t),a=!1}else a=np(),e!==null&&e.memoizedState!==null&&(e.memoizedState.hydrationErrors=a),a=!0;if(!a)return t.flags&256?(Wn(t),t):(Wn(t),null)}return Wn(t),(t.flags&128)!==0?(t.lanes=n,t):(n=i!==null,e=e!==null&&e.memoizedState!==null,n&&(i=t.child,a=null,i.alternate!==null&&i.alternate.memoizedState!==null&&i.alternate.memoizedState.cachePool!==null&&(a=i.alternate.memoizedState.cachePool.pool),s=null,i.memoizedState!==null&&i.memoizedState.cachePool!==null&&(s=i.memoizedState.cachePool.pool),s!==a&&(i.flags|=2048)),n!==e&&n&&(t.child.flags|=8192),su(t,t.updateQueue),De(t),null);case 4:return to(),e===null&&y0(t.stateNode.containerInfo),t.flags|=67108864,De(t),null;case 10:return _a(t.type),De(t),null;case 19:if(Km(t),i=t.memoizedState,i===null)return De(t),null;if(a=(t.flags&128)!==0,s=i.rendering,s===null)if(a)il(i,!1);else{if(Ve!==0||e!==null&&(e.flags&128)!==0)for(e=t.child;e!==null;){if(s=Xu(e),s!==null){for(t.flags|=128,il(i,!1),e=s.updateQueue,t.updateQueue=e,su(t,e),t.subtreeFlags=0,e=n,n=t.child;n!==null;)Sy(n,e),n=n.sibling;return Ul(t,hn.current&1|2),Qt&&ma(t,i.treeForkCount),t.child}e=e.sibling}i.tail!==null&&Zn()>tf&&(t.flags|=128,a=!0,il(i,!1),t.lanes=4194304)}else{if(!a)if(e=Xu(s),e!==null){if(t.flags|=128,a=!0,e=e.updateQueue,t.updateQueue=e,su(t,e),il(i,!0),i.tail===null&&i.tailMode!=="collapsed"&&i.tailMode!=="visible"&&!s.alternate&&!Qt)return De(t),null}else 2*Zn()-i.renderingStartTime>tf&&n!==536870912&&(t.flags|=128,a=!0,il(i,!1),t.lanes=4194304);i.isBackwards?(s.sibling=t.child,t.child=s):(e=i.last,e!==null?e.sibling=s:t.child=s,i.last=s)}if(i.tail!==null){e=i.tail;t:{for(n=e;n!==null;){if(n.alternate!==null){n=!1;break t}n=n.sibling}n=!0}return i.rendering=e,i.tail=e.sibling,i.renderingStartTime=Zn(),e.sibling=null,s=hn.current,s=a?s&1|2:s&1,i.tailMode==="visible"||i.tailMode==="collapsed"||!n||Qt?Ul(t,s):(n=s,Ue(pn,t),Ue(hn,n),xn===null&&(xn=t)),Qt&&ma(t,i.treeForkCount),e}return De(t),null;case 22:case 23:return Wn(t),Jm(),i=t.memoizedState!==null,e!==null?e.memoizedState!==null!==i&&(t.flags|=8192):i&&(t.flags|=8192),i?(n&536870912)!==0&&(t.flags&128)===0&&(De(t),t.subtreeFlags&6&&(t.flags|=8192)):De(t),n=t.updateQueue,n!==null&&su(t,n.retryQueue),n=null,e!==null&&e.memoizedState!==null&&e.memoizedState.cachePool!==null&&(n=e.memoizedState.cachePool.pool),i=null,t.memoizedState!==null&&t.memoizedState.cachePool!==null&&(i=t.memoizedState.cachePool.pool),i!==n&&(t.flags|=2048),e!==null&&fn(Xs),null;case 24:return n=null,e!==null&&(n=e.memoizedState.cache),t.memoizedState.cache!==n&&(t.flags|=2048),_a(Ye),De(t),null;case 25:return null;case 30:return t.flags|=33554432,De(t),null}throw Error(nt(156,t.tag))}function rA(e,t){switch(Xm(t),t.tag){case 1:return e=t.flags,e&65536?(t.flags=e&-65537|128,t):null;case 3:return _a(Ye),to(),e=t.flags,(e&65536)!==0&&(e&128)===0?(t.flags=e&-65537|128,t):null;case 26:case 27:case 5:return Ou(t),null;case 31:if(t.memoizedState!==null){if(Wn(t),t.alternate===null)throw Error(nt(340));Ys()}return e=t.flags,e&65536?(t.flags=e&-65537|128,t):null;case 13:if(Wn(t),e=t.memoizedState,e!==null&&e.dehydrated!==null){if(t.alternate===null)throw Error(nt(340));Ys()}return e=t.flags,e&65536?(t.flags=e&-65537|128,t):null;case 19:return Km(t),e=t.flags,e&65536?(t.flags=e&-65537|128,e=t.memoizedState,e!==null&&(e.rendering=null,e.tail=null),t.flags|=4,t):null;case 4:return to(),null;case 10:return _a(t.type),null;case 22:case 23:return Wn(t),Jm(),e!==null&&fn(Xs),e=t.flags,e&65536?(t.flags=e&-65537|128,t):null;case 24:return _a(Ye),null;case 25:return null;default:return null}}function yS(e,t){switch(Xm(t),t.tag){case 3:_a(Ye),to();break;case 26:case 27:case 5:Ou(t);break;case 4:to();break;case 31:t.memoizedState!==null&&Wn(t);break;case 13:Wn(t);break;case 19:Km(t);break;case 10:_a(t.type);break;case 22:case 23:Wn(t),Jm(),e!==null&&fn(Xs);break;case 24:_a(Ye)}}function Jl(e,t){try{var n=t.updateQueue,i=n!==null?n.lastEffect:null;if(i!==null){var a=i.next;n=a;do{if((n.tag&e)===e){i=void 0;var s=n.create,r=n.inst;i=s(),r.destroy=i}n=n.next}while(n!==a)}}catch(o){ye(t,t.return,o)}}function fs(e,t,n){try{var i=t.updateQueue,a=i!==null?i.lastEffect:null;if(a!==null){var s=a.next;i=s;do{if((i.tag&e)===e){var r=i.inst,o=r.destroy;if(o!==void 0){r.destroy=void 0,a=t;var l=n,c=o;try{c()}catch(f){ye(a,l,f)}}}i=i.next}while(i!==s)}}catch(f){ye(t,t.return,f)}}function SS(e){var t=e.updateQueue;if(t!==null){var n=e.stateNode;try{Ny(t,n)}catch(i){ye(e,e.return,i)}}}function MS(e,t,n){n.props=$s(e.type,e.memoizedProps),n.state=e.memoizedState;try{n.componentWillUnmount()}catch(i){ye(e,t,i)}}function Wi(e,t){try{var n=e.ref;if(n!==null){switch(e.tag){case 26:case 27:case 5:var i=e.stateNode;break;case 30:var a=e.stateNode,s=ya(e.memoizedProps,a);(a.ref===null||a.ref.name!==s)&&(a.ref=h1(s)),i=a.ref;break;case 7:if(e.stateNode===null){var r=new $n(e);Pn(e.child,!1,ZA,r,void 0,void 0),e.stateNode=r}i=e.stateNode;break;default:i=e.stateNode}typeof n=="function"?e.refCleanup=n(i):n.current=i}}catch(o){ye(e,t,o)}}function ln(e,t){var n=e.ref,i=e.refCleanup;if(n!==null)if(typeof i=="function")try{i()}catch(a){ye(e,t,a)}finally{e.refCleanup=null,e=e.alternate,e!=null&&(e.refCleanup=null)}else if(typeof n=="function")try{n(null)}catch(a){ye(e,t,a)}else n.current=null}function Ju(e,t){if((e.tag===5||e.tag===27||e.tag===6)&&e.alternate===null&&t!==null)for(var n=0;n<t.length;n++)g1(e.stateNode,t[n])}function J_(e){for(var t=e.return;t!==null&&(d0(t)&&g1(e.stateNode,t.stateNode),!h0(t));)t=t.return}function Sl(e){for(var t=e.return;t!==null&&(d0(t)&&JA(e.stateNode,t.stateNode),!h0(t));)t=t.return}function h0(e){return e.tag===5||e.tag===3||e.tag===27}function d0(e){return e&&e.tag===7&&e.stateNode!==null}function nm(e){var t=e.type,n=e.memoizedProps,i=e.stateNode;try{t:switch(t){case"button":case"input":case"select":case"textarea":n.autoFocus&&i.focus();break t;case"img":n.src?i.src=n.src:n.srcSet&&(i.srcset=n.srcSet)}}catch(a){ye(e,e.return,a)}}function lp(e,t,n){try{var i=e.stateNode;DA(i,e.type,n,t),i[Bn]=t}catch(a){ye(e,e.return,a)}}function bS(e){return e.tag===5||e.tag===3||e.tag===26||e.tag===27&&ps(e.type)||e.tag===4}function cp(e){t:for(;;){for(;e.sibling===null;){if(e.return===null||bS(e.return))return null;e=e.return}for(e.sibling.return=e.return,e=e.sibling;e.tag!==5&&e.tag!==6&&e.tag!==18;){if(e.tag===27&&ps(e.type)||e.flags&2||e.child===null||e.tag===4)continue t;e.child.return=e,e=e.child}if(!(e.flags&2))return e.stateNode}}function im(e,t,n,i){var a=e.tag;if(a===5||a===6)a=e.stateNode,t?(n.nodeType===9?n.body:n.nodeName==="HTML"?n.ownerDocument.body:n).insertBefore(a,t):(t=n.nodeType===9?n.body:n.nodeName==="HTML"?n.ownerDocument.body:n,t.appendChild(a),n=n._reactRootContainer,n!=null||t.onclick!==null||(t.onclick=Zi)),Ju(e,i),ue=!0;else if(a!==4&&(a===27&&(Ju(e,i),i=null,ps(e.type)&&(n=e.stateNode,t=null)),e=e.child,e!==null))for(im(e,t,n,i),e=e.sibling;e!==null;)im(e,t,n,i),e=e.sibling}function Ku(e,t,n,i){var a=e.tag;if(a===5||a===6)a=e.stateNode,t?n.insertBefore(a,t):n.appendChild(a),Ju(e,i),ue=!0;else if(a!==4&&(a===27&&(Ju(e,i),i=null,ps(e.type)&&(n=e.stateNode)),e=e.child,e!==null))for(Ku(e,t,n,i),e=e.sibling;e!==null;)Ku(e,t,n,i),e=e.sibling}function TS(e){var t=e.stateNode,n=e.memoizedProps;try{for(var i=e.type,a=t.attributes;a.length;)t.removeAttributeNode(a[0]);dn(t,i,n),t[cn]=e,t[Bn]=n}catch(s){ye(e,e.return,s)}}var Qu=!1,qn=null;function K_(e){(e.tag===30||(e.subtreeFlags&33554432)!==0)&&(Qu=!0)}var qi=null;function Q_(){var e=qi;return qi=null,e}var Ln=0;function vo(e,t,n,i,a){return Ln=0,ES(e.child,t,n,i,a)}function ES(e,t,n,i,a){for(var s=!1;e!==null;){if(e.tag===5){var r=e.stateNode;if(i!==null){var o=bm(r);i.push(o),o.view&&(s=!0)}else s||bm(r).view&&(s=!0);Qu=!0,c1(r,Ln===0?t:t+"_"+Ln,n),Ln++}else(e.tag!==22||e.memoizedState===null)&&(e.tag===30&&a||ES(e.child,t,n,i,a)&&(s=!0));e=e.sibling}return s}function $i(e,t){for(;e!==null;)e.tag===5?u1(e.stateNode,e.memoizedProps):(e.tag!==22||e.memoizedState===null)&&(e.tag===30&&t||$i(e.child,t)),e=e.sibling}function bu(e){if((e.subtreeFlags&18874368)!==0)for(e=e.child;e!==null;){if((e.tag!==22||e.memoizedState===null)&&(bu(e),e.tag===30&&(e.flags&18874368)!==0&&e.stateNode.paired)){var t=e.memoizedProps;if(t.name==null||t.name==="auto")throw Error(nt(544));var n=t.name;t=Aa(t.default,t.share),t!=="none"&&(vo(e,n,t,null,!1)||$i(e.child,!1))}e=e.sibling}}function am(e,t){if(e.tag===30){var n=e.stateNode,i=e.memoizedProps,a=ya(i,n),s=Aa(i.default,n.paired?i.share:i.enter);s!=="none"?vo(e,a,s,null,!1)?(bu(e),n.paired||t||so(e,i.onEnter)):$i(e.child,!1):bu(e)}else if((e.subtreeFlags&33554432)!==0)for(e=e.child;e!==null;)am(e,t),e=e.sibling;else bu(e)}function sm(e){if(qn!==null&&qn.size!==0){var t=qn;if((e.subtreeFlags&18874368)!==0)for(e=e.child;e!==null;){if(e.tag!==22||e.memoizedState===null){if(e.tag===30&&(e.flags&18874368)!==0){var n=e.memoizedProps,i=n.name;if(i!=null&&i!=="auto"){var a=t.get(i);if(a!==void 0){var s=Aa(n.default,n.share);if(s!=="none"&&(vo(e,i,s,null,!1)?(s=e.stateNode,a.paired=s,s.paired=a,so(e,n.onShare)):$i(e.child,!1)),t.delete(i),t.size===0)break}}}sm(e)}e=e.sibling}}}function rm(e){if(e.tag===30){var t=e.memoizedProps,n=ya(t,e.stateNode),i=qn!==null?qn.get(n):void 0,a=Aa(t.default,i!==void 0?t.share:t.exit);a!=="none"&&(vo(e,n,a,null,!1)?i!==void 0?(a=e.stateNode,i.paired=a,a.paired=i,qn.delete(n),so(e,t.onShare)):so(e,t.onExit):$i(e.child,!1)),qn!==null&&sm(e)}else if((e.subtreeFlags&33554432)!==0)for(e=e.child;e!==null;)rm(e),e=e.sibling;else qn!==null&&sm(e)}function AS(e){for(e=e.child;e!==null;){if(e.tag===30){var t=e.memoizedProps,n=ya(t,e.stateNode);t=Aa(t.default,t.update),e.flags&=-5,t!=="none"&&vo(e,n,t,e.memoizedState=[],!1)}else(e.subtreeFlags&33554432)!==0&&AS(e);e=e.sibling}}function om(e){if((e.subtreeFlags&18874368)!==0)for(e=e.child;e!==null;){if(e.tag!==22||e.memoizedState===null){if(e.tag===30&&(e.flags&18874368)!==0){var t=e.stateNode;t.paired!==null&&(t.paired=null,$i(e.child,!1))}om(e)}e=e.sibling}}function Tu(e){if(e.tag===30)e.stateNode.paired=null,$i(e.child,!1),om(e);else if((e.subtreeFlags&33554432)!==0)for(e=e.child;e!==null;)Tu(e),e=e.sibling;else om(e)}function wS(e){for(e=e.child;e!==null;)e.tag===30?$i(e.child,!1):(e.subtreeFlags&33554432)!==0&&wS(e),e=e.sibling}function p0(e,t,n,i,a,s,r){for(var o=!1;t!==null;){if(t.tag===5){var l=t.stateNode;if(s!==null&&Ln<s.length){var c=s[Ln],f=bm(l);(c.view||f.view)&&(o=!0);var p;if(p=(e.flags&4)===0)if(f.clip)p=!0;else{p=c.rect;var u=f.rect;p=p.y!==u.y||p.x!==u.x||p.height!==u.height||p.width!==u.width}p&&(e.flags|=4),f.abs?f=!c.abs:(c=c.rect,f=f.rect,f=c.height!==f.height||c.width!==f.width),f&&(e.flags|=32)}else e.flags|=32;(e.flags&4)!==0&&c1(l,Ln===0?n:n+"_"+Ln,a),o&&(e.flags&4)!==0||(qi===null&&(qi=[]),qi.push(l,Ln===0?i:i+"_"+Ln,t.memoizedProps)),Ln++}else(t.tag!==22||t.memoizedState===null)&&(t.tag===30&&r?e.flags|=t.flags&32:p0(e,t.child,n,i,a,s,r)&&(o=!0));t=t.sibling}return o}function CS(e,t){for(e=e.child;e!==null;){if(e.tag===30){var n=e.memoizedProps,i=e.stateNode,a=ya(n,i),s=Aa(n.default,n.update);if(t){i=i.clones;var r=i===null?null:i.map(PA)}else r=e.memoizedState,e.memoizedState=null;i=e;var o=e.child;Ln=0,a=p0(i,o,a,a,s,r,!1),(e.flags&4)!==0&&a&&(t||so(e,n.onUpdate))}else(e.subtreeFlags&33554432)!==0&&CS(e,t);e=e.sibling}}var en=!1,ge=!1,Gi=!1,up=!1,j_=typeof WeakSet=="function"?WeakSet:Set,nn=null,ki=!1,fl=!1,ju=!1,lm=!1;function oA(e,t,n){if(e=e.containerInfo,ym=fo,e=dy(e),Hm(e)){if("selectionStart"in e)var i={start:e.selectionStart,end:e.selectionEnd};else t:{i=(i=e.ownerDocument)&&i.defaultView||window;var a=i.getSelection&&i.getSelection();if(a&&a.rangeCount!==0){i=a.anchorNode;var s=a.anchorOffset,r=a.focusNode;a=a.focusOffset;try{i.nodeType,r.nodeType}catch{i=null;break t}var o=0,l=-1,c=-1,f=0,p=0,u=e,d=null;e:for(;;){for(var _;u!==i||s!==0&&u.nodeType!==3||(l=o+s),u!==r||a!==0&&u.nodeType!==3||(c=o+a),u.nodeType===3&&(o+=u.nodeValue.length),(_=u.firstChild)!==null;)d=u,u=_;for(;;){if(u===e)break e;if(d===i&&++f===s&&(l=o),d===r&&++p===a&&(c=o),(_=u.nextSibling)!==null)break;u=d,d=u.parentNode}u=_}i=l===-1||c===-1?null:{start:l,end:c}}else i=null}i=i||{start:0,end:0}}else i=null;for(Sm={focusedElem:e,selectionRange:i},fo=!1,n=(n&335544064)===n,nn=t,t=n?9270:1024;nn!==null;){if(e=nn,n&&(i=e.deletions,i!==null))for(s=0;s<i.length;s++)n&&rm(i[s]);if(e.alternate===null&&(e.flags&2)!==0)n&&K_(e),ru(n);else{if(e.tag===22){if(i=e.alternate,e.memoizedState!==null){i!==null&&i.memoizedState===null&&n&&rm(i),ru(n);continue}else if(i!==null&&i.memoizedState!==null){n&&K_(e),ru(n);continue}}i=e.child,(e.subtreeFlags&t)!==0&&i!==null?(i.return=e,nn=i):(n&&AS(e),ru(n))}}qn=null}function ru(e){for(;nn!==null;){var t=nn,n=e,i=t.alternate,a=t.flags;switch(t.tag){case 0:case 11:case 15:break;case 1:if((a&1024)!==0&&i!==null){n=void 0,a=i.memoizedProps,i=i.memoizedState;var s=t.stateNode;try{var r=$s(t.type,a);n=s.getSnapshotBeforeUpdate(r,i),s.__reactInternalSnapshotBeforeUpdate=n}catch(o){ye(t,t.return,o)}}break;case 3:if((a&1024)!==0){if(i=t.stateNode.containerInfo,n=i.nodeType,n===9)Tm(i);else if(n===1)switch(i.nodeName){case"HEAD":case"HTML":case"BODY":Tm(i);break;default:i.textContent=""}}break;case 5:case 26:case 27:case 6:case 4:case 17:break;case 30:n&&i!==null&&(n=ya(i.memoizedProps,i.stateNode),a=t.memoizedProps,a=Aa(a.default,a.update),a!=="none"&&vo(i,n,a,i.memoizedState=[],!0));break;default:if((a&1024)!==0)throw Error(nt(163))}if(i=t.sibling,i!==null){i.return=t.return,nn=i;break}nn=t.return}}function RS(e,t,n){var i=n.flags;switch(n.tag){case 0:case 11:case 15:Xi(e,n),i&4&&Jl(5,n);break;case 1:if(Xi(e,n),i&4)if(e=n.stateNode,t===null)try{e.componentDidMount()}catch(r){ye(n,n.return,r)}else{var a=$s(n.type,t.memoizedProps);t=t.memoizedState;try{e.componentDidUpdate(a,t,e.__reactInternalSnapshotBeforeUpdate)}catch(r){ye(n,n.return,r)}}i&64&&SS(n),i&512&&Wi(n,n.return);break;case 3:if(Xi(e,n),i&64&&(e=n.updateQueue,e!==null)){if(t=null,n.child!==null)switch(n.child.tag){case 27:case 5:t=n.child.stateNode;break;case 1:t=n.child.stateNode}try{Ny(e,t)}catch(r){ye(n,n.return,r)}}break;case 27:t===null&&i&4&&TS(n);case 26:case 5:Xi(e,n),t===null&&i&4&&nm(n),i&512&&Wi(n,n.return);break;case 12:Xi(e,n);break;case 31:Xi(e,n),i&4&&LS(e,n);break;case 13:Xi(e,n),i&4&&OS(e,n),i&64&&(e=n.memoizedState,e!==null&&(e=e.dehydrated,e!==null&&(n=xA.bind(null,n),jA(e,n))));break;case 22:if(i=n.memoizedState!==null||en,!i){var s=t!==null&&t.memoizedState!==null||ge;t=en,a=ge,en=i,(ge=s)&&!a?(i=2,(n.subtreeFlags&8772)!==0&&(i|=1),bi(e,n,i)):Xi(e,n),en=t,ge=a}break;case 30:Xi(e,n),i&512&&Wi(n,n.return);break;case 7:i&512&&Wi(n,n.return);default:Xi(e,n)}}function cm(e,t){for(e=e.child;e!==null;)DS(e,t),e=e.sibling}function DS(e,t){switch(e.tag){case 5:case 26:try{var n=e.stateNode;if(t){var i=n.style;typeof i.setProperty=="function"?i.setProperty("display","none","important"):i.display="none"}else{var a=e.stateNode,s=e.memoizedProps.style,r=s!=null&&s.hasOwnProperty("display")?s.display:null;a.style.display=r==null||typeof r=="boolean"?"":(""+r).trim()}}catch(l){ye(e,e.return,l)}um(e,t);break;case 6:try{e.stateNode.nodeValue=t?"":e.memoizedProps,ue=!0}catch(l){ye(e,e.return,l)}break;case 18:try{var o=e.stateNode;t?px(o,!0):px(e.stateNode,!1)}catch(l){ye(e,e.return,l)}break;case 22:case 23:e.memoizedState===null&&cm(e,t);break;default:cm(e,t)}}function um(e,t){if(e.subtreeFlags&67108864)for(e=e.child;e!==null;){t:{var n=e,i=t;switch(n.tag){case 4:DS(n,i);break t;case 22:n.memoizedState===null&&um(n,i);break t;default:um(n,i)}}e=e.sibling}}function NS(e){var t=e.alternate;t!==null&&(e.alternate=null,NS(t)),e.child=null,e.deletions=null,e.sibling=null,e.tag===5&&(t=e.stateNode,t!==null&&cf(t)),e.stateNode=null,e.return=null,e.dependencies=null,e.memoizedProps=null,e.memoizedState=null,e.pendingProps=null,e.stateNode=null,e.updateQueue=null}var Pe=null,Nn=!1;function Mi(e,t,n){for(n=n.child;n!==null;)US(e,t,n),n=n.sibling}function US(e,t,n){if(Jn&&typeof Jn.onCommitFiberUnmount=="function")try{Jn.onCommitFiberUnmount(Gl,n)}catch{}switch(n.tag){case 26:ge||ln(n,t),Mi(e,t,n),n.memoizedState?n.memoizedState.count--:n.stateNode&&!ge&&(n=n.stateNode,n.parentNode.removeChild(n));break;case 27:ge||ln(n,t),Sl(n);var i=Pe,a=Nn;ps(n.type)&&(Pe=n.stateNode,Nn=!1),Mi(e,t,n),x1(n.stateNode,n.type,n.memoizedProps),Pe=i,Nn=a;break;case 5:ge||ln(n,t),Sl(n);case 6:if(n.tag===6&&Sl(n),i=Pe,a=Nn,Pe=null,Mi(e,t,n),Pe=i,Nn=a,Pe!==null)if(Nn)try{(Pe.nodeType===9?Pe.body:Pe.nodeName==="HTML"?Pe.ownerDocument.body:Pe).removeChild(n.stateNode),ue=!0}catch(s){ye(n,t,s)}else try{Pe.removeChild(n.stateNode),ue=!0}catch(s){ye(n,t,s)}break;case 18:Pe!==null&&(Nn?(e=Pe,dx(e.nodeType===9?e.body:e.nodeName==="HTML"?e.ownerDocument.body:e,n.stateNode),ho(e)):dx(Pe,n.stateNode));break;case 4:i=Pe,a=Nn,Pe=n.stateNode.containerInfo,Nn=!0,Mi(e,t,n),Pe=i,Nn=a;break;case 0:case 11:case 14:case 15:fs(2,n,t),ge||fs(4,n,t),Mi(e,t,n);break;case 1:ge||(ln(n,t),i=n.stateNode,typeof i.componentWillUnmount=="function"&&MS(n,t,i)),Mi(e,t,n);break;case 21:Mi(e,t,n);break;case 22:ge=(i=ge)||n.memoizedState!==null,Mi(e,t,n),ge=i;break;case 30:ln(n,t),Mi(e,t,n);break;case 7:ge||ln(n,t),Mi(e,t,n);break;default:Mi(e,t,n)}}function LS(e,t){if(t.memoizedState===null&&(e=t.alternate,e!==null&&(e=e.memoizedState,e!==null))){e=e.dehydrated;try{ho(e)}catch(n){ye(t,t.return,n)}}}function OS(e,t){if(t.memoizedState===null&&(e=t.alternate,e!==null&&(e=e.memoizedState,e!==null&&(e=e.dehydrated,e!==null))))try{ho(e)}catch(n){ye(t,t.return,n)}}function lA(e){switch(e.tag){case 31:case 13:case 19:var t=e.stateNode;return t===null&&(t=e.stateNode=new j_),t;case 22:return e=e.stateNode,t=e._retryCache,t===null&&(t=e._retryCache=new j_),t;default:throw Error(nt(435,e.tag))}}function ou(e,t){var n=lA(e);t.forEach(function(i){if(!n.has(i)){n.add(i);var a=yA.bind(null,e,i);i.then(a,a)}})}function En(e,t,n){var i=t.deletions;if(i!==null)for(var a=0;a<i.length;a++){var s=i[a],r=e,o=t,l=o;t:for(;l!==null;){switch(l.tag){case 27:if(ps(l.type)){Pe=l.stateNode,Nn=!1;break t}break;case 5:Pe=l.stateNode,Nn=!1;break t;case 3:case 4:Pe=l.stateNode.containerInfo,Nn=!0;break t}l=l.return}if(Pe===null)throw Error(nt(160));US(r,o,s),Pe=null,Nn=!1,r=s.alternate,r!==null&&(r.return=null),s.return=null}if(t.subtreeFlags&13886)for(t=t.child;t!==null;)IS(t,e,n),t=t.sibling}var Ti=null;function IS(e,t,n){var i=e.alternate,a=e.flags;switch(e.tag){case 0:case 11:case 14:case 15:if(a&4&&(i=e.updateQueue,i=i!==null?i.events:null,i!==null))for(var s=0;s<i.length;s++){var r=i[s];r.ref.impl=r.nextImpl}En(t,e,n),An(e),a&4&&(fs(3,e,e.return),Jl(3,e),fs(5,e,e.return));break;case 1:En(t,e,n),An(e),a&512&&(ge||i===null||ln(i,i.return)),a&64&&en&&(e=e.updateQueue,e!==null&&(t=e.callbacks,t!==null&&(n=e.shared.hiddenCallbacks,e.shared.hiddenCallbacks=n===null?t:n.concat(t))));break;case 26:if(s=Ti,En(t,e,n),An(e),a&512&&(ge||i===null||ln(i,i.return)),a&4)if(a=i!==null?i.memoizedState:null,n=e.memoizedState,i===null)if(n===null)if(e.stateNode===null)if(en)e.stateNode=l1(e.type,e.memoizedProps,t.containerInfo,e);else{t:{t=e.type,n=e.memoizedProps,a=s.ownerDocument||s;e:switch(t){case"title":i=a.getElementsByTagName("title")[0],(!i||i[Wl]||i[cn]||i.namespaceURI==="http://www.w3.org/2000/svg"||i.hasAttribute("itemprop"))&&(i=a.createElement(t),a.head.insertBefore(i,a.querySelector("head > title"))),dn(i,t,n),i[cn]=e,an(i),t=i;break t;case"link":if(s=Mx("link","href",a).get(t+(n.href||""))){for(r=0;r<s.length;r++)if(i=s[r],i.getAttribute("href")===(n.href==null||n.href===""?null:n.href)&&i.getAttribute("rel")===(n.rel==null?null:n.rel)&&i.getAttribute("title")===(n.title==null?null:n.title)&&i.getAttribute("crossorigin")===(n.crossOrigin==null?null:n.crossOrigin)){s.splice(r,1);break e}}i=a.createElement(t),dn(i,t,n),a.head.appendChild(i);break;case"meta":if(s=Mx("meta","content",a).get(t+(n.content||""))){for(r=0;r<s.length;r++)if(i=s[r],i.getAttribute("content")===(n.content==null?null:""+n.content)&&i.getAttribute("name")===(n.name==null?null:n.name)&&i.getAttribute("property")===(n.property==null?null:n.property)&&i.getAttribute("http-equiv")===(n.httpEquiv==null?null:n.httpEquiv)&&i.getAttribute("charset")===(n.charSet==null?null:n.charSet)){s.splice(r,1);break e}}i=a.createElement(t),dn(i,t,n),a.head.appendChild(i);break;default:throw Error(nt(468,t))}i[cn]=e,an(i),t=i}e.stateNode=t}else en||wm(s,e.type,e.stateNode);else e.stateNode=Sx(s,n,e.memoizedProps);else a!==n?(a===null?(t=i.stateNode,t===null||ge||t.parentNode.removeChild(t)):a.count--,n===null?en||wm(s,e.type,e.stateNode):Sx(s,n,e.memoizedProps)):n===null&&e.stateNode!==null&&lp(e,e.memoizedProps,i.memoizedProps);break;case 27:En(t,e,n),An(e),a&512&&(ge||i===null||ln(i,i.return)),i!==null&&a&4&&lp(e,e.memoizedProps,i.memoizedProps);break;case 5:if(s=Gi,Gi=!1,En(t,e,n),Gi=s,An(e),a&512&&(ge||i===null||ln(i,i.return)),e.flags&32){t=e.stateNode;try{no(t,""),ue=!0}catch(f){ye(e,e.return,f)}}a&4&&e.stateNode!=null&&(t=e.memoizedProps,lp(e,t,i!==null?i.memoizedProps:t)),a&1024&&(up=!0);break;case 6:if(En(t,e,n),An(e),a&4){if(e.stateNode===null)throw Error(nt(162));t=e.memoizedProps,n=e.stateNode;try{n.nodeValue=t,ue=!0}catch(f){ye(e,e.return,f)}}break;case 3:if(ue=!1,Cu=null,s=Ti,Ti=Bl(t.containerInfo),En(t,e,n),Ti=s,An(e),a&4&&i!==null&&i.memoizedState.isDehydrated)try{ho(t.containerInfo)}catch(f){ye(e,e.return,f)}up&&(up=!1,PS(e)),ue=!1;break;case 4:a=Gi,Gi=en,i=a_(),s=Ti,Ti=Bl(e.stateNode.containerInfo),En(t,e,n),An(e),Ti=s,ue&&fl&&(ju=!0),ue=i,Gi=a;break;case 12:En(t,e,n),An(e);break;case 31:En(t,e,n),An(e),a&4&&(t=e.updateQueue,t!==null&&(e.updateQueue=null,ou(e,t)));break;case 13:En(t,e,n),An(e),e.child.flags&8192&&e.memoizedState!==null!=(i!==null&&i.memoizedState!==null)&&(Mf=Zn()),a&4&&(t=e.updateQueue,t!==null&&(e.updateQueue=null,ou(e,t)));break;case 22:s=e.memoizedState!==null,r=i!==null&&i.memoizedState!==null;var o=en,l=ge,c=Gi;en=o||s,Gi=c||s,ge=l||r,En(t,e,n),ge=l,Gi=c,en=o,An(e),a&8192&&(t=e.stateNode,t._visibility=s?t._visibility&-2:t._visibility|1,!s||i===null||r||en||ge||(t=r||ge,n=en,i=ge,en=s||en,ge=t,Ga(e,2),en=n,ge=i),!s&&Gi||cm(e,s)),a&4&&(t=e.updateQueue,t!==null&&(n=t.retryQueue,n!==null&&(t.retryQueue=null,ou(e,n))));break;case 19:En(t,e,n),An(e),a&4&&(t=e.updateQueue,t!==null&&(e.updateQueue=null,ou(e,t)));break;case 30:a&512&&(ge||i===null||ln(i,i.return)),a=a_(),s=fl,r=(n&335544064)===n,o=e.memoizedProps,fl=r&&Aa(o.default,o.update)!=="none",En(t,e,n),An(e),r&&i!==null&&ue&&(e.flags|=4),fl=s,ue=a;break;case 21:break;case 7:a&512&&(ge||i===null||ln(i,i.return)),i&&i.stateNode!==null&&(i.stateNode._fragmentFiber=e);default:En(t,e,n),An(e)}}function An(e){var t=e.flags;if(t&2){try{for(var n,i=e.return;i!==null;){if(bS(i)){n=i;break}i=i.return}i=null;for(var a=e.return;a!==null;){if(d0(a)){var s=a.stateNode;i===null?i=[s]:i.push(s)}if(h0(a))break;a=a.return}var r=i;if(n==null)throw Error(nt(160));switch(n.tag){case 27:var o=n.stateNode,l=cp(e);Ku(e,l,o,r);break;case 5:var c=n.stateNode;n.flags&32&&(no(c,""),n.flags&=-33);var f=cp(e);Ku(e,f,c,r);break;case 3:case 4:var p=n.stateNode.containerInfo,u=cp(e);im(e,u,p,r);break;default:throw Error(nt(161))}}catch(d){ye(e,e.return,d)}e.flags&=-3}t&4096&&(e.flags&=-4097)}function PS(e){if(e.subtreeFlags&1024)for(e=e.child;e!==null;){var t=e;PS(t),t.tag===5&&t.flags&1024&&(t=t.stateNode,fo=!0,t.reset(),fo=!1),e=e.sibling}}function Cr(e,t){if(t.subtreeFlags&9270)for(t=t.child;t!==null;)BS(t,e),t=t.sibling;else CS(t,!1)}function BS(e,t){var n=e.alternate;if(n===null)am(e,!1);else switch(e.tag){case 3:if(lm=ki=!1,Q_(),Cr(t,e),!ki&&!ju){if(e=qi,e!==null)for(var i=0;i<e.length;i+=3){n=e[i];var a=e[i+1];u1(n,e[i+2]),n=n.ownerDocument.documentElement,n!==null&&n.animate({opacity:[0,0],pointerEvents:["none","none"]},{duration:0,fill:"forwards",pseudoElement:"::view-transition-group("+a+")"})}e=t.containerInfo,e=e.nodeType===9?e.documentElement:e.ownerDocument.documentElement,e!==null&&e.style.viewTransitionName===""&&(e.style.viewTransitionName="none",e.animate({opacity:[0,0],pointerEvents:["none","none"]},{duration:0,fill:"forwards",pseudoElement:"::view-transition-group(root)"}),e.animate({width:[0,0],height:[0,0]},{duration:0,fill:"forwards",pseudoElement:"::view-transition"})),lm=!0}qi=null;break;case 5:Cr(t,e);break;case 4:i=ki,ki=!1,Cr(t,e),ki&&(ju=!0),ki=i;break;case 22:e.memoizedState===null&&(n.memoizedState!==null?am(e,!1):Cr(t,e));break;case 30:i=ki,a=Q_(),ki=!1,Cr(t,e),ki&&(e.flags|=4);var s=e.memoizedProps,r=e.stateNode;t=ya(s,r),r=ya(n.memoizedProps,r);var o=Aa(s.default,s.update);o==="none"?t=!1:(s=n.memoizedState,n.memoizedState=null,n=e.child,Ln=0,t=p0(e,n,t,r,o,s,!0),Ln!==(s===null?0:s.length)&&(e.flags|=32)),(e.flags&4)!==0&&t?(so(e,e.memoizedProps.onUpdate),qi=a):a!==null&&(a.push.apply(a,qi),qi=a),ki=(e.flags&32)!==0?!0:i;break;default:Cr(t,e)}}function Xi(e,t){if(t.subtreeFlags&8772)for(t=t.child;t!==null;)RS(e,t.alternate,t),t=t.sibling}function Ga(e,t){for(e=e.child;e!==null;){var n=e,i=t;switch(n.tag){case 0:case 11:case 14:case 15:fs(4,n,n.return),Ga(n,i);break;case 1:ln(n,n.return);var a=n.stateNode;typeof a.componentWillUnmount=="function"&&MS(n,n.return,a),Ga(n,i);break;case 27:(i&2)!==0&&x1(n.stateNode,n.type,n.memoizedProps);case 5:ln(n,n.return),n.tag!==5&&n.tag!==27||Sl(n),Ga(n,i);break;case 6:Sl(n);break;case 26:ln(n,n.return),a=n.stateNode,n.memoizedState!==null||a===null||ge||a.parentNode.removeChild(a),Ga(n,i);break;case 22:n.memoizedState===null&&Ga(n,i);break;case 30:ln(n,n.return),Ga(n,i);break;case 7:ln(n,n.return);default:Ga(n,i)}e=e.sibling}}function bi(e,t,n){for(n=(t.subtreeFlags&8772)!==0?n:n&-2,t=t.child;t!==null;){var i=t.alternate,a=e,s=t,r=s.flags,o=(n&1)!==0;switch(s.tag){case 0:case 11:case 15:bi(a,s,n),Jl(4,s);break;case 1:if(bi(a,s,n),i=s,a=i.stateNode,typeof a.componentDidMount=="function")try{a.componentDidMount()}catch(f){ye(i,i.return,f)}if(i=s,a=i.updateQueue,a!==null){var l=i.stateNode;try{var c=a.shared.hiddenCallbacks;if(c!==null)for(a.shared.hiddenCallbacks=null,a=0;a<c.length;a++)Dy(c[a],l)}catch(f){ye(i,i.return,f)}}o&&r&64&&SS(s),Wi(s,s.return);break;case 27:(n&2)!==0&&TS(s);case 5:s.tag!==5&&s.tag!==27||J_(s),bi(a,s,n),o&&i===null&&r&4&&nm(s),Wi(s,s.return);break;case 6:J_(s);break;case 26:l=s.stateNode,s.memoizedState!==null||l===null||en||wm(Bl(l.ownerDocument),s.type,l),bi(a,s,n),o&&i===null&&r&4&&nm(s),Wi(s,s.return);break;case 12:bi(a,s,n);break;case 31:bi(a,s,n),o&&r&4&&LS(a,s);break;case 13:bi(a,s,n),o&&r&4&&OS(a,s);break;case 22:s.memoizedState===null&&bi(a,s,n),Wi(s,s.return);break;case 30:bi(a,s,n),Wi(s,s.return);break;case 7:Wi(s,s.return);default:bi(a,s,n)}t=t.sibling}}function m0(e,t){var n=null;e!==null&&e.memoizedState!==null&&e.memoizedState.cachePool!==null&&(n=e.memoizedState.cachePool.pool),e=null,t.memoizedState!==null&&t.memoizedState.cachePool!==null&&(e=t.memoizedState.cachePool.pool),e!==n&&(e!=null&&e.refCount++,n!=null&&Yl(n))}function g0(e,t){e=null,t.alternate!==null&&(e=t.alternate.memoizedState.cache),t=t.memoizedState.cache,t!==e&&(t.refCount++,e!=null&&Yl(e))}function oi(e,t,n,i){var a=(n&335544064)===n;if(t.subtreeFlags&(a?10262:10256))for(t=t.child;t!==null;)zS(e,t,n,i),t=t.sibling;else a&&wS(t)}function zS(e,t,n,i){var a=(n&335544064)===n;a&&t.alternate===null&&t.return!==null&&t.return.alternate!==null&&Tu(t);var s=t.flags;switch(t.tag){case 0:case 11:case 15:oi(e,t,n,i),s&2048&&Jl(9,t);break;case 1:oi(e,t,n,i);break;case 3:oi(e,t,n,i),a&&lm&&(e=e.containerInfo,e=e.nodeType===9?e.body:e.nodeName==="HTML"?e.ownerDocument.body:e,e.style.viewTransitionName==="root"&&(e.style.viewTransitionName=""),e=e.ownerDocument.documentElement,e!==null&&e.style.viewTransitionName==="none"&&(e.style.viewTransitionName="")),s&2048&&(s=null,t.alternate!==null&&(s=t.alternate.memoizedState.cache),t=t.memoizedState.cache,t!==s&&(t.refCount++,s!=null&&Yl(s)));break;case 12:if(s&2048){oi(e,t,n,i),s=t.stateNode;try{var r=t.memoizedProps,o=r.id,l=r.onPostCommit;typeof l=="function"&&l(o,t.alternate===null?"mount":"update",s.passiveEffectDuration,-0)}catch(c){ye(t,t.return,c)}}else oi(e,t,n,i);break;case 31:oi(e,t,n,i);break;case 13:oi(e,t,n,i);break;case 23:break;case 22:r=t.stateNode,o=t.alternate,t.memoizedState!==null?(a&&o!==null&&o.memoizedState===null&&Tu(o),r._visibility&2?oi(e,t,n,i):Ml(e,t)):(a&&o!==null&&o.memoizedState!==null&&Tu(t),r._visibility&2?oi(e,t,n,i):(r._visibility|=2,Dr(e,t,n,i,(t.subtreeFlags&10256)!==0||!1))),s&2048&&m0(o,t);break;case 24:oi(e,t,n,i),s&2048&&g0(t.alternate,t);break;case 30:a&&(s=t.alternate,s!==null&&($i(s.child,!0),$i(t.child,!0))),oi(e,t,n,i);break;default:oi(e,t,n,i)}}function Dr(e,t,n,i,a){for(a=a&&((t.subtreeFlags&10256)!==0||!1),t=t.child;t!==null;){var s=e,r=t,o=n,l=i,c=r.flags;switch(r.tag){case 0:case 11:case 15:Dr(s,r,o,l,a),Jl(8,r);break;case 23:break;case 22:var f=r.stateNode;r.memoizedState!==null?f._visibility&2?Dr(s,r,o,l,a):Ml(s,r):(f._visibility|=2,Dr(s,r,o,l,a)),a&&c&2048&&m0(r.alternate,r);break;case 24:Dr(s,r,o,l,a),a&&c&2048&&g0(r.alternate,r);break;default:Dr(s,r,o,l,a)}t=t.sibling}}function Ml(e,t){if(t.subtreeFlags&10256)for(t=t.child;t!==null;){var n=e,i=t,a=i.flags;switch(i.tag){case 22:Ml(n,i),a&2048&&m0(i.alternate,i);break;case 24:Ml(n,i),a&2048&&g0(i.alternate,i);break;default:Ml(n,i)}t=t.sibling}}var Fs=8192;function Ps(e,t,n){if(e.subtreeFlags&Fs)for(e=e.child;e!==null;)FS(e,t,n),e=e.sibling}function FS(e,t,n){switch(e.tag){case 26:Ps(e,t,n),e.flags&Fs&&(e.memoizedState!==null?hw(n,Ti,e.memoizedState,e.memoizedProps):(e=e.stateNode,(t&335544128)===t&&Tx(n,e)));break;case 5:Ps(e,t,n),e.flags&Fs&&(e=e.stateNode,(t&335544128)===t&&Tx(n,e));break;case 3:case 4:var i=Ti;Ti=Bl(e.stateNode.containerInfo),Ps(e,t,n),Ti=i;break;case 22:e.memoizedState===null&&(i=e.alternate,i!==null&&i.memoizedState!==null?(i=Fs,Fs=16777216,Ps(e,t,n),Fs=i):Ps(e,t,n));break;case 30:if((e.flags&Fs)!==0&&(i=e.memoizedProps.name,i!=null&&i!=="auto")){var a=e.stateNode;a.paired=null,qn===null&&(qn=new Map),qn.set(i,a)}Ps(e,t,n);break;default:Ps(e,t,n)}}function HS(e){var t=e.alternate;if(t!==null&&(e=t.child,e!==null)){t.child=null;do t=e.sibling,e.sibling=null,e=t;while(e!==null)}}function al(e){var t=e.deletions;if((e.flags&16)!==0){if(t!==null)for(var n=0;n<t.length;n++){var i=t[n];nn=i,GS(i,e)}HS(e)}if(e.subtreeFlags&10256)for(e=e.child;e!==null;)VS(e),e=e.sibling}function VS(e){switch(e.tag){case 0:case 11:case 15:al(e),e.flags&2048&&fs(9,e,e.return);break;case 3:al(e);break;case 12:al(e);break;case 22:var t=e.stateNode;e.memoizedState!==null&&t._visibility&2&&(e.return===null||e.return.tag!==13)?(t._visibility&=-3,Eu(e)):al(e);break;default:al(e)}}function Eu(e){var t=e.deletions;if((e.flags&16)!==0){if(t!==null)for(var n=0;n<t.length;n++){var i=t[n];nn=i,GS(i,e)}HS(e)}for(e=e.child;e!==null;){switch(t=e,t.tag){case 0:case 11:case 15:fs(8,t,t.return),Eu(t);break;case 22:n=t.stateNode,n._visibility&2&&(n._visibility&=-3,Eu(t));break;default:Eu(t)}e=e.sibling}}function GS(e,t){for(;nn!==null;){var n=nn;switch(n.tag){case 0:case 11:case 15:fs(8,n,t);break;case 23:case 22:if(n.memoizedState!==null&&n.memoizedState.cachePool!==null){var i=n.memoizedState.cachePool.pool;i!=null&&i.refCount++}break;case 24:Yl(n.memoizedState.cache)}if(i=n.child,i!==null)i.return=n,nn=i;else t:for(n=e;nn!==null;){i=nn;var a=i.sibling,s=i.return;if(NS(i),i===n){nn=null;break t}if(a!==null){a.return=s,nn=a;break t}nn=s}}}var cA={getCacheForType:function(e){var t=un(Ye),n=t.data.get(e);return n===void 0&&(n=e(),t.data.set(e,n)),n},cacheSignal:function(){return un(Ye).controller.signal}},uA=typeof WeakMap=="function"?WeakMap:Map,fe=0,Ee=null,ne=null,ae=0,_e=0,kn=null,Ja=!1,_o=!1,v0=!1,Ta=0,Ve=0,hs=0,qs=0,$u=0,Yn=0,ao=0,bl=null,Un=null,fm=!1,Mf=0,kS=0,tf=1/0,ef=null,as=null,ze=0,Ai=null,tr=null,ji=0,hm=0,dm=null,XS=null,Qr=null,jr=null,$r=null,Tl=0,Au=null;function Qn(){return(fe&2)!==0&&ae!==0?ae&-ae:Ht.T!==null?x0():Zx()}function WS(){if(Yn===0)if((ae&536870912)===0||Qt){var e=Zc;Zc<<=1,(Zc&3932160)===0&&(Zc=262144),Yn=e}else Yn=536870912;return e=pn.current,e!==null&&(e.flags|=32),Yn}function so(e,t){if(t!=null){var n=e.stateNode,i=n.ref;i===null&&(i=n.ref=h1(ya(e.memoizedProps,n))),jr===null&&(jr=[]),jr.push(t.bind(null,i))}}function In(e,t,n){(e===Ee&&(_e===2||_e===9)||e.cancelPendingCommit!==null)&&(ro(e,0),Ka(e,ae,Yn,!1)),Xl(e,n),((fe&2)===0||e!==Ee)&&(e===Ee&&((fe&2)===0&&(qs|=n),Ve===4&&Ka(e,ae,Yn,!1)),ea(e))}function qS(e,t,n){if((fe&6)!==0)throw Error(nt(327));var i=!n&&(t&127)===0&&(t&e.expiredLanes)===0||kl(e,t),a=i?dA(e,t):fp(e,t,!0),s=i;do{if(a===0){_o&&!i&&Ka(e,t,0,!1);break}else{if(n=e.current.alternate,s&&!fA(n)){a=fp(e,t,!1),s=!1;continue}if(a===2){if(s=t,e.errorRecoveryDisabledLanes&s)var r=0;else r=e.pendingLanes&-536870913,r=r!==0?r:r&536870912?536870912:0;if(r!==0){t=r;t:{var o=e;a=bl;var l=o.current.memoizedState.isDehydrated;if(l&&(ro(o,r).flags|=256),r=fp(o,r,!1),r!==2&&r!==6){if(v0&&!l){o.errorRecoveryDisabledLanes|=s,qs|=s,a=4;break t}s=Un,Un=a,s!==null&&(Un===null?Un=s:Un.push.apply(Un,s))}a=r}if(s=!1,a!==2)continue}}if(a===1){ro(e,0),Ka(e,t,0,!0);break}t:{switch(i=e,s=a,s){case 0:case 1:throw Error(nt(345));case 4:if((t&4194048)!==t&&(t&62914560)!==t)break;case 6:Ka(i,t,Yn,!Ja);break t;case 2:Un=null;break;case 3:case 5:break;default:throw Error(nt(329))}if((t&62914560)===t&&(a=Mf+300-Zn(),10<a)){if(Ka(i,t,Yn,!Ja),lf(i,0,!0)!==0)break t;ji=t,i.timeoutHandle=S0($_.bind(null,i,n,Un,ef,fm,t,Yn,qs,ao,Ja,s,"Throttled",-0,0),a);break t}$_(i,n,Un,ef,fm,t,Yn,qs,ao,Ja,s,null,-0,0)}}break}while(!0);ea(e)}function $_(e,t,n,i,a,s,r,o,l,c,f,p,u,d){e.timeoutHandle=-1;var _=t.subtreeFlags,b=(s&335544064)===s;if(p=null,(b||_&8192||(_&16785408)===16785408)&&(p={stylesheets:null,count:0,imgCount:0,imgBytes:0,suspenseyImages:[],waitingForImages:!0,waitingForViewTransition:!1,unsuspend:Zi},qn=null,FS(t,s,p),b&&(_=p,b=e.containerInfo,b=(b.nodeType===9?b:b.ownerDocument).__reactViewTransition,b!=null&&(_.count++,_.waitingForViewTransition=!0,_=zl.bind(_),b.finished.then(_,_))),_=(s&62914560)===s?Mf-Zn():(s&4194048)===s?kS-Zn():0,_=dw(p,_),_!==null)){ji=s,e.cancelPendingCommit=_(ex.bind(null,e,t,s,n,i,a,r,o,l,c,f,p,null,u,d)),Ka(e,s,r,!c);return}ex(e,t,s,n,i,a,r,o,l,c,f,p)}function fA(e){for(var t=e;;){var n=t.tag;if((n===0||n===11||n===15)&&t.flags&16384&&(n=t.updateQueue,n!==null&&(n=n.stores,n!==null)))for(var i=0;i<n.length;i++){var a=n[i],s=a.getSnapshot;a=a.value;try{if(!jn(s(),a))return!1}catch{return!1}}if(n=t.child,t.subtreeFlags&16384&&n!==null)n.return=t,t=n;else{if(t===e)break;for(;t.sibling===null;){if(t.return===null||t.return===e)return!0;t=t.return}t.sibling.return=t.return,t=t.sibling}}return!0}function Ka(e,t,n,i){t=kx(e,t),t&=~$u,t&=~qs,e.suspendedLanes|=t,e.pingedLanes&=~t,i&&(e.warmLanes|=t),i=e.expirationTimes;for(var a=t;0<a;){var s=31-Kn(a),r=1<<s;i[s]=-1,a&=~r}n!==0&&Wx(e,n,t)}function bf(){return(fe&6)===0?(Kl(0,!1),!1):!0}function _0(){if(ne!==null){if(_e===0)var e=ne.return;else e=ne,ga=sr=null,e0(e),Zr=null,Nl=0,e=ne;for(;e!==null;)yS(e.alternate,e),e=e.return;ne=null}}function ro(e,t){var n=e.timeoutHandle;return n!==-1&&(e.timeoutHandle=-1,LA(n)),n=e.cancelPendingCommit,n!==null&&(e.cancelPendingCommit=null,n()),ji=0,_0(),Ee=e,ne=n=va(e.current,null),ae=t,_e=0,kn=null,Ja=!1,_o=kl(e,t),v0=!1,ao=Yn=$u=qs=hs=Ve=0,Un=bl=null,fm=!1,Ta=kx(e,t),df(),n}function YS(e,t){Yt=null,Ht.H=Yu,t===go||t===gf?(t=A_(),_e=3):t===Ym?(t=A_(),_e=4):_e=t===c0?8:t!==null&&typeof t=="object"&&typeof t.then=="function"?6:1,kn=t,ne===null&&(Ve=1,Zu(e,hi(t,e.current)))}function ZS(){var e=pn.current;return e===null?!0:(ae&4194048)===ae?xn===null:(ae&62914560)===ae||(ae&536870912)!==0?e===xn:!1}function JS(){var e=Ht.H;return Ht.H=Yu,e===null?Yu:e}function KS(){var e=Ht.A;return Ht.A=cA,e}function nf(){Ve=4,Ja||(ae&4194048)!==ae&&pn.current!==null||(_o=!0),(hs&134217727)===0&&(qs&134217727)===0||Ee===null||Ka(Ee,ae,Yn,!1)}function fp(e,t,n){var i=fe;fe|=2;var a=JS(),s=KS();(Ee!==e||ae!==t)&&(ef=null,ro(e,t)),t=!1;var r=Ve;t:do try{if(_e!==0&&ne!==null){var o=ne,l=kn;switch(_e){case 8:_0(),r=6;break t;case 3:case 2:case 9:case 6:pn.current===null&&(t=!0);var c=_e;if(_e=0,kn=null,kr(e,o,l,c),n&&_o){r=0;break t}break;default:c=_e,_e=0,kn=null,kr(e,o,l,c)}}hA(),r=Ve;break}catch(f){YS(e,f)}while(!0);return t&&e.shellSuspendCounter++,ga=sr=null,fe=i,Ht.H=a,Ht.A=s,ne===null&&(Ee=null,ae=0,df()),r}function hA(){for(;ne!==null;)QS(ne)}function dA(e,t){var n=fe;fe|=2;var i=JS(),a=KS();Ee!==e||ae!==t?(ef=null,tf=Zn()+500,ro(e,t)):_o=kl(e,t);t:do try{if(_e!==0&&ne!==null){t=ne;var s=kn;e:switch(_e){case 1:_e=0,kn=null,kr(e,t,s,1);break;case 2:case 9:if(E_(s)){_e=0,kn=null,tx(t);break}t=function(){_e!==2&&_e!==9||Ee!==e||(_e=7),ea(e)},s.then(t,t);break t;case 3:_e=7;break t;case 4:_e=5;break t;case 7:E_(s)?(_e=0,kn=null,tx(t)):(_e=0,kn=null,kr(e,t,s,7));break;case 5:var r=null;switch(ne.tag){case 26:r=ne.memoizedState;case 5:case 27:var o=ne;if(r?M1(r):o.stateNode.complete){_e=0,kn=null;var l=o.sibling;if(l!==null)ne=l;else{var c=o.return;c!==null?(ne=c,Tf(c)):ne=null}break e}}_e=0,kn=null,kr(e,t,s,5);break;case 6:_e=0,kn=null,kr(e,t,s,6);break;case 8:_0(),Ve=6;break t;default:throw Error(nt(462))}}pA();break}catch(f){YS(e,f)}while(!0);return ga=sr=null,Ht.H=i,Ht.A=a,fe=n,ne!==null?0:(Ee=null,ae=0,df(),Ve)}function pA(){for(;ne!==null&&!NT();)QS(ne)}function QS(e){var t=xS(e.alternate,e,Ta);e.memoizedProps=e.pendingProps,t===null?Tf(e):ne=t}function tx(e){var t=e,n=t.alternate;switch(t.tag){case 15:case 0:t=G_(n,t,t.pendingProps,t.type,void 0,ae);break;case 11:t=G_(n,t,t.pendingProps,t.type.render,t.ref,ae);break;case 5:e0(t);var i=t;i===sn&&(Qt?(Hu(i),i.tag===5&&i.stateNode!=null&&(Ne=i.stateNode)):(Hu(i),Qt=!0));default:yS(n,t),t=ne=Sy(t,Ta),t=xS(n,t,Ta)}e.memoizedProps=e.pendingProps,t===null?Tf(e):ne=t}function kr(e,t,n,i){ga=sr=null,e0(t),Zr=null,Nl=0;var a=t.return;try{if(eA(e,a,t,n,ae)){Ve=1,Zu(e,hi(n,e.current)),ne=null;return}}catch(s){if(a!==null)throw ne=a,s;Ve=1,Zu(e,hi(n,e.current)),ne=null;return}t.flags&32768?(Qt||i===1?e=!0:_o||(ae&536870912)!==0?e=!1:(Ja=e=!0,(i===2||i===9||i===3||i===6)&&(i=pn.current,i!==null&&i.tag===13&&(i.flags|=16384))),jS(t,e)):Tf(t)}function Tf(e){var t=e;do{if((t.flags&32768)!==0){jS(t,Ja);return}e=t.return;var n=sA(t.alternate,t,Ta);if(n!==null){ne=n;return}if(t=t.sibling,t!==null){ne=t;return}ne=t=e}while(t!==null);Ve===0&&(Ve=5)}function jS(e,t){do{var n=rA(e.alternate,e);if(n!==null){n.flags&=32767,ne=n;return}if(n=e.return,n!==null&&(n.flags|=32768,n.subtreeFlags=0,n.deletions=null),!t&&(e=e.sibling,e!==null)){ne=e;return}ne=e=n}while(e!==null);Ve=6,ne=null}function ex(e,t,n,i,a,s,r,o,l,c,f,p){e.cancelPendingCommit=null;do Ef();while(ze!==0);if((fe&6)!==0)throw Error(nt(327));if(t!==null){if(t===e.current)throw Error(nt(177));e===Ee&&(ne=Ee=null,ae=0),tr=t,Ai=e,ji=n,dm=a,XS=i,mA(e,t,n,r,o,l,p)}}function mA(e,t,n,i,a,s,r){var o=t.lanes|t.childLanes;if(hm=o,o|=Vm,VT(e,n,o,i,a,s),jr=null,(n&335544064)===n?($r=kE(e),i=10262):($r=null,i=10256),(t.subtreeFlags&i)!==0||(t.flags&i)!==0?(e.callbackNode=null,e.callbackPriority=0,SA(Iu,function(){return vm(),null})):(e.callbackNode=null,e.callbackPriority=0),Qu=!1,i=(t.flags&13878)!==0,(t.subtreeFlags&13878)!==0||i){i=Ht.T,Ht.T=null,a=he.p,he.p=2,s=fe,fe|=4;try{oA(e,t,n)}finally{fe=s,he.p=a,Ht.T=i}}ze=1,Qu?Qr=FA(r,e.containerInfo,$r,pm,mm,vA,gm,vm,gA,null,null):(pm(),mm(),gm())}function gA(e){if(ze!==0){var t=Ai.onRecoverableError;t(e,{componentStack:null})}}function vA(){ze===3&&(ze=0,BS(tr,Ai),ze=4)}function pm(){if(ze===1){ze=0;var e=Ai,t=tr,n=ji,i=(t.flags&13878)!==0;if((t.subtreeFlags&13878)!==0||i){i=Ht.T,Ht.T=null;var a=he.p;he.p=2;var s=fe;fe|=4;try{fl=ju=!1,IS(t,e,n),n=Sm;var r=dy(e.containerInfo),o=n.focusedElem,l=n.selectionRange;if(r!==o&&o&&o.ownerDocument&&hy(o.ownerDocument.documentElement,o)){if(l!==null&&Hm(o)){var c=l.start,f=l.end;if(f===void 0&&(f=c),"selectionStart"in o)o.selectionStart=c,o.selectionEnd=Math.min(f,o.value.length);else{var p=o.ownerDocument||document,u=p&&p.defaultView||window;if(u.getSelection){var d=u.getSelection(),_=o.textContent.length,b=Math.min(l.start,_),m=l.end===void 0?b:Math.min(l.end,_);!d.extend&&b>m&&(r=m,m=b,b=r);var h=v_(o,b),g=v_(o,m);if(h&&g&&(d.rangeCount!==1||d.anchorNode!==h.node||d.anchorOffset!==h.offset||d.focusNode!==g.node||d.focusOffset!==g.offset)){var S=p.createRange();S.setStart(h.node,h.offset),d.removeAllRanges(),b>m?(d.addRange(S),d.extend(g.node,g.offset)):(S.setEnd(g.node,g.offset),d.addRange(S))}}}}for(p=[],d=o;d=d.parentNode;)d.nodeType===1&&p.push({element:d,left:d.scrollLeft,top:d.scrollTop});for(typeof o.focus=="function"&&o.focus(),o=0;o<p.length;o++){var y=p[o];y.element.scrollLeft=y.left,y.element.scrollTop=y.top}}fo=!!ym,Sm=ym=null}finally{fe=s,he.p=a,Ht.T=i}}e.current=t,ze=2}}function mm(){if(ze===2){ze=0;var e=Ai,t=tr,n=(t.flags&8772)!==0;if((t.subtreeFlags&8772)!==0||n){n=Ht.T,Ht.T=null;var i=he.p;he.p=2;var a=fe;fe|=4;try{RS(e,t.alternate,t)}finally{fe=a,he.p=i,Ht.T=n}}ze=3}}function gm(){if(ze===4||ze===3){ze=0;var e=Qr;Qr=null,UT();var t=Ai,n=tr,i=ji,a=XS,s=(i&335544064)===i?10262:10256;if((n.subtreeFlags&s)!==0||(n.flags&s)!==0?ze=5:(ze=0,tr=Ai=null,$S(t,t.pendingLanes)),s=t.pendingLanes,s===0&&(as=null),Om(i),n=n.stateNode,Jn&&typeof Jn.onCommitFiberRoot=="function")try{Jn.onCommitFiberRoot(Gl,n,void 0,(n.current.flags&128)===128)}catch{}if(a!==null){n=Ht.T,s=he.p,he.p=2,Ht.T=null;try{for(var r=t.onRecoverableError,o=0;o<a.length;o++){var l=a[o];r(l.value,{componentStack:l.stack})}}finally{Ht.T=n,he.p=s}}if(a=jr,r=$r,$r=null,a!==null&&(jr=null,r===null&&(r=[]),e!==null))for(l=0;l<a.length;l++)n=(0,a[l])(r),n!==void 0&&e.finished.finally(n);(ji&3)!==0&&Ef(),ea(t),s=t.pendingLanes,(i&261930)!==0&&(s&42)!==0?t===Au?Tl++:(Tl=0,Au=t):(Tl=0,Au=null),Kl(0,!1)}}function $S(e,t){(e.pooledCacheLanes&=t)===0&&(t=e.pooledCache,t!=null&&(e.pooledCache=null,Yl(t)))}function Ef(){return Qr!==null&&(Qr.skipTransition(),Qr=null),pm(),mm(),gm(),vm()}function vm(){if(ze!==5)return!1;var e=Ai,t=hm;hm=0;var n=Om(ji),i=Ht.T,a=he.p;try{he.p=32>n?32:n,Ht.T=null,n=dm,dm=null;var s=Ai,r=ji;if(ze=0,tr=Ai=null,ji=0,(fe&6)!==0)throw Error(nt(331));var o=fe;if(fe|=4,VS(s.current),zS(s,s.current,r,n),fe=o,Kl(0,!1),Jn&&typeof Jn.onPostCommitFiberRoot=="function")try{Jn.onPostCommitFiberRoot(Gl,s)}catch{}return!0}finally{he.p=a,Ht.T=i,$S(e,t)}}function nx(e,t,n){t=hi(n,t),t=Kp(e.stateNode,t,2),e=es(e,t,2),e!==null&&(Xl(e,2),ea(e))}function ye(e,t,n){if(e.tag===3)nx(e,e,n);else for(;t!==null;){if(t.tag===3){nx(t,e,n);break}else if(t.tag===1){var i=t.stateNode;if(typeof t.type.getDerivedStateFromError=="function"||typeof i.componentDidCatch=="function"&&(as===null||!as.has(i))){e=hi(n,e),n=pS(2),i=es(t,n,2),i!==null&&(mS(n,i,t,e),Xl(i,2),ea(i));break}}t=t.return}}function hp(e,t,n){var i=e.pingCache;if(i===null){i=e.pingCache=new uA;var a=new Set;i.set(t,a)}else a=i.get(t),a===void 0&&(a=new Set,i.set(t,a));a.has(n)||(v0=!0,a.add(n),e=_A.bind(null,e,t,n),t.then(e,e))}function _A(e,t,n){var i=e.pingCache;i!==null&&i.delete(t),e.pingedLanes|=e.suspendedLanes&n,e.warmLanes&=~n,Ee===e&&(ae&n)===n&&((Ve===4||Ve===3&&(ae&62914560)===ae&&300>Zn()-Mf)&&(fe&2)===0?ro(e,0):$u|=n,ao===ae&&(ao=0)),ea(e)}function t1(e,t){t===0&&(t=Xx()),e=ar(e,t),e!==null&&(Xl(e,t),ea(e))}function xA(e){var t=e.memoizedState,n=0;t!==null&&(n=t.retryLane),t1(e,n)}function yA(e,t){var n=0;switch(e.tag){case 31:case 13:var i=e.stateNode,a=e.memoizedState;a!==null&&(n=a.retryLane);break;case 19:i=e.stateNode;break;case 22:i=e.stateNode._retryCache;break;default:throw Error(nt(314))}i!==null&&i.delete(t),t1(e,n)}function SA(e,t){return Um(e,t)}var oo=null,Nr=null,_m=!1,af=!1,dp=!1,Qa=0;function ea(e){e!==Nr&&e.next===null&&(Nr===null?oo=Nr=e:Nr=Nr.next=e),af=!0,_m||(_m=!0,bA())}function Kl(e,t){if(!dp&&af){dp=!0;do for(var n=!1,i=oo;i!==null;){if(!t)if(e!==0){var a=i.pendingLanes;if(a===0)var s=0;else{var r=i.suspendedLanes,o=i.pingedLanes;s=(1<<31-Kn(42|e)+1)-1,s&=a&~(r&~o),s=s&201326741?s&201326741|1:s?s|2:0}s!==0&&(n=!0,ix(i,s))}else s=ae,s=lf(i,i===Ee?s:0,i.cancelPendingCommit!==null||i.timeoutHandle!==-1),(s&3)===0||kl(i,s)||(n=!0,ix(i,s));i=i.next}while(n);dp=!1}}function MA(){e1()}function e1(){af=_m=!1;var e=0;Qa!==0&&UA()&&(e=Qa);for(var t=Zn(),n=null,i=oo;i!==null;){var a=i.next,s=n1(i,t);s===0?(i.next=null,n===null?oo=a:n.next=a,a===null&&(Nr=n)):(n=i,(e!==0||(s&3)!==0)&&(af=!0)),i=a}ze!==0&&ze!==5||Kl(e,!1),Qa!==0&&(Qa=0)}function n1(e,t){for(var n=e.suspendedLanes,i=e.pingedLanes,a=e.expirationTimes,s=e.pendingLanes&-62914561;0<s;){var r=31-Kn(s),o=1<<r,l=a[r];l===-1?((o&n)===0||(o&i)!==0)&&(a[r]=HT(o,t)):l<=t&&(e.expiredLanes|=o),s&=~o}if(t=Ee,n=ae,n=lf(e,e===t?n:0,e.cancelPendingCommit!==null||e.timeoutHandle!==-1),i=e.callbackNode,n===0||e===t&&(_e===2||_e===9)||e.cancelPendingCommit!==null)return i!==null&&i!==null&&Wd(i),e.callbackNode=null,e.callbackPriority=0;if((n&3)===0||kl(e,n)){if(t=n&-n,t===e.callbackPriority)return t;switch(i!==null&&Wd(i),Om(n)){case 2:case 8:n=Vx;break;case 32:n=Iu;break;case 268435456:n=Gx;break;default:n=Iu}return i=i1.bind(null,e),n=Um(n,i),e.callbackPriority=t,e.callbackNode=n,t}return i!==null&&i!==null&&Wd(i),e.callbackPriority=2,e.callbackNode=null,2}function i1(e,t){if(ze!==0&&ze!==5)return e.callbackNode=null,e.callbackPriority=0,null;var n=e.callbackNode;if(Ef()&&e.callbackNode!==n)return null;var i=ae;return i=lf(e,e===Ee?i:0,e.cancelPendingCommit!==null||e.timeoutHandle!==-1),i===0?null:(qS(e,i,t),n1(e,Zn()),e.callbackNode!=null&&e.callbackNode===n?i1.bind(null,e):null)}function ix(e,t){if(Ef())return null;qS(e,t,!0)}function bA(){OA(function(){(fe&6)!==0?Um(Hx,MA):e1()})}function x0(){if(Qa===0){var e=Ks;e===0&&(e=Yc,Yc<<=1,(Yc&261888)===0&&(Yc=256)),Qa=e}return Qa}function ax(e){return e==null||typeof e=="symbol"||typeof e=="boolean"?null:typeof e=="function"?e:pu(e)}function TA(e,t,n,i,a){if(t==="submit"&&n&&n.stateNode===a){var s=ax((a[Bn]||null).action),r=i.submitter;r&&(t=(t=r[Bn]||null)?ax(t.formAction):r.getAttribute("formAction"),t!==null&&(s=t,r=null));var o=new uf("action","action",null,i,a);e.push({event:o,listeners:[{instance:null,listener:function(){if(i.defaultPrevented){if(Qa!==0){var l=new FormData(a,r);Zp(n,{pending:!0,data:l,method:a.method,action:s},null,l)}}else typeof s=="function"&&(o.preventDefault(),l=new FormData(a,r),Zp(n,{pending:!0,data:l,method:a.method,action:s},s,l))},currentTarget:a}]})}}for(lu=0;lu<Bp.length;lu++)cu=Bp[lu],sx=cu.toLowerCase(),rx=cu[0].toUpperCase()+cu.slice(1),wi(sx,"on"+rx);var cu,sx,rx,lu;wi(my,"onAnimationEnd");wi(gy,"onAnimationIteration");wi(vy,"onAnimationStart");wi("dblclick","onDoubleClick");wi("focusin","onFocus");wi("focusout","onBlur");wi(IE,"onTransitionRun");wi(PE,"onTransitionStart");wi(BE,"onTransitionCancel");wi(_y,"onTransitionEnd");eo("onMouseEnter",["mouseout","mouseover"]);eo("onMouseLeave",["mouseout","mouseover"]);eo("onPointerEnter",["pointerout","pointerover"]);eo("onPointerLeave",["pointerout","pointerover"]);nr("onChange","change click focusin focusout input keydown keyup selectionchange".split(" "));nr("onSelect","focusout contextmenu dragend focusin keydown keyup mousedown mouseup selectionchange".split(" "));nr("onBeforeInput",["compositionend","keypress","textInput","paste"]);nr("onCompositionEnd","compositionend focusout keydown keypress keyup mousedown".split(" "));nr("onCompositionStart","compositionstart focusout keydown keypress keyup mousedown".split(" "));nr("onCompositionUpdate","compositionupdate focusout keydown keypress keyup mousedown".split(" "));var Ol="abort canplay canplaythrough durationchange emptied encrypted ended error loadeddata loadedmetadata loadstart pause play playing progress ratechange resize seeked seeking stalled suspend timeupdate volumechange waiting".split(" "),EA=new Set("beforetoggle cancel close invalid load scroll scrollend toggle".split(" ").concat(Ol));function a1(e,t){t=(t&4)!==0;for(var n=0;n<e.length;n++){var i=e[n],a=i.event;i=i.listeners;t:{var s=void 0;if(t)for(var r=i.length-1;0<=r;r--){var o=i[r],l=o.instance,c=o.currentTarget;if(o=o.listener,l!==s&&a.isPropagationStopped())break t;s=o,a.currentTarget=c;try{s(a)}catch(f){Bu(f)}a.currentTarget=null,s=l}else for(r=0;r<i.length;r++){if(o=i[r],l=o.instance,c=o.currentTarget,o=o.listener,l!==s&&a.isPropagationStopped())break t;s=o,a.currentTarget=c;try{s(a)}catch(f){Bu(f)}a.currentTarget=null,s=l}}}}function ee(e,t){var n=t[t_];n===void 0&&(n=t[t_]=new Set);var i=e+"__bubble";n.has(i)||(s1(t,e,2,!1),n.add(i))}function pp(e,t,n){var i=0;t&&(i|=4),s1(n,e,i,t)}var uu="_reactListening"+Math.random().toString(36).slice(2);function y0(e){if(!e[uu]){e[uu]=!0,Kx.forEach(function(n){n!=="selectionchange"&&(EA.has(n)||pp(n,!1,e),pp(n,!0,e))});var t=e.nodeType===9?e:e.ownerDocument;t===null||t[uu]||(t[uu]=!0,pp("selectionchange",!1,t))}}function s1(e,t,n,i){switch(R1(t)){case 2:var a=vw;break;case 8:a=_w;break;default:a=w0}n=a.bind(null,t,n,e),a=void 0,!Lp||t!=="touchstart"&&t!=="touchmove"&&t!=="wheel"||(a=!0),i?a!==void 0?e.addEventListener(t,n,{capture:!0,passive:a}):e.addEventListener(t,n,!0):a!==void 0?e.addEventListener(t,n,{passive:a}):e.addEventListener(t,n,!1)}function mp(e,t,n,i,a){var s=i;if((t&1)===0&&(t&2)===0&&i!==null)t:for(;;){if(i===null)return;var r=i.tag;if(r===3||r===4){var o=i.stateNode.containerInfo;if(o===a)break;if(r===4)for(r=i.return;r!==null;){var l=r.tag;if((l===3||l===4)&&r.stateNode.containerInfo===a)return;r=r.return}for(;o!==null;){if(r=Hs(o),r===null)return;if(l=r.tag,l===5||l===6||l===26||l===27){i=s=r;continue t}o=o.parentNode}}i=i.return}ay(function(){var c=s,f=Pm(n),p=[];t:{var u=xy.get(e);if(u!==void 0){var d=uf,_=e;switch(e){case"keypress":if(gu(n)===0)break t;case"keydown":case"keyup":d=fE;break;case"focusin":_="focus",d=Qd;break;case"focusout":_="blur",d=Qd;break;case"beforeblur":case"afterblur":d=Qd;break;case"click":if(n.button===2)break t;case"auxclick":case"dblclick":case"mousedown":case"mousemove":case"mouseup":case"mouseout":case"mouseover":case"contextmenu":d=l_;break;case"drag":case"dragend":case"dragenter":case"dragexit":case"dragleave":case"dragover":case"dragstart":case"drop":d=$T;break;case"touchcancel":case"touchend":case"touchmove":case"touchstart":d=gE;break;case my:case gy:case vy:d=nE;break;case _y:d=_E;break;case"scroll":case"scrollend":d=QT;break;case"wheel":d=yE;break;case"copy":case"cut":case"paste":d=aE;break;case"gotpointercapture":case"lostpointercapture":case"pointercancel":case"pointerdown":case"pointermove":case"pointerout":case"pointerover":case"pointerup":d=u_;break;case"submit":d=pE;break;case"toggle":case"beforetoggle":d=ME}var b=(t&4)!==0,m=!b&&(e==="scroll"||e==="scrollend"),h=b?u!==null?u+"Capture":null:u;b=[];for(var g=c,S;g!==null;){var y=g;if(S=y.stateNode,y=y.tag,y!==5&&y!==26&&y!==27||S===null||h===null||(y=Al(g,h),y!=null&&b.push(Il(g,y,S))),m)break;g=g.return}0<b.length&&(u=new d(u,_,null,n,f),p.push({event:u,listeners:b}))}}if((t&7)===0){t:{if(d=e==="mouseover"||e==="pointerover",u=e==="mouseout"||e==="pointerout",d&&n!==Up&&(_=n.relatedTarget||n.fromElement)&&(Hs(_)||_[po]))break t;(u||d)&&(_=f.window===f?f:(d=f.ownerDocument)?d.defaultView||d.parentWindow:window,u?(d=n.relatedTarget||n.toElement,u=c,d=d?Hs(d):null,d!==null&&(m=Vl(d),b=d.tag,d!==m||b!==5&&b!==27&&b!==6)&&(d=null)):(u=null,d=c),u!==d&&(b=l_,y="onMouseLeave",h="onMouseEnter",g="mouse",(e==="pointerout"||e==="pointerover")&&(b=u_,y="onPointerLeave",h="onPointerEnter",g="pointer"),m=u==null?_:cl(u),S=d==null?_:cl(d),_=new b(y,g+"leave",u,n,f),_.target=m,_.relatedTarget=S,y=null,Hs(f)===c&&(b=new b(h,g+"enter",d,n,f),b.target=S,b.relatedTarget=m,y=b),m=y,b=u&&d?yp(u,d,AA):null,u!==null&&ox(p,_,u,b,!1),d!==null&&m!==null&&ox(p,m,d,b,!0)))}t:{if(u=c?cl(c):window,d=u.nodeName&&u.nodeName.toLowerCase(),d==="select"||d==="input"&&u.type==="file")var T=p_;else if(d_(u))if(uy)T=UE;else{T=DE;var A=RE}else d=u.nodeName,!d||d.toLowerCase()!=="input"||u.type!=="checkbox"&&u.type!=="radio"?c&&Im(c.elementType)&&(T=p_):T=NE;if(T&&(T=T(e,c))){cy(p,T,n,f);break t}A&&A(e,u,c)}switch(A=c?cl(c):window,e){case"focusin":(d_(A)||A.contentEditable==="true")&&(Br=A,Ip=c,pl=null);break;case"focusout":pl=Ip=Br=null;break;case"mousedown":Pp=!0;break;case"contextmenu":case"mouseup":case"dragend":Pp=!1,__(p,n,f);break;case"selectionchange":if(OE)break;case"keydown":case"keyup":__(p,n,f)}var E;if(Fm)t:{switch(e){case"compositionstart":var x="onCompositionStart";break t;case"compositionend":x="onCompositionEnd";break t;case"compositionupdate":x="onCompositionUpdate";break t}x=void 0}else Pr?oy(e,n)&&(x="onCompositionEnd"):e==="keydown"&&n.keyCode===229&&(x="onCompositionStart");x&&(ry&&n.locale!=="ko"&&(Pr||x!=="onCompositionStart"?x==="onCompositionEnd"&&Pr&&(E=sy()):(Ya=f,Bm="value"in Ya?Ya.value:Ya.textContent,Pr=!0)),A=sf(c,x),0<A.length&&(x=new c_(x,e,null,n,f),p.push({event:x,listeners:A}),E?x.data=E:(E=ly(n),E!==null&&(x.data=E)))),(E=TE?EE(e,n):AE(e,n))&&(x=sf(c,"onBeforeInput"),0<x.length&&(A=new c_("onBeforeInput","beforeinput",null,n,f),p.push({event:A,listeners:x}),A.data=E)),TA(p,e,c,n,f)}a1(p,t)})}function Il(e,t,n){return{instance:e,listener:t,currentTarget:n}}function sf(e,t){for(var n=t+"Capture",i=[];e!==null;){var a=e,s=a.stateNode;if(a=a.tag,a!==5&&a!==26&&a!==27||s===null||(a=Al(e,n),a!=null&&i.unshift(Il(e,a,s)),a=Al(e,t),a!=null&&i.push(Il(e,a,s))),e.tag===3)return i;e=e.return}return[]}function AA(e){if(e===null)return null;do e=e.return;while(e&&e.tag!==5&&e.tag!==27);return e||null}function ox(e,t,n,i,a){for(var s=t._reactName,r=[];n!==null&&n!==i;){var o=n,l=o.alternate,c=o.stateNode;if(o=o.tag,l!==null&&l===i)break;o!==5&&o!==26&&o!==27||c===null||(l=c,a?(c=Al(n,s),c!=null&&r.unshift(Il(n,c,l))):a||(c=Al(n,s),c!=null&&r.push(Il(n,c,l)))),n=n.return}r.length!==0&&e.push({event:t,listeners:r})}var wA=/\r\n?/g,CA=/\u0000|\uFFFD/g;function lx(e){return(typeof e=="string"?e:""+e).replace(wA,`
`).replace(CA,"")}function r1(e,t){return t=lx(t),lx(e)===t}function xe(e,t,n,i,a,s){switch(n){case"children":if(typeof i=="string")t==="body"||t==="textarea"&&i===""||no(e,i);else if(typeof i=="number"||typeof i=="bigint")t!=="body"&&no(e,""+i);else return;break;case"className":Kc(e,"class",i);break;case"tabIndex":Kc(e,"tabindex",i);break;case"dir":case"role":case"viewBox":case"width":case"height":Kc(e,n,i);break;case"style":iy(e,i,s);return;case"data":if(t!=="object"){Kc(e,"data",i);break}case"src":case"href":if(i===""&&(t!=="a"||n!=="href")){e.removeAttribute(n);break}if(i==null||typeof i=="function"||typeof i=="symbol"||typeof i=="boolean"){e.removeAttribute(n);break}i=pu(i),e.setAttribute(n,i);break;case"action":case"formAction":if(typeof i=="function"){e.setAttribute(n,"javascript:throw new Error('A React form was unexpectedly submitted. If you called form.submit() manually, consider using form.requestSubmit() instead. If you\\'re trying to use event.stopPropagation() in a submit event handler, consider also calling event.preventDefault().')");break}else typeof s=="function"&&(n==="formAction"?(t!=="input"&&xe(e,t,"name",a.name,a,null),xe(e,t,"formEncType",a.formEncType,a,null),xe(e,t,"formMethod",a.formMethod,a,null),xe(e,t,"formTarget",a.formTarget,a,null)):(xe(e,t,"encType",a.encType,a,null),xe(e,t,"method",a.method,a,null),xe(e,t,"target",a.target,a,null)));if(i==null||typeof i=="symbol"||typeof i=="boolean"){e.removeAttribute(n);break}i=pu(i),e.setAttribute(n,i);break;case"onClick":i!=null&&(e.onclick=Zi);return;case"onScroll":i!=null&&ee("scroll",e);return;case"onScrollEnd":i!=null&&ee("scrollend",e);return;case"dangerouslySetInnerHTML":if(i!=null){if(typeof i!="object"||!("__html"in i))throw Error(nt(61));if(n=i.__html,n!=null){if(a.children!=null)throw Error(nt(60));s?.__html!==n&&(e.innerHTML=n)}}break;case"multiple":e.multiple=i&&typeof i!="function"&&typeof i!="symbol";break;case"muted":e.muted=i&&typeof i!="function"&&typeof i!="symbol";break;case"suppressContentEditableWarning":case"suppressHydrationWarning":case"defaultValue":case"defaultChecked":case"innerHTML":case"ref":break;case"autoFocus":break;case"xlinkHref":if(i==null||typeof i=="function"||typeof i=="boolean"||typeof i=="symbol"){e.removeAttribute("xlink:href");break}n=pu(i),e.setAttributeNS("http://www.w3.org/1999/xlink","xlink:href",n);break;case"contentEditable":case"spellCheck":case"draggable":case"value":case"autoReverse":case"externalResourcesRequired":case"focusable":case"preserveAlpha":i!=null&&typeof i!="function"&&typeof i!="symbol"?e.setAttribute(n,i):e.removeAttribute(n);break;case"inert":case"allowFullScreen":case"async":case"autoPlay":case"controls":case"credentialless":case"default":case"defer":case"disabled":case"disablePictureInPicture":case"disableRemotePlayback":case"formNoValidate":case"hidden":case"loop":case"noModule":case"noValidate":case"open":case"playsInline":case"readOnly":case"required":case"reversed":case"scoped":case"seamless":case"itemScope":i&&typeof i!="function"&&typeof i!="symbol"?e.setAttribute(n,""):e.removeAttribute(n);break;case"capture":case"download":i===!0?e.setAttribute(n,""):i!==!1&&i!=null&&typeof i!="function"&&typeof i!="symbol"?e.setAttribute(n,i):e.removeAttribute(n);break;case"cols":case"rows":case"size":case"span":i!=null&&typeof i!="function"&&typeof i!="symbol"&&!isNaN(i)&&1<=i?e.setAttribute(n,i):e.removeAttribute(n);break;case"rowSpan":case"start":i==null||typeof i=="function"||typeof i=="symbol"||isNaN(i)?e.removeAttribute(n):e.setAttribute(n,i);break;case"popover":ee("beforetoggle",e),ee("toggle",e),du(e,"popover",i);break;case"xlinkActuate":da(e,"http://www.w3.org/1999/xlink","xlink:actuate",i);break;case"xlinkArcrole":da(e,"http://www.w3.org/1999/xlink","xlink:arcrole",i);break;case"xlinkRole":da(e,"http://www.w3.org/1999/xlink","xlink:role",i);break;case"xlinkShow":da(e,"http://www.w3.org/1999/xlink","xlink:show",i);break;case"xlinkTitle":da(e,"http://www.w3.org/1999/xlink","xlink:title",i);break;case"xlinkType":da(e,"http://www.w3.org/1999/xlink","xlink:type",i);break;case"xmlBase":da(e,"http://www.w3.org/XML/1998/namespace","xml:base",i);break;case"xmlLang":da(e,"http://www.w3.org/XML/1998/namespace","xml:lang",i);break;case"xmlSpace":da(e,"http://www.w3.org/XML/1998/namespace","xml:space",i);break;case"is":du(e,"is",i);break;case"innerText":case"textContent":return;default:if(!(2<n.length)||n[0]!=="o"&&n[0]!=="O"||n[1]!=="n"&&n[1]!=="N")n=JT.get(n)||n,du(e,n,i);else return}ue=!0}function xm(e,t,n,i,a,s){switch(n){case"style":iy(e,i,s);return;case"dangerouslySetInnerHTML":if(i!=null){if(typeof i!="object"||!("__html"in i))throw Error(nt(61));if(n=i.__html,n!=null){if(a.children!=null)throw Error(nt(60));s?.__html!==n&&(e.innerHTML=n)}}break;case"children":if(typeof i=="string")no(e,i);else if(typeof i=="number"||typeof i=="bigint")no(e,""+i);else return;break;case"onScroll":i!=null&&ee("scroll",e);return;case"onScrollEnd":i!=null&&ee("scrollend",e);return;case"onClick":i!=null&&(e.onclick=Zi);return;case"suppressContentEditableWarning":case"suppressHydrationWarning":case"innerHTML":case"ref":return;case"innerText":case"textContent":return;default:if(!Qx.hasOwnProperty(n))t:{if(n[0]==="o"&&n[1]==="n"&&(a=n.endsWith("Capture"),s=n.slice(2,a?n.length-7:void 0),t=e[Bn]||null,t=t!=null?t[n]:null,typeof t=="function"&&e.removeEventListener(s,t,a),typeof i=="function")){typeof t!="function"&&t!==null&&(n in e?e[n]=null:e.hasAttribute(n)&&e.removeAttribute(n)),e.addEventListener(s,i,a);break t}ue=!0,n in e?e[n]=i:i===!0?e.setAttribute(n,""):du(e,n,i)}return}ue=!0}function dn(e,t,n){switch(t){case"div":case"span":case"svg":case"path":case"a":case"g":case"p":case"li":break;case"img":ee("error",e),ee("load",e);var i=!1,a=!1,s;for(s in n)if(n.hasOwnProperty(s)){var r=n[s];if(r!=null)switch(s){case"src":i=!0;break;case"srcSet":a=!0;break;case"children":case"dangerouslySetInnerHTML":throw Error(nt(137,t));default:xe(e,t,s,r,n,null)}}a&&xe(e,t,"srcSet",n.srcSet,n,null),i&&xe(e,t,"src",n.src,n,null);return;case"input":ee("invalid",e);var o=s=r=a=null,l=null,c=null;for(i in n)if(n.hasOwnProperty(i)){var f=n[i];if(f!=null)switch(i){case"name":a=f;break;case"type":r=f;break;case"checked":l=f;break;case"defaultChecked":c=f;break;case"value":s=f;break;case"defaultValue":o=f;break;case"children":case"dangerouslySetInnerHTML":if(f!=null)throw Error(nt(137,t));break;default:xe(e,t,i,f,n,null)}}ty(e,s,o,l,c,r,a,!1);return;case"select":ee("invalid",e),i=r=s=null;for(a in n)if(n.hasOwnProperty(a)&&(o=n[a],o!=null))switch(a){case"value":s=o;break;case"defaultValue":r=o;break;case"multiple":i=o;default:xe(e,t,a,o,n,null)}t=s,n=r,e.multiple=!!i,t!=null?Wr(e,!!i,t,!1):n!=null&&Wr(e,!!i,n,!0);return;case"textarea":ee("invalid",e),s=a=i=null;for(r in n)if(n.hasOwnProperty(r)&&(o=n[r],o!=null))switch(r){case"value":i=o;break;case"defaultValue":a=o;break;case"children":s=o;break;case"dangerouslySetInnerHTML":if(o!=null)throw Error(nt(91));break;default:xe(e,t,r,o,n,null)}ny(e,i,a,s);return;case"option":for(l in n)n.hasOwnProperty(l)&&(i=n[l],i!=null)&&(l==="selected"?e.selected=i&&typeof i!="function"&&typeof i!="symbol":xe(e,t,l,i,n,null));return;case"dialog":ee("beforetoggle",e),ee("toggle",e),ee("cancel",e),ee("close",e);break;case"iframe":case"object":ee("load",e);break;case"video":case"audio":for(i=0;i<Ol.length;i++)ee(Ol[i],e);break;case"image":ee("error",e),ee("load",e);break;case"details":ee("toggle",e);break;case"embed":case"source":case"link":ee("error",e),ee("load",e);case"area":case"base":case"br":case"col":case"hr":case"keygen":case"meta":case"param":case"track":case"wbr":case"menuitem":for(c in n)if(n.hasOwnProperty(c)&&(i=n[c],i!=null))switch(c){case"children":case"dangerouslySetInnerHTML":throw Error(nt(137,t));default:xe(e,t,c,i,n,null)}return;default:if(Im(t)){for(f in n)n.hasOwnProperty(f)&&(i=n[f],i!==void 0&&xm(e,t,f,i,n,void 0));return}}for(o in n)n.hasOwnProperty(o)&&(i=n[o],i!=null&&xe(e,t,o,i,n,null))}var RA={};function DA(e,t,n,i){switch(t){case"div":case"span":case"svg":case"path":case"a":case"g":case"p":case"li":break;case"input":var a=null,s=null,r=null,o=null,l=null,c=null,f=null;for(d in n){var p=n[d];if(n.hasOwnProperty(d)&&p!=null)switch(d){case"checked":break;case"value":break;case"defaultValue":l=p;default:i.hasOwnProperty(d)||xe(e,t,d,null,i,p)}}for(var u in i){var d=i[u];if(p=n[u],i.hasOwnProperty(u)&&(d!=null||p!=null))switch(u){case"type":d!==p&&(ue=!0),s=d;break;case"name":d!==p&&(ue=!0),a=d;break;case"checked":d!==p&&(ue=!0),c=d;break;case"defaultChecked":d!==p&&(ue=!0),f=d;break;case"value":d!==p&&(ue=!0),r=d;break;case"defaultValue":d!==p&&(ue=!0),o=d;break;case"children":case"dangerouslySetInnerHTML":if(d!=null)throw Error(nt(137,t));break;default:d!==p&&xe(e,t,u,d,i,p)}}Np(e,r,o,l,c,f,s,a);return;case"select":d=r=o=u=null;for(s in n)if(l=n[s],n.hasOwnProperty(s)&&l!=null)switch(s){case"value":break;case"multiple":d=l;default:i.hasOwnProperty(s)||xe(e,t,s,null,i,l)}for(a in i)if(s=i[a],l=n[a],i.hasOwnProperty(a)&&(s!=null||l!=null))switch(a){case"value":s!==l&&(ue=!0),u=s;break;case"defaultValue":s!==l&&(ue=!0),o=s;break;case"multiple":s!==l&&(ue=!0),r=s;default:s!==l&&xe(e,t,a,s,i,l)}t=o,n=r,i=d,u!=null?Wr(e,!!n,u,!1):!!i!=!!n&&(t!=null?Wr(e,!!n,t,!0):Wr(e,!!n,n?[]:"",!1));return;case"textarea":d=u=null;for(o in n)if(a=n[o],n.hasOwnProperty(o)&&a!=null&&!i.hasOwnProperty(o))switch(o){case"value":break;case"children":break;default:xe(e,t,o,null,i,a)}for(r in i)if(a=i[r],s=n[r],i.hasOwnProperty(r)&&(a!=null||s!=null))switch(r){case"value":a!==s&&(ue=!0),u=a;break;case"defaultValue":a!==s&&(ue=!0),d=a;break;case"children":break;case"dangerouslySetInnerHTML":if(a!=null)throw Error(nt(91));break;default:a!==s&&xe(e,t,r,a,i,s)}ey(e,u,d);return;case"option":for(var _ in n)u=n[_],n.hasOwnProperty(_)&&u!=null&&!i.hasOwnProperty(_)&&(_==="selected"?e.selected=!1:xe(e,t,_,null,i,u));for(l in i)u=i[l],d=n[l],i.hasOwnProperty(l)&&u!==d&&(u!=null||d!=null)&&(l==="selected"?(u!==d&&(ue=!0),e.selected=u&&typeof u!="function"&&typeof u!="symbol"):xe(e,t,l,u,i,d));return;case"img":case"link":case"area":case"base":case"br":case"col":case"embed":case"hr":case"keygen":case"meta":case"param":case"source":case"track":case"wbr":case"menuitem":for(var b in n)u=n[b],n.hasOwnProperty(b)&&u!=null&&!i.hasOwnProperty(b)&&xe(e,t,b,null,i,u);for(c in i)if(u=i[c],d=n[c],i.hasOwnProperty(c)&&u!==d&&(u!=null||d!=null))switch(c){case"children":case"dangerouslySetInnerHTML":if(u!=null)throw Error(nt(137,t));break;default:xe(e,t,c,u,i,d)}return;default:if(Im(t)){for(var m in n)u=n[m],n.hasOwnProperty(m)&&u!==void 0&&!i.hasOwnProperty(m)&&xm(e,t,m,void 0,i,u);for(f in i)u=i[f],d=n[f],!i.hasOwnProperty(f)||u===d||u===void 0&&d===void 0||xm(e,t,f,u,i,d);return}}for(var h in n)u=n[h],n.hasOwnProperty(h)&&u!=null&&!i.hasOwnProperty(h)&&xe(e,t,h,null,i,u);for(p in i)u=i[p],d=n[p],!i.hasOwnProperty(p)||u===d||u==null&&d==null||xe(e,t,p,u,i,d)}function cx(e){switch(e){case"css":case"script":case"font":case"img":case"image":case"input":case"link":return!0;default:return!1}}function NA(){if(typeof performance.getEntriesByType=="function"){for(var e=0,t=0,n=performance.getEntriesByType("resource"),i=0;i<n.length;i++){var a=n[i],s=a.transferSize,r=a.initiatorType,o=a.duration;if(s&&o&&cx(r)){for(r=0,o=a.responseEnd,i+=1;i<n.length;i++){var l=n[i],c=l.startTime;if(c>o)break;var f=l.transferSize,p=l.initiatorType;f&&cx(p)&&(l=l.responseEnd,r+=f*(l<o?1:(o-c)/(l-c)))}if(--i,t+=8*(s+r)/(a.duration/1e3),e++,10<e)break}}if(0<e)return t/e/1e6}return navigator.connection&&(e=navigator.connection.downlink,typeof e=="number")?e:5}var ym=null,Sm=null;function Pl(e){return e.nodeType===9?e:e.ownerDocument}function ux(e){switch(e){case"http://www.w3.org/2000/svg":return 1;case"http://www.w3.org/1998/Math/MathML":return 2;default:return 0}}function o1(e,t){if(e===0)switch(t){case"svg":return 1;case"math":return 2;default:return 0}return e===1&&t==="foreignObject"?0:e}function l1(e,t,n,i){return n=Pl(n).createElement(e),n[cn]=i,n[Bn]=t,dn(n,e,t),an(n),n}function Mm(e,t){return e==="textarea"||e==="noscript"||typeof t.children=="string"||typeof t.children=="number"||typeof t.children=="bigint"||typeof t.dangerouslySetInnerHTML=="object"&&t.dangerouslySetInnerHTML!==null&&t.dangerouslySetInnerHTML.__html!=null}var gp=null;function UA(){var e=window.event;return e&&e.type==="popstate"?e===gp?!1:(gp=e,!0):(gp=null,!1)}var S0=typeof setTimeout=="function"?setTimeout:void 0,LA=typeof clearTimeout=="function"?clearTimeout:void 0,fx=typeof Promise=="function"?Promise:void 0,hx=typeof requestAnimationFrame=="function"?requestAnimationFrame:S0,OA=typeof queueMicrotask=="function"?queueMicrotask:typeof fx<"u"?function(e){return fx.resolve(null).then(e).catch(IA)}:S0;function IA(e){setTimeout(function(){throw e})}function ps(e){return e==="head"}function dx(e,t){var n=t,i=0;do{var a=n.nextSibling;if(e.removeChild(n),a&&a.nodeType===8)if(n=a.data,n==="/$"||n==="/&"){if(i===0){e.removeChild(a),ho(t);return}i--}else if(n==="$"||n==="$?"||n==="$~"||n==="$!"||n==="&")i++;else if(n==="html")_p(e.ownerDocument.documentElement);else if(n==="head"){n=e.ownerDocument.head,_p(n);for(var s=n.firstChild;s;){var r=s.nextSibling,o=s.nodeName;s[Wl]||o==="SCRIPT"||o==="STYLE"||o==="LINK"&&s.rel.toLowerCase()==="stylesheet"||n.removeChild(s),s=r}}else n==="body"&&_p(e.ownerDocument.body);n=a}while(n);ho(t)}function px(e,t){var n=e;e=0;do{var i=n.nextSibling;if(n.nodeType===1?t?(n._stashedDisplay=n.style.display,n.style.display="none"):(n.style.display=n._stashedDisplay||"",n.getAttribute("style")===""&&n.removeAttribute("style")):n.nodeType===3&&(t?(n._stashedText=n.nodeValue,n.nodeValue=""):n.nodeValue=n._stashedText||""),i&&i.nodeType===8)if(n=i.data,n==="/$"){if(e===0)break;e--}else n!=="$"&&n!=="$?"&&n!=="$~"&&n!=="$!"||e++;n=i}while(n)}function c1(e,t,n){if(t=CSS.escape(t)!==t?"r-"+btoa(t).replace(/=/g,""):t,e.style.viewTransitionName=t,n!=null&&(e.style.viewTransitionClass=n),n=getComputedStyle(e),n.display==="inline"){if(t=e.getClientRects(),t.length===1)var i=1;else for(var a=i=0;a<t.length;a++){var s=t[a];0<s.width&&0<s.height&&i++}i===1&&(e=e.style,e.display=t.length===1?"inline-block":"block",e.marginTop="-"+n.paddingTop,e.marginBottom="-"+n.paddingBottom)}}function u1(e,t){e=e.style,t=t.style;var n=t!=null?t.hasOwnProperty("viewTransitionName")?t.viewTransitionName:t.hasOwnProperty("view-transition-name")?t["view-transition-name"]:null:null;e.viewTransitionName=n==null||typeof n=="boolean"?"":(""+n).trim(),n=t!=null?t.hasOwnProperty("viewTransitionClass")?t.viewTransitionClass:t.hasOwnProperty("view-transition-class")?t["view-transition-class"]:null:null,e.viewTransitionClass=n==null||typeof n=="boolean"?"":(""+n).trim(),e.display==="inline-block"&&(t==null?e.display=e.margin="":(n=t.display,e.display=n==null||typeof n=="boolean"?"":n,n=t.margin,n!=null?e.margin=n:(n=t.hasOwnProperty("marginTop")?t.marginTop:t["margin-top"],e.marginTop=n==null||typeof n=="boolean"?"":n,t=t.hasOwnProperty("marginBottom")?t.marginBottom:t["margin-bottom"],e.marginBottom=t==null||typeof t=="boolean"?"":t)))}function f1(e,t,n){return n=n.ownerDocument.defaultView,{rect:e,abs:t.position==="absolute"||t.position==="fixed",clip:t.clipPath!=="none"||t.overflow!=="visible"||t.filter!=="none"||t.mask!=="none"||t.mask!=="none"||t.borderRadius!=="0px",view:0<=e.bottom&&0<=e.right&&e.top<=n.innerHeight&&e.left<=n.innerWidth}}function bm(e){var t=e.getBoundingClientRect(),n=getComputedStyle(e);return f1(t,n,e)}function PA(e){var t=e.getBoundingClientRect();t=new DOMRect(t.x+2e4,t.y+2e4,t.width,t.height);var n=getComputedStyle(e);return f1(t,n,e)}function BA(e){return e.documentElement.clientHeight}function zA(e){this.addEventListener("load",e),this.addEventListener("error",e)}function FA(e,t,n,i,a,s,r,o,l){var c=t.nodeType===9?t:t.ownerDocument;try{var f=c.startViewTransition({update:function(){var u=c.defaultView,d=u.navigation&&u.navigation.transition,_=c.fonts.status;i();var b=[];if(_==="loaded"&&(BA(c),c.fonts.status==="loading"&&b.push(c.fonts.ready)),_=b.length,e!==null)for(var m=e.suspenseyImages,h=0,g=0;g<m.length;g++){var S=m[g];if(!S.complete){var y=S.getBoundingClientRect();if(0<y.bottom&&0<y.right&&y.top<u.innerHeight&&y.left<u.innerWidth){if(h+=b1(S),h>Ru){b.length=_;break}S=new Promise(zA.bind(S)),b.push(S)}}}if(0<b.length)return u=Promise.race([Promise.all(b),new Promise(function(T){return setTimeout(T,500)})]).then(a,a),(d?Promise.allSettled([d.finished,u]):u).then(s,s);if(a(),d)return d.finished.then(s,s);s()},types:n});c.__reactViewTransition=f;var p=[];return f.ready.then(function(){for(var u=c.documentElement.getAnimations({subtree:!0}),d=0;d<u.length;d++){var _=u[d],b=_.effect,m=b.pseudoElement;if(m!=null&&m.startsWith("::view-transition")){p.push(_),_=b.getKeyframes();for(var h=m=void 0,g=!0,S=0;S<_.length;S++){var y=_[S],T=y.width;if(m===void 0)m=T;else if(m!==T){g=!1;break}if(T=y.height,h===void 0)h=T;else if(h!==T){g=!1;break}delete y.width,delete y.height,y.transform==="none"&&delete y.transform}g&&m!==void 0&&h!==void 0&&(b.setKeyframes(_),g=getComputedStyle(b.target,b.pseudoElement),g.width!==m||g.height!==h)&&(g=_[0],g.width=m,g.height=h,g=_[_.length-1],g.width=m,g.height=h,b.setKeyframes(_))}}r()},function(u){c.__reactViewTransition===f&&(c.__reactViewTransition=null);try{typeof u=="object"&&u!==null&&u.name==="InvalidStateError"&&(u.message==="View transition was skipped because document visibility state is hidden."||u.message==="Skipping view transition because document visibility state has become hidden."||u.message==="Skipping view transition because viewport size changed."||u.message==="Transition was aborted because of invalid state")&&(u=null),u!==null&&l(u)}finally{i(),a(),r()}}),f.finished.finally(function(){for(var u=0;u<p.length;u++)p[u].cancel();c.__reactViewTransition===f&&(c.__reactViewTransition=null),o()}),f}catch{return i(),a(),r(),null}}function Vs(e,t){this._scope=document.documentElement,this._selector="::view-transition-"+e+"("+t+")"}Vs.prototype.animate=function(e,t){return t=typeof t=="number"?{duration:t}:Ae({},t),t.pseudoElement=this._selector,this._scope.animate(e,t)};Vs.prototype.getAnimations=function(){for(var e=this._scope,t=this._selector,n=e.getAnimations({subtree:!0}),i=[],a=0;a<n.length;a++){var s=n[a].effect;s!==null&&s.target===e&&s.pseudoElement===t&&i.push(n[a])}return i};Vs.prototype.getComputedStyle=function(){return getComputedStyle(this._scope,this._selector)};function h1(e){return{name:e,group:new Vs("group",e),imagePair:new Vs("image-pair",e),old:new Vs("old",e),new:new Vs("new",e)}}function $n(e){this._fragmentFiber=e,this._observers=this._eventListeners=null}$n.prototype.addEventListener=function(e,t,n){var i=null,a=null;if(!(n!=null&&typeof n!="boolean"&&(i=n.signal||null,i!==null&&i.aborted))){this._eventListeners===null&&(this._eventListeners=[]);var s=this._eventListeners;if(d1(s,e,t,n)===-1){var r=this,o=t;n!=null&&typeof n!="boolean"&&n.once===!0&&(o=function(l){r.removeEventListener(e,t,n),typeof t=="function"?t.call(this,l):t.handleEvent(l)}),i!==null&&(a=r.removeEventListener.bind(r,e,t,n),i.addEventListener("abort",a,{once:!0}),a=i.removeEventListener.bind(i,"abort",a)),i=lo(n),s.push({type:e,listener:t,optionsOrUseCapture:n,attachedListener:o,cleanup:a}),Pn(this._fragmentFiber.child,!1,HA,e,o,i)}this._eventListeners=s}};function HA(e,t,n,i){return Qe(e).addEventListener(t,n,i),!1}$n.prototype.removeEventListener=function(e,t,n){var i=this._eventListeners;if(i!==null&&(t=d1(i,e,t,n),t!==-1)){var a=i[t];n=a.attachedListener;var s=a.cleanup;a=lo(a.optionsOrUseCapture),Pn(this._fragmentFiber.child,!1,VA,e,n,a),i.splice(t,1),s!==null&&s()}};function VA(e,t,n,i){return Qe(e).removeEventListener(t,n,i),!1}function lo(e){return e!=null&&typeof e!="boolean"&&(e.once===!0||e.signal instanceof AbortSignal)?{capture:e.capture,passive:e.passive}:e}function mx(e){return e==null?"c=0":typeof e=="boolean"?"c="+(e?"1":"0"):"c="+(e.capture?"1":"0")}function d1(e,t,n,i){if(e.length===0)return-1;i=mx(i);for(var a=0;a<e.length;a++){var s=e[a];if(s.type===t&&s.listener===n&&mx(s.optionsOrUseCapture)===i)return a}return-1}$n.prototype.dispatchEvent=function(e){var t=er(this._fragmentFiber);if(t===null)return!0;t=Qe(t);var n=this._eventListeners;if(n!==null&&0<n.length||!e.bubbles){var i=t.nodeType===9?t.createComment(""):document.createTextNode("");if(n)for(var a=0;a<n.length;a++){var s=n[a];i.addEventListener(s.type,s.attachedListener,lo(s.optionsOrUseCapture))}if(t.appendChild(i),e=i.dispatchEvent(e),n)for(a=0;a<n.length;a++)s=n[a],i.removeEventListener(s.type,s.attachedListener,lo(s.optionsOrUseCapture));return t.removeChild(i),e}return t.dispatchEvent(e)};$n.prototype.focus=function(e){Pn(this._fragmentFiber.child,!0,p1,e,void 0,void 0)};function p1(e,t){return e.tag===6?!1:(e=Qe(e),$A(e,t))}$n.prototype.focusLast=function(e){var t=[];Pn(this._fragmentFiber.child,!0,M0,t,void 0,void 0);for(var n=t.length-1;0<=n&&!p1(t[n],e);n--);};function M0(e,t){return t.push(e),!1}$n.prototype.blur=function(){var e=er(this._fragmentFiber);e!==null&&(e=Qe(e),e=Pl(e).activeElement,e!==null&&Pn(this._fragmentFiber.child,!1,GA,e,void 0,void 0))};function GA(e,t){return e.tag===6?!1:(e=Qe(e),e===t||e.contains(t)?(t.blur(),!0):!1)}$n.prototype.observeUsing=function(e){this._observers===null&&(this._observers=new Set),this._observers.add(e),Pn(this._fragmentFiber.child,!1,kA,e,void 0,void 0)};function kA(e,t){return e.tag===6||(e=Qe(e),t.observe(e)),!1}$n.prototype.unobserveUsing=function(e){var t=this._observers;if(t!==null&&t.has(e)){t.delete(e),Pn(this._fragmentFiber.child,!1,XA,e,void 0,void 0);for(var n=t=0;n<Ei.length;n++){var i=Ei[n];i.fragmentInstance===this&&i.observer===e?e.unobserve(i.instance):Ei[t++]=i}Ei.length=t}};function XA(e,t){return e.tag===6||(e=Qe(e),t.unobserve(e)),!1}var Ei=[],vp=!1;function WA(e,t,n){Ei.push({fragmentInstance:e,observer:t,instance:n}),vp||(vp=!0,tw(function(){vp=!1;var i=Ei;Ei=[];for(var a=0;a<i.length;a++){var s=i[a];s.observer.unobserve(s.instance)}}))}$n.prototype.getClientRects=function(){var e=[];return Pn(this._fragmentFiber.child,!1,qA,e,void 0,void 0),e};function qA(e,t){if(e.tag===6){e=e.stateNode;var n=e.ownerDocument.createRange();n.selectNodeContents(e),t.push.apply(t,n.getClientRects())}else e=Qe(e),t.push.apply(t,e.getClientRects());return!1}$n.prototype.getRootNode=function(e){var t=er(this._fragmentFiber);return t===null?this:Qe(t).getRootNode(e)};$n.prototype.compareDocumentPosition=function(e){var t=er(this._fragmentFiber);if(t===null)return Node.DOCUMENT_POSITION_DISCONNECTED;var n=[];Pn(this._fragmentFiber.child,!1,M0,n,void 0,void 0);var i=Qe(t);if(n.length===0){if(n=i,Zv(this._fragmentFiber)){t:{for(t=this._fragmentFiber.return;t!==null;){if(t.tag===4){t=t.stateNode.containerInfo;break t}if(t.tag===3||t.tag===5||t.tag===27)break;t=t.return}t=null}t!=null&&(n=t)}t=this._fragmentFiber;var a=i=n.compareDocumentPosition(e);return n===e?a=Node.DOCUMENT_POSITION_CONTAINS:i&Node.DOCUMENT_POSITION_CONTAINED_BY&&(n=Px(t)[1],n===null?a=Node.DOCUMENT_POSITION_PRECEDING:(e=Qe(n).compareDocumentPosition(e),a=e===0||e&Node.DOCUMENT_POSITION_FOLLOWING?Node.DOCUMENT_POSITION_FOLLOWING:Node.DOCUMENT_POSITION_PRECEDING)),a|=Node.DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC}t=Qe(n[0]),a=Qe(n[n.length-1]);var s=Zv(this._fragmentFiber)?t.parentElement:i;if(s==null)return Node.DOCUMENT_POSITION_DISCONNECTED;i=s.compareDocumentPosition(t)&Node.DOCUMENT_POSITION_CONTAINED_BY,s=s.compareDocumentPosition(a)&Node.DOCUMENT_POSITION_CONTAINED_BY;var r=t.compareDocumentPosition(e),o=a.compareDocumentPosition(e),l=r&Node.DOCUMENT_POSITION_CONTAINED_BY||o&Node.DOCUMENT_POSITION_CONTAINED_BY;return o=i&&s&&r&Node.DOCUMENT_POSITION_FOLLOWING&&o&Node.DOCUMENT_POSITION_PRECEDING,t=i&&t===e||s&&a===e||l||o?Node.DOCUMENT_POSITION_CONTAINED_BY:!i&&t===e||!s&&a===e?Node.DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC:r,t&Node.DOCUMENT_POSITION_DISCONNECTED||t&Node.DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC||YA(t,this._fragmentFiber,n[0],n[n.length-1],e)?t:Node.DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC};function YA(e,t,n,i,a){var s=Hs(a);if(e&Node.DOCUMENT_POSITION_CONTAINED_BY){if(n=!!s)t:{for(;s!==null;){if(s.tag===7&&(s===t||s.alternate===t)){n=!0;break t}s=s.return}n=!1}return n}if(e&Node.DOCUMENT_POSITION_CONTAINS){if(s===null)return s=a.ownerDocument,a===s||a===s.documentElement||a===s.body;t:{for(s=t,t=er(t);s!==null;){if(!(s.tag!==5&&s.tag!==3&&s.tag!==27||s!==t&&s.alternate!==t)){s=!0;break t}s=s.return}s=!1}return s}return e&Node.DOCUMENT_POSITION_PRECEDING?((t=!!s)&&!(t=s===n)&&(t=yp(n,s,Jv),t===null?t=!1:(Pn(t,!0,bT,s,n),s=Ur,Ur=null,t=s!==null)),t):e&Node.DOCUMENT_POSITION_FOLLOWING?((t=!!s)&&!(t=s===i)&&(t=yp(i,s,Jv),t===null?t=!1:(Pn(t,!0,TT,s,i),s=Ur,xp=Ur=null,t=s!==null)),t):!1}function gx(e,t){var n=e.ownerDocument.createRange();n.selectNodeContents(e),e=n.getBoundingClientRect(),window.scrollTo(window.scrollX+e.left,t?window.scrollY+e.top:window.scrollY+e.bottom-window.innerHeight)}$n.prototype.scrollIntoView=function(e){if(typeof e=="object")throw Error(nt(566));var t=[];Pn(this._fragmentFiber.child,!1,M0,t,void 0,void 0);var n=e!==!1;if(t.length===0){var i=Px(this._fragmentFiber);if(i=n?i[1]||i[0]||er(this._fragmentFiber):i[0]||i[1],i===null)return;if(i.tag===6){e=Qe(i),gx(e,n);return}if(i=Qe(i),i.nodeType!==9){if(i.nodeType===11){n="host"in i?i.host:null,n!==null&&n.scrollIntoView(e);return}i.scrollIntoView(e)}}for(i=n?t.length-1:0;i!==(n?-1:t.length);){var a=t[i];a.tag===6?(a=Qe(a),gx(a,n)):Qe(a).scrollIntoView(e),i+=n?-1:1}};function ZA(e,t){return e=Qe(e),m1(e,t),!1}function m1(e,t){e.reactFragments==null&&(e.reactFragments=new Set),e.reactFragments.add(t)}function g1(e,t){var n=t._eventListeners;if(n!==null)for(var i=0;i<n.length;i++){var a=n[i];e.addEventListener(a.type,a.attachedListener,lo(a.optionsOrUseCapture))}e.nodeType!==3&&(n=t._observers,n!==null&&n.forEach(function(s){for(var r=0,o=0;o<Ei.length;o++){var l=Ei[o];(l.fragmentInstance!==t||l.observer!==s||l.instance!==e)&&(Ei[r++]=l)}Ei.length=r,s.observe(e)}),m1(e,t))}function JA(e,t){var n=t._eventListeners;if(n!==null)for(var i=0;i<n.length;i++){var a=n[i];e.removeEventListener(a.type,a.attachedListener,lo(a.optionsOrUseCapture))}e.nodeType!==3&&(n=t._observers,n!==null&&n.forEach(function(s){typeof s.rootMargin=="string"?WA(t,s,e):s.unobserve(e)}),e.reactFragments!=null&&e.reactFragments.delete(t))}function Tm(e){var t=e.firstChild;for(t&&t.nodeType===10&&(t=t.nextSibling);t;){var n=t;switch(t=t.nextSibling,n.nodeName){case"HTML":case"HEAD":case"BODY":Tm(n),cf(n);continue;case"SCRIPT":case"STYLE":continue;case"LINK":if(n.rel.toLowerCase()==="stylesheet")continue}e.removeChild(n)}}function KA(e,t,n,i){for(;e.nodeType===1;){var a=n;if(e.nodeName.toLowerCase()!==t.toLowerCase()){if(!i&&(e.nodeName!=="INPUT"||e.type!=="hidden"))break}else if(i){if(!e[Wl])switch(t){case"meta":if(!e.hasAttribute("itemprop"))break;return e;case"link":if(s=e.getAttribute("rel"),s==="stylesheet"&&e.hasAttribute("data-precedence"))break;if(s!==a.rel||e.getAttribute("href")!==(a.href==null||a.href===""?null:a.href)||e.getAttribute("crossorigin")!==(a.crossOrigin==null?null:a.crossOrigin)||e.getAttribute("title")!==(a.title==null?null:a.title))break;return e;case"style":if(e.hasAttribute("data-precedence"))break;return e;case"script":if(s=e.getAttribute("src"),(s!==(a.src==null?null:a.src)||e.getAttribute("type")!==(a.type==null?null:a.type)||e.getAttribute("crossorigin")!==(a.crossOrigin==null?null:a.crossOrigin))&&s&&e.hasAttribute("async")&&!e.hasAttribute("itemprop"))break;return e;default:return e}}else if(t==="input"&&e.type==="hidden"){var s=a.name==null?null:""+a.name;if(a.type==="hidden"&&e.getAttribute("name")===s)return e}else return e;if(e=pi(e.nextSibling),e===null)break}return null}function QA(e,t,n){if(t==="")return null;for(;e.nodeType!==3;)if((e.nodeType!==1||e.nodeName!=="INPUT"||e.type!=="hidden")&&!n||(e=pi(e.nextSibling),e===null))return null;return e}function v1(e,t){for(;e.nodeType!==8;)if((e.nodeType!==1||e.nodeName!=="INPUT"||e.type!=="hidden")&&!t||(e=pi(e.nextSibling),e===null))return null;return e}function Em(e){return e.data==="$?"||e.data==="$~"}function b0(e){return e.data==="$!"||e.data==="$?"&&e.ownerDocument.readyState!=="loading"}function jA(e,t){var n=e.ownerDocument;if(e.data==="$~")e._reactRetry=t;else if(e.data!=="$?"||n.readyState!=="loading")t();else{var i=function(){t(),n.removeEventListener("DOMContentLoaded",i)};n.addEventListener("DOMContentLoaded",i),e._reactRetry=i}}function pi(e){for(;e!=null;e=e.nextSibling){var t=e.nodeType;if(t===1||t===3)break;if(t===8){if(t=e.data,t==="$"||t==="$!"||t==="$?"||t==="$~"||t==="&"||t==="F!"||t==="F")break;if(t==="/$"||t==="/&")return null}}return e}var Am=null;function vx(e){e=e.nextSibling;for(var t=0;e;){if(e.nodeType===8){var n=e.data;if(n==="/$"||n==="/&"){if(t===0)return pi(e.nextSibling);t--}else n!=="$"&&n!=="$!"&&n!=="$?"&&n!=="$~"&&n!=="&"||t++}e=e.nextSibling}return null}function _x(e){e=e.previousSibling;for(var t=0;e;){if(e.nodeType===8){var n=e.data;if(n==="$"||n==="$!"||n==="$?"||n==="$~"||n==="&"){if(t===0)return e;t--}else n!=="/$"&&n!=="/&"||t++}e=e.previousSibling}return null}function $A(e,t){function n(){i=!0}if(e.ownerDocument.activeElement===e)return!0;var i=!1;try{e.ownerDocument.addEventListener("focus",n,!0),(e.focus||HTMLElement.prototype.focus).call(e,t)}finally{e.ownerDocument.removeEventListener("focus",n,!0)}return i}function tw(e){hx(function(){hx(function(t){return e(t)})})}function _1(e,t,n){switch(t=Pl(n),e){case"html":if(e=t.documentElement,!e)throw Error(nt(452));return e;case"head":if(e=t.head,!e)throw Error(nt(453));return e;case"body":if(e=t.body,!e)throw Error(nt(454));return e;default:throw Error(nt(451))}}function x1(e,t,n){for(var i in n){var a=n[i];n.hasOwnProperty(i)&&a!=null&&xe(e,t,i,null,RA,a)}n.dangerouslySetInnerHTML!=null&&(e.textContent=""),e.onclick===Zi&&(e.onclick=null),cf(e)}function _p(e){for(var t=e.attributes;t.length;)e.removeAttributeNode(t[0]);cf(e)}var mi=new Map,xx=new Set;function Bl(e){if(typeof e.getRootNode=="function"){var t=e.getRootNode();if(t.nodeType===9||t.nodeType===11)return t}return e.nodeType===9?e:e.ownerDocument}var wa=he.d;he.d={f:ew,r:nw,D:iw,C:aw,L:sw,m:rw,X:lw,S:ow,M:cw};function ew(){var e=wa.f(),t=bf();return e||t}function nw(e){var t=mo(e);t!==null&&t.tag===5&&t.type==="form"?iS(t):wa.r(e)}var xo=typeof document>"u"?null:document;function y1(e,t,n){var i=xo;if(i&&typeof t=="string"&&t){var a=fi(t);a='link[rel="'+e+'"][href="'+a+'"]',typeof n=="string"&&(a+='[crossorigin="'+n+'"]'),xx.has(a)||(xx.add(a),e={rel:e,crossOrigin:n,href:t},i.querySelector(a)===null&&(t=i.createElement("link"),dn(t,"link",e),an(t),i.head.appendChild(t)))}}function iw(e){wa.D(e),y1("dns-prefetch",e,null)}function aw(e,t){wa.C(e,t),y1("preconnect",e,t)}function sw(e,t,n){wa.L(e,t,n);var i=xo;if(i&&e&&t){var a='link[rel="preload"][as="'+fi(t)+'"]';t==="image"&&n&&n.imageSrcSet?(a+='[imagesrcset="'+fi(n.imageSrcSet)+'"]',typeof n.imageSizes=="string"&&(a+='[imagesizes="'+fi(n.imageSizes)+'"]')):a+='[href="'+fi(e)+'"]';var s=a;switch(t){case"style":s=co(e);break;case"script":s=yo(e)}if(!(mi.has(s)||(e=Ae({rel:"preload",href:t==="image"&&n&&n.imageSrcSet?void 0:e,as:t},n),mi.set(s,e),i.querySelector(a)!==null||t==="style"&&i.querySelector(Ql(s))||t==="script"&&i.querySelector(jl(s))))){var r=i.createElement("link");dn(r,"link",e),t==="style"&&(r[Pu]=!0,r.onload=r.onerror=function(){Jx(r)}),an(r),i.head.appendChild(r)}}}function rw(e,t){wa.m(e,t);var n=xo;if(n&&e){var i=t&&typeof t.as=="string"?t.as:"script",a='link[rel="modulepreload"][as="'+fi(i)+'"][href="'+fi(e)+'"]',s=a;switch(i){case"audioworklet":case"paintworklet":case"serviceworker":case"sharedworker":case"worker":case"script":s=yo(e)}if(!mi.has(s)&&(e=Ae({rel:"modulepreload",href:e},t),mi.set(s,e),n.querySelector(a)===null)){switch(i){case"audioworklet":case"paintworklet":case"serviceworker":case"sharedworker":case"worker":case"script":if(n.querySelector(jl(s)))return}i=n.createElement("link"),dn(i,"link",e),an(i),n.head.appendChild(i)}}}function ow(e,t,n){wa.S(e,t,n);var i=xo;if(i&&e){var a=Xr(i).hoistableStyles,s=co(e);t=t||"default";var r=a.get(s);if(!r){var o={loading:0,preload:null};if(r=i.querySelector(Ql(s)))o.loading=5;else{e=Ae({rel:"stylesheet",href:e,"data-precedence":t},n),(n=mi.get(s))&&T0(e,n);var l=r=i.createElement("link");an(l),dn(l,"link",e),l._p=new Promise(function(c,f){l.onload=c,l.onerror=f}),l.addEventListener("load",function(){o.loading|=1}),l.addEventListener("error",function(){o.loading|=2}),o.loading|=4,wu(r,t,i)}r={type:"stylesheet",instance:r,count:1,state:o},a.set(s,r)}}}function lw(e,t){wa.X(e,t);var n=xo;if(n&&e){var i=Xr(n).hoistableScripts,a=yo(e),s=i.get(a);s||(s=n.querySelector(jl(a)),s||(e=Ae({src:e,async:!0},t),(t=mi.get(a))&&E0(e,t),s=n.createElement("script"),an(s),dn(s,"link",e),n.head.appendChild(s)),s={type:"script",instance:s,count:1,state:null},i.set(a,s))}}function cw(e,t){wa.M(e,t);var n=xo;if(n&&e){var i=Xr(n).hoistableScripts,a=yo(e),s=i.get(a);s||(s=n.querySelector(jl(a)),s||(e=Ae({src:e,async:!0,type:"module"},t),(t=mi.get(a))&&E0(e,t),s=n.createElement("script"),an(s),dn(s,"link",e),n.head.appendChild(s)),s={type:"script",instance:s,count:1,state:null},i.set(a,s))}}function yx(e,t,n,i){var a=(a=ja.current)?Bl(a):null;if(!a)throw Error(nt(446));switch(e){case"meta":case"title":return null;case"style":return typeof n.precedence=="string"&&typeof n.href=="string"?(n=co(n.href),t=Xr(a).hoistableStyles,i=t.get(n),i||(i={type:"style",instance:null,count:0,state:null},t.set(n,i)),i):{type:"void",instance:null,count:0,state:null};case"link":if(n.rel==="stylesheet"&&typeof n.href=="string"&&typeof n.precedence=="string"){e=co(n.href);var s=Xr(a).hoistableStyles,r=s.get(e);if(r||(a=a.ownerDocument||a,r={type:"stylesheet",instance:null,count:0,state:{loading:0,preload:null}},s.set(e,r),(s=a.querySelector(Ql(e)))?s._p||(r.instance=s,r.state.loading=5):(s=mi.get(e),s||(s={rel:"preload",as:"style",href:n.href,crossOrigin:n.crossOrigin,integrity:n.integrity,media:n.media,hrefLang:n.hrefLang,referrerPolicy:n.referrerPolicy},mi.set(e,s)),uw(a,e,s,r.state))),t&&i===null)throw Error(nt(528,""));return r}if(t&&i!==null)throw Error(nt(529,""));return null;case"script":return t=n.async,n=n.src,typeof n=="string"&&t&&typeof t!="function"&&typeof t!="symbol"?(n=yo(n),t=Xr(a).hoistableScripts,i=t.get(n),i||(i={type:"script",instance:null,count:0,state:null},t.set(n,i)),i):{type:"void",instance:null,count:0,state:null};default:throw Error(nt(444,e))}}function co(e){return'href="'+fi(e)+'"'}function Ql(e){return'link[rel="stylesheet"]['+e+"]"}function S1(e){return Ae({},e,{"data-precedence":e.precedence,precedence:null})}function uw(e,t,n,i){if(t=e.querySelector('link[rel="preload"][as="style"]['+t+"]")){if(t[Pu]!==!0){i.loading=1;return}}else t=e.createElement("link"),t[Pu]=!0,t.onload=t.onerror=Jx.bind(null,t),dn(t,"link",n),an(t),e.head.appendChild(t);i.preload=t,t.addEventListener("load",function(){return i.loading|=1}),t.addEventListener("error",function(){return i.loading|=2})}function yo(e){return'[src="'+fi(e)+'"]'}function jl(e){return"script[async]"+e}function Sx(e,t,n){if(t.count++,t.instance===null)switch(t.type){case"style":var i=e.querySelector('style[data-href~="'+fi(n.href)+'"]');if(i)return t.instance=i,an(i),i;var a=Ae({},n,{"data-href":n.href,"data-precedence":n.precedence,href:null,precedence:null});return i=(e.ownerDocument||e).createElement("style"),an(i),dn(i,"style",a),wu(i,n.precedence,e),t.instance=i;case"stylesheet":a=co(n.href);var s=e.querySelector(Ql(a));if(s)return t.state.loading|=4,t.instance=s,an(s),s;i=S1(n),(a=mi.get(a))&&T0(i,a),s=(e.ownerDocument||e).createElement("link"),an(s);var r=s;return r._p=new Promise(function(o,l){r.onload=o,r.onerror=l}),dn(s,"link",i),t.state.loading|=4,wu(s,n.precedence,e),t.instance=s;case"script":return s=yo(n.src),(a=e.querySelector(jl(s)))?(t.instance=a,an(a),a):(i=n,(a=mi.get(s))&&(i=Ae({},n),E0(i,a)),e=e.ownerDocument||e,a=e.createElement("script"),an(a),dn(a,"link",i),e.head.appendChild(a),t.instance=a);case"void":return null;default:throw Error(nt(443,t.type))}else t.type==="stylesheet"&&(t.state.loading&4)===0&&(i=t.instance,t.state.loading|=4,wu(i,n.precedence,e));return t.instance}function wu(e,t,n){for(var i=n.querySelectorAll('link[rel="stylesheet"][data-precedence],style[data-precedence]'),a=i.length?i[i.length-1]:null,s=a,r=0;r<i.length;r++){var o=i[r];if(o.dataset.precedence===t)s=o;else if(s!==a)break}s?s.parentNode.insertBefore(e,s.nextSibling):(t=n.nodeType===9?n.head:n,t.insertBefore(e,t.firstChild))}function T0(e,t){e.crossOrigin==null&&(e.crossOrigin=t.crossOrigin),e.referrerPolicy==null&&(e.referrerPolicy=t.referrerPolicy),e.title==null&&(e.title=t.title)}function E0(e,t){e.crossOrigin==null&&(e.crossOrigin=t.crossOrigin),e.referrerPolicy==null&&(e.referrerPolicy=t.referrerPolicy),e.integrity==null&&(e.integrity=t.integrity)}var Cu=null;function Mx(e,t,n){if(Cu===null){var i=new Map,a=Cu=new Map;a.set(n,i)}else a=Cu,i=a.get(n),i||(i=new Map,a.set(n,i));if(i.has(e))return i;for(i.set(e,null),n=n.getElementsByTagName(e),a=0;a<n.length;a++){var s=n[a];if(!(s[Wl]||s[cn]||e==="link"&&s.getAttribute("rel")==="stylesheet")&&s.namespaceURI!=="http://www.w3.org/2000/svg"){var r=s.getAttribute(t)||"";r=e+r;var o=i.get(r);o?o.push(s):i.set(r,[s])}}return i}function wm(e,t,n){e=e.ownerDocument||e,e.head.insertBefore(n,t==="title"?e.querySelector("head > title"):null)}function fw(e,t,n){if(n===1||t.itemProp!=null)return!1;switch(e){case"meta":case"title":return!0;case"style":if(typeof t.precedence!="string"||typeof t.href!="string"||t.href==="")break;return!0;case"link":if(typeof t.rel!="string"||typeof t.href!="string"||t.href===""||t.onLoad||t.onError)break;return t.rel==="stylesheet"?(e=t.disabled,typeof t.precedence=="string"&&e==null):!0;case"script":if(t.async&&typeof t.async!="function"&&typeof t.async!="symbol"&&!t.onLoad&&!t.onError&&t.src&&typeof t.src=="string")return!0}return!1}function bx(e,t){return e==="img"&&t.src!=null&&t.src!==""&&t.onLoad==null&&t.loading!=="lazy"}function M1(e){return!(e.type==="stylesheet"&&(e.state.loading&3)===0)}function b1(e){return(e.width||100)*(e.height||100)*(typeof devicePixelRatio=="number"?devicePixelRatio:1)*.25}function Tx(e,t){typeof t.decode=="function"&&(e.imgCount++,t.complete||(e.imgBytes+=b1(t),e.suspenseyImages.push(t)),e=pw.bind(e),t.decode().then(e,e))}function hw(e,t,n,i){if(n.type==="stylesheet"&&(typeof i.media!="string"||matchMedia(i.media).matches!==!1)&&(n.state.loading&4)===0){if(n.instance===null){var a=co(i.href),s=t.querySelector(Ql(a));if(s){t=s._p,t!==null&&typeof t=="object"&&typeof t.then=="function"&&(e.count++,e=zl.bind(e),t.then(e,e)),n.state.loading|=4,n.instance=s,an(s);return}s=t.ownerDocument||t,i=S1(i),(a=mi.get(a))&&T0(i,a),s=s.createElement("link"),an(s);var r=s;r._p=new Promise(function(o,l){r.onload=o,r.onerror=l}),dn(s,"link",i),n.instance=s}e.stylesheets===null&&(e.stylesheets=new Map),e.stylesheets.set(n,t),(t=n.state.preload)&&(n.state.loading&3)===0&&(e.count++,n=zl.bind(e),t.addEventListener("load",n),t.addEventListener("error",n))}}var Ru=0;function dw(e,t){return e.stylesheets&&e.count===0&&Du(e,e.stylesheets),0<e.count||0<e.imgCount?function(n){var i=setTimeout(function(){if(e.stylesheets&&Du(e,e.stylesheets),e.unsuspend){var s=e.unsuspend;e.unsuspend=null,s()}},6e4+t);0<e.imgBytes&&Ru===0&&(Ru=62500*NA());var a=setTimeout(function(){if(e.waitingForImages=!1,e.count===0&&(e.stylesheets&&Du(e,e.stylesheets),e.unsuspend)){var s=e.unsuspend;e.unsuspend=null,s()}},(e.imgBytes>Ru?50:800)+t);return e.unsuspend=n,function(){e.unsuspend=null,clearTimeout(i),clearTimeout(a)}}:null}function T1(e){if(e.count===0&&(e.imgCount===0||!e.waitingForImages)){if(e.stylesheets)Du(e,e.stylesheets);else if(e.unsuspend){var t=e.unsuspend;e.unsuspend=null,t()}}}function zl(){this.count--,T1(this)}function pw(){this.imgCount--,T1(this)}var rf=null;function Du(e,t){e.stylesheets=null,e.unsuspend!==null&&(e.count++,rf=new Map,t.forEach(mw,e),rf=null,zl.call(e))}function mw(e,t){if(!(t.state.loading&4)){var n=rf.get(e);if(n)var i=n.get(null);else{n=new Map,rf.set(e,n);for(var a=e.querySelectorAll("link[data-precedence],style[data-precedence]"),s=0;s<a.length;s++){var r=a[s];(r.nodeName==="LINK"||r.getAttribute("media")!=="not all")&&(n.set(r.dataset.precedence,r),i=r)}i&&n.set(null,i)}a=t.instance,r=a.getAttribute("data-precedence"),s=n.get(r)||i,s===i&&n.set(null,a),n.set(r,a),this.count++,i=zl.bind(this),a.addEventListener("load",i),a.addEventListener("error",i),s?s.parentNode.insertBefore(a,s.nextSibling):(e=e.nodeType===9?e.head:e,e.insertBefore(a,e.firstChild)),t.state.loading|=4}}var uo={$$typeof:Yi,Provider:null,Consumer:null,_currentValue:Gs,_currentValue2:Gs,_threadCount:0};function gw(e,t,n,i,a,s,r,o,l){this.tag=1,this.containerInfo=e,this.pingCache=this.current=this.pendingChildren=null,this.timeoutHandle=-1,this.callbackNode=this.next=this.pendingContext=this.context=this.cancelPendingCommit=null,this.callbackPriority=0,this.expirationTimes=qd(-1),this.entangledLanes=this.shellSuspendCounter=this.errorRecoveryDisabledLanes=this.expiredLanes=this.warmLanes=this.pingedLanes=this.suspendedLanes=this.pendingLanes=0,this.entanglements=qd(0),this.hiddenUpdates=qd(null),this.identifierPrefix=i,this.onUncaughtError=a,this.onCaughtError=s,this.onRecoverableError=r,this.pooledCache=null,this.pooledCacheLanes=0,this.formState=l,this.transitionTypes=null,this.incompleteTransitions=new Map}function E1(e,t,n,i,a,s,r,o,l,c,f,p){return e=new gw(e,t,n,r,l,c,f,p,o),t=1,s===!0&&(t|=24),s=On(3,null,null,t),e.current=s,s.stateNode=e,t=Wm(),t.refCount++,e.pooledCache=t,t.refCount++,s.memoizedState={element:i,isDehydrated:n,cache:t},Zm(s),e}function A1(e){return e?(e=Hr,e):Hr}function w1(e,t,n,i,a,s){a=A1(a),i.context===null?i.context=a:i.pendingContext=a,i=ts(t),i.payload={element:n},s=s===void 0?null:s,s!==null&&(i.callback=s),n=es(e,i,t),n!==null&&(In(n,e,t),gl(n,e,t))}function Ex(e,t){if(e=e.memoizedState,e!==null&&e.dehydrated!==null){var n=e.retryLane;e.retryLane=n!==0&&n<t?n:t}}function A0(e,t){Ex(e,t),(e=e.alternate)&&Ex(e,t)}function C1(e){if(e.tag===13||e.tag===31){var t=ar(e,67108864);t!==null&&In(t,e,67108864),A0(e,67108864)}}function Ax(e){if(e.tag===13||e.tag===31){var t=Qn();t=Lm(t);var n=ar(e,t);n!==null&&In(n,e,t),A0(e,t)}}var fo=!0;function vw(e,t,n,i){var a=Ht.T;Ht.T=null;var s=he.p;try{he.p=2,w0(e,t,n,i)}finally{he.p=s,Ht.T=a}}function _w(e,t,n,i){var a=Ht.T;Ht.T=null;var s=he.p;try{he.p=8,w0(e,t,n,i)}finally{he.p=s,Ht.T=a}}function w0(e,t,n,i){if(fo){var a=Cm(i);if(a===null)mp(e,t,i,of,n),wx(e,i);else if(yw(a,e,t,n,i))i.stopPropagation();else if(wx(e,i),t&4&&-1<xw.indexOf(e)){for(;a!==null;){var s=mo(a);if(s!==null)switch(s.tag){case 3:if(s=s.stateNode,s.current.memoizedState.isDehydrated){var r=Bs(s.pendingLanes);if(r!==0){var o=s;for(o.pendingLanes|=2,o.entangledLanes|=2;r;){var l=1<<31-Kn(r);o.entanglements[1]|=l,r&=~l}ea(s),(fe&6)===0&&(tf=Zn()+500,Kl(0,!1))}}break;case 31:case 13:o=ar(s,2),o!==null&&In(o,s,2),bf(),A0(s,2)}if(s=Cm(i),s===null&&mp(e,t,i,of,n),s===a)break;a=s}a!==null&&i.stopPropagation()}else mp(e,t,i,null,n)}}function Cm(e){return e=Pm(e),C0(e)}var of=null;function C0(e){if(of=null,e=Hs(e),e!==null){var t=Vl(e);if(t===null)e=null;else{var n=t.tag;if(n===13){if(e=Lx(t),e!==null)return e;e=null}else if(n===31){if(e=Ox(t),e!==null)return e;e=null}else if(n===3){if(t.stateNode.current.memoizedState.isDehydrated)return t.tag===3?t.stateNode.containerInfo:null;e=null}else t!==e&&(e=null)}}return of=e,null}function R1(e){switch(e){case"beforetoggle":case"cancel":case"click":case"close":case"contextmenu":case"copy":case"cut":case"auxclick":case"dblclick":case"dragend":case"dragstart":case"drop":case"focusin":case"focusout":case"input":case"invalid":case"keydown":case"keypress":case"keyup":case"mousedown":case"mouseup":case"paste":case"pause":case"play":case"pointercancel":case"pointerdown":case"pointerup":case"ratechange":case"reset":case"seeked":case"submit":case"toggle":case"touchcancel":case"touchend":case"touchstart":case"volumechange":case"change":case"selectionchange":case"textInput":case"compositionstart":case"compositionend":case"compositionupdate":case"beforeblur":case"afterblur":case"beforeinput":case"blur":case"fullscreenchange":case"fullscreenerror":case"focus":case"hashchange":case"popstate":case"select":case"selectstart":return 2;case"drag":case"dragenter":case"dragexit":case"dragleave":case"dragover":case"mousemove":case"mouseout":case"mouseover":case"pointermove":case"pointerout":case"pointerover":case"resize":case"scroll":case"touchmove":case"wheel":case"mouseenter":case"mouseleave":case"pointerenter":case"pointerleave":return 8;case"message":switch(LT()){case Hx:return 2;case Vx:return 8;case Iu:case OT:return 32;case Gx:return 268435456;default:return 32}default:return 32}}var Rm=!1,ss=null,rs=null,os=null,Fl=new Map,Hl=new Map,Wa=[],xw="mousedown mouseup touchcancel touchend touchstart auxclick dblclick pointercancel pointerdown pointerup dragend dragstart drop compositionend compositionstart keydown keypress keyup input textInput copy cut paste click change contextmenu reset".split(" ");function wx(e,t){switch(e){case"focusin":case"focusout":ss=null;break;case"dragenter":case"dragleave":rs=null;break;case"mouseover":case"mouseout":os=null;break;case"pointerover":case"pointerout":Fl.delete(t.pointerId);break;case"gotpointercapture":case"lostpointercapture":Hl.delete(t.pointerId)}}function sl(e,t,n,i,a,s){return e===null||e.nativeEvent!==s?(e={blockedOn:t,domEventName:n,eventSystemFlags:i,nativeEvent:s,targetContainers:[a]},t!==null&&(t=mo(t),t!==null&&C1(t)),e):(e.eventSystemFlags|=i,t=e.targetContainers,a!==null&&t.indexOf(a)===-1&&t.push(a),e)}function yw(e,t,n,i,a){switch(t){case"focusin":return ss=sl(ss,e,t,n,i,a),!0;case"dragenter":return rs=sl(rs,e,t,n,i,a),!0;case"mouseover":return os=sl(os,e,t,n,i,a),!0;case"pointerover":var s=a.pointerId;return Fl.set(s,sl(Fl.get(s)||null,e,t,n,i,a)),!0;case"gotpointercapture":return s=a.pointerId,Hl.set(s,sl(Hl.get(s)||null,e,t,n,i,a)),!0}return!1}function D1(e){var t=Hs(e.target);if(t!==null){var n=Vl(t);if(n!==null){if(t=n.tag,t===13){if(t=Lx(n),t!==null){e.blockedOn=t,$v(e.priority,function(){Ax(n)});return}}else if(t===31){if(t=Ox(n),t!==null){e.blockedOn=t,$v(e.priority,function(){Ax(n)});return}}else if(t===3&&n.stateNode.current.memoizedState.isDehydrated){e.blockedOn=n.tag===3?n.stateNode.containerInfo:null;return}}}e.blockedOn=null}function Nu(e){if(e.blockedOn!==null)return!1;for(var t=e.targetContainers;0<t.length;){var n=Cm(e.nativeEvent);if(n===null){n=e.nativeEvent;var i=new n.constructor(n.type,n);Up=i,n.target.dispatchEvent(i),Up=null}else return t=mo(n),t!==null&&C1(t),e.blockedOn=n,!1;t.shift()}return!0}function Cx(e,t,n){Nu(e)&&n.delete(t)}function Sw(){Rm=!1,ss!==null&&Nu(ss)&&(ss=null),rs!==null&&Nu(rs)&&(rs=null),os!==null&&Nu(os)&&(os=null),Fl.forEach(Cx),Hl.forEach(Cx)}function fu(e,t){e.blockedOn===t&&(e.blockedOn=null,Rm||(Rm=!0,je.unstable_scheduleCallback(je.unstable_NormalPriority,Sw)))}var hu=null;function Rx(e){hu!==e&&(hu=e,je.unstable_scheduleCallback(je.unstable_NormalPriority,function(){hu===e&&(hu=null);for(var t=0;t<e.length;t+=3){var n=e[t],i=e[t+1],a=e[t+2];if(typeof i!="function"){if(C0(i||n)===null)continue;break}var s=mo(n);s!==null&&(e.splice(t,3),t-=3,Zp(s,{pending:!0,data:a,method:n.method,action:i},i,a))}}))}function ho(e){function t(l){return fu(l,e)}ss!==null&&fu(ss,e),rs!==null&&fu(rs,e),os!==null&&fu(os,e),Fl.forEach(t),Hl.forEach(t);for(var n=0;n<Wa.length;n++){var i=Wa[n];i.blockedOn===e&&(i.blockedOn=null)}for(;0<Wa.length&&(n=Wa[0],n.blockedOn===null);)D1(n),n.blockedOn===null&&Wa.shift();if(n=(e.ownerDocument||e).$$reactFormReplay,n!=null)for(i=0;i<n.length;i+=3){var a=n[i],s=n[i+1],r=a[Bn]||null;if(typeof s=="function")r||Rx(n);else if(r){var o=null;if(s&&s.hasAttribute("formAction")){if(a=s,r=s[Bn]||null)o=r.formAction;else if(C0(a)!==null)continue}else o=r.action;typeof o=="function"?n[i+1]=o:(n.splice(i,3),i-=3),Rx(n)}}}function N1(){function e(s){s.canIntercept&&s.info==="react-transition"&&s.intercept({handler:function(){return new Promise(function(r){return a=r})},focusReset:"manual",scroll:"manual"})}function t(){a!==null&&(a(),a=null),i||setTimeout(n,20)}function n(){if(!i&&!navigation.transition){var s=navigation.currentEntry;s&&s.url!=null&&navigation.navigate(s.url,{state:s.getState(),info:"react-transition",history:"replace"})}}if(typeof navigation=="object"){var i=!1,a=null;return navigation.addEventListener("navigate",e),navigation.addEventListener("navigatesuccess",t),navigation.addEventListener("navigateerror",t),setTimeout(n,100),function(){i=!0,navigation.removeEventListener("navigate",e),navigation.removeEventListener("navigatesuccess",t),navigation.removeEventListener("navigateerror",t),a!==null&&(a(),a=null)}}}function R0(e){this._internalRoot=e}Af.prototype.render=R0.prototype.render=function(e){var t=this._internalRoot;if(t===null)throw Error(nt(409));var n=t.current,i=Qn();w1(n,i,e,t,null,null)};Af.prototype.unmount=R0.prototype.unmount=function(){var e=this._internalRoot;if(e!==null){this._internalRoot=null;var t=e.containerInfo;w1(e.current,2,null,e,null,null),bf(),t[po]=null}};function Af(e){this._internalRoot=e}Af.prototype.unstable_scheduleHydration=function(e){if(e){var t=Zx();e={blockedOn:null,target:e,priority:t};for(var n=0;n<Wa.length&&t!==0&&t<Wa[n].priority;n++);Wa.splice(n,0,e),n===0&&D1(e)}};var Dx=Nx.version;if(Dx!=="19.3.1")throw Error(nt(527,Dx,"19.3.1"));he.findDOMNode=function(e){var t=e._reactInternals;if(t===void 0)throw typeof e.render=="function"?Error(nt(188)):(e=Object.keys(e).join(","),Error(nt(268,e)));return e=MT(t),e=e!==null?Ix(e):null,e=e===null?null:e.stateNode,e};var Mw={bundleType:0,version:"19.3.1",rendererPackageName:"react-dom",currentDispatcherRef:Ht,reconcilerVersion:"19.3.1"};if(typeof __REACT_DEVTOOLS_GLOBAL_HOOK__<"u"&&(rl=__REACT_DEVTOOLS_GLOBAL_HOOK__,!rl.isDisabled&&rl.supportsFiber))try{Gl=rl.inject(Mw),Jn=rl}catch{}var rl;wf.createRoot=function(e,t){if(!Ux(e))throw Error(nt(299));var n=!1,i="",a=fS,s=hS,r=dS;return t!=null&&(t.unstable_strictMode===!0&&(n=!0),t.identifierPrefix!==void 0&&(i=t.identifierPrefix),t.onUncaughtError!==void 0&&(a=t.onUncaughtError),t.onCaughtError!==void 0&&(s=t.onCaughtError),t.onRecoverableError!==void 0&&(r=t.onRecoverableError)),t=E1(e,1,!1,null,null,n,i,null,a,s,r,N1),e[po]=t.current,y0(e),new R0(t)};wf.hydrateRoot=function(e,t,n){if(!Ux(e))throw Error(nt(299));var i=!1,a="",s=fS,r=hS,o=dS,l=null;return n!=null&&(n.unstable_strictMode===!0&&(i=!0),n.identifierPrefix!==void 0&&(a=n.identifierPrefix),n.onUncaughtError!==void 0&&(s=n.onUncaughtError),n.onCaughtError!==void 0&&(r=n.onCaughtError),n.onRecoverableError!==void 0&&(o=n.onRecoverableError),n.formState!==void 0&&(l=n.formState)),t=E1(e,1,!0,t,n??null,i,a,l,s,r,o,N1),t.context=A1(null),n=t.current,i=Qn(),i=Lm(i),a=ts(i),a.callback=null,es(n,a,i),n=i,t.current.lanes=n,Xl(t,n),ea(t),e[po]=t.current,y0(e),new Af(t)};wf.version="19.3.1"});var I1=Hi(($N,O1)=>{"use strict";function L1(){if(!(typeof __REACT_DEVTOOLS_GLOBAL_HOOK__>"u"||typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE!="function"))try{__REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(L1)}catch(e){console.error(e)}}L1(),O1.exports=U1()});var B1=Hi(Cf=>{"use strict";var bw=Symbol.for("react.transitional.element"),Tw=Symbol.for("react.fragment");function P1(e,t,n){var i=null;if(n!==void 0&&(i=""+n),t.key!==void 0&&(i=""+t.key),"key"in t){n={};for(var a in t)a!=="key"&&(n[a]=t[a])}else n=t;return t=n.ref,{$$typeof:bw,type:e,key:i,ref:t!==void 0?t:null,props:n}}Cf.Fragment=Tw;Cf.jsx=P1;Cf.jsxs=P1});var F1=Hi((eU,z1)=>{"use strict";z1.exports=B1()});var Bc=Hc(Ko()),Fb=Hc(I1());var Zo=Hc(F1(),1),Gt=Hc(Ko(),1);var sM=0,ag=1,rM=2;var yc=1,oM=2,Vo=3,ws=0,Dn=1,la=2,ca=0,Cs=1,sg=2,rg=3,og=4,lM=5;var mr=100,cM=101,uM=102,fM=103,hM=104,dM=200,pM=201,mM=202,gM=203,lg=204,cg=205,vM=206,_M=207,xM=208,yM=209,SM=210,MM=211,bM=212,TM=213,EM=214,Kf=0,Qf=1,jf=2,Io=3,$f=4,th=5,eh=6,nh=7,ug=0,AM=1,wM=2,Li=0,fg=1,hg=2,dg=3,pg=4,mg=5,gg=6,vg=7;var _g=300,Rs=301,gr=302,Ch=303,Rh=304,Sc=306,ih=1e3,ia=1001,ah=1002,on=1003,CM=1004;var Mc=1005;var mn=1006,Dh=1007;var Ds=1008;var ai=1009,xg=1010,yg=1011,Go=1012,Nh=1013,Oi=1014,Ii=1015,Pi=1016,Uh=1017,Lh=1018,ko=1020,Sg=35902,Mg=35899,bg=1021,Tg=1022,yi=1023,aa=1026,Ns=1027,Eg=1028,Oh=1029,Us=1030,Ih=1031;var Ph=1033,bc=33776,Tc=33777,Ec=33778,Ac=33779,Bh=35840,zh=35841,Fh=35842,Hh=35843,Vh=36196,Gh=37492,kh=37496,Xh=37488,Wh=37489,wc=37490,qh=37491,Yh=37808,Zh=37809,Jh=37810,Kh=37811,Qh=37812,jh=37813,$h=37814,td=37815,ed=37816,nd=37817,id=37818,ad=37819,sd=37820,rd=37821,od=36492,ld=36494,cd=36495,ud=36283,fd=36284,Cc=36285,hd=36286;var ac=2300,sh=2301,Zf=2302,j0=2303,$0=2400,tg=2401,eg=2402;var RM=3200;var Ag=0,DM=1,Oa="",ni="srgb",sc="srgb-linear",rc="linear",ve="srgb";var Jf=7680;var NM=519,UM=512,LM=513,OM=514,dd=515,IM=516,PM=517,pd=518,BM=519,zM=35044;var wg="300 es",Ui=2e3,oc=2001;function Ew(e){for(let t=e.length-1;t>=0;--t)if(e[t]>=65535)return!0;return!1}function Aw(e){return ArrayBuffer.isView(e)&&!(e instanceof DataView)}function lc(e){return document.createElementNS("http://www.w3.org/1999/xhtml",e)}function FM(){let e=lc("canvas");return e.style.display="block",e}var H1={},Po=null;function Cg(...e){let t="THREE."+e.shift();Po?Po("log",t,...e):console.log(t,...e)}function HM(e){let t=e[0];if(typeof t=="string"&&t.startsWith("TSL:")){let n=e[1];n&&n.isStackTrace?e[0]+=" "+n.getLocation():e[1]='Stack trace not available. Enable "THREE.Node.captureStackTrace" to capture stack traces.'}return e}function Ft(...e){e=HM(e);let t="THREE."+e.shift();if(Po)Po("warn",t,...e);else{let n=e[0];n&&n.isStackTrace?console.warn(n.getError(t)):console.warn(t,...e)}}function Vt(...e){e=HM(e);let t="THREE."+e.shift();if(Po)Po("error",t,...e);else{let n=e[0];n&&n.isStackTrace?console.error(n.getError(t)):console.error(t,...e)}}function fr(...e){let t=e.join(" ");t in H1||(H1[t]=!0,Ft(...e))}function VM(e,t,n){return new Promise(function(i,a){function s(){switch(e.clientWaitSync(t,e.SYNC_FLUSH_COMMANDS_BIT,0)){case e.WAIT_FAILED:a();break;case e.TIMEOUT_EXPIRED:setTimeout(s,n);break;default:i()}}setTimeout(s,n)})}var GM={[Kf]:Qf,[jf]:eh,[$f]:nh,[Io]:th,[Qf]:Kf,[eh]:jf,[nh]:$f,[th]:Io},sa=class{addEventListener(t,n){this._listeners===void 0&&(this._listeners={});let i=this._listeners;i[t]===void 0&&(i[t]=[]),i[t].indexOf(n)===-1&&i[t].push(n)}hasEventListener(t,n){let i=this._listeners;return i===void 0?!1:i[t]!==void 0&&i[t].indexOf(n)!==-1}removeEventListener(t,n){let i=this._listeners;if(i===void 0)return;let a=i[t];if(a!==void 0){let s=a.indexOf(n);s!==-1&&a.splice(s,1)}}dispatchEvent(t){let n=this._listeners;if(n===void 0)return;let i=n[t.type];if(i!==void 0){t.target=this;let a=i.slice(0);for(let s=0,r=a.length;s<r;s++)a[s].call(this,t);t.target=null}}},yn=["00","01","02","03","04","05","06","07","08","09","0a","0b","0c","0d","0e","0f","10","11","12","13","14","15","16","17","18","19","1a","1b","1c","1d","1e","1f","20","21","22","23","24","25","26","27","28","29","2a","2b","2c","2d","2e","2f","30","31","32","33","34","35","36","37","38","39","3a","3b","3c","3d","3e","3f","40","41","42","43","44","45","46","47","48","49","4a","4b","4c","4d","4e","4f","50","51","52","53","54","55","56","57","58","59","5a","5b","5c","5d","5e","5f","60","61","62","63","64","65","66","67","68","69","6a","6b","6c","6d","6e","6f","70","71","72","73","74","75","76","77","78","79","7a","7b","7c","7d","7e","7f","80","81","82","83","84","85","86","87","88","89","8a","8b","8c","8d","8e","8f","90","91","92","93","94","95","96","97","98","99","9a","9b","9c","9d","9e","9f","a0","a1","a2","a3","a4","a5","a6","a7","a8","a9","aa","ab","ac","ad","ae","af","b0","b1","b2","b3","b4","b5","b6","b7","b8","b9","ba","bb","bc","bd","be","bf","c0","c1","c2","c3","c4","c5","c6","c7","c8","c9","ca","cb","cc","cd","ce","cf","d0","d1","d2","d3","d4","d5","d6","d7","d8","d9","da","db","dc","dd","de","df","e0","e1","e2","e3","e4","e5","e6","e7","e8","e9","ea","eb","ec","ed","ee","ef","f0","f1","f2","f3","f4","f5","f6","f7","f8","f9","fa","fb","fc","fd","fe","ff"];var D0=Math.PI/180,rh=180/Math.PI;function Rc(){let e=Math.random()*4294967295|0,t=Math.random()*4294967295|0,n=Math.random()*4294967295|0,i=Math.random()*4294967295|0;return(yn[e&255]+yn[e>>8&255]+yn[e>>16&255]+yn[e>>24&255]+"-"+yn[t&255]+yn[t>>8&255]+"-"+yn[t>>16&15|64]+yn[t>>24&255]+"-"+yn[n&63|128]+yn[n>>8&255]+"-"+yn[n>>16&255]+yn[n>>24&255]+yn[i&255]+yn[i>>8&255]+yn[i>>16&255]+yn[i>>24&255]).toLowerCase()}function re(e,t,n){return Math.max(t,Math.min(n,e))}function ww(e,t){return(e%t+t)%t}function N0(e,t,n){return(1-n)*e+n*t}function $l(e,t){switch(t.constructor){case Float32Array:return e;case Uint32Array:return e/4294967295;case Uint16Array:return e/65535;case Uint8Array:case Uint8ClampedArray:return e/255;case Int32Array:return Math.max(e/2147483647,-1);case Int16Array:return Math.max(e/32767,-1);case Int8Array:return Math.max(e/127,-1);default:throw new Error("THREE.MathUtils: Invalid component type.")}}function zn(e,t){switch(t.constructor){case Float32Array:return e;case Uint32Array:return Math.round(e*4294967295);case Uint16Array:return Math.round(e*65535);case Uint8Array:case Uint8ClampedArray:return Math.round(e*255);case Int32Array:return Math.round(e*2147483647);case Int16Array:return Math.round(e*32767);case Int8Array:return Math.round(e*127);default:throw new Error("THREE.MathUtils: Invalid component type.")}}var oe=class e{static{e.prototype.isVector2=!0}constructor(t=0,n=0){this.x=t,this.y=n}get width(){return this.x}set width(t){this.x=t}get height(){return this.y}set height(t){this.y=t}set(t,n){return this.x=t,this.y=n,this}setScalar(t){return this.x=t,this.y=t,this}setX(t){return this.x=t,this}setY(t){return this.y=t,this}setComponent(t,n){switch(t){case 0:this.x=n;break;case 1:this.y=n;break;default:throw new Error("THREE.Vector2: index is out of range: "+t)}return this}getComponent(t){switch(t){case 0:return this.x;case 1:return this.y;default:throw new Error("THREE.Vector2: index is out of range: "+t)}}clone(){return new this.constructor(this.x,this.y)}copy(t){return this.x=t.x,this.y=t.y,this}add(t){return this.x+=t.x,this.y+=t.y,this}addScalar(t){return this.x+=t,this.y+=t,this}addVectors(t,n){return this.x=t.x+n.x,this.y=t.y+n.y,this}addScaledVector(t,n){return this.x+=t.x*n,this.y+=t.y*n,this}sub(t){return this.x-=t.x,this.y-=t.y,this}subScalar(t){return this.x-=t,this.y-=t,this}subVectors(t,n){return this.x=t.x-n.x,this.y=t.y-n.y,this}multiply(t){return this.x*=t.x,this.y*=t.y,this}multiplyScalar(t){return this.x*=t,this.y*=t,this}divide(t){return this.x/=t.x,this.y/=t.y,this}divideScalar(t){return this.multiplyScalar(1/t)}applyMatrix3(t){let n=this.x,i=this.y,a=t.elements;return this.x=a[0]*n+a[3]*i+a[6],this.y=a[1]*n+a[4]*i+a[7],this}min(t){return this.x=Math.min(this.x,t.x),this.y=Math.min(this.y,t.y),this}max(t){return this.x=Math.max(this.x,t.x),this.y=Math.max(this.y,t.y),this}clamp(t,n){return this.x=re(this.x,t.x,n.x),this.y=re(this.y,t.y,n.y),this}clampScalar(t,n){return this.x=re(this.x,t,n),this.y=re(this.y,t,n),this}clampLength(t,n){let i=this.length();return this.divideScalar(i||1).multiplyScalar(re(i,t,n))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this}negate(){return this.x=-this.x,this.y=-this.y,this}dot(t){return this.x*t.x+this.y*t.y}cross(t){return this.x*t.y-this.y*t.x}lengthSq(){return this.x*this.x+this.y*this.y}length(){return Math.sqrt(this.x*this.x+this.y*this.y)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)}normalize(){return this.divideScalar(this.length()||1)}angle(){return Math.atan2(-this.y,-this.x)+Math.PI}angleTo(t){let n=Math.sqrt(this.lengthSq()*t.lengthSq());if(n===0)return Math.PI/2;let i=this.dot(t)/n;return Math.acos(re(i,-1,1))}distanceTo(t){return Math.sqrt(this.distanceToSquared(t))}distanceToSquared(t){let n=this.x-t.x,i=this.y-t.y;return n*n+i*i}manhattanDistanceTo(t){return Math.abs(this.x-t.x)+Math.abs(this.y-t.y)}setLength(t){return this.normalize().multiplyScalar(t)}lerp(t,n){return this.x+=(t.x-this.x)*n,this.y+=(t.y-this.y)*n,this}lerpVectors(t,n,i){return this.x=t.x+(n.x-t.x)*i,this.y=t.y+(n.y-t.y)*i,this}equals(t){return t.x===this.x&&t.y===this.y}fromArray(t,n=0){return this.x=t[n],this.y=t[n+1],this}toArray(t=[],n=0){return t[n]=this.x,t[n+1]=this.y,t}fromBufferAttribute(t,n){return this.x=t.getX(n),this.y=t.getY(n),this}rotateAround(t,n){let i=Math.cos(n),a=Math.sin(n),s=this.x-t.x,r=this.y-t.y;return this.x=s*i-r*a+t.x,this.y=s*a+r*i+t.y,this}random(){return this.x=Math.random(),this.y=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y}},ra=class{constructor(t=0,n=0,i=0,a=1){this.isQuaternion=!0,this._x=t,this._y=n,this._z=i,this._w=a}static slerpFlat(t,n,i,a,s,r,o){let l=i[a+0],c=i[a+1],f=i[a+2],p=i[a+3],u=s[r+0],d=s[r+1],_=s[r+2],b=s[r+3];if(p!==b||l!==u||c!==d||f!==_){let m=l*u+c*d+f*_+p*b;m<0&&(u=-u,d=-d,_=-_,b=-b,m=-m);let h=1-o;if(m<.9995){let g=Math.acos(m),S=Math.sin(g);h=Math.sin(h*g)/S,o=Math.sin(o*g)/S,l=l*h+u*o,c=c*h+d*o,f=f*h+_*o,p=p*h+b*o}else{l=l*h+u*o,c=c*h+d*o,f=f*h+_*o,p=p*h+b*o;let g=1/Math.sqrt(l*l+c*c+f*f+p*p);l*=g,c*=g,f*=g,p*=g}}t[n]=l,t[n+1]=c,t[n+2]=f,t[n+3]=p}static multiplyQuaternionsFlat(t,n,i,a,s,r){let o=i[a],l=i[a+1],c=i[a+2],f=i[a+3],p=s[r],u=s[r+1],d=s[r+2],_=s[r+3];return t[n]=o*_+f*p+l*d-c*u,t[n+1]=l*_+f*u+c*p-o*d,t[n+2]=c*_+f*d+o*u-l*p,t[n+3]=f*_-o*p-l*u-c*d,t}get x(){return this._x}set x(t){this._x=t,this._onChangeCallback()}get y(){return this._y}set y(t){this._y=t,this._onChangeCallback()}get z(){return this._z}set z(t){this._z=t,this._onChangeCallback()}get w(){return this._w}set w(t){this._w=t,this._onChangeCallback()}set(t,n,i,a){return this._x=t,this._y=n,this._z=i,this._w=a,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._w)}copy(t){return this._x=t.x,this._y=t.y,this._z=t.z,this._w=t.w,this._onChangeCallback(),this}setFromEuler(t,n=!0){let i=t._x,a=t._y,s=t._z,r=t._order,o=Math.cos,l=Math.sin,c=o(i/2),f=o(a/2),p=o(s/2),u=l(i/2),d=l(a/2),_=l(s/2);switch(r){case"XYZ":this._x=u*f*p+c*d*_,this._y=c*d*p-u*f*_,this._z=c*f*_+u*d*p,this._w=c*f*p-u*d*_;break;case"YXZ":this._x=u*f*p+c*d*_,this._y=c*d*p-u*f*_,this._z=c*f*_-u*d*p,this._w=c*f*p+u*d*_;break;case"ZXY":this._x=u*f*p-c*d*_,this._y=c*d*p+u*f*_,this._z=c*f*_+u*d*p,this._w=c*f*p-u*d*_;break;case"ZYX":this._x=u*f*p-c*d*_,this._y=c*d*p+u*f*_,this._z=c*f*_-u*d*p,this._w=c*f*p+u*d*_;break;case"YZX":this._x=u*f*p+c*d*_,this._y=c*d*p+u*f*_,this._z=c*f*_-u*d*p,this._w=c*f*p-u*d*_;break;case"XZY":this._x=u*f*p-c*d*_,this._y=c*d*p-u*f*_,this._z=c*f*_+u*d*p,this._w=c*f*p+u*d*_;break;default:Ft("Quaternion: .setFromEuler() encountered an unknown order: "+r)}return n===!0&&this._onChangeCallback(),this}setFromAxisAngle(t,n){let i=n/2,a=Math.sin(i);return this._x=t.x*a,this._y=t.y*a,this._z=t.z*a,this._w=Math.cos(i),this._onChangeCallback(),this}setFromRotationMatrix(t){let n=t.elements,i=n[0],a=n[4],s=n[8],r=n[1],o=n[5],l=n[9],c=n[2],f=n[6],p=n[10],u=i+o+p;if(u>0){let d=.5/Math.sqrt(u+1);this._w=.25/d,this._x=(f-l)*d,this._y=(s-c)*d,this._z=(r-a)*d}else if(i>o&&i>p){let d=2*Math.sqrt(1+i-o-p);this._w=(f-l)/d,this._x=.25*d,this._y=(a+r)/d,this._z=(s+c)/d}else if(o>p){let d=2*Math.sqrt(1+o-i-p);this._w=(s-c)/d,this._x=(a+r)/d,this._y=.25*d,this._z=(l+f)/d}else{let d=2*Math.sqrt(1+p-i-o);this._w=(r-a)/d,this._x=(s+c)/d,this._y=(l+f)/d,this._z=.25*d}return this._onChangeCallback(),this}setFromUnitVectors(t,n){let i=t.dot(n)+1;return i<1e-8?(i=0,Math.abs(t.x)>Math.abs(t.z)?(this._x=-t.y,this._y=t.x,this._z=0,this._w=i):(this._x=0,this._y=-t.z,this._z=t.y,this._w=i)):(this._x=t.y*n.z-t.z*n.y,this._y=t.z*n.x-t.x*n.z,this._z=t.x*n.y-t.y*n.x,this._w=i),this.normalize()}angleTo(t){return 2*Math.acos(Math.abs(re(this.dot(t),-1,1)))}rotateTowards(t,n){let i=this.angleTo(t);if(i===0)return this;let a=Math.min(1,n/i);return this.slerp(t,a),this}identity(){return this.set(0,0,0,1)}invert(){return this.conjugate()}conjugate(){return this._x*=-1,this._y*=-1,this._z*=-1,this._onChangeCallback(),this}dot(t){return this._x*t._x+this._y*t._y+this._z*t._z+this._w*t._w}lengthSq(){return this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w}length(){return Math.sqrt(this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w)}normalize(){let t=this.length();return t===0?(this._x=0,this._y=0,this._z=0,this._w=1):(t=1/t,this._x=this._x*t,this._y=this._y*t,this._z=this._z*t,this._w=this._w*t),this._onChangeCallback(),this}multiply(t){return this.multiplyQuaternions(this,t)}premultiply(t){return this.multiplyQuaternions(t,this)}multiplyQuaternions(t,n){let i=t._x,a=t._y,s=t._z,r=t._w,o=n._x,l=n._y,c=n._z,f=n._w;return this._x=i*f+r*o+a*c-s*l,this._y=a*f+r*l+s*o-i*c,this._z=s*f+r*c+i*l-a*o,this._w=r*f-i*o-a*l-s*c,this._onChangeCallback(),this}slerp(t,n){let i=t._x,a=t._y,s=t._z,r=t._w,o=this.dot(t);o<0&&(i=-i,a=-a,s=-s,r=-r,o=-o);let l=1-n;if(o<.9995){let c=Math.acos(o),f=Math.sin(c);l=Math.sin(l*c)/f,n=Math.sin(n*c)/f,this._x=this._x*l+i*n,this._y=this._y*l+a*n,this._z=this._z*l+s*n,this._w=this._w*l+r*n,this._onChangeCallback()}else this._x=this._x*l+i*n,this._y=this._y*l+a*n,this._z=this._z*l+s*n,this._w=this._w*l+r*n,this.normalize();return this}slerpQuaternions(t,n,i){return this.copy(t).slerp(n,i)}random(){let t=2*Math.PI*Math.random(),n=2*Math.PI*Math.random(),i=Math.random(),a=Math.sqrt(1-i),s=Math.sqrt(i);return this.set(a*Math.sin(t),a*Math.cos(t),s*Math.sin(n),s*Math.cos(n))}equals(t){return t._x===this._x&&t._y===this._y&&t._z===this._z&&t._w===this._w}fromArray(t,n=0){return this._x=t[n],this._y=t[n+1],this._z=t[n+2],this._w=t[n+3],this._onChangeCallback(),this}toArray(t=[],n=0){return t[n]=this._x,t[n+1]=this._y,t[n+2]=this._z,t[n+3]=this._w,t}fromBufferAttribute(t,n){return this._x=t.getX(n),this._y=t.getY(n),this._z=t.getZ(n),this._w=t.getW(n),this._onChangeCallback(),this}toJSON(){return this.toArray()}_onChange(t){return this._onChangeCallback=t,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._w}},W=class e{static{e.prototype.isVector3=!0}constructor(t=0,n=0,i=0){this.x=t,this.y=n,this.z=i}set(t,n,i){return i===void 0&&(i=this.z),this.x=t,this.y=n,this.z=i,this}setScalar(t){return this.x=t,this.y=t,this.z=t,this}setX(t){return this.x=t,this}setY(t){return this.y=t,this}setZ(t){return this.z=t,this}setComponent(t,n){switch(t){case 0:this.x=n;break;case 1:this.y=n;break;case 2:this.z=n;break;default:throw new Error("THREE.Vector3: index is out of range: "+t)}return this}getComponent(t){switch(t){case 0:return this.x;case 1:return this.y;case 2:return this.z;default:throw new Error("THREE.Vector3: index is out of range: "+t)}}clone(){return new this.constructor(this.x,this.y,this.z)}copy(t){return this.x=t.x,this.y=t.y,this.z=t.z,this}add(t){return this.x+=t.x,this.y+=t.y,this.z+=t.z,this}addScalar(t){return this.x+=t,this.y+=t,this.z+=t,this}addVectors(t,n){return this.x=t.x+n.x,this.y=t.y+n.y,this.z=t.z+n.z,this}addScaledVector(t,n){return this.x+=t.x*n,this.y+=t.y*n,this.z+=t.z*n,this}sub(t){return this.x-=t.x,this.y-=t.y,this.z-=t.z,this}subScalar(t){return this.x-=t,this.y-=t,this.z-=t,this}subVectors(t,n){return this.x=t.x-n.x,this.y=t.y-n.y,this.z=t.z-n.z,this}multiply(t){return this.x*=t.x,this.y*=t.y,this.z*=t.z,this}multiplyScalar(t){return this.x*=t,this.y*=t,this.z*=t,this}multiplyVectors(t,n){return this.x=t.x*n.x,this.y=t.y*n.y,this.z=t.z*n.z,this}applyEuler(t){return this.applyQuaternion(V1.setFromEuler(t))}applyAxisAngle(t,n){return this.applyQuaternion(V1.setFromAxisAngle(t,n))}applyMatrix3(t){let n=this.x,i=this.y,a=this.z,s=t.elements;return this.x=s[0]*n+s[3]*i+s[6]*a,this.y=s[1]*n+s[4]*i+s[7]*a,this.z=s[2]*n+s[5]*i+s[8]*a,this}applyNormalMatrix(t){return this.applyMatrix3(t).normalize()}applyMatrix4(t){let n=this.x,i=this.y,a=this.z,s=t.elements,r=1/(s[3]*n+s[7]*i+s[11]*a+s[15]);return this.x=(s[0]*n+s[4]*i+s[8]*a+s[12])*r,this.y=(s[1]*n+s[5]*i+s[9]*a+s[13])*r,this.z=(s[2]*n+s[6]*i+s[10]*a+s[14])*r,this}applyQuaternion(t){let n=this.x,i=this.y,a=this.z,s=t.x,r=t.y,o=t.z,l=t.w,c=2*(r*a-o*i),f=2*(o*n-s*a),p=2*(s*i-r*n);return this.x=n+l*c+r*p-o*f,this.y=i+l*f+o*c-s*p,this.z=a+l*p+s*f-r*c,this}project(t){return this.applyMatrix4(t.matrixWorldInverse).applyMatrix4(t.projectionMatrix)}unproject(t){return this.applyMatrix4(t.projectionMatrixInverse).applyMatrix4(t.matrixWorld)}transformDirection(t){let n=this.x,i=this.y,a=this.z,s=t.elements;return this.x=s[0]*n+s[4]*i+s[8]*a,this.y=s[1]*n+s[5]*i+s[9]*a,this.z=s[2]*n+s[6]*i+s[10]*a,this.normalize()}divide(t){return this.x/=t.x,this.y/=t.y,this.z/=t.z,this}divideScalar(t){return this.multiplyScalar(1/t)}min(t){return this.x=Math.min(this.x,t.x),this.y=Math.min(this.y,t.y),this.z=Math.min(this.z,t.z),this}max(t){return this.x=Math.max(this.x,t.x),this.y=Math.max(this.y,t.y),this.z=Math.max(this.z,t.z),this}clamp(t,n){return this.x=re(this.x,t.x,n.x),this.y=re(this.y,t.y,n.y),this.z=re(this.z,t.z,n.z),this}clampScalar(t,n){return this.x=re(this.x,t,n),this.y=re(this.y,t,n),this.z=re(this.z,t,n),this}clampLength(t,n){let i=this.length();return this.divideScalar(i||1).multiplyScalar(re(i,t,n))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this}dot(t){return this.x*t.x+this.y*t.y+this.z*t.z}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)}normalize(){return this.divideScalar(this.length()||1)}setLength(t){return this.normalize().multiplyScalar(t)}lerp(t,n){return this.x+=(t.x-this.x)*n,this.y+=(t.y-this.y)*n,this.z+=(t.z-this.z)*n,this}lerpVectors(t,n,i){return this.x=t.x+(n.x-t.x)*i,this.y=t.y+(n.y-t.y)*i,this.z=t.z+(n.z-t.z)*i,this}cross(t){return this.crossVectors(this,t)}crossVectors(t,n){let i=t.x,a=t.y,s=t.z,r=n.x,o=n.y,l=n.z;return this.x=a*l-s*o,this.y=s*r-i*l,this.z=i*o-a*r,this}projectOnVector(t){let n=t.lengthSq();if(n===0)return this.set(0,0,0);let i=t.dot(this)/n;return this.copy(t).multiplyScalar(i)}projectOnPlane(t){return U0.copy(this).projectOnVector(t),this.sub(U0)}reflect(t){return this.sub(U0.copy(t).multiplyScalar(2*this.dot(t)))}angleTo(t){let n=Math.sqrt(this.lengthSq()*t.lengthSq());if(n===0)return Math.PI/2;let i=this.dot(t)/n;return Math.acos(re(i,-1,1))}distanceTo(t){return Math.sqrt(this.distanceToSquared(t))}distanceToSquared(t){let n=this.x-t.x,i=this.y-t.y,a=this.z-t.z;return n*n+i*i+a*a}manhattanDistanceTo(t){return Math.abs(this.x-t.x)+Math.abs(this.y-t.y)+Math.abs(this.z-t.z)}setFromSpherical(t){return this.setFromSphericalCoords(t.radius,t.phi,t.theta)}setFromSphericalCoords(t,n,i){let a=Math.sin(n)*t;return this.x=a*Math.sin(i),this.y=Math.cos(n)*t,this.z=a*Math.cos(i),this}setFromCylindrical(t){return this.setFromCylindricalCoords(t.radius,t.theta,t.y)}setFromCylindricalCoords(t,n,i){return this.x=t*Math.sin(n),this.y=i,this.z=t*Math.cos(n),this}setFromMatrixPosition(t){let n=t.elements;return this.x=n[12],this.y=n[13],this.z=n[14],this}setFromMatrixScale(t){let n=this.setFromMatrixColumn(t,0).length(),i=this.setFromMatrixColumn(t,1).length(),a=this.setFromMatrixColumn(t,2).length();return this.x=n,this.y=i,this.z=a,this}setFromMatrixColumn(t,n){return this.fromArray(t.elements,n*4)}setFromMatrix3Column(t,n){return this.fromArray(t.elements,n*3)}setFromEuler(t){return this.x=t._x,this.y=t._y,this.z=t._z,this}setFromColor(t){return this.x=t.r,this.y=t.g,this.z=t.b,this}equals(t){return t.x===this.x&&t.y===this.y&&t.z===this.z}fromArray(t,n=0){return this.x=t[n],this.y=t[n+1],this.z=t[n+2],this}toArray(t=[],n=0){return t[n]=this.x,t[n+1]=this.y,t[n+2]=this.z,t}fromBufferAttribute(t,n){return this.x=t.getX(n),this.y=t.getY(n),this.z=t.getZ(n),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this}randomDirection(){let t=Math.random()*Math.PI*2,n=Math.random()*2-1,i=Math.sqrt(1-n*n);return this.x=i*Math.cos(t),this.y=n,this.z=i*Math.sin(t),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z}},U0=new W,V1=new ra,Xt=class e{static{e.prototype.isMatrix3=!0}constructor(t,n,i,a,s,r,o,l,c){this.elements=[1,0,0,0,1,0,0,0,1],t!==void 0&&this.set(t,n,i,a,s,r,o,l,c)}set(t,n,i,a,s,r,o,l,c){let f=this.elements;return f[0]=t,f[1]=a,f[2]=o,f[3]=n,f[4]=s,f[5]=l,f[6]=i,f[7]=r,f[8]=c,this}identity(){return this.set(1,0,0,0,1,0,0,0,1),this}copy(t){let n=this.elements,i=t.elements;return n[0]=i[0],n[1]=i[1],n[2]=i[2],n[3]=i[3],n[4]=i[4],n[5]=i[5],n[6]=i[6],n[7]=i[7],n[8]=i[8],this}extractBasis(t,n,i){return t.setFromMatrix3Column(this,0),n.setFromMatrix3Column(this,1),i.setFromMatrix3Column(this,2),this}setFromMatrix4(t){let n=t.elements;return this.set(n[0],n[4],n[8],n[1],n[5],n[9],n[2],n[6],n[10]),this}multiply(t){return this.multiplyMatrices(this,t)}premultiply(t){return this.multiplyMatrices(t,this)}multiplyMatrices(t,n){let i=t.elements,a=n.elements,s=this.elements,r=i[0],o=i[3],l=i[6],c=i[1],f=i[4],p=i[7],u=i[2],d=i[5],_=i[8],b=a[0],m=a[3],h=a[6],g=a[1],S=a[4],y=a[7],T=a[2],A=a[5],E=a[8];return s[0]=r*b+o*g+l*T,s[3]=r*m+o*S+l*A,s[6]=r*h+o*y+l*E,s[1]=c*b+f*g+p*T,s[4]=c*m+f*S+p*A,s[7]=c*h+f*y+p*E,s[2]=u*b+d*g+_*T,s[5]=u*m+d*S+_*A,s[8]=u*h+d*y+_*E,this}multiplyScalar(t){let n=this.elements;return n[0]*=t,n[3]*=t,n[6]*=t,n[1]*=t,n[4]*=t,n[7]*=t,n[2]*=t,n[5]*=t,n[8]*=t,this}determinant(){let t=this.elements,n=t[0],i=t[1],a=t[2],s=t[3],r=t[4],o=t[5],l=t[6],c=t[7],f=t[8];return n*r*f-n*o*c-i*s*f+i*o*l+a*s*c-a*r*l}invert(){let t=this.elements,n=t[0],i=t[1],a=t[2],s=t[3],r=t[4],o=t[5],l=t[6],c=t[7],f=t[8],p=f*r-o*c,u=o*l-f*s,d=c*s-r*l,_=n*p+i*u+a*d;if(_===0)return this.set(0,0,0,0,0,0,0,0,0);let b=1/_;return t[0]=p*b,t[1]=(a*c-f*i)*b,t[2]=(o*i-a*r)*b,t[3]=u*b,t[4]=(f*n-a*l)*b,t[5]=(a*s-o*n)*b,t[6]=d*b,t[7]=(i*l-c*n)*b,t[8]=(r*n-i*s)*b,this}transpose(){let t,n=this.elements;return t=n[1],n[1]=n[3],n[3]=t,t=n[2],n[2]=n[6],n[6]=t,t=n[5],n[5]=n[7],n[7]=t,this}getNormalMatrix(t){return this.setFromMatrix4(t).invert().transpose()}transposeIntoArray(t){let n=this.elements;return t[0]=n[0],t[1]=n[3],t[2]=n[6],t[3]=n[1],t[4]=n[4],t[5]=n[7],t[6]=n[2],t[7]=n[5],t[8]=n[8],this}setUvTransform(t,n,i,a,s,r,o){let l=Math.cos(s),c=Math.sin(s);return this.set(i*l,i*c,-i*(l*r+c*o)+r+t,-a*c,a*l,-a*(-c*r+l*o)+o+n,0,0,1),this}scale(t,n){return fr("Matrix3: .scale() is deprecated. Use .makeScale() instead."),this.premultiply(L0.makeScale(t,n)),this}rotate(t){return fr("Matrix3: .rotate() is deprecated. Use .makeRotation() instead."),this.premultiply(L0.makeRotation(-t)),this}translate(t,n){return fr("Matrix3: .translate() is deprecated. Use .makeTranslation() instead."),this.premultiply(L0.makeTranslation(t,n)),this}makeTranslation(t,n){return t.isVector2?this.set(1,0,t.x,0,1,t.y,0,0,1):this.set(1,0,t,0,1,n,0,0,1),this}makeRotation(t){let n=Math.cos(t),i=Math.sin(t);return this.set(n,-i,0,i,n,0,0,0,1),this}makeScale(t,n){return this.set(t,0,0,0,n,0,0,0,1),this}equals(t){let n=this.elements,i=t.elements;for(let a=0;a<9;a++)if(n[a]!==i[a])return!1;return!0}fromArray(t,n=0){for(let i=0;i<9;i++)this.elements[i]=t[i+n];return this}toArray(t=[],n=0){let i=this.elements;return t[n]=i[0],t[n+1]=i[1],t[n+2]=i[2],t[n+3]=i[3],t[n+4]=i[4],t[n+5]=i[5],t[n+6]=i[6],t[n+7]=i[7],t[n+8]=i[8],t}clone(){return new this.constructor().fromArray(this.elements)}},L0=new Xt,G1=new Xt().set(.4123908,.3575843,.1804808,.212639,.7151687,.0721923,.0193308,.1191948,.9505322),k1=new Xt().set(3.2409699,-1.5373832,-.4986108,-.9692436,1.8759675,.0415551,.0556301,-.203977,1.0569715);function Cw(){let e={enabled:!0,workingColorSpace:sc,spaces:{},convert:function(a,s,r){return this.enabled===!1||s===r||!s||!r||(this.spaces[s].transfer===ve&&(a.r=La(a.r),a.g=La(a.g),a.b=La(a.b)),this.spaces[s].primaries!==this.spaces[r].primaries&&(a.applyMatrix3(this.spaces[s].toXYZ),a.applyMatrix3(this.spaces[r].fromXYZ)),this.spaces[r].transfer===ve&&(a.r=Oo(a.r),a.g=Oo(a.g),a.b=Oo(a.b))),a},workingToColorSpace:function(a,s){return this.convert(a,this.workingColorSpace,s)},colorSpaceToWorking:function(a,s){return this.convert(a,s,this.workingColorSpace)},getPrimaries:function(a){return this.spaces[a].primaries},getTransfer:function(a){return a===Oa?rc:this.spaces[a].transfer},getToneMappingMode:function(a){return this.spaces[a].outputColorSpaceConfig.toneMappingMode||"standard"},getLuminanceCoefficients:function(a,s=this.workingColorSpace){return a.fromArray(this.spaces[s].luminanceCoefficients)},define:function(a){Object.assign(this.spaces,a)},_getMatrix:function(a,s,r){return a.copy(this.spaces[s].toXYZ).multiply(this.spaces[r].fromXYZ)},_getDrawingBufferColorSpace:function(a){return this.spaces[a].outputColorSpaceConfig.drawingBufferColorSpace},_getUnpackColorSpace:function(a=this.workingColorSpace){return this.spaces[a].workingColorSpaceConfig.unpackColorSpace},fromWorkingColorSpace:function(a,s){return fr("ColorManagement: .fromWorkingColorSpace() has been renamed to .workingToColorSpace()."),e.workingToColorSpace(a,s)},toWorkingColorSpace:function(a,s){return fr("ColorManagement: .toWorkingColorSpace() has been renamed to .colorSpaceToWorking()."),e.colorSpaceToWorking(a,s)}},t=[.64,.33,.3,.6,.15,.06],n=[.2126,.7152,.0722],i=[.3127,.329];return e.define({[sc]:{primaries:t,whitePoint:i,transfer:rc,toXYZ:G1,fromXYZ:k1,luminanceCoefficients:n,workingColorSpaceConfig:{unpackColorSpace:ni},outputColorSpaceConfig:{drawingBufferColorSpace:ni}},[ni]:{primaries:t,whitePoint:i,transfer:ve,toXYZ:G1,fromXYZ:k1,luminanceCoefficients:n,outputColorSpaceConfig:{drawingBufferColorSpace:ni}}}),e}var se=Cw();function La(e){return e<.04045?e*.0773993808:Math.pow(e*.9478672986+.0521327014,2.4)}function Oo(e){return e<.0031308?e*12.92:1.055*Math.pow(e,.41666)-.055}var So,oh=class{static getDataURL(t,n="image/png"){if(/^data:/i.test(t.src)||typeof HTMLCanvasElement>"u")return t.src;let i;if(t instanceof HTMLCanvasElement)i=t;else{So===void 0&&(So=lc("canvas")),So.width=t.width,So.height=t.height;let a=So.getContext("2d");t instanceof ImageData?a.putImageData(t,0,0):a.drawImage(t,0,0,t.width,t.height),i=So}return i.toDataURL(n)}static sRGBToLinear(t){if(typeof HTMLImageElement<"u"&&t instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&t instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&t instanceof ImageBitmap){let n=lc("canvas");n.width=t.width,n.height=t.height;let i=n.getContext("2d");i.drawImage(t,0,0,t.width,t.height);let a=i.getImageData(0,0,t.width,t.height),s=a.data;for(let r=0;r<s.length;r++)s[r]=La(s[r]/255)*255;return i.putImageData(a,0,0),n}else if(t.data){let n=t.data.slice(0);for(let i=0;i<n.length;i++)n instanceof Uint8Array||n instanceof Uint8ClampedArray?n[i]=Math.floor(La(n[i]/255)*255):n[i]=La(n[i]);return{data:n,width:t.width,height:t.height}}else return Ft("ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied."),t}},Rw=0,Bo=class{constructor(t=null){this.isTextureSource=!0,Object.defineProperty(this,"id",{value:Rw++}),this.uuid=Rc(),this.data=t,this.dataReady=!0,this.version=0}getSize(t){let n=this.data;return typeof HTMLVideoElement<"u"&&n instanceof HTMLVideoElement?t.set(n.videoWidth,n.videoHeight,0):typeof VideoFrame<"u"&&n instanceof VideoFrame?t.set(n.displayWidth,n.displayHeight,0):n!==null?t.set(n.width,n.height,n.depth||0):t.set(0,0,0),t}set needsUpdate(t){t===!0&&this.version++}toJSON(t){let n=t===void 0||typeof t=="string";if(!n&&t.images[this.uuid]!==void 0)return t.images[this.uuid];let i={uuid:this.uuid,url:""},a=this.data;if(a!==null){let s;if(Array.isArray(a)){s=[];for(let r=0,o=a.length;r<o;r++)a[r].isDataTexture?s.push(O0(a[r].image)):s.push(O0(a[r]))}else s=O0(a);i.url=s}return n||(t.images[this.uuid]=i),i}};function O0(e){return typeof HTMLImageElement<"u"&&e instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&e instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&e instanceof ImageBitmap?oh.getDataURL(e):e.data?{data:Array.from(e.data),width:e.width,height:e.height,type:e.data.constructor.name}:(Ft("Texture: Unable to serialize Texture."),{})}var Dw=0,I0=new W,Hn=class e extends sa{constructor(t=e.DEFAULT_IMAGE,n=e.DEFAULT_MAPPING,i=ia,a=ia,s=mn,r=Ds,o=yi,l=ai,c=e.DEFAULT_ANISOTROPY,f=Oa){super(),this.isTexture=!0,Object.defineProperty(this,"id",{value:Dw++}),this.uuid=Rc(),this.name="",this.source=new Bo(t),this.mipmaps=[],this.mapping=n,this.channel=0,this.wrapS=i,this.wrapT=a,this.magFilter=s,this.minFilter=r,this.anisotropy=c,this.format=o,this.internalFormat=null,this.type=l,this.offset=new oe(0,0),this.repeat=new oe(1,1),this.center=new oe(0,0),this.rotation=0,this.matrixAutoUpdate=!0,this.matrix=new Xt,this.generateMipmaps=!0,this.premultiplyAlpha=!1,this.flipY=!0,this.unpackAlignment=4,this.colorSpace=f,this.userData={},this.updateRanges=[],this.version=0,this.onUpdate=null,this.renderTarget=null,this.isRenderTargetTexture=!1,this.isArrayTexture=!!(t&&t.depth&&t.depth>1),this.pmremVersion=0,this.normalized=!1}get width(){return this.source.getSize(I0).x}get height(){return this.source.getSize(I0).y}get depth(){return this.source.getSize(I0).z}get image(){return this.source.data}set image(t){this.source.data=t}updateMatrix(){this.matrix.setUvTransform(this.offset.x,this.offset.y,this.repeat.x,this.repeat.y,this.rotation,this.center.x,this.center.y)}addUpdateRange(t,n){this.updateRanges.push({start:t,count:n})}clearUpdateRanges(){this.updateRanges.length=0}clone(){return new this.constructor().copy(this)}copy(t){return this.name=t.name,this.source=t.source,this.mipmaps=t.mipmaps.slice(0),this.mapping=t.mapping,this.channel=t.channel,this.wrapS=t.wrapS,this.wrapT=t.wrapT,this.magFilter=t.magFilter,this.minFilter=t.minFilter,this.anisotropy=t.anisotropy,this.format=t.format,this.internalFormat=t.internalFormat,this.type=t.type,this.normalized=t.normalized,this.offset.copy(t.offset),this.repeat.copy(t.repeat),this.center.copy(t.center),this.rotation=t.rotation,this.matrixAutoUpdate=t.matrixAutoUpdate,this.matrix.copy(t.matrix),this.generateMipmaps=t.generateMipmaps,this.premultiplyAlpha=t.premultiplyAlpha,this.flipY=t.flipY,this.unpackAlignment=t.unpackAlignment,this.colorSpace=t.colorSpace,this.renderTarget=t.renderTarget,this.isRenderTargetTexture=t.isRenderTargetTexture,this.isArrayTexture=t.isArrayTexture,this.userData=JSON.parse(JSON.stringify(t.userData)),this.needsUpdate=!0,this}setValues(t){for(let n in t){let i=t[n];if(i===void 0){Ft(`Texture.setValues(): parameter '${n}' has value of undefined.`);continue}let a=this[n];if(a===void 0){Ft(`Texture.setValues(): property '${n}' does not exist.`);continue}a&&i&&a.isVector2&&i.isVector2||a&&i&&a.isVector3&&i.isVector3||a&&i&&a.isMatrix3&&i.isMatrix3?a.copy(i):this[n]=i}}toJSON(t){let n=t===void 0||typeof t=="string";if(!n&&t.textures[this.uuid]!==void 0)return t.textures[this.uuid];let i={metadata:{version:4.7,type:"Texture",generator:"Texture.toJSON"},uuid:this.uuid,name:this.name,image:this.source.toJSON(t).uuid,mapping:this.mapping,channel:this.channel,repeat:[this.repeat.x,this.repeat.y],offset:[this.offset.x,this.offset.y],center:[this.center.x,this.center.y],rotation:this.rotation,wrap:[this.wrapS,this.wrapT],format:this.format,internalFormat:this.internalFormat,type:this.type,normalized:this.normalized,colorSpace:this.colorSpace,minFilter:this.minFilter,magFilter:this.magFilter,anisotropy:this.anisotropy,flipY:this.flipY,generateMipmaps:this.generateMipmaps,premultiplyAlpha:this.premultiplyAlpha,unpackAlignment:this.unpackAlignment};return Object.keys(this.userData).length>0&&(i.userData=this.userData),n||(t.textures[this.uuid]=i),i}dispose(){this.dispatchEvent({type:"dispose"})}transformUv(t){if(this.mapping!==_g)return t;if(t.applyMatrix3(this.matrix),t.x<0||t.x>1)switch(this.wrapS){case ih:t.x=t.x-Math.floor(t.x);break;case ia:t.x=t.x<0?0:1;break;case ah:Math.abs(Math.floor(t.x)%2)===1?t.x=Math.ceil(t.x)-t.x:t.x=t.x-Math.floor(t.x);break}if(t.y<0||t.y>1)switch(this.wrapT){case ih:t.y=t.y-Math.floor(t.y);break;case ia:t.y=t.y<0?0:1;break;case ah:Math.abs(Math.floor(t.y)%2)===1?t.y=Math.ceil(t.y)-t.y:t.y=t.y-Math.floor(t.y);break}return this.flipY&&(t.y=1-t.y),t}set needsUpdate(t){t===!0&&(this.version++,this.source.needsUpdate=!0)}set needsPMREMUpdate(t){t===!0&&this.pmremVersion++}};Hn.DEFAULT_IMAGE=null;Hn.DEFAULT_MAPPING=_g;Hn.DEFAULT_ANISOTROPY=1;var Fe=class e{static{e.prototype.isVector4=!0}constructor(t=0,n=0,i=0,a=1){this.x=t,this.y=n,this.z=i,this.w=a}get width(){return this.z}set width(t){this.z=t}get height(){return this.w}set height(t){this.w=t}set(t,n,i,a){return this.x=t,this.y=n,this.z=i,this.w=a,this}setScalar(t){return this.x=t,this.y=t,this.z=t,this.w=t,this}setX(t){return this.x=t,this}setY(t){return this.y=t,this}setZ(t){return this.z=t,this}setW(t){return this.w=t,this}setComponent(t,n){switch(t){case 0:this.x=n;break;case 1:this.y=n;break;case 2:this.z=n;break;case 3:this.w=n;break;default:throw new Error("THREE.Vector4: index is out of range: "+t)}return this}getComponent(t){switch(t){case 0:return this.x;case 1:return this.y;case 2:return this.z;case 3:return this.w;default:throw new Error("THREE.Vector4: index is out of range: "+t)}}clone(){return new this.constructor(this.x,this.y,this.z,this.w)}copy(t){return this.x=t.x,this.y=t.y,this.z=t.z,this.w=t.w!==void 0?t.w:1,this}add(t){return this.x+=t.x,this.y+=t.y,this.z+=t.z,this.w+=t.w,this}addScalar(t){return this.x+=t,this.y+=t,this.z+=t,this.w+=t,this}addVectors(t,n){return this.x=t.x+n.x,this.y=t.y+n.y,this.z=t.z+n.z,this.w=t.w+n.w,this}addScaledVector(t,n){return this.x+=t.x*n,this.y+=t.y*n,this.z+=t.z*n,this.w+=t.w*n,this}sub(t){return this.x-=t.x,this.y-=t.y,this.z-=t.z,this.w-=t.w,this}subScalar(t){return this.x-=t,this.y-=t,this.z-=t,this.w-=t,this}subVectors(t,n){return this.x=t.x-n.x,this.y=t.y-n.y,this.z=t.z-n.z,this.w=t.w-n.w,this}multiply(t){return this.x*=t.x,this.y*=t.y,this.z*=t.z,this.w*=t.w,this}multiplyScalar(t){return this.x*=t,this.y*=t,this.z*=t,this.w*=t,this}applyMatrix4(t){let n=this.x,i=this.y,a=this.z,s=this.w,r=t.elements;return this.x=r[0]*n+r[4]*i+r[8]*a+r[12]*s,this.y=r[1]*n+r[5]*i+r[9]*a+r[13]*s,this.z=r[2]*n+r[6]*i+r[10]*a+r[14]*s,this.w=r[3]*n+r[7]*i+r[11]*a+r[15]*s,this}divide(t){return this.x/=t.x,this.y/=t.y,this.z/=t.z,this.w/=t.w,this}divideScalar(t){return this.multiplyScalar(1/t)}setAxisAngleFromQuaternion(t){this.w=2*Math.acos(t.w);let n=Math.sqrt(1-t.w*t.w);return n<1e-4?(this.x=1,this.y=0,this.z=0):(this.x=t.x/n,this.y=t.y/n,this.z=t.z/n),this}setAxisAngleFromRotationMatrix(t){let n,i,a,s,l=t.elements,c=l[0],f=l[4],p=l[8],u=l[1],d=l[5],_=l[9],b=l[2],m=l[6],h=l[10];if(Math.abs(f-u)<.01&&Math.abs(p-b)<.01&&Math.abs(_-m)<.01){if(Math.abs(f+u)<.1&&Math.abs(p+b)<.1&&Math.abs(_+m)<.1&&Math.abs(c+d+h-3)<.1)return this.set(1,0,0,0),this;n=Math.PI;let S=(c+1)/2,y=(d+1)/2,T=(h+1)/2,A=(f+u)/4,E=(p+b)/4,x=(_+m)/4;return S>y&&S>T?S<.01?(i=0,a=.707106781,s=.707106781):(i=Math.sqrt(S),a=A/i,s=E/i):y>T?y<.01?(i=.707106781,a=0,s=.707106781):(a=Math.sqrt(y),i=A/a,s=x/a):T<.01?(i=.707106781,a=.707106781,s=0):(s=Math.sqrt(T),i=E/s,a=x/s),this.set(i,a,s,n),this}let g=Math.sqrt((m-_)*(m-_)+(p-b)*(p-b)+(u-f)*(u-f));return Math.abs(g)<.001&&(g=1),this.x=(m-_)/g,this.y=(p-b)/g,this.z=(u-f)/g,this.w=Math.acos((c+d+h-1)/2),this}setFromMatrixPosition(t){let n=t.elements;return this.x=n[12],this.y=n[13],this.z=n[14],this.w=n[15],this}min(t){return this.x=Math.min(this.x,t.x),this.y=Math.min(this.y,t.y),this.z=Math.min(this.z,t.z),this.w=Math.min(this.w,t.w),this}max(t){return this.x=Math.max(this.x,t.x),this.y=Math.max(this.y,t.y),this.z=Math.max(this.z,t.z),this.w=Math.max(this.w,t.w),this}clamp(t,n){return this.x=re(this.x,t.x,n.x),this.y=re(this.y,t.y,n.y),this.z=re(this.z,t.z,n.z),this.w=re(this.w,t.w,n.w),this}clampScalar(t,n){return this.x=re(this.x,t,n),this.y=re(this.y,t,n),this.z=re(this.z,t,n),this.w=re(this.w,t,n),this}clampLength(t,n){let i=this.length();return this.divideScalar(i||1).multiplyScalar(re(i,t,n))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this.w=Math.floor(this.w),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this.w=Math.ceil(this.w),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this.w=Math.round(this.w),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this.w=Math.trunc(this.w),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this.w=-this.w,this}dot(t){return this.x*t.x+this.y*t.y+this.z*t.z+this.w*t.w}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)+Math.abs(this.w)}normalize(){return this.divideScalar(this.length()||1)}setLength(t){return this.normalize().multiplyScalar(t)}lerp(t,n){return this.x+=(t.x-this.x)*n,this.y+=(t.y-this.y)*n,this.z+=(t.z-this.z)*n,this.w+=(t.w-this.w)*n,this}lerpVectors(t,n,i){return this.x=t.x+(n.x-t.x)*i,this.y=t.y+(n.y-t.y)*i,this.z=t.z+(n.z-t.z)*i,this.w=t.w+(n.w-t.w)*i,this}equals(t){return t.x===this.x&&t.y===this.y&&t.z===this.z&&t.w===this.w}fromArray(t,n=0){return this.x=t[n],this.y=t[n+1],this.z=t[n+2],this.w=t[n+3],this}toArray(t=[],n=0){return t[n]=this.x,t[n+1]=this.y,t[n+2]=this.z,t[n+3]=this.w,t}fromBufferAttribute(t,n){return this.x=t.getX(n),this.y=t.getY(n),this.z=t.getZ(n),this.w=t.getW(n),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this.w=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z,yield this.w}},lh=class extends sa{constructor(t=1,n=1,i={}){super(),i=Object.assign({generateMipmaps:!1,internalFormat:null,minFilter:mn,depthBuffer:!0,stencilBuffer:!1,resolveColorBuffer:!0,resolveDepthBuffer:!0,resolveStencilBuffer:!0,storeMultisampledColorBuffer:!0,storeMultisampledDepthBuffer:!0,storeMultisampledStencilBuffer:!0,depthTexture:null,samples:0,count:1,depth:1,multiview:!1,useArrayDepthTexture:!1},i),this.isRenderTarget=!0,this.width=t,this.height=n,this.depth=i.depth,this.scissor=new Fe(0,0,t,n),this.scissorTest=!1,this.viewport=new Fe(0,0,t,n),this.textures=[];let a={width:t,height:n,depth:i.depth},s=new Hn(a),r=i.count;for(let o=0;o<r;o++)this.textures[o]=s.clone(),this.textures[o].isRenderTargetTexture=!0,this.textures[o].renderTarget=this;this._setTextureOptions(i),this.depthBuffer=i.depthBuffer,this.stencilBuffer=i.stencilBuffer,this.resolveColorBuffer=i.resolveColorBuffer,this.resolveDepthBuffer=i.resolveDepthBuffer,this.resolveStencilBuffer=i.resolveStencilBuffer,this.storeMultisampledColorBuffer=i.storeMultisampledColorBuffer,this.storeMultisampledDepthBuffer=i.storeMultisampledDepthBuffer,this.storeMultisampledStencilBuffer=i.storeMultisampledStencilBuffer,this._depthTexture=null,this.depthTexture=i.depthTexture,this.samples=i.samples,this.multiview=i.multiview,this.useArrayDepthTexture=i.useArrayDepthTexture}_setTextureOptions(t={}){let n={minFilter:mn,generateMipmaps:!1,flipY:!1,internalFormat:null};t.mapping!==void 0&&(n.mapping=t.mapping),t.wrapS!==void 0&&(n.wrapS=t.wrapS),t.wrapT!==void 0&&(n.wrapT=t.wrapT),t.wrapR!==void 0&&(n.wrapR=t.wrapR),t.magFilter!==void 0&&(n.magFilter=t.magFilter),t.minFilter!==void 0&&(n.minFilter=t.minFilter),t.format!==void 0&&(n.format=t.format),t.type!==void 0&&(n.type=t.type),t.anisotropy!==void 0&&(n.anisotropy=t.anisotropy),t.colorSpace!==void 0&&(n.colorSpace=t.colorSpace),t.flipY!==void 0&&(n.flipY=t.flipY),t.generateMipmaps!==void 0&&(n.generateMipmaps=t.generateMipmaps),t.internalFormat!==void 0&&(n.internalFormat=t.internalFormat);for(let i=0;i<this.textures.length;i++)this.textures[i].setValues(n)}get texture(){return this.textures[0]}set texture(t){this.textures[0]=t}set depthTexture(t){this._depthTexture!==null&&this._depthTexture.renderTarget===this&&(this._depthTexture.renderTarget=null),t!==null&&t.renderTarget===null&&(t.renderTarget=this),this._depthTexture=t}get depthTexture(){return this._depthTexture}setSize(t,n,i=1){if(this.width!==t||this.height!==n||this.depth!==i){this.width=t,this.height=n,this.depth=i;for(let a=0,s=this.textures.length;a<s;a++)this.textures[a].image.width=t,this.textures[a].image.height=n,this.textures[a].image.depth=i,this.textures[a].isData3DTexture!==!0&&(this.textures[a].isArrayTexture=this.textures[a].image.depth>1);this.dispose()}this.viewport.set(0,0,t,n),this.scissor.set(0,0,t,n)}clone(){return new this.constructor().copy(this)}copy(t){this.width=t.width,this.height=t.height,this.depth=t.depth,this.scissor.copy(t.scissor),this.scissorTest=t.scissorTest,this.viewport.copy(t.viewport),this.textures.length=0;for(let n=0,i=t.textures.length;n<i;n++){this.textures[n]=t.textures[n].clone(),this.textures[n].isRenderTargetTexture=!0,this.textures[n].renderTarget=this;let a=Object.assign({},t.textures[n].image);this.textures[n].source=new Bo(a)}if(this.depthBuffer=t.depthBuffer,this.stencilBuffer=t.stencilBuffer,this.resolveColorBuffer=t.resolveColorBuffer,this.resolveDepthBuffer=t.resolveDepthBuffer,this.resolveStencilBuffer=t.resolveStencilBuffer,this.storeMultisampledColorBuffer=t.storeMultisampledColorBuffer,this.storeMultisampledDepthBuffer=t.storeMultisampledDepthBuffer,this.storeMultisampledStencilBuffer=t.storeMultisampledStencilBuffer,t.depthTexture!==null)if(t.depthTexture.renderTarget===t){let n=t.depthTexture.clone();n.renderTarget=null,this.depthTexture=n}else this.depthTexture=t.depthTexture;return this.samples=t.samples,this.multiview=t.multiview,this.useArrayDepthTexture=t.useArrayDepthTexture,this}dispose(){this.dispatchEvent({type:"dispose"})}},Vn=class extends lh{constructor(t=1,n=1,i={}){super(t,n,i),this.isWebGLRenderTarget=!0}},cc=class extends Hn{constructor(t=null,n=1,i=1,a=1){super(null),this.isDataArrayTexture=!0,this.image={data:t,width:n,height:i,depth:a},this.magFilter=on,this.minFilter=on,this.wrapR=ia,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1,this.layerUpdates=new Set}copy(t){return super.copy(t),this.wrapR=t.wrapR,this}addLayerUpdate(t){this.layerUpdates.add(t)}clearLayerUpdates(){this.layerUpdates.clear()}};var ch=class extends Hn{constructor(t=null,n=1,i=1,a=1){super(null),this.isData3DTexture=!0,this.image={data:t,width:n,height:i,depth:a},this.magFilter=on,this.minFilter=on,this.wrapR=ia,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}copy(t){return super.copy(t),this.wrapR=t.wrapR,this}};var Xe=class e{static{e.prototype.isMatrix4=!0}constructor(t,n,i,a,s,r,o,l,c,f,p,u,d,_,b,m){this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],t!==void 0&&this.set(t,n,i,a,s,r,o,l,c,f,p,u,d,_,b,m)}set(t,n,i,a,s,r,o,l,c,f,p,u,d,_,b,m){let h=this.elements;return h[0]=t,h[4]=n,h[8]=i,h[12]=a,h[1]=s,h[5]=r,h[9]=o,h[13]=l,h[2]=c,h[6]=f,h[10]=p,h[14]=u,h[3]=d,h[7]=_,h[11]=b,h[15]=m,this}identity(){return this.set(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1),this}clone(){return new e().fromArray(this.elements)}copy(t){let n=this.elements,i=t.elements;return n[0]=i[0],n[1]=i[1],n[2]=i[2],n[3]=i[3],n[4]=i[4],n[5]=i[5],n[6]=i[6],n[7]=i[7],n[8]=i[8],n[9]=i[9],n[10]=i[10],n[11]=i[11],n[12]=i[12],n[13]=i[13],n[14]=i[14],n[15]=i[15],this}copyPosition(t){let n=this.elements,i=t.elements;return n[12]=i[12],n[13]=i[13],n[14]=i[14],this}setFromMatrix3(t){let n=t.elements;return this.set(n[0],n[3],n[6],0,n[1],n[4],n[7],0,n[2],n[5],n[8],0,0,0,0,1),this}extractBasis(t,n,i){return this.determinantAffine()===0?(t.set(1,0,0),n.set(0,1,0),i.set(0,0,1),this):(t.setFromMatrixColumn(this,0),n.setFromMatrixColumn(this,1),i.setFromMatrixColumn(this,2),this)}makeBasis(t,n,i){return this.set(t.x,n.x,i.x,0,t.y,n.y,i.y,0,t.z,n.z,i.z,0,0,0,0,1),this}extractRotation(t){if(t.determinantAffine()===0)return this.identity();let n=this.elements,i=t.elements,a=1/Mo.setFromMatrixColumn(t,0).length(),s=1/Mo.setFromMatrixColumn(t,1).length(),r=1/Mo.setFromMatrixColumn(t,2).length();return n[0]=i[0]*a,n[1]=i[1]*a,n[2]=i[2]*a,n[3]=0,n[4]=i[4]*s,n[5]=i[5]*s,n[6]=i[6]*s,n[7]=0,n[8]=i[8]*r,n[9]=i[9]*r,n[10]=i[10]*r,n[11]=0,n[12]=0,n[13]=0,n[14]=0,n[15]=1,this}makeRotationFromEuler(t){let n=this.elements,i=t.x,a=t.y,s=t.z,r=Math.cos(i),o=Math.sin(i),l=Math.cos(a),c=Math.sin(a),f=Math.cos(s),p=Math.sin(s);if(t.order==="XYZ"){let u=r*f,d=r*p,_=o*f,b=o*p;n[0]=l*f,n[4]=-l*p,n[8]=c,n[1]=d+_*c,n[5]=u-b*c,n[9]=-o*l,n[2]=b-u*c,n[6]=_+d*c,n[10]=r*l}else if(t.order==="YXZ"){let u=l*f,d=l*p,_=c*f,b=c*p;n[0]=u+b*o,n[4]=_*o-d,n[8]=r*c,n[1]=r*p,n[5]=r*f,n[9]=-o,n[2]=d*o-_,n[6]=b+u*o,n[10]=r*l}else if(t.order==="ZXY"){let u=l*f,d=l*p,_=c*f,b=c*p;n[0]=u-b*o,n[4]=-r*p,n[8]=_+d*o,n[1]=d+_*o,n[5]=r*f,n[9]=b-u*o,n[2]=-r*c,n[6]=o,n[10]=r*l}else if(t.order==="ZYX"){let u=r*f,d=r*p,_=o*f,b=o*p;n[0]=l*f,n[4]=_*c-d,n[8]=u*c+b,n[1]=l*p,n[5]=b*c+u,n[9]=d*c-_,n[2]=-c,n[6]=o*l,n[10]=r*l}else if(t.order==="YZX"){let u=r*l,d=r*c,_=o*l,b=o*c;n[0]=l*f,n[4]=b-u*p,n[8]=_*p+d,n[1]=p,n[5]=r*f,n[9]=-o*f,n[2]=-c*f,n[6]=d*p+_,n[10]=u-b*p}else if(t.order==="XZY"){let u=r*l,d=r*c,_=o*l,b=o*c;n[0]=l*f,n[4]=-p,n[8]=c*f,n[1]=u*p+b,n[5]=r*f,n[9]=d*p-_,n[2]=_*p-d,n[6]=o*f,n[10]=b*p+u}return n[3]=0,n[7]=0,n[11]=0,n[12]=0,n[13]=0,n[14]=0,n[15]=1,this}makeRotationFromQuaternion(t){return this.compose(Nw,t,Uw)}lookAt(t,n,i){let a=this.elements;return ti.subVectors(t,n),ti.lengthSq()===0&&(ti.z=1),ti.normalize(),ms.crossVectors(i,ti),ms.lengthSq()===0&&(Math.abs(i.z)===1?ti.x+=1e-4:ti.z+=1e-4,ti.normalize(),ms.crossVectors(i,ti)),ms.normalize(),Rf.crossVectors(ti,ms),a[0]=ms.x,a[4]=Rf.x,a[8]=ti.x,a[1]=ms.y,a[5]=Rf.y,a[9]=ti.y,a[2]=ms.z,a[6]=Rf.z,a[10]=ti.z,this}multiply(t){return this.multiplyMatrices(this,t)}premultiply(t){return this.multiplyMatrices(t,this)}multiplyMatrices(t,n){let i=t.elements,a=n.elements,s=this.elements,r=i[0],o=i[4],l=i[8],c=i[12],f=i[1],p=i[5],u=i[9],d=i[13],_=i[2],b=i[6],m=i[10],h=i[14],g=i[3],S=i[7],y=i[11],T=i[15],A=a[0],E=a[4],x=a[8],w=a[12],R=a[1],D=a[5],P=a[9],F=a[13],U=a[2],B=a[6],X=a[10],Z=a[14],$=a[3],z=a[7],K=a[11],j=a[15];return s[0]=r*A+o*R+l*U+c*$,s[4]=r*E+o*D+l*B+c*z,s[8]=r*x+o*P+l*X+c*K,s[12]=r*w+o*F+l*Z+c*j,s[1]=f*A+p*R+u*U+d*$,s[5]=f*E+p*D+u*B+d*z,s[9]=f*x+p*P+u*X+d*K,s[13]=f*w+p*F+u*Z+d*j,s[2]=_*A+b*R+m*U+h*$,s[6]=_*E+b*D+m*B+h*z,s[10]=_*x+b*P+m*X+h*K,s[14]=_*w+b*F+m*Z+h*j,s[3]=g*A+S*R+y*U+T*$,s[7]=g*E+S*D+y*B+T*z,s[11]=g*x+S*P+y*X+T*K,s[15]=g*w+S*F+y*Z+T*j,this}multiplyScalar(t){let n=this.elements;return n[0]*=t,n[4]*=t,n[8]*=t,n[12]*=t,n[1]*=t,n[5]*=t,n[9]*=t,n[13]*=t,n[2]*=t,n[6]*=t,n[10]*=t,n[14]*=t,n[3]*=t,n[7]*=t,n[11]*=t,n[15]*=t,this}determinant(){let t=this.elements,n=t[0],i=t[4],a=t[8],s=t[12],r=t[1],o=t[5],l=t[9],c=t[13],f=t[2],p=t[6],u=t[10],d=t[14],_=t[3],b=t[7],m=t[11],h=t[15],g=l*d-c*u,S=o*d-c*p,y=o*u-l*p,T=r*d-c*f,A=r*u-l*f,E=r*p-o*f;return n*(b*g-m*S+h*y)-i*(_*g-m*T+h*A)+a*(_*S-b*T+h*E)-s*(_*y-b*A+m*E)}determinantAffine(){let t=this.elements,n=t[0],i=t[4],a=t[8],s=t[1],r=t[5],o=t[9],l=t[2],c=t[6],f=t[10];return n*(r*f-o*c)-i*(s*f-o*l)+a*(s*c-r*l)}transpose(){let t=this.elements,n;return n=t[1],t[1]=t[4],t[4]=n,n=t[2],t[2]=t[8],t[8]=n,n=t[6],t[6]=t[9],t[9]=n,n=t[3],t[3]=t[12],t[12]=n,n=t[7],t[7]=t[13],t[13]=n,n=t[11],t[11]=t[14],t[14]=n,this}setPosition(t,n,i){let a=this.elements;return t.isVector3?(a[12]=t.x,a[13]=t.y,a[14]=t.z):(a[12]=t,a[13]=n,a[14]=i),this}invert(){let t=this.elements,n=t[0],i=t[1],a=t[2],s=t[3],r=t[4],o=t[5],l=t[6],c=t[7],f=t[8],p=t[9],u=t[10],d=t[11],_=t[12],b=t[13],m=t[14],h=t[15],g=n*o-i*r,S=n*l-a*r,y=n*c-s*r,T=i*l-a*o,A=i*c-s*o,E=a*c-s*l,x=f*b-p*_,w=f*m-u*_,R=f*h-d*_,D=p*m-u*b,P=p*h-d*b,F=u*h-d*m,U=g*F-S*P+y*D+T*R-A*w+E*x;if(U===0)return this.set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0);let B=1/U;return t[0]=(o*F-l*P+c*D)*B,t[1]=(a*P-i*F-s*D)*B,t[2]=(b*E-m*A+h*T)*B,t[3]=(u*A-p*E-d*T)*B,t[4]=(l*R-r*F-c*w)*B,t[5]=(n*F-a*R+s*w)*B,t[6]=(m*y-_*E-h*S)*B,t[7]=(f*E-u*y+d*S)*B,t[8]=(r*P-o*R+c*x)*B,t[9]=(i*R-n*P-s*x)*B,t[10]=(_*A-b*y+h*g)*B,t[11]=(p*y-f*A-d*g)*B,t[12]=(o*w-r*D-l*x)*B,t[13]=(n*D-i*w+a*x)*B,t[14]=(b*S-_*T-m*g)*B,t[15]=(f*T-p*S+u*g)*B,this}scale(t){let n=this.elements,i=t.x,a=t.y,s=t.z;return n[0]*=i,n[4]*=a,n[8]*=s,n[1]*=i,n[5]*=a,n[9]*=s,n[2]*=i,n[6]*=a,n[10]*=s,n[3]*=i,n[7]*=a,n[11]*=s,this}getMaxScaleOnAxis(){let t=this.elements,n=t[0]*t[0]+t[1]*t[1]+t[2]*t[2],i=t[4]*t[4]+t[5]*t[5]+t[6]*t[6],a=t[8]*t[8]+t[9]*t[9]+t[10]*t[10];return Math.sqrt(Math.max(n,i,a))}makeTranslation(t,n,i){return t.isVector3?this.set(1,0,0,t.x,0,1,0,t.y,0,0,1,t.z,0,0,0,1):this.set(1,0,0,t,0,1,0,n,0,0,1,i,0,0,0,1),this}makeRotationX(t){let n=Math.cos(t),i=Math.sin(t);return this.set(1,0,0,0,0,n,-i,0,0,i,n,0,0,0,0,1),this}makeRotationY(t){let n=Math.cos(t),i=Math.sin(t);return this.set(n,0,i,0,0,1,0,0,-i,0,n,0,0,0,0,1),this}makeRotationZ(t){let n=Math.cos(t),i=Math.sin(t);return this.set(n,-i,0,0,i,n,0,0,0,0,1,0,0,0,0,1),this}makeRotationAxis(t,n){let i=Math.cos(n),a=Math.sin(n),s=1-i,r=t.x,o=t.y,l=t.z,c=s*r,f=s*o;return this.set(c*r+i,c*o-a*l,c*l+a*o,0,c*o+a*l,f*o+i,f*l-a*r,0,c*l-a*o,f*l+a*r,s*l*l+i,0,0,0,0,1),this}makeScale(t,n,i){return this.set(t,0,0,0,0,n,0,0,0,0,i,0,0,0,0,1),this}makeShear(t,n,i,a,s,r){return this.set(1,i,s,0,t,1,r,0,n,a,1,0,0,0,0,1),this}compose(t,n,i){let a=this.elements,s=n._x,r=n._y,o=n._z,l=n._w,c=s+s,f=r+r,p=o+o,u=s*c,d=s*f,_=s*p,b=r*f,m=r*p,h=o*p,g=l*c,S=l*f,y=l*p,T=i.x,A=i.y,E=i.z;return a[0]=(1-(b+h))*T,a[1]=(d+y)*T,a[2]=(_-S)*T,a[3]=0,a[4]=(d-y)*A,a[5]=(1-(u+h))*A,a[6]=(m+g)*A,a[7]=0,a[8]=(_+S)*E,a[9]=(m-g)*E,a[10]=(1-(u+b))*E,a[11]=0,a[12]=t.x,a[13]=t.y,a[14]=t.z,a[15]=1,this}decompose(t,n,i){let a=this.elements;t.x=a[12],t.y=a[13],t.z=a[14];let s=this.determinantAffine();if(s===0)return i.set(1,1,1),n.identity(),this;let r=Mo.set(a[0],a[1],a[2]).length(),o=Mo.set(a[4],a[5],a[6]).length(),l=Mo.set(a[8],a[9],a[10]).length();s<0&&(r=-r),Ci.copy(this);let c=1/r,f=1/o,p=1/l;return Ci.elements[0]*=c,Ci.elements[1]*=c,Ci.elements[2]*=c,Ci.elements[4]*=f,Ci.elements[5]*=f,Ci.elements[6]*=f,Ci.elements[8]*=p,Ci.elements[9]*=p,Ci.elements[10]*=p,n.setFromRotationMatrix(Ci),i.x=r,i.y=o,i.z=l,this}makePerspective(t,n,i,a,s,r,o=Ui,l=!1){let c=this.elements,f=2*s/(n-t),p=2*s/(i-a),u=(n+t)/(n-t),d=(i+a)/(i-a),_,b;if(l)_=s/(r-s),b=r*s/(r-s);else if(o===Ui)_=-(r+s)/(r-s),b=-2*r*s/(r-s);else if(o===oc)_=-r/(r-s),b=-r*s/(r-s);else throw new Error("THREE.Matrix4.makePerspective(): Invalid coordinate system: "+o);return c[0]=f,c[4]=0,c[8]=u,c[12]=0,c[1]=0,c[5]=p,c[9]=d,c[13]=0,c[2]=0,c[6]=0,c[10]=_,c[14]=b,c[3]=0,c[7]=0,c[11]=-1,c[15]=0,this}makeOrthographic(t,n,i,a,s,r,o=Ui,l=!1){let c=this.elements,f=2/(n-t),p=2/(i-a),u=-(n+t)/(n-t),d=-(i+a)/(i-a),_,b;if(l)_=1/(r-s),b=r/(r-s);else if(o===Ui)_=-2/(r-s),b=-(r+s)/(r-s);else if(o===oc)_=-1/(r-s),b=-s/(r-s);else throw new Error("THREE.Matrix4.makeOrthographic(): Invalid coordinate system: "+o);return c[0]=f,c[4]=0,c[8]=0,c[12]=u,c[1]=0,c[5]=p,c[9]=0,c[13]=d,c[2]=0,c[6]=0,c[10]=_,c[14]=b,c[3]=0,c[7]=0,c[11]=0,c[15]=1,this}equals(t){let n=this.elements,i=t.elements;for(let a=0;a<16;a++)if(n[a]!==i[a])return!1;return!0}fromArray(t,n=0){for(let i=0;i<16;i++)this.elements[i]=t[i+n];return this}toArray(t=[],n=0){let i=this.elements;return t[n]=i[0],t[n+1]=i[1],t[n+2]=i[2],t[n+3]=i[3],t[n+4]=i[4],t[n+5]=i[5],t[n+6]=i[6],t[n+7]=i[7],t[n+8]=i[8],t[n+9]=i[9],t[n+10]=i[10],t[n+11]=i[11],t[n+12]=i[12],t[n+13]=i[13],t[n+14]=i[14],t[n+15]=i[15],t}},Mo=new W,Ci=new Xe,Nw=new W(0,0,0),Uw=new W(1,1,1),ms=new W,Rf=new W,ti=new W,X1=new Xe,W1=new ra,Ss=class e{constructor(t=0,n=0,i=0,a=e.DEFAULT_ORDER){this.isEuler=!0,this._x=t,this._y=n,this._z=i,this._order=a}get x(){return this._x}set x(t){this._x=t,this._onChangeCallback()}get y(){return this._y}set y(t){this._y=t,this._onChangeCallback()}get z(){return this._z}set z(t){this._z=t,this._onChangeCallback()}get order(){return this._order}set order(t){this._order=t,this._onChangeCallback()}set(t,n,i,a=this._order){return this._x=t,this._y=n,this._z=i,this._order=a,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._order)}copy(t){return this._x=t._x,this._y=t._y,this._z=t._z,this._order=t._order,this._onChangeCallback(),this}setFromRotationMatrix(t,n=this._order,i=!0){let a=t.elements,s=a[0],r=a[4],o=a[8],l=a[1],c=a[5],f=a[9],p=a[2],u=a[6],d=a[10];switch(n){case"XYZ":this._y=Math.asin(re(o,-1,1)),Math.abs(o)<.9999999?(this._x=Math.atan2(-f,d),this._z=Math.atan2(-r,s)):(this._x=Math.atan2(u,c),this._z=0);break;case"YXZ":this._x=Math.asin(-re(f,-1,1)),Math.abs(f)<.9999999?(this._y=Math.atan2(o,d),this._z=Math.atan2(l,c)):(this._y=Math.atan2(-p,s),this._z=0);break;case"ZXY":this._x=Math.asin(re(u,-1,1)),Math.abs(u)<.9999999?(this._y=Math.atan2(-p,d),this._z=Math.atan2(-r,c)):(this._y=0,this._z=Math.atan2(l,s));break;case"ZYX":this._y=Math.asin(-re(p,-1,1)),Math.abs(p)<.9999999?(this._x=Math.atan2(u,d),this._z=Math.atan2(l,s)):(this._x=0,this._z=Math.atan2(-r,c));break;case"YZX":this._z=Math.asin(re(l,-1,1)),Math.abs(l)<.9999999?(this._x=Math.atan2(-f,c),this._y=Math.atan2(-p,s)):(this._x=0,this._y=Math.atan2(o,d));break;case"XZY":this._z=Math.asin(-re(r,-1,1)),Math.abs(r)<.9999999?(this._x=Math.atan2(u,c),this._y=Math.atan2(o,s)):(this._x=Math.atan2(-f,d),this._y=0);break;default:Ft("Euler: .setFromRotationMatrix() encountered an unknown order: "+n)}return this._order=n,i===!0&&this._onChangeCallback(),this}setFromQuaternion(t,n,i){return X1.makeRotationFromQuaternion(t),this.setFromRotationMatrix(X1,n,i)}setFromVector3(t,n=this._order){return this.set(t.x,t.y,t.z,n)}reorder(t){return W1.setFromEuler(this),this.setFromQuaternion(W1,t)}equals(t){return t._x===this._x&&t._y===this._y&&t._z===this._z&&t._order===this._order}fromArray(t){return this._x=t[0],this._y=t[1],this._z=t[2],t[3]!==void 0&&(this._order=t[3]),this._onChangeCallback(),this}toArray(t=[],n=0){return t[n]=this._x,t[n+1]=this._y,t[n+2]=this._z,t[n+3]=this._order,t}_onChange(t){return this._onChangeCallback=t,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._order}};Ss.DEFAULT_ORDER="XYZ";var uc=class{constructor(){this.mask=1}set(t){this.mask=(1<<t|0)>>>0}enable(t){this.mask|=1<<t|0}enableAll(){this.mask=-1}toggle(t){this.mask^=1<<t|0}disable(t){this.mask&=~(1<<t|0)}disableAll(){this.mask=0}test(t){return(this.mask&t.mask)!==0}isEnabled(t){return(this.mask&(1<<t|0))!==0}},Lw=0,q1=new W,bo=new ra,Ca=new Xe,Df=new W,tc=new W,Ow=new W,Iw=new ra,Y1=new W(1,0,0),Z1=new W(0,1,0),J1=new W(0,0,1),K1={type:"added"},Pw={type:"removed"},To={type:"childadded",child:null},P0={type:"childremoved",child:null},xi=class e extends sa{constructor(){super(),this.isObject3D=!0,Object.defineProperty(this,"id",{value:Lw++}),this.uuid=Rc(),this.name="",this.type="Object3D",this.parent=null,this.children=[],this.up=e.DEFAULT_UP.clone();let t=new W,n=new Ss,i=new ra,a=new W(1,1,1);function s(){i.setFromEuler(n,!1)}function r(){n.setFromQuaternion(i,void 0,!1)}n._onChange(s),i._onChange(r),Object.defineProperties(this,{position:{configurable:!0,enumerable:!0,value:t},rotation:{configurable:!0,enumerable:!0,value:n},quaternion:{configurable:!0,enumerable:!0,value:i},scale:{configurable:!0,enumerable:!0,value:a},modelViewMatrix:{value:new Xe},normalMatrix:{value:new Xt}}),this.matrix=new Xe,this.matrixWorld=new Xe,this.matrixAutoUpdate=e.DEFAULT_MATRIX_AUTO_UPDATE,this.matrixWorldAutoUpdate=e.DEFAULT_MATRIX_WORLD_AUTO_UPDATE,this.matrixWorldNeedsUpdate=!1,this.layers=new uc,this.visible=!0,this.castShadow=!1,this.receiveShadow=!1,this.frustumCulled=!0,this.renderOrder=0,this.animations=[],this.customDepthMaterial=void 0,this.customDistanceMaterial=void 0,this.static=!1,this.userData={},this.pivot=null}onBeforeShadow(){}onAfterShadow(){}onBeforeRender(){}onAfterRender(){}applyMatrix4(t){this.matrixAutoUpdate&&this.updateMatrix(),this.matrix.premultiply(t),this.matrix.decompose(this.position,this.quaternion,this.scale)}applyQuaternion(t){return this.quaternion.premultiply(t),this}setRotationFromAxisAngle(t,n){this.quaternion.setFromAxisAngle(t,n)}setRotationFromEuler(t){this.quaternion.setFromEuler(t,!0)}setRotationFromMatrix(t){this.quaternion.setFromRotationMatrix(t)}setRotationFromQuaternion(t){this.quaternion.copy(t)}rotateOnAxis(t,n){return bo.setFromAxisAngle(t,n),this.quaternion.multiply(bo),this}rotateOnWorldAxis(t,n){return bo.setFromAxisAngle(t,n),this.quaternion.premultiply(bo),this}rotateX(t){return this.rotateOnAxis(Y1,t)}rotateY(t){return this.rotateOnAxis(Z1,t)}rotateZ(t){return this.rotateOnAxis(J1,t)}translateOnAxis(t,n){return q1.copy(t).applyQuaternion(this.quaternion),this.position.add(q1.multiplyScalar(n)),this}translateX(t){return this.translateOnAxis(Y1,t)}translateY(t){return this.translateOnAxis(Z1,t)}translateZ(t){return this.translateOnAxis(J1,t)}localToWorld(t){return this.updateWorldMatrix(!0,!1),t.applyMatrix4(this.matrixWorld)}worldToLocal(t){return this.updateWorldMatrix(!0,!1),t.applyMatrix4(Ca.copy(this.matrixWorld).invert())}lookAt(t,n,i){t.isVector3?Df.copy(t):Df.set(t,n,i);let a=this.parent;this.updateWorldMatrix(!0,!1),tc.setFromMatrixPosition(this.matrixWorld),this.isCamera||this.isLight?Ca.lookAt(tc,Df,this.up):Ca.lookAt(Df,tc,this.up),this.quaternion.setFromRotationMatrix(Ca),a&&(Ca.extractRotation(a.matrixWorld),bo.setFromRotationMatrix(Ca),this.quaternion.premultiply(bo.invert()))}add(t){if(arguments.length>1){for(let n=0;n<arguments.length;n++)this.add(arguments[n]);return this}return t===this?(Vt("Object3D.add: object can't be added as a child of itself.",t),this):(t&&t.isObject3D?(t.removeFromParent(),t.parent=this,this.children.push(t),t.dispatchEvent(K1),To.child=t,this.dispatchEvent(To),To.child=null):Vt("Object3D.add: object not an instance of THREE.Object3D.",t),this)}remove(t){if(arguments.length>1){for(let i=0;i<arguments.length;i++)this.remove(arguments[i]);return this}let n=this.children.indexOf(t);return n!==-1&&(t.parent=null,this.children.splice(n,1),t.dispatchEvent(Pw),P0.child=t,this.dispatchEvent(P0),P0.child=null),this}removeFromParent(){let t=this.parent;return t!==null&&t.remove(this),this}clear(){return this.remove(...this.children)}attach(t){return this.updateWorldMatrix(!0,!1),Ca.copy(this.matrixWorld).invert(),t.parent!==null&&(t.parent.updateWorldMatrix(!0,!1),Ca.multiply(t.parent.matrixWorld)),t.applyMatrix4(Ca),t.removeFromParent(),t.parent=this,this.children.push(t),t.updateWorldMatrix(!1,!0),t.dispatchEvent(K1),To.child=t,this.dispatchEvent(To),To.child=null,this}getObjectById(t){return this.getObjectByProperty("id",t)}getObjectByName(t){return this.getObjectByProperty("name",t)}getObjectByProperty(t,n){if(this[t]===n)return this;for(let i=0,a=this.children.length;i<a;i++){let r=this.children[i].getObjectByProperty(t,n);if(r!==void 0)return r}}getObjectsByProperty(t,n,i=[]){this[t]===n&&i.push(this);let a=this.children;for(let s=0,r=a.length;s<r;s++)a[s].getObjectsByProperty(t,n,i);return i}getWorldPosition(t){return this.updateWorldMatrix(!0,!1),t.setFromMatrixPosition(this.matrixWorld)}getWorldQuaternion(t){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(tc,t,Ow),t}getWorldScale(t){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(tc,Iw,t),t}getWorldDirection(t){this.updateWorldMatrix(!0,!1);let n=this.matrixWorld.elements;return t.set(n[8],n[9],n[10]).normalize()}raycast(){}intersectsFrustum(){}traverse(t){t(this);let n=this.children;for(let i=0,a=n.length;i<a;i++)n[i].traverse(t)}traverseVisible(t){if(this.visible===!1)return;t(this);let n=this.children;for(let i=0,a=n.length;i<a;i++)n[i].traverseVisible(t)}traverseAncestors(t){let n=this.parent;n!==null&&(t(n),n.traverseAncestors(t))}updateMatrix(){this.matrix.compose(this.position,this.quaternion,this.scale);let t=this.pivot;if(t!==null){let n=t.x,i=t.y,a=t.z,s=this.matrix.elements;s[12]+=n-s[0]*n-s[4]*i-s[8]*a,s[13]+=i-s[1]*n-s[5]*i-s[9]*a,s[14]+=a-s[2]*n-s[6]*i-s[10]*a}this.matrixWorldNeedsUpdate=!0}updateMatrixWorld(t){this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||t)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,t=!0);let n=this.children;for(let i=0,a=n.length;i<a;i++)n[i].updateMatrixWorld(t)}updateWorldMatrix(t,n,i=!1){let a=this.parent;if(t===!0&&a!==null&&a.updateWorldMatrix(!0,!1),this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||i)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,i=!0),n===!0){let s=this.children;for(let r=0,o=s.length;r<o;r++)s[r].updateWorldMatrix(!1,!0,i)}}toJSON(t){let n=t===void 0||typeof t=="string",i={};n&&(t={geometries:{},materials:{},textures:{},images:{},shapes:{},skeletons:{},animations:{},nodes:{}},i.metadata={version:4.7,type:"Object",generator:"Object3D.toJSON"});let a={};a.uuid=this.uuid,a.type=this.type,a.name=this.name,a.castShadow=this.castShadow,a.receiveShadow=this.receiveShadow,a.visible=this.visible,a.frustumCulled=this.frustumCulled,a.renderOrder=this.renderOrder,a.static=this.static,a.matrixAutoUpdate=this.matrixAutoUpdate,Object.keys(this.userData).length>0&&(a.userData=this.userData),a.layers=this.layers.mask,a.matrix=this.matrix.toArray(),a.up=this.up.toArray(),this.pivot!==null&&(a.pivot=this.pivot.toArray()),this.morphTargetDictionary!==void 0&&(a.morphTargetDictionary=Object.assign({},this.morphTargetDictionary)),this.morphTargetInfluences!==void 0&&(a.morphTargetInfluences=this.morphTargetInfluences.slice()),this.isInstancedMesh&&(a.type="InstancedMesh",a.count=this.count,a.instanceMatrix=this.instanceMatrix.toJSON(),this.instanceColor!==null&&(a.instanceColor=this.instanceColor.toJSON())),this.isBatchedMesh&&(a.type="BatchedMesh",a.perObjectFrustumCulled=this.perObjectFrustumCulled,a.sortObjects=this.sortObjects,a.drawRanges=this._drawRanges,a.reservedRanges=this._reservedRanges,a.geometryInfo=this._geometryInfo.map(o=>({...o,boundingBox:o.boundingBox?o.boundingBox.toJSON():void 0,boundingSphere:o.boundingSphere?o.boundingSphere.toJSON():void 0})),a.instanceInfo=this._instanceInfo.map(o=>({...o})),a.availableInstanceIds=this._availableInstanceIds.slice(),a.availableGeometryIds=this._availableGeometryIds.slice(),a.nextIndexStart=this._nextIndexStart,a.nextVertexStart=this._nextVertexStart,a.geometryCount=this._geometryCount,a.maxInstanceCount=this._maxInstanceCount,a.maxVertexCount=this._maxVertexCount,a.maxIndexCount=this._maxIndexCount,a.geometryInitialized=this._geometryInitialized,a.matricesTexture=this._matricesTexture.toJSON(t),a.indirectTexture=this._indirectTexture.toJSON(t),this._colorsTexture!==null&&(a.colorsTexture=this._colorsTexture.toJSON(t)),this.boundingSphere!==null&&(a.boundingSphere=this.boundingSphere.toJSON()),this.boundingBox!==null&&(a.boundingBox=this.boundingBox.toJSON()));function s(o,l){return o[l.uuid]===void 0&&(o[l.uuid]=l.toJSON(t)),l.uuid}if(this.isScene)this.background&&(this.background.isColor?a.background=this.background.toJSON():this.background.isTexture&&(a.background=this.background.toJSON(t).uuid)),this.environment&&this.environment.isTexture&&this.environment.isRenderTargetTexture!==!0&&(a.environment=this.environment.toJSON(t).uuid);else if(this.isMesh||this.isLine||this.isPoints){a.geometry=s(t.geometries,this.geometry);let o=this.geometry.parameters;if(o!==void 0&&o.shapes!==void 0){let l=o.shapes;if(Array.isArray(l))for(let c=0,f=l.length;c<f;c++){let p=l[c];s(t.shapes,p)}else s(t.shapes,l)}}if(this.isSkinnedMesh&&(a.bindMode=this.bindMode,a.bindMatrix=this.bindMatrix.toArray(),this.skeleton!==void 0&&(s(t.skeletons,this.skeleton),a.skeleton=this.skeleton.uuid)),this.material!==void 0)if(Array.isArray(this.material)){let o=[];for(let l=0,c=this.material.length;l<c;l++)o.push(s(t.materials,this.material[l]));a.material=o}else a.material=s(t.materials,this.material);if(this.children.length>0){a.children=[];for(let o=0;o<this.children.length;o++)a.children.push(this.children[o].toJSON(t).object)}if(this.animations.length>0){a.animations=[];for(let o=0;o<this.animations.length;o++){let l=this.animations[o];a.animations.push(s(t.animations,l))}}if(n){let o=r(t.geometries),l=r(t.materials),c=r(t.textures),f=r(t.images),p=r(t.shapes),u=r(t.skeletons),d=r(t.animations),_=r(t.nodes);o.length>0&&(i.geometries=o),l.length>0&&(i.materials=l),c.length>0&&(i.textures=c),f.length>0&&(i.images=f),p.length>0&&(i.shapes=p),u.length>0&&(i.skeletons=u),d.length>0&&(i.animations=d),_.length>0&&(i.nodes=_)}return i.object=a,i;function r(o){let l=[];for(let c in o){let f=o[c];delete f.metadata,l.push(f)}return l}}clone(t){return new this.constructor().copy(this,t)}copy(t,n=!0){if(this.name=t.name,this.up.copy(t.up),this.position.copy(t.position),this.rotation.order=t.rotation.order,this.quaternion.copy(t.quaternion),this.scale.copy(t.scale),this.pivot=t.pivot!==null?t.pivot.clone():null,this.matrix.copy(t.matrix),this.matrixWorld.copy(t.matrixWorld),this.matrixAutoUpdate=t.matrixAutoUpdate,this.matrixWorldAutoUpdate=t.matrixWorldAutoUpdate,this.matrixWorldNeedsUpdate=t.matrixWorldNeedsUpdate,this.layers.mask=t.layers.mask,this.visible=t.visible,this.castShadow=t.castShadow,this.receiveShadow=t.receiveShadow,this.frustumCulled=t.frustumCulled,this.renderOrder=t.renderOrder,this.static=t.static,this.animations=t.animations.slice(),this.userData=JSON.parse(JSON.stringify(t.userData)),n===!0)for(let i=0;i<t.children.length;i++){let a=t.children[i];this.add(a.clone())}return this}dispose(){this.dispatchEvent({type:"dispose"})}};xi.DEFAULT_UP=new W(0,1,0);xi.DEFAULT_MATRIX_AUTO_UPDATE=!0;xi.DEFAULT_MATRIX_WORLD_AUTO_UPDATE=!0;var ur=class extends xi{constructor(){super(),this.isGroup=!0,this.type="Group"}},Bw={type:"move"},zo=class{constructor(){this._targetRay=null,this._grip=null,this._hand=null}getHandSpace(){return this._hand===null&&(this._hand=new ur,this._hand.matrixAutoUpdate=!1,this._hand.visible=!1,this._hand.joints={},this._hand.inputState={pinching:!1}),this._hand}getTargetRaySpace(){return this._targetRay===null&&(this._targetRay=new ur,this._targetRay.matrixAutoUpdate=!1,this._targetRay.visible=!1,this._targetRay.hasLinearVelocity=!1,this._targetRay.linearVelocity=new W,this._targetRay.hasAngularVelocity=!1,this._targetRay.angularVelocity=new W),this._targetRay}getGripSpace(){return this._grip===null&&(this._grip=new ur,this._grip.matrixAutoUpdate=!1,this._grip.visible=!1,this._grip.hasLinearVelocity=!1,this._grip.linearVelocity=new W,this._grip.hasAngularVelocity=!1,this._grip.angularVelocity=new W,this._grip.eventsEnabled=!1),this._grip}dispatchEvent(t){return this._targetRay!==null&&this._targetRay.dispatchEvent(t),this._grip!==null&&this._grip.dispatchEvent(t),this._hand!==null&&this._hand.dispatchEvent(t),this}connect(t){if(t&&t.hand){let n=this._hand;if(n)for(let i of t.hand.values())this._getHandJoint(n,i)}return this.dispatchEvent({type:"connected",data:t}),this}disconnect(t){return this.dispatchEvent({type:"disconnected",data:t}),this._targetRay!==null&&(this._targetRay.visible=!1),this._grip!==null&&(this._grip.visible=!1),this._hand!==null&&(this._hand.visible=!1),this}update(t,n,i){let a=null,s=null,r=null,o=this._targetRay,l=this._grip,c=this._hand;if(t&&n.session.visibilityState!=="visible-blurred"){if(c&&t.hand){r=!0;for(let b of t.hand.values()){let m=n.getJointPose(b,i),h=this._getHandJoint(c,b);m!==null&&(h.matrix.fromArray(m.transform.matrix),h.matrix.decompose(h.position,h.rotation,h.scale),h.matrixWorldNeedsUpdate=!0,h.jointRadius=m.radius),h.visible=m!==null}let f=c.joints["index-finger-tip"],p=c.joints["thumb-tip"],u=f.position.distanceTo(p.position),d=.02,_=.005;c.inputState.pinching&&u>d+_?(c.inputState.pinching=!1,this.dispatchEvent({type:"pinchend",handedness:t.handedness,target:this})):!c.inputState.pinching&&u<=d-_&&(c.inputState.pinching=!0,this.dispatchEvent({type:"pinchstart",handedness:t.handedness,target:this}))}else l!==null&&t.gripSpace&&(s=n.getPose(t.gripSpace,i),s!==null&&(l.matrix.fromArray(s.transform.matrix),l.matrix.decompose(l.position,l.rotation,l.scale),l.matrixWorldNeedsUpdate=!0,s.linearVelocity?(l.hasLinearVelocity=!0,l.linearVelocity.copy(s.linearVelocity)):l.hasLinearVelocity=!1,s.angularVelocity?(l.hasAngularVelocity=!0,l.angularVelocity.copy(s.angularVelocity)):l.hasAngularVelocity=!1,l.eventsEnabled&&l.dispatchEvent({type:"gripUpdated",data:t,target:this})));o!==null&&(a=n.getPose(t.targetRaySpace,i),a===null&&s!==null&&(a=s),a!==null&&(o.matrix.fromArray(a.transform.matrix),o.matrix.decompose(o.position,o.rotation,o.scale),o.matrixWorldNeedsUpdate=!0,a.linearVelocity?(o.hasLinearVelocity=!0,o.linearVelocity.copy(a.linearVelocity)):o.hasLinearVelocity=!1,a.angularVelocity?(o.hasAngularVelocity=!0,o.angularVelocity.copy(a.angularVelocity)):o.hasAngularVelocity=!1,this.dispatchEvent(Bw)))}return o!==null&&(o.visible=a!==null),l!==null&&(l.visible=s!==null),c!==null&&(c.visible=r!==null),this}_getHandJoint(t,n){if(t.joints[n.jointName]===void 0){let i=new ur;i.matrixAutoUpdate=!1,i.visible=!1,t.joints[n.jointName]=i,t.add(i)}return t.joints[n.jointName]}},kM={aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074},gs={h:0,s:0,l:0},Nf={h:0,s:0,l:0};function B0(e,t,n){return n<0&&(n+=1),n>1&&(n-=1),n<1/6?e+(t-e)*6*n:n<1/2?t:n<2/3?e+(t-e)*6*(2/3-n):e}var Zt=class{constructor(t,n,i){return this.isColor=!0,this.r=1,this.g=1,this.b=1,this.set(t,n,i)}set(t,n,i){if(n===void 0&&i===void 0){let a=t;a&&a.isColor?this.copy(a):typeof a=="number"?this.setHex(a):typeof a=="string"&&this.setStyle(a)}else this.setRGB(t,n,i);return this}setScalar(t){return this.r=t,this.g=t,this.b=t,this}setHex(t,n=ni){return t=Math.floor(t),this.r=(t>>16&255)/255,this.g=(t>>8&255)/255,this.b=(t&255)/255,se.colorSpaceToWorking(this,n),this}setRGB(t,n,i,a=se.workingColorSpace){return this.r=t,this.g=n,this.b=i,se.colorSpaceToWorking(this,a),this}setHSL(t,n,i,a=se.workingColorSpace){if(t=ww(t,1),n=re(n,0,1),i=re(i,0,1),n===0)this.r=this.g=this.b=i;else{let s=i<=.5?i*(1+n):i+n-i*n,r=2*i-s;this.r=B0(r,s,t+1/3),this.g=B0(r,s,t),this.b=B0(r,s,t-1/3)}return se.colorSpaceToWorking(this,a),this}setStyle(t,n=ni){function i(s){s!==void 0&&parseFloat(s)<1&&Ft("Color: Alpha component of "+t+" will be ignored.")}let a;if(a=/^(\w+)\(([^\)]*)\)/.exec(t)){let s,r=a[1],o=a[2];switch(r){case"rgb":case"rgba":if(s=/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return i(s[4]),this.setRGB(Math.min(255,parseInt(s[1],10))/255,Math.min(255,parseInt(s[2],10))/255,Math.min(255,parseInt(s[3],10))/255,n);if(s=/^\s*(\d+)\%\s*,\s*(\d+)\%\s*,\s*(\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return i(s[4]),this.setRGB(Math.min(100,parseInt(s[1],10))/100,Math.min(100,parseInt(s[2],10))/100,Math.min(100,parseInt(s[3],10))/100,n);break;case"hsl":case"hsla":if(s=/^\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\%\s*,\s*(\d*\.?\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return i(s[4]),this.setHSL(parseFloat(s[1])/360,parseFloat(s[2])/100,parseFloat(s[3])/100,n);break;default:Ft("Color: Unknown color model "+t)}}else if(a=/^\#([A-Fa-f\d]+)$/.exec(t)){let s=a[1],r=s.length;if(r===3)return this.setRGB(parseInt(s.charAt(0),16)/15,parseInt(s.charAt(1),16)/15,parseInt(s.charAt(2),16)/15,n);if(r===6)return this.setHex(parseInt(s,16),n);Ft("Color: Invalid hex color "+t)}else if(t&&t.length>0)return this.setColorName(t,n);return this}setColorName(t,n=ni){let i=kM[t.toLowerCase()];return i!==void 0?this.setHex(i,n):Ft("Color: Unknown color "+t),this}clone(){return new this.constructor(this.r,this.g,this.b)}copy(t){return this.r=t.r,this.g=t.g,this.b=t.b,this}copySRGBToLinear(t){return this.r=La(t.r),this.g=La(t.g),this.b=La(t.b),this}copyLinearToSRGB(t){return this.r=Oo(t.r),this.g=Oo(t.g),this.b=Oo(t.b),this}convertSRGBToLinear(){return this.copySRGBToLinear(this),this}convertLinearToSRGB(){return this.copyLinearToSRGB(this),this}getHex(t=ni){return se.workingToColorSpace(Sn.copy(this),t),Math.round(re(Sn.r*255,0,255))*65536+Math.round(re(Sn.g*255,0,255))*256+Math.round(re(Sn.b*255,0,255))}getHexString(t=ni){return("000000"+this.getHex(t).toString(16)).slice(-6)}getHSL(t,n=se.workingColorSpace){se.workingToColorSpace(Sn.copy(this),n);let i=Sn.r,a=Sn.g,s=Sn.b,r=Math.max(i,a,s),o=Math.min(i,a,s),l,c,f=(o+r)/2;if(o===r)l=0,c=0;else{let p=r-o;switch(c=f<=.5?p/(r+o):p/(2-r-o),r){case i:l=(a-s)/p+(a<s?6:0);break;case a:l=(s-i)/p+2;break;case s:l=(i-a)/p+4;break}l/=6}return t.h=l,t.s=c,t.l=f,t}getRGB(t,n=se.workingColorSpace){return se.workingToColorSpace(Sn.copy(this),n),t.r=Sn.r,t.g=Sn.g,t.b=Sn.b,t}getStyle(t=ni){se.workingToColorSpace(Sn.copy(this),t);let n=Sn.r,i=Sn.g,a=Sn.b;return t!==ni?`color(${t} ${n.toFixed(3)} ${i.toFixed(3)} ${a.toFixed(3)})`:`rgb(${Math.round(n*255)},${Math.round(i*255)},${Math.round(a*255)})`}offsetHSL(t,n,i){return this.getHSL(gs),this.setHSL(gs.h+t,gs.s+n,gs.l+i)}add(t){return this.r+=t.r,this.g+=t.g,this.b+=t.b,this}addColors(t,n){return this.r=t.r+n.r,this.g=t.g+n.g,this.b=t.b+n.b,this}addScalar(t){return this.r+=t,this.g+=t,this.b+=t,this}sub(t){return this.r=Math.max(0,this.r-t.r),this.g=Math.max(0,this.g-t.g),this.b=Math.max(0,this.b-t.b),this}multiply(t){return this.r*=t.r,this.g*=t.g,this.b*=t.b,this}multiplyScalar(t){return this.r*=t,this.g*=t,this.b*=t,this}lerp(t,n){return this.r+=(t.r-this.r)*n,this.g+=(t.g-this.g)*n,this.b+=(t.b-this.b)*n,this}lerpColors(t,n,i){return this.r=t.r+(n.r-t.r)*i,this.g=t.g+(n.g-t.g)*i,this.b=t.b+(n.b-t.b)*i,this}lerpHSL(t,n){this.getHSL(gs),t.getHSL(Nf);let i=N0(gs.h,Nf.h,n),a=N0(gs.s,Nf.s,n),s=N0(gs.l,Nf.l,n);return this.setHSL(i,a,s),this}setFromVector3(t){return this.r=t.x,this.g=t.y,this.b=t.z,this}applyMatrix3(t){let n=this.r,i=this.g,a=this.b,s=t.elements;return this.r=s[0]*n+s[3]*i+s[6]*a,this.g=s[1]*n+s[4]*i+s[7]*a,this.b=s[2]*n+s[5]*i+s[8]*a,this}equals(t){return t.r===this.r&&t.g===this.g&&t.b===this.b}fromArray(t,n=0){return this.r=t[n],this.g=t[n+1],this.b=t[n+2],this}toArray(t=[],n=0){return t[n]=this.r,t[n+1]=this.g,t[n+2]=this.b,t}fromBufferAttribute(t,n){return this.r=t.getX(n),this.g=t.getY(n),this.b=t.getZ(n),this}toJSON(){return this.getHex()}*[Symbol.iterator](){yield this.r,yield this.g,yield this.b}},Sn=new Zt;Zt.NAMES=kM;var fc=class extends xi{constructor(){super(),this.isScene=!0,this.type="Scene",this.background=null,this.environment=null,this.fog=null,this.backgroundBlurriness=0,this.backgroundIntensity=1,this.backgroundRotation=new Ss,this.environmentIntensity=1,this.environmentRotation=new Ss,this.overrideMaterial=null,typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}copy(t,n){return super.copy(t,n),t.background!==null&&(this.background=t.background.clone()),t.environment!==null&&(this.environment=t.environment.clone()),t.fog!==null&&(this.fog=t.fog.clone()),this.backgroundBlurriness=t.backgroundBlurriness,this.backgroundIntensity=t.backgroundIntensity,this.backgroundRotation.copy(t.backgroundRotation),this.environmentIntensity=t.environmentIntensity,this.environmentRotation.copy(t.environmentRotation),t.overrideMaterial!==null&&(this.overrideMaterial=t.overrideMaterial.clone()),this.matrixAutoUpdate=t.matrixAutoUpdate,this}toJSON(t){let n=super.toJSON(t);return this.fog!==null&&(n.object.fog=this.fog.toJSON()),n.object.backgroundBlurriness=this.backgroundBlurriness,n.object.backgroundIntensity=this.backgroundIntensity,n.object.backgroundRotation=this.backgroundRotation.toArray(),n.object.environmentIntensity=this.environmentIntensity,n.object.environmentRotation=this.environmentRotation.toArray(),n}},Ri=new W,Ra=new W,z0=new W,Da=new W,Eo=new W,Ao=new W,Q1=new W,F0=new W,H0=new W,V0=new W,G0=new Fe,k0=new Fe,X0=new Fe,ys=class e{constructor(t=new W,n=new W,i=new W){this.a=t,this.b=n,this.c=i}static getNormal(t,n,i,a){a.subVectors(i,n),Ri.subVectors(t,n),a.cross(Ri);let s=a.lengthSq();return s>0?a.multiplyScalar(1/Math.sqrt(s)):a.set(0,0,0)}static getBarycoord(t,n,i,a,s){Ri.subVectors(a,n),Ra.subVectors(i,n),z0.subVectors(t,n);let r=Ri.dot(Ri),o=Ri.dot(Ra),l=Ri.dot(z0),c=Ra.dot(Ra),f=Ra.dot(z0),p=r*c-o*o;if(p===0)return s.set(0,0,0),null;let u=1/p,d=(c*l-o*f)*u,_=(r*f-o*l)*u;return s.set(1-d-_,_,d)}static containsPoint(t,n,i,a){return this.getBarycoord(t,n,i,a,Da)===null?!1:Da.x>=0&&Da.y>=0&&Da.x+Da.y<=1}static getInterpolation(t,n,i,a,s,r,o,l){return this.getBarycoord(t,n,i,a,Da)===null?(l.x=0,l.y=0,"z"in l&&(l.z=0),"w"in l&&(l.w=0),null):(l.setScalar(0),l.addScaledVector(s,Da.x),l.addScaledVector(r,Da.y),l.addScaledVector(o,Da.z),l)}static getInterpolatedAttribute(t,n,i,a,s,r){return G0.setScalar(0),k0.setScalar(0),X0.setScalar(0),G0.fromBufferAttribute(t,n),k0.fromBufferAttribute(t,i),X0.fromBufferAttribute(t,a),r.setScalar(0),r.addScaledVector(G0,s.x),r.addScaledVector(k0,s.y),r.addScaledVector(X0,s.z),r}static isFrontFacing(t,n,i,a){return Ri.subVectors(i,n),Ra.subVectors(t,n),Ri.cross(Ra).dot(a)<0}set(t,n,i){return this.a.copy(t),this.b.copy(n),this.c.copy(i),this}setFromPointsAndIndices(t,n,i,a){return this.a.copy(t[n]),this.b.copy(t[i]),this.c.copy(t[a]),this}setFromAttributeAndIndices(t,n,i,a){return this.a.fromBufferAttribute(t,n),this.b.fromBufferAttribute(t,i),this.c.fromBufferAttribute(t,a),this}clone(){return new this.constructor().copy(this)}copy(t){return this.a.copy(t.a),this.b.copy(t.b),this.c.copy(t.c),this}getArea(){return Ri.subVectors(this.c,this.b),Ra.subVectors(this.a,this.b),Ri.cross(Ra).length()*.5}getMidpoint(t){return t.addVectors(this.a,this.b).add(this.c).multiplyScalar(1/3)}getNormal(t){return e.getNormal(this.a,this.b,this.c,t)}getPlane(t){return t.setFromCoplanarPoints(this.a,this.b,this.c)}getBarycoord(t,n){return e.getBarycoord(t,this.a,this.b,this.c,n)}getInterpolation(t,n,i,a,s){return e.getInterpolation(t,this.a,this.b,this.c,n,i,a,s)}containsPoint(t){return e.containsPoint(t,this.a,this.b,this.c)}isFrontFacing(t){return e.isFrontFacing(this.a,this.b,this.c,t)}intersectsBox(t){return t.intersectsTriangle(this)}closestPointToPoint(t,n){let i=this.a,a=this.b,s=this.c,r,o;Eo.subVectors(a,i),Ao.subVectors(s,i),F0.subVectors(t,i);let l=Eo.dot(F0),c=Ao.dot(F0);if(l<=0&&c<=0)return n.copy(i);H0.subVectors(t,a);let f=Eo.dot(H0),p=Ao.dot(H0);if(f>=0&&p<=f)return n.copy(a);let u=l*p-f*c;if(u<=0&&l>=0&&f<=0)return r=l/(l-f),n.copy(i).addScaledVector(Eo,r);V0.subVectors(t,s);let d=Eo.dot(V0),_=Ao.dot(V0);if(_>=0&&d<=_)return n.copy(s);let b=d*c-l*_;if(b<=0&&c>=0&&_<=0)return o=c/(c-_),n.copy(i).addScaledVector(Ao,o);let m=f*_-d*p;if(m<=0&&p-f>=0&&d-_>=0)return Q1.subVectors(s,a),o=(p-f)/(p-f+(d-_)),n.copy(a).addScaledVector(Q1,o);let h=1/(m+b+u);return r=b*h,o=u*h,n.copy(i).addScaledVector(Eo,r).addScaledVector(Ao,o)}equals(t){return t.a.equals(this.a)&&t.b.equals(this.b)&&t.c.equals(this.c)}},Ms=class{constructor(t=new W(1/0,1/0,1/0),n=new W(-1/0,-1/0,-1/0)){this.isBox3=!0,this.min=t,this.max=n}set(t,n){return this.min.copy(t),this.max.copy(n),this}setFromArray(t){this.makeEmpty();for(let n=0,i=t.length;n<i;n+=3)this.expandByPoint(Di.fromArray(t,n));return this}setFromBufferAttribute(t){this.makeEmpty();for(let n=0,i=t.count;n<i;n++)this.expandByPoint(Di.fromBufferAttribute(t,n));return this}setFromPoints(t){this.makeEmpty();for(let n=0,i=t.length;n<i;n++)this.expandByPoint(t[n]);return this}setFromCenterAndSize(t,n){let i=Di.copy(n).multiplyScalar(.5);return this.min.copy(t).sub(i),this.max.copy(t).add(i),this}setFromObject(t,n=!1){return this.makeEmpty(),this.expandByObject(t,n)}clone(){return new this.constructor().copy(this)}copy(t){return this.min.copy(t.min),this.max.copy(t.max),this}makeEmpty(){return this.min.x=this.min.y=this.min.z=1/0,this.max.x=this.max.y=this.max.z=-1/0,this}isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y||this.max.z<this.min.z}getCenter(t){return this.isEmpty()?t.set(0,0,0):t.addVectors(this.min,this.max).multiplyScalar(.5)}getSize(t){return this.isEmpty()?t.set(0,0,0):t.subVectors(this.max,this.min)}expandByPoint(t){return this.min.min(t),this.max.max(t),this}expandByVector(t){return this.min.sub(t),this.max.add(t),this}expandByScalar(t){return this.min.addScalar(-t),this.max.addScalar(t),this}expandByObject(t,n=!1){t.updateWorldMatrix(!1,!1);let i=t.geometry;if(i!==void 0){let s=i.getAttribute("position");if(n===!0&&s!==void 0&&t.isInstancedMesh!==!0)for(let r=0,o=s.count;r<o;r++)t.isMesh===!0?t.getVertexPosition(r,Di):Di.fromBufferAttribute(s,r),Di.applyMatrix4(t.matrixWorld),this.expandByPoint(Di);else t.boundingBox!==void 0?(t.boundingBox===null&&t.computeBoundingBox(),Uf.copy(t.boundingBox)):(i.boundingBox===null&&i.computeBoundingBox(),Uf.copy(i.boundingBox)),Uf.applyMatrix4(t.matrixWorld),this.union(Uf)}let a=t.children;for(let s=0,r=a.length;s<r;s++)this.expandByObject(a[s],n);return this}containsPoint(t){return t.x>=this.min.x&&t.x<=this.max.x&&t.y>=this.min.y&&t.y<=this.max.y&&t.z>=this.min.z&&t.z<=this.max.z}containsBox(t){return this.min.x<=t.min.x&&t.max.x<=this.max.x&&this.min.y<=t.min.y&&t.max.y<=this.max.y&&this.min.z<=t.min.z&&t.max.z<=this.max.z}getParameter(t,n){return n.set((t.x-this.min.x)/(this.max.x-this.min.x),(t.y-this.min.y)/(this.max.y-this.min.y),(t.z-this.min.z)/(this.max.z-this.min.z))}intersectsBox(t){return t.max.x>=this.min.x&&t.min.x<=this.max.x&&t.max.y>=this.min.y&&t.min.y<=this.max.y&&t.max.z>=this.min.z&&t.min.z<=this.max.z}intersectsSphere(t){return this.clampPoint(t.center,Di),Di.distanceToSquared(t.center)<=t.radius*t.radius}intersectsPlane(t){let n,i;return t.normal.x>0?(n=t.normal.x*this.min.x,i=t.normal.x*this.max.x):(n=t.normal.x*this.max.x,i=t.normal.x*this.min.x),t.normal.y>0?(n+=t.normal.y*this.min.y,i+=t.normal.y*this.max.y):(n+=t.normal.y*this.max.y,i+=t.normal.y*this.min.y),t.normal.z>0?(n+=t.normal.z*this.min.z,i+=t.normal.z*this.max.z):(n+=t.normal.z*this.max.z,i+=t.normal.z*this.min.z),n<=-t.constant&&i>=-t.constant}intersectsTriangle(t){if(this.isEmpty())return!1;this.getCenter(ec),Lf.subVectors(this.max,ec),wo.subVectors(t.a,ec),Co.subVectors(t.b,ec),Ro.subVectors(t.c,ec),vs.subVectors(Co,wo),_s.subVectors(Ro,Co),rr.subVectors(wo,Ro);let n=[0,-vs.z,vs.y,0,-_s.z,_s.y,0,-rr.z,rr.y,vs.z,0,-vs.x,_s.z,0,-_s.x,rr.z,0,-rr.x,-vs.y,vs.x,0,-_s.y,_s.x,0,-rr.y,rr.x,0];return!W0(n,wo,Co,Ro,Lf)||(n=[1,0,0,0,1,0,0,0,1],!W0(n,wo,Co,Ro,Lf))?!1:(Of.crossVectors(vs,_s),n=[Of.x,Of.y,Of.z],W0(n,wo,Co,Ro,Lf))}clampPoint(t,n){return n.copy(t).clamp(this.min,this.max)}distanceToPoint(t){return this.clampPoint(t,Di).distanceTo(t)}getBoundingSphere(t){return this.isEmpty()?t.makeEmpty():(this.getCenter(t.center),t.radius=this.getSize(Di).length()*.5),t}intersect(t){return this.min.max(t.min),this.max.min(t.max),this.isEmpty()&&this.makeEmpty(),this}union(t){return this.min.min(t.min),this.max.max(t.max),this}applyMatrix4(t){return this.isEmpty()?this:(Na[0].set(this.min.x,this.min.y,this.min.z).applyMatrix4(t),Na[1].set(this.min.x,this.min.y,this.max.z).applyMatrix4(t),Na[2].set(this.min.x,this.max.y,this.min.z).applyMatrix4(t),Na[3].set(this.min.x,this.max.y,this.max.z).applyMatrix4(t),Na[4].set(this.max.x,this.min.y,this.min.z).applyMatrix4(t),Na[5].set(this.max.x,this.min.y,this.max.z).applyMatrix4(t),Na[6].set(this.max.x,this.max.y,this.min.z).applyMatrix4(t),Na[7].set(this.max.x,this.max.y,this.max.z).applyMatrix4(t),this.setFromPoints(Na),this)}translate(t){return this.min.add(t),this.max.add(t),this}equals(t){return t.min.equals(this.min)&&t.max.equals(this.max)}toJSON(){return{min:this.min.toArray(),max:this.max.toArray()}}fromJSON(t){return this.min.fromArray(t.min),this.max.fromArray(t.max),this}},Na=[new W,new W,new W,new W,new W,new W,new W,new W],Di=new W,Uf=new Ms,wo=new W,Co=new W,Ro=new W,vs=new W,_s=new W,rr=new W,ec=new W,Lf=new W,Of=new W,or=new W;function W0(e,t,n,i,a){for(let s=0,r=e.length-3;s<=r;s+=3){or.fromArray(e,s);let o=a.x*Math.abs(or.x)+a.y*Math.abs(or.y)+a.z*Math.abs(or.z),l=t.dot(or),c=n.dot(or),f=i.dot(or);if(Math.max(-Math.max(l,c,f),Math.min(l,c,f))>o)return!1}return!0}var Je=new W,If=new oe,zw=0,vi=class extends sa{constructor(t,n,i=!1){if(super(),Array.isArray(t))throw new TypeError("THREE.BufferAttribute: array should be a Typed Array.");this.isBufferAttribute=!0,Object.defineProperty(this,"id",{value:zw++}),this.name="",this.array=t,this.itemSize=n,this.count=t!==void 0?t.length/n:0,this.normalized=i,this.usage=zM,this.updateRanges=[],this.gpuType=Ii,this.version=0}onUploadCallback(){}set needsUpdate(t){t===!0&&this.version++}setUsage(t){return this.usage=t,this}addUpdateRange(t,n){this.updateRanges.push({start:t,count:n})}clearUpdateRanges(){this.updateRanges.length=0}copy(t){return this.name=t.name,this.array=new t.array.constructor(t.array),this.itemSize=t.itemSize,this.count=t.count,this.normalized=t.normalized,this.usage=t.usage,this.gpuType=t.gpuType,this}copyAt(t,n,i){t*=this.itemSize,i*=n.itemSize;for(let a=0,s=this.itemSize;a<s;a++)this.array[t+a]=n.array[i+a];return this}copyArray(t){return this.array.set(t),this}applyMatrix3(t){if(this.itemSize===2)for(let n=0,i=this.count;n<i;n++)If.fromBufferAttribute(this,n),If.applyMatrix3(t),this.setXY(n,If.x,If.y);else if(this.itemSize===3)for(let n=0,i=this.count;n<i;n++)Je.fromBufferAttribute(this,n),Je.applyMatrix3(t),this.setXYZ(n,Je.x,Je.y,Je.z);return this}applyMatrix4(t){for(let n=0,i=this.count;n<i;n++)Je.fromBufferAttribute(this,n),Je.applyMatrix4(t),this.setXYZ(n,Je.x,Je.y,Je.z);return this}applyNormalMatrix(t){for(let n=0,i=this.count;n<i;n++)Je.fromBufferAttribute(this,n),Je.applyNormalMatrix(t),this.setXYZ(n,Je.x,Je.y,Je.z);return this}transformDirection(t){for(let n=0,i=this.count;n<i;n++)Je.fromBufferAttribute(this,n),Je.transformDirection(t),this.setXYZ(n,Je.x,Je.y,Je.z);return this}set(t,n=0){return this.array.set(t,n),this}getComponent(t,n){let i=this.array[t*this.itemSize+n];return this.normalized&&(i=$l(i,this.array)),i}setComponent(t,n,i){return this.normalized&&(i=zn(i,this.array)),this.array[t*this.itemSize+n]=i,this}getX(t){let n=this.array[t*this.itemSize];return this.normalized&&(n=$l(n,this.array)),n}setX(t,n){return this.normalized&&(n=zn(n,this.array)),this.array[t*this.itemSize]=n,this}getY(t){let n=this.array[t*this.itemSize+1];return this.normalized&&(n=$l(n,this.array)),n}setY(t,n){return this.normalized&&(n=zn(n,this.array)),this.array[t*this.itemSize+1]=n,this}getZ(t){let n=this.array[t*this.itemSize+2];return this.normalized&&(n=$l(n,this.array)),n}setZ(t,n){return this.normalized&&(n=zn(n,this.array)),this.array[t*this.itemSize+2]=n,this}getW(t){let n=this.array[t*this.itemSize+3];return this.normalized&&(n=$l(n,this.array)),n}setW(t,n){return this.normalized&&(n=zn(n,this.array)),this.array[t*this.itemSize+3]=n,this}setXY(t,n,i){return t*=this.itemSize,this.normalized&&(n=zn(n,this.array),i=zn(i,this.array)),this.array[t+0]=n,this.array[t+1]=i,this}setXYZ(t,n,i,a){return t*=this.itemSize,this.normalized&&(n=zn(n,this.array),i=zn(i,this.array),a=zn(a,this.array)),this.array[t+0]=n,this.array[t+1]=i,this.array[t+2]=a,this}setXYZW(t,n,i,a,s){return t*=this.itemSize,this.normalized&&(n=zn(n,this.array),i=zn(i,this.array),a=zn(a,this.array),s=zn(s,this.array)),this.array[t+0]=n,this.array[t+1]=i,this.array[t+2]=a,this.array[t+3]=s,this}onUpload(t){return this.onUploadCallback=t,this}clone(){return new this.constructor(this.array,this.itemSize).copy(this)}toJSON(){let t={itemSize:this.itemSize,type:this.array.constructor.name,array:Array.from(this.array),normalized:this.normalized};return t.name=this.name,t.usage=this.usage,t.gpuType=this.gpuType,t}dispose(){this.dispatchEvent({type:"dispose"})}};var hc=class extends vi{constructor(t,n,i){super(new Uint16Array(t),n,i)}};var dc=class extends vi{constructor(t,n,i){super(new Uint32Array(t),n,i)}};var _i=class extends vi{constructor(t,n,i){super(new Float32Array(t),n,i)}},Fw=new Ms,nc=new W,q0=new W,Fo=class{constructor(t=new W,n=-1){this.isSphere=!0,this.center=t,this.radius=n}set(t,n){return this.center.copy(t),this.radius=n,this}setFromPoints(t,n){let i=this.center;n!==void 0?i.copy(n):Fw.setFromPoints(t).getCenter(i);let a=0;for(let s=0,r=t.length;s<r;s++)a=Math.max(a,i.distanceToSquared(t[s]));return this.radius=Math.sqrt(a),this}copy(t){return this.center.copy(t.center),this.radius=t.radius,this}isEmpty(){return this.radius<0}makeEmpty(){return this.center.set(0,0,0),this.radius=-1,this}containsPoint(t){return t.distanceToSquared(this.center)<=this.radius*this.radius}distanceToPoint(t){return t.distanceTo(this.center)-this.radius}intersectsSphere(t){let n=this.radius+t.radius;return t.center.distanceToSquared(this.center)<=n*n}intersectsBox(t){return t.intersectsSphere(this)}intersectsPlane(t){return Math.abs(t.distanceToPoint(this.center))<=this.radius}clampPoint(t,n){let i=this.center.distanceToSquared(t);return n.copy(t),i>this.radius*this.radius&&(n.sub(this.center).normalize(),n.multiplyScalar(this.radius).add(this.center)),n}getBoundingBox(t){return this.isEmpty()?(t.makeEmpty(),t):(t.set(this.center,this.center),t.expandByScalar(this.radius),t)}applyMatrix4(t){return this.center.applyMatrix4(t),this.radius=this.radius*t.getMaxScaleOnAxis(),this}translate(t){return this.center.add(t),this}expandByPoint(t){if(this.isEmpty())return this.center.copy(t),this.radius=0,this;nc.subVectors(t,this.center);let n=nc.lengthSq();if(n>this.radius*this.radius){let i=Math.sqrt(n),a=(i-this.radius)*.5;this.center.addScaledVector(nc,a/i),this.radius+=a}return this}union(t){return t.isEmpty()?this:this.isEmpty()?(this.copy(t),this):(this.center.equals(t.center)===!0?this.radius=Math.max(this.radius,t.radius):(q0.subVectors(t.center,this.center).setLength(t.radius),this.expandByPoint(nc.copy(t.center).add(q0)),this.expandByPoint(nc.copy(t.center).sub(q0))),this)}equals(t){return t.center.equals(this.center)&&t.radius===this.radius}clone(){return new this.constructor().copy(this)}toJSON(){return{radius:this.radius,center:this.center.toArray()}}fromJSON(t){return this.radius=t.radius,this.center.fromArray(t.center),this}},Hw=0,gi=new Xe,Y0=new xi,Do=new W,ei=new Ms,ic=new Ms,rn=new W,oa=class e extends sa{constructor(){super(),this.isBufferGeometry=!0,Object.defineProperty(this,"id",{value:Hw++}),this.uuid=Rc(),this.name="",this.type="BufferGeometry",this.index=null,this.indirect=null,this.indirectOffset=0,this.attributes={},this.morphAttributes={},this.morphTargetsRelative=!1,this.groups=[],this.boundingBox=null,this.boundingSphere=null,this.drawRange={start:0,count:1/0},this.userData={},this._transformed=!1}getIndex(){return this.index}setIndex(t){return Array.isArray(t)?this.index=new(Ew(t)?dc:hc)(t,1):this.index=t,this}setIndirect(t,n=0){return this.indirect=t,this.indirectOffset=n,this}getIndirect(){return this.indirect}getAttribute(t){return this.attributes[t]}setAttribute(t,n){return this.attributes[t]=n,this}deleteAttribute(t){return delete this.attributes[t],this}hasAttribute(t){return this.attributes[t]!==void 0}addGroup(t,n,i=0){this.groups.push({start:t,count:n,materialIndex:i})}clearGroups(){this.groups=[]}setDrawRange(t,n){this.drawRange.start=t,this.drawRange.count=n}applyMatrix4(t){let n=this.attributes.position;n!==void 0&&(n.applyMatrix4(t),n.needsUpdate=!0);let i=this.attributes.normal;if(i!==void 0){let s=new Xt().getNormalMatrix(t);i.applyNormalMatrix(s),i.needsUpdate=!0}let a=this.attributes.tangent;return a!==void 0&&(a.transformDirection(t),a.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this._transformed=!0,this}applyQuaternion(t){return gi.makeRotationFromQuaternion(t),this.applyMatrix4(gi),this}rotateX(t){return gi.makeRotationX(t),this.applyMatrix4(gi),this}rotateY(t){return gi.makeRotationY(t),this.applyMatrix4(gi),this}rotateZ(t){return gi.makeRotationZ(t),this.applyMatrix4(gi),this}translate(t,n,i){return gi.makeTranslation(t,n,i),this.applyMatrix4(gi),this}scale(t,n,i){return gi.makeScale(t,n,i),this.applyMatrix4(gi),this}lookAt(t){return Y0.lookAt(t),Y0.updateMatrix(),this.applyMatrix4(Y0.matrix),this}center(){return this.computeBoundingBox(),this.boundingBox.getCenter(Do).negate(),this.translate(Do.x,Do.y,Do.z),this}setFromPoints(t){let n=this.getAttribute("position");if(n===void 0){let i=[];for(let a=0,s=t.length;a<s;a++){let r=t[a];i.push(r.x,r.y,r.z||0)}this.setAttribute("position",new _i(i,3))}else{let i=Math.min(t.length,n.count);for(let a=0;a<i;a++){let s=t[a];n.setXYZ(a,s.x,s.y,s.z||0)}t.length>n.count&&Ft("BufferGeometry: Buffer size too small for points data. Use .dispose() and create a new geometry."),n.needsUpdate=!0}return this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new Ms);let t=this.attributes.position,n=this.morphAttributes.position;if(t&&t.isGLBufferAttribute){Vt("BufferGeometry.computeBoundingBox(): GLBufferAttribute requires a manual bounding box.",this),this.boundingBox.set(new W(-1/0,-1/0,-1/0),new W(1/0,1/0,1/0));return}if(t!==void 0){if(this.boundingBox.setFromBufferAttribute(t),n)for(let i=0,a=n.length;i<a;i++){let s=n[i];ei.setFromBufferAttribute(s),this.morphTargetsRelative?(rn.addVectors(this.boundingBox.min,ei.min),this.boundingBox.expandByPoint(rn),rn.addVectors(this.boundingBox.max,ei.max),this.boundingBox.expandByPoint(rn)):(this.boundingBox.expandByPoint(ei.min),this.boundingBox.expandByPoint(ei.max))}}else this.boundingBox.makeEmpty();(isNaN(this.boundingBox.min.x)||isNaN(this.boundingBox.min.y)||isNaN(this.boundingBox.min.z))&&Vt('BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.',this)}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new Fo);let t=this.attributes.position,n=this.morphAttributes.position;if(t&&t.isGLBufferAttribute){Vt("BufferGeometry.computeBoundingSphere(): GLBufferAttribute requires a manual bounding sphere.",this),this.boundingSphere.set(new W,1/0);return}if(t){let i=this.boundingSphere.center;if(ei.setFromBufferAttribute(t),n)for(let s=0,r=n.length;s<r;s++){let o=n[s];ic.setFromBufferAttribute(o),this.morphTargetsRelative?(rn.addVectors(ei.min,ic.min),ei.expandByPoint(rn),rn.addVectors(ei.max,ic.max),ei.expandByPoint(rn)):(ei.expandByPoint(ic.min),ei.expandByPoint(ic.max))}ei.getCenter(i);let a=0;for(let s=0,r=t.count;s<r;s++)rn.fromBufferAttribute(t,s),a=Math.max(a,i.distanceToSquared(rn));if(n)for(let s=0,r=n.length;s<r;s++){let o=n[s],l=this.morphTargetsRelative;for(let c=0,f=o.count;c<f;c++)rn.fromBufferAttribute(o,c),l&&(Do.fromBufferAttribute(t,c),rn.add(Do)),a=Math.max(a,i.distanceToSquared(rn))}this.boundingSphere.radius=Math.sqrt(a),isNaN(this.boundingSphere.radius)&&Vt('BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.',this)}}computeTangents(){let t=this.index,n=this.attributes;if(t===null||n.position===void 0||n.normal===void 0||n.uv===void 0){Vt("BufferGeometry: .computeTangents() failed. Missing required attributes (index, position, normal or uv)");return}let i=n.position,a=n.normal,s=n.uv,r=this.getAttribute("tangent");(r===void 0||r.count!==i.count)&&(r=new vi(new Float32Array(4*i.count),4),this.setAttribute("tangent",r));let o=[],l=[];for(let x=0;x<i.count;x++)o[x]=new W,l[x]=new W;let c=new W,f=new W,p=new W,u=new oe,d=new oe,_=new oe,b=new W,m=new W;function h(x,w,R){c.fromBufferAttribute(i,x),f.fromBufferAttribute(i,w),p.fromBufferAttribute(i,R),u.fromBufferAttribute(s,x),d.fromBufferAttribute(s,w),_.fromBufferAttribute(s,R),f.sub(c),p.sub(c),d.sub(u),_.sub(u);let D=1/(d.x*_.y-_.x*d.y);isFinite(D)&&(b.copy(f).multiplyScalar(_.y).addScaledVector(p,-d.y).multiplyScalar(D),m.copy(p).multiplyScalar(d.x).addScaledVector(f,-_.x).multiplyScalar(D),o[x].add(b),o[w].add(b),o[R].add(b),l[x].add(m),l[w].add(m),l[R].add(m))}let g=this.groups;g.length===0&&(g=[{start:0,count:t.count}]);for(let x=0,w=g.length;x<w;++x){let R=g[x],D=R.start,P=R.count;for(let F=D,U=D+P;F<U;F+=3)h(t.getX(F+0),t.getX(F+1),t.getX(F+2))}let S=new W,y=new W,T=new W,A=new W;function E(x){T.fromBufferAttribute(a,x),A.copy(T);let w=o[x];S.copy(w),S.sub(T.multiplyScalar(T.dot(w))).normalize(),y.crossVectors(A,w);let D=y.dot(l[x])<0?-1:1;r.setXYZW(x,S.x,S.y,S.z,D)}for(let x=0,w=g.length;x<w;++x){let R=g[x],D=R.start,P=R.count;for(let F=D,U=D+P;F<U;F+=3)E(t.getX(F+0)),E(t.getX(F+1)),E(t.getX(F+2))}this._transformed=!0}computeVertexNormals(){let t=this.index,n=this.getAttribute("position");if(n!==void 0){let i=this.getAttribute("normal");if(i===void 0||i.count!==n.count)i=new vi(new Float32Array(n.count*3),3),this.setAttribute("normal",i);else for(let u=0,d=i.count;u<d;u++)i.setXYZ(u,0,0,0);let a=new W,s=new W,r=new W,o=new W,l=new W,c=new W,f=new W,p=new W;if(t)for(let u=0,d=t.count;u<d;u+=3){let _=t.getX(u+0),b=t.getX(u+1),m=t.getX(u+2);a.fromBufferAttribute(n,_),s.fromBufferAttribute(n,b),r.fromBufferAttribute(n,m),f.subVectors(r,s),p.subVectors(a,s),f.cross(p),o.fromBufferAttribute(i,_),l.fromBufferAttribute(i,b),c.fromBufferAttribute(i,m),o.add(f),l.add(f),c.add(f),i.setXYZ(_,o.x,o.y,o.z),i.setXYZ(b,l.x,l.y,l.z),i.setXYZ(m,c.x,c.y,c.z)}else for(let u=0,d=n.count;u<d;u+=3)a.fromBufferAttribute(n,u+0),s.fromBufferAttribute(n,u+1),r.fromBufferAttribute(n,u+2),f.subVectors(r,s),p.subVectors(a,s),f.cross(p),i.setXYZ(u+0,f.x,f.y,f.z),i.setXYZ(u+1,f.x,f.y,f.z),i.setXYZ(u+2,f.x,f.y,f.z);this.normalizeNormals(),i.needsUpdate=!0}}normalizeNormals(){let t=this.attributes.normal;for(let n=0,i=t.count;n<i;n++)rn.fromBufferAttribute(t,n),rn.normalize(),t.setXYZ(n,rn.x,rn.y,rn.z)}toNonIndexed(){function t(o,l){let c=o.array,f=o.itemSize,p=o.normalized,u=new c.constructor(l.length*f),d=0,_=0;for(let b=0,m=l.length;b<m;b++){o.isInterleavedBufferAttribute?d=l[b]*o.data.stride+o.offset:d=l[b]*f;for(let h=0;h<f;h++)u[_++]=c[d++]}return new vi(u,f,p)}if(this.index===null)return Ft("BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed."),this;let n=new e,i=this.index.array,a=this.attributes;for(let o in a){let l=a[o],c=t(l,i);n.setAttribute(o,c)}let s=this.morphAttributes;for(let o in s){let l=[],c=s[o];for(let f=0,p=c.length;f<p;f++){let u=c[f],d=t(u,i);l.push(d)}n.morphAttributes[o]=l}n.morphTargetsRelative=this.morphTargetsRelative;let r=this.groups;for(let o=0,l=r.length;o<l;o++){let c=r[o];n.addGroup(c.start,c.count,c.materialIndex)}return n}toJSON(){let t={metadata:{version:4.7,type:"BufferGeometry",generator:"BufferGeometry.toJSON"}};if(t.uuid=this.uuid,t.type=this.parameters!==void 0&&this._transformed===!0?"BufferGeometry":this.type,t.name=this.name,Object.keys(this.userData).length>0&&(t.userData=this.userData),this.parameters!==void 0&&this._transformed!==!0){let l=this.parameters;for(let c in l)l[c]!==void 0&&(t[c]=l[c]);return t}t.data={attributes:{}};let n=this.index;n!==null&&(t.data.index={type:n.array.constructor.name,array:Array.prototype.slice.call(n.array)});let i=this.attributes;for(let l in i){let c=i[l];t.data.attributes[l]=c.toJSON(t.data)}let a={},s=!1;for(let l in this.morphAttributes){let c=this.morphAttributes[l],f=[];for(let p=0,u=c.length;p<u;p++){let d=c[p];f.push(d.toJSON(t.data))}f.length>0&&(a[l]=f,s=!0)}s&&(t.data.morphAttributes=a,t.data.morphTargetsRelative=this.morphTargetsRelative);let r=this.groups;r.length>0&&(t.data.groups=JSON.parse(JSON.stringify(r)));let o=this.boundingSphere;return o!==null&&(t.data.boundingSphere=o.toJSON()),t}clone(){return new this.constructor().copy(this)}copy(t){this.index=null,this.attributes={},this.morphAttributes={},this.groups=[],this.boundingBox=null,this.boundingSphere=null;let n={};this.name=t.name;let i=t.index;i!==null&&this.setIndex(i.clone());let a=t.attributes;for(let c in a){let f=a[c];this.setAttribute(c,f.clone(n))}let s=t.morphAttributes;for(let c in s){let f=[],p=s[c];for(let u=0,d=p.length;u<d;u++)f.push(p[u].clone(n));this.morphAttributes[c]=f}this.morphTargetsRelative=t.morphTargetsRelative;let r=t.groups;for(let c=0,f=r.length;c<f;c++){let p=r[c];this.addGroup(p.start,p.count,p.materialIndex)}let o=t.boundingBox;o!==null&&(this.boundingBox=o.clone());let l=t.boundingSphere;return l!==null&&(this.boundingSphere=l.clone()),this.drawRange.start=t.drawRange.start,this.drawRange.count=t.drawRange.count,this.userData=t.userData,this._transformed=t._transformed,this}dispose(){this.dispatchEvent({type:"dispose"})}};var Z0=new W,Vw=new W,Gw=new Xt,Ni=class{constructor(t=new W(1,0,0),n=0){this.isPlane=!0,this.normal=t,this.constant=n}set(t,n){return this.normal.copy(t),this.constant=n,this}setComponents(t,n,i,a){return this.normal.set(t,n,i),this.constant=a,this}setFromNormalAndCoplanarPoint(t,n){return this.normal.copy(t),this.constant=-n.dot(this.normal),this}setFromCoplanarPoints(t,n,i){let a=Z0.subVectors(i,n).cross(Vw.subVectors(t,n)).normalize();return this.setFromNormalAndCoplanarPoint(a,t),this}copy(t){return this.normal.copy(t.normal),this.constant=t.constant,this}normalize(){let t=1/this.normal.length();return this.normal.multiplyScalar(t),this.constant*=t,this}negate(){return this.constant*=-1,this.normal.negate(),this}distanceToPoint(t){return this.normal.dot(t)+this.constant}distanceToSphere(t){return this.distanceToPoint(t.center)-t.radius}projectPoint(t,n){return n.copy(t).addScaledVector(this.normal,-this.distanceToPoint(t))}intersectLine(t,n,i=!0){let a=t.delta(Z0),s=this.normal.dot(a);if(s===0)return this.distanceToPoint(t.start)===0?n.copy(t.start):null;let r=-(t.start.dot(this.normal)+this.constant)/s;return i===!0&&(r<0||r>1)?null:n.copy(t.start).addScaledVector(a,r)}intersectsLine(t){let n=this.distanceToPoint(t.start),i=this.distanceToPoint(t.end);return n<0&&i>0||i<0&&n>0}intersectsBox(t){return t.intersectsPlane(this)}intersectsSphere(t){return t.intersectsPlane(this)}coplanarPoint(t){return t.copy(this.normal).multiplyScalar(-this.constant)}applyMatrix4(t,n){let i=n||Gw.getNormalMatrix(t),a=this.coplanarPoint(Z0).applyMatrix4(t),s=this.normal.applyMatrix3(i).normalize();return this.constant=-a.dot(s),this}translate(t){return this.constant-=t.dot(this.normal),this}equals(t){return t.normal.equals(this.normal)&&t.constant===this.constant}clone(){return new this.constructor().copy(this)}toJSON(){return{normal:this.normal.toArray(),constant:this.constant}}fromJSON(t){return this.normal.fromArray(t.normal),this.constant=t.constant,this}},kw=0,hr=class extends sa{constructor(){super(),this.isMaterial=!0,Object.defineProperty(this,"id",{value:kw++}),this.uuid=Rc(),this.name="",this.type="Material",this.blending=Cs,this.side=ws,this.vertexColors=!1,this.opacity=1,this.transparent=!1,this.alphaHash=!1,this.blendSrc=lg,this.blendDst=cg,this.blendEquation=mr,this.blendSrcAlpha=null,this.blendDstAlpha=null,this.blendEquationAlpha=null,this.blendColor=new Zt(0,0,0),this.blendAlpha=0,this.depthFunc=Io,this.depthTest=!0,this.depthWrite=!0,this.stencilWriteMask=255,this.stencilFunc=NM,this.stencilRef=0,this.stencilFuncMask=255,this.stencilFail=Jf,this.stencilZFail=Jf,this.stencilZPass=Jf,this.stencilWrite=!1,this.clippingPlanes=null,this.clipIntersection=!1,this.clipShadows=!1,this.shadowSide=null,this.colorWrite=!0,this.precision=null,this.polygonOffset=!1,this.polygonOffsetFactor=0,this.polygonOffsetUnits=0,this.dithering=!1,this.alphaToCoverage=!1,this.premultipliedAlpha=!1,this.forceSinglePass=!1,this.allowOverride=!0,this.visible=!0,this.toneMapped=!0,this.userData={},this.version=0,this._alphaTest=0}get alphaTest(){return this._alphaTest}set alphaTest(t){this._alphaTest>0!=t>0&&this.version++,this._alphaTest=t}onBeforeRender(){}onBeforeCompile(){}customProgramCacheKey(){return this.onBeforeCompile.toString()}setValues(t){if(t!==void 0)for(let n in t){let i=t[n];if(i===void 0){Ft(`Material: parameter '${n}' has value of undefined.`);continue}let a=this[n];if(a===void 0){Ft(`Material: '${n}' is not a property of THREE.${this.type}.`);continue}a&&a.isColor?a.set(i):a&&a.isVector2&&i&&i.isVector2||a&&a.isEuler&&i&&i.isEuler||a&&a.isVector3&&i&&i.isVector3?a.copy(i):this[n]=i}}toJSON(t){let n=t===void 0||typeof t=="string";n&&(t={textures:{},images:{}});let i={metadata:{version:4.7,type:"Material",generator:"Material.toJSON"}};i.uuid=this.uuid,i.type=this.type,i.blending=this.blending,i.side=this.side,i.shadowSide=this.shadowSide,i.vertexColors=this.vertexColors,i.opacity=this.opacity,i.transparent=this.transparent,i.blendSrc=this.blendSrc,i.blendDst=this.blendDst,i.blendEquation=this.blendEquation,i.blendSrcAlpha=this.blendSrcAlpha,i.blendDstAlpha=this.blendDstAlpha,i.blendEquationAlpha=this.blendEquationAlpha,i.blendColor=this.blendColor.getHex(),i.blendAlpha=this.blendAlpha,i.depthFunc=this.depthFunc,i.depthTest=this.depthTest,i.depthWrite=this.depthWrite,i.colorWrite=this.colorWrite,i.clipIntersection=this.clipIntersection,i.clipShadows=this.clipShadows,i.stencilWriteMask=this.stencilWriteMask,i.stencilFunc=this.stencilFunc,i.stencilRef=this.stencilRef,i.stencilFuncMask=this.stencilFuncMask,i.stencilFail=this.stencilFail,i.stencilZFail=this.stencilZFail,i.stencilZPass=this.stencilZPass,i.stencilWrite=this.stencilWrite,i.polygonOffset=this.polygonOffset,i.polygonOffsetFactor=this.polygonOffsetFactor,i.polygonOffsetUnits=this.polygonOffsetUnits,i.dithering=this.dithering,i.alphaTest=this.alphaTest,i.alphaHash=this.alphaHash,i.alphaToCoverage=this.alphaToCoverage,i.premultipliedAlpha=this.premultipliedAlpha,i.forceSinglePass=this.forceSinglePass,i.allowOverride=this.allowOverride,i.visible=this.visible,i.toneMapped=this.toneMapped,i.name=this.name,this.color&&this.color.isColor&&(i.color=this.color.getHex()),this.roughness!==void 0&&(i.roughness=this.roughness),this.metalness!==void 0&&(i.metalness=this.metalness),this.sheen!==void 0&&(i.sheen=this.sheen),this.sheenColor&&this.sheenColor.isColor&&(i.sheenColor=this.sheenColor.getHex()),this.sheenRoughness!==void 0&&(i.sheenRoughness=this.sheenRoughness),this.emissive&&this.emissive.isColor&&(i.emissive=this.emissive.getHex()),this.emissiveIntensity!==void 0&&(i.emissiveIntensity=this.emissiveIntensity),this.specular&&this.specular.isColor&&(i.specular=this.specular.getHex()),this.specularIntensity!==void 0&&(i.specularIntensity=this.specularIntensity),this.specularColor&&this.specularColor.isColor&&(i.specularColor=this.specularColor.getHex()),this.shininess!==void 0&&(i.shininess=this.shininess),this.clearcoat!==void 0&&(i.clearcoat=this.clearcoat),this.clearcoatRoughness!==void 0&&(i.clearcoatRoughness=this.clearcoatRoughness),this.clearcoatMap&&this.clearcoatMap.isTexture&&(i.clearcoatMap=this.clearcoatMap.toJSON(t).uuid),this.clearcoatRoughnessMap&&this.clearcoatRoughnessMap.isTexture&&(i.clearcoatRoughnessMap=this.clearcoatRoughnessMap.toJSON(t).uuid),this.clearcoatNormalMap&&this.clearcoatNormalMap.isTexture&&(i.clearcoatNormalMap=this.clearcoatNormalMap.toJSON(t).uuid,i.clearcoatNormalScale=this.clearcoatNormalScale.toArray()),this.sheenColorMap&&this.sheenColorMap.isTexture&&(i.sheenColorMap=this.sheenColorMap.toJSON(t).uuid),this.sheenRoughnessMap&&this.sheenRoughnessMap.isTexture&&(i.sheenRoughnessMap=this.sheenRoughnessMap.toJSON(t).uuid),this.dispersion!==void 0&&(i.dispersion=this.dispersion),this.retroreflectivity!==void 0&&(i.retroreflectivity=this.retroreflectivity),this.iridescence!==void 0&&(i.iridescence=this.iridescence),this.iridescenceIOR!==void 0&&(i.iridescenceIOR=this.iridescenceIOR),this.iridescenceThicknessRange!==void 0&&(i.iridescenceThicknessRange=this.iridescenceThicknessRange),this.iridescenceMap&&this.iridescenceMap.isTexture&&(i.iridescenceMap=this.iridescenceMap.toJSON(t).uuid),this.iridescenceThicknessMap&&this.iridescenceThicknessMap.isTexture&&(i.iridescenceThicknessMap=this.iridescenceThicknessMap.toJSON(t).uuid),this.anisotropy!==void 0&&(i.anisotropy=this.anisotropy),this.anisotropyRotation!==void 0&&(i.anisotropyRotation=this.anisotropyRotation),this.anisotropyMap&&this.anisotropyMap.isTexture&&(i.anisotropyMap=this.anisotropyMap.toJSON(t).uuid),this.map&&this.map.isTexture&&(i.map=this.map.toJSON(t).uuid),this.matcap&&this.matcap.isTexture&&(i.matcap=this.matcap.toJSON(t).uuid),this.alphaMap&&this.alphaMap.isTexture&&(i.alphaMap=this.alphaMap.toJSON(t).uuid),this.lightMap&&this.lightMap.isTexture&&(i.lightMap=this.lightMap.toJSON(t).uuid,i.lightMapIntensity=this.lightMapIntensity),this.aoMap&&this.aoMap.isTexture&&(i.aoMap=this.aoMap.toJSON(t).uuid,i.aoMapIntensity=this.aoMapIntensity),this.bumpMap&&this.bumpMap.isTexture&&(i.bumpMap=this.bumpMap.toJSON(t).uuid,i.bumpScale=this.bumpScale),this.normalMap&&this.normalMap.isTexture&&(i.normalMap=this.normalMap.toJSON(t).uuid,i.normalMapType=this.normalMapType,i.normalScale=this.normalScale.toArray()),this.displacementMap&&this.displacementMap.isTexture&&(i.displacementMap=this.displacementMap.toJSON(t).uuid,i.displacementScale=this.displacementScale,i.displacementBias=this.displacementBias),this.roughnessMap&&this.roughnessMap.isTexture&&(i.roughnessMap=this.roughnessMap.toJSON(t).uuid),this.metalnessMap&&this.metalnessMap.isTexture&&(i.metalnessMap=this.metalnessMap.toJSON(t).uuid),this.emissiveMap&&this.emissiveMap.isTexture&&(i.emissiveMap=this.emissiveMap.toJSON(t).uuid),this.specularMap&&this.specularMap.isTexture&&(i.specularMap=this.specularMap.toJSON(t).uuid),this.specularIntensityMap&&this.specularIntensityMap.isTexture&&(i.specularIntensityMap=this.specularIntensityMap.toJSON(t).uuid),this.specularColorMap&&this.specularColorMap.isTexture&&(i.specularColorMap=this.specularColorMap.toJSON(t).uuid),this.envMap&&this.envMap.isTexture&&(i.envMap=this.envMap.toJSON(t).uuid,this.combine!==void 0&&(i.combine=this.combine)),this.envMapRotation!==void 0&&(i.envMapRotation=this.envMapRotation.toArray()),this.envMapIntensity!==void 0&&(i.envMapIntensity=this.envMapIntensity),this.reflectivity!==void 0&&(i.reflectivity=this.reflectivity),this.refractionRatio!==void 0&&(i.refractionRatio=this.refractionRatio),this.gradientMap&&this.gradientMap.isTexture&&(i.gradientMap=this.gradientMap.toJSON(t).uuid),this.transmission!==void 0&&(i.transmission=this.transmission),this.transmissionMap&&this.transmissionMap.isTexture&&(i.transmissionMap=this.transmissionMap.toJSON(t).uuid),this.thickness!==void 0&&(i.thickness=this.thickness),this.thicknessMap&&this.thicknessMap.isTexture&&(i.thicknessMap=this.thicknessMap.toJSON(t).uuid),this.attenuationDistance!==void 0&&(i.attenuationDistance=this.attenuationDistance),this.attenuationColor!==void 0&&(i.attenuationColor=this.attenuationColor.getHex()),this.size!==void 0&&(i.size=this.size),this.sizeAttenuation!==void 0&&(i.sizeAttenuation=this.sizeAttenuation),Array.isArray(this.clippingPlanes)&&this.clippingPlanes.length>0&&(i.clippingPlanes=this.clippingPlanes.map(s=>s.toJSON())),this.rotation!==void 0&&(i.rotation=this.rotation),this.depthPacking!==void 0&&(i.depthPacking=this.depthPacking),this.linewidth!==void 0&&(i.linewidth=this.linewidth),this.linecap!==void 0&&(i.linecap=this.linecap),this.linejoin!==void 0&&(i.linejoin=this.linejoin),this.dashSize!==void 0&&(i.dashSize=this.dashSize),this.gapSize!==void 0&&(i.gapSize=this.gapSize),this.scale!==void 0&&(i.scale=this.scale),this.wireframe!==void 0&&(i.wireframe=this.wireframe),this.wireframeLinewidth!==void 0&&(i.wireframeLinewidth=this.wireframeLinewidth),this.wireframeLinecap!==void 0&&(i.wireframeLinecap=this.wireframeLinecap),this.wireframeLinejoin!==void 0&&(i.wireframeLinejoin=this.wireframeLinejoin),this.flatShading!==void 0&&(i.flatShading=this.flatShading),this.fog!==void 0&&(i.fog=this.fog),Object.keys(this.userData).length>0&&(i.userData=this.userData);function a(s){let r=[];for(let o in s){let l=s[o];delete l.metadata,r.push(l)}return r}if(n){let s=a(t.textures),r=a(t.images);s.length>0&&(i.textures=s),r.length>0&&(i.images=r)}return i}fromJSON(t,n){if(t.uuid!==void 0&&(this.uuid=t.uuid),t.name!==void 0&&(this.name=t.name),t.color!==void 0&&this.color!==void 0&&this.color.setHex(t.color),t.roughness!==void 0&&(this.roughness=t.roughness),t.metalness!==void 0&&(this.metalness=t.metalness),t.sheen!==void 0&&(this.sheen=t.sheen),t.sheenColor!==void 0&&(this.sheenColor=new Zt().setHex(t.sheenColor)),t.sheenRoughness!==void 0&&(this.sheenRoughness=t.sheenRoughness),t.emissive!==void 0&&this.emissive!==void 0&&this.emissive.setHex(t.emissive),t.specular!==void 0&&this.specular!==void 0&&this.specular.setHex(t.specular),t.specularIntensity!==void 0&&(this.specularIntensity=t.specularIntensity),t.specularColor!==void 0&&this.specularColor!==void 0&&this.specularColor.setHex(t.specularColor),t.shininess!==void 0&&(this.shininess=t.shininess),t.clearcoat!==void 0&&(this.clearcoat=t.clearcoat),t.clearcoatRoughness!==void 0&&(this.clearcoatRoughness=t.clearcoatRoughness),t.dispersion!==void 0&&(this.dispersion=t.dispersion),t.retroreflectivity!==void 0&&(this.retroreflectivity=t.retroreflectivity),t.iridescence!==void 0&&(this.iridescence=t.iridescence),t.iridescenceIOR!==void 0&&(this.iridescenceIOR=t.iridescenceIOR),t.iridescenceThicknessRange!==void 0&&(this.iridescenceThicknessRange=t.iridescenceThicknessRange),t.transmission!==void 0&&(this.transmission=t.transmission),t.thickness!==void 0&&(this.thickness=t.thickness),t.attenuationDistance!==void 0&&(this.attenuationDistance=t.attenuationDistance),t.attenuationColor!==void 0&&this.attenuationColor!==void 0&&this.attenuationColor.setHex(t.attenuationColor),t.anisotropy!==void 0&&(this.anisotropy=t.anisotropy),t.anisotropyRotation!==void 0&&(this.anisotropyRotation=t.anisotropyRotation),t.fog!==void 0&&(this.fog=t.fog),t.flatShading!==void 0&&(this.flatShading=t.flatShading),t.blending!==void 0&&(this.blending=t.blending),t.combine!==void 0&&(this.combine=t.combine),t.side!==void 0&&(this.side=t.side),t.shadowSide!==void 0&&(this.shadowSide=t.shadowSide),t.opacity!==void 0&&(this.opacity=t.opacity),t.transparent!==void 0&&(this.transparent=t.transparent),t.alphaTest!==void 0&&(this.alphaTest=t.alphaTest),t.alphaHash!==void 0&&(this.alphaHash=t.alphaHash),t.depthFunc!==void 0&&(this.depthFunc=t.depthFunc),t.depthTest!==void 0&&(this.depthTest=t.depthTest),t.depthWrite!==void 0&&(this.depthWrite=t.depthWrite),t.colorWrite!==void 0&&(this.colorWrite=t.colorWrite),t.clippingPlanes!==void 0&&(this.clippingPlanes=t.clippingPlanes.map(i=>new Ni().fromJSON(i))),t.clipIntersection!==void 0&&(this.clipIntersection=t.clipIntersection),t.clipShadows!==void 0&&(this.clipShadows=t.clipShadows),t.depthPacking!==void 0&&(this.depthPacking=t.depthPacking),t.blendSrc!==void 0&&(this.blendSrc=t.blendSrc),t.blendDst!==void 0&&(this.blendDst=t.blendDst),t.blendEquation!==void 0&&(this.blendEquation=t.blendEquation),t.blendSrcAlpha!==void 0&&(this.blendSrcAlpha=t.blendSrcAlpha),t.blendDstAlpha!==void 0&&(this.blendDstAlpha=t.blendDstAlpha),t.blendEquationAlpha!==void 0&&(this.blendEquationAlpha=t.blendEquationAlpha),t.blendColor!==void 0&&this.blendColor!==void 0&&this.blendColor.setHex(t.blendColor),t.blendAlpha!==void 0&&(this.blendAlpha=t.blendAlpha),t.stencilWriteMask!==void 0&&(this.stencilWriteMask=t.stencilWriteMask),t.stencilFunc!==void 0&&(this.stencilFunc=t.stencilFunc),t.stencilRef!==void 0&&(this.stencilRef=t.stencilRef),t.stencilFuncMask!==void 0&&(this.stencilFuncMask=t.stencilFuncMask),t.stencilFail!==void 0&&(this.stencilFail=t.stencilFail),t.stencilZFail!==void 0&&(this.stencilZFail=t.stencilZFail),t.stencilZPass!==void 0&&(this.stencilZPass=t.stencilZPass),t.stencilWrite!==void 0&&(this.stencilWrite=t.stencilWrite),t.wireframe!==void 0&&(this.wireframe=t.wireframe),t.wireframeLinewidth!==void 0&&(this.wireframeLinewidth=t.wireframeLinewidth),t.wireframeLinecap!==void 0&&(this.wireframeLinecap=t.wireframeLinecap),t.wireframeLinejoin!==void 0&&(this.wireframeLinejoin=t.wireframeLinejoin),t.rotation!==void 0&&(this.rotation=t.rotation),t.linewidth!==void 0&&(this.linewidth=t.linewidth),t.linecap!==void 0&&(this.linecap=t.linecap),t.linejoin!==void 0&&(this.linejoin=t.linejoin),t.dashSize!==void 0&&(this.dashSize=t.dashSize),t.gapSize!==void 0&&(this.gapSize=t.gapSize),t.scale!==void 0&&(this.scale=t.scale),t.polygonOffset!==void 0&&(this.polygonOffset=t.polygonOffset),t.polygonOffsetFactor!==void 0&&(this.polygonOffsetFactor=t.polygonOffsetFactor),t.polygonOffsetUnits!==void 0&&(this.polygonOffsetUnits=t.polygonOffsetUnits),t.dithering!==void 0&&(this.dithering=t.dithering),t.alphaToCoverage!==void 0&&(this.alphaToCoverage=t.alphaToCoverage),t.premultipliedAlpha!==void 0&&(this.premultipliedAlpha=t.premultipliedAlpha),t.forceSinglePass!==void 0&&(this.forceSinglePass=t.forceSinglePass),t.allowOverride!==void 0&&(this.allowOverride=t.allowOverride),t.visible!==void 0&&(this.visible=t.visible),t.toneMapped!==void 0&&(this.toneMapped=t.toneMapped),t.userData!==void 0&&(this.userData=t.userData),t.vertexColors!==void 0&&(typeof t.vertexColors=="number"?this.vertexColors=t.vertexColors>0:this.vertexColors=t.vertexColors),t.size!==void 0&&(this.size=t.size),t.sizeAttenuation!==void 0&&(this.sizeAttenuation=t.sizeAttenuation),t.map!==void 0&&(this.map=n[t.map]||null),t.matcap!==void 0&&(this.matcap=n[t.matcap]||null),t.alphaMap!==void 0&&(this.alphaMap=n[t.alphaMap]||null),t.bumpMap!==void 0&&(this.bumpMap=n[t.bumpMap]||null),t.bumpScale!==void 0&&(this.bumpScale=t.bumpScale),t.normalMap!==void 0&&(this.normalMap=n[t.normalMap]||null),t.normalMapType!==void 0&&(this.normalMapType=t.normalMapType),t.normalScale!==void 0){let i=t.normalScale;Array.isArray(i)===!1&&(i=[i,i]),this.normalScale=new oe().fromArray(i)}return t.displacementMap!==void 0&&(this.displacementMap=n[t.displacementMap]||null),t.displacementScale!==void 0&&(this.displacementScale=t.displacementScale),t.displacementBias!==void 0&&(this.displacementBias=t.displacementBias),t.roughnessMap!==void 0&&(this.roughnessMap=n[t.roughnessMap]||null),t.metalnessMap!==void 0&&(this.metalnessMap=n[t.metalnessMap]||null),t.emissiveMap!==void 0&&(this.emissiveMap=n[t.emissiveMap]||null),t.emissiveIntensity!==void 0&&(this.emissiveIntensity=t.emissiveIntensity),t.specularMap!==void 0&&(this.specularMap=n[t.specularMap]||null),t.specularIntensityMap!==void 0&&(this.specularIntensityMap=n[t.specularIntensityMap]||null),t.specularColorMap!==void 0&&(this.specularColorMap=n[t.specularColorMap]||null),t.envMap!==void 0&&(this.envMap=n[t.envMap]||null),t.envMapRotation!==void 0&&this.envMapRotation.fromArray(t.envMapRotation),t.envMapIntensity!==void 0&&(this.envMapIntensity=t.envMapIntensity),t.reflectivity!==void 0&&(this.reflectivity=t.reflectivity),t.refractionRatio!==void 0&&(this.refractionRatio=t.refractionRatio),t.lightMap!==void 0&&(this.lightMap=n[t.lightMap]||null),t.lightMapIntensity!==void 0&&(this.lightMapIntensity=t.lightMapIntensity),t.aoMap!==void 0&&(this.aoMap=n[t.aoMap]||null),t.aoMapIntensity!==void 0&&(this.aoMapIntensity=t.aoMapIntensity),t.gradientMap!==void 0&&(this.gradientMap=n[t.gradientMap]||null),t.clearcoatMap!==void 0&&(this.clearcoatMap=n[t.clearcoatMap]||null),t.clearcoatRoughnessMap!==void 0&&(this.clearcoatRoughnessMap=n[t.clearcoatRoughnessMap]||null),t.clearcoatNormalMap!==void 0&&(this.clearcoatNormalMap=n[t.clearcoatNormalMap]||null),t.clearcoatNormalScale!==void 0&&(this.clearcoatNormalScale=new oe().fromArray(t.clearcoatNormalScale)),t.iridescenceMap!==void 0&&(this.iridescenceMap=n[t.iridescenceMap]||null),t.iridescenceThicknessMap!==void 0&&(this.iridescenceThicknessMap=n[t.iridescenceThicknessMap]||null),t.transmissionMap!==void 0&&(this.transmissionMap=n[t.transmissionMap]||null),t.thicknessMap!==void 0&&(this.thicknessMap=n[t.thicknessMap]||null),t.anisotropyMap!==void 0&&(this.anisotropyMap=n[t.anisotropyMap]||null),t.sheenColorMap!==void 0&&(this.sheenColorMap=n[t.sheenColorMap]||null),t.sheenRoughnessMap!==void 0&&(this.sheenRoughnessMap=n[t.sheenRoughnessMap]||null),this}clone(){return new this.constructor().copy(this)}copy(t){this.name=t.name,this.blending=t.blending,this.side=t.side,this.vertexColors=t.vertexColors,this.opacity=t.opacity,this.transparent=t.transparent,this.blendSrc=t.blendSrc,this.blendDst=t.blendDst,this.blendEquation=t.blendEquation,this.blendSrcAlpha=t.blendSrcAlpha,this.blendDstAlpha=t.blendDstAlpha,this.blendEquationAlpha=t.blendEquationAlpha,this.blendColor.copy(t.blendColor),this.blendAlpha=t.blendAlpha,this.depthFunc=t.depthFunc,this.depthTest=t.depthTest,this.depthWrite=t.depthWrite,this.stencilWriteMask=t.stencilWriteMask,this.stencilFunc=t.stencilFunc,this.stencilRef=t.stencilRef,this.stencilFuncMask=t.stencilFuncMask,this.stencilFail=t.stencilFail,this.stencilZFail=t.stencilZFail,this.stencilZPass=t.stencilZPass,this.stencilWrite=t.stencilWrite;let n=t.clippingPlanes,i=null;if(n!==null){let a=n.length;i=new Array(a);for(let s=0;s!==a;++s)i[s]=n[s].clone()}return this.clippingPlanes=i,this.clipIntersection=t.clipIntersection,this.clipShadows=t.clipShadows,this.shadowSide=t.shadowSide,this.colorWrite=t.colorWrite,this.precision=t.precision,this.polygonOffset=t.polygonOffset,this.polygonOffsetFactor=t.polygonOffsetFactor,this.polygonOffsetUnits=t.polygonOffsetUnits,this.dithering=t.dithering,this.alphaTest=t.alphaTest,this.alphaHash=t.alphaHash,this.alphaToCoverage=t.alphaToCoverage,this.premultipliedAlpha=t.premultipliedAlpha,this.forceSinglePass=t.forceSinglePass,this.allowOverride=t.allowOverride,this.visible=t.visible,this.toneMapped=t.toneMapped,this.userData=JSON.parse(JSON.stringify(t.userData)),this}dispose(){this.dispatchEvent({type:"dispose"})}set needsUpdate(t){t===!0&&this.version++}};var Ua=new W,J0=new W,Pf=new W,Bf=new W,uh=class{constructor(t=new W,n=new W(0,0,-1)){this.origin=t,this.direction=n}set(t,n){return this.origin.copy(t),this.direction.copy(n),this}copy(t){return this.origin.copy(t.origin),this.direction.copy(t.direction),this}at(t,n){return n.copy(this.origin).addScaledVector(this.direction,t)}lookAt(t){return this.direction.copy(t).sub(this.origin).normalize(),this}recast(t){return this.origin.copy(this.at(t,Ua)),this}closestPointToPoint(t,n){n.subVectors(t,this.origin);let i=n.dot(this.direction);return i<0?n.copy(this.origin):n.copy(this.origin).addScaledVector(this.direction,i)}distanceToPoint(t){return Math.sqrt(this.distanceSqToPoint(t))}distanceSqToPoint(t){let n=Ua.subVectors(t,this.origin).dot(this.direction);return n<0?this.origin.distanceToSquared(t):(Ua.copy(this.origin).addScaledVector(this.direction,n),Ua.distanceToSquared(t))}distanceSqToSegment(t,n,i,a){J0.copy(t).add(n).multiplyScalar(.5),Pf.copy(n).sub(t).normalize(),Bf.copy(this.origin).sub(J0);let s=t.distanceTo(n)*.5,r=-this.direction.dot(Pf),o=Bf.dot(this.direction),l=-Bf.dot(Pf),c=Bf.lengthSq(),f=Math.abs(1-r*r),p,u,d,_;if(f>0)if(p=r*l-o,u=r*o-l,_=s*f,p>=0)if(u>=-_)if(u<=_){let b=1/f;p*=b,u*=b,d=p*(p+r*u+2*o)+u*(r*p+u+2*l)+c}else u=s,p=Math.max(0,-(r*u+o)),d=-p*p+u*(u+2*l)+c;else u=-s,p=Math.max(0,-(r*u+o)),d=-p*p+u*(u+2*l)+c;else u<=-_?(p=Math.max(0,-(-r*s+o)),u=p>0?-s:Math.min(Math.max(-s,-l),s),d=-p*p+u*(u+2*l)+c):u<=_?(p=0,u=Math.min(Math.max(-s,-l),s),d=u*(u+2*l)+c):(p=Math.max(0,-(r*s+o)),u=p>0?s:Math.min(Math.max(-s,-l),s),d=-p*p+u*(u+2*l)+c);else u=r>0?-s:s,p=Math.max(0,-(r*u+o)),d=-p*p+u*(u+2*l)+c;return i&&i.copy(this.origin).addScaledVector(this.direction,p),a&&a.copy(J0).addScaledVector(Pf,u),d}intersectSphere(t,n){if(t.radius<0)return null;Ua.subVectors(t.center,this.origin);let i=Ua.dot(this.direction),a=Ua.dot(Ua)-i*i,s=t.radius*t.radius;if(a>s)return null;let r=Math.sqrt(s-a),o=i-r,l=i+r;return l<0?null:o<0?this.at(l,n):this.at(o,n)}intersectsSphere(t){return t.radius<0?!1:this.distanceSqToPoint(t.center)<=t.radius*t.radius}distanceToPlane(t){let n=t.normal.dot(this.direction);if(n===0)return t.distanceToPoint(this.origin)===0?0:null;let i=-(this.origin.dot(t.normal)+t.constant)/n;return i>=0?i:null}intersectPlane(t,n){let i=this.distanceToPlane(t);return i===null?null:this.at(i,n)}intersectsPlane(t){let n=t.distanceToPoint(this.origin);return n===0||t.normal.dot(this.direction)*n<0}intersectBox(t,n){let i,a,s,r,o,l,c=1/this.direction.x,f=1/this.direction.y,p=1/this.direction.z,u=this.origin;return c>=0?(i=(t.min.x-u.x)*c,a=(t.max.x-u.x)*c):(i=(t.max.x-u.x)*c,a=(t.min.x-u.x)*c),f>=0?(s=(t.min.y-u.y)*f,r=(t.max.y-u.y)*f):(s=(t.max.y-u.y)*f,r=(t.min.y-u.y)*f),i>r||s>a||((s>i||isNaN(i))&&(i=s),(r<a||isNaN(a))&&(a=r),p>=0?(o=(t.min.z-u.z)*p,l=(t.max.z-u.z)*p):(o=(t.max.z-u.z)*p,l=(t.min.z-u.z)*p),i>l||o>a)||((o>i||i!==i)&&(i=o),(l<a||a!==a)&&(a=l),a<0)?null:this.at(i>=0?i:a,n)}intersectsBox(t){return this.intersectBox(t,Ua)!==null}intersectTriangle(t,n,i,a,s){let r=this.origin,o=this.direction,l=o.x,c=o.y,f=o.z,p=t.x-r.x,u=t.y-r.y,d=t.z-r.z,_=n.x-r.x,b=n.y-r.y,m=n.z-r.z,h=i.x-r.x,g=i.y-r.y,S=i.z-r.z,y=Math.abs(l),T=Math.abs(c),A=Math.abs(f),E,x,w,R,D,P,F,U,B,X,Z,$;if(y>=T&&y>=A?(w=l,P=p,B=_,$=h,l>=0?(E=c,x=f,R=u,D=d,F=b,U=m,X=g,Z=S):(E=f,x=c,R=d,D=u,F=m,U=b,X=S,Z=g)):T>=A?(w=c,P=u,B=b,$=g,c>=0?(E=f,x=l,R=d,D=p,F=m,U=_,X=S,Z=h):(E=l,x=f,R=p,D=d,F=_,U=m,X=h,Z=S)):(w=f,P=d,B=m,$=S,f>=0?(E=l,x=c,R=p,D=u,F=_,U=b,X=h,Z=g):(E=c,x=l,R=u,D=p,F=b,U=_,X=g,Z=h)),w===0)return null;let z=E/w,K=x/w,j=1/w,vt=R-z*P,yt=D-K*P,$t=F-z*B,Et=U-K*B,Pt=X-z*$,k=Z-K*$,Y=Pt*Et-k*$t,lt=vt*k-yt*Pt,xt=$t*yt-Et*vt;if(a){if(Y<0||lt<0||xt<0)return null}else if((Y<0||lt<0||xt<0)&&(Y>0||lt>0||xt>0))return null;let ot=Y+lt+xt;if(ot===0)return null;let at=j*(Y*P+lt*B+xt*$);return(ot>0?at<0:at>0)?null:this.at(at/ot,s)}applyMatrix4(t){return this.origin.applyMatrix4(t),this.direction.transformDirection(t),this}equals(t){return t.origin.equals(this.origin)&&t.direction.equals(this.direction)}clone(){return new this.constructor().copy(this)}},pc=class extends hr{constructor(t){super(),this.isMeshBasicMaterial=!0,this.type="MeshBasicMaterial",this.color=new Zt(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new Ss,this.combine=ug,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.color.copy(t.color),this.map=t.map,this.lightMap=t.lightMap,this.lightMapIntensity=t.lightMapIntensity,this.aoMap=t.aoMap,this.aoMapIntensity=t.aoMapIntensity,this.specularMap=t.specularMap,this.alphaMap=t.alphaMap,this.envMap=t.envMap,this.envMapRotation.copy(t.envMapRotation),this.combine=t.combine,this.reflectivity=t.reflectivity,this.refractionRatio=t.refractionRatio,this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this.wireframeLinecap=t.wireframeLinecap,this.wireframeLinejoin=t.wireframeLinejoin,this.fog=t.fog,this}},j1=new Xe,lr=new uh,zf=new Fo,$1=new W,Ff=new W,Hf=new W,Vf=new W,K0=new W,Gf=new W,tM=new W,kf=new W,Gn=class extends xi{constructor(t=new oa,n=new pc){super(),this.isMesh=!0,this.type="Mesh",this.geometry=t,this.material=n,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.count=1,this.updateMorphTargets()}copy(t,n){return super.copy(t,n),t.morphTargetInfluences!==void 0&&(this.morphTargetInfluences=t.morphTargetInfluences.slice()),t.morphTargetDictionary!==void 0&&(this.morphTargetDictionary=Object.assign({},t.morphTargetDictionary)),this.material=Array.isArray(t.material)?t.material.slice():t.material,this.geometry=t.geometry,this}updateMorphTargets(){let n=this.geometry.morphAttributes,i=Object.keys(n);if(i.length>0){let a=n[i[0]];if(a!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let s=0,r=a.length;s<r;s++){let o=a[s].name||String(s);this.morphTargetInfluences.push(0),this.morphTargetDictionary[o]=s}}}}getVertexPosition(t,n){let i=this.geometry,a=i.attributes.position,s=i.morphAttributes.position,r=i.morphTargetsRelative;n.fromBufferAttribute(a,t);let o=this.morphTargetInfluences;if(s&&o){Gf.set(0,0,0);for(let l=0,c=s.length;l<c;l++){let f=o[l],p=s[l];f!==0&&(K0.fromBufferAttribute(p,t),r?Gf.addScaledVector(K0,f):Gf.addScaledVector(K0.sub(n),f))}n.add(Gf)}return n}intersectsFrustum(t){return t.intersectsObject(this)}raycast(t,n){let i=this.geometry,a=this.material,s=this.matrixWorld;a!==void 0&&(i.boundingSphere===null&&i.computeBoundingSphere(),zf.copy(i.boundingSphere),zf.applyMatrix4(s),lr.copy(t.ray).recast(t.near),!(zf.containsPoint(lr.origin)===!1&&(lr.intersectSphere(zf,$1)===null||lr.origin.distanceToSquared($1)>(t.far-t.near)**2))&&(j1.copy(s).invert(),lr.copy(t.ray).applyMatrix4(j1),!(i.boundingBox!==null&&lr.intersectsBox(i.boundingBox)===!1)&&this._computeIntersections(t,n,lr)))}_computeIntersections(t,n,i){let a,s=this.geometry,r=this.material,o=s.index,l=s.attributes.position,c=s.attributes.uv,f=s.attributes.uv1,p=s.attributes.normal,u=s.groups,d=s.drawRange;if(o!==null)if(Array.isArray(r))for(let _=0,b=u.length;_<b;_++){let m=u[_],h=r[m.materialIndex],g=Math.max(m.start,d.start),S=Math.min(o.count,Math.min(m.start+m.count,d.start+d.count));for(let y=g,T=S;y<T;y+=3){let A=o.getX(y),E=o.getX(y+1),x=o.getX(y+2);a=Xf(this,h,t,i,c,f,p,A,E,x),a&&(a.faceIndex=Math.floor(y/3),a.face.materialIndex=m.materialIndex,n.push(a))}}else{let _=Math.max(0,d.start),b=Math.min(o.count,d.start+d.count);for(let m=_,h=b;m<h;m+=3){let g=o.getX(m),S=o.getX(m+1),y=o.getX(m+2);a=Xf(this,r,t,i,c,f,p,g,S,y),a&&(a.faceIndex=Math.floor(m/3),n.push(a))}}else if(l!==void 0)if(Array.isArray(r))for(let _=0,b=u.length;_<b;_++){let m=u[_],h=r[m.materialIndex],g=Math.max(m.start,d.start),S=Math.min(l.count,Math.min(m.start+m.count,d.start+d.count));for(let y=g,T=S;y<T;y+=3){let A=y,E=y+1,x=y+2;a=Xf(this,h,t,i,c,f,p,A,E,x),a&&(a.faceIndex=Math.floor(y/3),a.face.materialIndex=m.materialIndex,n.push(a))}}else{let _=Math.max(0,d.start),b=Math.min(l.count,d.start+d.count);for(let m=_,h=b;m<h;m+=3){let g=m,S=m+1,y=m+2;a=Xf(this,r,t,i,c,f,p,g,S,y),a&&(a.faceIndex=Math.floor(m/3),n.push(a))}}}};function Xw(e,t,n,i,a,s,r,o){let l;if(t.side===Dn?l=i.intersectTriangle(r,s,a,!0,o):l=i.intersectTriangle(a,s,r,t.side===ws,o),l===null)return null;kf.copy(o),kf.applyMatrix4(e.matrixWorld);let c=n.ray.origin.distanceTo(kf);return c<n.near||c>n.far?null:{distance:c,point:kf.clone(),object:e}}function Xf(e,t,n,i,a,s,r,o,l,c){e.getVertexPosition(o,Ff),e.getVertexPosition(l,Hf),e.getVertexPosition(c,Vf);let f=Xw(e,t,n,i,Ff,Hf,Vf,tM);if(f){let p=new W;ys.getBarycoord(tM,Ff,Hf,Vf,p),a&&(f.uv=ys.getInterpolatedAttribute(a,o,l,c,p,new oe)),s&&(f.uv1=ys.getInterpolatedAttribute(s,o,l,c,p,new oe)),r&&(f.normal=ys.getInterpolatedAttribute(r,o,l,c,p,new W),f.normal.dot(i.direction)>0&&f.normal.multiplyScalar(-1));let u={a:o,b:l,c,normal:new W,materialIndex:0};ys.getNormal(Ff,Hf,Vf,u.normal),f.face=u,f.barycoord=p}return f}var fh=class extends Hn{constructor(t=null,n=1,i=1,a,s,r,o,l,c=on,f=on,p,u){super(null,r,o,l,c,f,a,s,p,u),this.isDataTexture=!0,this.image={data:t,width:n,height:i},this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}};var cr=new Fo,Ww=new oe(.5,.5),Wf=new W,mc=class{constructor(t=new Ni,n=new Ni,i=new Ni,a=new Ni,s=new Ni,r=new Ni){this.planes=[t,n,i,a,s,r]}set(t,n,i,a,s,r){let o=this.planes;return o[0].copy(t),o[1].copy(n),o[2].copy(i),o[3].copy(a),o[4].copy(s),o[5].copy(r),this}copy(t){let n=this.planes;for(let i=0;i<6;i++)n[i].copy(t.planes[i]);return this}setFromProjectionMatrix(t,n=Ui,i=!1){let a=this.planes,s=t.elements,r=s[0],o=s[1],l=s[2],c=s[3],f=s[4],p=s[5],u=s[6],d=s[7],_=s[8],b=s[9],m=s[10],h=s[11],g=s[12],S=s[13],y=s[14],T=s[15];if(a[0].setComponents(c-r,d-f,h-_,T-g).normalize(),a[1].setComponents(c+r,d+f,h+_,T+g).normalize(),a[2].setComponents(c+o,d+p,h+b,T+S).normalize(),a[3].setComponents(c-o,d-p,h-b,T-S).normalize(),i)a[4].setComponents(l,u,m,y).normalize(),a[5].setComponents(c-l,d-u,h-m,T-y).normalize();else if(a[4].setComponents(c-l,d-u,h-m,T-y).normalize(),n===Ui)a[5].setComponents(c+l,d+u,h+m,T+y).normalize();else if(n===oc)a[5].setComponents(l,u,m,y).normalize();else throw new Error("THREE.Frustum.setFromProjectionMatrix(): Invalid coordinate system: "+n);return this}intersectsObject(t){if(t.boundingSphere!==void 0)t.boundingSphere===null&&t.computeBoundingSphere(),cr.copy(t.boundingSphere).applyMatrix4(t.matrixWorld);else{let n=t.geometry;n.boundingSphere===null&&n.computeBoundingSphere(),cr.copy(n.boundingSphere).applyMatrix4(t.matrixWorld)}return this.intersectsSphere(cr)}intersectsSprite(t){cr.center.set(0,0,0);let n=Ww.distanceTo(t.center);return cr.radius=.7071067811865476+n,cr.applyMatrix4(t.matrixWorld),this.intersectsSphere(cr)}intersectsSphere(t){let n=this.planes,i=t.center,a=-t.radius;for(let s=0;s<6;s++)if(n[s].distanceToPoint(i)<a)return!1;return!0}intersectsBox(t){let n=this.planes;for(let i=0;i<6;i++){let a=n[i];if(Wf.x=a.normal.x>0?t.max.x:t.min.x,Wf.y=a.normal.y>0?t.max.y:t.min.y,Wf.z=a.normal.z>0?t.max.z:t.min.z,a.distanceToPoint(Wf)<0)return!1}return!0}containsPoint(t){let n=this.planes;for(let i=0;i<6;i++)if(n[i].distanceToPoint(t)<0)return!1;return!0}clone(){return new this.constructor().copy(this)}};var gc=class extends Hn{constructor(t=[],n=Rs,i,a,s,r,o,l,c,f){super(t,n,i,a,s,r,o,l,c,f),this.isCubeTexture=!0,this.flipY=!1}get images(){return this.image}set images(t){this.image=t}};var bs=class extends Hn{constructor(t,n,i=Oi,a,s,r,o=on,l=on,c,f=aa,p=1){if(f!==aa&&f!==Ns)throw new Error("THREE.DepthTexture: format must be either THREE.DepthFormat or THREE.DepthStencilFormat");let u={width:t,height:n,depth:p};super(u,a,s,r,o,l,f,i,c),this.isDepthTexture=!0,this.flipY=!1,this.generateMipmaps=!1,this.compareFunction=null}copy(t){return super.copy(t),this.source=new Bo(Object.assign({},t.image)),this.compareFunction=t.compareFunction,this}toJSON(t){let n=super.toJSON(t);return n.compareFunction=this.compareFunction,n}},hh=class extends bs{constructor(t,n=Oi,i=Rs,a,s,r=on,o=on,l,c=aa){let f={width:t,height:t,depth:1},p=[f,f,f,f,f,f];super(t,t,n,i,a,s,r,o,l,c),this.image=p,this.isCubeDepthTexture=!0,this.isCubeTexture=!0}get images(){return this.image}set images(t){this.image=t}},vc=class extends Hn{constructor(t=null){super(),this.sourceTexture=t,this.isExternalTexture=!0}copy(t){return super.copy(t),this.sourceTexture=t.sourceTexture,this}},Ho=class e extends oa{constructor(t=1,n=1,i=1,a=1,s=1,r=1){super(),this.type="BoxGeometry",this.parameters={width:t,height:n,depth:i,widthSegments:a,heightSegments:s,depthSegments:r};let o=this;a=Math.floor(a),s=Math.floor(s),r=Math.floor(r);let l=[],c=[],f=[],p=[],u=0,d=0;_("z","y","x",-1,-1,i,n,t,r,s,0),_("z","y","x",1,-1,i,n,-t,r,s,1),_("x","z","y",1,1,t,i,n,a,r,2),_("x","z","y",1,-1,t,i,-n,a,r,3),_("x","y","z",1,-1,t,n,i,a,s,4),_("x","y","z",-1,-1,t,n,-i,a,s,5),this.setIndex(l),this.setAttribute("position",new _i(c,3)),this.setAttribute("normal",new _i(f,3)),this.setAttribute("uv",new _i(p,2));function _(b,m,h,g,S,y,T,A,E,x,w){let R=y/E,D=T/x,P=y/2,F=T/2,U=A/2,B=E+1,X=x+1,Z=0,$=0,z=new W;for(let K=0;K<X;K++){let j=K*D-F;for(let vt=0;vt<B;vt++){let yt=vt*R-P;z[b]=yt*g,z[m]=j*S,z[h]=U,c.push(z.x,z.y,z.z),z[b]=0,z[m]=0,z[h]=A>0?1:-1,f.push(z.x,z.y,z.z),p.push(vt/E),p.push(1-K/x),Z+=1}}for(let K=0;K<x;K++)for(let j=0;j<E;j++){let vt=u+j+B*K,yt=u+j+B*(K+1),$t=u+(j+1)+B*(K+1),Et=u+(j+1)+B*K;l.push(vt,yt,Et),l.push(yt,$t,Et),$+=6}o.addGroup(d,$,w),d+=$,u+=Z}}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new e(t.width,t.height,t.depth,t.widthSegments,t.heightSegments,t.depthSegments)}};var dr=class e extends oa{constructor(t=1,n=1,i=1,a=1){super(),this.type="PlaneGeometry",this.parameters={width:t,height:n,widthSegments:i,heightSegments:a};let s=t/2,r=n/2,o=Math.floor(i),l=Math.floor(a),c=o+1,f=l+1,p=t/o,u=n/l,d=[],_=[],b=[],m=[];for(let h=0;h<f;h++){let g=h*u-r;for(let S=0;S<c;S++){let y=S*p-s;_.push(y,-g,0),b.push(0,0,1),m.push(S/o),m.push(1-h/l)}}for(let h=0;h<l;h++)for(let g=0;g<o;g++){let S=g+c*h,y=g+c*(h+1),T=g+1+c*(h+1),A=g+1+c*h;d.push(S,y,A),d.push(y,T,A)}this.setIndex(d),this.setAttribute("position",new _i(_,3)),this.setAttribute("normal",new _i(b,3)),this.setAttribute("uv",new _i(m,2))}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new e(t.width,t.height,t.widthSegments,t.heightSegments)}};function vr(e){let t={};for(let n in e){t[n]={};for(let i in e[n]){let a=e[n][i];if(eM(a))a.isRenderTargetTexture?(Ft("UniformsUtils: Textures of render targets cannot be cloned via cloneUniforms() or mergeUniforms()."),t[n][i]=null):t[n][i]=a.clone();else if(Array.isArray(a))if(eM(a[0])){let s=[];for(let r=0,o=a.length;r<o;r++)s[r]=a[r].clone();t[n][i]=s}else t[n][i]=a.slice();else t[n][i]=a}}return t}function Mn(e){let t={};for(let n=0;n<e.length;n++){let i=vr(e[n]);for(let a in i)t[a]=i[a]}return t}function eM(e){return e&&(e.isColor||e.isMatrix3||e.isMatrix4||e.isVector2||e.isVector3||e.isVector4||e.isTexture||e.isQuaternion)}function qw(e){let t=[];for(let n=0;n<e.length;n++)t.push(e[n].clone());return t}function Rg(e){let t=e.getRenderTarget();return t===null?e.outputColorSpace:t.isXRRenderTarget===!0?t.texture.colorSpace:se.workingColorSpace}var XM={clone:vr,merge:Mn},Yw=`void main() {
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,Zw=`void main() {
	gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );
}`,Rn=class extends hr{constructor(t){super(),this.isShaderMaterial=!0,this.type="ShaderMaterial",this.defines={},this.uniforms={},this.uniformsGroups=[],this.vertexShader=Yw,this.fragmentShader=Zw,this.linewidth=1,this.wireframe=!1,this.wireframeLinewidth=1,this.fog=!1,this.lights=!1,this.clipping=!1,this.forceSinglePass=!0,this.extensions={clipCullDistance:!1,multiDraw:!1},this.defaultAttributeValues={color:[1,1,1],uv:[0,0],uv1:[0,0]},this.index0AttributeName=void 0,this.uniformsNeedUpdate=!1,this.glslVersion=null,t!==void 0&&this.setValues(t)}copy(t){return super.copy(t),this.fragmentShader=t.fragmentShader,this.vertexShader=t.vertexShader,this.uniforms=vr(t.uniforms),this.uniformsGroups=qw(t.uniformsGroups),this.defines=Object.assign({},t.defines),this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this.fog=t.fog,this.lights=t.lights,this.clipping=t.clipping,this.extensions=Object.assign({},t.extensions),this.glslVersion=t.glslVersion,this.defaultAttributeValues=Object.assign({},t.defaultAttributeValues),this.index0AttributeName=t.index0AttributeName,this.uniformsNeedUpdate=t.uniformsNeedUpdate,this}toJSON(t){let n=super.toJSON(t);n.glslVersion=this.glslVersion,n.uniforms={};for(let a in this.uniforms){let r=this.uniforms[a].value;r&&r.isTexture?n.uniforms[a]={type:"t",value:r.toJSON(t).uuid}:r&&r.isColor?n.uniforms[a]={type:"c",value:r.getHex()}:r&&r.isVector2?n.uniforms[a]={type:"v2",value:r.toArray()}:r&&r.isVector3?n.uniforms[a]={type:"v3",value:r.toArray()}:r&&r.isVector4?n.uniforms[a]={type:"v4",value:r.toArray()}:r&&r.isMatrix3?n.uniforms[a]={type:"m3",value:r.toArray()}:r&&r.isMatrix4?n.uniforms[a]={type:"m4",value:r.toArray()}:n.uniforms[a]={value:r}}Object.keys(this.defines).length>0&&(n.defines=this.defines),n.vertexShader=this.vertexShader,n.fragmentShader=this.fragmentShader,n.lights=this.lights,n.clipping=this.clipping;let i={};for(let a in this.extensions)this.extensions[a]===!0&&(i[a]=!0);return Object.keys(i).length>0&&(n.extensions=i),n}fromJSON(t,n){if(super.fromJSON(t,n),t.uniforms!==void 0)for(let i in t.uniforms){let a=t.uniforms[i];switch(this.uniforms[i]={},a.type){case"t":this.uniforms[i].value=n[a.value]||null;break;case"c":this.uniforms[i].value=new Zt().setHex(a.value);break;case"v2":this.uniforms[i].value=new oe().fromArray(a.value);break;case"v3":this.uniforms[i].value=new W().fromArray(a.value);break;case"v4":this.uniforms[i].value=new Fe().fromArray(a.value);break;case"m3":this.uniforms[i].value=new Xt().fromArray(a.value);break;case"m4":this.uniforms[i].value=new Xe().fromArray(a.value);break;default:this.uniforms[i].value=a.value}}if(t.defines!==void 0&&(this.defines=t.defines),t.vertexShader!==void 0&&(this.vertexShader=t.vertexShader),t.fragmentShader!==void 0&&(this.fragmentShader=t.fragmentShader),t.glslVersion!==void 0&&(this.glslVersion=t.glslVersion),t.extensions!==void 0)for(let i in t.extensions)this.extensions[i]=t.extensions[i];return t.lights!==void 0&&(this.lights=t.lights),t.clipping!==void 0&&(this.clipping=t.clipping),this}},dh=class extends Rn{constructor(t){super(t),this.isRawShaderMaterial=!0,this.type="RawShaderMaterial"}};var ph=class extends hr{constructor(t){super(),this.isMeshDepthMaterial=!0,this.type="MeshDepthMaterial",this.depthPacking=RM,this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.wireframe=!1,this.wireframeLinewidth=1,this.setValues(t)}copy(t){return super.copy(t),this.depthPacking=t.depthPacking,this.map=t.map,this.alphaMap=t.alphaMap,this.displacementMap=t.displacementMap,this.displacementScale=t.displacementScale,this.displacementBias=t.displacementBias,this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this}},mh=class extends hr{constructor(t){super(),this.isMeshDistanceMaterial=!0,this.type="MeshDistanceMaterial",this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.setValues(t)}copy(t){return super.copy(t),this.map=t.map,this.alphaMap=t.alphaMap,this.displacementMap=t.displacementMap,this.displacementScale=t.displacementScale,this.displacementBias=t.displacementBias,this}};function No(e,t){return!e||e.constructor===t?e:typeof t.BYTES_PER_ELEMENT=="number"?new t(e):Array.prototype.slice.call(e)}function Q0(e){return e!==void 0&&e.inTangents!==void 0&&e.outTangents!==void 0}var Ts=class{constructor(t,n,i,a){this.parameterPositions=t,this._cachedIndex=0,this.resultBuffer=a!==void 0?a:new n.constructor(i),this.sampleValues=n,this.valueSize=i,this.settings=null,this.DefaultSettings_={}}evaluate(t){let n=this.parameterPositions,i=this._cachedIndex,a=n[i],s=n[i-1];t:{e:{let r;n:{i:if(!(t<a)){for(let o=i+2;;){if(a===void 0){if(t<s)break i;return i=n.length,this._cachedIndex=i,this.copySampleValue_(i-1)}if(i===o)break;if(s=a,a=n[++i],t<a)break e}r=n.length;break n}if(!(t>=s)){let o=n[1];t<o&&(i=2,s=o);for(let l=i-2;;){if(s===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(i===l)break;if(a=s,s=n[--i-1],t>=s)break e}r=i,i=0;break n}break t}for(;i<r;){let o=i+r>>>1;t<n[o]?r=o:i=o+1}if(a=n[i],s=n[i-1],s===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(a===void 0)return i=n.length,this._cachedIndex=i,this.copySampleValue_(i-1)}this._cachedIndex=i,this.intervalChanged_(i,s,a)}return this.interpolate_(i,s,t,a)}getSettings_(){return this.settings||this.DefaultSettings_}copySampleValue_(t){let n=this.resultBuffer,i=this.sampleValues,a=this.valueSize,s=t*a;for(let r=0;r!==a;++r)n[r]=i[s+r];return n}interpolate_(){throw new Error("THREE.Interpolant: Call to abstract method.")}intervalChanged_(){}},gh=class extends Ts{constructor(t,n,i,a){super(t,n,i,a),this._weightPrev=-0,this._offsetPrev=-0,this._weightNext=-0,this._offsetNext=-0,this.DefaultSettings_={endingStart:$0,endingEnd:$0}}intervalChanged_(t,n,i){let a=this.parameterPositions,s=t-2,r=t+1,o=a[s],l=a[r];if(o===void 0)switch(this.getSettings_().endingStart){case tg:s=t,o=2*n-i;break;case eg:s=a.length-2,o=n+a[s]-a[s+1];break;default:s=t,o=i}if(l===void 0)switch(this.getSettings_().endingEnd){case tg:r=t,l=2*i-n;break;case eg:r=1,l=i+a[1]-a[0];break;default:r=t-1,l=n}let c=(i-n)*.5,f=this.valueSize;this._weightPrev=c/(n-o),this._weightNext=c/(l-i),this._offsetPrev=s*f,this._offsetNext=r*f}interpolate_(t,n,i,a){let s=this.resultBuffer,r=this.sampleValues,o=this.valueSize,l=t*o,c=l-o,f=this._offsetPrev,p=this._offsetNext,u=this._weightPrev,d=this._weightNext,_=(i-n)/(a-n),b=_*_,m=b*_,h=-u*m+2*u*b-u*_,g=(1+u)*m+(-1.5-2*u)*b+(-.5+u)*_+1,S=(-1-d)*m+(1.5+d)*b+.5*_,y=d*m-d*b;for(let T=0;T!==o;++T)s[T]=h*r[f+T]+g*r[c+T]+S*r[l+T]+y*r[p+T];return s}},vh=class extends Ts{constructor(t,n,i,a){super(t,n,i,a)}interpolate_(t,n,i,a){let s=this.resultBuffer,r=this.sampleValues,o=this.valueSize,l=t*o,c=l-o,f=(i-n)/(a-n),p=1-f;for(let u=0;u!==o;++u)s[u]=r[c+u]*p+r[l+u]*f;return s}},_h=class extends Ts{constructor(t,n,i,a){super(t,n,i,a)}interpolate_(t){return this.copySampleValue_(t-1)}},xh=class extends Ts{interpolate_(t,n,i,a){let s=this.resultBuffer,r=this.sampleValues,o=this.valueSize,l=t*o,c=l-o,f=this.inTangents,p=this.outTangents;if(!f||!p){let _=(i-n)/(a-n),b=1-_;for(let m=0;m!==o;++m)s[m]=r[c+m]*b+r[l+m]*_;return s}let u=o*2,d=t-1;for(let _=0;_!==o;++_){let b=r[c+_],m=r[l+_],h=d*u+_*2,g=p[h],S=p[h+1],y=t*u+_*2,T=f[y],A=f[y+1],E=Kw(i,n,g,T,a);s[_]=WM(E,b,S,A,m)}return s}};function WM(e,t,n,i,a){let s=1-e;return s*s*s*t+3*s*s*e*n+3*s*e*e*i+e*e*e*a}function Jw(e,t,n,i,a){let s=1-e;return 3*s*s*(n-t)+6*s*e*(i-n)+3*e*e*(a-i)}function Kw(e,t,n,i,a){let s=(e-t)/(a-t);for(let r=0;r<8;r++){let o=WM(s,t,n,i,a)-e;if(Math.abs(o)<1e-10)break;let l=Jw(s,t,n,i,a);if(Math.abs(l)<1e-10)break;s=Math.max(0,Math.min(1,s-o/l))}return s}var ii=class{constructor(t,n,i,a){if(t===void 0)throw new Error("THREE.KeyframeTrack: track name is undefined");if(n===void 0||n.length===0)throw new Error("THREE.KeyframeTrack: no keyframes in track named "+t);this.name=t,this.times=No(n,this.TimeBufferType),this.values=No(i,this.ValueBufferType),this.setInterpolation(a||this.DefaultInterpolation)}static toJSON(t){let n=t.constructor,i;if(n.toJSON!==this.toJSON)i=n.toJSON(t);else{i={name:t.name,times:No(t.times,Array),values:No(t.values,Array)};let a=t.getInterpolation();a!==t.DefaultInterpolation&&(i.interpolation=a),Q0(t.settings)&&(i.settings={inTangents:No(t.settings.inTangents,Array),outTangents:No(t.settings.outTangents,Array)})}return i.type=t.ValueTypeName,i}InterpolantFactoryMethodDiscrete(t){return new _h(this.times,this.values,this.getValueSize(),t)}InterpolantFactoryMethodLinear(t){return new vh(this.times,this.values,this.getValueSize(),t)}InterpolantFactoryMethodSmooth(t){return new gh(this.times,this.values,this.getValueSize(),t)}InterpolantFactoryMethodBezier(t){let n=new xh(this.times,this.values,this.getValueSize(),t);return this.settings&&(n.inTangents=this.settings.inTangents,n.outTangents=this.settings.outTangents),n}setInterpolation(t){let n;switch(t){case ac:n=this.InterpolantFactoryMethodDiscrete;break;case sh:n=this.InterpolantFactoryMethodLinear;break;case Zf:n=this.InterpolantFactoryMethodSmooth;break;case j0:n=this.InterpolantFactoryMethodBezier;break}if(n===void 0){let i="unsupported interpolation for "+this.ValueTypeName+" keyframe track named "+this.name;if(this.createInterpolant===void 0)if(t!==this.DefaultInterpolation)this.setInterpolation(this.DefaultInterpolation);else throw new Error(i);return Ft("KeyframeTrack:",i),this}return this.createInterpolant=n,this}getInterpolation(){switch(this.createInterpolant){case this.InterpolantFactoryMethodDiscrete:return ac;case this.InterpolantFactoryMethodLinear:return sh;case this.InterpolantFactoryMethodSmooth:return Zf;case this.InterpolantFactoryMethodBezier:return j0}}getValueSize(){return this.values.length/this.times.length}shift(t){if(t!==0){let n=this.times;for(let i=0,a=n.length;i!==a;++i)n[i]+=t}return this}scale(t){if(t!==1){let n=this.times;for(let i=0,a=n.length;i!==a;++i)n[i]*=t;Q0(this.settings)&&(nM(this.settings.inTangents,t),nM(this.settings.outTangents,t))}return this}trim(t,n){let i=this.times,a=i.length,s=0,r=a-1;for(;s!==a&&i[s]<t;)++s;for(;r!==-1&&i[r]>n;)--r;if(++r,s!==0||r!==a){s>=r&&(r=Math.max(r,1),s=r-1);let o=this.getValueSize();this.times=i.slice(s,r),this.values=this.values.slice(s*o,r*o)}return this}validate(){let t=!0,n=this.getValueSize();n-Math.floor(n)!==0&&(Vt("KeyframeTrack: Invalid value size in track.",this),t=!1);let i=this.times,a=this.values,s=i.length;s===0&&(Vt("KeyframeTrack: Track is empty.",this),t=!1);let r=null;for(let o=0;o!==s;o++){let l=i[o];if(typeof l=="number"&&isNaN(l)){Vt("KeyframeTrack: Time is not a valid number.",this,o,l),t=!1;break}if(r!==null&&r>l){Vt("KeyframeTrack: Out of order keys.",this,o,l,r),t=!1;break}r=l}if(a!==void 0&&Aw(a))for(let o=0,l=a.length;o!==l;++o){let c=a[o];if(isNaN(c)){Vt("KeyframeTrack: Value is not a valid number.",this,o,c),t=!1;break}}return t}optimize(){let t=this.times.slice(),n=this.values.slice(),i=this.getValueSize(),a=this.getInterpolation()===Zf,s=t.length-1,r=1;for(let o=1;o<s;++o){let l=!1,c=t[o],f=t[o+1];if(c!==f&&(o!==1||c!==t[0]))if(a)l=!0;else{let p=o*i,u=p-i,d=p+i;for(let _=0;_!==i;++_){let b=n[p+_];if(b!==n[u+_]||b!==n[d+_]){l=!0;break}}}if(l){if(o!==r){t[r]=t[o];let p=o*i,u=r*i;for(let d=0;d!==i;++d)n[u+d]=n[p+d]}++r}}if(s>0){t[r]=t[s];for(let o=s*i,l=r*i,c=0;c!==i;++c)n[l+c]=n[o+c];++r}return r!==t.length?(this.times=t.slice(0,r),this.values=n.slice(0,r*i)):(this.times=t,this.values=n),this}clone(){let t=this.times.slice(),n=this.values.slice(),i=this.constructor,a=new i(this.name,t,n);return a.createInterpolant=this.createInterpolant,Q0(this.settings)&&(a.settings={inTangents:this.settings.inTangents.slice(),outTangents:this.settings.outTangents.slice()}),a}};function nM(e,t){for(let n=0,i=e.length;n!==i;n+=2)e[n]*=t}ii.prototype.ValueTypeName="";ii.prototype.TimeBufferType=Float32Array;ii.prototype.ValueBufferType=Float32Array;ii.prototype.DefaultInterpolation=sh;var Es=class extends ii{constructor(t,n,i){super(t,n,i)}};Es.prototype.ValueTypeName="bool";Es.prototype.ValueBufferType=Array;Es.prototype.DefaultInterpolation=ac;Es.prototype.InterpolantFactoryMethodLinear=void 0;Es.prototype.InterpolantFactoryMethodSmooth=void 0;var yh=class extends ii{constructor(t,n,i,a){super(t,n,i,a)}};yh.prototype.ValueTypeName="color";var Sh=class extends ii{constructor(t,n,i,a){super(t,n,i,a)}};Sh.prototype.ValueTypeName="number";var Mh=class extends Ts{constructor(t,n,i,a){super(t,n,i,a)}interpolate_(t,n,i,a){let s=this.resultBuffer,r=this.sampleValues,o=this.valueSize,l=(i-n)/(a-n),c=t*o;for(let f=c+o;c!==f;c+=4)ra.slerpFlat(s,0,r,c-o,r,c,l);return s}},_c=class extends ii{constructor(t,n,i,a){super(t,n,i,a)}InterpolantFactoryMethodLinear(t){return new Mh(this.times,this.values,this.getValueSize(),t)}};_c.prototype.ValueTypeName="quaternion";_c.prototype.InterpolantFactoryMethodSmooth=void 0;var As=class extends ii{constructor(t,n,i){super(t,n,i)}};As.prototype.ValueTypeName="string";As.prototype.ValueBufferType=Array;As.prototype.DefaultInterpolation=ac;As.prototype.InterpolantFactoryMethodLinear=void 0;As.prototype.InterpolantFactoryMethodSmooth=void 0;var bh=class extends ii{constructor(t,n,i,a){super(t,n,i,a)}};bh.prototype.ValueTypeName="vector";var Th=class{constructor(t,n,i){let a=this,s=!1,r=0,o=0,l,c=[];this.onStart=void 0,this.onLoad=t,this.onProgress=n,this.onError=i,this._abortController=null,this.itemStart=function(f){o++,s===!1&&a.onStart!==void 0&&a.onStart(f,r,o),s=!0},this.itemEnd=function(f){r++,a.onProgress!==void 0&&a.onProgress(f,r,o),r===o&&(s=!1,a.onLoad!==void 0&&a.onLoad())},this.itemError=function(f){a.onError!==void 0&&a.onError(f)},this.resolveURL=function(f){return f=f.normalize("NFC"),l?l(f):f},this.setURLModifier=function(f){return l=f,this},this.addHandler=function(f,p){return c.push(f,p),this},this.removeHandler=function(f){let p=c.indexOf(f);return p!==-1&&c.splice(p,2),this},this.getHandler=function(f){for(let p=0,u=c.length;p<u;p+=2){let d=c[p],_=c[p+1];if(d.global&&(d.lastIndex=0),d.test(f))return _}return null},this.abort=function(){return this.abortController.abort(),this._abortController=null,this}}get abortController(){return this._abortController||(this._abortController=new AbortController),this._abortController}},qM=new Th,Eh=class{constructor(t){this.manager=t!==void 0?t:qM,this.crossOrigin="anonymous",this.withCredentials=!1,this.path="",this.resourcePath="",this.requestHeader={},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}load(){}loadAsync(t,n){let i=this;return new Promise(function(a,s){i.load(t,a,n,s)})}parse(){}setCrossOrigin(t){return this.crossOrigin=t,this}setWithCredentials(t){return this.withCredentials=t,this}setPath(t){return this.path=t,this}setResourcePath(t){return this.resourcePath=t,this}setRequestHeader(t){return this.requestHeader=t,this}abort(){return this}};Eh.DEFAULT_MATERIAL_NAME="__DEFAULT";var qf=new W,Yf=new ra,na=new W,xc=class extends xi{constructor(){super(),this.isCamera=!0,this.type="Camera",this.matrixWorldInverse=new Xe,this.projectionMatrix=new Xe,this.projectionMatrixInverse=new Xe,this.coordinateSystem=Ui,this._reversedDepth=!1}get reversedDepth(){return this._reversedDepth}copy(t,n){return super.copy(t,n),this.matrixWorldInverse.copy(t.matrixWorldInverse),this.projectionMatrix.copy(t.projectionMatrix),this.projectionMatrixInverse.copy(t.projectionMatrixInverse),this.coordinateSystem=t.coordinateSystem,this}getWorldDirection(t){return super.getWorldDirection(t).negate()}updateMatrixWorld(t){super.updateMatrixWorld(t),this.matrixWorld.decompose(qf,Yf,na),na.x===1&&na.y===1&&na.z===1?this.matrixWorldInverse.copy(this.matrixWorld).invert():this.matrixWorldInverse.compose(qf,Yf,na.set(1,1,1)).invert()}updateWorldMatrix(t,n,i=!1){super.updateWorldMatrix(t,n,i),this.matrixWorld.decompose(qf,Yf,na),na.x===1&&na.y===1&&na.z===1?this.matrixWorldInverse.copy(this.matrixWorld).invert():this.matrixWorldInverse.compose(qf,Yf,na.set(1,1,1)).invert()}clone(){return new this.constructor().copy(this)}},xs=new W,iM=new oe,aM=new oe,Fn=class extends xc{constructor(t=50,n=1,i=.1,a=2e3){super(),this.isPerspectiveCamera=!0,this.type="PerspectiveCamera",this.fov=t,this.zoom=1,this.near=i,this.far=a,this.focus=10,this.aspect=n,this.view=null,this.filmGauge=35,this.filmOffset=0,this.updateProjectionMatrix()}copy(t,n){return super.copy(t,n),this.fov=t.fov,this.zoom=t.zoom,this.near=t.near,this.far=t.far,this.focus=t.focus,this.aspect=t.aspect,this.view=t.view===null?null:Object.assign({},t.view),this.filmGauge=t.filmGauge,this.filmOffset=t.filmOffset,this}setFocalLength(t){let n=.5*this.getFilmHeight()/t;this.fov=rh*2*Math.atan(n),this.updateProjectionMatrix()}getFocalLength(){let t=Math.tan(D0*.5*this.fov);return .5*this.getFilmHeight()/t}getEffectiveFOV(){return rh*2*Math.atan(Math.tan(D0*.5*this.fov)/this.zoom)}getFilmWidth(){return this.filmGauge*Math.min(this.aspect,1)}getFilmHeight(){return this.filmGauge/Math.max(this.aspect,1)}getViewBounds(t,n,i){xs.set(-1,-1,.5).applyMatrix4(this.projectionMatrixInverse),n.set(xs.x,xs.y).multiplyScalar(-t/xs.z),xs.set(1,1,.5).applyMatrix4(this.projectionMatrixInverse),i.set(xs.x,xs.y).multiplyScalar(-t/xs.z)}getViewSize(t,n){return this.getViewBounds(t,iM,aM),n.subVectors(aM,iM)}setViewOffset(t,n,i,a,s,r){this.aspect=t/n,this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=t,this.view.fullHeight=n,this.view.offsetX=i,this.view.offsetY=a,this.view.width=s,this.view.height=r,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let t=this.near,n=t*Math.tan(D0*.5*this.fov)/this.zoom,i=2*n,a=this.aspect*i,s=-.5*a,r=this.view;if(this.view!==null&&this.view.enabled){let l=r.fullWidth,c=r.fullHeight;s+=r.offsetX*a/l,n-=r.offsetY*i/c,a*=r.width/l,i*=r.height/c}let o=this.filmOffset;o!==0&&(s+=t*o/this.getFilmWidth()),this.projectionMatrix.makePerspective(s,s+a,n,n-i,t,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(t){let n=super.toJSON(t);return n.object.fov=this.fov,n.object.zoom=this.zoom,n.object.near=this.near,n.object.far=this.far,n.object.focus=this.focus,n.object.aspect=this.aspect,this.view!==null&&(n.object.view=Object.assign({},this.view)),n.object.filmGauge=this.filmGauge,n.object.filmOffset=this.filmOffset,n}};var pr=class extends xc{constructor(t=-1,n=1,i=1,a=-1,s=.1,r=2e3){super(),this.isOrthographicCamera=!0,this.type="OrthographicCamera",this.zoom=1,this.view=null,this.left=t,this.right=n,this.top=i,this.bottom=a,this.near=s,this.far=r,this.updateProjectionMatrix()}copy(t,n){return super.copy(t,n),this.left=t.left,this.right=t.right,this.top=t.top,this.bottom=t.bottom,this.near=t.near,this.far=t.far,this.zoom=t.zoom,this.view=t.view===null?null:Object.assign({},t.view),this}setViewOffset(t,n,i,a,s,r){this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=t,this.view.fullHeight=n,this.view.offsetX=i,this.view.offsetY=a,this.view.width=s,this.view.height=r,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let t=(this.right-this.left)/(2*this.zoom),n=(this.top-this.bottom)/(2*this.zoom),i=(this.right+this.left)/2,a=(this.top+this.bottom)/2,s=i-t,r=i+t,o=a+n,l=a-n;if(this.view!==null&&this.view.enabled){let c=(this.right-this.left)/this.view.fullWidth/this.zoom,f=(this.top-this.bottom)/this.view.fullHeight/this.zoom;s+=c*this.view.offsetX,r=s+c*this.view.width,o-=f*this.view.offsetY,l=o-f*this.view.height}this.projectionMatrix.makeOrthographic(s,r,o,l,this.near,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(t){let n=super.toJSON(t);return n.object.zoom=this.zoom,n.object.left=this.left,n.object.right=this.right,n.object.top=this.top,n.object.bottom=this.bottom,n.object.near=this.near,n.object.far=this.far,this.view!==null&&(n.object.view=Object.assign({},this.view)),n}};var Uo=-90,Lo=1,Ah=class extends xi{constructor(t,n,i){super(),this.type="CubeCamera",this.renderTarget=i,this.coordinateSystem=null,this.activeMipmapLevel=0;let a=new Fn(Uo,Lo,t,n);a.layers=this.layers,this.add(a);let s=new Fn(Uo,Lo,t,n);s.layers=this.layers,this.add(s);let r=new Fn(Uo,Lo,t,n);r.layers=this.layers,this.add(r);let o=new Fn(Uo,Lo,t,n);o.layers=this.layers,this.add(o);let l=new Fn(Uo,Lo,t,n);l.layers=this.layers,this.add(l);let c=new Fn(Uo,Lo,t,n);c.layers=this.layers,this.add(c)}updateCoordinateSystem(){let t=this.coordinateSystem,n=this.children.concat(),[i,a,s,r,o,l]=n;for(let c of n)this.remove(c);if(t===Ui)i.up.set(0,1,0),i.lookAt(1,0,0),a.up.set(0,1,0),a.lookAt(-1,0,0),s.up.set(0,0,-1),s.lookAt(0,1,0),r.up.set(0,0,1),r.lookAt(0,-1,0),o.up.set(0,1,0),o.lookAt(0,0,1),l.up.set(0,1,0),l.lookAt(0,0,-1);else if(t===oc)i.up.set(0,-1,0),i.lookAt(-1,0,0),a.up.set(0,-1,0),a.lookAt(1,0,0),s.up.set(0,0,1),s.lookAt(0,1,0),r.up.set(0,0,-1),r.lookAt(0,-1,0),o.up.set(0,-1,0),o.lookAt(0,0,1),l.up.set(0,-1,0),l.lookAt(0,0,-1);else throw new Error("THREE.CubeCamera.updateCoordinateSystem(): Invalid coordinate system: "+t);for(let c of n)this.add(c),c.updateMatrixWorld()}update(t,n){this.parent===null&&this.updateMatrixWorld();let{renderTarget:i,activeMipmapLevel:a}=this;this.coordinateSystem!==t.coordinateSystem&&(this.coordinateSystem=t.coordinateSystem,this.updateCoordinateSystem());let[s,r,o,l,c,f]=this.children,p=t.getRenderTarget(),u=t.getActiveCubeFace(),d=t.getActiveMipmapLevel(),_=t.xr.enabled;t.xr.enabled=!1;let b=i.texture.generateMipmaps;i.texture.generateMipmaps=!1;let m=!1;t.isWebGLRenderer===!0?m=t.state.buffers.depth.getReversed():m=t.reversedDepthBuffer,t.setRenderTarget(i,0,a),m&&t.autoClear===!1&&t.clearDepth(),t.render(n,s),t.setRenderTarget(i,1,a),m&&t.autoClear===!1&&t.clearDepth(),t.render(n,r),t.setRenderTarget(i,2,a),m&&t.autoClear===!1&&t.clearDepth(),t.render(n,o),t.setRenderTarget(i,3,a),m&&t.autoClear===!1&&t.clearDepth(),t.render(n,l),t.setRenderTarget(i,4,a),m&&t.autoClear===!1&&t.clearDepth(),t.render(n,c),i.texture.generateMipmaps=b,t.setRenderTarget(i,5,a),m&&t.autoClear===!1&&t.clearDepth(),t.render(n,f),t.setRenderTarget(p,u,d),t.xr.enabled=_,i.texture.needsPMREMUpdate=!0}},wh=class extends Fn{constructor(t=[]){super(),this.isArrayCamera=!0,this.isMultiViewCamera=!1,this.cameras=t}};var Dg="\\[\\]\\.:\\/",Qw=new RegExp("["+Dg+"]","g"),Ng="[^"+Dg+"]",jw="[^"+Dg.replace("\\.","")+"]",$w=/((?:WC+[\/:])*)/.source.replace("WC",Ng),t2=/(WCOD+)?/.source.replace("WCOD",jw),e2=/(?:\.(WC+)(?:\[(.+)\])?)?/.source.replace("WC",Ng),n2=/\.(WC+)(?:\[(.+)\])?/.source.replace("WC",Ng),i2=new RegExp("^"+$w+t2+e2+n2+"$"),a2=["material","materials","bones","map"],ng=class{constructor(t,n,i){let a=i||Oe.parseTrackName(n);this._targetGroup=t,this._bindings=t.subscribe_(n,a)}getValue(t,n){this.bind();let i=this._targetGroup.nCachedObjects_,a=this._bindings[i];a!==void 0&&a.getValue(t,n)}setValue(t,n){let i=this._bindings;for(let a=this._targetGroup.nCachedObjects_,s=i.length;a!==s;++a)i[a].setValue(t,n)}bind(){let t=this._bindings;for(let n=this._targetGroup.nCachedObjects_,i=t.length;n!==i;++n)t[n].bind()}unbind(){let t=this._bindings;for(let n=this._targetGroup.nCachedObjects_,i=t.length;n!==i;++n)t[n].unbind()}},Oe=class e{constructor(t,n,i){this.path=n,this.parsedPath=i||e.parseTrackName(n),this.node=e.findNode(t,this.parsedPath.nodeName),this.rootNode=t,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}static create(t,n,i){return t&&t.isAnimationObjectGroup?new e.Composite(t,n,i):new e(t,n,i)}static sanitizeNodeName(t){return t.replace(/\s/g,"_").replace(Qw,"")}static parseTrackName(t){let n=i2.exec(t);if(n===null)throw new Error("THREE.PropertyBinding: Cannot parse trackName: "+t);let i={nodeName:n[2],objectName:n[3],objectIndex:n[4],propertyName:n[5],propertyIndex:n[6]},a=i.nodeName&&i.nodeName.lastIndexOf(".");if(a!==void 0&&a!==-1){let s=i.nodeName.substring(a+1);a2.indexOf(s)!==-1&&(i.nodeName=i.nodeName.substring(0,a),i.objectName=s)}if(i.propertyName===null||i.propertyName.length===0)throw new Error("THREE.PropertyBinding: can not parse propertyName from trackName: "+t);return i}static findNode(t,n){if(n===void 0||n===""||n==="."||n===-1||n===t.name||n===t.uuid)return t;if(t.skeleton){let i=t.skeleton.getBoneByName(n);if(i!==void 0)return i}if(t.children){let i=function(s){for(let r=0;r<s.length;r++){let o=s[r];if(o.name===n||o.uuid===n)return o;let l=i(o.children);if(l)return l}return null},a=i(t.children);if(a)return a}return null}_getValue_unavailable(){}_setValue_unavailable(){}_getValue_direct(t,n){t[n]=this.targetObject[this.propertyName]}_getValue_array(t,n){let i=this.resolvedProperty;for(let a=0,s=i.length;a!==s;++a)t[n++]=i[a]}_getValue_arrayElement(t,n){t[n]=this.resolvedProperty[this.propertyIndex]}_getValue_toArray(t,n){this.resolvedProperty.toArray(t,n)}_setValue_direct(t,n){this.targetObject[this.propertyName]=t[n]}_setValue_direct_setNeedsUpdate(t,n){this.targetObject[this.propertyName]=t[n],this.targetObject.needsUpdate=!0}_setValue_direct_setMatrixWorldNeedsUpdate(t,n){this.targetObject[this.propertyName]=t[n],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_array(t,n){let i=this.resolvedProperty;for(let a=0,s=i.length;a!==s;++a)i[a]=t[n++]}_setValue_array_setNeedsUpdate(t,n){let i=this.resolvedProperty;for(let a=0,s=i.length;a!==s;++a)i[a]=t[n++];this.targetObject.needsUpdate=!0}_setValue_array_setMatrixWorldNeedsUpdate(t,n){let i=this.resolvedProperty;for(let a=0,s=i.length;a!==s;++a)i[a]=t[n++];this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_arrayElement(t,n){this.resolvedProperty[this.propertyIndex]=t[n]}_setValue_arrayElement_setNeedsUpdate(t,n){this.resolvedProperty[this.propertyIndex]=t[n],this.targetObject.needsUpdate=!0}_setValue_arrayElement_setMatrixWorldNeedsUpdate(t,n){this.resolvedProperty[this.propertyIndex]=t[n],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_fromArray(t,n){this.resolvedProperty.fromArray(t,n)}_setValue_fromArray_setNeedsUpdate(t,n){this.resolvedProperty.fromArray(t,n),this.targetObject.needsUpdate=!0}_setValue_fromArray_setMatrixWorldNeedsUpdate(t,n){this.resolvedProperty.fromArray(t,n),this.targetObject.matrixWorldNeedsUpdate=!0}_getValue_unbound(t,n){this.bind(),this.getValue(t,n)}_setValue_unbound(t,n){this.bind(),this.setValue(t,n)}bind(){let t=this.node,n=this.parsedPath,i=n.objectName,a=n.propertyName,s=n.propertyIndex;if(t||(t=e.findNode(this.rootNode,n.nodeName),this.node=t),this.getValue=this._getValue_unavailable,this.setValue=this._setValue_unavailable,!t){Ft("PropertyBinding: No target node found for track: "+this.path+".");return}if(i){let c=n.objectIndex;switch(i){case"materials":if(!t.material){Vt("PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!t.material.materials){Vt("PropertyBinding: Can not bind to material.materials as node.material does not have a materials array.",this);return}t=t.material.materials;break;case"bones":if(!t.skeleton){Vt("PropertyBinding: Can not bind to bones as node does not have a skeleton.",this);return}t=t.skeleton.bones;for(let f=0;f<t.length;f++)if(t[f].name===c){c=f;break}break;case"map":if("map"in t){t=t.map;break}if(!t.material){Vt("PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!t.material.map){Vt("PropertyBinding: Can not bind to material.map as node.material does not have a map.",this);return}t=t.material.map;break;default:if(t[i]===void 0){Vt("PropertyBinding: Can not bind to objectName of node undefined.",this);return}t=t[i]}if(c!==void 0){if(t[c]===void 0){Vt("PropertyBinding: Trying to bind to objectIndex of objectName, but is undefined.",this,t);return}t=t[c]}}let r=t[a];if(r===void 0){let c=n.nodeName;Vt("PropertyBinding: Trying to update property for track: "+c+"."+a+" but it wasn't found.",t);return}let o=this.Versioning.None;this.targetObject=t,t.isMaterial===!0?o=this.Versioning.NeedsUpdate:t.isObject3D===!0&&(o=this.Versioning.MatrixWorldNeedsUpdate);let l=this.BindingType.Direct;if(s!==void 0){if(a==="morphTargetInfluences"){if(!t.geometry){Vt("PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.",this);return}if(!t.geometry.morphAttributes){Vt("PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.morphAttributes.",this);return}t.morphTargetDictionary[s]!==void 0&&(s=t.morphTargetDictionary[s])}l=this.BindingType.ArrayElement,this.resolvedProperty=r,this.propertyIndex=s}else r.fromArray!==void 0&&r.toArray!==void 0?(l=this.BindingType.HasFromToArray,this.resolvedProperty=r):Array.isArray(r)?(l=this.BindingType.EntireArray,this.resolvedProperty=r):this.propertyName=a;this.getValue=this.GetterByBindingType[l],this.setValue=this.SetterByBindingTypeAndVersioning[l][o]}unbind(){this.node=null,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}};Oe.Composite=ng;Oe.prototype.BindingType={Direct:0,EntireArray:1,ArrayElement:2,HasFromToArray:3};Oe.prototype.Versioning={None:0,NeedsUpdate:1,MatrixWorldNeedsUpdate:2};Oe.prototype.GetterByBindingType=[Oe.prototype._getValue_direct,Oe.prototype._getValue_array,Oe.prototype._getValue_arrayElement,Oe.prototype._getValue_toArray];Oe.prototype.SetterByBindingTypeAndVersioning=[[Oe.prototype._setValue_direct,Oe.prototype._setValue_direct_setNeedsUpdate,Oe.prototype._setValue_direct_setMatrixWorldNeedsUpdate],[Oe.prototype._setValue_array,Oe.prototype._setValue_array_setNeedsUpdate,Oe.prototype._setValue_array_setMatrixWorldNeedsUpdate],[Oe.prototype._setValue_arrayElement,Oe.prototype._setValue_arrayElement_setNeedsUpdate,Oe.prototype._setValue_arrayElement_setMatrixWorldNeedsUpdate],[Oe.prototype._setValue_fromArray,Oe.prototype._setValue_fromArray_setNeedsUpdate,Oe.prototype._setValue_fromArray_setMatrixWorldNeedsUpdate]];var nU=new Float32Array(1);var ig=class e{static{e.prototype.isMatrix2=!0}constructor(t,n,i,a){this.elements=[1,0,0,1],t!==void 0&&this.set(t,n,i,a)}identity(){return this.set(1,0,0,1),this}fromArray(t,n=0){for(let i=0;i<4;i++)this.elements[i]=t[i+n];return this}set(t,n,i,a){let s=this.elements;return s[0]=t,s[2]=n,s[1]=i,s[3]=a,this}};function Ug(e,t,n,i){let a=s2(i);switch(n){case bg:return e*t;case Eg:return e*t/a.components*a.byteLength;case Oh:return e*t/a.components*a.byteLength;case Us:return e*t*2/a.components*a.byteLength;case Ih:return e*t*2/a.components*a.byteLength;case Tg:return e*t*3/a.components*a.byteLength;case yi:return e*t*4/a.components*a.byteLength;case Ph:return e*t*4/a.components*a.byteLength;case bc:case Tc:return Math.floor((e+3)/4)*Math.floor((t+3)/4)*8;case Ec:case Ac:return Math.floor((e+3)/4)*Math.floor((t+3)/4)*16;case zh:case Hh:return Math.max(e,16)*Math.max(t,8)/4;case Bh:case Fh:return Math.max(e,8)*Math.max(t,8)/2;case Vh:case Gh:case Xh:case Wh:return Math.floor((e+3)/4)*Math.floor((t+3)/4)*8;case kh:case wc:case qh:return Math.floor((e+3)/4)*Math.floor((t+3)/4)*16;case Yh:return Math.floor((e+3)/4)*Math.floor((t+3)/4)*16;case Zh:return Math.floor((e+4)/5)*Math.floor((t+3)/4)*16;case Jh:return Math.floor((e+4)/5)*Math.floor((t+4)/5)*16;case Kh:return Math.floor((e+5)/6)*Math.floor((t+4)/5)*16;case Qh:return Math.floor((e+5)/6)*Math.floor((t+5)/6)*16;case jh:return Math.floor((e+7)/8)*Math.floor((t+4)/5)*16;case $h:return Math.floor((e+7)/8)*Math.floor((t+5)/6)*16;case td:return Math.floor((e+7)/8)*Math.floor((t+7)/8)*16;case ed:return Math.floor((e+9)/10)*Math.floor((t+4)/5)*16;case nd:return Math.floor((e+9)/10)*Math.floor((t+5)/6)*16;case id:return Math.floor((e+9)/10)*Math.floor((t+7)/8)*16;case ad:return Math.floor((e+9)/10)*Math.floor((t+9)/10)*16;case sd:return Math.floor((e+11)/12)*Math.floor((t+9)/10)*16;case rd:return Math.floor((e+11)/12)*Math.floor((t+11)/12)*16;case od:case ld:case cd:return Math.ceil(e/4)*Math.ceil(t/4)*16;case ud:case fd:return Math.ceil(e/4)*Math.ceil(t/4)*8;case Cc:case hd:return Math.ceil(e/4)*Math.ceil(t/4)*16}throw new Error(`Unable to determine texture byte length for ${n} format.`)}function s2(e){switch(e){case ai:case xg:return{byteLength:1,components:1};case Go:case yg:case Pi:return{byteLength:2,components:1};case Uh:case Lh:return{byteLength:2,components:4};case Oi:case Nh:case Ii:return{byteLength:4,components:1};case Sg:case Mg:return{byteLength:4,components:3}}throw new Error(`THREE.TextureUtils: Unknown texture type ${e}.`)}typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("register",{detail:{revision:"186"}}));typeof window<"u"&&(window.__THREE__?Ft("WARNING: Multiple instances of Three.js being imported."):window.__THREE__="186");function pb(){let e=null,t=!1,n=null,i=null;function a(s,r){i=e.requestAnimationFrame(a),n(s,r)}return{start:function(){t!==!0&&n!==null&&e!==null&&(i=e.requestAnimationFrame(a),t=!0)},stop:function(){e!==null&&e.cancelAnimationFrame(i),t=!1},setAnimationLoop:function(s){n=s},setContext:function(s){e=s}}}function o2(e){let t=new WeakMap;function n(o,l){let c=o.array,f=o.usage,p=c.byteLength,u=e.createBuffer();e.bindBuffer(l,u),e.bufferData(l,c,f),o.onUploadCallback();let d;if(c instanceof Float32Array)d=e.FLOAT;else if(typeof Float16Array<"u"&&c instanceof Float16Array)d=e.HALF_FLOAT;else if(c instanceof Uint16Array)o.isFloat16BufferAttribute?d=e.HALF_FLOAT:d=e.UNSIGNED_SHORT;else if(c instanceof Int16Array)d=e.SHORT;else if(c instanceof Uint32Array)d=e.UNSIGNED_INT;else if(c instanceof Int32Array)d=e.INT;else if(c instanceof Int8Array)d=e.BYTE;else if(c instanceof Uint8Array)d=e.UNSIGNED_BYTE;else if(c instanceof Uint8ClampedArray)d=e.UNSIGNED_BYTE;else throw new Error("THREE.WebGLAttributes: Unsupported buffer data format: "+c);return{buffer:u,type:d,bytesPerElement:c.BYTES_PER_ELEMENT,version:o.version,size:p}}function i(o,l,c){let f=l.array,p=l.updateRanges;if(e.bindBuffer(c,o),p.length===0)e.bufferSubData(c,0,f);else{p.sort((d,_)=>d.start-_.start);let u=0;for(let d=1;d<p.length;d++){let _=p[u],b=p[d];b.start<=_.start+_.count+1?_.count=Math.max(_.count,b.start+b.count-_.start):(++u,p[u]=b)}p.length=u+1;for(let d=0,_=p.length;d<_;d++){let b=p[d];e.bufferSubData(c,b.start*f.BYTES_PER_ELEMENT,f,b.start,b.count)}l.clearUpdateRanges()}l.onUploadCallback()}function a(o){return o.isInterleavedBufferAttribute&&(o=o.data),t.get(o)}function s(o){o.isInterleavedBufferAttribute&&(o=o.data);let l=t.get(o);l&&(e.deleteBuffer(l.buffer),t.delete(o))}function r(o,l){if(o.isInterleavedBufferAttribute&&(o=o.data),o.isGLBufferAttribute){let f=t.get(o);(!f||f.version<o.version)&&t.set(o,{buffer:o.buffer,type:o.type,bytesPerElement:o.elementSize,version:o.version});return}let c=t.get(o);if(c===void 0)t.set(o,n(o,l));else if(c.version<o.version){if(c.size!==o.array.byteLength)throw new Error("THREE.WebGLAttributes: The size of the buffer attribute's array buffer does not match the original size. Resizing buffer attributes is not supported.");i(c.buffer,o,l),c.version=o.version}}return{get:a,remove:s,update:r}}var l2=`#ifdef USE_ALPHAHASH
	if ( diffuseColor.a < getAlphaHashThreshold( vPosition ) ) discard;
#endif`,c2=`#ifdef USE_ALPHAHASH
	const float ALPHA_HASH_SCALE = 0.05;
	float hash2D( vec2 value ) {
		return fract( 1.0e4 * sin( 17.0 * value.x + 0.1 * value.y ) * ( 0.1 + abs( sin( 13.0 * value.y + value.x ) ) ) );
	}
	float hash3D( vec3 value ) {
		return hash2D( vec2( hash2D( value.xy ), value.z ) );
	}
	float getAlphaHashThreshold( vec3 position ) {
		float maxDeriv = max(
			length( dFdx( position.xyz ) ),
			length( dFdy( position.xyz ) )
		);
		float pixScale = 1.0 / ( ALPHA_HASH_SCALE * maxDeriv );
		vec2 pixScales = vec2(
			exp2( floor( log2( pixScale ) ) ),
			exp2( ceil( log2( pixScale ) ) )
		);
		vec2 alpha = vec2(
			hash3D( floor( pixScales.x * position.xyz ) ),
			hash3D( floor( pixScales.y * position.xyz ) )
		);
		float lerpFactor = fract( log2( pixScale ) );
		float x = ( 1.0 - lerpFactor ) * alpha.x + lerpFactor * alpha.y;
		float a = min( lerpFactor, 1.0 - lerpFactor );
		vec3 cases = vec3(
			x * x / ( 2.0 * a * ( 1.0 - a ) ),
			( x - 0.5 * a ) / ( 1.0 - a ),
			1.0 - ( ( 1.0 - x ) * ( 1.0 - x ) / ( 2.0 * a * ( 1.0 - a ) ) )
		);
		float threshold = ( x < ( 1.0 - a ) )
			? ( ( x < a ) ? cases.x : cases.y )
			: cases.z;
		return clamp( threshold , 1.0e-6, 1.0 );
	}
#endif`,u2=`#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g;
#endif`,f2=`#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,h2=`#ifdef USE_ALPHATEST
	#ifdef ALPHA_TO_COVERAGE
	diffuseColor.a = smoothstep( alphaTest, alphaTest + fwidth( diffuseColor.a ), diffuseColor.a );
	if ( diffuseColor.a == 0.0 ) discard;
	#else
	if ( diffuseColor.a < alphaTest ) discard;
	#endif
#endif`,d2=`#ifdef USE_ALPHATEST
	uniform float alphaTest;
#endif`,p2=`#ifdef USE_AOMAP
	float ambientOcclusion = ( texture2D( aoMap, vAoMapUv ).r - 1.0 ) * aoMapIntensity + 1.0;
	reflectedLight.indirectDiffuse *= ambientOcclusion;
	#if defined( USE_CLEARCOAT ) 
		clearcoatSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_SHEEN ) 
		sheenSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD )
		float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
		reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
	#endif
#endif`,m2=`#ifdef USE_AOMAP
	uniform sampler2D aoMap;
	uniform float aoMapIntensity;
#endif`,g2=`#ifdef USE_BATCHING
	#if ! defined( GL_ANGLE_multi_draw )
	#define gl_DrawID _gl_DrawID
	uniform int _gl_DrawID;
	#endif
	uniform highp sampler2D batchingTexture;
	uniform highp usampler2D batchingIdTexture;
	mat4 getBatchingMatrix( const in float i ) {
		int size = textureSize( batchingTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( batchingTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( batchingTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( batchingTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( batchingTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
	float getIndirectIndex( const in int i ) {
		int size = textureSize( batchingIdTexture, 0 ).x;
		int x = i % size;
		int y = i / size;
		return float( texelFetch( batchingIdTexture, ivec2( x, y ), 0 ).r );
	}
#endif
#ifdef USE_BATCHING_COLOR
	uniform sampler2D batchingColorTexture;
	vec4 getBatchingColor( const in float i ) {
		int size = textureSize( batchingColorTexture, 0 ).x;
		int j = int( i );
		int x = j % size;
		int y = j / size;
		return texelFetch( batchingColorTexture, ivec2( x, y ), 0 );
	}
#endif`,v2=`#ifdef USE_BATCHING
	mat4 batchingMatrix = getBatchingMatrix( getIndirectIndex( gl_DrawID ) );
#endif`,_2=`vec3 transformed = vec3( position );
#ifdef USE_ALPHAHASH
	vPosition = vec3( position );
#endif`,x2=`vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( tangent.xyz );
#endif`,y2=`float G_BlinnPhong_Implicit( ) {
	return 0.25;
}
float D_BlinnPhong( const in float shininess, const in float dotNH ) {
	return RECIPROCAL_PI * ( shininess * 0.5 + 1.0 ) * pow( dotNH, shininess );
}
vec3 BRDF_BlinnPhong( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in vec3 specularColor, const in float shininess ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( specularColor, 1.0, dotVH );
	float G = G_BlinnPhong_Implicit( );
	float D = D_BlinnPhong( shininess, dotNH );
	return F * ( G * D );
} // validated`,S2=`#ifdef USE_IRIDESCENCE
	const mat3 XYZ_TO_REC709 = mat3(
		 3.2404542, -0.9692660,  0.0556434,
		-1.5371385,  1.8760108, -0.2040259,
		-0.4985314,  0.0415560,  1.0572252
	);
	vec3 Fresnel0ToIor( vec3 fresnel0 ) {
		vec3 sqrtF0 = sqrt( fresnel0 );
		return ( vec3( 1.0 ) + sqrtF0 ) / ( vec3( 1.0 ) - sqrtF0 );
	}
	vec3 IorToFresnel0( vec3 transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - vec3( incidentIor ) ) / ( transmittedIor + vec3( incidentIor ) ) );
	}
	float IorToFresnel0( float transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - incidentIor ) / ( transmittedIor + incidentIor ));
	}
	vec3 evalSensitivity( float OPD, vec3 shift ) {
		float phase = 2.0 * PI * OPD * 1.0e-9;
		vec3 val = vec3( 5.4856e-13, 4.4201e-13, 5.2481e-13 );
		vec3 pos = vec3( 1.6810e+06, 1.7953e+06, 2.2084e+06 );
		vec3 var = vec3( 4.3278e+09, 9.3046e+09, 6.6121e+09 );
		vec3 xyz = val * sqrt( 2.0 * PI * var ) * cos( pos * phase + shift ) * exp( - pow2( phase ) * var );
		xyz.x += 9.7470e-14 * sqrt( 2.0 * PI * 4.5282e+09 ) * cos( 2.2399e+06 * phase + shift[ 0 ] ) * exp( - 4.5282e+09 * pow2( phase ) );
		xyz /= 1.0685e-7;
		vec3 rgb = XYZ_TO_REC709 * xyz;
		return rgb;
	}
	vec3 evalIridescence( float outsideIOR, float eta2, float cosTheta1, float thinFilmThickness, vec3 baseF0 ) {
		vec3 I;
		float iridescenceIOR = mix( outsideIOR, eta2, smoothstep( 0.0, 0.03, thinFilmThickness ) );
		float sinTheta2Sq = pow2( outsideIOR / iridescenceIOR ) * ( 1.0 - pow2( cosTheta1 ) );
		float cosTheta2Sq = 1.0 - sinTheta2Sq;
		if ( cosTheta2Sq < 0.0 ) {
			return vec3( 1.0 );
		}
		float cosTheta2 = sqrt( cosTheta2Sq );
		float R0 = IorToFresnel0( iridescenceIOR, outsideIOR );
		float R12 = F_Schlick( R0, 1.0, cosTheta1 );
		float T121 = 1.0 - R12;
		float phi12 = 0.0;
		if ( iridescenceIOR < outsideIOR ) phi12 = PI;
		float phi21 = PI - phi12;
		vec3 baseIOR = Fresnel0ToIor( clamp( baseF0, 0.0, 0.9999 ) );		vec3 R1 = IorToFresnel0( baseIOR, iridescenceIOR );
		vec3 R23 = F_Schlick( R1, 1.0, cosTheta2 );
		vec3 phi23 = vec3( 0.0 );
		if ( baseIOR[ 0 ] < iridescenceIOR ) phi23[ 0 ] = PI;
		if ( baseIOR[ 1 ] < iridescenceIOR ) phi23[ 1 ] = PI;
		if ( baseIOR[ 2 ] < iridescenceIOR ) phi23[ 2 ] = PI;
		float OPD = 2.0 * iridescenceIOR * thinFilmThickness * cosTheta2;
		vec3 phi = vec3( phi21 ) + phi23;
		vec3 R123 = clamp( R12 * R23, 1e-5, 0.9999 );
		vec3 r123 = sqrt( R123 );
		vec3 Rs = pow2( T121 ) * R23 / ( vec3( 1.0 ) - R123 );
		vec3 C0 = R12 + Rs;
		I = C0;
		vec3 Cm = Rs - T121;
		for ( int m = 1; m <= 2; ++ m ) {
			Cm *= r123;
			vec3 Sm = 2.0 * evalSensitivity( float( m ) * OPD, float( m ) * phi );
			I += Cm * Sm;
		}
		return max( I, vec3( 0.0 ) );
	}
#endif`,M2=`#ifdef USE_BUMPMAP
	uniform sampler2D bumpMap;
	uniform float bumpScale;
	vec2 dHdxy_fwd() {
		vec2 dSTdx = dFdx( vBumpMapUv );
		vec2 dSTdy = dFdy( vBumpMapUv );
		float Hll = bumpScale * texture2D( bumpMap, vBumpMapUv ).x;
		float dBx = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdx ).x - Hll;
		float dBy = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdy ).x - Hll;
		return vec2( dBx, dBy );
	}
	vec3 perturbNormalArb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection ) {
		vec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) );
		vec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) );
		vec3 vN = surf_norm;
		vec3 R1 = cross( vSigmaY, vN );
		vec3 R2 = cross( vN, vSigmaX );
		float fDet = dot( vSigmaX, R1 ) * faceDirection;
		vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
		return normalize( abs( fDet ) * surf_norm - vGrad );
	}
#endif`,b2=`#if NUM_CLIPPING_PLANES > 0
	vec4 plane;
	#ifdef ALPHA_TO_COVERAGE
		float distanceToPlane, distanceGradient;
		float clipOpacity = 1.0;
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
			distanceGradient = fwidth( distanceToPlane ) / 2.0;
			clipOpacity *= smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			if ( clipOpacity == 0.0 ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			float unionClipOpacity = 1.0;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
				distanceGradient = fwidth( distanceToPlane ) / 2.0;
				unionClipOpacity *= 1.0 - smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			}
			#pragma unroll_loop_end
			clipOpacity *= 1.0 - unionClipOpacity;
		#endif
		diffuseColor.a *= clipOpacity;
		if ( diffuseColor.a == 0.0 ) discard;
	#else
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			if ( dot( vClipPosition, plane.xyz ) > plane.w ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			bool clipped = true;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				clipped = ( dot( vClipPosition, plane.xyz ) > plane.w ) && clipped;
			}
			#pragma unroll_loop_end
			if ( clipped ) discard;
		#endif
	#endif
#endif`,T2=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
	uniform vec4 clippingPlanes[ NUM_CLIPPING_PLANES ];
#endif`,E2=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
#endif`,A2=`#if NUM_CLIPPING_PLANES > 0
	vClipPosition = - mvPosition.xyz;
#endif`,w2=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	diffuseColor *= vColor;
#endif`,C2=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#endif`,R2=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	varying vec4 vColor;
#endif`,D2=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	vColor = vec4( 1.0 );
#endif
#ifdef USE_COLOR_ALPHA
	vColor *= color;
#elif defined( USE_COLOR )
	vColor.rgb *= color;
#endif
#ifdef USE_INSTANCING_COLOR
	vColor.rgb *= instanceColor.rgb;
#endif
#ifdef USE_BATCHING_COLOR
	vColor *= getBatchingColor( getIndirectIndex( gl_DrawID ) );
#endif`,N2=`#define PI 3.141592653589793
#define PI2 6.283185307179586
#define PI_HALF 1.5707963267948966
#define RECIPROCAL_PI 0.3183098861837907
#define RECIPROCAL_PI2 0.15915494309189535
#define EPSILON 1e-6
#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
#define whiteComplement( a ) ( 1.0 - saturate( a ) )
float pow2( const in float x ) { return x*x; }
vec3 pow2( const in vec3 x ) { return x*x; }
float pow3( const in float x ) { return x*x*x; }
float pow4( const in float x ) { float x2 = x*x; return x2*x2; }
float max3( const in vec3 v ) { return max( max( v.x, v.y ), v.z ); }
float average( const in vec3 v ) { return dot( v, vec3( 0.3333333 ) ); }
highp float rand( const in vec2 uv ) {
	const highp float a = 12.9898, b = 78.233, c = 43758.5453;
	highp float dt = dot( uv.xy, vec2( a,b ) ), sn = mod( dt, PI );
	return fract( sin( sn ) * c );
}
#ifdef HIGH_PRECISION
	float precisionSafeLength( vec3 v ) { return length( v ); }
#else
	float precisionSafeLength( vec3 v ) {
		float maxComponent = max3( abs( v ) );
		return length( v / maxComponent ) * maxComponent;
	}
#endif
struct IncidentLight {
	vec3 color;
	vec3 direction;
	bool visible;
};
struct ReflectedLight {
	vec3 directDiffuse;
	vec3 directSpecular;
	vec3 indirectDiffuse;
	vec3 indirectSpecular;
};
#ifdef USE_ALPHAHASH
	varying vec3 vPosition;
#endif
vec3 transformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );
}
#define inverseTransformDirection transformDirectionByInverseViewMatrix
vec3 transformNormalByInverseViewMatrix( in vec3 normal, in mat4 viewMatrix ) {
	return normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz );
}
vec3 transformDirectionByInverseViewMatrix( in vec3 dir, in mat4 viewMatrix ) {
	return normalize( ( vec4( dir, 0.0 ) * viewMatrix ).xyz );
}
bool isPerspectiveMatrix( mat4 m ) {
	return m[ 2 ][ 3 ] == - 1.0;
}
vec2 equirectUv( in vec3 dir ) {
	float u = atan( dir.z, dir.x ) * RECIPROCAL_PI2 + 0.5;
	float v = asin( clamp( dir.y, - 1.0, 1.0 ) ) * RECIPROCAL_PI + 0.5;
	return vec2( u, v );
}
vec3 BRDF_Lambert( const in vec3 diffuseColor ) {
	return RECIPROCAL_PI * diffuseColor;
}
vec3 F_Schlick( const in vec3 f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
}
float F_Schlick( const in float f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
} // validated`,U2=`#ifdef ENVMAP_TYPE_CUBE_UV
	#define cubeUV_minMipLevel 4.0
	#define cubeUV_minTileSize 16.0
	float getFace( vec3 direction ) {
		vec3 absDirection = abs( direction );
		float face = - 1.0;
		if ( absDirection.x > absDirection.z ) {
			if ( absDirection.x > absDirection.y )
				face = direction.x > 0.0 ? 0.0 : 3.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		} else {
			if ( absDirection.z > absDirection.y )
				face = direction.z > 0.0 ? 2.0 : 5.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		}
		return face;
	}
	vec2 getUV( vec3 direction, float face ) {
		vec2 uv;
		if ( face == 0.0 ) {
			uv = vec2( direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 1.0 ) {
			uv = vec2( - direction.x, - direction.z ) / abs( direction.y );
		} else if ( face == 2.0 ) {
			uv = vec2( - direction.x, direction.y ) / abs( direction.z );
		} else if ( face == 3.0 ) {
			uv = vec2( - direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 4.0 ) {
			uv = vec2( - direction.x, direction.z ) / abs( direction.y );
		} else {
			uv = vec2( direction.x, direction.y ) / abs( direction.z );
		}
		return 0.5 * ( uv + 1.0 );
	}
	vec3 bilinearCubeUV( sampler2D envMap, vec3 direction, float mipInt ) {
		float face = getFace( direction );
		float filterInt = max( cubeUV_minMipLevel - mipInt, 0.0 );
		mipInt = max( mipInt, cubeUV_minMipLevel );
		float faceSize = exp2( mipInt );
		highp vec2 uv = getUV( direction, face ) * ( faceSize - 2.0 ) + 1.0;
		if ( face > 2.0 ) {
			uv.y += faceSize;
			face -= 3.0;
		}
		uv.x += face * faceSize;
		uv.x += filterInt * 3.0 * cubeUV_minTileSize;
		uv.y += 4.0 * ( exp2( CUBEUV_MAX_MIP ) - faceSize );
		uv.x *= CUBEUV_TEXEL_WIDTH;
		uv.y *= CUBEUV_TEXEL_HEIGHT;
		#ifdef texture2DGradEXT
			return texture2DGradEXT( envMap, uv, vec2( 0.0 ), vec2( 0.0 ) ).rgb;
		#else
			return texture2D( envMap, uv ).rgb;
		#endif
	}
	#define cubeUV_r0 1.0
	#define cubeUV_m0 - 2.0
	#define cubeUV_r1 0.8
	#define cubeUV_m1 - 1.0
	#define cubeUV_r4 0.4
	#define cubeUV_m4 2.0
	#define cubeUV_r5 0.305
	#define cubeUV_m5 3.0
	#define cubeUV_r6 0.21
	#define cubeUV_m6 4.0
	float roughnessToMip( float roughness ) {
		float mip = 0.0;
		if ( roughness >= cubeUV_r1 ) {
			mip = ( cubeUV_r0 - roughness ) * ( cubeUV_m1 - cubeUV_m0 ) / ( cubeUV_r0 - cubeUV_r1 ) + cubeUV_m0;
		} else if ( roughness >= cubeUV_r4 ) {
			mip = ( cubeUV_r1 - roughness ) * ( cubeUV_m4 - cubeUV_m1 ) / ( cubeUV_r1 - cubeUV_r4 ) + cubeUV_m1;
		} else if ( roughness >= cubeUV_r5 ) {
			mip = ( cubeUV_r4 - roughness ) * ( cubeUV_m5 - cubeUV_m4 ) / ( cubeUV_r4 - cubeUV_r5 ) + cubeUV_m4;
		} else if ( roughness >= cubeUV_r6 ) {
			mip = ( cubeUV_r5 - roughness ) * ( cubeUV_m6 - cubeUV_m5 ) / ( cubeUV_r5 - cubeUV_r6 ) + cubeUV_m5;
		} else {
			mip = - 2.0 * log2( 1.16 * roughness );		}
		return mip;
	}
	vec4 textureCubeUV( sampler2D envMap, vec3 sampleDir, float roughness ) {
		float mip = clamp( roughnessToMip( roughness ), cubeUV_m0, CUBEUV_MAX_MIP );
		float mipF = fract( mip );
		float mipInt = floor( mip );
		vec3 color0 = bilinearCubeUV( envMap, sampleDir, mipInt );
		if ( mipF == 0.0 ) {
			return vec4( color0, 1.0 );
		} else {
			vec3 color1 = bilinearCubeUV( envMap, sampleDir, mipInt + 1.0 );
			return vec4( mix( color0, color1, mipF ), 1.0 );
		}
	}
#endif`,L2=`vec3 transformedNormal = objectNormal;
#ifdef USE_TANGENT
	vec3 transformedTangent = objectTangent;
#endif
#ifdef USE_BATCHING
	mat3 bm = mat3( batchingMatrix );
	transformedNormal /= vec3( dot( bm[ 0 ], bm[ 0 ] ), dot( bm[ 1 ], bm[ 1 ] ), dot( bm[ 2 ], bm[ 2 ] ) );
	transformedNormal = bm * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = bm * transformedTangent;
	#endif
#endif
#ifdef USE_INSTANCING
	mat3 im = mat3( instanceMatrix );
	transformedNormal /= vec3( dot( im[ 0 ], im[ 0 ] ), dot( im[ 1 ], im[ 1 ] ), dot( im[ 2 ], im[ 2 ] ) );
	transformedNormal = im * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = im * transformedTangent;
	#endif
#endif
transformedNormal = normalMatrix * transformedNormal;
#ifdef FLIP_SIDED
	transformedNormal = - transformedNormal;
#endif
#ifdef USE_TANGENT
	transformedTangent = ( modelViewMatrix * vec4( transformedTangent, 0.0 ) ).xyz;
#endif`,O2=`#ifdef USE_DISPLACEMENTMAP
	uniform sampler2D displacementMap;
	uniform float displacementScale;
	uniform float displacementBias;
#endif`,I2=`#ifdef USE_DISPLACEMENTMAP
	transformed += normalize( objectNormal ) * ( texture2D( displacementMap, vDisplacementMapUv ).x * displacementScale + displacementBias );
#endif`,P2=`#ifdef USE_EMISSIVEMAP
	vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
	#ifdef DECODE_VIDEO_TEXTURE_EMISSIVE
		emissiveColor = sRGBTransferEOTF( emissiveColor );
	#endif
	totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,B2=`#ifdef USE_EMISSIVEMAP
	uniform sampler2D emissiveMap;
#endif`,z2="gl_FragColor = linearToOutputTexel( gl_FragColor );",F2=`vec4 LinearTransferOETF( in vec4 value ) {
	return value;
}
vec4 sRGBTransferEOTF( in vec4 value ) {
	return vec4( mix( pow( value.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), value.rgb * 0.0773993808, vec3( lessThanEqual( value.rgb, vec3( 0.04045 ) ) ) ), value.a );
}
vec4 sRGBTransferOETF( in vec4 value ) {
	return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}`,H2=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vec3 cameraToFrag;
		if ( isOrthographic ) {
			cameraToFrag = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToFrag = normalize( vWorldPosition - cameraPosition );
		}
		vec3 worldNormal = transformNormalByInverseViewMatrix( normal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vec3 reflectVec = reflect( cameraToFrag, worldNormal );
		#else
			vec3 reflectVec = refract( cameraToFrag, worldNormal, refractionRatio );
		#endif
	#else
		vec3 reflectVec = vReflect;
	#endif
	#ifdef ENVMAP_TYPE_CUBE
		vec4 envColor = textureCube( envMap, envMapRotation * reflectVec );
		#ifdef ENVMAP_BLENDING_MULTIPLY
			outgoingLight = mix( outgoingLight, outgoingLight * envColor.xyz, specularStrength * reflectivity );
		#elif defined( ENVMAP_BLENDING_MIX )
			outgoingLight = mix( outgoingLight, envColor.xyz, specularStrength * reflectivity );
		#elif defined( ENVMAP_BLENDING_ADD )
			outgoingLight += envColor.xyz * specularStrength * reflectivity;
		#endif
	#endif
#endif`,V2=`#ifdef USE_ENVMAP
	uniform float envMapIntensity;
	uniform mat3 envMapRotation;
	#ifdef ENVMAP_TYPE_CUBE
		uniform samplerCube envMap;
	#else
		uniform sampler2D envMap;
	#endif
#endif`,G2=`#ifdef USE_ENVMAP
	uniform float reflectivity;
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		varying vec3 vWorldPosition;
		uniform float refractionRatio;
	#else
		varying vec3 vReflect;
	#endif
#endif`,k2=`#ifdef USE_ENVMAP
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		
		varying vec3 vWorldPosition;
	#else
		varying vec3 vReflect;
		uniform float refractionRatio;
	#endif
#endif`,X2=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vWorldPosition = worldPosition.xyz;
	#else
		vec3 cameraToVertex;
		if ( isOrthographic ) {
			cameraToVertex = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToVertex = normalize( worldPosition.xyz - cameraPosition );
		}
		vec3 worldNormal = transformNormalByInverseViewMatrix( transformedNormal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vReflect = reflect( cameraToVertex, worldNormal );
		#else
			vReflect = refract( cameraToVertex, worldNormal, refractionRatio );
		#endif
	#endif
#endif`,W2=`#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
#endif`,q2=`#ifdef USE_FOG
	varying float vFogDepth;
#endif`,Y2=`#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`,Z2=`#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`,J2=`#ifdef USE_GRADIENTMAP
	uniform sampler2D gradientMap;
#endif
vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {
	float dotNL = dot( normal, lightDirection );
	vec2 coord = vec2( dotNL * 0.5 + 0.5, 0.0 );
	#ifdef USE_GRADIENTMAP
		return vec3( texture2D( gradientMap, coord ).r );
	#else
		vec2 fw = fwidth( coord ) * 0.5;
		return mix( vec3( 0.7 ), vec3( 1.0 ), smoothstep( 0.7 - fw.x, 0.7 + fw.x, coord.x ) );
	#endif
}`,K2=`#ifdef USE_LIGHTMAP
	uniform sampler2D lightMap;
	uniform float lightMapIntensity;
#endif`,Q2=`LambertMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularStrength = specularStrength;`,j2=`varying vec3 vViewPosition;
struct LambertMaterial {
	vec3 diffuseColor;
	float specularStrength;
};
void RE_Direct_Lambert( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Lambert( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Lambert
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Lambert`,$2=`uniform bool receiveShadow;
uniform vec3 ambientLightColor;
#if defined( USE_LIGHT_PROBES )
	uniform vec3 lightProbe[ 9 ];
#endif
vec3 shGetIrradianceAt( in vec3 normal, in vec3 shCoefficients[ 9 ] ) {
	float x = normal.x, y = normal.y, z = normal.z;
	vec3 result = shCoefficients[ 0 ] * 0.886227;
	result += shCoefficients[ 1 ] * 2.0 * 0.511664 * y;
	result += shCoefficients[ 2 ] * 2.0 * 0.511664 * z;
	result += shCoefficients[ 3 ] * 2.0 * 0.511664 * x;
	result += shCoefficients[ 4 ] * 2.0 * 0.429043 * x * y;
	result += shCoefficients[ 5 ] * 2.0 * 0.429043 * y * z;
	result += shCoefficients[ 6 ] * ( 0.743125 * z * z - 0.247708 );
	result += shCoefficients[ 7 ] * 2.0 * 0.429043 * x * z;
	result += shCoefficients[ 8 ] * 0.429043 * ( x * x - y * y );
	return result;
}
vec3 getLightProbeIrradiance( const in vec3 lightProbe[ 9 ], const in vec3 normal ) {
	vec3 worldNormal = transformNormalByInverseViewMatrix( normal, viewMatrix );
	vec3 irradiance = shGetIrradianceAt( worldNormal, lightProbe );
	return irradiance;
}
vec3 getAmbientLightIrradiance( const in vec3 ambientLightColor ) {
	vec3 irradiance = ambientLightColor;
	return irradiance;
}
float getDistanceAttenuation( const in float lightDistance, const in float cutoffDistance, const in float decayExponent ) {
	float distanceFalloff = 1.0 / max( pow( lightDistance, decayExponent ), 0.01 );
	if ( cutoffDistance > 0.0 ) {
		distanceFalloff *= pow2( saturate( 1.0 - pow4( lightDistance / cutoffDistance ) ) );
	}
	return distanceFalloff;
}
float getSpotAttenuation( const in float coneCosine, const in float penumbraCosine, const in float angleCosine ) {
	return smoothstep( coneCosine, penumbraCosine, angleCosine );
}
#if NUM_SUN_LIGHTS > 0
	struct SunLight {
		vec3 direction;
		vec3 color;
	};
	uniform SunLight sunLights[ NUM_SUN_LIGHTS ];
	void getSunLightInfo( const in SunLight sunLight, out IncidentLight light ) {
		light.color = sunLight.color;
		light.direction = sunLight.direction;
		light.visible = true;
	}
#endif
#if NUM_DIR_LIGHTS > 0
	struct DirectionalLight {
		vec3 direction;
		vec3 color;
	};
	uniform DirectionalLight directionalLights[ NUM_DIR_LIGHTS ];
	void getDirectionalLightInfo( const in DirectionalLight directionalLight, out IncidentLight light ) {
		light.color = directionalLight.color;
		light.direction = directionalLight.direction;
		light.visible = true;
	}
#endif
#if NUM_POINT_LIGHTS > 0
	struct PointLight {
		vec3 position;
		vec3 color;
		float distance;
		float decay;
	};
	uniform PointLight pointLights[ NUM_POINT_LIGHTS ];
	void getPointLightInfo( const in PointLight pointLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = pointLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float lightDistance = length( lVector );
		light.color = pointLight.color;
		light.color *= getDistanceAttenuation( lightDistance, pointLight.distance, pointLight.decay );
		light.visible = ( light.color != vec3( 0.0 ) );
	}
#endif
#if NUM_SPOT_LIGHTS > 0
	struct SpotLight {
		vec3 position;
		vec3 direction;
		vec3 color;
		float distance;
		float decay;
		float coneCos;
		float penumbraCos;
	};
	uniform SpotLight spotLights[ NUM_SPOT_LIGHTS ];
	void getSpotLightInfo( const in SpotLight spotLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = spotLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float angleCos = dot( light.direction, spotLight.direction );
		float spotAttenuation = getSpotAttenuation( spotLight.coneCos, spotLight.penumbraCos, angleCos );
		if ( spotAttenuation > 0.0 ) {
			float lightDistance = length( lVector );
			light.color = spotLight.color * spotAttenuation;
			light.color *= getDistanceAttenuation( lightDistance, spotLight.distance, spotLight.decay );
			light.visible = ( light.color != vec3( 0.0 ) );
		} else {
			light.color = vec3( 0.0 );
			light.visible = false;
		}
	}
#endif
#if NUM_RECT_AREA_LIGHTS > 0
	struct RectAreaLight {
		vec3 color;
		vec3 position;
		vec3 halfWidth;
		vec3 halfHeight;
	};
	uniform sampler2D ltc_1;	uniform sampler2D ltc_2;
	uniform RectAreaLight rectAreaLights[ NUM_RECT_AREA_LIGHTS ];
#endif
#if NUM_HEMI_LIGHTS > 0
	struct HemisphereLight {
		vec3 direction;
		vec3 skyColor;
		vec3 groundColor;
	};
	uniform HemisphereLight hemisphereLights[ NUM_HEMI_LIGHTS ];
	vec3 getHemisphereLightIrradiance( const in HemisphereLight hemiLight, const in vec3 normal ) {
		float dotNL = dot( normal, hemiLight.direction );
		float hemiDiffuseWeight = 0.5 * dotNL + 0.5;
		vec3 irradiance = mix( hemiLight.groundColor, hemiLight.skyColor, hemiDiffuseWeight );
		return irradiance;
	}
#endif
#include <lightprobes_pars_fragment>`,tC=`#ifdef USE_ENVMAP
	vec3 getIBLIrradiance( const in vec3 normal ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 worldNormal = transformNormalByInverseViewMatrix( normal, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * worldNormal, 1.0 );
			return PI * envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	vec3 getIBLRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 reflectVec = reflect( - viewDir, normal );
			reflectVec = normalize( mix( reflectVec, normal, pow4( roughness ) ) );
			reflectVec = transformDirectionByInverseViewMatrix( reflectVec, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * reflectVec, roughness );
			return envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	#ifdef USE_RETROREFLECTION
		vec3 getIBLRetroRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
			#ifdef ENVMAP_TYPE_CUBE_UV
				vec3 retroVec = normalize( mix( viewDir, normal, pow4( roughness ) ) );
				retroVec = transformDirectionByInverseViewMatrix( retroVec, viewMatrix );
				vec4 envMapColor = textureCubeUV( envMap, envMapRotation * retroVec, roughness );
				return envMapColor.rgb * envMapIntensity;
			#else
				return vec3( 0.0 );
			#endif
		}
	#endif
	#ifdef USE_ANISOTROPY
		vec3 getIBLAnisotropyRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness, const in vec3 bitangent, const in float anisotropy ) {
			#ifdef ENVMAP_TYPE_CUBE_UV
				vec3 bentNormal = cross( bitangent, viewDir );
				bentNormal = normalize( cross( bentNormal, bitangent ) );
				bentNormal = normalize( mix( bentNormal, normal, pow2( pow2( 1.0 - anisotropy * ( 1.0 - roughness ) ) ) ) );
				return getIBLRadiance( viewDir, bentNormal, roughness );
			#else
				return vec3( 0.0 );
			#endif
		}
		#ifdef USE_RETROREFLECTION
			vec3 getIBLAnisotropyRetroRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness, const in vec3 bitangent, const in float anisotropy ) {
				#ifdef ENVMAP_TYPE_CUBE_UV
					vec3 bentNormal = cross( bitangent, viewDir );
					bentNormal = normalize( cross( bentNormal, bitangent ) );
					bentNormal = normalize( mix( bentNormal, normal, pow2( pow2( 1.0 - anisotropy * ( 1.0 - roughness ) ) ) ) );
					return getIBLRetroRadiance( viewDir, bentNormal, roughness );
				#else
					return vec3( 0.0 );
				#endif
			}
		#endif
	#endif
#endif`,eC=`ToonMaterial material;
material.diffuseColor = diffuseColor.rgb;`,nC=`varying vec3 vViewPosition;
struct ToonMaterial {
	vec3 diffuseColor;
};
void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	vec3 irradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Toon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Toon
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Toon`,iC=`BlinnPhongMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularColor = specular;
material.specularShininess = shininess;
material.specularStrength = specularStrength;`,aC=`varying vec3 vViewPosition;
struct BlinnPhongMaterial {
	vec3 diffuseColor;
	vec3 specularColor;
	float specularShininess;
	float specularStrength;
};
void RE_Direct_BlinnPhong( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
	reflectedLight.directSpecular += irradiance * BRDF_BlinnPhong( directLight.direction, geometryViewDir, geometryNormal, material.specularColor, material.specularShininess ) * material.specularStrength;
}
void RE_IndirectDiffuse_BlinnPhong( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_BlinnPhong
#define RE_IndirectDiffuse		RE_IndirectDiffuse_BlinnPhong`,sC=`PhysicalMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.diffuseContribution = diffuseColor.rgb * ( 1.0 - metalnessFactor );
material.metalness = metalnessFactor;
vec3 dxy = max( abs( dFdx( nonPerturbedNormal ) ), abs( dFdy( nonPerturbedNormal ) ) );
float geometryRoughness = max( max( dxy.x, dxy.y ), dxy.z );
material.roughness = max( roughnessFactor, 0.0525 );material.roughness += geometryRoughness;
material.roughness = min( material.roughness, 1.0 );
#ifdef IOR
	material.ior = ior;
	#ifdef USE_SPECULAR
		float specularIntensityFactor = specularIntensity;
		vec3 specularColorFactor = specularColor;
		#ifdef USE_SPECULAR_COLORMAP
			specularColorFactor *= texture2D( specularColorMap, vSpecularColorMapUv ).rgb;
		#endif
		#ifdef USE_SPECULAR_INTENSITYMAP
			specularIntensityFactor *= texture2D( specularIntensityMap, vSpecularIntensityMapUv ).a;
		#endif
		material.specularF90 = mix( specularIntensityFactor, 1.0, metalnessFactor );
	#else
		float specularIntensityFactor = 1.0;
		vec3 specularColorFactor = vec3( 1.0 );
		material.specularF90 = 1.0;
	#endif
	material.specularColor = min( pow2( ( material.ior - 1.0 ) / ( material.ior + 1.0 ) ) * specularColorFactor, vec3( 1.0 ) ) * specularIntensityFactor;
	material.specularColorBlended = mix( material.specularColor, diffuseColor.rgb, metalnessFactor );
#else
	material.specularColor = vec3( 0.04 );
	material.specularColorBlended = mix( material.specularColor, diffuseColor.rgb, metalnessFactor );
	material.specularF90 = 1.0;
#endif
#ifdef USE_CLEARCOAT
	material.clearcoat = clearcoat;
	material.clearcoatRoughness = clearcoatRoughness;
	material.clearcoatF0 = vec3( 0.04 );
	material.clearcoatF90 = 1.0;
	#ifdef USE_CLEARCOATMAP
		material.clearcoat *= texture2D( clearcoatMap, vClearcoatMapUv ).x;
	#endif
	#ifdef USE_CLEARCOAT_ROUGHNESSMAP
		material.clearcoatRoughness *= texture2D( clearcoatRoughnessMap, vClearcoatRoughnessMapUv ).y;
	#endif
	material.clearcoat = saturate( material.clearcoat );	material.clearcoatRoughness = max( material.clearcoatRoughness, 0.0525 );
	material.clearcoatRoughness += geometryRoughness;
	material.clearcoatRoughness = min( material.clearcoatRoughness, 1.0 );
#endif
#ifdef USE_DISPERSION
	material.dispersion = dispersion;
#endif
#ifdef USE_RETROREFLECTION
	material.retroreflectivity = retroreflectivity;
#endif
#ifdef USE_IRIDESCENCE
	material.iridescence = iridescence;
	material.iridescenceIOR = iridescenceIOR;
	#ifdef USE_IRIDESCENCEMAP
		material.iridescence *= texture2D( iridescenceMap, vIridescenceMapUv ).r;
	#endif
	#ifdef USE_IRIDESCENCE_THICKNESSMAP
		material.iridescenceThickness = (iridescenceThicknessMaximum - iridescenceThicknessMinimum) * texture2D( iridescenceThicknessMap, vIridescenceThicknessMapUv ).g + iridescenceThicknessMinimum;
	#else
		material.iridescenceThickness = iridescenceThicknessMaximum;
	#endif
#endif
#ifdef USE_SHEEN
	material.sheenColor = sheenColor;
	#ifdef USE_SHEEN_COLORMAP
		material.sheenColor *= texture2D( sheenColorMap, vSheenColorMapUv ).rgb;
	#endif
	material.sheenRoughness = clamp( sheenRoughness, 0.0001, 1.0 );
	#ifdef USE_SHEEN_ROUGHNESSMAP
		material.sheenRoughness *= texture2D( sheenRoughnessMap, vSheenRoughnessMapUv ).a;
	#endif
#endif
#ifdef USE_ANISOTROPY
	#ifdef USE_ANISOTROPYMAP
		mat2 anisotropyMat = mat2( anisotropyVector.x, anisotropyVector.y, - anisotropyVector.y, anisotropyVector.x );
		vec3 anisotropyPolar = texture2D( anisotropyMap, vAnisotropyMapUv ).rgb;
		vec2 anisotropyV = anisotropyMat * normalize( 2.0 * anisotropyPolar.rg - vec2( 1.0 ) ) * anisotropyPolar.b;
	#else
		vec2 anisotropyV = anisotropyVector;
	#endif
	material.anisotropy = length( anisotropyV );
	if( material.anisotropy == 0.0 ) {
		anisotropyV = vec2( 1.0, 0.0 );
	} else {
		anisotropyV /= material.anisotropy;
		material.anisotropy = saturate( material.anisotropy );
	}
	material.alphaT = mix( pow2( material.roughness ), 1.0, pow2( material.anisotropy ) );
	material.anisotropyT = tbn[ 0 ] * anisotropyV.x + tbn[ 1 ] * anisotropyV.y;
	material.anisotropyB = tbn[ 1 ] * anisotropyV.x - tbn[ 0 ] * anisotropyV.y;
#endif`,rC=`uniform sampler2D dfgLUT;
struct PhysicalMaterial {
	vec3 diffuseColor;
	vec3 diffuseContribution;
	vec3 specularColor;
	vec3 specularColorBlended;
	float roughness;
	float metalness;
	float specularF90;
	float dispersion;
	vec2 dfg;
	vec3 multiScatteringCompensation;
	#ifdef USE_RETROREFLECTION
		float retroreflectivity;
	#endif
	#ifdef USE_CLEARCOAT
		float clearcoat;
		float clearcoatRoughness;
		vec3 clearcoatF0;
		float clearcoatF90;
	#endif
	#ifdef USE_IRIDESCENCE
		float iridescence;
		float iridescenceIOR;
		float iridescenceThickness;
		vec3 iridescenceFresnel;
		vec3 iridescenceF0Dielectric;
		vec3 iridescenceF0Metallic;
	#endif
	#ifdef USE_SHEEN
		vec3 sheenColor;
		float sheenRoughness;
	#endif
	#ifdef IOR
		float ior;
	#endif
	#ifdef USE_TRANSMISSION
		float transmission;
		float transmissionAlpha;
		float thickness;
		float attenuationDistance;
		vec3 attenuationColor;
	#endif
	#ifdef USE_ANISOTROPY
		float anisotropy;
		float alphaT;
		vec3 anisotropyT;
		vec3 anisotropyB;
	#endif
};
vec3 clearcoatSpecularDirect = vec3( 0.0 );
vec3 clearcoatSpecularIndirect = vec3( 0.0 );
vec3 sheenSpecularDirect = vec3( 0.0 );
vec3 sheenSpecularIndirect = vec3(0.0 );
vec3 Schlick_to_F0( const in vec3 f, const in float f90, const in float dotVH ) {
    float x = clamp( 1.0 - dotVH, 0.0, 1.0 );
    float x2 = x * x;
    float x5 = clamp( x * x2 * x2, 0.0, 0.9999 );
    return ( f - vec3( f90 ) * x5 ) / ( 1.0 - x5 );
}
float V_GGX_SmithCorrelated( const in float alpha, const in float dotNL, const in float dotNV ) {
	float a2 = pow2( alpha );
	float gv = dotNL * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNV ) );
	float gl = dotNV * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNL ) );
	return 0.5 / max( gv + gl, EPSILON );
}
float D_GGX( const in float alpha, const in float dotNH ) {
	float a2 = pow2( alpha );
	float denom = pow2( dotNH ) * ( a2 - 1.0 ) + 1.0;
	return RECIPROCAL_PI * a2 / pow2( denom );
}
#ifdef USE_ANISOTROPY
	float V_GGX_SmithCorrelated_Anisotropic( const in float alphaT, const in float alphaB, const in float dotTV, const in float dotBV, const in float dotTL, const in float dotBL, const in float dotNV, const in float dotNL ) {
		float gv = dotNL * length( vec3( alphaT * dotTV, alphaB * dotBV, dotNV ) );
		float gl = dotNV * length( vec3( alphaT * dotTL, alphaB * dotBL, dotNL ) );
		return 0.5 / max( gv + gl, EPSILON );
	}
	float D_GGX_Anisotropic( const in float alphaT, const in float alphaB, const in float dotNH, const in float dotTH, const in float dotBH ) {
		float a2 = alphaT * alphaB;
		highp vec3 v = vec3( alphaB * dotTH, alphaT * dotBH, a2 * dotNH );
		highp float v2 = dot( v, v );
		float w2 = a2 / v2;
		return RECIPROCAL_PI * a2 * pow2 ( w2 );
	}
#endif
#ifdef USE_CLEARCOAT
	vec3 BRDF_GGX_Clearcoat( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material) {
		vec3 f0 = material.clearcoatF0;
		float f90 = material.clearcoatF90;
		float roughness = material.clearcoatRoughness;
		float alpha = pow2( roughness );
		vec3 halfDir = normalize( lightDir + viewDir );
		float dotNL = saturate( dot( normal, lightDir ) );
		float dotNV = saturate( dot( normal, viewDir ) );
		float dotNH = saturate( dot( normal, halfDir ) );
		float dotVH = saturate( dot( viewDir, halfDir ) );
		vec3 F = F_Schlick( f0, f90, dotVH );
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
		return F * ( V * D );
	}
#endif
vec3 BRDF_GGX( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material ) {
	vec3 f0 = material.specularColorBlended;
	float f90 = material.specularF90;
	float roughness = material.roughness;
	float alpha = pow2( roughness );
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( f0, f90, dotVH );
	#ifdef USE_IRIDESCENCE
		F = mix( F, material.iridescenceFresnel, material.iridescence );
	#endif
	#ifdef USE_ANISOTROPY
		float dotTL = dot( material.anisotropyT, lightDir );
		float dotTV = dot( material.anisotropyT, viewDir );
		float dotTH = dot( material.anisotropyT, halfDir );
		float dotBL = dot( material.anisotropyB, lightDir );
		float dotBV = dot( material.anisotropyB, viewDir );
		float dotBH = dot( material.anisotropyB, halfDir );
		float V = V_GGX_SmithCorrelated_Anisotropic( material.alphaT, alpha, dotTV, dotBV, dotTL, dotBL, dotNV, dotNL );
		float D = D_GGX_Anisotropic( material.alphaT, alpha, dotNH, dotTH, dotBH );
	#else
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
	#endif
	return F * ( V * D );
}
vec2 LTC_Uv( const in vec3 N, const in vec3 V, const in float roughness ) {
	const float LUT_SIZE = 64.0;
	const float LUT_SCALE = ( LUT_SIZE - 1.0 ) / LUT_SIZE;
	const float LUT_BIAS = 0.5 / LUT_SIZE;
	float dotNV = saturate( dot( N, V ) );
	vec2 uv = vec2( roughness, sqrt( 1.0 - dotNV ) );
	uv = uv * LUT_SCALE + LUT_BIAS;
	return uv;
}
float LTC_ClippedSphereFormFactor( const in vec3 f ) {
	float l = length( f );
	return max( ( l * l + f.z ) / ( l + 1.0 ), 0.0 );
}
vec3 LTC_EdgeVectorFormFactor( const in vec3 v1, const in vec3 v2 ) {
	float x = dot( v1, v2 );
	float y = abs( x );
	float a = 0.8543985 + ( 0.4965155 + 0.0145206 * y ) * y;
	float b = 3.4175940 + ( 4.1616724 + y ) * y;
	float v = a / b;
	float theta_sintheta = ( x > 0.0 ) ? v : 0.5 * inversesqrt( max( 1.0 - x * x, 1e-7 ) ) - v;
	return cross( v1, v2 ) * theta_sintheta;
}
vec3 LTC_Evaluate( const in vec3 N, const in vec3 V, const in vec3 P, const in mat3 mInv, const in vec3 rectCoords[ 4 ] ) {
	vec3 v1 = rectCoords[ 1 ] - rectCoords[ 0 ];
	vec3 v2 = rectCoords[ 3 ] - rectCoords[ 0 ];
	vec3 lightNormal = cross( v1, v2 );
	if( dot( lightNormal, P - rectCoords[ 0 ] ) < 0.0 ) return vec3( 0.0 );
	vec3 T1, T2;
	T1 = normalize( V - N * dot( V, N ) );
	T2 = - cross( N, T1 );
	mat3 mat = mInv * transpose( mat3( T1, T2, N ) );
	vec3 coords[ 4 ];
	coords[ 0 ] = mat * ( rectCoords[ 0 ] - P );
	coords[ 1 ] = mat * ( rectCoords[ 1 ] - P );
	coords[ 2 ] = mat * ( rectCoords[ 2 ] - P );
	coords[ 3 ] = mat * ( rectCoords[ 3 ] - P );
	coords[ 0 ] = normalize( coords[ 0 ] );
	coords[ 1 ] = normalize( coords[ 1 ] );
	coords[ 2 ] = normalize( coords[ 2 ] );
	coords[ 3 ] = normalize( coords[ 3 ] );
	vec3 vectorFormFactor = vec3( 0.0 );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 0 ], coords[ 1 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 1 ], coords[ 2 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 2 ], coords[ 3 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 3 ], coords[ 0 ] );
	float result = LTC_ClippedSphereFormFactor( vectorFormFactor );
	return vec3( result );
}
#if defined( USE_SHEEN )
float D_Charlie( float roughness, float dotNH ) {
	float alpha = pow2( roughness );
	float invAlpha = 1.0 / alpha;
	float cos2h = dotNH * dotNH;
	float sin2h = max( 1.0 - cos2h, 0.0078125 );
	return ( 2.0 + invAlpha ) * pow( sin2h, invAlpha * 0.5 ) / ( 2.0 * PI );
}
float V_Neubelt( float dotNV, float dotNL ) {
	return saturate( 1.0 / ( 4.0 * ( dotNL + dotNV - dotNL * dotNV ) ) );
}
vec3 BRDF_Sheen( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, vec3 sheenColor, const in float sheenRoughness ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float D = D_Charlie( sheenRoughness, dotNH );
	float V = V_Neubelt( dotNV, dotNL );
	return sheenColor * ( D * V );
}
#endif
float IBLSheenBRDF( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	float r2 = roughness * roughness;
	float rInv = 1.0 / ( roughness + 0.1 );
	float a = -1.9362 + 1.0678 * roughness + 0.4573 * r2 - 0.8469 * rInv;
	float b = -0.6014 + 0.5538 * roughness - 0.4670 * r2 - 0.1255 * rInv;
	float DG = exp( a * dotNV + b );
	return saturate( DG );
}
vec3 EnvironmentBRDF( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	vec2 fab = texture2D( dfgLUT, vec2( roughness, dotNV ) ).rg;
	return specularColor * fab.x + specularF90 * fab.y;
}
#ifdef USE_IRIDESCENCE
void computeMultiscatteringIridescence( const in vec2 fab, const in vec3 specularColor, const in float specularF90, const in float iridescence, const in vec3 iridescenceF0, inout vec3 singleScatter, inout vec3 multiScatter ) {
#else
void computeMultiscattering( const in vec2 fab, const in vec3 specularColor, const in float specularF90, inout vec3 singleScatter, inout vec3 multiScatter ) {
#endif
	#ifdef USE_IRIDESCENCE
		vec3 Fr = mix( specularColor, iridescenceF0, iridescence );
	#else
		vec3 Fr = specularColor;
	#endif
	vec3 FssEss = Fr * fab.x + specularF90 * fab.y;
	float Ess = fab.x + fab.y;
	float Ems = 1.0 - Ess;
	vec3 Favg = Fr + ( 1.0 - Fr ) * 0.047619;	vec3 Fms = FssEss * Favg / ( 1.0 - Ems * Favg );
	singleScatter += FssEss;
	multiScatter += Fms * Ems;
}
#if NUM_RECT_AREA_LIGHTS > 0
	void RE_Direct_RectArea_Physical( const in RectAreaLight rectAreaLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
		vec3 normal = geometryNormal;
		vec3 viewDir = geometryViewDir;
		vec3 position = geometryPosition;
		vec3 lightPos = rectAreaLight.position;
		vec3 halfWidth = rectAreaLight.halfWidth;
		vec3 halfHeight = rectAreaLight.halfHeight;
		vec3 lightColor = rectAreaLight.color;
		float roughness = material.roughness;
		vec3 rectCoords[ 4 ];
		rectCoords[ 0 ] = lightPos + halfWidth - halfHeight;		rectCoords[ 1 ] = lightPos - halfWidth - halfHeight;
		rectCoords[ 2 ] = lightPos - halfWidth + halfHeight;
		rectCoords[ 3 ] = lightPos + halfWidth + halfHeight;
		vec2 uv = LTC_Uv( normal, viewDir, roughness );
		vec4 t1 = texture2D( ltc_1, uv );
		vec4 t2 = texture2D( ltc_2, uv );
		mat3 mInv = mat3(
			vec3( t1.x, 0, t1.y ),
			vec3(    0, 1,    0 ),
			vec3( t1.z, 0, t1.w )
		);
		vec3 fresnel = ( material.specularColorBlended * t2.x + ( material.specularF90 - material.specularColorBlended ) * t2.y );
		reflectedLight.directSpecular += lightColor * fresnel * LTC_Evaluate( normal, viewDir, position, mInv, rectCoords );
		reflectedLight.directDiffuse += lightColor * material.diffuseContribution * LTC_Evaluate( normal, viewDir, position, mat3( 1.0 ), rectCoords );
		#ifdef USE_CLEARCOAT
			vec3 Ncc = geometryClearcoatNormal;
			vec2 uvClearcoat = LTC_Uv( Ncc, viewDir, material.clearcoatRoughness );
			vec4 t1Clearcoat = texture2D( ltc_1, uvClearcoat );
			vec4 t2Clearcoat = texture2D( ltc_2, uvClearcoat );
			mat3 mInvClearcoat = mat3(
				vec3( t1Clearcoat.x, 0, t1Clearcoat.y ),
				vec3(             0, 1,             0 ),
				vec3( t1Clearcoat.z, 0, t1Clearcoat.w )
			);
			vec3 fresnelClearcoat = material.clearcoatF0 * t2Clearcoat.x + ( material.clearcoatF90 - material.clearcoatF0 ) * t2Clearcoat.y;
			clearcoatSpecularDirect += lightColor * fresnelClearcoat * LTC_Evaluate( Ncc, viewDir, position, mInvClearcoat, rectCoords );
		#endif
	}
#endif
void RE_Direct_Physical( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	#ifdef USE_CLEARCOAT
		float dotNLcc = saturate( dot( geometryClearcoatNormal, directLight.direction ) );
		vec3 ccIrradiance = dotNLcc * directLight.color;
		clearcoatSpecularDirect += ccIrradiance * BRDF_GGX_Clearcoat( directLight.direction, geometryViewDir, geometryClearcoatNormal, material );
	#endif
	#ifdef USE_SHEEN
 
 		sheenSpecularDirect += irradiance * BRDF_Sheen( directLight.direction, geometryViewDir, geometryNormal, material.sheenColor, material.sheenRoughness );
 
 		float sheenAlbedoV = IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
 		float sheenAlbedoL = IBLSheenBRDF( geometryNormal, directLight.direction, material.sheenRoughness );
 
 		float sheenEnergyComp = 1.0 - max3( material.sheenColor ) * max( sheenAlbedoV, sheenAlbedoL );
 
 		irradiance *= sheenEnergyComp;
 
 	#endif
	vec3 specularBRDF = BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );
	#ifdef USE_RETROREFLECTION
		vec3 retroViewDir = reflect( - geometryViewDir, geometryNormal );
		vec3 retroSpecularBRDF = BRDF_GGX( directLight.direction, retroViewDir, geometryNormal, material );
		specularBRDF = mix( specularBRDF, retroSpecularBRDF, saturate( material.retroreflectivity ) );
	#endif
	reflectedLight.directSpecular += irradiance * specularBRDF * material.multiScatteringCompensation;
	vec3 halfDir = normalize( directLight.direction + geometryViewDir );
	float dotVH = saturate( dot( geometryViewDir, halfDir ) );
	vec3 F = F_Schlick( material.specularColor, material.specularF90, dotVH );
	#ifdef USE_RETROREFLECTION
		vec3 retroHalfDir = normalize( directLight.direction + retroViewDir );
		float dotRetroVH = saturate( dot( retroViewDir, retroHalfDir ) );
		vec3 retroF = F_Schlick( material.specularColor, material.specularF90, dotRetroVH );
		F = mix( F, retroF, saturate( material.retroreflectivity ) );
	#endif
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );
}
void RE_IndirectDiffuse_Physical( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	vec3 singleScattering = vec3( 0.0 );
	vec3 multiScattering = vec3( 0.0 );
	#ifdef USE_IRIDESCENCE
		computeMultiscatteringIridescence( material.dfg, material.specularColor, material.specularF90, material.iridescence, material.iridescenceF0Dielectric, singleScattering, multiScattering );
	#else
		computeMultiscattering( material.dfg, material.specularColor, material.specularF90, singleScattering, multiScattering );
	#endif
	vec3 diffuse = irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - singleScattering - multiScattering );
	#ifdef USE_SHEEN
		float sheenAlbedo = IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
		sheenSpecularIndirect += irradiance * material.sheenColor * sheenAlbedo * RECIPROCAL_PI;
		float sheenEnergyComp = 1.0 - max3( material.sheenColor ) * sheenAlbedo;
		diffuse *= sheenEnergyComp;
	#endif
	reflectedLight.indirectDiffuse += diffuse;
}
void RE_IndirectSpecular_Physical( const in vec3 radiance, const in vec3 irradiance, const in vec3 clearcoatRadiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
	#ifdef USE_CLEARCOAT
		clearcoatSpecularIndirect += clearcoatRadiance * EnvironmentBRDF( geometryClearcoatNormal, geometryViewDir, material.clearcoatF0, material.clearcoatF90, material.clearcoatRoughness );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularIndirect += irradiance * material.sheenColor * IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness ) * RECIPROCAL_PI;
 	#endif
	vec3 singleScatteringDielectric = vec3( 0.0 );
	vec3 multiScatteringDielectric = vec3( 0.0 );
	vec3 singleScatteringMetallic = vec3( 0.0 );
	vec3 multiScatteringMetallic = vec3( 0.0 );
	#ifdef USE_IRIDESCENCE
		computeMultiscatteringIridescence( material.dfg, material.specularColor, material.specularF90, material.iridescence, material.iridescenceF0Dielectric, singleScatteringDielectric, multiScatteringDielectric );
		computeMultiscatteringIridescence( material.dfg, material.diffuseColor, material.specularF90, material.iridescence, material.iridescenceF0Metallic, singleScatteringMetallic, multiScatteringMetallic );
	#else
		computeMultiscattering( material.dfg, material.specularColor, material.specularF90, singleScatteringDielectric, multiScatteringDielectric );
		computeMultiscattering( material.dfg, material.diffuseColor, material.specularF90, singleScatteringMetallic, multiScatteringMetallic );
	#endif
	vec3 singleScattering = mix( singleScatteringDielectric, singleScatteringMetallic, material.metalness );
	vec3 multiScattering = mix( multiScatteringDielectric, multiScatteringMetallic, material.metalness );
	vec3 totalScatteringDielectric = singleScatteringDielectric + multiScatteringDielectric;
	vec3 diffuse = material.diffuseContribution * ( 1.0 - totalScatteringDielectric );
	vec3 cosineWeightedIrradiance = irradiance * RECIPROCAL_PI;
	vec3 indirectSpecular = radiance * singleScattering;
	indirectSpecular += multiScattering * cosineWeightedIrradiance;
	vec3 indirectDiffuse = diffuse * cosineWeightedIrradiance;
	#ifdef USE_SHEEN
		float sheenAlbedo = IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
		float sheenEnergyComp = 1.0 - max3( material.sheenColor ) * sheenAlbedo;
		indirectSpecular *= sheenEnergyComp;
		indirectDiffuse *= sheenEnergyComp;
	#endif
	reflectedLight.indirectSpecular += indirectSpecular;
	reflectedLight.indirectDiffuse += indirectDiffuse;
}
#define RE_Direct				RE_Direct_Physical
#define RE_Direct_RectArea		RE_Direct_RectArea_Physical
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Physical
#define RE_IndirectSpecular		RE_IndirectSpecular_Physical
float computeSpecularOcclusion( const in float dotNV, const in float ambientOcclusion, const in float roughness ) {
	return saturate( pow( dotNV + ambientOcclusion, exp2( - 16.0 * roughness - 1.0 ) ) - 1.0 + ambientOcclusion );
}`,oC=`
vec3 geometryPosition = - vViewPosition;
vec3 geometryNormal = normal;
vec3 geometryViewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition );
vec3 geometryClearcoatNormal = vec3( 0.0 );
#ifdef USE_CLEARCOAT
	geometryClearcoatNormal = clearcoatNormal;
#endif
#ifdef USE_IRIDESCENCE
	float dotNVi = saturate( dot( normal, geometryViewDir ) );
	if ( material.iridescenceThickness == 0.0 ) {
		material.iridescence = 0.0;
	} else {
		material.iridescence = saturate( material.iridescence );
	}
	if ( material.iridescence > 0.0 ) {
		vec3 iridescenceFresnelDielectric = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.specularColor );
		vec3 iridescenceFresnelMetallic = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.diffuseColor );
		material.iridescenceFresnel = mix( iridescenceFresnelDielectric, iridescenceFresnelMetallic, material.metalness );
		material.iridescenceF0Dielectric = Schlick_to_F0( iridescenceFresnelDielectric, 1.0, dotNVi );
		material.iridescenceF0Metallic = Schlick_to_F0( iridescenceFresnelMetallic, 1.0, dotNVi );
	}
#endif
#ifdef STANDARD
	float dotNVms = saturate( dot( geometryNormal, geometryViewDir ) );
	material.dfg = texture2D( dfgLUT, vec2( material.roughness, dotNVms ) ).rg;
	#if ( NUM_SUN_LIGHTS > 0 || NUM_DIR_LIGHTS > 0 || NUM_POINT_LIGHTS > 0 || NUM_SPOT_LIGHTS > 0 )
		float EssMs = material.dfg.x + material.dfg.y;
		material.multiScatteringCompensation = 1.0 + material.specularColorBlended * ( 1.0 / EssMs - 1.0 );
	#endif
#endif
IncidentLight directLight;
#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )
	PointLight pointLight;
	#if defined( USE_SHADOWMAP ) && NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
		pointLight = pointLights[ i ];
		getPointLightInfo( pointLight, geometryPosition, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_POINT_LIGHT_SHADOWS ) && ( defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_BASIC ) )
		pointLightShadow = pointLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getPointShadow( pointShadowMap[ i ], pointLightShadow.shadowMapSize, pointLightShadow.shadowIntensity, pointLightShadow.shadowBias, pointLightShadow.shadowRadius, vPointShadowCoord[ i ], pointLightShadow.shadowCameraNear, pointLightShadow.shadowCameraFar ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )
	SpotLight spotLight;
	vec4 spotColor;
	vec3 spotLightCoord;
	bool inSpotLightMap;
	#if defined( USE_SHADOWMAP ) && NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHTS; i ++ ) {
		spotLight = spotLights[ i ];
		getSpotLightInfo( spotLight, geometryPosition, directLight );
		#if ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#define SPOT_LIGHT_MAP_INDEX UNROLLED_LOOP_INDEX
		#elif ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		#define SPOT_LIGHT_MAP_INDEX NUM_SPOT_LIGHT_MAPS
		#else
		#define SPOT_LIGHT_MAP_INDEX ( UNROLLED_LOOP_INDEX - NUM_SPOT_LIGHT_SHADOWS + NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#endif
		#if ( SPOT_LIGHT_MAP_INDEX < NUM_SPOT_LIGHT_MAPS )
			spotLightCoord = vSpotLightCoord[ i ].xyz / vSpotLightCoord[ i ].w;
			inSpotLightMap = all( lessThan( abs( spotLightCoord * 2. - 1. ), vec3( 1.0 ) ) );
			spotColor = texture2D( spotLightMap[ SPOT_LIGHT_MAP_INDEX ], spotLightCoord.xy );
			directLight.color = inSpotLightMap ? directLight.color * spotColor.rgb : directLight.color;
		#endif
		#undef SPOT_LIGHT_MAP_INDEX
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		spotLightShadow = spotLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( spotShadowMap[ i ], spotLightShadow.shadowMapSize, spotLightShadow.shadowIntensity, spotLightShadow.shadowBias, spotLightShadow.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_SUN_LIGHTS > 0 ) && defined( RE_Direct )
	SunLight sunLight;
	#if defined( USE_SHADOWMAP ) && NUM_SUN_LIGHT_SHADOWS > 0
	SunLightShadow sunLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SUN_LIGHTS; i ++ ) {
		sunLight = sunLights[ i ];
		getSunLightInfo( sunLight, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SUN_LIGHT_SHADOWS )
		sunLightShadow = sunLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getSunShadow( sunShadowMap[ i ], sunLightShadow, UNROLLED_LOOP_INDEX ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )
	DirectionalLight directionalLight;
	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
		directionalLight = directionalLights[ i ];
		getDirectionalLightInfo( directionalLight, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
		directionalLightShadow = directionalLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_RECT_AREA_LIGHTS > 0 ) && defined( RE_Direct_RectArea )
	RectAreaLight rectAreaLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_RECT_AREA_LIGHTS; i ++ ) {
		rectAreaLight = rectAreaLights[ i ];
		RE_Direct_RectArea( rectAreaLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if defined( RE_IndirectDiffuse )
	vec3 iblIrradiance = vec3( 0.0 );
	vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );
	#if defined( USE_LIGHT_PROBES )
		irradiance += getLightProbeIrradiance( lightProbe, geometryNormal );
	#endif
	#if ( NUM_HEMI_LIGHTS > 0 )
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_HEMI_LIGHTS; i ++ ) {
			irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );
		}
		#pragma unroll_loop_end
	#endif
	#ifdef USE_LIGHT_PROBES_GRID
		vec3 probeWorldPos = ( ( vec4( geometryPosition, 1.0 ) - viewMatrix[ 3 ] ) * viewMatrix ).xyz;
		vec3 probeWorldNormal = transformNormalByInverseViewMatrix( geometryNormal, viewMatrix );
		irradiance += getLightProbeGridIrradiance( probeWorldPos, probeWorldNormal );
	#endif
#endif
#if defined( RE_IndirectSpecular )
	vec3 radiance = vec3( 0.0 );
	vec3 clearcoatRadiance = vec3( 0.0 );
#endif`,lC=`#if defined( RE_IndirectDiffuse )
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;
		irradiance += lightMapIrradiance;
	#endif
	#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )
		#if defined( STANDARD ) || defined( LAMBERT ) || defined( PHONG )
			iblIrradiance += getIBLIrradiance( geometryNormal );
		#endif
	#endif
#endif
#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
	#ifdef USE_ANISOTROPY
		vec3 iblRadiance = getIBLAnisotropyRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy );
	#else
		vec3 iblRadiance = getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );
	#endif
	#ifdef USE_RETROREFLECTION
		#ifdef USE_ANISOTROPY
			vec3 retroIBLRadiance = getIBLAnisotropyRetroRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy );
		#else
			vec3 retroIBLRadiance = getIBLRetroRadiance( geometryViewDir, geometryNormal, material.roughness );
		#endif
		iblRadiance = mix( iblRadiance, retroIBLRadiance, saturate( material.retroreflectivity ) );
	#endif
	radiance += iblRadiance;
	#ifdef USE_CLEARCOAT
		clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness );
	#endif
#endif`,cC=`#if defined( RE_IndirectDiffuse )
	#if defined( LAMBERT ) || defined( PHONG )
		irradiance += iblIrradiance;
	#endif
	RE_IndirectDiffuse( irradiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif
#if defined( RE_IndirectSpecular )
	RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif`,uC=`#ifdef USE_LIGHT_PROBES_GRID
uniform highp sampler3D probesSH;
uniform vec3 probesMin;
uniform vec3 probesMax;
uniform vec3 probesResolution;
vec3 getLightProbeGridIrradiance( vec3 worldPos, vec3 worldNormal ) {
	vec3 res = probesResolution;
	vec3 gridRange = probesMax - probesMin;
	vec3 resMinusOne = res - 1.0;
	vec3 probeSpacing = gridRange / resMinusOne;
	vec3 samplePos = worldPos + worldNormal * probeSpacing * 0.5;
	vec3 uvw = clamp( ( samplePos - probesMin ) / gridRange, 0.0, 1.0 );
	uvw = uvw * resMinusOne / res + 0.5 / res;
	float nz          = res.z;
	float paddedSlices = nz + 2.0;
	float atlasDepth  = 7.0 * paddedSlices;
	float uvZBase     = uvw.z * nz + 1.0;
	vec4 s0 = texture( probesSH, vec3( uvw.xy, ( uvZBase                       ) / atlasDepth ) );
	vec4 s1 = texture( probesSH, vec3( uvw.xy, ( uvZBase +       paddedSlices   ) / atlasDepth ) );
	vec4 s2 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 2.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s3 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 3.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s4 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 4.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s5 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 5.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s6 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 6.0 * paddedSlices   ) / atlasDepth ) );
	vec3 c0 = s0.xyz;
	vec3 c1 = vec3( s0.w, s1.xy );
	vec3 c2 = vec3( s1.zw, s2.x );
	vec3 c3 = s2.yzw;
	vec3 c4 = s3.xyz;
	vec3 c5 = vec3( s3.w, s4.xy );
	vec3 c6 = vec3( s4.zw, s5.x );
	vec3 c7 = s5.yzw;
	vec3 c8 = s6.xyz;
	float x = worldNormal.x, y = worldNormal.y, z = worldNormal.z;
	vec3 result = c0 * 0.886227;
	result += c1 * 2.0 * 0.511664 * y;
	result += c2 * 2.0 * 0.511664 * z;
	result += c3 * 2.0 * 0.511664 * x;
	result += c4 * 2.0 * 0.429043 * x * y;
	result += c5 * 2.0 * 0.429043 * y * z;
	result += c6 * ( 0.743125 * z * z - 0.247708 );
	result += c7 * 2.0 * 0.429043 * x * z;
	result += c8 * 0.429043 * ( x * x - y * y );
	return max( result, vec3( 0.0 ) );
}
#endif`,fC=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;
#endif`,hC=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	uniform float logDepthBufFC;
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,dC=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,pC=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	vFragDepth = 1.0 + gl_Position.w;
	vIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );
#endif`,mC=`#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`,gC=`#ifdef USE_MAP
	uniform sampler2D map;
#endif`,vC=`#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
	#if defined( USE_POINTS_UV )
		vec2 uv = vUv;
	#else
		vec2 uv = ( uvTransform * vec3( gl_PointCoord.x, 1.0 - gl_PointCoord.y, 1 ) ).xy;
	#endif
#endif
#ifdef USE_MAP
	diffuseColor *= texture2D( map, uv );
#endif
#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, uv ).g;
#endif`,_C=`#if defined( USE_POINTS_UV )
	varying vec2 vUv;
#else
	#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
		uniform mat3 uvTransform;
	#endif
#endif
#ifdef USE_MAP
	uniform sampler2D map;
#endif
#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,xC=`float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
	metalnessFactor *= texelMetalness.b;
#endif`,yC=`#ifdef USE_METALNESSMAP
	uniform sampler2D metalnessMap;
#endif`,SC=`#ifdef USE_INSTANCING_MORPH
	float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	float morphTargetBaseInfluence = texelFetch( morphTexture, ivec2( 0, gl_InstanceID ), 0 ).r;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		morphTargetInfluences[i] =  texelFetch( morphTexture, ivec2( i + 1, gl_InstanceID ), 0 ).r;
	}
#endif`,MC=`#if defined( USE_MORPHCOLORS )
	vColor *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		#if defined( USE_COLOR_ALPHA )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ) * morphTargetInfluences[ i ];
		#elif defined( USE_COLOR )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ).rgb * morphTargetInfluences[ i ];
		#endif
	}
#endif`,bC=`#ifdef USE_MORPHNORMALS
	objectNormal *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) objectNormal += getMorph( gl_VertexID, i, 1 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,TC=`#ifdef USE_MORPHTARGETS
	#ifndef USE_INSTANCING_MORPH
		uniform float morphTargetBaseInfluence;
		uniform float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	#endif
	uniform sampler2DArray morphTargetsTexture;
	uniform ivec2 morphTargetsTextureSize;
	vec4 getMorph( const in int vertexIndex, const in int morphTargetIndex, const in int offset ) {
		int texelIndex = vertexIndex * MORPHTARGETS_TEXTURE_STRIDE + offset;
		int y = texelIndex / morphTargetsTextureSize.x;
		int x = texelIndex - y * morphTargetsTextureSize.x;
		ivec3 morphUV = ivec3( x, y, morphTargetIndex );
		return texelFetch( morphTargetsTexture, morphUV, 0 );
	}
#endif`,EC=`#ifdef USE_MORPHTARGETS
	transformed *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) transformed += getMorph( gl_VertexID, i, 0 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,AC=`float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
#ifdef FLAT_SHADED
	vec3 fdx = dFdx( vViewPosition );
	vec3 fdy = dFdy( vViewPosition );
	vec3 normal = normalize( cross( fdx, fdy ) );
#else
	vec3 normal = normalize( vNormal );
	#ifdef DOUBLE_SIDED
		normal *= faceDirection;
	#endif
#endif
#if defined( USE_NORMALMAP_TANGENTSPACE ) || defined( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY )
	#ifdef USE_TANGENT
		mat3 tbn = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn = getTangentFrame( - vViewPosition, normal,
		#if defined( USE_NORMALMAP )
			vNormalMapUv
		#elif defined( USE_CLEARCOAT_NORMALMAP )
			vClearcoatNormalMapUv
		#else
			vUv
		#endif
		);
	#endif
	#ifdef DOUBLE_SIDED
		tbn[0] *= faceDirection;
		tbn[1] *= faceDirection;
	#endif
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	#ifdef USE_TANGENT
		mat3 tbn2 = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn2 = getTangentFrame( - vViewPosition, normal, vClearcoatNormalMapUv );
	#endif
	#ifdef DOUBLE_SIDED
		tbn2[0] *= faceDirection;
		tbn2[1] *= faceDirection;
	#endif
#endif
vec3 nonPerturbedNormal = normal;`,wC=`#ifdef USE_NORMALMAP_OBJECTSPACE
	normal = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	#ifdef FLIP_SIDED
		normal = - normal;
	#endif
	#ifdef DOUBLE_SIDED
		normal = normal * faceDirection;
	#endif
	normal = normalize( normalMatrix * normal );
#elif defined( USE_NORMALMAP_TANGENTSPACE )
	vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	#if defined( USE_PACKED_NORMALMAP )
		mapN = vec3( mapN.xy, sqrt( saturate( 1.0 - dot( mapN.xy, mapN.xy ) ) ) );
	#endif
	mapN.xy *= normalScale;
	normal = normalize( tbn * mapN );
#elif defined( USE_BUMPMAP )
	normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );
#endif`,CC=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,RC=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,DC=`#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
	#ifdef USE_TANGENT
		vTangent = normalize( transformedTangent );
		vBitangent = normalize( cross( vNormal, vTangent ) * tangent.w );
		#ifdef FLIP_SIDED
			vBitangent = - vBitangent;
		#endif
	#endif
#endif`,NC=`#ifdef USE_NORMALMAP
	uniform sampler2D normalMap;
	uniform vec2 normalScale;
#endif
#ifdef USE_NORMALMAP_OBJECTSPACE
	uniform mat3 normalMatrix;
#endif
#if ! defined ( USE_TANGENT ) && ( defined ( USE_NORMALMAP_TANGENTSPACE ) || defined ( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY ) )
	mat3 getTangentFrame( vec3 eye_pos, vec3 surf_norm, vec2 uv ) {
		vec3 q0 = dFdx( eye_pos.xyz );
		vec3 q1 = dFdy( eye_pos.xyz );
		vec2 st0 = dFdx( uv.st );
		vec2 st1 = dFdy( uv.st );
		vec3 N = surf_norm;
		vec3 q1perp = cross( q1, N );
		vec3 q0perp = cross( N, q0 );
		vec3 T = q1perp * st0.x + q0perp * st1.x;
		vec3 B = q1perp * st0.y + q0perp * st1.y;
		float det = max( dot( T, T ), dot( B, B ) );
		float scale = ( det == 0.0 ) ? 0.0 : inversesqrt( det );
		return mat3( T * scale, B * scale, N );
	}
#endif`,UC=`#ifdef USE_CLEARCOAT
	vec3 clearcoatNormal = nonPerturbedNormal;
#endif`,LC=`#ifdef USE_CLEARCOAT_NORMALMAP
	vec3 clearcoatMapN = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0;
	clearcoatMapN.xy *= clearcoatNormalScale;
	clearcoatNormal = normalize( tbn2 * clearcoatMapN );
#endif`,OC=`#ifdef USE_CLEARCOATMAP
	uniform sampler2D clearcoatMap;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform sampler2D clearcoatNormalMap;
	uniform vec2 clearcoatNormalScale;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform sampler2D clearcoatRoughnessMap;
#endif`,IC=`#ifdef USE_IRIDESCENCEMAP
	uniform sampler2D iridescenceMap;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform sampler2D iridescenceThicknessMap;
#endif`,PC=`#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
gl_FragColor = vec4( outgoingLight, diffuseColor.a );`,BC=`vec3 packNormalToRGB( const in vec3 normal ) {
	return normalize( normal ) * 0.5 + 0.5;
}
vec3 unpackRGBToNormal( const in vec3 rgb ) {
	return 2.0 * rgb.xyz - 1.0;
}
const float PackUpscale = 256. / 255.;const float UnpackDownscale = 255. / 256.;const float ShiftRight8 = 1. / 256.;
const float Inv255 = 1. / 255.;
const vec4 PackFactors = vec4( 1.0, 256.0, 256.0 * 256.0, 256.0 * 256.0 * 256.0 );
const vec2 UnpackFactors2 = vec2( UnpackDownscale, 1.0 / PackFactors.g );
const vec3 UnpackFactors3 = vec3( UnpackDownscale / PackFactors.rg, 1.0 / PackFactors.b );
const vec4 UnpackFactors4 = vec4( UnpackDownscale / PackFactors.rgb, 1.0 / PackFactors.a );
vec4 packDepthToRGBA( const in float v ) {
	if( v <= 0.0 )
		return vec4( 0., 0., 0., 0. );
	if( v >= 1.0 )
		return vec4( 1., 1., 1., 1. );
	float vuf;
	float af = modf( v * PackFactors.a, vuf );
	float bf = modf( vuf * ShiftRight8, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec4( vuf * Inv255, gf * PackUpscale, bf * PackUpscale, af );
}
vec3 packDepthToRGB( const in float v ) {
	if( v <= 0.0 )
		return vec3( 0., 0., 0. );
	if( v >= 1.0 )
		return vec3( 1., 1., 1. );
	float vuf;
	float bf = modf( v * PackFactors.b, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec3( vuf * Inv255, gf * PackUpscale, bf );
}
vec2 packDepthToRG( const in float v ) {
	if( v <= 0.0 )
		return vec2( 0., 0. );
	if( v >= 1.0 )
		return vec2( 1., 1. );
	float vuf;
	float gf = modf( v * 256., vuf );
	return vec2( vuf * Inv255, gf );
}
float unpackRGBAToDepth( const in vec4 v ) {
	return dot( v, UnpackFactors4 );
}
float unpackRGBToDepth( const in vec3 v ) {
	return dot( v, UnpackFactors3 );
}
float unpackRGToDepth( const in vec2 v ) {
	return v.r * UnpackFactors2.r + v.g * UnpackFactors2.g;
}
vec4 pack2HalfToRGBA( const in vec2 v ) {
	vec4 r = vec4( v.x, fract( v.x * 255.0 ), v.y, fract( v.y * 255.0 ) );
	return vec4( r.x - r.y / 255.0, r.y, r.z - r.w / 255.0, r.w );
}
vec2 unpackRGBATo2Half( const in vec4 v ) {
	return vec2( v.x + ( v.y / 255.0 ), v.z + ( v.w / 255.0 ) );
}
float viewZToOrthographicDepth( const in float viewZ, const in float near, const in float far ) {
	return ( viewZ + near ) / ( near - far );
}
float orthographicDepthToViewZ( const in float depth, const in float near, const in float far ) {
	#ifdef USE_REVERSED_DEPTH_BUFFER
	
		return depth * ( far - near ) - far;
	#else
		return depth * ( near - far ) - near;
	#endif
}
float viewZToPerspectiveDepth( const in float viewZ, const in float near, const in float far ) {
	return ( ( near + viewZ ) * far ) / ( ( far - near ) * viewZ );
}
float perspectiveDepthToViewZ( const in float depth, const in float near, const in float far ) {
	
	#ifdef USE_REVERSED_DEPTH_BUFFER
		return ( near * far ) / ( ( near - far ) * depth - near );
	#else
		return ( near * far ) / ( ( far - near ) * depth - far );
	#endif
}`,zC=`#ifdef PREMULTIPLIED_ALPHA
	gl_FragColor.rgb *= gl_FragColor.a;
#endif`,FC=`vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,HC=`#ifdef DITHERING
	gl_FragColor.rgb = dithering( gl_FragColor.rgb );
#endif`,VC=`#ifdef DITHERING
	vec3 dithering( vec3 color ) {
		float grid_position = rand( gl_FragCoord.xy );
		vec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );
		dither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );
		return color + dither_shift_RGB;
	}
#endif`,GC=`float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
	roughnessFactor *= texelRoughness.g;
#endif`,kC=`#ifdef USE_ROUGHNESSMAP
	uniform sampler2D roughnessMap;
#endif`,XC=`#if NUM_SPOT_LIGHT_COORDS > 0
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#if NUM_SPOT_LIGHT_MAPS > 0
	uniform sampler2D spotLightMap[ NUM_SPOT_LIGHT_MAPS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_SUN_LIGHT_SHADOWS > 0
		#define SUN_LIGHT_CASCADES 2
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform sampler2DShadow sunShadowMap[ NUM_SUN_LIGHT_SHADOWS ];
		#else
			uniform sampler2D sunShadowMap[ NUM_SUN_LIGHT_SHADOWS ];
		#endif
		uniform mat4 sunShadowMatrix[ NUM_SUN_LIGHT_SHADOWS * SUN_LIGHT_CASCADES ];
		uniform vec4 sunShadowCascade[ NUM_SUN_LIGHT_SHADOWS * SUN_LIGHT_CASCADES ];
		varying vec4 vSunShadowWorldPosition;
		varying vec3 vSunShadowWorldNormal;
		struct SunLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SunLightShadow sunLightShadows[ NUM_SUN_LIGHT_SHADOWS ];
	#endif
	#if NUM_DIR_LIGHT_SHADOWS > 0
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform sampler2DShadow directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
		#else
			uniform sampler2D directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
		#endif
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform sampler2DShadow spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];
		#else
			uniform sampler2D spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];
		#endif
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform samplerCubeShadow pointShadowMap[ NUM_POINT_LIGHT_SHADOWS ];
		#elif defined( SHADOWMAP_TYPE_BASIC )
			uniform samplerCube pointShadowMap[ NUM_POINT_LIGHT_SHADOWS ];
		#endif
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
	#if defined( SHADOWMAP_TYPE_PCF )
		float interleavedGradientNoise( vec2 position ) {
			return fract( 52.9829189 * fract( dot( position, vec2( 0.06711056, 0.00583715 ) ) ) );
		}
		vec2 vogelDiskSample( int sampleIndex, int samplesCount, float phi ) {
			const float goldenAngle = 2.399963229728653;
			float r = sqrt( ( float( sampleIndex ) + 0.5 ) / float( samplesCount ) );
			float theta = float( sampleIndex ) * goldenAngle + phi;
			return vec2( cos( theta ), sin( theta ) ) * r;
		}
	#endif
	#if defined( SHADOWMAP_TYPE_PCF )
		float getShadow( sampler2DShadow shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;
			shadowCoord.z += shadowBias;
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
			if ( frustumTest ) {
				vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
				float radius = shadowRadius * texelSize.x;
				float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;
				shadow = (
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 0, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 1, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 2, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 3, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 4, 5, phi ) * radius, shadowCoord.z ) )
				) * 0.2;
			}
			return mix( 1.0, shadow, shadowIntensity );
		}
	#elif defined( SHADOWMAP_TYPE_VSM )
		float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;
			#ifdef USE_REVERSED_DEPTH_BUFFER
				shadowCoord.z -= shadowBias;
			#else
				shadowCoord.z += shadowBias;
			#endif
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
			if ( frustumTest ) {
				vec2 distribution = texture2D( shadowMap, shadowCoord.xy ).rg;
				float mean = distribution.x;
				float variance = distribution.y * distribution.y;
				#ifdef USE_REVERSED_DEPTH_BUFFER
					float hard_shadow = step( mean, shadowCoord.z );
				#else
					float hard_shadow = step( shadowCoord.z, mean );
				#endif
				
				if ( hard_shadow == 1.0 ) {
					shadow = 1.0;
				} else {
					variance = max( variance, 0.0000001 );
					float d = shadowCoord.z - mean;
					float p_max = variance / ( variance + d * d );
					p_max = clamp( ( p_max - 0.3 ) / 0.65, 0.0, 1.0 );
					shadow = max( hard_shadow, p_max );
				}
			}
			return mix( 1.0, shadow, shadowIntensity );
		}
	#else
		float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;
			#ifdef USE_REVERSED_DEPTH_BUFFER
				shadowCoord.z -= shadowBias;
			#else
				shadowCoord.z += shadowBias;
			#endif
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
			if ( frustumTest ) {
				float depth = texture2D( shadowMap, shadowCoord.xy ).r;
				#ifdef USE_REVERSED_DEPTH_BUFFER
					shadow = step( depth, shadowCoord.z );
				#else
					shadow = step( shadowCoord.z, depth );
				#endif
			}
			return mix( 1.0, shadow, shadowIntensity );
		}
	#endif
	#if NUM_SUN_LIGHT_SHADOWS > 0
		float getSunShadow(
			#if defined( SHADOWMAP_TYPE_PCF )
				sampler2DShadow shadowMap,
			#else
				sampler2D shadowMap,
			#endif
			SunLightShadow sunLightShadow,
			int shadowIndex
		) {
			vec4 shadowWorldPosition = vec4( vSunShadowWorldPosition.xyz + vSunShadowWorldNormal * sunLightShadow.shadowNormalBias, 1.0 );
			float viewDepth = vSunShadowWorldPosition.w;
			int cascadeOffset = shadowIndex * SUN_LIGHT_CASCADES;
			float shadow = 1.0;
			for ( int i = SUN_LIGHT_CASCADES - 1; i >= 0; i -- ) {
				vec4 cascade = sunShadowCascade[ cascadeOffset + i ];
				if ( viewDepth >= cascade.x && viewDepth < cascade.y ) {
					float cascadeShadow = getShadow(
						shadowMap,
						sunLightShadow.shadowMapSize,
						sunLightShadow.shadowIntensity,
						sunLightShadow.shadowBias,
						sunLightShadow.shadowRadius,
						sunShadowMatrix[ cascadeOffset + i ] * shadowWorldPosition
					);
					shadow = mix( cascadeShadow, shadow, smoothstep( cascade.z, cascade.y, viewDepth ) );
				}
			}
			return shadow;
		}
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
	#if defined( SHADOWMAP_TYPE_PCF )
	float getPointShadow( samplerCubeShadow shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {
		float shadow = 1.0;
		vec3 lightToPosition = shadowCoord.xyz;
		vec3 bd3D = normalize( lightToPosition );
		vec3 absVec = abs( lightToPosition );
		float viewSpaceZ = max( max( absVec.x, absVec.y ), absVec.z );
		if ( viewSpaceZ - shadowCameraFar <= 0.0 && viewSpaceZ - shadowCameraNear >= 0.0 ) {
			#ifdef USE_REVERSED_DEPTH_BUFFER
				float dp = ( shadowCameraNear * ( shadowCameraFar - viewSpaceZ ) ) / ( viewSpaceZ * ( shadowCameraFar - shadowCameraNear ) );
				dp -= shadowBias;
			#else
				float dp = ( shadowCameraFar * ( viewSpaceZ - shadowCameraNear ) ) / ( viewSpaceZ * ( shadowCameraFar - shadowCameraNear ) );
				dp += shadowBias;
			#endif
			float texelSize = shadowRadius / shadowMapSize.x;
			vec3 absDir = abs( bd3D );
			vec3 tangent = absDir.x > absDir.z ? vec3( 0.0, 1.0, 0.0 ) : vec3( 1.0, 0.0, 0.0 );
			tangent = normalize( cross( bd3D, tangent ) );
			vec3 bitangent = cross( bd3D, tangent );
			float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;
			vec2 sample0 = vogelDiskSample( 0, 5, phi );
			vec2 sample1 = vogelDiskSample( 1, 5, phi );
			vec2 sample2 = vogelDiskSample( 2, 5, phi );
			vec2 sample3 = vogelDiskSample( 3, 5, phi );
			vec2 sample4 = vogelDiskSample( 4, 5, phi );
			shadow = (
				texture( shadowMap, vec4( bd3D + ( tangent * sample0.x + bitangent * sample0.y ) * texelSize, dp ) ) +
				texture( shadowMap, vec4( bd3D + ( tangent * sample1.x + bitangent * sample1.y ) * texelSize, dp ) ) +
				texture( shadowMap, vec4( bd3D + ( tangent * sample2.x + bitangent * sample2.y ) * texelSize, dp ) ) +
				texture( shadowMap, vec4( bd3D + ( tangent * sample3.x + bitangent * sample3.y ) * texelSize, dp ) ) +
				texture( shadowMap, vec4( bd3D + ( tangent * sample4.x + bitangent * sample4.y ) * texelSize, dp ) )
			) * 0.2;
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
	#elif defined( SHADOWMAP_TYPE_BASIC )
	float getPointShadow( samplerCube shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {
		float shadow = 1.0;
		vec3 lightToPosition = shadowCoord.xyz;
		vec3 absVec = abs( lightToPosition );
		float viewSpaceZ = max( max( absVec.x, absVec.y ), absVec.z );
		if ( viewSpaceZ - shadowCameraFar <= 0.0 && viewSpaceZ - shadowCameraNear >= 0.0 ) {
			float dp = ( shadowCameraFar * ( viewSpaceZ - shadowCameraNear ) ) / ( viewSpaceZ * ( shadowCameraFar - shadowCameraNear ) );
			dp += shadowBias;
			vec3 bd3D = normalize( lightToPosition );
			float depth = textureCube( shadowMap, bd3D ).r;
			#ifdef USE_REVERSED_DEPTH_BUFFER
				depth = 1.0 - depth;
			#endif
			shadow = step( dp, depth );
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
	#endif
	#endif
#endif`,WC=`#if NUM_SPOT_LIGHT_COORDS > 0
	uniform mat4 spotLightMatrix[ NUM_SPOT_LIGHT_COORDS ];
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_SUN_LIGHT_SHADOWS > 0
		varying vec4 vSunShadowWorldPosition;
		varying vec3 vSunShadowWorldNormal;
	#endif
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform mat4 directionalShadowMatrix[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform mat4 pointShadowMatrix[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
#endif`,qC=`#if ( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_SUN_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0 ) ) || ( NUM_SPOT_LIGHT_COORDS > 0 )
	#ifdef HAS_NORMAL
		vec3 shadowWorldNormal = transformNormalByInverseViewMatrix( transformedNormal, viewMatrix );
	#else
		vec3 shadowWorldNormal = vec3( 0.0 );
	#endif
	vec4 shadowWorldPosition;
#endif
#if defined( USE_SHADOWMAP )
	#if NUM_SUN_LIGHT_SHADOWS > 0
		vSunShadowWorldPosition = vec4( worldPosition.xyz, - mvPosition.z );
		vSunShadowWorldNormal = shadowWorldNormal;
	#endif
	#if NUM_DIR_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias, 0 );
			vDirectionalShadowCoord[ i ] = directionalShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * pointLightShadows[ i ].shadowNormalBias, 0 );
			vPointShadowCoord[ i ] = pointShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
#endif
#if NUM_SPOT_LIGHT_COORDS > 0
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_COORDS; i ++ ) {
		shadowWorldPosition = worldPosition;
		#if ( defined( USE_SHADOWMAP ) && UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
			shadowWorldPosition.xyz += shadowWorldNormal * spotLightShadows[ i ].shadowNormalBias;
		#endif
		vSpotLightCoord[ i ] = spotLightMatrix[ i ] * shadowWorldPosition;
	}
	#pragma unroll_loop_end
#endif`,YC=`float getShadowMask() {
	float shadow = 1.0;
	#ifdef USE_SHADOWMAP
	#if NUM_SUN_LIGHT_SHADOWS > 0
	SunLightShadow sunLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SUN_LIGHT_SHADOWS; i ++ ) {
		sunLight = sunLightShadows[ i ];
		shadow *= receiveShadow ? getSunShadow( sunShadowMap[ i ], sunLight, UNROLLED_LOOP_INDEX ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
		directionalLight = directionalLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( directionalShadowMap[ i ], directionalLight.shadowMapSize, directionalLight.shadowIntensity, directionalLight.shadowBias, directionalLight.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_SHADOWS; i ++ ) {
		spotLight = spotLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( spotShadowMap[ i ], spotLight.shadowMapSize, spotLight.shadowIntensity, spotLight.shadowBias, spotLight.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0 && ( defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_BASIC ) )
	PointLightShadow pointLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
		pointLight = pointLightShadows[ i ];
		shadow *= receiveShadow ? getPointShadow( pointShadowMap[ i ], pointLight.shadowMapSize, pointLight.shadowIntensity, pointLight.shadowBias, pointLight.shadowRadius, vPointShadowCoord[ i ], pointLight.shadowCameraNear, pointLight.shadowCameraFar ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#endif
	return shadow;
}`,ZC=`#ifdef USE_SKINNING
	mat4 boneMatX = getBoneMatrix( skinIndex.x );
	mat4 boneMatY = getBoneMatrix( skinIndex.y );
	mat4 boneMatZ = getBoneMatrix( skinIndex.z );
	mat4 boneMatW = getBoneMatrix( skinIndex.w );
#endif`,JC=`#ifdef USE_SKINNING
	uniform mat4 bindMatrix;
	uniform mat4 bindMatrixInverse;
	uniform highp sampler2D boneTexture;
	mat4 getBoneMatrix( const in float i ) {
		int size = textureSize( boneTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( boneTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( boneTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( boneTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( boneTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
#endif`,KC=`#ifdef USE_SKINNING
	vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
	vec4 skinned = vec4( 0.0 );
	skinned += boneMatX * skinVertex * skinWeight.x;
	skinned += boneMatY * skinVertex * skinWeight.y;
	skinned += boneMatZ * skinVertex * skinWeight.z;
	skinned += boneMatW * skinVertex * skinWeight.w;
	transformed = ( bindMatrixInverse * skinned ).xyz;
#endif`,QC=`#ifdef USE_SKINNING
	mat4 skinMatrix = mat4( 0.0 );
	skinMatrix += skinWeight.x * boneMatX;
	skinMatrix += skinWeight.y * boneMatY;
	skinMatrix += skinWeight.z * boneMatZ;
	skinMatrix += skinWeight.w * boneMatW;
	skinMatrix = bindMatrixInverse * skinMatrix * bindMatrix;
	objectNormal = vec4( skinMatrix * vec4( objectNormal, 0.0 ) ).xyz;
	#ifdef USE_TANGENT
		objectTangent = vec4( skinMatrix * vec4( objectTangent, 0.0 ) ).xyz;
	#endif
#endif`,jC=`float specularStrength;
#ifdef USE_SPECULARMAP
	vec4 texelSpecular = texture2D( specularMap, vSpecularMapUv );
	specularStrength = texelSpecular.r;
#else
	specularStrength = 1.0;
#endif`,$C=`#ifdef USE_SPECULARMAP
	uniform sampler2D specularMap;
#endif`,t3=`#if defined( TONE_MAPPING )
	gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif`,e3=`#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
uniform float toneMappingExposure;
vec3 LinearToneMapping( vec3 color ) {
	return saturate( toneMappingExposure * color );
}
vec3 ReinhardToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	return saturate( color / ( vec3( 1.0 ) + color ) );
}
vec3 CineonToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	color = max( vec3( 0.0 ), color - 0.004 );
	return pow( ( color * ( 6.2 * color + 0.5 ) ) / ( color * ( 6.2 * color + 1.7 ) + 0.06 ), vec3( 2.2 ) );
}
vec3 RRTAndODTFit( vec3 v ) {
	vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
	vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
	return a / b;
}
vec3 ACESFilmicToneMapping( vec3 color ) {
	const mat3 ACESInputMat = mat3(
		vec3( 0.59719, 0.07600, 0.02840 ),		vec3( 0.35458, 0.90834, 0.13383 ),
		vec3( 0.04823, 0.01566, 0.83777 )
	);
	const mat3 ACESOutputMat = mat3(
		vec3(  1.60475, -0.10208, -0.00327 ),		vec3( -0.53108,  1.10813, -0.07276 ),
		vec3( -0.07367, -0.00605,  1.07602 )
	);
	color *= toneMappingExposure / 0.6;
	color = ACESInputMat * color;
	color = RRTAndODTFit( color );
	color = ACESOutputMat * color;
	return saturate( color );
}
const mat3 LINEAR_REC2020_TO_LINEAR_SRGB = mat3(
	vec3( 1.6605, - 0.1246, - 0.0182 ),
	vec3( - 0.5876, 1.1329, - 0.1006 ),
	vec3( - 0.0728, - 0.0083, 1.1187 )
);
const mat3 LINEAR_SRGB_TO_LINEAR_REC2020 = mat3(
	vec3( 0.6274, 0.0691, 0.0164 ),
	vec3( 0.3293, 0.9195, 0.0880 ),
	vec3( 0.0433, 0.0113, 0.8956 )
);
vec3 agxDefaultContrastApprox( vec3 x ) {
	vec3 x2 = x * x;
	vec3 x4 = x2 * x2;
	return + 15.5 * x4 * x2
		- 40.14 * x4 * x
		+ 31.96 * x4
		- 6.868 * x2 * x
		+ 0.4298 * x2
		+ 0.1191 * x
		- 0.00232;
}
vec3 AgXToneMapping( vec3 color ) {
	const mat3 AgXInsetMatrix = mat3(
		vec3( 0.856627153315983, 0.137318972929847, 0.11189821299995 ),
		vec3( 0.0951212405381588, 0.761241990602591, 0.0767994186031903 ),
		vec3( 0.0482516061458583, 0.101439036467562, 0.811302368396859 )
	);
	const mat3 AgXOutsetMatrix = mat3(
		vec3( 1.1271005818144368, - 0.1413297634984383, - 0.14132976349843826 ),
		vec3( - 0.11060664309660323, 1.157823702216272, - 0.11060664309660294 ),
		vec3( - 0.016493938717834573, - 0.016493938717834257, 1.2519364065950405 )
	);
	const float AgxMinEv = - 12.47393;	const float AgxMaxEv = 4.026069;
	color *= toneMappingExposure;
	color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
	color = AgXInsetMatrix * color;
	color = max( color, 1e-10 );	color = log2( color );
	color = ( color - AgxMinEv ) / ( AgxMaxEv - AgxMinEv );
	color = clamp( color, 0.0, 1.0 );
	color = agxDefaultContrastApprox( color );
	color = AgXOutsetMatrix * color;
	color = pow( max( vec3( 0.0 ), color ), vec3( 2.2 ) );
	color = LINEAR_REC2020_TO_LINEAR_SRGB * color;
	color = clamp( color, 0.0, 1.0 );
	return color;
}
vec3 NeutralToneMapping( vec3 color ) {
	const float StartCompression = 0.8 - 0.04;
	const float Desaturation = 0.15;
	color *= toneMappingExposure;
	float x = min( color.r, min( color.g, color.b ) );
	float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
	color -= offset;
	float peak = max( color.r, max( color.g, color.b ) );
	if ( peak < StartCompression ) return color;
	float d = 1. - StartCompression;
	float newPeak = 1. - d * d / ( peak + d - StartCompression );
	color *= newPeak / peak;
	float g = 1. - 1. / ( Desaturation * ( peak - newPeak ) + 1. );
	return mix( color, vec3( newPeak ), g );
}
vec3 CustomToneMapping( vec3 color ) { return color; }`,n3=`#ifdef USE_TRANSMISSION
	material.transmission = transmission;
	material.transmissionAlpha = 1.0;
	material.thickness = thickness;
	material.attenuationDistance = attenuationDistance;
	material.attenuationColor = attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		material.transmission *= texture2D( transmissionMap, vTransmissionMapUv ).r;
	#endif
	#ifdef USE_THICKNESSMAP
		material.thickness *= texture2D( thicknessMap, vThicknessMapUv ).g;
	#endif
	vec3 pos = vWorldPosition;
	vec3 v = normalize( cameraPosition - pos );
	vec3 n = transformNormalByInverseViewMatrix( normal, viewMatrix );
	vec4 transmitted = getIBLVolumeRefraction(
		n, v, material.roughness, material.diffuseContribution, material.specularColorBlended, material.specularF90,
		pos, modelMatrix, viewMatrix, projectionMatrix, material.dispersion, material.ior, material.thickness,
		material.attenuationColor, material.attenuationDistance );
	material.transmissionAlpha = mix( material.transmissionAlpha, transmitted.a, material.transmission );
	totalDiffuse = mix( totalDiffuse, transmitted.rgb, material.transmission );
#endif`,i3=`#ifdef USE_TRANSMISSION
	uniform float transmission;
	uniform float thickness;
	uniform float attenuationDistance;
	uniform vec3 attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		uniform sampler2D transmissionMap;
	#endif
	#ifdef USE_THICKNESSMAP
		uniform sampler2D thicknessMap;
	#endif
	uniform vec2 transmissionSamplerSize;
	uniform sampler2D transmissionSamplerMap;
	uniform mat4 modelMatrix;
	uniform mat4 projectionMatrix;
	varying vec3 vWorldPosition;
	float w0( float a ) {
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - a + 3.0 ) - 3.0 ) + 1.0 );
	}
	float w1( float a ) {
		return ( 1.0 / 6.0 ) * ( a *  a * ( 3.0 * a - 6.0 ) + 4.0 );
	}
	float w2( float a ){
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - 3.0 * a + 3.0 ) + 3.0 ) + 1.0 );
	}
	float w3( float a ) {
		return ( 1.0 / 6.0 ) * ( a * a * a );
	}
	float g0( float a ) {
		return w0( a ) + w1( a );
	}
	float g1( float a ) {
		return w2( a ) + w3( a );
	}
	float h0( float a ) {
		return - 1.0 + w1( a ) / ( w0( a ) + w1( a ) );
	}
	float h1( float a ) {
		return 1.0 + w3( a ) / ( w2( a ) + w3( a ) );
	}
	vec4 bicubic( sampler2D tex, vec2 uv, vec4 texelSize, float lod ) {
		uv = uv * texelSize.zw + 0.5;
		vec2 iuv = floor( uv );
		vec2 fuv = fract( uv );
		float g0x = g0( fuv.x );
		float g1x = g1( fuv.x );
		float h0x = h0( fuv.x );
		float h1x = h1( fuv.x );
		float h0y = h0( fuv.y );
		float h1y = h1( fuv.y );
		vec2 p0 = ( vec2( iuv.x + h0x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p1 = ( vec2( iuv.x + h1x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p2 = ( vec2( iuv.x + h0x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		vec2 p3 = ( vec2( iuv.x + h1x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		return g0( fuv.y ) * ( g0x * textureLod( tex, p0, lod ) + g1x * textureLod( tex, p1, lod ) ) +
			g1( fuv.y ) * ( g0x * textureLod( tex, p2, lod ) + g1x * textureLod( tex, p3, lod ) );
	}
	vec4 textureBicubic( sampler2D sampler, vec2 uv, float lod ) {
		vec2 fLodSize = vec2( textureSize( sampler, int( lod ) ) );
		vec2 cLodSize = vec2( textureSize( sampler, int( lod + 1.0 ) ) );
		vec2 fLodSizeInv = 1.0 / fLodSize;
		vec2 cLodSizeInv = 1.0 / cLodSize;
		vec4 fSample = bicubic( sampler, uv, vec4( fLodSizeInv, fLodSize ), floor( lod ) );
		vec4 cSample = bicubic( sampler, uv, vec4( cLodSizeInv, cLodSize ), ceil( lod ) );
		return mix( fSample, cSample, fract( lod ) );
	}
	vec3 getVolumeTransmissionRay( const in vec3 n, const in vec3 v, const in float thickness, const in float ior, const in mat4 modelMatrix ) {
		vec3 refractionVector = refract( - v, normalize( n ), 1.0 / ior );
		vec3 modelScale;
		modelScale.x = length( vec3( modelMatrix[ 0 ].xyz ) );
		modelScale.y = length( vec3( modelMatrix[ 1 ].xyz ) );
		modelScale.z = length( vec3( modelMatrix[ 2 ].xyz ) );
		return normalize( refractionVector ) * thickness * modelScale;
	}
	float applyIorToRoughness( const in float roughness, const in float ior ) {
		return roughness * clamp( ior * 2.0 - 2.0, 0.0, 1.0 );
	}
	vec4 getTransmissionSample( const in vec2 fragCoord, const in float roughness, const in float ior ) {
		float lod = log2( transmissionSamplerSize.x ) * applyIorToRoughness( roughness, ior );
		return textureBicubic( transmissionSamplerMap, fragCoord.xy, lod );
	}
	vec3 volumeAttenuation( const in float transmissionDistance, const in vec3 attenuationColor, const in float attenuationDistance ) {
		if ( isinf( attenuationDistance ) ) {
			return vec3( 1.0 );
		} else {
			vec3 attenuationCoefficient = -log( attenuationColor ) / attenuationDistance;
			vec3 transmittance = exp( - attenuationCoefficient * transmissionDistance );			return transmittance;
		}
	}
	vec4 getIBLVolumeRefraction( const in vec3 n, const in vec3 v, const in float roughness, const in vec3 diffuseColor,
		const in vec3 specularColor, const in float specularF90, const in vec3 position, const in mat4 modelMatrix,
		const in mat4 viewMatrix, const in mat4 projMatrix, const in float dispersion, const in float ior, const in float thickness,
		const in vec3 attenuationColor, const in float attenuationDistance ) {
		vec4 transmittedLight;
		vec3 transmittance;
		#ifdef USE_DISPERSION
			float halfSpread = ( ior - 1.0 ) * 0.025 * dispersion;
			vec3 iors = vec3( ior - halfSpread, ior, ior + halfSpread );
			for ( int i = 0; i < 3; i ++ ) {
				vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, iors[ i ], modelMatrix );
				vec3 refractedRayExit = position + transmissionRay;
				vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
				vec2 refractionCoords = ndcPos.xy / ndcPos.w;
				refractionCoords += 1.0;
				refractionCoords /= 2.0;
				vec4 transmissionSample = getTransmissionSample( refractionCoords, roughness, iors[ i ] );
				transmittedLight[ i ] = transmissionSample[ i ];
				transmittedLight.a += transmissionSample.a;
				transmittance[ i ] = diffuseColor[ i ] * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance )[ i ];
			}
			transmittedLight.a /= 3.0;
		#else
			vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, ior, modelMatrix );
			vec3 refractedRayExit = position + transmissionRay;
			vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
			vec2 refractionCoords = ndcPos.xy / ndcPos.w;
			refractionCoords += 1.0;
			refractionCoords /= 2.0;
			transmittedLight = getTransmissionSample( refractionCoords, roughness, ior );
			transmittance = diffuseColor * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance );
		#endif
		vec3 attenuatedColor = transmittance * transmittedLight.rgb;
		vec3 F = EnvironmentBRDF( n, v, specularColor, specularF90, roughness );
		float transmittanceFactor = ( transmittance.r + transmittance.g + transmittance.b ) / 3.0;
		return vec4( ( 1.0 - F ) * attenuatedColor, 1.0 - ( 1.0 - transmittedLight.a ) * transmittanceFactor );
	}
#endif`,a3=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_SPECULARMAP
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,s3=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	uniform mat3 mapTransform;
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	uniform mat3 alphaMapTransform;
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	uniform mat3 lightMapTransform;
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	uniform mat3 aoMapTransform;
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	uniform mat3 bumpMapTransform;
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	uniform mat3 normalMapTransform;
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_DISPLACEMENTMAP
	uniform mat3 displacementMapTransform;
	varying vec2 vDisplacementMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	uniform mat3 emissiveMapTransform;
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	uniform mat3 metalnessMapTransform;
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	uniform mat3 roughnessMapTransform;
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	uniform mat3 anisotropyMapTransform;
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	uniform mat3 clearcoatMapTransform;
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform mat3 clearcoatNormalMapTransform;
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform mat3 clearcoatRoughnessMapTransform;
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	uniform mat3 sheenColorMapTransform;
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	uniform mat3 sheenRoughnessMapTransform;
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	uniform mat3 iridescenceMapTransform;
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform mat3 iridescenceThicknessMapTransform;
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SPECULARMAP
	uniform mat3 specularMapTransform;
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	uniform mat3 specularColorMapTransform;
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	uniform mat3 specularIntensityMapTransform;
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,r3=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	vUv = vec3( uv, 1 ).xy;
#endif
#ifdef USE_MAP
	vMapUv = ( mapTransform * vec3( MAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ALPHAMAP
	vAlphaMapUv = ( alphaMapTransform * vec3( ALPHAMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_LIGHTMAP
	vLightMapUv = ( lightMapTransform * vec3( LIGHTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_AOMAP
	vAoMapUv = ( aoMapTransform * vec3( AOMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_BUMPMAP
	vBumpMapUv = ( bumpMapTransform * vec3( BUMPMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_NORMALMAP
	vNormalMapUv = ( normalMapTransform * vec3( NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_DISPLACEMENTMAP
	vDisplacementMapUv = ( displacementMapTransform * vec3( DISPLACEMENTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_EMISSIVEMAP
	vEmissiveMapUv = ( emissiveMapTransform * vec3( EMISSIVEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_METALNESSMAP
	vMetalnessMapUv = ( metalnessMapTransform * vec3( METALNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ROUGHNESSMAP
	vRoughnessMapUv = ( roughnessMapTransform * vec3( ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ANISOTROPYMAP
	vAnisotropyMapUv = ( anisotropyMapTransform * vec3( ANISOTROPYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOATMAP
	vClearcoatMapUv = ( clearcoatMapTransform * vec3( CLEARCOATMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	vClearcoatNormalMapUv = ( clearcoatNormalMapTransform * vec3( CLEARCOAT_NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	vClearcoatRoughnessMapUv = ( clearcoatRoughnessMapTransform * vec3( CLEARCOAT_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCEMAP
	vIridescenceMapUv = ( iridescenceMapTransform * vec3( IRIDESCENCEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	vIridescenceThicknessMapUv = ( iridescenceThicknessMapTransform * vec3( IRIDESCENCE_THICKNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_COLORMAP
	vSheenColorMapUv = ( sheenColorMapTransform * vec3( SHEEN_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	vSheenRoughnessMapUv = ( sheenRoughnessMapTransform * vec3( SHEEN_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULARMAP
	vSpecularMapUv = ( specularMapTransform * vec3( SPECULARMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_COLORMAP
	vSpecularColorMapUv = ( specularColorMapTransform * vec3( SPECULAR_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	vSpecularIntensityMapUv = ( specularIntensityMapTransform * vec3( SPECULAR_INTENSITYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_TRANSMISSIONMAP
	vTransmissionMapUv = ( transmissionMapTransform * vec3( TRANSMISSIONMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_THICKNESSMAP
	vThicknessMapUv = ( thicknessMapTransform * vec3( THICKNESSMAP_UV, 1 ) ).xy;
#endif`,o3=`#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
	vec4 worldPosition = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		worldPosition = batchingMatrix * worldPosition;
	#endif
	#ifdef USE_INSTANCING
		worldPosition = instanceMatrix * worldPosition;
	#endif
	worldPosition = modelMatrix * worldPosition;
#endif`,l3=`varying vec2 vUv;
uniform mat3 uvTransform;
void main() {
	vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	gl_Position = vec4( position.xy, 1.0, 1.0 );
}`,c3=`uniform sampler2D t2D;
uniform float backgroundIntensity;
varying vec2 vUv;
void main() {
	vec4 texColor = texture2D( t2D, vUv );
	#ifdef DECODE_VIDEO_TEXTURE
		texColor = vec4( mix( pow( texColor.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), texColor.rgb * 0.0773993808, vec3( lessThanEqual( texColor.rgb, vec3( 0.04045 ) ) ) ), texColor.w );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,u3=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,f3=`#ifdef ENVMAP_TYPE_CUBE
	uniform samplerCube envMap;
#elif defined( ENVMAP_TYPE_CUBE_UV )
	uniform sampler2D envMap;
#endif
uniform float backgroundBlurriness;
uniform float backgroundIntensity;
uniform mat3 backgroundRotation;
varying vec3 vWorldDirection;
#include <cube_uv_reflection_fragment>
void main() {
	#ifdef ENVMAP_TYPE_CUBE
		vec4 texColor = textureCube( envMap, backgroundRotation * vWorldDirection );
	#elif defined( ENVMAP_TYPE_CUBE_UV )
		vec4 texColor = textureCubeUV( envMap, backgroundRotation * vWorldDirection, backgroundBlurriness );
	#else
		vec4 texColor = vec4( 0.0, 0.0, 0.0, 1.0 );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,h3=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,d3=`uniform samplerCube tCube;
uniform float tFlip;
uniform float opacity;
varying vec3 vWorldDirection;
void main() {
	vec4 texColor = textureCube( tCube, vec3( tFlip * vWorldDirection.x, vWorldDirection.yz ) );
	gl_FragColor = texColor;
	gl_FragColor.a *= opacity;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,p3=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
varying vec2 vHighPrecisionZW;
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vHighPrecisionZW = gl_Position.zw;
}`,m3=`#if DEPTH_PACKING == 3200
	uniform float opacity;
#endif
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
varying vec2 vHighPrecisionZW;
void main() {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#if DEPTH_PACKING == 3200
		diffuseColor.a = opacity;
	#endif
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <logdepthbuf_fragment>
	#ifdef USE_REVERSED_DEPTH_BUFFER
		float fragCoordZ = vHighPrecisionZW[ 0 ] / vHighPrecisionZW[ 1 ];
	#else
		float fragCoordZ = 0.5 * vHighPrecisionZW[ 0 ] / vHighPrecisionZW[ 1 ] + 0.5;
	#endif
	#if DEPTH_PACKING == 3200
		gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );
	#elif DEPTH_PACKING == 3201
		gl_FragColor = packDepthToRGBA( fragCoordZ );
	#elif DEPTH_PACKING == 3202
		gl_FragColor = vec4( packDepthToRGB( fragCoordZ ), 1.0 );
	#elif DEPTH_PACKING == 3203
		gl_FragColor = vec4( packDepthToRG( fragCoordZ ), 0.0, 1.0 );
	#endif
}`,g3=`#define DISTANCE
varying vec3 vWorldPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <worldpos_vertex>
	#include <clipping_planes_vertex>
	vWorldPosition = worldPosition.xyz;
}`,v3=`#define DISTANCE
uniform vec3 referencePosition;
uniform float nearDistance;
uniform float farDistance;
varying vec3 vWorldPosition;
#include <common>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	float dist = length( vWorldPosition - referencePosition );
	dist = ( dist - nearDistance ) / ( farDistance - nearDistance );
	dist = saturate( dist );
	gl_FragColor = vec4( dist, 0.0, 0.0, 1.0 );
}`,_3=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
}`,x3=`uniform sampler2D tEquirect;
varying vec3 vWorldDirection;
#include <common>
void main() {
	vec3 direction = normalize( vWorldDirection );
	vec2 sampleUV = equirectUv( direction );
	gl_FragColor = texture2D( tEquirect, sampleUV );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,y3=`uniform float scale;
attribute float lineDistance;
varying float vLineDistance;
#include <common>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	vLineDistance = scale * lineDistance;
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,S3=`uniform vec3 diffuse;
uniform float opacity;
uniform float dashSize;
uniform float totalSize;
varying float vLineDistance;
#include <common>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	if ( mod( vLineDistance, totalSize ) > dashSize ) {
		discard;
	}
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,M3=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinbase_vertex>
		#include <skinnormal_vertex>
		#include <defaultnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <fog_vertex>
}`,b3=`uniform vec3 diffuse;
uniform float opacity;
#ifndef FLAT_SHADED
	varying vec3 vNormal;
#endif
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		reflectedLight.indirectDiffuse += lightMapTexel.rgb * lightMapIntensity * RECIPROCAL_PI;
	#else
		reflectedLight.indirectDiffuse += vec3( 1.0 );
	#endif
	#include <aomap_fragment>
	reflectedLight.indirectDiffuse *= diffuseColor.rgb;
	vec3 outgoingLight = reflectedLight.indirectDiffuse;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,T3=`#define LAMBERT
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,E3=`#define LAMBERT
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_lambert_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_lambert_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,A3=`#define MATCAP
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <displacementmap_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
	vViewPosition = - mvPosition.xyz;
}`,w3=`#define MATCAP
uniform vec3 diffuse;
uniform float opacity;
uniform sampler2D matcap;
varying vec3 vViewPosition;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	vec3 viewDir = normalize( vViewPosition );
	vec3 x = normalize( vec3( viewDir.z, 0.0, - viewDir.x ) );
	vec3 y = cross( viewDir, x );
	vec2 uv = vec2( dot( x, normal ), dot( y, normal ) ) * 0.495 + 0.5;
	#ifdef USE_MATCAP
		vec4 matcapColor = texture2D( matcap, uv );
	#else
		vec4 matcapColor = vec4( vec3( mix( 0.2, 0.8, uv.y ) ), 1.0 );
	#endif
	vec3 outgoingLight = diffuseColor.rgb * matcapColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,C3=`#define NORMAL
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	vViewPosition = - mvPosition.xyz;
#endif
}`,R3=`#define NORMAL
uniform float opacity;
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <uv_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( 0.0, 0.0, 0.0, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	gl_FragColor = vec4( normalize( normal ) * 0.5 + 0.5, diffuseColor.a );
	#ifdef OPAQUE
		gl_FragColor.a = 1.0;
	#endif
}`,D3=`#define PHONG
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,N3=`#define PHONG
uniform vec3 diffuse;
uniform vec3 emissive;
uniform vec3 specular;
uniform float shininess;
uniform float opacity;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_phong_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_phong_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,U3=`#define STANDARD
varying vec3 vViewPosition;
#ifdef USE_TRANSMISSION
	varying vec3 vWorldPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
#ifdef USE_TRANSMISSION
	vWorldPosition = worldPosition.xyz;
#endif
}`,L3=`#define STANDARD
#ifdef PHYSICAL
	#define IOR
	#define USE_SPECULAR
#endif
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float roughness;
uniform float metalness;
uniform float opacity;
#ifdef IOR
	uniform float ior;
#endif
#ifdef USE_SPECULAR
	uniform float specularIntensity;
	uniform vec3 specularColor;
	#ifdef USE_SPECULAR_COLORMAP
		uniform sampler2D specularColorMap;
	#endif
	#ifdef USE_SPECULAR_INTENSITYMAP
		uniform sampler2D specularIntensityMap;
	#endif
#endif
#ifdef USE_CLEARCOAT
	uniform float clearcoat;
	uniform float clearcoatRoughness;
#endif
#ifdef USE_DISPERSION
	uniform float dispersion;
#endif
#ifdef USE_RETROREFLECTION
	uniform float retroreflectivity;
#endif
#ifdef USE_IRIDESCENCE
	uniform float iridescence;
	uniform float iridescenceIOR;
	uniform float iridescenceThicknessMinimum;
	uniform float iridescenceThicknessMaximum;
#endif
#ifdef USE_SHEEN
	uniform vec3 sheenColor;
	uniform float sheenRoughness;
	#ifdef USE_SHEEN_COLORMAP
		uniform sampler2D sheenColorMap;
	#endif
	#ifdef USE_SHEEN_ROUGHNESSMAP
		uniform sampler2D sheenRoughnessMap;
	#endif
#endif
#ifdef USE_ANISOTROPY
	uniform vec2 anisotropyVector;
	#ifdef USE_ANISOTROPYMAP
		uniform sampler2D anisotropyMap;
	#endif
#endif
varying vec3 vViewPosition;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <iridescence_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_physical_pars_fragment>
#include <transmission_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <clearcoat_pars_fragment>
#include <iridescence_pars_fragment>
#include <roughnessmap_pars_fragment>
#include <metalnessmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <roughnessmap_fragment>
	#include <metalnessmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <clearcoat_normal_fragment_begin>
	#include <clearcoat_normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_physical_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
	vec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
	#include <transmission_fragment>
	vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
	#ifdef USE_SHEEN
 
		outgoingLight = outgoingLight + sheenSpecularDirect + sheenSpecularIndirect;
 
 	#endif
	#ifdef USE_CLEARCOAT
		float dotNVcc = saturate( dot( geometryClearcoatNormal, geometryViewDir ) );
		vec3 Fcc = F_Schlick( material.clearcoatF0, material.clearcoatF90, dotNVcc );
		outgoingLight = outgoingLight * ( 1.0 - material.clearcoat * Fcc ) + ( clearcoatSpecularDirect + clearcoatSpecularIndirect ) * material.clearcoat;
	#endif
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,O3=`#define TOON
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,I3=`#define TOON
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <gradientmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_toon_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_toon_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,P3=`uniform float size;
uniform float scale;
#include <common>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
#ifdef USE_POINTS_UV
	varying vec2 vUv;
	uniform mat3 uvTransform;
#endif
void main() {
	#ifdef USE_POINTS_UV
		vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	#endif
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	gl_PointSize = size;
	#ifdef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) gl_PointSize *= ( scale / - mvPosition.z );
	#endif
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <fog_vertex>
}`,B3=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <color_pars_fragment>
#include <map_particle_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_particle_fragment>
	#include <color_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,z3=`#include <common>
#include <batching_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <shadowmap_pars_vertex>
void main() {
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,F3=`uniform vec3 color;
uniform float opacity;
#include <common>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <logdepthbuf_pars_fragment>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
void main() {
	#include <logdepthbuf_fragment>
	gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,H3=`uniform float rotation;
uniform vec2 center;
#include <common>
#include <uv_pars_vertex>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	vec4 mvPosition = modelViewMatrix[ 3 ];
	vec2 scale = vec2( length( modelMatrix[ 0 ].xyz ), length( modelMatrix[ 1 ].xyz ) );
	#ifndef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) scale *= - mvPosition.z;
	#endif
	vec2 alignedPosition = ( position.xy - ( center - vec2( 0.5 ) ) ) * scale;
	vec2 rotatedPosition;
	rotatedPosition.x = cos( rotation ) * alignedPosition.x - sin( rotation ) * alignedPosition.y;
	rotatedPosition.y = sin( rotation ) * alignedPosition.x + cos( rotation ) * alignedPosition.y;
	mvPosition.xy += rotatedPosition;
	gl_Position = projectionMatrix * mvPosition;
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,V3=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`,Kt={alphahash_fragment:l2,alphahash_pars_fragment:c2,alphamap_fragment:u2,alphamap_pars_fragment:f2,alphatest_fragment:h2,alphatest_pars_fragment:d2,aomap_fragment:p2,aomap_pars_fragment:m2,batching_pars_vertex:g2,batching_vertex:v2,begin_vertex:_2,beginnormal_vertex:x2,bsdfs:y2,iridescence_fragment:S2,bumpmap_pars_fragment:M2,clipping_planes_fragment:b2,clipping_planes_pars_fragment:T2,clipping_planes_pars_vertex:E2,clipping_planes_vertex:A2,color_fragment:w2,color_pars_fragment:C2,color_pars_vertex:R2,color_vertex:D2,common:N2,cube_uv_reflection_fragment:U2,defaultnormal_vertex:L2,displacementmap_pars_vertex:O2,displacementmap_vertex:I2,emissivemap_fragment:P2,emissivemap_pars_fragment:B2,colorspace_fragment:z2,colorspace_pars_fragment:F2,envmap_fragment:H2,envmap_common_pars_fragment:V2,envmap_pars_fragment:G2,envmap_pars_vertex:k2,envmap_physical_pars_fragment:tC,envmap_vertex:X2,fog_vertex:W2,fog_pars_vertex:q2,fog_fragment:Y2,fog_pars_fragment:Z2,gradientmap_pars_fragment:J2,lightmap_pars_fragment:K2,lights_lambert_fragment:Q2,lights_lambert_pars_fragment:j2,lights_pars_begin:$2,lights_toon_fragment:eC,lights_toon_pars_fragment:nC,lights_phong_fragment:iC,lights_phong_pars_fragment:aC,lights_physical_fragment:sC,lights_physical_pars_fragment:rC,lights_fragment_begin:oC,lights_fragment_maps:lC,lights_fragment_end:cC,lightprobes_pars_fragment:uC,logdepthbuf_fragment:fC,logdepthbuf_pars_fragment:hC,logdepthbuf_pars_vertex:dC,logdepthbuf_vertex:pC,map_fragment:mC,map_pars_fragment:gC,map_particle_fragment:vC,map_particle_pars_fragment:_C,metalnessmap_fragment:xC,metalnessmap_pars_fragment:yC,morphinstance_vertex:SC,morphcolor_vertex:MC,morphnormal_vertex:bC,morphtarget_pars_vertex:TC,morphtarget_vertex:EC,normal_fragment_begin:AC,normal_fragment_maps:wC,normal_pars_fragment:CC,normal_pars_vertex:RC,normal_vertex:DC,normalmap_pars_fragment:NC,clearcoat_normal_fragment_begin:UC,clearcoat_normal_fragment_maps:LC,clearcoat_pars_fragment:OC,iridescence_pars_fragment:IC,opaque_fragment:PC,packing:BC,premultiplied_alpha_fragment:zC,project_vertex:FC,dithering_fragment:HC,dithering_pars_fragment:VC,roughnessmap_fragment:GC,roughnessmap_pars_fragment:kC,shadowmap_pars_fragment:XC,shadowmap_pars_vertex:WC,shadowmap_vertex:qC,shadowmask_pars_fragment:YC,skinbase_vertex:ZC,skinning_pars_vertex:JC,skinning_vertex:KC,skinnormal_vertex:QC,specularmap_fragment:jC,specularmap_pars_fragment:$C,tonemapping_fragment:t3,tonemapping_pars_fragment:e3,transmission_fragment:n3,transmission_pars_fragment:i3,uv_pars_fragment:a3,uv_pars_vertex:s3,uv_vertex:r3,worldpos_vertex:o3,background_vert:l3,background_frag:c3,backgroundCube_vert:u3,backgroundCube_frag:f3,cube_vert:h3,cube_frag:d3,depth_vert:p3,depth_frag:m3,distance_vert:g3,distance_frag:v3,equirect_vert:_3,equirect_frag:x3,linedashed_vert:y3,linedashed_frag:S3,meshbasic_vert:M3,meshbasic_frag:b3,meshlambert_vert:T3,meshlambert_frag:E3,meshmatcap_vert:A3,meshmatcap_frag:w3,meshnormal_vert:C3,meshnormal_frag:R3,meshphong_vert:D3,meshphong_frag:N3,meshphysical_vert:U3,meshphysical_frag:L3,meshtoon_vert:O3,meshtoon_frag:I3,points_vert:P3,points_frag:B3,shadow_vert:z3,shadow_frag:F3,sprite_vert:H3,sprite_frag:V3},pt={common:{diffuse:{value:new Zt(16777215)},opacity:{value:1},map:{value:null},mapTransform:{value:new Xt},alphaMap:{value:null},alphaMapTransform:{value:new Xt},alphaTest:{value:0}},specularmap:{specularMap:{value:null},specularMapTransform:{value:new Xt}},envmap:{envMap:{value:null},envMapRotation:{value:new Xt},reflectivity:{value:1},ior:{value:1.5},refractionRatio:{value:.98},dfgLUT:{value:null}},aomap:{aoMap:{value:null},aoMapIntensity:{value:1},aoMapTransform:{value:new Xt}},lightmap:{lightMap:{value:null},lightMapIntensity:{value:1},lightMapTransform:{value:new Xt}},bumpmap:{bumpMap:{value:null},bumpMapTransform:{value:new Xt},bumpScale:{value:1}},normalmap:{normalMap:{value:null},normalMapTransform:{value:new Xt},normalScale:{value:new oe(1,1)}},displacementmap:{displacementMap:{value:null},displacementMapTransform:{value:new Xt},displacementScale:{value:1},displacementBias:{value:0}},emissivemap:{emissiveMap:{value:null},emissiveMapTransform:{value:new Xt}},metalnessmap:{metalnessMap:{value:null},metalnessMapTransform:{value:new Xt}},roughnessmap:{roughnessMap:{value:null},roughnessMapTransform:{value:new Xt}},gradientmap:{gradientMap:{value:null}},fog:{fogDensity:{value:25e-5},fogNear:{value:1},fogFar:{value:2e3},fogColor:{value:new Zt(16777215)}},lights:{ambientLightColor:{value:[]},lightProbe:{value:[]},sunLights:{value:[],properties:{direction:{},color:{}}},sunLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},sunShadowMatrix:{value:[]},sunShadowCascade:{value:[]},directionalLights:{value:[],properties:{direction:{},color:{}}},directionalLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},directionalShadowMatrix:{value:[]},spotLights:{value:[],properties:{color:{},position:{},direction:{},distance:{},coneCos:{},penumbraCos:{},decay:{}}},spotLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},spotLightMap:{value:[]},spotLightMatrix:{value:[]},pointLights:{value:[],properties:{color:{},position:{},decay:{},distance:{}}},pointLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{},shadowCameraNear:{},shadowCameraFar:{}}},pointShadowMatrix:{value:[]},hemisphereLights:{value:[],properties:{direction:{},skyColor:{},groundColor:{}}},rectAreaLights:{value:[],properties:{color:{},position:{},width:{},height:{}}},ltc_1:{value:null},ltc_2:{value:null},probesSH:{value:null},probesMin:{value:new W},probesMax:{value:new W},probesResolution:{value:new W}},points:{diffuse:{value:new Zt(16777215)},opacity:{value:1},size:{value:1},scale:{value:1},map:{value:null},alphaMap:{value:null},alphaMapTransform:{value:new Xt},alphaTest:{value:0},uvTransform:{value:new Xt}},sprite:{diffuse:{value:new Zt(16777215)},opacity:{value:1},center:{value:new oe(.5,.5)},rotation:{value:0},map:{value:null},mapTransform:{value:new Xt},alphaMap:{value:null},alphaMapTransform:{value:new Xt},alphaTest:{value:0}}},fa={basic:{uniforms:Mn([pt.common,pt.specularmap,pt.envmap,pt.aomap,pt.lightmap,pt.fog]),vertexShader:Kt.meshbasic_vert,fragmentShader:Kt.meshbasic_frag},lambert:{uniforms:Mn([pt.common,pt.specularmap,pt.envmap,pt.aomap,pt.lightmap,pt.emissivemap,pt.bumpmap,pt.normalmap,pt.displacementmap,pt.fog,pt.lights,{emissive:{value:new Zt(0)},envMapIntensity:{value:1}}]),vertexShader:Kt.meshlambert_vert,fragmentShader:Kt.meshlambert_frag},phong:{uniforms:Mn([pt.common,pt.specularmap,pt.envmap,pt.aomap,pt.lightmap,pt.emissivemap,pt.bumpmap,pt.normalmap,pt.displacementmap,pt.fog,pt.lights,{emissive:{value:new Zt(0)},specular:{value:new Zt(1118481)},shininess:{value:30},envMapIntensity:{value:1}}]),vertexShader:Kt.meshphong_vert,fragmentShader:Kt.meshphong_frag},standard:{uniforms:Mn([pt.common,pt.envmap,pt.aomap,pt.lightmap,pt.emissivemap,pt.bumpmap,pt.normalmap,pt.displacementmap,pt.roughnessmap,pt.metalnessmap,pt.fog,pt.lights,{emissive:{value:new Zt(0)},roughness:{value:1},metalness:{value:0},envMapIntensity:{value:1}}]),vertexShader:Kt.meshphysical_vert,fragmentShader:Kt.meshphysical_frag},toon:{uniforms:Mn([pt.common,pt.aomap,pt.lightmap,pt.emissivemap,pt.bumpmap,pt.normalmap,pt.displacementmap,pt.gradientmap,pt.fog,pt.lights,{emissive:{value:new Zt(0)}}]),vertexShader:Kt.meshtoon_vert,fragmentShader:Kt.meshtoon_frag},matcap:{uniforms:Mn([pt.common,pt.bumpmap,pt.normalmap,pt.displacementmap,pt.fog,{matcap:{value:null}}]),vertexShader:Kt.meshmatcap_vert,fragmentShader:Kt.meshmatcap_frag},points:{uniforms:Mn([pt.points,pt.fog]),vertexShader:Kt.points_vert,fragmentShader:Kt.points_frag},dashed:{uniforms:Mn([pt.common,pt.fog,{scale:{value:1},dashSize:{value:1},totalSize:{value:2}}]),vertexShader:Kt.linedashed_vert,fragmentShader:Kt.linedashed_frag},depth:{uniforms:Mn([pt.common,pt.displacementmap]),vertexShader:Kt.depth_vert,fragmentShader:Kt.depth_frag},normal:{uniforms:Mn([pt.common,pt.bumpmap,pt.normalmap,pt.displacementmap,{opacity:{value:1}}]),vertexShader:Kt.meshnormal_vert,fragmentShader:Kt.meshnormal_frag},sprite:{uniforms:Mn([pt.sprite,pt.fog]),vertexShader:Kt.sprite_vert,fragmentShader:Kt.sprite_frag},background:{uniforms:{uvTransform:{value:new Xt},t2D:{value:null},backgroundIntensity:{value:1}},vertexShader:Kt.background_vert,fragmentShader:Kt.background_frag},backgroundCube:{uniforms:{envMap:{value:null},backgroundBlurriness:{value:0},backgroundIntensity:{value:1},backgroundRotation:{value:new Xt}},vertexShader:Kt.backgroundCube_vert,fragmentShader:Kt.backgroundCube_frag},cube:{uniforms:{tCube:{value:null},tFlip:{value:-1},opacity:{value:1}},vertexShader:Kt.cube_vert,fragmentShader:Kt.cube_frag},equirect:{uniforms:{tEquirect:{value:null}},vertexShader:Kt.equirect_vert,fragmentShader:Kt.equirect_frag},distance:{uniforms:Mn([pt.common,pt.displacementmap,{referencePosition:{value:new W},nearDistance:{value:1},farDistance:{value:1e3}}]),vertexShader:Kt.distance_vert,fragmentShader:Kt.distance_frag},shadow:{uniforms:Mn([pt.lights,pt.fog,{color:{value:new Zt(0)},opacity:{value:1}}]),vertexShader:Kt.shadow_vert,fragmentShader:Kt.shadow_frag}};fa.physical={uniforms:Mn([fa.standard.uniforms,{clearcoat:{value:0},clearcoatMap:{value:null},clearcoatMapTransform:{value:new Xt},clearcoatNormalMap:{value:null},clearcoatNormalMapTransform:{value:new Xt},clearcoatNormalScale:{value:new oe(1,1)},clearcoatRoughness:{value:0},clearcoatRoughnessMap:{value:null},clearcoatRoughnessMapTransform:{value:new Xt},dispersion:{value:0},retroreflectivity:{value:0},iridescence:{value:0},iridescenceMap:{value:null},iridescenceMapTransform:{value:new Xt},iridescenceIOR:{value:1.3},iridescenceThicknessMinimum:{value:100},iridescenceThicknessMaximum:{value:400},iridescenceThicknessMap:{value:null},iridescenceThicknessMapTransform:{value:new Xt},sheen:{value:0},sheenColor:{value:new Zt(0)},sheenColorMap:{value:null},sheenColorMapTransform:{value:new Xt},sheenRoughness:{value:1},sheenRoughnessMap:{value:null},sheenRoughnessMapTransform:{value:new Xt},transmission:{value:0},transmissionMap:{value:null},transmissionMapTransform:{value:new Xt},transmissionSamplerSize:{value:new oe},transmissionSamplerMap:{value:null},thickness:{value:0},thicknessMap:{value:null},thicknessMapTransform:{value:new Xt},attenuationDistance:{value:0},attenuationColor:{value:new Zt(0)},specularColor:{value:new Zt(1,1,1)},specularColorMap:{value:null},specularColorMapTransform:{value:new Xt},specularIntensity:{value:1},specularIntensityMap:{value:null},specularIntensityMapTransform:{value:new Xt},anisotropyVector:{value:new oe},anisotropyMap:{value:null},anisotropyMapTransform:{value:new Xt}}]),vertexShader:Kt.meshphysical_vert,fragmentShader:Kt.meshphysical_frag};var md={r:0,b:0,g:0},G3=new Xe,mb=new Xt;mb.set(-1,0,0,0,1,0,0,0,1);function k3(e,t,n,i,a,s){let r=new Zt(0),o=a===!0?0:1,l,c,f=null,p=0,u=null;function d(g){let S=g.isScene===!0?g.background:null;if(S&&S.isTexture){let y=g.backgroundBlurriness>0;S=t.get(S,y)}return S}function _(g){let S=!1,y=d(g);y===null?m(r,o):y&&y.isColor&&(m(y,1),S=!0);let T=e.xr.getEnvironmentBlendMode();T==="additive"?n.buffers.color.setClear(0,0,0,1,s):T==="alpha-blend"&&n.buffers.color.setClear(0,0,0,0,s),(e.autoClear||S)&&(n.buffers.depth.setTest(!0),n.buffers.depth.setMask(!0),n.buffers.color.setMask(!0),e.clear(e.autoClearColor,e.autoClearDepth,e.autoClearStencil))}function b(g,S){let y=d(S);y&&(y.isCubeTexture||y.mapping===Sc)?(c===void 0&&(c=new Gn(new Ho(1,1,1),new Rn({name:"BackgroundCubeMaterial",uniforms:vr(fa.backgroundCube.uniforms),vertexShader:fa.backgroundCube.vertexShader,fragmentShader:fa.backgroundCube.fragmentShader,side:Dn,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),c.geometry.deleteAttribute("normal"),c.geometry.deleteAttribute("uv"),c.onBeforeRender=function(T,A,E){this.matrixWorld.copyPosition(E.matrixWorld)},Object.defineProperty(c.material,"envMap",{get:function(){return this.uniforms.envMap.value}}),i.update(c)),c.material.uniforms.envMap.value=y,c.material.uniforms.backgroundBlurriness.value=S.backgroundBlurriness,c.material.uniforms.backgroundIntensity.value=S.backgroundIntensity,c.material.uniforms.backgroundRotation.value.setFromMatrix4(G3.makeRotationFromEuler(S.backgroundRotation)).transpose(),y.isCubeTexture&&y.isRenderTargetTexture===!1&&c.material.uniforms.backgroundRotation.value.premultiply(mb),c.material.toneMapped=se.getTransfer(y.colorSpace)!==ve,(f!==y||p!==y.version||u!==e.toneMapping)&&(c.material.needsUpdate=!0,f=y,p=y.version,u=e.toneMapping),c.layers.enableAll(),g.unshift(c,c.geometry,c.material,0,0,null)):y&&y.isTexture&&(l===void 0&&(l=new Gn(new dr(2,2),new Rn({name:"BackgroundMaterial",uniforms:vr(fa.background.uniforms),vertexShader:fa.background.vertexShader,fragmentShader:fa.background.fragmentShader,side:ws,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),l.geometry.deleteAttribute("normal"),Object.defineProperty(l.material,"map",{get:function(){return this.uniforms.t2D.value}}),i.update(l)),l.material.uniforms.t2D.value=y,l.material.uniforms.backgroundIntensity.value=S.backgroundIntensity,l.material.toneMapped=se.getTransfer(y.colorSpace)!==ve,y.matrixAutoUpdate===!0&&y.updateMatrix(),l.material.uniforms.uvTransform.value.copy(y.matrix),(f!==y||p!==y.version||u!==e.toneMapping)&&(l.material.needsUpdate=!0,f=y,p=y.version,u=e.toneMapping),l.layers.enableAll(),g.unshift(l,l.geometry,l.material,0,0,null))}function m(g,S){g.getRGB(md,Rg(e)),n.buffers.color.setClear(md.r,md.g,md.b,S,s)}function h(){c!==void 0&&(c.geometry.dispose(),c.material.dispose(),c=void 0),l!==void 0&&(l.geometry.dispose(),l.material.dispose(),l=void 0)}return{getClearColor:function(){return r},setClearColor:function(g,S=1){r.set(g),o=S,m(r,o)},getClearAlpha:function(){return o},setClearAlpha:function(g){o=g,m(r,o)},render:_,addToRenderList:b,dispose:h}}function X3(e,t){let n=e.getParameter(e.MAX_VERTEX_ATTRIBS),i={},a=u(null),s=a,r=!1;function o(D,P,F,U,B){let X=!1,Z=p(D,U,F,P);s!==Z&&(s=Z,c(s.object)),X=d(D,U,F,B),X&&_(D,U,F,B),B!==null&&t.update(B,e.ELEMENT_ARRAY_BUFFER),(X||r)&&(r=!1,y(D,P,F,U),B!==null&&e.bindBuffer(e.ELEMENT_ARRAY_BUFFER,t.get(B).buffer))}function l(){return e.createVertexArray()}function c(D){return e.bindVertexArray(D)}function f(D){return e.deleteVertexArray(D)}function p(D,P,F,U){let B=U.wireframe===!0,X=i[P.id];X===void 0&&(X={},i[P.id]=X);let Z=D.isInstancedMesh===!0?D.id:0,$=X[Z];$===void 0&&($={},X[Z]=$);let z=$[F.id];z===void 0&&(z={},$[F.id]=z);let K=z[B];return K===void 0&&(K=u(l()),z[B]=K),K}function u(D){let P=[],F=[],U=[];for(let B=0;B<n;B++)P[B]=0,F[B]=0,U[B]=0;return{geometry:null,program:null,wireframe:!1,newAttributes:P,enabledAttributes:F,attributeDivisors:U,object:D,attributes:{},index:null}}function d(D,P,F,U){let B=s.attributes,X=P.attributes,Z=0,$=F.getAttributes();for(let z in $)if($[z].location>=0){let j=B[z],vt=X[z];if(vt===void 0&&(z==="instanceMatrix"&&D.instanceMatrix&&(vt=D.instanceMatrix),z==="instanceColor"&&D.instanceColor&&(vt=D.instanceColor)),j===void 0||j.attribute!==vt||vt&&j.data!==vt.data)return!0;Z++}return s.attributesNum!==Z||s.index!==U}function _(D,P,F,U){let B={},X=P.attributes,Z=0,$=F.getAttributes();for(let z in $)if($[z].location>=0){let j=X[z];j===void 0&&(z==="instanceMatrix"&&D.instanceMatrix&&(j=D.instanceMatrix),z==="instanceColor"&&D.instanceColor&&(j=D.instanceColor));let vt={};vt.attribute=j,j&&j.data&&(vt.data=j.data),B[z]=vt,Z++}s.attributes=B,s.attributesNum=Z,s.index=U}function b(){let D=s.newAttributes;for(let P=0,F=D.length;P<F;P++)D[P]=0}function m(D){h(D,0)}function h(D,P){let F=s.newAttributes,U=s.enabledAttributes,B=s.attributeDivisors;F[D]=1,U[D]===0&&(e.enableVertexAttribArray(D),U[D]=1),B[D]!==P&&(e.vertexAttribDivisor(D,P),B[D]=P)}function g(){let D=s.newAttributes,P=s.enabledAttributes;for(let F=0,U=P.length;F<U;F++)P[F]!==D[F]&&(e.disableVertexAttribArray(F),P[F]=0)}function S(D,P,F,U,B,X,Z){Z===!0?e.vertexAttribIPointer(D,P,F,B,X):e.vertexAttribPointer(D,P,F,U,B,X)}function y(D,P,F,U){b();let B=U.attributes,X=F.getAttributes(),Z=P.defaultAttributeValues;for(let $ in X){let z=X[$];if(z.location>=0){let K=B[$];if(K===void 0&&($==="instanceMatrix"&&D.instanceMatrix&&(K=D.instanceMatrix),$==="instanceColor"&&D.instanceColor&&(K=D.instanceColor)),K!==void 0){let j=K.normalized,vt=K.itemSize,yt=t.get(K);if(yt===void 0)continue;let $t=yt.buffer,Et=yt.type,Pt=yt.bytesPerElement,k=Et===e.INT||Et===e.UNSIGNED_INT||K.gpuType===Nh;if(K.isInterleavedBufferAttribute){let Y=K.data,lt=Y.stride,xt=K.offset;if(Y.isInstancedInterleavedBuffer){for(let ot=0;ot<z.locationSize;ot++)h(z.location+ot,Y.meshPerAttribute);D.isInstancedMesh!==!0&&U._maxInstanceCount===void 0&&(U._maxInstanceCount=Y.meshPerAttribute*Y.count)}else for(let ot=0;ot<z.locationSize;ot++)m(z.location+ot);e.bindBuffer(e.ARRAY_BUFFER,$t);for(let ot=0;ot<z.locationSize;ot++)S(z.location+ot,vt/z.locationSize,Et,j,lt*Pt,(xt+vt/z.locationSize*ot)*Pt,k)}else{if(K.isInstancedBufferAttribute){for(let Y=0;Y<z.locationSize;Y++)h(z.location+Y,K.meshPerAttribute);D.isInstancedMesh!==!0&&U._maxInstanceCount===void 0&&(U._maxInstanceCount=K.meshPerAttribute*K.count)}else for(let Y=0;Y<z.locationSize;Y++)m(z.location+Y);e.bindBuffer(e.ARRAY_BUFFER,$t);for(let Y=0;Y<z.locationSize;Y++)S(z.location+Y,vt/z.locationSize,Et,j,vt*Pt,vt/z.locationSize*Y*Pt,k)}}else if(Z!==void 0){let j=Z[$];if(j!==void 0)switch(j.length){case 2:e.vertexAttrib2fv(z.location,j);break;case 3:e.vertexAttrib3fv(z.location,j);break;case 4:e.vertexAttrib4fv(z.location,j);break;default:e.vertexAttrib1fv(z.location,j)}}}}g()}function T(){w();for(let D in i){let P=i[D];for(let F in P){let U=P[F];for(let B in U){let X=U[B];for(let Z in X)f(X[Z].object),delete X[Z];delete U[B]}}delete i[D]}}function A(D){if(i[D.id]===void 0)return;let P=i[D.id];for(let F in P){let U=P[F];for(let B in U){let X=U[B];for(let Z in X)f(X[Z].object),delete X[Z];delete U[B]}}delete i[D.id]}function E(D){for(let P in i){let F=i[P];for(let U in F){let B=F[U];if(B[D.id]===void 0)continue;let X=B[D.id];for(let Z in X)f(X[Z].object),delete X[Z];delete B[D.id]}}}function x(D){for(let P in i){let F=i[P],U=D.isInstancedMesh===!0?D.id:0,B=F[U];if(B!==void 0){for(let X in B){let Z=B[X];for(let $ in Z)f(Z[$].object),delete Z[$];delete B[X]}delete F[U],Object.keys(F).length===0&&delete i[P]}}}function w(){R(),r=!0,s!==a&&(s=a,c(s.object))}function R(){a.geometry=null,a.program=null,a.wireframe=!1}return{setup:o,reset:w,resetDefaultState:R,dispose:T,releaseStatesOfGeometry:A,releaseStatesOfObject:x,releaseStatesOfProgram:E,initAttributes:b,enableAttribute:m,disableUnusedAttributes:g}}function W3(e,t,n){let i;function a(l){i=l}function s(l,c){e.drawArrays(i,l,c),n.update(c,i,1)}function r(l,c,f){f!==0&&(e.drawArraysInstanced(i,l,c,f),n.update(c,i,f))}function o(l,c,f){if(f===0)return;t.get("WEBGL_multi_draw").multiDrawArraysWEBGL(i,l,0,c,0,f);let u=0;for(let d=0;d<f;d++)u+=c[d];n.update(u,i,1)}this.setMode=a,this.render=s,this.renderInstances=r,this.renderMultiDraw=o}function q3(e,t,n,i){let a;function s(){if(a!==void 0)return a;if(t.has("EXT_texture_filter_anisotropic")===!0){let E=t.get("EXT_texture_filter_anisotropic");a=e.getParameter(E.MAX_TEXTURE_MAX_ANISOTROPY_EXT)}else a=0;return a}function r(E){return!(E!==yi&&i.convert(E)!==e.getParameter(e.IMPLEMENTATION_COLOR_READ_FORMAT))}function o(E){let x=E===Pi&&(t.has("EXT_color_buffer_half_float")||t.has("EXT_color_buffer_float"));return!(E!==ai&&E!==Ii&&!x&&i.convert(E)!==e.getParameter(e.IMPLEMENTATION_COLOR_READ_TYPE))}function l(E){if(E==="highp"){if(e.getShaderPrecisionFormat(e.VERTEX_SHADER,e.HIGH_FLOAT).precision>0&&e.getShaderPrecisionFormat(e.FRAGMENT_SHADER,e.HIGH_FLOAT).precision>0)return"highp";E="mediump"}return E==="mediump"&&e.getShaderPrecisionFormat(e.VERTEX_SHADER,e.MEDIUM_FLOAT).precision>0&&e.getShaderPrecisionFormat(e.FRAGMENT_SHADER,e.MEDIUM_FLOAT).precision>0?"mediump":"lowp"}let c=n.precision!==void 0?n.precision:"highp",f=l(c);f!==c&&(Ft("WebGLRenderer:",c,"not supported, using",f,"instead."),c=f);let p=n.logarithmicDepthBuffer===!0,u=n.reversedDepthBuffer===!0&&t.has("EXT_clip_control");n.reversedDepthBuffer===!0&&u===!1&&Ft("WebGLRenderer: Unable to use reversed depth buffer due to missing EXT_clip_control extension. Fallback to default depth buffer.");let d=e.getParameter(e.MAX_TEXTURE_IMAGE_UNITS),_=e.getParameter(e.MAX_VERTEX_TEXTURE_IMAGE_UNITS),b=e.getParameter(e.MAX_TEXTURE_SIZE),m=e.getParameter(e.MAX_CUBE_MAP_TEXTURE_SIZE),h=e.getParameter(e.MAX_VERTEX_ATTRIBS),g=e.getParameter(e.MAX_VERTEX_UNIFORM_VECTORS),S=e.getParameter(e.MAX_VARYING_VECTORS),y=e.getParameter(e.MAX_FRAGMENT_UNIFORM_VECTORS),T=e.getParameter(e.MAX_SAMPLES),A=e.getParameter(e.SAMPLES);return{isWebGL2:!0,getMaxAnisotropy:s,getMaxPrecision:l,textureFormatReadable:r,textureTypeReadable:o,precision:c,logarithmicDepthBuffer:p,reversedDepthBuffer:u,maxTextures:d,maxVertexTextures:_,maxTextureSize:b,maxCubemapSize:m,maxAttributes:h,maxVertexUniforms:g,maxVaryings:S,maxFragmentUniforms:y,maxSamples:T,samples:A}}function Y3(e){let t=this,n=null,i=0,a=!1,s=!1,r=new Ni,o=new Xt,l={value:null,needsUpdate:!1};this.uniform=l,this.numPlanes=0,this.numIntersection=0,this.init=function(p,u){let d=p.length!==0||u||i!==0||a;return a=u,i=p.length,d},this.beginShadows=function(){s=!0,f(null)},this.endShadows=function(){s=!1},this.setGlobalState=function(p,u){n=f(p,u,0)},this.setState=function(p,u,d){let _=p.clippingPlanes,b=p.clipIntersection,m=p.clipShadows,h=e.get(p);if(!a||_===null||_.length===0||s&&!m)s?f(null):c();else{let g=s?0:i,S=g*4,y=h.clippingState||null;l.value=y,y=f(_,u,S,d);for(let T=0;T!==S;++T)y[T]=n[T];h.clippingState=y,this.numIntersection=b?this.numPlanes:0,this.numPlanes+=g}};function c(){l.value!==n&&(l.value=n,l.needsUpdate=i>0),t.numPlanes=i,t.numIntersection=0}function f(p,u,d,_){let b=p!==null?p.length:0,m=null;if(b!==0){if(m=l.value,_!==!0||m===null){let h=d+b*4,g=u.matrixWorldInverse;o.getNormalMatrix(g),(m===null||m.length<h)&&(m=new Float32Array(h));for(let S=0,y=d;S!==b;++S,y+=4)r.copy(p[S]).applyMatrix4(g,o),r.normal.toArray(m,y),m[y+3]=r.constant}l.value=m,l.needsUpdate=!0}return t.numPlanes=b,t.numIntersection=0,m}}var Wo=4,Z3=6,J3=20,K3=256,Dc=new pr,YM=new Zt,Lg=null,Og=0,Ig=0,Pg=!1,Q3=new W,_r=new W,vd=class{constructor(t){this._renderer=t,this._pingPongRenderTarget=null,this._lodMax=0,this._cubeSize=0,this._sizeLods=[],this._lodMeshes=[],this._backgroundBox=null,this._cubemapMaterial=null,this._equirectMaterial=null,this._blurMaterial=null,this._ggxMaterial=null}fromScene(t,n=0,i=.1,a=100,s={}){let{size:r=256,position:o=Q3}=s;Lg=this._renderer.getRenderTarget(),Og=this._renderer.getActiveCubeFace(),Ig=this._renderer.getActiveMipmapLevel(),Pg=this._renderer.xr.enabled,this._renderer.xr.enabled=!1,this._setSize(r);let l=this._allocateTargets();return l.depthBuffer=!0,this._sceneToCubeUV(t,i,a,l,o),n>0&&this._blur(l,0,0,n),this._applyPMREM(l),this._cleanup(l),l}fromEquirectangular(t,n=null){return this._fromTexture(t,n)}fromCubemap(t,n=null){return this._fromTexture(t,n)}compileCubemapShader(){this._cubemapMaterial===null&&(this._cubemapMaterial=KM(),this._compileMaterial(this._cubemapMaterial))}compileEquirectangularShader(){this._equirectMaterial===null&&(this._equirectMaterial=JM(),this._compileMaterial(this._equirectMaterial))}dispose(){this._dispose(),this._cubemapMaterial!==null&&this._cubemapMaterial.dispose(),this._equirectMaterial!==null&&this._equirectMaterial.dispose(),this._backgroundBox!==null&&(this._backgroundBox.geometry.dispose(),this._backgroundBox.material.dispose())}_setSize(t){this._lodMax=Math.floor(Math.log2(t)),this._cubeSize=Math.pow(2,this._lodMax)}_dispose(){this._blurMaterial!==null&&this._blurMaterial.dispose(),this._ggxMaterial!==null&&this._ggxMaterial.dispose(),this._pingPongRenderTarget!==null&&this._pingPongRenderTarget.dispose();for(let t=0;t<this._lodMeshes.length;t++)this._lodMeshes[t].geometry.dispose()}_cleanup(t){this._renderer.setRenderTarget(Lg,Og,Ig),this._renderer.xr.enabled=Pg,t.scissorTest=!1,Xo(t,0,0,t.width,t.height)}_fromTexture(t,n){t.mapping===Rs||t.mapping===gr?this._setSize(t.image.length===0?16:t.image[0].width||t.image[0].image.width):this._setSize(t.image.width/4),Lg=this._renderer.getRenderTarget(),Og=this._renderer.getActiveCubeFace(),Ig=this._renderer.getActiveMipmapLevel(),Pg=this._renderer.xr.enabled,this._renderer.xr.enabled=!1;let i=n||this._allocateTargets();return this._textureToCubeUV(t,i),this._applyPMREM(i),this._cleanup(i),i}_allocateTargets(){let t=3*Math.max(this._cubeSize,112),n=4*this._cubeSize,i={magFilter:mn,minFilter:mn,generateMipmaps:!1,type:Pi,format:yi,colorSpace:sc,depthBuffer:!1},a=ZM(t,n,i);if(this._pingPongRenderTarget===null||this._pingPongRenderTarget.width!==t||this._pingPongRenderTarget.height!==n){this._pingPongRenderTarget!==null&&this._dispose(),this._pingPongRenderTarget=ZM(t,n,i);let{_lodMax:s}=this;({lodMeshes:this._lodMeshes,sizeLods:this._sizeLods}=j3(s)),this._blurMaterial=tR(s,t,n),this._ggxMaterial=$3(s,t,n)}return a}_compileMaterial(t){let n=new Gn(new oa,t);this._renderer.compile(n,Dc)}_sceneToCubeUV(t,n,i,a,s){let l=new Fn(90,1,n,i),c=[1,-1,1,1,1,1],f=[1,1,1,-1,-1,-1],p=this._renderer,u=p.autoClear,d=p.toneMapping;p.getClearColor(YM),p.toneMapping=Li,p.autoClear=!1,p.state.buffers.depth.getReversed()&&(p.setRenderTarget(a),p.clearDepth(),p.setRenderTarget(null)),this._backgroundBox===null&&(this._backgroundBox=new Gn(new Ho,new pc({name:"PMREM.Background",side:Dn,depthWrite:!1,depthTest:!1})));let b=this._backgroundBox,m=b.material,h=!1,g=t.background;g?g.isColor&&(m.color.copy(g),t.background=null,h=!0):(m.color.copy(YM),h=!0);for(let S=0;S<6;S++){let y=S%3;y===0?(l.up.set(0,c[S],0),l.position.set(s.x,s.y,s.z),l.lookAt(s.x+f[S],s.y,s.z)):y===1?(l.up.set(0,0,c[S]),l.position.set(s.x,s.y,s.z),l.lookAt(s.x,s.y+f[S],s.z)):(l.up.set(0,c[S],0),l.position.set(s.x,s.y,s.z),l.lookAt(s.x,s.y,s.z+f[S]));let T=this._cubeSize;Xo(a,y*T,S>2?T:0,T,T),p.setRenderTarget(a),h&&p.render(b,l),p.render(t,l)}p.toneMapping=d,p.autoClear=u,t.background=g}_textureToCubeUV(t,n){let i=this._renderer,a=t.mapping===Rs||t.mapping===gr;a?(this._cubemapMaterial===null&&(this._cubemapMaterial=KM()),this._cubemapMaterial.uniforms.flipEnvMap.value=t.isRenderTargetTexture===!1?-1:1):this._equirectMaterial===null&&(this._equirectMaterial=JM());let s=a?this._cubemapMaterial:this._equirectMaterial,r=this._lodMeshes[0];r.material=s;let o=s.uniforms;o.envMap.value=t;let l=this._cubeSize;Xo(n,0,0,3*l,2*l),i.setRenderTarget(n),i.render(r,Dc)}_applyPMREM(t){let n=this._renderer,i=n.autoClear;n.autoClear=!1;let a=this._lodMeshes.length;for(let s=1;s<a;s++)this._applyGGXFilter(t,s-1,s);n.autoClear=i}_applyGGXFilter(t,n,i){let a=this._renderer,s=this._pingPongRenderTarget,r=this._ggxMaterial,o=this._lodMeshes[i];o.material=r;let l=r.uniforms,c=i/(this._lodMeshes.length-1),f=n/(this._lodMeshes.length-1),p=Math.sqrt(c*c-f*f),u=c*1.25,d=p*u,{_lodMax:_}=this,b=this._sizeLods[i],m=3*b*(i>_-Wo?i-_+Wo:0),h=4*(this._cubeSize-b);l.envMap.value=t.texture,l.roughness.value=d,l.mipInt.value=_-n,Xo(s,m,h,3*b,2*b),a.setRenderTarget(s),a.render(o,Dc),l.envMap.value=s.texture,l.roughness.value=0,l.mipInt.value=_-i,Xo(t,m,h,3*b,2*b),a.setRenderTarget(t),a.render(o,Dc)}_blur(t,n,i,a){let s=this._pingPongRenderTarget,r=Math.min(a,Math.PI)/Math.SQRT2;this._blurPass(t,s,n,i,r),this._blurPass(s,t,i,i,r)}_blurPass(t,n,i,a,s){let r=this._renderer,o=this._blurMaterial,l=this._lodMeshes[a];l.material=o;let c=o.uniforms;c.envMap.value=t.texture,c.sigma.value=s,c.mipInt.value=this._lodMax-i;let f=this._sizeLods[a],p=3*f*(a>this._lodMax-Wo?a-this._lodMax+Wo:0),u=4*(this._cubeSize-f);Xo(n,p,u,3*f,2*f),r.setRenderTarget(n),r.render(l,Dc)}};function j3(e){let t=[],n=[],i=e,a=e-Wo+1+Z3;for(let s=0;s<a;s++){let r=Math.pow(2,i);t.push(r);let o=1/(r-2),l=-o,c=1+o,f=[l,l,c,l,c,c,l,l,c,c,l,c],p=6,u=6,d=3,_=new Float32Array(d*u*p),b=new Float32Array(d*u*p);for(let h=0;h<p;h++){let g=h%3*2/3-1,S=h>2?0:-1,y=[g,S,0,g+2/3,S,0,g+2/3,S+1,0,g,S,0,g+2/3,S+1,0,g,S+1,0];_.set(y,d*u*h);for(let T=0;T<u;T++){let A=f[T*2]*2-1,E=f[T*2+1]*2-1;h===0?_r.set(1,E,A):h===1?_r.set(-A,1,-E):h===2?_r.set(-A,E,1):h===3?_r.set(-1,E,-A):h===4?_r.set(-A,-1,E):_r.set(A,E,-1),_r.toArray(b,(h*u+T)*d)}}let m=new oa;m.setAttribute("position",new vi(_,d)),m.setAttribute("outputDirection",new vi(b,d)),n.push(new Gn(m,null)),i>Wo&&i--}return{lodMeshes:n,sizeLods:t}}function ZM(e,t,n){let i=new Vn(e,t,n);return i.texture.mapping=Sc,i.texture.name="PMREM.cubeUv",i.scissorTest=!0,i}function Xo(e,t,n,i,a){e.viewport.set(t,n,i,a),e.scissor.set(t,n,i,a)}function $3(e,t,n){return new Rn({name:"PMREMGGXConvolution",defines:{GGX_SAMPLES:K3,CUBEUV_TEXEL_WIDTH:1/t,CUBEUV_TEXEL_HEIGHT:1/n,CUBEUV_MAX_MIP:`${e}.0`},uniforms:{envMap:{value:null},roughness:{value:0},mipInt:{value:0}},vertexShader:yd(),fragmentShader:`

			precision highp float;
			precision highp int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;
			uniform float roughness;
			uniform float mipInt;

			#define ENVMAP_TYPE_CUBE_UV
			#include <cube_uv_reflection_fragment>

			#define PI 3.14159265359

			// Van der Corput radical inverse
			float radicalInverse_VdC(uint bits) {
				bits = (bits << 16u) | (bits >> 16u);
				bits = ((bits & 0x55555555u) << 1u) | ((bits & 0xAAAAAAAAu) >> 1u);
				bits = ((bits & 0x33333333u) << 2u) | ((bits & 0xCCCCCCCCu) >> 2u);
				bits = ((bits & 0x0F0F0F0Fu) << 4u) | ((bits & 0xF0F0F0F0u) >> 4u);
				bits = ((bits & 0x00FF00FFu) << 8u) | ((bits & 0xFF00FF00u) >> 8u);
				return float(bits) * 2.3283064365386963e-10; // / 0x100000000
			}

			// Hammersley sequence
			vec2 hammersley(uint i, uint N) {
				return vec2(float(i) / float(N), radicalInverse_VdC(i));
			}

			// GGX VNDF importance sampling (Eric Heitz 2018)
			// "Sampling the GGX Distribution of Visible Normals"
			// https://jcgt.org/published/0007/04/01/
			vec3 importanceSampleGGX_VNDF(vec2 Xi, vec3 V, float roughness) {
				float alpha = roughness * roughness;

				// Section 4.1: Orthonormal basis
				vec3 T1 = vec3(1.0, 0.0, 0.0);
				vec3 T2 = cross(V, T1);

				// Section 4.2: Parameterization of projected area
				float r = sqrt(Xi.x);
				float phi = 2.0 * PI * Xi.y;
				float t1 = r * cos(phi);
				float t2 = r * sin(phi);
				float s = 0.5 * (1.0 + V.z);
				t2 = (1.0 - s) * sqrt(1.0 - t1 * t1) + s * t2;

				// Section 4.3: Reprojection onto hemisphere
				vec3 Nh = t1 * T1 + t2 * T2 + sqrt(max(0.0, 1.0 - t1 * t1 - t2 * t2)) * V;

				// Section 3.4: Transform back to ellipsoid configuration
				return normalize(vec3(alpha * Nh.x, alpha * Nh.y, max(0.0, Nh.z)));
			}

			void main() {
				vec3 N = normalize(vOutputDirection);
				vec3 V = N; // Assume view direction equals normal for pre-filtering

				vec3 prefilteredColor = vec3(0.0);
				float totalWeight = 0.0;

				// For very low roughness, just sample the environment directly
				if (roughness < 0.001) {
					gl_FragColor = vec4(bilinearCubeUV(envMap, N, mipInt), 1.0);
					return;
				}

				// Tangent space basis for VNDF sampling
				vec3 up = abs(N.z) < 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
				vec3 tangent = normalize(cross(up, N));
				vec3 bitangent = cross(N, tangent);

				for(uint i = 0u; i < uint(GGX_SAMPLES); i++) {
					vec2 Xi = hammersley(i, uint(GGX_SAMPLES));

					// For PMREM, V = N, so in tangent space V is always (0, 0, 1)
					vec3 H_tangent = importanceSampleGGX_VNDF(Xi, vec3(0.0, 0.0, 1.0), roughness);

					// Transform H back to world space
					vec3 H = normalize(tangent * H_tangent.x + bitangent * H_tangent.y + N * H_tangent.z);
					vec3 L = normalize(2.0 * dot(V, H) * H - V);

					float NdotL = max(dot(N, L), 0.0);

					if(NdotL > 0.0) {
						// Sample environment at fixed mip level
						// VNDF importance sampling handles the distribution filtering
						vec3 sampleColor = bilinearCubeUV(envMap, L, mipInt);

						// Weight by NdotL for the split-sum approximation
						// VNDF PDF naturally accounts for the visible microfacet distribution
						prefilteredColor += sampleColor * NdotL;
						totalWeight += NdotL;
					}
				}

				if (totalWeight > 0.0) {
					prefilteredColor = prefilteredColor / totalWeight;
				}

				gl_FragColor = vec4(prefilteredColor, 1.0);
			}
		`,blending:ca,depthTest:!1,depthWrite:!1})}function tR(e,t,n){return new Rn({name:"SphericalGaussianBlur",defines:{SAMPLES:J3,CUBEUV_TEXEL_WIDTH:1/t,CUBEUV_TEXEL_HEIGHT:1/n,CUBEUV_MAX_MIP:`${e}.0`},uniforms:{envMap:{value:null},sigma:{value:0},mipInt:{value:0}},vertexShader:yd(),fragmentShader:`

			precision highp float;
			precision highp int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;
			uniform float sigma;
			uniform float mipInt;

			#define ENVMAP_TYPE_CUBE_UV
			#include <cube_uv_reflection_fragment>

			#define PI 3.14159265359
			#define GOLDEN_ANGLE 2.39996322973

			void main() {

				if ( sigma == 0.0 ) {

					gl_FragColor = vec4( bilinearCubeUV( envMap, vOutputDirection, mipInt ), 1.0 );
					return;

				}

				vec3 outputDirection = normalize( vOutputDirection );

				vec3 up = abs( outputDirection.z ) < 0.999 ? vec3( 0.0, 0.0, 1.0 ) : vec3( 1.0, 0.0, 0.0 );
				vec3 tangent = normalize( cross( up, outputDirection ) );
				vec3 bitangent = cross( outputDirection, tangent );

				// Truncate the kernel at three standard deviations or at the antipode.
				float thetaMax = min( 3.0 * sigma, PI );
				float truncation = 1.0 - exp( - 0.5 * thetaMax * thetaMax / ( sigma * sigma ) );

				vec3 accumColor = vec3( 0.0 );
				float accumWeight = 0.0;

				for ( int i = 0; i < SAMPLES; i ++ ) {

					// Stratified inverse-CDF sampling of the Gaussian, placed on a golden-angle spiral.
					float stratum = ( float( i ) + 0.5 ) / float( SAMPLES );
					float theta = sigma * sqrt( - 2.0 * log( 1.0 - stratum * truncation ) );
					float phi = float( i ) * GOLDEN_ANGLE;

					vec3 offset = cos( phi ) * tangent + sin( phi ) * bitangent;
					vec3 sampleDirection = cos( theta ) * outputDirection + sin( theta ) * offset;

					// Correct the planar sample density to solid angle.
					float weight = sin( theta ) / theta;

					accumColor += weight * bilinearCubeUV( envMap, sampleDirection, mipInt );
					accumWeight += weight;

				}

				gl_FragColor = vec4( accumColor / accumWeight, 1.0 );

			}
		`,blending:ca,depthTest:!1,depthWrite:!1})}function JM(){return new Rn({name:"EquirectangularToCubeUV",uniforms:{envMap:{value:null}},vertexShader:yd(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;

			#include <common>

			void main() {

				vec3 outputDirection = normalize( vOutputDirection );
				vec2 uv = equirectUv( outputDirection );

				gl_FragColor = vec4( texture2D ( envMap, uv ).rgb, 1.0 );

			}
		`,blending:ca,depthTest:!1,depthWrite:!1})}function KM(){return new Rn({name:"CubemapToCubeUV",uniforms:{envMap:{value:null},flipEnvMap:{value:-1}},vertexShader:yd(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			uniform float flipEnvMap;

			varying vec3 vOutputDirection;

			uniform samplerCube envMap;

			void main() {

				gl_FragColor = textureCube( envMap, vec3( flipEnvMap * vOutputDirection.x, vOutputDirection.yz ) );

			}
		`,blending:ca,depthTest:!1,depthWrite:!1})}function yd(){return`

		precision mediump float;
		precision mediump int;

		attribute vec3 outputDirection;

		varying vec3 vOutputDirection;

		void main() {

			vOutputDirection = outputDirection;
			gl_Position = vec4( position, 1.0 );

		}
	`}var _d=class extends Vn{constructor(t=1,n={}){super(t,t,n),this.isWebGLCubeRenderTarget=!0;let i={width:t,height:t,depth:1},a=[i,i,i,i,i,i];this.texture=new gc(a),this._setTextureOptions(n),this.texture.isRenderTargetTexture=!0}fromEquirectangularTexture(t,n){this.texture.type=n.type,this.texture.colorSpace=n.colorSpace,this.texture.generateMipmaps=n.generateMipmaps,this.texture.minFilter=n.minFilter,this.texture.magFilter=n.magFilter;let i={uniforms:{tEquirect:{value:null}},vertexShader:`

				varying vec3 vWorldDirection;

				vec3 transformDirection( in vec3 dir, in mat4 matrix ) {

					return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );

				}

				void main() {

					vWorldDirection = transformDirection( position, modelMatrix );

					#include <begin_vertex>
					#include <project_vertex>

				}
			`,fragmentShader:`

				uniform sampler2D tEquirect;

				varying vec3 vWorldDirection;

				#include <common>

				void main() {

					vec3 direction = normalize( vWorldDirection );

					vec2 sampleUV = equirectUv( direction );

					gl_FragColor = texture2D( tEquirect, sampleUV );

				}
			`},a=new Ho(5,5,5),s=new Rn({name:"CubemapFromEquirect",uniforms:vr(i.uniforms),vertexShader:i.vertexShader,fragmentShader:i.fragmentShader,side:Dn,blending:ca});s.uniforms.tEquirect.value=n;let r=new Gn(a,s),o=n.minFilter;return n.minFilter===Ds&&(n.minFilter=mn),new Ah(1,10,this).update(t,r),n.minFilter=o,r.geometry.dispose(),r.material.dispose(),this}clear(t,n=!0,i=!0,a=!0){let s=t.getRenderTarget();for(let r=0;r<6;r++)t.setRenderTarget(this,r),t.clear(n,i,a);t.setRenderTarget(s)}};function eR(e){let t=new WeakMap,n=new WeakMap,i=null;function a(u,d=!1){return u==null?null:d?r(u):s(u)}function s(u){if(u&&u.isTexture){let d=u.mapping;if(d===Ch||d===Rh)if(t.has(u)){let _=t.get(u).texture;return o(_,u.mapping)}else{let _=u.image;if(_&&_.height>0){let b=new _d(_.height);return b.fromEquirectangularTexture(e,u),t.set(u,b),u.addEventListener("dispose",c),o(b.texture,u.mapping)}else return null}}return u}function r(u){if(u&&u.isTexture){let d=u.mapping,_=d===Ch||d===Rh,b=d===Rs||d===gr;if(_||b){let m=n.get(u),h=m!==void 0?m.texture.pmremVersion:0;if(u.isRenderTargetTexture&&u.pmremVersion!==h)return i===null&&(i=new vd(e)),m=_?i.fromEquirectangular(u,m):i.fromCubemap(u,m),m.texture.pmremVersion=u.pmremVersion,n.set(u,m),m.texture;if(m!==void 0)return m.texture;{let g=u.image;return _&&g&&g.height>0||b&&g&&l(g)?(i===null&&(i=new vd(e)),m=_?i.fromEquirectangular(u):i.fromCubemap(u),m.texture.pmremVersion=u.pmremVersion,n.set(u,m),u.addEventListener("dispose",f),m.texture):null}}}return u}function o(u,d){return d===Ch?u.mapping=Rs:d===Rh&&(u.mapping=gr),u}function l(u){let d=0,_=6;for(let b=0;b<_;b++)u[b]!==void 0&&d++;return d===_}function c(u){let d=u.target;d.removeEventListener("dispose",c);let _=t.get(d);_!==void 0&&(t.delete(d),_.dispose())}function f(u){let d=u.target;d.removeEventListener("dispose",f);let _=n.get(d);_!==void 0&&(n.delete(d),_.dispose())}function p(){t=new WeakMap,n=new WeakMap,i!==null&&(i.dispose(),i=null)}return{get:a,dispose:p}}function nR(e){let t={};function n(i){if(t[i]!==void 0)return t[i];let a=e.getExtension(i);return t[i]=a,a}return{has:function(i){return n(i)!==null},init:function(){n("EXT_color_buffer_float"),n("WEBGL_clip_cull_distance"),n("OES_texture_float_linear"),n("EXT_color_buffer_half_float"),n("WEBGL_multisampled_render_to_texture"),n("WEBGL_render_shared_exponent")},get:function(i){let a=n(i);return a===null&&fr("WebGLRenderer: "+i+" extension not supported."),a}}}function iR(e,t,n,i){let a={},s=new WeakMap;function r(p){let u=p.target;u.index!==null&&t.remove(u.index);for(let _ in u.attributes)t.remove(u.attributes[_]);u.removeEventListener("dispose",r),delete a[u.id];let d=s.get(u);d&&(t.remove(d),s.delete(u)),i.releaseStatesOfGeometry(u),u.isInstancedBufferGeometry===!0&&delete u._maxInstanceCount,n.memory.geometries--}function o(p,u){return a[u.id]===!0||(u.addEventListener("dispose",r),a[u.id]=!0,n.memory.geometries++),u}function l(p){let u=p.attributes;for(let d in u)t.update(u[d],e.ARRAY_BUFFER)}function c(p){let u=[],d=p.index,_=p.attributes.position,b=0;if(_===void 0)return;if(d!==null){let g=d.array;b=d.version;for(let S=0,y=g.length;S<y;S+=3){let T=g[S+0],A=g[S+1],E=g[S+2];u.push(T,A,A,E,E,T)}}else{let g=_.array;b=_.version;for(let S=0,y=g.length/3-1;S<y;S+=3){let T=S+0,A=S+1,E=S+2;u.push(T,A,A,E,E,T)}}let m=new(_.count>=65535?dc:hc)(u,1);m.version=b;let h=s.get(p);h&&t.remove(h),s.set(p,m)}function f(p){let u=s.get(p);if(u){let d=p.index;d!==null&&u.version<d.version&&c(p)}else c(p);return s.get(p)}return{get:o,update:l,getWireframeAttribute:f}}function aR(e,t,n){let i;function a(p){i=p}let s,r;function o(p){s=p.type,r=p.bytesPerElement}function l(p,u){e.drawElements(i,u,s,p*r),n.update(u,i,1)}function c(p,u,d){d!==0&&(e.drawElementsInstanced(i,u,s,p*r,d),n.update(u,i,d))}function f(p,u,d){if(d===0)return;t.get("WEBGL_multi_draw").multiDrawElementsWEBGL(i,u,0,s,p,0,d);let b=0;for(let m=0;m<d;m++)b+=u[m];n.update(b,i,1)}this.setMode=a,this.setIndex=o,this.render=l,this.renderInstances=c,this.renderMultiDraw=f}function sR(e){let t={geometries:0,textures:0},n={frame:0,calls:0,triangles:0,points:0,lines:0};function i(s,r,o){switch(n.calls++,r){case e.TRIANGLES:n.triangles+=o*(s/3);break;case e.LINES:n.lines+=o*(s/2);break;case e.LINE_STRIP:n.lines+=o*(s-1);break;case e.LINE_LOOP:n.lines+=o*s;break;case e.POINTS:n.points+=o*s;break;default:Vt("WebGLInfo: Unknown draw mode:",r);break}}function a(){n.calls=0,n.triangles=0,n.points=0,n.lines=0}return{memory:t,render:n,programs:null,autoReset:!0,reset:a,update:i}}function rR(e,t,n){let i=new WeakMap,a=new Fe;function s(r,o,l){let c=r.morphTargetInfluences,f=o.morphAttributes.position||o.morphAttributes.normal||o.morphAttributes.color,p=f!==void 0?f.length:0,u=i.get(o);if(u===void 0||u.count!==p){let w=function(){E.dispose(),i.delete(o),o.removeEventListener("dispose",w)};u!==void 0&&u.texture.dispose();let d=o.morphAttributes.position!==void 0,_=o.morphAttributes.normal!==void 0,b=o.morphAttributes.color!==void 0,m=o.morphAttributes.position||[],h=o.morphAttributes.normal||[],g=o.morphAttributes.color||[],S=0;d===!0&&(S=1),_===!0&&(S=2),b===!0&&(S=3);let y=o.attributes.position.count*S,T=1;y>t.maxTextureSize&&(T=Math.ceil(y/t.maxTextureSize),y=t.maxTextureSize);let A=new Float32Array(y*T*4*p),E=new cc(A,y,T,p);E.type=Ii,E.needsUpdate=!0;let x=S*4;for(let R=0;R<p;R++){let D=m[R],P=h[R],F=g[R],U=y*T*4*R;for(let B=0;B<D.count;B++){let X=B*x;d===!0&&(a.fromBufferAttribute(D,B),A[U+X+0]=a.x,A[U+X+1]=a.y,A[U+X+2]=a.z,A[U+X+3]=0),_===!0&&(a.fromBufferAttribute(P,B),A[U+X+4]=a.x,A[U+X+5]=a.y,A[U+X+6]=a.z,A[U+X+7]=0),b===!0&&(a.fromBufferAttribute(F,B),A[U+X+8]=a.x,A[U+X+9]=a.y,A[U+X+10]=a.z,A[U+X+11]=F.itemSize===4?a.w:1)}}u={count:p,texture:E,size:new oe(y,T)},i.set(o,u),o.addEventListener("dispose",w)}if(r.isInstancedMesh===!0&&r.morphTexture!==null)l.getUniforms().setValue(e,"morphTexture",r.morphTexture,n);else{let d=0;for(let b=0;b<c.length;b++)d+=c[b];let _=o.morphTargetsRelative?1:1-d;l.getUniforms().setValue(e,"morphTargetBaseInfluence",_),l.getUniforms().setValue(e,"morphTargetInfluences",c)}l.getUniforms().setValue(e,"morphTargetsTexture",u.texture,n),l.getUniforms().setValue(e,"morphTargetsTextureSize",u.size)}return{update:s}}function oR(e,t,n,i,a){let s=new WeakMap;function r(c){let f=a.render.frame,p=c.geometry,u=t.get(c,p);if(s.get(u)!==f&&(t.update(u),s.set(u,f)),c.isInstancedMesh&&(c.hasEventListener("dispose",l)===!1&&c.addEventListener("dispose",l),s.get(c)!==f&&(n.update(c.instanceMatrix,e.ARRAY_BUFFER),c.instanceColor!==null&&n.update(c.instanceColor,e.ARRAY_BUFFER),s.set(c,f))),c.isSkinnedMesh){let d=c.skeleton;s.get(d)!==f&&(d.update(),s.set(d,f))}return u}function o(){s=new WeakMap}function l(c){let f=c.target;f.removeEventListener("dispose",l),i.releaseStatesOfObject(f),n.remove(f.instanceMatrix),f.instanceColor!==null&&n.remove(f.instanceColor)}return{update:r,dispose:o}}var lR={[fg]:"LINEAR_TONE_MAPPING",[hg]:"REINHARD_TONE_MAPPING",[dg]:"CINEON_TONE_MAPPING",[pg]:"ACES_FILMIC_TONE_MAPPING",[gg]:"AGX_TONE_MAPPING",[vg]:"NEUTRAL_TONE_MAPPING",[mg]:"CUSTOM_TONE_MAPPING"};function cR(e,t,n,i,a,s){let r=new Vn(t,n,{type:e,depthBuffer:a,stencilBuffer:s,samples:i?4:0,storeMultisampledDepthBuffer:!1,storeMultisampledStencilBuffer:!1,resolveDepthBuffer:!1,resolveStencilBuffer:!1}),o=null,l=null,c=new oa;c.setAttribute("position",new _i([-1,3,0,-1,-1,0,3,-1,0],3)),c.setAttribute("uv",new _i([0,2,0,0,2,0],2));let f=new dh({uniforms:{tDiffuse:{value:null}},vertexShader:`
			precision highp float;

			uniform mat4 modelViewMatrix;
			uniform mat4 projectionMatrix;

			attribute vec3 position;
			attribute vec2 uv;

			varying vec2 vUv;

			void main() {
				vUv = uv;
				gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
			}`,fragmentShader:`
			precision highp float;

			uniform sampler2D tDiffuse;

			varying vec2 vUv;

			#include <tonemapping_pars_fragment>
			#include <colorspace_pars_fragment>

			void main() {
				gl_FragColor = texture2D( tDiffuse, vUv );

				#ifdef LINEAR_TONE_MAPPING
					gl_FragColor.rgb = LinearToneMapping( gl_FragColor.rgb );
				#elif defined( REINHARD_TONE_MAPPING )
					gl_FragColor.rgb = ReinhardToneMapping( gl_FragColor.rgb );
				#elif defined( CINEON_TONE_MAPPING )
					gl_FragColor.rgb = CineonToneMapping( gl_FragColor.rgb );
				#elif defined( ACES_FILMIC_TONE_MAPPING )
					gl_FragColor.rgb = ACESFilmicToneMapping( gl_FragColor.rgb );
				#elif defined( AGX_TONE_MAPPING )
					gl_FragColor.rgb = AgXToneMapping( gl_FragColor.rgb );
				#elif defined( NEUTRAL_TONE_MAPPING )
					gl_FragColor.rgb = NeutralToneMapping( gl_FragColor.rgb );
				#elif defined( CUSTOM_TONE_MAPPING )
					gl_FragColor.rgb = CustomToneMapping( gl_FragColor.rgb );
				#endif

				#ifdef SRGB_TRANSFER
					gl_FragColor = sRGBTransferOETF( gl_FragColor );
				#endif
			}`,depthTest:!1,depthWrite:!1}),p=new Gn(c,f),u=new pr(-1,1,1,-1,0,1),d=null,_=null,b=!1,m,h=null,g=[],S=!1;this.setSize=function(y,T){r.setSize(y,T),o!==null&&o.setSize(y,T),l!==null&&l.setSize(y,T);for(let A=0;A<g.length;A++){let E=g[A];E.setSize&&E.setSize(y,T)}},this.setEffects=function(y){g=y,S=g.length>0&&g[0].isRenderPass===!0;let T=r.width,A=r.height;g.length>0&&o===null&&(o=new Vn(T,A,{type:Pi,depthBuffer:!1,stencilBuffer:!1}),l=new Vn(T,A,{type:Pi,depthBuffer:!1,stencilBuffer:!1}));for(let E=0;E<g.length;E++){let x=g[E];x.setSize&&x.setSize(T,A)}},this.begin=function(y,T){if(b||y.toneMapping===Li&&g.length===0)return!1;if(h=T,T!==null){let A=T.width,E=T.height;(r.width!==A||r.height!==E)&&this.setSize(A,E)}return S===!1&&y.setRenderTarget(r),m=y.toneMapping,y.toneMapping=Li,!0},this.hasRenderPass=function(){return S},this.end=function(y,T){y.toneMapping=m,b=!0;let A=r,E=o;for(let x=0;x<g.length;x++){let w=g[x];w.enabled!==!1&&(w.render(y,E,A,T),w.needsSwap!==!1&&(A=E,E=E===o?l:o))}if(d!==y.outputColorSpace||_!==y.toneMapping){d=y.outputColorSpace,_=y.toneMapping,f.defines={},se.getTransfer(d)===ve&&(f.defines.SRGB_TRANSFER="");let x=lR[_];x&&(f.defines[x]=""),f.needsUpdate=!0}f.uniforms.tDiffuse.value=A.texture,y.setRenderTarget(h),y.render(p,u),h=null,b=!1},this.isCompositing=function(){return b},this.dispose=function(){r.dispose(),o!==null&&o.dispose(),l!==null&&l.dispose(),c.dispose(),f.dispose()}}var gb=new Hn,Fg=new bs(1,1),vb=new cc,_b=new ch,xb=new gc,QM=[],jM=[],$M=new Float32Array(16),tb=new Float32Array(9),eb=new Float32Array(4);function Yo(e,t,n){let i=e[0];if(i<=0||i>0)return e;let a=t*n,s=QM[a];if(s===void 0&&(s=new Float32Array(a),QM[a]=s),t!==0){i.toArray(s,0);for(let r=1,o=0;r!==t;++r)o+=n,e[r].toArray(s,o)}return s}function $e(e,t){if(e.length!==t.length)return!1;for(let n=0,i=e.length;n<i;n++)if(e[n]!==t[n])return!1;return!0}function tn(e,t){for(let n=0,i=t.length;n<i;n++)e[n]=t[n]}function Sd(e,t){let n=jM[t];n===void 0&&(n=new Int32Array(t),jM[t]=n);for(let i=0;i!==t;++i)n[i]=e.allocateTextureUnit();return n}function uR(e,t){let n=this.cache;n[0]!==t&&(e.uniform1f(this.addr,t),n[0]=t)}function fR(e,t){let n=this.cache;if(t.x!==void 0)(n[0]!==t.x||n[1]!==t.y)&&(e.uniform2f(this.addr,t.x,t.y),n[0]=t.x,n[1]=t.y);else{if($e(n,t))return;e.uniform2fv(this.addr,t),tn(n,t)}}function hR(e,t){let n=this.cache;if(t.x!==void 0)(n[0]!==t.x||n[1]!==t.y||n[2]!==t.z)&&(e.uniform3f(this.addr,t.x,t.y,t.z),n[0]=t.x,n[1]=t.y,n[2]=t.z);else if(t.r!==void 0)(n[0]!==t.r||n[1]!==t.g||n[2]!==t.b)&&(e.uniform3f(this.addr,t.r,t.g,t.b),n[0]=t.r,n[1]=t.g,n[2]=t.b);else{if($e(n,t))return;e.uniform3fv(this.addr,t),tn(n,t)}}function dR(e,t){let n=this.cache;if(t.x!==void 0)(n[0]!==t.x||n[1]!==t.y||n[2]!==t.z||n[3]!==t.w)&&(e.uniform4f(this.addr,t.x,t.y,t.z,t.w),n[0]=t.x,n[1]=t.y,n[2]=t.z,n[3]=t.w);else{if($e(n,t))return;e.uniform4fv(this.addr,t),tn(n,t)}}function pR(e,t){let n=this.cache,i=t.elements;if(i===void 0){if($e(n,t))return;e.uniformMatrix2fv(this.addr,!1,t),tn(n,t)}else{if($e(n,i))return;eb.set(i),e.uniformMatrix2fv(this.addr,!1,eb),tn(n,i)}}function mR(e,t){let n=this.cache,i=t.elements;if(i===void 0){if($e(n,t))return;e.uniformMatrix3fv(this.addr,!1,t),tn(n,t)}else{if($e(n,i))return;tb.set(i),e.uniformMatrix3fv(this.addr,!1,tb),tn(n,i)}}function gR(e,t){let n=this.cache,i=t.elements;if(i===void 0){if($e(n,t))return;e.uniformMatrix4fv(this.addr,!1,t),tn(n,t)}else{if($e(n,i))return;$M.set(i),e.uniformMatrix4fv(this.addr,!1,$M),tn(n,i)}}function vR(e,t){let n=this.cache;n[0]!==t&&(e.uniform1i(this.addr,t),n[0]=t)}function _R(e,t){let n=this.cache;if(t.x!==void 0)(n[0]!==t.x||n[1]!==t.y)&&(e.uniform2i(this.addr,t.x,t.y),n[0]=t.x,n[1]=t.y);else{if($e(n,t))return;e.uniform2iv(this.addr,t),tn(n,t)}}function xR(e,t){let n=this.cache;if(t.x!==void 0)(n[0]!==t.x||n[1]!==t.y||n[2]!==t.z)&&(e.uniform3i(this.addr,t.x,t.y,t.z),n[0]=t.x,n[1]=t.y,n[2]=t.z);else{if($e(n,t))return;e.uniform3iv(this.addr,t),tn(n,t)}}function yR(e,t){let n=this.cache;if(t.x!==void 0)(n[0]!==t.x||n[1]!==t.y||n[2]!==t.z||n[3]!==t.w)&&(e.uniform4i(this.addr,t.x,t.y,t.z,t.w),n[0]=t.x,n[1]=t.y,n[2]=t.z,n[3]=t.w);else{if($e(n,t))return;e.uniform4iv(this.addr,t),tn(n,t)}}function SR(e,t){let n=this.cache;n[0]!==t&&(e.uniform1ui(this.addr,t),n[0]=t)}function MR(e,t){let n=this.cache;if(t.x!==void 0)(n[0]!==t.x||n[1]!==t.y)&&(e.uniform2ui(this.addr,t.x,t.y),n[0]=t.x,n[1]=t.y);else{if($e(n,t))return;e.uniform2uiv(this.addr,t),tn(n,t)}}function bR(e,t){let n=this.cache;if(t.x!==void 0)(n[0]!==t.x||n[1]!==t.y||n[2]!==t.z)&&(e.uniform3ui(this.addr,t.x,t.y,t.z),n[0]=t.x,n[1]=t.y,n[2]=t.z);else{if($e(n,t))return;e.uniform3uiv(this.addr,t),tn(n,t)}}function TR(e,t){let n=this.cache;if(t.x!==void 0)(n[0]!==t.x||n[1]!==t.y||n[2]!==t.z||n[3]!==t.w)&&(e.uniform4ui(this.addr,t.x,t.y,t.z,t.w),n[0]=t.x,n[1]=t.y,n[2]=t.z,n[3]=t.w);else{if($e(n,t))return;e.uniform4uiv(this.addr,t),tn(n,t)}}function ER(e,t,n){let i=this.cache,a=n.allocateTextureUnit();i[0]!==a&&(e.uniform1i(this.addr,a),i[0]=a);let s;this.type===e.SAMPLER_2D_SHADOW?(Fg.compareFunction=n.isReversedDepthBuffer()?pd:dd,s=Fg):s=gb,n.setTexture2D(t||s,a)}function AR(e,t,n){let i=this.cache,a=n.allocateTextureUnit();i[0]!==a&&(e.uniform1i(this.addr,a),i[0]=a),n.setTexture3D(t||_b,a)}function wR(e,t,n){let i=this.cache,a=n.allocateTextureUnit();i[0]!==a&&(e.uniform1i(this.addr,a),i[0]=a),n.setTextureCube(t||xb,a)}function CR(e,t,n){let i=this.cache,a=n.allocateTextureUnit();i[0]!==a&&(e.uniform1i(this.addr,a),i[0]=a),n.setTexture2DArray(t||vb,a)}function RR(e){switch(e){case 5126:return uR;case 35664:return fR;case 35665:return hR;case 35666:return dR;case 35674:return pR;case 35675:return mR;case 35676:return gR;case 5124:case 35670:return vR;case 35667:case 35671:return _R;case 35668:case 35672:return xR;case 35669:case 35673:return yR;case 5125:return SR;case 36294:return MR;case 36295:return bR;case 36296:return TR;case 35678:case 36198:case 36298:case 36306:case 35682:return ER;case 35679:case 36299:case 36307:return AR;case 35680:case 36300:case 36308:case 36293:return wR;case 36289:case 36303:case 36311:case 36292:return CR}}function DR(e,t){e.uniform1fv(this.addr,t)}function NR(e,t){let n=Yo(t,this.size,2);e.uniform2fv(this.addr,n)}function UR(e,t){let n=Yo(t,this.size,3);e.uniform3fv(this.addr,n)}function LR(e,t){let n=Yo(t,this.size,4);e.uniform4fv(this.addr,n)}function OR(e,t){let n=Yo(t,this.size,4);e.uniformMatrix2fv(this.addr,!1,n)}function IR(e,t){let n=Yo(t,this.size,9);e.uniformMatrix3fv(this.addr,!1,n)}function PR(e,t){let n=Yo(t,this.size,16);e.uniformMatrix4fv(this.addr,!1,n)}function BR(e,t){e.uniform1iv(this.addr,t)}function zR(e,t){e.uniform2iv(this.addr,t)}function FR(e,t){e.uniform3iv(this.addr,t)}function HR(e,t){e.uniform4iv(this.addr,t)}function VR(e,t){e.uniform1uiv(this.addr,t)}function GR(e,t){e.uniform2uiv(this.addr,t)}function kR(e,t){e.uniform3uiv(this.addr,t)}function XR(e,t){e.uniform4uiv(this.addr,t)}function WR(e,t,n){let i=this.cache,a=t.length,s=Sd(n,a);$e(i,s)||(e.uniform1iv(this.addr,s),tn(i,s));let r;this.type===e.SAMPLER_2D_SHADOW?r=Fg:r=gb;for(let o=0;o!==a;++o)n.setTexture2D(t[o]||r,s[o])}function qR(e,t,n){let i=this.cache,a=t.length,s=Sd(n,a);$e(i,s)||(e.uniform1iv(this.addr,s),tn(i,s));for(let r=0;r!==a;++r)n.setTexture3D(t[r]||_b,s[r])}function YR(e,t,n){let i=this.cache,a=t.length,s=Sd(n,a);$e(i,s)||(e.uniform1iv(this.addr,s),tn(i,s));for(let r=0;r!==a;++r)n.setTextureCube(t[r]||xb,s[r])}function ZR(e,t,n){let i=this.cache,a=t.length,s=Sd(n,a);$e(i,s)||(e.uniform1iv(this.addr,s),tn(i,s));for(let r=0;r!==a;++r)n.setTexture2DArray(t[r]||vb,s[r])}function JR(e){switch(e){case 5126:return DR;case 35664:return NR;case 35665:return UR;case 35666:return LR;case 35674:return OR;case 35675:return IR;case 35676:return PR;case 5124:case 35670:return BR;case 35667:case 35671:return zR;case 35668:case 35672:return FR;case 35669:case 35673:return HR;case 5125:return VR;case 36294:return GR;case 36295:return kR;case 36296:return XR;case 35678:case 36198:case 36298:case 36306:case 35682:return WR;case 35679:case 36299:case 36307:return qR;case 35680:case 36300:case 36308:case 36293:return YR;case 36289:case 36303:case 36311:case 36292:return ZR}}var Hg=class{constructor(t,n,i){this.id=t,this.addr=i,this.cache=[],this.type=n.type,this.setValue=RR(n.type)}},Vg=class{constructor(t,n,i){this.id=t,this.addr=i,this.cache=[],this.type=n.type,this.size=n.size,this.setValue=JR(n.type)}},Gg=class{constructor(t){this.id=t,this.seq=[],this.map={}}setValue(t,n,i){let a=this.seq;for(let s=0,r=a.length;s!==r;++s){let o=a[s];o.setValue(t,n[o.id],i)}}},Bg=/(\w+)(\])?(\[|\.)?/g;function nb(e,t){e.seq.push(t),e.map[t.id]=t}function KR(e,t,n){let i=e.name,a=i.length;for(Bg.lastIndex=0;;){let s=Bg.exec(i),r=Bg.lastIndex,o=s[1],l=s[2]==="]",c=s[3];if(l&&(o=o|0),c===void 0||c==="["&&r+2===a){nb(n,c===void 0?new Hg(o,e,t):new Vg(o,e,t));break}else{let p=n.map[o];p===void 0&&(p=new Gg(o),nb(n,p)),n=p}}}var qo=class{constructor(t,n){this.seq=[],this.map={};let i=t.getProgramParameter(n,t.ACTIVE_UNIFORMS);for(let r=0;r<i;++r){let o=t.getActiveUniform(n,r),l=t.getUniformLocation(n,o.name);KR(o,l,this)}let a=[],s=[];for(let r of this.seq)r.type===t.SAMPLER_2D_SHADOW||r.type===t.SAMPLER_CUBE_SHADOW||r.type===t.SAMPLER_2D_ARRAY_SHADOW?a.push(r):s.push(r);a.length>0&&(this.seq=a.concat(s))}setValue(t,n,i,a){let s=this.map[n];s!==void 0&&s.setValue(t,i,a)}setOptional(t,n,i){let a=n[i];a!==void 0&&this.setValue(t,i,a)}static upload(t,n,i,a){for(let s=0,r=n.length;s!==r;++s){let o=n[s],l=i[o.id];l.needsUpdate!==!1&&o.setValue(t,l.value,a)}}static seqWithValue(t,n){let i=[];for(let a=0,s=t.length;a!==s;++a){let r=t[a];r.id in n&&i.push(r)}return i}};function ib(e,t,n){let i=e.createShader(t);return e.shaderSource(i,n),e.compileShader(i),i}var QR=37297,jR=0;function $R(e,t){let n=e.split(`
`),i=[],a=Math.max(t-6,0),s=Math.min(t+6,n.length);for(let r=a;r<s;r++){let o=r+1;i.push(`${o===t?">":" "} ${o}: ${n[r]}`)}return i.join(`
`)}var ab=new Xt;function tD(e){se._getMatrix(ab,se.workingColorSpace,e);let t=`mat3( ${ab.elements.map(n=>n.toFixed(4))} )`;switch(se.getTransfer(e)){case rc:return[t,"LinearTransferOETF"];case ve:return[t,"sRGBTransferOETF"];default:return Ft("WebGLProgram: Unsupported color space: ",e),[t,"LinearTransferOETF"]}}function sb(e,t,n){let i=e.getShaderParameter(t,e.COMPILE_STATUS),s=(e.getShaderInfoLog(t)||"").trim();if(i&&s==="")return"";let r=/ERROR: 0:(\d+)/.exec(s);if(r){let o=parseInt(r[1]);return n.toUpperCase()+`

`+s+`

`+$R(e.getShaderSource(t),o)}else return s}function eD(e,t){let n=tD(t);return[`vec4 ${e}( vec4 value ) {`,`	return ${n[1]}( vec4( value.rgb * ${n[0]}, value.a ) );`,"}"].join(`
`)}var nD={[fg]:"Linear",[hg]:"Reinhard",[dg]:"Cineon",[pg]:"ACESFilmic",[gg]:"AgX",[vg]:"Neutral",[mg]:"Custom"};function iD(e,t){let n=nD[t];return n===void 0?(Ft("WebGLProgram: Unsupported toneMapping:",t),"vec3 "+e+"( vec3 color ) { return LinearToneMapping( color ); }"):"vec3 "+e+"( vec3 color ) { return "+n+"ToneMapping( color ); }"}var gd=new W;function aD(){se.getLuminanceCoefficients(gd);let e=gd.x.toFixed(4),t=gd.y.toFixed(4),n=gd.z.toFixed(4);return["float luminance( const in vec3 rgb ) {",`	const vec3 weights = vec3( ${e}, ${t}, ${n} );`,"	return dot( weights, rgb );","}"].join(`
`)}function sD(e){return[e.extensionClipCullDistance?"#extension GL_ANGLE_clip_cull_distance : require":"",e.extensionMultiDraw?"#extension GL_ANGLE_multi_draw : require":""].filter(Uc).join(`
`)}function rD(e){let t=[];for(let n in e){let i=e[n];i!==!1&&t.push("#define "+n+" "+i)}return t.join(`
`)}function oD(e,t){let n={},i=e.getProgramParameter(t,e.ACTIVE_ATTRIBUTES);for(let a=0;a<i;a++){let s=e.getActiveAttrib(t,a),r=s.name,o=1;s.type===e.FLOAT_MAT2&&(o=2),s.type===e.FLOAT_MAT3&&(o=3),s.type===e.FLOAT_MAT4&&(o=4),n[r]={type:s.type,location:e.getAttribLocation(t,r),locationSize:o}}return n}function Uc(e){return e!==""}function rb(e,t){let n=t.numSpotLightShadows+t.numSpotLightMaps-t.numSpotLightShadowsWithMaps;return e.replace(/NUM_SUN_LIGHTS/g,t.numSunLights).replace(/NUM_DIR_LIGHTS/g,t.numDirLights).replace(/NUM_SPOT_LIGHTS/g,t.numSpotLights).replace(/NUM_SPOT_LIGHT_MAPS/g,t.numSpotLightMaps).replace(/NUM_SPOT_LIGHT_COORDS/g,n).replace(/NUM_RECT_AREA_LIGHTS/g,t.numRectAreaLights).replace(/NUM_POINT_LIGHTS/g,t.numPointLights).replace(/NUM_HEMI_LIGHTS/g,t.numHemiLights).replace(/NUM_SUN_LIGHT_SHADOWS/g,t.numSunLightShadows).replace(/NUM_DIR_LIGHT_SHADOWS/g,t.numDirLightShadows).replace(/NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS/g,t.numSpotLightShadowsWithMaps).replace(/NUM_SPOT_LIGHT_SHADOWS/g,t.numSpotLightShadows).replace(/NUM_POINT_LIGHT_SHADOWS/g,t.numPointLightShadows)}function ob(e,t){return e.replace(/NUM_CLIPPING_PLANES/g,t.numClippingPlanes).replace(/UNION_CLIPPING_PLANES/g,t.numClippingPlanes-t.numClipIntersection)}var lD=/^[ \t]*#include +<([\w\d./]+)>/gm;function kg(e){return e.replace(lD,uD)}var cD=new Map;function uD(e,t){let n=Kt[t];if(n===void 0){let i=cD.get(t);if(i!==void 0)n=Kt[i],Ft('WebGLRenderer: Shader chunk "%s" has been deprecated. Use "%s" instead.',t,i);else throw new Error("THREE.WebGLProgram: Can not resolve #include <"+t+">")}return kg(n)}var fD=/#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;function lb(e){return e.replace(fD,hD)}function hD(e,t,n,i){let a="";for(let s=parseInt(t);s<parseInt(n);s++)a+=i.replace(/\[\s*i\s*\]/g,"[ "+s+" ]").replace(/UNROLLED_LOOP_INDEX/g,s);return a}function cb(e){let t=`precision ${e.precision} float;
	precision ${e.precision} int;
	precision ${e.precision} sampler2D;
	precision ${e.precision} samplerCube;
	precision ${e.precision} sampler3D;
	precision ${e.precision} sampler2DArray;
	precision ${e.precision} sampler2DShadow;
	precision ${e.precision} samplerCubeShadow;
	precision ${e.precision} sampler2DArrayShadow;
	precision ${e.precision} isampler2D;
	precision ${e.precision} isampler3D;
	precision ${e.precision} isamplerCube;
	precision ${e.precision} isampler2DArray;
	precision ${e.precision} usampler2D;
	precision ${e.precision} usampler3D;
	precision ${e.precision} usamplerCube;
	precision ${e.precision} usampler2DArray;
	`;return e.precision==="highp"?t+=`
#define HIGH_PRECISION`:e.precision==="mediump"?t+=`
#define MEDIUM_PRECISION`:e.precision==="lowp"&&(t+=`
#define LOW_PRECISION`),t}var dD={[yc]:"SHADOWMAP_TYPE_PCF",[Vo]:"SHADOWMAP_TYPE_VSM"};function pD(e){return dD[e.shadowMapType]||"SHADOWMAP_TYPE_BASIC"}var mD={[Rs]:"ENVMAP_TYPE_CUBE",[gr]:"ENVMAP_TYPE_CUBE",[Sc]:"ENVMAP_TYPE_CUBE_UV"};function gD(e){return e.envMap===!1?"ENVMAP_TYPE_CUBE":mD[e.envMapMode]||"ENVMAP_TYPE_CUBE"}var vD={[gr]:"ENVMAP_MODE_REFRACTION"};function _D(e){return e.envMap===!1?"ENVMAP_MODE_REFLECTION":vD[e.envMapMode]||"ENVMAP_MODE_REFLECTION"}var xD={[ug]:"ENVMAP_BLENDING_MULTIPLY",[AM]:"ENVMAP_BLENDING_MIX",[wM]:"ENVMAP_BLENDING_ADD"};function yD(e){return e.envMap===!1?"ENVMAP_BLENDING_NONE":xD[e.combine]||"ENVMAP_BLENDING_NONE"}function SD(e){let t=e.envMapCubeUVHeight;if(t===null)return null;let n=Math.log2(t)-2,i=1/t;return{texelWidth:1/(3*Math.max(Math.pow(2,n),112)),texelHeight:i,maxMip:n}}function MD(e,t,n,i){let a=e.getContext(),s=n.defines,r=n.vertexShader,o=n.fragmentShader,l=pD(n),c=gD(n),f=_D(n),p=yD(n),u=SD(n),d=sD(n),_=rD(s),b=a.createProgram(),m,h,g=n.glslVersion?"#version "+n.glslVersion+`
`:"";n.isRawShaderMaterial?(m=["#define SHADER_TYPE "+n.shaderType,"#define SHADER_NAME "+n.shaderName,_].filter(Uc).join(`
`),m.length>0&&(m+=`
`),h=["#define SHADER_TYPE "+n.shaderType,"#define SHADER_NAME "+n.shaderName,_].filter(Uc).join(`
`),h.length>0&&(h+=`
`)):(m=[cb(n),"#define SHADER_TYPE "+n.shaderType,"#define SHADER_NAME "+n.shaderName,_,n.extensionClipCullDistance?"#define USE_CLIP_DISTANCE":"",n.batching?"#define USE_BATCHING":"",n.batchingColor?"#define USE_BATCHING_COLOR":"",n.instancing?"#define USE_INSTANCING":"",n.instancingColor?"#define USE_INSTANCING_COLOR":"",n.instancingMorph?"#define USE_INSTANCING_MORPH":"",n.useFog&&n.fog?"#define USE_FOG":"",n.useFog&&n.fogExp2?"#define FOG_EXP2":"",n.map?"#define USE_MAP":"",n.envMap?"#define USE_ENVMAP":"",n.envMap?"#define "+f:"",n.lightMap?"#define USE_LIGHTMAP":"",n.aoMap?"#define USE_AOMAP":"",n.bumpMap?"#define USE_BUMPMAP":"",n.normalMap?"#define USE_NORMALMAP":"",n.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",n.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",n.displacementMap?"#define USE_DISPLACEMENTMAP":"",n.emissiveMap?"#define USE_EMISSIVEMAP":"",n.anisotropy?"#define USE_ANISOTROPY":"",n.anisotropyMap?"#define USE_ANISOTROPYMAP":"",n.clearcoatMap?"#define USE_CLEARCOATMAP":"",n.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",n.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",n.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",n.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",n.specularMap?"#define USE_SPECULARMAP":"",n.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",n.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",n.roughnessMap?"#define USE_ROUGHNESSMAP":"",n.metalnessMap?"#define USE_METALNESSMAP":"",n.alphaMap?"#define USE_ALPHAMAP":"",n.alphaHash?"#define USE_ALPHAHASH":"",n.transmission?"#define USE_TRANSMISSION":"",n.transmissionMap?"#define USE_TRANSMISSIONMAP":"",n.thicknessMap?"#define USE_THICKNESSMAP":"",n.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",n.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",n.mapUv?"#define MAP_UV "+n.mapUv:"",n.alphaMapUv?"#define ALPHAMAP_UV "+n.alphaMapUv:"",n.lightMapUv?"#define LIGHTMAP_UV "+n.lightMapUv:"",n.aoMapUv?"#define AOMAP_UV "+n.aoMapUv:"",n.emissiveMapUv?"#define EMISSIVEMAP_UV "+n.emissiveMapUv:"",n.bumpMapUv?"#define BUMPMAP_UV "+n.bumpMapUv:"",n.normalMapUv?"#define NORMALMAP_UV "+n.normalMapUv:"",n.displacementMapUv?"#define DISPLACEMENTMAP_UV "+n.displacementMapUv:"",n.metalnessMapUv?"#define METALNESSMAP_UV "+n.metalnessMapUv:"",n.roughnessMapUv?"#define ROUGHNESSMAP_UV "+n.roughnessMapUv:"",n.anisotropyMapUv?"#define ANISOTROPYMAP_UV "+n.anisotropyMapUv:"",n.clearcoatMapUv?"#define CLEARCOATMAP_UV "+n.clearcoatMapUv:"",n.clearcoatNormalMapUv?"#define CLEARCOAT_NORMALMAP_UV "+n.clearcoatNormalMapUv:"",n.clearcoatRoughnessMapUv?"#define CLEARCOAT_ROUGHNESSMAP_UV "+n.clearcoatRoughnessMapUv:"",n.iridescenceMapUv?"#define IRIDESCENCEMAP_UV "+n.iridescenceMapUv:"",n.iridescenceThicknessMapUv?"#define IRIDESCENCE_THICKNESSMAP_UV "+n.iridescenceThicknessMapUv:"",n.sheenColorMapUv?"#define SHEEN_COLORMAP_UV "+n.sheenColorMapUv:"",n.sheenRoughnessMapUv?"#define SHEEN_ROUGHNESSMAP_UV "+n.sheenRoughnessMapUv:"",n.specularMapUv?"#define SPECULARMAP_UV "+n.specularMapUv:"",n.specularColorMapUv?"#define SPECULAR_COLORMAP_UV "+n.specularColorMapUv:"",n.specularIntensityMapUv?"#define SPECULAR_INTENSITYMAP_UV "+n.specularIntensityMapUv:"",n.transmissionMapUv?"#define TRANSMISSIONMAP_UV "+n.transmissionMapUv:"",n.thicknessMapUv?"#define THICKNESSMAP_UV "+n.thicknessMapUv:"",n.vertexTangents&&n.flatShading===!1?"#define USE_TANGENT":"",n.vertexNormals?"#define HAS_NORMAL":"",n.vertexColors?"#define USE_COLOR":"",n.vertexAlphas?"#define USE_COLOR_ALPHA":"",n.vertexUv1s?"#define USE_UV1":"",n.vertexUv2s?"#define USE_UV2":"",n.vertexUv3s?"#define USE_UV3":"",n.pointsUvs?"#define USE_POINTS_UV":"",n.flatShading?"#define FLAT_SHADED":"",n.skinning?"#define USE_SKINNING":"",n.morphTargets?"#define USE_MORPHTARGETS":"",n.morphNormals&&n.flatShading===!1?"#define USE_MORPHNORMALS":"",n.morphColors?"#define USE_MORPHCOLORS":"",n.morphTargetsCount>0?"#define MORPHTARGETS_TEXTURE_STRIDE "+n.morphTextureStride:"",n.morphTargetsCount>0?"#define MORPHTARGETS_COUNT "+n.morphTargetsCount:"",n.doubleSided?"#define DOUBLE_SIDED":"",n.flipSided?"#define FLIP_SIDED":"",n.shadowMapEnabled?"#define USE_SHADOWMAP":"",n.shadowMapEnabled?"#define "+l:"",n.sizeAttenuation?"#define USE_SIZEATTENUATION":"",n.numLightProbes>0?"#define USE_LIGHT_PROBES":"",n.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",n.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 modelMatrix;","uniform mat4 modelViewMatrix;","uniform mat4 projectionMatrix;","uniform mat4 viewMatrix;","uniform mat3 normalMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;","#ifdef USE_INSTANCING","	attribute mat4 instanceMatrix;","#endif","#ifdef USE_INSTANCING_COLOR","	attribute vec3 instanceColor;","#endif","#ifdef USE_INSTANCING_MORPH","	uniform sampler2D morphTexture;","#endif","attribute vec3 position;","attribute vec3 normal;","attribute vec2 uv;","#ifdef USE_UV1","	attribute vec2 uv1;","#endif","#ifdef USE_UV2","	attribute vec2 uv2;","#endif","#ifdef USE_UV3","	attribute vec2 uv3;","#endif","#ifdef USE_TANGENT","	attribute vec4 tangent;","#endif","#if defined( USE_COLOR_ALPHA )","	attribute vec4 color;","#elif defined( USE_COLOR )","	attribute vec3 color;","#endif","#ifdef USE_SKINNING","	attribute vec4 skinIndex;","	attribute vec4 skinWeight;","#endif",`
`].filter(Uc).join(`
`),h=[cb(n),"#define SHADER_TYPE "+n.shaderType,"#define SHADER_NAME "+n.shaderName,_,n.useFog&&n.fog?"#define USE_FOG":"",n.useFog&&n.fogExp2?"#define FOG_EXP2":"",n.alphaToCoverage?"#define ALPHA_TO_COVERAGE":"",n.map?"#define USE_MAP":"",n.matcap?"#define USE_MATCAP":"",n.envMap?"#define USE_ENVMAP":"",n.envMap?"#define "+c:"",n.envMap?"#define "+f:"",n.envMap?"#define "+p:"",u?"#define CUBEUV_TEXEL_WIDTH "+u.texelWidth:"",u?"#define CUBEUV_TEXEL_HEIGHT "+u.texelHeight:"",u?"#define CUBEUV_MAX_MIP "+u.maxMip+".0":"",n.lightMap?"#define USE_LIGHTMAP":"",n.aoMap?"#define USE_AOMAP":"",n.bumpMap?"#define USE_BUMPMAP":"",n.normalMap?"#define USE_NORMALMAP":"",n.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",n.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",n.packedNormalMap?"#define USE_PACKED_NORMALMAP":"",n.emissiveMap?"#define USE_EMISSIVEMAP":"",n.anisotropy?"#define USE_ANISOTROPY":"",n.anisotropyMap?"#define USE_ANISOTROPYMAP":"",n.clearcoat?"#define USE_CLEARCOAT":"",n.clearcoatMap?"#define USE_CLEARCOATMAP":"",n.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",n.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",n.dispersion?"#define USE_DISPERSION":"",n.retroreflection?"#define USE_RETROREFLECTION":"",n.iridescence?"#define USE_IRIDESCENCE":"",n.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",n.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",n.specularMap?"#define USE_SPECULARMAP":"",n.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",n.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",n.roughnessMap?"#define USE_ROUGHNESSMAP":"",n.metalnessMap?"#define USE_METALNESSMAP":"",n.alphaMap?"#define USE_ALPHAMAP":"",n.alphaTest?"#define USE_ALPHATEST":"",n.alphaHash?"#define USE_ALPHAHASH":"",n.sheen?"#define USE_SHEEN":"",n.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",n.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",n.transmission?"#define USE_TRANSMISSION":"",n.transmissionMap?"#define USE_TRANSMISSIONMAP":"",n.thicknessMap?"#define USE_THICKNESSMAP":"",n.vertexTangents&&n.flatShading===!1?"#define USE_TANGENT":"",n.vertexColors||n.instancingColor?"#define USE_COLOR":"",n.vertexAlphas||n.batchingColor?"#define USE_COLOR_ALPHA":"",n.vertexUv1s?"#define USE_UV1":"",n.vertexUv2s?"#define USE_UV2":"",n.vertexUv3s?"#define USE_UV3":"",n.pointsUvs?"#define USE_POINTS_UV":"",n.gradientMap?"#define USE_GRADIENTMAP":"",n.flatShading?"#define FLAT_SHADED":"",n.doubleSided?"#define DOUBLE_SIDED":"",n.flipSided?"#define FLIP_SIDED":"",n.shadowMapEnabled?"#define USE_SHADOWMAP":"",n.shadowMapEnabled?"#define "+l:"",n.premultipliedAlpha?"#define PREMULTIPLIED_ALPHA":"",n.numLightProbes>0?"#define USE_LIGHT_PROBES":"",n.numLightProbeGrids>0?"#define USE_LIGHT_PROBES_GRID":"",n.decodeVideoTexture?"#define DECODE_VIDEO_TEXTURE":"",n.decodeVideoTextureEmissive?"#define DECODE_VIDEO_TEXTURE_EMISSIVE":"",n.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",n.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 viewMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;",n.toneMapping!==Li?"#define TONE_MAPPING":"",n.toneMapping!==Li?Kt.tonemapping_pars_fragment:"",n.toneMapping!==Li?iD("toneMapping",n.toneMapping):"",n.dithering?"#define DITHERING":"",n.opaque?"#define OPAQUE":"",Kt.colorspace_pars_fragment,eD("linearToOutputTexel",n.outputColorSpace),aD(),n.useDepthPacking?"#define DEPTH_PACKING "+n.depthPacking:"",`
`].filter(Uc).join(`
`)),r=kg(r),r=rb(r,n),r=ob(r,n),o=kg(o),o=rb(o,n),o=ob(o,n),r=lb(r),o=lb(o),n.isRawShaderMaterial!==!0&&(g=`#version 300 es
`,m=[d,"#define attribute in","#define varying out","#define texture2D texture"].join(`
`)+`
`+m,h=["#define varying in",n.glslVersion===wg?"":"layout(location = 0) out highp vec4 pc_fragColor;",n.glslVersion===wg?"":"#define gl_FragColor pc_fragColor","#define gl_FragDepthEXT gl_FragDepth","#define texture2D texture","#define textureCube texture","#define texture2DProj textureProj","#define texture2DLodEXT textureLod","#define texture2DProjLodEXT textureProjLod","#define textureCubeLodEXT textureLod","#define texture2DGradEXT textureGrad","#define texture2DProjGradEXT textureProjGrad","#define textureCubeGradEXT textureGrad"].join(`
`)+`
`+h);let S=g+m+r,y=g+h+o,T=ib(a,a.VERTEX_SHADER,S),A=ib(a,a.FRAGMENT_SHADER,y);a.attachShader(b,T),a.attachShader(b,A),n.index0AttributeName!==void 0?a.bindAttribLocation(b,0,n.index0AttributeName):n.hasPositionAttribute===!0&&a.bindAttribLocation(b,0,"position"),a.linkProgram(b);function E(D){if(e.debug.checkShaderErrors){let P=a.getProgramInfoLog(b)||"",F=a.getShaderInfoLog(T)||"",U=a.getShaderInfoLog(A)||"",B=P.trim(),X=F.trim(),Z=U.trim(),$=!0,z=!0;if(a.getProgramParameter(b,a.LINK_STATUS)===!1)if($=!1,typeof e.debug.onShaderError=="function")e.debug.onShaderError(a,b,T,A);else{let K=sb(a,T,"vertex"),j=sb(a,A,"fragment");Vt("WebGLProgram: Shader Error "+a.getError()+" - VALIDATE_STATUS "+a.getProgramParameter(b,a.VALIDATE_STATUS)+`

Material Name: `+D.name+`
Material Type: `+D.type+`

Program Info Log: `+B+`
`+K+`
`+j)}else B!==""?Ft("WebGLProgram: Program Info Log:",B):(X===""||Z==="")&&(z=!1);z&&(D.diagnostics={runnable:$,programLog:B,vertexShader:{log:X,prefix:m},fragmentShader:{log:Z,prefix:h}})}a.deleteShader(T),a.deleteShader(A),x=new qo(a,b),w=oD(a,b)}let x;this.getUniforms=function(){return x===void 0&&E(this),x};let w;this.getAttributes=function(){return w===void 0&&E(this),w};let R=n.rendererExtensionParallelShaderCompile===!1;return this.isReady=function(){return R===!1&&(R=a.getProgramParameter(b,QR)),R},this.destroy=function(){i.releaseStatesOfProgram(this),a.deleteProgram(b),this.program=void 0},this.type=n.shaderType,this.name=n.shaderName,this.id=jR++,this.cacheKey=t,this.usedTimes=1,this.program=b,this.vertexShader=T,this.fragmentShader=A,this}var bD=0,Xg=class{constructor(){this.shaderCache=new Map,this.materialCache=new Map}update(t,n,i){let a=this._getShaderCacheForMaterial(t);return a.has(n)===!1&&(a.add(n),n.usedTimes++),a.has(i)===!1&&(a.add(i),i.usedTimes++),this}remove(t){let n=this.materialCache.get(t);for(let i of n)i.usedTimes--,i.usedTimes===0&&this.shaderCache.delete(i.code);return this.materialCache.delete(t),this}getVertexShaderStage(t){return this._getShaderStage(t.vertexShader)}getFragmentShaderStage(t){return this._getShaderStage(t.fragmentShader)}dispose(){this.shaderCache.clear(),this.materialCache.clear()}_getShaderCacheForMaterial(t){let n=this.materialCache,i=n.get(t);return i===void 0&&(i=new Set,n.set(t,i)),i}_getShaderStage(t){let n=this.shaderCache,i=n.get(t);return i===void 0&&(i=new Wg(t),n.set(t,i)),i}},Wg=class{constructor(t){this.id=bD++,this.code=t,this.usedTimes=0}};function TD(e){return e===Us||e===wc||e===Cc}function ED(e,t,n,i,a,s){let r=new uc,o=new Xg,l=new Set,c=[],f=new Map,p=i.logarithmicDepthBuffer,u=i.precision,d={MeshDepthMaterial:"depth",MeshDistanceMaterial:"distance",MeshNormalMaterial:"normal",MeshBasicMaterial:"basic",MeshLambertMaterial:"lambert",MeshPhongMaterial:"phong",MeshToonMaterial:"toon",MeshStandardMaterial:"physical",MeshPhysicalMaterial:"physical",MeshMatcapMaterial:"matcap",LineBasicMaterial:"basic",LineDashedMaterial:"dashed",PointsMaterial:"points",ShadowMaterial:"shadow",SpriteMaterial:"sprite"};function _(x){return l.add(x),x===0?"uv":`uv${x}`}function b(x,w,R,D,P,F){let U=D.fog,B=P.geometry,X=x.isMeshStandardMaterial||x.isMeshLambertMaterial||x.isMeshPhongMaterial?D.environment:null,Z=x.isMeshStandardMaterial||x.isMeshLambertMaterial&&!x.envMap||x.isMeshPhongMaterial&&!x.envMap,$=t.get(x.envMap||X,Z),z=$&&$.mapping===Sc?$.image.height:null,K=d[x.type];x.precision!==null&&(u=i.getMaxPrecision(x.precision),u!==x.precision&&Ft("WebGLProgram.getParameters:",x.precision,"not supported, using",u,"instead."));let j=B.morphAttributes.position||B.morphAttributes.normal||B.morphAttributes.color,vt=j!==void 0?j.length:0,yt=0;B.morphAttributes.position!==void 0&&(yt=1),B.morphAttributes.normal!==void 0&&(yt=2),B.morphAttributes.color!==void 0&&(yt=3);let $t,Et,Pt,k;if(K){let we=fa[K];$t=we.vertexShader,Et=we.fragmentShader}else{$t=x.vertexShader,Et=x.fragmentShader;let we=o.getVertexShaderStage(x),pe=o.getFragmentShaderStage(x);o.update(x,we,pe),Pt=we.id,k=pe.id}let Y=e.getRenderTarget(),lt=e.state.buffers.depth.getReversed(),xt=P.isInstancedMesh===!0,ot=P.isBatchedMesh===!0,at=!!x.map,Ut=!!x.matcap,Ct=!!$,Bt=!!x.aoMap,Wt=!!x.lightMap,Ot=!!x.bumpMap&&x.wireframe===!1,ie=!!x.normalMap,de=!!x.displacementMap,Be=!!x.emissiveMap,ce=!!x.metalnessMap,be=!!x.roughnessMap,N=x.anisotropy>0,jt=x.clearcoat>0,zt=x.dispersion>0,C=x.retroreflectivity>0,v=x.iridescence>0,I=x.sheen>0,H=x.transmission>0,J=N&&!!x.anisotropyMap,st=jt&&!!x.clearcoatMap,it=jt&&!!x.clearcoatNormalMap,Q=jt&&!!x.clearcoatRoughnessMap,et=v&&!!x.iridescenceMap,ct=v&&!!x.iridescenceThicknessMap,At=I&&!!x.sheenColorMap,ut=I&&!!x.sheenRoughnessMap,ft=!!x.specularMap,Nt=!!x.specularColorMap,It=!!x.specularIntensityMap,qt=H&&!!x.transmissionMap,O=H&&!!x.thicknessMap,ht=!!x.gradientMap,tt=!!x.alphaMap,dt=x.alphaTest>0,_t=!!x.alphaHash,rt=!!x.extensions,Lt=Li;x.toneMapped&&(Y===null||Y.isXRRenderTarget===!0)&&(Lt=e.toneMapping);let wt={shaderID:K,shaderType:x.type,shaderName:x.name,vertexShader:$t,fragmentShader:Et,defines:x.defines,customVertexShaderID:Pt,customFragmentShaderID:k,isRawShaderMaterial:x.isRawShaderMaterial===!0,glslVersion:x.glslVersion,precision:u,batching:ot,batchingColor:ot&&P._colorsTexture!==null,instancing:xt,instancingColor:xt&&P.instanceColor!==null,instancingMorph:xt&&P.morphTexture!==null,outputColorSpace:Y===null?e.outputColorSpace:Y.isXRRenderTarget===!0?Y.texture.colorSpace:se.workingColorSpace,alphaToCoverage:!!x.alphaToCoverage,map:at,matcap:Ut,envMap:Ct,envMapMode:Ct&&$.mapping,envMapCubeUVHeight:z,aoMap:Bt,lightMap:Wt,bumpMap:Ot,normalMap:ie,displacementMap:de,emissiveMap:Be,normalMapObjectSpace:ie&&x.normalMapType===DM,normalMapTangentSpace:ie&&x.normalMapType===Ag,packedNormalMap:ie&&x.normalMapType===Ag&&TD(x.normalMap.format),metalnessMap:ce,roughnessMap:be,anisotropy:N,anisotropyMap:J,clearcoat:jt,clearcoatMap:st,clearcoatNormalMap:it,clearcoatRoughnessMap:Q,dispersion:zt,retroreflection:C,iridescence:v,iridescenceMap:et,iridescenceThicknessMap:ct,sheen:I,sheenColorMap:At,sheenRoughnessMap:ut,specularMap:ft,specularColorMap:Nt,specularIntensityMap:It,transmission:H,transmissionMap:qt,thicknessMap:O,gradientMap:ht,opaque:x.transparent===!1&&x.blending===Cs&&x.alphaToCoverage===!1,alphaMap:tt,alphaTest:dt,alphaHash:_t,combine:x.combine,mapUv:at&&_(x.map.channel),aoMapUv:Bt&&_(x.aoMap.channel),lightMapUv:Wt&&_(x.lightMap.channel),bumpMapUv:Ot&&_(x.bumpMap.channel),normalMapUv:ie&&_(x.normalMap.channel),displacementMapUv:de&&_(x.displacementMap.channel),emissiveMapUv:Be&&_(x.emissiveMap.channel),metalnessMapUv:ce&&_(x.metalnessMap.channel),roughnessMapUv:be&&_(x.roughnessMap.channel),anisotropyMapUv:J&&_(x.anisotropyMap.channel),clearcoatMapUv:st&&_(x.clearcoatMap.channel),clearcoatNormalMapUv:it&&_(x.clearcoatNormalMap.channel),clearcoatRoughnessMapUv:Q&&_(x.clearcoatRoughnessMap.channel),iridescenceMapUv:et&&_(x.iridescenceMap.channel),iridescenceThicknessMapUv:ct&&_(x.iridescenceThicknessMap.channel),sheenColorMapUv:At&&_(x.sheenColorMap.channel),sheenRoughnessMapUv:ut&&_(x.sheenRoughnessMap.channel),specularMapUv:ft&&_(x.specularMap.channel),specularColorMapUv:Nt&&_(x.specularColorMap.channel),specularIntensityMapUv:It&&_(x.specularIntensityMap.channel),transmissionMapUv:qt&&_(x.transmissionMap.channel),thicknessMapUv:O&&_(x.thicknessMap.channel),alphaMapUv:tt&&_(x.alphaMap.channel),vertexTangents:!!B.attributes.tangent&&(ie||N),vertexNormals:!!B.attributes.normal,vertexColors:x.vertexColors,vertexAlphas:x.vertexColors===!0&&!!B.attributes.color&&B.attributes.color.itemSize===4,pointsUvs:P.isPoints===!0&&!!B.attributes.uv&&(at||tt),fog:!!U,useFog:x.fog===!0,fogExp2:!!U&&U.isFogExp2,flatShading:x.wireframe===!1&&(x.flatShading===!0||B.attributes.normal===void 0&&ie===!1&&(x.isMeshLambertMaterial||x.isMeshPhongMaterial||x.isMeshStandardMaterial||x.isMeshPhysicalMaterial)),sizeAttenuation:x.sizeAttenuation===!0,logarithmicDepthBuffer:p,reversedDepthBuffer:lt,skinning:P.isSkinnedMesh===!0,hasPositionAttribute:B.attributes.position!==void 0,morphTargets:B.morphAttributes.position!==void 0,morphNormals:B.morphAttributes.normal!==void 0,morphColors:B.morphAttributes.color!==void 0,morphTargetsCount:vt,morphTextureStride:yt,numSunLights:w.sun.length,numDirLights:w.directional.length,numPointLights:w.point.length,numSpotLights:w.spot.length,numSpotLightMaps:w.spotLightMap.length,numRectAreaLights:w.rectArea.length,numHemiLights:w.hemi.length,numSunLightShadows:w.sunShadowMap.length,numDirLightShadows:w.directionalShadowMap.length,numPointLightShadows:w.pointShadowMap.length,numSpotLightShadows:w.spotShadowMap.length,numSpotLightShadowsWithMaps:w.numSpotLightShadowsWithMaps,numLightProbes:w.numLightProbes,numLightProbeGrids:F.length,numClippingPlanes:s.numPlanes,numClipIntersection:s.numIntersection,dithering:x.dithering,shadowMapEnabled:e.shadowMap.enabled&&R.length>0,shadowMapType:e.shadowMap.type,toneMapping:Lt,decodeVideoTexture:at&&x.map.isVideoTexture===!0&&se.getTransfer(x.map.colorSpace)===ve,decodeVideoTextureEmissive:Be&&x.emissiveMap.isVideoTexture===!0&&se.getTransfer(x.emissiveMap.colorSpace)===ve,premultipliedAlpha:x.premultipliedAlpha,doubleSided:x.side===la,flipSided:x.side===Dn,useDepthPacking:x.depthPacking>=0,depthPacking:x.depthPacking||0,index0AttributeName:x.index0AttributeName,extensionClipCullDistance:rt&&x.extensions.clipCullDistance===!0&&n.has("WEBGL_clip_cull_distance"),extensionMultiDraw:(rt&&x.extensions.multiDraw===!0||ot)&&n.has("WEBGL_multi_draw"),rendererExtensionParallelShaderCompile:n.has("KHR_parallel_shader_compile"),customProgramCacheKey:x.customProgramCacheKey()};return wt.vertexUv1s=l.has(1),wt.vertexUv2s=l.has(2),wt.vertexUv3s=l.has(3),l.clear(),wt}function m(x){let w=[];if(x.shaderID?w.push(x.shaderID):(w.push(x.customVertexShaderID),w.push(x.customFragmentShaderID)),x.defines!==void 0)for(let R in x.defines)w.push(R),w.push(x.defines[R]);return x.isRawShaderMaterial===!1&&(h(w,x),g(w,x),w.push(e.outputColorSpace)),w.push(x.customProgramCacheKey),w.join()}function h(x,w){x.push(w.precision),x.push(w.outputColorSpace),x.push(w.envMapMode),x.push(w.envMapCubeUVHeight),x.push(w.mapUv),x.push(w.alphaMapUv),x.push(w.lightMapUv),x.push(w.aoMapUv),x.push(w.bumpMapUv),x.push(w.normalMapUv),x.push(w.displacementMapUv),x.push(w.emissiveMapUv),x.push(w.metalnessMapUv),x.push(w.roughnessMapUv),x.push(w.anisotropyMapUv),x.push(w.clearcoatMapUv),x.push(w.clearcoatNormalMapUv),x.push(w.clearcoatRoughnessMapUv),x.push(w.iridescenceMapUv),x.push(w.iridescenceThicknessMapUv),x.push(w.sheenColorMapUv),x.push(w.sheenRoughnessMapUv),x.push(w.specularMapUv),x.push(w.specularColorMapUv),x.push(w.specularIntensityMapUv),x.push(w.transmissionMapUv),x.push(w.thicknessMapUv),x.push(w.combine),x.push(w.fogExp2),x.push(w.sizeAttenuation),x.push(w.morphTargetsCount),x.push(w.morphAttributeCount),x.push(w.numSunLights),x.push(w.numDirLights),x.push(w.numPointLights),x.push(w.numSpotLights),x.push(w.numSpotLightMaps),x.push(w.numHemiLights),x.push(w.numRectAreaLights),x.push(w.numSunLightShadows),x.push(w.numDirLightShadows),x.push(w.numPointLightShadows),x.push(w.numSpotLightShadows),x.push(w.numSpotLightShadowsWithMaps),x.push(w.numLightProbes),x.push(w.shadowMapType),x.push(w.toneMapping),x.push(w.numClippingPlanes),x.push(w.numClipIntersection),x.push(w.depthPacking)}function g(x,w){r.disableAll(),w.instancing&&r.enable(0),w.instancingColor&&r.enable(1),w.instancingMorph&&r.enable(2),w.matcap&&r.enable(3),w.envMap&&r.enable(4),w.normalMapObjectSpace&&r.enable(5),w.normalMapTangentSpace&&r.enable(6),w.clearcoat&&r.enable(7),w.iridescence&&r.enable(8),w.alphaTest&&r.enable(9),w.vertexColors&&r.enable(10),w.vertexAlphas&&r.enable(11),w.vertexUv1s&&r.enable(12),w.vertexUv2s&&r.enable(13),w.vertexUv3s&&r.enable(14),w.vertexTangents&&r.enable(15),w.anisotropy&&r.enable(16),w.alphaHash&&r.enable(17),w.batching&&r.enable(18),w.dispersion&&r.enable(19),w.retroreflection&&r.enable(24),w.batchingColor&&r.enable(20),w.gradientMap&&r.enable(21),w.packedNormalMap&&r.enable(22),w.vertexNormals&&r.enable(23),x.push(r.mask),r.disableAll(),w.fog&&r.enable(0),w.useFog&&r.enable(1),w.flatShading&&r.enable(2),w.logarithmicDepthBuffer&&r.enable(3),w.reversedDepthBuffer&&r.enable(4),w.skinning&&r.enable(5),w.morphTargets&&r.enable(6),w.morphNormals&&r.enable(7),w.morphColors&&r.enable(8),w.premultipliedAlpha&&r.enable(9),w.shadowMapEnabled&&r.enable(10),w.doubleSided&&r.enable(11),w.flipSided&&r.enable(12),w.useDepthPacking&&r.enable(13),w.dithering&&r.enable(14),w.transmission&&r.enable(15),w.sheen&&r.enable(16),w.opaque&&r.enable(17),w.pointsUvs&&r.enable(18),w.decodeVideoTexture&&r.enable(19),w.decodeVideoTextureEmissive&&r.enable(20),w.alphaToCoverage&&r.enable(21),w.numLightProbeGrids>0&&r.enable(22),w.hasPositionAttribute&&r.enable(23),x.push(r.mask)}function S(x){let w=d[x.type],R;if(w){let D=fa[w];R=XM.clone(D.uniforms)}else R=x.uniforms;return R}function y(x,w){let R=f.get(w);return R!==void 0?++R.usedTimes:(R=new MD(e,w,x,a),c.push(R),f.set(w,R)),R}function T(x){if(--x.usedTimes===0){let w=c.indexOf(x);c[w]=c[c.length-1],c.pop(),f.delete(x.cacheKey),x.destroy()}}function A(x){o.remove(x)}function E(){o.dispose()}return{getParameters:b,getProgramCacheKey:m,getUniforms:S,acquireProgram:y,releaseProgram:T,releaseShaderCache:A,programs:c,dispose:E}}function AD(){let e=new WeakMap;function t(r){return e.has(r)}function n(r){let o=e.get(r);return o===void 0&&(o={},e.set(r,o)),o}function i(r){e.delete(r)}function a(r,o,l){e.get(r)[o]=l}function s(){e=new WeakMap}return{has:t,get:n,remove:i,update:a,dispose:s}}function wD(e,t){return e.groupOrder!==t.groupOrder?e.groupOrder-t.groupOrder:e.renderOrder!==t.renderOrder?e.renderOrder-t.renderOrder:e.material.id!==t.material.id?e.material.id-t.material.id:e.materialVariant!==t.materialVariant?e.materialVariant-t.materialVariant:e.z!==t.z?e.z-t.z:e.id-t.id}function ub(e,t){return e.groupOrder!==t.groupOrder?e.groupOrder-t.groupOrder:e.renderOrder!==t.renderOrder?e.renderOrder-t.renderOrder:e.z!==t.z?t.z-e.z:e.id-t.id}function fb(){let e=[],t=0,n=[],i=[],a=[];function s(){t=0,n.length=0,i.length=0,a.length=0}function r(u){let d=0;return u.isInstancedMesh&&(d+=2),u.isSkinnedMesh&&(d+=1),d}function o(u,d,_,b,m,h){let g=e[t];return g===void 0?(g={id:u.id,object:u,geometry:d,material:_,materialVariant:r(u),groupOrder:b,renderOrder:u.renderOrder,z:m,group:h},e[t]=g):(g.id=u.id,g.object=u,g.geometry=d,g.material=_,g.materialVariant=r(u),g.groupOrder=b,g.renderOrder=u.renderOrder,g.z=m,g.group=h),t++,g}function l(u,d,_,b,m,h,g){g.reversedDepth===!0&&(m=-m);let S=o(u,d,_,b,m,h);_.transmission>0?i.push(S):_.transparent===!0?a.push(S):n.push(S)}function c(u,d,_,b,m,h){let g=o(u,d,_,b,m,h);_.transmission>0?i.unshift(g):_.transparent===!0?a.unshift(g):n.unshift(g)}function f(u,d){n.length>1&&n.sort(u||wD),i.length>1&&i.sort(d||ub),a.length>1&&a.sort(d||ub)}function p(){for(let u=t,d=e.length;u<d;u++){let _=e[u];if(_.id===null)break;_.id=null,_.object=null,_.geometry=null,_.material=null,_.group=null}}return{opaque:n,transmissive:i,transparent:a,init:s,push:l,unshift:c,finish:p,sort:f}}function CD(){let e=new WeakMap;function t(i,a){let s=e.get(i),r;return s===void 0?(r=new fb,e.set(i,[r])):a>=s.length?(r=new fb,s.push(r)):r=s[a],r}function n(){e=new WeakMap}return{get:t,dispose:n}}function RD(){let e={};return{get:function(t){if(e[t.id]!==void 0)return e[t.id];let n;switch(t.type){case"SunLight":case"DirectionalLight":n={direction:new W,color:new Zt};break;case"SpotLight":n={position:new W,direction:new W,color:new Zt,distance:0,coneCos:0,penumbraCos:0,decay:0};break;case"PointLight":n={position:new W,color:new Zt,distance:0,decay:0};break;case"HemisphereLight":n={direction:new W,skyColor:new Zt,groundColor:new Zt};break;case"RectAreaLight":n={color:new Zt,position:new W,halfWidth:new W,halfHeight:new W};break}return e[t.id]=n,n}}}function DD(){let e={};return{get:function(t){if(e[t.id]!==void 0)return e[t.id];let n;switch(t.type){case"SunLight":case"DirectionalLight":n={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new oe};break;case"SpotLight":n={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new oe};break;case"PointLight":n={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new oe,shadowCameraNear:1,shadowCameraFar:1e3};break}return e[t.id]=n,n}}}var ND=0;function UD(e,t){return(t.castShadow?2:0)-(e.castShadow?2:0)+(t.map?1:0)-(e.map?1:0)}function LD(e){let t=new RD,n=DD(),i={version:0,hash:{sunLength:-1,directionalLength:-1,pointLength:-1,spotLength:-1,rectAreaLength:-1,hemiLength:-1,numSunShadows:-1,numDirectionalShadows:-1,numPointShadows:-1,numSpotShadows:-1,numSpotMaps:-1,numLightProbes:-1},ambient:[0,0,0],probe:[],sun:[],sunShadow:[],sunShadowMap:[],sunShadowMatrix:[],sunShadowCascade:[],directional:[],directionalShadow:[],directionalShadowMap:[],directionalShadowMatrix:[],spot:[],spotLightMap:[],spotShadow:[],spotShadowMap:[],spotLightMatrix:[],rectArea:[],rectAreaLTC1:null,rectAreaLTC2:null,point:[],pointShadow:[],pointShadowMap:[],pointShadowMatrix:[],hemi:[],numSpotLightShadowsWithMaps:0,numLightProbes:0};for(let c=0;c<9;c++)i.probe.push(new W);let a=new W,s=new Xe,r=new Xe;function o(c){let f=0,p=0,u=0;for(let P=0;P<9;P++)i.probe[P].set(0,0,0);let d=0,_=0,b=0,m=0,h=0,g=0,S=0,y=0,T=0,A=0,E=0,x=0,w=0,R=0;c.sort(UD);for(let P=0,F=c.length;P<F;P++){let U=c[P],B=U.color,X=U.intensity,Z=U.distance,$=null;if(U.shadow&&U.shadow.map&&(U.shadow.map.texture.format===Us?$=U.shadow.map.texture:$=U.shadow.map.depthTexture||U.shadow.map.texture),U.isAmbientLight)f+=B.r*X,p+=B.g*X,u+=B.b*X;else if(U.isLightProbe){for(let z=0;z<9;z++)i.probe[z].addScaledVector(U.sh.coefficients[z],X);R++}else if(U.isSunLight){let z=t.get(U);if(z.color.copy(U.color).multiplyScalar(U.intensity),U.castShadow){let K=U.shadow,j=n.get(U);j.shadowIntensity=K.intensity,j.shadowBias=K.bias,j.shadowNormalBias=K.normalBias,j.shadowRadius=K.radius,j.shadowMapSize.copy(K.mapSize).multiply(K.getFrameExtents()),i.sunShadow[_]=j,i.sunShadowMap[_]=$;let vt=K.getViewportCount();for(let yt=0;yt<vt;yt++)i.sunShadowMatrix[b+yt]=K.getMatrix(yt),i.sunShadowCascade[b+yt]=K._cascadeData[yt];b+=vt,_++}i.sun[d]=z,d++}else if(U.isDirectionalLight){let z=t.get(U);if(z.color.copy(U.color).multiplyScalar(U.intensity),U.castShadow){let K=U.shadow,j=n.get(U);j.shadowIntensity=K.intensity,j.shadowBias=K.bias,j.shadowNormalBias=K.normalBias,j.shadowRadius=K.radius,j.shadowMapSize=K.mapSize,i.directionalShadow[m]=j,i.directionalShadowMap[m]=$,i.directionalShadowMatrix[m]=U.shadow.matrix,T++}i.directional[m]=z,m++}else if(U.isSpotLight){let z=t.get(U);z.position.setFromMatrixPosition(U.matrixWorld),z.color.copy(B).multiplyScalar(X),z.distance=Z,z.coneCos=Math.cos(U.angle),z.penumbraCos=Math.cos(U.angle*(1-U.penumbra)),z.decay=U.decay,i.spot[g]=z;let K=U.shadow;if(U.map&&(i.spotLightMap[x]=U.map,x++,K.updateMatrices(U),U.castShadow&&w++),i.spotLightMatrix[g]=K.matrix,U.castShadow){let j=n.get(U);j.shadowIntensity=K.intensity,j.shadowBias=K.bias,j.shadowNormalBias=K.normalBias,j.shadowRadius=K.radius,j.shadowMapSize=K.mapSize,i.spotShadow[g]=j,i.spotShadowMap[g]=$,E++}g++}else if(U.isRectAreaLight){let z=t.get(U);z.color.copy(B).multiplyScalar(X),z.halfWidth.set(U.width*.5,0,0),z.halfHeight.set(0,U.height*.5,0),i.rectArea[S]=z,S++}else if(U.isPointLight){let z=t.get(U);if(z.color.copy(U.color).multiplyScalar(U.intensity),z.distance=U.distance,z.decay=U.decay,U.castShadow){let K=U.shadow,j=n.get(U);j.shadowIntensity=K.intensity,j.shadowBias=K.bias,j.shadowNormalBias=K.normalBias,j.shadowRadius=K.radius,j.shadowMapSize=K.mapSize,j.shadowCameraNear=K.camera.near,j.shadowCameraFar=K.camera.far,i.pointShadow[h]=j,i.pointShadowMap[h]=$,i.pointShadowMatrix[h]=U.shadow.matrix,A++}i.point[h]=z,h++}else if(U.isHemisphereLight){let z=t.get(U);z.skyColor.copy(U.color).multiplyScalar(X),z.groundColor.copy(U.groundColor).multiplyScalar(X),i.hemi[y]=z,y++}}S>0&&(e.has("OES_texture_float_linear")===!0?(i.rectAreaLTC1=pt.LTC_FLOAT_1,i.rectAreaLTC2=pt.LTC_FLOAT_2):(i.rectAreaLTC1=pt.LTC_HALF_1,i.rectAreaLTC2=pt.LTC_HALF_2)),i.ambient[0]=f,i.ambient[1]=p,i.ambient[2]=u;let D=i.hash;(D.sunLength!==d||D.directionalLength!==m||D.pointLength!==h||D.spotLength!==g||D.rectAreaLength!==S||D.hemiLength!==y||D.numSunShadows!==_||D.numDirectionalShadows!==T||D.numPointShadows!==A||D.numSpotShadows!==E||D.numSpotMaps!==x||D.numLightProbes!==R)&&(i.sun.length=d,i.directional.length=m,i.spot.length=g,i.rectArea.length=S,i.point.length=h,i.hemi.length=y,i.sunShadow.length=_,i.sunShadowMap.length=_,i.sunShadowMatrix.length=b,i.sunShadowCascade.length=b,i.directionalShadow.length=T,i.directionalShadowMap.length=T,i.directionalShadowMatrix.length=T,i.pointShadow.length=A,i.pointShadowMap.length=A,i.pointShadowMatrix.length=A,i.spotShadow.length=E,i.spotShadowMap.length=E,i.spotLightMatrix.length=E+x-w,i.spotLightMap.length=x,i.numSpotLightShadowsWithMaps=w,i.numLightProbes=R,D.sunLength=d,D.directionalLength=m,D.pointLength=h,D.spotLength=g,D.rectAreaLength=S,D.hemiLength=y,D.numSunShadows=_,D.numDirectionalShadows=T,D.numPointShadows=A,D.numSpotShadows=E,D.numSpotMaps=x,D.numLightProbes=R,i.version=ND++)}function l(c,f){let p=0,u=0,d=0,_=0,b=0,m=0,h=f.matrixWorldInverse;for(let g=0,S=c.length;g<S;g++){let y=c[g];if(y.isSunLight){let T=i.sun[p];T.direction.setFromMatrixPosition(y.matrixWorld),T.direction.transformDirection(h),p++}else if(y.isDirectionalLight){let T=i.directional[u];T.direction.setFromMatrixPosition(y.matrixWorld),a.setFromMatrixPosition(y.target.matrixWorld),T.direction.sub(a),T.direction.transformDirection(h),u++}else if(y.isSpotLight){let T=i.spot[_];T.position.setFromMatrixPosition(y.matrixWorld),T.position.applyMatrix4(h),T.direction.setFromMatrixPosition(y.matrixWorld),a.setFromMatrixPosition(y.target.matrixWorld),T.direction.sub(a),T.direction.transformDirection(h),_++}else if(y.isRectAreaLight){let T=i.rectArea[b];T.position.setFromMatrixPosition(y.matrixWorld),T.position.applyMatrix4(h),r.identity(),s.copy(y.matrixWorld),s.premultiply(h),r.extractRotation(s),T.halfWidth.set(y.width*.5,0,0),T.halfHeight.set(0,y.height*.5,0),T.halfWidth.applyMatrix4(r),T.halfHeight.applyMatrix4(r),b++}else if(y.isPointLight){let T=i.point[d];T.position.setFromMatrixPosition(y.matrixWorld),T.position.applyMatrix4(h),d++}else if(y.isHemisphereLight){let T=i.hemi[m];T.direction.setFromMatrixPosition(y.matrixWorld),T.direction.transformDirection(h),m++}}}return{setup:o,setupView:l,state:i}}function hb(e){let t=new LD(e),n=[],i=[],a=[];function s(u){p.camera=u,n.length=0,i.length=0,a.length=0}function r(u){n.push(u)}function o(u){i.push(u)}function l(u){a.push(u)}function c(){t.setup(n)}function f(u){t.setupView(n,u)}let p={lightsArray:n,shadowsArray:i,lightProbeGridArray:a,camera:null,lights:t,transmissionRenderTarget:{},textureUnits:0};return{init:s,state:p,setupLights:c,setupLightsView:f,pushLight:r,pushShadow:o,pushLightProbeGrid:l}}function OD(e){let t=new WeakMap;function n(a,s=0){let r=t.get(a),o;return r===void 0?(o=new hb(e),t.set(a,[o])):s>=r.length?(o=new hb(e),r.push(o)):o=r[s],o}function i(){t=new WeakMap}return{get:n,dispose:i}}var ID=`void main() {
	gl_Position = vec4( position, 1.0 );
}`,PD=`uniform sampler2D shadow_pass;
uniform vec2 resolution;
uniform float radius;
void main() {
	const float samples = float( VSM_SAMPLES );
	float mean = 0.0;
	float squared_mean = 0.0;
	float uvStride = samples <= 1.0 ? 0.0 : 2.0 / ( samples - 1.0 );
	float uvStart = samples <= 1.0 ? 0.0 : - 1.0;
	for ( float i = 0.0; i < samples; i ++ ) {
		float uvOffset = uvStart + i * uvStride;
		#ifdef HORIZONTAL_PASS
			vec2 distribution = texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( uvOffset, 0.0 ) * radius ) / resolution ).rg;
			mean += distribution.x;
			squared_mean += distribution.y * distribution.y + distribution.x * distribution.x;
		#else
			float depth = texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( 0.0, uvOffset ) * radius ) / resolution ).r;
			mean += depth;
			squared_mean += depth * depth;
		#endif
	}
	mean = mean / samples;
	squared_mean = squared_mean / samples;
	float std_dev = sqrt( max( 0.0, squared_mean - mean * mean ) );
	gl_FragColor = vec4( mean, std_dev, 0.0, 1.0 );
}`,BD=[new W(1,0,0),new W(-1,0,0),new W(0,1,0),new W(0,-1,0),new W(0,0,1),new W(0,0,-1)],zD=[new W(0,-1,0),new W(0,-1,0),new W(0,0,1),new W(0,0,-1),new W(0,-1,0),new W(0,-1,0)],db=new Xe,Nc=new W,zg=new W;function FD(e,t,n){let i=new mc,a=new oe,s=new oe,r=new Fe,o=new ph,l=new mh,c={},f=n.maxTextureSize,p={[ws]:Dn,[Dn]:ws,[la]:la},u=new Rn({defines:{VSM_SAMPLES:8},uniforms:{shadow_pass:{value:null},resolution:{value:new oe},radius:{value:4}},vertexShader:ID,fragmentShader:PD}),d=u.clone();d.defines.HORIZONTAL_PASS=1;let _=new oa;_.setAttribute("position",new vi(new Float32Array([-1,-1,.5,3,-1,.5,-1,3,.5]),3));let b=new Gn(_,u),m=this;this.enabled=!1,this.autoUpdate=!0,this.needsUpdate=!1,this.type=yc;let h=this.type;this.render=function(A,E,x){if(m.enabled===!1||m.autoUpdate===!1&&m.needsUpdate===!1||A.length===0)return;this.type===oM&&(Ft("WebGLShadowMap: PCFSoftShadowMap has been removed. Using PCFShadowMap instead."),this.type=yc);let w=e.getRenderTarget(),R=e.getActiveCubeFace(),D=e.getActiveMipmapLevel(),P=e.state;P.setBlending(ca),P.buffers.depth.getReversed()===!0?P.buffers.color.setClear(0,0,0,0):P.buffers.color.setClear(1,1,1,1),P.buffers.depth.setTest(!0),P.setScissorTest(!1);let F=h!==this.type;F&&E.traverse(function(U){U.material&&(Array.isArray(U.material)?U.material.forEach(B=>B.needsUpdate=!0):U.material.needsUpdate=!0)});for(let U=0,B=A.length;U<B;U++){let X=A[U],Z=X.shadow;if(Z===void 0){Ft("WebGLShadowMap:",X,"has no shadow.");continue}if(Z.autoUpdate===!1&&Z.needsUpdate===!1)continue;a.copy(Z.mapSize);let $=Z.getFrameExtents();a.multiply($),s.copy(Z.mapSize),(a.x>f||a.y>f)&&(a.x>f&&(s.x=Math.floor(f/$.x),a.x=s.x*$.x,Z.mapSize.x=s.x),a.y>f&&(s.y=Math.floor(f/$.y),a.y=s.y*$.y,Z.mapSize.y=s.y));let z=e.state.buffers.depth.getReversed();if(Z.camera._reversedDepth=z,Z.map===null||F===!0){if(Z.map!==null&&(Z.map.depthTexture!==null&&(Z.map.depthTexture.dispose(),Z.map.depthTexture=null),Z.map.dispose()),this.type===Vo){if(X.isPointLight){Ft("WebGLShadowMap: VSM shadow maps are not supported for PointLights. Use PCF or BasicShadowMap instead.");continue}Z.map=new Vn(a.x,a.y,{format:Us,type:Pi,minFilter:mn,magFilter:mn,generateMipmaps:!1}),Z.map.texture.name=X.name+".shadowMap",Z.map.depthTexture=new bs(a.x,a.y,Ii),Z.map.depthTexture.name=X.name+".shadowMapDepth",Z.map.depthTexture.format=aa,Z.map.depthTexture.compareFunction=null,Z.map.depthTexture.minFilter=on,Z.map.depthTexture.magFilter=on}else X.isPointLight?(Z.map=new _d(a.x),Z.map.depthTexture=new hh(a.x,Oi)):(Z.map=new Vn(a.x,a.y),Z.map.depthTexture=new bs(a.x,a.y,Oi)),Z.map.depthTexture.name=X.name+".shadowMap",Z.map.depthTexture.format=aa,this.type===yc?(Z.map.depthTexture.compareFunction=z?pd:dd,Z.map.depthTexture.minFilter=mn,Z.map.depthTexture.magFilter=mn):(Z.map.depthTexture.compareFunction=null,Z.map.depthTexture.minFilter=on,Z.map.depthTexture.magFilter=on);Z.camera.updateProjectionMatrix()}Z.map.isWebGLCubeRenderTarget!==!0&&(Z.map.width!==a.x||Z.map.height!==a.y)&&Z.map.setSize(a.x,a.y);let K=Z.map.isWebGLCubeRenderTarget?6:Z.getViewportCount();X.isPointLight!==!0&&Z.updateMatrices(X,x);for(let j=0;j<K;j++){let vt=Z.getCamera(j);if(X.isPointLight){let yt=Z.camera,$t=Z.matrix,Et=X.distance||yt.far;Et!==yt.far&&(yt.far=Et,yt.updateProjectionMatrix()),Nc.setFromMatrixPosition(X.matrixWorld),yt.position.copy(Nc),zg.copy(yt.position),zg.add(BD[j]),yt.up.copy(zD[j]),yt.lookAt(zg),yt.updateMatrixWorld(),$t.makeTranslation(-Nc.x,-Nc.y,-Nc.z),db.multiplyMatrices(yt.projectionMatrix,yt.matrixWorldInverse),Z._frustum.setFromProjectionMatrix(db,yt.coordinateSystem,yt.reversedDepth)}if(Z.map.isWebGLCubeRenderTarget)e.setRenderTarget(Z.map,j),e.clear();else{j===0&&(e.setRenderTarget(Z.map),e.clear());let yt=Z.getViewport(j);r.set(s.x*yt.x,s.y*yt.y,s.x*yt.z,s.y*yt.w),P.viewport(r)}i=Z.getFrustum(j),y(E,x,vt,X,this.type)}Z.isPointLightShadow!==!0&&this.type===Vo&&g(Z,x),Z.needsUpdate=!1}h=this.type,m.needsUpdate=!1,e.setRenderTarget(w,R,D)};function g(A,E){let x=t.update(b);u.defines.VSM_SAMPLES!==A.blurSamples&&(u.defines.VSM_SAMPLES=A.blurSamples,d.defines.VSM_SAMPLES=A.blurSamples,u.needsUpdate=!0,d.needsUpdate=!0),A.mapPass===null?A.mapPass=new Vn(a.x,a.y,{format:Us,type:Pi}):(A.mapPass.width!==A.map.width||A.mapPass.height!==A.map.height)&&A.mapPass.setSize(A.map.width,A.map.height),u.uniforms.shadow_pass.value=A.map.depthTexture,u.uniforms.resolution.value.set(A.map.width,A.map.height),u.uniforms.radius.value=A.radius,e.setRenderTarget(A.mapPass),e.clear(),e.renderBufferDirect(E,null,x,u,b,null),d.uniforms.shadow_pass.value=A.mapPass.texture,d.uniforms.resolution.value.set(A.map.width,A.map.height),d.uniforms.radius.value=A.radius,e.setRenderTarget(A.map),e.clear(),e.renderBufferDirect(E,null,x,d,b,null)}function S(A,E,x,w){let R=null,D=x.isPointLight===!0?A.customDistanceMaterial:A.customDepthMaterial;if(D!==void 0)R=D;else if(R=x.isPointLight===!0?l:o,e.localClippingEnabled&&E.clipShadows===!0&&Array.isArray(E.clippingPlanes)&&E.clippingPlanes.length!==0||E.displacementMap&&E.displacementScale!==0||E.alphaMap&&E.alphaTest>0||E.map&&E.alphaTest>0||E.alphaToCoverage===!0){let P=R.uuid,F=E.uuid,U=c[P];U===void 0&&(U={},c[P]=U);let B=U[F];B===void 0&&(B=R.clone(),U[F]=B,E.addEventListener("dispose",T)),R=B}if(R.visible=E.visible,R.wireframe=E.wireframe,w===Vo?R.side=E.shadowSide!==null?E.shadowSide:E.side:R.side=E.shadowSide!==null?E.shadowSide:p[E.side],R.alphaMap=E.alphaMap,R.alphaTest=E.alphaToCoverage===!0?.5:E.alphaTest,R.map=E.map,R.clipShadows=E.clipShadows,R.clippingPlanes=E.clippingPlanes,R.clipIntersection=E.clipIntersection,R.displacementMap=E.displacementMap,R.displacementScale=E.displacementScale,R.displacementBias=E.displacementBias,R.wireframeLinewidth=E.wireframeLinewidth,R.linewidth=E.linewidth,x.isPointLight===!0&&R.isMeshDistanceMaterial===!0){let P=e.properties.get(R);P.light=x}return R}function y(A,E,x,w,R){if(A.visible===!1)return;if(A.layers.test(E.layers)&&(A.isMesh||A.isLine||A.isPoints)&&(A.castShadow||A.receiveShadow&&R===Vo)&&(!A.frustumCulled||A.intersectsFrustum(i))){A.modelViewMatrix.multiplyMatrices(x.matrixWorldInverse,A.matrixWorld);let F=t.update(A),U=A.material;if(Array.isArray(U)){let B=F.groups;for(let X=0,Z=B.length;X<Z;X++){let $=B[X],z=U[$.materialIndex];if(z&&z.visible){let K=S(A,z,w,R);A.onBeforeShadow(e,A,E,x,F,K,$),e.renderBufferDirect(x,null,F,K,A,$),A.onAfterShadow(e,A,E,x,F,K,$)}}}else if(U.visible){let B=S(A,U,w,R);A.onBeforeShadow(e,A,E,x,F,B,null),e.renderBufferDirect(x,null,F,B,A,null),A.onAfterShadow(e,A,E,x,F,B,null)}}let P=A.children;for(let F=0,U=P.length;F<U;F++)y(P[F],E,x,w,R)}function T(A){A.target.removeEventListener("dispose",T);for(let x in c){let w=c[x],R=A.target.uuid;R in w&&(w[R].dispose(),delete w[R])}}}function HD(e,t){function n(){let O=!1,ht=new Fe,tt=null,dt=new Fe(0,0,0,0);return{setMask:function(_t){tt!==_t&&!O&&(e.colorMask(_t,_t,_t,_t),tt=_t)},setLocked:function(_t){O=_t},setClear:function(_t,rt,Lt,wt,we){we===!0&&(_t*=wt,rt*=wt,Lt*=wt),ht.set(_t,rt,Lt,wt),dt.equals(ht)===!1&&(e.clearColor(_t,rt,Lt,wt),dt.copy(ht))},reset:function(){O=!1,tt=null,dt.set(-1,0,0,0)}}}function i(){let O=!1,ht=!1,tt=null,dt=null,_t=null;return{setReversed:function(rt){if(ht!==rt){let Lt=t.get("EXT_clip_control");rt?Lt.clipControlEXT(Lt.LOWER_LEFT_EXT,Lt.ZERO_TO_ONE_EXT):Lt.clipControlEXT(Lt.LOWER_LEFT_EXT,Lt.NEGATIVE_ONE_TO_ONE_EXT),ht=rt;let wt=_t;_t=null,this.setClear(wt)}},getReversed:function(){return ht},setTest:function(rt){rt?Y(e.DEPTH_TEST):lt(e.DEPTH_TEST)},setMask:function(rt){tt!==rt&&!O&&(e.depthMask(rt),tt=rt)},setFunc:function(rt){if(ht&&(rt=GM[rt]),dt!==rt){switch(rt){case Kf:e.depthFunc(e.NEVER);break;case Qf:e.depthFunc(e.ALWAYS);break;case jf:e.depthFunc(e.LESS);break;case Io:e.depthFunc(e.LEQUAL);break;case $f:e.depthFunc(e.EQUAL);break;case th:e.depthFunc(e.GEQUAL);break;case eh:e.depthFunc(e.GREATER);break;case nh:e.depthFunc(e.NOTEQUAL);break;default:e.depthFunc(e.LEQUAL)}dt=rt}},setLocked:function(rt){O=rt},setClear:function(rt){_t!==rt&&(_t=rt,ht&&(rt=1-rt),e.clearDepth(rt))},reset:function(){O=!1,tt=null,dt=null,_t=null,ht=!1}}}function a(){let O=!1,ht=null,tt=null,dt=null,_t=null,rt=null,Lt=null,wt=null,we=null;return{setTest:function(pe){O||(pe?Y(e.STENCIL_TEST):lt(e.STENCIL_TEST))},setMask:function(pe){ht!==pe&&!O&&(e.stencilMask(pe),ht=pe)},setFunc:function(pe,Si,zi){(tt!==pe||dt!==Si||_t!==zi)&&(e.stencilFunc(pe,Si,zi),tt=pe,dt=Si,_t=zi)},setOp:function(pe,Si,zi){(rt!==pe||Lt!==Si||wt!==zi)&&(e.stencilOp(pe,Si,zi),rt=pe,Lt=Si,wt=zi)},setLocked:function(pe){O=pe},setClear:function(pe){we!==pe&&(e.clearStencil(pe),we=pe)},reset:function(){O=!1,ht=null,tt=null,dt=null,_t=null,rt=null,Lt=null,wt=null,we=null}}}let s=new n,r=new i,o=new a,l=new WeakMap,c=new WeakMap,f={},p={},u={},d=new WeakMap,_=[],b=null,m=!1,h=null,g=null,S=null,y=null,T=null,A=null,E=null,x=new Zt(0,0,0),w=0,R=!1,D=null,P=null,F=null,U=null,B=null,X=e.getParameter(e.MAX_COMBINED_TEXTURE_IMAGE_UNITS),Z=!1,$=0,z=e.getParameter(e.VERSION);z.indexOf("WebGL")!==-1?($=parseFloat(/^WebGL (\d)/.exec(z)[1]),Z=$>=1):z.indexOf("OpenGL ES")!==-1&&($=parseFloat(/^OpenGL ES (\d)/.exec(z)[1]),Z=$>=2);let K=null,j={},vt=e.getParameter(e.SCISSOR_BOX),yt=e.getParameter(e.VIEWPORT),$t=new Fe().fromArray(vt),Et=new Fe().fromArray(yt);function Pt(O,ht,tt,dt){let _t=new Uint8Array(4),rt=e.createTexture();e.bindTexture(O,rt),e.texParameteri(O,e.TEXTURE_MIN_FILTER,e.NEAREST),e.texParameteri(O,e.TEXTURE_MAG_FILTER,e.NEAREST);for(let Lt=0;Lt<tt;Lt++)O===e.TEXTURE_3D||O===e.TEXTURE_2D_ARRAY?e.texImage3D(ht,0,e.RGBA,1,1,dt,0,e.RGBA,e.UNSIGNED_BYTE,_t):e.texImage2D(ht+Lt,0,e.RGBA,1,1,0,e.RGBA,e.UNSIGNED_BYTE,_t);return rt}let k={};k[e.TEXTURE_2D]=Pt(e.TEXTURE_2D,e.TEXTURE_2D,1),k[e.TEXTURE_CUBE_MAP]=Pt(e.TEXTURE_CUBE_MAP,e.TEXTURE_CUBE_MAP_POSITIVE_X,6),k[e.TEXTURE_2D_ARRAY]=Pt(e.TEXTURE_2D_ARRAY,e.TEXTURE_2D_ARRAY,1,1),k[e.TEXTURE_3D]=Pt(e.TEXTURE_3D,e.TEXTURE_3D,1,1),s.setClear(0,0,0,1),r.setClear(1),o.setClear(0),Y(e.DEPTH_TEST),r.setFunc(Io),Ot(!1),ie(ag),Y(e.CULL_FACE),Bt(ca);function Y(O){f[O]!==!0&&(e.enable(O),f[O]=!0)}function lt(O){f[O]!==!1&&(e.disable(O),f[O]=!1)}function xt(O,ht){return u[O]!==ht?(e.bindFramebuffer(O,ht),u[O]=ht,O===e.DRAW_FRAMEBUFFER&&(u[e.FRAMEBUFFER]=ht),O===e.FRAMEBUFFER&&(u[e.DRAW_FRAMEBUFFER]=ht),!0):!1}function ot(O,ht){let tt=_,dt=!1;if(O){tt=d.get(ht),tt===void 0&&(tt=[],d.set(ht,tt));let _t=O.textures;if(tt.length!==_t.length||tt[0]!==e.COLOR_ATTACHMENT0){for(let rt=0,Lt=_t.length;rt<Lt;rt++)tt[rt]=e.COLOR_ATTACHMENT0+rt;tt.length=_t.length,dt=!0}}else tt[0]!==e.BACK&&(tt[0]=e.BACK,dt=!0);dt&&e.drawBuffers(tt)}function at(O){return b!==O?(e.useProgram(O),b=O,!0):!1}let Ut={[mr]:e.FUNC_ADD,[cM]:e.FUNC_SUBTRACT,[uM]:e.FUNC_REVERSE_SUBTRACT};Ut[fM]=e.MIN,Ut[hM]=e.MAX;let Ct={[dM]:e.ZERO,[pM]:e.ONE,[mM]:e.SRC_COLOR,[lg]:e.SRC_ALPHA,[SM]:e.SRC_ALPHA_SATURATE,[xM]:e.DST_COLOR,[vM]:e.DST_ALPHA,[gM]:e.ONE_MINUS_SRC_COLOR,[cg]:e.ONE_MINUS_SRC_ALPHA,[yM]:e.ONE_MINUS_DST_COLOR,[_M]:e.ONE_MINUS_DST_ALPHA,[MM]:e.CONSTANT_COLOR,[bM]:e.ONE_MINUS_CONSTANT_COLOR,[TM]:e.CONSTANT_ALPHA,[EM]:e.ONE_MINUS_CONSTANT_ALPHA};function Bt(O,ht,tt,dt,_t,rt,Lt,wt,we,pe){if(O===ca){m===!0&&(lt(e.BLEND),m=!1);return}if(m===!1&&(Y(e.BLEND),m=!0),O!==lM){if(O!==h||pe!==R){if((g!==mr||T!==mr)&&(e.blendEquation(e.FUNC_ADD),g=mr,T=mr),pe)switch(O){case Cs:e.blendFuncSeparate(e.ONE,e.ONE_MINUS_SRC_ALPHA,e.ONE,e.ONE_MINUS_SRC_ALPHA);break;case sg:e.blendFunc(e.ONE,e.ONE);break;case rg:e.blendFuncSeparate(e.ZERO,e.ONE_MINUS_SRC_COLOR,e.ZERO,e.ONE);break;case og:e.blendFuncSeparate(e.DST_COLOR,e.ONE_MINUS_SRC_ALPHA,e.ZERO,e.ONE);break;default:Vt("WebGLState: Invalid blending: ",O);break}else switch(O){case Cs:e.blendFuncSeparate(e.SRC_ALPHA,e.ONE_MINUS_SRC_ALPHA,e.ONE,e.ONE_MINUS_SRC_ALPHA);break;case sg:e.blendFuncSeparate(e.SRC_ALPHA,e.ONE,e.ONE,e.ONE);break;case rg:Vt("WebGLState: SubtractiveBlending requires material.premultipliedAlpha = true");break;case og:Vt("WebGLState: MultiplyBlending requires material.premultipliedAlpha = true");break;default:Vt("WebGLState: Invalid blending: ",O);break}S=null,y=null,A=null,E=null,x.set(0,0,0),w=0,h=O,R=pe}return}_t=_t||ht,rt=rt||tt,Lt=Lt||dt,(ht!==g||_t!==T)&&(e.blendEquationSeparate(Ut[ht],Ut[_t]),g=ht,T=_t),(tt!==S||dt!==y||rt!==A||Lt!==E)&&(e.blendFuncSeparate(Ct[tt],Ct[dt],Ct[rt],Ct[Lt]),S=tt,y=dt,A=rt,E=Lt),(wt.equals(x)===!1||we!==w)&&(e.blendColor(wt.r,wt.g,wt.b,we),x.copy(wt),w=we),h=O,R=!1}function Wt(O,ht){O.side===la?lt(e.CULL_FACE):Y(e.CULL_FACE);let tt=O.side===Dn;ht&&(tt=!tt),Ot(tt),O.blending===Cs&&O.transparent===!1?Bt(ca):Bt(O.blending,O.blendEquation,O.blendSrc,O.blendDst,O.blendEquationAlpha,O.blendSrcAlpha,O.blendDstAlpha,O.blendColor,O.blendAlpha,O.premultipliedAlpha),r.setFunc(O.depthFunc),r.setTest(O.depthTest),r.setMask(O.depthWrite),s.setMask(O.colorWrite);let dt=O.stencilWrite;o.setTest(dt),dt&&(o.setMask(O.stencilWriteMask),o.setFunc(O.stencilFunc,O.stencilRef,O.stencilFuncMask),o.setOp(O.stencilFail,O.stencilZFail,O.stencilZPass)),Be(O.polygonOffset,O.polygonOffsetFactor,O.polygonOffsetUnits),O.alphaToCoverage===!0?Y(e.SAMPLE_ALPHA_TO_COVERAGE):lt(e.SAMPLE_ALPHA_TO_COVERAGE)}function Ot(O){D!==O&&(O?e.frontFace(e.CW):e.frontFace(e.CCW),D=O)}function ie(O){O!==sM?(Y(e.CULL_FACE),O!==P&&(O===ag?e.cullFace(e.BACK):O===rM?e.cullFace(e.FRONT):e.cullFace(e.FRONT_AND_BACK))):lt(e.CULL_FACE),P=O}function de(O){O!==F&&(Z&&e.lineWidth(O),F=O)}function Be(O,ht,tt){O?(Y(e.POLYGON_OFFSET_FILL),(U!==ht||B!==tt)&&(U=ht,B=tt,r.getReversed()&&(ht=-ht),e.polygonOffset(ht,tt))):lt(e.POLYGON_OFFSET_FILL)}function ce(O){O?Y(e.SCISSOR_TEST):lt(e.SCISSOR_TEST)}function be(O){O===void 0&&(O=e.TEXTURE0+X-1),K!==O&&(e.activeTexture(O),K=O)}function N(O,ht,tt){tt===void 0&&(K===null?tt=e.TEXTURE0+X-1:tt=K);let dt=j[tt];dt===void 0&&(dt={type:void 0,texture:void 0},j[tt]=dt),(dt.type!==O||dt.texture!==ht)&&(K!==tt&&(e.activeTexture(tt),K=tt),e.bindTexture(O,ht||k[O]),dt.type=O,dt.texture=ht)}function jt(){let O=j[K];O!==void 0&&O.type!==void 0&&(e.bindTexture(O.type,null),O.type=void 0,O.texture=void 0)}function zt(){try{e.compressedTexImage2D(...arguments)}catch(O){Vt("WebGLState:",O)}}function C(){try{e.compressedTexImage3D(...arguments)}catch(O){Vt("WebGLState:",O)}}function v(){try{e.texSubImage2D(...arguments)}catch(O){Vt("WebGLState:",O)}}function I(){try{e.texSubImage3D(...arguments)}catch(O){Vt("WebGLState:",O)}}function H(){try{e.compressedTexSubImage2D(...arguments)}catch(O){Vt("WebGLState:",O)}}function J(){try{e.compressedTexSubImage3D(...arguments)}catch(O){Vt("WebGLState:",O)}}function st(){try{e.texStorage2D(...arguments)}catch(O){Vt("WebGLState:",O)}}function it(){try{e.texStorage3D(...arguments)}catch(O){Vt("WebGLState:",O)}}function Q(){try{e.texImage2D(...arguments)}catch(O){Vt("WebGLState:",O)}}function et(){try{e.texImage3D(...arguments)}catch(O){Vt("WebGLState:",O)}}function ct(O){return p[O]!==void 0?p[O]:e.getParameter(O)}function At(O,ht){p[O]!==ht&&(e.pixelStorei(O,ht),p[O]=ht)}function ut(O){$t.equals(O)===!1&&(e.scissor(O.x,O.y,O.z,O.w),$t.copy(O))}function ft(O){Et.equals(O)===!1&&(e.viewport(O.x,O.y,O.z,O.w),Et.copy(O))}function Nt(O,ht){let tt=c.get(ht);tt===void 0&&(tt=new WeakMap,c.set(ht,tt));let dt=tt.get(O);dt===void 0&&(dt=e.getUniformBlockIndex(ht,O.name),tt.set(O,dt))}function It(O,ht){let dt=c.get(ht).get(O);l.get(ht)!==dt&&(e.uniformBlockBinding(ht,dt,O.__bindingPointIndex),l.set(ht,dt))}function qt(){e.disable(e.BLEND),e.disable(e.CULL_FACE),e.disable(e.DEPTH_TEST),e.disable(e.POLYGON_OFFSET_FILL),e.disable(e.SCISSOR_TEST),e.disable(e.STENCIL_TEST),e.disable(e.SAMPLE_ALPHA_TO_COVERAGE),e.blendEquation(e.FUNC_ADD),e.blendFunc(e.ONE,e.ZERO),e.blendFuncSeparate(e.ONE,e.ZERO,e.ONE,e.ZERO),e.blendColor(0,0,0,0),e.colorMask(!0,!0,!0,!0),e.clearColor(0,0,0,0),e.depthMask(!0),e.depthFunc(e.LESS),r.setReversed(!1),e.clearDepth(1),e.stencilMask(4294967295),e.stencilFunc(e.ALWAYS,0,4294967295),e.stencilOp(e.KEEP,e.KEEP,e.KEEP),e.clearStencil(0),e.cullFace(e.BACK),e.frontFace(e.CCW),e.polygonOffset(0,0),e.activeTexture(e.TEXTURE0),e.bindFramebuffer(e.FRAMEBUFFER,null),e.bindFramebuffer(e.DRAW_FRAMEBUFFER,null),e.bindFramebuffer(e.READ_FRAMEBUFFER,null),e.useProgram(null),e.lineWidth(1),e.scissor(0,0,e.canvas.width,e.canvas.height),e.viewport(0,0,e.canvas.width,e.canvas.height),e.pixelStorei(e.PACK_ALIGNMENT,4),e.pixelStorei(e.UNPACK_ALIGNMENT,4),e.pixelStorei(e.UNPACK_FLIP_Y_WEBGL,!1),e.pixelStorei(e.UNPACK_PREMULTIPLY_ALPHA_WEBGL,!1),e.pixelStorei(e.UNPACK_COLORSPACE_CONVERSION_WEBGL,e.BROWSER_DEFAULT_WEBGL),e.pixelStorei(e.PACK_ROW_LENGTH,0),e.pixelStorei(e.PACK_SKIP_PIXELS,0),e.pixelStorei(e.PACK_SKIP_ROWS,0),e.pixelStorei(e.UNPACK_ROW_LENGTH,0),e.pixelStorei(e.UNPACK_IMAGE_HEIGHT,0),e.pixelStorei(e.UNPACK_SKIP_PIXELS,0),e.pixelStorei(e.UNPACK_SKIP_ROWS,0),e.pixelStorei(e.UNPACK_SKIP_IMAGES,0),f={},p={},K=null,j={},u={},d=new WeakMap,_=[],b=null,m=!1,h=null,g=null,S=null,y=null,T=null,A=null,E=null,x=new Zt(0,0,0),w=0,R=!1,D=null,P=null,F=null,U=null,B=null,$t.set(0,0,e.canvas.width,e.canvas.height),Et.set(0,0,e.canvas.width,e.canvas.height),s.reset(),r.reset(),o.reset()}return{buffers:{color:s,depth:r,stencil:o},enable:Y,disable:lt,bindFramebuffer:xt,drawBuffers:ot,useProgram:at,setBlending:Bt,setMaterial:Wt,setFlipSided:Ot,setCullFace:ie,setLineWidth:de,setPolygonOffset:Be,setScissorTest:ce,activeTexture:be,bindTexture:N,unbindTexture:jt,compressedTexImage2D:zt,compressedTexImage3D:C,texImage2D:Q,texImage3D:et,pixelStorei:At,getParameter:ct,updateUBOMapping:Nt,uniformBlockBinding:It,texStorage2D:st,texStorage3D:it,texSubImage2D:v,texSubImage3D:I,compressedTexSubImage2D:H,compressedTexSubImage3D:J,scissor:ut,viewport:ft,reset:qt}}function VD(e,t,n,i,a,s,r){let o=t.has("WEBGL_multisampled_render_to_texture")?t.get("WEBGL_multisampled_render_to_texture"):null,l=typeof navigator>"u"?!1:/OculusBrowser/g.test(navigator.userAgent),c=new oe,f=new WeakMap,p=new Set,u,d=new WeakMap,_=!1;try{_=typeof OffscreenCanvas<"u"&&new OffscreenCanvas(1,1).getContext("2d")!==null}catch{}function b(C,v){return _?new OffscreenCanvas(C,v):lc("canvas")}function m(C,v,I){let H=1,J=zt(C);if((J.width>I||J.height>I)&&(H=I/Math.max(J.width,J.height)),H<1)if(typeof HTMLImageElement<"u"&&C instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&C instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&C instanceof ImageBitmap||typeof VideoFrame<"u"&&C instanceof VideoFrame){let st=Math.floor(H*J.width),it=Math.floor(H*J.height);u===void 0&&(u=b(st,it));let Q=v?b(st,it):u;return Q.width=st,Q.height=it,Q.getContext("2d").drawImage(C,0,0,st,it),Ft("WebGLRenderer: Texture has been resized from ("+J.width+"x"+J.height+") to ("+st+"x"+it+")."),Q}else return"data"in C&&Ft("WebGLRenderer: Image in DataTexture is too big ("+J.width+"x"+J.height+")."),C;return C}function h(C){return C.generateMipmaps}function g(C){e.generateMipmap(C)}function S(C){return C.isWebGLCubeRenderTarget?e.TEXTURE_CUBE_MAP:C.isWebGL3DRenderTarget?e.TEXTURE_3D:C.isWebGLArrayRenderTarget||C.isCompressedArrayTexture?e.TEXTURE_2D_ARRAY:e.TEXTURE_2D}function y(C,v,I,H,J,st=!1){if(C!==null){if(e[C]!==void 0)return e[C];Ft("WebGLRenderer: Attempt to use non-existing WebGL internal format '"+C+"'")}let it;H&&(it=t.get("EXT_texture_norm16"),it||Ft("WebGLRenderer: Unable to use normalized textures without EXT_texture_norm16 extension"));let Q=v;if(v===e.RED&&(I===e.FLOAT&&(Q=e.R32F),I===e.HALF_FLOAT&&(Q=e.R16F),I===e.UNSIGNED_BYTE&&(Q=e.R8),I===e.UNSIGNED_SHORT&&it&&(Q=it.R16_EXT),I===e.SHORT&&it&&(Q=it.R16_SNORM_EXT)),v===e.RED_INTEGER&&(I===e.UNSIGNED_BYTE&&(Q=e.R8UI),I===e.UNSIGNED_SHORT&&(Q=e.R16UI),I===e.UNSIGNED_INT&&(Q=e.R32UI),I===e.BYTE&&(Q=e.R8I),I===e.SHORT&&(Q=e.R16I),I===e.INT&&(Q=e.R32I)),v===e.RG&&(I===e.FLOAT&&(Q=e.RG32F),I===e.HALF_FLOAT&&(Q=e.RG16F),I===e.UNSIGNED_BYTE&&(Q=e.RG8),I===e.UNSIGNED_SHORT&&it&&(Q=it.RG16_EXT),I===e.SHORT&&it&&(Q=it.RG16_SNORM_EXT)),v===e.RG_INTEGER&&(I===e.UNSIGNED_BYTE&&(Q=e.RG8UI),I===e.UNSIGNED_SHORT&&(Q=e.RG16UI),I===e.UNSIGNED_INT&&(Q=e.RG32UI),I===e.BYTE&&(Q=e.RG8I),I===e.SHORT&&(Q=e.RG16I),I===e.INT&&(Q=e.RG32I)),v===e.RGB_INTEGER&&(I===e.UNSIGNED_BYTE&&(Q=e.RGB8UI),I===e.UNSIGNED_SHORT&&(Q=e.RGB16UI),I===e.UNSIGNED_INT&&(Q=e.RGB32UI),I===e.BYTE&&(Q=e.RGB8I),I===e.SHORT&&(Q=e.RGB16I),I===e.INT&&(Q=e.RGB32I)),v===e.RGBA_INTEGER&&(I===e.UNSIGNED_BYTE&&(Q=e.RGBA8UI),I===e.UNSIGNED_SHORT&&(Q=e.RGBA16UI),I===e.UNSIGNED_INT&&(Q=e.RGBA32UI),I===e.BYTE&&(Q=e.RGBA8I),I===e.SHORT&&(Q=e.RGBA16I),I===e.INT&&(Q=e.RGBA32I)),v===e.RGB&&(I===e.UNSIGNED_SHORT&&it&&(Q=it.RGB16_EXT),I===e.SHORT&&it&&(Q=it.RGB16_SNORM_EXT),I===e.UNSIGNED_INT_5_9_9_9_REV&&(Q=e.RGB9_E5),I===e.UNSIGNED_INT_10F_11F_11F_REV&&(Q=e.R11F_G11F_B10F)),v===e.RGBA){let et=st?rc:se.getTransfer(J);I===e.FLOAT&&(Q=e.RGBA32F),I===e.HALF_FLOAT&&(Q=e.RGBA16F),I===e.UNSIGNED_BYTE&&(Q=et===ve?e.SRGB8_ALPHA8:e.RGBA8),I===e.UNSIGNED_SHORT&&it&&(Q=it.RGBA16_EXT),I===e.SHORT&&it&&(Q=it.RGBA16_SNORM_EXT),I===e.UNSIGNED_SHORT_4_4_4_4&&(Q=e.RGBA4),I===e.UNSIGNED_SHORT_5_5_5_1&&(Q=e.RGB5_A1)}return(Q===e.R16F||Q===e.R32F||Q===e.RG16F||Q===e.RG32F||Q===e.RGBA16F||Q===e.RGBA32F)&&t.get("EXT_color_buffer_float"),Q}function T(C,v){let I;return C?v===null||v===Oi||v===ko?I=e.DEPTH24_STENCIL8:v===Ii?I=e.DEPTH32F_STENCIL8:v===Go&&(I=e.DEPTH24_STENCIL8,Ft("DepthTexture: 16 bit depth attachment is not supported with stencil. Using 24-bit attachment.")):v===null||v===Oi||v===ko?I=e.DEPTH_COMPONENT24:v===Ii?I=e.DEPTH_COMPONENT32F:v===Go&&(I=e.DEPTH_COMPONENT16),I}function A(C,v){return h(C)===!0||C.isFramebufferTexture&&C.minFilter!==on&&C.minFilter!==mn?Math.log2(Math.max(v.width,v.height))+1:C.mipmaps!==void 0&&C.mipmaps.length>0?C.mipmaps.length:C.isCompressedTexture&&Array.isArray(C.image)?v.mipmaps.length:1}function E(C){let v=C.target;v.removeEventListener("dispose",E),w(v),v.isVideoTexture&&f.delete(v),v.isHTMLTexture&&p.delete(v)}function x(C){let v=C.target;v.removeEventListener("dispose",x),D(v)}function w(C){let v=i.get(C);if(v.__webglInit===void 0)return;let I=C.source,H=d.get(I);if(H){let J=H[v.__cacheKey];J.usedTimes--,J.usedTimes===0&&R(C),Object.keys(H).length===0&&d.delete(I)}i.remove(C)}function R(C){let v=i.get(C);e.deleteTexture(v.__webglTexture);let I=C.source,H=d.get(I);delete H[v.__cacheKey],r.memory.textures--}function D(C){let v=i.get(C);if(C.depthTexture&&(C.depthTexture.dispose(),i.remove(C.depthTexture)),C.isWebGLCubeRenderTarget)for(let H=0;H<6;H++){if(Array.isArray(v.__webglFramebuffer[H]))for(let J=0;J<v.__webglFramebuffer[H].length;J++)e.deleteFramebuffer(v.__webglFramebuffer[H][J]);else e.deleteFramebuffer(v.__webglFramebuffer[H]);v.__webglDepthbuffer&&e.deleteRenderbuffer(v.__webglDepthbuffer[H])}else{if(Array.isArray(v.__webglFramebuffer))for(let H=0;H<v.__webglFramebuffer.length;H++)e.deleteFramebuffer(v.__webglFramebuffer[H]);else e.deleteFramebuffer(v.__webglFramebuffer);if(v.__webglDepthbuffer&&e.deleteRenderbuffer(v.__webglDepthbuffer),v.__webglMultisampledFramebuffer&&e.deleteFramebuffer(v.__webglMultisampledFramebuffer),v.__webglColorRenderbuffer)for(let H=0;H<v.__webglColorRenderbuffer.length;H++)v.__webglColorRenderbuffer[H]&&e.deleteRenderbuffer(v.__webglColorRenderbuffer[H]);v.__webglDepthRenderbuffer&&e.deleteRenderbuffer(v.__webglDepthRenderbuffer)}let I=C.textures;for(let H=0,J=I.length;H<J;H++){let st=i.get(I[H]);st.__webglTexture&&(e.deleteTexture(st.__webglTexture),r.memory.textures--),i.remove(I[H])}i.remove(C)}let P=0;function F(){P=0}function U(){return P}function B(C){P=C}function X(){let C=P;return C>=a.maxTextures&&Ft("WebGLTextures: Trying to use "+(C+1)+" texture units while this GPU supports only "+a.maxTextures),P+=1,C}function Z(C){let v=[];return v.push(C.wrapS),v.push(C.wrapT),v.push(C.wrapR||0),v.push(C.magFilter),v.push(C.minFilter),v.push(C.anisotropy),v.push(C.internalFormat),v.push(C.format),v.push(C.type),v.push(C.generateMipmaps),v.push(C.premultiplyAlpha),v.push(C.flipY),v.push(C.unpackAlignment),v.push(C.colorSpace),v.join()}function $(C,v){let I=i.get(C);if(C.isVideoTexture&&N(C),C.isRenderTargetTexture===!1&&C.isExternalTexture!==!0&&C.version>0&&I.__version!==C.version){let H=C.image;if(H===null)Ft("WebGLRenderer: Texture marked for update but no image data found.");else if(H.complete===!1)Ft("WebGLRenderer: Texture marked for update but image is incomplete");else{lt(I,C,v);return}}else C.isExternalTexture&&(I.__webglTexture=C.sourceTexture?C.sourceTexture:null);n.bindTexture(e.TEXTURE_2D,I.__webglTexture,e.TEXTURE0+v)}function z(C,v){let I=i.get(C);if(C.isRenderTargetTexture===!1&&C.version>0&&I.__version!==C.version){lt(I,C,v);return}else C.isExternalTexture&&(I.__webglTexture=C.sourceTexture?C.sourceTexture:null);n.bindTexture(e.TEXTURE_2D_ARRAY,I.__webglTexture,e.TEXTURE0+v)}function K(C,v){let I=i.get(C);if(C.isRenderTargetTexture===!1&&C.version>0&&I.__version!==C.version){lt(I,C,v);return}n.bindTexture(e.TEXTURE_3D,I.__webglTexture,e.TEXTURE0+v)}function j(C,v){let I=i.get(C);if(C.isCubeDepthTexture!==!0&&C.version>0&&I.__version!==C.version){xt(I,C,v);return}n.bindTexture(e.TEXTURE_CUBE_MAP,I.__webglTexture,e.TEXTURE0+v)}let vt={[ih]:e.REPEAT,[ia]:e.CLAMP_TO_EDGE,[ah]:e.MIRRORED_REPEAT},yt={[on]:e.NEAREST,[CM]:e.NEAREST_MIPMAP_NEAREST,[Mc]:e.NEAREST_MIPMAP_LINEAR,[mn]:e.LINEAR,[Dh]:e.LINEAR_MIPMAP_NEAREST,[Ds]:e.LINEAR_MIPMAP_LINEAR},$t={[UM]:e.NEVER,[BM]:e.ALWAYS,[LM]:e.LESS,[dd]:e.LEQUAL,[OM]:e.EQUAL,[pd]:e.GEQUAL,[IM]:e.GREATER,[PM]:e.NOTEQUAL};function Et(C,v){if(v.type===Ii&&t.has("OES_texture_float_linear")===!1&&(v.magFilter===mn||v.magFilter===Dh||v.magFilter===Mc||v.magFilter===Ds||v.minFilter===mn||v.minFilter===Dh||v.minFilter===Mc||v.minFilter===Ds)&&Ft("WebGLRenderer: Unable to use linear filtering with floating point textures. OES_texture_float_linear not supported on this device."),e.texParameteri(C,e.TEXTURE_WRAP_S,vt[v.wrapS]),e.texParameteri(C,e.TEXTURE_WRAP_T,vt[v.wrapT]),(C===e.TEXTURE_3D||C===e.TEXTURE_2D_ARRAY)&&e.texParameteri(C,e.TEXTURE_WRAP_R,vt[v.wrapR]),e.texParameteri(C,e.TEXTURE_MAG_FILTER,yt[v.magFilter]),e.texParameteri(C,e.TEXTURE_MIN_FILTER,yt[v.minFilter]),v.compareFunction&&(e.texParameteri(C,e.TEXTURE_COMPARE_MODE,e.COMPARE_REF_TO_TEXTURE),e.texParameteri(C,e.TEXTURE_COMPARE_FUNC,$t[v.compareFunction])),t.has("EXT_texture_filter_anisotropic")===!0){if(v.magFilter===on||v.minFilter!==Mc&&v.minFilter!==Ds||v.type===Ii&&t.has("OES_texture_float_linear")===!1)return;if(v.anisotropy>1||i.get(v).__currentAnisotropy){let I=t.get("EXT_texture_filter_anisotropic");e.texParameterf(C,I.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(v.anisotropy,a.getMaxAnisotropy())),i.get(v).__currentAnisotropy=v.anisotropy}}}function Pt(C,v){let I=!1;C.__webglInit===void 0&&(C.__webglInit=!0,v.addEventListener("dispose",E));let H=v.source,J=d.get(H);J===void 0&&(J={},d.set(H,J));let st=Z(v);if(st!==C.__cacheKey){J[st]===void 0&&(J[st]={texture:e.createTexture(),usedTimes:0},r.memory.textures++,I=!0),J[st].usedTimes++;let it=J[C.__cacheKey];it!==void 0&&(J[C.__cacheKey].usedTimes--,it.usedTimes===0&&R(v)),C.__cacheKey=st,C.__webglTexture=J[st].texture}return I}function k(C,v,I){return Math.floor(Math.floor(C/I)/v)}function Y(C,v,I,H){let st=C.updateRanges;if(st.length===0)n.texSubImage2D(e.TEXTURE_2D,0,0,0,v.width,v.height,I,H,v.data);else{st.sort((At,ut)=>At.start-ut.start);let it=0;for(let At=1;At<st.length;At++){let ut=st[it],ft=st[At],Nt=ut.start+ut.count,It=k(ft.start,v.width,4),qt=k(ut.start,v.width,4);ft.start<=Nt+1&&It===qt&&k(ft.start+ft.count-1,v.width,4)===It?ut.count=Math.max(ut.count,ft.start+ft.count-ut.start):(++it,st[it]=ft)}st.length=it+1;let Q=n.getParameter(e.UNPACK_ROW_LENGTH),et=n.getParameter(e.UNPACK_SKIP_PIXELS),ct=n.getParameter(e.UNPACK_SKIP_ROWS);n.pixelStorei(e.UNPACK_ROW_LENGTH,v.width);for(let At=0,ut=st.length;At<ut;At++){let ft=st[At],Nt=Math.floor(ft.start/4),It=Math.ceil(ft.count/4),qt=Nt%v.width,O=Math.floor(Nt/v.width),ht=It,tt=1;n.pixelStorei(e.UNPACK_SKIP_PIXELS,qt),n.pixelStorei(e.UNPACK_SKIP_ROWS,O),n.texSubImage2D(e.TEXTURE_2D,0,qt,O,ht,tt,I,H,v.data)}C.clearUpdateRanges(),n.pixelStorei(e.UNPACK_ROW_LENGTH,Q),n.pixelStorei(e.UNPACK_SKIP_PIXELS,et),n.pixelStorei(e.UNPACK_SKIP_ROWS,ct)}}function lt(C,v,I){let H=e.TEXTURE_2D;(v.isDataArrayTexture||v.isCompressedArrayTexture)&&(H=e.TEXTURE_2D_ARRAY),v.isData3DTexture&&(H=e.TEXTURE_3D);let J=Pt(C,v),st=v.source;n.bindTexture(H,C.__webglTexture,e.TEXTURE0+I);let it=i.get(st);if(st.version!==it.__version||J===!0){if(n.activeTexture(e.TEXTURE0+I),(typeof ImageBitmap<"u"&&v.image instanceof ImageBitmap)===!1){let tt=se.getPrimaries(se.workingColorSpace),dt=v.colorSpace===Oa?null:se.getPrimaries(v.colorSpace),_t=v.colorSpace===Oa||tt===dt?e.NONE:e.BROWSER_DEFAULT_WEBGL;n.pixelStorei(e.UNPACK_FLIP_Y_WEBGL,v.flipY),n.pixelStorei(e.UNPACK_PREMULTIPLY_ALPHA_WEBGL,v.premultiplyAlpha),n.pixelStorei(e.UNPACK_COLORSPACE_CONVERSION_WEBGL,_t)}n.pixelStorei(e.UNPACK_ALIGNMENT,v.unpackAlignment);let et=m(v.image,!1,a.maxTextureSize);et=jt(v,et);let ct=s.convert(v.format,v.colorSpace),At=s.convert(v.type),ut=y(v.internalFormat,ct,At,v.normalized,v.colorSpace,v.isVideoTexture);Et(H,v);let ft,Nt=v.mipmaps,It=v.isVideoTexture!==!0,qt=it.__version===void 0||J===!0,O=st.dataReady,ht=A(v,et);if(v.isDepthTexture)ut=T(v.format===Ns,v.type),qt&&(It?n.texStorage2D(e.TEXTURE_2D,1,ut,et.width,et.height):n.texImage2D(e.TEXTURE_2D,0,ut,et.width,et.height,0,ct,At,null));else if(v.isDataTexture)if(Nt.length>0){It&&qt&&n.texStorage2D(e.TEXTURE_2D,ht,ut,Nt[0].width,Nt[0].height);for(let tt=0,dt=Nt.length;tt<dt;tt++)ft=Nt[tt],It?O&&n.texSubImage2D(e.TEXTURE_2D,tt,0,0,ft.width,ft.height,ct,At,ft.data):n.texImage2D(e.TEXTURE_2D,tt,ut,ft.width,ft.height,0,ct,At,ft.data);v.generateMipmaps=!1}else It?(qt&&n.texStorage2D(e.TEXTURE_2D,ht,ut,et.width,et.height),O&&Y(v,et,ct,At)):n.texImage2D(e.TEXTURE_2D,0,ut,et.width,et.height,0,ct,At,et.data);else if(v.isCompressedTexture)if(v.isCompressedArrayTexture){It&&qt&&n.texStorage3D(e.TEXTURE_2D_ARRAY,ht,ut,Nt[0].width,Nt[0].height,et.depth);for(let tt=0,dt=Nt.length;tt<dt;tt++)if(ft=Nt[tt],v.format!==yi)if(ct!==null)if(It){if(O)if(v.layerUpdates.size>0){let _t=Ug(ft.width,ft.height,v.format,v.type);for(let rt of v.layerUpdates){let Lt=ft.data.subarray(rt*_t/ft.data.BYTES_PER_ELEMENT,(rt+1)*_t/ft.data.BYTES_PER_ELEMENT);n.compressedTexSubImage3D(e.TEXTURE_2D_ARRAY,tt,0,0,rt,ft.width,ft.height,1,ct,Lt)}}else n.compressedTexSubImage3D(e.TEXTURE_2D_ARRAY,tt,0,0,0,ft.width,ft.height,et.depth,ct,ft.data)}else n.compressedTexImage3D(e.TEXTURE_2D_ARRAY,tt,ut,ft.width,ft.height,et.depth,0,ft.data,0,0);else Ft("WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()");else It?O&&n.texSubImage3D(e.TEXTURE_2D_ARRAY,tt,0,0,0,ft.width,ft.height,et.depth,ct,At,ft.data):n.texImage3D(e.TEXTURE_2D_ARRAY,tt,ut,ft.width,ft.height,et.depth,0,ct,At,ft.data);v.layerUpdates.size>0&&v.clearLayerUpdates()}else{It&&qt&&n.texStorage2D(e.TEXTURE_2D,ht,ut,Nt[0].width,Nt[0].height);for(let tt=0,dt=Nt.length;tt<dt;tt++)ft=Nt[tt],v.format!==yi?ct!==null?It?O&&n.compressedTexSubImage2D(e.TEXTURE_2D,tt,0,0,ft.width,ft.height,ct,ft.data):n.compressedTexImage2D(e.TEXTURE_2D,tt,ut,ft.width,ft.height,0,ft.data):Ft("WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()"):It?O&&n.texSubImage2D(e.TEXTURE_2D,tt,0,0,ft.width,ft.height,ct,At,ft.data):n.texImage2D(e.TEXTURE_2D,tt,ut,ft.width,ft.height,0,ct,At,ft.data)}else if(v.isDataArrayTexture)if(It){if(qt&&n.texStorage3D(e.TEXTURE_2D_ARRAY,ht,ut,et.width,et.height,et.depth),O)if(v.layerUpdates.size>0){let tt=Ug(et.width,et.height,v.format,v.type);for(let dt of v.layerUpdates){let _t=et.data.subarray(dt*tt/et.data.BYTES_PER_ELEMENT,(dt+1)*tt/et.data.BYTES_PER_ELEMENT);n.texSubImage3D(e.TEXTURE_2D_ARRAY,0,0,0,dt,et.width,et.height,1,ct,At,_t)}v.clearLayerUpdates()}else n.texSubImage3D(e.TEXTURE_2D_ARRAY,0,0,0,0,et.width,et.height,et.depth,ct,At,et.data)}else n.texImage3D(e.TEXTURE_2D_ARRAY,0,ut,et.width,et.height,et.depth,0,ct,At,et.data);else if(v.isData3DTexture)It?(qt&&n.texStorage3D(e.TEXTURE_3D,ht,ut,et.width,et.height,et.depth),O&&n.texSubImage3D(e.TEXTURE_3D,0,0,0,0,et.width,et.height,et.depth,ct,At,et.data)):n.texImage3D(e.TEXTURE_3D,0,ut,et.width,et.height,et.depth,0,ct,At,et.data);else if(v.isFramebufferTexture){if(qt)if(It)n.texStorage2D(e.TEXTURE_2D,ht,ut,et.width,et.height);else{let tt=et.width,dt=et.height;for(let _t=0;_t<ht;_t++)n.texImage2D(e.TEXTURE_2D,_t,ut,tt,dt,0,ct,At,null),tt>>=1,dt>>=1}}else if(v.isHTMLTexture){if("texElementImage2D"in e){let tt=e.canvas;if(tt.hasAttribute("layoutsubtree")||tt.setAttribute("layoutsubtree","true"),et.parentNode!==tt){tt.appendChild(et),p.add(v),tt.onpaint=dt=>{let _t=dt.changedElements;for(let rt of p)_t.includes(rt.image)&&(rt.needsUpdate=!0)},tt.requestPaint();return}if(e.texElementImage2D.length===3)e.texElementImage2D(e.TEXTURE_2D,e.RGBA8,et);else{let _t=e.RGBA,rt=e.RGBA,Lt=e.UNSIGNED_BYTE;e.texElementImage2D(e.TEXTURE_2D,0,_t,rt,Lt,et)}e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE)}}else if(Nt.length>0){if(It&&qt){let tt=zt(Nt[0]);n.texStorage2D(e.TEXTURE_2D,ht,ut,tt.width,tt.height)}for(let tt=0,dt=Nt.length;tt<dt;tt++)ft=Nt[tt],It?O&&n.texSubImage2D(e.TEXTURE_2D,tt,0,0,ct,At,ft):n.texImage2D(e.TEXTURE_2D,tt,ut,ct,At,ft);v.generateMipmaps=!1}else if(It){if(qt){let tt=zt(et);n.texStorage2D(e.TEXTURE_2D,ht,ut,tt.width,tt.height)}O&&n.texSubImage2D(e.TEXTURE_2D,0,0,0,ct,At,et)}else n.texImage2D(e.TEXTURE_2D,0,ut,ct,At,et);h(v)&&g(H),it.__version=st.version,v.onUpdate&&v.onUpdate(v)}C.__version=v.version}function xt(C,v,I){if(v.image.length!==6)return;let H=Pt(C,v),J=v.source;n.bindTexture(e.TEXTURE_CUBE_MAP,C.__webglTexture,e.TEXTURE0+I);let st=i.get(J);if(J.version!==st.__version||H===!0){n.activeTexture(e.TEXTURE0+I);let it=se.getPrimaries(se.workingColorSpace),Q=v.colorSpace===Oa?null:se.getPrimaries(v.colorSpace),et=v.colorSpace===Oa||it===Q?e.NONE:e.BROWSER_DEFAULT_WEBGL;n.pixelStorei(e.UNPACK_FLIP_Y_WEBGL,v.flipY),n.pixelStorei(e.UNPACK_PREMULTIPLY_ALPHA_WEBGL,v.premultiplyAlpha),n.pixelStorei(e.UNPACK_ALIGNMENT,v.unpackAlignment),n.pixelStorei(e.UNPACK_COLORSPACE_CONVERSION_WEBGL,et);let ct=v.isCompressedTexture||v.image[0].isCompressedTexture,At=v.image[0]&&v.image[0].isDataTexture,ut=[];for(let rt=0;rt<6;rt++)!ct&&!At?ut[rt]=m(v.image[rt],!0,a.maxCubemapSize):ut[rt]=At?v.image[rt].image:v.image[rt],ut[rt]=jt(v,ut[rt]);let ft=ut[0],Nt=s.convert(v.format,v.colorSpace),It=s.convert(v.type),qt=y(v.internalFormat,Nt,It,v.normalized,v.colorSpace),O=v.isVideoTexture!==!0,ht=st.__version===void 0||H===!0,tt=J.dataReady,dt=A(v,ft);Et(e.TEXTURE_CUBE_MAP,v);let _t;if(ct){O&&ht&&n.texStorage2D(e.TEXTURE_CUBE_MAP,dt,qt,ft.width,ft.height);for(let rt=0;rt<6;rt++){_t=ut[rt].mipmaps;for(let Lt=0;Lt<_t.length;Lt++){let wt=_t[Lt];v.format!==yi?Nt!==null?O?tt&&n.compressedTexSubImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+rt,Lt,0,0,wt.width,wt.height,Nt,wt.data):n.compressedTexImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+rt,Lt,qt,wt.width,wt.height,0,wt.data):Ft("WebGLRenderer: Attempt to load unsupported compressed texture format in .setTextureCube()"):O?tt&&n.texSubImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+rt,Lt,0,0,wt.width,wt.height,Nt,It,wt.data):n.texImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+rt,Lt,qt,wt.width,wt.height,0,Nt,It,wt.data)}}}else{if(_t=v.mipmaps,O&&ht){_t.length>0&&dt++;let rt=zt(ut[0]);n.texStorage2D(e.TEXTURE_CUBE_MAP,dt,qt,rt.width,rt.height)}for(let rt=0;rt<6;rt++)if(At){O?tt&&n.texSubImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+rt,0,0,0,ut[rt].width,ut[rt].height,Nt,It,ut[rt].data):n.texImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+rt,0,qt,ut[rt].width,ut[rt].height,0,Nt,It,ut[rt].data);for(let Lt=0;Lt<_t.length;Lt++){let we=_t[Lt].image[rt].image;O?tt&&n.texSubImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+rt,Lt+1,0,0,we.width,we.height,Nt,It,we.data):n.texImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+rt,Lt+1,qt,we.width,we.height,0,Nt,It,we.data)}}else{O?tt&&n.texSubImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+rt,0,0,0,Nt,It,ut[rt]):n.texImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+rt,0,qt,Nt,It,ut[rt]);for(let Lt=0;Lt<_t.length;Lt++){let wt=_t[Lt];O?tt&&n.texSubImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+rt,Lt+1,0,0,Nt,It,wt.image[rt]):n.texImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+rt,Lt+1,qt,Nt,It,wt.image[rt])}}}h(v)&&g(e.TEXTURE_CUBE_MAP),st.__version=J.version,v.onUpdate&&v.onUpdate(v)}C.__version=v.version}function ot(C,v,I,H,J,st){let it=s.convert(I.format,I.colorSpace),Q=s.convert(I.type),et=y(I.internalFormat,it,Q,I.normalized,I.colorSpace),ct=i.get(v),At=i.get(I);if(At.__renderTarget=v,!ct.__hasExternalTextures){let ut=Math.max(1,v.width>>st),ft=Math.max(1,v.height>>st);J===e.TEXTURE_3D||J===e.TEXTURE_2D_ARRAY?n.texImage3D(J,st,et,ut,ft,v.depth,0,it,Q,null):n.texImage2D(J,st,et,ut,ft,0,it,Q,null)}n.bindFramebuffer(e.FRAMEBUFFER,C),be(v)?o.framebufferTexture2DMultisampleEXT(e.FRAMEBUFFER,H,J,At.__webglTexture,0,ce(v)):(J===e.TEXTURE_2D||J>=e.TEXTURE_CUBE_MAP_POSITIVE_X&&J<=e.TEXTURE_CUBE_MAP_NEGATIVE_Z)&&e.framebufferTexture2D(e.FRAMEBUFFER,H,J,At.__webglTexture,st),n.bindFramebuffer(e.FRAMEBUFFER,null)}function at(C,v,I){if(e.bindRenderbuffer(e.RENDERBUFFER,C),v.depthBuffer){let H=v.depthTexture,J=H&&H.isDepthTexture?H.type:null,st=T(v.stencilBuffer,J),it=v.stencilBuffer?e.DEPTH_STENCIL_ATTACHMENT:e.DEPTH_ATTACHMENT;be(v)?o.renderbufferStorageMultisampleEXT(e.RENDERBUFFER,ce(v),st,v.width,v.height):I?e.renderbufferStorageMultisample(e.RENDERBUFFER,ce(v),st,v.width,v.height):e.renderbufferStorage(e.RENDERBUFFER,st,v.width,v.height),e.framebufferRenderbuffer(e.FRAMEBUFFER,it,e.RENDERBUFFER,C)}else{let H=v.textures;for(let J=0;J<H.length;J++){let st=H[J],it=s.convert(st.format,st.colorSpace),Q=s.convert(st.type),et=y(st.internalFormat,it,Q,st.normalized,st.colorSpace);be(v)?o.renderbufferStorageMultisampleEXT(e.RENDERBUFFER,ce(v),et,v.width,v.height):I?e.renderbufferStorageMultisample(e.RENDERBUFFER,ce(v),et,v.width,v.height):e.renderbufferStorage(e.RENDERBUFFER,et,v.width,v.height)}}e.bindRenderbuffer(e.RENDERBUFFER,null)}function Ut(C,v,I){let H=v.isWebGLCubeRenderTarget===!0;if(n.bindFramebuffer(e.FRAMEBUFFER,C),!(v.depthTexture&&v.depthTexture.isDepthTexture))throw new Error("THREE.WebGLTextures: renderTarget.depthTexture must be an instance of THREE.DepthTexture.");let J=i.get(v.depthTexture);if(J.__renderTarget=v,(!J.__webglTexture||v.depthTexture.image.width!==v.width||v.depthTexture.image.height!==v.height)&&(v.depthTexture.image.width=v.width,v.depthTexture.image.height=v.height,v.depthTexture.needsUpdate=!0),H){if(J.__webglInit===void 0&&(J.__webglInit=!0,v.depthTexture.addEventListener("dispose",E)),J.__webglTexture===void 0){J.__webglTexture=e.createTexture(),n.bindTexture(e.TEXTURE_CUBE_MAP,J.__webglTexture),Et(e.TEXTURE_CUBE_MAP,v.depthTexture);let ct=s.convert(v.depthTexture.format),At=s.convert(v.depthTexture.type),ut;v.depthTexture.format===aa?ut=e.DEPTH_COMPONENT24:v.depthTexture.format===Ns&&(ut=e.DEPTH24_STENCIL8);for(let ft=0;ft<6;ft++)e.texImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+ft,0,ut,v.width,v.height,0,ct,At,null)}}else $(v.depthTexture,0);let st=J.__webglTexture,it=ce(v),Q=H?e.TEXTURE_CUBE_MAP_POSITIVE_X+I:e.TEXTURE_2D,et=v.depthTexture.format===Ns?e.DEPTH_STENCIL_ATTACHMENT:e.DEPTH_ATTACHMENT;if(v.depthTexture.format===aa)be(v)?o.framebufferTexture2DMultisampleEXT(e.FRAMEBUFFER,et,Q,st,0,it):e.framebufferTexture2D(e.FRAMEBUFFER,et,Q,st,0);else if(v.depthTexture.format===Ns)be(v)?o.framebufferTexture2DMultisampleEXT(e.FRAMEBUFFER,et,Q,st,0,it):e.framebufferTexture2D(e.FRAMEBUFFER,et,Q,st,0);else throw new Error("THREE.WebGLTextures: Unknown depthTexture format.")}function Ct(C){let v=i.get(C),I=C.isWebGLCubeRenderTarget===!0;if(v.__boundDepthTexture!==C.depthTexture){let H=C.depthTexture;if(v.__depthDisposeCallback&&v.__depthDisposeCallback(),H){let J=()=>{delete v.__boundDepthTexture,delete v.__depthDisposeCallback,H.removeEventListener("dispose",J)};H.addEventListener("dispose",J),v.__depthDisposeCallback=J}v.__boundDepthTexture=H}if(C.depthTexture&&!v.__autoAllocateDepthBuffer)if(I)for(let H=0;H<6;H++)Ut(v.__webglFramebuffer[H],C,H);else{let H=C.texture.mipmaps;H&&H.length>0?Ut(v.__webglFramebuffer[0],C,0):Ut(v.__webglFramebuffer,C,0)}else if(I){v.__webglDepthbuffer=[];for(let H=0;H<6;H++)if(n.bindFramebuffer(e.FRAMEBUFFER,v.__webglFramebuffer[H]),v.__webglDepthbuffer[H]===void 0)v.__webglDepthbuffer[H]=e.createRenderbuffer(),at(v.__webglDepthbuffer[H],C,!1);else{let J=C.stencilBuffer?e.DEPTH_STENCIL_ATTACHMENT:e.DEPTH_ATTACHMENT,st=v.__webglDepthbuffer[H];e.bindRenderbuffer(e.RENDERBUFFER,st),e.framebufferRenderbuffer(e.FRAMEBUFFER,J,e.RENDERBUFFER,st)}}else{let H=C.texture.mipmaps;if(H&&H.length>0?n.bindFramebuffer(e.FRAMEBUFFER,v.__webglFramebuffer[0]):n.bindFramebuffer(e.FRAMEBUFFER,v.__webglFramebuffer),v.__webglDepthbuffer===void 0)v.__webglDepthbuffer=e.createRenderbuffer(),at(v.__webglDepthbuffer,C,!1);else{let J=C.stencilBuffer?e.DEPTH_STENCIL_ATTACHMENT:e.DEPTH_ATTACHMENT,st=v.__webglDepthbuffer;e.bindRenderbuffer(e.RENDERBUFFER,st),e.framebufferRenderbuffer(e.FRAMEBUFFER,J,e.RENDERBUFFER,st)}}n.bindFramebuffer(e.FRAMEBUFFER,null)}function Bt(C,v,I){let H=i.get(C);v!==void 0&&ot(H.__webglFramebuffer,C,C.texture,e.COLOR_ATTACHMENT0,e.TEXTURE_2D,0),I!==void 0&&Ct(C)}function Wt(C){let v=C.texture,I=i.get(C),H=i.get(v);C.addEventListener("dispose",x);let J=C.textures,st=C.isWebGLCubeRenderTarget===!0,it=J.length>1;if(it||(H.__webglTexture===void 0&&(H.__webglTexture=e.createTexture()),H.__version=v.version,r.memory.textures++),st){I.__webglFramebuffer=[];for(let Q=0;Q<6;Q++)if(v.mipmaps&&v.mipmaps.length>0){I.__webglFramebuffer[Q]=[];for(let et=0;et<v.mipmaps.length;et++)I.__webglFramebuffer[Q][et]=e.createFramebuffer()}else I.__webglFramebuffer[Q]=e.createFramebuffer()}else{if(v.mipmaps&&v.mipmaps.length>0){I.__webglFramebuffer=[];for(let Q=0;Q<v.mipmaps.length;Q++)I.__webglFramebuffer[Q]=e.createFramebuffer()}else I.__webglFramebuffer=e.createFramebuffer();if(it)for(let Q=0,et=J.length;Q<et;Q++){let ct=i.get(J[Q]);ct.__webglTexture===void 0&&(ct.__webglTexture=e.createTexture(),r.memory.textures++)}if(C.samples>0&&be(C)===!1){I.__webglMultisampledFramebuffer=e.createFramebuffer(),I.__webglColorRenderbuffer=[],n.bindFramebuffer(e.FRAMEBUFFER,I.__webglMultisampledFramebuffer);for(let Q=0;Q<J.length;Q++){let et=J[Q];I.__webglColorRenderbuffer[Q]=e.createRenderbuffer(),e.bindRenderbuffer(e.RENDERBUFFER,I.__webglColorRenderbuffer[Q]);let ct=s.convert(et.format,et.colorSpace),At=s.convert(et.type),ut=y(et.internalFormat,ct,At,et.normalized,et.colorSpace,C.isXRRenderTarget===!0),ft=ce(C);e.renderbufferStorageMultisample(e.RENDERBUFFER,ft,ut,C.width,C.height),e.framebufferRenderbuffer(e.FRAMEBUFFER,e.COLOR_ATTACHMENT0+Q,e.RENDERBUFFER,I.__webglColorRenderbuffer[Q])}e.bindRenderbuffer(e.RENDERBUFFER,null),C.depthBuffer&&(I.__webglDepthRenderbuffer=e.createRenderbuffer(),at(I.__webglDepthRenderbuffer,C,!0)),n.bindFramebuffer(e.FRAMEBUFFER,null)}}if(st){n.bindTexture(e.TEXTURE_CUBE_MAP,H.__webglTexture),Et(e.TEXTURE_CUBE_MAP,v);for(let Q=0;Q<6;Q++)if(v.mipmaps&&v.mipmaps.length>0)for(let et=0;et<v.mipmaps.length;et++)ot(I.__webglFramebuffer[Q][et],C,v,e.COLOR_ATTACHMENT0,e.TEXTURE_CUBE_MAP_POSITIVE_X+Q,et);else ot(I.__webglFramebuffer[Q],C,v,e.COLOR_ATTACHMENT0,e.TEXTURE_CUBE_MAP_POSITIVE_X+Q,0);h(v)&&g(e.TEXTURE_CUBE_MAP),n.unbindTexture()}else if(it){for(let Q=0,et=J.length;Q<et;Q++){let ct=J[Q],At=i.get(ct),ut=e.TEXTURE_2D;(C.isWebGL3DRenderTarget||C.isWebGLArrayRenderTarget)&&(ut=C.isWebGL3DRenderTarget?e.TEXTURE_3D:e.TEXTURE_2D_ARRAY),n.bindTexture(ut,At.__webglTexture),Et(ut,ct),ot(I.__webglFramebuffer,C,ct,e.COLOR_ATTACHMENT0+Q,ut,0),h(ct)&&g(ut)}n.unbindTexture()}else{let Q=e.TEXTURE_2D;if((C.isWebGL3DRenderTarget||C.isWebGLArrayRenderTarget)&&(Q=C.isWebGL3DRenderTarget?e.TEXTURE_3D:e.TEXTURE_2D_ARRAY),n.bindTexture(Q,H.__webglTexture),Et(Q,v),v.mipmaps&&v.mipmaps.length>0)for(let et=0;et<v.mipmaps.length;et++)ot(I.__webglFramebuffer[et],C,v,e.COLOR_ATTACHMENT0,Q,et);else ot(I.__webglFramebuffer,C,v,e.COLOR_ATTACHMENT0,Q,0);h(v)&&g(Q),n.unbindTexture()}C.depthBuffer&&Ct(C)}function Ot(C){let v=C.textures;for(let I=0,H=v.length;I<H;I++){let J=v[I];if(h(J)){let st=S(C),it=i.get(J).__webglTexture;n.bindTexture(st,it),g(st),n.unbindTexture()}}}let ie=[],de=[];function Be(C){if(C.samples>0){if(be(C)===!1){let v=C.textures,I=C.width,H=C.height,J=e.COLOR_BUFFER_BIT,st=C.stencilBuffer?e.DEPTH_STENCIL_ATTACHMENT:e.DEPTH_ATTACHMENT,it=i.get(C),Q=v.length>1;if(Q)for(let ct=0;ct<v.length;ct++)n.bindFramebuffer(e.FRAMEBUFFER,it.__webglMultisampledFramebuffer),e.framebufferRenderbuffer(e.FRAMEBUFFER,e.COLOR_ATTACHMENT0+ct,e.RENDERBUFFER,null),n.bindFramebuffer(e.FRAMEBUFFER,it.__webglFramebuffer),e.framebufferTexture2D(e.DRAW_FRAMEBUFFER,e.COLOR_ATTACHMENT0+ct,e.TEXTURE_2D,null,0);n.bindFramebuffer(e.READ_FRAMEBUFFER,it.__webglMultisampledFramebuffer);let et=C.texture.mipmaps;et&&et.length>0?n.bindFramebuffer(e.DRAW_FRAMEBUFFER,it.__webglFramebuffer[0]):n.bindFramebuffer(e.DRAW_FRAMEBUFFER,it.__webglFramebuffer);for(let ct=0;ct<v.length;ct++){if(C.resolveDepthBuffer&&(C.depthBuffer&&(J|=e.DEPTH_BUFFER_BIT),C.stencilBuffer&&C.resolveStencilBuffer&&(J|=e.STENCIL_BUFFER_BIT)),Q){e.framebufferRenderbuffer(e.READ_FRAMEBUFFER,e.COLOR_ATTACHMENT0,e.RENDERBUFFER,it.__webglColorRenderbuffer[ct]);let At=i.get(v[ct]).__webglTexture;e.framebufferTexture2D(e.DRAW_FRAMEBUFFER,e.COLOR_ATTACHMENT0,e.TEXTURE_2D,At,0)}e.blitFramebuffer(0,0,I,H,0,0,I,H,J,e.NEAREST),l===!0&&(ie.length=0,de.length=0,ie.push(e.COLOR_ATTACHMENT0+ct),C.depthBuffer&&C.storeMultisampledDepthBuffer===!1&&(ie.push(st),de.push(st),e.invalidateFramebuffer(e.DRAW_FRAMEBUFFER,de)),e.invalidateFramebuffer(e.READ_FRAMEBUFFER,ie))}if(n.bindFramebuffer(e.READ_FRAMEBUFFER,null),n.bindFramebuffer(e.DRAW_FRAMEBUFFER,null),Q)for(let ct=0;ct<v.length;ct++){n.bindFramebuffer(e.FRAMEBUFFER,it.__webglMultisampledFramebuffer),e.framebufferRenderbuffer(e.FRAMEBUFFER,e.COLOR_ATTACHMENT0+ct,e.RENDERBUFFER,it.__webglColorRenderbuffer[ct]);let At=i.get(v[ct]).__webglTexture;n.bindFramebuffer(e.FRAMEBUFFER,it.__webglFramebuffer),e.framebufferTexture2D(e.DRAW_FRAMEBUFFER,e.COLOR_ATTACHMENT0+ct,e.TEXTURE_2D,At,0)}n.bindFramebuffer(e.DRAW_FRAMEBUFFER,it.__webglMultisampledFramebuffer)}else if(C.depthBuffer&&C.storeMultisampledDepthBuffer===!1&&l){let v=C.stencilBuffer?e.DEPTH_STENCIL_ATTACHMENT:e.DEPTH_ATTACHMENT;e.invalidateFramebuffer(e.DRAW_FRAMEBUFFER,[v])}}}function ce(C){return Math.min(a.maxSamples,C.samples)}function be(C){let v=i.get(C);return C.samples>0&&t.has("WEBGL_multisampled_render_to_texture")===!0&&v.__useRenderToTexture!==!1}function N(C){let v=r.render.frame;f.get(C)!==v&&(f.set(C,v),C.update())}function jt(C,v){let I=C.colorSpace,H=C.format,J=C.type;return C.isCompressedTexture===!0||C.isVideoTexture===!0||I!==sc&&I!==Oa&&(se.getTransfer(I)===ve?(H!==yi||J!==ai)&&Ft("WebGLTextures: sRGB encoded textures have to use RGBAFormat and UnsignedByteType."):Vt("WebGLTextures: Unsupported texture color space:",I)),v}function zt(C){return typeof HTMLImageElement<"u"&&C instanceof HTMLImageElement?(c.width=C.naturalWidth||C.width,c.height=C.naturalHeight||C.height):typeof VideoFrame<"u"&&C instanceof VideoFrame?(c.width=C.displayWidth,c.height=C.displayHeight):(c.width=C.width,c.height=C.height),c}this.allocateTextureUnit=X,this.resetTextureUnits=F,this.getTextureUnits=U,this.setTextureUnits=B,this.setTexture2D=$,this.setTexture2DArray=z,this.setTexture3D=K,this.setTextureCube=j,this.rebindTextures=Bt,this.setupRenderTarget=Wt,this.updateRenderTargetMipmap=Ot,this.updateMultisampleRenderTarget=Be,this.setupDepthRenderbuffer=Ct,this.setupFrameBufferTexture=ot,this.useMultisampledRTT=be,this.isReversedDepthBuffer=function(){return n.buffers.depth.getReversed()}}function GD(e,t){function n(i,a=Oa){let s,r=se.getTransfer(a);if(i===ai)return e.UNSIGNED_BYTE;if(i===Uh)return e.UNSIGNED_SHORT_4_4_4_4;if(i===Lh)return e.UNSIGNED_SHORT_5_5_5_1;if(i===Sg)return e.UNSIGNED_INT_5_9_9_9_REV;if(i===Mg)return e.UNSIGNED_INT_10F_11F_11F_REV;if(i===xg)return e.BYTE;if(i===yg)return e.SHORT;if(i===Go)return e.UNSIGNED_SHORT;if(i===Nh)return e.INT;if(i===Oi)return e.UNSIGNED_INT;if(i===Ii)return e.FLOAT;if(i===Pi)return e.HALF_FLOAT;if(i===bg)return e.ALPHA;if(i===Tg)return e.RGB;if(i===yi)return e.RGBA;if(i===aa)return e.DEPTH_COMPONENT;if(i===Ns)return e.DEPTH_STENCIL;if(i===Eg)return e.RED;if(i===Oh)return e.RED_INTEGER;if(i===Us)return e.RG;if(i===Ih)return e.RG_INTEGER;if(i===Ph)return e.RGBA_INTEGER;if(i===bc||i===Tc||i===Ec||i===Ac)if(r===ve)if(s=t.get("WEBGL_compressed_texture_s3tc_srgb"),s!==null){if(i===bc)return s.COMPRESSED_SRGB_S3TC_DXT1_EXT;if(i===Tc)return s.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT;if(i===Ec)return s.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT;if(i===Ac)return s.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT}else return null;else if(s=t.get("WEBGL_compressed_texture_s3tc"),s!==null){if(i===bc)return s.COMPRESSED_RGB_S3TC_DXT1_EXT;if(i===Tc)return s.COMPRESSED_RGBA_S3TC_DXT1_EXT;if(i===Ec)return s.COMPRESSED_RGBA_S3TC_DXT3_EXT;if(i===Ac)return s.COMPRESSED_RGBA_S3TC_DXT5_EXT}else return null;if(i===Bh||i===zh||i===Fh||i===Hh)if(s=t.get("WEBGL_compressed_texture_pvrtc"),s!==null){if(i===Bh)return s.COMPRESSED_RGB_PVRTC_4BPPV1_IMG;if(i===zh)return s.COMPRESSED_RGB_PVRTC_2BPPV1_IMG;if(i===Fh)return s.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG;if(i===Hh)return s.COMPRESSED_RGBA_PVRTC_2BPPV1_IMG}else return null;if(i===Vh||i===Gh||i===kh||i===Xh||i===Wh||i===wc||i===qh)if(s=t.get("WEBGL_compressed_texture_etc"),s!==null){if(i===Vh||i===Gh)return r===ve?s.COMPRESSED_SRGB8_ETC2:s.COMPRESSED_RGB8_ETC2;if(i===kh)return r===ve?s.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC:s.COMPRESSED_RGBA8_ETC2_EAC;if(i===Xh)return s.COMPRESSED_R11_EAC;if(i===Wh)return s.COMPRESSED_SIGNED_R11_EAC;if(i===wc)return s.COMPRESSED_RG11_EAC;if(i===qh)return s.COMPRESSED_SIGNED_RG11_EAC}else return null;if(i===Yh||i===Zh||i===Jh||i===Kh||i===Qh||i===jh||i===$h||i===td||i===ed||i===nd||i===id||i===ad||i===sd||i===rd)if(s=t.get("WEBGL_compressed_texture_astc"),s!==null){if(i===Yh)return r===ve?s.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR:s.COMPRESSED_RGBA_ASTC_4x4_KHR;if(i===Zh)return r===ve?s.COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR:s.COMPRESSED_RGBA_ASTC_5x4_KHR;if(i===Jh)return r===ve?s.COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR:s.COMPRESSED_RGBA_ASTC_5x5_KHR;if(i===Kh)return r===ve?s.COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR:s.COMPRESSED_RGBA_ASTC_6x5_KHR;if(i===Qh)return r===ve?s.COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR:s.COMPRESSED_RGBA_ASTC_6x6_KHR;if(i===jh)return r===ve?s.COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR:s.COMPRESSED_RGBA_ASTC_8x5_KHR;if(i===$h)return r===ve?s.COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR:s.COMPRESSED_RGBA_ASTC_8x6_KHR;if(i===td)return r===ve?s.COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR:s.COMPRESSED_RGBA_ASTC_8x8_KHR;if(i===ed)return r===ve?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR:s.COMPRESSED_RGBA_ASTC_10x5_KHR;if(i===nd)return r===ve?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR:s.COMPRESSED_RGBA_ASTC_10x6_KHR;if(i===id)return r===ve?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR:s.COMPRESSED_RGBA_ASTC_10x8_KHR;if(i===ad)return r===ve?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR:s.COMPRESSED_RGBA_ASTC_10x10_KHR;if(i===sd)return r===ve?s.COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR:s.COMPRESSED_RGBA_ASTC_12x10_KHR;if(i===rd)return r===ve?s.COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR:s.COMPRESSED_RGBA_ASTC_12x12_KHR}else return null;if(i===od||i===ld||i===cd)if(s=t.get("EXT_texture_compression_bptc"),s!==null){if(i===od)return r===ve?s.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT:s.COMPRESSED_RGBA_BPTC_UNORM_EXT;if(i===ld)return s.COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT;if(i===cd)return s.COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT}else return null;if(i===ud||i===fd||i===Cc||i===hd)if(s=t.get("EXT_texture_compression_rgtc"),s!==null){if(i===ud)return s.COMPRESSED_RED_RGTC1_EXT;if(i===fd)return s.COMPRESSED_SIGNED_RED_RGTC1_EXT;if(i===Cc)return s.COMPRESSED_RED_GREEN_RGTC2_EXT;if(i===hd)return s.COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT}else return null;return i===ko?e.UNSIGNED_INT_24_8:e[i]!==void 0?e[i]:null}return{convert:n}}var kD=`
void main() {

	gl_Position = vec4( position, 1.0 );

}`,XD=`
uniform sampler2DArray depthColor;
uniform float depthWidth;
uniform float depthHeight;

void main() {

	vec2 coord = vec2( gl_FragCoord.x / depthWidth, gl_FragCoord.y / depthHeight );

	if ( coord.x >= 1.0 ) {

		gl_FragDepth = texture( depthColor, vec3( coord.x - 1.0, coord.y, 1 ) ).r;

	} else {

		gl_FragDepth = texture( depthColor, vec3( coord.x, coord.y, 0 ) ).r;

	}

}`,qg=class{constructor(){this.texture=null,this.mesh=null,this.depthNear=0,this.depthFar=0}init(t,n){if(this.texture===null){let i=new vc(t.texture);(t.depthNear!==n.depthNear||t.depthFar!==n.depthFar)&&(this.depthNear=t.depthNear,this.depthFar=t.depthFar),this.texture=i}}getMesh(t){if(this.texture!==null&&this.mesh===null){let n=t.cameras[0].viewport,i=new Rn({vertexShader:kD,fragmentShader:XD,uniforms:{depthColor:{value:this.texture},depthWidth:{value:n.z},depthHeight:{value:n.w}}});this.mesh=new Gn(new dr(20,20),i)}return this.mesh}reset(){this.texture=null,this.mesh=null}getDepthTexture(){return this.texture}},Yg=class extends sa{constructor(t,n){super();let i=this,a=null,s=1,r=null,o="local-floor",l=1,c=null,f=null,p=null,u=null,d=null,_=null,b=typeof XRWebGLBinding<"u",m=new qg,h={},g=n.getContextAttributes(),S=null,y=null,T=[],A=[],E=new oe,x=null,w=null,R=new Fn;R.viewport=new Fe;let D=new Fn;D.viewport=new Fe;let P=[R,D],F=new wh,U=null,B=null;this.cameraAutoUpdate=!0,this.enabled=!1,this.isPresenting=!1,this.getController=function(k){let Y=T[k];return Y===void 0&&(Y=new zo,T[k]=Y),Y.getTargetRaySpace()},this.getControllerGrip=function(k){let Y=T[k];return Y===void 0&&(Y=new zo,T[k]=Y),Y.getGripSpace()},this.getHand=function(k){let Y=T[k];return Y===void 0&&(Y=new zo,T[k]=Y),Y.getHandSpace()};function X(k){let Y=A.indexOf(k.inputSource);if(Y===-1)return;let lt=T[Y];lt!==void 0&&(lt.update(k.inputSource,k.frame,c||r),lt.dispatchEvent({type:k.type,data:k.inputSource}))}function Z(){a.removeEventListener("select",X),a.removeEventListener("selectstart",X),a.removeEventListener("selectend",X),a.removeEventListener("squeeze",X),a.removeEventListener("squeezestart",X),a.removeEventListener("squeezeend",X),a.removeEventListener("end",Z),a.removeEventListener("inputsourceschange",$);for(let k=0;k<T.length;k++){let Y=A[k];Y!==null&&(A[k]=null,T[k].disconnect(Y))}U=null,B=null,m.reset();for(let k in h)delete h[k];if(t.setRenderTarget(S),d=null,u=null,p=null,a=null,y=null,Pt.stop(),i.isPresenting=!1,t.setPixelRatio(x),t.setSize(E.width,E.height,!1),w!==null){let k=w.camera;k.fov=w.fov,k.zoom=w.zoom,k.updateProjectionMatrix(),w=null}i.dispatchEvent({type:"sessionend"})}this.setFramebufferScaleFactor=function(k){s=k,i.isPresenting===!0&&Ft("WebXRManager: Cannot change framebuffer scale while presenting.")},this.setReferenceSpaceType=function(k){o=k,i.isPresenting===!0&&Ft("WebXRManager: Cannot change reference space type while presenting.")},this.getReferenceSpace=function(){return c||r},this.setReferenceSpace=function(k){c=k},this.getBaseLayer=function(){return u!==null?u:d},this.getBinding=function(){return p===null&&b&&(p=new XRWebGLBinding(a,n)),p},this.getFrame=function(){return _},this.getSession=function(){return a},this.setSession=async function(k){if(a=k,a!==null){if(S=t.getRenderTarget(),a.addEventListener("select",X),a.addEventListener("selectstart",X),a.addEventListener("selectend",X),a.addEventListener("squeeze",X),a.addEventListener("squeezestart",X),a.addEventListener("squeezeend",X),a.addEventListener("end",Z),a.addEventListener("inputsourceschange",$),g.xrCompatible!==!0&&await n.makeXRCompatible(),x=t.getPixelRatio(),t.getSize(E),b&&"createProjectionLayer"in XRWebGLBinding.prototype){let lt=null,xt=null,ot=null;g.depth&&(ot=g.stencil?n.DEPTH24_STENCIL8:n.DEPTH_COMPONENT24,lt=g.stencil?Ns:aa,xt=g.stencil?ko:Oi);let at={colorFormat:n.RGBA8,depthFormat:ot,scaleFactor:s};p=this.getBinding(),u=p.createProjectionLayer(at),a.updateRenderState({layers:[u]}),t.setPixelRatio(1),t.setSize(u.textureWidth,u.textureHeight,!1),y=new Vn(u.textureWidth,u.textureHeight,{format:yi,type:ai,depthTexture:new bs(u.textureWidth,u.textureHeight,xt,void 0,void 0,void 0,void 0,void 0,void 0,lt),stencilBuffer:g.stencil,colorSpace:t.outputColorSpace,samples:g.antialias?4:0,resolveDepthBuffer:u.ignoreDepthValues===!1,resolveStencilBuffer:u.ignoreDepthValues===!1,storeMultisampledDepthBuffer:u.ignoreDepthValues===!1,storeMultisampledStencilBuffer:u.ignoreDepthValues===!1})}else{let lt={antialias:g.antialias,alpha:!0,depth:g.depth,stencil:g.stencil,framebufferScaleFactor:s};d=new XRWebGLLayer(a,n,lt),a.updateRenderState({baseLayer:d}),t.setPixelRatio(1),t.setSize(d.framebufferWidth,d.framebufferHeight,!1),y=new Vn(d.framebufferWidth,d.framebufferHeight,{format:yi,type:ai,colorSpace:t.outputColorSpace,stencilBuffer:g.stencil,resolveDepthBuffer:d.ignoreDepthValues===!1,resolveStencilBuffer:d.ignoreDepthValues===!1,storeMultisampledDepthBuffer:d.ignoreDepthValues===!1,storeMultisampledStencilBuffer:d.ignoreDepthValues===!1})}y.isXRRenderTarget=!0,this.setFoveation(l),c=null,r=await a.requestReferenceSpace(o),Pt.setContext(a),Pt.start(),i.isPresenting=!0,i.dispatchEvent({type:"sessionstart"})}},this.getEnvironmentBlendMode=function(){if(a!==null)return a.environmentBlendMode},this.getDepthTexture=function(){return m.getDepthTexture()};function $(k){for(let Y=0;Y<k.removed.length;Y++){let lt=k.removed[Y],xt=A.indexOf(lt);xt>=0&&(A[xt]=null,T[xt].disconnect(lt))}for(let Y=0;Y<k.added.length;Y++){let lt=k.added[Y],xt=A.indexOf(lt);if(xt===-1){for(let at=0;at<T.length;at++)if(at>=A.length){A.push(lt),xt=at;break}else if(A[at]===null){A[at]=lt,xt=at;break}if(xt===-1)break}let ot=T[xt];ot&&ot.connect(lt)}}let z=new W,K=new W;function j(k,Y,lt){z.setFromMatrixPosition(Y.matrixWorld),K.setFromMatrixPosition(lt.matrixWorld);let xt=z.distanceTo(K),ot=Y.projectionMatrix.elements,at=lt.projectionMatrix.elements,Ut=ot[14]/(ot[10]-1),Ct=ot[14]/(ot[10]+1),Bt=(ot[9]+1)/ot[5],Wt=(ot[9]-1)/ot[5],Ot=(ot[8]-1)/ot[0],ie=(at[8]+1)/at[0],de=Ut*Ot,Be=Ut*ie,ce=xt/(-Ot+ie),be=ce*-Ot;if(Y.matrixWorld.decompose(k.position,k.quaternion,k.scale),k.translateX(be),k.translateZ(ce),k.matrixWorld.compose(k.position,k.quaternion,k.scale),k.matrixWorldInverse.copy(k.matrixWorld).invert(),ot[10]===-1)k.projectionMatrix.copy(Y.projectionMatrix),k.projectionMatrixInverse.copy(Y.projectionMatrixInverse);else{let N=Ut+ce,jt=Ct+ce,zt=de-be,C=Be+(xt-be),v=Bt*Ct/jt*N,I=Wt*Ct/jt*N;k.projectionMatrix.makePerspective(zt,C,v,I,N,jt),k.projectionMatrixInverse.copy(k.projectionMatrix).invert()}}function vt(k,Y){Y===null?k.matrixWorld.copy(k.matrix):k.matrixWorld.multiplyMatrices(Y.matrixWorld,k.matrix),k.matrixWorldInverse.copy(k.matrixWorld).invert()}this.updateCamera=function(k){if(a===null)return;let Y=k.near,lt=k.far;m.texture!==null&&(m.depthNear>0&&(Y=m.depthNear),m.depthFar>0&&(lt=m.depthFar)),F.near=D.near=R.near=Y,F.far=D.far=R.far=lt,(U!==F.near||B!==F.far)&&(a.updateRenderState({depthNear:F.near,depthFar:F.far}),U=F.near,B=F.far),F.layers.mask=k.layers.mask|6,R.layers.mask=F.layers.mask&-5,D.layers.mask=F.layers.mask&-3;let xt=k.parent,ot=F.cameras;vt(F,xt);for(let at=0;at<ot.length;at++)vt(ot[at],xt);ot.length===2?j(F,R,D):F.projectionMatrix.copy(R.projectionMatrix),w===null&&k.isPerspectiveCamera&&(w={camera:k,fov:k.fov,zoom:k.zoom}),yt(k,F,xt)};function yt(k,Y,lt){lt===null?k.matrix.copy(Y.matrixWorld):(k.matrix.copy(lt.matrixWorld),k.matrix.invert(),k.matrix.multiply(Y.matrixWorld)),k.matrix.decompose(k.position,k.quaternion,k.scale),k.updateMatrixWorld(!0),k.projectionMatrix.copy(Y.projectionMatrix),k.projectionMatrixInverse.copy(Y.projectionMatrixInverse),k.isPerspectiveCamera&&(k.fov=rh*2*Math.atan(1/k.projectionMatrix.elements[5]),k.zoom=1)}this.getCamera=function(){return F},this.getFoveation=function(){if(!(u===null&&d===null))return l},this.setFoveation=function(k){l=k,u!==null&&(u.fixedFoveation=k),d!==null&&d.fixedFoveation!==void 0&&(d.fixedFoveation=k)},this.hasDepthSensing=function(){return m.texture!==null},this.getDepthSensingMesh=function(){return m.getMesh(F)},this.getCameraTexture=function(k){return h[k]};let $t=null;function Et(k,Y){if(f=Y.getViewerPose(c||r),_=Y,f!==null){let lt=f.views;d!==null&&(t.setRenderTargetFramebuffer(y,d.framebuffer),t.setRenderTarget(y));let xt=!1;lt.length!==F.cameras.length&&(F.cameras.length=0,xt=!0);for(let Ct=0;Ct<lt.length;Ct++){let Bt=lt[Ct],Wt=null;if(d!==null)Wt=d.getViewport(Bt);else{let ie=p.getViewSubImage(u,Bt);Wt=ie.viewport,Ct===0&&(t.setRenderTargetTextures(y,ie.colorTexture,ie.depthStencilTexture),t.setRenderTarget(y))}let Ot=P[Ct];Ot===void 0&&(Ot=new Fn,Ot.layers.enable(Ct),Ot.viewport=new Fe,P[Ct]=Ot),Ot.matrix.fromArray(Bt.transform.matrix),Ot.matrix.decompose(Ot.position,Ot.quaternion,Ot.scale),Ot.projectionMatrix.fromArray(Bt.projectionMatrix),Ot.projectionMatrixInverse.copy(Ot.projectionMatrix).invert(),Ot.viewport.set(Wt.x,Wt.y,Wt.width,Wt.height),Ct===0&&(F.matrix.copy(Ot.matrix),F.matrix.decompose(F.position,F.quaternion,F.scale)),xt===!0&&F.cameras.push(Ot)}let ot=a.enabledFeatures;if(ot&&ot.includes("depth-sensing")&&a.depthUsage=="gpu-optimized"&&b){p=i.getBinding();let Ct=p.getDepthInformation(lt[0]);Ct&&Ct.isValid&&Ct.texture&&m.init(Ct,a.renderState)}if(ot&&ot.includes("camera-access")&&b){t.state.unbindTexture(),p=i.getBinding();for(let Ct=0;Ct<lt.length;Ct++){let Bt=lt[Ct].camera;if(Bt){let Wt=h[Bt];Wt||(Wt=new vc,h[Bt]=Wt);let Ot=p.getCameraImage(Bt);Wt.sourceTexture=Ot}}}}for(let lt=0;lt<T.length;lt++){let xt=A[lt],ot=T[lt];xt!==null&&ot!==void 0&&ot.update(xt,Y,c||r)}$t&&$t(k,Y),Y.detectedPlanes&&i.dispatchEvent({type:"planesdetected",data:Y}),_=null}let Pt=new pb;Pt.setAnimationLoop(Et),this.setAnimationLoop=function(k){$t=k},this.dispose=function(){}}},WD=new Xe,yb=new Xt;yb.set(-1,0,0,0,1,0,0,0,1);function qD(e,t){function n(m,h){m.matrixAutoUpdate===!0&&m.updateMatrix(),h.value.copy(m.matrix)}function i(m,h){h.color.getRGB(m.fogColor.value,Rg(e)),h.isFog?(m.fogNear.value=h.near,m.fogFar.value=h.far):h.isFogExp2&&(m.fogDensity.value=h.density)}function a(m,h,g,S,y){h.isNodeMaterial?h.uniformsNeedUpdate=!1:h.isMeshBasicMaterial?s(m,h):h.isMeshLambertMaterial?(s(m,h),h.envMap&&(m.envMapIntensity.value=h.envMapIntensity)):h.isMeshToonMaterial?(s(m,h),p(m,h)):h.isMeshPhongMaterial?(s(m,h),f(m,h),h.envMap&&(m.envMapIntensity.value=h.envMapIntensity)):h.isMeshStandardMaterial?(s(m,h),u(m,h),h.isMeshPhysicalMaterial&&d(m,h,y)):h.isMeshMatcapMaterial?(s(m,h),_(m,h)):h.isMeshDepthMaterial?s(m,h):h.isMeshDistanceMaterial?(s(m,h),b(m,h)):h.isMeshNormalMaterial?s(m,h):h.isLineBasicMaterial?(r(m,h),h.isLineDashedMaterial&&o(m,h)):h.isPointsMaterial?l(m,h,g,S):h.isSpriteMaterial?c(m,h):h.isShadowMaterial?(m.color.value.copy(h.color),m.opacity.value=h.opacity):h.isShaderMaterial&&(h.uniformsNeedUpdate=!1)}function s(m,h){m.opacity.value=h.opacity,h.color&&m.diffuse.value.copy(h.color),h.emissive&&m.emissive.value.copy(h.emissive).multiplyScalar(h.emissiveIntensity),h.map&&(m.map.value=h.map,n(h.map,m.mapTransform)),h.alphaMap&&(m.alphaMap.value=h.alphaMap,n(h.alphaMap,m.alphaMapTransform)),h.bumpMap&&(m.bumpMap.value=h.bumpMap,n(h.bumpMap,m.bumpMapTransform),m.bumpScale.value=h.bumpScale,h.side===Dn&&(m.bumpScale.value*=-1)),h.normalMap&&(m.normalMap.value=h.normalMap,n(h.normalMap,m.normalMapTransform),m.normalScale.value.copy(h.normalScale),h.side===Dn&&m.normalScale.value.negate()),h.displacementMap&&(m.displacementMap.value=h.displacementMap,n(h.displacementMap,m.displacementMapTransform),m.displacementScale.value=h.displacementScale,m.displacementBias.value=h.displacementBias),h.emissiveMap&&(m.emissiveMap.value=h.emissiveMap,n(h.emissiveMap,m.emissiveMapTransform)),h.specularMap&&(m.specularMap.value=h.specularMap,n(h.specularMap,m.specularMapTransform)),h.alphaTest>0&&(m.alphaTest.value=h.alphaTest);let g=t.get(h),S=g.envMap,y=g.envMapRotation;S&&(m.envMap.value=S,m.envMapRotation.value.setFromMatrix4(WD.makeRotationFromEuler(y)).transpose(),S.isCubeTexture&&S.isRenderTargetTexture===!1&&m.envMapRotation.value.premultiply(yb),m.reflectivity.value=h.reflectivity,m.ior.value=h.ior,m.refractionRatio.value=h.refractionRatio),h.lightMap&&(m.lightMap.value=h.lightMap,m.lightMapIntensity.value=h.lightMapIntensity,n(h.lightMap,m.lightMapTransform)),h.aoMap&&(m.aoMap.value=h.aoMap,m.aoMapIntensity.value=h.aoMapIntensity,n(h.aoMap,m.aoMapTransform))}function r(m,h){m.diffuse.value.copy(h.color),m.opacity.value=h.opacity,h.map&&(m.map.value=h.map,n(h.map,m.mapTransform))}function o(m,h){m.dashSize.value=h.dashSize,m.totalSize.value=h.dashSize+h.gapSize,m.scale.value=h.scale}function l(m,h,g,S){m.diffuse.value.copy(h.color),m.opacity.value=h.opacity,m.size.value=h.size*g,m.scale.value=S*.5,h.map&&(m.map.value=h.map,n(h.map,m.uvTransform)),h.alphaMap&&(m.alphaMap.value=h.alphaMap,n(h.alphaMap,m.alphaMapTransform)),h.alphaTest>0&&(m.alphaTest.value=h.alphaTest)}function c(m,h){m.diffuse.value.copy(h.color),m.opacity.value=h.opacity,m.rotation.value=h.rotation,h.map&&(m.map.value=h.map,n(h.map,m.mapTransform)),h.alphaMap&&(m.alphaMap.value=h.alphaMap,n(h.alphaMap,m.alphaMapTransform)),h.alphaTest>0&&(m.alphaTest.value=h.alphaTest)}function f(m,h){m.specular.value.copy(h.specular),m.shininess.value=Math.max(h.shininess,1e-4)}function p(m,h){h.gradientMap&&(m.gradientMap.value=h.gradientMap)}function u(m,h){m.metalness.value=h.metalness,h.metalnessMap&&(m.metalnessMap.value=h.metalnessMap,n(h.metalnessMap,m.metalnessMapTransform)),m.roughness.value=h.roughness,h.roughnessMap&&(m.roughnessMap.value=h.roughnessMap,n(h.roughnessMap,m.roughnessMapTransform)),h.envMap&&(m.envMapIntensity.value=h.envMapIntensity)}function d(m,h,g){m.ior.value=h.ior,h.sheen>0&&(m.sheenColor.value.copy(h.sheenColor).multiplyScalar(h.sheen),m.sheenRoughness.value=h.sheenRoughness,h.sheenColorMap&&(m.sheenColorMap.value=h.sheenColorMap,n(h.sheenColorMap,m.sheenColorMapTransform)),h.sheenRoughnessMap&&(m.sheenRoughnessMap.value=h.sheenRoughnessMap,n(h.sheenRoughnessMap,m.sheenRoughnessMapTransform))),h.clearcoat>0&&(m.clearcoat.value=h.clearcoat,m.clearcoatRoughness.value=h.clearcoatRoughness,h.clearcoatMap&&(m.clearcoatMap.value=h.clearcoatMap,n(h.clearcoatMap,m.clearcoatMapTransform)),h.clearcoatRoughnessMap&&(m.clearcoatRoughnessMap.value=h.clearcoatRoughnessMap,n(h.clearcoatRoughnessMap,m.clearcoatRoughnessMapTransform)),h.clearcoatNormalMap&&(m.clearcoatNormalMap.value=h.clearcoatNormalMap,n(h.clearcoatNormalMap,m.clearcoatNormalMapTransform),m.clearcoatNormalScale.value.copy(h.clearcoatNormalScale),h.side===Dn&&m.clearcoatNormalScale.value.negate())),h.dispersion>0&&(m.dispersion.value=h.dispersion),h.retroreflectivity>0&&(m.retroreflectivity.value=h.retroreflectivity),h.iridescence>0&&(m.iridescence.value=h.iridescence,m.iridescenceIOR.value=h.iridescenceIOR,m.iridescenceThicknessMinimum.value=h.iridescenceThicknessRange[0],m.iridescenceThicknessMaximum.value=h.iridescenceThicknessRange[1],h.iridescenceMap&&(m.iridescenceMap.value=h.iridescenceMap,n(h.iridescenceMap,m.iridescenceMapTransform)),h.iridescenceThicknessMap&&(m.iridescenceThicknessMap.value=h.iridescenceThicknessMap,n(h.iridescenceThicknessMap,m.iridescenceThicknessMapTransform))),h.transmission>0&&(m.transmission.value=h.transmission,m.transmissionSamplerMap.value=g.texture,m.transmissionSamplerSize.value.set(g.width,g.height),h.transmissionMap&&(m.transmissionMap.value=h.transmissionMap,n(h.transmissionMap,m.transmissionMapTransform)),m.thickness.value=h.thickness,h.thicknessMap&&(m.thicknessMap.value=h.thicknessMap,n(h.thicknessMap,m.thicknessMapTransform)),m.attenuationDistance.value=h.attenuationDistance,m.attenuationColor.value.copy(h.attenuationColor)),h.anisotropy>0&&(m.anisotropyVector.value.set(h.anisotropy*Math.cos(h.anisotropyRotation),h.anisotropy*Math.sin(h.anisotropyRotation)),h.anisotropyMap&&(m.anisotropyMap.value=h.anisotropyMap,n(h.anisotropyMap,m.anisotropyMapTransform))),m.specularIntensity.value=h.specularIntensity,m.specularColor.value.copy(h.specularColor),h.specularColorMap&&(m.specularColorMap.value=h.specularColorMap,n(h.specularColorMap,m.specularColorMapTransform)),h.specularIntensityMap&&(m.specularIntensityMap.value=h.specularIntensityMap,n(h.specularIntensityMap,m.specularIntensityMapTransform))}function _(m,h){h.matcap&&(m.matcap.value=h.matcap)}function b(m,h){let g=t.get(h).light;m.referencePosition.value.setFromMatrixPosition(g.matrixWorld),m.nearDistance.value=g.shadow.camera.near,m.farDistance.value=g.shadow.camera.far}return{refreshFogUniforms:i,refreshMaterialUniforms:a}}function YD(e,t,n,i){let a={},s={},r=[],o=e.getParameter(e.MAX_UNIFORM_BUFFER_BINDINGS);function l(y,T){let A=T.program;i.uniformBlockBinding(y,A)}function c(y,T){let A=a[y.id];A===void 0&&(m(y),A=f(y),a[y.id]=A,y.addEventListener("dispose",g));let E=T.program;i.updateUBOMapping(y,E);let x=t.render.frame;s[y.id]!==x&&(u(y),s[y.id]=x)}function f(y){let T=p();y.__bindingPointIndex=T;let A=e.createBuffer(),E=y.__size,x=y.usage;return e.bindBuffer(e.UNIFORM_BUFFER,A),e.bufferData(e.UNIFORM_BUFFER,E,x),e.bindBuffer(e.UNIFORM_BUFFER,null),e.bindBufferBase(e.UNIFORM_BUFFER,T,A),A}function p(){for(let y=0;y<o;y++)if(r.indexOf(y)===-1)return r.push(y),y;return Vt("WebGLRenderer: Maximum number of simultaneously usable uniforms groups reached."),0}function u(y){let T=a[y.id],A=y.uniforms,E=y.__cache;e.bindBuffer(e.UNIFORM_BUFFER,T);for(let x=0,w=A.length;x<w;x++){let R=A[x];if(Array.isArray(R))for(let D=0,P=R.length;D<P;D++)d(R[D],x,D,E);else d(R,x,0,E)}e.bindBuffer(e.UNIFORM_BUFFER,null)}function d(y,T,A,E){if(b(y,T,A,E)===!0){let x=y.__offset,w=y.value;if(Array.isArray(w)){let R=0;for(let D=0;D<w.length;D++){let P=w[D],F=h(P);_(P,y.__data,R),typeof P!="number"&&typeof P!="boolean"&&!P.isMatrix3&&!ArrayBuffer.isView(P)&&(R+=F.storage/Float32Array.BYTES_PER_ELEMENT)}}else _(w,y.__data,0);e.bufferSubData(e.UNIFORM_BUFFER,x,y.__data)}}function _(y,T,A){typeof y=="number"||typeof y=="boolean"?T[0]=y:y.isMatrix3?(T[0]=y.elements[0],T[1]=y.elements[1],T[2]=y.elements[2],T[3]=0,T[4]=y.elements[3],T[5]=y.elements[4],T[6]=y.elements[5],T[7]=0,T[8]=y.elements[6],T[9]=y.elements[7],T[10]=y.elements[8],T[11]=0):ArrayBuffer.isView(y)?T.set(new y.constructor(y.buffer,y.byteOffset,T.length)):y.toArray(T,A)}function b(y,T,A,E){let x=y.value,w=T+"_"+A;if(E[w]===void 0)return typeof x=="number"||typeof x=="boolean"?E[w]=x:ArrayBuffer.isView(x)?E[w]=x.slice():E[w]=x.clone(),!0;{let R=E[w];if(typeof x=="number"||typeof x=="boolean"){if(R!==x)return E[w]=x,!0}else{if(ArrayBuffer.isView(x))return!0;if(R.equals(x)===!1)return R.copy(x),!0}}return!1}function m(y){let T=y.uniforms,A=0,E=16;for(let w=0,R=T.length;w<R;w++){let D=Array.isArray(T[w])?T[w]:[T[w]];for(let P=0,F=D.length;P<F;P++){let U=D[P],B=Array.isArray(U.value)?U.value:[U.value];for(let X=0,Z=B.length;X<Z;X++){let $=B[X],z=h($),K=A%E,j=K%z.boundary,vt=K+j;A+=j,vt!==0&&E-vt<z.storage&&(A+=E-vt),U.__data=new Float32Array(z.storage/Float32Array.BYTES_PER_ELEMENT),U.__offset=A,A+=z.storage}}}let x=A%E;return x>0&&(A+=E-x),y.__size=A,y.__cache={},this}function h(y){let T={boundary:0,storage:0};return typeof y=="number"||typeof y=="boolean"?(T.boundary=4,T.storage=4):y.isVector2?(T.boundary=8,T.storage=8):y.isVector3||y.isColor?(T.boundary=16,T.storage=12):y.isVector4?(T.boundary=16,T.storage=16):y.isMatrix3?(T.boundary=48,T.storage=48):y.isMatrix4?(T.boundary=64,T.storage=64):y.isTexture?Ft("WebGLRenderer: Texture samplers can not be part of an uniforms group."):ArrayBuffer.isView(y)?(T.boundary=16,T.storage=y.byteLength):Ft("WebGLRenderer: Unsupported uniform value type.",y),T}function g(y){let T=y.target;T.removeEventListener("dispose",g);let A=r.indexOf(T.__bindingPointIndex);r.splice(A,1),e.deleteBuffer(a[T.id]),delete a[T.id],delete s[T.id]}function S(){for(let y in a)e.deleteBuffer(a[y]);r=[],a={},s={}}return{bind:l,update:c,dispose:S}}var ZD=new Uint16Array([12469,15057,12620,14925,13266,14620,13807,14376,14323,13990,14545,13625,14713,13328,14840,12882,14931,12528,14996,12233,15039,11829,15066,11525,15080,11295,15085,10976,15082,10705,15073,10495,13880,14564,13898,14542,13977,14430,14158,14124,14393,13732,14556,13410,14702,12996,14814,12596,14891,12291,14937,11834,14957,11489,14958,11194,14943,10803,14921,10506,14893,10278,14858,9960,14484,14039,14487,14025,14499,13941,14524,13740,14574,13468,14654,13106,14743,12678,14818,12344,14867,11893,14889,11509,14893,11180,14881,10751,14852,10428,14812,10128,14765,9754,14712,9466,14764,13480,14764,13475,14766,13440,14766,13347,14769,13070,14786,12713,14816,12387,14844,11957,14860,11549,14868,11215,14855,10751,14825,10403,14782,10044,14729,9651,14666,9352,14599,9029,14967,12835,14966,12831,14963,12804,14954,12723,14936,12564,14917,12347,14900,11958,14886,11569,14878,11247,14859,10765,14828,10401,14784,10011,14727,9600,14660,9289,14586,8893,14508,8533,15111,12234,15110,12234,15104,12216,15092,12156,15067,12010,15028,11776,14981,11500,14942,11205,14902,10752,14861,10393,14812,9991,14752,9570,14682,9252,14603,8808,14519,8445,14431,8145,15209,11449,15208,11451,15202,11451,15190,11438,15163,11384,15117,11274,15055,10979,14994,10648,14932,10343,14871,9936,14803,9532,14729,9218,14645,8742,14556,8381,14461,8020,14365,7603,15273,10603,15272,10607,15267,10619,15256,10631,15231,10614,15182,10535,15118,10389,15042,10167,14963,9787,14883,9447,14800,9115,14710,8665,14615,8318,14514,7911,14411,7507,14279,7198,15314,9675,15313,9683,15309,9712,15298,9759,15277,9797,15229,9773,15166,9668,15084,9487,14995,9274,14898,8910,14800,8539,14697,8234,14590,7790,14479,7409,14367,7067,14178,6621,15337,8619,15337,8631,15333,8677,15325,8769,15305,8871,15264,8940,15202,8909,15119,8775,15022,8565,14916,8328,14804,8009,14688,7614,14569,7287,14448,6888,14321,6483,14088,6171,15350,7402,15350,7419,15347,7480,15340,7613,15322,7804,15287,7973,15229,8057,15148,8012,15046,7846,14933,7611,14810,7357,14682,7069,14552,6656,14421,6316,14251,5948,14007,5528,15356,5942,15356,5977,15353,6119,15348,6294,15332,6551,15302,6824,15249,7044,15171,7122,15070,7050,14949,6861,14818,6611,14679,6349,14538,6067,14398,5651,14189,5311,13935,4958,15359,4123,15359,4153,15356,4296,15353,4646,15338,5160,15311,5508,15263,5829,15188,6042,15088,6094,14966,6001,14826,5796,14678,5543,14527,5287,14377,4985,14133,4586,13869,4257,15360,1563,15360,1642,15358,2076,15354,2636,15341,3350,15317,4019,15273,4429,15203,4732,15105,4911,14981,4932,14836,4818,14679,4621,14517,4386,14359,4156,14083,3795,13808,3437,15360,122,15360,137,15358,285,15355,636,15344,1274,15322,2177,15281,2765,15215,3223,15120,3451,14995,3569,14846,3567,14681,3466,14511,3305,14344,3121,14037,2800,13753,2467,15360,0,15360,1,15359,21,15355,89,15346,253,15325,479,15287,796,15225,1148,15133,1492,15008,1749,14856,1882,14685,1886,14506,1783,14324,1608,13996,1398,13702,1183]),ua=null;function JD(){return ua===null&&(ua=new fh(ZD,16,16,Us,Pi),ua.name="DFG_LUT",ua.minFilter=mn,ua.magFilter=mn,ua.wrapS=ia,ua.wrapT=ia,ua.generateMipmaps=!1,ua.needsUpdate=!0),ua}var xd=class{constructor(t={}){let{canvas:n=FM(),context:i=null,depth:a=!0,stencil:s=!1,alpha:r=!1,antialias:o=!1,premultipliedAlpha:l=!0,preserveDrawingBuffer:c=!1,powerPreference:f="default",failIfMajorPerformanceCaveat:p=!1,reversedDepthBuffer:u=!1,outputBufferType:d=ai}=t;this.isWebGLRenderer=!0;let _;if(i!==null){if(typeof WebGLRenderingContext<"u"&&i instanceof WebGLRenderingContext)throw new Error("THREE.WebGLRenderer: WebGL 1 is not supported since r163.");_=i.getContextAttributes().alpha}else _=r;let b=d,m=new Set([Ph,Ih,Oh]),h=new Set([ai,Oi,Go,ko,Uh,Lh]),g=new Uint32Array(4),S=new Int32Array(4),y=new W,T=null,A=null,E=[],x=[],w=null;this.domElement=n,this.debug={checkShaderErrors:!0,diagnostics:{keywords:!1},onShaderError:null},this.autoClear=!0,this.autoClearColor=!0,this.autoClearDepth=!0,this.autoClearStencil=!0,this.sortObjects=!0,this.clippingPlanes=[],this.localClippingEnabled=!1,this.toneMapping=Li,this.toneMappingExposure=1,this.transmissionResolutionScale=1;let R=this,D=!1,P=null,F=null,U=null,B=null;this._outputColorSpace=ni;let X=0,Z=0,$=null,z=-1,K=null,j=new Fe,vt=new Fe,yt=null,$t=new Zt(0),Et=0,Pt=n.width,k=n.height,Y=1,lt=null,xt=null,ot=new Fe(0,0,Pt,k),at=new Fe(0,0,Pt,k),Ut=!1,Ct=new mc,Bt=!1,Wt=!1,Ot=new Xe,ie=new W,de=new Fe,Be={background:null,fog:null,environment:null,overrideMaterial:null,isScene:!0},ce=!1;function be(){return $===null?Y:1}let N=i;function jt(M,L){return n.getContext(M,L)}let zt,C,v,I,H,J,st,it,Q,et,ct,At,ut,ft,Nt,It,qt,O,ht,tt,dt,_t,rt;try{let M={alpha:!0,depth:a,stencil:s,antialias:o,premultipliedAlpha:l,preserveDrawingBuffer:c,powerPreference:f,failIfMajorPerformanceCaveat:p};if("setAttribute"in n&&n.setAttribute("data-engine",`three.js r${"186"}`),n.addEventListener("webglcontextlost",we,!1),n.addEventListener("webglcontextrestored",pe,!1),n.addEventListener("webglcontextcreationerror",Si,!1),N===null){let L="webgl2";if(N=jt(L,M),N===null)throw jt(L)?new Error("THREE.WebGLRenderer: Error creating WebGL context with your selected attributes."):new Error("THREE.WebGLRenderer: Error creating WebGL context.")}Lt()}catch(M){throw n.removeEventListener("webglcontextlost",we,!1),n.removeEventListener("webglcontextrestored",pe,!1),n.removeEventListener("webglcontextcreationerror",Si,!1),Vt("WebGLRenderer: "+M.message),M}function Lt(){zt=new nR(N),zt.init(),dt=new GD(N,zt),C=new q3(N,zt,t,dt),v=new HD(N,zt),C.reversedDepthBuffer&&u&&v.buffers.depth.setReversed(!0),F=N.createFramebuffer(),U=N.createFramebuffer(),B=N.createFramebuffer(),I=new sR(N),H=new AD,J=new VD(N,zt,v,H,C,dt,I),st=new eR(R),it=new o2(N),_t=new X3(N,it),Q=new iR(N,it,I,_t),et=new oR(N,Q,it,_t,I),O=new rR(N,C,J),Nt=new Y3(H),ct=new ED(R,st,zt,C,_t,Nt),At=new qD(R,H),ut=new CD,ft=new OD(zt),qt=new k3(R,st,v,et,_,l),It=new FD(R,et,C),rt=new YD(N,I,C,v),ht=new W3(N,zt,I),tt=new aR(N,zt,I),I.programs=ct.programs,R.capabilities=C,R.extensions=zt,R.properties=H,R.renderLists=ut,R.shadowMap=It,R.state=v,R.info=I}b!==ai&&(w=new cR(b,n.width,n.height,o,a,s));let wt=new Yg(R,N);this.xr=wt,this.getContext=function(){return N},this.getContextAttributes=function(){return N.getContextAttributes()},this.forceContextLoss=function(){let M=zt.get("WEBGL_lose_context");M&&M.loseContext()},this.forceContextRestore=function(){let M=zt.get("WEBGL_lose_context");M&&M.restoreContext()},this.getPixelRatio=function(){return Y},this.setPixelRatio=function(M){M!==void 0&&(Y=M,this.setSize(Pt,k,!1))},this.getSize=function(M){return M.set(Pt,k)},this.setSize=function(M,L,q=!0){if(wt.isPresenting){Ft("WebGLRenderer: Can't change size while VR device is presenting.");return}Pt=M,k=L,n.width=Math.floor(M*Y),n.height=Math.floor(L*Y),q===!0&&(n.style.width=M+"px",n.style.height=L+"px"),w!==null&&w.setSize(n.width,n.height),this.setViewport(0,0,M,L)},this.getDrawingBufferSize=function(M){return M.set(Pt*Y,k*Y).floor()},this.setDrawingBufferSize=function(M,L,q){Pt=M,k=L,Y=q,n.width=Math.floor(M*q),n.height=Math.floor(L*q),this.setViewport(0,0,M,L)},this.setEffects=function(M){if(b===ai){Vt("WebGLRenderer: setEffects() requires outputBufferType set to HalfFloatType or FloatType.");return}if(M){for(let L=0;L<M.length;L++)if(M[L].isOutputPass===!0){Ft("WebGLRenderer: OutputPass is not needed in setEffects(). Tone mapping and color space conversion are applied automatically.");break}}w.setEffects(M||[])},this.getCurrentViewport=function(M){return M.copy(j)},this.getViewport=function(M){return M.copy(ot)},this.setViewport=function(M,L,q,V){M.isVector4?ot.set(M.x,M.y,M.z,M.w):ot.set(M,L,q,V),v.viewport(j.copy(ot).multiplyScalar(Y).round())},this.getScissor=function(M){return M.copy(at)},this.setScissor=function(M,L,q,V){M.isVector4?at.set(M.x,M.y,M.z,M.w):at.set(M,L,q,V),v.scissor(vt.copy(at).multiplyScalar(Y).round())},this.getScissorTest=function(){return Ut},this.setScissorTest=function(M){v.setScissorTest(Ut=M)},this.setOpaqueSort=function(M){lt=M},this.setTransparentSort=function(M){xt=M},this.getClearColor=function(M){return M.copy(qt.getClearColor())},this.setClearColor=function(){qt.setClearColor(...arguments)},this.getClearAlpha=function(){return qt.getClearAlpha()},this.setClearAlpha=function(){qt.setClearAlpha(...arguments)},this.clear=function(M=!0,L=!0,q=!0){let V=0;if(M){let G=!1;if($!==null){let gt=$.texture.format;G=m.has(gt)}if(G){let gt=$.texture.type,Mt=h.has(gt),mt=qt.getClearColor(),bt=qt.getClearAlpha(),Rt=mt.r,Jt=mt.g,te=mt.b;Mt?(g[0]=Rt,g[1]=Jt,g[2]=te,g[3]=bt,N.clearBufferuiv(N.COLOR,0,g)):(S[0]=Rt,S[1]=Jt,S[2]=te,S[3]=bt,N.clearBufferiv(N.COLOR,0,S))}else V|=N.COLOR_BUFFER_BIT}L&&(V|=N.DEPTH_BUFFER_BIT,this.state.buffers.depth.setMask(!0)),q&&(V|=N.STENCIL_BUFFER_BIT,this.state.buffers.stencil.setMask(4294967295)),V!==0&&N.clear(V)},this.clearColor=function(){this.clear(!0,!1,!1)},this.clearDepth=function(){this.clear(!1,!0,!1)},this.clearStencil=function(){this.clear(!1,!1,!0)},this.setNodesHandler=function(M){M.setRenderer(this),P=M},this.dispose=function(){n.removeEventListener("webglcontextlost",we,!1),n.removeEventListener("webglcontextrestored",pe,!1),n.removeEventListener("webglcontextcreationerror",Si,!1),qt.dispose(),ut.dispose(),ft.dispose(),H.dispose(),st.dispose(),et.dispose(),_t.dispose(),rt.dispose(),ct.dispose(),wt.dispose(),wt.removeEventListener("sessionstart",sv),wt.removeEventListener("sessionend",rv),Os.stop()};function we(M){M.preventDefault(),Cg("WebGLRenderer: Context Lost."),D=!0}function pe(){Cg("WebGLRenderer: Context Restored."),D=!1;let M=I.autoReset,L=It.enabled,q=It.autoUpdate,V=It.needsUpdate,G=It.type;Lt(),I.autoReset=M,It.enabled=L,It.autoUpdate=q,It.needsUpdate=V,It.type=G}function Si(M){Vt("WebGLRenderer: A WebGL context could not be created. Reason: ",M.statusMessage)}function zi(M){let L=M.target;L.removeEventListener("dispose",zi),Hb(L)}function Hb(M){Vb(M),H.remove(M)}function Vb(M){let L=H.get(M).programs;L!==void 0&&(L.forEach(function(q){ct.releaseProgram(q)}),M.isShaderMaterial&&ct.releaseShaderCache(M))}this.renderBufferDirect=function(M,L,q,V,G,gt){L===null&&(L=Be);let Mt=G.isMesh&&G.matrixWorld.determinantAffine()<0,mt=Xb(M,L,q,V,G);v.setMaterial(V,Mt);let bt=q.index,Rt=1;if(V.wireframe===!0){if(bt=Q.getWireframeAttribute(q),bt===void 0)return;Rt=2}let Jt=q.drawRange,te=q.attributes.position,Tt=Jt.start*Rt,me=(Jt.start+Jt.count)*Rt;gt!==null&&(Tt=Math.max(Tt,gt.start*Rt),me=Math.min(me,(gt.start+gt.count)*Rt)),bt!==null?(Tt=Math.max(Tt,0),me=Math.min(me,bt.count)):te!=null&&(Tt=Math.max(Tt,0),me=Math.min(me,te.count));let We=me-Tt;if(We<0||We===1/0)return;_t.setup(G,V,mt,q,bt);let Le,Te=ht;if(bt!==null&&(Le=it.get(bt),Te=tt,Te.setIndex(Le)),G.isMesh)V.wireframe===!0?(v.setLineWidth(V.wireframeLinewidth*be()),Te.setMode(N.LINES)):Te.setMode(N.TRIANGLES);else if(G.isLine){let gn=V.linewidth;gn===void 0&&(gn=1),v.setLineWidth(gn*be()),G.isLineSegments?Te.setMode(N.LINES):G.isLineLoop?Te.setMode(N.LINE_LOOP):Te.setMode(N.LINE_STRIP)}else G.isPoints?Te.setMode(N.POINTS):G.isSprite&&Te.setMode(N.TRIANGLES);if(G.isBatchedMesh)if(zt.get("WEBGL_multi_draw"))Te.renderMultiDraw(G._multiDrawStarts,G._multiDrawCounts,G._multiDrawCount);else{let gn=G._multiDrawStarts,St=G._multiDrawCounts,bn=G._multiDrawCount,le=bt?it.get(bt).bytesPerElement:1,si=H.get(V).currentProgram.getUniforms();for(let Fi=0;Fi<bn;Fi++)si.setValue(N,"_gl_DrawID",Fi),Te.render(gn[Fi]/le,St[Fi])}else if(G.isInstancedMesh)Te.renderInstances(Tt,We,G.count);else if(q.isInstancedBufferGeometry){let gn=q._maxInstanceCount!==void 0?q._maxInstanceCount:1/0,St=Math.min(q.instanceCount,gn);Te.renderInstances(Tt,We,St)}else Te.render(Tt,We)};function av(M,L,q,V){P!==null&&M.isNodeMaterial&&P.setObject(V,M),Bt===!0&&Nt.setState(M,q,!1),M.transparent===!0&&M.side===la&&M.forceSinglePass===!1?(M.side=Dn,M.needsUpdate=!0,Fc(M,L,V),M.side=ws,M.needsUpdate=!0,Fc(M,L,V),M.side=la):Fc(M,L,V)}this.compile=function(M,L,q=null){q===null&&(q=M),P!==null&&P.renderStart(M,L,q),A=ft.get(q),A.init(L),x.push(A),q.traverseVisible(function(G){G.isLight&&G.layers.test(L.layers)&&(A.pushLight(G),G.castShadow&&A.pushShadow(G))}),M!==q&&M.traverseVisible(function(G){G.isLight&&G.layers.test(L.layers)&&(A.pushLight(G),G.castShadow&&A.pushShadow(G))}),A.setupLights(),P!==null&&P.updateLights(A.state.lightsArray),Wt=this.localClippingEnabled,Bt=Nt.init(this.clippingPlanes,Wt),Bt===!0&&Nt.setGlobalState(this.clippingPlanes,L),P!==null&&It.render(A.state.shadowsArray,q,L);let V=new Set;return M.traverse(function(G){if(!(G.isMesh||G.isPoints||G.isLine||G.isSprite))return;let gt=G.material;if(gt)if(Array.isArray(gt))for(let Mt=0;Mt<gt.length;Mt++){let mt=gt[Mt];av(mt,q,L,G),V.add(mt)}else av(gt,q,L,G),V.add(gt)}),A=x.pop(),P!==null&&P.renderEnd(),V},this.compileAsync=function(M,L,q=null){let V=this.compile(M,L,q);return new Promise(G=>{function gt(){if(V.forEach(function(Mt){let bt=H.get(Mt).currentProgram;(bt===void 0||bt.isReady())&&V.delete(Mt)}),V.size===0){G(M);return}setTimeout(gt,10)}zt.get("KHR_parallel_shader_compile")!==null?gt():setTimeout(gt,10)})};let Ed=null;function Gb(M){Ed&&Ed(M)}function sv(){Os.stop()}function rv(){Os.start()}let Os=new pb;Os.setAnimationLoop(Gb),typeof self<"u"&&Os.setContext(self),this.setAnimationLoop=function(M){Ed=M,wt.setAnimationLoop(M),M===null?Os.stop():Os.start()},wt.addEventListener("sessionstart",sv),wt.addEventListener("sessionend",rv),this.render=function(M,L){if(L!==void 0&&L.isCamera!==!0){Vt("WebGLRenderer.render: camera is not an instance of THREE.Camera.");return}if(D===!0)return;P!==null&&P.renderStart(M,L);let q=wt.enabled===!0&&wt.isPresenting===!0,V=w!==null&&($===null||q)&&w.begin(R,$);if(M.matrixWorldAutoUpdate===!0&&M.updateMatrixWorld(),L.parent===null&&L.matrixWorldAutoUpdate===!0&&L.updateMatrixWorld(),wt.enabled===!0&&wt.isPresenting===!0&&(w===null||w.isCompositing()===!1)&&(wt.cameraAutoUpdate===!0&&wt.updateCamera(L),L=wt.getCamera()),M.isScene===!0&&M.onBeforeRender(R,M,L,$),A=ft.get(M,x.length),A.init(L),A.state.textureUnits=J.getTextureUnits(),x.push(A),Ot.multiplyMatrices(L.projectionMatrix,L.matrixWorldInverse),Ct.setFromProjectionMatrix(Ot,Ui,L.reversedDepth),Wt=this.localClippingEnabled,Bt=Nt.init(this.clippingPlanes,Wt),T=ut.get(M,E.length),T.init(),E.push(T),wt.enabled===!0&&wt.isPresenting===!0){let Mt=R.xr.getDepthSensingMesh();Mt!==null&&Ad(Mt,L,-1/0,R.sortObjects)}Ad(M,L,0,R.sortObjects),T.finish(),P!==null&&P.updateLights(A.state.lightsArray),R.sortObjects===!0&&T.sort(lt,xt),ce=wt.enabled===!1||wt.isPresenting===!1||wt.hasDepthSensing()===!1,ce&&qt.addToRenderList(T,M),this.info.render.frame++,this.info.autoReset===!0&&this.info.reset(),Bt===!0&&Nt.beginShadows();let G=A.state.shadowsArray;if(It.render(G,M,L),Bt===!0&&Nt.endShadows(),(V&&w.hasRenderPass())===!1){let Mt=T.opaque,mt=T.transmissive;if(A.setupLights(),L.isArrayCamera){let bt=L.cameras;if(mt.length>0)for(let Rt=0,Jt=bt.length;Rt<Jt;Rt++){let te=bt[Rt];lv(Mt,mt,M,te)}ce&&qt.render(M);for(let Rt=0,Jt=bt.length;Rt<Jt;Rt++){let te=bt[Rt];ov(T,M,te,te.viewport)}}else mt.length>0&&lv(Mt,mt,M,L),ce&&qt.render(M),ov(T,M,L)}$!==null&&Z===0&&(J.updateMultisampleRenderTarget($),J.updateRenderTargetMipmap($)),V&&w.end(R),M.isScene===!0&&M.onAfterRender(R,M,L),_t.resetDefaultState(),z=-1,K=null,x.pop(),x.length>0?(A=x[x.length-1],J.setTextureUnits(A.state.textureUnits),Bt===!0&&Nt.setGlobalState(R.clippingPlanes,A.state.camera)):A=null,E.pop(),E.length>0?T=E[E.length-1]:T=null,P!==null&&P.renderEnd()};function Ad(M,L,q,V){if(M.visible===!1)return;if(M.layers.test(L.layers)){if(M.isGroup)q=M.renderOrder;else if(M.isLOD)M.autoUpdate===!0&&M.update(L);else if(M.isLightProbeGrid)A.pushLightProbeGrid(M);else if(M.isLight)A.pushLight(M),M.castShadow&&A.pushShadow(M);else if(M.isSprite){if(!M.frustumCulled||M.intersectsFrustum(Ct)){V&&de.setFromMatrixPosition(M.matrixWorld).applyMatrix4(Ot);let Mt=et.update(M),mt=M.material;mt.visible&&T.push(M,Mt,mt,q,de.z,null,L)}}else if((M.isMesh||M.isLine||M.isPoints)&&(!M.frustumCulled||M.intersectsFrustum(Ct))){let Mt=et.update(M),mt=M.material;if(V&&(M.boundingSphere!==void 0?(M.boundingSphere===null&&M.computeBoundingSphere(),de.copy(M.boundingSphere.center)):(Mt.boundingSphere===null&&Mt.computeBoundingSphere(),de.copy(Mt.boundingSphere.center)),de.applyMatrix4(M.matrixWorld).applyMatrix4(Ot)),Array.isArray(mt)){let bt=Mt.groups;for(let Rt=0,Jt=bt.length;Rt<Jt;Rt++){let te=bt[Rt],Tt=mt[te.materialIndex];Tt&&Tt.visible&&T.push(M,Mt,Tt,q,de.z,te,L)}}else mt.visible&&T.push(M,Mt,mt,q,de.z,null,L)}}let gt=M.children;for(let Mt=0,mt=gt.length;Mt<mt;Mt++)Ad(gt[Mt],L,q,V)}function ov(M,L,q,V){let{opaque:G,transmissive:gt,transparent:Mt}=M;A.setupLightsView(q),Bt===!0&&Nt.setGlobalState(R.clippingPlanes,q),V&&v.viewport(j.copy(V)),G.length>0&&zc(G,L,q),gt.length>0&&zc(gt,L,q),Mt.length>0&&zc(Mt,L,q),v.buffers.depth.setTest(!0),v.buffers.depth.setMask(!0),v.buffers.color.setMask(!0),v.setPolygonOffset(!1)}function lv(M,L,q,V){if((q.isScene===!0?q.overrideMaterial:null)!==null)return;if(A.state.transmissionRenderTarget[V.id]===void 0){let Tt=zt.has("EXT_color_buffer_half_float")||zt.has("EXT_color_buffer_float");A.state.transmissionRenderTarget[V.id]=new Vn(1,1,{generateMipmaps:!0,type:Tt?Pi:ai,minFilter:Ds,samples:Math.max(4,C.samples),stencilBuffer:s,resolveDepthBuffer:!1,resolveStencilBuffer:!1,storeMultisampledDepthBuffer:!1,storeMultisampledStencilBuffer:!1,colorSpace:se.workingColorSpace})}let gt=A.state.transmissionRenderTarget[V.id],Mt=V.viewport||j;gt.setSize(Mt.z*R.transmissionResolutionScale,Mt.w*R.transmissionResolutionScale);let mt=R.getRenderTarget(),bt=R.getActiveCubeFace(),Rt=R.getActiveMipmapLevel();R.setRenderTarget(gt),R.getClearColor($t),Et=R.getClearAlpha(),Et<1&&R.setClearColor(16777215,.5),R.clear(),ce&&qt.render(q);let Jt=R.toneMapping;R.toneMapping=Li;let te=V.viewport;if(V.viewport!==void 0&&(V.viewport=void 0),A.setupLightsView(V),Bt===!0&&Nt.setGlobalState(R.clippingPlanes,V),zc(M,q,V),J.updateMultisampleRenderTarget(gt),J.updateRenderTargetMipmap(gt),zt.has("WEBGL_multisampled_render_to_texture")===!1){let Tt=!1;for(let me=0,We=L.length;me<We;me++){let Le=L[me],{object:Te,geometry:gn,material:St,group:bn}=Le;if(St.side===la&&Te.layers.test(V.layers)){let le=St.side;St.side=Dn,St.needsUpdate=!0,cv(Te,q,V,gn,St,bn),St.side=le,St.needsUpdate=!0,Tt=!0}}Tt===!0&&(J.updateMultisampleRenderTarget(gt),J.updateRenderTargetMipmap(gt))}R.setRenderTarget(mt,bt,Rt),R.setClearColor($t,Et),te!==void 0&&(V.viewport=te),R.toneMapping=Jt}function zc(M,L,q){let V=L.isScene===!0?L.overrideMaterial:null;for(let G=0,gt=M.length;G<gt;G++){let Mt=M[G],{object:mt,geometry:bt,group:Rt}=Mt,Jt=Mt.material;Jt.allowOverride===!0&&V!==null&&(Jt=V),mt.layers.test(q.layers)&&cv(mt,L,q,bt,Jt,Rt)}}function cv(M,L,q,V,G,gt){P!==null&&G.isNodeMaterial&&P.setObject(M,G),M.onBeforeRender(R,L,q,V,G,gt),M.modelViewMatrix.multiplyMatrices(q.matrixWorldInverse,M.matrixWorld),M.normalMatrix.getNormalMatrix(M.modelViewMatrix),G.onBeforeRender(R,L,q,V,M,gt),G.transparent===!0&&G.side===la&&G.forceSinglePass===!1?(G.side=Dn,G.needsUpdate=!0,R.renderBufferDirect(q,L,V,G,M,gt),G.side=ws,G.needsUpdate=!0,R.renderBufferDirect(q,L,V,G,M,gt),G.side=la):R.renderBufferDirect(q,L,V,G,M,gt),M.onAfterRender(R,L,q,V,G,gt)}function Fc(M,L,q){L.isScene!==!0&&(L=Be);let V=H.get(M),G=A.state.lights,gt=A.state.shadowsArray,Mt=G.state.version,mt=ct.getParameters(M,G.state,gt,L,q,A.state.lightProbeGridArray),bt=ct.getProgramCacheKey(mt),Rt=V.programs;V.environment=M.isMeshStandardMaterial||M.isMeshLambertMaterial||M.isMeshPhongMaterial?L.environment:null,V.fog=L.fog;let Jt=M.isMeshStandardMaterial||M.isMeshLambertMaterial&&!M.envMap||M.isMeshPhongMaterial&&!M.envMap;V.envMap=st.get(M.envMap||V.environment,Jt),V.envMapRotation=V.environment!==null&&M.envMap===null?L.environmentRotation:M.envMapRotation,Rt===void 0&&(M.addEventListener("dispose",zi),Rt=new Map,V.programs=Rt);let te=Rt.get(bt);if(te!==void 0){if(V.currentProgram===te&&V.lightsStateVersion===Mt)return fv(M,mt),te}else mt.uniforms=ct.getUniforms(M),P!==null&&M.isNodeMaterial&&P.build(M,q,mt),M.onBeforeCompile(mt,R),te=ct.acquireProgram(mt,bt),Rt.set(bt,te),V.uniforms=mt.uniforms;let Tt=V.uniforms;return(!M.isShaderMaterial&&!M.isRawShaderMaterial||M.clipping===!0)&&(Tt.clippingPlanes=Nt.uniform),fv(M,mt),V.needsLights=qb(M),V.lightsStateVersion=Mt,V.needsLights&&(Tt.ambientLightColor.value=G.state.ambient,Tt.lightProbe.value=G.state.probe,Tt.sunLights.value=G.state.sun,Tt.sunLightShadows.value=G.state.sunShadow,Tt.directionalLights.value=G.state.directional,Tt.directionalLightShadows.value=G.state.directionalShadow,Tt.spotLights.value=G.state.spot,Tt.spotLightShadows.value=G.state.spotShadow,Tt.rectAreaLights.value=G.state.rectArea,Tt.ltc_1.value=G.state.rectAreaLTC1,Tt.ltc_2.value=G.state.rectAreaLTC2,Tt.pointLights.value=G.state.point,Tt.pointLightShadows.value=G.state.pointShadow,Tt.hemisphereLights.value=G.state.hemi,Tt.sunShadowMatrix.value=G.state.sunShadowMatrix,Tt.sunShadowCascade.value=G.state.sunShadowCascade,Tt.directionalShadowMatrix.value=G.state.directionalShadowMatrix,Tt.spotLightMatrix.value=G.state.spotLightMatrix,Tt.spotLightMap.value=G.state.spotLightMap,Tt.pointShadowMatrix.value=G.state.pointShadowMatrix),V.lightProbeGrid=A.state.lightProbeGridArray.length>0,V.currentProgram=te,V.uniformsList=null,te}function uv(M){if(M.uniformsList===null){let L=M.currentProgram.getUniforms();M.uniformsList=qo.seqWithValue(L.seq,M.uniforms)}return M.uniformsList}function fv(M,L){let q=H.get(M);q.outputColorSpace=L.outputColorSpace,q.batching=L.batching,q.batchingColor=L.batchingColor,q.instancing=L.instancing,q.instancingColor=L.instancingColor,q.instancingMorph=L.instancingMorph,q.skinning=L.skinning,q.morphTargets=L.morphTargets,q.morphNormals=L.morphNormals,q.morphColors=L.morphColors,q.morphTargetsCount=L.morphTargetsCount,q.numClippingPlanes=L.numClippingPlanes,q.numIntersection=L.numClipIntersection,q.vertexAlphas=L.vertexAlphas,q.vertexTangents=L.vertexTangents,q.toneMapping=L.toneMapping}function kb(M,L){if(M.length===0)return null;if(M.length===1)return M[0].texture!==null?M[0]:null;y.setFromMatrixPosition(L.matrixWorld);for(let q=0,V=M.length;q<V;q++){let G=M[q];if(G.texture!==null&&G.boundingBox.containsPoint(y))return G}return null}function Xb(M,L,q,V,G){L.isScene!==!0&&(L=Be),J.resetTextureUnits();let gt=L.fog,Mt=V.isMeshStandardMaterial||V.isMeshLambertMaterial||V.isMeshPhongMaterial?L.environment:null,mt=$===null?R.outputColorSpace:$.isXRRenderTarget===!0?$.texture.colorSpace:se.workingColorSpace,bt=V.isMeshStandardMaterial||V.isMeshLambertMaterial&&!V.envMap||V.isMeshPhongMaterial&&!V.envMap,Rt=st.get(V.envMap||Mt,bt),Jt=V.vertexColors===!0&&!!q.attributes.color&&q.attributes.color.itemSize===4,te=!!q.attributes.tangent&&(!!V.normalMap||V.anisotropy>0),Tt=!!q.morphAttributes.position,me=!!q.morphAttributes.normal,We=!!q.morphAttributes.color,Le=Li;V.toneMapped&&($===null||$.isXRRenderTarget===!0)&&(Le=R.toneMapping);let Te=q.morphAttributes.position||q.morphAttributes.normal||q.morphAttributes.color,gn=Te!==void 0?Te.length:0,St=H.get(V),bn=A.state.lights;if(Bt===!0&&(Wt===!0||M!==K)){let Ce=M===K&&V.id===z;Nt.setState(V,M,Ce)}let le=!1;V.version===St.__version?(St.needsLights&&St.lightsStateVersion!==bn.state.version||St.outputColorSpace!==mt||G.isBatchedMesh&&St.batching===!1||!G.isBatchedMesh&&St.batching===!0||G.isBatchedMesh&&St.batchingColor===!0&&G._colorsTexture===null||G.isBatchedMesh&&St.batchingColor===!1&&G._colorsTexture!==null||G.isInstancedMesh&&St.instancing===!1||!G.isInstancedMesh&&St.instancing===!0||G.isSkinnedMesh&&St.skinning===!1||!G.isSkinnedMesh&&St.skinning===!0||G.isInstancedMesh&&St.instancingColor===!0&&G.instanceColor===null||G.isInstancedMesh&&St.instancingColor===!1&&G.instanceColor!==null||G.isInstancedMesh&&St.instancingMorph===!0&&G.morphTexture===null||G.isInstancedMesh&&St.instancingMorph===!1&&G.morphTexture!==null||St.envMap!==Rt||V.fog===!0&&St.fog!==gt||St.numClippingPlanes!==void 0&&(St.numClippingPlanes!==Nt.numPlanes||St.numIntersection!==Nt.numIntersection)||St.vertexAlphas!==Jt||St.vertexTangents!==te||St.morphTargets!==Tt||St.morphNormals!==me||St.morphColors!==We||St.toneMapping!==Le||St.morphTargetsCount!==gn||!!St.lightProbeGrid!=A.state.lightProbeGridArray.length>0)&&(le=!0):(le=!0,St.__version=V.version);let si=St.currentProgram;le===!0&&(si=Fc(V,L,G),P&&V.isNodeMaterial&&P.onUpdateProgram(V,si,St));let Fi=!1,Ia=!1,yr=!1,Se=si.getUniforms(),Ge=St.uniforms;if(v.useProgram(si.program)&&(Fi=!0,Ia=!0,yr=!0),V.id!==z&&(z=V.id,Ia=!0),St.needsLights){let Ce=kb(A.state.lightProbeGridArray,G);St.lightProbeGrid!==Ce&&(St.lightProbeGrid=Ce,Ia=!0)}if(Fi||K!==M){v.buffers.depth.getReversed()&&M.reversedDepth!==!0&&(M._reversedDepth=!0,M.updateProjectionMatrix()),Se.setValue(N,"projectionMatrix",M.projectionMatrix),Se.setValue(N,"viewMatrix",M.matrixWorldInverse);let Ba=Se.map.cameraPosition;Ba!==void 0&&Ba.setValue(N,ie.setFromMatrixPosition(M.matrixWorld)),C.logarithmicDepthBuffer&&Se.setValue(N,"logDepthBufFC",2/(Math.log(M.far+1)/Math.LN2)),(V.isMeshPhongMaterial||V.isMeshToonMaterial||V.isMeshLambertMaterial||V.isMeshBasicMaterial||V.isMeshStandardMaterial||V.isShaderMaterial)&&Se.setValue(N,"isOrthographic",M.isOrthographicCamera===!0),K!==M&&(K=M,Ia=!0,yr=!0)}if(St.needsLights&&(bn.state.sunShadowMap.length>0&&Se.setValue(N,"sunShadowMap",bn.state.sunShadowMap,J),bn.state.directionalShadowMap.length>0&&Se.setValue(N,"directionalShadowMap",bn.state.directionalShadowMap,J),bn.state.spotShadowMap.length>0&&Se.setValue(N,"spotShadowMap",bn.state.spotShadowMap,J),bn.state.pointShadowMap.length>0&&Se.setValue(N,"pointShadowMap",bn.state.pointShadowMap,J)),G.isSkinnedMesh){Se.setOptional(N,G,"bindMatrix"),Se.setOptional(N,G,"bindMatrixInverse");let Ce=G.skeleton;Ce&&(Ce.boneTexture===null&&Ce.computeBoneTexture(),Se.setValue(N,"boneTexture",Ce.boneTexture,J))}G.isBatchedMesh&&(Se.setOptional(N,G,"batchingTexture"),Se.setValue(N,"batchingTexture",G._matricesTexture,J),Se.setOptional(N,G,"batchingIdTexture"),Se.setValue(N,"batchingIdTexture",G._indirectTexture,J),Se.setOptional(N,G,"batchingColorTexture"),G._colorsTexture!==null&&Se.setValue(N,"batchingColorTexture",G._colorsTexture,J));let Pa=q.morphAttributes;if((Pa.position!==void 0||Pa.normal!==void 0||Pa.color!==void 0)&&O.update(G,q,si),(Ia||St.receiveShadow!==G.receiveShadow)&&(St.receiveShadow=G.receiveShadow,Se.setValue(N,"receiveShadow",G.receiveShadow)),(V.isMeshStandardMaterial||V.isMeshLambertMaterial||V.isMeshPhongMaterial)&&V.envMap===null&&L.environment!==null&&(Ge.envMapIntensity.value=L.environmentIntensity),Ge.dfgLUT!==void 0&&(Ge.dfgLUT.value=JD()),Ia){if(Se.setValue(N,"toneMappingExposure",R.toneMappingExposure),St.needsLights&&Wb(Ge,yr),gt&&V.fog===!0&&At.refreshFogUniforms(Ge,gt),At.refreshMaterialUniforms(Ge,V,Y,k,A.state.transmissionRenderTarget[M.id]),St.needsLights&&St.lightProbeGrid){let Ce=St.lightProbeGrid;Ge.probesSH.value=Ce.texture,Ge.probesMin.value.copy(Ce.boundingBox.min),Ge.probesMax.value.copy(Ce.boundingBox.max),Ge.probesResolution.value.copy(Ce.resolution)}qo.upload(N,uv(St),Ge,J)}if(V.isShaderMaterial&&V.uniformsNeedUpdate===!0&&(qo.upload(N,uv(St),Ge,J),V.uniformsNeedUpdate=!1),V.isSpriteMaterial&&Se.setValue(N,"center",G.center),Se.setValue(N,"modelViewMatrix",G.modelViewMatrix),Se.setValue(N,"normalMatrix",G.normalMatrix),Se.setValue(N,"modelMatrix",G.matrixWorld),V.uniformsGroups!==void 0){let Ce=V.uniformsGroups;for(let Ba=0,Sr=Ce.length;Ba<Sr;Ba++){let dv=Ce[Ba];rt.update(dv,si),rt.bind(dv,si)}}return si}function Wb(M,L){M.ambientLightColor.needsUpdate=L,M.lightProbe.needsUpdate=L,M.sunLights.needsUpdate=L,M.sunLightShadows.needsUpdate=L,M.directionalLights.needsUpdate=L,M.directionalLightShadows.needsUpdate=L,M.pointLights.needsUpdate=L,M.pointLightShadows.needsUpdate=L,M.spotLights.needsUpdate=L,M.spotLightShadows.needsUpdate=L,M.rectAreaLights.needsUpdate=L,M.hemisphereLights.needsUpdate=L}function qb(M){return M.isMeshLambertMaterial||M.isMeshToonMaterial||M.isMeshPhongMaterial||M.isMeshStandardMaterial||M.isShadowMaterial||M.isShaderMaterial&&M.lights===!0}this.getActiveCubeFace=function(){return X},this.getActiveMipmapLevel=function(){return Z},this.getRenderTarget=function(){return $},this.setRenderTargetTextures=function(M,L,q){let V=H.get(M);V.__autoAllocateDepthBuffer=M.resolveDepthBuffer===!1,V.__autoAllocateDepthBuffer===!1&&(V.__useRenderToTexture=!1),H.get(M.texture).__webglTexture=L,H.get(M.depthTexture).__webglTexture=V.__autoAllocateDepthBuffer?void 0:q,V.__hasExternalTextures=!0},this.setRenderTargetFramebuffer=function(M,L){let q=H.get(M);q.__webglFramebuffer=L,q.__useDefaultFramebuffer=L===void 0},this.setRenderTarget=function(M,L=0,q=0){$=M,X=L,Z=q;let V=null,G=!1,gt=!1;if(M){let mt=H.get(M);if(mt.__useDefaultFramebuffer!==void 0){v.bindFramebuffer(N.FRAMEBUFFER,mt.__webglFramebuffer),j.copy(M.viewport),vt.copy(M.scissor),yt=M.scissorTest,v.viewport(j),v.scissor(vt),v.setScissorTest(yt),z=-1;return}else if(mt.__webglFramebuffer===void 0)J.setupRenderTarget(M);else if(mt.__hasExternalTextures)J.rebindTextures(M,H.get(M.texture).__webglTexture,H.get(M.depthTexture).__webglTexture);else if(M.depthBuffer){let Jt=M.depthTexture;if(mt.__boundDepthTexture!==Jt){if(Jt!==null&&H.has(Jt)&&(M.width!==Jt.image.width||M.height!==Jt.image.height))throw new Error("THREE.WebGLRenderer: Attached DepthTexture is initialized to the incorrect size.");J.setupDepthRenderbuffer(M)}}let bt=M.texture;(bt.isData3DTexture||bt.isDataArrayTexture||bt.isCompressedArrayTexture)&&(gt=!0);let Rt=H.get(M).__webglFramebuffer;M.isWebGLCubeRenderTarget?(Array.isArray(Rt[L])?V=Rt[L][q]:V=Rt[L],G=!0):M.samples>0&&J.useMultisampledRTT(M)===!1?V=H.get(M).__webglMultisampledFramebuffer:Array.isArray(Rt)?V=Rt[q]:V=Rt,j.copy(M.viewport),vt.copy(M.scissor),yt=M.scissorTest}else j.copy(ot).multiplyScalar(Y).floor(),vt.copy(at).multiplyScalar(Y).floor(),yt=Ut;if(q!==0&&(V=F),v.bindFramebuffer(N.FRAMEBUFFER,V)&&v.drawBuffers(M,V),v.viewport(j),v.scissor(vt),v.setScissorTest(yt),G){let mt=H.get(M.texture);N.framebufferTexture2D(N.FRAMEBUFFER,N.COLOR_ATTACHMENT0,N.TEXTURE_CUBE_MAP_POSITIVE_X+L,mt.__webglTexture,q)}else if(gt){let mt=L;for(let bt=0;bt<M.textures.length;bt++){let Rt=H.get(M.textures[bt]);N.framebufferTextureLayer(N.FRAMEBUFFER,N.COLOR_ATTACHMENT0+bt,Rt.__webglTexture,q,mt)}}else if(M!==null&&q!==0){let mt=H.get(M.texture);N.framebufferTexture2D(N.FRAMEBUFFER,N.COLOR_ATTACHMENT0,N.TEXTURE_2D,mt.__webglTexture,q)}z=-1};function hv(M){let L=H.get(M);return(L.__readFormat!==M.format||L.__readType!==M.type)&&(L.__readFormat=M.format,L.__readType=M.type,L.__formatReadable=C.textureFormatReadable(M.format),L.__typeReadable=C.textureTypeReadable(M.type)),L}this.readRenderTargetPixels=function(M,L,q,V,G,gt,Mt,mt=0){if(!(M&&M.isWebGLRenderTarget)){Vt("WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");return}let bt=H.get(M).__webglFramebuffer;if(M.isWebGLCubeRenderTarget&&Mt!==void 0&&(bt=bt[Mt]),bt){v.bindFramebuffer(N.FRAMEBUFFER,bt);try{let Rt=M.textures[mt],Jt=Rt.format,te=Rt.type;M.textures.length>1&&N.readBuffer(N.COLOR_ATTACHMENT0+mt);let Tt=hv(Rt);if(Tt.__formatReadable===!1){Vt("WebGLRenderer.readRenderTargetPixels: renderTarget is not in RGBA or implementation defined format.");return}if(Tt.__typeReadable===!1){Vt("WebGLRenderer.readRenderTargetPixels: renderTarget is not in UnsignedByteType or implementation defined type.");return}L>=0&&L<=M.width-V&&q>=0&&q<=M.height-G&&N.readPixels(L,q,V,G,dt.convert(Jt),dt.convert(te),gt)}finally{let Rt=$!==null?H.get($).__webglFramebuffer:null;v.bindFramebuffer(N.FRAMEBUFFER,Rt)}}},this.readRenderTargetPixelsAsync=async function(M,L,q,V,G,gt,Mt,mt=0){if(!(M&&M.isWebGLRenderTarget))throw new Error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");let bt=H.get(M).__webglFramebuffer;if(M.isWebGLCubeRenderTarget&&Mt!==void 0&&(bt=bt[Mt]),bt)if(L>=0&&L<=M.width-V&&q>=0&&q<=M.height-G){v.bindFramebuffer(N.FRAMEBUFFER,bt);let Rt=M.textures[mt],Jt=Rt.format,te=Rt.type;M.textures.length>1&&N.readBuffer(N.COLOR_ATTACHMENT0+mt);let Tt=hv(Rt);if(Tt.__formatReadable===!1)throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in RGBA or implementation defined format.");if(Tt.__typeReadable===!1)throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in UnsignedByteType or implementation defined type.");let me=N.createBuffer();N.bindBuffer(N.PIXEL_PACK_BUFFER,me),N.bufferData(N.PIXEL_PACK_BUFFER,gt.byteLength,N.STREAM_READ),N.readPixels(L,q,V,G,dt.convert(Jt),dt.convert(te),0),N.bindBuffer(N.PIXEL_PACK_BUFFER,null);let We=$!==null?H.get($).__webglFramebuffer:null;v.bindFramebuffer(N.FRAMEBUFFER,We);let Le=N.fenceSync(N.SYNC_GPU_COMMANDS_COMPLETE,0);return N.flush(),await VM(N,Le,4),N.bindBuffer(N.PIXEL_PACK_BUFFER,me),N.getBufferSubData(N.PIXEL_PACK_BUFFER,0,gt),N.bindBuffer(N.PIXEL_PACK_BUFFER,null),N.deleteBuffer(me),N.deleteSync(Le),gt}else throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: requested read bounds are out of range.")},this.copyFramebufferToTexture=function(M,L=null,q=0){let V=Math.pow(2,-q),G=Math.floor(M.image.width*V),gt=Math.floor(M.image.height*V),Mt=L!==null?L.x:0,mt=L!==null?L.y:0;J.setTexture2D(M,0),N.copyTexSubImage2D(N.TEXTURE_2D,q,0,0,Mt,mt,G,gt),v.unbindTexture()},this.copyTextureToTexture=function(M,L,q=null,V=null,G=0,gt=0){let Mt,mt,bt,Rt,Jt,te,Tt,me,We,Le=M.isCompressedTexture?M.mipmaps[gt]:M.image;if(q!==null)Mt=q.max.x-q.min.x,mt=q.max.y-q.min.y,bt=q.isBox3?q.max.z-q.min.z:1,Rt=q.min.x,Jt=q.min.y,te=q.isBox3?q.min.z:0;else{let Ge=Math.pow(2,-G);Mt=Math.floor(Le.width*Ge),mt=Math.floor(Le.height*Ge),M.isDataArrayTexture?bt=Le.depth:M.isData3DTexture?bt=Math.floor(Le.depth*Ge):bt=1,Rt=0,Jt=0,te=0}V!==null?(Tt=V.x,me=V.y,We=V.z):(Tt=0,me=0,We=0);let Te=dt.convert(L.format),gn=dt.convert(L.type),St;L.isData3DTexture?(J.setTexture3D(L,0),St=N.TEXTURE_3D):L.isDataArrayTexture||L.isCompressedArrayTexture?(J.setTexture2DArray(L,0),St=N.TEXTURE_2D_ARRAY):(J.setTexture2D(L,0),St=N.TEXTURE_2D),v.activeTexture(N.TEXTURE0),v.pixelStorei(N.UNPACK_FLIP_Y_WEBGL,L.flipY),v.pixelStorei(N.UNPACK_PREMULTIPLY_ALPHA_WEBGL,L.premultiplyAlpha),v.pixelStorei(N.UNPACK_ALIGNMENT,L.unpackAlignment);let bn=v.getParameter(N.UNPACK_ROW_LENGTH),le=v.getParameter(N.UNPACK_IMAGE_HEIGHT),si=v.getParameter(N.UNPACK_SKIP_PIXELS),Fi=v.getParameter(N.UNPACK_SKIP_ROWS),Ia=v.getParameter(N.UNPACK_SKIP_IMAGES);v.pixelStorei(N.UNPACK_ROW_LENGTH,Le.width),v.pixelStorei(N.UNPACK_IMAGE_HEIGHT,Le.height),v.pixelStorei(N.UNPACK_SKIP_PIXELS,Rt),v.pixelStorei(N.UNPACK_SKIP_ROWS,Jt),v.pixelStorei(N.UNPACK_SKIP_IMAGES,te);let yr=M.isDataArrayTexture||M.isData3DTexture,Se=L.isDataArrayTexture||L.isData3DTexture;if(M.isDepthTexture){let Ge=H.get(M),Pa=H.get(L),Ce=H.get(Ge.__renderTarget),Ba=H.get(Pa.__renderTarget);v.bindFramebuffer(N.READ_FRAMEBUFFER,Ce.__webglFramebuffer),v.bindFramebuffer(N.DRAW_FRAMEBUFFER,Ba.__webglFramebuffer);for(let Sr=0;Sr<bt;Sr++)yr&&(N.framebufferTextureLayer(N.READ_FRAMEBUFFER,N.COLOR_ATTACHMENT0,H.get(M).__webglTexture,G,te+Sr),N.framebufferTextureLayer(N.DRAW_FRAMEBUFFER,N.COLOR_ATTACHMENT0,H.get(L).__webglTexture,gt,We+Sr)),N.blitFramebuffer(Rt,Jt,Mt,mt,Tt,me,Mt,mt,N.DEPTH_BUFFER_BIT,N.NEAREST);v.bindFramebuffer(N.READ_FRAMEBUFFER,null),v.bindFramebuffer(N.DRAW_FRAMEBUFFER,null)}else if(G!==0||M.isRenderTargetTexture||H.has(M)){let Ge=H.get(M),Pa=H.get(L);v.bindFramebuffer(N.READ_FRAMEBUFFER,U),v.bindFramebuffer(N.DRAW_FRAMEBUFFER,B);for(let Ce=0;Ce<bt;Ce++)yr?N.framebufferTextureLayer(N.READ_FRAMEBUFFER,N.COLOR_ATTACHMENT0,Ge.__webglTexture,G,te+Ce):N.framebufferTexture2D(N.READ_FRAMEBUFFER,N.COLOR_ATTACHMENT0,N.TEXTURE_2D,Ge.__webglTexture,G),Se?N.framebufferTextureLayer(N.DRAW_FRAMEBUFFER,N.COLOR_ATTACHMENT0,Pa.__webglTexture,gt,We+Ce):N.framebufferTexture2D(N.DRAW_FRAMEBUFFER,N.COLOR_ATTACHMENT0,N.TEXTURE_2D,Pa.__webglTexture,gt),G!==0?N.blitFramebuffer(Rt,Jt,Mt,mt,Tt,me,Mt,mt,N.COLOR_BUFFER_BIT,N.NEAREST):Se?N.copyTexSubImage3D(St,gt,Tt,me,We+Ce,Rt,Jt,Mt,mt):N.copyTexSubImage2D(St,gt,Tt,me,Rt,Jt,Mt,mt);v.bindFramebuffer(N.READ_FRAMEBUFFER,null),v.bindFramebuffer(N.DRAW_FRAMEBUFFER,null)}else Se?M.isDataTexture||M.isData3DTexture?N.texSubImage3D(St,gt,Tt,me,We,Mt,mt,bt,Te,gn,Le.data):L.isCompressedArrayTexture?N.compressedTexSubImage3D(St,gt,Tt,me,We,Mt,mt,bt,Te,Le.data):N.texSubImage3D(St,gt,Tt,me,We,Mt,mt,bt,Te,gn,Le):M.isDataTexture?N.texSubImage2D(N.TEXTURE_2D,gt,Tt,me,Mt,mt,Te,gn,Le.data):M.isCompressedTexture?N.compressedTexSubImage2D(N.TEXTURE_2D,gt,Tt,me,Le.width,Le.height,Te,Le.data):N.texSubImage2D(N.TEXTURE_2D,gt,Tt,me,Mt,mt,Te,gn,Le);v.pixelStorei(N.UNPACK_ROW_LENGTH,bn),v.pixelStorei(N.UNPACK_IMAGE_HEIGHT,le),v.pixelStorei(N.UNPACK_SKIP_PIXELS,si),v.pixelStorei(N.UNPACK_SKIP_ROWS,Fi),v.pixelStorei(N.UNPACK_SKIP_IMAGES,Ia),gt===0&&L.generateMipmaps&&N.generateMipmap(St),v.unbindTexture()},this.initRenderTarget=function(M){H.get(M).__webglFramebuffer===void 0&&J.setupRenderTarget(M)},this.initTexture=function(M){M.isCubeTexture?J.setTextureCube(M,0):M.isData3DTexture?J.setTexture3D(M,0):M.isDataArrayTexture||M.isCompressedArrayTexture?J.setTexture2DArray(M,0):J.setTexture2D(M,0),v.unbindTexture()},this.resetState=function(){X=0,Z=0,$=null,v.reset(),_t.reset()},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}get coordinateSystem(){return Ui}get outputColorSpace(){return this._outputColorSpace}set outputColorSpace(t){this._outputColorSpace=t;let n=this.getContext();n.drawingBufferColorSpace=se._getDrawingBufferColorSpace(t),n.unpackColorSpace=se._getUnpackColorSpace()}};var QD={name:"pixels-mechanic",modes:{dark:{theme:"dark",effectIndex:11,colors:["#949494","#2d2d2d","#333333","#3a3a3a","#0b0b0b","#060606","#2f2f2f"],alphas:[1,1,1,1,1,1,1],cardBg:"#0f0f0f",dotMode:1,pixelConfig:{cellSize:.22,gap:.14,dotOpacity:.68,dotSize:.8,dotSoftness:.1,hlScale:.8,fillOpacity:.44,edgeFade:24,fadeStr:1},dotConfig:{cellSize:.58,gap:0,dotOpacity:1,dotSize:.22,dotSoftness:.1,hlScale:.26,fillOpacity:0,edgeFade:34,fadeStr:.34},direction:0,speed:.7,intensity:1,scale:1.4,softness:.76,distortion:.3,flicker:.5,complexity:.2,shape:.52,blur:1,highlight:.32,vignette:.26,vigOpacity:1,shaderOpacity:1,revealConfig:{duration:3,easing:"easeOutCubic",maskShape:"shaderColor4",softness:.5,blur:0,pixDuration:2.65,pixEasing:"easeOutCubic",dotDuration:2.05,dotEasing:"easeOutCubic"},effect:"Nebula"},light:{theme:"light",effectIndex:11,colors:["#e0e0e0","#fdfdfd","#f2f2f2","#0a0a0a","#dcdcdc","#f5f5f5","#f5f5f5"],alphas:[1,1,1,1,1,1,1],cardBg:"#f5f5f5",dotMode:1,pixelConfig:{cellSize:.22,gap:.14,dotOpacity:.68,dotSize:.8,dotSoftness:.1,hlScale:.8,fillOpacity:.18,edgeFade:20,fadeStr:1},dotConfig:{cellSize:.58,gap:0,dotOpacity:1,dotSize:.22,dotSoftness:.1,hlScale:.26,fillOpacity:0,edgeFade:34,fadeStr:.34},direction:25,speed:.55,intensity:.85,scale:.9,softness:.76,distortion:.3,flicker:.5,complexity:.2,shape:.52,blur:1,highlight:.92,vignette:0,vigOpacity:0,shaderOpacity:1,revealConfig:{duration:3,easing:"easeOutCubic",maskShape:"shaderColor3",softness:.5,blur:0,pixDuration:2.6,pixEasing:"easeOutCubic",dotDuration:2.05,dotEasing:"easeOutCubic"},effect:"Nebula"}}},jD={name:"pixels-organic",modes:{dark:{theme:"dark",effectIndex:22,colors:["#0f0f0f","#4a4949","#b9b9b9","#0f0f0f","#d8d8d8","#0f0f0f","#2f2f2f"],alphas:[1,1,1,1,1,1,1],cardBg:"#0f0f0f",dotMode:1,pixelConfig:{cellSize:.22,gap:.14,dotOpacity:.68,dotSize:.8,dotSoftness:.1,hlScale:.8,fillOpacity:.44,edgeFade:24,fadeStr:1},dotConfig:{cellSize:.58,gap:0,dotOpacity:1,dotSize:.22,dotSoftness:.1,hlScale:.26,fillOpacity:0,edgeFade:34,fadeStr:.34},direction:0,speed:.3,intensity:1,scale:1,softness:.76,distortion:.3,complexity:.2,shape:.52,blur:1,highlight:.2,vignette:.26,vigOpacity:1,shaderOpacity:1,revealConfig:{duration:3,easing:"easeOutCubic",maskShape:"shaderColor4",softness:.5,blur:0,pixDuration:2.65,pixEasing:"easeOutCubic",dotDuration:2.05,dotEasing:"easeOutCubic"},effect:"Chromium Flow"},light:{theme:"light",effectIndex:22,colors:["#e3e3e3","#ffffff","#f5f5f5","#f5f5f5","#080808","#f5f5f5","#f5f5f5"],alphas:[1,1,1,1,1,1,1],cardBg:"#f5f5f5",dotMode:1,pixelConfig:{cellSize:.22,gap:.14,dotOpacity:.68,dotSize:.8,dotSoftness:.1,hlScale:.8,fillOpacity:.18,edgeFade:20,fadeStr:1},dotConfig:{cellSize:.58,gap:0,dotOpacity:1,dotSize:.22,dotSoftness:.1,hlScale:.26,fillOpacity:0,edgeFade:34,fadeStr:.34},direction:25,speed:.3,intensity:.85,scale:1,softness:.76,distortion:.3,complexity:.2,shape:.52,blur:1,highlight:.7,vignette:0,vigOpacity:0,shaderOpacity:1,revealConfig:{duration:3,easing:"easeOutCubic",maskShape:"shaderColor4",softness:.5,blur:0,pixDuration:2.55,pixEasing:"easeOutCubic",dotDuration:2.05,dotEasing:"easeOutCubic"},effect:"Chromium Flow"}}},$D={name:"sweep-gradient",modes:{dark:{theme:"dark",effectIndex:25,colors:["#0f0f0f","#0f0f0f","#282828","#3a3a3a","#525252","#0f0f0f","#0f0f0f"],alphas:[1,1,1,1,1,1,1],cardBg:"#0f0f0f",dotMode:1,pixelConfig:{cellSize:.22,gap:.14,dotOpacity:.68,dotSize:.8,dotSoftness:.1,hlScale:.8,fillOpacity:.44,edgeFade:24,fadeStr:1},dotConfig:{cellSize:.58,gap:0,dotOpacity:1,dotSize:.22,dotSoftness:.1,hlScale:.26,fillOpacity:0,edgeFade:34,fadeStr:.34},direction:0,speed:2.65,intensity:1,scale:1,softness:.76,distortion:.3,flicker:.5,complexity:.2,shape:.52,blur:1,highlight:.32,vignette:.26,vigOpacity:1,shaderOpacity:1,sweepEase:1,revealConfig:{duration:3,easing:"easeOutCubic",maskShape:"gradientSweep",softness:.5,blur:0,pixDuration:2.65,pixEasing:"easeOutCubic",dotDuration:2.05,dotEasing:"easeOutCubic"},effect:"Gradient Sweep"},light:{theme:"light",effectIndex:25,colors:["#f5f5f5","#f5f5f5","#ededed","#eaeaea","#d2d2d2","#f5f5f5","#f5f5f5"],alphas:[1,1,1,1,1,1,1],cardBg:"#f5f5f5",dotMode:1,pixelConfig:{cellSize:.22,gap:.14,dotOpacity:.68,dotSize:.8,dotSoftness:.1,hlScale:.8,fillOpacity:.18,edgeFade:20,fadeStr:1},dotConfig:{cellSize:.58,gap:0,dotOpacity:1,dotSize:.22,dotSoftness:.1,hlScale:.26,fillOpacity:0,edgeFade:34,fadeStr:.34},direction:0,speed:2.65,intensity:.85,scale:1,softness:.76,distortion:.3,flicker:.5,complexity:.2,shape:.52,blur:1,highlight:.92,vignette:0,vigOpacity:0,shaderOpacity:1,sweepEase:1,revealConfig:{duration:3,easing:"easeOutCubic",maskShape:"gradientSweep",softness:.5,blur:0,pixDuration:2.6,pixEasing:"easeOutCubic",dotDuration:2.05,dotEasing:"easeOutCubic"},effect:"Gradient Sweep"}}},tN={"pixels-organic":jD,"pixels-mechanic":QD,"sweep-gradient":$D},Zg=tN;var Lc;function eN(){if(Lc!==void 0)return Lc;if(typeof document>"u")return Lc=null,null;let e=document.createElement("canvas");return e.width=1,e.height=1,Lc=e.getContext("2d"),Lc}function xr(e){if(typeof e!="string"||e.length===0)return[0,0,0];if(e[0]==="#"){let r=e.slice(1);if(r.length===3&&(r=r[0]+r[0]+r[1]+r[1]+r[2]+r[2]),(r.length===6||r.length===8)&&/^[0-9a-fA-F]+$/.test(r))return[parseInt(r.slice(0,2),16)/255,parseInt(r.slice(2,4),16)/255,parseInt(r.slice(4,6),16)/255]}let t=eN();if(!t)return[0,0,0];t.fillStyle="#000000",t.fillStyle=e;let n=t.fillStyle;t.fillStyle="#ffffff",t.fillStyle=e;let i=t.fillStyle;if(n!==i)return[0,0,0];let a=n;if(a[0]==="#")return[parseInt(a.slice(1,3),16)/255,parseInt(a.slice(3,5),16)/255,parseInt(a.slice(5,7),16)/255];let s=a.match(/^rgba?\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)/);if(s){let r=o=>Math.max(0,Math.min(255,o))/255;return[r(parseFloat(s[1])),r(parseFloat(s[2])),r(parseFloat(s[3]))]}return[0,0,0]}var nN=`
  void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`,iN=`
  uniform vec2 u_resolution;
  uniform float u_dpr;
  uniform float u_time;
  uniform vec3 u_color1, u_color2, u_color3, u_color4, u_color5, u_color6, u_color7, u_cardBg;
  uniform float u_alpha1, u_alpha2, u_alpha3, u_alpha4, u_alpha5, u_alpha6, u_alpha7;
  uniform float u_speed, u_intensity, u_scale, u_direction;
  uniform float u_softness, u_distortion, u_complexity, u_shape, u_flicker;
  uniform float u_vignette, u_vigOpacity, u_blur, u_highlight, u_shaderOpacity;
  uniform float u_cellSize, u_gap, u_dotSize, u_dotSoftness, u_dotOpacity, u_hlScale, u_fillOpacity, u_edgeFade, u_fadeStr;
  uniform float u_dotMode;
  uniform int u_effect;
  uniform int u_sweepEase;

  // Reference card edge length (CSS px) at which the original preset cellSize
  // gives the canonical cell count. Cell PIXEL size stays constant across card
  // sizes by scaling gridSize proportionally to (currentCssDim / REF_DIM).
  const float REF_DIM = 320.0;

  /** Anisotropic cell count: returns the number of cells along x and y so that
   *  each cell stays SQUARE in screen space regardless of the card's aspect
   *  ratio. A 600\xD7300 card gets twice as many cells horizontally as vertically;
   *  cells stay the same physical size as on a 300\xD7300 card. */
  vec2 gridCounts(float baseCount) {
    vec2 cssRes = u_resolution / max(u_dpr, 0.0001);
    return max(vec2(2.0), floor(baseCount * cssRes / REF_DIM));
  }

  vec3 mod289(vec3 x) { return x - floor(x * (1.0/289.0)) * 289.0; }
  vec2 mod289v2(vec2 x) { return x - floor(x * (1.0/289.0)) * 289.0; }
  vec3 permute(vec3 x) { return mod289((x * 34.0 + 1.0) * x); }

  float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
    vec2 i = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289v2(i);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
    m = m * m; m = m * m;
    vec3 x_ = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x_) - 0.5;
    vec3 ox = floor(x_ + 0.5);
    vec3 a0 = x_ - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }

  float fbm(vec2 p, float oct) {
    float val = 0.0, amp = 0.5;
    int n = int(oct);
    for (int i = 0; i < 4; i++) {
      if (i >= n) break;
      val += amp * snoise(p);
      p *= 2.0;
      amp *= 0.5;
    }
    return val;
  }

  float nfbm(vec2 p) { return fbm(p, 2.0 + u_complexity * 2.0); }

  vec3 palette(float t) {
    t = clamp(t, 0.0, 1.0);
    t = t * t * (3.0 - 2.0 * t);
    float k = 64.0;
    float w1 = u_alpha1 * exp(-k * t * t);
    float w2 = u_alpha2 * exp(-k * (t - 0.25) * (t - 0.25));
    float w3 = u_alpha3 * exp(-k * (t - 0.5)  * (t - 0.5));
    float w4 = u_alpha4 * exp(-k * (t - 0.75) * (t - 0.75));
    float w5 = u_alpha5 * exp(-k * (t - 1.0)  * (t - 1.0));
    float total = w1 + w2 + w3 + w4 + w5 + 0.0001;
    return (u_color1*w1 + u_color2*w2 + u_color3*w3 + u_color4*w4 + u_color5*w5) / total;
  }

  vec3 softBlend(float a, float b, float c) {
    a = clamp(a, 0.0, 1.0); a *= a;
    b = clamp(b, 0.0, 1.0); b *= b;
    c = clamp(c, 0.0, 1.0); c *= c;
    float d = clamp(a * 0.7 + c * 0.3, 0.0, 1.0); d *= d;
    float e = clamp(b * 0.5 + c * 0.5, 0.0, 1.0); e *= e;
    a *= u_alpha1; b *= u_alpha2; c *= u_alpha3; d *= u_alpha4; e *= u_alpha5;
    float total = a + b + c + d + e;
    float floorW = max(0.001 - total, 0.0);
    vec3 fallback = (u_color1 + u_color2 + u_color3 + u_color4 + u_color5) * 0.2;
    return (u_color1 * a + u_color2 * b + u_color3 * c + u_color4 * d + u_color5 * e + fallback * floorW) / (total + floorW);
  }

  vec2 warp(vec2 p, float t) {
    float str = u_distortion * 2.0;
    return vec2(
      nfbm(p + vec2(t * 0.1, 0.0)),
      nfbm(p + vec2(0.0, t * 0.12) + 5.0)
    ) * str;
  }

  float sweepEase(float x) {
    if (u_sweepEase == 1) return x * x * (3.0 - 2.0 * x);
    if (u_sweepEase == 2) {
      float p = 1.0 - x;
      return 1.0 - p * p * p;
    }
    if (u_sweepEase == 3) {
      return x < 0.5 ? 4.0 * x * x * x : 1.0 - pow(-2.0 * x + 2.0, 3.0) * 0.5;
    }
    if (u_sweepEase == 4) return 1.0 - pow(2.0, -10.0 * x) * (1.0 - x);
    return x;
  }

  float blob(vec2 p, vec2 center, float radius) {
    float r = radius * (0.5 + u_shape * 0.8);
    float soft = 0.05 + u_softness * 0.4;
    return smoothstep(r + soft, r - soft * 0.5, length(p - center));
  }

  vec3 computeEffect(vec2 uv, float aspect, float t, float dist, float soft, float cpx, float shp) {
    vec2 p = (uv - 0.5) * u_scale;
    p.x *= aspect;
    p += vec2(cos(u_direction), sin(u_direction)) * t * 0.15;
    vec3 col = vec3(0.0);

    if (u_effect == 0) {
      float val = sin(p.x * 3.0 + t) * 0.5 + 0.5;
      val += sin(p.y * 2.0 + t * 0.7) * 0.3;
      val += sin((p.x + p.y) * (1.0 + cpx * 3.0) - t * 0.5) * 0.2;
      vec2 w = warp(p, t);
      val += (w.x + w.y) * 0.15;
      col = palette(clamp(val * u_intensity, 0.0, 1.0));

    } else if (u_effect == 1) {
      float freq = 3.0 + cpx * 8.0;
      float val = 0.0;
      val += sin(p.x * freq + t);
      val += sin(p.y * freq + t * 1.3);
      val += sin((p.x + p.y) * freq * 0.7 + t * 0.7);
      val += sin(length(p) * freq * 0.8 - t * 1.5);
      vec2 w = warp(p, t);
      val += (w.x + w.y) * dist;
      val = val * 0.2 * u_intensity + 0.5;
      col = palette(clamp(val, 0.0, 1.0));

    } else if (u_effect == 2) {
      vec2 q = vec2(nfbm(p + t * 0.3), nfbm(p + vec2(5.2, 1.3) + t * 0.2));
      float val = nfbm(p + q * (1.0 + dist * 3.0) + t * 0.1);
      val = val * u_intensity * 0.5 + 0.5;
      col = palette(clamp(val, 0.0, 1.0));

    } else if (u_effect == 3) {
      float d = length(p);
      float val = sin(d * (3.0 + cpx * 6.0) - t * 2.0) * 0.5 + 0.5;
      val *= exp(-d * (0.3 + shp * 1.0));
      val += sin(atan(p.y, p.x) * (1.5 + cpx * 2.0) + t) * 0.15;
      col = palette(clamp(val * u_intensity, 0.0, 1.0));

    } else if (u_effect == 4) {
      vec2 q = vec2(nfbm(p * (0.5 + shp * 0.6) + vec2(t * 0.12, t * 0.08)), nfbm(p * (0.5 + shp * 0.6) + vec2(t * 0.09, -t * 0.11)));
      vec2 r = vec2(nfbm(p + q * (1.0 + dist * 2.0) + vec2(1.7, 9.2) + t * 0.06), nfbm(p + q * (1.0 + dist * 2.0) + vec2(8.3, 2.8) - t * 0.08));
      float val = nfbm(p + r * 2.0);
      float lo = -0.3 - soft * 0.5;
      float hi = 0.5 + soft * 0.5;
      val = smoothstep(lo, hi, val * u_intensity);
      col = palette(val);

    } else if (u_effect == 5) {
      float n1 = nfbm(vec2(p.x * 0.5 + t * 0.15, p.y * (1.0 + cpx * 1.5)));
      float n2 = nfbm(vec2(p.x * 0.3 - t * 0.1, p.y * (0.8 + cpx * 1.0) + 3.0));
      float band = sin(p.y * 3.0 + n1 * (1.0 + dist * 2.0) + t * 0.3) * 0.5 + 0.5;
      float shimmer = sin(p.y * 4.0 + n2 * 1.5 - t * 0.2) * 0.5 + 0.5;
      float w1 = band * (0.5 + 0.5 * sin(p.x * 1.5 + t * 0.2 + n1));
      float w2 = shimmer * (0.5 + 0.5 * cos(p.x * 1.0 - t * 0.15 + n2));
      float w3 = nfbm(p * 0.5 + t * 0.05) * 0.5 + 0.5;
      col = softBlend(w1 * u_intensity, w2 * u_intensity, w3 * 0.6 * u_intensity);

    } else if (u_effect == 6) {
      vec2 wp = warp(p * 1.2, t);
      float blobR = 0.15 + shp * 0.2;
      float b1 = blob(p, vec2(sin(t * 0.3) * 0.3, cos(t * 0.2) * 0.4) + wp * 0.2, blobR);
      float b2 = blob(p, vec2(cos(t * 0.25) * 0.4, sin(t * 0.35) * 0.3 - 0.2) + wp * 0.15, blobR * 1.2);
      float b3 = blob(p, vec2(-sin(t * 0.2) * 0.3, -cos(t * 0.3) * 0.35) + wp * 0.18, blobR);
      float bg = nfbm(p * 0.5 + t * 0.05) * 0.3 + 0.15;
      col = softBlend((b1 + bg * 0.5) * u_intensity, (b2 + bg * 0.3) * u_intensity, (b3 + bg * 0.4) * u_intensity);

    } else if (u_effect == 7) {
      float sz = 0.4 + shp * 0.6;
      float sigma = sz * sz * 2.0;
      vec2 a1 = vec2(-0.45 + sin(t * 0.07) * 0.06, 0.45 + cos(t * 0.09) * 0.05);
      vec2 a2 = vec2(0.45 + cos(t * 0.08) * 0.06, 0.45 + sin(t * 0.06) * 0.05);
      vec2 a3 = vec2(0.0 + sin(t * 0.05) * 0.1, 0.0 + cos(t * 0.07) * 0.1);
      vec2 a4 = vec2(-0.4 + cos(t * 0.06) * 0.07, -0.3 + sin(t * 0.08) * 0.06);
      vec2 a5 = vec2(0.4 + sin(t * 0.07) * 0.06, -0.4 + cos(t * 0.05) * 0.06);
      float g1 = exp(-dot(p - a1, p - a1) / sigma);
      float g2 = exp(-dot(p - a2, p - a2) / sigma);
      float g3 = exp(-dot(p - a3, p - a3) / sigma);
      float g4 = exp(-dot(p - a4, p - a4) / sigma);
      float g5 = exp(-dot(p - a5, p - a5) / sigma);
      float nudge = dist > 0.01 ? snoise(p * (0.5 + cpx) + t * 0.04) * dist * 0.08 : 0.0;
      float w1 = (g1 + g4 + nudge) * u_intensity;
      float w2 = (g2 + g5 + nudge) * u_intensity;
      float w3 = (g3 + nudge) * u_intensity;
      col = softBlend(w1, w2, w3);

    } else if (u_effect == 8) {
      vec2 w1 = vec2(nfbm(p * (0.7 + cpx * 0.5) + t * 0.1), nfbm(p * (0.7 + cpx * 0.5) + vec2(3.3, 7.7) + t * 0.08));
      vec2 w2 = vec2(nfbm(p * 0.6 + w1 * (1.0 + dist) + t * 0.06), nfbm(p * 0.6 + w1 * (1.0 + dist) + vec2(1.7, 4.2) - t * 0.07));
      float f1 = nfbm(p + w2 * 1.5);
      float f2 = nfbm(p + w2 * 1.5 + vec2(4.1, 2.3));
      float f3 = nfbm(p + w2 * 1.5 + vec2(7.5, 6.1));
      col = softBlend((f1 * 0.5 + 0.5) * u_intensity, (f2 * 0.5 + 0.5) * u_intensity, (f3 * 0.5 + 0.5) * u_intensity);

    } else if (u_effect == 9) {
      vec2 sw = vec2(sin(p.y * 2.0 + t * 0.3) * 0.15 + snoise(p * 1.5 + t * 0.15) * dist * 0.3, cos(p.x * 1.8 + t * 0.25) * 0.15 + snoise(p * 1.5 + vec2(5.0, 0.0) + t * 0.12) * dist * 0.3);
      vec2 wp = p + sw;
      float caustic = (snoise(wp * (1.5 + cpx * 2.0) + t * 0.2) * 0.5 + 0.5) + (snoise(wp * (2.0 + cpx * 2.0) - t * 0.15) * 0.5 + 0.5) * 0.5;
      caustic = caustic / 1.5;
      float depth = nfbm(vec2(p.x * 0.3, p.y * 0.8) + t * 0.05) * 0.5 + 0.5;
      col = softBlend(depth * u_intensity, (1.0 - depth) * u_intensity, caustic * u_intensity);

    } else if (u_effect == 10) {
      float angle = 0.6 + shp * 1.2;
      float ca = cos(angle), sa = sin(angle);
      vec2 rp = vec2(p.x * ca - p.y * sa, p.x * sa + p.y * ca);
      float n1 = nfbm(rp * 0.8 + t * 0.12) * (1.0 + dist * 2.0);
      float n2 = nfbm(rp * 0.6 + vec2(3.0, 0.0) + t * 0.1) * (1.0 + dist * 1.5);
      float wave = sin(rp.x * (2.0 + cpx * 2.0) + n1 + t * 0.3);
      float wave2 = sin(rp.x * (1.5 + cpx * 1.5) + n2 - t * 0.2);
      float ribbon1 = exp(-2.0 * (rp.y - wave * 0.35) * (rp.y - wave * 0.35)) * u_intensity;
      float ribbon2 = exp(-2.0 * (rp.y - 0.15 - wave2 * 0.3) * (rp.y - 0.15 - wave2 * 0.3)) * u_intensity;
      float bg = nfbm(p * 0.4 + t * 0.03) * 0.5 + 0.5;
      col = softBlend(ribbon1, ribbon2, bg * 0.5 * u_intensity);

    } else if (u_effect == 11) {
      vec2 q = vec2(nfbm(p * 0.5 + vec2(t * 0.05, 0.0)), nfbm(p * 0.5 + vec2(0.0, t * 0.07)));
      vec2 r = vec2(nfbm(p * 0.6 + q * (1.0 + dist * 1.5) + vec2(1.7, 9.2) + t * 0.03), nfbm(p * 0.6 + q * (1.0 + dist * 1.5) + vec2(8.3, 2.8) + t * 0.04));
      float f = nfbm(p + r * 1.5);
      float f2 = nfbm(p * 0.7 + r + vec2(3.0, 7.0));
      col = softBlend((f * 0.5 + 0.5) * u_intensity, (f2 * 0.5 + 0.5) * u_intensity, (nfbm(p * 0.4 - t * 0.02) * 0.5 + 0.5) * u_intensity);

    } else if (u_effect == 12) {
      vec2 w = warp(p * 0.5, t * 0.7);
      float fold1 = sin(p.x * (1.5 + cpx * 2.0) + w.x * 1.5 + t * 0.2) * 0.5 + 0.5;
      float fold2 = sin(p.y * (1.2 + cpx * 1.5) + w.y * 1.5 - t * 0.15) * 0.5 + 0.5;
      float fold3 = sin((p.x - p.y) * (0.8 + cpx * 0.8) + (w.x + w.y) + t * 0.1) * 0.5 + 0.5;
      col = softBlend(fold1 * u_intensity, fold2 * u_intensity, fold3 * 0.7 * u_intensity);

    } else if (u_effect == 13) {
      float spread = 0.25 + shp * 0.35;
      vec2 w = warp(p, t * 0.5);
      vec2 c1 = vec2(sin(t * 0.08) * spread, cos(t * 0.11) * spread) + w * 0.15;
      vec2 c2 = vec2(cos(t * 0.09) * spread * 1.3, sin(t * 0.07) * spread) + w * 0.12;
      vec2 c3 = vec2(-sin(t * 0.1) * spread, -cos(t * 0.08) * spread * 1.2) + w * 0.1;
      float falloff = 0.3 + soft * 0.7;
      float d1 = 1.0 - smoothstep(0.0, falloff, length(p - c1 + w * dist * 0.3));
      float d2 = 1.0 - smoothstep(0.0, falloff, length(p - c2 + w * dist * 0.25));
      float d3 = 1.0 - smoothstep(0.0, falloff, length(p - c3 + w * dist * 0.2));
      float detail = nfbm(p * 2.0 + t * 0.05) * cpx * 0.3;
      col = softBlend((d1 + detail) * u_intensity, (d2 + detail) * u_intensity, (d3 + detail) * u_intensity);

    } else if (u_effect == 14) {
      vec2 w = warp(p * 0.6, t * 0.6);
      float angle = atan(p.y + w.y * dist, p.x + w.x * dist);
      float radius = length(p);
      float field1 = sin(angle * (2.0 + cpx * 4.0) + radius * (3.0 + cpx * 3.0) + t * 0.4 + nfbm(p + t * 0.1) * dist * 2.0) * 0.5 + 0.5;
      float field2 = sin(angle * (1.5 + cpx * 2.5) - radius * 2.0 - t * 0.3 + nfbm(p * 0.6 + t * 0.08) * dist * 1.5) * 0.5 + 0.5;
      float bg = nfbm(p * 0.3 + t * 0.03) * 0.5 + 0.5;
      col = softBlend(field1 * u_intensity, field2 * u_intensity, bg * 0.5 * u_intensity);

    } else if (u_effect == 15) {
      vec2 drift = vec2(t * 0.06, t * 0.03);
      float c1 = nfbm((p + drift) * (0.4 + cpx * 0.5)) * 0.5 + 0.5;
      float c2 = nfbm((p + drift + vec2(3.7, 1.2)) * (0.35 + cpx * 0.4)) * 0.5 + 0.5;
      float c3 = nfbm((p + drift + vec2(7.1, 4.5)) * (0.3 + cpx * 0.35)) * 0.5 + 0.5;
      vec2 w = warp(p * 0.2, t * 0.4);
      c1 += w.x * dist * 0.3;
      c2 += w.y * dist * 0.25;
      col = softBlend(c1 * u_intensity, c2 * u_intensity, c3 * u_intensity);

    } else if (u_effect == 16) {
      vec2 w = warp(vec2(p.x * 0.3, p.y * 0.6), t * 0.5);
      float c1 = sin(p.x * (1.5 + cpx * 2.0) + w.x * (1.0 + dist * 2.0) + t * 0.15) * 0.5 + 0.5;
      float c2 = sin(p.x * (1.0 + cpx * 1.5) + w.y * (1.0 + dist * 1.5) - t * 0.12 + 2.0) * 0.5 + 0.5;
      float c3 = sin(p.x * (0.8 + cpx * 1.0) + (w.x + w.y) * 0.5 * (1.0 + dist) + t * 0.08 + 4.0) * 0.5 + 0.5;
      float fade = nfbm(vec2(p.x * 0.3, p.y * 0.5) + t * 0.03) * 0.5 + 0.5;
      col = softBlend(c1 * fade * u_intensity, c2 * fade * u_intensity, c3 * (1.0 - fade * 0.4) * u_intensity * 0.7);

    } else if (u_effect == 17) {
      vec2 w = warp(p * 0.8, t * 0.6);
      vec2 w2 = warp(p * 0.5 + w * 0.4, t * 0.4);
      float r1 = (snoise((p + w * dist * 0.5) * (1.5 + cpx * 2.0) + t * 0.1) * 0.5 + 0.5) * u_intensity;
      float r2 = (snoise((p + w2 * dist * 0.4) * (1.2 + cpx * 1.5) + t * 0.08 + 3.0) * 0.5 + 0.5) * u_intensity;
      float r3 = (snoise((p + (w + w2) * dist * 0.3) * (0.8 + cpx * 1.0) - t * 0.06 + 7.0) * 0.5 + 0.5) * u_intensity;
      col = softBlend(r1, r2, r3);

    } else if (u_effect == 18) {
      vec2 w = warp(p * 0.5, t * 0.5);
      float blobSize = 0.2 + shp * 0.3;
      float total1 = 0.0, total2 = 0.0;
      for (int i = 0; i < 5; i++) {
        float fi = float(i);
        vec2 c1 = vec2(sin(t * 0.1 + fi * 2.1) * 0.4, cos(t * 0.13 + fi * 1.7) * 0.35) + w * dist * 0.15;
        vec2 c2 = vec2(cos(t * 0.12 + fi * 1.9) * 0.35, sin(t * 0.09 + fi * 2.3) * 0.4) + w * dist * 0.12;
        total1 += blobSize * blobSize / (dot(p - c1, p - c1) + 0.02);
        total2 += blobSize * blobSize / (dot(p - c2, p - c2) + 0.02);
      }
      total1 = clamp(total1 * 0.25, 0.0, 1.0);
      total2 = clamp(total2 * 0.25, 0.0, 1.0);
      float total3 = nfbm(p + w * dist * 0.3 + t * 0.05) * 0.5 + 0.5;
      col = softBlend(total1 * u_intensity, total2 * u_intensity, total3 * 0.7 * u_intensity);

    } else if (u_effect == 19) {
      vec2 w = warp(p * 0.4, t * 0.4);
      float angle = atan(p.y, p.x);
      float radius = length(p);
      float s1 = sin(angle * (1.5 + cpx * 2.0) + radius * (3.0 + cpx * 3.0) + t * 0.3 + w.x * dist * 1.5) * 0.5 + 0.5;
      float s2 = sin(angle * (1.2 + cpx * 1.5) - radius * (2.5 + cpx * 2.5) - t * 0.25 + w.y * dist * 1.5 + 1.5) * 0.5 + 0.5;
      float s3 = sin((angle + 3.14) * (0.8 + cpx) + radius * (2.0 + cpx * 2.0) + t * 0.15 + (w.x + w.y) * dist) * 0.5 + 0.5;
      float fade = exp(-radius * (0.5 - shp * 0.3));
      col = softBlend(s1 * fade * u_intensity, s2 * fade * u_intensity, s3 * fade * 0.7 * u_intensity);

    } else if (u_effect == 20) {
      vec2 w = warp(p * 0.5, t * 0.4);
      vec2 wp = p + w * (0.4 + dist * 0.6);
      float scale = 0.6 + cpx * 0.8;
      float h  = nfbm(wp * scale + t * 0.08);
      float eps = 0.06;
      float hx = nfbm((wp + vec2(eps, 0.0)) * scale + t * 0.08) - h;
      float hy = nfbm((wp + vec2(0.0, eps)) * scale + t * 0.08) - h;
      vec3 n = normalize(vec3(-hx * 6.0, -hy * 6.0, 1.0));
      vec3 lightDir = normalize(vec3(0.55, 0.65, 0.8));
      float light = max(dot(n, lightDir), 0.0);
      float spec = pow(light, 6.0 + shp * 26.0);
      float diffuse = light * 0.6 + 0.35;
      float fres = pow(1.0 - max(n.z, 0.0), 2.0);
      float w1 = (diffuse + spec * 0.5) * u_intensity;
      float w2 = (h * 0.5 + 0.5 + spec * 0.3 + fres * 0.3) * u_intensity;
      float w3 = (spec * 1.4 + fres * 0.5) * u_intensity;
      col = softBlend(w1, w2, w3);

    } else if (u_effect == 21) {
      vec2 w = warp(p * 0.4, t * 0.3);
      float angle = 0.2 + shp * 1.3;
      float ca = cos(angle), sa = sin(angle);
      vec2 rp = vec2(p.x * ca - p.y * sa, p.x * sa + p.y * ca);
      float band = sin(rp.y * (3.0 + cpx * 5.0) + w.x * (1.0 + dist * 2.5) + t * 0.35);
      float ridge = 1.0 - abs(band);
      ridge = pow(ridge, 5.0 + shp * 10.0);
      float band2 = sin(rp.y * (2.0 + cpx * 3.0) + w.y * (0.8 + dist * 2.0) - t * 0.22 + 1.4);
      float ridge2 = 1.0 - abs(band2);
      ridge2 = pow(ridge2, 3.0 + shp * 8.0);
      float bg = nfbm(p * 0.45 + t * 0.05) * 0.5 + 0.5;
      float w1 = (ridge * 1.4 + bg * 0.25) * u_intensity;
      float w2 = (ridge2 * 1.0 + bg * 0.45) * u_intensity;
      float w3 = (ridge * 0.5 + ridge2 * 0.5) * u_intensity * 0.8;
      col = softBlend(w1, w2, w3);

    } else if (u_effect == 22) {
      vec2 w  = warp(p * 0.7, t * 0.5);
      vec2 w2 = warp(p * 0.4 + w * 0.3, t * 0.3);
      vec2 wp = p + w * (0.4 + dist * 0.6);
      float n1 = snoise(wp * (1.4 + cpx * 1.6) + t * 0.14);
      float n2 = snoise((wp + w2 * dist * 0.4) * (2.0 + cpx * 2.0) + vec2(3.0, 7.0) - t * 0.1);
      float ridge1 = 1.0 - abs(n1);
      ridge1 = pow(ridge1, 5.0 + shp * 12.0);
      float ridge2 = 1.0 - abs(n2);
      ridge2 = pow(ridge2, 4.0 + shp * 10.0);
      float base = (n1 + n2) * 0.25 + 0.5;
      float w1 = (base * 0.6 + ridge1 * 1.2) * u_intensity;
      float w2c = ((1.0 - base) * 0.6 + ridge2 * 1.0) * u_intensity;
      float w3 = (ridge1 * 0.8 + ridge2 * 0.6) * u_intensity;
      col = softBlend(w1, w2c, w3);

    } else if (u_effect == 23) {
      float angle = 0.1 + shp * 1.4;
      float ca = cos(angle), sa = sin(angle);
      vec2 rp = vec2(p.x * ca - p.y * sa, p.x * sa + p.y * ca);
      vec2 stretch = vec2(rp.x * (5.0 + cpx * 4.0), rp.y * (0.35 + cpx * 0.3));
      vec2 sw = warp(stretch * 0.3, t * 0.3) * dist;
      float n1 = snoise(stretch + sw + t * 0.08);
      float n2 = snoise(stretch * 1.4 + vec2(2.0, 5.0) + sw - t * 0.06);
      float streak = 1.0 - abs(n1);
      streak = pow(streak, 6.0 + shp * 12.0);
      float streak2 = 1.0 - abs(n2);
      streak2 = pow(streak2, 4.0 + shp * 8.0);
      float bg = nfbm(p * 0.4 + t * 0.04) * 0.4 + 0.4;
      float w1 = (streak * 1.4 + bg * 0.3) * u_intensity;
      float w2 = (streak2 * 0.9 + bg * 0.5) * u_intensity;
      float w3 = (streak * 0.7 + streak2 * 0.4) * u_intensity * 0.8;
      col = softBlend(w1, w2, w3);

    } else if (u_effect == 24) {
      vec2 w1 = warp(p * 0.55, t * 0.4);
      vec2 w2 = warp(p * 0.7 + w1 * 0.4, t * 0.3);
      vec2 wp = p + (w1 + w2) * (0.4 + dist * 0.7);

      float scale = 0.65 + cpx * 0.7;
      float n1 = nfbm(wp * scale + vec2(0.0, 0.0) + t * 0.10);
      float n2 = nfbm(wp * scale + vec2(3.7, 5.2) - t * 0.07);
      float n3 = nfbm(wp * scale + vec2(7.1, 2.3) + t * 0.06);
      float n4 = nfbm(wp * scale + vec2(1.8, 8.4) - t * 0.08);
      float n5 = nfbm(wp * scale + vec2(4.9, 1.1) + t * 0.05);
      float n6 = nfbm(wp * scale + vec2(6.3, 7.8) - t * 0.09);
      float n7 = nfbm(wp * scale + vec2(2.4, 4.6) + t * 0.04);

      float pw = 2.5 + shp * 5.0;
      n1 = pow(clamp(n1, 0.0, 1.0), pw);
      n2 = pow(clamp(n2, 0.0, 1.0), pw);
      n3 = pow(clamp(n3, 0.0, 1.0), pw);
      n4 = pow(clamp(n4, 0.0, 1.0), pw);
      n5 = pow(clamp(n5, 0.0, 1.0), pw);
      n6 = pow(clamp(n6, 0.0, 1.0), pw);
      n7 = pow(clamp(n7, 0.0, 1.0), pw);

      float intens = 0.5 + u_intensity * 0.9;
      float a1 = n1 * u_alpha1 * intens;
      float a2 = n2 * u_alpha2 * intens;
      float a3 = n3 * u_alpha3 * intens;
      float a4 = n4 * u_alpha4 * intens;
      float a5 = n5 * u_alpha5 * intens;
      float a6 = n6 * u_alpha6 * intens;
      float a7 = n7 * u_alpha7 * intens;
      float total = a1 + a2 + a3 + a4 + a5 + a6 + a7 + 0.001;
      col = (u_color1 * a1 + u_color2 * a2 + u_color3 * a3 + u_color4 * a4
           + u_color5 * a5 + u_color6 * a6 + u_color7 * a7) / total;

    } else if (u_effect == 25) {
      float d = (uv.x + (1.0 - uv.y)) * 0.5;
      float w = 0.9 / max(u_scale, 0.25);
      float cyc = t * 0.08;
      float pA = mix(-w, 1.0 + w, sweepEase(fract(cyc)));
      float pB = mix(-w, 1.0 + w, sweepEase(fract(cyc + 0.5)));
      float band = max(
        clamp(1.0 - abs(d - pA) / w, 0.0, 1.0),
        clamp(1.0 - abs(d - pB) / w, 0.0, 1.0)
      );
      float v = band * u_intensity;

      vec2 ggs = gridCounts(6.0 + u_cellSize * 74.0);
      if (u_dotMode > 1.5) {
        ggs = max(vec2(2.0), floor(ggs * (1.0 - u_gap * 0.8)));
      }
      vec2 cell = floor(uv * ggs);
      float clk = t * 1.6;
      // Wrap the stepped clock to keep sin() arguments small. u_time grows
      // unbounded over a session; on mediump-float GPUs (older Android, some
      // iOS) large hash inputs lose precision and the flicker bands/freezes.
      // mod(x, 1024) keeps the crossfade continuous across the wrap
      // (step 1023 fades into step 0, whose hash is the next s0).
      float step0 = mod(floor(clk), 1024.0);
      float step1 = mod(step0 + 1.0, 1024.0);
      float fz = smoothstep(0.0, 1.0, fract(clk));
      float cellSeed = dot(cell, vec2(127.1, 311.7));
      float r1 = fract(sin(cellSeed + step0 * 17.23) * 43758.5453);
      float r2 = fract(sin(cellSeed + step1 * 17.23) * 43758.5453);
      float rnd = mix(r1, r2, fz);
      v += (rnd - 0.5) * u_flicker * 0.9 * (0.15 + band * 0.85);

      col = palette(clamp(v, 0.0, 1.0));
    }

    return col;
  }

  void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution;
    float aspect = u_resolution.x / u_resolution.y;
    float t = u_time * u_speed;
    float dist = u_distortion;
    float soft = u_softness;
    float cpx = u_complexity;
    float shp = u_shape;

    vec2 sampleUV = uv;
    if (u_dotMode > 0.5) {
      vec2 gs = gridCounts(6.0 + u_cellSize * 74.0);
      if (u_dotMode > 1.5) {
        gs = max(vec2(2.0), floor(gs * (1.0 - u_gap * 0.8)));
      }
      sampleUV = (floor(uv * gs) + vec2(0.5)) / gs;
    }

    vec3 col;
    if (u_blur < 0.01) {
      col = computeEffect(sampleUV, aspect, t, dist, soft, cpx, shp);
    } else {
      float r = u_blur * 0.02;
      col  = computeEffect(sampleUV, aspect, t, dist, soft, cpx, shp) * 0.4;
      col += computeEffect(sampleUV + vec2( r,  0.0), aspect, t, dist, soft, cpx, shp) * 0.15;
      col += computeEffect(sampleUV + vec2(-r,  0.0), aspect, t, dist, soft, cpx, shp) * 0.15;
      col += computeEffect(sampleUV + vec2( 0.0,  r), aspect, t, dist, soft, cpx, shp) * 0.15;
      col += computeEffect(sampleUV + vec2( 0.0, -r), aspect, t, dist, soft, cpx, shp) * 0.15;
    }

    vec3 baseCol = col;
    if (u_dotMode < 0.5) {
      col = pow(col, vec3(1.3));
    }

    // CSS-pixel distance to the nearest edge \u2014 keeps the vignette / edge-fade
    // bands a consistent physical width on every side of any aspect ratio.
    vec2 cssRes = u_resolution / max(u_dpr, 0.0001);
    vec2 cssCoord = uv * cssRes;
    float edgeDistPx = min(
      min(cssCoord.x, cssRes.x - cssCoord.x),
      min(cssCoord.y, cssRes.y - cssCoord.y)
    );
    float vigRangePx = 40.0 * (1.0 + u_vignette * 3.0);
    float vig = (edgeDistPx * edgeDistPx) / (vigRangePx * vigRangePx);
    vig = smoothstep(0.0, 1.0, vig);
    col *= mix(1.0, vig, u_vignette * u_vigOpacity);

    float colorAlpha = (u_alpha1 + u_alpha2 + u_alpha3 + u_alpha4 + u_alpha5) / 5.0;
    if (colorAlpha < 0.999) {
      vec3 c1d = col - u_color1, c2d = col - u_color2, c3d = col - u_color3, c4d = col - u_color4, c5d = col - u_color5;
      float prox1 = exp(-8.0 * dot(c1d, c1d));
      float prox2 = exp(-8.0 * dot(c2d, c2d));
      float prox3 = exp(-8.0 * dot(c3d, c3d));
      float prox4 = exp(-8.0 * dot(c4d, c4d));
      float prox5 = exp(-8.0 * dot(c5d, c5d));
      float pTotal = prox1 + prox2 + prox3 + prox4 + prox5 + 0.0001;
      colorAlpha = (prox1*u_alpha1 + prox2*u_alpha2 + prox3*u_alpha3 + prox4*u_alpha4 + prox5*u_alpha5) / pTotal;
    }
    float alpha = colorAlpha;

    if (u_dotMode > 0.5) {
      vec2 gridSize = gridCounts(6.0 + u_cellSize * 74.0);
      if (u_dotMode > 1.5) {
        gridSize = max(vec2(2.0), floor(gridSize * (1.0 - u_gap * 0.8)));
      }
      // cellLocal is in [0,1] within each cell. Because gridSize was chosen so
      // that cell PIXEL size is square, distance / mask math here works in
      // screen-square units even though we're operating in normalised cell uv.
      vec2 cellLocal = fract(uv * gridSize);

      float hlFactor = 0.0;
      if (u_highlight > 0.01 || u_hlScale > 0.01) {
        vec2 cellCenter = (floor(uv * gridSize) + vec2(0.5)) / gridSize;
        vec2 cp2 = (cellCenter - 0.5) * u_scale;
        cp2.x *= aspect;
        float lw = sin(cp2.x * 3.0 + t * 1.5) * 0.5 + 0.5;
        lw *= sin(cp2.y * 2.5 - t * 1.1) * 0.5 + 0.5;
        lw += (snoise(cp2 * 2.0 + t * 0.6) * 0.5 + 0.5) * 0.3;
        hlFactor = clamp(lw, 0.0, 1.0);
        hlFactor *= hlFactor;
      }

      float scaleBoost = 1.0 + smoothstep(0.2, 0.8, hlFactor) * u_hlScale * 1.2;

      float mask = 1.0;
      if (u_dotMode < 1.5) {
        float gapW = u_gap * 0.35 / scaleBoost;
        if (gapW > 0.003) {
          mask = step(gapW, cellLocal.x) * step(gapW, 1.0 - cellLocal.x)
               * step(gapW, cellLocal.y) * step(gapW, 1.0 - cellLocal.y);
        }
      } else {
        // Render the circular dot mask in screen-pixel space rather than
        // cell-local UV. We map the cell-local offset to actual pixels
        // (cellPx = u_resolution / gridSize), then apply a 1-pixel AA
        // floor to the smoothstep edge so the dot rim is crisp and
        // properly anti-aliased even at u_dotSoftness near 0. The user
        // softness slider still scales linearly on top of the floor.
        // No fwidth() / GL_OES_standard_derivatives needed - dPx is
        // already in pixel units, so a fixed 1-px edge IS pixel-perfect.
        // gridCounts() already keeps cells square in screen space, so
        // pxOffset traces true circles (not ellipses) on any aspect.
        vec2 cellPx = u_resolution / gridSize;
        vec2 pxOffset = (cellLocal - 0.5) * cellPx;
        float dPx = length(pxOffset);
        float minCellPx = min(cellPx.x, cellPx.y);
        float radiusPx = u_dotSize * 0.5 * minCellPx * scaleBoost;
        // 0.5-px AA floor (1-px total smoothstep ramp) keeps the rim
        // pixel-perfect at u_dotSoftness=0 while letting the user softness
        // value dominate at the bundled preset defaults (e.g. softness=0.1
        // on a ~28-px cell yields softPx=0.56 -> ~1.1-px ramp, matching
        // the original cell-local behaviour). A larger floor (e.g. 1.0)
        // would widen low-softness dots and visually lighten dot presets.
        float aaPx = 0.5;
        float softPx = u_dotSoftness * 0.2 * minCellPx;
        float edgePx = max(aaPx, softPx);
        mask = 1.0 - smoothstep(radiusPx - edgePx, radiusPx + edgePx, dPx);
      }

      if (u_highlight > 0.01) {
        float hl = hlFactor * u_highlight;
        col = col * (1.0 + hl * 2.5) + vec3(hl * hl * 0.3);
      }

      if (u_edgeFade > 0.5 && u_fadeStr > 0.005) {
        float ef = smoothstep(0.0, u_edgeFade, edgeDistPx);
        mask *= mix(1.0, ef, u_fadeStr);
      }

      float baseOpacity = (u_dotMode < 1.5) ? u_fillOpacity : 0.0;
      alpha = colorAlpha * mix(baseOpacity, u_dotOpacity, mask);

      float bgLum  = dot(u_cardBg, vec3(0.299, 0.587, 0.114));
      float colLum = dot(baseCol, vec3(0.299, 0.587, 0.114));
      alpha *= smoothstep(0.0, 0.33, abs(colLum - bgLum));
    }

    gl_FragColor = vec4(col, alpha * u_shaderOpacity);
  }
`,Sb=1e3/10,ev=1.25,aN=2;function Db(){return typeof window>"u"?1:Math.min(window.devicePixelRatio||1,aN)}var Dt=null;function sN(){return{u_resolution:{value:new oe(1,1)},u_dpr:{value:1},u_time:{value:0},u_color1:{value:new Zt(1710618)},u_color2:{value:new Zt(8421504)},u_color3:{value:new Zt(14277081)},u_color4:{value:new Zt(4210752)},u_color5:{value:new Zt(12632256)},u_color6:{value:new Zt(6316128)},u_color7:{value:new Zt(10526880)},u_cardBg:{value:new Zt(986895)},u_alpha1:{value:1},u_alpha2:{value:1},u_alpha3:{value:1},u_alpha4:{value:1},u_alpha5:{value:1},u_alpha6:{value:1},u_alpha7:{value:1},u_speed:{value:1},u_intensity:{value:1},u_scale:{value:1.5},u_direction:{value:0},u_softness:{value:.75},u_distortion:{value:.3},u_complexity:{value:.2},u_shape:{value:.5},u_flicker:{value:0},u_vignette:{value:.25},u_vigOpacity:{value:1},u_blur:{value:0},u_highlight:{value:.4},u_shaderOpacity:{value:1},u_cellSize:{value:.5},u_gap:{value:.3},u_dotSize:{value:.8},u_dotSoftness:{value:.1},u_dotOpacity:{value:1},u_hlScale:{value:0},u_fillOpacity:{value:0},u_edgeFade:{value:16},u_fadeStr:{value:1},u_dotMode:{value:2},u_effect:{value:4},u_sweepEase:{value:0}}}function rN(){if(Dt)return Dt;let e=document.createElement("canvas");e.width=8,e.height=8;let t=new xd({canvas:e,alpha:!0,premultipliedAlpha:!1,preserveDrawingBuffer:!1,antialias:!1,powerPreference:"high-performance"});t.setPixelRatio(Math.min(typeof window<"u"?window.devicePixelRatio:1,ev)),t.setClearColor(0,0),t.autoClear=!0;let n=t.getContext(),i=new fc,a=new pr(-1,1,1,-1,0,1),s=sN(),r=new Rn({vertexShader:nN,fragmentShader:iN,uniforms:s,transparent:!0,depthTest:!1,depthWrite:!1,blending:Cs}),o=new dr(2,2),l=new Gn(o,r);i.add(l),Dt={glCanvas:e,gl:n,renderer:t,scene:i,camera:a,material:r,geometry:o,mesh:l,uniforms:s,instances:new Set,rafId:0,lastFrameMs:0,lastTickMs:performance.now(),lastInstance:null,onContextLost:null,onContextRestored:null,contextLost:!1};let c=p=>{p.preventDefault(),Dt&&(Dt.contextLost=!0,Dt.rafId!==0&&(cancelAnimationFrame(Dt.rafId),Dt.rafId=0))},f=()=>{if(Dt){Dt.contextLost=!1,Dt.lastInstance=null;for(let p of Dt.instances)p.uniformsDirty=!0;Oc()}};return e.addEventListener("webglcontextlost",c,!1),e.addEventListener("webglcontextrestored",f,!1),Dt.onContextLost=c,Dt.onContextRestored=f,Oc(),Dt}function oN(){Dt&&(Dt.rafId!==0&&cancelAnimationFrame(Dt.rafId),Dt.onContextLost&&Dt.glCanvas.removeEventListener("webglcontextlost",Dt.onContextLost,!1),Dt.onContextRestored&&Dt.glCanvas.removeEventListener("webglcontextrestored",Dt.onContextRestored,!1),Dt.geometry.dispose(),Dt.material.dispose(),Dt.renderer.dispose(),Dt=null)}function lN(e,t){var n;let i=t.preset,a=e.uniforms;a.u_effect.value=i.effectIndex,a.u_speed.value=i.speed,a.u_intensity.value=i.intensity,a.u_scale.value=i.scale,a.u_direction.value=i.direction*Math.PI/180,a.u_softness.value=i.softness,a.u_distortion.value=i.distortion,a.u_complexity.value=i.complexity,a.u_shape.value=i.shape,a.u_flicker.value=i.flicker??0,a.u_vignette.value=i.vignette,a.u_vigOpacity.value=i.vigOpacity,a.u_blur.value=i.blur,a.u_highlight.value=i.highlight,a.u_shaderOpacity.value=i.shaderOpacity,a.u_dotMode.value=i.dotMode,a.u_sweepEase.value=i.sweepEase!=null?Math.floor(i.sweepEase):0;let s=i.dotMode===1?i.pixelConfig:i.dotConfig;a.u_cellSize.value=Ic(s.cellSize,t.pixelScale),a.u_gap.value=s.gap,a.u_dotSize.value=s.dotSize,a.u_dotSoftness.value=s.dotSoftness,a.u_dotOpacity.value=s.dotOpacity,a.u_hlScale.value=s.hlScale,a.u_fillOpacity.value=s.fillOpacity,a.u_edgeFade.value=s.edgeFade,a.u_fadeStr.value=s.fadeStr;let[r,o,l]=xr(t.cardBgOverride??i.cardBg);for(let c=0;c<7;c++){let f=(n=t.colorsOverride)==null?void 0:n[c],[p,u,d]=f!=null?xr(f):Td(t,c);a[`u_color${c+1}`].value.setRGB(p,u,d),a[`u_alpha${c+1}`].value=i.alphas[c]}a.u_cardBg.value.setRGB(r,o,l),t.uniformsDirty=!1}function cN(e){return e.cardBgOverride??e.preset.cardBg}function Td(e,t){let n=e.preset,[i,a,s]=xr(n.colors[t]);if(e.cardBgOverride==null)return[i,a,s];let[r,o,l]=xr(n.cardBg),c=f=>Math.round(f*255);return c(i)===c(r)&&c(a)===c(o)&&c(s)===c(l)?xr(e.cardBgOverride):[i,a,s]}function uN(e){return{iw:Math.max(1,Math.floor(e.cssWidth*e.dpr)),ih:Math.max(1,Math.floor(e.cssHeight*e.dpr))}}function Nb(e){let t=0,n=0;for(let f of e.instances)!f.visible||f.paused||(f.cssWidth>t&&(t=f.cssWidth),f.cssHeight>n&&(n=f.cssHeight));if(t<=0||n<=0)return;let i=e.renderer.getPixelRatio(),a=Math.max(1,Math.floor(t*i)),s=Math.max(1,Math.floor(n*i)),r=e.glCanvas.width,o=e.glCanvas.height;if(a<=r&&s<=o)return;let l=Math.max(t,r/Math.max(i,1e-4)),c=Math.max(n,o/Math.max(i,1e-4));e.renderer.setSize(l,c,!1)}function Ub(e,t,n){var i;if(e.contextLost)return;let{iw:a,ih:s}=uN(t),r=Math.max(1,t.cssWidth),o=Math.max(1,t.cssHeight);e.renderer.setViewport(0,0,r,o),e.renderer.setScissor(0,0,r,o),e.renderer.setScissorTest(!0),e.uniforms.u_resolution.value.set(a,s),e.uniforms.u_dpr.value=t.dpr||1,e.lastInstance===t&&!t.uniformsDirty||(lN(e,t),e.lastInstance=t),e.uniforms.u_time.value=t.accumulatedTime,e.renderer.render(e.scene,e.camera);let l=Math.max(1,Math.floor(t.cssWidth*t.canvasDpr)),c=Math.max(1,Math.floor(t.cssHeight*t.canvasDpr));(t.canvas.width!==l||t.canvas.height!==c)&&(t.canvas.width=l,t.canvas.height=c),t.ctx.clearRect(0,0,l,c);let f=e.glCanvas.height-s;t.ctx.imageSmoothingEnabled=!1,t.ctx.drawImage(e.glCanvas,0,f,a,s,0,0,l,c),(i=t.reveal)==null||i.afterShaderFrame(e,t,n),t.reveal&&t.reveal.isActive()&&(e.lastInstance=null)}function fN(e,t,n){!t.visible||t.paused||t.cssWidth<1||t.cssHeight<1||Ub(e,t,n)}function Md(e){Dt&&(Dt.contextLost||e.visible&&(e.cssWidth<1||e.cssHeight<1||(Nb(Dt),Ub(Dt,e,performance.now()))))}function hN(e){for(let t of e.instances)if(t.visible&&!t.paused)return!0;return!1}var Lb=e=>{if(!Dt)return;if(Dt.contextLost){Dt.rafId=0;return}if(!hN(Dt)){Dt.rafId=0;return}Dt.rafId=requestAnimationFrame(Lb);let t=e-Dt.lastFrameMs;if(t<Sb)return;Dt.lastFrameMs=e-t%Sb;let n=(e-Dt.lastTickMs)/1e3;Dt.lastTickMs=e;for(let i of Dt.instances)i.visible&&!i.paused&&(i.accumulatedTime+=n);Nb(Dt);for(let i of Dt.instances)fN(Dt,i,e)};function Oc(){Dt&&(Dt.contextLost||Dt.rafId===0&&(Dt.lastTickMs=performance.now(),Dt.lastFrameMs=Dt.lastTickMs,Dt.rafId=requestAnimationFrame(Lb)))}function Ic(e,t){return!(t>0)||t===1?e:((6+e*74)/t-6)/74}function dN(e){let t=rN(),n=e.canvas.getContext("2d");if(!n)throw new Error("img-fx: 2D context unavailable");let i={canvas:e.canvas,ctx:n,cssWidth:e.cssWidth,cssHeight:e.cssHeight,dpr:Math.min(typeof window<"u"?window.devicePixelRatio:1,ev),canvasDpr:Db(),preset:e.preset,cardBgOverride:e.cardBg??null,colorsOverride:null,strength:e.strength??1,pixelScale:e.pixelScale!=null&&e.pixelScale>0?e.pixelScale:1,visible:!0,paused:!1,uniformsDirty:!0,reveal:null,accumulatedTime:Math.random()*1e3,startedAtMs:performance.now()};return t.instances.add(i),Oc(),i}function pN(e){var t;Dt&&(Dt.instances.delete(e),Dt.lastInstance===e&&(Dt.lastInstance=null),(t=e.reveal)==null||t.dispose(),e.reveal=null,Dt.instances.size===0&&oN())}function mN(e,t,n){e.cssWidth=t,e.cssHeight=n,typeof window<"u"&&(e.dpr=Math.min(window.devicePixelRatio,ev),e.canvasDpr=Db())}function gN(e,t){e.preset=t,e.uniformsDirty=!0}function vN(e,t){e.cardBgOverride=t,e.uniformsDirty=!0}function _N(e,t){e.colorsOverride=t&&t.length>0?t.slice(0,7):null,e.uniformsDirty=!0}function xN(e,t){e.visible=t,t&&Oc()}function yN(e,t){e.paused=t,t||Oc()}function SN(e,t){e.strength=Math.max(0,Math.min(1,t))}function MN(e,t){e.pixelScale=t>0?t:1,e.uniformsDirty=!0}var Mb={linear:e=>e,smoothstep:e=>e*e*(3-2*e),easeOutCubic:e=>1-Math.pow(1-e,3),easeOutQuint:e=>1-Math.pow(1-e,5),easeInOutCubic:e=>e<.5?4*e*e*e:1-Math.pow(-2*e+2,3)/2,easeOutExpo:e=>e===1?1:1-Math.pow(2,-10*e),easeOutBack:e=>1+(1.70158+1)*Math.pow(e-1,3)+1.70158*Math.pow(e-1,2)};function Pc(e,t){return(Mb[e]??Mb.smoothstep)(Math.max(0,Math.min(1,t)))}var bN=64,TN=96,Jo=320,EN=.006;function nv(e,t,n){let i=t/Math.max(1,n),a=e.width/Math.max(1,e.height),s=0,r=0,o=e.width,l=e.height;a>i?(o=e.height*i,s=(e.width-o)/2):(l=e.width/i,r=(e.height-l)/2);let c=Math.min(o,l)*EN;return o-2*c>1&&l-2*c>1&&(s+=c,r+=c,o-=2*c,l-=2*c),{sx:s,sy:r,sw:o,sh:l}}var Jg=new Map;function AN(e){let t=Jg.get(e);return t||(t=new Promise((n,i)=>{let a=new Image,s=()=>n(a);a.onerror=r=>{Jg.delete(e),i(r)},typeof a.decode=="function"?(a.src=e,a.decode().then(s,()=>{a.complete&&a.naturalWidth>0?s():a.onload=s})):(a.onload=s,a.src=e)}),Jg.set(e,t),t)}function Bi(e,t,n,i,a){let s=t==="a"?e.coverA:e.coverB;if(!s){let r=document.createElement("canvas"),o=r.getContext("2d");if(!o)throw new Error("img-fx: 2D context unavailable for cover bitmap");s={canvas:r,ctx:o,img:null,w:0,h:0},t==="a"?e.coverA=s:e.coverB=s}if(s.img!==n||s.w!==i||s.h!==a){s.canvas.width=i,s.canvas.height=a,s.w=i,s.h=a,s.img=n;let{sx:r,sy:o,sw:l,sh:c}=nv(n,i,a);s.ctx.clearRect(0,0,i,a),s.ctx.imageSmoothingEnabled=!0,s.ctx.imageSmoothingQuality="high",s.ctx.drawImage(n,r,o,l,c,0,0,i,a)}return s.canvas}function Ob(e){return e.dotMode===2?TN:bN}function Ib(e){let t=e.revealConfig;return e.dotMode===2?{duration:Math.max(.05,t.dotDuration),easingKey:t.dotEasing}:{duration:Math.max(.05,t.duration),easingKey:t.easing}}function wN(e,t,n,i){let a=n/(i-1),s=t/(i-1),r=a-.5,o=s-.5;switch(e){case"radialCenter":return 1-Math.sqrt(r*r+o*o)*2;case"radialCorner":return 1-Math.sqrt(a*a+s*s)/1.414;case"linearTop":return 1-s;case"linearBottom":return s;case"linearLeft":return 1-a;case"linearRight":return a;case"diagonalTL":return 1-(a+s)/2;case"diagonalBR":return(a+s)/2;case"diamond":return 1-(Math.abs(r)+Math.abs(o));case"blindsH":return 1-s*8%1;case"blindsV":return 1-a*8%1;default:return-1}}function Pb(e,t,n,i,a){let s=t.uniforms.u_dotMode.value,r=t.uniforms.u_fillOpacity.value,o=n.preset.dotMode,l=o<1.5?0:1;t.uniforms.u_dotMode.value=l,t.uniforms.u_fillOpacity.value=l>.5?o===1?n.preset.pixelConfig.fillOpacity:n.preset.dotConfig.fillOpacity:0,t.renderer.render(t.scene,t.camera);let c=Math.max(1,Math.floor(n.cssWidth*n.dpr)),f=Math.max(1,Math.floor(n.cssHeight*n.dpr)),p=Math.max(0,t.glCanvas.height-f);e.sampleGpuCanvas||(e.sampleGpuCanvas=document.createElement("canvas"),e.sampleGpuCtx=e.sampleGpuCanvas.getContext("2d"));let u=e.sampleGpuCanvas,d=e.sampleGpuCtx;return(u.width!==a||u.height!==a)&&(u.width=a,u.height=a),d.clearRect(0,0,a,a),d.drawImage(t.glCanvas,0,p,c,f,0,0,a,a),i.clearRect(0,0,a,a),i.drawImage(u,0,0),t.uniforms.u_dotMode.value=s,t.uniforms.u_fillOpacity.value=r,e.sampleImgData=i.getImageData(0,0,a,a),e.sampleDataCache=e.sampleImgData.data,e.sampleDataCache}function Bb(e,t){e.sampleCanvas||(e.sampleCanvas=document.createElement("canvas"),e.sampleCtx=e.sampleCanvas.getContext("2d",{willReadFrequently:!0})),(e.sampleCanvas.width!==t||e.sampleCanvas.height!==t)&&(e.sampleCanvas.width=t,e.sampleCanvas.height=t,e.sampleImgData=null,e.sampleDataCache=null,e.sampleFrameCounter=0),e.maskGrad||(e.maskGrad=document.createElement("canvas"),e.maskGradCtx=e.maskGrad.getContext("2d")),(e.maskGrad.width!==t||e.maskGrad.height!==t)&&(e.maskGrad.width=t,e.maskGrad.height=t,e.maskImgData=null),!e.maskImgData&&e.maskGradCtx&&(e.maskImgData=e.maskGradCtx.createImageData(t,t))}function CN(e,t,n,i){if(!e.image)return;let a=n.preset,s=n.canvas.width,r=n.canvas.height;(i.canvas.width!==s||i.canvas.height!==r)&&(i.canvas.width=s,i.canvas.height=r),i.clearRect(0,0,s,r);let{duration:o,easingKey:l}=Ib(a),c=(performance.now()-e.revealStartMs)/1e3,f=Math.min(c/o,1),p=Pc(l,f),u=e.image,{sx:d,sy:_,sw:b,sh:m}=nv(u,s,r),h=a.revealConfig.blur;if(f<1&&h>0){let Et=h*(1-p);i.canvas.style.filter=Et>.1?`blur(${Et.toFixed(1)}px)`:"none"}else i.canvas.style.filter="none";if(f>=1){i.imageSmoothingEnabled=!0,i.imageSmoothingQuality="high",i.drawImage(Bi(e,"a",u,s,r),0,0);return}let g=Ob(a);Bb(e,g);let S=e.sampleCtx,y=e.maskGrad,T=e.maskGradCtx,A=a.revealConfig.maskShape,E=a.revealConfig.softness,x=A.startsWith("shader"),w=null,R=null,D=null;if(x){let Et=e.sampleFrameCounter++;e.sampleDataCache==null||(Et&1)===0?w=Pb(e,t,n,S,g):w=e.sampleDataCache;let Pt={shaderColor1:0,shaderColor2:1,shaderColor3:2,shaderColor4:3,shaderColor5:4};if(Pt[A]!=null&&(R=Td(n,Pt[A])),A==="shaderHighlight"){let k=xr(cN(n));D=[];for(let Y=0;Y<5;Y++){let lt=Td(n,Y),xt=lt[0]-k[0],ot=lt[1]-k[1],at=lt[2]-k[2];Math.sqrt(xt*xt+ot*ot+at*at)>.15&&D.push(lt)}D.length===0&&(D=[Td(n,0)])}}let P=1-p*(1+E),F=A==="gradientSweep",U=0,B=0,X=2,Z=a.flicker??0,$=null,z=null,K=0,j=0,vt=0;if(Z>.003){X=Math.max(2,Math.floor(6+Ic(a.pixelConfig.cellSize,n.pixelScale)*74));let Et=n.accumulatedTime*Math.max(a.speed,2)*1.6,Pt=Math.floor(Et);K=Pt%1024,j=(K+1)%1024,vt=Et-Pt,vt=vt*vt*(3-2*vt);let k=(lt,xt)=>{let ot=Math.sin(lt*127.1+xt*17.23)*43758.5453;return ot-Math.floor(ot)};z=k;let Y=X*X;(!e.gsFlickerTable||e.gsFlickerTable.length!==Y)&&(e.gsFlickerTable=new Float32Array(Y)),$=e.gsFlickerTable;for(let lt=0;lt<Y;lt++){let xt=k(lt,K)*(1-vt)+k(lt,j)*vt;$[lt]=(xt-.5)*Z*1.6}}F&&(U=.9/Math.max(a.scale,.25),B=-U+p*(1+2*U));let yt=e.maskImgData,$t=yt.data;for(let Et=0;Et<g;Et++)for(let Pt=0;Pt<g;Pt++){let k;if(x&&w){let xt=(Et*g+Pt)*4,ot=w[xt]/255,at=w[xt+1]/255,Ut=w[xt+2]/255;if(D){let Ct=0;for(let Bt of D){let Wt=ot-Bt[0],Ot=at-Bt[1],ie=Ut-Bt[2],de=Math.exp(-10*(Wt*Wt+Ot*Ot+ie*ie));de>Ct&&(Ct=de)}k=Ct}else if(R){let Ct=ot-R[0],Bt=at-R[1],Wt=Ut-R[2];k=Math.exp(-8*(Ct*Ct+Bt*Bt+Wt*Wt))}else k=(w[xt]*.299+w[xt+1]*.587+w[xt+2]*.114)/255}else F?k=0:k=wN(A,Et,Pt,g);let Y;if(F){let xt=Pt/(g-1),ot=Et/(g-1),at=(xt+ot)*.5;Y=(B+U-at)/(2*U)}else Y=(k-P)/E;if($&&Y>-.5&&Y<1.5){let xt=Y<0?0:Y>1?1:Y,ot=xt*(1-xt)*4;if(ot>.001){let at=Pt/(g-1),Ut=Et/(g-1),Ct=Math.floor(Ut*X)*X+Math.floor(at*X);Y+=$[Ct]*ot}}Y<0?Y=0:Y>1&&(Y=1),Y=Y*Y*(3-2*Y);let lt=(Et*g+Pt)*4;$t[lt]=255,$t[lt+1]=255,$t[lt+2]=255,$t[lt+3]=Y*255+.5|0}if(T.putImageData(yt,0,0),a.dotMode===1)DN(e,i,u,d,_,b,m,a,c,s,r,n,F?0:Z,z,K,j,vt);else{a.dotMode===2?RN(e,i,u,d,_,b,m,Ic(a.pixelConfig.cellSize,n.pixelScale),c,a.revealConfig.pixDuration,a.revealConfig.pixEasing,n,s,r):(i.imageSmoothingEnabled=!0,i.imageSmoothingQuality="high",i.drawImage(Bi(e,"a",u,s,r),0,0)),i.globalCompositeOperation="destination-in";let Et=a.dotMode===2&&x;Et&&(i.imageSmoothingEnabled=!1),i.drawImage(y,0,0,s,r),Et&&(i.imageSmoothingEnabled=!0),i.globalCompositeOperation="source-over"}}function RN(e,t,n,i,a,s,r,o,l,c,f,p,u,d){let _=6+o*74,b=Math.max(1,p.cssWidth),m=Math.max(1,p.cssHeight),h=Math.max(2,Math.floor(_*b/Jo)),g=Math.max(2,Math.floor(_*m/Jo)),S=h*g,y=Math.max(.05,c),T=Math.max(0,Math.min(1,l/y)),A=Pc(f,T);e.pixCanvas||(e.pixCanvas=document.createElement("canvas"),e.pixCtx=e.pixCanvas.getContext("2d"));let E=e.pixCanvas,x=e.pixCtx;(E.width!==h||E.height!==g)&&(E.width=h,E.height=g),e.pixDrop||(e.pixDrop=document.createElement("canvas"),e.pixDropCtx=e.pixDrop.getContext("2d"));let w=e.pixDrop,R=e.pixDropCtx;if(w.width!==h||w.height!==g){w.width=h,w.height=g,e.pixDropImgData=R.createImageData(h,g);let B=e.pixDropImgData.data;for(let X=0;X<B.length;X+=4)B[X]=255,B[X+1]=255,B[X+2]=255}let D=.07,P=1/(2*D);if(!e.pixDropPattern||e.pixDropPatternW!==h||e.pixDropPatternH!==g||e.pixDropRevealStart!==e.revealStartMs){e.pixDropPattern=new Float32Array(S);let B=D,X=1-2*D;for(let Z=0;Z<e.pixDropPattern.length;Z++)e.pixDropPattern[Z]=B+Math.random()*X;e.pixDropPatternW=h,e.pixDropPatternH=g,e.pixDropRevealStart=e.revealStartMs}let F=e.pixDropImgData.data,U=e.pixDropPattern;for(let B=0;B<U.length;B++){let X=.5+(U[B]-A)*P;X<0?X=0:X>1&&(X=1),F[B*4+3]=X*255+.5|0}R.putImageData(e.pixDropImgData,0,0),x.globalCompositeOperation="source-over",x.clearRect(0,0,h,g),x.imageSmoothingEnabled=!0,x.imageSmoothingQuality="high",x.drawImage(Bi(e,"a",n,u,d),0,0,u,d,0,0,h,g),x.globalCompositeOperation="destination-in",x.imageSmoothingEnabled=!1,x.drawImage(w,0,0),x.globalCompositeOperation="source-over",t.imageSmoothingEnabled=!0,t.imageSmoothingQuality="high",t.drawImage(Bi(e,"a",n,u,d),0,0),t.imageSmoothingEnabled=!1,t.drawImage(E,0,0,h,g,0,0,u,d),t.imageSmoothingEnabled=!0}function DN(e,t,n,i,a,s,r,o,l,c,f,p,u,d,_,b,m){let h=6+Ic(o.pixelConfig.cellSize,p.pixelScale)*74,g=Math.max(1,p.cssWidth),S=Math.max(1,p.cssHeight),y=Math.max(2,Math.floor(h*g/Jo)),T=Math.max(2,Math.floor(h*S/Jo)),A=y*T,E=Math.max(.05,o.revealConfig.pixDuration),x=Math.max(0,Math.min(1,l/E)),w=Pc(o.revealConfig.pixEasing,x);e.pixCanvas||(e.pixCanvas=document.createElement("canvas"),e.pixCtx=e.pixCanvas.getContext("2d"));let R=e.pixCanvas,D=e.pixCtx;(R.width!==y||R.height!==T)&&(R.width=y,R.height=T),e.pixDrop||(e.pixDrop=document.createElement("canvas"),e.pixDropCtx=e.pixDrop.getContext("2d"));let P=e.pixDrop,F=e.pixDropCtx;if(P.width!==y||P.height!==T){P.width=y,P.height=T,e.pixDropImgData=F.createImageData(y,T);let z=e.pixDropImgData.data;for(let K=0;K<z.length;K+=4)z[K]=255,z[K+1]=255,z[K+2]=255}let U=.07,B=1/(2*U);if(!e.pixDropPattern||e.pixDropPatternW!==y||e.pixDropPatternH!==T||e.pixDropRevealStart!==e.revealStartMs){e.pixDropPattern=new Float32Array(A);let z=U,K=1-2*U;for(let j=0;j<e.pixDropPattern.length;j++)e.pixDropPattern[j]=z+Math.random()*K;e.pixDropPatternW=y,e.pixDropPatternH=T,e.pixDropRevealStart=e.revealStartMs}let X=e.pixDropImgData.data,Z=e.pixDropPattern,$=u>.003&&d!=null;for(let z=0;z<Z.length;z++){let K=Z[z],j=.5+(K-w)*B;if(j<0?j=0:j>1&&(j=1),$){let vt=1-Math.abs(w-K)*6.25;if(vt>0){let yt=d(z,_)*(1-m)+d(z,b)*m;j+=(yt-.5)*u*1.6*vt,j<0?j=0:j>1&&(j=1)}}X[z*4+3]=j*255+.5|0}F.putImageData(e.pixDropImgData,0,0),D.globalCompositeOperation="source-over",D.clearRect(0,0,y,T),D.imageSmoothingEnabled=!0,D.imageSmoothingQuality="high",D.drawImage(Bi(e,"a",n,c,f),0,0,c,f,0,0,y,T),D.globalCompositeOperation="destination-in",D.imageSmoothingEnabled=!1,D.drawImage(P,0,0),D.globalCompositeOperation="source-over",t.imageSmoothingEnabled=!0,t.imageSmoothingQuality="high",t.drawImage(Bi(e,"a",n,c,f),0,0),t.imageSmoothingEnabled=!1,t.drawImage(R,0,0,y,T,0,0,c,f),t.imageSmoothingEnabled=!0,D.globalCompositeOperation="source-over",D.clearRect(0,0,y,T),D.imageSmoothingEnabled=!0,D.imageSmoothingQuality="high",D.drawImage(e.maskGrad,0,0,y,T),t.imageSmoothingEnabled=!1,t.globalCompositeOperation="destination-in",t.drawImage(R,0,0,y,T,0,0,c,f),t.imageSmoothingEnabled=!0,t.globalCompositeOperation="source-over"}var Kg=800,Qg=300,NN=1,UN=.5,LN=.03,bb=.6,Tb=800,ON=400,IN=1200;function PN(e,t,n,i,a,s){var r;let o=e.image;if(!o)return;let l=n.preset,c=n.canvas.width,f=n.canvas.height;(i.canvas.width!==c||i.canvas.height!==f)&&(i.canvas.width=c,i.canvas.height=f),i.canvas.style.filter="none";let p=6+Ic(l.pixelConfig.cellSize,n.pixelScale)*74,u=Math.max(1,n.cssWidth),d=Math.max(1,n.cssHeight),_=Math.max(2,Math.floor(p*u/Jo)),b=Math.max(2,Math.floor(p*d/Jo)),m=_*b,h=e.pendingReveal,g=h&&e.boilHandoffStartMs>0?s-e.boilHandoffStartMs:-1,S=N=>N*N*(3-2*N),y=g<0?0:S(Math.min(1,g/Tb)),T=g<0?-1:g-Tb,A=T<=0?0:S(Math.min(1,T/ON)),E=T<=0?0:Math.min(1,T/IN),x=h!=null&&T>0,w=s-e.boilStartMs,R=Math.min(1,w/Kg),D=R*R*(3-2*R),P=R<1,F=Math.min(1,Math.max(0,w-(Kg-Qg))/Qg),U=1-F*F*(3-2*F),B=Math.min(1,Math.max(0,w-(Kg-Qg))/(NN*1e3)),X=B*B*(3-2*B),Z=X*UN;a.style.opacity=String(X),e.pixCanvas||(e.pixCanvas=document.createElement("canvas"),e.pixCtx=e.pixCanvas.getContext("2d"));let $=e.pixCanvas,z=e.pixCtx;($.width!==_||$.height!==b)&&($.width=_,$.height=b),e.pixDrop||(e.pixDrop=document.createElement("canvas"),e.pixDropCtx=e.pixDrop.getContext("2d"));let K=e.pixDrop,j=e.pixDropCtx;if(K.width!==_||K.height!==b||!e.pixDropImgData){K.width=_,K.height=b,e.pixDropImgData=j.createImageData(_,b);let N=e.pixDropImgData.data;for(let jt=0;jt<N.length;jt+=4)N[jt]=255,N[jt+1]=255,N[jt+2]=255}if(!e.boilPattern||e.boilPatternW!==_||e.boilPatternH!==b){e.boilPattern=new Float32Array(m);for(let N=0;N<m;N++)e.boilPattern[N]=Math.random();e.boilPatternW=_,e.boilPatternH=b}let vt=Math.max(l.flicker??0,.5),yt=n.accumulatedTime*Math.max(l.speed,2)*1.6,$t=Math.floor(yt),Et=$t%1024,Pt=(Et+1)%1024,k=yt-$t;k=k*k*(3-2*k);let Y=(N,jt)=>{let zt=Math.sin(N*127.1+jt*17.23)*43758.5453;return zt-Math.floor(zt)},lt=e.pixDropImgData.data,xt=e.boilPattern,ot=Ob(l);Bb(e,ot);let at=e.sampleFrameCounter++,Ut=e.sampleDataCache==null||at%3===0,Ct=!e.boilField||e.boilField.length!==m,Bt=Ut?Pb(e,t,n,e.sampleCtx,ot):e.sampleDataCache;if(Ut||Ct){Ct&&(e.boilField=new Float32Array(m));let N=e.boilField,jt=1,zt=0;for(let v=0;v<b;v++){let I=Math.min(ot-1,(v+.5)*ot/b|0);for(let H=0;H<_;H++){let J=Math.min(ot-1,(H+.5)*ot/_|0),st=(I*ot+J)*4,it=(Bt[st]*.299+Bt[st+1]*.587+Bt[st+2]*.114)/255;N[v*_+H]=it,it<jt&&(jt=it),it>zt&&(zt=it)}}let C=zt-jt>.001?1/(zt-jt):0;for(let v=0;v<m;v++)N[v]=C>0?(N[v]-jt)*C:.5}let Wt=e.boilField,Ot=1/(2*LN),ie=vt*.6*(1-E),de=1-bb,Be=x?Pc(l.revealConfig.pixEasing,E):0,ce=1/(2*.07),be=l.flicker??0;for(let N=0;N<m;N++){let jt=Y(N,Et)*(1-k)+Y(N,Pt)*k,zt=.5+(Wt[N]*bb+xt[N]*de+(jt-.5)*ie-Z)*Ot;if(zt<0?zt=0:zt>1&&(zt=1),P){let C=xt[N],v=.5+(D-C)*ce;v<0?v=0:v>1&&(v=1);let I=1-Math.abs(D-C)*6.25;I>0&&(v+=(jt-.5)*vt*1.6*I,v<0?v=0:v>1&&(v=1)),v<zt&&(zt=v)}if(x){let C=xt[N],v=.5+(C-Be)*ce;if(v<0?v=0:v>1&&(v=1),be>.003){let I=1-Math.abs(Be-C)*6.25;I>0&&(v+=(jt-.5)*be*1.6*I,v<0?v=0:v>1&&(v=1))}v<zt&&(zt=v)}lt[N*4+3]=zt*255+.5|0}j.putImageData(e.pixDropImgData,0,0),nv(o,c,f),z.globalCompositeOperation="source-over",z.clearRect(0,0,_,b),z.imageSmoothingEnabled=!0,z.imageSmoothingQuality="high",y<1&&z.drawImage(Bi(e,"a",o,c,f),0,0,c,f,0,0,_,b),h&&y>0&&(z.globalAlpha=y,z.drawImage(Bi(e,"b",h.image,c,f),0,0,c,f,0,0,_,b),z.globalAlpha=1),z.globalCompositeOperation="destination-in",z.imageSmoothingEnabled=!1,z.drawImage(K,0,0),z.globalCompositeOperation="source-over",i.clearRect(0,0,c,f),P&&U>0?(i.imageSmoothingEnabled=!0,i.imageSmoothingQuality="high",i.globalAlpha=U,i.drawImage(Bi(e,"a",o,c,f),0,0),i.globalAlpha=1):x&&h&&A>0&&(i.imageSmoothingEnabled=!0,i.imageSmoothingQuality="high",i.globalAlpha=A,i.drawImage(Bi(e,"b",h.image,c,f),0,0),i.globalAlpha=1),i.imageSmoothingEnabled=!1,i.drawImage($,0,0,_,b,0,0,c,f),i.imageSmoothingEnabled=!0,x&&h&&E>=1&&A>=1&&(e.image=h.image,e.pendingReveal=null,e.boilHandoffStartMs=0,e.holdPaintedImg=null,e.phase="hold",a.style.opacity="0",(r=e.onRevealComplete)==null||r.call(e))}function BN(e){let t=e.canvas.getContext("2d");if(!t)throw new Error("img-fx: 2D context unavailable for reveal canvas");let n={active:!1,phase:"idle",revealStartMs:0,hideStartMs:0,hideDurationMs:300,boilStartMs:0,boilPattern:null,boilPatternW:0,boilPatternH:0,boilField:null,boilHandoffStartMs:0,pendingReveal:null,image:null,cssWidth:e.cssWidth,cssHeight:e.cssHeight,sampleCanvas:null,sampleCtx:null,sampleImgData:null,sampleDataCache:null,sampleFrameCounter:0,maskGrad:null,maskGradCtx:null,maskImgData:null,gsFlickerTable:null,pixCanvas:null,pixCtx:null,pixDrop:null,pixDropCtx:null,pixDropImgData:null,pixDropPattern:null,pixDropPatternW:0,pixDropPatternH:0,pixDropRevealStart:-1,coverA:null,coverB:null,holdPaintedImg:null,holdPaintedW:0,holdPaintedH:0,sampleGpuCanvas:null,sampleGpuCtx:null},i=e.shaderCanvas;function a(s){n.image=s.image,n.cssWidth=s.cssWidth,n.cssHeight=s.cssHeight,n.onRevealComplete=s.onRevealComplete,n.revealStartMs=performance.now(),n.phase="reveal",n.active=!0,n.boilHandoffStartMs=0,n.pendingReveal=null,n.sampleFrameCounter=0,n.sampleDataCache=null,n.holdPaintedImg=null,t.canvas.style.opacity="1"}return{canvas:e.canvas,ctx:t,afterShaderFrame(s,r,o){var l;if(n.cssWidth=r.cssWidth,n.cssHeight=r.cssHeight,!n.active){t.canvas.style.filter="none";return}let{duration:c,easingKey:f}=Ib(r.preset);if(n.phase==="reveal"&&n.image){let p=(o-n.revealStartMs)/1e3,u=Math.min(p/c,1),d=Pc(f,u);i.style.opacity=String(1-d),CN(n,s,r,t),u>=1&&(n.phase="hold",i.style.opacity="0",(l=n.onRevealComplete)==null||l.call(n))}else if(n.phase==="hold"&&n.image){t.canvas.style.filter="none";let p=n.image,u=r.canvas.width,d=r.canvas.height;(t.canvas.width!==u||t.canvas.height!==d)&&(t.canvas.width=u,t.canvas.height=d,n.holdPaintedImg=null),(n.holdPaintedImg!==p||n.holdPaintedW!==u||n.holdPaintedH!==d)&&(t.clearRect(0,0,u,d),t.globalCompositeOperation="source-over",t.globalAlpha=1,t.imageSmoothingEnabled=!0,t.imageSmoothingQuality="high",t.drawImage(Bi(n,"a",p,u,d),0,0),n.holdPaintedImg=p,n.holdPaintedW=u,n.holdPaintedH=d),i.style.opacity="0"}else if(n.phase==="boil"&&n.image)PN(n,s,r,t,i,o);else if(n.phase==="hide"){let p=o-n.hideStartMs,u=Math.min(p/Math.max(1,n.hideDurationMs),1),d=1-u;t.canvas.style.opacity=String(d),i.style.opacity=String(u),u>=1&&(n.active=!1,n.phase="idle",t.canvas.style.opacity="1",t.clearRect(0,0,t.canvas.width,t.canvas.height),i.style.opacity="1",n.image=null)}},startReveal(s){if(n.phase==="boil"&&n.active){n.pendingReveal=s,n.onRevealComplete=s.onRevealComplete,n.cssWidth=s.cssWidth,n.cssHeight=s.cssHeight,n.boilHandoffStartMs===0&&(n.boilHandoffStartMs=performance.now());return}a(s)},startHide(s=300){!n.active||n.phase==="hide"||(n.phase="hide",n.hideStartMs=performance.now(),n.hideDurationMs=s)},startBoil(){!n.active||!n.image||n.phase!=="hold"&&n.phase!=="reveal"||(n.phase="boil",n.boilStartMs=performance.now(),n.boilHandoffStartMs=0,n.pendingReveal=null,n.boilPattern=null,n.sampleFrameCounter=0,n.sampleDataCache=null,n.holdPaintedImg=null,t.canvas.style.opacity="1")},clear(){let s=n.active;n.active=!1,n.phase="idle",n.image=null,n.boilHandoffStartMs=0,n.pendingReveal=null,n.holdPaintedImg=null,t.clearRect(0,0,t.canvas.width,t.canvas.height),s&&(t.canvas.style.filter="none",t.canvas.style.opacity="1",i.style.opacity="1")},isActive(){return n.active},dispose(){n.image=null,n.sampleCanvas=null,n.sampleCtx=null,n.sampleImgData=null,n.sampleDataCache=null,n.sampleFrameCounter=0,n.maskGrad=null,n.maskGradCtx=null,n.maskImgData=null,n.gsFlickerTable=null,n.pixCanvas=null,n.pixCtx=null,n.pixDrop=null,n.pixDropCtx=null,n.pixDropImgData=null,n.pixDropPattern=null,n.boilPattern=null,n.boilField=null,n.pendingReveal=null,n.coverA=null,n.coverB=null,n.holdPaintedImg=null,n.sampleGpuCanvas=null,n.sampleGpuCtx=null}}}function Eb(e,t){if(e.length===0)return null;if(e.length===1)return{src:e[0],idx:0};let n;do n=Math.floor(Math.random()*e.length);while(n===t);return{src:e[n],idx:n}}function zN(e){let t=e.images.slice(),n=e.delayRange,i=e.holdMs,a=e.fadeOutMs,s=e.onPhase,r=e.excludeSrcs,o="idle",l=null,c=-1,f=!1,p=!1,u=null,d=!1,_="auto";function b(E){o=E,s?.({phase:E,src:u})}function m(){l!=null&&(clearTimeout(l),l=null)}function h(){if(typeof i=="number")return Math.max(0,i);let[E,x]=i,w=Math.max(0,Math.min(E,x)),R=Math.max(0,Math.max(E,x));return w+Math.random()*(R-w)}function g(E){if(!f||p)return;b("idle");let[x,w]=n,R=x+Math.random()*Math.max(0,w-x),D=E??R*1e3;m(),l=setTimeout(()=>{l=null,T(!0,"auto")},D)}function S(){p||(b("hide"),e.reveal.startHide(a),m(),l=setTimeout(()=>{l=null,!p&&(u=null,d?g():(f=!1,b("idle")))},a))}function y(){if(t.length===0)return null;let E=r?.(),x=E==null?null:E instanceof Set?E:new Set(E);if(!x||x.size===0)return Eb(t,c);let w=c>=0&&c<t.length?t[c]:null,R=[];for(let P=0;P<t.length;P++){let F=t[P];x.has(F)||F===w&&t.length>x.size+1||R.push(P)}if(R.length===0)return Eb(t,c);let D=R[Math.floor(Math.random()*R.length)];return{src:t[D],idx:D}}function T(E,x){if(!f||p)return;if(t.length===0){E?g(500):f=!1;return}let w=y();if(!w){E?g(500):f=!1;return}c=w.idx,u=w.src,d=E,_=x,AN(w.src).then(R=>{!f||p||(b("reveal"),e.reveal.startReveal({image:R,cssWidth:e.reveal.canvas.clientWidth||e.reveal.canvas.width,cssHeight:e.reveal.canvas.clientHeight||e.reveal.canvas.height,onRevealComplete:()=>{if(!f||p)return;if(b("visible"),x==="manual"){m();return}m();let D=h();l=setTimeout(()=>{l=null,!(!f||p)&&S()},D)}}))}).catch(()=>{u=null,E?g(500):f=!1})}function A(E){if(p||o==="reveal"||o==="visible"||o==="hide")return;let x=f;m(),x||(f=!0),T(x,E?.hold??"auto")}return{start(){if(f)return;f=!0,p=!1;let E=e.initialDelayMs??Math.random()*1500;g(E)},stop(){f=!1,m(),e.reveal.clear(),u=null,o="idle"},triggerOnce(E){A(E)},triggerHide(){p||o!=="reveal"&&o!=="visible"||S()},triggerBoil(E){if(p||o!=="reveal"&&o!=="visible")return;m(),e.reveal.startBoil(),u=null,f=!1,b("idle");let x=E?.autoRevealAfterMs;x!=null&&Number.isFinite(x)&&(l=setTimeout(()=>{l=null,A({hold:"manual"})},Math.max(0,x)))},getPhase(){return o},setPaused(E){if(p!==E){if(p=E,p)m();else if(f)if(o==="visible"){if(_==="manual")return;m(),l=setTimeout(()=>{l=null,S()},Math.min(h(),500))}else o==="hide"?(m(),l=setTimeout(()=>{l=null,u=null,g()},a)):g()}},setImages(E){t=E.slice(),c=-1},setExcludeSrcs(E){r=E??void 0},setOptions(E){E.delayRange&&(n=E.delayRange),E.holdMs!=null&&(i=E.holdMs),E.fadeOutMs!=null&&(a=E.fadeOutMs),E.onPhase&&(s=E.onPhase)},isRunning(){return f&&!p},dispose(){f=!1,m()}}}var Ab=(e,t,n)=>.299*e+.587*t+.114*n,wb=(e,t,n)=>`#${[e,t,n].map(i=>Math.round(i).toString(16).padStart(2,"0")).join("")}`,Ls=24,bd=null,jg=null;function FN(){return jg||(typeof document>"u"?null:(bd=document.createElement("canvas"),bd.width=Ls,bd.height=Ls,jg=bd.getContext("2d",{willReadFrequently:!0}),jg))}function HN(e,t){if(e.width===0||e.height===0)return null;let n=FN();if(!n)return null;n.imageSmoothingEnabled=!0,n.clearRect(0,0,Ls,Ls),n.drawImage(e,0,0,Ls,Ls);let i;try{i=n.getImageData(0,0,Ls,Ls).data}catch{return null}let a=[],s=0,r=0,o=0;for(let p=0;p<i.length;p+=4){if(i[p+3]<8)continue;let u=i[p],d=i[p+1],_=i[p+2];a.push({r:u,g:d,b:_,lum:Ab(u,d,_)}),s+=u,r+=d,o+=_}if(a.length===0)return null;a.sort((p,u)=>p.lum-u.lum);let l=wb(s/a.length,r/a.length,o/a.length),c=t.map((p,u)=>{let[d,_,b]=xr(p);return{slot:u,lum:Ab(d,_,b)}}).sort((p,u)=>p.lum-u.lum),f=new Array(c.length);for(let p=0;p<c.length;p++){let u=.05+.9*p/Math.max(1,c.length-1),d=a[Math.min(a.length-1,Math.round(u*(a.length-1)))];f[c[p].slot]=wb(d.r,d.g,d.b)}return{colors:f,cardBg:l}}var Cb="img-fx-styles",VN=`
.image-gen-root {
  position: relative;
  display: inline-block;
  isolation: isolate;
  overflow: hidden;
  vertical-align: top;
  line-height: 0;
  flex: 0 0 auto;
}

.image-gen-root > .image-gen-shader,
.image-gen-root > .image-gen-overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  border-radius: inherit;
  display: block;
}

.image-gen-root > .image-gen-shader {
  z-index: 1;
}

.image-gen-root > .image-gen-overlay {
  z-index: 2;
}

.image-gen-root > .image-gen-child {
  position: relative;
  z-index: 0;
  display: block;
  line-height: normal;
}
`,$g=!1;function zb(){if(typeof document>"u"||$g)return;if(document.getElementById(Cb)){$g=!0;return}let e=document.createElement("style");e.id=Cb,e.textContent=VN,document.head.appendChild(e),$g=!0}zb();function Rb(){if(typeof document>"u")return"dark";let e=document.documentElement,t=e.getAttribute("data-theme");if(t==="dark"||t==="light")return t;if(e.classList.contains("dark"))return"dark";if(e.classList.contains("light"))return"light";let n=e.style.colorScheme||getComputedStyle(e).colorScheme;return n==="dark"?"dark":n==="light"?"light":typeof window<"u"&&window.matchMedia?window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light":"dark"}function GN(e){let[t,n]=(0,Gt.useState)(()=>e!=="auto"?e:Rb());return(0,Gt.useEffect)(()=>{if(e!=="auto"){n(e);return}if(typeof window>"u")return;let i=()=>n(Rb());i();let a=window.matchMedia?window.matchMedia("(prefers-color-scheme: dark)"):null;a?.addEventListener("change",i);let s=null;return typeof document<"u"&&typeof MutationObserver<"u"&&(s=new MutationObserver(i),s.observe(document.documentElement,{attributes:!0,attributeFilter:["class","style","data-theme"]})),()=>{a?.removeEventListener("change",i),s?.disconnect()}},[e]),t}function kN(e){return e?typeof e=="string"?[e]:e.slice():[]}var tv=["pixels-mechanic","pixels-organic"];function XN(e){return tv.includes(e)}var iv=(0,Gt.forwardRef)(function({children:e,preset:t="pixels-organic",theme:n="auto",strength:i=1,pixelScale:a=1,cardBg:s,colors:r,images:o,autoReveal:l=!1,revealDelayRange:c=[2,4],revealInitialDelay:f,revealHoldMs:p=2e3,revealFadeOutMs:u=300,borderRadius:d,paused:_=!1,onCycle:b,excludeSrcs:m,className:h,style:g,...S},y){let T=(0,Gt.useRef)(null),A=(0,Gt.useRef)(null),E=(0,Gt.useRef)(null),x=(0,Gt.useRef)(null),w=(0,Gt.useRef)(null),R=(0,Gt.useRef)(null),D=(0,Gt.useRef)(null),P=(0,Gt.useRef)(b),F=(0,Gt.useRef)(m),[U,B]=(0,Gt.useState)(null),[X,Z]=(0,Gt.useState)(null);(0,Gt.useImperativeHandle)(y,()=>({get element(){return T.current},triggerReveal(at){var Ut;(Ut=D.current)==null||Ut.triggerOnce(at)},triggerHide(){var at;(at=D.current)==null||at.triggerHide()},triggerRegenerate(at){let Ut=D.current;if(!Ut||$t.current)return;let Ct=Ut.getPhase();if(Ct!=="reveal"&&Ct!=="visible")return;let Bt=vt.current,Wt=XN(Bt)?null:tv[Math.floor(Math.random()*tv.length)];if(at?.tintFromImage??!0){let ie=E.current;if(ie){let de=Wt?Zg[Wt].modes[yt.current].colors:j.current.colors,Be=HN(ie,de);Be&&B(Be)}}Wt&&Z(Wt);let Ot=at?.autoReveal??!0;Ut.triggerBoil(Ot?{autoRevealAfterMs:at?.durationMs??4e3}:void 0)},isImageActive(){var at;let Ut=((at=D.current)==null?void 0:at.getPhase())??"idle";return Ut==="reveal"||Ut==="visible"||Ut==="hide"}}),[]),(0,Gt.useLayoutEffect)(()=>{zb()},[]),(0,Gt.useEffect)(()=>{P.current=b},[b]),(0,Gt.useEffect)(()=>{F.current=m},[m]);let $=GN(n),z=(0,Gt.useMemo)(()=>Zg[t].modes[$],[t,$]),K=s??z.cardBg,j=(0,Gt.useRef)(z);j.current=z;let vt=(0,Gt.useRef)(t);vt.current=t;let yt=(0,Gt.useRef)($);yt.current=$;let $t=(0,Gt.useRef)(_);$t.current=_;let Et=(0,Gt.useMemo)(()=>kN(o),[o]),Pt=(0,Gt.useRef)(Et),k=(0,Gt.useRef)(c),Y=(0,Gt.useRef)(p),lt=(0,Gt.useRef)(u);Pt.current=Et,k.current=c,Y.current=p,lt.current=u;let xt=(0,Gt.useRef)((0,Gt.useMemo)(()=>{if(f==null)return;if(typeof f=="number")return Math.max(0,f)*1e3;let[at,Ut]=f,Ct=Math.max(0,Math.min(at,Ut)),Bt=Math.max(0,Math.max(at,Ut));return(Ct+Math.random()*(Bt-Ct))*1e3},[]));(0,Gt.useLayoutEffect)(()=>{var at;let Ut=T.current,Ct=A.current,Bt=E.current;if(!Ut||!Ct||!Bt)return;let Wt=()=>{var st;let it=Ut.getBoundingClientRect(),Q=Math.max(1,Math.round(it.width)),et=Math.max(1,Math.round(it.height)),ct=0;if(typeof d=="number")ct=d;else{let At=(st=x.current)==null?void 0:st.firstElementChild;if(At){let ut=parseFloat(getComputedStyle(At).borderTopLeftRadius);Number.isFinite(ut)&&ut>0&&(ct=ut)}if(ct===0){let ut=parseFloat(getComputedStyle(Ut).borderTopLeftRadius);Number.isFinite(ut)&&ut>0&&(ct=ut)}}return{w:Q,h:et,r:ct}},Ot=Wt(),ie=dN({canvas:Ct,cssWidth:Ot.w,cssHeight:Ot.h,preset:z,strength:i,cardBg:s??null,pixelScale:a});w.current=ie,ie.canvas.style.opacity=String(Math.max(0,Math.min(1,i)));let de=BN({canvas:Bt,cssWidth:Ot.w,cssHeight:Ot.h,shaderCanvas:Ct});ie.reveal=de,R.current=de;let Be=zN({reveal:de,images:Pt.current,delayRange:k.current,holdMs:Y.current,fadeOutMs:lt.current,initialDelayMs:xt.current,onPhase:st=>{var it;st.phase==="visible"&&(B(null),Z(null)),(it=P.current)==null||it.call(P,st)},excludeSrcs:()=>{var st;return((st=F.current)==null?void 0:st.call(F))??null}});D.current=Be,_&&Be.setPaused(!0),Ut.style.setProperty("--image-gen-radius",`${Ot.r}px`),Ut.style.borderRadius=`${Ot.r}px`;let ce=0,be=-1,N=-1,jt=-1,zt=()=>{ce=0;let st=w.current;if(!st)return;let it=Wt();(it.w!==be||it.h!==N)&&(mN(st,it.w,it.h),be=it.w,N=it.h),it.r!==jt&&(Ut.style.setProperty("--image-gen-radius",`${it.r}px`),Ut.style.borderRadius=`${it.r}px`,jt=it.r)},C=()=>{ce===0&&(ce=requestAnimationFrame(zt))},v=new ResizeObserver(C);v.observe(Ut);let I=(at=x.current)==null?void 0:at.firstElementChild;I&&v.observe(I);let H=null;I&&typeof MutationObserver<"u"&&(H=new MutationObserver(C),H.observe(I,{attributes:!0,attributeFilter:["class","style"]})),be=Ot.w,N=Ot.h,jt=Ot.r;let J=null;return typeof IntersectionObserver<"u"&&(J=new IntersectionObserver(st=>{let it=w.current;if(it)for(let Q of st)xN(it,Q.isIntersecting)},{rootMargin:"64px"}),J.observe(Ut)),()=>{var st;v.disconnect(),H?.disconnect(),J?.disconnect(),ce!==0&&cancelAnimationFrame(ce),(st=D.current)==null||st.dispose(),D.current=null,de.dispose(),R.current=null;let it=w.current;it&&pN(it),w.current=null}},[]),(0,Gt.useEffect)(()=>{let at=w.current;if(!at)return;let Ut=X?Zg[X].modes[$]:z;gN(at,Ut),Md(at)},[z,X,$]),(0,Gt.useEffect)(()=>{let at=w.current;at&&(vN(at,U?.cardBg??s??null),Md(at))},[s,U]),(0,Gt.useEffect)(()=>{let at=w.current;at&&(_N(at,U?.colors??r??null),Md(at))},[r,U]),(0,Gt.useEffect)(()=>{let at=w.current;at&&(SN(at,i),at.canvas&&(at.canvas.style.opacity=String(Math.max(0,Math.min(1,i)))))},[i]),(0,Gt.useEffect)(()=>{let at=w.current;at&&(MN(at,a),Md(at))},[a]),(0,Gt.useEffect)(()=>{var at;let Ut=w.current;Ut&&yN(Ut,_),(at=D.current)==null||at.setPaused(_)},[_]),(0,Gt.useEffect)(()=>{var at;(at=D.current)==null||at.setImages(Et)},[Et]),(0,Gt.useEffect)(()=>{var at;(at=D.current)==null||at.setOptions({delayRange:c,holdMs:p,fadeOutMs:u})},[c,p,u]),(0,Gt.useEffect)(()=>{let at=D.current;if(at){if(l)return at.start(),()=>at.stop();at.stop()}},[l]);let ot=(0,Gt.useMemo)(()=>({background:U?.cardBg??K,...g}),[K,U,g]);return(0,Zo.jsxs)("div",{...S,ref:T,className:["image-gen-root",h].filter(Boolean).join(" "),"data-preset":t,"data-theme":$,"data-paused":_?"true":void 0,style:ot,children:[(0,Zo.jsx)("canvas",{ref:A,className:"image-gen-shader","aria-hidden":"true"}),(0,Zo.jsx)("canvas",{ref:E,className:"image-gen-overlay","aria-hidden":"true"}),(0,Zo.jsx)("div",{ref:x,className:"image-gen-child",children:e})]})});iv.displayName="ImageGeneration";function JI(e,t={}){let n=(0,Fb.createRoot)(e),i=(0,Bc.createRef)(),a=[],s={w:e.clientWidth,h:e.clientHeight},r=()=>n.render(Bc.default.createElement(iv,{ref:i,preset:t.preset||"pixels-mechanic",theme:t.theme||"auto",pixelScale:t.pixelScale||1,cardBg:t.cardBg,colors:t.colors,strength:t.strength,images:a,className:"zfx-gen"},Bc.default.createElement("div",{style:{width:s.w,height:s.h,borderRadius:t.radius||0}}))),o=new ResizeObserver(()=>{s={w:e.clientWidth,h:e.clientHeight},r()});o.observe(e),r();let l=c=>new Promise(f=>setTimeout(f,c));return{async show(c){a=[c],r(),await l(80),i.current?.triggerReveal({hold:"manual"});for(let f=0;f<1200&&!i.current?.isImageActive();f++)await l(100);await l(1500)},boil(c,f,p=!0){a=[a[0],c].filter(Boolean),r();let u=l(120).then(()=>(i.current?.triggerRegenerate({durationMs:f,tintFromImage:p}),l(300)));return{started:u,done:u.then(()=>l(f+1700))}},destroy(){o.disconnect(),n.unmount()}}}export{JI as mount};
/*! Bundled license information:

react/cjs/react.production.js:
  (**
   * @license React
   * react.production.js
   *
   * Copyright (c) Meta Platforms, Inc. and affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)

scheduler/cjs/scheduler.production.js:
  (**
   * @license React
   * scheduler.production.js
   *
   * Copyright (c) Meta Platforms, Inc. and affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)

react-dom/cjs/react-dom.production.js:
  (**
   * @license React
   * react-dom.production.js
   *
   * Copyright (c) Meta Platforms, Inc. and affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)

react-dom/cjs/react-dom-client.production.js:
  (**
   * @license React
   * react-dom-client.production.js
   *
   * Copyright (c) Meta Platforms, Inc. and affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)

react/cjs/react-jsx-runtime.production.js:
  (**
   * @license React
   * react-jsx-runtime.production.js
   *
   * Copyright (c) Meta Platforms, Inc. and affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)

three/build/three.core.js:
three/build/three.module.js:
  (**
   * @license
   * Copyright 2010-2026 Three.js Authors
   * SPDX-License-Identifier: MIT
   *)
*/
