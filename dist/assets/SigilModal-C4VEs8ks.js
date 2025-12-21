import{J as e,Tn as t,_t as n,jn as r,tn as i,w as a,wn as o}from"./index-DgHpI1TP.js";import{t as s}from"./html2canvas-BMRZjpzo.js";import{t as c}from"./SealMomentModal-BnnGYXQT.js";var l=r(t(),1),u=r(i(),1),d=e=>Math.max(0,Math.min(100,e));function f(e,t){let n=(e??``).toLowerCase().trim();return/(reflekt|reflect|reflektion|reflection)/i.test(n)?`#22c55e`:/(purify|purification|purifikation)/i.test(n)?`#3b82f6`:/dream/i.test(n)?`#7c3aed`:/(ignite|ignition)/i.test(n)?`#ff3b30`:/(integrate|integration)/i.test(n)?`#ff8a00`:/(solar\s*plexus)/i.test(n)?`#ffd600`:t}var p=({dateISO:e,onDateChange:t,secondsLeft:n,eternalPercent:r,eternalColor:i=`#8beaff`,eternalArkLabel:a=`Eternal Ark`})=>{let o=(0,l.useMemo)(()=>d(r),[r]),s=(0,l.useMemo)(()=>f(a,i),[a,i]),c={"--eternal-bar":s,"--pulse":`var(--kai-pulse, var(--pulse-dur, 5236ms))`},p=(0,l.useMemo)(()=>({"--fill":(o/100).toFixed(6)}),[o]),m=(0,l.useRef)(null),h=(0,l.useRef)(void 0),g=(0,l.useRef)(null),_=(0,l.useRef)(null);return(0,l.useEffect)(()=>()=>{g.current!==null&&window.clearTimeout(g.current),_.current!==null&&window.cancelAnimationFrame(_.current),m.current&&m.current.classList.remove(`is-boom`),g.current=null,_.current=null},[]),(0,l.useEffect)(()=>{let e=typeof window<`u`&&typeof window.matchMedia==`function`&&window.matchMedia(`(prefers-reduced-motion: reduce)`).matches;if(typeof n!=`number`||e){h.current=n;return}let t=m.current,r=h.current;t&&typeof r==`number`&&n-r>1.2&&(t.classList.remove(`is-boom`),_.current!==null&&window.cancelAnimationFrame(_.current),_.current=window.requestAnimationFrame(()=>{t.classList.add(`is-boom`)}),g.current!==null&&window.clearTimeout(g.current),g.current=window.setTimeout(()=>{t.classList.remove(`is-boom`),g.current=null},420)),h.current=n},[n]),(0,u.jsxs)(`div`,{className:`sigil-scope`,style:c,children:[(0,u.jsx)(`h3`,{className:`sigil-title`,children:`Kairos Sigil-Glyph Inhaler`}),(0,u.jsx)(`div`,{className:`sigil-ribbon`,"aria-hidden":`true`}),(0,u.jsx)(`div`,{className:`input-row sigil-row`,children:(0,u.jsxs)(`label`,{className:`sigil-label`,children:[(0,u.jsx)(`span`,{className:`sigil-label__text`,children:`Select moment:`}),`\xA0`,(0,u.jsx)(`input`,{className:`sigil-input`,type:`datetime-local`,value:e,onChange:t})]})}),(0,u.jsx)(`div`,{className:`sigil-bars`,role:`group`,"aria-label":`Day progress`,children:(0,u.jsxs)(`div`,{className:`sigil-bar`,children:[(0,u.jsxs)(`div`,{className:`sigil-bar__head`,children:[(0,u.jsxs)(`span`,{className:`sigil-bar__label`,children:[`Unfoldment`,a?` — ${a}`:``]}),(0,u.jsxs)(`span`,{className:`sigil-bar__pct`,"aria-hidden":`true`,children:[o.toFixed(2),`%`]})]}),(0,u.jsx)(`div`,{className:`sigil-bar__track`,"aria-valuemin":0,"aria-valuemax":100,"aria-valuenow":+o.toFixed(2),role:`progressbar`,"aria-label":`Eternal day ${a||``}`,children:(0,u.jsx)(`div`,{ref:m,className:`sigil-bar__fill sigil-bar__fill--eternal`,style:p})})]})}),(0,u.jsx)(`style`,{children:`
        .sigil-ribbon {
          height: 1px;
          margin: .35rem 0 .85rem 0;
          background: linear-gradient(90deg, rgba(255,255,255,.00), rgba(255,255,255,.22), rgba(255,255,255,.00));
          background-size: 200% 100%;
          animation: sigilRibbonBreath var(--pulse) ease-in-out infinite;
          animation-delay: var(--pulse-offset, 0ms);
          filter: drop-shadow(0 0 8px rgba(139,234,255,.12));
        }

        .sigil-bars { display: grid; gap: .6rem; margin-top: .65rem; }

        .sigil-bar__head {
          display: flex; align-items: baseline; justify-content: space-between;
          margin-bottom: .28rem;
        }
        .sigil-bar__label { font-size: .86rem; letter-spacing: .01em; color: rgba(255,255,255,.88); }
        .sigil-bar__pct   { font-size: .82rem; color: rgba(255,255,255,.66); font-variant-numeric: tabular-nums; }

        .sigil-bar__track {
          position: relative; height: 12px; border-radius: 999px;
          background: linear-gradient(180deg, rgba(255,255,255,.10), rgba(255,255,255,.04));
          border: 1px solid rgba(139,234,255,.22);
          box-shadow: inset 0 0 0 1px rgba(255,255,255,.03), 0 6px 16px -8px rgba(0,0,0,.45);
          overflow: hidden;
        }

        .sigil-bar__fill {
          position: absolute; inset: 0 auto 0 0; width: 100%;
          transform-origin: left center;
          transform: scaleX(var(--fill, 0));
          transition: transform .45s cubic-bezier(.22,.61,.36,1);
          will-change: transform, filter;
        }

        .sigil-bar__fill--eternal {
          background:
            radial-gradient(120% 100% at 0% 50%, rgba(255,255,255,.18), transparent 60%) padding-box,
            linear-gradient(90deg,
              color-mix(in oklab, var(--eternal-bar, #8beaff) 92%, white 0%),
              var(--eternal-bar, #8beaff)) border-box;
          filter: drop-shadow(0 0 14px color-mix(in oklab, var(--eternal-bar, #8beaff) 55%, transparent 45%))
                  drop-shadow(0 0 22px color-mix(in oklab, var(--eternal-bar, #8beaff) 35%, transparent 65%));
          animation: barGlow var(--pulse) ease-in-out infinite;
          animation-delay: var(--pulse-offset, 0ms);
        }

        .sigil-bar__fill--eternal::after {
          content: "";
          position: absolute;
          right: -6px;
          top: 50%;
          translate: 0 -50%;
          width: 12px; height: 12px;
          border-radius: 50%;
          background:
            radial-gradient(closest-side, var(--eternal-bar, #8beaff), rgba(255,255,255,.85), transparent 75%);
          filter:
            drop-shadow(0 0 10px color-mix(in oklab, var(--eternal-bar, #8beaff) 85%, transparent 15%))
            drop-shadow(0 0 16px color-mix(in oklab, var(--eternal-bar, #8beaff) 60%, transparent 40%));
          opacity: .95;
          pointer-events: none;
        }

        .sigil-bar__fill--eternal.is-boom {
          animation: barGlow var(--pulse) ease-in-out infinite, explodeFlash 420ms cubic-bezier(.18,.6,.2,1) 1;
          animation-delay: var(--pulse-offset, 0ms), 0ms;
          filter:
            drop-shadow(0 0 22px color-mix(in oklab, var(--eternal-bar, #8beaff) 85%, transparent 15%))
            drop-shadow(0 0 36px color-mix(in oklab, var(--eternal-bar, #8beaff) 65%, transparent 35%));
        }

        .sigil-bar__fill--eternal.is-boom::before {
          content: "";
          position: absolute;
          right: -8px;
          top: 50%;
          translate: 0 -50%;
          width: 10px; height: 10px;
          border-radius: 999px;
          background: radial-gradient(closest-side, white, var(--eternal-bar, #8beaff) 60%, transparent 70%);
          opacity: .95;
          pointer-events: none;
          animation: sparkBurst 420ms cubic-bezier(.18,.6,.2,1) 1;
        }

        @keyframes barGlow {
          0%   { filter: drop-shadow(0 0 10px color-mix(in oklab, var(--eternal-bar, #8beaff) 45%, transparent))
                          drop-shadow(0 0 18px color-mix(in oklab, var(--eternal-bar, #8beaff) 25%, transparent)); }
          50%  { filter: drop-shadow(0 0 18px color-mix(in oklab, var(--eternal-bar, #8beaff) 70%, transparent))
                          drop-shadow(0 0 28px color-mix(in oklab, var(--eternal-bar, #8beaff) 40%, transparent)); }
          100% { filter: drop-shadow(0 0 10px color-mix(in oklab, var(--eternal-bar, #8beaff) 45%, transparent))
                          drop-shadow(0 0 18px color-mix(in oklab, var(--eternal-bar, #8beaff) 25%, transparent)); }
        }

        @keyframes explodeFlash {
          0%   { box-shadow: inset 0 0 0 0 rgba(255,255,255,0); transform: scaleX(var(--fill)) scaleY(1); }
          14%  { box-shadow: inset 0 0 0 2px rgba(255,255,255,.25); transform: scaleX(var(--fill)) scaleY(1.18); }
          28%  { box-shadow: inset 0 0 0 0 rgba(255,255,255,0); transform: scaleX(var(--fill)) scaleY(1.06); }
          100% { box-shadow: inset 0 0 0 0 rgba(255,255,255,0); transform: scaleX(var(--fill)) scaleY(1); }
        }

        @keyframes sparkBurst {
          0%   { opacity: .98; transform: scale(1);   filter: blur(0);   }
          40%  { opacity: .85; transform: scale(2.6); filter: blur(.5px);}
          100% { opacity: 0;   transform: scale(4.2); filter: blur(1px); }
        }

        @keyframes sigilRibbonBreath {
          0% { background-position: 0% 0%; opacity: .8; }
          50% { background-position: 100% 0%; opacity: 1; }
          100% { background-position: 0% 0%; opacity: .8; }
        }

        @media (prefers-reduced-motion: reduce) {
          .sigil-bar__fill--eternal,
          .sigil-ribbon { animation: none !important; }
          .sigil-bar__fill--eternal.is-boom,
          .sigil-bar__fill--eternal.is-boom::before { animation: none !important; }
          .sigil-bar__fill { transition: none !important; }
        }
      `})]})},m=r(o(),1),h=r(s(),1),g=r(n(),1),_=Date.UTC(2024,4,10,6,45,41,888),v=3+Math.sqrt(5),y=v*1e3,b=17491.270421,x=44,S=36,C=6,w=42,T=8,E=w*T,D=(1+Math.sqrt(5))/2,O=[`Solhara`,`Aquaris`,`Flamora`,`Verdari`,`Sonari`,`Kaelith`],k={Solhara:`Root`,Aquaris:`Sacral`,Flamora:`Solar Plexus`,Verdari:`Heart`,Sonari:`Throat`,Kaelith:`Crown`},A=[`Aethon`,`Virelai`,`Solari`,`Amarin`,`Kaelus`,`Umbriel`,`Noktura`,`Liora`],j=[`Ignite`,`Integrate`,`Harmonize`,`Reflekt`,`Purifikation`,`Dream`],ee=e=>`${e} Ark`,M=[`Tor Lah Mek Ka`,`Shoh Vel Lah Tzur`,`Rah Veh Yah Dah`,`Nel Shaum Eh Lior`,`Ah Ki Tzah Reh`,`Or Vem Shai Tuun`,`Ehlum Torai Zhak`,`Zho Veh Lah Kurei`,`Tuul Ka Yesh Aum`,`Sha Vehl Dorrah`],N=Array.from({length:11},(e,t)=>{let n=(t*v).toFixed(3);return`Breath ${t+1} — ${n}s`}),P=1000000n,F=17491270421n,I=11000000n,L=(F+18n)/36n,R=Number((L+P/2n)/P),te=e=>String(e).padStart(2,`0`),ne=e=>e.trim().replace(/^(\d+):(\d+)/,(e,t,n)=>`${+t}:${String(n).padStart(2,`0`)}`).replace(/D\s*(\d+)/,(e,t)=>`D${+t}`),z=(e,t)=>(e%t+t)%t;function B(e,t){let n=e/t,r=e%t;return r!==0n&&r>0n!=t>0n?n-1n:n}function re(e){if(!Number.isFinite(e))return 0n;let t=e<0?-1:1,n=Math.abs(e),r=Math.trunc(n),i=n-r;return i<.5?BigInt(t*r):i>.5?BigInt(t*(r+1)):BigInt(t*(r%2==0?r:r+1))}function ie(e){return re((e.getTime()-_)/1e3/v*1e6)}var V=`http://www.w3.org/2000/svg`;function H(e){e.getAttribute(`xmlns`)||e.setAttribute(`xmlns`,V),e.getAttribute(`xmlns:xlink`)||e.setAttribute(`xmlns:xlink`,`http://www.w3.org/1999/xlink`)}function U(e){let t=e.ownerDocument||document,n=e.querySelector(`metadata`);if(n)return n;let r=t.createElementNS(V,`metadata`);return e.insertBefore(r,e.firstChild),r}function ae(e){let t=e.ownerDocument||document,n=e.querySelector(`desc`);if(n)return n;let r=t.createElementNS(V,`desc`),i=e.querySelector(`metadata`);return i&&i.nextSibling?e.insertBefore(r,i.nextSibling):e.insertBefore(r,e.firstChild),r}function oe(e,t){H(e);let n=U(e);n.textContent=JSON.stringify(t);let r=ae(e);r.textContent=typeof t==`object`&&t?(()=>{let e=t,n=typeof e.pulse==`number`?e.pulse:void 0,r=typeof e.beat==`number`?e.beat:void 0,i=typeof e.stepIndex==`number`?e.stepIndex:void 0,a=typeof e.chakraDay==`string`?e.chakraDay:void 0;return`KaiSigil — pulse:${n??`?`} beat:${r??`?`} step:${i??`?`} chakra:${a??`?`}`})():`KaiSigil — exported`;let i=new XMLSerializer().serializeToString(e);return i.startsWith(`<?xml`)?i:`<?xml version="1.0" encoding="UTF-8"?>\n${i}`}var se=()=>(0,u.jsxs)(`svg`,{viewBox:`0 0 24 24`,"aria-hidden":!0,className:`close-icon`,children:[(0,u.jsx)(`line`,{x1:`4`,y1:`4`,x2:`20`,y2:`20`,stroke:`currentColor`,strokeWidth:`2`}),(0,u.jsx)(`line`,{x1:`20`,y1:`4`,x2:`4`,y2:`20`,stroke:`currentColor`,strokeWidth:`2`}),(0,u.jsx)(`circle`,{cx:`12`,cy:`12`,r:`10`,fill:`none`,stroke:`currentColor`,strokeWidth:`1.2`,opacity:`.25`})]}),ce=()=>(0,u.jsxs)(`svg`,{viewBox:`0 0 24 24`,"aria-hidden":`true`,children:[(0,u.jsx)(`circle`,{cx:`12`,cy:`12`,r:`9.5`,fill:`none`,stroke:`currentColor`,strokeWidth:`1.4`}),(0,u.jsx)(`path`,{d:`M12 6v6l3.5 3.5`,fill:`none`,stroke:`currentColor`,strokeWidth:`1.8`,strokeLinecap:`round`,strokeLinejoin:`round`}),(0,u.jsx)(`path`,{d:`M8.2 15.8l2.1-2.1`,fill:`none`,stroke:`currentColor`,strokeWidth:`1.6`,strokeLinecap:`round`})]});function W(e){let t=ie(e),n=z(t,F),r=B(t,F),i=Number(B(n,L)),a=n-BigInt(i)*L,o=Number(a/I),s=Math.min(Math.max(o,0),x-1),c=a-BigInt(s)*I,l=Number(c)/Number(I),u=Number(B(t,P)),d=Number(a/P),f=Number(n/P),p=O[Number(z(r,BigInt(C)))],m=k[p],h=Number(r),g=(h%w+w)%w+1,_=(Math.floor(h/w)%T+T)%T,v=_+1,y=A[_],b=Math.floor(h/E),S=b<1?`Year of Harmonik Restoration`:b===1?`Year of Harmonik Embodiment`:`Year ${b}`,D=Number(n*6n/F),M=ee(j[Math.min(5,Math.max(0,D))]),N=Math.floor((g-1)/C),R=[`Awakening Flame`,`Flowing Heart`,`Radiant Will`,`Harmonic Voh`,`Inner Mirror`,`Dreamfire Memory`,`Krowned Light`][N];return{pulse:u,beat:i,step:s,stepPct:l,pulsesIntoBeat:d,pulsesIntoDay:f,harmonicDay:p,chakraDay:m,chakraStepString:`${i}:${te(s)}`,dayOfMonth:g,monthIndex0:_,monthIndex1:v,monthName:y,yearIndex:b,yearName:S,arcIndex:D,arcName:M,weekIndex:N,weekName:R,_pμ_in_day:n,_pμ_in_beat:a}}function le(e){let t=W(e),n=`${t.chakraStepString} — D${t.dayOfMonth}/M${t.monthIndex1}`,r={beatIndex:t.beat,pulsesIntoBeat:t.pulsesIntoBeat,beatPulseCount:R,totalBeats:S},i=Number(t._pμ_in_beat)/Number(L)*100,a=(1-Number(t._pμ_in_beat)/Number(L))*100,o=(t.dayOfMonth-1)%C,s=BigInt(o)*F+t._pμ_in_day,c={weekDay:t.harmonicDay,weekDayIndex:O.indexOf(t.harmonicDay),pulsesIntoWeek:Number(s/P),percent:Number(s)/Number(F*BigInt(C))*100},l=t.dayOfMonth-1,u={daysElapsed:l,daysRemaining:w-t.dayOfMonth,percent:l/w*100},d=t.monthIndex0*w+t.dayOfMonth,f={daysElapsed:d-1,daysRemaining:E-d,percent:(d-1)/E*100},p={stepIndex:t.step,percentIntoStep:t.stepPct*100,stepsPerBeat:x},m=`Beat ${t.beat+1}/${S} • Step ${t.step+1}/${x} • ${t.harmonicDay}, ${t.arcName} • D${t.dayOfMonth}/M${t.monthIndex1} (${t.monthName}) • ${t.yearName}`,h=`Kai:${t.chakraStepString} D${t.dayOfMonth}/M${t.monthIndex1} ${t.harmonicDay} ${t.monthName} y${t.yearIndex}`,g=Math.floor(Math.log(Math.max(t.pulse,1))/Math.log(D)),_=e=>e.replace(/\s*Ark$/i,``),v=`Eternal Seal: Kairos:${t.chakraStepString}, ${t.harmonicDay}, ${(e=>`${_(e)} Ark`)(t.arcName)} • D${t.dayOfMonth}/M${t.monthIndex1} • Beat:${t.beat}/${S}(${i.toFixed(6)}%) Step:${t.step}/${x} Kai(Today):${t.pulsesIntoDay} • Y${t.yearIndex} PS${g} • Eternal Pulse:${t.pulse}`;return{kaiPulseEternal:t.pulse,kaiPulseToday:t.pulsesIntoDay,eternalKaiPulseToday:t.pulsesIntoDay,eternalSeal:v,kairos_seal_day_month:n,eternalMonth:t.monthName,eternalMonthIndex:t.monthIndex1,eternalChakraArc:t.arcName,eternalYearName:t.yearName,kaiTurahPhrase:M[t.yearIndex%M.length],chakraStepString:t.chakraStepString,chakraStep:p,harmonicDay:t.harmonicDay,chakraBeat:r,eternalChakraBeat:{...r,percentToNext:a},harmonicWeekProgress:c,harmonicYearProgress:f,eternalMonthProgress:u,weekIndex:t.weekIndex,weekName:t.weekName,dayOfMonth:t.dayOfMonth,kaiMomentSummary:m,compressed_summary:h,phiSpiralLevel:g}}var G=()=>typeof performance<`u`&&typeof performance.now==`function`?performance.timeOrigin+performance.now():Date.now(),K=e=>{let t=e-_;return _+Math.ceil(t/y)*y};function ue(e){let t=e.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/);if(!t)return null;let n=Number(t[1]),r=Number(t[2])-1,i=Number(t[3]),a=Number(t[4]),o=Number(t[5]),s=Number(t[6]??`0`),c=String(t[7]??`0`).padEnd(3,`0`),l=Number(c),u=new Date(n,r,i,a,o,s,l);return Number.isNaN(u.getTime())?null:u}function de(e,t){let n=Number.isFinite(t)?Math.max(1,Math.min(11,t)):1;return new Date(e.getTime()+(n-1)*y)}function fe(e){let[t,n]=(0,l.useState)(v),r=(0,l.useRef)(0),i=(0,l.useRef)(null),a=(0,l.useRef)(null);return(0,l.useEffect)(()=>{if(i.current!==null&&(cancelAnimationFrame(i.current),i.current=null),a.current!==null&&(window.clearInterval(a.current),a.current=null),!e)return;typeof document<`u`&&document.documentElement&&document.documentElement.style.setProperty(`--kai-pulse`,`${y}ms`),r.current=K(G());let t=()=>{let e=G();if(e>=r.current){let t=Math.floor((e-r.current)/y)+1;r.current+=t*y}n(Math.max(0,r.current-e)/1e3),i.current=requestAnimationFrame(t)};i.current=requestAnimationFrame(t);let o=()=>{document.visibilityState===`hidden`?(i.current!==null&&(cancelAnimationFrame(i.current),i.current=null),a.current===null&&(a.current=window.setInterval(()=>{let e=G();if(e>=r.current){let t=Math.floor((e-r.current)/y)+1;r.current+=t*y}n(Math.max(0,(r.current-e)/1e3))},33))):(a.current!==null&&(window.clearInterval(a.current),a.current=null),i.current!==null&&(cancelAnimationFrame(i.current),i.current=null),r.current=K(G()),i.current=requestAnimationFrame(t))};return document.addEventListener(`visibilitychange`,o),()=>{document.removeEventListener(`visibilitychange`,o),i.current!==null&&cancelAnimationFrame(i.current),a.current!==null&&window.clearInterval(a.current),i.current=null,a.current=null}},[e]),e?t:null}var q=()=>{try{return globalThis.crypto?.subtle}catch{return}},pe=async e=>{let t=new TextEncoder().encode(e),n=q();if(n)try{let e=await n.digest(`SHA-256`,t);return Array.from(new Uint8Array(e)).map(e=>e.toString(16).padStart(2,`0`)).join(``)}catch{}let r=2166136261;for(let e=0;e<t.length;e++)r^=t[e],r=Math.imul(r,16777619);return(r>>>0).toString(16).padStart(8,`0`)},J={"Ignite Ark":`#ff0024`,"Ignition Ark":`#ff0024`,"Integrate Ark":`#ff6f00`,"Integration Ark":`#ff6f00`,"Harmonize Ark":`#ffd600`,"Harmonization Ark":`#ffd600`,"Reflekt Ark":`#00c853`,"Reflection Ark":`#00c853`,"Purifikation Ark":`#00b0ff`,"Purification Ark":`#00b0ff`,"Dream Ark":`#c186ff`},me=e=>{if(!e)return`#ffd600`;let t=e.trim(),n=t.replace(/\s*ark$/i,` Ark`);return J[t]??J[n]??`#ffd600`},he=()=>(0,u.jsx)(`style`,{children:`
    .sigil-modal { position: relative; isolation: isolate; }

    .sigil-modal .close-btn {
      z-index: 99999 !important;
      pointer-events: auto;
      touch-action: manipulation;
    }
    .sigil-modal .close-btn svg { pointer-events: none; }

    .modal-bottom-spacer { height: clamp(96px, 14vh, 140px); }

.mint-dock{
  position: sticky;
  bottom: max(10px, env(safe-area-inset-bottom));
  z-index: 6;

  /* 🔒 NOT a bar */
  display: grid;          /* centers child without creating a row bar */
  place-items: center;
  width: fit-content;     /* shrink-wrap to the button */
  max-width: 100%;
  margin: 0 auto;         /* center the shrink-wrapped dock */
  padding: 0;             /* remove bar padding */
  background: transparent;/* no bar surface */
  border: 0;
  box-shadow: none;

  contain: layout paint style;
  -webkit-transform: translateZ(0);
          transform: translateZ(0);
}

/* hard stop: prevent child from stretching wide */
.mint-dock > *{
  width: auto;
  max-width: 100%;
  flex: 0 0 auto;
}

/* if your button is an <a> or <button> and inherits block styles elsewhere */
.mint-dock button,
.mint-dock a{
  display: inline-flex;
}


    .mint-btn {
      width: min(520px, calc(100% - 2px));
      display: grid;
      grid-template-columns: 54px 1fr;
      gap: 12px;
      align-items: center;

      border: 0;
      cursor: pointer;
      color: inherit;
      padding: 12px 14px;
      border-radius: 18px;

      background:
        radial-gradient(900px 220px at 30% 0%, rgba(255,230,150,.18), rgba(0,0,0,0) 60%),
        radial-gradient(900px 280px at 80% 10%, rgba(120,220,255,.16), rgba(0,0,0,0) 55%),
        linear-gradient(180deg, rgba(255,255,255,.14), rgba(255,255,255,.06));
      backdrop-filter: blur(10px) saturate(140%);
      -webkit-backdrop-filter: blur(10px) saturate(140%);

      box-shadow:
        0 10px 34px rgba(0,0,0,.45),
        inset 0 0 0 1px rgba(255,255,255,.22),
        0 0 44px rgba(255, 215, 120, .12);

      transition: transform .18s ease, box-shadow .18s ease, filter .18s ease, opacity .18s ease;
      will-change: transform;
      touch-action: manipulation;
    }

    .mint-btn::before {
      content: "";
      position: absolute;
      inset: -1px;
      border-radius: 19px;
      background:
        linear-gradient(90deg,
          rgba(255,215,140,.0),
          rgba(255,215,140,.55),
          rgba(120,220,255,.35),
          rgba(155, 91, 255, .35),
          rgba(255,215,140,.0)
        );
      filter: blur(10px);
      opacity: .55;
      pointer-events: none;
    }

    .mint-btn:hover { transform: translateY(-2px); box-shadow: 0 14px 44px rgba(0,0,0,.55), inset 0 0 0 1px rgba(255,255,255,.28), 0 0 60px rgba(255, 215, 120, .16); }
    .mint-btn:active { transform: translateY(0px) scale(.99); }

    .mint-btn__icon {
      width: 54px;
      height: 54px;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;

      background:
        radial-gradient(120% 120% at 50% 0%, rgba(255,255,255,.16), rgba(255,255,255,.06)),
        linear-gradient(180deg, rgba(12, 20, 48, .62), rgba(3, 6, 16, .72));
      box-shadow:
        inset 0 0 0 1px rgba(255,255,255,.22),
        0 10px 26px rgba(0,0,0,.35);
    }

    .mint-btn__icon img,
    .mint-btn__icon svg {
      width: 56%;
      height: 56%;
      display: block;
      user-select: none;
      -webkit-user-drag: none;
    }

    .mint-btn__text { text-align: left; line-height: 1.1; }
    .mint-btn__title {
      font-weight: 800;
      letter-spacing: .06em;
      text-transform: uppercase;
      font-size: 13px;
      opacity: .98;
    }
    .mint-btn__sub {
      margin-top: 4px;
      font-size: 12px;
      opacity: .78;
    }

    @media (pointer: coarse) {
      .mint-btn { padding: 14px 14px; }
      .mint-btn__icon { width: 58px; height: 58px; }
    }

    @media (prefers-reduced-motion: reduce) {
      .mint-btn { transition: none; }
      .mint-btn:hover { transform: none; }
    }
  `});function ge(e){let t=typeof e==`number`&&e>0?new Date(_+e*y):new Date(_),n=W(t);return{pulse:n.pulse,beat:n.beat,stepPct:n.stepPct,stepIdx:n.step,chakraDay:n.chakraDay,kairos:le(t)}}async function _e(e){try{if(navigator.clipboard?.writeText)return await navigator.clipboard.writeText(e),!0}catch{}try{let t=document.createElement(`textarea`);t.value=e,t.setAttribute(`readonly`,`true`),t.style.position=`fixed`,t.style.left=`-9999px`,t.style.top=`0`,document.body.appendChild(t),t.select();let n=document.execCommand(`copy`);return document.body.removeChild(t),n}catch{return!1}}var ve=e=>{e.catch(()=>{})},Y=({initialPulse:t=0,onClose:n})=>{let[r]=(0,l.useState)(()=>ge(t)),[i,o]=(0,l.useState)(r.pulse),[s,d]=(0,l.useState)(r.beat),[f,v]=(0,l.useState)(r.stepPct),[S,C]=(0,l.useState)(r.stepIdx),[w,T]=(0,l.useState)(r.chakraDay),[E,D]=(0,l.useState)(r.kairos),[O,k]=(0,l.useState)(``),[A,j]=(0,l.useState)(1),[ee,M]=(0,l.useState)(!0),[P,F]=(0,l.useState)(!1),[I,L]=(0,l.useState)(``),[R,z]=(0,l.useState)(``),[B,re]=(0,l.useState)(``),[ie,V]=(0,l.useState)(!1),H=(0,l.useRef)(null),U=(0,l.useRef)(null),ae=(0,l.useRef)(null),q=(0,l.useRef)(null),J=(0,l.useRef)(0);(0,l.useEffect)(()=>{let e=e=>{let t=H.current;if(!t)return;let n=e.target;n instanceof Node&&t.contains(n)&&(U.current?.contains(n)||e.stopPropagation())},t=[`click`,`mousedown`,`touchstart`],n={passive:!0};t.forEach(t=>document.addEventListener(t,e,n));let r=e=>{e.key===`Escape`&&H.current&&e.stopPropagation()};return window.addEventListener(`keydown`,r,!0),()=>{t.forEach(t=>document.removeEventListener(t,e,n)),window.removeEventListener(`keydown`,r,!0)}},[]);let Y=(0,l.useCallback)(e=>{let t=U.current;if(!t)return;let n=y-((e-_)%y+y)%y;t.style.setProperty(`--pulse-dur`,`${y}ms`),t.style.setProperty(`--pulse-offset`,`-${Math.round(n)}ms`)},[]),ye=(0,l.useCallback)(e=>{if(typeof document>`u`)return;let t=document.documentElement,n=y-((e-_)%y+y)%y;t.style.setProperty(`--pulse-dur`,`${y}ms`),t.style.setProperty(`--pulse-offset`,`-${Math.round(n)}ms`)},[]),X=(0,l.useCallback)((e,t)=>{let n=W(e);o(n.pulse),d(n.beat),v(n.stepPct),C(n.step),T(n.chakraDay),D(le(e));let r=typeof t==`number`?t:e.getTime();ye(r),Y(r)},[Y,ye]),Z=(0,l.useCallback)(()=>{q.current!==null&&(window.clearTimeout(q.current),q.current=null)},[]),Q=(0,l.useCallback)(()=>{Z(),J.current=K(G());let e=()=>{let t=G(),n=J.current;if(t<n){q.current=window.setTimeout(e,Math.max(0,n-t));return}let r=Math.floor((t-n)/y)+1,i=n+(r-1)*y;X(new Date(i),i),J.current=n+r*y;let a=Math.max(0,J.current-t);q.current=window.setTimeout(e,a)};q.current=window.setTimeout(()=>{let t=G();X(new Date(t),t);let n=Math.max(0,J.current-t);q.current=window.setTimeout(e,n)},0)},[X,Z]);(0,l.useEffect)(()=>{if(O)return;Q();let e=()=>{document.visibilityState===`visible`&&!O&&Q()};return document.addEventListener(`visibilitychange`,e),window.addEventListener(`focus`,e),()=>{document.removeEventListener(`visibilitychange`,e),window.removeEventListener(`focus`,e),Z()}},[O,Q,Z]);let be=(0,l.useCallback)((e,t)=>{let n=ue(e);if(!n)return;let r=de(n,t);X(r,r.getTime())},[X]),xe=e=>{let t=e.target.value;if(k(t),!t){j(1);return}Z(),be(t,A)},Se=e=>{let t=Number(e.target.value);j(t),O&&be(O,t)},Ce=()=>{let e=H.current?.querySelector(`.sigil-modal`);e&&(e.classList.remove(`flash-now`),e.offsetWidth,e.classList.add(`flash-now`)),k(``),j(1);let t=G();X(new Date(t),t)},we=fe(!O),$=e=>ve(_e(e)),Te=e=>$(JSON.stringify(e,null,2)),Ee=()=>document.querySelector(`#sigil-export svg`),De=e=>{let t=Ee();return t?oe(t,e):null},Oe=e=>{let t=De(e);return t?new Blob([t],{type:`image/svg+xml;charset=utf-8`}):null},ke=async()=>{let e=document.getElementById(`sigil-export`);if(!e)return null;let t=await(0,h.default)(e,{background:void 0,backgroundColor:null}),n=await new Promise(e=>t.toBlob(t=>e(t),`image/png`));if(n)return n;let r=t.toDataURL(`image/png`).split(`,`)[1]??``,i=atob(r),a=new ArrayBuffer(i.length),o=new Uint8Array(a);for(let e=0;e<i.length;e++)o[e]=i.charCodeAt(e);return new Blob([a],{type:`image/png`})},Ae=e=>{let t=x,n=E?.chakraStep.stepIndex??S;return{pulse:i,beat:s,stepIndex:Number.isFinite(n)?Math.max(0,Math.min(Number(n),t-1)):0,chakraDay:w,stepsPerBeat:t,canonicalHash:e,exportedAt:new Date().toISOString(),expiresAtPulse:i+11}},je=async()=>{let t=(B||``).toLowerCase();if(!t){let e=Ee();t=(await pe(e?new XMLSerializer().serializeToString(e):JSON.stringify({pulse:i,beat:s,stepPct:f,chakraDay:w}))).toLowerCase()}let n=Ae(t),r=e(t,n);z(t),L(r),F(!0)},Me=async()=>{let e=Ae((B||``).toLowerCase()||await pe(JSON.stringify({pulse:i,beat:s,stepPct:f,chakraDay:w}))),[t,n]=await Promise.all([Oe(e),ke()]);if(!t||!n)return;let r=new g.default;r.file(`sigil_${i}.svg`,t),r.file(`sigil_${i}.png`,n);let a={...e,overlays:{qr:!1,eternalPulseBar:!1}};r.file(`sigil_${i}.manifest.json`,JSON.stringify(a,null,2));let o=await r.generateAsync({type:`blob`}),c=URL.createObjectURL(o),l=document.createElement(`a`);l.href=c,l.download=`sigil_${i}.zip`,document.body.appendChild(l),l.click(),l.remove(),requestAnimationFrame(()=>URL.revokeObjectURL(c))},Ne=()=>{n()},Pe=E?(e=>{let t=e.trim().match(/^(\d+):(\d{1,2})/);return t?`${+t[1]}:${t[2].padStart(2,`0`)}`:null})(E.kairos_seal_day_month):null,Fe=`${s}:${te(S)}`,Ie=Pe??Fe,Le=ne(E?E.kairos_seal_day_month:Ie),Re=me(E?.eternalChakraArc),ze=E?Math.max(0,Math.min(100,E.kaiPulseToday/b*100)):0;return(0,m.createPortal)((0,u.jsxs)(u.Fragment,{children:[(0,u.jsx)(he,{}),(0,u.jsx)(`div`,{ref:H,role:`dialog`,"aria-modal":`true`,className:`sigil-modal-overlay`,onMouseDown:e=>{e.target===e.currentTarget&&e.stopPropagation()},onClick:e=>{e.target===e.currentTarget&&e.stopPropagation()},onTouchStart:e=>{e.target===e.currentTarget&&e.stopPropagation()},onKeyDown:e=>e.key===`Escape`&&e.stopPropagation(),children:(0,u.jsxs)(`div`,{className:`sigil-modal`,onMouseDown:e=>e.stopPropagation(),onClick:e=>e.stopPropagation(),onTouchStart:e=>e.stopPropagation(),children:[(0,u.jsx)(`button`,{ref:U,"aria-label":`Close`,className:`close-btn`,onClick:Ne,children:(0,u.jsx)(se,{})}),(0,u.jsx)(p,{dateISO:O,onDateChange:xe,secondsLeft:we??void 0,solarPercent:ze,eternalPercent:ze,solarColor:`#ffd600`,eternalColor:Re,eternalArkLabel:E?.eternalChakraArc||`Ignite Ark`}),O&&(0,u.jsxs)(u.Fragment,{children:[(0,u.jsxs)(`label`,{style:{marginLeft:`12px`},children:[`Breath within minute:\xA0`,(0,u.jsx)(`select`,{value:A,onChange:Se,children:N.map((e,t)=>(0,u.jsx)(`option`,{value:t+1,children:e},e))})]}),(0,u.jsx)(`button`,{className:`now-btn`,onClick:Ce,children:`Now`})]}),we!==null&&(0,u.jsxs)(`p`,{className:`countdown`,children:[`next pulse in `,(0,u.jsx)(`strong`,{children:we.toFixed(6)}),`s`]}),(0,u.jsxs)(`div`,{id:`sigil-export`,style:{position:`relative`,width:240,margin:`16px auto`},children:[(0,u.jsx)(a,{ref:ae,pulse:i,beat:s,stepPct:f,chakraDay:w,size:240,hashMode:`deterministic`,origin:``,onReady:e=>{let t=e.hash?String(e.hash).toLowerCase():``;t&&re(t),typeof e.pulse==`number`&&e.pulse!==i&&o(e.pulse)}}),(0,u.jsx)(`span`,{className:`pulse-tag`,children:i.toLocaleString()})]}),(0,u.jsxs)(`div`,{className:`sigil-meta-block`,children:[(0,u.jsxs)(`p`,{children:[(0,u.jsx)(`strong`,{children:`Kairos:`}),`\xA0`,Ie,(0,u.jsx)(`button`,{className:`copy-btn`,onClick:()=>$(Ie),children:`💠`})]}),(0,u.jsxs)(`p`,{children:[(0,u.jsx)(`strong`,{children:`Kairos/Date:`}),`\xA0`,Le,(0,u.jsx)(`button`,{className:`copy-btn`,onClick:()=>$(Le),children:`💠`})]}),E&&(0,u.jsxs)(u.Fragment,{children:[(0,u.jsxs)(`p`,{children:[(0,u.jsx)(`strong`,{children:`Seal:`}),`\xA0`,E.eternalSeal,(0,u.jsx)(`button`,{className:`copy-btn`,onClick:()=>$(E.eternalSeal),children:`💠`})]}),(0,u.jsxs)(`p`,{children:[(0,u.jsx)(`strong`,{children:`Day:`}),` `,E.harmonicDay]}),(0,u.jsxs)(`p`,{children:[(0,u.jsx)(`strong`,{children:`Month:`}),` `,E.eternalMonth]}),(0,u.jsxs)(`p`,{children:[(0,u.jsx)(`strong`,{children:`Arc:`}),` `,E.eternalChakraArc]}),(0,u.jsxs)(`p`,{children:[(0,u.jsx)(`strong`,{children:`Year:`}),` `,E.eternalYearName]}),(0,u.jsxs)(`p`,{children:[(0,u.jsx)(`strong`,{children:`Kai-Turah:`}),`\xA0`,E.kaiTurahPhrase,(0,u.jsx)(`button`,{className:`copy-btn`,onClick:()=>$(E.kaiTurahPhrase),children:`💠`})]})]})]}),E&&(0,u.jsxs)(`details`,{className:`rich-data`,open:ie,onToggle:e=>V(e.currentTarget.open),children:[(0,u.jsx)(`summary`,{children:`Memory`}),(0,u.jsxs)(`div`,{className:`rich-grid`,children:[(0,u.jsxs)(`div`,{children:[(0,u.jsx)(`code`,{children:`kaiPulseEternal`}),(0,u.jsx)(`span`,{children:E.kaiPulseEternal.toLocaleString()})]}),(0,u.jsxs)(`div`,{children:[(0,u.jsx)(`code`,{children:`kaiPulseToday`}),(0,u.jsx)(`span`,{children:E.kaiPulseToday})]}),(0,u.jsxs)(`div`,{children:[(0,u.jsx)(`code`,{children:`kairos_seal_day_month`}),(0,u.jsx)(`span`,{children:E.kairos_seal_day_month})]}),(0,u.jsxs)(`div`,{children:[(0,u.jsx)(`code`,{children:`chakraStepString`}),(0,u.jsx)(`span`,{children:E.chakraStepString})]}),(0,u.jsxs)(`div`,{children:[(0,u.jsx)(`code`,{children:`chakraStep.stepIndex`}),(0,u.jsx)(`span`,{children:E.chakraStep.stepIndex})]}),(0,u.jsxs)(`div`,{children:[(0,u.jsx)(`code`,{children:`chakraStep.percentIntoStep`}),(0,u.jsxs)(`span`,{children:[E.chakraStep.percentIntoStep.toFixed(2),`%`]})]}),(0,u.jsxs)(`div`,{children:[(0,u.jsx)(`code`,{children:`chakraBeat.beatIndex`}),(0,u.jsx)(`span`,{children:E.chakraBeat.beatIndex})]}),(0,u.jsxs)(`div`,{children:[(0,u.jsx)(`code`,{children:`chakraBeat.pulsesIntoBeat`}),(0,u.jsx)(`span`,{children:E.chakraBeat.pulsesIntoBeat})]}),(0,u.jsxs)(`div`,{children:[(0,u.jsx)(`code`,{children:`weekIndex`}),(0,u.jsx)(`span`,{children:E.weekIndex})]}),(0,u.jsxs)(`div`,{children:[(0,u.jsx)(`code`,{children:`weekName`}),(0,u.jsx)(`span`,{children:E.weekName})]}),(0,u.jsxs)(`div`,{children:[(0,u.jsx)(`code`,{children:`dayOfMonth`}),(0,u.jsx)(`span`,{children:E.dayOfMonth})]}),(0,u.jsxs)(`div`,{children:[(0,u.jsx)(`code`,{children:`eternalMonthIndex`}),(0,u.jsx)(`span`,{children:E.eternalMonthIndex})]}),(0,u.jsxs)(`div`,{children:[(0,u.jsx)(`code`,{children:`harmonicWeekProgress.percent`}),(0,u.jsxs)(`span`,{children:[E.harmonicWeekProgress.percent.toFixed(2),`%`]})]}),(0,u.jsxs)(`div`,{children:[(0,u.jsx)(`code`,{children:`eternalMonthProgress.percent`}),(0,u.jsxs)(`span`,{children:[E.eternalMonthProgress.percent.toFixed(2),`%`]})]}),(0,u.jsxs)(`div`,{children:[(0,u.jsx)(`code`,{children:`harmonicYearProgress.percent`}),(0,u.jsxs)(`span`,{children:[E.harmonicYearProgress.percent.toFixed(2),`%`]})]}),(0,u.jsxs)(`div`,{children:[(0,u.jsx)(`code`,{children:`phiSpiralLevel`}),(0,u.jsx)(`span`,{children:E.phiSpiralLevel})]}),(0,u.jsxs)(`div`,{className:`span-2`,children:[(0,u.jsx)(`code`,{children:`kaiMomentSummary`}),(0,u.jsx)(`span`,{children:E.kaiMomentSummary})]}),(0,u.jsxs)(`div`,{className:`span-2`,children:[(0,u.jsx)(`code`,{children:`compressed_summary`}),(0,u.jsx)(`span`,{children:E.compressed_summary})]}),(0,u.jsxs)(`div`,{className:`span-2`,children:[(0,u.jsx)(`code`,{children:`eternalSeal`}),(0,u.jsx)(`span`,{className:`truncate`,children:E.eternalSeal})]})]}),(0,u.jsx)(`div`,{className:`rich-actions`,children:(0,u.jsx)(`button`,{onClick:()=>Te(E),children:`Remember JSON`})})]}),(0,u.jsx)(`div`,{className:`modal-bottom-spacer`,"aria-hidden":`true`}),(0,u.jsx)(`div`,{className:`mint-dock`,children:(0,u.jsx)(`button`,{className:`mint-btn`,type:`button`,"aria-label":`Mint this moment`,title:`Mint this moment`,onClick:je,children:(0,u.jsx)(`span`,{className:`mint-btn__icon`,"aria-hidden":`true`,children:ee?(0,u.jsx)(`img`,{src:`/assets/seal.svg`,alt:``,loading:`eager`,decoding:`async`,onError:()=>M(!1)}):(0,u.jsx)(ce,{})})})})]})}),(0,u.jsx)(c,{open:P,url:I,hash:R,onClose:()=>F(!1),onDownloadZip:Me})]}),document.body)};export{Y as t};